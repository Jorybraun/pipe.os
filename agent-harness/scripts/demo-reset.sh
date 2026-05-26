#!/usr/bin/env bash
# Reset the agent-harness demo worktree to a clean branch.
# Run this from the project root (PIPE-OS/).

set -euo pipefail

WORKTREE=".worktrees/agent-harness-demo"
BRANCH="demo/harness"

echo "Removing demo worktree..."
if git worktree list | grep -q "$WORKTREE"; then
    git worktree remove "$WORKTREE" --force 2>/dev/null || rm -rf "$WORKTREE"
    git worktree prune
fi

echo "Resetting branch $BRANCH to HEAD..."
git branch -f "$BRANCH" HEAD

echo "Creating fresh worktree at $WORKTREE on branch $BRANCH..."
git worktree add "$WORKTREE" "$BRANCH"

echo "Done. You can now:"
echo "  docker compose -f agent-harness/docker-compose.yml run --rm agent-harness-demo"
