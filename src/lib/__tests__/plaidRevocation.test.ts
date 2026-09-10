import { describe, it, expect, vi } from "vitest";
import {
  classifyCryptoFailure,
  revokeAndDeleteConnection,
  revokeAndDeleteConnections,
  type RevocableConnection,
  type RevocationDeps,
} from "../plaidRevocation";
import { PlaidTokenCryptoError } from "../plaidTokenCrypto";
import { redactPlaidAxiosError } from "../plaidErrorRedaction";

/**
 * The pairing rule: a connection's row is deleted ONLY after its Plaid Item has
 * actually been revoked.
 *
 * WHAT THIS FILE PROVES, AND HOW IT DIFFERS FROM THE REST OF THE SUITE
 * It EXECUTES the code under test. plaidConnectionReadWiring.test.ts and
 * plaidTokenReadSites.test.ts are source-text probes and say so in their own
 * headers; this file is not one. Every assertion below observes a call that was
 * or was not made, through the real functions, with plain injected fakes and no
 * vi.mock anywhere. That is possible because plaidRevocation.ts takes its
 * dependencies as arguments — the seam exists so this file can exist.
 *
 * EVERY TEST HERE WAS MEASURED RED BEFORE BEING TRUSTED. Each `it` names the
 * mutation that was applied to plaidRevocation.ts to confirm it fails, and the
 * mutations were applied and run one at a time, not reasoned about. A test that
 * has never been seen to fail is not a defense — the same standard the rest of
 * this suite's headers hold themselves to.
 *
 * WHAT IT DOES NOT PROVE
 * Nothing about the routes. Whether either route actually calls these functions,
 * in the right order, with a userId from a verified token, is not visible from
 * here — accountDeletion.test.ts covers the account-deletion decision, and the
 * routes' own wiring above that is covered by neither.
 */

/** Fixture ciphertext. Shaped like a stored value; never decrypted for real. */
function connection(itemId: string): RevocableConnection {
  return {
    item_id: itemId,
    access_token: `v1:${itemId}-iv:${itemId}-tag:${itemId}-ciphertext`,
  };
}

/**
 * An axios-shaped Plaid error carrying `code`, pushed through the real
 * redaction function — the same construction plaidApiUtils.test.ts uses, for
 * the same reason: the SDK rejects with an AxiosError whose message is
 * "Request failed with status code <n>", so a fixture built any other way would
 * not exercise what the code actually receives.
 */
function plaidRejection(code: string, status = 400): unknown {
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
    data: { error_type: "ITEM_ERROR", error_code: code },
  };
  return redactPlaidAxiosError(error);
}

/** Deps that succeed at everything, with spies on each step. */
function passingDeps(): RevocationDeps & {
  decrypt: ReturnType<typeof vi.fn>;
  itemRemove: ReturnType<typeof vi.fn>;
  deleteRow: ReturnType<typeof vi.fn>;
} {
  return {
    decrypt: vi.fn((stored: string) => `plaintext-for-${stored}`),
    itemRemove: vi.fn(async () => undefined),
    deleteRow: vi.fn(async () => true),
    log: () => {},
  };
}

/** The item_ids handed to deleteRow, in order. */
function deletedItemIds(deps: { deleteRow: ReturnType<typeof vi.fn> }): string[] {
  return deps.deleteRow.mock.calls.map((call) => call[1] as string);
}

