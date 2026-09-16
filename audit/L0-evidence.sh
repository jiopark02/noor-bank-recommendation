#!/usr/bin/env bash
# =============================================================================
# L0 — Deterministic evidence collector for codebase state.
#
# PURPOSE
#   Emit raw, uninterpreted evidence (grep hits, file listings, verbatim config)
#   so that later LLM passes interpret facts instead of producing them.
#   Collection does not interpret results. What to search for is the author's
#   choice, and anything not listed below is not searched.
#
# GUARANTEES
#   - Writes audit/L0-evidence.txt and the scratch file audit/.l0tmp, which a
#     completed run removes; nothing else in the working tree. No git ref is
#     modified; git status may still refresh .git/index.
#   - Never exits early on a no-match grep: absence of a match is itself data.
#   - g, gc, and the route-literal and migration-column loops print a match
#     count taken from grep's stdout only (stderr dropped, exit status unchecked),
#     so a failed grep also prints 0. The remaining dumps carry no count.
#   - Tree-wide greps skip files named .env or .env.*: a filter on file name,
#     not content. Anything else written verbatim, grep hits included, can
#     carry a secret VALUE; nothing here keeps values out of the output.
#
# PREREQUISITE (run manually first — needs network, so not done here)
#   git fetch --all
#
# USAGE (from repository root)
#   bash audit/L0-evidence.sh
#
# OUTPUT
#   audit/L0-evidence.txt
#   audit/.l0tmp (scratch; removed at the end of a completed run)
# =============================================================================

set -uo pipefail

# Git for Windows ships an MSYS2 grep that can abort (SIGABRT) inside its
# UTF-8 collation path when -i is combined with multiple -e patterns.
# Byte-based matching avoids that code path entirely. All patterns here are
# ASCII identifiers, so nothing is lost.
export LC_ALL=C

OUT="audit/L0-evidence.txt"
mkdir -p audit
: > "$OUT"

EXCL=(--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
      --exclude-dir=.vercel --exclude-dir=coverage --exclude-dir=audit
      --exclude-dir=.claude
      --exclude=.env --exclude=.env.*)

section() { printf '\n\n================================================================\n== %s\n================================================================\n' "$1" >> "$OUT"; }
sub()     { printf '\n---- %s\n' "$1" >> "$OUT"; }

# run <label> <command...>  — record a command and its full output
run() {
  local label="$1"; shift
  sub "CMD: $label"
  printf '$ %s\n' "$*" >> "$OUT"
  "$@" >> "$OUT" 2>&1 || printf '[command exited non-zero: %s]\n' "$?" >> "$OUT"
}

# g <pattern> — grep the tree, append hits, then append an explicit count
g() {
  local pattern="$1"
  local tmp="audit/.l0tmp"
  : > "$tmp"
  grep -rnI "${EXCL[@]}" -e "$pattern" . > "$tmp" 2>/dev/null
  printf '%s\n' "" "--- pattern: $pattern" >> "$OUT"
  cat "$tmp" >> "$OUT"
  printf '%s\n' "--- MATCH COUNT: $(wc -l < "$tmp" | tr -d ' ')" >> "$OUT"
}

# gc <pattern> — count only (for patterns whose hits are too numerous to dump)
gc() {
  local pattern="$1"
  local n
  n="$(grep -rnI "${EXCL[@]}" -e "$pattern" . 2>/dev/null | wc -l | tr -d ' ')"
  printf '\n--- pattern (count only): %-45s MATCH COUNT: %s\n' "$pattern" "$n" >> "$OUT"
}

# exists <path> — report presence/absence of a path
exists() {
  if [ -e "$1" ]; then printf 'PRESENT  %s\n' "$1" >> "$OUT"
  else                 printf 'ABSENT   %s\n' "$1" >> "$OUT"; fi
}

# ---------------------------------------------------------------------------
section "00. PROVENANCE"
# ---------------------------------------------------------------------------
sub "collected at"
date -u '+%Y-%m-%dT%H:%M:%SZ' >> "$OUT"
sub "working directory"
pwd >> "$OUT"


# ---------------------------------------------------------------------------
section "01. GIT STATE"
# ---------------------------------------------------------------------------
run "current branch"        git rev-parse --abbrev-ref HEAD
run "HEAD"                  git log -1 --format=%H%n%ad%n%an%n%s
run "working tree dirty?"   git status --porcelain
run "all branches"          git branch -a -v
run "commits since 2026-08-01 (all refs)" \
    git log --all --date=short --pretty=format:'%h %ad %an %d %s' --since=2026-08-01
run "commits on origin/main not on local main" \
    git log --oneline main..origin/main
