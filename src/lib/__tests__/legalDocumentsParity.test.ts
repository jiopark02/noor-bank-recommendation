import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { LegalDocumentBody } from "@/components/legal/LegalDocumentView";
import {
  PRIVACY_POLICY,
  TERMS_OF_SERVICE,
  type LegalDocument,
} from "@/lib/legalDocuments";
import en from "../../../messages/en.json";

/**
 * The Terms of Service and Privacy Policy exist twice: hardcoded in the signup
 * modals of src/app/survey/page.tsx, and in src/lib/legalDocuments.ts, which
 * /terms and /privacy render. This test fails when the two drift.
 *
 * The survey side is read from source, since the modals render only after a
 * click inside a page that needs a session. The /terms and /privacy side is
 * rendered: LegalDocumentBody turns the module into markup, so a page that
 * dropped, reordered or rewrote a section fails too, not only a module edit.
 *
 * Both sides become the same shape: the ordered list of heading and paragraph
 * elements, each with its visible text, whitespace collapsed. Heading level is
 * not compared (the modal uses h3 under its h2 title, the page h2 under its h1).
 *
 * Mutations and the test each one turns red:
 *   M1  one word changed in a module section body          -> L1 (terms)
 *   M2  LegalDocumentBody skipping the "Last updated" line -> L1, L2
 *   M3  a privacy page rendering the terms document        -> L4
 */

const SURVEY = readFileSync(
  fileURLToPath(new URL("../../app/survey/page.tsx", import.meta.url)),
  "utf8"
);

type Block = { kind: "heading" | "paragraph"; text: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function visibleText(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Heading and paragraph elements of an HTML or JSX fragment, in order. */
function blocks(fragment: string): Block[] {
  const out: Block[] = [];
  const re = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) {
    out.push({ kind: m[1] === "p" ? "paragraph" : "heading", text: visibleText(m[2]) });
  }
  return out;
}

/** The modal between `startMarker` and `endMarker` in the survey source. */
function surveyModal(startMarker: string, endMarker: string): { titleKey: string; body: string } {
  const start = SURVEY.indexOf(startMarker);
  const end = SURVEY.indexOf(endMarker, start + 1);
  if (start < 0 || end < 0) {
    throw new Error(`survey/page.tsx: ${startMarker} or ${endMarker} not found; re-point this anchor.`);
  }
  const modal = SURVEY.slice(start, end);

  const title = /<h2\b[^>]*>\s*\{t\("([^"]+)"\)\}\s*<\/h2>/.exec(modal);
  if (!title) throw new Error(`survey/page.tsx: no t("...") title in ${startMarker}.`);

  const bodyOpen = modal.indexOf('<div className="prose');
  const bodyClose = modal.indexOf("</div>", bodyOpen);
  if (bodyOpen < 0 || bodyClose < 0) {
    throw new Error(`survey/page.tsx: no prose body in ${startMarker}; re-point this anchor.`);
  }
  const body = modal.slice(bodyOpen, bodyClose);
  // The extractor reads JSX text only. An expression in the body would render
  // something this comparison cannot see, so it must fail loudly instead.
  if (/[{}]/.test(body)) {
    throw new Error(`survey/page.tsx: ${startMarker} body contains a JSX expression; extend this test.`);
  }
  return { titleKey: title[1], body };
}

function renderedBlocks(doc: LegalDocument): Block[] {
  return blocks(renderToStaticMarkup(createElement(LegalDocumentBody, { doc })));
}

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    en
  );
}

const TERMS_MODAL = surveyModal("{/* Terms Modal */}", "{/* Privacy Modal */}");
const PRIVACY_MODAL = surveyModal("{/* Privacy Modal */}", "{/* Bottom Navigation */}");

describe("legal documents: /terms and /privacy match the survey modals", () => {
  it("L1 terms: same headings and paragraphs, in order", () => {
    const expected = blocks(TERMS_MODAL.body);
    expect(expected.length).toBeGreaterThan(2);
    expect(expected[0].text).toMatch(/^Last updated: /);
    expect(renderedBlocks(TERMS_OF_SERVICE)).toEqual(expected);
  });

  it("L2 privacy: same headings and paragraphs, in order", () => {
    const expected = blocks(PRIVACY_MODAL.body);
    expect(expected.length).toBeGreaterThan(2);
    expect(expected[0].text).toMatch(/^Last updated: /);
    expect(renderedBlocks(PRIVACY_POLICY)).toEqual(expected);
  });

  it("L3 titles come from the same messages key the modals use", () => {
    expect(TERMS_OF_SERVICE.titleKey).toBe(TERMS_MODAL.titleKey);
    expect(PRIVACY_POLICY.titleKey).toBe(PRIVACY_MODAL.titleKey);
    expect(typeof lookup(TERMS_OF_SERVICE.titleKey)).toBe("string");
    expect(typeof lookup(PRIVACY_POLICY.titleKey)).toBe("string");
  });

  it("L4 each page renders its own document", () => {
    const page = (route: string) =>
      readFileSync(fileURLToPath(new URL(`../../app/${route}/page.tsx`, import.meta.url)), "utf8");
    expect(page("terms")).toMatch(/<LegalDocumentPage doc=\{TERMS_OF_SERVICE\} \/>/);
    expect(page("privacy")).toMatch(/<LegalDocumentPage doc=\{PRIVACY_POLICY\} \/>/);
  });
});
