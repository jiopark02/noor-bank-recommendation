import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/banking",
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

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
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
