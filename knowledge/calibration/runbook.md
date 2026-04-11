# Scorer Calibration — Runbook

> Operational "how to run it" guide. For statistical methodology read [`methodology.md`](methodology.md) first. For the cost model and re-run frequency read [`cost-and-runs.md`](cost-and-runs.md).

---

## Architecture — one skill, two phases

Calibration is invoked through a single slash command: **`/calibrate-scorer`**. The skill orchestrates the full run end-to-end in two phases. There is no second script for the user to remember.

```
/calibrate-scorer
      │
      ▼
┌─────────────────────────────────────────────────┐
│  Phase A — cheap half                           │
│  Skill shells out: `tsx calibrate-scorer.ts`    │
│  Script iterates fixtures × { gemma, devstral } │
│  Hits CF AI REST + Mistral REST directly        │
│  Writes results to {run-dir}/gemma/*.json       │
│                    {run-dir}/devstral/*.json    │
└─────────────────────────────────────────────────┘
      │
      ▼  (script exits 0, skill resumes)
┌─────────────────────────────────────────────────┐
│  Phase B — Sonnet half                          │
│  Skill launches a Sonnet subagent via Agent     │
│  tool with model="sonnet" and the fixture list  │
│  Subagent reads each fixture, produces the 6    │
│  scores + evidence inline (no API key needed),  │
│  writes {run-dir}/sonnet/*.json                 │
└─────────────────────────────────────────────────┘
      │
      ▼
{run-dir}/manifest.json  ← written by the skill after both phases land
```

**Why this shape.**

1. **Cost.** Phase B goes through the subagent rather than the Anthropic API because the user already pays for Claude Code and does not want a separate API line item. See [`cost-and-runs.md`](cost-and-runs.md) for the full budget argument — the short version is that the Sonnet half is free-at-the-margin via the subscription and ~$4.50 per run via the API.

2. **Single entry point.** The user runs `/calibrate-scorer` and walks away. The skill handles the shell-out, waits for the script to exit, checks the exit code, and launches the subagent. There is no "now go run step 2" instruction buried in a runbook.

3. **Phase isolation.** When Phase A fails (Mistral 429, Cloudflare AI rate limit, a fixture that breaks JSON parsing on one specific provider), the skill can retry Phase A alone without re-paying for Phase B. When Phase B fails mid-subagent, the skill can re-launch the subagent against the remaining fixtures without re-running Gemma or Devstral.

4. **Debuggability.** Each phase writes its output to disk before handing off. If CAL-3 reports a weird κ value, we can inspect the raw JSON in `{run-dir}/{provider}/{fixture}.json` and see exactly what each scorer produced — no in-memory state is hidden between phases.

---

## Files the skill needs

| Path | Role |
|---|---|
| `.claude/commands/calibrate-scorer.md` | The skill file — orchestrates the two phases. Invoked as `/calibrate-scorer`. |
| `workers/api/scripts/calibrate-scorer.ts` | Phase A script. Pure Node, reads fixtures off disk, calls CF AI REST + Mistral REST, writes JSON. Does NOT touch Sonnet. Re-runnable with `--only gemma` or `--only devstral`. |
| `workers/api/scripts/analyze-scorer-calibration.ts` | CAL-3 analyzer. Reads a run directory, computes weighted κ + ICC(2,1) + bias + MAE, writes `report.md`. Independent of the skill — runnable on any run directory at any time. |
| `workers/api/fixtures/scorer-calibration/*.json` | Input fixtures (CAL-1). |
| `workers/api/fixtures/scorer-calibration-runs/{ISO-timestamp}/` | Output directory per run. Always a new timestamped subdirectory — prior runs are preserved for regression comparison. |

---

## Phase A — the cheap half (Gemma + Devstral)

### What the script does

1. Loads every `*.json` file from `workers/api/fixtures/scorer-calibration/` and parses as `ScorerCalibrationFixture`.
2. For each fixture × each provider in `{gemma, devstral}` (skippable with `--only`), builds a `ScorerInput` payload — `transcript`, `groundTruth`, `prContext.diff/title/description/instructions`, `seniority` — and calls `scoreReviewSession` with the provider override.
3. Writes the returned `ScoreReport` to `{run-dir}/{provider}/{fixture.id}.json`, along with wall-clock latency and approximate input-token count for cost tracking.
4. Writes partial progress after every fixture completes (not at the end), so a crashed run can be resumed without losing work.
5. Exits 0 on success, non-zero on any unretryable failure. The skill reads the exit code before proceeding to Phase B.

### Why Gemma goes through the REST API, not the Worker binding

The script runs in Node, not in the Worker runtime. It cannot `import` the `AI` binding — there is no Worker to bind to. Two options exist:

