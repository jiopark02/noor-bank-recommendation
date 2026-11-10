import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The request body POST /api/chat sends to OpenRouter, byte for byte.
 *
 * Each case below assembles one kind of turn and compares the SHA-256 and the
 * byte length of the whole request body (model, routing preferences, system
 * message, conversation) with a recorded value. The values were recorded from
 * the route as it stood when this file was added. A change to the route that
 * is not meant to change what the model receives must leave this file
 * untouched and passing; a change that is meant to must say so by editing the
 * recorded values.
 *
 * HOW
 * Authentication, the admin client, AI memory, the Plaid state read, the chat
 * usage ledger, LLM call logging and the crisis notice count are faked. The
 * route, the prompt builder, the Plaid egress policy and block builder, the
 * stored-history builder and the OpenRouter request builder run for real.
 *
 * The fakes answer with fixed data whatever arguments they are given, and the
 * admin client accepts any chain of query-builder methods, so a route change
 * that passes an extra option to one of them does not need this file edited.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * It covers the turns listed here, on requests where every read answers. It
 * says nothing about what the real database, Plaid or memory rows contain.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";

const state = {
  /** Profile rows, memory block and stored history present. */
  full: false,
  plaidStateFails: false,
  balanceReadFails: false,
};

const PROFILE_ROWS: Record<string, Record<string, unknown>> = {
  users: { first_name: "Ada", last_name: "Lovelace" },
  survey_responses: {
    university: "State University",
    institution_type: "public",
    has_us_credit_history: false,
    // Below 1000, so toLocaleString adds no locale-dependent separator.
    monthly_income: 950,
    campus_side: "north",
    expected_monthly_spending: 800,
  },
};

const MEMORY_BLOCK =
  "\n\n<user_memory>\n## Remembered facts\n- [goal] wants to save for a laptop\n</user_memory>";

const STORED_TURNS: Array<{ role: "user" | "assistant"; content: string }> = [
  { role: "user", content: "What is an emergency fund?" },
  { role: "assistant", content: "An emergency fund is money set aside for surprises." },
];

/**
 * A query builder that accepts any method and resolves to `result` when
 * awaited, whichever method the chain ends on.
 */
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
  createAdminClient: () => ({
    from: (table: string) =>
      chain({ data: PROFILE_ROWS[table] ?? null, error: null }),
  }),
  isSupabaseAdminConfigured: () => state.full,
  isSupabaseConfigured: () => false,
}));

vi.mock("@/lib/llmCallLog", () => ({
  recordLlmCall: async () => undefined,
}));

vi.mock("@/lib/aiMemory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../aiMemory")>()),
  isAiMemoryEnabled: () => state.full,
  getOrCreateActiveSession: async () => ({ id: "session-1" }),
  getActiveSession: async () => ({ id: "session-1" }),
  buildMemoryContext: async () => ({
    facts: [],
    recentSummaries: [],
    activeSessionId: "session-1",
  }),
  formatMemoryForPrompt: () => MEMORY_BLOCK,
  saveMessages: async () => ({}),
  // Newest first, as the route asks for.
  getSessionMessages: async () =>
    STORED_TURNS.map((row, i) => ({
      id: `m${i}`,
      session_id: "session-1",
      user_id: USER_ID,
      role: row.role,
      content: row.content,
      model: null,
      input_tokens: null,
      output_tokens: null,
      created_at: new Date(Date.UTC(2026, 9, 27, 0, 0, i)).toISOString(),
    })).reverse(),
}));

vi.mock("@/lib/plaidChatState", () => ({
  getPlaidChatState: async (_userId: string, opts: { depth: string }) => {
    if (state.plaidStateFails) throw new Error("plaid state read failed");
    return {
      depth: opts.depth,
      connected: true,
      connections: [
        { institution: "Test Bank", status: "active" },
        { institution: "Old Credit Union", status: "error" },
      ],
      accounts:
        opts.depth === "balances"
          ? [
              {
                label: "Everyday Checking",
                kind: "checking",
                balanceStatus: "known",
                current: 812.34,
                available: 790.12,
                currency: "USD",
              },
              { label: "Rainy Day", kind: "savings", balanceStatus: "unavailable" },
            ]
          : undefined,
    };
  },
}));

