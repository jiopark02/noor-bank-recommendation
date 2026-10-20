import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLocalAuthState, purgeAllNoorLocalState } from "../validation";

/**
 * What the logout and account-deletion helpers remove from browser storage.
 *
 * WHY THIS IS WORTH A TEST
 * clearLocalAuthState (logout / SIGNED_OUT) and purgeAllNoorLocalState
 * (account deletion) are the shared-device hygiene boundary. A dropped
 * removeItem line, a loosened prefix, or a sweep that removes while it
 * iterates all type-check clean and render identically; the only symptom is
 * a key left on a device for the next person. The other tests touching these
 * helpers read source text. This file executes them.
 *
 * HOW
 * The suite runs in vitest's default `node` environment with no DOM, so each
 * test installs two in-memory Storage fakes as the globals `localStorage` and
 * `sessionStorage`. validation.ts reads those globals at call time, not at
 * import time, so a static import is enough. The fake's key(i) reflects the
 * live order after every removal, as a browser's does, which is what lets a
 * remove-while-iterating sweep be caught.
 *
 * WHAT THIS FILE PROVES AND DOES NOT PROVE
 * It proves the exact set of keys each helper removes from a seeded store,
 * and that every other key keeps its value. It does NOT prove that every
 * logout or deletion path calls these helpers, that the seed list matches
 * the keys the app writes today, or anything about cookies (the Supabase
 * session lives in a cookie, not in this storage).
 *
 * IF THIS FILE FAILS
 * (a) A helper now removes a different set of keys. If that was not the
 *     intent of the change, that is the defect.
 * (b) The change was intended (a key added to or dropped from logout, or the
 *     deletion sweep widened). Update the expected set here in the same
 *     change, so the diff shows the behavior change in one place.
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

  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    this.items.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
}

// Every key the app reads or writes, the leftovers earlier builds wrote, a
// sample of each dynamic family, and keys outside the noor_ prefix. Many
// noor_ keys sit next to each other, which a remove-while-iterating sweep
// would partly skip.
const SEED_KEYS = [
  "noor_session",
  "noor_user_id",
  "noor_user_profile",
  "noor_chat_history",
  "noor_plaid_connections",
  "noor_plaid_accounts",
  "noor_plaid_transactions",
  "noor_locale",
  "noor_selected_country",
  "noor_user_intent",
  "noor_user_priorities",
  "noor_quick_prompt",
  "noor_notification_prefs",
  "noor_terms_accepted",
  "noor_savings_goals",
  "noor_finance_progress",
  "noor_graduation_year",
  "noor_budget",
  "noor_checklist_completed",
  "noor_checklist_items",
  "noor_completed_guides",
  "noor_conversations",
  "noor_messages",
  "noor_friends",
  "noor_friend_requests",
  "noor_forum_votes",
  "noor_forum_user_posts",
  "noor_user_deals",
  "noor_referral_clicks",
  "noor_school_theme_id",
  "noor_use_school_theme",
  "noor_transfer_goals",
  "noor_visa_info_US",
  "noor_visa_checklist_US",
  "noor_auth_stale_reload",
  "noor_demo_active",
  "noor_demo_messages_used",
  "noor_demo_quick_prompt",
  "noor_onboarding_completed",
  "noor_deal_upvoted_d1",
  "noor_deal_upvotes",
  "noor_transactions",
  "noor_reminders",
  "noor_notifications",
  "deal_upvoted_d1",
  "noorish_x",
  "other",
];

// Outside the noor_ prefix. The deletion sweep leaves these alone.
const NON_NOOR_KEYS = ["deal_upvoted_d1", "noorish_x", "other"];

const LOGOUT_REMOVED_FROM_LOCAL = [
  "noor_session",
  "noor_user_id",
  "noor_user_profile",
  "noor_chat_history",
  "noor_plaid_connections",
  "noor_plaid_accounts",
  "noor_plaid_transactions",
];

const LOGOUT_REMOVED_FROM_SESSION = ["noor_session"];

let local: MemoryStorage;
let session: MemoryStorage;

function seed(store: MemoryStorage): void {
  for (const key of SEED_KEYS) store.setItem(key, `value:${key}`);
}

function expectedAfterRemoving(removed: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SEED_KEYS) {
    if (!removed.includes(key)) out[key] = `value:${key}`;
  }
  return out;
}

beforeEach(() => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  seed(local);
  seed(session);
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clearLocalAuthState (logout)", () => {
  it("removes exactly the auth, profile, chat and Plaid keys from localStorage", () => {
    clearLocalAuthState();
    expect(local.snapshot()).toEqual(
      expectedAfterRemoving(LOGOUT_REMOVED_FROM_LOCAL)
    );
  });

  it("removes only noor_session from sessionStorage", () => {
    clearLocalAuthState();
    expect(session.snapshot()).toEqual(
      expectedAfterRemoving(LOGOUT_REMOVED_FROM_SESSION)
    );
  });
});

describe("purgeAllNoorLocalState (account deletion)", () => {
  it("leaves no noor_ key in either store", () => {
    purgeAllNoorLocalState();
    for (const store of [local, session]) {
      const left = Object.keys(store.snapshot()).filter((key) =>
        key.startsWith("noor_")
      );
      expect(left).toEqual([]);
    }
  });

  it("keeps every key outside the noor_ prefix, with its value", () => {
    purgeAllNoorLocalState();
    const expected: Record<string, string> = {};
    for (const key of NON_NOOR_KEYS) expected[key] = `value:${key}`;
    expect(local.snapshot()).toEqual(expected);
    expect(session.snapshot()).toEqual(expected);
  });
});
