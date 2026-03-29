# ADR-024: Multi-Turn Agentic Code Review

**Date:** 2026-03-29
**Status:** Accepted
**Supersedes:** [ADR-021 — Deterministic Code Review Scoring](ADR-021-deterministic-code-review-scoring.md)

---

## Context

The current code review challenge is single-turn: the candidate leaves annotations on a PR diff, submits, and a deterministic algorithm scores them by matching line numbers against ground truth (ADR-021). The submit button is a stub — this flow was never completed to production.

This approach has fundamental limitations:

1. **It doesn't test what matters.** Real code review is a conversation. The most important skills — handling pushback, explaining *why* something matters, knowing when to concede, driving to resolution — are invisible in a one-shot annotation exercise.

2. **Deterministic scoring is shallow.** Matching line numbers with ±1 tolerance and checking comment length >10 characters cannot assess whether a reviewer understood the bug, calibrated severity correctly, or gave actionable guidance.

3. **No trade-off awareness.** Real PRs contain intentional design trade-offs that a strong reviewer should identify and discuss. The current system only tracks planted bugs.

4. **No conversation signal.** Recruiters learn nothing about how a candidate communicates, handles disagreement, or collaborates — the skills that differentiate senior reviewers from junior ones.

Meanwhile, the research system (`research/code-review-arena/`) has developed a complete multi-turn conversation + panel-based scoring architecture that addresses all of these gaps. It has been spec'd, prototyped, and is ready for integration.

---

## Decision

**Replace the single-turn deterministic code review flow with a multi-turn agentic conversation evaluated by a panel of specialized LLM scorers.**

### The new flow

```
Candidate                        PIPE-OS                         LLM Agents
────────                        ───────                         ──────────

1. View PR                       Serve challenge
   (brief, diff, commits)        (ground truth hidden)

2. Leave initial review    ───►  Store annotations
   (inline comments +            Send to implementer  ─────────► Implementer agent
    summary)                                                     (persona: junior/senior)
                           ◄──   Return responses     ◄─────────  pushback / clarify / fix

3. Respond to author       ───►  Append to transcript
   (defend / concede /           Send full history     ─────────► Implementer agent
    clarify)                                                      (full context)
                           ◄──   Return responses     ◄─────────

4. Repeat (2-4 rounds total)

5. Submit final verdict    ───►  Finalize transcript
   (approve / request             Send to scoring      ─────────► 3 panelists (parallel)
    changes + summary)            panel                           + synthesizer
                                                       ◄─────────
                           ◄──   Return score report
                                 (overall + per-dimension + narrative)
```

### Scoring panel (replaces deterministic algorithm)

Three specialized evaluators run in parallel on the complete transcript, followed by a synthesizer:

| Panelist | Weight | What it evaluates |
|----------|--------|-------------------|
| **Communication Analyst** | 25% | Tone, clarity, pushback handling, guidance quality |
| **Technical Evaluator** | 40% | Bug detection, severity calibration, trade-off awareness, accuracy |
| **Review Practice Evaluator** | 35% | Understanding first, prioritization, completeness, positive recognition, driving to conclusion |

Only the Technical Evaluator sees ground truth (planted bugs + design trade-offs).

The synthesizer produces:
- Overall score (0-100)
- Band: **Strong** (75-100) / **Adequate** (45-74) / **Weak** (0-44)
- Per-dimension scores with evidence quotes
- Narrative assessment readable by a hiring manager

### Implementer agent

An LLM agent that role-plays the PR author. It:
- Receives the PR it "wrote" and a persona prompt (junior/senior)
- Has **no knowledge** of planted bugs — it believes this is its real work
- Responds to all candidate comments as a batch per round
- Pushes back, asks for clarification, agrees and describes fixes, or partially agrees

Persona affects difficulty:
- **Junior:** receptive, asks questions, easy to guide
- **Senior:** defends decisions, pushes back with reasoning, stubborn on some points

### Challenge creation

Challenges are sourced from the organization's slopify repo (hardcoded). The recruiter flow:

1. Open the Add Challenge modal on a stage
2. Select "Code Review" type
3. The org's slopify repo appears in the repo dropdown (always present, per-project)
4. Browse PRs on that repo — each PR is a prepared exercise with planted bugs + trade-offs
5. Select a PR → challenge created with cached diff + ground truth from `golden/cases.json`

The slopify repo contains branches generated by the research writer lab, each with a feature brief, planted bugs, and design trade-offs defined in the golden cases.

### Ground truth structure (expanded from ADR-021)

```typescript
interface ChallengeGroundTruth {
  plantedBugs: Array<{
    id: number;
    file: string;
    line: number;
    severity: 'critical' | 'major' | 'minor';
    description: string;
    explanation: string;
  }>;
  designTradeoffs: Array<{
    id: number;
    description: string;
    context: string;           // why a reasonable dev might make this choice
    betterAlternative: string; // what a strong reviewer would suggest
    where: string;             // location in code
  }>;
}
```

