# Handoff: Data Cleanup & Schema Purge

**Date:** 2026-02-27
**Assigned to:** Gemini (or next agent)
**Tracked in:** `TASKS.md` → "Data Cleanup & Schema Purge"
**Estimated time:** ~1.5 hours
**Status:** Ready to execute — no design decisions required, all decisions already made.

---

## Context

Pipe is pre-launch. There are approximately 5 test Candidate and Assessment records in the sandbox database. Before continuing development, we want a clean slate and a tidy schema.

There are also two stale relics in `amplify/data/resource.ts` from before the Phase 7 architecture migration that need to be removed:

- `Stage.type` — the old `'QUIZ' | 'CODE_REVIEW'` enum field (deprecated, but still in the schema and referenced in two UI files)
- `Stage.config` — a legacy JSON blob field (no longer referenced in any active source file)
- `ChallengeTemplate` model — an Amplify DynamoDB model with the wrong type enum, not wired to any UI, replaced by the static `challengeLibrary.ts`

> ⚠️ **IMPORTANT NAMING CONFUSION — READ THIS FIRST**
>
> There are two things called "ChallengeTemplate" in this codebase. They are completely different:
>
> 1. `ChallengeTemplate` **Amplify model** in `amplify/data/resource.ts` — a DynamoDB-backed model using the old `['QUIZ', 'CODE_REVIEW']` type enum. **→ REMOVE THIS.**
>
> 2. `ChallengeTemplate` **TypeScript interface** in `src/content/challengeLibrary.ts` — a local interface defining the shape of static template objects. **→ DO NOT TOUCH THIS.** It is used throughout the challenge picker and library.
>
> Similarly, `Challenge.config` (on the `Challenge` model) is actively used and must not be removed. Only `Stage.config` is legacy.

---

## Step 1 — Run the Data Purge Script

The script is already written at `scripts/purgeTestData.ts`.

```bash
PIPE_USERNAME=your@email.com PIPE_PASSWORD=yourpassword npx tsx scripts/purgeTestData.ts
```

**What it does:**
1. Signs in to Cognito with your recruiter credentials
2. Lists and deletes all `Assessment` records (must go first — they reference Candidates)
3. Lists and deletes all `Candidate` records
4. Signs out

**Expected output:**
```
[purge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[purge]  Pipe — Dev Data Purge Script
[purge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[purge] Signing in as your@email.com...
[purge] Authenticated ✓
[purge] Fetching Assessment records...
[purge]   ✓ Deleted Assessment abc123
[purge] Fetching Candidate records...
[purge]   ✓ Deleted Candidate xyz789 (test@example.com)
[purge] ✅ Purge complete.
[purge]    Assessments deleted: 5
[purge]    Candidates deleted:  5
```

**If auth fails:** Double-check that `PIPE_USERNAME` and `PIPE_PASSWORD` are valid Cognito credentials for the sandbox environment (the same credentials used to log in to the recruiter dashboard).

**If `amplify_outputs.json` is missing:** Run `npx ampx sandbox` first to deploy the sandbox and generate the outputs file.

---

## Step 2 — Update `amplify/data/resource.ts`

Open `amplify/data/resource.ts`. Make the following three changes:

### Change A — Remove `Stage.type` and `Stage.config`

Find the `Stage` model. It currently looks like this:

```typescript
Stage: a
  .model({
    pipelineId: a.id().required(),
    pipeline: a.belongsTo('Pipeline', 'pipelineId'),
    order: a.integer(),
    challenges: a.hasMany('Challenge', 'stageId'),
    // Legacy - deprecated in Phase 7
    type: a.enum(['QUIZ', 'CODE_REVIEW']),
    config: a.json(),
  })
  .authorization((allow) => [
    allow.owner(),
    allow.publicApiKey().to(['read']),
  ]),
```

Remove the two legacy lines. The model should become:

```typescript
Stage: a
  .model({
    pipelineId: a.id().required(),
    pipeline: a.belongsTo('Pipeline', 'pipelineId'),
    order: a.integer(),
    challenges: a.hasMany('Challenge', 'stageId'),
  })
  .authorization((allow) => [
    allow.owner(),
    allow.publicApiKey().to(['read']),
  ]),
```

### Change B — Remove the `ChallengeTemplate` model

Find and delete the entire `ChallengeTemplate` model block (including its JSDoc comment). It starts with:

```typescript
/**
 * ChallengeTemplate Model (formerly Challenge)
 *
 * A global repository of pre-validated assessment content.
 */
ChallengeTemplate: a
  .model({
    ...
  })
  .authorization(...),
```

