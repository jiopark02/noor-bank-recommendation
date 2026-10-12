import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  CRON_MAX_RESPONDED_ATTEMPTS,
  SESSION_CANDIDATE_LIMIT,
  applyGiveUps,
  partitionByAttemptBound,
} from "../cronRetryBound";

function session(n: number) {
  return { id: `s${n}`, user_id: `u${n}` };
}

const OPTIONS = { max: CRON_MAX_RESPONDED_ATTEMPTS, limit: 8 };

describe("bound values", () => {
  it("gives up after three answered attempts and reads 24 candidates", () => {
    expect(CRON_MAX_RESPONDED_ATTEMPTS).toBe(3);
    expect(SESSION_CANDIDATE_LIMIT).toBe(24);
  });
});

describe("partitionByAttemptBound", () => {
  it("lets a newer session through when the eight oldest are all at the bound", () => {
    const poisoned = [1, 2, 3, 4, 5, 6, 7, 8].map(session);
    const newer = session(9);
    const counts: Record<string, number> = {};
    for (const s of poisoned) counts[s.id] = 3;

    const { toProcess, toGiveUp } = partitionByAttemptBound(
      [...poisoned, newer],
      counts,
      OPTIONS
    );
    expect(toProcess).toEqual([newer]);
    expect(toGiveUp).toEqual(poisoned);
  });

  it("retries a session with two counted attempts", () => {
    const s = session(1);
    expect(
      partitionByAttemptBound([s], { s1: 2 }, OPTIONS).toProcess
    ).toEqual([s]);
  });

  it("gives up on a session with exactly three counted attempts", () => {
    const s = session(1);
    expect(partitionByAttemptBound([s], { s1: 3 }, OPTIONS)).toEqual({
      toProcess: [],
      toGiveUp: [s],
    });
  });

  it("treats a session with no count as having no attempts", () => {
    const s = session(1);
    expect(partitionByAttemptBound([s], {}, OPTIONS).toProcess).toEqual([s]);
  });

  it("processes at most the limit, in queue order, and gives up on all over the bound", () => {
    const candidates = Array.from({ length: 12 }, (_, i) => session(i + 1));
    const { toProcess, toGiveUp } = partitionByAttemptBound(
      candidates,
      { s12: 5 },
      OPTIONS
    );
    expect(toProcess.map((s) => s.id)).toEqual([
      "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8",
    ]);
    expect(toGiveUp.map((s) => s.id)).toEqual(["s12"]);
  });
});

describe("applyGiveUps", () => {
  it("logs, counts and continues when marking a session fails", async () => {
    const log = vi.fn();
    const mark = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(undefined);
    const result = await applyGiveUps(
      [session(1), session(2)],
      { s1: 3, s2: 4 },
      { route: "cron_summarize", mark, log }
    );

    expect(result).toEqual({ givenUp: 1, giveUpFailed: 1 });
    expect(mark).toHaveBeenCalledTimes(2);
    expect(mark).toHaveBeenNthCalledWith(2, session(2));
    expect(log).toHaveBeenCalledWith(
      "[cron-poison] give_up_failed route=%s session=%s",
      "cron_summarize",
      "s1"
    );
    expect(log).toHaveBeenCalledWith(
      "[cron-poison] route=%s session=%s responded_attempts=%d",
      "cron_summarize",
      "s2",
      4
    );
    // Ids and counts only: the error is never passed to the log.
    for (const call of log.mock.calls) {
      expect(call.some((arg: unknown) => arg instanceof Error)).toBe(false);
    }
  });
});

describe.each([
  [
    "summarize",
    "../../app/api/cron/summarize/route.ts",
    "getSessionsNeedingSummary(SESSION_CANDIDATE_LIMIT)",
    "cron_summarize",
    "mark: (s) => markSessionSummarized(s.id, s.user_id),",
  ],
  [
    "extract-facts",
    "../../app/api/cron/extract-facts/route.ts",
    "getSessionsNeedingFactsExtraction(\n      SESSION_CANDIDATE_LIMIT\n    )",
    "cron_extract_facts",
    "mark: (s) => markFactsExtracted(s.id, s.user_id),",
  ],
])("%s cron wiring", (_label, path, candidateFetch, route, mark) => {
  const source = readFileSync(
    fileURLToPath(new URL(path, import.meta.url)),
    "utf8"
  ).replace(/\r\n?/g, "\n");

  it("reads more candidates than it processes", () => {
    expect(source).toContain(candidateFetch);
  });

  it("counts attempts for its own route and marks with the session's own user id", () => {
    expect(source).toContain(`getRespondedAttemptCounts(\n        "${route}",`);
    expect(source).toContain(mark);
  });

  it("runs without the bound when the counts cannot be read", () => {
    const tryAt = source.indexOf("let attemptCounts: Record<string, number> | null = null;");
    const boundAt = source.indexOf("if (attemptCounts) {", tryAt);
    expect(tryAt).toBeGreaterThan(-1);
    expect(boundAt).toBeGreaterThan(tryAt);
    const readBlock = source.slice(tryAt, boundAt);
    expect(readBlock).toContain("} catch (error) {");
    expect(readBlock).not.toContain("applyGiveUps(");
  });
});
