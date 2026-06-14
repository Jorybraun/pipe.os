# Handoff: Living Context Graph and Candidate-to-PR Matching

**Date:** 2026-06-13
**Status:** Active, incomplete
**Repository:** `/Users/hans/Code/PIPE/PIPE-OS`
**Branch:** `main`, six commits ahead of `origin/main`
**Current HEAD:** `022482908 feat(matching): production evaluation harness for deterministic candidate-to-PR matching`
**Canonical plan:** `knowledge/plan/living-context-repo-matching-plan.md`
**Load-bearing decision:** `knowledge/docs/decisions/current/ADR-043-no-hard-coded-semantic-taxonomy.md`

## Original Goal

Build PIPE-OS's production-ready living context graph and deterministic
candidate-to-PR matching system end to end.

Contacts and applicants share one evolving person graph. Every resume, meeting,
transcript, message, assessment, role requirement, repository assertion, and
match remains linked to exact immutable source evidence.

Semantic concepts, signals, aliases, node types, and meaning-bearing edges must
be learned and persisted as open data, never hard-coded.

Decompose real repositories into source-backed semantic graphs, match people to
specific reviewable PR challenges, explain every alignment and evidence gap,
provide graph and match visualization, complete idempotent backfills and
rebuildable projections, and verify quality through expert-labelled evaluation
and full end-to-end tests.

### Acceptance Criteria

1. Build a living person graph.
   Contacts and applicants represent the same underlying person. Resumes,
   meetings, interviews, messages, and assessments continuously add context.
   Interaction-level and accumulated evidence remain separate.

2. Preserve original meaning.
   Every assertion links to an exact transcript paragraph, resume line, or
   assessment response. Original content remains semantically searchable. PIPE
   can always explain where a conclusion originated.

3. Learn semantics dynamically.
   No hard-coded skills, signals, domains, aliases, node types, or semantic
   edges. Previously unknown concepts survive ingestion. Concepts and
   relationships evolve through persisted evidence.

4. Understand repositories the same way.
   Decompose code into files, exact spans, symbols, structural facts,
   behavioral episodes, assertions, and signals. Preserve exact commit and
   line-level provenance. Do not rely on generic repository summaries.

5. Perform evidence-based matching.
   Represent candidate evidence, role requirements, and repositories using the
   same semantic model. Select a specific reviewable PR challenge. Eliminate
   fabricated seniority, default evidence, generic fallbacks, and
   embedding-only decisions.

6. Explain every match.
   Show which candidate evidence aligns with each code demand. Link both sides
   to their original sources. Report missing evidence and stretch areas.

7. Visualize the living graph.
   Provide a navigable person and context graph. Show evidence accumulating
   across interactions. Show repository structure and candidate-to-code
   overlays.

8. Prove production quality.
   Deterministic, idempotent backfills; fully rebuildable projections;
   expert-labelled evaluation; full end-to-end tests; controlled staged
   rollout.

## Non-Negotiable Invariants

- D1 and immutable artifacts are authoritative. Neo4j and vector stores are
  rebuildable projections.
- Original text is retained. Semantic assertions supplement source content;
  they never replace it.
- Every candidate, role, repository, and match assertion must have exact source
  provenance.
- Unknown concepts remain open, searchable data. They are not dropped because
  application code does not recognize them.
- No skill maps, default seniority, fabricated evidence strength, generic repo
  fallback, smallest-PR fallback, or embedding-only eligibility.
- A production match selects a specific PR challenge, not merely a repository.
- Missing evidence returns an explicit status. It must not silently manufacture
  a match.

## Current State

### Implemented Foundations

- Living context schema, deterministic persistence, immutable artifacts,
  artifact versions, exact source spans, episodes, assertions, evidence,
  snapshots, relationships, and projection outbox:
  - `workers/api/migrations/0082_living_context_graph.sql`
  - `workers/api/src/lib/livingContext/persistence.ts`
  - `workers/api/src/lib/livingContext/projection.ts`
  - `workers/api/src/lib/livingContext/readModel.ts`
- Contact/applicant compatibility and unified person foundations are committed.
- Meeting transcript ingestion is present and tested:
  - `workers/api/src/lib/livingContext/meetingTranscript.ts`
  - `workers/api/src/routes/meetingRooms.ts`
