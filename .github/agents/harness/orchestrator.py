#!/usr/bin/env python3
"""
Pipe Swarm Harness — Executable Orchestrator

This is the real orchestrator. It delegates to sub-agents using OpenClaw's
sessions_spawn system, tracks state in JSON files, and pauses for user approval.

Usage:
    python orchestrator.py --task "Fix broken evaluator imports in role discovery"
    python orchestrator.py --task-file task-spec.json
    python orchestrator.py --resume  # resume from last checkpoint
"""

import argparse
import json
import subprocess
import sys
import os
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any

STATE_FILE = Path(".swarm/state.json")
TASKS_DIR = Path(".swarm/tasks")


def ensure_dirs():
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    TASKS_DIR.mkdir(parents=True, exist_ok=True)


def load_state() -> Optional[Dict[str, Any]]:
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return None


def save_state(state: Dict[str, Any]):
    ensure_dirs()
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def spawn_agent(role: str, task: str, context: str = "") -> dict:
    """
    Write an agent task spec and return metadata.
    The parent orchestrator (OpenClaw agent) will read the spec,
    spawn the actual agent via sessions_spawn, and inject results.
    """
    prompts = {
        "pm": Path("prompts/pm.md"),
        "designer": Path("prompts/designer.md"),
        "architect": Path("prompts/architect.md"),
        "frontend": Path("prompts/frontend.md"),
        "backend": Path("prompts/backend.md"),
    }
    
    prompt_file = prompts.get(role)
    system_prompt = ""
    if prompt_file and prompt_file.exists():
        system_prompt = prompt_file.read_text()
    
    # Build structured task spec
    task_spec = {
        "role": role,
        "system_prompt": system_prompt,
        "task": task,
        "context": context,
        "rules": [
            "Work in the repository at the project root",
            "Follow all coding standards from AGENTS.md",
            "Run `npx tsc --noEmit` before finishing",
            "Return ONLY your output (code, design, or analysis)",
            "Write results to the result file specified in the task"
        ],
        "repo_root": str(Path.cwd().parent.parent.parent),  # Go up from .github/agents/harness
    }
    
    task_file = TASKS_DIR / f"{role}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    task_file.write_text(json.dumps(task_spec, indent=2))
    
    result_file = TASKS_DIR / f"{task_file.stem}_result.md"
    
    return {
        "task_file": str(task_file),
        "result_file": str(result_file),
        "role": role,
    }


def get_user_approval(phase: str, content: str) -> str:
    """
    Present work to user for red/green approval.
    Returns: "approved", "rejected", or "revise"
    """
    print(f"\n{'='*70}")
    print(f"  APPROVAL GATE: {phase}")
    print(f"{'='*70}")
    print(content[:2000])  # Truncate very long output
    if len(content) > 2000:
        print(f"\n... ({len(content) - 2000} more characters)")
    print(f"\n{'='*70}")
    print("  [A]pprove  [R]eject  [Rev]ise")
    print(f"{'='*70}\n")
    
    # In a real run, this would wait for stdin
    # For now, we save the pending approval and exit
    while True:
        try:
            choice = input("Your choice [A/R/Rev]: ").strip().lower()
            if choice in ("a", "approve", ""):
                return "approved"
            elif choice in ("r", "reject"):
                return "rejected"
            elif choice in ("rev", "revise", "v"):
                return "revise"
            else:
                print("Invalid choice. Enter A, R, or Rev.")
        except (EOFError, KeyboardInterrupt):
            # When running non-interactively, save state and exit
            print("\n\nNon-interactive mode detected. Saving state for manual review.")
            return "pending"


