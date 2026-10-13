import { describe, it, expect, vi } from "vitest";
import {
  CONNECTION_LIMIT,
  exchangeForUser,
  type ExchangeDeps,
  type ExchangeInput,
  type ExchangeOutcome,
} from "../plaidExchange";
import { storeResultFromInsert } from "../plaidApiUtils";
import { redactPlaidAxiosError } from "../plaidErrorRedaction";

/**
 * POST /api/plaid/exchange-token's decisions, executed.
 *
 * Every assertion runs exchangeForUser with plain injected fakes and observes
 * which dependencies were or were not called — above all itemRemove, whose call
 * is the one step here that cannot be undone. No vi.mock.
 *
 * Each `it` names the mutation to plaidExchange.ts that turns it red.
 *
 * WHAT IT DOES NOT PROVE
 * Nothing about the route above it: whether it verifies the token, or builds
 * these dependencies from the real Plaid client and plaidApiUtils correctly, is
 * not visible from here.
 */

const USER = "user-0b7e";
const NEW_ITEM = "item-new-91c2";
const ACCESS_SENTINEL = "access-sandbox-SENTINEL_access_never_logged_5d1e";
const PUBLIC_SENTINEL = "public-sandbox-SENTINEL_public_never_logged_77a0";

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

type Spied = ExchangeDeps & {
  countConnections: ReturnType<typeof vi.fn>;
  findActiveByInstitution: ReturnType<typeof vi.fn>;
  exchange: ReturnType<typeof vi.fn>;
  itemGet: ReturnType<typeof vi.fn>;
  findOwnItem: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
  itemRemove: ReturnType<typeof vi.fn>;
  lines: string[];
};

/** Deps on which everything succeeds and the user has one unrelated bank. */
function passingDeps(): Spied {
  const lines: string[] = [];
  return {
    countConnections: vi.fn(async () => 1),
    findActiveByInstitution: vi.fn(async () => null),
    exchange: vi.fn(async () => ({ accessToken: ACCESS_SENTINEL, itemId: NEW_ITEM })),
    itemGet: vi.fn(async () => ({
      institutionId: "ins_server",
      institutionName: "Server Bank",
    })),
    findOwnItem: vi.fn(async () => ({ ok: true as const, connection: null })),
    store: vi.fn(async () => ({ ok: true as const })),
    itemRemove: vi.fn(async () => "req_fake"),
    plaidEnvironment: "sandbox",
    log: (line: string) => {
      lines.push(line);
    },
    lines,
  };
}

const INPUT: ExchangeInput = {
  publicToken: PUBLIC_SENTINEL,
  institutionId: "ins_client",
  institutionName: "Client Bank",
};

function response(outcome: ExchangeOutcome) {
  if (outcome.kind !== "response") {
    throw new Error("expected a response outcome");
  }
  return outcome;
}

describe("connection limit", () => {
  it("refuses at the limit without exchanging", async () => {
    // MUTATION: `count >= CONNECTION_LIMIT` -> `count > CONNECTION_LIMIT`, or the
    // limit check moved below the exchange.
    const deps = passingDeps();
    deps.countConnections.mockResolvedValue(CONNECTION_LIMIT);
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(422);
    expect(out.body.code).toBe("CONNECTION_LIMIT_REACHED");
    expect(typeof out.body.error).toBe("string");
    expect(deps.exchange).not.toHaveBeenCalled();
  });

  it("allows one below the limit", async () => {
    // MUTATION: comparing against CONNECTION_LIMIT - 1.
    const deps = passingDeps();
    deps.countConnections.mockResolvedValue(CONNECTION_LIMIT - 1);
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(200);
    expect(deps.store).toHaveBeenCalledTimes(1);
  });

  it("refuses when the count cannot be read, without exchanging", async () => {
    // MUTATION: treating a null count as 0.
    const deps = passingDeps();
    deps.countConnections.mockResolvedValue(null);
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(503);
    expect(out.body.code).toBe("CONNECTION_CHECK_FAILED");
    expect(deps.exchange).not.toHaveBeenCalled();
  });
});

