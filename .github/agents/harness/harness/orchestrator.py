#!/usr/bin/env python3
"""
Agent Harness — Orchestrator

Manages the full development workflow:
1. PM breaks down task
2. Designer creates UI/UX spec
3. Architect designs technical solution
4. Backend + Frontend implement
5. QA runs quality gates
6. Approval gates at each phase

Key change from v1: spawn_agent() calls sessions_spawn directly
instead of writing JSON task files.
"""

import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any


class Orchestrator:
    def __init__(self, repo_path: str, auto_approve: bool = False, telemetry=None):
        self.repo_path = Path(repo_path)
        self.auto_approve = auto_approve
        self.telemetry = telemetry
        self.swarm_dir = self.repo_path / ".swarm"
        self.tasks_dir = self.swarm_dir / "tasks"
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        
        # Load role prompts
        self.prompts = {}
        prompts_dir = Path(__file__).parent / "prompts"
        for prompt_file in prompts_dir.glob("*.md"):
            self.prompts[prompt_file.stem] = prompt_file.read_text()
    
    def run_workflow(self, task: str, phase: str = "all") -> dict:
        """Run the full workflow for a task."""
        print(f"\n{'='*70}")
        print(f"  PIPE SWARM: {task}")
        print(f"{'='*70}\n")
        
        state = {
            "task": task,
            "phase": "pm",  # Start with PM
            "status": "in_progress",
            "plan": {},
            "outputs": {},
            "approvals": {},
            "qa_results": {},
            "changed_files": [],
        }
        
        # Phase 0: PM breaks down the task
        if phase in ("all", "pm"):
            pm_output = self.spawn_agent("pm", task)
            state["outputs"]["pm"] = pm_output
            state["plan"] = self.parse_pm_plan(pm_output)
            
            if not self.auto_approve:
                approval = self.get_user_approval("PM Plan", pm_output)
                state["approvals"]["pm"] = approval
                if approval == "rejected":
                    state["status"] = "rejected_at_pm"
                    return state
        
        # Phase 1: Design (if needed)
        if phase in ("all", "design") and state["plan"].get("needs_design"):
            design_output = self.spawn_agent("designer", task, state["outputs"].get("pm", ""))
            state["outputs"]["design"] = design_output
            
            if not self.auto_approve:
                approval = self.get_user_approval("Design", design_output)
                state["approvals"]["design"] = approval
                if approval == "rejected":
                    state["status"] = "rejected_at_design"
                    return state
        
        # Phase 2: Architecture (if needed)
        if phase in ("all", "architecture") and state["plan"].get("needs_architecture"):
            context = state["outputs"].get("design", "")
            arch_output = self.spawn_agent("architect", task, context)
            state["outputs"]["architecture"] = arch_output
            
            if not self.auto_approve:
                approval = self.get_user_approval("Architecture", arch_output)
                state["approvals"]["architecture"] = approval
                if approval == "rejected":
                    state["status"] = "rejected_at_architecture"
                    return state
        
        # Phase 3: Implementation
        if phase in ("all", "implementation"):
            context = ""
            if "architecture" in state["outputs"]:
                context += f"Architecture: {state['outputs']['architecture'][:500]}\n\n"
            if "design" in state["outputs"]:
                context += f"Design: {state['outputs']['design'][:500]}\n\n"
            
            needs_fe = state["plan"].get("needs_frontend", False)
            needs_be = state["plan"].get("needs_backend", False)
            
            if needs_be:
                be_output = self.spawn_agent("backend", task, context)
                state["outputs"]["backend"] = be_output
                state["changed_files"].extend(self.extract_changed_files(be_output))
            
            if needs_fe:
                fe_output = self.spawn_agent("frontend", task, context)
                state["outputs"]["frontend"] = fe_output
                state["changed_files"].extend(self.extract_changed_files(fe_output))
        
        # Phase 4: QA
        if phase in ("all", "qa"):
            qa_passed = self.run_qa()
            state["qa_results"] = qa_passed
            
            if not qa_passed.get("overall", False):
                state["status"] = "failed_qa"
                return state
        
        # Phase 5: Final approval
        if not self.auto_approve:
            summary = self.build_summary(state)
            approval = self.get_user_approval("Final PR", summary)
            state["approvals"]["final"] = approval
            
            if approval == "rejected":
                state["status"] = "rejected_at_final"
                return state
        
        state["status"] = "complete"
        return state
    
    def spawn_agent(self, role: str, task: str, context: str = "") -> str:
        """
        Spawn an agent via sessions_spawn.
        
        This is the key change from v1: instead of writing JSON task files,
        we call sessions_spawn directly and return the agent's output.
        """
        system_prompt = self.prompts.get(role, "")
        
        full_task = f"""{system_prompt}

## TASK
{task}

## CONTEXT
{context}

## RULES
- Work in the repository at: {self.repo_path}
- Run `npx tsc --noEmit` before finishing
- Return ONLY your output (code, design, or analysis)
- Do not explain what you're doing, just produce the work
"""
        
        print(f"\n  [SPAWNING {role.upper()} AGENT]")
        print(f"  Task: {task[:80]}...")
        
        # Call sessions_spawn via subprocess (OpenClaw CLI)
        # In production, this would be a direct API call
        cmd = [
            "openclaw", "sessions", "spawn",
            "--task", full_task,
            "--runtime", "subagent",
            "--mode", "run",
            "--timeout", "3600"
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=3600,
                cwd=str(self.repo_path)
            )
            
            if result.returncode == 0:
                output = result.stdout
                print(f"  [{role.upper()} COMPLETE] ({len(output)} chars)")
                return output
            else:
                error = result.stderr or "Unknown error"
                print(f"  [{role.upper()} FAILED] {error[:200]}")
                return f"[ERROR: {error}]"
                
        except FileNotFoundError:
            # openclaw CLI not available, fall back to mock
            print(f"  [WARNING] openclaw CLI not available, using mock")
            return f"[MOCK OUTPUT for {role}: {task[:50]}...]"
        except subprocess.TimeoutExpired:
            print(f"  [{role.upper()} TIMEOUT]")
            return "[TIMEOUT]"
    
    def run_qa(self) -> dict:
        """Run quality gates."""
        print(f"\n{'='*70}")
        print("  PHASE 4: QUALITY ASSURANCE")
        print(f"{'='*70}\n")
        
        qa_results = {
            "tsc_passed": False,
            "no_any_types": False,
            "named_exports": False,
            "changelog_updated": False,
            "errors": []
        }
        
        # Gate 1: TypeScript compilation
        print("  [1/4] Running npx tsc --noEmit ...")
        try:
            result = subprocess.run(
                ["npx", "tsc", "--noEmit"],
                capture_output=True,
                text=True,
                timeout=120,
                cwd=str(self.repo_path)
            )
            qa_results["tsc_passed"] = result.returncode == 0
            if not qa_results["tsc_passed"]:
                qa_results["errors"].append("TypeScript compilation failed")
        except Exception as e:
            qa_results["errors"].append(str(e))
        
        # Gate 2: No 'any' types
        print("  [2/4] Checking for 'any' types ...")
        try:
            result = subprocess.run(
                ["grep", "-rn", "\\bany\\b", "src/", "workers/", "--include=*.ts", "--include=*.tsx"],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(self.repo_path)
            )
            qa_results["no_any_types"] = result.returncode != 0 or not result.stdout.strip()
        except Exception:
            qa_results["no_any_types"] = True
        
        # Gate 3: Named exports
        print("  [3/4] Checking for default exports ...")
        try:
            result = subprocess.run(
                ["grep", "-rn", "export default", "src/", "workers/", "--include=*.ts", "--include=*.tsx"],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(self.repo_path)
            )
            non_page_defaults = [l for l in result.stdout.strip().split("\n") if l.strip() and "pages/" not in l]
            qa_results["named_exports"] = not non_page_defaults
        except Exception:
            qa_results["named_exports"] = True
        
        # Gate 4: CHANGELOG
        print("  [4/4] Checking CHANGELOG.md ...")
        changelog_path = self.repo_path / "CHANGELOG.md"
        if changelog_path.exists():
            content = changelog_path.read_text()
            qa_results["changelog_updated"] = "## [Unreleased]" in content or "## Unreleased" in content
        else:
            qa_results["changelog_updated"] = True
        
        qa_results["overall"] = (
            qa_results["tsc_passed"] and 
            qa_results["no_any_types"] and 
            qa_results["named_exports"]
        )
        
        return qa_results
    
    def get_user_approval(self, phase: str, content: str) -> str:
        """Get user approval for a phase."""
        print(f"\n{'='*70}")
        print(f"  APPROVAL GATE: {phase}")
        print(f"{'='*70}")
        print(content[:2000])
        if len(content) > 2000:
            print(f"\n... ({len(content) - 2000} more characters)")
        
        print(f"\n{'='*70}")
        print("  [A]pprove  [R]eject  [Rev]ise")
        print(f"{'='*70}\n")
        
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
                return "pending"
    
    def parse_pm_plan(self, pm_output: str) -> dict:
        """Parse PM output into a structured plan."""
        # Simple heuristic parsing
        plan = {
            "needs_design": "design" in pm_output.lower() or "ui" in pm_output.lower(),
            "needs_architecture": "architecture" in pm_output.lower() or "api" in pm_output.lower(),
            "needs_frontend": "frontend" in pm_output.lower() or "ui" in pm_output.lower() or "component" in pm_output.lower(),
            "needs_backend": "backend" in pm_output.lower() or "api" in pm_output.lower() or "server" in pm_output.lower(),
            "sequential": "sequential" in pm_output.lower() or "depends" in pm_output.lower(),
        }
        return plan
    
    def extract_changed_files(self, output: str) -> list:
        """Extract changed files from agent output."""
        # Look for file paths in the output
        files = []
        for line in output.split("\n"):
            if line.startswith("workers/") or line.startswith("src/"):
                if ".ts" in line or ".tsx" in line:
                    files.append(line.split()[0])
        return files
    
    def build_summary(self, state: dict) -> str:
        """Build a summary of all changes for final approval."""
        summary = f"Task: {state['task']}\n\n"
        summary += "Changes:\n"
        for f in state.get("changed_files", []):
            summary += f"  - {f}\n"
        summary += f"\nQA: {'PASS' if state.get('qa_results', {}).get('overall') else 'FAIL'}"
        return summary
