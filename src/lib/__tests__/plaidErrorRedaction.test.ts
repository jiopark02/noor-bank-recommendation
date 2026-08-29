import { inspect } from "node:util";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSafePlaidErrorDiagnostics,
  getPlaidErrorCode,
  getPlaidErrorStatus,
  redactPlaidAxiosError,
} from "../plaidErrorRedaction";

// Fake values only. Nothing here is or resembles a real credential — the point
// is to prove these strings cannot survive redaction, whatever they are.
const SENTINEL_SECRET = "SENTINEL_SECRET_e6f1a2";
const SENTINEL_CLIENT_ID = "SENTINEL_CLIENT_ID_b93c07";
const SENTINEL_TOKEN = "SENTINEL_TOKEN_4a17de";

/**
 * Serialize a value the two ways a leak could actually surface in production:
 * `console.error` (util.inspect) and any structured logger (JSON.stringify).
 *
 * depth: null is the whole point. The pre-fix leak was invisible in logs only
 * because util.inspect stops at depth 2, so asserting at the default depth
 * would re-enshrine exactly the accident this change exists to remove.
 */
function serializeDeeply(value: unknown): string {
  let asJson = "";
  try {
    asJson = JSON.stringify(value) ?? "";
  } catch {
    asJson = "<not JSON-serializable>";
  }
  return `${inspect(value, { depth: null, showHidden: false })}\n${asJson}`;
}

/**
 * An axios-shaped error: a real Error (so `message` is non-enumerable, as it is
 * on AxiosError) with config/request/response assigned as own enumerable
 * properties, which is how axios builds it.
 */
function makeAxiosLikeError(
  overrides: {
    sharedConfig?: boolean;
    responseData?: unknown;
  } = {}
): Error & Record<string, unknown> {
  const config: Record<string, unknown> = {
    url: "https://sandbox.plaid.com/accounts/get",
    method: "post",
    headers: {
      "PLAID-CLIENT-ID": SENTINEL_CLIENT_ID,
      "PLAID-SECRET": SENTINEL_SECRET,
      "Content-Type": "application/json",
    },
    data: JSON.stringify({ access_token: SENTINEL_TOKEN }),
  };

  const responseData =
    "responseData" in overrides
      ? overrides.responseData
      : {
          error_type: "ITEM_ERROR",
          error_code: "ITEM_LOGIN_REQUIRED",
          error_message: "the login details of this item have changed",
          display_message: "Please reconnect your bank.",
          request_id: "req_SENTINEL_FREE_1234",
          documentation_url: "https://plaid.com/docs/errors/item/",
          suggested_action: "Prompt the user to re-authenticate.",
          causes: [],
        };

  const response: Record<string, unknown> = {
    status: 400,
    statusText: "Bad Request",
    headers: { "content-type": "application/json" },
    data: responseData,
    // settle.js builds the error as
    //   new AxiosError(msg, code, response.config, response.request, response)
    // so in real axios `error.config` and `error.response.config` are the SAME
    // object. `sharedConfig` reproduces that.
    config: overrides.sharedConfig ? config : { ...config },
    request: { path: "/accounts/get", _header: `PLAID-SECRET: ${SENTINEL_SECRET}` },
  };

  const error = new Error(
    "Request failed with status code 400"
  ) as Error & Record<string, unknown>;
  error.name = "AxiosError";
  error.isAxiosError = true;
  error.code = "ERR_BAD_REQUEST";
  error.config = config;
  error.request = {
    path: "/accounts/get",
    _header: `PLAID-SECRET: ${SENTINEL_SECRET}`,
  };
  error.response = response;

  return error;
}

