import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  exchangeForUser,
  type ExchangeDeps,
  type ExchangeInput,
} from "../plaidExchange";
import {
  revokeAndDeleteConnection,
  type RevocationDeps,
} from "../plaidRevocation";
import { redactPlaidAxiosError } from "../plaidErrorRedaction";

/**
 * Which console method each `[plaid-exchange]` and `[plaid-revoke]` line is
 * written with when no `log` is injected — the production wiring.
 *
 * The level is what the log viewer shows, so it decides whether a success
 * reads as a failure. Failures someone may have to act on are errors; a
 * failure the request may still recover from is a warning; outcomes,
 * including deliberate refusals, are info.
 *
 * Every other test of these modules injects `log`, which receives the line
 * only, so none of them can see the level. These do not inject it and watch
 * the three console methods instead. The line TEXT is held by those other
 * tests; here a line is found by its key field.
 *
 * Each `it` names the mutation that turns it red.
 */

const USER = "user-levels-4c1a";
const ITEM = "item-levels-7d20";
const ACCESS = "access-sandbox-levels-0000";

/** An axios-shaped Plaid rejection pushed through the real redaction. */
function plaidRejection(code: string, type = "ITEM_ERROR", status = 400): unknown {
  const error = new Error(`Request failed with status code ${status}`) as Error &
    Record<string, unknown>;
  error.name = "AxiosError";
  error.isAxiosError = true;
  error.config = {
    url: "https://sandbox.plaid.com/item/remove",
    method: "post",
    headers: { "PLAID-SECRET": "FAKE_SECRET_never_real" },
  };
  error.response = {
    status,
    statusText: "Bad Request",
    data: { error_type: type, error_code: code },
  };
  return redactPlaidAxiosError(error);
}

type Spies = {
  error: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  info: ReturnType<typeof vi.spyOn>;
};

let spies: Spies;

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

/** The lines one console method received, as strings. */
function lines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

/** The one method that received a line containing `field`. */
function levelOf(field: string): "error" | "warn" | "info" {
  const found = (["error", "warn", "info"] as const).filter((level) =>
    lines(spies[level]).some((line) => line.includes(field))
  );
  expect(found, `methods that received ${field}`).toHaveLength(1);
  return found[0];
}

// ---------------------------------------------------------------------------
// [plaid-exchange]
// ---------------------------------------------------------------------------

/** Everything succeeds; no `log`, so the console is the sink. */
function exchangeDeps(): ExchangeDeps & {
  findActiveByInstitution: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
  itemRemove: ReturnType<typeof vi.fn>;
} {
  return {
    countConnections: vi.fn(async () => 1),
    findActiveByInstitution: vi.fn(async () => null),
    exchange: vi.fn(async () => ({ accessToken: ACCESS, itemId: ITEM })),
    itemGet: vi.fn(async () => ({
      institutionId: "ins_server",
      institutionName: "Server Bank",
    })),
    findOwnItem: vi.fn(async () => ({ ok: true as const, connection: null })),
    store: vi.fn(async () => ({ ok: true as const })),
    itemRemove: vi.fn(async () => "req_levels"),
    plaidEnvironment: "sandbox",
  };
}

const INPUT: ExchangeInput = {
  publicToken: "public-sandbox-levels",
  institutionId: "ins_client",
  institutionName: "Client Bank",
};

