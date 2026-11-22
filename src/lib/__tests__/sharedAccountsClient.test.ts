import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadSharedAccounts,
  readSharedAccounts,
  sharedAccountsView,
  type SharedOwner,
} from "../sharedAccountsClient";
import { HOUSEHOLD_UI } from "../householdCopy";
import type { HouseholdHttp } from "../householdClient";
import type { SessionReadResult } from "../supabase-browser";

/**
 * The shared-accounts list's decisions, executed: reading the answer and
 * what the list shows.
 *
 * Mutations and the test each one turns red:
 *   an unreadable connection shown with accounts or amounts           -> C1
 *   an answer out of shape read as an empty list, or partly used       -> C2
 *   an amount the answer does not give shown as zero                   -> C3
 *   an empty list rendered as a list, or as unavailable                -> C4
 */

const READABLE: SharedOwner = {
  firstName: "Alex",
  connections: [
    {
      institutionName: "First Bank",
      readable: true,
      accounts: [
        {
          name: "Everyday Checking",
          mask: "1234",
          type: "depository",
          subtype: "checking",
          currentCents: 152_340,
          availableCents: 150_000,
        },
      ],
    },
  ],
};

function body(owners: unknown): Record<string, unknown> {
  return { sharedAccounts: { owners } };
}

describe("shared accounts list", () => {
  it("C1 an unreadable connection shows the sentence and no account line, never $0.00", () => {
    const owners = readSharedAccounts(
      body([
        {
          firstName: "Alex",
          connections: [
            { institutionName: "First Bank", readable: false, accounts: [] },
            READABLE.connections[0],
          ],
        },
      ])
    );
    expect(owners).not.toBeNull();
    const view = sharedAccountsView(owners);
    expect(view.kind).toBe("list");
    if (view.kind !== "list") return;
    const unreadable = view.owners[0].banks[0];
    expect(unreadable.unreadable).toBe(HOUSEHOLD_UI.sharedAccountsUnreadable);
    expect(unreadable.accounts).toEqual([]);
    expect(JSON.stringify(unreadable)).not.toContain("$0.00");
    expect(view.owners[0].banks[1].unreadable).toBeNull();
    expect(view.owners[0].banks[1].accounts.length).toBe(1);
  });

  it("C1 an unreadable connection that carries accounts is not trusted", () => {
    expect(
      readSharedAccounts(
        body([
          {
            firstName: "Alex",
            connections: [{ ...READABLE.connections[0], readable: false }],
          },
        ])
      )
    ).toBeNull();
  });

  it("C2 an answer out of shape shows the list as unavailable, never empty", () => {
    const account = READABLE.connections[0].accounts[0];
    const bad: unknown[] = [
      {},
      { sharedAccounts: null },
      { sharedAccounts: { owners: "x" } },
      body([{ firstName: 3, connections: [] }]),
      body([{ firstName: "A", connections: [{ institutionName: "B", readable: "yes", accounts: [] }] }]),
      body([{ firstName: "A", connections: [{ institutionName: "B", readable: true, accounts: [{ ...account, currentCents: "152340" }] }] }]),
      body([{ firstName: "A", connections: [{ institutionName: "B", readable: true, accounts: [{ ...account, currentCents: 1.5 }] }] }]),
      body([{ firstName: "A", connections: [{ institutionName: "B", readable: true, accounts: [{ ...account, name: undefined }] }] }]),
    ];
    for (const b of bad) {
      const owners = readSharedAccounts(b as Record<string, unknown>);
      expect(owners, JSON.stringify(b)).toBeNull();
      expect(sharedAccountsView(owners), JSON.stringify(b)).toEqual({
        kind: "unavailable",
        text: HOUSEHOLD_UI.sharedAccountsUnavailable,
      });
    }
  });

  it("C3 an amount the answer does not give shows as a dash, never as zero; a real zero shows as $0.00", () => {
    const view = sharedAccountsView([
      {
        firstName: null,
        connections: [
          {
            institutionName: null,
            readable: true,
            accounts: [
              { name: "Card", mask: null, type: "credit", subtype: null, currentCents: null, availableCents: null },
              { name: "Savings", mask: "9", type: "depository", subtype: "savings", currentCents: 0, availableCents: 0 },
            ],
          },
        ],
      },
    ]);
    if (view.kind !== "list") throw new Error(view.kind);
    const [card, savings] = view.owners[0].banks[0].accounts;
    expect(card.current).toBe("—");
    expect(card.available).toBe(`${HOUSEHOLD_UI.sharedAccountsAvailable} —`);
    expect(card.detail).toBe("Credit");
    expect(savings.current).toBe("$0.00");
    expect(savings.detail).toBe("Savings · ****9");
    expect(view.owners[0].owner).toBe(HOUSEHOLD_UI.sharedAccountsFrom(null));
    expect(view.owners[0].banks[0].bank).toBe(HOUSEHOLD_UI.sharedAccountsUnnamedBank);
  });

  it("C3 a read account shows its name, kind, last four digits and both balances", () => {
    const view = sharedAccountsView([READABLE]);
    if (view.kind !== "list") throw new Error(view.kind);
    expect(view.title).toBe(HOUSEHOLD_UI.sharedAccountsTitle);
    expect(view.owners[0].owner).toBe("From Alex");
    expect(view.owners[0].banks[0].bank).toBe("First Bank");
    expect(view.owners[0].banks[0].accounts[0]).toEqual({
      key: "o0-b0-a0",
      name: "Everyday Checking",
      detail: "Checking · ****1234",
      current: "$1,523.40",
      available: "Available $1,500.00",
    });
  });

  it("C4 nothing shared renders nothing", () => {
    const owners = readSharedAccounts(body([]));
    expect(owners).toEqual([]);
    expect(sharedAccountsView(owners)).toEqual({ kind: "nothing" });
  });
});

describe("loading the shared accounts", () => {
  const SESSION = { status: "session", session: { access_token: "a" } } as unknown as SessionReadResult;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a 2xx answer in shape is read; any other answer, a network failure or a throw is null", async () => {
    const ok: HouseholdHttp = async () => ({ status: 200, json: body([READABLE]) });
    expect(await loadSharedAccounts(async () => SESSION, ok)).toEqual([READABLE]);

    const failed: HouseholdHttp = async () => ({ status: 500, json: { code: "SERVER_ERROR" } });
    expect(await loadSharedAccounts(async () => SESSION, failed)).toBeNull();

    const offline: HouseholdHttp = async () => null;
    expect(await loadSharedAccounts(async () => SESSION, offline)).toBeNull();

    expect(
      await loadSharedAccounts(async () => {
        throw new Error("x");
      }, ok)
    ).toBeNull();
  });

  it("a request past the limit is aborted and answers null", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const slow: HouseholdHttp = (_path, init) => {
      signal = init.signal;
      return new Promise(() => {});
    };
    const pending = loadSharedAccounts(async () => SESSION, slow, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toBeNull();
    expect(signal?.aborted).toBe(true);
  });
});
