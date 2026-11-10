import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * What POST /api/survey writes, and when it writes nothing, executed.
 *
 * HOW
 * Authentication, the admin client and the confirmation email are mocked. The
 * route, emailSignup.ts and surveyMoney.ts run for real. The fake admin
 * client records every table call with its filters and payload, and every
 * generateLink call. An update's `.eq()` result can be awaited directly or
 * followed by `.select()`.
 *
 * Mutations of route.ts and the tests each one turns red:
 *   the body check removed, moved after another check, or its failure
 *   logged                                                  -> SW9
 *   a column fed from any other body key put back into the insert row,
 *   or the body spread into it                              -> SW1, SW2
 *   a column put back into the update map                   -> SW3
 *   preferred_language put back into the insert row         -> SW4
 *   a stored value taken differently: `||` for `??`, or the spending
 *   column fed from monthly_budget ahead of its own key     -> SW11
 *   any other body value echoed in the success profile      -> SW12
 *   the credit-history type check removed or moved after a write
 *                                                           -> SW14
 *   the survey lookup's error ignored (read as "no row")    -> SW5
 *   the users update's row count not checked, or a missing
 *   representation taken as success                         -> SW6
 *   the survey update's row count not checked               -> SW7
 *   a survey failure answered with the user id or with text saying an
 *   account was created                                     -> SW8
 *   a filter taking its id from the body instead of the token
 *                                                           -> SW13
 *   the signed-in success message saying an account was created
 *                                                           -> SW15
 *   the signup passing the body's destination_country to the profile
 *   row                                                     -> SW16
 */

const SIGNED_IN_ID = "00000000-0000-4000-8000-000000000001";
const NEW_USER_ID = "00000000-0000-4000-8000-000000000002";

type Call = {
  table: string;
  op: "select" | "update" | "insert";
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

type Outcome = { data: unknown; error: unknown };

const state = {
  authUserId: null as string | null,
  existingSurvey: false,
  surveyLookupError: null as unknown,
  usersUpdate: { data: [{ id: SIGNED_IN_ID }], error: null } as Outcome,
  surveyUpdate: { data: [{ id: "row-1" }], error: null } as Outcome,
  surveyInsertError: null as unknown,
  calls: [] as Call[],
  generateLinkCalls: 0,
  adminClients: 0,
};

function fakeAdmin() {
  state.adminClients += 1;
  return {
    auth: {
      admin: {
        generateLink: async () => {
          state.generateLinkCalls += 1;
          return {
            data: { user: { id: NEW_USER_ID }, properties: { hashed_token: "tok" } },
            error: null,
          };
        },
        deleteUser: async () => ({ error: null }),
        getUserById: async () => ({
          data: { user: { id: NEW_USER_ID, email: null, email_confirmed_at: null } },
          error: null,
        }),
      },
    },
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => ({
      select: () => {
        const call: Call = { table, op: "select", filters: [] };
        state.calls.push(call);
        return {
          eq: (column: string, value: unknown) => {
            call.filters.push([column, value]);
            return {
              maybeSingle: async () => {
                if (table === "survey_responses") {
                  return {
                    data: state.existingSurvey ? { id: "row-1" } : null,
                    error: state.surveyLookupError,
                  };
                }
                // The signup's lookup by email: no account has this email yet.
                if (column === "email") {
                  return { data: null, error: null };
                }
                return { data: { first_name: "Ann", last_name: null }, error: null };
              },
            };
          },
        };
      },
      update: (payload: unknown) => {
        const call: Call = { table, op: "update", payload, filters: [] };
        state.calls.push(call);
        return {
          eq: (column: string, value: unknown) => {
            call.filters.push([column, value]);
            const outcome = table === "users" ? state.usersUpdate : state.surveyUpdate;
            return {
              select: async () => outcome,
              then: (
                resolve: (v: { error: unknown }) => unknown,
                reject: (e: unknown) => unknown
              ) => Promise.resolve({ error: outcome.error }).then(resolve, reject),
            };
          },
        };
      },
      insert: async (payload: unknown) => {
        state.calls.push({ table, op: "insert", payload, filters: [] });
        return { error: table === "survey_responses" ? state.surveyInsertError : null };
      },
    }),
  };
}

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => state.authUserId,
}));

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => fakeAdmin(),
  isSupabaseAdminConfigured: () => true,
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/email", () => ({
  sendSignupConfirmationEmail: async () => true,
}));

