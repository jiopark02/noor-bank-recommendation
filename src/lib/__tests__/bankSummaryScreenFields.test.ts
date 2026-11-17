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
  PAYMENT_PENDING_LABEL,
  pickFields,
  recurringDateLine,
  safeToSpendHiddenReason,
  safeToSpendHorizonPhrase,
  safeToSpendLines,
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
 *   - the cash total drawn for any reason but the one where no bank
 *     reported a recurring charge, or not drawn for that one     -> tile
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
 *     or the money screen drawing a line without recurringDateLine -> items
 *   - a payment taken as made still drawn as "Was expected"; a pending
 *     one drawn as a date, or as nothing; a posted transaction that was
 *     not taken as the payment hiding the date                    -> items
 *   - an item without paymentSincePredicted, or with a value the list
 *     does not name, read                                         -> items
 *   - the cushion's amount written into the lines instead of passed in,
 *     or left out of either line that has one                     -> cushion
 */

function screenSummary(over: {
  safeToSpend?: Partial<ScreenSummary["safeToSpend"]>;
  recurring?: Partial<ScreenSummary["recurring"]>;
  cashBalanceCents?: number | null;
} = {}): ScreenSummary {
  return {
    coverage: { safeToSpendShowable: true },
    cashFlow: { incomeCents: 0, spendingNetCents: 0, period: { completeness: "complete" } },
    safeToSpend: {
      status: "computed",
      reason: null,
      amountCents: 50000,
      horizon: { to: "2026-11-30", rule: "end_of_calendar_month" },
      totals: { spendableCashCents: 100000, cushionFloorCents: 75000 },
      ...over.safeToSpend,
    },
    recurring: { totalMonthlyCents: 1500, items: [], ...over.recurring },
    creditUtilization: { accounts: [] },
    cashBalanceCents: over.cashBalanceCents ?? null,
  };
}

