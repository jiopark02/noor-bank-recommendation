import React from "react";
import { bankMonogram } from "./bankMonogramParts";

interface BankMonogramProps {
  /** The bank's name as shown next to the icon; null or blank when unknown. */
  name: string | null | undefined;
}

/**
 * A round icon for a bank: its monogram, or a generic bank icon when the name
 * gives no letter (bankMonogramParts.ts decides). Decorative: the name is always
 * drawn next to it, so it is hidden from assistive technology.
 */
export function BankMonogram({ name }: BankMonogramProps) {
  const { letter, tone } = bankMonogram(name);
  return (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${tone}`}
    >
      {letter ?? (
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z"
          />
        </svg>
      )}
    </span>
  );
}