- Repository graph and PR challenge foundations are present:
  - `workers/api/migrations/0083_repo_semantic_graph_and_match_runs.sql`
  - `workers/api/src/lib/repoSemanticGraph/`
  - `workers/api/scripts/backfillReviewChallengePackets.ts`
- Deterministic challenge matching and persisted `match_runs` are present:
  - `workers/api/src/lib/challengeMatching/engine.ts`
  - `workers/api/src/lib/challengeMatching/d1Matcher.ts`
- The matcher no longer intentionally relies on fabricated seniority, default
  evidence, skill-to-package aliases, generic repository fallback, or
  smallest-PR fallback. Focused matcher tests passed during this session.

### Interaction Ingestion Added in the Current Worktree

- Culture interaction source preservation and backfill:
  - `workers/api/src/lib/livingContext/cultureTurn.ts`
  - `workers/api/src/lib/livingContext/cultureTranscriptBackfill.ts`
  - `workers/api/scripts/backfillLivingContext.ts`
- Phone call transcript, recording-state, and recruiter-note ingestion:
  - `workers/api/src/lib/livingContext/phoneCall.ts`
  - `workers/api/src/routes/screening/phone.ts`
- Code-review transcript and score-report ingestion:
  - `workers/api/src/lib/livingContext/codeReview.ts`
  - `workers/api/src/routes/assessment/review.ts`
  - `workers/api/src/routes/assessment/reviewSessions.ts`
  - `workers/api/src/lib/review/scoreAndPropagate.ts`
- The legacy code-review decomposition path was removed because it generated
  fixed semantic dimensions and candidate nodes without preserving the source
  semantics correctly:
  - `workers/api/src/lib/candidateDiscovery/decomposeCodeReview.ts`
  - `workers/api/src/lib/candidateDiscovery/backfillCodeReviewDecomposition.ts`

Code-review ingestion deliberately separates candidate-authored evidence from
agent, scorer, and recruiter output. Scorer reports are immutable generated
artifacts, not candidate truth.

### Living Graph Read Model and UI

The following work is present but has not received current browser/runtime QA:

- API endpoint: `GET /api/v1/candidates/:candidateId/living-context`
- Frontend types in `src/lib/api/types.ts`
- Hook: `src/hooks/useLivingContext.ts`
- Graph UI:
  - `src/components/Candidate/LivingContextGraph.tsx`
  - `src/components/Candidate/LivingContextGraph.css`
- Candidate profile `CONTEXT` tab in `src/pages/CandidateProfilePage.tsx`

The UI exposes interactions, artifacts, assertions, concepts, exact source
quotes, and interaction versus accumulated signal scores. It must still be
opened against real populated data and checked at desktop and mobile sizes.

## Evaluation Harness: Repaired in the Worktree

The evaluation library structure exists:

- `workers/api/src/lib/challengeMatching/evaluation/types.ts`
- `workers/api/src/lib/challengeMatching/evaluation/corpus.ts`
- `workers/api/src/lib/challengeMatching/evaluation/metrics.ts`
- `workers/api/src/lib/challengeMatching/evaluation/cli.ts`
- `workers/api/src/lib/challengeMatching/evaluation/__tests__/evaluation.test.ts`
- `workers/api/migrations/0093_matching_evaluation.sql`
- `workers/api/scripts/evaluateMatching.ts`

The hardened metric/types work covers:

- Recall@50 across all candidate-role pairs
- Precision@3
- nDCG@5
- forbidden-result violations
- multi-stretch violations
- exact provenance checks
- missing match-run failures
- independent comparison-run fingerprints
- expert versus synthetic label counts
- previously unseen concept keys

The current worktree now repairs the committed regression:

- `evaluation/cli.ts` loads frozen corpora and persisted match runs from D1.
- Candidate-role lookup supports stable `role_context_id` and versioned
  `role_snapshot_id`.
- Persisted ranked results fail closed when repository identity, PR number,
  source version, score components, eligibility, or provenance fields are
  absent.
- Separate comparison runs prove deterministic output rather than comparing a
  row with itself.
