import { describe, it, expect, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import {
  createEmailAccount,
  type EmailSignupDeps,
  type EmailSignupInput,
} from "../emailSignup";
import { DEFAULT_FIRST_NAME } from "../defaultFirstName";

/**
 * The email/password signup decision, executed with injected fakes. Auth
 * errors are real auth-js error instances, so the retryable check sees what
 * the admin API would return.
 *
 * Mutations of emailSignup.ts and the tests each one turns red:
 *   M1  the rollback's returned error is not read                -> R1, R3, R5
 *   M2  the retry removed                                        -> R2
 *   M3  the retry made unbounded or repeated                     -> R3
 *   M4  every rollback error retried                             -> R4
 *   M5  user_not_found / 404 not treated as already gone         -> R6, R7
 *   M6  a throwing delete not caught                             -> R5
 *   M7  email_confirm removed from the createUser attributes     -> C1
 *   M8  email lower-casing or trimming removed                   -> C1, S1
 *   M9  the metadata names changed or the placeholder replaced   -> C1, C2
 *   M10 the pause gate ignored or made constant false            -> G2
 *   M11 the password check moved after the pause gate            -> G1
 *   M12 an email address or raw error object in a log line       -> L1, L2
 *   M13 a welcome email sent after a failed survey save          -> F2
 *   M14 an empty email put in the response or sent a welcome     -> S3
 */

const EMAIL = "Person.Name@Example.com";
const NORMALIZED = "person.name@example.com";
const USER_ID = "4f1c2a9e-0000-4000-8000-000000000001";
const NOW = "2026-10-05T00:00:00.000Z";

function input(overrides: Partial<EmailSignupInput> = {}): EmailSignupInput {
  return {
    email: ` ${EMAIL} `,
    password: "correct horse battery",
    firstName: "Ann",
    lastName: "Lee",
    destinationCountry: "US",
    institutionId: "inst_1",
    university: "Example University",
    countryOfOrigin: "KR",
    ...overrides,
  };
}

type Spied = EmailSignupDeps & {
  isSignupDisabled: ReturnType<typeof vi.fn>;
  createAuthUser: ReturnType<typeof vi.fn>;
  insertProfile: ReturnType<typeof vi.fn>;
  deleteAuthUser: ReturnType<typeof vi.fn>;
  insertSurveyResponse: ReturnType<typeof vi.fn>;
  sendWelcomeEmail: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
};

function deps(overrides: Partial<EmailSignupDeps> = {}): Spied {
  return {
    isSignupDisabled: vi.fn(() => false),
    createAuthUser: vi.fn(async () => ({ userId: USER_ID, error: null })),
    insertProfile: vi.fn(async () => ({ error: null })),
    deleteAuthUser: vi.fn(async () => ({ error: null })),
    insertSurveyResponse: vi.fn(async () => ({ error: null })),
    sendWelcomeEmail: vi.fn(async () => true),
    now: () => NOW,
    log: vi.fn(),
    ...overrides,
  } as Spied;
}

function logLines(d: Spied): string[] {
  return d.log.mock.calls.map((call) => String(call[0]));
}

function rollbackLines(d: Spied): string[] {
  return logLines(d).filter((line) => line.includes("rollback"));
}

/** Deps whose users insert fails, so the rollback runs. */
function failingProfileDeps(
  deleteAuthUser: EmailSignupDeps["deleteAuthUser"]
): Spied {
  return deps({
    insertProfile: vi.fn(async () => ({
      error: { code: "23505", message: "duplicate key value" },
    })),
    deleteAuthUser: vi.fn(deleteAuthUser),
  });
}

describe("gates before account creation", () => {
  it("G1 a request without a password is AUTH_REQUIRED, checked before the pause gate", async () => {
    const d = deps({ isSignupDisabled: vi.fn(() => true) });
    const result = await createEmailAccount(input({ password: "" }), d);
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ success: false, code: "AUTH_REQUIRED" });
    expect(d.isSignupDisabled).not.toHaveBeenCalled();
    expect(d.createAuthUser).not.toHaveBeenCalled();
  });

  it("G2 the pause gate blocks creation when on and lets it through when off", async () => {
    const paused = deps({ isSignupDisabled: vi.fn(() => true) });
    const blocked = await createEmailAccount(input(), paused);
    expect(blocked.status).toBe(403);
    expect(paused.createAuthUser).not.toHaveBeenCalled();

    const open = deps({ isSignupDisabled: vi.fn(() => false) });
    const allowed = await createEmailAccount(input(), open);
    expect(allowed.status).toBe(200);
    expect(open.createAuthUser).toHaveBeenCalledTimes(1);
  });

  it("G3 a request without an email is 400 and creates nothing", async () => {
    const d = deps();
    const result = await createEmailAccount(input({ email: "" }), d);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, message: "Email is required" });
    expect(d.createAuthUser).not.toHaveBeenCalled();
  });
});

