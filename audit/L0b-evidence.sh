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
#   file audit/.l0btmp, which a completed run removes. Tree-wide greps skip
#   files named .env or .env.*: a filter on file name, not content. Matched
#   lines from other files are written verbatim and can carry secret values. The
#   directory listings in section 22 do not filter by name, so a .env file
#   NAME can appear there.
#
# USAGE (from repository root)
#   bash audit/L0b-evidence.sh
# =============================================================================

set -uo pipefail
export LC_ALL=C

OUT="audit/L0b-evidence.txt"
mkdir -p audit
: > "$OUT"

EXCL=(--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
      --exclude-dir=.vercel --exclude-dir=coverage --exclude-dir=audit
      --exclude-dir=.claude
      --exclude=.env --exclude=.env.*)

section() { printf '\n\n================================================================\n== %s\n================================================================\n' "$1" >> "$OUT"; }
sub()     { printf '\n---- %s\n' "$1" >> "$OUT"; }

g() {
  local pattern="$1"
  local tmp="audit/.l0btmp"
  : > "$tmp"
  grep -rnI "${EXCL[@]}" -e "$pattern" . > "$tmp" 2>/dev/null
  printf '%s\n' "" "--- pattern: $pattern" >> "$OUT"
  cat "$tmp" >> "$OUT"
  printf '%s\n' "--- MATCH COUNT: $(wc -l < "$tmp" | tr -d ' ')" >> "$OUT"
}


# ---------------------------------------------------------------------------
section "20. API ROUTE CENSUS  (complete endpoint inventory)"
# ---------------------------------------------------------------------------
sub "every route file under src/app, sorted"
find src/app -type f \( -name 'route.ts' -o -name 'route.tsx' -o -name 'route.js' \) \
  | sort >> "$OUT" 2>&1
printf '%s\n' "[end]" >> "$OUT"

sub "count of route files"
find src/app -type f -name 'route.ts' 2>/dev/null | wc -l >> "$OUT"

sub "exported HTTP methods per route file"
grep -rnI "${EXCL[@]}" -E 'export (async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)' src/app \
  2>/dev/null >> "$OUT"
printf '%s\n' "[end]" >> "$OUT"


# ---------------------------------------------------------------------------
section "21. PAGE CENSUS"
# ---------------------------------------------------------------------------
sub "every page file under src/app, sorted"
find src/app -type f \( -name 'page.tsx' -o -name 'page.ts' -o -name 'layout.tsx' \) \
  | sort >> "$OUT" 2>&1
printf '%s\n' "[end]" >> "$OUT"

sub "line counts of every file under src, largest first (top 40)"
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -exec wc -l {} \; 2>/dev/null \
  | sort -rn | head -40 >> "$OUT"
printf '%s\n' "[end]" >> "$OUT"


# ---------------------------------------------------------------------------
section "22. TOP-LEVEL DIRECTORY CENSUS"
# ---------------------------------------------------------------------------
sub "top-level entries"
ls -1a >> "$OUT" 2>&1
printf '%s\n' "[end]" >> "$OUT"

for d in docs messages scripts public supabase src .github
do
  sub "contents of $d (recursive, files only)"
  if [ -d "$d" ]; then
    find "$d" -type f | sort >> "$OUT" 2>&1
    printf '%s\n' "--- FILE COUNT: $(find "$d" -type f 2>/dev/null | wc -l | tr -d ' ')" >> "$OUT"
  else
    printf '%s\n' "[absent]" >> "$OUT"
  fi
done

sub "every markdown file in the repository"
find . -type f -name '*.md' \
  -not -path './node_modules/*' -not -path './.next/*' -not -path './.git/*' \
  -not -path './audit/*' -not -path './.claude/*' | sort >> "$OUT" 2>&1
printf '%s\n' "[end]" >> "$OUT"


