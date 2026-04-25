#!/usr/bin/env python3
"""
Agent Harness — Telemetry

Event logging and mailbox system for two-way communication
between orchestrator and agents.
"""

import json
import time
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional, List


@dataclass
class ProgressReport:
    timestamp: float
    percent: int
    message: str
    files_touched: List[str]


@dataclass
class CompletionReport:
    timestamp: float
    success: bool
    summary: str
    changed_files: List[str]
    test_results: dict
    errors: List[str]


class Telemetry:
    """Orchestrator-side telemetry hub."""
    
    def __init__(self, swarm_dir: str):
        self.swarm_path = Path(swarm_dir)
        self.mailbox_dir = self.swarm_path / "mailboxes"
        self.mailbox_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = self.swarm_path / "telemetry.jsonl"
        
    def log_event(self, event_type: str, agent_role: str, data: dict) -> None:
        """Log an event to the telemetry log."""
        entry = {
            "timestamp": time.time(),
            "type": event_type,
            "agent": agent_role,
            "data": data,
        }
        with open(self.log_path, "a") as f:
            f.write(json.dumps(entry) + "\n")
    
    def get_summary(self) -> dict:
        """Get a summary of all logged events."""
        if not self.log_path.exists():
            return {"events": 0, "agents": [], "duration": 0}
        
        events = []
        with open(self.log_path) as f:
            for line in f:
                events.append(json.loads(line))
        
        agents = set(e["agent"] for e in events)
        
        return {
            "events": len(events),
            "agents": list(agents),
            "duration": events[-1]["timestamp"] - events[0]["timestamp"] if len(events) >= 2 else 0,
        }


class AgentReporter:
    """Agent-side status reporter."""
    
    def __init__(self, swarm_dir: str, role: str):
        self.telemetry = Telemetry(swarm_dir)
        self.role = role
        
    def report_progress(self, percent: int, message: str, files_touched: list = None) -> None:
        """Report incremental progress."""
        self.telemetry.log_event("progress", self.role, {
            "percent": percent,
            "message": message,
            "files": files_touched or [],
        })
        
    def report_complete(self, summary: str, changed_files: list, test_results: dict = None) -> None:
        """Report task completion."""
        self.telemetry.log_event("complete", self.role, {
            "summary": summary,
            "changed_files": changed_files,
            "test_results": test_results or {},
        })
        
    def report_error(self, error: str, context: dict = None) -> None:
        """Report task failure."""
        self.telemetry.log_event("error", self.role, {
            "error": error,
            "context": context or {},
        })
