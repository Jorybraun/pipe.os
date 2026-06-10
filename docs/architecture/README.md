# PIPE Autonomous Orchestrator Architecture

**Canonical diagram:** `operating-cadence.png` (attached 2026-06-05)

This is the target operating model for the 24/7 recursive planning + Kanban-orchestrated agent swarm.

## Key Components
- **User Planning** → Transcript → Meeting Coordinator (Decomposer Agent, Agents Agent, Planner)
- **Agent Registry** with validation before dispatch
- **Orchestrator** owning Task Queue, Agent Swarm, QA Swarm
- **Document Manager** (with explicit validation gate before any dispatch)
- **Operating Cadence**: daily standup → autonomous standup → agenda → decisions → document validation → daily digestion → progress evidence loop
- Feedback loops from execution back to planning context

## Document Validation Gate (Implemented)

Mandatory step before any dispatch or promotion to ready:

- Source provenance must be recorded (transcript, meeting, research artifact, or user input)
- Acceptance criteria section must be present and non-empty
- Evidence traceability / test plan section must be present for any UI or integration work
- Validation blocks dispatch if criteria are missing

This gate is now enforced in the operating cadence between "Agenda Items + Decisions" and "Daily Digestion".

## Agent Dispatch Validation Rules (Implemented)

Agent Registry enforces before any profile claims a card:
- Acceptance criteria present
- Chrome-devtools-mcp validation steps included when UI/browser involved (per kanban-chrome-validation skill)
- Document source linked
- No card reaches ready without these sections

Existing triage/todo cards will be audited on next specify pass.

## Integration Points
- Hermes Kanban is the Task Queue implementation (t_5b0f1b11 in progress)
- All work must pass Document Validation + Acceptance Criteria before dispatch to swarms
- Profiles: CEO, PM + Planner, Domain Architect, Decomposer, Document Agent, etc.

## Next Actions (decomposed to Kanban)
- Wire Kanban as the authoritative Task Queue (t_5b0f1b11)
- Persist daily standup / digestion artifacts into the graph

**Last Updated:** 2026-06-05 (validation gates implemented per t_337f1a3f + t_45edbae0; tasks promoted to todo)