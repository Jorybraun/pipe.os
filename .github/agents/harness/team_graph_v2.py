from typing import Literal, Callable, Optional
from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.types import Command
import operator
from typing import Annotated, List

# Import telemetry for agent communication
import sys
from pathlib import Path
HARNESS_DIR = Path(__file__).parent
sys.path.insert(0, str(HARNESS_DIR))
from telemetry import Telemetry, TaskSpec, TaskStatus

# TeamState base class (minimal version for Pipe swarm)
class TeamState:
    messages: List = []
    next: str = ""

# ============================================================================
# Pipe Swarm v2 — PM + Designer + Frontend/Backend + Architect + Approval Gates
# ============================================================================

team_members = ["pm", "designer", "architect", "frontend", "backend"]

class SwarmState(TeamState):
    """Extended state with approval gate tracking and telemetry."""
    # approval_status tracks user decisions at each gate
    # "pending" → waiting for user
    # "approved" → proceed
    # "rejected" → stop / revise
    pm_approved: str = "pending"      # Gate 0.5: PM plan review
    design_approved: str = "pending"  # Gate 1: Design review
    architecture_approved: str = "pending"  # Gate 2: Architecture review
    implementation_approved: str = "pending"  # Gate 3: Final PR review
    # Track which agents have completed their work
    completed_agents: Annotated[list[str], operator.add] = []
    # Telemetry reference
    telemetry_dir: str = str(HARNESS_DIR / ".swarm")
    task_id: str = ""


# ============================================================================
# Agent System Prompts
# ============================================================================

PM_SYSTEM_PROMPT = """You are the **Project Manager** for Pipe.

Your job is to decompose incoming tasks into concrete, executable subtasks before any design or code is written.

You produce:
- Task decomposition with: task name, acceptance criteria (3-5 bullet points), files to touch, expected test outcome
- Dependency graph between subtasks (what must happen before what)
- Risk flags and assumptions that need validation
- ADR requirements for any structural decisions

Rules:
- Keep decomposition under 10 subtasks
- Each subtask must have clear acceptance criteria
- Flag tasks that need design review vs. architecture review vs. direct implementation
- Reference the project goals from the strategy document
- If a task is unclear, ask clarifying questions before decomposing
"""

DESIGNER_SYSTEM_PROMPT = """You are the **UI/UX Designer** for Pipe.

Your job is to create design specifications for new features or changes.
You produce:
- Visual layout descriptions (wireframe-level, not pixel-perfect)
- Component usage from the existing design system
- Color/badge specifications
- Interaction flows
- Mobile considerations if applicable

Design System Primitives:
- LiquidMetalCard — primary content container
- FieldGroup — form field grouping
- TextInput — text inputs
- Challenge badges: CODE_REVIEW=blue #60a5fa, CODE_IMPLEMENTATION=purple #a78bfa, QUIZ_MCQ=green #4ade80, QUIZ_SHORT_ANSWER=amber #fbbf24

Rules:
- Use ONLY existing primitives. Do not invent new UI components.
- Specify Tailwind classes where helpful.
- Keep descriptions concise and implementable.
- Reference `docs/design/design-system.md` for full inventory.
"""

ARCHITECT_SYSTEM_PROMPT = """You are the **System Architect** for Pipe.

Your job is to design technical solutions before any code is written.
You produce:
- Data model changes (with schema decisions)
- API contract definitions
- File structure recommendations
- Integration points with existing systems
- ADR recommendations if the change is architecturally significant

Rules:
- Read existing code in the target area before designing.
- Prefer extending existing patterns over introducing new ones.
- If schema changes are needed, note the ADR requirement.
- Explicit return types on all interfaces.
- No `any` types.
"""

FRONTEND_SYSTEM_PROMPT = """You are the **Frontend Developer** for Pipe.

Your job is to implement React/TypeScript UI components and pages.
You produce:
- React components with explicit TypeScript interfaces
- Hooks for data fetching and state management
- Proper error handling (if (errors) throw new Error(errors[0].message))
- Storybook-style usage examples if helpful

Rules:
- TypeScript strict mode — no `any`.
- Named exports only (except page components).
- Explicit return types on all exported functions.
- Use existing design system primitives only.
- `npx tsc --noEmit` must pass.
- Hooks go in `src/hooks/`, pages in `src/pages/`, components in `src/components/`.
"""

