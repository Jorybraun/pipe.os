"""Per-developer, per-plan, and per-subtask token accounting."""
from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, BaseMessage


WARN_THRESHOLD = 60_000
FORCE_THRESHOLD = 80_000
RESERVE_HANDOFF = 20_000
PLAN_BUDGET_LIMIT = 500_000
MAX_HANDOFFS_PER_SUBTASK = 5


class TokenBudget:
    """Tracks cumulative input tokens for a single ephemeral developer.

    Warns at 60K, forces handoff at 80K (reserving 20K for the handoff write).
    """

    def __init__(self, limit: int = FORCE_THRESHOLD) -> None:
        self.used: int = 0
        self.limit: int = limit
        self.warned: bool = False

    def add_turn(self, messages: list[BaseMessage]) -> dict[str, Any]:
        """Count tokens from the latest turn and return status."""
        turn_tokens = 0
        for msg in messages:
            if isinstance(msg, AIMessage):
                meta = msg.usage_metadata or {}
                turn_tokens += meta.get("input_tokens", 0) or meta.get("prompt_tokens", 0)
            else:
                # Rough approximation for non-AI messages: ~4 chars per token
                turn_tokens += len(msg.content) // 4 if isinstance(msg.content, str) else 0

        self.used += turn_tokens
        status = "ok"
        if self.used >= self.limit - RESERVE_HANDOFF and not self.warned:
            self.warned = True
            status = "warn"
        if self.used >= self.limit:
            status = "exhausted"

        return {
            "turn_tokens": turn_tokens,
            "cumulative": self.used,
            "remaining": max(0, self.limit - self.used),
            "status": status,
            "message": self._message(status),
        }

    def _message(self, status: str) -> str:
        if status == "warn":
            return (
                f"TOKEN WARNING: {self.used} / {self.limit} tokens used. "
                f"You have ~{self.limit - self.used} tokens left. "
                f"Start wrapping up and prepare your Handoff."
            )
        if status == "exhausted":
            return (
                f"TOKEN LIMIT REACHED: {self.used} / {self.limit} tokens. "
                f"You MUST exit now via broker_submit_handoff_tool with status=context_exhausted."
            )
        return f"Token budget: {self.used} / {self.limit} used."

    def reset(self) -> None:
        self.used = 0
        self.warned = False


class PlanBudget:
    """Tracks cumulative budget across all developers in a single plan lane."""

    def __init__(self, limit: int = PLAN_BUDGET_LIMIT) -> None:
        self.used: int = 0
        self.limit: int = limit

    def add_dev_cost(self, tokens: int) -> dict[str, Any]:
        """Add a developer's token usage to the plan total."""
        self.used += tokens
        status = "ok" if self.used < self.limit else "exhausted"
        return {
            "status": status,
            "used": self.used,
            "remaining": max(0, self.limit - self.used),
            "message": (
                f"Plan budget: {self.used} / {self.limit} used."
                if status == "ok"
                else f"PLAN BUDGET EXHAUSTED: {self.used} / {self.limit}. Halting lane."
            ),
        }

    def check(self) -> dict[str, Any]:
        status = "ok" if self.used < self.limit else "exhausted"
        return {
            "status": status,
            "used": self.used,
            "remaining": max(0, self.limit - self.used),
        }


class SubtaskHandoffCap:
    """Enforces the per-subtask handoff cap (max 5 sequential devs)."""

    def __init__(self, cap: int = MAX_HANDOFFS_PER_SUBTASK) -> None:
        self.cap: int = cap
        self._counts: dict[str, int] = {}

    def increment(self, subtask_id: str) -> dict[str, Any]:
        self._counts[subtask_id] = self._counts.get(subtask_id, 0) + 1
        count = self._counts[subtask_id]
        status = "ok" if count <= self.cap else "exceeded"
        return {
            "subtask_id": subtask_id,
            "count": count,
            "cap": self.cap,
            "status": status,
            "message": (
                f"Subtask {subtask_id}: dev #{count} / {self.cap}."
                if status == "ok"
                else f"SUBTASK HANDOFF CAP EXCEEDED: {count} / {self.cap}. Escalate immediately."
            ),
        }

    def get(self, subtask_id: str) -> int:
        return self._counts.get(subtask_id, 0)
