import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  runPasswordReset,
  type PasswordResetDeps,
  type SignOutScope,
} from "../sessionFlow";

/**
 * runPasswordReset, executed, and the forgot-password page's wiring to it.
 *
 * The properties:
 *   - nothing is exchanged before submit; on submit the order is verifyOtp,
 *     then updateUser, then a global sign-out;
 *   - once the password has changed the reset succeeds whatever the sign-out
 *     does, and a failed or throwing sign-out deletes this device's auth
 *     cookies;
 *   - an update that fails after the token was exchanged ends the recovery
 *     session on this device, so an unfinished reset leaves no session.
 */

type Step = string;

function fakes(over: Partial<{
  verify: () => Promise<{ error: unknown }>;
  update: () => Promise<{ error: unknown }>;
  signOut: (scope: SignOutScope) => Promise<{ error: unknown }>;
}> = {}): { steps: Step[]; logs: string[]; deps: PasswordResetDeps } {
  const steps: Step[] = [];
  const logs: string[] = [];
  return {
    steps,
    logs,
    deps: {
      verify: async () => {
        steps.push("verify");
        return over.verify ? over.verify() : { error: null };
      },
      update: async () => {
        steps.push("update");
        return over.update ? over.update() : { error: null };
      },
      signOut: async (scope) => {
        steps.push(`signOut:${scope}`);
        return over.signOut ? over.signOut(scope) : { error: null };
      },
      removeAuthCookies: () => {
        steps.push("removeAuthCookies");
      },
      log: (line) => {
        logs.push(line);
      },
    },
  };
}

describe("runPasswordReset", () => {
  it("verifies, then updates, then signs out globally", async () => {
    const f = fakes();
    await expect(runPasswordReset(f.deps)).resolves.toEqual({ kind: "success" });
    expect(f.steps).toEqual(["verify", "update", "signOut:global"]);
  });

  it("succeeds when the global sign-out returns an error, deleting the cookies", async () => {
    const f = fakes({ signOut: async () => ({ error: { name: "AuthApiError", status: 500 } }) });
    await expect(runPasswordReset(f.deps)).resolves.toEqual({ kind: "success" });
    expect(f.steps).toEqual(["verify", "update", "signOut:global", "removeAuthCookies"]);
    expect(f.logs[0]).toContain("name=AuthApiError status=500");
  });

  it("succeeds when the global sign-out throws, deleting the cookies", async () => {
    const f = fakes({
      signOut: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(runPasswordReset(f.deps)).resolves.toEqual({ kind: "success" });
    expect(f.steps).toEqual(["verify", "update", "signOut:global", "removeAuthCookies"]);
  });

  it("stops at a refused verify, with no update and no session to end", async () => {
    const refusal = { code: "otp_expired" };
    const f = fakes({ verify: async () => ({ error: refusal }) });
    await expect(runPasswordReset(f.deps)).resolves.toEqual({
      kind: "verify-refused",
      error: refusal,
    });
    expect(f.steps).toEqual(["verify"]);
  });

  it("stops at a throwing verify", async () => {
    const f = fakes({
      verify: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(runPasswordReset(f.deps)).resolves.toEqual({ kind: "verify-threw" });
    expect(f.steps).toEqual(["verify"]);
  });

  it("ends the recovery session locally when the update is refused", async () => {
    const refusal = { code: "same_password" };
    const f = fakes({ update: async () => ({ error: refusal }) });
    await expect(runPasswordReset(f.deps)).resolves.toEqual({
      kind: "update-refused",
      error: refusal,
    });
    expect(f.steps).toEqual(["verify", "update", "signOut:local"]);
  });

  it("ends the recovery session locally when the update throws", async () => {
    const f = fakes({
      update: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(runPasswordReset(f.deps)).resolves.toEqual({ kind: "update-threw" });
    expect(f.steps).toEqual(["verify", "update", "signOut:local"]);
  });
});

describe("forgot-password page wiring", () => {
  const CODE = readFileSync(
    fileURLToPath(new URL("../../app/forgot-password/page.tsx", import.meta.url)),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");

  it("exchanges the token only inside the submit handler", () => {
    const submitAt = CODE.indexOf("const handleResetPassword = async");
    const verifyAt = CODE.indexOf(
      'client.auth.verifyOtp({ type: "recovery", token_hash: tokenHash })'
    );
    expect(submitAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeGreaterThan(submitAt);
    expect(CODE.split("verifyOtp(").length - 1).toBe(1);
  });

  it("the link only stores the token and shows the form on mount", () => {
    const mount = CODE.slice(
      CODE.indexOf("useEffect(() => { const linkTokenHash"),
      CODE.indexOf("}, [searchParams]);")
    );
    expect(mount).toContain("setTokenHash(linkTokenHash);");
    expect(mount).not.toContain("verifyOtp");
    expect(mount).not.toContain("updateUser");
  });

  it("runs the reset through runPasswordReset with a scoped sign-out", () => {
    expect(CODE).toContain("const outcome = await runPasswordReset({");
    expect(CODE).toContain("signOut: (scope) => client.auth.signOut({ scope }),");
    expect(CODE).toContain("removeAuthCookies: removeSupabaseAuthCookies,");
    expect(CODE).not.toContain("auth.signOut()");
    expect(CODE).toContain(
      'if (outcome.kind === "success") { setStep("success"); return; }'
    );
  });
});
