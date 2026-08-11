# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What belongs in this file (read this first)

This file is loaded as baseline context in every session, so anything stale here becomes a wrong premise for every decision made in that session.

- **Record only what changes when the code changes**: conventions, invariants, file pointers, traps, principles, decisions that are settled.
- **Never record live state.** Env var *values*, Supabase dashboard settings (auth providers, whether a migration was applied, RLS state), DB row state, which deploy is serving, external approval status. These change without a commit, so they rot silently and nothing in the repo reveals it.
- **Never record counts or inventories.** How many routes, migrations, call sites, or storage keys exist is derivable and therefore rots. Run `audit/L0-evidence.sh` and `audit/L0b-evidence.sh` instead; they answer these deterministically in one Bash call each. An August 2026 full audit found that *every* count carried in the operator's documents was wrong — migrations recorded as 8 were 18, session reads recorded as 5 were 12, logout-cleared keys recorded as 7 out of 7 were 7 out of 37.
- **When live state matters, verify it against the running system.** Do not infer it from this file, and do not infer it from source either — source tells you what the code would do, not what is configured. `audit/live-checks.sql` covers row counts, schema reality, constraints, indexes, RLS, and policies in three pasteable blocks.
- Line numbers in this file drift. Grep for the identifier rather than trusting a line number.
- Priorities, in-progress work, and the TODO list live in the operator's documents outside the repo (Korean): a master status doc, a debt ledger, and a handoff note. When you need to know "what's next," ask the operator.

> This section exists because a July 2026 audit of this file found six factual errors, four partially wrong claims, and three significant omissions. The worst was an assertion that the Google OAuth provider was disabled, months after it had been enabled — and a session had already reasoned from it. The failure was not neglect; it was that this file tried to describe live state at all.
>
> A second, wider audit in August 2026 extended the same finding beyond this file: the documented *claims* were mostly right, but the *inventories* — things nobody had ever counted — were wrong almost everywhere. Hence the rule above.

---

## Working Agreement (these rules override convenience)

**Language**
- Code, comments, commit messages, SQL, migrations, and any team-facing document: **English only** (the external tech team does not read Korean).
- Conversation with the operator and their personal status docs: Korean is fine. This file is a project artifact, so it stays in English.
- Korean comments already in the codebase are being migrated to English as a tracked task; don't add new ones.