describe("[plaid-exchange] levels without an injected log", () => {
  it("a stored connection logs at info only", async () => {
    // MUTATION: writeLogLine's info case writing with console.error, or emit
    // ignoring its level.
    await exchangeForUser(USER, INPUT, exchangeDeps());
    expect(levelOf(" minted")).toBe("info");
    expect(levelOf("resolved=stored")).toBe("info");
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
  });

  it("a failed pre-exchange duplicate read is a warning", async () => {
    // MUTATION: the dedupe_read=failed emit passing "error" (or "info").
    const deps = exchangeDeps();
    deps.findActiveByInstitution
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValue(null);
    await exchangeForUser(USER, INPUT, deps);
    expect(levelOf("dedupe_read=failed")).toBe("warn");
  });

  it("a crypto store refusal is an error; its compensating revoke is info", async () => {
    // MUTATION: the store_crypto refuse passing "info", or refuse ignoring
    // its level; the compensate=revoked emit passing "error".
    const deps = exchangeDeps();
    deps.store.mockResolvedValue({ ok: false, kind: "crypto", dbErrorCode: null });
    await exchangeForUser(USER, INPUT, deps);
    expect(levelOf("refused=store_crypto")).toBe("error");
    expect(levelOf("compensate=revoked")).toBe("info");
  });

  it("a post-exchange duplicate refusal is info", async () => {
    // MUTATION: the post_duplicate refuse passing "error".
    const deps = exchangeDeps();
    deps.findActiveByInstitution.mockResolvedValue({
      institution_name: "Server Bank",
      institution_id: "ins_server",
    });
    await exchangeForUser(USER, { ...INPUT, institutionId: undefined }, deps);
    expect(levelOf("refused=post_duplicate")).toBe("info");
  });

  it("a failed compensating revoke is an error", async () => {
    // MUTATION: the compensate=failed emit passing "warn" or "info".
    const deps = exchangeDeps();
    deps.store.mockResolvedValue({ ok: false, kind: "crypto", dbErrorCode: null });
    deps.itemRemove.mockRejectedValue(plaidRejection("INTERNAL_SERVER_ERROR", "API_ERROR", 500));
    await exchangeForUser(USER, INPUT, deps);
    expect(levelOf("compensate=failed")).toBe("error");
  });

  it("an ambiguous store failure warns, and the recheck that finds the row is info", async () => {
    // MUTATION: the store_failed emit passing "error"; the row_present or
    // stage=recheck emits passing anything but "info".
    const deps = exchangeDeps();
    deps.store.mockResolvedValue({ ok: false, kind: "db", dbErrorCode: null });
    (deps.findOwnItem as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, connection: null })
      .mockResolvedValue({
        ok: true,
        connection: { institution_name: "Server Bank", institution_id: "ins_server" },
      });
    await exchangeForUser(USER, INPUT, deps);
    expect(levelOf("store_failed")).toBe("warn");
    expect(levelOf("revoke=skipped reason=row_present")).toBe("info");
    expect(levelOf("resolved=already_stored stage=recheck")).toBe("info");
  });

  it("an injected log receives the line and the console receives nothing", async () => {
    // MUTATION: emit writing to the console as well as to an injected log.
    const received: string[] = [];
    await exchangeForUser(USER, INPUT, {
      ...exchangeDeps(),
      log: (line) => received.push(line),
    });
    expect(received.some((line) => line.endsWith(" minted"))).toBe(true);
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// [plaid-revoke]
// ---------------------------------------------------------------------------

const CONNECTION = { item_id: ITEM, access_token: "v1:iv:tag:ciphertext" };

function revocationDeps(): RevocationDeps & {
  decrypt: ReturnType<typeof vi.fn>;
  itemRemove: ReturnType<typeof vi.fn>;
  deleteRow: ReturnType<typeof vi.fn>;
} {
  return {
    decrypt: vi.fn(() => ACCESS),
    itemRemove: vi.fn(async () => "req_levels"),
    deleteRow: vi.fn(async () => ({ ok: true as const, deleted: 1 })),
    plaidEnvironment: "sandbox",
  };
}

describe("[plaid-revoke] levels without an injected log", () => {
  it("a revoked and deleted connection logs at info only", async () => {
    // MUTATION: the resolved= or deleted= emit passing "error".
    await revokeAndDeleteConnection(USER, CONNECTION, revocationDeps());
    expect(levelOf("resolved=revoked")).toBe("info");
    expect(levelOf("deleted=1")).toBe("info");
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
  });

  it("a row delete that succeeds on retry warns, then logs the count at info", async () => {
    // MUTATION: the retrying=row_delete emit passing "error".
    const deps = revocationDeps();
    deps.deleteRow
      .mockResolvedValueOnce({ ok: false, dbErrorCode: "40001" })
      .mockResolvedValue({ ok: true, deleted: 1 });
    await revokeAndDeleteConnection(USER, CONNECTION, deps);
    expect(levelOf("retrying=row_delete")).toBe("warn");
    expect(levelOf("deleted=1")).toBe("info");
    expect(spies.error).not.toHaveBeenCalled();
  });

  it("decrypt, Plaid and row-delete failures are errors", async () => {
    // MUTATION: any of the three failure= emits passing "warn" or "info".
    const crypto = revocationDeps();
    crypto.decrypt.mockImplementation(() => {
      throw new Error("will not decrypt");
    });
    await revokeAndDeleteConnection(USER, CONNECTION, crypto);
    expect(levelOf("failure=crypto_row")).toBe("error");

    const plaid = revocationDeps();
    plaid.itemRemove.mockRejectedValue(plaidRejection("INVALID_ACCESS_TOKEN", "INVALID_INPUT"));
    await revokeAndDeleteConnection(USER, CONNECTION, plaid);
    expect(levelOf("failure=plaid")).toBe("error");

    const rowDelete = revocationDeps();
    rowDelete.deleteRow.mockResolvedValue({ ok: false, dbErrorCode: "08006" });
    await revokeAndDeleteConnection(USER, CONNECTION, rowDelete);
    expect(levelOf("failure=row_delete")).toBe("error");
  });

  it("an Item confirmed already gone is info", async () => {
    // MUTATION: the resolved= emit passing anything but "info" on the fold.
    const deps = revocationDeps();
    deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_NOT_FOUND"));
    await revokeAndDeleteConnection(USER, CONNECTION, deps);
    expect(levelOf("resolved=item_not_found")).toBe("info");
    expect(spies.error).not.toHaveBeenCalled();
  });

  it("an injected log receives the line and the console receives nothing", async () => {
    // MUTATION: emit writing to the console as well as to an injected log.
    const received: string[] = [];
    await revokeAndDeleteConnection(USER, CONNECTION, {
      ...revocationDeps(),
      log: (line) => received.push(line),
    });
    expect(received.some((line) => line.includes("resolved=revoked"))).toBe(true);
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
  });
});
