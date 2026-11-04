import { describe, it, expect, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthWeakPasswordError,
} from "@supabase/supabase-js";
import {
  classifyCreateUserError,
  createEmailAccount,
  CONFIRMATION_REQUIRED_MESSAGE,
  type EmailSignupDeps,
  type EmailSignupInput,
  type ProfileRow,
} from "../emailSignup";
import { DEFAULT_FIRST_NAME } from "../defaultFirstName";
import { ACCOUNT_INCOMPLETE, INVALID_MONTHLY_AMOUNT } from "../signupCodes";
import {
  INVALID_MONTHLY_INCOME_MESSAGE,
  INVALID_MONTHLY_SPENDING_MESSAGE,
} from "../surveyMoney";

/**
 * The email/password signup decision, executed with injected fakes. Auth
 * errors are real auth-js error instances, so the retryable check sees what
 * the admin API would return.
 *
 * Plan mutations (Gate 1) and the tests each one turns red:
 *   M1  createUser with email_confirm restored               -> C1
 *   M2  the confirmation email skipped after a failed survey -> F2
 *   M3  a rollback on the resignup path                      -> RS1
 *   M4  a rollback on a 23505                                -> RS5
 *   M5  the request's names on the resignup path             -> RS1
 *   M6  sending without a claim                              -> RS2
 *   M7  a failed lookup read as "no row"                     -> RS4
 *   M20 sending on an id mismatch                            -> RS7, RS8
 *   M21 sending when the 23505 re-read fails                 -> RS9
 *
 * Earlier mutations kept from the createUser version:
 *   the rollback's returned error not read                   -> R1, R3, R5
 *   the retry removed / unbounded / every error retried      -> R2, R3, R4
 *   user_not_found / 404 not treated as already gone         -> R6, R7
 *   email lower-casing or trimming removed                   -> C1, S1
 *   the pause gate ignored / password check after it         -> G1, G2
 *   an email address or raw error object in a log line       -> L1, L2
 *   classification by message ahead of code, etc.            -> D1-D8
 *   input checks reordered or removed                        -> V1-V9
 *   the money check moved or its code lost                   -> M1-M5
 */

const EMAIL = "Person.Name@Example.com";
const NORMALIZED = "person.name@example.com";
const USER_ID = "4f1c2a9e-0000-4000-8000-000000000001";
const OTHER_ID = "4f1c2a9e-0000-4000-8000-0000000000ff";
const TOKEN = "tok_1";
const APP = "https://noor.example";
const LINK = APP + "/auth/callback#token_hash=" + TOKEN + "&type=signup";
const NOW = "2026-10-05T00:00:00.000Z";

const STORED_ROW: ProfileRow = { id: USER_ID, first_name: "Stored", last_name: "Row" };

function input(overrides: Partial<EmailSignupInput> = {}): EmailSignupInput {
  return {
    email: ` ${EMAIL} `,
    password: "correct horse battery",
    firstName: "Ann",
    lastName: "Lee",
    destinationCountry: "US",
    surveyBody: { monthly_income: 2000, monthly_budget: 1500 },
    ...overrides,
  };
}

type Spied = EmailSignupDeps & {
  isSignupDisabled: ReturnType<typeof vi.fn>;
  generateSignupLink: ReturnType<typeof vi.fn>;
  findProfileByEmail: ReturnType<typeof vi.fn>;
  insertProfile: ReturnType<typeof vi.fn>;
  deleteAuthUser: ReturnType<typeof vi.fn>;
  insertSurveyResponse: ReturnType<typeof vi.fn>;
  claimConfirmationSend: ReturnType<typeof vi.fn>;
  sendConfirmationEmail: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
};

function deps(overrides: Partial<EmailSignupDeps> = {}): Spied {
  return {
    isSignupDisabled: vi.fn(() => false),
    generateSignupLink: vi.fn(async () => ({ userId: USER_ID, hashedToken: TOKEN, error: null })),
    findProfileByEmail: vi.fn(async () => ({ row: null, error: null })),
    insertProfile: vi.fn(async () => ({ error: null })),
    deleteAuthUser: vi.fn(async () => ({ error: null })),
    insertSurveyResponse: vi.fn(async () => ({ error: null })),
    claimConfirmationSend: vi.fn(async () => "claimed" as const),
    sendConfirmationEmail: vi.fn(async () => true),
    appUrl: APP,
    now: () => NOW,
    log: vi.fn(),
    ...overrides,
  } as Spied;
}

