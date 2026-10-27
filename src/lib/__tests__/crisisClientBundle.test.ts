import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * crisisSignals.ts and crisisNotice.ts are imported by the chat client and the
 * demo chat as well as by server code, so they must not pull a server module
 * or an environment read into a client bundle.
 *
 * ⚠️ A SOURCE PROBE, NOT A BUILD. It proves the files are shaped as described;
 * that the client bundle actually builds is checked by the Vercel build.
 */

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8"
  ).replace(/\r\n?/g, "\n");
}

const SIGNALS = read("../crisisSignals.ts");
const NOTICE = read("../crisisNotice.ts");

describe("crisis modules stay safe for a client bundle", () => {
  it("crisisSignals.ts imports nothing and reads no environment", () => {
    expect(SIGNALS).not.toMatch(/^\s*import\b/m);
    expect(SIGNALS).not.toMatch(/\brequire\s*\(/);
    expect(SIGNALS).not.toMatch(/\bimport\s*\(/);
    expect(SIGNALS).not.toContain("process.env");
  });

  it("crisisNotice.ts imports only a type from ./crisisSignals", () => {
    const imports = (NOTICE.match(/^\s*import\b[^;]*;/gm) ?? []).map((s) =>
      s.trim()
    );
    expect(imports).toEqual([
      'import type { CrisisCategory } from "./crisisSignals";',
    ]);
    expect(NOTICE).not.toMatch(/\brequire\s*\(/);
    expect(NOTICE).not.toMatch(/\bimport\s*\(/);
    expect(NOTICE).not.toContain("process.env");
  });
});
