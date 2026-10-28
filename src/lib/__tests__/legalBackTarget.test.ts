import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  LEGAL_BACK_FALLBACK,
  LEGAL_BACK_TARGETS,
  legalBackTarget,
} from "@/lib/legalBackTarget";

/**
 * Back button on /privacy and /terms. The decision is executed here; the page's
 * use of it is a source probe (B6), since the click handler needs a router.
 *
 * Mutations and the tests each one turns red:
 *   M1  legalBackTarget returning any value that starts with "/"   -> B4
 *   M2  the settings rows linking without ?back=/settings          -> B5
 *   M3  the page calling router.back() instead of the target        -> B6
 */

describe("legalBackTarget", () => {
  it("B1 from settings: back to /settings", () => {
    expect(legalBackTarget("?back=/settings")).toBe("/settings");
  });

  it("B2 from the landing page: back to /landing", () => {
    expect(legalBackTarget("?back=/landing")).toBe("/landing");
  });

  it("B3 no query, or no back value: falls back to /", () => {
    expect(legalBackTarget("")).toBe(LEGAL_BACK_FALLBACK);
    expect(legalBackTarget("?")).toBe(LEGAL_BACK_FALLBACK);
    expect(legalBackTarget("?other=/settings")).toBe(LEGAL_BACK_FALLBACK);
    expect(legalBackTarget("?back=")).toBe(LEGAL_BACK_FALLBACK);
    expect(LEGAL_BACK_FALLBACK).toBe("/");
  });

  it("B4 a value outside the list falls back to /, including off-site and look-alike paths", () => {
    for (const value of [
      "/dashboard",
      "/admin",
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "/settings/../admin",
      "/settings/",
      "/settings?x=1",
      "/Settings",
      " /settings",
      "javascript:alert(1)",
    ]) {
      expect(legalBackTarget(`?back=${encodeURIComponent(value)}`), value).toBe(LEGAL_BACK_FALLBACK);
    }
  });
});

describe("entry links and page wiring", () => {
  const SRC = fileURLToPath(new URL("../..", import.meta.url));

  it("B5 every in-app link to /privacy or /terms names an allowed back value, and settings and landing both link", () => {
    const out = execSync(
      `git grep -nhoE "/(privacy|terms)\\?back=[^\\"'\\\`) ]*" -- . ":!lib/__tests__"`,
      { cwd: SRC, encoding: "utf8" }
    );
    const links = out.trim().split("\n").filter(Boolean);
    for (const link of links) {
      const back = link.slice(link.indexOf("?"));
      expect(legalBackTarget(back), link).not.toBe(LEGAL_BACK_FALLBACK);
    }
    const settings = readFileSync(`${SRC}/app/settings/page.tsx`, "utf8");
    const landing = readFileSync(`${SRC}/app/landing/page.tsx`, "utf8");
    for (const page of ["privacy", "terms"]) {
      expect(settings).toContain(`router.push('/${page}?back=/settings')`);
      expect(landing).toContain(`href="/${page}?back=/landing"`);
    }
    expect([...LEGAL_BACK_TARGETS].sort()).toEqual(["/landing", "/settings"]);
  });

  it("B6 the back button pushes legalBackTarget(window.location.search) and never uses history", () => {
    const view = readFileSync(`${SRC}/components/legal/LegalDocumentView.tsx`, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(view).toMatch(/router\.push\(legalBackTarget\(window\.location\.search\)\)/);
    expect(view).not.toMatch(/router\.back\(|history\.back\(|document\.referrer/);
  });
});
