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
#   - Writes audit/L0-evidence.txt and the scratch file audit/.l0tmp, which is
#     removed on exit; nothing else in the working tree. No git ref is
#     modified; git status may still refresh .git/index.
#   - Never exits early on a no-match grep: absence of a match is itself data.
#   - A grep that fails (exit 2 or more: a missing path, a bad pattern, an
#     abort) is written as FAILED with its stderr, and its count as UNKNOWN,
#     never as 0. A failed git command or listing is written the same way.
#     Collection continues past a failure; the run then exits 1, and the
#     output ends with the failure count. MATCH COUNT is a count of matching
#     lines, not of matches.
#   - Tree-wide greps skip files named .env or .env.*: a filter on file name,
#     not content. Anything else written verbatim, grep hits included, can
#     carry a secret VALUE; nothing here keeps values out of the output.
#   - The output records no working-directory path and no commit author name.
#     Commit subjects are written verbatim and can still name a GitHub login
#     (a merge subject names the source branch's owner).
#
# PREREQUISITE (run manually first — needs network, so not done here)
#   git fetch --all
#
# USAGE (from anywhere inside the repository; the script moves to the
# repository root itself and stops with exit 2 if it cannot find it)
#   bash audit/L0-evidence.sh
#
# EXIT STATUS
#   0 complete, no failures; 1 complete with failures recorded in the output;
#   2 could not start; 128+n interrupted by signal n (the output is marked
#   INCOMPLETE).
#
# OUTPUT
#   audit/L0-evidence.txt
#   audit/.l0tmp (scratch; removed on exit, including an interrupted one)
# =============================================================================

set -uo pipefail

# Git for Windows' grep 3.0 aborts (SIGABRT, exit 134) when -i is combined
# with more than one -e pattern under the C / POSIX locale, unset included;
# LC_ALL=C does not avoid it. Use -E 'a|b' instead. LC_ALL=C is kept for
# byte-wise matching, the same as L0b, whose section 25 needs a byte range.
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" \
  || { echo "L0: cannot resolve the script directory" >&2; exit 2; }
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" \
  || { echo "L0: the script is not inside a git repository" >&2; exit 2; }
cd "$ROOT" || { echo "L0: cannot enter the repository root" >&2; exit 2; }
[ -f audit/L0-evidence.sh ] \
  || { echo "L0: audit/L0-evidence.sh is not at the repository root" >&2; exit 2; }

OUT="audit/L0-evidence.txt"
TMP="audit/.l0tmp"
FAILURES=0
GR_OUT=/dev/null
: > "$OUT" || { echo "L0: cannot write $OUT" >&2; exit 2; }
: > "$TMP" || { echo "L0: cannot write $TMP" >&2; exit 2; }

cleanup() { rm -f "$TMP"; }
on_signal() {
  printf '\n\n== INCOMPLETE: interrupted by %s. This file is not a complete run.\n' "$1" >> "$OUT"
  cleanup
  trap - EXIT
  exit "$2"
}
trap cleanup EXIT
trap 'on_signal SIGINT 130' INT
trap 'on_signal SIGTERM 143' TERM
trap 'on_signal SIGHUP 129' HUP

EXCL=(--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
      --exclude-dir=.vercel --exclude-dir=coverage --exclude-dir=audit
      --exclude-dir=.claude
      --exclude=.env --exclude=.env.*)

section() { printf '\n\n================================================================\n== %s\n================================================================\n' "$1" >> "$OUT"; }
sub()     { printf '\n---- %s\n' "$1" >> "$OUT"; }

# fail_note <what> <exit status> — record a failed command and count it
fail_note() {
  FAILURES=$((FAILURES + 1))
  printf '[%s FAILED (exit %s): result unknown, not evidence of absence]\n' "$1" "$2" >> "$OUT"
}

# gr <dest> <grep args...> — run grep with its stdout in <dest>, and set
# GR_OUT to the file callers read the result from. Exit 1 (no line matched)
# is a result. A failure is recorded with grep's stderr and gr returns 1:
# exit 2 or more; exit 1 with anything on stderr (a failed redirect also
# exits 1, before grep runs); or <dest> not writable, in which case GR_OUT is
# /dev/null so that an earlier result left in <dest> is never read.
gr() {
  local dest="$1"; shift
  local err rc
  GR_OUT=/dev/null
  if ! { : > "$dest"; } 2>/dev/null; then
    fail_note "writing $dest" 1
    return 1
  fi
  GR_OUT="$dest"
  err="$(grep "$@" 2>&1 > "$dest")"; rc=$?
  if [ "$rc" -eq 0 ] || { [ "$rc" -eq 1 ] && [ -z "$err" ]; }; then return 0; fi
  fail_note grep "$rc"
  [ -n "$err" ] && printf '%s\n' "$err" | sed 's/^/[grep stderr] /' >> "$OUT"
  return 1
}

