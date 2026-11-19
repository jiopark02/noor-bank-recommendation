import { describe, expect, it } from "vitest";
import type { SessionReadResult } from "../supabase-browser";
import {
  classifyRelinkResponse,
  linkExitedWithError,
  requestRelinkToken,
  type RelinkResponse,
} from "../plaidRelinkFlow";
import { relinkNoticeMessage } from "../relinkNotice";

/**
 * plaidRelinkFlow, executed: whether the re-link request is sent, which notice
 * a refusal becomes, and what is kept when Link closes. Every dependency is a fake that records its calls,
 * so "was not sent" is observed.
 *
 * The bodies below are written here. That they are what the route really
 * sends is held by plaidRelinkFailureBodies.test.ts, which runs the route.
 *
 * Mutations that turn this file red:
 *   - the request sent before the session is read, or without
 *     a session's access token                                  -> "nothing is sent without a session"
 *   - a session read that gave no answer told as an ended
 *     session                                                   -> "nothing is sent without a session"
 *   - the request sent with anything but the session's token    -> "the request carries the session's token"
 *   - every 401 read as the session's                           -> "a 401 from Plaid's refusal"
 *   - every 401 read as Plaid's                                 -> "a 401 with no Plaid mark"
 *   - a 401 read as the session's on a missing errorType
 *     alone, whatever code it carries                           -> "a 401 carrying only a code"
 *   - ITEM_NOT_FOUND dropped from the refused codes, or the
 *     status decided before the code                            -> "ITEM_NOT_FOUND, whatever its status"
 *   - a 404 or a 500 given another notice                       -> "an absent row", "everything else"
 *   - a rejected request, or an answer with no token, thrown    -> "never throws"
 *   - a sentence changed, or the server's own sentence shown    -> "the sentences"
 *   - Link closing with an error read as the user closing it,
 *     or the reverse                                            -> "an error is true"
 *   - a property of Link's exit error read                      -> "no property of the error is read"
 */

function session(accessToken: string): SessionReadResult {
  return {
    status: "session",
    session: { access_token: accessToken, user: { id: "user-1" } },
  } as unknown as SessionReadResult;
}

const NONE: SessionReadResult = { status: "none" };
const TIMED_OUT: SessionReadResult = { status: "unavailable", reason: "timeout", elapsedMs: 3000 };
const NOT_CONFIGURED: SessionReadResult = {
  status: "unavailable",
  reason: "not-configured",
  elapsedMs: 0,
};

type Answer = RelinkResponse | "no-response";

function harness(reads: SessionReadResult[], answers: Answer[] = []) {
  const posts: Array<{ accessToken: string; itemId: string }> = [];
  const order: string[] = [];
  const deps = {
    readSession: async () => {
      order.push("read");
      const next = reads.shift();
      if (!next) throw new Error("test: no session read queued");
      return next;
    },
    sleep: async () => {},
    post: async (accessToken: string, itemId: string) => {
      order.push("post");
      posts.push({ accessToken, itemId });
      const next = answers.shift();
      if (!next) throw new Error("test: no answer queued");
      if (next === "no-response") throw new TypeError("Failed to fetch");
      return next;
    },
  };
  return { deps, posts, order };
}

const UNAUTHORIZED = { status: 401, body: { error: "Unauthorized" } };
const INVALID_ACCESS_TOKEN = {
  status: 401,
  body: {
    error: "Bank connection expired. Please re-link your account.",
    errorType: "ITEM_LOGIN_REQUIRED",
    errorCode: "INVALID_ACCESS_TOKEN",
  },
};
const itemNotFound = (status: number) => ({
  status,
  body: {
    error: "There was a problem reaching your bank. Please try again.",
    errorType: "PLAID_ERROR",
    errorCode: "ITEM_NOT_FOUND",
  },
});
const NOT_FOUND = { status: 404, body: { error: "Connection not found" } };
const READ_FAILED = {
  status: 500,
  body: {
    error: "We couldn't start re-linking right now. Please try again in a moment.",
    code: "CONNECTION_READ_FAILED",
  },
};
/** What a failed decrypt, or any other throw with no Plaid code, is answered with. */
const UNCODED_500 = {
  status: 500,
  body: { error: "There was a problem reaching your bank. Please try again." },
};