- **Option A (chosen).** Hit Cloudflare's public AI REST endpoint directly: `https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/ai/run/@cf/google/gemma-4-26b-a4b-it`. Needs `CF_ACCOUNT_ID` and `CF_AI_TOKEN` in `.dev.vars`. No Worker stood up, no miniflare, no extra machinery. The script constructs a fake `Ai` object whose `run` method proxies to the REST endpoint, and passes it to `scoreReviewSession` via `input.ai`.
- **Option B (rejected).** Stand up a `/rpc/calibrate` route on the local Worker, run `wrangler dev`, have the script hit that route. This uses the real `AI` binding but costs a Worker process running during calibration, a route that exists for no production purpose, and an extra layer of indirection between the script and the provider.

Option A is lighter for an offline script. The fake `Ai` shim is ~30 lines.

### Concurrency

- **Sequential within a provider.** Mistral's rate limit on the free tier is aggressive, and Cloudflare AI's Gemma daily quota is 10k calls. Sequential per-provider avoids both issues and keeps wall-clock predictable.
- **Parallel across providers.** Gemma and Devstral run in parallel since they hit different APIs with independent rate limits. The script uses `Promise.all` at the provider level, not the fixture level.
- **Retry on 429/5xx.** Exponential backoff, max 3 attempts, then the fixture is marked as `status: "failed"` in the output and the script moves on — one broken fixture does not abort the whole run.

### Cost

- Gemma: free-ish on Workers AI (daily quota 10k calls). A 50-fixture run uses 150 calls.
- Devstral: ~$0.01 per fixture. A 50-fixture run is ~$0.50–$1.
- Full Phase A cost for a 50-fixture run: **~$1**, bounded.

---

## Phase B — the Sonnet half via subagent

### What the skill does after Phase A exits 0

1. Reads the list of fixture IDs from `{run-dir}/gemma/` (or `devstral/` — both should have the same set after a successful Phase A).
2. Launches a single subagent via the Agent tool with `model="sonnet"` and a tightly-scoped prompt containing:
   - The run directory path.
   - The full list of fixture file paths under `workers/api/fixtures/scorer-calibration/`.
   - Instructions: "For each fixture, read it, read the SCORER_A_PROMPT / SCORER_B_PROMPT / SYNTHESIZER_PROMPT from `workers/api/src/lib/scorerPrompts.ts`, score the transcript yourself as if you were running through the prompts, and write the result as JSON to `{run-dir}/sonnet/{fixture.id}.json` in the same shape `scoreReviewSession` returns."
   - The expected JSON schema (a literal `ScoreReport` shape for copy-paste reference).
3. Waits for the subagent to return.
4. Verifies that `{run-dir}/sonnet/` contains one file per fixture ID. If not, re-launches the subagent against the remainder.
5. Writes `{run-dir}/manifest.json` with the run metadata: timestamp, fixture hashes, provider versions, command used, total wall clock, total cost estimate.

### Why a single subagent instead of one per fixture

Launching one subagent per fixture is cleaner in principle (smaller prompts, better isolation) but wastes a lot of overhead on subagent spin-up. A single subagent with the full fixture list in the prompt can read them all and produce all the outputs in one conversation — same way a batch script would. The subagent is explicitly told to write to disk after every fixture so a mid-run failure preserves partial progress.

If the single-subagent shape turns out to be unreliable (e.g. Sonnet drifts on later fixtures, or the subagent hits its own context limit on large fixture counts), the fallback is to launch one subagent per *batch* of 5 fixtures — still not one-per-fixture, but enough segmentation to stay inside the reasoning budget.

### What the subagent does, step by step

The skill's subagent prompt is essentially:

> You are scoring code-review sessions against the 6-dimension BARS rubric defined in `workers/api/src/lib/scorerPrompts.ts`. For each of the following fixtures: (1) read the fixture JSON, (2) read the three prompt files and mentally apply them as the system prompt, (3) produce a JSON object matching the `ScoreReport` TypeScript interface in `workers/api/src/lib/scorerAgent.ts`, (4) write that JSON to the specified output path using the Write tool. Do NOT skip fixtures. Do NOT invent scores that you cannot support from the transcript. If a fixture is malformed, write an `error` object to that fixture's output path and continue.

The subagent runs as the Sonnet model via Claude Code's subscription — no API key, no per-call billing. Wall-clock cost is measured in subagent turns, not dollars.

### Cost

- Per run: ~45 scoring operations per 15 fixtures × roughly 2-3 subagent turns each = ~100 subagent turns for n=15, ~300 for n=50.
- Subscription billing, no marginal dollars. See [`cost-and-runs.md`](cost-and-runs.md) for the full accounting.

---

## Running it

