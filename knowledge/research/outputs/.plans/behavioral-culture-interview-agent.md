> **STATUS: COMPLETED PLAN** · Created 2026-04-07 11:26 · Run delivered 2026-04-07 11:25
> **Research run:** `behavioral-culture-interview-agent`
> **Role in run:** The plan file. Note: written *after* the run was delivered — this was a retroactive formalization of the mental plan the Lead used.
> **Outcome:** Completed with all acceptance criteria met in Round 1 (4 parallel researchers). No Round 2 required.
> **Use for:** Understanding scope decisions and what was deliberately excluded.
> **Navigate:** [INDEX](../../INDEX.md) · [final brief](../behavioral-culture-interview-agent.md)

---

# Research Plan: Behavioral & Culture Fit Interview Agent

**Slug:** `behavioral-culture-interview-agent`  
**Date:** 2026-04-07  
**Context:** Building Pipe — an AI-native developer interview platform. We have an existing question bank (seniority-tiered behavioral questions + culture-fit questions adapted from First Round Review), a mock interview transcript (Casey/David STAR format), and a culture scoring model (5 dimensions). The goal is to build an intelligent agent that can *conduct*, *probe*, *score*, and *report on* behavioral and culture-fit interviews autonomously.

---

## Questions

### Q1 — Scientific Foundations
1a. What does the IO psychology literature say about the predictive validity of structured behavioral interviews vs. unstructured ones?  
1b. What competency frameworks (BARS, STAR, situational interviews) have the strongest empirical backing for predicting job performance?  
1c. What are the documented biases in behavioral interviews and how do AI systems either replicate or reduce them?  
1d. What is "person-organization fit" as a construct — how is it measured, and what does it actually predict?

### Q2 — AI & NLP for Interview Intelligence
2a. What NLP/ML approaches exist for automated scoring of open-ended behavioral interview responses?  
2b. How do current LLM-based interview systems (GPT-4, Claude, Mistral) perform at response evaluation and follow-up generation?  
2c. What are the best architectures for a conversational interview agent — state machines, ReAct-style agents, memory-augmented models?  
2d. How do commercial platforms (HireVue, Paradox/Olivia, Pymetrics, Interviewed) implement AI interview scoring?

### Q3 — Culture Fit Assessment Science
3a. What is the evidence base for "culture fit" as a hiring signal — does it predict tenure, performance, or team effectiveness?  
3b. How do leading companies (Netflix, Stripe, Shopify) operationalize culture assessment in hiring?  
3c. What distinguishes "culture fit" from "culture add" and why does the distinction matter for AI scoring?  
3d. What are the best frameworks for extracting culture signal from free-text responses?

### Q4 — Agent Design & Follow-up Question Generation
4a. What strategies exist for generating contextually relevant follow-up probes in behavioral interviews?  
4b. How should an interview agent handle evasive, incomplete, or off-topic answers?  
4c. What is the ideal conversation flow structure for a behavioral interview agent (opening, probing depth, graceful closing)?  
4d. How do humans calibrate follow-up depth in STAR responses — what signals indicate a response is "complete enough"?

### Q5 — Scoring, Rubrics & Narrative Generation
5a. What are the best-validated scoring dimensions for behavioral interviews (beyond generic 1–5 scales)?  
5b. How should a scoring agent produce *explainable* narrative reports rather than opaque scores?  
5c. What is the state of the art for inter-rater reliability in automated interview scoring?  
5d. How do panel-based scoring systems (multiple AI raters) outperform single-evaluator models?

### Q6 — Legal, Ethical & Bias Considerations
6a. What legal constraints apply to AI-conducted interviews (EEOC, EU AI Act, state laws like Illinois AEIA)?  
6b. What demographic biases have been documented in automated interview platforms?  
6c. What mitigation strategies are recommended for fair AI-driven behavioral scoring?

---

## Strategy

### Research dimensions (parallelizable)

| Dimension | Source types | Researcher |
|---|---|---|
| IO psychology + behavioral validity | Academic papers (IO psych, HRM journals) | R1 |
| AI/NLP/LLM for interview scoring | arXiv, recent ML papers, conference proceedings | R2 |
| Culture fit science + operationalization | Academic + industry blogs/docs | R3 |
| Agent architecture + follow-up generation | arXiv, engineering blogs, open-source repos | R4 |
| Commercial platforms + legal/ethical | Web: vendor docs, regulatory sources, news | R5 |

