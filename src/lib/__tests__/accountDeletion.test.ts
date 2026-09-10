import { describe, it, expect, vi } from "vitest";
import {
  deleteAccountForUser,
  type AccountDeletionDeps,
} from "../accountDeletion";
import type {
  RevocableConnection,
  RevocationSummary,
} from "../plaidRevocation";

/**
 * The account-deletion decision, executed.
 *
 * THE GUARANTEE THIS FILE EXISTS FOR IS A NEGATIVE ONE: when a Plaid connection
 * could not be revoked, the user's rows are NOT deleted. "Not deleted" cannot be
 * read off the source — it has to be observed as a call that did not happen —
 * which is why the decision was lifted out of the route into accountDeletion.ts
 * and why every assertion below runs the real function.
 *
 * EVERY TEST HERE WAS MEASURED RED BEFORE BEING TRUSTED. Each names the
 * mutation applied to accountDeletion.ts to confirm it fails, applied and run
 * one at a time. Of particular note, the ordering test named below is red
 * against the behaviour this change replaces: the admin client used to be
 * constructed after the Plaid loop, so a deployment missing the service-role
 * key revoked every bank connection and then died on an unhandled throw.
 *
 * WHAT IT DOES NOT PROVE
 * Nothing about the route above it. Whether POST /api/account/delete verifies
 * the token, builds these dependencies correctly, or serializes this result is
 * not visible from here. Nothing in this suite executes a route handler, and
 * this file does not change that.
 */

/** A sentinel that must never reach a response body. */
const SENTINEL = "SENTINEL_never_in_a_response_4c81de";

function connection(itemId: string): RevocableConnection {
  return {
    item_id: itemId,
    access_token: `v1:${itemId}-iv:${itemId}-tag:${SENTINEL}`,
  };
}

function summary(overrides: Partial<RevocationSummary> = {}): RevocationSummary {
  return {
    outcomes: [],
    remaining: 0,
    sawCryptoConfigFailure: false,
    ...overrides,
  };
}

type SpiedDeps = AccountDeletionDeps & {
  isPlaidConfigured: ReturnType<typeof vi.fn>;
  isCryptoConfigured: ReturnType<typeof vi.fn>;
  isAdminConfigured: ReturnType<typeof vi.fn>;
  listConnections: ReturnType<typeof vi.fn>;
  revokeAll: ReturnType<typeof vi.fn>;
  deleteUsersRow: ReturnType<typeof vi.fn>;
  deleteAuthUser: ReturnType<typeof vi.fn>;
};

/** Everything configured, one connection, everything succeeds. */
function happyDeps(): SpiedDeps {
  return {
    isPlaidConfigured: vi.fn(() => true),
    isCryptoConfigured: vi.fn(() => true),
    isAdminConfigured: vi.fn(() => true),
    listConnections: vi.fn(async () => [connection("item_1")]),
    revokeAll: vi.fn(async () => summary({ remaining: 0 })),
    deleteUsersRow: vi.fn(async () => ({ deletedCount: 1, error: null })),
    deleteAuthUser: vi.fn(async () => ({ error: null })),
    log: () => {},
  };
}

