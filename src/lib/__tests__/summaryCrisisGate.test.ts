import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storeSummaryUnlessCrisis } from "../summaryCrisisGate";
import type { NewChatSummary } from "../aiMemory";

/**
 * The summarize cron stores a parsed summary through storeSummaryUnlessCrisis.
 * A summary or topic with a crisis signal is not stored; the session is only
 * marked summarized, and nothing is logged. The gate runs here against fake
 * dependencies that record every call. The last block is a source probe that
 * the route goes through the gate instead of calling createSummary itself.
 */

const SESSION = {
  id: "00000000-0000-0000-0000-000000000002",
  user_id: "00000000-0000-0000-0000-000000000001",
};

let created: Array<{ sessionId: string; userId: string; input: NewChatSummary }>;
let marked: Array<{ sessionId: string; userId: string }>;
let spies: Array<ReturnType<typeof vi.spyOn>>;

const deps = {
  createSummary: async (sessionId: string, userId: string, input: NewChatSummary) => {
    created.push({ sessionId, userId, input });
    return {} as never;
  },
  markSessionSummarized: async (sessionId: string, userId: string) => {
    marked.push({ sessionId, userId });
  },
};

beforeEach(() => {
  created = [];
  marked = [];
  spies = (["warn", "info", "error", "log"] as const).map((name) =>
    vi.spyOn(console, name).mockImplementation(() => {})
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function expectSilent(): void {
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
}

describe("storeSummaryUnlessCrisis", () => {
  it("does not store a summary with a crisis signal and marks the session", async () => {
    await storeSummaryUnlessCrisis(deps, SESSION, {
      summary: "The user pays $1,400 rent in cash and said they want to kill themselves.",
      topics: ["rent"],
    });
    expect(created).toHaveLength(0);
    expect(marked).toEqual([{ sessionId: SESSION.id, userId: SESSION.user_id }]);
    expectSilent();
  });

  it("does the same when only a topic carries the signal", async () => {
    await storeSummaryUnlessCrisis(deps, SESSION, {
      summary: "The user pays $1,400 rent in cash.",
      topics: ["rent", "suicidal"],
    });
    expect(created).toHaveLength(0);
    expect(marked).toHaveLength(1);
    expectSilent();
  });

  it("stores an ordinary summary as given and does not mark the session itself", async () => {
    const input = {
      summary: "The user pays $1,400 rent in cash.",
      topics: ["rent"],
      messageCount: 4,
      generatedByModel: "m",
    };
    await storeSummaryUnlessCrisis(deps, SESSION, input);
    expect(created).toEqual([
      { sessionId: SESSION.id, userId: SESSION.user_id, input },
    ]);
    expect(marked).toHaveLength(0);
    expectSilent();
  });
});

describe("summarize cron wiring", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../app/api/cron/summarize/route.ts", import.meta.url)),
    "utf8"
  ).replace(/\r\n?/g, "\n");

  it("stores the summary through the gate, never with a direct createSummary call", () => {
    const start = source.indexOf("async function summarizeOneSession(");
    const end = source.indexOf("\n}\n", start);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, end);
    expect(body).toContain(
      "await storeSummaryUnlessCrisis({ createSummary, markSessionSummarized }, session, {"
    );
    expect(body).not.toContain("await createSummary(");
  });
});
