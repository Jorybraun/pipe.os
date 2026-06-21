# Handoff: Standalone Code Review MVP and Architecture Backbone

**Date:** 2026-06-14
**Status:** Active, incomplete
**Primary goal:** Preserve the full living-context + deterministic candidate-to-PR
matching objective while carving out the first functional MVP slice.

## Why This Handoff Exists

The broader work is important and easy to fragment under usage limits. Do not
lose the north star:

PIPE-OS must become a source-backed intelligence system where contacts and
applicants are the same evolving person graph; every resume, meeting,
transcript, message, assessment, role requirement, repository assertion, match,
and explanation links to exact immutable source evidence; semantic concepts and
relationships are persisted open data; real repositories decompose into
source-backed semantic graphs; and matching deterministically selects a specific
reviewable PR challenge or fails closed.

The immediate MVP is narrower:

> A recruiter can invite a person by email to a standalone code-review challenge
> outside any pipeline or role. The candidate provides source evidence, PIPE
> ingests that evidence into the living context graph, deterministically matches
> the person to a specific reviewable PR, the candidate completes the
> assessment, and the recruiter can inspect the source-backed result.

## Source Documents

- Canonical plan: `knowledge/plan/living-context-repo-matching-plan.md`
- Previous handoff: `knowledge/docs/handoffs/2026-06-13-living-context-repo-matching-handoff.md`
- Load-bearing ADR: `knowledge/docs/decisions/current/ADR-043-no-hard-coded-semantic-taxonomy.md`
- Living context schema: `workers/api/migrations/0082_living_context_graph.sql`
- Repo graph and match runs: `workers/api/migrations/0083_repo_semantic_graph_and_match_runs.sql`
- Evaluation schema: `workers/api/migrations/0093_matching_evaluation.sql`
- Concept registry schema: `workers/api/migrations/0094_concept_registry.sql`

## Non-Negotiable Invariants

- D1 and immutable artifacts are authoritative.
- Neo4j, vector indexes, and graph/search views are rebuildable projections.
- Original content remains stored and searchable.
- Every assertion links to an exact source span.
- Every match alignment links to both candidate source evidence and repository
  source evidence.
- Unknown semantic concepts survive ingestion as persisted open data.
- No hard-coded skills, signal taxonomies, semantic aliases, domains, node
  types, or meaning-bearing edge whitelists.
- No fabricated seniority, default evidence strength, generic repository
  fallback, smallest-PR fallback, or embedding-only match eligibility.
- Missing evidence returns an explicit state such as `NEEDS_MORE_EVIDENCE`.
- No safe challenge returns `NO_ROLE_SAFE_CHALLENGE`.
- Ground truth, planted bugs, scoring rubrics, storage keys, and internal IDs
  never leave server-side trust boundaries.

## Current MVP Product Path

### Recruiter Entry

Current available UI path:

`/schedule` -> `INVITE CANDIDATE` -> select `CODE_REVIEW`

Relevant files:

- `src/components/Scheduling/SchedulingDashboard.tsx`
- `src/components/Scheduling/InviteCandidateModal.tsx`
- `workers/api/src/routes/cockpit/candidates.ts`

Backend route:

- `POST /api/v1/candidates`

The standalone create path supports a candidate with `pipeline_id = NULL`. When
`interviewType: CODE_REVIEW` is provided, it creates a `scheduled_interviews`
row with no pipeline or stage.

### Candidate Entry

Candidate-facing route:

`/assess/:token`

Relevant files:

- `src/App.tsx`
- `src/pages/CandidateAssessmentPage.tsx`
- `src/components/Assessment/IntakeChallenge.tsx`
- `src/components/Assessment/WaitingForMatch.tsx`
- `src/components/Assessment/CodeReviewChallenge.tsx`
- `workers/api/src/routes/rpc.ts`

Standalone behavior:

- If the candidate lacks resume/profile evidence, serve `INTAKE`.
- If candidate evidence exists and a standalone code-review row exists, attempt
  deterministic PR matching.
- If matching succeeds, serve `CODE_REVIEW`.
- If matching cannot safely select a PR, serve `WAITING_FOR_MATCH`.

### Recruiter Review

Recruiter route:

`/candidates/:id`

Relevant files:

