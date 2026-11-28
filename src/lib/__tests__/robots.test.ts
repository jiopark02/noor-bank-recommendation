import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import robots from "../../app/robots";

/**
 * /robots.txt (src/app/robots.ts) keeps the API and the signed-in app screens
 * out of search and leaves the public pages crawlable.
 *
 * The answer is produced by running the real function. The signed-in prefixes
 * are read from the middleware's PROTECTED_PREFIXES source text, so a prefix
 * added to the middleware and not to robots.ts turns R2 red.
 *
 * Mutations and the tests each one turns red:
 *   "/api/" removed from disallow                 -> R1, R4
 *   a signed-in prefix removed from disallow      -> R2, R4
 *   "/" disallowed, or allow removed              -> R3, R4
 *   a sitemap line added                          -> R4
 */

const MIDDLEWARE = "../../middleware.ts";

function protectedPrefixesFromMiddleware(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL(MIDDLEWARE, import.meta.url)),
    "utf8"
  );
  const match = /const PROTECTED_PREFIXES = \[([^\]]*)\]/.exec(source);
  if (!match) {
    throw new Error(
      "middleware.ts: no `const PROTECTED_PREFIXES = [...]` found. It was " +
        "renamed or moved; re-point this probe."
    );
  }
  const prefixes = match[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const quoted = /^"([^"]+)"$/.exec(entry);
      if (!quoted) {
        throw new Error(`middleware.ts: unexpected PROTECTED_PREFIXES entry ${entry}`);
      }
      return quoted[1];
    });
  if (prefixes.length === 0) {
    throw new Error("middleware.ts: PROTECTED_PREFIXES read as empty");
  }
  return prefixes;
}

function onlyRule() {
  const answer = robots();
  const rules = Array.isArray(answer.rules) ? answer.rules : [answer.rules];
  expect(rules).toHaveLength(1);
  return rules[0];
}

function disallowList(): string[] {
  const { disallow } = onlyRule();
  if (disallow === undefined) return [];
  return Array.isArray(disallow) ? disallow : [disallow];
}

/** Robots prefix matching: a path is blocked when it starts with a disallow value. */
function isDisallowed(path: string): boolean {
  return disallowList().some((value) => path.startsWith(value));
}

describe("robots.txt", () => {
  it("R1 disallows /api/", () => {
    expect(disallowList()).toContain("/api/");
  });

  it("R2 disallows every signed-in prefix the middleware protects", () => {
    const prefixes = protectedPrefixesFromMiddleware();
    for (const prefix of prefixes) {
      expect(disallowList()).toContain(prefix);
      expect(isDisallowed(`${prefix}/anything`)).toBe(true);
    }
  });

  it("R3 leaves the public pages crawlable", () => {
    const rule = onlyRule();
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
    for (const path of [
      "/",
      "/landing",
      "/privacy",
      "/terms",
      "/waitlist",
      "/login",
      "/forgot-password",
      "/survey",
    ]) {
      expect(isDisallowed(path)).toBe(false);
    }
  });

  it("R4 the whole answer is fixed, with no sitemap line", () => {
    expect(robots()).toEqual({
      rules: [
        {
          userAgent: "*",
          allow: "/",
          disallow: ["/api/", "/dashboard", "/money", "/settings", "/chat", "/admin"],
        },
      ],
    });
  });
});
