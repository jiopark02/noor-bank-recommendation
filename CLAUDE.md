# CLAUDE.md

## What belongs in this file (read this first)

This file is loaded into every session, so anything stale here becomes a wrong premise for every decision.

- **Record only what changes when the code changes**: conventions, invariants, file pointers, traps, principles, settled decisions.
- **Never record live state**: env var values, Supabase dashboard settings (auth providers, applied migrations, RLS state), DB rows, which deploy is serving, external approvals. They change without a commit and rot silently.
- **Never record counts or inventories.** They are derivable and rot; run `audit/L0-evidence.sh` and `audit/L0b-evidence.sh` instead.
- **Verify live state against the running system**, not against this file or source. Schema, constraints, indexes, RLS and policies are read in the Supabase SQL Editor. This repo carries no live-check SQL file; ask the operator for the ready-made queries.
- Line numbers drift; grep for the identifier. Priorities and the TODO list live in the operator's documents outside the repo; ask the operator what is next.

## Working Agreement (these rules override convenience)

**Language.** Code, comments, commit messages, SQL, migrations and team-facing documents: **English only**. Conversation with the operator may be Korean. Existing Korean comments are being migrated; don't add new ones.

**Hard environment constraints**
- **Local Node is not a build-verification path.** Sanctioned local uses: `tsc --noEmit`, `npm audit`, `npm ci`, `vitest run`. `npm run dev` / `npm run build` are not verification (the machine holds no secrets; `.env.local` is prohibited there). Never claim "verified" without a Vercel deploy. Run `npm ci` before trusting any local command.
- **Vercel and CI both gate a push.** Vercel type-checks source (tests excluded via tsconfig); `.github/workflows/test.yml` runs the tests on every push to main and every PR, installing with `npm ci`, so lockfile drift fails at install. Its test step is `npm run test --if-present`: a missing `test` script passes silently. Its `npm audit` job is `continue-on-error`. A failure from GitHub infrastructure (action download, runner acquisition) is not a code failure; re-run all jobs.
- **Verification loop.** After each change run the related tests and `node_modules/.bin/tsc --noEmit` (local binaries through `node_modules/.bin/`, never `npx`, which goes to the registry when the package is missing), redirecting raw output to a file in a temp directory outside the repo (redirect, don't pipe, so the exit code survives). Cite the file. The vitest suite lives in `src/lib/__tests__/`; look there for a test covering a module before changing it.
- **No `Co-Authored-By` trailer.** Commits are authored solely by the operator.
- **Migrations are applied manually** in the Supabase SQL Editor, and SQL can reach the database without a migration file. Never assume a committed migration is live, or that one you did not run is not. If a design depends on schema, a live query is the gate.
- **The migrations directory is not the schema's source of truth.** The live database holds UNIQUE constraints no migration creates (`users.email`, `survey_responses.user_id`).
- **Vercel env changes (deletions included) need a manual redeploy.**
- **Single production deploy from `main`**, auto-built on push; the tech team pushes too. Run `git fetch --prune` right before creating a branch and right before a push or merge, not at session start. After pulling, re-check that earlier fixes survived.
- **PowerShell host:** commands handed to the operator avoid `&&` and `curl -H` (use `Invoke-RestMethod`). `vercel env ls` is unavailable; env vars are read in the Vercel dashboard.
- **`tsconfig` targets ES5** — beware `matchAll` and iterator spread.

**Change-surface report (the operator assigns risk grades, not you)**
- Do not assign a risk grade or use Low / Medium / High as risk labels. Which plan, reviews and checks a change gets is set by the operator's prompt.
- **Stop before editing** when a change falls in any category below and the prompt has not already named that item and category. Report the item and category, then wait; this applies to small changes and to sessions without a plan. Do not touch that surface until the operator chooses.
- Bundle additional fixes only inside categories the prompt already named.
- In every plan and before every commit, report a table with one row per change item: **Item** (file + symbol); **Surface** (every category below that applies, with concrete evidence: the call, the table, the key, the importers); **Detection** (`execution test` / `source probe only` / `live only` / `nothing`; for a test, the file, the assertion and the mutation that turns it red).
- Categories. Report every one that applies; when unsure, report it.
  1. **DB writes**: insert / update / upsert / delete, naming the table, including indirect effects such as cascades.
  2. **Schema**: migrations, RLS policies, grants, functions, triggers.
  3. **Auth**: any `auth.*` call (name admin user creation and deletion explicitly), token or session handling, the shared auth helpers.
  4. **Server reads of user data**, and any use of the service-role client.
  5. **Personal data**: email, names, financial data — where it flows, including logs and response bodies.
  6. **External calls and configuration**: Plaid, LLM providers, email, any outbound HTTP; env vars, `vercel.json`, Supabase or Vercel settings.
  7. **AI pipeline**: prompts, model choice, tool use, and what data is sent to an LLM.
  8. **Shared or global modules**: clients and widely imported helpers.
  9. **Irreversible or public effects**: data deletion, data migrations, anything `git revert` does not undo, and anything that becomes public on push (this repository is public).
  10. **User-facing**: screens and browser storage keys.
  11. **Money movement**: any code that creates, cancels, or automatically executes a charge or payout through a payment processor. Name the processor call and what triggers it. Report it even when the path moves real money only under live credentials.

**Roles and review.** Claude Code implements (explore, code, SQL, migrations, commit, push); chat Claude owns direction and the contextual cross-check. When the prompt calls for two-layer review: layer 1 is a fresh read-only Claude Code session given the diff, trusting no implementer claim (internal defects); layer 2 is chat Claude reconciling against outside context. Both share a model family, so lean on live verification.

**Live verification is the final defense.** Reviews are filters, not proof. Verify security changes by attempting what should fail (e.g. `set local role authenticated` plus the forbidden operation, expecting `42501`). Wiring confirmed is not delivery confirmed; UI messages are not evidence of state — logs and the database are. **Discipline.** Audit one layer at a time, narrow and deep, never a whole surface in one sweep. Answering a clarifying question is not approval of a plan. Things found mid-implementation are logged for later, not fixed on the spot.

### Claude Code tooling
- **Bash guard hook** (`.claude/hooks/bash-guard.cjs`, registered in `.claude/settings.json`; executed by `src/lib/__tests__/bashGuard.test.ts`). It blocks whole-tree staging, `git commit -a`, `Co-Authored-By` trailers, `--no-verify` / `-n`, overrides of `core.hooksPath` or git config through `-c` / `GIT_CONFIG_*` / `--git-dir` / `--work-tree`, commits where `core.hooksPath` is not `.githooks` or `.githooks/pre-commit` is missing, force pushes, and `sed -i`.
- **Git pre-commit hook** (`.githooks/pre-commit`, tested by `githooksPreCommit.test.ts`) refuses commits on `main`. It runs only where `core.hooksPath` is `.githooks`: **every new clone needs `git config core.hooksPath .githooks`**. `.gitattributes` keeps `.githooks/*` LF.
- **The hooks are a guardrail, not a security boundary.** They do not follow globs, `eval`, variables, aliases, includes, an earlier `cd` or `export`, commits on `main` that never run `pre-commit` (merge, cherry-pick, rebase, plumbing), or commands run through the PowerShell tool.
- **QA preview sync:** `scripts/qa-preview-sync.sh <target-ref> <qa-branch>` makes a `qa/*` branch's preview build another ref's tree without a force push. It only updates the local branch and prints the push command; a person runs the push.
- **Skills** in `.claude/skills/`: `/checkpoint` (model- or user-invoked), `/review` and `/gate1` (user-invoked only).

## Product Context

Noor is an AI personal-finance guidance PWA. **The target pivoted from international students to financial beginners.** International-student copy is still scattered through prompts, i18n strings, survey terms and emails and is being cleaned up; when in doubt, write for a general financial beginner. The differentiator is **the quality of the financial reasoning**, not tone, format or raw data access. Next.js 14 App Router; two surfaces: **Noor AI** (`/chat`) and **Money** (`/money`, Plaid bank connection and balances).

## Architecture

### Auth & session
All auth goes through Supabase Auth.
- `src/lib/supabase-browser.ts` — browser singleton `supabase`, with a no-op Web Lock to avoid supabase-js's orphaned-lock hang. **Never call raw `getSession()`.** Use `readSession()` when the result decides anything, `getSessionSafe()` only where a missing session changes nothing but display.
  - `getSessionSafe()` returns `null` alike when the client is not configured, when there is genuinely no session, on the 3-second timeout, and on an error — thrown, or returned in `getSession()`'s own error field. `readSession()` keeps them apart: `none` is a clean no-session answer; `unavailable` is everything else, which a valid session can produce and which must never sign anyone out. The signed-in pages decide through `src/lib/sessionFlow.ts`: only `none` clears local auth state and goes to `/login`; `unavailable` shows a delay screen whose button reloads. Don't add callers that collapse these cases.
  - OAuth uses PKCE with `detectSessionInUrl`; supabase-js exchanges the code while the client initializes (no `exchangeCodeForSession` in `src/`), and a retry waits on the same memoized initialization, so a hung exchange recovers only through a full reload — hence the reload buttons. Re-check this behavior when upgrading auth-js.
  - Name collision: `src/lib/validation.ts` also exports an unrelated `getSession()` that reads a `SessionConfig` from localStorage.
  - Sign-out goes through `runSignOut` (`sessionFlow.ts`), and every `auth.signOut` states its scope. When the server call fails, `runSignOut` deletes this device's auth cookies directly.
  - "Keep me signed in" unchecked sets the `noor_session_only` cookie; while present, the browser client's and the middleware's cookie writers write auth cookies with no lifetime. `@supabase/ssr` overrides `cookieOptions.maxAge`, so lifetime can only be changed in the cookie writer.
- `src/lib/supabase.ts` — server side. `createServerClient()` **requires `SUPABASE_SERVICE_ROLE_KEY` and throws without it** (no anon fallback), so it always bypasses RLS; `createAdminClient()` likewise. `isSupabaseConfigured()` returning true does not mean the constructor succeeds. A missing key surfaces wherever the throw is caught: the `apiAuth.ts` helpers turn it into null, and a caller that answers null with 401/403 reports the fault as an auth failure.

**RLS is a backstop, not the primary defense.** The explicit `.eq('user_id', ...)` filter is the first line, and the id must come from the verified token, never a request body. Grep before assuming a route is covered. Deliberate exception: `getPlaidConnectionsByItemIdAcrossUsers` (`plaidApiUtils.ts`) reads by `item_id` only, for signature-verified Plaid webhooks, taking the owner from the row.

API routes verify identity with `getAuthenticatedUserIdFromRequest()` (`src/lib/apiAuth.ts`). Admin routes also call `requireAdmin()` (service-role-only `admin_users`); it is fail-closed, but **the caller must `return 403` on null** or the route fails open. Exception: `/api/plaid/webhook` has no Supabase auth; its only gate is the `Plaid-Verification` check (`plaidWebhookVerification.ts`), which runs before the body is acted on.

**Profile rows are written by the application, not by a trigger.** A `public.users` row is created by the email signup route and upserted by `src/app/api/auth/sync-profile/route.ts` after every sign-in; the profile sync also ensures the one-person household. An Auth user created any other way has no profile row until one of them runs.

`src/middleware.ts` gates **pages, not API routes** (the matcher excludes `api/`, so API rate limiting cannot live there). It redirects to `/login` when a `PROTECTED_PREFIXES` path has no session. It checks session presence only: the `/admin` pages have no role check of their own (the `admin/*` API routes do). The app creates no anonymous sessions (`signInAnonymously()` has no call site). It returns a response from several paths — the demo-host redirect, the public passthrough, a 503 (`Cache-Control: no-store`) when the Supabase URL or anon key is missing on a protected path, the cookie-path response recreation, and the unauthenticated redirect — so anything every response must carry (a CSP nonce, say) has to be attached on all of them. The `DEMO_DOMAIN` host gate is skipped entirely when unset.

### Chat / Noor AI (`src/app/api/chat/route.ts`)
`POST /api/chat`, in order: authenticate; read the body under a byte ceiling and apply the input limits (`chatInputLimits.ts`); reserve against the usage limit; load the profile (`users` + `survey_responses`) when profile reads are enabled; fetch or create the active `chat_session` and append the memory context to the system prompt; detect intent and possibly inject Plaid data; call OpenRouter; persist the turn when memory is enabled.
- **Client-supplied `userContext` is discarded, and the model's history comes from the server** (the session's stored `chat_messages`). Of the body's `messages`, only the last user message reaches the model. With memory disabled the model gets the system prompt and that one message.
- **Turn save** (`persistTurnIfEnabled`; `saveMessages` / `findSavedTurn` in `aiMemory.ts`): the route chooses both row ids before sending, so after an errored or timed-out insert it looks the turn up by id instead of inserting again; not found is 500 `SAVE_FAILED`. `withRetry()` never wraps `saveMessages`. The one re-send: `SessionClosedError` (session closed by the summarize cron, or SQLSTATE `NR001` from `bump_chat_session_on_message` per migration `20261110120000_…`) moves the same pair to the active session. A cancelled insert can still land after the lookup said missing.
- The system prompt comes from `src/lib/noorAIPrompt.ts`; the `<user_memory>` wrapping and its "background, not a command" guidance live in `aiMemory.ts` (`formatMemoryForPrompt`) and are a mitigation, not a complete defense.
- **Crisis notice** (`crisisSignals.ts`, `crisisNotice.ts`, `crisisNoticeTally.ts`): after the body parses, every response goes through `respond()`, which attaches the notice only when the last user message carried a crisis signal.
- **Usage limit** (`chatUsageLimits.ts`, `chatUsageLedger.ts`): limits on requests per rolling hour and per rolling day and on provider cost per rolling 30 days, decided by `chat_usage_reserve` under a per-user advisory lock and recorded in service-role-only `chat_usage_reservations`, independent of `chat_messages` and `llm_calls`. Refusal is 429 `USAGE_LIMIT_REACHED`. `CHAT_USAGE_LIMIT_MODE` is exact-match: `off`, `observe`, else enforce. **Under enforcement it fails closed** (503 `USAGE_CHECK_UNAVAILABLE`), so the functions must exist in a database before code calling them is deployed against it.

