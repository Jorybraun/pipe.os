# BRIEF: Rewrite Role Discovery Prompts (Task B)

## Context

Read `docs/project-brief.md` and `.claude/rules/terminology.md` first.

The role discovery agent currently:
- Probes too deep into irrelevant situations
- Asks questions that don't surface actionable insights
- Produces a flat `CandidatePersona` (8 fields) instead of a rich Role Context Document

## Goal

Rewrite the role discovery agent so it produces a structured **Role Context Document** with three sections:

1. **Team Context** — values, working style, psychological safety, review culture, communication norms, growth expectations
2. **Technical Context** — stack, architecture, quality standards, code review culture, testing practices
3. **Dispositional Context** — what "senior" means on this team, ownership expectations, autonomy level, mentorship dynamics

## Research anchor

See `knowledge/outputs/role-discovery-data-contract.md` (ADR-036). The primary artifact must be a **depth-preserving matrix** with laddering chains (`attribute_quote` → `consequence` → `value`). The old flat `CandidatePersona` is a derived consumer slice, not the source of truth.

## What to change

### 1. Prompt engineering
- `workers/api/src/prompts/role-discovery.ts` (or wherever the discovery prompt lives)
- Replace the open-ended "tell me about problems you've faced" questions with **calibrated probes**:
  - "Describe a recent code review that sparked disagreement. How was it resolved?" → reveals review culture + communication norms
  - "When a production incident happens, what does the team do first?" → reveals psychological safety + ownership
  - "How do you prefer to give feedback to a peer?" → reveals directness + mentorship style
  - "What does 'done' mean for a PR on your team?" → reveals quality standards

### 2. Synthesis layer
- After the interview, the synthesis prompt must map responses into the matrix format, not flatten into 8 fields.
- Preserve direct quotes as evidence. Every claim in the Role Context Document must be traceable to a recruiter quote.

### 3. Validation / calibration loop
- Implement a `calibration_review` step: recruiter sees the generated Role Context Document and can flag "that's not quite right" or "add X."
- The agent should ask clarifying questions only for gaps, not re-interview from scratch.

## Acceptance criteria

1. A recruiter can complete role discovery in ≤ 5 minutes (≤ 6 questions).
2. The output contains all three sections (Team, Technical, Dispositional) with ≥ 3 evidence-backed attributes per section.
3. No lossy flattening into `mustHaveSkills` as the primary artifact.
4. The existing `CandidatePersona` is generated as a **derived slice** from the Role Context Document for backward compatibility.
5. `CHANGELOG.md` updated.
