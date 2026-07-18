# Connection Management — Linked Banks, Remove, Add Another, Duplicate Detection

**Status:** Design proposal — NOT implemented. Decisions in §0 are locked (this document specifies them; it does not re-open them).
**Risk tier:** HIGH (includes a schema migration + connect/exchange pipeline change). Ships only with the two-layer review **plus** live verification — no exceptions (see §8).
**Related:** builds on `714f075` (DB-backed connection state) and references `docs/design/B-1-plaid-chat-capability-scaffold.md` for the chat-side Plaid boundary.

---

## 0. Scope

**Goal.** On the `/money` **accounts** tab, let a user with a bank already connected:
- see their **linked banks** (institution name + status),
- **Remove from NOOR** any one connection (row-level, inline confirm),
- **+ Add another bank**, and
- get a clear **"already connected"** notice when they re-link a bank they already have.

**Non-goals (explicitly out of scope this track):**
- **Plaid revoke** (`itemRemove`) on removal — Remove only deletes the DB row; copy stays honest ("Remove from NOOR"). Revoke is a roadmap item (§9).
- **hidden / visibility state** — rejected (see §0.1).
- **Backfilling `institution_id`** on existing rows — new connections only (§2, §3).
- **DB partial-unique index** on institution — roadmap, only after cleanup (§9).
- **Executing duplicate-row cleanup** — operator-run SQL, separate track (§10).
- **Chat memory handling** — disconnect blocks *live Plaid visibility*, not conversational memory (§6).

### 0.1 Rejected: hidden/visibility state
A per-connection "hidden but retained" state was considered and **rejected**: it creates a ghost state where bank rows persist (and chat could still read them) while the UI says "hidden," splitting the mental model. We keep a single axis — **connected = visible = chat-readable** — so `disconnect` = row delete = chat can no longer see it (§6).

---

## 1. Current state (grounded)

- `plaid_connections` stores `user_id, access_token, item_id, institution_name, status` — **no `institution_id`** (`supabase/migrations/20250318120000_plaid_connections.sql`; only later change is RLS in `20260604120000_drop_saved_banks_and_enable_rls.sql:50-75`). `UNIQUE(user_id, item_id)` exists but every fresh Plaid Link mints a new `item_id`, so it does not prevent same-bank duplicates.
- `exchange-token` **receives** `institutionId` from the client (`exchange-token/route.ts:27`) and echoes it back (`:64`) but **does not store it** (`storePlaidConnection(userId, access_token, item_id, institutionName)`, `:46-51`).
- Connection state is DB-backed since `714f075`: `usePlaidConnections` fetches `GET /api/plaid/connections`; `disconnect()` deletes the row then re-fetches. `money` gates data fetch on `hasActive` and renders the connect card via `shouldShowConnectCard`.
- `ConnectBankCard.handleSuccess` (`PlaidLink.tsx:163-236`) has **no user-facing error channel** — failures are `console.error` only (`:225-233`). This is why Add-another uses its own handler (§4), not `ConnectBankCard`.
- Chat reads Plaid **fresh every turn** (no cache): `getPlaidChatState` (direct DB query) and the legacy helpers `chat/route.ts:538/561` (live `/api/plaid/*` fetch).

---

## 2. Schema change

New migration file (timestamp after the latest `20260617120000`, dated today):

**`supabase/migrations/20260718120000_add_plaid_connections_institution_id.sql`**
```sql
-- Add institution_id to plaid_connections for app-level duplicate detection
-- (same user re-linking a bank they already have).
--
-- Nullable, no backfill: existing rows stay NULL and new connections populate
-- it going forward. Duplicate detection therefore only works between rows that
-- both have institution_id (i.e. connections created after this ships) — an
-- accepted limitation (see design §3, §5).
--
-- Deliberately NO unique index here. A partial unique index on
-- (user_id, institution_id) WHERE status='active' is a follow-up that can only
-- run AFTER existing duplicate rows are cleaned up, or index creation fails on
-- the existing duplicates (see §9 roadmap, §10 cleanup).
--
-- RLS is untouched: policies are column-agnostic (owner-only by user_id), so
-- adding a column needs no policy change.
alter table public.plaid_connections
  add column if not exists institution_id text;
```

**Applied manually by the operator in the Supabase SQL Editor** — the committed file is not live until then (CLAUDE.md). Backend code must tolerate `institution_id` being absent at runtime until the migration is applied (the insert simply omits/NULLs it; the detection query returns no matches → no false positives).

---

## 3. Backend changes

