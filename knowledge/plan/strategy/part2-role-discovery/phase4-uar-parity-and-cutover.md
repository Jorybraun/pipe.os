# Phase 4 — UAR Route Swap, Parity Harness, and Legacy Deletion

**Source:** knowledge/plan/pipe-strategy-v2-part2-role-discovery.md (lines 181–191, 221–222)  
**Phase:** 4  
**Status:** PENDING  
**Estimate:** 2 weeks

## Source quote

> Fifth, swap the route. The legacy route at `routes/discovery/roleContexts.ts` delegates to UAR instead of calling `callRoleAgent` directly. This happens behind a feature flag so production traffic can be incrementally migrated. Once the UAR path is handling 100% of traffic and producing RCDs of equal or better quality (measured against a held-out set of RCDs generated both ways), the legacy `lib/roleAgent.ts` can be deleted.

> The mitigation: dual-run both paths against the same inputs for at least 30 real discovery sessions, compare RCDs for domain coverage, laddering depth, conflict detection, and dealbreaker extraction, and only cut over when parity is established. This is a slow migration by design.

## Why

The UAR plugin port and synthesis hook are only useful if production traffic actually flows through them. The route swap is the last step in the migration. The dual-run parity requirement (30 sessions, quality comparison) is explicitly called for in the strategy and is the primary risk mitigation against regressing RCD quality.

## Subtasks (delegable)

### Subtask 1 — Feature flag and dual-path dispatch in roleContexts.ts

**Files:**
- `workers/api/src/routes/discovery/roleContexts.ts`

**Spec:**  
In the `POST /api/v1/role-contexts/:id/respond` handler, add a feature flag check. Read a flag from `env` (e.g., `env.UAR_ROLE_DISCOVERY_ENABLED`, a boolean env var or a D1 feature flag row). When the flag is true, dispatch to the UAR runtime instead of calling `callRoleAgent`. When false, keep the existing legacy path.

For dual-run period, implement side-by-side execution: run both paths, write the UAR result to a shadow column (or log it for comparison), and return the legacy result to the client. This is the safest dual-run pattern — no client impact, but real UAR output is captured for comparison.

Do not change the route's public API shape. The response format must be identical whether the legacy or UAR path is active.

**Status:** ⏳ PENDING

### Subtask 2 — Parity comparison harness

**Files:**
- `scripts/compareRcdParity.ts` (new)

**Spec:**  
CLI script: `npx tsx scripts/compareRcdParity.ts --role-context-id=<id>`.

Given a role context ID, the script:
1. Reads the RCD produced by the legacy path from `role_contexts.rcd_json`.
2. Re-runs synthesis using the UAR plugin's `generateTurn` against the stored transcript.
3. Compares the two RCDs on four dimensions:
   - **Domain coverage**: count of `domain_matrix` cells with `coverage >= 'partial'`
   - **Laddering depth**: total laddering chain count across all cells
   - **Conflict detection**: count of `conflicts` in each RCD
   - **Dealbreaker extraction**: count of `dealbreakers` in each RCD
4. Prints a diff table. Flags any dimension where UAR output is >10% worse than legacy.

Run against a held-out set of 30 real role contexts before cutting over. Store comparison results in `docs/ops/uar-parity-results/` (one JSON file per run, not tracked in git).

**Status:** ⏳ PENDING

### Subtask 3 — Delete legacy roleAgent.ts after parity established

**Files:**
- `workers/api/src/lib/roleAgent.ts` **DELETE** (conditional on parity gate)

**Spec:**  
After the parity harness confirms UAR output matches or exceeds legacy on ≥30 sessions, delete `lib/roleAgent.ts`. Update all imports — there should be none remaining at this point since the route and plugin were already switched over. Run `npx tsc --noEmit` to confirm no dangling imports. Update `CHANGELOG.md`.

This subtask is explicitly conditional on parity being established — do not delete until the harness results are reviewed and approved.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `phase4-uar-plugin-port.md`
- Depends on: `phase4-uar-synthesis-hook.md`
- Depends on: `phase4-uar-shared-infra.md` (D1SessionStore for session persistence in UAR path)
- Blocks: Nothing — this is the terminal Phase 4 step for role discovery

## Acceptance criteria

- [ ] Feature flag in `roleContexts.ts` routes to UAR when enabled
- [ ] Dual-run shadow mode captures UAR output without affecting legacy response
- [ ] Parity harness runs cleanly against local D1 with fixture data
- [ ] ≥30 real sessions compared; UAR scores within 10% of legacy on all 4 dimensions
- [ ] After parity gate: `lib/roleAgent.ts` deleted, `npx tsc --noEmit` passes
- [ ] `CHANGELOG.md` updated at each step
