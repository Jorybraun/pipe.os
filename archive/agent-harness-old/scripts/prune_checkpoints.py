#!/usr/bin/env python3
"""One-time cleanup for the checkpoint database.

Creates a new slim database so we don't need 50 GB of free space for VACUUM.
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Prune old LangGraph checkpoints")
    parser.add_argument(
        "--db",
        default=".checkpoints.db",
        help="Path to checkpoint database",
    )
    parser.add_argument(
        "--keep",
        type=int,
        default=5,
        help="Number of latest checkpoints to keep per thread",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Delete rows in-place (needs free space for VACUUM). "
             "Default behaviour copies kept rows to a new file.",
    )
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    if not db_path.exists():
        print(f"Database not found: {db_path}")
        return 1

    wal_path = db_path.with_suffix(".db-wal")
    shm_path = db_path.with_suffix(".db-shm")
    backup_path = db_path.with_suffix(".db.backup")

    old_size = db_path.stat().st_size
    print(f"Database size before: {old_size / 1e9:.2f} GB")

    if args.in_place:
        conn = sqlite3.connect(str(db_path))
        try:
            cur = conn.execute(
                """
                DELETE FROM checkpoints
                WHERE (thread_id, checkpoint_ns, checkpoint_id) NOT IN (
                    SELECT thread_id, checkpoint_ns, checkpoint_id
                    FROM (
                        SELECT
                            thread_id,
                            checkpoint_ns,
                            checkpoint_id,
                            ROW_NUMBER() OVER (
                                PARTITION BY thread_id, checkpoint_ns
                                ORDER BY rowid DESC
                            ) AS rn
                        FROM checkpoints
                    )
                    WHERE rn <= :keep
                )
                """,
                {"keep": args.keep},
            )
            deleted = cur.rowcount
            conn.execute(
                """
                DELETE FROM writes
                WHERE (thread_id, checkpoint_ns, checkpoint_id) NOT IN (
                    SELECT thread_id, checkpoint_ns, checkpoint_id FROM checkpoints
                )
                """
            )
            conn.commit()
            print(f"Deleted {deleted} checkpoints. Running VACUUM...")
            conn.execute("VACUUM")
        finally:
            conn.close()
    else:
        # Copy kept rows to a new file so we don't need 50 GB temp space.
        new_path = db_path.with_suffix(".db.new")
        if new_path.exists():
            new_path.unlink()

        src = sqlite3.connect(str(db_path))
        dst = sqlite3.connect(str(new_path))
        try:
            # Copy schema
            schema = src.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL").fetchall()
            for (sql,) in schema:
                dst.execute(sql)
            dst.commit()

            # Copy kept checkpoints
            cur = dst.execute(
                """
                INSERT INTO checkpoints
                SELECT * FROM checkpoints
                WHERE (thread_id, checkpoint_ns, checkpoint_id) IN (
                    SELECT thread_id, checkpoint_ns, checkpoint_id
                    FROM (
                        SELECT
                            thread_id,
                            checkpoint_ns,
                            checkpoint_id,
                            ROW_NUMBER() OVER (
                                PARTITION BY thread_id, checkpoint_ns
                                ORDER BY rowid DESC
                            ) AS rn
                        FROM checkpoints
                    )
                    WHERE rn <= :keep
                )
                """,
                {"keep": args.keep},
            )
            copied = cur.rowcount

            # Copy writes for kept checkpoints
            dst.execute(
                """
                INSERT INTO writes
                SELECT * FROM writes
                WHERE (thread_id, checkpoint_ns, checkpoint_id) IN (
                    SELECT thread_id, checkpoint_ns, checkpoint_id FROM checkpoints
                )
                """
            )
            dst.commit()
            print(f"Copied {copied} checkpoints to new database.")
        finally:
            src.close()
            dst.close()

        # Swap files
        shutil.move(db_path, backup_path)
        if wal_path.exists():
            wal_path.unlink()
        if shm_path.exists():
            shm_path.unlink()
        shutil.move(new_path, db_path)
        print(f"Old database moved to: {backup_path}")
        print("Delete the .backup file once you're happy.")

    new_size = db_path.stat().st_size
    print(f"Database size after:  {new_size / 1e9:.2f} GB")
    print(f"Space reclaimed:      {(old_size - new_size) / 1e9:.2f} GB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
