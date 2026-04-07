# ADR-031: AI Hiring Compliance Architecture

**Date:** 2026-04-07
**Status:** Proposed
**Deciders:** Hans (founder)

---

## Context

The Culture Interview Agent (ADR-029) is an AI-mediated employment decision tool. The legal and regulatory environment for such tools changed substantively between 2024 and 2026, and PIPE is shipping into a landscape that did not exist when most commercial AI hiring products were designed. This ADR documents the compliance architecture: what the system must do, why, and where in the codebase those obligations are enforced.

### The three binding regimes

Research brief §5 documents the current regulatory picture. Three frameworks directly apply to the culture agent:

**1. Illinois HB 3773 (2025 amendment to the Illinois Human Rights Act)**
Effective January 1, 2026. Requires employers using "predictive data analytics" in employment decisions to:
- Disclose the use of AI to the applicant
- Disclose the general types of characteristics used by the AI
- Obtain applicant consent before AI is used
- Maintain records of AI usage for audit

**2. EU AI Act, Article 14 (Human Oversight)**
Full effect for high-risk AI systems August 2, 2026. Annex III classifies AI used "for recruitment or selection of natural persons, in particular to place targeted job advertisements, to analyse and filter job applications, and to evaluate candidates" as high-risk. Article 14 requires:
- Human oversight that is "effective" (not rubber-stamp)
- Ability for the human to disregard, override, or reverse the AI output
- Ability to stop the AI system
- Logged decisions traceable to a specific human reviewer
- Explanations of AI outputs that the human can actually understand

**3. EEOC Enforcement Guidance (2023, updated 2025)**
Not a statute but the enforcement frame the agency uses. Applies Title VII disparate-impact analysis to AI hiring tools. Key obligation: the employer remains liable for discriminatory outcomes produced by vendor tools. This means PIPE's customers can be sued for what PIPE's agent does, and PIPE will be joined in discovery.

### What this means for PIPE specifically

