# Candidate Sub-Element Embedding — Per-Node Vector Upserts

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 132–136, 336–338)
**Phase:** 1
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> Update `lib/candidateDiscovery/embed.ts` to embed each sub-element separately, write to CANDIDATE_INDEX with metadata tags. Keep the aggregate `candidate_searchable_profile` and `embedding_json` updated as aggregates over sub-elements for backward compatibility.
>
> In Vectorize, each sub-element gets its own vector in CANDIDATE_INDEX with metadata `{entity_type='candidate', candidate_id=<id>, node_type=<type>, source_type=<source>, confidence=<conf>, superseded=<0|1>}`.

## Why
Per-node embedding is what makes sub-element-level matching possible. Without it, matching still falls back to the aggregate 1024-d candidate vector, which doesn't benefit from decomposition. The metadata filter `superseded=0` lets ANN queries skip stale nodes without re-indexing.

## Subtasks (delegable)

### Subtask 1 — Per-node embed function
**Files:**
- `workers/api/src/lib/candidateDiscovery/embed.ts`

**Spec:**
Add `embedCandidateNode(node: CandidateNode, ai: Ai, vectorize: Vectorize, db: D1Database): Promise<void>`. Embeds `node.narrative_text` via `preprocessForEmbedding(text, 'document')` then `env.AI.run('@cf/baai/bge-large-en-v1.5', ...)`. Upserts to CANDIDATE_INDEX with id `candidate_node_<node.id>` and metadata: `{ entity_type: 'candidate', candidate_id: node.candidate_id, node_type: node.node_type, source_type: node.source_type, confidence: node.confidence ?? 0, superseded: node.superseded_at ? 1 : 0 }`. Writes `embedding_json` back to `candidate_nodes` row (same dual-layer ADR-040 pattern used for `candidate_ingestion`). Stamps `embedding_model_version` via `EMBEDDING_MODEL_VERSION` from `preprocess.ts`.

**Status:** ⏳ PENDING

---

### Subtask 2 — Batch embed all nodes for a candidate
**Files:**
- `workers/api/src/lib/candidateDiscovery/embed.ts`

**Spec:**
Add `embedAllCandidateNodes(candidateId: string, ai: Ai, vectorize: Vectorize, db: D1Database): Promise<void>`. Fetches all non-superseded nodes for candidate via `getActiveCandidateNodes(db, candidateId)`. Embeds each sequentially (Vectorize upserts are not safely batchable in Cloudflare Workers at arbitrary size). Log `[embed] embedded N nodes for candidate <id>`. Existing `embedAndUpsertCandidate` (aggregate) remains and is called after all node embeds complete.

**Status:** ⏳ PENDING

---

### Subtask 3 — Mark superseded nodes in Vectorize
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`

**Spec:**
Extend `supersedeCandidateNode` to also update the Vectorize metadata for the old node: upsert with the same vector but with `superseded: 1` in metadata. Signature: `supersedeCandidateNode(db, vectorize, oldId, newId)`. Keeping the vector allows inspection but ANN queries filtering `superseded=0` will skip it. Only metadata update needed — no re-embedding.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md` (types, CRUD helpers), `candidate-decomposition-prompt.md` (nodes must exist to embed)
- Blocks: `candidate-backfill-decomposition.md`, `candidate-matching-sub-elements.md`

## Acceptance criteria
- [ ] `embedCandidateNode` writes `embedding_json` to `candidate_nodes` row in D1
- [ ] Vectorize upsert includes all required metadata fields
- [ ] `supersedeCandidateNode` updates Vectorize metadata `superseded=1` on old node
- [ ] ANN query with filter `{ superseded: { $eq: 0 } }` excludes superseded nodes (integration test)
- [ ] `npx tsc --noEmit` clean
- [ ] `EMBEDDING_MODEL_VERSION` stamp written to each node row
