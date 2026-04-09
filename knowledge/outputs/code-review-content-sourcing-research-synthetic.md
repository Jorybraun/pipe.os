> **STATUS: RESEARCH FILE (R2)** · Created 2026-04-08 08:53
> **Research run:** `code-review-content-sourcing` — Round 1
> **Researcher:** R2 — Synthetic / LLM-Generated PR Content + Bug Injection (BugPilot, BugFarm, SemSeed, SWE-Synth, AIG psychometrics)
> **Role in run:** Primary-source research on bug injection techniques, automatic item generation, execution-based ground truth
> **Use for:** Looking up source citations when the final brief cites `[R2-S<n>]`
> **Navigate:** [INDEX](../INDEX.md) · [final brief](./code-review-content-sourcing.md)

---

# R2: Synthetic & LLM-Generated Code Review Content

## Summary (5 bullets)

- **Mutation operators produce mostly trivial bugs.** Classic PIT/Major operators have well-documented realism problems: empirical studies show only moderate coupling to real defects and many mutants are either trivial or semantically equivalent. LLM-guided mutation (2024–2025) improves naturalness but requires human spot-checking.
- **Semantic bug-seeding methods (SemSeed, BugFarm, BugPilot) close the realism gap substantially.** BugPilot (Microsoft, 2025) uses SWE Agents attempting feature additions as an incidental bug source, producing multi-file, multi-location bugs qualitative studies rate as more human-like than mutation output.
- **LLM-generated PR benchmarks are maturing rapidly (2025–2026) but lean on LLM-as-judge.** Sphinx (Jan 2026), SWE-Synth (Apr 2025), and CodeReviewBench all use LLMs to synthesize PR scenarios. Validity evidence comes primarily from task-performance metrics and LLM-judge agreement, not independent human expert panels.
- **Automatic Item Generation (AIG) psychometrics gives PIPE a direct leakage-resistance playbook.** Parameterised item templates + large banks + adaptive delivery (Gierl & Haladyna 2012; Frontiers 2023; Caveon 2024) eliminate exposure effects while maintaining validity. 50–100 bug-type templates × 10 surface variants = 500–1000 unique challenge instances.
- **Skilled reviewers cannot reliably distinguish AI-generated code from human-written code in blind conditions.** The main detectable signal is quality-level differences (AI code has ~1.7x more issues per PR), not stylistic tells — a well-prompted, high-quality synthetic PR is unlikely to be "obviously fake" to a candidate.

---

## Evidence table

| Technique | Realism | Scalability | Leakage resistance | Validity evidence | Source |
|---|---|---|---|---|---|
| Classical mutation (PIT, Major) | Low-moderate: ~40-60% coupling to real bugs; many trivial/equivalent mutants | Very high: fully automated | Low: fixed operator set, memorisable patterns | Empirical coupling studies | [S1][S2] |
| LLM-guided mutation | Moderate-high: better naturalness, fewer syntactically invalid outputs | High: prompt-driven | Moderate: per-run variation natural | LLM benchmark evals | [S3] |
| SemSeed (learned semantic seeding) | High: outperforms syntactic seeding on real-bug reproduction | Moderate: needs per-language training | Moderate: pattern space bounded by corpus | ESEC/FSE 2021 JS evaluation | [S4] |
| BugFarm / multi-location LLM injection | High: hard-to-detect, multi-site | High: LLM-driven | High: non-deterministic | 435k+ bugs evaluated vs prediction/repair tools | [S5] |
| BugPilot (SWE Agent feature-add method) | Very high: matches human bug patterns | High: agentic, parallel | High: random feature intent each run | SWE-Bench-Verified 52.4% Pass@1 | [S6] |
| SWE-Synth (LLM-synthesized bug-fix pairs) | High: verifiable via test execution | Very high: minimal human effort | High: fresh synthesis per run | +2.3% over real-data-trained model on SWE-Bench Lite | [S7] |
| Sphinx / LLM-generated PR scenarios | High within benchmark domain | Very high | High: pseudo-solution synthesis | 40% higher checklist coverage vs GPT-4.1 | [S8] |
| Hybrid (real skeleton + planted synthetic bug) | Very high: real project context, controlled defect | Moderate: needs real PR corpus as base | High: parameterisable bug type/location | Used by CodeReviewBench (live PR feed + planted patterns) | [S9][S15] |
| AIG item templates (psychometrics) | Depends on template quality; validated by IRT | Very high | Very high: per-examinee fresh variant delivery | Gierl & Haladyna 2012; Frontiers 2023 meta-analysis | [S10][S11][S12] |
| LLM-based multi-agent AIG (2025) | Moderate-high: comparable to human on 3/4 axes | Very high | High | GPT-4 vs human author study | [S16] |

