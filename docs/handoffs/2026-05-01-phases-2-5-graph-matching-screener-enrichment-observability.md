# Handoff: Phases 2–5 — Graph-Enabled Matching, Screener, Enrichment, Observability

**Date:** 2026-05-01
**Upstream:** Phase 1 (Resume Decomposition) — partially complete, parser blocked
**Plan:** [`/Users/hans/.kimi/plans/sif-tempest-starman.md`](/Users/hans/.kimi/plans/sif-tempest-starman.md)
**ADR:** [`docs/decisions/ADR-041-candidate-graph-sequencing-revision.md`](/Users/hans/Code/PIPE/PIPE-OS/docs/decisions/ADR-041-candidate-graph-sequencing-revision.md)
**Previous Handoff:** [`docs/handoffs/2026-05-01-candidate-ingestion-resume-decomposition-handoff.md`](/Users/hans/Code/PIPE/PIPE-OS/docs/handoffs/2026-05-01-candidate-ingestion-resume-decomposition-handoff.md)
**Status:** Phase 1 decomposition pipeline is built and type-clean. Parser is owned by another agent. This handoff covers Phases 2–5.

---

## 1. Phase 1 Status — What Exists Today

### 1.1 Delivered

| Component | Status | File |
|-----------|--------|------|
| `candidate_profile_state` table | ✅ Migration written | `migrations/0058_candidate_profile_state.sql` |
| `candidate_ingestion.decomposition_version` | ✅ Migration written | `migrations/0059_candidate_ingestion_decomposition_version.sql` |
| `CandidateProfileStateRow` type | ✅ Added to `types.ts` | `workers/api/src/types.ts` |
| Decomposition prompt | ✅ Created | `lib/candidateDiscovery/candidateDecompositionPrompt.ts` |
| Resume decomposition orchestrator | ✅ Created | `lib/candidateDiscovery/resumeDecomposition.ts` |
| Backfill script | ✅ Created | `lib/candidateDiscovery/backfillResumeDecomposition.ts` |
| Orchestration wiring | ✅ Wired into `orchestrate.ts` | `lib/candidateDiscovery/orchestrate.ts` |
| Tests | ✅ Passing (732 tests) | `lib/cvParser/__tests__/cvParser.test.ts`, `lib/candidateDiscovery/__tests__/resumeDecomposition.test.ts` |

### 1.2 Parser Blocker — Owned by Another Agent

**The rule-based parser in `cvParser.ts` was attempted but failed on real resumes.** Another agent is now responsible for `cvParser.ts`. Our downstream code assumes the parser produces a valid `ParsedCV` with the expanded interface.

**Interface contract you can depend on:**

```ts
// From types.ts (already merged)
export interface ParsedExperience {
  company: string;
  role: string;
  startDate?: string;
  endDate?: string;
  description: string;
  isCurrent?: boolean;
}

export interface ParsedEducation {
  institution: string;
  degree: string;
  field?: string;
  year?: string;
}

export interface ParsedCredential {
  name: string;
  issuer?: string;
  year?: string;
}

export interface ParsedProject {
  name: string;
  description: string;
  url?: string;
}

export interface ParsedCV {
  name?: string;
  skills: string[];
  yearsOfExperience?: number;
  currentRole?: string;
  education?: string[];
  experiences: ParsedExperience[];
  educationBlocks: ParsedEducation[];
  credentials: ParsedCredential[];
  projects: ParsedProject[];
}
```

**What the parser agent must guarantee:**
- `experiences`, `educationBlocks`, `credentials`, `projects` are never `undefined` (may be empty arrays `[]`)
- Dates are normalized to `YYYY` or `YYYY-MM` where possible
- The `skills` array is populated (may be empty)

**Your decomposition code is resilient:** If `experiences` is empty, `resumeDecomposition.ts` falls back to parser-only nodes with low confidence (`0.5`). If the LLM enrichment also fails, it logs warnings and updates `candidate_profile_state` to `seed` anyway.

---

## 2. Phase 2: Graph-Enabled Matching (3–4 weeks)