async function postRaw(
  raw: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import("../../app/api/survey/route");
  const res = await POST(
    new Request("https://noor.test/api/survey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    }) as unknown as NextRequest
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function writes(): Call[] {
  return state.calls.filter((c) => c.op !== "select");
}

const consoleMethods = ["error", "warn", "log", "info"] as const;
let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];
const savedSignupDisabled = process.env.SIGNUP_DISABLED;

beforeEach(() => {
  state.authUserId = null;
  state.existingSurvey = false;
  state.surveyLookupError = null;
  state.usersUpdate = { data: [{ id: SIGNED_IN_ID }], error: null };
  state.surveyUpdate = { data: [{ id: "row-1" }], error: null };
  state.surveyInsertError = null;
  state.calls = [];
  state.generateLinkCalls = 0;
  state.adminClients = 0;
  consoleSpies = consoleMethods.map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {})
  );
});

afterEach(() => {
  consoleSpies.forEach((s) => s.mockRestore());
  if (savedSignupDisabled === undefined) {
    delete process.env.SIGNUP_DISABLED;
  } else {
    process.env.SIGNUP_DISABLED = savedSignupDisabled;
  }
});

const INVALID_BODIES: Array<[string, string]> = [
  ["unparseable", "{"],
  ["empty", ""],
  ["JSON null", "null"],
  ["an array", "[]"],
  ["an array of an object", '[{"first_name":"Ann"}]'],
  ["a number", "42"],
  ["a string", '"s"'],
  ["a truncated object carrying an email", '{"email":"ann@example.com"'],
];

const INVALID_BODY = { success: false, message: "Request body must be a JSON object." };

