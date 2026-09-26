import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The IO SEAM of "a plaid_connections delete reports how many rows it removed".
 *
 * WHAT THIS FIXES, AND WHY A BOOLEAN COULD NOT
 * deletePlaidConnection used to destructure `{ error }` only and return a
 * boolean. PostgREST reports neither an error nor a count for a delete that
 * matched ZERO rows, so "the row was removed" and "nothing matched the filter"
 * came back as the same `true` — and plaidRevocation.ts promoted that `true`
 * into `ok: true`, which is the number /api/account/delete's gate is computed
 * from. The fix is `.select("id")`: asking for a representation makes PostgREST
 * return the deleted rows, so `data.length` IS the count. That is the same
 * construction /api/account/delete already used for the public.users row — one
 * route, two deletes, only one of them counting.
 *
 * WHY THIS FILE EXISTS AT ALL, GIVEN THE FUNCTION IS NOT PURE
 * The count cannot be checked by a pure function. Whether `.select("id")` is
 * actually on the chain is a property of the QUERY, invisible to anything that
 * receives `{ data, error }` already built — and removing that one call is the
 * regression this file is for. There is no smaller pure core hiding inside
 * either: the function's whole body is one query plus three lines interpreting
 * what came back.
 *
 * ⚠️ THIS IS THE SECOND PLACE IN THIS SUITE THAT MOCKS A MODULE, AND
 * plaidConnectionReadSeam.test.ts EXPLICITLY SAID NOT TO READ IT AS PERMISSION.
 * The exception is claimed on the same grounds that file claims it — "the IO is
 * the subject" — and on nothing else. The alternative it named was cutting a
 * client-factory seam through production code (`deletePlaidConnection(userId,
 * itemId, makeClient = createServerClient)`), which is the more robust option
 * and was declined there as a separate track; deciding it here, inside a change
 * about revocation convergence, would be scope this change did not ask for. If
 * that track is ever taken, this file and its read-side twin should both be
 * deleted in favor of it.
 *
 * Only the server-client factory is faked. Not the Plaid SDK, not the auth
 * helper, not any route. See the comment on the vi.mock call for what replacing
 * that module actually reaches.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT
 * That the real deletePlaidConnection turns a representation into a count, a
 * query error into a code, and a thrown factory into a failure, and that it
 * scopes the statement to one table and to both halves of the row's identity. It
 * does NOT touch a database, so it says nothing about whether the statement the
 * server receives is well-formed, or about what the live RLS policies would do
 * with it.
 */

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

// This does NOT replace one function. vi.mock replaces the whole module for
// every importer in this file's graph:
//
//   this file -> ../plaidApiUtils
//                  -> ./supabase                  (createServerClient)
//                  -> ./apiAuth
//                       -> @/lib/supabase         (createServerClient,
//                                                  createAdminClient,
//                                                  isSupabaseConfigured)
//
// `./supabase` and `@/lib/supabase` resolve to the same file (vitest resolves
// the `@` alias to ./src and keys mocks by resolved path), so apiAuth is handed
// this factory's object too, and it is missing two of the exports apiAuth
// imports. That does not blow up today because apiAuth only touches them inside
// function bodies nothing here calls — vitest raises "No <name> export is
// defined on the mock" on property ACCESS, not on import. It WILL blow up the
// first time a test here reaches code that authenticates. The fix then is to add
// the missing exports to this factory, not to widen what is faked.
vi.mock("../supabase", () => ({
  createServerClient: createServerClientMock,
}));

// Imported after the mock is registered (vi.mock is hoisted above it anyway).
import { deletePlaidConnection } from "../plaidApiUtils";

