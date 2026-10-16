import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  CHAT_MAX_BODY_BYTES,
  CHAT_MAX_HISTORY_CHARS,
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_LAST_USER_MESSAGE_CHARS,
} from "../chatInputLimits";

/**
 * POST /api/chat applies the input limits before anything that costs: the
 * hourly count read, DB reads, Plaid, and the model call. A request inside the
 * limits must reach the model, pick its model, answer, and persist exactly as
 * before.
 *
 * HOW
 * Authentication, the admin client, AI memory and LLM call logging are mocked.
 * The route itself, the prompt builder, the Plaid egress policy (AI_PLAID_STATE
 * unset, so "off") and the OpenRouter request builder run for real. fetch is
 * stubbed and records the OpenRouter request body.
 */

const memory = {
  enabled: false,
  countCalls: 0,
  saved: [] as Array<{ sessionId: string; userId: string; pair: unknown }>,
};

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => "00000000-0000-4000-8000-000000000001",
}));

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => {
    throw new Error("admin client must not be used in this test");
  },
  isSupabaseAdminConfigured: () => false,
  isSupabaseConfigured: () => false,
}));

vi.mock("@/lib/llmCallLog", () => ({
  recordLlmCall: async () => undefined,
}));

vi.mock("@/lib/aiMemory", () => ({
  isAiMemoryEnabled: () => memory.enabled,
  getOrCreateActiveSession: async () => ({ id: "session-1" }),
  getActiveSession: async () => ({ id: "session-1" }),
  buildMemoryContext: async () => ({ facts: [], recentSummaries: [], activeSessionId: "session-1" }),
  formatMemoryForPrompt: () => "",
  saveMessages: async (sessionId: string, userId: string, pair: unknown) => {
    memory.saved.push({ sessionId, userId, pair });
    return {};
  },
  getSessionMessages: async () => [],
  getRecentChatTurnCount: async () => {
    memory.countCalls += 1;
    return 0;
  },
}));

type Msg = { role: "user" | "assistant"; content: string };

let openRouterBodies: Array<{ model: string; messages: Msg[] }> = [];

function chatRequest(body: string): NextRequest {
  return new Request("https://noor.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body,
  }) as unknown as NextRequest;
}

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import("../../app/api/chat/route");
  const res = await POST(chatRequest(typeof body === "string" ? body : JSON.stringify(body)));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function conversation(n: number): Msg[] {
  const out: Msg[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ role: i % 2 === 0 ? "user" : "assistant", content: `message ${i}` });
  }
  return out;
}

const SIMPLE_MODEL = "google/gemini-2.5-flash-lite";
const COMPLEX_MODEL = "anthropic/claude-sonnet-4.6";

