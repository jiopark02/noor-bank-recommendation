import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * POST /api/waitlist ignores any `name` in the body.
 *
 * WHAT IT EXISTS TO PREVENT
 * The route is unauthenticated. It used to store `name` as typed and put it
 * into the confirmation mail's HTML, so anyone could send a mail from our
 * domain to any address with their own markup in it. The route now reads only
 * `email`; the insert carries no name and the mail greeting is always the
 * default.
 *
 * HOW
 * The admin client is mocked and records the insert payload. The email module
 * is NOT mocked: the real sendWaitlistConfirmationEmail runs with a fake key,
 * and fetch is stubbed to record its arguments and throw, so the payload Resend
 * would have sent is inspected and nothing can be delivered.
 */

const inserts: unknown[] = [];
let insertError: { code: string } | null = null;

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: async (row: unknown) => {
        inserts.push({ table, row });
        return { error: insertError };
      },
    }),
  }),
}));

type FetchCall = [unknown, RequestInit | undefined];

let fetchCalls: FetchCall[] = [];

const HOSTILE_NAME = '<a href="https://evil.example">x</a> & "q" <script>1</script>';
const NAME_FRAGMENTS = ["evil.example", "<script", "&lt;script", "&quot;q&quot;"];

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function unparsable(): NextRequest {
  return {
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
  } as unknown as NextRequest;
}

async function post(req: NextRequest): Promise<{ status: number; body: unknown }> {
  const { POST } = await import("../../app/api/waitlist/route");
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

function sentPayload(): { html: string; text: string; subject: string; to: string } {
  expect(fetchCalls).toHaveLength(1);
  return JSON.parse(String(fetchCalls[0][1]?.body));
}

beforeEach(() => {
  inserts.length = 0;
  insertError = null;
  fetchCalls = [];
  vi.resetModules();
  vi.stubEnv("RESEND_API_KEY", "re_test_fake_key");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown, init?: RequestInit) => {
      fetchCalls.push([url, init]);
      throw new Error("network must not be reached");
    })
  );
  for (const method of ["log", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("a name in the body is ignored", () => {
  it("the insert payload carries no name", async () => {
    const res = await post(request({ email: "probe@example.com", name: HOSTILE_NAME }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(inserts).toEqual([
      {
        table: "waitlist_signups",
        row: { email: "probe@example.com", source: "waitlist_page" },
      },
    ]);
  });

  it("the mail html and text contain no part of the name, and the greeting is the default", async () => {
    await post(request({ email: "probe@example.com", name: HOSTILE_NAME }));
    const payload = sentPayload();
    for (const fragment of NAME_FRAGMENTS) {
      expect(payload.html).not.toContain(fragment);
      expect(payload.text).not.toContain(fragment);
    }
    expect(payload.html).toContain("Hi there,");
    expect(payload.text).toContain("Hi there,");
    expect(payload.subject).toBe("You're on the Noor waitlist");
    expect(payload.to).toBe("probe@example.com");
  });
});

describe("responses for valid input are unchanged", () => {
  it("email only: 200 { success: true }, address trimmed and lowercased", async () => {
    const res = await post(request({ email: "  Probe@Example.COM " }));
    expect(res).toEqual({ status: 200, body: { success: true } });
    expect(inserts).toEqual([
      {
        table: "waitlist_signups",
        row: { email: "probe@example.com", source: "waitlist_page" },
      },
    ]);
  });

  it("duplicate: 409 already_registered and no mail", async () => {
    insertError = { code: "23505" };
    const res = await post(request({ email: "probe@example.com" }));
    expect(res).toEqual({ status: 409, body: { message: "already_registered" } });
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("invalid input is a 400", () => {
  it.each([
    ["a number", 42],
    ["an object", { a: 1 }],
    ["an array", ["probe@example.com"]],
    ["a boolean", true],
  ])("email that is %s: 400, nothing stored, no mail", async (_label, email) => {
    const res = await post(request({ email }));
    expect(res).toEqual({
      status: 400,
      body: { message: "Please enter a valid email address" },
    });
    expect(inserts).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });

  it.each([
    ["missing", {}],
    ["null", { email: null }],
    ["blank", { email: "   " }],
    ["a body that is JSON null", null],
  ])("email %s: 400 Email is required", async (_label, body) => {
    const res = await post(request(body));
    expect(res).toEqual({ status: 400, body: { message: "Email is required" } });
    expect(inserts).toHaveLength(0);
  });

  it("malformed address: 400 as before", async () => {
    const res = await post(request({ email: "not-an-address" }));
    expect(res).toEqual({
      status: 400,
      body: { message: "Please enter a valid email address" },
    });
  });

  it("unparsable body: 400 Invalid request body", async () => {
    const res = await post(unparsable());
    expect(res).toEqual({ status: 400, body: { message: "Invalid request body" } });
  });
});
