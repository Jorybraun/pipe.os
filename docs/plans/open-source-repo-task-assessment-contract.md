# Open-Source Repo Task Assessment Contract

**Status:** Contract proposed; `OPEN_SOURCE_BUG_FIX` mode seam and assessment event spine implemented
**Date:** 2026-06-27  
**Contract file:** `workers/api/src/lib/assessmentEvidence.ts`

## Purpose

Define how PIPE selects and evaluates a real source-backed repo task or
open-source issue for a candidate using the Evidence Hypergraph.

This contract extends the current source-backed CODE_REVIEW matching work into
two later meeting/assessment modes:

- `DEV_CONTAINER_REPO_TASK`
- `OPEN_SOURCE_BUG_FIX`

The contract is intentionally strict. A match is valid only when the system can
connect candidate evidence, role/JD evidence when present, repo task evidence,
AI usage evidence, and final evaluation claims back to immutable source refs.

## Research And Repo Context Read

- `knowledge/plan/living-context-repo-matching-plan.md`
- `docs/plans/code-review-product-readiness.md`
- `workers/api/src/lib/challengeMatching/types.ts`
- `workers/api/src/lib/challengeMatching/d1Matcher.ts`
- `workers/api/src/lib/repoSemanticGraph/model.ts`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/wiki/hypergraphs.md`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/wiki/pipe-living-context-matching.md`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/conversation-transcripts/session-2026-06-19-pipe-living-context-decisions.md`

The controlling product rule remains:

> Nothing in the production matching path may be fabricated, inferred as a
> default, or silently substituted when source evidence is missing.

## Contract Invariants

- No fake matches: `MATCHED` requires a real `RepoTaskChallengePacket` with
  complete source provenance and `fixture: false`, `synthetic: false`.
- No simulated agents: AI developer, scoring, or evaluation activity must point
  to real `ai_usage_events`; missing providers return diagnostics.
- No fabricated skills or seniority: candidate claims are source-backed claims,
  not inferred labels. Seniority can be evaluated later only as a source-backed
  claim or diagnostic, not as a default.
- No embedding-only decisions: embeddings can recall or tie-break only after
  source-backed alignment exists. `CandidateRepoTaskAlignment.decisionBasis`
  excludes embeddings.
- Every positive claim links to evidence: `SourceBackedClaim` requires
  non-empty exact source refs and hyperedge ids.
- Insufficient evidence is first-class: non-matches return `AssessmentDiagnostic`
  records such as `MISSING_CANDIDATE_SOURCE_EVIDENCE`,
  `PROVENANCE_INCOMPLETE`, or `NO_ROLE_SAFE_CHALLENGE`.
- Candidate-facing packets never expose hidden ground truth. Server-only rubric
  and expected-solution refs stay in `serverOnlyEvaluationContext`.

## Flow

1. Compile `CandidateEvidencePacket`.
   - Read immutable resume/profile/transcript/public-source artifacts.
   - Build source-backed atoms from context records.
   - Keep mentions recall-only unless evidence reaches `demonstrated` or
     `validated`.

2. Build `RepoTaskChallengePacket`.
   - Use a real repo snapshot and issue/PR/source span.
   - Include demands, file refs, task source refs, quality gates, and
     hyperedges.
   - Reject fixture, synthetic, stale hash, missing issue/PR, or incomplete
     repo source-span provenance.

3. Produce `CandidateRepoTaskMatch`.
   - `MATCHED` requires source-backed alignments between candidate atoms and
     repo demands.
   - `NEEDS_MORE_EVIDENCE`, `NO_ROLE_SAFE_CHALLENGE`,
     `PROVENANCE_INCOMPLETE`, `AI_DEVELOPER_UNAVAILABLE`, and `NEEDS_REVIEW`
     are valid terminal planning states.
   - Persist the match run and source-backed context record exactly as current
     CODE_REVIEW matching does.

4. Create the later assessment/meeting.
   - `DEV_CONTAINER_REPO_TASK`: use the selected packet to provision a dev
     container task session later.
   - `OPEN_SOURCE_BUG_FIX`: use the selected issue/PR context to create an
     open-source bug-fix assessment later.
   - Meeting creation should accept only `MATCHED` packets or explicit
     diagnostics. It must not create a generic fallback repo task.

5. Evaluate final work.
   - `FinalRepoTaskAssessmentOutput` joins the match, submission refs, AI usage,
     dimensions, score narrative, and diagnostics.
   - Every positive evaluation dimension points to `SourceBackedClaim` records.
   - If the system lacks source-backed evidence for a dimension, the dimension
     records a diagnostic gap instead of awarding implied credit.

## Recruiter List Projection

- `GET /api/v1/scheduling/interviews` is a paged recruiter projection, not a
  full-history dump. It accepts `limit`, `offset`, and `sort`
  (`created_desc`, `created_asc`, or `scheduled_asc`) and returns pagination
  metadata with `total`, `hasMore`, and `nextOffset`.
- The list endpoint loads source-backed assessment progress only for the
  returned interview page. Detail views remain the place for full evidence
  audit trails, evaluation claims, and human-decision records.
- The dashboard must show loaded-versus-total counts so assessment filters do
  not imply unloaded history has been searched.

## Current Implementation Status

- CODE_REVIEW evidence-plan follow-up transcripts now publish concrete
  candidate-owned answer spans into the living-context graph as
  `code_review_evidence_plan_response` records with dynamic open-term concepts,
  so repo-match refreshes read the new source-backed evidence through the same
  candidate context path as resume/decomposition evidence.
- CODE_REVIEW repo-match refreshes now gate on those matcher-visible
  `code_review_evidence_plan_response` records, not only the assessment report
  status, so a captured follow-up answer cannot trigger a stale rerun until the
  candidate context projection exists.
- CODE_REVIEW interview detail now returns and renders related evidence
  interviews from the same person graph, so context calls and multiple
  same-email assessment invites stay visible as separate evidence-producing
  moments instead of collapsing into one meeting.
- `OPEN_SOURCE_BUG_FIX` is a first-class scheduled interview type.
- Scheduling and invite creation can create an assessment invite for the mode.
- Recruiter dashboard invite creation uses the packet-aware flow for
  `OPEN_SOURCE_BUG_FIX`; manual task assignment must carry repo URL, base
  commit, task, success criteria, and expected evidence instead of falling back
  to a generic quick-create invite.
- Candidate assessment routing currently serves it through the existing
  dev-container `CODE_IMPLEMENTATION` runtime.
- Meeting-room workspace provisioning treats it as a workspace-backed interview.
- Host room end now replays the authoritative Durable Object chat, media,
  recording, workspace, terminal, code-server, and agent activity logs into
  source-backed `meeting_session_event` evidence,
  so assessment-room interactions are captured as part of the interview lifecycle
  instead of only when a graph read is requested later.
- Shared host/guest room chat is recorded as human `chat_message` evidence,
  while AI agent bridge/Devin chat remains separately classified as `ai_chat_user` and
  `ai_chat_agent` evidence.
- Accepted mic/camera control toggles now replay from the Durable Object
  activity log as source-backed `media_control` evidence, preserving actor,
  surface, room phase, previous state, next state, and browser-control
  provenance across both standard and assessment-room surfaces.
- Browser chat sends are optimistic client submissions until the Durable Object
  acknowledges or rejects the exact message id. Client-side evidence marks
  those submissions as pending; the synced Durable Object chat activity log is
  the authoritative accepted-chat replay source.
- Candidate-opened external task, issue, docs, or repository links remain local
  browser actions. Assessment evidence should come from accepted room events,
  workspace telemetry, terminal/code activity, chat, transcript, AI bridge logs,
  and submitted commit/diff/test proof.
- Submitted commit proof must tie the commit URL back to the assigned
  repository or the candidate's declared fork. A GitHub commit URL from an
  unrelated repository is rejected even when the commit SHA, diff source ref, and
  source hashes are otherwise well-formed.
- Accepted guest join/leave and recording start/stop room lifecycle events now
  persist as source-backed `meeting_session_event` evidence, with recording
  stop captured only when recording evidence was actually active.
- Recording transcript segments now persist provider segment IDs plus
  speaker-metadata role/source fields on the meeting transcript row, source
  spans, and speaker attributions, so transcript-derived person evidence can
  reconstruct how host/guest stream channels produced speaker roles.
- Browser recording lifecycle events now include the observed speaker-channel
  map, ICE provider, MIME types, and captured byte counts, with host-end
  auto-stop and manual stop using the same source-backed event path.
- Standard-call and workspace-assessment rooms are selected by the scheduled
  interview mode. The room no longer carries an alternate presentation-mode
  toggle.
- Terminal panels now capture completed dev-container commands and bounded
  output chunks as source-backed `meeting_session_event` evidence with
  workspace session and repo metadata.
- Terminal output chunks now carry terminal session ids, command/output
  sequence ids, deterministic text fingerprints, and the active command id when
  known, so shell output can be reconstructed as evidence for the command that
  produced it.
- VS Code/code-server iframe loads now capture deduplicated `code_editor_open`
  `meeting_session_event` evidence with workspace session and repo metadata,
  without storing room-token proxy URLs.
- Workspace state events now persist dev-container diagnostics with workspace
  session id, status, repo context, TTL details, and error messages, while
  excluding room-token proxy paths from the evidence payload.
- AI assistant/Devin bridge status transitions now persist as source-backed
  `meeting_session_event` evidence, including real auth-required or
  disconnected states instead of simulated agent availability.
- AI agent bridge/Devin chat evidence distinguishes real Devin stdout from bridge
  diagnostics and file-watcher observations, preventing auth-required or
  container-observed facts from being projected as fabricated Devin replies.
- AI agent bridge/Devin room actions emitted from the real bridge stdout tag protocol
  now persist origin, bridge event type, action protocol, agent name, and
  browser execution role in `agent_action` evidence, so prompt-button actions
  and real agent-directed room actions remain separate.
- AI agent bridge/Devin process diagnostics now persist bounded and redacted bridge
  evidence for real stderr, context-primer failures, process exits, and startup
  errors, including diagnostic source, observed time, exit code, and signal
  metadata instead of leaving failures only in container logs.
- AI assistant/Devin bridge statuses and diagnostics now preserve direct exact-text
  `agent_status` / `agent_diagnostic` source refs in both
  living-context and assessment evidence, so auth, startup, prompt-handoff, and
  process-failure states can be cited without unpacking the broad session event.
- AI agent bridge/Devin context-primer and chat-prompt handoffs now persist
  `ai_agent_status` diagnostics when the bridge writes to real Devin stdin,
  including delivery state, room-context fetch status, and redacted
  fingerprints/lengths for prompt, room context, and candidate message without
  storing the private prompt body.
- The assessment-room AI assistant entrypoint remains recoverable after prompt
  dismissal or chat close, while its active state reflects the actual chat panel
  open/closed state rather than merely whether the assistant component is mounted.
- AI assistant/Devin bridge diagnostics, prompt handoffs, and real Devin stdout now
  post token-scoped `session-events` directly from the dev container before
  broadcasting to browsers. Browser evidence capture remains a fallback only
  when the bridge cannot persist, preventing duplicate graph events while
  preserving the visible chat/diagnostic stream.
- AI assistant/Devin bridge diagnostic, auth/status, room-action, and stdout fallback
  text is redacted before browser evidence, Durable Object broadcast/storage,
  or session-event persistence. Secret-bearing agent chat is rejected rather
  than rewriting fingerprinted source evidence.
- The container bridge applies the same redaction before WebSocket broadcasts
  and direct `session-events` writes, so bridge-origin response ids and lengths
  are derived from the stored redacted stdout rather than raw agent output.
- AI agent bridge/Devin room-action suggestions now persist directly from the bridge as
  `agent_action` events with `executionStatus: suggested`. Browser-side action
  execution remains separate `agent_action` evidence with
  `executionStatus: executed` and links back to the bridge suggestion metadata.
- Code-server workspace create/modify/delete events are now observed by the
  container bridge and persisted as source-backed `file_change`
  `meeting_session_event` evidence with path, content hash, file size, and a
  bounded text preview when the changed file is small and textual.
- Dev deployments allow the container bridge to post token-scoped
  `session-events` directly without the browser Basic Auth proxy, so app-dev can
  prove the same source-backed workspace evidence path used by production room
  token validation.
- Dev-container idle sleep, wake, and unexpected stop/error lifecycle hooks now
  update the canonical D1 session row before projection, so AI assistant availability,
  room workspace state, and assessment evidence reflect the real container
  lifecycle instead of a stale `READY` session.
- Standalone candidate dev-container launches now pass the same real Devin
  bridge configuration into the server-side container init payload without
  returning secrets to the browser, so AI assistant chat can only become available
  through the actual container bridge instead of a UI-only placeholder.
- Dev-container expiry/manual teardown now marks intentional container stops
  before destroy, so normal `EXPIRED` / `STOPPED` sessions do not retain false
  "container stopped unexpectedly" diagnostics in UI or assessment evidence
  projections.
- Meeting-room workspace launch now marks the dev-container session `ERROR`
  with a redacted diagnostic when the background Durable Object init request
  fails before the container can report status, so a broken workspace does not
  remain an indefinite `LAUNCHING` state.
- Standalone candidate dev-container launch now follows the same failure rule:
  if the background Durable Object init request throws or returns non-OK before
  the container can update its own row, the candidate-owned session is rechecked
  and marked `ERROR` with a bounded redacted diagnostic for UI and evidence
  projections.
- Workspace-state diagnostics are redacted before becoming browser evidence and
  again inside the VideoRoom Durable Object before broadcast/storage, so
  source-backed `WORKSPACE_STATE_CHANGED` events cannot preserve room tokens,
  Devin/Cognition tokens, API keys, bearer tokens, or secret query parameters.
- Stale/deprecated Workers AI candidate-discovery failures are now repairable by
  both room RPC refresh and the scheduled Worker: the retry reopens the original
  R2 text/PDF source, marks ingestion `retry_queued`, and reruns the normal
  source-backed candidate evidence pipeline instead of clearing errors or
  fabricating fallback match evidence. Retry queue/failure decisions also write
  append-only `session_events` entries with the trigger and original source ref
  so recovery itself is part of the evidence trail.
- The canonical assessment event spine now persists `assessment_sessions`,
  immutable evidence events with exact source refs, state transitions, and
  source-backed evaluation reports.
- Completed scored CODE_REVIEW sessions now write their final transcript and
  automated score report into the canonical assessment event spine as exact
  source-backed evidence, then project an evaluated assessment report.
- Dev-container workspace finalization can submit the live assessment-branch
  `HEAD` through the room evidence endpoint, but refuses dirty or untracked
  worktrees so uncommitted editor changes cannot be mistaken for submitted work.
- Candidate Submit Work now turns that dirty-worktree refusal into an explicit
  recovery path: inspect `git status --short`, add intended files, commit the
  assessment branch work, then retry live workspace finalization.
- `repo_task_interview_sessions` exists as a compatibility view over
  `assessment_sessions` so repo-task-specific routes can build on the common
  assessment substrate without duplicating event storage.
- Repo-task route/API integration, final evidence bundle assembly, and
  production `FinalRepoTaskAssessmentOutput` persistence from real assessment
  runs remain pending.

## Proposed TypeScript Surface

The proposed contract is implemented in
`workers/api/src/lib/assessmentEvidence.ts`:

- `AssessmentMode`
- `CandidateEvidencePacket`
- `RepoTaskChallengePacket`
- `CandidateRepoTaskMatch`
- `AiUsageEvidence`
- `AssessmentDiagnostic`
- `FinalRepoTaskAssessmentOutput`

The key type-level choice is a discriminated match union:

```ts
export type CandidateRepoTaskMatch =
  | MatchedCandidateRepoTaskMatch
  | DiagnosticCandidateRepoTaskMatch;