- `src/pages/CandidateProfilePage.tsx`
- `src/components/Candidate/LivingContextGraph.tsx`
- `src/hooks/useLivingContext.ts`
- `workers/api/src/routes/cockpit/candidates.ts`

Expected recruiter views:

- `PROFILE` tab for candidate summary and assessment link.
- `CONTEXT` tab for interactions, artifacts, assertions, signals, exact source
  quotes, and accumulated evidence.
- Code-review result/review-session report where available.

## Current UI Gap

There are two invite concepts:

1. `/schedule` -> `INVITE CANDIDATE`
   - Creates a standalone candidate.
   - Can select `CODE_REVIEW`.
   - This is the current MVP path.

2. `/contacts` -> `SOURCE` -> `INVITE`
   - Promotes a sourced person/contact interaction into the graph.
   - It does not clearly create a standalone code-review assessment invite.

For MVP clarity, either:

- make `/schedule` the explicit tested path, or
- add a clearer action from Contacts/Talent Pool: `Invite to standalone code review`.

Do not conflate sourcing outreach with assessment invitation unless the product
intentionally performs both operations.

## Critical Architecture Goals

### 1. Canonical Living Person Graph

Contacts, applicants, sourced people, candidates, interviewees, and assessed
people must resolve to one evolving graph:

- `Person`
- `WorkspacePerson`
- `Application`
- `PersonRole`
- `Interaction`
- `Artifact`
- `ArtifactVersion`
- `SourceSpan`
- `Episode`
- `SemanticAssertion`
- `SignalEvidence`
- `SignalSnapshot`
- `SemanticRelationship`

Done means a sourced contact and an applicant with the same identity land on
the same `Person`, while workspace-private context and application process
state remain separate.

### 2. Immutable Source Evidence

Every conclusion must be reconstructable from original content:

- resume line or paragraph,
- call transcript segment,
- meeting transcript paragraph,
- code-review answer span,
- assessment response,
- recruiter note,
- PR hunk,
- file/symbol span,
- role requirement source section.

Generated scorer output is an artifact, not candidate-authored truth.

### 3. Open Concept Registry

Semantic meaning is data:

- concepts,
- observed surfaces,
- aliases/resolutions,
- resolver versions,
- confidence,
- concept adjacency/stretch paths,
- provenance.

Unknown concepts must persist without code changes. Resolver changes must be
replayable from immutable evidence.

### 4. Repository Semantic Graph

Repositories and PRs must decompose into:

- repo snapshots,
- source artifacts,
- artifact versions,
- exact source spans,
- symbols,
- structural facts,
- code episodes,
- semantic assertions,
- facets/signals,
- challenge packets.

Do not rely on generic repo summaries. Unsupported languages should remain
source-preserved, not discarded.

### 5. Deterministic Candidate-to-PR Matching

The matcher must:

- compile candidate atoms from complete source-backed living-graph evidence,
- compile role constraints from persisted role evidence when roles exist,
- use persisted concept resolution/adjacency,
- align evidence to PR demands non-duplicatively,
- persist the run and snapshots,
- select a specific PR or fail closed.

Allowed final statuses:

- `MATCHED`
- `NEEDS_MORE_EVIDENCE`
- `NO_ROLE_SAFE_CHALLENGE`

### 6. Match Explanation and Evidence UI

Recruiters must see why a match happened:

- selected repo/PR,
- score components,
- aligned candidate evidence,
- aligned PR demands,
- candidate source refs,
- repository source refs,
- missing evidence,
- stretch areas,
- rejected challenge reasons.

Never present a naked aggregate score without its source trail.

### 7. Backfills and Rebuildable Projections

Backfills must be deterministic and idempotent:

- living-context backfill,
- concept-registry backfill,
- repo challenge packet backfill,
- match-run regeneration/evaluation data,
- projection rebuilds.

Running the same backfill twice must not duplicate semantic records.

### 8. Expert Evaluation and Rollout

Production readiness requires:

- frozen expert-labelled corpus,
- candidate-role-PR labels,
- guardrail cases,
- missing-evidence cases,
- unseen concepts,
- independent deterministic reruns,
- persisted evaluation results.

Acceptance thresholds:

- Recall@50 >= 0.95
- Precision@3 >= 0.80
- nDCG@5 >= 0.80
- zero guardrail violations
- zero multi-stretch violations
- zero missing provenance
- byte-identical reruns