**Goal:** Make `candidateSituationFit` and downstream matching consume the new resume-derived nodes.

**Depends on:** Phase 1 decomposition pipeline producing nodes.

### 2.1 Subtask 4.1.1 — Node-Aware Prompt Augmentation (1 week)
**Owner:** `lib/candidateDiscovery/candidateSituationFit.ts`

`buildUserMessage()` currently injects `culturalSignalNodes`. Add injection for:
- `experienceNodes` → formatted as "Career History" block
- `projectNodes` → formatted as "Notable Projects" block
- `skillNodes` → formatted as "Skill Profile" block

**New prompt block:**
```
### candidate_experiences
- Senior Engineer at Acme Corp (2022–2024): Led backend migration...
- Engineer at Beta Inc (2020–2022): Built payment integration...

### candidate_projects
- Open-source CLI tool: A TypeScript utility for...

### candidate_skills
- typescript (expert, 5 years)
- kafka (proficient, 2 years)
```

**Rules:**
- Only include nodes with `confidence >= 0.5`.
- Cap at 5 experiences, 3 projects, 10 skills to manage token budget.
- Prefer non-superseded nodes (`superseded_at IS NULL`).
- Use `getActiveCandidateNodes(db, candidateId, nodeType)` to load nodes.

**Critical gotcha:** `candidateSituationFit` already consumes `CulturalSignal` nodes when a `roleContextId` is provided. Do not break this. Add the new blocks **alongside** the existing cultural signal block, not replacing it.

### 2.2 Subtask 4.1.2 — Evidence Density Multiplier (1 week)
**Owner:** `lib/match/triangulateMatch.ts` + `lib/candidateDiscovery/candidateCoverage.ts`

Discount match scores when the candidate graph is thin.

```ts
const evidenceDensity = (
  experienceCoverage * 0.3 +
  technicalCoverage * 0.3 +
  culturalCoverage * 0.2 +
  motivationCoverage * 0.1 +
  contextCoverage * 0.1
);

// evidenceDensity is already computed by computeCandidateCoverage
const densityMultiplier = 0.5 + (evidenceDensity * 0.5); // range [0.5, 1.0]
const adjustedMatchScore = rawMatchScore * densityMultiplier;
```

**Behavior:**
- A candidate with only a resume (thin graph) gets their match score discounted by up to 50%.
- A candidate with rich assessments (dense graph) gets full weight.

### 2.3 Subtask 4.1.3 — Source-Aware Coverage Weighting (0.5 weeks)
**Owner:** `lib/candidateDiscovery/candidateCoverage.ts`

`computeCandidateCoverage` currently counts nodes naively. Add source quality weights:

```ts
const SOURCE_WEIGHTS: Record<string, number> = {
  'code_review_session': 1.0,
  'implementation_challenge': 1.0,
  'culture_interview': 1.0,
  'automated_screener': 0.9,
  'github_enrichment': 0.7,
  'resume': 0.6,
  'recruiter_note': 0.5,
};
```

Coverage scores become weighted sums instead of counts.

**Critical gotcha:** This affects the evidence density multiplier (Subtask 4.1.2). Build 4.1.3 before or alongside 4.1.2 — they share the coverage computation.

### 2.4 Subtask 4.1.4 — Recency Decay in Matching (0.5 weeks)
**Owner:** `lib/candidateDiscovery/candidateSituationFit.ts`

Older nodes contribute less to matching unless they are superseded.

**Simple rule:** Nodes older than 2 years get a 0.8x multiplier; nodes older than 4 years get 0.6x. Use `captured_at` (epoch seconds) to compute age.

### 2.5 Phase 2 Files

| File | Action |
|------|--------|
| `lib/candidateDiscovery/candidateSituationFit.ts` | Modify — inject Experience/Project/Skill nodes into prompt; add recency decay |
| `lib/match/triangulateMatch.ts` | Modify — apply evidence density multiplier to match scores |
| `lib/candidateDiscovery/candidateCoverage.ts` | Modify — source-aware weighted coverage |
| `lib/candidateDiscovery/candidateRecency.ts` | Modify — recency decay rules (file exists, may need expansion) |

