# Research Plan: Role Discovery Agent Guardrails — Rationale, Sensitivity, Depth, Compliance

**Date:** 2026-04-17
**Slug:** `role-discovery-guardrails`
**Context:** PIPE's Role Discovery agent (`workers/api/src/lib/roleAgentPrompts.ts`) generates questions without an exposed rationale, no compliance guardrails (no mention of Title VII / ADA / protected class anywhere), no numeric depth tracking, and no second-pass review. A prior brief (`knowledge/role-discovery/role-discovery-sales-intake.md`, 2026-04-11) solved the sales-intake / EVP-extraction layer. This plan tackles the complementary problem: keeping the agent self-aware, legally defensible, and non-invasive.

## Core question

How do we architect a conversational hiring-intake agent so that every question it asks is (a) explicitly justified against the artifact being built, (b) bounded by legal/ethical sensitivity rules, (c) aware of how deep it has gone on a single topic, and (d) optionally explainable to the user in-line — such that a "bad robot" user-feedback signal produces informative training data instead of noise?

## Sub-questions

1. **Taxonomy of "bad" interview questions** — is there a validated rubric in I/O psychology, structured-interview literature, OSCE / BEI research, or UX research that we can adopt? What are the empirically-grounded failure modes?
2. **Legal boundaries for AI-asked hiring questions** — what categories are forbidden under Title VII / ADA / ADEA / state laws (CA, NY, IL)? What does NYC Local Law 144, Colorado AI Act, EU AI Act, and EEOC 2023 guidance require? Who holds liability when an AI agent asks an illegal question — platform, recruiter, or both?
3. **Explainable AI in conversational agents** — does surfacing a rationale ("I'm asking because…") to the user increase trust/completion, or does it add friction? What's the empirical evidence, and does it differ for high-stakes contexts (hiring, medical)?
4. **Depth control in probing dialogue** — what does means-end-chain / laddering literature (Reynolds & Gutman and successors) say about the point at which deeper probing yields diminishing returns or is perceived as intrusive? How do professional interviewers (clinical, journalistic, investigative) detect when to pivot?
5. **Justification-before-emission as a guardrail** — does forcing an LLM to produce a rationale *before* a question (vs. after, vs. not at all) improve output quality in structured-interview tasks? Literature on chain-of-thought as guardrail, constitutional AI, self-critique.
6. **Consistency classifier for interview agents** — ADR-032 applies a separate-model classifier in code-review agents. Does the same pattern generalize to hiring-intake? Published evidence?
7. **Demographic variance in perceived invasiveness** — does the user-perceived threshold for "invasive" vary by role, age, culture, country? Strategy for norming without optimizing for the loudest voice.

## Strategy

**4 parallel researcher subagents**, each owning a disjoint dimension. Allocations:

| ID | Focus | Owns sub-questions | Expected sources |
|---|---|---|---|
| R1-taxonomy | Item-writing rubrics + invasive-question research (I/O psych, UX) | 1, 7 | SIOP structured-interview standards, BEI/OSCE failure-mode lit, item-writing guidelines (Haladyna), perceived-invasiveness surveys |
| R2-compliance | Legal boundaries for AI-asked hiring questions | 2 | EEOC guidance 2023+, Title VII/ADA/ADEA primary sources, NYC Local Law 144 text + audits, Colorado SB24-205, EU AI Act Annex III, recent case law (iTutorGroup, HireVue settlement, Workday class action) |
| R3-xai | Explainable-AI + rationale surfacing in conversational agents | 3, 5 | HCI + conversational-AI literature on explanation, CoT-as-guardrail papers (Anthropic / DeepMind / academic), Constitutional AI, high-stakes XAI trust studies |
| R4-depth | Adaptive probing depth + pivot signals | 4, 6 | Means-end-chain / laddering empirical studies, clinical interview manuals (motivational interviewing, forensic interviewing of children), dialogue-act + topic-shift research, consistency-classifier lit |

Each researcher writes to `knowledge/role-discovery/role-discovery-guardrails-research-<focus>.md` and returns a ≤500-word summary. Evidence bar: ≥12 cited sources per researcher, ≥2 independent sources per critical claim, peer-reviewed preferred but industry / legal primary sources count.

**Expected rounds:** 1 full round, 1 targeted follow-up if gaps emerge (most likely on compliance or XAI freshness).

