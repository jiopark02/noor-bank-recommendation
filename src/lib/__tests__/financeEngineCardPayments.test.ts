import { describe, it, expect } from "vitest";
import { computeFinancialSummary, DEFAULT_POLICY } from "../financeEngine/index";
import { isCardPaymentCategory } from "../financeEngine/classify";
import type {
  EngineAccount,
  EngineInput,
  EngineRecurringStream,
} from "../financeEngine/types";

/**
 * Finance engine — card payments and past-due charges, where the same money
 * could otherwise be subtracted twice: once as a recurring charge and once
 * in the card balance that is reserved in full.
 *
 * Mutations that turn this file red:
 *   - a card-payment stream on a card kept as an obligation        -> "path 1: on a card …"
 *   - the exclusion keyed on "the account is a card" instead of
 *     reservesCardBalance                                          -> "on a card whose balance is not reserved …"
 *   - the account type ignored (a cash account's stream dropped)    -> "path 1: from a cash account …"
 *   - the legacy fallback removed, or used when PFC is present      -> "the category rule"
 *   - the reserve policy ignored                                    -> "path 1: … not reserved"
 *   - the past-due-on-card assumption dropped, or put on cash      -> "path 2 …"
 *   - path 2 keyed on "the account is a card" instead of
 *     reservesCardBalance                                          -> "… a card whose balance is not reserved …"
 *   - pastDue compared with <= (today counted as past)             -> "pastDue …"
 */

function acct(over: Partial<EngineAccount>): EngineAccount {
  return {
    accountId: "chk",
    type: "depository",
    subtype: "checking",
    currentCents: 200000,
    availableCents: 200000,
    limitCents: null,
    currency: "USD",
    balanceAsOf: null,
    fetchedAt: "2026-10-10T11:59:00Z",
    duplicateKey: null,
    connectionKey: "c0",
    ...over,
  };
}

const CARD = acct({
  accountId: "card",
  type: "credit",
  subtype: "credit card",
  currentCents: 50000,
  availableCents: null,
  limitCents: 300000,
});

function stream(over: Partial<EngineRecurringStream>): EngineRecurringStream {
  return {
    streamId: "s",
    label: "S",
    frequency: "MONTHLY",
    averageAmountCents: 30000,
    lastAmountCents: 30000,
    currency: "USD",
    lastDate: "2026-09-20",
    predictedNextDate: "2026-10-20",
    isActive: true,
    status: "MATURE",
    accountId: "chk",
    pfcPrimary: null,
    pfcDetailed: null,
    legacyCategory: [],
    transactionIds: [],
    ...over,
  };
}

const CARD_PAYMENT = {
  pfcPrimary: "LOAN_PAYMENTS",
  pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
};

function input(streams: EngineRecurringStream[]): EngineInput {
  return {
    now: "2026-10-10T12:00:00Z",
    today: "2026-10-10",
    dateBasis: "utc",
    currency: "USD",
    accounts: [acct({}), CARD],
    transactions: [],
    readWindow: { start: "2026-07-13", end: "2026-10-10" },
    period: { start: "2026-07-13", end: "2026-10-10" },
    connections: [
      {
        connectionKey: "c0",
        state: "ok",
        lastSuccessfulUpdate: null,
        recurringRead: "ok",
        transactionsTruncated: false,
        earliestTransactionDate: null,
      },
    ],
    recurring: { streams, incomeStreams: [] },
  };
}