- `scripts/evaluateMatching.ts` provides executable local SQLite and remote D1
  adapters, corpus freezing, JSON/report output, and nonzero failure exits.
- `0093_matching_evaluation.sql` stores corpus hashes, prevents corpus update or
  deletion, and persists complete evaluation results.
- `evaluation/__tests__/cli.test.ts` exercises the actual CLI against a
  temporary SQLite database.

The executable help path is:

```bash
cd workers/api
node --import tsx scripts/evaluateMatching.ts --help
```

The harness infrastructure is now usable. Production evaluation is still not
complete because there is no real human-labelled corpus or real local
candidate-role-PR match run yet.

## Concept Registry Work: Reconciled in the Worktree

Concurrent work added:

- `workers/api/migrations/0094_concept_registry.sql`
- `workers/api/src/lib/livingContext/conceptRegistry.ts`
- `workers/api/src/lib/livingContext/__tests__/conceptRegistry.test.ts`

The patch now:

- uses the existing `aliases_json`, `metadata_json`, and text timestamp columns
- derives deterministic IDs and ingestion keys from semantic identity plus
  immutable source identity
- requires a source span or an explicit entity/type/locator evidence handle
- preserves exact surface forms separately from normalized lookup forms
- records nullable confidence instead of fabricating a default score
- makes concept, face, resolution, and adjacency replays idempotent
- keeps relationship dimensions as open strings rather than a schema enum
- backfills candidate assertion terms and versioned role-node terms
- avoids mutating semantic data during matching; matching remains a reader
- uses real SQLite-backed tests instead of a permissive interface mock

The migration and registry are now internally consistent and focused tests
pass. They still need application against a realistic migrated local D1 and
integration into every remaining ingestion producer.

## Verification Performed

The following focused command passed after the interaction and matcher changes:

```bash
cd workers/api
npx vitest run \
  src/lib/challengeMatching/evaluation/__tests__/evaluation.test.ts \
  src/lib/challengeMatching/__tests__/challengeMatching.test.ts \
  src/lib/challengeMatching/__tests__/d1Matcher.test.ts \
  src/lib/livingContext/__tests__/codeReview.test.ts \
  src/lib/livingContext/__tests__/phoneCall.test.ts \
  src/lib/livingContext/__tests__/cultureTurn.test.ts
```

Result at the time: 6 test files, 50 tests passed.

Additional focused verification after the repair:

```bash
cd workers/api
npx vitest run \
  src/lib/challengeMatching/evaluation/__tests__/cli.test.ts \
  src/lib/challengeMatching/evaluation/__tests__/evaluation.test.ts \
  src/lib/livingContext/__tests__/conceptRegistry.test.ts \
  src/lib/challengeMatching/__tests__/d1Matcher.test.ts \
  src/lib/challengeMatching/__tests__/roleGuardrails.test.ts
```

Result: 5 test files, 33 tests passed. The CLI test uses a temporary SQLite
database and verifies frozen-corpus immutability and persisted results.

The living-context dry-run completed cleanly against local D1:

```bash
cd workers/api
npx tsx scripts/backfillLivingContext.ts --local --dry-run --limit 10
```

Observed dry-run counts:

- candidates: 10
- culture sessions: 6
- candidate nodes: 10
- code-review sessions: 0
- failures: 0
- partials: 0

The full worker typecheck is not green. Last observed failures were outside the
focused living-context/evaluation files:

- `src/lib/agents/roleDiscovery/plugin.ts`
- `src/routes/cockpit/scheduling.ts`
- `src/routes/discovery/roleContexts.ts`
- `src/routes/outreach/pdlSearch.ts`

These still block a clean production claim.

Additional verification after the first real persisted local match run:

```bash
cd workers/api
npx vitest run \
  src/lib/repoSemanticGraph/__tests__/challengePacket.test.ts \
  src/lib/livingContext/__tests__/compatibility.test.ts \
  src/lib/challengeMatching/__tests__/d1Matcher.test.ts \
  src/lib/challengeMatching/__tests__/roleGuardrails.test.ts
```

Result: 4 test files, 18 tests passed.

Local D1 verification:

- `backfillLivingContext.ts --local --batch-size 100` completed with zero
  failures and upgraded 59 legacy candidate-node semantic term records.
