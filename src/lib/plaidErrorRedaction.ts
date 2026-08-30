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
 *   On its success path it replaces the dangerous fields on the error IN PLACE.
 *   When one of those replacements cannot be completed it fails closed to a
 *   different error instead; either way the original is never handed back.
 *
 * HOW EACH LAYER DECIDES WHAT SURVIVES — stated precisely, because the two
 * layers do NOT offer the same guarantee.
 *
 * `buildSafePlaidErrorDiagnostics` is a strict allow-list. It copies the fields
 * named below — and only when the value is actually a string — into a fresh
 * object, and never reads the rest. It removes nothing key-by-key, so it cannot
 * spring a leak the day the SDK renames or adds an auth header.
 *
 * `redactPlaidAxiosError` does not work that way, because on its success path
 * it hands back the SAME error object — a preference with named beneficiaries
 * rather than a requirement of the pipeline, spelled out in its own doc
 * comment, and one its fail-closed branch deliberately gives up. It operates on
 * the error's properties instead, and wholesale rather than selectively:
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
 * IMPURE. On its success path, replaces the credential-bearing fields on an
 * error in place and returns the same error. When any of those replacements
 * throws, it returns a DIFFERENT error instead — see the fail-closed branch at
 * the bottom of the function, and `getPlaidErrorCode` for what survives it.
 *
 * In place, not wrapped in a new error — but not for the reason this comment
 * used to give. Callers USED TO detect ITEM_LOGIN_REQUIRED by matching
 * `error.message`, and none do now: they read the code (see
 * `getPlaidErrorCode`). What rewriting in place still buys, with the consumer
 * named for each:
 * - `message` and `instanceof Error`, read wherever a Plaid route logs a caught
 *   error as `e instanceof Error ? e.message : e`. Grep that shape rather than
 *   trusting a tally here; at least one such site is on a Plaid call.
 * - `stack`, the only link back to the SDK call frame. Anything constructed
 *   here instead carries a stack rooted in this interceptor — compare the
 *   fail-closed branch below, which accepts exactly that loss.
 * - the axios-ish `response` shape rebuilt below, which `getPlaidErrorStatus`
 *   reads as its second location.
 * - the axios-ish `config` shape rebuilt below, read by
 *   `AxiosError.prototype.toJSON()`, which serializes `this.config` into its
 *   output. Nothing in this repo reads it; axios does.
 *
 * What is deliberately NOT claimed: that anything outside this function still
 * holds the original object. No such holder has been demonstrated — axios
 * builds the error in settle() and hands it straight to reject(), and the
 * interceptor chain passes it to this handler without retaining it elsewhere.
 * The fail-closed branch below returns a DIFFERENT object and propagates
 * normally, which is the proof that returning the same object is a preference
 * with named beneficiaries, not a requirement of the pipeline.
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

  // Declared outside the try so the fail-closed branch can reuse it. Every
  // value inside is a primitive produced by the pure builder, so handing it to
  // the replacement below carries no reference back to the original error.
  let diagnostics: PlaidSafeErrorDiagnostics | undefined;

  try {
    diagnostics = buildSafePlaidErrorDiagnostics(error);

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
    // back, because it is still carrying the secret. Surface a replacement
    // carrying the message and whatever allow-listed diagnostics are still
    // available, so the fields callers judge on survive the failure.
    let message = "Plaid request failed";
    try {
      message = readString(asRecord(error)?.message) ?? message;
    } catch {
      // A throwing `message` getter: keep the constant above.
    }

    // Best effort, because a replacement that cannot be diagnosed collapses
    // every Plaid failure into a generic 500 — and in a route that judges each
    // connection separately, sinks the whole request.
    //
    // Prefer the summary this call already built. When the throw came from one
    // of the writes, `diagnostics` is complete and was derived from the error
    // BEFORE any part of it was replaced, so the replacement can carry every
    // allow-listed field rather than the two a second read can find — and it
    // does not have to trust a `plaidDiagnostics` this function did not write.
    // Only a throw from the builder itself leaves it undefined.
    let recovered = diagnostics;
    if (recovered === undefined) {
      // Second read of the failing object, reached only when the builder threw
      // — so no write ran, nothing on the error was replaced, and the code and
      // the status are still wherever the server left them. Both readers are
      // no-throw by their own implementation rather than by convention, and
      // read only allow-listed fields, so this can neither rethrow out of the
      // fail-closed path nor widen what a log can print. Either can still come
      // back undefined: whatever broke the builder may be something they need
      // to read too.
      const code = getPlaidErrorCode(error);
      const status = getPlaidErrorStatus(error);

      // Nothing readable: leave the replacement exactly as it was before this
      // recovery existed. Undiagnosable is the honest answer; inventing a code
      // would be worse than a generic 500.
      if (code !== undefined || status !== undefined) {
        recovered = {
          redacted: true,
          message,
          ...(code !== undefined ? { error_code: code } : {}),
          ...(status !== undefined ? { status } : {}),
        };
      }
    }

    // Named decision line. Once the code is recovered, `[plaid-error]` prints
    // exactly what it prints for a normal failure, and inside a per-connection
    // loop the skipped error is logged nowhere at all — so this is the only
    // signal that the fail-closed path ran.
    //
    // What the allow-list guarantees about these two values is the KEY and the
    // VALUE TYPE, not the contents: `error_code` is whatever string the server
    // put under that name. So this cannot print a header, a request body or an
    // access token, which is the exposure this file exists to prevent — it is
    // not a promise about the string itself. They are the same two values the
    // success path already writes and `handlePlaidError` already logs.
    console.error(
      `[plaid-redaction] failed-closed code=${
        recovered?.error_code ?? "none"
      } status=${recovered?.status ?? "none"}`
    );

    const fallback: Error & {
      plaidDiagnostics?: PlaidSafeErrorDiagnostics;
    } = new Error(message);
    fallback.name = "PlaidRedactionFailure";

    if (recovered !== undefined) {
      fallback.plaidDiagnostics = recovered;
    }

    return fallback;
  }
}

