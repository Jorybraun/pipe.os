#!/usr/bin/env python3
"""
Pipe Swarm Harness — Driver

This script drives the orchestrator and bridges to OpenClaw's agent system.
It runs the orchestrator, detects when agents are needed, and outputs clear
instructions for the parent OpenClaw agent to spawn them.

Usage:
    # Start a new workflow
    python harness_driver.py --task "Add a candidate search filter by skill"
    
    # Resume after agents complete
    python harness_driver.py --resume
    
    # Dry-run: see what would happen without spawning agents
    python harness_driver.py --task "Fix broken imports" --dry-run

Integration with OpenClaw:
    1. Run this script
    2. When it outputs "WAITING_FOR_AGENT", read the task spec
    3. Spawn the agent via sessions_spawn with the task spec
    4. The agent writes results to the result_file path
    5. Run this script again with --resume
    6. Repeat until workflow completes
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).parent
ORCHESTRATOR = HARNESS_DIR / "orchestrator.py"


def run_orchestrator(task: str = None, auto_approve: bool = False, resume: bool = False, reset: bool = False) -> dict:
    """Run the orchestrator and capture its state."""
    cmd = ["python3", str(ORCHESTRATOR)]
    
    if reset:
        cmd.append("--reset")
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(HARNESS_DIR))
        return {"reset": True, "stdout": result.stdout, "stderr": result.stderr}
    
    if resume:
        cmd.append("--resume")
    elif task:
        cmd.extend(["--task", task])
    
    if auto_approve:
        cmd.append("--auto-approve")
    
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(HARNESS_DIR))
    
    # Parse state file to understand where we are
    state_file = HARNESS_DIR / ".swarm" / "state.json"
    state = None
    if state_file.exists():
        state = json.loads(state_file.read_text())
    
    return {
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "state": state,
    }


def detect_pending_agents(state: dict) -> list:
    """Extract pending agent tasks from orchestrator state."""
    if not state:
        return []
    
    agents = []
    
    # Single pending agent
    if "pending_agent" in state:
        agents.append(state["pending_agent"])
    
    # Multiple pending agents (parallel)
    if "pending_agents" in state:
        agents.extend(state["pending_agents"])
    
    return agents


def print_agent_instructions(agent: dict):
    """Print clear instructions for spawning an agent."""
    task_file = Path(agent["task_file"])
    result_file = Path(agent["result_file"])
    role = agent["role"]
    
    task_spec = json.loads(task_file.read_text()) if task_file.exists() else {}
    
    print(f"\n{'='*70}")
    print(f"  WAITING FOR AGENT: {role.upper()}")
    print(f"{'='*70}")
    print(f"\n  Task file:    {task_file}")
    print(f"  Result file:  {result_file}")
    print(f"\n  To complete:")
    print(f"    1. Spawn a {role} agent with the task spec above")
    print(f"    2. Agent should write its final output to: {result_file}")
    print(f"    3. Run: python harness_driver.py --resume")
    print(f"\n  Task spec preview:")
    print(f"    {json.dumps(task_spec, indent=2)[:500]}...")
    print(f"{'='*70}\n")


def print_workflow_summary(state: dict):
    """Print a human-readable summary of workflow progress."""
    if not state:
        print("No active workflow.")
        return
    
    print(f"\n{'='*70}")
    print(f"  WORKFLOW STATUS")
    print(f"{'='*70}")
    print(f"\n  Task: {state.get('task', 'Unknown')}")
    print(f"  Phase: {state.get('phase', 'unknown')}")
    print(f"  Status: {state.get('status', 'unknown')}")
    
    plan = state.get("plan", {})
    needed = []
    if plan.get("needs_design"): needed.append("design")
    if plan.get("needs_architecture"): needed.append("architecture")
    if plan.get("needs_frontend"): needed.append("frontend")
    if plan.get("needs_backend"): needed.append("backend")
    print(f"  Agents needed: {', '.join(needed) if needed else 'none'}")
    
    outputs = state.get("outputs", {})
    completed = list(outputs.keys())
    print(f"  Completed: {', '.join(completed) if completed else 'none'}")
    
    approvals = state.get("approvals", {})
    if approvals:
        print(f"\n  Approvals:")
        for phase, decision in approvals.items():
            print(f"    {phase}: {decision}")
    
    qa = state.get("qa_results", {})
    if qa:
        print(f"\n  QA Results:")
        print(f"    tsc: {'PASS' if qa.get('tsc_passed') else 'FAIL'}")
        print(f"    any types: {'PASS' if qa.get('no_any_types') else 'FAIL'}")
        print(f"    named exports: {'PASS' if qa.get('named_exports') else 'FAIL'}")
        print(f"    changelog: {'PASS' if qa.get('changelog_updated') else 'FAIL'}")
    
    print(f"{'='*70}\n")


def main():
    parser = argparse.ArgumentParser(description="Pipe Swarm Harness Driver")
    parser.add_argument("--task", "-t", help="Task description")
    parser.add_argument("--auto-approve", "-a", action="store_true", help="Skip approval gates")
    parser.add_argument("--resume", "-r", action="store_true", help="Resume from checkpoint")
    parser.add_argument("--reset", action="store_true", help="Clear checkpoint")
    parser.add_argument("--dry-run", "-d", action="store_true", help="Show plan without spawning")
    parser.add_argument("--status", "-s", action="store_true", help="Show current status")
    
    args = parser.parse_args()
    
    if args.status:
        state_file = HARNESS_DIR / ".swarm" / "state.json"
        if state_file.exists():
            state = json.loads(state_file.read_text())
            print_workflow_summary(state)
        else:
            print("No active workflow.")
        return
    
    if args.reset:
        result = run_orchestrator(reset=True)
        print("Workflow reset.")
        return
    
    # Run orchestrator
    result = run_orchestrator(
        task=args.task,
        auto_approve=args.auto_approve,
        resume=args.resume
    )
    
    # Print orchestrator output
    if result["stdout"]:
        print(result["stdout"])
    if result["stderr"]:
        print(result["stderr"], file=sys.stderr)
    
    state = result.get("state")
    if not state:
        print("\nNo state file found. Workflow may have completed or failed.")
        return
    
    # Check for pending agents
    pending = detect_pending_agents(state)
    
    if pending:
        print(f"\n>>> {len(pending)} AGENT(S) NEEDED <<<")
        for agent in pending:
            print_agent_instructions(agent)
        
        if args.dry_run:
            print("(Dry run mode — agents not actually spawned)")
            return
        
        print("\nAction required: Spawn the above agent(s), then run:")
        print(f"  python harness_driver.py --resume")
        sys.exit(2)  # Special exit code: needs agent spawning
    
    # Check if waiting for user approval
    if state.get("phase") == "final_approval" or state.get("status") == "pending_approval":
        print("\n>>> WAITING FOR USER APPROVAL <<<")
        print("Review the output above and approve/reject/revise.")
        print("If non-interactive, check the state file and run with --auto-approve or --resume")
        sys.exit(3)  # Special exit code: needs user approval
    
    # Workflow complete or failed
    if state.get("status") in ("approved_and_complete", "complete"):
        print("\n>>> WORKFLOW COMPLETE <<<")
        print_workflow_summary(state)
        sys.exit(0)
    elif state.get("status", "").startswith("rejected"):
        print(f"\n>>> WORKFLOW REJECTED at {state['status']} <<<")
        sys.exit(1)
    else:
        print(f"\n>>> WORKFLOW IN PROGRESS: {state.get('status')} <<<")
        print_workflow_summary(state)
        sys.exit(0)


if __name__ == "__main__":
    main()
