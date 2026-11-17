import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionReadResult } from "../supabase-browser";
import {
  CONNECTION_TIMED_OUT_MESSAGE,
  EXCHANGE_FALLBACK_MESSAGE,
  EXCHANGE_RETRY_MESSAGE,
  LINK_SIGN_IN_UNCONFIRMED_MESSAGE,
  PLAID_CONNECT_SESSION_RETRY,
  PUBLIC_TOKEN_MAX_AGE_MS,
  SESSION_ENDED_MESSAGE,
  activeInstitutionIds,
  classifyExchangeResponse,
  createPublicTokenHolder,
  linkTokenRefusalMessage,
  linkTokenSession,
  readPlaidSession,
  type ConnectionSummary,
  type ExchangePayload,
} from "../plaidConnectFlow";

/**
 * plaidConnectFlow, executed: when the public token Plaid Link hands over is
 * sent, kept, sent again, or dropped. Every dependency is a fake that records
 * its calls, so "was not sent" is observed.
 *
 * Mutations that turn this file red:
 *   - a send made without a session's access token             -> "nothing is sent without a session"
 *   - a link-token request allowed without one                 -> "link token: no token, no request"
 *   - "none" read again, or the plan's times changed           -> "the session is read until it answers"
 *   - the age limit removed, raised, or skipped on a resend    -> "a token older than the limit", "a pressed retry is held to"
 *   - the user comparison removed, or skipped on a resend      -> "another user in the session", "a pressed retry is held to"
 *   - any 503 or any 401 treated as resendable                 -> "which answers leave the token to send again"
 *   - the token kept after an answer that ends it              -> "an answer that ends the token"
 *   - the request sent again by itself after no response       -> "no response: not sent again by itself"
 *   - a bank already active when the token was received
 *     counted as connected by this attempt                     -> "a bank that was already there"
 *   - a spent token's refusal shown in Plaid's or the
 *     server's words, or the list not read                     -> "a resend Plaid refuses"
 *   - the server's sentence shown for a resendable answer      -> "which answers leave the token to send again"
 *   - one of the three sentences changed                       -> "the sentences"
 *   - the token written to a log, to storage or to an outcome  -> "the token goes nowhere but the request body"
 */

const TOKEN = "public-sentinel-4be1";
const BANK = { name: "Test Bank", institution_id: "ins_1" };

function session(userId: string): SessionReadResult {
  return {
    status: "session",
    session: { access_token: `access-${userId}`, user: { id: userId } },
  } as unknown as SessionReadResult;
}

const NONE: SessionReadResult = { status: "none" };
const TIMED_OUT: SessionReadResult = { status: "unavailable", reason: "timeout", elapsedMs: 3000 };

type Answer = { status: number; body: Record<string, unknown> } | "no-response";

function harness() {
  const clock = { now: 1_000_000 };
  const reads: SessionReadResult[] = [];
  const answers: Answer[] = [];
  const lists: Array<ConnectionSummary[] | null | "throw"> = [];
  const posts: Array<{ accessToken: string; payload: ExchangePayload }> = [];
  const listReads: string[] = [];
  const readCalls: Array<{ timeoutMs: number; attempt: number }> = [];
  const sleeps: number[] = [];

  const holder = createPublicTokenHolder({
    readSession: async (timeoutMs, attempt) => {
      readCalls.push({ timeoutMs, attempt });
      const next = reads.shift();
      if (!next) throw new Error("test: no session read queued");
      return next;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => clock.now,
    post: async (accessToken, payload) => {
      posts.push({ accessToken, payload });
      const next = answers.shift();
      if (!next) throw new Error("test: no answer queued");
      if (next === "no-response") throw new TypeError("Failed to fetch");
      return next;
    },
    readConnections: async (accessToken) => {
      listReads.push(accessToken);
      const next = lists.shift();
      if (next === undefined) throw new Error("test: no list queued");
      if (next === "throw") throw new TypeError("Failed to fetch");
      return next;
    },
  });

  return { holder, clock, reads, answers, lists, posts, listReads, readCalls, sleeps };
}

const OK = { status: 200, body: { success: true, itemId: "item-1" } };
const UNAUTHORIZED = { status: 401, body: { error: "Unauthorized" } };
const PLAID_REFUSED = {
  status: 400,
  body: {
    error: "There was a problem reaching your bank. Please try again.",
    errorType: "PLAID_ERROR",
    errorCode: "SOME_PLAID_CODE",
  },
};
const ACTIVE_BANK: ConnectionSummary[] = [{ institutionId: "ins_1", status: "active" }];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the sentences", () => {
  it("are the three agreed ones", () => {
    expect(EXCHANGE_RETRY_MESSAGE).toBe("We couldn't finish connecting your bank. Try again.");
    expect(SESSION_ENDED_MESSAGE).toBe(
      "Your session ended. Sign in again, then connect your bank."
    );
    expect(CONNECTION_TIMED_OUT_MESSAGE).toBe(
      "This connection timed out. Connect your bank again."
    );
  });

  it("the token is kept for twenty-five minutes", () => {
    expect(PUBLIC_TOKEN_MAX_AGE_MS).toBe(25 * 60 * 1000);
  });
});

