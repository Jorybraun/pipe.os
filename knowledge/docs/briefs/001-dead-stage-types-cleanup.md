# SWARM PROMPT: Cleanup Dead Stage Types

## Context

You are working on the PIPE codebase. Read `docs/project-brief.md` and `.claude/rules/terminology.md` first. The project has committed to exactly 5 stage types: `SCREENING`, `CULTURAL`, `CODE_REVIEW`, `OPEN_SOURCE`, `LIVE_PANEL`. Everything else is dead.

## Task

Remove all deprecated stage types from the frontend and align the codebase with the locked terminology.

## Deprecated types to kill

`AI_COLLAB`, `PLANNING`, `VOICE`, `INGESTION`, `TECHNICAL`, `QUESTIONS`, `VOICE_INTERVIEW`

## Files to modify

Search the entire repo for deprecated strings. Priority files:

- `src/pages/PipelineBuilderPage.tsx` — remove config UI for dead types. If the page only renders dead types, delete the whole file and update any imports/routes.
- `src/types/index.ts` — align `Stage.type` with API-validated types.
- `src/mocks/stages.ts` — delete or rewrite mock data to use only valid types.
- `src/lib/stageTemplates.ts` — remove templates for dead types.
- `src/pages/NewStageFormPage.tsx` — remove the `QUESTIONS` → `TECHNICAL` mapping. `QUESTIONS` no longer exists.
- `src/components/` — search for deprecated type strings and remove/replace.
- Remove all `titleLower.includes(...)` fallback inference patterns in `StagePanel.tsx`, `StageIndexTab.tsx`, `ChallengesTab.tsx`, etc. Stages must have `stage_type` populated.

## API source of truth

`workers/api/src/validation/stages.ts` defines the valid `STAGE_TYPES` array. The frontend must match this exactly.

## Acceptance criteria

1. `grep -ri "AI_COLLAB\|PLANNING\|VOICE_INTERVIEW\|INGESTION\|TECHNICAL\|QUESTIONS" src/` returns zero results (except inside comments explaining the deprecation).
2. `npx tsc --noEmit` passes with no errors.
3. `npx wrangler dev` boots the workers API without type errors.
4. `CHANGELOG.md` updated under `[Unreleased]`.

## Rules

- Do not add new features.
- Do not refactor unrelated code.
- Pure cleanup only.