beforeEach(() => {
  memory.enabled = false;
  memory.countCalls = 0;
  memory.saved = [];
  openRouterBodies = [];
  vi.resetModules();
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-fake");
  vi.stubEnv("OPENROUTER_MODEL", "");
  vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "");
  vi.stubEnv("OPENROUTER_SIMPLE_MODEL", "");
  vi.stubEnv("OPENROUTER_COMPLEX_MODEL", "");
  vi.stubEnv("AI_PLAID_STATE", "");
  vi.stubEnv("AI_SUPABASE_READ_ENABLED", "");
  vi.stubEnv("CHAT_RATE_LIMIT_ENABLED", "true");
  vi.stubEnv("CHAT_MAX_REQUESTS_PER_HOUR", "100");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "https://openrouter.ai/api/v1/chat/completions") {
        throw new Error(`unexpected fetch: ${String(url)}`);
      }
      const body = JSON.parse(String(init?.body)) as { model: string; messages: Msg[] };
      openRouterBodies.push(body);
      return new Response(
        JSON.stringify({
          id: "gen-1",
          model: body.model,
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Every refusal log line, as the full argument list passed to console.warn. */
function refusalLogs(): unknown[][] {
  return vi
    .mocked(console.warn)
    .mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].startsWith("[chat-input] refused")
    );
}

describe("refusals happen before the hourly count and the model", () => {
  it("a body over the byte ceiling: 413 PAYLOAD_TOO_LARGE, no count read, no model call", async () => {
    const huge = JSON.stringify({
      messages: [{ role: "user", content: "x".repeat(CHAT_MAX_BODY_BYTES) }],
    });
    const res = await post(huge);
    expect(res.status).toBe(413);
    expect(res.json.code).toBe("PAYLOAD_TOO_LARGE");
    expect(memory.countCalls).toBe(0);
    expect(openRouterBodies).toHaveLength(0);
    expect(refusalLogs()).toEqual([["[chat-input] refused reason=%s", "payload_too_large"]]);
  });

  it("a last user message over U: 400 MESSAGE_TOO_LONG, no count read, no model call", async () => {
    const res = await post({
      messages: [{ role: "user", content: "x".repeat(CHAT_MAX_LAST_USER_MESSAGE_CHARS + 1) }],
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("MESSAGE_TOO_LONG");
    expect(memory.countCalls).toBe(0);
    expect(openRouterBodies).toHaveLength(0);
    expect(refusalLogs()).toEqual([
      ["[chat-input] refused reason=%s", "last_user_message_too_long"],
    ]);
  });

  it("a tail over T: 400 MESSAGE_TOO_LONG, logged as tail_too_long", async () => {
    const res = await post({
      messages: [
        { role: "user", content: "question" },
        { role: "assistant", content: "y".repeat(CHAT_MAX_HISTORY_CHARS) },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("MESSAGE_TOO_LONG");
    expect(memory.countCalls).toBe(0);
    expect(openRouterBodies).toHaveLength(0);
    expect(refusalLogs()).toEqual([["[chat-input] refused reason=%s", "tail_too_long"]]);
  });

  it("an empty window: 400 MESSAGE_TOO_LONG, logged as empty_window, no model call", async () => {
    const res = await post({
      messages: [{ role: "assistant", content: "y".repeat(CHAT_MAX_HISTORY_CHARS + 1) }],
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("MESSAGE_TOO_LONG");
    expect(memory.countCalls).toBe(0);
    expect(openRouterBodies).toHaveLength(0);
    expect(refusalLogs()).toEqual([["[chat-input] refused reason=%s", "empty_window"]]);
  });

  it("a malformed body still gets the existing 400", async () => {
    const res = await post("{not json");
    expect(res).toEqual({ status: 400, json: { error: "Messages are required" } });
    expect(memory.countCalls).toBe(0);
  });
});

describe("a request inside the limits is unchanged", () => {
  it("the model receives [system, ...messages] exactly as sent", async () => {
    const messages = conversation(7);
    const res = await post({ messages });
    expect(res.status).toBe(200);
    expect(memory.countCalls).toBe(1);
    expect(openRouterBodies).toHaveLength(1);
    const sent = openRouterBodies[0].messages;
    expect(sent[0].role).toBe("system");
    expect(sent.slice(1)).toEqual(messages);
  });

  it("an assistant-first conversation inside the limits is sent as is", async () => {
    const messages: Msg[] = [
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "and then?" },
    ];
    await post({ messages });
    expect(openRouterBodies[0].messages.slice(1)).toEqual(messages);
  });

  it("the response body keeps its keys", async () => {
    const res = await post({ messages: conversation(3) });
    expect(Object.keys(res.json).sort()).toEqual(["message", "model", "sessionId", "success", "usage"]);
    expect(res.json).toMatchObject({
      success: true,
      message: "assistant reply",
      model: SIMPLE_MODEL,
      sessionId: null,
      usage: { input_tokens: 11, output_tokens: 7 },
    });
  });

  it("model choice follows the last user message: simple at 350 chars, complex above", async () => {
    await post({ messages: [{ role: "user", content: "a".repeat(350) }] });
    await post({ messages: [{ role: "user", content: "a".repeat(351) }] });
    expect(openRouterBodies.map((b) => b.model)).toEqual([SIMPLE_MODEL, COMPLEX_MODEL]);
  });

  it("with memory on, the saved user content is the last user message", async () => {
    memory.enabled = true;
    const messages = conversation(5);
    const res = await post({ messages });
    expect(res.status).toBe(200);
    expect(memory.saved).toHaveLength(1);
    expect(memory.saved[0].pair).toMatchObject({
      userContent: messages[4].content,
      assistantContent: "assistant reply",
    });
  });
});

describe("a request over the limits is windowed", () => {
  it("over N: the model receives system plus the trimmed window ending at the last user message", async () => {
    const messages = conversation(CHAT_MAX_HISTORY_MESSAGES + 1);
    const res = await post({ messages });
    expect(res.status).toBe(200);
    const sent = openRouterBodies[0].messages.slice(1);
    // Newest N are indices 1..N; the leading assistant at index 1 is dropped.
    expect(sent).toEqual(messages.slice(2));
    expect(sent[sent.length - 1]).toEqual(messages[messages.length - 1]);
  });

  it("trimming does not change the model choice", async () => {
    const longLast: Msg = { role: "user", content: "b".repeat(351) };
    await post({ messages: [longLast] });
    await post({ messages: conversation(CHAT_MAX_HISTORY_MESSAGES + 4).concat([longLast]) });
    expect(openRouterBodies.map((b) => b.model)).toEqual([COMPLEX_MODEL, COMPLEX_MODEL]);
  });
});
