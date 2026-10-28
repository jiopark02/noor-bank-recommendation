---
name: gate1
description: Prove tests catch a fix by applying each mutation (a reverted fix hunk or a row of an operator's mutation table), seeing the named tests go red, and restoring to green.
disable-model-invocation: true
argument-hint: "[test-file] [source-file] [commit] | [mutation table]"
---

# Gate 1: the tests go red without the fix

Arguments: `$ARGUMENTS`.

## Mutations

A run applies one or more mutations. Each has an ID, a change to source, and the tests that must fail under it. They come from one of two places:

- **A mutation table from the operator**, with columns ID · mutation · tests that must fail. When the operator gives a table, the table decides; the commit form below is not used.
- **The fix hunk of a commit**: arguments `<test>` `<src>` and optionally `<commit>`. This is one mutation, ID `M1`: revert the change to `<src>` in `<commit>`, taking the hunks from `git show <commit> -- <src>`. If no commit is given, use the most recent commit that changed `<src>` (`git log -1 --format=%H -- <src>`). The tests that must fail are the target tests in `<test>`.

The tests that must fail list only tests that this mutation can make fail. A test that the mutation cannot reach does not belong in its list.

Name each test by its file and full title, as vitest prints it, so it can be found in the failure list.

## Output directory

Write outputs outside the repo. If the operator names an output directory, use it; if it does not exist, stop and ask the operator where to write, and do not create it.

Otherwise make a new directory for this run: `C:\Temp\gate1-<YYYYMMDD-HHMMSS>\` (`/c/Temp/gate1-<YYYYMMDD-HHMMSS>` in Git Bash), with the timestamp spelled out, e.g. `mkdir /c/Temp/gate1-20261027-193000; echo "exit=$?"`. Do not pass `-p`. If `C:\Temp` does not exist, or the new directory already exists, stop and ask the operator where to write.

`<out>` below means the directory in use.

## Result files

- `<out>/green-1-vitest.txt`: the suite before any mutation.
- `<out>/<ID>-vitest.txt`: the suite with mutation `<ID>` applied, one per mutation.
- `<out>/green-2-vitest.txt`: the suite after every mutation is restored.
- `<out>/summary.md`: the summary in the Report section.
- `<out>/<ID>-<repo path>.bak`: the backup of each file a mutation touches, where `<repo path>` is the file's path from the repo root with every `/` replaced by `_` (for `src/lib/plaidExchange.ts` in `M1`: `<out>/M1-src_lib_plaidExchange.ts.bak`).

Before writing any of them, check that it does not exist; if it does, do not overwrite it — stop and report.

## Steps

Every test run below writes to a file: redirect plus `echo "exit=$?"`, never a pipe. Write each redirect target as a literal path, never through a variable: permission rules cannot check a variable in a redirect target, so it opens an approval prompt whatever the allow rules say.

1. Precondition: `git status --porcelain` is empty, and the code under test is committed — in the commit form, the fix is in `<commit>`; in the table form, the code the table mutates is at `HEAD`. Otherwise stop and report. Record the full hash of `<commit>` (commit form) or of `HEAD` (table form).
2. Check that none of the result files above exists.
3. Run the full suite green: `node_modules/.bin/vitest run > <out>/green-1-vitest.txt 2>&1; echo "exit=$?"`. If it is not green, stop and report.
4. For each mutation, in order:
   1. Back up each file the mutation touches to `<out>/<ID>-<repo path>.bak`.
   2. Count CR-bearing lines in each of those files:
      `grep -U -c "$(printf '\r')" <file>; echo "exit=$?"`.
      Do not write `$'\r'` inside a double-quoted `"$( )"`; there it matches every line, not CRs, and always pass -U: Git Bash grep strips CR without it.
   3. Apply the mutation with the Edit tool. Never use `sed -i`. Keep the list of edits made. Count CR-bearing lines again; the count must match step 4.2, allowing only for lines the mutation removed or added.
   4. Run the full suite: `node_modules/.bin/vitest run > <out>/<ID>-vitest.txt 2>&1; echo "exit=$?"`.
   5. Judge from the failure list in `<out>/<ID>-vitest.txt`:
      - **RED**: every listed test failed.
      - **PARTIAL RED**: some listed tests failed. Record the names of those that did not.
      - **NOT RED**: no listed test failed.
      - **UNDETERMINED**: a file holding listed tests did not load at all (vitest reports the file failed with no tests run, e.g. a syntax or import error the mutation caused). This says nothing about the tests. Record the error verbatim; that mutation has to be redesigned so the file loads, and run again under a new ID.
      Record each listed test's failing assertion and message verbatim. Record any test that failed without being listed, too.
   6. Restore by reversing each edit from step 4.3 with the Edit tool (old and new strings swapped), last edit first. Do not use `git checkout --`. If a reverse edit is ambiguous (its string is not unique in the file, or edits overlap), restore the file from its step 4.1 backup with `cp` instead, then confirm with `cmp <backup> <file>; echo "exit=$?"`, which must exit 0. The CR counts must match step 4.2 again.
   7. Run `git status --porcelain` right away. It must be empty. If it is not, stop immediately: run no further mutations, and report its output and the backup paths.
   8. PARTIAL RED, NOT RED and UNDETERMINED do not stop the run: go on to the next mutation. Never edit a test to make it go red.
5. Run the suite green again: `node_modules/.bin/vitest run > <out>/green-2-vitest.txt 2>&1; echo "exit=$?"`. If it is not green, stop and report, as in step 3.
6. Write `<out>/summary.md` and report.

## Report

In `<out>/summary.md` and in the reply:

- The full hash recorded in step 1.
- Every result file path, with the pass and fail counts and the exit value of each run, counted from the result files themselves.
- The CR counts from steps 4.2, 4.3 and 4.6 for each mutation.
- One row per mutation: ID · verdict · listed tests that did not fail · unlisted tests that failed.
- At the end, every PARTIAL RED, NOT RED and UNDETERMINED mutation gathered in one list, with the load error for each UNDETERMINED one.
