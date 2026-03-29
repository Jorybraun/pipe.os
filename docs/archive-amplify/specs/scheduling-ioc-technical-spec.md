# Technical Specification — Scheduling IoC: Automated Provider Sync

**Date:** 2026-03-01
**Author:** Archer (Principal Architect)
**Handoff:** Devin (Staff Engineer)
**Status:** Proposed

**Vision doc:** [docs/specs/scheduling-ioc-architecture.md](scheduling-ioc-architecture.md)
**ADR:** [ADR-014 — Scheduling IoC: Plugin Registry + Webhook Automation](../decisions/ADR-014-scheduling-ioc-plugin-registry.md)
**Prereq:** [Interview Scheduling MVP](interview-scheduling.md) (complete — all 5 phases shipped)
**Brief:** [docs/briefs/interview-scheduling.md](../briefs/interview-scheduling.md)

---

## 1. Overview

The MVP scheduling system (Phases 1–5) works but relies on **manual status sync**: the recruiter receives a Calendly email notification then manually updates the interview status in Pipe. This spec upgrades the system to an **Automated Sync** architecture using:

1. **OAuth handshake** — recruiter connects their Calendly/Cal.com account once
2. **Webhook receiver** — a Lambda that ingests provider callbacks and auto-updates `ScheduledInterview` records
3. **Plugin interface upgrade** — extends the existing `SchedulingProviderDef` with server-side capabilities (auth flow, webhook normalization, event type discovery)

The core pattern is **Inversion of Control**: the Pipe application never imports provider-specific logic directly. The `SchedulingRegistry` resolves the correct plugin at runtime based on the recruiter's `SchedulingConnection`.

---

## 2. What Already Exists (MVP Baseline)

Before building, Devin must understand what's already shipped. Here is the complete inventory:

| Layer | File | Status | Notes |
|-------|------|--------|-------|
| **Schema** | `amplify/data/resource.ts` → `ScheduledInterview` | Complete | 11 fields, owner + publicApiKey auth |
| **Schema** | `amplify/data/resource.ts` → `Pipeline.schedulingUrl` | Complete | URL field on pipeline |
| **Types** | `src/lib/scheduling/types.ts` | Complete | `InterviewStatus`, `SchedulingProvider`, `ScheduledInterview` exports |
| **Transitions** | `src/lib/scheduling/statusTransitions.ts` | Complete | `canTransition()`, `getAllowedTransitions()` — client-side only |
| **Provider interface** | `src/components/Scheduling/provider/types.ts` | Complete | `SchedulingProviderDef`, `resolveSchedulingProvider()` |
| **Calendly embed** | `src/components/Scheduling/provider/CalendlyProvider.tsx` | Complete | Lazy `<script>` inject + inline widget |
| **Cal.com embed** | `src/components/Scheduling/provider/CalComProvider.tsx` | Complete | Plain iframe |
| **Manual fallback** | `src/components/Scheduling/provider/ManualProvider.tsx` | Complete | Anchor link |
| **Provider barrel** | `src/components/Scheduling/provider/index.ts` | Complete | `ALL_PROVIDERS` array, re-exports |
| **Dashboard** | `src/components/Scheduling/SchedulingDashboard.tsx` | Complete | 167 lines, observeQuery subscription, N+1 enrichment |
| **Interview card** | `src/components/Scheduling/InterviewCard.tsx` | Complete | Join button (±15 min), edit → StatusOverrideModal |
| **Status badge** | `src/components/Scheduling/InterviewStatusBadge.tsx` | Complete | 5 states, color-coded |
| **Filters** | `src/components/Scheduling/SchedulingFilters.tsx` | Complete | Pipeline, status, date range |
| **Override modal** | `src/components/Scheduling/StatusOverrideModal.tsx` | Complete | Respects `canTransition()` |
| **Candidate step** | `src/components/Assessment/SchedulingStep.tsx` | Complete | 5-state FSM, provider widget embed |
| **Page** | `src/pages/SchedulingPage.tsx` | Complete | Thin wrapper |
| **Hook (recruiter)** | `src/hooks/useScheduledInterviews.ts` | Complete | `observeQuery` + `updateStatus()` |
| **Hook (candidate)** | `src/hooks/useScheduledInterview.ts` | Complete | API-key `list()` filtered by (candidateId, stageId) |

