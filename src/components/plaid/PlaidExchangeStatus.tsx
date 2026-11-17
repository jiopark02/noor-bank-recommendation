"use client";

import React from "react";
import { EXCHANGE_IN_PROGRESS_LABEL } from "@/lib/plaidConnectFlow";
import type { PlaidExchangeView } from "./usePlaidExchange";

interface PlaidExchangeStatusProps {
  exchange: Pick<PlaidExchangeView, "phase" | "notice" | "canRetry" | "retry">;
  /** Classes for the sentence, so it matches the block it sits in. */
  textClassName?: string;
}

const DEFAULT_TEXT_CLASS = "text-sm text-gray-600 text-center mt-3";

/**
 * What a bank connection is doing after Plaid Link closed: a progress line
 * while the exchange runs, then the sentence it ended with, and a button when
 * the same connection can be tried again. Draws nothing when there is nothing
 * to say.
 */
export function PlaidExchangeStatus({
  exchange,
  textClassName = DEFAULT_TEXT_CLASS,
}: PlaidExchangeStatusProps) {
  if (exchange.phase === "exchanging") {
    return (
      <p className={textClassName} role="status">
        {EXCHANGE_IN_PROGRESS_LABEL}
      </p>
    );
  }

  if (exchange.phase !== "notice" || !exchange.notice) {
    return null;
  }

  return (
    <div className="text-center">
      <p className={textClassName} role="alert">
        {exchange.notice}
      </p>
      {exchange.canRetry && (
        <button
          type="button"
          onClick={exchange.retry}
          className="mt-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-black"
        >
          Try again
        </button>
      )}
    </div>
  );
}
