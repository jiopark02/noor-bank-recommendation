#!/usr/bin/env bash
# =============================================================================
# L0b — Second deterministic pass.
#
# WHY THIS EXISTS
#   Documentation can be accurate in every claim it makes and still be wrong
#   by omission: an inventory nobody enumerated contains no claim to check.
#   So this pass is mostly census -- routes, pages, directories, dependencies,
#   table references -- plus a few grep-level checks and a verbatim copy of
#   CLAUDE.md, so that later passes interpret facts instead of producing them.
#
# GUARANTEES
#   Reads the repository; writes only audit/L0b-evidence.txt and the scratch
#   file audit/.l0btmp, which is removed on exit. Tree-wide greps skip
#   files named .env or .env.*: a filter on file name, not content. Matched
#   lines from other files are written verbatim and can carry secret values. The
#   directory listings in section 22 do not filter by name, so a .env file
#   NAME can appear there.
#   A grep, find or listing that fails is written as FAILED, and its count as
#   UNKNOWN, never as 0; collection continues, the run exits 1, and the output
#   ends with the failure count. MATCH COUNT is a count of matching lines, not
#   of matches.
#
# USAGE (from anywhere inside the repository; the script moves to the
# repository root itself and stops with exit 2 if it cannot find it)
#   bash audit/L0b-evidence.sh
#
# EXIT STATUS
#   0 complete, no failures; 1 complete with failures recorded in the output;
#   2 could not start; 128+n interrupted by signal n (the output is marked
#   INCOMPLETE).
# =============================================================================

set -uo pipefail
# LC_ALL=C makes a bracket of raw bytes a byte range (section 25). It does not
# stop Git for Windows' grep 3.0 aborting (exit 134) on -i with more than one
# -e pattern, which happens under the C / POSIX locale; use -E 'a|b' instead.
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" \
  || { echo "L0b: cannot resolve the script directory" >&2; exit 2; }
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" \
  || { echo "L0b: the script is not inside a git repository" >&2; exit 2; }
cd "$ROOT" || { echo "L0b: cannot enter the repository root" >&2; exit 2; }
[ -f audit/L0b-evidence.sh ] \
  || { echo "L0b: audit/L0b-evidence.sh is not at the repository root" >&2; exit 2; }

OUT="audit/L0b-evidence.txt"
TMP="audit/.l0btmp"
FAILURES=0
GR_OUT=/dev/null
: > "$OUT" || { echo "L0b: cannot write $OUT" >&2; exit 2; }
: > "$TMP" || { echo "L0b: cannot write $TMP" >&2; exit 2; }

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

# dep_count <name> — one line: the name and how many lines under src/ import it
dep_count() {
  local n
  if gr "$TMP" -rnI "${EXCL[@]}" -E "from ['\"]${1}|require\(['\"]${1}" src; then
    n="$(wc -l < "$GR_OUT" | tr -d ' ')"
  else
    n="UNKNOWN (grep failed)"
  fi
  printf '%-40s matching lines: %s\n' "$1" "$n" >> "$OUT"
}

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

# deps_of <section> — package names declared in one package.json section
deps_of() {
  sed -n "/\"$1\"/,/^  }/p" package.json 2>/dev/null | grep -oE '"[^"]+":' | tr -d '":' \
    | grep -v "^$1\$"
  local rc=("${PIPESTATUS[@]}")
  # Any stage failing is a failure; a grep exit 1 (no names) is not
  if [ "${rc[0]}" -ne 0 ] || [ "${rc[1]}" -gt 1 ] || [ "${rc[2]}" -ne 0 ] \
     || [ "${rc[3]}" -gt 1 ]; then return 1; fi
  return 0
}

printf '%s\n' \
  "LOCAL EVIDENCE - DO NOT SHARE, COMMIT OR PUBLISH." \
  "It holds verbatim repository content (grep hits, CLAUDE.md, file listings), which can include secret values." \
  "A complete run ends with a FAILURES line and a closing banner; a file without them is incomplete." >> "$OUT"


# ---------------------------------------------------------------------------
section "20. API ROUTE CENSUS  (route.ts / route.tsx / route.js files under src/app)"
# ---------------------------------------------------------------------------
sub "every route.ts / route.tsx / route.js file under src/app, sorted"
find src/app -type f \( -name 'route.ts' -o -name 'route.tsx' -o -name 'route.js' \) 2>> "$OUT" \
  | sort >> "$OUT" || fail_note find "$?"