# ---------------------------------------------------------------------------
section "23. DEPENDENCY REFERENCE COUNTS"
# ---------------------------------------------------------------------------
sub "declared dependencies and their import counts under src/"
deps="$(sed -n '/"dependencies"/,/^  }/p' package.json 2>/dev/null \
        | grep -oE '"[^"]+":' | tr -d '":' | grep -v '^dependencies$')"
for d in $deps; do
  n="$(grep -rnI "${EXCL[@]}" -E "from ['\"]${d}|require\(['\"]${d}" src 2>/dev/null | wc -l | tr -d ' ')"
  printf '%-40s import sites: %s\n' "$d" "$n" >> "$OUT"
done
printf '%s\n' "[end of dependencies]" >> "$OUT"

sub "declared devDependencies and their import counts under src/"
ddeps="$(sed -n '/"devDependencies"/,/^  }/p' package.json 2>/dev/null \
         | grep -oE '"[^"]+":' | tr -d '":' | grep -v '^devDependencies$')"
for d in $ddeps; do
  n="$(grep -rnI "${EXCL[@]}" -E "from ['\"]${d}|require\(['\"]${d}" src 2>/dev/null | wc -l | tr -d ' ')"
  printf '%-40s import sites: %s\n' "$d" "$n" >> "$OUT"
done
printf '%s\n' "[end of devDependencies]" >> "$OUT"


# ---------------------------------------------------------------------------
section "24. GHOST SYMBOL LEFTOVERS"
# ---------------------------------------------------------------------------
for p in Cursor cursor-rules '\.cursorrules' url.parse 'new URL(' \
         signInAnonymously signInWithOtp
do
  g "$p"
done


# ---------------------------------------------------------------------------
section "25. NON-ASCII CONTENT"
# ---------------------------------------------------------------------------
sub "files under src containing any non-ASCII byte, with per-file counts"
grep -rlP "${EXCL[@]}" '[^\x00-\x7F]' src >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then
  for f in $(grep -rlP "${EXCL[@]}" '[^\x00-\x7F]' src 2>/dev/null | sort); do
    n="$(grep -cP '[^\x00-\x7F]' "$f" 2>/dev/null)"
    printf '%-60s lines with non-ASCII: %s\n' "$f" "$n" >> "$OUT"
  done
elif [ "$rc" -eq 1 ]; then
  printf '%s\n' "[no non-ASCII found under src]" >> "$OUT"
else
  printf '%s\n' "[grep -P failed (exit $rc): result unknown, not evidence of absence]" >> "$OUT"
fi
printf '%s\n' "[end]" >> "$OUT"

sub "non-ASCII lines that are comments (// or /* or *) under src"
grep -rnP "${EXCL[@]}" '^\s*(//|/\*|\*).*[^\x00-\x7F]' src 2>/dev/null >> "$OUT"
rc=$?
if [ "$rc" -eq 1 ]; then
  printf '%s\n' "[none found]" >> "$OUT"
elif [ "$rc" -ge 2 ]; then
  printf '%s\n' "[grep -P failed (exit $rc): result unknown, not evidence of absence]" >> "$OUT"
fi
printf '%s\n' "[end]" >> "$OUT"


# ---------------------------------------------------------------------------
section "26. TODO / FIXME / HACK / XXX"
# ---------------------------------------------------------------------------
sub "all markers with surrounding line"
grep -rnIE "${EXCL[@]}" '(TODO|FIXME|HACK|XXX)' src 2>/dev/null >> "$OUT"
printf '%s\n' "--- MATCH COUNT: $(grep -rnIE "${EXCL[@]}" '(TODO|FIXME|HACK|XXX)' src 2>/dev/null | wc -l | tr -d ' ')" >> "$OUT"


# ---------------------------------------------------------------------------
section "27. CLAUDE.md VERBATIM"
# ---------------------------------------------------------------------------
sub "CLAUDE.md with line numbers"
if [ -f CLAUDE.md ]; then cat -n CLAUDE.md >> "$OUT"; else printf '%s\n' "[absent]" >> "$OUT"; fi

sub "every identifier-shaped token in CLAUDE.md (candidates to verify against code)"
grep -oE '`[A-Za-z_][A-Za-z0-9_.]{2,}`' CLAUDE.md 2>/dev/null | tr -d '`' | sort -u >> "$OUT"
printf '%s\n' "[end]" >> "$OUT"


# ---------------------------------------------------------------------------
section "28. TABLE REFERENCE CENSUS  (which tables does the code actually touch?)"
# ---------------------------------------------------------------------------
sub "every .from('...') target, with counts"
grep -rhoI "${EXCL[@]}" -E "\.from\(['\"][a-z_]+['\"]\)" src 2>/dev/null \
  | sed -E "s/.*\(['\"]([a-z_]+)['\"]\).*/\1/" | sort | uniq -c | sort -rn >> "$OUT"
printf '%s\n' "[end]" >> "$OUT"

sub "every .rpc('...') target"
grep -rnoI "${EXCL[@]}" -E "\.rpc\(['\"][a-z_]+['\"]" src 2>/dev/null >> "$OUT"
printf '%s\n' "[end]" >> "$OUT"


printf '\n\n================================================================\n' >> "$OUT"
printf '== END OF L0b EVIDENCE\n' >> "$OUT"
printf '================================================================\n' >> "$OUT"

rm -f audit/.l0btmp

echo "Wrote $OUT"
wc -l "$OUT"
