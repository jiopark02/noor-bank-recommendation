import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import type {
  ChatUsageDecision,
  ChatUsageReserveInput,
  ChatUsageSettleInput,
} from "../chatUsageLedger";
import { ChatUsageCheckError } from "../chatUsageLedger";

/**
 * POST /api/chat runs the chat usage limit after the input limits and before
 * anything that costs. These tests run the route with the ledger mocked and
 * hold: the mode switch (unset enforces, observe never refuses, off makes no
 * call), fail-closed under enforce, and exactly one settle per admitted
 * request, from the tally the model attempts appended to, on every exit.
 *
 * HOW
 * Same harness as chatRouteInputLimits.test.ts: authentication, the admin
 * client, AI memory and LLM call logging are mocked, the route and the
 * OpenRouter request builder run for real, and fetch is stubbed. Unset model
 * env vars give the simple model first and the complex model as fallback.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";

const memory = {
  enabled: false,
  loadFails: false,
  saveFails: false,
  saved: 0,
};

type Reserve = (input: ChatUsageReserveInput) => Promise<ChatUsageDecision>;

const usage = {
  reserve: (async () => ({ allowed: true, limit: null, retryAt: null })) as Reserve,
  reserveInputs: [] as ChatUsageReserveInput[],
  settled: [] as ChatUsageSettleInput[],
};

vi.mock("@/lib/chatUsageLedger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chatUsageLedger")>()),
  reserveChatUsage: async (input: ChatUsageReserveInput) => {
    usage.reserveInputs.push(input);
    return usage.reserve(input);
  },
  // A macrotask before recording, so a settle the route does not await lands
  // after the response and settledAtResponse sees it missing.
  settleChatUsage: async (input: ChatUsageSettleInput) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    usage.settled.push(input);
  },
}));

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => USER_ID,
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
  buildMemoryContext: async () => {
    if (memory.loadFails) throw new Error("memory down");
    return { facts: [], recentSummaries: [], activeSessionId: "session-1" };
  },
  formatMemoryForPrompt: () => "",
  saveMessages: async () => {
    if (memory.saveFails) throw new Error("save down");
    memory.saved += 1;
    return {};
  },
  getSessionMessages: async () => [],
}));

/** One scripted OpenRouter answer per attempt, in order. */
type Answer =
  | { kind: "ok"; cost?: number }
  | { kind: "status"; status: number }
  | { kind: "throw" };

let answers: Answer[] = [];
let fetchCalls = 0;

function okBody(model: string, cost?: number): string {
  return JSON.stringify({
    id: "gen-1",
    model,
    choices: [{ message: { content: "assistant reply" }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 7,
      ...(cost === undefined ? {} : { cost }),
    },
  });
}

function chatRequest(): NextRequest {
  return new Request("https://noor.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  }) as unknown as NextRequest;
}

async function post(): Promise<{
  status: number;
  headers: Headers;
  json: Record<string, unknown>;
  settledAtResponse: number;
}> {
  const { POST } = await import("../../app/api/chat/route");
  const res = await POST(chatRequest());
  const settledAtResponse = usage.settled.length;
  return {
    status: res.status,
    headers: res.headers,
    json: (await res.json()) as Record<string, unknown>,
    settledAtResponse,
  };
}

const REFUSED: ChatUsageDecision = {
  allowed: false,
  limit: "day",
  retryAt: "2026-10-17T12:00:00.000Z",
};

beforeEach(() => {
  memory.enabled = false;
  memory.loadFails = false;
  memory.saveFails = false;
  memory.saved = 0;
  usage.reserve = async () => ({ allowed: true, limit: null, retryAt: null });
  usage.reserveInputs = [];
  usage.settled = [];
  answers = [{ kind: "ok", cost: 0.0123 }];
  fetchCalls = 0;
  vi.resetModules();
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
      fetchCalls += 1;
      const body = JSON.parse(String(init?.body)) as { model: string };
      const answer = answers.shift() ?? { kind: "throw" };
      if (answer.kind === "throw") throw new TypeError("fetch failed");
      if (answer.kind === "status") {
        return new Response(
          JSON.stringify({ error: { message: `upstream ${answer.status}` } }),
          { status: answer.status, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(okBody(body.model, answer.cost), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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
  vi.resetModules();
});

describe("enforce (the default)", () => {
  it("reserves with the verified user id, in enforce mode, when the mode is unset", async () => {
    const res = await post();
    expect(usage.reserveInputs).toHaveLength(1);
    expect(usage.reserveInputs[0].userId).toBe(USER_ID);
    expect(usage.reserveInputs[0].mode).toBe("enforce");
    expect(usage.reserveInputs[0].reservationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
    });
  });

  it("a hit limit: 429 USAGE_LIMIT_REACHED with Retry-After, no model call, no save, no settle", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T11:00:00.500Z"));
    memory.enabled = true;
    usage.reserve = async () => REFUSED;
    const res = await post();
    vi.useRealTimers();
    expect(res.status).toBe(429);
    expect(res.json).toEqual({
      error: "You've reached the chat limit for the last 24 hours. Please try again later.",
      code: "USAGE_LIMIT_REACHED",
      limit: "day",
      retryAt: "2026-10-17T12:00:00.000Z",
    });
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect(fetchCalls).toBe(0);
    expect(memory.saved).toBe(0);
    expect(res.settledAtResponse).toBe(0);
    expect(usage.settled).toHaveLength(0);
  });

  it("an unrecognized mode enforces and logs", async () => {
    vi.stubEnv("CHAT_USAGE_LIMIT_MODE", "Off");
    usage.reserve = async () => REFUSED;
    const res = await post();
    expect(res.status).toBe(429);
    expect(usage.reserveInputs[0].mode).toBe("enforce");
    expect(
      vi.mocked(console.error).mock.calls.some(
        (args) => args[0] === "[chat-usage] unrecognized CHAT_USAGE_LIMIT_MODE; enforcing"
      )
    ).toBe(true);
  });

  it("a check that cannot be made: 503 USAGE_CHECK_UNAVAILABLE, no model call, one settle at zero", async () => {
    usage.reserve = async () => {
      throw new ChatUsageCheckError("timeout", null);
    };
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.json).toEqual({
      error: "Chat is temporarily unavailable. Please try again shortly.",
      code: "USAGE_CHECK_UNAVAILABLE",
    });
    expect(fetchCalls).toBe(0);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      userId: USER_ID,
      cost: 0,
      attempts: 0,
    });
  });

  it("an unexpected throw from reserve is also 503", async () => {
    usage.reserve = async () => {
      throw new Error("anything");
    };
    const res = await post();
    expect(res.status).toBe(503);
    expect(fetchCalls).toBe(0);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
    });
  });
});

