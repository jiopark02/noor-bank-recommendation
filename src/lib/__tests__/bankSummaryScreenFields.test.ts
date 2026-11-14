import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  formatCentsOrDash,
  HIDDEN_SAFE_TO_SPEND_ANSWER,
  orderRecurringItems,
  NO_CASH_ACCOUNT_HINT,
  NO_CASH_ACCOUNT_LABEL,
  parseFinanceSummaryResponse,
  pickFields,
  safeToSpendHiddenReason,
  safeToSpendHorizonPhrase,
  showsRecurringDate,
  spendableCashCents,
  spendableCashTile,
  SUMMARY_RESPONSE_FIELDS,
  type BankView,
  type ScreenSummary,
  type ScreenSummaryResponse,
} from "../bankSummaryView";

/**
 * The summary fields that may be missing, and how the screens draw them.
 * Bodies are written out by hand, so these hold whichever engine computed
 * the figures.
 *
 * Mutations that turn this file red:
 *   - safeToSpend.horizon or .totals, or a recurring item's monthlyCents,
 *     no longer allowed to be null in the field list          -> null fields
 *   - the spendable-cash tile drawing totals (or 0) when safe-to-spend was
 *     not computed, or `?? 0` anywhere on that path              -> tile
 *   - a missing checking account drawn as a dash, or an unknown balance
 *     drawn as "No checking account linked"                      -> tile
 *   - an unknown monthly amount drawn as $0.00/mo                 -> items
 *   - "through" used for the next-income horizon, or "until your next
 *     income" for the month-end one                              -> horizon
 *   - pickFields passing a field the list does not name, or passing a value
 *     that does not fit                                          -> pickFields
 *   - a hidden figure explained with the wrong reason             -> hidden
 *   - recurring charges drawn unsorted, in the order they arrived, or with
 *     an unknown amount sorted as 0                              -> order
 *   - the order decided by locale, or without a final tie-break  -> order
 *   - a screen drawing recurring charges from anything but the parsed
 *     body, or reordering them itself                            -> order
 *   - a dashboard answer kept for a bank not read, or one missing -> hidden
 *   - a date the engine filled in with today drawn as "Next expected",
 *     or the money screen drawing a date without showsRecurringDate -> items
 */

function screenSummary(over: {
  safeToSpend?: Partial<ScreenSummary["safeToSpend"]>;
  recurring?: Partial<ScreenSummary["recurring"]>;
} = {}): ScreenSummary {
  return {
    coverage: { safeToSpendShowable: true },
    cashFlow: { incomeCents: 0, spendingNetCents: 0, period: { completeness: "complete" } },
    safeToSpend: {
      status: "computed",
      reason: null,
      amountCents: 50000,
      uncoveredObligationsCents: 0,
      horizon: { to: "2026-11-30", rule: "end_of_calendar_month" },
      totals: {
        spendableCashCents: 100000,
        upcomingRecurringCents: 1500,
        reservedCreditCents: 25000,
        bufferCents: 0,
      },
      ...over.safeToSpend,
    },
    recurring: { totalMonthlyCents: 1500, items: [], ...over.recurring },
    creditUtilization: { accounts: [] },
  };
}

function unavailable(reason: string): ScreenSummary {
  return screenSummary({
    safeToSpend: {
      status: "unavailable",
      reason,
      amountCents: null,
      uncoveredObligationsCents: null,
      horizon: null,
      totals: null,
    },
  });
}

function body(summary: ScreenSummary | null): ScreenSummaryResponse {
  return { connections: [], accounts: [], summary };
}

const shown: BankView = { figures: "ready", showSafeToSpend: true, actions: [], missingFrom: [] };
const hidden: BankView = { ...shown, showSafeToSpend: false };

describe("summary fields that may be null", () => {
  it("a summary whose safe-to-spend could not be computed is read, not failed", () => {
    expect(parseFinanceSummaryResponse(JSON.parse(JSON.stringify(body(unavailable("stale_balance")))))).not.toBeNull();
  });

  it("a recurring item with no monthly amount is read, not failed", () => {
    const s = screenSummary({
      recurring: {
        totalMonthlyCents: null,
        items: [
          {
            streamId: "s1",
            label: "Gym",
            monthlyCents: null,
            nextDate: "2026-11-20",
            nextDateAssumedToday: false,
            pastDue: false,
          },
        ],
      },
    });
    expect(parseFinanceSummaryResponse(JSON.parse(JSON.stringify(body(s))))).not.toBeNull();
  });

  it("a horizon rule the screens do not know is a failed read", () => {
    const s = screenSummary({ safeToSpend: { horizon: { to: "2026-11-30", rule: "someday" } } });
    expect(parseFinanceSummaryResponse(JSON.parse(JSON.stringify(body(s))))).toBeNull();
  });
});

