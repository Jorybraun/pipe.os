# Code Review Request — Scheduling IoC (WIP)

**Status:** 🟡 WORK_IN_PROGRESS
**Date:** 2026-03-01
**Author:** Gemini CLI
**Context:** Revamping scheduling from a manual bridge to an automated IoC-based sync.

---

## 🔎 Current Progress

This commit captures the initial scaffolding for the **Scheduling Inversion of Control (IoC)** system.

### 🎯 Implemented So Far
1.  **Backend Foundations**:
    *   `SchedulingConnection` and `ScheduledInterview` updates in `amplify/data/resource.ts`.
    *   Scaffolded `schedulingOAuth` and `schedulingWebhook` Lambda functions.
    *   Manual DynamoDB grants in `amplify/backend.ts`.
2.  **Frontend Logic**:
    *   `pluginRegistry.ts` for managing interchangeable providers.
    *   `useSchedulingConnection` hook for managing OAuth state.
    *   `ConnectionSetup` and `ConnectionStatusBadge` UI components.
3.  **Cleanup**:
    *   Removed `VideoShell` integration from `CandidateProfilePage` (temporary).

---

## 🛑 Pending & Security Blockers

The following items **must** be addressed before this feature is marked as DONE:

1.  **Smoke Test (Registry Pattern)**: The registry resolution and registration logic need empirical verification via a test script.
2.  **Webhook Validation**: The `schedulingWebhook` Lambda currently lacks HMAC signature verification.
3.  **Token Security**: Tokens must remain server-side; currently auditing for potential frontend leakage.
4.  **Data Fetching**: Optimize `SchedulingDashboard` to avoid N+1 fetches.

---

## ✅ Verification Checklist (WIP)

- [x] Schema builds without errors.
- [x] Registry pattern successfully decouples Cal.com and Calendly.
- [ ] **TODO**: Run `scripts/smoke-test-registry.ts`
- [ ] OAuth flow tested end-to-end.
- [ ] Webhook sync tested with live data.
