# Plan: Plaid Sandbox Integration with Supabase (Fixed)

## TL;DR

Implement Plaid sandbox account linking with real-time transaction display. The frontend UI already exists; you need to: (1) add Plaid credentials to `.env.local`, (2) create minimal `plaid_connections` table for storing access tokens with a `status` column, (3) secure API endpoints that fetch live data from Plaid — always extracting `user_id` from the server-side session, never from client params, and (4) wire frontend to display real-time accounts and transactions with proper error and re-link handling.

---

## Steps

### Phase 1: Environment & Credentials Setup

1. **Add Plaid credentials to `.env.local`**

   - Set `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox`
   - Set `PLAID_REDIRECT_URI=http://localhost:3000/money` — **only required for OAuth-based institutions** (e.g. Chase). Not needed for most sandbox test banks.

2. **Verify Plaid API client**
   - Check `src/lib/plaid.ts` — already configured for sandbox with all required products (Transactions, Auth, Identity, Liabilities)

---

### Phase 2: Database Schema Setup (Supabase)

3. **Create migration: `20250318120000_plaid_connections.sql`** with 1 table:

   - `plaid_connections` — stores access tokens only:
     - `user_id` — links to your auth user
     - `access_token` — Plaid access token (store securely, never expose to client)
     - `item_id` — Plaid item identifier
     - `institution_name` — display name of connected bank
     - `status` — `'active' | 'error'` to track broken/expired connections
     - `created_at`

   > ⚠️ **Use an actual timestamp in the filename** (e.g. `20250318120000_plaid_connections.sql`), otherwise Supabase CLI won't run it correctly.

4. **Run migration in Supabase**
   - Creates table with index on `user_id` for fast lookups

---

### Phase 3: Backend API Security

> 🔒 **Critical Rule for ALL endpoints:** Never trust `user_id` from the client (query params, request body, or headers). Always extract `user_id` from the authenticated server-side session (JWT/cookie). This applies to every endpoint below.

5. **Secure `/api/plaid/create-link-token` endpoint** (`src/app/api/plaid/create-link-token/route.ts`)

   - Authenticate request — verify JWT/session server-side
   - Extract `user_id` from session (not from request)
   - Call Plaid API with `user_id` as `client_user_id`
   - Return `link_token` to frontend

6. **Secure `/api/plaid/exchange-token` endpoint** (`src/app/api/plaid/exchange-token/route.ts`)

   - Authenticate request — extract `user_id` from session
   - Exchange `public_token` for `access_token`
   - **Store `access_token` in `plaid_connections` table** with `status: 'active'` — never return it to the client
   - Return only safe connection metadata (institution name, item_id) to frontend

7. **Add `/api/plaid/disconnect` endpoint** (`src/app/api/plaid/disconnect/route.ts`) ← **NEW**

   - Authenticate request — extract `user_id` from session
   - Accept `item_id` from request body
   - Call Plaid `/item/remove` to revoke the token on Plaid's side
   - Delete the matching row from `plaid_connections` table
   - Return success to frontend

   > ⚠️ Do NOT handle disconnect logic inside `exchange-token` — that endpoint is only for connecting banks.

8. **Add `/api/plaid/relink` endpoint** (`src/app/api/plaid/relink/route.ts`) ← **NEW**

   - Handles the `ITEM_LOGIN_REQUIRED` re-authentication flow
   - Authenticate request — extract `user_id` from session
   - Accept `item_id` from request body
   - Generate a new `link_token` using the existing `access_token` (update mode)
   - Update `plaid_connections` status back to `'active'` after successful re-link
   - Return new `link_token` to frontend for Plaid Link to reopen

9. **Refactor `/api/plaid/accounts` endpoint** (`src/app/api/plaid/accounts/route.ts`)

   - Authenticate — extract `user_id` from session
   - Retrieve `access_token` from `plaid_connections` table using `user_id`
   - Check `status` — if `'error'`, return a specific error code so frontend can prompt re-link
   - Call Plaid API to fetch accounts (real-time)
   - If Plaid returns `ITEM_LOGIN_REQUIRED`, update `status` to `'error'` in DB and return error to frontend
   - Return accounts to frontend

10. **Refactor `/api/plaid/transactions` endpoint** (`src/app/api/plaid/transactions/route.ts`)

    - Accept query params: `startDate`, `endDate` (for configurable range) — **no `userId` param**
    - Authenticate — extract `user_id` from session server-side
    - Retrieve `access_token` from `plaid_connections` table using `user_id`
    - Check `status` — if `'error'`, return error code for re-link prompt
    - Call Plaid API with date range (real-time)
    - Detect subscriptions using existing subscription patterns in `src/lib/plaid.ts`
    - If Plaid returns `ITEM_LOGIN_REQUIRED`, update `status` to `'error'` in DB
    - Return transactions and subscriptions to frontend

---

### Phase 4: Frontend Integration

11. **Update Money page** (`src/app/money/page.tsx`)

    - Replace demo data with calls to `/api/plaid/accounts` and `/api/plaid/transactions`
    - Add date range picker for transaction filtering (start/end dates)
    - Add "Connect Bank" button that uses existing `PlaidLinkButton` component
    - Fetch accounts and transactions on page load and when user changes date range
    - Handle `ITEM_LOGIN_REQUIRED` error state — show a "Re-link your bank" CTA instead of broken data