describe("nothing is sent without a session", () => {
  it("no session: no request, and the notice is the ended session", async () => {
    const { deps, posts } = harness([NONE]);
    expect(await requestRelinkToken(deps, "item-1")).toEqual({
      ok: false,
      kind: "session_ended",
    });
    expect(posts).toEqual([]);
  });

  it("a session read that never answers: no request, and it is not called an ended session", async () => {
    const { deps, posts } = harness([TIMED_OUT, TIMED_OUT, TIMED_OUT]);
    expect(await requestRelinkToken(deps, "item-1")).toEqual({
      ok: false,
      kind: "start_failed",
    });
    expect(posts).toEqual([]);
  });

  it("a client that is not configured: no request", async () => {
    const { deps, posts } = harness([NOT_CONFIGURED]);
    expect(await requestRelinkToken(deps, "item-1")).toEqual({
      ok: false,
      kind: "start_failed",
    });
    expect(posts).toEqual([]);
  });

  it("a session with an empty access token: no request", async () => {
    const { deps, posts } = harness([session("")]);
    expect(await requestRelinkToken(deps, "item-1")).toEqual({
      ok: false,
      kind: "start_failed",
    });
    expect(posts).toEqual([]);
  });

  it("a session read that throws: no request, and nothing is thrown on", async () => {
    const { deps, posts } = harness([]);
    expect(await requestRelinkToken(deps, "item-1")).toEqual({
      ok: false,
      kind: "start_failed",
    });
    expect(posts).toEqual([]);
  });
});

describe("the request carries the session's token", () => {
  it("is sent once, after the session read, with that token and the item asked for", async () => {
    const { deps, posts, order } = harness(
      [TIMED_OUT, session("access-sentinel-7c2")],
      [{ status: 200, body: { success: true, linkToken: "link-update-1" } }]
    );
    expect(await requestRelinkToken(deps, "item-9")).toEqual({
      ok: true,
      token: "link-update-1",
    });
    expect(posts).toEqual([{ accessToken: "access-sentinel-7c2", itemId: "item-9" }]);
    expect(order).toEqual(["read", "read", "post"]);
  });
});

describe("which notice a refusal becomes", () => {
  it("a 401 with no Plaid mark is the session's", () => {
    expect(classifyRelinkResponse(UNAUTHORIZED.status, UNAUTHORIZED.body)).toBe("session_ended");
    expect(classifyRelinkResponse(401, {})).toBe("session_ended");
  });

  it("a 401 from Plaid's refusal of the token is not the session's", () => {
    expect(
      classifyRelinkResponse(INVALID_ACCESS_TOKEN.status, INVALID_ACCESS_TOKEN.body)
    ).toBe("token_refused");
  });

  it("ITEM_NOT_FOUND is the token's refusal, whatever its status", () => {
    for (const status of [400, 401, 404, 500]) {
      const answer = itemNotFound(status);
      expect(classifyRelinkResponse(answer.status, answer.body), String(status)).toBe(
        "token_refused"
      );
    }
  });

  it("a 401 carrying another Plaid code is neither", () => {
    expect(
      classifyRelinkResponse(401, {
        error: "Bank connection expired. Please re-link your account.",
        errorType: "ITEM_LOGIN_REQUIRED",
        errorCode: "ITEM_LOGIN_REQUIRED",
      })
    ).toBe("start_failed");
    expect(classifyRelinkResponse(401, { errorType: "PLAID_ERROR" })).toBe("start_failed");
  });

  it("a 401 carrying only a code, and not one of the refused-token codes, is not the session's", () => {
    // No errorType here: the code alone marks the answer as Plaid's.
    expect(
      classifyRelinkResponse(401, { error: "x", errorCode: "SOME_OTHER_PLAID_CODE" })
    ).toBe("start_failed");
  });

  it("an absent row is the bank no longer linked", () => {
    expect(classifyRelinkResponse(NOT_FOUND.status, NOT_FOUND.body)).toBe("not_linked");
  });

  it("everything else is a failed start", () => {
    const others: RelinkResponse[] = [
      READ_FAILED,
      UNCODED_500,
      { status: 503, body: { error: "Plaid is not configured" } },
      {
        status: 503,
        body: {
          error: "Something went wrong on our end. Please check back in a moment.",
          code: "ADMIN_UNCONFIGURED",
        },
      },
      {
        status: 429,
        body: {
          error: "Too many requests to your bank. Please try again in a few minutes.",
          errorType: "RATE_LIMIT_EXCEEDED",
          errorCode: "RATE_LIMIT_EXCEEDED",
        },
      },
      { status: 400, body: { error: "Item ID is required" } },
      {
        status: 400,
        body: {
          error: "There was a problem reaching your bank. Please try again.",
          errorType: "PLAID_ERROR",
          errorCode: "SOME_PLAID_CODE",
        },
      },
      // A code that is not a string names nothing.
      { status: 500, body: { errorCode: ["ITEM_NOT_FOUND"] } },
    ];
    for (const answer of others) {
      expect(
        classifyRelinkResponse(answer.status, answer.body),
        JSON.stringify(answer)
      ).toBe("start_failed");
    }
  });

  it("the request's result is the notice for the answer it got", async () => {
    const cases: Array<[Answer, string]> = [
      [UNAUTHORIZED, "session_ended"],
      [INVALID_ACCESS_TOKEN, "token_refused"],
      [itemNotFound(400), "token_refused"],
      [NOT_FOUND, "not_linked"],
      [READ_FAILED, "start_failed"],
      [UNCODED_500, "start_failed"],
    ];
    for (const [answer, kind] of cases) {
      const { deps, posts } = harness([session("access-1")], [answer]);
      expect(await requestRelinkToken(deps, "item-1"), kind).toEqual({ ok: false, kind });
      expect(posts).toHaveLength(1);
    }
  });
});

