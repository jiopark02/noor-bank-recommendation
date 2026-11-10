import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_LLM_TIMEOUT_MS,
  CHAT_REQUEST_BUDGET_MS,
  ChatDeadlineError,
  chatHasBudgetForAnotherAttempt,
  chatPreLoopDeadlineMs,
  runUntilDeadline,
  CRON_LLM_TIMEOUT_MS,
  CRON_RUN_BUDGET_MS,
  CRON_RUN_MARGIN_MS,
  cronRunHasBudgetForAnotherCall,
  logLlmTimeout,
} from "../llmTimeouts";

describe("timeout values", () => {
  // Unvalidated defaults; pinned so that a change is a deliberate one.
  it("are 25 s per call, with a 55 s cron budget and a 5 s margin", () => {
    expect(CHAT_LLM_TIMEOUT_MS).toBe(25000);
    expect(CRON_LLM_TIMEOUT_MS).toBe(25000);
    expect(CRON_RUN_BUDGET_MS).toBe(55000);
    expect(CRON_RUN_MARGIN_MS).toBe(5000);
  });

  it("leave the cron budget below the crons' 60 s maxDuration", () => {
    expect(CRON_RUN_BUDGET_MS).toBeLessThan(60000);
  });

  it("give the chat route a 55 s budget with room for two full attempts", () => {
    expect(CHAT_REQUEST_BUDGET_MS).toBe(55000);
    expect(CHAT_REQUEST_BUDGET_MS).toBeGreaterThanOrEqual(2 * CHAT_LLM_TIMEOUT_MS);
  });

  // A source probe: the budget assumes the chat route's maxDuration.
  it("the chat route declares maxDuration = 60 exactly once", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../app/api/chat/route.ts", import.meta.url)),
      "utf8"
    );
    expect(source.split("export const maxDuration = 60;").length - 1).toBe(1);
  });
});

describe("chatHasBudgetForAnotherAttempt", () => {
  it("allows an attempt at the start of a request", () => {
    expect(chatHasBudgetForAnotherAttempt(0)).toBe(true);
  });

  it("allows an attempt that would end exactly at the budget", () => {
    expect(chatHasBudgetForAnotherAttempt(30000)).toBe(true);
  });

  it("refuses an attempt that could run past it", () => {
    expect(chatHasBudgetForAnotherAttempt(30001)).toBe(false);
    expect(chatHasBudgetForAnotherAttempt(55000)).toBe(false);
  });
});

describe("chatPreLoopDeadlineMs", () => {
  it("is the request budget less one full attempt, not a value of its own", () => {
    expect(chatPreLoopDeadlineMs()).toBe(
      CHAT_REQUEST_BUDGET_MS - CHAT_LLM_TIMEOUT_MS
    );
    expect(chatPreLoopDeadlineMs()).toBe(30000);
  });

  it("is the last moment a first attempt may start", () => {
    expect(chatHasBudgetForAnotherAttempt(chatPreLoopDeadlineMs())).toBe(true);
    expect(chatHasBudgetForAnotherAttempt(chatPreLoopDeadlineMs() + 1)).toBe(false);
  });
});

describe("ChatDeadlineError", () => {
  it("names the stage and is recognizable by instanceof", () => {
    const error = new ChatDeadlineError("memory");
    expect(error).toBeInstanceOf(ChatDeadlineError);
    expect(error).toBeInstanceOf(Error);
    expect(error.stage).toBe("memory");
    expect(error.name).toBe("ChatDeadlineError");
  });

  // The chat route's retry helper retries an error whose message contains one
  // of these. A wait cut at its deadline must not be started again.
  it.each(["auth", "body", "profile", "session", "memory", "plaid_state", "balance"])(
    "its message for stage %s has none of the words a retry looks for",
    (stage) => {
      const message = new ChatDeadlineError(stage).message;
      expect(message).not.toContain("timeout");
      expect(message).not.toContain("network");
      expect(message).not.toContain("fetch failed");
    }
  );
});

describe("runUntilDeadline", () => {
  const START = new Date("2026-11-10T11:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A promise that settles only when told to, with the signal it was given. */
  function controlled<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    let signal: AbortSignal | undefined;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const fn = vi.fn((s: AbortSignal) => {
      signal = s;
      return promise;
    });
    return { fn, resolve, reject, signal: () => signal };
  }

  it("returns what fn resolves to, and leaves no timer behind", async () => {
    const result = await runUntilDeadline(START + 1000, "profile", async () => "value");
    expect(result).toBe("value");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rethrows fn's own rejection unchanged", async () => {
    const failure = new Error("read failed");
    await expect(
      runUntilDeadline(START + 1000, "profile", async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("turns a synchronous throw in fn into the same rejection", async () => {
    const failure = new Error("threw at once");
    await expect(
      runUntilDeadline(START + 1000, "profile", () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });

  it("does not abort the signal when fn settles first", async () => {
    const call = controlled<string>();
    const run = runUntilDeadline(START + 1000, "plaid_state", call.fn);
    await vi.advanceTimersByTimeAsync(999);
    call.resolve("done");
    await expect(run).resolves.toBe("done");
    expect(call.signal()?.aborted).toBe(false);
  });

  it("is still waiting one millisecond before the deadline", async () => {
    const call = controlled<string>();
    let settled = false;
    const run = runUntilDeadline(START + 1000, "memory", call.fn).then(
      () => (settled = true),
      () => (settled = true)
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(settled).toBe(true);
  });

  it("throws ChatDeadlineError for the stage at the deadline and aborts the signal", async () => {
    const call = controlled<string>();
    const run = runUntilDeadline(START + 1000, "plaid_state", call.fn);
    const outcome = run.then(
      () => null,
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(1000);
    const error = await outcome;
    expect(error).toBeInstanceOf(ChatDeadlineError);
    expect((error as ChatDeadlineError).stage).toBe("plaid_state");
    expect(call.signal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a result that arrives after the deadline, and swallows a late rejection", async () => {
    const late = controlled<string>();
    const lateRun = runUntilDeadline(START + 1000, "session", late.fn).catch(
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await lateRun).toBeInstanceOf(ChatDeadlineError);
    // Neither of these may surface: nothing is waiting for the call any more.
    late.reject(new Error("failed after nobody was waiting"));
    await vi.advanceTimersByTimeAsync(10);
  });

  it.each([
    ["exactly now", 0],
    ["already passed", -1],
    ["long passed", -60000],
  ])("does not call fn when the deadline is %s", async (_label, offset) => {
    const fn = vi.fn(async () => "value");
    await expect(
      runUntilDeadline(START + offset, "balance", fn)
    ).rejects.toBeInstanceOf(ChatDeadlineError);
    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("cronRunHasBudgetForAnotherCall", () => {
  it("allows a call at the start of a run", () => {
    expect(cronRunHasBudgetForAnotherCall(0)).toBe(true);
  });

  it("allows a call that would end exactly at the budget minus the margin", () => {
    expect(cronRunHasBudgetForAnotherCall(25000)).toBe(true);
  });

  it("refuses a call that could run past it", () => {
    expect(cronRunHasBudgetForAnotherCall(25001)).toBe(false);
    expect(cronRunHasBudgetForAnotherCall(54000)).toBe(false);
  });
});

describe("logLlmTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs route, model and timeout as one line, and nothing else", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logLlmTimeout("chat", "~anthropic/claude-sonnet-latest", 25000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      "[llm-timeout] route=%s model=%s ms=%d",
      "chat",
      "~anthropic/claude-sonnet-latest",
      25000
    );
  });
});