```

`MatchedCandidateRepoTaskMatch` requires non-empty alignments, selected source
claims, a source-backed candidate packet, and a production-ready repo task
packet. Diagnostic states require non-empty diagnostics instead.

## Diagnostics Policy

Diagnostics are not errors to hide from product surfaces. They are the product
state when evidence is not strong enough.

Required blocking diagnostics:

- `MISSING_CANDIDATE_SOURCE_EVIDENCE`
- `MISSING_ROLE_SOURCE_EVIDENCE`
- `MISSING_REPO_SOURCE_EVIDENCE`
- `MISSING_ISSUE_OR_PR_CONTEXT`
- `MISSING_REPO_TASK_PACKET`
- `PROVENANCE_INCOMPLETE`
- `EMBEDDING_ONLY_MATCH_REJECTED`
- `FABRICATED_OR_SYNTHETIC_SOURCE_REJECTED`
- `SIMULATED_AGENT_REJECTED`
- `NO_ROLE_SAFE_CHALLENGE`
- `AI_DEVELOPER_UNAVAILABLE`

## Implementation Plan

1. Wire the contract into the current CODE_REVIEW matcher as a compatibility
   adapter without changing candidate behavior.
2. Add BDD coverage proving a repo-task match cannot be returned when candidate
   source refs are missing.
3. Add BDD coverage proving a repo-task match cannot be returned when repo
   issue/PR source refs are missing.
4. Add BDD coverage proving embedding-only recall returns
   `EMBEDDING_ONLY_MATCH_REJECTED`.
5. Expand the initial `OPEN_SOURCE_BUG_FIX` meeting creation seam so matched
   repo-task assessments accept only `CandidateRepoTaskMatch` or explicit
   diagnostics.
6. Add final evaluation persistence using `FinalRepoTaskAssessmentOutput`
   against the canonical assessment event spine.
7. Add recruiter and candidate-safe views that separate selected evidence,
   diagnostics, AI usage, and server-only ground truth.

## Open Questions

- Whether `OPEN_SOURCE_BUG_FIX` should require an upstream issue that is still
  open at assessment creation time, or whether a historical fixed issue can be
  used when labelled as an assessment replay.
- Whether dev-container task quality gates should require executable tests for
  v1, or allow documentation/config tasks when source-backed acceptance criteria
  are strong enough.
- Whether final recommendations should stay four-level evidence labels, or map
  to customer-specific rubric language later.
