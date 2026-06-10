#!/usr/bin/env python3
"""Minimal swarm console: tail events, post cues, list/resume interrupts."""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from agent_harness.broker import get_events, post_cue, resume_interrupt, list_interrupts


def cmd_tail(args: argparse.Namespace) -> None:
    since = time.time() - 3600
    print(f"[*] Tailing events (plan_id={args.plan_id or 'all'})...")
    try:
        while True:
            events = get_events(plan_id=args.plan_id or None, since=since)
            for evt in events:
                ts = time.strftime("%H:%M:%S", time.localtime(evt["emitted_at"]))
                payload = evt.get("payload") or {}
                print(f"[{ts}] {evt['event_type']:20} plan={evt.get('plan_id') or '-':30} {payload}")
                since = max(since, evt["emitted_at"] + 0.001)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n[*] Stopped.")


def cmd_cue(args: argparse.Namespace) -> None:
    result = post_cue(
        content=args.content,
        plan_id=args.plan_id or None,
        lane_id=args.lane_id or None,
    )
    print(result)


def cmd_resume(args: argparse.Namespace) -> None:
    record = resume_interrupt(
        plan_id=args.plan_id,
        payload={"decision": args.decision},
    )
    if record:
        print(f"Resumed: {record['interrupt_id']} → {record['status']}")
    else:
        print("No active interrupt found.")


def cmd_interrupts(args: argparse.Namespace) -> None:
    rows = list_interrupts(status=args.status or None, plan_id=args.plan_id or None)
    for r in rows:
        print(f"{r['interrupt_id']}  {r['status']:10}  plan={r['plan_id']}  reason={r['reason']}  thread={r['thread_id']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Swarm Console")
    sub = parser.add_subparsers(dest="command")

    tail = sub.add_parser("tail", help="Tail broker events")
    tail.add_argument("--plan-id", default="")
    tail.add_argument("--interval", type=float, default=2.0)

    cue = sub.add_parser("cue", help="Post a steering cue")
    cue.add_argument("content")
    cue.add_argument("--plan-id", default="")
    cue.add_argument("--lane-id", default="")

    resume = sub.add_parser("resume", help="Resume an interrupted plan")
    resume.add_argument("plan_id")
    resume.add_argument("--decision", default="merge_approved")

    ints = sub.add_parser("interrupts", help="List interrupts")
    ints.add_argument("--status", default="active")
    ints.add_argument("--plan-id", default="")

    args = parser.parse_args()
    if args.command == "tail":
        cmd_tail(args)
    elif args.command == "cue":
        cmd_cue(args)
    elif args.command == "resume":
        cmd_resume(args)
    elif args.command == "interrupts":
        cmd_interrupts(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
