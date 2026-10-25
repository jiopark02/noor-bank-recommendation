---
name: review
description: Read-only layer-1 review of a diff file from an independent session, with file:line evidence for every verdict.
disable-model-invocation: true
argument-hint: "[diff-path]"
---

# Review

Arguments: `$ARGUMENTS` (the path of the diff file, `<diff>` below).

## Output directory

Write outputs to the temporary directory outside the repo. On this machine that is `C:\Temp` (`/c/Temp` in Git Bash). If that directory does not exist, stop and ask the operator where to write; do not create it. `<out>` below means that directory.

## Independence check (first)

If this session has written or edited code on this branch, output only "Not an independent session" and stop.

## Rules

- Read the diff to the end before opening any repo file.
- This review is read-only. Do not edit, stage or commit anything.
- The first output is the diffstat: `git apply --stat <diff>`.
- Evidence comes only from the diff and the real repo. Do not use the implementer's claims — commit messages, PR text, or conversation summaries — as evidence.
- Every verdict cites `file:line` and quotes one line verbatim. A verdict with no such evidence is UNDETERMINED.
- Whether a column exists is decided only from live query output, never from type files. Without that output, mark it UNDETERMINED.
- Do not assign risk grades; report facts.

## Required sections

1. Findings, one per defect, each with its evidence.
2. Things we did not ask about.
3. Passes CI but breaks in production, with these five subheads:
   - env / RLS / real data distribution
   - concurrency / retry / partial failure
   - external service responding differently
   - schema-code mismatch
   - information exposure in log and error paths
4. UNDETERMINED list (last).

## Output

Write the review to a new file `<out>/review-<diff basename>-<timestamp>.md`. Never open earlier review files.
