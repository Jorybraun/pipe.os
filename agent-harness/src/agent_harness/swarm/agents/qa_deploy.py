"""QA-Deploy agent — terminal gate for a plan lane."""
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
from agent_harness.swarm.pr_template import validate_pr_description
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
    return "# QA-Deploy Agent\nValidate handoffs, run tests, open PR."


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
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    return ChatOpenAI(
        model="kimi-latest",
        temperature=0.2,
        max_tokens=8192,
        api_key=api_key,
        base_url="https://api.moonshot.cn/v1",
    )


def qa_agent_node(state: QAState, config: RunnableConfig) -> dict[str, Any]:
    """Call the LLM with the current message history."""
    model = _make_model()
    messages = state["messages"]
    if not messages or not isinstance(messages[0], SystemMessage):
        messages = [_build_system_message(state)] + list(messages)
    response = model.invoke(messages, config)
    return {"messages": [response]}


def _get_qa_tools() -> list[Any]:
    """Tools for QA-Deploy: shell, browser, broker emit."""
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
    def validate_pr_template_tool(description: str) -> str:
        """Validate a PR description against the required template."""
        result = validate_pr_description(description)
        return json.dumps(result, indent=2)

    @tool
    def create_pr_tool(title: str, body: str, head: str, base: str = "main") -> str:
        """Create a GitHub pull request. Validates PR body first, then tries gh CLI, then hub CLI."""
        validation = validate_pr_description(body)
        if not validation["valid"]:
            return json.dumps({"error": "Invalid PR description", "validation": validation}, indent=2)

        # Try gh CLI
        try:
            subprocess.run(
                ["gh", "pr", "create", "--title", title, "--body", body, "--head", head, "--base", base],
                capture_output=True, text=True, check=True,
            )
            # Fetch the PR URL
            result = subprocess.run(
                ["gh", "pr", "view", head, "--json", "url"],
                capture_output=True, text=True, check=True,
            )
            pr_data = json.loads(result.stdout)
            pr_url = pr_data.get("url", "")
            return json.dumps({"pr_url": pr_url, "method": "gh"}, indent=2)
        except Exception as gh_err:
            # Fallback to hub CLI
            try:
                result = subprocess.run(
                    ["hub", "pull-request", "-m", title, "-m", body, "-b", base, "-h", head],
                    capture_output=True, text=True, check=True,
                )
                pr_url = result.stdout.strip()
                return json.dumps({"pr_url": pr_url, "method": "hub"}, indent=2)
            except Exception as hub_err:
                return json.dumps({
                    "error": f"Failed to create PR: gh={gh_err}, hub={hub_err}",
                    "pr_url": None,
                }, indent=2)

    tools.extend([broker_emit_event_tool, validate_pr_template_tool, create_pr_tool])
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
    # Extract PR URL from create_pr_tool result and update state
    messages = result.get("messages", state.get("messages", []))
    for msg in reversed(messages):
        if isinstance(msg, ToolMessage) and msg.name == "create_pr_tool":
            try:
                data = json.loads(msg.content)
                if data.get("pr_url"):
                    result["pr_url"] = data["pr_url"]
            except Exception:
                pass
            break
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
    """Build and compile the QA-Deploy ReAct graph."""
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
    """Run QA-Deploy to completion for a plan lane."""
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
