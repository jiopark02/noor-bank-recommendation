import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * getActivePlaidConnectionByInstitution, executed against a stub client: its
 * three states.
 *
 * Only createServerClient is replaced. The stub answers
 * from().select().eq().eq().eq()[.neq()].limit().maybeSingle() and records each
 * call.
 *
 * Mutations that turn this file red:
 *   - a query error or a throw answered as "no row", or thrown again -> "failed read"
 *   - no row answered as anything but { ok: true, connection: null } -> "no row"
 *   - the found row not returned as `connection`                    -> "row"
 *   - the user_id filter dropped, or excludeItemId ignored           -> "filters"
 */

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

vi.mock("../supabase", () => ({
  createServerClient: createServerClientMock,
}));

import { getActivePlaidConnectionByInstitution } from "../plaidApiUtils";

function clientResolving(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(() => Promise.resolve(result));
  const builder: Record<string, unknown> = { maybeSingle };
  const select = vi.fn(() => builder);
  const eq = vi.fn(() => builder);
  const neq = vi.fn(() => builder);
  const limit = vi.fn(() => builder);
  builder.select = select;
  builder.eq = eq;
  builder.neq = neq;
  builder.limit = limit;
  const from = vi.fn(() => builder);
  return { client: { from }, from, select, eq, neq, limit, maybeSingle };
}

beforeEach(() => {
  createServerClientMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getActivePlaidConnectionByInstitution — three states, never a throw", () => {
  it("reports a query error as a failed read", async () => {
    createServerClientMock.mockReturnValue(
      clientResolving({ data: null, error: { code: "PGRST301" } }).client
    );
    await expect(
      getActivePlaidConnectionByInstitution("user_1", "ins_1")
    ).resolves.toEqual({ ok: false });
  });

  it("reports a throw as a failed read", async () => {
    createServerClientMock.mockImplementation(() => {
      throw new Error("Supabase service role key is required");
    });
    await expect(
      getActivePlaidConnectionByInstitution("user_1", "ins_1")
    ).resolves.toEqual({ ok: false });
  });

  it("reports no row as ok with no connection", async () => {
    createServerClientMock.mockReturnValue(
      clientResolving({ data: null, error: null }).client
    );
    await expect(
      getActivePlaidConnectionByInstitution("user_1", "ins_1")
    ).resolves.toEqual({ ok: true, connection: null });
  });

  it("returns the row it found as the connection", async () => {
    const row = { item_id: "item_1", institution_name: "Old Bank" };
    createServerClientMock.mockReturnValue(
      clientResolving({ data: row, error: null }).client
    );
    await expect(
      getActivePlaidConnectionByInstitution("user_1", "ins_1")
    ).resolves.toEqual({ ok: true, connection: row });
  });

  it("filters by user, institution and active status, and excludes the item only when given", async () => {
    const without = clientResolving({ data: null, error: null });
    createServerClientMock.mockReturnValue(without.client);
    await getActivePlaidConnectionByInstitution("user_7", "ins_1");
    expect(without.eq.mock.calls).toEqual([
      ["user_id", "user_7"],
      ["institution_id", "ins_1"],
      ["status", "active"],
    ]);
    expect(without.neq).not.toHaveBeenCalled();

    const withExclude = clientResolving({ data: null, error: null });
    createServerClientMock.mockReturnValue(withExclude.client);
    await getActivePlaidConnectionByInstitution("user_7", "ins_1", "item_new");
    expect(withExclude.neq.mock.calls).toEqual([["item_id", "item_new"]]);
  });
});
