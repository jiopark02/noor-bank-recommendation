import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { INVALID_MONTHLY_AMOUNT } from "../signupCodes";
import { INVALID_MONTHLY_INCOME_MESSAGE } from "../surveyMoney";

/**
 * POST /api/survey refuses a missing or invalid monthly amount before it
 * writes anything, on every write path: the email signup (before the Auth
 * user is created), the signed-in update of an existing survey row, and the
 * signed-in insert of a new one.
 *
 * HOW
 * Authentication, the admin client and the welcome email are mocked. The
 * route, emailSignup.ts and surveyMoney.ts run for real. The fake admin
 * client records every table call and every auth.admin call.
 *
 * Mutations of route.ts / emailSignup.ts and the tests each one turns red:
 *   B6  the signup money check moved after createAuthUser    -> RM1
 *   B8  the route not passing the body to createEmailAccount -> RM1
 *   B9  the signed-in money check removed                    -> RM2, RM3, RM5
 *   B10 the survey read moved back after the users update    -> RM2, RM3, RM5
 *   B11 a new row checked in update mode                     -> RM3
 *   B12 update mode refusing keys it was not sent            -> RM4
 *   B13 a present null ignored on update                     -> RM5
 *   B15 the refusal without its code                         -> RM1, RM2
 *       the stored amounts taken from a different source
 *       than the checked ones                                -> RM6
 */

const SIGNED_IN_ID = "00000000-0000-4000-8000-000000000001";
const NEW_USER_ID = "00000000-0000-4000-8000-000000000002";

type Call = { table: string; op: "select" | "update" | "insert"; payload?: unknown };

const state = {
  authUserId: null as string | null,
  existingSurvey: false,
  calls: [] as Call[],
  createUserCalls: 0,
};

function fakeAdmin() {
  return {
    auth: {
      admin: {
        createUser: async () => {
          state.createUserCalls += 1;
          return { data: { user: { id: NEW_USER_ID } }, error: null };
        },
        deleteUser: async () => ({ error: null }),
      },
    },
    from: (table: string) => ({
      select: () => {
        state.calls.push({ table, op: "select" });
        return {
          eq: () => ({
            maybeSingle: async () => {
              if (table === "survey_responses") {
                return { data: state.existingSurvey ? { id: "row-1" } : null, error: null };
              }
              return { data: { first_name: "Ann", last_name: null }, error: null };
            },
          }),
        };
      },
      update: (payload: unknown) => {
        state.calls.push({ table, op: "update", payload });
        return { eq: async () => ({ error: null }) };
      },
      insert: async (payload: unknown) => {
        state.calls.push({ table, op: "insert", payload });
        return { error: null };
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
  sendWelcomeEmail: async () => true,
}));

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import("../../app/api/survey/route");
  const res = await POST(
    new Request("https://noor.test/api/survey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function writes(): Call[] {
  return state.calls.filter((c) => c.op !== "select");
}

const SIGNUP = {
  first_name: "Ann",
  email: "ann@example.com",
  password: "Abcdefg1_",
  monthly_income: 2000,
  monthly_budget: 1500,
};

const SIGNED_IN = { first_name: "Ann", monthly_income: 2000, monthly_budget: 1500 };

const REFUSAL = {
  success: false,
  message: INVALID_MONTHLY_INCOME_MESSAGE,
  code: INVALID_MONTHLY_AMOUNT,
};

beforeEach(() => {
  state.authUserId = null;
  state.existingSurvey = false;
  state.calls = [];
  state.createUserCalls = 0;
});

describe("email signup", () => {
  it("RM1 an invalid income is 400 before the Auth user is created", async () => {
    const result = await post({ ...SIGNUP, monthly_income: 0 });
    expect(result.status).toBe(400);
    expect(result.json).toEqual(REFUSAL);
    expect(state.createUserCalls).toBe(0);
    expect(writes()).toEqual([]);
  });

  it("RM6 the survey row stores the same amounts the check read from the body", async () => {
    const result = await post({ ...SIGNUP, monthly_income: 3210, monthly_budget: 1234 });
    expect(result.status).toBe(200);
    expect(state.createUserCalls).toBe(1);
    const surveyInserts = writes().filter(
      (c) => c.table === "survey_responses" && c.op === "insert"
    );
    expect(surveyInserts).toHaveLength(1);
    expect(surveyInserts[0].payload).toMatchObject({
      monthly_income: 3210,
      monthly_budget: 1234,
      expected_monthly_spending: 1234,
    });
  });
});

describe("signed-in survey", () => {
  beforeEach(() => {
    state.authUserId = SIGNED_IN_ID;
  });

  it("RM2 an existing row and an invalid amount: 400, nothing written", async () => {
    state.existingSurvey = true;
    const result = await post({ ...SIGNED_IN, monthly_income: "2000" });
    expect(result.status).toBe(400);
    expect(result.json).toEqual(REFUSAL);
    expect(writes()).toEqual([]);
  });

  it("RM3 no row yet and a missing amount: 400, nothing written", async () => {
    state.existingSurvey = false;
    const result = await post({ first_name: "Ann", monthly_budget: 1500 });
    expect(result.status).toBe(400);
    expect(result.json).toEqual(REFUSAL);
    expect(writes()).toEqual([]);
  });

  it("RM4 an existing row and an omitted amount: saved, and the column left alone", async () => {
    state.existingSurvey = true;
    const result = await post({ first_name: "Ann", monthly_budget: 1500 });
    expect(result.status).toBe(200);
    const surveyUpdates = writes().filter(
      (c) => c.table === "survey_responses" && c.op === "update"
    );
    expect(surveyUpdates).toHaveLength(1);
    const payload = surveyUpdates[0].payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("monthly_income");
    expect(payload.monthly_budget).toBe(1500);
  });

  it("RM5 an existing row and a null amount: 400, nothing written", async () => {
    state.existingSurvey = true;
    const result = await post({ ...SIGNED_IN, monthly_income: null });
    expect(result.status).toBe(400);
    expect(result.json).toEqual(REFUSAL);
    expect(writes()).toEqual([]);
  });
});
