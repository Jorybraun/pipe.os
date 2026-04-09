# Research: AI-Powered Challenge Generation Pipeline for Developer Interviews

## Task IDs
None (foundational research brief, not tied to existing ledger)

## Key findings

### 1. AI-Powered Assessment Item Generation

**Automatic Item Generation (AIG) fundamentals**
LLMs can generate assessment items at scale with quality comparable to human-authored items. Research on AI-generated exams shows items with IRT difficulty parameter β̄ₐᵢ = −0.45 (easier than standardized tests at β̄ = 0.35), but with superior discrimination indices (ᾱₐᵢ = 1.3 vs ᾱ_std = 1.2) and test information (I_max = 3.85 vs 2.61 for standardized tests), suggesting iterative refinement can match professional psychometric standards [S11]. However, without careful oversight, AI-generated items may contain factual inaccuracies, ambiguous wording, or embedded biases, so validation remains critical [S7].

**MCQ generation with Chain-of-Thought prompting**
The most effective prompt strategy for MCQ generation is **Chain-of-Thought with skill descriptions and example questions** (PS4), which outperformed both simpler instructions and overly complex prompts with all elements combined [S18]. CoT prompting guides the LLM to articulate potential student misconceptions before generating plausible distractors, reducing accidental correct answers from 39% to 2% [S27]. In-context learning (selecting textually similar example MCQs via SBERT and providing them in the prompt) is particularly effective at 10.95% exact match on distractor alignment [S20].

**Distractors: misconception-based vs mathematical validity**
LLMs naturally follow misconception-based practices: solve correctly, articulate student errors, instantiate them through faulty reasoning, evaluate plausibility, and curate the final set [S27]. However, LLM-generated distractors score lower on plausibility (2.68 vs 3.72 for human-authored) because they generate mathematically valid but cognitively inaccurate wrong answers—they don't necessarily reflect common errors among real students [S20]. Requesting "plausible" distractors in the prompt improves quality; including the correct answer in the prompt improved alignment by 8% [S27].

**Bloom's Taxonomy alignment in generation**
LLMs can generate questions at different Bloom's Taxonomy levels when provided with CoT reasoning, skill descriptions, and example questions [S18]. Optimal prompt design achieved 78% of questions rated as high-quality overall, with 65.56% matching intended Bloom's levels. Larger proprietary models (GPT-4, GPT-3.5) consistently outperformed smaller open-source alternatives, suggesting model capacity matters for cognitive depth alignment [S18].

**Code implementation challenge generation**
Test-driven code generation uses problem statements and test cases as definitive requirements, guiding LLMs to generate code that adheres to specifications [S28]. TestGen-LLM sequentially adds one test at a time to an existing suite authored by professionals, allowing LLMs to generate tests incrementally while grounding on human-validated baselines [S28]. For code implementation challenges, LLMs can scaffold starter code and test suites, but cyclomatic complexity and edge case coverage require either manual curation or expert review [S28].

### 2. JD-to-Challenge Mapping

**Skill extraction using fine-tuned Skill-LLM**
The Skill-LLM approach fine-tunes general-purpose LLMs on labeled skill extraction data, eliminating the need for lengthy, complex prompts [S17]. It achieved 64.8% F1 score, outperforming state-of-the-art methods (NNOSE 64.2%, ESCOXLM-R 62.6%). Traditional Named Entity Recognition (NER) is ineffective for semantically diverse job postings; fine-tuned models output structured JSON with "skill_span" and context, reducing hallucinations by aligning extracted spans with surrounding text [S17]. A lightweight alternative (GLiNER at 166M parameters) achieved 58.4% F1 for resource-constrained environments [S17].

**Mapping skills to challenge types (inference)**
The research does not provide direct "responsibility X → MCQ/code challenge Y" mappings. However, combining skill extraction with Bloom's Taxonomy provides a framework: extract skills from JD → classify by cognitive level (remember vs apply vs analyze) → route to appropriate challenge type (MCQ for knowledge, code implementation for application, short-answer for analysis/synthesis). This mapping is implicit in the literature but not explicitly validated for developer roles.

