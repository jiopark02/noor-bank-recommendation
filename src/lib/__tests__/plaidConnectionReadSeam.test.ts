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
 * THIS FILE IS THE FIRST AND ONLY PLACE IN THIS SUITE THAT MOCKS A MODULE.
 * That is deliberate and it is NOT a new standard — do not read it as
 * permission to reach for vi.mock in the next test. Everything else here is
 * built to need no mock, and where a decision was hard to reach, the answer was
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
 * read as [] — through the real function, not a re-implementation of it. It does
 * NOT prove anything about what the routes do with that value (the wiring probe
 * covers the source of that) and it does not touch a real database, so it says
 * nothing about whether the query itself is correct.
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
 * Deliberately not a general PostgREST fake.
 *
 * WHAT IT NOTICES, AND WHAT IT CANNOT
 * An earlier version of this comment said a change to that chain "surfaces here
 * as a TypeError rather than as a silently different result". That is true for
 * exactly one kind of change and false for the rest. Measured against this stub:
 *
 *   SURFACES (TypeError)  calling a method the stub does not define — .limit,
 *                         .maybeSingle, .single, .in, .range, .not.
 *   SILENT                the table name. `from` ignores its argument.
 *   SILENT                the user_id filter — dropped entirely, or handed a
 *                         constant instead of the userId.
 *   SILENT                an added SQL filter, e.g. .eq("status", "active").
 *   SILENT                the sort column or direction.
 *
 * Because `select` and `eq` are `() => builder`, they ignore every argument and
 * can be called any number of times. Nothing below asserts on what was passed.
 *
 * TWO OF THE SILENT ONES ARE NOT COSMETIC — DO NOT READ THIS FILE AS COVERING
 * THEM:
 *
 *   .eq("user_id", userId) is the access-control boundary for this query, not a
 *   convenience. createServerClient prefers the service-role key in production
 *   and therefore bypasses RLS, which makes that filter the first line of
 *   defense rather than a second one. Delete it and this query returns every
 *   user's connection rows — access tokens included — and every assertion below
 *   still passes green.
 *
 *   Filtering by status in SQL is a change the helper's own documentation
 *   forbids: it would drop the non-active rows /api/account/delete needs in
 *   order to revoke their Plaid Items before the rows are destroyed, and it
 *   would re-merge "no rows" with "rows, none active" — the distinction this
 *   whole change exists to keep. That regression also passes green here.
 *
 * Nothing in this suite covers either one. The header's "says nothing about
 * whether the query itself is correct" is the accurate summary; this list is
 * what that sentence actually costs.
 */
function clientResolving(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.order = () => Promise.resolve(result);
  return { from: () => builder };
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

  it("returns null when the query reports an error", async () => {
    createServerClientMock.mockReturnValue(
      clientResolving({
        data: null,
        error: { code: "PGRST301", message: "JWT expired", details: null },
      })
    );

    await expect(getAllPlaidConnections("user_1")).resolves.toBeNull();
  });

  it("returns null when the payload is not an array", async () => {
    // Neither an error nor a list. Nothing is known about this user's rows, and
    // [] would be a claim that they have none.
    createServerClientMock.mockReturnValue(
      clientResolving({ data: null, error: null })
    );

    await expect(getAllPlaidConnections("user_1")).resolves.toBeNull();
  });

  it("returns null when constructing the client throws", async () => {
    // createServerClient throws on missing Supabase env. The whole body is
    // wrapped, so this must come back as a returned null like every other
    // failure — /api/account/delete's outer catch documents that contract and
    // has no other way to be reached.
    createServerClientMock.mockImplementation(() => {
      throw new Error("Supabase URL and anon key are required");
    });

    await expect(getAllPlaidConnections("user_1")).resolves.toBeNull();
  });

  it("returns the rows on a successful read", async () => {
    const rows = [
      { item_id: "item_1", access_token: "tok_1", status: "active" },
      { item_id: "item_2", access_token: "tok_2", status: "error" },
    ];
    createServerClientMock.mockReturnValue(
      clientResolving({ data: rows, error: null })
    );

    await expect(getAllPlaidConnections("user_1")).resolves.toEqual(rows);
  });

  it("returns an empty array for a genuine zero-row read", async () => {
    // The half that makes the null mean something. Collapse this back into null
    // and there is no distinction left to keep; collapse the failures into this
    // and the original defect is back.
    createServerClientMock.mockReturnValue(
      clientResolving({ data: [], error: null })
    );

    await expect(getAllPlaidConnections("user_1")).resolves.toEqual([]);
  });
});
