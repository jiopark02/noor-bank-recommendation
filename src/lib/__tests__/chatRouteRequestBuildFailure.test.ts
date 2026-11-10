import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { ChatUsageSettleInput } from "../chatUsageLedger";
import type { LlmCallRow } from "../llmCallTelemetry";
import { settledCost } from "../chatUsageLimits";

/**
 * A model attempt whose request body cannot be built — the request builder or
 * the serialization throws in our own code, before anything is sent — is
 * recorded and answered exactly as a fetch that throws:
 *
 * - one llm_calls row, error_class network_error, no HTTP status;
 * - a null entry in the usage tally, so the attempt is settled at the hold;
 * - the loop moves on to the fallback model, and when every attempt fails the
 *   response is the 502 CHAT_MODEL_FAILED every failed request gets.
 *
 * The values asserted in the first describe block were taken from the route
 * as it stood before request-building failures were told apart in the log, and
 * must not change. What does change is the [chat-model] log line, whose name
 * field says ChatRequestBuildError for such an attempt (second block).
 *
 * HOW
 * The request builder is wrapped so that it throws for the models a case
 * names. Authentication, the admin client, AI memory, the usage ledger, the
 * LLM call log and the crisis count are faked, and the rows and the settle
 * they are handed are recorded. The route runs for real; the clock is fake.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PRIMARY = "test/primary-model";
const FALLBACK = "test/fallback-model";
const START = new Date("2026-11-10T11:00:00.000Z").getTime();
const BUILD_MARKER = "REQUEST-BUILD-ERROR-TEXT";
const ATTEMPT_LINE =
  "[chat-model] attempt failed attempt=%d kind=%s upstream_status=%s cause=%s name=%s";

const build = { failFor: new Set<string>() };
const recorded = {
  rows: [] as LlmCallRow[],
  settles: [] as ChatUsageSettleInput[],
  openRouterCalls: [] as string[],
};

vi.mock("@/lib/openRouterRequest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openRouterRequest")>();
  return {
    ...actual,
    buildOpenRouterRequestBody: (
      input: Parameters<typeof actual.buildOpenRouterRequestBody>[0]
    ) => {
      if (build.failFor.has(input.model)) {
        throw new TypeError(`cannot build ${BUILD_MARKER}`);
      }
      return actual.buildOpenRouterRequestBody(input);
    },
  };
});

vi.mock("@/lib/chatUsageLedger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chatUsageLedger")>()),
  reserveChatUsage: async () => ({ allowed: true, limit: null, retryAt: null }),
  settleChatUsage: async (input: ChatUsageSettleInput) => {
    recorded.settles.push(input);
  },
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
  recordLlmCall: async (row: LlmCallRow) => {
    recorded.rows.push(row);
  },
}));

vi.mock("@/lib/aiMemory", () => ({
  isAiMemoryEnabled: () => false,
}));

let POST: typeof import("../../app/api/chat/route").POST;

beforeAll(async () => {
  ({ POST } = await import("../../app/api/chat/route"));
});

async function post(): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await POST(
    new Request("https://noor.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "How do I build my first budget?" }],
      }),
    }) as unknown as NextRequest
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  build.failFor = new Set();
  recorded.rows = [];
  recorded.settles = [];
  recorded.openRouterCalls = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-fake");
  vi.stubEnv("OPENROUTER_MODEL", PRIMARY);
  vi.stubEnv("OPENROUTER_FALLBACK_MODEL", FALLBACK);
  vi.stubEnv("AI_PLAID_STATE", "");
  vi.stubEnv("AI_SUPABASE_READ_ENABLED", "");
  vi.stubEnv("CHAT_USAGE_LIMIT_MODE", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) !== "https://openrouter.ai/api/v1/chat/completions") {
        throw new Error(`unexpected fetch: ${String(url)}`);
      }
      const model = (JSON.parse(String(init?.body)) as { model: string }).model;
      recorded.openRouterCalls.push(model);
      return new Response(
        JSON.stringify({
          id: "gen-1",
          model,
          choices: [{ message: { content: "assistant reply" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 11, completion_tokens: 7, cost: 0.0123 },
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

/** The row a thrown attempt gets, as the route wrote it before this change. */
function thrownAttemptRow(attemptIndex: number, model: string): LlmCallRow {
  return {
    started_at: new Date(START).toISOString(),
    route: "chat",
    attempt_index: attemptIndex,
    request_model: model,
    response_model: null,
    generation_id: null,
    succeeded: false,
    http_status: null,
    error_class: "network_error",
    finish_reason: null,
    latency_ms: 0,
    prompt_tokens: null,
    completion_tokens: null,
    cached_tokens: null,
    reasoning_tokens: null,
    provider_cost: null,
    has_memory_block: false,
    has_plaid_scaffold_block: false,
    has_balance_block: false,
    has_financial_snapshot_block: false,
    user_id: USER_ID,
    session_id: null,
  };
}

