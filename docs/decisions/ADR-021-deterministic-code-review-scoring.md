# ADR-021: Deterministic Algorithm for Code Review Scoring

**Date:** 2026-03-20
**Status:** Accepted

## Context

The `scoringAgent` Lambda was a stub returning `{ score: 0, message: 'SCHEMA_PUSH_STUB' }`. A real scoring algorithm is needed for CODE_REVIEW submissions.

Two broad approaches:

1. **LLM-based scoring** — Send the candidate's annotations + ground truth to Claude and ask it to evaluate quality/accuracy
2. **Deterministic algorithm** — Compare candidate annotations against a ground-truth list of known bugs; compute a score from structural properties of the submission

## Decision

**Use the deterministic algorithm already implemented in `src/lib/scoring/codeReview.ts`**, ported directly into the Lambda.

The algorithm has four components:

| Component | Weight | Description |
|---|---|---|
| Bugs found | 40% | Candidate annotations whose `lineNumber` matches ground-truth bug lines |
| Severity accuracy | 25% | Severity classification (`critical`/`major`/`minor`) matches ground truth |
| Fix quality | 25% | Annotations with substantive comments (>10 characters) |
| False positive penalty | −10% | Annotations on non-bug lines |

Score is clamped to `[0, 100]`. Lambda updates `Assessment.score` and `Assessment.feedback` via DynamoDB `UpdateItemCommand`.

### Why not Claude for scoring?

1. **Determinism** — The same submission should always receive the same score. LLM scoring introduces variance; re-scoring a submission could change its result based on model temperature or prompt variation.

2. **Cost** — Calling Claude for every assessment adds ~$0.01–0.05 per submission. At scale, deterministic scoring is free.

3. **Auditability** — Recruiters can see exactly why a score was assigned (which bugs were found, which were missed). LLM rationales are harder to audit and may hallucinate.

4. **Speed** — Deterministic scoring completes in <100ms. LLM scoring adds 2–10s latency.

5. **Ground truth already exists** — `Challenge.serverConfig` stores the list of known bugs with line numbers and severities. This is the reference data a deterministic scorer needs.

### QUIZ_MCQ scoring

Also deterministic: compare `submission.answers.current` against `serverConfig.correctOptionId`. Score is 100 if correct, 0 otherwise.

### Manual review for SHORT_ANSWER and CODE_IMPLEMENTATION

These types do not score automatically. `Assessment.score` defaults to 0. Recruiters set the score manually via the slider in `CandidateProfilePage`.

## Consequences

**Positive:**
- Deterministic, auditable, zero-cost per assessment
- Fast (<100ms Lambda execution)
- Reuses existing `codeReview.ts` scoring logic — no new algorithm to maintain

**Negative:**
- Requires ground truth in `Challenge.serverConfig` — challenges without ground truth score 0
- Severity weight is opinionated (40/25/25/−10); may need tuning as data accumulates
- No holistic review quality signal (e.g. whether the candidate's summary was insightful)

## Future

Post-MVP: consider supplementing with an LLM quality signal for the summary/verdict fields, stored separately from the deterministic bug-finding score. This preserves auditability of the base score while adding qualitative depth.
