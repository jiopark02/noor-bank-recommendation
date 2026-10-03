import { describe, it, expect, vi } from "vitest";
import {
  syncProfileForUser,
  type ExistingProfileRow,
  type ProfileSyncDeps,
  type ProfileSyncIdentity,
} from "../profileSync";

/**
 * The profile-sync decision, executed with injected fakes.
 *
 * Mutations of profileSync.ts and the tests each one turns red:
 *   M1  email taken from the body instead of the token     -> T1, T2, T3
 *   M2  the old "body email is required" 400 restored       -> T2
 *   M3  body email used when the token has none             -> T3
 *   M4  lower-casing and trimming of the email removed      -> T4
 *   M5  the body-id check removed                           -> T5
 *   M6  a failed existing-row lookup treated as "no row"    -> T8
 *   M7  metadata blob taken from the body                   -> T9
 *   M8  first-insert-only condition removed                 -> T10
 *   M9  error content placed in a response body             -> T14
 *   M10 the admin-configured check removed                  -> T7
 *
 * Nothing here executes the route; syncProfileRouteWiring.test.ts reads its
 * source.
 */

const SENTINEL = "SENTINEL_never_in_a_response_7b20fe";

const TOKEN_USER: ProfileSyncIdentity = {
  id: "user_token_1",
  email: "owner@example.com",
  userMetadata: { full_name: "Token Owner", provider: "google" },
};

const NOW = "2026-10-03T00:00:00.000Z";

type SpiedDeps = ProfileSyncDeps & {
  isAdminConfigured: ReturnType<typeof vi.fn>;
  findExisting: ReturnType<typeof vi.fn>;
  upsertProfile: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
};

function deps(existing: ExistingProfileRow | null = null): SpiedDeps {
  return {
    isAdminConfigured: vi.fn(() => true),
    findExisting: vi.fn(async () => ({ row: existing, error: null })),
    upsertProfile: vi.fn(async () => ({ error: null })),
    now: () => NOW,
    log: vi.fn(),
  };
}

function writtenPayload(d: SpiedDeps): Record<string, unknown> {
  expect(d.upsertProfile).toHaveBeenCalledTimes(1);
  return d.upsertProfile.mock.calls[0][0] as Record<string, unknown>;
}

describe("syncProfileForUser — email comes from the verified token", () => {
  it("T1 writes the token email when the body names a different one", async () => {
    const d = deps();
    const result = await syncProfileForUser(
      TOKEN_USER,
      { email: "someone-else@example.com" },
      d
    );
    expect(result.status).toBe(200);
    expect(writtenPayload(d).email).toBe("owner@example.com");
  });

  it("T2 succeeds without a body email and writes the token email", async () => {
    const d = deps();
    const result = await syncProfileForUser(TOKEN_USER, { first_name: "Ana" }, d);
    expect(result).toEqual({ status: 200, body: { success: true } });
    expect(writtenPayload(d).email).toBe("owner@example.com");
  });

  it.each([undefined, "", "   "])(
    "T3 refuses with 400 and touches nothing when the token email is %j",
    async (tokenEmail) => {
      const d = deps();
      const result = await syncProfileForUser(
        { ...TOKEN_USER, email: tokenEmail },
        { email: "body@example.com" },
        d
      );
      expect(result).toEqual({
        status: 400,
        body: { success: false, message: "email is required" },
      });
      expect(d.findExisting).not.toHaveBeenCalled();
      expect(d.upsertProfile).not.toHaveBeenCalled();
    }
  );

  it("T4 lower-cases and trims the token email", async () => {
    const d = deps();
    await syncProfileForUser(
      { ...TOKEN_USER, email: "  Owner@Example.COM " },
      {},
      d
    );
    expect(writtenPayload(d).email).toBe("owner@example.com");
  });
});

describe("syncProfileForUser — id comes from the verified token", () => {
  it("T5 refuses a body id naming another user, before any read or write", async () => {
    const d = deps();
    const result = await syncProfileForUser(TOKEN_USER, { id: "user_other" }, d);
    expect(result).toEqual({
      status: 403,
      body: { success: false, message: "Forbidden" },
    });
    expect(d.findExisting).not.toHaveBeenCalled();
    expect(d.upsertProfile).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", {}],
    ["equal", { id: "user_token_1" }],
  ])("T6 proceeds with the token id when the body id is %s", async (_label, body) => {
    const d = deps();
    const result = await syncProfileForUser(TOKEN_USER, body, d);
    expect(result.status).toBe(200);
    expect(d.findExisting).toHaveBeenCalledWith("user_token_1");
    expect(writtenPayload(d).id).toBe("user_token_1");
  });
});

