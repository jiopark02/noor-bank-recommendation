import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * How POST /api/chat stores a turn once the model has answered.
 *
 * - The route chooses the ids of the two rows itself and hands them to
 *   saveMessages.
 * - The insert may run no later than 57.5 s after the request started. One
 *   still running then is cancelled.
 * - An insert that ended in an error or at that deadline leaves the route not
 *   knowing whether the turn is stored. It asks once, by the two ids, no later
 *   than 58 s after the request started: both rows there is a saved turn and
 *   the reply is returned; anything else is the SAVE_FAILED response.
 * - A session found closed stored nothing. The active session is fetched
 *   again and the same pair is inserted there with the same ids, at most once
 *   per save. No other failure sends the insert a second time.
 * - Each save logs one [chat-save] line: its outcome, whether the session was
 *   found closed, and whether the save moved to the open session. The first
 *   can be true without the second, when the re-read of the open session
 *   failed or ran out of time.
 *
 * HOW
 * Authentication, the admin client, the chat usage ledger, LLM call logging
 * and the crisis notice count are faked. Of AI memory, the session read, the
 * insert and the lookup by id are scripted per call; the closed-session error
 * and its predicate are the real ones. The route and the deadline helper run
 * for real. Timers and the clock are fake.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * What saveMessages and findSavedTurn send to the database
 * (aiMemorySaveMessages.test.ts), or that the database refuses an insert into
 * a closed session.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const START = new Date("2026-11-10T11:00:00.000Z").getTime();
const INSERT_DEADLINE_MS = 57500;
const SAVE_DEADLINE_MS = 58000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const SAVE_FAILED_BODY = {
  error: "Could not save your conversation. Please try sending your message again.",
  code: "SAVE_FAILED",
};
const SAVE_LINE = "[chat-save] outcome=%s session_closed=%s switched=%s";

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

type InsertStep = "ok" | "closed" | "error" | "hang";
type LookupStep = "both" | "missing" | "error" | "hang";

interface Ids {
  user: string;
  assistant: string;
}

const script = {
  inserts: [] as InsertStep[],
  lookups: [] as LookupStep[],
  /** When set, the session read made by the save never answers. */
  sessionReadHangs: false,
  /** When set, the session read made by the save rejects. */
  sessionReadThrows: false,
  /** When set, the model answers after this many milliseconds. */
  modelAnswersAfterMs: 0,
};

const seen = {
  inserts: [] as Array<{ sessionId: string; userId: string; ids?: Ids; signal?: AbortSignal }>,
  lookups: [] as Array<{ userId: string; ids: Ids; signal?: AbortSignal }>,
  sessionReads: 0,
};

vi.mock("@/lib/chatUsageLedger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chatUsageLedger")>()),
  reserveChatUsage: async () => ({ allowed: true, limit: null, retryAt: null }),
  settleChatUsage: async () => undefined,
}));

vi.mock("@/lib/crisisNoticeTally", () => ({
  recordCrisisNotice: async () => undefined,
}));

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => USER_ID,
}));

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => {
    throw new Error("admin client must not be used in this test");
  },
  isSupabaseAdminConfigured: () => false,
}));

vi.mock("@/lib/llmCallLog", () => ({
  recordLlmCall: async () => undefined,
}));