run "commits on local main not on origin/main" \
    git log --oneline origin/main..main
run "working tree vs main's upstream (name-status)" \
    git diff --name-status main@{u} --
run "branch ui-redesign-glass-wip: file list vs main (name only)" \
    git diff --name-only main...origin/ui-redesign-glass-wip


# ---------------------------------------------------------------------------
section "02. SYMBOL CENSUS  (definition + every reference, per symbol)"
# ---------------------------------------------------------------------------
for sym in \
  downloadUserData isSessionValid isInactivityWarning \
  signInAnonymously signInWithOtp signUp createUser \
  validateName sanitizeNameField acceptTerms \
  resolvePlaidStateMode getRecentChatTurnCount resolveChatRateLimit \
  isAiMemoryEnabled isSignupDisabled \
  getSessionSafe getSession onAuthStateChange getUser \
  itemRemove mapAccountType mapAccountKind buildBalanceSummary \
  isBalanceQuestion isFinancialPlanningQuestion isComplexPrompt \
  bcrypt url.parse
do
  g "$sym"
done


# ---------------------------------------------------------------------------
section "03. PATH EXISTENCE"
# ---------------------------------------------------------------------------
for p in \
  src/app/terms src/app/privacy src/app/legal src/app/tos \
  src/app/api/login src/app/api/forgot-password src/app/api/reset-password \
  src/lib/auth.ts src/middleware.ts next.config.js vercel.json tsconfig.json \
  package.json package-lock.json .github/workflows/test.yml \
  supabase/migrations CLAUDE.md .claude .claude/agents .claude/skills
do
  exists "$p"
done

sub "glob: any file under a terms/privacy/legal/tos route segment"
find src/app -type d \( -name terms -o -name privacy -o -name legal -o -name tos \) -print >> "$OUT" 2>&1
printf '[end of find]\n' >> "$OUT"


# ---------------------------------------------------------------------------
section "04. MIGRATIONS  (filenames, duplicate-timestamp detection, key columns)"
# ---------------------------------------------------------------------------
sub "migration files, sorted"
ls -1 supabase/migrations 2>/dev/null >> "$OUT"
printf '[end of listing]\n' >> "$OUT"

sub "timestamp prefixes with a count > 1 (duplicate detection)"
ls -1 supabase/migrations 2>/dev/null \
  | sed -E 's/^([0-9]+).*/\1/' \
  | sort | uniq -c | awk '$1 > 1' >> "$OUT"
printf '[end of duplicate scan]\n' >> "$OUT"

sub "column-name patterns across all migrations"
for col in consent terms_accepted agreed_at policy_version consented_at \
           confirmation_sent_at access_token encrypted institution_id \
           ip_address user_agent input_tokens output_tokens
do
  n="$(grep -rniI -e "$col" supabase/migrations 2>/dev/null | wc -l | tr -d ' ')"
  printf '%-24s MATCH COUNT: %s\n' "$col" "$n" >> "$OUT"
  grep -rniI -e "$col" supabase/migrations 2>/dev/null >> "$OUT"
done

sub "unique / index declarations across all migrations"
grep -rniIE 'unique|create index' supabase/migrations 2>/dev/null >> "$OUT"
printf '[end]\n' >> "$OUT"


# ---------------------------------------------------------------------------
section "05. CONFIG FILES — VERBATIM WITH LINE NUMBERS"
# ---------------------------------------------------------------------------
for f in next.config.js vercel.json tsconfig.json package.json .github/workflows/test.yml
do
  sub "FILE: $f"
  if [ -f "$f" ]; then cat -n "$f" >> "$OUT"; else printf '[absent]\n' >> "$OUT"; fi
done

sub "package.json dependency lines mentioning bcrypt / plaid / resend / supabase"
grep -niIE 'bcrypt|plaid|resend|supabase|leaflet' package.json 2>/dev/null >> "$OUT"
printf '[end]\n' >> "$OUT"

sub "lockfileVersion"
grep -m1 -niI 'lockfileVersion' package-lock.json 2>/dev/null >> "$OUT"
printf '[end]\n' >> "$OUT"


# ---------------------------------------------------------------------------
section "06. ROUTE REFERENCES  (literals with 2 lines of context either side)"
# ---------------------------------------------------------------------------
for route in '"/survey"' "'/survey'" '"/waitlist"' '"/login"' '"/demo"' '"/dashboard"'
do
  printf '\n--- route literal: %s  (context -B2 -A2)\n' "$route" >> "$OUT"
  grep -rnI "${EXCL[@]}" -B2 -A2 -e "$route" src 2>/dev/null >> "$OUT"
  n="$(grep -rnI "${EXCL[@]}" -e "$route" src 2>/dev/null | wc -l | tr -d ' ')"
  printf '%s\n' "--- MATCH COUNT: $n" >> "$OUT"
