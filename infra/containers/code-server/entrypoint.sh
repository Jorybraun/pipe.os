#!/usr/bin/env bash
set -euo pipefail

# ── Workspace setup ────────────────────────────────────────────────────────────
#
# Env vars (all optional):
#   REPO_GIT_URL       — public git URL to clone (MVP path, ADR-037)
#   REPO_R2_URL        — presigned R2 URL for a repo tarball (future path)
#   CHALLENGE_BASE_COMMIT_SHA — exact immutable commit to start assessment work from
#   CHALLENGE_BRANCH   — branch to check out after clone/extract
#   ASSESSMENT_BRANCH  — local branch name created from CHALLENGE_BASE_COMMIT_SHA

mkdir -p /workspace
# The image runs as root in Cloudflare Containers, while /workspace is owned by
# coder so code-server can edit it. Mark it safe before exact-commit git checks.
git config --global --add safe.directory /workspace

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

if [[ -n "${CHALLENGE_BASE_COMMIT_SHA:-}" && -d /workspace/.git ]]; then
  echo "[entrypoint] Checking out challenge base commit: ${CHALLENGE_BASE_COMMIT_SHA}"
  cd /workspace
  git fetch --all || true
  if ! git cat-file -e "${CHALLENGE_BASE_COMMIT_SHA}^{commit}" 2>/dev/null; then
    git fetch origin "${CHALLENGE_BASE_COMMIT_SHA}" || true
  fi
  if ! git cat-file -e "${CHALLENGE_BASE_COMMIT_SHA}^{commit}" 2>/dev/null; then
    echo "[entrypoint] base commit not found for repo ${REPO_GIT_URL:-unknown}: ${CHALLENGE_BASE_COMMIT_SHA}" >&2
    exit 1
  fi
  git checkout -B "${ASSESSMENT_BRANCH:-pipe-assessment}" "${CHALLENGE_BASE_COMMIT_SHA}"
  cd /
elif [[ -n "${CHALLENGE_BRANCH:-}" && -d /workspace/.git ]]; then
  echo "[entrypoint] Checking out challenge branch: ${CHALLENGE_BRANCH}"
  cd /workspace
  git fetch --all || true
  git checkout "$CHALLENGE_BRANCH" || echo "[entrypoint] branch not found, using default"
  cd /
fi

if [[ -f /usr/local/bin/agent-bridge.js ]]; then
  export AGENT_BRIDGE_PORT="${AGENT_BRIDGE_PORT:-8080}"
  export CODE_SERVER_PORT="${CODE_SERVER_PORT:-8082}"

  code_server_pid=""
  bridge_pid=""

  start_code_server() {
    echo "[entrypoint] Starting code-server on 127.0.0.1:${CODE_SERVER_PORT}"
    code-server --auth none --bind-addr "127.0.0.1:${CODE_SERVER_PORT}" /workspace &
    code_server_pid=$!
  }

  wait_for_code_server_ready() {
    for _ in {1..60}; do
      if timeout 1 bash -c "</dev/tcp/127.0.0.1/${CODE_SERVER_PORT}" 2>/dev/null; then
        return 0
      fi
      if ! kill -0 "${code_server_pid}" >/dev/null 2>&1; then
        wait "${code_server_pid}" || true
        return 1
      fi
      sleep 0.5
    done
    return 1
  }

  start_bridge() {
    echo "[entrypoint] Starting workspace bridge/router on 0.0.0.0:${AGENT_BRIDGE_PORT}"
    node /usr/local/bin/agent-bridge.js &
    bridge_pid=$!
  }

  start_code_server
  if ! wait_for_code_server_ready; then
    echo "[entrypoint] code-server did not become ready on 127.0.0.1:${CODE_SERVER_PORT}"
    kill "${code_server_pid}" >/dev/null 2>&1 || true
    exit 1
  fi

  start_bridge

  shutdown() {
    kill "${bridge_pid}" "${code_server_pid}" >/dev/null 2>&1 || true
    wait >/dev/null 2>&1 || true
    exit 0
  }
  trap shutdown TERM INT

  while true; do
    set +e
    wait -n "${bridge_pid}" "${code_server_pid}"
    child_exit=$?
    set -e

    if ! kill -0 "${code_server_pid}" >/dev/null 2>&1; then
      echo "[entrypoint] code-server exited with ${child_exit}; restarting"
      start_code_server
      if ! wait_for_code_server_ready; then
        echo "[entrypoint] restarted code-server did not become ready on 127.0.0.1:${CODE_SERVER_PORT}"
        kill "${bridge_pid}" "${code_server_pid}" >/dev/null 2>&1 || true
        exit 1
      fi
    fi

    if ! kill -0 "${bridge_pid}" >/dev/null 2>&1; then
      echo "[entrypoint] workspace bridge exited with ${child_exit}; restarting"
      start_bridge
    fi
  done
fi

# ── Start code-server ──────────────────────────────────────────────────────────
echo "[entrypoint] Starting code-server on 0.0.0.0:8080"
exec code-server --auth none --bind-addr 0.0.0.0:8080 /workspace
