import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  handlePlaidWebhook,
  type WebhookDeps,
  type WebhookOutcome,
} from "../plaidWebhook";
import type { ItemOwnedConnection } from "../plaidApiUtils";

/**
 * Which console method each `[plaid-webhook] … outcome=` line from
 * handlePlaidWebhook is written with when no `log` is injected — which is how
 * the route wires it.
 *
 * plaidWebhook.test.ts injects `log`, which receives the line only, so it
 * cannot see the level. These tests leave it out and watch the three console
 * methods. The expected level per outcome is written out here rather than
 * imported, so changing the module's table alone turns a case red.
 *
 * The `[plaid-webhook]` lines written by plaidWebhookReceive.ts and
 * plaidWebhookVerification.ts are not covered; they keep the route's own
 * receive-side `log`.
 */

const ITEM_ID = "eVBnVMp7zdTJLkRNr33Rs6zr7KNJqBFL9DrE6";
const OWNER = "0b8f6a4e-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

function row(userId = OWNER): ItemOwnedConnection {
  return { user_id: userId, item_id: ITEM_ID, access_token: "v1:iv:tag:ct" };
}

function revocation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    webhook_type: "ITEM",
    webhook_code: "USER_PERMISSION_REVOKED",
    item_id: ITEM_ID,
    environment: "sandbox",
    error: null,
    ...overrides,
  };
}

/** Deps on which a revocation succeeds; no `log`, so the console is the sink. */
function deps(overrides: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    plaidEnvironment: "sandbox",
    isAdminConfigured: () => true,
    lookupByItemId: async () => ({ ok: true, rows: [row()] }),
    revoke: async (_userId, connection) => ({ itemId: connection.item_id, ok: true }),
    ...overrides,
  };
}

let spies: Record<"error" | "warn" | "info", ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  spies = {
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Case = {
  outcome: WebhookOutcome;
  level: "error" | "warn" | "info";
  payload: unknown;
  deps: WebhookDeps;
};

const CASES: Case[] = [
  { outcome: "malformed", level: "warn", payload: null, deps: deps() },
  {
    outcome: "malformed",
    level: "warn",
    payload: revocation({ item_id: "" }),
    deps: deps(),
  },
  {
    outcome: "env_mismatch",
    level: "warn",
    payload: revocation({ environment: "production" }),
    deps: deps(),
  },
  {
    outcome: "logged",
    level: "info",
    payload: revocation({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" }),
    deps: deps(),
  },
  {
    outcome: "admin_unconfigured",
    level: "error",
    payload: revocation(),
    deps: deps({ isAdminConfigured: () => false }),
  },
  {
    outcome: "lookup_failed",
    level: "error",
    payload: revocation(),
    deps: deps({ lookupByItemId: async () => ({ ok: false }) }),
  },
  {
    outcome: "unknown_item",
    level: "info",
    payload: revocation(),
    deps: deps({ lookupByItemId: async () => ({ ok: true, rows: [] }) }),
  },
  {
    outcome: "ambiguous_item",
    level: "error",
    payload: revocation(),
    deps: deps({
      lookupByItemId: async () => ({ ok: true, rows: [row(), row("another-owner")] }),
    }),
  },
  { outcome: "revoked", level: "info", payload: revocation(), deps: deps() },
  {
    outcome: "revoke_failed",
    level: "error",
    payload: revocation(),
    deps: deps({
      revoke: async (_userId, connection) => ({
        itemId: connection.item_id,
        ok: false,
        failure: "plaid",
      }),
    }),
  },
];

describe("[plaid-webhook] outcome levels without an injected log", () => {
  it.each(CASES.map((c): [string, Case] => [`${c.outcome} -> ${c.level}`, c]))(
    "%s",
    async (_label, c) => {
      // Red if: this outcome's OUTCOME_LEVEL entry changes, or decide ignores
      // the table and writes every line with one method.
      const decision = await handlePlaidWebhook(c.payload, c.deps);
      expect(decision.outcome).toBe(c.outcome);

      const calls = (["error", "warn", "info"] as const).map((level) => ({
        level,
        lines: spies[level].mock.calls.map((call) => String(call[0])),
      }));
      const written = calls.filter((entry) => entry.lines.length > 0);
      expect(written).toHaveLength(1);
      expect(written[0].level).toBe(c.level);
      expect(written[0].lines).toHaveLength(1);
      expect(written[0].lines[0]).toContain(`[plaid-webhook] `);
      expect(written[0].lines[0]).toContain(` outcome=${c.outcome}`);
    }
  );

  it("every outcome is covered by a case", () => {
    // Red if: an outcome is added to WebhookOutcome without a case here.
    const covered = new Set(CASES.map((c) => c.outcome));
    const all: WebhookOutcome[] = [
      "malformed",
      "env_mismatch",
      "logged",
      "admin_unconfigured",
      "lookup_failed",
      "unknown_item",
      "ambiguous_item",
      "revoked",
      "revoke_failed",
    ];
    expect([...covered].sort()).toEqual([...all].sort());
  });

  it("an injected log receives the line and the console receives nothing", async () => {
    // Red if: decide writes to the console as well as to an injected log.
    const received: string[] = [];
    await handlePlaidWebhook(revocation(), deps({ log: (line) => received.push(line) }));
    expect(received).toHaveLength(1);
    expect(received[0]).toContain(" outcome=revoked");
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
  });
});

describe("/api/plaid/webhook wiring of the handler's log", () => {
  /** Comments removed, so assertions are about code and not about prose. */
  function code(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const ROUTE = code(
    readFileSync(
      fileURLToPath(new URL("../../app/api/plaid/webhook/route.ts", import.meta.url)),
      "utf8"
    )
  );

  it("injects no log into handlePlaidWebhook, so the outcome levels apply", () => {
    // Red if: `log: (line) => console.error(line)` is put back into the
    // handler's deps — every outcome would be an error again, and tsc cannot
    // see it because `log` is optional.
    const start = ROUTE.indexOf("handlePlaidWebhook(payload, {");
    expect(start).toBeGreaterThan(-1);
    const end = ROUTE.indexOf("}),", start);
    expect(end).toBeGreaterThan(start);
    expect(ROUTE.slice(start, end)).not.toContain("log:");
  });
});