/**
 * READ SIDE — the counterpart to the two functions above.
 *
 * WHY THIS EXISTS
 * Callers used to decide "is this a re-auth error?" with
 * `error.message.includes("ITEM_LOGIN_REQUIRED")`. That never matched: the Plaid
 * SDK rejects with an AxiosError whose message is built by axios' own settle()
 * as `"Request failed with status code " + status`, so the Plaid code lives in
 * the response BODY and never in the message. Every Plaid failure therefore fell
 * through to a generic 500 carrying an axios internal string.
 *
 * WHERE THE CODE SURVIVES — stated with the path attached, because it does not
 * hold unconditionally.
 * On the path where redaction succeeds, the code is not lost:
 * `redactPlaidAxiosError` allow-lists `error_code` and writes it to both
 * locations read below. On its fail-closed path the interceptor returns a
 * replacement error instead of the original, and carries onto it the
 * allow-listed summary it had already built — or, when it threw before building
 * one, only what it can still read off the failing object. So a fail-closed
 * error may or may not be diagnosable. `undefined` therefore means "no code was
 * readable", never "no code existed".
 *
 * The locations it reads, in the order they are produced:
 *
 *   1. `error.plaidDiagnostics.error_code` — the marker the interceptor attaches.
 *   2. `error.response.data.error_code`    — the rebuilt axios-ish shape.
 *
 * The second is a genuine fallback, not decoration: an AxiosError that never
 * passed through `plaidHttp` (a second PlaidApi built without the interceptor,
 * or a direct axios call) still carries the code at the original location.
 *
 * NEVER THROWS. Every call site is inside a `catch` block, where a throw would
 * replace the error being diagnosed with a new one and lose the original. A
 * thrown value that is not an object, a Supabase error, an exotic object with a
 * throwing getter, or a fail-closed replacement that recovered nothing all
 * return `undefined`, which callers must treat as "not a Plaid API error".
 */
export function getPlaidErrorCode(error: unknown): string | undefined {
  try {
    const source = asRecord(error);
    if (!source) return undefined;

    const diagnostics = asRecord(source.plaidDiagnostics);
    const fromDiagnostics = readString(diagnostics?.error_code);
    if (fromDiagnostics !== undefined) {
      return fromDiagnostics;
    }

    const response = asRecord(source.response);
    const data = asRecord(response?.data);
    return readString(data?.error_code);
  } catch {
    // A throwing getter or an exotic proxy. Undiagnosable is not fatal — the
    // caller falls back to a generic 500, which is the correct answer here.
    return undefined;
  }
}

/**
 * The HTTP status Plaid replied with, read from the same two locations and with
 * the same no-throw contract as `getPlaidErrorCode`.
 *
 * Used only to decide whether a Plaid error that is not individually mapped
 * should surface its own 4xx rather than collapse into a 500. Returns
 * `undefined` when the error carries no response (a transport failure), which
 * the caller treats as 500.
 */
export function getPlaidErrorStatus(error: unknown): number | undefined {
  try {
    const source = asRecord(error);
    if (!source) return undefined;

    const diagnostics = asRecord(source.plaidDiagnostics);
    const fromDiagnostics = readNumber(diagnostics?.status);
    if (fromDiagnostics !== undefined) {
      return fromDiagnostics;
    }

    const response = asRecord(source.response);
    return readNumber(response?.status);
  } catch {
    return undefined;
  }
}
