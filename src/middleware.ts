import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simple password protection
const SITE_PASSWORD = process.env.SITE_PASSWORD || 'noor2024';

export function middleware(request: NextRequest) {
  // Skip API routes and static files
  if (
    request.nextUrl.pathname.startsWith('/api') ||
    request.nextUrl.pathname.startsWith('/_next') ||
    request.nextUrl.pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('noor_auth');

  if (authCookie?.value === 'authenticated') {
    return NextResponse.next();
  }

  // Check for password in URL (for initial auth)
  const password = request.nextUrl.searchParams.get('password');

  if (password === SITE_PASSWORD) {
    const response = NextResponse.redirect(new URL(request.nextUrl.pathname, request.url));
    response.cookies.set('noor_auth', 'authenticated', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return response;
  }

  // Show password page
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Noor - Password Required</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #fff;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          max-width: 320px;
          width: 100%;
          padding: 24px;
          text-align: center;
        }
        .logo {
          font-size: 14px;
          letter-spacing: 0.25em;
          font-weight: 500;
          margin-bottom: 48px;
        }
        h1 {
          font-family: Georgia, serif;
          font-size: 28px;
          font-weight: 400;
          margin-bottom: 8px;
        }
        p {
          color: #9E9E9E;
          font-size: 15px;
          margin-bottom: 32px;
        }
        input {
          width: 100%;
          padding: 16px 20px;
          border: 1.5px solid #EEEEEE;
          border-radius: 12px;
          font-size: 16px;
          outline: none;
          transition: border-color 0.3s;
          text-align: center;
        }
        input:focus {
          border-color: #000;
        }
        button {
          width: 100%;
          padding: 16px 20px;
          background: #000;
          color: #fff;
          border: none;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          margin-top: 12px;
          transition: background 0.3s;
        }
        button:hover {
          background: #1a1a1a;
        }
        .error {
          color: #dc2626;
          font-size: 14px;
          margin-top: 16px;
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">NOOR</div>
        <h1>Password required.</h1>
        <p>Enter the password to continue.</p>
        <form id="form">
          <input type="password" id="password" placeholder="Password" autocomplete="off" autofocus>
          <button type="submit">Continue</button>
        </form>
        <p class="error" id="error">Incorrect password</p>
      </div>
      <script>
        document.getElementById('form').addEventListener('submit', function(e) {
          e.preventDefault();
          const password = document.getElementById('password').value;
          if (password) {
            window.location.href = window.location.pathname + '?password=' + encodeURIComponent(password);
          }
        });
        if (window.location.search.includes('password=')) {
          document.getElementById('error').style.display = 'block';
        }
      </script>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
