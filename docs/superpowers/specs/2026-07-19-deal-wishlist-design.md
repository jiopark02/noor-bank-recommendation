# Wishlist Feature — "Pinterest-style" Deal Wishlist for Reward Accuracy

## Context

The client wants a way to know what deals/rewards a user actually wants, with higher
confidence than Plaid-transaction inference alone can provide. Plaid tells us what a
user *already* buys (correlation); it doesn't tell us what they *want* (intent). The
proposed fix: let users directly browse the existing Deals Hub catalog in a visual,
low-friction way and "pin" the brands/deals they're interested in — the way you'd pin
an image to a Pinterest board. Pinned items become first-party, high-confidence intent
signal, which we use immediately to boost those deals to the top of the user's Deals
Hub feed (an achievable, low-risk v1 of "more accurate rewards" — no new matching
engine, no change to the rules-based recommendation philosophy in `bankRecommendation.ts`).

Scope decisions already made with the user (via brainstorming):
- Content = existing Deals Hub catalog only for v1 (reuse `deals` table/brands), not a
  new general "lifestyle items" content library. Extensible later, but not built now.
- Structure = a single flat per-user wishlist (no named boards/collections).
- Save action = a brand-new "pin/save" affordance, kept separate from the existing
  public `upvotes` counter (upvote = "this deal is good," wishlist = "I personally want
  this" — conflating the two would undermine the accuracy goal that motivated this
  feature).
- Placement = a new first-class bottom-nav destination (`/wishlist`), grouped in the
  existing "Life" menu group next to Deals.
- Reward logic v1 = wishlisted deals are boosted to the top of the Deals Hub feed
  ordering. No new personalization/matching system; category-level signal into
  `bankRecommendation.ts`-style rules is an explicit **non-goal** for this iteration.

## Architecture

### Database: new `deal_wishlist` table

Copy the `recommendations_new` pattern (uuid FK, owner-only RLS, upsert-friendly unique
constraint) rather than the deleted `saved_banks`/`saved_apartments` shape (those were
dropped for shipping without RLS — do not repeat that mistake).

New migration file: `supabase/migrations/<timestamp>_create_deal_wishlist.sql`

```sql
create table if not exists public.deal_wishlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, deal_id)
);

create index if not exists deal_wishlist_user_id_idx on public.deal_wishlist(user_id);

alter table public.deal_wishlist enable row level security;

drop policy if exists deal_wishlist_select_own on public.deal_wishlist;
create policy deal_wishlist_select_own
  on public.deal_wishlist for select using (auth.uid() = user_id);

drop policy if exists deal_wishlist_insert_own on public.deal_wishlist;
create policy deal_wishlist_insert_own
  on public.deal_wishlist for insert with check (auth.uid() = user_id);

drop policy if exists deal_wishlist_delete_own on public.deal_wishlist;
create policy deal_wishlist_delete_own
  on public.deal_wishlist for delete using (auth.uid() = user_id);
```

No `update` policy needed — a wishlist item is either present or absent (pin/unpin =
insert/delete), matching the "toggle" UX, not an editable row.

**This migration is NOT auto-applied** (per CLAUDE.md) — file gets committed, operator
runs it manually in Supabase SQL Editor before the feature can work end-to-end.

### API: `src/app/api/wishlist/route.ts` (new file)

Follow the `api/recommendations/bank/route.ts` template exactly (`getAuthenticatedUserIdFromRequest`
→ 401 if null → `createServerClient()` → explicit `.eq('user_id', userId)` on every query).

- `GET` — returns the caller's wishlisted `deal_id`s (and optionally joins full deal
  rows via `.select('deal_id, deals(*)')` so the client doesn't need a second fetch).
- `POST` — body `{ dealId: string }`, upserts `{ user_id: userId, deal_id: dealId }`
  with `onConflict: 'user_id,deal_id'` (idempotent pin).
- `DELETE` — body or query `{ dealId: string }`, deletes the row matching
  `.eq('user_id', userId).eq('deal_id', dealId)` (unpin).

`dealId` must never be trusted beyond existence — no extra validation needed since the
FK constraint + RLS + user_id filter fully bound the write.

### Deals feed boost: `src/app/api/deals/route.ts` (edit existing)

Auth is optional today (route is public/unauthenticated) — for the boost to work,
the route needs to know the caller's wishlist when a token is present:

- Call `getAuthenticatedUserIdFromRequest(request)` — if present, fetch the user's
  wishlisted `deal_id`s in the same query pass (or a second small query), and sort the
  returned `deals` array so wishlisted ones come first, then existing ordering
  (`created_at desc`) as the tiebreaker.
