# Scorer Calibration — Cost and Re-run Frequency

> How much this actually costs, how often you will run it, and why the Sonnet half is routed through a subagent instead of the Anthropic API.

---

## The cost question in one sentence

A full calibration run at n=50 fixtures costs **~$1 out of pocket** (Devstral API + trivial Gemma quota) plus **~300 subagent turns** against the Claude Code subscription for the Sonnet half. There is no Anthropic API spend — the subagent routes Sonnet through the user's existing Claude Code subscription.

---

## Per-provider cost breakdown

The scorer makes three LLM calls per fixture: Scorer A (`SCORER_A_PROMPT` with transcript + diff + ground truth, `max_tokens=3000`), Scorer B (`SCORER_B_PROMPT` with transcript only, `max_tokens=2048`), and the Synthesizer (`SYNTHESIZER_PROMPT` with just the dimension scores and summaries, `max_tokens=1024`).

Rough token accounting per fixture:

| Call | Input tokens | Output tokens (actual) |
|---|---|---|
| Scorer A | ~6,000 | ~2,500 |
| Scorer B | ~3,000 | ~1,500 |
| Synthesizer | ~500 | ~500 |
| **Total per fixture** | **~9,500** | **~4,500** |

Scaled to runs:

| Fixture count | Input tokens (total) | Output tokens (total) |
|---|---|---|
| 2 (seed set) | 19K | 9K |
| 15 (power floor) | 142K | 67K |
| 50 (target) | 475K | 225K |

### Gemma (Workers AI REST)

Workers AI's Gemma 4 26B is on the daily-quota model — 10,000 calls per day on the free tier. A 50-fixture run uses 150 calls (3 scorer calls × 50 fixtures). We are three orders of magnitude below the ceiling. **Effective cost: $0.** The only way to blow this budget is an infinite retry loop.

### Devstral (Mistral API)

Mistral Devstral Small is metered at approximately $0.30/M input tokens and $0.90/M output tokens as of 2026-04. Per run:

| Fixture count | Input cost | Output cost | Total |
|---|---|---|---|
| 2 | $0.006 | $0.008 | $0.014 |
| 15 | $0.043 | $0.060 | $0.103 |
| 50 | $0.143 | $0.203 | **~$0.35** |

Devstral is the only real out-of-pocket cost and it is still under a dollar per full run. Even ten full runs fit inside a single cup of coffee.

### Sonnet (two options)

**Option 1 — Anthropic API (rejected for cost reasons).** Claude Sonnet 4.5 is priced at $3/M input and $15/M output. Per fixture: ~$0.091. Per run:

| Fixture count | Cost |
|---|---|
| 2 | $0.18 |
| 15 | $1.37 |
| 50 | **~$4.55** |

At 3–5 runs before CAL-4 decides, that is ~$14–$23 of Anthropic API spend to pick a scorer model. Not expensive in absolute terms, but the user has explicitly said they do not want a new API line item.

**Option 2 — Subagent via Claude Code subscription (chosen).** The `/calibrate-scorer` skill launches a Sonnet subagent via the Agent tool with `model="sonnet"` after Phase A completes. The subagent reads each fixture, mentally applies the scorer prompts, and writes the `ScoreReport` JSON to disk. Cost is **$0 marginal** — the Claude Code subscription is already paid for.

Budget impact per run at n=50 is roughly 100–300 subagent turns, well within a normal day of Claude Code usage. There is no dollar cost; there is a usage budget that the user already has.

**Total per run at n=50, chosen shape:** ~$0.35 Devstral + $0 Gemma + $0 Sonnet = **~$0.35 out of pocket**, plus a modest subscription usage footprint.

---

## How many times will you run this?

### Before CAL-4 decides: 3–5 runs

1. **Smoke run against the seed set (2 fixtures).** The first run is always about plumbing, not measurement. You are checking that the Phase A script talks to Cloudflare AI REST and Mistral correctly, that the Sonnet subagent writes to the right path with the right JSON shape, and that the CAL-3 analyzer reads all three providers' outputs. 2 fixtures is enough for this — κ on n=2 is meaningless but the plumbing either works or it doesn't. Typically 1–2 iterations here because the first run always surfaces *something*.

2. **First real run at n≥15.** Once you scale the fixture set up to 15 or more, the first real measurement pass. Power floor — κ confidence intervals are wide at n=15 so the result is directional, not definitive.

3. **Stability re-run (same fixtures, same providers).** LLM scoring has temperature variance — the scorer prompts run at default temperature (not 0) because the research brief's oracle studies were done at default temperature and we want to replicate the conditions under which κ ≥ 0.75 was reported. If the first n=15 run shows Gemma at κ=0.74 on a dimension, you do not know whether that is a real miss of the threshold or noise on the confidence interval. Re-running the same fixtures tells you. This is the most common "did I really need to run this again" moment.

