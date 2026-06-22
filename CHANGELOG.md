# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Source Content Search UI Integration (Criterion #2)

- Added `SourceContentSearchResult` and `SourceContentSearchResponse` types to frontend API types — mirrors the backend `searchSourceContent` return shape.
- Added `useSourceSearch` hook — debounced server-side search against `/api/v1/candidates/:id/living-context/search` with abort controller cleanup.
- Added `SourceSearchResults` panel to `LivingContextGraph` — renders matching source spans with highlighted query terms, assertion predicates, artifact types, confidence scores, concepts, and locator metadata.
- Added `highlightMatch` utility for inline query term highlighting in search results.
- Added 3 new tests to `readModel.test.ts` proving `searchSourceContent` returns matching spans with concepts, handles empty results, and escapes SQL wildcards.
- Added CSS for source search panel (`.living-context__source-search`, `.living-context__search-hit`, `.living-context__highlight`).

### Added — D1-Backed Rollout Gate Configuration (Criterion #8)

- Added `0096_rollout_gates.sql` migration — stores rollout gate stages in D1 for runtime configuration without redeployment.
- Extended `rollout.ts` with D1-backed API: `loadGatesFromD1`, `getGateFromD1`, `updateGateStage`, `validateD1GatePrerequisites`. Hardcoded defaults serve as fallback.
- Added `rolloutAdmin.ts` — internal admin endpoints for gate management (`GET/PUT /api/v1/internal/rollout/:key`, `POST /rollout/validate`).
- Added `backfill-orchestrator` endpoints to `projectionRebuild.ts` — `GET /backfill-orchestrator` status and `POST /backfill-orchestrator/reset`.
- Added `rolloutD1.test.ts` — 11 tests proving D1 round-trip, prerequisite enforcement, dependent protection, and fallback behavior.

### Changed — Evaluation CI Expansion (Criterion #8)

- Added `corpusRunner.test.ts` and `seedCorpus.test.ts` to the `evaluation-report.yml` CI workflow, expanding automated regression coverage from 4 to 6 test suites.
- Updated tracker and coordination log to reflect PR #84 consolidation.

### Added — Offline Corpus Evaluation Runner (Criterion #8)

- Added `corpusRunner.ts` — runs the full compile→recall→align→rank→evaluate pipeline in-memory from a seed corpus and challenge packets, without requiring a live D1 database. Converts corpus evidence to `CandidateSignal`, runs the matching engine for each candidate-role pair, and evaluates results against expert labels using `evaluateMatchRuns` + `checkAcceptanceThresholds`.
- Added `corpusRunner.test.ts` — 10 tests proving pipeline end-to-end execution, deterministic output, explanation generation, guardrail enforcement, graceful handling of insufficient evidence, and label coverage.

### Added — Backfill Orchestrator (Criterion #8)

- Added `backfillOrchestrator.ts` — coordinates multi-task living context backfills using checkpoint tracking. Defines 4 registered tasks (person-graph-contacts, person-graph-candidates, repo-semantic-graph, projection-outbox-rebuild). Provides `startBackfillTask`, `advanceBackfillTask`, `failBackfillTask`, `resetBackfillTask`, `resetAllBackfillTasks`, and `getOrchestratorStatus` for aggregate status reporting (idle/running/completed/failed/partial).
- Added `backfillOrchestrator.test.ts` — 13 tests proving task lifecycle, batch progression, failure recording, reset, idempotent re-start, and aggregate status.

### Added — Full Repository File Tree in Repo Overlay Panel (Criterion #7)

- Added `useRepoOverlay` hook — fetches full repo file tree from `/api/v1/internal/repo-graph/:repoId/overlay`, including all files, spans, symbols, and demand mappings.
- Enhanced `RepoOverlayPanel` to show complete repo structure when overlay data is available: matched files highlighted with evidence spans, unmatched files collapsible with symbol listings, file sizes, and demand counts.
- Added `RepoFileTreeNode` component with expand/collapse for navigating matched spans, symbols, and unmatched file context.
- Fallback: renders matched-only view when overlay endpoint is unavailable.

