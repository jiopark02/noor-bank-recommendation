#!/bin/sh
# Prepare a QA branch so its Vercel preview builds exactly the tree of
# <target-ref>, as a fast-forward of the QA branch (no force push needed).
#
# Usage: scripts/qa-preview-sync.sh <target-ref> <qa-branch>
#
# When <qa-branch> exists on origin, it creates one commit whose tree is
# <target-ref>^{tree} and whose parent is origin's tip, and points the local
# branch at it. When it does not, the local branch points at <target-ref>'s
# commit itself.
# Nothing else changes: not the working tree, not the checked-out branch, not
# any other ref. It does not push; it prints the push command for a person to
# run after they approve it.
#
# Exit codes: 0 prepared, already prepared or already in sync, 1 a check
# failed, 2 bad usage.

set -eu

usage() {
  echo "usage: $0 <target-ref> <qa-branch>   (qa-branch must start with qa/)" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
target_ref=$1
qa=$2

case "$qa" in
  qa/?*) ;;
  *) echo "error: qa-branch must start with qa/: $qa" >&2; usage ;;
esac
git check-ref-format --branch "$qa" >/dev/null 2>&1 || {
  echo "error: not a valid branch name: $qa" >&2
  exit 2
}

fail() {
  echo "error: $*" >&2
  exit 1
}

target=$(git rev-parse --verify --quiet "$target_ref^{commit}") ||
  fail "target-ref does not name a commit: $target_ref"
target_tree=$(git rev-parse --verify "$target^{tree}")

# The remote tip comes from origin itself, so a stale remote-tracking ref
# cannot be used as the parent.
remote_line=$(git ls-remote --exit-code origin "refs/heads/$qa") && remote_status=0 || remote_status=$?
case "$remote_status" in
  0) remote_tip=$(printf '%s\n' "$remote_line" | cut -f1) ;;
  2) remote_tip= ;;
  *) fail "could not read origin (git ls-remote exit $remote_status)" ;;
esac

if [ -n "$remote_tip" ]; then
  git cat-file -e "$remote_tip^{commit}" 2>/dev/null ||
    fail "origin's $qa tip $remote_tip is not in this clone; run git fetch --prune first"
  parent=$remote_tip
  if [ "$(git rev-parse "$remote_tip^{tree}")" = "$target_tree" ]; then
    echo "already in sync: origin/$qa tree $target_tree = $target_ref tree"
    exit 0
  fi
else
  parent=$target
fi

# What the local branch should end up at: on origin, a new commit with the
# target's tree on top of origin's tip; not on origin, the target commit itself.
ref="refs/heads/$qa"
local_tip=$(git rev-parse --verify --quiet "$ref") || local_tip=

report() {
  echo "target:      $target_ref = $target"
  if [ -n "$remote_tip" ]; then
    echo "parent:      $parent (origin/$qa)"
  else
    echo "parent:      $parent (target itself; $qa is new on origin)"
  fi
  echo "commit:      $1"
  echo "target tree: $target_tree"
  echo "synced tree: $(git rev-parse "$1^{tree}")"
  echo "push after approval:"
  echo "git push origin $ref:$ref"
}

# A local branch that differs from the parent is either this script's own
# earlier result that was never pushed, or holds commits that are not on
# origin. Only the first is accepted; the second is left alone.
if [ -n "$local_tip" ] && [ "$local_tip" != "$parent" ]; then
  if [ -n "$remote_tip" ] &&
    [ "$(git rev-parse "$local_tip^{tree}")" = "$target_tree" ] &&
    [ "$(git rev-list --parents -n 1 "$local_tip")" = "$local_tip $parent" ]; then
    echo "already prepared, not pushed yet"
    report "$local_tip"
    exit 0
  fi
  echo "error: local $qa ($local_tip) has commits that are not on origin's $qa or the target; see them with:" >&2
  echo "git log --oneline $parent..$local_tip" >&2
  exit 1
fi
if [ -z "$remote_tip" ] && [ "$local_tip" = "$target" ]; then
  echo "already prepared, not pushed yet"
  report "$target"
  exit 0
fi

# Moving a branch that a worktree has checked out would leave that worktree's
# files out of step with its HEAD.
if git worktree list --porcelain | grep -qxF "branch $ref"; then
  fail "$qa is checked out in a worktree; switch that worktree away first"
fi

if [ -n "$remote_tip" ]; then
  short=$(git rev-parse --short "$target")
  commit=$(git commit-tree "$target_tree" -p "$parent" -m "QA preview sync to $short ($target_ref)")
else
  commit=$target
fi

if [ -n "$local_tip" ]; then
  git update-ref -m "qa-preview-sync" "$ref" "$commit" "$local_tip"
else
  git update-ref -m "qa-preview-sync" "$ref" "$commit" ""
fi

report "$commit"