printf '%s\n' "[end]" >> "$OUT"

sub "count of route.ts files (route.tsx / route.js not counted)"
n="$(find src/app -type f -name 'route.ts' 2>/dev/null | wc -l | tr -d ' ')" || { fail_note find "$?"; n="UNKNOWN (find failed)"; }
printf '%s\n' "$n" >> "$OUT"

sub "lines declaring export [async] function <HTTP method> under src/app (export const forms not matched)"
gd -rnI "${EXCL[@]}" -E 'export (async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)' src/app
printf '%s\n' "[end]" >> "$OUT"


# ---------------------------------------------------------------------------
section "21. PAGE CENSUS"
# ---------------------------------------------------------------------------
sub "every page.tsx / page.ts / layout.tsx file under src/app, sorted"
find src/app -type f \( -name 'page.tsx' -o -name 'page.ts' -o -name 'layout.tsx' \) 2>> "$OUT" \
  | sort >> "$OUT" || fail_note find "$?"
printf '%s\n' "[end]" >> "$OUT"

sub "line counts of .ts / .tsx files under src, largest first (top 40)"
# -exec ... + makes find exit non-zero when wc does (-exec ... \; would not).
# It runs wc on many files at once, so wc's "total" lines are dropped and the
# column padding is stripped. awk instead of head: head closing the pipe early
# would fail the pipeline.
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -exec wc -l {} + 2>/dev/null \
  | awk '$2 != "total" { sub(/^ +/, ""); print }' | sort -rn | awk 'NR <= 40' >> "$OUT" \
  || fail_note "find / wc" "$?"
printf '%s\n' "[end]" >> "$OUT"


# ---------------------------------------------------------------------------
section "22. TOP-LEVEL DIRECTORY CENSUS"
# ---------------------------------------------------------------------------
sub "top-level entries"
ls -1a >> "$OUT" 2>&1 || fail_note ls "$?"
printf '%s\n' "[end]" >> "$OUT"

for d in docs messages scripts public supabase src .github
do
  sub "contents of $d (recursive, files only)"
  if [ -d "$d" ]; then
    find "$d" -type f 2>> "$OUT" | sort >> "$OUT" || fail_note find "$?"
    n="$(find "$d" -type f 2>/dev/null | wc -l | tr -d ' ')" || { fail_note find "$?"; n="UNKNOWN (find failed)"; }
    printf '%s\n' "--- FILE COUNT: $n" >> "$OUT"
  else
    printf '%s\n' "[absent]" >> "$OUT"
  fi
done

sub "every markdown file outside node_modules, .next, .git, audit and .claude"
find . -type f -name '*.md' \
  -not -path './node_modules/*' -not -path './.next/*' -not -path './.git/*' \
  -not -path './audit/*' -not -path './.claude/*' 2>> "$OUT" | sort >> "$OUT" || fail_note find "$?"
printf '%s\n' "[end]" >> "$OUT"


# ---------------------------------------------------------------------------
section "23. DEPENDENCY REFERENCE COUNTS"
# ---------------------------------------------------------------------------
# A name matches as a prefix: lines importing "<name>-foo" or "<name>/sub"
# count toward <name> too.
sub "declared dependencies: lines under src/ matching from '<name> or require('<name> (prefix match)"
if deps="$(deps_of dependencies)"; then
  [ -z "$deps" ] && printf '%s\n' "[none declared]" >> "$OUT"
  for d in $deps; do dep_count "$d"; done
else
  fail_note "reading package.json dependencies" 1
fi
printf '%s\n' "[end of dependencies]" >> "$OUT"

sub "declared devDependencies: lines under src/ matching from '<name> or require('<name> (prefix match)"
if ddeps="$(deps_of devDependencies)"; then
  [ -z "$ddeps" ] && printf '%s\n' "[none declared]" >> "$OUT"
  for d in $ddeps; do dep_count "$d"; done
else
  fail_note "reading package.json devDependencies" 1
fi
printf '%s\n' "[end of devDependencies]" >> "$OUT"


# ---------------------------------------------------------------------------
section "24. SYMBOL TEXT SEARCH  (possible leftovers; substring match)"
# ---------------------------------------------------------------------------
for p in Cursor cursor-rules '\.cursorrules' url.parse 'new URL(' \
         signInAnonymously signInWithOtp
do
  g "$p"
done


