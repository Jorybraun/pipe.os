# Repo Decomposition Schema (`repo_nodes`)

**Source:** knowledge/plan/pipe-strategy-v2-part3-repo-ingestion.md (lines 98–142, 269–271)
**Phase:** 2
**Status:** PENDING
**Estimate:** 2.5 weeks

## Source quote
> The goal: turn Pass 3's labeled blob into addressable sub-element nodes, same pattern as roles. The Pass 3 output stays — it's the authoritative synthesis artifact at the repo level. Sub-elements are a derivative view, regenerated per Pass 3 run, pointed back to the originating Pass 2 signals for traceability.
>
> Each sub-element gets its own embedding (rich narrative with type prefix: "Feature: ..." or "ArchitecturalPattern: ..."). Pass 3 prompting expands to generate these per-sub-element narratives instead of a single labeled blob.

## Why
The current `repo_searchable_profile` is one blob — role-repo matching can only compare overall narrative similarity, not align specific requirements against specific repo sub-elements. Decomposition enables per-sub-element matching that is both more accurate and more explainable.

## Sub-element types
`Feature`, `ArchitecturalPattern`, `TechnicalStack`, `Construct`, `ChallengeSurface`, `QualitySignal`, `DomainContext`, `PRSample`, `IssueCandidate`

## Caveats to document in code
- Rich repos produce 20+ sub-elements; thin repos 3–5. The matching layer (Part 5) uses `max(sim)` aggregation per requirement to prevent volume-based score inflation.
- Pass 3 token count increases modestly (~30–50%) vs current single-blob output. Monitor via `ai_usage_events`.

## Subtasks (delegable)

### Subtask 1 — Migration: `repo_nodes` table
**Files:**
- `workers/api/migrations/XXXX_repo_nodes.sql` (new — assign number at implementation time)

**Spec:**
- Schema exactly as specified in source (lines 126–140):
  ```sql
  repo_nodes (
    id TEXT PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES qualified_repos(id),
    signals_version TEXT NOT NULL,
    node_type TEXT NOT NULL CHECK(node_type IN ('Feature','ArchitecturalPattern','TechnicalStack','Construct','ChallengeSurface','QualitySignal','DomainContext','PRSample','IssueCandidate')),
    narrative_text TEXT NOT NULL,
    extracted_properties_json TEXT,
    embedding_json TEXT,
    source_reference TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  ```
- Index on `(repo_id, node_type)` and `(repo_id, signals_version)`.
- `id` generated as `<repo_id>_<node_type>_<slug>` where slug is a short kebab-case identifier for the sub-element.
**Status:** ⏳ PENDING

### Subtask 2 — Pass 3 prompt rewrite for sub-element generation
**Files:**
- `workers/api/scripts/crawl-repos/pass3/run.ts` (Pass 3 prompt is currently inline at line ~107; either extract to a new `prompts.ts` or rewrite in place)

**Spec:**
- New prompt produces structured JSON with arrays per sub-element type. Retain the three existing summary fields (`architecture_style`, `engineering_narrative`, `repo_searchable_profile`) as top-level outputs alongside the sub-element arrays — legacy consumers (REPO_INDEX overall narrative) are not broken.
- Prompt instructs Gemma: enumerate sub-elements the repo actually supports; don't force a fixed count; don't invent features absent from Pass 2 signals; each sub-element narrative must be 2–3 sentences, repo-specific (not generic), cite specific technologies and scale indicators.
- Define a Zod schema for the expected output shape to validate before writing to D1.
- Return type: `Pass3Output` with both legacy fields and `subElements: RepoSubElement[]`.
**Status:** ⏳ PENDING

### Subtask 3 — Pass 3 runner writes sub-elements to `repo_nodes`
**Files:**
- `workers/api/scripts/crawl-repos/pass3/run.ts`

**Spec:**
- After Gemma returns the sub-element JSON: validate with Zod, upsert each sub-element row into `repo_nodes` (delete existing rows for the repo + signals_version, then insert fresh — transactional delete+insert to avoid partial state).
- For `PRSample` and `IssueCandidate` node types: derive from existing `repo_sample_prs` and `repo_issues` rows (no Gemma required for these types); construct narrative from existing metadata fields.
- Embed each sub-element's `narrative_text` (with type prefix) via `preprocessForEmbedding(text, 'document')` — consistent with candidate/role side.
- Write `embedding_json` to the `repo_nodes` row (ADR-040 dual-layer pattern).
- Upsert to REPO_INDEX with metadata `{entity_type:'repo', entity_id:repo_id, node_type:<type>, signals_version:<version>, admin_status:'approved'}`.
**Status:** ⏳ PENDING

### Subtask 4 — Backfill for existing `pass=3` repos
**Files:**
- `workers/api/scripts/backfillRepoNodes.ts` (new)

**Spec:**
- Query all repos where `pass >= 3` and `repo_nodes` count for repo is 0.
- Re-run Pass 3 prompt against their existing `repo_engineering_signals` output (don't re-run Gemma from scratch if `engineering_narrative` exists — use it as input to a cheaper extraction call, or re-run full Pass 3 if budget allows).
- Support `--dry-run`, `--batch N`, `--repo-id <id>` for targeted runs.
**Status:** ⏳ PENDING

## Dependencies
- Depends on: Subagent E (preprocessing normalization — already DONE)
- Depends on: Subagent C (embedding model version stamp — already DONE)
- Depends on: `confidence-threshold-auto-approval.md` Phase 0 scorer interface should be extended to accept sub-element input when this lands
- Blocks: Part 5 matching rewrite (which consumes `repo_nodes`)
- Blocks: `pr-narrative-enrichment.md` (PRSample sub-elements use the same `repo_nodes` table)

## Acceptance criteria
- [ ] `repo_nodes` migration applies cleanly
- [ ] Pass 3 CI run writes sub-elements for each processed repo
- [ ] Each sub-element has a non-null `embedding_json`
- [ ] Sub-elements appear in REPO_INDEX with correct metadata tags
- [ ] Existing `repo_searchable_profile` / `engineering_narrative` fields still populated (legacy consumers unbroken)
- [ ] Backfill script runs against staging without errors
- [ ] Zod validation rejects malformed Gemma output before any D1 write
- [ ] `npx tsc --noEmit` passes