describe("duplicate check before the exchange", () => {
  it("answers 409 without exchanging", async () => {
    // MUTATION: removing the pre-exchange check.
    const deps = passingDeps();
    deps.findActiveByInstitution.mockResolvedValue({ institution_name: "Old Bank" });
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(409);
    expect(out.body.code).toBe("ALREADY_CONNECTED");
    expect(out.body.institutionName).toBe("Old Bank");
    expect(deps.exchange).not.toHaveBeenCalled();
  });

  it("proceeds when the read fails", async () => {
    // MUTATION: making the pre-exchange read fail closed.
    const deps = passingDeps();
    deps.findActiveByInstitution.mockRejectedValueOnce(new Error("db down"));
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(deps.exchange).toHaveBeenCalledTimes(1);
    expect(out.status).toBe(200);
  });

  it("skips the client check for an empty institution id and checks Plaid's id after", async () => {
    // MUTATION: passing the client id to the post-exchange check, or dropping
    // excludeItemId.
    const deps = passingDeps();
    await exchangeForUser(USER, { ...INPUT, institutionId: "" }, deps);
    expect(deps.findActiveByInstitution).toHaveBeenCalledTimes(1);
    expect(deps.findActiveByInstitution).toHaveBeenCalledWith(
      USER,
      "ins_server",
      NEW_ITEM
    );
  });
});

describe("compensating revocation after the exchange", () => {
  it("revokes when itemGet fails and does not store", async () => {
    // MUTATION: restoring the fallback to the client's institution id.
    const deps = passingDeps();
    deps.itemGet.mockRejectedValue(plaidRejection("INTERNAL_SERVER_ERROR", "API_ERROR", 500));
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(503);
    expect(out.body.code).toBe("INSTITUTION_LOOKUP_FAILED");
    expect(deps.itemRemove).toHaveBeenCalledTimes(1);
    expect(deps.itemRemove).toHaveBeenCalledWith(ACCESS_SENTINEL);
    expect(deps.store).not.toHaveBeenCalled();
  });

  it("revokes a duplicate found by Plaid's institution id, then answers 409", async () => {
    // MUTATION: removing the revoke from the post-duplicate branch.
    const deps = passingDeps();
    deps.findActiveByInstitution.mockImplementation(
      async (_u: string, institutionId: string) =>
        institutionId === "ins_server" ? { institution_name: "Stored Bank" } : null
    );
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(409);
    expect(out.body.code).toBe("ALREADY_CONNECTED");
    expect(out.body.institutionName).toBe("Stored Bank");
    expect(deps.itemRemove).toHaveBeenCalledTimes(1);
    expect(deps.store).not.toHaveBeenCalled();
  });

  it("revokes and refuses when the post-exchange duplicate read fails", async () => {
    // MUTATION: making the post-exchange read fail open.
    const deps = passingDeps();
    deps.findActiveByInstitution.mockImplementation(
      async (_u: string, _i: string, exclude?: string) => {
        if (exclude) throw new Error("db down");
        return null;
      }
    );
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(503);
    expect(deps.itemRemove).toHaveBeenCalledTimes(1);
    expect(deps.store).not.toHaveBeenCalled();
  });

  it.each(["crypto", "db"] as const)("revokes when the store fails with %s", async (kind) => {
    // MUTATION: removing the revoke from the store-failure branch.
    const deps = passingDeps();
    deps.store.mockResolvedValue({ ok: false, kind, dbErrorCode: kind === "db" ? "08006" : null });
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(500);
    expect(out.body.code).toBe("CONNECTION_SAVE_FAILED");
    expect(deps.itemRemove).toHaveBeenCalledTimes(1);
  });

  it("keeps the original refusal when the revocation itself fails, and logs it", async () => {
    // MUTATION: dropping the compensate=failed line, or answering differently.
    const deps = passingDeps();
    deps.store.mockResolvedValue({ ok: false, kind: "db", dbErrorCode: null });
    deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_LOCKED"));
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(500);
    expect(out.body.code).toBe("CONNECTION_SAVE_FAILED");
    expect(
      deps.lines.some(
        (l) =>
          l.includes(`item_id=${NEW_ITEM}`) &&
          l.includes("compensate=failed") &&
          l.includes("error_code=ITEM_LOCKED")
      )
    ).toBe(true);
  });

  it("records an Item already gone as item_not_found, not as revoked", async () => {
    // MUTATION: treating every rejection as revoked, or bypassing
    // classifyItemRemoveRejection.
    const deps = passingDeps();
    deps.store.mockResolvedValue({ ok: false, kind: "db", dbErrorCode: null });
    deps.itemRemove.mockRejectedValue(plaidRejection("ITEM_NOT_FOUND"));
    await exchangeForUser(USER, INPUT, deps);
    expect(deps.lines.some((l) => l.includes("compensate=item_not_found"))).toBe(true);
    expect(deps.lines.some((l) => l.includes("compensate=revoked"))).toBe(false);
  });

  it("records a successful revocation with its request id", async () => {
    // MUTATION: dropping the compensate=revoked line.
    const deps = passingDeps();
    deps.itemGet.mockRejectedValue(new Error("boom"));
    await exchangeForUser(USER, INPUT, deps);
    expect(
      deps.lines.some((l) => l.includes("compensate=revoked request_id=req_fake"))
    ).toBe(true);
  });

  it("does not revoke when the exchange itself is refused", async () => {
    // MUTATION: revoking in the exchange catch.
    const deps = passingDeps();
    const refusal = plaidRejection("INVALID_PUBLIC_TOKEN", "INVALID_INPUT");
    deps.exchange.mockRejectedValue(refusal);
    const out = await exchangeForUser(USER, INPUT, deps);
    expect(out).toEqual({ kind: "plaid_error", error: refusal });
    expect(deps.itemRemove).not.toHaveBeenCalled();
  });
});

