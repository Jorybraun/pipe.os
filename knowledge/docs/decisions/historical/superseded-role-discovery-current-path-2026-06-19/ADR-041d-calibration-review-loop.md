# ADR-041d: Calibration Review Loop

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Hans (founder)
**Extends:** [ADR-036](ADR-036-role-discovery-data-contract.md), [ADR-041b](ADR-041b-rcd-primary-artifact.md), [ADR-041c](ADR-041c-rcd-synthesis-wiring.md)
**Author:** Claude Opus 4.7 with founder

---

## Context

The RCD synthesis pipeline (ADR-041c) produces a structured Role Context Document from interview transcripts. Like any automated extraction system, it makes errors: misattributed quotes, projected values, overstated confidence, and missed nuance. ADR-036 §1.2 added a verifier pass to catch mechanical failures (quote fabrication, energy inflation). What remains is the **semantic review** — a human recruiter reading the RCD and saying "that's not quite right" or "you missed something important."

Without a review loop, these errors propagate downstream:
- A misattributed "senior means autonomous" quote becomes a BARS override for the culture interview.
- A projected "quality matters" value inflates the `dispositional_weights` for rigor.
- A missed "we pair program daily" story leaves the team culture profile inaccurate.

The calibration review loop is a **human-in-the-middle** step between synthesis completion and pipeline activation. It is not optional for Pro-tier roles; it is gated by a recruiter approval action.

---

## Decision

### 1. Review UI: RoleContextReview

The `RoleContextReview` component (`src/components/RoleDiscovery/RoleContextReview.tsx`) displays the synthesized RCD in three sections:

- **Team Context** — laddering chains from the `team` domain, per stakeholder
- **Technical Context** — `technical_context` aggregate (stack, constructs, seniority band, codebase expectations, dispositional weights)
- **Dispositional Context** — laddering chains from the `bar` domain + `team_culture_profile`

Each laddering chain card shows:
- `consequence` (headline)
- `attribute_quote` (verbatim evidence)
- `value` + `confidence` + `source_exchange_id`
- Energy dot (high / medium / low)

### 2. Flag Types

Every chain card exposes three flag actions:

| Flag | Meaning | Agent Action |
|---|---|---|
| **Not quite right** (`inaccurate`) | The consequence or value misrepresents what the recruiter meant. | Re-synthesize the affected cell with a clarifying question. |
| **Missing evidence** (`missing_evidence`) | The claim is plausible but has no verbatim quote, or the quote is taken out of context. | Request a specific story or example from the recruiter. |
| **Add detail** (`add_detail`) | The claim is correct but incomplete; the recruiter wants to elaborate. | Ask a targeted follow-up question on the specific attribute. |

Flagging is per-chain, not per-section. The recruiter can flag multiple chains independently.

### 3. Gap-Filling Flow

When a recruiter flags a chain:

1. **Frontend** calls `POST /api/v1/role-contexts/:id/flag` with `{ flagType, domain, attribute, note? }`.
2. **Backend** invokes `callGapFillingAgent` (`workers/api/src/lib/roleAgent.ts`), which reads the RCD, the transcript, and the flag to generate a **single clarifying question**.
3. **Frontend** displays the question in a `GapFillModal` (`src/components/RoleDiscovery/GapFillModal.tsx`).
4. **Recruiter** types an answer and submits.
5. **Backend** invokes `calibrateRcd` (`workers/api/src/lib/roleAgent/calibrateRcd.ts`), which re-synthesizes **only the affected domain cell** (ADR-041e).
6. **Frontend** refreshes the RCD view with the updated cell.

The recruiter may repeat this loop until satisfied. There is no hard limit on flag count, but the UI nudges toward completion after three iterations.

### 4. Approval Gate

The pipeline cannot be created from a role context until the recruiter clicks **"Approve RCD"** on the review page. This sets `role_contexts.status = 'APPROVED'` (new status value). The pipeline creation route (`POST /api/v1/pipelines`) rejects requests where the associated role context is `COMPLETE` but not `APPROVED`.

