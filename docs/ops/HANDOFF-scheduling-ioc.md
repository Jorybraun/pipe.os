# Handoff: Scheduling IoC — Automated Provider Sync

**Date:** 2026-03-01
**Assigned to:** Devin (or next agent)
**Tracked in:** `TASKS.md` → Epic: Scheduling IoC — Automated Provider Sync
**Full spec:** `docs/specs/scheduling-ioc-technical-spec.md` — **READ THIS FIRST**
**ADR:** `docs/decisions/ADR-014-scheduling-ioc-plugin-registry.md`
**Vision doc:** `docs/specs/scheduling-ioc-architecture.md`
**Estimated time:** ~5 days (Phases A–E)
**Status:** Ready to execute — spec, ADR, and schema relationship fixes complete.

---

## Context

The MVP scheduling system (Phases 1–5) is **fully built** — 16 source files, all complete. Recruiters paste a Calendly/Cal.com URL, candidates see an embedded scheduling widget, and the recruiter manually updates interview status.

This handoff upgrades the system to **automated sync**:
1. OAuth handshake — recruiter connects their Calendly/Cal.com account once
2. Webhook receiver — a Lambda ingests provider callbacks and auto-updates `ScheduledInterview` records
3. Plugin interface — extends the existing `SchedulingProviderDef` with server-side capabilities

> ⚠️ **IMPORTANT SCHEMA NOTE**
>
> The `ScheduledInterview` model has been **updated** (2026-03-01) to add proper Amplify relationships:
> - `belongsTo` on ScheduledInterview → Candidate, Pipeline, Stage
> - `hasMany` on Stage, Candidate, Pipeline → ScheduledInterview
> - `publicApiKey` auth updated to `['read', 'update']` (candidates can update when they book)
>
> These changes are already committed. You do NOT need to re-apply them.

> ⚠️ **VIDEO SESSION NOTE**
>
> `VideoSession` and `VideoSignal` models are **WebRTC signaling plumbing** — ephemeral records
> that exist only during a live call. They are NOT the interview record. Do NOT modify them.
> `ScheduledInterview` is the single source of truth for interview lifecycle (INVITED → SCHEDULED → COMPLETED).
> The video conference UX revamp is a separate epic — out of scope here.

---

## Pre-conditions

Before starting, confirm:
1. `npx tsc --noEmit` passes (2 pre-existing errors in `useRoleDiscovery.ts` are OK)
2. The `ScheduledInterview` model has `candidate`, `pipeline`, `stage` `belongsTo` relationships (check `amplify/data/resource.ts`)
3. You have read the full spec at `docs/specs/scheduling-ioc-technical-spec.md`
4. You have read ADR-014 at `docs/decisions/ADR-014-scheduling-ioc-plugin-registry.md`

---

## Read Before Starting

| Doc | Why |
|-----|-----|
| `docs/specs/scheduling-ioc-technical-spec.md` | Full implementation spec with code samples, data model changes, API references |
| `docs/decisions/ADR-014-scheduling-ioc-plugin-registry.md` | Architectural decision + rationale for IoC plugin registry |
| `docs/decisions/ADR-013-interview-scheduling-architecture.md` | MVP architecture — understand what already exists |
| `docs/specs/engineering-standards.md` | Lambda implementation standard (follow `questionAgent` pattern) |
| `docs/briefs/interview-scheduling.md` | Product brief with non-negotiables |

---

## Phase A — Schema + Lambda Scaffolding (1 day)

### A1. Add `SchedulingConnection` model to schema

File: `amplify/data/resource.ts`

```typescript
SchedulingConnection: a
  .model({
    recruiterId:    a.string().required(),
    providerId:     a.enum(['CALENDLY', 'CAL_COM']).required(),
    accessToken:    a.string().required(),
    refreshToken:   a.string(),
    tokenExpiry:    a.datetime(),
    accountEmail:   a.string(),
    accountName:    a.string(),
    webhookSecret:  a.string(),
    webhookId:      a.string(),
    status:         a.enum(['ACTIVE', 'EXPIRED', 'REVOKED']).required(),
    connectedAt:    a.datetime().required(),
    lastSyncAt:     a.datetime(),
  })
  .authorization((allow) => [
    allow.owner(),
    allow.resource(schedulingOAuth),
    allow.resource(schedulingWebhook),
  ]),
```

### A2. Add fields to existing models

On `ScheduledInterview`, add:
```typescript
syncSource:    a.enum(['MANUAL', 'WEBHOOK']),
lastSyncedAt:  a.datetime(),
```

On `Pipeline`, add:
```typescript
schedulingEventTypeId: a.string(),
```

