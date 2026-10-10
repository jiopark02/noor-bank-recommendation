import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { computeFinancialSummary } from "../financeEngine/index";
import type {
  EngineAccount,
  EngineInput,
  EngineRecurringStream,
  EngineTransaction,
  FinancialSummary,
} from "../financeEngine/types";

/**
 * Finance engine — output boundary and purity (plan D7).
 *
 * The v1 output must carry no number that embeds a rate-of-return assumption,
 * names a product or institution as a recommendation, or tells the user to
 * move money. Types alone cannot hold that line (test files are outside tsc,
 * and a new field type-checks fine), so this file pins it:
 *
 *   (1) every numeric path in a maximal output equals EXPECTED_NUMERIC_PATHS —
 *       a new number fails until this list is changed on purpose;
 *   (2) every key equals EXPECTED_KEYS and none matches FORBIDDEN_KEY;
 *   (3) FORBIDDEN_KEY itself still catches the names it exists to catch;
 *   (4) an institution name smuggled onto an input never reaches the output;
 *   (5) engine sources import only each other and touch no env, network,
 *       clock, or randomness;
 *   (6) every assumption code and closed reason value also passes FORBIDDEN_KEY.
 *
 * Mutations that turn this file red:
 *   - a `projectedReturnCents` or `amountToMoveCents` field added to the output -> (1), (2)
 *   - `transfer` removed from FORBIDDEN_KEY                                     -> (3)
 *   - `import "next/server"` or a `process.env` read added to an engine file   -> (5)
 *   - an import of "./../plaid" (escapes the directory)                         -> (5)
 *   - a `.js` file calling fetch( in a subdirectory of the engine               -> (5)
 *   - `new Date`, bare `Date()`, `performance.now()` or `crypto.` in an engine file -> (5)
 */

const FORBIDDEN_KEY =
  /rate|apy|apr|yield|return|interest|growth|recommend|product|institution|move|transfer|send|deposit|withdraw|suggest|target/i;

const FETCHED = "2026-10-10T11:59:00Z";
const SENTINEL = "SENTINEL_INSTITUTION_7c1e";

function account(over: Partial<EngineAccount>): EngineAccount {
  return {
    accountId: "chk",
    type: "depository",
    subtype: "checking",
    currentCents: 200000,
    availableCents: 180000,
    limitCents: null,
    currency: "USD",
    balanceAsOf: null,
    fetchedAt: FETCHED,
    ...over,
  };
}

function txn(id: string, over: Partial<EngineTransaction>): EngineTransaction {
  return {
    transactionId: id,
    accountId: "chk",
    amountCents: 1000,
    currency: "USD",
    date: "2026-10-01",
    pending: false,
    pfcPrimary: "FOOD_AND_DRINK",
    pfcDetailed: null,
    legacyCategory: [],
    ...over,
  };
}

const netflix: EngineRecurringStream = {
  streamId: "netflix",
  label: "Netflix",
  frequency: "MONTHLY",
  averageAmountCents: 1549,
  lastAmountCents: 1549,
  currency: "USD",
  lastDate: "2026-09-20",
  predictedNextDate: "2026-10-20",
  isActive: true,
  status: "MATURE",
};

/** Exercises every output branch that can carry a number or a key. */
function maximalInput(): EngineInput {
  const withSentinel = (a: EngineAccount) =>
    ({ ...a, institution_name: SENTINEL, official_name: SENTINEL } as EngineAccount);
  return {
    now: "2026-10-10T12:00:00Z",
    currency: "USD",
    accounts: [
      withSentinel(account({})),
      withSentinel(
        account({ accountId: "card", type: "credit", subtype: "credit card", currentCents: 60000, availableCents: null, limitCents: 200000 })
      ),
      account({ accountId: "cadchk", currency: "CAD" }),
      account({ accountId: "cadcard", type: "credit", subtype: "credit card", currency: "CAD", limitCents: 100000 }),
    ],
    transactions: [
      txn("t1", {}),
      txn("t2", { amountCents: 10.5 }),
      { ...txn("t3", { amountCents: -500 }), merchant_name: SENTINEL } as EngineTransaction,
    ],
    period: { start: "2026-09-11", end: "2026-10-10", completeness: "complete" },
    recurring: {
      source: "plaid_streams",
      streams: [netflix, { ...netflix, streamId: "unk", frequency: "UNKNOWN" }],
    },
  };
}

function collect(value: unknown, at: string, numbers: Set<string>, keys: Set<string>): void {
  if (typeof value === "number") {
    numbers.add(at);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collect(v, at + "[]", numbers, keys));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const k of Object.keys(value)) {
      keys.add(k);
      collect((value as Record<string, unknown>)[k], at ? at + "." + k : k, numbers, keys);
    }
  }
}

function shape(s: FinancialSummary) {
  const numbers = new Set<string>();
  const keys = new Set<string>();
  collect(s, "", numbers, keys);
  return { numbers: Array.from(numbers).sort(), keys: Array.from(keys).sort() };
}

