import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getRespondedAttemptCounts decides which cron sessions are given up, so the
 * exact query matters: a wrong filter either never gives up (the bound is
 * inert) or gives up on sessions that only ever hit routing or network
 * errors. These tests record the query builder calls.
 */

const calls: Array<[string, unknown[]]> = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase", () => ({
  isSupabaseAdminConfigured: () => true,
  createAdminClient: () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq", "in", "gte", "lte", "or", "neq"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, args]);
        return builder;
      };
    }
    builder.then = (resolve: (value: typeof result) => unknown) =>
      Promise.resolve(result).then(resolve);
    return builder;
  },
}));

import { getRespondedAttemptCounts } from "../aiMemory";

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
});

describe("getRespondedAttemptCounts", () => {
  it("counts only answered attempts for the route and the given sessions", async () => {
    await getRespondedAttemptCounts("cron_summarize", ["a", "b"]);
    expect(calls).toEqual([
      ["from", ["llm_calls"]],
      ["select", ["session_id"]],
      ["eq", ["route", "cron_summarize"]],
      ["in", ["session_id", ["a", "b"]]],
      ["gte", ["http_status", 200]],
      ["lte", ["http_status", 299]],
      ["or", ["error_class.is.null,error_class.neq.network_error"]],
    ]);
  });

  it("never uses neq, which would drop the successful rows whose error_class is null", async () => {
    await getRespondedAttemptCounts("cron_extract_facts", ["a"]);
    expect(calls.some(([method]) => method === "neq")).toBe(false);
  });

  it("returns a count per session id", async () => {
    result = {
      data: [
        { session_id: "a" },
        { session_id: "a" },
        { session_id: "b" },
        { session_id: null },
      ],
      error: null,
    };
    expect(
      await getRespondedAttemptCounts("cron_summarize", ["a", "b", "c"])
    ).toEqual({ a: 2, b: 1 });
  });

  it("does not query for an empty list", async () => {
    expect(await getRespondedAttemptCounts("cron_summarize", [])).toEqual({});
    expect(calls).toEqual([]);
  });

  it("throws when the query fails", async () => {
    result = { data: null, error: { message: "boom", code: "08006" } };
    await expect(
      getRespondedAttemptCounts("cron_summarize", ["a"])
    ).rejects.toThrow("Failed to count responded attempts");
  });
});