describe("createUser attributes", () => {
  it("C1 are built here: normalized email, password, email_confirm, metadata names", async () => {
    const d = deps();
    await createEmailAccount(input(), d);
    expect(d.createAuthUser).toHaveBeenCalledTimes(1);
    expect(d.createAuthUser.mock.calls[0][0]).toEqual({
      email: NORMALIZED,
      password: "correct horse battery",
      email_confirm: true,
      user_metadata: { first_name: "Ann", last_name: "Lee" },
    });
  });

  it("C2 an empty first name becomes the placeholder; an empty last name stays null", async () => {
    const d = deps();
    await createEmailAccount(input({ firstName: null, lastName: null }), d);
    expect(d.createAuthUser.mock.calls[0][0].user_metadata).toEqual({
      first_name: DEFAULT_FIRST_NAME,
      last_name: null,
    });
    expect(d.insertProfile.mock.calls[0][0]).toMatchObject({
      first_name: DEFAULT_FIRST_NAME,
      last_name: null,
    });
  });
});

describe("success path", () => {
  it("S1 writes the profile row, the survey row and the welcome email with one email value", async () => {
    const d = deps();
    const result = await createEmailAccount(input(), d);

    expect(d.insertProfile.mock.calls[0][0]).toEqual({
      id: USER_ID,
      email: NORMALIZED,
      first_name: "Ann",
      last_name: "Lee",
      raw_user_meta_data: { source: "survey_signup", destination_country: "US" },
      created_at: NOW,
      updated_at: NOW,
    });
    expect(d.insertSurveyResponse).toHaveBeenCalledWith(USER_ID);
    expect(d.sendWelcomeEmail).toHaveBeenCalledWith(NORMALIZED, "Ann");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      userId: USER_ID,
      profile: {
        firstName: "Ann",
        lastName: "Lee",
        email: NORMALIZED,
        institutionId: "inst_1",
        university: "Example University",
        countryOfOrigin: "KR",
      },
      message: "Account created successfully",
    });
    expect(d.log).not.toHaveBeenCalled();
  });

  it("S2 a welcome email that is not sent is logged and does not change the 200", async () => {
    const notSent = deps({ sendWelcomeEmail: vi.fn(async () => false) });
    expect((await createEmailAccount(input(), notSent)).status).toBe(200);
    expect(logLines(notSent)).toEqual([
      "[signup] welcome email not sent (returned false) user_id=" + USER_ID,
    ]);

    const threw = deps({
      sendWelcomeEmail: vi.fn(async () => {
        throw new Error("send failed for " + NORMALIZED);
      }),
    });
    expect((await createEmailAccount(input(), threw)).status).toBe(200);
    expect(logLines(threw)).toHaveLength(1);
    expect(logLines(threw)[0]).toContain("(threw) user_id=" + USER_ID);
  });
});