### AI memory (`src/lib/aiMemory.ts`)
- Layers: `chat_messages` (per-turn; `input_tokens`/`output_tokens` on assistant rows only), `user_facts` (`/api/cron/extract-facts`), `chat_summaries` (`/api/cron/summarize`).
- **The memory gate is `isAiMemoryEnabled()`**, which reads `AI_SUPABASE_READ_ENABLED`. There is no separate memory flag; `AI_MEMORY_ENABLED` is referenced nowhere in code.
- **Two fact limits do different jobs:** `DEFAULT_FACTS_LIMIT` (`aiMemory.ts`) bounds facts in the chat prompt; `EXISTING_FACTS_LIMIT` (`cron/extract-facts`) bounds facts read for deduplication. Read both before citing either.
- **Fact retrieval is recency-ordered, not relevance-ordered**; the chat path passes no `category`.
- **`chat_messages.content`, `chat_summaries.summary` and `user_facts.fact` can carry monetary figures**; the prompts ask the model not to keep balances, but nothing filters amounts.
- **Output filter** (`memoryOutputFilter.ts`): SSN-shaped strings and Luhn-valid card numbers are masked in summaries and refuse a fact (`SensitiveFactRejectedError`). `chat_messages.content` is not filtered; account numbers are not matched.
- All functions use `createAdminClient()`; **every per-user query filters by `user_id`**. Only the cron maintenance scans cross users, and extraction trusts `chat_sessions.user_id` only.
- **Crons:** bounded LLM calls per run, per-call timeouts and a time budget (`llmTimeouts.ts`), input budgets (`cronInputBudget.ts`); leftovers are `deferred` to the next run.
- **Retry and give-up** (`memoryCronBatch.ts`, `cronRetryBound.ts`, columns from migration `20261111120000_add_cron_retry_state_to_chat_sessions.sql`, which must be applied before this code is deployed against a database). Only failures of the model's answer or a provider input rejection are counted; reaching the limit marks the session given up (`<p>_outcome = 'given_up'`). **`summarized` / `facts_extracted` = true means the cron is finished with the session, not that a summary or fact exists**; `<p>_outcome` tells given up from done. To re-queue given-up sessions after the fix is deployed, reset the flag and every `<p>_` state column together in one update so the row passes the pair check.

