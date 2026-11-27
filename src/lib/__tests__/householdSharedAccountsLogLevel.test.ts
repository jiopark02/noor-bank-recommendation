import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { viewSharedAccounts, type SharedAccountsDeps } from "../householdSharedAccounts";

/**
 * Which logger each line of GET /api/household/shared-accounts goes to: the
 * answer's own line goes to `info` when every connection was read and to
 * `log` (the route's warn level) when any was not; every failure line goes to
 * `log`; the line's text is the same either way.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const ROWS = [
  {
    ownerUserId: OWNER,
    connectionId: 7,
    row: { access_token: "v1:x:y:z", item_id: "item-1", institution_name: "Bank" } as never,
  },
];

function deps(over: Partial<SharedAccountsDeps>, warn: string[], info: string[]): SharedAccountsDeps {
  return {
    mode: "on",
    log: (line) => warn.push(line),
    info: (line) => info.push(line),
    store: {
      readSharedConnections: async () => ({ ok: true, value: ROWS }),
      readFirstNames: async () => ({ ok: true, value: { [OWNER]: "Sam" } }),
    },
    readOwner: async (_owner, rows) => ({
      connections: rows.map((r) => ({ itemId: r.item_id, institutionName: r.institution_name, status: "ok" as const })),
      accounts: [],
    }) as never,
    ...over,
  };
}

describe("shared-accounts log levels", () => {
  it("a successful answer writes its one line to info and nothing to warn", async () => {
    const warn: string[] = [];
    const info: string[] = [];
    const result = await viewSharedAccounts(USER, deps({}, warn, info));
    expect(result.status).toBe(200);
    expect(info).toEqual([
      "[household] route=shared-accounts outcome=read owners=1 connections=1 unreadable=0 dropped=0",
    ]);
    expect(warn).toEqual([]);
  });

  it("a failed read of what is shared stays on warn, with nothing on info", async () => {
    const warn: string[] = [];
    const info: string[] = [];
    const result = await viewSharedAccounts(
      USER,
      deps(
        {
          store: {
            readSharedConnections: async () => ({ ok: false, code: "42883" }),
            readFirstNames: async () => ({ ok: true, value: {} }),
          },
        },
        warn,
        info
      )
    );
    expect(result.status).toBe(500);
    expect(warn).toEqual(["[household] route=shared-accounts outcome=read_failed code=42883"]);
    expect(info).toEqual([]);
  });

  it("an owner's failed read stays on warn, and so does the answer's own line, which counts it unreadable", async () => {
    const warn: string[] = [];
    const info: string[] = [];
    const result = await viewSharedAccounts(
      USER,
      deps(
        {
          readOwner: async () => {
            throw new Error("boom");
          },
        },
        warn,
        info
      )
    );
    expect(result.status).toBe(200);
    expect(warn).toEqual([
      "[household] route=shared-accounts outcome=owner_read_failed reason=unknown",
      "[household] route=shared-accounts outcome=read owners=1 connections=1 unreadable=1 dropped=0",
    ]);
    expect(info).toEqual([]);
  });

  it("with no bank read available, every connection is unreadable and the answer's line is the warn line", async () => {
    const warn: string[] = [];
    const info: string[] = [];
    const result = await viewSharedAccounts(USER, deps({ readOwner: null }, warn, info));
    expect(result.status).toBe(200);
    expect(warn).toEqual([
      "[household] route=shared-accounts outcome=read owners=1 connections=1 unreadable=1 dropped=0",
    ]);
    expect(info).toEqual([]);
  });

  it("with every connection read (unreadable=0), the answer's line is the info line", async () => {
    const warn: string[] = [];
    const info: string[] = [];
    await viewSharedAccounts(USER, deps({}, warn, info));
    expect(info).toEqual([
      "[household] route=shared-accounts outcome=read owners=1 connections=1 unreadable=0 dropped=0",
    ]);
    expect(warn).toEqual([]);
  });

  it("without info, the successful line goes to log as before", async () => {
    const warn: string[] = [];
    const result = await viewSharedAccounts(USER, { ...deps({}, warn, []), info: undefined });
    expect(result.status).toBe(200);
    expect(warn).toEqual([
      "[household] route=shared-accounts outcome=read owners=1 connections=1 unreadable=0 dropped=0",
    ]);
  });

  it("the route passes console.info as info and the gate's log as log", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../app/api/household/shared-accounts/route.ts"),
      "utf8"
    );
    expect(src).toContain("info: (line) => console.info(line),");
    expect(src).toMatch(/\n\s+log,\r?\n/);
  });
});
