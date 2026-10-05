import { describe, it, expect, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthWeakPasswordError,
} from "@supabase/supabase-js";
import {
  classifyCreateUserError,
  createEmailAccount,
  type EmailSignupDeps,
  type EmailSignupInput,
} from "../emailSignup";
import { DEFAULT_FIRST_NAME } from "../defaultFirstName";
import { ACCOUNT_INCOMPLETE, SURVEY_SAVE_FAILED } from "../signupCodes";

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
 *   M15 classification by message text ahead of the code         -> D1, D2, D6
 *   M16 the weak_password branch removed                         -> D3
 *   M17 the message fallback removed for errors without a code   -> D4
 *   M18 Auth error text placed in a response body                -> D7
 *   M19 a createUser refusal not logged, or logged without code  -> D8
 *   M20 the duplicate-email profile lookup removed               -> B1, B4
 *   M21 a failed lookup treated as "no row"                      -> B3
 *   M22 the duplicate path deleting or creating anything         -> B1, B2, B3
 *   M23 the SURVEY_SAVE_FAILED code missing from the failure     -> F3
 *   M24 the placeholder returned to the client as a name         -> P1
 *   M25 a failed rollback changing the response                  -> R1, R3, R5
 *   M26 a users insert error logged without toLogSafeError       -> L1
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

