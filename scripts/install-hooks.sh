#!/usr/bin/env bash
# install-hooks.sh
#
# Installs the Pipe git hooks into .git/hooks/.
# Run this once after cloning the repo (or after any hooks change).
#
# Usage:
#   bash scripts/install-hooks.sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SCRIPTS_DIR="$REPO_ROOT/scripts"

echo "Installing git hooks from $SCRIPTS_DIR → $HOOKS_DIR"

# pre-commit: enforce CHANGELOG update
cat > "$HOOKS_DIR/pre-commit" << 'HOOK'
#!/usr/bin/env bash
# pre-commit hook — installed by scripts/install-hooks.sh
# Enforces CHANGELOG.md update on every source-code commit.

REPO_ROOT="$(git rev-parse --show-toplevel)"
bash "$REPO_ROOT/scripts/check-changelog.sh"
HOOK

chmod +x "$HOOKS_DIR/pre-commit"
echo "  ✅ pre-commit hook installed"

echo ""
echo "All hooks installed. To reinstall after pulling hook changes:"
echo "  bash scripts/install-hooks.sh"