describe("the session is read until it answers", () => {
  it("the plan is three reads of three seconds, ten seconds in all", () => {
    const { timeoutsMs, gapsMs } = PLAID_CONNECT_SESSION_RETRY;
    expect(timeoutsMs).toEqual([3000, 3000, 3000]);
    expect(gapsMs).toEqual([500, 500]);
    let total = 0;
    for (const ms of timeoutsMs) total += ms;
    for (const ms of gapsMs) total += ms;
    expect(total).toBe(10_000);
  });

  it("stops at the first answer, and reads again only while there is none", async () => {
    const run = async (queue: SessionReadResult[]) => {
      const calls: number[] = [];
      const sleeps: number[] = [];
      const result = await readPlaidSession({
        readSession: async (_timeoutMs, attempt) => {
          calls.push(attempt);
          return queue.shift() as SessionReadResult;
        },
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
      return { result, calls, sleeps };
    };

    expect((await run([session("u1")])).calls).toEqual([1]);
    // "none" is an answer: it is not asked again.
    const none = await run([NONE, session("u1")]);
    expect(none.calls).toEqual([1]);
    expect(none.result).toEqual(NONE);

    const late = await run([TIMED_OUT, TIMED_OUT, session("u1")]);
    expect(late.calls).toEqual([1, 2, 3]);
    expect(late.sleeps).toEqual([500, 500]);
    expect(late.result.status).toBe("session");

    const never = await run([TIMED_OUT, TIMED_OUT, TIMED_OUT, session("u1")]);
    expect(never.calls).toEqual([1, 2, 3]);
    expect(never.result.status).toBe("unavailable");
  });
});

describe("link token: no token, no request", () => {
  it("only a session with an access token yields one", () => {
    expect(linkTokenSession(session("u1"))).toEqual({ ok: true, accessToken: "access-u1" });
    expect(linkTokenSession(NONE)).toEqual({ ok: false, message: SESSION_ENDED_MESSAGE });
    expect(linkTokenSession(TIMED_OUT)).toEqual({
      ok: false,
      message: LINK_SIGN_IN_UNCONFIRMED_MESSAGE,
    });
    expect(
      linkTokenSession({
        status: "session",
        session: { access_token: "", user: { id: "u1" } },
      } as unknown as SessionReadResult)
    ).toEqual({ ok: false, message: LINK_SIGN_IN_UNCONFIRMED_MESSAGE });
  });

  it("a refusal over the sign-in gets our sentence; any other keeps the route's", () => {
    expect(linkTokenRefusalMessage(401, { error: "Unauthorized" })).toBe(
      LINK_SIGN_IN_UNCONFIRMED_MESSAGE
    );
    expect(linkTokenRefusalMessage(503, { error: "x", code: "AUTH_UNAVAILABLE" })).toBe(
      LINK_SIGN_IN_UNCONFIRMED_MESSAGE
    );
    expect(linkTokenRefusalMessage(503, { error: "x", code: "ADMIN_UNCONFIGURED" })).toBeNull();
    expect(linkTokenRefusalMessage(503, { error: "x" })).toBeNull();
    expect(linkTokenRefusalMessage(422, { error: "x", code: "CONNECTION_LIMIT_REACHED" })).toBeNull();
    expect(linkTokenRefusalMessage(401, { error: "x", errorType: "ITEM_LOGIN_REQUIRED" })).toBeNull();
  });
});

describe("which answers leave the token to send again", () => {
  const cases: Array<[number, Record<string, unknown>, string]> = [
    [200, { success: true, itemId: "item-1" }, "connected"],
    [200, { success: true }, "refused"],
    [409, { code: "ALREADY_CONNECTED", error: "dup" }, "duplicate"],
    [401, { error: "Unauthorized" }, "resendable"],
    [401, { error: "expired", errorType: "ITEM_LOGIN_REQUIRED" }, "plaid_refused"],
    [503, { error: "x", code: "ADMIN_UNCONFIGURED" }, "resendable"],
    [503, { error: "x", code: "AUTH_UNAVAILABLE" }, "resendable"],
    [503, { error: "Plaid is not configured" }, "resendable"],
    [503, { error: "x", code: "CONNECTION_CHECK_FAILED" }, "refused"],
    [503, { error: "x", code: "INSTITUTION_LOOKUP_FAILED" }, "refused"],
    [400, { error: "Public token is required" }, "refused"],
    [400, { error: "x", errorType: "PLAID_ERROR" }, "plaid_refused"],
    [422, { error: "x", code: "CONNECTION_LIMIT_REACHED" }, "refused"],
    [429, { error: "x", errorType: "RATE_LIMIT_EXCEEDED" }, "plaid_refused"],
    [500, { error: "x", code: "CONNECTION_SAVE_FAILED" }, "refused"],
    [500, {}, "refused"],
    [502, { error: "x", code: "INSTITUTION_ID_MISSING" }, "refused"],
  ];

  it.each(cases)("%i %j is %s", (status, body, kind) => {
    expect(classifyExchangeResponse(status, body)).toBe(kind);
  });

  it("a resendable answer keeps the token, shows our sentence, and the retry sends the same token", async () => {
    for (const first of [
      UNAUTHORIZED,
      { status: 503, body: { error: "server words", code: "AUTH_UNAVAILABLE" } },
      { status: 503, body: { error: "server words", code: "ADMIN_UNCONFIGURED" } },
      { status: 503, body: { error: "Plaid is not configured" } },
    ]) {
      const h = harness();
      h.holder.hold(TOKEN, BANK, "u1", []);
      h.reads.push(session("u1"), session("u1"));
      h.answers.push(first, OK);

      expect(await h.holder.send()).toEqual({
        kind: "notice",
        message: EXCHANGE_RETRY_MESSAGE,
        canRetry: true,
      });
      expect(h.holder.hasToken()).toBe(true);

      expect(await h.holder.send()).toEqual({ kind: "connected" });
      expect(h.posts.map((p) => p.payload.publicToken)).toEqual([TOKEN, TOKEN]);
      expect(h.holder.hasToken()).toBe(false);
      expect(h.listReads).toEqual([]);
    }
  });
});

describe("nothing is sent without a session", () => {
  it("no session in three reads: nothing sent, the token kept", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(TIMED_OUT, TIMED_OUT, TIMED_OUT);

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: EXCHANGE_RETRY_MESSAGE,
      canRetry: true,
    });
    expect(h.posts).toEqual([]);
    expect(h.readCalls.map((c) => c.attempt)).toEqual([1, 2, 3]);
    expect(h.holder.hasToken()).toBe(true);
  });

  it("a session that ended: nothing sent, the token dropped", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(NONE);

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: SESSION_ENDED_MESSAGE,
      canRetry: false,
    });
    expect(h.posts).toEqual([]);
    expect(h.holder.hasToken()).toBe(false);
  });

  it("a session without an access token: nothing sent", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push({
      status: "session",
      session: { access_token: "", user: { id: "u1" } },
    } as unknown as SessionReadResult);

    expect((await h.holder.send()).kind).toBe("notice");
    expect(h.posts).toEqual([]);
  });

  it("every send carries the session's access token", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(TIMED_OUT, session("u1"));
    h.answers.push(OK);

    expect(await h.holder.send()).toEqual({ kind: "connected" });
    expect(h.posts).toEqual([
      {
        accessToken: "access-u1",
        payload: { publicToken: TOKEN, institutionId: "ins_1", institutionName: "Test Bank" },
      },
    ]);
  });

  it("nothing held: nothing read and nothing sent", async () => {
    const h = harness();
    expect(await h.holder.send()).toEqual({ kind: "idle" });
    expect(h.readCalls).toEqual([]);
  });
});

