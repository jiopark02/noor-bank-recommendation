import { describe, it, expect, vi } from "vitest";
import {
  handlePlaidWebhook,
  type WebhookDeps,
} from "../plaidWebhook";
import {
  connectionsByItemIdOrFailure,
  type ItemConnectionsLookup,
  type ItemOwnedConnection,
} from "../plaidApiUtils";
import type { ConnectionRevocationOutcome } from "../plaidRevocation";

/**
 * What a verified webhook does, executed with injected fakes. Each `it` names
 * the change to plaidWebhook.ts (or plaidApiUtils.ts) that turns it red.
 *
 * Signature verification is NOT exercised here; handlePlaidWebhook is only
 * ever reached after it (plaidWebhookReceive.test.ts covers that order).
 */

const ITEM_ID = "eVBnVMp7zdTJLkRNr33Rs6zr7KNJqBFL9DrE6";
const OWNER = "0b8f6a4e-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

function row(userId = OWNER, itemId = ITEM_ID): ItemOwnedConnection {
  return { user_id: userId, item_id: itemId, access_token: "v1:iv:tag:ct" };
}

function revocation(itemId = ITEM_ID): Record<string, unknown> {
  return {
    webhook_type: "ITEM",
    webhook_code: "USER_PERMISSION_REVOKED",
    item_id: itemId,
    environment: "sandbox",
    error: null,
  };
}

/** An in-memory table: revoke removes the row, as the real pairing does. */
function harness(options: {
  rows?: ItemOwnedConnection[];
  lookupFails?: boolean;
  revokeOutcome?: ConnectionRevocationOutcome;
  adminConfigured?: boolean;
} = {}) {
  let rows = options.rows ?? [row()];
  const lines: string[] = [];
  const lookupByItemId = vi.fn(
    async (itemId: string): Promise<ItemConnectionsLookup> =>
      options.lookupFails
        ? { ok: false }
        : { ok: true, rows: rows.filter((r) => r.item_id === itemId).slice(0, 2) }
  );
  const revoke = vi.fn(
    async (
      _userId: string,
      connection: ItemOwnedConnection
    ): Promise<ConnectionRevocationOutcome> => {
      const outcome = options.revokeOutcome ?? {
        itemId: connection.item_id,
        ok: true,
      };
      if (outcome.ok) rows = rows.filter((r) => r !== connection);
      return outcome;
    }
  );
  const deps: WebhookDeps = {
    plaidEnvironment: "sandbox",
    isAdminConfigured: () => options.adminConfigured ?? true,
    lookupByItemId,
    revoke,
    log: (line) => lines.push(line),
  };
  return { deps, lookupByItemId, revoke, lines };
}

