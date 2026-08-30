import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectionRowsOrNull, handlePlaidError } from "../plaidApiUtils";
import { redactPlaidAxiosError } from "../plaidErrorRedaction";

/**
 * These tests exist because the judgment handlePlaidError used to make could
 * never succeed. The Plaid SDK rejects with an AxiosError whose message axios
 * builds as "Request failed with status code <n>", so matching the message
 * against "ITEM_LOGIN_REQUIRED" always failed and every Plaid error — expired
 * bank connection, wrong API keys, rate limit — collapsed into one 500 that
 * showed the user the axios string.
 *
 * The fixtures below are therefore built the way axios really builds an error,
 * and pushed through the real redaction function, so a regression in either the
 * producer or the reader fails here.
 */

/** An axios-shaped Plaid error carrying `code` in the response body. */
function makePlaidError(
  code: string | undefined,
  status = 400
): Error & Record<string, unknown> {
  const error = new Error(
    `Request failed with status code ${status}`
  ) as Error & Record<string, unknown>;
  error.name = "AxiosError";
  error.isAxiosError = true;
  error.config = {
    url: "https://sandbox.plaid.com/accounts/get",
    method: "post",
    headers: { "PLAID-SECRET": "FAKE_SECRET_never_real" },
  };
  error.response = {
    status,
    statusText: "Bad Request",
    data: code ? { error_type: "ITEM_ERROR", error_code: code } : {},
  };
  return error;
}

/** The same error after the interceptor in plaid.ts has processed it. */
function makeRedactedPlaidError(code: string | undefined, status = 400) {
  return redactPlaidAxiosError(makePlaidError(code, status));
}

