# Test Lane Completion — Simple Code Changes

**Phase:** 1
**Status:** PENDING
**Estimate:** 0.5 days
**Type:** Engineering

## Why

A minimal plan to verify the lane can run a full plan to completion with simple, real file modifications.

## Subtasks (delegable)

### Subtask 1 — Add JSDoc to `calculateSignal` utility

**Files / Deliverables:**
- `src/lib/utils.ts`

**Spec:**
Add a JSDoc comment above the `calculateSignal` function explaining what it does.
The comment should document the `score` parameter and the return type.
Do not change the function logic.

**Status:** ⏳ PENDING

### Subtask 2 — Add `FEATURE_FLAG_TEST_MODE` to feature flags

**Files / Deliverables:**
- `src/config/featureFlags.ts`

**Spec:**
Add a new feature flag `FEATURE_FLAG_TEST_MODE: false`.
Add a JSDoc comment explaining it is a placeholder for test-mode UI gating.

**Status:** ⏳ PENDING

## Dependencies

None.
