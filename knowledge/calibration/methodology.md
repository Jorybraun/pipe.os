# Scorer Calibration — Methodology

> This document explains *why* we measure scorer agreement the way we do. The operational "how to run it" lives in [`runbook.md`](runbook.md); the fixture authoring rules live in [`fixture-authoring.md`](fixture-authoring.md). Read this one first.

---

## The problem we are solving

Three candidate scorer models — Gemma 4 26B on Workers AI, Devstral Small on Mistral, and Claude Sonnet 4.5 on Anthropic — all claim to produce BARS scores on the same 6-dimension rubric. The research brief's model routing table (CR-12, `knowledge/outputs/code-review-content-sourcing.md` Part 3.6) lists Devstral as production scorer with Sonnet 4.5 as the offline oracle, but that pairing was inherited from the code-review-arena spec and has never been empirically validated against our 6-dimension BARS rubric on our own data. Gemma 4 26B is a strong candidate because it is already in the Workers AI binding, is cheaper than both alternatives, and satisfies the model-independence rule against the Qwen 2.5-Coder implementer it scores.

The question the calibration harness answers: **do these three models produce statistically indistinguishable BARS scores on our fixture set?** If yes, we ship Gemma. If no, the pattern of disagreement determines the routing — possibly shipping different models for different dimensions, possibly shipping Sonnet as the production scorer and widening the cost budget.

---

## Why agreement, not accuracy

A naive framing would be: "run every fixture, compare scorer output to ground truth, pick the most accurate model." That framing does not work for three of the six BARS dimensions.

The rubric splits into two halves:

**Ground-truth dimensions** — `issue_identification`, `prioritization`, `revision_evaluation`. Each fixture's `groundTruth[]` enumerates the planted bugs, the severity, and the expected outcome. A scorer's output on these three dimensions *can* be checked against structural truth — either the reviewer caught bug #2 or they did not. For these dimensions, the deterministic effectiveness score (`computeEffectiveness` in `workers/api/src/lib/scoring.ts`) is the operative number and the LLM's 1–5 band is the narrative wrapping around it.

**Communication dimensions** — `reasoning_quality`, `question_formation`, `ai_direction`. These have no structural ground truth. A comment's "why" field is either well-reasoned or it is not; a question is either well-formed or it is not; AI-direction guidance is either specific enough for the implementer to act on or it is not. There is no ledger of planted bugs that tells us the correct band. Something has to be the referent, and that something has to be a strong reasoning model that humans trust.

For the communication half, **Sonnet 4.5 is the oracle by construction** — we treat its band as the correct answer and measure how often Gemma and Devstral agree with it. For the ground-truth half, Sonnet is just another scorer, not privileged.

Accuracy framing only works on 3 of 6 dimensions. Agreement framing — Cohen's κ between model pairs — works on all 6, and for the communication dimensions the Gemma↔Sonnet and Devstral↔Sonnet κ values *are* the operative numbers since there is no external referent to compare against.

---

## Why weighted Cohen's κ, quadratic weights

Raw Cohen's κ treats all disagreements equally — a scorer that calls a session "band 2" when the oracle calls it "band 3" is penalized exactly the same as a scorer that calls it "band 1" when the oracle calls it "band 5". That is wrong for an ordinal scale like BARS. Adjacent-band disagreement is routine — the research brief explicitly notes that human reviewers disagree by ±1 band on BARS routinely — while a four-band gap is a catastrophic failure that should dominate the κ computation.

Weighted κ uses a weight matrix to penalize large disagreements more than small ones. Two weight schemes are common: **linear** (disagreement weight proportional to band distance) and **quadratic** (disagreement weight proportional to the square of band distance). We use quadratic weights because:

1. The BARS anchor definitions (1 = "fails to identify any meaningful issues", 5 = "argument anchored in specific failure modes") are non-linear — the gap between band 1 and band 2 is qualitatively smaller than the gap between band 3 and band 5, because the lower bands describe absence of a thing and the upper bands describe degrees of a present thing. Quadratic weights approximate that non-linearity.
2. Quadratic weighted κ is mathematically equivalent to the intraclass correlation coefficient under specific assumptions, which lets us use the same number as both an agreement statistic and a reliability statistic.
3. The research brief's target (κ ≥ 0.75) is conventionally reported against quadratic weighting.

