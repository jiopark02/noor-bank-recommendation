/**
 * Where the back button on /privacy and /terms goes.
 *
 * In-app links to those pages name their origin in a `back` query parameter
 * (`/privacy?back=/settings`). Only the exact paths below are honoured; a
 * missing value, any other path, or anything that is not a plain in-app path
 * (`https://…`, `//host`, `/settings/../x`) falls back to `/`, which sends a
 * signed-in user on to /dashboard and anyone else to /landing. The page never
 * calls history.back(), so a visitor who arrived from another site is not sent
 * back off the site.
 *
 * Add a path here only together with a link that passes it.
 */
export const LEGAL_BACK_TARGETS = ["/settings", "/landing"] as const;

export const LEGAL_BACK_FALLBACK = "/";

/** `search` is a URL query string, e.g. `window.location.search`. */
export function legalBackTarget(search: string): string {
  const back = new URLSearchParams(search).get("back");
  return back !== null && (LEGAL_BACK_TARGETS as readonly string[]).includes(back)
    ? back
    : LEGAL_BACK_FALLBACK;
}
