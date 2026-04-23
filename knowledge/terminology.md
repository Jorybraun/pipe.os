---
status: canonical
owner: founder
updated: 2026-04-22
---

# PIPE — Terminology & Domain Language

This document is the single source of truth for domain language across the PIPE codebase. Use these terms exactly. Do not interchange them.

## Glossary

| Term | Definition | What it is NOT |
|------|-----------|--------------|
| **Pipeline** | A sequence of stages that defines a complete interview for one role. Owned by a recruiter. | Not a "job" or "requisition" |
| **Stage** | A phase of the interview process. Has a type, an order, and a mode (async or live). Contains challenges. | Not a "step" or "round" |
| **Challenge** | The smallest unit of assessment. A single task a candidate performs. Has a type and config. Lives inside a stage. | Not a "question" (questions are inside challenges) |
| **Stage Type** | The category of a stage: `SCREENING`, `CULTURAL`, `CODE_REVIEW`, `OPEN_SOURCE`, `LIVE_PANEL` | Not `AI_COLLAB`, `PLANNING`, `VOICE`, `INGESTION`, `TECHNICAL`, `QUESTIONS` — these are deprecated or merged |
| **Challenge Type** | The runtime type of a challenge: `CODE_REVIEW`, `CODE_IMPLEMENTATION`, `QUIZ_MCQ`, `QUIZ_SHORT_ANSWER`, `FOLLOW_UP` | Not a stage type |
| **Assessment** | The record of one candidate's progress through one stage. One per (candidate × stage). | Not the whole pipeline |
| **Submission** | The candidate's response to one challenge. One per (candidate × challenge). | Not the assessment |
| **Role Discovery** | The AI interview of the recruiter/hiring manager that produces a structured Role Context Document. The source of truth for pipeline generation. | Not "pipeline creation" and not "job description parsing" |
| **Role Context Document** | Structured output from Role Discovery. Sections: Team Context, Technical Context, Dispositional Context. Consumed by downstream agents. | Not a flat persona or a JSON blob of keywords |
| **Culture Interview** | The AI-conducted behavioral interview. FSM-driven. Uses STAR questions from a curated bank. Scored via multi-agent BARS rubrics. | Not a quiz or a challenge queue |
| **Code Review Session** | The multi-turn conversation where a candidate reviews a PR and an AI implementer pushes back. Stored in `review_sessions`. | Not a single `CODE_REVIEW` challenge rendered in the generic assessment flow |
| **Open Source Challenge** | The implementation stage where a candidate fixes a live open-source issue in a dev container. | Not "dev container sandbox" and not "coding challenge" |
| **Screening** | Async video response to pre-recorded questions. Candidate records, system stores. | Not a phone call (phone is a separate outreach feature, not a stage) |
| **Live Panel** | A video interview with real humans. Can be attached to any stage or as a final stage. Scheduled via external provider. | Not an AI stage |
| **Repo Triangulation** | Matching an open-source repo to both the role requirements and the candidate's background. Uses vector similarity + signal extraction. | Not a SQL keyword join |
| **Follow-up** | AI-generated questions asked after a code review session to probe understanding, trade-offs, and communication depth. | Not a separate stage |
| **Candidate Token** | The invite token (`invite_token` in DB). One-time use. Exchanged for a session JWT. | Not a user account or Clerk session |
| **Session JWT** | The bearer token issued after token resolution. Used for all candidate-facing RPC routes. | Not an API key |

## Deprecated Terms (do not use)

These terms exist in legacy code or old docs. Replace them when encountered:

- `AI_COLLAB` → delete
- `PLANNING` → delete
- `VOICE` as stage type → use `LIVE_PANEL` with `video: true`
- `INGESTION` as stage type → use `OPEN_SOURCE` or remove
- `TECHNICAL` / `QUESTIONS` → merged into `SCREENING` (async question-based filter)
- `VOICE_INTERVIEW` → `LIVE_PANEL`
- `AI_COLLABORATION_ASSESSMENT` → delete
- `SYSTEM_DESIGN_&_PLANNING` → delete

## Station

In the **repo-linkage** context, a **station** is a pipeline stage anchored on a GitHub repository. Only two stage types are stations: `CODE_REVIEW` and `OPEN_SOURCE` (a.k.a. `CODE_IMPLEMENTATION`). The term is borrowed from OSCE medical-education assessment design, where candidates rotate through timed skill-testing stations. In PIPE-OS the analogy is looser: a station is simply a repo-using stage.

> **Disambiguation:** "Station" also appears in research docs (`ADR-039`, `STRATEGY.md`) as part of the OSCE-style multi-station interview framing. This is the *source* of the term, not a separate meaning. In product code and UI, "station" is shorthand for the two repo-using stages.

See `knowledge/concepts/repo-linkage.md` for the full explanation of shared-repo vs. per-station linkage.

## Code Conventions

- DB column: `stage_type` (snake_case)
- TS type/enum: `StageType` (PascalCase)
- API validation: `STAGE_TYPES` array in `workers/api/src/validation/stages.ts`
- Frontend types: `StageType` in `src/lib/stageTemplates.ts`

## References

- Full project brief: `docs/project-brief.md`
- Stage type validation: `workers/api/src/validation/stages.ts`
- Challenge type validation: `workers/api/src/validation/stages.ts`
- DB schema: `workers/api/migrations/0001_create_pipelines.sql`, `0006_stage_config.sql`