function consoleText(): string {
  const parts: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    for (const args of vi.mocked(console[method]).mock.calls) {
      for (const arg of args) {
        if (arg instanceof Error) {
          parts.push(`${arg.name} ${arg.message} ${arg.stack ?? ""} ${String(arg.cause)}`);
        } else {
          parts.push(typeof arg === "string" ? arg : JSON.stringify(arg) ?? String(arg));
        }
      }
    }
  }
  return parts.join("\n");
}

describe("a request body that cannot be built is recorded and answered as before", () => {
  it("on both models: 502 CHAT_MODEL_FAILED, two network_error rows, both attempts at the hold", async () => {
    build.failFor = new Set([PRIMARY, FALLBACK]);
    const res = await post();

    expect(res.status).toBe(502);
    expect(res.json).toEqual({
      error: "Chat is temporarily unavailable. Please try again.",
      code: "CHAT_MODEL_FAILED",
    });
    expect(recorded.openRouterCalls).toEqual([]);
    expect(recorded.rows).toEqual([
      thrownAttemptRow(1, PRIMARY),
      thrownAttemptRow(2, FALLBACK),
    ]);
    expect(recorded.settles).toHaveLength(1);
    expect(recorded.settles[0]).toMatchObject({
      cost: settledCost([null, null]),
      attempts: 2,
    });
  });

  it("on the first model only: the fallback answers, one network_error row then the reply's row", async () => {
    build.failFor = new Set([PRIMARY]);
    const res = await post();

    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.model).toBe(FALLBACK);
    expect(res.json.message).toBe("assistant reply");
    expect(recorded.openRouterCalls).toEqual([FALLBACK]);
    expect(recorded.rows).toHaveLength(2);
    expect(recorded.rows[0]).toEqual(thrownAttemptRow(1, PRIMARY));
    expect(recorded.rows[1]).toMatchObject({
      attempt_index: 2,
      request_model: FALLBACK,
      succeeded: true,
      error_class: null,
      http_status: 200,
    });
    expect(recorded.settles[0]).toMatchObject({
      cost: settledCost([null, 0.0123]),
      attempts: 2,
    });
  });

  it("the builder's error text reaches no log line", async () => {
    build.failFor = new Set([PRIMARY, FALLBACK]);
    await post();
    expect(consoleText()).not.toContain(BUILD_MARKER);
  });
});

describe("the [chat-model] line names a request that could not be built", () => {
  it("as ChatRequestBuildError, a network_error with no status and no cause code", async () => {
    build.failFor = new Set([PRIMARY, FALLBACK]);
    await post();
    expect(
      vi.mocked(console.warn).mock.calls.filter((args) => args[0] === ATTEMPT_LINE)
    ).toEqual([
      [ATTEMPT_LINE, 1, "network_error", "none", "none", "ChatRequestBuildError"],
      [ATTEMPT_LINE, 2, "network_error", "none", "none", "ChatRequestBuildError"],
    ]);
  });
});
