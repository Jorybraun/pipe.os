# Disparate Impact Monitoring Infrastructure

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part6-market-research.md (lines 274–297)
**Phase:** 2
**Status:** PENDING
**Estimate:** 2 weeks
**Type:** Engineering + Compliance

## Source quote

> **What requires investment** as the platform scales: disparate impact monitoring infrastructure (protected attribute collection with consent, selection rate analysis across groups, automated alerting on statistical parity divergence), candidate AI-use disclosure UX (unified "AI was used in evaluating your application" notification with link to methodology), GDPR subject rights tooling (access requests, erasure with retention exceptions).

> **Don't over-engineer fairness tooling before you have signal.** Disparate impact analysis requires volume — hundreds of matches across roles with protected attribute data — to produce statistically meaningful conclusions. Monitoring infrastructure should be built now; formal bias audit activities activate when volume justifies.

## Why

NYC Local Law 144 enforcement has begun. EU AI Act rolling enforcement is ongoing. The monitoring infrastructure (schema, collection consent UI, selection rate computation, statistical alerting) must exist before volume arrives — it cannot be retrofitted after the fact. Formal bias audit activities activate when volume justifies, but data collection cannot start retroactively.

## Subtasks (delegable)

### Subtask 1 — Protected attribute schema + consent collection

**Files / Deliverables:**
- `workers/api/migrations/XXXX_protected_attributes.sql`
- `workers/api/src/lib/fairness/protectedAttributes.ts`

**Spec:**
Migration adds `candidate_protected_attributes` table:
```sql
CREATE TABLE candidate_protected_attributes (
  candidate_id   TEXT NOT NULL,
  attribute      TEXT NOT NULL,  -- 'gender' | 'race_ethnicity' | 'disability' | 'veteran'
  value          TEXT NOT NULL,  -- candidate self-reported value or 'prefer_not_to_say'
  consent_given  INTEGER NOT NULL DEFAULT 0,  -- 1 = explicit consent given
  consent_at     TEXT,
  collection_purpose TEXT NOT NULL DEFAULT 'disparate_impact_monitoring',
  PRIMARY KEY (candidate_id, attribute)
);
```

`protectedAttributes.ts` exports:
- `recordProtectedAttribute(candidateId, attribute, value, consentGiven, db): Promise<void>`
- `getConsentedAttributes(candidateId, db): Promise<ProtectedAttributeRecord[]>`
- `hasConsent(candidateId, attribute, db): Promise<boolean>`

Collection is strictly optional — no field is required at candidate intake. The consent collection UI is a separate subtask (see Subtask 2).

**Status:** ⏳ PENDING

### Subtask 2 — Consent collection UI (candidate intake)

**Files / Deliverables:**
- `src/components/fairness/DiversityOptIn.tsx`

**Spec:**
A voluntary, clearly labeled UI section at the end of candidate intake (after core profile fields). Copy template:

> "Optional: Help us measure fairness  
> We track whether our matching system is fair across different groups. This information is used only for statistical monitoring — it never influences your evaluation or match scores. Participation is optional."

Fields: gender (free text or prefer not to say), race/ethnicity (US EEOC categories or prefer not to say), disability status (yes / no / prefer not to say), veteran status (yes / no / prefer not to say).

Stores via `recordProtectedAttribute` with `consent_given = 1` only after the candidate explicitly clicks "Submit these responses." A "Skip" button bypasses the section entirely — no data stored.

WCAG 2.1 AA compliant. Uses existing form design system primitives (`FieldGroup`, `TextInput`). Includes `data-testid="diversity-opt-in"`.

**Status:** ⏳ PENDING

### Subtask 3 — Selection rate computation and alerting

**Files / Deliverables:**
- `workers/api/src/lib/fairness/disparateImpact.ts`

**Spec:**
Exports `computeSelectionRates(attribute, db): Promise<SelectionRateReport>` which:
1. Joins `candidate_protected_attributes` (consented only) with match outcomes (recruiter accept/reject)
2. Computes selection rate per group value: `accepted_count / total_evaluated`
3. Computes the 4/5ths rule ratio: lowest group rate / highest group rate
4. Flags `disparateImpactAlert: true` if ratio < 0.80 AND `sample_n >= 30` per group

Returns typed `SelectionRateReport` with `groups[]`, `fourFifthsRatio`, `disparateImpactAlert`, `sampleN`. Minimum sample threshold of 30 per group prevents false alerts on small populations.

Add a Vitest unit test for the 4/5ths rule computation with fixture data.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: candidate intake flow (to add consent UI at correct step)
- Depends on: match outcome storage (recruiter accept/reject records must exist)
- Blocks: `candidate-ai-disclosure-ux.md` (disclosure UX should be built in same sprint as consent collection)

## Acceptance criteria

- [ ] `candidate_protected_attributes` table created; migration applies cleanly
- [ ] Consent UI renders, skippable, stores only on explicit submit
- [ ] `hasConsent` returns false for candidates who skipped
- [ ] `computeSelectionRates` correctly applies 4/5ths rule and minimum sample threshold
- [ ] Alert fires on fixture data with ratio < 0.80 and n ≥ 30
- [ ] Alert does NOT fire with ratio < 0.80 but n < 30
- [ ] `npx tsc --noEmit` passes
