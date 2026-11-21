import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { isReauthRequiredAnswer, readReauthAnswer, REAUTH_UI } from "../accountReauthClient";

/**
 * The settings screen's email-code step: the answer reader, executed, and the
 * page's wiring, by source.
 *
 * Mutations and the test each one turns red:
 *   a non-200 answer read as a pass                                -> C1
 *   a locked code or a required verification not restarting       -> C1
 *   the delete or export request sent before the code step         -> C2
 *   the code or its step written to browser storage                -> C2
 */

describe("readReauthAnswer", () => {
  it("C1 only a 200 with a known status passes, and a used-up code restarts", () => {
    expect(readReauthAnswer(200, { status: "sent" })).toEqual({ kind: "sent" });
    expect(readReauthAnswer(200, { status: "verified" })).toEqual({ kind: "verified" });
    expect(readReauthAnswer(200, { status: "not_required" })).toEqual({ kind: "not_required" });
    expect(readReauthAnswer(200, { status: "other" }).kind).toBe("error");
    expect(readReauthAnswer(200, null).kind).toBe("error");
    expect(readReauthAnswer(403, { status: "verified", code: "REAUTH_CODE_REJECTED", error: "No." })).toEqual({
      kind: "error",
      message: "No.",
    });
    expect(readReauthAnswer(429, { code: "REAUTH_LOCKED", error: "Locked." })).toEqual({
      kind: "restart",
      message: "Locked.",
    });
    expect(readReauthAnswer(403, { code: "REAUTH_REQUIRED", error: "Again." }).kind).toBe("restart");
    expect(readReauthAnswer(503, "not json")).toEqual({ kind: "error", message: REAUTH_UI.fallback });
    expect(isReauthRequiredAnswer(403, { code: "REAUTH_REQUIRED" })).toBe(true);
    expect(isReauthRequiredAnswer(503, { code: "REAUTH_REQUIRED" })).toBe(false);
    expect(isReauthRequiredAnswer(403, { code: "REAUTH_CHECK_UNAVAILABLE" })).toBe(false);
  });
});

describe("settings page wiring", () => {
  const PAGE = readFileSync(
    fileURLToPath(new URL("../../app/settings/page.tsx", import.meta.url)),
    "utf8"
  ).replace(/\s+/g, " ");

  function between(from: string, to: string): string {
    const start = PAGE.indexOf(from);
    const end = PAGE.indexOf(to, start + from.length);
    if (start < 0 || end < 0) throw new Error(`could not bound \`${from}\` … \`${to}\``);
    return PAGE.slice(start, end);
  }

  it("C3 the first-step words promise no email, since the first press may run the action at once", () => {
    const firstStep = [REAUTH_UI.start, REAUTH_UI.working, REAUTH_UI.exportTitle, REAUTH_UI.exportBody];
    for (const words of firstStep) {
      expect(words).not.toMatch(/email me|sending|we'll email|we will email|send (you )?a code/i);
    }
    expect(REAUTH_UI.exportBody).toContain("we may email you a code");
    // Both modals label their idle step with these words and nothing else.
    expect(PAGE.split("reauthStage === 'idle' ? REAUTH_UI.start :").length - 1).toBe(2);
    expect(PAGE.split("reauthStage === 'idle' ? REAUTH_UI.working :").length - 1).toBe(2);
    expect(PAGE).not.toMatch(/Email me a code|Sending…|REAUTH_UI\.send/);
  });

  it("C2 each action runs the code step for its own purpose before its request, and stores nothing", () => {
    const deletion = between("const handleDeleteAccount = async", "const handleExportData");
    const step = deletion.indexOf("await advanceReauth('delete_account')");
    expect(step).toBeGreaterThan(-1);
    expect(deletion.indexOf("fetch('/api/account/delete'")).toBeGreaterThan(step);

    const exporting = between("const handleExportData = async", "const handleLogout");
    const exportStep = exporting.indexOf("await advanceReauth('export_data')");
    expect(exportStep).toBeGreaterThan(-1);
    expect(exporting.indexOf("fetch('/api/account/export'")).toBeGreaterThan(exportStep);

    const helpers = between("const resetReauth = () =>", "const handleDeleteAccount = async");
    expect(helpers).toContain("fetch(`/api/account/reauth/${path}`");
    expect(PAGE).not.toMatch(/(localStorage|sessionStorage)\.setItem\([^)]*reauth/i);
    expect(helpers).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
