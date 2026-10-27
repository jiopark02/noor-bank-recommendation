import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Whatever kind of turn POST /api/chat assembles — a greeting, a balance
 * question, a general question, a crisis message, a turn with memory, and
 * each AI_PLAID_STATE mode — the system message it sends to OpenRouter keeps
 * the AI identity, the "Safety comes first" section and the boundaries, and
 * no friend persona. The blocks appended per turn must not drop or contradict
 * them.
 *
 * HOW
 * Authentication, the admin client, AI memory, the chat usage ledger and LLM
 * call logging are mocked. The route, the prompt builder, the Plaid egress
 * policy and the OpenRouter request builder run for real. fetch is stubbed and
 * records the OpenRouter request body; any other fetch (the balance read)
 * fails, which the route treats as no snapshot.
 *
 * The route is imported once for the file. Every value a case changes is read
 * when a request is handled, not when the module loads (AI_PLAID_STATE, the
 * OpenRouter key and model variables, CHAT_USAGE_LIMIT_MODE,
 * AI_SUPABASE_READ_ENABLED, and the mocks' state), so each case sets it in
 * beforeEach and afterEach restores it.
 */

const memory = { enabled: false, block: "" };

vi.mock("@/lib/chatUsageLedger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chatUsageLedger")>()),
  reserveChatUsage: async () => ({ allowed: true, limit: null, retryAt: null }),
  settleChatUsage: async () => undefined,
}));

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
  formatMemoryForPrompt: () => memory.block,
  saveMessages: async () => ({}),
  getSessionMessages: async () => [],
}));

type Msg = { role: "system" | "user" | "assistant"; content: string };

let systemMessages: string[] = [];

let POST: typeof import("../../app/api/chat/route").POST;

beforeAll(async () => {
  ({ POST } = await import("../../app/api/chat/route"));
});

async function post(text: string): Promise<number> {
  const res = await POST(
    new Request("https://noor.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
    }) as unknown as NextRequest
  );
  return res.status;
}

beforeEach(() => {
  memory.enabled = false;
  memory.block = "";
  systemMessages = [];
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-fake");
  vi.stubEnv("OPENROUTER_MODEL", "");
  vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "");
  vi.stubEnv("AI_PLAID_STATE", "");
  vi.stubEnv("AI_SUPABASE_READ_ENABLED", "");
  vi.stubEnv("CHAT_USAGE_LIMIT_MODE", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "https://openrouter.ai/api/v1/chat/completions") {
        throw new Error(`unexpected fetch: ${String(url)}`);
      }
      const body = JSON.parse(String(init?.body)) as { model: string; messages: Msg[] };
      systemMessages.push(body.messages[0].content);
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
  memory.enabled = false;
  memory.block = "";
});

function expectFixedRules(system: string): void {
  expect(
    system.startsWith(
      "You are Noor, an AI personal finance guide for people who are just getting started with managing their money."
    )
  ).toBe(true);
  expect(system).toContain("## Safety comes first");
  expect(system).toContain("## Boundaries");
  expect(system).toContain("- If asked whether you are a person, say plainly that you are an AI.");
  expect(system.toLowerCase()).not.toContain("friend");
}

const TURNS: Array<[string, string]> = [
  ["greeting", "hi"],
  ["balance question", "what's my balance?"],
  ["general question", "How do I build my first budget?"],
  ["crisis message", "I want to die"],
  ["greeting with a crisis message", "hi i want to die"],
];

describe("every assembled system message keeps identity, safety first and boundaries", () => {
  for (const mode of ["off", "connection", "balances"]) {
    it.each(TURNS)(`AI_PLAID_STATE=${mode}: %s`, async (_label, text) => {
      vi.stubEnv("AI_PLAID_STATE", mode);
      expect(await post(text)).toBe(200);
      expect(systemMessages).toHaveLength(1);
      expectFixedRules(systemMessages[0]);
    });
  }

  it("with a memory block", async () => {
    memory.enabled = true;
    memory.block = "\n\n<user_memory>\n- prefers short answers\n</user_memory>";
    expect(await post("How do I build my first budget?")).toBe(200);
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]).toContain("<user_memory>");
    expectFixedRules(systemMessages[0]);
  });
});
