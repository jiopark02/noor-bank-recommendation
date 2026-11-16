import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  classifyCronFailure,
  cronRunItems,
  runMemoryCronBatch,
  type CronStage,
  type MemoryCronBatchDeps,
  type StageTracker,
} from "../memoryCronBatch";
import {
  CRON_MAX_COUNTED_FAILURES,
  CRON_RETRY_BACKOFF_MS,
} from "../cronRetryBound";

/**
 * The memory crons' batch loop, executed with a fake clock, fake candidates,
 * fake per-session work and recorded state writes.
 */

interface FakeSession {
  id: string;
  user_id: string;
  failures: unknown;
}

function session(n: number, failures: unknown = 0): FakeSession {
  return { id: `s${n}`, user_id: `u${n}`, failures };
}

/** A per-session behaviour: resolve, or move to a stage and throw there. */
type Behaviour = (tracker: StageTracker) => Promise<void>;

const ok: Behaviour = async () => undefined;

function failAt(
  stage: CronStage,
  call?: StageTracker["call"],
  error: unknown = new Error("boom")
): Behaviour {
  return async (tracker) => {
    if (stage !== "before_call") {
      tracker.stage = "call";
      tracker.call = call ?? { httpStatus: 200, timedOut: false };
    }
    tracker.stage = stage;
    throw error;
  };
}

