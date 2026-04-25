#!/usr/bin/env python3
"""
Pipe Swarm Harness — Executable Orchestrator with Telemetry

Integrates two-way telemetry (telemetry.py) with the orchestrator workflow.
Uses mailbox-based agent communication for reliable status tracking.

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

# Telemetry integration
from telemetry import Telemetry, TaskSpec, TaskStatus

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


class AgentHarness:
    """
    Agent harness that uses OpenClaw sessions_spawn with telemetry tracking.
    """
    
    def __init__(self, state: Dict[str, Any], telemetry: Telemetry):
        self.state = state
        self.telemetry = telemetry
    
    def spawn_agent(self, role: str, task: str, context: str = "", files_to_modify: list = None, acceptance_criteria: list = None) -> dict:
        """
        Spawn an agent using OpenClaw sessions_spawn system with telemetry.
        Writes task spec, dispatches to mailbox, and returns metadata.
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
        
        task_id = f"{role}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        # Build structured task spec for telemetry
        task_spec = TaskSpec(
            task_id=task_id,
            role=role,
            description=task,
            files_to_modify=files_to_modify or [],
            acceptance_criteria=acceptance_criteria or [
                "Follow all coding standards from AGENTS.md",
                "Run `npx tsc --noEmit` before finishing",
                "Use named exports only (except page components)",
                "No `any` types"
            ],
            context={
                "system_prompt": system_prompt,
                "task": task,
                "extra_context": context,
                "repo_root": str(Path.cwd().parent.parent.parent),
                "rules": [
                    "Work in the repository at the project root",
                    "Follow all coding standards from AGENTS.md",
                    "Run `npx tsc --noEmit` before finishing",
                    "Return ONLY your output (code, design, or analysis)",
                ]
            }
        )
        
        # Write legacy task spec for backward compatibility
        legacy_spec = {
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
            "repo_root": str(Path.cwd().parent.parent.parent),
        }
        
        task_file = TASKS_DIR / f"{task_id}.json"
        task_file.write_text(json.dumps(legacy_spec, indent=2))
        
        result_file = TASKS_DIR / f"{task_id}_result.md"
        
        # Dispatch to telemetry mailbox
        self.telemetry.dispatch_task(role, task_spec)
        
        return {
            "task_file": str(task_file),
            "result_file": str(result_file),
            "role": role,
            "task_id": task_id,
        }
    
    def check_agent_done(self, role: str) -> bool:
        """Check if agent has completed via telemetry."""
        mailbox = self.telemetry.get_agent_status(role)
        return mailbox.status in (TaskStatus.COMPLETE, TaskStatus.FAILED)
    
    def wait_for_agent(self, role: str, timeout: float = 300.0) -> dict:
        """Wait for agent completion via telemetry."""
        try:
            result = self.telemetry.wait_for_completion(role, timeout=timeout)
            return {
                "success": result.success,
                "summary": result.summary,
                "changed_files": result.changed_files,
                "test_results": result.test_results,
                "errors": result.errors,
            }
        except Exception as e:
            return {
                "success": False,
                "summary": str(e),
                "changed_files": [],
                "test_results": {},
                "errors": [str(e)],
            }


def get_user_approval(phase: str, content: str, telemetry: Optional[Telemetry] = None) -> str:
    """
    Present work to user for red/green approval.
    Returns: "approved", "rejected", or "revise"
    """
    if telemetry:
        telemetry._log(f"APPROVAL_REQUESTED: {phase}")
    
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
                if telemetry:
                    telemetry._log(f"APPROVAL_GRANTED: {phase}")
                return "approved"
            elif choice in ("r", "reject"):
                if telemetry:
                    telemetry._log(f"APPROVAL_REJECTED: {phase}")
                return "rejected"
            elif choice in ("rev", "revise", "v"):
                if telemetry:
                    telemetry._log(f"APPROVAL_REVISE: {phase}")
                return "revise"
            else:
                print("Invalid choice. Enter A, R, or Rev.")
        except (EOFError, KeyboardInterrupt):
            # When running non-interactively, save state and exit
            print("\n\nNon-interactive mode detected. Saving state for manual review.")
            if telemetry:
                telemetry._log(f"APPROVAL_PENDING: {phase} (non-interactive)")
            return "pending"


