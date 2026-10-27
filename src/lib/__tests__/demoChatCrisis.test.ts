import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The demo chat answers a message with a crisis signal with the fixed
 * standard notice instead of a canned answer, and stays local: the demo
 * touches no Supabase, no database and no API (src/app/demo/_lib.tsx), so the
 * notice is neither counted nor sent anywhere.
 *
 * ⚠️ A SOURCE PROBE, NOT AN EXECUTED TEST. There is no React test setup, so
 * nothing here renders the page. What executes is crisisSignals.test.ts and
 * crisisNotice.test.ts, which run the detection and hold the notices.
 */

const DEMO_DIR = fileURLToPath(new URL("../../app/demo/", import.meta.url));

function read(file: string): string {
  return readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const PAGE = read(path.join(DEMO_DIR, "chat", "page.tsx"));

describe("demo chat crisis notice", () => {
  it("imports the detection and the notices", () => {
    expect(PAGE).toContain("import { detectCrisisSignal } from '@/lib/crisisSignals';");
    expect(PAGE).toContain("import { CRISIS_NOTICES } from '@/lib/crisisNotice';");
  });

  it("answers with the standard notice instead of the canned answer when a signal is detected", () => {
    expect(PAGE.split("getCannedAnswer(text)").length - 1).toBe(1);
    expect(PAGE).toContain("const crisis = detectCrisisSignal(text);");
    expect(PAGE).toContain(
      "const reply = crisis ? CRISIS_NOTICES[crisis].standard : getCannedAnswer(text);"
    );
    expect(PAGE).toContain("setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);");
  });

  it("nothing under src/app/demo imports Supabase or the notice count, or calls fetch", () => {
    const files = sourceFiles(DEMO_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /from\s+['"][^'"]*(supabase|crisisNoticeTally)[^'"]*['"]/i
      );
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
    }
  });
});
