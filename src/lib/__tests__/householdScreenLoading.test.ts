import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { householdLoadView, memberKey, type HouseholdData, type MemberLine } from "../householdClient";

/**
 * The household screen's first load and its member list keys. The decisions
 * are executed; the page, which cannot run here (no DOM), is probed by source.
 *
 * Mutations and the test each one turns red:
 *   a key taken from the list position, or from the first name             -> T-S1
 *   the page keyed on the index again                                       -> T-S1
 *   the loading line removed, or shown once data or an error is in          -> T-S2
 */

const SELF: MemberLine = { self: true, role: "owner", firstName: "Sam" };
const OTHER: MemberLine = { self: false, role: "member", firstName: "Alex" };
const UNNAMED: MemberLine = { self: false, role: "member", firstName: null };

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function flat(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

const PAGE = flat(read("../../app/settings/household/page.tsx"));

describe("household screen: member keys", () => {
  it("T-S1 each member keeps its key whichever order the members come in, and keys differ", () => {
    const a = [SELF, OTHER];
    const b = [OTHER, SELF];
    expect(memberKey(a, 0)).toBe("self");
    expect(memberKey(b, 1)).toBe("self");
    expect(memberKey(a, 1)).toBe(memberKey(b, 0));
    expect(memberKey(a, 0)).not.toBe(memberKey(a, 1));

    // Two other members get distinct keys, and a missing name changes nothing.
    const c = [UNNAMED, SELF, OTHER];
    const keys = c.map((_, i) => memberKey(c, i));
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual(["other-0", "self", "other-1"]);
    expect(memberKey([SELF, UNNAMED], 1)).toBe(memberKey([SELF, OTHER], 1));

    expect(PAGE).toContain("key={memberKey(data.members, i)}");
    expect(PAGE).not.toMatch(/key=\{i\}/);
  });
});

describe("household screen: first load", () => {
  const DATA: HouseholdData = { role: "owner", members: [SELF], invite: null, maxMembers: 2 };

  it("T-S2 before data or an error the screen says it is loading, and only then", () => {
    expect(householdLoadView(null, null)).toBe("loading");
    expect(householdLoadView(null, "failed")).toBe("failed");
    expect(householdLoadView(DATA, null)).toBe("ready");
    expect(householdLoadView(DATA, "failed")).toBe("ready");

    expect(PAGE).toContain(
      "{householdLoadView(data, loadError) === 'loading' && ( <p role=\"status\""
    );
    const start = PAGE.indexOf("{householdLoadView(data, loadError) === 'loading' && (");
    const block = PAGE.slice(start, PAGE.indexOf(")}", start));
    expect(block).toContain("{HOUSEHOLD_UI.loading}");
  });
});
