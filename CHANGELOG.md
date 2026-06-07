# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Video Transcript Artifacts

- `workers/api/migrations/0076_transcript_artifacts.sql`: New table for persisting video call transcripts with status (PENDING/COMPLETED/FAILED) and error_message for actionable failure status. Links to scheduled_interviews for graph associations (meeting invite, recipient/person nodes).
- `workers/api/src/types.ts`: Added TranscriptStatus, TranscriptEntry, and TranscriptArtifact types.
- `src/lib/scheduling/types.ts`: Added transcript types and transcriptArtifact enrichment field to ScheduledInterview.
- `workers/api/src/durable-objects/VideoRoom.ts`: Updated to accept scheduledInterviewId, transcriptCallbackUrl, and internalSecret on init. Triggers transcript callback on session end (STATUS_UPDATE → ENDED).
- `workers/api/src/routes/assessment/video.ts`: Added POST /api/v1/video/transcript-callback internal endpoint for DO→Worker transcript persistence. Updated POST /sessions to pass scheduledInterviewId and callback URL to VideoRoom DO.
- `workers/api/src/routes/cockpit/scheduling.ts`: Updated GET /interviews to LEFT JOIN transcript_artifacts and include status/error_message in list view. Added GET /interviews/:id for full transcript details including transcript_json.
- `workers/api/src/index.ts`: Mounted video router (internal callback) before videoAuth (authenticated routes) to ensure callback path doesn't require auth.
- `src/components/Scheduling/TranscriptViewer.tsx` (new): Modal viewer for video call transcripts with status indicators (PENDING/COMPLETED/FAILED), speaker labels, timestamps, and actionable error messages for failed transcriptions.
- `src/components/Scheduling/InterviewCard.tsx`: Added TRANSCRIPT button that appears when transcriptArtifact exists, with color-coded status indicator. Opens TranscriptViewer modal on click.
- `workers/api/src/routes/cockpit/__tests__/scheduling.rest.test.ts`: Added transcript artifact model tests validating entry structure, status transitions, and graph association via scheduledInterviewId.

### Added — Scheduling Tab Invite UI

- `src/components/Scheduling/InviteCreationModal.tsx` (new): Modal component for creating direct video call and screening interview invites. Includes meeting type selection, recipient name/email inputs, optional scheduled time, and invite link generation with copy functionality.
- `src/components/Scheduling/SchedulingDashboard.tsx`: Added primary action buttons (DIRECT CALL, SCREENING) that open the invite creation modal with pre-selected meeting type.
- `src/hooks/useScheduledInterviews.ts`: Updated to include contact-first fields (meetingType, recipientName, recipientEmail) from builder's API changes.

### Added — Recipient Video Call Microapp Route

- `src/pages/RecipientInvitePage.tsx` (new): Public route (/invite/:id) for recipients to join video calls. Loads invite data via GET /api/v1/scheduling/invite/:id, implements basic profile/CV intake form (name, email, resume summary), and integrates VideoShell for video room functionality. Supports both DIRECT_VIDEO_CALL and SCREENING_INTERVIEW meeting types.
- `src/pages/RecruiterVideoPage.tsx` (new): Protected route (/recruiter/video/:id) for recruiters to join contact-first video calls. Uses interview ID as stage/candidate ID for VideoShell signaling.
- `src/App.tsx`: Added routes for RecipientInvitePage (public) and RecruiterVideoPage (protected). Imported and lazy-loaded both page components.
- `src/components/Scheduling/InterviewCard.tsx`: Updated JOIN button to navigate to recruiter video page for contact-first interviews (detected by presence of recipientName/recipientEmail without candidateId). Added useNavigate hook for routing.

### Fixed — TypeScript Compilation Errors in Scheduling Components

- `src/components/Scheduling/InviteCreationModal.tsx`: Removed unused imports (Mail, Calendar), fixed scheduledAt optional property handling to comply with exactOptionalPropertyTypes by conditionally adding property only when present.
- `src/components/Scheduling/SchedulingDashboard.tsx`: Removed unused Plus import.
- `src/hooks/useScheduledInterviews.ts`: Fixed meetingType optional property handling to comply with exactOptionalPropertyTypes by using conditional assignment instead of spread operator.

### Added — Contact-First Scheduling API

