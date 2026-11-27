import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SRC } from "./sourceProbe";

/**
 * Inter is served from the repository: the global stylesheet declares its
 * faces on files under src/fonts/inter, and nothing under src/ points a
 * browser or the build at a Google font host.
 */

const GLOBALS = path.join(SRC, "app", "globals.css");

function everyFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      everyFile(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function interFaces(css: string): string[] {
  return (css.match(/@font-face\s*\{[^}]*\}/g) ?? []).filter((b) => /font-family:\s*'Inter'/.test(b));
}

describe("Inter from the repository", () => {
  it("no file under src names a Google font host", () => {
    // Built from parts so this file does not name the hosts itself.
    const hosts = ["fonts.googleapis", "fonts.gstatic"].map((h) => h + ".com");
    const offenders: string[] = [];
    for (const file of everyFile(SRC)) {
      const text = readFileSync(file, "utf8");
      if (hosts.some((h) => text.indexOf(h) !== -1)) offenders.push(path.relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it("the root layout loads no stylesheet link", () => {
    const layout = readFileSync(path.join(SRC, "app", "layout.tsx"), "utf8");
    expect(layout).not.toMatch(/<link\b/);
    expect(layout).toContain("import './globals.css';");
  });

  it("every Inter face uses a local woff2 file that exists, with swap and a unicode-range", () => {
    const faces = interFaces(readFileSync(GLOBALS, "utf8"));
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      const url = /src:\s*url\('([^']+)'\)\s*format\('woff2'\)/.exec(face);
      expect(url, face).not.toBeNull();
      const file = path.resolve(path.dirname(GLOBALS), url![1]);
      expect(file.startsWith(path.join(SRC, "fonts", "inter")), file).toBe(true);
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file).subarray(0, 4).toString("latin1"), file).toBe("wOF2");
      expect(face).toContain("font-display: swap;");
      expect(face).toContain("font-style: normal;");
      expect(face).toMatch(/unicode-range: U\+/);
    }
  });

  it("Inter keeps the weights the page stylesheet asked for, each covering the same subsets", () => {
    const faces = interFaces(readFileSync(GLOBALS, "utf8"));
    const byWeight: Record<string, string[]> = {};
    for (const face of faces) {
      const weight = /font-weight:\s*(\d+);/.exec(face)![1];
      const range = /unicode-range:\s*([^;]+);/.exec(face)![1];
      (byWeight[weight] = byWeight[weight] ?? []).push(range);
    }
    expect(Object.keys(byWeight).sort()).toEqual(["400", "500", "600", "700"]);
    const ranges = byWeight["400"];
    for (const w of ["500", "600", "700"]) expect(byWeight[w]).toEqual(ranges);
    // The Latin block a page's English text uses is among them.
    expect(ranges).toContainEqual(expect.stringMatching(/^U\+0000-00FF, /));
  });

  it("the Inter licence is beside the files", () => {
    const text = readFileSync(path.join(SRC, "fonts", "inter", "Inter-OFL.txt"), "utf8");
    expect(text).toContain("SIL Open Font License, Version 1.1");
  });
});
