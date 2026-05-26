# TD-007: Extract shared test stubs

**Source:** knowledge/tech-debt/TD-007-duplicated-test-stubs.md
**Phase:** 0
**Status:** PENDING
**Estimate:** 1 day

## Why

Every test file that touches D1 or LLM providers invents its own stub from scratch. There are at least 16 distinct `fakeD1` / `buildStubDb` implementations. A schema change requires updating stubs in 16 files.

## Subtasks (delegable)

### Subtask 1 — Create shared test helpers module
**Files:**
- `workers/api/src/__tests__/helpers.ts` (new)

**Spec:**
- Export `fakeD1(firstResponders?: Array<{ match: string; value: unknown }>): D1Database`
  - Support `.prepare()`, `.all()`, `.run()`, `.raw()`
  - `firstResponders` pattern: if SQL contains `match`, return `value`
  - Return `{ results: [], success: true, meta: { changes: 0 } }` by default
- Export `buildEnv(db: D1Database): Env` — builds a minimal `Env` with the fake D1
- Export `makeStubProvider(): LLMProvider` — returns a mock provider with `.complete()` and `.embed()`
- Export `stubClerkUser(user?: Partial<User>): User` — returns a mock Clerk user
- Copy the BEST existing implementations from `candidates.test.ts` and `reviewSessionV2.test.ts`
- Add unit tests for the helpers themselves (meta, but useful)

**Status:** ⏳ PENDING

### Subtask 2 — Migrate `candidates.test.ts` to use shared helpers
**Files:**
- `workers/api/src/__tests__/candidates.test.ts`

**Spec:**
- Replace local `fakeD1` and `buildEnv` with imports from `./helpers`
- Delete local stub implementations
- Run `npx vitest run src/__tests__/candidates.test.ts` — must pass

**Status:** ⏳ PENDING

### Subtask 3 — Migrate `reviewSessionV2.test.ts` to use shared helpers
**Files:**
- `workers/api/src/__tests__/reviewSessionV2.test.ts`

**Spec:**
- Replace local stubs with imports from `./helpers`
- Delete local stub implementations
- Run `npx vitest run src/__tests__/reviewSessionV2.test.ts` — must pass

**Status:** ⏳ PENDING

## Dependencies
- Depends on: None

## Acceptance criteria
- [ ] `__tests__/helpers.ts` exists with fakeD1, buildEnv, makeStubProvider, stubClerkUser
- [ ] `candidates.test.ts` imports from `./helpers` and has no local stub copies
- [ ] `reviewSessionV2.test.ts` imports from `./helpers` and has no local stub copies
- [ ] All migrated tests pass
- [ ] Type check passes
