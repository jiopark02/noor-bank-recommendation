import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  SESSION_ONLY_COOKIE,
  applySessionPersistence,
  cookieOptionsForPersistence,
  defaultSupabaseStorageKey,
  isSupabaseAuthCookieName,
} from "../sessionFlow";

/**
 * "Keep me signed in" and the Supabase auth cookie lifetime.
 *
 * @supabase/ssr (0.5.2 as installed) writes every auth cookie with a 400-day
 * maxAge and overrides any maxAge passed as cookieOptions, so an unchecked box
 * can only be honoured in the cookie writer: the browser client's setAll and
 * the middleware's setAll both pass the cookies through
 * applySessionPersistence. The functions are executed here; the two writers
 * are source probes at the end.
 */

const LIFETIME = { path: "/", sameSite: "lax" as const, maxAge: 400 * 24 * 60 * 60 };

describe("cookieOptionsForPersistence", () => {
  it("keeps the library's lifetime when the session is persistent", () => {
    expect(
      cookieOptionsForPersistence({ name: "a", value: "v", options: LIFETIME }, true)
    ).toEqual(LIFETIME);
  });

  it("drops maxAge and expires from a cookie being set when session-only", () => {
    const options = cookieOptionsForPersistence(
      {
        name: "a",
        value: "v",
        options: { ...LIFETIME, expires: new Date(0) },
      },
      false
    );
    expect(options).toEqual({ path: "/", sameSite: "lax" });
    expect("maxAge" in options).toBe(false);
    expect("expires" in options).toBe(false);
  });

  it("leaves a removal (maxAge 0) as a removal when session-only", () => {
    const removal = { path: "/", sameSite: "lax" as const, maxAge: 0 };
    expect(
      cookieOptionsForPersistence({ name: "a", value: "", options: removal }, false)
    ).toEqual(removal);
    expect(
      cookieOptionsForPersistence({ name: "a", value: "x", options: removal }, false)
    ).toEqual(removal);
  });

  it("applies to every cookie in a write", () => {
    const out = applySessionPersistence(
      [
        { name: "sb-x-auth-token.0", value: "p0", options: LIFETIME },
        { name: "sb-x-auth-token.1", value: "p1", options: LIFETIME },
        { name: "sb-x-auth-token.2", value: "", options: { ...LIFETIME, maxAge: 0 } },
      ],
      false
    );
    expect(out.map((c) => c.options.maxAge)).toEqual([undefined, undefined, 0]);
  });
});

describe("auth cookie names", () => {
  const URL_ = "https://abcdefgh.supabase.co";

  it("derives the same storage key as the installed supabase-js", () => {
    const client = createClient(URL_, "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const libraryKey = (client.auth as unknown as { storageKey: string }).storageKey;
    expect(defaultSupabaseStorageKey(URL_)).toBe(libraryKey);
    expect(libraryKey).toBe("sb-abcdefgh-auth-token");
  });

  it("answers null for an unusable URL", () => {
    expect(defaultSupabaseStorageKey("not a url")).toBeNull();
  });

  it("matches the session, its chunks, the code verifier and the user", () => {
    const key = "sb-abcdefgh-auth-token";
    for (const name of [
      key,
      `${key}.0`,
      `${key}.12`,
      `${key}-code-verifier`,
      `${key}-user`,
    ]) {
      expect(isSupabaseAuthCookieName(name, key), name).toBe(true);
    }
  });

  it("does not match other cookies, including ones sharing the prefix", () => {
    const key = "sb-abcdefgh-auth-token";
    for (const name of [
      SESSION_ONLY_COOKIE,
      "sb-other-auth-token",
      `${key}-extra`,
      `${key}x`,
      `${key}.01`,
      "sb-abcdefgh",
    ]) {
      expect(isSupabaseAuthCookieName(name, key), name).toBe(false);
    }
  });
});

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

describe("cookie writers", () => {
  it("the browser client writes through applySessionPersistence, keyed on the marker", () => {
    const browser = source("../supabase-browser.ts");
    expect(browser).toContain(
      "cookies: { getAll: readDocumentCookies, setAll: writeDocumentCookies, },"
    );
    expect(browser).toContain("const persistent = !hasSessionOnlyMarker();");
    expect(browser).toContain("applySessionPersistence(cookies, persistent).forEach(");
    expect(browser).toContain("name === SESSION_ONLY_COOKIE");
  });

  it("the middleware writes refreshed cookies through applySessionPersistence", () => {
    const middleware = source("../../middleware.ts");
    expect(middleware).toContain(
      "const persistent = !request.cookies.has(SESSION_ONLY_COOKIE);"
    );
    expect(middleware).toContain(
      "applySessionPersistence(cookiesToSet, persistent).forEach( ({ name, value, options }) => { response.cookies.set({ name, value, ...options }); } );"
    );
    // The response cookies are written only through the policy.
    expect(middleware.split("response.cookies.set(").length - 1).toBe(1);
  });

  it("the login page records the choice before both sign-in calls", () => {
    const login = source("../../app/login/page.tsx");
    const marks = login.split("setSessionPersistence(keepSignedIn);").length - 1;
    expect(marks).toBe(2);
    const oauthAt = login.indexOf("supabase.auth.signInWithOAuth(");
    const passwordAt = login.indexOf("supabase.auth.signInWithPassword(");
    const firstMark = login.indexOf("setSessionPersistence(keepSignedIn);");
    const secondMark = login.indexOf("setSessionPersistence(keepSignedIn);", firstMark + 1);
    expect(firstMark).toBeLessThan(oauthAt);
    expect(secondMark).toBeGreaterThan(oauthAt);
    expect(secondMark).toBeLessThan(passwordAt);
  });
});
