import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeCashFlow, ENGINE_VERSION } from "@sungwon0162/cf-engine";
import {
  bankWindow,
  readBankData,
  runCashFlowEngine,
  toPackageInput,
  type EngineInputDates,
  type PlaidReadCalls,
  type StoredConnectionRow,
} from "../plaidEngineAdapter";
import {
  creditUsedCents,
  parseFinanceSummaryResponse,
  recurringDateLine,
  safeToSpendHiddenReason,
  SCREEN_SUMMARY_FIELDS,
  spendableCashTile,
  type BankView,
  type FieldSpec,
} from "../bankSummaryView";

/**
 * Adapter -> engine package -> response summary, executed with the real
 * package over a fake Plaid client.
 *
 * Mutations that turn this file red:
 *   - the engine's answer, or any part of it, sent without being picked
 *     down to the screen fields                                    -> "only the screen fields"
 *   - credit utilization computed over every account the adapter
 *     read, or over the copy the engine left out                   -> "copies"
 *   - the adapter keeping a later copy of an account id            -> "copies"
 *   - the installed engine being another version than the one
 *     package.json pins                                            -> "installed"
 *   - the cushion the screens name read from anything but the
 *     amount the figure was computed with                          -> "cushion"
 *   - a recurring item's payment field left out of the screen
 *     fields, so it never reaches the screens                      -> "payment"
 *   - the reason the engine gives when no bank reported a recurring
 *     charge explained as any other reason, or the cash tile going
 *     blank in that case                                           -> "all empty"
 *   - the cash total sent with any other reason                    -> "cash total"
 *
 * With every bank's recurring read empty the engine now holds safe-to-spend
 * back itself, so this file cannot tell the app's own decision for that case
 * from the engine's. financeSummaryRoute.test.ts holds the app's decision
 * apart, with an engine answer that does not make it.
 */

const TODAY = "2026-11-11";
const DATES: EngineInputDates = {
  nowIso: "2026-11-11T12:00:00.000Z",
  today: TODAY,
  dateBasis: "user_time_zone",
  readWindow: bankWindow(TODAY, 397),
  period: bankWindow(TODAY, 90),
};
const FRESH = "2026-11-11T10:00:00Z";

type Acct = Record<string, unknown>;
type Script = {
  accounts: Acct[];
  transactions?: Acct[];
  outflow?: Acct[];
  inflow?: Acct[];
  lastUpdate?: string | null;
  /** The recurring call fails. */
  recurringFails?: boolean;
};

function account(id: string, over: Acct = {}, balances: Acct = {}): Acct {
  return {
    account_id: id,
    name: "Checking",
    official_name: null,
    mask: "1111",
    type: "depository",
    subtype: "checking",
    balances: {
      current: 1000,
      available: 950,
      limit: null,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
      last_updated_datetime: null,
      ...balances,
    },
    ...over,
  };
}

function card(id: string, owed: number, asOf: string | null): Acct {
  return account(
    id,
    { name: "Card", mask: "9999", type: "credit", subtype: "credit card" },
    { current: owed, available: null, limit: 2000, last_updated_datetime: asOf }
  );
}

function txn(id: string, accountId: string, amount: number, date: string, pfc: [string, string]): Acct {
  return {
    transaction_id: id,
    account_id: accountId,
    amount,
    iso_currency_code: "USD",
    date,
    pending: false,
    name: id,
    merchant_name: null,
    logo_url: null,
    category: [],
    personal_finance_category: { primary: pfc[0], detailed: pfc[1], version: "v2" },
  };
}

