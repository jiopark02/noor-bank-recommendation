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