---

## Detailed findings

### Mutation testing

Classical mutation testing tools — PIT (Java), Major (Java), Mutmut (Python) — apply syntactic operators such as relational-operator replacement (`<` to `<=`), arithmetic-operator replacement, and boundary-value shifts. The research consensus is that these operators model some real bugs well but over-represent trivially detectable errors and under-represent semantic, multi-site, or design-level defects [S1].

An experimental evaluation of PIT's operator set found the seven default operators do not fully conform to the mutation testing literature's recommendations and that many generated mutants are equivalent to the original program — altering code text without changing observable behaviour [S2]. Equivalent mutants inflate difficulty without representing real bugs and are useless for assessment purposes.

The coupling effect — the theoretical basis that test suites killing simple mutants will also kill complex real bugs — is empirically supported for traditional software but remains largely unverified for deep learning systems. A 2025 empirical study (arXiv:2512.16741) found coupling rates are reasonable for DL systems but pre-training mutation operators do not uniformly match the real-fault distribution in DL-specific benchmarks [S3].

For PIPE's use case: classical mutation operators produce a baseline of easy-to-spot, single-location bugs useful as *distractor filler* in a multi-bug challenge but should not be the sole bug type for senior-engineer assessment. They also have poor leakage resistance because the operator space is small and published.

LLMs applied to mutation testing (arXiv:2406.09843, 2024) show that LLM-generated mutants score higher on naturalness ratings, are more syntactically valid, and cover a broader pattern space than rule-based operators. The tradeoff is cost and non-determinism [S3].

### Semantic bug synthesis

**SemSeed** (Patra & Pradel, ESEC/FSE 2021) [S4] uses fastText token embeddings to adapt real-world bug patterns to local code context, producing bugs that reproduce real JavaScript bugs with higher fidelity than syntactic seeding and introduce application-specific tokens that syntactic approaches cannot. Limitation: language-specific (JavaScript), requires per-language retraining, does not model multi-file or design-level defects.

**BugFarm** (arXiv:2310.02407) [S5] uses LLMs to generate hard-to-detect, multi-location bugs by injecting changes at the *least attended* positions in a neural model's attention map — specifically targeting the hard-to-detect axis. Evaluated on 435k+ synthetic bugs, BugFarm's bugs are substantially harder than classical mutation output.

**BugPilot** (Microsoft, arXiv:2510.19898, 2025) [S6] is the state-of-the-art for human-like realism. Rather than injecting bugs directly, it runs SWE Agents attempting feature additions to a codebase. The feature additions incidentally break tests, producing bugs that span multiple files, follow realistic developer patterns (confirmed by qualitative human-rating studies), and are more diverse than single-operator injection. An RL model trained on BugPilot output achieves 52.4% Pass@1 on SWE-Bench Verified — suggesting the generated bugs are genuinely representative of real-world difficulty.

**BugLab** (Microsoft Research, NeurIPS 2021) [S15] uses a GAN-style self-supervised approach. A bug selector and bug detector play a hide-and-seek game; the selector learns to inject realistic bugs (Variable Misuse, Argument Swapping, Wrong Operator, Wrong Literal) that are hard for the detector to find. BugLab outperforms baselines by up to 30% on PYPIBugs (2,374 real Python bugs). Its four supported bug types are narrow but extremely realistic within their scope.