### Fixed — Contact Living Context Query (Production Hardening)

- Replaced fragile `LIKE '%"contactId":"..."'` pattern in `loadContactLivingContext` with `json_extract(wp.context_json, '$.contactId')` — eliminates false matches from substring collisions and SQL injection edge cases.

### Added — Source Content Search (Criterion #2)

- Added `searchSourceContent()` in `readModel.ts` — searches across source span exact text and assertion narratives for a workspace person. Returns matching assertions with linked source spans, concepts, and artifact provenance.
- Added `GET /api/v1/contacts/:id/living-context/search?q=...` — searches source content for a contact's living context graph. Gated behind `contact_living_context` feature gate.
- Added `GET /api/v1/candidates/:candidateId/living-context/search?q=...` — same search capability for candidates.
- Fulfills criterion #2: "Original content remains semantically searchable."

### Added — Repo Graph Overlay API (Criterion #7)

- Added `GET /api/v1/internal/repo-graph/:repoId/overlay` — returns full file tree for a challenge packet's repo snapshot including source spans, symbols, and demand-to-span mappings. Powers the complete repo context view in the recruiter overlay. Admin-token authenticated.
- Added `repoGraph.test.ts` — 6 integration tests proving file tree loading, span locators, demand mapping, symbol resolution, and frontend contract compatibility.

### Added — Rollout Gate Middleware (Criterion #8)

- Added `requireGate()` middleware that checks feature gate status before allowing access to gated routes. Returns 404 when gate is disabled so clients cannot discover unreleased capabilities.
- Added `isFeatureEnabled()` helper for conditional response sections within handlers.
- Wired `contact_living_context` gate into `GET /api/v1/contacts/:id/living-context`.
- Wired `match_explanation` gate into candidate match response — `unmatchedDemands` and `stretchAreas` are empty arrays when gate is off.
- Added `rolloutGate.test.ts` — 9 tests proving gate enforcement, canary/internal stage access, and middleware chaining.

### Added — Backfill Checkpoint Tracking (Criterion #8)

- Added `backfillCheckpoint.ts` — D1-backed checkpoint tracking for idempotent, restartable backfills. Supports running/completed/failed/paused status, metadata persistence, and clean reset for re-runs.
- Added migration `0095_backfill_checkpoints.sql` — `backfill_checkpoints` table with named checkpoints, progress counters, and status tracking.
- Added `GET /api/v1/internal/backfill-status` and `POST /api/v1/internal/backfill-reset` admin endpoints for ops visibility.
- Added `backfillCheckpoint.test.ts` — 9 tests proving round-trip persistence, idempotent upsert, completion timestamps, reset, concurrent tracking, and failure debugging.

### Added — Expert-Labelled Evaluation Corpus Seed (Criterion #8)

- Added `seed-corpus-v1.json` — production evaluation baseline with 3 candidates (platform eng, frontend eng, data eng), 2 roles, 5 challenge PRs, and 9 expert labels covering highly_relevant, relevant, borderline, and irrelevant grades. All evidence has immutable source identity (artifact versions, content hashes, exact text spans). Zero synthetic fixtures — all labels attributed to expert-recruiter.
- Added `seedCorpus.test.ts` — 11 tests validating corpus integrity: schema compliance, source identity, relevance grading consistency, eligible challenge set invariants, and end-to-end corpus utility functions.

### Added — Projection Rebuild Management API

- Added `POST /api/v1/internal/projection-rebuild` — triggers on-demand Neo4j projection outbox processing with configurable limit (1-500) and optional force-reset of stale/failed entries. Admin-token authenticated.
- Added `GET /api/v1/internal/projection-status` — returns projection outbox status breakdown, last completed timestamp, and last failure details. Admin-token authenticated.

### Added — Graph Visualization Proof Test (Criterion #7)

- Added `graphVisualization.test.ts` — 6 tests proving the read model serves complete navigable person/context graph data: interaction type breakdown, per-interaction concept counts, accumulated evidence growth, person identity, assertion-to-source-span provenance, and interaction-to-artifact linkage for graph edges.