---

## Alternatives Considered

### Option A — Multi-turn agentic flow with panel scoring (chosen)

- **Pros:** Tests the full spectrum of review skills. Produces rich, narrative feedback. Matches how code review actually works. Research system already built and spec'd.
- **Cons:** Higher cost per assessment (~4 LLM calls for scoring + 2-4 for conversation). Scoring has inherent LLM variance. More complex infrastructure.

### Option B — Complete the single-turn deterministic flow (ADR-021)

- **Pros:** Simple, fast, deterministic, cheap. Already partially built.
- **Cons:** Fundamentally limited — cannot assess conversation skills, pushback handling, or trade-off reasoning. The submit flow was never completed. Would ship a product that tests the least important part of code review.

### Option C — Single-turn with LLM scoring (hybrid)

- **Pros:** Richer scoring without conversation complexity. Could reuse existing annotation UI.
- **Cons:** Still misses the conversation — the most differentiating signal. Half-measure that doesn't justify the LLM cost.

---

## Rationale

The single-turn approach was a reasonable MVP scoping decision, but it was never completed and the research system has since proven that multi-turn conversation is both feasible and far more valuable.

The key insight: **the conversation IS the assessment.** A candidate who finds all the bugs but can't explain why they matter, or who folds at the first pushback, is a weaker reviewer than one who finds fewer bugs but drives a productive conversation to resolution. The deterministic scorer cannot distinguish these candidates. The panel can.

Cost is manageable: ~$0.20-0.50 per assessment at current Claude pricing, well within the per-candidate margin at $40/mo Pro pricing.

---

## Consequences

### Positive

- Assesses the skills that actually matter in code review: communication, technical reasoning, review practice
- Produces narrative reports that hiring managers can read and act on
- Differentiates Pipe from every other technical assessment tool (none test multi-turn review)
- Ground truth now includes design trade-offs, not just bugs
- Research system provides a training loop for continuous scorer improvement

### Negative / Trade-offs

- Higher per-assessment cost (~$0.20-0.50 vs ~$0 for deterministic)
- LLM scoring has variance — same transcript may score ±3-5 points across runs
- More complex infrastructure: conversation state management, agent orchestration, panel execution
- Longer assessment time: 30-60 minutes vs 10-15 for single-turn

### Risks

- Implementer agent realism — if the AI "author" feels robotic, the conversation loses value. Mitigated by research training loop.
- Scorer consistency — panel may disagree with human judgment on edge cases. Mitigated by calibration against human-reviewed transcripts.
- Cost at scale — 50 customers × 20 candidates/mo = 1000 assessments × $0.35 = $350/mo AI cost. Acceptable at current margins.

---

## What this supersedes

ADR-021's deterministic scoring algorithm (`src/lib/scoring/codeReview.ts`) is deprecated. The single-turn components (`CodeReviewChallenge.tsx`, `DiffPanel.tsx`, `SubmissionPanel.tsx`) will be refactored:

- **DiffPanel** — kept and extended for multi-turn (conversation thread added alongside diff)
- **SubmissionPanel** — kept for final verdict submission
- **CodeReviewChallenge** — rewritten as conversation orchestrator
- **`codeReview.ts` scorer** — replaced by panel-based scoring via Worker → AI agent calls

The `GitHubPRFetcherV2` and `ChallengePicker` PR browser are retained — they feed into the new system unchanged.

---

## Migration impact

This decision affects two migration phases:

- **[Phase 2](../../migration/phase-2-recruiter-core.md)** — Challenge creation: `ChallengePicker` updated to show slopify repo in dropdown, auto-load ground truth from exercise case definitions. BDD scenarios added for slopify PR selection and legacy arbitrary PR fallback.
- **[Phase 3](../../migration/phase-3-candidate-flow.md)** — Candidate assessment: CODE_REVIEW BDD scenarios rewritten for multi-turn conversation flow. New Worker endpoints (`/rpc/review/:sessionId/*`), new `review_sessions` D1 table, scoring panel integration.

---

## Follow-up

1. Run the research training loop to calibrate scorer prompts (`research/code-review-arena/program.md`)
2. Implement conversation state management (Worker + D1 session store)
3. Implement implementer agent Worker endpoint (`/rpc/review/:sessionId/respond`)
4. Implement scoring panel Worker endpoint (`/api/v1/assessments/:id/score`)
5. Refactor `CodeReviewChallenge.tsx` into multi-turn conversation UI
6. Update `ChallengePicker` to source PRs from slopify repo (hardcoded per org)
7. Migrate Phase 3 BDD scenarios to cover multi-turn flow
