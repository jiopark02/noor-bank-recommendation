/**
 * PLAID-SEC1 — strip credentials from Plaid/axios errors at the source.
 *
 * WHY THIS EXISTS
 * `src/lib/plaid.ts` injects PLAID-CLIENT-ID / PLAID-SECRET as axios request
 * headers, so every AxiosError the Plaid SDK rejects with carries them on
 * `error.config.headers`, and carries the user's Plaid `access_token` on
 * `error.config.data`. Any `console.error("...", error)` therefore writes both
 * into the Vercel logs verbatim. The goal is NOT to stop logging — the
 * diagnostic payload (error_code / error_type / request_id) must survive — it
 * is to make sure the credentials are gone before the error ever leaves the
 * SDK's promise chain.
 *
 * TWO EXPORTS, ONE PURE
 * - `buildSafePlaidErrorDiagnostics` is pure: it reads, never writes, and
 *   returns a brand-new flat object. All allow-list logic lives here, so the
 *   redaction rules are unit-testable deterministically.
 * - `redactPlaidAxiosError` is the impure step the response interceptor calls.
 *   It replaces the dangerous fields on the error IN PLACE.
 *
 * HOW EACH LAYER DECIDES WHAT SURVIVES — stated precisely, because the two
 * layers do NOT offer the same guarantee.
 *
 * `buildSafePlaidErrorDiagnostics` is a strict allow-list. It copies the fields
 * named below — and only when the value is actually a string — into a fresh
 * object, and never reads the rest. It removes nothing key-by-key, so it cannot
 * spring a leak the day the SDK renames or adds an auth header.
 *
 * `redactPlaidAxiosError` cannot work that way, because it must hand back the
 * SAME error object (see its own doc comment for why). It operates on the
 * error's properties instead, and wholesale rather than selectively:
 * `config` and `response` are REPLACED by objects rebuilt from the allow-listed
 * summary, and `request` is REMOVED whole. No key inside them is inspected or
 * filtered, so no known-bad key list is being maintained here either.
 *
 * The limit of that, stated rather than glossed over: any OTHER property axios
 * hangs on the error — `code`, `status`, `cause`, adapter-supplied custom props
 * — is left untouched, because the three above are the only ones this function
 * names. None of them carry credentials in the axios version we depend on; that
 * is a fact about what axios currently attaches, not a promise this file makes.
 */

/**
 * Plaid's error payload fields (see `PlaidError` in the SDK typings). These are
 * the only keys ever copied out of `response.data`, and only when the value is
 * actually a string — so the allow-list covers the value type too, not just the
 * key name. `causes` is deliberately absent: it is `Array<any>` with no shape
 * guarantee, so only its length is recorded.
 */
const PLAID_DIAGNOSTIC_STRING_FIELDS = [
  "error_type",
  "error_code",
  "error_code_reason",
  "error_message",
  "display_message",
  "request_id",
  "documentation_url",
  "suggested_action",
] as const;

type PlaidDiagnosticStringField = (typeof PLAID_DIAGNOSTIC_STRING_FIELDS)[number];

type PlaidDiagnosticPayload = Partial<Record<PlaidDiagnosticStringField, string>>;

/**
 * The shape that is safe to log. The type itself encodes the allow-list: there
 * is no member for headers, request bodies, tokens, or a raw response body, so
 * a future edit cannot widen what gets logged without widening this type first.
 */
export type PlaidSafeErrorDiagnostics = {
  /** Marker proving the interceptor ran — grep for it during live verification. */
  redacted: true;
  message: string;
  name?: string;
  /** axios error code, e.g. "ERR_BAD_REQUEST". */
  code?: string;
  method?: string;
  /** Pathname only. Origin and query string are dropped. */
  path?: string;
  status?: number;
  statusText?: string;
  /** Set only when `response.data` was NOT a plain object — the type, never the body. */
  data_type?: string;
  causes_count?: number;
} & PlaidDiagnosticPayload;

/** A non-null, non-array object, or undefined. Arrays are excluded on purpose. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function describeValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Pathname only. The SDK builds an absolute URL (basePath + "/accounts/get"),
 * so this normally yields "/accounts/get". A value that does not parse is
 * dropped entirely rather than passed through — an unparseable string is
 * exactly the case where we cannot promise it holds no secret.
 */
