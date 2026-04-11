# Scorer Calibration — Fixture Authoring Guide

> How to write a `ScorerCalibrationFixture` that the calibration harness can use. Read [`methodology.md`](methodology.md) first to understand why these rules exist.

---

## Where fixtures live

```
workers/api/fixtures/scorer-calibration/
├── types.ts                                         ← the schema (strict-typed)
├── seed-001-junior-jwt-verification-miss.json       ← low-score anchor
├── seed-002-senior-n-plus-one-excellent.json       ← high-score anchor
└── … (future fixtures land alongside)
```

Each fixture is a single JSON file conforming to the `ScorerCalibrationFixture` interface in `types.ts`. The schema imports `PlantedBug` and `ReviewRound` from `workers/api/src/lib/implementerAgent` so fixtures are strict-typed against the live scorer input types — if a refactor renames a field on `ReviewRound`, the fixtures must move with it, and tsc will surface the mismatch before CAL-2 runs.

---

## The six authoring rules (canonical, from `types.ts` header)

1. **Cover the anchor range.** At least one fixture must expect band 1 on each dimension, and at least one must expect band 5. Without range coverage, weighted κ is uninformative due to range restriction — the scorers will agree because there is no room to disagree.

2. **Expected bands are a range, not a point.** Humans disagree ±1 on BARS routinely. The fixture author commits to a `min`/`max` band per dimension. The scorer is considered "in agreement" with the fixture if its output falls inside the range. κ is still computed on point estimates for the harness math, but the range is used by the sanity-check pass that flags outlier fixtures.

3. **Every rationale line must reference concrete transcript evidence.** "Caught bug #2 in round 1 at file.ts:24 with a grounded performance argument" is rationale. "Good review" is not. The rationale is the part a human can cross-check when a fixture's expected bands turn out to be wrong.

4. **Ground-truth dimensions must be internally consistent with the transcript.** `issue_identification`, `prioritization`, and `revision_evaluation` are derivable from the transcript + planted bugs via `computeEffectiveness`. The fixture's expected band on these three dimensions should agree with the deterministic effectiveness score within ±1 band. If it does not, the fixture is internally inconsistent and the authoring rule is: fix the transcript, not the expected band.

5. **Communication dimensions are author-anchored.** `reasoning_quality`, `question_formation`, and `ai_direction` have no structural ground truth. Sonnet acts as oracle during CAL-3 for these three, and the fixture's expected band is the human-author anchor that Sonnet is measured against. This means the author commits to a judgment call on these three dimensions, and the judgment must be defensible when someone asks "why band 4, not band 3?".

6. **Never bake in internal IDs.** Planted bug IDs are fixture-local (start at 1), not D1 row IDs. The harness does not touch the database. This rule exists so that fixtures can be moved between environments without renumbering.

---

## What a well-authored fixture looks like

Use the two seed fixtures as worked examples:

- **`seed-001-junior-jwt-verification-miss.json`** — low-score anchor. The junior reviewer misses a critical JWT signature bypass (the code base64-decodes the payload but never calls `jwtVerify`, so `verifyClerkToken` is dead code). Reviewer focuses on naming nits, approves the PR, and accepts a revision that introduces a new token-leak bug in the error log. Expected bands 1–2 across all six dimensions. 4 planted bugs (1 critical, 2 major, 1 minor). This fixture is the *anchor for the low end of the rubric* — the scorer should produce bands that are at most 2, and if any provider outputs band 3+ on any dimension, that provider has failed the low anchor.

- **`seed-002-senior-n-plus-one-excellent.json`** — high-score anchor. The senior reviewer catches an N+1 query, a write-on-read side effect, and a missing auth guard in round 1; prioritizes correctly with an explicit positive observation on the type definitions; in round 2 catches a *second-order* cross-recruiter identity bug they themselves had missed on the first pass; acknowledges the miss while holding the line on the blocking status. Expected bands 4–5 across technical and communication dimensions. 4 planted bugs (1 critical, 2 major, 1 minor), 2 review rounds. This fixture is the *anchor for the high end of the rubric* — the scorer should produce bands that are at least 4, and if any provider outputs band 3- on any dimension, that provider has failed the high anchor.

A new fixture should be written by copying one of these two and editing, not by starting from `types.ts` blank.

---

## What gets filled in per fixture

