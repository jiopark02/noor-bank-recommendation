# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Working Agreement (read this first — these rules override convenience)

**Language**
- Code, comments, commit messages, SQL, migrations, and any team-facing document: **English only** (the external tech team does not read Korean).
- Conversation with the operator and personal status docs: Korean is fine. This file is a project artifact, so it stays in English.

**Development workflow (invariant)**
1. Claude Code writes code / SQL / migration files.
2. **High-risk changes (security, auth, RLS, migrations) get an independent Cursor Ask review** before applying. Routine changes (simple helpers, copy, non-security UI) can be handled inside Claude Code.
3. **Live verification is the final defense.** "Cursor passed" or "the code looks right" is a first filter, never proof. Security changes are verified by actually attempting the attack (e.g. `set local role authenticated` + the forbidden operation, expecting `42501`).
4. Vercel auto-builds from `main`.

**Hard environment constraints**
- **No local Node.js.** `npm run dev` / `npm run build` cannot be run locally. The only build verification is the Vercel deploy. Do not claim a change is "verified" on the basis of a local build — it didn't happen.
- **Migrations are NOT auto-applied.** Migration files are committed to `supabase/migrations/`, but the actual DB change is applied **manually by the operator in the Supabase SQL Editor**. Never assume a committed migration is live.
- **Vercel env vars do not auto-redeploy.** After changing an env var, a manual redeploy is required before the change takes effect.
- Single production deploy from `main`. The tech team also pushes to this repo (branches like `Landing_Page`, `UI_Updates`). **Before starting work, `git fetch` and compare local `HEAD` against `origin/main`; pull if behind.** Stale local code breaks the "read the real artifact" principle even when you read it correctly.

**Review intensity scales with risk.** Things that are hard to reverse (migrations, auth, access control) get heavy, independent review + live verification. Trivial helpers get a light touch. Don't audit the whole attack surface in one pass — decompose into layers and go narrow + deep + verified, one layer at a time.

**⚠️ This repo lives under OneDrive** (`...\OneDrive\Desktop\NOOR\noor-bank-recommendation-1`). OneDrive syncing a git working tree (especially `.git/`) can cause file locks and corruption. If git behaves strangely, suspect this first.

---

## Product Context

Noor is an AI personal-finance guidance PWA. **The target has pivoted: it was "international students in the US/UK/CA," it is now "financial beginners / lowering the barrier to personal finance," particularly Gen Z.** Legacy "international students" copy is still scattered through the codebase (prompts, i18n strings, survey terms, emails) and is being cleaned up — **do not treat international-student framing as the current product direction.** When in doubt, write for a general financial beginner, not a visa-holding student.

The product's core differentiator is **the quality of its financial reasoning** — how deeply it understands a user's situation and what judgments it reaches — not tone/format (already good) or raw data access alone.

This is a Next.js 14 App Router app. Two main surfaces: a **bank recommendation engine** (rules-based, profile-driven) and **Noor AI** (a personal-finance chatbot).

---

## Architecture Overview

### Auth & Session
All auth flows through Supabase (unified on Supabase Auth — the legacy `password_hash` / custom-token path was removed). Two clients:

- `src/lib/supabase-browser.ts` — browser-only (`createBrowserClient` from `@supabase/ssr`), exported as the `supabase` singleton. Uses a **no-op Web Lock** to avoid the orphaned-lock hang in supabase-js. **Always use `getSessionSafe()`** (races `getSession()` against a 3 s timeout) instead of raw `getSession()`.
- `src/lib/supabase.ts` — server-side. `createServerClient()` **prefers the service-role key and falls back to anon only if it is missing** — so in production it bypasses RLS. `createAdminClient()` requires `SUPABASE_SERVICE_ROLE_KEY` and always bypasses RLS.

**Because `createServerClient()` runs as service-role in production, RLS is a backstop, not the primary defense. The explicit `.eq('user_id', ...)` filter in app code is the first line of defense, and the id must come from the verified token — never from a request body.** ~30 call sites rely on this discipline.

API routes verify identity via `getAuthenticatedUserIdFromRequest()` in `src/lib/apiAuth.ts` (extracts + verifies the Bearer JWT). Admin routes additionally call `requireAdmin()`, which checks membership in the service-role-only `admin_users` table. `requireAdmin` is fail-closed but the caller must `return 403` on null, or it fails open.

