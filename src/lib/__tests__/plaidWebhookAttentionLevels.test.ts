import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { handlePlaidWebhook, type WebhookDeps } from "../plaidWebhook";
import type { ItemOwnedConnection } from "../plaidApiUtils";

/**
 * Webhooks we only log, but whose line is the only record that a user's bank
 * connection needs attention: they are written as warnings, not info.
 *
 * The outcome stays `logged` and the line is unchanged; only the console
 * method differs. So these tests leave `log` out and watch console.warn and
 * console.info. Each expected level is written out here, not imported, so
 * changing the module's list alone turns a case red.
 *
 * Codes are Plaid's ITEM webhook codes as the SDK documents them
 * (node_modules/plaid/dist/api.d.ts). Whether production sends each of them is
 * a live question this file cannot answer.
 */

const ITEM_ID = "eVBnVMp7zdTJLkRNr33Rs6zr7KNJqBFL9DrE6";
const OWNER = "0b8f6a4e-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

function row(): ItemOwnedConnection {
  return { user_id: OWNER, item_id: ITEM_ID, access_token: "v1:iv:tag:ct" };
}

function webhook(
  type: string,
  code: string,
  error: unknown = null
): Record<string, unknown> {
  return {
    webhook_type: type,
    webhook_code: code,
    item_id: ITEM_ID,
    environment: "sandbox",
    error,
  };
}

type Harness = {
  deps: WebhookDeps;
  lookupByItemId: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
};

/** A revocation succeeds; no `log`, so the console is the sink. */
function harness(): Harness {
  const lookupByItemId = vi.fn(async () => ({ ok: true as const, rows: [row()] }));
  const revoke = vi.fn(async (_userId: string, connection: ItemOwnedConnection) => ({
    itemId: connection.item_id,
    ok: true,
  }));
  return {
    deps: {
      plaidEnvironment: "sandbox",
      isAdminConfigured: () => true,
      lookupByItemId,
      revoke,
    },
    lookupByItemId,
    revoke,
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

/** The one line written, and the one method that wrote it. */
function written(): { level: "error" | "warn" | "info"; line: string } {
  const calls = (["error", "warn", "info"] as const).flatMap((level) =>
    spies[level].mock.calls.map((call) => ({ level, line: String(call[0]) }))
  );
  expect(calls).toHaveLength(1);
  return calls[0];
}

async function logged(payload: Record<string, unknown>) {
  const h = harness();
  const decision = await handlePlaidWebhook(payload, h.deps);
  // The response and the outcome are what they were; only the level moves.
  expect(decision).toEqual({ status: 200, outcome: "logged" });
  return { h, out: written() };
}

describe("ITEM webhooks that need the user's attention are warnings", () => {
  it("ERROR with no error body", async () => {
    // Red if: "ERROR" is removed from ITEM_ATTENTION_CODES.
    const { out } = await logged(webhook("ITEM", "ERROR"));
    expect(out.level).toBe("warn");
    expect(out.line).toContain(" outcome=logged");
  });

  it("ERROR with its error code, which the line names", async () => {
    // Red if: the override level is changed from "warn".
    const { out } = await logged(
      webhook("ITEM", "ERROR", { error_code: "ITEM_LOGIN_REQUIRED" })
    );
    expect(out.level).toBe("warn");
    expect(out.line.endsWith(" outcome=logged error_code=ITEM_LOGIN_REQUIRED")).toBe(
      true
    );
  });

  it("PENDING_DISCONNECT", async () => {
    // Red if: "PENDING_DISCONNECT" is removed from ITEM_ATTENTION_CODES.
    const { out } = await logged(webhook("ITEM", "PENDING_DISCONNECT"));
    expect(out.level).toBe("warn");
  });

  it("PENDING_EXPIRATION", async () => {
    // Red if: "PENDING_EXPIRATION" is removed from ITEM_ATTENTION_CODES.
    const { out } = await logged(webhook("ITEM", "PENDING_EXPIRATION"));
    expect(out.level).toBe("warn");
  });

  it("USER_ACCOUNT_REVOKED, without looking up or revoking anything", async () => {
    // Red if: "USER_ACCOUNT_REVOKED" is removed from ITEM_ATTENTION_CODES, or
    // added to REVOCATION_CODES (the outcome would no longer be `logged`).
    const { h, out } = await logged(webhook("ITEM", "USER_ACCOUNT_REVOKED"));
    expect(out.level).toBe("warn");
    expect(h.lookupByItemId).not.toHaveBeenCalled();
    expect(h.revoke).not.toHaveBeenCalled();
  });
});

describe("routine ITEM webhooks stay info", () => {
  it.each(["LOGIN_REPAIRED", "NEW_ACCOUNTS_AVAILABLE", "WEBHOOK_UPDATE_ACKNOWLEDGED", "SOME_FUTURE_CODE"])(
    "%s",
    async (code) => {
      // Red if: this code is added to ITEM_ATTENTION_CODES, or the attention
      // check stops looking at the code.
      const { out } = await logged(webhook("ITEM", code));
      expect(out.level).toBe("info");
    }
  );
});

describe("a webhook carrying an error is a warning, whatever its type", () => {
  it("an ITEM code that is otherwise routine, with an error code", async () => {
    // Red if: the error-presence condition is dropped.
    const { out } = await logged(
      webhook("ITEM", "WEBHOOK_UPDATE_ACKNOWLEDGED", { error_code: "X" })
    );
    expect(out.level).toBe("warn");
    expect(out.line.endsWith(" error_code=X")).toBe(true);
  });

  it("an error without a string code: still a warning, and the line names no code", async () => {
    // Red if: the condition is narrowed to a string error_code.
    const { out } = await logged(
      webhook("ITEM", "WEBHOOK_UPDATE_ACKNOWLEDGED", { error_message: "m" })
    );
    expect(out.level).toBe("warn");
    expect(out.line).not.toContain("error_code=");
  });

  it("a TRANSACTIONS webhook: info without an error, warning with one", async () => {
    // Red if: the error condition is limited to ITEM webhooks.
    const plain = await logged(webhook("TRANSACTIONS", "SYNC_UPDATES_AVAILABLE"));
    expect(plain.out.level).toBe("info");

    vi.clearAllMocks();
    const withError = await logged(
      webhook("TRANSACTIONS", "SYNC_UPDATES_AVAILABLE", { error_code: "X" })
    );
    expect(withError.out.level).toBe("warn");
  });

  it("an attention code under another type, with no error, stays info", async () => {
    // Red if: the `type === "ITEM"` check is dropped from the code condition.
    const { out } = await logged(webhook("TRANSACTIONS", "ERROR"));
    expect(out.level).toBe("info");
  });
});

describe("the override applies to logged webhooks only", () => {
  it("a revocation that carries an error is still info", async () => {
    // Red if: the `outcome === "logged"` guard is dropped, so the override
    // would make a completed revocation a warning.
    const h = harness();
    const decision = await handlePlaidWebhook(
      webhook("ITEM", "USER_PERMISSION_REVOKED", { error_code: "X" }),
      h.deps
    );
    expect(decision).toEqual({ status: 200, outcome: "revoked" });
    const out = written();
    expect(out.level).toBe("info");
    expect(out.line).toContain(" outcome=revoked");
  });

  it("an injected log receives the line and the console receives nothing", async () => {
    // Red if: decide writes to the console as well as to an injected log.
    const h = harness();
    const received: string[] = [];
    await handlePlaidWebhook(webhook("ITEM", "ERROR"), {
      ...h.deps,
      log: (line) => received.push(line),
    });
    expect(received).toHaveLength(1);
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
  });
});
