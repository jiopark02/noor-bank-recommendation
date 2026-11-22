import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getSessionMessages is the read the chat model's history is built from, so
 * the exact query matters: a missing user_id filter reads another user's turns
 * when a session id is wrong, and a wrong order or limit hands the model the
 * oldest turns instead of the newest. These tests record the query builder
 * calls.
 *
 * The memory jobs also bound the read by a moment: where another household
 * member's shared bank data entered the session. A bound that includes the
 * moment itself, or a value changed on the way, lets a marked message into
 * a summary; a bound applied when none was given would hide messages from
 * the chat. getEarliestSharedSourceTime supplies that moment, and a failed
 * read there must throw, never answer "none".
 */

const calls: Array<[string, unknown[]]> = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase", () => ({
  isSupabaseAdminConfigured: () => true,
  createAdminClient: () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq", "lt", "order", "limit"]) {
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

import { getEarliestSharedSourceTime, getSessionMessages } from "../aiMemory";

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
});

describe("getSessionMessages", () => {
  it("desc: filters by session and user, newest first with assistant before user on a tie, then limits", async () => {
    await getSessionMessages("s1", "u1", { limit: 7, order: "desc" });
    expect(calls).toEqual([
      ["from", ["chat_messages"]],
      ["select", ["*"]],
      ["eq", ["session_id", "s1"]],
      ["eq", ["user_id", "u1"]],
      ["order", ["created_at", { ascending: false }]],
      ["order", ["role", { ascending: true }]],
      ["order", ["id", { ascending: false }]],
      ["limit", [7]],
    ]);
  });

  it("asc: filters by session and user, oldest first with user before assistant on a tie, then limits", async () => {
    await getSessionMessages("s1", "u1", { limit: 7, order: "asc" });
    expect(calls).toEqual([
      ["from", ["chat_messages"]],
      ["select", ["*"]],
      ["eq", ["session_id", "s1"]],
      ["eq", ["user_id", "u1"]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["role", { ascending: false }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [7]],
    ]);
  });

  it("defaults to ascending order and a limit of 50", async () => {
    await getSessionMessages("s1", "u1");
    expect(calls.filter(([method]) => method === "order")[0]).toEqual([
      "order",
      ["created_at", { ascending: true }],
    ]);
    expect(calls.filter(([method]) => method === "limit")).toEqual([["limit", [50]]]);
  });

  it("returns the rows as given and an empty array for null data", async () => {
    const rows = [{ id: "m1", role: "user", content: "q" }];
    result = { data: rows, error: null };
    expect(await getSessionMessages("s1", "u1")).toEqual(rows);
    result = { data: null, error: null };
    expect(await getSessionMessages("s1", "u1")).toEqual([]);
  });

  it("throws when the query fails", async () => {
    result = { data: null, error: { message: "boom", code: "08006" } };
    await expect(getSessionMessages("s1", "u1")).rejects.toThrow(
      "Failed to fetch session messages"
    );
  });

  it("before: reads only messages created strictly before the moment, passed on unchanged, and the rest of the query is the same", async () => {
    // Microseconds and an offset, as the database prints a timestamptz.
    const moment = "2026-11-22T09:15:30.123456+00:00";
    await getSessionMessages("s1", "u1", { limit: 7, order: "desc", before: moment });
    expect(calls).toEqual([
      ["from", ["chat_messages"]],
      ["select", ["*"]],
      ["eq", ["session_id", "s1"]],
      ["eq", ["user_id", "u1"]],
      ["lt", ["created_at", moment]],
      ["order", ["created_at", { ascending: false }]],
      ["order", ["role", { ascending: true }]],
      ["order", ["id", { ascending: false }]],
      ["limit", [7]],
    ]);
  });

  it("no bound is applied when none is given", async () => {
    await getSessionMessages("s1", "u1", { limit: 7, order: "desc" });
    await getSessionMessages("s1", "u1");
    expect(calls.filter(([method]) => method === "lt")).toEqual([]);
  });
});

describe("getEarliestSharedSourceTime", () => {
  it("reads the earliest moment of the session's sources, filtered by session and user", async () => {
    const moment = "2026-11-22T09:15:30.123456+00:00";
    result = { data: [{ first_shared_at: moment }], error: null };
    expect(await getEarliestSharedSourceTime("s1", "u1")).toBe(moment);
    expect(calls).toEqual([
      ["from", ["chat_shared_sources"]],
      ["select", ["first_shared_at"]],
      ["eq", ["session_id", "s1"]],
      ["eq", ["user_id", "u1"]],
      ["order", ["first_shared_at", { ascending: true }]],
      ["limit", [1]],
    ]);
  });

  it("answers null when the session has no source", async () => {
    result = { data: [], error: null };
    expect(await getEarliestSharedSourceTime("s1", "u1")).toBeNull();
    result = { data: null, error: null };
    expect(await getEarliestSharedSourceTime("s1", "u1")).toBeNull();
  });

  it("throws when the query fails, so a failed read is never taken for no source", async () => {
    result = { data: null, error: { message: "boom", code: "42P01" } };
    await expect(getEarliestSharedSourceTime("s1", "u1")).rejects.toThrow(
      "Failed to fetch shared sources of a session"
    );
  });

  it("throws when the row carries no usable moment", async () => {
    for (const bad of [null, "", 5, undefined]) {
      result = { data: [{ first_shared_at: bad }], error: null };
      await expect(getEarliestSharedSourceTime("s1", "u1")).rejects.toThrow(
        "no moment in the row"
      );
    }
  });
});
