#!/usr/bin/env python3
"""Workflow orchestrator with queue-based state management."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agent_harness.messaging import AgentMessage, SQLiteMessageQueue, get_message_queue
from agent_harness.telemetry_queue import EventBus, HarnessEvent, WorkflowQueue


@dataclass
class WorkflowState:
    """Mutable workflow state."""

    workflow_id: str
    task: str
    repo_path: str
    status: str = "created"
    current_phase: str | None = None
    plan: dict[str, Any] = field(default_factory=dict)
    outputs: dict[str, Any] = field(default_factory=dict)
    approvals: dict[str, str] = field(default_factory=dict)
    qa_results: dict[str, Any] = field(default_factory=dict)
    changed_files: list[str] = field(default_factory=list)
    auto_approve: bool = False
    errors: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    stack: str = "generic"  # generic, typescript, python, go, rust, etc.
    qa_config: dict[str, Any] = field(default_factory=dict)
    conversations: dict[str, list[dict[str, Any]]] = field(default_factory=dict)  # role -> message thread


class HarnessOrchestrator:
    """Central orchestrator for all harness workflows."""

    def __init__(self, state_path: str | None = None, message_queue: SQLiteMessageQueue | None = None):
        self.workflows: dict[str, WorkflowState] = {}
        self.event_bus = EventBus()
        self.message_queue = message_queue or get_message_queue()
        self._lock = asyncio.Lock()
        self._state_path = Path(state_path) if state_path else Path(".swarm") / "mcp_state.json"
        self._telemetry_path = self._state_path.parent / "telemetry.jsonl"
        self._load_state()

    def _load_state(self) -> None:
        if self._state_path.exists():
            try:
                data = json.loads(self._state_path.read_text())
                for wid, wf in data.get("workflows", {}).items():
                    # conversations may be missing in older state files
                    if "conversations" not in wf:
                        wf["conversations"] = {}
                    self.workflows[wid] = WorkflowState(**wf)
            except Exception:
                pass

    def _save_state(self) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "workflows": {
                wid: {
                    "workflow_id": s.workflow_id,
                    "task": s.task,
                    "repo_path": s.repo_path,
                    "status": s.status,
                    "current_phase": s.current_phase,
                    "plan": s.plan,
                    "outputs": s.outputs,
                    "approvals": s.approvals,
                    "qa_results": s.qa_results,
                    "changed_files": s.changed_files,
                    "auto_approve": s.auto_approve,
                    "errors": s.errors,
                    "created_at": s.created_at,
                    "stack": s.stack,
                    "qa_config": s.qa_config,
                    "conversations": s.conversations,
                }
                for wid, s in self.workflows.items()
            }
        }
        self._state_path.write_text(json.dumps(data, indent=2, default=str))

    async def create_workflow(
        self,
        task: str,
        repo_path: str,
        auto_approve: bool = False,
        stack: str = "generic",
        qa_config: dict[str, Any] | None = None,
    ) -> WorkflowState:
        import uuid
        workflow_id = f"hw-{int(time.time())}-{str(uuid.uuid4())[:4]}"
        repo = Path(repo_path).expanduser().resolve()
        state = WorkflowState(
            workflow_id=workflow_id,
            task=task,
            repo_path=str(repo),
            auto_approve=auto_approve,
            stack=stack,
            qa_config=qa_config or {},
        )
        async with self._lock:
            self.workflows[workflow_id] = state
            self._save_state()
        await self.event_bus.create_workflow(workflow_id)
        await self._emit(workflow_id, "workflow_created", message=f"Workflow {workflow_id} created")
        return state

    async def get_workflow(self, workflow_id: str) -> WorkflowState | None:
        async with self._lock:
            return self.workflows.get(workflow_id)

    async def list_workflows(self) -> list[WorkflowState]:
        async with self._lock:
            return list(self.workflows.values())

    async def transition(self, workflow_id: str, phase: str, status: str = "running") -> None:
        state = await self.get_workflow(workflow_id)
        if not state:
            return
        state.current_phase = phase
        state.status = status
        async with self._lock:
            self._save_state()
        await self._emit(workflow_id, "phase_start", phase=phase, message=f"Starting phase: {phase}")

    async def submit_output(self, workflow_id: str, phase: str, output: str, changed_files: list[str] | None = None) -> None:
        state = await self.get_workflow(workflow_id)
        if not state:
            return
        state.outputs[phase] = output
        if changed_files:
            state.changed_files.extend(changed_files)
        async with self._lock:
            self._save_state()
        await self._emit(workflow_id, "phase_complete", phase=phase, data={"output_length": len(output), "files": changed_files or []})

    async def request_approval(self, workflow_id: str, phase: str, content: str) -> None:
        state = await self.get_workflow(workflow_id)
        if not state:
            return
        state.status = "waiting_approval"
        async with self._lock:
            self._save_state()
        await self._emit(
            workflow_id,
            "approval_needed",
            phase=phase,
            data={"content_preview": content[:500]},
            message=f"Approval needed for {phase}",
        )

    async def submit_approval(self, workflow_id: str, phase: str, decision: str, feedback: str = "") -> None:
        state = await self.get_workflow(workflow_id)
        if not state:
            return
        state.approvals[phase] = decision
        state.status = "running" if decision == "approved" else "paused"
        async with self._lock:
            self._save_state()
        await self._emit(
            workflow_id,
            "approval_submitted",
            phase=phase,
            data={"decision": decision, "feedback": feedback},
            message=f"Approval for {phase}: {decision}",
        )

    # ------------------------------------------------------------------
    # Stack-aware QA gates
    # ------------------------------------------------------------------

    _STACK_QA_DEFAULTS: dict[str, list[dict[str, Any]]] = {
        "generic": [
            {
                "name": "no_debug_statements",
                "type": "grep",
                "description": "No debug print statements left in code",
                "patterns": [r"console\.log\(", r"print\(", r"puts\(", r"fmt\.Println\("],
                "extensions": [".py", ".js", ".ts", ".tsx", ".go", ".rs", ".java", ".rb"],
                "invert": True,
            },
            {
                "name": "no_todos",
                "type": "grep",
                "description": "No TODO/FIXME markers in source",
                "patterns": [r"TODO", r"FIXME\b", r"XXX\b"],
                "extensions": [".py", ".js", ".ts", ".tsx", ".go", ".rs", ".java", ".rb", ".c", ".cpp", ".h"],
                "invert": True,
            },
            {
                "name": "no_backup_files",
                "type": "file_check",
                "description": "No .bak or temp files left behind",
                "forbidden_extensions": [".bak", ".tmp", ".swp", ".orig"],
            },
        ],
        "typescript": [
            {
                "name": "tsc_passed",
                "type": "command",
                "description": "TypeScript compiles without errors",
                "cmd": ["npx", "tsc", "--noEmit"],
                "timeout": 120,
            },
            {
                "name": "no_any_types",
                "type": "grep",
                "description": "No explicit `any` types in source",
                "patterns": [r":\s*any\b"],
                "extensions": [".ts", ".tsx"],
                "invert": True,
            },
            {
                "name": "no_debug_statements",
                "type": "grep",
                "description": "No console.log statements in source",
                "patterns": [r"console\.log\("],
                "extensions": [".ts", ".tsx", ".js"],
                "invert": True,
            },
        ],
        "python": [
            {
                "name": "syntax_check",
                "type": "command",
                "description": "Python syntax check on changed files",
                "cmd": ["python", "-m", "py_compile"],
                "file_args": True,
                "timeout": 60,
            },
            {
                "name": "no_debug_prints",
                "type": "grep",
                "description": "No print() debug statements",
                "patterns": [r"^[^#]*\bprint\("],
                "extensions": [".py"],
                "invert": True,
            },
            {
                "name": "pytest",
                "type": "command",
                "description": "Tests pass if test directory exists",
                "cmd": ["python", "-m", "pytest", "-q"],
                "timeout": 120,
                "optional": True,
            },
        ],
        "go": [
            {
                "name": "go_build",
                "type": "command",
                "description": "Go build succeeds",
                "cmd": ["go", "build", "./..."],
                "timeout": 120,
            },
            {
                "name": "go_vet",
                "type": "command",
                "description": "Go vet passes",
                "cmd": ["go", "vet", "./..."],
                "timeout": 60,
            },
            {
                "name": "gofmt",
                "type": "command",
                "description": "Code is gofmt-compliant",
                "cmd": ["gofmt", "-l", "."],
                "expect_empty_stdout": True,
                "timeout": 30,
            },
        ],
        "rust": [
            {
                "name": "cargo_check",
                "type": "command",
                "description": "Cargo check passes",
                "cmd": ["cargo", "check"],
                "timeout": 180,
            },
            {
                "name": "cargo_clippy",
                "type": "command",
                "description": "Clippy warnings resolved",
                "cmd": ["cargo", "clippy", "--", "-D", "warnings"],
                "timeout": 180,
                "optional": True,
            },
        ],
    }

    async def run_qa(self, workflow_id: str) -> dict[str, Any]:
        state = await self.get_workflow(workflow_id)
        if not state:
            return {"overall": False, "errors": ["Workflow not found"]}
        repo = Path(state.repo_path)
        await self._emit(workflow_id, "qa_start", message="Running QA gates")

        checks = state.qa_config.get("checks", []) or self._STACK_QA_DEFAULTS.get(state.stack, self._STACK_QA_DEFAULTS["generic"])
        results: dict[str, Any] = {"overall": True, "checks": {}, "errors": []}

        for check in checks:
            name = check["name"]
            desc = check.get("description", name)
            optional = check.get("optional", False)
            passed = False
            error = ""

            try:
                if check["type"] == "command":
                    passed, error = await self._qa_run_command(repo, check, state.changed_files)
                elif check["type"] == "grep":
                    passed, error = await self._qa_run_grep(repo, check)
                elif check["type"] == "file_check":
                    passed, error = await self._qa_run_file_check(repo, check)
                else:
                    error = f"Unknown check type: {check['type']}"
            except Exception as e:
                error = f"{name} error: {e}"

            if optional and not passed:
                # Optional checks don't fail overall
                results["checks"][name] = {"passed": False, "optional": True, "description": desc, "error": error}
                continue

            results["checks"][name] = {"passed": passed, "description": desc, "error": error}
            if not passed:
                results["overall"] = False
                if error:
                    results["errors"].append(f"[{name}] {error}")

        state.qa_results = results
        async with self._lock:
            self._save_state()
        await self._emit(
            workflow_id,
            "qa_complete",
            data=results,
            message=f"QA {'PASS' if results['overall'] else 'FAIL'}",
        )
        return results

    async def _qa_run_command(
        self, repo: Path, check: dict[str, Any], changed_files: list[str]
    ) -> tuple[bool, str]:
        cmd = list(check["cmd"])
        if check.get("file_args") and changed_files:
            cmd.extend(changed_files)
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(repo),
        )
        timeout = check.get("timeout", 60)
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return False, f"Timed out after {timeout}s"

        if check.get("expect_empty_stdout"):
            passed = not stdout.decode().strip()
            if not passed:
                return False, f"Unexpected output:\n{stdout.decode()[:500]}"
            return True, ""

        passed = proc.returncode == 0
        if not passed:
            err = stderr.decode()[:500] or stdout.decode()[:500] or f"Command failed with exit code {proc.returncode}"
            return False, err
        return True, ""

    async def _qa_run_grep(self, repo: Path, check: dict[str, Any]) -> tuple[bool, str]:
        patterns = check["patterns"]
        extensions = check.get("extensions", ["*"])
        invert = check.get("invert", False)
        source_dirs = check.get("paths", [".", "src", "lib", "app", "pkg"])

        all_matches: list[str] = []
        for pattern in patterns:
            for ext in extensions:
                glob_pattern = f"**/*{ext}" if ext != "*" else "**/*"
                for src_dir in source_dirs:
                    dir_path = repo / src_dir
                    if not dir_path.exists():
                        continue
                    files = list(dir_path.rglob(f"*{ext}")) if ext != "*" else list(dir_path.rglob("*"))
                    for file_path in files:
                        if not file_path.is_file():
                            continue
                        try:
                            content = file_path.read_text()
                            for i, line in enumerate(content.split("\n"), 1):
                                import re
                                if re.search(pattern, line):
                                    rel = file_path.relative_to(repo)
                                    all_matches.append(f"{rel}:{i}: {line.strip()}")
                        except (UnicodeDecodeError, OSError):
                            continue

        matches = all_matches[:20]  # cap error output
        if invert:
            passed = not matches
            return passed, "\n".join(matches) if matches else ""
        passed = bool(matches)
        return passed, "\n".join(matches) if matches else f"Pattern not found: {patterns}"

    async def _qa_run_file_check(self, repo: Path, check: dict[str, Any]) -> tuple[bool, str]:
        forbidden = check.get("forbidden_extensions", [])
        found: list[str] = []
        for ext in forbidden:
            for f in repo.rglob(f"*{ext}"):
                if f.is_file():
                    found.append(str(f.relative_to(repo)))
        passed = not found
        return passed, "Forbidden files found: " + ", ".join(found[:10]) if found else ""

    async def mark_complete(self, workflow_id: str, success: bool = True) -> None:
        state = await self.get_workflow(workflow_id)
        if not state:
            return
        state.status = "complete" if success else "failed"
        async with self._lock:
            self._save_state()
        await self._emit(workflow_id, "workflow_complete", data={"success": success})

    # ------------------------------------------------------------------
    # Steering / Advisory conversation
    # ------------------------------------------------------------------

    async def send_message(
        self,
        workflow_id: str,
        role: str,
        sender: str,
        content: str,
        msg_type: str = "steering",
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Publish a message to a role's channel + persist in workflow state."""
        state = await self.get_workflow(workflow_id)
        if not state:
            return {"error": "Workflow not found"}

        channel = f"workflow:{workflow_id}:{role}"
        msg = AgentMessage(
            workflow_id=workflow_id,
            channel=channel,
            sender=sender,
            recipient_role=role,
            content=content,
            msg_type=msg_type,
            data=data or {},
        )
        await self.message_queue.publish(msg)

        # Also keep in workflow state for quick lookup
        local_msg = {
            "id": msg.id,
            "sender": sender,
            "role": role,
            "content": content,
            "timestamp": msg.timestamp,
            "msg_type": msg_type,
            "data": data or {},
        }
        if role not in state.conversations:
            state.conversations[role] = []
        state.conversations[role].append(local_msg)
        async with self._lock:
            self._save_state()

        # Emit legacy telemetry event
        await self._emit(
            workflow_id,
            "steering_message",
            agent_role=role,
            data={"sender": sender, "content_preview": content[:200], "msg_id": msg.id},
            message=f"[{sender} -> {role}] {content[:120]}",
        )
        return local_msg

    async def get_conversation(self, workflow_id: str, role: str) -> list[dict[str, Any]]:
        """Return conversation thread from persistent message queue (authoritative)."""
        channel = f"workflow:{workflow_id}:{role}"
        messages = await self.message_queue.channel_history(channel)
        return [
            {
                "id": m.id,
                "sender": m.sender,
                "role": m.recipient_role,
                "content": m.content,
                "timestamp": m.timestamp,
                "msg_type": m.msg_type,
                "data": m.data,
            }
            for m in messages
        ]

    async def get_advisory_context(
        self, workflow_id: str, role: str
    ) -> dict[str, Any] | None:
        """Return rich context for an advisor: workflow state, recent events, conversation thread."""
        state = await self.get_workflow(workflow_id)
        if not state:
            return None

        # Get recent events (last 50)
        queue = await self.event_bus.get_queue(workflow_id, auto_create=False)
        recent_events = []
        if queue:
            history = queue.get_history(since=0)
            recent_events = history[-50:]

        # Get conversation from message queue (authoritative)
        conversation = await self.get_conversation(workflow_id, role)

        return {
            "workflow_id": state.workflow_id,
            "task": state.task,
            "status": state.status,
            "current_phase": state.current_phase,
            "stack": state.stack,
            "role": role,
            "conversation": conversation,
            "recent_events": [
                {
                    "event_id": e.event_id,
                    "timestamp": e.timestamp,
                    "event_type": e.event_type,
                    "phase": e.phase,
                    "agent_role": e.agent_role,
                    "message": e.message,
                    "data": e.data,
                }
                for e in recent_events
            ],
            "outputs": {k: v[:500] + "..." if len(v) > 500 else v for k, v in state.outputs.items()},
            "approvals": state.approvals,
            "qa_results": state.qa_results,
            "errors": state.errors,
        }

    async def mark_failed(self, workflow_id: str, reason: str) -> None:
        state = await self.get_workflow(workflow_id)
        if not state:
            return
        state.status = "failed"
        state.errors.append(reason)
        async with self._lock:
            self._save_state()
        await self._emit(workflow_id, "error", data={"reason": reason}, message=reason)

    async def _emit(self, workflow_id: str, event_type: str, **kwargs) -> None:
        event = HarnessEvent(event_type=event_type, **kwargs)
        await self.event_bus.emit(workflow_id, event)
        self._telemetry_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._telemetry_path, "a") as f:
            f.write(json.dumps({
                "workflow_id": workflow_id,
                "event_id": event.event_id,
                "timestamp": event.timestamp,
                "event_type": event.event_type,
                "phase": event.phase,
                "agent_role": event.agent_role,
                "message": event.message,
                "data": event.data,
            }, default=str) + "\n")

    def to_dict(self, state: WorkflowState) -> dict[str, Any]:
        return {
            "workflow_id": state.workflow_id,
            "task": state.task,
            "repo_path": state.repo_path,
            "status": state.status,
            "current_phase": state.current_phase,
            "plan": state.plan,
            "outputs": {k: v[:500] + "..." if len(v) > 500 else v for k, v in state.outputs.items()},
            "approvals": state.approvals,
            "qa_results": state.qa_results,
            "changed_files": state.changed_files,
            "errors": state.errors,
            "created_at": state.created_at,
            "stack": state.stack,
        }