4. **Possibly a third** if (2) and (3) disagree enough that you need to raise n to 30 or lower temperature and re-run. This is the step that consumes the remaining budget if you hit it.

### After CAL-4 decides: 1 run per change

Re-calibration triggers:

- Any change to `workers/api/src/lib/scorerPrompts.ts` (prompt edits invalidate the previous κ)
- Any change to `workers/api/src/lib/scoring.ts` or `workers/api/src/lib/scorerRubric.ts` (rubric weight or band definition changes)
- Any change to the fixture set large enough to shift the anchor range (adding a fixture in the middle of the range is not a trigger; adding a fixture that pushes a dimension's minimum or maximum is)
- Any provider model version change — e.g. Gemma 4 → Gemma 5, or Devstral Small → Devstral Medium
- **Quarterly** even with no changes, because upstream vendors silently revise their endpoints. This is a maintenance run, not a decision run; if the κ matches the previous quarter's within CI, nothing changes.

Expected steady-state rate: **one re-calibration every 6–10 weeks** depending on how often prompts or rubric land. Each steady-state run is ~$0.35 out of pocket plus the subagent budget.

---

## Cost control levers if the budget tightens

1. **Skip Phase B entirely with `--skip-sonnet`.** Useful when you are debugging the Phase A plumbing or iterating on a fixture. You get Gemma vs Devstral comparison for free-at-the-margin. You cannot run CAL-3 without the Sonnet leg, but you can inspect individual scorer outputs and sanity-check them.

2. **Re-run only one provider with `--only gemma` or `--only devstral`.** When Phase A failed halfway through and you only want to re-try the broken provider, not both. The run directory is shared so CAL-3 still sees complete data after the second partial run.

3. **Re-run Phase B only with `--sonnet-only --run-dir ...`.** When Phase A succeeded but the Sonnet subagent failed or wrote bad JSON. Cheapest retry, does not re-pay for Gemma or Devstral.

4. **Smaller smoke runs with `--fixture-ids seed-001,seed-002`.** When you are editing the scorer prompts and want a fast signal, not a full re-run. Runs the two anchor fixtures against all three providers in under a minute.

5. **Temperature zero for stability runs.** Setting temperature to 0 in the provider calls (not the default) removes most of the run-to-run variance and lets you re-run only the runs that changed something. The tradeoff is that you are now measuring κ under different conditions than the published oracle studies, which weakens the claim that κ ≥ 0.75 maps to "substantial agreement". Use this lever only for stability checks, not for the first-pass decision.

---

## Why the Sonnet subagent is worth the shape complexity

The alternative to a subagent-routed Sonnet is to put `ANTHROPIC_API_KEY` in `.dev.vars` and call the Anthropic API directly from the Node script. That is simpler by one dimension — no skill, no phase orchestration, one script that does everything — and costs an extra ~$15–$25 of Anthropic API spend over the full CAL-2/CAL-3/CAL-4 cycle.

We are choosing the more complex shape for four reasons:

1. **The user owns a Claude Code subscription and does not have a working Anthropic API key.** This is the proximate reason. Spinning up a new API key for a one-shot calibration with quarterly refreshes is the exact kind of marginal-cost decision that feels small in isolation but compounds into operational drag over years of re-runs.

2. **Subagent routing is reusable.** Content pipeline variant generation (CLAUDE.md AI routing table) also runs through the Agent tool, not direct API. Culture scorer calibration will need the same oracle pattern when its equivalent of CAL-2 runs. Building the subagent-orchestration pattern once for scorer calibration means the culture team can reuse it without re-deriving the plumbing.

3. **Model pinning is easier through Claude Code.** The subagent takes `model="sonnet"` as an explicit parameter — whichever Sonnet generation the Claude Code client currently points at is the version the subagent uses. If we pin to a specific API model ID (`claude-sonnet-4-5`), we have to remember to update that string on every Sonnet minor-version bump, and the deprecation schedule for older Sonnet IDs is 12 months from last refresh. The subagent path hands that problem to Anthropic's deprecation pipeline instead of ours.

4. **The hybrid shape is genuinely faster to debug.** When Phase A fails, you retry Phase A. When Phase B fails, you retry Phase B. The two halves cannot corrupt each other because the handoff between them is a directory on disk, not in-memory state. A single script that did all three providers would have to handle partial-failure state across providers inside one process.

The shape complexity is front-loaded — writing the skill + script costs more the first time than a monolithic script would. But re-runs are cheaper and less error-prone, and re-runs are what we actually do most of the time.
