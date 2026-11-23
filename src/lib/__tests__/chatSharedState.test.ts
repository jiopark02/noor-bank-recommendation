import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedAccountsStore, SharedConnection, StoreRead } from "../householdSharedAccounts";

/**
 * listSharedForChat and readSharedForChat, executed: what the chat reads of
 * the bank connections other household members share with the user. The
 * store is a fake answering in place of the shared-connections function and
 * the first-name read; readBankData and liveAdapterDeps run for real, with a
 * fake Plaid client and a fake decrypt that succeeds only with the id a token
 * was stored under, as the real one does.
 *
 * Mutations and the test each one turns red:
 *   a read made with the user's id instead of the owner's, or two owners'
 *     rows passed to one read                                          -> T8
 *   the second call of the function not used to drop connections       -> T9
 *   the first call's rows used when the second call fails              -> T10
 *   transactions, recurring streams or the Item read asked for         -> T11
 *   a failed owner read not caught, or its connections dropped         -> owner
 *   the read's own time limit removed, or its timer not aborting the
 *     bank calls, or another limit used by default                     -> N18
 *   the function called again after the reads were cancelled, by the
 *     limit or by the caller                                           -> N18
 *   a name, bank, account, amount or id put in a log line              -> logs
 */

const USER_ID = "sentinel-user-id-11";
const OWNER_A = "sentinel-owner-a-id-22";
const OWNER_B = "sentinel-owner-b-id-33";
const BANK_A = "Sentinelbank Alpha";
const BANK_B = "Sentinelbank Beta";
const NAME_A = "Sentinelalice";
const ACCOUNT_NAME = "Sentinel Everyday Checking";

type Conn = { owner: string; id: number; item: string; bank: string };
const A1: Conn = { owner: OWNER_A, id: 7001, item: "sentinel-item-a1", bank: BANK_A };
const A2: Conn = { owner: OWNER_A, id: 7002, item: "sentinel-item-a2", bank: BANK_A };
const B1: Conn = { owner: OWNER_B, id: 7003, item: "sentinel-item-b1", bank: BANK_B };

function shared(c: Conn): SharedConnection {
  return {
    ownerUserId: c.owner,
    connectionId: c.id,
    row: {
      access_token: `sentinel-cipher|${c.owner}|${c.item}`,
      item_id: c.item,
      institution_name: c.bank,
    },
  };
}

const state = {
  plaidConfigured: true,
  cryptoConfigured: true,
  /** One answer per call of readSharedConnections; the last one repeats. */
  rows: [] as Array<StoreRead<SharedConnection[]>>,
  rowCalls: [] as string[],
  names: { ok: true, value: {} } as StoreRead<Record<string, string | null>>,
  nameCalls: [] as string[][],
  readCalls: [] as Array<{ userId: string; items: string[]; want: unknown; opts: unknown }>,
  decryptCalls: [] as Array<{ userId: string }>,
  accountsGetCalls: 0,
  loginRequired: new Set<string>(),
  /** Items whose accounts read answers only when its signal is aborted. */
  hang: new Set<string>(),
  /** Whether each hanging read saw its signal aborted. */
  hangAborted: [] as boolean[],
  logs: [] as string[],
};

const store: SharedAccountsStore = {
  async readSharedConnections(userId) {
    state.rowCalls.push(userId);
    return state.rows[Math.min(state.rowCalls.length - 1, state.rows.length - 1)];
  },
  async readFirstNames(userIds) {
    state.nameCalls.push(userIds);
    return state.names;
  },
};

const deps = { store, log: (line: string) => state.logs.push(line) };

vi.mock("@/lib/supabase", () => ({
  createServerClient: () => {
    throw new Error("the user's own connection read must not be made here");
  },
  createAdminClient: () => {
    throw new Error("the live store must not be built when a store is given");
  },
  isSupabaseConfigured: () => true,
  isSupabaseAdminConfigured: () => true,
}));

vi.mock("@/lib/plaidTokenCrypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("../plaidTokenCrypto")>();
  return {
    ...real,
    isPlaidTokenCryptoConfigured: () => state.cryptoConfigured,
    decryptPlaidAccessToken: (stored: string, userId: string) => {
      state.decryptCalls.push({ userId });
      const [prefix, owner, item] = stored.split("|");
      if (prefix !== "sentinel-cipher" || owner !== userId) {
        throw new real.PlaidTokenCryptoError("auth_failed", "sentinel-decrypt-failure-text");
      }
      return `sentinel-plain|${item}`;
    },
  };
});

