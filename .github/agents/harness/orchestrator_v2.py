#!/usr/bin/env python3
"""
Pipe Swarm Orchestrator v2

Workflow with user approval gates:

    User Request
        ↓
    [Orchestrator analyzes]
        ↓
    ┌─────────────────────┐
    │  Designer needed?   │──Yes──→ Designer Agent
    └─────────────────────┘              ↓
    [Orchestrator presents design] ←───┘
        ↓
    User: Approve / Reject / Revise
        ↓ (Approved)
    ┌─────────────────────┐
    │ Architect needed?   │──Yes──→ Architect Agent
    └─────────────────────┘              ↓
    [Orchestrator presents architecture] ←┘
        ↓
    User: Approve / Reject / Revise
        ↓ (Approved)
    ┌─────────────────────────────────────┐
    │  Spawn Frontend + Backend in        │
    │  parallel (if no dependencies)    │
    │  or sequential (if order matters)   │
    └─────────────────────────────────────┘
        ↓
    [Orchestrator reviews outputs]
        ↓
    QA / Type Check / Standards
        ↓
    User: Final approval → Commit & Push

Usage:
    python orchestrator_v2.py --task "Add a candidate search filter by skill"
"""

import argparse
import json
from pathlib import Path
from typing import Optional

def load_task_spec(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def present_for_approval(phase: str, content: str) -> str:
    """
    Present work to user for red/green approval.
    Returns: "approved", "rejected", or "revise"
    """
    print(f"\n{'='*60}")
    print(f"  APPROVAL GATE: {phase}")
    print(f"{'='*60}")
    print(content)
    print(f"\n{'='*60}")
    print("  [A]pprove  [R]eject  [Rev]ise")
    print(f"{'='*60}\n")
    
    # In practice, this would wait for user input
    # For automation testing, return approved
    return "approved"


def run_approval_workflow(task_spec: dict, auto_approve: bool = False) -> dict:
    """
    Run the full approval-gated workflow.
    
    Returns final result with all agent outputs and approval history.
    """
    results = {
        "task": task_spec,
        "approvals": {},
        "outputs": {}
    }
    
    # Phase 1: Design (if needed)
    if task_spec.get("requires_design", True):
        print("[Phase 1] Spawning Designer...")
        # Designer agent produces design spec
        # In real implementation, this calls sessions_spawn with designer prompt
        design_output = f"Design spec for: {task_spec['name']}"
        results["outputs"]["design"] = design_output
        
        if not auto_approve:
            approval = present_for_approval("Design Review", design_output)
            results["approvals"]["design"] = approval
            if approval == "rejected":
                return {**results, "status": "rejected_at_design"}
            if approval == "revise":
                # Loop back to designer with feedback
                pass
    
    # Phase 2: Architecture (if needed)
    if task_spec.get("requires_architecture", True):
        print("[Phase 2] Spawning Architect...")
        # Architect agent produces technical design
        arch_output = f"Architecture spec for: {task_spec['name']}"
        results["outputs"]["architecture"] = arch_output
        
        if not auto_approve:
            approval = present_for_approval("Architecture Review", arch_output)
            results["approvals"]["architecture"] = approval
            if approval == "rejected":
                return {**results, "status": "rejected_at_architecture"}
    
    # Phase 3: Implementation
    print("[Phase 3] Spawning Frontend + Backend...")
    
    # Parallel execution if no dependencies
    if task_spec.get("sequential", False):
        # Backend first, then Frontend
        print("  [Backend] Implementing...")
        be_output = f"Backend code for: {task_spec['name']}"
        results["outputs"]["backend"] = be_output
        
        print("  [Frontend] Implementing...")
        fe_output = f"Frontend code for: {task_spec['name']}"
        results["outputs"]["frontend"] = fe_output
    else:
        # Parallel
        print("  [Backend + Frontend] Parallel implementation...")
        be_output = f"Backend code for: {task_spec['name']}"
        fe_output = f"Frontend code for: {task_spec['name']}"
        results["outputs"]["backend"] = be_output
        results["outputs"]["frontend"] = fe_output
    
    # Phase 4: QA / Type Check
    print("[Phase 4] Running QA gates...")
    # npx tsc --noEmit
    # Run tests
    qa_passed = True  # Would actually run checks
    results["qa_passed"] = qa_passed
    
    # Phase 5: Final approval
    if not auto_approve:
        approval = present_for_approval(
            "Final Review (PR)",
            f"Backend:\n{be_output}\n\nFrontend:\n{fe_output}"
        )
        results["approvals"]["final"] = approval
        if approval == "rejected":
            return {**results, "status": "rejected_at_final"}
    
    return {**results, "status": "approved_and_complete"}


def main():
    parser = argparse.ArgumentParser(description="Pipe Swarm Orchestrator v2")
    parser.add_argument("--task", required=True, help="Task description or JSON spec file")
    parser.add_argument("--auto-approve", action="store_true", help="Skip approval gates (for testing)")
    args = parser.parse_args()
    
    # Load task
    if Path(args.task).exists():
        task_spec = load_task_spec(args.task)
    else:
        task_spec = {
            "name": args.task,
            "requires_design": True,
            "requires_architecture": True,
            "sequential": False
        }
    
    # Run workflow
    result = run_approval_workflow(task_spec, auto_approve=args.auto_approve)
    
    # Output
    print("\n" + "="*60)
    print(f"  WORKFLOW COMPLETE: {result['status']}")
    print("="*60)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