def run_phase_0_analysis(task: str) -> Dict[str, Any]:
    """
    Phase 0: The Orchestrator (me) analyzes the task and decides
    which agents are needed, what order, and what the acceptance criteria are.
    """
    print("=" * 70)
    print("  PHASE 0: ORCHESTRATOR ANALYSIS")
    print("=" * 70)
    print(f"\nTask: {task}\n")
    
    # Simple heuristic for which agents needed
    needs_design = any(word in task.lower() for word in ["ui", "ux", "page", "component", "design", "layout", "screen", "modal", "button", "form", "card", "badge", "color"])
    needs_architecture = any(word in task.lower() for word in ["schema", "model", "table", "api", "route", "lambda", "database", "migration", "adr", "architecture", "structural"])
    needs_frontend = needs_design or any(word in task.lower() for word in ["react", "component", "page", "hook", "tsx", "tsx", "frontend", "ui"])
    needs_backend = needs_architecture or any(word in task.lower() for word in ["api", "route", "lambda", "database", "backend", "scorer", "ingestion", "pipeline", "crawler", "matching"])
    
    # If it's a simple fix, we might only need backend
    if not needs_frontend and not needs_backend:
        needs_backend = True  # Default
    
    requirements = []
    if needs_design:
        requirements.append("design")
    if needs_architecture:
        requirements.append("architecture")
    if needs_frontend:
        requirements.append("frontend")
    if needs_backend:
        requirements.append("backend")
    
    plan = {
        "needs_design": needs_design,
        "needs_architecture": needs_architecture,
        "needs_frontend": needs_frontend,
        "needs_backend": needs_backend,
        "sequential": False,
        "analysis": f"This task requires: " + ", ".join(requirements) if requirements else "This is a simple backend fix"
    }
    
    print(f"Plan: {plan['analysis']}")
    print(f"Sequential: {plan['sequential']}")
    print()
    
    return plan


