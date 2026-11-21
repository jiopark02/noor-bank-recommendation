import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  HOUSEHOLD_INVITE_TTL_SECONDS,
  HOUSEHOLD_MAX_MEMBERS,
  acceptHouseholdInvite,
  cancelHouseholdInvite,
  createHouseholdInvite,
  displayFirstName,
  generateInviteToken,
  hashInviteToken,
  isInviteTokenShape,
  leaveHousehold,
  normalizeInviteEmail,
  previewHouseholdInvite,
  viewHousehold,
  type HouseholdIdentity,
  type HouseholdStore,
} from "../householdInvite";
import {
  HOUSEHOLD_INVITE_LIMIT,
  HOUSEHOLD_INVITE_WINDOW_SECONDS,
  claimHouseholdInvite,
  resolveHouseholdInviteLimitMode,
} from "../householdInviteLimit";
import { makeHouseholdStore } from "../householdStore";
import { HOUSEHOLD_MESSAGES } from "../householdCopy";
import { makeFakeClient } from "./householdFakeClient";

/**
 * The household decisions (householdInvite.ts), the invite limit
 * (householdInviteLimit.ts) and the store's reads and calls
 * (householdStore.ts), run against fakes. The SQL functions themselves are
 * probed in householdInvitesMigrationProbe.test.ts.
 *
 * Mutations and the test each one turns red:
 *   the email-confirmed check removed from accept or preview       -> T-I2
 *   a refusal given its own code, status or message                -> T-I3, T-I4
 *   preview reading the inviter before the address matches         -> T-I4
 *   the raw token sent to the database instead of its hash         -> T-I5
 *   trim or lowercase removed from either address                  -> T-I6
 *   the token added to the view answer                             -> T-I7
 *   fewer than 32 random bytes in a token                          -> T-I8
 *   a body value passed to cancel or leave                         -> T-I9
 *   the self-invite check removed                                  -> T-I10
 *   an answer code mapped to another status or code                -> T-I11
 *   an empty first name shown as ""                                -> T-I12
 *   "OFF" or " off" treated as off                                 -> T-L1
 *   the claim made after the create, or its refusal ignored        -> T-L2
 *   the limit or window changed                                    -> T-L3
 *   a message, address, token or id added to a log line            -> T-G1
 *   an error object or its message logged instead of its code      -> T-G2
 *   repair dropped from the view, reordered, or a prune call added -> T-R1
 *   email (or any other users column) read                         -> T-R2
 *   the view's expires_at filter removed (with no prune before the
 *     read, it alone keeps an expired invite off the screen)       -> T-R2
 *   the application's household size out of step with the SQL     -> M11
 */

const ID = "user-self-1";
const EMAIL = "Person@Example.TEST ";
const NORMALIZED = "person@example.test";
const INVITEE = "invitee@example.test";
const TOKEN = "sentinelToken" + "x".repeat(30);
const HASH = createHash("sha256").update(TOKEN).digest("hex");

const confirmed: HouseholdIdentity = { id: ID, email: EMAIL, emailConfirmed: true };

function ok(value: string) {
  return { ok: true as const, value };
}

