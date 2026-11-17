import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { AddBankButton } from "../../components/plaid/AddBankButton";
import {
  BANK_CONNECTION_LIMIT,
  CONNECTION_LIMIT_NOTICE,
  isAtConnectionLimit,
} from "../../components/plaid/connectionLimit";
import { CONNECTION_LIMIT, linkLimitRefusal } from "../plaidExchange";

/**
 * The "add another bank" button below and at the connection limit.
 *
 * The component is rendered to markup: there is no DOM environment here, so
 * this shows what is drawn in each state, not what a press does. A press is
 * still decided by the server (plaidLinkLimit.test.ts, plaidExchange.test.ts).
 * That the money screen passes the length of its connection list is source
 * only.
 *
 * Mutations that turn this file red:
 *   - the browser's limit or sentence differing from the server's
 *                                              -> "the server's limit and sentence"
 *   - `>=` -> `>` in isAtConnectionLimit        -> "at the limit" / render at the limit
 *   - comparing against the limit minus one     -> "below the limit"
 *   - the button left enabled at the limit      -> "disabled, with the sentence"
 *   - the sentence shown below the limit, or the button disabled there
 *                                              -> "enabled, without the sentence"
 */

function render(connectionCount: number): string {
  return renderToStaticMarkup(
    createElement(AddBankButton, {
      userId: "user-1",
      connectionCount,
      onSuccess: () => {},
    })
  );
}

/** The opening tag of the one button in the markup. */
function buttonTag(html: string): string {
  const tags = html.match(/<button\b[^>]*>/g) ?? [];
  expect(tags.length).toBe(1);
  return tags[0];
}

/** The disabled attribute itself, not a `disabled:` class name. */
function isDisabled(tag: string): boolean {
  return / disabled=""/.test(tag);
}

describe("the browser's connection limit", () => {
  it("is the server's limit and sentence", () => {
    expect(BANK_CONNECTION_LIMIT).toBe(CONNECTION_LIMIT);
    expect(CONNECTION_LIMIT_NOTICE).toBe(
      linkLimitRefusal(CONNECTION_LIMIT)?.body.error
    );
    expect(CONNECTION_LIMIT_NOTICE).toContain(String(CONNECTION_LIMIT));
  });

  it("is reached at the limit and above it, not below the limit", () => {
    expect(isAtConnectionLimit(0)).toBe(false);
    expect(isAtConnectionLimit(CONNECTION_LIMIT - 1)).toBe(false);
    expect(isAtConnectionLimit(CONNECTION_LIMIT)).toBe(true);
    expect(isAtConnectionLimit(CONNECTION_LIMIT + 1)).toBe(true);
  });
});

describe("AddBankButton", () => {
  it("below the limit: enabled, without the sentence", () => {
    const html = render(CONNECTION_LIMIT - 1);
    expect(html).toContain("+ Add another bank");
    expect(isDisabled(buttonTag(html))).toBe(false);
    expect(html).not.toContain(CONNECTION_LIMIT_NOTICE);
  });

  it("at the limit: disabled, with the sentence, before any press", () => {
    const html = render(CONNECTION_LIMIT);
    expect(html).toContain("+ Add another bank");
    expect(isDisabled(buttonTag(html))).toBe(true);
    expect(html).toContain(CONNECTION_LIMIT_NOTICE);
  });

  it("above the limit: disabled, with the sentence", () => {
    const html = render(CONNECTION_LIMIT + 1);
    expect(isDisabled(buttonTag(html))).toBe(true);
    expect(html).toContain(CONNECTION_LIMIT_NOTICE);
  });

  it("ties the disabled button to the sentence that explains it", () => {
    const html = render(CONNECTION_LIMIT);
    const described = /aria-describedby="([^"]+)"/.exec(buttonTag(html));
    expect(described).not.toBeNull();
    expect(html).toContain(`<p id="${described?.[1]}"`);
  });
});