### Time periods
- IO psychology foundations: 1980–present (Campion et al. 1994 is foundational)
- AI interview scoring: 2017–2026 (HireVue controversy 2019, LLM era 2022–present)
- Legal/regulatory: 2021–2026 (Illinois AEIA 2020, EU AI Act 2024–2026)

### Expected rounds
- Round 1: 4 parallel researchers (R1–R4 combined as R1=papers, R2=AI/NLP papers, R3=culture+platforms web, R4=agent design+legal)
- Round 2 (if needed): targeted gap-fill on underanswered questions

---

## Acceptance Criteria
- [ ] Q1: ≥3 empirical sources on structured interview validity (with effect sizes if available)
- [ ] Q2: ≥2 papers + ≥2 product sources on AI interview scoring
- [ ] Q3: ≥2 sources on culture fit predictive validity + ≥2 on culture add operationalization
- [ ] Q4: ≥2 sources on follow-up probe strategies or conversational interview agent design
- [ ] Q5: ≥2 sources on scoring rubrics/BARS + ≥1 on narrative generation
- [ ] Q6: ≥2 legal sources + ≥2 bias documentation sources
- [ ] All critical findings supported by ≥2 independent sources
- [ ] Contradictions between sources identified and flagged

---

## Task Ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | R1 | IO psychology: structured interview validity, BARS, STAR, competency frameworks, predictive validity | ✅ done | `behavioral-culture-interview-agent-research-io-psych.md` |
| T2 | R2 | AI/NLP for interview scoring: papers on automated behavioral scoring, LLM evaluators, response completeness | ✅ done | `behavioral-culture-interview-agent-research-ai-nlp.md` |
| T3 | R3 | Culture fit science + commercial platforms: P-O fit theory, culture add, HireVue/Paradox/Pymetrics design, scoring | ✅ done | `behavioral-culture-interview-agent-research-culture-platforms.md` |
| T4 | R4 | Agent architecture + follow-up generation + legal/ethical: conversational agent patterns, probe generation, EEOC/EU AI Act/AEIA, bias studies | ✅ done | `behavioral-culture-interview-agent-research-agent-legal.md` |
| T5 | lead | Evaluate round 1, identify gaps, spawn round 2 if needed | ✅ done — no round 2 needed | — |
| T6 | lead | Write synthesis draft | ✅ done | `outputs/.drafts/behavioral-culture-interview-agent-draft.md` |
| T7 | worker | Add citations, verify URLs | ✅ done | `behavioral-culture-interview-agent-brief.md` |
| T8 | reviewer | Verification pass | ✅ done — PASS WITH NOTES | `behavioral-culture-interview-agent-verification.md` |
| T9 | lead | Fix FATAL/MAJOR issues + deliver final output + provenance | ✅ done | `outputs/behavioral-culture-interview-agent.md` |

---

## Verification Log

| Item | Method | Status | Evidence |
|---|---|---|---|
| Predictive validity of structured interviews (meta-analytic r) | Cross-read ≥2 meta-analyses | pending | — |
| HireVue dropped facial analysis (2021) | Direct fetch vendor page or news | pending | — |
| Illinois AEIA requirements | Fetch IL government / legal source | pending | — |
| LLM behavioral scoring accuracy claims | Paper cross-read | pending | — |
| Culture fit predicts turnover (specific effect size) | Cross-read ≥2 empirical papers | pending | — |

---

## Decision Log

- **2026-04-07 — Plan created.** Existing knowledge base has: seniority-tiered behavioral question bank (8 levels), culture-fit question bank (12 categories, ~40 questions), STAR mock transcript (Casey/David, Senior SWE), culture scoring model (5 dimensions: self-awareness, growth, collaboration, motivation, cultural signal). Research will focus on the *scientific grounding, agent architecture, and scoring methodology* needed to make those assets intelligent.
- **Scope boundary:** We do NOT research coding interview AI (that's a separate system). We focus on behavioral + culture only.
- **Platform:** Mistral is the AI layer; research should note where Mistral-specific capabilities or limitations matter.