### 3.1 `storePlaidConnection` signature
Add a nullable `institutionId`:
```ts
export async function storePlaidConnection(
  userId: string,
  accessToken: string,
  itemId: string,
  institutionName: string,
  institutionId: string | null,   // NEW
)
```
Insert `institution_id: institutionId` alongside the existing columns (`plaidApiUtils.ts:108-138`). All existing callers must pass the new argument (only `exchange-token` calls it).

### 3.2 Duplicate detection in `exchange-token` (before exchange)
Flow in `exchange-token/route.ts`:
1. `authenticate(request)` (unchanged).
2. Read `publicToken`, `institutionId` (client, UX-only), `institutionName` (unchanged reads).
3. **NEW — pre-exchange duplicate check.** If `institutionId` is present, query for an existing active connection at the same institution for this user:
   - New helper `getActivePlaidConnectionByInstitution(userId, institutionId)` in `plaidApiUtils.ts` — `createServerClient().from("plaid_connections").select("item_id,institution_name").eq("user_id", userId).eq("institution_id", institutionId).eq("status","active").maybeSingle()` (or `.limit(1)`).
   - If a row exists → **skip the exchange entirely** (no `itemPublicTokenExchange` call ⇒ no new Plaid Item, no orphaned access_token) and return the duplicate response (below).
