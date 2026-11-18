import { describe, it, expect } from "vitest";
import {
  NEXT_ACTION_BANK_NEEDS_ATTENTION,
  NEXT_ACTION_KINDS,
  NEXT_ACTION_NOTHING_TO_MOVE,
  NEXT_ACTION_NOT_ENOUGH_DATA,
  NO_CASH_ACCOUNT_HINT,
  decideBankView,
  formatCents,
  missingBanksNote,
  nextActionCard,
  safeToSpendHorizonPhrase,
  spendableCashTile,
  type BankView,
  type NextActionCard,
  type ScreenNextAction,
  type ScreenSummary,
  type ScreenSummaryResponse,
} from "../bankSummaryView";

/**
 * The dashboard's next-step line (nextActionCard), executed: when a line is
 * drawn, and what each sentence may say.
 *
 * Mutations that turn this file red:
 *   - a line drawn while the figures are loading, unavailable or absent
 *                                                   -> "nothing unless the figures are ready"
 *   - a step whose amount rests on the safe-to-spend balances drawn
 *     while the safe-to-spend figure is held back   -> "only where safe-to-spend is shown"
 *   - a sentence built from the safe-to-spend amount, or any amount
 *     but the picked step's                         -> "names the picked amount and no other"
 *   - the could-not-compute step worded without looking at the banks
 *     that were not read                            -> "follows what the screen already decided"
 *   - a sentence drawn when the engine picked nothing
 *                                                   -> "no step picked"
 *   - a sentence saying the app moves money, or stating a rate
 *                                                   -> "what no sentence says"
 *   - the checking-account line chosen by anything but the test the
 *     spendable-cash tile uses                      -> "asks for a checking account exactly when the tile does"
 *   - the safe-to-spend step drawn without looking at its amount
 *                                                   -> "the safe-to-spend step is drawn only with an amount above zero"
 *   - the recurring-charges step drawn while a bank was not read
 *                                                   -> "is not drawn while a bank was not read"
 */

type Kind = (typeof NEXT_ACTION_KINDS)[number];

const HORIZON = { to: "2026-11-20", rule: "next_income_date" } as const;
/** The safe-to-spend figure of every summary here; no picked amount equals it. */
const SAFE_TO_SPEND_CENTS = 73500;
const CASH_CENTS = 100000;
const CUSHION_CENTS = 75000;
const PICKED_CENTS = 12345;

function computed(over: { recurringKnown?: boolean } = {}): ScreenSummary {
  return {
    coverage: { safeToSpendShowable: true },
    cashFlow: { incomeCents: 250000, spendingNetCents: 4000, period: { completeness: "complete" } },
    safeToSpend: {
      status: "computed",
      reason: null,
      amountCents: SAFE_TO_SPEND_CENTS,
      horizon: { ...HORIZON },
      totals: { spendableCashCents: CASH_CENTS, cushionFloorCents: CUSHION_CENTS },
    },
    recurring:
      over.recurringKnown === false
        ? { totalMonthlyCents: null, items: [] }
        : { totalMonthlyCents: 4321, items: [] },
    creditUtilization: { accounts: [] },
    cashBalanceCents: null,
  };
}

function notComputed(reason: string): ScreenSummary {
  return {
    ...computed({ recurringKnown: false }),
    coverage: { safeToSpendShowable: false },
    safeToSpend: { status: "unavailable", reason, amountCents: null, horizon: null, totals: null },
  };
}

const READY: BankView = { figures: "ready", showSafeToSpend: true, actions: [], missingFrom: [] };
const HELD_BACK: BankView = { ...READY, showSafeToSpend: false };
const BANK_NOT_READ: BankView = {
  figures: "ready",
  showSafeToSpend: false,
  actions: [{ kind: "relink", itemId: "item-2", institutionName: "Bank 2" }],
  missingFrom: ["Bank 2"],
};

function picked(kind: Kind, amountCents: number | null = PICKED_CENTS): ScreenNextAction {
  return { reason: kind === "fix_connection" ? "data_incomplete" : "best", pick: { kind, amountCents } };
}

