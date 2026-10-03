import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Source probe of POST /api/auth/sync-profile's wiring: the identity handed to
 * syncProfileForUser is built from the verified token's user, and the route
 * reads no identity value from the request body.
 *
 * Mutations of route.ts and the tests each one turns red:
 *   R1  the body email passed as the identity email   -> W1, W2
 *   R2  getAuthenticatedUserIdFromRequest restored    -> W1, W2
 *
 * Comments and string-literal contents are blanked before matching, so text in
 * either cannot satisfy or trip a check. It does not follow a value through an
 * alias, and it does not execute the route.
 */

const ROUTE = fileURLToPath(
  new URL("../../app/api/auth/sync-profile/route.ts", import.meta.url)
);

/** Comments and the contents of ', " and ` literals become spaces. */
function mask(src: string): string {
  const out = src.split("");
  const n = src.length;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && d === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

const code = mask(readFileSync(ROUTE, "utf8")).replace(/\s+/g, " ");

describe("sync-profile route wiring", () => {
  it("W1 builds the identity from the user returned by getAuthenticatedUserFromRequest", () => {
    expect(code).toMatch(
      /const user = await getAuthenticatedUserFromRequest\( ?request ?\)/
    );
    expect(code).toMatch(
      /syncProfileForUser\( ?\{ ?id: user\.id, email: user\.email, userMetadata: user\.user_metadata ?\}, body,/
    );
  });

  it("W2 reads no identity value from the request body", () => {
    expect(code).not.toMatch(/\bbody\??\.(email|raw_user_meta_data|id)\b/);
    expect(code).not.toMatch(/\bgetAuthenticatedUserIdFromRequest\b/);
  });
});
