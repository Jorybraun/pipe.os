# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — PDL Candidate Sourcing + Unified Contacts

- `workers/api/src/lib/pdl.ts`: People Data Labs client — Person Search API (SQL queries) and Person Enrichment API. Pay-as-you-go candidate discovery.
- `workers/api/src/routes/outreach/pdlSearch.ts`: `POST /api/v1/outreach/search` queries PDL by role/level/company/location/phone/email. `POST /api/v1/outreach/save` persists a PDL result as a Contact with living context graph integration. `POST /api/v1/outreach/enrich` enriches a known person.
- `src/pages/ContactsPage.tsx`: New "Source" tab with PDL search form (job role, level, company, country, has phone/email). Results show name, title, company, email, phone, location. One-click "Save" creates a Contact.
- `src/App.tsx`: Sidebar now routes to Contacts (`/contacts`) instead of Outreach. Contacts page reachable from sidebar.
- `workers/api/src/types.ts`: Added `PDL_API_KEY` to Env bindings.

### Added — Meeting Rooms + Living Context Graph Foundations

- `workers/api/src/routes/meetingRooms.ts`: Standalone video room lifecycle with transcript ingestion into living context graph. Semantic assertion extraction from meeting transcripts.
- `workers/api/src/durable-objects/VideoRoom.ts`: Generalized from recruiter/candidate to host/guest roles. Added `/ensure` endpoint for idempotent meeting room initialization.
- `workers/api/src/lib/livingContext/`: Full living context graph persistence — Person, WorkspacePerson, Application, Interaction, Artifact, ArtifactVersion, SourceSpan, Episode, SemanticAssertion, SignalEvidence, SignalSnapshot, SemanticRelationship. Deterministic entity IDs via SHA-256 ingestion keys.
- `workers/api/src/lib/livingContext/compatibility.ts`: `ensureContactLivingContext` and `ensureCandidateLivingContext` adapters — mirror legacy contacts and candidates into the unified person graph.
- `workers/api/src/lib/livingContext/meetingTranscript.ts`: Ingest meeting transcripts into the living context graph with canonical segments, semantic assertions, and signal evidence.
- `workers/api/migrations/0082_living_context_graph.sql`: D1 schema for the full living context graph (people, workspace_people, applications, interactions, artifacts, source_spans, episodes, semantic_assertions, signal_evidence, signal_snapshots, semantic_relationships, projection_jobs).
- `workers/meetings/`: New standalone Worker for meeting management with room token generation and video room orchestration.

### Fixed — Calendly OAuth Scope Error

- `workers/api/src/routes/cockpit/scheduling.ts`: Fixed Calendly OAuth scope parameter format. Changed from `users:read event_types:read scheduled_events:read` (causing malformed error) to `scheduled_events:read` (matching Calendly documentation exactly). Fixed "The requested scope is invalid, unknown, or malformed" error.
- `src/components/Scheduling/provider/CalendlyProvider.tsx`: Fixed frontend OAuth URL generation to use correct scope format `scheduled_events:read` instead of incorrect `users:read event_types:read scheduled_events:read`.
- `src/components/Scheduling/ConnectionSetup.tsx`: Fixed redirect URI consistency by using fixed path `/schedule` instead of dynamic page path. Resolved "does not match the redirection URI used in the authorization request" error during token exchange.
- `src/components/settings/IntegrationsSettings.tsx`: Fixed redirect URI consistency for settings page OAuth flow.

### Added — Calendly Scheduling Link Support