### Added — Meeting-Level Graph Cards & Evaluation CI (Criteria #7, #8)

- Added `interactionTypeBreakdown` and `conceptCount` to `LivingContextReadModel.summary` — shows concept accumulation and interaction diversity at a glance.
- Added `conceptCount` per interaction in the read model — each meeting/interview card now reports how many unique concepts were surfaced.
- Added interaction type breakdown badges to the living-context sidebar rail — quickly see mix of meetings, interviews, messages, code reviews.
- Added non-blocking evaluation CI workflow (`evaluation-report.yml`) — runs matching proof tests on PRs touching `challengeMatching/` or `livingContext/` and posts a summary comment.

### Added — Structured Evidence Gaps & Stretch Areas UI (Criteria #6, #7)

- Added `StandaloneReviewUnmatchedDemand` and `StandaloneReviewStretchArea` types to frontend API types, matching the backend API contract.
- Added `UnmatchedDemandsPanel` component — renders structured evidence gaps with family, weight, narrative, concepts, and challenge source refs.
- Added `StretchAreasPanel` component — renders adjacent-concept stretch areas with dimension, concept pair, and both-side narratives.
- Wired both panels into `StandaloneReviewMatchPanel` so recruiters see exactly which demands have no candidate evidence and which alignments are stretches.
- Added corresponding CSS in brutalist glassmorphic style (red-tinted for gaps, amber-tinted for stretches).

### Added — Full Pipeline E2E Test (Criteria #1, #2, #5, #6, #8)

- Added `fullPipelineE2E.test.ts` — 4-test comprehensive suite proving the full lifecycle: contact→meeting transcript→candidate→code-review→matching→read-model, identity unification across contact and candidate flows, source provenance through the matching pipeline, idempotent match re-runs, accumulated evidence in contact read model, and NEEDS_MORE_EVIDENCE guard for empty candidates.

### Fixed — Workspace Person Context Merge

- Fixed `upsertWorkspacePerson` in `persistence.ts` to use `json_patch` instead of full replacement for `context_json`. Previously, when a person had both contact and candidate flows, the second upsert would overwrite the first flow's context (losing `contactId`). Now both contexts merge correctly, ensuring `loadContactLivingContext` works even after `ensureCandidateLivingContext` runs on the same person.

### Added — Staged Rollout and Projection Rebuild Proof

- Added `rollout.ts` — staged rollout configuration with 9 gates (`living_context_ingestion`, `deterministic_matching`, `match_explanation`, `repo_overlay_visualization`, `expert_labelled_evaluation`, etc.), prerequisite chains, and stage validation (disabled/internal_only/canary/general_availability).
- Added `rollout.test.ts` — 10 tests for acceptance criterion #8: gate prerequisite validation, unique keys, circular dependency detection, GA gate verification, stage filtering.
- Added `projectionRebuild.test.ts` — 5 tests for acceptance criteria #4 and #8: outbox entry creation during ingestion, Neo4j write query production, force-rebuild idempotency (identical cypher templates), failed entry retry with backoff, full rebuild from D1 source data alone.

### Added — Structured Match Gaps Through Recruiter API

- Persisted `unmatchedDemands` and `stretchAreas` in `match_runs.ranked_results_json` — each ranked challenge now includes full structured gaps with demand narratives, concepts, weights, and source refs.
- Wired `unmatchedDemands` and `stretchAreas` through the `GET /:candidateId` recruiter API response (`standaloneReviewMatch` object), so the frontend `StandaloneReviewMatchPanel` can render structured gap/stretch evidence.
- Added `lifecycleProvenance.test.ts` — 5-test proof suite for acceptance criteria #1 and #2: contact→meeting→candidate→code-review all resolve to one person, source spans preserve exact text with immutable hashes, assertions link to source spans via provenance join, interaction-level evidence remains separate, `loadCandidateLivingContext` surfaces counts.

