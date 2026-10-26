---
name: gate1
description: Prove a test catches a committed fix by reverting the fix, seeing the target test go red, and restoring to green.
disable-model-invocation: true
argument-hint: "[test-file] [source-file] [commit]"
---

# Gate 1: the test goes red without the fix

Arguments: `$ARGUMENTS` (the test file `<test>`, the source file `<src>`, then optionally `<commit>`).

The fix is the change to `<src>` in `<commit>`; if no commit is given, use the most recent commit that changed `<src>` (`git log -1 --format=%H -- <src>`). Take the hunks to revert from `git show <commit> -- <src>`.

## Output directory

Write outputs to the temporary directory outside the repo. On this machine that is `C:\Temp` (`/c/Temp` in Git Bash). If that directory does not exist, stop and ask the operator where to write; do not create it. `<out>` below means that directory.

## Steps

Every test run below writes to a file: redirect plus `echo "exit=$?"`, never a pipe. Write each redirect target as a literal path, with the timestamp spelled out rather than held in a variable: permission rules cannot check a variable in a redirect target, so it opens an approval prompt whatever the allow rules say.

Result files are named `<out>/gate1-<test basename>-<timestamp>-green-1.txt`, `-red.txt` and `-green-2.txt`, with one timestamp for the whole run (`<prefix>` below). Before each run, check that its file does not exist; if it does, do not overwrite it — stop and report.

1. Precondition: the fix is committed and `git status --porcelain` is empty. Otherwise stop and report. Resolve `<commit>` as described above and record its full hash.
2. Run the full suite green: `node_modules/.bin/vitest run > <prefix>-green-1.txt 2>&1; echo "exit=$?"`.
3. Back up `<src>` to `<out>`.
4. Count CR-bearing lines in `<src>`:
   `grep -U -c "$(printf '\r')" <src>; echo "exit=$?"`.
   Do not write `$'\r'` inside a double-quoted `"$( )"`; there it matches every line, not CRs, and always pass -U: Git Bash grep strips CR without it.
5. Revert only the fix hunk(s) from `git show <commit> -- <src>` with the Edit tool. Never use `sed -i`. Count CR-bearing lines again with `grep -U -c "$(printf '\r')" <src>`; the count must match step 4 (allowing only for lines the revert removed or added).
6. Run the full suite: `node_modules/.bin/vitest run > <prefix>-red.txt 2>&1; echo "exit=$?"`. It counts as red only if the target test in `<test>` is in the failure list. Record the failing assertion and message verbatim.
7. Restore with `git checkout -- <src>`.
8. `git status --porcelain` must be empty. Then run the suite green again: `node_modules/.bin/vitest run > <prefix>-green-2.txt 2>&1; echo "exit=$?"`.
9. If the target test never goes red, do not touch the test. Stop and report.

## Report

The full hash of `<commit>`, the three result file paths, pass and fail counts and the exit value of each run, counted from the result files themselves, plus the CR counts from steps 4 and 5.