BACKEND_SYSTEM_PROMPT = """You are the **Backend Developer** for Pipe.

Your job is to implement server-side logic: Lambdas, API routes, data models, and integrations.
You produce:
- Lambda handlers with proper TypeScript types
- Database schema changes (DynamoDB/AppSync)
- API route handlers with validation
- Integration code for external services

Rules:
- TypeScript strict mode — no `any`.
- Named exports only.
- Explicit return types.
- Follow the `questionAgent` Lambda pattern: handler.ts, types.ts, prompts.ts, validation.ts, costTracker.ts.
- Update `CHANGELOG.md` under [Unreleased].
- Significant architectural changes require an ADR.
"""


# ============================================================================
# Telemetry Helpers
# ============================================================================

def get_telemetry(state: SwarmState) -> Telemetry:
    """Get or create telemetry instance for this swarm run."""
    return Telemetry(state.telemetry_dir, task_id=state.task_id)


def emit_agent_start(state: SwarmState, role: str, task: str):
    """Emit telemetry event when an agent starts work."""
    telem = get_telemetry(state)
    telem.emit("agent_assigned", {
        "role": role,
        "task": task[:200],
        "phase": state.next if hasattr(state, 'next') else "unknown"
    })
    # Also dispatch to mailbox
    task_spec = TaskSpec(
        task_id=f"{role}_{int(__import__('time').time())}",
        role=role,
        description=task,
        context={"phase": state.next if hasattr(state, 'next') else "unknown"}
    )
    telem.dispatch_task(role, task_spec)


def emit_agent_complete(state: SwarmState, role: str, output: str):
    """Emit telemetry event when an agent completes work."""
    telem = get_telemetry(state)
    telem.emit("agent_completed", {
        "role": role,
        "output_length": len(output),
        "completed_agents": state.completed_agents
    })
    # Complete the mailbox
    from telemetry import CompletionReport
    report = CompletionReport(
        success=True,
        summary=output[:5000],
        changed_files=[],
        test_results={},
        errors=[]
    )
    telem.complete_task(role, report)


def emit_handoff(state: SwarmState, from_role: str, to_role: str, context: dict = None):
    """Emit telemetry event for agent-to-agent handoff."""
    telem = get_telemetry(state)
    telem.emit("handoff", {
        "from": from_role,
        "to": to_role,
        "context": context or {}
    })


# ============================================================================
# Agent Node Functions
# ============================================================================

def pm_node(state: SwarmState) -> Command[Literal["orchestrator"]]:
    """PM decomposes task into subtasks. Returns to orchestrator for user approval."""
    pm_task = state.messages[-1].content if state.messages else "No task provided"
    
    emit_agent_start(state, "pm", pm_task)
    
    pm_messages = [
        SystemMessage(content=PM_SYSTEM_PROMPT),
        HumanMessage(content=pm_task)
    ]
    
    # In a real deployment, this would call an LLM
    # For the harness, we write the task spec and let the orchestrator dispatch
    pm_output = f"""# Task Decomposition

## Task
{pm_task}

## Subtasks
1. **Analysis** — Understand existing code and requirements
2. **Design** — Create UI/UX specification (if frontend needed)
3. **Architecture** — Design data model and API contracts (if backend needed)
4. **Implementation** — Write code following design and architecture specs
5. **QA** — Run type checks, lint, and tests
6. **Review** — Present for user approval

## Dependencies
- Design depends on Analysis
- Architecture depends on Analysis
- Implementation depends on Design + Architecture
- QA depends on Implementation

## Risks
- Ensure no `any` types in new code
- Verify all named exports (except page components)
- Check CHANGELOG.md is updated
"""
    
    emit_agent_complete(state, "pm", pm_output)
    
    return Command(
        update={
            "messages": [HumanMessage(content=pm_output)],
            "next": "orchestrator",
            "completed_agents": ["pm"]
        },
        goto="orchestrator"
    )