Delete everything from the opening JSDoc comment through the closing `.authorization(...)` call and its trailing comma.

> Do NOT remove `RoleContext` — it is a preserved post-MVP model that must stay in the schema.

---

## Step 3 — Fix UI References to `stage.type`

After removing `Stage.type` from the schema, TypeScript will fail on two files that reference it. Fix them both.

### File 1: `src/pages/OverviewPage.tsx`

**Find and fix (around line 98):**
```typescript
// BEFORE
const Icon = stage.type ? (stageIcons[stage.type] || FileText) : FileText;
// AFTER
const Icon = FileText;
```

**Find and fix (around line 140):**
```typescript
// BEFORE
{stage.type ? stage.type.replace('_', ' ').toUpperCase() : 'STAGE'}
// AFTER
{'STAGE'}
```

Also check if `stageIcons` is now unused. If it is, remove its import/declaration to keep the file clean.

### File 2: `src/pages/CandidateProfilePage.tsx`

**Find and fix (around line 236):**
```typescript
// BEFORE
const Icon = stage.type ? (stageIcons[stage.type] || FileText) : FileText;
// AFTER
const Icon = FileText;
```

**Find and fix (around line 288):**
```typescript
// BEFORE
{stage.type ? stage.type.replace('_', ' ').toUpperCase() : 'STAGE'}
// AFTER
{'STAGE'}
```

Same as above — check if `stageIcons` is now unused and remove if so.

> **Why hardcode `'STAGE'`?** In the new architecture, stages are containers with a name and order — they don't have a type. Individual *challenges* have types. Displaying `stage.type` was already a legacy pattern from before Phase 7.

---

## Step 4 — Run Sandbox + Type Check

```bash
npx ampx sandbox
```

Wait for the schema to deploy successfully. You should see no errors about the removed fields.

```bash
npx tsc --noEmit
```

This must pass with zero new errors. The two pre-existing errors in `src/hooks/useRoleDiscovery.ts` are acceptable — that file is post-MVP and is intentionally preserved as-is.

If there are new errors, they will be in `OverviewPage.tsx` or `CandidateProfilePage.tsx` referencing `stage.type`. Fix them before continuing.

---

## Step 5 — Update `CHANGELOG.md`

Add an entry under `[Unreleased]`:

```markdown
### Removed
- `Stage.type` and `Stage.config` fields from schema (legacy from Phase 6 stage-as-unit model, deprecated in Phase 7)
- `ChallengeTemplate` Amplify model from schema (replaced by static `src/content/challengeLibrary.ts`)
- `stage.type` UI references in `OverviewPage.tsx` and `CandidateProfilePage.tsx` (field no longer exists)

### Added
- `scripts/purgeTestData.ts` — dev data reset utility (deletes all Candidate + Assessment records)
```

---

## Step 6 — Check Off Tasks in `TASKS.md`

Mark all items in the "Data Cleanup & Schema Purge" section as complete `[x]`.

---

## Do Not Touch

| What | Why |
|---|---|
| `src/content/challengeLibrary.ts` | The `ChallengeTemplate` interface here is the static template library — keep it exactly as-is |
| `Challenge.config` field in schema | Actively used in `useAssessment.ts`, `CandidateAssessmentPage.tsx`, `ChallengeEditorPage.tsx` |
| `amplify/data/resource.ts → RoleContext` | Preserved post-MVP model |
| `src/hooks/useRoleDiscovery.ts` | Preserved post-MVP hook — 2 pre-existing tsc errors are acceptable |
| `scripts/migrateStageConfigToChallenges.ts` | Legacy migration script — leave it in place as historical record |
| Pipeline / Stage / Challenge records | Only purge Candidates and Assessments — recruiter test pipelines can stay |

---

## Verification Checklist

Before marking this task complete, confirm:

- [ ] `scripts/purgeTestData.ts` ran successfully — 0 Candidate and 0 Assessment records in the database
- [ ] `Stage.type` and `Stage.config` removed from `amplify/data/resource.ts`
- [ ] `ChallengeTemplate` Amplify model removed from `amplify/data/resource.ts`
- [ ] `OverviewPage.tsx` no longer references `stage.type`
- [ ] `CandidateProfilePage.tsx` no longer references `stage.type`
- [ ] `npx ampx sandbox` deployed cleanly
- [ ] `npx tsc --noEmit` passes with zero new errors
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] All items in `TASKS.md` "Data Cleanup & Schema Purge" section checked off
