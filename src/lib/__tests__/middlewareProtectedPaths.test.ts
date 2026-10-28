import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * src/middleware.ts sends a request with no Supabase session to /login on the
 * protected page prefixes, and only on those.
 *
 * WHAT IT EXISTS TO PREVENT
 * A prefix dropped from PROTECTED_PREFIXES serves its pages to logged-out
 * visitors with no check. A prefix left in the list for a page that no longer
 * exists turns its 404 into a /login redirect.
 *
 * HOW
 * The real middleware runs on real NextRequests that carry no cookies, with a
 * Supabase URL nothing listens on. fetch is stubbed to throw, so nothing leaves
 * the process; with no session getUser() resolves to no user either way.
 */

const PROTECTED = ["/dashboard", "/money", "/settings", "/chat", "/admin"];
const UNPROTECTED = ["/jobs", "/banking", "/housing", "/funding", "/forum", "/deals"];

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DEMO_DOMAIN"] as const;
let savedEnv: Record<string, string | undefined> = {};

function request(pathname: string): NextRequest {
  return new NextRequest(new URL(pathname, "https://app.example.test"));
}

async function run(pathname: string) {
  const { middleware } = await import("../../middleware");
  return middleware(request(pathname));
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.DEMO_DOMAIN;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  vi.stubGlobal("fetch", async () => {
    throw new Error("network disabled in test");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("protected prefixes redirect a request with no session to /login", () => {
  it.each(PROTECTED.flatMap((p) => [p, `${p}/nested`]))("%s", async (pathname) => {
    const res = await run(pathname);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
  });
});

describe("prefixes with no page pass through untouched", () => {
  it.each(UNPROTECTED.flatMap((p) => [p, `${p}/nested`]))("%s", async (pathname) => {
    const res = await run(pathname);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("a protected path with no Supabase env fails closed", () => {
  it("answers 503 on /dashboard", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const res = await run("/dashboard");
    expect(res.status).toBe(503);
  });
});