/**
 * The same error, rigged so one specific write inside `redactPlaidAxiosError`
 * throws — one of the two ways to reach the fail-closed branch through the real
 * code path instead of hand-building its output. The other is
 * `makeUnsummarizableAxiosLikeError` below.
 *
 * A throwing SETTER, deliberately, not `Object.freeze`: freeze only throws on
 * assignment in strict mode, so a frozen fixture would stop discriminating the
 * day this module ran sloppy and would pass against broken code. A setter
 * throws either way.
 *
 * The getter still returns the original value, so the PURE builder — which only
 * reads — always succeeds against this fixture. The summary therefore already
 * exists by the time a write throws, and the catch block reuses it. `at`
 * selects how far the rewrite of the (discarded) original had got, NOT which
 * recovery the catch block performs:
 * - "config"           the FIRST write. Nothing on the original was replaced.
 * - "plaidDiagnostics" a LATE write. config/request/response were replaced
 *                      first.
 * Both must yield the same complete summary, which is the invariant the two
 * tests using this fixture exist to pin.
 */
function makeHostileAxiosLikeError(
  at: "config" | "plaidDiagnostics",
  overrides: { responseData?: unknown } = {}
): Error & Record<string, unknown> {
  const error = makeAxiosLikeError(overrides);
  const current = error[at];

  Object.defineProperty(error, at, {
    get() {
      return current;
    },
    set() {
      throw new TypeError(`cannot assign ${at}`);
    },
    configurable: true,
    enumerable: true,
  });

  return error;
}

/**
 * Fails closed with nothing to recover: the same getter that breaks the rewrite
 * also breaks every read the catch block could use. This is the case the
 * fallback must handle by staying exactly as small as it always was.
 */
function makeUnreadableAxiosLikeError(): Error & Record<string, unknown> {
  const error = new Error("Request failed with status code 400") as Error &
    Record<string, unknown>;
  error.name = "AxiosError";
  error.config = {
    headers: { "PLAID-SECRET": SENTINEL_SECRET },
    data: JSON.stringify({ access_token: SENTINEL_TOKEN }),
  };

  Object.defineProperty(error, "response", {
    get() {
      throw new TypeError("hostile response getter");
    },
    configurable: true,
    enumerable: true,
  });

  return error;
}

/**
 * Fails closed BEFORE any summary exists, which is the only way into the catch
 * block's OTHER recovery — the one that rebuilds a summary from a second read
 * of the failing object instead of reusing the one already built.
 *
 * Reaching it takes a field the pure builder reads and neither reader touches.
 * `config` is that field: the builder reads it for the method and the path,
 * while `getPlaidErrorCode` and `getPlaidErrorStatus` look only at
 * `plaidDiagnostics` and `response`. A throwing getter there takes the builder
 * down while leaving the code and the status readable — which a getter on
 * `response` would not, as `makeUnreadableAxiosLikeError` above shows.
 *
 * `in` does not invoke a getter, so the error still satisfies the axios-shape
 * guard at the top of the function rather than being waved through untouched.
 * The sentinels stay reachable through `request` and `response.config`, so the
 * leak assertions still have something to fail on.
 */
function makeUnsummarizableAxiosLikeError(
  overrides: { responseData?: unknown } = {}
): Error & Record<string, unknown> {
  const error = makeAxiosLikeError(overrides);

  Object.defineProperty(error, "config", {
    get() {
      throw new TypeError("hostile config getter");
    },
    configurable: true,
    enumerable: true,
  });

  return error;
}

// A — the core assertion.
describe("redactPlaidAxiosError — A: sentinels do not survive", () => {
  it("removes the secret, client id and access token from every serialization", () => {
    const redacted = redactPlaidAxiosError(makeAxiosLikeError());
    const serialized = serializeDeeply(redacted);

    expect(serialized).not.toContain(SENTINEL_SECRET);
    expect(serialized).not.toContain(SENTINEL_CLIENT_ID);
    expect(serialized).not.toContain(SENTINEL_TOKEN);

    // Guard against a false pass: prove we actually serialized a redacted
    // error rather than an empty or unrelated value.
    expect(serialized).toContain("/accounts/get");
    expect((redacted as Record<string, unknown>).redacted).toBe(true);
  });

  it("drops the request object, whose raw header block carries the secret", () => {
    const redacted = redactPlaidAxiosError(makeAxiosLikeError()) as Record<
      string,
      unknown
    >;

    expect(redacted.request).toBeUndefined();
    expect("request" in redacted).toBe(false);
  });

  it("leaves no headers or request body anywhere on the error", () => {
    const redacted = redactPlaidAxiosError(makeAxiosLikeError()) as Record<
      string,
      unknown
    >;

    const config = redacted.config as Record<string, unknown>;
    const response = redacted.response as Record<string, unknown>;

    expect(config.headers).toBeUndefined();
    expect(config.data).toBeUndefined();
    expect(response.headers).toBeUndefined();
    expect(response.config).toBeUndefined();
    expect(response.request).toBeUndefined();
  });
});

