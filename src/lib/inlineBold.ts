import { createElement, type ReactNode } from "react";

/**
 * Bold marks in text a screen draws as-is (model answers can carry text from
 * outside, such as bank labels). Only a matched `**text**` pair becomes bold,
 * and only as a React element: the text stays a React text child, so React
 * escapes it. Nothing here builds HTML.
 *
 * A pair counts when the text between the marks is not empty and neither
 * starts nor ends with whitespace. Otherwise the opening `**` stays as written
 * and the scan moves on, so `2 ** 3 and **x**` bolds only `x`. A `**` with no
 * partner, and every other markdown mark, stays as written.
 */

export type InlineSegment = { text: string; bold: boolean };

const MARK = "**";

function isSpace(ch: string): boolean {
  return /\s/.test(ch);
}

export function splitInlineBold(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(MARK, i);
    if (open === -1) {
      plain += text.slice(i);
      break;
    }
    const close = text.indexOf(MARK, open + MARK.length);
    if (close === -1) {
      plain += text.slice(i);
      break;
    }
    const inner = text.slice(open + MARK.length, close);
    if (inner === "" || isSpace(inner.charAt(0)) || isSpace(inner.charAt(inner.length - 1))) {
      // Not a pair: keep this opening mark as written and look again after it.
      plain += text.slice(i, open + MARK.length);
      i = open + MARK.length;
      continue;
    }
    plain += text.slice(i, open);
    if (plain !== "") segments.push({ text: plain, bold: false });
    plain = "";
    segments.push({ text: inner, bold: true });
    i = close + MARK.length;
  }
  if (plain !== "") segments.push({ text: plain, bold: false });
  return segments;
}

/** The segments as React children: plain strings and `<strong>` elements. */
export function renderInlineBold(text: string): ReactNode[] {
  return splitInlineBold(text).map((segment, k) =>
    segment.bold ? createElement("strong", { key: k }, segment.text) : segment.text
  );
}
