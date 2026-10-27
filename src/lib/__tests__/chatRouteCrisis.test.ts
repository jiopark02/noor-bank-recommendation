import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import type {
  ChatUsageDecision,
  ChatUsageReserveInput,
} from "../chatUsageLedger";
import { ChatUsageCheckError } from "../chatUsageLedger";
import type { CrisisNoticeRecordInput } from "../crisisNoticeTally";
import { CRISIS_NOTICES } from "../crisisNotice";
import {
  CHAT_MAX_BODY_BYTES,
  CHAT_MAX_HISTORY_CHARS,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_LAST_USER_MESSAGE_CHARS,
} from "../chatInputLimits";

/**
 * POST /api/chat attaches a fixed crisis notice to every response after the
 * body has parsed when the last user message carries a crisis signal: on a
 * model reply (notice first, and the stored reply is the one shown) and on
 * every refusal or error after parsing. The notice is counted once per
 * request that showed it, and nothing about detection or the count is logged.
 * The escalated notice is chosen from the session's stored user turns only.
 *
 * HOW
 * Same harness as chatRouteUsageLimit.test.ts: authentication, the admin
 * client, AI memory, the chat usage ledger, LLM call logging and the crisis
 * notice count are mocked; the route, the prompt builder and the OpenRouter
 * request builder run for real; fetch is stubbed and scripted per attempt.
 * The route is imported once: every value a case changes is read when a
 * request is handled, and beforeEach / afterEach set and restore it.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";

type StoredRow = { role: "user" | "assistant"; content: string };

const memory = {
  enabled: false,
  loadFails: false,
  saveFails: false,
  history: [] as StoredRow[],
  savedAssistant: [] as string[],
};

const supabaseState = { adminConfigured: false };

type Reserve = (input: ChatUsageReserveInput) => Promise<ChatUsageDecision>;

const usage = {
  reserve: (async () => ({ allowed: true, limit: null, retryAt: null })) as Reserve,
  reserveCalls: 0,
};

const tally = { records: [] as CrisisNoticeRecordInput[] };

vi.mock("@/lib/chatUsageLedger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chatUsageLedger")>()),
  reserveChatUsage: async (input: ChatUsageReserveInput) => {
    usage.reserveCalls += 1;
    return usage.reserve(input);
  },
  settleChatUsage: async () => undefined,
}));

vi.mock("@/lib/crisisNoticeTally", () => ({
  recordCrisisNotice: async (input: CrisisNoticeRecordInput) => {
    tally.records.push(input);
  },
}));

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => USER_ID,
}));

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => {
    throw new Error("admin client must not be used in this test");
  },
  isSupabaseAdminConfigured: () => supabaseState.adminConfigured,
  isSupabaseConfigured: () => false,
}));

vi.mock("@/lib/llmCallLog", () => ({
  recordLlmCall: async () => undefined,
}));

vi.mock("@/lib/aiMemory", () => ({
  isAiMemoryEnabled: () => memory.enabled,
  getOrCreateActiveSession: async () => ({ id: "session-1" }),
  getActiveSession: async () => ({ id: "session-1" }),
  buildMemoryContext: async () => {
    if (memory.loadFails) throw new Error("memory down");
    return { facts: [], recentSummaries: [], activeSessionId: "session-1" };
  },
  formatMemoryForPrompt: () => "",
  saveMessages: async (
    _sessionId: string,
    _userId: string,
    pair: { assistantContent: string }
  ) => {
    if (memory.saveFails) throw new Error("save down");
    memory.savedAssistant.push(pair.assistantContent);
    return {};
  },
  // Newest first, as the route asks for.
  getSessionMessages: async () =>
    memory.history
      .map((row, i) => ({
        id: `m${i}`,
        session_id: "session-1",
        user_id: USER_ID,
        role: row.role,
        content: row.content,
        model: null,
        input_tokens: null,
        output_tokens: null,
        created_at: new Date(Date.UTC(2026, 9, 27, 0, 0, i)).toISOString(),
      }))
      .reverse(),
}));

type Answer =
  | { kind: "ok"; content?: string }
  | { kind: "status"; status: number }
  | { kind: "throw" };

let answers: Answer[] = [];
let systemMessages: string[] = [];

type Msg = { role: "user" | "assistant"; content: string };

let POST: typeof import("../../app/api/chat/route").POST;

beforeAll(async () => {
  ({ POST } = await import("../../app/api/chat/route"));
});

async function post(body: unknown): Promise<{
  status: number;
  headers: Headers;
  json: Record<string, unknown>;
}> {
  const res = await POST(
    new Request("https://noor.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }) as unknown as NextRequest
  );
  return {
    status: res.status,
    headers: res.headers,
    json: (await res.json()) as Record<string, unknown>,
  };
}

function say(text: string): { messages: Msg[] } {
  return { messages: [{ role: "user", content: text }] };
}

const CRISIS = "I want to die";
const STANDARD = CRISIS_NOTICES.self_harm.standard;
const ESCALATED = CRISIS_NOTICES.self_harm.escalated;

beforeEach(() => {
  memory.enabled = false;
  memory.loadFails = false;
  memory.saveFails = false;
  memory.history = [];
  memory.savedAssistant = [];
  supabaseState.adminConfigured = false;
  usage.reserve = async () => ({ allowed: true, limit: null, retryAt: null });
  usage.reserveCalls = 0;
  tally.records = [];
  answers = [{ kind: "ok" }];
  systemMessages = [];
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
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      systemMessages.push(body.messages[0].content);
      const answer = answers.shift() ?? { kind: "throw" };
      if (answer.kind === "throw") throw new TypeError("fetch failed");
      if (answer.kind === "status") {
        return new Response(
          JSON.stringify({ error: { message: `upstream ${answer.status}` } }),
          { status: answer.status, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          id: "gen-1",
          model: body.model,
          choices: [
            {
              message: { content: answer.content ?? "assistant reply" },
              finish_reason: "stop",
            },
          ],
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

/** Console calls whose arguments mention a crisis category, the notice or the message. */
function crisisConsoleCalls(): unknown[][] {
  const pattern = /crisis|self_harm|harm_to_others|eating|escalated|want to die|988/i;
  const calls: unknown[][] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    for (const args of vi.mocked(console[method]).mock.calls) {
      const text = args
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      if (pattern.test(text)) calls.push(args);
    }
  }
  return calls;
}