---

## 3. Phase 3: Screener Hardening (3–4 weeks)

**Goal:** Make the Mode 1 screener a true pre-match profile builder.

**Depends on:** Phase 1 (`candidate_nodes` exists and is populated).

### 3.1 Subtask 5.1.1 — Unstub `persistDecomposition` (0.5 weeks)
**Owner:** `lib/cultureAgentDecomposition.ts`

**Current state:** `persistDecomposition()` logs and returns. The comment says "TODO: Enable when candidate_nodes table is created." **The table exists** (migration 0052). This TODO is stale.

Replace stub with actual `insertCandidateNode()` calls for:
- `CulturalSignal` nodes (existing logic, just wire up)
- `Experience` nodes from `newExperiences`
- `Project` nodes from `newProjects`

Then call `computeCandidateCoverage(db, candidateId)`.

### 3.2 Subtask 5.1.2 — Standalone Screening Session (1.5 weeks)
**Owner:** `routes/screening/culture.ts`, `lib/cultureAgentAdaptive.ts`

**Schema change (migration 0060):**
```sql
ALTER TABLE culture_interview_sessions ALTER COLUMN challenge_id DROP NOT NULL;
ALTER TABLE culture_interview_sessions ALTER COLUMN assessment_id DROP NOT NULL;
```

**Route changes:**
- New recruiter endpoint: `POST /api/v1/screening/invite` — creates a `profile_builder` session with null `challenge_id`.
- New candidate endpoint: `POST /rpc/screening/:token/consent` — starts a standalone screening.
- Existing `/rpc/culture/*` endpoints remain for assessment-linked culture interviews.

**Agent changes:**
- `cultureAgentAdaptive.ts` already accepts `mode`. Ensure it handles `teamContext=null` and `probeBank=EMPTY_PROBE_BANK` gracefully for `profile_builder`.
- `cultureGenerativePlanner.ts` should skip RCD personalization when `teamContext` is null.

**Critical gotcha:** D1 SQLite may not support `ALTER TABLE ... DROP NOT NULL`. If it fails, you must recreate the table and migrate data. Test in staging first.

### 3.3 Subtask 5.1.3 — Candidate Profile View (1 week)
**Owner:** new routes + UI components

**Backend:**
- New endpoint: `GET /rpc/candidate/profile` — returns aggregated profile:
  ```json
  {
    "experiences": [...],
    "skills": [...],
    "projects": [...],
    "coverage": { "experience": 0.7, "technical": 0.8, ... },
    "sources": ["resume", "github_enrichment", "code_review_session"]
  }
  ```
- Filters out superseded nodes. Sanitizes `source_reference` (no internal IDs exposed).

**Frontend:**
- New page: `/candidate/profile` — simple accordion view by node type.
- "Request correction" button (creates a support ticket; out of scope for auto-correction in this phase).

### 3.4 Subtask 5.1.4 — HITL Policy for Mode 1 (0.5 weeks)
**Owner:** `routes/screening/culture.ts`

**Decision:** Mode 1 output is **not** HITL-gated.
- Mode 1 session ends in `complete` state directly (no `scoring` → `review` flow).
- `scoreCultureInterview` is **not** called for Mode 1.
- The decomposition output is the only product of Mode 1.

### 3.5 Phase 3 Files

| File | Action |
|------|--------|
| `lib/cultureAgentDecomposition.ts` | Modify — replace `persistDecomposition` stub with real writes |
| `routes/screening/culture.ts` | Modify — standalone invite + consent routes |
| `lib/cultureAgentAdaptive.ts` | Modify — handle null teamContext for profile_builder |
| `lib/cultureGenerativePlanner.ts` | Modify — skip RCD personalization when teamContext is null |
| `routes/candidate/profile.ts` | **Create** — candidate-facing profile endpoint |
| `src/pages/candidate/ProfilePage.tsx` | **Create** — frontend profile view |

---

## 4. Phase 4: Enrichment Depth (2–3 weeks)