vi.mock("@/lib/aiMemory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiMemory")>();
  return {
    ...actual,
    isAiMemoryEnabled: () => true,
    // The first read is the request's own, before the model loop. Any later
    // one is the save looking for a session that is still open.
    getOrCreateActiveSession: () => {
      seen.sessionReads += 1;
      if (seen.sessionReads === 1) return Promise.resolve({ id: SESSION_A });
      if (script.sessionReadHangs) return never();
      if (script.sessionReadThrows) {
        return Promise.reject(new Error("session read failed"));
      }
      return Promise.resolve({ id: SESSION_B });
    },
    buildMemoryContext: async () => ({
      facts: [],
      recentSummaries: [],
      activeSessionId: SESSION_A,
    }),
    formatMemoryForPrompt: () => "",
    getSessionMessages: async () => [],
    saveMessages: (
      sessionId: string,
      userId: string,
      _pair: unknown,
      options?: { ids?: Ids; signal?: AbortSignal }
    ) => {
      seen.inserts.push({ sessionId, userId, ids: options?.ids, signal: options?.signal });
      const step = script.inserts.shift() ?? "ok";
      if (step === "hang") return never();
      if (step === "closed") return Promise.reject(new actual.SessionClosedError());
      if (step === "error") return Promise.reject(new Error("insert failed"));
      return Promise.resolve({});
    },
    findSavedTurn: (
      userId: string,
      ids: Ids,
      options?: { signal?: AbortSignal }
    ) => {
      seen.lookups.push({ userId, ids, signal: options?.signal });
      const step = script.lookups.shift() ?? "missing";
      if (step === "hang") return never();
      if (step === "error") return Promise.reject(new Error("lookup failed"));
      // The session the last insert was sent to.
      return Promise.resolve(
        step === "both" ? seen.inserts[seen.inserts.length - 1].sessionId : null
      );
    },
  };
});

let POST: typeof import("../../app/api/chat/route").POST;

beforeAll(async () => {
  ({ POST } = await import("../../app/api/chat/route"));
});

type Result = { status: number; json: Record<string, unknown> };

function start() {
  let result: Result | undefined;
  const done = POST(
    new Request("https://noor.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "How do I build my first budget?" }],
      }),
    }) as unknown as NextRequest
  ).then(async (res) => {
    result = { status: res.status, json: (await res.json()) as Record<string, unknown> };
    return result;
  });
  return { done, answered: () => result !== undefined };
}

async function post(advanceMs = 0): Promise<Result> {
  const request = start();
  await vi.advanceTimersByTimeAsync(advanceMs);
  return request.done;
}

beforeEach(() => {
  script.inserts = [];
  script.lookups = [];
  script.sessionReadHangs = false;
  script.sessionReadThrows = false;
  script.modelAnswersAfterMs = 0;
  seen.inserts = [];
  seen.lookups = [];
  seen.sessionReads = 0;
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-fake");
  vi.stubEnv("OPENROUTER_MODEL", "");
  vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "");
  vi.stubEnv("OPENROUTER_SIMPLE_MODEL", "");
  vi.stubEnv("OPENROUTER_COMPLEX_MODEL", "");
  vi.stubEnv("AI_PLAID_STATE", "");
  vi.stubEnv("AI_SUPABASE_READ_ENABLED", "");
  vi.stubEnv("CHAT_USAGE_LIMIT_MODE", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "https://openrouter.ai/api/v1/chat/completions") {
        throw new Error(`unexpected fetch: ${String(url)}`);
      }
      if (script.modelAnswersAfterMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, script.modelAnswersAfterMs));
      }
      const model = (JSON.parse(String(init?.body)) as { model: string }).model;
      return new Response(
        JSON.stringify({
          id: "gen-1",
          model,
          choices: [{ message: { content: "assistant reply" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    })
  );
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function saveLines(): unknown[][] {
  const lines: unknown[][] = [];
  for (const method of ["info", "warn"] as const) {
    for (const args of vi.mocked(console[method]).mock.calls) {
      if (args[0] === SAVE_LINE) lines.push(args);
    }
  }
  return lines;
}

describe("the ids of the two rows are chosen by the route", () => {
  it("hands saveMessages two different UUIDs, the user id and the session", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(seen.inserts).toHaveLength(1);
    const { sessionId, userId, ids } = seen.inserts[0];
    expect(sessionId).toBe(SESSION_A);
    expect(userId).toBe(USER_ID);
    expect(ids?.user).toMatch(UUID_V4);
    expect(ids?.assistant).toMatch(UUID_V4);
    expect(ids?.user).not.toBe(ids?.assistant);
  });

  it("chooses new ids for each request", async () => {
    await post();
    await post();
    expect(seen.inserts[0].ids?.user).not.toBe(seen.inserts[1].ids?.user);
    expect(seen.inserts[0].ids?.assistant).not.toBe(seen.inserts[1].ids?.assistant);
  });

  it("an insert that answers needs no lookup", async () => {
    const res = await post();
    expect(res.json.sessionId).toBe(SESSION_A);
    expect(res.json.message).toBe("assistant reply");
    expect(seen.lookups).toEqual([]);
    expect(saveLines()).toEqual([[SAVE_LINE, "inserted", false, false]]);
  });
});

describe("an insert that ended in an error", () => {
  it("both rows found by id: the reply is returned", async () => {
    script.inserts = ["error"];
    script.lookups = ["both"];
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.message).toBe("assistant reply");
    expect(res.json.sessionId).toBe(SESSION_A);
    expect(saveLines()).toEqual([[SAVE_LINE, "confirmed_by_readback", false, false]]);
  });

  it("asks once, for the ids it inserted and the caller's own user id", async () => {
    script.inserts = ["error"];
    script.lookups = ["both"];
    await post();
    expect(seen.lookups).toHaveLength(1);
    expect(seen.lookups[0].userId).toBe(USER_ID);
    expect(seen.lookups[0].ids).toEqual(seen.inserts[0].ids);
  });

  it("the pair not found: SAVE_FAILED, and the reply is not returned", async () => {
    script.inserts = ["error"];
    script.lookups = ["missing"];
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json).toEqual(SAVE_FAILED_BODY);
    expect(seen.lookups).toHaveLength(1);
    expect(saveLines()).toEqual([[SAVE_LINE, "failed", false, false]]);
  });

  it("a lookup that fails confirms nothing: SAVE_FAILED", async () => {
    script.inserts = ["error"];
    script.lookups = ["error"];
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json).toEqual(SAVE_FAILED_BODY);
    expect(seen.lookups).toHaveLength(1);
  });

  it("is not sent a second time", async () => {
    script.inserts = ["error", "ok"];
    script.lookups = ["missing"];
    const res = await post();
    expect(res.status).toBe(500);
    expect(seen.inserts).toHaveLength(1);
    expect(seen.sessionReads).toBe(1);
  });
});

