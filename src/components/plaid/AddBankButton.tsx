"use client";

import React from "react";
import { PlaidLinkButton } from "./PlaidLink";
import { CONNECTION_LIMIT_NOTICE, isAtConnectionLimit } from "./connectionLimit";

const ADD_BANK_LABEL = "+ Add another bank";
const ADD_BANK_CLASS =
  "w-full py-3 border border-gray-300 text-black font-medium rounded-xl disabled:opacity-50 transition-all";
const LIMIT_NOTICE_ID = "add-bank-limit-notice";

interface AddBankButtonProps {
  userId: string;
  /** Every connection in the user's list, whatever its status. */
  connectionCount: number;
  onSuccess: React.ComponentProps<typeof PlaidLinkButton>["onSuccess"];
  /** Drawn disabled while an earlier connection is still being exchanged. */
  disabled?: boolean;
}

/**
 * The compact "add another bank" button under the connection list.
 *
 * At the connection limit it is drawn disabled, with the reason under it, so
 * the limit is visible before a press instead of only in the refusal after
 * one. The disabled button is a plain button, not the Link button: nothing is
 * requested and Link cannot open from it. Below the limit it is the Link
 * button unchanged, and the server's own checks still decide every attempt.
 */
export function AddBankButton({
  userId,
  connectionCount,
  onSuccess,
  disabled = false,
}: AddBankButtonProps) {
  if (isAtConnectionLimit(connectionCount)) {
    return (
      <>
        <button
          type="button"
          disabled
          aria-describedby={LIMIT_NOTICE_ID}
          className={`${ADD_BANK_CLASS} disabled:cursor-not-allowed`}
        >
          {ADD_BANK_LABEL}
        </button>
        <p id={LIMIT_NOTICE_ID} className="text-xs text-gray-600 mt-2">
          {CONNECTION_LIMIT_NOTICE}
        </p>
      </>
    );
  }

  return (
    <PlaidLinkButton
      userId={userId}
      onSuccess={onSuccess}
      disabled={disabled}
      className={ADD_BANK_CLASS}
    >
      {ADD_BANK_LABEL}
    </PlaidLinkButton>
  );
}
