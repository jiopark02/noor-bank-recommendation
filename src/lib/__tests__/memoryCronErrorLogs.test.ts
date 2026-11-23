import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { stripComments } from "./sourceProbe";

/**
 * GET /api/cron/summarize and /api/cron/extract-facts, executed for their
 * error records only: every log line and cron_runs.error carry identifiers
 * and an error code, never an error object, its message or details, or the
 * provider's answer. Faked are the aiMemory module (the database), the
 * llm_calls recorder and fetch (the provider); the routes, the batch loop and
 * the request builders are real. Every faked failure carries SENTINEL in its
 * message, details and cause, and the provider's error body is SENTINEL too.
 *
 * Mutations and the test each one turns red:
 *   an error object, its message or details passed to a log line     -> L1, L2, L3
 *   the provider's error body read into the thrown error             -> L1
 *   the provider's error body left neither read nor cancelled        -> L1
 *   cron_runs.error written from an error's message                  -> L2
 *   the batch failure labelled the same whether or not the
 *   candidate read returned                                           -> L4
 *   a log line's level changed (error lines, the cleanup warning)    -> L1, L3
 *   an aiMemory log line given an error's message or the error        -> L5
 */

const SENTINEL = "sentinel-row-4f2a balance $9,876.54 fact text";
const CRON_SECRET = "sentinel-cron-secret-7c1d";

function failing(code: string): Error {
  const error = new Error(SENTINEL, { cause: { code, message: SENTINEL, details: SENTINEL } });
  (error as Error & { details?: string }).details = SENTINEL;
  return error;
}

type Session = {
  id: string;
  user_id: string;
  message_count: number;
  summary_failures?: number;
  facts_failures?: number;
};

const db = {
  toClose: [] as Session[] | Error,
  endSession: null as Error | null,
  summaryCandidates: [] as Session[] | Error,
  factCandidates: [] as Session[] | Error,
  facts: [] as Array<{ id: string; category: string; fact: string }>,
  supersede: null as Error | null,
  save: null as Error | null,
  expire: null as Error | null,
  record: null as Error | null,
  cleanup: null as Error | null,
  recorded: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/aiMemory", () => ({
  isAiMemoryEnabled: () => true,
  getSessionsToClose: async () => {
    if (db.toClose instanceof Error) throw db.toClose;
    return db.toClose;
  },
  endSession: async () => {
    if (db.endSession) throw db.endSession;
  },
  getSessionsNeedingSummary: async () => {
    if (db.summaryCandidates instanceof Error) throw db.summaryCandidates;
    return db.summaryCandidates;
  },
  getSessionsNeedingFactsExtraction: async () => {
    if (db.factCandidates instanceof Error) throw db.factCandidates;
    return db.factCandidates;
  },
  getSummaryBySessionId: async () => null,
  getEarliestSharedSourceTime: async () => null,
  getSessionMessages: async () => [
    { role: "assistant", content: `Noor said ${SENTINEL}`, created_at: "2026-11-01T00:00:01Z" },
    { role: "user", content: `I said ${SENTINEL}`, created_at: "2026-11-01T00:00:00Z" },
  ],
  createSummary: async () => ({ id: "summary-1" }),
  markSessionSummarized: async () => undefined,
  markFactsExtracted: async () => undefined,
  getUserFacts: async () => db.facts,
  saveUserFact: async () => {
    if (db.save) throw db.save;
    return { id: "fact-new" };
  },
  supersedeUserFact: async () => {
    if (db.supersede) throw db.supersede;
    return { id: "fact-new" };
  },
  expireUserFact: async () => {
    if (db.expire) throw db.expire;
  },
  isUniqueViolation: () => false,
  isSensitiveFactRejected: () => false,
  writeCronBackoff: async () => ({ updated: 1 }),
  writeCronCountedFailure: async () => ({ updated: 1 }),
  writeCronGiveUp: async () => ({ updated: 1 }),
  recordCronRun: async (input: Record<string, unknown>) => {
    db.recorded.push(input);
    if (db.record) throw db.record;
  },
  deleteOldCronRuns: async () => {
    if (db.cleanup) throw db.cleanup;
    return 0;
  },
}));

vi.mock("@/lib/llmCallLog", () => ({ recordLlmCall: async () => undefined }));

/** The provider's answers, in order, and whether each error body was cancelled. */
const provider = {
  answers: [] as Array<{ status: number; body: string }>,
  cancelled: [] as boolean[],
};