describe("the spendable-cash tile", () => {
  it("shows the cash safe-to-spend was computed from", () => {
    expect(spendableCashTile(screenSummary())).toEqual({ kind: "amount", cents: 100000 });
    expect(spendableCashCents({ kind: "amount", cents: 100000 })).toBe(100000);
  });

  it("with no connection the zero is true", () => {
    expect(spendableCashTile(null)).toEqual({ kind: "amount", cents: 0 });
  });

  it("no checking account says so, with a hint to link one", () => {
    const tile = spendableCashTile(unavailable("no_cash_account"));
    expect(tile).toEqual({ kind: "no_cash_account" });
    expect(spendableCashCents(tile)).toBeNull();
    expect(NO_CASH_ACCOUNT_LABEL).toBe("No checking account linked");
    expect(NO_CASH_ACCOUNT_HINT).not.toBe("");
  });

  it("any other reason draws a dash, never an amount", () => {
    for (const reason of ["stale_balance", "null_balance", "history_incomplete", "recurring_unavailable", "x"]) {
      const tile = spendableCashTile(unavailable(reason));
      expect(tile, reason).toEqual({ kind: "unknown" });
      expect(formatCentsOrDash(spendableCashCents(tile))).toBe("—");
    }
  });

  it("a computed status with no totals is not drawn as an amount", () => {
    expect(spendableCashTile(screenSummary({ safeToSpend: { totals: null } }))).toEqual({ kind: "unknown" });
  });
});

describe("recurring items", () => {
  it("a date the engine filled in with today is not drawn; an expected date is", () => {
    expect(showsRecurringDate({ nextDate: "2026-11-11", nextDateAssumedToday: true })).toBe(false);
    expect(showsRecurringDate({ nextDate: "2026-11-20", nextDateAssumedToday: false })).toBe(true);
    expect(showsRecurringDate({ nextDate: null, nextDateAssumedToday: false })).toBe(false);
  });

  it("the money screen draws a charge's date only through showsRecurringDate", () => {
    const page = readFileSync(
      fileURLToPath(new URL("../../app/money/page.tsx", import.meta.url)),
      "utf8"
    );
    expect(page).toContain("{item.nextDate && showsRecurringDate(item) && (");
    // The date line is drawn in one place only.
    expect(page.match(/Next expected/g) ?? []).toHaveLength(1);
  });

  it("an item without nextDateAssumedToday is a failed read", () => {
    const s = screenSummary({
      recurring: {
        totalMonthlyCents: 1500,
        items: [
          { streamId: "s1", label: "Gym", monthlyCents: 1500, nextDate: "2026-11-20", pastDue: false } as never,
        ],
      },
    });
    expect(parseFinanceSummaryResponse(JSON.parse(JSON.stringify(body(s))))).toBeNull();
  });

  it("an unknown monthly amount is a dash, never $0.00", () => {
    expect(formatCentsOrDash(null)).toBe("—");
    expect(formatCentsOrDash(1500)).toBe("$15.00");
  });
});

describe("the safe-to-spend horizon in a sentence", () => {
  it("the month-end horizon reads 'through' its last day", () => {
    expect(safeToSpendHorizonPhrase({ to: "2026-11-30", rule: "end_of_calendar_month" })).toBe(
      "through Nov 30"
    );
  });

  it("the next-income horizon reads 'until your next income on' that day", () => {
    expect(safeToSpendHorizonPhrase({ to: "2026-11-21", rule: "next_income_date" })).toBe(
      "until your next income on Nov 21"
    );
  });
});

describe("why safe-to-spend is not shown", () => {
  it("a shown, computed figure has no reason", () => {
    expect(safeToSpendHiddenReason(shown, screenSummary())).toBeNull();
  });

  it("a bank that was not read comes first", () => {
    const view: BankView = {
      ...hidden,
      actions: [{ kind: "retry", itemId: "i", institutionName: "Bank" }],
    };
    expect(safeToSpendHiddenReason(view, unavailable("stale_balance"))).toBe("banks_not_read");
  });

  it("each unavailable reason maps to its explanation", () => {
    const cases: Array<[string, string]> = [
      ["no_cash_account", "no_cash_account"],
      ["no_spendable_balance", "no_cash_account"],
      ["null_balance", "balance_unknown"],
      ["stale_balance", "balance_unknown"],
      ["recurring_unavailable", "recurring_unknown"],
      ["recurring_amount_unknown", "recurring_unknown"],
      ["history_incomplete", "history_incomplete"],
      ["non_usd_present", "other"],
    ];
    for (const [reason, expected] of cases) {
      expect(safeToSpendHiddenReason(hidden, unavailable(reason)), reason).toBe(expected);
    }
  });

  it("a computed figure hidden because recurring charges are unknown says so", () => {
    const s = screenSummary({ recurring: { totalMonthlyCents: null, items: [] } });
    expect(safeToSpendHiddenReason(hidden, s)).toBe("recurring_unknown");
  });

  it("every reason the dashboard answers from the table has an answer; a bank not read is not one", () => {
    expect(Object.keys(HIDDEN_SAFE_TO_SPEND_ANSWER).sort()).toEqual(
      ["balance_unknown", "history_incomplete", "no_cash_account", "other", "recurring_unknown"]
    );
    for (const key of Object.keys(HIDDEN_SAFE_TO_SPEND_ANSWER)) {
      expect(HIDDEN_SAFE_TO_SPEND_ANSWER[key as keyof typeof HIDDEN_SAFE_TO_SPEND_ANSWER]).not.toBe("");
    }
  });
});

