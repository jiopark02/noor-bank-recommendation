// =============================================================================
// What stands in for a bank's logo: the first letter of its name on a
// background tone chosen from the name. No React and no network here, so the
// rules run in a test without a DOM. No institution logo image is loaded
// anywhere; this is the only bank icon.
//
//   - The letter is the first character of the trimmed name when that is an
//     English letter, in upper case. Any other first character (a digit, a
//     symbol, a letter outside A-Z) and a missing or blank name give no
//     letter, and the component draws a generic bank icon instead.
//   - The tone depends on the name alone, compared without regard to case or
//     surrounding spaces, so one bank has one tone on every screen and in
//     every session.
// =============================================================================

/**
 * Background and text classes, from the `noor` colours in tailwind.config.ts.
 * Each pair keeps the letter readable on its background. The class names are
 * written out in full because Tailwind only generates classes it finds as
 * whole strings in the files it scans.
 */
export const BANK_MONOGRAM_TONES: readonly string[] = [
  "bg-noor-black text-noor-white",
  "bg-noor-gray-600 text-noor-white",
  "bg-noor-gray-500 text-noor-white",
  "bg-noor-gray-400 text-noor-black",
  "bg-noor-gray-300 text-noor-black",
  "bg-noor-gray-200 text-noor-black",
];

export interface BankMonogramParts {
  /** One upper-case English letter, or null when a generic icon is drawn. */
  letter: string | null;
  /** One entry of BANK_MONOGRAM_TONES. */
  tone: string;
}

const ENGLISH_LETTER = /^[A-Za-z]$/;

/** A non-negative integer from the text, the same for the same text. */
function hashText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function bankMonogram(name: string | null | undefined): BankMonogramParts {
  const trimmed = typeof name === "string" ? name.trim() : "";
  const first = trimmed.charAt(0);
  return {
    letter: ENGLISH_LETTER.test(first) ? first.toUpperCase() : null,
    tone: BANK_MONOGRAM_TONES[
      hashText(trimmed.toLowerCase()) % BANK_MONOGRAM_TONES.length
    ],
  };
}