# gd <grep args...> — grep and append the hits verbatim, with no count
gd() {
  gr "$TMP" "$@"
  cat "$GR_OUT" >> "$OUT"
}

# run <label> <command...>  — record a command and its full output
run() {
  local label="$1"; shift
  local rc=0
  sub "CMD: $label"
  printf '$ %s\n' "$*" >> "$OUT"
  "$@" >> "$OUT" 2>&1 || rc=$?
  [ "$rc" -ne 0 ] && fail_note command "$rc"
}

# g <pattern> — grep the tree, append hits, then append an explicit count
g() {
  local pattern="$1"
  printf '%s\n' "" "--- pattern: $pattern" >> "$OUT"
  if gr "$TMP" -rnI "${EXCL[@]}" -e "$pattern" .; then
    cat "$GR_OUT" >> "$OUT"
    printf '%s\n' "--- MATCH COUNT: $(wc -l < "$GR_OUT" | tr -d ' ')" >> "$OUT"
  else
    cat "$GR_OUT" >> "$OUT"
    printf '%s\n' "--- MATCH COUNT: UNKNOWN (grep failed; any lines above are partial)" >> "$OUT"
  fi
}

# gc <pattern> — count only (for patterns whose hits are too numerous to dump)
gc() {
  local pattern="$1"
  local n
  if gr "$TMP" -rnI "${EXCL[@]}" -e "$pattern" .; then
    n="$(wc -l < "$GR_OUT" | tr -d ' ')"
  else
    n="UNKNOWN (grep failed)"
  fi
  printf '\n--- pattern (count only): %-45s MATCH COUNT: %s\n' "$pattern" "$n" >> "$OUT"
}

# exists <path> — report presence/absence of a path. A directory is PRESENT
# only when it has at least one entry; an empty one is reported as EMPTY.
exists() {
  local entries rc
  if [ -d "$1" ]; then
    entries="$(ls -A "$1" 2>/dev/null)"; rc=$?
    if [ "$rc" -ne 0 ]; then
      fail_note "ls $1" "$rc"
    elif [ -n "$entries" ]; then
      printf 'PRESENT  %s  [directory, not empty]\n' "$1" >> "$OUT"
    else
      printf 'EMPTY    %s  [directory, no entries]\n' "$1" >> "$OUT"
    fi
  elif [ -e "$1" ]; then printf 'PRESENT  %s\n' "$1" >> "$OUT"
  else                   printf 'ABSENT   %s\n' "$1" >> "$OUT"; fi
}

printf '%s\n' \
  "LOCAL EVIDENCE - DO NOT SHARE, COMMIT OR PUBLISH." \
  "It holds verbatim repository content (grep hits, config files), which can include secret values." \
  "A complete run ends with a FAILURES line and a closing banner; a file without them is incomplete." >> "$OUT"

# ---------------------------------------------------------------------------
section "00. PROVENANCE"
# ---------------------------------------------------------------------------
sub "collected at"
date -u '+%Y-%m-%dT%H:%M:%SZ' >> "$OUT" || fail_note date "$?"


# ---------------------------------------------------------------------------
section "01. GIT STATE"
# ---------------------------------------------------------------------------
run "current branch"        git rev-parse --abbrev-ref HEAD
run "HEAD"                  git log -1 --format=%H%n%ad%n%s
run "working tree dirty?"   git status --porcelain
run "all branches"          git branch -a -v
run "commits since 2026-08-01 (all refs)" \
    git log --all --date=short --pretty=format:'%h %ad %d %s' --since=2026-08-01
run "commits on origin/main not on local main" \
    git log --oneline main..origin/main
run "commits on local main not on origin/main" \
    git log --oneline origin/main..main
run "working tree vs main's upstream (name-status)" \
    git diff --name-status main@{u} --


