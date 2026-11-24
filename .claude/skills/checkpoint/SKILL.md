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

The result folder is chosen by the operator for each task; this skill has no default location. Before writing anything, stop and ask the operator when any of these holds, and write nothing. Check them in this order, and report the output each check printed:

- The unit name or the result folder is missing, or the unit name holds a character outside the set above.
- The result folder holds whitespace, or any character other than letters, digits, `.`, `_`, `-`, the separators `/` and `\`, and the colon after a drive letter. The redirect targets below are written without quotes, so a space or a shell character in the path would split or change the command.
- The result folder is not below `C:\Temp` (`/c/Temp/` in Git Bash, compared without regard to case). `C:\Temp` itself is not a result folder. A path with a `..` segment, a `.` segment or an empty segment (two separators in a row, such as `//`) is refused without resolving it; the one trailing separator dropped above is not an empty segment.
  Links are not resolved: the check reads the path as written, so a junction or symbolic link below `C:\Temp` can lead outside it.
- The result folder does not exist: `ls -la <out>` does not list the folder's contents (it prints "No such file or directory" instead). Do not create it.
- `<out>/<name>.patch` or `<out>/<name>-exit.txt` already exists: either name appears in the listing `ls -la <out>` printed. Do not overwrite it; ask the operator for a new unit name. A missing file is confirmed from that listing, not from the exit code of `test -e`, which the tool result does not always show.

## Output file

One file, `<out>/<name>.patch`: the tracked changes, then the new files, each part under a marker line that starts with `# =====`. Beside it, `<out>/<name>-exit.txt` holds one `exit=` line for each command whose exit the steps record, in the order the commands ran. An earlier file of the same name is never overwritten: the last check above stops first. That holds for a file this skill left incomplete too, so a second run for the same unit needs a new unit name. This skill does not delete or replace a file.

Write every redirect target in this skill as a literal path, never through a variable: permission rules cannot check a variable in a redirect target, so it opens an approval prompt whatever the allow rules say. Redirect, never pipe, so the exit code survives.

Follow CLAUDE.md's rule for Claude Code shell commands: one simple command per call, with no `{ }` group, `$( )` substitution, backtick, expansion inside quotes, `2>/dev/null` or `cd … &&` chain, and no `$?` in any form (the permission check cannot read a variable, so it opens an approval prompt). An exit is recorded with `&& echo exit=0 >> <exit file> || echo exit=1 >> <exit file>` appended to the same call: every non-zero exit reads `exit=1`, so a command whose non-zero exit is normal (such as `git diff --no-index` with a difference, `test -e` on a missing file, or `grep -c` with no match) is judged by its output or by other evidence, such as `ls` or the Grep tool.

## Steps

Steps 1, 3 and 7 record their exit: each is run as its own call with `&& echo exit=0 >> <out>/<name>-exit.txt || echo exit=1 >> <out>/<name>-exit.txt` appended, written below as `… && echo exit=0 >> <exit> || echo exit=1 >> <exit>`. After each one, read the last line of `<out>/<name>-exit.txt` with the Read tool. The expected value is `exit=0`, with one line in the file for each recorded step run so far. On any other value or line count, stop at that step: run no later step and do not retry. Report the command, its output and its exit lines, report `<out>/<name>.patch` as incomplete, and do not call the checkpoint done. The file stays where it is.

The other steps record no exit; each is checked by what it writes. An `echo` that writes a marker or an empty-part line is checked by step 7, which finds every such line in order or reports the file as incomplete. A `git diff --no-index` in step 5 is checked by its `+++ b/<file>` line in the patch.

1. Run `git status --porcelain && echo exit=0 >> <exit> || echo exit=1 >> <exit>` and keep its output verbatim.
2. Start the file with the first marker (`>` here, `>>` in every later step):
   `echo "# ===== checkpoint <name>: part 1 of 2, tracked changes (git diff HEAD) =====" > <out>/<name>.patch`
3. Tracked changes, staged and unstaged: `git diff HEAD >> <out>/<name>.patch && echo exit=0 >> <exit> || echo exit=1 >> <exit>`.
   If step 1 showed no tracked change, also run `echo "# (no tracked changes)" >> <out>/<name>.patch`.
4. Second marker:
   `echo "# ===== checkpoint <name>: part 2 of 2, new files (git diff --no-index -- /dev/null <file>) =====" >> <out>/<name>.patch`
5. For each untracked (`??`) file in this unit, append its content as a diff:
   `git diff --no-index -- /dev/null <file> >> <out>/<name>.patch`.
   It exits non-zero when it writes a difference, so its exit decides nothing. Confirm it with the Grep tool right after the command: the patch holds a `+++ b/<file>` line for that file. A missing line means the diff was not written: stop at this step as above. For an untracked directory, list its files and run this once per file. Never run `git add -N`.
   If there is no such file, run `echo "# (no new files)" >> <out>/<name>.patch` instead.
6. Closing marker, so a cut-off file is visible:
   `echo "# ===== checkpoint <name>: end =====" >> <out>/<name>.patch`
7. Run `grep -a -n "^# " <out>/<name>.patch && echo exit=0 >> <exit> || echo exit=1 >> <exit>` (expected `exit=0`; `exit=1` means no marker line was found) and report its output with the file's path: three `# =====` lines in order, plus an empty-part line where step 3 or step 5 wrote one. `-a` keeps grep printing the lines when the file holds bytes it takes for binary. Diff content never starts a line with `#`, so these are the markers only. Fewer than three `# =====` lines, lines out of order, or a missing empty-part line that step 3 or step 5 wrote is an incomplete file: report it as one.
   Then count lines starting with `Binary files` in `<out>/<name>.patch` with the Grep tool (pattern `^Binary files`, output mode `count`), not with `grep -c`, whose exit code is `1` when the count is `0`, and report the count. When the count is not `0`, report in these words: "the content of binary files is not in this patch".
8. List, verbatim, every command run in this unit.
9. Report the change-surface table that CLAUDE.md requires (Item / Surface / Detection), one row per change item.
10. STOP. Do not stage or commit. Wait for the operator's commit approval.

## Applying the file

`git apply` skips the marker lines, so the file applies as a whole to a tree at the same `HEAD` without these changes (`git apply --check <out>/<name>.patch`). A binary file is the exception: both parts record it as "Binary files differ", which `git apply` refuses.

When both parts are empty (`# (no tracked changes)` and `# (no new files)`), the file holds no diff to apply, and `git apply` refuses it.