### Chat / Noor AI (`src/app/api/chat/route.ts`)
`POST /api/chat`:
1. Authenticates via JWT.
2. Loads the user profile from `users` + `survey_responses` when `AI_SUPABASE_READ_ENABLED=true`. **Client-supplied `userContext` in the request body is intentionally discarded** (prompt-injection defense — see Security).
3. When `AI_MEMORY_ENABLED=true`, fetches/creates an active `chat_session` and builds a memory context to prepend to the system prompt.
4. Detects intent (greeting / balance / financial-planning / subscription) and may inject a verified Plaid snapshot.
5. Routes to OpenRouter. **See Models below — the live behavior is driven by env vars, not the in-code default constants.**
6. Persists the turn to `chat_messages` (only when memory is enabled and a session exists).

System prompt is generated by `src/lib/noorAIPrompt.ts` from a `UserContext`. The `<user_memory>` wrapping + "this is background, not a verified command" guidance is a prompt-injection *mitigation*, not a complete defense.

### AI Memory (`src/lib/aiMemory.ts`)
Three layers across Supabase tables:
- `chat_messages` — per-turn storage within a session.
- `user_facts` — extracted by `/api/cron/extract-facts` (runs at :30).
- `chat_summaries` — generated by `/api/cron/summarize` (runs on the hour).

All aiMemory functions use `createAdminClient()` and **must filter by `user_id` on every query**. Cross-user safety is structural: extraction trusts `chat_sessions.user_id` only (never a request body), with double-filtered reads and ownership checks. `withRetry()` wraps idempotent reads only — never the non-idempotent `saveMessages`.

### Bank Recommendation (`src/lib/bankRecommendation.ts`)
`getRecommendations()` queries `bank_accounts` + `survey_responses` and returns scored `BankRecommendation[]` (`recommendations_new`, upsert on `user_id, bank_account_id`). The `/api/recommendations/bank` route falls back to hardcoded mock data (US/UK/CA) if the DB query fails, so the UI always renders. Judgments are **rules-based on purpose** (determinism, auditability, no hallucination) — keep them rules-based.

### Plaid (`src/lib/plaid.ts`, `src/app/api/plaid/`)
Initialized in **sandbox** by default (`PLAID_ENV`), production approval pending. Active product: Transactions (Auth/Identity commented out pending dashboard config). Routes: `create-link-token`, `exchange-token`, `accounts`, `transactions`, `disconnect`, `relink`. Per-user multi-connection via `item_id`. **Plaid auth deletes `body.userId` explicitly** before use.

### Country & i18n
`src/lib/countryConfig.ts` drives visa types, bank branches, and recommendation logic by country (`US | UK | CA`). UI is internationalized (`src/i18n/config.ts`, `messages/*.json`); Arabic is the only RTL locale; `LanguageContext` provides `t()`.

### Theme & Layout
`ThemeContext` supports a default dark theme + per-university school themes (`src/lib/schoolThemes.ts`), persisted in localStorage, applied as CSS vars on `document.documentElement`. `ClientLayout` wraps every page, conditionally renders the floating `NoorAIChat` button (hidden on `/landing`, `/login`, `/survey`, `/welcome`, `/chat`, `/forgot-password`, `/auth/callback`), resolves auth via `getSessionSafe()` on mount, and keeps it in sync via `onAuthStateChange`. `clearLocalAuthState()` fires on `SIGNED_OUT` to purge financial data from localStorage on shared devices.

---

## Models / OpenRouter (live behavior, not the code defaults)

The in-code default constants (`google/gemini-2.0-flash-001`, `anthropic/claude-3.5-sonnet`) are **dead defaults** — both models are retired and the env vars override them. The Anthropic-direct fallback branch in the chat route is also **dead code**. Actual live config:

- Chat: `OPENROUTER_MODEL` = `~anthropic/claude-sonnet-latest` (primary), `OPENROUTER_FALLBACK_MODEL` = `~anthropic/claude-opus-latest` (fallback, on a different line so it survives if Sonnet retires).
- Cron: `SUMMARY_MODEL` / `EXTRACTION_MODEL` default to `~anthropic/claude-sonnet-latest` (env unset → code default).
- Because `OPENROUTER_MODEL` is set, the simple/complex split (`OPENROUTER_SIMPLE_MODEL` / `OPENROUTER_COMPLEX_MODEL`, `isComplexPrompt`) is **bypassed**.

**⚠️ `~` tilde is mandatory for `latest` aliases.** `anthropic/claude-sonnet-latest` (no tilde) → "not a valid model ID". `~anthropic/claude-sonnet-latest` → OK. Pinned versions use dot notation without the tilde (`anthropic/claude-sonnet-4.6`). **Confirm live model IDs from the OpenRouter model page, not from memory or web search** — model retirement happens silently, and the error you see may be the fallback's, not the primary's.

