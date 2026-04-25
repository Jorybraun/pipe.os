# Culture Scorer — Re-prompt on Ungrounded Scores

**Source:** knowledge/plan/pipe-strategy-v2-part1-north-star.md (lines 118–119)
**Phase:** 0
**Status:** PENDING
**Estimate:** 1 week

## Source quote

> Re-prompt on ungrounded culture scores (ADR-029 §6) — empty `evidenceQuotes: []` is silently accepted.

## Why

ADR-029 §6 specifies that ungrounded scores (those with empty `evidenceQuotes`) should trigger a re-prompt. The current `cultureScorer.ts` silently accepts them, meaning scores can land in the system without any evidence backing. This undermines the auditable-match commitment and the compliance audit trail — ungrounded scores attached to the 13-event audit trail have no traceable basis.

## Subtasks (delegable)

### Subtask 1 — Add ungrounded-score detection and re-prompt logic to `cultureScorer.ts`

**Files:**
- `workers/api/src/lib/agents/culture/cultureScorer.ts`

**Spec:**
- After each of the 11 scoring calls (5 competency + 5 profile + synthesis), inspect the returned `evidenceQuotes` array.
- If `evidenceQuotes` is empty or undefined for a dimension that received a non-neutral score (i.e., score != 0 or score is outside the [-1, 1] neutral band, per whichever scale the scorer uses), issue one re-prompt:
  - Re-prompt message: `"Your previous score for [dimension] had no evidence quotes. Please re-score with at least one direct quote from the interview transcript supporting your rating."`
  - Maximum 1 re-prompt per dimension (do not loop indefinitely).
- If after the re-prompt `evidenceQuotes` is still empty, accept the score but apply the `-0.3 confidence penalty` already specified in the UAR end-of-session scoring spec (ADR-034). Log: `console.warn('[cultureScorer] ungrounded score accepted after re-prompt:', { dimension, score, candidateId })`.
- If `evidenceQuotes` is populated on first try, no re-prompt — existing path unchanged.
- Add a `repromptCount: number` field to the scorer result shape (0 or 1 per dimension), so the compliance audit trail can record how many re-prompts occurred.

**Status:** PENDING

---

### Subtask 2 — Persist re-prompt telemetry to compliance audit trail

**Files:**
- `workers/api/src/lib/agents/culture/cultureComplianceAudit.ts` (or the file that writes to `culture_compliance_audit`)
- `workers/api/src/lib/agents/culture/cultureScorer.ts`

**Spec:**
- Add a new event type to the 13-event `culture_compliance_audit` schema: `SCORER_REPROMPT`. The event payload: `{ dimension: string; originalScore: number; repromptScore: number | null; finalGrounded: boolean }`.
- After each re-prompt (regardless of whether it succeeded in producing evidence), emit a `SCORER_REPROMPT` audit event.
- Unit test: mock a scorer call returning `evidenceQuotes: []` → assert re-prompt is issued, `SCORER_REPROMPT` event emitted, `-0.3` confidence penalty applied to the stored score when re-prompt also returns empty.
- Unit test: mock scorer returning `evidenceQuotes: ['...']` on first try → assert no re-prompt, no audit event, no confidence penalty.
- `npx tsc --noEmit` must pass.

**Status:** PENDING

## Dependencies

- Depends on: nothing in Phase 0 (standalone culture scorer change)
- Blocks: Phase 4 UAR migration of culture interview (the UAR culture plugin should inherit this behavior when it replaces the bespoke path)

## Acceptance criteria

- [ ] Ungrounded scores (empty `evidenceQuotes`) trigger exactly one re-prompt per dimension
- [ ] Scores still ungrounded after re-prompt receive a `-0.3` confidence penalty
- [ ] All re-prompts are logged as structured `SCORER_REPROMPT` events in `culture_compliance_audit`
- [ ] Grounded scores (non-empty `evidenceQuotes`) are unaffected — no re-prompt, no penalty
- [ ] `repromptCount` is present on scorer result shape
- [ ] Both unit tests pass
- [ ] `npx tsc --noEmit` passes
