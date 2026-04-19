# Candidate-Facing XAI Disclosure Copy

**Date:** 2026-04-19
**Status:** Draft (first pass) — pending legal review + variant A/B test (ADR-039 OQ-V8)
**Belongs to:** [ADR-039](../../docs/decisions/ADR-039-bi-directional-vectorization-and-3-station-interview.md) §Open #8
**Companion research:** `repo-personalized-interview-config.md` §3.3 (transparency), §4.4 (UX), §4.6 (Role Discovery prompt variants)

---

## Design principles

1. **Class-level, not parameters** (Gilliland & Hausknecht 1996; Gilliland 1993). Tell the candidate *what* is being assessed and *why it predicts role performance*. Never say the cosine distance, the rerank weight, the dispositional multiplier, or the dimension IDs.
2. **Short beats complete** (Fok & Weld 2023). Over-explanation erodes trust and invites gaming; the minimum disclosure that satisfies the statute + procedural-justice research is the right length.
3. **Job-relatedness is the anchor** — every disclosure returns to the claim "this predicts how you would perform in this role." That's the Kane (2013) IUA claim; everything else is support.
4. **One consistent voice** across pre-interview, per-stage, and post-interview surfaces. Candidates read them in sequence; contradicting framings break trust.

---

## Legal minima (coverage checklist)

| Statute | Effective | Required element | Where we cover it |
|---|---|---|---|
| Colorado SB 24-205 | 2026-02-01 | Pre-decision notice that AI is used; right to correct data; purpose | Pre-interview §1 |
| Illinois HB 3773 | 2026-01-01 | Candidate notice of AI use in employment decisions | Pre-interview §1 |
| EU AI Act Art. 13 | 2026-08-02 | Meaningful information about logic + purpose + scope | Pre-interview §1 + Post-interview §1 |
| NYC LL144 | Active since 2023 | Link to bias-audit summary + data retention policy | Footer (all surfaces) |
| ADR-031 (internal) | — | Candidate can request human review | Post-interview §3 |

---

## Pre-interview disclosure (shown before candidate starts Station A)

Displayed full-screen, candidate must acknowledge (single checkbox + continue).

```
Before you start

This is an AI-supported interview for a real role. Here's what you should know:

• We use AI to match you to a code repository that's appropriate for the role
  and to score your work on three connected exercises (a code review, an
  architecture review, and a small code change). A human recruiter reviews
  every result before any decision is made.

• The exercises are personalized — different candidates get different
  repositories, matched to the role. This is intentional. Your work is scored
  against the role's criteria, not ranked against other candidates.

• You can pause, request human review of any result, or ask us to delete
  your data at any time. Contact details are at the bottom of every screen.

[ ] I've read this and I'm ready to start.
```

**Length:** ~110 words. **What's deliberately absent:** model names, dispositional weights, cosine thresholds, the four config axes.

---

## Per-stage disclosure (shown at the start of each station)

One sentence above the challenge content. Same structure across A, B, C — only the station name changes.

**Station A (Code Review):**

> This exercise asks you to review a pull request from a real open-source project. You'll be scored on how you catch issues, communicate trade-offs, and prioritize feedback — skills that predict performance in this role.

**Station B (ADR Review):**

> This exercise asks you to review a proposed architecture decision on the same project. You'll be scored on how you reason about trade-offs, flag risks, and weigh alternatives — skills that predict performance in this role.

**Station C (Code Implementation):**

> This exercise asks you to implement a real feature request from the same project. You'll be scored on how you approach the problem, the choices you make, and the correctness of your solution — skills that predict performance in this role.

**Structure:** *what you're doing + what we look at + why it matters*. No mention of stations or the three-station structure per-stage (that's in pre-interview).

---

## Post-interview disclosure (shown on completion screen)

```
You're done

Here's what happens next:

1. A recruiter will review your work across all three exercises alongside
   the AI's summary. They see the same scoring dimensions you saw
   highlighted in the instructions: ground-truth accuracy, communication
   quality, and practice fit. They make the hiring decision.

2. You'll hear back within [N] business days. We'll email you at
   [candidate_email] either way — no ghosting.

3. If you want a human to review how the AI scored your work, or if you
   think something in your profile is wrong, email [contact]. You have
   the right to ask.
```

**Length:** ~90 words. **What's deliberately absent:** the candidate's actual scores, the dispositional weights, the consistency-across-modality signal, the match-philosophy axis. Those live on the recruiter side.

---

## Footer (all surfaces)

Persistent, small, never dismissed.

> AI-supported hiring • [Bias audit summary] • [Data retention] • [Request human review] • [Delete my data]

Five links. No prose.

---

## Variants for A/B testing (ADR-039 OQ-V8)

Three pre-interview variants to test once volume permits. Same legal content; different framing.

| Variant | Lead framing | Hypothesis |
|---|---|---|
| V1 (control) | "AI-supported interview for a real role" (above) | Neutral baseline. |
| V2 (assurance-lead) | "A human recruiter reviews every result before any decision is made." — surfaced first, then the AI description. | Procedural-justice literature (Gilliland 1993) predicts higher perceived fairness. |
| V3 (purpose-lead) | "We personalize exercises so you're assessed on work that actually reflects this role" — purpose first, mechanism second. | Tests whether personalization framing increases completion rate without reducing trust. |

Primary metric: completion rate. Secondary: self-reported fairness (single post-interview Likert). Guard metric: adverse-impact parity across protected classes (ADR-031).

---

## What we never say (Fok & Weld guard)

Explicit do-not-disclose list. If any of these appear in candidate-facing copy, block at review.

- Model names (Gemma, Qwen, BGE, etc.).
- Numerical scores on any dimension.
- Cosine similarity values, percentile ranks, or confidence scores.
- The four config axes by name (`match_philosophy`, `tolerance`, `stage_linkage`, `automation_granularity`).
- Candidate-fit as a scalar (enforced by the ADR-039 §Consequences invariant — candidate-fit is a pre-match floor, never a displayed quantity).
- Per-candidate reasoning traces or rationale objects from the Role Discovery / Candidate Discovery agents.
- Any comparison to other candidates ("you ranked X", "top Y%").
- The existence of planted bugs in code-review PRs or ground-truth keys.

---

## Open questions carried to OQ-V8

1. Variant A/B test design — recruit for statistical power, or opportunistic from production traffic?
2. Candidate-requested human review — synchronous (within N days) or asynchronous queue? ADR-031 doesn't specify.
3. Multi-language copy — English only for MVP; Spanish + German required for EU AI Act launch.
4. Accessibility — WCAG 2.2 AA review before launch (screen-reader order of pre-interview disclosure + checkbox).