describe("observe", () => {
  beforeEach(() => {
    vi.stubEnv("CHAT_USAGE_LIMIT_MODE", "observe");
  });

  it("reserves in observe mode", async () => {
    await post();
    expect(usage.reserveInputs[0].mode).toBe("observe");
  });

  it("a hit limit does not refuse: 200, and the request is settled", async () => {
    usage.reserve = async () => REFUSED;
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(fetchCalls).toBe(1);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0.0123,
      attempts: 1,
    });
  });

  it("a check that cannot be made does not refuse: 200, and the request is settled", async () => {
    usage.reserve = async () => {
      throw new ChatUsageCheckError("rpc_error", "42883");
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(fetchCalls).toBe(1);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0.0123,
      attempts: 1,
    });
  });
});

describe("off", () => {
  it("makes no reserve and no settle, and the request proceeds", async () => {
    vi.stubEnv("CHAT_USAGE_LIMIT_MODE", "off");
    const res = await post();
    expect(res.status).toBe(200);
    expect(usage.reserveInputs).toHaveLength(0);
    expect(res.settledAtResponse).toBe(0);
    expect(usage.settled).toHaveLength(0);
  });
});

describe("one settle per admitted request, from the attempt tally", () => {
  it("success: one attempt at its reported cost", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toEqual([
      {
        reservationId: usage.reserveInputs[0].reservationId,
        userId: USER_ID,
        cost: 0.0123,
        attempts: 1,
      },
    ]);
  });

  it("success without a reported cost: one attempt at the hold", async () => {
    answers = [{ kind: "ok" }];
    const res = await post();
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0.05,
      attempts: 1,
    });
  });

  it("fallback: the failed attempt at the hold plus the successful one's cost", async () => {
    answers = [{ kind: "status", status: 500 }, { kind: "ok", cost: 0.01 }];
    const res = await post();
    expect(res.status).toBe(200);
    expect(fetchCalls).toBe(2);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0.06,
      attempts: 2,
    });
  });

  it("SAVE_FAILED: settled at the attempt's cost", async () => {
    memory.enabled = true;
    memory.saveFails = true;
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json.code).toBe("SAVE_FAILED");
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0.0123,
      attempts: 1,
    });
  });

  it("every model failed: both attempts at the hold", async () => {
    answers = [
      { kind: "status", status: 500 },
      { kind: "status", status: 502 },
    ];
    const res = await post();
    expect(res.status).toBe(502);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0.1,
      attempts: 2,
    });
  });

  it("upstream 401: one attempt at the hold", async () => {
    answers = [{ kind: "status", status: 401 }];
    const res = await post();
    expect(res.status).toBe(401);
    expect(fetchCalls).toBe(1);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0.05,
      attempts: 1,
    });
  });

  it("upstream 429 on both models: the response is unchanged and both attempts are settled", async () => {
    answers = [
      { kind: "status", status: 429 },
      { kind: "status", status: 429 },
    ];
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.json).toEqual({ error: "Rate limit exceeded. Please try again later." });
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0.1,
      attempts: 2,
    });
  });

  it("fetch throws (outer catch): one attempt at the hold", async () => {
    answers = [{ kind: "throw" }];
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "Failed to get response from AI" });
    expect(fetchCalls).toBe(1);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0.05,
      attempts: 1,
    });
  });

  it("memory 503: settled at zero, no model call", async () => {
    memory.enabled = true;
    memory.loadFails = true;
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("MEMORY_LOAD_FAILED");
    expect(fetchCalls).toBe(0);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0,
      attempts: 0,
    });
  });

  it("no OpenRouter key 503: settled at zero, no model call", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const res = await post();
    expect(res.status).toBe(503);
    expect(fetchCalls).toBe(0);
    expect(res.settledAtResponse).toBe(1);
    expect(usage.settled).toHaveLength(1);
    expect(usage.settled[0]).toMatchObject({
      reservationId: usage.reserveInputs[0].reservationId,
      cost: 0,
      attempts: 0,
    });
  });
});
