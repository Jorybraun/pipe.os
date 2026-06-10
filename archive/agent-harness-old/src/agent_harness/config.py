"""Shared runtime configuration for agent-harness.

The data directory is set once at server startup and used by all
persistence layers (broker, checkpoints, messaging, orchestrator).
"""
from __future__ import annotations

from pathlib import Path

# Default relative to CWD; server main() overrides this with --data-dir.
DATA_DIR: Path = Path(".swarm")


def data_path(rel: str | Path) -> Path:
    """Return an absolute path resolved under DATA_DIR."""
    return (DATA_DIR / rel).resolve()