function fakeStore(overrides: Partial<HouseholdStore> = {}): HouseholdStore & {
  [K in keyof HouseholdStore]: ReturnType<typeof vi.fn>;
} {
  const store = {
    ensure: vi.fn(async () => true),
    repairOwner: vi.fn(async () => ok("ok")),
    pruneExpired: vi.fn(async () => ({ ok: true as const })),
    readView: vi.fn(async () => ({
      ok: true as const,
      view: {
        role: "owner" as const,
        members: [{ self: true, role: "owner" as const, firstName: "Sam" }],
        invite: { email: INVITEE, expiresAt: "2026-11-21T00:00:00.000Z" },
      },
    })),
    claim: vi.fn(async () => ({ claim: "claimed" as const })),
    createInvite: vi.fn(async () => ok("created")),
    cancelInvite: vi.fn(async () => ok("cancelled")),
    acceptInvite: vi.fn(async () => ok("accepted")),
    leave: vi.fn(async () => ok("left")),
    readInviteByHash: vi.fn(async () => ({
      ok: true as const,
      invite: {
        householdId: "hh-1",
        invitedBy: "user-inviter",
        inviteeEmail: NORMALIZED,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    })),
    readInviter: vi.fn(async () => ({ ok: true as const, active: true, firstName: "Alex" })),
    ...overrides,
  };
  return store as never;
}

function lines(log: ReturnType<typeof vi.fn>): string[] {
  return log.mock.calls.map((call) => String(call[0]));
}

const ENFORCE = { limitMode: "enforce" as const };

describe("identity and the invite request", () => {
  it("T-I2 an unconfirmed address is refused with 403 before any database read or call", async () => {
    const unconfirmed = { ...confirmed, emailConfirmed: false };
    const store = fakeStore();
    const log = vi.fn();
    const accept = await acceptHouseholdInvite(unconfirmed, { token: TOKEN }, store, log);
    const preview = await previewHouseholdInvite(unconfirmed, { token: TOKEN }, store, log);
    for (const result of [accept, preview]) {
      expect(result.status).toBe(403);
      expect(result.body).toEqual({
        error: HOUSEHOLD_MESSAGES.EMAIL_UNCONFIRMED,
        code: "EMAIL_UNCONFIRMED",
      });
    }
    expect(store.acceptInvite).not.toHaveBeenCalled();
    expect(store.readInviteByHash).not.toHaveBeenCalled();
    expect(store.readInviter).not.toHaveBeenCalled();
  });

  it("T-I3 accept: a malformed token, a missing address and every refusal answer the same bytes", async () => {
    const log = vi.fn();
    const bodies: string[] = [];
    for (const body of [{ token: "short" }, { token: TOKEN + "=" }, {}, null, "text", [TOKEN]]) {
      const store = fakeStore();
      const r = await acceptHouseholdInvite(confirmed, body, store, log);
      expect(store.acceptInvite).not.toHaveBeenCalled();
      bodies.push(`${r.status} ${JSON.stringify(r.body)}`);
    }
    const noEmail = await acceptHouseholdInvite({ ...confirmed, email: null }, { token: TOKEN }, fakeStore(), log);
    bodies.push(`${noEmail.status} ${JSON.stringify(noEmail.body)}`);
    const refused = await acceptHouseholdInvite(
      confirmed,
      { token: TOKEN },
      fakeStore({ acceptInvite: vi.fn(async () => ok("refused")) }),
      log
    );
    bodies.push(`${refused.status} ${JSON.stringify(refused.body)}`);
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe(
      `404 ${JSON.stringify({ error: HOUSEHOLD_MESSAGES.INVITE_UNAVAILABLE, code: "INVITE_UNAVAILABLE" })}`
    );
  });

  it("T-I4 preview refuses with accept's bytes, and reads the inviter only after the address matches", async () => {
    const log = vi.fn();
    const expected = `404 ${JSON.stringify({
      error: HOUSEHOLD_MESSAGES.INVITE_UNAVAILABLE,
      code: "INVITE_UNAVAILABLE",
    })}`;
    const base = {
      householdId: "hh-1",
      invitedBy: "user-inviter",
      inviteeEmail: NORMALIZED,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const cases: Array<[string, Partial<HouseholdStore>, boolean]> = [
      ["no invite", { readInviteByHash: vi.fn(async () => ({ ok: true as const, invite: null })) }, false],
      ["expired", { readInviteByHash: vi.fn(async () => ({ ok: true as const, invite: { ...base, expiresAt: "2000-01-01T00:00:00.000Z" } })) }, false],
      ["other address", { readInviteByHash: vi.fn(async () => ({ ok: true as const, invite: { ...base, inviteeEmail: "someone@else.test" } })) }, false],
      ["inviter gone", { readInviter: vi.fn(async () => ({ ok: true as const, active: false, firstName: null })) }, true],
    ];
    for (const [label, overrides, readsInviter] of cases) {
      const store = fakeStore(overrides);
      const r = await previewHouseholdInvite(confirmed, { token: TOKEN }, store, log);
      expect(`${r.status} ${JSON.stringify(r.body)}`, label).toBe(expected);
      expect(store.readInviter.mock.calls.length, label).toBe(readsInviter ? 1 : 0);
    }
    const malformed = await previewHouseholdInvite(confirmed, { token: "nope" }, fakeStore(), log);
    expect(`${malformed.status} ${JSON.stringify(malformed.body)}`).toBe(expected);

    const store = fakeStore();
    const good = await previewHouseholdInvite(confirmed, { token: TOKEN }, store, log);
    expect(good).toEqual({ status: 200, body: { inviterFirstName: "Alex" } });
    expect(store.readInviter).toHaveBeenCalledWith("user-inviter", "hh-1");
  });

  it("T-I5 the database gets the token's SHA-256, never the token", async () => {
    const store = fakeStore();
    await acceptHouseholdInvite(confirmed, { token: TOKEN }, store, vi.fn());
    expect(store.acceptInvite).toHaveBeenCalledWith(ID, HASH, NORMALIZED);
    await previewHouseholdInvite(confirmed, { token: TOKEN }, store, vi.fn());
    expect(store.readInviteByHash).toHaveBeenCalledWith(HASH);

    const created = await createHouseholdInvite(confirmed, { email: INVITEE }, store, vi.fn(), {
      ...ENFORCE,
      newToken: () => TOKEN,
    });
    expect(created.body.token).toBe(TOKEN);
    expect(store.createInvite).toHaveBeenCalledWith(ID, INVITEE, HASH, HOUSEHOLD_INVITE_TTL_SECONDS);
    expect(JSON.stringify(store.createInvite.mock.calls)).not.toContain(TOKEN);
    expect(hashInviteToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("T-I6 both addresses are trimmed and lowercased before they are compared or stored", async () => {
    expect(normalizeInviteEmail("  Invitee@Example.TEST ")).toBe(INVITEE);
    expect(normalizeInviteEmail("not an address")).toBeNull();
    expect(normalizeInviteEmail("")).toBeNull();
    expect(normalizeInviteEmail(42)).toBeNull();
    expect(normalizeInviteEmail("a@b." + "c".repeat(320))).toBeNull();
    const store = fakeStore();
    await createHouseholdInvite(confirmed, { email: "  Invitee@Example.TEST " }, store, vi.fn(), ENFORCE);
    expect(store.createInvite.mock.calls[0][1]).toBe(INVITEE);
    await acceptHouseholdInvite(confirmed, { token: TOKEN }, store, vi.fn());
    expect(store.acceptInvite.mock.calls[0][2]).toBe(NORMALIZED);
  });

  it("T-I7 the token is answered by create only; the view carries no token", async () => {
    const created = await createHouseholdInvite(confirmed, { email: INVITEE }, fakeStore(), vi.fn(), {
      ...ENFORCE,
      newToken: () => TOKEN,
      now: () => Date.parse("2026-11-20T00:00:00.000Z"),
    });
    expect(created).toEqual({
      status: 201,
      body: { token: TOKEN, expiresAt: "2026-11-21T00:00:00.000Z" },
    });
    const view = await viewHousehold(confirmed, fakeStore(), vi.fn());
    expect(view.status).toBe(200);
    const household = view.body.household as Record<string, unknown>;
    expect(Object.keys(household).sort()).toEqual(["invite", "maxMembers", "members", "role"]);
    expect(Object.keys(household.invite as object).sort()).toEqual(["email", "expiresAt"]);
    expect(JSON.stringify(view.body)).not.toMatch(/token/i);
  });

  it("T-I8 a token is 32 random bytes, base64url without padding", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    for (const t of [a, b]) {
      expect(isInviteTokenShape(t)).toBe(true);
      expect(Buffer.from(t, "base64url").length).toBe(32);
    }
    expect(isInviteTokenShape("A".repeat(42))).toBe(false);
    expect(isInviteTokenShape("A".repeat(44))).toBe(false);
    expect(isInviteTokenShape("A".repeat(42) + "=")).toBe(false);
  });

  it("T-I9 cancel and leave call their function with the caller's id and nothing else", async () => {
    const { client, rpcCalls } = makeFakeClient({
      rpc: {
        household_invite_cancel: { data: "cancelled", error: null },
        household_leave: { data: "left", error: null },
      },
    });
    const store = makeHouseholdStore(client as never);
    expect(await cancelHouseholdInvite(confirmed, store, vi.fn())).toEqual({
      status: 200,
      body: { cancelled: true },
    });
    expect(await leaveHousehold(confirmed, store, vi.fn())).toEqual({ status: 200, body: { left: true } });
    expect(rpcCalls).toEqual([
      ["household_invite_cancel", { p_user_id: ID }],
      ["household_leave", { p_user_id: ID }],
    ]);
  });

  it("T-I10 inviting one's own address is 400 INVITE_SELF before anything else runs", async () => {
    const store = fakeStore();
    const r = await createHouseholdInvite(confirmed, { email: " PERSON@example.test" }, store, vi.fn(), ENFORCE);
    expect(r).toEqual({
      status: 400,
      body: { error: HOUSEHOLD_MESSAGES.INVITE_SELF, code: "INVITE_SELF" },
    });
    expect(store.ensure).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
    expect(store.createInvite).not.toHaveBeenCalled();
    const invalid = await createHouseholdInvite(confirmed, { email: "nope" }, store, vi.fn(), ENFORCE);
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("INVALID_EMAIL");
  });

  it("T-I11 every function answer maps to one status and code; anything else is 500", async () => {
    const accept: Array<[string, number, string | null]> = [
      ["accepted", 200, null],
      ["refused", 404, "INVITE_UNAVAILABLE"],
      ["must_leave_first", 409, "MUST_LEAVE_FIRST"],
      ["household_full", 409, "HOUSEHOLD_FULL"],
      ["already_member", 409, "ALREADY_MEMBER"],
      ["retry", 409, "HOUSEHOLD_CHANGED"],
      ["surprise", 500, "SERVER_ERROR"],
    ];
    for (const [value, status, code] of accept) {
      const r = await acceptHouseholdInvite(
        confirmed,
        { token: TOKEN },
        fakeStore({ acceptInvite: vi.fn(async () => ok(value)) }),
        vi.fn()
      );
      expect(r.status, value).toBe(status);
      expect(r.body.code ?? null, value).toBe(code);
    }
    const create: Array<[string, number, string | null]> = [
      ["created", 201, null],
      ["not_owner", 403, "NOT_OWNER"],
      ["household_full", 409, "HOUSEHOLD_FULL"],
      ["surprise", 500, "SERVER_ERROR"],
    ];
    for (const [value, status, code] of create) {
      const r = await createHouseholdInvite(
        confirmed,
        { email: INVITEE },
        fakeStore({ createInvite: vi.fn(async () => ok(value)) }),
        vi.fn(),
        ENFORCE
      );
      expect(r.status, value).toBe(status);
      expect(r.body.code ?? null, value).toBe(code);
    }
    const cancel: Array<[string, number, unknown]> = [
      ["cancelled", 200, { cancelled: true }],
      ["none", 200, { cancelled: false }],
      ["not_owner", 403, { error: HOUSEHOLD_MESSAGES.NOT_OWNER, code: "NOT_OWNER" }],
      ["surprise", 500, { error: HOUSEHOLD_MESSAGES.SERVER_ERROR, code: "SERVER_ERROR" }],
    ];
    for (const [value, status, body] of cancel) {
      const r = await cancelHouseholdInvite(confirmed, fakeStore({ cancelInvite: vi.fn(async () => ok(value)) }), vi.fn());
      expect(r, value).toEqual({ status, body });
    }
    const leave: Array<[string, number, string | null]> = [
      ["left", 200, null],
      ["solo", 409, "LEAVE_SOLO"],
      ["none", 409, "LEAVE_SOLO"],
      ["surprise", 500, "SERVER_ERROR"],
    ];
    for (const [value, status, code] of leave) {
      const r = await leaveHousehold(confirmed, fakeStore({ leave: vi.fn(async () => ok(value)) }), vi.fn());
      expect(r.status, value).toBe(status);
      expect(r.body.code ?? null, value).toBe(code);
    }
    const failed = await acceptHouseholdInvite(
      confirmed,
      { token: TOKEN },
      fakeStore({ acceptInvite: vi.fn(async () => ({ ok: false as const, code: "P0001" })) }),
      vi.fn()
    );
    expect(failed.status).toBe(500);
  });

  it("T-I12 an empty or missing first name is shown as no name", async () => {
    expect(displayFirstName("  ")).toBeNull();
    expect(displayFirstName("")).toBeNull();
    expect(displayFirstName(null)).toBeNull();
    expect(displayFirstName(" Alex ")).toBe("Alex");
    const { client } = makeFakeClient({
      tables: {
        household_members: [{ data: { id: "m-1" }, error: null }],
        users: [{ data: { first_name: "   " }, error: null }],
      },
    });
    const store = makeHouseholdStore(client as never);
    expect(await store.readInviter("user-inviter", "hh-1")).toEqual({
      ok: true,
      active: true,
      firstName: null,
    });
    const r = await previewHouseholdInvite(
      confirmed,
      { token: TOKEN },
      fakeStore({ readInviter: vi.fn(async () => ({ ok: true as const, active: true, firstName: null })) }),
      vi.fn()
    );
    expect(r).toEqual({ status: 200, body: { inviterFirstName: null } });
  });
});

describe("the invite-creation limit", () => {
  it("T-L1 exactly \"off\" skips the claim; held is 429, a failed check 503", async () => {
    expect(resolveHouseholdInviteLimitMode("off")).toBe("off");
    for (const raw of [undefined, "", "OFF", " off", "off ", "observe", "enforce"]) {
      expect(resolveHouseholdInviteLimitMode(raw), String(raw)).toBe("enforce");
    }
    const skipped = fakeStore();
    await createHouseholdInvite(confirmed, { email: INVITEE }, skipped, vi.fn(), { limitMode: "off" });
    expect(skipped.claim).not.toHaveBeenCalled();
    expect(skipped.createInvite).toHaveBeenCalledTimes(1);

    const held = await createHouseholdInvite(
      confirmed,
      { email: INVITEE },
      fakeStore({ claim: vi.fn(async () => ({ claim: "held" as const })) }),
      vi.fn(),
      ENFORCE
    );
    expect(held).toEqual({
      status: 429,
      body: { error: HOUSEHOLD_MESSAGES.INVITE_LIMIT_REACHED, code: "INVITE_LIMIT_REACHED" },
    });
    const errored = await createHouseholdInvite(
      confirmed,
      { email: INVITEE },
      fakeStore({ claim: vi.fn(async () => ({ claim: "error" as const, cause: "throw" })) }),
      vi.fn(),
      ENFORCE
    );
    expect(errored.status).toBe(503);
    expect(errored.body.code).toBe("INVITE_CHECK_UNAVAILABLE");
  });

  it("T-L2 a claim that does not pass creates nothing, and the claim comes before the create", async () => {
    for (const claim of [
      { claim: "held" as const },
      { claim: "error" as const, cause: "rpc_error" },
    ]) {
      const store = fakeStore({ claim: vi.fn(async () => claim) });
      await createHouseholdInvite(confirmed, { email: INVITEE }, store, vi.fn(), ENFORCE);
      expect(store.createInvite).not.toHaveBeenCalled();
    }
    const store = fakeStore();
    await createHouseholdInvite(confirmed, { email: INVITEE }, store, vi.fn(), ENFORCE);
    expect(store.ensure.mock.invocationCallOrder[0]).toBeLessThan(store.claim.mock.invocationCallOrder[0]);
    expect(store.claim.mock.invocationCallOrder[0]).toBeLessThan(store.createInvite.mock.invocationCallOrder[0]);
  });

  it("T-L3 the claim asks for 10 invites per 24 hours, by the caller's id", async () => {
    expect(HOUSEHOLD_INVITE_LIMIT).toBe(10);
    expect(HOUSEHOLD_INVITE_WINDOW_SECONDS).toBe(86_400);
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await claimHouseholdInvite(rpc, ID)).toEqual({ claim: "claimed" });
    expect(rpc).toHaveBeenCalledWith("household_invite_claim", {
      p_user_id: ID,
      p_max_count: 10,
      p_window_seconds: 86_400,
    });
    expect(await claimHouseholdInvite(async () => ({ data: false, error: null }), ID)).toEqual({ claim: "held" });
    expect(await claimHouseholdInvite(async () => ({ data: "yes", error: null }), ID)).toEqual({
      claim: "error",
      cause: "bad_answer",
    });
    expect(
      await claimHouseholdInvite(async () => ({ data: null, error: { code: "P0001", message: "x" } }), ID)
    ).toEqual({ claim: "error", cause: "P0001" });
    expect(
      await claimHouseholdInvite(async () => ({ data: null, error: { code: "a message" } }), ID)
    ).toEqual({ claim: "error", cause: "rpc_error" });
    expect(
      await claimHouseholdInvite(() => {
        throw new Error("boom");
      }, ID)
    ).toEqual({ claim: "error", cause: "throw" });
  });
});

describe("logs", () => {
  it("T-G1 no log line carries a token, its hash, an address, a name or an id", async () => {
    const log = vi.fn();
    const sentinelName = "Sentinelname";
    const variants: Array<Partial<HouseholdStore>> = [
      {},
      { ensure: vi.fn(async () => false) },
      { repairOwner: vi.fn(async () => ({ ok: false as const, code: "P0001" })) },
      { readView: vi.fn(async () => ({ ok: false as const, code: "42501" })) },
      { claim: vi.fn(async () => ({ claim: "held" as const })) },
      { claim: vi.fn(async () => ({ claim: "error" as const, cause: "rpc_error" })) },
      { createInvite: vi.fn(async () => ok("not_owner")) },
      { acceptInvite: vi.fn(async () => ok("refused")) },
      { acceptInvite: vi.fn(async () => ok("must_leave_first")) },
      { acceptInvite: vi.fn(async () => ({ ok: false as const, code: "23503" })) },
      { readInviter: vi.fn(async () => ({ ok: true as const, active: true, firstName: sentinelName })) },
      { readInviteByHash: vi.fn(async () => ({ ok: true as const, invite: null })) },
      { leave: vi.fn(async () => ok("solo")) },
      { cancelInvite: vi.fn(async () => ok("not_owner")) },
    ];
    for (const overrides of variants) {
      const store = fakeStore(overrides);
      await viewHousehold(confirmed, store, log);
      await createHouseholdInvite(confirmed, { email: INVITEE }, store, log, { ...ENFORCE, newToken: () => TOKEN });
      await createHouseholdInvite(confirmed, { email: "bad" }, store, log, ENFORCE);
      await cancelHouseholdInvite(confirmed, store, log);
      await previewHouseholdInvite(confirmed, { token: TOKEN }, store, log);
      await acceptHouseholdInvite(confirmed, { token: TOKEN }, store, log);
      await acceptHouseholdInvite({ ...confirmed, emailConfirmed: false }, { token: TOKEN }, store, log);
      await leaveHousehold(confirmed, store, log);
    }
    const all = lines(log).join("\n");
    expect(all).toContain("[household] route=");
    for (const secret of [TOKEN, HASH, NORMALIZED, INVITEE, "example.test", sentinelName, ID, "user-inviter", "hh-1"]) {
      expect(all, secret).not.toContain(secret);
    }
    expect(all).not.toContain("@");
    for (const line of lines(log)) {
      expect(line).toMatch(/^\[household\] route=[a-z-]+ outcome=[a-z_]+( code=[A-Za-z0-9_]+)?$/);
    }
  });

  it("T-G2 a failed call logs its error code only, and an odd code as invalid", async () => {
    const log = vi.fn();
    await leaveHousehold(
      confirmed,
      fakeStore({ leave: vi.fn(async () => ({ ok: false as const, code: "sentinel message, with spaces" })) }),
      log
    );
    await leaveHousehold(confirmed, fakeStore({ leave: vi.fn(async () => ({ ok: false as const, code: "P0001" })) }), log);
    expect(lines(log)).toEqual([
      "[household] route=leave outcome=call_failed code=invalid",
      "[household] route=leave outcome=call_failed code=P0001",
    ]);

    const { client } = makeFakeClient({
      rpc: {
        household_leave: { data: null, error: { code: "P0001", message: "sentinel-error-message" } },
        household_invite_accept: "throw",
      },
    });
    const store = makeHouseholdStore(client as never);
    expect(await store.leave(ID)).toEqual({ ok: false, code: "P0001" });
    expect(await store.acceptInvite(ID, HASH, NORMALIZED)).toEqual({ ok: false, code: "throw" });
  });
});

describe("the view", () => {
  it("T-R1 the view ensures, repairs the owner, then reads, in that order, and deletes no invite", async () => {
    const store = fakeStore();
    const r = await viewHousehold(confirmed, store, vi.fn());
    expect(r.status).toBe(200);
    const order = [store.ensure, store.repairOwner, store.readView].map(
      (fn) => fn.mock.invocationCallOrder[0]
    );
    expect(order.every((n) => typeof n === "number")).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(store.ensure).toHaveBeenCalledWith(ID);
    expect(store.repairOwner).toHaveBeenCalledWith(ID);
    expect(store.readView).toHaveBeenCalledWith(ID);
    // Expired invites are deleted by the cron route, not by a read.
    expect(store.pruneExpired).not.toHaveBeenCalled();

    const failed = fakeStore({ ensure: vi.fn(async () => false) });
    expect((await viewHousehold(confirmed, failed, vi.fn())).status).toBe(500);
    expect(failed.readView).not.toHaveBeenCalled();

    // A failed repair is logged and the view is still read.
    const degraded = fakeStore({
      repairOwner: vi.fn(async () => ({ ok: false as const, code: "P0001" })),
    });
    expect((await viewHousehold(confirmed, degraded, vi.fn())).status).toBe(200);
    expect(degraded.pruneExpired).not.toHaveBeenCalled();
  });

  it("T-R2 the store reads first_name only from users, filters on the caller's id, and the invite for the owner only", async () => {
    const { client, queries, rpcCalls } = makeFakeClient({
      rpc: { household_ensure_for_user: { data: "hh-1", error: null } },
      tables: {
        household_members: [
          { data: { household_id: "hh-1", role: "owner" }, error: null },
          {
            data: [
              { user_id: ID, role: "owner" },
              { user_id: "user-other", role: "member" },
            ],
            error: null,
          },
        ],
        users: [
          {
            data: [
              { id: ID, first_name: "Sam" },
              { id: "user-other", first_name: "" },
            ],
            error: null,
          },
        ],
        household_invites: [
          { data: { invitee_email: INVITEE, expires_at: "2026-11-21T00:00:00+00:00" }, error: null },
        ],
      },
    });
    const store = makeHouseholdStore(client as never, () => Date.parse("2026-11-20T00:00:00.000Z"));
    expect(await store.ensure(ID)).toBe(true);
    expect(rpcCalls[0]).toEqual(["household_ensure_for_user", { p_user_id: ID }]);
    const read = await store.readView(ID);
    expect(read).toEqual({
      ok: true,
      view: {
        role: "owner",
        members: [
          { self: true, role: "owner", firstName: "Sam" },
          { self: false, role: "member", firstName: null },
        ],
        invite: { email: INVITEE, expiresAt: "2026-11-21T00:00:00+00:00" },
      },
    });
    const selects = queries.map((q) => `${q.table}: ${q.ops.find(([m]) => m === "select")?.[1][0]}`);
    expect(selects).toEqual([
      "household_members: household_id, role",
      "household_members: user_id, role",
      "users: id, first_name",
      "household_invites: invitee_email, expires_at",
    ]);
    expect(queries[0].ops).toContainEqual(["eq", ["user_id", ID]]);
    expect(queries[0].ops).toContainEqual(["eq", ["status", "active"]]);
    expect(queries[1].ops).toContainEqual(["eq", ["household_id", "hh-1"]]);
    expect(queries[3].ops).toContainEqual(["gt", ["expires_at", "2026-11-20T00:00:00.000Z"]]);

    // A member's view does not read the invite.
    const member = makeFakeClient({
      tables: {
        household_members: [
          { data: { household_id: "hh-1", role: "member" }, error: null },
          { data: [{ user_id: ID, role: "member" }], error: null },
        ],
        users: [{ data: [{ id: ID, first_name: "Sam" }], error: null }],
      },
    });
    const memberRead = await makeHouseholdStore(member.client as never).readView(ID);
    expect(memberRead.ok && memberRead.view.invite).toBeNull();
    expect(member.queries.map((q) => q.table)).not.toContain("household_invites");

    // The inviter read selects first_name only.
    const inviter = makeFakeClient({
      tables: {
        household_members: [{ data: { id: "m-1" }, error: null }],
        users: [{ data: { first_name: "Alex" }, error: null }],
      },
    });
    await makeHouseholdStore(inviter.client as never).readInviter("user-inviter", "hh-1");
    const usersQuery = inviter.queries.find((q) => q.table === "users");
    expect(usersQuery?.ops).toContainEqual(["select", ["first_name"]]);

    const allSelects = [...queries, ...member.queries, ...inviter.queries]
      .filter((q) => q.table === "users")
      .map((q) => String(q.ops.find(([m]) => m === "select")?.[1][0]));
    for (const s of allSelects) {
      expect(s).not.toMatch(/email|\*/);
    }
  });
});

describe("the household size", () => {
  it("M11 the application's member limit is the SQL function's", () => {
    const sql = readFileSync(
      path.resolve(
        __dirname,
        "../../../supabase/migrations/20261120120000_household_invites_and_membership_changes.sql"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const fn = sql.slice(sql.indexOf("create or replace function public.household_max_members()"));
    const body = fn.slice(fn.indexOf("as $$") + 5, fn.indexOf("$$;"));
    expect(body.trim()).toBe(`select ${HOUSEHOLD_MAX_MEMBERS}`);
    expect(HOUSEHOLD_MAX_MEMBERS).toBe(2);
    expect(sql).toContain(`p_ttl_seconds > ${HOUSEHOLD_INVITE_TTL_SECONDS} then`);
  });
});
