import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What saveMessages and findSavedTurn send to the database, and how
 * saveMessages tells a closed session from every other failure.
 *
 * - saveMessages reads the session by id AND user id, and refuses a closed one
 *   (ended_at set) with SessionClosedError before sending any row.
 * - With ids, the two rows carry them; without, the rows carry no id.
 * - An insert the database refuses with PG_CHAT_SESSION_CLOSED is the same
 *   SessionClosedError. No other refusal is.
 * - findSavedTurn asks by the two ids AND the user id, and answers a session
 *   id only when both rows are there.
 * - assertSessionBelongsToUser, which other callers use, still checks
 *   ownership only: a closed session of the user's passes.
 *
 * Only the admin client is faked: a builder that records every method it is
 * called with and resolves to a scripted result.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * Anything about the database itself: that it refuses an insert into a closed
 * session, or which code it does so with.
 */

type Op = [string, unknown[]];
interface Query {
  table: string;
  ops: Op[];
}
type DbResult = { data: unknown; error: unknown };

const db = {
  session: { data: null, error: null } as DbResult,
  insert: { data: null, error: null } as DbResult,
  lookup: { data: null, error: null } as DbResult,
  queries: [] as Query[],
};

vi.mock("../supabase", () => ({
  isSupabaseAdminConfigured: () => true,
  createAdminClient: () => ({
    from(table: string) {
      const query: Query = { table, ops: [] };
      db.queries.push(query);
      const builder: unknown = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              const result =
                table === "chat_sessions"
                  ? db.session
                  : query.ops.some((op) => op[0] === "insert")
                    ? db.insert
                    : db.lookup;
              return (
                onFulfilled: (value: unknown) => unknown,
                onRejected: (reason: unknown) => unknown
              ) => Promise.resolve(result).then(onFulfilled, onRejected);
            }
            return (...args: unknown[]) => {
              query.ops.push([String(prop), args]);
              return builder;
            };
          },
        }
      );
      return builder;
    },
  }),
}));

import {
  PG_CHAT_SESSION_CLOSED,
  SessionClosedError,
  assertSessionBelongsToUser,
  findSavedTurn,
  isSessionClosedError,
  saveMessages,
} from "../aiMemory";

const USER = "00000000-0000-4000-8000-000000000001";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDS = {
  user: "11111111-1111-4111-8111-111111111111",
  assistant: "22222222-2222-4222-8222-222222222222",
};
const PAIR = { userContent: "question", assistantContent: "answer", assistantModel: "m" };

function savedRows(sessionId = SESSION) {
  return [
    { id: IDS.user, session_id: sessionId, user_id: USER, role: "user", content: "question" },
    { id: IDS.assistant, session_id: sessionId, user_id: USER, role: "assistant", content: "answer" },
  ];
}

function queriesOn(table: string): Query[] {
  return db.queries.filter((q) => q.table === table);
}

function op(query: Query, name: string): unknown[][] {
  return query.ops.filter((o) => o[0] === name).map((o) => o[1]);
}

beforeEach(() => {
  db.session = { data: { id: SESSION, ended_at: null }, error: null };
  db.insert = { data: savedRows(), error: null };
  db.lookup = { data: [], error: null };
  db.queries = [];
});

describe("saveMessages — the session read", () => {
  it("reads the session by its id and the caller's user id", async () => {
    await saveMessages(SESSION, USER, PAIR, { ids: IDS });
    const [read] = queriesOn("chat_sessions");
    expect(op(read, "select")).toEqual([["id, ended_at"]]);
    expect(op(read, "eq")).toEqual([
      ["id", SESSION],
      ["user_id", USER],
    ]);
  });

  it("refuses a closed session with SessionClosedError and sends no row", async () => {
    db.session = { data: { id: SESSION, ended_at: "2026-11-10T10:00:00.000Z" }, error: null };
    const error = await saveMessages(SESSION, USER, PAIR, { ids: IDS }).catch((e) => e);
    expect(error).toBeInstanceOf(SessionClosedError);
    expect(isSessionClosedError(error)).toBe(true);
    expect(queriesOn("chat_messages")).toEqual([]);
  });

  it("a session that is not the user's is an ownership failure, not a closed session", async () => {
    db.session = { data: null, error: null };
    const error = await saveMessages(SESSION, USER, PAIR, { ids: IDS }).catch((e) => e);
    expect(isSessionClosedError(error)).toBe(false);
    expect((error as Error).message).toContain("does not belong to user");
    expect(queriesOn("chat_messages")).toEqual([]);
  });

  it("a failed read is not a closed session either, and sends no row", async () => {
    db.session = { data: null, error: { message: "read failed", code: "08006" } };
    const error = await saveMessages(SESSION, USER, PAIR, { ids: IDS }).catch((e) => e);
    expect(isSessionClosedError(error)).toBe(false);
    expect(queriesOn("chat_messages")).toEqual([]);
  });
});

describe("saveMessages — the rows", () => {
  function insertedRows(): Array<Record<string, unknown>> {
    const [insert] = queriesOn("chat_messages");
    return op(insert, "insert")[0][0] as Array<Record<string, unknown>>;
  }

  it("carry the given ids, the session and the caller's user id", async () => {
    await saveMessages(SESSION, USER, PAIR, { ids: IDS });
    const rows = insertedRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.id, r.role, r.session_id, r.user_id])).toEqual([
      [IDS.user, "user", SESSION, USER],
      [IDS.assistant, "assistant", SESSION, USER],
    ]);
  });

  it("carry no id when none is given, so the database chooses", async () => {
    await saveMessages(SESSION, USER, PAIR);
    for (const row of insertedRows()) expect("id" in row).toBe(false);
  });

  it("are sent in one insert", async () => {
    await saveMessages(SESSION, USER, PAIR, { ids: IDS });
    expect(queriesOn("chat_messages")).toHaveLength(1);
  });
});

