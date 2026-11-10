import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { CRISIS_NOTICES } from "../crisisNotice";

/**
 * POST /api/chat stops waiting for anything before its model loop at the
 * pre-loop deadline: the last moment a first model attempt could still start
 * (llmTimeouts.ts). A wait that is still running then is cut and the request
 * answers 503 CHAT_TIME_BUDGET_EXHAUSTED without calling the model or saving
 * a turn — whichever wait it was, and whatever that wait does with an
 * ordinary failure. So a request cut at the deadline never reaches the model
 * with a block missing from its prompt.
 *
 * The same file holds the [chat-stages] line: one per request, durations only.
 *
 * HOW
 * Authentication, the admin client, AI memory, the Plaid state read, the chat
 * usage ledger, LLM call logging and the crisis notice count are faked, and
 * each fake can be told to never answer. The route, the deadline helper, the
 * prompt builder and the request builder run for real. Timers and the clock
 * are fake, so a test moves the request to the deadline without waiting.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * That a cancelled Supabase query, Plaid call or fetch actually stops on the
 * wire: it holds that the signal each one was handed is aborted. The session
 * read and the memory reads take no signal at all; the request only stops
 * waiting for them.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const START = new Date("2026-11-10T11:00:00.000Z").getTime();
const DEADLINE_MS = 30000;

const BUDGET_BODY = {
  error: "Chat is taking longer than usual. Please try again.",
  code: "CHAT_TIME_BUDGET_EXHAUSTED",
};
const CUT_LINE = "[chat-deadline] stage cut stage=%s elapsed_ms=%d";
const STAGES_LINE =
  "[chat-stages] auth_ms=%d body_ms=%d profile_ms=%d session_ms=%d memory_ms=%d plaid_state_ms=%d balance_ms=%d save_ms=%d";

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

const state = {
  userId: USER_ID as string | null,
  memoryEnabled: false,
  adminConfigured: false,
  hang: {
    auth: false,
    profile: false,
    session: false,
    memory: false,
    plaidState: false,
    balance: false,
  },
  /** When set, the profile queries answer after this many milliseconds. */
  profileAnswersAfterMs: null as number | null,
  /** When set, the session read rejects with a retryable error after this long. */
  sessionFailsAfterMs: null as number | null,
  plaidStateThrows: false,
};

const seen = {
  profileSignals: [] as AbortSignal[],
  plaidSignal: undefined as AbortSignal | undefined,
  balanceSignal: undefined as AbortSignal | undefined,
  sessionCalls: 0,
  saveCalls: 0,
  modelCalls: 0,
};

/** A query builder that records the signal it is given and answers as told. */
function profileQuery(): unknown {
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "abortSignal") {
          return (signal: AbortSignal) => {
            seen.profileSignals.push(signal);
            return builder;
          };
        }
        if (prop === "then") {
          return (
            onFulfilled: (value: unknown) => unknown,
            onRejected: (reason: unknown) => unknown
          ) => {
            const result = { data: { first_name: "Ada" }, error: null };
            if (state.hang.profile) return never().then(onFulfilled, onRejected);
            if (state.profileAnswersAfterMs !== null) {
              const ms = state.profileAnswersAfterMs;
              return new Promise((resolve) =>
                setTimeout(() => resolve(result), ms)
              ).then(onFulfilled, onRejected);
            }
            return Promise.resolve(result).then(onFulfilled, onRejected);
          };
        }
        return () => builder;
      },
    }
  );
  return builder;
}

vi.mock("@/lib/chatUsageLedger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chatUsageLedger")>()),
  reserveChatUsage: async () => ({ allowed: true, limit: null, retryAt: null }),
  settleChatUsage: async () => undefined,
}));

vi.mock("@/lib/crisisNoticeTally", () => ({
  recordCrisisNotice: async () => undefined,
}));

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: () =>
    state.hang.auth ? never() : Promise.resolve(state.userId),
}));

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({ from: () => profileQuery() }),
  isSupabaseAdminConfigured: () => state.adminConfigured,
}));

vi.mock("@/lib/llmCallLog", () => ({
  recordLlmCall: async () => undefined,
}));

