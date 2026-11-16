import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { CRISIS_NOTICES } from "../crisisNotice";

/**
 * POST /api/chat answers a request whose model attempts all failed with one
 * response, whichever way each attempt failed: 502 with a fixed message and
 * the code CHAT_MODEL_FAILED. Nothing from the provider reaches the client
 * (no upstream status, no upstream error text), and the server log names each
 * failed attempt by its kind, its upstream status and, for an attempt that
 * threw, the network cause code and the error's name, each only when it is in
 * the expected form. The thrown error's message is never logged. The kind
 * logged is the error class the attempt's llm_calls row is given. A request
 * body that could not be built is covered by
 * chatRouteRequestBuildFailure.test.ts.
 *
 * HOW
 * Same harness as chatRouteCrisis.test.ts: authentication, the admin client,
 * AI memory, the chat usage ledger, LLM call logging and the crisis notice
 * count are mocked; the route, the prompt builder and the OpenRouter request
 * builder run for real; fetch is stubbed and scripted per attempt. Every
 * scripted failure carries a marker string, in the provider's error body or in
 * the thrown error, so its absence from the response and the log can be held.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * That the llm_calls write reaches the database (llmCallLog.test.ts), or how
 * the usage reservation is settled (chatRouteUsageLimit.test.ts). An attempt
 * cut off while its body is being read is not scripted here: its row keeps
 * the status that had arrived, and its log line says "none".
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const UPSTREAM_MARKER = "UPSTREAM-ERROR-TEXT";
const THROWN_MARKER = "THROWN-ERROR-TEXT";

const FAILED_BODY = {
  error: "Chat is temporarily unavailable. Please try again.",
  code: "CHAT_MODEL_FAILED",
};
const ATTEMPT_LINE =
  "[chat-model] attempt failed attempt=%d kind=%s upstream_status=%s cause=%s name=%s";

const supabaseState = { adminConfigured: false };

const usage = { onReserve: (): void => undefined };

vi.mock("@/lib/chatUsageLedger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chatUsageLedger")>()),
  reserveChatUsage: async () => {
    usage.onReserve();
    return { allowed: true, limit: null, retryAt: null };
  },
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
  isSupabaseAdminConfigured: () => supabaseState.adminConfigured,
}));

/** The rows the route hands to recordLlmCall, in order. */
let llmRows: Array<{ attempt_index: number; error_class: string | null }> = [];

vi.mock("@/lib/llmCallLog", () => ({
  recordLlmCall: async (row: { attempt_index: number; error_class: string | null }) => {
    llmRows.push(row);
  },
}));

vi.mock("@/lib/aiMemory", () => ({
  isAiMemoryEnabled: () => false,
}));

/**
 * A scripted throw is a fetch failure whose cause carries `causeCode`
 * (ECONNRESET unless given). `noCause` throws an error with no cause at all.
 * `name`, when given, replaces the thrown error's name (TypeError otherwise).
 */
type Answer =
  | { kind: "ok" }
  | { kind: "status"; status: number }
  | { kind: "throw"; causeCode?: unknown; noCause?: true; name?: unknown };

let answers: Answer[] = [];
let fetchCalls = 0;

let POST: typeof import("../../app/api/chat/route").POST;

beforeAll(async () => {
  ({ POST } = await import("../../app/api/chat/route"));
});

async function post(text = "How do I build my first budget?"): Promise<{
  status: number;
  headers: Headers;
  text: string;
  json: Record<string, unknown>;
}> {
  const res = await POST(
    new Request("https://noor.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
    }) as unknown as NextRequest
  );
  const text_ = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text: text_,
    json: JSON.parse(text_) as Record<string, unknown>,
  };
}

