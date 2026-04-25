#!/usr/bin/env python3
"""
Pipe Swarm Harness v3 — True Parallel Swarm

This is a swarm, not a chain of sub-agents.

Key differences from v2:
- Agents are spawned in PARALLEL, not sequentially
- All agents read/write to shared telemetry bus
- No "phases" — agents coordinate through events
- Orchestrator monitors, does not micromanage

Architecture:
    Task → Orchestrator (analysis)
              ↓
    ┌─────────────────────────────────────────┐
    │  SWARM BROADCAST                        │
    │  All relevant agents start immediately  │
    └─────────────────────────────────────────┘
              ↓
    Agents work simultaneously, reading each other's progress
              ↓
    Event-driven handoffs (not orchestrator-driven)
              ↓
    QA monitors continuously, not at the end
              ↓
    Orchestrator synthesizes final result when swarm converges

Usage:
    # Start swarm on a task
    python swarm.py --task "Add candidate search filter"
    
    # Check swarm status
    python swarm.py --status
    
    # Converge and present results
    python swarm.py --converge
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Set

REPO_ROOT = Path("/root/.openclaw/workspace/pipe.os")
SWARM_DIR = REPO_ROOT / ".swarm"
TELEMETRY_FILE = SWARM_DIR / "telemetry.jsonl"
AGENTS_DIR = REPO_ROOT / ".github" / "agents" / "harness"

class TelemetryBus:
    """Shared event bus that all agents read/write."""
    
    def __init__(self, swarm_dir: Path):
        self.swarm_dir = swarm_dir
        self.telemetry_file = swarm_dir / "telemetry.jsonl"
        self.mailbox_dir = swarm_dir / "mailboxes"
        self.mailbox_dir.mkdir(parents=True, exist_ok=True)
        self.telemetry_file.parent.mkdir(parents=True, exist_ok=True)
    
    def emit(self, agent: str, event_type: str, data: dict):
        """Any agent can emit an event at any time."""
        entry = {
            "timestamp": time.time(),
            "agent": agent,
            "type": event_type,
            "data": data,
        }
        with open(self.telemetry_file, "a") as f:
            f.write(json.dumps(entry) + "\n")
    
    def read_all(self) -> List[dict]:
        """Read all events. Agents use this to see what others have done."""
        if not self.telemetry_file.exists():
            return []
        events = []
        with open(self.telemetry_file) as f:
            for line in f:
                if line.strip():
                    events.append(json.loads(line))
        return events
    
    def read_by_agent(self, agent: str) -> List[dict]:
        """Get all events from a specific agent."""
        return [e for e in self.read_all() if e["agent"] == agent]
    
    def read_latest(self, event_type: str = None, agent: str = None) -> Optional[dict]:
        """Get the latest matching event."""
        events = self.read_all()
        if event_type:
            events = [e for e in events if e["type"] == event_type]
        if agent:
            events = [e for e in events if e["agent"] == agent]
        return events[-1] if events else None
    
    def get_swarm_status(self) -> dict:
        """Get current swarm state."""
        events = self.read_all()
        agents = set(e["agent"] for e in events)
        completed = set(e["agent"] for e in events if e["type"] == "complete")
        errors = [e for e in events if e["type"] == "error"]
        
        return {
            "total_events": len(events),
            "active_agents": list(agents),
            "completed": list(completed),
            "errors": len(errors),
            "converged": len(errors) == 0 and len(completed) >= len(agents) - 1,
        }


class Swarm:
    """Manages parallel agent execution."""
    
    def __init__(self, task: str, repo_root: Path = REPO_ROOT):
        self.task = task
        self.repo_root = repo_root
        self.swarm_dir = repo_root / ".swarm"
        self.telemetry = TelemetryBus(self.swarm_dir)
        self.agents_dir = repo_root / ".github" / "agents" / "harness"
        
        # Load prompts
        self.prompts = {}
        prompts_dir = self.agents_dir / "prompts"
        if prompts_dir.exists():
            for f in prompts_dir.glob("*.md"):
                self.prompts[f.stem] = f.read_text()
    
    def analyze_task(self) -> dict:
        """Determine which agents should join the swarm."""
        task_lower = self.task.lower()
        
        needs = {
            "pm": True,  # Always
            "designer": any(w in task_lower for w in ["ui", "page", "component", "layout", "design", "modal", "form", "card", "badge", "color", "screen"]),
            "architect": any(w in task_lower for w in ["schema", "model", "table", "api", "database", "migration", "adr", "architecture", "structural", "data model"]),
            "backend": any(w in task_lower for w in ["api", "route", "lambda", "database", "backend", "scorer", "pipeline", "crawler", "matching", "server"]),
            "frontend": any(w in task_lower for w in ["react", "component", "page", "hook", "tsx", "frontend", "ui", "screen", "modal", "form"]),
            "qa": True,  # Always monitor
        }
        
        # If it's a simple backend fix, only backend + qa
        if not needs["designer"] and not needs["frontend"] and needs["backend"]:
            needs["pm"] = False  # Skip PM for simple fixes
            needs["architect"] = False  # Skip architect for simple fixes
        
        return needs
    
    def build_agent_task(self, role: str, context: dict = None) -> str:
        """Build the task spec for an agent."""
        system_prompt = self.prompts.get(role, "")
        context = context or {}
        
        return f"""{system_prompt}