describe("the order recurring charges are drawn in", () => {
  type Item = ScreenSummary["recurring"]["items"][number];
  const item = (streamId: string, label: string, monthlyCents: number | null): Item => ({
    streamId,
    label,
    monthlyCents,
    nextDate: "2026-11-20",
    nextDateAssumedToday: false,
    pastDue: false,
  });
  // The engine sends its items by stream id; none of these is in the drawn order.
  const fromEngine = [
    item("a-gym", "Gym", 4000),
    item("b-unknown", "Alarm", null),
    item("c-zero", "Zero plan", 0),
    item("d-tv", "Streaming", 1549),
    item("e-tv2", "Streaming", 1549),
    item("f-big", "Rent share", 90000),
    item("g-unknown", "Alarm", null),
    item("h-cloud", "Cloud", 1549),
  ];
  const drawn = [
    "f-big", // largest amount first
    "a-gym",
    "h-cloud", // equal amounts: by label, "Cloud" before "Streaming"
    "d-tv", // equal amount and label: by stream id
    "e-tv2",
    "c-zero", // a known 0 is still a known amount
    "b-unknown", // no known amount: after every known one, then label, then id
    "g-unknown",
  ];

  it("largest monthly amount first, unknown amounts last, then label, then stream id", () => {
    expect(orderRecurringItems(fromEngine).map((i) => i.streamId)).toEqual(drawn);
  });

  it("the same charges in any arrival order are drawn in the same order", () => {
    expect(orderRecurringItems(fromEngine.slice().reverse()).map((i) => i.streamId)).toEqual(drawn);
  });

  it("labels compare by code unit, not by locale", () => {
    const order = orderRecurringItems([item("1", "b", 100), item("2", "B", 100), item("3", "a", 100)]);
    expect(order.map((i) => i.label)).toEqual(["B", "a", "b"]);
  });

  it("does not change the list it is given", () => {
    const input = fromEngine.slice();
    orderRecurringItems(input);
    expect(input).toEqual(fromEngine);
  });

  it("a parsed summary carries its recurring charges in that order", () => {
    const s = screenSummary({ recurring: { totalMonthlyCents: null, items: fromEngine } });
    const parsed = parseFinanceSummaryResponse(JSON.parse(JSON.stringify(body(s))));
    expect(parsed?.summary?.recurring.items.map((i) => i.streamId)).toEqual(drawn);
  });

  // Red if: a screen draws recurring charges from anything but the parsed
  // body, or puts them in another order on its own.
  it("both screens draw recurring charges only from the parsed body, in its order", () => {
    for (const page of ["../../app/dashboard/page.tsx", "../../app/money/page.tsx"]) {
      const source = readFileSync(fileURLToPath(new URL(page, import.meta.url)), "utf8");
      expect(source, page).toContain("parseFinanceSummaryResponse(");
      expect(source, page).toContain("recurringItems: summary ? summary.recurring.items : [],");
      expect(source, page).not.toMatch(/recurringItems[^\n]*\.(?:sort|reverse)\(/);
      const draws = source.match(/figures\.recurringItems(?:\.slice\([^)]*\))?\.map\(/g) ?? [];
      expect(draws.length, page).toBeGreaterThan(0);
    }
  });
});

describe("pickFields", () => {
  it("keeps exactly the listed fields, at every depth", () => {
    const source = JSON.parse(JSON.stringify(body(screenSummary()))) as Record<string, unknown>;
    source.inputHash = "abc";
    (source.summary as Record<string, unknown>).inputHash = "def";
    ((source.summary as Record<string, Record<string, unknown>>).safeToSpend).keepCents = 1;
    const picked = pickFields(SUMMARY_RESPONSE_FIELDS, source);
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.value).toEqual(body(screenSummary()));
    expect(JSON.stringify(picked.value)).not.toContain("inputHash");
    expect(JSON.stringify(picked.value)).not.toContain("keepCents");
  });

  it("a value that does not fit is refused, not passed on", () => {
    const source = JSON.parse(JSON.stringify(body(screenSummary()))) as {
      summary: { safeToSpend: { status: string } };
    };
    source.summary.safeToSpend.status = "maybe";
    expect(pickFields(SUMMARY_RESPONSE_FIELDS, source)).toEqual({ ok: false });
  });

  it("null passes only where the list allows it", () => {
    expect(pickFields(SUMMARY_RESPONSE_FIELDS, body(null))).toEqual({ ok: true, value: body(null) });
    expect(pickFields({ a: "number" }, { a: null })).toEqual({ ok: false });
  });
});