describe("an Item this user already has is never revoked", () => {
  it("answers success without storing or revoking when the row exists", async () => {
    // MUTATION: removing the early return for an existing row.
    const deps = passingDeps();
    deps.findOwnItem.mockResolvedValue({
      ok: true,
      connection: { institution_name: "Existing Bank", institution_id: "ins_existing" },
    });
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(200);
    expect(out.body.institutionName).toBe("Existing Bank");
    expect(out.body.institutionId).toBe("ins_existing");
    expect(deps.store).not.toHaveBeenCalled();
    expect(deps.itemRemove).not.toHaveBeenCalled();
  });

  it("stops without revoking when ownership cannot be read, after one retry", async () => {
    // MUTATION: revoking on this path, or removing the retry.
    const deps = passingDeps();
    deps.findOwnItem.mockResolvedValue({ ok: false });
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(503);
    expect(deps.findOwnItem).toHaveBeenCalledTimes(2);
    expect(deps.itemRemove).not.toHaveBeenCalled();
    expect(deps.store).not.toHaveBeenCalled();
    expect(
      deps.lines.some((l) => l.includes("failure=ownership_read revoke=skipped"))
    ).toBe(true);
  });

  it("succeeds on the retry when the first ownership read fails", async () => {
    // MUTATION: removing the retry.
    const deps = passingDeps();
    deps.findOwnItem.mockResolvedValueOnce({ ok: false });
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(200);
    expect(deps.store).toHaveBeenCalledTimes(1);
  });

  it("does not revoke on a unique violation once the row is confirmed", async () => {
    // MUTATION: folding duplicate_item into the generic store failure.
    const deps = passingDeps();
    deps.store.mockResolvedValue({ ok: false, kind: "duplicate_item", dbErrorCode: "23505" });
    deps.findOwnItem
      .mockResolvedValueOnce({ ok: true, connection: null })
      .mockResolvedValueOnce({
        ok: true,
        connection: { institution_name: "Raced Bank", institution_id: "ins_server" },
      });
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(200);
    expect(out.body.institutionName).toBe("Raced Bank");
    expect(deps.itemRemove).not.toHaveBeenCalled();
  });

  it("does not report success on a unique violation whose row cannot be seen", async () => {
    // MUTATION: answering 200 on duplicate_item without the confirming read.
    const deps = passingDeps();
    deps.store.mockResolvedValue({ ok: false, kind: "duplicate_item", dbErrorCode: "23505" });
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(500);
    expect(deps.itemRemove).not.toHaveBeenCalled();
    expect(
      deps.lines.some((l) => l.includes("refused=store_conflict") && l.includes("revoke=skipped"))
    ).toBe(true);
  });
});