```bash
# Dry-run Phase A only, skips the subagent. Use for plumbing debug.
/calibrate-scorer --skip-sonnet

# Full run against the current fixture set
/calibrate-scorer

# Re-run only against one provider (Phase A only, skip the other two)
/calibrate-scorer --only gemma

# Re-run Phase B against a specific existing run directory
/calibrate-scorer --sonnet-only --run-dir fixtures/scorer-calibration-runs/2026-04-11T18-00-00

# Run CAL-3 analysis against a completed run
tsx workers/api/scripts/analyze-scorer-calibration.ts fixtures/scorer-calibration-runs/2026-04-11T18-00-00
```

### Environment

Add to `workers/api/.dev.vars` (and `.dev.vars.example`):

```
CF_ACCOUNT_ID=...              # Cloudflare account ID for AI REST calls
CF_AI_TOKEN=...                # Cloudflare API token with Workers AI Run permission
```

Already present in `.dev.vars.example`:
- `MISTRAL_API_KEY` — used by Phase A for Devstral
- `ANTHROPIC_API_KEY` — **not needed** by the hybrid skill shape (Sonnet runs via subagent, not API)

The `ANTHROPIC_API_KEY` line stays in `.dev.vars.example` because the Worker runtime still uses it for the emergency fallback path defined in CLAUDE.md. The calibration skill just doesn't touch it.

---

## Interpreting Phase A output

Each fixture produces a `{run-dir}/{provider}/{fixture.id}.json` file with this shape:

```json
{
  "fixture_id": "seed-001-junior-jwt-verification-miss",
  "provider": "gemma",
  "model": "@cf/google/gemma-4-26b-a4b-it",
  "score_report": { /* full ScoreReport from scoreReviewSession */ },
  "meta": {
    "wall_clock_ms": 8421,
    "input_tokens_approx": 9213,
    "output_tokens_approx": 3421,
    "attempts": 1,
    "status": "ok"
  }
}
```

On `status: "failed"` the file contains a best-effort partial report plus the error text. CAL-3 will skip failed fixtures and note them in the report.

---

## Interpreting Phase B output (Sonnet subagent)

Same shape as Phase A, but the `meta` block has different fields:

```json
{
  "fixture_id": "seed-001-junior-jwt-verification-miss",
  "provider": "sonnet",
  "model": "claude-sonnet-4-5",
  "score_report": { /* ScoreReport */ },
  "meta": {
    "source": "claude-code-subagent",
    "subagent_turn_estimate": 3,
    "status": "ok"
  }
}
```

Wall-clock and token counts are not tracked for Phase B because they are subscription-billed, not API-billed. The `subagent_turn_estimate` is a hand-waved cost proxy for the decision log.

---

## Common failure modes and what to do

- **`Phase A: Mistral 429` repeatedly.** The free-tier rate limit is aggressive. Either wait 5 minutes and run `--only devstral` to re-try just the failed provider, or upgrade the Mistral API key to a paid tier. Do not delete the partial results in `{run-dir}/gemma/`.
- **`Phase A: Cloudflare AI quota exceeded`.** You have hit the 10k/day Gemma quota. This is extremely unlikely for CAL-2 (a 50-fixture run is 150 calls, three orders of magnitude below the ceiling), so if you see this the culprit is probably a run loop or a broken retry. Check the script's retry counter.
- **`Phase A exits non-zero`.** The skill does NOT proceed to Phase B. Read the script's stderr, fix the underlying issue, re-run with `--only <provider>` to avoid re-running the provider that already succeeded.
- **`Phase B: subagent context limit reached`.** The fixture list is too long for a single subagent pass. Re-launch with smaller batches — the skill supports `--batch-size 5` for this.
- **`Phase B: subagent produces malformed JSON for some fixtures`.** Look at the specific fixture output. Usually it means the fixture has a corner case the prompt did not anticipate. Fix the fixture or add a prompt clarification, then re-run only the affected fixtures with `--sonnet-only --fixture-ids ...`.
- **`Report shows κ below threshold on one dimension`.** Do not retry immediately — read the per-fixture disagreement first. Often a single outlier fixture is dragging the dimension down, and the right fix is to revise the fixture or its expected bands. See [`fixture-authoring.md`](fixture-authoring.md) §"Revising fixtures".

---

## What the skill does NOT do

- **It does not run CAL-3.** `analyze-scorer-calibration.ts` is a separate script, run manually against a completed run directory. This is deliberate — CAL-3 is rerunnable against any historic run for regression comparison, and tying it to the skill would couple analysis to collection.
- **It does not write to `decision-log.md`.** CAL-4 is a human decision with a written rationale. The skill produces the data; a human writes the entry.
- **It does not change `SCORER_WORKERS_AI_MODEL` in `scorerAgent.ts`.** If CAL-4 picks a different model, the code change is a separate commit with its own CHANGELOG entry and its own review.