- The interview cannot start without explicit candidate consent
- The consent must disclose that AI is conducting the interview, what characteristics it analyzes, and how to opt out
- A non-AI alternative must be offered (or the candidate's refusal must not count against them)
- Every recruiter decision informed by the agent must be reviewed and confirmed by a human before it takes effect on the candidate
- All of this must be logged with timestamps in a tamper-evident way
- The candidate must be able to request deletion of their interview transcript

---

## Decision

Implement compliance as **three architectural gates** wired into the culture agent's state machine, plus a dedicated audit log table in D1. The gates are:

1. **Consent gate** — blocks the interview from starting until the candidate has acknowledged the disclosure
2. **HITL gate** — blocks any score from becoming "final" until a recruiter has reviewed it
3. **Deletion path** — candidate can request transcript deletion, fulfilled within 30 days

Audit logging is enforced at the database level via a foreign-key invariant: no interview turn can exist without a corresponding `consent_at` timestamp on the session row.

### 1. Consent gate

**Placement:** the `consent` state of the culture interview FSM (ADR-029 §3). When a candidate opens a culture interview session for the first time, the `GET /rpc/culture/session/:token` route returns:

```json
{
  "state": "consent",
  "disclosure": {
    "ai_conducted": true,
    "vendor": "PIPE, operated by [recruiter company name]",
    "model": "Google Gemma 4 via Cloudflare Workers AI",
    "characteristics_analyzed": [
      "how you describe past work situations",
      "the specificity of examples you provide",
      "your stated preferences for team environment",
      "alignment with the hiring team's self-described working style"
    ],
    "not_analyzed": [
      "your tone of voice, emotional state, or facial expressions",
      "your name, background, or any demographic information",
      "your accent or speaking pace"
    ],
    "human_review": "A human recruiter at [company] will review the AI's assessment before making any decision.",
    "alternative": "You can request a traditional (non-AI) interview instead. Contact [recruiter email].",
    "deletion": "You can request deletion of your interview transcript at any time. Email [recruiter email].",
    "retention_days": 90
  },
  "next_action": "consent_required"
}
```

The candidate UI renders this as a prominent screen with two buttons: "I consent, continue" and "Request traditional interview instead." No question text is ever shipped to the client until the candidate has hit consent.

**Enforcement at the data layer:** the `culture_interview_sessions` row starts with `consent_at = NULL` and `state = 'consent'`. A migration-level check constraint rejects any attempt to write to `transcript.turns` when `consent_at` is NULL:

```sql
-- Conceptual invariant, enforced in application layer until D1 supports triggers
CREATE TRIGGER consent_required_before_turns
BEFORE UPDATE ON culture_interview_sessions
WHEN json_array_length(json_extract(NEW.transcript, '$.turns')) > 0
     AND NEW.consent_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'consent_at must be set before any turn is recorded');
END;
```

D1 does not yet support triggers in all plans, so this invariant is additionally enforced in `cultureAgent.ts` via a pre-write assertion, with a test that confirms a pre-consent turn write throws.

**Audit anchor:** `consent_at` is the single timestamp every compliance audit will look for. It is the foreign key, philosophically speaking, between "permission" and "processing."

### 2. Human-in-the-Loop (HITL) gate

**Placement:** the transition from `complete` session state to any downstream effect on the candidate's assessment (score contributing to ranking, pipeline advancement, rejection email).

When scoring finishes, the session state is `complete` and the `score_report` is populated, but the score is flagged as `pending_review`. No part of the downstream system treats a `pending_review` score as final.

The recruiter UI (`CultureReport.tsx` from ADR-029 §7) displays the BARS scores, the culture profile radial chart, the narrative, and the evidence quotes, and requires the recruiter to:
1. Read the report
2. Click one of three buttons: **Confirm**, **Override**, **Flag for second opinion**
3. If Override, provide a text reason (saved for audit)
4. If Flag, the score stays `pending_review` and another recruiter must review

Only after explicit **Confirm** or **Override** does the score become `final` and affect downstream ranking.

**Route:** `POST /api/v1/screening/culture/sessions/:sessionId/review`
```json
{
  "decision": "confirm" | "override" | "flag",
  "override_reason": "string, required if decision='override'",
  "reviewer_user_id": "Clerk sub"
}
```

The reviewer's Clerk user ID and decision are written to the audit log (see §4). EU AI Act Article 14 is satisfied by the Override + text reason path: the reviewer can disregard the AI output and the reason is logged.

**Anti-pattern prevented:** "one-click confirm" is deliberately absent at v1. The Confirm button requires the recruiter to have opened the report (tracked via a `viewed_at` timestamp) and scrolled past the evidence quotes section (tracked via an intersection observer). This is friction by design — rubber-stamp confirmation does not satisfy Article 14.

### 3. Deletion path

**Placement:** a dedicated route and a "Request deletion" link in the post-interview thank-you page.

Candidate-facing flow:
1. After completing (or abandoning) an interview, the candidate sees a confirmation page with a "Request transcript deletion" link
2. Clicking it opens a form that captures their email (for identity verification) and a deletion reason (optional)
3. Submission sends a notification to the recruiter's company email and logs a `deletion_requested_at` timestamp on the session row
4. The recruiter has 30 days to delete (or object in writing)
5. Deletion is hard: the `transcript` column is overwritten with `{"deleted": true, "deleted_at": "..."}`, `score_report` is nulled, and `candidate_id` is set to a special `anonymized_<hash>` value

**Not deleted on deletion:**
- The `culture_ai_usage_events` row (from ADR-029 Phase B) — retained for billing audit, no PII
- The `consent_at` timestamp — retained for compliance audit, no PII
- The fact that an interview happened — retained for statistical reporting

**Rationale:** GDPR right-to-erasure and CCPA right-to-delete both allow retention of minimum data needed for legitimate interests like billing and compliance audit, provided no personally-identifying or content data remains.

### 4. Audit log table

New table `culture_compliance_audit` (migration `0016_culture_compliance_audit.sql`, shipped with the culture agent):

```sql
CREATE TABLE IF NOT EXISTS culture_compliance_audit (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  event_type      TEXT NOT NULL, -- 'consent_shown' | 'consent_given' | 'consent_declined'
                                 -- | 'alternative_requested' | 'interview_started' | 'interview_completed'
                                 -- | 'scoring_complete' | 'review_started' | 'review_confirmed'
                                 -- | 'review_overridden' | 'review_flagged'
                                 -- | 'deletion_requested' | 'deletion_fulfilled'
  actor_type      TEXT NOT NULL, -- 'candidate' | 'recruiter' | 'system'
  actor_id        TEXT,          -- candidate_id or Clerk sub, NULL for system
  metadata        TEXT,          -- JSON: override_reason, decline_reason, etc.
  created_at      TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES culture_interview_sessions(id)
);

CREATE INDEX idx_audit_session ON culture_compliance_audit(session_id);
CREATE INDEX idx_audit_event_type ON culture_compliance_audit(event_type);
CREATE INDEX idx_audit_created ON culture_compliance_audit(created_at);
```

The audit log is **append-only** — there is no update or delete route. In the unlikely event an entry is wrong, a compensating entry is added rather than mutating the original.

The audit log is retained for 7 years per EEOC recordkeeping requirements, independent of interview-content deletion.

### 5. Where each obligation lives in code

| Obligation | Enforcement point | Route / file |
|---|---|---|
| Disclosure before first question | `GET /rpc/culture/session/:token` returns consent payload | `routes/screening/culture.ts` |
| Consent recorded before any turn | `POST /rpc/culture/session/:token/consent` sets `consent_at` + logs audit event | `routes/screening/culture.ts`, `cultureAgent.ts` pre-write assertion |
| Non-AI alternative path | "Request traditional interview" button sends email to recruiter, logs `alternative_requested` | `routes/screening/culture.ts` |
| Human oversight of every score | `POST /api/v1/screening/culture/sessions/:sessionId/review` required before score is `final` | `routes/screening/culture.ts` |
| Explanation for the human reviewer | BARS scores + evidence quotes + narrative in `CultureReport.tsx` | `src/components/Culture/CultureReport.tsx` |
| Override ability | `decision: 'override'` with mandatory `override_reason` | `routes/screening/culture.ts` |
| Deletion request | `POST /rpc/culture/session/:token/request-deletion` | `routes/screening/culture.ts` |
| Deletion fulfillment | Recruiter-triggered `POST /api/v1/screening/culture/sessions/:sessionId/delete` | `routes/screening/culture.ts` |
| Audit log append | Every gate event writes a row to `culture_compliance_audit` via `ctx.waitUntil` | `lib/cultureCompliance.ts` (new helper) |

### 6. What is NOT in scope for this ADR

- **Bias auditing.** Research §5.4 recommends periodic disparate-impact analysis on scoring outputs. This is a separate, Pro-tier feature and will get its own ADR once we have enough volume to compute meaningful statistics.
- **Jurisdiction-specific consent variants.** v1 ships a single global consent text that satisfies the strictest regime (EU AI Act). Jurisdiction-aware consent (shorter for US, longer for EU) is a future enhancement.
- **Data residency.** Cloudflare D1 stores at edge; a future ADR will address EU data residency if an EU customer requires it.
- **Model card publication.** Article 13 requires transparency documentation for high-risk AI. A public model card page is deferred to the pre-launch checklist, not this ADR.

---

## Alternatives Considered

### A. Skip consent gate, rely on recruiter's ToS

**Rejected.** Illinois HB 3773 requires applicant-level consent, not ToS acceptance by the hiring company. The recruiter cannot consent on the candidate's behalf. Also, candidates often do not read company ToS and courts have repeatedly held that buried AI disclosures are insufficient.

### B. Auto-confirm HITL if recruiter doesn't review within N days

**Rejected.** Article 14 is explicit: "effective" human oversight. Time-based auto-confirm converts HITL into a rubber stamp, defeating the provision. The correct behavior is for the score to remain `pending_review` indefinitely until a human acts; if the recruiter doesn't review, the candidate simply doesn't advance, which is the correct fail-safe.

### C. Append audit entries asynchronously via a Workers queue

**Rejected at v1.** An async queue introduces the possibility of audit log loss during failure windows — the worst possible failure mode for a compliance system. Direct D1 writes on the critical path are fast enough (D1 append writes are sub-10ms). If throughput becomes a concern, revisit with a durable queue.

### D. Let recruiters disable consent gate for "quick test" scenarios

**Rejected on principle.** Every exception becomes a lawsuit. No off-switch exists; the gate runs for every session.

### E. Store audit log in a separate bucket (R2 append-only)

**Rejected at v1.** R2 is eventually consistent and lacks the relational integrity we need (joining audit events to sessions). D1 with an index on `session_id` is the right choice. If regulatory pressure requires tamper-evident storage beyond D1's guarantees, a future ADR can add a Merkle-hash chain to the audit table.

---

## Consequences

**Positive:**
- PIPE can be sold into Illinois employers on day one without a rewrite
- EU customers can use the culture agent after August 2, 2026 without emergency changes
- Audit log gives PIPE's customers (and PIPE itself) a defensible paper trail if sued
- The architecture treats compliance as first-class, not a sales-deck afterthought

**Negative:**
- Recruiter UX has friction (mandatory review step, evidence-quotes scroll-gate) that less-mature products lack. This is a feature, not a bug, but sales must explain it.
- Audit log grows unboundedly over time; need a future cleanup or cold-storage strategy around year 6
- Deletion fulfillment is recruiter-triggered, which means slow recruiters could expose PIPE to a 30-day-clock violation. Mitigate with automated reminder emails and a dashboard of pending deletion requests.
- Customers who want to "just see the AI score and decide fast" will push back. The right response is "that's not a product we make, here's why."

**Follow-ups:**
- ADR-032 (future): Bias auditing and disparate-impact reporting
- Operations runbook: deletion-request SLA monitoring
- Legal review of consent copy by counsel before first paying customer ships
- Model card publication for the Gemma 4 deployment (per Article 13)

---

## Verification

- **`e2e/culture-consent-gate.spec.ts`** — no question visible without consent; consent_at is written; audit log entry exists
- **`e2e/culture-hitl-gate.spec.ts`** — score stays `pending_review` until recruiter clicks Confirm or Override; Override requires reason; audit log entries for each
- **`e2e/culture-deletion.spec.ts`** — candidate can request deletion; recruiter can fulfill; transcript and score_report are nulled; consent_at and audit log are retained
- **Vitest unit** — pre-consent turn write throws; audit log writes are idempotent
- **Manual legal review** — consent copy reviewed by employment-law counsel before first paying customer
