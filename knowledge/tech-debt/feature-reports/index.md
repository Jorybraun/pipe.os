# Feature-Based Technical Debt Reports

> Generated: 2026-05-18
> Scope: Backend codebase analyzed by domain/feature
> Method: Code trace, LOC count, test coverage audit, duplication scan, coupling analysis

---

## Reports

| # | Feature | Files | LOC | Manageability | Report |
|---|---------|-------|-----|---------------|--------|
| FR-001 | Candidate Ingestion Pipeline | ~21 | ~7,087 | **C+** | [FR-001-candidate-ingestion-pipeline.md](./FR-001-candidate-ingestion-pipeline.md) |
| FR-002 | Culture Interview System | ~14 | ~12,500 | **C+** | [FR-002-culture-interview-system.md](./FR-002-culture-interview-system.md) |
| FR-003 | Role Discovery & Semantic Matching | ~38 | ~10,860 | **C** | [FR-003-role-discovery-matching.md](./FR-003-role-discovery-matching.md) |
| FR-004 | Graph / Neo4j Layer | ~8 | ~1,596 | **B-** | [FR-004-graph-neo4j-layer.md](./FR-004-graph-neo4j-layer.md) |
| FR-005 | LLM Provider Infrastructure & Auth | ~19 | ~2,900 | **C** | [FR-005-llm-provider-infrastructure.md](./FR-005-llm-provider-infrastructure.md) |
| FR-006 | API Routing Layer & Types | ~38 | ~19,100 | **D+** | [FR-006-api-routing-layer.md](./FR-006-api-routing-layer.md) |

---

## Cross-Cutting Summary

### Total Production LOC by Feature

```
API Routing Layer        ████████████████████████████████████  19,100
Culture Interview        ████████████████████████              12,500
Role Discovery/Matching  █████████████████████                 10,860
Candidate Ingestion      ██████████████                         7,087
LLM/Auth Infrastructure  ██████                                 2,900
Graph/Neo4j Layer        ███                                    1,596
                                ─────────────────────────────────────
                                Total: ~54,043 LOC (with overlap)
```

### Test Coverage Heatmap

| Feature | Production LOC | Test LOC | Coverage Ratio | Untested Backbone Files |
|---------|---------------|----------|----------------|------------------------|
| Candidate Ingestion | ~7,087 | ~1,800 | ~25% | `orchestrate.ts`, `persist.ts`, `cvParser.ts`, `githubEnrich.ts`, `autoStageBuilder.ts`, `matchRepos.ts` |
| Culture Interview | ~12,500 | ~6,691 | ~53% | `agentInterview.ts` (bridge), `cultureAgentContext.ts`, `cultureAgentDecomposition.ts` |
| Role Discovery | ~10,860 | ~1,873 | ~17% | `synthesizeRcd.ts`, `matchRouter.ts`, `matchRepos.ts`, `consumerSlice.ts` |
| Graph/Neo4j | ~1,596 | ~725 | ~45% | Fallback paths untested |
| LLM/Auth | ~2,900 | ~198 | ~7% | All provider implementations, all auth middleware, JWT library |
| API Routing | ~19,100 | ~2,929 | ~15% | 5 of 7 super-god files untested |

### Most Critical Gaps

1. **API Routing Layer** — 7 god files >1000 LOC, 5 completely untested. `rpc.ts` (1,560 LOC) has zero tests.
2. **LLM Provider Infrastructure** — ~2,900 LOC with ~7% test coverage. All provider impls and auth middleware untested.
3. **Candidate Ingestion Orchestrator** — `orchestrate.ts` (752 LOC) is the backbone of the pipeline with zero tests.
4. **Role Synthesis** — `synthesizeRcd.ts` (455 LOC) has no unit tests; only manual/integration tested.
5. **JSON.parse Safety** — 129 blind `JSON.parse(x) as T` calls across routes. No runtime validation.

### Duplication Hotspots

1. `agentInterview.ts` ↔ `culture.ts` — ~80% identical bridge duplication
2. `writeCandidateGraph.ts` ↔ `writeRoleGraph.ts` — Shared MERGE pattern
3. `createProvider.ts` — 8 nearly identical factory functions
4. `candidateAuth.ts` ↔ `participantAuth.ts` — ~80% identical
5. `parseJsonColumn` — 4+ implementations across route files
6. `stripJsonFences` — 4+ implementations across provider files

### Recommended Sequencing

**Week 1–2: Test the untested backbone**
- `orchestrate.ts` unit tests (mock D1, mock Neo4j, mock AI)
- `persist.ts` unit tests (pure D1 SQL — straightforward)
- `auth.ts` + `candidateAuth.ts` middleware tests

**Week 3–4: Eliminate duplication**
- Extract `CultureSessionService` from bridge duplication
- Collapse 8 provider factories into 1
- Extract generic batch MERGE helper for Neo4j writes
- Merge candidateAuth + participantAuth

**Week 5–6: Type safety**
- Zod schemas for all JSON columns (start with `candidate_ingestion` JSON blobs)
- Centralize `parseJsonColumn`
- Extract inline SQL types

**Week 7+: God file surgery**
- Split `rpc.ts` into `routes/rpc/` directory
- Split `review.ts`, `scheduling.ts`, `candidates.ts` one per sprint

---

*See the main [Technical Debt Index](../index.md) for the original P0–P3 problem tracker.*
