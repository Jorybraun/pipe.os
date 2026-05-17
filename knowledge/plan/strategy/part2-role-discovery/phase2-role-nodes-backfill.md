# Phase 2 — Backfill Existing RCDs into role_nodes

**Source:** knowledge/plan/pipe-strategy-v2-part2-role-discovery.md (lines 215–216)  
**Phase:** 2  
**Status:** PENDING  
**Estimate:** 0.5 weeks

## Source quote

> Backfill existing role contexts. All live RCDs get decomposed into sub-element rows. The RCD itself is not modified; sub-elements are a derivative view. Existing consumers keep reading `rcd_json` directly until they cut over to reading sub-elements.

## Why

New `role_nodes` rows are produced automatically at synthesis time (after `phase2-rcd-decomposition.md` lands). Existing role contexts won't have any `role_nodes` rows until they're backfilled. Without the backfill, the per-requirement matching in Part 5 has sparse coverage for historical roles, and the rollout metrics can't be verified against real data.

## Subtasks (delegable)

### Subtask 1 — Implement backfill script for role_nodes

**Files:**
- `scripts/backfillRoleNodes.ts` (new)

**Spec:**  
CLI script runnable as `npx tsx scripts/backfillRoleNodes.ts [--dry-run] [--batch=50] [--role-context-id=<id>]`.

Logic:
1. Query all `role_contexts` rows where `status = 'COMPLETE'` and `rcd_json IS NOT NULL`.
2. For each row, check if `role_nodes` has any active (non-superseded) rows for that `role_context_id`. Skip if already backfilled (idempotent).
3. Parse `rcd_json`, call `decomposeRcdIntoNodes(rcd, roleContextId)`.
4. Call `persistRoleNodes(nodes, env, db)`.
5. Log per-row result: `{ roleContextId, nodeCount, skipped, error }`.

`--dry-run` parses and decomposes but does not write to D1 or Vectorize. `--batch` controls how many role contexts are processed per run (default 50, to stay under Vectorize rate limits). `--role-context-id` processes a single role context for targeted debugging.

On completion, print a summary: total roles processed, total nodes written, skipped (already backfilled), errors.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `phase2-role-nodes-migration.md` (table must exist)
- Depends on: `phase2-rcd-decomposition.md` (`decomposeRcdIntoNodes` + `persistRoleNodes` must be importable)
- Blocks: Nothing downstream directly, but Part 5 matching quality measurement requires this to be run in production before A/B testing can begin

## Acceptance criteria

- [ ] Script exists at `scripts/backfillRoleNodes.ts`
- [ ] Idempotent: running twice on the same role context produces no duplicate `role_nodes` rows
- [ ] `--dry-run` flag works without writing
- [ ] Per-row structured log output
- [ ] Summary count printed at completion
- [ ] `npx tsc --noEmit` passes on the script
- [ ] Tested against local D1 with a fixture role context before production run
