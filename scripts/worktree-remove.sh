#!/usr/bin/env bash
# Remove a development worktree created by worktree-add.sh:
#   - removes the worktree (refuses if it has uncommitted changes)
#   - optionally deletes the branch
#
# Usage: ./scripts/worktree-remove.sh <branch-name>
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
worktrees_root="${repo_root}.worktrees"

if [ $# -ge 1 ]; then
  branch="$1"
else
  if [ -d "$worktrees_root" ] && [ -n "$(ls -A "$worktrees_root" 2>/dev/null)" ]; then
    echo "Existing worktrees:"
    for d in "$worktrees_root"/*/; do
      echo "  $(basename "$d")"
    done
  else
    echo "No worktrees found under $worktrees_root" >&2
    exit 1
  fi
  read -r -p "Branch name to remove: " branch
fi

if [ -z "${branch:-}" ]; then
  echo "Error: branch name is required" >&2
  exit 1
fi

worktree_dir="${worktrees_root}/${branch}"

if [ ! -e "$worktree_dir" ]; then
  echo "Error: no worktree at $worktree_dir" >&2
  exit 1
fi

echo "Removing worktree $worktree_dir..."
git -C "$repo_root" worktree remove "$worktree_dir"
echo "Worktree removed."

read -r -p "Also delete branch '$branch'? [y/N] " confirm
if [ "${confirm:-}" = "y" ] || [ "${confirm:-}" = "Y" ]; then
  git -C "$repo_root" branch -d "$branch"
  echo "Branch '$branch' deleted."
else
  echo "Branch '$branch' kept."
fi
