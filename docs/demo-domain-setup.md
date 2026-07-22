# Demo Domain Setup

How to serve the `/demo` experience on its own domain, separate from the main
production site, with the waitlist reachable on that same domain.

**Status: code is ready on the `demo` branch.** The steps below are the
remaining manual work — none of it can be done from Claude Code, it all
happens in your domain registrar and the Vercel dashboard.

---

## What the code already does

- `src/middleware.ts` checks the request hostname against a `DEMO_DOMAIN` env
  var. If they match, only `/demo/*` and `/waitlist` (plus Next internals and
  `/api/*`) are allowed through — every other path (`/`, `/login`,
  `/dashboard`, `/landing`, etc.) redirects to `/demo`.
- The demo's "Join waitlist" links (banner, chat message cap, settings page)
  are relative (`/waitlist`), so they stay on whichever domain the visitor is
  already on.
- There is no separate "Exit demo" link — the only way out of the demo
  experience on that domain is the waitlist form.
- This is all one Vercel project. No second project, no second deploy
  pipeline — just a second domain attached to the same project.

None of this activates until `DEMO_DOMAIN` is set in Vercel (see below). Until
then, the app behaves exactly as it does today on your main domain.

---

## Step 1 — Get a domain for the demo

Anything works: a domain you already own, a new cheap domain, or a subdomain
of something you own (e.g. `try.yourdomain.com`). It just needs to be a
hostname you can point at Vercel.

## Step 2 — Add the domain to the Vercel project

1. Open the project in the Vercel dashboard.
2. **Settings → Domains → Add**.
3. Enter the domain and follow Vercel's DNS instructions (it'll show you a
   CNAME or A record to add at your registrar/DNS provider).
4. Wait for DNS to propagate and Vercel to show the domain as verified.

This attaches the domain to the **same deployment** as your main site — no
new project needed.

## Step 3 — Set the `DEMO_DOMAIN` environment variable

1. **Settings → Environment Variables**.
2. Add:
   - **Key:** `DEMO_DOMAIN`
   - **Value:** the exact hostname from Step 1 (no `https://`, no trailing
     slash — e.g. `try-noor.com`, not `https://try-noor.com/`)
   - **Environment:** Production (and Preview too, if you want preview
     deployments to respect it)
3. Save.

## Step 4 — Redeploy

Environment variable changes do **not** trigger a redeploy automatically.

- **Deployments → (latest) → ⋯ → Redeploy**

## Step 5 — Verify live

Once redeployed, check on the actual domain (not localhost — there's no local
build to test against per this project's constraints):

| Visit | Expected result |
|---|---|
| `https://<demo-domain>/` | Redirects to `/demo` |
| `https://<demo-domain>/demo` | Loads the demo entry/loading screen normally |
| `https://<demo-domain>/dashboard` | Redirects to `/demo` (not your real dashboard) |
| `https://<demo-domain>/login` | Redirects to `/demo` (not your real login) |
| `https://<demo-domain>/waitlist` | Loads the real waitlist signup form |
| Click "Join waitlist" from inside `/demo/*` | Lands on `<demo-domain>/waitlist`, same domain |
| `https://<your-main-domain>/dashboard`, `/login`, etc. | Unaffected — behaves exactly as before |

---

## Rolling back / disabling

To turn this off instantly (e.g. abuse, or you want the demo domain to stop
redirecting): delete or blank out the `DEMO_DOMAIN` env var in Vercel and
redeploy. The middleware only activates when that var is set, so removing it
reverts every domain to today's behavior.

To fully remove the demo domain: also remove it under **Settings → Domains**
in Vercel, and (optionally) remove the DNS record at your registrar.