Linear weighting would be defensible and would produce slightly more forgiving numbers. We use quadratic so our pass threshold is the conservative one.

---

## Why ICC(2,1) as a composite

Cohen's κ measures agreement on a single dimension between a single pair of raters. If we only reported six per-pair κ values, we would have 18 numbers to interpret (3 pairs × 6 dimensions) and no single "did this model pass overall" answer. ICC(2,1) — the two-way random-effects, single-rater, absolute-agreement intraclass correlation — gives us a composite reliability number across the 6-dimension vector.

Why (2,1) specifically:
- **Two-way** because both the fixture (row) and the scorer (column) are random factors. A one-way model would assume fixtures are random but scorers are fixed, which is wrong — we are trying to decide which scorer to ship, so the scorer is a sample from a population of possible scorers, not a fixed constant.
- **1** because the production scorer will be a single rater, not an average of multiple raters. We are not shipping a jury of LLMs; we are shipping one model.
- **Absolute agreement** rather than consistency because systematic bias (e.g. Gemma consistently scoring 0.5 bands higher than Sonnet) is a real problem — we do not want to treat Gemma as "in agreement" just because its *relative* ordering tracks Sonnet.

ICC(2,1) is reported alongside the per-dimension κ table so a reader can see both the headline composite and the per-dimension breakdown. A model that passes the composite but fails on one specific dimension triggers the per-dimension escalation rule (see below).

---

## Why we also report bias and MAE

Cohen's κ has a known weakness: **prevalence and bias paradoxes**. A scorer can have high κ and still be systematically wrong — for example, if both raters drift 0.5 bands in the same direction they will agree with each other and have κ near 1, while both being 0.5 bands off the truth. This is rarer with quadratic weighting than with raw κ but it is not impossible.

To catch this we report two additional statistics in the CAL-3 report:

1. **Bias** — the mean score delta per dimension per pair (Gemma minus Sonnet, Devstral minus Sonnet, Gemma minus Devstral). A bias near zero means the scorers agree on average even when they disagree on individual cases; a bias of +0.6 means the first scorer systematically rates higher than the second. Bias is directional and lets us catch leniency or severity drift that κ alone masks.

2. **MAE** per dimension per pair — the mean absolute distance between scores. MAE is unweighted and easy to interpret ("on average, Gemma and Sonnet give scores that are 0.3 bands apart"). It is not a substitute for κ but it is the number to quote in stakeholder writeups because κ is hard to explain to someone who has not encountered it.

---

## Pass threshold and escalation rule

**Pass threshold: κ ≥ 0.75 on every dimension.**

This value matches the ADR-032 CR-10 gold-standard oracle target and is the conventional "substantial agreement" cutoff in the inter-rater reliability literature. κ ≥ 0.75 means the scorers agree on the band more than 75% of the variance that is not attributable to chance, which is good enough that a production scorer can be trusted to produce verdicts that a human rater would also produce. Lower thresholds (0.60, "moderate agreement") are routine in social-science research but are not strong enough for a hiring verdict.

**Escalation rule: any dimension with κ < 0.70 against Sonnet must be escalated to run on Sonnet live**, while the rest of the dimensions stay on the cheap model. This is the same per-dimension pattern ADR-032 uses for the consistency classifier — we do not blanket-upgrade to the expensive model when only one dimension is borderline. The 0.70 threshold is deliberately lower than the 0.75 pass threshold because it is *an escalation trigger*, not a pass/fail gate. Between 0.70 and 0.75 we keep the cheap scorer and note the dimension as borderline in the decision log; below 0.70 the dimension is escalated regardless.