// B — the regression line for "safety by inspect depth".
describe("redactPlaidAxiosError — B: config shared with response.config", () => {
  it("redacts when error.config and error.response.config are the same object", () => {
    const error = makeAxiosLikeError({ sharedConfig: true });

    // Precondition: the fixture really does reproduce the axios aliasing.
    expect(error.config).toBe(
      (error.response as Record<string, unknown>).config
    );
    // Precondition: unredacted, the secret IS reachable at unlimited depth.
    expect(serializeDeeply(error)).toContain(SENTINEL_SECRET);

    const redacted = redactPlaidAxiosError(error);
    const serialized = serializeDeeply(redacted);

    expect(serialized).not.toContain(SENTINEL_SECRET);
    expect(serialized).not.toContain(SENTINEL_CLIENT_ID);
    expect(serialized).not.toContain(SENTINEL_TOKEN);
  });
});

// C — redaction must not cost us the diagnosis.
describe("buildSafePlaidErrorDiagnostics — C: diagnostics are preserved", () => {
  it("keeps the Plaid error payload, status and request path", () => {
    const diagnostics = buildSafePlaidErrorDiagnostics(makeAxiosLikeError());

    expect(diagnostics.error_type).toBe("ITEM_ERROR");
    expect(diagnostics.error_code).toBe("ITEM_LOGIN_REQUIRED");
    expect(diagnostics.error_message).toBe(
      "the login details of this item have changed"
    );
    expect(diagnostics.display_message).toBe("Please reconnect your bank.");
    expect(diagnostics.request_id).toBe("req_SENTINEL_FREE_1234");
    expect(diagnostics.status).toBe(400);
    expect(diagnostics.statusText).toBe("Bad Request");
    expect(diagnostics.path).toBe("/accounts/get");
    expect(diagnostics.method).toBe("POST");
    expect(diagnostics.code).toBe("ERR_BAD_REQUEST");
    expect(diagnostics.redacted).toBe(true);
  });

  it("keeps only the count of causes, never their contents", () => {
    const error = makeAxiosLikeError({
      responseData: {
        error_code: "INVALID_REQUEST",
        causes: [{ note: SENTINEL_TOKEN }, { note: SENTINEL_SECRET }],
      },
    });

    const diagnostics = buildSafePlaidErrorDiagnostics(error);

    expect(diagnostics.causes_count).toBe(2);
    expect(serializeDeeply(diagnostics)).not.toContain(SENTINEL_TOKEN);
    expect(serializeDeeply(diagnostics)).not.toContain(SENTINEL_SECRET);
  });

  it("carries the diagnostics through onto the redacted error", () => {
    const redacted = redactPlaidAxiosError(makeAxiosLikeError()) as Record<
      string,
      unknown
    >;
    const attached = redacted.plaidDiagnostics as Record<string, unknown>;
    const response = redacted.response as Record<string, unknown>;
    const data = response.data as Record<string, unknown>;

    expect(attached.error_code).toBe("ITEM_LOGIN_REQUIRED");
    expect(attached.request_id).toBe("req_SENTINEL_FREE_1234");
    expect(response.status).toBe(400);
    expect(data.error_code).toBe("ITEM_LOGIN_REQUIRED");
  });

  it("ignores an allow-listed field whose value is not a string", () => {
    const error = makeAxiosLikeError({
      responseData: { error_code: { nested: SENTINEL_SECRET } },
    });

    const diagnostics = buildSafePlaidErrorDiagnostics(error);

    expect(diagnostics.error_code).toBeUndefined();
    expect(serializeDeeply(diagnostics)).not.toContain(SENTINEL_SECRET);
  });
});