describe("a token older than the limit", () => {
  it("is dropped without a session read or a send", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.clock.now += PUBLIC_TOKEN_MAX_AGE_MS + 1;

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: CONNECTION_TIMED_OUT_MESSAGE,
      canRetry: false,
    });
    expect(h.readCalls).toEqual([]);
    expect(h.posts).toEqual([]);
    expect(h.holder.hasToken()).toBe(false);
  });

  it("is still sent at exactly the limit", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.clock.now += PUBLIC_TOKEN_MAX_AGE_MS;
    h.reads.push(session("u1"));
    h.answers.push(OK);

    expect(await h.holder.send()).toEqual({ kind: "connected" });
  });
});

describe("another user in the session", () => {
  it("the token is dropped and nothing is sent", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u2"));

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: CONNECTION_TIMED_OUT_MESSAGE,
      canRetry: false,
    });
    expect(h.posts).toEqual([]);
    expect(h.holder.hasToken()).toBe(false);
  });

  it("a token held with no known user is bound to the first session's user", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, null, []);
    h.reads.push(session("u1"), session("u2"));
    h.answers.push(UNAUTHORIZED);

    expect((await h.holder.send()).kind).toBe("notice");
    expect(h.posts).toHaveLength(1);

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: CONNECTION_TIMED_OUT_MESSAGE,
      canRetry: false,
    });
    expect(h.posts).toHaveLength(1);
  });
});