let bodies: string[] = [];

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
  state.full = false;
  state.plaidStateFails = false;
  state.balanceReadFails = false;
  bodies = [];
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
      const target = String(url);
      if (target === "https://noor.test/api/plaid/accounts") {
        if (state.balanceReadFails) throw new TypeError("fetch failed");
        return new Response(
          JSON.stringify({
            accounts: [
              {
                type: "checking",
                name: "Everyday Checking",
                current_balance: 812.34,
                available_balance: 790.12,
                iso_currency_code: "USD",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (target !== "https://openrouter.ai/api/v1/chat/completions") {
        throw new Error(`unexpected fetch: ${target}`);
      }
      const body = String(init?.body);
      bodies.push(body);
      return new Response(
        JSON.stringify({
          id: "gen-1",
          model: (JSON.parse(body) as { model: string }).model,
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

interface Digest {
  bytes: number;
  sha256: string;
}

function digest(body: string): Digest {
  return {
    bytes: Buffer.byteLength(body, "utf8"),
    sha256: createHash("sha256").update(body, "utf8").digest("hex"),
  };
}

interface Case {
  name: string;
  full: boolean;
  mode: string;
  text: string;
  plaidStateFails?: boolean;
  balanceReadFails?: boolean;
}

const TURNS: Array<[string, string]> = [
  ["greeting", "hi"],
  ["balance question", "what's my balance?"],
  ["general question", "How do I build my first budget?"],
  ["crisis message", "I want to die"],
  ["greeting with a crisis message", "hi i want to die"],
];

const CASES: Case[] = [];
for (const full of [false, true]) {
  for (const mode of ["off", "connection", "balances"]) {
    for (const [label, text] of TURNS) {
      CASES.push({
        name: `${full ? "profile, memory and history" : "no stored context"} / ${mode} / ${label}`,
        full,
        mode,
        text,
      });
    }
  }
}
// Reads that answer with an error, not ones that are still waiting.
CASES.push({
  name: "profile, memory and history / connection / balance question / balance read fails",
  full: true,
  mode: "connection",
  text: "what's my balance?",
  balanceReadFails: true,
});
CASES.push({
  name: "profile, memory and history / balances / general question / Plaid state read fails",
  full: true,
  mode: "balances",
  text: "How do I build my first budget?",
  plaidStateFails: true,
});

const EXPECTED: Record<string, Digest> = {
  "no stored context / off / greeting": {
    bytes: 8104,
    sha256: "afceef006f1e6fd32064b099924d3fb06b4e8fbdd27a88366c9eb8c3eda0671f",
  },
  "no stored context / off / balance question": {
    bytes: 7855,
    sha256: "e7fbb608fc16116513318a3574d621ef5b6e7d0efe3da699f15b2416e47de218",
  },
  "no stored context / off / general question": {
    bytes: 7868,
    sha256: "3db49445edca7a3083ed36f05413fed523f5d8b8dbeea3d74993f452b701e3ef",
  },
  "no stored context / off / crisis message": {
    bytes: 8034,
    sha256: "b24f89c57321ad99efb7965578e699c1bc9583eff3290c10a7b0cf4dc3d28d9c",
  },
  "no stored context / off / greeting with a crisis message": {
    bytes: 8037,
    sha256: "2656f0a86df8d4df434a7e18c3a81fddfee848fc5412f7b87d7be9bf28dca2c2",
  },
  "no stored context / connection / greeting": {
    bytes: 9227,
    sha256: "b54f3776c67dc6accab38e787c154a3015f5d41005c5e3066c69dee9d3559299",
  },
  "no stored context / connection / balance question": {
    bytes: 9259,
    sha256: "2f976fa7e089548a65bbaf1d7e8df4629cde935010c5931dbfeba48bd43ecf79",
  },
  "no stored context / connection / general question": {
    bytes: 8991,
    sha256: "191451d671c0e3a7f0a73f910f5f36a1b5dc48475d351a78fb29fefde7636788",
  },
  "no stored context / connection / crisis message": {
    bytes: 9157,
    sha256: "37ce03cc88c327f618d77aba8321e3312ca9b925d056511a12cc90261b4ccaf1",
  },
  "no stored context / connection / greeting with a crisis message": {
    bytes: 9160,
    sha256: "ce343dcecadd7154e38fa00801ea62c178030e579f33ed916048a0b413a3ebf2",
  },
  "no stored context / balances / greeting": {
    bytes: 9227,
    sha256: "b54f3776c67dc6accab38e787c154a3015f5d41005c5e3066c69dee9d3559299",
  },
  "no stored context / balances / balance question": {
    bytes: 9363,
    sha256: "e963e302f2481196db66e96f98b28dad870c56c328bd8c5f556e341cf3689559",
  },
  "no stored context / balances / general question": {
    bytes: 9376,
    sha256: "be9c145bae9a104e2fbd9088ecacd3753a3c6b34596a517711f9a30149e24bd3",
  },
  "no stored context / balances / crisis message": {
    bytes: 9542,
    sha256: "3d7ff1e0a972207d0a7c5c5c08f9f2db778fe3464f0207a988e67aeb7e057a42",
  },
  "no stored context / balances / greeting with a crisis message": {
    bytes: 9545,
    sha256: "7e834e4d1a2bdadcdfb9c184417fa439bbfa51bd31d8c324affea9bc5bad527d",
  },
  "profile, memory and history / off / greeting": {
    bytes: 8411,
    sha256: "c284fd6a6eae38da87acec1b7caa8eab95d1fe162f082e5551f075d6aa9466c1",
  },
  "profile, memory and history / off / balance question": {
    bytes: 8162,
    sha256: "5c366415d0973a142ee9d851e9a4e78bd7b257ecf852599dfb6211a42b66a10a",
  },
  "profile, memory and history / off / general question": {
    bytes: 8175,
    sha256: "8568a69fe91e3de67a17cb56c216c91c0dbe494bbb01153a25503e63c6304c86",
  },
  "profile, memory and history / off / crisis message": {
    bytes: 8341,
    sha256: "f14c04ee70b21bcd003c6706faab0fb758a851a127c8fa89698d0e8afdb9a537",
  },
  "profile, memory and history / off / greeting with a crisis message": {
    bytes: 8344,
    sha256: "59ccd56d5b03a24a86d090836c80f1c6e39d902cb75976d9b65e2a2ea4e856c5",
  },
  "profile, memory and history / connection / greeting": {
    bytes: 9534,
    sha256: "0a5faf9d35fb8d14aba88e8fe5519ddc4cca40391f75fa8c7bfd27b48ea0ca69",
  },
  "profile, memory and history / connection / balance question": {
    bytes: 9566,
    sha256: "675a0bbd2c924b62d70e04d101182a0021cb6b1d03ad6b0fae03bce1c0f0090c",
  },
  "profile, memory and history / connection / general question": {
    bytes: 9298,
    sha256: "c65f66a5ec523f013e7e8cb77ca14fbec9f8f7f72e7dda69a85f6a0a92773b12",
  },
  "profile, memory and history / connection / crisis message": {
    bytes: 9464,
    sha256: "2ef5aebc7e5ceacc74c303bbc6ebdc37425d0bb2f3d8a56d94da5cc9eac97783",
  },
  "profile, memory and history / connection / greeting with a crisis message": {
    bytes: 9467,
    sha256: "39c215c73ff6ba1d3bc76a45c74a0054ce3c4a95993a56b4c243f57f911f0ce4",
  },
  "profile, memory and history / balances / greeting": {
    bytes: 9534,
    sha256: "0a5faf9d35fb8d14aba88e8fe5519ddc4cca40391f75fa8c7bfd27b48ea0ca69",
  },
  "profile, memory and history / balances / balance question": {
    bytes: 9670,
    sha256: "46eece52d1e92932add85e8ccf5e24057c602a41c348dc1e0454dc322530f7e4",
  },
  "profile, memory and history / balances / general question": {
    bytes: 9683,
    sha256: "834f0cac6c93caea516d1bfccf462849fc9aa7331cdeec2ec868a7f63975ef93",
  },
  "profile, memory and history / balances / crisis message": {
    bytes: 9849,
    sha256: "9a8cf0f28d868eb07bc66ab627de91c1ae9cdd5873368d2bad4ff5041cbaff05",
  },
  "profile, memory and history / balances / greeting with a crisis message": {
    bytes: 9852,
    sha256: "db26bfa25d3e6147bd48076b2e58508931865328c4170dd0c82ea86fed0e884f",
  },
  "profile, memory and history / connection / balance question / balance read fails": {
    bytes: 9447,
    sha256: "617b8ebfab143d255a006bc8d735e54b6ec14f9730b1fae139bd1bada56b27b4",
  },
  "profile, memory and history / balances / general question / Plaid state read fails": {
    bytes: 9269,
    sha256: "355394da1d7aa1aaff58f376079f5da437751e845f14d0bffa91a856e5aa4ff3",
  },
};

describe("the OpenRouter request body is unchanged", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    state.full = c.full;
    state.plaidStateFails = c.plaidStateFails === true;
    state.balanceReadFails = c.balanceReadFails === true;
    vi.stubEnv("AI_PLAID_STATE", c.mode);
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", c.full ? "true" : "");

    expect(await post(c.text)).toBe(200);
    expect(bodies).toHaveLength(1);
    expect(digest(bodies[0])).toEqual(EXPECTED[c.name]);
  });

  it("has a recorded value for every case, and no other", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(CASES.map((c) => c.name).sort());
  });
});

describe("the cases carry the blocks their names say", () => {
  // A digest says nothing about what was hashed. These hold that the fakes
  // reach the request body, so the digests above cover those blocks.
  it("profile, memory, stored turns, Plaid block and balance snapshot under connection", async () => {
    state.full = true;
    vi.stubEnv("AI_PLAID_STATE", "connection");
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");

    expect(await post("what's my balance?")).toBe(200);
    const body = JSON.parse(bodies[0]) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0].content;
    expect(system).toContain("- Name: Ada Lovelace");
    expect(system).toContain("- Credit history: No credit history yet");
    expect(system).toContain("- Monthly income: $950");
    expect(system).toContain("- Monthly spending: $800");
    expect(system).toContain(MEMORY_BLOCK);
    expect(system).toContain("Test Bank");
    expect(system).toContain("## Verified Balance Snapshot");
    expect(system).toContain("$790.12");
    expect(body.messages.slice(1)).toEqual([
      ...STORED_TURNS,
      { role: "user", content: "what's my balance?" },
    ]);
  });

  it("per-account balances under balances", async () => {
    state.full = true;
    vi.stubEnv("AI_PLAID_STATE", "balances");
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");

    expect(await post("How do I build my first budget?")).toBe(200);
    const system = (
      JSON.parse(bodies[0]) as { messages: Array<{ content: string }> }
    ).messages[0].content;
    expect(system).toContain("Everyday Checking");
    expect(system).toContain("Rainy Day");
  });
});
