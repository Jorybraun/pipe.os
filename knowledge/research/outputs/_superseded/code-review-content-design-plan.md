> **STATUS: SUPERSEDED** · Created 2026-04-08 08:12 · Superseded 2026-04-08 12:55
> **This plan was superseded during the same session it was written.** It was the initial 7-question parent plan for code review assessment design.
> **Replaced by:** [`../.plans/code-review-content-sourcing.md`](../.plans/code-review-content-sourcing.md) — narrowed to the 3-question content-sourcing cut the founder was actually blocked on, then expanded to 6 dimensions across 2 rounds.
> **Why superseded:** The parent plan was too broad (7 questions covering scoring, industry practice, simulation design, and content). The founder's block was specifically on content design, so the scope was narrowed and the other questions deferred.
> **Kept for:** traceability — the final `code-review-content-sourcing` run explicitly references this as its parent plan.

---

# Research Plan: Code Review Content Design

**Slug:** `code-review-content-design`
**Date:** 2026-04-08
**Status:** Active — Round 1 in progress

## Context

PIPE is building a turn-based interactive code review challenge where candidates review a PR, direct an AI agent to make changes, and guide it toward a good outcome. Current implementation (`workers/api/src/lib/implementerAgent.ts`, `explainerAgent.ts`, `scorerAgent.ts`) scores reviewers primarily on planted-bug detection against a multi-turn transcript. The founder has identified three coupled problems:

1. **Content fairness** — asking a candidate to cold-review a 10-file PR they've never seen conflates "familiar with this code" with "good reviewer."
2. **Context** — how much scaffolding is needed before code reading is actually a valid skill test?
3. **Scoring validity** — bug-count is a weak proxy; what actually predicts review quality?

And a reframed vision:
- Reading code IS the core signal (non-negotiable).
- Format is turn-based human-AI code review — candidate guides an AI implementer through iterative changes.
- Three constructs to measure: (a) code reading comprehension, (b) technical communication, (c) AI-agent direction skill.
- Content must be selectable from `CandidatePersona` handed off by the Role Discovery agent.

## Discovery agent handoff — feature vector for content selection

From `workers/api/src/types.ts`:

```typescript
interface CandidatePersona {
  seniority: string;          // "Mid-to-senior, 5–8 years"
  archetype: string;          // "Backend-leaning fullstack from Series A-C startup"
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  disposition: string[];
  careerSignal: string;
  redFlags: string[];
  dealbreakers: string[];
}
```

Persisted on `role_contexts.persona_json`. Also available: `knowledge_state` (opaque Record) and generated `job_description_md`.

## Core research question

How do we design a turn-based human-AI code review assessment that is fair, valid, and rich — giving the candidate enough context to read and critique unfamiliar code, matching content difficulty to the `CandidatePersona`, and producing scores that predict on-the-job review and AI-collaboration ability?

## Sub-questions

1. **Code-reading comprehension as an assessment construct** — CS-education research on measuring code comprehension (think-aloud, explanation tasks, Bloom-for-code, SOLO taxonomy).
2. **Reviewer cognition & context budget** — how much unfamiliar code can a reviewer process, what scaffolding restores validity (architectural maps, glossaries, guided tours, "ask the author" agents).
3. **Industry practice for code-review and code-reading interviews** — FAANG, scale-ups, interview platforms (Karat, CoderPad, CodeSignal, HackerRank, Triplebyte, Otta). Rubrics, fairness practices.
4. **Content sourcing and difficulty calibration** — GitHub PR mining (SEART, GHTorrent, CodeReviewer dataset), synthetic PR generation, hybrid approaches, matching `CandidatePersona` → PR.
5. **Human-AI collaboration as a measurable skill** — emerging 2023–2026 research on prompt engineering, agent steering, human-LLM pair programming. What separates strong from weak AI-directors?
6. **Turn-based simulation design** — pair programming research, intelligent tutoring systems, Socratic dialogue, interactive fiction for assessment. Authenticity and anti-gaming.
7. **Scoring validity** — construct validity of code-review assessments, alternatives to bug-count (reasoning quality, communication, priority calibration, verdict justification, AI-direction efficiency), LLM-as-judge reliability on multi-turn transcripts, legal defensibility (EEOC / Uniform Guidelines).

