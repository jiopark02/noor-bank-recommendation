import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Executes the cookie writes supabase-browser.ts makes outside the library's
 * own writer: the "Keep me signed in" marker (set and cleared by
 * setSessionPersistence) and the direct removal of the auth cookies
 * (removeSupabaseAuthCookies). Each must follow the auth cookies' rule:
 * Secure on an HTTPS page, nothing added over plain HTTP or outside a page.
 *
 * The anon key is empty, so no browser client is built; @supabase/ssr is not
 * mocked, so the strings are serialized by the installed library. The module
 * reads its env on import, so every case resets the registry and imports
 * afresh. Every assertion compares the whole list of writes.
 */

const JAR =
  "sb-example-auth-token.0=a; sb-example-auth-token.1=b; " +
  "sb-example-auth-token-code-verifier=c; noor_session_only=1; other=x";

let writes: string[];

function stubDocument(jar: string): void {
  writes = [];
  vi.stubGlobal("document", {
    get cookie() {
      return jar;
    },
    set cookie(value: string) {
      writes.push(value);
    },
  });
}

function stubProtocol(protocol: string): void {
  vi.stubGlobal("window", { location: { protocol } });
}

async function load() {
  vi.resetModules();
  return import("../supabase-browser");
}

beforeEach(() => {
  writes = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const MARKER_SET = "noor_session_only=1; Path=/; SameSite=Lax";
const MARKER_SET_SECURE = "noor_session_only=1; Path=/; Secure; SameSite=Lax";
const MARKER_CLEAR = "noor_session_only=; Max-Age=0; Path=/; SameSite=Lax";
const MARKER_CLEAR_SECURE =
  "noor_session_only=; Max-Age=0; Path=/; Secure; SameSite=Lax";

const REMOVED_NAMES = [
  "sb-example-auth-token.0",
  "sb-example-auth-token.1",
  "sb-example-auth-token-code-verifier",
];

function removals(secure: boolean): string[] {
  return REMOVED_NAMES.map(
    (name) =>
      `${name}=; Max-Age=0; Path=/; ${secure ? "Secure; " : ""}SameSite=Lax`
  );
}

describe("session marker cookie", () => {
  it("T1 on an HTTPS page the marker is written Secure", async () => {
    stubDocument("");
    stubProtocol("https:");
    const { setSessionPersistence } = await load();
    setSessionPersistence(false);
    expect(writes).toEqual([MARKER_SET_SECURE]);
  });

  it("T2 on an HTTPS page the marker is cleared Secure", async () => {
    stubDocument(JAR);
    stubProtocol("https:");
    const { setSessionPersistence } = await load();
    setSessionPersistence(true);
    expect(writes).toEqual([MARKER_CLEAR_SECURE]);
  });

  it("T3 over plain HTTP the marker is written without Secure", async () => {
    stubDocument("");
    stubProtocol("http:");
    const { setSessionPersistence } = await load();
    setSessionPersistence(false);
    expect(writes).toEqual([MARKER_SET]);
  });

  it("T4 over plain HTTP the marker is cleared without Secure", async () => {
    stubDocument(JAR);
    stubProtocol("http:");
    const { setSessionPersistence } = await load();
    setSessionPersistence(true);
    expect(writes).toEqual([MARKER_CLEAR]);
  });
});

describe("direct removal of the auth cookies", () => {
  it("T5 on an HTTPS page each auth cookie is removed Secure, and nothing else", async () => {
    stubDocument(JAR);
    stubProtocol("https:");
    const { removeSupabaseAuthCookies } = await load();
    removeSupabaseAuthCookies();
    expect(writes).toEqual(removals(true));
  });

  it("T6 over plain HTTP each auth cookie is removed without Secure, and nothing else", async () => {
    stubDocument(JAR);
    stubProtocol("http:");
    const { removeSupabaseAuthCookies } = await load();
    removeSupabaseAuthCookies();
    expect(writes).toEqual(removals(false));
  });
});

describe("outside a page", () => {
  it("T7 with no window nothing is written Secure", async () => {
    stubDocument(JAR);
    const { setSessionPersistence, removeSupabaseAuthCookies } = await load();
    setSessionPersistence(false);
    setSessionPersistence(true);
    removeSupabaseAuthCookies();
    expect(writes).toEqual([MARKER_SET, MARKER_CLEAR, ...removals(false)]);
  });

  it("T8 with no document nothing throws", async () => {
    stubProtocol("https:");
    const { setSessionPersistence, removeSupabaseAuthCookies } = await load();
    expect(() => {
      setSessionPersistence(false);
      setSessionPersistence(true);
      removeSupabaseAuthCookies();
    }).not.toThrow();
    expect(writes).toEqual([]);
  });
});
