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
 *   the switch check removed, so the shared batch runs while it is off   -> S1
 *   the run's record or answer given counts for the shared batch while
 *     the switch is off                                                  -> S1
 *   the marks read after the messages, or the messages read without the
 *     span's start as their lower bound                                  -> S2
 *   the save given pairs other than the marks read, or the session's
 *     count instead of the number of messages read                       -> S2
 *   the paragraph removed from the shared summary's prompt               -> S3
 *   the paragraph also added to the ordinary summary's prompt            -> S3
 *   a refused save (a mark gone) counted as a failure, or the session
 *     not marked done after it                                           -> S4
 *   the shared summary stored without the crisis check                   -> S5
 *   a session whose ordinary summary is finished skipped                 -> S6
 *   a session already holding a shared summary sent to the model again   -> S6
 *   a save answered busy twice marked done, or counted as a failure      -> S7
 */

const CRON_SECRET = "sentinel-cron-secret-3e9a";
const OWNER = "00000000-0000-4000-8000-00000000000a";

/** The paragraph only the shared summary's prompt carries. */
const SHARED_PARAGRAPH =
  "Do not copy the other household member's account balances or amounts into the summary. " +
  "Keep what the two of them decided, their plans and goals, and what the user said about themselves.";

type Session = {
  id: string;
  user_id: string;
  message_count: number;
  summary_failures: number;
  shared_summary_failures?: number;
};

type Message = { role: "user" | "assistant"; content: string; created_at: string };
type Source = { ownerUserId: string; connectionId: number };

class FakeBusyError extends Error {
  readonly code = "SHARED_SUMMARY_BUSY";
}

const db = {
  summaryCandidates: [] as Session[],
  sharedCandidates: [] as Session[],
  sharedFrom: null as string | null,
  span: null as { from: string; sources: Source[] } | null,
  hasShared: false,
  saveAnswer: "saved" as "saved" | "exists" | "source_gone" | "busy",
  /** The session's messages, oldest first. */
  messages: [] as Message[],
  messageReads: [] as Array<Record<string, unknown>>,
  created: [] as Array<{ sessionId: string; userId: string; input: Record<string, unknown> }>,
  marked: [] as string[],
  sharedSaved: [] as Array<{
    sessionId: string;
    userId: string;
    input: Record<string, unknown>;
    sources: Source[];
  }>,
  sharedMarked: [] as string[],
  stateWrites: [] as Array<[string, string, string]>,
  recorded: [] as Array<Record<string, unknown>>,
  /** Every aiMemory call that touches the shared summary, in order. */
  sharedCalls: [] as string[],
};