- `src/components/Scheduling/InviteCandidateModal.tsx`: Added Calendly scheduling link option when Calendly is connected. Added scheduling mode selector (Calendly Link vs Manual Time) that auto-selects Calendly when connected. Updated to send `schedulingProvider` and `schedulingUrl` to backend API.
- `src/hooks/useSchedulingConnection.ts`: Added `eventTypes` field to `SchedulingConnectionInfo` interface. Added `schedulingUrl` field to `ProviderEventType` interface. Added `fetchEventTypesForConnection` helper function to fetch event types for a specific connection.
- `workers/api/src/routes/cockpit/scheduling.ts`: Added `GET /connection/:id/event-types` endpoint to fetch event types for a specific connection. Updated `fetchCalendlyEventTypes` to return `schedulingUrl` field. Updated event types return type to include `schedulingUrl`.
- `workers/api/src/routes/cockpit/candidates.ts`: Updated `createCandidateSchema` to accept `schedulingProvider` and `schedulingUrl` parameters. Updated candidate creation to store scheduling provider and URL in `scheduled_interviews` table. Updated email sending logic to use provided `schedulingUrl` if available.

### Added — AI Assistant for Meetings App (CopilotKit-Compatible Custom Agent)

- `workers/meetings/src/lib/copilotAgent.ts`: Custom agent following Pipe's pattern. Uses Cloudflare AI binding with Gemma 4 model. Simple keyword-based tool routing (meeting/contact keywords) with ReAct-style tool execution. Works in Cloudflare Workers runtime without Node.js dependencies.
- `workers/meetings/src/index.ts`: Added `/api/copilotkit` endpoint implementing CopilotKit v2 API interface. Converts between CopilotKit request/response format and custom agent format. Enables frontend to use CopilotKit hooks while backend uses custom agent.
- `apps/meetings/src/components/AIAssistant.tsx`: AI assistant panel with AGUI components (`MeetingCard`, `ContactCard`) using `useComponent` from `@copilotkit/react-core/v2`. Agent-controlled UI rendering.
- `apps/meetings/src/App.tsx`: Integrated CopilotKit v2 provider with `@copilotkit/react-core/v2`. AI assistant as right panel with sliding push effect.
- `packages/ui/src/Layout.tsx`: Added `rightPanel`, `rightPanelOpen`, `rightPanelWidth` props for sliding panel support with content push effect.

**Technical Notes:**
- **CopilotKit-compatible custom agent pattern** - Backend implements CopilotKit v2 API interface (`/api/copilotkit`) but uses custom agent that works in Cloudflare Workers
- Frontend uses CopilotKit v2 hooks (`useChat`, `useComponent`) - complies with project rule
- Custom agent uses Cloudflare AI binding directly with Gemma 4 model
- Simple keyword-based tool routing (can be upgraded to full ReAct loop with tool protocol later)
- Works in Cloudflare Workers runtime without Node.js dependencies
- **Future upgrade path** - When CopilotKit v2's package structure or Wrangler's bundler is fixed, can swap backend to real CopilotKit v2 without frontend changes
- Production-ready per Pipe standards

**Lesson Learned: CopilotKit v2 + Cloudflare Workers Incompatibility**
- CopilotKit v2's package structure includes Node.js dependencies (`@hono/node-server`, `express`, `@segment/analytics-node`) at the package level
- Wrangler's bundler (Rolldown) automatically injects `createRequire(import.meta.url)` for CommonJS interop
- `import.meta.url` is `undefined` in Cloudflare Workers bundled output, causing crash at module initialization
- Neither Wrangler aliases, npm overrides, nodejs_compat flag, nor patch-package can fix this bundler-level issue
- Root cause: CopilotKit's monolithic package structure + Wrangler's bundler behavior
- Solution: Implement CopilotKit-compatible API interface with custom agent that works in Workers

### Fixed — Contextual Graph Testing Issues (ADR-050 Handoff)

