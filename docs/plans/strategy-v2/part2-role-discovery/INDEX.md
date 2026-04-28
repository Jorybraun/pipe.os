# Part 2 — Role Discovery: Plan Index

**Source:** knowledge/plan/pipe-strategy-v2-part2-role-discovery.md  
**Generated:** 2026-04-25  
**Updated:** 2026-04-28 — UAR migration superseded by state machine refactor  
**Dedup reference:** [docs/plans/phase0-subagent-execution-plan.md](../../phase0-subagent-execution-plan.md)

---

## ⚠️ Architectural Decision (2026-04-28)

**The UAR migration path for role discovery is superseded.**

The monolithic `callRoleAgent` (677 lines) has been replaced by a state machine + generator architecture:
- `lib/agents/interview/reducer.ts` — pure state machine, no LLM
- `lib/agents/question/generator.ts` — stateless question generation
- `lib/agents/synthesis/generator.ts` — stateless synthesis

**Rationale:** The UAR runtime was built but never adopted. The role agent predates it and has capabilities (deterministic 8-probe sequencing, direct knowledge-state mutation, phase-directed prompting) that don't map cleanly to UAR's turn-based FSM. Rather than force-fit, we split the agent into composable pure functions.

**Consequence:** All `phase4-uar-*` plans below are **deprecated**. Do not implement. The canonical role discovery architecture is documented in:
- `knowledge/plan/role-discovery-state-machine.md` (design spec)
- `docs/handoffs/2026-04-28-role-discovery-state-machine-handoff.md` (implementation status)

---

## Quick summary

| File | Phase | Status | Estimate | Subtasks |
|---|---|---|---|---|
| [link-phase0-autostagebuilder-rcd-cutover.md](./link-phase0-autostagebuilder-rcd-cutover.md) | 0 | LINKED-ONLY (✅ DONE) | — | — |
| [link-phase0-role-index-cutover.md](./link-phase0-role-index-cutover.md) | 0 | LINKED-ONLY (✅ DONE) | — | — |
| [link-phase0-delete-evaluator-files.md](./link-phase0-delete-evaluator-files.md) | 0 | LINKED-ONLY (⏳ PENDING) | — | — |
| [phase0-repodiscovery-rcd-cutover.md](./phase0-repodiscovery-rcd-cutover.md) | 0 | PENDING | 0.5 wk | 1 |
| [phase0-cockpit-rcd-cutover.md](./phase0-cockpit-rcd-cutover.md) | 0 | PENDING | 0.5 wk | 1 |
| [phase0-scorer-bars-anchor-audit.md](./phase0-scorer-bars-anchor-audit.md) | 0 | NEEDS-REFINEMENT | unclear | 0 |
| [phase0-dealbreaker-gate-enforcement.md](./phase0-dealbreaker-gate-enforcement.md) | 0 | PENDING → redirect | — | → canonical at part5-matching-migration/dealbreaker-gate-enforcement.md |
| [phase2-role-nodes-migration.md](./phase2-role-nodes-migration.md) | 2 | PENDING | 0.5 wk | 1 |
| [phase2-rcd-decomposition.md](./phase2-rcd-decomposition.md) | 2 | PENDING | 2 wk | 3 |
| [phase2-role-nodes-backfill.md](./phase2-role-nodes-backfill.md) | 2 | PENDING | 0.5 wk | 1 |
| [phase4-uar-shared-infra.md](./phase4-uar-shared-infra.md) | 4 | **🚫 DEPRECATED** | — | — |
| [phase4-uar-plugin-port.md](./phase4-uar-plugin-port.md) | 4 | **🚫 DEPRECATED** | — | — |
| [phase4-uar-synthesis-hook.md](./phase4-uar-synthesis-hook.md) | 4 | **🚫 DEPRECATED** | — | — |
| [phase4-uar-parity-and-cutover.md](./phase4-uar-parity-and-cutover.md) | 4 | **🚫 DEPRECATED** | — | — |
| **[role-discovery-state-machine.md](../../../../knowledge/plan/role-discovery-state-machine.md)** | 4 | **✅ IN PROGRESS** | 1 wk | Steps 1–5 done, 6–7 pending |

**Total new subtasks across actionable plans:** 8  
**Needs-refinement (blocked on decision):** 1  
**Linked-only (deduplicated to phase0 plan):** 3  
**Deprecated (superseded by state machine):** 4

---

## Dependency graph

```
Phase 0 (parallel batch — no file conflicts between these):
  phase0-repodiscovery-rcd-cutover        (discover.ts only)
  phase0-cockpit-rcd-cutover              (agent.ts, repoDiscovery.ts only)
  phase0-scorer-bars-anchor-audit         ← NEEDS-REFINEMENT, decision required
  phase0-dealbreaker-gate-enforcement     ← run AFTER phase0 Subagent G (triangulateMatch.ts conflict)

Phase 2 (serial within phase):
  phase2-role-nodes-migration
    ↓
  phase2-rcd-decomposition
    ↓
  phase2-role-nodes-backfill

Phase 4 (serial within phase):
  phase4-uar-shared-infra          ← NEEDS-REFINEMENT
    ↓
  phase4-uar-plugin-port
    ↓
  phase4-uar-synthesis-hook        ← also depends on phase2-rcd-decomposition
    ↓
  phase4-uar-parity-and-cutover
```

---

## File conflict notes

- `routes/discovery/roleContexts.ts` was modified in phase0 Subagent F. Phase 4 route swap modifies it again — serial across phases, no conflict.
- `lib/roleAgent/synthesizeRcd.ts` is touched in Phase 2 (add decomposition hook) and Phase 4 (synthesis moves into UAR post-FSM). Phase 4 owns the relocation; Phase 2 should add the hook minimally without restructuring exports.
- `workers/api/src/lib/match/triangulateMatch.ts` is touched by phase0 Subagent G (vector signals) and phase0 dealbreaker gate. Run dealbreaker gate plan after Subagent G to avoid conflict.

---

## Items not planned (out of scope for Part 2)

- **Per-requirement matching layer** — explicitly deferred to Part 5 (strategy line 143: "Details live in Part 5")
- **Phase 5 graph migration** — `role_nodes` → Neo4j `:RoleNode` nodes (strategy lines 225–227)
- **Recruiter training / product guardrails** — strategic framing in "honest caveats" section, not a work request
- **Golden-set measurement / A/B match quality** — called for in caveats but no concrete work items specified; candidate for a future Part 5 plan
- **`matchReposForCandidate` cutover to sub-elements** (strategy line 217) — the Part 2 source asks for an update so matching reads `role_nodes` instead of flat RCD text. The cutover spans Part 2 (consumer call sites) and Part 5 (per-requirement match scoring). Canonical home: [`../part5-matching-migration/per-requirement-match-pipeline.md`](../part5-matching-migration/per-requirement-match-pipeline.md). Once `phase2-role-nodes-backfill.md` lands, Part 5's per-requirement pipeline switches the read path; no separate Part 2 plan required.

---

## Ambiguous items flagged

1. **phase0-scorer-bars-anchor-audit.md** — strategy observation vs. Phase 0 work item is unclear. Full anchor text consumption is Part 5; Phase 0 numeric-scalar partial cutover may already be complete. Needs Option A/B decision before any implementation.

2. **phase4-uar-shared-infra.md** — `agent_sessions` migration number not resolvable at plan time (depends on Phase 0/2 migration count). `synthesis_json` column vs. `score_report` reuse needs UAR type owner decision.
