# Living Graph — Supersedes Logic and Audit Queries

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md (lines 85–94, 295–315)
**Phase:** 1
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote
> Every sub-element carries four metadata fields... `supersedes` — pointer to a prior sub-element that this one replaces. If a candidate's screening reveals their resume was inaccurate about a role's scope, the new Experience node supersedes the old one. Old one isn't deleted; it's marked superseded for audit.
>
> The candidate's profile at any moment is the aggregation of non-superseded sub-elements with recency weighting. Old sub-elements stay queryable for audit purposes and for detecting drift over time.

## Why
The supersedes mechanism is the integrity backbone of the living graph. Without it, updating a candidate's profile silently overwrites history and breaks the temporal reconstruction guarantee. This is also the legal audit trail for hiring decisions — superseded nodes must stay queryable to answer "what did we know about this candidate on date X?"

## Subtasks (delegable)

### Subtask 1 — Supersedes transaction helper (already started in candidate-nodes-schema)
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`

**Spec:**
Ensure `supersedeCandidateNode` runs atomically via D1 transaction: BEGIN → UPDATE old node SET `superseded_at=now()` → UPDATE new node SET `supersedes=old_id` → COMMIT. If either update affects 0 rows, ROLLBACK and throw. Export a `getSupersessionChain(db, nodeId): Promise<CandidateNode[]>` that walks the `supersedes` chain upward (oldest → newest) for audit display. Max chain depth guard: 50 hops, throw if exceeded (indicates a cycle bug).

**Status:** ⏳ PENDING

---

### Subtask 2 — Profile-at-point-in-time query
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`

**Spec:**
Export `getCandidateNodesAtTime(db, candidateId, asOf: number): Promise<CandidateNode[]>`. Returns nodes where `created_at <= asOf AND (superseded_at IS NULL OR superseded_at > asOf)`. This enables "what did we know on date X" queries for recruiter audit and for debugging match quality regression. Parameterized query only — no string interpolation.

**Status:** ⏳ PENDING

---

### Subtask 3 — Drift detection: compare two time snapshots
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`

**Spec:**
Export `getCandidateProfileDrift(db, candidateId, fromTime: number, toTime: number): Promise<{ added: CandidateNode[], superseded: CandidateNode[] }>`. Returns nodes added after `fromTime` and nodes that were superseded between `fromTime` and `toTime`. Used by re-engagement logic to decide whether a profile has changed enough to warrant re-matching.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md` (schema and base CRUD)
- Blocks: `living-graph-temporal-queries.md`, `screener-coverage-computation.md`

## Acceptance criteria
- [ ] `supersedeCandidateNode` is atomic — simulated mid-transaction failure leaves both nodes in prior state
- [ ] `getSupersessionChain` returns full chain in chronological order for a 3-hop chain
- [ ] `getCandidateNodesAtTime` returns correct snapshot compared to present state
- [ ] `getCandidateProfileDrift` identifies added and superseded nodes across a time window
- [ ] Cycle guard throws on a manually constructed circular `supersedes` reference
- [ ] `npx tsc --noEmit` clean