### Signup path (`src/app/api/survey/route.ts`, logic in `src/lib/emailSignup.ts`)
- Email signups are created **unconfirmed** through `auth.admin.generateLink({ type: "signup" })` (also used by `/api/auth/resend-confirmation`, `resendConfirmation.ts`). For an existing unconfirmed user it issues a new token (the old one dies) and **overwrites `user_metadata`**; a confirmed user gets `email_exists`. `auth.admin.createUser` and `signUp()` have no call site; the other entry point is `signInWithOAuth`.
- Invariants in `createEmailAccount`: look up `users` by email first (a failed read is 500, never "no row"); **the emailed token is always made after its send claim** succeeds; a resignup uses the stored row's names, never the request's; a non-23505 insert failure rolls the Auth user back; a survey insert failure still answers 200 with `surveySaved: false`.
- **The confirmation email is ours** (Resend, `sendSignupConfirmationEmail`). `buildConfirmationLink` puts the token in the URL **fragment**; `/auth/callback` verifies (`verifyOtp`) only on a button press and strips the fragment on read.
- **Send limit:** every send first claims through `email_confirmation_claim` (migration `20261104120000_email_confirmation_sends.sql`), which fails closed, so the migration must be live before this code is deployed.
- `buildSurveyRow` writes only the monthly money answers and the credit-history answer, with the fixed columns; every other body key is ignored, so the table's other columns are not written by the app.