## SWARM TASK
{self.task}

## YOUR ROLE
You are the {role.upper()} in a parallel swarm. Other agents are working simultaneously.

## SHARED CONTEXT
{context.get('shared', '')}

## HOW TO PARTICIPATE
1. Read the telemetry bus to see what other agents have done
2. Do your work
3. Emit progress events as you go
4. Emit a complete event when done
5. If you see another agent's work that affects yours, adapt

## TELEMETRY
Write events to: {self.telemetry.telemetry_file}
Format: {{"agent": "{role}", "type": "progress|complete|error", "data": {{...}}}}

## RULES
- Work in repo: {self.repo_root}
- Run `npx tsc --noEmit` before finishing
- Return ONLY your output
"""
    
    def spawn_swarm(self) -> dict:
        """Spawn all agents in parallel."""
        needs = self.analyze_task()
        active_agents = [role for role, needed in needs.items() if needed]
        
        print(f"\n{'='*70}")
        print(f"  SWARM INIT: {self.task}")
        print(f"{'='*70}")
        print(f"\nActive agents: {', '.join(active_agents)}")
        print(f"Telemetry: {self.telemetry.telemetry_file}\n")
        
        # Emit swarm start event
        self.telemetry.emit("orchestrator", "swarm_start", {
            "task": self.task,
            "agents": active_agents,
        })
        
        # Build task specs for each agent
        tasks = {}
        for role in active_agents:
            tasks[role] = self.build_agent_task(role)
        
        # Output spawn instructions for parent agent
        # (Since we can't actually spawn from Python, we output instructions)
        spawn_instructions = []
        for role in active_agents:
            task_file = self.swarm_dir / "tasks" / f"{role}_{int(time.time())}.md"
            task_file.parent.mkdir(parents=True, exist_ok=True)
            task_file.write_text(tasks[role])
            
            instruction = f"AGENT_INSTRUCTION|{role}|{self.task[:50]}|{task_file}"
            spawn_instructions.append(instruction)
            print(f"  [SPAWN] {role:12} → {task_file}")
        
        print(f"\n{'='*70}")
        print("  SWARM SPAWNED — All agents starting in parallel")
        print(f"{'='*70}\n")
        
        return {
            "task": self.task,
            "agents": active_agents,
            "instructions": spawn_instructions,
            "telemetry_file": str(self.telemetry.telemetry_file),
        }
    
    def monitor(self, timeout: int = 600) -> dict:
        """Monitor swarm until convergence or timeout."""
        print(f"Monitoring swarm (timeout: {timeout}s)...")
        start = time.time()
        
        while time.time() - start < timeout:
            status = self.telemetry.get_swarm_status()
            
            print(f"\r  Events: {status['total_events']} | "
                  f"Agents: {len(status['active_agents'])} | "
                  f"Complete: {len(status['completed'])} | "
                  f"Errors: {status['errors']}", end="")
            
            if status["converged"]:
                print("\n\n  SWARM CONVERGED")
                return status
            
            time.sleep(2)
        
        print("\n\n  TIMEOUT — Swarm did not converge")
        return self.telemetry.get_swarm_status()
    
    def converge(self) -> dict:
        """Present final results when swarm converges."""
        events = self.telemetry.read_all()
        
        # Group outputs by agent
        outputs = {}
        for e in events:
            if e["type"] == "complete":
                outputs[e["agent"]] = e["data"]
        
        # Build summary
        summary = {
            "task": self.task,
            "status": "converged" if len(outputs) > 0 else "incomplete",
            "agents_completed": list(outputs.keys()),
            "outputs": outputs,
            "telemetry": str(self.telemetry.telemetry_file),
        }
        
        print(f"\n{'='*70}")
        print("  SWARM RESULTS")
        print(f"{'='*70}")
        for agent, output in outputs.items():
            print(f"\n  [{agent.upper()}]")
            if isinstance(output, dict) and "summary" in output:
                print(f"  {output['summary'][:200]}...")
            else:
                print(f"  {str(output)[:200]}...")
        
        return summary


def main():
    parser = argparse.ArgumentParser(description="Pipe Swarm v3")
    parser.add_argument("--task", "-t", help="Task description")
    parser.add_argument("--spawn", "-s", action="store_true", help="Spawn swarm")
    parser.add_argument("--monitor", "-m", action="store_true", help="Monitor swarm")
    parser.add_argument("--converge", "-c", action="store_true", help="Converge and present")
    parser.add_argument("--status", action="store_true", help="Show status")
    parser.add_argument("--reset", action="store_true", help="Reset telemetry")
    
    args = parser.parse_args()
    
    if args.reset:
        if TELEMETRY_FILE.exists():
            TELEMETRY_FILE.unlink()
        print("Telemetry reset.")
        return
    
    if args.status:
        bus = TelemetryBus(SWARM_DIR)
        status = bus.get_swarm_status()
        print(json.dumps(status, indent=2))
        return
    
    if args.task:
        swarm = Swarm(args.task)
        
        if args.spawn or not (args.monitor or args.converge):
            result = swarm.spawn_swarm()
            print("\n--- SPAWN INSTRUCTIONS ---")
            for inst in result["instructions"]:
                print(inst)
        
        if args.monitor:
            swarm.monitor()
        
        if args.converge:
            swarm.converge()
    else:
        print("Provide --task or use --status")


if __name__ == "__main__":
    main()