- If no token (anonymous browsing), behavior is unchanged — no boost, same as today.
- This keeps `GET /api/deals` backward compatible; no breaking change to `useDeals` hook
  consumers who don't care about wishlist state.

### New hook: `src/hooks/useWishlist.ts`

Mirror `useDeals.ts`'s shape: `{ wishlistedIds: Set<string>, isLoading, toggle(dealId),
refetch() }`. `toggle` calls POST or DELETE on `/api/wishlist` optimistically (flip
local state immediately, roll back on request failure) so pinning feels instant.

### UI: new page `src/app/wishlist/page.tsx`

Reuses the Deals Hub's visual card language (from `src/app/deals/page.tsx`) but as a
Pinterest-like grid rather than a vertical list — this is the one deliberately new
visual pattern, since "browse and pin visually" is the actual client ask, not just "add
a save button to the existing list view."

- Grid of deal cards (2-column on mobile), each showing brand logo/name + category
  icon + a pin/save toggle button (heart or bookmark icon, distinct from the existing
  upvote chevron so the two signals stay visually separate).
- Filter chips reusing `DEAL_CATEGORIES` from `src/lib/dealsData.ts` (same categories,
  no new taxonomy).
- Toggling pin calls `useWishlist().toggle(dealId)`.
- Empty state message for a first-time user with zero pins, explaining what happens
  when they pin something ("we'll show you more of what you want").
- **Known gap to flag, not silently paper over:** `deals` mock data
  (`src/lib/dealsData.ts`) has no populated `logo_url`/image field today (only the
  `useDeals.ts`-side TS type has an optional `logo_url`, unused in the seed data). The
  v1 grid will render brand-initial/emoji-icon avatars (same `getCategoryIcon` fallback
  pattern already used in `deals/page.tsx`) rather than blocking on real logo images.
  Real per-brand images are a content task for the client/partnerships team, not a code
  task — call this out explicitly when demoing so it isn't mistaken for a bug.

### Nav wiring

- `src/components/layout/BottomNav.tsx`: add `{ href: "/wishlist", labelKey: "nav.wishlist", icon: WishlistIcon }`
  to the `life` array (~line 63), next to the existing `deals` entry. Add a new
  `WishlistIcon` component following the existing `IconProps`/svg pattern (e.g.
  `DealsIcon` at line 514).
- `src/components/search/SearchModal.tsx`: add a `page-wishlist` entry to
  `SEARCHABLE_ITEMS` (~line 45), matching the existing `page-deals` entry's shape.
- i18n: add `"wishlist": "Wishlist"` under the `"nav"` key in all 12 locale files under
  `messages/` (en, ko, ja, zh-CN, zh-TW, it, es, fr, de, pt, hi, ar). Missing a locale
  degrades gracefully (raw key shown) but shouldn't be left half-done. Add a
  page-level `"wishlist": { ... }` block (title/empty-state copy) to at least
  `messages/en.json`, matching the existing `"deals": { "title": ... }` block shape;
  other locales can follow in a translation pass.
- No middleware change needed — `src/middleware.ts` (currently mid-edit on this branch)
  already uses a catch-all matcher that covers any new route automatically.

## Explicitly out of scope for this iteration

- Multiple named boards/collections (single flat wishlist only).
- Non-deal wishlist content (general "things I want" beyond the deals catalog).
- Feeding wishlist signal into `bankRecommendation.ts`'s rules-based scoring, or any
  new category-level personalization engine.
- Real per-brand logo/image assets — content/asset work for the client, not this build.
- Reusing or modifying the existing `upvotes` mechanic.

## Verification

No local build is possible (per CLAUDE.md hard constraint) — verification is Vercel
preview deploy only, plus manual application of the migration in Supabase SQL Editor
(operator does this, not auto-applied). Once both are live:

1. Apply `deal_wishlist` migration in Supabase SQL Editor.
2. On the Vercel preview URL, log in, go to `/wishlist`, pin 2-3 deals, confirm the
   toggle persists across a page reload (proves the DB round-trip, not just local
   state).
3. Visit `/deals` and confirm the pinned deals now sort to the top of the feed.
4. **Live security check** (per CLAUDE.md working agreement — required for anything
   touching RLS/auth, not just "looks right"): `set local role authenticated;` in the
   Supabase SQL Editor, attempt to `select`/`insert`/`delete` a `deal_wishlist` row
   using a different user's `user_id` than the session's `auth.uid()` — expect `42501`
   / zero rows, confirming RLS is actually enforced and not just present in the
   migration file.
5. Confirm anonymous (logged-out) browsing of `/deals` still works unaffected (no
   wishlist boost, no error) — this route must remain public.
