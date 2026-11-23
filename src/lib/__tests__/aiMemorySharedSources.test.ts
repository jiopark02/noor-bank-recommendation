import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getSessionSharedSources is the read the chat route decides on before every
 * turn of a session: any pair it returns sends the turn's save through
 * chat_shared_turn_save, which refuses the turn once a mark is gone. A missing
 * user_id filter would let a wrong session id decide by another person's
 * marks, and a failed read answered as "no marks" would save a turn whose
 * history held shared figures through the plain insert, with nothing marking
 * it. These tests record the query builder calls.
 *
 * Mutations and the test each one turns red:
 *   a filter of the query removed or changed                         -> N14 query
 *   a failed query answered with an empty list                       -> N14 failure
 *   a row that is not a pair skipped or passed on                    -> N14 rows
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

import { getSessionSharedSources } from "../aiMemory";

const OWNER = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
});

describe("getSessionSharedSources (N14)", () => {
  it("query: the session's own marks of shared bank connections, filtered by session and user", async () => {
    result = { data: [{ owner_user_id: OWNER, resource_id: 7001 }], error: null };
    expect(await getSessionSharedSources("s1", "u1")).toEqual([
      { ownerUserId: OWNER, connectionId: 7001 },
    ]);
    expect(calls).toEqual([
      ["from", ["chat_shared_sources"]],
      ["select", ["owner_user_id, resource_id"]],
      ["eq", ["session_id", "s1"]],
      ["eq", ["user_id", "u1"]],
      ["eq", ["resource_type", "plaid_connection"]],
    ]);
  });

  it("answers an empty list when the session has no mark", async () => {
    result = { data: [], error: null };
    expect(await getSessionSharedSources("s1", "u1")).toEqual([]);
    result = { data: null, error: null };
    expect(await getSessionSharedSources("s1", "u1")).toEqual([]);
  });

  it("rows: a connection id sent as a string of digits is read as a number", async () => {
    result = {
      data: [
        { owner_user_id: OWNER, resource_id: "7002" },
        { owner_user_id: OWNER, resource_id: 7003 },
      ],
      error: null,
    };
    expect(await getSessionSharedSources("s1", "u1")).toEqual([
      { ownerUserId: OWNER, connectionId: 7002 },
      { ownerUserId: OWNER, connectionId: 7003 },
    ]);
  });

  it("failure: a failed query throws, keeping the database's code on the cause, never an empty list", async () => {
    result = { data: null, error: { message: "boom", code: "42P01" } };
    const error = await getSessionSharedSources("s1", "u1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Failed to fetch the marked sources of a session");
    expect(((error as Error).cause as { code?: string }).code).toBe("42P01");
  });

  it("rows: a row that is not a pair throws rather than being skipped", async () => {
    for (const bad of [
      { owner_user_id: null, resource_id: 7001 },
      { owner_user_id: "", resource_id: 7001 },
      { owner_user_id: OWNER, resource_id: null },
      { owner_user_id: OWNER, resource_id: 0 },
      { owner_user_id: OWNER, resource_id: -3 },
      { owner_user_id: OWNER, resource_id: 1.5 },
      { owner_user_id: OWNER, resource_id: "7x" },
      { owner_user_id: OWNER, resource_id: "99999999999999999" },
    ]) {
      result = { data: [{ owner_user_id: OWNER, resource_id: 7001 }, bad], error: null };
      await expect(getSessionSharedSources("s1", "u1")).rejects.toThrow("a row is not a pair");
    }
  });
});
