#!/usr/bin/env python3
"""
Team Graph - Multi-agent software engineering team using Deep Agents + LangGraph Swarm.
"""

import os
from typing import Optional

from langgraph_swarm import create_swarm, create_handoff_tool
from langgraph.checkpoint.memory import InMemorySaver
from langchain.chat_models import init_chat_model
from deepagents import create_deep_agent

# Default model - can be overridden via env var
MODEL_NAME = os.getenv("TEAM_MODEL", "openai:gpt-4o")


def create_team(model=None):
    """Create the full software engineering team swarm.
    
    Returns a compiled LangGraph app that can be invoked with messages.
    """
    if model is None:
        model = init_chat_model(MODEL_NAME)
    
    # Handoff tools - each role can hand off to specific other roles
    handoff_to_architect = create_handoff_tool(
        agent_name="architect",
        description="Transfer to Architect for technical design and architecture decisions."
    )
    
    handoff_to_dev = create_handoff_tool(
        agent_name="dev",
        description="Transfer to Developer for implementation."
    )
    
    handoff_to_qa = create_handoff_tool(
        agent_name="qa",
        description="Transfer to QA for testing and verification."
    )
    
    handoff_to_pm = create_handoff_tool(
        agent_name="pm",
        description="Transfer to PM for project management, scope decisions, and merge approval."
    )
    
    # PM Agent - owns task decomposition and orchestration
    pm_agent = create_deep_agent(
        model=model,
        system_prompt="""You are the Project Manager (PM) of a software engineering team.

Your responsibilities:
1. Decompose high-level features into atomic, actionable tasks
2. Write clear acceptance criteria for each task
3. Track task progress and dependencies
4. Approve or reject merge requests based on QA results
5. Escalate scope questions to the user

Rules:
- Always write a todo list before handing off to Architect
- Review QA reports before approving merges
- If a task is unclear, ask for clarification before proceeding
- Keep task descriptions under 200 tokens

You can hand off to: Architect (for design), QA (for review of completed work)""",
        tools=[handoff_to_architect, handoff_to_qa],
        name="pm"
    )
    
    # Architect Agent - owns design and technical decisions
    architect_agent = create_deep_agent(
        model=model,
        system_prompt="""You are the Software Architect of the team.

Your responsibilities:
1. Design technical solutions for tasks assigned by PM
2. Write design documents with data models, API contracts, and module boundaries
3. Answer technical questions from Developer
4. Identify risks and constraints

Rules:
- Read existing code before designing
- Keep designs pragmatic, not over-engineered
- Use the write_file tool to save design docs to the design/ directory
- If you need clarification on requirements, hand off to PM

You can hand off to: PM (for clarification), Dev (for implementation)""",
        tools=[handoff_to_pm, handoff_to_dev],
        name="architect"
    )
    
    # Developer Agent - owns implementation
    dev_agent = create_deep_agent(
        model=model,
        system_prompt="""You are the Software Developer of the team.

Your responsibilities:
1. Implement features according to the Architect's design
2. Write clean, tested code
3. Run tests and fix issues
4. Ask the Architect for clarification when the design is ambiguous

Rules:
- Follow the design document provided by Architect
- Write tests alongside implementation code
- Use git: create feature branches, commit frequently with clear messages
- Run the test suite before handing off to QA
- If tests fail, fix them or escalate to Architect if the design is wrong

You can hand off to: Architect (for design questions), QA (for testing)""",
        tools=[handoff_to_architect, handoff_to_qa],
        name="dev"
    )
    
    # QA Agent - owns testing and verification
    qa_agent = create_deep_agent(
        model=model,
        system_prompt="""You are the QA Engineer of the team.

Your responsibilities:
1. Review implemented code against acceptance criteria
2. Run the test suite and verify all tests pass
3. Perform edge case analysis
4. Write bug reports with reproduction steps

Rules:
- Be thorough but not pedantic
- Focus on correctness, not style (unless style affects correctness)
- If you find bugs, write a detailed bug report and hand off back to Dev
- If all tests pass and code meets criteria, hand off to PM for merge approval
- Use the execute tool to run tests

You can hand off to: Dev (if bugs found), PM (if approved for merge)""",
        tools=[handoff_to_dev, handoff_to_pm],
        name="qa"
    )
    
    # Build the swarm graph
    workflow = create_swarm(
        agents=[pm_agent, architect_agent, dev_agent, qa_agent],
        default_active_agent="pm"
    )
    
    # Compile with checkpointing for persistence
    checkpointer = InMemorySaver()
    app = workflow.compile(checkpointer=checkpointer)
    
    return app


def run_feature(feature_request: str, thread_id: str = "feature-1"):
    """Run a feature through the team swarm.
    
    Args:
        feature_request: Description of the feature to build
        thread_id: Unique ID for this feature thread (for persistence)
        
    Returns:
        The final state from the swarm execution
    """
    app = create_team()
    
    config = {"configurable": {"thread_id": thread_id}}
    
    # Initial message from user to PM
    result = app.invoke(
        {
            "messages": [
                {"role": "user", "content": f"New feature request: {feature_request}"}
            ]
        },
        config
    )
    
    return result


if __name__ == "__main__":
    # Test with a simple feature
    import json
    result = run_feature("Add user authentication with JWT tokens")
    print(json.dumps(result, indent=2, default=str))