describe("deleteAccountForUser — an un-revoked connection stops the deletion", () => {
  it("does not delete the users row or the auth user when a connection remains", async () => {
    // THE central assertion of this change.
    //
    // MUTATION MEASURED RED: changing the gate to `if (summary.remaining < 0)`
    // — or deleting the gate outright — lets both deletions run and fails here.
    const deps = happyDeps();
    deps.listConnections.mockResolvedValue([
      connection("item_1"),
      connection("item_2"),
    ]);
    deps.revokeAll.mockResolvedValue(summary({ remaining: 1 }));

    const result = await deleteAccountForUser("user_1", deps);

    expect(deps.deleteUsersRow).not.toHaveBeenCalled();
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
    expect(result.status).toBe(500);
    expect(result.body.code).toBe("REVOKE_INCOMPLETE");
  });

  it("completes the deletion when nothing remains, users before auth", async () => {
    // The other half: the gate must not block a clean run, and the two
    // deletions keep their order. Auth last is load-bearing — deleting it first
    // invalidates the token this request authenticated with.
    //
    // MUTATION MEASURED RED: swapping the two calls fails the order assertion.
    const deps = happyDeps();

    const result = await deleteAccountForUser("user_1", deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(deps.deleteUsersRow).toHaveBeenCalledWith("user_1");
    expect(deps.deleteAuthUser).toHaveBeenCalledWith("user_1");
    expect(deps.deleteUsersRow.mock.invocationCallOrder[0]).toBeLessThan(
      deps.deleteAuthUser.mock.invocationCallOrder[0]
    );
  });

  it("passes the userId to the revocation step unmodified", async () => {
    // It is the AAD the stored ciphertext is bound to; a normalized value fails
    // to decrypt, invisibly to tsc.
    const deps = happyDeps();

    await deleteAccountForUser("User_MixedCase_1", deps);

    expect(deps.revokeAll).toHaveBeenCalledWith("User_MixedCase_1", [
      connection("item_1"),
    ]);
  });
});

describe("deleteAccountForUser — preconditions are checked before anything is spent", () => {
  it("refuses on a missing admin client without revoking anything", async () => {
    // THIS TEST IS RED AGAINST THE BEHAVIOUR THIS CHANGE REPLACES. The admin
    // client used to be constructed after the Plaid loop with no try around it,
    // so a deployment missing SUPABASE_SERVICE_ROLE_KEY revoked every one of the
    // user's bank connections and then threw — the irreversible half done, the
    // rest not started.
    //
    // MUTATION MEASURED RED: moving the isAdminConfigured check below the
    // revokeAll call reproduces exactly that ordering and fails here.
    const deps = happyDeps();
    deps.isAdminConfigured.mockReturnValue(false);

    const result = await deleteAccountForUser("user_1", deps);

    expect(deps.revokeAll).not.toHaveBeenCalled();
    expect(deps.deleteUsersRow).not.toHaveBeenCalled();
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
    expect(result.status).toBe(500);
    expect(result.body.code).toBe("ADMIN_UNCONFIGURED");
  });

  it("refuses on an unconfigured encryption key without entering the loop", async () => {
    // Without the key the tokens cannot be decrypted, so nothing can be revoked
    // — and under the pairing rule nothing may be deleted either. Refusing at
    // the door reports a configuration fault as one, instead of as N identical
    // per-connection failures.
    //
    // MUTATION MEASURED RED: moving this check below the revokeAll call fails
    // the "revokeAll not called" assertion.
    const deps = happyDeps();
    deps.isCryptoConfigured.mockReturnValue(false);

    const result = await deleteAccountForUser("user_1", deps);

    expect(deps.revokeAll).not.toHaveBeenCalled();
    expect(deps.deleteUsersRow).not.toHaveBeenCalled();
    expect(result.status).toBe(503);
    expect(result.body.code).toBe("PLAID_CRYPTO_UNCONFIGURED");
  });

  it("refuses on unconfigured Plaid credentials the same way", async () => {
    const deps = happyDeps();
    deps.isPlaidConfigured.mockReturnValue(false);

    const result = await deleteAccountForUser("user_1", deps);

    expect(deps.revokeAll).not.toHaveBeenCalled();
    expect(result.status).toBe(503);
    expect(result.body.code).toBe("PLAID_CRYPTO_UNCONFIGURED");
  });

  it("still deletes the account when Plaid is unconfigured and there is nothing to revoke", async () => {
    // The gate is on `connections.length > 0` for this case. A deployment with
    // no Plaid credentials and a user with no connections has nothing to do, and
    // must not be blocked from deleting their account by a check about Plaid.
    //
    // MUTATION MEASURED RED: dropping the `connections.length > 0` condition
    // turns this into a 503 and fails here.
    const deps = happyDeps();
    deps.listConnections.mockResolvedValue([]);
    deps.isPlaidConfigured.mockReturnValue(false);
    deps.isCryptoConfigured.mockReturnValue(false);

    const result = await deleteAccountForUser("user_1", deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(deps.deleteUsersRow).toHaveBeenCalled();
  });

  it("refuses when the connection read failed, rather than treating it as empty", async () => {
    // null is "we do not know", not "there are none". Proceeding would delete
    // the rows holding the only copies of tokens for Items nobody revoked.
    //
    // MUTATION MEASURED RED: replacing the null check with `?? []` (the reading
    // the null invites) deletes the account and fails here.
    const deps = happyDeps();
    deps.listConnections.mockResolvedValue(null);

    const result = await deleteAccountForUser("user_1", deps);

    expect(deps.revokeAll).not.toHaveBeenCalled();
    expect(deps.deleteUsersRow).not.toHaveBeenCalled();
    expect(result.status).toBe(500);
    expect(result.body.code).toBe("CONNECTION_READ_FAILED");
  });
});

describe("deleteAccountForUser — a configuration fault is not a data-deletion failure", () => {
  it("answers a key-level crypto failure from inside the loop as a configuration fault", async () => {
    // isCryptoConfigured() cannot see a key that disappeared between the check
    // and the loop, nor a row carrying an unknown version tag. This is the
    // second half of that defense.
    //
    // MUTATION MEASURED RED: deleting this branch drops the case through to the
    // remaining-count gate, which answers 500 / REVOKE_INCOMPLETE instead.
    const deps = happyDeps();
    deps.revokeAll.mockResolvedValue(
      summary({ remaining: 1, sawCryptoConfigFailure: true })
    );

    const result = await deleteAccountForUser("user_1", deps);

    expect(result.status).toBe(503);
    expect(result.body.code).toBe("PLAID_CRYPTO_UNCONFIGURED");
    expect(deps.deleteUsersRow).not.toHaveBeenCalled();
  });

  it("gives the two causes different statuses, codes and wording", async () => {
    // The user-visible half of the split. A server fault must not tell the user
    // to try again — pressing the button ten more times changes nothing, and the
    // retry wording presents our misconfiguration as something they did wrong.
    //
    // MUTATION MEASURED RED: giving both branches the same status, or the same
    // message constant, fails here.
    const retryableDeps = happyDeps();
    retryableDeps.revokeAll.mockResolvedValue(summary({ remaining: 1 }));
    const retryable = await deleteAccountForUser("user_1", retryableDeps);

    const serverFaultDeps = happyDeps();
    serverFaultDeps.isCryptoConfigured.mockReturnValue(false);
    const serverFault = await deleteAccountForUser("user_1", serverFaultDeps);

    expect(retryable.status).not.toBe(serverFault.status);
    expect(retryable.body.code).not.toBe(serverFault.body.code);
    expect(retryable.body.error).not.toBe(serverFault.body.error);

    expect(String(retryable.body.error)).toContain("try again");
    expect(String(serverFault.body.error)).not.toContain("try again");
  });
});

describe("deleteAccountForUser — the two irreversible steps", () => {
  it("reports a users-row failure without touching the auth user", async () => {
    const deps = happyDeps();
    deps.deleteUsersRow.mockResolvedValue({
      deletedCount: 0,
      error: new Error(`query failed ${SENTINEL}`),
    });

    const result = await deleteAccountForUser("user_1", deps);

    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
    expect(result.status).toBe(500);
    expect(result.body.error).toBe("Failed to delete account data. Please retry.");
  });

  it("treats a zero-row users delete as success and still finishes the auth step", async () => {
    // Idempotent convergence: on a retry after step 5 failed, the users row is
    // already gone and this retry must still reach step 5.
    //
    // MUTATION MEASURED RED: treating deletedCount === 0 as an error stops the
    // run at 500 and fails here.
    const deps = happyDeps();
    deps.deleteUsersRow.mockResolvedValue({ deletedCount: 0, error: null });

    const result = await deleteAccountForUser("user_1", deps);

    expect(deps.deleteAuthUser).toHaveBeenCalledWith("user_1");
    expect(result).toEqual({ status: 200, body: { ok: true } });
  });

  it("never reports success when the auth user could not be removed", async () => {
    const deps = happyDeps();
    deps.deleteAuthUser.mockResolvedValue({
      error: new Error(`auth delete failed ${SENTINEL}`),
    });

    const result = await deleteAccountForUser("user_1", deps);

    expect(result.status).toBe(500);
    expect(result.body.ok).toBeUndefined();
    expect(String(result.body.error)).toContain("contact support");
  });
});

describe("deleteAccountForUser — no response body carries anything derived from a token", () => {
  it("returns only `error` and `code`, and never a sentinel from the inputs", async () => {
    // The Plaid SDK rejects with an AxiosError whose config carries PLAID-SECRET
    // and the user's access token, which is why plaidErrorRedaction.ts exists.
    // The cheapest guarantee is that no response is ever built from an error.
    //
    // MUTATION MEASURED RED: adding `detail: String(usersResult.error)` to the
    // users-failure body fails both assertions below.
    const cases: Array<() => SpiedDeps> = [
      () => {
        const deps = happyDeps();
        deps.isAdminConfigured.mockReturnValue(false);
        return deps;
      },
      () => {
        const deps = happyDeps();
        deps.listConnections.mockResolvedValue(null);
        return deps;
      },
      () => {
        const deps = happyDeps();
        deps.isCryptoConfigured.mockReturnValue(false);
        return deps;
      },
      () => {
        const deps = happyDeps();
        deps.revokeAll.mockResolvedValue(
          summary({ remaining: 1, sawCryptoConfigFailure: true })
        );
        return deps;
      },
      () => {
        const deps = happyDeps();
        deps.revokeAll.mockResolvedValue(summary({ remaining: 1 }));
        return deps;
      },
      () => {
        const deps = happyDeps();
        deps.deleteUsersRow.mockResolvedValue({
          deletedCount: 0,
          error: new Error(`query failed ${SENTINEL}`),
        });
        return deps;
      },
      () => {
        const deps = happyDeps();
        deps.deleteAuthUser.mockResolvedValue({
          error: new Error(`auth delete failed ${SENTINEL}`),
        });
        return deps;
      },
    ];

    for (const build of cases) {
      const result = await deleteAccountForUser("user_1", build());
      const serialized = JSON.stringify(result.body);

      expect(result.status).not.toBe(200);
      expect(
        Object.keys(result.body).sort().join(","),
        `unexpected key in ${serialized}`
      ).toMatch(/^(code,error|error)$/);
      expect(serialized, "a sentinel reached a response body").not.toContain(
        SENTINEL
      );
    }
  });
});
