# Demo Mode

A one-click demo experience that lets visitors try the app instantly — no email, no password, no friction.

---

## User Journey

1. Visitor lands on `waitlist.noor.financial`
2. They see two buttons: **Join waitlist** and **Try demo**
3. They click **Try demo** — one click, no form
4. They're redirected to the dashboard, already logged in, with realistic fake data
5. They explore freely — bank recommendations, transactions, Noor AI chat (3 free messages)
6. When they hit the message limit or want more, they see: *"You're on the demo — join the waitlist for full access"*

Total time from landing page to inside the app: **under 2 seconds, one click.**

---

## What the Demo User Sees

| Area | Demo Content |
|------|-------------|
| Dashboard | Pre-filled profile (international student, no SSN, sample university) |
| Banking | Sample bank account with realistic transactions |
| Recommendations | Pre-generated bank recommendations based on demo profile |
| Noor AI Chat | Fully working — capped at 3 messages, then prompts to sign up |
| Settings | Viewable but saves are no-op or scoped to demo session |

---

## How It Works (Technical)

### Session Creation
- User clicks "Try demo" → hits `POST /api/demo/session`
- Route calls `supabase.auth.signInAnonymously()` — creates a real Supabase session, sets the auth cookie
- Route checks IP rate limit before creating the session (max 3 demo sessions per IP per hour)
- User is redirected to `/dashboard` — middleware sees a valid session, lets them through

### Demo Data
- A seed script populates a fixed set of demo data into the DB (bank accounts, transactions, recommendations, survey answers)
- Each new anonymous user gets their own copy of this data scoped to their `user_id`
- Data is deleted when the demo session expires (24 hours)

### Demo Flag
- Anonymous users get `is_demo: true` written to the `users` table on session creation
- Every API route that calls OpenRouter/AI checks this flag before proceeding
- After 3 AI messages (tracked in a `demo_usage` table), the chat API returns a soft block instead of calling the AI

### Rate Limiting
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
| Session flooding | IP rate limit on demo session creation (3/hour) |
| Real data exposure | Demo users only see their own seeded fake data — RLS enforces this |
| Direct API abuse | All API routes require a valid Supabase session — anonymous auth satisfies this |
| Demo data accumulation | Daily cron cleanup deletes expired demo user rows |

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/app/api/demo/session/route.ts` | New — creates anonymous session, checks IP rate limit, seeds demo data |
| `src/app/api/cron/cleanup-demo/route.ts` | New — deletes expired demo user data daily |
| `src/lib/demoSeed.ts` | New — function that inserts demo data for a given `user_id` |
| `src/middleware.ts` | No change — anonymous auth sessions pass through normally |
| `src/app/api/chat/route.ts` | Modify — check `is_demo` flag, enforce 3-message cap |
| `src/app/landing/page.tsx` | Modify — add "Try demo" button alongside "Join waitlist" |
| `src/types/database.ts` | Modify — add `demo_sessions` and `demo_usage` table types |
| `supabase/migrations/` | New migration — add `demo_sessions`, `demo_usage` tables; add `is_demo` column to `users` |

---

## Demo Seed Data

The seed should feel realistic for the target user (international student, no SSN):

```
Profile:
  - visa_type: F-1
  - university: University of Michigan
  - monthly_income: 1200
  - has_ssn: false
  - preferred_language: English

Bank Account (fake):
  - name: Demo Checking
  - balance: $847.23
  - transactions: 15 sample entries (groceries, rent, subscriptions)

Recommendations:
  - Pre-scored list from bankRecommendation.ts using the demo profile
  - Top picks: Discover, Chase, Bank of America (no SSN options)
```

---

## Banner in Demo Mode

A persistent banner shows across all pages while in demo mode:

```
🔒 You're exploring a demo  ·  3 AI messages remaining  ·  [Join waitlist →]
```

- Updates message count in real time
- Disappears after user joins the waitlist
