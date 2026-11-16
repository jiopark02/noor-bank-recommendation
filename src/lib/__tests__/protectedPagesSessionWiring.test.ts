import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source probe: /money and /chat read the session the way the dashboard does
 * (sessionFlowWiring.test.ts holds the dashboard), and the dashboard replaces a
 * cached user id that names another user. The decisions are executed in
 * protectedMount.test.ts. A page cannot be executed here (no DOM), so what the
 * screens show is a live check. Order checks compare text position only.
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
    throw new Error(
      `could not bound the region between \`${from}\` and \`${to}\`; re-point these anchors.`
    );
  }
  return source.slice(start, end);
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const MONEY = flat(code(read("../../app/money/page.tsx")));
const CHAT = flat(code(read("../../app/chat/page.tsx")));
const DASHBOARD = flat(code(read("../../app/dashboard/page.tsx")));

describe.each([
  ["money", MONEY, "money-mount", "() => cancelled"],
  ["chat", CHAT, "chat-mount", "() => !isMounted"],
])("%s mount", (_name, page, label, cancelled) => {
  it("reads through readSession with retries, not getSessionSafe", () => {
    expect(page).not.toContain("getSessionSafe");
    expect(page).toContain(
      `await retryUntilAnswered( (timeoutMs, attempt) => readSession(timeoutMs, "${label}", attempt), shouldRetrySessionRead, PROTECTED_SESSION_RETRY, { sleep: waitMs, isCancelled: ${cancelled} } );`
    );
    expect(page).toContain("const action = decideProtectedMount(read);");
  });

  it("clears local state and leaves only on the sign-out decision", () => {
    expect(count(page, "clearLocalAuthState()")).toBe(1);
    expect(count(page, 'router.replace("/login")')).toBe(1);
    expect(page).toContain(
      'if (action === "sign-out") { clearLocalAuthState(); router.replace("/login"); return; }'
    );
  });

  it("shows the delay screen on unavailable without clearing or leaving", () => {
    const delayed = slice(page, 'if (action === "show-delayed"', "return; }");
    expect(delayed).toContain("setSessionDelayed(true);");
    expect(delayed).not.toContain("clearLocalAuthState");
    expect(delayed).not.toContain("router.");
    expect(page).toContain("if (sessionDelayed) {");
    expect(page).toContain("onClick={() => window.location.reload()}");
  });
});

describe("chat mount", () => {
  it("no longer reloads itself on a missing session", () => {
    expect(CHAT).not.toContain("noor_auth_stale_reload");
    expect(CHAT).not.toContain("sessionStorage");
  });
});

describe("dashboard identity", () => {
  it("replaces a cached id that names another user, after the session read", () => {
    const sessionAt = DASHBOARD.indexOf("const action = decideDashboardMount(read);");
    const checkAt = DASHBOARD.indexOf(
      'decideLocalIdentity(storedUserId, read.session.user.id) === "replace"'
    );
    expect(sessionAt).toBeGreaterThan(-1);
    expect(checkAt).toBeGreaterThan(sessionAt);
    expect(DASHBOARD).toContain(
      "replaceLocalIdentity(read.session.user.id); setUserId(read.session.user.id);"
    );
  });
});
