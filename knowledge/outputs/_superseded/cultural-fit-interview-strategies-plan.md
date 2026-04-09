> **STATUS: SUPERSEDED** · Created 2026-04-07 08:33 · Superseded 2026-04-07
> **This plan was never executed.** It was an early ambitious 8-researcher plan on cultural-fit + behavioral interviews.
> **Replaced by:** [`../behavioral-culture-interview-agent.md`](../behavioral-culture-interview-agent.md) — the real research run, delivered 2026-04-07 11:25 with 48 cited sources.
> **Why superseded:** This scope was absorbed into the broader `behavioral-culture-interview-agent` run later the same morning, which used a more focused 4-researcher design.
> **Kept for:** historical record of the initial scoping exercise.

---

# Research Plan: cultural-fit-interview-strategies

## Research Objective
Investigate cultural-fit interviews and behavioral interviews to build a knowledge base for LLM training. This includes:
- Question taxonomies and knowledge bases
- Interview conductor/orchestrator strategies
- Assessment frameworks and rubrics
- Question generation and adaptation approaches
- Multi-turn interview patterns and best practices

## Questions

### 1. Cultural-Fit Interview Taxonomy
- What are the core dimensions of cultural-fit interviews?
- What are the standard question types for each dimension?
- What are the evidence-based best practices for conducting cultural-fit interviews?
- What are the common pitfalls and how to avoid them?

### 2. Behavioral Interview Taxonomy  
- What are the core dimensions of behavioral interviews (STAR, CAR, etc.)?
- What are the standard question types for each STAR/CAR component?
- What are the evidence-based best practices for conducting behavioral interviews?
- How do behavioral interviews differ across roles (frontend, backend, full-stack)?

### 3. Question Knowledge Base Design
- What are the existing question libraries and taxonomies?
- What are the core attributes for questions in a knowledge base?
- What are the evidence-based approaches for question storage and retrieval?
- How should questions be tagged and organized for LLM training?

### 4. Interview Conductor/Orchestrator Strategies
- What are the existing orchestration patterns for multi-agent interviews?
- What are the evidence-based approaches for conductor decision-making?
- How should the conductor handle edge cases and error states?
- What are the best practices for conductor-user communication?

### 5. Assessment Agent Design
- What are the existing assessment frameworks and rubrics?
- What are the core attributes for assessment in a knowledge base?
- What are the evidence-based approaches for assessment storage and retrieval?
- How should assessments be tagged and organized for LLM training?

### 6. Question Generation Agent Design
- What are the existing question generation approaches?
- What are the evidence-based approaches for question generation?
- How should the question generation agent handle edge cases and error states?
- What are the best practices for question generation-agent communication?

### 7. Multi-Turn Interview Patterns
- What are the existing multi-turn interview patterns?
- What are the evidence-based approaches for multi-turn interview design?
- How should follow-up questions be generated and adapted?
- What are the best practices for maintaining interview coherence across turns?

### 8. LLM Training Integration Strategies
- What are the existing approaches for integrating interviews into LLM training?
- What are the evidence-based approaches for training data preparation?
- How should the training data be structured and organized?
- What are the best practices for model fine-tuning and evaluation?

## Strategy

### Researcher Allocations (8 parallel researchers)

| Researcher | Dimension | Output File | Task ID | Coverage Scope |
|---|---|---|---|---|
| **researcher-1** | Cultural-Fit interview taxonomy (papers, academic sources) | cultural-fit-interview-taxonomy-papers.md | T1 | 2010-2026 academic literature, peer-reviewed studies |
| **researcher-2** | Cultural-Fit interview best practices (web, docs, vendor pages) | cultural-fit-interview-strategies-web.md | T2 | Hireology, BambooHR, Glassdoor, LinkedIn, Indeed, company career pages |
| **researcher-3** | Behavioral interview taxonomy (papers, academic sources) | behavioral-interview-taxonomy-papers.md | T3 | 2010-2026 academic literature, peer-reviewed studies |
| **researcher-4** | Behavioral interview best practices (web, docs, vendor pages) | behavioral-interview-strategies-web.md | T4 | Hireology, BambooHR, Glassdoor, LinkedIn, Indeed, company career pages |
| **researcher-5** | Question knowledge base design (codebases, libraries, official docs) | question-knowledge-base-design.md | T5 | PIPE codebase, Mistral eval frameworks, open-source interview libraries |
| **researcher-6** | Interview conductor/orchestrator strategies (papers, web, code) | conductor-strategies.md | T6 | Multi-agent orchestration papers, conductor frameworks, official docs |
| **researcher-7** | Assessment agent design (papers, web, code) | assessment-agent-design.md | T7 | Rubric frameworks, Mistral scoring panels, official assessment docs |
| **researcher-8** | Question generation and multi-turn patterns (papers, web) | question-generation-patterns.md | T8 | Prompt engineering papers, LLM training integration approaches |