const HIDDEN: NextActionCard = { kind: "hidden" };
const A = formatCents(PICKED_CENTS);
const REACH = safeToSpendHorizonPhrase(HORIZON);

function textOf(card: NextActionCard): string {
  if (card.kind !== "line") throw new Error("expected a line");
  return card.text;
}

/** Every sentence the helper can draw, one per case. */
function everySentence(): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  for (let i = 0; i < NEXT_ACTION_KINDS.length; i++) {
    const kind = NEXT_ACTION_KINDS[i];
    if (kind === "fix_connection") continue;
    out.push({ name: kind, text: textOf(nextActionCard(READY, computed(), picked(kind))) });
  }
  out.push({
    name: "fix_connection, a bank not read",
    text: textOf(
      nextActionCard(BANK_NOT_READ, notComputed("history_incomplete"), picked("fix_connection", null))
    ),
  });
  out.push({
    name: "fix_connection, no cash account",
    text: textOf(
      nextActionCard(HELD_BACK, notComputed("no_cash_account"), picked("fix_connection", null))
    ),
  });
  out.push({
    name: "fix_connection, other",
    text: textOf(
      nextActionCard(HELD_BACK, notComputed("recurring_empty_unknown"), picked("fix_connection", null))
    ),
  });
  return out;
}

describe("nextActionCard — when a line is drawn", () => {
  it("nothing unless the figures are ready", () => {
    for (const figures of ["loading", "unavailable", "none"] as const) {
      for (let i = 0; i < NEXT_ACTION_KINDS.length; i++) {
        const view: BankView = { ...READY, figures };
        expect(nextActionCard(view, computed(), picked(NEXT_ACTION_KINDS[i])), figures).toEqual(HIDDEN);
      }
    }
    expect(nextActionCard(READY, null, picked("safe_spend"))).toEqual(HIDDEN);
    expect(nextActionCard(READY, computed(), null)).toEqual(HIDDEN);
  });

  // "no step picked". The engine having nothing to suggest is not put into
  // words, whatever reason comes with it.
  it("no step picked: nothing is drawn", () => {
    for (const reason of ["nothing_to_do", "data_incomplete", "best", "kept_current"] as const) {
      expect(nextActionCard(READY, computed(), { reason, pick: null }), reason).toEqual(HIDDEN);
    }
  });

  it("only where safe-to-spend is shown: a step resting on its balances is not drawn while it is held back", () => {
    const gated: Kind[] = ["cover_bills", "move_to_checking", "move_to_emergency", "pay_card", "safe_spend"];
    for (const kind of gated) {
      expect(nextActionCard(READY, computed(), picked(kind)).kind, kind).toBe("line");
      // Held back by the screen, though the figure itself was computed.
      expect(nextActionCard(HELD_BACK, computed(), picked(kind)), kind).toEqual(HIDDEN);
      // A bank was not read.
      expect(nextActionCard(BANK_NOT_READ, computed(), picked(kind)), kind).toEqual(HIDDEN);
      // Not computed at all.
      expect(nextActionCard(READY, notComputed("stale_balance"), picked(kind)), kind).toEqual(HIDDEN);
    }
  });

  it("a step that needs an amount is not drawn without a positive one", () => {
    const needs: Kind[] = ["cover_bills", "move_to_checking", "move_to_emergency", "pay_card", "review_recurring"];
    for (const kind of needs) {
      for (const amount of [null, 0, -500]) {
        expect(nextActionCard(READY, computed(), picked(kind, amount)), `${kind} ${amount}`).toEqual(HIDDEN);
      }
    }
  });

  it("the recurring-charges step follows whether recurring charges are known, not the safe-to-spend gate", () => {
    const text = textOf(nextActionCard(HELD_BACK, computed(), picked("review_recurring")));
    expect(text).toContain(A);
    expect(
      nextActionCard(READY, computed({ recurringKnown: false }), picked("review_recurring"))
    ).toEqual(HIDDEN);
  });

  // Red if: the safe-to-spend step is drawn whatever amount came with it.
  it("the safe-to-spend step is drawn only with an amount above zero", () => {
    expect(nextActionCard(READY, computed(), picked("safe_spend", 1))).toEqual({
      kind: "line",
      text: NEXT_ACTION_NOTHING_TO_MOVE,
    });
    for (const amount of [null, 0, -1, -500]) {
      expect(nextActionCard(READY, computed(), picked("safe_spend", amount)), String(amount)).toEqual(HIDDEN);
    }
  });

  // Red if: the recurring-charges step stops looking at the banks that were
  // not read. The view comes from decideBankView, so the test the card uses
  // is held to the one the screen draws its per-bank steps and its
  // missing-bank line under.
  it("the recurring-charges step is not drawn while a bank was not read", () => {
    const response = (second: "ok" | "login_required" | "syncing" | "failed"): ScreenSummaryResponse => ({
      connections: [
        { itemId: "item-1", institutionName: "Bank 1", status: "ok" },
        { itemId: "item-2", institutionName: "Bank 2", status: second },
      ],
      accounts: [],
      summary: computed(),
    });
    const viewOf = (r: ScreenSummaryResponse): BankView =>
      decideBankView({ hasActiveConnection: true, fetchState: "loaded", response: r });

    const allRead = viewOf(response("ok"));
    expect(allRead.actions).toEqual([]);
    expect(missingBanksNote(allRead.missingFrom)).toBeNull();
    expect(textOf(nextActionCard(allRead, computed(), picked("review_recurring")))).toContain(A);

    for (const status of ["login_required", "syncing", "failed"] as const) {
      const view = viewOf(response(status));
      // Both marks of a bank that was not read are on the screen.
      expect(view.actions.length, status).toBeGreaterThan(0);
      expect(missingBanksNote(view.missingFrom), status).not.toBeNull();
      expect(nextActionCard(view, computed(), picked("review_recurring")), status).toEqual(HIDDEN);
    }
  });
});

