import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source probe: a password sign-in calls POST /api/auth/sync-profile, so the
 * profile write and the household ensure run on every sign-in, not only on
 * the /auth/callback paths. The body carries the id only, and the local
 * profile's names come from the sync's answer, never from user_metadata or a
 * browser read of public.users. The sync decision itself is executed in
 * profileSync.test.ts; the response parser in its own tests.
 */

const CODE = readFileSync(
  fileURLToPath(new URL("../../app/login/page.tsx", import.meta.url)),
  "utf8"
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1")
  .replace(/\s+/g, " ");

function between(from: string, to: string): string {
  const start = CODE.indexOf(from);
  const end = CODE.indexOf(to, start + from.length);
  if (start < 0 || end < 0) {
    throw new Error(`could not bound \`${from}\` … \`${to}\`; re-point these anchors.`);
  }
  return CODE.slice(start, end);
}

describe("login profile sync", () => {
  const SYNC = between("async function syncProfileAfterSignIn(", "export default function LoginPage()");
  const FINISH = between("const finishSignIn = async", "const handleResendConfirmation");

  it("posts the id only, with the bearer token, under a time limit", () => {
    expect(SYNC).toContain('fetch("/api/auth/sync-profile", {');
    expect(SYNC).toContain("body: JSON.stringify({ id: userId }),");
    expect(SYNC).toContain("headers: buildJsonAuthorizedHeaders(auth),");
    expect(SYNC).toContain("setTimeout(() => abort.abort(), LOGIN_SYNC_TIMEOUT_MS)");
    expect(SYNC).toContain("signal: abort.signal,");
  });

  it("takes the names from the sync answer only", () => {
    expect(SYNC).toContain("return namesFromSyncResponse(await res.json().catch(() => null));");
    expect(FINISH).toContain("syncProfileAfterSignIn(user.id),");
    expect(FINISH).toContain('const names = synced ?? { firstName: "", lastName: "" };');
    expect(FINISH).toContain("firstName: names.firstName, lastName: names.lastName,");
  });

  it("reads no names from user_metadata and no row from public.users", () => {
    expect(CODE).not.toContain("user_metadata");
    expect(CODE).not.toContain("raw_user_meta_data");
    expect(CODE).not.toContain('.from("users")');
  });

  it("stores the profile only after the sync has answered or timed out", () => {
    // The sync is awaited (inside Promise.all) before the store, and it
    // resolves on an answer, a failure, or its own time limit (see the first
    // test), so the store waits for exactly one of those.
    const awaitAt = FINISH.indexOf(
      "const [synced, surveyRead] = await Promise.all([ syncProfileAfterSignIn(user.id),"
    );
    const storeAt = FINISH.indexOf('localStorage.setItem( "noor_user_profile"');
    expect(awaitAt).toBeGreaterThan(-1);
    expect(storeAt).toBeGreaterThan(awaitAt);
    expect(SYNC).toContain("} finally { clearTimeout(timer); }");
  });
});