describe("SW9 a body that is not a JSON object", () => {
  it.each(INVALID_BODIES)(
    "SW9a signed out, signups paused, no password — %s: 400 before the 401 and 403, nothing read, written or logged",
    async (_label, raw) => {
      process.env.SIGNUP_DISABLED = "true";
      const result = await postRaw(raw);
      expect(result.status).toBe(400);
      expect(result.json).toEqual(INVALID_BODY);
      expect(state.adminClients).toBe(0);
      expect(state.calls).toEqual([]);
      expect(state.generateLinkCalls).toBe(0);
      consoleSpies.forEach((s) => expect(s).not.toHaveBeenCalled());
    }
  );

  it.each(INVALID_BODIES)(
    "SW9b signed in — %s: 400, nothing read, written or logged",
    async (_label, raw) => {
      state.authUserId = SIGNED_IN_ID;
      const result = await postRaw(raw);
      expect(result.status).toBe(400);
      expect(result.json).toEqual(INVALID_BODY);
      expect(state.adminClients).toBe(0);
      expect(writes()).toEqual([]);
      expect(state.calls).toEqual([]);
      consoleSpies.forEach((s) => expect(s).not.toHaveBeenCalled());
    }
  );

  it("SW9c an empty object still reaches the existing checks (401 with no password)", async () => {
    const result = await postRaw("{}");
    expect(result.status).toBe(401);
    expect(result.json.code).toBe("AUTH_REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// Which columns are written, and with what
// ---------------------------------------------------------------------------

function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return postRaw(JSON.stringify(body));
}

function surveyWrites(op: "insert" | "update"): Call[] {
  return writes().filter((c) => c.table === "survey_responses" && c.op === op);
}

function onlySurveyPayload(op: "insert" | "update"): Record<string, unknown> {
  const found = surveyWrites(op);
  expect(found).toHaveLength(1);
  return found[0].payload as Record<string, unknown>;
}

const SIGNUP = {
  first_name: "Ann",
  email: "ann@example.com",
  password: "Abcdefg1_",
  monthly_income: 2000,
  monthly_budget: 1500,
};

const SIGNED_IN = { first_name: "Ann", monthly_income: 2000, monthly_budget: 1500 };

const ROW_KEYS = [
  "created_at",
  "expected_monthly_spending",
  "has_us_credit_history",
  "id",
  "monthly_budget",
  "monthly_income",
  "onboarding_completed",
  "updated_at",
  "user_id",
];

const UPDATE_KEYS = [
  "expected_monthly_spending",
  "has_us_credit_history",
  "monthly_budget",
  "monthly_income",
  "onboarding_completed",
  "updated_at",
];

// Every key an earlier build of the form sent, each with a non-empty value,
// plus keys no build ever sent and keys that name fixed columns.
const OTHER_KEYS = {
  country_of_origin: "KR",
  destination_country: "US",
  institution_id: "inst-1",
  institution_type: "university",
  university: "Some University",
  academic_level: "graduate",
  year_in_program: 2,
  major: "Economics",
  gpa: 3.5,
  student_level: "masters",
  has_ssn: true,
  has_itin: false,
  has_nin: true,
  has_sin: true,
  has_local_address: true,
  fee_sensitivity: "high",
  banking_needs: ["checking"],
  digital_preference: "mobile-first",
  international_transfers: "monthly",
  avg_transfer_amount: 100,
  branch_preference: "must",
  needs_zelle: true,
  banking_style: "online",
  campus_proximity: "near",
  campus_side: "north",
  goals: ["save"],
  credit_goals: "build",
  preferred_language: "ko",
  unknown_key: "x",
  id: "not-the-row-id",
  user_id: "not-the-user-id",
  created_at: "2000-01-01T00:00:00.000Z",
  onboarding_completed: false,
};

describe("SW1-SW4 only the money and credit-history columns are written", () => {
  it("SW1 the signup insert names exactly the fixed columns and the four answer columns", async () => {
    const result = await post({ ...SIGNUP, ...OTHER_KEYS });
    expect(result.status).toBe(200);
    const row = onlySurveyPayload("insert");
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(row.user_id).toBe(NEW_USER_ID);
    expect(row.onboarding_completed).toBe(true);
  });

  it("SW2 the signed-in insert names exactly the fixed columns and the four answer columns", async () => {
    state.authUserId = SIGNED_IN_ID;
    state.existingSurvey = false;
    const result = await post({ ...SIGNED_IN, ...OTHER_KEYS });
    expect(result.status).toBe(200);
    const row = onlySurveyPayload("insert");
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(row.user_id).toBe(SIGNED_IN_ID);
    expect(row.onboarding_completed).toBe(true);
  });

  it("SW3 the update names only answer columns and the two always-written columns", async () => {
    state.authUserId = SIGNED_IN_ID;
    state.existingSurvey = true;
    const result = await post({
      ...SIGNED_IN,
      ...OTHER_KEYS,
      has_us_credit_history: true,
      expected_monthly_spending: 1400,
    });
    expect(result.status).toBe(200);
    const update = onlySurveyPayload("update");
    expect(Object.keys(update).sort()).toEqual(UPDATE_KEYS);
    expect(update.onboarding_completed).toBe(true);
  });

  it("SW3b an update whose body carries only other keys writes only the always-written columns", async () => {
    state.authUserId = SIGNED_IN_ID;
    state.existingSurvey = true;
    const result = await post({ first_name: "Ann", ...OTHER_KEYS });
    expect(result.status).toBe(200);
    const update = onlySurveyPayload("update");
    expect(Object.keys(update).sort()).toEqual(["onboarding_completed", "updated_at"]);
  });

  it.each([
    ["sent", { preferred_language: "ko" }],
    ["not sent", {}],
  ])("SW4 preferred_language %s: neither insert carries the key", async (_label, extra) => {
    await post({ ...SIGNUP, ...extra });
    expect(onlySurveyPayload("insert")).not.toHaveProperty("preferred_language");

    state.calls = [];
    state.authUserId = SIGNED_IN_ID;
    state.existingSurvey = false;
    await post({ ...SIGNED_IN, ...extra });
    expect(onlySurveyPayload("insert")).not.toHaveProperty("preferred_language");
  });
});

describe("SW11 the money and credit-history values are stored as before", () => {
  it("SW11a signup: the amounts as sent, spending from monthly_budget, false kept as false", async () => {
    await post({ ...SIGNUP, monthly_income: 3210, monthly_budget: 1234, has_us_credit_history: false });
    expect(onlySurveyPayload("insert")).toMatchObject({
      monthly_income: 3210,
      monthly_budget: 1234,
      expected_monthly_spending: 1234,
      has_us_credit_history: false,
    });
  });

  it("SW11b signup: expected_monthly_spending sent wins over monthly_budget", async () => {
    await post({ ...SIGNUP, monthly_budget: 1234, expected_monthly_spending: 999 });
    const row = onlySurveyPayload("insert");
    expect(row.expected_monthly_spending).toBe(999);
    expect(row.monthly_budget).toBe(1234);
  });

  it("SW11c an insert without the credit-history key stores null", async () => {
    await post(SIGNUP);
    const signupRow = onlySurveyPayload("insert");
    expect(signupRow).toHaveProperty("has_us_credit_history", null);

    state.calls = [];
    state.authUserId = SIGNED_IN_ID;
    await post(SIGNED_IN);
    expect(onlySurveyPayload("insert")).toHaveProperty("has_us_credit_history", null);
  });

  it("SW11d signed-in insert: true kept as true, amounts as sent", async () => {
    state.authUserId = SIGNED_IN_ID;
    await post({ ...SIGNED_IN, monthly_income: 4100, monthly_budget: 2100, has_us_credit_history: true });
    expect(onlySurveyPayload("insert")).toMatchObject({
      monthly_income: 4100,
      monthly_budget: 2100,
      expected_monthly_spending: 2100,
      has_us_credit_history: true,
    });
  });

  it("SW11e update: an absent credit-history key is left alone, a null one is written as null", async () => {
    state.authUserId = SIGNED_IN_ID;
    state.existingSurvey = true;
    await post({ first_name: "Ann", monthly_budget: 1500 });
    const absent = onlySurveyPayload("update");
    expect(absent).not.toHaveProperty("has_us_credit_history");
    expect(absent).not.toHaveProperty("monthly_income");
    expect(absent.monthly_budget).toBe(1500);
    expect(absent.expected_monthly_spending).toBe(1500);

    state.calls = [];
    await post({ first_name: "Ann", has_us_credit_history: null });
    expect(onlySurveyPayload("update")).toHaveProperty("has_us_credit_history", null);
  });
});

describe("SW12 the success profile", () => {
  it("SW12 carries the first name only, whatever else the body sends", async () => {
    state.authUserId = SIGNED_IN_ID;
    state.existingSurvey = true;
    const result = await post({ ...SIGNED_IN, ...OTHER_KEYS, last_name: "Lee" });
    expect(result.status).toBe(200);
    expect(result.json.profile).toEqual({ firstName: "Ann" });
  });
});

describe("SW14 a credit-history answer that is not true, false or null", () => {
  const INVALID_CREDIT_HISTORY = {
    success: false,
    message: "has_us_credit_history must be true, false or null.",
  };

  it.each([["the string true", "true"], ["the number 1", 1], ["an object", {}]])(
    "SW14a signed out, %s: 400, no Auth user created, nothing written",
    async (_label, value) => {
      const result = await post({ ...SIGNUP, has_us_credit_history: value });
      expect(result.status).toBe(400);
      expect(result.json).toEqual(INVALID_CREDIT_HISTORY);
      expect(state.generateLinkCalls).toBe(0);
      expect(writes()).toEqual([]);
    }
  );

  it.each([["the string true", "true"], ["the number 1", 1], ["an object", {}]])(
    "SW14b signed in with a survey row, %s: 400, nothing written",
    async (_label, value) => {
      state.authUserId = SIGNED_IN_ID;
      state.existingSurvey = true;
      const result = await post({ ...SIGNED_IN, has_us_credit_history: value });
      expect(result.status).toBe(400);
      expect(result.json).toEqual(INVALID_CREDIT_HISTORY);
      expect(state.generateLinkCalls).toBe(0);
      expect(writes()).toEqual([]);
    }
  );

  it.each([["the string true", "true"], ["the number 1", 1], ["an object", {}]])(
    "SW14c signed in with no survey row, %s: 400, nothing written",
    async (_label, value) => {
      state.authUserId = SIGNED_IN_ID;
      state.existingSurvey = false;
      const result = await post({ ...SIGNED_IN, has_us_credit_history: value });
      expect(result.status).toBe(400);
      expect(result.json).toEqual(INVALID_CREDIT_HISTORY);
      expect(writes()).toEqual([]);
    }
  );
});

// ---------------------------------------------------------------------------
// The signed-in path: failed reads, unconfirmed writes, and its answers
// ---------------------------------------------------------------------------

const SURVEY_SAVE_FAILED = {
  success: false,
  message: "We couldn't save your answers. Please try again.",
};

const PROFILE_UPDATE_FAILED = {
  success: false,
  message: "Failed to update user profile record",
};

function expectNoAccountClaim(json: Record<string, unknown>): void {
  expect(json).not.toHaveProperty("userId");
  expect(JSON.stringify(json)).not.toMatch(/creat/i);
}

describe("SW5 a failed survey lookup", () => {
  beforeEach(() => {
    state.authUserId = SIGNED_IN_ID;
    state.surveyLookupError = { code: "XX000", message: "lookup failed" };
  });

  it.each([true, false])(
    "SW5a existing row reported as %s: 500 before any write",
    async (existing) => {
      state.existingSurvey = existing;
      const result = await post(SIGNED_IN);
      expect(result.status).toBe(500);
      expect(result.json).toEqual(SURVEY_SAVE_FAILED);
      expect(writes()).toEqual([]);
    }
  );

  it("SW5b the lookup failure answers ahead of the money check", async () => {
    const result = await post({ ...SIGNED_IN, monthly_income: 0 });
    expect(result.status).toBe(500);
    expect(result.json).toEqual(SURVEY_SAVE_FAILED);
    expect(writes()).toEqual([]);
  });
});

describe("SW6 a users update that changed no row", () => {
  beforeEach(() => {
    state.authUserId = SIGNED_IN_ID;
  });

  it.each([
    ["an empty array, existing survey row", [], true],
    ["an empty array, no survey row", [], false],
    ["no representation, existing survey row", null, true],
    ["no representation, no survey row", null, false],
  ])("SW6 %s: 500, and the survey row is not written", async (_label, data, existing) => {
    state.existingSurvey = existing as boolean;
    state.usersUpdate = { data, error: null };
    const result = await post(SIGNED_IN);
    expect(result.status).toBe(500);
    expect(result.json).toEqual(PROFILE_UPDATE_FAILED);
    expect(writes().filter((c) => c.table === "users" && c.op === "update")).toHaveLength(1);
    expect(writes().filter((c) => c.table === "survey_responses")).toEqual([]);
  });
});

describe("SW7 a survey write that saved nothing", () => {
  beforeEach(() => {
    state.authUserId = SIGNED_IN_ID;
  });

  it.each([
    ["an empty array", { data: [], error: null }],
    ["no representation", { data: null, error: null }],
    ["an error", { data: null, error: { code: "XX000", message: "update failed" } }],
  ])("SW7a the update answered %s: 500", async (_label, outcome) => {
    state.existingSurvey = true;
    state.surveyUpdate = outcome as Outcome;
    const result = await post(SIGNED_IN);
    expect(result.status).toBe(500);
    expect(result.json).toEqual(SURVEY_SAVE_FAILED);
    expect(surveyWrites("update")).toHaveLength(1);
  });

  it("SW7b the insert failed: 500", async () => {
    state.existingSurvey = false;
    state.surveyInsertError = { code: "23505", message: "duplicate" };
    const result = await post(SIGNED_IN);
    expect(result.status).toBe(500);
    expect(result.json).toEqual(SURVEY_SAVE_FAILED);
    expect(surveyWrites("insert")).toHaveLength(1);
  });
});

describe("SW8 no failure answer claims an account or carries the user id", () => {
  beforeEach(() => {
    state.authUserId = SIGNED_IN_ID;
  });

  it("SW8a the lookup failure", async () => {
    state.surveyLookupError = { code: "XX000" };
    expectNoAccountClaim((await post(SIGNED_IN)).json);
  });

  it("SW8b the users update changing no row", async () => {
    state.usersUpdate = { data: [], error: null };
    expectNoAccountClaim((await post(SIGNED_IN)).json);
  });

  it("SW8c the survey update changing no row", async () => {
    state.existingSurvey = true;
    state.surveyUpdate = { data: [], error: null };
    expectNoAccountClaim((await post(SIGNED_IN)).json);
  });

  it("SW8d the survey insert failing", async () => {
    state.surveyInsertError = { code: "XX000" };
    expectNoAccountClaim((await post(SIGNED_IN)).json);
  });
});

describe("SW13 every signed-in read and write is filtered by the token's id", () => {
  it.each([true, false])("SW13 existing survey row %s", async (existing) => {
    state.authUserId = SIGNED_IN_ID;
    state.existingSurvey = existing;
    const result = await post({ ...SIGNED_IN, id: NEW_USER_ID, user_id: NEW_USER_ID });
    expect(result.status).toBe(200);
    const filtered = state.calls.filter((c) => c.op !== "insert");
    expect(filtered.length).toBeGreaterThan(0);
    filtered.forEach((c) => {
      expect(c.filters).toEqual([[c.table === "users" ? "id" : "user_id", SIGNED_IN_ID]]);
    });
    surveyWrites("insert").forEach((c) => {
      expect((c.payload as Record<string, unknown>).user_id).toBe(SIGNED_IN_ID);
    });
  });
});

describe("SW15 the signed-in success answer", () => {
  it.each([true, false])("SW15 existing survey row %s: saved, no account claim", async (existing) => {
    state.authUserId = SIGNED_IN_ID;
    state.existingSurvey = existing;
    const result = await post(SIGNED_IN);
    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      success: true,
      userId: SIGNED_IN_ID,
      profile: { firstName: "Ann" },
      message: "Your answers were saved.",
    });
  });
});

describe("SW16 the signup's profile row takes no destination country from the body", () => {
  it.each([["a country code", "US"], ["an object", { code: "US" }]])(
    "SW16 destination_country sent as %s: the users insert records null",
    async (_label, value) => {
      const result = await post({ ...SIGNUP, destination_country: value });
      expect(result.status).toBe(200);
      const inserts = writes().filter((c) => c.table === "users" && c.op === "insert");
      expect(inserts).toHaveLength(1);
      const row = inserts[0].payload as { raw_user_meta_data: Record<string, unknown> };
      expect(row.raw_user_meta_data).toHaveProperty("destination_country", null);
    }
  );
});