Rollout must support shadow mode, canaries, observability, and rollback.

## Manual MVP Test Script

### Test 1: Create standalone code-review invite

Location: `/schedule`

Steps:

1. Click `INVITE CANDIDATE`.
2. Fill `NAME`.
3. Fill `EMAIL`.
4. Select `CODE_REVIEW`.
5. Send invite.

Expected:

- Invite succeeds.
- Candidate row has `pipeline_id = NULL`.
- `scheduled_interviews` row has:
  - `candidate_id`,
  - `pipeline_id = NULL`,
  - `stage_id = NULL`,
  - `interview_type = CODE_REVIEW`,
  - `status = INVITED`.
- Candidate living context foundation is created.

### Test 2: Candidate opens invite

Location: `/assess/:token`

Expected if no resume/profile evidence exists:

- Secure session initializes.
- Candidate sees intake.
- Page includes `CANDIDATE_INTAKE_PROTOCOL`.
- Page includes resume upload.
- Page includes optional GitHub and LinkedIn fields.

### Test 3: Candidate submits source evidence

Location: `/assess/:token`

Steps:

1. Upload PDF/DOCX resume.
2. Optionally enter GitHub handle.
3. Optionally enter LinkedIn URL.
4. Click `CONTINUE`.

Expected:

- Upload succeeds.
- Intake submission succeeds.
- UI shows `INTAKE_COMPLETE`.
- Candidate evidence is persisted.
- Living context later shows source-backed artifacts/spans/assertions/signals.

### Test 4: PIPE matches or waits safely

Location: `/assess/:token`

Expected matched path:

- Candidate sees `CODE_REVIEW`.
- PR number appears.
- Diff appears.
- Review verdict panel appears.
- Review summary panel appears.

Expected fail-closed path:

- Candidate sees `WAITING_FOR_MATCH`.
- No generic PR appears.
- No smallest-PR fallback appears.
- No fake challenge appears.

### Test 5: Candidate completes code review

Location: `/assess/:token`

Steps:

1. Inspect diff.
2. Add comments/annotations if available.
3. Select verdict.
4. Fill review summary.
5. Submit.

Expected:

- Submit stays disabled until verdict and summary exist.
- Submission succeeds.
- Standalone scheduled interview becomes completed.
- Submission JSON is persisted.

### Test 6: Recruiter inspects context graph

Location: `/candidates/:id` -> `CONTEXT`

Expected:

- Graph loads.
- Interactions are visible.
- Artifacts are visible.
- Assertions are visible.
- Signals are visible.
- Source quote inspector shows exact evidence.
- Interaction-level and accumulated evidence are distinguishable.

### Test 7: Recruiter inspects result

Location: `/candidates/:id`

Expected:

- Code-review result is visible.
- If review-session report exists, recruiter can open it.
- Recruiter can answer:
  - which PR was selected,
  - why it was selected,
  - what source evidence was used,
  - what evidence was missing.

## MVP Acceptance Criteria

- Standalone invite can be created without a pipeline or role.
- Candidate can open `/assess/:token` without an account.
- Candidate is asked for source evidence before matching.
- Candidate-provided source content becomes immutable artifacts/source spans.
- Extracted assertions link to exact source text.
- Unknown concepts survive as open persisted terms.
- Matcher selects a specific PR or fails closed.
- No generic repo/smallest PR/fabricated evidence fallback exists.
- Candidate can complete a code-review assessment.
- Recruiter can inspect living context and assessment result.
- At least one full E2E test covers the standalone path.

## Cloud-Sized Workstreams

### Stream 1: Standalone MVP E2E

Task: Add Playwright coverage for standalone code-review invite through
recruiter result.

Likely file:

- `e2e/standalone-code-review-mvp.spec.ts`

Acceptance:

- Test covers recruiter invite, candidate intake, match/wait, code review, and
  recruiter context/result.
- Test asserts no generic fallback challenge.

### Stream 2: Repeatable Local Seed

Task: Make local standalone MVP data repeatable.

Likely files:

- `workers/api/scripts/backfillLivingContext.ts`
- `workers/api/scripts/backfillReviewChallengePackets.ts`
- `workers/api/scripts/backfillConceptRegistry.ts`
- `workers/api/scripts/testLocalChallengeMatch.ts`