### Expected Rounds
- **Round 1 (Taxonomy + Best Practices):** Researchers T1-T4 return with taxonomy and best practices evidence. I will identify gaps and contradictions, then spawn targeted researchers for specific missing pieces. Likely 1 additional round for taxonomy refinement. (Total: 1-2 rounds)

- **Round 2 (Design + Strategies):** Researchers T5-T8 return with design and strategy evidence. I will evaluate sufficiency against the acceptance criteria, particularly checking for single-source claims on critical findings. If evidence is sufficient, proceed to writing. If gaps remain, spawn another targeted batch. (Total: 2-3 rounds)

### Source Types and Time Periods

| Dimension | Source Types | Time Period | Priority |
|---|---|---|---|
| **Cultural-Fit taxonomy (papers)** | Peer-reviewed studies, academic papers, systematic reviews | 2010-2026 | High |
| **Cultural-Fit best practices (web)** | Official vendor documentation, career site best practices, industry reports | 2020-2026 | High |
| **Behavioral interview taxonomy (papers)** | STAR/CAR frameworks, peer-reviewed studies, systematic reviews | 2010-2026 | High |
| **Behavioral interview best practices (web)** | Official frameworks, industry reports, academic sources | 2020-2026 | High |
| **Question knowledge base (code)** | PIPE codebase, Mistral eval frameworks, open-source libraries | 2024-2026 | High |
| **Question knowledge base (docs)** | Official documentation, academic sources | 2010-2026 | Medium |
| **Conductor strategies (papers)** | Multi-agent orchestration, conductor frameworks, peer-reviewed studies | 2015-2026 | High |
| **Conductor strategies (web)** | Official orchestration docs, industry reports | 2020-2026 | Medium |
| **Assessment design (papers)** | Rubric frameworks, Mistral scoring panels, academic sources | 2010-2026 | High |
| **Assessment design (web)** | Official assessment docs, industry reports | 2020-2026 | Medium |
| **Question generation patterns (papers)** | Prompt engineering, LLM training integration, academic sources | 2020-2026 | High |
| **Question generation patterns (web)** | Industry reports, official frameworks | 2020-2026 | Low |

### Evidence Types Needed

| Evidence Type | Description | Critical for |
|---|---|---|
| **Academic papers** | Peer-reviewed studies with methodology | Taxonomy, assessment design, question generation patterns |
| **Official documentation** | Vendor or framework official docs | Best practices, conductor strategies, assessment design |
| **Codebases** | Open-source implementations, PIPE codebase | Question knowledge base design, conductor strategies |
| **Industry reports** | Market research, best practices reports | Cultural-fit best practices, behavioral interview best practices |
| **Vendor pages** | Career site examples, official frameworks | Cultural-fit best practices, behavioral interview best practices |
| **Benchmark data** | Quantitative comparisons of approaches | Question generation patterns, multi-turn patterns |

## Acceptance Criteria

### Sufficiency Conditions
- [ ] All key questions answered with ≥2 independent sources
- [ ] Contradictions identified and addressed with evidence-based reasoning
- [ ] No single-source claims on critical findings (taxonomy, assessment design, conductor strategies)
- [ ] Quantitative data (if any) verified through direct sources or calculations
- [ ] Code claims checked against actual implementations in repositories

### Critical Claims That Require Multiple Sources

