import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_LLM_TIMEOUT_MS,
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
