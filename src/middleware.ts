import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/banking",
  "/money",
  "/housing",
  "/jobs",
  "/funding",
  "/forum",
  "/deals",
  "/settings",
  "/chat",
  "/admin",
] as const;

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

// When DEMO_DOMAIN is set, that hostname serves only the /demo experience
// (plus /waitlist, its one allowed exit) — visitors there must never see the
// main site (landing, login, dashboard, etc). Everything else keeps
// resolving normally on the main domain.
const DEMO_DOMAIN = process.env.DEMO_DOMAIN;
const DEMO_DOMAIN_ALLOWED_PREFIXES = ["/demo", "/waitlist", "/_next", "/api"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (
    DEMO_DOMAIN &&
    request.nextUrl.hostname === DEMO_DOMAIN &&
    !DEMO_DOMAIN_ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return NextResponse.redirect(new URL("/demo", request.url));
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Only protected paths need auth resolution + session refresh. Non-protected
  // paths (/, /landing, /login, /waitlist, ...) fall through to passthrough,
  // matching the pre-demo-merge baseline where middleware ran only on
  // PROTECTED_PREFIXES. The demo host check above already ran for every path.
  if (!isProtectedPath(pathname)) {
    return response;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail closed. Reaching here means a protected path is being served by a
  // deployment with no Supabase credentials, so auth cannot be resolved at
  // all. Passing the request through would hand out /dashboard, /settings,
  // /admin and the rest with no check — misconfiguration must not degrade
  // into an absence of authentication.
  //
  // 503 rather than a /login redirect: with the env missing the browser
  // client is unconfigured too, so getSessionSafe() returns null and the
  // login form cannot work. The user would land on a login page that can
  // never succeed, with the real cause invisible. This matches how the cron
  // routes already treat a missing CRON_SECRET (503, distinct from the 401
  // they return for a bad one).
  //
  // no-store keeps an edge or browser cache from serving this 503 after the
  // env is fixed and redeployed.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "[middleware] Supabase env missing; refusing protected path",
      pathname
    );
    return new NextResponse("Service temporarily unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set({ name, value, ...options });
        });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set({ name, value, ...options });
        });
      },
    },
  });

  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    // Fail closed: if auth can't be resolved on a protected path, treat as
    // unauthenticated and send to /login rather than 500-ing the request.
    user = null;
  }

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on virtually every page request (not just protected prefixes) so the
    // demo-domain hostname check above can intercept /, /landing, /waitlist, etc.
    // Static assets, Next internals, and API routes are excluded.
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