describe("an answer that ends the token", () => {
  it("drops it, shows the server's sentence, and a later send does nothing", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"));
    h.answers.push({
      status: 422,
      body: { error: "You can connect up to 5 banks.", code: "CONNECTION_LIMIT_REACHED" },
    });

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: "You can connect up to 5 banks.",
      canRetry: false,
    });
    expect(h.holder.hasToken()).toBe(false);
    expect(await h.holder.send()).toEqual({ kind: "idle" });
    expect(h.posts).toHaveLength(1);
  });

  it("without a sentence from the server, the fallback", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"));
    h.answers.push({ status: 500, body: {} });

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: EXCHANGE_FALLBACK_MESSAGE,
      canRetry: false,
    });
  });

  it("a duplicate names the bank and drops the token", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"));
    h.answers.push({
      status: 409,
      body: { code: "ALREADY_CONNECTED", institutionName: "Server Bank", error: "dup" },
    });

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: "Server Bank is already connected.",
      canRetry: false,
    });
    expect(h.holder.hasToken()).toBe(false);
  });

  it("a first send Plaid refuses is a refusal like any other: no list read", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"));
    h.answers.push(PLAID_REFUSED);

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: "There was a problem reaching your bank. Please try again.",
      canRetry: false,
    });
    expect(h.listReads).toEqual([]);
    expect(h.holder.hasToken()).toBe(false);
  });
});

describe("no response: not sent again by itself", () => {
  it("one send, one list read; the bank is there now, so it is connected", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"));
    h.answers.push("no-response");
    h.lists.push(ACTIVE_BANK);

    expect(await h.holder.send()).toEqual({ kind: "connected" });
    expect(h.posts).toHaveLength(1);
    expect(h.listReads).toEqual(["access-u1"]);
    expect(h.holder.hasToken()).toBe(false);
  });

  it.each<[string, ConnectionSummary[] | null | "throw"]>([
    ["the bank is not in the list", []],
    ["the bank is there but not active", [{ institutionId: "ins_1", status: "error" }]],
    ["another bank is active", [{ institutionId: "ins_2", status: "active" }]],
    ["the list could not be read", null],
    ["the list read got no response", "throw"],
  ])("%s: the token is kept and nothing more is sent", async (_label, list) => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"));
    h.answers.push("no-response");
    h.lists.push(list);

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: EXCHANGE_RETRY_MESSAGE,
      canRetry: true,
    });
    expect(h.posts).toHaveLength(1);
    expect(h.listReads).toHaveLength(1);
    expect(h.holder.hasToken()).toBe(true);
  });

  it("a pressed retry reads the list first, and does not send when the bank is there", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"), session("u1"));
    h.answers.push("no-response");
    h.lists.push([], ACTIVE_BANK);

    expect((await h.holder.send()).kind).toBe("notice");
    expect(await h.holder.send()).toEqual({ kind: "connected" });
    expect(h.posts).toHaveLength(1);
    expect(h.listReads).toHaveLength(2);
  });

  it("a pressed retry sends the same token when the bank is still not there", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"), session("u1"));
    h.answers.push("no-response", OK);
    h.lists.push([], []);

    expect((await h.holder.send()).kind).toBe("notice");
    expect(await h.holder.send()).toEqual({ kind: "connected" });
    expect(h.posts.map((p) => p.payload.publicToken)).toEqual([TOKEN, TOKEN]);
  });

  it("without an institution id nothing can be matched: never counted as connected", async () => {
    const h = harness();
    h.holder.hold(TOKEN, { name: "Test Bank", institution_id: "" }, "u1", []);
    h.reads.push(session("u1"));
    h.answers.push("no-response");

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: EXCHANGE_RETRY_MESSAGE,
      canRetry: true,
    });
    expect(h.listReads).toEqual([]);
  });
});

