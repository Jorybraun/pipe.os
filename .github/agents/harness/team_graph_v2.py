from typing import Literal, Callable
from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.types import Command
import operator
from typing import Annotated

# ============================================================================
# Pipe Swarm v2 — Frontend/Backend split + Designer + User Approval Gate
# ============================================================================

# Designer works with the Orchestrator (main agent) to create designs.
# The Orchestrator presents designs to the user for red/green approval.
# No task proceeds without user approval.

team_members = ["architect", "frontend", "backend", "designer"]

class SwarmState(TeamState):
    """Extended state with approval gate tracking."""
    # approval_status tracks user decisions at each gate
    # "pending" → waiting for user
    # "approved" → proceed
    # "rejected" → stop / revise
    design_approved: str = "pending"  # Gate 1: Design review
    architecture_approved: str = "pending"  # Gate 2: Architecture review
    implementation_approved: str = "pending"  # Gate 3: Final PR review
    # Track which agents have completed their work
    completed_agents: Annotated[list[str], operator.add] = []


# ============================================================================
# Agent System Prompts
# ============================================================================

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
# Agent Node Functions
# ============================================================================

def designer_node(state: SwarmState) -> Command[Literal["orchestrator"]]:
    """Designer creates design spec. Returns to orchestrator for user approval."""
    design_task = state.messages[-1].content if state.messages else "No design task provided"
    
    design_messages = [
        SystemMessage(content=DESIGNER_SYSTEM_PROMPT),
        HumanMessage(content=design_task)
    ]
    
    design_output = llm.invoke(design_messages)
    
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
    
    arch_messages = [
        SystemMessage(content=ARCHITECT_SYSTEM_PROMPT),
        HumanMessage(content=arch_task)
    ]
    
    arch_output = llm.invoke(arch_messages)
    
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
    
    fe_messages = [
        SystemMessage(content=FRONTEND_SYSTEM_PROMPT),
        HumanMessage(content=fe_task)
    ]
    
    fe_output = llm.invoke(fe_messages)
    
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
    
    be_messages = [
        SystemMessage(content=BACKEND_SYSTEM_PROMPT),
        HumanMessage(content=be_task)
    ]
    
    be_output = llm.invoke(be_messages)
    
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

def build_pipe_swarm() -> StateGraph:
    """Build the Pipe development swarm with user approval gates."""
    graph = StateGraph(SwarmState)
    
    # Add nodes
    graph.add_node("designer", designer_node)
    graph.add_node("architect", architect_node)
    graph.add_node("frontend", frontend_node)
    graph.add_node("backend", backend_node)
    
    # Orchestrator is external (the main agent / user)
    # Agents always return to orchestrator for approval
    
    return graph.compile()
