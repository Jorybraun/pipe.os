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
