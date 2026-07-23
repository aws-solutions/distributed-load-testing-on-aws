#!/usr/bin/env bash
# Create a new git worktree wired up for development:
#   - new branch off the current HEAD
#   - copies .env from this repo into the worktree
#   - runs `make install-deps` so packages are ready
#
# Usage: ./scripts/worktree-add.sh <branch-name>
set -euo pipefail

if [ $# -ge 1 ]; then
  branch="$1"
else
  read -r -p "Branch name: " branch
fi

if [ -z "${branch:-}" ]; then
  echo "Error: branch name is required" >&2
  exit 1
fi
repo_root="$(git rev-parse --show-toplevel)"
worktree_dir="${repo_root}.worktrees/${branch}"

if [ -e "$worktree_dir" ]; then
  echo "Error: $worktree_dir already exists" >&2
  exit 1
fi

echo "Creating worktree at $worktree_dir on new branch '$branch'..."
git -C "$repo_root" worktree add -b "$branch" "$worktree_dir"

if [ -f "$repo_root/.env" ]; then
  cp "$repo_root/.env" "$worktree_dir/.env"
  echo "Copied .env into worktree."
else
  echo "Warning: no .env in $repo_root to copy." >&2
fi

echo "Running make install-deps (this can take a while)..."
make -C "$worktree_dir" install-deps

rel_dir="../$(basename "${repo_root}.worktrees")/${branch}"
echo ""
echo "✅ Worktree ready! To start working, run:"
echo ""
echo "    cd $rel_dir"
echo ""