describe("stored values come from Plaid where Plaid has them", () => {
  it("stores Plaid's institution id and name", async () => {
    // MUTATION: storing the client's id or name ahead of Plaid's.
    const deps = passingDeps();
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(deps.store).toHaveBeenCalledWith(
      USER,
      ACCESS_SENTINEL,
      NEW_ITEM,
      "Server Bank",
      "ins_server"
    );
    expect(out.body.institutionName).toBe("Server Bank");
    expect(out.body.institutionId).toBe("ins_server");
  });

  it("falls back to the client's name when Plaid reports none", async () => {
    // MUTATION: skipping the client name in the fallback chain.
    const deps = passingDeps();
    deps.itemGet.mockResolvedValue({ institutionId: "ins_server", institutionName: null });
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(deps.store.mock.calls[0][3]).toBe("Client Bank");
    expect(out.body.institutionName).toBe("Client Bank");
  });

  it("uses Unknown Institution when neither side has a name", async () => {
    // MUTATION: changing the last fallback.
    const deps = passingDeps();
    deps.itemGet.mockResolvedValue({ institutionId: "ins_server", institutionName: "  " });
    const out = response(
      await exchangeForUser(USER, { ...INPUT, institutionName: "" }, deps)
    );
    expect(deps.store.mock.calls[0][3]).toBe("Unknown Institution");
    expect(out.body.institutionName).toBe("Unknown Institution");
  });

  it("stores NULL, never the client's id, when Plaid reports no institution id", async () => {
    // MUTATION: `serverInstitutionId ?? clientInstitutionId`.
    const deps = passingDeps();
    deps.itemGet.mockResolvedValue({ institutionId: null, institutionName: "Server Bank" });
    await exchangeForUser(USER, INPUT, deps);
    expect(deps.store.mock.calls[0][4]).toBeNull();
    // Only the pre-exchange check ran; there is no server id to check with.
    expect(deps.findActiveByInstitution).toHaveBeenCalledTimes(1);
    expect(deps.findActiveByInstitution).toHaveBeenCalledWith(USER, "ins_client");
  });
});

describe("tokens never leave through logs or responses", () => {
  const scenarios: Array<[string, (d: Spied) => void]> = [
    ["success", () => {}],
    ["limit", (d) => d.countConnections.mockResolvedValue(CONNECTION_LIMIT)],
    ["itemGet failure", (d) => d.itemGet.mockRejectedValue(new Error(ACCESS_SENTINEL))],
    ["post duplicate", (d) => d.findActiveByInstitution.mockImplementation(
      async (_u: string, _i: string, e?: string) => (e ? { institution_name: "X" } : null)
    )],
    ["store failure + revoke failure", (d) => {
      d.store.mockResolvedValue({ ok: false, kind: "db", dbErrorCode: null });
      d.itemRemove.mockRejectedValue(plaidRejection("ITEM_LOCKED"));
    }],
    ["ownership read failure", (d) => d.findOwnItem.mockResolvedValue({ ok: false })],
    ["existing row", (d) => d.findOwnItem.mockResolvedValue({
      ok: true, connection: { institution_name: "E", institution_id: null },
    })],
  ];

  it.each(scenarios)("%s", async (_name, arrange) => {
    // MUTATION: interpolating the access token (or the public token) into any
    // log line or response field.
    const deps = passingDeps();
    arrange(deps);
    const out = await exchangeForUser(USER, INPUT, deps);
    const text = deps.lines.join("\n") + JSON.stringify(out.kind === "response" ? out.body : {});
    expect(text).not.toContain(ACCESS_SENTINEL);
    expect(text).not.toContain(PUBLIC_SENTINEL);
  });
});

