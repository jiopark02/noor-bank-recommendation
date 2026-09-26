import { describe, it, expect, vi } from "vitest";
import {
  classifyCryptoFailure,
  classifyItemRemoveRejection,
  plaidTokenEnvironment,
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
 *
 * `type` is a parameter and not a constant because the fold below requires BOTH
 * the code and the type, so a fixture that can only produce one type can only
 * test half of that requirement. It defaults to ITEM_ERROR, which is the type
 * Plaid's published error reference gives for the codes used here — and which
 * this repo has NOT observed live. See the provenance note in plaidRevocation.ts:
 * a test supplying the type cannot tell you the live API sends it.
 */
function plaidRejection(
  code: string,
  status = 400,
  type = "ITEM_ERROR"
): unknown {
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

/**
 * Deps whose decrypt yields a PLAINTEXT token shaped as Plaid issues them:
 * `access-<environment>-<identifier>`.
 *
 * passingDeps' decrypt returns `plaintext-for-<ciphertext>`, which is not that
 * shape, so its environment segment is "unparseable" and can never match. That is
 * fine for every test that does not reach the environment condition and FATAL for
 * the ones that do: a fold test built on passingDeps would fail for the wrong
 * reason, and a "does not fold" test built on it would pass for the wrong reason.
 */
function depsWithTokenEnvironment(environment: string) {
  const deps = passingDeps();
  deps.decrypt.mockImplementation(
    () => `access-${environment}-8ab976e6-64bc-4b38-98f7-731e7a349970`
  );
  return deps;
}

/** Deps that succeed at everything, with spies on each step. */
function passingDeps(): RevocationDeps & {
  decrypt: ReturnType<typeof vi.fn>;
  itemRemove: ReturnType<typeof vi.fn>;
  deleteRow: ReturnType<typeof vi.fn>;
} {
  return {
    decrypt: vi.fn((stored: string) => `plaintext-for-${stored}`),
    // Resolves with a request_id, as the real itemRemove does. `null` is the
    // other legal answer and gets its own test; `undefined` is neither, and a
    // fake returning it would let a broken contract pass unnoticed — tsc does
    // not check this file (tsconfig excludes __tests__), so the fake is the only
    // place that shape is asserted at all.
    itemRemove: vi.fn(async () => "req_fake_default"),
    deleteRow: vi.fn(async () => ({ ok: true as const, deleted: 1 })),
    plaidEnvironment: "sandbox",
    log: () => {},
  };
}

/**
 * Point `deps.log` at an array and hand the array back.
 *
 * The log lines are not decoration on this path: `deleted=`, `db_error=` and
 * `retrying=` are the only place the row count and the database code are
 * recorded at all, so they get assertions like any other output. Note the limit
 * — this captures what reaches `emit()`, which is everything this module writes,
 * and nothing from inside deletePlaidConnection (never reached: deleteRow is a
 * fake here).
 */
function withLog(deps: RevocationDeps): string[] {
  const lines: string[] = [];
  deps.log = (line: string) => {
    lines.push(line);
  };
  return lines;
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
      return "req_fake_ok";
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
      return "req_fake_ok";
    });

    const summary = await revokeAndDeleteConnections(
      "user_1",
      [connection("item_1"), connection("item_2"), connection("item_3")],
      deps
    );

    expect(summary.remaining).toBe(1);
  });
});

