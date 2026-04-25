#!/usr/bin/env python3
"""
Pipe Swarm Harness Runner — Production Version

Launches swarm agents with proper task specs referencing knowledge/plan docs.
Uses telemetry layer for two-way communication.

Usage:
    python harness_runner.py --task "Phase 0.1: RCD Consumer Cutover" \
        --doc "knowledge/plan/pipe-strategy-v2-part1-north-star.md" \
        --role backend

The runner:
1. Reads the strategy document
2. Builds a task spec referencing the doc
3. Dispatches to agent via OpenClaw sessions_spawn
4. Monitors via telemetry layer
5. Reports results
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path("/Users/hans/Code/PIPE/PIPE-OS")
HARNESS_DIR = REPO_ROOT / ".github" / "agents" / "harness"
SWARM_DIR = HARNESS_DIR / ".swarm"

sys.path.insert(0, str(HARNESS_DIR))
from telemetry import Telemetry, TaskSpec, TaskStatus


def read_strategy_doc(doc_path: str) -> str:
    """Read a strategy document from knowledge/plan."""
    full_path = REPO_ROOT / doc_path
    if not full_path.exists():
        raise FileNotFoundError(f"Strategy doc not found: {full_path}")
    return full_path.read_text()


def build_task_spec(role: str, task_name: str, doc_path: str, context: dict) -> TaskSpec:
    """Build a task spec that references the strategy document."""
    doc_content = read_strategy_doc(doc_path)
    
    return TaskSpec(
        task_id=f"{role}_{int(time.time())}",
        role=role,
        description=f"""# Task: {task_name}

## Source of Truth
Read this document first: `{doc_path}`
This is the authoritative strategy document. All decisions must align with it.

## Your Goal
{context.get('goal', 'Implement the feature as described in the strategy document.')}

## Context
{context.get('context', '')}

## Files to Modify
{chr(10).join(f"- {f}" for f in context.get('files', []))}

## Acceptance Criteria
{chr(10).join(f"- {c}" for c in context.get('criteria', []))}

## Rules
- Read the strategy document BEFORE making any changes
- Work in the repo at: {REPO_ROOT}
- Work on branch: claude-dev
- Run `npx tsc --noEmit` before finishing
- Do NOT commit. Leave changes unstaged.
- Report progress via telemetry.
""",
        files_to_modify=context.get('files', []),
        acceptance_criteria=context.get('criteria', []),
        context={
            'repo_root': str(REPO_ROOT),
            'branch': 'claude-dev',
            'strategy_doc': doc_path,
            'strategy_content': doc_content[:5000],  # First 5KB of doc
        }
    )


def spawn_agent(task: TaskSpec) -> str:
    """Spawn an agent via OpenClaw sessions_spawn."""
    # Write task to a JSON file that the agent can read
    task_file = SWARM_DIR / "tasks" / f"{task.task_id}.json"
    task_file.parent.mkdir(parents=True, exist_ok=True)
    task_file.write_text(json.dumps({
        'task_id': task.task_id,
        'role': task.role,
        'description': task.description,
        'files_to_modify': task.files_to_modify,
        'acceptance_criteria': task.acceptance_criteria,
        'context': task.context,
    }, indent=2))
    
    # Build the sessions_spawn command
    # Note: This is a conceptual representation. Actual sessions_spawn
    # is done via OpenClaw tool calls, not subprocess.
    print(f"\n{'='*70}")
    print(f"  SPAWNING AGENT: {task.role}")
    print(f"  Task: {task.task_id}")
    print(f"  Strategy doc: {task.context['strategy_doc']}")
    print(f"{'='*70}\n")
    
    return task.task_id


def monitor_agent(telemetry: Telemetry, role: str, timeout: float = 600.0) -> dict:
    """Monitor an agent until completion or timeout."""
    start = time.time()
    last_progress_count = 0
    
    print(f"Monitoring {role}...")
    
    while time.time() - start < timeout:
        mailbox = telemetry.get_agent_status(role)
        
        if mailbox.status == TaskStatus.COMPLETE:
            print(f"\n✅ {role} COMPLETE")
            if mailbox.result:
                print(f"Summary: {mailbox.result.summary}")
                print(f"Changed files: {', '.join(mailbox.result.changed_files)}")
            return {'status': 'complete', 'result': mailbox.result}
            
        if mailbox.status == TaskStatus.FAILED:
            print(f"\n❌ {role} FAILED")
            if mailbox.result:
                print(f"Errors: {mailbox.result.errors}")
            return {'status': 'failed', 'errors': mailbox.result.errors if mailbox.result else []}
        
        # Show progress updates
        if len(mailbox.progress) > last_progress_count:
            for p in mailbox.progress[last_progress_count:]:
                print(f"  [{p.percent}%] {p.message}")
            last_progress_count = len(mailbox.progress)
        
        time.sleep(3.0)
    
    print(f"\n⏱️ {role} TIMEOUT after {timeout}s")
    return {'status': 'timeout'}


def main():
    parser = argparse.ArgumentParser(description="Pipe Swarm Harness Runner")
    parser.add_argument("--task", "-t", required=True, help="Task name")
    parser.add_argument("--doc", "-d", required=True, help="Strategy document path (relative to repo root)")
    parser.add_argument("--role", "-r", required=True, help="Agent role (backend, frontend, architect, etc.)")
    parser.add_argument("--files", "-f", nargs="+", help="Files to modify")
    parser.add_argument("--criteria", "-c", nargs="+", help="Acceptance criteria")
    parser.add_argument("--goal", "-g", help="Goal description")
    parser.add_argument("--context", help="Additional context")
    parser.add_argument("--timeout", type=float, default=600.0, help="Timeout in seconds")
    
    args = parser.parse_args()
    
    # Initialize telemetry
    telemetry = Telemetry(str(SWARM_DIR))
    
    # Build task spec
    task = build_task_spec(
        role=args.role,
        task_name=args.task,
        doc_path=args.doc,
        context={
            'goal': args.goal or f"Implement {args.task} as described in the strategy document",
            'context': args.context or '',
            'files': args.files or [],
            'criteria': args.criteria or [],
        }
    )
    
    # Dispatch task
    telemetry.dispatch_task(args.role, task)
    task_id = spawn_agent(task)
    
    # Monitor
    result = monitor_agent(telemetry, args.role, args.timeout)
    
    # Final report
    print(f"\n{'='*70}")
    print(f"  TASK RESULT: {result['status'].upper()}")
    print(f"{'='*70}")
    
    return 0 if result['status'] == 'complete' else 1


if __name__ == "__main__":
    sys.exit(main())
