import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Bank data must not be kept in browser storage.
 *
 * WHY
 * Balances, transactions and connection details came from the dashboard and
 * the connect card into localStorage, where they outlived the visit: on a
 * shared device, or for a user who never logs out, the previous figures sat on
 * disk and were painted before the server answered. The screens now read every
 * bank figure from the server on each visit, and the dashboard drops whatever
 * an earlier build left behind as the first thing its mount effect does.
 *
 * Reintroducing a cache is the natural regression — it makes the first paint
 * faster — and it type-checks clean and passes every other test. This file is
 * the standing check, in the same source-probe shape as
 * plaidDisconnectLocalCleanup.test.ts.
 *
 * WHAT THIS FILE PROVES AND DOES NOT PROVE
 * It reads source TEXT. It proves the dashboard touches browser storage only
 * under an explicit list of non-bank keys, that its mount effect calls the
 * clearing helper before any redirect or await, and that the connect card does
 * not touch browser storage at all. It does NOT execute anything — no DOM
 * environment exists in this repo — so it cannot prove the keys are actually
 * gone from a browser. That is checked in DevTools on a deployment.
 *
 * IF THIS FILE FAILS
 * (a) A storage call or key was added to one of these files. If it holds bank
 *     data, that is the defect. If it does not, extend the allowlist below.
 * (b) An anchor was not found — the file was restructured. Not a defect;
 *     re-point the anchor.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Comments removed, so prose that names a key or a storage API does not count.
 * Naive: it does not know strings, so a `//` or `/*` inside a string literal
 * would eat the rest of that line or block. Neither file has one today.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const DASHBOARD = withoutComments(
  readSource("../../app/dashboard/page.tsx")
);
const PLAID_LINK = withoutComments(
  readSource("../../components/plaid/PlaidLink.tsx")
);

/** Every `<store>.<method>(<first argument>` call in the source. */
function storageCalls(
  source: string
): Array<{ store: string; method: string; key: string }> {
  const calls: Array<{ store: string; method: string; key: string }> = [];
  const pattern = /\b(localStorage|sessionStorage)\s*\.\s*(\w+)\s*\(\s*([^,)]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    calls.push({ store: match[1], method: match[2], key: match[3].trim() });
  }
  return calls;
}

// Keys the dashboard may read or write. None of them hold bank data.
const DASHBOARD_ALLOWED_READS = [
  '"noor_user_id"',
  '"noor_user_profile"',
  "STORAGE_KEY_BUDGET",
];
const DASHBOARD_ALLOWED_WRITES = ['"noor_quick_prompt"'];

describe("bank data is not kept in browser storage", () => {
  it("dashboard reads and writes browser storage only under non-bank keys", () => {
    const calls = storageCalls(DASHBOARD);
    if (calls.length === 0) {
      throw new Error(
        "dashboard/page.tsx: no storage calls found at all. The profile and " +
          "prompt reads moved or the pattern no longer matches; re-point it."
      );
    }

    for (const call of calls) {
      expect(call.store, JSON.stringify(call)).toBe("localStorage");
      if (call.method === "getItem") {
        expect(DASHBOARD_ALLOWED_READS, JSON.stringify(call)).toContain(
          call.key
        );
      } else if (call.method === "setItem") {
        expect(DASHBOARD_ALLOWED_WRITES, JSON.stringify(call)).toContain(
          call.key
        );
      } else {
        // removeItem, clear, key: clearing goes through the validation.ts
        // helpers, which own the key names.
        throw new Error(
          `dashboard/page.tsx: unexpected storage call ${JSON.stringify(call)}`
        );
      }
    }
    expect(DASHBOARD).not.toContain("noor_plaid_");
  });

  it("dashboard mount effect clears bank keys before any redirect or await", () => {
    const start = DASHBOARD.indexOf("useEffect(() => {");
    const end = DASHBOARD.indexOf("const fetchLiveMoneyData =", start);
    if (start < 0 || end < 0) {
      throw new Error(
        "dashboard/page.tsx: could not bound the mount effect between the " +
          "first `useEffect(() => {` and `const fetchLiveMoneyData =`; " +
          "re-point these anchors."
      );
    }
    const effect = DASHBOARD.slice(start, end);

    const clearAt = effect.indexOf("clearPlaidLocalState()");
    const redirectAt = effect.indexOf('router.replace("/waitlist")');
    const sessionAt = effect.indexOf("await getSessionSafe()");

    expect(redirectAt).toBeGreaterThan(-1);
    expect(sessionAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(-1);
    expect(clearAt).toBeLessThan(redirectAt);
    expect(clearAt).toBeLessThan(sessionAt);
  });

  it("connect card does not touch browser storage", () => {
    if (!PLAID_LINK.includes("export function ConnectBankCard")) {
      throw new Error(
        "PlaidLink.tsx: ConnectBankCard not found; re-point this anchor."
      );
    }
    expect(PLAID_LINK).not.toContain("localStorage");
    expect(PLAID_LINK).not.toContain("sessionStorage");
    expect(PLAID_LINK).not.toContain("noor_plaid_");
  });
});