describe("revokeAndDeleteConnection — every other Plaid code keeps the row", () => {
  // The allow-list proof, from the other direction to plaidApiUtils.test.ts:
  // there, no unmapped code may acquire the re-link errorType. Here, no code
  // outside the single accepted rejection may acquire a row deletion.
  //
  // ⚠️ ITEM_NOT_FOUND IS DELIBERATELY NOT IN THIS LIST ANY MORE, and leaving it
  // here would have been worse than useless. These deps come from passingDeps,
  // whose decrypt returns `plaintext-for-<ciphertext>` — not a Plaid token shape —
  // so the environment segment is "unparseable" and the fold's third condition
  // can never hold. An ITEM_NOT_FOUND case would therefore stay GREEN with the
  // fold fully implemented AND green if the fold were entirely broken, while
  // reading like a proof that nothing is folded. It now lives in the condition
  // matrix below, on a fixture whose token has a real environment segment.
  //
  // INVALID_ACCESS_TOKEN stays here and is the one that invites the mistake: a
  // removed Item's token is plausibly reported as invalid, so accepting it looks
  // like it would close the same gap. It is not accepted, at any environment.
  const codes = [
    "ITEM_LOGIN_REQUIRED",
    "INVALID_ACCESS_TOKEN",
    "RATE_LIMIT_EXCEEDED",
    "INVALID_API_KEYS",
    "INTERNAL_SERVER_ERROR",
  ];

  it.each(codes)("keeps the row when itemRemove rejects with %s", async (code) => {
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

describe("revokeAndDeleteConnection — the one rejection that is folded", () => {
  // ⚠️ ONLY THE FIRST TEST HERE WAS RED BEFORE THIS CHANGE. The negative cases
  // below passed on the previous code too, because it refused EVERY rejection —
  // so they cannot be verified by the usual red-first measurement and are
  // verified instead by the mutations named on each one. Do not read their green
  // as evidence on its own.
  it("folds ITEM_NOT_FOUND from this environment and deletes the row", async () => {
    // A-1. The convergence this whole change exists for: itemRemove succeeded on
    // an earlier attempt and the delete failed, so the Item is gone and every
    // later attempt sees it missing. Refusing that forever is what stranded the
    // row and blocked the account deletion.
    const deps = depsWithTokenEnvironment("sandbox");
    const lines = withLog(deps);
    deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_NOT_FOUND"));

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome).toEqual({ itemId: "item_1", ok: true });
    expect(deps.deleteRow).toHaveBeenCalledTimes(1);
    const log = lines.join("\n");
    expect(log).toContain("item_id=item_1 resolved=item_not_found");
    expect(log).not.toContain("failure=plaid");
    // Not `resolved=revoked`: nothing was revoked by this call, and the two must
    // stay distinguishable in the log.
    expect(log).not.toContain("resolved=revoked");
  });

  it("keeps the row when the code matches but the type does not", async () => {
    // A-2. MUTATION: removing the error_type condition from
    // classifyItemRemoveRejection makes this fold and fails here.
    //
    // This is the condition the repo has NOT observed live, so it is the one most
    // likely to be wrong in the permissive direction. If a future observation
    // shows Plaid sending this code under another type, the fix is to widen the
    // condition deliberately — not to discover it by having accepted the code
    // alone all along.
    const deps = depsWithTokenEnvironment("sandbox");
    const lines = withLog(deps);
    deps.itemRemove.mockRejectedValue(
      plaidRejection("ITEM_NOT_FOUND", 400, "INVALID_INPUT")
    );

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome).toEqual({ itemId: "item_1", ok: false, failure: "plaid" });
    expect(deps.deleteRow).not.toHaveBeenCalled();
    const log = lines.join("\n");
    expect(log).toContain("error_code=ITEM_NOT_FOUND");
    expect(log).toContain("error_type=INVALID_INPUT");
    expect(log).not.toContain("resolved=");
  });

  it("keeps the row when the type matches but the code does not", async () => {
    // A-3. MUTATION: dropping the error_code condition makes every ITEM_ERROR
    // rejection fold — including ITEM_LOGIN_REQUIRED, where the Item is very much
    // still live and the user is one re-link away from using it.
    const deps = depsWithTokenEnvironment("sandbox");
    deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_LOGIN_REQUIRED"));

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome).toEqual({ itemId: "item_1", ok: false, failure: "plaid" });
    expect(deps.deleteRow).not.toHaveBeenCalled();
  });

  it("keeps the row when the token belongs to another environment", async () => {
    // A-4. MUTATION: removing the environment condition makes this fold.
    //
    // The case it protects: a deployment switched PLAID_ENV, so this row's token
    // was issued by the OTHER environment. "Not found here" says nothing about
    // whether the Item is alive there, and the row holds the only copy of the
    // token that could revoke it. The log names the mismatch because no retry
    // resolves it — it is a configuration story, not a transient failure.
    const deps = depsWithTokenEnvironment("production");
    const lines = withLog(deps);
    deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_NOT_FOUND"));

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome).toEqual({ itemId: "item_1", ok: false, failure: "plaid" });
    expect(deps.deleteRow).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain(
      "reason=env_mismatch token_env=production server_env=sandbox"
    );
  });

  it("treats a token it cannot parse as a mismatch, and does not throw", async () => {
    // A-5. The total-function requirement, reached through the real path. A token
    // that is not `access-<env>-<id>` at all must be a MISMATCH rather than an
    // exception or a match: "I could not read it" is not "it matched".
    //
    // MUTATION: making plaidTokenEnvironment throw on an unreadable token turns
    // this into a rejected promise, which no other test here would notice.
    const deps = passingDeps(); // decrypt returns `plaintext-for-...`
    const lines = withLog(deps);
    deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_NOT_FOUND"));

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome).toEqual({ itemId: "item_1", ok: false, failure: "plaid" });
    expect(deps.deleteRow).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("token_env=unparseable");
  });

  it("never folds INVALID_ACCESS_TOKEN, even from this environment", async () => {
    // A-6. The most tempting widening, and the one explicitly refused: a removed
    // Item's token is plausibly reported as invalid, so accepting this code looks
    // like it would close the same gap. It would also delete the row of every
    // connection whose token is merely wrong — a live Item, with its only usable
    // token thrown away.
    const deps = depsWithTokenEnvironment("sandbox");
    deps.itemRemove.mockRejectedValue(plaidRejection("INVALID_ACCESS_TOKEN"));

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
    deps.deleteRow.mockResolvedValue({ ok: false, dbErrorCode: "42501" });

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
      .mockResolvedValueOnce({ ok: false, dbErrorCode: "40001" })
      .mockResolvedValueOnce({ ok: true, deleted: 1 });

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

  it("treats a delete that matched no rows as success", async () => {
    // A-7. THE ROW COUNT IS THE POINT. Absence IS the target state, so 0 is
    // success — but it is success DECIDED with the number in hand, which the
    // previous boolean could not express: a zero-row PostgREST delete reports
    // neither an error nor a count, so it arrived as the same `true` as a delete
    // that actually removed the row.
    //
    // No re-read to confirm the absence, and no retry: on this path the row was
    // read moments earlier under the same user_id filter the delete uses, so 0
    // can only mean a concurrent request got there first.
    const deps = passingDeps();
    const lines = withLog(deps);
    deps.deleteRow.mockResolvedValue({ ok: true, deleted: 0 });

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome).toEqual({ itemId: "item_1", ok: true });
    expect(deps.deleteRow).toHaveBeenCalledTimes(1);
    expect(lines.join("\n")).toContain("item_id=item_1 deleted=0");
  });

  it("reports the count when the delete removed the row", async () => {
    // A-8. The other half of the pair above: 0 and 1 are both success and the
    // log says which happened. Collapse them and `deleted=` stops being evidence
    // of anything.
    const deps = passingDeps();
    const lines = withLog(deps);

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome.ok).toBe(true);
    expect(lines.join("\n")).toContain("item_id=item_1 deleted=1");
  });

  it("reports the database error code when the delete fails", async () => {
    // A-9. `failure=row_delete` on its own said nothing about WHY — it was the
    // only one of this module's failure lines carrying no detail. The retry line
    // is separate on purpose: it must not say `failure=`, because the connection
    // may still succeed on the second attempt.
    const deps = passingDeps();
    const lines = withLog(deps);
    deps.deleteRow.mockResolvedValue({ ok: false, dbErrorCode: "42501" });

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome.failure).toBe("row_delete");
    const log = lines.join("\n");
    expect(log).toContain("retrying=row_delete db_error=42501");
    expect(log).toContain("failure=row_delete db_error=42501");
  });

  it("says db_error=none when the failed delete carried no code", async () => {
    // A-10. null is a real case, not a defensive branch: createServerClient()
    // throws on missing env, and a thrown error has no PostgREST code at all.
    const deps = passingDeps();
    const lines = withLog(deps);
    deps.deleteRow.mockResolvedValue({ ok: false, dbErrorCode: null });

    await revokeAndDeleteConnection("user_1", connection("item_1"), deps);

    expect(lines.join("\n")).toContain("failure=row_delete db_error=none");
  });
});