vi.mock("@/lib/plaid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plaid")>()),
  isPlaidConfigured: () => state.plaidConfigured,
  plaidClient: {
    async accountsGet(request: { access_token: string }, options?: { signal?: AbortSignal }) {
      state.accountsGetCalls += 1;
      const item = request.access_token.split("|")[1];
      if (state.hang.has(item)) {
        const signal = options?.signal;
        await new Promise<void>((resolve) => {
          if (!signal) return;
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve());
        });
        state.hangAborted.push(signal?.aborted === true);
        throw Object.assign(new Error("sentinel-aborted"), { name: "AbortError" });
      }
      if (state.loginRequired.has(item)) {
        throw Object.assign(new Error("sentinel-plaid-error-text"), {
          response: { status: 400, data: { error_code: "ITEM_LOGIN_REQUIRED" } },
        });
      }
      return {
        data: {
          accounts: [
            {
              account_id: `sentinel-account-${item}`,
              name: ACCOUNT_NAME,
              official_name: null,
              mask: "8642",
              type: "depository",
              subtype: "checking",
              balances: { current: 4321.57, available: 4310.09, limit: null, iso_currency_code: "USD" },
            },
          ],
        },
      };
    },
    async itemGet() {
      throw new Error("itemGet must not be called");
    },
    async transactionsGet() {
      throw new Error("transactionsGet must not be called");
    },
    async transactionsRecurringGet() {
      throw new Error("transactionsRecurringGet must not be called");
    },
  },
}));

vi.mock("@/lib/plaidEngineAdapter", async (importOriginal) => {
  const real = await importOriginal<typeof import("../plaidEngineAdapter")>();
  return {
    ...real,
    readBankData: (...args: Parameters<typeof real.readBankData>) => {
      state.readCalls.push({
        userId: args[0],
        items: args[1].map((r) => r.item_id),
        want: args[2],
        opts: { itemStatus: args[5]?.itemStatus, logOrigin: args[5]?.logOrigin },
      });
      return real.readBankData(...args);
    },
  };
});

import {
  listSharedForChat,
  readSharedForChat,
  SharedChatReadError,
} from "../plaidChatState";