describe("whitespace-only email", () => {
  it("S3 leaves no email key in the response and sends no welcome email", async () => {
    const d = deps();
    const result = await createEmailAccount(input({ email: "   " }), d);
    expect(result.status).toBe(200);
    const profile = result.body.profile as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(profile, "email")).toBe(false);
    expect(d.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

describe("failures after the Auth user exists", () => {
  it("F1 a failed users insert answers 500 and deletes the Auth user it created", async () => {
    const d = failingProfileDeps(async () => ({ error: null }));
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({
      status: 500,
      body: { success: false, message: "Failed to create user profile record" },
    });
    expect(d.deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(d.deleteAuthUser).toHaveBeenCalledWith(USER_ID);
    expect(d.insertSurveyResponse).not.toHaveBeenCalled();
    expect(rollbackLines(d)).toEqual([]);
  });

  it("F2 a failed survey insert answers 500 with the user id and sends no welcome email", async () => {
    const d = deps({
      insertSurveyResponse: vi.fn(async () => ({ error: { code: "22P02" } })),
    });
    const result = await createEmailAccount(input(), d);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      success: false,
      message:
        "Account was created, but saving survey data failed. Please contact support.",
      userId: USER_ID,
    });
    expect(d.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
  });
});

describe("rollback of the Auth user", () => {
  it("R1 a returned error is read and logged once with its code and the user id", async () => {
    const d = failingProfileDeps(async () => ({
      error: new AuthApiError("server error", 500, "unexpected_failure"),
    }));
    const result = await createEmailAccount(input(), d);
    expect(result.status).toBe(500);
    expect(d.deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(rollbackLines(d)).toEqual([
      "[signup] rollback of auth user failed: code=unexpected_failure user_id=" +
        USER_ID,
    ]);
  });

  it("R2 a retryable error is retried once, and a successful retry logs nothing", async () => {
    const results = [
      { error: new AuthRetryableFetchError("network down", 0) },
      { error: null },
    ];
    const d = failingProfileDeps(async () => results.shift()!);
    await createEmailAccount(input(), d);
    expect(d.deleteAuthUser).toHaveBeenCalledTimes(2);
    expect(rollbackLines(d)).toEqual([]);
  });

  it("R3 a second retryable error is not retried again and is logged", async () => {
    const d = failingProfileDeps(async () => ({
      error: new AuthRetryableFetchError("bad gateway", 502),
    }));
    await createEmailAccount(input(), d);
    expect(d.deleteAuthUser).toHaveBeenCalledTimes(2);
    expect(rollbackLines(d)).toEqual([
      "[signup] rollback of auth user failed: code=none user_id=" + USER_ID,
    ]);
  });

  it("R4 a non-retryable error is not retried", async () => {
    const d = failingProfileDeps(async () => ({
      error: new AuthApiError("server error", 500, "unexpected_failure"),
    }));
    await createEmailAccount(input(), d);
    expect(d.deleteAuthUser).toHaveBeenCalledTimes(1);
  });

  it("R5 a thrown error is handled like a returned one", async () => {
    const d = failingProfileDeps(async () => {
      throw new Error("@supabase/auth-js: Expected parameter to be UUID but is not");
    });
    const result = await createEmailAccount(input(), d);
    expect(result.status).toBe(500);
    expect(d.deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(rollbackLines(d)).toEqual([
      "[signup] rollback of auth user failed: code=none user_id=" + USER_ID,
    ]);
  });

  it("R6 user_not_found means the user is already gone: no log", async () => {
    const d = failingProfileDeps(async () => ({
      error: new AuthApiError("User not found", 404, "user_not_found"),
    }));
    await createEmailAccount(input(), d);
    expect(d.deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(rollbackLines(d)).toEqual([]);
  });

  it("R7 a 404 without a code is also treated as already gone", async () => {
    const d = failingProfileDeps(async () => ({
      error: new AuthApiError("Not found", 404, undefined),
    }));
    await createEmailAccount(input(), d);
    expect(rollbackLines(d)).toEqual([]);
  });
});

describe("log lines", () => {
  it("L1 carry no email address, even when the error message quotes it", async () => {
    const scenarios: Spied[] = [
      deps({
        createAuthUser: vi.fn(async () => ({
          userId: null,
          error: new AuthApiError("rejected " + NORMALIZED, 500, "unexpected_failure"),
        })),
      }),
      failingProfileDeps(async () => ({
        error: new AuthApiError("cannot delete " + NORMALIZED, 500, "unexpected_failure"),
      })),
      deps({
        insertSurveyResponse: vi.fn(async () => ({
          error: { code: "23505", message: "Key (email)=(" + NORMALIZED + ") exists" },
        })),
      }),
    ];
    for (const d of scenarios) {
      await createEmailAccount(input(), d);
      expect(logLines(d).length).toBeGreaterThan(0);
      for (const line of logLines(d)) {
        expect(line.toLowerCase()).not.toContain(NORMALIZED);
      }
    }
  });

  it("L2 the profile insert failure is logged with the user id and the safe error", async () => {
    const d = failingProfileDeps(async () => ({ error: null }));
    await createEmailAccount(input(), d);
    const lines = logLines(d);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[signup] profile insert failed: user_id=" + USER_ID);
    expect(lines[0]).toContain('"code":"23505"');
  });
});