describe("revokeAndDeleteConnection — what the log lines record", () => {
  it("records the request id of a successful revocation", async () => {
    // A-11. The revocation is the one step here that cannot be undone, and until
    // this line existed the only trace of it was the row disappearing — which
    // says nothing in the case that matters, where the row does NOT disappear.
    // request_id is the field a Plaid support conversation is keyed on.
    const deps = passingDeps();
    const lines = withLog(deps);
    deps.itemRemove.mockResolvedValue("req_abc123");

    await revokeAndDeleteConnection("user_1", connection("item_1"), deps);

    expect(lines.join("\n")).toContain(
      "item_id=item_1 resolved=revoked request_id=req_abc123"
    );
  });

  it("says request_id=none when the response carried none", async () => {
    // The SDK types request_id as required and as the only field on the
    // response, so null means the response did not match its own type. That is
    // not a reason to report a completed revocation as a failure: the line still
    // says the Item was revoked, and the row is still deleted below.
    const deps = passingDeps();
    const lines = withLog(deps);
    deps.itemRemove.mockResolvedValue(null);

    const outcome = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(outcome.ok).toBe(true);
    expect(lines.join("\n")).toContain("resolved=revoked request_id=none");
  });

  it("does not claim a revocation when itemRemove rejected", async () => {
    // The pairing, from the log's side: `resolved=revoked` must never appear for
    // a connection whose Item is still live. Moving the line above the try would
    // type-check and read fine.
    const deps = passingDeps();
    const lines = withLog(deps);
    deps.itemRemove.mockRejectedValue(plaidRejection("INTERNAL_SERVER_ERROR", 500));

    await revokeAndDeleteConnection("user_1", connection("item_1"), deps);

    const log = lines.join("\n");
    expect(log).toContain("failure=plaid");
    expect(log).not.toContain("resolved=revoked");
  });

  it("stops a hostile Plaid field from forging a key or breaking the line", async () => {
    // The allow-list guarantees these fields are not credentials. It guarantees
    // nothing about their LENGTH, their whitespace, or their punctuation: the
    // strings come from Plaid's response body, and these lines are read as
    // `key=value` pairs.
    //
    // TWO SEPARATE DEFECTS ARE PINNED HERE.
    //  - A newline would split one decision record into two lines, and a half-line
    //    reads as a complete one — worse than losing the value.
    //  - A space plus an `=` would FORGE A FIELD. Collapsing whitespace alone was
    //    not enough: `ITEM_NOT_FOUND resolved=item_not_found` would then parse as a
    //    code plus a `resolved` field this module never wrote, and `resolved=` is
    //    the field a reader uses to decide whether an Item was revoked. So `=` is
    //    substituted too, and the forgery arrives as one unmistakable token.
    const hostileCode = "ITEM_NOT_FOUND\nINJECTED=yes";
    const hostileType = `  ITEM_ERROR${"X".repeat(80)}  `;

    const deps = depsWithTokenEnvironment("sandbox");
    const lines = withLog(deps);
    deps.itemRemove.mockRejectedValue(
      plaidRejection(hostileCode, 400, hostileType)
    );

    await revokeAndDeleteConnection("user_1", connection("item_1"), deps);

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).not.toContain("\n");
    expect(line).toContain("error_code=ITEM_NOT_FOUND_INJECTED_yes");
    // No second `=` inside the value, so no field was forged.
    expect(line).not.toContain("INJECTED=yes");
    expect(line).toContain(`error_type=ITEM_ERROR${"X".repeat(22)}`);
    // 32 characters, so the 80 X's are cut and nothing after them survives.
    expect(line).not.toContain("X".repeat(23));
  });

  it("stops a hostile field from forging the field the fold is read from", async () => {
    // The concrete forgery worth naming: `resolved=` is how a reader tells "we
    // revoked this Item" from "it was already gone", and this line is a FAILURE —
    // nothing was resolved. A code that could inject that key would let Plaid's
    // response body write our own decision into the log.
    const deps = depsWithTokenEnvironment("sandbox");
    const lines = withLog(deps);
    deps.itemRemove.mockRejectedValue(
      plaidRejection("BAD resolved=revoked", 400, "ITEM_ERROR")
    );

    await revokeAndDeleteConnection("user_1", connection("item_1"), deps);

    const line = lines.join("\n");
    expect(line).toContain("failure=plaid");
    expect(line).not.toContain("resolved=revoked");
    expect(line).toContain("error_code=BAD_resolved_revoked");
  });

  it("puts the user id on every line it writes, on every path", async () => {
    // A-13. `item_id` alone cannot find the user whose account deletion is
    // blocked: answering that from item_id means querying plaid_connections, and
    // in the account-deletion case some of those rows are already gone. The id is
    // the one from the verified token, passed through unmodified — the same value
    // the decrypt AAD and the row filter use.
    //
    // Every path, because a line added later without the field is exactly how
    // this regresses. The per-path counts are asserted rather than a total, so a
    // path that stops logging entirely cannot hide behind another one's lines:
    // crypto failure writes 1, Plaid failure writes 1, and the success run writes
    // 3 (resolved=revoked + retrying=row_delete + deleted=).
    const userId = "User_MixedCase_1";

    const cryptoDeps = passingDeps();
    const cryptoLines = withLog(cryptoDeps);
    cryptoDeps.decrypt.mockImplementation(() => {
      throw new PlaidTokenCryptoError("auth_failed", "no");
    });
    await revokeAndDeleteConnection(userId, connection("item_1"), cryptoDeps);

    const plaidDeps = passingDeps();
    const plaidLines = withLog(plaidDeps);
    plaidDeps.itemRemove.mockRejectedValue(plaidRejection("ITEM_LOCKED"));
    await revokeAndDeleteConnection(userId, connection("item_2"), plaidDeps);

    const okDeps = passingDeps();
    const okLines = withLog(okDeps);
    okDeps.deleteRow
      .mockResolvedValueOnce({ ok: false, dbErrorCode: "40001" })
      .mockResolvedValueOnce({ ok: true, deleted: 1 });
    await revokeAndDeleteConnection(userId, connection("item_3"), okDeps);

    expect(cryptoLines).toHaveLength(1);
    expect(plaidLines).toHaveLength(1);
    expect(okLines).toHaveLength(3);

    for (const line of [...cryptoLines, ...plaidLines, ...okLines]) {
      expect(line, line).toContain(`user_id=${userId}`);
    }
  });
});

