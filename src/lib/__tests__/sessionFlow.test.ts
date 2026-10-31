import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALLBACK_SESSION_RETRY,
  CALLBACK_SURVEY_RETRY,
  DASHBOARD_SESSION_RETRY,
  decideCallbackRoute,
  decideCallbackSession,
  decideDashboardMount,
  decideLateSignIn,
  decideLoginMount,
  readSurveyLookup,
  retryUntilAnswered,
  settleWithin,
  shouldRetrySessionRead,
  type RetryPlan,
} from "../sessionFlow";
import type { SessionReadResult } from "../supabase-browser";

/**
 * Executes the decisions behind /dashboard, /login and /auth/callback. Whether
 * the pages use them is probed in sessionFlowWiring.test.ts; what readSession
 * returns is executed in readSessionStatus.test.ts.
 */

const SESSION = {
  status: "session",
  session: { user: { id: "user-1" } },
} as unknown as SessionReadResult;
const NONE: SessionReadResult = { status: "none" };

function unavailable(
  reason: "not-configured" | "timeout" | "error"
): SessionReadResult {
  return { status: "unavailable", reason, elapsedMs: 1 };
}

const UNAVAILABLE_READS: Array<[string, SessionReadResult]> = [
  ["not-configured", unavailable("not-configured")],
  ["timeout", unavailable("timeout")],
  ["error", unavailable("error")],
];

const PLAN: RetryPlan = { timeoutsMs: [10, 20, 30], gapsMs: [1, 2] };

function retryDeps(isCancelled: () => boolean = () => false) {
  const slept: number[] = [];
  return {
    slept,
    deps: {
      sleep: async (ms: number) => {
        slept.push(ms);
      },
      isCancelled,
    },
  };
}

describe("decideDashboardMount", () => {
  it("E1 a session proceeds", () => {
    expect(decideDashboardMount(SESSION)).toBe("proceed");
  });

  it("E2 a real absence signs out", () => {
    expect(decideDashboardMount(NONE)).toBe("sign-out");
  });

  it.each(UNAVAILABLE_READS)("E3 unavailable (%s) never signs out", (_, read) => {
    expect(decideDashboardMount(read)).toBe("show-delayed");
  });
});

describe("decideLoginMount", () => {
  it("E4 a session goes to the dashboard", () => {
    expect(decideLoginMount(SESSION)).toBe("go-dashboard");
  });

  it("E5 a real absence clears the stale local state", () => {
    expect(decideLoginMount(NONE)).toBe("clear-local");
  });

  it.each(UNAVAILABLE_READS)("E6 unavailable (%s) does nothing", (_, read) => {
    expect(decideLoginMount(read)).toBe("stay");
  });
});

describe("decideCallbackSession", () => {
  it("E7 a session continues", () => {
    expect(decideCallbackSession(SESSION)).toBe("continue");
  });

  it("E8 a real absence is the no-session screen", () => {
    expect(decideCallbackSession(NONE)).toBe("no-session");
  });

  it.each(UNAVAILABLE_READS)("E9 unavailable (%s) offers a retry", (_, read) => {
    expect(decideCallbackSession(read)).toBe("show-retry");
  });
});

describe("readSurveyLookup", () => {
  it("E10 a row is found", () => {
    expect(
      readSurveyLookup({
        timedOut: false,
        value: { data: { id: 1 }, error: null },
      })
    ).toBe("found");
  });

  it("E11 no row and no error is missing", () => {
    expect(
      readSurveyLookup({ timedOut: false, value: { data: null, error: null } })
    ).toBe("missing");
  });

  it("E12 a query error is failed, not missing", () => {
    expect(
      readSurveyLookup({
        timedOut: false,
        value: { data: null, error: { code: "XX000" } },
      })
    ).toBe("failed");
  });

  it("E13 a timed-out query is failed, not missing", () => {
    expect(readSurveyLookup({ timedOut: true })).toBe("failed");
  });
});

describe("decideCallbackRoute", () => {
  it("E14 found with a good sync goes to the dashboard", () => {
    expect(decideCallbackRoute("found", true)).toBe("dashboard");
  });

  it("E15 found with a failed sync still goes to the dashboard", () => {
    expect(decideCallbackRoute("found", false)).toBe("dashboard");
  });

  it("E16 missing with a good sync goes to the survey", () => {
    expect(decideCallbackRoute("missing", true)).toBe("survey");
  });

  it("E17 missing with a failed sync stops on the setup error", () => {
    expect(decideCallbackRoute("missing", false)).toBe("setup-error");
  });
});