### Plaid (`src/lib/plaid.ts`, `src/app/api/plaid/`)
- `PLAID_ENV` (default sandbox) is read in one place. Transactions only; US only; multiple connections per user by `item_id`. Plaid auth deletes `body.userId` before use.
- **`AI_PLAID_STATE`** (`resolvePlaidStateMode()`, `plaidChatContext.ts`): anything but `connection` / `balances` is `off`. `off` closes both fresh-read paths into the chat prompt (the capability scaffold and the balance-keyword path); the financial-planning channel is denied unconditionally. **`off` does not reach bank figures already in stored history, summaries, facts or cron input.**
- `src/lib/plaidEgressPolicy.ts` (`evaluatePlaidEgressDecision`) is the single decision surface for Plaid data reaching the LLM; every channel in `PLAID_EGRESS_CHANNELS` must deny under `off`, which a test walks.
- **`plaid_connections.status` is unmaintained** (nothing writes it after insert), and the sealed bank-data block prints every row, errored ones included.
- **Revocation before row deletion, per connection.** `/api/plaid/disconnect`, `/api/account/delete` and the webhook's revocation call `itemRemove` and delete the row **only** on success; every failure keeps the row (`plaidRevocation.ts`, `accountDeletion.ts`, both tested by execution). Account deletion stops while any connection is un-revoked, after revoking the earlier ones, so a partial run is normal. The only Plaid rejection treated as success is `ITEM_NOT_FOUND` / `ITEM_ERROR` for a token from the deployment's environment (sandbox-observed). A delete that matched nothing is a logged success; a delete with no representation is a failure.
- **`/api/plaid/exchange-token`** (`plaidExchange.ts`) revokes the Item it just minted when it refuses it after the exchange — never an Item this user already has a row for, and not at all when that ownership read fails. A failed save revokes only when nothing can have been stored; otherwise the row is re-read (one retry): a row is success, no row is revoke, and an unreadable row leaves the Item unrevoked with `revoke=skipped reason=recheck_read_failed`. A `compensate=failed` or `recheck_read_failed` line is the only record of that Item.
- `plaid_connections` is service-role-only (migration `20261013120000_…`). Do not add policies or client grants; browser needs go through an API route.
- Access tokens are stored **encrypted** in `plaid_connections` (PL1), only through `src/lib/plaidTokenCrypto.ts`, as `v<n>:<iv>:<authTag>:<ciphertext>`; one key version is live at a time. **The AAD is `<version>:<user_id>`, with the id taken verbatim from the verified token**: a normalized id fails to decrypt, invisibly to `tsc` and unit tests. **Every failure is fail-closed, with no plaintext fallback and no exception** (account deletion included). A row that will not decrypt is usually recoverable by restoring the key; deleting it makes its Item unrevokable forever.
- Duplicate detection is application-level only (pre- and post-exchange by institution id, `active` rows only), and `CONNECTION_LIMIT` counts every row. There is deliberately no unique index.

