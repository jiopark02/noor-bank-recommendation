---
name: checkpoint
description: Stop before a commit and write the unit's tracked and new-file diff as one patch file in the operator's result folder, with status and command list, for operator review.
argument-hint: "<unit-name> <result-folder>"
---

# Checkpoint

Arguments: `$ARGUMENTS`.

- The first whitespace-separated word is the unit name, `<name>` below. It becomes a file name, so it holds only letters, digits, `.`, `_` and `-`.
- Everything after it is the result folder, `<out>` below. It may be written in Windows form (`C:\Temp\task\impl`) or Git Bash form (`/c/Temp/task/impl`); use the Git Bash form in commands. One trailing separator is dropped, so `<out>` never ends in `/`.

## Output directory

The result folder is chosen by the operator for each task; this skill has no default location. Before writing anything, stop and ask the operator when any of these holds, and write nothing. Check them in this order, and report the line each `test` prints:

- The unit name or the result folder is missing, or the unit name holds a character outside the set above.
- The result folder holds whitespace, or any character other than letters, digits, `.`, `_`, `-`, the separators `/` and `\`, and the colon after a drive letter. The redirect targets below are written without quotes, so a space or a shell character in the path would split or change the command.
- The result folder is not below `C:\Temp` (`/c/Temp/` in Git Bash, compared without regard to case). `C:\Temp` itself is not a result folder. A path with a `..` segment, a `.` segment or an empty segment (two separators in a row, such as `//`) is refused without resolving it; the one trailing separator dropped above is not an empty segment.
  Links are not resolved: the check reads the path as written, so a junction or symbolic link below `C:\Temp` can lead outside it.
- The result folder does not exist: `test -d "<out>"; echo "exit=$?"` prints anything but `exit=0`. Do not create it.
- `<out>/<name>.patch` already exists: `test -e "<out>/<name>.patch"; echo "exit=$?"` prints anything but `exit=1`. Do not overwrite it; ask the operator for a new unit name.

## Output file

One file, `<out>/<name>.patch`: the tracked changes, then the new files, each part under a marker line that starts with `# =====`. An earlier file of the same name is never overwritten: the last check above stops first. That holds for a file this skill left incomplete too, so a second run for the same unit needs a new unit name. This skill does not delete or replace a file.

Write every redirect target in this skill as a literal path, never through a variable: permission rules cannot check a variable in a redirect target, so it opens an approval prompt whatever the allow rules say. Redirect, never pipe, so the exit code survives.

## Steps

Every command below ends with `echo "exit=$?"`. The expected values are `0` for `git status`, `git diff HEAD` and `echo`, and `0` or `1` for `git diff --no-index`; step 7 names its own. On any other value, stop at that step: run no later step and do not retry. Report the command, its output and the exit line, report `<out>/<name>.patch` as incomplete, and do not call the checkpoint done. The file stays where it is.

1. Run `git status --porcelain; echo "exit=$?"` and keep its output verbatim.
2. Start the file with the first marker (`>` here, `>>` in every later step):
   `echo "# ===== checkpoint <name>: part 1 of 2, tracked changes (git diff HEAD) =====" > <out>/<name>.patch; echo "exit=$?"`
3. Tracked changes, staged and unstaged: `git diff HEAD >> <out>/<name>.patch; echo "exit=$?"`.
   If step 1 showed no tracked change, also run `echo "# (no tracked changes)" >> <out>/<name>.patch; echo "exit=$?"`.
4. Second marker:
   `echo "# ===== checkpoint <name>: part 2 of 2, new files (git diff --no-index -- /dev/null <file>) =====" >> <out>/<name>.patch; echo "exit=$?"`
5. For each untracked (`??`) file in this unit, append its content as a diff:
   `git diff --no-index -- /dev/null <file> >> <out>/<name>.patch; echo "exit=$?"`.
   Exit 1 is the usual value here: a difference was written. For an untracked directory, list its files and run this once per file. Never run `git add -N`.
   If there is no such file, run `echo "# (no new files)" >> <out>/<name>.patch; echo "exit=$?"` instead.
6. Closing marker, so a cut-off file is visible:
   `echo "# ===== checkpoint <name>: end =====" >> <out>/<name>.patch; echo "exit=$?"`
7. Run `grep -a -n "^# " <out>/<name>.patch; echo "exit=$?"` (expected `exit=0`) and report its output with the file's path: three `# =====` lines in order, plus an empty-part line where one applies. `-a` keeps grep printing the lines when the file holds bytes it takes for binary. Diff content never starts a line with `#`, so these are the markers only. Fewer than three `# =====` lines, or lines out of order, is an incomplete file: report it as one.
   Then run `grep -a -c "^Binary files" <out>/<name>.patch; echo "exit=$?"` and report the count. A count of `0` comes with `exit=1`, which is expected here; any other count comes with `exit=0`. When the count is not `0`, report in these words: "the content of binary files is not in this patch".
8. List, verbatim, every command run in this unit.
9. Report the change-surface table that CLAUDE.md requires (Item / Surface / Detection), one row per change item.
10. STOP. Do not stage or commit. Wait for the operator's commit approval.

## Applying the file

`git apply` skips the marker lines, so the file applies as a whole to a tree at the same `HEAD` without these changes (`git apply --check <out>/<name>.patch`). A binary file is the exception: both parts record it as "Binary files differ", which `git apply` refuses.

When both parts are empty (`# (no tracked changes)` and `# (no new files)`), the file holds no diff to apply, and `git apply` refuses it.
