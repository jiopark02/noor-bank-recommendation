# Demo Mode

A one-click demo experience that lets visitors try the app instantly — no email, no password, no friction.

**Status: not yet implemented.** None of the files below exist in the codebase yet — this is a design plan.

---

## User Journey

1. Visitor lands on `waitlist.noor.financial` (`src/app/landing/page.tsx`)
2. The landing page today already has **Login**, **Join waitlist**, and **Get Started** (→ `/welcome`) CTAs — this adds a fourth: **Try demo**
3. They click **Try demo** — one click, no form
4. They're redirected to the dashboard, already logged in, with realistic fake data
5. They explore freely — bank recommendations, transactions, Noor AI chat (3 free messages)
6. When they hit the message limit or want more, they see: *"You're on the demo — join the waitlist for full access"*

Total time from landing page to inside the app: **under 2 seconds, one click.**

Note: the landing page is not a hard gate today — users can already sign up directly via `/welcome`. Demo mode is an additional low-friction path alongside that, not a replacement for it.

---

## What the Demo User Sees

| Area | Demo Content |
|------|-------------|
| Dashboard | Pre-filled profile (financial beginner, no SSN, sample budget) |
| Banking | Sample bank account with realistic transactions |
| Recommendations | Pre-generated bank recommendations based on demo profile |
| Noor AI Chat | Fully working — capped at 3 messages, then prompts to sign up |
| Settings | Viewable but saves are no-op or scoped to demo session |

---

## How It Works (Technical)

### Session Creation
- User clicks "Try demo" → hits `POST /api/demo/session`
- Route calls `supabase.auth.signInAnonymously()` — creates a real Supabase session, sets the auth cookie
- **Verified:** `src/middleware.ts` (lines 24-71) only checks `supabase.auth.getUser()` and redirects if there's no user at all — it does not distinguish anonymous from password/OAuth sessions, so an anonymous session passes through unmodified
- **Verified:** `getAuthenticatedUserIdFromRequest()` (`src/lib/apiAuth.ts:8-39`) only validates the JWT and returns `user.id` — it doesn't branch on auth method, so anonymous users authenticate against existing API routes with no changes needed
- Route checks IP rate limit before creating the session (max 3 demo sessions per IP per hour)
- User is redirected to `/dashboard` — middleware sees a valid session, lets them through

**Caveat:** `requireAdmin()` (`src/lib/apiAuth.ts:79-141`) additionally checks `email_confirmed_at`, which anonymous users won't have. This is fine — demo users should never hit admin routes — but don't assume `getAuthenticatedUserIdFromRequest` success implies admin-eligible; it doesn't, by design.

### Demo Data
- A seed script populates a fixed set of demo data into the DB (bank accounts, transactions, recommendations, survey answers)
- Each new anonymous user gets their own copy of this data scoped to their `user_id`
- **Verified against `bankRecommendation.ts`:** `getRecommendations()` reads from both the `users` table and `survey_responses` — the seed must write both, not just `users`, or recommendation generation will fail/fall back to mock data
- Data is deleted when the demo session expires (24 hours)

### Demo Flag
- Anonymous users get `is_demo: true` written to the `users` table on session creation
- **Not yet present:** `is_demo` does not exist on the `users` table today (`src/types/database.ts`) — it must be added by the migration below, along with the corresponding TypeScript type update
- Every API route that calls OpenRouter/AI checks this flag before proceeding
- After 3 AI messages (tracked in a `demo_usage` table), the chat API returns a soft block instead of calling the AI
- **Insertion point verified:** `src/app/api/chat/route.ts`, immediately after the existing auth check (`getAuthenticatedUserIdFromRequest` → 401 if null, around line 881-886). Add the `is_demo` + `demo_usage` check right after that block, before the memory system loads, so demo users never reach the OpenRouter call once capped.

### Rate Limiting
- **Verified: no existing rate-limiting utility in this codebase.** No helper reads `x-forwarded-for`, and there's no reusable rate-limit check anywhere else to copy from — this needs to be built from scratch for `POST /api/demo/session`, not adapted from an existing pattern.
- `POST /api/demo/session` reads `x-forwarded-for` header
- Stores IP + timestamp in a `demo_sessions` table
- Blocks if same IP has created 3+ sessions in the last hour
- Returns a friendly message: *"Too many demo sessions from this device. Try again later."*

