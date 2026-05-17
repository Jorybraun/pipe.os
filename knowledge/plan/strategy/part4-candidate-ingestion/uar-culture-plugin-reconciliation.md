# UAR Culture Plugin Reconciliation — Stub Fix and Migration Path

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 372–383)
**Phase:** 3
**Status:** LINKED-ONLY (partially — Subagent I covers the stub fix; the migration path is new)

## Phase0 overlap
Subagent I in `phase0-subagent-execution-plan.md` covers: delete orphaned evaluator files + **fix `culture/plugin.ts` stub dimensions to match live `cultureScorer.ts`**. That is the immediate hygiene work.

This plan covers the **forward migration path** that the strategy specifies beyond the stub fix.

## Source quote
> Second, when the UAR culture plugin transitions from mock stub to real implementation, it should ideally build fresh on UAR rather than migrating from the bespoke `cultureAgent.ts`. A fresh UAR implementation can coexist with the legacy path, run dual-path for parity checking, and cut over only when parity is validated.
>
> The screener Mode 1 (role-agnostic profile builder) is a cleaner candidate for the first real UAR implementation of the culture plugin — it's new functionality that the legacy path doesn't provide, so there's no parity-checking risk.

## Why
The existing `culture/plugin.ts` stub will mislead anyone wiring UAR to production. Subagent I fixes the dimensions. This plan records the forward architecture decision so future implementers don't inadvertently migrate the legacy path before Mode-1 UAR is validated, which would create parity-checking risk on a production-critical flow.

## Subtasks (delegable)

### Subtask 1 — [LINKED] Fix culture plugin stub dimensions
**Phase0 reference:** `phase0-subagent-execution-plan.md` — Subagent I

Files touched: `workers/api/src/lib/agents/culture/plugin.ts`

Replace stub dimensions (`adaptability`, `clan_affinity`, etc.) with the live 10 dimensions: ownership, collaboration, learning-orientation, conflict-handling, self-awareness (competency) + autonomy, risk-tolerance, work-pace, collaboration-style, feedback-orientation (profile).

**Status:** ⏳ PENDING (belongs to Subagent I in Phase 0)

---

### Subtask 2 — ADR: UAR culture plugin migration strategy
**Files:**
- `docs/decisions/current/ADR-XXX-uar-culture-plugin-migration.md`

**Spec:**
Write ADR documenting the migration sequencing: (1) Mode-1 profile builder built fresh on UAR. (2) Mode-1 runs dual-path against legacy bespoke screener (once legacy Mode-1 exists) for parity checking. (3) Mode-2 (legacy production culture interview) migrates to UAR only after Mode-1 parity is validated. (4) Legacy `cultureAgent.ts` bespoke path retained until Mode-2 UAR parity confirmed. Decision: Mode-1 on UAR first is the risk-minimizing sequencing because it's new functionality with no legacy-compatibility constraint. Status: PROPOSED.

**Status:** ⏳ PENDING

---

### Subtask 3 — Mode-1 UAR plugin skeleton
**Files:**
- `workers/api/src/lib/agents/culture/plugin.ts`

**Spec:**
After Subtask 1 fixes dimensions: extend `plugin.ts` to scaffold the Mode-1 interface. Add `ProfileBuilderPlugin` as a stub alongside the existing `CulturePlugin`. `ProfileBuilderPlugin` interface: `{ selectProbe(coverage: CoverageResult): Promise<Probe | null>, decomposeAnswer(answer: string, probe: Probe): Promise<CandidateNode[]>, computeCoverage(candidateId: string): Promise<CoverageResult> }`. All methods throw `NotImplementedError` in the stub. The interface definition creates the contract that the Mode-1 UAR build (Phase 3) implements against. No behavior change — stub only.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: Phase0 Subagent I (stub fix is prerequisite)
- Depends on: `screener-mode-generalization.md` (defines ScreenerConfig and modes)
- Blocks: Mode-1 UAR implementation (Phase 3+ work not fully specified here)

## Acceptance criteria
- [ ] `culture/plugin.ts` has correct 10 live dimensions (via Subagent I)
- [ ] ADR written and in `docs/decisions/current/`
- [ ] `ProfileBuilderPlugin` interface compiles and all methods throw `NotImplementedError`
- [ ] No existing culture interview behavior changed
- [ ] `npx tsc --noEmit` clean