describe("a pressed retry is held to the same limits", () => {
  it("the age limit", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"));
    h.answers.push("no-response");
    h.lists.push([]);
    expect((await h.holder.send()).kind).toBe("notice");

    h.clock.now += PUBLIC_TOKEN_MAX_AGE_MS + 1;
    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: CONNECTION_TIMED_OUT_MESSAGE,
      canRetry: false,
    });
    expect(h.posts).toHaveLength(1);
    expect(h.listReads).toHaveLength(1);
    expect(h.holder.hasToken()).toBe(false);
  });

  it("the same user", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"), session("u2"));
    h.answers.push("no-response");
    h.lists.push([]);
    expect((await h.holder.send()).kind).toBe("notice");

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: CONNECTION_TIMED_OUT_MESSAGE,
      canRetry: false,
    });
    expect(h.posts).toHaveLength(1);
    // The other user's token is never used to read a list either.
    expect(h.listReads).toEqual(["access-u1"]);
    expect(h.holder.hasToken()).toBe(false);
  });

  it("a session", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"), NONE);
    h.answers.push("no-response");
    h.lists.push([]);
    expect((await h.holder.send()).kind).toBe("notice");

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: SESSION_ENDED_MESSAGE,
      canRetry: false,
    });
    expect(h.posts).toHaveLength(1);
  });
});

describe("a resend Plaid refuses", () => {
  async function refusedResend(list: ConnectionSummary[] | null | "throw") {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"), session("u1"));
    h.answers.push("no-response", PLAID_REFUSED);
    // After the lost send, before the resend, after the refusal.
    h.lists.push([], [], list);
    expect((await h.holder.send()).kind).toBe("notice");
    const outcome = await h.holder.send();
    return { h, outcome };
  }

  it("the bank is in the list now: connected", async () => {
    const { h, outcome } = await refusedResend(ACTIVE_BANK);
    expect(outcome).toEqual({ kind: "connected" });
    expect(h.listReads).toHaveLength(3);
    expect(h.holder.hasToken()).toBe(false);
  });

  it.each<[string, ConnectionSummary[] | null | "throw"]>([
    ["the bank is not in the list", []],
    ["the list could not be read", null],
    ["the list read got no response", "throw"],
  ])("%s: the token is dropped, with our sentence and not Plaid's", async (_label, list) => {
    const { h, outcome } = await refusedResend(list);
    expect(outcome).toEqual({
      kind: "notice",
      message: CONNECTION_TIMED_OUT_MESSAGE,
      canRetry: false,
    });
    expect(h.posts).toHaveLength(2);
    expect(h.holder.hasToken()).toBe(false);
  });
});

describe("a bank that was already there when the token was received", () => {
  it("activeInstitutionIds keeps active rows with an id", () => {
    expect(
      activeInstitutionIds([
        { institutionId: "ins_1", status: "active" },
        { institutionId: "ins_2", status: "error" },
        { institutionId: null, status: "active" },
        { institutionId: "", status: "active" },
        { status: "active" },
      ])
    ).toEqual(["ins_1"]);
  });

  it("no response: not counted as connected, answered as already connected, list not read", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", ["ins_1"]);
    h.reads.push(session("u1"));
    h.answers.push("no-response");

    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: "Test Bank is already connected.",
      canRetry: false,
    });
    expect(h.listReads).toEqual([]);
    expect(h.posts).toHaveLength(1);
    expect(h.holder.hasToken()).toBe(false);
  });

  it("another bank, active then and now, is never read as this one", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", ["ins_9"]);
    h.reads.push(session("u1"), session("u1"));
    h.answers.push("no-response", PLAID_REFUSED);
    h.lists.push([], [], [{ institutionId: "ins_9", status: "active" }]);
    expect((await h.holder.send()).kind).toBe("notice");
    // Another bank being active says nothing about this one.
    expect(await h.holder.send()).toEqual({
      kind: "notice",
      message: CONNECTION_TIMED_OUT_MESSAGE,
      canRetry: false,
    });
  });

  it("a bank that appeared is connected; the list held at receipt is a copy", async () => {
    const h = harness();
    const atHold: string[] = [];
    h.holder.hold(TOKEN, BANK, "u1", atHold);
    // The screen's list changing later must not change what was recorded.
    atHold.push("ins_1");
    h.reads.push(session("u1"));
    h.answers.push("no-response");
    h.lists.push(ACTIVE_BANK);

    expect(await h.holder.send()).toEqual({ kind: "connected" });
  });

  it("a normal answer is not second-guessed: the server's 200 connects", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", ["ins_1"]);
    h.reads.push(session("u1"));
    h.answers.push(OK);

    expect(await h.holder.send()).toEqual({ kind: "connected" });
    expect(h.listReads).toEqual([]);
  });
});

