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
    
    # Machine-readable output for automation
    python harness_driver.py --task "Fix broken imports" --json

Integration with OpenClaw:
    1. Run this script
    2. Parse AGENT_INSTRUCTION markers from output:
       AGENT_INSTRUCTION|role|task_id|task_description|result_file
    3. For each pending agent:
       - Read the task spec from the task_file
       - Call sessions_spawn with the task spec
       - The spawned agent writes results to the result_file
    4. Run this script again with --resume after agents complete
    5. Repeat until workflow completes
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).parent
ORCHESTRATOR = HARNESS_DIR / "orchestrator.py"
SWARM_DIR = HARNESS_DIR / ".swarm"

sys.path.insert(0, str(HARNESS_DIR))
from telemetry import Telemetry, TaskStatus


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
    """Extract pending agent tasks from orchestrator state.
    
    Looks for AGENT_INSTRUCTION markers in outputs and extracts
    the role, task_id, and result_file for each pending agent.
    """
    pending = []
    
    # Check each output for pending markers
    for key, value in state.get("outputs", {}).items():
        if isinstance(value, str) and value.startswith("[PENDING:"):
            # Extract result file path from marker
            result_file = value.replace("[PENDING: ", "").replace("]", "").strip()
            
            # Determine role from key (design, architecture, backend, frontend)
            role = key.replace("_output", "").replace("_spec", "")
            
            # Find the task file
            task_file = result_file.replace("_result.md", "_task.md")
            
            pending.append({
                "role": role,
                "result_file": result_file,
                "task_file": task_file,
                "status": "pending"
            })
    
    return pending
    
    agents = []
    
    # Single pending agent
    if "pending_agent" in state:
        agents.append(state["pending_agent"])
    
    # Multiple pending agents (parallel)
    if "pending_agents" in state:
        agents.extend(state["pending_agents"])
    
    return agents


def get_agent_status_via_telemetry(role: str, task_id: str = None) -> dict:
    """Check agent completion status via telemetry mailbox first."""
    telem = Telemetry(str(SWARM_DIR), task_id=task_id or "")
    mailbox = telem.get_agent_status(role)
    
    if mailbox.status == TaskStatus.COMPLETE:
        return {"status": "complete", "result": mailbox.result}
    elif mailbox.status == TaskStatus.FAILED:
        return {"status": "failed", "errors": mailbox.result.errors if mailbox.result else []}
    elif mailbox.status == TaskStatus.IN_PROGRESS:
        return {"status": "in_progress", "progress": mailbox.progress}
    else:
        return {"status": "pending"}


def print_agent_instructions(agent: dict, json_mode: bool = False):
    """Print clear instructions for spawning an agent."""
    task_file = Path(agent["task_file"])
    result_file = Path(agent["result_file"])
    role = agent["role"]
    
    task_spec = json.loads(task_file.read_text()) if task_file.exists() else {}
    
    if json_mode:
        # Machine-readable output for automation / sessions_spawn
        output = {
            "action": "spawn_agent",
            "role": role,
            "task_id": agent.get("task_id", ""),
            "task_file": str(task_file),
            "result_file": str(result_file),
            "system_prompt": task_spec.get("system_prompt", "")[:500],
            "task": task_spec.get("task", ""),
            "rules": task_spec.get("rules", []),
            "repo_root": task_spec.get("repo_root", str(HARNESS_DIR.parent.parent.parent)),
            "sessions_spawn_hint": {
                "agent_id": f"pipe-{role}",
                "task": task_spec.get("task", ""),
                "instructions": f"Read task spec from {task_file}, write results to {result_file}",
                "context": {
                    "system_prompt": task_spec.get("system_prompt", "")[:2000],
                    "repo_root": task_spec.get("repo_root", ""),
                }
            }
        }
        print(json.dumps(output, indent=2))
        return
    
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


