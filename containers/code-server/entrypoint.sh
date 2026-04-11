#!/usr/bin/env bash
set -euo pipefail

# ── Workspace setup ────────────────────────────────────────────────────────────
#
# Env vars (all optional):
#   REPO_R2_URL        — presigned R2 URL for a repo tarball
#   CHALLENGE_BRANCH   — branch to check out after extraction
#   BASE_BRANCH        — branch name of the base (informational; used for
#                        display or future diff-generation; not checked out)

mkdir -p /workspace

if [[ -n "${REPO_R2_URL:-}" ]]; then
  echo "[entrypoint] Downloading repo from R2..."
  curl -fL "$REPO_R2_URL" -o /tmp/repo.tar.gz
  tar -xzf /tmp/repo.tar.gz -C /workspace
  rm -f /tmp/repo.tar.gz
  echo "[entrypoint] Repo extracted to /workspace"
else
  echo "[entrypoint] No REPO_R2_URL set — starting with empty workspace"
fi

if [[ -n "${CHALLENGE_BRANCH:-}" && -d /workspace/.git ]]; then
  echo "[entrypoint] Checking out challenge branch: ${CHALLENGE_BRANCH}"
  cd /workspace
  git fetch --all
  git checkout "$CHALLENGE_BRANCH"
  cd /
fi

# ── Start code-server ──────────────────────────────────────────────────────────
echo "[entrypoint] Starting code-server on 0.0.0.0:8080"
exec code-server --auth none --bind-addr 0.0.0.0:8080 /workspace