**Goal:** Upgrade GitHub enrichment from metadata-driven Project nodes to LLM-decomposed multi-type nodes.

**Depends on:** Phase 1 (graph substrate exists).

### 4.1 Subtask 6.1.1 — Contribution Analysis (1 week)
**Owner:** `lib/enrichment/githubEnrich.ts`

**Current state:** Only owned repos → Project nodes.

**Additions:**
- Fetch merged PRs to other repos (GitHub search API: `is:pr author:{handle} is:merged`).
- For repos with 5+ merged PRs, create an `Experience`-like node: "Contributor to `{repo}` — 12 merged PRs over 18 months. Focused on bug fixes and feature work in `{language}`."
- Fetch commit activity per repo to derive `WorkingStyle` nodes: "Sustained contributor to `{repo}` — consistent weekly commits over 2 years." or "Spike contributor — 40 commits in 1 month, then inactive."

### 4.2 Subtask 6.1.2 — README / Issue Sampling (1 week)
**Owner:** `lib/enrichment/githubEnrich.ts`

Derive `CommunicationStyle` and `TechnicalDemonstration` nodes.

- Sample 3 README files from owned repos → `CommunicationStyle` node (clarity, structure, depth).
- Sample 5 issue comments → `CommunicationStyle` node (technical explanation quality).
- These use a lightweight LLM prompt (Gemma 3 27B, single call per candidate) to score writing quality and produce a narrative.

### 4.3 Subtask 6.1.3 — Skill Derivation from Languages (0.5 weeks)
**Owner:** `lib/enrichment/githubEnrich.ts`

Create `Skill` nodes from language usage patterns.

- Aggregate `languages` across all repos weighted by bytes.
- Create `Skill` nodes with proficiency inferred from recency and volume: "typescript (expert, active in 8 repos, 45% of total code)."
- Confidence scales with repo count and recency.

### 4.4 Phase 4 Files

| File | Action |
|------|--------|
| `lib/enrichment/githubEnrich.ts` | Modify — add contribution analysis, commit patterns, README/issue sampling |
| `lib/enrichment/githubClient.ts` | Modify — add `getMergedPRs`, `getRepoReadme`, `getIssueComments` |
| `lib/candidateDiscovery/candidateNodes.ts` | No change — already supports all node types |

---

## 5. Phase 5: Observability & Calibration (1–2 weeks)

**Goal:** Measure whether the graph is working.

**Depends on:** Phase 2 (coverage scoring is meaningful).

### 5.1 Subtask 7.1.1 — Coverage Dashboard (0.5 weeks)
**Owner:** `routes/admin/candidateCoverage.ts` (**Create**)

New route: `GET /api/v1/admin/candidate-coverage`

Returns:
```json
{
  "totalCandidates": 1500,
  "withResumeNodes": 450,
  "withAssessmentNodes": 320,
  "withEnrichmentNodes": 180,
  "averageCoverage": {
    "experience": 0.42,
    "technical": 0.38,
    "cultural": 0.25,
    "motivation": 0.15,
    "context": 0.20
  },
  "backfillProgress": { "completed": 450, "remaining": 1050 }
}
```

### 5.2 Subtask 7.1.2 — Matching Quality Metrics (0.5 weeks)
**Owner:** `lib/match/triangulateMatch.ts` + `match_feedback` table

- Log `node_type_distribution` in `match_feedback` (which node types contributed to the match).
- Track recruiter thumbs-up/down correlation with `evidence_density`.
- Migration 0061: Add `node_types_json` column to `match_feedback`.

### 5.3 Subtask 7.1.3 — Re-engagement Cron (0.5 weeks)
**Owner:** `routes/cron/reengagement.ts` (**Create**)

- Daily scan of `candidate_profile_state`.
- Candidates with `overall_status='dormant'` and `re_engagement_eligible_at <= now()` get a "new roles match you" email.
- Candidates with `last_screened_at` > 12 months ago get flagged for abbreviated re-screening.

### 5.4 Phase 5 Files