**What's missing from MVP (gaps this spec fills):**

1. No OAuth connection — recruiter pastes URL manually
2. No webhook receiver — status updates are manual
3. No `SchedulingConnection` model — no token storage
4. No server-side status transition enforcement
5. No "Invite to Interview" button on OverviewPage (records created elsewhere)
6. `SchedulingDashboard` has N+1 enrichment problem (loads all pipelines/candidates/stages separately)
7. No event type discovery (recruiter chooses exact Calendly event type from their account)

---

## 3. System Architecture

### 3.1 New AWS Resources

| Resource | Type | Purpose |
|----------|------|---------|
| `SchedulingConnection` | Amplify Data model | Stores recruiter's OAuth tokens per provider |
| `schedulingWebhook` | Lambda function | Public-facing webhook receiver for Calendly/Cal.com callbacks |
| `schedulingOAuth` | Lambda function | Handles OAuth code exchange + token refresh |
| `processSchedulingWebhook` | AppSync mutation | Lambda-backed mutation the webhook Lambda calls to update records |

### 3.2 Component Architecture

```
amplify/
├── data/resource.ts                              # Add SchedulingConnection model
└── functions/
    ├── schedulingWebhook/                        # NEW — public webhook receiver
    │   ├── resource.ts
    │   ├── handler.ts                            # Route → normalize → update
    │   ├── types.ts
    │   └── providers/
    │       ├── calendly.ts                       # Calendly webhook normalizer
    │       └── calcom.ts                         # Cal.com webhook normalizer
    └── schedulingOAuth/                          # NEW — OAuth code exchange
        ├── resource.ts
        ├── handler.ts
        └── types.ts

src/
├── lib/scheduling/
│   ├── types.ts                                  # UPDATE — add SchedulingConnection type
│   ├── statusTransitions.ts                      # KEEP — no changes
│   └── pluginRegistry.ts                         # NEW — SchedulingPlugin interface + registry
│
├── components/Scheduling/
│   ├── provider/
│   │   ├── types.ts                              # UPDATE — extend SchedulingProviderDef
│   │   ├── CalendlyProvider.tsx                  # UPDATE — add onBookingComplete callback
│   │   ├── CalComProvider.tsx                    # UPDATE — add onBookingComplete callback
│   │   ├── ManualProvider.tsx                    # KEEP — no changes
│   │   └── index.ts                             # KEEP — no changes
│   │
│   ├── SchedulingDashboard.tsx                   # UPDATE — auto-refresh on webhook events
│   ├── InterviewCard.tsx                         # UPDATE — show "auto-synced" indicator
│   ├── StatusOverrideModal.tsx                   # KEEP — manual override still available
│   │
│   ├── ConnectionSetup.tsx                       # NEW — OAuth connection wizard
│   ├── EventTypePicker.tsx                       # NEW — choose Calendly event type
│   └── ConnectionStatusBadge.tsx                 # NEW — connected/disconnected indicator
│
├── hooks/
│   ├── useScheduledInterviews.ts                 # KEEP — no changes
│   ├── useScheduledInterview.ts                  # KEEP — no changes
│   └── useSchedulingConnection.ts                # NEW — read/manage OAuth connection
│
└── pages/
    ├── SchedulingPage.tsx                        # UPDATE — add connection setup section
    └── OverviewPage.tsx                          # UPDATE — add "Invite to Interview" button
```

---

## 4. Data Model Changes

### 4.1 New Model: `SchedulingConnection`