vi.mock("@/lib/aiMemory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../aiMemory")>()),
  isAiMemoryEnabled: () => state.memoryEnabled,
  getOrCreateActiveSession: () => {
    seen.sessionCalls += 1;
    if (state.hang.session) return never();
    if (state.sessionFailsAfterMs !== null) {
      const ms = state.sessionFailsAfterMs;
      return new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("fetch failed")), ms)
      );
    }
    return Promise.resolve({ id: SESSION_ID });
  },
  buildMemoryContext: () =>
    state.hang.memory
      ? never()
      : Promise.resolve({ facts: [], recentSummaries: [], activeSessionId: SESSION_ID }),
  formatMemoryForPrompt: () => "",
  getSessionMessages: async () => [],
  saveMessages: async () => {
    seen.saveCalls += 1;
    return {};
  },
}));

vi.mock("@/lib/plaidChatState", () => ({
  getPlaidChatState: (
    _userId: string,
    opts: { depth: string; signal?: AbortSignal }
  ) => {
    seen.plaidSignal = opts.signal;
    if (state.hang.plaidState) return never();
    if (state.plaidStateThrows) return Promise.reject(new Error("plaid state read failed"));
    return Promise.resolve({
      depth: opts.depth,
      connected: true,
      connections: [{ institution: "Test Bank", status: "active" }],
    });
  },
}));

let POST: typeof import("../../app/api/chat/route").POST;

beforeAll(async () => {
  ({ POST } = await import("../../app/api/chat/route"));
});

type Result = { status: number; json: Record<string, unknown> };

function requestFor(text: string, body?: BodyInit): NextRequest {
  return new Request("https://noor.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: body ?? JSON.stringify({ messages: [{ role: "user", content: text }] }),
    // Required by fetch for a stream body.
    ...(body ? { duplex: "half" } : {}),
  } as RequestInit) as unknown as NextRequest;
}

/** Starts a request and reports whether it has answered yet. */
function start(text: string, body?: BodyInit) {
  let result: Result | undefined;
  const done = POST(requestFor(text, body)).then(async (res) => {
    result = { status: res.status, json: (await res.json()) as Record<string, unknown> };
    return result;
  });
  return { done, answered: () => result !== undefined };
}

/** Runs a request to its answer, moving the clock as far as the answer needs. */
async function post(text: string, advanceMs = 0): Promise<Result> {
  const request = start(text);
  await vi.advanceTimersByTimeAsync(advanceMs);
  return request.done;
}