### LLM-generated PRs for benchmarks

**SWE-Synth** (arXiv:2504.14757, April 2025) [S7] synthesises full repo-level bug-fix pairs using LLM agents simulating debugging workflows. Produces not just buggy/fixed code pairs but intermediate traces and test logs. Critically, models trained on SWE-Synth *outperform* models trained on real-world datasets by 2.3% on SWE-Bench Lite — strong evidence that synthetic data quality is no longer a bottleneck when grounded in real repositories.

**Sphinx** (arXiv:2601.04252, Jan 2026) [S8] introduces: (1) a structured data generation pipeline comparing pseudo-modified code against merged code; (2) a checklist-based evaluation benchmark with GPT-4o safety screening; (3) CRPO — an RL training paradigm using rule-based rewards. Models outperform GPT-4.1 by 40% on checklist coverage. Validity concern: ground truth is itself LLM-constructed — circularity partially addressed by inter-rater agreement checks.

**CodeReviewBench** (Martian, 2024) [S9] plants synthetic-but-realistic regressions based on real-world bug patterns across 5 languages with a continuous fresh-PR feed from GitHub, meaning tools cannot memorise the benchmarks. Each test case has human-verified golden comments and exact bug locations. This is the closest existing system to PIPE's target approach.

**Survey of Code Review Benchmarks** (arXiv:2602.13377, Feb 2026) [S17] analyses 99 papers across pre-LLM (58) and LLM era (41) benchmarks. Key finding: the field is shifting toward end-to-end generative peer review. Critical gap identified: most benchmarks lack dynamic runtime evaluation and rely on static snapshots. Future directions include "taxonomy-guided fine-grained assessment" — directly relevant to PIPE.

### Automatic Item Generation (psychometrics)

The AIG literature from educational measurement addresses exactly PIPE's problem: generating assessment items at scale without sacrificing validity or enabling memorisation.

**Gierl & Haladyna (2012)** [S10] established the foundational framework: cognitive models define required knowledge; item models (templates with parameterisable slots) instantiate families of structurally parallel but surface-distinct items. A single item model yields hundreds of psychometrically equivalent variants. Validity transfers from the model to the variants — validate the model once via IRT calibration, then generate at will.

**Frontiers meta-analysis (2023)** [S11] found: (a) AIG items are psychometrically comparable to human-authored items on difficulty and discrimination; (b) the main quality gap is in *distractor plausibility* — AIG tends to produce distractors that are too obviously wrong; (c) LLM-based AIG substantially closes this gap when prompted with expert-authored distractor examples.

**Caveon AIG Guide (2024)** [S12] — practitioner synthesis: AIG combined with Computerised Adaptive Testing (CAT) provides the strongest leakage resistance. When the item bank is large enough and delivery is adaptive, exposure rates drop below memorisation-effective thresholds. Even 50–100 distinct bug-type/location templates × 5–10 surface variants = 250–1000 unique challenge instances, more than enough to prevent meaningful leakage at interview scale.

**LLM-based Multi-Agent AIG (2025)** [S16] formalises a pipeline with stages: item generation → content review → linguistic evaluation → bias assessment → item revision. Multi-agent architecture enforces that no single model both generates and validates items — addressing circularity. GPT-4 items rated comparable to human-authored on 3 of 4 quality axes.

**AIG and test security** (Frontiers Education, 2022) [S18] shows that AIG's large item banks, combined with item-family coding, allow control of exposure at both item and construct level — even if a candidate has seen a variant, the underlying knowledge being assessed is not compromised.

### Hybrid approaches

The hybrid model — real project codebase as skeleton + synthetically planted bug as assessment target — is implicitly used by several systems:

**CodeReviewBench** [S9] plants synthetic regressions into real open-source PRs. Real context provides ecological validity; planted bug provides controlled ground truth. Strongest known validity argument for hybrid content.

