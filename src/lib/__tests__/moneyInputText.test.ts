import { describe, it, expect } from "vitest";
import {
  MONEY_INPUT_MAX_LENGTH,
  moneyInputAmount,
  moneyInputDigits,
  moneyInputKeyBlocked,
} from "../moneyInputText";
import { MAX_MONTHLY_AMOUNT, MAX_MONTHLY_AMOUNT_DIGITS } from "../surveyMoney";

/**
 * Executes the money input's text rules.
 *
 * Mutations of moneyInputText.ts and the tests each one turns red:
 *   the digit limit removed                       -> MI3, MI4
 *   the cut at the first "." removed              -> MI1, MI2, MI5
 *   rounding instead of cutting                   -> MI2, MI5
 *   leading zeros kept                            -> MI6
 *   maxLength shorter than a formatted amount     -> MI7
 *   the full-field key check without its limit    -> MI10
 *   the full-field key check ignoring selection   -> MI9
 *   the full-field key check removed (never block) -> MI8
 *   the full-field key check blocking non-digits  -> MI11
 */

describe("money input text", () => {
  const cases: Array<[string, number]> = [
    ["1,234.56", 1234],
    ["123,456.78", 123456],
    ["$1,000", 1000],
    ["1234567", 123456],
    [".99", 0],
    ["0012", 12],
  ];

  it.each(cases)("%s -> %d", (text, amount) => {
    expect(moneyInputAmount(text)).toBe(amount);
  });

  it("MI1 cents after a dot are dropped, not added to the whole part", () => {
    expect(moneyInputDigits("1,234.56")).toBe("1234");
  });

  it("MI2 the cut is at the first dot, and it truncates rather than rounds", () => {
    expect(moneyInputDigits("12.99")).toBe("12");
    expect(moneyInputDigits("1.2.3")).toBe("1");
  });

  it("MI3 at most MAX_MONTHLY_AMOUNT_DIGITS digits are kept", () => {
    expect(moneyInputDigits("1234567")).toBe("123456");
    expect(moneyInputDigits("1234567").length).toBe(MAX_MONTHLY_AMOUNT_DIGITS);
  });

  it("MI4 a pasted amount above the cap never exceeds what the server accepts", () => {
    expect(moneyInputAmount("$9,999,999.99")).toBeLessThanOrEqual(
      MAX_MONTHLY_AMOUNT
    );
    expect(moneyInputAmount("$999,999.99")).toBe(MAX_MONTHLY_AMOUNT);
  });

  it("MI5 nothing before the dot leaves no amount", () => {
    expect(moneyInputDigits(".99")).toBe("");
    expect(moneyInputAmount(".99")).toBe(0);
  });

  it("MI6 leading zeros and non-digits are removed", () => {
    expect(moneyInputDigits("0012")).toBe("12");
    expect(moneyInputDigits("$ 0")).toBe("");
    expect(moneyInputDigits("")).toBe("");
  });

  it("MI8 a digit is blocked in a full field with nothing selected", () => {
    expect(moneyInputKeyBlocked("9", "123456", 1, 1)).toBe(true);
    expect(moneyInputKeyBlocked("9", "123456", 6, 6)).toBe(true);
    expect(moneyInputKeyBlocked("9", "123456", null, null)).toBe(true);
  });

  it("MI9 a digit replacing a selection in a full field is allowed", () => {
    expect(moneyInputKeyBlocked("9", "123456", 1, 3)).toBe(false);
    expect(moneyInputKeyBlocked("9", "123456", 0, 6)).toBe(false);
  });

  it("MI10 a digit is allowed below the limit", () => {
    expect(moneyInputKeyBlocked("9", "12345", 5, 5)).toBe(false);
    expect(moneyInputKeyBlocked("9", "", 0, 0)).toBe(false);
  });

  it("MI11 editing keys are never blocked by the limit", () => {
    for (const key of ["Backspace", "Delete", "ArrowLeft", "Home", "End", "Tab"]) {
      expect(moneyInputKeyBlocked(key, "123456", 6, 6)).toBe(false);
    }
  });

  it("MI7 the input's maxLength holds a formatted maximum with cents", () => {
    expect(MONEY_INPUT_MAX_LENGTH).toBeGreaterThanOrEqual(
      ("$" + MAX_MONTHLY_AMOUNT.toLocaleString("en-US") + ".99").length
    );
  });
});
