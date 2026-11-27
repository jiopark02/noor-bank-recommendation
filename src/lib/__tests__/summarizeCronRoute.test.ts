import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * GET /api/cron/summarize, executed for what it stores. Faked are the
 * aiMemory module (the database), the llm_calls recorder and fetch (the
 * provider); the route, the batch loop, the crisis gate and the request
 * builder are real.
 *
 * Mutations and the test each one turns red:
 *   the stored message_count taken from the session's own count instead of
 *     the number of messages read                                        -> R1
 */

const CRON_SECRET = "sentinel-cron-secret-3e9a";

type Session = {
  id: string;
  user_id: string;
  message_count: number;
  summary_failures: number;
};

type Message = { role: "user" | "assistant"; content: string; created_at: string };

const db = {
  summaryCandidates: [] as Session[],
  sharedFrom: null as string | null,
  /** The session's messages, oldest first. */
  messages: [] as Message[],
  messageReads: [] as Array<Record<string, unknown>>,
  created: [] as Array<{ sessionId: string; userId: string; input: Record<string, unknown> }>,
  marked: [] as string[],
};

vi.mock("@/lib/aiMemory", () => ({
  isAiMemoryEnabled: () => true,
  getSessionsToClose: async () => [],
  endSession: async () => undefined,
  getSessionsNeedingSummary: async () => db.summaryCandidates,
  getSummaryBySessionId: async () => null,
  getEarliestSharedSourceTime: async () => db.sharedFrom,
  getSessionMessages: async (
    _sessionId: string,
    _userId: string,
    options: Record<string, unknown>
  ) => {
    db.messageReads.push(options);
    const before = options.before as string | undefined;
    const rows = db.messages.filter((m) => before === undefined || m.created_at < before);
    // Newest first, as the route asks.
    return rows.slice().reverse();
  },
  createSummary: async (sessionId: string, userId: string, input: Record<string, unknown>) => {
    db.created.push({ sessionId, userId, input });
    return { id: "summary-1" };
  },
  markSessionSummarized: async (sessionId: string) => {
    db.marked.push(sessionId);
  },
  writeCronBackoff: async () => ({ updated: 1 }),
  writeCronCountedFailure: async () => ({ updated: 1 }),
  writeCronGiveUp: async () => ({ updated: 1 }),
  recordCronRun: async () => undefined,
}));

vi.mock("@/lib/llmCallLog", () => ({ recordLlmCall: async () => undefined }));

/** The request bodies sent to the provider, in order. */
const provider = { requests: [] as Array<Record<string, unknown>> };

function providerFetch(_url: unknown, init?: { body?: unknown }): Promise<Response> {
  provider.requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
  return Promise.resolve(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                "The user is saving for a deposit and pays rent in cash.\nTOPICS: saving, rent",
            },
          },
        ],
        usage: {},
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );
}

function conversation(n: number): Message[] {
  const rows: Message[] = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
      created_at: `2026-11-01T00:00:${String(i).padStart(2, "0")}.000000+00:00`,
    });
  }
  return rows;
}

const spies: Array<ReturnType<typeof vi.spyOn>> = [];
const savedEnv = { secret: process.env.CRON_SECRET, key: process.env.OPENROUTER_API_KEY };

beforeEach(() => {
  db.summaryCandidates = [];
  db.sharedFrom = null;
  db.messages = [];
  db.messageReads = [];
  db.created = [];
  db.marked = [];
  provider.requests = [];
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.OPENROUTER_API_KEY = "sentinel-openrouter-key";
  vi.stubGlobal("fetch", vi.fn(providerFetch));
  for (const method of ["error", "warn", "info", "log"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore();
  vi.unstubAllGlobals();
  if (savedEnv.secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedEnv.secret;
  if (savedEnv.key === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedEnv.key;
});

async function run(): Promise<number> {
  const mod = await import("../../app/api/cron/summarize/route");
  const res = await mod.GET(
    new Request("https://noor.test/api/cron/summarize", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }) as unknown as NextRequest
  );
  return res.status;
}

describe("summarize cron: what it stores", () => {
  it("R1 the stored message_count is the number of messages the summary was made from, not the session's count", async () => {
    // Six messages in the session; shared bank data entered before the
    // fifth, so four are read.
    db.messages = conversation(6);
    db.sharedFrom = db.messages[4].created_at;
    db.summaryCandidates = [
      { id: "s-1", user_id: "u-1", message_count: 6, summary_failures: 0 },
    ];

    expect(await run()).toBe(200);
    expect(provider.requests).toHaveLength(1);
    expect(db.created).toHaveLength(1);
    expect(db.created[0].sessionId).toBe("s-1");
    expect(db.created[0].userId).toBe("u-1");
    expect(db.created[0].input.messageCount).toBe(4);
  });

  it("R1 with no shared data in the session, a session whose count is ahead of its rows still stores the number read", async () => {
    db.messages = conversation(3);
    db.summaryCandidates = [
      { id: "s-2", user_id: "u-1", message_count: 9, summary_failures: 0 },
    ];

    expect(await run()).toBe(200);
    expect(db.created).toHaveLength(1);
    expect(db.created[0].input.messageCount).toBe(3);
  });
});
