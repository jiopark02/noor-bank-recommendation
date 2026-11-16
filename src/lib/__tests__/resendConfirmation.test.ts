import { describe, it, expect, vi } from "vitest";
import {
  generatePlaceholderPassword,
  resendConfirmation,
  RESEND_ACCEPTED_MESSAGE,
  type ResendDeps,
} from "../resendConfirmation";
import { validatePassword } from "../validation";

/**
 * The resend-confirmation decision, executed with injected fakes.
 *
 * Mutations and the test each one turns red:
 *   M10 a confirmed account answered differently       -> X1
 *   M11 the claim removed                              -> X2
 *   M12 a claim error treated as claimed               -> X3
 *   M13 generateLink data replaced by {}               -> X4
 */

const EMAIL = "Person.Name@Example.com";
const NORMALIZED = "person.name@example.com";
const USER_ID = "4f1c2a9e-0000-4000-8000-000000000001";
const APP = "https://noor.example";
const METADATA = { first_name: "Ann", last_name: "Lee", extra: { k: 1 } };
const BODY_PASSWORD = "Body#Pass1";

type Spied = ResendDeps & {
  findUserIdByEmail: ReturnType<typeof vi.fn>;
  getAuthUser: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  generateSignupLink: ReturnType<typeof vi.fn>;
  sendConfirmationEmail: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
};

function deps(overrides: Partial<ResendDeps> = {}): Spied {
  return {
    findUserIdByEmail: vi.fn(async () => ({ userId: USER_ID, error: null })),
    getAuthUser: vi.fn(async () => ({
      user: { email: NORMALIZED, emailConfirmed: false, userMetadata: METADATA },
      error: null,
    })),
    claim: vi.fn(async () => "claimed" as const),
    generateSignupLink: vi.fn(async () => ({
      userId: USER_ID,
      hashedToken: "tok_1",
      error: null,
    })),
    sendConfirmationEmail: vi.fn(async () => true),
    appUrl: APP,
    log: vi.fn(),
    ...overrides,
  } as Spied;
}

const REQUEST = { email: ` ${EMAIL} `, password: BODY_PASSWORD };
const ACCEPTED = { status: 200, body: { success: true, message: RESEND_ACCEPTED_MESSAGE } };

function lines(d: Spied): string[] {
  return d.log.mock.calls.map((c) => String(c[0]));
}

/** Every branch past the format check, with the deps that produce it. */
const BRANCHES: Array<[string, Partial<ResendDeps>]> = [
  ["sent", {}],
  ["no-row", { findUserIdByEmail: vi.fn(async () => ({ userId: null, error: null })) }],
  ["lookup-error", { findUserIdByEmail: vi.fn(async () => ({ userId: null, error: { code: "PGRST000" } })) }],
  ["no-auth-user", { getAuthUser: vi.fn(async () => ({ user: null, error: null })) }],
  ["auth-read-error", { getAuthUser: vi.fn(async () => ({ user: null, error: { code: "unexpected_failure" } })) }],
  [
    "confirmed",
    {
      getAuthUser: vi.fn(async () => ({
        user: { email: NORMALIZED, emailConfirmed: true, userMetadata: METADATA },
        error: null,
      })),
    },
  ],
  [
    "email-mismatch",
    {
      getAuthUser: vi.fn(async () => ({
        user: { email: "other@example.com", emailConfirmed: false, userMetadata: METADATA },
        error: null,
      })),
    },
  ],
  ["held", { claim: vi.fn(async () => "held" as const) }],
  ["claim-error", { claim: vi.fn(async () => "error" as const) }],
  ["link-error", { generateSignupLink: vi.fn(async () => ({ userId: null, hashedToken: null, error: { code: "unexpected_failure" } })) }],
  ["link-id-mismatch", { generateSignupLink: vi.fn(async () => ({ userId: "other-id", hashedToken: "t", error: null })) }],
  ["send-failed", { sendConfirmationEmail: vi.fn(async () => false) }],
  ["threw", { findUserIdByEmail: vi.fn(async () => { throw new Error("boom " + NORMALIZED); }) }],
];

