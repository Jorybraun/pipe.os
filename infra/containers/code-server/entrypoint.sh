#!/usr/bin/env bash
set -euo pipefail

# ── Workspace setup ────────────────────────────────────────────────────────────
#
# Env vars (all optional):
#   REPO_GIT_URL       — public git URL to clone (MVP path, ADR-037)
#   REPO_R2_URL        — presigned R2 URL for a repo tarball (future path)
#   CHALLENGE_BRANCH   — branch/ref to check out after clone/extract.
#                        GitHub PR refs use refs/pull/<number>/head.

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
  echo "[entrypoint] Checking out challenge ref: ${CHALLENGE_BRANCH}"
  cd /workspace
  if [[ "$CHALLENGE_BRANCH" =~ ^refs/pull/[0-9]+/head$ ]]; then
    pr_ref="${CHALLENGE_BRANCH#refs/pull/}"
    pr_number="${pr_ref%/head}"
    pr_branch="pipe-pr-${pr_number}"
    if git fetch origin "${CHALLENGE_BRANCH}:refs/heads/${pr_branch}"; then
      git checkout "$pr_branch" || echo "[entrypoint] PR checkout failed, using default"
    else
      echo "[entrypoint] PR ref fetch failed, using default"
    fi
  else
    git fetch --all || true
    git checkout "$CHALLENGE_BRANCH" || echo "[entrypoint] branch not found, using default"
  fi
  cd /
fi

# ── Start code-server ──────────────────────────────────────────────────────────
echo "[entrypoint] Starting code-server on 0.0.0.0:8080"
exec code-server --auth none --bind-addr 0.0.0.0:8080 /workspace
