import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideDashboardMount,
  decideLocalIdentity,
  decideProtectedMount,
} from "../sessionFlow";
import { replaceLocalIdentity } from "../validation";
import type { SessionReadResult } from "../supabase-browser";

/**
 * The mount decisions shared by the signed-in pages (/dashboard, /money,
 * /chat), executed.
 *
 * The rule: only a clean "none" may sign anyone out. "unavailable" — a
 * timeout, an error, or a client that is not configured — can come from a
 * valid session, so it must never clear local state. A cached user id that
 * names another user is replaced with the session's, not treated as a
 * sign-out.
 *
 * What the pages do with each answer is held by the source probe in
 * protectedPagesSessionWiring.test.ts.
 */

const SESSION = {
  status: "session",
  session: { user: { id: "user-a" } },
} as unknown as SessionReadResult;

describe("decideProtectedMount", () => {
  it("proceeds on a session", () => {
    expect(decideProtectedMount(SESSION)).toBe("proceed");
  });

  it("signs out on a clean none", () => {
    expect(decideProtectedMount({ status: "none" })).toBe("sign-out");
  });

  it.each(["timeout", "error", "not-configured"] as const)(
    "never signs out on unavailable (%s)",
    (reason) => {
      expect(
        decideProtectedMount({ status: "unavailable", reason, elapsedMs: 0 })
      ).toBe("show-delayed");
    }
  );

  it("is the same decision the dashboard uses", () => {
    expect(decideDashboardMount).toBe(decideProtectedMount);
  });
});

describe("decideLocalIdentity", () => {
  it("keeps a cache that names the session's user", () => {
    expect(decideLocalIdentity("user-a", "user-a")).toBe("keep");
  });

  it("replaces a cache that names another user", () => {
    expect(decideLocalIdentity("user-b", "user-a")).toBe("replace");
  });

  it("replaces a missing cache", () => {
    expect(decideLocalIdentity(null, "user-a")).toBe("replace");
  });
});

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

describe("replaceLocalIdentity", () => {
  let local: MemoryStorage;
  let session: MemoryStorage;

  beforeEach(() => {
    local = new MemoryStorage();
    session = new MemoryStorage();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the other user's local auth state and writes the session's id", () => {
    local.setItem("noor_user_id", "user-b");
    local.setItem("noor_user_profile", '{"firstName":"B"}');
    local.setItem("noor_session", "{}");
    session.setItem("noor_session", "{}");
    local.setItem("noor_chat_history", "[]");
    local.setItem("noor_plaid_accounts", "[]");
    local.setItem("noor_quick_prompt", "hello");

    replaceLocalIdentity("user-a");

    expect(local.getItem("noor_user_id")).toBe("user-a");
    expect(local.getItem("noor_user_profile")).toBeNull();
    expect(local.getItem("noor_session")).toBeNull();
    expect(session.getItem("noor_session")).toBeNull();
    expect(local.getItem("noor_chat_history")).toBeNull();
    expect(local.getItem("noor_plaid_accounts")).toBeNull();
    // Outside the logout set, so it survives, as it does a logout.
    expect(local.getItem("noor_quick_prompt")).toBe("hello");
  });
});
