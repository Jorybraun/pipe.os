# A/B Test Protocol

**Owner:** QA Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §6  
**Blocked by:** `validation/evaluation-criteria.md`, `validation/golden-set-definition.md`  
**Blocks:** None  

---

## 1. Problem Statement

The culture agent redesign claims to improve match quality by adding behavioral signal to the graph. We need a protocol to measure whether this claim is true. The A/B test compares the old flow (resume-only matching) against the new flow (resume + screener matching).

## 2. Hypotheses

| Hypothesis | Null Hypothesis | Success Criteria |
|---|---|---|
| H1: Enriched matching improves recruiter thumbs-up rate | H0: No difference | Thumbs-up rate ↑ ≥ 10% relative |
| H2: Enriched matching reduces time-to-hire | H0: No difference | Time-to-hire ↓ ≥ 15% relative |
| H3: Mode-1 screener does not increase drop-off | H0: Drop-off increases | Drop-off rate ≤ baseline + 5% |

## 3. Test Design

### 3.1 Population

- **Inclusion:** All candidates in tailored/hybrid pipelines who upload a resume.
- **Exclusion:** Validate pipelines (no matching), internal referrals, recruiter-manual-assign.
- **Sample size:** Minimum 100 candidates per arm (200 total) for 80% power at α = 0.05.

### 3.2 Arms

| Arm | Description | Identifier |
|---|---|---|
| Control | Current flow: resume → match → CODE_REVIEW | `control-v1` |
| Treatment | New flow: resume → Mode-1 → enrich → match → CODE_REVIEW | `treatment-v2` |

### 3.3 Randomization

```typescript
function assignArm(candidateId: string): 'control' | 'treatment' {
  const hash = hashString(candidateId + experimentSalt);
  return hash % 2 === 0 ? 'control' : 'treatment';
}
```

**Salt:** Rotated per experiment to prevent carryover.

### 3.4 Metrics

**Primary metric:** Recruiter thumbs-up rate on match report.

**Secondary metrics:**
- Time from resume upload to CODE_REVIEW start
- Interview completion rate (Mode-1)
- Average turns per Mode-1 interview
- Scoring cost per candidate
- Candidate NPS (post-interview survey)

**Guardrail metrics:**
- Drop-off rate at Mode-1
- Support tickets related to interview
- Legal complaints (must be zero)

### 3.5 Duration

- **Minimum:** 2 weeks
- **Maximum:** 6 weeks
- **Early stop:** If guardrail metric breaches (drop-off > baseline + 10%), stop immediately.

## 4. Analysis

### 4.1 Statistical test

Thumbs-up rate is binary → **two-proportion z-test**.

```typescript
function zTest(p1: number, n1: number, p2: number, n2: number): number {
  const p = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return (p1 - p2) / se;
}
```

### 4.2 Segmentation

Analyze by:
- Seniority (junior vs. senior)
- Pipeline philosophy (tailored vs. hybrid)
- Candidate source (referral vs. outbound vs. inbound)

## 5. Implementation Details

### 5.1 Tracking

```sql
-- New table for experiment assignments
CREATE TABLE experiment_assignments (
  candidate_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  arm TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  enrolled BOOLEAN DEFAULT 1
);

-- New columns on match_reports
ALTER TABLE candidate_challenge_assignment ADD COLUMN experiment_arm TEXT;
ALTER TABLE candidate_challenge_assignment ADD COLUMN match_quality_score REAL;
```

### 5.2 Feature flag

```typescript
const ENABLE_SCREENER_EXPERIMENT = env.ENABLE_SCREENER_EXPERIMENT === 'true';

if (ENABLE_SCREENER_EXPERIMENT) {
  const arm = assignArm(candidateId);
  if (arm === 'treatment') {
    return startMode1Screener(candidateId);
  }
}
// Control: old flow
return proceedToMatching(candidateId);
```

## 6. Open Questions

1. **What if recruiters know which arm a candidate is in?** This biases thumbs-up. — **Recommendation:** Blind the recruiter. Show the same match report UI for both arms. The only difference is the underlying vector.

2. **What if a candidate in the treatment arm abandons Mode-1?** Do they fall back to control? — **Recommendation:** No. They are analyzed as "enrolled but not treated" (intention-to-treat analysis).

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sample size too small for significance | Medium | High | Run for 6 weeks minimum. Expand to 300 per arm if needed. |
| Recruiter bias unblinds the experiment | Medium | High | Same UI for both arms. Log if recruiter views source. |
| Treatment arm has higher drop-off, invalidating sample | Medium | High | Guardrail metric: stop if drop-off > baseline + 10%. |