| Field | What to write |
|---|---|
| `id` | `{seed|variant}-{NNN}-{seniority}-{scenario-slug}`. Globally unique across the folder. Used as both the filename and the directory name in `scorer-calibration-runs/{timestamp}/{provider}/{id}.json`. |
| `description` | One-line summary shown in the CAL-3 report tables. 100 characters max. |
| `tags` | Array of flat strings — language, domain, rubric-role tags. Used by CAL-3 to compute per-tag κ if the fixture set gets large enough. |
| `seniority` | `junior` \| `mid` \| `senior`. Drives the BARS weight profile in `computeOverallScore`. |
| `prContext.title` | Real-looking PR title. |
| `prContext.description` | 2–4 sentences, the kind of description a real engineer writes. |
| `prContext.instructions` | The framing the candidate reviewer would have seen. "Review as the tech lead on X." |
| `prContext.diff` | A unified diff. **This is the hardest part to author** — the diff needs to be realistic enough that a scorer reading it will believe a human wrote it, and it needs to have the planted bugs actually present at the claimed `file:line` locations. Keep under ~2,000 lines — diffs larger than that will blow the scorer's token budget. |
| `groundTruth[]` | The planted bugs, each with fixture-local `id` (1..N), `severity` (critical/major/minor), `file`, `line`, `description`. The description is what the scorer is measured against when it claims the reviewer "caught bug #N". |
| `transcript.rounds[]` | The completed review rounds. Each round has `reviewer_comments`, `reviewer_verdict`, `reviewer_summary`, `implementer_responses`. |
| `transcript.verdict` | Final verdict object with decision, summary, timestamp. |
| `expectedBands` | Per-dimension `{min, max, rationale}`. The rationale must reference specific transcript evidence (comment IDs, file:line, round numbers). |

---

## The diff problem

Authoring realistic diffs is the rate-limiting step for fixture scaling. A good diff:

- Contains the planted bugs **at the exact `file:line` the ground truth claims**, because the scorer reads both the diff and the ground truth and cross-checks. A mismatch means the scorer gets confused and either double-counts the bug or misses it.
- Is the right size for the stated seniority — junior fixtures should be ~30–80 line diffs, senior fixtures ~100–300 lines. Fixtures with 2000-line diffs are pathological and will time out the scorer.
- Has **distractor code** around the bugs — not just a minimal reproduction. The scorer's job is harder when the bugs are embedded in plausible surrounding code, and the calibration should measure that case, not the stripped-down minimal case.
- Reflects real patterns from the Pipe codebase (Hono routes, D1 queries, Clerk JWT handling, RCD consumption) because that is the codebase the production scorer will actually see.

---

## Scaling the fixture set (CAL-1 continuation)

The target per STRATEGY.md is **30–50 fixtures**. We currently have 2. Hand-authoring 30 more fixtures to that quality bar would take 20–40 hours of focused work. That is not practical as a single session.

**Seed → variant generator pattern** (future CAL-1 work):

1. **Seeds** — hand-authored anchor fixtures like the current two. One per `{seniority, rubric-role}` combination = 3 seniorities × 3 rubric roles (low / mid / high) = **9 seed fixtures**. Each seed is a full hand-authored job including the diff, the transcript, the ground truth, and the expected bands with rationale. Seeds are authored by the founder or by a strong hand-held agent pass, never by autogen.

2. **Variants** — each seed spawns 3–5 variants via an offline LLM generator. A variant keeps the seed's rubric role (low / mid / high) and the seniority, but permutes the PR domain (auth → billing → dashboard → search), the specific bug types (N+1 → missing index → wrong isolation level), and the reviewer's conversational style. The variant generator runs through Claude Code's subagent path with `model="opus"` for the seed-to-variant synthesis (following the CLAUDE.md AI routing rule: "Content pipeline — bug templates" uses Opus 4.6) and the produced variants must pass the same six authoring rules as the seeds. A human reviews each variant before it lands — variants are NOT landed autogenerated.

3. **Target distribution** — 9 seeds + ~36 variants = 45 fixtures, close to the 50 target. Coverage of the anchor range is enforced by the seed distribution (3 low + 3 mid + 3 high at minimum).

This pattern is deferred — it is not blocking CAL-2 because CAL-2 can run against the 2 seed fixtures we have for plumbing validation. CAL-3 needs n≥15 for meaningful κ so the generator becomes the critical path between "CAL-2 works" and "CAL-4 can decide".

---

## Revising fixtures after a calibration run

When CAL-3 flags a dimension with low κ, the right first question is not "which model is wrong" but "is the fixture internally consistent". Three common fixture-side failure modes:

1. **Expected bands conflict with the transcript.** The author wrote `reasoning_quality: {min: 4, max: 5}` but the transcript's `why` fields are actually one-word justifications. The scorers are agreeing with each other that the reasoning is weak; the fixture is the outlier. **Fix:** revise the expected band to match the transcript, or rewrite the transcript to match the intended band. Never leave the mismatch.

2. **Planted bug `file:line` drifted from the diff.** The diff was edited after the ground truth was written, or vice versa. The scorers fail to credit the reviewer for catching the bug because the `file:line` in the ground truth does not match where the bug actually lives in the diff. **Fix:** re-align the ground truth to the diff.

3. **The rubric role is not what the author thought.** A fixture the author intended as a "mid" anchor is actually a "high" anchor because the reviewer's comments are sharper than the seniority tag implies. Scorers correctly rate it high, disagreeing with the mid-anchored expected bands. **Fix:** change the seniority tag or tone down the review to match the seniority.

After a fixture revision, **re-run only the affected fixture** — the skill supports `--fixture-ids <id>` for exactly this case. Do not re-run the full set just because one fixture changed.