describe("a model reply with a crisis signal", () => {
  it("leads with the notice, stores exactly what it returns, counts once, logs nothing about it", async () => {
    memory.enabled = true;
    const res = await post(say(CRISIS));
    expect(res.status).toBe(200);
    expect(res.json.message).toBe(`${STANDARD}\n\nassistant reply`);
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(memory.savedAssistant).toEqual([res.json.message]);
    expect(tally.records).toEqual([{ category: "self_harm", variant: "standard" }]);
    expect(crisisConsoleCalls()).toEqual([]);
  });

  it("an empty model reply: the notice alone is returned and stored", async () => {
    memory.enabled = true;
    answers = [{ kind: "ok", content: "" }];
    const res = await post(say(CRISIS));
    expect(res.status).toBe(200);
    expect(res.json.message).toBe(STANDARD);
    expect(memory.savedAssistant).toEqual([STANDARD]);
  });

  it("puts the Safety turn block last and drops the greeting block for 'hi i want to die'", async () => {
    const res = await post(say("hi i want to die"));
    expect(res.status).toBe(200);
    expect(systemMessages).toHaveLength(1);
    const system = systemMessages[0];
    expect(system).not.toContain("## Current Turn: Simple Greeting or Small Talk");
    expect(
      system.endsWith(
        "\n\n## Current Turn: Safety\nThe user's latest message may indicate risk. Follow 'Safety comes first'. A fixed safety notice with crisis contacts is shown to the user above your reply."
      )
    ).toBe(true);
  });

  it("a plain greeting keeps the greeting block and gets no Safety block", async () => {
    const res = await post(say("hi"));
    expect(res.status).toBe(200);
    expect(systemMessages[0]).toContain("## Current Turn: Simple Greeting or Small Talk");
    expect(systemMessages[0]).not.toContain("## Current Turn: Safety");
  });
});

