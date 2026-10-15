import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The WIRING of /api/account/delete's connection read into the deletion logic.
 *
 * accountDeletion.test.ts proves that deleteAccountForUser refuses to delete an
 * account when listConnections answers null — a failed read must not be taken
 * as "nothing to revoke", because deleting the account would destroy the rows
 * holding the only copies of tokens for Items nobody revoked. That test injects
 * listConnections as a spy, so it cannot see the real adapter the route passes
 * in. The adapter is a small inline function in route.ts, and two edits to it
 * defeat that whole protection while every other test stays green and tsc stays
 * clean (both measured before this file existed):
 *
 *   1. `return (await getAllPlaidConnections(userId)) ?? [];` in the try.
 *   2. `return [];` instead of `return null;` in the catch.
 *
 * Either one hands deleteAccountForUser an empty list for a failed read, and
 * the account is deleted with its bank connections un-revoked.
 *
 * WHAT THIS FILE DOES AND DOES NOT PROVE
 * It reads source TEXT between two property anchors (`listConnections:` and
 * `revokeAll:`) and pins every `return` in that span: exactly one returning the
 * helper's result unchanged, then exactly one returning null. It executes
 * nothing, so it cannot see a fallback applied somewhere other than a return
 * statement in that span, and a `return ...;` written inside a comment or string
 * there would be read as code. If an anchor is missing, the adapter was moved or
 * renamed — re-point the anchor rather than deleting the assertion.
 */

const DELETE_ROUTE = "../../app/api/account/delete/route.ts";

function adapterSource(): string {
  const source = readFileSync(
    fileURLToPath(new URL(DELETE_ROUTE, import.meta.url)),
    "utf8"
  );
  const start = source.indexOf("listConnections:");
  if (start === -1) {
    throw new Error(
      "/api/account/delete: no `listConnections:` property found. The adapter " +
        "was removed or refactored; re-point this probe."
    );
  }
  const end = source.indexOf("revokeAll:", start);
  if (end === -1) {
    throw new Error(
      "/api/account/delete: no `revokeAll:` after `listConnections:`. The end " +
        "anchor moved; re-point this probe."
    );
  }
  return source.slice(start, end);
}

/** Every `return <expr>;` in the span, expression whitespace-normalized. */
function returnedExpressions(span: string): string[] {
  const out: string[] = [];
  const pattern = /\breturn\b\s*([^;]*);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(span)) !== null) {
    out.push(match[1].replace(/\s+/g, " ").trim());
  }
  return out;
}

describe("/api/account/delete — the listConnections adapter passes a failed read through", () => {
  it("returns the helper's result unchanged and null from its catch, and nothing else", () => {
    // A failed read must reach deleteAccountForUser as null, where it stops the
    // deletion. Any fallback to [] — on the helper's result or in the catch —
    // reports "no connections" and lets the account be deleted with live,
    // un-revoked Plaid Items. Pinning the full list of returns also catches a
    // third return added as an early exit.
    expect(returnedExpressions(adapterSource())).toEqual([
      "await getAllPlaidConnections(userId)",
      "null",
    ]);
  });
});
