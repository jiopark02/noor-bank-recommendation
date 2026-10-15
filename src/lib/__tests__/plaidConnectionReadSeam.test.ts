import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The IO SEAM of "a failed connection read is not an empty one".
 *
 * Three things now cover that fix, and they cover different halves:
 *   plaidApiUtils.test.ts             the pure DECISION (connectionRowsOrNull)
 *   plaidConnectionReadWiring.test.ts the SOURCE TEXT of the routes' null branch
 *   this file                         the seam that JOINS them
 *
 * THAT LIST IS NOT A CLOSED LOOP, AND SHOULD NOT BE READ AS ONE. Put together,
 * the three still do not execute a route: no test anywhere calls either handler,
 * so nothing asserts on the response a user actually receives. The claim "a
 * failed read is answered with a generic 500 and never with the empty-case 404"
 * is held up by a text probe reading source and by this file reading a return
 * value — never by a response object. The wiring probe reaches the same
 * conclusion from its own side and says so; this is the same limit stated where
 * the three are listed together, because a list of three green files is exactly
 * where it is easiest to stop asking.
 *
 * The seam had nothing. connectionRowsOrNull was pulled out precisely so the
 * decision could be tested with no database and no mock — and that left
 * getAllPlaidConnections, the only thing that actually calls it, unverified.
 * Measured, before this file existed: appending `?? []` to its return restores
 * the entire original defect — a failed read comes back as an empty array, the
 * routes' null guards never fire, and a database hiccup is answered with the
 * empty-case 404 again — while tsc stayed clean and every test in the suite
 * passed. The declared `| null` return type does not catch it either: returning
 * a narrower type than declared is legal.
 *
 * THIS FILE MOCKS A MODULE, AND THAT IS NOT THE SUITE'S DEFAULT.
 * A few other files in the suite mock modules too; neither this file nor any of
 * them is a standard — do not read them as permission to reach for vi.mock in
 * the next test. Most of the suite is built to need no mock, and where a
 * decision was hard to reach, the answer was
 * to pull the decision out as a pure function rather than to fake its
 * surroundings. That answer is already taken here: the pure part IS
 * connectionRowsOrNull, and it is tested without any of this. What is left is a
 * function whose entire job is to talk to the database and convert what comes
 * back. There is no smaller pure core hiding inside it to extract; the IO is the
 * subject. A mock is the only way to reach it without a live database.
 *
 * Only one thing is deliberately faked: the server-client factory. Not the Plaid
 * SDK, not the auth helper, not the routes. If a later test needs a second thing
 * faked, that is the signal to ask whether the code under it wants restructuring
 * — not to widen this file. Note that "one thing faked" is a statement about
 * intent, not about blast radius: vi.mock replaces a whole MODULE across this
 * file's whole import graph, and the graph here is wider than the one import
 * being aimed at. See the comment on the vi.mock call for what that actually
 * reaches and when it will bite.
 *
 * WHY NOT A DEPENDENCY SEAM IN PRODUCTION CODE
 * The considered alternative was to let getAllPlaidConnections take its client
 * factory as an optional argument, so a stub could be passed in with no mock at
 * all. It is the more robust option and it was NOT chosen: cutting a
 * test-visible seam through production code is the same class of decision that
 * plaidConnectionReadWiring.test.ts already deferred to a separate track when it
 * declined to cut one through the auth boundary. Making that call here, inside a
 * fix about read failures, would be scope this change did not ask for. If that
 * track is ever taken, this file is the first thing that should be deleted in
 * favor of it.
 *
 * WHAT THIS FILE PROVES
 * That getAllPlaidConnections reports a failed read as null and a genuine empty
 * read as [] — through the real function, not a re-implementation of it — and
 * that each null came out of the failure exit it is named for, not out of the
 * catch swallowing a broken stub. It also pins the query's table and filters as
 * the function builds them: one user_id filter carrying the caller's userId, and
 * no other filter. It does NOT prove anything about what the routes do with that
 * value (the wiring probe covers the source of that) and it does not touch a real
 * database, so it says nothing about what PostgREST or RLS would do with the
 * query it is handed.
 */

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

