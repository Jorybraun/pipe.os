> **STATUS: SUPERSEDED** · Created 2026-04-07 09:53 · Superseded 2026-04-07
> **This plan was never executed.** It was a second attempt (4 researchers) on the culture interview agent.
> **Replaced by:** [`../behavioral-culture-interview-agent.md`](../behavioral-culture-interview-agent.md) — the real research run, delivered 2026-04-07 11:25 with 48 cited sources.
> **Why superseded:** Scope rolled into the broader `behavioral-culture-interview-agent` run 75 minutes later the same morning. The final run covered the same ground with a tighter researcher allocation.
> **Kept for:** historical record of the initial scoping exercise.

---

# Research Plan: culture-interview-agent

## Research Question
How to design an AI interview agent that conducts effective cultural and behavioral interviews that go beyond simple question-asking to actually assess soft skills, cultural fit, and behavioral patterns in a predictive way.

## Key Questions to Answer

### 1. Behavioral Interview Science
- What are the established psychological frameworks for behavioral interviewing?
- Which behavioral interview techniques (STAR, CAR, PARADE, etc.) have empirical validation?
- What makes behavioral questions predictive vs. performative?

### 2. Cultural Fit Assessment
- How is cultural fit defined and measured in hiring research?
- What are the risks of cultural fit bias, and how can they be mitigated?
- What dimensions predict long-term success beyond technical skills?

### 3. Agent Architecture Requirements
- What capabilities must the agent have to conduct effective cultural interviews?
- How should the agent adapt questions based on candidate responses?
- What scoring mechanisms produce reliable predictions?

### 4. Candidate Experience
- What makes candidates feel respected vs. interrogated?
- How does response format (text vs. video vs. audio) affect response quality?
- What's the optimal question pacing and format?

### 5. Implementation Patterns
- What existing systems do this well?
- What are the failure modes to avoid?
- What's the minimal viable agent that can produce useful signals?

## Evidence Types Needed

| Type | Sources | Time Period | Priority |
|---|---|---|---|
| **Academic Papers** | Behavioral interview validity studies, hiring psychology research, cultural fit measurement | 2010-2026 | Critical |
| **Industry Research** | First Round Review, Harvard Business Review, McKinsey, Deloitte, SHRM | 2015-2026 | Critical |
| **Existing Systems** | GitCodeCareer, First Round Review question banks, HireVue, Pymetrics, Culture Amp | Current | Critical |
| **Implementation Guides** | Engineering hiring playbooks, startup hiring guides, technical interview best practices | 2018-2026 | High |
| **Psychometric Validation** | Meta-analyses on interview validity, predictive validity studies, bias research | 2005-2026 | High |
| **Code Examples** | Open-source interview systems, AI agent frameworks for interviews | Current | Medium |

## Source Dimensions & Parallelization Strategy

### Dimension 1: Behavioral Interview Science (Researcher A)
- Focus: Psychological frameworks, predictive validity studies, behavioral question design
- Sources: Academic papers, meta-analyses, hiring psychology research
- Output: `culture-interview-agent-research-science.md`
- Task IDs: T1, T2, T3

### Dimension 2: Cultural Fit Assessment (Researcher B)
- Focus: Cultural fit definition, bias mitigation, long-term success predictors
- Sources: Industry research, HR studies, case studies
- Output: `culture-interview-agent-research-fit.md`
- Task IDs: T4, T5, T6

### Dimension 3: Agent Architecture & Implementation (Researcher C)
- Focus: Agent capabilities, adaptive questioning, scoring mechanisms
- Sources: Existing systems, implementation guides, technical documentation
- Output: `culture-interview-agent-research-architecture.md`
- Task IDs: T7, T8, T9

### Dimension 4: Candidate Experience & UX (Researcher D)
- Focus: Response formats, pacing, respectful interviewing techniques
- Sources: Candidate experience research, UX studies, industry best practices
- Output: `culture-interview-agent-research-ux.md`
- Task IDs: T10, T11, T12