| File | Action |
|------|--------|
| `routes/admin/candidateCoverage.ts` | **Create** — coverage dashboard endpoint |
| `routes/cron/reengagement.ts` | **Create** — re-engagement trigger cron |
| `lib/match/triangulateMatch.ts` | Modify — log node_type_distribution to match_feedback |

---

## 6. Migration Sequence (Phases 2–5)

| Number | Name | Phase | Notes |
|--------|------|-------|-------|
| 0058 | `candidate_profile_state` | 1 | ✅ Already written |
| 0059 | `candidate_ingestion_decomposition_version` | 1 | ✅ Already written |
| 0060 | `culture_interview_sessions_nullable_challenge` | 3 | Drop NOT NULL on `challenge_id`, `assessment_id` |
| 0061 | `match_feedback_node_distribution` | 5 | Add `node_types_json` column to `match_feedback` |

**Race warning:** As of 2026-05-01, the highest migration is `0057_candidate_coverage_fix_fk.sql`. 0058–0059 are written but not yet applied anywhere.

---

## 7. Architecture Decisions You Must Respect

These are locked by ADR-041. Do not change them without discussion.

1. **Keep nodes separate by `source_type`.** A resume `Skill` node and a code-review `TechnicalDemonstration` node for the same technology are **not merged**. Matching weights them by source quality.
2. **Assessment nodes have matching priority.** Hierarchy: `technical_interview` > `code_review_session` > `implementation_challenge` > `automated_screener` > `github_enrichment` > `resume`.
3. **Mode 1 screener stays in `culture_interview_sessions` for now.** Nullable `challenge_id`/`assessment_id`. A separate `screening_sessions` table is deferred.
4. **Mode 1 has no HITL gate.** It is pure profile enrichment. No `scoreCultureInterview` call. Session ends in `complete` state.
5. **Evidence density discounts match scores** for thin profiles.
6. **Backward compatibility is mandatory.** The flat `candidate_searchable_profile` and its embedding in `CANDIDATE_INDEX` must continue to work. New nodes are **additional signal**, not a replacement.

---

## 8. Critical Gotchas

### Gotcha 1: `persistDecomposition` is a stale stub
`lib/cultureAgentDecomposition.ts` has a `persistDecomposition()` function that logs and returns without writing. **The `candidate_nodes` table exists** (migration 0052). When you reach Phase 3, replace the stub with real `insertCandidateNode()` calls.

### Gotcha 2: Token budget in `candidateSituationFit`
Adding Experience + Project + Skill blocks may exceed the 4096-token limit when combined with repo descriptions. **Cap nodes:** 5 experiences, 3 projects, 10 skills. Truncate narratives. Monitor token counts.

### Gotcha 3: D1 SQLite `ALTER TABLE` limitations
Migration 0060 requires making `challenge_id` and `assessment_id` nullable in `culture_interview_sessions`. D1 SQLite may not support `ALTER TABLE ... DROP NOT NULL`. If it fails, recreate the table and migrate data. Test in staging first.

### Gotcha 4: Coverage computation runs after every node write
`computeCandidateCoverage` is called by `resumeDecomposition.ts` after node insertion. With 50+ nodes per candidate, this must be fast. Already indexed on `candidate_id`.

### Gotcha 5: `embedCandidateNode` type hack
`resumeDecomposition.ts` casts `env` when calling `embedCandidateNode` due to `Ai.run` signature incompatibility. If you touch the embedding layer, verify this cast still works.

### Gotcha 6: Parser agent owns `cvParser.ts`
Do not modify `cvParser.ts` without coordinating with the parser agent. Your interface contract is the `ParsedCV` type in `types.ts`. If you need changes to the parser output, propose them to the parser agent.

---

## 9. File Map — All Phases 2–5

### New files to create
| File | Purpose | Phase |
|------|---------|-------|
| `routes/candidate/profile.ts` | Candidate-facing profile endpoint | 3 |
| `src/pages/candidate/ProfilePage.tsx` | Frontend profile view | 3 |
| `routes/admin/candidateCoverage.ts` | Admin coverage dashboard | 5 |
| `routes/cron/reengagement.ts` | Re-engagement trigger cron | 5 |