beforeEach(() => {
  supabaseState.adminConfigured = false;
  usage.onReserve = () => undefined;
  llmRows = [];
  answers = [];
  fetchCalls = 0;
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
      const answer = answers.shift() ?? { kind: "throw" };
      if (answer.kind === "throw") {
        const thrown = answer.noCause
          ? new TypeError(`fetch failed ${THROWN_MARKER}`)
          : new TypeError(`fetch failed ${THROWN_MARKER}`, {
              cause: Object.assign(new Error(`connect failed ${THROWN_MARKER}`), {
                code: "causeCode" in answer ? answer.causeCode : "ECONNRESET",
              }),
            });
        if ("name" in answer) {
          // An own property, so it is what the route reads.
          Object.defineProperty(thrown, "name", { value: answer.name });
        }
        throw thrown;
      }
      if (answer.kind === "status") {
        return new Response(
          JSON.stringify({
            error: { message: `${UPSTREAM_MARKER} ${answer.status}`, code: answer.status },
          }),
          { status: answer.status, headers: { "content-type": "application/json" } }
        );
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

/** Every console call, flattened to text, errors included with their causes. */
function consoleText(): string {
  const render = (value: unknown): string => {
    if (value instanceof Error) {
      return `${value.name}: ${value.message} ${value.stack ?? ""} ${render(value.cause)}`;
    }
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  const parts: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    for (const args of vi.mocked(console[method]).mock.calls) {
      parts.push(args.map(render).join(" "));
    }
  }
  return parts.join("\n");
}

function attemptLines(): unknown[][] {
  return vi
    .mocked(console.warn)
    .mock.calls.filter((args) => args[0] === ATTEMPT_LINE);
}

describe("every way the model attempts can all fail gives the same response", () => {
  const SCRIPTS: Array<[string, Answer[], number]> = [
    ["a rejected key on the first model", [{ kind: "status", status: 401 }], 1],
    [
      "a provider error on both models",
      [
        { kind: "status", status: 500 },
        { kind: "status", status: 502 },
      ],
      2,
    ],
    [
      "a rate limit on both models",
      [
        { kind: "status", status: 429 },
        { kind: "status", status: 429 },
      ],
      2,
    ],
    ["a throw on both models", [{ kind: "throw" }, { kind: "throw" }], 2],
    [
      "a throw, then a provider error",
      [{ kind: "throw" }, { kind: "status", status: 503 }],
      2,
    ],
    [
      "a provider error, then a throw",
      [{ kind: "status", status: 500 }, { kind: "throw" }],
      2,
    ],
    [
      "a client error on both models",
      [
        { kind: "status", status: 404 },
        { kind: "status", status: 402 },
      ],
      2,
    ],
  ];

  it.each(SCRIPTS)("%s: 502 CHAT_MODEL_FAILED and nothing else", async (_label, script, calls) => {
    answers = script.slice();
    const res = await post();
    expect(res.status).toBe(502);
    expect(res.json).toEqual(FAILED_BODY);
    expect(res.headers.get("retry-after")).toBeNull();
    expect(fetchCalls).toBe(calls);
  });

  it.each(SCRIPTS)("%s: no provider or error text in the response or the log", async (_label, script) => {
    answers = script.slice();
    const res = await post();
    expect(res.text).not.toContain(UPSTREAM_MARKER);
    expect(res.text).not.toContain(THROWN_MARKER);
    const logged = consoleText();
    expect(logged).not.toContain(UPSTREAM_MARKER);
    expect(logged).not.toContain(THROWN_MARKER);
  });

  it("carries the crisis notice like every other response after parsing", async () => {
    answers = [{ kind: "status", status: 401 }];
    const res = await post("I want to die");
    expect(res.status).toBe(502);
    expect(res.json).toEqual({
      ...FAILED_BODY,
      crisisNotice: CRISIS_NOTICES.self_harm.standard,
    });
  });
});

describe("a rejected key stops the request", () => {
  it("does not try the fallback model, which would have answered", async () => {
    answers = [{ kind: "status", status: 401 }, { kind: "ok" }];
    const res = await post();
    expect(res.status).toBe(502);
    expect(fetchCalls).toBe(1);
  });
});

describe("the log names each failed attempt by kind, upstream status, cause code and name", () => {
  it.each([
    [401, "auth"],
    [403, "auth"],
    [402, "insufficient_credits"],
    [429, "rate_limited"],
    [404, "client_error"],
    [500, "provider_error"],
    [503, "provider_error"],
  ])("upstream %d is logged as %s, with no cause and no name", async (status, kind) => {
    answers = [{ kind: "status", status }, { kind: "ok" }];
    await post();
    expect(attemptLines()[0]).toEqual([
      ATTEMPT_LINE, 1, kind, String(status), "none", "none",
    ]);
  });

  it("a thrown attempt is a network error with no upstream status, its cause code and its name", async () => {
    answers = [{ kind: "status", status: 500 }, { kind: "throw" }];
    await post();
    expect(attemptLines()).toEqual([
      [ATTEMPT_LINE, 1, "provider_error", "500", "none", "none"],
      [ATTEMPT_LINE, 2, "network_error", "none", "ECONNRESET", "TypeError"],
    ]);
  });

  it("a failed first attempt is logged even when the fallback answers", async () => {
    answers = [{ kind: "status", status: 503 }, { kind: "ok" }];
    const res = await post();
    expect(res.status).toBe(200);
    expect(attemptLines()).toEqual([
      [ATTEMPT_LINE, 1, "provider_error", "503", "none", "none"],
    ]);
  });

  it("an attempt that answers logs no such line", async () => {
    answers = [{ kind: "ok" }];
    const res = await post();
    expect(res.status).toBe(200);
    expect(attemptLines()).toEqual([]);
  });
});

describe("the kind logged is the error class of the attempt's llm_calls row", () => {
  // The log line classifies the attempt again, from its status alone. These
  // hold that the result is the class callOpenRouter wrote for that attempt.
  it.each([
    ["a rejected key", [{ kind: "status", status: 401 }]],
    ["a forbidden request", [{ kind: "status", status: 403 }, { kind: "status", status: 403 }]],
    ["no credits, then a rate limit", [{ kind: "status", status: 402 }, { kind: "status", status: 429 }]],
    ["a client error, then a provider error", [{ kind: "status", status: 404 }, { kind: "status", status: 500 }]],
    ["a provider error, then a throw", [{ kind: "status", status: 503 }, { kind: "throw" }]],
    ["a throw, then a status outside the error ranges", [{ kind: "throw" }, { kind: "status", status: 300 }]],
  ] as Array<[string, Answer[]]>)("%s", async (_label, script) => {
    answers = script.slice();
    await post();
    const lines = attemptLines();
    expect(lines).toHaveLength(script.length);
    expect(llmRows).toHaveLength(script.length);
    for (let i = 0; i < script.length; i += 1) {
      expect(lines[i][1]).toBe(llmRows[i].attempt_index);
      expect(lines[i][2]).toBe(llmRows[i].error_class);
    }
  });
});

describe("the cause code is logged only in its expected form", () => {
  async function causeLogged(answer: Answer): Promise<unknown> {
    answers = [answer, { kind: "ok" }];
    await post();
    expect(attemptLines()).toHaveLength(1);
    return attemptLines()[0][4];
  }

  it.each([
    ["a system error code", "ENOTFOUND"],
    ["a code with digits and underscores", "UND_ERR_CONNECT_TIMEOUT"],
    ["a code of exactly 32 characters", "A".repeat(32)],
  ])("%s is logged as it is", async (_label, code) => {
    expect(await causeLogged({ kind: "throw", causeCode: code })).toBe(code);
  });

  it.each([
    ["lower case", "econnreset"],
    ["mixed case", "EconnReset"],
    ["a space inside", "ECONN RESET"],
    ["a sentence", `connect failed ${THROWN_MARKER}`],
    ["a newline at the end", "ECONNRESET\n"],
    ["33 characters", "A".repeat(33)],
    ["an empty string", ""],
    ["a number", 104],
    ["an object", { code: "ECONNRESET" }],
    ["null", null],
    ["undefined", undefined],
  ])("%s is logged as none", async (_label, code) => {
    expect(await causeLogged({ kind: "throw", causeCode: code })).toBe("none");
    expect(consoleText()).not.toContain(THROWN_MARKER);
  });

  it("an error with no cause is logged as none", async () => {
    expect(await causeLogged({ kind: "throw", noCause: true })).toBe("none");
  });
});

describe("the error's name is logged only in its expected form", () => {
  async function nameLogged(answer: Answer): Promise<unknown> {
    answers = [answer, { kind: "ok" }];
    await post();
    expect(attemptLines()).toHaveLength(1);
    return attemptLines()[0][5];
  }

  it.each([
    ["a timeout before a response", "TimeoutError"],
    ["an abort", "AbortError"],
    ["a plain error", "Error"],
    ["a name with digits and underscores", "Undici_Error_2"],
    ["a name of exactly 40 characters", "A".repeat(40)],
  ])("%s is logged as it is", async (_label, name) => {
    expect(await nameLogged({ kind: "throw", name })).toBe(name);
  });

  it.each([
    ["a space inside", "Type Error"],
    ["a hyphen", "Fetch-Error"],
    ["a colon", "TypeError:"],
    ["a sentence", `fetch failed ${THROWN_MARKER}`],
    ["a newline at the end", "TypeError\n"],
    ["41 characters", "A".repeat(41)],
    ["an empty string", ""],
    ["a non-ASCII letter", "Erreuré"],
    ["a number", 42],
    ["an object", { name: "TypeError" }],
    ["null", null],
    ["undefined", undefined],
  ])("%s is logged as none", async (_label, name) => {
    expect(await nameLogged({ kind: "throw", name })).toBe("none");
    expect(consoleText()).not.toContain(THROWN_MARKER);
  });

  it("a thrown error's message reaches no console call, whatever its name", async () => {
    answers = [
      { kind: "throw", name: "TimeoutError" },
      { kind: "throw", name: `named ${THROWN_MARKER}` },
    ];
    const res = await post();
    expect(res.status).toBe(502);
    expect(attemptLines()).toHaveLength(2);
    expect(consoleText()).not.toContain(THROWN_MARKER);
    expect(res.text).not.toContain(THROWN_MARKER);
  });
});

describe("responses that are not a failed model attempt keep their own shape", () => {
  it("no attempt fitted in the time budget: 503 CHAT_TIME_BUDGET_EXHAUSTED", async () => {
    // The clock passes the last moment an attempt may start while the usage
    // reservation is being made.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T11:00:00.000Z"));
    usage.onReserve = () => vi.setSystemTime(Date.now() + 30001);
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.json).toEqual({
      error: "Chat is taking longer than usual. Please try again.",
      code: "CHAT_TIME_BUDGET_EXHAUSTED",
    });
    expect(fetchCalls).toBe(0);
    expect(attemptLines()).toEqual([]);
  });

  it("a throw outside the model attempts: 500 from the outer catch", async () => {
    // The profile read constructs the admin client, which throws here.
    vi.stubEnv("AI_SUPABASE_READ_ENABLED", "true");
    supabaseState.adminConfigured = true;
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "Failed to get response from AI" });
    expect(fetchCalls).toBe(0);
  });

  it("no OpenRouter key: 503", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.json).toEqual({
      error: "AI provider is not configured. Set OPENROUTER_API_KEY.",
    });
  });
});
