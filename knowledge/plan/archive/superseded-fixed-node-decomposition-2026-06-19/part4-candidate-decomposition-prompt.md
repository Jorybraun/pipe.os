# Candidate Decomposition Prompt — Structured Sub-Element Extraction

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md (lines 329–341)
**Phase:** 1
**Status:** PENDING
**Estimate:** 1.5 weeks

## Source quote
> Rewrite `candidateDiscovery/prompts.ts` to produce structured decomposition — sub-element JSON rather than flat narrative. LLM prompt produces Experience, Project, Accomplishment, Skill, Education, Credential arrays with rich narratives and extracted properties.

## Why
The current flat-prose extraction misses structural richness (career_context_json, situation_signature_json, key_concepts_json) that sits unused. Switching to sub-element JSON output gives each piece of resume evidence its own addressable node, enabling per-node embedding, provenance tracking, and targeted matching. This is the foundational Phase 1 code change that all matching improvements depend on.

## Subtasks (delegable)

### Subtask 1 — New structured extraction prompt
**Files:**
- `workers/api/src/lib/candidateDiscovery/prompts.ts`

**Spec:**
Add `buildCandidateDecompositionPrompt(resumeText: string): string` that instructs Gemma to produce a JSON object with arrays for each sub-element type: `experiences`, `projects`, `accomplishments`, `skills`, `education`, `credentials`. Each array item has `narrative_text` (2-3 sentences), `extracted_properties` (typed per sub-element type — see strategy lines 69-82), `confidence` (0–1 float), and `source_hint` (verbatim resume phrase that grounded this node). Prompt must specify: respond ONLY with valid JSON, no markdown fences, no commentary. Keep existing `buildCandidateSearchableProfilePrompt` — it stays as aggregate fallback. Bump `CANDIDATE_DISCOVERY_PROMPT_VERSION` to `candidate-v4`.

**Status:** ⏳ PENDING

---

### Subtask 2 — TypeScript types for sub-element extracted properties
**Files:**
- `workers/api/src/lib/candidateDiscovery/types.ts`

**Spec:**
Add typed interfaces for each sub-element's `extracted_properties`: `ExperienceProperties` (role_title, company, company_stage, company_size, duration_months, team_size, ownership_depth, scope), `ProjectProperties` (name, what_built, technologies, their_role, outcome, scale), `AccomplishmentProperties` (what, quantified_impact, contribution, context), `SkillProperties` (name, proficiency_signal, years_exposure, recency, esco_id?), `EducationProperties` (institution, degree, field, start_year, end_year), `CredentialProperties` (name, issuer, date, context). All fields optional except name/title. Export `DecompositionOutput` as union of these.

**Status:** ⏳ PENDING

---

### Subtask 3 — Extraction runner: call LLM and parse decomposition output
**Files:**
- `workers/api/src/lib/candidateDiscovery/extractCandidateNodes.ts`

**Spec:**
Export `extractCandidateNodes(resumeText: string, ai: Ai): Promise<RawDecompositionOutput>`. Calls Gemma via `buildCandidateDecompositionPrompt`, JSON.parses the response, validates shape with a type guard `isDecompositionOutput(val: unknown): val is RawDecompositionOutput`. On JSON parse failure or shape mismatch: log `[extractCandidateNodes] decomposition parse failed` + raw response first 500 chars, throw. Returns typed arrays only. No silent empty returns.

**Status:** ⏳ PENDING

---

### Subtask 4 — Wire decomposition into orchestrate.ts (alongside existing path)
**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Spec:**
After the existing `runCandidateIngestion` extraction step, add a new optional step: if `DECOMPOSITION_ENABLED` env flag is set (default false, toggle per environment), call `extractCandidateNodes` and write resulting nodes via `insertCandidateNode` from `candidateNodes.ts`. The flat `candidate_searchable_profile` and its embedding continue to be written unconditionally — decomposition is additive. Step must be wrapped in try/catch so decomposition failure does not abort ingestion. Log `[orchestrate] decomposition step skipped` on flag-off, `[orchestrate] decomposition failed, continuing` on exception.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md` (types and CRUD helpers must exist before orchestration wiring)
- Blocks: `candidate-sub-element-embedding.md`, `candidate-backfill-decomposition.md`, `candidate-matching-sub-elements.md`

## Acceptance criteria
- [ ] `buildCandidateDecompositionPrompt` produces valid JSON-only prompt (no markdown escaping)
- [ ] `extractCandidateNodes` throws on malformed LLM response (unit test with mock bad JSON)
- [ ] `extractCandidateNodes` returns correct arrays on valid mock LLM response
- [ ] With `DECOMPOSITION_ENABLED=true`, a full orchestration run inserts nodes into `candidate_nodes`
- [ ] With `DECOMPOSITION_ENABLED=false` (default), existing path runs unchanged — existing tests pass
- [ ] `npx tsc --noEmit` clean
