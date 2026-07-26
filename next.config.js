/** @type {import('next').NextConfig} */

// Static security headers (B2-a). Applied to every route.
//
// SCOPE: intentionally the 5 static headers only. The full Content-Security-
// Policy (script-src/style-src nonce machinery) is deliberately NOT here — it
// is the separate B2-b work. The only CSP directive present is
// `frame-ancestors 'none'`, the modern clickjacking control that pairs with
// X-Frame-Options; no other CSP directive may be added in this scope.
const securityHeaders = [
  // Start conservative: 5 minutes, NO includeSubDomains / preload. HSTS is the
  // one header here that is expensive to roll back (browsers cache it for the
  // full max-age), so we observe first and raise later.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=300',
  },
  // Clickjacking: legacy X-Frame-Options + modern frame-ancestors. We embed
  // Plaid's iframe (we are the parent), we are never the framed party, so DENY
  // is safe and does not affect Plaid Link.
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'",
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  // geolocation=(self): MapView uses navigator.geolocation for "you are here",
  // so it must stay allowed for our own origin. camera/microphone are unused
  // and fully blocked.
  {
    key: 'Permissions-Policy',
    value: 'geolocation=(self), camera=(), microphone=()',
  },
];

const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['udkmzwscmotcyddptpko.supabase.co'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