describe("placeholder first name in the response", () => {
  it("P1 is returned as an empty name, while the stored row and metadata keep the placeholder", async () => {
    const d = deps();
    const result = await createEmailAccount(input({ firstName: null }), d);
    expect(result.status).toBe(200);
    expect((result.body.profile as Record<string, unknown>).firstName).toBe("");
    expect(d.insertProfile.mock.calls[0][0].first_name).toBe(DEFAULT_FIRST_NAME);
    expect(d.createAuthUser.mock.calls[0][0].user_metadata.first_name).toBe(
      DEFAULT_FIRST_NAME
    );
    expect(d.sendWelcomeEmail).toHaveBeenCalledWith(NORMALIZED, DEFAULT_FIRST_NAME);
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

describe("survey save failure code", () => {
  it("F3 carries SURVEY_SAVE_FAILED so the page can sign in and resave", async () => {
    const d = deps({
      insertSurveyResponse: vi.fn(async () => ({ error: { code: "22P02" } })),
    });
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({
      status: 500,
      body: {
        success: false,
        message:
          "Account was created, but saving survey data failed. Please contact support.",
        userId: USER_ID,
        code: SURVEY_SAVE_FAILED,
      },
    });
  });
});

/** A failed rollback must not change what the client is told. */
const PROFILE_FAILURE_BODY = {
  success: false,
  message: "Failed to create user profile record",
};

describe("rollback of the Auth user", () => {
  it("R1 a returned error is read and logged once with its code and the user id", async () => {
    const d = failingProfileDeps(async () => ({
      error: new AuthApiError("server error", 500, "unexpected_failure"),
    }));
    const result = await createEmailAccount(input(), d);
    expect(result.status).toBe(500);
    expect(result.body).toEqual(PROFILE_FAILURE_BODY);
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
    const result = await createEmailAccount(input(), d);
    expect(result.body).toEqual(PROFILE_FAILURE_BODY);
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
    expect(result.body).toEqual(PROFILE_FAILURE_BODY);
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
      deps({
        insertProfile: vi.fn(async () => ({
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "users_email_key" for ' +
              NORMALIZED,
            details: "Key (email)=(" + NORMALIZED + ") already exists.",
          },
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

const SENTINEL = "SENTINEL_auth_text_never_in_a_body_51c3";

/** Deps whose createUser refuses with `error`; the lookup answers `lookup`. */
function refusingDeps(
  error: unknown,
  lookup: { found: boolean; error: unknown } = { found: true, error: null }
): Spied & { findProfileByEmail: ReturnType<typeof vi.fn> } {
  return deps({
    createAuthUser: vi.fn(async () => ({ userId: null, error })),
    findProfileByEmail: vi.fn(async () => lookup),
  }) as Spied & { findProfileByEmail: ReturnType<typeof vi.fn> };
}

const DUPLICATE_BODY = {
  success: false,
  message: "An account with this email already exists",
};

describe("createUser refusals are classified by code first", () => {
  it("D1 email_exists is a duplicate even when the message says nothing about it", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "email_exists"));
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({ status: 409, body: DUPLICATE_BODY });
    expect(d.findProfileByEmail).toHaveBeenCalledWith(NORMALIZED);
  });

  it("D2 user_already_exists is a duplicate too", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "user_already_exists"));
    expect((await createEmailAccount(input(), d)).status).toBe(409);
    expect(d.findProfileByEmail).toHaveBeenCalledTimes(1);
  });

  it("D3 weak_password is a 400 with fixed text", async () => {
    const d = refusingDeps(
      new AuthWeakPasswordError("Password should be at least 6 characters", 422, ["length"])
    );
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({
      status: 400,
      body: { success: false, message: "Please choose a stronger password." },
    });
    expect(d.findProfileByEmail).not.toHaveBeenCalled();
  });

  it("D4 without a code, the message text still identifies a duplicate", async () => {
    const d = refusingDeps({
      message: "A user with this email address has already been registered",
    });
    expect((await createEmailAccount(input(), d)).status).toBe(409);
    expect(d.findProfileByEmail).toHaveBeenCalledTimes(1);
  });

  it("D5 without a code and without duplicate wording, it is a 500 with fixed text", async () => {
    const d = refusingDeps({ message: "Database error creating new user" });
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({
      status: 500,
      body: { success: false, message: "Failed to create account. Please try again." },
    });
    expect(d.findProfileByEmail).not.toHaveBeenCalled();
  });

  it("D6 a different code wins over duplicate wording in the message", async () => {
    const d = refusingDeps(
      new AuthApiError("user already exists in another region", 500, "unexpected_failure")
    );
    expect((await createEmailAccount(input(), d)).status).toBe(500);
    expect(d.findProfileByEmail).not.toHaveBeenCalled();
    expect(
      classifyCreateUserError(new AuthApiError("already exists", 500, "unexpected_failure"))
    ).toBe("failed");
  });

  it("D7 no response body carries Auth error text", async () => {
    const errors: unknown[] = [
      new AuthApiError(SENTINEL, 422, "email_exists"),
      new AuthWeakPasswordError(SENTINEL, 422, []),
      new AuthApiError(SENTINEL, 500, "unexpected_failure"),
      { message: SENTINEL },
      new AuthRetryableFetchError(SENTINEL, 503),
    ];
    for (const error of errors) {
      for (const lookup of [
        { found: true, error: null },
        { found: false, error: null },
        { found: false, error: { code: "PGRST000", message: SENTINEL } },
      ]) {
        const result = await createEmailAccount(input(), refusingDeps(error, lookup));
        expect(JSON.stringify(result.body)).not.toContain(SENTINEL);
      }
    }
  });

  it("D8 every refusal is logged once, with its code", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "email_exists"));
    await createEmailAccount(input(), d);
    const refused = logLines(d).filter((line) => line.includes("auth user creation refused"));
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('"code":"email_exists"');

    const noUser = deps({ createAuthUser: vi.fn(async () => ({ userId: null, error: null })) });
    const result = await createEmailAccount(input(), noUser);
    expect(result.status).toBe(500);
    expect(logLines(noUser).filter((l) => l.includes("auth user creation refused"))).toHaveLength(1);
  });
});

describe("duplicate email: is there a profile row?", () => {
  it("B1 no row: 409 ACCOUNT_INCOMPLETE with fixed text and one log line, nothing written or deleted", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "email_exists"), {
      found: false,
      error: null,
    });
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({
      status: 409,
      body: {
        success: false,
        message:
          "An account with this email already exists, but its setup was not completed. Please contact support.",
        code: ACCOUNT_INCOMPLETE,
      },
    });
    expect(
      logLines(d).filter((line) => line.includes("no profile row"))
    ).toEqual(["[signup] duplicate email has an Auth account but no profile row"]);
    expect(d.insertProfile).not.toHaveBeenCalled();
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
    expect(d.insertSurveyResponse).not.toHaveBeenCalled();
  });

  it("B2 a row exists: the ordinary duplicate answer, no extra log line", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "email_exists"), {
      found: true,
      error: null,
    });
    expect(await createEmailAccount(input(), d)).toEqual({ status: 409, body: DUPLICATE_BODY });
    expect(logLines(d)).toHaveLength(1);
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("B3 a failed lookup is not read as 'no row': ordinary duplicate answer, logged with its code", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "email_exists"), {
      found: false,
      error: { code: "PGRST000", message: "connection reset" },
    });
    expect(await createEmailAccount(input(), d)).toEqual({ status: 409, body: DUPLICATE_BODY });
    expect(logLines(d)).toContain(
      "[signup] profile lookup for a duplicate email failed: code=PGRST000"
    );
    expect(d.insertProfile).not.toHaveBeenCalled();
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("B4 a lost creation response: the retry hits the duplicate and reports the unfinished account", async () => {
    // First attempt: the user was created, but the response never arrived.
    const first = refusingDeps(new AuthRetryableFetchError("network down", 0));
    const firstResult = await createEmailAccount(input(), first);
    expect(firstResult.status).toBe(500);
    expect(first.insertProfile).not.toHaveBeenCalled();

    // Second attempt: Auth now knows the email, public.users does not.
    const second = refusingDeps(new AuthApiError("Conflict", 422, "email_exists"), {
      found: false,
      error: null,
    });
    const secondResult = await createEmailAccount(input(), second);
    expect(secondResult.status).toBe(409);
    expect(secondResult.body).toMatchObject({ code: ACCOUNT_INCOMPLETE });
  });
});
