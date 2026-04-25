"""SQLite database helper for the swarm broker."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

_SCHEMA_PATH = Path(__file__).parent / "schema.sql"
_DB_PATH: Path | None = None


def init_db(db_path: str | Path = ".swarm/broker.db") -> Path:
    """Ensure schema is applied and return the resolved db path."""
    global _DB_PATH
    resolved = Path(db_path).resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(resolved), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    schema = _SCHEMA_PATH.read_text()
    conn.executescript(schema)
    conn.commit()
    conn.close()
    _DB_PATH = resolved
    return resolved


def get_conn(db_path: str | Path | None = None) -> sqlite3.Connection:
    """Return a new connection (caller must close)."""
    path = db_path or _DB_PATH
    if path is None:
        raise RuntimeError("Database not initialised. Call init_db() first.")
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}
