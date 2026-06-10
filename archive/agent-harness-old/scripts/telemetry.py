#!/usr/bin/env python3
"""Agent Harness — Telemetry

Log events and summarize agent workflow telemetry.

Usage:
    python telemetry.py --repo ~/Code/PIPE/PIPE-OS --event "phase_complete" --agent "pm" --data '{"phase":"pm"}'
    python telemetry.py --repo ~/Code/PIPE/PIPE-OS --summary
"""

import argparse
import json
import time
from pathlib import Path


def log_event(swarm_dir: Path, event_type: str, agent_role: str, data: dict) -> None:
    """Log an event to telemetry.jsonl."""
    swarm_dir.mkdir(parents=True, exist_ok=True)
    log_path = swarm_dir / "telemetry.jsonl"
    entry = {
        "timestamp": time.time(),
        "type": event_type,
        "agent": agent_role,
        "data": data,
    }
    with open(log_path, "a") as f:
        f.write(json.dumps(entry) + "\n")


def get_summary(swarm_dir: Path) -> dict:
    """Get a summary of all logged events."""
    log_path = swarm_dir / "telemetry.jsonl"
    if not log_path.exists():
        return {"events": 0, "agents": [], "duration": 0}

    events = []
    with open(log_path) as f:
        for line in f:
            line = line.strip()
            if line:
                events.append(json.loads(line))

    agents = sorted(set(e["agent"] for e in events))
    duration = (
        events[-1]["timestamp"] - events[0]["timestamp"]
        if len(events) >= 2
        else 0
    )

    return {
        "events": len(events),
        "agents": agents,
        "duration": round(duration, 2),
    }


def main():
    parser = argparse.ArgumentParser(description="Agent Harness Telemetry")
    parser.add_argument("--repo", "-r", default=".", help="Path to repository")
    parser.add_argument("--event", "-e", help="Event type")
    parser.add_argument("--agent", "-a", help="Agent role")
    parser.add_argument("--data", "-d", default="{}", help="JSON data string")
    parser.add_argument("--summary", "-s", action="store_true", help="Print summary")
    args = parser.parse_args()

    repo = Path(args.repo).expanduser().resolve()
    swarm_dir = repo / ".swarm"

    if args.summary:
        summary = get_summary(swarm_dir)
        print(json.dumps(summary, indent=2))
    elif args.event and args.agent:
        data = json.loads(args.data)
        log_event(swarm_dir, args.event, args.agent, data)
        print(json.dumps({"status": "logged"}, indent=2))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
