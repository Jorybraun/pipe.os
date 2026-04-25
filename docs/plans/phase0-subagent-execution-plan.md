# Phase 0 Subagent Execution Plan

**Date:** 2026-04-24  
**Source:** docs/handoffs/2026-04-24-strategy-synthesis-handoff.md  
**Goal:** Execute Phase 0 (Consumption Cutover & Production Hygiene) via parallel subagents.

---

## Principle

- Each subagent gets a **vertically scoped task** (one concern end-to-end: migration → code → test).
- No two subagents touch the **same file at the same time**.
- All subagents work off the **same trunk** (no long-lived branches).
- After each batch, a **sync agent** verifies integration (types, tests, no conflicts).

---

## Batch 1 — The 4 Parallel Quick Wins (Week 1–2)

These are the handoff's "start here" steps. All independent, all high-ROI, no schema redesign.

### Subagent A — Cache `candidateSituationFit`
**Status:** ✅ COMPLETE

**Files:**
- `workers/api/migrations/0044_situation_fit_cache.sql`
- `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts`
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**What was done:**
- Created `situation_fit_cache` table with SHA-256 keyed cache entries
- Added `getCachedSituationFit` / `storeSituationFitCache` / `buildSituationFitCacheKey` helpers
- Integrated batched cache check in orchestrator — skips LLM call on full cache hit
- Hit/miss telemetry logged as structured JSON

---

### Subagent B — Inject Structured JSON into Candidate Embedding Prompt
**Status:** ✅ COMPLETE (1 bug found)

**Files:**
- `workers/api/src/lib/candidateDiscovery/prompts.ts`
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`
- `workers/api/src/lib/candidateDiscovery/backfill.ts` (new)
- `scripts/backfillCandidateEmbeddings.ts` (new)

**What was done:**
- Bumped `CANDIDATE_DISCOVERY_PROMPT_VERSION` to `candidate-v3`
- Rewrote prompt so LLM appends structured signals (`key_concepts`, `career_context`, `situation_signature`) inside the narrative as a labeled JSON block
- Created `augmentProfileWithStructuredSignals()` for backfill — rehydrates existing flat profiles
- Created CLI backfill script with `--dry-run` and `--batch` flags

**Bug to fix:** `backfill.ts` calls `embedAndUpsertCandidate` without `db` param, then manually UPDATEs D1 but omits `embedding_model_version` and `status = 'embedded'`. Fix: pass `db: env!.DB` to `embedAndUpsertCandidate` and remove redundant manual UPDATE.

---

### Subagent C — Add Embedding Model Version Stamps
**Status:** ✅ COMPLETE (1 stale comment)

**Files:**
- `workers/api/migrations/0043_embedding_model_version.sql`
- `workers/api/src/lib/embedding/preprocess.ts`
- `workers/api/src/lib/candidateDiscovery/embed.ts`
- `workers/api/src/lib/roleDiscovery/embedRole.ts`
- `workers/api/src/routes/cockpit/adminRepos.ts`
- `workers/api/src/routes/discovery/roleContexts.ts`
- `workers/api/src/lib/roleDiscovery/backfill.ts`
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**What was done:**
- Migration adds `embedding_model_version TEXT` to `candidate_ingestion`, `role_contexts`, `repo_engineering_signals`
- Exported `EMBEDDING_MODEL` and `EMBEDDING_MODEL_VERSION` from `preprocess.ts`
- All 3 embed functions now accept optional `db` and stamp version on D1 update
- Callers updated to pass `db` and removed redundant manual D1 updates
- Tests updated and passing (33/33)

**Note:** `orchestrate.ts` line 10 still lists `markIngestionEmbedded` as step 5 in comment — now handled inside `embedAndUpsertCandidate`.

---

### Subagent D — Cut Over `autoStageBuilder` to RCD Primary
**Status:** ✅ COMPLETE

**Files:**
- `workers/api/src/lib/match/autoStageBuilder.ts`

**What was done:**
- `buildMatchRequest()` now reads RCD `technical_context.stack`, `seniority_band`, and `domain_matrix` for `primaryLanguage`, `seniority`, and `domain`
- `resolveMustHaveSkills()` prefers RCD stack after non-negotiable skills
- `deriveDomainFromRcd()` finds deepest `primary_authority` coverage in domain matrix
- Legacy persona fallback preserved for roles without RCD
- Tests: 11/11 passing

---

## Batch 2 — Preprocessing Normalization + ROLE_INDEX Cutover

These touch different files than Batch 1. Can run in parallel.

### Subagent E — Normalize `preprocessForEmbedding` Bypasses
**Status:** ✅ COMPLETE

**Files:**
- `workers/api/src/routes/cockpit/adminRepos.ts` (lines ~698, ~1136)
- `workers/api/src/lib/repoDiscovery/discover.ts` (line ~414)
- `workers/api/src/lib/embedding/preprocess.ts`

**Spec:**
- Replace raw `env.AI.run(...)` with `preprocessForEmbedding(text, side)` at all 3 call sites.
- `adminRepos.ts:698` → `preprocessForEmbedding(profile, 'document')`
- `adminRepos.ts:1136` → `preprocessForEmbedding(query, 'query')`
- `discover.ts:414` → `preprocessForEmbedding(profile, 'query')`

---

### Subagent F — Cut Over ROLE_INDEX to RCD Narrative
**Status:** ✅ COMPLETE

**Files:**
- `workers/api/src/lib/roleDiscovery/buildRoleProfile.ts`
- `workers/api/src/routes/discovery/roleContexts.ts` (lines 73, 778, 1172)
- `workers/api/src/lib/roleDiscovery/backfill.ts`
- `scripts/backfillRoleEmbeddings.ts`

**Spec:**
- Switch all 4 call sites from `buildRoleSearchableProfile` to `buildRcdSearchProfile`.
- `buildAndStoreRoleEmbedding()` needs access to parsed RCD (`rcd_json`), not just JD + persona.
- Run `scripts/backfillRoleEmbeddings.ts` to re-embed all existing roles.

---

## Batch 3 — Matching Fixes + File Hygiene

### Subagent G — Wire Vector Signals in `triangulateMatch`
**Status:** ⏳ PENDING

**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`
- `workers/api/src/lib/match/triangulateMatch.ts`