beforeEach(() => {
  state.plaidConfigured = true;
  state.cryptoConfigured = true;
  state.rows = [];
  state.rowCalls = [];
  state.names = { ok: true, value: { [OWNER_A]: NAME_A } };
  state.nameCalls = [];
  state.readCalls = [];
  state.decryptCalls = [];
  state.accountsGetCalls = 0;
  state.loginRequired = new Set();
  state.hang = new Set();
  state.hangAborted = [];
  state.logs = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

async function listAndRead() {
  const list = await listSharedForChat(USER_ID, deps);
  return { list, read: await readSharedForChat(USER_ID, list, {}, deps) };
}

describe("listSharedForChat", () => {
  it("asks for the user's id only, and reads names of the owners it found", async () => {
    state.rows = [{ ok: true, value: [shared(A1), shared(B1)] }];
    const list = await listSharedForChat(USER_ID, deps);
    expect(state.rowCalls).toEqual([USER_ID]);
    expect(state.nameCalls).toEqual([[OWNER_A, OWNER_B]]);
    expect(list.firstNames).toEqual({ [OWNER_A]: NAME_A, [OWNER_B]: null });
    expect(state.accountsGetCalls).toBe(0);
  });

  it("reads no name when nothing is shared", async () => {
    state.rows = [{ ok: true, value: [] }];
    expect(await listSharedForChat(USER_ID, deps)).toEqual({ connections: [], firstNames: {} });
    expect(state.nameCalls).toEqual([]);
  });

  it("throws when the function fails, and leaves names null when only the name read fails", async () => {
    state.rows = [{ ok: false, code: "42501" }];
    await expect(listSharedForChat(USER_ID, deps)).rejects.toBeInstanceOf(SharedChatReadError);

    state.rows = [{ ok: true, value: [shared(A1)] }];
    state.names = { ok: false, code: "PGRST301" };
    const list = await listSharedForChat(USER_ID, deps);
    expect(list.firstNames).toEqual({ [OWNER_A]: null });
    expect(state.logs).toEqual(["[chat-shared] outcome=names_failed code=PGRST301"]);
  });
});

describe("readSharedForChat", () => {
  it("T8 reads each owner's rows in a separate read, with that owner's id", async () => {
    state.rows = [{ ok: true, value: [shared(A1), shared(A2), shared(B1)] }];
    const { read } = await listAndRead();
    expect(state.readCalls.map((c) => [c.userId, c.items])).toEqual([
      [OWNER_A, [A1.item, A2.item]],
      [OWNER_B, [B1.item]],
    ]);
    expect(state.decryptCalls.every((c) => c.userId !== USER_ID)).toBe(true);
    expect(read.state.owners.map((o) => o.firstName)).toEqual([NAME_A, null]);
    expect(read.state.owners[0].connections).toEqual([
      { institution: BANK_A, status: "active", read: "read" },
      { institution: BANK_A, status: "active", read: "read" },
    ]);
    expect(read.state.owners[0].accounts).toHaveLength(2);
    expect(read.state.owners[0].accounts[0]).toMatchObject({
      label: ACCOUNT_NAME,
      balanceStatus: "known",
      current: 4321.57,
      currency: "USD",
    });
    expect(read.sources).toEqual([
      { ownerUserId: OWNER_A, connectionId: A1.id },
      { ownerUserId: OWNER_A, connectionId: A2.id },
      { ownerUserId: OWNER_B, connectionId: B1.id },
    ]);
  });

  it("T9 keeps only connections the second call still returns", async () => {
    state.rows = [
      { ok: true, value: [shared(A1), shared(B1)] },
      { ok: true, value: [shared(A1)] },
    ];
    const { read } = await listAndRead();
    expect(state.rowCalls).toEqual([USER_ID, USER_ID]);
    expect(read.state.owners).toHaveLength(1);
    expect(read.state.owners[0].connections.map((c) => c.institution)).toEqual([BANK_A]);
    expect(read.sources).toEqual([{ ownerUserId: OWNER_A, connectionId: A1.id }]);
    expect(JSON.stringify(read)).not.toContain(BANK_B);
  });

  it("T9 drops one connection of an owner and keeps that owner's other accounts only", async () => {
    state.rows = [
      { ok: true, value: [shared(A1), shared(A2)] },
      { ok: true, value: [shared(A2)] },
    ];
    const { read } = await listAndRead();
    expect(read.state.owners[0].accounts).toHaveLength(1);
    expect(read.sources).toEqual([{ ownerUserId: OWNER_A, connectionId: A2.id }]);
  });

  it("T10 throws when the second call fails, so nothing read is used", async () => {
    state.rows = [
      { ok: true, value: [shared(A1)] },
      { ok: false, code: "57014" },
    ];
    const list = await listSharedForChat(USER_ID, deps);
    const error = await readSharedForChat(USER_ID, list, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SharedChatReadError);
    expect((error as SharedChatReadError).stage).toBe("recheck");
    expect((error as SharedChatReadError).code).toBe("57014");
  });

  it("T11 reads accounts only: no transactions, no recurring streams, no Item read", async () => {
    state.rows = [{ ok: true, value: [shared(A1), shared(B1)] }];
    const { read } = await listAndRead();
    for (const call of state.readCalls) {
      expect(call.want).toEqual({ accounts: true, transactions: false, recurring: false });
      expect(call.opts).toEqual({ itemStatus: false, logOrigin: "chat-shared" });
    }
    expect(state.accountsGetCalls).toBe(2);
    expect(read.state.owners.every((o) => o.connections.every((c) => c.read === "read"))).toBe(true);
  });

  it("an owner whose read fails keeps their connections, not read and without accounts, as sources", async () => {
    // A token stored under another id fails to decrypt; with every row of
    // that owner failing, the adapter throws for the owner.
    const broken: SharedConnection = {
      ...shared(B1),
      row: { ...shared(B1).row, access_token: `sentinel-cipher|${USER_ID}|${B1.item}` },
    };
    state.rows = [{ ok: true, value: [shared(A1), broken] }];
    const { read } = await listAndRead();
    expect(read.state.owners[1]).toEqual({
      firstName: null,
      connections: [{ institution: BANK_B, status: "active", read: "not_read" }],
      accounts: [],
    });
    expect(read.sources).toContainEqual({ ownerUserId: OWNER_B, connectionId: B1.id });
    expect(state.logs).toEqual(["[chat-shared] outcome=owner_read_failed reason=auth_failed"]);
  });

  it("a bank that asks for a new login is marked so, with no account", async () => {
    state.rows = [{ ok: true, value: [shared(A1), shared(A2)] }];
    state.loginRequired.add(A2.item);
    const { read } = await listAndRead();
    expect(read.state.owners[0].connections.map((c) => c.read)).toEqual(["read", "needs_reconnect"]);
    expect(read.state.owners[0].accounts).toHaveLength(1);
  });

  it("without Plaid or the token key configured, reads nothing and marks every connection not read", async () => {
    for (const [plaid, crypto] of [
      [false, true],
      [true, false],
    ]) {
      state.plaidConfigured = plaid;
      state.cryptoConfigured = crypto;
      state.readCalls = [];
      state.rowCalls = [];
      state.rows = [{ ok: true, value: [shared(A1)] }];
      const { read } = await listAndRead();
      expect(state.readCalls).toEqual([]);
      expect(read.state.owners[0].connections[0].read).toBe("not_read");
      expect(read.sources).toEqual([{ ownerUserId: OWNER_A, connectionId: A1.id }]);
    }
  });

  it("N18 a read that outlasts its limit is cancelled and answers a timeout, not the request's deadline", async () => {
    state.rows = [{ ok: true, value: [shared(A1)] }];
    state.hang.add(A1.item);
    const list = await listSharedForChat(USER_ID, deps);
    const error = await readSharedForChat(USER_ID, list, { timeoutMs: 20 }, deps).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(SharedChatReadError);
    expect((error as SharedChatReadError).stage).toBe("timeout");
    // The bank call saw its signal aborted.
    await vi.waitFor(() => expect(state.hangAborted).toEqual([true]));
    // The work reached the point of the second call and skipped it: the line
    // is written there and nothing follows it, so no call can come later.
    await vi.waitFor(() =>
      expect(state.logs).toContain("[chat-shared] outcome=recheck_skipped reason=cancelled")
    );
    expect(state.rowCalls).toEqual([USER_ID]);
  });

  it("N18 a read the caller cancels makes no second call and ends as cancelled", async () => {
    state.rows = [{ ok: true, value: [shared(A1)] }];
    state.hang.add(A1.item);
    const list = await listSharedForChat(USER_ID, deps);
    const caller = new AbortController();
    const pending = readSharedForChat(
      USER_ID,
      list,
      { signal: caller.signal, timeoutMs: 60_000 },
      deps
    ).catch((e: unknown) => e);
    await vi.waitFor(() => expect(state.accountsGetCalls).toBe(1));
    caller.abort();
    const error = await pending;
    expect(error).toBeInstanceOf(SharedChatReadError);
    expect((error as SharedChatReadError).stage).toBe("cancelled");
    expect(state.hangAborted).toEqual([true]);
    expect(state.logs).toContain("[chat-shared] outcome=recheck_skipped reason=cancelled");
    expect(state.rowCalls).toEqual([USER_ID]);
  });

  it("N18 the default limit is the household card's limit for the same read", async () => {
    const { SHARED_ACCOUNTS_READ_TIMEOUT_MS } = await import("../householdSharedAccounts");
    vi.useFakeTimers();
    try {
      state.rows = [{ ok: true, value: [shared(A1)] }];
      state.hang.add(A1.item);
      const list = await listSharedForChat(USER_ID, deps);
      const pending = readSharedForChat(USER_ID, list, {}, deps).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(SHARED_ACCOUNTS_READ_TIMEOUT_MS - 1);
      expect(state.hangAborted).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;
      expect((error as SharedChatReadError).stage).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("log lines carry no name, bank, account, amount or id", async () => {
    state.rows = [{ ok: true, value: [shared(A1)] }];
    state.names = { ok: false, code: "PGRST301" };
    await listAndRead();
    const text = state.logs.join("\n");
    for (const fragment of [USER_ID, OWNER_A, NAME_A, BANK_A, ACCOUNT_NAME, "4321", A1.item, String(A1.id)]) {
      expect(text).not.toContain(fragment);
    }
  });
});