describe("retryUntilAnswered", () => {
  it("E18 an answer on the first attempt runs once", async () => {
    const run = vi.fn(async () => SESSION);
    const { deps, slept } = retryDeps();
    await expect(
      retryUntilAnswered(run, shouldRetrySessionRead, PLAN, deps)
    ).resolves.toBe(SESSION);
    expect(run).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it("E19 unavailable then a session runs twice and returns the session", async () => {
    const run = vi
      .fn<(timeoutMs: number, attempt: number) => Promise<SessionReadResult>>()
      .mockResolvedValueOnce(unavailable("timeout"))
      .mockResolvedValueOnce(SESSION);
    const { deps } = retryDeps();
    await expect(
      retryUntilAnswered(run, shouldRetrySessionRead, PLAN, deps)
    ).resolves.toBe(SESSION);
    expect(run.mock.calls).toEqual([
      [10, 1],
      [20, 2],
    ]);
  });

  it("E20 always unavailable uses every attempt and gap, in order", async () => {
    const last = unavailable("error");
    const run = vi.fn(async () => last);
    const { deps, slept } = retryDeps();
    await expect(
      retryUntilAnswered(run, shouldRetrySessionRead, PLAN, deps)
    ).resolves.toBe(last);
    expect(run.mock.calls).toEqual([
      [10, 1],
      [20, 2],
      [30, 3],
    ]);
    expect(slept).toEqual([1, 2]);
  });

  it("E21 none is an answer and is not retried", async () => {
    const run = vi.fn(async () => NONE);
    const { deps } = retryDeps();
    await retryUntilAnswered(run, shouldRetrySessionRead, PLAN, deps);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("E22 not-configured is not retried", async () => {
    const run = vi.fn(async () => unavailable("not-configured"));
    const { deps } = retryDeps();
    await retryUntilAnswered(run, shouldRetrySessionRead, PLAN, deps);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("E23 no attempt starts once cancelled, including during a gap", async () => {
    const atStart = vi.fn(async () => unavailable("timeout"));
    await retryUntilAnswered(
      atStart,
      shouldRetrySessionRead,
      PLAN,
      retryDeps(() => true).deps
    );
    expect(atStart).toHaveBeenCalledTimes(1);

    let cancelled = false;
    const duringGap = vi.fn(async () => unavailable("timeout"));
    await retryUntilAnswered(duringGap, shouldRetrySessionRead, PLAN, {
      sleep: async () => {
        cancelled = true;
      },
      isCancelled: () => cancelled,
    });
    expect(duringGap).toHaveBeenCalledTimes(1);
  });
});

describe("settleWithin", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("E24 returns the value when the work finishes in time", async () => {
    await expect(settleWithin(Promise.resolve("done"), 1000)).resolves.toEqual({
      timedOut: false,
      value: "done",
    });
  });

  it("E25 reports a timeout at the limit when the work never finishes", async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const outcome = settleWithin(new Promise(() => {}), 1000).then((value) => {
      settled();
      return value;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toEqual({ timedOut: true });
  });

  it("E26 passes a rejection on", async () => {
    await expect(
      settleWithin(Promise.reject(new Error("boom")), 1000)
    ).rejects.toThrow("boom");
  });

  it("E27 a rejection after the limit is not an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      let rejectWork: (reason: Error) => void = () => {};
      const work = new Promise((_, reject) => {
        rejectWork = reject;
      });
      await expect(settleWithin(work, 1)).resolves.toEqual({ timedOut: true });
      rejectWork(new Error("late"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
});

describe("decideLateSignIn", () => {
  const LATE = {
    attempt: 1,
    latestAttempt: 1,
    mounted: true,
    hasError: false,
    hasUser: true,
  };

  it("E28 adopts the latest attempt's success on a mounted page", () => {
    expect(decideLateSignIn(LATE)).toBe("adopt");
  });

  it("E29 ignores it once a newer attempt has started", () => {
    expect(decideLateSignIn({ ...LATE, latestAttempt: 2 })).toBe("ignore");
  });

  it("E30 ignores it after the page has unmounted", () => {
    expect(decideLateSignIn({ ...LATE, mounted: false })).toBe("ignore");
  });

  it("E31 ignores an error or a missing user", () => {
    expect(decideLateSignIn({ ...LATE, hasError: true })).toBe("ignore");
    expect(decideLateSignIn({ ...LATE, hasUser: false })).toBe("ignore");
  });
});

describe("retry plans", () => {
  it.each([
    ["DASHBOARD_SESSION_RETRY", DASHBOARD_SESSION_RETRY],
    ["CALLBACK_SESSION_RETRY", CALLBACK_SESSION_RETRY],
    ["CALLBACK_SURVEY_RETRY", CALLBACK_SURVEY_RETRY],
  ])("E32 %s has one gap between each pair of attempts", (_, plan) => {
    expect(plan.timeoutsMs.length).toBe(plan.gapsMs.length + 1);
  });
});