### A3. Scaffold `schedulingWebhook` Lambda

Create `amplify/functions/schedulingWebhook/`:
- `resource.ts` — `defineFunction()` with env vars
- `handler.ts` — public webhook receiver (identify → verify → normalize → update)
- `types.ts` — `NormalizedSchedulingEvent`, `WebhookNormalizer` interfaces
- `providers/calendly.ts` — Calendly normalizer
- `providers/calcom.ts` — Cal.com normalizer

Follow the `questionAgent` pattern: separate handler, types, and provider logic.

### A4. Scaffold `schedulingOAuth` Lambda

Create `amplify/functions/schedulingOAuth/`:
- `resource.ts` — `defineFunction()` with Amplify secrets for `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`, etc.
- `handler.ts` — handles actions: `exchange` (code → tokens), `refresh`, `fetchEventTypes`, `disconnect`
- `types.ts` — request/response types

### A5. Wire Lambdas in `amplify/backend.ts`

Import both functions and add them to the `defineBackend()` call.

### A6. Add AppSync mutations

In `amplify/data/resource.ts`, add:
```typescript
processSchedulingWebhook: a
  .mutation()
  .arguments({ provider: a.string().required(), payload: a.json().required() })
  .returns(a.json())
  .handler(a.handler.function(schedulingWebhook))
  .authorization((allow) => [allow.publicApiKey()]),

exchangeSchedulingOAuth: a
  .mutation()
  .arguments({ action: a.string().required(), params: a.json().required() })
  .returns(a.json())
  .handler(a.handler.function(schedulingOAuth))
  .authorization((allow) => [allow.authenticated()]),
```

### A7. Verify

```bash
npx ampx sandbox    # Schema deploys cleanly
npx tsc --noEmit    # Zero new errors
```

---

## Phase B — OAuth Flow (1.5 days)

### B1. Implement `schedulingOAuth` handler

Three actions:
- `exchange`: receive OAuth code → call provider token endpoint → create `SchedulingConnection` → register webhook subscription
- `refresh`: check token expiry → refresh if needed → update `SchedulingConnection`
- `fetchEventTypes`: call provider API → return event type list

### B2. Write plugin registry

File: `src/lib/scheduling/pluginRegistry.ts`

Interface: `SchedulingPlugin` (extends existing `SchedulingProviderDef` with `getAuthUrl`, `fetchEventTypes`). See spec Section 5.1 for full interface.

Register Calendly + Cal.com plugins. Keep `resolveSchedulingProvider()` working for backward compat.

### B3. Extend CalendlyProvider + CalComProvider

Add `onBookingComplete` callback to both — triggered when the provider's embed fires a booking event (Calendly fires `calendly.event_type_viewed` → `calendly.event_scheduled` via `postMessage`).

### B4. Write connection hooks + UI

- `src/hooks/useSchedulingConnection.ts` — CRUD for `SchedulingConnection`
- `src/components/Scheduling/ConnectionSetup.tsx` — OAuth wizard
- `src/components/Scheduling/ConnectionStatusBadge.tsx` — connected/disconnected indicator

### B5. Integrate into SchedulingPage

Add `ConnectionSetup` to the `SchedulingPage.tsx` header. Show status badge.

### B6. Verify

```bash
npx tsc --noEmit    # Zero new errors
```

---

## Phase C — Webhook Receiver (1 day)

### C1. Implement webhook normalizers

- `providers/calendly.ts`: parse `invitee.created`/`invitee.canceled` → `NormalizedSchedulingEvent`
- `providers/calcom.ts`: parse `BOOKING_CREATED`/`BOOKING_CANCELLED`/`MEETING_ENDED` → `NormalizedSchedulingEvent`

Both must verify HMAC signatures using `crypto.timingSafeEqual()`.

### C2. Implement webhook router

`handler.ts` main flow:
1. Identify provider from headers
2. Look up `SchedulingConnection` for webhook secret
3. Verify HMAC signature
4. Normalize payload
5. Find matching `ScheduledInterview` by `externalEventId` or `(candidateEmail + pipelineId)`
6. Validate transition via `canTransition()`
7. Update record with `syncSource: 'WEBHOOK'`

### C3. Register webhook during OAuth

In the `exchange` action of `schedulingOAuth`, after saving tokens:
- Call Calendly `POST /webhook_subscriptions` or Cal.com `POST /v1/webhooks`
- Save `webhookId` + `webhookSecret` to `SchedulingConnection`

### C4. Update dashboard UI

- `InterviewCard.tsx`: show "auto-synced" badge when `syncSource === 'WEBHOOK'`
- `SchedulingDashboard.tsx`: show `lastSyncedAt` timestamp

### C5. Verify