const EXPECTED_NUMERIC_PATHS = [
  "cashFlow.classificationSource.legacy",
  "cashFlow.classificationSource.none",
  "cashFlow.classificationSource.pfc",
  "cashFlow.excluded.betweenAccounts.cents",
  "cashFlow.excluded.betweenAccounts.count",
  "cashFlow.excluded.cardPayments.cents",
  "cashFlow.excluded.cardPayments.count",
  "cashFlow.excluded.invalid.count",
  "cashFlow.excluded.nonCashAccounts.cents",
  "cashFlow.excluded.nonCashAccounts.count",
  "cashFlow.excluded.otherCurrency.count",
  "cashFlow.excluded.outsidePeriod.count",
  "cashFlow.excluded.pending.cents",
  "cashFlow.excluded.pending.count",
  "cashFlow.excluded.unknownAccount.count",
  "cashFlow.incomeCents",
  "cashFlow.netCents",
  "cashFlow.period.days",
  "cashFlow.refundsCents",
  "cashFlow.spendingGrossCents",
  "cashFlow.spendingNetCents",
  "cashFlow.unclassifiedInflowCents",
  "creditUtilization.accounts[].balanceCents",
  "creditUtilization.accounts[].limitCents",
  "creditUtilization.accounts[].ratioBasisPoints",
  "creditUtilization.aggregate.accountsExcluded",
  "creditUtilization.aggregate.accountsIncluded",
  "creditUtilization.aggregate.balanceCents",
  "creditUtilization.aggregate.limitCents",
  "creditUtilization.aggregate.ratioBasisPoints",
  "recurring.items[].basisCents",
  "recurring.items[].monthlyCents",
  "recurring.totalMonthlyCents",
  "safeToSpend.amountCents",
  "safeToSpend.inputs.balances[].cents",
  "safeToSpend.inputs.creditCardBalances[].cents",
  "safeToSpend.inputs.upcomingRecurring[].cents",
  "safeToSpend.policy.bufferCents",
  "safeToSpend.totals.bufferCents",
  "safeToSpend.totals.reservedCreditCents",
  "safeToSpend.totals.spendableCashCents",
  "safeToSpend.totals.upcomingRecurringCents",
  "safeToSpend.uncoveredObligationsCents",
].sort();

const EXPECTED_KEYS = [
  "accountId", "accounts", "accountsExcluded", "accountsIncluded", "aggregate", "amountCents",
  "anyAsOfUnknown", "asOf", "asOfSource", "assumptions", "balanceCents", "balances", "basis",
  "basisCents", "betweenAccounts", "bufferCents", "cardPayments", "cashFlow", "cents",
  "classificationSource", "completeness", "computedAt", "count", "creditCardBalances",
  "creditUtilization", "currency", "dataIssues", "days", "dueDate", "end", "engineVersion",
  "excluded", "excludedAccounts", "excludedRecurring", "fetchedAt", "field", "frequency", "freshness", "from",
  "horizon", "id", "incomeCents", "inputs", "invalid", "items", "kind", "label", "legacy",
  "limitCents", "monthlyCents", "netCents", "nextDate", "nonCashAccounts", "none",
  "obligationsExceedCash", "oldestAsOf", "oldestFetchedAt", "otherCurrency", "outsidePeriod",
  "pending", "period", "pfc", "policy", "ratioBasisPoints", "reason", "recurring", "refundsCents",
  "reserveCreditCardBalances", "reservedCreditCents", "rule", "safeToSpend", "source",
  "spendableCashCents", "spendableSubtypes", "spendingGrossCents", "spendingNetCents", "start",
  "state", "status", "streamId", "subtype", "to", "totalMonthlyCents", "totals",
  "unclassifiedInflowCents", "uncoveredObligationsCents", "unknownAccount", "upcomingRecurring",
  "upcomingRecurringCents",
].sort();

describe("finance engine output boundary", () => {
  const summary = computeFinancialSummary(maximalInput());
  const { numbers, keys } = shape(summary);

  it("(1) numeric output paths are exactly the reviewed list", () => {
    expect(numbers).toEqual(EXPECTED_NUMERIC_PATHS);
  });

  it("(2) output keys are exactly the reviewed list and none is forbidden", () => {
    expect(keys).toEqual(EXPECTED_KEYS);
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
  });

  it("(3) the forbidden-key pattern still catches what it is for", () => {
    for (const name of [
      "shortfallToMove",
      "transferNeededCents",
      "amountToMoveCents",
      "moveCents",
      "projectedReturnCents",
      "recommendedProduct",
      "institutionName",
      "depositCents",
      "sendAmountCents",
      "withdrawCents",
      "savingsTargetCents",
      "aprBasisPoints",
    ]) {
      expect(FORBIDDEN_KEY.test(name), name).toBe(true);
    }
    for (const name of EXPECTED_KEYS) {
      expect(FORBIDDEN_KEY.test(name), name).toBe(false);
    }
  });

  it("(4) an institution name on an input never reaches the output", () => {
    expect(JSON.stringify(summary)).not.toContain(SENTINEL);
  });

  it("(2) the maximal fixture reaches the excluded-account lists", () => {
    expect(summary.safeToSpend.inputs.excludedAccounts.length).toBeGreaterThan(0);
    expect(summary.creditUtilization.excludedAccounts.length).toBeGreaterThan(0);
  });
});