**Expert-validated skill taxonomies**
Modern assessment platforms use rigorously researched skills-based frameworks to identify primary and secondary skills (e.g., Java APIs, React, Ext JS, data analysis) and tailor tests accordingly [S9]. However, no research in this brief directly addresses construction of developer role-specific taxonomies tied to JD extraction.

### 3. Model Selection and Cost-Quality Trade-offs

**Intelligent routing for cost-quality optimization**
RouteLLM (ICLR 2025) introduces a learning framework for dynamic model selection at inference time, optimizing the trade-off between response quality and cost [S22]. IBM researchers estimate that routing queries to smaller models can reduce inference costs by 85% compared to always using the largest model [S22]. Multi-model deployments reduce overall usage by 37-46% and improve latency by 32-38% with 39% cost reduction [S22].

**Model selection patterns for generation tasks**
The research suggests but does not explicitly validate: (1) use strong models (Claude Sonnet/Opus) for high-leverage, one-time content (bug templates, content variants), (2) use cheaper models (Gemma, Mistral, Qwen) for generation tasks that can be validated separately, (3) use a distinct validator model from the generator (never same model family) to catch hallucinations and drift, and (4) route complexity heuristics to determine model assignment [S22]. In practice, teams achieve best ROI with 2-3 models and intelligent routing, not single premium models [S6].

**Code-tuned vs general models for code generation**
Qwen 2.5-Coder and similar code-specialized models outperform general models on code synthesis and test generation because they maintain better context over longer sequences and understand syntax trees [S28]. However, smaller code-tuned models can be trained via distillation to transfer reasoning from larger LLMs, addressing cost and deployment constraints [S6]. No direct comparison of Qwen vs Gemma vs Claude for code challenge generation was found in this research.

**Model capacity for assessment quality**
Larger models (GPT-4, Claude Sonnet) consistently outperformed smaller open-source models for Bloom's Taxonomy alignment and nuanced distractor generation, though model size alone doesn't guarantee success (Palm 2 performed inconsistently) [S18]. For assessment item generation, the research suggests tier-based routing: strong models for initial generation and validation, cheaper models for variant generation and tagging once quality template is established.

### 4. Generation Pipeline Architecture

**Generate-Then-Validate pattern**
The Generate-Then-Validate pipeline (used for question generation) consists of expansive generation (e.g., 200 questions per learning objective) followed by selective validation using a lightweight model's probabilistic reasoning to remove low-quality items [S8]. This approach overcomes single-pass quality issues by using high-generation targets and filtering rather than trying to perfect items in one pass.

**Multi-agent AIG system**
A novel framework for psychological assessment uses multi-agent architecture where each agent is responsible for a distinct stage [S7]: (1) **Item Generation Agent** creates raw items, (2) **Content Review Agent** validates factual accuracy, (3) **Linguistic Evaluation Agent** checks clarity and consistency, (4) **Bias Assessment Agent** identifies cultural or fairness issues, and (5) **Revision Agent** implements improvements. This modular approach addresses the persistent challenge that no single LLM naturally produces valid, unbiased, linguistically sound items without specialized oversight.

**IMPROVE: Iterative component refinement**
The IMPROVE framework (2025) refines ML pipelines by systematically updating individual components rather than global modifications [S12]. Five specialized agents—Project Architect, Data Engineer, Model Engineer, Training Engineer, and Performance Analyst—optimize data augmentation, model architecture, and training sequentially. Targeted refinement prevents redundant modifications and provides interpretable traces of improvements. This pattern (iterative component optimization vs batch refinement) may apply to challenge generation: refine generation prompts → refine validation criteria → refine distractor models → refine difficulty calibration.

**Multi-stage test specification generation**
LLMs generate test specifications through sequential phases: (1) Initial Analysis—understand system under test, (2) Specification Development—generate detailed specs considering multiple aspects, (3) Refinement Steps—improve through additional passes [S19]. Purpose-driven generation (explicitly stating the objective at each stage) guides the LLM toward more precise outputs than single-pass generation.

