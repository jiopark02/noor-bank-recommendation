import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Executes readSession's classification, which every decision in sessionFlow.ts
 * takes as given: only a clean answer with no session may come back "none".
 *
 * The client is a module-level constant, evaluated once on import from the env
 * at that moment, so it would carry from one case to the next. Each case resets
 * the module registry and imports afresh, and load() asserts a new client was
 * built, so a case cannot pass on a previous case's client.
 */

const { createBrowserClient, getSession } = vi.hoisted(() => {
  const getSession = vi.fn();
  return {
    getSession,
    createBrowserClient: vi.fn(() => ({ auth: { getSession } })),
  };
});

vi.mock("@supabase/ssr", () => ({ createBrowserClient }));

const FAKE_SESSION = { user: { id: "user-1" } };

async function load() {
  vi.resetModules();
  createBrowserClient.mockClear();
  const browser = await import("../supabase-browser");
  expect(createBrowserClient).toHaveBeenCalledTimes(1);
  return browser;
}

beforeEach(() => {
  getSession.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readSession", () => {
  it("R1 a session is a session", async () => {
    getSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });
    const { readSession } = await load();
    await expect(readSession()).resolves.toEqual({
      status: "session",
      session: FAKE_SESSION,
    });
  });

  it("R2 a clean answer with no session is none", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const { readSession } = await load();
    await expect(readSession()).resolves.toEqual({ status: "none" });
  });

  it("R3 an error with no session is unavailable, not none", async () => {
    getSession.mockResolvedValue({
      data: { session: null },
      error: new Error("refresh failed"),
    });
    const { readSession } = await load();
    await expect(readSession()).resolves.toMatchObject({
      status: "unavailable",
      reason: "error",
    });
  });

  it("R4 a throw is unavailable", async () => {
    getSession.mockRejectedValue(new Error("network"));
    const { readSession } = await load();
    await expect(readSession()).resolves.toMatchObject({
      status: "unavailable",
      reason: "error",
    });
  });

  it("R5 a read that never answers is unavailable at the timeout", async () => {
    getSession.mockReturnValue(new Promise(() => {}));
    const { readSession } = await load();
    await expect(readSession(5)).resolves.toMatchObject({
      status: "unavailable",
      reason: "timeout",
    });
  });

  it("R6 an error alongside a session is still a session", async () => {
    getSession.mockResolvedValue({
      data: { session: FAKE_SESSION },
      error: new Error("odd"),
    });
    const { readSession } = await load();
    await expect(readSession()).resolves.toEqual({
      status: "session",
      session: FAKE_SESSION,
    });
  });

  it("R7 no configuration is unavailable, and builds no client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.resetModules();
    createBrowserClient.mockClear();
    const { readSession } = await import("../supabase-browser");
    expect(createBrowserClient).not.toHaveBeenCalled();
    await expect(readSession()).resolves.toMatchObject({
      status: "unavailable",
      reason: "not-configured",
    });
    expect(getSession).not.toHaveBeenCalled();
  });
});

describe("getSessionSafe", () => {
  it("R8 keeps its contract: unavailable comes back as null", async () => {
    getSession.mockRejectedValue(new Error("network"));
    const { getSessionSafe } = await load();
    await expect(getSessionSafe()).resolves.toBeNull();
  });
});
