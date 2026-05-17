# Handoff: Neo4j Graph Migration

**Date:** 2026-05-11
**Status:** Plans written, ready for implementation
**Next step:** Phase A — Docker dev environment setup

---

## What Was Decided

Retire Vectorize/D1 from the matching path. Replace with Neo4j Community Edition (self-hosted). Matching becomes a single Cypher query instead of a 30-60s pipeline with LLM rerank.

**Why:** Vectorize cannot do relationships, structured querying, or dealbreaker logic. D1 cannot do vector math. The current architecture is a Rube Goldberg machine compensating for these limitations.

**Cost:** $0 (Docker dev) → ~$15/mo (Hetzner production) → ~$526/mo (AuraDB Pro, post-revenue)

---

## Files Created

### ADRs (architecture decisions)

| File | Decision |
|---|---|
| `docs/decisions/current/ADR-043-retire-vectorize-adopt-neo4j.md` | Retire Vectorize for matching, adopt Neo4j |
| `docs/decisions/current/ADR-044-candidate-ingestion-neo4j-dual-write.md` | Candidate ingestion writes graph nodes |
| `docs/decisions/current/ADR-045-repo-ingestion-neo4j-dual-write.md` | Repo ingestion writes graph nodes |
| `docs/decisions/current/ADR-046-role-discovery-neo4j-dual-write.md` | Role discovery writes graph nodes |
| `docs/decisions/current/ADR-047-per-element-cypher-matching.md` | Replace LLM rerank with Cypher matching |

### Knowledge plans (implementation specs)

| File | What |
|---|---|
| `knowledge/plan/strategy-v2/part5-matching-migration/UNIFIED-NEO4J-MIGRATION.md` | Master doc: data model, phases, dependencies, costs |
| `knowledge/plan/strategy-v2/part5-matching-migration/neo4j-docker-dev.md` | Docker Compose, migrations, seed data, verification |
| `knowledge/plan/strategy-v2/part4-candidate-ingestion/neo4j-candidate-dual-write.md` | Wire candidate ingestion to Neo4j |
| `knowledge/plan/strategy-v2/part3-repo-ingestion/neo4j-repo-dual-write.md` | Wire repo Pass 3 to Neo4j |
| `knowledge/plan/strategy-v2/part2-role-discovery/neo4j-role-dual-write.md` | Wire RCD synthesis to Neo4j |

---

## Migration Phases

| Phase | Duration | What | Cost | Start Condition |
|---|---|---|---|---|
| **A — Dev** | Now | Docker local, schema, Cypher validation | $0 | Run `docker compose up` |
| **B — Dual-write** | Weeks 1-4 | Ingestion writes to D1+Vectorize AND Neo4j | $0 | Schema validated |
| **C — Shadow-read** | Weeks 5-8 | Matching queries both stores, compare | ~$15/mo | Dual-write stable |
| **D — Primary-read** | Weeks 9-10 | Serve from Neo4j, D1 fallback | ~$15/mo | Shadow-read >90% overlap |
| **E — Retirement** | Month 4+ | Stop dual-write, Vectorize archive | ~$15/mo | Primary-read stable |
| **F — Scale** | Post-revenue | AuraDB Pro if justified | ~$526/mo | Revenue covers cost |

---

## Canonical Data Model

```cypher
(:Candidate {candidate_id})-[:HAS]->(:CandidateNode:Skill {id, embedding[1024]})
(:Role {role_context_id})-[:HAS_REQUIREMENT {weight: 1.0}]->(:RoleNode:Requirement {id, embedding[1024]})
(:Role)-[:HAS_DEALBREAKER {strength: 'strong'}]->(:RoleNode:Dealbreaker {id, embedding[1024]})
(:Repo {repo_id})-[:HAS]->(:RepoNode:Feature {id, embedding[1024]})
```

Vector indexes: 1024-dim, cosine similarity. Constraints: unique on all entity IDs.

---

## Immediate Next Steps

1. **Start Neo4j locally:**
   ```bash
   docker compose -f infra/neo4j/docker-compose.yml up -d
   ./infra/neo4j/run-migrations.sh bolt://localhost:7687 neo4j password infra/neo4j/migrations
   ```

2. **Verify driver in Workers:**
   - Install `neo4j-driver` in `workers/api`
   - Add `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` to `.dev.vars`
   - Test `GET /api/v1/internal/neo4j-health` returns 200

3. **Implement first dual-write:**
   - Pick candidate ingestion (simplest: nodes already exist)
   - Implement `writeCandidateGraph.ts`
   - Wire into `orchestrate.ts` behind `DUAL_WRITE_NEO4J` flag
   - Test with seed data

4. **Validate Cypher matching:**
   - Load test candidate + role + repo into local Neo4j
   - Run matching query from ADR-047
   - Verify <100ms, evidence returned, dealbreakers enforced

---

## Files to Patch (Not Yet Done)

These existing files need small patches to reference Neo4j, but their core logic is unchanged:

- `knowledge/plan/strategy-v2/part3-repo-ingestion/repo-decomposition-schema.md` — Add Neo4j persistence reference
- `knowledge/plan/strategy-v2/part2-role-discovery/phase2-rcd-decomposition.md` — Add Neo4j persistence reference
- `knowledge/plan/strategy-v2/part5-matching-migration/per-element-matching-algorithm.md` — Update to reference Cypher implementation
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts` — Add dual-write call
- `workers/api/scripts/crawl-repos/pass3/run.ts` — Add sub-element generation + dual-write
- `workers/api/src/lib/roleAgent/synthesizeRcd.ts` — Add dual-write call

---

## Risk Summary

| Risk | Mitigation |
|---|---|
| Neo4j driver fails in Workers | Spike in Phase A. Fallback to `neo4j-driver-lite`. |
| Query latency >100ms | Monitor in shadow-read. Scale VPS or optimize Cypher. |
| Dual-write drift >5% | Parity dashboard. Alert + investigate. |
| Embedding quality poor | Shadow-read validates against D1. Tune thresholds. |
| Self-hosted ops burden | Automated backups in `backup.sh`. UptimeRobot alerting. |

---

## Cost Comparison

| Approach | Monthly | Notes |
|---|---|---|
| Current (Vectorize + LLM rerank) | ~$5.55 + $0.02-0.04/candidate | 30-60s matching, opaque scores |
| Neo4j Docker dev | $0 | Local only |
| Neo4j Hetzner production | ~$15/mo | <100ms matching, explainable scores |
| Neo4j AuraDB Pro | ~$526/mo | Managed, post-revenue only |

Break-even: ~750 candidates/month at $0.02 LLM cost. At 10K candidates/month, savings are $200-400/mo.

---

## Questions for Next Session

1. Should I implement the Docker dev environment and run the first migration?
2. Should I start with candidate dual-write (simplest) or repo dual-write (most impactful)?
3. Do you want to see the Cypher matching query run against test data before proceeding?
