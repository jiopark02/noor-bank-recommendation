import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getSessionMessages is the read the chat model's history is built from, so
 * the exact query matters: a missing user_id filter reads another user's turns
 * when a session id is wrong, and a wrong order or limit hands the model the
 * oldest turns instead of the newest. These tests record the query builder
 * calls.
 */

const calls: Array<[string, unknown[]]> = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase", () => ({
  isSupabaseAdminConfigured: () => true,
  createAdminClient: () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq", "order", "limit"]) {
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

import { getSessionMessages } from "../aiMemory";

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
});