/**
 * The smallest client that satisfies the call under test:
 *
 *   supabase.from(...).delete().eq(...).eq(...).select(...)  ->  { data, error }
 *
 * The terminal step is `select`, which is the whole point — remove
 * `.select("id")` from the production chain and the await lands on this builder
 * object instead of a promise, so `data` and `error` both come back undefined
 * and the count is silently 0 forever.
 *
 * `from` and `eq` are spies rather than bare arrows, so the arguments are
 * recorded and can be asserted on. They still return the builder regardless of
 * what they are handed, so the chain is never broken by a wrong argument — the
 * assertions are what notice it.
 *
 * WHAT IT NOTICES, AND WHAT IT CANNOT (measured against this stub):
 *
 *   SURFACES (TypeError)  calling a method the stub does not define.
 *   SURFACES              dropping `.select(...)` — the count collapses to 0.
 *   SURFACES              the table name — recorded and asserted.
 *   SURFACES              the user_id filter — dropped, or handed a constant
 *                         instead of the userId.
 *   SURFACES              the item_id filter, likewise.
 *   SURFACES              a third filter — eq is asserted exactly twice, and any
 *                         other filter method is not on the stub (TypeError).
 *   SILENT                the ORDER of the two filters — deliberately, PostgREST
 *                         conjoins them.
 *   SILENT                anything about the statement PostgREST would actually
 *                         receive, or what RLS would do with it.
 *
 * THE user_id FILTER IS THE ACCESS-CONTROL BOUNDARY FOR THIS QUERY, not a
 * convenience — createServerClient prefers the service-role key in production
 * and therefore bypasses RLS, so this filter is the first line of defense rather
 * than a second one. Delete it and this statement removes EVERY user's row with
 * a matching item_id. "scopes the statement to one table and to the owning user"
 * below is the assertion that catches that; before it existed, that mutation
 * passed green here.
 */
function clientDeleting(result: { data: unknown; error: unknown }) {
  const select = vi.fn(() => Promise.resolve(result));
  const builder: Record<string, unknown> = { select };
  const eq = vi.fn(() => builder);
  builder.delete = () => builder;
  builder.eq = eq;
  const from = vi.fn(() => builder);
  return { client: { from }, from, eq, select };
}