describe("the escalated notice comes from stored user turns only", () => {
  it("memory on, a stored user turn with a signal: escalated", async () => {
    memory.enabled = true;
    memory.history = [
      { role: "user", content: "I want to die" },
      { role: "assistant", content: `${STANDARD}\n\nassistant reply` },
    ];
    const res = await post(say("I still want to die"));
    expect(res.json.message).toBe(`${ESCALATED}\n\nassistant reply`);
    expect(res.json.crisisNotice).toBe(ESCALATED);
    expect(memory.savedAssistant).toEqual([res.json.message]);
    expect(tally.records).toEqual([{ category: "self_harm", variant: "escalated" }]);
  });

  it("memory on, a stored user turn of another category: standard", async () => {
    memory.enabled = true;
    memory.history = [
      { role: "user", content: "I purge after I eat" },
      { role: "assistant", content: CRISIS_NOTICES.eating.standard },
    ];
    const res = await post(say(CRISIS));
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(tally.records).toEqual([{ category: "self_harm", variant: "standard" }]);
  });

  it("memory on, a stored user turn of the same non-self-harm category: escalated", async () => {
    memory.enabled = true;
    memory.history = [
      { role: "user", content: "I've been purging after meals" },
      { role: "assistant", content: CRISIS_NOTICES.eating.standard },
    ];
    const res = await post(say("I purge after I eat"));
    expect(res.json.crisisNotice).toBe(CRISIS_NOTICES.eating.escalated);
    expect(tally.records).toEqual([{ category: "eating", variant: "escalated" }]);
  });

  it("memory on, only Noor's own notice in the stored turns: standard", async () => {
    memory.enabled = true;
    memory.history = [
      { role: "user", content: "how do I budget?" },
      { role: "assistant", content: STANDARD },
    ];
    const res = await post(say(CRISIS));
    expect(res.json.crisisNotice).toBe(STANDARD);
  });

  it("a signal only in the history the body carries: standard (memory on and off)", async () => {
    const body = {
      messages: [
        { role: "user", content: "I want to die" },
        { role: "assistant", content: "earlier reply" },
        { role: "user", content: "I want to die" },
      ],
    };
    memory.enabled = true;
    expect((await post(body)).json.crisisNotice).toBe(STANDARD);
    memory.enabled = false;
    expect((await post(body)).json.crisisNotice).toBe(STANDARD);
    expect(tally.records).toEqual([
      { category: "self_harm", variant: "standard" },
      { category: "self_harm", variant: "standard" },
    ]);
  });
});

describe("refusals after parsing carry the notice", () => {
  it("a last user message over the limit, with a signal: 400 with the notice, counted, no reservation", async () => {
    const res = await post(say(`${CRISIS} ${"x".repeat(CHAT_MAX_LAST_USER_MESSAGE_CHARS)}`));
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("MESSAGE_TOO_LONG");
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(usage.reserveCalls).toBe(0);
    expect(tally.records).toEqual([{ category: "self_harm", variant: "standard" }]);
  });

  it("a tail over the limit after a message with a signal: 400 with the notice", async () => {
    const messages: Msg[] = [{ role: "user", content: CRISIS }];
    for (let i = 0; i < CHAT_MAX_HISTORY_MESSAGES; i += 1) {
      messages.push({ role: "assistant", content: `a${i}` });
    }
    const res = await post({ messages });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("MESSAGE_TOO_LONG");
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(tally.records).toHaveLength(1);
  });

  it("an empty window has no user message, so no signal and no notice", async () => {
    const res = await post({
      messages: [{ role: "assistant", content: "x".repeat(CHAT_MAX_HISTORY_CHARS + 1) }],
    });
    expect(res.status).toBe(400);
    expect(res.json).not.toHaveProperty("crisisNotice");
    expect(tally.records).toEqual([]);
  });

  it("413 is refused before parsing: no notice, not counted", async () => {
    const res = await post(
      JSON.stringify(say(`${CRISIS} ${"x".repeat(CHAT_MAX_BODY_BYTES)}`))
    );
    expect(res.status).toBe(413);
    expect(res.json).not.toHaveProperty("crisisNotice");
    expect(tally.records).toEqual([]);
  });

  it("usage limit 429: the notice, Retry-After kept, counted once, no model call", async () => {
    usage.reserve = async () => ({
      allowed: false,
      limit: "hour",
      retryAt: "2026-10-27T12:00:00.000Z",
    });
    const res = await post(say(CRISIS));
    expect(res.status).toBe(429);
    expect(res.json.code).toBe("USAGE_LIMIT_REACHED");
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(systemMessages).toHaveLength(0);
    expect(tally.records).toHaveLength(1);
  });

  it("usage check 503: the notice", async () => {
    usage.reserve = async () => {
      throw new ChatUsageCheckError("timeout", null);
    };
    const res = await post(say(CRISIS));
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("USAGE_CHECK_UNAVAILABLE");
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(tally.records).toHaveLength(1);
  });

  it("memory load 503: the standard notice", async () => {
    memory.enabled = true;
    memory.loadFails = true;
    const res = await post(say(CRISIS));
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("MEMORY_LOAD_FAILED");
    expect(res.json.crisisNotice).toBe(STANDARD);
  });
});

