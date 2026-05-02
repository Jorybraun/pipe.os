#!/usr/bin/env python3
"""Live CLI dashboard for the agent-harness swarm."""
from __future__ import annotations

import os
import sqlite3
import sys
import time
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / ".swarm" / "broker.db"


def _fmt_ts(ts: float | None) -> str:
    if not ts:
        return "—"
    elapsed = time.time() - ts
    if elapsed < 60:
        return f"{elapsed:.0f}s ago"
    if elapsed < 3600:
        return f"{elapsed/60:.0f}m ago"
    return f"{elapsed/3600:.1f}h ago"


def _clear():
    print("\033[2J\033[H", end="")


def _header(title: str):
    print(f"\033[1;36m{'─' * 60}\033[0m")
    print(f"\033[1;36m  {title}\033[0m")
    print(f"\033[1;36m{'─' * 60}\033[0m")


def _row(label: str, value: str, color: str = "0"):
    print(f"  \033[1m{label:20}\033[0m \033[{color}m{value}\033[0m")


def _color_for(status: str) -> str:
    s = (status or "").upper()
    if s in ("COMPLETE", "DONE", "PASS"):
        return "32"  # green
    if s in ("RUNNING", "CLAIMED", "PENDING"):
        return "33"  # yellow
    if s in ("FAILED", "ESCALATED", "BLOCKED"):
        return "31"  # red
    return "0"


def draw():
    _clear()
    now = time.time()

    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # ── Plans ──
    _header("PLANS")
    rows = conn.execute(
        "SELECT plan_id, status, phase FROM plans ORDER BY phase, plan_id"
    ).fetchall()
    for r in rows:
        pid = r["plan_id"]
        if len(pid) > 45:
            pid = pid[:42] + "..."
        color = _color_for(r["status"])
        print(f"  [{r['phase'] or 0}] \033[{color}m{r['status']:12}\033[0m  {pid}")

    if not rows:
        print("  (no plans)")

    # ── Lanes ──
    print()
    _header("LANES")
    lanes = conn.execute(
        "SELECT lane_id, plan_id, status, started_at, last_heartbeat, budget_used FROM lanes ORDER BY started_at DESC"
    ).fetchall()
    for ln in lanes:
        elapsed = _fmt_ts(ln["started_at"])
        hb = _fmt_ts(ln["last_heartbeat"])
        color = _color_for(ln["status"])
        lid = ln["lane_id"]
        if len(lid) > 40:
            lid = lid[:37] + "..."
        print(
            f"  \033[{color}m{ln['status']:10}\033[0m  {lid:40}  "
            f"started {elapsed:>8}  heartbeat {hb:>8}  budget {ln['budget_used'] or 0}"
        )

    if not lanes:
        print("  (no lanes)")

    # ── Handoffs ──
    print()
    _header("RECENT HANDOFFS")
    handoffs = conn.execute(
        "SELECT plan_id, subtask_id, status, handoff_to, created_at FROM handoffs ORDER BY created_at DESC LIMIT 10"
    ).fetchall()
    for h in handoffs:
        ago = _fmt_ts(h["created_at"])
        color = _color_for(h["status"])
        pid = h["plan_id"]
        if len(pid) > 35:
            pid = pid[:32] + "..."
        print(
            f"  \033[{color}m{h['status']:14}\033[0m  {pid:35}  "
            f"{h['subtask_id']:12}  → {h['handoff_to']:12}  {ago}"
        )

    if not handoffs:
        print("  (no handoffs)")

    # ── Events ──
    print()
    _header("RECENT EVENTS")
    events = conn.execute(
        "SELECT event_type, plan_id, lane_id, emitted_at FROM events ORDER BY emitted_at DESC LIMIT 8"
    ).fetchall()
    for e in events:
        ago = _fmt_ts(e["emitted_at"])
        pid = e["plan_id"] or "—"
        lid = e["lane_id"] or "—"
        if len(pid) > 30:
            pid = pid[:27] + "..."
        if len(lid) > 25:
            lid = lid[:22] + "..."
        print(f"  {e['event_type']:22}  {pid:30}  {lid:25}  {ago}")

    if not events:
        print("  (no events)")

    # ── Footer ──
    print()
    print(f"\033[90m  Refreshed: {time.strftime('%H:%M:%S')}  |  DB: {DB_PATH}\033[0m")
    print(f"\033[90m  Press Ctrl+C to exit\033[0m")

    conn.close()


def main():
    try:
        while True:
            draw()
            time.sleep(5)
    except KeyboardInterrupt:
        _clear()
        print("Dashboard stopped.")


if __name__ == "__main__":
    main()