done

sub "navigation mechanism census"
for m in 'router.push' 'router.replace' 'redirect(' '<Link' 'href=' 'useEffect'
do
  gc "$m"
done


# ---------------------------------------------------------------------------
section "07. AI / PLAID EGRESS SURFACE"
# ---------------------------------------------------------------------------
sub "environment variables read anywhere in src (unique, sorted)"
grep -rhoI "${EXCL[@]}" -e 'process\.env\.[A-Z0-9_]*' src 2>/dev/null \
  | sed 's/process\.env\.//' | sort -u >> "$OUT"
printf '[end of env var list]\n' >> "$OUT"

sub "AI_PLAID_STATE references"
g 'AI_PLAID_STATE'

sub "prompt assembly / message construction sites in the chat route"
grep -nIE 'messages|system|push\(|contextBlock|prompt' \
  src/app/api/chat/route.ts 2>/dev/null >> "$OUT"
printf '[end]\n' >> "$OUT"

sub "OpenRouter / Anthropic endpoint literals"
for p in 'openrouter.ai' 'api.anthropic.com' 'OPENROUTER_' 'ANTHROPIC_API_KEY'
do
  g "$p"
done

sub "chat_messages / user_facts / chat_summaries write sites"
for p in "from('chat_messages')" "from('user_facts')" "from('chat_summaries')" \
         "from('plaid_connections')" "from('users')" "from('survey_responses')" \
         "from('waitlist_signups')"
do
  g "$p"
done


# ---------------------------------------------------------------------------
section "08. CLIENT STORAGE KEYS"
# ---------------------------------------------------------------------------
sub "every localStorage / sessionStorage call with context"
grep -rnIE "${EXCL[@]}" -B1 -A1 'localStorage|sessionStorage' src 2>/dev/null >> "$OUT"
printf '[end]\n' >> "$OUT"

sub "string literals that look like storage keys (noor_*)"
grep -rhoI "${EXCL[@]}" -e "noor_[a-zA-Z0-9_]*" src 2>/dev/null | sort | uniq -c >> "$OUT"
printf '[end]\n' >> "$OUT"


# ---------------------------------------------------------------------------
section "09. CONSENT / POLICY TEXT SURFACE"
# ---------------------------------------------------------------------------
for p in 'international student' 'International Student' 'noorapp.com' \
         'privacy@' 'Last updated' 'industry-standard' 'never sell' \
         'terms_accepted' 'noor_terms_accepted'
do
  g "$p"
done


# ---------------------------------------------------------------------------
section "10. SECURITY HEADERS / CSP — VERBATIM"
# ---------------------------------------------------------------------------
sub "next.config.js header block with line numbers (already dumped in 05; isolated here)"
grep -nI -A40 -e 'securityHeaders' next.config.js 2>/dev/null >> "$OUT"
printf '[end]\n' >> "$OUT"

for p in 'Strict-Transport-Security' 'Content-Security-Policy' 'X-Frame-Options' \
         'Permissions-Policy' 'Referrer-Policy' 'X-Content-Type-Options' 'nonce'
do
  g "$p"
done


# ---------------------------------------------------------------------------
section "11. BRAND / COPY CASING"
# ---------------------------------------------------------------------------
sub "brand token casing counts"
for p in 'NOOR' 'Noor' '\bnoor\b'
do
  gc "$p"
done


# ---------------------------------------------------------------------------
section "12. CRON / RATE LIMIT / AUTH GATES"
# ---------------------------------------------------------------------------
for p in 'CRON_SECRET' 'CHAT_RATE_LIMIT_ENABLED' 'CHAT_MAX_REQUESTS_PER_HOUR' \
         'SIGNUP_DISABLED' 'AI_SUPABASE_READ_ENABLED' 'AI_MEMORY_ENABLED' \
         'requireAdmin' 'createAdminClient' 'service_role' 'SUPABASE_SERVICE_ROLE'
do
  g "$p"
done


# ---------------------------------------------------------------------------
section "13. TEST SURFACE"
# ---------------------------------------------------------------------------
sub "test files"
find src test tests __tests__ -type f \( -name '*.test.*' -o -name '*.spec.*' \) -print 2>/dev/null >> "$OUT"
printf '[end of find]\n' >> "$OUT"


printf '\n\n================================================================\n' >> "$OUT"
printf '== END OF L0 EVIDENCE\n' >> "$OUT"
printf '================================================================\n' >> "$OUT"

rm -f audit/.l0tmp

echo "Wrote $OUT"
wc -l "$OUT"
