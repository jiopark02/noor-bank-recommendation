import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { makeFakeClient, type FakeOptions } from "./householdFakeClient";
import { readShareRequest } from "../householdShare";

/**
 * GET and PUT /api/household/sharing, executed. The real route, the real
 * householdGate and resolveRequestAuth, the decisions and the real share
 * store run; faked are the supabase module's configuration predicates, the
 * auth server's getUser and the service-role client (householdFakeClient.ts).
 *
 * Mutations and the test each one turns red:
 *   a body userId (or any body value but itemId and shared) passed to the rpc -> SH-I1
 *   the rpc given another user id than the verified one                     -> SH-I1
 *   solo, none or no_connection answered 200, or refused answered 200       -> SH-M1
 *   an unknown answer or a failed call answered 200                         -> SH-M1
 *   the user_id filter removed from the connection read                    -> SH-R1
 *   the owner_user_id filter removed from the grant or answer read         -> SH-R1
 *   a grant to another person or household shown as shared                 -> SH-R2
 *   an answer about another person shown as answered                       -> SH-R2
 *   the other member's id put in the response                             -> SH-R2
 *   connections read when there is no other member                        -> SH-R3
 *   a log line given an item id, a name or an id                          -> SH-G1
 */

const SENTINEL_BEARER = "sentinel-bearer-token-5e2a";
const USER_ID = "sentinel-user-id-31";
const PARTNER_ID = "sentinel-partner-id-42";
const OTHER_ID = "sentinel-other-id-53";
const HOUSEHOLD = "sentinel-household-64";
const OTHER_HOUSEHOLD = "sentinel-household-75";
const ITEM = "sentinel-item-86";
const ITEM_2 = "sentinel-item-97";
const NAME = "Sentinelpartner";
const BANK = "Sentinel Bank";

const state = {
  user: { id: USER_ID, email: "sentinel.user@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" } as Record<
    string,
    unknown
  > | null,
  fake: makeFakeClient(),
};

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () =>
        state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: null },
    },
  }),
  createAdminClient: () => state.fake.client,
  isSupabaseConfigured: () => true,
  isSupabaseAdminConfigured: () => true,
}));