```typescript
// amplify/data/resource.ts

SchedulingConnection: a
  .model({
    recruiterId:    a.string().required(),   // Cognito sub
    providerId:     a.enum(['CALENDLY', 'CAL_COM']).required(),
    accessToken:    a.string().required(),   // Encrypted at rest (DynamoDB SSE)
    refreshToken:   a.string(),              // Nullable — some providers don't issue one
    tokenExpiry:    a.datetime(),            // When the access token expires
    accountEmail:   a.string(),              // Provider account email — for display
    accountName:    a.string(),              // Provider account name — for display
    webhookSecret:  a.string(),              // Shared secret for webhook HMAC verification
    webhookId:      a.string(),              // Provider-side webhook subscription ID (for cleanup)
    status:         a.enum(['ACTIVE', 'EXPIRED', 'REVOKED']).required(),
    connectedAt:    a.datetime().required(),
    lastSyncAt:     a.datetime(),            // Last successful webhook event processed
  })
  .authorization((allow) => [
    allow.owner(),                           // Only the recruiter who connected
    allow.resource(schedulingOAuth),         // Lambda can read/write tokens
    allow.resource(schedulingWebhook),       // Lambda can read webhook secret
  ]),
```

### 4.2 Model Updates: `ScheduledInterview`

Add two fields to the existing model:

```typescript
// New fields on ScheduledInterview
syncSource:    a.enum(['MANUAL', 'WEBHOOK']),    // How the status was last updated
lastSyncedAt:  a.datetime(),                      // When webhook last touched this record
```

### 4.3 Model Updates: `Pipeline`

The existing `schedulingUrl: a.url()` field stays. Add:

```typescript
// New field on Pipeline
schedulingEventTypeId:  a.string(),   // Provider-specific event type ID for this pipeline
```

This lets recruiters pick a specific Calendly event type (e.g. "30-min Technical Screen" vs "60-min Final Round") per pipeline, rather than using a single generic URL.

---

## 5. The SchedulingPlugin Interface

This is the core IoC contract. The existing `SchedulingProviderDef` (UI-only) is extended with server-side capabilities. Client-side and server-side share the same type system.

### 5.1 Client-Side Plugin Interface

```typescript
// src/lib/scheduling/pluginRegistry.ts

import type { FC } from 'react';

/** Configuration passed to provider widgets */
export interface SchedulingWidgetProps {
  schedulingUrl: string;
  candidateName: string;
  candidateEmail?: string;
  /** Called when the provider's embed detects a booking completion */
  onBookingComplete?: (externalEventId: string, scheduledAt: string) => void;
}

/** Event type from the provider's account (for EventTypePicker) */
export interface ProviderEventType {
  id: string;
  name: string;
  durationMinutes: number;
  url: string;
}

/** The full client-side plugin contract */
export interface SchedulingPlugin {
  /** Unique provider identifier */
  type: 'CALENDLY' | 'CAL_COM';

  /** Human-readable label */
  label: string;

  /** URL pattern matcher — used to auto-detect provider from a pasted URL */
  matches: (url: string) => boolean;

  /** The candidate-facing scheduling widget */
  Widget: FC<SchedulingWidgetProps>;

  /** OAuth authorization URL generator */
  getAuthUrl: (redirectUri: string, state: string) => string;

  /** Fetch event types from the provider API (requires access token) */
  fetchEventTypes?: (accessToken: string) => Promise<ProviderEventType[]>;
}

/** Registry: ordered list of plugins, fallback to ManualProvider */
const plugins: SchedulingPlugin[] = [];

export function registerPlugin(plugin: SchedulingPlugin): void {
  plugins.push(plugin);
}

export function resolvePlugin(url: string): SchedulingPlugin | null {
  return plugins.find(p => p.matches(url)) ?? null;
}

export function getPluginByType(type: string): SchedulingPlugin | null {
  return plugins.find(p => p.type === type) ?? null;
}

export function getAllPlugins(): readonly SchedulingPlugin[] {
  return plugins;
}
```

### 5.2 Server-Side Webhook Normalizer Interface

