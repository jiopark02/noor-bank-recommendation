import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectBankCard } from "../../components/plaid/PlaidLink";
import { PlaidExchangeStatus } from "../../components/plaid/PlaidExchangeStatus";
import {
  EXCHANGE_IN_PROGRESS_LABEL,
  EXCHANGE_RETRY_MESSAGE,
} from "../plaidConnectFlow";
import type { PlaidExchangeView } from "../../components/plaid/usePlaidExchange";

/**
 * What the exchange status draws, rendered to markup: there is no DOM here,
 * so this shows the line and its classes in each phase, not a press.
 *
 * Mutations that turn this file red:
 *   - the progress line given the sentence's classes again        -> "progress is not drawn in the failure colour"
 *   - the connect card passing a failure colour for progress      -> "progress is not drawn in the failure colour"
 *   - the card's failure sentence losing its colour               -> "the sentence keeps the block's colour"
 *   - the retry button drawn without a held token, or not with one -> "the retry button"
 */

function view(overrides: Partial<PlaidExchangeView>): PlaidExchangeView {
  return {
    phase: "idle",
    notice: null,
    canRetry: false,
    onLinkSuccess: () => {},
    retry: () => {},
    ...overrides,
  };
}

/** The opening tag of the element whose text is `text`. */
function tagOf(html: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "(?:'|&#x27;)");
  const match = new RegExp(`<p\\b([^>]*)>${escaped}</p>`).exec(html);
  expect(match, `no <p> with the text "${text}"`).not.toBeNull();
  return match ? match[1] : "";
}

const card = (exchange: PlaidExchangeView): string =>
  renderToStaticMarkup(createElement(ConnectBankCard, { userId: "user-1", exchange }));

describe("the exchange status", () => {
  it("progress is not drawn in the failure colour, in the card or on its own", () => {
    const exchanging = view({ phase: "exchanging" });

    const inCard = tagOf(card(exchanging), EXCHANGE_IN_PROGRESS_LABEL);
    expect(inCard).toContain('role="status"');
    expect(inCard).not.toMatch(/red/);
    expect(inCard).toContain("text-gray-600");

    // A block that colours its sentence as a failure does not colour progress.
    const alone = tagOf(
      renderToStaticMarkup(
        createElement(PlaidExchangeStatus, {
          exchange: exchanging,
          textClassName: "text-sm text-red-500",
        })
      ),
      EXCHANGE_IN_PROGRESS_LABEL
    );
    expect(alone).not.toMatch(/red/);
  });

  it("the sentence keeps the block's colour: the failure colour in the card", () => {
    const failed = view({ phase: "notice", notice: EXCHANGE_RETRY_MESSAGE, canRetry: true });

    const inCard = tagOf(card(failed), EXCHANGE_RETRY_MESSAGE);
    expect(inCard).toContain('role="alert"');
    expect(inCard).toContain("text-red-500");
    expect(card(failed)).not.toContain(EXCHANGE_IN_PROGRESS_LABEL);
  });

  it("the retry button is drawn only while the token is held", () => {
    const render = (canRetry: boolean) =>
      renderToStaticMarkup(
        createElement(PlaidExchangeStatus, {
          exchange: view({ phase: "notice", notice: EXCHANGE_RETRY_MESSAGE, canRetry }),
        })
      );
    // The sentence itself ends in "Try again.", so the button is what is read.
    expect(render(true)).toMatch(/<button\b[^>]*>Try again<\/button>/);
    expect(render(false)).not.toContain("<button");
    expect(
      renderToStaticMarkup(createElement(PlaidExchangeStatus, { exchange: view({}) }))
    ).toBe("");
  });
});