| Claim Type | Finding | Sources Needed |
|---|---|---|
| **Taxonomy claim** | A cultural-fit dimension exists with standard question types | Academic paper + industry report/vendor page |
| **Best practices claim** | A cultural-fit interview best practice is evidence-based | Peer-reviewed study + official framework documentation |
| **Assessment design claim** | An assessment rubric dimension exists with scoring criteria | Academic paper + official assessment framework |
| **Conductor strategy claim** | A multi-agent orchestration pattern exists for conductor decision-making | Peer-reviewed multi-agent paper + official orchestration docs |
| **Question generation pattern claim** | A prompt engineering approach exists for question generation | Academic paper + official framework documentation |

### Verification Requirements

| Item | Method | Status | Evidence Path |
|---|---|---|---|
| **Critical taxonomy dimension** | Cross-read with academic sources and verify against behavioral literature | pending | cultural-fit-interview-taxonomy-papers.md |
| **Assessment rubric dimension** | Check against Mistral scoring panel research and academic rubric frameworks | pending | assessment-agent-design.md |
| **Conductor orchestration pattern** | Verify against multi-agent orchestration papers and official conductor frameworks | pending | conductor-strategies.md |
| **Question knowledge base attributes** | Check against PIPE codebase and Mistral eval frameworks | pending | question-knowledge-base-design.md |
| **Quantitative comparisons** | If any benchmark data exists, verify through direct sources and calculations | pending | behavioral-interview-strategies-web.md |

## Task Ledger

| ID | Owner | Task | Status | Output | Dependencies |
|---|---|---|---|---|---|
| **T1** | researcher-1 | Cultural-Fit interview taxonomy (papers: academic literature, peer-reviewed studies) | todo | cultural-fit-interview-taxonomy-papers.md | None |
| **T2** | researcher-2 | Cultural-Fit interview best practices (web: vendor docs, career sites, industry reports) | todo | cultural-fit-interview-strategies-web.md | None |
| **T3** | researcher-3 | Behavioral interview taxonomy (papers: STAR/CAR frameworks, academic literature) | todo | behavioral-interview-taxonomy-papers.md | None |
| **T4** | researcher-4 | Behavioral interview best practices (web: frameworks, industry reports, vendor docs) | todo | behavioral-interview-strategies-web.md | None |
| **T5** | researcher-5 | Question knowledge base design (code: PIPE codebase, Mistral eval frameworks; docs: official docs) | todo | question-knowledge-base-design.md | T1, T3 |
| **T6** | researcher-6 | Interview conductor/orchestrator strategies (papers: multi-agent orchestration; web: official orchestration docs; code: conductor frameworks) | todo | conductor-strategies.md | T1, T3 |
| **T7** | researcher-7 | Assessment agent design (papers: rubric frameworks, Mistral scoring panels; web: official assessment docs) | todo | assessment-agent-design.md | T1, T3 |
| **T8** | researcher-8 | Question generation and multi-turn interview patterns (papers: prompt engineering, LLM training integration; web: industry reports) | todo | question-generation-patterns.md | T1, T3 |

## Verification Log

| Item | Method | Status | Evidence |
|---|---|---|---|
| **Critical taxonomy dimension exists** | Academic paper cross-read verification | pending | cultural-fit-interview-taxonomy-papers.md |
| **Assessment rubric dimension is valid** | Check against Mistral scoring panel research and academic frameworks | pending | assessment-agent-design.md |
| **Conductor orchestration pattern is implemented** | Verify against multi-agent orchestration papers and official conductor frameworks | pending | conductor-strategies.md |
| **Question knowledge base attributes match actual code** | Codebase inspection verification | pending | question-knowledge-base-design.md |
| **Quantitative data (if any) is correct** | Direct source verification and calculations | pending | behavioral-interview-strategies-web.md |

## Decision Log

(Updated as the workflow progresses)

| Decision | Rationale | Status | Evidence |
|---|---|---|---|
| **8 parallel researchers** | Topic is broad enough to warrant parallel coverage across dimensions, avoiding duplication | planned | task ledger |
| **Taxonomy researchers focus on 2010-2026 academic literature** | Cultural-fit and behavioral interview research has matured over this period with peer-reviewed studies | planned | acceptance criteria |
| **Best practices researchers focus on 2020-2026 official vendor documentation and industry reports** | Recent best practices are more likely to be evidence-based and implemented in current systems | planned | acceptance criteria |

---

Last updated: 2026-04-07

Next step: Present this plan to the user for confirmation before proceeding with the research workflow.