// This does NOT replace one function. vi.mock replaces the whole module, for
// every importer in this test file's graph, and an earlier version of this
// comment claimed otherwise ("replaces that and nothing more"). What the graph
// actually contains:
//
//   this file -> ../plaidApiUtils
//                  -> ./supabase                  (createServerClient)
//                  -> ./apiAuth
//                       -> @/lib/supabase         (createServerClient,
//                                                  createAdminClient,
//                                                  isSupabaseConfigured)
//
// `./supabase`, `../supabase` and `@/lib/supabase` are the same file — vitest
// resolves the `@` alias to ./src (vitest.config.ts) and keys mocks by resolved
// path, not by the specifier string. The proof is that this mock works at all:
// plaidApiUtils writes `./supabase` while the line below writes `../supabase`.
//
// So apiAuth is handed this factory's object too, and it is missing two of the
// exports apiAuth imports. It does not blow up TODAY because apiAuth only
// touches them inside function bodies that nothing here calls; vitest raises
// "No <name> export is defined on the mock" on property ACCESS, not on import.
// It WILL blow up the first time a test in this file reaches any code path that
// authenticates — or if apiAuth ever moves one of those calls to module scope.
// If that happens, the fix is to add the missing exports to this factory (or to
// stop pulling authenticated code into this file), not to widen what is faked.
vi.mock("../supabase", () => ({
  createServerClient: createServerClientMock,
}));

// Imported after the mock is registered (vi.mock is hoisted above it anyway).
import { getAllPlaidConnections } from "../plaidApiUtils";

/**
 * The smallest client that satisfies the call under test:
 *
 *   supabase.from(...).select(...).eq(...).order(...)  ->  { data, error }
 *
 * Deliberately not a general PostgREST fake. Every method is a spy, so the
 * tests can assert on what was passed and on whether the chain was walked to
 * its end.
 *
 * WHAT IT NOTICES, AND WHAT IT CANNOT
 *
 *   SURFACES (TypeError)  calling a method the stub does not define — .limit,
 *                         .maybeSingle, .single, .in, .neq, .range, .not. The
 *                         catch turns that into null, so it shows up as the
 *                         success tests returning null, and as the failure
 *                         tests logging a TypeError instead of the failure
 *                         they set up.
 *   SURFACES              the table name — `from` is asserted on.
 *   SURFACES              the user_id filter — dropped entirely, or handed a
 *                         constant instead of the userId.
 *   SURFACES              an added .eq filter, e.g. .eq("status", "active") —
 *                         eq is asserted to be called exactly once.
 *   SILENT                the select list and the sort column or direction.
 *   SILENT                anything about the statement PostgREST would actually
 *                         receive, or what RLS would do with it.
 *
 * Two of the SURFACES lines are not cosmetic:
 *
 *   .eq("user_id", userId) is the access-control boundary for this query, not a
 *   convenience. createServerClient runs as service-role — it requires that key
 *   and therefore bypasses RLS, which makes that filter the first line of
 *   defense rather than a second one. Delete it and this query returns every
 *   user's connection rows, access tokens included.
 *
 *   Filtering by status in SQL is a change the helper's own documentation
 *   forbids: it would drop the non-active rows /api/account/delete needs in
 *   order to revoke their Plaid Items before the rows are destroyed, and it
 *   would re-merge "no rows" with "rows, none active" — the distinction this
 *   whole change exists to keep.
 *
 * "scopes the read to the owning user and filters on nothing else" below is the
 * assertion that catches both. Before it existed, both mutations passed green.
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

/**
 * Every console.error call made during the test, as argument lists. The helper
 * logs on each failure exit, and WHICH exit logged is what tells a genuine
 * failure apart from a broken stub: a stub missing a method throws a TypeError,
 * the catch logs that TypeError and returns null, and a test asserting only on
 * the null would pass for the wrong reason.
 */
function errorLogCalls(): unknown[][] {
  return (console.error as unknown as { mock: { calls: unknown[][] } }).mock
    .calls;
}