describe("revokeAndDeleteConnection — a retry converges", () => {
  it("completes on the second attempt after the row delete failed", async () => {
    // A-17. THE DEADLOCK, REPRODUCED AND THEN CLEARED. First attempt: the Item is
    // revoked and both delete attempts fail, so the row survives with its Item
    // already gone. Second attempt: itemRemove is aimed at an Item that no longer
    // exists, the rejection is folded, and the delete is reached again.
    //
    // Before this change the second attempt returned `plaid` forever and that row
    // could never be deleted by this path.
    const deps = depsWithTokenEnvironment("sandbox");
    deps.deleteRow.mockResolvedValue({ ok: false, dbErrorCode: "40001" });

    const first = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(first).toEqual({
      itemId: "item_1",
      ok: false,
      failure: "row_delete",
    });

    // The state the first attempt left behind: Item gone, row present.
    deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_NOT_FOUND"));
    deps.deleteRow.mockResolvedValue({ ok: true, deleted: 1 });
    const lines = withLog(deps);

    const second = await revokeAndDeleteConnection(
      "user_1",
      connection("item_1"),
      deps
    );

    expect(second).toEqual({ itemId: "item_1", ok: true });
    expect(lines.join("\n")).toContain("resolved=item_not_found");
  });

  it("drives remaining to 0 on the second attempt", async () => {
    // A-18. The same thing one level up, where it actually bites: `remaining` is
    // what /api/account/delete refuses on, and a user in this state could not
    // complete a deletion at all. Two connections, so the count is not trivially
    // right.
    const deps = depsWithTokenEnvironment("sandbox");
    deps.deleteRow.mockResolvedValue({ ok: false, dbErrorCode: "40001" });

    const connections = [connection("item_1"), connection("item_2")];
    const first = await revokeAndDeleteConnections("user_1", connections, deps);

    expect(first.remaining).toBe(2);

    deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_NOT_FOUND"));
    deps.deleteRow.mockResolvedValue({ ok: true, deleted: 1 });

    const second = await revokeAndDeleteConnections("user_1", connections, deps);

    expect(second.remaining).toBe(0);
    expect(second.sawCryptoConfigFailure).toBe(false);
  });

  it("does not converge for a row whose ciphertext will not decrypt", async () => {
    // The exception, pinned so the docblocks stay honest. This one fails
    // crypto_row on every attempt by definition — no fold applies, because
    // itemRemove is never reached — and the user remains unable to complete an
    // account deletion. If this ever starts passing, the comments claiming one
    // permanent case are wrong.
    const deps = depsWithTokenEnvironment("sandbox");
    deps.decrypt.mockImplementation(() => {
      throw new PlaidTokenCryptoError("auth_failed", "no");
    });

    const first = await revokeAndDeleteConnections(
      "user_1",
      [connection("item_1")],
      deps
    );
    const second = await revokeAndDeleteConnections(
      "user_1",
      [connection("item_1")],
      deps
    );

    expect(first.remaining).toBe(1);
    expect(second.remaining).toBe(1);
    expect(deps.itemRemove).not.toHaveBeenCalled();
  });
});