// Closed string values the output can carry. Keys are pinned above; these are
// values, so they are listed here by hand from types.ts and held to the same
// naming rule.
const ASSUMPTION_CODES = [
  "account_to_account_excluded_ownership_unknown",
  "legacy_categories_used",
  "no_category_data",
  "available_reflects_pending",
  "current_used_when_available_missing",
  "unknown_subtype_excluded",
  "recurring_unavailable",
  "recurring_without_next_date_excluded",
  "credit_balances_reserved_in_full",
  "dates_utc",
  "balance_as_of_unknown",
  "other_currency_accounts_excluded",
  "semi_monthly_spacing_approximated",
  "recurring_due_today_may_already_be_pending",
];
const REASON_VALUES = [
  // DataIssue.reason
  "invalid_amount", "invalid_date", "missing_id", "duplicate", "invalid_period",
  "invalid_account_id", "invalid_fetched_at", "invalid_balance_as_of",
  "invalid_predicted_next_date", "no_balance",
  // ExcludedAccount.reason, recurring exclusions, safe-to-spend status reason
  "other_currency", "unknown_frequency", "no_amount", "inactive", "tombstoned",
  "no_next_date", "no_spendable_balance",
];

describe("finance engine closed values", () => {
  it("(6) no assumption code or reason value matches FORBIDDEN_KEY", () => {
    for (const v of ASSUMPTION_CODES.concat(REASON_VALUES)) {
      expect(FORBIDDEN_KEY.test(v), v).toBe(false);
    }
  });

  it("(6) every assumption code the maximal output emits is in the reviewed list", () => {
    const summary = computeFinancialSummary(maximalInput());
    const emitted = summary.cashFlow.assumptions
      .concat(summary.safeToSpend.assumptions)
      .concat(summary.creditUtilization.assumptions);
    for (const code of emitted) expect(ASSUMPTION_CODES).toContain(code);
  });
});

/**
 * Purity probe. It is a source-text scan, so it catches direct uses only:
 * aliasing (`const f = fetch`), names built from strings
 * (`globalThis["fe" + "tch"]`, `process["env"]` written indirectly) and similar
 * indirection are NOT caught. It is a tripwire for ordinary edits, not a proof.
 */
describe("finance engine purity", () => {
  const dir = path.resolve(__dirname, "../financeEngine");
  const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

  function listSources(root: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) out.push(...listSources(full));
      else if (SOURCE_FILE.test(entry.name)) out.push(full);
    }
    return out;
  }

  const files = listSources(dir);
  const label = (f: string) => path.relative(dir, f);

  it("finds the engine sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("(5) imports only files inside the engine directory", () => {
    const patterns = [
      /\bfrom\s*["']([^"']+)["']/g,
      /\bimport\s*["']([^"']+)["']/g,
      /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g,
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const pattern of patterns) {
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(src)) !== null) {
          const spec = m[1];
          // Relative only, and still inside the directory once normalized —
          // "./../plaid" starts with "./" but resolves outside.
          expect(spec.startsWith("."), `${label(f)} imports ${spec}`).toBe(true);
          const rel = path.relative(dir, path.resolve(path.dirname(f), spec));
          const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
          expect(inside, `${label(f)} imports ${spec}`).toBe(true);
        }
      }
    }
  });

  it("(5) reads no env, network, clock, or randomness", () => {
    const banned: Array<[string, RegExp]> = [
      ["process.env", /\bprocess\s*\.\s*env\b/],
      ["process[", /\bprocess\s*\[/],
      ["fetch(", /\bfetch\s*\(/],
      ["Date.now", /\bDate\s*\.\s*now\b/],
      ["new Date()", /\bnew\s+Date\s*\(\s*\)/],
      ["new Date without parentheses", /\bnew\s+Date\b(?!\s*\()/],
      ["bare Date(", /(?<!\bnew\s+)(?<![\w$.])Date\s*\(/],
      ["Math.random", /\bMath\s*\.\s*random\b/],
      ["performance.now", /\bperformance\s*\.\s*now\b/],
      ["crypto.", /\bcrypto\s*\./],
      ["require(", /\brequire\s*\(/],
      ["non-literal import(", /\bimport\s*\(\s*(?!["'`])/],
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const [name, re] of banned) {
        expect(re.test(src), `${label(f)} contains ${name}`).toBe(false);
      }
    }
  });
});
