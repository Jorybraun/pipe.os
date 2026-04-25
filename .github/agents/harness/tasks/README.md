# Pipe Swarm Task Spec Template

## How to Use

This directory contains task spec templates. Each template references the relevant
`knowledge/plan/` strategy document and tells the agent exactly what to do.

## Workflow

1. **I (orchestrator) read the strategy doc** from `knowledge/plan/`
2. **I fill in the task spec template** with specific files and criteria
3. **I spawn an agent via `sessions_spawn`** with the filled spec
4. **The agent reads the strategy doc, does the work, reports back**
5. **I monitor and report results to you**

## Task Spec Format

```
ROLE: [backend|frontend|architect|designer|pm|qa]
STRATEGY_DOC: knowledge/plan/[document].md
GOAL: One sentence describing what to achieve
FILES: [list of files to modify]
CRITERIA: [list of acceptance criteria]
CONTEXT: [any additional context]
```

## Rules for Agents
- Read the STRATEGY_DOC first. It is source of truth.
- Work in repo: /Users/hans/Code/PIPE/PIPE-OS
- Work on branch: claude-dev
- Run `npx tsc --noEmit` before finishing
- Do NOT commit. Leave changes unstaged.
- Report what you changed and why.