- `workers/api/src/routes/cockpit/scheduling.ts`: POST /interviews now accepts recipientName/recipientEmail for contact-first invites without requiring candidateId/pipelineId/stageId. Added optional scheduledAt and cvProfile payload support. GET /invite/:id public route allows invite link resolution without recruiter auth. GET /interviews returns meeting_type, recipient_name, recipient_email fields. Added ACTIVE status to lifecycle (INVITED -> SCHEDULED -> ACTIVE -> COMPLETED/CANCELLED/NO_SHOW). Webhook matching updated to support both candidate_email and recipient_email. Email notifications handle contact-first recipients.
- `workers/api/migrations/0075_contact_first_meetings.sql`: Updated CHECK constraint to include ACTIVE status.
- `src/lib/scheduling/types.ts`: Added ACTIVE to InterviewStatus type.
- `workers/api/src/routes/cockpit/__tests__/scheduling.rest.test.ts` (new): REST tests for invite creation without candidateId/pipelineId/stageId, validation schema tests, status transition tests, and meeting type classification tests.

### Added — File-Based Transcription Storage

- `workers/api/src/lib/transcriptionStorage.ts` (new): Module for file-based transcription storage in R2. Functions include `formatTranscriptionMarkdown()` (human-readable formatting), `storeTranscriptionFiles()` (writes transcription.md and metadata.json to R2), `getTranscriptionMarkdown()` (retrieves markdown), `getTranscriptionMetadata()` (retrieves JSON), and `transcriptionFilesExist()` (checks file existence).
- `workers/api/src/routes/screening/phone.ts`: Updated to store transcription files in R2 after successful transcription via Workers AI Whisper. Added `GET /api/v1/phone/calls/:callId/transcription` endpoint to retrieve markdown transcription and `GET /api/v1/phone/calls/:callId/metadata` endpoint to retrieve JSON metadata. R2 path structure: `call-recordings/{callId}/transcription.md` and `call-recordings/{callId}/metadata.json`. File storage is fire-and-forget (doesn't fail transcription if R2 write fails).
- This complements existing SQLite storage (phone_calls.transcription column) with durable, human-readable backup following CEO Studio's hybrid storage pattern adapted for PIPE-OS's cloud architecture.

### Fixed — Deterministic Discovery Interview Questions

- `workers/api/src/lib/agents/question/domainOrchestrator.ts`: Domain orchestrator now uses calibrated probes from `probeLibrarian.ts` (ADR-041) instead of LLM-generated questions. Probes are served in deterministic order per domain, with LLM fallback only for domains without matching probes (e.g., `why`). Cross-domain probe deduplication prevents the same probe from being asked twice.
- `workers/api/src/lib/agents/question/probeLibrarian.ts`: Added `getProbesForDomain()` and `getSoulProbesForDomain()` — returns calibrated probes matching a domain, adapted for participant role, excluding already-delivered probes. Converts probes to `GeneratedQuestion` shape for domain orchestrator compatibility.
- Added sequential delivery logging throughout `domainOrchestrator.ts` and `probeLibrarian.ts` to confirm deterministic behavior.

### Added — QA Validator Agent

- `workers/api/src/lib/agents/question/qaValidator.ts` (new): Development-mode validation for interview questions. Checks probe sequence, domain alignment, duplicate detection, and context relevance. Runs after each question delivery with console logging. Includes `validateInterviewState()` for end-of-interview consistency checks.

### Improved — Neo4j Graph Write Observability

- `workers/api/src/lib/neo4j/writeCandidateGraph.ts`: Added start/complete logging with duration tracking. Logs node counts, relationship counts, and timing for each candidate graph write.
- `workers/api/src/lib/neo4j/writeRoleGraph.ts`: Added start/complete logging with duration tracking for role graph writes.
- `workers/api/src/lib/neo4j/writeRepoGraph.ts`: Added start/complete logging with duration tracking for repo graph writes.
- `workers/api/src/lib/neo4j/matchingQueries.ts`: Added timing and result count logging for `matchCandidatesForRole()`.
- All three write functions now log a warning when Neo4j config is missing (before throwing), making it visible in logs when the graph layer is unconfigured.

### Fixed — Immediate Candidate Ingestion

- `workers/api/src/routes/rpc.ts`: INTAKE challenge submission and upload-media now run resume ingestion immediately via `waitUntil(processResumeFromR2())` instead of queuing for the 2-hour cron. Candidate graph is live before proceeding to next stage. GitHub enrichment still uses cron queue (external API batching). See handoff `docs/handoffs/2026-05-10-immediate-candidate-ingestion.md`.

### Added — Mode-1 Profile Probe Bank (Phase 2)

- Migration `0069_profile_probe_bank.sql`: table for role-agnostic Mode-1 probes with dimension CHECK constraint.
- `workers/api/src/lib/profileProbeBank.ts`: 18 curated probes across 6 dimensions (career_history, behavioral_depth, cultural, technical, motivation, context). Coverage-driven selector `pickNextProfileProbe()`.
- `workers/api/src/lib/cultureAgent.ts`: dual-mode FSM — `profile_builder` uses profile probe bank; `role_fit` uses existing competency bank. New `advanceProfileBuilderInterview()` and `evaluateProfileBuilderTermination()`.
- `workers/api/src/lib/cultureAgentAdaptive.ts`: skips generative planner for `profile_builder` mode (static-only, no LLM risk on blocking gate).
- `workers/api/src/lib/cultureGenerativePlanner.ts`: relaxed `GenerativePlannerContext.coverage` type to `Record<string, number>` to accept both competency and profile dimensions.
- Tests: `profileProbeBank.test.ts` (11 tests), `cultureAgent.test.ts` (7 tests).

### Added — Swarm QA Infrastructure

- `agent-harness/SWARM_GUIDE.md`: operator runbook for the QA swarm lane.
- `agent-harness/run_qa_swarm.py` + `run_qa_swarm_async.py`: synchronous and asynchronous entrypoints for driving the QA-Deploy swarm agent against a plan.
- `agent-harness/scripts/mcp-docker-bridge.sh` + `mcp-docker-wrapper.py`: MCP bridge for Docker-based tool execution inside swarm lanes.
- `agent-harness/scripts/swarm-dashboard.py` + `swarm-web-dashboard.py`: CLI and web dashboards for real-time swarm lane monitoring.
- `dashboard-screenshot.png`: sample dashboard output.

### Added — Question Agent Guard & Feedback

- `workers/api/src/lib/agents/question/guard.ts`: input guard that validates interview questions against policy (toxicity, PII leakage, off-topic drift) before dispatch.
- `workers/api/src/lib/agents/question/feedbackReport.ts`: structured feedback report generator for question quality audits.
- `workers/api/src/lib/agents/question/promptPatch.ts`: prompt-patch utility for hot-fixing question generation prompts without redeploy.
- `workers/api/src/lib/agents/question/types.ts`: shared TypeScript contracts for the question agent pipeline.
- `workers/api/src/lib/agents/question/__tests__/guard.test.ts`: Vitest suite covering guard pass, block, and edge-case classifications.

### Added — Vertex AI Authentication

- `workers/api/src/lib/llm/vertexAuth.ts`: reusable Vertex AI OAuth2 token refresh and credential caching, extracted from `vertexAIProvider.ts` to enable shared auth across live and batch providers.

### Added — Frontend Interview Components

- `src/components/AIChat/SmartInterviewInput.tsx`: voice-aware chat input with transcription fallback, typing indicators, and sendguard for live interview stages.
- `src/hooks/useVoiceInput.ts`: React hook wrapping Web Speech API with permission handling, interim transcript buffering, and auto-stop on silence.

### Added — Role Agent Sanitization

- `workers/api/src/lib/roleAgent/sanitize.ts`: output sanitizer for RCD synthesis — strips disallowed markup, normalises unicode, and enforces length caps before persistence.

### Added — Strategy V2 QA Swarm Bugfix Plans

- `knowledge/plan/SWARM_QA_SPEC.md`: specification for the automated QA-swarm bugfix pipeline.
- `docs/plans/strategy-v2/qa-swarm-bugfix/` + `knowledge/plan/strategy-v2/qa-swarm-bugfix/`: plan documents for API correctness, observability finish, and stub-to-real migrations.

### Changed — Agent Harness Swarm

- All swarm agents (`advisor.py`, `architect.py`, `chat_agent.py`, `developer.py`, `meta_pm.py`, `orchestrator_agent.py`, `qa_deploy.py`): aligned tool signatures with MCP bridge contract, added heartbeat acks, and standardized error propagation.
- `agent-harness/src/agent_harness/swarm/graph.py`: injected checkpoint persistence between phase transitions.
- `agent-harness/src/agent_harness/swarm/lane_runner.py`: added Docker context isolation, retry budget per lane, and async event streaming.
- `agent-harness/docker-compose.yml`: added `mcp-bridge` service and volume mounts for script hot-reload.
- `agent-harness/scripts/mcp-lazy-wrapper.py`: lazy-loads MCP tools on first invocation to reduce cold-start time.
- `agent-harness/README.md`: updated setup instructions for Docker-based swarm execution.

### Changed — Question Agent

- `workers/api/src/lib/agents/question/generator.ts`: integrated `guard.ts` pre-flight check, added feedback loop on block events, and refactored prompt assembly to use `promptPatch.ts`.
- `workers/api/src/lib/agents/question/prompt.ts`: tightened system prompt to enforce policy compliance and reduced hallucinated citations.

### Changed — Role Discovery & Synthesis

- `workers/api/src/lib/agents/roleDiscovery/prompts.ts`: updated probe prompts to reference sanitized RCD fields and added calibration guidance.
- `workers/api/src/lib/roleAgent.ts`: wired `sanitize.ts` into the synthesis pipeline, added telemetry spans for decomposition timing.
- `workers/api/src/lib/roleAgent/consumerSlice.ts`: normalized Redux action payloads to match sanitized output shapes.
- `workers/api/src/lib/roleAgent/deriveJobDescription.ts`: derives JD from sanitized `role_searchable_profile` instead of raw narrative.
- `workers/api/src/lib/roleAgent/synthesizeRcd.ts`: emits `sanitized_at` timestamp and validation digest.
- `workers/api/src/lib/roleAgentPrompts.ts`: added guard-rail examples for disallowed content.
- `workers/api/src/__tests__/synthesizeRcd.test.ts`: updated expectations to assert sanitized fields.

### Changed — Domain-Driven Interview Flow (ADR-028)

- **Single endpoint architecture**: `POST /:id/respond` is now the only live endpoint for the interview loop. Removed `POST /:id/state`, `POST /:id/question/prefetch`. `POST /:id/question` returns `410 Gone`.
- **Frontend `useRoleDiscovery.ts`**: rewritten to call `/respond` exclusively. Removed `questionStack`, prefetch, and split-endpoint logic.
- **Backend `domainOrchestrator.ts`**: drives column-by-column flow (team → work → bar → codebase → process → why). Generates 6 questions per domain in one LLM call, serves from cache, runs depth evaluator, generates follow-ups if shallow.
- **Backend `reducer.ts`**: overhauled to remove legacy probe counting, hard budget enforcement, and `selectPhase`/`phaseRules`. Now tracks per-domain progress via `domainCompletion`, `domainQuestionsDelivered`, `domainFollowUpsDelivered`.
- **Backend `types.ts`**: `InterviewState` now includes `knowledgeState`, domain-driven fields, and optional `questionStack` for backward compat.
- **Validation schema**: `interviewStateSchema` accepts optional domain-driven fields.
- **Tests**: updated `roleContextsQuestion.test.ts` to expect `410 Gone` for deprecated endpoint.
- **Backend `answerEvaluator.ts`**: lightweight per-answer quality heuristic. Evaluates every answer for substance (length + specificity signals). Thin answers trigger warm, conversational follow-ups instead of rigid batch depth evaluation.
- **Backend `domainOrchestrator.ts`**: rewritten for conversational flow. Reduced questions per domain from 6 to 4, max follow-ups from 3 to 2. After each answer, checks quality and either drills deeper with a warm follow-up or moves on. Domains complete when cache is exhausted — no more broken depth evaluator blocking synthesis.
- **Backend `domainGenerator.ts`**: added robust JSON fallback parser for truncated LLM responses. Increases `maxTokens` to 8192 for streaming path.
- **Frontend `AIChat.tsx`**: removed "Question X of Y" counter, linear progress bar, and old phase badge. Now shows current domain name (e.g., "TEAM") and domain-completion progress (`3 / 6 domains explored`). Progress bar reflects completed domains, not question count.
- **Frontend `DomainBars.tsx`**: highlights current domain with green border, shows completed domains in bright green.
- **Frontend `useRoleDiscovery.ts`**: removed `prefetch`, `questionBudget`, old phase metadata. Exposes `currentDomain` and `domainCompletion`.
- **Frontend `RoleDiscoveryPage.tsx`**: removed `DEFAULT_BUDGET`. Updated AIChat props and resume hydration.

### Changed — Culture Agent

- `workers/api/src/lib/cultureAgent.ts`: switched to shared Vertex auth helper, removed duplicate credential logic.
- `workers/api/src/lib/cultureAgentAdaptive.ts`: added fallback to static question bank when generative planner is rate-limited.
- `workers/api/src/lib/cultureAgentContext.ts`: expanded context window to include prior adaptive answers.
- `workers/api/src/lib/cultureQuestionBank.ts`: seeded additional edge-case scenarios for DEI and remote-work topics.
- `workers/api/src/lib/__tests__/cultureGenerativePlanner.test.ts`: added tests for adaptive fallback path.

### Changed — LLM Providers

- `workers/api/src/lib/llm/createProvider.ts`: refactored provider factory to accept `vertexAuth` dependency injection, unified retry and timeout defaults.
- `workers/api/src/lib/llm/vertexAIProvider.ts`: extracted auth into `vertexAuth.ts`, slimmed provider to pure request/response logic.
- `workers/api/src/lib/llm/live/createLiveProvider.ts`: registered Vertex live provider with shared auth cache.
- `workers/api/src/lib/llm/live/vertexLiveProvider.ts`: adopted `vertexAuth.ts` token refresh, fixed stream termination race.

### Changed — Frontend UI & Theming

- `src/components/ui/AppBackground.tsx`: added animated mesh gradient background with reduced-motion fallback.
- `src/components/ui/LiquidMetalCard.tsx`: improved shimmer performance via CSS containment, fixed border-radius clipping.
- `src/contexts/ThemeContext.tsx`: added system-preference listener and manual override persistence to `localStorage`.
- `src/index.css`: introduced CSS custom properties for the new gradient palette, added `.reduce-motion` media-query guards.
- `src/pages/CandidateScreeningPage.tsx`: integrated `SmartInterviewInput`, added voice-input toggle, and improved loading skeletons.
- `src/pages/CultureInterviewPage.tsx`: streamlined layout, removed deprecated stage-type conditionals, wired adaptive culture agent.
- `src/components/RoleDiscovery/GapFillModal.tsx`: fixed focus trap and added `aria-describedby` for screen readers.
- `src/components/RoleDiscovery/MatchConfigWizard.tsx`: aligned step validation with backend calibration constraints.
- `src/components/RoleDiscovery/RoleContextReview.tsx`: added sanitize-status badge and raw/sanitized diff toggle.
- `src/components/AIChat/index.ts`: exported `SmartInterviewInput`.

### Changed — API Routes

- `workers/api/src/routes/assessment/agentInterview.ts`: added guard pre-check before question generation, returns `403` on policy block with `feedbackReport` URI.
- `workers/api/src/routes/cockpit/candidates.ts`: exposed `sanitized_rcd` flag in list view.
- `workers/api/src/routes/internal/calibrate.ts`: added batch calibration endpoint for role-discovery probe scoring.
- `workers/api/src/routes/screening/culture.ts`: wired adaptive culture agent, added fallback to static bank.
- `workers/api/src/routes/tts.ts`: added voice-selection query param and caching headers.
- `workers/api/src/types.ts`: added `SanitizedRcd`, `QuestionGuardResult`, and `VoiceInputState` interfaces.

### Changed — Tests

- `workers/api/src/__tests__/candidates.test.ts`: added assertions for `sanitized_rcd` field.
- `workers/api/src/lib/ai/__tests__/retryHelper.test.ts`: expanded coverage to include Vertex auth retry paths and exponential-backoff jitter.

### Changed — Scripts & Configuration

- `workers/api/scripts/test-decomposition.ts`: added `--sanitize` flag to exercise `sanitize.ts` against fixture RCDs.
- `workers/api/scripts/validate-providers.ts`: validates Vertex auth refresh flow and live provider handshake.
- `workers/api/.dev.vars.example`: added `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, and `MCP_BRIDGE_URL` placeholders.

### Added — Repo Decomposition into repo_nodes (Phase 2)

- **Migration `0050_repo_nodes.sql`**: addressable sub-element decomposition for Pass 3 repos. Table `repo_nodes` with 9-type `CHECK` constraint (`Feature`, `ArchitecturalPattern`, `TechnicalStack`, `Construct`, `ChallengeSurface`, `QualitySignal`, `DomainContext`, `PRSample`, `IssueCandidate`), indexes on `(repo_id, node_type)` and `(repo_id, signals_version)`, and dual-layer `embedding_json` per ADR-040.
- **`workers/api/scripts/crawl-repos/pass3/run.ts`**: Pass 3 prompt now asks Gemma to produce structured `sub_elements` JSON alongside the 9 legacy top-level fields. Zod schema (`pass3GemmaOutputSchema`) validates Gemma output before any D1 write. `PRSample` and `IssueCandidate` sub-elements are derived deterministically from existing `repo_sample_prs` and `repo_issues` rows (no Gemma call). Each sub-element gets a BGE-large-en-v1.5 embedding (type-prefixed narrative, document side) and is upserted to `REPO_INDEX` with metadata `{entity_type:'repo', entity_id, node_type, signals_version, admin_status:'approved'}`.
- **`workers/api/scripts/crawl-repos/pass3/persist.ts`**: `persistRepoNodes` performs transactional delete+insert per repo, pre-generates embeddings before D1 write, and batches inserts. `upsertRepoNodesToVectorize` sends batched NDJSON upserts to Vectorize.
- **`workers/api/scripts/backfillRepoNodes.ts`**: backfill script for existing `pass >= 3` repos. Queries repos lacking `repo_nodes`, uses a cheaper Gemma extraction prompt against existing `engineering_narrative` to avoid full Pass 3 re-runs, appends PR/Issue sub-elements, and persists embeddings + Vectorize upserts. Supports `--dry-run`, `--batch=N`, and `--repo-id=<id>`.

### Added — PR Narrative Enrichment & Semantic Selection

- **Migration `0051_repo_sample_prs_narrative.sql`**: adds `pr_narrative`, `pr_narrative_embedding_json`, and `pr_narrative_version` to `repo_sample_prs`.
- **`workers/api/scripts/crawl-repos/pass2/prNarrative.ts`**: new module that generates a Gemma-derived 2–3 sentence narrative per sampled PR (grounded in changed files, constructs, and PR metadata) and embeds it via BGE-large-en-v1.5 (document side).
- **`workers/api/scripts/crawl-repos/index.ts`**: Pass 2 now auto-chains PR narrative enrichment after sampling. Non-fatal: individual PR failures are logged and the original PR is persisted unchanged.
- **`workers/api/scripts/crawl-repos/pass2/persist.ts`**: persists the three new narrative columns into `repo_sample_prs`.
- **`workers/api/src/lib/match/autoStageBuilder.ts`**: `pickReviewPr()` now supports semantic selection. When a candidate embedding is provided, it computes exact cosine similarity between the candidate profile and each PR's narrative embedding, returning the best match above threshold 0.6. Falls back to the existing `ORDER BY changed_file_count ASC` when no embedding is available, no PR clears the threshold, or embeddings are missing. Logs `selectionPath` (`semantic` vs `size_fallback`) for observability.
- **`workers/api/src/lib/match/matchReposForCandidate.ts`**: accepts optional `candidateEmbeddingJson` and forwards it to `pickReviewPr()`.
- **`workers/api/src/lib/candidateDiscovery/orchestrate.ts`**: loads the candidate embedding from `candidate_ingestion.embedding_json` early and passes it through to `matchReposForCandidate` and the re-rank `pickReviewPr` call.
- **`workers/api/scripts/crawl-repos/pass3/run.ts`**: `callGemma()` now accepts an optional `responseMimeType` parameter (default `application/json`) to support plaintext PR narrative generation.

### Added — Unified Agent Runtime (ADR-034)

- `workers/api/src/lib/unifiedAgentRuntime/`: shared FSM, plugin registry, session store, scorer, eval gate, and provider for role discovery, code review, and culture interview agents.
- `workers/api/src/lib/agents/{roleDiscovery,codeReview,culture}/plugin.ts`: per-agent plugins registered via `registerAllPlugins()`.
- `workers/api/src/routes/agents.ts`: unified `/api/v1/agents/*` routes (mounted in `index.ts`).
- `migration/0043_agent_sessions.sql`: unified `agent_sessions` table for cross-agent operational queries.
- `docs/decisions/current/ADR-034-unified-agent-runtime.md`: rationale and consolidation plan.

### Added — RCD Decomposition into role_nodes (Phase 2)

- `workers/api/src/lib/roleAgent/decomposeRcd.ts`: pure extractor `decomposeRcdIntoNodes` turns a `RoleContextDocument` into 11 typed `RoleNodeRow` sub-elements (Requirement, Responsibility, CulturalSignal, TeamContext, Dealbreaker, RedFlag, TechnicalContext, CodebaseExpectation, ProcessExpectation, Conflict, BarsOverride). Each node carries type-prefixed narrative text, structured `extracted_properties_json`, stakeholder attribution, and must/nice weights.
- `persistRoleNodes` in `decomposeRcd.ts`: batched BGE embedding generation, Vectorize `ROLE_INDEX` upsert with metadata, and D1 `role_nodes` INSERT via `db.batch`. Existing nodes for the same `role_context_id` are marked superseded before new ones are written.
- `workers/api/src/routes/discovery/roleContexts.ts`: post-RCD-write hook calls `decomposeRcdIntoNodes` + `persistRoleNodes` in all three synthesis call sites. Errors are caught and logged without failing synthesis.
- `workers/api/src/lib/roleAgent/__tests__/decomposeRcd.test.ts`: 7 Vitest unit tests covering full-population node counts, null-section safety, single-stakeholder extraction, type-prefix narratives, must/nice weight assignment, and meaningful `source_section` paths.

### Added — Role Discovery Evaluator

- `workers/api/src/lib/roleDiscovery/evaluator.ts` + `evaluatorPrompt.ts`: eval-gated question generation (interviewer proposes 2 candidates → evaluator picks the best) for the role discovery agent.
- `workers/api/src/routes/internal/evaluateDiscovery.ts`: internal endpoint for evaluator runs.
- `workers/api/src/lib/roleAgentPrompts.ts`: prompt rewrite to align with the evaluator contract.

### Added — Strategy & Planning Docs

- `knowledge/plan/pipe-strategy-v2-part{1..6}.md`: north-star, role discovery, repo ingestion, candidate ingestion, matching migration, and market research.
- `docs/plans/2026-04-22-eval-gated-pipeline.md`, `docs/plans/2026-04-22-live-rcd-synthesis.md`.
- `docs/handoffs/{discovery-agent-context,phase-2-role-discovery-migration,unified-agent-runtime}-2026-04-23.md`.
- `scripts/research-vector-signals.py`: research helper for vector-native signal exploration.

### Changed

- `migration/PLAN.md`: Phase 5 marked done (Terraform dropped per ADR-041, GitHub Actions live, `amplify/` deleted); Phase 3 marked drifted; Workers route inventory updated to 34 modules; D1 migration count updated to 0001–0042.
- `CLAUDE.md`: added Context Budget section enforcing per-session limits on project files, skills, and persistent memory.

### Removed

- `data/experiments/runs.jsonl` (stale experiment log).
- `knowledge/README.md` (superseded by `knowledge/STRATEGY.md` and the wiki).

### Fixed

- **Cross-tenant leak on `/api/v1/search/roles`:** `matchRolesVectorNative` now joins `pipelines` and filters by `owner_id`; `/roles` handler passes the authenticated user through. Mirrors the existing `matchCandidatesVectorNative` pattern.
- **Silent data corruption in CODE_REVIEW lazy-session INSERT:** `/rpc/review/ask` now derives `implementer_persona` and `max_rounds` from challenge config instead of writing literal `'pending'` into `implementer_persona`.
- **Prop mutation in `ReviewSessionReport`:** rescore now updates a local `localStatus` state instead of mutating `props.session.status`; added optional `onRescore` callback so parents can re-fetch.
- **Duplicate `review-session-loader` test-id:** init-phase loader renamed to `review-session-init-loader`; rounds-phase keeps `review-session-loader`.
- **Missing error state on CODE_REVIEW init:** `CandidateAssessmentPage` now captures init errors and renders a retry button instead of leaving the candidate stuck on a silent loader.

### Changed

- Extracted shared scoring + propagation into `workers/api/src/lib/review/scoreAndPropagate.ts`; `finalizeReviewSession` (in `review.ts`) and `POST /:sessionId/rescore` (in `reviewSessions.ts`) reduce to a single invocation wrapped in `c.executionCtx.waitUntil(...)`. `/rescore` now sets status to `'scoring'` and returns `{ success: true, status: 'scoring' }` immediately, preventing wall-time timeouts on long transcripts.
- Extracted `REVIEW_SESSION_STATUS_COLORS`/`STATUS_LABELS` to `src/lib/reviewSessionStatus.ts` and updated both consumers.
- Review Session Report modal and `GapFillModal` now expose `role="dialog"`, `aria-modal`, labelled heading, and Escape-to-close.
- Telemetry in `orchestrate.ts` is prefixed `[orchestrate]` and drops the redundant intersection cast on `triangulated.raw_signals`.
- Dropped duplicate `challengeId` from the `reviewSession` payload on `GET /rpc/get-challenge` (clients use the top-level `id`).
- Replaced `as unknown as ChallengeConfigRow` casts in `review.ts` with typed `.all<ChallengeConfigRow>()`.
- `roleContextsCalibrate.test.ts` now imports `Context`/`Next` from `hono` instead of typing middleware as `any`.

### Added — Test Environment Infrastructure

- `[env.test]` block in `workers/api/wrangler.jsonc` (bindings commented pending one-time bootstrap).
- `workers/api/scripts/bootstrap-test-env.sh` — creates `pipe-db-test`, `pipe-assets-test`, and three `*-profiles-test` Vectorize indexes.
- `workers/api/scripts/reset-test-db.sql` + `seed-test-db.sql` — idempotent wipe + fixture seed.
- `workers/api/scripts/TEST-ENV.md` — operator runbook.
- `.github/workflows/e2e-test.yml` — apply migrations, deploy worker + Pages, reset/seed, run Playwright serial against real backend.

### Added

**Task B — Role Discovery Agent:**
- Role Discovery agent now uses 6 calibrated probes instead of open-ended Six Domains exploration
- Role Context Document (RCD) is now the primary synthesis artifact
- Added calibration review UI for recruiters to flag and correct RCD attributes
- Added gap-filling agent for targeted clarifying questions
- **Migration `0049_role_nodes.sql`**: derivative sub-element view of RCDs; FK to `role_contexts` with `ON DELETE CASCADE`, 11-type `CHECK` constraint, and partial index on active (`superseded_at IS NULL`) nodes.

**Task C — Code Review Golden Path:**
- CODE_REVIEW stages now create review session on stage entry
- New review session endpoints: `/rpc/review/session/init`, `/message`, `/complete`
- Added dedicated review session page with diff + chat interface
- Recruiter dashboard now shows review session status, score, and transcript

**Infrastructure & Docs:**
- Phase 5 CI/CD: GitHub Actions workflows for CI, staging deploy, and production deploy
- ADR-041: Cloudflare-native deployment with Wrangler (drops Terraform)
- `workers/api/wrangler.jsonc` environments: `staging` and `production`
- `docs/project-brief.md`: Unified project vision, glossary, phased roadmap, and honest current-state snapshot
- `.claude/rules/terminology.md`: Mandatory domain language for all agents
- **Dual-layer embedding architecture (D1 ground truth + Vectorize ANN):** Migration `0042_embedding_json.sql` adds `embedding_json` to `candidate_ingestion`, `repo_engineering_signals`, and `role_contexts`; `role_contexts.role_searchable_profile` stores role narrative. Enables exact cosine computation and index rebuilds from D1.
- **Exact `role_candidate_cosine` computation:** `lib/embedding/cosine.ts` provides `cosineSimilarity()` and `parseEmbeddingJson()`; `orchestrate.ts` loads both embeddings from D1 and computes exact similarity at match time (falls back to `null` if missing).
- **Unified semantic search endpoints:** `POST /api/v1/search/candidates` and `POST /api/v1/search/repos` enable bidirectional search (role→candidates, role→repos, candidate→repos, repo→candidates) using dual-layer embeddings.
- **Role context embedding:** `buildAndStoreRoleEmbedding` fires best-effort when role discovery reaches `COMPLETE`, building `role_searchable_profile` from `job_description_md` and embedding via BGE-large-en-v1.5.

### Removed
- **Deprecated stage types:** Removed all dead stage types (`AI_COLLAB`, `PLANNING`, `VOICE`, `INGESTION`, `TECHNICAL`, `QUESTIONS`, `VOICE_INTERVIEW`) from frontend and backend.
- Locked to exactly 5 stage types: `SCREENING`, `CULTURAL`, `CODE_REVIEW`, `OPEN_SOURCE`, `LIVE_PANEL`.
- Aligned `workers/api/src/validation/stages.ts`, `src/lib/stageTemplates.ts`, `src/types/index.ts`, and all UI components.
- Removed `titleLower.includes(...)` fallback inference patterns in `StageIndexTab.tsx` and `StagePanel.tsx` — stages must have `stage_type` populated.
- Updated pipeline templates to use valid stage types only.
- Cleaned up unused lucide-react imports (Zap, Brain, Mic) from modified components.

### Changed
- `docs/vision.md`: Aligned with project brief — added product thesis, full vision reference, and guardrails
- `migration/PLAN.md`: Added Product Phases (P1–P5) section with 2026-04-22 decisions
- Documentation reorganization: unified navigation hub, split decisions into current/historical, extracted model routing, archived stale artifacts
- Deleted obsolete files: BUGS.md, TEST_ANALYSIS.md, TEST_STATUS.md, TODO.md, CONTRIBUTING.md, docs/README.md, docs/handoffs/
- Deleted AWS Amplify artifacts: `amplify/`, `amplify_outputs.json`, `amplify.yml`
- Deleted Terraform infrastructure: `infra/` directory
- Archived CHANGELOG.md to docs/archive/CHANGELOG-historical.md, restarted fresh
- Moved DREAM.md → docs/vision.md (trimmed to product vision only)
- Moved docs/DRIFT_LOG.md → docs/ops/drift-log.md, docs/audits/ → docs/ops/audits/
- Created docs/ai/model-routing.md as single source of truth for AI routing
- Rewrote CLAUDE.md as pure navigation hub + agent instructions (no content duplication)
- Rewrote root README.md (50 lines)
- Updated internal links across migration docs, knowledge docs, and source files

## [0.0.1] - 2026-04-22

### Added
- Initial changelog