- A second replay completed with zero failures and `candidateSemanticTermUpgrades:
  0`.
- `backfillConceptRegistry.ts --local` completed after the living replay. The
  first pass pruned 45 orphaned legacy concepts and ended at stable counts:
  concepts `69`, surfaces `170`, resolutions `0`, adjacencies `0`.
- A second concept-registry pass was idempotent: pruned `0`, and counts remained
  concepts `69`, surfaces `170`, resolutions `0`, adjacencies `0`.
- `testLocalChallengeMatch.ts --commit --candidate
  4c1bee04-264e-4eea-afae-4b2d2dd894ba` persisted
  `match_runs.id = 2346db17-f7d5-415f-95a3-73da39f94751`.
- The selected `ranked_results_json[0]` is eligible, has complete provenance,
  two direct alignments, no stretches, and no rejection reasons.

The full worker typecheck remains blocked by pre-existing unrelated failures in:

- `src/lib/agents/roleDiscovery/plugin.ts`
- `src/routes/cockpit/scheduling.ts`
- `src/routes/discovery/roleContexts.ts`

## Local Data State

- Local D1 has the `match_runs` table.
- Local D1 now contains a real persisted source-backed `MATCHED` run:
  - `match_runs.id`: `2346db17-f7d5-415f-95a3-73da39f94751`
  - candidate: `4c1bee04-264e-4eea-afae-4b2d2dd894ba`
  - selected packet: `challenge_packet_ba3ec61f45d059ece6371030`
  - repository / PR: `mui/base-ui#973`
  - score: `0.6932934782608696`
  - candidate alignment and role relevance: `0.706490683229814`
  - provenance complete: `true`
  - rejection reasons: `[]`
- The run was produced after replaying the local living-context backfill, which
  upgraded 59 legacy candidate-node semantic term records on first replay and 0
  records on the next replay.
- The run is evidence-based: both aligned demands share `term:react` with
  candidate resume-backed living assertions, and every alignment has candidate
  and challenge source references.
- Local D1 had migration `0092_sourcing_pool.sql` applied. The matching
  evaluation migration was correctly renumbered to `0093` before later edits.

### Gaps Remaining After the First Persisted Match Run

- The match is a standalone code-review run, not yet a role-constrained
  production pipeline match.
- The selected match is based on exact open concept overlap (`term:react`);
  repository challenge terms still need persisted concept-registry surfaces,
  resolutions, and adjacency ingestion so aliases such as `graph ql`/`graphql`
  are learned as data rather than inferred in matcher code.
- The run has not yet been frozen into a human-labelled evaluation corpus or
  compared against independent deterministic reruns.
- The explanation exists in persisted `ranked_results_json`, but the graph UI
  has not yet been browser-verified against this candidate and selected PR.
- Full Worker typecheck remains blocked by unrelated pre-existing failures, so
  this is not a production-readiness claim.

## Worktree Warning

The worktree is intentionally dirty and contains changes from multiple agents.
Do not reset, checkout, or delete files wholesale.

At handoff:

- `main` is six commits ahead of `origin/main`.
- There are modified tracked files, untracked implementation files, and deleted
  legacy code-review files.
- `harness` is a dirty submodule.
- The latest local commit message overstates evaluation readiness because the
  committed CLI is a stub. The current uncommitted worktree contains the repair
  and must not be replaced wholesale from HEAD.

Before editing a shared file, re-read it. Concurrent writes changed
`types.ts`, `cli.ts`, `scripts/evaluateMatching.ts`, and the migration during
this session.

## Remaining Work in Execution Order

### 0. Stabilize the Current Worktree

- Stop concurrent agents from editing the same files.
- Inventory each modified/untracked file by owner and intended feature.
- Preserve user changes.
- Preserve the repaired evaluation and concept-registry files as one coherent
  contract.
- Apply `0093` and `0094` to a realistic local D1 copy before remote migration.

### 1. Finish Every Person-Graph Producer

- Runtime-test meeting, culture, phone, and code-review ingestion.
- Add remaining message, resume, assessment, role-discovery, and
  voice/transcript producers to the same canonical path.
- Ensure every producer stores immutable original content before semantic
  extraction.