# ---------------------------------------------------------------------------
section "02. SYMBOL CENSUS  (every line containing the symbol text; substring match, not definitions vs references)"
# ---------------------------------------------------------------------------
# Expected: no hit under src/ or supabase/ for signInAnonymously, signUp,
# validateName (CLAUDE.md says no call site), signInWithOtp (an account entry
# point CLAUDE.md does not list) and url.parse (deprecated Node API).
# bcrypt (the legacy password_hash path was removed) has exactly one hit under
# src/: the regex literal text "\bcrypto" in
# src/lib/__tests__/financeEngineBoundary.test.ts, not a bcrypt reference.
# The tree-wide count is not 0: CLAUDE.md, docs/ and messages/*.json mention
# some of these.
for sym in \
  signInAnonymously signInWithOtp signUp createUser \
  validateName sanitizeNameField acceptTerms \
  resolvePlaidStateMode reserveChatUsage resolveChatUsageMode \
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

sub "glob: any directory named terms/privacy/legal/tos under src/app"
find src/app -type d \( -name terms -o -name privacy -o -name legal -o -name tos \) -print >> "$OUT" 2>&1 \
  || fail_note find "$?"
printf '[end of find]\n' >> "$OUT"


# ---------------------------------------------------------------------------
section "04. MIGRATIONS  (filenames, duplicate-timestamp detection, key columns)"
# ---------------------------------------------------------------------------
sub "migration files, sorted"
ls -1 supabase/migrations >> "$OUT" 2>&1 || fail_note ls "$?"
printf '[end of listing]\n' >> "$OUT"

sub "timestamp prefixes with a count > 1 (duplicate detection)"
{ ls -1 supabase/migrations 2>/dev/null \
  | sed -E 's/^([0-9]+).*/\1/' \
  | sort | uniq -c | awk '$1 > 1' >> "$OUT"; } || fail_note "ls pipeline" "$?"
printf '[end of duplicate scan]\n' >> "$OUT"

sub "column-name patterns across all migrations"
# Expected 0: consent, terms_accepted, agreed_at, policy_version, consented_at, confirmation_sent_at (CLAUDE.md: no column stores terms acceptance).
for col in consent terms_accepted agreed_at policy_version consented_at \
           confirmation_sent_at access_token encrypted institution_id \
           ip_address user_agent input_tokens output_tokens
do
  if gr "$TMP" -rniI -e "$col" supabase/migrations; then
    n="$(wc -l < "$GR_OUT" | tr -d ' ')"
  else
    n="UNKNOWN (grep failed)"
  fi
  printf '%-24s MATCH COUNT: %s\n' "$col" "$n" >> "$OUT"
  cat "$GR_OUT" >> "$OUT"
done

sub "unique / index declarations across all migrations"
gd -rniIE 'unique|create index' supabase/migrations
printf '[end]\n' >> "$OUT"


# ---------------------------------------------------------------------------
section "05. CONFIG FILES — VERBATIM WITH LINE NUMBERS"
# ---------------------------------------------------------------------------
for f in next.config.js vercel.json tsconfig.json package.json .github/workflows/test.yml
do
  sub "FILE: $f"
  if [ -f "$f" ]; then cat -n "$f" >> "$OUT" || fail_note "cat $f" "$?"; else printf '[absent]\n' >> "$OUT"; fi
done

sub "package.json lines mentioning bcrypt / plaid / resend / supabase / leaflet"
gd -niIE 'bcrypt|plaid|resend|supabase|leaflet' package.json
printf '[end]\n' >> "$OUT"

sub "lockfileVersion"
gd -m1 -niI 'lockfileVersion' package-lock.json
printf '[end]\n' >> "$OUT"


# ---------------------------------------------------------------------------
section "06. ROUTE REFERENCES  (literals with 2 lines of context either side)"
# ---------------------------------------------------------------------------
for route in '"/survey"' "'/survey'" '"/waitlist"' '"/login"' '"/demo"' '"/dashboard"'
do
  printf '\n--- route literal: %s  (context -B2 -A2)\n' "$route" >> "$OUT"
  gd -rnI "${EXCL[@]}" -B2 -A2 -e "$route" src
  if gr "$TMP" -rnI "${EXCL[@]}" -e "$route" src; then
    n="$(wc -l < "$GR_OUT" | tr -d ' ')"
  else
    n="UNKNOWN (grep failed)"
  fi
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
sub "process.env.NAME dot-access names in src (unique, sorted; bracket access not matched)"
gr "$TMP" -rhoI "${EXCL[@]}" -e 'process\.env\.[A-Z0-9_]*' src
sed 's/process\.env\.//' "$GR_OUT" | sort -u >> "$OUT"
printf '[end of env var list]\n' >> "$OUT"