describe("the category rule", () => {
  it("PFC detailed decides; the legacy category counts only without PFC", () => {
    expect(isCardPaymentCategory({ ...CARD_PAYMENT, legacyCategory: [] })).toBe(true);
    expect(isCardPaymentCategory({ pfcPrimary: null, pfcDetailed: null, legacyCategory: ["Payment", "Credit Card"] })).toBe(true);
    expect(
      isCardPaymentCategory({ pfcPrimary: "ENTERTAINMENT", pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES", legacyCategory: ["Payment", "Credit Card"] })
    ).toBe(false);
    expect(isCardPaymentCategory({ pfcPrimary: null, pfcDetailed: null, legacyCategory: ["Payment"] })).toBe(false);
  });
});

describe("path 1: a recurring card payment", () => {
  it("on a card, while card balances are reserved, is left out with its reason", () => {
    const s = computeFinancialSummary(input([stream({ streamId: "pay", accountId: "card", ...CARD_PAYMENT })]));
    expect(s.recurring.items).toEqual([]);
    expect(s.recurring.excluded).toEqual([{ streamId: "pay", reason: "card_payment_in_card_balance" }]);
    expect(s.safeToSpend.inputs.upcomingRecurring).toEqual([]);
    expect(s.safeToSpend.inputs.excludedRecurring).toContainEqual({
      streamId: "pay",
      reason: "card_payment_in_card_balance",
    });
    // Only the card balance is subtracted.
    expect(s.safeToSpend.amountCents).toBe(200000 - 50000);
  });

  it("on a card found by the legacy category alone, the same", () => {
    const s = computeFinancialSummary(
      input([stream({ streamId: "pay", accountId: "card", legacyCategory: ["Payment", "Credit Card"] })])
    );
    expect(s.recurring.excluded).toEqual([{ streamId: "pay", reason: "card_payment_in_card_balance" }]);
  });

  it("on a card, when card balances are not reserved, stays an obligation", () => {
    const s = computeFinancialSummary(
      input([stream({ streamId: "pay", accountId: "card", ...CARD_PAYMENT })]),
      { ...DEFAULT_POLICY, reserveCreditCardBalances: false }
    );
    expect(s.recurring.items.map((i) => i.streamId)).toEqual(["pay"]);
    expect(s.safeToSpend.inputs.upcomingRecurring[0]).toMatchObject({ streamId: "pay", cardPayment: true });
    expect(s.safeToSpend.assumptions).not.toContain("card_payment_recurring_counted");
  });

  it("from a cash account stays an obligation, marked, and the overlap is stated", () => {
    const s = computeFinancialSummary(input([stream({ streamId: "pay", accountId: "chk", ...CARD_PAYMENT })]));
    expect(s.recurring.items.map((i) => i.streamId)).toEqual(["pay"]);
    expect(s.safeToSpend.inputs.upcomingRecurring).toEqual([
      { streamId: "pay", label: "S", dueDate: "2026-10-20", cents: 30000, pastDue: false, cardPayment: true },
    ]);
    expect(s.safeToSpend.assumptions).toContain("card_payment_recurring_counted");
    expect(s.safeToSpend.amountCents).toBe(200000 - 30000 - 50000);
  });

  // A card whose balance the reserve leaves out must not lose its payment
  // too, or the money is subtracted nowhere.
  it("on a card whose balance is not reserved stays an obligation, marked, and stated", () => {
    const cards: Array<[string, Partial<EngineAccount>]> = [
      ["no balance", { currentCents: null }],
      ["other currency", { currency: "CAD" }],
      ["nothing owed", { currentCents: 0 }],
      ["credit balance", { currentCents: -2500 }],
    ];
    for (const [label, over] of cards) {
      const i = input([stream({ streamId: "pay", accountId: "card", ...CARD_PAYMENT })]);
      i.accounts = [acct({}), { ...CARD, ...over }];
      const s = computeFinancialSummary(i);
      expect(s.safeToSpend.inputs.creditCardBalances, label).toEqual([]);
      expect(s.recurring.excluded, label).toEqual([]);
      expect(s.recurring.items.map((r) => r.streamId), label).toEqual(["pay"]);
      expect(s.safeToSpend.inputs.upcomingRecurring, label).toEqual([
        { streamId: "pay", label: "S", dueDate: "2026-10-20", cents: 30000, pastDue: false, cardPayment: true },
      ]);
      expect(s.safeToSpend.totals.upcomingRecurringCents, label).toBe(30000);
      expect(s.safeToSpend.assumptions, label).toContain("card_payment_recurring_counted");
    }
  });

  it("whose account is unknown stays an obligation too", () => {
    const s = computeFinancialSummary(input([stream({ streamId: "pay", accountId: null, ...CARD_PAYMENT })]));
    expect(s.recurring.items.map((i) => i.streamId)).toEqual(["pay"]);
    expect(s.safeToSpend.assumptions).toContain("card_payment_recurring_counted");
  });

  it("an ordinary stream is not a card payment", () => {
    const s = computeFinancialSummary(input([stream({ streamId: "tv", accountId: "card" })]));
    expect(s.safeToSpend.inputs.upcomingRecurring[0]).toMatchObject({ streamId: "tv", cardPayment: false });
    expect(s.safeToSpend.assumptions).not.toContain("card_payment_recurring_counted");
  });
});

// today is 2026-10-10, so the default 7-day grace window is [10-03, 10-10).
describe("path 2: a past-due charge on a card", () => {
  const late = { predictedNextDate: "2026-10-05", lastDate: "2026-09-05" };

  it("stays subtracted and states that it may already be in the card balance", () => {
    const s = computeFinancialSummary(input([stream({ streamId: "tv", accountId: "card", ...late })]));
    expect(s.safeToSpend.inputs.upcomingRecurring[0]).toMatchObject({
      streamId: "tv",
      dueDate: "2026-10-05",
      pastDue: true,
    });
    expect(s.safeToSpend.assumptions).toContain("recurring_past_due_on_card_may_be_in_balance");
    expect(s.safeToSpend.assumptions).toContain("recurring_past_due_assumed_unposted");
  });

  it("is not stated for a cash account, a future charge, or without the card reserve", () => {
    const cash = computeFinancialSummary(input([stream({ streamId: "tv", accountId: "chk", ...late })]));
    expect(cash.safeToSpend.assumptions).not.toContain("recurring_past_due_on_card_may_be_in_balance");
    const future = computeFinancialSummary(input([stream({ streamId: "tv", accountId: "card" })]));
    expect(future.safeToSpend.assumptions).not.toContain("recurring_past_due_on_card_may_be_in_balance");
    const noReserve = computeFinancialSummary(
      input([stream({ streamId: "tv", accountId: "card", ...late })]),
      { ...DEFAULT_POLICY, reserveCreditCardBalances: false }
    );
    expect(noReserve.safeToSpend.assumptions).not.toContain("recurring_past_due_on_card_may_be_in_balance");
  });

  // Red if: the condition goes back to "the account is a card": a card whose
  // balance is not reserved cannot hold the charge a second time.
  it("is not stated for a card whose balance is not reserved, and the charge still counts", () => {
    const i = input([stream({ streamId: "tv", accountId: "card", ...late })]);
    i.accounts = [acct({}), { ...CARD, currentCents: null }];
    const s = computeFinancialSummary(i);
    expect(s.safeToSpend.inputs.creditCardBalances).toEqual([]);
    expect(s.safeToSpend.inputs.upcomingRecurring[0]).toMatchObject({ streamId: "tv", pastDue: true });
    expect(s.safeToSpend.assumptions).toContain("recurring_past_due_assumed_unposted");
    expect(s.safeToSpend.assumptions).not.toContain("recurring_past_due_on_card_may_be_in_balance");
  });
});

describe("pastDue", () => {
  it("marks a recurring item whose next date is before today, and only that", () => {
    const s = computeFinancialSummary(
      input([
        stream({ streamId: "past", predictedNextDate: "2026-10-09", lastDate: "2026-09-09" }),
        stream({ streamId: "today", predictedNextDate: "2026-10-10", lastDate: "2026-09-10" }),
        stream({ streamId: "later", predictedNextDate: "2026-10-20" }),
      ])
    );
    expect(s.recurring.items.map((i) => [i.streamId, i.pastDue])).toEqual([
      ["past", true],
      ["today", false],
      ["later", false],
    ]);
    expect(s.safeToSpend.inputs.upcomingRecurring.map((u) => [u.streamId, u.dueDate, u.pastDue])).toEqual([
      ["past", "2026-10-09", true],
      ["today", "2026-10-10", false],
      ["later", "2026-10-20", false],
    ]);
  });
});
