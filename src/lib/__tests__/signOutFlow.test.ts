import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runSignOut, type SignOutDeps, type SignOutScope } from "../sessionFlow";

/**
 * runSignOut, executed: the device ends signed out and on the next screen
 * whatever the sign-out call does.
 *
 * auth-js (2.91.0 as installed) removes its own session only when the server
 * call succeeds or is refused with 401, 403 or 404. Any other error is
 * returned with the session kept, and a network failure throws with it kept.
 * Those two cases are where the Supabase auth cookie would survive a logout,
 * so they are the ones that must delete it directly.
 *
 * The settings page wiring is a source probe at the end of this file.
 */

type Recorder = {
  calls: string[];
  scopes: SignOutScope[];
  logs: string[];
  deps: SignOutDeps;
};

function recorder(
  signOut: ((scope: SignOutScope) => Promise<{ error: unknown }>) | null
): Recorder {
  const calls: string[] = [];
  const scopes: SignOutScope[] = [];
  const logs: string[] = [];
  return {
    calls,
    scopes,
    logs,
    deps: {
      signOut: signOut
        ? async (scope) => {
            scopes.push(scope);
            calls.push("signOut");
            return signOut(scope);
          }
        : null,
      removeAuthCookies: () => {
        calls.push("removeAuthCookies");
      },
      clearLocal: () => {
        calls.push("clearLocal");
      },
      navigate: () => {
        calls.push("navigate");
      },
      log: (line) => {
        logs.push(line);
      },
    },
  };
}

describe("runSignOut", () => {
  it("passes the scope it is given to the sign-out call", async () => {
    for (const scope of ["local", "global"] as const) {
      const r = recorder(async () => ({ error: null }));
      await runSignOut(scope, r.deps);
      expect(r.scopes).toEqual([scope]);
    }
  });

  it("on a clean answer clears and navigates, and leaves the cookies to the library", async () => {
    const r = recorder(async () => ({ error: null }));
    await expect(runSignOut("local", r.deps)).resolves.toBe("server-confirmed");
    expect(r.calls).toEqual(["signOut", "clearLocal", "navigate"]);
    expect(r.logs).toEqual([]);
  });

  it("on a returned error deletes the cookies, clears and navigates", async () => {
    const r = recorder(async () => ({
      error: { name: "AuthApiError", status: 500, message: "boom" },
    }));
    await expect(runSignOut("local", r.deps)).resolves.toBe("local-only");
    expect(r.calls).toEqual([
      "signOut",
      "removeAuthCookies",
      "clearLocal",
      "navigate",
    ]);
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0]).toContain("name=AuthApiError status=500");
    // The library's message is not logged.
    expect(r.logs[0]).not.toContain("boom");
  });

  it("on a throw deletes the cookies, clears and navigates, and does not throw", async () => {
    const r = recorder(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(runSignOut("local", r.deps)).resolves.toBe("local-only");
    expect(r.calls).toEqual([
      "signOut",
      "removeAuthCookies",
      "clearLocal",
      "navigate",
    ]);
    expect(r.logs[0]).toContain("name=TypeError");
  });

  it("still clears and navigates when deleting the cookies throws", async () => {
    const r = recorder(async () => ({ error: { name: "AuthApiError" } }));
    r.deps.removeAuthCookies = () => {
      r.calls.push("removeAuthCookies");
      throw new Error("no document");
    };
    await runSignOut("local", r.deps);
    expect(r.calls).toEqual([
      "signOut",
      "removeAuthCookies",
      "clearLocal",
      "navigate",
    ]);
  });

  it("without a configured client deletes the cookies, clears and navigates", async () => {
    const r = recorder(null);
    await expect(runSignOut("local", r.deps)).resolves.toBe("local-only");
    expect(r.calls).toEqual(["removeAuthCookies", "clearLocal", "navigate"]);
  });
});

describe("settings page wiring", () => {
  const SETTINGS = readFileSync(
    fileURLToPath(new URL("../../app/settings/page.tsx", import.meta.url)),
    "utf8"
  ).replace(/\s+/g, " ");

  function between(from: string, to: string): string {
    const start = SETTINGS.indexOf(from);
    const end = SETTINGS.indexOf(to, start + from.length);
    if (start < 0 || end < 0) {
      throw new Error(`could not bound \`${from}\` … \`${to}\`; re-point these anchors.`);
    }
    return SETTINGS.slice(start, end);
  }

  it("logout signs out locally through runSignOut, clearing the logout set", () => {
    const logout = between("const handleLogout = async", "return (");
    expect(logout).toContain("await runSignOut('local', {");
    expect(logout).toContain("removeAuthCookies: removeSupabaseAuthCookies,");
    expect(logout).toContain("clearLocal: clearLocalAuthState,");
    expect(logout).toContain("navigate: () => router.push('/welcome'),");
  });

  it("account deletion signs out locally through runSignOut, purging everything", () => {
    const deletion = between("const handleDeleteAccount = async", "const handleExportData");
    expect(deletion).toContain("await runSignOut('local', {");
    expect(deletion).toContain("clearLocal: purgeAllNoorLocalState,");
    expect(deletion).toContain("navigate: () => router.push('/welcome'),");
  });

  it("never calls signOut without a scope", () => {
    expect(SETTINGS).not.toContain("auth.signOut()");
    expect(SETTINGS.split("client.auth.signOut({ scope })").length - 1).toBe(2);
  });
});