async function readResponse(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

beforeEach(() => {
  // handlePlaidError logs a decision line; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handlePlaidError — re-auth codes", () => {
  it("maps ITEM_LOGIN_REQUIRED to 401 with the re-link errorType", async () => {
    const { status, body } = await readResponse(
      handlePlaidError(makeRedactedPlaidError("ITEM_LOGIN_REQUIRED"))
    );

    expect(status).toBe(401);
    expect(body.errorType).toBe("ITEM_LOGIN_REQUIRED");
    expect(body.errorCode).toBe("ITEM_LOGIN_REQUIRED");
    expect(body.error).toBe(
      "Bank connection expired. Please re-link your account."
    );
  });

  it("normalises INVALID_ACCESS_TOKEN onto the same errorType", async () => {
    // The frontend has one re-link branch, keyed on ITEM_LOGIN_REQUIRED. This
    // normalisation is what keeps money/page.tsx free of a second branch.
    const { status, body } = await readResponse(
      handlePlaidError(makeRedactedPlaidError("INVALID_ACCESS_TOKEN"))
    );

    expect(status).toBe(401);
    expect(body.errorType).toBe("ITEM_LOGIN_REQUIRED");
    // The original code is still reported for diagnosis, unnormalised.
    expect(body.errorCode).toBe("INVALID_ACCESS_TOKEN");
  });

  it("works on an un-redacted error too, reading response.data directly", async () => {
    const { status, body } = await readResponse(
      handlePlaidError(makePlaidError("ITEM_LOGIN_REQUIRED"))
    );

    expect(status).toBe(401);
    expect(body.errorType).toBe("ITEM_LOGIN_REQUIRED");
  });
});

// The reason this whole change exists in a reviewable form: a configuration
// failure must never be presented to the user as an expired bank connection.
describe("handlePlaidError — INVALID_API_KEYS must not reach the re-link path", () => {
  it("maps INVALID_API_KEYS to 500 and NOT to ITEM_LOGIN_REQUIRED", async () => {
    const { status, body } = await readResponse(
      handlePlaidError(makeRedactedPlaidError("INVALID_API_KEYS"))
    );

    expect(status).toBe(500);
    expect(body.errorType).not.toBe("ITEM_LOGIN_REQUIRED");
    expect(body.errorType).toBe("CONFIGURATION_ERROR");
    expect(body.errorCode).toBe("INVALID_API_KEYS");
  });

  it("does not word the message as a connection problem the user can fix", async () => {
    const { body } = await readResponse(
      handlePlaidError(makeRedactedPlaidError("INVALID_API_KEYS"))
    );

    const message = String(body.error).toLowerCase();
    expect(message).not.toContain("re-link");
    expect(message).not.toContain("relink");
    expect(message).not.toContain("reconnect");
    expect(message).not.toContain("expired");
  });

  it("is not reachable through the re-link branch by any unmapped code", async () => {
    // Allow-list proof: only the two re-auth codes may produce the re-link
    // type. Anything else — including codes that merely sound related — must
    // not acquire it.
    const others = [
      "INVALID_API_KEYS",
      "INVALID_CREDENTIALS",
      "ITEM_NOT_FOUND",
      "ITEM_LOCKED",
      "PRODUCTS_NOT_SUPPORTED",
      "INTERNAL_SERVER_ERROR",
      "RATE_LIMIT_EXCEEDED",
    ];

    for (const code of others) {
      const { body } = await readResponse(
        handlePlaidError(makeRedactedPlaidError(code))
      );
      expect(body.errorType, `${code} must not map to the re-link type`).not.toBe(
        "ITEM_LOGIN_REQUIRED"
      );
    }
  });
});

describe("handlePlaidError — rate limiting and unmapped codes", () => {
  it("maps RATE_LIMIT_EXCEEDED to 429", async () => {
    const { status, body } = await readResponse(
      handlePlaidError(makeRedactedPlaidError("RATE_LIMIT_EXCEEDED", 429))
    );

    expect(status).toBe(429);
    expect(body.errorType).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("surfaces Plaid's own status for an unmapped 4xx", async () => {
    const { status, body } = await readResponse(
      handlePlaidError(makeRedactedPlaidError("PRODUCTS_NOT_SUPPORTED", 400))
    );

    expect(status).toBe(400);
    expect(body.errorType).toBe("PLAID_ERROR");
    expect(body.errorCode).toBe("PRODUCTS_NOT_SUPPORTED");
  });

  it("collapses an unmapped Plaid 5xx into a 500", async () => {
    const { status, body } = await readResponse(
      handlePlaidError(makeRedactedPlaidError("INTERNAL_SERVER_ERROR", 503))
    );

    expect(status).toBe(500);
    expect(body.errorType).toBe("PLAID_ERROR");
  });
});

describe("handlePlaidError — non-Plaid errors", () => {
  it("maps a Supabase error to 500 with no errorType and no errorCode", async () => {
    const supabaseError = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
      details: null,
    };

    const { status, body } = await readResponse(
      handlePlaidError(supabaseError)
    );

    expect(status).toBe(500);
    expect(body.errorType).toBeUndefined();
    // PGRST116 is a PostgREST code, not a Plaid one — it must not be echoed
    // into a field named errorCode.
    expect(body.errorCode).toBeUndefined();
  });

  it("maps a plain Error to 500 without leaking its message", async () => {
    const { status, body } = await readResponse(
      handlePlaidError(new Error("connect ECONNREFUSED 10.0.0.1:5432"))
    );

    expect(status).toBe(500);
    expect(body.error).toBe(
      "There was a problem reaching your bank. Please try again."
    );
    expect(String(body.error)).not.toContain("ECONNREFUSED");
  });

  it("never puts the axios status-code string in front of the user", async () => {
    // The exact regression this change removes.
    for (const error of [
      makeRedactedPlaidError("ITEM_LOGIN_REQUIRED"),
      makeRedactedPlaidError("INVALID_API_KEYS"),
      makeRedactedPlaidError(undefined),
      new Error("Request failed with status code 400"),
    ]) {
      const { body } = await readResponse(handlePlaidError(error));
      expect(String(body.error)).not.toContain("status code");
    }
  });

  it("does not throw on a thrown primitive or null", async () => {
    expect(() => handlePlaidError("just a string")).not.toThrow();
    expect(() => handlePlaidError(null)).not.toThrow();
    expect(() => handlePlaidError(undefined)).not.toThrow();

    const { status } = await readResponse(handlePlaidError(null));
    expect(status).toBe(500);
  });
});

describe("handlePlaidError — response body never carries credentials", () => {
  it("emits only the mapped fields", async () => {
    const { body } = await readResponse(
      handlePlaidError(makeRedactedPlaidError("ITEM_LOGIN_REQUIRED"))
    );

    expect(Object.keys(body).sort()).toEqual([
      "error",
      "errorCode",
      "errorType",
    ]);
    expect(JSON.stringify(body)).not.toContain("FAKE_SECRET_never_real");
  });
});

/**
 * The distinction this suite exists to hold: a failed connection read and a user
 * with no connections are different states. They used to be the same empty
 * array, so every caller reported a database hiccup as "no bank connected" —
 * which on the money screen shows the connect-a-bank card to an already
 * connected user and invites a duplicate connection row, and on the dashboard
 * clears the cached accounts and transactions.
 *
 * connectionRowsOrNull is the pure decision behind getAllPlaidConnections, so
 * these assertions need no database and no mock. Revert the helper to the old
 * `if (error || !data) return []` and the first two cases below demand the same
 * value for opposite inputs — at least one must go red.
 */
describe("connectionRowsOrNull — a failed read is not an empty one", () => {
  it("reports a query error as a failure, not as an empty result", () => {
    const supabaseError = {
      code: "PGRST301",
      message: "JWT expired",
      details: null,
    };

    expect(connectionRowsOrNull({ data: null, error: supabaseError })).toBeNull();
  });

  it("reports a genuine zero-row read as an empty success", () => {
    // Distinguishable from the case above: [] is a value, null is the absence
    // of one. A caller can branch on it; it could not branch on [] vs [].
    expect(connectionRowsOrNull({ data: [], error: null })).toEqual([]);
  });

  it("prefers failure over empty when an error arrives alongside rows", () => {
    expect(
      connectionRowsOrNull({ data: [{ item_id: "item_1" }], error: new Error("boom") })
    ).toBeNull();
  });

  it("returns the rows unchanged and in order", () => {
    const rows = [{ item_id: "newest" }, { item_id: "oldest" }];

    expect(connectionRowsOrNull({ data: rows, error: null })).toEqual(rows);
  });

  it("keeps inactive rows — filtering is the caller's job", () => {
    // account/delete depends on this: it revokes the Plaid Item for every
    // connection, including ones marked errored, and the row is deleted straight
    // afterwards, so a connection dropped here can never be revoked at all.
    const rows = [
      { item_id: "item_1", status: "active" },
      { item_id: "item_2", status: "error" },
    ];

    expect(connectionRowsOrNull({ data: rows, error: null })).toHaveLength(2);
  });

  it("treats a response that is neither an error nor an array as a failure", () => {
    // Not a shape PostgREST produces for a list query. "We don't know" is the
    // only honest reading, and it is the direction that cannot invent an answer.
    expect(connectionRowsOrNull({ data: null, error: null })).toBeNull();
  });
});