sub "AI_PLAID_STATE references"
g 'AI_PLAID_STATE'

sub "chat route lines matching messages|system|push(|contextBlock|prompt"
gd -nIE 'messages|system|push\(|contextBlock|prompt' src/app/api/chat/route.ts
printf '[end]\n' >> "$OUT"

sub "OpenRouter / Anthropic endpoint literals"
# Expected 0: api.anthropic.com and ANTHROPIC_API_KEY (CLAUDE.md: OpenRouter is the only provider path).
for p in 'openrouter.ai' 'api.anthropic.com' 'OPENROUTER_' 'ANTHROPIC_API_KEY'
do
  g "$p"
done

sub "lines containing from('<table>') for chat_messages / user_facts / chat_summaries / plaid_connections / users / survey_responses / waitlist_signups"
# Basic regex; [\"'] matches either quote style used for the table name.
for p in "from([\"']chat_messages[\"'])" "from([\"']user_facts[\"'])" \
         "from([\"']chat_summaries[\"'])" "from([\"']plaid_connections[\"'])" \
         "from([\"']users[\"'])" "from([\"']survey_responses[\"'])" \
         "from([\"']waitlist_signups[\"'])"
do
  g "$p"
done


# ---------------------------------------------------------------------------
section "08. CLIENT STORAGE KEYS"
# ---------------------------------------------------------------------------
sub "every line under src mentioning localStorage / sessionStorage, with context"
gd -rnIE "${EXCL[@]}" -B1 -A1 'localStorage|sessionStorage' src
printf '[end]\n' >> "$OUT"

sub "noor_* tokens under src, with counts (any text shaped like a storage key, not only keys)"
gr "$TMP" -rhoI "${EXCL[@]}" -e "noor_[a-zA-Z0-9_]*" src
sort "$GR_OUT" | uniq -c >> "$OUT"
printf '[end]\n' >> "$OUT"


# ---------------------------------------------------------------------------
section "09. CONSENT / POLICY TEXT SURFACE"
# ---------------------------------------------------------------------------
# Expected 0: noorapp.com (stale contact domain; copy was moved to noor.financial in 2760c82 and cd915e1).
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
gd -nI -A40 -e 'securityHeaders' next.config.js
printf '[end]\n' >> "$OUT"

# Not expected 0. The six header names are set in next.config.js, so src/ and supabase/ hold no hit for them.
# 'nonce' is a common word and does hit src/ (e.g. the GCM nonce in src/lib/plaidTokenCrypto.ts).
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
# Expected: no hit under src/ for AI_MEMORY_ENABLED (CLAUDE.md: referenced nowhere in code); CLAUDE.md and docs/ mention it.
for p in 'CRON_SECRET' 'CHAT_USAGE_LIMIT_MODE' 'CHAT_USAGE_LIMITS' \
         'SIGNUP_DISABLED' 'AI_SUPABASE_READ_ENABLED' 'AI_MEMORY_ENABLED' \
         'requireAdmin' 'createAdminClient' 'service_role' 'SUPABASE_SERVICE_ROLE'
do
  g "$p"
done


# ---------------------------------------------------------------------------
section "13. TEST SURFACE"
# ---------------------------------------------------------------------------
sub "files named *.test.* / *.spec.* under src, test, tests, __tests__"
test_dirs=()
for d in src test tests __tests__; do [ -d "$d" ] && test_dirs+=("$d"); done
if [ "${#test_dirs[@]}" -gt 0 ]; then
  find "${test_dirs[@]}" -type f \( -name '*.test.*' -o -name '*.spec.*' \) -print >> "$OUT" 2>&1 \
    || fail_note find "$?"
else
  printf '[none of src, test, tests, __tests__ exists]\n' >> "$OUT"
fi
printf '[end of find]\n' >> "$OUT"


printf '\n--- FAILURES: %s (commands that failed; their results above are UNKNOWN, not 0)\n' "$FAILURES" >> "$OUT"
printf '\n\n================================================================\n' >> "$OUT"
printf '== END OF L0 EVIDENCE\n' >> "$OUT"
printf '================================================================\n' >> "$OUT"

echo "Wrote $OUT"
wc -l "$OUT"
if [ "$FAILURES" -gt 0 ]; then
  echo "L0: $FAILURES command(s) failed; their results are recorded as FAILED / UNKNOWN in $OUT" >&2
  exit 1
fi
exit 0
