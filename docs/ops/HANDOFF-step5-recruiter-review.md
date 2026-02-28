# HANDOFF — Step 4E Verify + Step 4.5 Finish + Step 5: Recruiter Per-Challenge Review

**Created:** 2026-02-27
**Author:** Claude (Cowork brain)
**Status:** Ready to hand off
**Estimated time:** ~5 hours total (Step 4E: 30 min, Step 4.5 tail: 10 min, Step 5: ~4 hours)

---

## Context

Phase 7 Step 4 (Composable Challenge System) is built and committed as `a3e1539`. The architecture has been reviewed and approved — the Shell + Panel composition pattern is sound, TimerContext correctly synchronizes countdown between logic and display, and `resolveLayout`/`resolveShells` cleanly separate concerns.

Step 4.5 Part A (ChallengePicker library wiring) is done — commit `dc8651a`. Part B is nearly complete but missing one small item: the CODE_IMPLEMENTATION notice.

Step 5 is the final MVP feature: updating the recruiter's `CandidateProfilePage` to show per-challenge breakdowns instead of a single aggregate score, adding manual scoring for SHORT_ANSWER and CODE_IMPLEMENTATION, and rolling up challenge → stage → overall signal.

After Step 5, the core MVP loop is complete: recruiter creates pipeline → invites candidate → candidate completes challenges → recruiter reviews per-challenge results and scores.

---

## Scope

### In scope:
- Step 4E: verification only (tsc, smoke test, CHANGELOG)
- Step 4.5 Part B: one remaining item (CODE_IMPLEMENTATION notice in ChallengeEditorPage)
- Step 5A: `CandidateProfilePage` — grouped per-challenge view with score + submission preview
- Step 5B: Manual scoring interface for SHORT_ANSWER and CODE_IMPLEMENTATION
- Step 5C: Score rollup (challenge → stage average → overall signal label)
- CHANGELOG, tsc, code review entry per commit protocol

### Explicitly NOT in scope (post-MVP):
- AI-assisted scoring or commentary
- Test runner / auto-grading for CODE_IMPLEMENTATION
- Full diff view of candidate's code (preview only — truncated)
- Real-time updates (polling is fine)
- `reviewedByRecruiter` boolean flip (defer — nice to have but not blocking MVP)

---

## Read first

Before writing a single line:

1. `docs/ARCHITECTURE.md` — data model, Assessment schema (especially `submission` JSON structure by type), `CandidateProfilePage` listed under Recruiter Dashboard epic
2. `docs/design/challenge-architecture.md` — Assessment submission JSON by type (lines ~155–181 in ARCHITECTURE.md)
3. `docs/reviews/phase-7-code-review.md` — existing code review notes for this area
4. `src/pages/CandidateProfilePage.tsx` — understand what's currently rendered: stage tabs, aggregated score, no per-challenge breakdown yet
5. `docs/design/design-system.md` — component primitives to use (LiquidMetalCard, FieldGroup, TextInput)
6. `GEMINI.md` — Key conventions and engineering standards

---

## Step-by-step instructions

### Part 0 — Step 4E: Verify composable challenge system

**Time estimate: 30 min**

1. Run `npx tsc --noEmit` from the repo root. Two pre-existing errors in `useRoleDiscovery.ts` are acceptable and expected. Zero NEW errors is the requirement.

2. **Smoke test all four challenge types** — you need a pipeline with one challenge of each type (CODE_REVIEW, CODE_IMPLEMENTATION, QUIZ_MCQ, QUIZ_SHORT_ANSWER). Use the DEFAULT preset or build manually. Then:
   - Open `/assess/:token` for a test candidate
   - Navigate through each challenge type
   - Confirm each renders without error (correct panel layout appears)
   - Confirm submission works for each type (Assessment record created in DynamoDB)

3. **Update `CHANGELOG.md`** — under `[Unreleased]`, add an entry for Step 4E verification:
   ```
   ### `[commit-id]` — Phase 7 Step 4E: Verification
   - Verified: tsc passes with zero new errors
   - Verified: all four challenge types render and submit correctly end-to-end
   ```

4. Commit: `git add CHANGELOG.md` and `git commit -m "chore: Step 4E verification — tsc clean, all four challenge types smoke-tested"`. Create `docs/changelogs/[commit-id].md` with the verification log. Add code review entry to `MASTER_CLAUDE.md`.

5. Check off the Step 4E items in `TASKS.md`.

---

### Part 1 — Step 4.5 Part B: CODE_IMPLEMENTATION notice

**Time estimate: 10 min**