describe("errors after the model loop carry the notice", () => {
  it("SAVE_FAILED: the model reply is dropped, the notice is returned", async () => {
    memory.enabled = true;
    memory.saveFails = true;
    const res = await post(say(CRISIS));
    expect(res.status).toBe(500);
    expect(res.json.code).toBe("SAVE_FAILED");
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(tally.records).toHaveLength(1);
  });

  it("provider 401: the notice", async () => {
    answers = [{ kind: "status", status: 401 }];
    const res = await post(say(CRISIS));
    expect(res.status).toBe(401);
    expect(res.json.crisisNotice).toBe(STANDARD);
  });

  it("every model non-2xx: the last failure, with the notice, counted once", async () => {
    answers = [
      { kind: "status", status: 500 },
      { kind: "status", status: 502 },
    ];
    const res = await post(say(CRISIS));
    expect(res.status).toBe(502);
    expect(res.json.error).toBe("upstream 502");
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(tally.records).toHaveLength(1);
  });

  it("provider 429 on both models: the notice", async () => {
    answers = [
      { kind: "status", status: 429 },
      { kind: "status", status: 429 },
    ];
    const res = await post(say(CRISIS));
    expect(res.status).toBe(429);
    expect(res.json.error).toBe("Rate limit exceeded. Please try again later.");
    expect(res.json.crisisNotice).toBe(STANDARD);
  });

  it("the last attempt threw: 500 with the notice, counted once", async () => {
    answers = [{ kind: "throw" }, { kind: "throw" }];
    const res = await post(say(CRISIS));
    expect(res.status).toBe(500);
    expect(res.json.error).toBe("Failed to get response from AI");
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(tally.records).toHaveLength(1);
    expect(crisisConsoleCalls()).toEqual([]);
  });

  it("no attempt fitted in the time budget: 503 with the notice", async () => {
    usage.reserve = async () => {
      vi.setSystemTime(Date.now() + 30001);
      return { allowed: true, limit: null, retryAt: null };
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T11:00:00.000Z"));
    let res: Awaited<ReturnType<typeof post>>;
    try {
      res = await post(say(CRISIS));
    } finally {
      vi.useRealTimers();
    }
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("CHAT_TIME_BUDGET_EXHAUSTED");
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(systemMessages).toHaveLength(0);
    expect(tally.records).toHaveLength(1);
  });

  it("no OpenRouter key 503: the notice", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const res = await post(say(CRISIS));
    expect(res.status).toBe(503);
    expect(res.json.crisisNotice).toBe(STANDARD);
  });

  it("a throw that reaches the outer catch (the profile read): 500 with the notice", async () => {
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");
    supabaseState.adminConfigured = true;
    const res = await post(say(CRISIS));
    expect(res.status).toBe(500);
    expect(res.json.error).toBe("Failed to get response from AI");
    expect(res.json.crisisNotice).toBe(STANDARD);
    expect(tally.records).toHaveLength(1);
  });
});

describe("the count is per request, not per attempt", () => {
  it("first model 500, fallback answers: counted once", async () => {
    answers = [{ kind: "status", status: 500 }, { kind: "ok" }];
    const res = await post(say(CRISIS));
    expect(res.status).toBe(200);
    expect(systemMessages).toHaveLength(2);
    expect(tally.records).toHaveLength(1);
  });

  it("first model throws, fallback answers: counted once", async () => {
    answers = [{ kind: "throw" }, { kind: "ok" }];
    const res = await post(say(CRISIS));
    expect(res.status).toBe(200);
    expect(systemMessages).toHaveLength(2);
    expect(tally.records).toHaveLength(1);
  });
});

describe("a message without a signal is unchanged", () => {
  it("success: no notice, the same keys, the model reply as is, not counted", async () => {
    memory.enabled = true;
    const res = await post(say("How do I build my first budget?"));
    expect(res.status).toBe(200);
    expect(Object.keys(res.json).sort()).toEqual([
      "message",
      "model",
      "sessionId",
      "success",
      "usage",
    ]);
    expect(res.json.message).toBe("assistant reply");
    expect(memory.savedAssistant).toEqual(["assistant reply"]);
    expect(systemMessages[0]).not.toContain("## Current Turn: Safety");
    expect(tally.records).toEqual([]);
  });

  it("an error: no crisisNotice key, not counted", async () => {
    answers = [{ kind: "throw" }, { kind: "throw" }];
    const res = await post(say("How do I build my first budget?"));
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "Failed to get response from AI" });
    expect(tally.records).toEqual([]);
  });
});
