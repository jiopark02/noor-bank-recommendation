import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The connection read inside getPlaidChatState, scoped to the owning user.
 *
 * getPlaidChatState reads plaid_connections directly rather than through
 * getAllPlaidConnections, so the scope check on that helper
 * (plaidConnectionReadSeam.test.ts) does not reach it. This read feeds the chat
 * prompt: institution names and statuses at depth "connection", and decrypted
 * tokens for a live balance fetch at depth "balances". createServerClient runs
 * as service-role and bypasses RLS, so `.eq("user_id", userId)` is the only
 * thing keeping another user's connections — and their tokens — out of this
 * user's prompt. Before this file, deleting that filter passed the whole suite.
 *
 * Only the server-client factory is faked, as in plaidConnectionReadSeam.test.ts,
 * and the same caveat applies: vi.mock replaces the whole module for every
 * importer in this file's graph. The tests stay at depth "connection", which
 * never reaches the Plaid SDK or the decrypt, so nothing else needs faking.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * It says nothing about the "balances" path, about what PostgREST or RLS would
 * do with the query, or about how the chat route uses the returned state.
 */

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

vi.mock("../supabase", () => ({
  createServerClient: createServerClientMock,
}));

import { getPlaidChatState } from "../plaidChatState";

/**
 * supabase.from(...).select(...).eq(...).order(...)  ->  { data, error }
 *
 * Every method is a spy so the filters can be asserted on. A method the stub
 * does not define throws a TypeError, which getPlaidChatState does not catch,
 * so a chain change fails these tests loudly rather than silently.
 */
function clientResolving(result: { data: unknown; error: unknown }) {
  const order = vi.fn(() => Promise.resolve(result));
  const builder: Record<string, unknown> = { order };
  const select = vi.fn(() => builder);
  const eq = vi.fn(() => builder);
  builder.select = select;
  builder.eq = eq;
  const from = vi.fn(() => builder);
  return { client: { from }, from, select, eq, order };
}

describe("getPlaidChatState — the connection read is scoped to the owning user", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters plaid_connections on the caller's userId and on nothing else", async () => {
    // Dropping the user_id filter, or passing anything other than the verified
    // userId, would put other users' institutions into this user's prompt. A
    // second filter (status, say) would hide errored connections that the
    // state deliberately reports. eq is pinned to one call with these arguments.
    const stub = clientResolving({ data: [], error: null });
    createServerClientMock.mockReturnValue(stub.client);

    await getPlaidChatState("user_scope_9", { depth: "connection" });

    expect(stub.from).toHaveBeenCalledTimes(1);
    expect(stub.from).toHaveBeenCalledWith("plaid_connections");
    expect(stub.eq.mock.calls).toEqual([["user_id", "user_scope_9"]]);
    expect(stub.order).toHaveBeenCalledTimes(1);
  });

  it("reports every row the scoped read returned, active or not", async () => {
    // The read is the only filter: rows are mapped, not dropped, so an errored
    // connection still appears in the state with its status.
    const stub = clientResolving({
      data: [
        { institution_name: "Bank A", status: "active", access_token: "x" },
        { institution_name: "Bank B", status: "error", access_token: "y" },
      ],
      error: null,
    });
    createServerClientMock.mockReturnValue(stub.client);

    const state = await getPlaidChatState("user_scope_9", {
      depth: "connection",
    });

    expect(state.connected).toBe(true);
    expect(state.connections).toEqual([
      { institution: "Bank A", status: "active" },
      { institution: "Bank B", status: "error" },
    ]);
  });
});
