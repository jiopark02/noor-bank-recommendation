import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/survey on a resignup (a users row already has the email), with
 * the route's own getAuthUser adapter over auth.admin.getUserById.
 *
 * HOW
 * Authentication, the admin client and the email sender are mocked. The
 * route, emailSignup.ts and confirmationSendLimit.ts run for real. Every fake
 * records its calls, in one shared order, so the order of the Auth read, the
 * claim, the token and the send is checked as it ran.
 *
 * Mutations of route.ts and the tests each one turns red:
 *   M48 the adapter not reading user.email                    -> RR1
 *   M49 the not-found mapping removed (or only its code
 *       clause, or only its status clause)                    -> RR2
 *   M50 every getUserById error mapped to "no user"           -> RR3
 */

const ROW_ID = "00000000-0000-4000-8000-0000000000a1";
const EMAIL = "ann@example.com";

type Recorded = { name: string; args: unknown[]; order: number };

const state = {
  order: 0,
  calls: [] as Recorded[],
  getUserById: (async () => ({ data: { user: null }, error: null })) as (
    id: string
  ) => Promise<{ data: { user: unknown }; error: unknown }>,
};

function record(name: string, ...args: unknown[]): void {
  state.order += 1;
  state.calls.push({ name, args, order: state.order });
}

function callsTo(name: string): Recorded[] {
  return state.calls.filter((c) => c.name === name);
}

function fakeAdmin() {
  return {
    auth: {
      admin: {
        getUserById: async (id: string) => {
          record("getUserById", id);
          return state.getUserById(id);
        },
        generateLink: async (params: unknown) => {
          record("generateLink", params);
          return {
            data: { user: { id: ROW_ID }, properties: { hashed_token: "tok_r" } },
            error: null,
          };
        },
        deleteUser: async (id: string) => {
          record("deleteUser", id);
          return { error: null };
        },
      },
    },
    rpc: async (fn: string, args: unknown) => {
      record("rpc", fn, args);
      return { data: true, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            record("select", table, column, value);
            if (table === "users" && column === "email") {
              return {
                data: { id: ROW_ID, first_name: "Stored", last_name: "Row" },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
      insert: async (payload: unknown) => {
        record("insert", table, payload);
        return { error: null };
      },
    }),
  };
}

vi.mock("@/lib/apiAuth", () => ({
  getAuthenticatedUserIdFromRequest: async () => null,
}));

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => fakeAdmin(),
  isSupabaseAdminConfigured: () => true,
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/email", () => ({
  sendSignupConfirmationEmail: async (to: string, link: string) => {
    record("send", to, link);
    return true;
  },
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

const SIGNUP = {
  first_name: "Ann",
  last_name: "Lee",
  email: EMAIL,
  password: "Abcdefg1_",
  monthly_income: 2000,
  monthly_budget: 1500,
};

beforeEach(() => {
  state.order = 0;
  state.calls = [];
});

describe("resignup through the route's getUserById adapter", () => {
  it("RR1 an unconfirmed Auth user under the same email: Auth read, claim, token with the row's names, send", async () => {
    state.getUserById = async (id) => ({
      data: { user: { id, email: EMAIL, email_confirmed_at: null } },
      error: null,
    });
    const result = await post(SIGNUP);

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ success: true, confirmationEmailSent: true });

    const read = callsTo("getUserById");
    expect(read).toHaveLength(1);
    expect(read[0].args).toEqual([ROW_ID]);

    const claims = callsTo("rpc");
    expect(claims).toHaveLength(1);
    expect(claims[0].args).toEqual(["email_confirmation_claim", { p_user_id: ROW_ID }]);

    const links = callsTo("generateLink");
    expect(links).toHaveLength(1);
    expect(links[0].args[0]).toMatchObject({
      type: "signup",
      email: EMAIL,
      options: { data: { first_name: "Stored", last_name: "Row" } },
    });

    const sends = callsTo("send");
    expect(sends).toHaveLength(1);
    expect(sends[0].args[0]).toBe(EMAIL);
    expect(String(sends[0].args[1])).toContain("#token_hash=tok_r&type=signup");

    expect(read[0].order).toBeLessThan(claims[0].order);
    expect(claims[0].order).toBeLessThan(links[0].order);
    expect(links[0].order).toBeLessThan(sends[0].order);

    expect(callsTo("insert")).toEqual([]);
    expect(callsTo("deleteUser")).toEqual([]);
  });

  it.each([
    { name: "code user_not_found", error: { code: "user_not_found" } },
    { name: "status 404", error: { status: 404 } },
  ])(
    "RR2 getUserById answering $name is 'no user': the full-success body, no claim, no token, no send",
    async ({ error }) => {
      state.getUserById = async () => ({ data: { user: null }, error });
      const result = await post(SIGNUP);
      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({ success: true, confirmationEmailSent: true });
      expect(callsTo("getUserById")).toHaveLength(1);
      expect(callsTo("rpc")).toEqual([]);
      expect(callsTo("generateLink")).toEqual([]);
      expect(callsTo("send")).toEqual([]);
    }
  );

  it("RR3 any other getUserById error is 500 with fixed text: no claim, no token, no send", async () => {
    state.getUserById = async () => ({
      data: { user: null },
      error: { code: "unexpected_failure", status: 500 },
    });
    const result = await post(SIGNUP);
    expect(result.status).toBe(500);
    expect(result.json).toEqual({
      success: false,
      message: "Failed to create account. Please try again.",
    });
    expect(callsTo("rpc")).toEqual([]);
    expect(callsTo("generateLink")).toEqual([]);
    expect(callsTo("send")).toEqual([]);
  });
});
