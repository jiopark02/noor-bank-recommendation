import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source probe of /forgot-password: once the reset link's token_hash is held
 * in state, the query is removed from the address bar (the path is kept), so
 * the token does not stay in history, a shared screenshot or a copied URL.
 *
 * Next.js (14.2) patches history.replaceState so useSearchParams follows the
 * new URL; the mount effect then runs again with no token. That run must
 * return before any setter, so the token already held is not dropped and the
 * page does not fall back to the email step.
 *
 * Comments are removed as in sessionFlowWiring.test.ts; whitespace is
 * collapsed.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/forgot-password/page.tsx", import.meta.url)),
  "utf8"
);
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1")
  .replace(/\s+/g, " ");

describe("forgot-password: reset token leaves the address bar", () => {
  it("removes the query right after the token is put in state, keeping the path", () => {
    expect(CODE.split("history.replaceState(").length - 1).toBe(1);
    expect(CODE).toContain(
      'setTokenHash(linkTokenHash); window.history.replaceState(null, "", window.location.pathname); setRecoveryReady(true);'
    );
  });

  it("a run without a token returns before any setter, so the held token is kept", () => {
    const effectAt = CODE.indexOf('const linkTokenHash = searchParams?.get("token_hash");');
    const guard = 'if (!linkTokenHash || type !== "recovery") { return; }';
    const guardAt = CODE.indexOf(guard, effectAt);
    const stepAt = CODE.indexOf('setStep("reset");', effectAt);
    const tokenAt = CODE.indexOf("setTokenHash(linkTokenHash);", effectAt);
    expect(effectAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(effectAt);
    expect(stepAt).toBeGreaterThan(guardAt);
    expect(tokenAt).toBeGreaterThan(stepAt);
    // Nothing between the effect's start and the guard sets state.
    expect(CODE.slice(effectAt, guardAt)).not.toMatch(/\bset[A-Z]\w*\(/);
    // The only setter of the token is the one fed from the link.
    expect(CODE.split("setTokenHash(").length - 1).toBe(1);
  });
});