function toPathOnly(value: unknown): string | undefined {
  const url = readString(value);
  if (!url) return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

/**
 * Copy the allow-listed Plaid diagnostic fields out of a response body.
 * Only string values are taken, so an object smuggled in under one of these
 * names is skipped rather than serialized.
 */
function readPlaidErrorPayload(
  data: Record<string, unknown>
): PlaidDiagnosticPayload {
  const payload: PlaidDiagnosticPayload = {};
  for (const field of PLAID_DIAGNOSTIC_STRING_FIELDS) {
    const value = readString(data[field]);
    if (value !== undefined) {
      payload[field] = value;
    }
  }
  return payload;
}

/**
 * Re-project the Plaid payload fields back out of an already-built diagnostics
 * object. Used so the rebuilt `error.response.data` is derived from the
 * summary we already computed rather than reading the original response a
 * second time — the raw body is read exactly once, in the pure function.
 */
function pickPayloadFromDiagnostics(
  diagnostics: PlaidSafeErrorDiagnostics
): PlaidDiagnosticPayload {
  const payload: PlaidDiagnosticPayload = {};
  for (const field of PLAID_DIAGNOSTIC_STRING_FIELDS) {
    const value = diagnostics[field];
    if (value !== undefined) {
      payload[field] = value;
    }
  }
  return payload;
}

/**
 * PURE. Builds the loggable summary of an error.
 *
 * Reads only: message / name / code, config.url (path only), config.method,
 * response.status, response.statusText, and the allow-listed fields of
 * response.data. It never reads `config.headers`, `config.data`, or
 * `error.request`, so the credentials and the access token have no path into
 * the returned object.
 *
 * Does not mutate its input and has no side effects: same input, same output.
 */
export function buildSafePlaidErrorDiagnostics(
  error: unknown
): PlaidSafeErrorDiagnostics {
  const source = asRecord(error);
  const config = asRecord(source?.config);
  const response = asRecord(source?.response);
  const data = response ? response.data : undefined;
  const dataRecord = asRecord(data);

  const name = readString(source?.name);
  const code = readString(source?.code);
  const method = readString(config?.method);
  const path = toPathOnly(config?.url);
  const status = readNumber(response?.status);
  const statusText = readString(response?.statusText);
  const causes = dataRecord ? dataRecord.causes : undefined;

  return {
    redacted: true,
    message: readString(source?.message) ?? "Unknown error",
    ...(name !== undefined ? { name } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(method !== undefined ? { method: method.toUpperCase() } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(statusText !== undefined ? { statusText } : {}),
    // A non-object body (gateway HTML, proxy text) is described by type only.
    // Copying it verbatim would drag an arbitrarily large, unvetted payload
    // into the logs.
    ...(data !== undefined && dataRecord === undefined
      ? { data_type: describeValueType(data) }
      : {}),
    ...(Array.isArray(causes) ? { causes_count: causes.length } : {}),
    ...(dataRecord ? readPlaidErrorPayload(dataRecord) : {}),
  };
}

/**
 * IMPURE. Replaces the credential-bearing fields on an error in place and
 * returns the same error.
 *
 * In place, not wrapped in a new error, because `message` / `name` / `stack` /
 * `instanceof Error` / `isAxiosError` must survive: three call sites match on
 * `error.message` to detect ITEM_LOGIN_REQUIRED, and rebuilding the error would
 * change what they see.
 *
 * All three of `config`, `request` and `response` are dealt with, not just
 * `config`: `config` and `response` are replaced by rebuilt objects and
 * `request` is deleted outright. axios constructs the error as
 * `new AxiosError(msg, code, response.config, response.request, response)`, so
 * `error.config` and `error.response.config` are THE SAME OBJECT — replacing
 * only `error.config` would leave the real headers reachable through
 * `error.response.config`. They are invisible today solely because
 * `util.inspect` stops at depth 2, and depth is not a security boundary.
 */
export function redactPlaidAxiosError(error: unknown): unknown {
  const target = asRecord(error);

  // Nothing that carries an axios request. A plain Error, the SDK's
  // RequiredError, or a thrown primitive holds no credentials, so it passes
  // through untouched.
  if (
    !target ||
    ("config" in target === false &&
      "response" in target === false &&
      "request" in target === false)
  ) {
    return error;
  }

  try {
    const diagnostics = buildSafePlaidErrorDiagnostics(error);

    // Rebuilt from the allow-listed summary so the axios-ish shape survives for
    // any consumer reading `err.response?.status`, while carrying none of the
    // original objects. AxiosError.prototype.toJSON() reads `this.config`, so
    // this makes that path safe too.
    target.config = {
      method: diagnostics.method,
      path: diagnostics.path,
    };
    delete target.request;
    target.response = {
      status: diagnostics.status,
      statusText: diagnostics.statusText,
      data: pickPayloadFromDiagnostics(diagnostics),
    };
    target.plaidDiagnostics = diagnostics;

    // Top-level marker. `plaidDiagnostics.redacted` is nested two levels deep,
    // which util.inspect will still print but a log search should not have to
    // rely on. Live verification greps for this.
    target.redacted = true;

    return error;
  } catch {
    // FAIL CLOSED. If the replacement could not be completed — a frozen or
    // exotic error object, a throwing getter — the original must not be handed
    // back, because it is still carrying the secret. Surface a plain error with
    // the message only.
    let message = "Plaid request failed";
    try {
      message = readString(asRecord(error)?.message) ?? message;
    } catch {
      // A throwing `message` getter: keep the constant above.
    }
    const fallback = new Error(message);
    fallback.name = "PlaidRedactionFailure";
    return fallback;
  }
}