describe("the save deadlines, measured from the start of the request", () => {
  it("an insert still running at 57.5 s is cancelled and looked up; found, the reply is returned", async () => {
    script.inserts = ["hang"];
    script.lookups = ["both"];
    const request = start();

    await vi.advanceTimersByTimeAsync(INSERT_DEADLINE_MS - 1);
    expect(request.answered()).toBe(false);
    expect(seen.lookups).toEqual([]);
    expect(seen.inserts[0].signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const res = await request.done;
    expect(seen.inserts[0].signal?.aborted).toBe(true);
    expect(seen.lookups).toHaveLength(1);
    expect(res.status).toBe(200);
    expect(res.json.message).toBe("assistant reply");
  });

  it("an insert still running at 57.5 s and not found: SAVE_FAILED", async () => {
    script.inserts = ["hang"];
    script.lookups = ["missing"];
    const res = await post(INSERT_DEADLINE_MS);
    expect(res.status).toBe(500);
    expect(res.json).toEqual(SAVE_FAILED_BODY);
    expect(seen.inserts).toHaveLength(1);
  });

  it("a lookup still running at 58 s is cancelled: SAVE_FAILED at that moment", async () => {
    script.inserts = ["hang"];
    script.lookups = ["hang"];
    const request = start();

    await vi.advanceTimersByTimeAsync(SAVE_DEADLINE_MS - 1);
    expect(request.answered()).toBe(false);
    expect(seen.lookups[0].signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const res = await request.done;
    expect(seen.lookups[0].signal?.aborted).toBe(true);
    expect(res.status).toBe(500);
    expect(res.json).toEqual(SAVE_FAILED_BODY);
  });

  it("time the model took comes out of the insert's share", async () => {
    script.modelAnswersAfterMs = 20000;
    script.inserts = ["hang"];
    script.lookups = ["missing"];
    const request = start();
    await vi.advanceTimersByTimeAsync(INSERT_DEADLINE_MS - 1);
    expect(seen.inserts).toHaveLength(1);
    expect(seen.lookups).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await request.done;
    expect(seen.lookups).toHaveLength(1);
  });
});

describe("a session found closed", () => {
  it("the same pair, with the same ids, goes to the session that is open now", async () => {
    script.inserts = ["closed", "ok"];
    const res = await post();
    expect(res.status).toBe(200);
    expect(seen.sessionReads).toBe(2);
    expect(seen.inserts.map((i) => i.sessionId)).toEqual([SESSION_A, SESSION_B]);
    expect(seen.inserts[1].ids).toEqual(seen.inserts[0].ids);
    expect(seen.inserts[1].userId).toBe(USER_ID);
    expect(seen.lookups).toEqual([]);
  });

  it("the response names the session the turn was stored in", async () => {
    script.inserts = ["closed", "ok"];
    const res = await post();
    expect(res.json.sessionId).toBe(SESSION_B);
    expect(res.json.message).toBe("assistant reply");
    expect(saveLines()).toEqual([[SAVE_LINE, "inserted", true, true]]);
  });

  it("a second closed answer is not followed by a third insert", async () => {
    script.inserts = ["closed", "closed", "ok"];
    script.lookups = ["missing"];
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json).toEqual(SAVE_FAILED_BODY);
    expect(seen.inserts).toHaveLength(2);
    expect(seen.sessionReads).toBe(2);
    expect(seen.lookups).toHaveLength(1);
    expect(saveLines()).toEqual([[SAVE_LINE, "failed", true, true]]);
  });

  it("the second insert failing is looked up like any other", async () => {
    script.inserts = ["closed", "error"];
    script.lookups = ["both"];
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.sessionId).toBe(SESSION_B);
    expect(seen.inserts).toHaveLength(2);
    expect(saveLines()).toEqual([[SAVE_LINE, "confirmed_by_readback", true, true]]);
  });

  it("the second insert shares the first one's deadline", async () => {
    script.inserts = ["closed", "hang"];
    script.lookups = ["missing"];
    const request = start();
    await vi.advanceTimersByTimeAsync(INSERT_DEADLINE_MS - 1);
    expect(request.answered()).toBe(false);
    expect(seen.lookups).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const res = await request.done;
    expect(seen.inserts[1].signal?.aborted).toBe(true);
    expect(res.status).toBe(500);
  });

  it("a session read still running at the insert deadline sends no second insert", async () => {
    script.inserts = ["closed", "ok"];
    script.lookups = ["missing"];
    script.sessionReadHangs = true;
    const res = await post(INSERT_DEADLINE_MS);
    expect(res.status).toBe(500);
    expect(res.json).toEqual(SAVE_FAILED_BODY);
    expect(seen.inserts).toHaveLength(1);
    expect(seen.lookups).toHaveLength(1);
  });
});