function providerFetch(): Promise<Response> {
  const answer = provider.answers.shift();
  if (!answer) throw new Error("no provider answer set");
  const index = provider.cancelled.length;
  provider.cancelled.push(false);
  const bytes = new TextEncoder().encode(answer.body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
    cancel() {
      provider.cancelled[index] = true;
    },
  });
  return Promise.resolve(
    new Response(stream, { status: answer.status, headers: { "content-type": "application/json" } })
  );
}

function modelAnswer(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }], usage: {} });
}

const spies: Record<"error" | "warn" | "info" | "log", ReturnType<typeof vi.spyOn>> = {} as never;
const savedEnv = { secret: process.env.CRON_SECRET, key: process.env.OPENROUTER_API_KEY };

beforeEach(() => {
  db.toClose = [];
  db.endSession = null;
  db.summaryCandidates = [];
  db.factCandidates = [];
  db.facts = [];
  db.supersede = null;
  db.save = null;
  db.expire = null;
  db.record = null;
  db.cleanup = null;
  db.recorded = [];
  provider.answers = [];
  provider.cancelled = [];
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.OPENROUTER_API_KEY = "sentinel-openrouter-key";
  vi.stubGlobal("fetch", vi.fn(providerFetch));
  for (const method of ["error", "warn", "info", "log"] as const) {
    spies[method] = vi.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  for (const spy of Object.values(spies)) spy.mockRestore();
  vi.unstubAllGlobals();
  if (savedEnv.secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedEnv.secret;
  if (savedEnv.key === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedEnv.key;
});

async function run(route: "summarize" | "extract-facts"): Promise<number> {
  const mod =
    route === "summarize"
      ? await import("../../app/api/cron/summarize/route")
      : await import("../../app/api/cron/extract-facts/route");
  const res = await mod.GET(
    new Request(`https://noor.test/api/cron/${route}`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }) as unknown as NextRequest
  );
  return res.status;
}

/** The [memory-cron] lines at one level, with their arguments substituted. */
function lines(level: "error" | "warn"): string[] {
  return spies[level].mock.calls
    .filter((args: unknown[]) => String(args[0]).startsWith("[memory-cron]"))
    .map((args: unknown[]) => {
      let i = 1;
      return String(args[0]).replace(/%[sd]/g, () => String(args[i++]));
    });
}

/** No console argument at any level is an object, and none carries SENTINEL. */
function expectNothingLeaked(): void {
  for (const [level, spy] of Object.entries(spies)) {
    for (const args of spy.mock.calls as unknown[][]) {
      for (const arg of args) {
        const label = `${level}: ${String(args[0])}`;
        if (typeof arg === "object" && arg !== null) {
          // The run's closing summary is a record of counts only.
          expect(Object.values(arg).every((v) => typeof v === "number" || typeof v === "boolean"), label).toBe(
            true
          );
        } else {
          expect(String(arg), label).not.toContain("sentinel-row-4f2a");
        }
      }
    }
  }
  for (const row of db.recorded) {
    expect(JSON.stringify(row)).not.toContain("sentinel-row-4f2a");
  }
}

describe("memory cron error records", () => {
  it("L1 summarize: a failed close and a provider error log identifiers and codes; the error body is cancelled unread", async () => {
    db.toClose = [{ id: "s-close", user_id: "u-1", message_count: 0 }];
    db.endSession = failing("23505");
    db.summaryCandidates = [{ id: "s-sum", user_id: "u-1", message_count: 2, summary_failures: 0 }];
    provider.answers = [{ status: 500, body: `{"error":{"message":"${SENTINEL}"}}` }];

    expect(await run("summarize")).toBe(200);
    expect(lines("error")).toEqual([
      "[memory-cron] route=cron_summarize step=close session=s-close code=23505",
      "[memory-cron] route=cron_summarize step=session session=s-sum code=http_500",
    ]);
    expect(provider.cancelled).toEqual([true]);
    expect(db.recorded).toHaveLength(1);
    expect(db.recorded[0].error).toBeNull();
    expectNothingLeaked();
  });

  it("L2 summarize: failed reads and a failed record write give step and code, in the log and in cron_runs.error", async () => {
    db.toClose = failing("PGRST301");
    db.summaryCandidates = failing("57014");
    db.record = failing("42501");

    expect(await run("summarize")).toBe(200);
    expect(lines("error")).toEqual([
      "[memory-cron] route=cron_summarize step=close_read code=PGRST301",
      "[memory-cron] route=cron_summarize step=candidates code=57014",
      "[memory-cron] route=cron_summarize step=record code=42501",
    ]);
    expect(db.recorded[0].error).toBe("close_read code=PGRST301; candidates code=57014");
    expect(db.recorded[0].forceFailed).toBe(true);
    expectNothingLeaked();
  });

  it("L3 extract-facts: each failed fact write, the session, the record and the cleanup log identifiers and codes", async () => {
    db.facts = [
      { id: "f-1", category: "financial", fact: "User's rent is $1,500." },
      { id: "f-2", category: "financial", fact: "User has a part-time job." },
    ];
    db.factCandidates = [{ id: "s-ext", user_id: "u-1", message_count: 2, facts_failures: 0 }];
    db.supersede = failing("23514");
    db.save = failing("23503");
    db.expire = failing("40001");
    db.record = failing("42P01");
    db.cleanup = failing("53300");
    provider.answers = [
      {
        status: 200,
        body: modelAnswer(
          JSON.stringify({
            new_facts: [{ category: "goal", fact: "User is opening a savings account this month.", confidence: 0.9 }],
            supersede: [{ old_number: 1, category: "financial", fact: "User's rent is $1,700.", confidence: 1 }],
            expire: [{ old_number: 2 }],
          })
        ),
      },
    ];

    expect(await run("extract-facts")).toBe(200);
    expect(lines("error")).toEqual([
      "[memory-cron] route=cron_extract_facts step=supersede session=s-ext fact=f-1 code=23514 recovery_code=23503",
      "[memory-cron] route=cron_extract_facts step=expire session=s-ext fact=f-2 code=40001",
      "[memory-cron] route=cron_extract_facts step=save_fact session=s-ext code=23503",
      "[memory-cron] route=cron_extract_facts step=session session=s-ext code=none",
      "[memory-cron] route=cron_extract_facts step=record code=42P01",
    ]);
    expect(lines("warn")).toEqual(["[memory-cron] route=cron_extract_facts step=cleanup code=53300"]);
    expectNothingLeaked();
  });

  it("L3 extract-facts: a provider error is logged by status, its body cancelled unread; a failed candidate read goes to cron_runs.error", async () => {
    db.factCandidates = [{ id: "s-ext", user_id: "u-1", message_count: 2, facts_failures: 0 }];
    provider.answers = [{ status: 503, body: SENTINEL }];
    expect(await run("extract-facts")).toBe(200);
    expect(lines("error")).toEqual(["[memory-cron] route=cron_extract_facts step=session session=s-ext code=http_503"]);
    expect(provider.cancelled).toEqual([true]);
    expect(db.recorded[0].error).toBeNull();

    db.recorded = [];
    spies.error.mockClear();
    db.factCandidates = failing("57014");
    expect(await run("extract-facts")).toBe(200);
    expect(lines("error")).toEqual(["[memory-cron] route=cron_extract_facts step=candidates code=57014"]);
    expect(db.recorded[0].error).toBe("candidates code=57014");
    expectNothingLeaked();
  });

  it("L4 a batch that rejects after its candidate read is labelled batch, not candidates", async () => {
    // Reading the failure count throws, which the loop does outside its
    // per-session catch, after the session failed at the provider.
    const session = { id: "s-sum", user_id: "u-1", message_count: 2 } as Session;
    Object.defineProperty(session, "summary_failures", {
      get() {
        throw failing("XX001");
      },
    });
    db.summaryCandidates = [session];
    provider.answers = [{ status: 500, body: SENTINEL }];

    expect(await run("summarize")).toBe(200);
    expect(lines("error")).toEqual([
      "[memory-cron] route=cron_summarize step=session session=s-sum code=http_500",
      "[memory-cron] route=cron_summarize step=batch code=XX001",
    ]);
    expect(db.recorded[0].error).toBe("batch code=XX001");
    expectNothingLeaked();
  });
});

describe("aiMemory log lines", () => {
  it("L5 every console call in aiMemory passes an error only through errorCodeForLog, and no message", () => {
    const source = stripComments(
      readFileSync(fileURLToPath(new URL("../aiMemory.ts", import.meta.url)), "utf8")
    );
    const calls = source.match(/console\.(?:error|warn|info|log)\([\s\S]*?\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    const wrapped = calls.filter((c) => c.indexOf("errorCodeForLog(") !== -1);
    expect(wrapped.length).toBe(3);
    for (const call of calls) {
      // Strings and errorCodeForLog(...) removed, what is left names no error.
      const rest = call
        .replace(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'/g, "")
        .replace(/errorCodeForLog\([^)]*\)/g, "");
      expect(rest, call).not.toMatch(/\.message\b|\.details\b|\b\w*[Ee]rror\b(?!\s*\()/);
    }
  });
});