function stream(id: string, accountId: string, amount: number, over: Acct = {}): Acct {
  return {
    stream_id: id,
    account_id: accountId,
    description: id,
    merchant_name: id,
    last_date: "2026-10-20",
    predicted_next_date: "2026-11-20",
    frequency: "MONTHLY",
    transaction_ids: [],
    average_amount: { amount, iso_currency_code: "USD", unofficial_currency_code: null },
    last_amount: { amount, iso_currency_code: "USD", unofficial_currency_code: null },
    is_active: true,
    status: "MATURE",
    personal_finance_category: { primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_TV_AND_MOVIES" },
    ...over,
  };
}

/** A year of history on one account: pay every two weeks, groceries every week. */
function history(accountId: string, prefix: string): Acct[] {
  const out: Acct[] = [];
  const end = Date.UTC(2026, 10, 11);
  for (let d = 0; d < 390; d += 7) {
    const date = new Date(end - d * 86400000).toISOString().slice(0, 10);
    out.push(txn(`${prefix}-food-${d}`, accountId, 60, date, ["FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"]));
    if (d % 14 === 0) {
      out.push(txn(`${prefix}-pay-${d}`, accountId, -1500, date, ["INCOME", "INCOME_WAGES"]));
    }
  }
  return out;
}

function fakePlaid(scripts: Record<string, Script>): PlaidReadCalls {
  const of = (token: string) => scripts[token];
  return {
    itemGet: async (req) => ({
      data: {
        item: {} as never,
        status: {
          transactions: {
            last_successful_update: of(req.access_token).lastUpdate ?? FRESH,
            last_failed_update: null,
          },
        },
        request_id: "r",
      },
    }),
    accountsGet: async (req) =>
      ({ data: { accounts: of(req.access_token).accounts, item: {}, request_id: "r" } }) as never,
    transactionsGet: async (req) => {
      const list = of(req.access_token).transactions ?? [];
      return {
        data: { accounts: [], transactions: list, total_transactions: list.length, item: {}, request_id: "r" },
      } as never;
    },
    transactionsRecurringGet: async (req) => {
      if (of(req.access_token).recurringFails) throw new Error("recurring read failed");
      return {
        data: {
          outflow_streams: of(req.access_token).outflow ?? [],
          inflow_streams: of(req.access_token).inflow ?? [],
          updated_datetime: FRESH,
          request_id: "r",
        },
      } as never;
    },
  };
}

function row(n: number, institution = "Bank"): StoredConnectionRow {
  return { access_token: `CIPHER_${n}`, item_id: `item-${n}`, institution_name: institution };
}

async function readWith(scripts: Script[], institutions?: string[]) {
  const byToken: Record<string, Script> = {};
  scripts.forEach((s, i) => (byToken[`TOKEN_${i}`] = s));
  return readBankData(
    "user-1",
    scripts.map((_, i) => row(i, institutions ? institutions[i] : "Bank")),
    { accounts: true, transactions: true, recurring: true },
    DATES.readWindow,
    { plaid: fakePlaid(byToken), decrypt: (s) => s.replace("CIPHER_", "TOKEN_") }
  );
}

/** Paths in `value` that the field list does not name, at any depth. */
function unlistedPaths(spec: FieldSpec, value: unknown, at = "summary"): string[] {
  if (typeof spec === "string" || (spec as { oneOf?: unknown }).oneOf !== undefined) return [];
  const node = spec as { listOf?: FieldSpec; orNull?: FieldSpec };
  if (node.listOf !== undefined) {
    return Array.isArray(value)
      ? value.flatMap((v, i) => unlistedPaths(node.listOf as FieldSpec, v, `${at}[${i}]`))
      : [];
  }
  if (node.orNull !== undefined) return value === null ? [] : unlistedPaths(node.orNull, value, at);
  if (value === null || typeof value !== "object") return [];
  const fields = spec as Record<string, FieldSpec>;
  const out: string[] = [];
  for (const key of Object.keys(value as object)) {
    if (!(key in fields)) out.push(`${at}.${key}`);
    else out.push(...unlistedPaths(fields[key], (value as Record<string, unknown>)[key], `${at}.${key}`));
  }
  return out;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("adapter -> engine package -> summary", () => {
  const oneBank = (): Script[] => [
    {
      accounts: [account("chk"), card("card", 300, null)],
      transactions: history("chk", "a"),
      outflow: [stream("netflix", "chk", 15.49)],
      inflow: [
        stream("payroll", "chk", -1500, {
          frequency: "BIWEEKLY",
          predicted_next_date: "2026-11-20",
          personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" },
        }),
      ],
    },
  ];

  it("the summary holds only the screen fields, and the screens accept it", async () => {
    const read = await readWith(oneBank());
    const summary = runCashFlowEngine(read, DATES);
    const answer = analyzeCashFlow(toPackageInput(read, DATES), {}) as unknown as Record<string, unknown>;
    // The engine does send more than the screens read; none of it is passed on.
    expect(typeof answer.inputHash).toBe("string");
    expect(unlistedPaths(SCREEN_SUMMARY_FIELDS, summary)).toEqual([]);
    expect(JSON.stringify(summary)).not.toContain(answer.inputHash as string);
    const body = { success: true, connections: [], accounts: [], summary };
    expect(parseFinanceSummaryResponse(JSON.parse(JSON.stringify(body)))).not.toBeNull();
    // The figures are the engine's own.
    const engineSafe = answer.safeToSpend as Record<string, unknown>;
    expect(summary.safeToSpend.status).toBe(engineSafe.status);
    expect(summary.safeToSpend.amountCents).toBe(engineSafe.amountCents);
    expect(summary.cashFlow.incomeCents).toBe((answer.cashFlow as Record<string, unknown>).incomeCents);
  });

  // "installed". Red if: node_modules holds another version than package.json
  // pins, so these tests would run against an engine that is not the one
  // deployed.
  it("the installed engine is the version package.json pins", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8")
    ) as { dependencies: Record<string, string> };
    expect(ENGINE_VERSION).toBe(pkg.dependencies["@sungwon0162/cf-engine"]);
  });

  // "cushion". Red if: the amount the screens name comes from a field that
  // does not follow the cushion the figure was computed with.
  it("the cushion the screens read is the one the figure was computed with", async () => {
    const read = await readWith(oneBank());
    const summary = runCashFlowEngine(read, DATES);
    type Safe = {
      status: string;
      amountCents: number;
      inputs: { cushionFloor: { cents: number } };
      policy: { cushionFloorDefaultCents: number };
    };
    const safeOf = (profile: Record<string, unknown>) =>
      (analyzeCashFlow(toPackageInput(read, DATES), profile as never) as unknown as { safeToSpend: Safe })
        .safeToSpend;
    const engineSafe = safeOf({});
    expect(summary.safeToSpend.status).toBe("computed");
    expect(engineSafe.status).toBe("computed");
    // The app passes no cushion of its own, so the engine's default is kept.
    expect(summary.safeToSpend.totals?.cushionFloorCents).toBe(75000);
    expect(summary.safeToSpend.totals?.cushionFloorCents).toBe(engineSafe.inputs.cushionFloor.cents);
    expect(summary.safeToSpend.amountCents).toBe(engineSafe.amountCents);

    // The field follows the cushion in use, where the policy's default does
    // not: with another cushion the figure moves by the difference.
    const other = safeOf({ cushionFloorCents: { value: 30000, source: "user", asOf: null } });
    const otherTotals = (other as unknown as { totals: { cushionFloorCents: number } }).totals;
    expect(otherTotals.cushionFloorCents).toBe(30000);
    expect(other.policy.cushionFloorDefaultCents).toBe(75000);
    expect(other.amountCents - engineSafe.amountCents).toBe(45000);
  });
});