**Tie-breaking when multiple cheap models pass.** If Gemma and Devstral both clear κ ≥ 0.75 with overlapping 95% confidence intervals, we pick **Gemma** because it is already in the Workers AI binding (no extra API key, no extra fetch overhead, no extra rate-limit regime), is the cheapest of the three, and satisfies the model-independence rule against the Qwen implementer. Devstral only wins the tie if its κ meaningfully exceeds Gemma's (non-overlapping CIs) on at least one dimension, which in practice means the fixture set is too small and we should scale it before deciding.

**Failure mode.** If neither Gemma nor Devstral clears κ ≥ 0.75, Sonnet 4.5 becomes the production scorer and the Phase 3 cost budget is revised upward in a new decision log entry. This is the expensive outcome and is what the calibration exists to rule out before we ship.

---

## Why Sonnet is the oracle for communication dimensions (and only those)

The communication dimensions have no structural referent — there is no list of planted bugs that tells us whether a comment's "why" was adequate. Something has to be the arbiter, and the research brief (CR-10, 2026-04-08) specifies that the arbiter must be a strong reasoning model, explicitly naming Claude Sonnet 4.5. Three reasons:

1. **Capability.** Sonnet is a larger, more capable reasoning model than either Gemma 4 26B or Devstral Small, and the 2026-04 research brief cites published inter-rater reliability studies showing Claude 3.5/4.x-class models produce κ values in the 0.78–0.85 range against human expert panels on BARS-style rubrics. Gemma and Devstral are untested at this task and are what we are measuring.

2. **Independence from the Pipe stack's own biases.** The implementer agent is Qwen, the challenge generator uses Gemma via RCD, the consistency classifier is Gemma. A scorer drawn from the same family pool bakes in shared failure modes. Anthropic's models are genuinely from a different lineage and are unlikely to share the same blind spots.

3. **The research brief commits us to it.** CR-10 names Sonnet 4.5 as the offline oracle by product decision, not because we independently derived that conclusion. Overriding it would require the ADR-033 guardrail procedure (surface the contradiction, name the risk, ask for explicit override, record in the decision log).

For the **ground-truth dimensions**, Sonnet is not privileged — it is just another scorer being measured against the structural referent that the fixture already carries (`computeEffectiveness` output + planted bug list). Gemma, Devstral, and Sonnet are all measured the same way on those three dimensions.

---

## Why n=15 per dimension is the floor

Cohen's κ has wide confidence intervals at small n. At **n=15 fixtures per dimension** the 95% confidence interval on a κ estimate of 0.75 is approximately ±0.15, which is wide enough that a single borderline dimension could plausibly flip on re-run. At **n=30** the CI narrows to approximately ±0.10, and at **n=50** to approximately ±0.08. The research brief's target is 30–50 for this reason.

We accept n=15 as the operational floor for a first real CAL-3 run because:

- The fixture set will grow over time and re-calibration is a routine operation, not a one-shot. The first run at n=15 is not the forever run.
- The two seed anchor fixtures cover the full anchor range (low: junior JWT miss, high: senior N+1 catch), which means κ will not suffer range restriction even at small n.
- A n=15 result with wide CIs still tells us whether any dimension is *catastrophically* disagreeing (κ < 0.4), which is the failure mode we most need to detect early.

The calibration harness is designed to be re-run as the fixture set grows. The first result at n=15 is a smoke measurement; the first decision-worthy result is at n=30; the quarterly re-calibration target is n≥50.

---

## Why this methodology is different from the culture scorer calibration

The culture agent has its own scorer, its own fixture set, and a conceptually identical calibration question (OQ-2 in STRATEGY.md asks whether Devstral is the right model for behavioral scoring). The methodology in this folder transfers directly to the culture side — same weighted κ, same Sonnet-as-oracle pattern, same pass threshold — but with a different fixture set that reflects behavioral-interview transcripts rather than code-review PRs. When we run the culture equivalent, this folder will be linked from the corresponding culture-calibration folder and the statistical choices will not be re-derived.

OQ-2 is partially subsumed by this work: the Devstral-on-behavioral-scoring question does not apply to the code-review rubric, but the harness and analysis scripts from CAL-2/CAL-3 will be reusable for the behavioral calibration with fixture-set substitution only.
