/**
 * memoryOutputFilter — finds SSN-shaped and card-number-shaped strings in text
 * that is about to be stored as AI memory (chat summaries and user facts).
 * Pure: no I/O, no logging. aiMemory.ts decides what to do with a match: a
 * summary is stored with the match masked, a fact is not stored at all.
 *
 * WHAT COUNTS AS A MATCH
 * Text is first split into digit runs: digit groups joined by single spaces or
 * hyphens ("4111 1111 1111 1111", "123-45-6789", "94110"). A digit group that
 * is part of a larger number — a comma or period followed by a digit on either
 * side, as in "1,234,567" or "1234.56" — is set aside, so amounts never match;
 * the other groups of the same run are still tested ("paid $1,200 4111 …").
 * Inside a run, consecutive groups are tested left to right, longest first:
 *   - SSN: exactly three groups of 3, 2 and 4 digits with the same separator
 *     both times ("123-45-6789", "123 45 6789"; not "123-45 6789").
 *   - SSN, bare: one group of exactly 9 digits, only when "ssn" (as a whole
 *     word) or "social security" appears within SSN_KEYWORD_WINDOW characters
 *     of it. Without a keyword nearby a 9-digit number is left alone: routing
 *     numbers, IDs and amounts have the same shape.
 *   - Card: 13 to 19 digits in total that pass the Luhn check.
 *
 * WHAT IS DELIBERATELY NOT MATCHED
 * Account numbers (too many false positives; the prompts already forbid full
 * identifiers), phone numbers, ZIP codes, dates and amounts. A Luhn-valid
 * 13–19 digit identifier that is not a card (an order or tracking number) is
 * matched; that false positive is accepted.
 */

export const SSN_KEYWORD_WINDOW = 30;
export const SENSITIVE_MASK = "[redacted]";

export interface SensitiveMatchCounts {
  ssn: number;
  card: number;
}

interface Span {
  start: number;
  end: number;
  kind: "ssn" | "card";
}

interface DigitGroup {
  start: number;
  end: number;
  digits: string;
}

const KEYWORD_PATTERN = /\bssn\b|social[ -]security/gi;
const RUN_PATTERN = /\d+(?:[ -]\d+)*/g;

/** Luhn checksum over a string of digits. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function keywordRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const pattern = new RegExp(KEYWORD_PATTERN.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function keywordNear(
  keywords: Array<[number, number]>,
  start: number,
  end: number
): boolean {
  for (const [kStart, kEnd] of keywords) {
    if (kEnd <= start && start - kEnd <= SSN_KEYWORD_WINDOW) return true;
    if (kStart >= end && kStart - end <= SSN_KEYWORD_WINDOW) return true;
  }
  return false;
}

/** True when the run continues a larger number such as "1,234" or "12.50". */
function partOfLargerNumber(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 2), start);
  const after = text.slice(end, end + 2);
  return /^[.,]\d$/.test(after) || /\d[.,]$/.test(before);
}

function groupsOf(text: string, start: number, end: number): DigitGroup[] {
  const groups: DigitGroup[] = [];
  const pattern = /\d+/g;
  const run = text.slice(start, end);
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(run)) !== null) {
    groups.push({
      start: start + m.index,
      end: start + m.index + m[0].length,
      digits: m[0],
    });
  }
  return groups;
}

function classifyWindow(
  text: string,
  groups: DigitGroup[],
  keywords: Array<[number, number]>
): "ssn" | "card" | null {
  if (
    groups.length === 3 &&
    groups[0].digits.length === 3 &&
    groups[1].digits.length === 2 &&
    groups[2].digits.length === 4
  ) {
    const sep1 = text.slice(groups[0].end, groups[1].start);
    const sep2 = text.slice(groups[1].end, groups[2].start);
    if (sep1 === sep2) return "ssn";
  }

  if (groups.length === 1 && groups[0].digits.length === 9) {
    if (keywordNear(keywords, groups[0].start, groups[0].end)) return "ssn";
  }

  const digits = groups.map((g) => g.digits).join("");
  if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
    return "card";
  }

  return null;
}

function findSpans(text: string): Span[] {
  const spans: Span[] = [];
  const keywords = keywordRanges(text);
  const runPattern = new RegExp(RUN_PATTERN.source, "g");
  let m: RegExpExecArray | null;

  while ((m = runPattern.exec(text)) !== null) {
    const runStart = m.index;
    const runEnd = m.index + m[0].length;

    // A group that touches a "," or "." followed by a digit belongs to a
    // larger number (an amount) and is dropped on its own, not with the whole
    // run, so a card or SSN written right after an amount is still examined.
    // Only the first and last group of a run can touch one (the others have a
    // space or hyphen on both sides), so the remaining groups stay contiguous.
    const groups = groupsOf(text, runStart, runEnd).filter(
      (g) => !partOfLargerNumber(text, g.start, g.end)
    );
    let i = 0;
    while (i < groups.length) {
      let matched = false;
      for (let j = groups.length - 1; j >= i; j--) {
        const kind = classifyWindow(text, groups.slice(i, j + 1), keywords);
        if (kind) {
          spans.push({ start: groups[i].start, end: groups[j].end, kind });
          i = j + 1;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    }
  }

  return spans;
}

/** How many SSN-shaped and card-shaped strings the text contains. */
export function findSensitiveMatches(text: string): SensitiveMatchCounts {
  const counts: SensitiveMatchCounts = { ssn: 0, card: 0 };
  for (const span of findSpans(text)) {
    counts[span.kind]++;
  }
  return counts;
}

/** The text with every match replaced by SENSITIVE_MASK, and the counts. */
export function maskSensitive(
  text: string
): { text: string; masked: number } & SensitiveMatchCounts {
  const spans = findSpans(text);
  let out = "";
  let cursor = 0;
  const counts: SensitiveMatchCounts = { ssn: 0, card: 0 };
  for (const span of spans) {
    out += text.slice(cursor, span.start) + SENSITIVE_MASK;
    cursor = span.end;
    counts[span.kind]++;
  }
  out += text.slice(cursor);
  return { text: out, masked: spans.length, ...counts };
}