/*
 * "payment". What is known about a payment since a passed expected date
 * reaches the screens as the engine said it.
 */
describe("a recurring charge whose expected date has passed", () => {
  const withCharge = (pending: boolean): Script[] => [
    {
      accounts: [account("chk")],
      transactions: [
        ...history("chk", "a"),
        {
          ...txn("gym-nov", "chk", 40, "2026-11-06", ["PERSONAL_CARE", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS"]),
          pending,
        },
      ],
      outflow: [
        stream("gym", "chk", 40, {
          last_date: "2026-10-05",
          predicted_next_date: "2026-11-05",
          transaction_ids: ["gym-nov"],
          personal_finance_category: {
            primary: "PERSONAL_CARE",
            detailed: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
          },
        }),
      ],
      inflow: [
        stream("payroll", "chk", -1500, {
          frequency: "BIWEEKLY",
          predicted_next_date: "2026-11-20",
          personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" },
        }),
      ],
    },
  ];

  it("a pending transaction since then reaches the screens as pending, and draws the pending label", async () => {
    const read = await readWith(withCharge(true));
    const answer = analyzeCashFlow(toPackageInput(read, DATES), {}) as unknown as {
      recurring: { items: Array<{ streamId: string; paymentSincePredicted: string | null }> };
    };
    const summary = runCashFlowEngine(read, DATES);
    expect(summary.recurring.items.map((i) => i.streamId)).toEqual(["gym"]);
    expect(answer.recurring.items[0].paymentSincePredicted).toBe("pending");
    expect(summary.recurring.items[0].paymentSincePredicted).toBe("pending");
    expect(summary.recurring.items[0].pastDue).toBe(true);
    expect(recurringDateLine(summary.recurring.items[0])).toBe("pending");
  });

  it("the screens carry whatever the engine says for a posted one", async () => {
    const read = await readWith(withCharge(false));
    const answer = analyzeCashFlow(toPackageInput(read, DATES), {}) as unknown as {
      recurring: { items: Array<{ paymentSincePredicted: string | null }> };
    };
    const summary = runCashFlowEngine(read, DATES);
    const said = answer.recurring.items[0].paymentSincePredicted;
    expect(["counted", "unconfirmed"]).toContain(said);
    expect(summary.recurring.items[0].paymentSincePredicted).toBe(said);
    expect(recurringDateLine(summary.recurring.items[0])).toBe(said === "counted" ? "none" : "date");
  });
});

describe("account copies: the adapter's first copy and the engine's choice together", () => {
  it("a card linked through two banks is counted once, as the copy the engine kept", async () => {
    const read = await readWith([
      // The same account id on both connections: the adapter keeps the first.
      { accounts: [account("chk"), card("card-old", 300, "2026-11-10T08:00:00Z")], transactions: history("chk", "a") },
      {
        accounts: [account("chk"), card("card-new", 500, "2026-11-11T08:00:00Z")],
        transactions: history("chk-other", "b"),
      },
    ]);
    expect(read.accounts.map((a) => a.accountId)).toEqual(["chk", "card-old", "card-new"]);
    // The two cards look alike (same bank, type, subtype, mask and name).
    expect(read.accounts[1].duplicateKey).toBe(read.accounts[2].duplicateKey);

    const answer = analyzeCashFlow(toPackageInput(read, DATES), {}) as unknown as {
      dataIssues: Array<{ reason: string; accountKey?: string }>;
    };
    const collapsed = answer.dataIssues
      .filter((d) => d.reason === "duplicate_account_collapsed")
      .map((d) => d.accountKey);
    // The engine keeps the copy whose balance was measured last.
    expect(collapsed).toEqual(["card-old"]);

    const summary = runCashFlowEngine(read, DATES);
    expect(summary.creditUtilization.accounts.map((a) => a.accountId)).toEqual(["card-new"]);
    expect(creditUsedCents(summary)).toBe(50000);
  });
});

describe("every bank's recurring read empty", () => {
  const emptyScripts = (over: Partial<Script> = {}): Script[] => [
    {
      accounts: [account("chk")],
      transactions: history("chk", "a"),
      outflow: [],
      inflow: [
        stream("payroll", "chk", -1500, {
          frequency: "BIWEEKLY",
          predicted_next_date: "2026-11-20",
          personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES" },
        }),
      ],
      ...over,
    },
  ];
  const hidden: BankView = { figures: "ready", showSafeToSpend: false, actions: [], missingFrom: [] };

  // "all empty".
  it("recurring charges are unknown, not $0, and safe-to-spend is not shown", async () => {
    const read = await readWith(emptyScripts());
    expect(read.engineConnections.map((c) => c.recurringRead)).toEqual(["empty"]);

    // What the engine itself says: it holds the figure back, with a reason of
    // its own for this case.
    const answer = analyzeCashFlow(toPackageInput(read, DATES), {}) as unknown as {
      recurring: { totalMonthlyCents: number | null };
      coverage: { safeToSpendShowable: boolean };
      safeToSpend: { status: string; reason: string | null };
    };
    expect(answer.safeToSpend.status).toBe("unavailable");
    expect(answer.safeToSpend.reason).toBe("recurring_empty_unknown");
    expect(answer.recurring.totalMonthlyCents).toBeNull();
    expect(answer.coverage.safeToSpendShowable).toBe(false);

    const summary = runCashFlowEngine(read, DATES);
    expect(summary.recurring).toEqual({ totalMonthlyCents: null, items: [] });
    expect(summary.coverage.safeToSpendShowable).toBe(false);
    // The screens explain it as recurring charges being unknown, and still
    // show the cash: the account's available balance.
    expect(safeToSpendHiddenReason(hidden, summary)).toBe("recurring_unknown");
    expect(summary.cashBalanceCents).toBe(95000);
    expect(spendableCashTile(summary)).toEqual({ kind: "amount", cents: 95000 });
  });

  // "cash total". Red if: the cash total is sent whenever the engine has one.
  it("the cash total is not sent when safe-to-spend is held back for another reason", async () => {
    const read = await readWith(emptyScripts({ recurringFails: true }));
    expect(read.engineConnections.map((c) => c.recurringRead)).toEqual(["failed"]);
    const answer = analyzeCashFlow(toPackageInput(read, DATES), {}) as unknown as {
      safeToSpend: { status: string; reason: string | null };
      cashBalance: { status: string; value?: { cents: number } };
    };
    expect(answer.safeToSpend.status).toBe("unavailable");
    expect(answer.safeToSpend.reason).toBe("recurring_unavailable");
    // The engine does have a cash total here; the app does not pass it on.
    expect(answer.cashBalance.status).toBe("available");
    expect(answer.cashBalance.value?.cents).toBe(95000);

    const summary = runCashFlowEngine(read, DATES);
    expect(summary.cashBalanceCents).toBeNull();
    expect(spendableCashTile(summary)).toEqual({ kind: "unknown" });
  });

  it("a computed figure carries no separate cash total", async () => {
    const read = await readWith([
      { ...emptyScripts()[0], outflow: [stream("netflix", "chk", 15.49)] },
    ]);
    const summary = runCashFlowEngine(read, DATES);
    expect(summary.safeToSpend.status).toBe("computed");
    expect(summary.cashBalanceCents).toBeNull();
  });
});
