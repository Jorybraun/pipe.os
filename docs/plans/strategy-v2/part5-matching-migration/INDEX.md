# Part 5: Matching Architecture and Infrastructure Migration — Plan Index

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md  
**Generated:** 2026-04-25  
**Total plan files:** 21 (19 full plans + 2 linked-only entries)  
**Total subtasks:** 55

---

## Phase 0 — Items covered by existing phase0 plan (LINKED-ONLY)

These items are already fully specified in `docs/plans/phase0-subagent-execution-plan.md`. No duplication.

| Item | Phase0 Entry | Notes |
|---|---|---|
| Wire vector signals in `triangulateMatch` (`vectorRoleRepo`, `vectorRoleCandidate`, `vectorCandidateRepo`) | Subagent G (Batch 3) | Populates `VECTOR_WEIGHTS` preset — prerequisite for `triangulation-summary-layer.md` |
| `match_feedback` schema columns (`vector_role_repo`, `vector_cand_repo`, `vector_role_cand`) + silent `skill.toLowerCase()` fallback fix | Subagent H (Batch 3) | Initial fallback fix only; full adjacency rewrite is in `skill-adjacency-table.md` Subtask 3 |

---

## Phase 0 — New work (not in phase0 plan)

These complete Phase 0 per the [ACTIVE] master list in the strategy.

| File | Subtasks | Est. | Status |
|---|---|---|---|
| [`dealbreaker-gate-enforcement.md`](dealbreaker-gate-enforcement.md) | 2 | 0.5w | PENDING |
| [`skill-adjacency-table.md`](skill-adjacency-table.md) | 3 | 1w | PENDING |
| [`reliability-retry-and-error-classification.md`](reliability-retry-and-error-classification.md) | 2 | 0.5w | PENDING |
| [`reliability-circuit-breakers.md`](reliability-circuit-breakers.md) | 3 | 1w | NEEDS-REFINEMENT |
| [`reliability-idempotency-and-partial-materialization.md`](reliability-idempotency-and-partial-materialization.md) | 3 | 1w | PENDING |
| [`reliability-heartbeats-and-stale-detection.md`](reliability-heartbeats-and-stale-detection.md) | 2 | 0.5w | PENDING |
| [`reliability-dead-letter-queue.md`](reliability-dead-letter-queue.md) | 3 | 1w | PENDING |
| [`observability-opentelemetry.md`](observability-opentelemetry.md) | 3 | 1.5w | NEEDS-REFINEMENT |
| [`observability-recruiter-status.md`](observability-recruiter-status.md) | 3 | 1w | PENDING |

**Phase 0 subtotal:** 24 subtasks

---

## Phase 1 — Per-element matching and match reports

Depends on Phase 0 completion + Phase 1 candidate decomposition (Part 4).

| File | Subtasks | Est. | Status |
|---|---|---|---|
| [`per-element-matching-algorithm.md`](per-element-matching-algorithm.md) | 4 | 2w | PENDING |
| [`match-reports-schema.md`](match-reports-schema.md) | 3 | 1w | PENDING |
| [`triangulation-summary-layer.md`](triangulation-summary-layer.md) | 2 | 0.5w | PENDING |

**Phase 1 subtotal:** 9 subtasks

---

## Phase 2 — Neo4j migration (months 4–6)

Depends on Phase 0 + Phase 1 validated. Execute in sequence within the phase.

| File | Subtasks | Est. | Migration Phase | Status |
|---|---|---|---|---|
| [`neo4j-vps-provisioning.md`](neo4j-vps-provisioning.md) | 3 | 1w | Phase A (setup) | PENDING |
| [`neo4j-driver-and-binding.md`](neo4j-driver-and-binding.md) | 2 | 0.5w | Phase A | PENDING |
| [`neo4j-schema-and-constraints.md`](neo4j-schema-and-constraints.md) | 4 | 0.5w | Phase A | PENDING |
| [`neo4j-dual-write-ingestion.md`](neo4j-dual-write-ingestion.md) | 4 | 2w | Phase B (wks 3–6) | PENDING |
| [`neo4j-validation-parity.md`](neo4j-validation-parity.md) | 3 | 1w | Phase B–C | PENDING |
| [`neo4j-matching-cutover.md`](neo4j-matching-cutover.md) | 3 | 3w | Phase C–D (wks 7–12) | PENDING |