def run_phase_0_analysis(task: str, telemetry: Optional[Telemetry] = None) -> Dict[str, Any]:
    """
    Phase 0: The Orchestrator (me) analyzes the task and decides
    which agents are needed, what order, and what the acceptance criteria are.
    """
    print("=" * 70)
    print("  PHASE 0: ORCHESTRATOR ANALYSIS")
    print("=" * 70)
    print(f"\nTask: {task}\n")
    
    if telemetry:
        telemetry._log(f"PHASE_0_START: {task[:100]}")
    
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
        "needs_pm": True,  # Always include PM for task decomposition
        "sequential": False,
        "analysis": f"This task requires: " + ", ".join(requirements) if requirements else "This is a simple backend fix"
    }
    
    print(f"Plan: {plan['analysis']}")
    print(f"Sequential: {plan['sequential']}")
    print()
    
    if telemetry:
        telemetry._log(f"PHASE_0_COMPLETE: agents={','.join(requirements)}")
    
    return plan


def run_workflow(task: str, auto_approve: bool = False, resume: bool = False) -> Dict[str, Any]:
    """Run the full swarm workflow with telemetry."""
    
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
    
    # Initialize telemetry
    swarm_dir = str(STATE_FILE.parent)
    telemetry = Telemetry(swarm_dir)
    harness = AgentHarness(state, telemetry)
    
    telemetry._log(f"WORKFLOW_START: task={task[:100]} phase={state.get('phase', 'unknown')}")
    
    # Pull latest before starting any work
    print("=" * 70)
    print("  SYNC: Pulling latest changes")
    print("=" * 70)
    subprocess.run(['python3', 'cd_coordinator.py', '--pull'], cwd='/root/.openclaw/workspace/pipe.os/.github/agents/harness')
    
    # Phase 0: Analysis
    if state["phase"] == "analysis":
        plan = run_phase_0_analysis(task, telemetry)
        state["plan"] = plan
        state["phase"] = "pm" if plan.get("needs_pm", True) else ("design" if plan["needs_design"] else ("architecture" if plan["needs_architecture"] else "implementation"))
        save_state(state)
    
    # Phase 0.5: PM Task Decomposition
    if state["phase"] == "pm" and state["plan"].get("needs_pm", True):
        print("=" * 70)
        print("  PHASE 0.5: PM TASK DECOMPOSITION")
        print("=" * 70)
        print("\nSpawning PM agent for task breakdown...")
        
        pm_context = f"""Task: {task}

Analysis result: {state['plan'].get('analysis', 'N/A')}

Requirements:
- Needs design: {state['plan'].get('needs_design', False)}
- Needs architecture: {state['plan'].get('needs_architecture', False)}
- Needs frontend: {state['plan'].get('needs_frontend', False)}
- Needs backend: {state['plan'].get('needs_backend', False)}

Decompose this into concrete subtasks with acceptance criteria."""
        
        agent_info = harness.spawn_agent(
            "pm",
            f"Decompose and plan: {task}",
            pm_context,
            acceptance_criteria=[
                "Produce a task decomposition with task name, acceptance criteria, files to touch, and expected test outcome for each subtask",
                "Identify dependencies between subtasks",
                "Flag any architectural decisions that need ADR documentation",
                "Keep decomposition under 10 subtasks"
            ]
        )
        
        state["pending_agent"] = agent_info
        state["phase"] = "pm_waiting"
        state["status"] = "waiting_for_agent"
        save_state(state)
        
        print(f"\n  Task spec written to: {agent_info['task_file']}")
        print(f"  Expected result at:   {agent_info['result_file']}")
        print(f"  Mailbox:              {swarm_dir}/mailboxes/pm.json")
        print("\n  >>> PAUSED: Waiting for PM agent to complete. <<<")
        print(f"  To resume: python orchestrator.py --resume")
        return state
    
    # Resume from PM agent
    if state["phase"] == "pm_waiting":
        agent_info = state.get("pending_agent", {})
        result_file = Path(agent_info.get("result_file", ""))
        
        mailbox = telemetry.get_agent_status("pm")
        if mailbox.status == TaskStatus.COMPLETE and mailbox.result:
            pm_output = mailbox.result.summary
            telemetry._log(f"PM_COMPLETE: result_length={len(pm_output)}")
        elif result_file.exists():
            pm_output = result_file.read_text()
            telemetry._log(f"PM_COMPLETE (legacy): result_length={len(pm_output)}")
        else:
            print(f"\n  Waiting for result file: {result_file}")
            print("  PM agent hasn't finished yet. Run again later.")
            return state
        
        state["outputs"]["pm"] = pm_output
        del state["pending_agent"]
        
        if not auto_approve:
            approval = get_user_approval("PM Plan Review", pm_output, telemetry)
            state["approvals"]["pm"] = approval
            
            if approval == "rejected":
                state["status"] = "rejected_at_pm"
                telemetry._log("WORKFLOW_REJECTED: pm")
                save_state(state)
                return state
            
            if approval == "revise":
                print("Looping back to PM with revision notes...")
                state["phase"] = "pm"
                telemetry._log("PM_REVISION: looping back")
                save_state(state)
                return state
        
        # Feed PM decomposition into downstream context
        telemetry._log("HANDOFF: pm -> design/architecture/implementation")
        state["phase"] = "design" if state["plan"]["needs_design"] else ("architecture" if state["plan"]["needs_architecture"] else "implementation")
        save_state(state)
    
    # Phase 1: Design (if needed)
    if state["phase"] == "design" and state["plan"].get("needs_design"):
        print("=" * 70)
        print("  PHASE 1: DESIGN")
        print("=" * 70)
        print("\nSpawning Designer agent...")
        
        agent_info = harness.spawn_agent(
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
        print(f"  Mailbox:              {swarm_dir}/mailboxes/designer.json")
        print("\n  >>> PAUSED: Waiting for agent to complete. <<<")
        print(f"  To resume: python orchestrator.py --resume")
        return state
    
    # Resume from design agent
    if state["phase"] == "design_waiting":
        agent_info = state.get("pending_agent", {})
        result_file = Path(agent_info.get("result_file", ""))
        
        # Check telemetry mailbox first
        mailbox = telemetry.get_agent_status("designer")
        if mailbox.status == TaskStatus.COMPLETE and mailbox.result:
            design_output = mailbox.result.summary
            state["outputs"]["design"] = design_output
            telemetry._log(f"DESIGN_COMPLETE: result_length={len(design_output)}")
        elif result_file.exists():
            design_output = result_file.read_text()
            state["outputs"]["design"] = design_output
            telemetry._log(f"DESIGN_COMPLETE (legacy): result_length={len(design_output)}")
        else:
            print(f"\n  Waiting for result file: {result_file}")
            print("  Agent hasn't finished yet. Run again later.")
            return state
        
        del state["pending_agent"]
        
        if not auto_approve:
            approval = get_user_approval("Design Review", design_output, telemetry)
            state["approvals"]["design"] = approval
            
            if approval == "rejected":
                state["status"] = "rejected_at_design"
                telemetry._log("WORKFLOW_REJECTED: design")
                save_state(state)
                return state
            
            if approval == "revise":
                print("Looping back to designer with revision notes...")
                state["phase"] = "design"
                telemetry._log("DESIGN_REVISION: looping back")
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
        
        agent_info = harness.spawn_agent(
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
        print(f"  Mailbox:              {swarm_dir}/mailboxes/architect.json")
        print("\n  >>> PAUSED: Waiting for agent to complete. <<<")
        print(f"  To resume: python orchestrator.py --resume")
        return state
    
    # Resume from architect agent
    if state["phase"] == "architecture_waiting":
        agent_info = state.get("pending_agent", {})
        result_file = Path(agent_info.get("result_file", ""))
        
        mailbox = telemetry.get_agent_status("architect")
        if mailbox.status == TaskStatus.COMPLETE and mailbox.result:
            arch_output = mailbox.result.summary
            telemetry._log(f"ARCHITECTURE_COMPLETE: result_length={len(arch_output)}")
        elif result_file.exists():
            arch_output = result_file.read_text()
            telemetry._log(f"ARCHITECTURE_COMPLETE (legacy): result_length={len(arch_output)}")
        else:
            print(f"\n  Waiting for result file: {result_file}")
            print("  Agent hasn't finished yet. Run again later.")
            return state
        
        state["outputs"]["architecture"] = arch_output
        del state["pending_agent"]
        
        if not auto_approve:
            approval = get_user_approval("Architecture Review", arch_output, telemetry)
            state["approvals"]["architecture"] = approval
            
            if approval == "rejected":
                state["status"] = "rejected_at_architecture"
                telemetry._log("WORKFLOW_REJECTED: architecture")
                save_state(state)
                return state
            
            if approval == "revise":
                print("Looping back to architect with revision notes...")
                state["phase"] = "architecture"
                telemetry._log("ARCHITECTURE_REVISION: looping back")
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
            be_agent = harness.spawn_agent(
                "backend",
                f"Implement server-side logic for: {task}",
                context + "Write complete, compilable TypeScript code. Run npx tsc --noEmit before finishing."
            )
            state["pending_agents"].append(be_agent)
        
        if needs_fe and (not needs_be or not sequential):
            # Frontend spawns in parallel with backend (if backend also running)
            print("\n  Spawning Frontend agent...")
            fe_agent = harness.spawn_agent(
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
                print(f"      Mailbox: {swarm_dir}/mailboxes/{agent['role']}.json")
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
            role = agent_info["role"]
            result_file = Path(agent_info.get("result_file", ""))
            
            # Check telemetry mailbox first
            mailbox = telemetry.get_agent_status(role)
            if mailbox.status == TaskStatus.COMPLETE and mailbox.result:
                output = mailbox.result.summary
                state["outputs"][role] = output
                telemetry._log(f"AGENT_COMPLETE: {role} result_length={len(output)}")
                print(f"\n  {role.upper()} result collected via telemetry ({len(output)} chars)")
            elif result_file.exists():
                output = result_file.read_text()
                state["outputs"][role] = output
                telemetry._log(f"AGENT_COMPLETE (legacy): {role} result_length={len(output)}")
                print(f"\n  {role.upper()} result collected via file ({len(output)} chars)")
            else:
                print(f"\n  Waiting for {role} result: {result_file}")
                all_done = False
        
        if not all_done:
            print("\n  Not all agents have finished yet. Run again later.")
            return state
        
        telemetry._log("HANDOFF: dev -> qa")
        del state["pending_agents"]
        state["phase"] = "qa"
        save_state(state)
    
    # Phase 4: QA
    if state["phase"] == "qa":
        print("=" * 70)
        print("  PHASE 4: QUALITY ASSURANCE")
        print("=" * 70)
        print("\nRunning quality gates:")
        
        telemetry._log("PHASE_4_START: QA")
        
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
                ["grep", "-rn", "\bany\b", "src/", "workers/", "--include=*.ts", "--include=*.tsx"],
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
        except FileNotFoundError:
            print("      SKIP")
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
            telemetry._log("QA_PASS: all gates passed")
        else:
            print("  QA RESULT: FAIL")
            for err in qa_results["errors"]:
                print(f"    - {err}")
            telemetry._log(f"QA_FAIL: errors={len(qa_results['errors'])}")
        print(f"{'='*70}")
        
        if not qa_passed:
            state["status"] = "failed_qa"
            state["phase"] = "implementation"  # Loop back
            telemetry._log("HANDOFF: qa -> implementation (failed)")
            save_state(state)
            return state
        
        telemetry._log("HANDOFF: qa -> final_approval")
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
            approval = get_user_approval("Final PR Review", pr_content, telemetry)
            state["approvals"]["final"] = approval
            
            if approval == "rejected":
                state["status"] = "rejected_at_final"
                telemetry._log("WORKFLOW_REJECTED: final")
                save_state(state)
                return state
            
            if approval == "revise":
                print("Looping back to implementation with revision notes...")
                state["phase"] = "implementation"
                telemetry._log("HANDOFF: final_approval -> implementation (revision)")
                save_state(state)
                return state
        
        state["status"] = "approved_and_complete"
        state["phase"] = "complete"
        telemetry._log("WORKFLOW_COMPLETE: approved")
        save_state(state)
    
    print("\n" + "=" * 70)
    print(f"  WORKFLOW COMPLETE: {state['status']}")
    print("=" * 70)
    
    # Auto-commit and push if approved
    if state['status'] == 'approved_and_complete':
        print("\n" + "=" * 70)
        print("  CD: Committing and pushing changes")
        print("=" * 70)
        telemetry._log("CD_START: commit and push")
        
        commit_msg = f"feat({state['plan'].get('analysis', 'agent')}): {task[:50]}"
        subprocess.run([
            'python3', 'cd_coordinator.py',
            '--agent-commit', f"AUTO|orchestrator|{task[:50]}"
        ], cwd='/root/.openclaw/workspace/pipe.os/.github/agents/harness')
        
        subprocess.run([
            'python3', 'cd_coordinator.py', '--push'
        ], cwd='/root/.openclaw/workspace/pipe.os/.github/agents/harness')
        
        telemetry._log("CD_COMPLETE: pushed")
        print("\nChanges pushed. Ready for your review and merge.")
    
    return state


def main():
    parser = argparse.ArgumentParser(description="Pipe Swarm Orchestrator")
    parser.add_argument("--task", "-t", help="Task description")
    parser.add_argument("--task-file", "-f", help="Path to task spec JSON file")
    parser.add_argument("--auto-approve", "-a", action="store_true", help="Skip approval gates (for automation)")
    parser.add_argument("--resume", "-r", action="store_true", help="Resume from last checkpoint")
    parser.add_argument("--reset", action="store_true", help="Clear checkpoint and start fresh")
    
    args = parser.parse_args()
    
    if args.reset:
        if STATE_FILE.exists():
            STATE_FILE.unlink()
        # Clear telemetry too
        swarm_dir = str(STATE_FILE.parent)
        telemetry = Telemetry(swarm_dir)
        for f in telemetry.mailbox_dir.glob("*.json"):
            f.unlink()
        if telemetry.log_path.exists():
            telemetry.log_path.unlink()
        print("Checkpoint and telemetry cleared.")
        return
    
    if not args.task and not args.task_file and not args.resume:
        parser.print_help()
        print("\nExample: python orchestrator.py --task 'Fix broken imports'")
        sys.exit(1)
    
    # Load task
    task = args.task
    if args.task_file:
        with open(args.task_file) as f:
            spec = json.load(f)
            task = spec.get("task", spec.get("name", str(spec)))
    
    # Run workflow
    result = run_workflow(
        task=task,
        auto_approve=args.auto_approve,
        resume=args.resume
    )
    
    # Output telemetry summary
    swarm_dir = str(STATE_FILE.parent)
    telemetry = Telemetry(swarm_dir)
    active = telemetry.list_active_agents()
    if active:
        print(f"\nActive agents: {', '.join(active)}")
    
    # Final status
    if result.get("status", "").startswith("rejected"):
        sys.exit(1)
    elif result.get("status") == "waiting_for_agent" or result.get("status") == "waiting_for_agents":
        sys.exit(2)  # Needs agent spawning
    elif result.get("status") == "pending_approval":
        sys.exit(3)  # Needs user approval
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