describe("deletePlaidConnection — the delete reports its row count", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    // The function logs every failure path; keep the run readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the number of rows the delete removed", async () => {
    const { client } = clientDeleting({ data: [{ id: "row_1" }], error: null });
    createServerClientMock.mockReturnValue(client);

    await expect(deletePlaidConnection("user_1", "item_1")).resolves.toEqual({
      ok: true,
      deleted: 1,
    });
  });

  it("reports zero when the filter matched nothing", async () => {
    // The case the boolean could not express. It is still success — absence is
    // the target state — but the caller now decides that with the number, and
    // the number reaches the log.
    const { client } = clientDeleting({ data: [], error: null });
    createServerClientMock.mockReturnValue(client);

    await expect(deletePlaidConnection("user_1", "item_1")).resolves.toEqual({
      ok: true,
      deleted: 0,
    });
  });

  it("reports zero rather than crashing when no representation came back", async () => {
    // `data: null` with no error is not a shape PostgREST produces for a delete
    // that asked for a representation. Reading `data.length` off it would throw
    // inside the try and be reported as a database failure, which is a worse
    // answer than the honest 0.
    const { client } = clientDeleting({ data: null, error: null });
    createServerClientMock.mockReturnValue(client);

    await expect(deletePlaidConnection("user_1", "item_1")).resolves.toEqual({
      ok: true,
      deleted: 0,
    });
  });

  it("asks for a representation, or the count is always zero", async () => {
    // The mutation this file exists for: drop `.select("id")` and every other
    // assertion here starts reporting deleted: 0 with ok: true — a delete that
    // removed the row, reported as one that matched nothing. Asserting on the
    // call itself names the cause instead of the symptom.
    const { client, select } = clientDeleting({
      data: [{ id: "row_1" }],
      error: null,
    });
    createServerClientMock.mockReturnValue(client);

    await deletePlaidConnection("user_1", "item_1");

    expect(select).toHaveBeenCalledWith("id");
  });

  it("scopes the statement to one table and to the owning user", async () => {
    // WHY THIS IS HERE AND NOT FILED UNDER TIDINESS. This function issues a
    // DELETE through createServerClient, which prefers the service-role key in
    // production and therefore bypasses RLS. `.eq("user_id", userId)` is
    // consequently the access-control boundary for the statement, not a
    // convenience filter: without it the statement removes every user's row
    // carrying this item_id, and the userId argument — the one value here that
    // comes from a verified token — stops being load-bearing. `.eq("item_id",
    // itemId)` is the other half of the row's identity; without it, one
    // disconnect removes all of the caller's connections.
    //
    // Both are invisible to tsc (two string arguments) and to every other
    // assertion in this file, because the stub's `eq` returns the builder no
    // matter what it is handed. Order is not asserted — PostgREST conjoins the
    // filters and the two are interchangeable.
    const { client, from, eq } = clientDeleting({
      data: [{ id: "row_1" }],
      error: null,
    });
    createServerClientMock.mockReturnValue(client);

    await deletePlaidConnection("user_1", "item_1");

    expect(from).toHaveBeenCalledWith("plaid_connections");
    expect(eq).toHaveBeenCalledTimes(2);
    expect(eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["user_id", "user_1"],
        ["item_id", "item_1"],
      ])
    );
  });

  it("reports the PostgREST error code on a query error", async () => {
    const { client } = clientDeleting({
      data: null,
      error: {
        code: "42501",
        message: "new row violates row-level security policy",
        details: "Failing row contains (…)",
        hint: "check the policy",
      },
    });
    createServerClientMock.mockReturnValue(client);

    await expect(deletePlaidConnection("user_1", "item_1")).resolves.toEqual({
      ok: false,
      dbErrorCode: "42501",
    });
  });

  it("carries the code and nothing else out of the error", async () => {
    // The code is a symbolic constant; message, details and hint can all echo a
    // value, and this result is interpolated into a log line one frame up. The
    // allow-list is "the code", implemented as a single named read rather than
    // as a redaction of the rest.
    const { client } = clientDeleting({
      data: null,
      error: {
        code: "42501",
        message: "SENTINEL_MESSAGE_never_logged",
        details: "SENTINEL_DETAILS_never_logged",
        hint: "SENTINEL_HINT_never_logged",
      },
    });
    createServerClientMock.mockReturnValue(client);

    const result = await deletePlaidConnection("user_1", "item_1");
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("SENTINEL_MESSAGE");
    expect(serialized).not.toContain("SENTINEL_DETAILS");
    expect(serialized).not.toContain("SENTINEL_HINT");
  });

  it("reports a null code when the error carries none", async () => {
    const { client } = clientDeleting({
      data: null,
      error: { message: "boom" },
    });
    createServerClientMock.mockReturnValue(client);

    await expect(deletePlaidConnection("user_1", "item_1")).resolves.toEqual({
      ok: false,
      dbErrorCode: null,
    });
  });

  it("reports a failure when constructing the client throws", async () => {
    // createServerClient throws on missing Supabase env. The whole body is
    // wrapped, so this must come back as a returned failure like any other — a
    // throw escaping here would reach revokeAndDeleteConnection, which has no
    // try around the delete and would lose the per-connection outcome entirely.
    createServerClientMock.mockImplementation(() => {
      throw new Error("Supabase URL and anon key are required");
    });

    await expect(deletePlaidConnection("user_1", "item_1")).resolves.toEqual({
      ok: false,
      dbErrorCode: null,
    });
  });

  it("caps and trims a code that is not the symbolic string it should be", async () => {
    // postgrestErrorCode is total and bounded by construction. The catch path
    // receives an arbitrary thrown value, not a PostgREST error, so `code` is
    // whatever that value carries — a node error's "ENOENT", or something that
    // has no business occupying a log line.
    const longCode = `  ${"C".repeat(80)}  `;
    createServerClientMock.mockImplementation(() => {
      const error = new Error("thrown") as Error & { code?: string };
      error.code = longCode;
      throw error;
    });

    const result = await deletePlaidConnection("user_1", "item_1");

    expect(result).toEqual({ ok: false, dbErrorCode: "C".repeat(32) });
  });
});