describe("handlePlaidWebhook — USER_PERMISSION_REVOKED", () => {
  it("revokes the one matching row, as its owner, and answers 200", async () => {
    // Red if: the revoke call is removed, or a user id other than the row's is
    // passed.
    const h = harness();
    const decision = await handlePlaidWebhook(revocation(), h.deps);
    expect(decision).toEqual({ status: 200, outcome: "revoked" });
    expect(h.revoke).toHaveBeenCalledTimes(1);
    expect(h.revoke).toHaveBeenCalledWith(OWNER, row());
    expect(h.lookupByItemId).toHaveBeenCalledWith(ITEM_ID);
  });

  it("answers 500 when the revocation fails, so Plaid retries", async () => {
    // Red if: a failed outcome is mapped to 200.
    for (const failure of ["plaid", "row_delete", "crypto_row", "crypto_config"] as const) {
      const h = harness({ revokeOutcome: { itemId: ITEM_ID, ok: false, failure } });
      const decision = await handlePlaidWebhook(revocation(), h.deps);
      expect(decision).toEqual({ status: 500, outcome: "revoke_failed" });
      expect(h.lines[0]).toContain(`failure=${failure}`);
    }
  });

  it("is idempotent: a duplicate delivery revokes once and answers 200 twice", async () => {
    // Red if: zero rows is answered with 500 (Plaid would retry for 24 hours).
    const h = harness();
    const first = await handlePlaidWebhook(revocation(), h.deps);
    const second = await handlePlaidWebhook(revocation(), h.deps);
    expect(first.status).toBe(200);
    expect(second).toEqual({ status: 200, outcome: "unknown_item" });
    expect(h.revoke).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an unknown item", async () => {
    const h = harness({ rows: [] });
    expect(await handlePlaidWebhook(revocation(), h.deps)).toEqual({
      status: 200,
      outcome: "unknown_item",
    });
    expect(h.revoke).not.toHaveBeenCalled();
  });

  it("touches nothing when two rows share the item_id", async () => {
    // Red if: the first row is processed instead.
    const h = harness({ rows: [row(OWNER), row("another-user")] });
    expect(await handlePlaidWebhook(revocation(), h.deps)).toEqual({
      status: 200,
      outcome: "ambiguous_item",
    });
    expect(h.revoke).not.toHaveBeenCalled();
  });

  it("answers 500 and revokes nothing when the lookup fails", async () => {
    // Red if: a failed lookup is read as zero rows.
    const h = harness({ lookupFails: true });
    expect(await handlePlaidWebhook(revocation(), h.deps)).toEqual({
      status: 500,
      outcome: "lookup_failed",
    });
    expect(h.revoke).not.toHaveBeenCalled();
  });

  it("answers 503 before reading when the admin client is not configured", async () => {
    // Red if: the admin gate is removed.
    const h = harness({ adminConfigured: false });
    expect(await handlePlaidWebhook(revocation(), h.deps)).toEqual({
      status: 503,
      outcome: "admin_unconfigured",
    });
    expect(h.lookupByItemId).not.toHaveBeenCalled();
  });

  it("ignores a webhook for another environment, or none", async () => {
    // Red if: the environment comparison is removed.
    for (const environment of ["production", undefined, "SANDBOX"]) {
      const h = harness();
      const decision = await handlePlaidWebhook(
        { ...revocation(), environment },
        h.deps
      );
      expect(decision).toEqual({ status: 200, outcome: "env_mismatch" });
      expect(h.lookupByItemId).not.toHaveBeenCalled();
      expect(h.revoke).not.toHaveBeenCalled();
    }
  });

  it("does nothing without an item_id", async () => {
    const h = harness();
    expect(
      await handlePlaidWebhook({ ...revocation(), item_id: "" }, h.deps)
    ).toEqual({ status: 200, outcome: "malformed" });
    expect(h.lookupByItemId).not.toHaveBeenCalled();
  });
});

describe("handlePlaidWebhook — everything else is logged only", () => {
  const others: Array<[string, string]> = [
    ["ITEM", "ERROR"],
    ["ITEM", "LOGIN_REPAIRED"],
    ["ITEM", "USER_ACCOUNT_REVOKED"],
    ["ITEM", "PENDING_DISCONNECT"],
    ["ITEM", "WEBHOOK_UPDATE_ACKNOWLEDGED"],
    ["TRANSACTIONS", "SYNC_UPDATES_AVAILABLE"],
    ["TRANSACTIONS", "USER_PERMISSION_REVOKED"],
  ];

  it.each(others)("%s / %s: no lookup, no revoke, 200", async (type, code) => {
    // Red if: the code match is widened (startsWith("USER_"), or the type is
    // not checked).
    const h = harness();
    const decision = await handlePlaidWebhook(
      { webhook_type: type, webhook_code: code, item_id: ITEM_ID, environment: "sandbox" },
      h.deps
    );
    expect(decision).toEqual({ status: 200, outcome: "logged" });
    expect(h.lookupByItemId).not.toHaveBeenCalled();
    expect(h.revoke).not.toHaveBeenCalled();
  });

  it("answers 200 malformed for a body without type or code", async () => {
    for (const payload of [null, [], "x", { webhook_type: "ITEM" }, { webhook_code: 1 }]) {
      const h = harness();
      expect(await handlePlaidWebhook(payload, h.deps)).toEqual({
        status: 200,
        outcome: "malformed",
      });
      expect(h.revoke).not.toHaveBeenCalled();
    }
  });
});

