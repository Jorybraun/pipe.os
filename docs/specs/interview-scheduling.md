# Technical Specification - Interview Scheduling

**Date:** 2026-02-28
**Author:** Archer (Principal Architect)
**Handoff:** Devin (Staff Engineer)
**Status:** Draft

**Brief:** [docs/briefs/interview-scheduling.md](../briefs/interview-scheduling.md)
**ADR:** [ADR-013 — Interview Scheduling Provider Architecture](../decisions/ADR-013-interview-scheduling-architecture.md)

---

## Overview

The Interview Scheduling system lets recruiters configure their availability (via a third-party scheduling URL like Calendly) and see, at a glance, which candidates have booked their live video interview and which haven't. Candidates self-select a time slot via an embedded scheduling widget during the `LIVE_VIDEO` assessment stage.

Key properties:
- **Dedicated route** `/schedule` — a first-class dashboard, not a modal.
- **Decoupled provider architecture** — scheduling provider (Calendly, Cal.com, etc.) is behind an interface. Swapping providers requires no changes to the dashboard or candidate components.
- **No new Lambda for MVP** — all persistence is direct Amplify Data. Webhook-based status sync is post-MVP.
- **Status visibility** — recruiter sees `INVITED | SCHEDULED | COMPLETED | CANCELLED | NO_SHOW` per candidate, per interview.

---

## System Architecture

### AWS Amplify Resources

| Resource | Type | Change | Description |
|----------|------|--------|-------------|
| `ScheduledInterview` model | Data | **New** | Stores one interview record per candidate + stage |
| `Pipeline` model | Data | **Field addition** | Add `schedulingUrl: a.url()` — recruiter's Calendly/Cal.com link |
| No new Lambda | Function | N/A | MVP: manual status update. Post-MVP: add webhook receiver. |

### New Routes

| Route | Page | Auth |
|-------|------|------|
| `/schedule` | `SchedulingPage` | Cognito (recruiter) |
| `/assess/:token` (existing) | Adds scheduling step for `LIVE_VIDEO` stages | None (inviteToken) |

### Data Model — `ScheduledInterview`

```typescript
ScheduledInterview: a
  .model({
    candidateId:        a.id().required(),     // FK → Candidate
    pipelineId:         a.id().required(),     // FK → Pipeline (for dashboard filtering)
    stageId:            a.id().required(),     // FK → Stage
    status:             a.enum([
                          'INVITED',
                          'SCHEDULED',
                          'COMPLETED',
                          'CANCELLED',
                          'NO_SHOW',
                        ]).required(),
    scheduledAt:        a.datetime(),          // null until booked
    meetingUrl:         a.url(),               // video call URL (from provider or webrtcConfig)
    schedulingProvider: a.enum(['CALENDLY', 'CAL_COM', 'MANUAL']).required(),
    schedulingUrl:      a.url().required(),    // snapshot of pipeline.schedulingUrl at invite time
    externalEventId:    a.string(),            // provider event ID (populated by webhook, post-MVP)
    recruiterNotes:     a.string(),            // free text for manual overrides
    owner:              a.string(),            // Cognito sub of recruiter
  })
  .authorization((allow) => [
    allow.owner(),                                     // recruiter full CRUD
    allow.publicApiKey().to(['read']),                 // candidate reads their own record via API key
  ]),
```

**Pipeline field addition:**
```typescript
// Add to existing Pipeline model
schedulingUrl: a.url(),   // e.g. https://calendly.com/recruiter-name/technical-interview
```

### Component Hierarchy

```
src/
├── pages/
│   └── SchedulingPage.tsx               # SCHED-001 — /schedule route

├── components/
│   └── Scheduling/
│       ├── SchedulingDashboard.tsx      # SCHED-001 — main list + filters
│       ├── InterviewCard.tsx            # SCHED-002 — single interview row/card
│       ├── InterviewStatusBadge.tsx     # SCHED-002 — status chip (color-coded)
│       ├── SchedulingFilters.tsx        # SCHED-001 — pipeline / status / date range filters
│       ├── StatusOverrideModal.tsx      # SCHED-003 — manual recruiter status update
│       │
│       └── provider/                   # Provider abstraction layer (ADR-013)
│           ├── types.ts                # SchedulingProvider interface
│           ├── CalendlyProvider.tsx    # Calendly embed/redirect implementation
│           ├── ManualProvider.tsx      # Fallback: recruiter pastes meeting link manually
│           └── index.ts               # resolveSchedulingProvider(type) factory

├── components/
│   └── Assessment/
│       └── SchedulingStep.tsx          # SCHED-004 — candidate-facing scheduling widget
│                                       # (embedded in CandidateAssessmentPage for LIVE_VIDEO stages)

├── hooks/
│   ├── useScheduledInterviews.ts       # SCHED-001 — list all interviews (recruiter)
│   ├── useScheduledInterview.ts        # SCHED-004 — single interview record (candidate)
│   └── useSchedulingProvider.ts       # SCHED-004 — resolve + render the provider widget

└── lib/
    └── scheduling/
        ├── statusTransitions.ts        # Valid status transition rules (business logic)
        └── types.ts                    # InterviewStatus enum, ScheduledInterview type
```

