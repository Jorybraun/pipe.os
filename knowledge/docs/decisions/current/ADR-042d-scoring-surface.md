# ADR-042d: Scoring Surface — Primary Overall Score with Expandable Dimension Detail

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Solo founder
**Updates:** [ADR-032](ADR-032-code-review-research-integration.md) §Phase 1 (6-dimension BARS rubric)

---

## Context

ADR-032 established a 6-dimension BARS scoring rubric (Issue identification depth / Reasoning / Prioritization / Question formation / Revision evaluation / AI direction). The research grounding is solid, but the *presentation* of scores to recruiters was not specified. Two UX pitfalls must be avoided:

1. **Dimension overload.** Showing six scores upfront creates a "dashboard effect" where recruiters fixate on the lowest dimension rather than the holistic signal. The research literature (Hodges 1999) explicitly warns that decomposed checklists penalize expert performers; the same cognitive bias applies to recruiters reading scores.

2. **False precision.** A candidate who scores 82 on Issue depth and 75 on Reasoning is not meaningfully different from one who scores 80 and 77. Presenting all six numbers with equal visual weight implies precision the rubric does not claim.

Meanwhile, the dimension scores are valuable for:
- **Calibration** — `/calibrate` needs per-dimension breakdowns to tune prompts
- **Candidate feedback** — narrative evidence quotes are attached to dimensions
- **Dispute resolution** — if a candidate challenges a score, the dimension evidence is the audit trail

The challenge is to surface the holistic signal by default and the decomposed detail on demand.

---

## Decision

**Present the overall score as the primary surface. Show the 6 BARS dimensions in an expandable detail panel.**

### Recruiter dashboard surface

```
┌─────────────────────────────────────────────┐
│  Code Review Score                          │
│  ┌──────────┐                               │
│  │    78    │  Strong                       │
│  │  Strong  │  Candidate demonstrated...    │
│  └──────────┘                               │
│                                             │
│  [View breakdown ▼]                         │
└─────────────────────────────────────────────┘
```

When expanded:
```
│  Issue identification depth    82  ████████░░  Evidence: "..."
│  Reasoning                     75  ███████░░░  Evidence: "..."
│  Prioritization                80  ████████░░  Evidence: "..."
│  Question formation            70  ███████░░░  Evidence: "..."
│  Revision evaluation           85  █████████░  Evidence: "..."
│  AI direction                  76  ████████░░  Evidence: "..."
```

### Design rules

1. **Overall score is a single number, 0–100.** It is the synthesizer's output, not a weighted average of dimensions. The synthesizer sees all dimension outputs and produces a holistic score with its own evidence narrative.

2. **Band is categorical, not computed from score.** The synthesizer assigns `Strong` / `Adequate` / `Weak` based on the full transcript, independent of the numeric score. A candidate can score 78 (numeric) and still be `Adequate` if the synthesizer identifies a critical gap not captured by the dimension scores. This is rare but intentional — it prevents score gaming.

3. **Dimension scores are secondary, never primary.** They appear only after explicit expansion. In the candidate-facing report, dimensions are omitted entirely; only the narrative and band are shown.

4. **Evidence quotes are truncated to 120 characters by default, expandable to full.** This keeps the breakdown scannable.

5. **Color coding is band-based, not score-based.** `Strong` = green, `Adequate` = amber, `Weak` = red. Dimension bars use neutral gray to avoid implying that one dimension is "more important" than another.

### API contract

The `GET /rpc/review/session/:id/score` response (see [ADR-042c](ADR-042c-review-endpoint-shape.md)) already contains both `overall_score` and `dimensions`. No API change is required. This ADR governs the UI presentation layer only.

---

## Consequences

### Positive
- Reduces recruiter cognitive load — the first glance yields a single actionable signal
- Preserves calibration and auditability — dimensions are one click away
- Aligns with Hodges finding: global rating (overall score) + BARS anchoring (dimension detail) is the validated format
- Prevents dimension-fixation bias where recruiters over-weight a single low score
- Candidate-facing report stays narrative-focused (band + story), which is more humane and legally defensible

### Negative / Risks
- Some recruiters may expect a radar chart or spider diagram. Deferred — add if requested in user feedback
- Dimension scores are not weighted-averaged to the overall score, which may confuse users who expect arithmetic consistency. Mitigation: add a tooltip explaining that the overall score is a holistic synthesis, not a formula
- Export to ATS or PDF may need both surfaces. The API already provides both; export templates can choose

## Alternatives Considered
- **Radar chart as primary surface** — Rejected: radar charts invite comparison across dimensions as if they were independent variables. The dimensions are correlated (e.g., strong Reasoning usually correlates with strong AI direction) and the visual format overstates their separability
- **Weighted average displayed as primary** — Rejected: contradicts the synthesizer's role. If the overall score is just a weighted average, the synthesizer is redundant and the 6 dimensions become a checklist — exactly the Hodges anti-pattern
- **Show all dimensions always, overall score as a header** — Rejected: this is the status quo in many HR tools and is explicitly what this ADR avoids. It produces fixation on outliers

## Open Questions
- Should the dimension breakdown be visible to candidates in a "detailed feedback" mode? (Leaning toward no for MVP; narrative-only for candidates)
- Should there be a recruiter toggle to "pin" the breakdown open by default? (Possible future preference)
- How should the export/PDF template present dimensions? (TBD during report design)