describe("one answer for every branch", () => {
  it.each(BRANCHES)("X1 %s answers the same 200 body and logs that branch", async (branch, o) => {
    const d = deps(o);
    expect(await resendConfirmation(REQUEST, d)).toEqual(ACCEPTED);
    expect(lines(d)).toHaveLength(1);
    expect(lines(d)[0]).toContain("[resend-confirmation] branch=" + branch);
  });

  it("X1b a malformed or missing email is the only other answer, 400", async () => {
    for (const body of [{}, { email: "a@b" }, { email: 42 }, null, "x"]) {
      const d = deps();
      const r = await resendConfirmation(body, d);
      expect(r.status).toBe(400);
      expect(d.findUserIdByEmail).not.toHaveBeenCalled();
    }
  });
});

describe("what is done on each branch", () => {
  it("X2 held: no link and no email", async () => {
    const d = deps({ claim: vi.fn(async () => "held" as const) });
    await resendConfirmation(REQUEST, d);
    expect(d.claim).toHaveBeenCalledWith(USER_ID);
    expect(d.generateSignupLink).not.toHaveBeenCalled();
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it("X3 claim error: no link and no email", async () => {
    const d = deps({ claim: vi.fn(async () => "error" as const) });
    await resendConfirmation(REQUEST, d);
    expect(d.generateSignupLink).not.toHaveBeenCalled();
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it("X4 generateLink gets the Auth user's own metadata object, unchanged", async () => {
    const d = deps();
    await resendConfirmation(REQUEST, d);
    const args = d.generateSignupLink.mock.calls[0][0];
    expect(args.data).toBe(METADATA);
    expect(args.data).toEqual({ first_name: "Ann", last_name: "Lee", extra: { k: 1 } });
    expect(args.email).toBe(NORMALIZED);
  });

  it("X5 the password is not the request's and passes the signup policy", async () => {
    const d = deps();
    await resendConfirmation(REQUEST, d);
    const { password } = d.generateSignupLink.mock.calls[0][0];
    expect(password).not.toBe(BODY_PASSWORD);
    expect(validatePassword(password).isValid).toBe(true);
    for (let i = 0; i < 200; i++) {
      expect(validatePassword(generatePlaceholderPassword()).isValid).toBe(true);
    }
    expect(generatePlaceholderPassword()).not.toBe(generatePlaceholderPassword());
  });

  it("X6 sends the fragment link built from the token, to the normalized email", async () => {
    const d = deps();
    await resendConfirmation(REQUEST, d);
    expect(d.sendConfirmationEmail).toHaveBeenCalledWith(
      NORMALIZED,
      APP + "/auth/callback#token_hash=tok_1&type=signup"
    );
  });

  it.each(["no-row", "confirmed", "email-mismatch", "no-auth-user"])(
    "X7 %s: no claim, no link, no email",
    async (branch) => {
      const d = deps(BRANCHES.find(([b]) => b === branch)![1]);
      await resendConfirmation(REQUEST, d);
      expect(d.claim).not.toHaveBeenCalled();
      expect(d.generateSignupLink).not.toHaveBeenCalled();
      expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
    }
  );

  it("X8 a link for another user id is not sent", async () => {
    const d = deps(BRANCHES.find(([b]) => b === "link-id-mismatch")![1]);
    await resendConfirmation(REQUEST, d);
    expect(d.sendConfirmationEmail).not.toHaveBeenCalled();
  });
});

describe("log lines", () => {
  it.each(BRANCHES)("X9 %s: no email address in the log", async (_b, o) => {
    const d = deps(o);
    await resendConfirmation(REQUEST, d);
    for (const line of lines(d)) {
      expect(line.toLowerCase()).not.toContain(NORMALIZED);
      expect(line.toLowerCase()).not.toContain("@");
    }
  });
});
