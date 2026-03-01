# Code Review Request — Interview Scheduling MVP (Phase 1)

**Commit:** [commit-id]
**Date:** 2026-02-28
**Author:** Gemini CLI
**Reviewers:** Quinn (QA Lead), Archer (Principal Architect)

---

## 🔎 Scope of Review

This PR implements the end-to-end interview scheduling flow (Phase 1). It includes new Amplify models, recruiter dashboard components, candidate booking widgets, and status transition logic.

### 🎯 Key Areas for Review
1.  **Amplify Schema (`amplify/data/resource.ts`)**: Validate `ScheduledInterview` model and Public API Key permissions for candidates.
2.  **Provider Resolution (`src/components/Scheduling/provider/`)**: Review `resolveSchedulingProvider` logic and registration of Calendly/Cal.com/Manual providers.
3.  **Status Transitions (`src/lib/scheduling/statusTransitions.ts`)**: Ensure `VALID_TRANSITIONS` map correctly reflects the business logic for interview lifecycles.
4.  **UI/UX Integration**: Check placement of the "Live Interview" card in `CandidateProfilePage` and "Upcoming Interviews" in `OverviewPage`.

---

## 🚀 Implementation Details

- **Real-time Updates**: `useScheduledInterviews` uses `observeQuery` for live dashboard updates.
- **Provider Injection**: `CalendlyProvider` lazily injects the external script only when needed to maintain performance.
- **Type Safety**: New `InterviewStatus` and `SchedulingProvider` enums are synchronized between Amplify models and frontend logic.
- **Backward Compatibility**: `LIVE_VIDEO` stages in existing pipelines now render `SchedulingStep` instead of a blank screen when no challenges are present.

---

## ✅ Verification Checklist (QA Lead)

- [ ] `npx tsc --noEmit` passes without errors.
- [ ] No `any` types used in new scheduling code.
- [ ] Scheduling provider auto-detection works for Calendly and Cal.com URLs.
- [ ] Status transitions correctly enforce valid paths (e.g., cannot go from `COMPLETED` back to `INVITED`).
- [ ] Meeting links open in a new tab.

---

## 🛠️ Infrastructure Requirements

- **Amplify Sandbox**: Requires `npx ampx sandbox` to deploy the new `ScheduledInterview` model.
- **CSP Headers**: Production deployments may require updating Content Security Policy to allow `assets.calendly.com` and `cal.com`.
