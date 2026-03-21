# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for Pipe.

An ADR documents a significant architectural or technical decision: what was decided, why, what alternatives were considered, and what consequences follow. Writing it down while the context is fresh prevents future confusion about "why did we do it this way?"

---

## When to write an ADR

Write one when you make a decision that:
- Is hard to reverse (schema changes, third-party choices, auth model)
- Has meaningful alternatives that were considered and rejected
- Someone will wonder about in 6 months
- Affects multiple parts of the system

You do **not** need an ADR for every feature decision — only ones with architectural weight.

---

## How to write an ADR

1. Copy `ADR-000-template.md` to `ADR-NNN-short-title.md` (use the next number in sequence)
2. Fill in all sections
3. Set status to `Proposed`, then `Accepted` once decided
4. Add it to the index below
5. Reference it in `CHANGELOG.md` if the decision drives a commit

---

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [ADR-001](ADR-001-amplify-gen2-backend.md) | Use AWS Amplify Gen 2 as backend platform | Accepted | 2025-12-26 |
| [ADR-002](ADR-002-challenge-architecture.md) | Stage = container, Challenge = atomic unit | Accepted | 2026-02-26 |
| [ADR-003](ADR-003-assessment-fk-strategy.md) | Assessment holds both stageId and challengeId | Accepted | 2026-02-26 |
| [ADR-004](ADR-004-static-challenge-library.md) | Static TypeScript files for challenge library at MVP | Accepted | 2026-02-27 |
| [ADR-005](ADR-005-composable-challenge-system.md) | Composable Shell + Panel challenge architecture | Accepted | 2026-02-27 |
| [ADR-006](ADR-006-submission-type-system.md) | Discriminated union for challenge submission types | Accepted | 2026-02-27 |
| [ADR-007](ADR-007-ground-truth-sanitization.md) | Server-side ground truth sanitization via scoringAgent Lambda | Proposed | 2026-02-27 |
| [ADR-008](ADR-008-voice-input-transcription.md) | Voice Input & Transcription Architecture | Proposed | 2026-02-27 |
| [ADR-009](ADR-009-server-side-scoring.md) | Unified scoringAgent pattern for automated scoring | Accepted | 2026-02-27 |
| [ADR-010](ADR-010-database-driven-challenge-library.md) | Database-Driven Challenge Library & Template System | Accepted | 2026-02-27 |
| [ADR-011](ADR-011-video-interview-webrtc.md) | WebRTC + AppSync signaling for live video interviews | Proposed | 2026-02-28 |
| [ADR-012](ADR-012-challenge-studio-editor-architecture.md) | Challenge Studio editor architecture (`resolveEditorLayout`) | Accepted | 2026-02-28 |
| [ADR-013](ADR-013-interview-scheduling-architecture.md) | Interview Scheduling provider architecture (`resolveSchedulingProvider`) | Accepted | 2026-02-28 |
| [ADR-014](ADR-014-scheduling-ioc-plugin-registry.md) | Scheduling IoC: Plugin Registry + Webhook Automation | Proposed | 2026-03-01 |
| [ADR-015](ADR-015-adaptive-notification-engine.md) | Adaptive Notification Engine | Proposed | 2026-03-01 |
| [ADR-016](ADR-016-dev-container-architecture.md) | Dev Container Architecture — ECS Fargate + AppSync Real-Time Status | Accepted | 2026-03-06 |
| [ADR-017](ADR-017-dev-container-egress-hardening.md) | Dev Container Network Egress Hardening | Proposed | 2026-03-07 |
| [ADR-018](ADR-018-dev-container-access-control.md) | Dev Container Access Control | Proposed | 2026-03-09 |
| [ADR-019](ADR-019-github-pr-integration.md) | GitHub PR Integration for Code Review Challenges | Accepted | 2026-03-13 |
| [ADR-020](ADR-020-follow-up-agent-architecture.md) | Follow-Up Question Agent — async, 5 SHORT_ANSWER questions per CODE_REVIEW | Accepted | 2026-03-20 |
| [ADR-021](ADR-021-deterministic-code-review-scoring.md) | Deterministic algorithm for CODE_REVIEW scoring (no LLM) | Accepted | 2026-03-20 |