## Acceptance Criteria

### Evidence Sufficiency
- [ ] All key questions answered with ≥2 independent sources per major claim
- [ ] No single-source claims on critical findings (validity, bias, architecture)
- [ ] Contradictions identified and addressed with evidence quality assessment

### Critical Claims Verification
| Claim | Required Evidence | Status |
|---|---|---|
| Behavioral interviews predict performance better than unstructured interviews | Meta-analysis with effect size | Pending |
| STAR method produces more predictive responses than traditional questions | Empirical study with control group | Pending |
| Cultural fit can be measured without bias | Peer-reviewed HR research | Pending |
| Adaptive questioning improves response quality | A/B test or user study | Pending |
| Video responses provide better signals than text for cultural assessment | Comparative study | Pending |

### Deliverable Quality
- [ ] Complete research brief with executive summary
- [ ] Architecture recommendations with trade-offs
- [ ] Question bank with rationales
- [ ] Scoring rubric with validation methods
- [ ] Implementation roadmap with MVP definition

## Task Ledger

| ID | Owner | Task | Status | Output | Dependencies |
|---|---|---|---|---|---|
| T1 | Researcher A | Find meta-analyses on interview validity and behavioral interviewing effectiveness | todo | culture-interview-agent-research-science.md | - |
| T2 | Researcher A | Identify established behavioral interview frameworks (STAR, CAR, PARADE, etc.) with sources | todo | culture-interview-agent-research-science.md | T1 |
| T3 | Researcher A | Research predictive validity of different question types and response formats | todo | culture-interview-agent-research-science.md | T2 |
| T4 | Researcher B | Define cultural fit: what it is, what it measures, how to assess without bias | todo | culture-interview-agent-research-fit.md | - |
| T5 | Researcher B | Find research on long-term success predictors beyond technical skills | todo | culture-interview-agent-research-fit.md | T4 |
| T6 | Researcher B | Identify bias mitigation strategies in cultural fit assessment | todo | culture-interview-agent-research-fit.md | T5 |
| T7 | Researcher C | Analyze existing cultural interview systems (GitCodeCareer, First Round Review, HireVue) | todo | culture-interview-agent-research-architecture.md | - |
| T8 | Researcher C | Design agent capabilities: adaptive questioning, follow-up generation, scoring | todo | culture-interview-agent-research-architecture.md | T7 |
| T9 | Researcher C | Develop scoring rubric and validation methodology | todo | culture-interview-agent-research-architecture.md | T8 |
| T10 | Researcher D | Research candidate experience best practices in async interviews | todo | culture-interview-agent-research-ux.md | - |
| T11 | Researcher D | Compare text vs. video vs. audio response formats for cultural assessment | todo | culture-interview-agent-research-ux.md | T10 |
| T12 | Researcher D | Identify pacing strategies and respectful interviewing techniques | todo | culture-interview-agent-research-ux.md | T11 |

## Verification Log

| Item | Method | Status | Evidence |
|---|---|---|---|
| Behavioral interview validity meta-analysis | Source cross-read and effect size verification | pending | path/to/sources |
| STAR method effectiveness | Empirical study replication check | pending | path/to/sources |
| Cultural fit bias research | Peer-reviewed study verification | pending | path/to/sources |
| Agent architecture claims | Code example verification | pending | path/to/sources |

## Decision Log

### Initial Decisions
- **Scope**: Focus on cultural/behavioral interviews specifically, not technical interviews
- **Format**: Async interviews preferred over live for deeper reflection
- **Scoring**: Qualitative scoring model with recruiter review, not binary pass/fail
- **Adaptation**: Agent should adapt questions based on responses, not follow fixed script

### Open Architecture Questions
- Should candidates see which dimensions they're being evaluated on? (TBD after research)
- What's the minimal viable agent that produces useful signals? (TBD after T8)
- How granular should the scoring be? (TBD after T9)

---

*Plan created: 2026-04-07*
*Next: Confirm plan with user, then spawn researchers*