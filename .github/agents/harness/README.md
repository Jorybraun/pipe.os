# Software Engineering Team - Multi-Agent System

A multi-agent software engineering team built with Deep Agents + LangGraph Swarm.

## Team Structure

- **PM** - Project Manager: decomposes features, manages scope, approves merges
- **Architect** - Designs technical solutions, writes design docs
- **Developer** - Implements features, writes tests, uses git
- **QA** - Tests implementation, verifies against criteria, reports bugs

## Architecture

```
LangGraph Swarm (routing, memory, checkpointing)
    ├── PM Agent (Deep Agent + planning, file ops)
    ├── Architect Agent (Deep Agent + design tools)
    ├── Dev Agent (Deep Agent + git tools, shell)
    └── QA Agent (Deep Agent + test execution)
```

## Usage

```bash
# Set model (optional, defaults to openai:gpt-4o)
export TEAM_MODEL="openai:gpt-4o"

# Set repo path (optional, defaults to current directory)
export REPO_PATH="/path/to/your/repo"

# Run a feature
python -m team.orchestrator "Add user authentication with JWT tokens"

# With custom thread ID for persistence
python -m team.orchestrator "Add user authentication" --thread-id "auth-feature-1"
```

## Integration with Kimi Claw

This system is designed to be managed by Kimi Claw. Kimi Claw spawns subagents,
monitors progress, and handles human-in-the-loop approvals.

## Files

- `team_graph.py` - Swarm graph definition with all agents
- `git_tools.py` - Shared git operations for Dev and PM
- `orchestrator.py` - Entry point for running features
