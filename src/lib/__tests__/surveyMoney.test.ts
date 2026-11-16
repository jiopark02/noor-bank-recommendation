import { describe, it, expect } from "vitest";
import {
  INVALID_MONTHLY_INCOME_MESSAGE,
  INVALID_MONTHLY_SPENDING_MESSAGE,
  MAX_MONTHLY_AMOUNT,
  MAX_MONTHLY_AMOUNT_DIGITS,
  checkSurveyMoney,
  isValidMonthlyAmount,
} from "../surveyMoney";

/**
 * The monthly amount rule, executed.
 *
 * Mutations of surveyMoney.ts and the tests each one turns red:
 *   B1  a numeric string accepted (Number(v))                 -> T1 "1500"
 *   B2  the whole-number check removed                        -> T1 1500.5
 *   B3  > 0 loosened to >= 0                                  -> T1 0, -0
 *   B4  the upper bound removed, or <= made <                 -> T1 1000000 / 999999
 *   B5  the isFinite check removed                            -> T2 Infinity
 *   B11 insert treated like update (missing keys allowed)     -> T3
 *   B12 update requiring keys it was not sent                 -> T4
 *   B13 a present null ignored on update                      -> T1 null (update)
 *   B14 expected_monthly_spending not checked                 -> T5
 *       the message text or its number format changed         -> MSG1
 */

const BODY = { monthly_income: 2000, monthly_budget: 1500 };

describe("isValidMonthlyAmount and checkSurveyMoney", () => {
  it.each<[string, unknown, boolean]>([
    ["1500", 1500, true],
    ['"1500"', "1500", false],
    ["1500.5", 1500.5, false],
    ["0", 0, false],
    ["-1", -1, false],
    ["-0", -0, false],
    ["999999", 999999, true],
    ["1000000", 1000000, false],
    ["null", null, false],
    ["true", true, false],
    ["{}", {}, false],
    ["[]", [], false],
  ])("T1 %s: valid=%s, the same under insert and update", (_, value, valid) => {
    expect(isValidMonthlyAmount(value)).toBe(valid);
    for (const mode of ["insert", "update"] as const) {
      const income = checkSurveyMoney({ ...BODY, monthly_income: value }, mode);
      expect(income.ok, `${mode} monthly_income`).toBe(valid);
      const budget = checkSurveyMoney({ ...BODY, monthly_budget: value }, mode);
      expect(budget.ok, `${mode} monthly_budget`).toBe(valid);
    }
  });

  it("T2 NaN and Infinity are refused when passed directly", () => {
    expect(isValidMonthlyAmount(NaN)).toBe(false);
    expect(isValidMonthlyAmount(Infinity)).toBe(false);
    expect(isValidMonthlyAmount(-Infinity)).toBe(false);
    // A raw body of 1e400 arrives as Infinity.
    expect(checkSurveyMoney(JSON.parse('{"monthly_income":1e400,"monthly_budget":1}'), "insert").ok).toBe(false);
  });

  it("T3 insert requires monthly_income and monthly_budget", () => {
    expect(checkSurveyMoney({ monthly_budget: 1500 }, "insert")).toEqual({
      ok: false,
      field: "monthly_income",
      message: INVALID_MONTHLY_INCOME_MESSAGE,
    });
    expect(checkSurveyMoney({ monthly_income: 2000 }, "insert")).toEqual({
      ok: false,
      field: "monthly_budget",
      message: INVALID_MONTHLY_SPENDING_MESSAGE,
    });
    expect(checkSurveyMoney({}, "insert").ok).toBe(false);
    expect(checkSurveyMoney(null, "insert").ok).toBe(false);
    // expected_monthly_spending may be absent: it is derived from monthly_budget.
    expect(checkSurveyMoney(BODY, "insert")).toEqual({ ok: true });
  });

  it("T4 update checks only the keys that are present", () => {
    expect(checkSurveyMoney({}, "update")).toEqual({ ok: true });
    expect(checkSurveyMoney({ first_name: "Ann" }, "update")).toEqual({ ok: true });
    expect(checkSurveyMoney({ monthly_income: 2000 }, "update")).toEqual({ ok: true });
    expect(checkSurveyMoney({ monthly_budget: 0 }, "update").ok).toBe(false);
  });

  it("T5 expected_monthly_spending is checked whenever its key is present", () => {
    for (const mode of ["insert", "update"] as const) {
      expect(
        checkSurveyMoney({ ...BODY, expected_monthly_spending: "900" }, mode)
      ).toEqual({
        ok: false,
        field: "expected_monthly_spending",
        message: INVALID_MONTHLY_SPENDING_MESSAGE,
      });
      expect(
        checkSurveyMoney({ ...BODY, expected_monthly_spending: null }, mode).ok
      ).toBe(false);
      expect(
        checkSurveyMoney({ ...BODY, expected_monthly_spending: 900 }, mode)
      ).toEqual({ ok: true });
    }
  });

  it("T6 the cap is 999999 and the page's digit limit matches it", () => {
    expect(MAX_MONTHLY_AMOUNT).toBe(999999);
    expect(MAX_MONTHLY_AMOUNT_DIGITS).toBe(6);
  });

  it("MSG1 the messages are fixed text with an en-US number", () => {
    expect(INVALID_MONTHLY_INCOME_MESSAGE).toBe(
      "Please enter your monthly income as a whole number from 1 to 999,999."
    );
    expect(INVALID_MONTHLY_SPENDING_MESSAGE).toBe(
      "Please enter your monthly spending as a whole number from 1 to 999,999."
    );
  });
});