In `src/pages/ChallengeEditorPage.tsx`, in the CONTENT tab switch, find the `CODE_IMPLEMENTATION` case (currently shows `COMING_SOON` or similar). Replace it with a read-only notice:

```tsx
// CODE_IMPLEMENTATION content tab — replace placeholder with:
<div style={{
  padding: '24px',
  background: 'rgba(167, 139, 250, 0.05)',
  border: '1px solid rgba(167, 139, 250, 0.2)',
  borderRadius: '4px',
  fontFamily: '"Space Mono", monospace',
  fontSize: '12px',
  lineHeight: 1.6,
  color: 'rgba(255,255,255,0.6)',
}}>
  <div style={{ color: '#a78bfa', fontWeight: 700, marginBottom: '8px' }}>
    CODE_IMPLEMENTATION
  </div>
  This challenge was loaded from a template. Edit the problem statement and instructions in the Details tab above. Custom test case authoring is coming in a future release.
</div>
```

Use `#a78bfa` (purple — CODE_IMPLEMENTATION badge color per design system).

Run `npx tsc --noEmit`. Update `CHANGELOG.md`. Commit. Check off in `TASKS.md`.

---

### Part 2 — Step 5A: Per-challenge view in CandidateProfilePage

**Time estimate: 2 hours**

The current page shows stage tabs with an aggregated score. The new view shows each challenge within a stage, with its score and a preview of the candidate's submission.

**What to build:**

The existing `selectedStageId` tab pattern is already wired. What's missing is the per-challenge detail within the selected stage.

**Data already loaded:**
- `assessments` — array of `Schema['Assessment']['type']` with fields: `id`, `challengeId`, `score`, `submission`, `feedback`, `completedAt`
- `stages` — array with `id`, `order`, `challenges[]` (each has `id`, `title`, `type`, `order`)

**Fix the type regression first:**
`CandidateProfilePage.tsx` line ~82 has `const [stages, setStages] = useState<any[]>([])`. This must be typed. Define a local interface:

```typescript
interface StageWithChallenges {
  id: string;
  order: number | null;
  challenges: Array<{
    id: string;
    title: string | null;
    type: string | null;
    order: number | null;
  }>;
}
```

Use `useState<StageWithChallenges[]>([])` and update the data assignment accordingly (remove the `as any` on line ~107-108).

**Build the per-challenge card:**

For the selected stage, map over its `challenges` (sorted by `order`). For each challenge, find its matching assessment: `assessments.find(a => a.challengeId === challenge.id)`.

Render a `LiquidMetalCard` per challenge showing:
- Challenge title + type badge (use the badge color from design system: CODE_REVIEW=`#60a5fa`, CODE_IMPLEMENTATION=`#a78bfa`, QUIZ_MCQ=`#4ade80`, QUIZ_SHORT_ANSWER=`#fbbf24`)
- Score (or "PENDING" if null)
- Submission preview (see below per type)

**Submission preview logic (read-only display):**

The `submission` field is a JSON string. Parse it. Then display based on `challenge.type`:

- `CODE_REVIEW`: Show count of annotations — "N annotations submitted". Don't render full diff here.
- `CODE_IMPLEMENTATION`: Show first 200 chars of `submission.code` in a `<pre>` block, truncated.
- `QUIZ_MCQ`: Show `submission.selectedOptionId`. If you have the config, resolve to the option text. If not, show the raw ID.
- `QUIZ_SHORT_ANSWER`: Show `submission.text` (full text — these are short).

**Layout:** The per-challenge section replaces or augments the existing stage detail area. Keep the stage tabs pattern at the top. Below selected stage: list of challenge cards in order, each showing the above content.

