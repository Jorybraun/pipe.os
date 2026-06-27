# Assessment Layer Agent Coordination

**Date:** 2026-06-27
**Active PR:** https://github.com/Jorybraun/pipe.os/pull/104
**Purpose:** Keep parallel agents aligned while building the PIPE-OS assessment layer and 95 Until Infinity runtime.

This document is an ownership and integration contract, not a personal todo list.
Update it only when lanes, interfaces, or merge rules change.

## North Star

PIPE-OS is building a source-backed assessment layer. The 95 Until Infinity room,
standard video room, code review flow, dev container, chat, transcript pipeline,
and Clippy/Devin interactions are evidence-producing surfaces.

The assessment layer is the durable system underneath them. It captures candidate
reasoning, communication, AI/tool usage, code changes, tests, transcripts, and
final submissions as immutable evidence. It can only produce positive evaluation
claims when those claims cite exact source evidence.

## Non-Negotiables

- No fake Devin, fake Clippy, simulated AI developer, or mocked assessment claims.
- If the AI provider is unavailable, record `AI_DEVELOPER_UNAVAILABLE`.
- No positive evaluation claim without source refs.
- No embedding-only match or generic fallback challenge.
- Candidate-facing clients receive invite/session tokens, not internal IDs.
- Server-only rubrics, planted bugs, and expected solutions stay server-side.

## Agent A Lane: 95 Runtime And Mode Routing

Agent A owns the live interview surface and mode-routing seam.

Primary responsibilities:

- Keep standard video room and 95 room usable in `app-dev.hire-app.com`.
- Maintain room synchronization, shared state, chat, mouse presence, recording,
  transcription, and dev-container launch behavior.
- Keep `OPEN_SOURCE_BUG_FIX` selectable and routable as an assessment mode.
- Ensure app-dev deployment stays continuously testable.

Files Agent A may edit:

- `src/components/Scheduling/*`
- `src/lib/scheduling/types.ts`
- `src/pages/InterviewDetailPage.tsx`
- `workers/api/src/routes/cockpit/scheduling.ts`
- `workers/api/src/routes/cockpit/candidates.ts`
- `workers/api/src/routes/meetingRooms.ts`
- `workers/api/src/routes/assessment/devContainer.ts`
- `workers/api/src/routes/rpc.ts`
- video-room app files under `apps/video-room/`

Agent A should not create the assessment-layer data model unless explicitly
taking over Agent B's lane.

## Agent B Lane: Assessment Layer Event Spine

Agent B owns the backend assessment substrate.

Primary responsibilities:

- Create `RepoTaskInterviewSession` and assessment event storage.
- Persist candidate/recruiter/AI/dev-container events with source refs.
- Enforce state transitions for repo-task assessments.
- Build tests proving unsupported claims remain diagnostics.
- Integrate with `FinalRepoTaskAssessmentOutput` without emitting fake scores.

Preferred files for Agent B:

- `workers/api/migrations/0102_repo_task_interview_sessions.sql`
- `workers/api/src/lib/repoTaskInterviewSession.ts`
- `workers/api/src/routes/assessment/repoTaskSessions.ts`
- `workers/api/src/routes/assessment/__tests__/repoTaskSessions.test.ts`
- `docs/plans/95-until-infinity-repo-task-interview-session.md`

Agent B should not edit Agent A's routing/runtime files unless coordination is
recorded here first.

## Integration Contract

Agent A provides:

- `scheduled_interviews.interview_type = 'OPEN_SOURCE_BUG_FIX'`
- assessment invite routing through `/assess/:token`
- candidate assessment challenge delivery
- workspace-backed meeting-room provisioning
- dev-container launch support for standalone repo-task invites

Agent B provides:

- a session id linked to scheduled interview/candidate/person context
- append-only assessment events with source refs
- state transition APIs
- diagnostics for missing evidence or unavailable AI
- final submission bundle readiness signal

Expected handoff shape:

```text
OPEN_SOURCE_BUG_FIX scheduled interview
  -> assessment session
  -> source-backed events
  -> final submission bundle
  -> evidence hypergraph projection
  -> source-backed evaluation output
```

## Branch And Merge Protocol

- Start from latest pushed `codex/video-room-paint-recording-fixes` or PR #104.
- Prefer separate branches for parallel work.
- Do not edit another agent's owned files without first adding a short note to
  this document under "Coordination Notes".
- Before asking for merge, run:
  - `npx tsc --noEmit`
  - focused Vitest/API tests for touched routes
  - `git diff --check`
- Every source behavior change updates `CHANGELOG.md`.
- Every schema/architecture change updates the relevant plan doc.

## Coordination Notes

- 2026-06-27: `OPEN_SOURCE_BUG_FIX` is implemented as a mode-routing seam. The
  full assessment session/event spine remains unbuilt and belongs to Agent B.