describe("getAllPlaidConnections — the seam between the read and the decision", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    // The helper logs every failure path; keep the run readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when the query reports an error, and logs that error", async () => {
    // The null alone does not show which exit produced it: a stub missing a
    // method also ends in a null, through the catch. Two checks pin it to the
    // query-error exit: the chain was walked to its end (order ran), and the
    // object logged is the query's own error, not a TypeError from the catch.
    // The second also guards the log itself — without it, a failed read leaves
    // only the caller's generic message as a trace.
    const queryError = {
      code: "PGRST301",
      message: "JWT expired",
      details: null,
    };
    const stub = clientResolving({ data: null, error: queryError });
    createServerClientMock.mockReturnValue(stub.client);

    await expect(getAllPlaidConnections("user_1")).resolves.toBeNull();

    expect(stub.order).toHaveBeenCalledTimes(1);
    expect(errorLogCalls().some((args) => args.includes(queryError))).toBe(
      true
    );
  });

  it("returns null when the payload is not an array, and logs the shape", async () => {
    // Neither an error nor a list. Nothing is known about this user's rows, and
    // [] would be a claim that they have none.
    //
    // As above, the null is pinned to its exit: the chain completed, and the
    // log line is the shape branch's, which is the only trace this failure
    // leaves. Only the branch is identified, not the full wording.
    const stub = clientResolving({ data: null, error: null });
    createServerClientMock.mockReturnValue(stub.client);

    await expect(getAllPlaidConnections("user_1")).resolves.toBeNull();

    expect(stub.order).toHaveBeenCalledTimes(1);
    expect(
      errorLogCalls().some(
        (args) =>
          typeof args[0] === "string" &&
          args[0].indexOf("unexpected payload shape") !== -1
      )
    ).toBe(true);
  });

  it("returns null when constructing the client throws, and logs the throw", async () => {
    // createServerClient throws on missing Supabase env. The whole body is
    // wrapped, so this must come back as a returned null like every other
    // failure — /api/account/delete's outer catch documents that contract and
    // has no other way to be reached. The logged object must be the thrown one,
    // so this null is known to have come from the catch.
    const thrown = new Error("Supabase URL and anon key are required");
    createServerClientMock.mockImplementation(() => {
      throw thrown;
    });

    await expect(getAllPlaidConnections("user_1")).resolves.toBeNull();

    expect(errorLogCalls().some((args) => args.includes(thrown))).toBe(true);
  });

  it("scopes the read to the owning user and filters on nothing else", async () => {
    // The user_id filter is the access-control boundary here (service-role
    // client, RLS bypassed): dropping it, or passing anything but the caller's
    // userId, would return other users' rows and their tokens. And a second
    // filter — a status filter is the plausible one — would hide the inactive
    // rows /api/account/delete must revoke before deleting, and would make
    // "rows, none active" read as "no rows". eq must be called exactly once,
    // with exactly these arguments.
    const stub = clientResolving({ data: [], error: null });
    createServerClientMock.mockReturnValue(stub.client);

    await expect(getAllPlaidConnections("user_scope_7")).resolves.toEqual([]);

    expect(stub.from).toHaveBeenCalledTimes(1);
    expect(stub.from).toHaveBeenCalledWith("plaid_connections");
    expect(stub.eq.mock.calls).toEqual([["user_id", "user_scope_7"]]);
  });

  it("returns the rows on a successful read", async () => {
    // NOTE (PL1): these access_token values are NOT a valid stored shape. Since
    // PL1 the column holds `v1:<iv>:<authTag>:<ciphertext>` and the database
    // enforces it with a CHECK constraint. They stay as opaque strings here
    // because getAllPlaidConnections neither decrypts nor inspects the field —
    // it hands rows back verbatim, and the callers decrypt. Do not copy this
    // shape into a test that exercises decryption; see plaidTokenCrypto.test.ts
    // for real values.
    const rows = [
      { item_id: "item_1", access_token: "tok_1", status: "active" },
      { item_id: "item_2", access_token: "tok_2", status: "error" },
    ];
    createServerClientMock.mockReturnValue(
      clientResolving({ data: rows, error: null }).client
    );

    await expect(getAllPlaidConnections("user_1")).resolves.toEqual(rows);
  });

  it("returns an empty array for a genuine zero-row read", async () => {
    // The half that makes the null mean something. Collapse this back into null
    // and there is no distinction left to keep; collapse the failures into this
    // and the original defect is back.
    createServerClientMock.mockReturnValue(
      clientResolving({ data: [], error: null }).client
    );

    await expect(getAllPlaidConnections("user_1")).resolves.toEqual([]);
  });
});