---

## Data Flow

### Recruiter Sets Up Scheduling (Pre-invite)

1. Recruiter opens pipeline settings (OverviewPage) and pastes their Calendly URL into `Pipeline.schedulingUrl`.
2. Field is validated as a URL before save.
3. If `schedulingUrl` is empty and the pipeline has a `LIVE_VIDEO` stage, the "Invite Candidate" button shows a tooltip: "Configure your scheduling URL to enable live video invites."

### Candidate Invited to LIVE_VIDEO Stage

1. Recruiter clicks "Invite" on a candidate from OverviewPage.
2. System creates a `ScheduledInterview` record: `status: 'INVITED'`, `schedulingUrl` copied from `Pipeline.schedulingUrl`, `schedulingProvider: 'CALENDLY'` (resolved from URL domain).
3. The invite link sent to the candidate includes their existing `inviteToken` — the scheduling step is part of the assessment flow at `/assess/:token`.

### Candidate Schedules (Assessment Flow)

1. Candidate opens `/assess/:token` and progresses to the `LIVE_VIDEO` stage.
2. `useAssessment` detects the stage mode is `LIVE_VIDEO` and that a `ScheduledInterview` record exists for this candidate + stage.
3. `SchedulingStep` component renders, resolving the provider widget via `resolveSchedulingProvider('CALENDLY')`.
4. `CalendlyProvider` renders the Calendly embed (inline widget via `<script>` embed or redirect link).
5. **MVP**: After the candidate completes scheduling in the Calendly UI (callback is hard — Calendly requires API key for full webhook), the candidate sees a confirmation screen: "Your interview has been scheduled. The recruiter will confirm shortly."
6. Recruiter manually updates status to `SCHEDULED` from the `/schedule` dashboard once they receive the Calendly email confirmation.

### Recruiter Dashboard (`/schedule`)

1. `useScheduledInterviews` subscribes to `ScheduledInterview.observeQuery()` filtered to the current owner.
2. Interviews are sorted: `SCHEDULED` (upcoming first by `scheduledAt`) → `INVITED` → `COMPLETED` → `CANCELLED/NO_SHOW`.
3. Recruiter can filter by: pipeline, status, date range.
4. Each `InterviewCard` shows: candidate name, pipeline name, stage name, status badge, scheduledAt, and a "Join Call" button (enabled when status is `SCHEDULED` and time is within 15 minutes).
5. "Join Call" navigates to the existing WebRTC video session flow for that candidate.

---

## API Design

### Queries / Subscriptions

```typescript
// Recruiter — all their interviews
client.models.ScheduledInterview.observeQuery({
  filter: { owner: { eq: currentUser.userId } }
})

// Recruiter — filter by pipeline
client.models.ScheduledInterview.list({
  filter: { pipelineId: { eq: pipelineId } }
})

// Candidate — their single interview (via API key auth)
client.models.ScheduledInterview.list({
  filter: {
    candidateId: { eq: candidateId },
    stageId: { eq: stageId },
  }
})
```

### Mutations

```typescript
// Create on invite
client.models.ScheduledInterview.create({
  candidateId, pipelineId, stageId,
  status: 'INVITED',
  schedulingUrl: pipeline.schedulingUrl,
  schedulingProvider: 'CALENDLY',
  owner: currentUser.userId,
})

// Recruiter status override (manual)
client.models.ScheduledInterview.update({
  id,
  status: newStatus,           // 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'
  scheduledAt,                 // recruiter enters from Calendly confirmation email
  meetingUrl,                  // paste the video call URL if using external video
  recruiterNotes,
})
```

---

## Provider Abstraction (`provider/types.ts`)

```typescript
export interface SchedulingProviderConfig {
  schedulingUrl: string;
  candidateName: string;
  candidateEmail?: string;
}

export interface SchedulingProvider {
  /** Unique identifier for this provider */
  type: 'CALENDLY' | 'CAL_COM' | 'MANUAL';
  /** Human-readable label */
  label: string;
  /** Render the scheduling widget or link for the candidate */
  Widget: React.FC<SchedulingProviderConfig>;
  /** Detect if a URL belongs to this provider */
  matches: (url: string) => boolean;
}

// Factory
export function resolveSchedulingProvider(url: string): SchedulingProvider {
  if (CalendlyProvider.matches(url)) return CalendlyProvider;
  if (CalComProvider.matches(url))   return CalComProvider;
  return ManualProvider; // fallback: show the raw URL as a link
}
```

**CalendlyProvider** renders a Calendly inline widget:
```html
<!-- embed pattern -->
<div class="calendly-inline-widget"
     data-url="{schedulingUrl}?name={candidateName}"
     style="min-width:320px;height:630px;" />
<script src="https://asset.calendly.com/assets/external/widget.js" async />
```

**ManualProvider** renders a plain anchor link:
```tsx
<a href={schedulingUrl} target="_blank" rel="noopener noreferrer">
  Open scheduling page →
</a>
```

---

## Status Transitions (`lib/scheduling/statusTransitions.ts`)

