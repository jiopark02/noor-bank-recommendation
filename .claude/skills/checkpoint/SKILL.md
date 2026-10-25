---
name: checkpoint
description: Stop before a commit and write the unit's diff, new-file diff, status and command list for operator review.
disable-model-invocation: true
argument-hint: "[unit-name]"
---

# Checkpoint

Arguments: `$ARGUMENTS` (the unit name, `<name>` below).

## Output directory

Write outputs to the temporary directory outside the repo. On this machine that is `C:\Temp` (`/c/Temp` in Git Bash). If that directory does not exist, stop and ask the operator where to write; do not create it. `<out>` below means that directory.

## Steps

1. Tracked changes. Run `git diff > <out>/<name>.diff; echo "exit=$?"`. Redirect, never pipe, so the exit code survives.
2. Run `git status --porcelain` and keep its output verbatim.
3. For each untracked (`??`) file in this unit, append its content as a diff:
   `git diff --no-index -- /dev/null <file> >> <out>/<name>-new.diff; echo "exit=$?"`.
   Exit 1 is normal here. For an untracked directory, list its files and run this once per file. Never run `git add -N`.
4. List, verbatim, every command run in this unit.
5. Report the change-surface table that CLAUDE.md requires (Item / Surface / Detection), one row per change item.
6. STOP. Do not stage or commit. Wait for the operator's commit approval.
