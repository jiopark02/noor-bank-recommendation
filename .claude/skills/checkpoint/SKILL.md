---
name: checkpoint
description: Stop before a commit and write the unit's tracked and new-file diff as one patch file in the operator's result folder, with status and command list, for operator review.
argument-hint: "<unit-name> <result-folder>"
---

# Checkpoint

Arguments: `$ARGUMENTS`.

- The first whitespace-separated word is the unit name, `<name>` below. It becomes a file name, so it holds only letters, digits, `.`, `_` and `-`.
- Everything after it is the result folder, `<out>` below. It may be written in Windows form (`C:\Temp\task\impl`) or Git Bash form (`/c/Temp/task/impl`); use the Git Bash form in commands.

## Output directory

The result folder is chosen by the operator for each task; this skill has no default location. Before writing anything, stop and ask the operator when any of these holds, and write nothing:

- The unit name or the result folder is missing, or the unit name holds a character outside the set above.
- The result folder is not below `C:\Temp` (`/c/Temp/` in Git Bash, compared without regard to case). `C:\Temp` itself is not a result folder. A path with a `..` segment is refused without resolving it.
- The result folder does not exist: `test -d "<out>"; echo "exit=$?"` prints anything but `exit=0`. Do not create it.

## Output file

One file, `<out>/<name>.patch`: the tracked changes, then the new files, each part under a marker line that starts with `# =====`. An earlier file of the same name is overwritten.

Write every redirect target in this skill as a literal path, never through a variable: permission rules cannot check a variable in a redirect target, so it opens an approval prompt whatever the allow rules say. Redirect, never pipe, so the exit code survives.

## Steps

1. Run `git status --porcelain` and keep its output verbatim.
2. Start the file with the first marker (`>` here, `>>` in every later step):
   `echo "# ===== checkpoint <name>: part 1 of 2, tracked changes (git diff HEAD) =====" > <out>/<name>.patch; echo "exit=$?"`
3. Tracked changes, staged and unstaged: `git diff HEAD >> <out>/<name>.patch; echo "exit=$?"`.
   If step 1 showed no tracked change, also run `echo "# (no tracked changes)" >> <out>/<name>.patch; echo "exit=$?"`.
4. Second marker:
   `echo "# ===== checkpoint <name>: part 2 of 2, new files (git diff --no-index -- /dev/null <file>) =====" >> <out>/<name>.patch; echo "exit=$?"`
5. For each untracked (`??`) file in this unit, append its content as a diff:
   `git diff --no-index -- /dev/null <file> >> <out>/<name>.patch; echo "exit=$?"`.
   Exit 1 is normal here. For an untracked directory, list its files and run this once per file. Never run `git add -N`.
   If there is no such file, run `echo "# (no new files)" >> <out>/<name>.patch; echo "exit=$?"` instead.
6. Closing marker, so a cut-off file is visible:
   `echo "# ===== checkpoint <name>: end =====" >> <out>/<name>.patch; echo "exit=$?"`
7. Run `grep -n "^# " <out>/<name>.patch` and report its output with the file's path: three `# =====` lines in order, plus an empty-part line where one applies. Diff content never starts a line with `#`, so these are the markers only.
8. List, verbatim, every command run in this unit.
9. Report the change-surface table that CLAUDE.md requires (Item / Surface / Detection), one row per change item.
10. STOP. Do not stage or commit. Wait for the operator's commit approval.

## Applying the file

`git apply` skips the marker lines, so the file applies as a whole to a tree at the same `HEAD` without these changes (`git apply --check <out>/<name>.patch`). A binary file is the exception: both parts record it as "Binary files differ", which `git apply` refuses.
