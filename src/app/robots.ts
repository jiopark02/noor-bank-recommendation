import type { MetadataRoute } from "next";

/**
 * /robots.txt. Public pages stay crawlable; the API and the signed-in app
 * screens are kept out of search.
 *
 * The signed-in prefixes are the middleware's PROTECTED_PREFIXES. middleware.ts
 * does not export them, so they are repeated here, and robots.test.ts reads the
 * middleware source to keep the two lists equal.
 *
 * No sitemap line: the site has no sitemap.
 */
const SIGNED_IN_PREFIXES = [
  "/dashboard",
  "/money",
  "/settings",
  "/chat",
  "/admin",
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", ...SIGNED_IN_PREFIXES],
      },
    ],
  };
}