// D — the contract that protects the three `.message` call sites.
describe("redactPlaidAxiosError — D: message is untouched", () => {
  it("preserves message, name, stack and isAxiosError", () => {
    const error = makeAxiosLikeError();
    const messageBefore = error.message;
    const nameBefore = error.name;
    const stackBefore = error.stack;

    const redacted = redactPlaidAxiosError(error) as Error &
      Record<string, unknown>;

    expect(redacted).toBe(error); // same object: in-place, not re-wrapped
    expect(redacted.message).toBe(messageBefore);
    expect(redacted.name).toBe(nameBefore);
    expect(redacted.stack).toBe(stackBefore);
    expect(redacted.isAxiosError).toBe(true);
    expect(redacted instanceof Error).toBe(true);
  });
});

// E — anything that is not an axios error must pass through unharmed.
describe("redactPlaidAxiosError — E: non-axios errors pass through", () => {
  it("returns a plain Error unchanged", () => {
    const error = new Error("something else broke");

    const result = redactPlaidAxiosError(error) as Error;

    expect(result).toBe(error);
    expect(result.message).toBe("something else broke");
    expect((result as unknown as Record<string, unknown>).redacted).toBeUndefined();
  });

  it("returns a RequiredError-like error unchanged", () => {
    const error = new Error(
      "Required parameter access_token was null or undefined when calling accountsGet."
    ) as Error & Record<string, unknown>;
    error.name = "RequiredError";
    error.field = "access_token";

    const result = redactPlaidAxiosError(error) as Error &
      Record<string, unknown>;

    expect(result).toBe(error);
    expect(result.name).toBe("RequiredError");
    expect(result.field).toBe("access_token");
  });

  it("does not crash on a thrown primitive or null", () => {
    expect(redactPlaidAxiosError("just a string")).toBe("just a string");
    expect(redactPlaidAxiosError(null)).toBe(null);
    expect(redactPlaidAxiosError(undefined)).toBe(undefined);
  });

  it("summarizes a non-axios error without inventing fields", () => {
    const diagnostics = buildSafePlaidErrorDiagnostics(
      new Error("something else broke")
    );

    expect(diagnostics.message).toBe("something else broke");
    expect(diagnostics.status).toBeUndefined();
    expect(diagnostics.path).toBeUndefined();
    expect(diagnostics.error_code).toBeUndefined();
  });
});

// F — a non-object body must be described, never copied.
describe("buildSafePlaidErrorDiagnostics — F: non-object response body", () => {
  const html = `<!doctype html><html><body>${"gateway error ".repeat(
    200
  )}${SENTINEL_TOKEN}</body></html>`;

  it("records the type only, not the body", () => {
    const diagnostics = buildSafePlaidErrorDiagnostics(
      makeAxiosLikeError({ responseData: html })
    );

    expect(diagnostics.data_type).toBe("string");
    const serialized = serializeDeeply(diagnostics);
    expect(serialized).not.toContain("gateway error");
    expect(serialized).not.toContain(SENTINEL_TOKEN);
  });

  it("keeps the body out of the redacted error too", () => {
    const redacted = redactPlaidAxiosError(
      makeAxiosLikeError({ responseData: html })
    );

    const serialized = serializeDeeply(redacted);
    expect(serialized).not.toContain("gateway error");
    expect(serialized).not.toContain(SENTINEL_TOKEN);
    expect(serialized).not.toContain(SENTINEL_SECRET);
  });

  it("describes an array body as an array", () => {
    const diagnostics = buildSafePlaidErrorDiagnostics(
      makeAxiosLikeError({ responseData: [SENTINEL_TOKEN] })
    );

    expect(diagnostics.data_type).toBe("array");
    expect(serializeDeeply(diagnostics)).not.toContain(SENTINEL_TOKEN);
  });
});

