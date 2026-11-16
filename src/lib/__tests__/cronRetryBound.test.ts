import { describe, expect, it } from "vitest";
import {
  CRON_MAX_COUNTED_FAILURES,
  CRON_RETRY_BACKOFF_MS,
  SESSION_CANDIDATE_LIMIT,
} from "../cronRetryBound";

/**
 * The limit values. How they are applied is executed in
 * memoryCronBatch.test.ts.
 */
describe("bound values", () => {
  it("gives up after three counted failures and reads 24 candidates", () => {
    expect(CRON_MAX_COUNTED_FAILURES).toBe(3);
    expect(SESSION_CANDIDATE_LIMIT).toBe(24);
  });

  it("backs a failed session off for two hours", () => {
    expect(CRON_RETRY_BACKOFF_MS).toBe(2 * 60 * 60 * 1000);
  });
});