```typescript
// amplify/functions/schedulingWebhook/types.ts

/** Normalized interview event from any provider */
export interface NormalizedSchedulingEvent {
  externalEventId: string;
  status: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED';
  scheduledAt: string;         // ISO 8601
  meetingUrl?: string;
  candidateEmail: string;
  candidateName?: string;
  providerData: Record<string, unknown>;  // Raw payload for debugging
}

/** Each provider implements this normalizer */
export interface WebhookNormalizer {
  providerId: 'CALENDLY' | 'CAL_COM';

  /** Verify webhook signature — returns true if valid */
  verifySignature: (payload: string, signature: string, secret: string) => boolean;

  /** Extract the provider ID from raw headers/payload (for routing) */
  identifyProvider: (headers: Record<string, string>) => boolean;

  /** Convert raw webhook payload to normalized event */
  normalize: (payload: unknown) => NormalizedSchedulingEvent;
}
```

---

## 6. OAuth Flow

### 6.1 Sequence

```
Recruiter clicks "Connect Calendly" on /schedule
    │
    ▼
ConnectionSetup.tsx → generates OAuth URL via plugin.getAuthUrl()
    │
    ▼
Redirect to Calendly's OAuth consent screen
    │
    ▼
Calendly redirects back to /schedule?code=XXX&state=YYY
    │
    ▼
Frontend calls schedulingOAuth Lambda mutation with { code, redirectUri, providerId }
    │
    ▼
Lambda exchanges code for access_token + refresh_token
    │
    ▼
Lambda creates/updates SchedulingConnection record
    │
    ▼
Lambda registers webhook subscription with provider API
    │
    ▼
Frontend shows "Connected ✓" badge
```

### 6.2 OAuth Configuration

Calendly and Cal.com OAuth credentials are stored as Amplify secrets:

```bash
npx ampx sandbox secret set CALENDLY_CLIENT_ID
npx ampx sandbox secret set CALENDLY_CLIENT_SECRET
npx ampx sandbox secret set CALCOM_CLIENT_ID
npx ampx sandbox secret set CALCOM_CLIENT_SECRET
```

### 6.3 Token Refresh

The `schedulingOAuth` Lambda performs automatic token refresh:
- Before any API call, check `SchedulingConnection.tokenExpiry`
- If expired (or within 5 minutes of expiry), use `refreshToken` to get a new `accessToken`
- Update `SchedulingConnection` with new tokens + expiry
- If refresh fails, set `SchedulingConnection.status = 'EXPIRED'` and surface error in UI

---

## 7. Webhook Router

### 7.1 Lambda Architecture

