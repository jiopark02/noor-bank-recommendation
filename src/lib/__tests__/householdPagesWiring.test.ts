import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source probe of the household screens. A page cannot be executed here (no
 * DOM); the decisions they call are executed in householdClient.test.ts.
 * Order checks compare text position only.
 *
 * Mutations and the test each one turns red:
 *   a screen sending its requests through getSupabaseBearerHeaders      -> T-C2
 *   accept called from the mount effect, or the fragment left in place  -> T-C4
 *   the token or anything else written to localStorage/sessionStorage   -> T-C5
 *   "unavailable" signing out, or the mount read not through readSession -> T-C7
 *   the settings row removed, or placed inside a settings handler        -> T-C10
 *   the retry's preview not given the accept-unknown flag, or the flag
 *     not set from the accept / not updated after the preview          -> T-C12 (page)
 *   the unconfirmed-join view missing its sentence or its button      -> T-C12 (page)
 *   a shared busy label, or a handler starting another action's label  -> T-C14 (page)
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function flat(source: string): string {
  return source.replace(/\s+/g, " ");
}

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) {
    throw new Error(`could not bound the region between \`${from}\` and \`${to}\`; re-point these anchors.`);
  }
  return source.slice(start, end);
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const HOUSEHOLD = flat(code(read("../../app/settings/household/page.tsx")));
const ACCEPT = flat(code(read("../../app/settings/household/accept/page.tsx")));
const SETTINGS = flat(code(read("../../app/settings/page.tsx")));
const CLIENT = flat(code(read("../householdClient.ts")));

