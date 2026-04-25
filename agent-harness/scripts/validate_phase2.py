#!/usr/bin/env python3
"""Phase 2 validation: event bus, cue channel, migration ledger, interrupt registry.

Usage:
    cd /repo-root
    python -m agent_harness.scripts.validate_phase2

Expects:
    - Broker DB initialised (auto-created at .swarm/broker.db)
    - docs/plans/strategy-v2/**/*.md present (for plan sync)
"""
from __future__ import annotations

import json
import sqlite3
import sys
import threading
import time
from pathlib import Path

# Ensure agent_harness is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from agent_harness.broker.db import init_db, get_conn
from agent_harness.broker.plan_walker import sync_plans_to_db, get_plan, runnable_set
from agent_harness.broker.event_bus import emit, get_events
from agent_harness.broker.cue_channel import post_cue, read_cues, ack_cue
from agent_harness.broker.migration_ledger import reserve_migration, release_migration, list_reserved
from agent_harness.broker.interrupt_registry import (
    register_interrupt,
    resume_interrupt,
    get_interrupt,
    list_interrupts,
)

DB_PATH = ".swarm/broker.db"
PASS = 0
FAIL = 0


def _ok(name: str) -> None:
    global PASS
    PASS += 1
    print(f"  ✓ {name}")


def _err(name: str, msg: str) -> None:
    global FAIL
    FAIL += 1
    print(f"  ✗ {name}: {msg}")


