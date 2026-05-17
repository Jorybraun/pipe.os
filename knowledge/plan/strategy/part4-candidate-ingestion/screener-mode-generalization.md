# Screener Mode Generalization — Mode-Aware `cultureAgent.ts`

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 140–198)
**Phase:** 3
**Status:** PENDING
**Estimate:** 3 weeks

## Source quote
> The screener is a generalization of that infrastructure to support role-agnostic profile building in addition to its existing role-specific culture fit mode. Same underlying infrastructure for both modes — same `cultureAgent.ts` core, same FSM, same scorer, same compliance audit. Configuration flag `screener_mode: 'profile_builder' | 'role_fit'` determines which probe bank, which BARS anchor set, whether RCD overlay applies, and whether HITL gating is required.

## Why
The screener is described as "the most important underbuilt piece of the whole platform." Mode 1 (profile builder) enables the turn from resume-as-seed to growing-graph. Without generalizing `cultureAgent.ts`, Mode 1 requires a separate parallel implementation that duplicates FSM and session logic and creates maintenance drift. The generalization approach shares production-proven infrastructure while extending it.

## Subtasks (delegable)

### Subtask 1 — `ScreenerConfig` type and mode detection
**Files:**
- `workers/api/src/lib/cultureAgent.ts` (no separate types.ts — types live alongside the agent)

**Spec:**
Export `ScreenerMode = 'profile_builder' | 'role_fit'`. Export `ScreenerConfig` interface: `{ mode: ScreenerMode, roleContextId?: string, rcdJson?: unknown, probeBank: 'profile_probe_bank' | 'role_probe_bank', barsAnchors: 'generic' | 'rcd_calibrated', hitlGated: boolean, maxTurns: number, minTurns: number, coverageThreshold: number }`. Export `buildScreenerConfig(mode: ScreenerMode, roleContextId?: string): ScreenerConfig` — for `profile_builder`: probeBank=profile, barsAnchors=generic, hitlGated=false, maxTurns=20, minTurns=8. For `role_fit`: probeBank=role, barsAnchors=rcd_calibrated, hitlGated=true, maxTurns=20, minTurns=8 (matches current production). No `any`.

**Status:** ⏳ PENDING

---

### Subtask 2 — Generalize probe selection in `cultureAgent.ts`
**Files:**
- `workers/api/src/lib/cultureAgent.ts`

**Spec:**
Current agent reads from `role_probe_bank` hardcoded. Refactor probe selection into `selectNextProbe(db, session, config: ScreenerConfig): Promise<Probe | null>`. When `config.probeBank === 'profile_probe_bank'`: query `profile_probe_bank` WHERE `dimension = next_probe_target` (from `candidate_coverage`) AND id NOT IN already-asked probes. When `config.probeBank === 'role_probe_bank'`: existing behavior unchanged. Existing callers pass `buildScreenerConfig('role_fit', roleContextId)` — no behavioral change on the role-fit path. FSM state machine unchanged.

**Status:** ⏳ PENDING

---

### Subtask 3 — Mode-1 termination conditions
**Files:**
- `workers/api/src/lib/cultureAgent.ts`

**Spec:**
Add `coverage_complete` termination trigger for `profile_builder` mode: after each turn, call `computeCandidateCoverage(db, candidateId)` (see `screener-coverage-computation.md`). If all 5 dimensions >= `config.coverageThreshold` AND turn count >= `config.minTurns`, set termination reason `coverage_complete`. Existing termination conditions (`budget_exhausted`, `bank_exhausted`, `candidate_disengaged`) carry over unchanged. For `role_fit` mode, coverage_complete does not trigger (role-fit uses its own scoring-based completion logic).

**Status:** ⏳ PENDING

---

### Subtask 4 — Mode-2 skip already-covered dimensions
**Files:**
- `workers/api/src/lib/cultureAgent.ts`

**Spec:**
At Mode-2 session start, fetch the candidate's existing CulturalSignal nodes from `candidate_nodes` (source_type IN ('automated_screener', 'behavioural_interview')). Build `alreadyCoveredDimensions` from nodes with confidence >= 0.7. Inject into the Mode-2 system prompt: "Skip probes for these dimensions, candidate has adequate coverage from prior screening: [list]. Focus on: [thin dimensions]." This is the anti-double-interview-fatigue mechanism from strategy lines 199–201. Log dimensions skipped.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `profile-probe-bank.md` (profile_probe_bank table must exist), `screener-coverage-computation.md`
- Depends on: `candidate-nodes-schema.md`
- Blocks: `screener-answer-decomposition.md`, `screener-recruiter-ui.md`

## Acceptance criteria
- [ ] `buildScreenerConfig('profile_builder')` returns correct defaults (hitlGated=false, probeBank='profile_probe_bank')
- [ ] `buildScreenerConfig('role_fit')` returns production-equivalent config — existing culture interview sessions produce identical outputs
- [ ] Mode-1 session terminates with `coverage_complete` when all 5 dimensions cross threshold
- [ ] Mode-2 session skips dimensions with existing high-confidence CulturalSignal nodes
- [ ] All existing culture interview unit tests pass (no regression)
- [ ] `npx tsc --noEmit` clean