describe("nextActionCard — the step picked when safe-to-spend could not be computed", () => {
  const next = picked("fix_connection", null);

  // Red if: the line is chosen from the grouped reason safe-to-spend is not
  // shown for, which also covers a checking account that is linked but has no
  // balance to spend.
  it("asks for a checking account exactly when the tile does", () => {
    const reasons = [
      "no_cash_account",
      "no_spendable_balance",
      "null_balance",
      "stale_balance",
      "recurring_empty_unknown",
      "recurring_unavailable",
      "recurring_amount_unknown",
      "history_incomplete",
      "non_usd_account",
    ];
    let asked = 0;
    for (const reason of reasons) {
      const summary = notComputed(reason);
      const tileAsks = spendableCashTile(summary).kind === "no_cash_account";
      const text = textOf(nextActionCard(HELD_BACK, summary, next));
      expect(text === NO_CASH_ACCOUNT_HINT, reason).toBe(tileAsks);
      if (!tileAsks) expect(text, reason).toBe(NEXT_ACTION_NOT_ENOUGH_DATA);
      if (tileAsks) asked++;
    }
    expect(asked).toBe(1);
    // A checking account that is linked but has nothing to spend is not a
    // missing one.
    expect(nextActionCard(HELD_BACK, notComputed("no_spendable_balance"), next)).toEqual({
      kind: "line",
      text: NEXT_ACTION_NOT_ENOUGH_DATA,
    });
  });

  it("follows what the screen already decided: a bank that was not read points at its steps", () => {
    expect(nextActionCard(BANK_NOT_READ, notComputed("history_incomplete"), next)).toEqual({
      kind: "line",
      text: NEXT_ACTION_BANK_NEEDS_ATTENTION,
    });
  });

  it("with every bank read, the line follows the reason the figure is not shown", () => {
    expect(nextActionCard(HELD_BACK, notComputed("no_cash_account"), next)).toEqual({
      kind: "line",
      text: NO_CASH_ACCOUNT_HINT,
    });
    for (const reason of ["recurring_empty_unknown", "recurring_unavailable", "stale_balance", "history_incomplete"]) {
      const card = nextActionCard(HELD_BACK, notComputed(reason), next);
      expect(card, reason).toEqual({ kind: "line", text: NEXT_ACTION_NOT_ENOUGH_DATA });
      // No bank is named as needing attention when none does.
      expect(card, reason).not.toEqual({ kind: "line", text: NEXT_ACTION_BANK_NEEDS_ATTENTION });
    }
  });

  it("is not drawn beside a safe-to-spend figure that is shown", () => {
    expect(nextActionCard(READY, computed(), next)).toEqual(HIDDEN);
  });

  it("names no amount, even when one is sent with it", () => {
    const withAmount = picked("fix_connection", PICKED_CENTS);
    for (const [view, summary] of [
      [BANK_NOT_READ, notComputed("history_incomplete")],
      [HELD_BACK, notComputed("no_cash_account")],
      [HELD_BACK, notComputed("stale_balance")],
    ] as const) {
      expect(textOf(nextActionCard(view, summary, withAmount))).not.toMatch(/\$|\d/);
    }
  });
});