def print_workflow_summary(state: dict, json_mode: bool = False):
    """Print a human-readable summary of workflow progress."""
    if not state:
        print("No active workflow.")
        return
    
    if json_mode:
        summary = {
            "task": state.get("task", "Unknown"),
            "phase": state.get("phase", "unknown"),
            "status": state.get("status", "unknown"),
            "plan": state.get("plan", {}),
            "outputs": {k: len(v) for k, v in state.get("outputs", {}).items()},
            "approvals": state.get("approvals", {}),
            "qa_results": state.get("qa_results", {}),
            "qa_passed": state.get("qa_passed", False),
        }
        print(json.dumps(summary, indent=2))
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
    if plan.get("needs_pm"): needed.insert(0, "pm")
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
    parser.add_argument("--json", "-j", action="store_true", help="Machine-readable JSON output")
    parser.add_argument("--telemetry", action="store_true", help="Show telemetry events")
    parser.add_argument("--wait", "-w", type=float, default=0, help="Wait for agent completion (seconds)")
    
    args = parser.parse_args()
    
    if args.telemetry:
        telem = Telemetry(str(SWARM_DIR))
        agents = telem.list_active_agents()
        events = telem._read_log()
        
        if args.json:
            print(json.dumps({
                "active_agents": agents,
                "recent_events": events[-20:] if events else []
            }, indent=2))
        else:
            print(f"\n{'='*70}")
            print("  TELEMETRY STATUS")
            print(f"{'='*70}")
            print(f"\n  Active agents: {', '.join(agents) if agents else 'none'}")
            print(f"\n  Recent events (last 20):")
            for event in (events[-20:] if events else []):
                print(f"    [{event.get('timestamp', '?')}] {event.get('event', '?')}")
            print(f"{'='*70}\n")
        return
    
    if args.status:
        state_file = HARNESS_DIR / ".swarm" / "state.json"
        if state_file.exists():
            state = json.loads(state_file.read_text())
            print_workflow_summary(state, json_mode=args.json)
        else:
            if args.json:
                print(json.dumps({"error": "No active workflow"}))
            else:
                print("No active workflow.")
        return
    
    if args.reset:
        result = run_orchestrator(reset=True)
        if args.json:
            print(json.dumps({"reset": True}))
        else:
            print("Workflow reset.")
        return
    
    # Run orchestrator
    result = run_orchestrator(
        task=args.task,
        auto_approve=args.auto_approve,
        resume=args.resume
    )
    
    # Print orchestrator output (unless in pure JSON mode waiting for agents)
    if not args.json:
        if result["stdout"]:
            print(result["stdout"])
        if result["stderr"]:
            print(result["stderr"], file=sys.stderr)
    
    state = result.get("state")
    if not state:
        if not args.json:
            print("\nNo state file found. Workflow may have completed or failed.")
        return
    
    # Check for pending agents
    pending = detect_pending_agents(state)
    
    if pending:
        if args.json:
            # Output machine-readable spawn instructions
            spawn_list = []
            for agent in pending:
                task_file = Path(agent["task_file"])
                task_spec = json.loads(task_file.read_text()) if task_file.exists() else {}
                spawn_list.append({
                    "action": "spawn_agent",
                    "role": agent["role"],
                    "task_id": agent.get("task_id", ""),
                    "task_file": agent["task_file"],
                    "result_file": agent["result_file"],
                    "system_prompt": task_spec.get("system_prompt", "")[:500],
                    "task": task_spec.get("task", ""),
                    "repo_root": task_spec.get("repo_root", str(HARNESS_DIR.parent.parent.parent)),
                    "sessions_spawn_params": {
                        "agent_id": f"pipe-{agent['role']}",
                        "task": task_spec.get("task", ""),
                        "instructions": f"Role: {agent['role']}. Read full task spec from {agent['task_file']}. Write results to {agent['result_file']}.",
                        "context": {
                            "system_prompt": task_spec.get("system_prompt", "")[:2000],
                            "rules": task_spec.get("rules", []),
                            "repo_root": task_spec.get("repo_root", ""),
                        }
                    }
                })
            print(json.dumps({
                "status": "waiting_for_agents",
                "agents_needed": spawn_list,
                "next_command": "python harness_driver.py --resume",
                "state": {
                    "phase": state.get("phase"),
                    "status": state.get("status"),
                    "task": state.get("task")
                }
            }, indent=2))
        else:
            print(f"\n>>> {len(pending)} AGENT(S) NEEDED <<<")
            for agent in pending:
                print_agent_instructions(agent, json_mode=False)
            
            if args.dry_run:
                print("(Dry run mode — agents not actually spawned)")
                return
            
            # Also show telemetry status
            for agent in pending:
                status = get_agent_status_via_telemetry(agent["role"])
                if status["status"] == "in_progress":
                    print(f"  Telemetry: {agent['role']} is IN PROGRESS")
                    for p in status.get("progress", []):
                        print(f"    [{p.percent}%] {p.message}")
            
            print("\nAction required: Spawn the above agent(s), then run:")
            print(f"  python harness_driver.py --resume")
        
        sys.exit(2)  # Special exit code: needs agent spawning
    
    # Check if waiting for user approval
    if state.get("phase") == "final_approval" or state.get("status") == "pending_approval":
        if args.json:
            print(json.dumps({
                "status": "waiting_for_approval",
                "phase": state.get("phase"),
                "approvals": state.get("approvals", {}),
                "outputs": {k: len(v) for k, v in state.get("outputs", {}).items()},
                "next_command": "python harness_driver.py --resume (after manual approval in state.json)"
            }, indent=2))
        else:
            print("\n>>> WAITING FOR USER APPROVAL <<<")
            print("Review the output above and approve/reject/revise.")
            print("If non-interactive, check the state file and run with --auto-approve or --resume")
        sys.exit(3)  # Special exit code: needs user approval
    
    # Workflow complete or failed
    if state.get("status") in ("approved_and_complete", "complete"):
        if args.json:
            print(json.dumps({
                "status": "complete",
                "state": {
                    "phase": state.get("phase"),
                    "status": state.get("status"),
                    "task": state.get("task"),
                    "approvals": state.get("approvals", {}),
                    "qa_passed": state.get("qa_passed", False)
                }
            }, indent=2))
        else:
            print("\n>>> WORKFLOW COMPLETE <<<")
            print_workflow_summary(state)
        sys.exit(0)
    elif state.get("status", "").startswith("rejected"):
        if args.json:
            print(json.dumps({
                "status": "rejected",
                "rejection_point": state.get("status"),
                "approvals": state.get("approvals", {})
            }, indent=2))
        else:
            print(f"\n>>> WORKFLOW REJECTED at {state['status']} <<<")
        sys.exit(1)
    else:
        if args.json:
            print(json.dumps({
                "status": "in_progress",
                "phase": state.get("phase"),
                "status_detail": state.get("status")
            }, indent=2))
        else:
            print(f"\n>>> WORKFLOW IN PROGRESS: {state.get('status')} <<<")
            print_workflow_summary(state)
        sys.exit(0)


if __name__ == "__main__":
    main()