### Files to modify
| File | Change | Phase |
|------|--------|-------|
| `lib/candidateDiscovery/candidateSituationFit.ts` | Inject Experience/Project/Skill nodes; recency decay | 2 |
| `lib/match/triangulateMatch.ts` | Evidence density multiplier; node type distribution logging | 2, 5 |
| `lib/candidateDiscovery/candidateCoverage.ts` | Source-aware weighted coverage | 2 |
| `lib/candidateDiscovery/candidateRecency.ts` | Recency decay rules | 2 |
| `lib/cultureAgentDecomposition.ts` | Unstub `persistDecomposition` | 3 |
| `routes/screening/culture.ts` | Standalone Mode 1 invite + consent routes | 3 |
| `lib/cultureAgentAdaptive.ts` | Handle null teamContext for profile_builder | 3 |
| `lib/cultureGenerativePlanner.ts` | Skip RCD personalization when teamContext is null | 3 |
| `lib/enrichment/githubEnrich.ts` | Contribution analysis, README/issue sampling, Skill derivation | 4 |
| `lib/enrichment/githubClient.ts` | New API methods for PRs, READMEs, issue comments | 4 |

---

## 10. Testing Strategy

### Phase 2 tests
- `lib/candidateDiscovery/__tests__/candidateSituationFit.test.ts` — prompt injection with mocked nodes
- `lib/match/__tests__/triangulateMatch.test.ts` — evidence density multiplier math
- `lib/candidateDiscovery/__tests__/candidateCoverage.test.ts` — source-aware weighted coverage

### Phase 3 tests
- `lib/cultureAgentDecomposition.test.ts` — stub replacement writes real nodes
- `routes/screening/culture.test.ts` — standalone screening flow
- `routes/candidate/profile.test.ts` — profile endpoint aggregates correctly

### Phase 4 tests
- `lib/enrichment/githubEnrich.test.ts` — contribution analysis creates correct node types

### Phase 5 tests
- `routes/admin/candidateCoverage.test.ts` — dashboard aggregation
- `routes/cron/reengagement.test.ts` — cron eligibility logic

### Regression tests (run after every phase)
- Existing `match_feedback` thumbs-up rate must not drop.
- `candidateSituationFit` with `culturalSignalNodes` must still work as before.
- Flat `candidate_searchable_profile` embedding must not break.

---

## 11. Definition of Done

**Phase 2 Done when:**
- [ ] `candidateSituationFit` prompt includes resume-derived nodes.
- [ ] `triangulateMatch` applies evidence density multiplier.
- [ ] Recruiter `match_feedback` shows no regression in thumbs-up rate.

**Phase 3 Done when:**
- [ ] `persistDecomposition` writes real nodes to `candidate_nodes`.
- [ ] Recruiter can invite a candidate to standalone Mode 1 screening.
- [ ] Candidate can view their profile graph.
- [ ] Mode 1 session completes without calling `scoreCultureInterview`.

**Phase 4 Done when:**
- [ ] GitHub enrichment creates `Skill`, `WorkingStyle`, and `CommunicationStyle` nodes.
- [ ] Contribution analysis creates Experience-like nodes for external repos.

**Phase 5 Done when:**
- [ ] Coverage dashboard is accessible to admins.
- [ ] Re-engagement cron sends emails to dormant candidates.
- [ ] Match feedback includes node type distribution.

---

## 12. Where to Start

If you are picking up this handoff, read these three files first:

1. **`lib/candidateDiscovery/candidateNodes.ts`** — How nodes are inserted, queried, and embedded. This is your core API for all phases.
2. **`lib/candidateDiscovery/resumeDecomposition.ts`** — The Phase 1 pipeline that feeds the graph. Understand its output before modifying consumers.
3. **`lib/candidateDiscovery/candidateSituationFit.ts`** — The matching prompt. This is where Phase 2 begins.

Then decide: start with Phase 2 (matching) or jump to Phase 3 (screener) if the screener stub is higher priority for product.