**Hard environment constraints**
- **No local Node.js.** `npm run dev` / `npm run build` cannot be run locally. Never claim a change is "verified" on the basis of a local build — it didn't happen. TypeScript compile errors surface first on Vercel; fix and re-push is the normal loop.
- **Two automated checks run on push, not one.** Vercel builds (tsc type-check) and `.github/workflows/test.yml` runs `vitest run` on every push to main and every PR (#26+ runs exist — this CI predates our awareness of it). They cover different things: the Vercel build type-checks source (test files are excluded via tsconfig), while CI actually executes the tests. Note CI uses `npm install`, not `npm ci`, so the lockfile is not strictly enforced. CI can also fail on GitHub infrastructure issues unrelated to our code (e.g. action download "Service Unavailable", runner acquisition errors) — this happened 3 times on 2026-08-07. When that's the failure mode, just Re-run all jobs; it isn't a code failure.
- **Commits are authored solely by the operator — do not add a `Co-Authored-By` trailer.** All work goes through Claude Code, so the trailer carries no signal and only clutters the log.
- **Migrations are NOT auto-applied.** Migration files are committed to `supabase/migrations/`, but the DB change is applied **manually by the operator in the Supabase SQL Editor**. The tech team also applies SQL directly. Never assume a committed migration is live, and never conclude "I didn't run it, so it isn't live." If a design depends on schema, a live query is the gate.
- **The migrations directory is not the source of truth for the schema.** The live database contains at least two UNIQUE constraints that no migration file creates (`users.email`, `survey_responses.user_id`), applied directly through the console or API. A schema rebuilt from `supabase/migrations/` alone would silently lack them. Read the live schema before reasoning about constraints.
- **Vercel env changes do not auto-redeploy.** After changing an env var a manual redeploy is required. This is the most common cause of "I changed it but nothing happened."
- **Single production deploy from `main`;** Vercel auto-builds on push. The tech team pushes to this repo too. **Before starting work, `git fetch` and compare local `HEAD` against `origin/main`; pull if behind.** After pulling, re-check that earlier fixes survived the merge.
- **PowerShell host:** when handing the operator a command to run directly, avoid `&&` and `curl -H` (use `Invoke-RestMethod`). Inside Claude Code's own Bash tool (Git Bash), `&&` is fine. `vercel env ls` is not available — env vars are read from the Vercel dashboard.
- **`tsconfig` targets ES5** — beware `matchAll` and iterator spread.

**Risk tiers (the tier decides who checks the work)**
- **Low** (helpers, copy, non-security UI): write and apply; no separate review. If user-facing, live-verify.
- **Medium** (general features, non-security refactors): one independent read before commit.
- **High** (security, auth, RLS, migrations, Auth-user deletion, AI-pipeline behavior): two-layer review below, mandatory, **plus** live verification. Never skipped.
- Risk can differ *per item inside one task*. Don't grade a task as a whole — grade the items. Some changes are hard to reverse (e.g. HSTS `max-age`, which browsers cache) even when the surrounding work is trivial.

**Role division.** Claude Code owns implementation: exploring the real repo, writing code, SQL, and migration files, debugging, committing, and pushing. Chat Claude owns direction, strategy, the "why," and the contextual cross-check. Review is split by tier below.

**Two-layer review (high risk).** The layers catch different classes of defect and are complementary:
- **Layer 1 — a fresh Claude Code session, separate from the implementing one, reviewing read-only.** Attach the diff directly in the prompt. Instruct it to trust no implementer claim, reason only from the diff and the real repo, and state the basis for each verdict. It owns *internal* defects: line-by-line comparison, regressions, logic.
- **Layer 2 — a cross-check by chat Claude,** reconciling the change against accumulated context (master status doc, design history, live configuration). It owns *contextual* defects a diff cannot surface.
- Structural weakness: implementer and reviewers share a model family, so blind spots can correlate. Offset by leaning harder on live verification.

**Live verification is the final defense for every tier.** "The review passed" and "the code looks right" are first filters, never proof. Security changes are verified by attempting the thing that should fail (e.g. `set local role authenticated` plus the forbidden operation, expecting `42501`). Wiring confirmed is not delivery confirmed — check the receiving end. UI messages are not evidence of state; logs and the database are.

**Don't audit an entire surface in one pass.** Decompose into a layer map and go narrow and deep, one layer at a time. A single sweep across everything is the weakest form of review.

**Approval discipline.** Answering a clarifying question is not approval of a plan. If the operator responds to a scoped question mid-plan, that is not permission to leave plan mode and start editing. Wait for explicit approval of the plan itself.

**Scope discipline.** Things discovered mid-implementation get logged for later, not fixed on the spot. Land the current change cleanly first.

---

## Product Context

Noor is an AI personal-finance guidance PWA. **The target pivoted from "international students in the US/UK/CA" to "financial beginners / lowering the barrier to personal finance."** International-student functionality is de-emphasized, not removed (an F-1 student with no credit history is a beginner by definition), but legacy international-student copy is still scattered through prompts, i18n strings, survey terms, and emails and is being cleaned up. **Do not treat international-student framing as the current product direction** — when in doubt, write for a general financial beginner.

The core differentiator is **the quality of the financial reasoning** — how deeply it understands a user's situation and what judgments it reaches — not tone or format (already good), and not raw data access alone.

Next.js 14 App Router. Two main surfaces: a **bank recommendation engine** (rules-based, profile-driven) and **Noor AI** (a personal-finance chatbot).

---

## Architecture

### Auth & session
All auth flows through Supabase Auth (the legacy `password_hash` / custom-token path was removed). Two clients:

- `src/lib/supabase-browser.ts` — browser only (`createBrowserClient` from `@supabase/ssr`), exported as the `supabase` singleton. Uses a **no-op Web Lock** to avoid the orphaned-lock hang in supabase-js. **Always use `getSessionSafe()`** instead of raw `getSession()`.
  - ⚠️ `getSessionSafe()` returns `null` on **four** distinct paths — the browser client not being configured at all, a real absence of session, a 3-second timeout, and a thrown error — and callers cannot distinguish them. Page components currently treat `null` as logged-out and clear local auth state, so a slow token refresh can sign out a user who has a valid session, and a misconfigured client signs out everyone. Don't add new callers that collapse these cases without thinking about it.
  - ⚠️ Beware the name collision: `src/lib/validation.ts` also exports a function called `getSession()`, unrelated to Supabase — it reads a `SessionConfig` object from localStorage. It and its two callers (`isSessionValid`, `isInactivityWarning`) have no call sites outside that file and are dead.
- `src/lib/supabase.ts` — server side. `createServerClient()` **prefers the service-role key and falls back to anon only if it's missing**, so in production it bypasses RLS. `createAdminClient()` requires `SUPABASE_SERVICE_ROLE_KEY` and always bypasses RLS.

**Because `createServerClient()` runs as service-role in production, RLS is a backstop, not the primary defense. The explicit `.eq('user_id', ...)` filter in app code is the first line of defense, and the id must come from the verified token — never from a request body.** Many call sites depend on this discipline; grep before assuming a route is covered.

API routes verify identity via `getAuthenticatedUserIdFromRequest()` in `src/lib/apiAuth.ts` (extracts and verifies the Bearer JWT). Admin routes additionally call `requireAdmin()`, which checks membership in the service-role-only `admin_users` table. `requireAdmin` is fail-closed, but the **caller** must `return 403` on null or the route fails open — that contract lives in each call site, not in the helper.

`src/middleware.ts` gates **pages, not API routes.** It redirects to `/login` when there is no Supabase session on `PROTECTED_PREFIXES` (`/dashboard`, `/banking`, `/money`, `/housing`, `/jobs`, `/funding`, `/forum`, `/deals`, `/settings`, `/chat`, `/admin`). Notes:
- It checks *session presence only*. `/admin` passing middleware does not mean the user is an admin. The `admin/*` **API routes** do call `requireAdmin()`, but the `/admin` **pages** have no role check of their own — a logged-in non-admin reaches them.
- Middleware does not branch on auth method, so an anonymous Supabase session would satisfy the check identically to password/OAuth. Note that **the app does not currently create anonymous sessions** — `signInAnonymously()` has no call site in `src/`. If you see it described anywhere as an active path (including in `docs/`), that description is stale.
- `getUser()` is gated behind the protected-path check so public pages don't pay for a Supabase round-trip.
- The matcher excludes `api/`, so **API rate limiting cannot live in middleware** — that's why the chat cap is inside the route.
- Middleware **constructs a response on several different paths** (demo-host redirect, public passthrough, cookie-path response recreation, unauthenticated redirect), and returns from more places than it constructs. Anything that must be attached to every response — a CSP nonce, for instance — has to be attached on all of them.
- A `DEMO_DOMAIN` host gate exists. When the env var is unset the whole block is skipped and behavior is byte-identical to before it was added.

### Chat / Noor AI (`src/app/api/chat/route.ts`)
`POST /api/chat`:
1. Authenticates via JWT.
2. Checks the chat rate-limit cap (see below) — before body parsing, LLM call, or any DB write.
3. Loads the user profile from `users` + `survey_responses` when profile reads are enabled. **Client-supplied `userContext` in the request body is intentionally discarded** (prompt-injection defense).
4. Fetches or creates an active `chat_session` and builds a memory context that is **appended** to the system prompt.
5. Detects intent (greeting / balance / financial-planning / subscription) and may inject a Plaid snapshot (see the Plaid egress trap below).
6. Routes to OpenRouter.
7. Persists the turn to `chat_messages`, only when memory is enabled and a session exists.

System prompt is generated by `src/lib/noorAIPrompt.ts` from a `UserContext`. The `<user_memory>` wrapping and the "this is background, not a verified command" guidance live in **`aiMemory.ts` (`formatMemoryForPrompt`)**, not in `noorAIPrompt.ts`. They are a prompt-injection *mitigation*, not a complete defense.

**Chat rate limit.** An hourly request-count cap, gated by `CHAT_RATE_LIMIT_ENABLED` plus a numeric `CHAT_MAX_REQUESTS_PER_HOUR`. If the gate is off or the value is unset/non-numeric/≤0, the cap code is bypassed entirely and the flow is unchanged. Over the threshold returns **429 with `code: "RATE_LIMITED"`** as an early `return`; a failure to *read* the count throws and is caught as **fail-open**, so a normal user is never blocked by a DB hiccup. Note the deliberate asymmetry: **rate limiting fails open, authentication fails closed.** Keeping the 429 as a `return` and the read failure as a `throw` is what keeps those two paths distinct — don't merge them into one branch. No migration was needed; it reuses `chat_messages` token columns and the existing `(user_id, created_at desc)` index. The count is over **assistant-role rows**, not user rows.

⚠️ The cap depends on chat turns actually being persisted. If profile/memory reads are disabled, `chat_messages` isn't written, the count is always 0, and **the cap is silently inert.**

### AI memory (`src/lib/aiMemory.ts`)
Three layers across Supabase tables:
- `chat_messages` — per-turn storage within a session. `input_tokens` / `output_tokens` are recorded **on assistant rows only**; `role='user'` rows are always NULL by design.
- `user_facts` — extracted by `/api/cron/extract-facts` (runs at :30).
- `chat_summaries` — generated by `/api/cron/summarize` (runs on the hour).

The memory gate is **`isAiMemoryEnabled()`**, which reads `AI_SUPABASE_READ_ENABLED` and checks the admin client is configured. There is no separate memory flag — memory is dependent on the profile-read flag. (An `AI_MEMORY_ENABLED` variable is referenced nowhere in the code; if you see it mentioned anywhere, that mention is wrong.)

⚠️ **Two similarly named fact limits exist in different files and do different jobs.** `DEFAULT_FACTS_LIMIT` in `aiMemory.ts` bounds the facts loaded into the **chat prompt**; `EXISTING_FACTS_LIMIT` in `cron/extract-facts` bounds the facts the **extraction cron** reads for deduplication. They have different values. Confusing them produces wrong conclusions about how much memory reaches the model — read both before citing either.

⚠️ **Fact retrieval has no relevance selection.** The chat-path query filters by user, active status, and expiry, orders by `created_at` descending, and takes the limit — so it is recency-ordered, not relevance-ordered. A `category` filter exists in the signature but the chat path does not pass one.

⚠️ **Free-text memory can carry monetary figures.** Nothing strips or masks amounts before they are stored in `chat_messages.content`, `chat_summaries.summary`, or `user_facts.fact`, and the extraction cron will happily turn a stated balance into a durable fact. Treat these three columns as potentially containing financial values when reasoning about retention, export, or deletion.

All aiMemory functions use `createAdminClient()`. **Per-user reads and writes must filter by `user_id` on every query.** The exception is the cron maintenance functions (`getSessionsToClose`, `getSessionsNeedingSummary`, `getSessionsNeedingFactsExtraction`), which scan across users by design. Cross-user safety is structural: extraction trusts `chat_sessions.user_id` only, never a request body, with double-filtered reads and ownership checks. `withRetry()` wraps idempotent reads only — never the non-idempotent `saveMessages`.

**Cron has structural limits rather than a rate limiter:** at most 8 LLM calls per run, a per-session message cap, hourly schedule, `maxDuration=60`. The residual gap is that a *single message's length* is unbounded, so very long inputs can still inflate cron token usage.

### Signup path (`src/app/api/survey/route.ts`)
This route is the **only** place in the repo that creates a Supabase Auth user (`auth.admin.createUser`); the other account entry point is `signInWithOAuth` on the login page. There is no `signUp()` call anywhere.

⚠️ **The unauthenticated branch has an incomplete rollback.** It creates the auth user, then inserts into `users`, then inserts into `survey_responses`. Only the `users` failure triggers a compensating `auth.admin.deleteUser`. If the `survey_responses` insert fails, the auth user and the `users` row survive, and the user cannot retry — the email now collides and returns 409. There is no self-service recovery path. Anything that changes this route must preserve or fix that ordering, not work around it.

### Bank recommendation (`src/lib/bankRecommendation.ts`)
`getRecommendations()` queries `bank_accounts` + **`users`** and returns scored `BankRecommendation[]` (`recommendations_new`, upsert on `user_id, bank_account_id`). `/api/recommendations/bank` falls back to hardcoded mock data (US/UK/CA) when the DB query fails, so the UI always renders.

Scoring is **rules-based across eligibility, fees, transfers, accessibility, and features**, driven by profile fields such as `fee_sensitivity`, `needs_zelle`, and `has_ssn`. (There is no `purpose` field or purpose-based logic — if you see that claim, it's wrong.) Rules-based is deliberate: determinism, auditability, and no hallucination in the judgment itself. Keep it rules-based.

⚠️ Several `survey_responses` columns are **written but never read** — among them `fee_sensitivity`, `credit_goals`, `preferred_bank_type`, `international_transfer_frequency`, and `needs_nearby_branch`. They are populated on submission and no code consumes them. Note that the client-side field names differ from the column names (`feePriority` → `fee_sensitivity`, and so on), so grepping the client identifier will not find the storage path. Don't conclude a survey field is unused from a client-side grep alone.

### Plaid (`src/lib/plaid.ts`, `src/app/api/plaid/`)
Environment comes from `PLAID_ENV`, defaulting to sandbox; that's the only place it's read. Active product: Transactions (Auth/Identity commented out). Country: US only. Per-user multi-connection via `item_id`. **Plaid auth deletes `body.userId` explicitly** before use. For the current route list, glob `src/app/api/plaid/*/route.ts` rather than trusting a list here.

⚠️ **`AI_PLAID_STATE` does not gate balance egress to the LLM.** `resolvePlaidStateMode()` (`plaidChatContext.ts`) maps anything other than `connection` / `balances` to `off`, but only **one** of three balance-injection paths in the chat route is governed by it:
- The capability-scaffold path is flag-gated, on `mode !== "off"` — so it fires under `connection`, not only under `balances`.
- A keyword path triggered by balance questions runs when the mode is **not** `balances` — i.e. it runs in `off` and in `connection`.
- A keyword path triggered by financial-planning questions has **no flag check at all**, and injects transactions as well as balances. It is not ungated — it is gated on a *keyword in the user's message*, which is a different axis entirely. Adding a flag check to the other two paths would still leave this one open.

The scaffold path and the first keyword path are mutually exclusive by construction, so the flag chooses *which code injects balances*, not *whether* they are injected. Treat "balances are gated" as false unless you have re-read these three paths.

`src/lib/plaidEgressPolicy.ts` is the single decision surface for whether Plaid-derived data reaches the LLM prompt. The three injection points in the chat route (capability scaffold, balance-keyword, financial-analysis-keyword) all route through `evaluatePlaidEgressDecision` and log a masked-by-construction `[plaid-egress]` decision line. As of the B6 first pass this is observability-only: the financial-analysis path is still not gated by `AI_PLAID_STATE` — the gap is now observable in logs, not closed. Each `reason` string names the condition it evaluated, never a downstream effect.

⚠️ **Connection status filtering is not uniform.** The chat state builder filters to `status === "active"` for the "is the user connected" decision and the balance fetch, but the connections array it renders into the sealed bank-data block retains every row and prints its status. Institution names from **errored** connections therefore reach the model.

⚠️ **`/api/plaid/disconnect` deletes the DB row without calling `itemRemove`,** so the Item stays live on Plaid's side. `/api/account/delete` does call it, best-effort, because it already loads the access token. Access tokens are stored as **plaintext TEXT** in `plaid_connections`; there is no column-level or application-level encryption. Note the consequence once production credentials are in play: deleting a row discards the only copy of the token, so the Item can no longer be revoked at all.

⚠️ Duplicate-connection detection is **application-level only** and runs only when an `institution_id` is present on both sides; rows with a NULL `institution_id` bypass it entirely. There is deliberately no unique index. Note that the codebase already uses partial unique indexes elsewhere (`user_facts`, `chat_sessions`), so that pattern is established here if one is added.

### Other API surfaces
Most remaining routes under `src/app/api/` (`banks`, `credit-cards`, `deals`, `forum`, `jobs`, `scholarships`, `apartments`, `universities`, `visa-types`, `bank-branches`, `country-config`) are **catalog reads with no recommendation engine behind them** — housing/scholarship/jobs stay catalog-only until an engine exists. Don't assume parity with the bank flow. `src/app/api/admin/*` (`cron-runs`, `import-universities`, `seed-country-data`) is operator tooling gated by `requireAdmin()`, not an end-user surface. Note that some of these catalog routes also accept POST; the public surface is wider than the read-only framing suggests.

### Tests
There is a small vitest suite; `src/lib/__tests__/plaidChatContext.test.ts` asserts the behavior of `resolvePlaidStateMode` across env values. It is easy to miss because coverage is thin, but it means changes to the Plaid state resolver have a regression check. Run the suite before changing that resolver.

### Demo surface (`src/app/demo/`)
The demo experience lives on `main` and is reachable at `/demo`. It **does not touch Supabase or the database at all** — no `signIn`, no OAuth, no queries; state is held in `sessionStorage` only (`_lib.tsx` says so in a comment, and it holds). Two consequences: the demo needs no auth configuration of any kind, and anything that assumes "a user on this page has a session" is wrong here. Keep it that way — wiring real auth into the demo would change its threat model entirely.

⚠️ `docs/demo-mode.md` describes this surface as calling `signInAnonymously()`. That call does not exist in `src/`. The document is stale; the code above is authoritative.

### Country, i18n, theme, layout
- `src/lib/countryConfig.ts` is a **static bank catalog plus filter helpers** for `US | UK | CA`, and also carries visa types. It does **not** drive recommendation logic — `bankRecommendation.ts` doesn't import it. Bank branch data comes from `locationData.ts` / the Supabase `bank_branches` table.
- i18n: `src/i18n/config.ts` + `messages/*.json` (top level, **not** `src/messages/`); Arabic is the only RTL locale; `LanguageContext` provides `t()`.
- `ThemeContext` applies per-university themes, persists to localStorage, and writes CSS variables onto `documentElement`. `DEFAULT_THEME` is a monochrome minimal palette (`#000000` / `#FFFFFF`) — not a dark theme, despite the naming.
- `ClientLayout` (in `src/components/layout/`) renders the floating `NoorAIChat` button, hidden on `/landing`, `/login`, `/survey`, `/welcome`, `/chat`, `/forgot-password`, `/auth/callback`, `/waitlist`. It resolves auth via `getSessionSafe()` on mount and keeps it in sync via `onAuthStateChange`. `clearLocalAuthState()` fires on `SIGNED_OUT` to purge financial data from localStorage on shared devices.

⚠️ **Logout clears a small explicit list; most keys survive it.** The app writes many distinct browser-storage keys and `clearLocalAuthState()` removes a handful — the Supabase-session key, the user id and profile, chat history, and the three Plaid caches. Locally-generated financial state (transactions, budget, savings and transfer goals, referral clicks), social data, and the last typed chat prompt all persist through logout. Two structural limits, not oversights to patch by extending the list:
- Some keys are **dynamic** (per-country visa keys, per-deal upvote keys) and cannot be enumerated in a static list at all. Account deletion uses a `noor_` prefix sweep for this reason — but at least one dynamic key does not carry that prefix, so the sweep misses it too.
- `NOOR_LOCAL_KEYS` in `validation.ts` **looks like the cleanup list and is not.** No function iterates it; a comment in the file states that the deletion routine deliberately does not. It is documentation, and its accuracy has never been verified. Do not treat membership in that array as evidence a key is cleared.

### Rendering & security headers
Every `page.tsx` is `"use client"`; there are no server-dynamic pages. The build renders page routes statically and the app fetches data client-side. Security headers are set in `next.config.js` (`securityHeaders` array plus `headers()`), applied to all routes. Constraints worth knowing before touching them:
- `Permissions-Policy` must keep `geolocation=(self)` or `MapView` breaks.
- CSP is currently `frame-ancestors` only. If a script/style CSP is added later it **must be merged into the same header** — two CSP headers on one response are each enforced independently.
- **Leaflet is loaded via dynamic `import('leaflet')` and pulls its stylesheet and marker images from the unpkg CDN at runtime.** A script/style CSP has to allow unpkg or the assets have to be self-hosted first. This is easy to miss because a dependency grep does not reveal a dynamic import, and it means a third-party CDN is a runtime dependency of a financial screen. Everything Leaflet-related is confined to `MapView.tsx`.

---

## Models / OpenRouter

**Live model configuration is env-driven and is not recorded here.** Read the env vars from the Vercel dashboard when it matters. What is stable:

- The in-code default model constants exist but are overridden whenever the corresponding env var is set. Read them from the file rather than assuming a value; they have been updated at least once without this file noticing.
- The chat route has a primary model and a fallback model, deliberately on different lines so one retirement doesn't take out both. Note this is **model** redundancy, not **provider** redundancy — OpenRouter itself is a single point of failure.
- A simple/complex split (`OPENROUTER_SIMPLE_MODEL` / `OPENROUTER_COMPLEX_MODEL`, `isComplexPrompt`) exists in code but is skipped when `OPENROUTER_MODEL` is set. Whether it is live therefore depends on env. Because of this branch, **two requests can be served by different models depending on configuration** — relevant to any per-token cost accounting, which has to be grouped by the `model` column rather than assumed uniform.
- ⚠️ There is an **Anthropic-direct branch** in the chat route, which reads `ANTHROPIC_API_KEY`. It is not dead code, but its condition is the *absence* of `OPENROUTER_API_KEY` — a configuration mistake, not an outage — so it cannot be reached in a correctly configured deployment and provides no real failover. Whether `ANTHROPIC_API_KEY` is set is live state; don't assume either way. It is slated for removal and replacement with a runtime-failure trigger. Don't cite it as a fallback.
- **OpenRouter conventions:** the `~` tilde is required for `latest` aliases; pinned versions use dots and no tilde. Never guess a model ID — copy it from OpenRouter. Changing a model env var requires a manual redeploy.
- When a model call fails, **search before assuming** — retirement happens silently, and the error you see may be the fallback's rather than the primary's.

**Parsers must absorb model output drift.** Pinning a version to stabilize output format is an illusion. The real defense is extraction/summary parsers that tolerate code-fenced JSON, missing or renamed fields, and extra text — skipping broken items and logging rather than crashing or silently misstoring.

---

## Key environment variables

Purposes only. **Values, and whether a variable is currently set, are live state — check the Vercel dashboard.**

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project URL + anon key (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side; bypasses RLS) |
| `OPENROUTER_API_KEY` | AI provider credential |
| `OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODEL` | Chat primary + fallback model |
| `OPENROUTER_SIMPLE_MODEL` / `OPENROUTER_COMPLEX_MODEL` | Simple/complex split; skipped when `OPENROUTER_MODEL` is set |
| `SUMMARY_MODEL` / `EXTRACTION_MODEL` | Cron models; fall back to in-code defaults when unset |
| `AI_SUPABASE_READ_ENABLED` | `"true"` to load the profile from the DB into AI context. **Also gates memory and, indirectly, the chat rate-limit cap.** |
| `AI_PLAID_STATE` | `off` / `connection` / `balances` capability tier — see the egress caveat above |
| `CHAT_RATE_LIMIT_ENABLED` / `CHAT_MAX_REQUESTS_PER_HOUR` | Hourly chat request cap: gate + value |
| `SIGNUP_DISABLED` | `"true"` (exact, case-sensitive) blocks new email signups in the survey route. Reverse polarity relative to every other flag here, and fail-open: anything else permits signup |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | Plaid credentials + environment |
| `RESEND_API_KEY` | **Transactional email from the app is Resend**, via `src/lib/email.ts` |
| `SMTP_FROM` / `SMTP_FROM_NAME` | From-address and display name used by the Resend send |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | **Not used by app code** (no nodemailer). Retained because Supabase Custom SMTP uses the same mailbox credentials |
| `CRON_SECRET` | Bearer token both cron routes require; unset returns 503, mismatch 401 |
| `DEMO_DOMAIN` | Host gate for the demo experience; inert when unset |

---

## Security principles

- **Authentication ≠ authorization.** The recurring root cause of past holes was "logged in but missing a permission check" or "trusted a client-supplied value." Verify both.
- **Access control belongs in a separate service-role-only table.** `admin_users` is service-role-only (RLS on, no policies, `REVOKE ALL`) *because* a self-promotable flag on a user-accessible table was defeated in testing — table-level grants and `WITH CHECK` are not enough. Never put admin flags on user-accessible tables.
- **UI hiding is not a security boundary; the API is.** Removing a link or a page does not protect a route. Conversely, a route being reachable is not itself a vulnerability if the real gate is authentication. But the converse has a limit: "the API is the boundary" does not mean pages need no gate. The `admin/*` API routes check `requireAdmin()`; the `/admin` pages do not.
- **Client-supplied `userContext` is discarded** in `/api/chat`; only the server-side DB read feeds the prompt. Name fields go through `sanitizeNameField` (strips control characters and newlines, caps length, preserves Unicode). **Do not use `validateName`** — it is ASCII-only and rejects legitimate names like José or 김성원. It currently has no call sites at all and is slated for removal; don't revive it.
- **Dead tables are live risk** — prefer dropping them to enabling RLS on them, after checking anon grants and code references.
- **RLS is on for every table, but one table accepts writes from any authenticated user** (`apartments`, via INSERT and UPDATE policies). Every other table restricts writes to the owning user or to service-role. Know which one is the exception before reasoning about write exposure.
- **Verify that a threat vector actually exists before investing in the defense.** A textbook control that prevents something with no current path into the codebase is future-proofing, not mitigation, and ranks below controls covering live exposure. Being right about the order for the wrong reason is still a problem: the wrong reason will misdirect the next decision.
- **`localStorage` is not a trustworthy source of truth.** Frontend state that matters must come from the DB. Some client-side guards still key off a localStorage value that is unsigned and freely injectable from the browser — treat those as display logic, never as access control. The dashboard guard and the terms-acceptance record are both in this category, and `noor_selected_country` is read in many places across the app while being writable by anyone.
- **Terms acceptance is recorded in localStorage only.** The checkbox state is not sent in the signup request body and no column stores it. Receiving consent and being able to prove it are different things; do not describe consent as recorded server-side.
- **Blast radius sets severity.** Whether a failure exposes the user's own data or another user's is the primary axis, not how easy the bug is to trigger.
- **A silent failure is worse than an explicit error.** The old password-reset route returned `success: true` while the underlying token write had failed, so nothing surfaced and the user was told it worked. Surface real errors; never report success on an unverified side effect.
- **Fire-and-forget means never sent.** Vercel freezes the function once the response returns, so async side effects must be awaited before responding, and failures surfaced rather than swallowed. Email failure must not block the primary action — persist the record first, send best-effort.
- **Collect the minimum.** Storing PII with no purpose is a purpose-limitation problem, not just clutter. This cuts both ways: columns that are written and never read are also collection without a purpose.

---

## Strategic decisions (so they aren't re-litigated)

- **Do not gate launch on Plaid or on legal answers.** Both are external and uncertain; keep the queue filled with work that doesn't depend on them, and keep a fallback path that ships without them.
- **Recommendation architecture is evolving toward conversation-derived input.** The rules-based engine stays and expands — it owns the judgment and `fit_score` for determinism and accountability. AI does **input extraction and understanding only**, never the final judgment. A transform layer will turn survey + `chat_summaries` + Plaid into structured engine input. The `facts` schema is left untouched, keeping its general-memory role; the transform layer consumes data separately. Banks first; housing and scholarships stay catalog-only.
- **AI advice quality is prompt-level work** and can improve without a code deploy, so it isn't a launch gate — but it is the core differentiator. The remaining work is the reasoning scaffold (defining the types of financial judgment and their logic), not tone or format.
- **Build defensively under legal uncertainty.** Where a legal answer is pending, structure the code so the answer can be accommodated rather than assuming the permissive reading.
- **Limits on shared systems are agreed, not set unilaterally.** Build the mechanism, leave the value behind a gate, and let the team decide the number from measured usage.
- **Mobile-first.** The landing page is the exception; a responsive desktop layout is a separate, large track.

---

## Gotchas

- **Never read `src/lib/locationData/apartmentsData.ts`.** It is over 160,000 lines. Opening it will exhaust a session's context. If you need something from it, grep for the specific value. The same caution applies to `package-lock.json`.
- **`docs/` is stale and is not a source of truth.** The design notes under `docs/design/` carry line numbers that no longer match the code and describe an older architecture; `docs/demo-mode.md` describes a call that does not exist. Read the code, not `docs/`. If a task requires understanding a past design decision, ask the operator rather than citing these files.
- **No local build** → the Vercel deploy is the only local-build-equivalent check; CI (`vitest run` via `.github/workflows/test.yml`) covers tests separately, on every push. (Repeated because "no local build" is the most common false assumption.)
- **Migrations are applied manually** in the Supabase SQL Editor, and the live schema contains constraints no migration creates. (Repeated for the same reason.)
- **Vercel env changes need a manual redeploy** (Deployments → ⋯ → Redeploy). This applies to *deleting* a variable too.
- **A rolling window doesn't clear on redeploy.** After turning the chat cap off, an already-exceeded hourly count keeps returning 429 until the window elapses. Don't read that as "the redeploy didn't take" — check the logs.
- **No migration in this repo performs a backfill.** Every column added to an existing table leaves prior rows at their default. If a change needs existing data populated, that is a separate manual step, not something a migration here will do.
- **SMTP password = the mailbox password** for `hello@noor.financial`, not the Namecheap account password. If it's reset, update both the Vercel variable and Supabase Custom SMTP.
- **This repo lives under OneDrive.** Sync can hold file locks and occasionally corrupt files mid-write. If a file read or write behaves impossibly — a lock that shouldn't exist, content that doesn't match what was just written — suspect sync before suspecting the code.
- **`auth.uid()` casting:** when a `user_id` column is `TEXT` (e.g. `plaid_connections`), RLS policies need `auth.uid()::text = user_id`, or you get `operator does not exist: uuid = text`.
- **OAuth provider state is live configuration.** Whether Google sign-in is enabled, and therefore whether new accounts can be created through it, is a Supabase dashboard setting. Check it; don't assume. Anyone enabling it should know that `sync-profile` in `/auth/callback` already has a Bearer header attached, or sync fails silently.
- **Signup can be blocked at two independent layers.** A Supabase project-level toggle stops OAuth signups, and `SIGNUP_DISABLED` stops the email path — because the admin API deliberately bypasses project-level policy, one layer cannot cover both. Neither leaves a trace in the repo. Verify both before concluding signup is open or closed.
- **`git` author is weak evidence of code provenance.** Look at commit time plus current state together.
- **Commit messages and branch names are unreliable descriptions of a commit.** A branch called `fix_plaid` touched no Plaid file; a commit called `add demo` added two unrelated architecture paragraphs to this very document. Read the diff, not the label — and don't conclude "no substantive change" without having read it.
- **Soft wrap looks like a syntax error.** In the terminal, a long string broken mid-line with no line number on the continuation is display folding, not broken code. Diff output has the same trap — an array can look unclosed when the file is fine. When in doubt, `cat` the file.
- **Adding a feature can wake sleeping configuration.** A dormant env var, flag, or branch may activate as a side effect of unrelated work.
- **Re-review corrected code.** A fix applied after review has not been reviewed.
- **Grep in this environment needs care.** `LC_ALL=C` avoids a crash in the Git-for-Windows grep when `-i` is combined with multiple `-e` patterns, and a `printf` format string that begins with `-` is parsed as an option. Both bit the audit scripts on first run.
- **Fintech SEO is YMYL**, so Google is unusually strict and a new domain has little margin. Avoid serving the same content on two hosts.

---

## Status doc

Current priorities, in-progress work, and the full TODO list live in the operator's documents outside the repo (Korean): a master status doc, a debt ledger, and a per-session handoff note — not here. This file holds only stable architecture, rules, principles, and traps. When you need to know "what are we doing next," ask the operator rather than inferring it from code.