describe("holding a newer token", () => {
  it("replaces the older one, and the older send's answer is set aside", async () => {
    const h = harness();
    let release: (value: { status: number; body: Record<string, unknown> }) => void = () => {};
    const slow = createPublicTokenHolder({
      readSession: async () => session("u1"),
      sleep: async () => {},
      now: () => h.clock.now,
      post: (_accessToken, payload) =>
        payload.publicToken === "public-old"
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(OK),
      readConnections: async () => [],
    });

    slow.hold("public-old", BANK, "u1", []);
    const first = slow.send();
    await Promise.resolve();
    await Promise.resolve();
    slow.hold("public-new", BANK, "u1", []);
    release({ status: 500, body: { error: "old failure" } });

    expect(await first).toEqual({ kind: "superseded" });
    expect(slow.hasToken()).toBe(true);
    expect(await slow.send()).toEqual({ kind: "connected" });
  });

  it("two sends at once are one request", async () => {
    const h = harness();
    h.holder.hold(TOKEN, BANK, "u1", []);
    h.reads.push(session("u1"));
    h.answers.push(OK);

    const [a, b] = await Promise.all([h.holder.send(), h.holder.send()]);
    expect(a).toEqual({ kind: "connected" });
    expect(b).toEqual({ kind: "connected" });
    expect(h.posts).toHaveLength(1);
  });
});

describe("the token goes nowhere but the request body", () => {
  it("no log, no storage, no cookie and no outcome carries it", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
    const storageCalls: unknown[][] = [];
    const storage = () => ({
      setItem: (...args: unknown[]) => storageCalls.push(args),
      getItem: (...args: unknown[]) => {
        storageCalls.push(args);
        return null;
      },
      removeItem: (...args: unknown[]) => storageCalls.push(args),
    });
    vi.stubGlobal("localStorage", storage());
    vi.stubGlobal("sessionStorage", storage());
    const cookieWrites: string[] = [];
    vi.stubGlobal("document", {
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        cookieWrites.push(value);
      },
    });

    const outcomes: unknown[] = [];
    const scripts: Array<{
      reads: SessionReadResult[];
      answers: Answer[];
      lists: Array<ConnectionSummary[] | null | "throw">;
      sends: number;
    }> = [
      { reads: [session("u1")], answers: [OK], lists: [], sends: 1 },
      { reads: [TIMED_OUT, TIMED_OUT, TIMED_OUT], answers: [], lists: [], sends: 1 },
      { reads: [NONE], answers: [], lists: [], sends: 1 },
      { reads: [session("u2")], answers: [], lists: [], sends: 1 },
      { reads: [session("u1"), session("u1")], answers: [UNAUTHORIZED, OK], lists: [], sends: 2 },
      {
        reads: [session("u1"), session("u1")],
        answers: ["no-response", PLAID_REFUSED],
        lists: [[], "throw", null],
        sends: 2,
      },
      {
        reads: [session("u1")],
        answers: [{ status: 500, body: { error: "save failed" } }],
        lists: [],
        sends: 1,
      },
    ];

    const sent: string[] = [];
    for (const script of scripts) {
      const h = harness();
      h.holder.hold(TOKEN, BANK, "u1", []);
      h.reads.push(...script.reads);
      h.answers.push(...script.answers);
      h.lists.push(...script.lists);
      for (let i = 0; i < script.sends; i++) outcomes.push(await h.holder.send());
      for (const post of h.posts) sent.push(post.payload.publicToken);
      // The list is read with the access token, never with the public token.
      expect(h.listReads.join(" ")).not.toContain(TOKEN);
    }

    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((value) => value === TOKEN)).toBe(true);
    expect(JSON.stringify(outcomes)).not.toContain(TOKEN);
    expect(consoleSpies.flatMap((spy) => spy.mock.calls)).toEqual([]);
    expect(storageCalls).toEqual([]);
    expect(cookieWrites).toEqual([]);
  });
});