- `workers/api/src/lib/cultureContextualDecomposition.ts`: Added JSON repair pass and retry logic with shorter phrases instruction to handle LLM output truncation. Increased maxTokens from 1024 to 2048. Reduces silent data loss from malformed JSON.
- `workers/api/src/lib/cultureGenerativePlanner.ts`: Changed return type to include `reason` field for better failure diagnostics. Returns `{ result, reason }` instead of just `result`.
- `workers/api/src/lib/cultureAgent.ts`: Added metric logging for planner fallbacks with reason codes (no_provider, llm_error, parse_error, etc.). Logs conversation graph state when fallback occurs.
- `workers/api/src/lib/contextualTurnPersistence.ts`: Added exponential backoff retry logic (3 retries, 1s base delay) for Neo4j operations. Added `pending_graph_backfill` marking for D1 nodes when Neo4j writes fail, enabling future backfill. Improved error logging to distinguish D1 vs Neo4j failures.
- `workers/api/migrations/0080_candidate_nodes_pending_backfill.sql`: Added `pending_graph_backfill` column to `candidate_nodes` table for tracking nodes that need Neo4j backfill.
- `workers/api/src/routes/rpc.ts`: Changed claimed token error from 404 to 409 CONFLICT. Added lookup for `CLAIMED::` prefixed tokens to handle sessionStorage loss scenario with user-friendly message.
- `src/hooks/useAssessment.ts`: Added handling for 409 CONFLICT response to show "TOKEN_ALREADY_CLAIMED" error.
- `src/pages/CandidateAssessmentPage.tsx`: Added "Link Already Used" error state with user-friendly message for claimed tokens.
- `workers/api/src/lib/__tests__/cultureGenerativePlanner.test.ts`: Updated tests to handle new return type with `reason` field.

### Fixed — Contextual node types rejected by candidate_nodes CHECK constraint

- `workers/api/migrations/0079_candidate_nodes_contextual_types.sql`: rebuilds `candidate_nodes` so the `node_type` CHECK constraint accepts the ADR-050 contextual types (Action/Tech/Org/Person/Reason/Outcome/Situation). Without this, `persistContextualTurn` failed with `SQLITE_CONSTRAINT` on every interview turn and no contextual graph was persisted.

### Added — Contextual Conversation Graph for Culture Interviews (ADR-050)

- `workers/api/src/lib/cultureContextualDecomposition.ts`: Decomposes each interview answer into a typed semantic graph (Action/Tech/Org/Person/Reason/Outcome/Situation nodes; DID/OBSERVED/WITH/REPLACED/BECAUSE/ACHIEVED/IN_SITUATION/AT/WITH_PERSON edges). Phrases carry their context ("chose Kafka for ordered clickstream replay", never "kafka"). Generic answers are discarded — the discard triggers an LLM-written probe quoting the candidate's own words. `buildConversationGraphView` surfaces missing-context gaps (Action without BECAUSE/ACHIEVED, unowned Outcomes) for the planner.
- `workers/api/src/lib/neo4j/contextualGraph.ts`: Mirrors the conversation graph into Neo4j and materializes grounded `(:CandidateNode)-[:SIMILAR_TO {similarity, grounding}]->(:RepoNode)` edges only at ≥0.84 cosine similarity AND shared concrete grounding tokens. `matchReposByGroundedEdges` ranks repos by multi-region grounded overlap (distinct repo node types, then edge count) — explainable by listing the actual edges, no scores surfaced.
- `workers/api/src/lib/contextualTurnPersistence.ts`: Per-turn fire-and-forget pipeline — embeds statement phrases, stores them as `candidate_nodes` (source_type `culture_contextual`), writes the typed graph to Neo4j, and materializes grounded edges.
- `workers/api/src/lib/cultureAgent.ts` + `cultureGenerativePlanner.ts`: Decomposition runs in parallel with turn analysis; probes come from the decomposition's discard rule (template STAR probes only as fallback); the planner receives the live conversation graph and targets missing-context gaps; interviews terminate with `no_new_material` when answers stop yielding new statements (streak ≥ 2 within min/max caps).
- `workers/api/src/routes/rpc.ts`: Repo matching now prefers grounded-edge traversal (`matchReposByGroundedEdges`) with cosine ranking as fallback, and passes the candidate CV embedding into `pickReviewPr` on the pipeline gate and standalone review paths (semantic PR selection instead of smallest-PR fallback).

