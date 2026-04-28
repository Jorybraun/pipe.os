"""QA agent — terminal validation gate for a plan lane (no deploy)."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from typing_extensions import Annotated, TypedDict

from agent_harness.broker import get_handoff_chain, emit, get_plan
from agent_harness.swarm.checkpoint import get_checkpointer
from agent_harness.swarm.toolkit import SafeShellTool
import subprocess
from langchain_community.tools.playwright.utils import create_sync_playwright_browser
from langchain_community.tools.playwright import (
    ClickTool,
    ExtractTextTool,
    NavigateTool,
)


type QAStatus = Literal["complete", "failed", "escalated"]


class QAState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    plan_id: str
    lane_id: str
    handoff_chain: list[dict[str, Any]]
    pr_url: str | None
    status: QAStatus | None


def _load_prompt() -> str:
    path = Path(__file__).parent.parent / "prompts" / "qa_deploy.md"
    if path.exists():
        return path.read_text()
    return "# QA Agent\nValidate handoffs, run tests, mark plan complete. No deploy."


def _build_system_message(state: QAState) -> SystemMessage:
    base = _load_prompt()
    chain = state.get("handoff_chain", [])
    plan = get_plan(state["plan_id"])
    parts = [base, f"\n## Plan\n{plan['title'] if plan else state['plan_id']}"]
    if chain:
        parts.append(f"\n## Handoff Chain ({len(chain)} items)\n")
        for h in chain:
            parts.append(f"- {h['subtask_id']} seq={h['sequence']} status={h['status']}")
    return SystemMessage(content="\n".join(parts))


def _make_model() -> ChatOpenAI:
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY or OPENAI_API_KEY not set")
    # QA-Deploy uses same model resolution as dev agent to avoid kimi-for-coding hangs
    model = os.getenv("KIMI_QA_MODEL") or os.getenv("KIMI_STRATEGIC_MODEL") or os.getenv("KIMI_DEV_MODEL") or os.getenv("KIMI_MODEL", "kimi-k2-6")
    default_base = (
        "https://api.kimi.com/coding/v1"
        if model == "kimi-for-coding"
        else "https://api.moonshot.cn/v1"
    )
    base_url = os.getenv("KIMI_DEV_BASE_URL") or os.getenv("KIMI_BASE_URL", default_base)
    return ChatOpenAI(
        model=model,
        temperature=0.2,
        max_tokens=8192,
        api_key=api_key,
        base_url=base_url,
        timeout=30,
        max_retries=2,
        default_headers={"User-Agent": "claude-code/0.1"},
        extra_body={"reasoning": None},
    )


def qa_agent_node(state: QAState, config: RunnableConfig) -> dict[str, Any]:
    """Call the LLM with the current message history."""
    model = _make_model()
    messages = state["messages"]
    if not messages or not isinstance(messages[0], SystemMessage):
        messages = [_build_system_message(state)] + list(messages)
    # Bind tools so the model knows to generate tool_calls
    tools = _get_cached_qa_tools()
    model_with_tools = model.bind_tools(tools)
    response = model_with_tools.invoke(messages, config)
    return {"messages": [response]}


def _get_qa_tools() -> list[Any]:
    """Tools for QA: validation, compilation, tests, shell, browser, broker emit. No PR/deploy tools."""
    from pathlib import Path
    root_path = Path(__file__).parent.parent.parent.parent.parent.resolve()
    MAX_SHELL_OUTPUT = 32_000

    tools: list[Any] = [SafeShellTool()]
    try:
        browser = create_sync_playwright_browser()
        tools.append(NavigateTool.from_browser(sync_browser=browser))
        tools.append(ExtractTextTool.from_browser(sync_browser=browser))
        tools.append(ClickTool.from_browser(sync_browser=browser))
    except Exception:
        pass

    from langchain_core.tools import tool
    from agent_harness.broker import emit as broker_emit

    @tool
    def broker_emit_event_tool(
        event_type: str,
        payload: str = "{}",
        plan_id: str = "",
        lane_id: str = "",
    ) -> str:
        """Emit an event to the broker event bus."""
        event_id = broker_emit(
            event_type=event_type,
            payload=json.loads(payload) if payload else None,
            plan_id=plan_id or None,
            lane_id=lane_id or None,
        )
        return json.dumps({"event_id": event_id}, indent=2)

    @tool
    def qa_check_types() -> str:
        """Run TypeScript compiler to validate all code compiles.
        REQUIRED before marking a plan complete.
        """
        try:
            result = subprocess.run(
                ["npx", "tsc", "--noEmit"],
                cwd=str(root_path),
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode == 0:
                return "PASS: TypeScript compilation check passed."
            stdout = result.stdout or ""
            stderr = result.stderr or ""
            combined = (stdout + "\n" + stderr).strip()
            if len(combined) > MAX_SHELL_OUTPUT:
                combined = combined[:MAX_SHELL_OUTPUT] + "\n\n[TRUNCATED]"
            return f"FAIL: TypeScript compilation errors:\n{combined}"
        except subprocess.TimeoutExpired:
            return "FAIL: Type check timed out after 120s"
        except Exception as e:
            return f"FAIL: Could not run type check: {e}"

    @tool
    def qa_run_tests(test_pattern: str = "") -> str:
        """Run the test suite. REQUIRED before marking a plan complete.

        Args:
            test_pattern: Optional pattern to filter tests.
        """
        cmd = ["npx", "vitest", "run", "--reporter=verbose"]
        if test_pattern:
            cmd.append(test_pattern)
        try:
            result = subprocess.run(
                cmd,
                cwd=str(root_path),
                capture_output=True,
                text=True,
                timeout=300,
            )
            stdout = result.stdout or ""
            stderr = result.stderr or ""
            combined = (stdout + "\n" + stderr).strip()
            if len(combined) > MAX_SHELL_OUTPUT:
                combined = combined[:MAX_SHELL_OUTPUT] + "\n\n[TRUNCATED]"
            if result.returncode == 0:
                return f"PASS: Tests passed.\n{combined}"
            return f"FAIL: Tests failed (exit code {result.returncode}):\n{combined}"
        except subprocess.TimeoutExpired:
            return "FAIL: Tests timed out after 300s"
        except Exception as e:
            return f"FAIL: Could not run tests: {e}"

    @tool
    def qa_verify_files(file_paths: str) -> str:
        """Verify that files mentioned in handoffs actually exist on disk.

        Args:
            file_paths: JSON list of file paths to check.
        """
        import json as _json
        paths = _json.loads(file_paths) if file_paths else []
        missing = []
        found = []
        for p in paths:
            target = root_path / p if not Path(p).is_absolute() else Path(p)
            if target.exists():
                found.append(p)
            else:
                missing.append(p)
        if missing:
            return f"FAIL: {len(missing)} files missing: {missing}. Found: {found}"
        return f"PASS: All {len(found)} files exist."

    tools.extend([
        broker_emit_event_tool,
        qa_check_types,
        qa_run_tests,
        qa_verify_files,
    ])
    return tools


_QA_TOOLS: list[Any] | None = None


def _get_cached_qa_tools() -> list[Any]:
    global _QA_TOOLS
    if _QA_TOOLS is None:
        _QA_TOOLS = _get_qa_tools()
    return _QA_TOOLS


def qa_tools_node(state: QAState) -> dict[str, Any]:
    tool_node = ToolNode(_get_cached_qa_tools())
    result = tool_node.invoke(state)
    return result


def qa_should_continue(state: QAState) -> Literal["tools", "agent", "__end__"]:
    last = state["messages"][-1]
    if isinstance(last, ToolMessage) and last.name == "broker_emit_event_tool":
        # If the agent emitted a terminal event, end
        if "plan_completed" in last.content or "plan_failed" in last.content:
            return END
    if isinstance(last, AIMessage) and last.tool_calls:
        return "tools"
    return END


def build_qa_graph(checkpointer: Any | None = None):
    """Build and compile the QA ReAct graph (no deploy)."""
    builder = StateGraph(QAState)
    builder.add_node("agent", qa_agent_node)
    builder.add_node("tools", qa_tools_node)
    builder.set_entry_point("agent")
    builder.add_conditional_edges(
        "agent",
        qa_should_continue,
        {"tools": "tools", "agent": "agent", END: END},
    )
    builder.add_edge("tools", "agent")
    return builder.compile(checkpointer=checkpointer)


def run_qa_deploy(
    plan_id: str,
    lane_id: str,
    thread_id: str | None = None,
) -> QAState:
    """Run QA validation to completion for a plan lane (no deploy)."""
    chain = get_handoff_chain(plan_id)
    checkpointer = get_checkpointer()
    graph = build_qa_graph(checkpointer=checkpointer)
    initial: QAState = {
        "messages": [],
        "plan_id": plan_id,
        "lane_id": lane_id,
        "handoff_chain": chain,
        "pr_url": None,
        "status": None,
    }
    final_state = None
    for event in graph.stream(initial, {"configurable": {"thread_id": thread_id or lane_id}}, stream_mode="values"):
        final_state = event
    return final_state  # type: ignore[return-value]