describe("the ownership read is repeated right before a compensating revocation", () => {
  const ROW = {
    ok: true as const,
    connection: { institution_name: "Committed Bank", institution_id: "ins_committed" },
  };
  const NO_ROW = { ok: true as const, connection: null };

  it("answers 200 without revoking when a store reported as failed actually committed", async () => {
    // MUTATION: deleting the readOwnItem re-read in `refuse` (revoking on step
    // 4's answer), or passing no `rowPresent` from the store-failure branch.
    const deps = passingDeps();
    deps.store.mockResolvedValue({ ok: false, kind: "db", dbErrorCode: null });
    deps.findOwnItem.mockResolvedValueOnce(NO_ROW).mockResolvedValueOnce(ROW);
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);
    expect(out.body.institutionName).toBe("Committed Bank");
    expect(out.body.institutionId).toBe("ins_committed");
    expect(deps.findOwnItem).toHaveBeenCalledTimes(2);
    expect(deps.itemRemove).not.toHaveBeenCalled();
    expect(
      deps.lines.some((l) => l.includes("revoke=skipped reason=row_present"))
    ).toBe(true);
  });

  it("keeps the 409 without revoking when the post-exchange duplicate's re-read finds a row", async () => {
    // MUTATION: deleting the re-read in `refuse`, or answering every refusal
    // with the row's 200 instead of only the store failures.
    const deps = passingDeps();
    deps.findActiveByInstitution.mockImplementation(
      async (_u: string, institutionId: string) =>
        institutionId === "ins_server" ? { institution_name: "Stored Bank" } : null
    );
    deps.findOwnItem.mockResolvedValueOnce(NO_ROW).mockResolvedValueOnce(ROW);
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(409);
    expect(out.body.code).toBe("ALREADY_CONNECTED");
    expect(deps.itemRemove).not.toHaveBeenCalled();
    expect(
      deps.lines.some((l) => l.includes("revoke=skipped reason=row_present"))
    ).toBe(true);
  });

  it("keeps the original refusal without revoking when the re-read fails", async () => {
    // MUTATION: treating a failed re-read as "no row" (revoking anyway), or
    // dropping the recheck_read_failed line.
    const deps = passingDeps();
    deps.store.mockResolvedValue({ ok: false, kind: "db", dbErrorCode: null });
    deps.findOwnItem.mockResolvedValueOnce(NO_ROW).mockResolvedValueOnce({ ok: false });
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(500);
    expect(out.body.code).toBe("CONNECTION_SAVE_FAILED");
    expect(deps.itemRemove).not.toHaveBeenCalled();
    expect(
      deps.lines.some(
        (l) =>
          l.includes(`item_id=${NEW_ITEM}`) &&
          l.includes("revoke=skipped reason=recheck_read_failed")
      )
    ).toBe(true);
  });

  it("treats a thrown re-read as a failed one", async () => {
    // MUTATION: calling deps.findOwnItem directly in `refuse` instead of
    // readOwnItem, so the throw escapes.
    const deps = passingDeps();
    deps.itemGet.mockRejectedValue(new Error("boom"));
    deps.findOwnItem
      .mockResolvedValueOnce(NO_ROW)
      .mockRejectedValueOnce(new Error("db down"));
    const out = response(await exchangeForUser(USER, INPUT, deps));
    expect(out.status).toBe(503);
    expect(out.body.code).toBe("INSTITUTION_LOOKUP_FAILED");
    expect(deps.itemRemove).not.toHaveBeenCalled();
  });
});

