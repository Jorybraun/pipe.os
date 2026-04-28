# Agent Harness — Docker image with full app context
# Build context should be the project root (PIPE-OS/)
# This Dockerfile copies only the files it needs instead of the entire repo.

FROM python:3.12-slim

# Install system deps for playwright, git, and general tooling
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    git \
    curl \
    ripgrep \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast Python package management
RUN pip install --no-cache-dir uv

WORKDIR /app

# Copy harness first (changes less often) for layer caching
COPY agent-harness/pyproject.toml agent-harness/uv.lock* agent-harness/README.md ./agent-harness/
COPY agent-harness/src ./agent-harness/src
COPY agent-harness/tests ./agent-harness/tests

# Install harness dependencies
WORKDIR /app/agent-harness
RUN uv pip install --system -e ".[dev]"

# deepagents is used by orchestrator_agent but not declared in pyproject.toml
RUN uv pip install --system deepagents || true

# Copy app source code (explicit — avoids copying node_modules, .git, etc.)
WORKDIR /app
COPY src ./src
COPY workers ./workers
COPY e2e ./e2e
COPY public ./public
COPY scripts ./scripts
COPY package.json package-lock.json* pnpm-lock.yaml* vite.config.* tsconfig.* ./
COPY knowledge ./knowledge
COPY docs ./docs

# Install playwright browsers (optional, for QA smoke tests)
RUN playwright install chromium || true

# Default: drop into a shell so you can work
CMD ["bash"]
