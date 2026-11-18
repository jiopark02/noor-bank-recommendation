import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { BankMonogram } from "../../components/plaid/BankMonogram";
import {
  BANK_MONOGRAM_TONES,
  bankMonogram,
} from "../../components/plaid/bankMonogramParts";

/**
 * The bank icon: a monogram from the name, or a generic icon when the name
 * gives no letter. The rules are executed on the helper; the component is
 * rendered to markup (there is no DOM environment here), which shows what it
 * draws but not how it looks in a browser.
 *
 * Mutations that turn this file red:
 *   - the tone taken from anything but the name (a counter, a random pick)
 *                                                    -> "same name, same parts"
 *   - the tone hashed from the name as typed          -> "ignores case and spaces"
 *   - the letter not upper-cased                      -> "upper case"
 *   - any first character accepted as a letter        -> "not an English letter"
 *   - a blank name throwing, or giving a letter       -> "missing or blank"
 *   - the component drawing a letter and the icon, or neither
 *                                                    -> the render tests
 */

describe("bankMonogram", () => {
  it("same name, same parts", () => {
    const names = ["Chase", "Bank of America", "Wells Fargo", "1st Source Bank", ""];
    for (const name of names) {
      expect(bankMonogram(name)).toEqual(bankMonogram(name));
    }
    expect(bankMonogram("Chase")).toEqual({
      letter: "C",
      tone: bankMonogram("Chase").tone,
    });
  });

  it("ignores case and surrounding spaces when choosing the tone", () => {
    expect(bankMonogram("  chase ").tone).toBe(bankMonogram("Chase").tone);
    expect(bankMonogram("CHASE").tone).toBe(bankMonogram("Chase").tone);
  });

  it("always picks a tone from the list, and not the same one for every name", () => {
    const tones: Record<string, true> = {};
    const names = [
      "Chase",
      "Bank of America",
      "Wells Fargo",
      "Citibank",
      "Capital One",
      "US Bank",
      "PNC",
      "Ally Bank",
      "Discover",
      "Navy Federal Credit Union",
      "",
      "360 Bank",
    ];
    for (const name of names) {
      const tone = bankMonogram(name).tone;
      expect(BANK_MONOGRAM_TONES).toContain(tone);
      tones[tone] = true;
    }
    expect(Object.keys(tones).length).toBeGreaterThan(1);
  });

  it("gives the first letter in upper case", () => {
    expect(bankMonogram("chase").letter).toBe("C");
    expect(bankMonogram("Wells Fargo").letter).toBe("W");
    expect(bankMonogram("  ally bank").letter).toBe("A");
  });

  it("gives no letter when the first character is not an English letter", () => {
    expect(bankMonogram("1st Source Bank").letter).toBeNull();
    expect(bankMonogram("360 Bank").letter).toBeNull();
    expect(bankMonogram("#1 Credit Union").letter).toBeNull();
    expect(bankMonogram("Élan Financial").letter).toBeNull();
    expect(bankMonogram("은행").letter).toBeNull();
  });

  it("gives no letter, and still a tone, for a missing or blank name", () => {
    for (const name of ["", "   ", null, undefined]) {
      const parts = bankMonogram(name);
      expect(parts.letter).toBeNull();
      expect(BANK_MONOGRAM_TONES).toContain(parts.tone);
    }
    expect(bankMonogram(null)).toEqual(bankMonogram(""));
    expect(bankMonogram("   ")).toEqual(bankMonogram(""));
  });
});

describe("BankMonogram", () => {
  function render(name: string | null): string {
    return renderToStaticMarkup(createElement(BankMonogram, { name }));
  }

  it("draws the letter on the name's tone, and no icon or image", () => {
    const html = render("Chase");
    expect(html).toContain(">C</span>");
    expect(html).toContain(bankMonogram("Chase").tone);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img");
  });

  it("draws the generic icon, and no letter or image, when there is no letter", () => {
    for (const name of ["360 Bank", "", null]) {
      const html = render(name);
      expect(html).toContain("<svg");
      expect(html).toContain(bankMonogram(name).tone);
      expect(html).not.toContain("<img");
      expect(html.replace(/<[^>]*>/g, "")).toBe("");
    }
  });

  it("is hidden from assistive technology, since the name is drawn beside it", () => {
    expect(render("Chase")).toContain('aria-hidden="true"');
  });
});