describe("nextActionCard — the sentences", () => {
  it("each kind's sentence", () => {
    const say = (kind: Kind) => textOf(nextActionCard(READY, computed(), picked(kind)));
    expect(say("cover_bills")).toBe(
      `Bills and payments coming up ${REACH} come to about ${A} more than the cash in your checking. ` +
        `Adding ${A} before then would cover them.`
    );
    expect(say("move_to_checking")).toBe(
      `Bills and payments coming up ${REACH} come to about ${A} more than the cash in your checking. ` +
        `You could move ${A} over from your savings to cover them.`
    );
    expect(say("move_to_emergency")).toBe(
      `You have about ${A} beyond what your bills and usual spending need. ` +
        "You could move it into savings as an emergency cushion."
    );
    expect(say("pay_card")).toBe(`You could put about ${A} toward your credit card balance.`);
    expect(say("review_recurring")).toBe(
      `About ${A} a month goes to subscriptions and other optional recurring charges. ` +
        "It's worth checking you still want them all."
    );
    expect(say("safe_spend")).toBe(NEXT_ACTION_NOTHING_TO_MOVE);
    expect(REACH).toBe("until your next income on Nov 20");
  });

  it("the same sentence whether the engine calls its pick the best or the one it kept", () => {
    const kept: ScreenNextAction = { reason: "kept_current", pick: { kind: "pay_card", amountCents: PICKED_CENTS } };
    expect(nextActionCard(READY, computed(), kept)).toEqual(
      nextActionCard(READY, computed(), picked("pay_card"))
    );
  });

  // Red if: a sentence takes its amount from the safe-to-spend figure, the
  // cash, the cushion or the recurring total instead of the picked step.
  it("names the picked amount and no other", () => {
    const others = [SAFE_TO_SPEND_CENTS, CASH_CENTS, CUSHION_CENTS, 4321].map(formatCents);
    const sentences = everySentence();
    expect(sentences).toHaveLength(NEXT_ACTION_KINDS.length + 2);
    for (const { name, text } of sentences) {
      const amounts = text.match(/\$[\d,]+(?:\.\d+)?/g) ?? [];
      for (const amount of amounts) expect(amount, name).toBe(A);
      for (const other of others) expect(text, name).not.toContain(other);
    }
    // The step that is the safe-to-spend figure names no amount at all.
    expect(textOf(nextActionCard(READY, computed(), picked("safe_spend")))).not.toMatch(/\$|\d/);
  });

  // "what no sentence says".
  it("no sentence says the app moves money, states a rate or an expected return, or names a bank", () => {
    for (const { name, text } of everySentence()) {
      expect(text, name).not.toMatch(/\b(Noor|we|I)('ll| will)? (move|transfer|pay)\b/i);
      expect(text, name).not.toMatch(/%|APY|APR|interest/i);
      expect(text, name).not.toMatch(/Bank 2|item-2/);
      expect(text, name).not.toMatch(/\bearn|\byield|\breturn/i);
    }
  });
});