**Important:** If `assessment` is null for a challenge (candidate hasn't submitted that challenge yet), show a "NOT SUBMITTED" state card.

---

### Part 3 — Step 5B: Manual scoring interface

**Time estimate: 1 hour**

Only `QUIZ_SHORT_ANSWER` and `CODE_IMPLEMENTATION` need manual scoring — `CODE_REVIEW` and `QUIZ_MCQ` are auto-scored.

Add a scoring panel to challenge cards where `challenge.type` is one of these two types.

**UI pattern:**
- A 0–100 score input (number input, not a slider — simpler, exact)
- A "Rationale" textarea for recruiter notes (maps to `Assessment.feedback` — check schema; if this field doesn't exist on Assessment, add it as `feedback: a.string()` to `amplify/data/resource.ts` — read the schema first to verify)
- A "SAVE SCORE" button that calls `client.models.Assessment.update({ id: assessment.id, score: value, feedback: rationale })`

**UX rules:**
- Score input: `min=0`, `max=100`, type `number`. Show current saved value if present.
- On save: optimistic UI update — immediately update local state before the async call completes. On error, revert.
- After save: the score feeds into the rollup (Part 3 below) — the rollup should recompute reactively.
- Auto-scored challenges show their score as read-only — no edit input for CODE_REVIEW or QUIZ_MCQ.

**Schema check:** Before adding `feedback` to schema, verify `Assessment` in `amplify/data/resource.ts` doesn't already have a notes/feedback field. If it does, use that. If not, add it. If adding, run `npx ampx sandbox` after the schema change.

---

### Part 4 — Step 5C: Score rollup

**Time estimate: 30 min**

The current `avgScore` calculation on line ~177 is a flat average across all assessments. Replace it with a proper staged rollup:

```typescript
// Stage score = average of challenge scores within that stage
// Overall score = average of stage scores (not weighted at MVP)
// Only include challenges that have a non-null score

const stageScores = stages.map(stage => {
  const stageChallenges = stage.challenges ?? [];
  const scored = stageChallenges
    .map((c: { id: string }) => assessments.find(a => a.challengeId === c.id))
    .filter((a): a is Schema['Assessment']['type'] => !!a && a.score !== null && a.score !== undefined);

  if (scored.length === 0) return null;
  const avg = scored.reduce((sum, a) => sum + (a.score ?? 0), 0) / scored.length;
  return { stageId: stage.id, score: Math.round(avg) };
});

const scoredStages = stageScores.filter((s): s is { stageId: string; score: number } => s !== null);
const overallScore = scoredStages.length > 0
  ? Math.round(scoredStages.reduce((sum, s) => sum + s.score, 0) / scoredStages.length)
  : 0;
```

Update `signal` label computation to use `overallScore`. Update `aiProfile` to use `overallScore`.

Show each stage's rolled-up score in the stage tab (alongside or replacing the current stage tab display).

---

## Verification checklist

Before considering this task done:

- [ ] `npx tsc --noEmit` — zero new errors (2 pre-existing in `useRoleDiscovery.ts` are acceptable)
- [ ] No `any` types introduced — use the `StageWithChallenges` interface; explicit types on all parsed JSON
- [ ] Smoke test: create a pipeline, invite a test candidate, submit each challenge type, verify per-challenge breakdown appears in recruiter view
- [ ] Smoke test: add a manual score to a SHORT_ANSWER challenge, verify score saves and signal label updates
- [ ] Smoke test: CODE_REVIEW and QUIZ_MCQ show read-only scores (no score input rendered)
- [ ] Step 4E smoke test passed (all 4 challenge types render + submit end-to-end)
- [ ] `CHANGELOG.md` updated for each commit

---

## Completion protocol

**Per commit (there will be 2–3):**

1. `git add [specific files — never git add .]`
2. `git commit -m "descriptive message"` — capture `git rev-parse --short HEAD`
3. Create `docs/changelogs/[short-id].md` — list every file modified + technical summary
4. Update `CHANGELOG.md` under `[Unreleased]`
5. Add code review entry to `MASTER_CLAUDE.md` under `## 🔍 Code Review Requests`
6. Check off completed items in `TASKS.md`

**Final state when done:**
- `TASKS.md` — Step 4E, Step 4.5 Part B, and all Step 5 items checked
- `CandidateProfilePage.tsx` — shows per-challenge breakdown with submission previews and manual scoring
- No `any[]` for stages state — properly typed

---

## Architectural decisions already made (no re-litigating)

- **Score storage:** Scores live on `Assessment`, not `Candidate`. The `Candidate` record has no score field.
- **Manual scoring:** Saved as `Assessment.score` (float 0–100). This is the same field auto-scoring uses. No separate field needed.
- **Rollup:** Stage average → overall average. No weighting at MVP.
- **`reviewedByRecruiter` flag:** Defined in schema, not wired to UI at MVP. Don't add the flip logic now — it's post-MVP.
- **Submission preview:** Read-only, abbreviated. Full replay / diff view is post-MVP.

---

## Related files

| File | Why |
|---|---|
| `src/pages/CandidateProfilePage.tsx` | Primary work surface |
| `amplify/data/resource.ts` | Check for `feedback` field on Assessment; add if missing |
| `src/pages/ChallengeEditorPage.tsx` | Step 4.5 Part B: CODE_IMPLEMENTATION notice |
| `docs/design/design-system.md` | Component primitives + badge colors |
| `docs/reviews/phase-7-code-review.md` | Prior notes on this file |
| `CHANGELOG.md` | Update on every commit |
| `MASTER_CLAUDE.md` | Add code review entries on completion |
| `TASKS.md` | Check off items as completed |