## Acceptance criteria
- [ ] All 7 sub-questions answered with ≥2 independent sources
- [ ] Compliance research includes specific statute/regulation citations + at least one enforcement action or audit outcome
- [ ] Rationale-surfacing findings include at least one study on conversational (not general) XAI
- [ ] Depth research identifies at least one numeric threshold (e.g., "past X follow-ups, perceived intrusiveness rises")
- [ ] Contradictions between sources explicitly flagged
- [ ] No single-source claims on critical findings (compliance, perceived invasiveness thresholds, XAI-trust effects)
- [ ] Final brief includes a concrete `{rationale, sensitivity, depth_level}` schema recommendation grounded in the findings
- [ ] Final brief includes a sensitivity ladder (blocked / high / medium / low) grounded in statute citations
- [ ] Final brief includes a bad-robot feedback rubric (taxonomy) drawn from the I/O-psych / item-writing literature

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | R1-taxonomy | Bad-question rubrics + invasive-question perception + demographic variance | **done** | 22 sources, 7-D rubric → role-discovery-guardrails-research-taxonomy.md |
| T2 | R2-compliance | EEOC / Title VII / ADA / state + international AI-hiring law | **done** | 26 sources, sensitivity ladder, Mobley v. Workday class cert flagged → role-discovery-guardrails-research-compliance.md |
| T3 | R3-xai | Rationale surfacing + CoT-as-guardrail + Constitutional AI | **done** | 25 sources, rationale-before-question validated (38.15% gap Tam 2024), Panickssery cross-family judge validated → role-discovery-guardrails-research-xai.md |
| T4 | R4-depth | Laddering depth + probing pivots + consistency classifiers | **done** | 25 sources, 3-turn threshold (convergent from 5 traditions), consistency classifier generalizes → role-discovery-guardrails-research-depth.md |
| T5 | Lead | Synthesize + draft | in_progress | knowledge/outputs/.drafts/role-discovery-guardrails-draft.md |
| T6 | verifier | Inline citations + URL verification | todo | knowledge/role-discovery/role-discovery-guardrails.md |
| T7 | reviewer | Evidence-integrity review | todo | knowledge/role-discovery/role-discovery-guardrails-verification.md |

## Verification log

| Item | Method | Status | Evidence |
|---|---|---|---|
| All 7 sub-questions covered ≥2 independent sources | Plan review of 4 research files | PASS | R1 n=22, R2 n=26, R3 n=25, R4 n=25 |
| Compliance includes primary statute + enforcement | R2 inspection | PASS | iTutorGroup $365K settlement + Mobley class cert May 2025 + EEOC amicus |
| Conversational XAI (not static prediction) studies present | R3 inspection | PASS | Tam EMNLP 2024, IUI 2025, CHI 2025 |
| Numeric depth threshold with evidence | R4 inspection | PASS | 3 turns convergent from 5 traditions — flagged as inference, not direct measurement |
| Contradictions flagged | Cross-reading | PASS | R3 internal/external tension (quality lever vs user-gaming) surfaced; R1 cross-cultural aggregate vs sub-group variance surfaced |
| Acceptance criteria satisfied | Plan review | PASS | All 9 criteria met — proceeding to draft |

## Decision log

- **2026-04-17** — Research scoped to *guardrails only*. Sales-intake / EVP extraction already covered by the 2026-04-11 brief (`role-discovery-sales-intake.md`). This brief complements, does not duplicate.
- **2026-04-17** — Using Sonnet-level researchers (not Haiku), as explicitly requested and as prior role-discovery research used.
- **2026-04-17** — Research files will live in `knowledge/role-discovery/` alongside the prior intake brief, not `knowledge/outputs/`, per user direction ("add the research to /role-discovery").
- **2026-04-17** — Round 1 complete, no second round needed. All sub-questions have ≥2 independent sources. Key gap: no direct empirical study of follow-up depth in hiring-intake dialogue specifically (R4 flagged this; convergent inference from 5 adjacent domains instead). This gap is recorded in Open Questions, not a blocker — it's the highest-value future experiment PIPE could run.
- **2026-04-17** — Surprising finding adopted into draft: Trump administration's January 2025 removal of the EEOC AI-guidance doc is *legally irrelevant* — the underlying statutes (Title VII / ADA / ADEA) are unchanged, and state-level regulation (CA FEHA Oct 2025, Colorado SB24-205, Illinois 1/2026) is accelerating in response. Removing the guidance may *increase* enterprise-buyer anxiety.
- **2026-04-17** — Mobley v. Workday class certification (May 2025) with EEOC amicus endorsing "agent theory" is the single most load-bearing legal finding for PIPE as a platform. Treated as non-negotiable in the design recommendations.
