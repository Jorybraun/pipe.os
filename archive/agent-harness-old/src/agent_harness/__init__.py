"""Agent Harness — MCP server for multi-agent development workflows."""

__version__ = "0.1.0"

# ---------------------------------------------------------------------------
# Global patch: Kimi API requires reasoning_content on assistant messages with
# tool_calls, but LangChain doesn't preserve it. Applied once at package import.
# ---------------------------------------------------------------------------
from langchain_openai.chat_models import base as _openai_base

_original_msg_to_dict = _openai_base._convert_message_to_dict
_original_dict_to_msg = _openai_base._convert_dict_to_message


def _patched_convert_dict_to_message(_dict):
    msg = _original_dict_to_msg(_dict)
    if _dict.get("role") == "assistant" and "reasoning_content" in _dict:
        msg.additional_kwargs["reasoning_content"] = _dict["reasoning_content"]
    return msg


def _patched_convert_message_to_dict(message, api="chat/completions"):
    result = _original_msg_to_dict(message, api=api)
    if result.get("role") == "assistant":
        rc = message.additional_kwargs.get("reasoning_content", "")
        if rc or "reasoning_content" not in result:
            result["reasoning_content"] = rc
    return result


_openai_base._convert_dict_to_message = _patched_convert_dict_to_message
_openai_base._convert_message_to_dict = _patched_convert_message_to_dict
