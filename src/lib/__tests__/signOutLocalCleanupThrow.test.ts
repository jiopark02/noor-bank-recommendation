import { describe, expect, it } from "vitest";
import { runSignOut, type SignOutScope } from "../sessionFlow";

/**
 * runSignOut, executed: a throw from the local clean-up does not stop the
 * navigation, and only the error's name is logged.
 */

function deps(signOutError: unknown) {
  const calls: string[] = [];
  const logs: string[] = [];
  return {
    calls,
    logs,
    value: {
      signOut: async (_scope: SignOutScope) => {
        calls.push("signOut");
        return { error: signOutError };
      },
      removeAuthCookies: () => {
        calls.push("removeAuthCookies");
      },
      clearLocal: () => {
        calls.push("clearLocal");
        const err = new Error("storage holds user@example.com");
        err.name = "QuotaExceededError";
        throw err;
      },
      navigate: () => {
        calls.push("navigate");
      },
      log: (line: string) => {
        logs.push(line);
      },
    },
  };
}

describe("runSignOut when the local clean-up throws", () => {
  it("still navigates once after a confirmed sign-out", async () => {
    const d = deps(null);
    await expect(runSignOut("local", d.value)).resolves.toBe("server-confirmed");
    expect(d.calls).toEqual(["signOut", "clearLocal", "navigate"]);
    expect(d.calls.filter((c) => c === "navigate")).toHaveLength(1);
  });

  it("still removes the cookies and navigates once after a failed sign-out", async () => {
    const d = deps({ name: "AuthApiError", status: 500 });
    await expect(runSignOut("local", d.value)).resolves.toBe("local-only");
    expect(d.calls).toEqual(["signOut", "removeAuthCookies", "clearLocal", "navigate"]);
  });

  it("logs the clean-up error by name only", async () => {
    const d = deps(null);
    await runSignOut("local", d.value);
    const line = d.logs.find((l) => l.includes("local sign-out clean-up failed"));
    expect(line).toBe("[auth] local sign-out clean-up failed name=QuotaExceededError");
    expect(d.logs.join("\n")).not.toContain("user@example.com");
  });
});