def main() -> int:
    print("=" * 60)
    print("Phase 2 Validation: Event Bus + Cue Channel + Migration Ledger + Interrupts")
    print("=" * 60)

    # ------------------------------------------------------------------
    # Setup
    # ------------------------------------------------------------------
    print("\n[setup] Initialising broker DB and syncing plans...")
    init_db(DB_PATH)
    synced = sync_plans_to_db()
    print(f"  Synced {synced} plans")

    # Pick a plan_id to use for plan-scoped tests
    runnable = runnable_set()
    plan_id = runnable[0] if runnable else "part0-foundations/reliability-retry-and-error-classification.md"
    if not get_plan(plan_id):
        _err("setup", f"Cannot find plan {plan_id}")
        return 1
    print(f"  Using plan_id: {plan_id}")

    # ------------------------------------------------------------------
    # Event Bus
    # ------------------------------------------------------------------
    print("\n[event_bus] Testing emit + get_events...")
    since = time.time()
    evt1 = emit("subtask_started", {"subtask": "subtask-1"}, plan_id=plan_id, lane_id="lane-A")
    evt2 = emit("subtask_complete", {"subtask": "subtask-1"}, plan_id=plan_id, lane_id="lane-A")
    rows = get_events(plan_id=plan_id, since=since)
    if len(rows) >= 2:
        _ok("emit stores events")
    else:
        _err("emit stores events", f"expected >=2, got {len(rows)}")

    rows_by_type = get_events(event_type="subtask_started", since=since)
    if any(r["event_id"] == evt1 for r in rows_by_type):
        _ok("get_events filters by type")
    else:
        _err("get_events filters by type", "evt1 not found")

    # ------------------------------------------------------------------
    # Cue Channel
    # ------------------------------------------------------------------
    print("\n[cue_channel] Testing post_cue + read_cues + ack_cue...")
    cue_res = post_cue("focus on error handling", plan_id=plan_id, lane_id="lane-A")
    if cue_res.get("status") == "posted" and cue_res.get("cue_id"):
        _ok("post_cue creates cue")
    else:
        _err("post_cue creates cue", str(cue_res))

    # Dedupe test
    cue_res2 = post_cue("focus on error handling", plan_id=plan_id, lane_id="lane-A")
    if cue_res2.get("status") == "deduped":
        _ok("post_cue dedupes by hash")
    else:
        _err("post_cue dedupes by hash", str(cue_res2))

    cues = read_cues(plan_id=plan_id)
    if any(c["cue_id"] == cue_res["cue_id"] for c in cues):
        _ok("read_cues returns pending cue")
    else:
        _err("read_cues returns pending cue", "cue not in pending list")

    acked = ack_cue(cue_res["cue_id"])
    if acked:
        _ok("ack_cue marks cue acked")
    else:
        _err("ack_cue marks cue acked", "returned False")

    cues_after = read_cues(plan_id=plan_id)
    if not any(c["cue_id"] == cue_res["cue_id"] for c in cues_after):
        _ok("acked cue no longer in pending")
    else:
        _err("acked cue no longer in pending", "still present")

    # ------------------------------------------------------------------
    # Migration Ledger
    # ------------------------------------------------------------------
    print("\n[migration_ledger] Testing reserve + release + list...")
    # Clean slate for test env
    conn = get_conn(DB_PATH)
    conn.execute("DELETE FROM migration_ledger WHERE env = 'test'")
    conn.commit()
    conn.close()

    num1 = reserve_migration("test", plan_id=plan_id, lane_id="lane-A")
    if num1 == 1:
        _ok("reserve_migration returns 1 for fresh env")
    else:
        _err("reserve_migration returns 1 for fresh env", f"got {num1}")

    num2 = reserve_migration("test", plan_id=plan_id, lane_id="lane-B")
    if num2 == 2:
        _ok("reserve_migration returns 2 sequentially")
    else:
        _err("reserve_migration returns 2 sequentially", f"got {num2}")

    reserved = list_reserved("test")
    if len(reserved) == 2:
        _ok("list_reserved shows 2 reservations")
    else:
        _err("list_reserved shows 2 reservations", f"got {len(reserved)}")

    released = release_migration(num1, "test")
    if released:
        _ok("release_migration tombstones number")
    else:
        _err("release_migration tombstones number", "returned False")

    reserved_after = list_reserved("test")
    if len(reserved_after) == 1 and reserved_after[0]["number"] == 2:
        _ok("list_reserved excludes released number")
    else:
        _err("list_reserved excludes released number", str(reserved_after))

    # Race condition test: two threads reserving simultaneously
    print("\n[migration_ledger] Race condition test (2 threads, 10 reservations each)...")
    results: list[int] = []
    lock = threading.Lock()

    def reserve_batch() -> None:
        for _ in range(10):
            n = reserve_migration("race", plan_id=plan_id, lane_id="lane-race")
            with lock:
                results.append(n)

    t1 = threading.Thread(target=reserve_batch)
    t2 = threading.Thread(target=reserve_batch)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    if len(results) == 20 and len(set(results)) == 20:
        _ok("20 concurrent reservations, all unique")
    else:
        _err("20 concurrent reservations, all unique", f"{len(results)} results, {len(set(results))} unique")

    # Cleanup race env
    conn = get_conn(DB_PATH)
    conn.execute("DELETE FROM migration_ledger WHERE env = 'race'")
    conn.commit()
    conn.close()

    # ------------------------------------------------------------------
    # Interrupt Registry
    # ------------------------------------------------------------------
    print("\n[interrupt_registry] Testing register + resume + get + list...")
    # Clean slate
    conn = get_conn(DB_PATH)
    conn.execute("DELETE FROM interrupts WHERE plan_id = ?", (plan_id,))
    conn.commit()
    conn.close()

    rec = register_interrupt(
        plan_id=plan_id,
        thread_id="thread-123",
        reason="migration touch",
        lane_id="lane-A",
        checkpoint_id="chk-456",
    )
    if rec["status"] == "active" and rec["interrupt_id"]:
        _ok("register_interrupt creates active record")
    else:
        _err("register_interrupt creates active record", str(rec))

    fetched = get_interrupt(plan_id, status="active")
    if fetched and fetched["thread_id"] == "thread-123":
        _ok("get_interrupt retrieves active record")
    else:
        _err("get_interrupt retrieves active record", str(fetched))

    all_ints = list_interrupts(status="active", plan_id=plan_id)
    if len(all_ints) == 1:
        _ok("list_interrupts filters correctly")
    else:
        _err("list_interrupts filters correctly", f"got {len(all_ints)}")

    resumed = resume_interrupt(plan_id, payload={"decision": "proceed"})
    if resumed and resumed["status"] == "resumed":
        _ok("resume_interrupt transitions to resumed")
    else:
        _err("resume_interrupt transitions to resumed", str(resumed))

    active_after = get_interrupt(plan_id, status="active")
    if active_after is None:
        _ok("no active interrupt after resume")
    else:
        _err("no active interrupt after resume", str(active_after))

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print(f"Results: {PASS} passed, {FAIL} failed")
    print("=" * 60)
    return 1 if FAIL > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
