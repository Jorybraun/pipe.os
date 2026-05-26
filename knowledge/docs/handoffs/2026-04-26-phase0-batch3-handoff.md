# Handoff — Phase 0 Batch 3 + Culture Reprompt Complete

**Date:** 2026-04-26  
**Scope:** Phase 0 Subagents G/H/I/J + Batch 2 fixes + Culture scorer re-prompt  
**Type-check status:** 38 pre-existing errors; 0 new errors introduced

---

## Done

### Batch 2 fixes (from phase0 plan)
- **`workers/api/src/lib/candidateDiscovery/backfill.ts`** — Removed redundant manual UPDATE after `embedAndUpsertCandidate` (the function already handles D1 persistence when `db` is passed). Kept the first UPDATE for augmented-text ground-truth persistence.
- **`workers/api/src/lib/candidateDiscovery/orchestrate.ts`** — `markIngestionEmbedded` stale comment was already fixed in a prior commit; no action needed.

### Subagent I — Delete compile-broken evaluator files + fix culture plugin
- **Deleted:**
  - `workers/api/src/lib/roleDiscovery/evaluator.ts`
  - `workers/api/src/lib/roleDiscovery/evaluatorPrompt.ts`
  - `workers/api/src/routes/internal/evaluateDiscovery.ts`
- **Updated:** `workers/api/src/lib/agents/culture/plugin.ts` — corrected `scoringConfig.dimensions` to match live `cultureScorer.ts`:
  - 5 competency dimensions: `ownership`, `collaboration`, `learning-orientation`, `conflict-handling`, `self-awareness`
  - 5 profile dimensions: `autonomy`, `risk-tolerance`, `work-pace`, `collaboration-style`, `feedback-orientation`

### Subagent J — Staging wrangler.jsonc bindings
- **Updated:** `workers/api/wrangler.jsonc` — uncommented staging D1, R2, and Vectorize bindings with staging-specific index names (`*-profiles-staging`).
- **Note:** `<STAGING_DB_ID>` placeholder still needs to be replaced with the actual D1 database ID after provisioning.

### Subagent H — match_feedback schema + matchRepos.ts alerting
- **Created:** `workers/api/migrations/0045_match_feedback_vector_signals.sql` — adds `vector_role_repo REAL`, `vector_cand_repo REAL`, `vector_role_cand REAL` to `match_feedback`.
- **Updated:** `workers/api/src/lib/repoDiscovery/matchRepos.ts` — added explicit `console.warn` when a skill alias lookup misses and falls back to lowercase slug.

### Subagent G — Wire vector signals in triangulateMatch
- **Updated:** `workers/api/src/lib/candidateDiscovery/orchestrate.ts` — added Vectorize ANN queries for `vectorRoleRepo` (REPO_INDEX queried with role vector) and `vectorRoleCandidate` (CANDIDATE_INDEX queried with role vector). `vectorCandidateRepo` is populated from the existing `repoChoice.cosine`.
- Vector signals are passed to `triangulateMatch`, `triangulateShortlist`, and the tailored-mode re-rank path.
- `VECTOR_WEIGHTS` preset automatically activates when any vector signal is non-null.

### Culture scorer re-prompt on ungrounded scores (ADR-029 §6)
- **Updated:** `workers/api/src/lib/cultureScorer.ts`
  - Added `repromptCount` (and optional `originalScore`/`originalConfidence`) to `CompetencyScoreResult` and `CultureProfileScoreResult`.
  - Extracted message builders (`buildCompetencyScorerMessages`, `buildCultureProfileScorerMessages`) from scorer functions.
  - Added `scoreCompetencyDimensionWithReprompt` and `scoreCultureProfileDimensionWithReprompt` wrappers.
  - Re-prompt logic: if `evidenceQuotes` is empty and score/position is non-neutral (≠3), issue exactly one re-prompt. If still ungrounded after re-prompt, apply `-0.3` confidence penalty and log warning.
  - Updated `scoreCultureInterview` to call the wrapped versions.
  - Updated `mockScoreReport`, `competencyFallback`, `profileFallback`, and both parsers to include `repromptCount: 0`.
- **Created:** `workers/api/migrations/0046_culture_audit_scorer_reprompt.sql` — adds `'scorer_reprompt'` to `culture_compliance_audit.event_type` CHECK constraint via table recreation (SQLite standard approach).
- **Updated:** `workers/api/src/routes/screening/culture.ts` — after scoring completes, iterates reprompted dimensions and writes `scorer_reprompt` audit events with metadata `{ dimension, originalScore, repromptScore, finalGrounded }`.

---

## Files touched

```
workers/api/src/lib/candidateDiscovery/backfill.ts
workers/api/src/lib/candidateDiscovery/orchestrate.ts
workers/api/src/lib/agents/culture/plugin.ts
workers/api/src/lib/repoDiscovery/matchRepos.ts
workers/api/src/lib/cultureScorer.ts
workers/api/src/routes/screening/culture.ts
workers/api/wrangler.jsonc
workers/api/migrations/0045_match_feedback_vector_signals.sql
workers/api/migrations/0046_culture_audit_scorer_reprompt.sql
```

## Files deleted

```
workers/api/src/lib/roleDiscovery/evaluator.ts
workers/api/src/lib/roleDiscovery/evaluatorPrompt.ts
workers/api/src/routes/internal/evaluateDiscovery.ts
```

---

## Remaining Phase 0 backlog (not done in this session)

| Item | File | Status |
|---|---|---|
| Culture question bank → D1 sync | `part1-north-star/culture-question-bank-d1-sync.md` | PENDING |
| RCD consumer cutover — remaining | `part1-north-star/rcd-consumer-cutover-remaining.md` | PENDING |
| Pass 3 confidence-threshold auto-approval | `part3-repo-ingestion/confidence-threshold-auto-approval.md` | PENDING |
| Repodiscovery RCD cutover | `part2-role-discovery/phase0-repodiscovery-rcd-cutover.md` | PENDING |
| Cockpit RCD cutover | `part2-role-discovery/phase0-cockpit-rcd-cutover.md` | PENDING |
| Dealbreaker gate enforcement | `part5-matching-migration/dealbreaker-gate-enforcement.md` | PENDING |
| Reliability/retry + circuit breakers + idempotency + heartbeats + DLQ | `part5-matching-migration/reliability-*.md` | PENDING |
| Observability (OTel + recruiter status) | `part5-matching-migration/observability-*.md` | PENDING |

---

## Open questions / blockers

1. **Staging D1 database ID** — `wrangler.jsonc` has `<STAGING_DB_ID>` placeholder. Needs actual Cloudflare D1 database ID before staging deployment works.
2. **BARS scale ambiguity** — `phase0-scorer-bars-anchor-audit.md` is marked `NEEDS-REFINEMENT` because some strategy docs reference 1–5 and others reference 0–3. Decision needed before any scorer prompt changes.
3. **Dealbreaker auto-fail vs flag** — Open Question #1 in `docs/plans/strategy-v2/README.md` blocks `dealbreaker-gate-enforcement.md`.
4. **Migration number races** — `0045` and `0046` are now claimed. Any new migrations must start from `0047` and confirm no conflicts.

---

## Next

Pick from the remaining Phase 0 backlog above, or proceed to Phase 1 candidate decomposition if Phase 0 hygiene is deemed sufficient.
