"""Generic chat agent for orchestrator roles (pm, designer, architect, frontend, backend).

Provides a simple request/response loop over the orchestrator message queue.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langchain_openai import ChatOpenAI


_ROLES = {"pm", "designer", "architect", "frontend", "backend"}


def _make_model() -> ChatOpenAI | None:
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    model = os.getenv("KIMI_CHAT_MODEL") or os.getenv("KIMI_STRATEGIC_MODEL") or os.getenv("KIMI_DEV_MODEL") or os.getenv("KIMI_MODEL", "kimi-k2-6")
    default_base = (
        "https://api.kimi.com/coding/v1"
        if model == "kimi-for-coding"
        else "https://api.moonshot.cn/v1"
    )
    base_url = os.getenv("KIMI_DEV_BASE_URL") or os.getenv("KIMI_BASE_URL", default_base)
    try:
        return ChatOpenAI(
            model=model,
            temperature=0.4,
            max_tokens=4096,
            api_key=api_key,
            base_url=base_url,
            timeout=30,
            max_retries=2,
            default_headers={"User-Agent": "claude-code/0.1"},
            extra_body={"reasoning": None},
        )
    except Exception:
        return None


def _load_role_prompt(role: str) -> str:
    path = Path(__file__).parent.parent.parent / "prompts" / f"{role}.md"
    if path.exists():
        return path.read_text()
    return f"You are the {role.title()} agent. Help the user with their request."


def _build_messages(role: str, conversation: list[dict[str, Any]]) -> list[SystemMessage | HumanMessage | AIMessage]:
    prompt = _load_role_prompt(role)
    messages: list[SystemMessage | HumanMessage | AIMessage] = [SystemMessage(content=prompt)]

    for msg in conversation:
        content = msg.get("content", "")
        sender = msg.get("sender", "")
        if sender == role:
            messages.append(AIMessage(content=content))
        else:
            messages.append(HumanMessage(content=content))

    return messages


def run_chat_agent(
    role: str,
    conversation: list[dict[str, Any]],
) -> str:
    """Run a chat agent for the given role against a conversation history.

    Returns the agent's response text. Falls back to a canned response if
    no LLM API key is configured or the key is invalid.
    """
    if role not in _ROLES:
        raise ValueError(f"Unknown role: {role}. Must be one of {_ROLES}")

    model = _make_model()
    if model is None:
        return (
            f"[{role.upper()} AGENT] I received your message but cannot generate a "
            f"response because the LLM API key (KIMI_API_KEY) is not configured or invalid. "
            f"Please set a valid API key in the environment to enable agent responses."
        )

    messages = _build_messages(role, conversation)
    try:
        response = model.invoke(messages)
        return str(response.content)
    except Exception as e:
        return (
            f"[{role.upper()} AGENT] I received your message but encountered an error "
            f"while generating a response: {e}. Please check the LLM API key and try again."
        )


async def run_chat_agent_for_workflow(
    workflow_id: str,
    role: str,
    orchestrator: Any,
) -> dict[str, Any]:
    """Fetch conversation, run agent, publish response.

    Returns {"response": str, "message_id": str} or {"error": str}.
    """
    try:
        conversation = await orchestrator.get_conversation(workflow_id, role)
        if not conversation:
            return {"error": f"No conversation history for {role}"}

        response_text = run_chat_agent(role, conversation)

        msg = await orchestrator.send_message(
            workflow_id=workflow_id,
            role=role,
            sender=role,
            content=response_text,
            msg_type="steering",
        )

        return {"response": response_text, "message_id": msg.get("id")}
    except Exception as e:
        return {"error": str(e)}