describe("saveMessages — a refused insert", () => {
  it("the closed-session code is SessionClosedError", async () => {
    db.insert = {
      data: null,
      error: { message: "chat_messages: session is closed or missing", code: PG_CHAT_SESSION_CLOSED },
    };
    const error = await saveMessages(SESSION, USER, PAIR, { ids: IDS }).catch((e) => e);
    expect(error).toBeInstanceOf(SessionClosedError);
  });

  it("that code is NR001", () => {
    expect(PG_CHAT_SESSION_CLOSED).toBe("NR001");
  });

  it.each([
    ["a duplicate id", "23505"],
    ["a missing session row", "23503"],
    ["a connection failure", "08006"],
    ["an error with no code", undefined],
    ["a cancelled request", ""],
  ])("%s is not a closed session, and keeps the database error as its cause", async (_label, code) => {
    const dbError = { message: "insert refused", code };
    db.insert = { data: null, error: dbError };
    const error = await saveMessages(SESSION, USER, PAIR, { ids: IDS }).catch((e) => e);
    expect(isSessionClosedError(error)).toBe(false);
    expect((error as Error).message).toContain("Failed to save messages");
    expect((error as Error).cause).toBe(dbError);
  });

  it("SessionClosedError says nothing about which session or user", () => {
    const message = new SessionClosedError().message;
    expect(message).not.toContain(SESSION);
    expect(message).not.toContain(USER);
  });
});

describe("saveMessages — the optional signal", () => {
  it("is handed to the session read and to the insert", async () => {
    const { signal } = new AbortController();
    await saveMessages(SESSION, USER, PAIR, { ids: IDS, signal });
    expect(op(queriesOn("chat_sessions")[0], "abortSignal")).toEqual([[signal]]);
    expect(op(queriesOn("chat_messages")[0], "abortSignal")).toEqual([[signal]]);
  });

  it("without one, neither query is given a signal", async () => {
    await saveMessages(SESSION, USER, PAIR, { ids: IDS });
    expect(op(queriesOn("chat_sessions")[0], "abortSignal")).toEqual([]);
    expect(op(queriesOn("chat_messages")[0], "abortSignal")).toEqual([]);
  });
});

describe("assertSessionBelongsToUser — ownership only", () => {
  it("passes for a closed session that is the user's", async () => {
    db.session = { data: { id: SESSION, ended_at: "2026-11-10T10:00:00.000Z" }, error: null };
    await expect(assertSessionBelongsToUser(SESSION, USER)).resolves.toBeUndefined();
  });

  it("throws for a session that is not the user's", async () => {
    db.session = { data: null, error: null };
    await expect(assertSessionBelongsToUser(SESSION, USER)).rejects.toThrow(
      `Session ${SESSION} does not belong to user ${USER} or does not exist`
    );
  });

  it("throws when the read fails", async () => {
    db.session = { data: null, error: { message: "read failed" } };
    await expect(assertSessionBelongsToUser(SESSION, USER)).rejects.toThrow(
      "Failed to verify session ownership: read failed"
    );
  });
});

describe("findSavedTurn", () => {
  it("asks for the two ids and the caller's user id, and nothing wider", async () => {
    await findSavedTurn(USER, IDS);
    const [lookup] = queriesOn("chat_messages");
    expect(op(lookup, "eq")).toEqual([["user_id", USER]]);
    expect(op(lookup, "in")).toEqual([["id", [IDS.user, IDS.assistant]]]);
    expect(op(lookup, "insert")).toEqual([]);
  });

  it("both rows in one session: that session's id", async () => {
    db.lookup = { data: savedRows(), error: null };
    expect(await findSavedTurn(USER, IDS)).toBe(SESSION);
  });

  it.each([
    ["no row", []],
    ["the user row only", savedRows().slice(0, 1)],
    ["the assistant row only", savedRows().slice(1)],
    ["two rows with other ids", [
      { id: "33333333-3333-4333-8333-333333333333", session_id: SESSION },
      { id: "44444444-4444-4444-8444-444444444444", session_id: SESSION },
    ]],
    ["the two rows in different sessions", [
      { id: IDS.user, session_id: SESSION },
      { id: IDS.assistant, session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    ]],
    ["no data at all", null],
  ])("%s: null", async (_label, data) => {
    db.lookup = { data, error: null };
    expect(await findSavedTurn(USER, IDS)).toBeNull();
  });

  it("throws when the lookup fails, so a failure is never read as 'not stored'", async () => {
    db.lookup = { data: null, error: { message: "lookup failed" } };
    await expect(findSavedTurn(USER, IDS)).rejects.toThrow("Failed to look up saved messages");
  });

  it("hands its signal to the query, and none when not given one", async () => {
    const { signal } = new AbortController();
    await findSavedTurn(USER, IDS, { signal });
    await findSavedTurn(USER, IDS);
    const [withSignal, without] = queriesOn("chat_messages");
    expect(op(withSignal, "abortSignal")).toEqual([[signal]]);
    expect(op(without, "abortSignal")).toEqual([]);
  });
});
