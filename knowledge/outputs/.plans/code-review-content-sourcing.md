> **STATUS: COMPLETED PLAN** · Created 2026-04-08 12:55 · Run delivered 2026-04-08 14:17
> **Research run:** `code-review-content-sourcing`
> **Role in run:** The plan file — defines scope, sub-questions, researcher allocations, acceptance criteria, and decision log.
> **Outcome:** Completed across 2 rounds (R1–R3 in Round 1, R4–R6 in Round 2). All acceptance criteria met.
> **Supersedes:** [`../_superseded/code-review-content-design-plan.md`](../_superseded/code-review-content-design-plan.md) — the parent 7-question plan narrowed into this run.
> **Navigate:** [INDEX](../../INDEX.md) · [final brief](../code-review-content-sourcing.md)

---

# Research Plan: Sustainable Code-Review Content Sourcing

**Slug:** `code-review-content-sourcing`
**Date:** 2026-04-08
**Parent plan:** `code-review-content-design.md` (broader 7-question scope; this narrows to the content-sourcing pillar the founder is actually blocked on)
**Status:** Active — Round 2 (interview-value half)
**Researcher model:** Claude Sonnet 4.6 (explicit override — default researcher model is not strong enough for primary-source synthesis on this topic)

## Context

The parent plan locks the format (turn-based human–AI code review), the constructs (code reading, technical communication, AI-direction), and the selection key (`CandidatePersona`). The founder's unresolved pain is narrower: **how do we design and produce code-review content sustainably?**

"Sustainable" here means all three of:
- **Cheap enough** for a solo founder to maintain (no army of content engineers).
- **Leak-resistant** — cannot be memorized by candidates swapping notes or by frontier LLMs ingesting the public web.
- **Maintainable** as models improve and as the candidate persona library grows.

## Core question

What is the best content-sourcing and calibration strategy for a turn-based human–AI code-review assessment that must (a) fairly test code *reading* on unfamiliar code, (b) match difficulty and domain to a `CandidatePersona`, and (c) remain cheap to produce and resistant to leakage over time?

## Sub-questions

1. **PR-mining landscape** — what public datasets exist for real PRs with review comments (CodeReviewer, CodeReviewerPlus, SEART GHS, GHTorrent successors, Microsoft CodeReviewer, anything 2024–2026)? Licenses, PII status, language coverage, suitability for assessment use, leakage risk from training-set overlap.
2. **Synthetic / LLM-generated content** — state of the art on LLM-generated code review scenarios and planted-bug injection (mutation testing, semantic bug synthesis, adversarial PR generation). Validation that a generated PR is actually hard in the right way. Human-vs-synthetic authenticity gaps.
3. **Context scaffolding & difficulty calibration** — how much unfamiliar-code context is needed before reading becomes a valid construct, scaffolding designs (arch maps, guided tours, author-QA agents), calibration methods (human-tagged, IRT/Rasch, LLM-rubric-scored, performance-derived), and persona-to-content mapping that avoids combinatorial blowup.

## Fixed design constraints (from parent plan)

- Reading code is the core signal.
- Turn-based human–AI review format is locked.
- `CandidatePersona` is the selection key.
- Richer/more realistic > simpler.

## Strategy

**3 parallel `researcher` subagents running on Sonnet 4.6**, disjoint dimensions, 1 round expected, then Lead synthesizes. Foreground.

## Task Ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | researcher R1 (sonnet) | PR-mining datasets, licensing, leakage (subQ 1) | in_progress | `knowledge/outputs/code-review-content-sourcing-research-mining.md` |
| T2 | researcher R2 (sonnet) | Synthetic/LLM-generated PR content + bug injection (subQ 2) | in_progress | `knowledge/outputs/code-review-content-sourcing-research-synthetic.md` |
| T3 | researcher R3 (sonnet) | Context scaffolding + difficulty calibration + persona mapping (subQ 3) | in_progress | `knowledge/outputs/code-review-content-sourcing-research-scaffolding.md` |
| T4 | lead | Synthesize draft | todo | `knowledge/outputs/.drafts/code-review-content-sourcing-draft.md` |
| T5 | verifier | Cite + URL-check | todo | `knowledge/outputs/code-review-content-sourcing-brief.md` |
| T6 | reviewer | Evidence integrity | todo | `knowledge/outputs/code-review-content-sourcing-verification.md` |
| T7 | lead | Final deliverable + provenance | todo | `knowledge/outputs/code-review-content-sourcing.md` + `.provenance.md` |
| T4a | researcher R4 (sonnet) | Work-sample & structured-interview validity (Schmidt/Hunter, Roth, Campion) applied to code review | in_progress | `knowledge/outputs/code-review-content-sourcing-research-worksample.md` |
| T4b | researcher R5 (sonnet) | Conversational / simulation-based assessment validity (OSCE, standardized patients, simulator certification) as prior art for turn-based human-agent scoring | in_progress | `knowledge/outputs/code-review-content-sourcing-research-simulation.md` |
| T4c | researcher R6 (sonnet) | Competitive scan (CodeSignal/Karat/HackerRank/Codility/Otter) + practitioner literature (Bacchelli & Bird, Sadowski, Rigby, MacLeod) on what review reveals about engineers | in_progress | `knowledge/outputs/code-review-content-sourcing-research-market.md` |

## Acceptance Criteria

- [ ] Every sub-question backed by ≥2 independent sources.
- [ ] At least one primary source (paper, dataset card) per dataset discussed — no blog-only claims on licensing or size.
- [ ] Leakage/memorization angle addressed with ≥1 source per sourcing strategy.
- [ ] Concrete sourcing recommendation with cost, leakage, and fairness trade-offs laid out side by side.
- [ ] Calibration method recommendation tied to at least one validated psychometric or ML-eval technique.
- [ ] `CandidatePersona → content` mapping approach grounded in research, not vibes.
- [ ] Open Questions separates "genuinely unknown" from "needs internal product decision."

## Verification Log

| Item | Method | Status | Evidence |
|---|---|---|---|
| Dataset sizes and licenses | direct read of dataset card or paper | pending | — |
| Leakage claims about frontier LLMs | ≥2 independent sources | pending | — |
| Synthetic-PR validity claims | primary study, not vendor blog | pending | — |
| Calibration method claims | psychometric literature or ML-eval paper | pending | — |

## Decision Log

- **2026-04-08** — Narrowed from parent 7-question plan to 3-question content-sourcing cut. Scoring, industry-practice, and simulation-design questions deferred; founder is blocked on content, not on scoring framework.
- **2026-04-08** — "Sustainable" defined as cheap + leak-resistant + maintainable (all three).
- **2026-04-08** — Content volume target left open — research should help set it.
- **2026-04-08** — Researcher model set to Sonnet 4.6 (user override) for stronger primary-source synthesis.