```typescript
const VALID_TRANSITIONS: Record<InterviewStatus, InterviewStatus[]> = {
  INVITED:    ['SCHEDULED', 'CANCELLED'],
  SCHEDULED:  ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED:  [],   // terminal
  CANCELLED:  ['INVITED'],  // recruiter re-invites
  NO_SHOW:    ['SCHEDULED', 'CANCELLED'],
};

export function canTransition(from: InterviewStatus, to: InterviewStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
```

---

## Security Considerations

- `ScheduledInterview` records are owner-scoped (recruiter's Cognito sub). Candidates read their own record via API key auth (`allow.publicApiKey().to(['read'])`).
- `schedulingUrl` is copied at invite time (snapshot) — if recruiter changes their Calendly link, existing invites still work.
- No sensitive data (no PII beyond candidate name/email) is stored in `ScheduledInterview`. The Calendly embed is an iframe with the recruiter's public scheduling URL.
- The "Join Call" button navigates to the existing WebRTC flow (VideoSession model), which is already secured.

---

## Implementation Plan

### Phase 1 — Schema + Data Layer (1 day)
1. Add `schedulingUrl` field to `Pipeline` model.
2. Add `ScheduledInterview` model with full authorization.
3. Run `npx ampx sandbox` — confirm schema deploys.
4. Run `npx tsc --noEmit`.

### Phase 2 — Provider Abstraction + SchedulingStep (1 day)
5. Write `src/lib/scheduling/types.ts` and `statusTransitions.ts`.
6. Write `src/components/Scheduling/provider/types.ts`, `CalendlyProvider.tsx`, `ManualProvider.tsx`, `index.ts`.
7. Write `src/components/Assessment/SchedulingStep.tsx` — candidate-facing scheduling widget using the provider.
8. Write `src/hooks/useScheduledInterview.ts`.
9. Integrate `SchedulingStep` into `CandidateAssessmentPage` for `LIVE_VIDEO` stages.

### Phase 3 — Recruiter Dashboard (1 day)
10. Write `src/hooks/useScheduledInterviews.ts`.
11. Write `SchedulingDashboard`, `InterviewCard`, `InterviewStatusBadge`, `SchedulingFilters`.
12. Write `StatusOverrideModal` — recruiter sets status + scheduledAt + meetingUrl manually.
13. Create `src/pages/SchedulingPage.tsx`.
14. Add `/schedule` route to `App.tsx` behind `<Authenticator>`.

### Phase 4 — Pipeline Setup UX (0.5 day)
15. Add `schedulingUrl` input field to pipeline settings on `OverviewPage.tsx`.
16. Gate the "Invite to LIVE_VIDEO" button if `schedulingUrl` is empty.
17. On invite: create `ScheduledInterview` record with status `INVITED`.

### Phase 5 — Verify (0.5 day)
18. Run `npx tsc --noEmit` — zero new errors.
19. Smoke test end-to-end: configure scheduling URL → invite candidate → open assessment → see Calendly widget → recruiter marks as SCHEDULED → Join Call appears.
20. Update `CHANGELOG.md`.

---

## Testing Plan

- **Unit:** `statusTransitions.ts` — all valid/invalid transitions tested.
- **Unit:** `resolveSchedulingProvider()` — URL matching for Calendly, Cal.com, and unknown URLs.
- **Component:** `InterviewStatusBadge` — all 5 status values render correct colors and labels.
- **Component:** `StatusOverrideModal` — only valid transitions shown in the dropdown per current status.
- **E2E (manual smoke):** Full flow from pipeline setup → candidate invite → scheduling widget → recruiter dashboard update.

---

## Performance Considerations

- `useScheduledInterviews` uses `observeQuery` (real-time subscription) — recruiters see status changes without refresh.
- Calendly inline widget loads a third-party script. Load it lazily: only inject the `<script>` tag when the `SchedulingStep` component mounts, not at app load.
- Dashboard defaults to showing interviews in the last 30 days + future. Server-side filter to avoid loading entire interview history.

---

## Open Questions

1. **Calendly embed vs. redirect**: Calendly's inline widget requires a `<script>` tag from their CDN. If CSP blocks third-party scripts, we fall back to a redirect link. Should we make embed vs. redirect a per-provider config option?
2. **Status sync automation**: For MVP, recruiters manually set `SCHEDULED` after receiving the Calendly email. Timeline for webhook-based auto-sync? (Post-MVP in current plan — confirm with user.)
3. **Video call URL source**: When `status === 'SCHEDULED'`, the recruiter sets `meetingUrl` manually. Should this auto-populate from the existing WebRTC `VideoSession` flow, or are these separate URLs?

---

## Related Documentation

- [Product Brief](../briefs/interview-scheduling.md)
- [ADR-013 — Scheduling Provider Architecture](../decisions/ADR-013-interview-scheduling-architecture.md)
- [ADR-011 — WebRTC Video Interview Architecture](../decisions/ADR-011-video-interview-webrtc.md)
- [docs/design/video-interview-architecture.md](../design/video-interview-architecture.md)
- [VideoSession + VideoSignal models](../design/data-model.md)