### Households, share grants and goals
Migration `20261108120000_create_households_and_goals.sql`: `households`, `household_members`, `share_grants`, `goals`, all **service-role-only** with only the privileges current code uses. Do not add policies or client grants.
- `household_ensure_for_user` (wrapped by `ensureHouseholdForUser`, `householdEnsure.ts`) returns or creates the user's one-person household under a per-user advisory lock; there is no backfill, so a route that reads households should call it first.
- A goal is personal or joint, never both; amounts are integer cents. `share_grants.resource_id` has no foreign key.
- Deleting a user cascades to memberships, grants and personal goals; `household_delete_if_no_active_members` then deletes emptied households. That trigger function must stay SECURITY DEFINER, owned by the owner of `households`, or account deletion fails with 42501.

### Other API surfaces
- `src/app/api/admin/cron-runs` is operator tooling behind `requireAdmin()`. The catalog and bank-recommendation routes are removed; migration `20261104130000_drop_unused_legacy_tables.sql` drops their tables.
- **Account export** (`src/lib/accountExport.ts`) reads every section in keyset pages of `EXPORT_PAGE_SIZE`; that must not exceed the project's PostgREST Max rows, or sections truncate silently. It reads columns and tables added by the households, users-integrity and cron-retry migrations, so each must be applied before this code is deployed against a database, or every export answers 500.