### Session Expiry
- Demo sessions expire after 24 hours (Supabase session TTL)
- A cron job (`/api/cron/cleanup-demo`) runs daily to delete expired demo user data from all tables

---

## Security Considerations

| Risk | Mitigation |
|------|-----------|
| AI cost abuse | Cap at 3 messages per demo session, tracked server-side |
| Session flooding | IP rate limit on demo session creation (3/hour) — built new, no existing utility to reuse |
| Real data exposure | Demo users only see their own seeded fake data — RLS enforces this |
| Direct API abuse | All API routes require a valid Supabase session — anonymous auth satisfies this (confirmed: `apiAuth.ts` doesn't discriminate by auth method) |
| Demo data accumulation | Daily cron cleanup deletes expired demo user rows |
| Admin route exposure | Anonymous users pass `getAuthenticatedUserIdFromRequest` but fail `requireAdmin`'s `email_confirmed_at` check — verify this stays true if `requireAdmin` is ever refactored |

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/app/api/demo/session/route.ts` | New — creates anonymous session, checks IP rate limit, seeds demo data |
| `src/app/api/cron/cleanup-demo/route.ts` | New — deletes expired demo user data daily |
| `src/lib/demoSeed.ts` | New — function that inserts demo data for a given `user_id` into both `users` and `survey_responses` |
| `src/middleware.ts` | No change — anonymous auth sessions pass through normally (verified) |
| `src/app/api/chat/route.ts` | Modify — check `is_demo` flag, enforce 3-message cap, insert right after the existing auth check |
| `src/app/landing/page.tsx` | Modify — add "Try demo" button alongside existing Login / Join waitlist / Get Started CTAs |
| `src/types/database.ts` | Modify — add `is_demo` to the `User` type; add `demo_sessions` and `demo_usage` table types |
| `supabase/migrations/` | New migration — add `demo_sessions`, `demo_usage` tables; add `is_demo` column to `users` |

---

## Demo Seed Data

**Updated for the current product direction.** Noor's target has pivoted from "international students in the US/UK/CA" to "financial beginners / lowering the barrier to personal finance," particularly Gen Z (see `CLAUDE.md`). The original seed profile (F-1 visa, university-specific) reflects the legacy positioning and should not be used as the face of the demo. `has_ssn` / `has_itin` / `university` fields still exist in the schema and are harmless to fill in, but the *narrative* around the seed persona should target a general financial beginner, not a visa-holding student.

```
Profile:
  - has_ssn: false            (still a common "beginner" case — new to credit, no history yet)
  - has_itin: false
  - university: null          (leave unset — not central to the target persona anymore)
  - monthly_income: 2400
  - monthly_budget: 1900
  - preferred_language: English

Bank Account (fake):
  - name: Demo Checking
  - balance: $847.23
  - transactions: 15 sample entries (groceries, rent, subscriptions, streaming services)

Survey Responses (required — getRecommendations() reads survey_responses, not just users):
  - expected_monthly_spending: ~1900
  - international_transfer_frequency: none
  - avg_transfer_amount: 0
  - needs_zelle: true
  - fee_sensitivity: high
  - needs_nearby_branch: false

Recommendations:
  - Pre-scored list from bankRecommendation.ts using the demo profile above
  - Top picks should reflect a fee-sensitive, no-SSN-history beginner profile, not international-transfer-heavy picks
```

---

## Banner in Demo Mode

A persistent banner shows across all pages while in demo mode:

```
🔒 You're exploring a demo  ·  3 AI messages remaining  ·  [Join waitlist →]
```

- Updates message count in real time
- Disappears after user joins the waitlist

---

## Open Questions Before Implementation

- Should demo mode be gated behind a feature flag / env var so it can be disabled instantly if abused, similar to `AI_MEMORY_ENABLED` / `AI_SUPABASE_READ_ENABLED`?
- Rate limiting is being built from scratch (confirmed no existing utility) — should it live in a shared `src/lib/rateLimit.ts` so future features (e.g. password reset, signup) can reuse it, or stay inline in the demo route since it's the only consumer for now?
- `is_demo` on the user-accessible `users` table: per `CLAUDE.md`'s security principles, access-control-relevant flags belong on service-role-only tables (see `admin_users`). `is_demo` isn't an authorization flag, just a data-scoping one, but confirm it can't be abused client-side (e.g. a real user setting their own `is_demo` to escape rate limits or caps) before writing the migration.
