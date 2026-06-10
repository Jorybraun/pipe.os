"""SQLite database helper for the swarm broker."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from agent_harness import config

_SCHEMA_PATH = Path(__file__).parent / "schema.sql"
_DB_PATH: Path | None = None


def init_db(db_path: str | Path | None = None) -> Path:
    """Ensure schema is applied and return the resolved db path."""
    global _DB_PATH
    if db_path is None:
        db_path = config.data_path("broker.db")
    resolved = Path(db_path).resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(resolved), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    schema = _SCHEMA_PATH.read_text()
    conn.executescript(schema)
    # Lightweight migrations: add columns that may be missing in existing DBs
    _migrate_add_column(conn, "handoffs", "dod_checklist", "TEXT")
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


def _migrate_add_column(conn: sqlite3.Connection, table: str, column: str, dtype: str) -> None:
    """Add a column if it does not already exist (SQLite safe)."""
    # PRAGMA table_info returns tuples (cid, name, type, notnull, dflt_value, pk)
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    existing = {r[1] for r in rows}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {dtype}")
