import { inspect } from "node:util";
import { describe, it, expect } from "vitest";
import {
  buildSafePlaidErrorDiagnostics,
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
