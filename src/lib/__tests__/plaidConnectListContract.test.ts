import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { SessionReadResult } from "../supabase-browser";
import {
  activeItemIds,
  createPublicTokenHolder,
  readConnectionList,
} from "../plaidConnectFlow";

/**
 * The connection list the exchange is judged by is the one the list route
 * really sends.
 *
 * After an exchange request that got no answer, plaidConnectFlow reads
 * GET /api/plaid/connections and counts the bank as connected only when the
 * list has a new active Item id. That rests on two fields of each row. Here
 * the real route handler runs and the body it answers with is handed,
 * unchanged, to the reader the browser uses and through it to the real
 * holder, so a field the route stops sending, renames or stops selecting
 * turns this file red instead of quietly never matching.
 *
 * Faked: the id helper (a verified user) and the Supabase client. The fake
 * table answers with the columns the route's select names and no others, so
 * dropping a column from the select is seen too. The database itself is not
 * part of this: that the table has these columns is a live check.
 *
 * Mutations that turn this file red:
 *   - the route's `itemId` or `status` renamed, dropped, or no longer selected -> "the rows the route sends"
 *   - the reader matching rows by a field the route does not send              -> "the rows the route sends"
 *   - the holder judging by anything the route's body does not carry           -> "a lost exchange is settled"
 *   - a row that is not active counted                                         -> "a connection that is not active"
 */

type Row = Record<string, unknown>;

const state = {
  rows: [] as Row[],
  selects: [] as string[],
  filters: [] as Array<[string, unknown]>,
};

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => "user-1",
}));

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table !== "plaid_connections") throw new Error(`test: unexpected table ${table}`);
      return {
        select: (columns: string) => {
          state.selects.push(columns);
          const names = columns.split(",").map((name) => name.trim());
          return {
            eq: (column: string, value: unknown) => {
              state.filters.push([column, value]);
              return {
                order: async () => ({
                  data: state.rows
                    .filter((row) => row[column] === value)
                    .map((row) => {
                      const projected: Row = {};
                      for (const name of names) projected[name] = row[name];
                      return projected;
                    }),
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  }),
}));

/** A stored row, with the columns the table has beyond the ones the list needs. */
function stored(itemId: string, status: string, userId = "user-1"): Row {
  return {
    user_id: userId,
    item_id: itemId,
    institution_id: "ins_1",
    institution_name: "Test Bank",
    status,
    access_token: "never-sent",
    created_at: "2026-11-01T00:00:00.000Z",
  };
}

/** The body the real route answers with, as the browser would parse it. */
async function listBody(): Promise<unknown> {
  const { GET } = await import("../../app/api/plaid/connections/route");
  const response = await GET(
    new Request("https://noor.test/api/plaid/connections", {
      headers: { authorization: "Bearer access-user-1" },
    }) as unknown as NextRequest
  );
  expect(response.status).toBe(200);
  return JSON.parse(await response.text());
}

function session(userId: string): SessionReadResult {
  return {
    status: "session",
    session: { access_token: `access-${userId}`, user: { id: userId } },
  } as unknown as SessionReadResult;
}

beforeEach(() => {
  state.rows = [];
  state.selects = [];
  state.filters = [];
});

describe("the connection list the exchange is judged by", () => {
  it("the rows the route sends carry the Item id and status the reader takes", async () => {
    state.rows = [
      stored("item-a", "active"),
      stored("item-b", "pending_expiration"),
      stored("item-other-user", "active", "user-2"),
    ];

    const body = await listBody();
    const list = readConnectionList(body);

    expect(state.filters).toEqual([["user_id", "user-1"]]);
    expect(list).toEqual([
      { itemId: "item-a", status: "active" },
      { itemId: "item-b", status: "error" },
    ]);
    expect(activeItemIds(list ?? [])).toEqual(["item-a"]);

    // The route sends no institution id, so no row can be matched by one.
    const rows = (body as { connections: Row[] }).connections;
    expect(rows.length).toBe(2);
    for (const sent of rows) {
      expect(Object.keys(sent).sort()).toEqual(["createdAt", "institutionName", "itemId", "status"]);
    }
  });

  it("a lost exchange is settled by the route's real answer", async () => {
    state.rows = [stored("item-a", "active")];
    const before = activeItemIds(readConnectionList(await listBody()) ?? []);
    expect(before).toEqual(["item-a"]);

    const posts: string[] = [];
    const holder = createPublicTokenHolder({
      readSession: async () => session("user-1"),
      sleep: async () => {},
      now: () => 1_000_000,
      post: async (_accessToken, payload) => {
        posts.push(payload.publicToken);
        throw new TypeError("Failed to fetch");
      },
      readConnections: async () => readConnectionList(await listBody()),
    });
    holder.hold("public-1", { name: "Test Bank", institution_id: "ins_1" }, "user-1", before);

    // Nothing new in the list: the outcome stays unknown and the token is kept.
    expect(await holder.send()).toEqual({
      kind: "notice",
      message: "We couldn't finish connecting your bank. Try again.",
      canRetry: true,
    });
    expect(holder.hasToken()).toBe(true);

    // The lost request did finish: its row is in the table now.
    state.rows = [stored("item-new", "active"), stored("item-a", "active")];
    expect(await holder.send()).toEqual({ kind: "connected" });
    expect(posts).toEqual(["public-1"]);
    expect(holder.hasToken()).toBe(false);
  });

  it("a connection that is not active in the route's answer is not counted", async () => {
    state.rows = [stored("item-a", "active")];
    const holder = createPublicTokenHolder({
      readSession: async () => session("user-1"),
      sleep: async () => {},
      now: () => 1_000_000,
      post: async () => {
        throw new TypeError("Failed to fetch");
      },
      readConnections: async () => readConnectionList(await listBody()),
    });
    holder.hold("public-1", { name: "Test Bank", institution_id: "ins_1" }, "user-1", ["item-a"]);
    state.rows = [stored("item-new", "error"), stored("item-a", "active")];

    expect((await holder.send()).kind).toBe("notice");
    expect(holder.hasToken()).toBe(true);
  });
});