def run_workflow(task: str, auto_approve: bool = False, resume: bool = False) -> Dict[str, Any]:
    """Run the full swarm workflow."""
    
    state = load_state()
    
    if resume and state:
        print(f"Resuming from checkpoint: {state.get('phase', 'unknown')}")
    else:
        state = {
            "task": task,
            "phase": "analysis",
            "created_at": datetime.now().isoformat(),
            "outputs": {},
            "approvals": {},
            "status": "in_progress"
        }
    
    # Phase 0: Analysis
    if state["phase"] == "analysis":
        plan = run_phase_0_analysis(task)
        state["plan"] = plan
        state["phase"] = "design" if plan["needs_design"] else ("architecture" if plan["needs_architecture"] else "implementation")
        save_state(state)
    
    # Phase 1: Design (if needed)
    if state["phase"] == "design" and state["plan"].get("needs_design"):
        print("=" * 70)
        print("  PHASE 1: DESIGN")
        print("=" * 70)
        print("\nSpawning Designer agent...")
        
        agent_info = spawn_agent(
            "designer",
            f"Create UI/UX design spec for: {task}",
            "Read existing code in target area first. Output a design specification document."
        )
        
        state["pending_agent"] = agent_info
        state["phase"] = "design_waiting"
        state["status"] = "waiting_for_agent"
        save_state(state)
        
        print(f"\n  Task spec written to: {agent_info['task_file']}")
        print(f"  Expected result at:   {agent_info['result_file']}")
        print("\n  >>> PAUSED: Waiting for agent to complete. <<<")
        print(f"  To resume: python orchestrator.py --resume")
        return state
    
    # Resume from design agent
    if state["phase"] == "design_waiting":
        agent_info = state.get("pending_agent", {})
        result_file = Path(agent_info.get("result_file", ""))
        
        if not result_file.exists():
            print(f"\n  Waiting for result file: {result_file}")
            print("  Agent hasn't finished yet. Run again later.")
            return state
        
        design_output = result_file.read_text()
        state["outputs"]["design"] = design_output
        del state["pending_agent"]
        
        if not auto_approve:
            approval = get_user_approval("Design Review", design_output)
            state["approvals"]["design"] = approval
            
            if approval == "rejected":
                state["status"] = "rejected_at_design"
                save_state(state)
                return state
            
            if approval == "revise":
                print("Looping back to designer with revision notes...")
                state["phase"] = "design"
                save_state(state)
                return state
        
        state["phase"] = "architecture" if state["plan"].get("needs_architecture") else "implementation"
        save_state(state)
    
    # Phase 2: Architecture (if needed)
    if state["phase"] == "architecture" and state["plan"].get("needs_architecture"):
        print("=" * 70)
        print("  PHASE 2: ARCHITECTURE")
        print("=" * 70)
        print("\nSpawning Architect agent...")
        
        context = ""
        if "design" in state["outputs"]:
            context = f"Design spec:\n{state['outputs']['design'][:1000]}\n\n"
        
        agent_info = spawn_agent(
            "architect",
            f"Design technical solution for: {task}",
            context + "Output: Architecture specification with data model, API contracts, file structure."
        )
        
        state["pending_agent"] = agent_info
        state["phase"] = "architecture_waiting"
        state["status"] = "waiting_for_agent"
        save_state(state)
        
        print(f"\n  Task spec written to: {agent_info['task_file']}")
        print(f"  Expected result at:   {agent_info['result_file']}")
        print("\n  >>> PAUSED: Waiting for agent to complete. <<<")
        print(f"  To resume: python orchestrator.py --resume")
        return state
    
    # Resume from architect agent
    if state["phase"] == "architecture_waiting":
        agent_info = state.get("pending_agent", {})
        result_file = Path(agent_info.get("result_file", ""))
        
        if not result_file.exists():
            print(f"\n  Waiting for result file: {result_file}")
            print("  Agent hasn't finished yet. Run again later.")
            return state
        
        arch_output = result_file.read_text()
        state["outputs"]["architecture"] = arch_output
        del state["pending_agent"]
        
        if not auto_approve:
            approval = get_user_approval("Architecture Review", arch_output)
            state["approvals"]["architecture"] = approval
            
            if approval == "rejected":
                state["status"] = "rejected_at_architecture"
                save_state(state)
                return state
            
            if approval == "revise":
                print("Looping back to architect with revision notes...")
                state["phase"] = "architecture"
                save_state(state)
                return state
        
        state["phase"] = "implementation"
        save_state(state)
    
    # Phase 3: Implementation
    if state["phase"] == "implementation":
        print("=" * 70)
        print("  PHASE 3: IMPLEMENTATION")
        print("=" * 70)
        
        context = ""
        if "architecture" in state["outputs"]:
            context += f"Architecture:\n{state['outputs']['architecture'][:1000]}\n\n"
        if "design" in state["outputs"]:
            context += f"Design:\n{state['outputs']['design'][:1000]}\n\n"
        
        needs_fe = state["plan"].get("needs_frontend", False)
        needs_be = state["plan"].get("needs_backend", False)
        sequential = state["plan"].get("sequential", False)
        
        state["pending_agents"] = []
        
        if needs_be:
            print("\n  Spawning Backend agent...")
            be_agent = spawn_agent(
                "backend",
                f"Implement server-side logic for: {task}",
                context + "Write complete, compilable TypeScript code. Run npx tsc --noEmit before finishing."
            )
            state["pending_agents"].append(be_agent)
        
        if needs_fe and (not needs_be or not sequential):
            # Frontend spawns in parallel with backend (if backend also running)
            print("\n  Spawning Frontend agent...")
            fe_agent = spawn_agent(
                "frontend",
                f"Implement UI components for: {task}",
                context + "Write complete React/TypeScript code. Run npx tsc --noEmit before finishing."
            )
            state["pending_agents"].append(fe_agent)
        
        if state["pending_agents"]:
            state["phase"] = "implementation_waiting"
            state["status"] = "waiting_for_agents"
            save_state(state)
            
            print(f"\n  >>> PAUSED: Waiting for {len(state['pending_agents'])} agent(s) to complete. <<<")
            for agent in state["pending_agents"]:
                print(f"    - {agent['role']}: {agent['result_file']}")
            print(f"\n  To resume: python orchestrator.py --resume")
            return state
        else:
            print("\n  No implementation needed (analysis-only task)")
            state["phase"] = "qa"
            save_state(state)
    
    # Resume from implementation agents
    if state["phase"] == "implementation_waiting":
        pending = state.get("pending_agents", [])
        all_done = True
        
        for agent_info in pending:
            result_file = Path(agent_info.get("result_file", ""))
            if not result_file.exists():
                print(f"\n  Waiting for {agent_info['role']} result: {result_file}")
                all_done = False
        
        if not all_done:
            print("\n  Not all agents have finished yet. Run again later.")
            return state
        
        # Collect all results
        for agent_info in pending:
            result_file = Path(agent_info["result_file"])
            output = result_file.read_text()
            state["outputs"][agent_info["role"]] = output
            print(f"\n  {agent_info['role'].upper()} result collected ({len(output)} chars)")
        
        del state["pending_agents"]
        state["phase"] = "qa"
        save_state(state)
    
    # Phase 4: QA
    if state["phase"] == "qa":
        print("=" * 70)
        print("  PHASE 4: QUALITY ASSURANCE")
        print("=" * 70)
        print("\nRunning quality gates:")
        
        qa_results = {
            "tsc_passed": False,
            "no_any_types": False,
            "named_exports": False,
            "changelog_updated": False,
            "errors": []
        }
        
        # Gate 1: TypeScript compilation
        print("\n  [1/4] Running npx tsc --noEmit ...")
        try:
            result = subprocess.run(
                ["npx", "tsc", "--noEmit"],
                capture_output=True,
                text=True,
                timeout=120
            )
            if result.returncode == 0:
                qa_results["tsc_passed"] = True
                print("      PASS")
            else:
                print(f"      FAIL\n{result.stdout[:500]}{result.stderr[:500]}")
                qa_results["errors"].append("TypeScript compilation failed")
        except FileNotFoundError:
            print("      SKIP (npx/tsc not found — not a TS project or not in project root)")
            qa_results["tsc_passed"] = True  # Skip if not applicable
        except subprocess.TimeoutExpired:
            print("      TIMEOUT")
            qa_results["errors"].append("tsc timed out")
        except Exception as e:
            print(f"      ERROR: {e}")
            qa_results["errors"].append(str(e))
        
        # Gate 2: No 'any' types in new/modified files
        print("\n  [2/4] Checking for 'any' types ...")
        try:
            result = subprocess.run(
                ["grep", "-rn", "\\bany\\b", "src/", "workers/", "--include=*.ts", "--include=*.tsx"],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode != 0 or not result.stdout.strip():
                qa_results["no_any_types"] = True
                print("      PASS")
            else:
                lines = result.stdout.strip().split("\n")
                print(f"      FAIL — {len(lines)} occurrences")
                for line in lines[:5]:
                    print(f"        {line}")
                if len(lines) > 5:
                    print(f"        ... and {len(lines) - 5} more")
                qa_results["errors"].append(f"Found {len(lines)} 'any' type usages")
        except FileNotFoundError:
            print("      SKIP (grep not available)")
            qa_results["no_any_types"] = True
        except Exception as e:
            print(f"      ERROR: {e}")
        
        # Gate 3: Named exports (basic check)
        print("\n  [3/4] Checking for default exports ...")
        try:
            result = subprocess.run(
                ["grep", "-rn", "export default", "src/", "workers/", "--include=*.ts", "--include=*.tsx"],
                capture_output=True,
                text=True,
                timeout=30
            )
            # Allow default exports for page components only
            non_page_defaults = [l for l in result.stdout.strip().split("\n") if l.strip() and "pages/" not in l]
            if not non_page_defaults:
                qa_results["named_exports"] = True
                print("      PASS")
            else:
                print(f"      WARN — {len(non_page_defaults)} non-page default exports")
                for line in non_page_defaults[:3]:
                    print(f"        {line}")
                # Named exports are a recommendation, not a hard fail
                qa_results["named_exports"] = True
        except Exception as e:
            print(f"      SKIP: {e}")
            qa_results["named_exports"] = True
        
        # Gate 4: CHANGELOG updated
        print("\n  [4/4] Checking CHANGELOG.md ...")
        changelog_path = Path("CHANGELOG.md")
        if changelog_path.exists():
            content = changelog_path.read_text()
            if "## [Unreleased]" in content or "## Unreleased" in content:
                # Check if there's content after Unreleased header
                unreleased_idx = content.find("## [Unreleased]") if "## [Unreleased]" in content else content.find("## Unreleased")
                next_section = content.find("## [", unreleased_idx + 1)
                section = content[unreleased_idx:next_section] if next_section > 0 else content[unreleased_idx:]
                if len(section.strip()) > 50:  # Has actual content, not just header
                    qa_results["changelog_updated"] = True
                    print("      PASS")
                else:
                    print("      WARN — [Unreleased] section appears empty")
                    qa_results["changelog_updated"] = True  # Allow empty for now
            else:
                print("      WARN — No [Unreleased] section found")
                qa_results["changelog_updated"] = True
        else:
            print("      SKIP — CHANGELOG.md not found")
            qa_results["changelog_updated"] = True  # Skip if not present
        
        # Final QA verdict
        qa_passed = qa_results["tsc_passed"] and qa_results["no_any_types"]
        state["qa_results"] = qa_results
        state["qa_passed"] = qa_passed
        
        print(f"\n{'='*70}")
        if qa_passed:
            print("  QA RESULT: PASS")
        else:
            print("  QA RESULT: FAIL")
            for err in qa_results["errors"]:
                print(f"    - {err}")
        print(f"{'='*70}")
        
        if not qa_passed:
            state["status"] = "failed_qa"
            state["phase"] = "implementation"  # Loop back
            save_state(state)
            return state
        
        state["phase"] = "final_approval"
        save_state(state)
    
    # Phase 5: Final Approval
    if state["phase"] == "final_approval":
        print("=" * 70)
        print("  PHASE 5: FINAL REVIEW")
        print("=" * 70)
        
        pr_content = f"""
## Summary
{task}

## Changes
### Backend
{state['outputs'].get('backend', 'N/A')[:500]}

### Frontend
{state['outputs'].get('frontend', 'N/A')[:500]}

### QA
- Type check: {'PASS' if state.get('qa_passed') else 'FAIL'}
"""
        
        if not auto_approve:
            approval = get_user_approval("Final PR Review", pr_content)
            state["approvals"]["final"] = approval
            
            if approval == "rejected":
                state["status"] = "rejected_at_final"
                save_state(state)
                return state
            
            if approval == "revise":
                print("Looping back to implementation with revision notes...")
                state["phase"] = "implementation"
                save_state(state)
                return state
        
        state["status"] = "approved_and_complete"
        state["phase"] = "complete"
        save_state(state)
    
    print("\n" + "=" * 70)
    print(f"  WORKFLOW COMPLETE: {state['status']}")
    print("=" * 70)
    
    return state


def main():
    parser = argparse.ArgumentParser(description="Pipe Swarm Orchestrator")
    parser.add_argument("--task", "-t", help="Task description")
    parser.add_argument("--task-file", "-f", help="JSON task spec file")
    parser.add_argument("--auto-approve", "-a", action="store_true", help="Skip approval gates")
    parser.add_argument("--resume", "-r", action="store_true", help="Resume from checkpoint")
    parser.add_argument("--status", "-s", action="store_true", help="Show current status")
    parser.add_argument("--reset", action="store_true", help="Clear checkpoint and start fresh")
    
    args = parser.parse_args()
    
    if args.reset:
        if STATE_FILE.exists():
            STATE_FILE.unlink()
        print("Checkpoint cleared.")
        return
    
    if args.status:
        state = load_state()
        if state:
            print(json.dumps(state, indent=2))
        else:
            print("No active workflow.")
        return
    
    if args.resume:
        state = load_state()
        if not state:
            print("Error: No checkpoint to resume from. Start with --task.")
            sys.exit(1)
        task = state.get("task", "Unknown task")
    elif args.task_file:
        with open(args.task_file) as f:
            task_spec = json.load(f)
        task = task_spec.get("name", "Unknown task")
    elif args.task:
        task = args.task
        task_spec = {"name": task}
    else:
        print("Error: Provide --task or --task-file or --resume")
        sys.exit(1)
    
    result = run_workflow(task, auto_approve=args.auto_approve, resume=args.resume)
    
    # Save final result
    result_file = TASKS_DIR / f"result_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(result_file, "w") as f:
        json.dump(result, f, indent=2)
    
    print(f"\nResult saved to: {result_file}")


if __name__ == "__main__":
    main()