describe("a minted Item is logged as soon as it exists", () => {
  const itemLines = (d: Spied) =>
    d.lines.filter((l) => l.includes(`item_id=${NEW_ITEM}`));

  const scenarios: Array<[string, (d: Spied) => void]> = [
    ["success", () => {}],
    ["itemGet failure", (d) => d.itemGet.mockRejectedValue(new Error("boom"))],
    ["store failure", (d) =>
      d.store.mockResolvedValue({ ok: false, kind: "db", dbErrorCode: null })],
    ["ownership read failure", (d) => d.findOwnItem.mockResolvedValue({ ok: false })],
  ];

  it.each(scenarios)("%s: minted comes first and is paired with an outcome", async (_n, arrange) => {
    // MUTATION: removing the `minted` emit, or moving it below step 4.
    const deps = passingDeps();
    arrange(deps);
    await exchangeForUser(USER, INPUT, deps);
    const lines = itemLines(deps);
    expect(lines[0]).toBe(`[plaid-exchange] user_id=${USER} item_id=${NEW_ITEM} minted`);
    expect(
      lines
        .slice(1)
        .some((l) => /resolved=|compensate=|revoke=skipped|refused=/.test(l))
    ).toBe(true);
  });

  it("logs no minted line when the exchange is refused", async () => {
    // MUTATION: emitting `minted` before the exchange resolves.
    const deps = passingDeps();
    deps.exchange.mockRejectedValue(plaidRejection("INVALID_PUBLIC_TOKEN", "INVALID_INPUT"));
    await exchangeForUser(USER, INPUT, deps);
    expect(deps.lines.some((l) => l.includes("minted"))).toBe(false);
  });
});

describe("institution names are stored at most 80 characters long", () => {
  const LONG = "B".repeat(81) + "ank of Somewhere Very Long";

  it("caps Plaid's name and answers with the stored value", async () => {
    // MUTATION: removing `.slice(0, INSTITUTION_NAME_MAX)`, or capping only
    // the value sent to store.
    const deps = passingDeps();
    deps.itemGet.mockResolvedValue({ institutionId: "ins_server", institutionName: LONG });
    const out = response(await exchangeForUser(USER, INPUT, deps));
    const stored = deps.store.mock.calls[0][3] as string;
    expect(stored).toHaveLength(80);
    expect(stored).toBe(LONG.slice(0, 80));
    expect(out.body.institutionName).toBe(stored);
  });

  it("caps the client's name when it is the fallback", async () => {
    // MUTATION: capping Plaid's name before the fallback chain instead of the
    // chosen value.
    const deps = passingDeps();
    deps.itemGet.mockResolvedValue({ institutionId: "ins_server", institutionName: null });
    const out = response(
      await exchangeForUser(USER, { ...INPUT, institutionName: LONG }, deps)
    );
    const stored = deps.store.mock.calls[0][3] as string;
    expect(stored).toHaveLength(80);
    expect(out.body.institutionName).toBe(stored);
  });

  it("leaves an 80-character name whole", async () => {
    // MUTATION: an off-by-one cap (`slice(0, 79)`).
    const deps = passingDeps();
    const exact = "C".repeat(80);
    deps.itemGet.mockResolvedValue({ institutionId: "ins_server", institutionName: exact });
    await exchangeForUser(USER, INPUT, deps);
    expect(deps.store.mock.calls[0][3]).toBe(exact);
  });
});

describe("storeResultFromInsert", () => {
  it("reports success when there is no error", () => {
    expect(storeResultFromInsert(null)).toEqual({ ok: true });
  });

  it("reports 23505 as duplicate_item", () => {
    // MUTATION: removing the 23505 comparison.
    expect(storeResultFromInsert({ code: "23505", message: "dup" })).toEqual({
      ok: false,
      kind: "duplicate_item",
      dbErrorCode: "23505",
    });
  });

  it("reports any other code, or none, as db", () => {
    expect(storeResultFromInsert({ code: "23514" })).toEqual({
      ok: false,
      kind: "db",
      dbErrorCode: "23514",
    });
    expect(storeResultFromInsert({ message: "no code" })).toEqual({
      ok: false,
      kind: "db",
      dbErrorCode: null,
    });
  });
});