describe("revokeAndDeleteConnection — no token reaches a log line", () => {
  it("writes neither the plaintext token nor the stored ciphertext", async () => {
    // A-14. The log lines now carry a value DERIVED from the plaintext token
    // (`token_env=`), which is new, so this is the assertion that the derivation
    // is the only thing that crosses. The capture group bounds it; this checks
    // the bound holds through the real path, on every branch that logs.
    //
    // LIMIT: it sees what reaches emit(), which is everything this module writes.
    // It does not see deletePlaidConnection's own console.error, which is
    // unreachable here because deleteRow is a fake.
    const secretPlaintext =
      "access-sandbox-SECRET_IDENTIFIER_8ab976e6-64bc-4b38-98f7";
    const row = connection("item_1");
    const captured: string[] = [];

    const run = async (
      configure: (deps: ReturnType<typeof passingDeps>) => void
    ) => {
      const deps = passingDeps();
      deps.decrypt.mockImplementation(() => secretPlaintext);
      const lines = withLog(deps);
      configure(deps);
      await revokeAndDeleteConnection("user_1", row, deps);
      captured.push(...lines);
    };

    // Folded, refused for the environment, refused for the code, and the plain
    // success path — every branch that emits a line after a decrypt succeeded.
    await run((deps) => {
      deps.plaidEnvironment = "sandbox";
      deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_NOT_FOUND"));
    });
    await run((deps) => {
      deps.plaidEnvironment = "production";
      deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_NOT_FOUND"));
    });
    await run((deps) => {
      deps.itemRemove.mockRejectedValue(plaidRejection("INVALID_API_KEYS"));
    });
    await run((deps) => {
      deps.deleteRow.mockResolvedValue({ ok: false, dbErrorCode: "42501" });
    });

    expect(captured.length).toBeGreaterThan(0);
    const log = captured.join("\n");
    expect(log).not.toContain(secretPlaintext);
    expect(log).not.toContain("SECRET_IDENTIFIER");
    expect(log).not.toContain(row.access_token);
    // The derived value is allowed, and is the reason this test exists.
    expect(log).toContain("token_env=sandbox");
  });
});

