import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The header back button on the settings, household and chat screens goes to
 * a fixed screen, the dashboard, instead of the previous history entry.
 *
 * With router.back() (or a push to a sibling screen) two screens can each be
 * the other's "previous" screen, and a screen opened directly has no previous
 * entry inside the app at all. The button replaces the current entry with the
 * dashboard, so pressing it repeatedly never stacks history and the browser's
 * own back control does not reopen the screen just left.
 *
 * WHAT THIS FILE DOES AND DOES NOT PROVE
 * It reads source TEXT. For each page it finds the single `<button ...>` tag
 * carrying aria-label="Back" and pins its onClick to a replace to /dashboard,
 * and it refuses any router.back( call anywhere in the page. It renders
 * nothing, so it cannot see a handler that navigates elsewhere through another
 * function, and text inside a comment or string is read as code.
 */

const PAGES = [
  "../../app/settings/page.tsx",
  "../../app/settings/household/page.tsx",
  "../../app/chat/page.tsx",
] as const;

function readPage(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Every opening `<button ...>` tag that carries aria-label="Back". The tag
 * ends at the first `>` outside a `{...}` expression, so an arrow function in
 * an attribute does not end it early.
 */
function backButtonTags(source: string): string[] {
  const tags: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("<button", from);
    if (start === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) throw new Error("unterminated <button tag");
    const tag = source.slice(start, end + 1);
    if (/aria-label="Back"/.test(tag)) tags.push(tag);
    from = end + 1;
  }
  return tags;
}

describe("header back buttons go to the dashboard", () => {
  for (const page of PAGES) {
    describe(page, () => {
      const source = readPage(page);

      it("has exactly one button labelled Back", () => {
        expect(backButtonTags(source)).toHaveLength(1);
      });

      it("replaces the current entry with /dashboard", () => {
        const [tag] = backButtonTags(source);
        expect(tag).toMatch(
          /onClick=\{\(\) => router\.replace\((['"])\/dashboard\1\)\}/
        );
      });

      it("never calls router.back()", () => {
        expect(source).not.toMatch(/router\.back\(/);
      });
    });
  }
});