12. **Add account connection state management**

    - Create hook `src/hooks/usePlaidConnections.ts`:
      - Checks if user has any `plaid_connections` records with `status: 'active'`
      - Returns connected institutions
      - Provides `connect` method (opens Plaid Link)
      - Provides `disconnect` method (calls `/api/plaid/disconnect`)
      - Provides `relink` method (calls `/api/plaid/relink`, then reopens Plaid Link in update mode)
    - Use in Money page to show "Connect Bank" CTA if no active connections exist

13. **Enhance `/money` page UX**
    - Show loading states while fetching from Plaid (real-time calls)
    - Display error messages if Plaid API fails or returns an error
    - Show a **"Re-link your bank"** banner when `status === 'error'` on any connection
    - Add date range picker for flexible transaction viewing
    - Fetch fresh data when date range changes
    - Add error boundaries to prevent full page crash if one Plaid call fails

---

### Phase 5: Testing & Deployment

14. **Manual testing in Plaid Sandbox**

    - Connect test account using Plaid's test credentials:
      - Username: `user_good` / Password: `pass_good` / 2FA: `1234`
    - Verify accounts appear in `/money` page with real-time balance
    - Verify transactions load with correct merchant/category icons
    - Verify subscriptions are detected from transaction patterns
    - Test date range filtering
    - Test disconnect — verify token removed from DB and Plaid
    - Test re-link flow — simulate `ITEM_LOGIN_REQUIRED` and verify banner + re-auth works
    - Connect a second bank — verify both appear in accounts list
    - Verify data is fresh (not cached)

15. **Verify real-time data flow**

    - Access token stored in `plaid_connections` table ✓
    - `user_id` always from server-side session, never from client ✓
    - Accounts fetched live from Plaid API ✓
    - Transactions fetched live from Plaid API ✓
    - Subscriptions detected on-demand from transactions ✓
    - Broken connections flagged with `status: 'error'` ✓
    - Re-link flow handles `ITEM_LOGIN_REQUIRED` gracefully ✓

16. **Prepare for production**
    - Move Plaid credentials to Vercel/hosting environment variables
    - Update `PLAID_ENV` to `production` when ready
    - Update `PLAID_REDIRECT_URI` to production URL (only if using OAuth institutions)
    - Monitor Plaid API usage and set up alerts if needed

---

## Relevant Files

| File | Notes |
|------|-------|
| `src/lib/plaid.ts` | Plaid API client — already configured, no changes needed |
| `src/app/money/page.tsx` | Remove demo data, call real APIs, add re-link error state |
| `src/app/api/plaid/create-link-token/route.ts` | Secure — user_id from session |
| `src/app/api/plaid/exchange-token/route.ts` | Secure — stores token, returns metadata only |
| `src/app/api/plaid/disconnect/route.ts` | **NEW** — calls /item/remove, deletes DB row |
| `src/app/api/plaid/relink/route.ts` | **NEW** — handles ITEM_LOGIN_REQUIRED re-auth |
| `src/app/api/plaid/accounts/route.ts` | Refactor — user_id from session, status check |
| `src/app/api/plaid/transactions/route.ts` | Refactor — user_id from session, no userId param |
| `src/hooks/usePlaidConnections.ts` | **NEW** — connect, disconnect, relink methods |
| `src/components/plaid/PlaidLinkButton.tsx` | Already exists — reuse as-is |
| `.env.local` | Add Plaid credentials |
| `supabase/migrations/20250318120000_plaid_connections.sql` | **NEW** — access token storage with status column |

---

## Verification

1. ✅ Plaid Link opens successfully with sandbox credentials
2. ✅ Test bank account connects and stores access token in `plaid_connections` with `status: 'active'`
3. ✅ Accounts display in `/money` page with real-time balance
4. ✅ Transactions display with correct merchant and category icons
5. ✅ Subscriptions are detected and shown in Subscriptions tab
6. ✅ Date range picker filters transactions from Plaid API
7. ✅ Disconnect removes token from DB and revokes on Plaid
8. ✅ Re-link flow works when `ITEM_LOGIN_REQUIRED` is triggered
9. ✅ Connect second bank account — both appear in accounts list
10. ✅ `user_id` is never accepted from client — always from server session
11. ✅ Page always shows fresh data (no stale cache)

---

## Decisions

- **Minimal database** — only `plaid_connections` table for access tokens + status (avoid caching complexity)
- **Real-time data** — accounts and transactions fetched fresh from Plaid API on each request
- **Per-user accounts** — each authenticated user has isolated Plaid connections
- **`user_id` always server-side** — never trusted from client request params or body
- **`status` column** — tracks active vs broken connections without extra tables
- **Dedicated disconnect endpoint** — clean separation from exchange-token
- **Re-link endpoint** — graceful handling of expired bank sessions
- **Subscription detection** — leverages existing merchant patterns in plaid.ts, detected on-the-fly
- **Sandbox environment** — production switch is a config change later

---

## Further Considerations

1. **Caching layer** — If Plaid API calls become expensive, add Redis caching with 5–15 min TTL
2. **Webhook sync** — Future enhancement for production: use Plaid webhooks to proactively detect `ITEM_LOGIN_REQUIRED` and update `status` to `'error'` automatically
3. **Rate limiting** — Consider adding rate limits to API endpoints if multiple users access frequently
4. **Multiple institutions** — Plan supports this; no code changes needed, just UX polish for selecting which bank to view
5. **Error boundaries** — Wrap Plaid data sections in React error boundaries to prevent full page crash on API failure