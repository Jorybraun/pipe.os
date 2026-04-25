# Candidate AI-Use Disclosure UX

**Source:** knowledge/plan/pipe-strategy-v2-part6-market-research.md (lines 277–296)
**Phase:** 2
**Status:** PENDING
**Estimate:** 0.5 weeks
**Type:** Engineering + Compliance

## Source quote

> **Candidate AI-use notification** (NYC Local Law 144, EU AI Act, several US state laws) — explicit disclosure to candidates that AI is used in their evaluation. Currently Pipe has consent flows for culture interview and keystroke-adjacent telemetry, but not a unified AI-use disclosure surface.

## Why

NYC Local Law 144 requires explicit disclosure to candidates that an automated employment decision tool is being used. EU AI Act Article 13 requires transparency. Pipe currently has per-surface consent flows but no unified "AI was used in evaluating you" disclosure. This creates a compliance gap for any NYC employer using Pipe.

## Subtasks (delegable)

### Subtask 1 — Unified AI disclosure banner / page

**Files / Deliverables:**
- `src/components/compliance/AiUseDisclosure.tsx`
- `src/pages/candidate/AiDisclosurePage.tsx`

**Spec:**
A standalone page (route: `/disclosure` or appended to candidate invite link) and reusable component. Required content per NYC Local Law 144 and EU AI Act guidance:

- Statement that AI is used in evaluation
- Description of what AI evaluates (code review conversation, culture interview responses, implementation telemetry)
- Statement that a human recruiter reviews all AI outputs before decisions
- Link to bias audit results (placeholder URL acceptable until audit is completed)
- Contact method for requesting alternative non-AI evaluation process

`AiUseDisclosure` is the display component. `AiDisclosurePage` wraps it as a full page. Both use brutalist glassmorphic design system. Component has `data-testid="ai-use-disclosure"`.

The disclosure must be shown before the candidate begins any evaluation. The culture interview consent flow should link to this page.

**Status:** ⏳ PENDING

### Subtask 2 — Compliance audit event for disclosure shown/accepted

**Files / Deliverables:**
- `workers/api/src/lib/compliance/auditEvents.ts`

**Spec:**
Add two event types to the existing `culture_compliance_audit` table (or equivalent compliance audit log):
- `ai_disclosure_shown` — candidate was shown the AI disclosure page
- `ai_disclosure_acknowledged` — candidate clicked "I understand" / proceeded

`auditEvents.ts` exports `recordAiDisclosureEvent(candidateId, eventType, sessionId, db)`. The event captures `actor = 'candidate'`, `timestamp`, and `session_id` for traceability.

If `culture_compliance_audit` already has the 13 event types listed in the strategy doc, verify whether these two are already present. If present, this subtask reduces to a documentation update; if absent, add both event types.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: existing candidate invite / consent flow (disclosure page inserted before evaluation starts)
- Depends on: `culture_compliance_audit` schema (audit event storage)
- Blocks: `gdpr-subject-rights.md` (disclosure page can link to GDPR rights exercise)

## Acceptance criteria

- [ ] Disclosure page renders with all five required content elements
- [ ] Page is accessible: WCAG 2.1 AA (screen reader, keyboard nav, contrast)
- [ ] `ai_disclosure_shown` event is recorded when page loads
- [ ] `ai_disclosure_acknowledged` event is recorded when candidate proceeds
- [ ] Culture interview consent flow links to disclosure page
- [ ] `npx tsc --noEmit` passes
