# Changelog — Interview Scheduling MVP (Phase 1)

**Commit:** [commit-id]
**Date:** 2026-02-28
**Author:** Gemini CLI
**Status:** 🟢 DONE

---

## Overview

Implemented the first phase of the Interview Scheduling epic, bringing meeting coordination directly into the Pipe platform. Recruiters can now invite candidates to book interviews via Calendly or Cal.com, and track their status from a centralized dashboard.

## Architectural Changes

### Data Model (`amplify/data/resource.ts`)
- **`Pipeline.schedulingUrl`**: Optional field to store a default provider URL for the entire pipeline.
- **`ScheduledInterview` Model**:
    - Fields: `candidateId`, `pipelineId`, `stageId`, `status`, `scheduledAt`, `meetingUrl`, `schedulingProvider`, `schedulingUrl`, `externalEventId`, `recruiterNotes`.
    - Permissions: Recruiter (Owner) full access; Candidate (Public API Key) read access for booking.
- **Status Lifecycle**: `INVITED` → `SCHEDULED` → `COMPLETED` | `CANCELLED` | `NO_SHOW`.

### Provider Architecture (`ADR-013`)
- Implemented `resolveSchedulingProvider` logic to automatically detect provider type (Calendly, Cal.com, or Manual) from the provided URL.
- Created `ALL_PROVIDERS` registry in `src/components/Scheduling/provider/`.

## New Components & Hooks

### Recruiter UI
- **`SchedulingDashboard.tsx`**: Centralized hub for managing all interviews across pipelines.
- **`InterviewStatusBadge.tsx`**: Visual indicator for interview lifecycle states.
- **`StatusOverrideModal.tsx`**: Allows recruiters to manually transition status with validation.
- **`InterviewCard.tsx` / `InterviewRow.tsx`**: UI units for interview management.

### Candidate UI
- **`SchedulingStep.tsx`**: Integrated booking widget that renders in `LIVE_VIDEO` stages. Supports Calendly script injection and Cal.com iframes.

### Hooks
- **`useScheduledInterviews`**: Recruiter-facing hook with real-time `observeQuery` subscriptions and update mutations.
- **`useScheduledInterview`**: Candidate-facing hook for fetching booking details using Public API key authentication.

## Integration Points
- **`CandidateProfilePage.tsx`**: Added "Live Interview" card for inviting candidates and tracking their specific booking status.
- **`OverviewPage.tsx`**: Added horizontal "Upcoming Interviews" strip for quick visibility into scheduled sessions.
- **`SidebarNav.tsx`**: Added "Calendar" icon linked to the new `/schedule` route.

## Verification Results
- **Type Check**: `npx tsc --noEmit` passed.
- **Schema**: Validated against `amplify/data/resource.ts`.
- **Manual Test**: Verified provider resolution and status transition validation.