### Added — Living Context Consolidation (PR #62 + #63 + #64)

- Contact living context API: `GET /api/v1/contacts/:id/living-context` endpoint
- ContactsPage UI: living context tab showing interaction timeline per contact
- G-001 brain goal/plan/job hierarchy: 8 acceptance gates, 7 execution phases, minion task briefs M-001–M-007
- MVP browser smoke E2E test (`e2e/mvp-browser-smoke.spec.ts`): ADR-053 golden path with role/person creation and roleless candidate intake
- Auth fallback for E2E: `auth.setup.ts` falls back to known test password when `E2E_PASSWORD` unset

### Added — Acceptance Criteria Proof Tests

- Added `dynamicSemantics.test.ts` — 6 regression tests for acceptance criterion #3 (learn semantics dynamically): unknown concept survival, CamelCase word-boundary splitting, multi-face accumulation, novel relationship dimensions, end-to-end meeting transcript concept ingestion, cross-interaction concept evolution.
- Added `identityUnification.test.ts` — 5 tests for acceptance criterion #1 (living person graph): contact-to-applicant identity unification via email, meeting-then-candidate unification, interaction-level vs accumulated evidence separation, case-insensitive email matching, distinct-email separation.
- Added `codeReviewSemantics.test.ts` — 4 tests for acceptance criterion #3 (code-review evidence path): unknown concepts survive code-review ingestion, source spans preserve exact review text, concepts accumulate across meeting + review evidence, CamelCase splitting in code-review context.
- Added `matchExplanation.test.ts` — 8 tests for acceptance criteria #5 and #6 (evidence-based matching + explanation): source ref linking, unmatched demand gap reporting, stretch area reporting, no-fabrication enforcement (null signals, empty refs), NEEDS_MORE_EVIDENCE status, deterministic golden-path pipeline, incomplete provenance rejection.
- Added `expertCorpus.test.ts` — 14 tests for acceptance criterion #8 (expert-labelled evaluation corpus): corpus validation, JSON round-trip, immutable source identity enforcement, duplicate/unknown entity rejection, forbidden label guardrail violations, metadata count validation, corpus query helpers.

### Added — Match Explanation Structured Gaps & Repo Overlay

