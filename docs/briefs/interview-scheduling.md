# Product Brief - Interview Scheduling

**Date:** 2026-02-28
**Author:** Paige (Product Owner)
**Handoff:** Archer (Principal Architect)
**Status:** Completed

---

## Goal / Problem

Recruiters using Pipe for live video interviews have no way to coordinate scheduling inside the product. When a candidate is ready for a `LIVE_VIDEO` stage, the recruiter must leave the platform — email, DMs, calendar invites — to agree on a time. There's no visibility into which candidates have booked, which haven't responded, and when interviews are happening. The recruiter must hold this context in their head or a separate spreadsheet.

The Interview Scheduling feature brings scheduling coordination into Pipe: recruiters configure their availability (via a third-party scheduling provider like Calendly), candidates self-select a time from that availability, and both parties see the confirmed interview in the platform. The recruiter gets a single `/schedule` dashboard showing every upcoming and past interview with status at a glance.

---

## Target User

- **Primary:** Recruiters who conduct live video interviews as part of their hiring pipeline. They currently juggle Pipe, email, and a separate calendar tool. They need to stop context-switching.
- **Secondary:** Candidates invited to a `LIVE_VIDEO` stage. They need a frictionless way to pick a time without back-and-forth emails. No Pipe account required — same pattern as the assessment flow.

---

## Non-Negotiables / Constraints

- **Third-party scheduling provider.** We are not building a native availability calendar for MVP. Recruiters use an external tool (Calendly, Cal.com, etc.). Pipe stores the recruiter's scheduling URL and presents it to the candidate. Post-MVP: add webhook-based status sync.
- **Decoupled provider abstraction.** The scheduling provider must be behind an interface so Calendly can be swapped for Cal.com, Google Calendar Appointments, or a future native implementation without touching the recruiter dashboard or candidate experience components.
- **Dedicated route `/schedule`.** The scheduling dashboard must be its own route — not a modal inside the pipeline builder or overview. It is a first-class recruiter workflow.
- **No new Cognito or auth changes.** Candidates access the scheduling widget via their existing `inviteToken` flow — unauthenticated, same as the assessment.
- **Status visibility is a must.** For every candidate in a `LIVE_VIDEO` stage, the recruiter must be able to see whether they have scheduled or not. This is the core value — eliminate the "did they book?" question.
- **TypeScript strict mode.** No `any`. All new code passes `npx tsc --noEmit`.
- **Amplify Gen 2.** All persistence through AppSync/DynamoDB. No new Lambda for MVP.

---

## Business Rules (Explicit)

### Scheduling Status
1. A candidate's scheduling status can be: `NOT_SENT` (no invite dispatched), `INVITED` (link shared, not yet booked), `SCHEDULED` (time confirmed), `COMPLETED` (interview happened), `CANCELLED` (candidate or recruiter cancelled), `NO_SHOW`.
2. Initial status when a `LIVE_VIDEO` stage invite is sent to a candidate: `INVITED`.
3. Status transitions forward only in the happy path: `NOT_SENT` → `INVITED` → `SCHEDULED` → `COMPLETED`. Lateral transitions (`SCHEDULED` → `CANCELLED`, `SCHEDULED` → `NO_SHOW`) are allowed.
4. The recruiter can manually override any status at any time from the dashboard (to handle edge cases not caught by webhooks at MVP).

### Recruiter Availability
5. The recruiter configures a scheduling URL per pipeline (e.g. their Calendly event link). This URL is stored on the pipeline and shown to candidates during the scheduling step.
6. If no scheduling URL is configured on the pipeline, the `LIVE_VIDEO` stage invite cannot be sent (gated in the UI).
7. Post-MVP: the recruiter can configure scheduling URLs per stage (not just per pipeline) to support different availability windows for different interview rounds.

### Candidate Scheduling
8. When a candidate reaches the `LIVE_VIDEO` stage, they see a scheduling widget (embed or redirect) powered by the recruiter's scheduling URL.
9. The candidate completes scheduling on the third-party platform. The scheduled time is stored in Pipe as `scheduledAt` via webhook (post-MVP) or manual recruiter entry (MVP fallback).
10. A candidate cannot join the video call from Pipe until their status is `SCHEDULED`.

### Dashboard
11. The `/schedule` route shows all interviews across all pipelines by default, with filters for pipeline, status, and date range.
12. Upcoming interviews (status `SCHEDULED`, date in the future) are prominently sorted to the top.
13. The recruiter can click any interview row to go to the relevant candidate profile.
14. The recruiter can initiate the video call directly from the dashboard for interviews where status is `SCHEDULED` and the time is now (within 15 minutes).

---

## Out of Scope

- Native availability calendar (the recruiter sets their own time slots inside Pipe). This is post-MVP — provider integrations handle it for now.
- Automated webhook-based status sync from Calendly/Cal.com. MVP requires manual status updates by the recruiter. Post-MVP: add webhook receiver Lambda.
- Automated reminder emails to candidates who haven't booked.
- Multi-interviewer panel scheduling (one candidate, multiple interviewers).
- Calendar integrations (Google Calendar, Outlook) for the recruiter's calendar sync.
- Rescheduling flows inside Pipe (handled by the third-party scheduling provider).

---

## Success Metrics

- Zero "did they book?" emails sent after this feature ships — recruiters see status directly in Pipe.
- Time from "candidate invited to LIVE_VIDEO stage" to "interview scheduled" drops (qualitative in first cohort).
- `/schedule` page is opened at least once per active pipeline per recruiter per week.
- Recruiter can answer "when is my next interview?" from Pipe in under 10 seconds.

---

## Business Context / Rationale

Pipe is competing on recruiter experience. Every workflow that forces the recruiter to leave Pipe is friction that erodes trust in the product. Scheduling is one of the highest-frequency exits — it happens for every live interview. Bringing it in-product (even via a thin wrapper around Calendly) immediately raises the perceived completeness of the platform and gives Pipe a hook to own more of the coordination workflow over time.

---

## Timeline / Deadline

MVP as soon as possible — this is blocking real recruiters from using the `LIVE_VIDEO` stage in production. Scheduling UX without a status dashboard is not usable at scale.