# ---------------------------------------------------------------------------
section "25. NON-ASCII CONTENT"
# ---------------------------------------------------------------------------
# Any byte 0x80-0xFF. Under LC_ALL=C a bracket of raw bytes is a byte range,
# so this needs neither -P (which refuses the C locale) nor a UTF-8 locale.
NONASCII=$'[\x80-\xFF]'

sub "files under src containing any non-ASCII byte, with per-file counts"
if gr "$TMP" -rl "${EXCL[@]}" "$NONASCII" src; then
  mapfile -t nonascii_files < <(sort "$GR_OUT")
  if [ "${#nonascii_files[@]}" -eq 0 ]; then
    printf '%s\n' "[no non-ASCII found under src]" >> "$OUT"
  fi
  for f in "${nonascii_files[@]}"; do
    if gr "$TMP" -c "$NONASCII" "$f"; then n="$(cat "$GR_OUT")"; else n="UNKNOWN (grep failed)"; fi
    printf '%-60s lines with non-ASCII: %s\n' "$f" "$n" >> "$OUT"
  done
fi
printf '%s\n' "[end]" >> "$OUT"

sub "non-ASCII lines that are comments (// or /* or *) under src"
if gr "$TMP" -rn "${EXCL[@]}" -E "^[[:space:]]*(//|/\\*|\\*).*${NONASCII}" src; then
  if [ -s "$GR_OUT" ]; then cat "$GR_OUT" >> "$OUT"; else printf '%s\n' "[none found]" >> "$OUT"; fi
fi
printf '%s\n' "[end]" >> "$OUT"


# ---------------------------------------------------------------------------
section "26. TODO / FIXME / HACK / XXX"
# ---------------------------------------------------------------------------
sub "every line under src containing TODO / FIXME / HACK / XXX (substring, no context lines)"
if gr "$TMP" -rnIE "${EXCL[@]}" '(TODO|FIXME|HACK|XXX)' src; then
  cat "$GR_OUT" >> "$OUT"
  printf '%s\n' "--- MATCH COUNT: $(wc -l < "$GR_OUT" | tr -d ' ')" >> "$OUT"
else
  cat "$GR_OUT" >> "$OUT"
  printf '%s\n' "--- MATCH COUNT: UNKNOWN (grep failed)" >> "$OUT"
fi


# ---------------------------------------------------------------------------
section "27. CLAUDE.md VERBATIM"
# ---------------------------------------------------------------------------
sub "CLAUDE.md with line numbers"
if [ -f CLAUDE.md ]; then cat -n CLAUDE.md >> "$OUT" || fail_note "cat CLAUDE.md" "$?"; else printf '%s\n' "[absent]" >> "$OUT"; fi

sub "every backticked identifier-shaped token in CLAUDE.md (candidates to verify against code)"
gr "$TMP" -oE '`[A-Za-z_][A-Za-z0-9_.]{2,}`' CLAUDE.md
tr -d '`' < "$GR_OUT" | sort -u >> "$OUT"
printf '%s\n' "[end]" >> "$OUT"


# ---------------------------------------------------------------------------
section "28. TABLE REFERENCE CENSUS  (.from('<literal>') text under src; dynamic names not matched, Array.from('x') would be)"
# ---------------------------------------------------------------------------
sub "every .from('...') literal target, with counts"
gr "$TMP" -rhoI "${EXCL[@]}" -E "\.from\(['\"][a-z_]+['\"]\)" src
sed -E "s/.*\(['\"]([a-z_]+)['\"]\).*/\1/" "$GR_OUT" | sort | uniq -c | sort -rn >> "$OUT"
printf '%s\n' "[end]" >> "$OUT"

sub "every .rpc('...') literal target"
gd -rnoI "${EXCL[@]}" -E "\.rpc\(['\"][a-z_]+['\"]" src
printf '%s\n' "[end]" >> "$OUT"


printf '\n--- FAILURES: %s (commands that failed; their results above are UNKNOWN, not 0)\n' "$FAILURES" >> "$OUT"
printf '\n\n================================================================\n' >> "$OUT"
printf '== END OF L0b EVIDENCE\n' >> "$OUT"
printf '================================================================\n' >> "$OUT"

echo "Wrote $OUT"
wc -l "$OUT"
if [ "$FAILURES" -gt 0 ]; then
  echo "L0b: $FAILURES command(s) failed; their results are recorded as FAILED / UNKNOWN in $OUT" >&2
  exit 1
fi
exit 0
