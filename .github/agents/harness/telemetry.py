#!/usr/bin/env python3
"""
Pipe Swarm Telemetry Layer

Two-way communication system between the orchestrator and swarm agents.
Provides: task dispatch, status reporting, progress tracking, agent health monitoring.

Usage:
    # From orchestrator
    from telemetry import Telemetry
    telemetry = Telemetry("/path/to/.swarm")
    telemetry.dispatch_task(agent_role, task_spec)
    status = telemetry.get_agent_status(agent_role)
    
    # From agent
    from telemetry import AgentReporter
    reporter = AgentReporter("/path/to/.swarm", agent_role)
    reporter.report_progress(50, "Parsed RCD schema, starting migration")
    reporter.report_complete(result, artifacts)
    reporter.report_error("Type mismatch in consumer_slice parsing")

File-based (JSON) for reliability. Each agent gets a mailbox file.
"""

import json
import time
from pathlib import Path
from typing import Any, Optional
from dataclasses import dataclass, asdict
from enum import Enum

class TaskStatus(Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class TaskSpec:
    task_id: str
    role: str
    description: str
    files_to_modify: list[str]
    acceptance_criteria: list[str]
    context: dict[str, Any]
    
@dataclass  
class ProgressReport:
    timestamp: float
    percent: int
    message: str
    files_touched: list[str]
    
@dataclass
class CompletionReport:
    timestamp: float
    success: bool
    summary: str
    changed_files: list[str]
    test_results: dict[str, Any]
    errors: list[str]
    
@dataclass
class AgentMailbox:
    role: str
    current_task: Optional[TaskSpec]
    status: TaskStatus
    progress: list[ProgressReport]
    result: Optional[CompletionReport]
    last_heartbeat: float

class Telemetry:
    """Orchestrator-side telemetry hub."""
    
    def __init__(self, swarm_dir: str):
        self.swarm_path = Path(swarm_dir)
        self.mailbox_dir = self.swarm_path / "mailboxes"
        self.mailbox_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = self.swarm_path / "telemetry.log"
        
    def dispatch_task(self, role: str, task: TaskSpec) -> None:
        """Send a task to an agent's mailbox."""
        mailbox = self._read_mailbox(role)
        mailbox.current_task = task
        mailbox.status = TaskStatus.ASSIGNED
        mailbox.progress = []
        mailbox.result = None
        mailbox.last_heartbeat = time.time()
        self._write_mailbox(role, mailbox)
        self._log(f"DISPATCH {task.task_id} -> {role}")
        
    def get_agent_status(self, role: str) -> AgentMailbox:
        """Read current agent status."""
        return self._read_mailbox(role)
        
    def list_active_agents(self) -> list[str]:
        """List all agents with assigned or in-progress tasks."""
        active = []
        for f in self.mailbox_dir.glob("*.json"):
            role = f.stem
            mailbox = self._read_mailbox(role)
            if mailbox.status in (TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS):
                active.append(role)
        return active
        
    def wait_for_completion(self, role: str, timeout: float = 300.0) -> CompletionReport:
        """Block until agent reports complete or failed."""
        start = time.time()
        while time.time() - start < timeout:
            mailbox = self._read_mailbox(role)
            if mailbox.status == TaskStatus.COMPLETE:
                if mailbox.result:
                    return mailbox.result
                raise RuntimeError(f"Agent {role} marked complete but no result")
            if mailbox.status == TaskStatus.FAILED:
                raise RuntimeError(f"Agent {role} failed: {mailbox.result.errors if mailbox.result else 'unknown'}")
            time.sleep(2.0)
        raise TimeoutError(f"Agent {role} did not complete within {timeout}s")
        
    def cancel_task(self, role: str) -> None:
        """Cancel an agent's current task."""
        mailbox = self._read_mailbox(role)
        mailbox.status = TaskStatus.CANCELLED
        self._write_mailbox(role, mailbox)
        self._log(f"CANCEL -> {role}")
        
    def _read_mailbox(self, role: str) -> AgentMailbox:
        path = self.mailbox_dir / f"{role}.json"
        if path.exists():
            data = json.loads(path.read_text())
            return AgentMailbox(
                role=data["role"],
                current_task=TaskSpec(**data["current_task"]) if data.get("current_task") else None,
                status=TaskStatus(data.get("status", "pending")),
                progress=[ProgressReport(**p) for p in data.get("progress", [])],
                result=CompletionReport(**data["result"]) if data.get("result") else None,
                last_heartbeat=data.get("last_heartbeat", 0.0)
            )
        return AgentMailbox(role=role, current_task=None, status=TaskStatus.PENDING, progress=[], result=None, last_heartbeat=0.0)
        
    def _write_mailbox(self, role: str, mailbox: AgentMailbox) -> None:
        path = self.mailbox_dir / f"{role}.json"
        data = {
            "role": mailbox.role,
            "current_task": asdict(mailbox.current_task) if mailbox.current_task else None,
            "status": mailbox.status.value,
            "progress": [asdict(p) for p in mailbox.progress],
            "result": asdict(mailbox.result) if mailbox.result else None,
            "last_heartbeat": mailbox.last_heartbeat
        }
        path.write_text(json.dumps(data, indent=2))
        
    def _log(self, message: str) -> None:
        entry = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n"
        with open(self.log_path, "a") as f:
            f.write(entry)


class AgentReporter:
    """Agent-side status reporter."""
    
    def __init__(self, swarm_dir: str, role: str):
        self.telemetry = Telemetry(swarm_dir)
        self.role = role
        
    def start_task(self, task_id: str) -> None:
        """Mark task as in progress."""
        mailbox = self.telemetry._read_mailbox(self.role)
        mailbox.status = TaskStatus.IN_PROGRESS
        mailbox.last_heartbeat = time.time()
        self.telemetry._write_mailbox(self.role, mailbox)
        self.telemetry._log(f"START {task_id} by {self.role}")
        
    def report_progress(self, percent: int, message: str, files_touched: list[str] = None) -> None:
        """Report incremental progress."""
        mailbox = self.telemetry._read_mailbox(self.role)
        report = ProgressReport(
            timestamp=time.time(),
            percent=max(0, min(100, percent)),
            message=message,
            files_touched=files_touched or []
        )
        mailbox.progress.append(report)
        mailbox.last_heartbeat = time.time()
        self.telemetry._write_mailbox(self.role, mailbox)
        
    def report_complete(self, summary: str, changed_files: list[str], test_results: dict = None) -> None:
        """Report task completion."""
        mailbox = self.telemetry._read_mailbox(self.role)
        mailbox.result = CompletionReport(
            timestamp=time.time(),
            success=True,
            summary=summary,
            changed_files=changed_files,
            test_results=test_results or {},
            errors=[]
        )
        mailbox.status = TaskStatus.COMPLETE
        mailbox.last_heartbeat = time.time()
        self.telemetry._write_mailbox(self.role, mailbox)
        self.telemetry._log(f"COMPLETE {self.role}: {summary[:80]}")
        
    def report_error(self, error: str, context: dict = None) -> None:
        """Report task failure."""
        mailbox = self.telemetry._read_mailbox(self.role)
        mailbox.result = CompletionReport(
            timestamp=time.time(),
            success=False,
            summary=f"Failed: {error}",
            changed_files=[],
            test_results=context or {},
            errors=[error]
        )
        mailbox.status = TaskStatus.FAILED
        mailbox.last_heartbeat = time.time()
        self.telemetry._write_mailbox(self.role, mailbox)
        self.telemetry._log(f"FAILED {self.role}: {error[:80]}")
        
    def heartbeat(self) -> None:
        """Ping that agent is still alive."""
        mailbox = self.telemetry._read_mailbox(self.role)
        mailbox.last_heartbeat = time.time()
        self.telemetry._write_mailbox(self.role, mailbox)


# ─── CLI for manual inspection ───────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Pipe Swarm Telemetry")
    parser.add_argument("--swarm-dir", default=".swarm", help="Swarm directory")
    parser.add_argument("--status", action="store_true", help="Show all agent statuses")
    parser.add_argument("--watch", action="store_true", help="Watch mode")
    args = parser.parse_args()
    
    telemetry = Telemetry(args.swarm_dir)
    
    if args.status:
        print("=" * 70)
        print("  AGENT STATUS")
        print("=" * 70)
        for role in telemetry.list_active_agents():
            mailbox = telemetry.get_agent_status(role)
            print(f"\n  {role}:")
            print(f"    Status: {mailbox.status.value}")
            if mailbox.progress:
                last = mailbox.progress[-1]
                print(f"    Progress: {last.percent}% — {last.message}")
            if mailbox.result:
                print(f"    Result: {'SUCCESS' if mailbox.result.success else 'FAILED'}")
                print(f"    Summary: {mailbox.result.summary[:100]}")
            print(f"    Last heartbeat: {time.strftime('%H:%M:%S', time.localtime(mailbox.last_heartbeat))}")
        print("=" * 70)
        
    if args.watch:
        print("Watching... Ctrl+C to exit")
        try:
            while True:
                active = telemetry.list_active_agents()
                if active:
                    print(f"\rActive: {', '.join(active)}", end="", flush=True)
                time.sleep(3)
        except KeyboardInterrupt:
            print("\nDone.")