beforeEach(() => {
  state.userId = USER_ID;
  state.memoryEnabled = false;
  state.adminConfigured = false;
  state.hang = {
    auth: false,
    profile: false,
    session: false,
    memory: false,
    plaidState: false,
    balance: false,
  };
  state.profileAnswersAfterMs = null;
  state.sessionFailsAfterMs = null;
  state.plaidStateThrows = false;
  seen.profileSignals = [];
  seen.plaidSignal = undefined;
  seen.balanceSignal = undefined;
  seen.sessionCalls = 0;
  seen.saveCalls = 0;
  seen.modelCalls = 0;
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
    vi.fn((url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target === "https://noor.test/api/plaid/accounts") {
        seen.balanceSignal = init?.signal ?? undefined;
        if (state.hang.balance) return never();
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accounts: [
                { type: "checking", current_balance: 812.34, available_balance: 790.12 },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      if (target !== "https://openrouter.ai/api/v1/chat/completions") {
        return Promise.reject(new Error(`unexpected fetch: ${target}`));
      }
      seen.modelCalls += 1;
      const model = (JSON.parse(String(init?.body)) as { model: string }).model;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "gen-1",
            model,
            choices: [{ message: { content: "assistant reply" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 11, completion_tokens: 7 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
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

function cutLines(): unknown[][] {
  return vi.mocked(console.warn).mock.calls.filter((args) => args[0] === CUT_LINE);
}

function stagesLines(): unknown[][] {
  return vi.mocked(console.info).mock.calls.filter((args) => args[0] === STAGES_LINE);
}

/** A request body whose stream delivers a first chunk and then never ends. */
function bodyThatNeverEnds(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"messages":['));
    },
  });
}

interface StageCase {
  stage: string;
  text: string;
  setup: () => void;
  body?: () => BodyInit;
  /** Signals the cut wait was handed, which must be aborted. */
  signals?: () => Array<AbortSignal | undefined>;
}

const GENERAL = "How do I build my first budget?";

const STAGE_CASES: StageCase[] = [
  { stage: "auth", text: GENERAL, setup: () => (state.hang.auth = true) },
  { stage: "body", text: GENERAL, setup: () => undefined, body: bodyThatNeverEnds },
  {
    stage: "profile",
    text: GENERAL,
    setup: () => {
      vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");
      state.adminConfigured = true;
      state.hang.profile = true;
    },
    signals: () => seen.profileSignals,
  },
  {
    stage: "session",
    text: GENERAL,
    setup: () => {
      state.memoryEnabled = true;
      state.hang.session = true;
    },
  },
  {
    stage: "memory",
    text: GENERAL,
    setup: () => {
      state.memoryEnabled = true;
      state.hang.memory = true;
    },
  },
  {
    stage: "plaid_state",
    text: GENERAL,
    setup: () => {
      vi.stubEnv("AI_PLAID_STATE", "connection");
      state.hang.plaidState = true;
    },
    signals: () => [seen.plaidSignal],
  },
  {
    stage: "balance",
    text: "what's my balance?",
    setup: () => {
      vi.stubEnv("AI_PLAID_STATE", "connection");
      state.hang.balance = true;
    },
    signals: () => [seen.balanceSignal],
  },
];

describe("a wait still running at the pre-loop deadline", () => {
  it.each(STAGE_CASES.map((c) => [c.stage, c] as const))(
    "%s: 503 CHAT_TIME_BUDGET_EXHAUSTED at the deadline, no model call, no save",
    async (_stage, c) => {
      c.setup();
      const request = start(c.text, c.body?.());

      await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
      expect(request.answered()).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const res = await request.done;
      expect(res.status).toBe(503);
      expect(res.json).toEqual(BUDGET_BODY);
      expect(seen.modelCalls).toBe(0);
      expect(seen.saveCalls).toBe(0);
      expect(cutLines()).toEqual([[CUT_LINE, c.stage, DEADLINE_MS]]);
    }
  );

  it.each(
    STAGE_CASES.filter((c) => c.signals).map((c) => [c.stage, c] as const)
  )("%s: the call it was waiting for is cancelled", async (_stage, c) => {
    c.setup();
    const request = start(c.text);
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    const signals = c.signals!();
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await request.done;
    for (const signal of signals) expect(signal?.aborted).toBe(true);
  });

  it("the profile read cancels both of its queries", async () => {
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");
    state.adminConfigured = true;
    state.hang.profile = true;
    await post(GENERAL, DEADLINE_MS);
    expect(seen.profileSignals).toHaveLength(2);
  });

  it("after the body has parsed, the response carries the crisis notice", async () => {
    state.memoryEnabled = true;
    state.hang.memory = true;
    const res = await post("I want to die", DEADLINE_MS);
    expect(res.status).toBe(503);
    expect(res.json).toEqual({
      ...BUDGET_BODY,
      crisisNotice: CRISIS_NOTICES.self_harm.standard,
    });
  });

  it("before the body has parsed, it carries none", async () => {
    state.hang.auth = true;
    const res = await post("I want to die", DEADLINE_MS);
    expect(res.json).toEqual(BUDGET_BODY);
  });
});

describe("the deadline is the last moment a first attempt may start", () => {
  it("a wait that answers one millisecond earlier goes on to the model", async () => {
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");
    state.adminConfigured = true;
    state.profileAnswersAfterMs = DEADLINE_MS - 1;
    const res = await post(GENERAL, DEADLINE_MS - 1);
    expect(res.status).toBe(200);
    expect(seen.modelCalls).toBe(1);
    expect(cutLines()).toEqual([]);
  });

  it("a wait that would answer one millisecond later is cut", async () => {
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");
    state.adminConfigured = true;
    state.profileAnswersAfterMs = DEADLINE_MS + 1;
    const res = await post(GENERAL, DEADLINE_MS + 1);
    expect(res.status).toBe(503);
    expect(seen.modelCalls).toBe(0);
  });

  it("a later wait gets only what the earlier ones left", async () => {
    // The profile read takes 20 s; the Plaid read then has 10 s, not 30.
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");
    vi.stubEnv("AI_PLAID_STATE", "connection");
    state.adminConfigured = true;
    state.profileAnswersAfterMs = 20000;
    state.hang.plaidState = true;
    const request = start(GENERAL);
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(request.answered()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await request.done).status).toBe(503);
    expect(cutLines()).toEqual([[CUT_LINE, "plaid_state", DEADLINE_MS]]);
  });
});

describe("a read that fails, not one that is still waiting, keeps its own path", () => {
  it("a memory read that throws is still 503 MEMORY_LOAD_FAILED", async () => {
    state.memoryEnabled = true;
    state.sessionFailsAfterMs = 10;
    // One retry, 250 ms after the first failure, then the failure is final.
    const res = await post(GENERAL, 1000);
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("MEMORY_LOAD_FAILED");
    expect(seen.sessionCalls).toBe(2);
    expect(cutLines()).toEqual([]);
  });

  it("a Plaid state read that throws still reaches the model", async () => {
    vi.stubEnv("AI_PLAID_STATE", "connection");
    state.plaidStateThrows = true;
    const res = await post(GENERAL);
    expect(res.status).toBe(200);
    expect(seen.modelCalls).toBe(1);
  });
});

describe("a read cut at the deadline is not started again", () => {
  it("a session read that fails after the deadline gets no retry", async () => {
    state.memoryEnabled = true;
    state.sessionFailsAfterMs = DEADLINE_MS + 500;
    const res = await post(GENERAL, DEADLINE_MS);
    expect(res.status).toBe(503);
    expect(res.json).toEqual(BUDGET_BODY);
    // The read now fails with an error the retry helper would retry.
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.sessionCalls).toBe(1);
  });
});

describe("the [chat-stages] line", () => {
  function durations(): number[] {
    const lines = stagesLines();
    expect(lines).toHaveLength(1);
    // The format and eight values, and nothing else.
    expect(lines[0]).toHaveLength(9);
    for (const value of lines[0].slice(1)) expect(typeof value).toBe("number");
    return lines[0].slice(1) as number[];
  }

  it("a request that makes every wait reports a duration for each", async () => {
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");
    vi.stubEnv("AI_PLAID_STATE", "connection");
    state.adminConfigured = true;
    state.memoryEnabled = true;
    state.profileAnswersAfterMs = 120;
    const res = await post("what's my balance?", 120);
    expect(res.status).toBe(200);
    expect(seen.saveCalls).toBe(1);
    const [auth, body, profile, session, memory, plaidState, balance, save] = durations();
    expect(profile).toBe(120);
    for (const value of [auth, body, session, memory, plaidState, balance, save]) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("a wait the request did not make is -1", async () => {
    const res = await post(GENERAL);
    expect(res.status).toBe(200);
    const [auth, body, ...rest] = durations();
    expect(auth).toBeGreaterThanOrEqual(0);
    expect(body).toBeGreaterThanOrEqual(0);
    expect(rest).toEqual([-1, -1, -1, -1, -1, -1]);
  });

  it("is written for a request refused at authentication", async () => {
    state.userId = null;
    const res = await post(GENERAL);
    expect(res.status).toBe(401);
    const [auth, ...rest] = durations();
    expect(auth).toBeGreaterThanOrEqual(0);
    expect(rest).toEqual([-1, -1, -1, -1, -1, -1, -1]);
  });

  it("reports the cut wait as having lasted until the deadline", async () => {
    vi.stubEnv("AI_PLAID_STATE", "connection");
    state.hang.plaidState = true;
    await post(GENERAL, DEADLINE_MS);
    const [, , , , , plaidState, balance, save] = durations();
    expect(plaidState).toBe(DEADLINE_MS);
    expect([balance, save]).toEqual([-1, -1]);
  });

  it("carries no user id, session id or message text", async () => {
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");
    state.adminConfigured = true;
    state.memoryEnabled = true;
    await post(GENERAL);
    const line = JSON.stringify(stagesLines());
    expect(line).not.toContain(USER_ID);
    expect(line).not.toContain(SESSION_ID);
    expect(line).not.toContain("budget");
  });
});
