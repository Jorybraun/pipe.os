#!/usr/bin/env bash
set -euo pipefail

# ── Workspace setup ────────────────────────────────────────────────────────────
#
# Env vars (all optional):
#   REPO_GIT_URL       — public git URL to clone (MVP path, ADR-037)
#   REPO_R2_URL        — presigned R2 URL for a repo tarball (future path)
#   CHALLENGE_BRANCH   — branch to check out after clone/extract

mkdir -p /workspace

if [[ -n "${REPO_GIT_URL:-}" ]]; then
  echo "[entrypoint] Cloning repo: ${REPO_GIT_URL}"
  if ! git clone "$REPO_GIT_URL" /workspace; then
    echo "[entrypoint] git clone failed — starting with empty workspace"
  fi
elif [[ -n "${REPO_R2_URL:-}" ]]; then
  echo "[entrypoint] Downloading repo from R2..."
  curl -fL "$REPO_R2_URL" -o /tmp/repo.tar.gz
  tar -xzf /tmp/repo.tar.gz -C /workspace
  rm -f /tmp/repo.tar.gz
  echo "[entrypoint] Repo extracted to /workspace"
else
  echo "[entrypoint] No repo source set — starting with empty workspace"
fi

if [[ -n "${CHALLENGE_BRANCH:-}" && -d /workspace/.git ]]; then
  echo "[entrypoint] Checking out challenge branch: ${CHALLENGE_BRANCH}"
  cd /workspace
  git fetch --all || true
  git checkout "$CHALLENGE_BRANCH" || echo "[entrypoint] branch not found, using default"
  cd /
fi

# ── Start code-server ──────────────────────────────────────────────────────────
echo "[entrypoint] Starting code-server on 0.0.0.0:8080"
exec code-server --auth none --bind-addr 0.0.0.0:8080 /workspace