### Added — Talent Pool MVP: Pipeline-Free Candidate Invites

- **Schema migration** (`workers/api/migrations/0075_optional_pipeline.sql`): `pipeline_id` nullable on `candidates` and `scheduled_interviews` tables; `interview_type` column (`VIDEO`|`TECHNICAL`|`SCREENING`) added to `scheduled_interviews`.
- **Standalone candidate endpoint** (`POST /api/v1/candidates`): Invite candidates without pipeline/role. Creates candidate, ingestion row, optional interview, sends invitation email with conditional templates.
- **Email template** (`workers/api/src/lib/email.ts`): `pipelineName` now optional; inverted conditionals (`{{^pipelineName}}`) render standalone invite copy; `customMessage` block support.
- **Ingestion orchestrator** (`workers/api/src/lib/candidateDiscovery/orchestrate.ts`): Skips match/assign (steps 6-11) when `pipeline_id` is NULL. Candidate stays at "embedded" status — searchable in talent pool without requiring a pipeline.
- **Frontend invite modal** (`src/components/Scheduling/InviteCandidateModal.tsx`): "INVITE CANDIDATE" button on scheduling dashboard; form with name, email, interview type selector, optional schedule, custom message.
- **Assessment page** (`workers/api/src/routes/rpc.ts`): `get-stage-config` returns INTAKE challenge for pipeline-free candidates; `get-challenge` returns CV upload config. Candidates without a pipeline see a resume upload screen at `/assess/:token`.
- **Type updates**: `ScheduledInterview.pipelineId`/`stageId` now optional; `InterviewType` type exported; JWT `pid` nullable; `CandidateVariables.pipelineId` nullable.

### Added — Meetings Worker & Schema (Phase 1, ADR-049)

- `workers/meetings/`: New Cloudflare Worker (`pipe-meetings`) for contacts and meetings — separate deployable from the main API Worker, sharing the same D1 database.
- `workers/meetings/src/routes/contacts.ts`: Full CRUD for contacts (`POST/GET/GET:id/PATCH/DELETE /api/v1/contacts`) with search, type filtering, and pagination. Contacts have type (PROSPECT, CANDIDATE, HIRING_MANAGER, RECRUITER, OTHER), optional `candidate_id` FK, and JSON tags.
- `workers/meetings/src/routes/meetings.ts`: Full CRUD for meetings (`POST/GET/GET:id/PATCH /api/v1/meetings`) with status/type filtering and participant management (`POST/DELETE /api/v1/meetings/:id/participants`). Meetings track lifecycle (SCHEDULED→IN_PROGRESS→COMPLETED), type (DISCOVERY, INTERVIEW, FOLLOW_UP, DEMO, OTHER), and transcription status.
- `workers/api/migrations/0075_contacts.sql`: D1 migration for `contacts` table.
- `workers/api/migrations/0076_meetings.sql`: D1 migration for `meetings` table with transcript and recording fields.
- `workers/api/migrations/0077_meeting_participants.sql`: D1 migration for `meeting_participants` join table with unique constraint on (meeting_id, contact_id).
- Clerk JWT auth middleware for the meetings Worker (mirrors `workers/api/src/middleware/auth.ts`).
- CORS configured for `meet.hire-pipe.com`, `pipe.build`, and local dev origins.

### Added — Contacts & Meetings Architecture (ADR-049)

- `knowledge/docs/decisions/current/ADR-049-contacts-meetings-separation.md`: Architecture decision for separating meetings into its own Worker + SPA. Introduces `contacts`, `meetings`, `meeting_participants` tables. Domain: `meet.hire-pipe.com`.
- `knowledge/docs/decisions/current/TASKS-meetings.md`: Phased implementation plan (5 phases, 30 tasks) — schema, Worker scaffold, SPA, video calls, transcription, scheduling bridge.

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