async function send(
  method: "GET" | "PUT",
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const mod = await import("../../app/api/household/sharing/route");
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${SENTINEL_BEARER}` },
  };
  if (method !== "GET" && body !== undefined) init.body = JSON.stringify(body);
  const res = await (mod as Record<string, (req: NextRequest) => Promise<Response>>)[method](
    new Request("https://noor.test/api/household/sharing", init) as unknown as NextRequest
  );
  return { status: res.status, json: await res.json() };
}

const spies: Array<ReturnType<typeof vi.spyOn>> = [];

function consoleText(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a: unknown) => String(a)).join(" "))
    .join("\n");
}

/** Tables for a caller whose household has exactly one other member. */
function paired(extra: FakeOptions["tables"] = {}): FakeOptions {
  return {
    tables: {
      household_members: [
        { data: { household_id: HOUSEHOLD }, error: null },
        { data: [{ user_id: USER_ID }, { user_id: PARTNER_ID }], error: null },
      ],
      users: [{ data: { first_name: ` ${NAME} ` }, error: null }],
      plaid_connections: [
        {
          data: [
            { id: 11, item_id: ITEM, institution_name: BANK },
            { id: "12", item_id: ITEM_2, institution_name: "Second Bank" },
          ],
          error: null,
        },
      ],
      ...extra,
    },
  };
}

beforeEach(() => {
  state.user = { id: USER_ID, email: "sentinel.user@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" };
  state.fake = makeFakeClient();
  spies.length = 0;
  for (const method of ["error", "warn", "info", "log"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PUT /api/household/sharing", () => {
  it("SH-I1 the rpc gets the verified id, the item id and the setting, and nothing else from the body", async () => {
    state.fake = makeFakeClient({ rpc: { household_share_set: { data: "shared", error: null } } });
    const forged = {
      userId: OTHER_ID,
      user_id: OTHER_ID,
      p_user_id: OTHER_ID,
      ownerUserId: OTHER_ID,
      granteeUserId: OTHER_ID,
      householdId: OTHER_HOUSEHOLD,
      id: 999,
    };
    const r = await send("PUT", { ...forged, itemId: ITEM, shared: true });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ shared: true });
    expect(state.fake.rpcCalls).toEqual([
      ["household_share_set", { p_user_id: USER_ID, p_item_id: ITEM, p_shared: true }],
    ]);
    expect(JSON.stringify(state.fake.rpcCalls)).not.toContain(OTHER_ID);
    expect(JSON.stringify(state.fake.rpcCalls)).not.toContain(OTHER_HOUSEHOLD);
  });

  const ANSWERS: Array<[string, number, Record<string, unknown>]> = [
    ["shared", 200, { shared: true }],
    ["unshared", 200, { shared: false }],
    ["solo", 409, { code: "SHARE_NO_PARTNER" }],
    ["none", 409, { code: "SHARE_NO_PARTNER" }],
    ["no_connection", 404, { code: "SHARE_NO_CONNECTION" }],
    ["refused", 409, { code: "HOUSEHOLD_CHANGED" }],
    ["something_else", 500, { code: "SERVER_ERROR" }],
  ];

  it.each(ANSWERS)("SH-M1 the function's answer %s is %i", async (answer, status, body) => {
    state.fake = makeFakeClient({ rpc: { household_share_set: { data: answer, error: null } } });
    const r = await send("PUT", { itemId: ITEM, shared: answer !== "unshared" });
    expect(r.status).toBe(status);
    expect(r.json).toMatchObject(body);
  });

  it("SH-M1 a failed or thrown call is 500, never a success", async () => {
    for (const rpc of [
      { data: null, error: { code: "P0001", message: "sentinel" } },
      "throw" as const,
      { data: "", error: null },
      { data: 7, error: null },
    ]) {
      state.fake = makeFakeClient({ rpc: { household_share_set: rpc } });
      const r = await send("PUT", { itemId: ITEM, shared: true });
      expect(r.status).toBe(500);
      expect(r.json.code).toBe("SERVER_ERROR");
    }
  });

  it("SH-V1 a body that is not exactly an item id and a boolean is 400, and nothing is called", async () => {
    for (const body of [
      {},
      { itemId: ITEM },
      { shared: true },
      { itemId: ITEM, shared: "true" },
      { itemId: 5, shared: true },
      { itemId: "", shared: true },
      { itemId: ` ${ITEM}`, shared: true },
      { itemId: "x".repeat(201), shared: true },
      [ITEM, true],
      null,
    ]) {
      state.fake = makeFakeClient({ rpc: { household_share_set: { data: "shared", error: null } } });
      const r = await send("PUT", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json.code).toBe("SHARE_INVALID_REQUEST");
      expect(state.fake.rpcCalls).toEqual([]);
    }
    expect(readShareRequest({ itemId: ITEM, shared: false })).toEqual({ itemId: ITEM, shared: false });
  });

  it("SH-V2 a body over the byte limit is 413 and nothing is called", async () => {
    state.fake = makeFakeClient({ rpc: { household_share_set: { data: "shared", error: null } } });
    const r = await send("PUT", { itemId: ITEM, shared: true, pad: "x".repeat(5000) });
    expect(r.status).toBe(413);
    expect(state.fake.rpcCalls).toEqual([]);
  });
});

describe("GET /api/household/sharing", () => {
  it("SH-R1 every read is filtered by the caller's id or by the caller's own household, and nothing is written", async () => {
    state.fake = makeFakeClient(paired());
    const r = await send("GET");
    expect(r.status).toBe(200);
    expect(state.fake.rpcCalls).toEqual([]);
    const byTable = state.fake.queries.map((q) => [
      q.table,
      q.ops.filter(([op]) => op === "eq").map(([, args]) => args),
    ]);
    expect(byTable).toEqual([
      ["household_members", [["user_id", USER_ID], ["status", "active"]]],
      ["household_members", [["household_id", HOUSEHOLD], ["status", "active"]]],
      ["users", [["id", PARTNER_ID]]],
      ["plaid_connections", [["user_id", USER_ID]]],
      ["share_grants", [["owner_user_id", USER_ID]]],
      ["share_prompt_answers", [["owner_user_id", USER_ID]]],
    ]);
    const selects = state.fake.queries.map((q) => q.ops.find(([op]) => op === "select")?.[1][0]);
    expect(selects[2]).toBe("first_name");
    expect(selects[3]).toBe("id, item_id, institution_name");
  });

  it("SH-R2 only grants and answers for the current partner and household count, and no id leaves the server", async () => {
    state.fake = makeFakeClient(
      paired({
        share_grants: [
          {
            data: [
              { resource_id: 11, grantee_user_id: PARTNER_ID, household_id: HOUSEHOLD },
              { resource_id: "12", grantee_user_id: OTHER_ID, household_id: HOUSEHOLD },
              { resource_id: 12, grantee_user_id: PARTNER_ID, household_id: OTHER_HOUSEHOLD },
            ],
            error: null,
          },
        ],
        share_prompt_answers: [
          {
            data: [
              { resource_id: "11", grantee_user_id: PARTNER_ID, household_id: HOUSEHOLD },
              { resource_id: 12, grantee_user_id: OTHER_ID, household_id: HOUSEHOLD },
            ],
            error: null,
          },
        ],
      })
    );
    const r = await send("GET");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      sharing: {
        eligible: true,
        partnerFirstName: NAME,
        connections: [
          { itemId: ITEM, institutionName: BANK, shared: true, answered: true },
          { itemId: ITEM_2, institutionName: "Second Bank", shared: false, answered: false },
        ],
      },
    });
    const text = JSON.stringify(r.json);
    for (const id of [USER_ID, PARTNER_ID, OTHER_ID, HOUSEHOLD, OTHER_HOUSEHOLD, '"id"', "11"]) {
      expect(text, id).not.toContain(id);
    }
  });

  it("SH-R3 with no other member, or more than one, nothing about connections is read", async () => {
    for (const members of [
      [{ user_id: USER_ID }],
      [{ user_id: USER_ID }, { user_id: PARTNER_ID }, { user_id: OTHER_ID }],
    ]) {
      state.fake = makeFakeClient({
        tables: {
          household_members: [
            { data: { household_id: HOUSEHOLD }, error: null },
            { data: members, error: null },
          ],
        },
      });
      const r = await send("GET");
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ sharing: { eligible: false, partnerFirstName: null, connections: [] } });
      expect(state.fake.queries.map((q) => q.table)).toEqual(["household_members", "household_members"]);
    }
    state.fake = makeFakeClient({ tables: { household_members: [{ data: null, error: null }] } });
    const none = await send("GET");
    expect(none.json).toEqual({ sharing: { eligible: false, partnerFirstName: null, connections: [] } });
    expect(state.fake.queries.map((q) => q.table)).toEqual(["household_members"]);
  });

  it("SH-R4 a failed read is 500, never an empty list", async () => {
    for (const table of ["household_members", "users", "plaid_connections", "share_grants", "share_prompt_answers"]) {
      const options = paired();
      const failed = { data: null, error: { code: "XX000", message: "sentinel" } };
      const tables = { ...(options.tables ?? {}) };
      if (table === "household_members") {
        tables.household_members = [failed];
      } else {
        tables[table] = [failed];
      }
      state.fake = makeFakeClient({ tables });
      const r = await send("GET");
      expect(r.status, table).toBe(500);
      expect(r.json.code, table).toBe("SERVER_ERROR");
    }
  });
});

describe("logs", () => {
  it("SH-G1 no console line carries an item id, a bank, a name or an id", async () => {
    state.fake = makeFakeClient({ rpc: { household_share_set: { data: "shared", error: null } } });
    await send("PUT", { itemId: ITEM, shared: true });
    state.fake = makeFakeClient({ rpc: { household_share_set: { data: null, error: { code: "P0001", message: `${USER_ID} ${ITEM}` } } } });
    await send("PUT", { itemId: ITEM, shared: false });
    state.fake = makeFakeClient({ rpc: { household_share_set: { data: "no_connection", error: null } } });
    await send("PUT", { itemId: ITEM, shared: false });
    state.fake = makeFakeClient({ tables: { household_members: [{ data: null, error: { code: "XX000", message: USER_ID } }] } });
    await send("GET");
    const text = consoleText();
    expect(text).toContain("[household] route=sharing-set outcome=shared");
    expect(text).toContain("[household] route=sharing-set outcome=call_failed code=P0001");
    expect(text).toContain("[household] route=sharing-view outcome=read_failed code=XX000");
    for (const secret of [SENTINEL_BEARER, USER_ID, PARTNER_ID, ITEM, BANK, NAME, HOUSEHOLD]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
