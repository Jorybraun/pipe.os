# Research Plan: Repo-Personalized Interview — Matching Philosophy + Configuration UX

**Date:** 2026-04-18
**Slug:** `repo-personalized-interview-config`
**Context:** STRATEGY.md Decision Log 2026-04-18 captured an exploratory direction: bi-directional vectorization (repos + roles + candidates in one embedding space) with a three-station OSCE-style interview (Code Review → ADR Review → Code Implementation) anchored on one personalized repo per (role × candidate) pair. That entry defined the *architecture* (embeddings, dual-query re-rank, three challenge types). It did **not** resolve the product philosophy — *what is the repo for?* — nor the **configuration UX** — *where in the product does the recruiter make this decision?*

This plan scopes the brief that must precede **ADR-039** (Bi-directional Vectorization + 3-Station Interview Trajectory). Without resolving philosophy + config surface first, the ADR would lock schema and routing without a defensible product story.

## Core question

When a recruiter runs a pipeline, **what is the repo matched to the candidate for?** Three distinct purposes give three distinct match algorithms, UI surfaces, and disqualification semantics:

- **(T) Tailored to the role** — repo demonstrates the skills the role requires. Weak candidate-fit is a feature: the interview is a stretch test.
- **(V) Validate candidate experience** — repo resembles codebases the candidate already knows. Weak role-fit is a feature: the interview confirms claimed experience.
- **(H) Hybrid, bounded stretch** — both role-fit and candidate-fit above thresholds, with a controlled delta. Candidate gets a codebase shaped by the role but within a comfort window that predicts completion.

