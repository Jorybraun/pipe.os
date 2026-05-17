# Neo4j-First Architecture Migration — Executive Summary

## Context

The PIPE matching system is stuck in a messy transitional state. Six months ago we began a migration from D1+Vectorize to Neo4j for graph-shaped data (candidates, roles, repos, their sub-elements, embeddings, and relationships). The migration scaffolding (dual-write flags, shadow-read hooks, parity dashboards) was built but never enabled — all gated behind `DUAL_WRITE_NEO4J=false` and `SHADOW_READ_NEO4J=false`. Meanwhile, the production system continues to run on:

- **D1** for transactional data (pipelines, stages, assessments, audit logs) ✅ correct
- **Vectorize** (`CANDIDATE_INDEX`, `REPO_INDEX`, `ROLE_INDEX`) for ANN matching ⚠️ requires `--remote`, breaks local dev
- **D1 `candidate_nodes` / `role_sub_elements`** tables that are written to but never read for matching ❌ dead weight
- **`triangulateMatch.ts`** — an 11-step weighted combinator blending 4+ signals with 3 fallback paths ❌ opaque, fragile

The result: matching works in production (barely) but local dev is broken, the UX shows opaque scores recruiters can't explain, and the codebase carries hundreds of lines of dead code.

## Goal

1. **Strip all dead code** — dual-write flags, shadow reads, parity dashboard, unreachable Neo4j paths
2. **Make Neo4j the primary operational store** for all graph-shaped data
3. **Matching is a query, not a pipeline step** — no pre-computed scores, no loading screen, no `status: 'matched'`. The graph is always current; matching runs on-demand via Cypher when a recruiter views a candidate against a role
4. **Fix the matching UX** — make scores explainable with requirement-level evidence cards

## Data Partition (Hard Boundary)

| Store | Owns | Does NOT own |
|---|---|---|
| **Neo4j** | Candidates, roles, repos, sub-elements, embeddings, relationships | Pipelines, stages, assessments, audit logs, user accounts, pre-computed scores |
| **D1** | Pipelines, stages, assessments, audit logs, user accounts, basic candidate/role metadata | Sub-element embeddings, graph relationships, matching computation, pre-computed match scores |
| **Vectorize** | Nothing (read-only archive after migration) | Nothing — stop all writes |

## Key Constraints

1. **Cloudflare Workers + Neo4j Bolt** — The Neo4j JavaScript driver uses TCP Bolt. Workers does not support arbitrary TCP. Solution: keep Neo4j behind the API worker (runs in Node.js/Wrangler with full TCP). Already fixed: `createNeo4jDriver()` per request + `finally { driver.close() }`.

2. **Vectorize read-only** — We keep Vectorize indices as a read-only archive. Do NOT delete bindings from `wrangler.jsonc`. Stop all `.upsert()` calls.

3. **Scale** — ~64 candidate_nodes, ~64 role_nodes, ~2,251 repos (10 with rich elements). At this scale, exact cosine brute-force in Cypher is ~5-20ms — faster than HNSW index overhead. We use exact search for precision.

4. **No zero-downtime requirement** — This is a dev-stage system. Brief matching unavailability during cutover is acceptable.

## Sequencing Overview

| Phase | Duration | What |
|---|---|---|
| **Phase 1** | Day 1-2 | Dead code removal — safe deletions only |
| **Phase 2** | Day 3-5 | Neo4j write path — make `writeCandidateGraph`, `writeRoleGraph` primary |
| **Phase 3** | Day 6-10 | Matching pipeline — Cypher queries, `matchRouter` cutover |
| **Phase 4** | Day 11-14 | Frontend UX — per-requirement evidence cards |
| **Phase 5** | Day 15-17 | Repo backfill — run ingestion on all 2,251 repos |

Total: ~3 weeks. Phases 1+3 can overlap (UX work starts while backend Cypher is being validated).

## Files Created by This Plan

```
knowledge/plan/neo4j-migration/
├── 00-executive-summary.md              (this file)
├── 01-neo4j-vector-search-deep-dive.md  (HNSW, exact vs ANN, filtering patterns)
├── 02-schema-design.md                  (labels vs props, temporal versioning)
├── 03-phase-1-dead-code-removal.md      (file-by-file deletion instructions)
├── 04-phase-2-write-path-migration.md   (making Neo4j writes primary)
├── 05-phase-3-matching-cypher-queries.md (the complete query architecture)
├── 06-phase-4-matching-ux-overhaul.md   (frontend components, API shapes)
├── 07-phase-5-repo-backfill.md          (repo matching, backfill strategy)
└── 08-implementation-sequencing.md      (week-by-week, risks, acceptance criteria)
```

## Immediate Next Step

Read `03-phase-1-dead-code-removal.md` and execute. It contains only safe deletions — files with zero active callers. No risk.