4. If no duplicate → `itemPublicTokenExchange({ public_token })` → `{ access_token, item_id }`.
5. **NEW — server-confirmed institution_id for storage.** `itemPublicTokenExchange` does **not** return `institution_id` (confirmed: `exchange-token/route.ts:43` reads only `access_token, item_id`; Plaid's response has no institution field). To store the *server's* value, call `plaidClient.itemGet({ access_token })` and read `itemResponse.data.item.institution_id` (the exact source `accounts/route.ts:54,82` already uses). Cost: **one added Plaid call** (~200-400ms) on the connect path only.
   - **Confirmed decision:** store the **server-confirmed** `institution_id` from `itemGet`; use the client-supplied `institutionId` **only** for detection (step 3). If `itemGet` fails or returns null `institution_id`, **fall back** to the client value for storage (best-effort; a null stored value just means that row won't participate in future detection — same as the no-backfill limitation).
   - **⚠️ Mixed provenance — do not treat `institution_id` as a fully trusted column.** Because of this fallback, a stored `institution_id` may come from either the server (`itemGet`, trusted) or the client (fallback, UX-grade) — and, per §2/§5, pre-existing rows are NULL. So the column's values are **heterogeneous in trust and completeness**. Any future consumer that assumes it is uniform/authoritative must account for this — in particular the **DB partial unique index in §9 must not be designed on the premise that every `institution_id` is a 100%-trusted server value** (a forged client fallback could, in the mixed period, collide or evade an index-based invariant for the user's own rows). The security invariant stays app-level + per-`user_id` scoping (§3.4), never this column.
6. `storePlaidConnection(userId, access_token, item_id, institutionName ?? "Unknown Institution", serverInstitutionId ?? clientInstitutionId ?? null)`.
7. Return success (unchanged shape).

### 3.3 Response schemas
- **Success (unchanged):** `200 { success: true, itemId, institutionId, institutionName, message }`.
- **Duplicate (NEW):** `409 { duplicate: true, code: "ALREADY_CONNECTED", institutionName, message: "This bank is already connected to your account." }`.
  - `409 Conflict` is chosen so the frontend can branch cleanly (`res.status === 409` or `payload.code === "ALREADY_CONNECTED"`) and show the notice instead of a generic error. No `success: true`/`false` ambiguity.
- **Failure (unchanged):** existing `4xx/5xx` via `handlePlaidError` / explicit 500.

### 3.4 Trust boundary (security invariant)
Client `institutionId` is a **UX-detection input only — never a security invariant.** If forged/omitted:
- Omitted → detection skipped → at worst a duplicate row is created (status quo; `714f075` keeps the app working with duplicates).
- Forged to match → the user only blocks *their own* new connection (self-inflicted, harmless).
- Forged to mismatch → a duplicate row for *their own* account.
No cross-user impact (every query is scoped by the verified-token `user_id`; RLS owner-only remains). The stored value is the **server-confirmed** `itemGet` value, so persisted data does not depend on client honesty.

---

## 4. Frontend changes (`money` accounts tab)

All on top of the `714f075` hook (`connections` from DB; `disconnect()` → re-fetch).

### 4.1 Linked banks list + Remove
- New section in the **accounts** tab (distinct from the per-account balance list — connections are per-*item*, accounts are per-*account*): map `plaidConnections.connections` → a row per connection showing `institutionName` + a `status` badge (`active` / needs-attention for `error`).
- **Remove from NOOR** button per row with **inline confirm** (a local `confirmingItemId` state; button → "Remove?" / Confirm + Cancel), then:
  ```
  await plaidConnections.disconnect(itemId)   // deletes row, hook re-fetches connections
  await fetchData()                            // REQUIRED: refresh balances/net worth
  ```
  - `fetchData()` is explicit because removing **one of several** banks leaves `hasActive` unchanged (`true`), so the `hasActive`-dependent fetch effect (`money:170-177`) does **not** re-run on its own.
- Copy: **"Remove from NOOR"** (honest — does not revoke at the bank; see §9).

### 4.2 + Add another bank
- Own handler mirroring the **relink** pattern (`money:386-393`): render `PlaidLinkButton` (it self-fetches a link token) with a custom `onSuccess(publicToken, metadata)` that:
  ```
  POST /api/plaid/exchange-token
    { publicToken, institutionId: metadata.institution.institution_id, institutionName: metadata.institution.name }
  ```
  - On `res.status === 409` (or `payload.code === "ALREADY_CONNECTED"`) → show inline notice **"This bank is already connected."** and do NOT treat as error.
  - On success → `handleBankConnected()` (existing: clears relink state + `plaidConnections.refetch()`), then `fetchData()` to pull the new bank's accounts.
  - On other non-ok → inline error notice.
- **Not** `ConnectBankCard` — it has no user-facing error/duplicate channel (`PlaidLink.tsx:225-233`); a dedicated handler gives us the 409/error surface.

### 4.3 State flow / transitions
- Add → exchange-token (dup-checked) → `refetch()` updates `connections` → `hasActive` recomputes → balances refresh.
- Remove (one of several) → `disconnect()` re-fetches connections; `fetchData()` refreshes balances.
- **Remove the last bank → natural transition (verified):** `connections` becomes empty → `hasActive` flips **true→false** → the fetch effect (`money:174`, dep `hasActive`) fires → `if(!hasActive){ setAccounts([]) }` (`:77-82`) → `metrics.netWorth = 0` (`:271`) and `shouldShowConnectCard` (`:255-260`) becomes true → connect card returns. No extra wiring for the last-bank case.
- **overview** tab's first-connect card: unchanged (`money:507`).

---

## 5. Accepted limitation — detection only between post-ship rows
Because we do not backfill (`§2`), rows created before this ships have `institution_id = NULL`. The detection query (`= institutionId`) never matches a NULL row, so:
- New-vs-new at the same institution → detected. ✅
- New-vs-old, or old-vs-old → **not** detected (may still create a duplicate). ⚠️ Accepted.
Time + the one-time cleanup (§10) drain the pre-existing NULL/duplicate rows; the follow-up unique index (§9) closes the gap permanently once cleanup is done.

---

## 6. Chat boundary (design decision, not a change)
- **What disconnect guarantees:** removing the row removes **live Plaid visibility**. Verified: `getPlaidChatState` and the legacy helpers (`chat/route.ts:538/561`) read `plaid_connections` / `/api/plaid/*` **fresh every turn** (no cache/storage) — so a removed bank is invisible to chat on the next turn.
- **What it does NOT do:** it does not erase **conversational memory**. If the user *volunteered* a bank in chat (e.g. "I have a Chase account"), `extract-facts` can persist that as a `banking` `user_fact` (`cron/extract-facts/route.ts:57,143`), and `chat_summaries` may reference it. Live balances/amounts are explicitly **not** extracted (`:158-159`). Remembering what the user *said* is legitimate behavior; forgetting it belongs to memory management (A-2 / future track), not to disconnect. **Out of scope here, documented so it is a conscious decision.**

---

## 7. Verification plan (sandbox; live behavior is the final gate)
1. Connect bank A → linked-banks list shows A (active).
2. **+ Add another bank** → bank B → list shows A + B; net worth = sum across both (not 404).
3. Re-select bank A via Add → **"already connected"** notice; row count does **not** increase; no new `item_id` in DB (exchange skipped).
4. **Remove** one of two → list + net worth update **immediately** (verifies the explicit `fetchData()` wiring for the `hasActive`-unchanged case).
5. **Remove the last** bank → net worth $0 + connect card returns (verifies the `hasActive` true→false transition).
6. After Remove, ask chat about that bank's balance → chat has **no live access** (verifies fresh-read boundary). (Note §6: chat may still *mention* a bank the user talked about — that is memory, not Plaid visibility.)
7. `SELECT institution_id FROM plaid_connections WHERE user_id='<sub>' ORDER BY created_at DESC` → new rows have a non-null server-confirmed `institution_id`; pre-existing rows remain NULL.

---

## 8. Risk & two-layer review focus
Migration + connect-pipeline change ⇒ **HIGH**. Two-layer review + live verification. Review focus:
- **Duplicate-detection fail direction:** on detection-query error, does exchange proceed (fail-open → possible duplicate, app still works) or block (fail-closed → user cannot connect)? Recommend **fail-open** (a duplicate row is the status-quo, non-breaking, outcome; blocking a legitimate connect is worse). Confirm the chosen direction is explicit in code.
- **RLS untouched:** adding a column must not alter `plaid_connections` policies (owner-only, `20260604120000`). Verify no policy/grant drift.
- **Exchange-skip path response integrity:** the 409 duplicate branch must return before `itemPublicTokenExchange` (no Item created) and the frontend must treat 409 as a notice, not an error/success.
- **`off`/existing behavior:** callers of `storePlaidConnection` all updated to the new signature; no other call site breaks.
- **Live verification** of the removal → chat-invisibility boundary (§7 #6), not just "the review passed."

---

## 9. Roadmap (follow-ups, not this track)
- **Remove permanently (revoke):** call Plaid `itemRemove` on removal so the bank-side Item/token is revoked, not just the DB row. Separate copy ("Remove permanently") + handles orphaned Items from past removals.
- **DB partial unique index** `(user_id, institution_id) WHERE status='active'` — enforce dedup at the DB level. **Order-dependent:** can only be created after duplicate rows are cleaned up (§10), or index creation fails on existing duplicates. **Do not assume `institution_id` is a uniformly trusted server value** when designing this index — see §3.2: values are mixed-provenance (server `itemGet` vs client fallback vs NULL for pre-ship rows).
- **Existing-row cleanup** — operator-run (§10).
- **Settings "Linked Banks" section** — a second home for connection management in `/settings` (requires wiring `usePlaidConnections` + userId there).

---

## 10. Reference — one-time cleanup SQL (operator-run, separate track)
Not executed by this track. Conservative approach: **keep the most recent row per `item_id`** is a no-op (item_id is already unique); the real duplication is *multiple item_ids per institution*. Since pre-existing rows have NULL `institution_id`, institution-based cleanup is only reliable **after** a manual review. Provided as a starting point only.

**READ-ONLY inspection first:**
```sql
-- Per-user duplication overview
select user_id,
       count(*) as total,
       count(*) filter (where status='active') as active_cnt,
       count(distinct item_id) as distinct_items,
       count(distinct institution_name) as distinct_inst_names
from plaid_connections
group by user_id
having count(*) filter (where status='active') > count(distinct institution_name);

-- Row detail for one user
select id, item_id, institution_name, institution_id, status, created_at
from plaid_connections
where user_id = '<user_id>'
order by created_at desc;
```
**Cleanup (review before running; keep newest active per institution_name as a heuristic):**
```sql
-- DELETE older duplicates, keeping the most recent active row per
-- (user_id, institution_name). Review the SELECT form first.
delete from plaid_connections p
using (
  select id,
         row_number() over (
           partition by user_id, institution_name
           order by (status='active') desc, created_at desc
         ) as rn
  from plaid_connections
) ranked
where p.id = ranked.id and ranked.rn > 1;
```
⚠️ Deleted rows' Plaid Items are **not** revoked here — hand off to the revoke roadmap item (§9). Balance/token implications: multiple access_tokens may be live for the same institution; deleting rows leaves those Items orphaned on Plaid until revoked.

---

## 11. File change inventory (when implemented)
| File | Change |
|---|---|
| `supabase/migrations/20260718120000_add_plaid_connections_institution_id.sql` | **NEW** — `ADD COLUMN institution_id text` (nullable) |
| `src/lib/plaidApiUtils.ts` | `storePlaidConnection` gains `institutionId` param; new `getActivePlaidConnectionByInstitution` helper |
| `src/app/api/plaid/exchange-token/route.ts` | pre-exchange duplicate check (409); `itemGet` for server institution_id; pass to `storePlaidConnection` |
| `src/app/money/page.tsx` | linked-banks list + Remove (inline confirm, `disconnect` → `fetchData`); +Add-another handler (PlaidLinkButton + exchange-token, 409 notice) |

No schema changes beyond the one column. `usePlaidConnections`, `/api/plaid/connections`, `/api/plaid/disconnect`, `ConnectBankCard`, chat paths, RLS: untouched.

---

*End of design. No code was modified. Implementation and commit follow review, per separate instruction.*