### Demo surface (`src/app/demo/`)
Its own code touches no Supabase or database; state is `sessionStorage` only. `ClientLayout`'s auth listener still runs there. Keep real auth out of the demo. `docs/demo-mode.md` (`signInAnonymously()`) is stale.

### Country, i18n, theme, layout
- US only; `/survey` shows US dollars and reads no country from storage. English only: `LanguageContext` loads `messages/en.json` (top level) and renders nothing until mount, which keeps pages out of static prerender.
- No theme layer; colours are literals. `BottomNav` renders its own spacer, so it must stay last in a page's flow; bottom-pinned elements use its `BOTTOM_NAV_CLEARANCE`.
- `ClientLayout` renders only its children, removes leftover chat and Plaid keys on mount, and subscribes `handleAuthEventForLocalState` (`validation.ts`) so `SIGNED_OUT` runs `clearLocalAuthState()` (`clientLayoutAuthEvent.test.ts`).
- **Logout clears a small explicit list; most keys survive it.** Keys left by earlier builds (financial ones such as `noor_transactions` and `noor_budget` included) outlive logout; the account-deletion `noor_` prefix sweep removes them. `deal_upvoted_<id>` sits outside that prefix and nothing clears it.

### Rendering & security headers
Every `page.tsx` is `"use client"`. Security headers are set in `next.config.js` (`securityHeaders`). CSP is `frame-ancestors` only; a future script/style CSP **must be merged into the same header**. `Permissions-Policy` still allows `geolocation=(self)` though its user was removed.

## Models / OpenRouter
- **Live model configuration is env-driven and not recorded here.** In-code default constants are overridden by their env vars. The chat route has a primary and a fallback model on different lines (model, not provider, redundancy). The simple/complex split is skipped when `OPENROUTER_MODEL` is set, so group cost by the `model` column.
- **OpenRouter is the only provider path**; without `OPENROUTER_API_KEY` chat answers 503.
- **Every request carries routing preferences** (`src/lib/openRouterRequest.ts`): zero-data-retention, data-collecting providers denied, US-only endpoints. With no passing endpoint the call fails; the fix is pinning a model id with one in the model env vars, then redeploying.
- **Timeouts and budgets** live in `src/lib/llmTimeouts.ts`: per-attempt timeouts, a request budget (`CHAT_TIME_BUDGET_EXHAUSTED`), a pre-loop deadline and a save deadline. Values are unvalidated defaults.
- **All attempts failing gives one 502 `CHAT_MODEL_FAILED`**; no upstream status or text reaches the client. A provider 401 skips the fallback. Each attempt logs one `[chat-model]` line; read attempts one by one in `llm_calls` before assuming which model failed.
- **OpenRouter conventions:** `~` is required for `latest` aliases; pinned versions use dots, no tilde. Never guess a model ID. Model retirement is silent.
- **Parsers must absorb model output drift** (code fences, missing or renamed fields, extra text): skip and log, never crash or misstore.

## Key environment variables