/** findProfileByEmail answering each call in turn, the last one repeating. */
function lookups(...answers: Array<{ row: ProfileRow | null; error: unknown }>) {
  let i = 0;
  return vi.fn(async () => answers[Math.min(i++, answers.length - 1)]);
}

function logLines(d: Spied): string[] {
  return d.log.mock.calls.map((call) => String(call[0]));
}

function rollbackLines(d: Spied): string[] {
  return logLines(d).filter((line) => line.includes("rollback"));
}

/** Deps whose users insert fails with a code other than 23505, so the rollback runs. */
function failingProfileDeps(
  deleteAuthUser: EmailSignupDeps["deleteAuthUser"]
): Spied {
  return deps({
    insertProfile: vi.fn(async () => ({
      error: { code: "23503", message: "insert or update violates foreign key" },
    })),
    deleteAuthUser: vi.fn(deleteAuthUser),
  });
}

/** The body of a signup that fully succeeded. */
const ACCEPTED_BODY = {
  success: true,
  confirmationRequired: true,
  confirmationEmailSent: true,
  surveySaved: true,
  message: CONFIRMATION_REQUIRED_MESSAGE,
};

describe("gates before account creation", () => {
  it("G1 a request without a password is AUTH_REQUIRED, checked before the pause gate", async () => {
    const d = deps({ isSignupDisabled: vi.fn(() => true) });
    const result = await createEmailAccount(input({ password: "" }), d);
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ success: false, code: "AUTH_REQUIRED" });
    expect(d.isSignupDisabled).not.toHaveBeenCalled();
    expect(d.generateSignupLink).not.toHaveBeenCalled();
  });

  it("G2 the pause gate blocks creation when on and lets it through when off", async () => {
    const paused = deps({ isSignupDisabled: vi.fn(() => true) });
    const blocked = await createEmailAccount(input(), paused);
    expect(blocked.status).toBe(403);
    expect(paused.generateSignupLink).not.toHaveBeenCalled();
    expect(paused.findProfileByEmail).not.toHaveBeenCalled();

    const open = deps({ isSignupDisabled: vi.fn(() => false) });
    const allowed = await createEmailAccount(input(), open);
    expect(allowed.status).toBe(200);
    expect(open.generateSignupLink).toHaveBeenCalledTimes(1);
  });

  it("G3 a request without an email is 400 and creates nothing", async () => {
    const d = deps();
    const result = await createEmailAccount(input({ email: "" }), d);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, message: "Email is required" });
    expect(d.generateSignupLink).not.toHaveBeenCalled();
  });
});

describe("generateLink arguments", () => {
  it("C1 are built here: normalized email, password, the request's names, and no email_confirm", async () => {
    const d = deps();
    await createEmailAccount(input(), d);
    expect(d.generateSignupLink).toHaveBeenCalledTimes(1);
    const args = d.generateSignupLink.mock.calls[0][0];
    expect(args).toEqual({
      email: NORMALIZED,
      password: "correct horse battery",
      data: { first_name: "Ann", last_name: "Lee" },
    });
    expect(JSON.stringify(d.generateSignupLink.mock.calls)).not.toContain("email_confirm");
  });

  it("C2 an empty last name stays null", async () => {
    const d = deps();
    await createEmailAccount(input({ firstName: "Ann", lastName: null }), d);
    expect(d.generateSignupLink.mock.calls[0][0].data).toEqual({
      first_name: "Ann",
      last_name: null,
    });
    expect(d.insertProfile.mock.calls[0][0]).toMatchObject({
      first_name: "Ann",
      last_name: null,
    });
  });
});