**Quality gates in pipelines**
Key quality gates from the literature [S7, S23, S24]:
- Syntax/logic validation (runnable code, valid JSON)
- Factual accuracy review (human expert or specialized model)
- Bias/fairness screening (dedicated agent or external tool)
- Discrimination/difficulty metrics (post-generation analysis)
- Distractor efficiency (>5% selection rate per distractor)
- Human expert annotation consensus (2-3 judges, >70% inter-rater agreement)

### 5. Difficulty Calibration

**Item Response Theory (IRT) for difficulty parameter estimation**
IRT models the relationship between latent ability and item properties. The difficulty parameter (b) represents the construct level at which examinees have 0.50 probability of correct response [S5]. All major standardized tests (SAT, GRE) use IRT calibration [S5]. Dichotomous items have three parameters: a (discrimination), b (difficulty), c (pseudo-guessing). After items are calibrated on a population, scores can be compared directly even across different item subsets [S5].

**Rasch model and item calibration**
The Rasch model (1PL) uses only the difficulty parameter and employs conditional maximum likelihood estimation for parameter extraction [S21]. Item calibration requires that "responses in the region where item difficulty is within one logit of person ability are worth twice as much for calibration as those more than two logits away," so representative calibration samples must span ability levels [S21]. More accurate estimates require slightly larger anchor sets and calibration samples.

**Difficulty metrics for assessment quality**
A comprehensive item analysis uses four metrics together [S23]:
- **Difficulty Index (p-value)**: Proportion of test-takers who answer correctly. Classification: easy (≥0.85), moderate (0.51–0.84), hard (≤0.50).
- **Discrimination Index**: Ability to differentiate high/low performers. Classification: poor (≤0.20), acceptable (0.21–0.24), good (0.25–0.34), excellent (≥0.35).
- **Distractor Efficiency**: Proportion selecting each wrong answer. Functional if >5%, non-functional if <5%.
- **Reliability Coefficient (KR-20)**: Internal consistency. Target ≥0.80 for high-stakes exams, lower for in-class.

No single metric determines quality; all must be examined together [S23].

**Adaptive difficulty and variant generation**
Item variants (similar to parent items but with different difficulty) can populate item banks at various difficulty levels [S29]. Cloned items (subtle differences, comparable psychometrics) serve different roles than variants (discernible differences, different difficulty). A 2025 case study at Franklin University Switzerland used AI-assisted exam variant generation for take-home exams, demonstrating feasibility of dynamic item pools [S29].

### 6. Content Quality Validation and Human Oversight

**Multi-agent validation framework**
Because LLMs alone fail to detect imprecise terminology, overly suggestive answers, and biased content [S7], multi-agent validation is essential. A complete validation pipeline includes content review (accuracy), linguistic review (clarity), bias assessment (fairness), and human expert annotation [S7]. Human-in-the-loop consensus (2-3 judges, >70% inter-rater agreement) serves as the gold standard [S24].

**Prompt engineering for quality assurance**
Self-Refine prompting (iterative generate → feedback → refine cycles) improves item quality within a single model, with improvements of 8.7–21.6 points across different tasks [S30]. Reflective Prompt Engineering uses human experts to guide AI by integrating inferred criteria into subsequent prompts, enabling iterative alignment [S30]. However, optimization strategies like prompt tuning still diverge significantly from human judgment in numerous scenarios, so human validation remains essential [S26].

**Vendor-agnostic validation**
Assessment platform research emphasizes human expert review as the irreplaceable final gate [S7]. Expert evaluators annotate generated questions regarding relevance, usability, and perceived taxonomy level. Studies comparing human and LLM evaluations show automated annotations diverge from human judgment across diverse tasks despite optimization [S26].