- Ensure candidate-authored content is never confused with agent/scorer output.
- Complete deterministic backfills and verify replay creates no duplicate
  artifacts, spans, assertions, evidence, or projections.

### 2. Finish Rolling Out the Persisted Open Concept Registry

- Apply the reconciled migration to a realistic local D1 copy.
- Invoke registry persistence from remaining canonical ingestion producers.
- Make resolver changes replayable from immutable artifacts.
- Remove or data-drive any remaining semantic node-type filters, alias maps, or
  fixed meaning classifications.
- Add migration/backfill coverage against populated person and role evidence.

### 3. Prove Repository Decomposition on Real GitHub Data

- Run repository crawling and challenge packet backfill against real repos and
  PRs.
- Confirm source artifacts, exact commit/blob hashes, paths, lines, symbols,
  structural facts, episodes, assertions, and challenge demands are populated.
- Verify idempotent replay.
- Verify unsupported languages remain source-preserved rather than discarded.
- Confirm challenge packets are reviewable and contain enough ground truth for
  an interview.

### 4. Complete Candidate-to-PR Matching

- Compile candidate atoms only from complete source-backed living-graph
  evidence.
- Compile role constraints only from persisted role evidence.
- Use persisted concept resolution/adjacency data.
- Persist complete candidate and role snapshots plus resolver/policy versions.
- Ensure `ranked_results_json` contains repository ID, PR number, commit,
  eligibility rank, recall rank, score components, alignments, stretch path,
  and both sides' exact source references.
- Exercise `NEEDS_MORE_EVIDENCE` and `NO_ROLE_SAFE_CHALLENGE` end to end.
- Prove there is no generic repository or smallest-PR fallback.

### 5. Build the Explanation and Overlay Experience

- Finish and QA the person/context graph.
- Add repository graph navigation.
- Overlay candidate evidence against specific PR demands.
- Make each alignment clickable back to the candidate source and code source.
- Show missing evidence, rejected challenges, and permitted stretch paths.
- Avoid presenting an aggregate score without its evidence trail.

### 6. Run Production Evaluation

- Create a real expert-labelled corpus spanning multiple people, roles, repos,
  PRs, guardrail cases, missing-evidence cases, and unseen concepts.
- Generate independent reruns rather than comparing a database row with itself.
- Meet:
  - Recall@50 >= 0.95
  - Precision@3 >= 0.80
  - nDCG@5 >= 0.80
  - zero guardrail violations
  - zero multi-stretch violations
  - zero missing provenance
  - byte-identical independent reruns
- Keep synthetic fixtures as development tests only.

### 7. Full E2E and Staged Rollout

- Run a real flow:
  person/contact creation -> interactions -> living graph -> role evidence ->
  repository ingestion -> PR challenge -> match -> explanation UI.
- Add E2E checks for exact source reconstruction and graph navigation.
- Prove D1 can rebuild Neo4j/vector projections from scratch.
- Shadow against the legacy matcher.
- Canary the versioned matcher policy at 10%, 50%, and 100%.
- Add rollback criteria and observability for missing evidence, projection lag,
  guardrail rejection, and match quality.

## Immediate Next Session

Start here:

1. Freeze a first human-labelled corpus that includes match run
   `2346db17-f7d5-415f-95a3-73da39f94751` and explicit negative/guardrail
   cases.
2. Run independent matcher reruns and compare fingerprints instead of comparing
   a row with itself.
3. Add repository challenge concept registry backfill/resolution so repo terms,
   candidate terms, and aliases are learned/persisted uniformly.
4. Run the graph UI against candidate `4c1bee04-264e-4eea-afae-4b2d2dd894ba`
   and inspect every source link.
5. Continue production hardening: role-specific constraints, repository overlay,
   full E2E, and unresolved typecheck failures.

## Definition of Done

The goal is not complete when unit tests pass or when a graph renders.

It is complete only when a real person accumulates source-backed context across
all required interaction types; a real repository and PR are decomposed with
exact source provenance; the matcher selects a specific role-safe PR from that
evidence; the UI explains every alignment and gap; all projections rebuild
idempotently; expert-labelled metrics meet the production thresholds; the full
workflow passes E2E; and the versioned matcher completes controlled rollout.