describe("input checks after the gates", () => {
  it("V1 a paused signup answers 403 whatever the email and name are", async () => {
    const invalid: Array<Partial<EmailSignupInput>> = [
      { email: "   " },
      { email: 42 },
      { email: "a@b" },
      { firstName: null },
    ];
    for (const overrides of invalid) {
      const d = deps({ isSignupDisabled: vi.fn(() => true) });
      const result = await createEmailAccount(input(overrides), d);
      expect(result.status).toBe(403);
      expect(d.generateSignupLink).not.toHaveBeenCalled();
    }
  });

  it("V2 an email of only whitespace is 400 Email is required and reads nothing", async () => {
    const d = deps();
    const result = await createEmailAccount(input({ email: "   " }), d);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, message: "Email is required" });
    expect(d.findProfileByEmail).not.toHaveBeenCalled();
    expect(d.generateSignupLink).not.toHaveBeenCalled();
    expect(d.insertProfile).not.toHaveBeenCalled();
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it.each([42, {}, ["a@b.co"]])(
    "V3 a non-string email (%j) is 400 Email is required, not a throw",
    async (email) => {
      const d = deps();
      const result = await createEmailAccount(input({ email }), d);
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ success: false, message: "Email is required" });
      expect(d.generateSignupLink).not.toHaveBeenCalled();
    }
  );

  it.each(["a@b", "a b@c.co", "@x.co", "x@.co"])(
    "V4 a malformed email (%j) is 400 with fixed text and creates nothing",
    async (email) => {
      const d = deps();
      const result = await createEmailAccount(input({ email }), d);
      expect(result.status).toBe(400);
      expect(result.body).toEqual({
        success: false,
        message: "Please enter a valid email address",
      });
      expect(d.generateSignupLink).not.toHaveBeenCalled();
    }
  );

  it.each([null, "", "   ", "\u0001"])(
    "V5 an empty first name (%j) is 400 with fixed text and writes nothing",
    async (firstName) => {
      const d = deps();
      const result = await createEmailAccount(input({ firstName }), d);
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ success: false, message: "First name is required" });
      expect(d.generateSignupLink).not.toHaveBeenCalled();
      expect(d.insertProfile).not.toHaveBeenCalled();
    }
  );

  it("V6 the email is checked before the first name", async () => {
    const d = deps();
    const result = await createEmailAccount(input({ email: "a@b", firstName: null }), d);
    expect(result.body).toEqual({
      success: false,
      message: "Please enter a valid email address",
    });
  });

  it("V8 the sanitized first name is the one stored and put in the metadata", async () => {
    const d = deps();
    await createEmailAccount(input({ firstName: "  Ann   Lee " }), d);
    expect(d.insertProfile.mock.calls[0][0].first_name).toBe("Ann Lee");
    expect(d.generateSignupLink.mock.calls[0][0].data.first_name).toBe("Ann Lee");
  });

  it("V9 the last name is sanitized here, and one that sanitizes to nothing is null", async () => {
    const d = deps();
    await createEmailAccount(input({ lastName: "  Lee \u0001 " }), d);
    expect(d.generateSignupLink.mock.calls[0][0].data.last_name).toBe("Lee");
    expect(d.insertProfile.mock.calls[0][0].last_name).toBe("Lee");

    const blank = deps();
    await createEmailAccount(input({ lastName: "   " }), blank);
    expect(blank.generateSignupLink.mock.calls[0][0].data.last_name).toBeNull();
    expect(blank.insertProfile.mock.calls[0][0].last_name).toBeNull();
  });
});