function unavailable(reason: string, cashBalanceCents: number | null = null): ScreenSummary {
  return screenSummary({
    safeToSpend: {
      status: "unavailable",
      reason,
      amountCents: null,
      horizon: null,
      totals: null,
    },
    cashBalanceCents,
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
            paymentSincePredicted: null,
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

  // Red if: the reason is not looked at, so a cash total that came with any
  // other reason is drawn; or the total for this reason is not drawn.
  it("a figure held back only because no bank reported a recurring charge shows the cash total", () => {
    const tile = spendableCashTile(unavailable("recurring_empty_unknown", 95000));
    expect(tile).toEqual({ kind: "amount", cents: 95000 });
    expect(spendableCashCents(tile)).toBe(95000);
  });

  it("that reason with no cash total draws a dash", () => {
    expect(spendableCashTile(unavailable("recurring_empty_unknown", null))).toEqual({ kind: "unknown" });
  });

  it("a cash total that came with any other reason is not drawn", () => {
    for (const reason of [
      "stale_balance",
      "null_balance",
      "history_incomplete",
      "recurring_unavailable",
      "recurring_amount_unknown",
      "non_usd_present",
      "x",
    ]) {
      expect(spendableCashTile(unavailable(reason, 95000)), reason).toEqual({ kind: "unknown" });
    }
    expect(spendableCashTile(unavailable("no_cash_account", 95000))).toEqual({ kind: "no_cash_account" });
  });

  it("a computed figure shows the cash it was computed from, not the separate total", () => {
    expect(spendableCashTile(screenSummary({ cashBalanceCents: 1 }))).toEqual({ kind: "amount", cents: 100000 });
  });
});

describe("recurring items", () => {
  type Payment = "counted" | "pending" | "unconfirmed" | null;
  const passed = (paymentSincePredicted: Payment) => ({
    nextDate: "2026-11-05",
    nextDateAssumedToday: false,
    paymentSincePredicted,
  });

  it("a date the engine filled in with today is not drawn; an expected date is", () => {
    const none = { paymentSincePredicted: null };
    expect(recurringDateLine({ nextDate: "2026-11-11", nextDateAssumedToday: true, ...none })).toBe("none");
    expect(recurringDateLine({ nextDate: "2026-11-20", nextDateAssumedToday: false, ...none })).toBe("date");
    expect(recurringDateLine({ nextDate: null, nextDateAssumedToday: false, ...none })).toBe("none");
  });

  // Red if: a payment taken as made still reads "Was expected <date>".
  it("a passed date whose payment was taken as made draws no line", () => {
    expect(recurringDateLine(passed("counted"))).toBe("none");
  });

  // Red if: a payment that is only pending is drawn as a date (it would read
  // "Was expected"), or as nothing (it would read as paid).
  it("a passed date with only a pending payment draws the pending label, not the date", () => {
    expect(recurringDateLine(passed("pending"))).toBe("pending");
    expect(PAYMENT_PENDING_LABEL).toBe("Payment pending");
  });

  // Red if: a posted transaction the engine did not take as the payment
  // hides the date, as if the charge had been paid.
  it("a passed date with an unconfirmed payment, or with nothing since, keeps the date", () => {
    expect(recurringDateLine(passed("unconfirmed"))).toBe("date");
    expect(recurringDateLine(passed(null))).toBe("date");
  });

  it("a date the engine filled in, or no date, draws no line whatever the payment says", () => {
    for (const payment of ["counted", "pending", "unconfirmed", null] as Payment[]) {
      expect(
        recurringDateLine({ nextDate: "2026-11-11", nextDateAssumedToday: true, paymentSincePredicted: payment })
      ).toBe("none");
      expect(
        recurringDateLine({ nextDate: null, nextDateAssumedToday: false, paymentSincePredicted: payment })
      ).toBe("none");
    }
  });

  it("an item with a payment value the list does not name is a failed read", () => {
    const s = screenSummary({
      recurring: {
        totalMonthlyCents: 1500,
        items: [
          {
            streamId: "s1",
            label: "Gym",
            monthlyCents: 1500,
            nextDate: "2026-11-05",
            nextDateAssumedToday: false,
            pastDue: true,
            paymentSincePredicted: "maybe",
          } as never,
        ],
      },
    });
    expect(parseFinanceSummaryResponse(JSON.parse(JSON.stringify(body(s))))).toBeNull();
  });

  it("the item list reads paymentSincePredicted, and no longer paidSincePredicted", () => {
    const item = SUMMARY_RESPONSE_FIELDS.summary.orNull.recurring.items.listOf;
    expect(Object.keys(item).sort()).toEqual([
      "label",
      "monthlyCents",
      "nextDate",
      "nextDateAssumedToday",
      "pastDue",
      "paymentSincePredicted",
      "streamId",
    ]);
  });

  it("an item without paymentSincePredicted is a failed read", () => {
    const s = screenSummary({
      recurring: {
        totalMonthlyCents: 1500,
        items: [
          {
            streamId: "s1",
            label: "Gym",
            monthlyCents: 1500,
            nextDate: "2026-11-05",
            nextDateAssumedToday: false,
            pastDue: true,
          } as never,
        ],
      },
    });
    expect(parseFinanceSummaryResponse(JSON.parse(JSON.stringify(body(s))))).toBeNull();
  });

  it("the money screen draws a charge's line only through recurringDateLine", () => {
    const page = readFileSync(
      fileURLToPath(new URL("../../app/money/page.tsx", import.meta.url)),
      "utf8"
    );
    expect(page).toContain('{item.nextDate && recurringDateLine(item) === "date" && (');
    expect(page).toContain('{recurringDateLine(item) === "pending" && (');
    // The pending wording comes from the tested constant, never typed in.
    expect(page).toContain("{PAYMENT_PENDING_LABEL}");
    expect(page).not.toContain("Payment pending");
    // Nothing on the page decides from the payment field itself.
    expect(page).not.toMatch(/paymentSincePredicted|paidSincePredicted/);
    // The date line is drawn in one place only.
    expect(page.match(/Next expected/g) ?? []).toHaveLength(1);
    expect(page.match(/Was expected/g) ?? []).toHaveLength(1);
  });

  it("an item without nextDateAssumedToday is a failed read", () => {
    const s = screenSummary({
      recurring: {
        totalMonthlyCents: 1500,
        items: [
          {
            streamId: "s1",
            label: "Gym",
            monthlyCents: 1500,
            nextDate: "2026-11-20",
            pastDue: false,
            paymentSincePredicted: null,
          } as never,
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

/*
 * The dashboard's safe-to-spend lines. The figure also sets aside money the
 * summary does not itemize, so the lines carry no breakdown; a listed
 * breakdown would not add up to it. The one other amount is the cushion the
 * figure leaves in the account, passed in from the summary. The dashboard
 * never reads the uncovered-obligations field
 * (dashboardBankReadErrors.test.ts), and the field lists carry neither that
 * field nor the itemized totals.
 *
 * Mutations that turn this block red:
 *   - a negative figure stated as anything but its absolute value  -> shortfall
 *   - the cash, recurring, card or buffer amounts listed again     -> amounts
 *   - the cushion's amount written in instead of passed in, or
 *     left out of the line for a figure of either sign             -> cushion
 *   - a cushion clause drawn for no cushion (0, or none given)     -> no cushion
 *   - uncoveredObligationsCents or an itemized total listed again  -> field list
 */
describe("the dashboard's safe-to-spend lines", () => {
  const monthEnd = { to: "2026-11-30", rule: "end_of_calendar_month" };
  const nextIncome = { to: "2026-11-21", rule: "next_income_date" };
  // Without a cushion: the lines as they read when none is kept.
  const linesFor = (amountCents: number, horizon: { to: string; rule: string }) =>
    safeToSpendLines(amountCents, horizon, 0);
  const amountsIn = (text: string) => text.match(/\$[\d,]+\.\d{2}/g) ?? [];
  // Not the engine's default, so an amount written into the lines shows.
  const CUSHION = 30000;

  it("a figure of 0 or more names the cushion it keeps, with the amount passed in", () => {
    for (const horizon of [monthEnd, nextIncome]) {
      const lines = safeToSpendLines(12345, horizon, CUSHION);
      expect(lines.statement).toBe(linesFor(12345, horizon).statement);
      expect(lines.answer).toBe(
        "That's what's left after setting aside upcoming bills, card payments, your usual spending and other expected costs, and keeping a $300.00 cushion in your account."
      );
    }
  });

  it("a negative figure names the cushion too", () => {
    for (const horizon of [monthEnd, nextIncome]) {
      const lines = safeToSpendLines(-12345, horizon, CUSHION);
      expect(lines.statement).toBe(linesFor(-12345, horizon).statement);
      expect(lines.answer).toBe(
        "That covers upcoming bills, card payments, your usual spending and other expected costs, plus a $300.00 cushion I'd keep in your account."
      );
    }
  });

  it("the figure and the cushion are the only amounts in the lines", () => {
    for (const amount of [12345, -12345]) {
      for (const horizon of [monthEnd, nextIncome]) {
        const lines = safeToSpendLines(amount, horizon, CUSHION);
        expect(amountsIn(lines.statement)).toEqual(["$123.45"]);
        expect(amountsIn(lines.answer)).toEqual(["$300.00"]);
      }
    }
    expect(amountsIn(safeToSpendLines(12345, monthEnd, 75000).answer)).toEqual(["$750.00"]);
  });

  it("no cushion, 0 or none given, reads as the lines without one", () => {
    for (const amount of [12345, -12345]) {
      for (const horizon of [monthEnd, nextIncome]) {
        expect(safeToSpendLines(amount, horizon, null)).toEqual(linesFor(amount, horizon));
        const lines = safeToSpendLines(amount, horizon, null);
        expect(lines.answer).not.toContain("cushion");
        expect(linesFor(amount, horizon).answer).not.toContain("cushion");
      }
    }
  });

  it("a figure of 0 or more, through the month's end", () => {
    expect(linesFor(12345, monthEnd)).toEqual({
      statement: "You have about $123.45 to spend through Nov 30.",
      answer:
        "That's what's left after setting aside upcoming bills, card payments, your usual spending and other expected costs.",
    });
    expect(linesFor(0, monthEnd).statement).toBe("You have about $0.00 to spend through Nov 30.");
  });

  it("a figure of 0 or more, until the next income", () => {
    expect(linesFor(12345, nextIncome)).toEqual({
      statement: "You have about $123.45 to spend until your next income on Nov 21.",
      answer:
        "That's what's left after setting aside upcoming bills, card payments, your usual spending and other expected costs.",
    });
  });

  it("a negative figure, through the month's end, states its absolute value", () => {
    expect(linesFor(-12345, monthEnd)).toEqual({
      statement:
        "What I'd set aside through Nov 30 comes to about $123.45 more than your cash.",
      answer: "That covers upcoming bills, card payments, your usual spending and other expected costs.",
    });
  });

  it("a negative figure, until the next income, states its absolute value", () => {
    expect(linesFor(-12345, nextIncome)).toEqual({
      statement:
        "What I'd set aside until your next income on Nov 21 comes to about $123.45 more than your cash.",
      answer: "That covers upcoming bills, card payments, your usual spending and other expected costs.",
    });
  });

  it("the field list carries the figure, the cash it starts from and the cushion, not a breakdown", () => {
    const safe = SUMMARY_RESPONSE_FIELDS.summary.orNull.safeToSpend;
    expect(Object.keys(safe).sort()).toEqual(["amountCents", "horizon", "reason", "status", "totals"]);
    expect(Object.keys(safe.totals.orNull).sort()).toEqual(["cushionFloorCents", "spendableCashCents"]);
  });

  it("without a cushion the figure is the only amount in the lines", () => {
    for (const amount of [12345, -12345]) {
      for (const horizon of [monthEnd, nextIncome]) {
        const lines = linesFor(amount, horizon);
        expect(amountsIn(lines.statement + " " + lines.answer)).toEqual(["$123.45"]);
      }
    }
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
      ["recurring_empty_unknown", "recurring_unknown"],
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
    paymentSincePredicted: null,
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