Each mode answers the "should a candidate be disqualified for missing a skill?" question differently: T says *probably yes*, V says *no (we're validating what they have)*, H says *only if the gap exceeds a configured tolerance*. Picking one as the default — or exposing all three with a default — is a product decision that needs evidence, not vibes.

## Sub-questions

**Research track (empirical — needs lit review + competitor scan):**

1. **Philosophy precedent** — in structured-interview research (SIOP, OSCE/MMI, AC literature), when the same candidate is assessed across multiple stations, are the stations tuned to the role's competency model (T) or to the candidate's prior experience (V)? What does the evidence say about predictive validity for each?
2. **Disqualification semantics and validity** — when a station exposes a missing skill, is a low score a true-negative (predictive of poor on-the-job performance) or a false-negative (measuring prior exposure to the codebase, not aptitude)? Confounds from **codebase familiarity** are an active literature (SWE-bench contamination studies, fair-code-testing research). How should a scoring pipeline discount familiarity effects when the repo was chosen to *match* the candidate?
3. **Adverse impact on candidates who lack specific stack exposure** — if the default mode is (T) "tailored to role" and a role requires an uncommon stack (e.g., Elixir, OCaml), does the algorithm systematically disadvantage capable candidates whose experience is in adjacent stacks? What's the evidence base? What's the legal surface under Title VII disparate-impact doctrine + Mobley v. Workday "agent" theory (active 2025 litigation, EEOC amicus)?
4. **Candidate transparency** — should the candidate know *why* this repo was picked for them? Literature on explanation-in-assessment (proctored testing, adaptive testing transparency, OSCE feedback) plus the XAI rationale-before-question findings from the 2026-04-17 guardrails brief (Tam 2024 et al.). Does disclosure of the repo-matching rationale improve perceived fairness, or does it let sophisticated candidates game the match?

**Fairness-of-scale track (criterion-referenced framing — empirical):**

> **Framing decision captured 2026-04-18:** PIPE's personalized-challenge vision is **criterion-referenced**, not norm-referenced. The measurement question isn't *"how does this candidate rank vs. other candidates on one scale"* (norm-referenced, requires identical items or IRT item calibration). It is *"does this candidate meet this role's criteria, as evidenced by how they handled a role-appropriate repo"* (criterion-referenced, different items across candidates is a feature). Founder position 2026-04-18: different tests per candidate is desirable — matches real hiring managers' behavior, matches licensure/competency testing tradition, matches OSCE multi-station design. This framing dissolves item-level IRT calibration at scale (STRATEGY CR-32 / CR-33 reframe — not un-defer — from item-level to template-level + dimension-level). It does NOT dissolve the three fairness concerns below.

4a. **Template-level + dimension-level calibration** — since items rarely repeat at scale under personalization, difficulty parameters attach to (i) ADR-034 **template packs** (hundreds of instantiations of one template roll up) and (ii) **BARS dimensions** (common rubric across items). What does psychometrics literature on competency-based / licensure testing say about calibration when items are non-repeating but rubric is shared? NCLEX, USMLE, CPA Exam, and modern licensure batteries are relevant precedent. How small can n-per-template be before dimension-level calibration becomes unreliable?
4b. **Time-limit scaling per item** — raw time-on-task is not a fair signal unless time budgets scale with item complexity. A 2000-LOC PR review must get more time than a 200-LOC PR review, or the candidate is being penalized for the match's randomness rather than their reasoning. What does speeded-vs-power test literature (NCME standards, Van der Linden adaptive time allocation, Cronbach-on-speededness, code-review-task timing studies if any) say about defensible per-item time budgets? Inputs to the time-budget function: diff size, LOC touched, reading-length of PR/issue/ADR, number of files, number of planted bugs (code review), alternatives count (ADR review), framework unfamiliarity-to-candidate (per candidate profile). The output is a *minimum defensible time* the scoring panel can assume the candidate had.
4c. **Difficulty banding — the match must stay within the role's seniority band** — a junior cannot be assigned a staff-level repo, and a staff candidate shouldn't be assigned a junior trivial. Pre-estimated difficulty (from `challenge_surfaces`, `seniority_band`, `complexity_band` on the repo + role seniority requirement) is a **hard filter** on the match algorithm before cosine ranking, not a soft score. What's the literature on the acceptable difficulty-range for a competency assessment to produce a valid signal? Too hard = ceiling effect, too easy = floor effect; either invalidates the measurement.
4d. **Disparate-impact audit under personalization** — if Group A (e.g., candidates from bootcamp backgrounds, or women, or candidates from non-FAANG companies) systematically gets matched to **harder repos** than Group B due to an embedding-space artifact, that's a Title VII concern regardless of which scoring philosophy is chosen. What's the monitoring architecture? 4/5ths rule applied to match-difficulty distributions by protected class (where legally observable)? Quarterly external fairness audit? Live guardrail that rejects a match if the candidate's assigned difficulty exceeds their cohort mean by N standard deviations?
4e. **Stretch mode vs. validation mode scoring** — if match philosophy (T / V / H per Q1) is configurable, does the **scoring formula** also need to change? Under (T) tailored-to-role, a low score on a skill the role requires is diagnostic of unfitness. Under (V) validate-experience, a low score on a skill the candidate already claims is diagnostic of claim inflation — different signal, different action. The same raw score has different interpretations. Does the final scorecard surface one θ or a purpose-conditional scorecard?

**Design track (no external research — needs UX design + competitor scan):**

5. **Configuration locus** — where in the product does the recruiter configure match philosophy, disqualification tolerance, and stage linkage? Candidates:
   - (a) as a **Role Discovery phase step** — the agent asks about it during role intake;
   - (b) as a **dedicated wizard stage** (new) between Role Discovery and Pipeline Launch, showing match preview;
   - (c) as **per-stage settings** on each challenge added to the pipeline;
   - (d) as a **global account-level default** with per-role override.
   Each has tradeoffs: (a) keeps friction low but mixes two concerns, (b) gives the decision its own airtime but adds a wizard step, (c) is maximally flexible but explodes the surface, (d) is low-touch but hard to discover.
6. **Stage linkage (shared-repo vs per-stage-repo)** — are Code Review / ADR Review / Code Implementation always anchored on the same repo, or can the recruiter split them? The founder vision favors shared-anchor for context depth; but a recruiter who wants to test **breadth** might prefer three different repos. How does this surface in the UI without becoming a power-user trap?
7. **Automation granularity** — when is the repo chosen?
   - (i) **per-pipeline** at launch (one repo for all candidates who enter the pipeline);
   - (ii) **per-candidate** when the candidate starts (dynamic match against their profile);
   - (iii) **per-stage** (rematch at each station, possibly different repos);
   - (iv) **recruiter-override** (automation proposes, recruiter confirms before each candidate advances).
   Each has a different cost/latency profile and a different *implicit contract* with the candidate. (i) is deterministic and fair-to-everyone-equally; (ii) is personalized; (iv) is high-touch but introduces recruiter bias back into the loop.
8. **Configuration defaults and guardrails** — what defaults ship, and what configurations should be *blocked* because they produce indefensible assessments? E.g., (T)-mode with zero tolerance on an uncommon stack + no recruiter review + auto-reject threshold is a discrimination risk; should the UI refuse that combo or warn?

## Design space summary

The design space has four orthogonal axes. Any sensible UI surfaces the first two prominently and hides the latter two behind sensible defaults:

| Axis | Values | Default (proposed) |
|---|---|---|
| Match philosophy | tailored / validate / hybrid | hybrid |
| Disqualification tolerance | strict / moderate / lenient | moderate |
| Stage linkage | shared-repo / per-stage-repo | shared-repo |
| Automation granularity | per-pipeline / per-candidate / per-stage / recruiter-override | per-candidate |

The defaults above collapse to: *"The system auto-picks one repo per candidate, matched with both role-fit and candidate-fit within a moderate tolerance, and anchors all three stations on that repo."* That's the founder vision. But the UI must expose the axes so a recruiter can dial into (T) strict / per-pipeline when they want a stretch test, or (V) lenient / per-stage when they want to validate a specific technology claim.

## Strategy

**Single lead with 2 parallel researchers.** This is a medium-weight brief — smaller than the 4-researcher guardrails brief because the design track (sub-Qs 5–8) needs no external sources, only competitor scanning and UX thinking. The research track (sub-Qs 1–4) is well-bounded.

| ID | Focus | Owns sub-questions | Expected sources |
|---|---|---|---|
| R1-philosophy | Structured-interview literature on role-tuned vs. experience-tuned stations; codebase-familiarity confounds; scoring adjustments | 1, 2 | SIOP SIOP principles, OSCE/MMI station-design papers, AC literature, Campion SJT reviews, SWE-bench contamination research |
| R2-fairness | Disparate-impact evidence for stack-specific hiring, candidate-transparency in assessments, legal boundary under Title VII + state AI law | 3, 4 | EEOC 2023 guidance + Mobley class cert updates, Title VII disparate-impact case law, Gilliland 1993 organizational-justice framework, adaptive-testing transparency studies (ETS, CAT literature), PIPE's 2026-04-17 XAI guardrails brief |
| Lead | Synthesize research track + drive design track (sub-Qs 5–8) via competitor scan (HireVue, Karat, Codility, CoderPad, Triplebyte, Leetcode Assess) + UX rationale | 5–8 | Competitor product tour notes, Pipe's existing recruiter feedback if any, design-system precedent in `src/pages/` |

**Evidence bar:** ≥10 cited sources per research-track researcher, ≥2 independent sources per critical claim. Competitor scan aims for ≥5 platforms observed, screenshots or public docs where possible.

**Expected rounds:** 1 full round, 1 targeted follow-up if (a) disparate-impact evidence is thin or (b) no competitor offers configurable match philosophy (likely — this would be a differentiator).

## Acceptance criteria

- [ ] All 8 sub-questions answered; research-track Qs with ≥2 independent sources each
- [ ] Research track produces an explicit recommendation on match-philosophy default (T / V / H) grounded in validity evidence
- [ ] Research track produces an explicit recommendation on disqualification semantics — is a failed station a hard reject, a weighted signal, or an evidence trace only?
- [ ] Design track produces a wireframe or UX flow sketch for the configuration surface (locus + defaults + power-user override path)
- [ ] Design track produces an explicit recommendation on stage linkage default (shared vs per-stage)
- [ ] Design track produces an explicit recommendation on automation granularity default (per-pipeline vs per-candidate vs per-stage)
- [ ] Brief includes a **guardrail** section: which configuration combinations are blocked or warned, grounded in the disparate-impact research
- [ ] Brief includes a **role-agent-integration** section: how Role Discovery's existing conversation can elicit the four configuration axes without turning intake into a settings form
- [ ] Brief includes a **migration plan**: which axes ship in the first ADR-039 implementation vs. deferred to follow-ups; what the MVP config surface looks like if we defer (d) global defaults
- [ ] Contradictions between sources explicitly flagged; single-source critical findings called out
- [ ] Brief ends with three concrete next artifacts: (i) ADR-039 draft outline, (ii) D1 schema sketch for `pipeline_match_config`, (iii) wizard-step UX mock

## Dependencies and input artifacts

- STRATEGY.md Decision Log entry 2026-04-18 (exploratory direction) — **read first**
- `knowledge/outputs/role-discovery-data-contract.md` — canonical RCD schema; config axes must thread through `role_contexts`
- `knowledge/outputs/role-discovery-sales-intake.md` — Role Discovery agent design; informs which config axes can be elicited conversationally
- `docs/decisions/current/ADR-027-role-discovery-agent.md`, `ADR-031-ai-hiring-compliance.md`, `ADR-032-code-review-research-integration.md`, `ADR-034-challenge-authoring-system.md`, `ADR-036-role-discovery-data-contract.md`, `ADR-038-role-discovery-agent-guardrails.md`
- `knowledge/outputs/behavioral-culture-interview-agent.md` — BARS, disposition weighting; repo-match dispositional cross-check
- `workers/api/src/lib/roleAgentPrompts.ts` — current Role Discovery prompt surface
- `src/pages/` — existing wizard patterns (Role Discovery page, Pipeline creation flow)

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | R1-philosophy | Structured-interview role-tuned vs experience-tuned evidence; codebase-familiarity confounds | todo | `knowledge/outputs/repo-personalized-interview-config-research-philosophy.md` |
| T2 | R2-fairness | Disparate-impact evidence for stack-specific gates; transparency in assessment; legal ceiling | todo | `knowledge/outputs/repo-personalized-interview-config-research-fairness.md` |
| T3 | Lead | Competitor scan (5+ platforms) + UX flow design for config surface + wizard-step mock | todo | `knowledge/outputs/.drafts/repo-personalized-interview-config-competitor-scan.md` |
| T4 | Lead | Synthesize + draft brief | todo | `knowledge/outputs/.drafts/repo-personalized-interview-config-draft.md` |
| T5 | verifier | Inline citations + URL verification | todo | `knowledge/outputs/repo-personalized-interview-config.md` |
| T6 | reviewer | Evidence-integrity review | todo | `knowledge/outputs/repo-personalized-interview-config-verification.md` |

## Open design questions to resolve in the brief (not the plan)

- Should the four config axes be exposed in the recruiter wizard **at all**, or should Role Discovery silently set them based on what the recruiter said about the role? (Hide-by-default vs. show-by-default is a product-philosophy question that touches Pipe's whole "conversational configuration" thesis.)
- Is `ADR_REVIEW` a challenge type that can be *authored* (static ADR text + rubric) or *generated* (AI produces an ADR from the repo's actual codebase at challenge-launch)? The authoring story affects both the config surface and the scope of ADR-034 challenge authoring.
- How does the candidate experience feel if two candidates for the same role receive **different repos**? Is this fair (personalized) or unfair (non-comparable)? IRT / DIF research argues comparability is about construct validity, not identical stimuli — but recruiter intuition may differ. Needs explicit founder call.
- Does the match config travel with the *pipeline* or the *role context*? If the same role is used for three pipelines (e.g., junior / mid / senior variants), is the match config one-per-pipeline or one-per-role? (Likely one-per-pipeline with a role-level default, but explicit decision needed.)
- When automation is **per-candidate** (default) and Vectorize returns no match above threshold (candidate profile is too sparse or too far from any indexed repo), what happens? Fall back to a role-tuned repo? Block candidate entry and alert recruiter? Ship challenges without a repo (plain MCQ / text)? Failure-mode semantics are load-bearing and need a decision.

## Verification log

| Item | Method | Status | Evidence |
|---|---|---|---|
| All 8 sub-questions scoped | Plan review | IN PROGRESS | — |
| Research sources ≥10 per research-track researcher | Lit review | IN PROGRESS | — |
| Competitor scan ≥5 platforms | Product tour | IN PROGRESS | — |
| Config-axis recommendation grounded in evidence (not just opinion) | Final brief review | IN PROGRESS | — |
| Guardrail section enumerates blocked combos | Final brief review | IN PROGRESS | — |
| Founder-level open questions surfaced (not silently decided) | Final brief review | IN PROGRESS | — |

## Decision log

- **2026-04-18** — Brief scoped as a *blocker on ADR-039*, not as a pre-req for any code. Writing ADR-039 before this brief lands would pre-commit to a match philosophy without evidence.
- **2026-04-18** — Single lead + 2 researchers (not 4 like the guardrails brief) because the design track is product-UX, not external research. Keeps cost + calendar light.
- **2026-04-18** — Research files will live in `knowledge/outputs/` per the standard brief convention (not `knowledge/role-discovery/`, which the guardrails brief used per a now-specific user instruction). Final brief filename: `repo-personalized-interview-config.md`.
- **2026-04-18 (amended mid-run)** — User instruction: final deliverable + drafts go under `knowledge/interview/` (not `knowledge/outputs/`). Three researchers already dispatched writing to `knowledge/outputs/repo-personalized-interview-config-research-*.md`. Plan: allow current research files to land at their original paths, then move/rename into `knowledge/interview/` during synthesis. Lead drafts + final brief written directly to `knowledge/interview/`.
- **2026-04-18** — Four configuration axes (philosophy / tolerance / linkage / automation) identified as the canonical framing. If the research surfaces a fifth axis, the plan gets amended and re-reviewed.
- **2026-04-18** — Default proposed in plan (hybrid / moderate / shared-repo / per-candidate) is a **working hypothesis**, not a decision. The brief may reject it based on research or competitor scan.