describe("success path", () => {
  it("S1 writes the profile and survey rows, claims, and sends the link only", async () => {
    const d = deps();
    const result = await createEmailAccount(input(), d);

    expect(d.findProfileByEmail).toHaveBeenCalledWith(NORMALIZED);
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
    expect(d.claimConfirmationSend).toHaveBeenCalledWith(USER_ID);
    expect(d.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    // The recipient and the link, nothing else: no name reaches the email.
    expect(d.sendConfirmationEmail.mock.calls[0]).toEqual([NORMALIZED, LINK]);

    expect(result).toEqual({ status: 200, body: ACCEPTED_BODY });
    expect(result.body).not.toHaveProperty("userId");
    expect(result.body).not.toHaveProperty("profile");
    expect(result.body).not.toHaveProperty("email");
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
    expect(d.log).not.toHaveBeenCalled();
  });

  it("S2 a confirmation email that is not sent is logged and answered 200, confirmationEmailSent false", async () => {
    const notSent = deps({ sendConfirmationEmail: vi.fn(async () => false) });
    const r1 = await createEmailAccount(input(), notSent);
    expect(r1).toEqual({ status: 200, body: { ...ACCEPTED_BODY, confirmationEmailSent: false } });
    expect(logLines(notSent)).toEqual([
      "[signup] signup confirmation not sent (returned false) user_id=" + USER_ID,
    ]);

    const threw = deps({
      sendConfirmationEmail: vi.fn(async () => {
        throw new Error("send failed for " + NORMALIZED);
      }),
    });
    const r2 = await createEmailAccount(input(), threw);
    expect(r2.status).toBe(200);
    expect(r2.body.confirmationEmailSent).toBe(false);
    expect(logLines(threw)).toHaveLength(1);
    expect(logLines(threw)[0]).toContain("(threw) user_id=" + USER_ID);
  });

  it.each(["held", "error"] as const)(
    "S3 a claim that answers %s sends nothing and says so",
    async (claim) => {
      const d = deps({ claimConfirmationSend: vi.fn(async () => claim) });
      const result = await createEmailAccount(input(), d);
      expect(result).toEqual({
        status: 200,
        body: { ...ACCEPTED_BODY, confirmationEmailSent: false },
      });
      expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
      expect(logLines(d)).toEqual([
        "[signup] signup confirmation not sent (claim=" + claim + ") user_id=" + USER_ID,
      ]);
    }
  );
});

describe("a real first name equal to the placeholder", () => {
  // Records current behavior; it is not the intended one. The placeholder and
  // a real first name that happens to equal it cannot be told apart. A change
  // that resolves the collision turns this test red and should update it.
  it("V7 records current behavior, a known collision: a real first name \"User\" is stored and sent as metadata as is", async () => {
    const d = deps();
    const result = await createEmailAccount(input({ firstName: DEFAULT_FIRST_NAME }), d);
    expect(result.status).toBe(200);
    expect(d.insertProfile.mock.calls[0][0].first_name).toBe(DEFAULT_FIRST_NAME);
    expect(d.generateSignupLink.mock.calls[0][0].data.first_name).toBe(DEFAULT_FIRST_NAME);
  });
});

describe("failures after the Auth user exists", () => {
  it("F1 a users insert failing with a code other than 23505 answers 500 and deletes the Auth user", async () => {
    const d = failingProfileDeps(async () => ({ error: null }));
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({
      status: 500,
      body: { success: false, message: "Failed to create user profile record" },
    });
    expect(d.deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(d.deleteAuthUser).toHaveBeenCalledWith(USER_ID);
    expect(d.insertSurveyResponse).not.toHaveBeenCalled();
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(rollbackLines(d)).toEqual([]);
  });

  it("F2 a failed survey insert answers 200 surveySaved false, and the email is still sent", async () => {
    const d = deps({
      insertSurveyResponse: vi.fn(async () => ({ error: { code: "22P02" } })),
    });
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({
      status: 200,
      body: { ...ACCEPTED_BODY, surveySaved: false },
    });
    expect(d.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
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
        generateSignupLink: vi.fn(async () => ({
          userId: null,
          hashedToken: null,
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
      deps({
        findProfileByEmail: vi.fn(async () => ({
          row: null,
          error: { code: "PGRST000", message: "lookup " + NORMALIZED },
        })),
      }),
      deps({
        findProfileByEmail: vi.fn(async () => ({ row: { ...STORED_ROW, id: OTHER_ID }, error: null })),
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
    expect(lines[0]).toContain('"code":"23503"');
  });
});

const SENTINEL = "SENTINEL_auth_text_never_in_a_body_51c3";

/**
 * Deps where no row exists before the signup, generateLink refuses with
 * `error`, and answerDuplicate's lookup answers `duplicateLookup`.
 */
function refusingDeps(
  error: unknown,
  duplicateLookup: { row: ProfileRow | null; error: unknown } = { row: STORED_ROW, error: null }
): Spied {
  return deps({
    generateSignupLink: vi.fn(async () => ({ userId: null, hashedToken: null, error })),
    findProfileByEmail: lookups({ row: null, error: null }, duplicateLookup),
  });
}

const DUPLICATE_BODY = {
  success: false,
  message: "An account with this email already exists",
};

describe("generateLink refusals are classified by code first", () => {
  it("D1 email_exists is a duplicate even when the message says nothing about it", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "email_exists"));
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({ status: 409, body: DUPLICATE_BODY });
    expect(d.findProfileByEmail).toHaveBeenCalledTimes(2);
    expect(d.findProfileByEmail).toHaveBeenLastCalledWith(NORMALIZED);
  });

  it("D2 user_already_exists is a duplicate too", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "user_already_exists"));
    expect((await createEmailAccount(input(), d)).status).toBe(409);
    expect(d.findProfileByEmail).toHaveBeenCalledTimes(2);
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
    expect(d.findProfileByEmail).toHaveBeenCalledTimes(1);
  });

  it("D4 without a code, the message text still identifies a duplicate", async () => {
    const d = refusingDeps({
      message: "A user with this email address has already been registered",
    });
    expect((await createEmailAccount(input(), d)).status).toBe(409);
    expect(d.findProfileByEmail).toHaveBeenCalledTimes(2);
  });

  it("D5 without a code and without duplicate wording, it is a 500 with fixed text", async () => {
    const d = refusingDeps({ message: "Database error creating new user" });
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({
      status: 500,
      body: { success: false, message: "Failed to create account. Please try again." },
    });
    expect(d.findProfileByEmail).toHaveBeenCalledTimes(1);
  });

  it("D6 a different code wins over duplicate wording in the message", async () => {
    const d = refusingDeps(
      new AuthApiError("user already exists in another region", 500, "unexpected_failure")
    );
    expect((await createEmailAccount(input(), d)).status).toBe(500);
    expect(d.findProfileByEmail).toHaveBeenCalledTimes(1);
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
        { row: STORED_ROW, error: null },
        { row: null, error: null },
        { row: null, error: { code: "PGRST000", message: SENTINEL } },
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

    const noUser = deps({
      generateSignupLink: vi.fn(async () => ({ userId: null, hashedToken: null, error: null })),
    });
    const result = await createEmailAccount(input(), noUser);
    expect(result.status).toBe(500);
    expect(logLines(noUser).filter((l) => l.includes("auth user creation refused"))).toHaveLength(1);
  });
});

describe("duplicate refusal with no row before the signup: answerDuplicate", () => {
  it("B1 still no row: 409 ACCOUNT_INCOMPLETE with fixed text and one log line, nothing written or deleted", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "email_exists"), {
      row: null,
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
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it("B2 a row appeared since: the ordinary duplicate answer, no extra log line", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "email_exists"), {
      row: STORED_ROW,
      error: null,
    });
    expect(await createEmailAccount(input(), d)).toEqual({ status: 409, body: DUPLICATE_BODY });
    expect(logLines(d)).toHaveLength(1);
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("B3 a failed duplicate lookup is not read as 'no row': ordinary duplicate answer, logged with its code", async () => {
    const d = refusingDeps(new AuthApiError("Conflict", 422, "email_exists"), {
      row: null,
      error: { code: "PGRST000", message: "connection reset" },
    });
    expect(await createEmailAccount(input(), d)).toEqual({ status: 409, body: DUPLICATE_BODY });
    expect(logLines(d)).toContain(
      "[signup] profile lookup for a duplicate email failed: code=PGRST000"
    );
    expect(d.insertProfile).not.toHaveBeenCalled();
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
  });
});

describe("resignup and the 23505 race (STOP-1)", () => {
  it("RS1 a row exists: generateLink gets the row's names, nothing is inserted or deleted, claim then send, full-success body", async () => {
    const d = deps({ findProfileByEmail: vi.fn(async () => ({ row: STORED_ROW, error: null })) });
    const result = await createEmailAccount(input(), d);
    const args = d.generateSignupLink.mock.calls[0][0];
    expect(args.data).toEqual({ first_name: "Stored", last_name: "Row" });
    expect(args.data).not.toEqual({ first_name: "Ann", last_name: "Lee" });
    expect(d.insertProfile).not.toHaveBeenCalled();
    expect(d.insertSurveyResponse).not.toHaveBeenCalled();
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
    expect(d.claimConfirmationSend).toHaveBeenCalledTimes(1);
    expect(d.claimConfirmationSend).toHaveBeenCalledWith(USER_ID);
    expect(d.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(d.sendConfirmationEmail.mock.calls[0]).toEqual([NORMALIZED, LINK]);
    expect(result).toEqual({ status: 200, body: ACCEPTED_BODY });
  });

  it("RS2 a held claim on resignup sends nothing; the body is the same", async () => {
    const d = deps({
      findProfileByEmail: vi.fn(async () => ({ row: STORED_ROW, error: null })),
      claimConfirmationSend: vi.fn(async () => "held" as const),
    });
    const result = await createEmailAccount(input(), d);
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: ACCEPTED_BODY });
  });

  it("RS3 a claim error on resignup sends nothing, answers the same body, and is logged", async () => {
    const d = deps({
      findProfileByEmail: vi.fn(async () => ({ row: STORED_ROW, error: null })),
      claimConfirmationSend: vi.fn(async () => "error" as const),
    });
    const result = await createEmailAccount(input(), d);
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: ACCEPTED_BODY });
    expect(logLines(d)).toEqual([
      "[signup] resignup confirmation not sent (claim=error) user_id=" + USER_ID,
    ]);
  });

  it("RS4 a failed lookup before the signup is 500 and calls nothing else", async () => {
    const d = deps({
      findProfileByEmail: vi.fn(async () => ({ row: null, error: { code: "PGRST000" } })),
    });
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({
      status: 500,
      body: { success: false, message: "Failed to create account. Please try again." },
    });
    expect(d.generateSignupLink).not.toHaveBeenCalled();
    expect(d.insertProfile).not.toHaveBeenCalled();
    expect(d.claimConfirmationSend).not.toHaveBeenCalled();
    expect(logLines(d)).toEqual([
      "[signup] profile lookup before signup failed: code=PGRST000",
    ]);
  });

  it("RS5 no row, then a 23505 whose re-read finds the same id: no rollback, no survey, claim then send, same body", async () => {
    const d = deps({
      findProfileByEmail: lookups({ row: null, error: null }, { row: STORED_ROW, error: null }),
      insertProfile: vi.fn(async () => ({ error: { code: "23505", message: "duplicate" } })),
    });
    const result = await createEmailAccount(input(), d);
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
    expect(d.insertSurveyResponse).not.toHaveBeenCalled();
    expect(d.findProfileByEmail).toHaveBeenCalledTimes(2);
    expect(d.claimConfirmationSend).toHaveBeenCalledWith(USER_ID);
    expect(d.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 200, body: ACCEPTED_BODY });
  });

  it("RS6 a row exists and generateLink says email_exists: the ordinary 409, not ACCOUNT_INCOMPLETE", async () => {
    const d = deps({
      findProfileByEmail: vi.fn(async () => ({ row: STORED_ROW, error: null })),
      generateSignupLink: vi.fn(async () => ({
        userId: null,
        hashedToken: null,
        error: new AuthApiError("Conflict", 422, "email_exists"),
      })),
    });
    const result = await createEmailAccount(input(), d);
    expect(result).toEqual({ status: 409, body: DUPLICATE_BODY });
    expect(result.body).not.toHaveProperty("code");
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it("RS7 resignup with a row id that is not generateLink's id: no claim, no send, same body, both ids logged", async () => {
    const d = deps({
      findProfileByEmail: vi.fn(async () => ({ row: { ...STORED_ROW, id: OTHER_ID }, error: null })),
    });
    const result = await createEmailAccount(input(), d);
    expect(d.claimConfirmationSend).not.toHaveBeenCalled();
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: ACCEPTED_BODY });
    expect(logLines(d)).toEqual([
      "[signup] resignup id mismatch branch=resignup row_id=" + OTHER_ID + " auth_id=" + USER_ID,
    ]);
  });

  it("RS8 a 23505 whose re-read finds another id: no claim, no send, same body, both ids logged", async () => {
    const d = deps({
      findProfileByEmail: lookups(
        { row: null, error: null },
        { row: { ...STORED_ROW, id: OTHER_ID }, error: null }
      ),
      insertProfile: vi.fn(async () => ({ error: { code: "23505" } })),
    });
    const result = await createEmailAccount(input(), d);
    expect(d.claimConfirmationSend).not.toHaveBeenCalled();
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: ACCEPTED_BODY });
    expect(logLines(d)).toEqual([
      "[signup] resignup id mismatch branch=race-23505 row_id=" + OTHER_ID + " auth_id=" + USER_ID,
    ]);
  });

  it("RS9 a 23505 whose re-read fails: no claim, no send, same body, logged", async () => {
    const d = deps({
      findProfileByEmail: lookups({ row: null, error: null }, { row: null, error: { code: "PGRST000" } }),
      insertProfile: vi.fn(async () => ({ error: { code: "23505" } })),
    });
    const result = await createEmailAccount(input(), d);
    expect(d.claimConfirmationSend).not.toHaveBeenCalled();
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: ACCEPTED_BODY });
    expect(logLines(d)).toEqual([
      "[signup] resignup race-23505 lookup=error code=PGRST000 auth_id=" + USER_ID,
    ]);
  });

  it("RS10 a 23505 whose re-read finds no row: no claim, no send, same body, logged", async () => {
    const d = deps({
      insertProfile: vi.fn(async () => ({ error: { code: "23505" } })),
    });
    const result = await createEmailAccount(input(), d);
    expect(d.claimConfirmationSend).not.toHaveBeenCalled();
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(d.deleteAuthUser).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: ACCEPTED_BODY });
    expect(logLines(d)).toEqual([
      "[signup] resignup id mismatch branch=race-23505 lookup=none auth_id=" + USER_ID,
    ]);
  });
});