**SWE-Bench Verified** [S19] is itself a hybrid of real issues and synthesised test harnesses, curated by 93 software developers. Demonstrates that human expert curation can verify solvability, specification clarity, and appropriate difficulty — directly applicable to PIPE's challenge QA process.

No paper was found directly comparing hybrid vs. pure-synthetic vs. pure-real across all three validity dimensions (realism, leakage resistance, measurement validity) in a single controlled experiment. (Inference: hybrid dominates on realism and measurement validity; pure-synthetic dominates on scalability and leakage resistance; choice depends on throughput requirements — this is a gap, not a finding.)

### Authenticity gap

**AI-generated code detection study** (arXiv:2411.04299, 2024) [S13]: all current automated detection tools perform poorly and fail to generalise beyond their training distribution. Human reviewers in analogous text-detection studies correctly identify AI-generated output ~68% of the time — and that figure falls for technically sophisticated content.

**CodeRabbit report (2025)** [S14]: across 470 PRs, AI-generated PRs produce ~1.7x more issues per PR than human-authored. The single largest difference is in *readability* (naming, local pattern adherence, clarity). This is a quality signal, not an inauthenticity signal. A well-prompted LLM generating high-quality, bug-containing code in a genuine codebase would not exhibit the quality deficit that makes current AI PRs detectable.

**Inference** (labelled as inference — no direct study found): For an explicit assessment context where candidates are told upfront they are reviewing a challenge PR, the question of "is this AI-generated?" is irrelevant. What matters is whether the planted bug is genuinely hard to find. The authenticity gap matters for deception-based use cases; for explicit assessment it is largely a non-issue. No study was found specifically examining candidate behaviour when they suspect synthetic content in a code review assessment.

---

## Recommendations for PIPE

