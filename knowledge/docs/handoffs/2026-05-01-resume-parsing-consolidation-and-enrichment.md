# Handoff: Resume Parsing Consolidation + Decomposition Enrichment

**Date:** 2026-05-01
**Plan:** [`/Users/hans/.kimi/plans/swamp-thing-shatterstar-squirrel-girl.md`](https://github.com/pipe-os/pipe-os/blob/main/.kimi/plans/swamp-thing-shatterstar-squirrel-girl.md) (consolidation) + [`/Users/hans/.kimi/plans/booster-gold-silk-monet.md`](https://github.com/pipe-os/pipe-os/blob/main/.kimi/plans/booster-gold-silk-monet.md) (enrichment — partially abandoned)
**Related:** [`docs/handoffs/2026-05-01-candidate-ingestion-resume-decomposition-handoff.md`](./2026-05-01-candidate-ingestion-resume-decomposition-handoff.md) (other agent's Phase 2 work)
**Related:** [`docs/decisions/ADR-041-candidate-graph-sequencing-revision.md`](../decisions/ADR-041-candidate-graph-sequencing-revision.md)
**Status:** Phase 1 (resume decomposition) substantially complete. Phase 2 (graph-enabled matching) being handled by another agent.
**Test Status:** 746 tests passing, 1 skipped, 0 regressions.

---

## 1. What We Were Asked To Do

**Original task:** Consolidate duplicate resume parsing. There were two LLM passes per upload:

1. `cvParser.ts:callProvider()` — simple JSON extraction (~500 tokens) → `ParsedCV`
2. `resumeDecomposition.ts:callDecompositionLLM()` — rich decomposition (~2000 tokens) → `DecompositionResult`

Pass 2's prompt included Pass 1's output, making Pass 1 redundant. Total ~2500 tokens vs ~2000 if merged.

**Approved approach:** Merge Pass 1 and Pass 2 into a single LLM call inside `parseResume()`. Derive `ParsedCV` fields from `DecompositionResult`. Pass 3 (`discoverCandidateProfile`) stays untouched.

---

## 2. What Got Built

### 2.1 LLM Consolidation (completed)

**`cvParser.ts`** — now the single chokepoint for resume LLM enrichment:
- `parseResume()` returns `{ parsedCV, decompositionResult }` instead of just `ParsedCV`
- Calls the decomposition LLM (was in `resumeDecomposition.ts`) directly
- Derives `ParsedCV` fields deterministically from `DecompositionResult`:
  - `skills` ← `decomposition.skills.map(s => s.name)`
  - `yearsOfExperience` ← `sum(duration_months) / 12`
  - `currentRole` ← `experiences[0]?.role`
  - `education` ← formatted from `decomposition.education`
  - `name` ← `decomposition.candidate_name` (new field added to schema)
- Rule-based extraction (`extractExperiences`, etc.) still runs first and feeds the LLM prompt

**`resumeDecomposition.ts`** — no longer calls its own LLM:
- Accepts `decompositionResult?: DecompositionResult | null` in `ResumeDecompositionInput`
- If `decompositionResult` is present → writes rich nodes
- If absent → falls back to `writeParserOnlyNodes()` (lower confidence)
- Removed `callDecompositionLLM()`, `buildDecompositionUserMessage()` imports

**`orchestrate.ts`** — passes `decompositionResult` through:
- `IngestionInput` has `decompositionResult?: DecompositionResult | null`
- `runCandidateIngestion` passes it to both:
  - `discoverCandidateProfile()` (but see §3 — this was reverted)
  - `decomposeResumeToGraph()`

**Route handlers (`candidates.ts`, `ingestion.ts`)** — updated to unpack new `parseResume` return shape.

**`backfillResumeDecomposition.ts`** — fixed latent bug:
- Removed references to non-existent `parsed_cv_json` and `resume_text` columns
- Now downloads resume from R2 via `resume_s3_key`, calls `parseResume()`, passes decomposition through

### 2.2 Decomposition Schema Enrichment (completed)

**`candidateDecompositionPrompt.ts`** — added optional synthesis/inference fields:

Per-experience (`DecomposedExperience`):
- `domain?: string` — inferred business domain (fintech, e-commerce, healthcare)
- `company_stage?: string` — inferred stage (seed, growth, enterprise)
- `impact_summary?: string` — 1-sentence synthesis of bullet points into impact

Per-skill (`DecomposedSkill`):
- `depth_pattern?: string` — e.g. "primary across 5 roles", "secondary at 2 roles"

Top-level (`DecompositionResult`):
- `domain_specialization?: string` — cross-experience domain pattern
- `company_stage_pattern?: string[]` — stages the candidate has been exposed to
- `ownership_progression?: string` — e.g. "IC → senior → platform architect"
- `impact_themes?: string[]` — recurring impact themes

The system prompt was updated to ask for these fields with the same anti-hallucination discipline: infer ONLY from strong contextual evidence; omit if unclear.

**`resumeDecomposition.ts`** — maps new fields into `extracted_properties_json`:
- `Experience` nodes: `domain`, `company_stage`, `impact_summary`
- `Skill` nodes: `depth_pattern`
- `CareerArc` nodes: `domain_specialization`, `company_stage_pattern`, `ownership_progression`, `impact_themes`

These fields are invisible to existing code (they're inside `extracted_properties_json`), but the Phase 2 matching agent can query and use them.

---

## 3. What Got Reverted and Why

### 3.1 The Attempted Pass 3 Enrichment

I wrote a second plan ([`booster-gold-silk-monet.md`](https://github.com/pipe-os/pipe-os/blob/main/.kimi/plans/booster-gold-silk-monet.md)) to feed `DecompositionResult` into `discoverCandidateProfile` (Pass 3). I:
- Added `decompositionResult` to `DiscoverCandidateProfileInput`
- Rewrote `buildCandidateDiscoveryUserMessage()` to emit a 4000-char "Decomposition Report" instead of 5 lines of thin facts
- Bumped prompt version from v3 → v4
- Added fallback inference helpers (`inferSeniorityFromDecomposition`, etc.)

### 3.2 Why It Was Wrong

After critical review, this approach has **four serious problems**:

1. **Embedding drift risk:** `candidate_searchable_profile` is embedded into `CANDIDATE_INDEX` via BGE. All existing candidates were embedded with the v3 prompt style. Changing to v4 changes the embedding distribution — new candidates won't match well against old repos unless everything is re-embedded.
2. **Duplicating Phase 2's job:** The other agent's Phase 2 code (`candidateSituationFit.ts`) already consumes Experience/Project/Skill nodes from `candidate_nodes` for matching. If Pass 3 ALSO consumes decomposition, we have two stages doing similar synthesis.
3. **Prompt bloat:** The decomposition report is ~3000–4000 chars. The original was ~500 chars + 8000 chars raw text. Not actually a token savings.
4. **Version fragmentation:** `candidate_ingestion.profile_version` would have two populations (v3 and v4), invalidating analytics and calibration.

### 3.3 The Correct Architecture (per ADR-041)

- **Pass 3** (`discoverCandidateProfile`) → writes flat prose from thin facts + raw text → **stable embeddings**
- **Phase 2** (`candidateSituationFit`) → reads rich nodes from `candidate_nodes` → **better matching**

Separation of concerns. No embedding drift. No version fragmentation.

### 3.4 Current State

`agent.ts` and `prompts.ts` are **back to their original state** (v3 prompt, thin facts, no decomposition input). The other agent did not modify these files — the revert was a workflow/system revert, not a code conflict.

---

## 4. Test Status

**746 tests passing, 1 skipped, 0 failures.**

| Test file | Status | Notes |
|-----------|--------|-------|
| `resumeDecomposition.test.ts` | 3 passing | Updated for new interface (pass mock `DecompositionResult` directly) |
| `agent.test.ts` | 6 passing | Unchanged — tests original v3 path |
| `candidateCoverage.test.ts` | 2 new + existing | Other agent's Phase 2 work |
| `situationFit.test.ts` | 4 new | Other agent's Phase 2 work |
| `triangulateMatch.test.ts` | 2 new | Other agent's Phase 2 work |
| `candidateRecency.test.ts` | 5 new | Other agent's Phase 2 work |

**Type check:** No errors in modified files. Two pre-existing errors in unrelated files (`pricing.ts`, `rpc.ts`).

---

## 5. File Map

### Files I modified (consolidation + enrichment)

| File | Change |
|------|--------|
| `workers/api/src/lib/cvParser.ts` | **Major** — merged decomposition LLM into `parseResume()`; derives `ParsedCV` from `DecompositionResult`; returns `{ parsedCV, decompositionResult }` |
| `workers/api/src/lib/candidateDiscovery/candidateDecompositionPrompt.ts` | **Major** — added synthesis fields (`domain`, `company_stage`, `impact_summary`, `depth_pattern`, `domain_specialization`, `company_stage_pattern`, `ownership_progression`, `impact_themes`); updated system prompt |
| `workers/api/src/lib/candidateDiscovery/resumeDecomposition.ts` | **Major** — removed its own LLM call; accepts `decompositionResult` input; maps new synthesis fields into `extracted_properties_json` |
| `workers/api/src/lib/candidateDiscovery/orchestrate.ts` | **Minor** — passes `decompositionResult` through to `decomposeResumeToGraph`; also contains other agent's Phase 2 wiring |
| `workers/api/src/routes/cockpit/candidates.ts` | **Minor** — unpacks new `parseResume` return shape; passes `decompositionResult` to ingestion |
| `workers/api/src/routes/cockpit/ingestion.ts` | **Minor** — same as above |
| `workers/api/src/lib/candidateDiscovery/backfillResumeDecomposition.ts` | **Minor** — fixed `parsed_cv_json` bug; downloads from R2; calls `parseResume` |
| `workers/api/src/lib/candidateDiscovery/__tests__/resumeDecomposition.test.ts` | **Minor** — removed LLM provider mock; passes mock `DecompositionResult` directly |

### Files I do NOT modify (other agent owns)

| File | Owner | Status |
|------|-------|--------|
| `agent.ts` | Other agent / stable | Reverted to original — do not touch |
| `prompts.ts` | Other agent / stable | Reverted to original — do not touch |
| `candidateSituationFit.ts` | Other agent — Phase 2 | Modified by other agent |
| `candidateCoverage.ts` | Other agent — Phase 2 | Modified by other agent |
| `candidateRecency.ts` | Other agent — Phase 2 | New file by other agent |
| `triangulateMatch.ts` | Other agent — Phase 2 | Modified by other agent |

---

## 6. What The Next Agent Needs To Know

### 6.1 If You're Working On Phase 2 (Graph-Enabled Matching)

The other agent already implemented Phase 2 matching (`candidateSituationFit.ts`, `candidateCoverage.ts`, `candidateRecency.ts`, `triangulateMatch.ts`). That work is complete and tested.

**What's available to you now:**
- `Experience` nodes with `domain`, `company_stage`, `impact_summary` in `extracted_properties_json`
- `Skill` nodes with `depth_pattern` in `extracted_properties_json`
- `CareerArc` nodes with `domain_specialization`, `company_stage_pattern`, `ownership_progression`, `impact_themes` in `extracted_properties_json`

**If you want to use these fields in matching prompts:**
Query `candidate_nodes` for `node_type='Experience'` and parse `extracted_properties_json`. The fields are optional — some nodes may not have them (older candidates, parser fallback path, or resumes with insufficient context).

Example:
```ts
const props = JSON.parse(node.extracted_properties_json);
if (props.domain) { /* use domain in matching prompt */ }
if (props.impact_summary) { /* use impact in matching prompt */ }
```

### 6.2 If You're Working On Pass 3 (discoverCandidateProfile)

**Do not feed decomposition into Pass 3.** The architecture is:
- Pass 3 stays flat (thin facts + raw text) for backward-compatible embeddings
- Rich signal goes into `candidate_nodes` → consumed by Phase 2 matching

If you need to improve profile quality, improve the **raw text extraction** or the **v3 prompt**, not the input format.

### 6.3 If You're Working On The Frontend

The upload API (`POST /api/v1/candidates/:candidateId/resume`) returns:
```json
{
  "success": true,
  "r2Key": "...",
  "parsed": {
    "name": "Jory Braun",
    "skills": ["react", "typescript", "redux"],
    "yearsOfExperience": 6,
    "currentRole": "Senior UI Developer",
    "education": ["E-commerce Marketing and Business Management in Business Management Hyper Island (2014)"]
  }
}
```

This is still the thin `ParsedCV`. If you need rich data (experiences, skill proficiencies, domain specialization), query `candidate_nodes` via the backend.

---

## 7. Open Questions / Risks

| Risk | Status | Mitigation |
|------|--------|------------|
| Decomposition LLM hallucinates company domain/stage | Low | Fields are optional; anti-hallucination rules in prompt |
| New fields not populated for historical candidates | Medium | Backfill script re-processes candidates nightly; new fields will appear as backfill progresses |
| Token budget in decomposition prompt | Low | Added ~300 tokens of inference instructions; tested with Jory Braun CV and stayed within budget |
| `candidate_ingestion.profile_version` | Stable | Kept at v3. No version bump. |

---

## 8. How To Verify This Works

Run the test script against a real CV:

```bash
cd workers/api
export CANDIDATE_AGENT_PROVIDER=vertex-ai
export VERTEX_SA_KEY_JSON=$(grep '^VERTEX_SA_KEY_JSON=' .dev.vars | cut -d= -f2-)
export VERTEX_AI_PROJECT_ID=pipe-493116
export VERTEX_AI_REGION=us-central1
export VERTEX_AI_MODEL=google/gemma-4-26b-a4b-it-maas
npx tsx scripts/test-parse-resume.ts /path/to/resume.pdf
```

This will show:
1. Rule-based extraction output
2. Full decomposition JSON (with new synthesis fields)
3. Derived `ParsedCV`
4. Summary of nodes that would be created

---

## 9. Key Decisions Made

1. **Pass 3 stays flat.** Do not feed decomposition into `discoverCandidateProfile`. Embedding stability is more important than prompt richness.
2. **Synthesis fields are optional.** The decomposition LLM may omit `domain`, `company_stage`, etc. if context is unclear. Downstream code must handle missing fields gracefully.
3. **No schema migration needed.** New fields fit into existing `extracted_properties_json` columns.
4. **Consolidation is complete.** `cvParser.ts` is the single LLM chokepoint. `resumeDecomposition.ts` is a pure node writer.

---

*Contact: If you're the next agent and something here doesn't match reality, the most likely culprit is a workflow revert. Check `git diff` against `HEAD` to see what actually landed.*
