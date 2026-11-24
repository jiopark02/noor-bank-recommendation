import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

function rawRequest(raw: string): NextRequest {
  return new Request("https://noor.test/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  }) as unknown as NextRequest;
}

function request(body: unknown): NextRequest {
  return rawRequest(JSON.stringify(body));
}

function unparsable(): NextRequest {
  return rawRequest("{not json");
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

// The route's body limit. It is a private constant of the route file, so the
// test holds the behaviour at the boundary rather than importing the value.
const WAITLIST_LIMIT = 4096;

function bodyOfLength(length: number): string {
  const head = '{"email":"probe@example.com","pad":"';
  const tail = '"}';
  return head + "x".repeat(length - head.length - tail.length) + tail;
}

describe("W1 the body is read under a byte limit", () => {
  it("a body of exactly the limit is read", async () => {
    const raw = bodyOfLength(WAITLIST_LIMIT);
    expect(raw.length).toBe(WAITLIST_LIMIT);
    const res = await post(rawRequest(raw));
    expect(res).toEqual({ status: 200, body: { success: true } });
  });

  it("a body one byte over is 413, with nothing stored and no mail", async () => {
    const raw = bodyOfLength(WAITLIST_LIMIT + 1);
    const res = await post(rawRequest(raw));
    expect(res).toEqual({ status: 413, body: { message: "Request is too large" } });
    expect(inserts).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });

  it("a million-dot email is 413 before any parsing", async () => {
    const res = await post(request({ email: "a@" + ".".repeat(1_000_000) + "@" }));
    expect(res.status).toBe(413);
    expect(inserts).toHaveLength(0);
  });
});

describe("W2 the address goes through validateEmail", () => {
  it("an attack-shaped email inside the body limit is 400, nothing stored", async () => {
    const res = await post(request({ email: "a@" + ".".repeat(3000) + "@" }));
    expect(res).toEqual({
      status: 400,
      body: { message: "Please enter a valid email address" },
    });
    expect(inserts).toHaveLength(0);
  });

  it("an address over the length limit is 400, nothing stored", async () => {
    const res = await post(
      request({ email: "a".repeat(64) + "@" + "b".repeat(252) + ".com" })
    );
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("the route holds no pattern of its own and calls validateEmail", () => {
    const route = readFileSync(
      fileURLToPath(new URL("../../app/api/waitlist/route.ts", import.meta.url)),
      "utf8"
    );
    expect(route).toContain("import { validateEmail } from '@/lib/validation';");
    expect(route).toContain("if (!validateEmail(email).isValid) {");
    expect(route).not.toMatch(/\/\^/);
    expect(route).not.toMatch(/new RegExp\(/);
  });
});