**Spec:**
- Populate `vectorCandidateRepo` from ANN `repoChoice.cosine`.
- Add Vectorize queries for `vectorRoleRepo` and `vectorRoleCandidate`.
- Ensure `VECTOR_WEIGHTS` preset activates when signals are present.

---

### Subagent H — `match_feedback` Schema + `matchRepos.ts` Fix
**Status:** ⏳ PENDING

**Files:**
- `workers/api/migrations/0040_match_feedback.sql` (or new migration)
- `workers/api/src/lib/repoDiscovery/matchRepos.ts`

**Spec:**
- Migration: add `vector_role_repo REAL`, `vector_cand_repo REAL`, `vector_role_cand REAL`.
- `matchRepos.ts`: replace silent `skill.toLowerCase()` fallback with explicit alerting/logging.

---

### Subagent I — Delete Compile-Broken Evaluator Files + Fix Culture Plugin
**Status:** ⏳ PENDING

**Files:**
- `workers/api/src/lib/roleDiscovery/evaluator.ts` **DELETE**
- `workers/api/src/lib/roleDiscovery/evaluatorPrompt.ts` **DELETE**
- `workers/api/src/routes/internal/evaluateDiscovery.ts` **DELETE**
- `workers/api/src/lib/agents/culture/plugin.ts` **FIX**

**Spec:**
- Delete the 3 orphaned/broken evaluator files.
- Update `culture/plugin.ts` stub dimensions to match live `cultureScorer.ts`.

---

### Subagent J — Staging `wrangler.jsonc` Fix
**Status:** ⏳ PENDING

**Files:**
- `workers/api/wrangler.jsonc` (staging config)

**Spec:**
- Uncomment D1/R2/Vectorize bindings in staging so it doesn't share prod.

---

## Batch 4 — Reliability & Observability (Week 5–6)

Planned separately once Batch 1–3 complete.

---

## Execution Order

```
Batch 1:  A + B + C + D   ✅ DONE
  ↓
Sync:     Type-check + integration smoke test ✅ DONE
  ↓
Batch 2:  E + F           ✅ DONE
  ↓
Sync:     Type-check + integration smoke test ✅ DONE
  ↓
Batch 3:  G + H + I + J   ⏳ NEXT
  ↓
Sync:     Type-check + integration smoke test
  ↓
Batch 3:  G + H + I + J
  ↓
Sync:     Type-check + integration smoke test
  ↓
Batch 4:  Plan separately
```

## Fixes Needed Before Batch 2

1. **Candidate backfill bug:** `workers/api/src/lib/candidateDiscovery/backfill.ts` — pass `db` to `embedAndUpsertCandidate`
2. **Stale comment:** `orchestrate.ts` line 10 — update step sequence comment
