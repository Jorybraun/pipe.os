# Scorer Calibration

> **Canonical source:** `knowledge/STRATEGY.md` §"Scorer model calibration (supports RD-19)". This folder is the operational expansion of that section — it exists so that the methodology, runbook, cost model, and fixture authoring rules have somewhere to live longer than a single STRATEGY paragraph. If STRATEGY and this folder ever disagree, STRATEGY wins and this folder is wrong.

---

## What this is

The Pipe code-review challenge is scored by an LLM against a 6-dimension BARS rubric. The scorer is the final signal a recruiter sees — it is the verdict, not a hint. A drift of 0.15 κ on `issue_identification` is the difference between a candidate being advanced and rejected.

The research brief (CR-10, 2026-04-08) is explicit that offline κ measurement against a gold-standard oracle is non-optional before picking a production scorer. This folder documents how we do that measurement, how the harness runs, what it costs, and how the decision rule converts the results into a production model pick.

The scorer is currently set to **Gemma 4 26B** (`@cf/google/gemma-4-26b-a4b-it`) as a **provisional default** pending this calibration. The model-independence rule (ADR-032 / CR-12) requires the scorer to be a different model family than the Qwen 2.5-Coder implementer it scores — Gemma satisfies that, Devstral satisfies that, Sonnet satisfies that. κ decides which one ships.

---

## Files in this folder

| File | Purpose |
|---|---|
| [`methodology.md`](methodology.md) | Statistical methodology — why weighted κ, why ICC(2,1), how Sonnet acts as oracle for the communication dimensions, what the pass/fail thresholds mean and where they come from in the research brief. |
| [`runbook.md`](runbook.md) | Operational runbook — how to run CAL-2 locally, how to read the CAL-3 report, how to interpret "should I re-run this" moments, what to do when a provider 429s or when the Sonnet half fails halfway through. |
| [`cost-and-runs.md`](cost-and-runs.md) | How many times you'll actually run this script, what each run costs, why the Sonnet half is split into a separate skill, and how to re-run only the cheap half without paying the Sonnet cost again. |
| [`fixture-authoring.md`](fixture-authoring.md) | Rules for writing a fixture that the harness can use — anchor-range coverage, rationale grounding, the seed→variant generation pattern for scaling to 30–50. |
| [`decision-log.md`](decision-log.md) | Records every CAL-4 decision with the date, the fixture-set hash, the winning model, the κ table, and the rationale. This file is the audit trail — never rewrite history, only append. |

---

## The four tasks in STRATEGY.md

| ID | What it produces | Status (2026-04-11) |
|---|---|---|
| **CAL-1** | Fixture set under `workers/api/fixtures/scorer-calibration/` — schema + seed fixtures covering the anchor range. | **Partial** — schema + 2 anchor fixtures landed in commit `1e50439`. Scaling to the 30–50 target is deferred to a seed→variant generator (see `fixture-authoring.md` §"Scaling"). |
| **CAL-2** | `workers/api/scripts/calibrate-scorer.ts` — runs `scoreReviewSession` against every fixture under Gemma / Devstral / Sonnet and writes raw results to `workers/api/fixtures/scorer-calibration-runs/{timestamp}/{provider}/{fixture}.json`. | **Not started** — design locked in `runbook.md`, hybrid script+skill split (see `cost-and-runs.md`). |
| **CAL-3** | `workers/api/scripts/analyze-scorer-calibration.ts` — reads a run directory, computes per-dimension weighted κ + ICC(2,1) + bias + MAE, writes `report.md`. | **Not started.** |
| **CAL-4** | Decision entry in `decision-log.md` picking the production scorer model. Updates `SCORER_WORKERS_AI_MODEL` in `scorerAgent.ts` if the pick changes. | **Not started.** Blocked on CAL-3. |

---

## Why this folder exists instead of just living in STRATEGY.md

Three reasons:

1. **Operational depth.** STRATEGY.md is the plan — it names the methodology and the pass threshold. It is not the place to document what happens when the Mistral API returns 429 halfway through a run, or how to merge a Sonnet skill result back into the Gemma/Devstral directory, or why we chose n=15 per dimension over n=30. That operational detail fills a folder, not a paragraph.

2. **Re-run frequency.** This is not a one-shot script. It runs every time the scorer prompts change, the rubric weights change, the fixture set grows, or a provider model version is bumped — and the 2026-04 research brief recommends quarterly re-calibration even without changes, because upstream vendors silently revise their endpoints. A runbook that gets used quarterly needs to live somewhere findable.

3. **Decision auditability.** The CAL-4 pick is a load-bearing decision — it determines the model that generates the verdict every recruiter sees. We need a tamper-evident log of every calibration run and every decision, not just the current winner. `decision-log.md` is append-only.

---

## Read order for a first-time reader

1. **`methodology.md`** — understand what κ actually measures and why 0.75 is the threshold. Without this, the runbook looks like magic numbers.
2. **`cost-and-runs.md`** — understand the Sonnet budget before you run anything, and understand why the script is split into a script + skill instead of being one thing.
3. **`runbook.md`** — then actually run it.
4. **`fixture-authoring.md`** — read this only when you're about to add or scale the fixture set. Not needed for the first CAL-2 smoke run against the 2 seed fixtures.
5. **`decision-log.md`** — read this to see what was decided last time and why. Append to it when CAL-4 completes.
