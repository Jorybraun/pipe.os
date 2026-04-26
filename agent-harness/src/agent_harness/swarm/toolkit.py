"""Developer agent toolkit — file, shell, browser, and broker MCP tools."""
from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import tool
from langchain_community.agent_toolkits import FileManagementToolkit
from langchain_community.tools import ShellTool
from langchain_community.tools.file_management.read import ReadFileTool
from langchain_community.tools.file_management.utils import INVALID_PATH_TEMPLATE
from langchain_community.tools.playwright.utils import create_sync_playwright_browser
from langchain_community.tools.playwright import (
    ClickTool,
    ExtractTextTool,
    NavigateTool,
)

from agent_harness.broker import (
    emit,
    get_plan,
    post_cue,
    read_cues,
    ack_cue,
    reserve_migration,
    submit_handoff,
)
from agent_harness.swarm.agents.architect import run_architect


MAX_SHELL_OUTPUT = 32_000  # characters
MAX_FILE_READ_BYTES = 64_000  # characters


class SafeShellTool(ShellTool):
    """ShellTool with output size limits to prevent checkpoint bloat."""

    def _run(self, commands, run_manager=None):
        result = super()._run(commands, run_manager=run_manager)
        if isinstance(result, str) and len(result) > MAX_SHELL_OUTPUT:
            truncated = result[:MAX_SHELL_OUTPUT]
            last_newline = truncated.rfind("\n")
            if last_newline > 0:
                truncated = truncated[:last_newline]
            result = (
                truncated
                + f"\n\n[TRUNCATED: output exceeded {MAX_SHELL_OUTPUT} characters]"
            )
        return result