def designer_node(state: SwarmState) -> Command[Literal["orchestrator"]]:
    """Designer creates design spec. Returns to orchestrator for user approval."""
    design_task = state.messages[-1].content if state.messages else "No design task provided"
    
    emit_agent_start(state, "designer", design_task)
    
    design_messages = [
        SystemMessage(content=DESIGNER_SYSTEM_PROMPT),
        HumanMessage(content=design_task)
    ]
    
    design_output = llm.invoke(design_messages)
    
    emit_agent_complete(state, "designer", design_output.content if hasattr(design_output, 'content') else str(design_output))
    
    return Command(
        update={
            "messages": [design_output],
            "next": "orchestrator",
            "completed_agents": ["designer"]
        },
        goto="orchestrator"
    )


def architect_node(state: SwarmState) -> Command[Literal["orchestrator"]]:
    """Architect designs technical solution. Returns to orchestrator for approval."""
    arch_task = state.messages[-1].content if state.messages else "No architecture task provided"
    
    emit_agent_start(state, "architect", arch_task)
    
    arch_messages = [
        SystemMessage(content=ARCHITECT_SYSTEM_PROMPT),
        HumanMessage(content=arch_task)
    ]
    
    arch_output = llm.invoke(arch_messages)
    
    emit_agent_complete(state, "architect", arch_output.content if hasattr(arch_output, 'content') else str(arch_output))
    
    return Command(
        update={
            "messages": [arch_output],
            "next": "orchestrator",
            "completed_agents": ["architect"]
        },
        goto="orchestrator"
    )


def frontend_node(state: SwarmState) -> Command[Literal["orchestrator"]]:
    """Frontend developer implements UI. Returns to orchestrator for review."""
    fe_task = state.messages[-1].content if state.messages else "No frontend task provided"
    
    emit_agent_start(state, "frontend", fe_task)
    
    fe_messages = [
        SystemMessage(content=FRONTEND_SYSTEM_PROMPT),
        HumanMessage(content=fe_task)
    ]
    
    fe_output = llm.invoke(fe_messages)
    
    emit_agent_complete(state, "frontend", fe_output.content if hasattr(fe_output, 'content') else str(fe_output))
    
    return Command(
        update={
            "messages": [fe_output],
            "next": "orchestrator",
            "completed_agents": ["frontend"]
        },
        goto="orchestrator"
    )


def backend_node(state: SwarmState) -> Command[Literal["orchestrator"]]:
    """Backend developer implements server logic. Returns to orchestrator for review."""
    be_task = state.messages[-1].content if state.messages else "No backend task provided"
    
    emit_agent_start(state, "backend", be_task)
    
    be_messages = [
        SystemMessage(content=BACKEND_SYSTEM_PROMPT),
        HumanMessage(content=be_task)
    ]
    
    be_output = llm.invoke(be_messages)
    
    emit_agent_complete(state, "backend", be_output.content if hasattr(be_output, 'content') else str(be_output))
    
    return Command(
        update={
            "messages": [be_output],
            "next": "orchestrator",
            "completed_agents": ["backend"]
        },
        goto="orchestrator"
    )


# ============================================================================
# Build the Graph
# ============================================================================

def build_pipe_swarm(task_id: str = "", telemetry_dir: str = None) -> StateGraph:
    """Build the Pipe development swarm with user approval gates and telemetry."""
    graph = StateGraph(SwarmState)
    
    # Add nodes
    graph.add_node("pm", pm_node)
    graph.add_node("designer", designer_node)
    graph.add_node("architect", architect_node)
    graph.add_node("frontend", frontend_node)
    graph.add_node("backend", backend_node)
    
    # Orchestrator is external (the main agent / user)
    # Agents always return to orchestrator for approval
    
    return graph.compile()


if __name__ == "__main__":
    # Quick test
    swarm = build_pipe_swarm()
    print("Pipe Swarm v2 built successfully.")
    print(f"Team members: {team_members}")
    print("Note: orchestrator node is external — agents return to orchestrator for approval.")