describe("handlePlaidWebhook — the log line", () => {
  it("carries the decision fields and none of the payload's URLs or tokens", async () => {
    // Red if: the line interpolates the payload, or new_webhook_url.
    const h = harness();
    await handlePlaidWebhook(
      {
        webhook_type: "ITEM",
        webhook_code: "WEBHOOK_UPDATE_ACKNOWLEDGED",
        item_id: ITEM_ID,
        environment: "sandbox",
        new_webhook_url:
          "https://example.test/api/plaid/webhook?x-vercel-protection-bypass=SECRET",
        error: { error_code: "SOME_CODE", error_message: "account 1234 balance 99" },
      },
      h.deps
    );
    expect(h.lines).toHaveLength(1);
    const line = h.lines[0];
    expect(line).toBe(
      `[plaid-webhook] type=ITEM code=WEBHOOK_UPDATE_ACKNOWLEDGED ` +
        `item_id=${ITEM_ID} env=sandbox outcome=logged error_code=SOME_CODE`
    );
    expect(line).not.toContain("SECRET");
    expect(line).not.toContain("https://");
    expect(line).not.toContain("1234");
  });

  it("names the owner on a revocation, and never the stored token", async () => {
    const h = harness();
    await handlePlaidWebhook(revocation(), h.deps);
    expect(h.lines[0]).toContain(`user_id=${OWNER}`);
    expect(h.lines[0]).toContain(`item_id=${ITEM_ID}`);
    expect(h.lines[0]).not.toContain("v1:iv:tag:ct");
  });

  it("cannot have a field forged through a payload value", async () => {
    // Red if: a payload value is interpolated without logField.
    const h = harness();
    await handlePlaidWebhook(
      {
        webhook_type: "ITEM outcome=revoked",
        webhook_code: "ERROR\nfake=1",
        item_id: "x outcome=revoked",
        environment: "sandbox",
      },
      h.deps
    );
    const line = h.lines[0];
    expect(line).not.toContain("\n");
    expect(line.match(/ outcome=/g)).toHaveLength(1);
    expect(line).toContain("outcome=logged");
  });
});

describe("connectionsByItemIdOrFailure", () => {
  it("returns the rows when every row carries owner, item and token", () => {
    expect(connectionsByItemIdOrFailure({ data: [row()], error: null })).toEqual({
      ok: true,
      rows: [row()],
    });
    expect(connectionsByItemIdOrFailure({ data: [], error: null })).toEqual({
      ok: true,
      rows: [],
    });
  });

  it("reports a failure, never a shorter list", () => {
    // Red if: an error, a non-array or an unreadable row becomes ok: true
    // (the route would answer 200 unknown_item and the webhook is lost).
    expect(connectionsByItemIdOrFailure({ data: null, error: { code: "x" } })).toEqual({ ok: false });
    expect(connectionsByItemIdOrFailure({ data: null, error: null })).toEqual({ ok: false });
    expect(connectionsByItemIdOrFailure({ data: {}, error: null })).toEqual({ ok: false });
    expect(
      connectionsByItemIdOrFailure({
        data: [row(), { item_id: ITEM_ID, access_token: "t" }],
        error: null,
      })
    ).toEqual({ ok: false });
    expect(
      connectionsByItemIdOrFailure({ data: [{ ...row(), user_id: "" }], error: null })
    ).toEqual({ ok: false });
  });

  it("returns only the three named fields", () => {
    const result = connectionsByItemIdOrFailure({
      data: [{ ...row(), institution_name: "Bank", status: "active" }],
      error: null,
    });
    expect(result).toEqual({ ok: true, rows: [row()] });
  });
});
