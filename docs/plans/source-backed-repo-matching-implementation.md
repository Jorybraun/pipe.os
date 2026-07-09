# Source-Backed Repository PR Extraction and Matching — Implementation Plan

**Status:** In progress — Phase 1 verified, Phase 2 active  
**Date:** 2026-07-08  
**Owner:** Devin  
**Research basis:** [`knowledge/research/outputs/repo-hypergraph-matching.md`](../knowledge/research/outputs/repo-hypergraph-matching.md)

## Goal

Finish the production implementation for source-backed repository PR extraction and deterministic matching, so that:
- Every PR-derived challenge is built from immutable source evidence.
- Candidate evidence matches PR demands via source-backed context records.
- No generic repo, smallest-PR, or fabricated evidence fallback exists.

## Phase 1 — Production Repo Crawler Adapter ✅

**Goal:** Ingest one real GitHub PR into a `ChallengePacket` in D1 with exact source spans.

**Result:** `npx tsx scripts/backfillReviewChallengePackets.ts --repo mui/base-ui --pr 1459` successfully built and persisted `mui/base-ui#1459` as a review challenge packet with 928 source spans, 891 structural facts, 7 demands, and a context record linked to the repo snapshot.

**Key files:**
- `workers/api/scripts/backfillReviewChallengePackets.ts` (production adapter)
- `workers/api/scripts/repo-semantic/sourceAnalysis.ts` (language analysis)
- `workers/api/scripts/repo-semantic/changeEvidence.ts` (change evidence)
- `workers/api/src/lib/repoSemanticGraph/builders.ts`, `challengePacket.ts`, `derive.ts`, `persistence.ts`, `githubNormalize.ts`, `sourceAnalysis.ts`

**Remaining integration:** The `crawl-repos` pass3 pipeline still writes `repo_engineering_signals` and `repo_sample_prs` but does not automatically invoke the backfill. Backfill is currently triggered manually or via the standalone script. A later phase will wire it as an automatic follow-up pass.

## Phase 2 — Matching Engine Hardening 🔄

**Goal:** Ensure the matcher uses source-backed `context_records` and produces correct statuses.

**Known issues:**
- `e2e/standalone-code-review-mvp.spec.ts` has `fixture.conceptKey` assertions that may fail if `roleSources` do not propagate the selected concept key.
- Need to verify `compileCandidateAtoms` reads from `context_records` (not signals/embeddings).
- Need to verify `compileRoleGuardrails` and `compilePRDemands` resolve from context records with correct `conceptKeys`.

**Tasks:**
1. Read `e2e/standalone-code-review-mvp.spec.ts` seed and the `workers/api/src/routes/internal/e2eSeed.ts` route to reconcile `fixture.conceptKey` expectations.
2. Read `workers/api/src/lib/challengeMatching/engine.ts` and `d1Matcher.ts` to trace candidate-to-PR matching.
3. Run `npx playwright test e2e/standalone-code-review-mvp.spec.ts` and identify failures.
4. Fix the root cause and add unit tests for `NEEDS_MORE_EVIDENCE`, `NO_ROLE_SAFE_CHALLENGE`, `MATCHED`, and determinism.
5. Run `npx tsc --noEmit` and `npx playwright test`.

**Files:**
- `workers/api/src/lib/challengeMatching/engine.ts`
- `workers/api/src/lib/challengeMatching/d1Matcher.ts`
- `workers/api/src/lib/challengeMatching/types.ts`
- `e2e/standalone-code-review-mvp.spec.ts`
- `workers/api/src/routes/internal/e2eSeed.ts`

## Phase 3 — UI Tree Projection

**Goal:** Show repo evidence as a tree over the semantic hypergraph, not as flat panels.

**Tasks:**
1. Add `ContextRecordForest` component for repo-scoped `context_records`.
2. Wire it into `LivingContextGraph.tsx`.
3. Fix `standalone-review-evidence` to display `sharedConcepts` or update the test.
4. Update `RepositoryOverlayPanel`, `MatchEvidenceBridgePanel`, and `RepoPacketPanel` to show exact source spans.

**Files:**
- `src/components/LivingContextGraph/ContextRecordForest.tsx` (new)
- `src/components/LivingContextGraph/LivingContextGraph.tsx`
- `src/components/ReviewEvidence/standalone-review-evidence.tsx`
- `src/components/RepositoryOverlayPanel.tsx` (and related)

## Phase 4 — Backfills and Evaluation

**Goal:** Prove the system is deterministic, idempotent, and explainable.

**Tasks:**
1. Backfill eligible `repo_sample_prs` into `review_challenge_packets` and `context_records` using the local script.
2. Backfill candidate person evidence into `context_records` if missing.
3. Create an expert-labeled evaluation corpus (10–20 candidate/PR pairs) and run `npx tsx scripts/evaluateMatching.ts`.
4. Report recall, precision, nDCG, guardrail violations, and determinism.
5. Add diagnostics, kill switches, and rollout gates.

**Files:**
- `workers/api/scripts/backfillReviewChallengePackets.ts`
- `workers/api/scripts/evaluateMatching.ts`
- `workers/api/src/lib/challengeMatching/evaluation/*`

## Phase 5 — Documentation Sync

**Goal:** Update docs to match the code.

**Tasks:**
1. Update `knowledge/docs/ops/repo-matching-flow.md`.
2. Update `docs/playbooks/matching.md`.
3. Update `knowledge/plan/living-context-repo-matching-plan.md`.
4. Add `CHANGELOG.md` entries under `[Unreleased]`.

## Constraints

- No fabricated evidence, PRs, repos, or seniority.
- No embedding-only match decisions.
- No generic-repo or smallest-PR fallback.
- Every match explains its source evidence.
- D1 is source of truth; Neo4j/Vectorize are rebuildable projections.

## Acceptance Criteria

- [ ] One real PR ingested end-to-end into a `ChallengePacket` with exact source spans.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npx playwright test` passes.
- [ ] Evaluation report shows no fabricated evidence and deterministic output.
- [ ] Documentation reflects current implementation.

## Risks

- `repoSemanticGraph` may not handle all languages; start with TypeScript/Python/Go.
- Real PR ingestion may be slow; idempotency and caching are required.
- OAuth/clone access for private repos may require additional auth plumbing.