**Phase 2 subtotal:** 19 subtasks

---

## Phase 3 — Retirement (month 10+)

Gated behind 6-month stability window post-cutover.

| File | Subtasks | Est. | Status |
|---|---|---|---|
| [`neo4j-retirement-plan.md`](neo4j-retirement-plan.md) | 3 | 0.5w | PENDING (deferred) |

**Phase 3 subtotal:** 3 subtasks (Subtask 3 intentionally deferred)

---

## Dependency graph

```
Phase 0:
  reliability-retry → reliability-circuit-breakers → reliability-dead-letter-queue
  reliability-idempotency → reliability-heartbeats → reliability-dead-letter-queue
  skill-adjacency (Subtask 2 coordinates with phase0 Subagent H)
  dealbreaker-gate-enforcement → per-element-matching-algorithm (Phase 1)
  observability-opentelemetry (Subtask 3 needs matchOrchestrator from Phase 1)

Phase 1:
  per-element-matching-algorithm → match-reports-schema → triangulation-summary-layer
  phase0/Subagent G → triangulation-summary-layer

Phase 2:
  neo4j-vps-provisioning → neo4j-driver-and-binding → neo4j-schema-and-constraints
    → neo4j-dual-write-ingestion → neo4j-validation-parity
    → neo4j-matching-cutover → neo4j-retirement-plan

  per-element-matching-algorithm (Phase 1) → neo4j-matching-cutover (Cypher replaces it)
```

---

## Migration numbers (next available)

- Last migration in phase0 plan: `0044_situation_fit_cache.sql`
- Next: `0045` through `0054` allocated in this plan (10 migrations)
- Confirm no gaps before executing any migration subtask

---

## Ambiguous items flagged

1. **`reliability-circuit-breakers.md`** — `NEEDS-REFINEMENT`: `opossum` library compatibility with Cloudflare Workers unverified. Must spike before committing. Fallback: custom D1-state circuit breaker (fully specified as fallback in the plan).

2. **`observability-opentelemetry.md`** — `NEEDS-REFINEMENT`: OTLP destination (Grafana Cloud / Axiom / Honeycomb) not chosen. Pick before implementing; auth config differs. Also verify `@microlabs/otel-cf-workers` Workers runtime compatibility.

3. **`skill-adjacency-table.md` Subtask 3** — overlaps with phase0 Subagent H (silent fallback fix). Coordinate: if Subagent H covers it, mark Subtask 3 as LINKED and skip. If Subagent H only does the migration and this plan covers the code change, split cleanly.

4. **`triangulation-summary-layer.md` Subtask 2** — migration number `0046` allocated, but depends on knowing what number `match_feedback` table currently exists at. Confirm via `workers/api/migrations/` listing before writing migration file.

5. **Per-element matching and Neo4j Cypher** — the `per-element-matching-algorithm.md` builds the D1/Vectorize version of per-element matching; `neo4j-matching-cutover.md` replaces it with Cypher. Both need to be maintained during the dual-write / shadow-read window. Design the D1 version interfaces to match the Neo4j Cypher output shape exactly to simplify the cutover.

---

## Items NOT in this plan (master list cross-check)

The following [ACTIVE] items from the master list are covered by **other Part plans**, not Part 5:

- Candidate decomposition (candidate_nodes table, sub-element embeddings) — Part 4 plan
- UAR Phase 2–5 migration — Part 2/4 plans
- Public data enrichment pipeline — Part 4 plan
- Automated screener Mode 1 — Part 4 plan
- Issue body pre-fetch for implementation challenges — Part 3 plan
- Build implementation challenge scorer (Sherlock-based) — Part 3/4 plans
- Assess scoring write-back to candidate graph — Part 4 plan

All [DEFERRED] and [PARK] items are out of scope for plan files per strategy intent.
