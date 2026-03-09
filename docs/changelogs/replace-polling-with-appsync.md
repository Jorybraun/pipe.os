# Code Review — replace-polling-with-appsync

**Branch:** `copilot/replace-polling-with-appsync`
**Date:** 2026-03-04
**Author:** Copilot
**Reviewer:** [Pending]

## Description

Replaces ECS container status polling with real-time AppSync push notifications. An EventBridge rule captures ECS Task State Change events, routes them to the `ecsStatusBridge` Lambda, which writes status updates to the `DevContainerSession` model via AppSync API key auth. The frontend subscribes to model updates via `client.models.DevContainerSession.onUpdate()`.

## Changeset

**Branch stats:** 5 commits ahead of main, 20 files changed (+1502/−86)
**TypeScript:** Clean — 0 errors
**`any` usage:** None in Lambda handlers ✅

### Architecture

- EventBridge → `ecsStatusBridge` Lambda → AppSync model mutation → Frontend subscription
- SSM Parameter Store breaks circular CDK dependencies for table name injection
- DynamoDB Streams for notification service (separate feature, co-located on branch)

### Key Files

| File | Role |
|---|---|
| `amplify/backend.ts` | CDK wiring — EventBridge rule, SSM params, env var injection |
| `amplify/data/resource.ts` | `DevContainerSession` model with `publicApiKey` auth for bridge writes |
| `amplify/functions/ecsStatusBridge/handler.ts` | EventBridge → AppSync bridge (upsert pattern) |
| `amplify/functions/devContainerLaunch/handler.ts` | ECS RunTask with session tagging |
| `amplify/functions/devContainerDestroy/handler.ts` | ECS StopTask |
| `amplify/functions/devContainerStatus/handler.ts` | ECS DescribeTasks fallback query |
| `src/hooks/useDevContainerSession.ts` | React FSM hook with AppSync subscription + 120s fallback timeout |
| `src/pages/DevContainerSandboxPage.tsx` | Isolated prototype route at `/sandbox/dev-container` |

---

## Issues

### P1 — Status Enum Inconsistency

The two status-mapping Lambdas define **different** status types:

| Status | `ecsStatusBridge/types.ts` | `devContainerStatus/types.ts` |
|---|---|---|
| PROVISIONING | ✅ | ✅ |
| BOOTING | ✅ | ✅ |
| READY | ✅ | ✅ |
| STOPPING | ✅ | ✅ |
| **ERROR** | ✅ | ❌ |
| **STOPPED** | ❌ | ✅ |

`ecsStatusBridge` maps ECS `STOPPED` → `'STOPPING'` (never producing a terminal state), while `devContainerStatus` maps ECS `STOPPED` → `'STOPPED'`. A container that has stopped will report different status depending on whether the update came via EventBridge or the fallback query.

**Fix:** Create a single shared `ContainerStatus` type. Include both `STOPPED` and `ERROR`.

### P1 — DynamoDB Wildcard Permissions

`backend.ts` grants webhook/oauth/notification Lambdas:

```
arn:aws:dynamodb:*:*:table/*
```

This gives full DynamoDB access to every table in every region and account. Scope to specific table ARNs or at minimum `arn:aws:dynamodb:${region}:${account}:table/Pipe-*`.

### P2 — Dead Code: `src/graphql/subscriptions.ts`

Defines `onContainerStatusChangedQuery` but is **never imported** anywhere. The hook uses `client.models.DevContainerSession.onUpdate()` instead. Delete this file.

### P2 — Stale JSDoc

`ecsStatusBridge/resource.ts` line 8 still references the deleted `publishContainerStatus` mutation:

```
Receives ECS Task State Change events and calls the publishContainerStatus mutation
```

Should reference `DevContainerSession` model mutations.

### P3 — Fragile Error Detection in Upsert

`ecsStatusBridge/handler.ts` upsert fallback relies on string matching:

```typescript
if (e instanceof Error && e.message.includes('not found'))
```

AppSync error messages are not contractual. Consider catching by `errorType` from the GraphQL response instead, or always try create-first with a conflict handler.

### P3 — `STOPPED` → `STOPPING` Semantic Mismatch

In `ecsStatusBridge`, ECS `STOPPED` with `desiredStatus === 'STOPPED'` maps to `'STOPPING'` — but the container *has already stopped*. This means a successfully stopped container is perpetually reported as "stopping." Either add `STOPPED` to the schema enum, or map it to a terminal state.

---

## Positive Observations

- **Type safety** — zero `any`, proper type guards (`isRecord`, `parseStatusPayload`, etc.) in the hook, typed Lambda payloads throughout
- **Handler structure** — all 4 Lambdas follow handler/resource/types separation per engineering standard
- **State machine** in `useDevContainerSession` is well-designed with proper cleanup (subscription unsubscribe, timeout clearing) and defensive fallback polling
- **Error handling** — all Lambdas return structured error responses with codes, hook surfaces errors to UI
- **Sandbox page** is a great isolated testbed for the integration

---

## Validation Plan

1. [x] **Type Check**: `npx tsc --noEmit` passes
2. [x] **CDK Synthesis**: `npx ampx sandbox` passes synthesis
3. [ ] **Fix P1s**: Unify status enums, scope DynamoDB permissions
4. [ ] **Cleanup P2s**: Delete dead `subscriptions.ts`, fix stale JSDoc
5. [ ] **Manual E2E**: Launch container, verify real-time status updates via subscription, verify fallback query matches