Free-tier users skip the review loop — their RCD is auto-approved after synthesis. Pro-tier users must approve manually.

### 5. Face Validity Metadata

When the recruiter clicks "Approve RCD," the system writes:
- `validation_metadata.face_validity_reviewed_at` = ISO 8601 timestamp
- `validation_metadata.face_validity_reviewer` = recruiter's Clerk user ID

This creates an audit trail for compliance (ADR-031) and enables downstream quality analysis ("RCDs approved in < 30 seconds have higher downstream error rates").

### 6. Calibration Telemetry

Every flag and gap-fill answer is logged to a new `rcd_calibration_events` table:

```sql
CREATE TABLE rcd_calibration_events (
  id TEXT PRIMARY KEY,
  role_context_id TEXT NOT NULL REFERENCES role_contexts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('flag', 'gap_question', 'gap_answer', 'approve')),
  domain TEXT,
  attribute TEXT,
  flag_type TEXT,
  recruiter_note TEXT,
  clarifying_question TEXT,
  gap_answer TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

This table is the primary dataset for prompt-tuning cycles. If 40% of RCDs get flagged on the `team` domain, the interviewing prompt's Team probes are rewritten.

---

## Consequences

### Positive

- **Error containment.** Synthesis errors are caught before they reach candidate-facing assessments.
- **Recruiter trust.** Showing verbatim quotes with source attribution proves the agent was listening. Recruiters who see their own words reflected back report higher confidence in downstream outputs.
- **Continuous improvement.** Calibration events provide labeled data for prompt refinement. A flag is a weak label for "synthesis error at this cell."
- **Compliance posture.** Face-validity review with timestamped approval creates a human-oversight record for EU AI Act Article 14 and NYC Local Law 144 audit trails.

### Negative / Risks

- **Friction in pipeline creation.** Adding an approval gate adds one click and potentially one gap-fill cycle to every Pro-tier pipeline. Mitigation: the review UI is scannable (energy dots highlight high-confidence claims; summaries are short). Typical review time is < 90 seconds.
- **Reviewer bias.** Recruiters may approve inaccurate RCDs because they are in a hurry. Mitigation: telemetry tracks time-to-approve; outliers (< 15 seconds) are flagged for quality sampling.
- **Flag spam.** A recruiter who disagrees with the synthesis methodology (not a specific error) may flag every chain. Mitigation: the gap-filling agent asks increasingly specific questions; if the recruiter's answers are non-responsive, the UI surfaces a "Contact support" path rather than infinite looping.

---

## Alternatives Considered

- **No review loop (auto-approve all RCDs)** — Rejected: synthesis errors propagate to candidate assessments unchecked. The cost of one bad BARS override or misaligned challenge is higher than the cost of a 90-second review.
- **Post-hoc correction (fix after pipeline is live)** — Rejected: candidates may have already been assessed with the wrong context. Retroactive rescoring is technically possible but legally and ethically fraught.
- **Reviewer is a second AI (not the recruiter)** — Rejected: the recruiter is the domain authority. An AI reviewer would check mechanical fidelity (already covered by the verifier pass), not semantic accuracy. Only the recruiter knows whether "senior means autonomous" is true for their team.

---

## Open Questions

1. **Reviewer assignment:** For multi-stakeholder RCDs (ADR-028), should the Hiring Manager approve the whole RCD, or should each stakeholder approve their own domain cells? The latter is more accurate but adds coordination overhead.
2. **Approval timeout:** If a recruiter creates a role context but never returns to approve it, should the system auto-approve after N days? If so, what is N — 7 days? 30 days? Never?
3. **Flag-to-prompt automation:** Should high-frequency flag patterns auto-generate a PR against `roleAgentPrompts.ts`? Too aggressive; but a weekly calibration report (top 5 flagged attributes) seems useful.
4. **Mobile review:** The `RoleContextReview` component is desktop-optimized. Is mobile approval a requirement for recruiter workflows?