describe("plaidTokenEnvironment — total, bounded, and never a false match", () => {
  it("reads the environment segment of a real token shape", () => {
    // A-15. The shape Plaid issues, and the one plaidTokenCrypto's own docblock
    // names as the legacy plaintext value it refuses.
    expect(
      plaidTokenEnvironment("access-sandbox-8ab976e6-64bc-4b38-98f7-731e7a349970")
    ).toBe("sandbox");
    expect(plaidTokenEnvironment("access-production-abc-def")).toBe("production");
    // A name this SDK version no longer has. It parses fine and simply matches
    // nothing, which is the correct outcome, not a special case.
    expect(plaidTokenEnvironment("access-development-abc")).toBe("development");
  });

  it("answers unparseable for everything that is not that shape", () => {
    // Each of these must be a MISMATCH rather than an exception or a match. The
    // ciphertext case is the one that would arrive if a caller ever passed the
    // stored value instead of the decrypted one.
    expect(plaidTokenEnvironment("")).toBe("unparseable");
    expect(plaidTokenEnvironment("v1:iv:tag:ciphertext")).toBe("unparseable");
    expect(plaidTokenEnvironment("plaintext-for-v1:a:b:c")).toBe("unparseable");
    expect(plaidTokenEnvironment("access-SANDBOX-abc")).toBe("unparseable");
    expect(plaidTokenEnvironment("access--abc")).toBe("unparseable");
    expect(plaidTokenEnvironment("access-sandbox")).toBe("unparseable");
    expect(plaidTokenEnvironment(`access-${"x".repeat(33)}-abc`)).toBe(
      "unparseable"
    );
  });

  it("never throws, whatever it is handed", () => {
    // Called from inside a catch block, on a value that came from an injected
    // dependency. A throw here would replace the Plaid error being diagnosed.
    const notAString = null as unknown as string;
    expect(() => plaidTokenEnvironment(notAString)).not.toThrow();
    expect(plaidTokenEnvironment(notAString)).toBe("unparseable");
    expect(plaidTokenEnvironment(42 as unknown as string)).toBe("unparseable");
    expect(plaidTokenEnvironment({} as unknown as string)).toBe("unparseable");
  });

  it("returns the segment alone, never any part of the identifier", () => {
    // This value goes into a log line. The capture group is what keeps the
    // credential half out of it.
    const token = "access-sandbox-SECRET_IDENTIFIER_PART";

    expect(plaidTokenEnvironment(token)).not.toContain("SECRET_IDENTIFIER_PART");
    expect(plaidTokenEnvironment(token)).toBe("sandbox");
  });
});