Acceptance:

- Fresh local dev can seed one candidate evidence fixture and one
  production-ready PR packet.
- Replays are idempotent.
- A known candidate can match a known PR.

### Stream 3: Intake to Living Context Proof

Task: Prove standalone intake creates source-backed living context before
matching.

Likely files:

- `workers/api/src/routes/rpc.ts`
- `workers/api/src/lib/livingContext/*`
- `workers/api/src/lib/candidateDiscovery/*`
- `src/components/Candidate/LivingContextGraph.tsx`

Acceptance:

- Uploaded resume/profile appears in `CONTEXT`.
- Assertions have exact source spans.
- Unknown concepts persist.
- Replay does not duplicate records.

### Stream 4: Standalone Match Robustness

Task: Harden standalone matching statuses and persisted run visibility.

Likely files:

- `workers/api/src/routes/rpc.ts`
- `workers/api/src/lib/challengeMatching/d1Matcher.ts`
- `workers/api/src/lib/challengeMatching/engine.ts`

Acceptance:

- Matched path caches repo/PR.
- Failed paths show waiting/needs-more-evidence safely.
- No fallback PR appears.
- Match run contains complete ranked results and source refs.

### Stream 5: Recruiter Match Explanation UI

Task: Surface standalone PR match explanation on candidate profile.

Likely files:

- `src/pages/CandidateProfilePage.tsx`
- `src/lib/api/types.ts`
- `workers/api/src/routes/cockpit/candidates.ts`

Acceptance:

- Recruiter sees selected PR, score components, alignments, missing evidence,
  and source refs.
- Evidence links are clickable or inspectable.
- Naked score is not shown without evidence trail.

### Stream 6: Clear Standalone Invite Entry

Task: Make standalone code-review invite discoverable outside the Schedule page,
or explicitly productize Schedule as the MVP entry.

Likely files:

- `src/pages/ContactsPage.tsx`
- `src/components/Scheduling/InviteCandidateModal.tsx`
- possibly a shared `StandaloneInviteModal`.

Acceptance:

- Recruiter has an obvious "Invite to standalone code review" action.
- It posts to `POST /api/v1/candidates` with `interviewType: CODE_REVIEW`.
- Success links to candidate profile or assessment link.

## Recommended Execution Order

1. Stream 1: E2E skeleton.
2. Stream 2: repeatable local seed/backfill.
3. Stream 3: intake to living context proof.
4. Stream 4: standalone match robustness.
5. Stream 5: recruiter explanation UI.
6. Stream 6: clearer product entry.

## Verification Commands

Focused Worker tests:

```bash
cd workers/api
npx vitest run \
  src/lib/challengeMatching/__tests__/d1Matcher.test.ts \
  src/lib/challengeMatching/__tests__/challengeMatching.test.ts \
  src/lib/livingContext/__tests__/persistence.test.ts \
  src/lib/livingContext/__tests__/readModel.test.ts
```

Standalone E2E after wiring:

```bash
npx playwright test e2e/standalone-code-review-mvp.spec.ts
```

Full typecheck before claiming done:

```bash
npx tsc --noEmit
```

Do not pipe `tsc` output through commands that mask the exit code.

## Risks and Warnings

- The existing repo had a dirty `harness` submodule at this handoff creation.
- Do not reset, checkout, or delete files wholesale.
- Before editing shared files, re-read them.
- Do not add hard-coded semantic taxonomies.
- Do not create a demo fallback PR.
- Do not call the system production-ready until the full E2E passes.
- Standalone submission currently persists through `scheduled_interviews`; parity
  with pipeline review-session scoring/reporting may need follow-up.

## Definition of Done

This MVP is done when a tester can run the flow without manual database surgery:

Recruiter invites candidate to standalone code review -> candidate uploads
resume/profile evidence -> PIPE builds living context -> PIPE matches to a real
PR or waits safely -> candidate submits review -> recruiter opens candidate
profile -> recruiter sees context graph, selected PR, assessment result, and
source-backed evidence.

The broader architecture is done only when all interaction producers are
source-backed, repository graphs are source-backed and replayable, match
explanations cite both sides, projections rebuild from D1/artifacts, expert
evaluation meets thresholds, full E2E passes, and rollout completes under a
versioned policy with observability and rollback.