// G — purity. Note this is about buildSafePlaidErrorDiagnostics only;
// redactPlaidAxiosError mutates by design (see D).
describe("buildSafePlaidErrorDiagnostics — G: purity", () => {
  it("does not mutate its input", () => {
    const error = makeAxiosLikeError();
    const before = JSON.parse(JSON.stringify(error));

    buildSafePlaidErrorDiagnostics(error);

    expect(JSON.parse(JSON.stringify(error))).toEqual(before);
    // The credential-bearing fields are still on the untouched input, proving
    // the function read them without stripping anything.
    expect(
      (error.config as Record<string, unknown>).headers
    ).toBeDefined();
  });

  it("returns an equal result for the same input on repeated calls", () => {
    const error = makeAxiosLikeError();

    const first = buildSafePlaidErrorDiagnostics(error);
    const second = buildSafePlaidErrorDiagnostics(error);

    expect(first).toEqual(second);
    expect(first).not.toBe(second); // a fresh object every time
  });
});

// H — the read side. These exist because the judgment they replace
// (`error.message.includes("ITEM_LOGIN_REQUIRED")`) could never match: axios
// builds the message as "Request failed with status code 400".
describe("getPlaidErrorCode — H: reads the code the message never carried", () => {
  it("reads the code after the real redaction pipeline has run", () => {
    // Not a hand-built fixture: the error is passed through the same function
    // the interceptor calls, so this proves producer and reader agree.
    const redacted = redactPlaidAxiosError(makeAxiosLikeError());

    expect(getPlaidErrorCode(redacted)).toBe("ITEM_LOGIN_REQUIRED");
    expect(getPlaidErrorStatus(redacted)).toBe(400);
  });

  it("confirms the message itself carries no code — the original defect", () => {
    const redacted = redactPlaidAxiosError(makeAxiosLikeError()) as Error;

    expect(redacted.message).toBe("Request failed with status code 400");
    expect(redacted.message).not.toContain("ITEM_LOGIN_REQUIRED");
  });

  it("falls back to response.data on an error that never met the interceptor", () => {
    // A second PlaidApi built without plaidHttp, or a direct axios call: no
    // plaidDiagnostics marker, code still at the original location.
    const raw = makeAxiosLikeError();
    expect(raw.plaidDiagnostics).toBeUndefined();

    expect(getPlaidErrorCode(raw)).toBe("ITEM_LOGIN_REQUIRED");
    expect(getPlaidErrorStatus(raw)).toBe(400);
  });

  it("prefers plaidDiagnostics over response.data when both are present", () => {
    const error = makeAxiosLikeError();
    error.plaidDiagnostics = { error_code: "RATE_LIMIT_EXCEEDED", status: 429 };

    expect(getPlaidErrorCode(error)).toBe("RATE_LIMIT_EXCEEDED");
    expect(getPlaidErrorStatus(error)).toBe(429);
  });

  it("returns undefined for non-Plaid errors", () => {
    // A Supabase PostgrestError shape: has `code`, but not a Plaid error_code.
    const supabaseError = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
      details: null,
    };

    expect(getPlaidErrorCode(supabaseError)).toBeUndefined();
    expect(getPlaidErrorCode(new Error("something else broke"))).toBeUndefined();
    expect(getPlaidErrorCode("just a string")).toBeUndefined();
    expect(getPlaidErrorCode(null)).toBeUndefined();
    expect(getPlaidErrorCode(undefined)).toBeUndefined();
    expect(getPlaidErrorStatus(null)).toBeUndefined();
  });

  it("ignores a non-string error_code and a non-number status", () => {
    const error = makeAxiosLikeError({
      responseData: { error_code: { nested: SENTINEL_SECRET } },
    });
    (error.response as Record<string, unknown>).status = "400";

    expect(getPlaidErrorCode(error)).toBeUndefined();
    expect(getPlaidErrorStatus(error)).toBeUndefined();
  });

  it("never throws, even on an object whose getters throw", () => {
    // Every call site is inside a catch block: a throw here would replace the
    // error being diagnosed and lose the original.
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "plaidDiagnostics", {
      get() {
        throw new Error("hostile getter");
      },
      enumerable: true,
    });

    expect(() => getPlaidErrorCode(hostile)).not.toThrow();
    expect(getPlaidErrorCode(hostile)).toBeUndefined();
    expect(() => getPlaidErrorStatus(hostile)).not.toThrow();
    expect(getPlaidErrorStatus(hostile)).toBeUndefined();
  });

  it("does not mutate the error it reads", () => {
    const error = makeAxiosLikeError();
    const before = JSON.parse(JSON.stringify(error));

    getPlaidErrorCode(error);
    getPlaidErrorStatus(error);

    expect(JSON.parse(JSON.stringify(error))).toEqual(before);
  });
});