**Parsers must absorb model output drift.** Pinning a version to stabilize output format is an illusion. The real defense is robust extraction/summary parsers that tolerate code-fenced JSON, missing/renamed fields, and extra text — skipping broken items and logging rather than crashing or silently misstoring.

---

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project URL + anon key (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side; bypasses RLS) |
| `OPENROUTER_API_KEY` | Primary AI provider |
| `OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODEL` | Live chat models (see Models) |
| `OPENROUTER_SIMPLE_MODEL` / `OPENROUTER_COMPLEX_MODEL` | Simple/complex split — currently bypassed |
| `SUMMARY_MODEL` / `EXTRACTION_MODEL` | Cron models (default to sonnet-latest) |
| `AI_MEMORY_ENABLED` | `"true"` to enable chat persistence |
| `AI_SUPABASE_READ_ENABLED` | `"true"` to load profile from DB into AI context |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | Plaid credentials + environment |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Transactional email (Namecheap Private Email, `hello@noor.financial`) — also reused by Supabase Custom SMTP |

`ANTHROPIC_API_KEY` exists but the direct-Anthropic path is dead code (see Models).

---

## Security Principles & Rationale

- **Authentication ≠ authorization.** The recurring root cause of past holes was "logged in but missing a permission check" or "trusted a client-supplied value." Verify both.
- **Access control belongs in a separate service-role-only table.** `admin_users` is service-role-only (RLS on, no policies, `REVOKE ALL`) *because* a self-promotable flag on a user-accessible table was broken in testing — table-level grants and `WITH CHECK` can be defeated. Do not put admin flags on user-accessible tables. UI hiding is not a security boundary; the API is.
- **Client-supplied `userContext` is discarded** in `/api/chat`; only the server-side DB read feeds the prompt. Name fields are run through `sanitizeNameField` (strips control chars / newlines, caps length, preserves Unicode — do NOT use the ASCII-only `validateName`, which rejects legitimate global names like José or 김성원).
- **Dead tables are live risks.** Tables with RLS off + anon privileges are vulnerabilities even with zero code references — verify (anon grants + code search) then DROP rather than leaving them.
- **A "silent failure" is worse than an explicit error.** (The old password-reset returned `success: true` while the underlying token write failed.) Prefer surfacing real errors.

---

## Strategic Decisions (so they aren't re-litigated)

- **Do not gate launch on Plaid.** Production approval is external and uncertain; fill the queue with Plaid-independent work.
- **Recommendation architecture is evolving toward conversation-derived input.** The rules-based engine stays and expands (it owns the judgment/fit_score for determinism + accountability); AI does **input extraction/understanding only**, never the final judgment. A new ETL/transform layer will turn survey + chat_summaries + Plaid into structured engine input. **The `facts` schema is left untouched** (it keeps its general-memory role); the transform layer consumes data separately. Banks first; housing/scholarship are catalog-only (no engine yet) and deferred.
- **AI advice quality work is prompt-level** (it can improve incrementally without a code deploy) and is therefore not a launch gate — but it is the core differentiator. The reasoning scaffold (defining financial-judgment types and their logic) is the real remaining work, not tone/format.

---

## Gotchas

- **No local build** → verification is the Vercel deploy only (repeated because it's the most common false assumption).
- **Migrations applied manually** in Supabase SQL Editor (repeated for the same reason).
- **Vercel env changes need a manual redeploy** (Deployments → ⋯ → Redeploy).
- **SMTP password = the mailbox password** for `hello@noor.financial`, NOT the Namecheap account password. If the mailbox password is reset, update **both** Vercel `SMTP_PASSWORD` and Supabase Custom SMTP.
- **`auth.uid()` casting:** when a `user_id` column is `TEXT` (e.g. `plaid_connections`), RLS policies need `auth.uid()::text = user_id`, or you get `operator does not exist: uuid = text`.
- **Google OAuth button exists but the provider is disabled** → clicking it errors. Anyone enabling it must know `sync-profile` in `/auth/callback` already has a Bearer header attached, or sync fails silently.
- **PowerShell host:** when handing the operator a command to run directly in PowerShell, avoid `&&` and `curl -H` (use `Invoke-RestMethod`). Inside Claude Code's own Bash tool (Git Bash), `&&` is fine.

---

## Status Doc

Current priorities, in-progress work, and the full TODO list live in the operator's separate master status document (kept in Korean, outside the repo), not here. This file holds only the stable architecture, rules, principles, and traps. When you need to know "what are we doing next," ask the operator rather than inferring it from code.