vi.mock("@/lib/aiMemory", () => ({
  isAiMemoryEnabled: () => true,
  isSharedSummaryEnabled: () => process.env.AI_SHARED_SUMMARY_STATE === "on",
  getSessionsToClose: async () => [],
  endSession: async () => undefined,
  getSessionsNeedingSummary: async () => db.summaryCandidates,
  getSessionsNeedingSharedSummary: async () => {
    db.sharedCalls.push("candidates");
    return db.sharedCandidates;
  },
  getSummaryBySessionId: async () => null,
  hasSharedSummary: async () => {
    db.sharedCalls.push("has");
    return db.hasShared;
  },
  getEarliestSharedSourceTime: async () => db.sharedFrom,
  getSessionSharedSpan: async () => {
    db.sharedCalls.push("span");
    return db.span;
  },
  getSessionMessages: async (
    _sessionId: string,
    _userId: string,
    options: Record<string, unknown>
  ) => {
    db.messageReads.push(options);
    if (options.from !== undefined) db.sharedCalls.push("messages");
    const before = options.before as string | undefined;
    const from = options.from as string | undefined;
    const rows = db.messages.filter(
      (m) =>
        (before === undefined || m.created_at < before) &&
        (from === undefined || m.created_at >= from)
    );
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
  saveSharedSummary: async (
    sessionId: string,
    userId: string,
    input: Record<string, unknown>,
    sources: Source[]
  ) => {
    db.sharedCalls.push("save");
    db.sharedSaved.push({ sessionId, userId, input, sources });
    if (db.saveAnswer === "busy") throw new FakeBusyError("busy");
    return db.saveAnswer;
  },
  markSharedSummaryDone: async (sessionId: string) => {
    db.sharedCalls.push("done");
    db.sharedMarked.push(sessionId);
  },
  writeCronBackoff: async (prefix: string, sessionId: string) => {
    db.stateWrites.push(["backoff", prefix, sessionId]);
    return { updated: 1 };
  },
  writeCronCountedFailure: async (prefix: string, sessionId: string) => {
    db.stateWrites.push(["counted", prefix, sessionId]);
    return { updated: 1 };
  },
  writeCronGiveUp: async (prefix: string, sessionId: string) => {
    db.stateWrites.push(["give_up", prefix, sessionId]);
    return { updated: 1 };
  },
  recordCronRun: async (input: Record<string, unknown>) => {
    db.recorded.push(input);
  },
}));

vi.mock("@/lib/llmCallLog", () => ({ recordLlmCall: async () => undefined }));

const ORDINARY_ANSWER =
  "The user is saving for a deposit and pays rent in cash.\nTOPICS: saving, rent";

/** The request bodies sent to the provider, in order, and what it answers. */
const provider = {
  requests: [] as Array<{ messages: Array<{ role: string; content: string }> }>,
  answer: ORDINARY_ANSWER,
};

function providerFetch(_url: unknown, init?: { body?: unknown }): Promise<Response> {
  provider.requests.push(
    JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }
  );
  return Promise.resolve(
    new Response(
      JSON.stringify({ choices: [{ message: { content: provider.answer } }], usage: {} }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );
}

function systemPromptOf(index: number): string {
  const system = provider.requests[index].messages.filter((m) => m.role === "system");
  expect(system).toHaveLength(1);
  return system[0].content;
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
const savedEnv = {
  secret: process.env.CRON_SECRET,
  key: process.env.OPENROUTER_API_KEY,
  shared: process.env.AI_SHARED_SUMMARY_STATE,
};

function restore(name: "CRON_SECRET" | "OPENROUTER_API_KEY" | "AI_SHARED_SUMMARY_STATE", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  db.summaryCandidates = [];
  db.sharedCandidates = [];
  db.sharedFrom = null;
  db.span = null;
  db.hasShared = false;
  db.saveAnswer = "saved";
  db.messages = [];
  db.messageReads = [];
  db.created = [];
  db.marked = [];
  db.sharedSaved = [];
  db.sharedMarked = [];
  db.stateWrites = [];
  db.recorded = [];
  db.sharedCalls = [];
  provider.requests = [];
  provider.answer = ORDINARY_ANSWER;
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.OPENROUTER_API_KEY = "sentinel-openrouter-key";
  delete process.env.AI_SHARED_SUMMARY_STATE;
  vi.stubGlobal("fetch", vi.fn(providerFetch));
  for (const method of ["error", "warn", "info", "log"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore();
  vi.unstubAllGlobals();
  restore("CRON_SECRET", savedEnv.secret);
  restore("OPENROUTER_API_KEY", savedEnv.key);
  restore("AI_SHARED_SUMMARY_STATE", savedEnv.shared);
});

async function run(): Promise<{ status: number; body: Record<string, unknown> }> {
  const mod = await import("../../app/api/cron/summarize/route");
  const res = await mod.GET(
    new Request("https://noor.test/api/cron/summarize", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }) as unknown as NextRequest
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** A closed session of six messages whose last two carry shared data. */
function sharedSession(): Session {
  db.messages = conversation(6);
  db.span = {
    from: db.messages[4].created_at,
    sources: [
      { ownerUserId: OWNER, connectionId: 7001 },
      { ownerUserId: OWNER, connectionId: 7002 },
    ],
  };
  db.sharedFrom = db.span.from;
  return {
    id: "s-shared",
    user_id: "u-1",
    message_count: 6,
    summary_failures: 0,
    shared_summary_failures: 0,
  };
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

    expect((await run()).status).toBe(200);
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

    expect((await run()).status).toBe(200);
    expect(db.created).toHaveLength(1);
    expect(db.created[0].input.messageCount).toBe(3);
  });
});

describe("summarize cron: the summary of a session's shared-data part", () => {
  it.each([undefined, "", "off", "ON", " on", "true"])(
    "S1 with the switch %j nothing of it runs, and the run's record and answer carry no count for it",
    async (value) => {
      if (value === undefined) delete process.env.AI_SHARED_SUMMARY_STATE;
      else process.env.AI_SHARED_SUMMARY_STATE = value;
      db.sharedCandidates = [sharedSession()];

      const { status, body } = await run();
      expect(status).toBe(200);
      expect(db.sharedCalls).toEqual([]);
      expect(db.sharedSaved).toEqual([]);
      expect(provider.requests).toHaveLength(0);
      expect(Object.keys(body).filter((k) => k.indexOf("shared") === 0)).toEqual([]);
      expect(db.recorded).toHaveLength(1);
      expect(
        Object.keys(db.recorded[0].stats as Record<string, unknown>).filter(
          (k) => k.indexOf("shared") === 0
        )
      ).toEqual([]);
      expect(db.recorded[0].itemsProcessed).toBe(0);
    }
  );

  it("S2 on: reads the marks before the messages, summarizes from the span's start, and saves with the marks read and the number of messages read", async () => {
    process.env.AI_SHARED_SUMMARY_STATE = "on";
    const session = sharedSession();
    db.sharedCandidates = [session];

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(db.sharedCalls).toEqual(["candidates", "has", "span", "messages", "save", "done"]);
    // The lower bound is the span's start, passed as it was read; no upper bound.
    expect(db.messageReads).toEqual([{ limit: 200, order: "desc", from: db.span?.from }]);
    // Only the two messages of the shared part reach the model.
    expect(provider.requests).toHaveLength(1);
    const sent = provider.requests[0].messages.filter((m) => m.role === "user")[0].content;
    expect(sent).toContain("message 4");
    expect(sent).toContain("message 5");
    expect(sent).not.toContain("message 3");

    expect(db.sharedSaved).toEqual([
      {
        sessionId: "s-shared",
        userId: "u-1",
        input: {
          summary: "The user is saving for a deposit and pays rent in cash.",
          topics: ["saving", "rent"],
          messageCount: 2,
          generatedByModel: expect.any(String),
        },
        sources: db.span?.sources,
      },
    ]);
    expect(db.sharedMarked).toEqual(["s-shared"]);
    // Nothing of it goes to chat_summaries or to the ordinary completion mark.
    expect(db.created).toEqual([]);
    expect(db.marked).toEqual([]);
    expect(body.sharedSummarized).toBe(1);
    expect(body.sharedFailed).toBe(0);
    expect(db.recorded[0].itemsProcessed).toBe(1);
    expect(db.recorded[0].itemsFailed).toBe(0);
  });

  it("S3 the shared summary's prompt is the ordinary prompt plus one paragraph, and the ordinary summary's prompt does not carry it", async () => {
    process.env.AI_SHARED_SUMMARY_STATE = "on";
    const session = sharedSession();
    // The same session is due for both: its part before the shared data
    // for the ordinary summary, the rest for the shared one.
    db.summaryCandidates = [session];
    db.sharedCandidates = [session];

    expect((await run()).status).toBe(200);
    expect(provider.requests).toHaveLength(2);
    const ordinary = systemPromptOf(0);
    const shared = systemPromptOf(1);
    expect(ordinary).not.toContain(SHARED_PARAGRAPH);
    expect(ordinary).not.toContain("household member");
    expect(shared).toBe(`${ordinary}\n\n${SHARED_PARAGRAPH}`);
    // Each stored where it belongs.
    expect(db.created).toHaveLength(1);
    expect(db.created[0].input.messageCount).toBe(4);
    expect(db.sharedSaved).toHaveLength(1);
    expect(db.sharedSaved[0].input.messageCount).toBe(2);
  });

  it("S4 a save refused because a mark is gone is not a failure: the session is marked done and nothing is written to its retry state", async () => {
    process.env.AI_SHARED_SUMMARY_STATE = "on";
    db.sharedCandidates = [sharedSession()];
    db.saveAnswer = "source_gone";

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(db.sharedSaved).toHaveLength(1);
    expect(db.sharedMarked).toEqual(["s-shared"]);
    expect(db.stateWrites).toEqual([]);
    expect(body.sharedSummarized).toBe(1);
    expect(body.sharedFailed).toBe(0);
    expect(db.recorded[0].itemsFailed).toBe(0);
    expect(db.recorded[0].error).toBeNull();
  });

  it("S5 a shared summary that carries a crisis signal is not stored, and the session is marked done", async () => {
    process.env.AI_SHARED_SUMMARY_STATE = "on";
    db.sharedCandidates = [sharedSession()];
    provider.answer =
      "The user pays $1,400 rent in cash and said they want to kill themselves.\nTOPICS: rent";

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(provider.requests).toHaveLength(1);
    expect(db.sharedSaved).toEqual([]);
    expect(db.sharedMarked).toEqual(["s-shared"]);
    expect(body.sharedSummarized).toBe(1);
    expect(body.sharedFailed).toBe(0);
  });

  it("S6 a session the ordinary summary is finished with is still summarized here, and one already holding a shared summary is marked done without the model", async () => {
    process.env.AI_SHARED_SUMMARY_STATE = "on";
    // Not among the ordinary candidates: that summary is finished.
    db.summaryCandidates = [];
    db.sharedCandidates = [sharedSession()];
    expect((await run()).status).toBe(200);
    expect(db.sharedSaved).toHaveLength(1);

    db.sharedSaved = [];
    db.sharedMarked = [];
    db.sharedCalls = [];
    provider.requests = [];
    db.hasShared = true;
    expect((await run()).status).toBe(200);
    expect(db.sharedCalls).toEqual(["candidates", "has", "done"]);
    expect(provider.requests).toHaveLength(0);
    expect(db.sharedSaved).toEqual([]);
    expect(db.sharedMarked).toEqual(["s-shared"]);
  });

  it("S6 a session whose marks are gone, or with no message in that part, is marked done without the model", async () => {
    process.env.AI_SHARED_SUMMARY_STATE = "on";
    const session = sharedSession();
    db.sharedCandidates = [session];
    db.span = null;
    expect((await run()).status).toBe(200);
    expect(db.sharedCalls).toEqual(["candidates", "has", "span", "done"]);
    expect(provider.requests).toHaveLength(0);

    db.sharedCalls = [];
    db.sharedMarked = [];
    db.span = { from: "2026-12-01T00:00:00.000000+00:00", sources: [{ ownerUserId: OWNER, connectionId: 7001 }] };
    expect((await run()).status).toBe(200);
    expect(db.sharedCalls).toEqual(["candidates", "has", "span", "messages", "done"]);
    expect(provider.requests).toHaveLength(0);
    expect(db.sharedSaved).toEqual([]);
  });

  it("S7 a save that stays busy is retried on a later run: not marked done, not counted, only delayed", async () => {
    process.env.AI_SHARED_SUMMARY_STATE = "on";
    db.sharedCandidates = [sharedSession()];
    db.saveAnswer = "busy";

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(db.sharedMarked).toEqual([]);
    expect(db.stateWrites).toEqual([["backoff", "shared_summary", "s-shared"]]);
    expect(body.sharedSummarized).toBe(0);
    expect(body.sharedFailed).toBe(1);
    expect(body.sharedGivenUp).toBe(0);
  });
});
