import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * What the plaid_connections helpers write to the log when a query fails or
 * throws: the error's code, and never the error.
 *
 * A database error's message, details and hint can echo the row or the key it
 * refused on, and a plaid_connections row carries a stored token. Handing the
 * error object to console.error prints all of it. These tests run the real
 * helpers against a failing client and read what console.error was given.
 *
 * Only the server-client factory is faked, as in plaidConnectionReadSeam.test.ts
 * and plaidConnectionDeleteSeam.test.ts, and for the reason those files give:
 * the IO is the subject.
 *
 * Mutations that turn this file red, per helper:
 *   - the error object passed to console.error again        -> "query error" / "throw"
 *   - the error's message interpolated into the line        -> "query error" / "throw"
 *   - the code read directly instead of through the shape
 *     check                                                 -> "unexpected shape"
 *   - the log line removed                                  -> "query error" / "throw"
 */

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

vi.mock("../supabase", () => ({
  createServerClient: createServerClientMock,
}));

import {
  deletePlaidConnection,
  getPlaidConnectionByItemId,
  getPlaidConnectionsByItemIdAcrossUsers,
} from "../plaidApiUtils";

const SENTINEL = "SENTINEL_never_in_a_log_5e20bd";

/** A PostgREST-shaped error whose every free-text field carries the sentinel. */
function queryError(code: unknown): Record<string, unknown> {
  return {
    code,
    message: `message ${SENTINEL}`,
    details: `Failing row contains (${SENTINEL})`,
    hint: `hint ${SENTINEL}`,
  };
}

/**
 * A client whose every chain ends in `result`, whatever methods are called on
 * the way. Each method returns the same builder and the builder is awaitable,
 * so one stub serves the three chains under test:
 *
 *   from().select().eq().eq().maybeSingle()
 *   from().select().eq().limit()
 *   from().delete().eq().eq().select()
 *
 * It notices nothing about the query; the seam files pin that.
 */
function clientResolving(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.delete = chain;
  builder.eq = chain;
  builder.limit = chain;
  builder.maybeSingle = chain;
  builder.then = (
    onFulfilled: (value: { data: unknown; error: unknown }) => unknown
  ) => Promise.resolve(result).then(onFulfilled);
  return { from: () => builder };
}

function errorLogCalls(): unknown[][] {
  return (console.error as unknown as { mock: { calls: unknown[][] } }).mock
    .calls;
}

/**
 * Every console.error argument must be a string (so no error object, and no
 * object that could carry one), and none may contain the sentinel.
 */
function expectOnlyVettedStrings(): string {
  const calls = errorLogCalls();
  expect(calls.length).toBeGreaterThan(0);
  const lines: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    for (let j = 0; j < calls[i].length; j++) {
      expect(typeof calls[i][j]).toBe("string");
    }
    lines.push(calls[i].join(" "));
  }
  const text = lines.join("\n");
  expect(text).not.toContain(SENTINEL);
  return text;
}

type Helper = {
  name: string;
  run: () => Promise<unknown>;
  failure: unknown;
};

const HELPERS: Helper[] = [
  {
    name: "getPlaidConnectionByItemId",
    run: () => getPlaidConnectionByItemId("user_1", "item_1"),
    failure: { ok: false },
  },
  {
    name: "getPlaidConnectionsByItemIdAcrossUsers",
    run: () => getPlaidConnectionsByItemIdAcrossUsers("item_1"),
    failure: { ok: false },
  },
];

describe("plaid_connections helpers — a failure logs the code, never the error", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (let h = 0; h < HELPERS.length; h++) {
    const helper = HELPERS[h];

    it(`${helper.name}: a query error logs its code and nothing else from it`, async () => {
      createServerClientMock.mockReturnValue(
        clientResolving({ data: null, error: queryError("42501") })
      );

      await expect(helper.run()).resolves.toEqual(helper.failure);

      const text = expectOnlyVettedStrings();
      expect(text).toContain("code 42501");
    });

    it(`${helper.name}: a code of an unexpected shape is not echoed`, async () => {
      createServerClientMock.mockReturnValue(
        clientResolving({
          data: null,
          error: queryError(`42501\nforged=${SENTINEL}`),
        })
      );

      await expect(helper.run()).resolves.toEqual(helper.failure);

      const text = expectOnlyVettedStrings();
      expect(text).toContain("code invalid");
    });

    it(`${helper.name}: a query error with no code says so`, async () => {
      createServerClientMock.mockReturnValue(
        clientResolving({ data: null, error: queryError(undefined) })
      );

      await expect(helper.run()).resolves.toEqual(helper.failure);

      const text = expectOnlyVettedStrings();
      expect(text).toContain("code none");
    });

    it(`${helper.name}: a throw logs no part of the thrown error`, async () => {
      createServerClientMock.mockImplementation(() => {
        throw new Error(`thrown ${SENTINEL}`);
      });

      await expect(helper.run()).resolves.toEqual(helper.failure);

      const text = expectOnlyVettedStrings();
      expect(text).toContain("threw");
    });
  }

  it("deletePlaidConnection: a query error logs its code and nothing else from it", async () => {
    createServerClientMock.mockReturnValue(
      clientResolving({ data: null, error: queryError("42501") })
    );

    await expect(deletePlaidConnection("user_1", "item_1")).resolves.toEqual({
      ok: false,
      dbErrorCode: "42501",
    });

    const text = expectOnlyVettedStrings();
    expect(text).toContain("code 42501");
  });

  it("deletePlaidConnection: a code of an unexpected shape is not echoed", async () => {
    createServerClientMock.mockReturnValue(
      clientResolving({
        data: null,
        error: queryError(`42501\nforged=${SENTINEL}`),
      })
    );

    await expect(deletePlaidConnection("user_1", "item_1")).resolves.toEqual({
      ok: false,
      dbErrorCode: "invalid",
    });

    const text = expectOnlyVettedStrings();
    expect(text).toContain("code invalid");
  });

  it("deletePlaidConnection: a throw logs the thrown error's code and no other part of it", async () => {
    createServerClientMock.mockImplementation(() => {
      const thrown = new Error(`thrown ${SENTINEL}`) as Error & { code?: string };
      thrown.code = "ECONNRESET";
      throw thrown;
    });

    await expect(deletePlaidConnection("user_1", "item_1")).resolves.toEqual({
      ok: false,
      dbErrorCode: "ECONNRESET",
    });

    const text = expectOnlyVettedStrings();
    expect(text).toContain("threw, code ECONNRESET");
  });

  it("deletePlaidConnection: a throw with no code says so", async () => {
    createServerClientMock.mockImplementation(() => {
      throw new Error(`thrown ${SENTINEL}`);
    });

    await expect(deletePlaidConnection("user_1", "item_1")).resolves.toEqual({
      ok: false,
      dbErrorCode: null,
    });

    const text = expectOnlyVettedStrings();
    expect(text).toContain("threw, code none");
  });
});
