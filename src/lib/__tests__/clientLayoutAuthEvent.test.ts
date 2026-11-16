import { readFileSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAuthEventForLocalState } from "../validation";

/**
 * The SIGNED_OUT → local cleanup wiring in ClientLayout.
 *
 * ClientLayout is mounted once in the root layout and subscribes to
 * supabase.auth.onAuthStateChange. It is the only path that clears local auth
 * state when a sign-out happens outside an in-page logout handler (another tab,
 * a refresh the server refused, a sign-out the auth library performs itself).
 * Losing it type-checks clean and renders identically; the only symptom is a
 * prior user's profile and chat residue left on a shared device.
 *
 * Two halves:
 *   - execution: handleAuthEventForLocalState clears on SIGNED_OUT and on
 *     nothing else, run against in-memory Storage fakes (no DOM in this suite);
 *   - source probe: ClientLayout subscribes and hands every event to that
 *     function. The probe cannot prove the subscription fires at runtime.
 */

class MemoryStorage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    const keys = Array.from(this.items.keys());
    return index >= 0 && index < keys.length ? keys[index] : null;
  }
  getItem(key: string): string | null {
    const value = this.items.get(key);
    return value === undefined ? null : value;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  clear(): void {
    this.items.clear();
  }
}

let local: MemoryStorage;
let session: MemoryStorage;

beforeEach(() => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  local.setItem("noor_user_id", "user-a");
  local.setItem("noor_user_profile", "{}");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleAuthEventForLocalState", () => {
  it("clears local auth state on SIGNED_OUT", () => {
    expect(handleAuthEventForLocalState("SIGNED_OUT")).toBe(true);
    expect(local.getItem("noor_user_id")).toBeNull();
    expect(local.getItem("noor_user_profile")).toBeNull();
  });

  it.each([
    "INITIAL_SESSION",
    "SIGNED_IN",
    "TOKEN_REFRESHED",
    "USER_UPDATED",
    "PASSWORD_RECOVERY",
  ])("leaves local state alone on %s", (event) => {
    expect(handleAuthEventForLocalState(event)).toBe(false);
    expect(local.getItem("noor_user_id")).toBe("user-a");
    expect(local.getItem("noor_user_profile")).toBe("{}");
  });
});

describe("ClientLayout wiring", () => {
  const SOURCE = readFileSync(
    new URL("../../components/layout/ClientLayout.tsx", import.meta.url),
    "utf8"
  );

  it("subscribes to auth state changes and hands each event to the cleanup", () => {
    expect(SOURCE).toContain("supabase?.auth.onAuthStateChange(");
    expect(SOURCE).toMatch(
      /onAuthStateChange\(\s*\(event\)\s*=>\s*\{\s*handleAuthEventForLocalState\(event\);/
    );
    expect(SOURCE).toMatch(
      /import\s*\{[^}]*\bhandleAuthEventForLocalState\b[^}]*\}\s*from\s*"@\/lib\/validation"/
    );
  });

  it("unsubscribes on unmount", () => {
    expect(SOURCE).toContain("authListener.subscription?.unsubscribe()");
  });

  it("does not read the session on mount", () => {
    expect(SOURCE).not.toContain("getSessionSafe");
    expect(SOURCE).not.toContain("readSession");
  });
});