describe("revokeAndDeleteConnections — only revoked connections lose their row", () => {
  it("deletes the rows of the connections that were revoked, and no others", async () => {
    // MUTATION MEASURED RED: moving the deleteRow call above the itemRemove call
    // in revokeAndDeleteConnection (i.e. restoring the old delete-then-revoke
    // behaviour) makes item_2's row be deleted and fails this test.
    const deps = passingDeps();
    deps.itemRemove.mockImplementation(async (token: string) => {
      if (token.indexOf("item_2") !== -1) {
        throw plaidRejection("INTERNAL_SERVER_ERROR", 500);
      }
    });

    const summary = await revokeAndDeleteConnections(
      "user_1",
      [connection("item_1"), connection("item_2"), connection("item_3")],
      deps
    );

    expect(deletedItemIds(deps)).toEqual(["item_1", "item_3"]);
    expect(summary.outcomes.map((outcome) => outcome.ok)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("counts every connection whose row was left behind", async () => {
    // MUTATION MEASURED RED: returning a constant 0 for `remaining` fails here.
    const deps = passingDeps();
    deps.itemRemove.mockImplementation(async (token: string) => {
      if (token.indexOf("item_2") !== -1) {
        throw plaidRejection("INTERNAL_SERVER_ERROR", 500);
      }
    });

    const summary = await revokeAndDeleteConnections(
      "user_1",
      [connection("item_1"), connection("item_2"), connection("item_3")],
      deps
    );

    expect(summary.remaining).toBe(1);
  });
});

describe("revokeAndDeleteConnection — no Plaid error code is folded into success", () => {
  // The allow-list proof, from the other direction to plaidApiUtils.test.ts:
  // there, no unmapped code may acquire the re-link errorType. Here, NO code at
  // all may acquire a row deletion. ITEM_NOT_FOUND is the one that invites it —
  // "the Item is already gone, so removing the row is safe" is a plausible
  // reading and it is not one this module is allowed to make on a guess.
  const codes = [
    "ITEM_NOT_FOUND",
    "ITEM_LOGIN_REQUIRED",
    "INVALID_ACCESS_TOKEN",
    "RATE_LIMIT_EXCEEDED",
    "INVALID_API_KEYS",
    "INTERNAL_SERVER_ERROR",
  ];

  it.each(codes)("keeps the row when itemRemove rejects with %s", async (code) => {
    // MUTATION MEASURED RED: adding an early `if (getPlaidErrorCode(error) ===
    // "ITEM_NOT_FOUND") { ...deleteRow...; return { itemId, ok: true }; }` to the
    // itemRemove catch fails the ITEM_NOT_FOUND case of this test.
    const deps = passingDeps();
    deps.itemRemove.mockRejectedValue(plaidRejection(code));

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome).toEqual({ itemId: "item_1", ok: false, failure: "plaid" });
    expect(deps.deleteRow).not.toHaveBeenCalled();
  });
});

describe("revokeAndDeleteConnection — key-level and row-level crypto failures", () => {
  it("reports a key-level decrypt failure as crypto_config", async () => {
    // MUTATION MEASURED RED: collapsing classifyCryptoFailure to always return
    // "crypto_row" fails this test.
    const deps = passingDeps();
    deps.decrypt.mockImplementation(() => {
      throw new PlaidTokenCryptoError(
        "key_missing",
        "PLAID_TOKEN_ENCRYPTION_KEY is not set."
      );
    });

    const summary = await revokeAndDeleteConnections(
      "user_1",
      [connection("item_1")],
      deps
    );

    expect(summary.outcomes[0].failure).toBe("crypto_config");
    expect(summary.sawCryptoConfigFailure).toBe(true);
  });

  it("reports a row-level decrypt failure as crypto_row", async () => {
    // The other half. A single unreadable row must not be reported as a broken
    // deployment — that would tell the user to wait for a fix that is not coming.
    const deps = passingDeps();
    deps.decrypt.mockImplementation(() => {
      throw new PlaidTokenCryptoError(
        "auth_failed",
        "Stored Plaid access token failed authentication."
      );
    });

    const summary = await revokeAndDeleteConnections(
      "user_1",
      [connection("item_1")],
      deps
    );

    expect(summary.outcomes[0].failure).toBe("crypto_row");
    expect(summary.sawCryptoConfigFailure).toBe(false);
  });

  it("classifies a non-crypto error as row-level rather than configuration", () => {
    // classifyCryptoFailure is reachable directly, so the guard that decides
    // whether `reason` may be read at all gets its own line.
    expect(classifyCryptoFailure(new Error("something else"))).toBe("crypto_row");
    expect(classifyCryptoFailure(undefined)).toBe("crypto_row");
  });
});

describe("revokeAndDeleteConnection — a failure consumes nothing", () => {
  it("does not revoke or delete when the token cannot be decrypted", async () => {
    // This is what makes a retry safe, and it is the property E-1 of the plan
    // rests on: no step after the failure runs, so calling again is equivalent
    // to calling once.
    //
    // MUTATION MEASURED RED: replacing the `return` in the decrypt catch with a
    // fallthrough (continuing to itemRemove with an empty token) fails this test.
    const deps = passingDeps();
    deps.decrypt.mockImplementation(() => {
      throw new PlaidTokenCryptoError("malformed", "not the expected form");
    });

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome.ok).toBe(false);
    expect(deps.itemRemove).not.toHaveBeenCalled();
    expect(deps.deleteRow).not.toHaveBeenCalled();
  });

  it("passes the userId through to decrypt unmodified", async () => {
    // The userId is the AAD the ciphertext is bound to. A trimmed, lowercased or
    // otherwise "cleaned" value fails to decrypt, and that failure is invisible
    // to tsc and to the crypto unit tests.
    const deps = passingDeps();

    await revokeAndDeleteConnection("User_MixedCase_1", connection("item_1"), deps);

    expect(deps.decrypt).toHaveBeenCalledWith(
      connection("item_1").access_token,
      "User_MixedCase_1"
    );
  });
});

describe("revokeAndDeleteConnection — the row delete", () => {
  it("treats a failed delete as a failure, not as a success", async () => {
    // MUTATION MEASURED RED: ignoring deleteRow's return value and always
    // returning { ok: true } fails this test.
    const deps = passingDeps();
    deps.deleteRow.mockResolvedValue(false);

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome).toEqual({
      itemId: "item_1",
      ok: false,
      failure: "row_delete",
    });
  });

  it("retries the delete once before giving up", async () => {
    // The Item is already revoked at this point, so this is the one window a
    // whole-operation retry cannot reopen (the next itemRemove would target an
    // Item that no longer exists, and this module does not fold that into
    // success). One idempotent retry closes the single-transient-failure case.
    //
    // MUTATION MEASURED RED: removing the second deleteRow call fails this test.
    const deps = passingDeps();
    deps.deleteRow
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome.ok).toBe(true);
    expect(deps.deleteRow).toHaveBeenCalledTimes(2);
  });

  it("does not retry a delete that succeeded", async () => {
    const deps = passingDeps();

    await revokeAndDeleteConnection("user_1", connection("item_1"), deps);

    expect(deps.deleteRow).toHaveBeenCalledTimes(1);
  });
});

describe("revokeAndDeleteConnections — the empty and all-success cases", () => {
  it("reports nothing remaining for a user with no connections", async () => {
    const deps = passingDeps();

    const summary = await revokeAndDeleteConnections("user_1", [], deps);

    expect(summary).toEqual({
      outcomes: [],
      remaining: 0,
      sawCryptoConfigFailure: false,
    });
    expect(deps.itemRemove).not.toHaveBeenCalled();
  });

  it("reports nothing remaining when every connection is revoked and deleted", async () => {
    const deps = passingDeps();

    const summary = await revokeAndDeleteConnections(
      "user_1",
      [connection("item_1"), connection("item_2")],
      deps
    );

    expect(summary.remaining).toBe(0);
    expect(deletedItemIds(deps)).toEqual(["item_1", "item_2"]);
  });
});