const T0 = Date.UTC(2030, 0, 1, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

interface Harness {
  deps: MemoryCronBatchDeps<FakeSession>;
  processed: string[];
  backoffs: unknown[][];
  counted: unknown[][];
  giveUps: unknown[][];
  logs: unknown[][];
  errors: unknown[][];
  fetches: unknown[][];
  clock: { now: number };
}

function harness(
  sessions: FakeSession[],
  behaviours: Record<string, Behaviour>,
  overrides: Partial<MemoryCronBatchDeps<FakeSession>> = {}
): Harness {
  const h: Harness = {
    processed: [],
    backoffs: [],
    counted: [],
    giveUps: [],
    logs: [],
    errors: [],
    fetches: [],
    clock: { now: T0 },
  } as unknown as Harness;
  h.deps = {
    route: "cron_summarize",
    now: () => h.clock.now,
    runStartedAtMs: T0,
    candidateLimit: 24,
    batchLimit: 8,
    hasBudget: () => true,
    fetchCandidates: async (limit, nowIso) => {
      h.fetches.push([limit, nowIso]);
      return sessions;
    },
    failuresOf: (s) => s.failures as number,
    processSession: async (s, tracker) => {
      h.processed.push(s.id);
      await (behaviours[s.id] ?? ok)(tracker);
    },
    onSessionError: (s, error) => {
      h.errors.push([s.id, error]);
    },
    writeBackoff: async (s, next) => {
      h.backoffs.push([s.id, next]);
      return { updated: 1 };
    },
    writeCountedFailure: async (s, before, next) => {
      h.counted.push([s.id, before, next]);
      return { updated: 1 };
    },
    writeGiveUp: async (s, before, reason, at) => {
      h.giveUps.push([s.id, before, reason, at]);
      return { updated: 1 };
    },
    log: (...args: unknown[]) => {
      h.logs.push(args);
    },
    ...overrides,
  };
  return h;
}

describe("classifyCronFailure", () => {
  const call = (httpStatus: number | null, timedOut = false): StageTracker => ({
    stage: "call",
    call: { httpStatus, timedOut },
  });

  it("does not count anything before the model call, and does not stop the run", () => {
    expect(classifyCronFailure({ stage: "before_call" })).toEqual({
      counted: false,
      stopsRun: false,
    });
  });

  it("counts a 2xx whose answer could not be used", () => {
    expect(classifyCronFailure(call(200))).toEqual({
      counted: true,
      reason: "output_unusable",
    });
  });

  it.each([400, 403, 413, 422])("counts %d as rejected input", (status) => {
    expect(classifyCronFailure(call(status))).toEqual({
      counted: true,
      reason: "input_rejected",
    });
  });

  it.each([401, 402])("does not count %d, and stops the run", (status) => {
    expect(classifyCronFailure(call(status))).toEqual({
      counted: false,
      stopsRun: true,
    });
  });

  it.each([404, 408, 429, 500, 502, 503])(
    "does not count %d, and does not stop the run",
    (status) => {
      expect(classifyCronFailure(call(status))).toEqual({
        counted: false,
        stopsRun: false,
      });
    }
  );

  it("does not count a timeout, even after a 2xx status arrived", () => {
    expect(classifyCronFailure(call(200, true))).toEqual({
      counted: false,
      stopsRun: false,
    });
  });

  it("does not count a call that got no response or never recorded one", () => {
    expect(classifyCronFailure(call(null))).toEqual({
      counted: false,
      stopsRun: false,
    });
    expect(classifyCronFailure({ stage: "call" })).toEqual({
      counted: false,
      stopsRun: false,
    });
  });

  it("counts any failure reading the answer", () => {
    expect(classifyCronFailure({ stage: "interpret" })).toEqual({
      counted: true,
      reason: "output_unusable",
    });
  });

  it("does not count a failure storing the result, and stops the run", () => {
    expect(classifyCronFailure({ stage: "store" })).toEqual({
      counted: false,
      stopsRun: true,
    });
  });
});

describe("runMemoryCronBatch: candidates", () => {
  it("reads the candidate limit at the injected time and processes at most the batch limit, in order", async () => {
    const sessions = Array.from({ length: 10 }, (_, i) => session(i));
    const h = harness(sessions, {});
    const stats = await runMemoryCronBatch(h.deps);
    expect(h.fetches).toEqual([[24, iso(T0)]]);
    expect(h.processed).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
    expect(stats.processed).toBe(8);
  });

  it("rejects when the candidate read fails, so the route records it", async () => {
    const h = harness([], {}, {
      fetchCandidates: async () => {
        throw new Error("read failed");
      },
    });
    await expect(runMemoryCronBatch(h.deps)).rejects.toThrow("read failed");
  });

  it("writes no state and logs nothing for a session that finishes", async () => {
    const h = harness([session(1)], {});
    const stats = await runMemoryCronBatch(h.deps);
    expect(stats).toEqual({
      processed: 1,
      failed: 0,
      counted: 0,
      notCounted: 0,
      givenUp: 0,
      stateWriteFailed: 0,
      deferred: 0,
      stoppedSkipped: 0,
      stopped: false,
    });
    expect([...h.backoffs, ...h.counted, ...h.giveUps, ...h.logs]).toEqual([]);
  });
});

describe("runMemoryCronBatch: counted failures and giving up", () => {
  it("adds one to a session below the bound and moves its next attempt by exactly the backoff", async () => {
    const h = harness([session(1, 0), session(2, 1)], {
      s1: failAt("interpret"),
      s2: failAt("call", { httpStatus: 422, timedOut: false }),
    });
    const stats = await runMemoryCronBatch(h.deps);
    const next = iso(T0 + CRON_RETRY_BACKOFF_MS);
    expect(h.counted).toEqual([
      ["s1", 0, next],
      ["s2", 1, next],
    ]);
    expect(h.giveUps).toEqual([]);
    expect(h.backoffs).toEqual([]);
    expect(stats.counted).toBe(2);
    expect(stats.failed).toBe(2);
    expect(h.logs).toContainEqual([
      "[cron-retry] route=%s session=%s stage=%s counted=%s failures=%d",
      "cron_summarize",
      "s1",
      "interpret",
      "yes",
      1,
    ]);
  });

  it("gives up on the failure that reaches the bound, with that failure's reason and the injected time", async () => {
    const before = CRON_MAX_COUNTED_FAILURES - 1;
    const h = harness([session(1, before), session(2, before)], {
      s1: failAt("interpret"),
      s2: failAt("call", { httpStatus: 400, timedOut: false }),
    });
    const stats = await runMemoryCronBatch(h.deps);
    expect(h.giveUps).toEqual([
      ["s1", before, "output_unusable", iso(T0)],
      ["s2", before, "input_rejected", iso(T0)],
    ]);
    expect(h.counted).toEqual([]);
    expect(stats.givenUp).toBe(2);
    expect(h.logs).toContainEqual([
      "[cron-poison] route=%s session=%s reason=%s failures=%d",
      "cron_summarize",
      "s1",
      "output_unusable",
      CRON_MAX_COUNTED_FAILURES,
    ]);
  });

  it("does not record a give-up that matched no row", async () => {
    const h = harness([session(1, 2)], { s1: failAt("interpret") }, {
      writeGiveUp: async () => ({ updated: 0 }),
    });
    const stats = await runMemoryCronBatch(h.deps);
    expect(stats.givenUp).toBe(0);
    expect(h.logs).toContainEqual([
      "[cron-retry] skipped route=%s session=%s",
      "cron_summarize",
      "s1",
    ]);
  });

  it("only delays a counted failure whose stored count is not usable", async () => {
    const h = harness([session(1, null), session(2, -1)], {
      s1: failAt("interpret"),
      s2: failAt("interpret"),
    });
    const stats = await runMemoryCronBatch(h.deps);
    expect(h.counted).toEqual([]);
    expect(h.giveUps).toEqual([]);
    expect(h.backoffs.map((b) => b[0])).toEqual(["s1", "s2"]);
    expect(stats.notCounted).toBe(2);
  });
});

describe("runMemoryCronBatch: failures that are not counted", () => {
  it("only moves the next attempt, by the backoff from the injected clock", async () => {
    const h = harness([session(1, 2), session(2, 2), session(3, 2)], {
      s1: failAt("before_call"),
      s2: failAt("call", { httpStatus: 503, timedOut: false }),
      s3: failAt("call", { httpStatus: null, timedOut: true }),
    });
    h.clock.now = T0 + 1234;
    const stats = await runMemoryCronBatch(h.deps);
    const next = iso(T0 + 1234 + CRON_RETRY_BACKOFF_MS);
    expect(h.backoffs).toEqual([
      ["s1", next],
      ["s2", next],
      ["s3", next],
    ]);
    expect(h.counted).toEqual([]);
    expect(h.giveUps).toEqual([]);
    expect(stats.notCounted).toBe(3);
  });

  it("goes on to the next session after a failure before the call or a 429", async () => {
    const h = harness([session(1), session(2), session(3)], {
      s1: failAt("before_call"),
      s2: failAt("call", { httpStatus: 429, timedOut: false }),
    });
    const stats = await runMemoryCronBatch(h.deps);
    expect(h.processed).toEqual(["s1", "s2", "s3"]);
    expect(stats.stopped).toBe(false);
    expect(stats.processed).toBe(1);
  });
});

describe("runMemoryCronBatch: stopping the run", () => {
  it.each([
    ["a store failure", failAt("store")],
    ["a 401", failAt("call", { httpStatus: 401, timedOut: false })],
    ["a 402", failAt("call", { httpStatus: 402, timedOut: false })],
  ])("starts no further session after %s, and still backs the failed one off", async (_label, behaviour) => {
    const h = harness([session(1), session(2), session(3)], { s1: behaviour });
    const stats = await runMemoryCronBatch(h.deps);
    expect(h.processed).toEqual(["s1"]);
    expect(h.backoffs.map((b) => b[0])).toEqual(["s1"]);
    expect(stats.stopped).toBe(true);
    expect(stats.stoppedSkipped).toBe(2);
  });

  it("stops after a state write fails once the model was called", async () => {
    const h = harness([session(1), session(2)], { s1: failAt("interpret") }, {
      writeCountedFailure: async () => {
        throw new Error("db down");
      },
    });
    const stats = await runMemoryCronBatch(h.deps);
    expect(h.processed).toEqual(["s1"]);
    expect(stats.stateWriteFailed).toBe(1);
    expect(stats.stopped).toBe(true);
    expect(h.logs).toContainEqual([
      "[cron-retry] write_failed route=%s session=%s stage=%s",
      "cron_summarize",
      "s1",
      "interpret",
    ]);
  });

  it("goes on after a state write fails before the model was called", async () => {
    const h = harness([session(1), session(2)], { s1: failAt("before_call") }, {
      writeBackoff: async () => {
        throw new Error("db down");
      },
    });
    const stats = await runMemoryCronBatch(h.deps);
    expect(h.processed).toEqual(["s1", "s2"]);
    expect(stats.stateWriteFailed).toBe(1);
    expect(stats.stopped).toBe(false);
  });
});

describe("runMemoryCronBatch: run deadline", () => {
  it("checks the budget before each session, timed from the start of the run, and defers the rest", async () => {
    const elapsed: number[] = [];
    const h = harness([session(1), session(2), session(3), session(4)], {}, {
      hasBudget: (ms) => {
        elapsed.push(ms);
        return elapsed.length <= 2;
      },
      processSession: async (s) => {
        h.processed.push(s.id);
        h.clock.now += 10000;
      },
    });
    const stats = await runMemoryCronBatch(h.deps);
    expect(elapsed).toEqual([0, 10000, 20000]);
    expect(h.processed).toEqual(["s1", "s2"]);
    expect(stats.deferred).toBe(2);
  });
});

describe("runMemoryCronBatch: logs", () => {
  it("hands the error to the route's handler, never to the log lines", async () => {
    const error = new Error("the user wrote something private");
    const h = harness([session(1), session(2, 2)], {
      s1: failAt("before_call", undefined, error),
      s2: failAt("interpret", undefined, error),
    });
    await runMemoryCronBatch(h.deps);
    expect(h.errors).toEqual([
      ["s1", error],
      ["s2", error],
    ]);
    for (const line of h.logs) {
      expect(line.some((arg) => arg instanceof Error)).toBe(false);
      expect(JSON.stringify(line)).not.toContain("private");
    }
  });

  it("logs to console.error when no log is given", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness([session(1)], { s1: failAt("before_call") }, { log: undefined });
    await runMemoryCronBatch(h.deps);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("cronRunItems", () => {
  it("counts a session given up this run among the failed items", async () => {
    const h = harness([session(1), session(2, 2)], { s2: failAt("interpret") });
    const stats = await runMemoryCronBatch(h.deps);
    expect(stats.givenUp).toBe(1);
    expect(cronRunItems(stats)).toEqual({ itemsProcessed: 1, itemsFailed: 1 });
  });
});

describe("the batch loop knows nothing of crisis content", () => {
  it("has no crisis branch, import or value", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../memoryCronBatch.ts", import.meta.url)),
      "utf8"
    );
    expect(source).not.toMatch(/crisis/i);
  });
});
