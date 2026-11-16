import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { PlaidTokenCryptoError } from "../plaidTokenCrypto";

/**
 * What the chat route records in llm_calls about its bank block, against what
 * the model was actually sent.
 *
 *   has_plaid_scaffold_block  the "What you can see this turn" block is in the
 *                             system message: every mode but "off", whatever
 *                             the read came to (the read-error fallback too).
 *   has_balance_block         the block carries per-account balance lines.
 *
 * Authentication, the admin client, AI memory, the bank-state read, the chat
 * usage ledger and the crisis notice count are faked; the llm_calls write is
 * captured. The route, the egress policy, the depth decision and the block
 * builder run for real.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";

const fake = {
  /** At depth "balances": "read", "needs_reconnect", or "throw". */
  read: "read" as "read" | "needs_reconnect" | "throw",
  /** What the read throws when read is "throw". */
  error: new Error("bank read failed") as unknown,
};

const rows: Array<Record<string, unknown>> = [];
let systemMessages: string[] = [];

function chain(result: { data: unknown; error: null }): unknown {
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (
            onFulfilled: (value: unknown) => unknown,
            onRejected: (reason: unknown) => unknown
          ) => Promise.resolve(result).then(onFulfilled, onRejected);
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
  getAuthenticatedUserIdFromRequest: async () => USER_ID,
}));

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({ from: () => chain({ data: null, error: null }) }),
  isSupabaseAdminConfigured: () => false,
  isSupabaseConfigured: () => false,
}));

vi.mock("@/lib/llmCallLog", () => ({
  recordLlmCall: async (row: Record<string, unknown>) => {
    rows.push(row);
  },
}));

vi.mock("@/lib/aiMemory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../aiMemory")>()),
  isAiMemoryEnabled: () => false,
  getOrCreateActiveSession: async () => ({ id: "session-1" }),
  getActiveSession: async () => ({ id: "session-1" }),
  saveMessages: async () => ({}),
  getSessionMessages: async () => [],
}));

vi.mock("@/lib/plaidChatState", () => ({
  getPlaidChatState: async (_userId: string, opts: { depth: string }) => {
    if (opts.depth !== "balances") {
      return {
        depth: opts.depth,
        connected: true,
        connections: [{ institution: "Test Bank", status: "active" }],
      };
    }
    if (fake.read === "throw") throw fake.error;
    return {
      depth: opts.depth,
      connected: true,
      connections: [{ institution: "Test Bank", status: "active", read: fake.read }],
      accounts:
        fake.read === "read"
          ? [
              {
                label: "Everyday Checking",
                kind: "checking",
                balanceStatus: "known",
                current: 812.34,
                available: 790.12,
                currency: "USD",
              },
            ]
          : [],
    };
  },
}));

let POST: typeof import("../../app/api/chat/route").POST;

beforeAll(async () => {
  ({ POST } = await import("../../app/api/chat/route"));
});

beforeEach(() => {
  rows.length = 0;
  systemMessages = [];
  fake.read = "read";
  fake.error = new Error("bank read failed");
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-fake");
  vi.stubEnv("OPENROUTER_MODEL", "test/model");
  vi.stubEnv("OPENROUTER_FALLBACK_MODEL", "");
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
        messages: Array<{ content: string }>;
      };
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

const TURNS: Array<[string, string]> = [
  ["greeting", "hi"],
  ["balance question", "what's my balance?"],
  ["general question", "How do I build my first budget?"],
];

const CASES: Array<{ name: string; mode: string; text: string; read: typeof fake.read }> = [];
for (const mode of ["off", "connection", "balances"]) {
  for (const [label, text] of TURNS) {
    for (const read of ["read", "needs_reconnect", "throw"] as const) {
      CASES.push({ name: `${mode} / ${label} / ${read}`, mode, text, read });
    }
  }
}

describe("the bank-block flags written to llm_calls", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    vi.stubEnv("AI_PLAID_STATE", c.mode);
    fake.read = c.read;

    expect(await post(c.text)).toBe(200);
    expect(rows).toHaveLength(1);
    expect(systemMessages).toHaveLength(1);
    const system = systemMessages[0];
    const accountLines = system.includes("<bank_data>") && system.includes("\nAccounts:\n");

    expect(rows[0].has_plaid_scaffold_block).toBe(system.includes("## What you can see this turn"));
    expect(rows[0].has_plaid_scaffold_block).toBe(c.mode !== "off");
    expect(rows[0].has_balance_block).toBe(accountLines);
  });

  it("the balance flag is set on the turns that carry balances, and only those", async () => {
    const flagged: string[] = [];
    for (const c of CASES) {
      rows.length = 0;
      systemMessages = [];
      vi.stubEnv("AI_PLAID_STATE", c.mode);
      fake.read = c.read;
      expect(await post(c.text)).toBe(200);
      if (rows[0].has_balance_block === true) flagged.push(c.name);
    }
    expect(flagged).toEqual([
      "connection / balance question / read",
      "balances / balance question / read",
      "balances / general question / read",
    ]);
  });
});

describe("the bank-read failure log line", () => {
  const SECRET = "SECRET-DETAIL-MARKER";

  function namedReadError(code: string | null): Error {
    const error = new Error(`getPlaidChatState: failed to read plaid_connections: ${SECRET}`);
    error.name = "PlaidConnectionReadError";
    return Object.assign(error, { code });
  }

  it.each([
    ["a failed connection read", () => namedReadError("PGRST301"), "db_read", "PGRST301"],
    ["a failed connection read with no code", () => namedReadError(null), "db_read", "none"],
    [
      "a key fault",
      () => new PlaidTokenCryptoError("auth_failed", SECRET),
      "decrypt",
      "auth_failed",
    ],
    ["anything else", () => new Error(SECRET), "unknown", "none"],
  ] as const)("%s: cause and code only, and the turn still reaches the model", async (_name, make, cause, reason) => {
    vi.stubEnv("AI_PLAID_STATE", "balances");
    fake.read = "throw";
    fake.error = make();

    expect(await post("what's my balance?")).toBe(200);
    expect(systemMessages[0]).toContain("could not be read this turn");
    const lines = vi
      .mocked(console.error)
      .mock.calls.filter((args) => String(args[0]).startsWith("[plaid-state]"));
    expect(lines).toEqual([
      ["[plaid-state] read failed cause=%s reason=%s; using unknown-state fallback", cause, reason],
    ]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(SECRET);
  });
});
