#!/usr/bin/env bash
# check-changelog.sh
#
# Verifies that CHANGELOG.md has been modified in the current staged changeset.
# Called by the pre-commit hook.
#
# Exit 0 = pass (commit proceeds)
# Exit 1 = fail (commit is blocked)
#
# To bypass for non-code commits (doc-only, config, merge):
#   git commit --no-verify -m "chore: ..."
#   (or set SKIP_CHANGELOG=1 before the commit command)

set -e

# Allow bypass via env var
if [ "${SKIP_CHANGELOG}" = "1" ]; then
  echo "⚠️  CHANGELOG check skipped (SKIP_CHANGELOG=1)"
  exit 0
fi

# Check if CHANGELOG.md is among the staged files
STAGED=$(git diff --cached --name-only)

if echo "$STAGED" | grep -q "^CHANGELOG.md$"; then
  echo "✅ CHANGELOG.md updated — commit proceeding."
  exit 0
fi

# Check if the only staged changes are to non-source files
# (docs, images, config-only changes can bypass with --no-verify)
SOURCE_CHANGES=$(echo "$STAGED" | grep -E "\.(ts|tsx|js|jsx|css|html|json|yaml|yml|sh|py)$" | grep -v "^scripts/check-changelog" || true)

if [ -z "$SOURCE_CHANGES" ]; then
  # Only non-source files staged (markdown, images, etc.) — allow without CHANGELOG
  echo "ℹ️  No source file changes detected — CHANGELOG not required."
  exit 0
fi

# Source files changed but CHANGELOG not updated — block the commit
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  🚫  CHANGELOG.md must be updated before committing.    ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  Source files staged:                                    ║"
echo "$SOURCE_CHANGES" | head -10 | while IFS= read -r f; do
  printf "║    %-54s ║\n" "• $f"
done
echo "║                                                          ║"
echo "║  Add your entry under [Unreleased] in CHANGELOG.md,     ║"
echo "║  then stage the file:                                    ║"
echo "║                                                          ║"
echo "║    git add CHANGELOG.md                                  ║"
echo "║                                                          ║"
echo "║  To bypass (doc-only / config / merge commits):          ║"
echo "║    git commit --no-verify                                ║"
echo "║    SKIP_CHANGELOG=1 git commit                           ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
exit 1
