import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe of /forgot-password's error copy: no Auth error message reaches
 * the screen, every Supabase refusal goes through copyForAuthError by code,
 * and an unusable reset link offers to start over. The page is not rendered
 * here (no DOM); what it shows is a live check.
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

function count(needle: string): number {
  return CODE.split(needle).length - 1;
}

describe("forgot-password page wiring: auth error copy", () => {
  it("F1 no error's message is read, and no Error is built from one", () => {
    expect(CODE).not.toMatch(/(?:resetError|updateError|verifyError|err|error)\??\.message/);
    expect(CODE).not.toContain("throw new Error(");
    expect(CODE).not.toContain("err instanceof Error");
  });

  it("F2 both reset-email requests use reset-request copy by code", () => {
    expect(count("supabase.auth.resetPasswordForEmail(")).toBe(2);
    expect(
      count(
        'if (resetError) { setError(copyForAuthError(authErrorCode(resetError), "reset-request").message); return; }'
      )
    ).toBe(2);
    expect(count("} catch { setError(AUTH_COPY.RESET_REQUEST_FAILED); }")).toBe(2);
  });

  it("F3 the password update uses reset-update copy and may offer a new link", () => {
    expect(CODE).toContain(
      'if (updateError) { const copy = copyForAuthError(authErrorCode(updateError), "reset-update"); setError(copy.message); setOfferNewLink(Boolean(copy.offerNewResetLink)); return; }'
    );
    expect(CODE).toContain("} catch { setError(AUTH_COPY.RESET_UPDATE_FAILED); }");
  });

  it("F4 a refused reset link uses reset-link copy and offers a new link", () => {
    expect(CODE).toContain(
      'if (verifyError) { const copy = copyForAuthError(authErrorCode(verifyError), "reset-link"); setError(copy.message); setOfferNewLink(Boolean(copy.offerNewResetLink)); setRecoveryReady(false); }'
    );
    expect(CODE).toContain(
      "setError(AUTH_COPY.RESET_LINK_FAILED); setOfferNewLink(true); setRecoveryReady(false);"
    );
  });

  it("F5 the new-link button returns to the email step", () => {
    expect(CODE).toContain(
      'const handleRequestNewLink = () => { setError(""); setOfferNewLink(false); setRecoveryReady(false); setStep("email"); };'
    );
    expect(CODE).toContain("{offerNewLink && ( <button type=\"button\" onClick={handleRequestNewLink}");
  });

  it("F6 the reset link is still verified on load (unchanged)", () => {
    expect(count(".verifyOtp({ type: \"recovery\", token_hash: tokenHash })")).toBe(1);
  });

  it("F7 every setError argument is a fixed string, a copy constant or a copy's message", () => {
    const calls = CODE.match(/setError\([^;]*?\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(5);
    for (const call of calls) {
      expect(call).toMatch(
        /^setError\((?:"[^"]*"|ERROR_MESSAGES\.\w+|AUTH_COPY\.\w+|copy\.message|copyForAuthError\(authErrorCode\(\w+\), "[\w-]+"\)\.message| ?"[^"]*" ?)\);$/
      );
    }
  });
});