1. **Adopt the hybrid approach as the primary content pipeline.** Use real open-source repositories (matched to the target role's tech stack) as skeletons. Plant bugs using BugPilot-style LLM-agent feature-add or BugFarm-style multi-location LLM injection, not classical mutation. Trade-off: requires a real codebase corpus maintained per language/domain.

2. **Use classical mutation operators only for distractor/noise bugs, not primary assessment targets.** Off-by-one and relational-operator flips are useful to fill a PR with plausible-looking minor issues that a good reviewer should deprioritise — but not the scoring bug. That risks the challenge being solvable by mechanical mutation-awareness rather than genuine code reasoning.

3. **Parameterise challenges using AIG item-model principles.** Define 10–20 bug-type templates (e.g., "wrong null guard in async handler", "off-by-one in pagination slice", "missing error propagation in Promise chain"). For each, generate 10–15 surface variants by varying identifiers, data types, and surrounding context. Validate the template once (expert panel or pilot cohort); validity transfers to variants.

4. **Generate per-candidate fresh variants to eliminate leakage.** No two candidates see the same code. Even if a candidate discusses the challenge afterwards, knowledge of the specific variable name or file structure gives no advantage to the next candidate. Co-generate failing tests alongside the bug (SWE-Synth pattern) so grading remains automated.

5. **Close the validation loop via execution-based ground truth, not LLM-judge.** A bug is "real" if a targeted failing test exists; a fix is "correct" if the test passes. Use this as PIPE's primary validity gate. LLM-judge agreement (~90% with human on SWR-Bench) is acceptable as a supplement for scoring partial responses but should not be the sole difficulty-estimation mechanism.

6. **Budget for a periodic human expert QA gate.** SWE-Bench required 93 developers to curate its verified subset. PIPE should plan for 5–10% random challenge spot-checks per quarter to catch distribution drift and maintain construct validity.

---

## Sources (numbered, with URLs)

[S1] PIT Mutation Testing documentation and Wikipedia overview. Vendor documentation / encyclopaedia.
- https://pitest.org/
- https://en.wikipedia.org/wiki/Mutation_testing

[S2] Andersson, M. (2018). "An Experimental Evaluation of PIT's Mutation Operators." Linköping University thesis.
- https://www.diva-portal.org/smash/get/diva2:1161760/FULLTEXT01.pdf

[S3] Multiple authors (2024). "A Comprehensive Study on Large Language Models for Mutation Testing." arXiv:2406.09843v3.
- https://arxiv.org/abs/2406.09843

[S4] Patra, J. & Pradel, M. (2021). "Semantic Bug Seeding: A Learning-Based Approach for Creating Realistic Bugs." ESEC/FSE 2021.
- https://dl.acm.org/doi/10.1145/3468264.3468623

[S5] Ibrahimzada, A. et al. (2023/2024). "Automated Bug Generation in the Era of Large Language Models (BugFarm)." arXiv:2310.02407.
- https://arxiv.org/abs/2310.02407

[S6] Microsoft Research (2025). "BugPilot: Complex Bug Generation for Efficient Learning of SWE Skills." arXiv:2510.19898.
- https://arxiv.org/abs/2510.19898

[S7] Pham, T. et al. (2025). "SWE-Synth: Synthesizing Verifiable Bug-Fix Data to Enable Large Language Models in Resolving Real-World Bugs." arXiv:2504.14757.
- https://arxiv.org/abs/2504.14757

[S8] (Authors TBC). "Sphinx: Benchmarking and Modeling for LLM-Driven Pull Request Review." arXiv:2601.04252, January 2026.
- https://arxiv.org/abs/2601.04252

[S9] Martian / CodeReviewBench (2024). "Code Review Benchmark."
- https://codereview.withmartian.com/
- https://github.com/withmartian/code-review-benchmark

[S10] Gierl, M. J. & Haladyna, T. M. (Eds.) (2012). *Automatic Item Generation: Theory and Practice.* Routledge.
- https://www.routledge.com/Automatic-Item-Generation-Theory-and-Practice/Gierl-Haladyna/p/book/9780415897518

[S11] Hommel, M. & Schumann, S. (2023). "Automatic item generation: foundations and machine learning-based approaches for assessments." *Frontiers in Education.*
- https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2023.858273/full

[S12] Caveon Test Security (2024). "Automated Item Generation (AIG): The Ultimate Guide."
- https://caveon.com/resource/ultimate-guide-automated-item-generation/

[S13] (Authors TBC). "An Empirical Study on Automatically Detecting AI-Generated Source Code: How Far Are We?" arXiv:2411.04299, November 2024.
- https://arxiv.org/abs/2411.04299

[S14] CodeRabbit (2025). "State of AI vs Human Code Generation Report." December 2025.
- https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report

[S15] Allamanis, M. et al. / Microsoft Research (2021). "Self-Supervised Bug Detection and Repair (BugLab)." NeurIPS 2021.
- https://github.com/microsoft/neurips21-self-supervised-bug-detection-and-repair
- https://www.microsoft.com/en-us/research/blog/finding-and-fixing-bugs-with-deep-learning/

[S16] Scherr, T. et al. (2025). "AI-powered Automatic Item Generation for Psychological Tests: A Conceptual Framework for an LLM-based Multi-Agent AIG System." *Journal of Business and Psychology.*
- https://link.springer.com/article/10.1007/s10869-025-10067-y

[S17] Khan, T. I. et al. (2026). "A Survey of Code Review Benchmarks and Evaluation Practices in Pre-LLM and LLM Era." arXiv:2602.13377, February 2026.
- https://arxiv.org/abs/2602.13377

[S18] Gierl, M. J. et al. (2022). "Using Content Coding and Automatic Item Generation to Improve Test Security." *Frontiers in Education.*
- https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2022.853578/full

[S19] OpenAI / SWE-bench team (2024). "Introducing SWE-bench Verified." August 2024.
- https://openai.com/index/introducing-swe-bench-verified/
- https://arxiv.org/abs/2310.06770
