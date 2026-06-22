# Culture Question Bank — D1 Sync

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part1-north-star.md (lines 120–121)
**Phase:** 0
**Status:** PENDING
**Estimate:** 1 week

## Source quote

> Culture question bank is a TypeScript constant in `cultureQuestionBank.ts`, not synced to D1.

## Why

A hardcoded TypeScript constant cannot be updated without a deployment, cannot be audited per NYC Local Law 144 / EU AI Act Art 14 requirements as a recruiter-approved finite question bank, and cannot be queried by the compliance audit trail at runtime. Moving it to D1 enables recruiter review, runtime auditability, and dynamic updates without re-deploying the Worker.

## Subtasks (delegable)

### Subtask 1 — Migration + seed script for `culture_question_bank` table

**Files:**
- `workers/api/migrations/` (new migration file — after 0044)
- `workers/api/src/lib/cultureQuestionBank.ts`

**Spec:**
- New migration creates `culture_question_bank` table with columns: `id TEXT PRIMARY KEY`, `dimension TEXT NOT NULL`, `question_text TEXT NOT NULL`, `probe_type TEXT NOT NULL`, `is_active INTEGER NOT NULL DEFAULT 1`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`.
- Write a seed script (or include seed INSERTs in the migration) that loads all existing questions from the TypeScript constant into the new table. Each question gets a stable deterministic ID (e.g., `dim_<dimension>_<index>` or a UUID generated from the text hash).
- Update `cultureQuestionBank.ts` to export a `loadQuestionBank(db: D1Database)` async function that SELECTs `WHERE is_active = 1` and returns the same shape as the current constant. Keep the constant as a fallback for unit tests that don't have a DB binding.
- `npx tsc --noEmit` must pass.

**Status:** PENDING

---

### Subtask 2 — Wire `loadQuestionBank` into the culture interview agent

**Files:**
- `workers/api/src/lib/cultureAgent.ts`

**Spec:**
- Replace the direct constant import with a call to `loadQuestionBank(env.DB)` at session initialisation.
- Cache the loaded bank in memory for the duration of the session (no need to re-query D1 per turn).
- Add a structured log at load time: `console.info('[cultureAgent] question bank loaded:', { count, source: 'D1' })`.
- If `loadQuestionBank` throws (e.g., table not yet migrated on a dev binding), fall back to the TypeScript constant with a `console.warn('[cultureAgent] D1 question bank unavailable, using static fallback')`.
- Unit test: mock `loadQuestionBank` to return a fixture bank → assert agent uses the fixture questions. No real D1 needed in tests.
- `npx tsc --noEmit` must pass.

**Status:** PENDING

## Dependencies

- Depends on: phase0-subagent-execution-plan.md Subagent J (staging `wrangler.jsonc` fix — staging D1 binding must be separate from production before this migration is applied to both environments)
- Blocks: Phase 4 UAR culture plugin (the UAR plugin should read from D1, not a TypeScript constant, when it replaces the bespoke path)
- Blocks: compliance audit trail hardening (NYC LL 144 recruiter-approval gate becomes implementable once questions are in D1 with `is_active` flag)

## Acceptance criteria

- [ ] `culture_question_bank` table exists after migration with all current questions seeded
- [ ] `loadQuestionBank(db)` returns the same question set as the TypeScript constant
- [ ] Culture interview agent loads questions from D1 at session start
- [ ] Fallback to TypeScript constant when D1 unavailable, with warning log
- [ ] Unit test for D1 load path passes (mocked DB)
- [ ] `npx tsc --noEmit` passes