describe("syncProfileForUser — preconditions and the existing-row read", () => {
  it("T7 refuses with 500 before any read when the admin client is unconfigured", async () => {
    const d = deps();
    d.isAdminConfigured.mockReturnValue(false);
    const result = await syncProfileForUser(TOKEN_USER, {}, d);
    expect(result).toEqual({
      status: 500,
      body: { success: false, message: "Supabase admin is not configured" },
    });
    expect(d.findExisting).not.toHaveBeenCalled();
    expect(d.upsertProfile).not.toHaveBeenCalled();
  });

  it("T8 writes nothing and answers 500 when the existing-row read fails", async () => {
    const d = deps();
    d.findExisting.mockResolvedValue({
      row: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    const result = await syncProfileForUser(TOKEN_USER, {}, d);
    expect(result).toEqual({
      status: 500,
      body: { success: false, message: "Failed to sync user profile" },
    });
    expect(d.upsertProfile).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(
      "[sync-profile] existing-row lookup failed; not writing: code=57014"
    );
  });
});

describe("syncProfileForUser — first insert versus existing row", () => {
  it("T9 on a new row writes created_at and the token's metadata, not the body's", async () => {
    const d = deps(null);
    await syncProfileForUser(
      TOKEN_USER,
      { raw_user_meta_data: { injected: true } },
      d
    );
    const payload = writtenPayload(d);
    expect(payload.created_at).toBe(NOW);
    expect(payload.updated_at).toBe(NOW);
    expect(payload.raw_user_meta_data).toEqual({
      full_name: "Token Owner",
      provider: "google",
    });
  });

  it("T10 on an existing row writes neither created_at nor the metadata blob", async () => {
    const d = deps({ first_name: "Stored", last_name: "Name" });
    await syncProfileForUser(
      TOKEN_USER,
      { raw_user_meta_data: { injected: true } },
      d
    );
    const payload = writtenPayload(d);
    expect(payload).not.toHaveProperty("created_at");
    expect(payload).not.toHaveProperty("raw_user_meta_data");
    expect(payload.updated_at).toBe(NOW);
  });

  it("T11 keeps stored names when the body's are empty, and sanitizes supplied ones", async () => {
    const kept = deps({ first_name: "Stored", last_name: "Name" });
    await syncProfileForUser(TOKEN_USER, { first_name: "", last_name: "" }, kept);
    expect(writtenPayload(kept)).toMatchObject({
      first_name: "Stored",
      last_name: "Name",
    });

    const fresh = deps(null);
    await syncProfileForUser(TOKEN_USER, {}, fresh);
    expect(writtenPayload(fresh)).toMatchObject({
      first_name: "User",
      last_name: null,
    });

    const supplied = deps(null);
    await syncProfileForUser(
      TOKEN_USER,
      { first_name: "José\n## injected", last_name: "Kim" },
      supplied
    );
    const payload = writtenPayload(supplied);
    expect(payload.first_name).not.toMatch(/\n/);
    expect(payload.first_name).toMatch(/^José/);
    expect(payload.last_name).toBe("Kim");
  });
});

describe("syncProfileForUser — the write and the response", () => {
  it("T12 answers 500 when the upsert fails", async () => {
    const d = deps();
    d.upsertProfile.mockResolvedValue({ error: { code: "23505" } });
    const result = await syncProfileForUser(TOKEN_USER, {}, d);
    expect(result).toEqual({
      status: 500,
      body: { success: false, message: "Failed to sync user profile" },
    });
  });

  it("T13 answers 200 with success and writes exactly once", async () => {
    const d = deps();
    const result = await syncProfileForUser(TOKEN_USER, {}, d);
    expect(result).toEqual({ status: 200, body: { success: true } });
    expect(d.upsertProfile).toHaveBeenCalledTimes(1);
  });

  it("T14 failure bodies carry only success and message, and no error content", async () => {
    const failingRead = deps();
    failingRead.findExisting.mockResolvedValue({
      row: null,
      error: { code: SENTINEL, message: SENTINEL, details: SENTINEL },
    });
    const failingWrite = deps();
    failingWrite.upsertProfile.mockResolvedValue({
      error: { code: SENTINEL, message: SENTINEL, details: SENTINEL },
    });

    for (const d of [failingRead, failingWrite]) {
      const result = await syncProfileForUser(TOKEN_USER, {}, d);
      expect(result.status).toBe(500);
      expect(Object.keys(result.body).sort()).toEqual(["message", "success"]);
      expect(JSON.stringify(result.body)).not.toContain(SENTINEL);
    }
  });
});