describe("the [chat-save] line", () => {
  // A session found closed is told apart from an ordinary insert failure even
  // when the save never reached a second insert.
  it("a session found closed whose re-read ran out of time: session_closed, not switched", async () => {
    script.inserts = ["closed", "ok"];
    script.lookups = ["missing"];
    script.sessionReadHangs = true;
    await post(INSERT_DEADLINE_MS);
    expect(seen.inserts).toHaveLength(1);
    expect(saveLines()).toEqual([[SAVE_LINE, "failed", true, false]]);
  });

  it("a session found closed whose re-read threw: session_closed, not switched", async () => {
    script.inserts = ["closed", "ok"];
    script.lookups = ["missing"];
    script.sessionReadThrows = true;
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json).toEqual(SAVE_FAILED_BODY);
    expect(seen.inserts).toHaveLength(1);
    expect(seen.sessionReads).toBe(2);
    expect(seen.lookups).toHaveLength(1);
    expect(saveLines()).toEqual([[SAVE_LINE, "failed", true, false]]);
  });

  it("an ordinary insert failure: neither", async () => {
    script.inserts = ["error"];
    script.lookups = ["missing"];
    await post();
    expect(saveLines()).toEqual([[SAVE_LINE, "failed", false, false]]);
  });

  it("carries the outcome, whether the session was found closed and whether it was switched, and no id", async () => {
    script.inserts = ["closed", "ok"];
    await post();
    const line = JSON.stringify(saveLines());
    expect(line).not.toContain(USER_ID);
    expect(line).not.toContain(SESSION_A);
    expect(line).not.toContain(SESSION_B);
    expect(line).not.toContain(seen.inserts[0].ids!.user);
    expect(line).not.toContain(seen.inserts[0].ids!.assistant);
  });
});