class SafeReadFileTool(ReadFileTool):
    """ReadFileTool with size limits to prevent checkpoint bloat."""

    max_read_bytes: int = MAX_FILE_READ_BYTES

    def _run(self, file_path: str, run_manager=None):
        try:
            read_path = self.get_relative_path(file_path)
        except Exception:
            return INVALID_PATH_TEMPLATE.format(arg_name="file_path", value=file_path)
        if not read_path.exists():
            return f"Error: no such file or directory: {file_path}"
        try:
            size = read_path.stat().st_size
            if size > self.max_read_bytes:
                with read_path.open("r", encoding="utf-8") as f:
                    content = f.read(self.max_read_bytes)
                last_newline = content.rfind("\n")
                if last_newline > 0:
                    content = content[:last_newline]
                content += (
                    f"\n\n[TRUNCATED: file is {size} bytes, limit {self.max_read_bytes}]"
                )
                return content
            with read_path.open("r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            return "Error: " + str(e)


def get_developer_tools(root_dir: str = ".") -> list[Any]:
    """Return the full tool list for an ephemeral developer agent."""
    # File management (restricted to repo root)
    ftk = FileManagementToolkit(root_dir=root_dir)
    file_tools = []
    for t in ftk.get_tools():
        if isinstance(t, ReadFileTool):
            file_tools.append(SafeReadFileTool(root_dir=root_dir))
        else:
            file_tools.append(t)

    # Shell (with output limits)
    shell_tool = SafeShellTool()

    # Playwright browser (manual QA / smoke testing)
    try:
        browser = create_sync_playwright_browser()
        navigate_tool = NavigateTool.from_browser(sync_browser=browser)
        extract_text_tool = ExtractTextTool.from_browser(sync_browser=browser)
        click_tool = ClickTool.from_browser(sync_browser=browser)
        browser_tools = [navigate_tool, extract_text_tool, click_tool]
    except Exception as exc:
        import warnings
        warnings.warn(f"Playwright tools unavailable: {exc}")
        browser_tools = []

    # Broker tools — wrapped as LangChain @tool functions
    @tool
    def broker_submit_handoff_tool(
        plan_id: str,
        subtask_id: str,
        status: str,
        handoff_to: str,
        sequence: int = 0,
        done: str = "[]",
        next_actions: str = "[]",
        state_notes: str = "[]",
        files_touched: str = "[]",
        migrations_reserved: str = "[]",
        context_used: int = 0,
        dod_checklist: str = "[]",
    ) -> str:
        """Submit a developer handoff (required exit artifact).

        status: complete | context_exhausted | blocked
        handoff_to: next_dev | qa_deploy | supervisor_reroute
        dod_checklist: JSON list of {item: str, checked: bool, justification: str}
        """
        record = submit_handoff(
            plan_id=plan_id,
            subtask_id=subtask_id,
            status=status,
            handoff_to=handoff_to,
            sequence=sequence or None,
            done=json.loads(done),
            next_actions=json.loads(next_actions),
            state_notes=json.loads(state_notes),
            files_touched=json.loads(files_touched),
            migrations_reserved=json.loads(migrations_reserved),
            context_used=context_used or None,
            dod_checklist=json.loads(dod_checklist),
        )
        return json.dumps({"submitted": record}, indent=2)

    @tool
    def broker_emit_event_tool(
        event_type: str,
        payload: str = "{}",
        plan_id: str = "",
        lane_id: str = "",
        agent_id: str = "",
    ) -> str:
        """Emit an event to the broker event bus."""
        event_id = emit(
            event_type=event_type,
            payload=json.loads(payload) if payload else None,
            plan_id=plan_id or None,
            lane_id=lane_id or None,
            agent_id=agent_id or None,
        )
        return json.dumps({"event_id": event_id}, indent=2)

    @tool
    def broker_get_plan_tool(plan_id: str) -> str:
        """Get full plan content including subtasks and dependencies."""
        plan = get_plan(plan_id)
        if not plan:
            return json.dumps({"error": f"Plan not found: {plan_id}"})
        return json.dumps(plan, indent=2)

    @tool
    def broker_reserve_migration_tool(env: str, plan_id: str = "", lane_id: str = "") -> str:
        """Atomically reserve the next migration number for an environment."""
        num = reserve_migration(
            env=env,
            plan_id=plan_id or None,
            lane_id=lane_id or None,
        )
        return json.dumps({"reserved": num, "env": env}, indent=2)

    @tool
    def broker_post_cue_tool(content: str, plan_id: str = "", lane_id: str = "") -> str:
        """Post a steering cue (deduped by content hash)."""
        result = post_cue(
            content=content,
            plan_id=plan_id or None,
            lane_id=lane_id or None,
        )
        return json.dumps(result, indent=2)

    @tool
    def broker_read_cues_tool(plan_id: str = "", lane_id: str = "", since: float = 0.0) -> str:
        """Read pending (unacked) steering cues."""
        rows = read_cues(
            plan_id=plan_id or None,
            lane_id=lane_id or None,
            since=since,
        )
        return json.dumps({"count": len(rows), "cues": rows}, indent=2)

    @tool
    def broker_ack_cue_tool(cue_id: str) -> str:
        """Acknowledge a cue by ID."""
        ok = ack_cue(cue_id)
        return json.dumps({"acked": ok, "cue_id": cue_id}, indent=2)

    @tool
    def consult_architect_tool(
        plan_id: str,
        subtask_id: str,
        question: str,
        lane_id: str = "",
    ) -> str:
        """Consult the System Architect for deep architectural guidance.

        Use this when you encounter missing API contracts, schema ambiguity,
        integration questions, or uncertainty about how to structure a change.
        Returns a structured 8-point architecture spec.
        """
        result = run_architect(
            plan_id=plan_id,
            subtask_id=subtask_id or None,
            question=question,
            lane_id=lane_id,
        )
        return json.dumps(result, indent=2)

    broker_tools = [
        broker_submit_handoff_tool,
        broker_emit_event_tool,
        broker_get_plan_tool,
        broker_reserve_migration_tool,
        broker_post_cue_tool,
        broker_read_cues_tool,
        broker_ack_cue_tool,
        consult_architect_tool,
    ]

    return file_tools + [shell_tool] + browser_tools + broker_tools