The webhook receiver is a single Lambda function with a public-facing URL (Lambda Function URL or API Gateway). It must be unauthenticated (external providers can't authenticate to Cognito).

```typescript
// amplify/functions/schedulingWebhook/handler.ts — pseudocode

export async function handler(event: APIGatewayProxyEvent) {
  // 1. Parse raw body
  const rawBody = event.body;
  const headers = event.headers;

  // 2. Identify provider from headers
  const normalizer = resolveNormalizer(headers);
  if (!normalizer) return { statusCode: 400, body: 'Unknown provider' };

  // 3. Verify webhook signature
  //    Look up SchedulingConnection by provider to get webhookSecret
  const connection = await findConnectionByWebhookContext(headers, normalizer);
  if (!connection) return { statusCode: 404, body: 'No connection found' };

  const isValid = normalizer.verifySignature(rawBody, headers['x-signature'] ?? '', connection.webhookSecret);
  if (!isValid) return { statusCode: 401, body: 'Invalid signature' };

  // 4. Normalize the payload
  const normalized = normalizer.normalize(JSON.parse(rawBody));

  // 5. Find matching ScheduledInterview by externalEventId OR (candidateEmail + pipelineId)
  const interview = await findScheduledInterview(normalized, connection);
  if (!interview) {
    // Log but don't fail — event may be for a booking not initiated from Pipe
    console.log('[schedulingWebhook] No matching interview found', { externalEventId: normalized.externalEventId });
    return { statusCode: 200, body: 'No matching interview' };
  }

  // 6. Validate status transition
  if (!canTransition(interview.status, normalized.status)) {
    console.warn('[schedulingWebhook] Invalid transition', {
      from: interview.status,
      to: normalized.status,
    });
    return { statusCode: 200, body: 'Transition not allowed' };
  }

  // 7. Update ScheduledInterview
  await updateScheduledInterview(interview.id, {
    status: normalized.status,
    scheduledAt: normalized.scheduledAt,
    meetingUrl: normalized.meetingUrl,
    externalEventId: normalized.externalEventId,
    syncSource: 'WEBHOOK',
    lastSyncedAt: new Date().toISOString(),
  });

  // 8. Update connection lastSyncAt
  await updateConnection(connection.id, {
    lastSyncAt: new Date().toISOString(),
  });

  return { statusCode: 200, body: 'OK' };
}
```

### 7.2 Webhook Identification

| Provider | Header Signal | Signature Header |
|----------|---------------|-----------------|
| Calendly | `User-Agent: Calendly-Webhook` or `x-calendly-hook-id` present | `Calendly-Webhook-Signature` |
| Cal.com | `x-cal-signature-256` present | `x-cal-signature-256` |

### 7.3 Calendly Webhook Normalizer

```typescript
// amplify/functions/schedulingWebhook/providers/calendly.ts

import type { WebhookNormalizer, NormalizedSchedulingEvent } from '../types';
import crypto from 'crypto';

export const calendlyNormalizer: WebhookNormalizer = {
  providerId: 'CALENDLY',

  identifyProvider(headers) {
    return 'calendly-webhook-signature' in headers
      || (headers['user-agent'] ?? '').includes('Calendly');
  },

  verifySignature(payload, signature, secret) {
    // Calendly uses HMAC SHA-256
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  },

  normalize(payload: unknown): NormalizedSchedulingEvent {
    const p = payload as CalendlyWebhookPayload;
    const invitee = p.payload?.invitee ?? p.payload?.scheduled_event?.invitees?.[0];

    return {
      externalEventId: p.payload?.uri ?? p.payload?.scheduled_event?.uri ?? '',
      status: mapCalendlyEvent(p.event),
      scheduledAt: p.payload?.scheduled_event?.start_time ?? '',
      meetingUrl: p.payload?.scheduled_event?.location?.join_url ?? undefined,
      candidateEmail: invitee?.email ?? '',
      candidateName: invitee?.name ?? undefined,
      providerData: p as Record<string, unknown>,
    };
  },
};

function mapCalendlyEvent(event: string): 'SCHEDULED' | 'CANCELLED' | 'COMPLETED' {
  switch (event) {
    case 'invitee.created': return 'SCHEDULED';
    case 'invitee.canceled': return 'CANCELLED';
    default: return 'SCHEDULED';
  }
}
```

### 7.4 Cal.com Webhook Normalizer

```typescript
// amplify/functions/schedulingWebhook/providers/calcom.ts

import type { WebhookNormalizer, NormalizedSchedulingEvent } from '../types';
import crypto from 'crypto';

export const calcomNormalizer: WebhookNormalizer = {
  providerId: 'CAL_COM',

  identifyProvider(headers) {
    return 'x-cal-signature-256' in headers;
  },

  verifySignature(payload, signature, secret) {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  },

  normalize(payload: unknown): NormalizedSchedulingEvent {
    const p = payload as CalComWebhookPayload;
    const attendee = p.payload?.attendees?.[0];

    return {
      externalEventId: String(p.payload?.bookingId ?? p.payload?.id ?? ''),
      status: mapCalComTrigger(p.triggerEvent),
      scheduledAt: p.payload?.startTime ?? '',
      meetingUrl: p.payload?.metadata?.videoCallUrl ?? undefined,
      candidateEmail: attendee?.email ?? '',
      candidateName: attendee?.name ?? undefined,
      providerData: p as Record<string, unknown>,
    };
  },
};

function mapCalComTrigger(trigger: string): 'SCHEDULED' | 'CANCELLED' | 'COMPLETED' {
  switch (trigger) {
    case 'BOOKING_CREATED': return 'SCHEDULED';
    case 'BOOKING_CANCELLED': return 'CANCELLED';
    case 'MEETING_ENDED': return 'COMPLETED';
    default: return 'SCHEDULED';
  }
}
```

---

## 8. Event Type Discovery

When a recruiter connects their Calendly account, Pipe can fetch their event types (e.g. "30-min Technical Interview", "60-min Final Round") and let them assign one per pipeline.

### 8.1 API Call

```typescript
// Calendly: GET /event_types with Bearer token
const response = await fetch('https://api.calendly.com/event_types?user=<user_uri>', {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const { collection } = await response.json();
// Returns: [{ uri, name, duration, scheduling_url, ... }]
```

### 8.2 UI Integration

```typescript
// src/components/Scheduling/EventTypePicker.tsx
// Rendered inside pipeline settings (OverviewPage) when a SchedulingConnection exists

export function EventTypePicker({
  connection,
  currentEventTypeId,
  onSelect,
}: EventTypePickerProps): JSX.Element {
  const [eventTypes, setEventTypes] = useState<ProviderEventType[]>([]);

  useEffect(() => {
    // Call schedulingOAuth Lambda to fetch event types using stored token
    // (Tokens never leave the server — frontend calls a mutation, Lambda calls provider API)
  }, [connection]);

  return (
    <select value={currentEventTypeId} onChange={(e) => onSelect(e.target.value)}>
      {eventTypes.map(et => (
        <option key={et.id} value={et.id}>
          {et.name} ({et.durationMinutes} min)
        </option>
      ))}
    </select>
  );
}
```

---

## 9. Security Considerations

### 9.1 Token Storage

- OAuth tokens are stored in `SchedulingConnection` in DynamoDB
- DynamoDB Server-Side Encryption (SSE) is enabled by default in AWS — tokens are encrypted at rest
- Tokens are **never** sent to the frontend — all token operations happen in Lambda
- `SchedulingConnection` has `allow.owner()` + `allow.resource(...)` auth only — candidates cannot read it

### 9.2 Webhook Verification

- Every incoming webhook is verified against the `webhookSecret` stored in `SchedulingConnection`
- HMAC SHA-256 with `crypto.timingSafeEqual()` to prevent timing attacks
- Unverified payloads return 401 and are logged (not processed)

### 9.3 Token Refresh Security

- Refresh tokens are single-use (Calendly) or scoped (Cal.com)
- If refresh fails, `SchedulingConnection.status` is set to `EXPIRED`
- UI shows a reconnection prompt — recruiter must re-authorize

### 9.4 Webhook Endpoint Security

- The webhook Lambda URL is public (providers can't authenticate to Cognito)
- Protection layers: HMAC verification + idempotency on `externalEventId` + `canTransition()` guard
- Rate limiting: API Gateway throttle at 100 req/sec (Calendly sends ≤1 webhook per booking)

---

## 10. Implementation Phases

### Phase A — Schema + Lambda Scaffolding (1 day)

| # | Task | Est |
|---|------|-----|
| A1 | Add `SchedulingConnection` model to `amplify/data/resource.ts` | 30 min |
| A2 | Add `syncSource`, `lastSyncedAt` fields to `ScheduledInterview` | 15 min |
| A3 | Add `schedulingEventTypeId` field to `Pipeline` | 10 min |
| A4 | Scaffold `amplify/functions/schedulingWebhook/` (resource.ts, handler.ts, types.ts) | 45 min |
| A5 | Scaffold `amplify/functions/schedulingOAuth/` (resource.ts, handler.ts, types.ts) | 45 min |
| A6 | Wire both Lambdas in `amplify/backend.ts` | 15 min |
| A7 | Add `processSchedulingWebhook` and `exchangeSchedulingOAuth` mutations to schema | 30 min |
| A8 | Run `npx ampx sandbox` — confirm new schema deploys | 15 min |
| A9 | Run `npx tsc --noEmit` — zero new errors | 10 min |

### Phase B — OAuth Flow (1.5 days)

| # | Task | Est |
|---|------|-----|
| B1 | Implement `schedulingOAuth` handler: `exchange` action (code → tokens) | 2 hr |
| B2 | Implement `schedulingOAuth` handler: `refresh` action (refresh token) | 1 hr |
| B3 | Implement `schedulingOAuth` handler: `fetchEventTypes` action | 1 hr |
| B4 | Write `src/lib/scheduling/pluginRegistry.ts` — SchedulingPlugin interface + registry | 1 hr |
| B5 | Extend `CalendlyProvider` — add `getAuthUrl()` and `onBookingComplete` callback | 1 hr |
| B6 | Extend `CalComProvider` — add `getAuthUrl()` and `onBookingComplete` callback | 45 min |
| B7 | Write `src/hooks/useSchedulingConnection.ts` — read/create/disconnect connection | 1 hr |
| B8 | Write `src/components/Scheduling/ConnectionSetup.tsx` — OAuth wizard UI | 2 hr |
| B9 | Write `src/components/Scheduling/ConnectionStatusBadge.tsx` | 30 min |
| B10 | Integrate `ConnectionSetup` into `SchedulingPage.tsx` header | 30 min |

### Phase C — Webhook Receiver (1 day)

| # | Task | Est |
|---|------|-----|
| C1 | Implement Calendly webhook normalizer (`providers/calendly.ts`) | 1.5 hr |
| C2 | Implement Cal.com webhook normalizer (`providers/calcom.ts`) | 1 hr |
| C3 | Implement webhook router handler — identify → verify → normalize → update | 2 hr |
| C4 | Register webhook subscription during OAuth flow (in `schedulingOAuth` Lambda) | 1 hr |
| C5 | Add "auto-synced" indicator to `InterviewCard.tsx` (show sync source badge) | 30 min |
| C6 | Add `lastSyncedAt` display to `SchedulingDashboard.tsx` | 30 min |

### Phase D — Event Type Picker + Pipeline Integration (0.5 day)

| # | Task | Est |
|---|------|-----|
| D1 | Write `src/components/Scheduling/EventTypePicker.tsx` | 1.5 hr |
| D2 | Integrate `EventTypePicker` into pipeline settings on `OverviewPage.tsx` | 1 hr |
| D3 | Add "Invite to Interview" button to `OverviewPage.tsx` — creates `ScheduledInterview` record | 1 hr |

### Phase E — Verify + Ship (0.5 day)

| # | Task | Est |
|---|------|-----|
| E1 | Run `npx tsc --noEmit` — zero new errors | 10 min |
| E2 | Unit tests: `pluginRegistry.ts` — register, resolve, getByType | 30 min |
| E3 | Unit tests: webhook normalizers — Calendly + Cal.com payload mapping | 1 hr |
| E4 | Unit tests: `canTransition` with webhook-sourced transitions | 15 min |
| E5 | Manual smoke test: connect Calendly → pick event type → invite candidate → candidate books → webhook fires → status auto-updates | 30 min |
| E6 | Update `CHANGELOG.md` | 10 min |
| E7 | Write ADR-014 (done as part of this spec — verify it's accurate) | 10 min |

**Total estimate: ~5 days engineering effort.**

---

## 11. Calendly API Reference

These are the specific Calendly API endpoints the Lambda functions will call:

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `https://auth.calendly.com/oauth/authorize` | GET | OAuth consent redirect | Client ID |
| `https://auth.calendly.com/oauth/token` | POST | Exchange code for tokens | Client ID + Secret |
| `https://api.calendly.com/users/me` | GET | Get user URI (needed for event types) | Bearer token |
| `https://api.calendly.com/event_types` | GET | List recruiter's event types | Bearer token |
| `https://api.calendly.com/webhook_subscriptions` | POST | Create webhook subscription | Bearer token |
| `https://api.calendly.com/webhook_subscriptions/:id` | DELETE | Remove webhook on disconnect | Bearer token |

Calendly webhook events: `invitee.created`, `invitee.canceled`.

### Cal.com API Reference

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `https://app.cal.com/auth/oauth2/authorize` | GET | OAuth consent redirect | Client ID |
| `https://app.cal.com/api/auth/oauth/token` | POST | Exchange code for tokens | Client ID + Secret |
| `https://api.cal.com/v1/event-types` | GET | List event types | Bearer token |
| `https://api.cal.com/v1/webhooks` | POST | Create webhook | Bearer token |
| `https://api.cal.com/v1/webhooks/:id` | DELETE | Remove webhook | Bearer token |

Cal.com webhook triggers: `BOOKING_CREATED`, `BOOKING_CANCELLED`, `MEETING_ENDED`.

---

## 12. Open Questions

1. **Webhook endpoint hosting**: Lambda Function URL (simpler, free) vs API Gateway (rate limiting, WAF). Rec: start with Lambda Function URL for MVP, upgrade to API Gateway if abuse becomes a concern.

2. **Calendly API tier**: The free Calendly plan does not support OAuth or webhooks. Recruiters need at least the Standard plan ($10/seat/month). Document this in the UI when showing the "Connect Calendly" button.

3. **Idempotency**: Calendly may send duplicate webhooks. Use `externalEventId` as an idempotency key — if the record already has that `externalEventId` and the status is the same, skip the update.

4. **Cal.com self-hosted**: Cal.com can be self-hosted. The `matches(url)` predicate needs to be extended for custom domains. Option: let recruiters manually specify their Cal.com base URL during OAuth setup.

5. **Token encryption**: DynamoDB SSE encrypts at rest, but tokens are plaintext in the table scan. For higher security, consider client-side encryption via AWS KMS before writing to DynamoDB. Rec: defer to post-MVP unless a security audit requires it.

---

## 13. Backward Compatibility

This spec is **purely additive**. No existing behavior changes:

- Recruiters who don't connect OAuth continue to use the manual status flow (paste URL, update status by hand)
- `resolveSchedulingProvider()` (URL-based) continues to work for embed rendering
- `ManualProvider` fallback continues to work for non-Calendly/Cal.com URLs
- `StatusOverrideModal` stays available — recruiters can always override webhook-set statuses manually
- Existing `ScheduledInterview` records gain `syncSource: null` (no migration needed — field is optional)

---

## 14. Rollback Plan

If the webhook or OAuth system causes issues:

1. **Disable webhook Lambda** — set environment variable `WEBHOOK_ENABLED=false` to short-circuit the handler
2. **Revoke OAuth connections** — set `SchedulingConnection.status = 'REVOKED'` for affected recruiters
3. **Dashboard falls back to manual** — `StatusOverrideModal` continues to work regardless of webhook status
4. **Zero impact on candidate flow** — `SchedulingStep` renders the embed widget independent of webhook status

---

## 15. Related Documentation

- [Vision: Scheduling IoC Architecture](scheduling-ioc-architecture.md)
- [ADR-014: Scheduling IoC Plugin Registry](../decisions/ADR-014-scheduling-ioc-plugin-registry.md)
- [ADR-013: Interview Scheduling Provider Architecture (MVP)](../decisions/ADR-013-interview-scheduling-architecture.md)
- [Product Brief: Interview Scheduling](../briefs/interview-scheduling.md)
- [MVP Scheduling Spec](interview-scheduling.md)
- [ADR-011: WebRTC Video Interview Architecture](../decisions/ADR-011-video-interview-webrtc.md)
