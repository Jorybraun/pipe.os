#!/bin/bash
# scripts/check-docs.sh
# Documentation upkeep pre-commit guard

set -e

ERRORS=0

# 1. Ban stale tracking artifacts
if [ -f "docs/workflows/CURRENT_STATE.json" ]; then
  echo "ERROR: docs/workflows/CURRENT_STATE.json is stale. Delete it."
  ERRORS=$((ERRORS + 1))
fi

# 2. Ban old agent worktrees
for dir in .claude/worktrees/agent-*; do
  if [ -d "$dir" ]; then
    echo "ERROR: Old agent worktree exists: $dir. Delete it."
    ERRORS=$((ERRORS + 1))
  fi
done

# 3. Warn if e2e tests reference old stack in actual code (not comments)
# We grep for amplify/AppSync/DynamoDB/Cognito/Lambda outside of comments
if grep -rn "amplify\|AppSync\|DynamoDB\|Cognito\|Lambda" e2e/*.spec.ts 2>/dev/null | grep -v "//" | grep -v "/\*" | grep -v "^.*:\s*\*" ; then
  echo "WARNING: e2e tests reference old stack in non-comment code."
  ERRORS=$((ERRORS + 1))
fi

# 4. Ensure canonical navigation files exist
if [ ! -f "CLAUDE.md" ]; then
  echo "ERROR: CLAUDE.md (navigation hub) is missing."
  ERRORS=$((ERRORS + 1))
fi
if [ ! -f "docs/vision.md" ]; then
  echo "ERROR: docs/vision.md is missing."
  ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "Docs check failed with $ERRORS error(s)."
  exit 1
fi

echo "Docs check passed."
