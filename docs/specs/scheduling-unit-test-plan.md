# Unit Test Plan — Scheduling & Notification System

**Date:** 2026-03-03
**Status:** Draft
**Scope:** 3 Lambda handlers + 2 webhook normalizers + 1 React hook

---

## Overview

This plan covers all testable units in the scheduling integration: the webhook receiver, OAuth handler, notification service, provider normalizers, and the frontend scheduling hook. Tests use **Vitest** + **aws-sdk-client-mock** for Lambda functions and **@testing-library/react** for the hook.

### Test Infrastructure Setup Required

Each Lambda function package needs dev dependencies added:

```bash
# For each function directory:
npm install --save-dev vitest aws-sdk-client-mock aws-sdk-client-mock-jest
```

The root `vitest.config.ts` already supports `globals: true` + `jsdom`. Lambda tests should either use the root config or define a minimal per-function `vitest.config.ts` with `environment: 'node'`.

---

## 1. Calendly Normalizer (`schedulingWebhook/providers/calendly.ts`)

**File:** `schedulingWebhook/providers/calendly.test.ts`
**Existing stubs:** 89 lines (decent coverage, needs expansion)

### 1.1 `identifyProvider(headers)`

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 1 | Identifies via `calendly-webhook-signature` header | `{ 'calendly-webhook-signature': 'any' }` | `true` |
| 2 | Identifies via Calendly user-agent | `{ 'user-agent': 'Calendly-Hookshot/1.0' }` | `true` |
| 3 | Rejects non-Calendly headers | `{ 'user-agent': 'curl/7.68' }` | `false` |
| 4 | Rejects empty headers | `{}` | `false` |
| 5 | Case sensitivity — header keys are always lowercase from Lambda Function URL | `{ 'CALENDLY-WEBHOOK-SIGNATURE': 'x' }` — should test whether `in` operator matches (it won't — confirm behavior) | `false` |

### 1.2 `verifySignature(payload, signature, secret)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Valid `t=<ts>,v1=<hex>` format — correct HMAC | `true` |
| 2 | Valid `t=<ts>,v1=<hex>` format — wrong HMAC | `false` |
| 3 | Raw hex fallback — correct HMAC (no `t=`/`v1=` parts) | `true` |
| 4 | Raw hex fallback — wrong HMAC | `false` |
| 5 | Empty signature string | `false` |
| 6 | Empty secret string | `false` |
| 7 | Both empty | `false` |
| 8 | Tampered payload after signing | `false` |
| 9 | Signature with extra whitespace: `t= 123,v1= abc` — test parsing resilience | `false` (startsWith won't match) |
| 10 | Malformed: `v1=abc` only (no `t=` part) | `false` (tPart is undefined, falls through to raw hex fallback) |
| 11 | Signature with additional unknown parts: `t=123,v1=abc,v2=def` | should still work — `find()` picks correct parts |

### 1.3 `normalize(payload)`

| # | Test Case | Key Assertions |
|---|-----------|----------------|
| 1 | Standard `invitee.created` with email/name on `payload` root | `status === 'SCHEDULED'`, email from `payload.email`, name from `payload.name` |
| 2 | `invitee.canceled` event | `status === 'CANCELLED'` |
| 3 | Email on `payload.invitee.email` (legacy shape) | Falls back to `invitee.email` when `payload.email` is absent |
| 4 | Email on `payload.scheduled_event.invitees[0].email` (deepest fallback) | Falls back correctly |
| 5 | No email anywhere | `candidateEmail === ''` |
| 6 | `externalEventId` from `scheduled_event.uri` (preferred) | Uses `scheduled_event.uri` |
| 7 | `externalEventId` fallback to `payload.uri` (invitee URI) | When `scheduled_event.uri` is absent |
| 8 | `meetingUrl` from `scheduled_event.location.join_url` | Correct extraction |
| 9 | Missing `scheduled_event.location` | `meetingUrl === undefined` |
| 10 | Unknown event type (e.g., `invitee.updated`) | Defaults to `'SCHEDULED'` |
| 11 | Completely empty payload `{ event: '', payload: {} }` | Returns defaults without throwing |

---

## 2. Cal.com Normalizer (`schedulingWebhook/providers/calcom.ts`)

**File:** `schedulingWebhook/providers/calcom.test.ts`
**Existing stubs:** 75 lines (good coverage)

### 2.1 `identifyProvider(headers)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Has `x-cal-signature-256` header | `true` |
| 2 | No Cal.com headers | `false` |
| 3 | Empty headers | `false` |

### 2.2 `verifySignature(payload, signature, secret)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Valid HMAC SHA-256 | `true` |
| 2 | Invalid signature | `false` |
| 3 | Empty signature | `false` |
| 4 | Empty secret | `false` |
| 5 | Mismatched length (triggers `timingSafeEqual` catch) | `false` |

### 2.3 `normalize(payload)`

| # | Test Case | Key Assertions |
|---|-----------|----------------|
| 1 | `BOOKING_CREATED` → `SCHEDULED` | Status mapping, email from first attendee |
| 2 | `BOOKING_CANCELLED` → `CANCELLED` | Status mapping |
| 3 | `MEETING_ENDED` → `COMPLETED` | Status mapping |
| 4 | Unknown trigger event | Defaults to `'SCHEDULED'` |
| 5 | `externalEventId` from `bookingId` (preferred over `id`) | `String(bookingId)` |
| 6 | `externalEventId` falls back to `id` when no `bookingId` | Correct |
| 7 | No attendees | `candidateEmail === ''`, `candidateName === undefined` |
| 8 | `meetingUrl` from `metadata.videoCallUrl` | Correct extraction |
| 9 | No metadata | `meetingUrl === undefined` |

---

## 3. Webhook Handler (`schedulingWebhook/handler.ts`)

**File:** `schedulingWebhook/handler.test.ts`
**Existing stubs:** 107 lines (mock approach needs fixing — uses incorrect `any` lambda filter)

### 3.1 `resolveNormalizer(headers)` (tested indirectly via handler)

| # | Test Case | Expected Response |
|---|-----------|-------------------|
| 1 | No matching normalizer (unknown headers) | `400 — Unknown provider` |
| 2 | Calendly headers → resolves `calendlyNormalizer` | Proceeds to step 2 |
| 3 | Cal.com headers → resolves `calcomNormalizer` | Proceeds to step 2 |

### 3.2 `canTransition(from, to)` (tested indirectly)

| # | Transition | Expected |
|---|-----------|----------|
| 1 | `INVITED → SCHEDULED` | ✅ Allowed |
| 2 | `INVITED → CANCELLED` | ✅ Allowed |
| 3 | `SCHEDULED → COMPLETED` | ✅ Allowed |
| 4 | `SCHEDULED → CANCELLED` | ✅ Allowed |
| 5 | `SCHEDULED → NO_SHOW` | ✅ Allowed |
| 6 | `COMPLETED → SCHEDULED` | ❌ Rejected |
| 7 | `CANCELLED → INVITED` | ✅ Allowed (re-invite) |
| 8 | `NO_SHOW → SCHEDULED` | ✅ Allowed |
| 9 | `INVITED → COMPLETED` | ❌ Rejected (must go through SCHEDULED) |
| 10 | Unknown status → anything | ❌ Rejected (undefined key) |

### 3.3 `findConnectionByProvider(providerId)` (tested indirectly)

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | ACTIVE connection exists for provider | Returns connection record |
| 2 | Only REVOKED connections exist | Returns `null` |
| 3 | No connections at all | Returns `null` |
| 4 | Multiple ACTIVE connections (shouldn't happen) | Returns first |

### 3.4 `findScheduledInterview(normalized)` (critical — regression tests)

| # | Test Case | DynamoDB Mock Setup | Expected |
|---|-----------|---------------------|----------|
| 1 | Match by `externalEventId` (primary path) | Interview with matching externalEventId | Returns interview |
| 2 | No `externalEventId` match → email fallback finds INVITED interview | Candidate with email → ScheduledInterview with status INVITED | Returns interview |
| 3 | Email fallback: multiple candidates with same email, only one has INVITED interview | 2 candidates, 1 INVITED interview | Returns correct interview |
| 4 | Email fallback: candidate found but no INVITED interviews | Candidate exists, interview is SCHEDULED | Returns `null` |
| 5 | No `externalEventId` and no email | Empty normalized event | Returns `null` |
| 6 | Email fallback: no candidates with that email | No candidates | Returns `null` |
| 7 | **Regression: No Limit:1 on Candidate scan** | Multiple candidates | All candidates checked |
| 8 | **Regression: No Limit:1 on Interview email fallback scan** | Multiple interviews | All interviews checked |

### 3.5 Full Handler Integration Tests

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | `WEBHOOK_ENABLED=false` → 503 | Service unavailable response |
| 2 | Missing body → JSON parse error → 500 | Error caught |
| 3 | Valid Calendly `invitee.created` → full happy path (connection found, HMAC valid, interview matched, transition valid) | `200 — Interview updated` |
| 4 | Valid Calendly `invitee.canceled` → SCHEDULED→CANCELLED | `200 — Interview updated` |
| 5 | No active connection for provider | `404 — No active connection found` |
| 6 | Webhook secret configured but no signature header | `401 — Missing webhook signature` |
| 7 | Invalid HMAC signature | `401 — Invalid webhook signature` |
| 8 | No webhook secret on connection → skip HMAC | Proceeds without verification |
| 9 | No matching interview found | `200 — No matching interview found` |
| 10 | Invalid status transition (e.g., COMPLETED→SCHEDULED) | `200 — Transition not allowed` |
| 11 | DynamoDB error during update → caught → 500 | Error response |
| 12 | Connection `lastSyncAt` updated after successful processing | `UpdateCommand` sent for connection |
| 13 | `externalEventId` written to interview record on first booking | `UpdateCommand` includes `externalEventId` |
| 14 | `meetingUrl` conditionally included when present | Update expression includes `meetingUrl` |
| 15 | `meetingUrl` absent → not in update expression | No `meetingUrl` attribute |

---

## 4. Notification Service (`notificationService/handler.ts`)

**File:** `notificationService/handler.test.ts`
**Existing stubs:** 129 lines (3 tests, need expansion)

### 4.1 `processStreamRecord(record)` — ScheduledInterview stream

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Status → `INVITED` (new interview) | Calls `sendNotification()` → sends SES email to candidate |
| 2 | Status → `INVITED` but was already `INVITED` (no change) | No email sent |
| 3 | Status → `SCHEDULED` (from INVITED) | Calls `notifyRecruiterOfStatusChange('SCHEDULED')` |
| 4 | Status → `SCHEDULED` but was already `SCHEDULED` | No email sent |
| 5 | Status → `CANCELLED` (from SCHEDULED) | Calls `notifyRecruiterOfStatusChange('CANCELLED')` |
| 6 | Status → `CANCELLED` but was already `CANCELLED` | No email sent |
| 7 | No `NewImage` in record | Silently returns |
| 8 | Unrecognized `eventSourceARN` | Logs and returns |

### 4.2 `processStreamRecord(record)` — Candidate stream

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | INSERT + status=INVITED + has email | Sends candidate invite email |
| 2 | MODIFY event (not INSERT) | Skips — no email |
| 3 | INSERT + status=ACTIVE (not INVITED) | Skips |
| 4 | INSERT + INVITED + no email | Skips with warning |
| 5 | INSERT + INVITED + no stages in pipeline | Sends email with pipeline-level context |

### 4.3 `notifyRecruiterOfStatusChange(interview, newStatus)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | SCHEDULED: candidate + pipeline found, Cognito returns recruiter email | SES email sent with "Interview Booked" subject |
| 2 | CANCELLED: same setup | SES email sent with "Interview Cancelled" subject |
| 3 | Pipeline owner format `sub::sub` → splits to bare sub | `AdminGetUser` called with first part |
| 4 | Pipeline owner is plain UUID (no `::`) | `AdminGetUser` called with full string |
| 5 | Missing candidate record | Logs error, no email sent |
| 6 | Missing pipeline record | Logs error, no email sent |
| 7 | `USER_POOL_ID` not set | Warning log, no email |
| 8 | Pipeline `owner` is undefined/null | Warning log, no email |
| 9 | Cognito `AdminGetUser` fails (user deleted) | Catches error, no email |
| 10 | Cognito returns user with no email attribute | Warning log, no email |
| 11 | `scheduledAt` present → formatted in email body | Email includes formatted date |
| 12 | `meetingUrl` present → included as link in body | Email includes meeting link |
| 13 | `meetingUrl` absent → no link in body | No meeting link line |
| 14 | SES error → caught, does not throw (best-effort) | Error logged, no rethrow |

### 4.4 `sendNotification(candidateId, stageId, type, interviewId?)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Type=INVITATION, LIVE_VIDEO stage with schedulingUrl | Email with booking URL |
| 2 | Type=INVITATION, ASYNC stage with inviteToken | Email with assessment URL |
| 3 | Type=SUCCESS | Email with "passed the {{stageName}}" subject |
| 4 | Type=FAILURE | Email with "Update regarding your application" |
| 5 | Missing candidate | Logs error, returns without sending |
| 6 | Missing stage | Logs error, returns without sending |
| 7 | Candidate has no email | Warning, skips send |
| 8 | Stage has custom notification templates | Uses custom template instead of default |
| 9 | With `interviewId` + type=INVITATION | Updates `emailSentAt` on ScheduledInterview |
| 10 | SES send fails | Error thrown (not best-effort for direct invites) |

### 4.5 `substituteVariables(text, vars)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | `'Hi {{name}}'` + `{ name: 'Jane' }` | `'Hi Jane'` |
| 2 | `'{{a}} and {{b}}'` + `{ a: 'X', b: 'Y' }` | `'X and Y'` |
| 3 | Unknown variable `{{unknown}}` | Kept as-is: `'{{unknown}}'` |
| 4 | Extra whitespace `{{ name }}` | Trimmed: matches `name` |
| 5 | No variables in text | Text unchanged |
| 6 | Empty text | Empty string |

### 4.6 `resolveBookingUrl(candidate, stage, pipeline, interviewId?)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | LIVE_VIDEO stage + interviewId + interview has `schedulingUrl` | `schedulingUrl?name=...&email=...` |
| 2 | LIVE_VIDEO stage + no interviewId → pipeline-level `schedulingUrl` | Pipeline URL with params |
| 3 | ASYNC stage + candidate has `inviteToken` | `appUrl/assess/{inviteToken}` |
| 4 | No inviteToken, not LIVE_VIDEO | Fallback to `appUrl` |
| 5 | LIVE_VIDEO but no schedulingUrl anywhere | Fallback to `appUrl` |
| 6 | URL encodes special characters in name/email | `encodeURIComponent` applied |

### 4.7 `findFirstStage(pipelineId)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Multiple stages → returns lowest `order` | Stage with `order: 0` |
| 2 | No stages | Returns `null` |
| 3 | DynamoDB error | Returns `null` (caught) |

### 4.8 AppSync Mutation Trigger

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | `event.arguments` with candidateId, stageId, templateType | Calls `sendNotification()` |
| 2 | Both `Records` and `arguments` present | Processes both |
| 3 | Neither `Records` nor `arguments` | Returns `{ success: true }` |

---

## 5. OAuth Handler (`schedulingOAuth/handler.ts`)

**File:** `schedulingOAuth/handler.test.ts`
**Existing stubs:** 169 lines (3 tests, need expansion)

### 5.1 Action Routing

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | `action: 'exchange'` → dispatches to `handleExchange` | Exchange flow runs |
| 2 | `action: 'refresh'` → dispatches to `handleRefresh` | Refresh flow runs |
| 3 | `action: 'fetchEventTypes'` → dispatches to `handleFetchEventTypes` | Event types fetched |
| 4 | `action: 'disconnect'` → dispatches to `handleDisconnect` | Connection revoked |
| 5 | `action: 'registerWebhook'` → dispatches to `handleRegisterWebhook` | Webhook registered |
| 6 | Unknown action → error response | `success: false, message: 'Unknown action:'` |
| 7 | Identity extracted from `event.identity.sub` | `recruiterId` set correctly |
| 8 | Missing identity | `recruiterId === 'unknown'` |
| 9 | Params as stringified JSON | Parsed correctly |

### 5.2 `handleExchange(params, recruiterId)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Happy path: code → tokens → connection created → webhook registered | `success: true`, `PutCommand` + `UpdateCommand` sent |
| 2 | Missing `code` param | `success: false, message: 'Missing required parameters...'` |
| 3 | Missing `redirectUri` | Same validation error |
| 4 | Unknown `providerId` | `success: false, message: 'Unknown provider:'` |
| 5 | Token exchange HTTP error (400) | `success: false` with status/body |
| 6 | Calendly user info fetch fails (non-fatal) | Connection still created, `accountEmail: ''` |
| 7 | `webhookSecret` generated (32 bytes hex) | 64-char hex string stored |
| 8 | `tokenExpiry` calculated from `expires_in` | Correct ISO date |
| 9 | Default `expires_in` when missing | 7200 seconds |
| 10 | Webhook registration fails (non-fatal) | Connection created, `webhookRegistered: false` |
| 11 | With `codeVerifier` for PKCE | Included in token request body |
| 12 | Response includes `connectionId`, `providerId`, `accountEmail`, `status` | All fields present in `data` |

### 5.3 `handleRefresh(params)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Happy path: refreshToken → new tokens → connection updated | `success: true` |
| 2 | Missing `connectionId` | `success: false` |
| 3 | Connection not found | `success: false, message: 'Connection not found'` |
| 4 | No `refreshToken` on connection | `success: false, message: 'No refresh token available'` |
| 5 | Provider refresh endpoint returns error | Connection marked `EXPIRED` |
| 6 | New `refreshToken` in response → stored | Updated in DynamoDB |
| 7 | No new `refreshToken` → keeps old one | Old token preserved |

### 5.4 `handleFetchEventTypes(params)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Calendly: fetches user URI → event types list | Array of `ProviderEventType` |
| 2 | Cal.com: fetches event types directly | Array of `ProviderEventType` |
| 3 | Missing `connectionId` | `success: false` |
| 4 | Connection not found or expired | `success: false` |
| 5 | Token near expiry → auto-refresh triggered | Refresh called first, then event types fetched |
| 6 | Calendly user info fails | Returns empty array |
| 7 | Event types endpoint fails | Returns empty array |
| 8 | Calendly event type → `durationMinutes` mapped | Correct field |
| 9 | Cal.com event type → `length` → `durationMinutes` | Correct field |

### 5.5 `handleDisconnect(params)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Happy path: webhook deleted + connection → REVOKED | `success: true` |
| 2 | Missing `connectionId` | `success: false` |
| 3 | Connection not found | `success: false` |
| 4 | Webhook deletion fails (non-fatal) | Connection still revoked |
| 5 | No `webhookId` on connection | Skip webhook deletion |

### 5.6 `handleRegisterWebhook(params, recruiterId)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Happy path: SSM read → register with provider → save webhookId | `success: true, data: { webhookId }` |
| 2 | Missing `connectionId` | `success: false` |
| 3 | Connection not found | `success: false` |
| 4 | Recruiter doesn't own connection | `success: false, message: 'Access denied'` |
| 5 | Connection not ACTIVE | `success: false, message: 'Connection is REVOKED, not ACTIVE'` |
| 6 | Existing webhook → deleted first, then new one registered | `deleteWebhook` called, then `registerWebhook` |
| 7 | `WEBHOOK_URL_SSM_PARAM` env not set | Error thrown |
| 8 | SSM parameter has no value | Error thrown |
| 9 | Callback URL includes `connectionId` query param | `url` contains `connectionId=` |
| 10 | Provider registration fails | `success: false` |

### 5.7 `getConnectionAndRefreshIfNeeded(connectionId)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Token not expired | Returns connection as-is |
| 2 | Token expired → refresh succeeds | Returns refreshed connection |
| 3 | Token within 5-minute buffer → refresh triggered | Refresh called |
| 4 | Connection is REVOKED | Returns `null` |
| 5 | Connection not found | Returns `null` |
| 6 | Auto-refresh fails | Returns `null` |

### 5.8 `registerWebhook()` helper

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Calendly: reads SSM → gets user URI → POST to webhook URL | Returns webhook URI |
| 2 | Cal.com: reads SSM → POST to webhook URL | Returns webhook ID string |
| 3 | Calendly registration returns non-ok | Returns `null` |
| 4 | Cal.com registration returns non-ok | Returns `null` |
| 5 | SSM param not set → throws | Error message logged |
| 6 | Calendly request body includes `signing_key`, `scope: 'user'`, correct events | Body validated |

---

## 6. React Hook (`src/hooks/useSchedulingConnection.ts`)

**File:** `src/hooks/__tests__/useSchedulingConnection.test.ts`
**Existing stubs:** None

### 6.1 Initial State

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Before subscription fires | `isLoading: true, connection: null, error: null` |
| 2 | Subscription syncs with no connections | `isLoading: false, connection: null` |
| 3 | Subscription syncs with ACTIVE connection | `connection` populated with correct fields |
| 4 | Multiple connections → picks ACTIVE one | `connection.status === 'ACTIVE'` |
| 5 | `SchedulingConnection` model not deployed | Warning logged, `isLoading: false` |

### 6.2 `exchangeOAuth()`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Successful exchange → connection state updated | `connection` set from response `data` |
| 2 | Mutation returns errors | Error thrown + `error` state set |
| 3 | Lambda returns `success: false` | Error thrown with message |
| 4 | Response data as string (JSON) → parsed | Works correctly |

### 6.3 `fetchEventTypes(connectionId)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Returns array of event types with `duration` (not `durationMinutes`) | Field mapped correctly |
| 2 | Lambda returns `success: false` | Error thrown |
| 3 | Empty event types | Returns `[]` |

### 6.4 `disconnect(connectionId)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Successful disconnect | `connection` set to `null` |
| 2 | Lambda returns `success: false` | Error thrown |

### 6.5 `registerWebhook(connectionId)`

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Successful registration | No error, log output |
| 2 | Lambda returns `success: false` | Error thrown |

### 6.6 Cleanup

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Unmount → subscription.unsubscribe called | No memory leak |

---

## Test Priority

### P0 — Must have (regression coverage for production bugs)

1. **Calendly HMAC verification** — `t=<ts>,v1=<sig>` format (§1.2 #1-#4)
2. **findScheduledInterview email fallback** — no Limit:1 (§3.4 #2, #7, #8)
3. **findConnectionByProvider** — no Limit:1 on scan (§3.3 #1-#3)
4. **Calendly email extraction** — `payload.email` first (§1.3 #1, #3, #4)
5. **notifyRecruiterOfStatusChange** — `sub::sub` split (§4.3 #3-#4)
6. **Status transitions** — canTransition matrix (§3.2 all)
7. **Full webhook happy path** — end-to-end (§3.5 #3)

### P1 — Should have (error handling, edge cases)

8. Webhook handler error responses (§3.5 #1, #4-#10)
9. Notification service stream routing (§4.1 all)
10. OAuth exchange happy path (§5.2 #1)
11. OAuth refresh + expiry handling (§5.3 all)
12. registerWebhook SSM + access control (§5.6 #1-#5)

### P2 — Nice to have (completeness)

13. Cal.com normalizer (§2 all)
14. Template substitution (§4.5 all)
15. URL resolution logic (§4.6 all)
16. React hook tests (§6 all)
17. OAuth fetchEventTypes (§5.4 all)
18. OAuth disconnect (§5.5 all)

---

## Test Count Summary

| Module | Tests | Priority |
|--------|-------|----------|
| Calendly Normalizer | 27 | P0/P1 |
| Cal.com Normalizer | 17 | P2 |
| Webhook Handler | 27 | P0/P1 |
| Notification Service | 37 | P0/P1 |
| OAuth Handler | 37 | P1/P2 |
| React Hook | 14 | P2 |
| **Total** | **159** | |

---

## Mocking Strategy

### AWS SDK Mocking

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());

// Mock specific commands
ddbMock.on(ScanCommand, {
  TableName: 'SchedulingConnection',
  // optionally match input
}).resolves({
  Items: [{ id: 'conn-1', status: 'ACTIVE', providerId: 'CALENDLY' }],
});
```

### Fetch Mocking (OAuth handler)

```typescript
global.fetch = vi.fn();

(global.fetch as any)
  .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at' }) })  // token exchange
  .mockResolvedValueOnce({ ok: true, json: async () => ({ resource: { email: 'e' } }) });  // user info
```

### Amplify Client Mocking (React hook)

```typescript
vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      SchedulingConnection: {
        observeQuery: () => ({
          subscribe: vi.fn((handlers) => {
            handlers.next({ items: [], isSynced: true });
            return { unsubscribe: vi.fn() };
          }),
        }),
      },
    },
    mutations: {
      exchangeSchedulingOAuth: vi.fn(),
    },
  }),
}));
```

---

## Running Tests

```bash
# All tests
npx vitest run

# Specific module
npx vitest run amplify/functions/schedulingWebhook/
npx vitest run amplify/functions/notificationService/
npx vitest run amplify/functions/schedulingOAuth/

# With coverage
npx vitest run --coverage

# Watch mode during development
npx vitest amplify/functions/schedulingWebhook/
```