Purposes only. **Values, and whether a variable is set, are live state.**

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase URL, anon key, service-role key (bypasses RLS) |
| `OPENROUTER_API_KEY` | AI provider credential |
| `OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODEL`; `OPENROUTER_SIMPLE_MODEL` / `OPENROUTER_COMPLEX_MODEL`; `SUMMARY_MODEL` / `EXTRACTION_MODEL` | Chat primary + fallback; simple/complex split (skipped when `OPENROUTER_MODEL` is set); cron models |
| `AI_SUPABASE_READ_ENABLED` | `"true"` loads the profile; **also gates memory and conversation history** |
| `AI_PLAID_STATE` | `off` / `connection` / `balances` |
| `CHAT_USAGE_LIMIT_MODE` | Exactly `off` or `observe` opts out; anything else enforces |
| `PLAID_LINK_TOKEN_LIMIT_MODE` | Per-user issue limit on new-connection link tokens (`plaidLinkTokenLimit.ts`). Exactly `off` skips it; anything else (unset included) enforces and fails closed with 503, so migration `20261113120000_plaid_link_token_issues.sql` must be applied before that code is deployed against a database (whether it is applied is live state) |
| `SIGNUP_DISABLED` | Exactly `"true"` blocks email signups; reverse polarity, fail-open |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | Plaid credentials + environment |
| `PLAID_TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for access tokens; same value wherever the same table is written; keep a copy outside Vercel |
| `PLAID_WEBHOOK_URL` | Webhook URL for new Items; Production's must carry no protection-bypass parameter; never logged |
| `RESEND_API_KEY` / `SMTP_FROM` / `SMTP_FROM_NAME` | Transactional email via Resend (`src/lib/email.ts`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | Not used by app code; kept for Supabase Custom SMTP |
| `CRON_SECRET` | Bearer token both cron routes require; unset or whitespace-only returns 503, mismatch 401 |
| `DEMO_DOMAIN` | Demo host gate; inert when unset |

## Security principles
- **Authentication ≠ authorization.** Past holes were "logged in but no permission check" or "trusted a client value." **Access control lives in service-role-only tables** (`admin_users`); never put admin flags on user-accessible tables.
- **UI hiding is not a security boundary; the API is** — but pages still need their own gate.
- **Client `userContext` and history are discarded** in `/api/chat`. Names go through `sanitizeNameField`; never reintroduce an ASCII-only name check.
- **Dead tables are live risk**; prefer dropping them. **RLS is meant to be on for every table**; actual RLS and policies are live state (`pg_policies`). The chat memory tables are meant to be written through the service-role client only.
- Where `20261107140000_close_default_privileges_for_client_roles.sql` is applied, new objects postgres creates start closed to client roles; a migration still grants what it needs explicitly and asserts the end state.
- **Verify that a threat vector exists before investing in the defense.** **Blast radius sets severity**: own data vs another user's.
- **`localStorage` is not a source of truth**; client guards keyed on it are display logic. Terms acceptance is recorded in localStorage only — do not describe consent as recorded server-side.
- **A silent failure is worse than an explicit error**; never report success on an unverified side effect. **Fire-and-forget means never sent** on Vercel: await side effects; email failure must not block the primary action.
- **Collect the minimum**; columns written and never read are collection without a purpose.

## Strategic decisions (so they aren't re-litigated)
- Do not gate launch on Plaid or legal answers; keep a fallback path that ships without them. Build defensively under legal uncertainty.
- A rebuilt recommendation engine stays rules-based; AI does input extraction and understanding only. AI advice quality is prompt-level work and the core differentiator; the remaining work is the reasoning scaffold.
- Limits on shared systems are agreed before they ship, live in code, and ship with an exact-match off switch. Mobile-first (the landing page excepted).

## Gotchas
- **Never read `package-lock.json` whole**; grep it.
- **`docs/` is stale and not a source of truth.** Read the code; ask the operator about past decisions.
- **A rolling usage window doesn't clear on redeploy**; switch the mode to stop refusals. **No migration here backfills**; populating existing rows is a separate manual step.
- **SMTP password = the `hello@noor.financial` mailbox password**; if reset, update Vercel and Supabase Custom SMTP. **The repo is at `C:\dev\noor`, outside OneDrive.** Impossible file behavior usually means another process holds the file.
- **`auth.uid()` against a `TEXT` column needs `auth.uid()::text`.** `plaid_connections.user_id` may be `TEXT` or uuid depending on whether `20261107130000_…` is applied; read the live type.
- **OAuth provider state and signup blocking are live configuration** at two independent layers (Supabase toggle for OAuth, `SIGNUP_DISABLED` for email). Verify both.
- **Git author, commit messages and branch names are weak evidence**; read the diff. **Soft wrap looks like a syntax error** in terminal and diff output; `cat` the file when in doubt.
- **Adding a feature can wake dormant configuration.** Re-review corrected code.
- **Grep here:** Git-for-Windows grep aborts on `-i` with multiple `-e` patterns (use `-E 'a|b'`); a `printf` format starting with `-` is an option; Git Bash `grep` strips CR unless `-U`.
- **Fintech SEO is YMYL**; don't serve the same content on two hosts.