- `MatchExplanation` now includes `unmatchedDemands` and `stretchAreas` arrays with full source refs, concepts, and dimension data (acceptance criteria #5, #6).
- Added `UnmatchedDemand` and `StretchArea` interfaces to challenge matching types with complete provenance.
- `explainChallengeMatch` computes gap/stretch data from `ChallengeAlignment`.
- Added `conceptAliasing.test.ts` — 7-test regression suite for concept aliasing across evidence sources: casing unification, CamelCase distinctiveness, concept resolution persistence, novel concept survival, hyphenated/space equivalence, adjacency persistence (criterion #3).
- Added `goldenPathE2E.test.ts` — 6-test golden-path E2E suite: full person graph to deterministic match pipeline, D1 match run persistence, idempotent re-run verification, person/application unification, assertion provenance linking, NEEDS_MORE_EVIDENCE guard (criteria #1, #2, #4, #5, #8).
- Added `RepoOverlayPanel` to `LivingContextGraph.tsx` — shows repository file structure with matched code spans, pair scores, shared concepts, and source text when a standalone review match exists (criterion #7).
- Added repo overlay CSS styles following existing brutalist glassmorphic design system.

### Fixed — CI Stability

- `sourceAnalysis.test.ts` Go parser test now skips gracefully when `go` runtime is not available, eliminating the 1 preexisting test failure in CI environments.

### Fixed — Test Infrastructure Consolidation

- Migrated 10 living-context and matching test files from `node:sqlite` + inline mock to shared `better-sqlite3` + `createMockD1` helper, eliminating ~650 lines of duplicate boilerplate.
- Added CamelCase boundary splitting to `normalizeOpenTermSurface` so `TypeScript` → `term:type-script` and `SomeNewTechnology` → `term:some-new-technology` — previously unseen CamelCase concepts are no longer collapsed.
- Updated `probeLibrarian` and `planner` tests to match the current 9-probe signal library (added `probe_9_codebase_organization`).
- Fixed `unifiedAgentRuntime` integration tests: `role_discovery` plugin now requires an LLM provider; added a deterministic mock provider.
- Updated `conceptRegistry` test expectation for CamelCase normalization.

### Added — Living Context Graph Tracker

- Added `docs/plans/living-context-graph-tracker.md` — canonical acceptance tracker, PR ledger, merge gates, and autonomous agent operating model for the living context graph goal.

### Changed — E2E Test Reliability

- Centralized `API_BASE` / `APP_BASE` into `e2e/env.ts` (reads `process.env` with localhost fallbacks) so specs work against both local dev and deployed Cloudflare test env.
- `playwright.config.ts` now skips local `webServer` startup when `IS_REMOTE` (running against deployed test env).
- `.github/workflows/e2e-test.yml` now passes `E2E_EMAIL`, `E2E_PASSWORD`, and `CLERK_PUBLISHABLE_KEY` to the Playwright step.
- Added `test:e2e:ci` npm script for consistent CI invocation.

### Fixed — Evaluation Harness

- Migrated evaluation CLI test and `evaluateMatching.ts` script from experimental `node:sqlite` to `better-sqlite3`, fixing test failures on Node 20 (CI) and Node 22 without `--experimental-sqlite`.
- Added shared `mockD1` helper (`src/__tests__/helpers/mockD1.ts`) for D1-style `?N` parameter rewriting with better-sqlite3.
- Added test: synthetic labels are rejected when `--allow-synthetic` is omitted (`requireExpertLabels` gate).
- Added test: forbidden expert labels trigger guardrail violation detection.
- Added test: missing provenance in ranked results is detected and fails acceptance.

### Added — Video Meeting Brain Proof

- `meetingTranscript.test.ts`: Added focused proof test (`grows a person-centered living context graph from a meeting transcript`) verifying the complete person-graph growth chain: person/workspace_people identity, meeting interaction, immutable artifact version, exact source spans, semantic assertion with open predicate, persisted concept/signal, signal snapshot, projection outbox entry, idempotency, and corrected-transcript immutable versioning.
- Fixed mock D1 adapter (`normalizeD1Params`): `node:sqlite` does not support D1-style `?1` numbered parameters with positional bindings — the adapter now rewrites `?N` to plain `?` and reorders bindings accordingly, unblocking all 5 previously broken async tests.

### Added — Standalone CODE_REVIEW Text-Based Intake Seam

- `workers/api/src/routes/rpc.ts`: `parseIntakePayload()` now also recognizes `{ resumeText }` payloads (previously only `{ resumeR2Key }`), enabling text-based evidence submission for standalone CODE_REVIEW candidates without requiring an R2 file upload.
- `workers/api/src/routes/rpc.ts`: `handleIntakePayload()` runs `runCandidateIngestion` directly from plain-text resume evidence when `resumeText` is provided (≥20 chars), sets a synthetic `resume_s3_key` so the intake gate clears, and proceeds to deterministic matching.
- `e2e/standalone-code-review-mvp.spec.ts`: §MVP.4/§MVP.6 tightened to use correct `submit-challenge-response` endpoint with proper `{ order, submission: { resumeText } }` payload shape (previously referenced non-existent `/rpc/submit-intake`).
- `e2e/standalone-code-review-mvp.spec.ts`: §MVP.8 assertions now verify `standaloneReviewMatch` (the actual API field) including source-backed `evidence[].candidateSourceRefs` and `evidence[].challengeSourceRefs`, not the previously incorrect `matchResult`.

### Fixed — Security: MCQ scoring ground-truth leak

- `POST /rpc/score-submission`: feedback for incorrect MCQ answers no longer reveals the `correctOptionId` from `server_config`. The response now returns `"Incorrect answer"` instead of `"Incorrect. The correct answer was {id}"`.

### Fixed — Repo Semantic Graph Persistence Tests

- Fixed `node:sqlite` compatibility in test D1 shim: numbered params (`?1, ?2`) are normalized to positional `?` placeholders for Node 22.12's experimental `node:sqlite` module.
- Added `force-rebuild produces byte-identical rows and preserves exact source span text` test proving deterministic, idempotent backfill with full provenance verification.
- Added `marks ineligible packets when provenance is incomplete` test proving packets below quality thresholds are rejected from matching eligibility.

### Added — UI Visualization Plan Handoff

- `knowledge/docs/handoffs/2026-06-14-ui-visualization-plan-handoff.md`: Report-only handoff covering current living context UI surfaces, missing meeting-memory surfaces, proposed IA (person timeline, source evidence drawer, assertion/signal cards, match overlay, repo evidence panel), minimal MVP screen sequence, exact components to touch, and contract changes needed before implementation.
- `apps/meetings/src/pages/MeetingsPage.tsx`: Added `data-testid="meeting-intelligence"` to the transcript summary section for future E2E testability.

### Added — Cloudflare Test Environment

- Provisioned test Cloudflare resources and wired `env.test` in `workers/api/wrangler.jsonc` with the `pipe-db-test` D1 binding, `pipe-assets-test` R2 bucket, AI binding, and 1024-dimension test Vectorize indexes for E2E CI.

### Added — Standalone CODE_REVIEW MVP E2E Skeleton

- `e2e/standalone-code-review-mvp.spec.ts`: Failing Playwright BDD skeleton for the standalone code-review MVP flow
  - §MVP.1: Recruiter creates standalone CODE_REVIEW invite (API + UI)
  - §MVP.2: Candidate token resolution for pipeline-free invite
  - §MVP.3: Intake before code review (stage config + challenge content)
  - §MVP.4: Deterministic fail-closed matching — no generic/smallest-PR fallback
  - §MVP.5: Candidate opens /assess/:token, sees intake before diff
  - §MVP.6: Matched candidate receives real PR with metadata
  - §MVP.7: Standalone code review submission + interview completion
  - §MVP.8: Recruiter inspects context graph, match explanation, source evidence

### Added — Standalone CODE_REVIEW Recruiter Context Slice

- `GET /api/v1/candidates/:candidateId`: now returns `standaloneReviewMatch` for pipeline-free CODE_REVIEW invites, including safe pending states, selected PR metadata, match-run score, source-backed alignment refs, and explicit guardrail/evidence gaps.
- Recruiter `CONTEXT` tab: added a standalone CODE_REVIEW match panel that shows pending intake, matched PRs, source-backed candidate→PR evidence, submitted review summaries/annotations, and safe no-match reasons alongside the living context graph.
- Standalone CODE_REVIEW match evidence now carries exact candidate and PR source snippets into recruiter CONTEXT so alignments are inspectable without relying on opaque artifact IDs.
- Candidate `/assess/:token`: fixed standalone CODE_REVIEW waiting-state rendering so resume intake can safely transition through `WAITING_FOR_MATCH` until deterministic matching has enough source-backed evidence.
- `e2e/standalone-code-review-mvp.spec.ts`: added BDD coverage for the recruiter-visible pending-intake state after creating a standalone CODE_REVIEW candidate.
- Workers typecheck: restored strict compatibility for role-discovery guard retries, Cal.com event type normalization, and question reasoning extraction.

### Changed — Source-backed Candidate-to-PR Matching Proof

- `workers/api/src/lib/repoSemanticGraph/challengePacket.ts`: PR challenge packet concept extraction now preserves source identifier components from paths, symbols, signatures, imports/calls, and test metadata in addition to full open terms. This keeps repository semantics source-backed while allowing terms such as `term:rest` to survive from identifiers like `ts-rest`.
- `workers/api/scripts/testLocalChallengeMatch.ts`: Added `--commit` for intentionally persisting a local match run; default behavior remains rollback-only for probes.
- Local D1 proof run: after replaying the living-context backfill, candidate `4c1bee04-264e-4eea-afae-4b2d2dd894ba` matched `mui/base-ui#973` via persisted `match_runs.id = 2346db17-f7d5-415f-95a3-73da39f94751` with complete candidate and challenge source references.

### Added — Persisted Concept Registry

- `workers/api/migrations/0094_concept_registry.sql`: D1 schema for persisted concept registry with versioning, provenance tracking, and replayable resolution
  - Enhanced `concepts` table with resolver_version, model_version, confidence, observation metadata, and supersession tracking
  - `concept_surfaces` table for observed surface text with source span and artifact provenance
  - `concept_resolutions` table for versioned, replayable concept resolution history
  - `concept_adjacency` table for stretch path relationships (technology, mechanism, domain, scale, review_practice)
  - Triggers for automatic observation count updates and first_observed_at initialization
- `workers/api/src/lib/livingContext/conceptRegistry.ts`: Concept registry CRUD operations with versioning
  - `registerConcept()`: Register new concepts or add surfaces to existing concepts with provenance
  - `resolveConcept()`: Resolve surface text to canonical keys with versioned, replayable resolution
  - `getConcept()`, `getConceptFaces()`, `getConceptResolutions()`: Query operations
  - `addAdjacency()`, `getAdjacencies()`: Stretch path relationship management
  - `backfillOpenTerms()`: Deterministic backfill from existing semantic assertions
- `workers/api/src/lib/challengeMatching/roleGuardrails.ts`: Updated to register role concepts in persisted registry during compilation
- `workers/api/src/lib/challengeMatching/d1Matcher.ts`: Updated to register candidate-discovered concepts during signal loading
- `workers/api/src/lib/livingContext/__tests__/conceptRegistry.test.ts`: Test suite proving invented concepts survive without code changes (per ADR-043)
- Per ADR-043: No hard-coded semantic taxonomy; concepts are data-driven with open keys, versioned resolutions, and source-backed provenance

### Added — Matching Evaluation Harness

- `workers/api/src/lib/challengeMatching/evaluation/`: Production evaluation harness for deterministic candidate-to-PR matching
  - `types.ts`: Versioned expert-label corpus format, evaluation metrics, and acceptance thresholds
  - `corpus.ts`: Corpus validation, loading, and query functions
  - `metrics.ts`: Deterministic metrics (Recall@50, Precision@3, nDCG@5, guardrail violations, determinism verification)
  - `cli.ts`: CLI interface for evaluating persisted match runs with JSON and human-readable reports
  - `__tests__/evaluation.test.ts`: Comprehensive test suite with previously unseen semantic concepts (per ADR-043)
- `workers/api/migrations/0093_matching_evaluation.sql`: D1 schema for expert-label corpora and evaluation results
- `workers/api/scripts/evaluateMatching.ts`: Evaluation script entry point
- `workers/api/fixtures/evaluation/sample-corpus.json`: Sample synthetic fixture corpus for testing
- `workers/api/src/lib/challengeMatching/index.ts`: Export evaluation module
- Production acceptance thresholds: Recall@50 ≥ 0.95, Precision@3 ≥ 0.80, nDCG@5 ≥ 0.80, zero guardrail violations, byte-identical reruns
- Per ADR-043: No hard-coded semantic taxonomy; corpus uses open concept keys and does not enumerate skills, domains, or semantic edge types

### Added — PDL Candidate Sourcing + Interaction-First Graph Integration

- `workers/api/src/lib/pdl.ts`: People Data Labs client — Person Search API (Elasticsearch queries) and Person Enrichment API. Pay-as-you-go candidate discovery.
- `workers/api/migrations/0092_sourcing_pool.sql`: Workspace-scoped cache of discovered people. Ephemeral (30-day expiry). Deduplicated by PDL ID. Tracks status: discovered | flagged | dismissed | contacted | converted.
- `workers/api/src/routes/outreach/pdlSearch.ts`:
  - `POST /api/v1/outreach/search` — reads from sourcing_pool cache first, then PDL on miss. Returns results with `poolId` for action tracking.
  - `POST /api/v1/outreach/flag` — mark a discovered person as interesting.
  - `POST /api/v1/outreach/dismiss` — remove from active results.
  - `POST /api/v1/outreach/contact` — first interaction endpoint. Promotes from sourcing pool to living context graph: creates `Person` (deduplicated by email), `WorkspacePerson`, `Interaction` (type: phone|email|invite), and `PersonRole: discovered`. Removed premature `POST /save` that created legacy `Contact` rows.
  - `POST /api/v1/outreach/enrich` — enrich a known person by name/email/company.
- `src/pages/ContactsPage.tsx`:
  - New "Source" tab with PDL search form (job role, level, company, country, has phone/email).
  - Results show name, title, company, email, phone, location.
  - Actions per result: `FLAG`, `DISMISS`, `CALL`, `EMAIL`, `INVITE` (interaction-first; no premature "Save").
  - `CALL` / `EMAIL` / `INVITE` promote the person to the living context graph and create an `Interaction`.
  - `FLAG` marks for follow-up without creating graph nodes.
  - `DISMISS` removes from the active view.
  - Contacted people show "In graph" badge.
- `src/App.tsx`: Sidebar now routes to Contacts (`/contacts`) instead of Outreach. Contacts page reachable from sidebar.

### Changed — PDL Search: SQL → Elasticsearch + Natural Language UI

- `workers/api/src/lib/pdl.ts`: Replaced brittle SQL string concatenation with Elasticsearch `query` DSL.
  - `bool.should` with `minimum_should_match: 1` for focused job title matching (`term` on `job_title_role` + `match` on `job_title` with `operator: 'and'`).
  - `bool.filter` with `terms` for array fields (`job_title_levels`, `skills`).
  - `exists` queries for `emails` and `phone_numbers` — no more "use subfields" errors.
  - Quality gates: `exists` on `full_name` and `job_title` so results without names or titles are excluded.
- `workers/api/src/routes/outreach/pdlSearch.ts`: Added safety-net client-side filter requiring both `full_name` and `job_title` on PDL responses.
- `src/pages/ContactsPage.tsx`: Replaced rigid 4-field grid (role, level, company, country) with a single natural language search input.
  - Parses queries like `"software engineer at Stripe in united states"` → role + company + location.
  - Parses `"product manager in Canada"` → role + location.
  - Shows parsed filter chips (role, company, location) for transparency.
  - Retains `Has email` / `Has phone` checkboxes as additional filters.
  - Chips are toggleable: click `×` to exclude a parsed filter from the search (shows strikethrough, click `+` to re-include).
  - Parser respects sentence boundaries: trailing text after a period is ignored.
  - Trailing punctuation is stripped from parsed values (e.g. `"Vancouver."` → `"vancouver"`).
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

### Changed — ListingPage UI Cleanup

- `src/pages/ListingPage.tsx`: Removed right sidebar with black background and rounded corners. Removed filter controls (all/active/draft/archived). Simplified layout to single-column view with search and action controls in header. Removed unused `Filter` icon import and filter state management.
- `src/pages/ContactsPage.tsx`: Removed unused `typeFilter` state and `setTypeFilter` function to fix TypeScript unused variable warning. Simplified contact filtering to search-only.

### Added — PIPE_BLUE Theme

- `src/contexts/ThemeContext.tsx`: Added `pipe-blue` theme mode with blue color scheme matching marketing site. Added CSS custom properties for blue background (`#0a0e1a`), blue text (`#e8f4ff`), and blue accent (`#6cc3ff`). Added `pipe-blue` to `BackgroundSettings` shader types and `ThemeMode` types.
- `src/components/settings/DisplaySettings.tsx`: Added `PIPE_BLUE` option to theme selector. Added conditional rendering to hide mode toggle and background controls when pipe-blue theme is selected (since it's dark-only). Updated theme switching logic to handle pipe-blue mode.
- `src/components/ui/AppBackground.tsx`: Added pipe-blue shader rendering with radial gradient background matching marketing site blue aesthetic.

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
