import { describe, expect, it } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderInlineBold, splitInlineBold } from "../inlineBold";

/**
 * Bold marks in drawn text: only a matched `**text**` pair becomes a
 * `<strong>` element, and the text is never read as HTML.
 */

function html(text: string): string {
  return renderToStaticMarkup(createElement(Fragment, null, ...renderInlineBold(text)));
}

describe("splitInlineBold", () => {
  it("a matched pair becomes one bold segment between plain ones", () => {
    expect(splitInlineBold("Start an **emergency fund** first")).toEqual([
      { text: "Start an ", bold: false },
      { text: "emergency fund", bold: true },
      { text: " first", bold: false },
    ]);
  });

  it("a pair can fill the whole text", () => {
    expect(splitInlineBold("**Tip:**")).toEqual([{ text: "Tip:", bold: true }]);
  });

  it("a mark with no partner stays as written", () => {
    expect(splitInlineBold("rate ** high")).toEqual([{ text: "rate ** high", bold: false }]);
    expect(splitInlineBold("**open only")).toEqual([{ text: "**open only", bold: false }]);
  });

  it("a mark left over after a pair stays as written", () => {
    expect(splitInlineBold("**a** and ** b")).toEqual([
      { text: "a", bold: true },
      { text: " and ** b", bold: false },
    ]);
  });

  it("several pairs each become bold", () => {
    expect(splitInlineBold("**Rent** then **savings** then **fun**")).toEqual([
      { text: "Rent", bold: true },
      { text: " then ", bold: false },
      { text: "savings", bold: true },
      { text: " then ", bold: false },
      { text: "fun", bold: true },
    ]);
  });

  it("an empty pair stays as written", () => {
    expect(splitInlineBold("****")).toEqual([{ text: "****", bold: false }]);
    expect(splitInlineBold("a **** b")).toEqual([{ text: "a **** b", bold: false }]);
  });

  it("marks with whitespace inside the pair are not a pair, and a later pair still is", () => {
    expect(splitInlineBold("2 ** 3 and **x**")).toEqual([
      { text: "2 ** 3 and ", bold: false },
      { text: "x", bold: true },
    ]);
    expect(splitInlineBold("** spaced **")).toEqual([{ text: "** spaced **", bold: false }]);
  });

  it("other markdown marks stay as written", () => {
    expect(splitInlineBold("*one* `code` # head [l](u)")).toEqual([
      { text: "*one* `code` # head [l](u)", bold: false },
    ]);
  });

  it("text without marks, and empty text", () => {
    expect(splitInlineBold("plain")).toEqual([{ text: "plain", bold: false }]);
    expect(splitInlineBold("")).toEqual([]);
  });
});

describe("renderInlineBold", () => {
  it("draws a pair as <strong> and the rest as text", () => {
    expect(html("Pay **$120** today")).toBe("Pay <strong>$120</strong> today");
  });

  it("angle brackets stay text, inside and outside a pair", () => {
    const out = html("**<script>alert(1)</script>** and <img src=x onerror=alert(1)>");
    expect(out).toBe(
      "<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong> and &lt;img src=x onerror=alert(1)&gt;"
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
  });

  it("an unmatched mark is drawn as the two characters", () => {
    expect(html("a ** b")).toBe("a ** b");
  });
});