```bash
npx tsc --noEmit    # Zero new errors
```

---

## Phase D — Event Type Picker + Pipeline Integration (0.5 day)

### D1. EventTypePicker component

File: `src/components/Scheduling/EventTypePicker.tsx`

Calls `exchangeSchedulingOAuth` mutation with `action: 'fetchEventTypes'`. Renders a dropdown of the recruiter's event types.

### D2. Pipeline integration

On `OverviewPage.tsx`:
- Add `EventTypePicker` to pipeline settings (visible when `SchedulingConnection` exists)
- Add "Invite to Interview" button — creates a `ScheduledInterview` record with status `INVITED`

### D3. Verify

```bash
npx tsc --noEmit    # Zero new errors
```

---

## Phase E — Verify + Ship (0.5 day)

### E1. Unit tests

- `pluginRegistry.ts` — register, resolve, getByType
- Webhook normalizers — Calendly + Cal.com payload mapping
- `canTransition()` with webhook-sourced transitions

### E2. Manual smoke test

Full flow: connect Calendly → pick event type → invite candidate → candidate books via embed → webhook fires → ScheduledInterview auto-updates to SCHEDULED.

### E3. Finalize

```bash
npx tsc --noEmit    # Zero new errors
```

Update `CHANGELOG.md`. Commit.

---

## Existing files (DO NOT break these)

| File | Status | Notes |
|------|--------|-------|
| `src/lib/scheduling/types.ts` | Keep | Add `SchedulingConnection` type alongside existing types |
| `src/lib/scheduling/statusTransitions.ts` | Keep | No changes needed |
| `src/components/Scheduling/provider/types.ts` | Keep | `resolveSchedulingProvider()` must continue to work |
| `src/components/Scheduling/provider/CalendlyProvider.tsx` | Update | Add `onBookingComplete` callback only |
| `src/components/Scheduling/provider/CalComProvider.tsx` | Update | Add `onBookingComplete` callback only |
| `src/components/Scheduling/provider/ManualProvider.tsx` | Keep | Untouched — fallback for non-OAuth users |
| `src/components/Scheduling/SchedulingDashboard.tsx` | Update | Add auto-sync indicators only |
| `src/components/Scheduling/InterviewCard.tsx` | Update | Add sync source badge only |
| `src/components/Scheduling/StatusOverrideModal.tsx` | Keep | Manual override always available |
| `src/components/Assessment/SchedulingStep.tsx` | Keep | Candidate-facing widget, no changes |
| `src/hooks/useScheduledInterviews.ts` | Keep | No changes |
| `src/hooks/useScheduledInterview.ts` | Keep | No changes |

## New files to create

| File | Purpose |
|------|---------|
| `amplify/functions/schedulingWebhook/resource.ts` | Lambda definition |
| `amplify/functions/schedulingWebhook/handler.ts` | Webhook router |
| `amplify/functions/schedulingWebhook/types.ts` | Normalized event + normalizer interfaces |
| `amplify/functions/schedulingWebhook/providers/calendly.ts` | Calendly normalizer |
| `amplify/functions/schedulingWebhook/providers/calcom.ts` | Cal.com normalizer |
| `amplify/functions/schedulingOAuth/resource.ts` | Lambda definition |
| `amplify/functions/schedulingOAuth/handler.ts` | OAuth exchange + refresh + event types |
| `amplify/functions/schedulingOAuth/types.ts` | Request/response types |
| `src/lib/scheduling/pluginRegistry.ts` | SchedulingPlugin interface + registry |
| `src/hooks/useSchedulingConnection.ts` | Hook for OAuth connection CRUD |
| `src/components/Scheduling/ConnectionSetup.tsx` | OAuth wizard UI |
| `src/components/Scheduling/ConnectionStatusBadge.tsx` | Connected/disconnected badge |
| `src/components/Scheduling/EventTypePicker.tsx` | Recruiter event type selector |

---

## Backward Compatibility

This is **purely additive**:
- Recruiters who don't connect OAuth continue manual status flow
- `resolveSchedulingProvider()` (URL-based) continues to work for embed rendering
- `ManualProvider` fallback continues for non-Calendly/Cal.com URLs
- `StatusOverrideModal` stays — recruiters can override webhook-set statuses
- Existing `ScheduledInterview` records gain `syncSource: null` (field is optional, no migration)

---

## Rollback Plan

1. Disable webhook Lambda: set `WEBHOOK_ENABLED=false` env var
2. Revoke connections: set `SchedulingConnection.status = 'REVOKED'`
3. Dashboard falls back to manual (StatusOverrideModal always works)
4. Zero impact on candidate flow (SchedulingStep renders embed independently)