// I — the fail-closed branch, entered through the real function.
//
// This describe exists because the fail-closed path is the one place the
// redactor is allowed to discard the original error, and discarding it used to
// discard the Plaid judgment with it: the replacement carried the message
// alone, so the code was unreadable, a re-auth failure became a generic 500
// instead of a re-link prompt, and in a route that judges connections one at a
// time it sank the whole request.
//
// Every case below is produced by calling redactPlaidAxiosError itself. A
// hand-built fallback would stay green whether or not the recovery works, which
// is exactly the blindness this replaces.
describe("redactPlaidAxiosError — I: the fail-closed replacement stays diagnosable", () => {
  beforeEach(() => {
    // The failure path logs its own decision line; keep the output readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a replacement, not the original, when a write throws", () => {
    const error = makeHostileAxiosLikeError("config");

    const result = redactPlaidAxiosError(error) as Error;

    expect(result).not.toBe(error);
    expect(result instanceof Error).toBe(true);
    expect(result.name).toBe("PlaidRedactionFailure");
  });

  it("carries no credential into the replacement", () => {
    const error = makeHostileAxiosLikeError("config");
    // Precondition: unredacted, the sentinels ARE reachable at unlimited depth.
    expect(serializeDeeply(error)).toContain(SENTINEL_SECRET);

    const serialized = serializeDeeply(redactPlaidAxiosError(error));

    expect(serialized).not.toContain(SENTINEL_SECRET);
    expect(serialized).not.toContain(SENTINEL_CLIENT_ID);
    expect(serialized).not.toContain(SENTINEL_TOKEN);
  });

  it("reuses the summary it had already built when a write throws", () => {
    const result = redactPlaidAxiosError(
      makeHostileAxiosLikeError("config")
    ) as Error & Record<string, unknown>;

    expect(getPlaidErrorCode(result)).toBe("ITEM_LOGIN_REQUIRED");
    expect(getPlaidErrorStatus(result)).toBe(400);
    // Which branch produced this, asserted rather than assumed: only the pure
    // builder derives a path, an upper-cased method or an error_type, so their
    // presence rules out the second-read recovery further down.
    expect(result.plaidDiagnostics).toMatchObject({
      path: "/accounts/get",
      method: "POST",
      error_type: "ITEM_ERROR",
    });
  });

  it("reuses the same summary whichever write throws", () => {
    // Kept even though it reaches the catch block through the same branch as
    // the case above, because what it pins is different: that the reuse does
    // not depend on WHICH write threw. Here config/request/response on the
    // original were already replaced before the throw, so an edit that moved
    // the summary's construction below the writes, or rebuilt it inside the
    // catch block, would change this result while leaving the one above green.
    const late = redactPlaidAxiosError(
      makeHostileAxiosLikeError("plaidDiagnostics")
    ) as Error & Record<string, unknown>;
    const first = redactPlaidAxiosError(
      makeHostileAxiosLikeError("config")
    ) as Error & Record<string, unknown>;

    expect(getPlaidErrorCode(late)).toBe("ITEM_LOGIN_REQUIRED");
    expect(getPlaidErrorStatus(late)).toBe(400);
    expect(late.plaidDiagnostics).toEqual(first.plaidDiagnostics);
  });

  it("rebuilds a summary from a second read when none could be built", () => {
    // The catch block's other recovery. The builder throws here, so there is no
    // summary to reuse and the code and the status have to be read off the
    // failing object again. Asserting the recovered object exactly — not just
    // the two values — is what proves this went through the second read: it is
    // deliberately smaller than anything the builder produces.
    const error = makeUnsummarizableAxiosLikeError();
    expect(serializeDeeply(error)).toContain(SENTINEL_SECRET);

    const result = redactPlaidAxiosError(error) as Error &
      Record<string, unknown>;

    expect(result).not.toBe(error);
    expect(result.name).toBe("PlaidRedactionFailure");
    expect(result.plaidDiagnostics).toEqual({
      redacted: true,
      message: "Request failed with status code 400",
      error_code: "ITEM_LOGIN_REQUIRED",
      status: 400,
    });
    expect(getPlaidErrorCode(result)).toBe("ITEM_LOGIN_REQUIRED");
    expect(getPlaidErrorStatus(result)).toBe(400);
    expect(console.error).toHaveBeenCalledWith(
      "[plaid-redaction] failed-closed code=ITEM_LOGIN_REQUIRED status=400"
    );
    expect(serializeDeeply(result)).not.toContain(SENTINEL_SECRET);
    expect(serializeDeeply(result)).not.toContain(SENTINEL_CLIENT_ID);
    expect(serializeDeeply(result)).not.toContain(SENTINEL_TOKEN);
  });

  it("takes the second read one field at a time", () => {
    // The same failure over a body carrying no error_code. The second read
    // keeps whatever it can reach; recovering the status is not conditional on
    // recovering the code, and a partial recovery still beats none.
    const result = redactPlaidAxiosError(
      makeUnsummarizableAxiosLikeError({ responseData: {} })
    ) as Error & Record<string, unknown>;

    expect(result.plaidDiagnostics).toEqual({
      redacted: true,
      message: "Request failed with status code 400",
      status: 400,
    });
    expect(getPlaidErrorCode(result)).toBeUndefined();
    expect(getPlaidErrorStatus(result)).toBe(400);
    expect(console.error).toHaveBeenCalledWith(
      "[plaid-redaction] failed-closed code=none status=400"
    );
  });

  it("recovers the fields independently of each other", () => {
    // A body with no error_code still has a status. Recovering one must not be
    // conditional on recovering the other.
    const result = redactPlaidAxiosError(
      makeHostileAxiosLikeError("config", { responseData: {} })
    );

    expect(getPlaidErrorCode(result)).toBeUndefined();
    expect(getPlaidErrorStatus(result)).toBe(400);
  });

  it("recovers nothing, and invents nothing, when every read fails", () => {
    const error = makeUnreadableAxiosLikeError();

    const result = redactPlaidAxiosError(error) as Error &
      Record<string, unknown>;

    expect(result).not.toBe(error);
    expect(result.name).toBe("PlaidRedactionFailure");
    expect(result.message).toBe("Request failed with status code 400");
    expect(result.plaidDiagnostics).toBeUndefined();
    expect(getPlaidErrorCode(result)).toBeUndefined();
    expect(getPlaidErrorStatus(result)).toBeUndefined();
    expect(serializeDeeply(result)).not.toContain(SENTINEL_SECRET);
    expect(serializeDeeply(result)).not.toContain(SENTINEL_TOKEN);
  });

  it("announces the fail-closed decision, since nothing downstream can", () => {
    // Once the code is recovered, handlePlaidError's line is identical to a
    // normal failure's, and a per-connection loop skips the error without
    // logging at all. This line is the only remaining signal.
    redactPlaidAxiosError(makeHostileAxiosLikeError("config"));

    expect(console.error).toHaveBeenCalledWith(
      "[plaid-redaction] failed-closed code=ITEM_LOGIN_REQUIRED status=400"
    );
  });

  it("says so plainly when it recovered nothing", () => {
    redactPlaidAxiosError(makeUnreadableAxiosLikeError());

    expect(console.error).toHaveBeenCalledWith(
      "[plaid-redaction] failed-closed code=none status=none"
    );
  });
});