describe("household screens", () => {
  it("T-C2 neither screen nor the client module uses getSupabaseBearerHeaders or getSessionSafe", () => {
    for (const [name, source] of [
      ["household", HOUSEHOLD],
      ["accept", ACCEPT],
      ["client", CLIENT],
    ]) {
      expect(source, name).not.toContain("getSupabaseBearerHeaders");
      expect(source, name).not.toContain("getSessionSafe");
      expect(source, name).not.toContain("buildJsonAuthorizedHeaders");
    }
    for (const [name, source] of [
      ["household", HOUSEHOLD],
      ["accept", ACCEPT],
    ]) {
      expect(source, name).not.toMatch(/\bfetch\(/);
      expect(source, name).toContain("householdCall(");
    }
  });

  it("T-C4 accept: the fragment is moved to a ref and removed on mount; accepting happens only in the join handler", () => {
    const mount = slice(ACCEPT, "if (tokenRef.current === null) {", "return () => { cancelled = true; };");
    expect(mount).toContain("tokenRef.current = readInviteFragment(window.location.href);");
    expect(mount).toContain('if (window.location.hash !== "") removeFragment();');
    expect(mount.indexOf("removeFragment();")).toBeLessThan(mount.indexOf("retryUntilAnswered("));
    expect(mount).not.toContain("/api/household/invite/accept");
    expect(mount).toContain('"/api/household/invite/preview"');

    expect(count(ACCEPT, '"/api/household/invite/accept"')).toBe(1);
    const join = slice(ACCEPT, "const handleJoin = async", "const handleLeaveCurrent = async");
    expect(join).toContain('"/api/household/invite/accept"');
    expect(join).toContain("apply(afterAccept(outcome, inviterFirstName));");
    expect(ACCEPT).toContain("onClick={() => handleJoin(view.inviterFirstName)}");
    expect(ACCEPT).toContain(
      "window.history.replaceState( window.history.state, \"\", window.location.pathname + window.location.search );"
    );
    expect(ACCEPT).toContain("const tokenRef = useRef<string | null>(null);");
    expect(ACCEPT).toContain("if (!step.keepToken) tokenRef.current = null;");
  });

  it("T-C5 nothing is written to browser storage", () => {
    for (const [name, source] of [
      ["household", HOUSEHOLD],
      ["accept", ACCEPT],
      ["client", CLIENT],
    ]) {
      expect(source, name).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
    }
  });

  it.each([
    ["household", HOUSEHOLD, "household-mount"],
    ["accept", ACCEPT, "household-accept"],
  ])("T-C7 %s: the mount reads through readSession; only none signs out, unavailable shows the delay screen", (_name, page, label) => {
    expect(page).toContain(
      `await retryUntilAnswered( (timeoutMs, attempt) => readSession(timeoutMs, "${label}", attempt), shouldRetrySessionRead, PROTECTED_SESSION_RETRY, { sleep: waitMs, isCancelled: () => cancelled } );`
    );
    expect(page).toContain("const action = decideProtectedMount(read);");
    expect(count(page, "clearLocalAuthState()")).toBe(1);
    expect(page).toContain(
      'if (action === "sign-out") { clearLocalAuthState(); router.replace("/login"); return; }'
    );
    const delayed = slice(page, 'if (action === "show-delayed"', "return; }");
    expect(delayed).toContain("setSessionDelayed(true);");
    expect(delayed).not.toContain("clearLocalAuthState");
    expect(delayed).not.toContain("router.");
    expect(page).toContain("if (sessionDelayed) {");
    expect(page).toContain("onClick={() => window.location.reload()}");
  });

  it("T-C10 settings links to the household screen from its JSX, outside the handlers the sign-out tests hold", () => {
    const row = SETTINGS.indexOf("onClick={() => router.push('/settings/household')}");
    expect(row).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(SETTINGS.indexOf('<div className="min-h-screen pb-28"'));
    expect(SETTINGS.indexOf('<div className="min-h-screen pb-28"')).toBeGreaterThan(
      SETTINGS.indexOf("const handleLogout = async")
    );
    for (const [from, to] of [
      ["const handleLogout = async", "return ("],
      ["const handleDeleteAccount = async", "const handleExportData"],
    ]) {
      expect(slice(SETTINGS, from, to)).not.toContain("household");
    }
    expect(SETTINGS).toContain("<SectionLabel>{HOUSEHOLD_UI.settingsSection}</SectionLabel>");
  });

  it("T-C12 (page) the accept-unknown flag is set by the accept, read and updated by the retry's preview, and has its own view", () => {
    expect(ACCEPT).toContain("const acceptUnknownRef = useRef(false);");
    const join = slice(ACCEPT, "const handleJoin = async", "const handleLeaveCurrent = async");
    expect(join).toContain(
      "acceptUnknownRef.current = acceptOutcomeUnknown(outcome); apply(afterAccept(outcome, inviterFirstName));"
    );
    const retry = slice(ACCEPT, "const handleRetry = async", "const handleJoin = async");
    expect(retry).toContain(
      "const acceptUnknown = acceptUnknownRef.current; acceptUnknownRef.current = acceptUnknownAfterPreview(outcome, acceptUnknown); apply(afterPreview(outcome, acceptUnknown));"
    );
    const leave = slice(ACCEPT, "const handleLeaveCurrent = async", "if (sessionDelayed) {");
    expect(leave).toContain("acceptUnknownRef.current = false;");
    const view = slice(ACCEPT, '{view.kind === "join-unconfirmed" && (', ")}");
    expect(view).toContain("{HOUSEHOLD_UI.joinUnconfirmed}");
    expect(ACCEPT).toContain(
      '{view.kind === "join-unconfirmed" && ( <div> <p className="text-gray-800 mb-6">{HOUSEHOLD_UI.joinUnconfirmed}</p> <button type="button" onClick={() => router.push("/settings/household")} className={`${BUTTON} bg-black text-white`} > {HOUSEHOLD_UI.goToHousehold} </button>'
    );
  });

  it("T-C14 (page) each button's label comes from its own action", () => {
    expect(HOUSEHOLD).toContain("const [busy, setBusy] = useState<HouseholdBusyAction>(null);");
    expect(HOUSEHOLD).not.toMatch(/busy \?/);
    expect(HOUSEHOLD).not.toContain("HOUSEHOLD_UI.creating");
    expect(HOUSEHOLD).toContain("{createButtonLabel(busy, data.invite !== null)}");
    expect(HOUSEHOLD).toContain("{cancelButtonLabel(busy)}");
    expect(HOUSEHOLD).toContain("{leaveConfirmLabel(busy)}");
    for (const [handler, next, action] of [
      ["const handleCreateInvite = async", "const handleCancelInvite = async", "create"],
      ["const handleCancelInvite = async", "const handleLeave = async", "cancel"],
      ["const handleLeave = async", "const handleCopy = async", "leave"],
    ]) {
      const body = slice(HOUSEHOLD, handler, next);
      expect(body, action).toContain(`setBusy('${action}');`);
      expect(body, action).toContain("setBusy(null);");
      expect(count(body, "setBusy("), action).toBe(2);
    }
    expect(count(HOUSEHOLD, "disabled={busy !== null")).toBe(3);
  });

  it("each screen keeps the bottom nav last in its flow", () => {
    for (const [name, source] of [
      ["household", HOUSEHOLD],
      ["accept", ACCEPT],
    ]) {
      expect(source, name).toMatch(/<BottomNav \/> <\/div> \); }\s*$/);
    }
  });
});
