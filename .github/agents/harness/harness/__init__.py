#!/usr/bin/env python3
"""
Agent Harness Skill — Entry Point

Usage:
    from harness import run
    result = run(task="Fix imports", repo_path="~/Code/PIPE/PIPE-OS")
"""

import sys
from pathlib import Path

# Add harness directory to path
sys.path.insert(0, str(Path(__file__).parent))

from orchestrator import Orchestrator
from telemetry import Telemetry


def run(task: str, repo_path: str = ".", auto_approve: bool = False, phase: str = "all") -> dict:
    """
    Run the harness on a task.
    
    Args:
        task: Task description
        repo_path: Path to git repository
        auto_approve: Skip approval gates
        phase: Run specific phase only (design, architecture, implementation, qa)
    
    Returns:
        dict with workflow_status, approvals, qa_results, telemetry_summary, changed_files
    """
    repo = Path(repo_path).expanduser().resolve()
    
    # Initialize telemetry
    swarm_dir = repo / ".swarm"
    telemetry = Telemetry(str(swarm_dir))
    
    # Create orchestrator
    orchestrator = Orchestrator(
        repo_path=str(repo),
        auto_approve=auto_approve,
        telemetry=telemetry
    )
    
    # Run workflow
    result = orchestrator.run_workflow(task, phase=phase)
    
    return {
        "workflow_status": result.get("status", "unknown"),
        "approvals": len(result.get("approvals", {})),
        "qa_results": result.get("qa_results", {}),
        "telemetry_summary": telemetry.get_summary(),
        "changed_files": result.get("changed_files", []),
    }


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Agent Harness")
    parser.add_argument("--task", "-t", required=True)
    parser.add_argument("--repo", "-r", default=".")
    parser.add_argument("--auto-approve", "-a", action="store_true")
    parser.add_argument("--phase", "-p", default="all")
    
    args = parser.parse_args()
    
    result = run(args.task, args.repo, args.auto_approve, args.phase)
    print(json.dumps(result, indent=2))
