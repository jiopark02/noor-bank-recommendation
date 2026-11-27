import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SRC, codeBySourceFile } from "./sourceProbe";

/**
 * The build fetches no font. `next/font/google` downloads its stylesheet and
 * files from Google while building and fails the build when that fails, so no
 * application file imports it. Fonts loaded with `next/font/local` name files
 * that exist in the repository, each with its licence beside it.
 */

const FONT_PATH = /path:\s*'([^']+\.woff2)'/g;

describe("fonts are local to the repository", () => {
  it("no application file imports next/font/google", () => {
    const offenders: string[] = [];
    codeBySourceFile().forEach((code, file) => {
      if (/["']next\/font\/google["']/.test(code)) offenders.push(file);
    });
    expect(offenders).toEqual([]);
  });

  it("every next/font/local file named in a page exists, with its licence", () => {
    const named: string[] = [];
    codeBySourceFile().forEach((code, file) => {
      if (!/["']next\/font\/local["']/.test(code)) return;
      const dir = path.dirname(path.join(SRC, file));
      let m: RegExpExecArray | null;
      FONT_PATH.lastIndex = 0;
      while ((m = FONT_PATH.exec(code)) !== null) named.push(path.resolve(dir, m[1]));
    });
    expect(named.length).toBeGreaterThan(0);
    for (const file of named) {
      expect(existsSync(file), file).toBe(true);
      // woff2 signature "wOF2"
      expect(readFileSync(file).subarray(0, 4).toString("latin1"), file).toBe("wOF2");
    }
    for (const licence of ["Archivo-OFL.txt", "Manrope-OFL.txt"]) {
      const text = readFileSync(path.join(SRC, "fonts", licence), "utf8");
      expect(text).toContain("SIL Open Font License, Version 1.1");
    }
  });

  it("the landing and waitlist pages keep the weights they used before", () => {
    const code = codeBySourceFile();
    const weights = (file: string) =>
      (code.get(file) ?? "").match(/weight:\s*'(\d+)'/g)?.map((w) => w.replace(/\D/g, "")) ?? [];
    expect(weights("app/landing/page.tsx")).toEqual(["400", "500", "700"]);
    expect(weights("app/waitlist/page.tsx")).toEqual(["400", "500", "600", "700", "800"]);
  });
});