## Fixed design constraints

- Reading code is the core skill — not negotiable.
- Format is turn-based human-AI code review.
- Three constructs: code reading, technical communication, AI-direction.
- Content selection must key on `CandidatePersona`.
- Richer and more realistic is better — research should deepen the simulation, not simplify it.

## Strategy

5 parallel `researcher` subagents, disjoint dimensions, 1–2 rounds expected, foreground execution.

## Task Ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | researcher R1 | Academic lit: code comprehension & reviewer cognition (subQs 1, 2) | in_progress | `knowledge/outputs/code-review-content-design-research-comprehension.md` |
| T2 | researcher R2 | Industry practice & interview design (subQ 3) | in_progress | `knowledge/outputs/code-review-content-design-research-industry.md` |
| T3 | researcher R3 | Content sourcing & difficulty calibration (subQ 4) | in_progress | `knowledge/outputs/code-review-content-design-research-content.md` |
| T4 | researcher R4 | Human-AI collaboration skill + turn-based simulation design (subQs 5, 6) | in_progress | `knowledge/outputs/code-review-content-design-research-human-ai.md` |
| T5 | researcher R5 | Scoring validity, rubric science, legal defensibility (subQ 7) | in_progress | `knowledge/outputs/code-review-content-design-research-scoring.md` |
| T6 | lead | Synthesize brief | todo | `knowledge/outputs/.drafts/code-review-content-design-draft.md` |
| T7 | verifier | Add citations | todo | `knowledge/outputs/code-review-content-design-brief.md` |
| T8 | reviewer | Verify | todo | `knowledge/outputs/code-review-content-design-verification.md` |
| T9 | lead | Build `knowledge/code-review/` wiki scaffold | todo | `knowledge/code-review/` tree |
| T10 | lead | Final delivery + provenance | todo | `knowledge/outputs/code-review-content-design.md` + `.provenance.md` |

## Acceptance Criteria

- [ ] Every sub-question backed by ≥2 independent sources
- [ ] Human-AI-collaboration-as-a-skill section has current (2024–2026) sources
- [ ] At least one source on construct validity of code-review assessments
- [ ] Concrete content-format recommendation with explicit trade-offs vs. current PIPE implementation
- [ ] `CandidatePersona → content` mapping rubric grounded in research
- [ ] Multi-turn scoring proposal with LLM-as-judge reliability evidence
- [ ] `knowledge/code-review/` wiki scaffold matching the shape of `knowledge/culture/`
- [ ] No single-source claims on critical recommendations
- [ ] Open questions list separates "genuinely unknown" from "needs internal product decision"

## Verification Log

| Item | Method | Status | Evidence |
|---|---|---|---|
| CandidatePersona schema | direct read of `workers/api/src/types.ts` lines 180–240 | ✅ done | see Discovery handoff section above |
| Implementer/Explainer/Scorer current behavior | direct code read | ✅ done | `workers/api/src/lib/{implementerAgent,explainerAgent,scorerAgent}.ts` |
| Claim sweep on final draft | cross-reference each critical claim to source | pending | TBD |
| LLM-as-judge variance claims | at least 2 independent arXiv papers | pending | TBD |
| "X hours to onboard to a codebase" style claims | primary study, not a blog | pending | TBD |

## Decision Log

- **2026-04-08** — Locked three-construct framing: code reading, technical communication, AI-direction skill.
- **2026-04-08** — Turn-based human-AI review format is fixed. Research may not propose abandoning it.
- **2026-04-08** — `CandidatePersona` is the canonical input for content selection.
- **2026-04-08** — Running foreground (user wants to course-correct mid-flight).
- **2026-04-08** — Scoring problem elevated from sub-question to first-class pillar (R5 dedicated researcher).