describe("classifyItemRemoveRejection — all three conditions, one at a time", () => {
  // A-16. The matrix, reached directly. The integration tests above prove the
  // decision is WIRED; these prove it is right, including the combinations that
  // are awkward to reach through the full function.
  const folded = plaidRejection("ITEM_NOT_FOUND");

  it("accepts only when code, type and environment all hold", () => {
    expect(classifyItemRemoveRejection(folded, "sandbox", "sandbox")).toEqual({
      itemAlreadyGone: true,
    });
  });

  it("refuses on the code alone", () => {
    expect(
      classifyItemRemoveRejection(
        plaidRejection("ITEM_LOGIN_REQUIRED"),
        "sandbox",
        "sandbox"
      )
    ).toEqual({ itemAlreadyGone: false, envMismatch: false });
  });

  it("refuses on the type alone", () => {
    expect(
      classifyItemRemoveRejection(
        plaidRejection("ITEM_NOT_FOUND", 400, "INVALID_INPUT"),
        "sandbox",
        "sandbox"
      )
    ).toEqual({ itemAlreadyGone: false, envMismatch: false });
  });

  it("reports an environment mismatch as its own refusal, with the segment", () => {
    // Distinguished from the ordinary refusal because a human reading the log
    // needs a different response: no retry resolves a token from the other
    // environment.
    expect(classifyItemRemoveRejection(folded, "production", "sandbox")).toEqual({
      itemAlreadyGone: false,
      envMismatch: true,
      tokenEnvironment: "production",
    });
  });

  it("treats an unparseable environment as a mismatch, not a match", () => {
    expect(
      classifyItemRemoveRejection(folded, "unparseable", "sandbox")
    ).toEqual({
      itemAlreadyGone: false,
      envMismatch: true,
      tokenEnvironment: "unparseable",
    });
  });

  it("does not fold an error that is not a Plaid rejection at all", () => {
    // Both readers answer undefined for these, so the code condition fails first.
    for (const value of [null, undefined, "boom", new Error("boom"), {}]) {
      expect(
        classifyItemRemoveRejection(value, "sandbox", "sandbox"),
        String(value)
      ).toEqual({ itemAlreadyGone: false, envMismatch: false });
    }
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