describe("never throws", () => {
  it("a request that got no response is a failed start", async () => {
    const { deps } = harness([session("access-1")], ["no-response"]);
    expect(await requestRelinkToken(deps, "item-1")).toEqual({
      ok: false,
      kind: "start_failed",
    });
  });

  it("a success with no usable token is a failed start", async () => {
    for (const body of [{ success: true }, { success: true, linkToken: "" }, { linkToken: 7 }]) {
      const { deps } = harness([session("access-1")], [{ status: 200, body }]);
      expect(await requestRelinkToken(deps, "item-1")).toEqual({
        ok: false,
        kind: "start_failed",
      });
    }
  });
});

describe("the sentences", () => {
  it("are the agreed ones, naming the bank where they have a place for it", () => {
    expect(relinkNoticeMessage("session_ended", "Bank 2")).toBe(
      "Your session ended. Sign in again, then re-link this bank."
    );
    expect(relinkNoticeMessage("token_refused", "Bank 2")).toBe(
      "We can't re-link Bank 2. Remove it under Accounts, then connect it again."
    );
    expect(relinkNoticeMessage("not_linked", "Bank 2")).toBe(
      "This bank is no longer linked. Refresh the page to see your current banks."
    );
    expect(relinkNoticeMessage("start_failed", "Bank 2")).toBe(
      "We couldn't start re-linking Bank 2. Please try again in a moment."
    );
    expect(relinkNoticeMessage("link_exit_error", "Bank 2")).toBe(
      "We couldn't finish re-linking Bank 2. Please try again."
    );
  });

  it("no sentence is the server's own", () => {
    const served = [
      UNAUTHORIZED.body.error,
      INVALID_ACCESS_TOKEN.body.error,
      NOT_FOUND.body.error,
      READ_FAILED.body.error,
      UNCODED_500.body.error,
    ];
    for (const kind of [
      "session_ended",
      "token_refused",
      "not_linked",
      "start_failed",
      "link_exit_error",
    ] as const) {
      expect(served).not.toContain(relinkNoticeMessage(kind, "Bank 2"));
    }
  });
});

describe("what is kept when Link closes", () => {
  it("an error is true; the user closing Link is false", () => {
    expect(
      linkExitedWithError({
        error_type: "ITEM_ERROR",
        error_code: "SOME_CODE",
        error_message: "sentinel message",
        display_message: "sentinel display",
      })
    ).toBe(true);
    expect(linkExitedWithError({})).toBe(true);
    expect(linkExitedWithError(null)).toBe(false);
    expect(linkExitedWithError(undefined)).toBe(false);
  });

  it("no property of the error is read", () => {
    const touched: string[] = [];
    const refuse = (trap: string) => {
      touched.push(trap);
      throw new Error(`test: the exit error was touched (${trap})`);
    };
    const guarded = new Proxy(
      {},
      {
        get: (_target, key) => refuse(`get ${String(key)}`),
        has: (_target, key) => refuse(`has ${String(key)}`),
        ownKeys: () => refuse("ownKeys"),
        getOwnPropertyDescriptor: (_target, key) => refuse(`describe ${String(key)}`),
        getPrototypeOf: () => refuse("getPrototypeOf"),
      }
    );
    expect(linkExitedWithError(guarded)).toBe(true);
    expect(touched).toEqual([]);
  });

  it("the answer is a boolean and carries nothing of the error", () => {
    const answer = linkExitedWithError({ error_message: "sentinel message" });
    expect(typeof answer).toBe("boolean");
    expect(JSON.stringify(answer)).toBe("true");
  });
});