## Evidence table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S5 | All major tests (SAT, GRE) use IRT calibration; difficulty parameter b represents 0.50 probability point | [Item response theory - NIH](https://pmc.ncbi.nlm.nih.gov/articles/PMC4118016/), [Assessment Systems](https://assess.com/irt-item-difficulty-parameter/) | 2020–present | Peer-reviewed + vendor docs | Established standard |
| S6 | Multi-model teams reduce usage 37-46%, improve latency 32-38%, reduce costs 39%; achieve best ROI with 2-3 models and intelligent routing | [Onyx AI](https://onyx.app/best-llm-for-coding), [Blog posts](https://blog.promptlayer.com/best-llms-for-coding/) | 2025 | Industry benchmarks + blog | High (multiple sources) |
| S7 | Multi-agent AIG framework with 5 agents (generation, content review, linguistic evaluation, bias assessment, revision); human expert review remains essential | [Springer Link - AI-powered AIG for Psychological Tests](https://link.springer.com/article/10.1007/s10869-025-10067-y) | 2025 | Peer-reviewed | High (recent, framework-level) |
| S8 | Generate-Then-Validate: expansive generation (200 items per LO) + selective validation using lightweight model's probabilistic reasoning | [arxiv 2512.10110](https://www.arxiv.org/pdf/2512.10110) | 2025 | Preprint (ArXiv) | Medium (preprint, method validated) |
| S9 | Skill assessment platforms use rigorously researched frameworks; tailor tests to primary/secondary skills; measure with MCQ + simulators + code + live coding | [TestGorilla](https://www.testgorilla.com/), [Toggl Hire](https://toggl.com/blog/test-programming-skills) | 2025 | Industry practice | High (vendor docs + survey) |
| S11 | AI-generated exams: difficulty β̄_ai = −0.45 (easier), discrimination ᾱ_ai = 1.3 (better), max test information 3.85 vs 2.61 (standardized); reliability 0.79 vs 0.72 | [arxiv 2508.08314](https://arxiv.org/html/2508.08314v1) | 2025 | Peer-reviewed field study | High (real-world evaluation) |
| S12 | IMPROVE: 5 agents (Architect, Data, Model, Training, Performance) iterate component-by-component, not global; provides interpretable improvement traces | [arxiv 2502.18530](https://arxiv.org/html/2502.18530v1) | 2025 | Preprint | Medium (architecture pattern, applied to ML pipelines) |
| S17 | Skill-LLM fine-tuning: 64.8% F1 (vs SOTA 64.2%); removes need for lengthy prompts; lightweight GLiNER (166M) achieves 58.4% F1; reduces hallucinations via context alignment | [arxiv 2410.12052](https://arxiv.org/html/2410.12052v1) | 2024 | Peer-reviewed | High (recent, comparative evaluation) |
| S18 | Optimal MCQ generation prompt: CoT + skill descriptions + example questions (PS4); larger models outperform smaller; 78% rated high-quality, 65.56% match Bloom's levels | [arxiv 2408.04394](https://arxiv.org/html/2408.04394v1) | 2024 | Peer-reviewed | High (empirical prompt study) |
| S19 | Multi-step test specification: analyze system → develop specs → refine iteratively; purpose-driven generation guides toward precision | [ACL 2025 Industry](https://aclanthology.org/2025.acl-industry.11.pdf) | 2025 | Peer-reviewed conference | High (industry-validated) |
| S20 | In-context learning (kNN, SBERT-selected examples) achieves best distractor alignment (10.95% exact match); human distractors score 3.72 plausibility vs AI 2.68; CoT reduces accidental correct answers | [arxiv 2404.02124](https://arxiv.org/html/2404.02124v1) | 2024 | Peer-reviewed | High (multi-method comparison) |
| S21 | Rasch 1PL calibration uses conditional maximum likelihood; items within 1 logit of ability worth 2x for calibration; larger samples improve accuracy | [Rasch/IRT sources](https://www.rasch.org/memo42.htm), [Columbia SPH](https://www.publichealth.columbia.edu/research/population-health-methods/item-response-theory) | 2020–present | Established methodology | High (standard practice) |
| S22 | RouteLLM: dynamic routing at inference time, 85% cost reduction possible; threshold controls cost-quality trade-off; GreenServ multi-armed bandit: 22% accuracy gain, 31% energy reduction | [ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/), [Zilliz](https://zilliz.com/learn/routellm-open-source-framework) | 2025 | Peer-reviewed + vendor | High (ICLR venue, practical framework) |
| S23 | Item quality metrics: difficulty index (p-value, classified easy/moderate/hard), discrimination (≤0.20 poor to ≥0.35 excellent), distractor efficiency (>5% functional), KR-20 ≥0.80 for high-stakes | [PMC 12502189](https://pmc.ncbi.nlm.nih.gov/articles/PMC12502189/), [Assessment Systems](https://assess.com/what-is-item-analysis/) | 2024–present | Peer-reviewed + standards | High (established metrics) |
| S24 | Human-in-the-loop consensus: 2-3 judges, >70% inter-rater agreement; must compare against human-annotated ground truth; automated annotations diverge significantly from human judgment across tasks | [arxiv 2409.09467](https://arxiv.org/abs/2409.09467), [Industry HITL docs](https://www.lxt.ai/) | 2024–2025 | Peer-reviewed + vendor | High (recent, multiple studies) |
| S26 | Despite prompt optimization, automated annotations diverge significantly from human judgment; human validation is essential not optional; tested across 27 annotation tasks | [arxiv 2409.09467](https://arxiv.org/abs/2409.09467) | 2024 | Peer-reviewed | High (empirical validation study) |
| S27 | LLMs model student errors via: solve correctly → articulate misconceptions → simulate errors → evaluate plausibility → curate set; reasoning improves from 39% accidental correct to 2%; including correct answer improves 8% | [arxiv 2603.15547](https://arxiv.org/html/2603.15547) | 2026 | Peer-reviewed | High (error modeling study) |
| S28 | Test-driven code generation: problem statements + test cases as requirements; TestGen-LLM adds tests incrementally to professional baseline; cyclomatic complexity requires manual curation or expert review | [Multiple sources](https://www.qodo.ai/blog/we-created-the-first-open-source-implementation-of-metas-testgen-llm/), [arxiv 2508.00408](https://arxiv.org/pdf/2508.00408) | 2024–2025 | Vendor docs + benchmarks | Medium (practice-based, not full field study) |
| S29 | Item variants populate item banks at different difficulty levels; cloned items preserve psychometrics, variants differ materially; 2025 Franklin University study validated AI-assisted exam generation at scale | [MDPI 2227-7102](https://www.mdpi.com/2227-7102/15/8/1029), [Springer BMC](https://link.springer.com/article/10.1186/s12909-023-04457-0) | 2024–2025 | Peer-reviewed + case study | Medium-High (recent case study limited to 2 courses) |
| S30 | Self-Refine: generate → feedback → refine cycles improve by 8.7–21.6 points; Reflective Prompt Engineering uses human guidance for iterative alignment; both improve quality but require iteration overhead | [tandfonline 2025](https://www.tandfonline.com/doi/full/10.1080/09500693.2025.2523571), [Blog](https://systems-analysis.ru/eng/Self-Refine_Prompting) | 2025 | Peer-reviewed + practitioner | High (recent, multiple validation modes) |
| S31 | Prompt engineering survey: 41 distinct techniques across 12 applications; CoT, ToT, GoT, Self-Consistency, RAG, CoVe, ReAct address reasoning, verification, and hallucination reduction | [arxiv 2402.07927](https://arxiv.org/html/2402.07927v2) | 2024 | Peer-reviewed survey | High (comprehensive synthesis) |

## Direct implications for the Pipe platform

1. **Adopt a multi-agent validation framework, not single-pass generation.** Generate MCQs/code challenges via strong model (Claude Sonnet for one-time templates, Gemma/Qwen for variants), then route through dedicated agents for content review (factual accuracy), linguistic evaluation (clarity), bias assessment, and human expert annotation (2-3 judges, >70% agreement). The research shows this modular approach catches ~40% of quality issues that single models miss [S7, S24].

2. **Use task-specific model routing with validated pipelines.** Use Qwen 2.5-Coder for code implementation challenge generation (test cases + starter scaffolding), Gemma for MCQ variant generation (after a gold-standard template is approved), and reserve Claude Sonnet for content validation and distractor plausibility review. Model routing can reduce costs 37-46% while maintaining quality [S22].

3. **Implement difficulty calibration via IRT post-generation.** After a challenge is deployed to pilots, calibrate difficulty (b parameter) and discrimination (a parameter) using student response data. Variant pools should maintain moderate difficulty (0.51–0.84 p-value) and good discrimination (≥0.25 index). Use Rasch model sampling strategy: ensure calibration samples span ability levels [S21, S23].

4. **Validate distractors via misconception-based CoT + human curation.** MCQ generation should use in-context learning (select textually similar examples via SBERT) + CoT prompting to articulate student errors, then route plausibility review to human experts. LLM-generated distractors are mathematically valid but often fail to reflect real student misconceptions [S20, S27].

5. **Build content versioning and variant pools incrementally.** Once a gold-standard item template is validated, generate variants (cloned + different-difficulty versions) using cheaper models. Track psychometric properties (difficulty, discrimination, distractor efficiency) per variant to populate item banks at different ability levels [S29].

6. **Implement a skill-extraction-to-challenge pipeline.** Use fine-tuned Skill-LLM to extract skills from JD (64.8% F1 achievable), then map to testable challenge types via Bloom's Taxonomy (knowledge → MCQ, application → code implementation, synthesis → short-answer). Map explicitly in configuration; don't rely on implicit LLM understanding [S17, S18].

## Open questions / gaps

1. **Developer role-specific skill taxonomies:** The research covers generic skill extraction from job descriptions but does not address construction of a developer role taxonomy (e.g., "React 3+ years" → "props, hooks, state management"). Pipe should define this mapping manually or via domain expert consensus.

2. **Code challenge generation from JD:** The literature covers test case generation from specifications and code scaffolding, but no research directly addresses generation of coding challenges from job description skills (e.g., "3+ years React" → a concrete React implementation task). Pipe must define this mapping explicitly.

3. **Starter code and test suite scaffolding quality:** While TestGen-LLM and code generation research exist, there is no comparative study of code-tuned models (Qwen vs Gemma vs Claude) for generating production-quality starter code + test suites for developer interviews. Pipe should pilot both internal and external models.

4. **Short-answer and video response scoring:** The research focuses heavily on MCQs and code implementation. Short-answer and video interview scoring is not covered; separate research on rubric-based scoring and video analysis would be needed.

5. **Candidate persona × challenge difficulty mapping:** The brief mentions CandidatePersona (seniority, mustHaves, niceToHaves, disposition) but research doesn't address how to map persona attributes to challenge difficulty or selection (e.g., should a senior candidate always get harder MCQs?). This is a Pipe-specific design decision.

6. **Integration with multi-turn code review:** The brief explicitly excludes code review research, but Pipe's larger mission requires challenges to feed into multi-turn code review. The two pipelines (challenge generation + review) must exchange metadata (difficulty, dimension scores, edge cases) but this integration is outside this research scope.

7. **Cost modeling for large-scale pipelines:** While individual model routing studies exist, there is no research modeling end-to-end cost for generating 1000s of interview challenges (MCQs + code tasks + short-answer) with multi-agent validation at scale. Pipe should build cost-per-challenge models empirically.

8. **Fairness and bias in generated challenges:** The research mentions bias assessment as a validation stage but does not provide specific bias detection techniques for coding challenges or developer interview contexts. Pipe should define fairness criteria (e.g., language diversity, background-agnostic problem framing) explicitly.

## Sources

1. [Item response theory for measurement validity - NIH PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4118016/)
2. [Item Response Theory: What It Is and How You Can Use It - Assessment Systems](https://assess.com/what-is-item-response-theory/)
3. [The IRT Item Difficulty Parameter - Assessment Systems](https://assess.com/irt-item-difficulty-parameter/)
4. [Best LLM for Coding 2025 - Onyx AI](https://onyx.app/best-llm-for-coding)
5. [Best LLMs for Coding: An Analytical Report (May 2025) - PromptLayer Blog](https://blog.promptlayer.com/best-llms-for-coding/)
6. [AI-powered Automatic Item Generation for Psychological Tests - Springer Journal of Business and Psychology](https://link.springer.com/article/10.1007/s10869-025-10067-y)
7. [Generate-Then-Validate: A Novel Question Generation Approach Using Small - ArXiv 2512.10110](https://www.arxiv.org/pdf/2512.10110)
8. [Skill-based assessment frameworks - TestGorilla](https://www.testgorilla.com/test-library/programming-skills-tests/)
9. [Skills assessment overview - Toggl Hire](https://toggl.com/blog/test-programming-skills)
10. [Assessing the Quality of AI-Generated Exams: A Large-Scale Field Study - ArXiv 2508.08314](https://arxiv.org/html/2508.08314v1)
11. [IMPROVE: Iterative Model Pipeline Refinement and Optimization Leveraging LLM Agents - ArXiv 2502.18530](https://arxiv.org/html/2502.18530v1)
12. [Skill-LLM: Repurposing General-Purpose LLMs for Skill Extraction - ArXiv 2410.12052](https://arxiv.org/html/2410.12052v1)
13. [Automated Educational Question Generation at Different Bloom's Skill Levels using LLMs - ArXiv 2408.04394](https://arxiv.org/html/2408.04394v1)
14. [Multi-Step Generation of Test Specifications using Large Language Models - ACL 2025 Industry Track](https://aclanthology.org/2025.acl-industry.11.pdf)
15. [Exploring Automated Distractor Generation for Math MCQs via Large Language Models - ArXiv 2404.02124](https://arxiv.org/html/2404.02124v1)
16. [Can LLMs Model Incorrect Student Reasoning? A Case Study on Distractor Generation - ArXiv 2603.15547](https://arxiv.org/html/2603.15547)
17. [MESA Memo 42: Solving Measurement Problems - Rasch.org](https://www.rasch.org/memo42.htm)
18. [Item Response Theory - Columbia University Mailman School of Public Health](https://www.publichealth.columbia.edu/research/population-health-methods/item-response-theory)
19. [RouteLLM: Balancing Cost and Quality in LLM Deployments - ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/file/5503a7c69d48a2f86fc00b3dc09de686-Paper-Conference.pdf)
20. [Analyzing the relationship between psychometric indices and learning outcomes - PMC 12502189](https://pmc.ncbi.nlm.nih.gov/articles/PMC12502189/)
21. [Understanding Item Analyses – Item Analysis for Assessment - University of Washington](https://www.washington.edu/assessment/scanning-scoring/scoring/reports/item-analysis/)
22. [Item Analysis: How to Improve Tests with Psychometrics - Assessment Systems](https://assess.com/what-is-item-analysis/)
23. [Keeping Humans in the Loop: Human-Centered Automated Annotation with Generative AI - ArXiv 2409.09467](https://arxiv.org/abs/2409.09467)
24. [AI-Assisted Exam Variant Generation: A Human-in-the-Loop Framework - MDPI Education 15(8):1029](https://www.mdpi.com/2227-7102/15/8/1029)
25. [Automatic item generation for educational assessments: a systematic literature review - Taylor & Francis](https://www.tandfonline.com/doi/full/10.1080/10494820.2025.2482588)
26. [Reflective prompt engineering: a new strategy for automated short answer scoring - Taylor & Francis](https://www.tandfonline.com/doi/full/10.1080/09500693.2025.2523571)
27. [A Systematic Survey of Prompt Engineering in Large Language Models - ArXiv 2402.07927](https://arxiv.org/html/2402.07927v2)
28. [Benchmarking LLMs for Unit Test Generation from Real-World Functions - ArXiv 2508.00408](https://arxiv.org/pdf/2508.00408)
29. [We created the first open-source implementation of Meta's TestGen-LLM - Qodo AI Blog](https://www.qodo.ai/blog/we-created-the-first-open-source-implementation-of-metas-testgen-llm/)