describe("monthly money answers, checked before anything is read or created", () => {
  it("M1 an income sent as a string is 400 INVALID_MONTHLY_AMOUNT and nothing is read or created", async () => {
    const d = deps();
    const result = await createEmailAccount(
      input({ surveyBody: { monthly_income: "2000", monthly_budget: 1500 } }),
      d
    );
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      success: false,
      message: INVALID_MONTHLY_INCOME_MESSAGE,
      code: INVALID_MONTHLY_AMOUNT,
    });
    expect(d.findProfileByEmail).not.toHaveBeenCalled();
    expect(d.generateSignupLink).not.toHaveBeenCalled();
    expect(d.insertProfile).not.toHaveBeenCalled();
    expect(d.insertSurveyResponse).not.toHaveBeenCalled();
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it("M2 a missing monthly_budget is refused the same way", async () => {
    const d = deps();
    const result = await createEmailAccount(
      input({ surveyBody: { monthly_income: 2000 } }),
      d
    );
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      success: false,
      message: INVALID_MONTHLY_SPENDING_MESSAGE,
      code: INVALID_MONTHLY_AMOUNT,
    });
    expect(d.generateSignupLink).not.toHaveBeenCalled();
    expect(d.insertProfile).not.toHaveBeenCalled();
    expect(d.insertSurveyResponse).not.toHaveBeenCalled();
  });

  it("M3 a paused signup answers 403 whatever the amounts are", async () => {
    const d = deps({ isSignupDisabled: vi.fn(() => true) });
    const result = await createEmailAccount(
      input({ surveyBody: { monthly_income: 0 } }),
      d
    );
    expect(result.status).toBe(403);
    expect(d.generateSignupLink).not.toHaveBeenCalled();
  });

  it("M4 the first name is checked before the amounts", async () => {
    const d = deps();
    const result = await createEmailAccount(
      input({ firstName: null, surveyBody: { monthly_income: -5 } }),
      d
    );
    expect(result.body).toEqual({ success: false, message: "First name is required" });
  });

  it("M5 the refused value appears in no log line and not in the body", async () => {
    const d = deps();
    const result = await createEmailAccount(
      input({ surveyBody: { monthly_income: 7654321, monthly_budget: 1500 } }),
      d
    );
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).not.toContain("7654321");
    for (const line of logLines(d)) {
      expect(line).not.toContain("7654321");
    }
  });
});
