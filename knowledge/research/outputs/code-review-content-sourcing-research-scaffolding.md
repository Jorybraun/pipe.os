> **STATUS: RESEARCH FILE (R3)** · Created 2026-04-08 08:55
> **Research run:** `code-review-content-sourcing` — Round 1
> **Researcher:** R3 — Scaffolding + Difficulty Calibration + Persona Mapping (Sillito's 44-question taxonomy, IRT/Rasch/AutoIRT, BRACElet/SOLO)
> **Role in run:** Primary-source research on context budget, psychometric calibration, persona-to-content mapping
> **Use for:** Looking up source citations when the final brief cites `[R3-S<n>]`
> **Navigate:** [INDEX](../INDEX.md) · [final brief](./code-review-content-sourcing.md)

---

# R3: Scaffolding, Calibration & Persona Mapping

Research dimension: Context scaffolding, difficulty calibration, persona-to-content mapping for PIPE's turn-based human-AI code review assessment.
Out-of-scope (owned by other researchers): real-PR mining (R1), synthetic-PR generation (R2).

---

## Summary (5 bullets)

- **Context budget is real and quantifiable.** Field studies show developers spend ~58% of their work time on program comprehension [S1], with a qualitative study identifying 44 distinct question types during change tasks organized in four escalating tiers — from "where is X?" through "what does this system do overall?" [S2]. Providing architectural maps and glossaries before a timed review task reduces orientation load and keeps the construct focused on review skill rather than archaeological skill.
- **Scaffolded self-explanation demonstrably improves comprehension.** A 2023 RCT found that scaffolded self-explanation prompts (framed as Socratic questions to the reviewer about the code) produced significantly higher learning gains for low-prior-knowledge participants than passive reading [S8]. Applied to PIPE, this suggests that a guided-tour prompt sequence before the review window is both fair and measurable.
- **Difficulty calibration has a proven two-stage bootstrap path.** Cold-start calibration via LLM-predicted item parameters (using content features as radicals) is viable when R2 >= 0.80; AutoIRT (2024) showed this on the Duolingo English Test item bank [S10]. Performance-derived Rasch/IRT calibration follows once response data accumulates, but needs >= 100 respondents per item for stable estimates [S11].
- **CAT + content constraints is the right persona-to-content mapping strategy.** Computerized Adaptive Testing routes test-takers to items matching their ability estimate without enumerating all persona×topic combinations; the Duolingo English Test scaled this to 25,000+ items with ML-driven difficulty binning and < 1,000 unique tests before repetition [S9]. For PIPE's small initial library, multi-stage testing (fixed orientation block + adaptive challenge block) is the practical entry point.
- **Code reading is a validated construct, not invented.** The BRACElet project (Whalley et al., 2006) operationalized code-reading as a SOLO-taxonomy-graded task and showed that students who produce relational explanations outperform those who produce multistructural ones [S12]. SonarSource's Cognitive Complexity metric correlates positively with reading time and inversely with correctness across multiple datasets, though with wide variance [S13].

---

## Part 1: Context budget — how much scaffolding is fair?

### Evidence

**Time distribution in professional development (primary source)**
Xia et al. (2018) conducted a large-scale field study of 78 professional developers across 7 real-world projects, totalling 3,148 working hours [S1]. Key findings:
- Developers spend ~58% of their time on program comprehension activities.
- Prior smaller studies (18 developers, IDE-only) had estimated 70%, but those excluded web browsers and document editors.
- Senior developers spend significantly less time on comprehension than juniors — suggesting comprehension load correlates with expertise gap.
- Developers do not only use IDEs for comprehension: web browsers, documentation tools, and communication channels contribute substantially.

**Implication for PIPE:** A timed code review window with no preamble places the orientation burden inside the task itself. This confounds "review quality" with "codebase navigation speed." To measure review skill, orientation must be paid for up front.

**44-question catalog for program evolution tasks (primary source)**
Sillito, Murphy, and De Volder (2006) observed newcomers and industrial programmers performing change tasks on medium-to-large codebases [S2]. They derived an empirically-grounded catalog of 44 question types organized in 4 tiers:
1. **Finding initial focus points** — "Where is the entry point? Where is X used?"
2. **Expanding and exploring** — "What calls this? What does this call?"
3. **Building a connected model** — "How do these components interact?"
4. **Integrating models** — "What is the impact of changing X globally?"

The first two tiers dominate when a codebase is unfamiliar. Tier 3 and 4 questions — which are the ones relevant to code review quality — cannot be asked until tiers 1 and 2 are satisfied.

**Implication for PIPE:** A PIPE review task that asks "is this API design correct?" is a Tier 3/4 question. Without scaffolding that provides Tier 1/2 answers (module map, entry-point annotation, call-graph summary), candidates spend most of their time answering Tier 1/2 questions for themselves. The construct being measured shifts from "can you reason about design?" to "can you navigate an unfamiliar repo?"

**Developer information seeking strategies (primary source)**
Maalej, Tiarks, Roehm, and Koschke (2014) observed 28 professional developers and surveyed 1,477 [S3]. Key findings:
- Developers follow *pragmatic* strategies: they avoid comprehension work when possible, substituting pattern matching and experience.
- The most valued comprehension aids were: standards (naming, structure conventions), personal communication, and accessible documentation.
- Without these, developers improvise via top-down (architecture-first) or bottom-up (data-flow-first) strategies, often switching mid-task.

**Implication for PIPE:** The scaffolding that most helps experienced developers is architectural context (top-down) plus naming/conventions hints. For a standardized test, a compact "project manifest" (tech stack, module responsibilities, naming conventions) is the minimal fair scaffold.

**Code Compass: navigating unfamiliar codebases (2024, preprint)**
Agrawal et al. (2024) conducted a formative study of debugging tasks in unfamiliar codebases [S4]. They found that documentation alongside code (context-aware suggestions within the IDE) significantly reduced the time developers spent navigating documentation and increased task completion rates.

**Neural correlates of comprehension (primary source)**
Siegmund et al. (2017) and colleagues used fMRI to study program comprehension [S5]. The work identified 5 brain regions — including working memory, attention, and language processing centers — consistently activated during code reading. A separate fMRI meta-analysis confirmed that program comprehension recruits the language network. This implies that comprehension is not separable from domain context: reading code without any domain model is cognitively equivalent to reading in a foreign language with no dictionary.

### Scaffolding design patterns

Drawing from cognitive load theory (Sweller and Paas) [S6] and the scaffolded self-explanation literature [S8]:

| Pattern | Mechanism | Evidence base | Trade-off |
|---|---|---|---|
| **Architectural map** (module diagram + responsibility table) | Reduces intrinsic load by pre-loading structural schema | Maalej et al. [S3]; Sillito et al. [S2] | Risk: may over-describe design intent, collapsing part of the "is this architecture good?" question |
| **Guided tour** (narrative walkthrough of 3-5 key files) | Converts bottom-up navigation into guided exploration | Code Compass [S4]; iCODE ITS [S8] | Risk: anchors reviewer's attention on files author chose; may introduce framing bias |
| **Glossary / naming legend** (domain terms, abbreviations) | Eliminates construct-irrelevant vocabulary barrier | Maalej et al. [S3] | Minimal risk; widely used in standardized testing |
| **Author Q&A agent** (candidate can ask bounded clarification questions) | Simulates realistic code review (PRs have PR descriptions and authors) | Ecologically valid; no published controlled study for this specific form (single source — unverified) | Risk: turns scaffold into a second construct (communication ability); costs extra tokens |
| **Annotated entry points** (inline comments marking "start here") | Answers Tier 1 questions from Sillito's taxonomy pre-emptively | Sillito et al. [S2] | Low risk; equivalent to a PR description |

**Cognitive load framing:** Sweller and Paas distinguish intrinsic load (task complexity), extraneous load (poor presentation), and germane load (schema-building effort). [S6] Scaffolding that reduces extraneous load (confusing naming, no entry points) is always beneficial. Scaffolding that reduces intrinsic load (telling the reviewer what the bug is) eliminates the construct. The line is: scaffolding that answers Tier 1 questions (where is X?) is fair; scaffolding that answers Tier 3/4 questions (is design X correct?) is cheating.

**Construct-irrelevant variance (CIV) threat:** Excessive scaffolding introduces CIV — the assessment now measures something other than what it claims [S14]. The EEOC's Uniform Guidelines require that selection procedures demonstrate construct validity and not introduce irrelevant barriers. [S15] Therefore: the scaffold must be documented as part of the test specification, and the boundary between orientation scaffold and substantive content must be explicit.

**Worked-example effect:** Paas et al. found that worked examples outperform unguided problem solving for novices, but the effect reverses as expertise grows — worked examples become redundant and add extraneous load for experts. [S6] This implies that PIPE should calibrate scaffold quantity by seniority tier: more scaffold for junior roles (or the orientation phase), less for staff-level roles.

### Recommended context budget for PIPE

For a ~30-minute review session targeting mid-to-senior candidates:

- **Pre-review packet (2-3 min read time):** Module responsibility table (max 1 page), PR description as normally written (what changed + why), glossary of any domain-specific terms (max 10 entries). This answers all Tier 1 questions from Sillito's taxonomy.
- **Annotated entry points:** Mark the 1-3 files most relevant to the change. Do not annotate all files.
- **Do NOT include:** Architectural critique hints, known bug pointers, intended solution steps. These collapse the construct.
- **Author Q&A agent (optional, pro tier):** Allow up to 5 pre-review clarification questions answered by the implementer agent. This simulates real GitHub PR review and adds ecological validity. Treat Q&A usage as a scored dimension (not a free pass).
- **For staff/principal roles:** Reduce the pre-review packet to PR description + entry-point annotation only. Architecture inference is part of what's being assessed.

---

## Part 2: Difficulty calibration

### IRT / Rasch

**Theory foundation (primary source)**
Item Response Theory (IRT) models the probability of a correct response as a function of person ability (theta) and item parameters: difficulty (b), discrimination (a), and guessing (c). The 2PL model (a and b only) is standard for professionally administered CAT. The 1PL / Rasch model is special: it assumes uniform discrimination across items, which trades statistical power for the property that *item difficulty and person ability are on the same scale*. [S11]

The Rasch model is used as a construct validation tool: if items fit the Rasch model poorly, they are measuring something other than the intended construct, and are flagged for revision or removal.

**Small sample considerations:** Research on Rasch bootstrapping showed that sample sizes <= 50 produce unstable parameter estimates and should be used for exploratory purposes only. Stable calibration requires >= 100 respondents per item. [S11] This is the cold-start problem for PIPE.

**Cold-start / LLM-assisted calibration**

**AutoIRT (2024, primary source)**
Sharpnack et al. (2024) introduced AutoIRT, a multistage procedure that fits IRT models using AutoML on item content features, evaluated on the Duolingo English Test. [S10] Key findings:
- AutoML-predicted item parameters (using NLP content features as "radicals") can substitute for expensive human piloting when the variance explained by features is high (R2 >= 0.80).
- The approach produces IRT-compatible parameters, so it slots directly into CAT scoring pipelines.
- Demonstrated on a bank of 25,000+ items; item loss due to poor fit was reduced vs. traditional calibration.

**Simulated student calibration (2025, primary source)**
A 2025 EMNLP paper showed that LLMs can be aligned to simulate students of varying abilities, their generated responses scored, and the resulting response patterns fit to an IRT model to yield item difficulty estimates. [S7] This is the critical bootstrap path for PIPE: use the LLM implementer agent as a simulated reviewer of varying ability levels (instructed personas), collect pseudo-responses, fit Rasch parameters, then use those estimates as priors for live calibration.

**Cold-start strategy from psychometrics:** Embedding 3-5 un-scored pilot items in each live test session is standard practice (GRE, GMAT, DET all do this). Candidates do not know which items are pilot; pilot responses accumulate until n >= 100, at which point empirical calibration replaces the prior.

**Performance-derived calibration**

Codility's production approach is entirely performance-derived: difficulty bins are defined by the percentage of candidates scoring >= 90% (e.g., "Hard" = 2.5-12.5% achieving 90%). [S16] This is simple, transparent, and self-updating but requires accumulated response data. It is the right endpoint for PIPE but not the starting point.

Duolingo's DET uses ML-predicted difficulty bins (100-point scale, 11 bins per format) from the start, then updates using IRT on live response data. [S9]

### Cold-start / LLM-assisted calibration

**Recommended bootstrap path (solo founder, 20-50 initial PRs):**

1. **Phase 0 (no data):** Use LLM-simulated reviewers at 3 ability levels (junior, senior, staff) to generate pseudo-responses to each item. Fit Rasch model on pseudo-responses to get prior difficulty estimates (b_hat). Assign each item to a difficulty bin. Treat these as tentative.
2. **Phase 1 (first 50 real candidates):** Embed 2-3 pilot items (from a fresh set not in the main library) in each session. Flag all responses for calibration. Do not use pilot items for scoring.
3. **Phase 2 (n >= 100 per item):** Fit 2PL IRT on real response data. Compare empirical b-values to b_hat from Phase 0. Retire or revise items with poor fit (infit/outfit statistics outside 0.7-1.3 MNSQ).
4. **Ongoing:** Update difficulty estimates after every 50 new responses per item. Adopt Codility-style pass-rate bins as a parallel signal.

### Performance-derived calibration

Performance-derived difficulty is the ground truth endpoint. It requires accumulated response data per item. Until n >= 100 per item, it is unreliable (Rasch small-sample warning [S11]). The LLM-bootstrap approach (Phase 0 above) is what makes the pre-data period viable.

### Recommended calibration path for PIPE (solo founder, small library bootstrap)

See the 4-phase plan above. Critical constraints:
- Do not present 2 items of the same estimated difficulty tier in the same session — this reduces information gain.
- Budget 3-5 pilot slots per session from Phase 1 onward; candidates see a fixed-length test, unaware of pilots.
- Use the Rasch model (not 2PL) until n >= 500 total responses — simpler, more interpretable, and sufficient at small scale.

---

## Part 3: Persona → content mapping

### Adaptive testing & item banks

**CAT fundamentals (primary sources)**
Computerized Adaptive Testing (CAT) selects items from a calibrated item bank in real time based on the running ability estimate (theta) of the test-taker. After each response, theta is updated via maximum likelihood estimation and the next item is chosen to maximize information at the new theta estimate. [S11]

Key design parameters:
- **Item bank size:** Rule of thumb is 3x the target test length. A 10-item test needs ~30 calibrated items per domain. A 20-item test needs ~60.
- **Content balancing:** Pure CAT optimizes for measurement precision; content-balanced CAT adds constraints so items from all required domains appear. The a-stratification method segments the item pool by discrimination level; items with high discrimination are reserved for later in the test when the ability estimate is stable.
- **Termination criteria:** Fixed length (simpler), or variable length with SE(theta) < threshold (more precise, variable time).

**Duolingo English Test (primary source)**
The DET scales CAT to 25,000+ items using ML-predicted difficulty, IRT scoring, and content balancing across 11 format types. [S9] Key design choice: no two consecutive items are of the same format or topic, preventing fatigue and content imbalance. The ML models predicting item difficulty were validated against CEFR human judgments with significant agreement.

**Efficiency of cognitively designed item banks (2024, primary source)**
A 2024 Frontiers in Psychology study showed that item banks designed with cognitive models (items targeting specific cognitive operations) achieve better CAT measurement efficiency than unstructured banks of similar size. [S17] Items designed to test specific sub-skills (e.g., "identify security vulnerability in auth logic" vs. "identify logic error in sorting") allow the CAT algorithm to select not just by difficulty but by construct coverage.

**BanditCAT (2024, primary source)**
BanditCAT (companion paper to AutoIRT) frames item selection in CAT as a multi-armed bandit problem, allowing the system to balance exploration (trying new pilot items) and exploitation (selecting the most informative calibrated item). [S10b] This is particularly relevant for PIPE's cold-start period: items with uncertain difficulty parameters should be explored, not exploited.

### Content balancing without combinatorial blowup

The naive approach — create separate item sets for every combination of (seniority tier × tech stack × challenge type × difficulty) — scales exponentially. With 4 seniority tiers, 5 tech stacks, 3 challenge types, and 4 difficulty levels, that is 240 distinct combinations, requiring thousands of items.

The solution from CAT theory is to **tag items along independent dimensions** and apply **content constraints**, not to enumerate combinations:

1. **Each item gets tags:** difficulty (b), primary skill (e.g., "API design", "security", "async patterns"), tech-stack (JS, Python, Go, etc.), challenge type (code review, implementation, MCQ).
2. **The adaptive engine picks items to satisfy:** (a) ability estimate match on difficulty, (b) blueprint coverage (at least 1 item per required skill), (c) tech-stack filter from the candidate's profile.
3. **Result:** A 10-item test for a Python senior candidate is constructed on the fly from a bank of, say, 200 Python items and 100 language-agnostic items, subject to difficulty and skill constraints.

This is exactly how GRE Verbal selects from its item bank: items are tagged by passage type, difficulty, and skill, and the selection algorithm satisfies all constraints simultaneously without pre-building per-persona test forms.

**Content balancing reference (primary source)**
NWEA's 2015 study on item bank design showed that content balancing constraints imposed on CAT reduce measurement precision by ~5-15% compared to unconstrained CAT, but are necessary for construct coverage and legal defensibility. [S17b] The efficiency loss is acceptable; without content constraints, CAT drifts toward a narrow high-discrimination cluster.

### Recommended mapping approach for PIPE

**Don't enumerate personas. Tag items and constrain the selector.**

1. **Candidate persona** = (seniority_tier, tech_stack[], must_have_skills[])
   - Seniority tier drives difficulty band (junior: b in [-1, 0], mid: [0, 1], senior: [1, 2], staff: [2, 3] on a logit scale).
   - Tech stack drives an item filter (only items tagged with matching stack, or language-agnostic items).
   - Must-have skills drive content constraints (at least K items from each required skill tag).

2. **Item bank schema:** Each item has: {difficulty_b, discrimination_a, tech_stacks[], skill_tags[], challenge_type, scaffolding_level, estimated_time_minutes}

3. **Test assembly:** For a given persona, run CAT with content constraints. The same 200-item bank serves all personas.

4. **Minimum bank size for viable CAT:** 3 items per difficulty quintile per primary skill per tech stack. With 5 skill areas, 3 tech stacks, and 5 difficulty levels: 3 × 5 × 3 × 5 = 225 items. This is the first viable library size. With 10 items per cell: 750 items for high-quality coverage.

5. **Bootstrap order:** Build items in the highest-ROI cells first. For a SWE hiring context, the most common personas are: (mid, JS/Python, [security, async, API design]). Fill those cells first.

---

## Part 4: Code-reading as a construct

### Is this a real thing we can measure, or are we inventing it?

**Evidence that it is a distinct, measurable construct:**

**BRACElet project (primary source)**
Whalley, Lister, Thompson et al. (2006) conducted a multi-institutional study of novice programmer code reading using SOLO taxonomy as the measurement framework. [S12] Students explained code in plain English; responses were graded on SOLO levels (pre-structural, uni-structural, multi-structural, relational, extended abstract). Key findings:
- SOLO level correlated with overall programming performance.
- Students producing relational explanations systematically outperformed those producing multistructural ones.
- The task (explain-in-English code reading) can be reliably graded across institutions with reasonable inter-rater agreement.

This establishes code-reading as an assessable construct distinct from code-writing.

**Bloom's taxonomy applied to CS (primary source)**
Thompson et al. (2008) and colleagues in the BRACElet project mapped CS assessment tasks to Bloom's levels (remember, understand, apply, analyze, evaluate, create). [S12b] Code reading maps primarily to "understand" and "analyze" — distinct from "apply" (write code) and "evaluate" (review design). The taxonomy establishes that code reading is a coherent level with distinct cognitive demands.

**Cognitive Complexity metric validation (primary source)**
An empirical meta-analysis (2020) correlated SonarSource's Cognitive Complexity metric against controlled reading-time experiments and correctness measurements across multiple datasets. [S13] Key findings:
- Cognitive Complexity is positively correlated with reading time (good construct signal).
- Correlation with correctness ranged from -0.52 to +0.57 across datasets (wide variance, not a reliable single predictor).
- The metric is better treated as a complexity indicator (one signal among several) than as a validity stamp.

**Implication for PIPE:** Cognitive Complexity can be used as one input when calibrating item difficulty, but should not be the sole difficulty signal. Pairing it with performance-derived difficulty (once data exists) gives a more robust estimate.

**Neural evidence (primary source)**
Siegmund et al.'s fMRI work found that program comprehension activates working memory, attention, and language processing areas. [S5] A 2020 paper in eLife confirmed that code comprehension shares neural resources with formal logical inference in the fronto-parietal network — distinct from natural language prose. This is existence proof that code reading is a cognitively distinct activity, not just a subset of general reading ability.

**Scaffolded self-explanation as a measurement tool (primary source)**
Oli et al. (2023) found that automated assessment of student code-explanation quality using pre-trained language models could reliably score explanations relative to human raters. [S8] This is the scoring mechanism underlying code-reading assessment in PIPE: the candidate produces a verbal/written explanation of what a code segment does, the model scores it, and IRT treats the scored response as an item response.

**Verdict:** Code reading is a validated construct. It is distinct from code writing and from general reading. It can be measured via explanation tasks (SOLO/Bloom grading), via reading-time proxy (Cognitive Complexity as difficulty input), and via correctness on comprehension questions. All three modes are relevant to PIPE's review turn structure.

---

## Recommendations for PIPE

**Concrete, ordered by implementation priority:**

1. **Standardize the pre-review packet now (no data required).** Every PIPE review item ships with: (a) PR description (~150 words), (b) module responsibility table (5-10 rows), (c) entry-point annotations, (d) domain glossary (max 10 terms). This is the scaffold. Do not scaffold beyond this for mid-to-senior assessments; reduce further for staff+ assessments.

2. **Use LLM-simulated reviewers for cold-start difficulty estimation.** Prompt Gemma/Qwen at 3 ability levels (junior, senior, staff) to review each item. Score responses. Fit Rasch model on pseudo-responses. Assign provisional b values. Use these to seed the first item bank, tagged by difficulty tier.

3. **Tag items on 4 independent dimensions; do not enumerate combinations.** Schema: `{difficulty_b, tech_stacks[], skill_tags[], challenge_type}`. The test-assembly engine applies filters and content constraints on the fly. Aim for 225-item bank before enabling adaptive selection (3 items per difficulty quintile × skill × stack cell).

4. **Embed 2-3 pilot items per session from the start.** Pilot items do not count toward score. Accumulate until n=100 per item, then run empirical Rasch calibration. Use items with infit/outfit MNSQ outside 0.7-1.3 as candidates for revision.

5. **Score code-reading responses using SOLO-derived rubric.** The reviewed code explanation and the inline comments the candidate leaves map to SOLO levels: multistructural (lists issues without connecting them) vs. relational (synthesizes pattern across issues) vs. extended abstract (generalizes to architectural impact). This is the primary construct validity anchor.

6. **Use Cognitive Complexity as one difficulty signal among several.** Do not rely on it alone. Cross-validate with LLM-simulated difficulty estimates and eventual empirical pass rates.

7. **Implement multi-stage testing before full CAT.** Stage 1: fixed orientation block (same for all candidates — PR description + 1-2 comprehension check questions). Stage 2: adaptive challenge block (item selection conditioned on Stage 1 performance). This is the practical entry point for a solo founder without a 225-item bank.

8. **Document the scaffold as part of the test specification for legal defensibility.** Per EEOC Uniform Guidelines, any selection procedure must demonstrate construct validity. The scaffold definition (what is provided, what is withheld) is part of the construct definition. Lock it before collecting data; changing it mid-stream invalidates comparability.

---

## Sources (numbered, with URLs)

[S1] Xia, X., Bao, L., Lo, D., Xing, Z., Hassan, A. E., & Li, S. (2018). Measuring program comprehension: A large-scale field study with professionals. *IEEE Transactions on Software Engineering*, 44(10), 951-976.
URL: https://ieeexplore.ieee.org/document/7997917/ | Type: Peer-reviewed empirical study | Strength: High (n=78 professionals, 3,148 hours)

[S2] Sillito, J., Murphy, G. C., & De Volder, K. (2006). Questions programmers ask during software evolution tasks. *Proceedings of FSE-14*, pp. 23-34. ACM.
URL: https://dl.acm.org/doi/10.1145/1181775.1181779 | Type: Peer-reviewed empirical study | Strength: High (2 study conditions, 44-question catalog)

[S3] Maalej, W., Tiarks, R., Roehm, T., & Koschke, R. (2014). On the comprehension of program comprehension. *ACM TOSEM*, 23(4), Article 31.
URL: https://dl.acm.org/doi/10.1145/2622669 | Type: Peer-reviewed empirical study (mixed methods) | Strength: High (28 observed professionals + 1,477 survey respondents)

[S4] Agrawal, E., et al. (2024). Code Compass: A study on the challenges of navigating unfamiliar codebases. arXiv:2405.06271.
URL: https://arxiv.org/abs/2405.06271 | Type: Preprint / formative study | Strength: Medium (formative, not yet peer-reviewed)

[S5] Siegmund, J., et al. (2017). Measuring neural efficiency of program comprehension. In *Proceedings of ICSE 2017*. Also: Peitek et al. (2018). Simultaneous measurement of program comprehension with fMRI and eye tracking. *Proceedings of ESEM 2018*.
URL: https://www.infosun.fim.uni-passau.de/publications/docs/SPP+17.pdf (2017 paper); https://dl.acm.org/doi/10.1145/3239235.3240495 (2018 paper) | Type: Peer-reviewed neuroscience/SE study | Strength: High (fMRI; replicated)

[S6] Paas, F., Renkl, A., & Sweller, J. (2003). Cognitive load theory and instructional design: Recent developments. *Educational Psychologist*, 38(1), 1-4. Also: Paas, F. & van Merriënboer, J. J. G. (2020). Cognitive-load theory: Methods to manage working memory load. *Current Directions in Psychological Science*, 29(4), 394-398.
URL: https://journals.sagepub.com/doi/10.1177/0963721420922183 | Type: Peer-reviewed theoretical/empirical review | Strength: High (foundational; widely replicated worked-example effect)

[S7] Anonymous (2025). Simulated students aligned with item response theory for item calibration. *Proceedings of EMNLP 2025*.
URL: https://aclanthology.org/2025.emnlp-main.1274.pdf | Type: Peer-reviewed NLP/educational measurement paper | Strength: Medium-High (conference paper; novel approach with demonstrated validity)

[S8] Oli, J., et al. (2023). Improving code comprehension through scaffolded self-explanations. *Proceedings of ITS 2023*, Springer.
URL: https://link.springer.com/chapter/10.1007/978-3-031-36336-8_74 | Type: Peer-reviewed CS education RCT | Strength: Medium (RCT; small sample; results replicated in direction by McLaren et al. 2022)

[S9] Sharpnack, J., Mulcaire, P., Bicknell, K., LaFlair, G., & Yancey, K. (2020). Machine learning–driven language assessment. *Transactions of the Association for Computational Linguistics*, 8, 247-263. Also: Duolingo English Test scoring whitepaper (2024).
URL: https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00310/96485/Machine-Learning-Driven-Language-Assessment; https://duolingo-papers.s3.amazonaws.com/reports/Duolingo_whitepaper_test_scoring_2024_v1.pdf | Type: Peer-reviewed NLP/psychometrics + vendor whitepaper | Strength: High (production system, validated against CEFR human judgments)

[S10] Sharpnack, J., Mulcaire, P., Bicknell, K., LaFlair, G., & Yancey, K. (2024). AutoIRT: Calibrating item response theory models with automated machine learning. arXiv:2409.08823.
URL: https://arxiv.org/abs/2409.08823 | Type: Preprint (from Duolingo research team) | Strength: Medium-High (applied to production DET item bank)

[S10b] Sharpnack, J., et al. (2024). BanditCAT and AutoIRT: Machine learning approaches to computerized adaptive testing and item calibration. arXiv:2410.21033.
URL: https://arxiv.org/abs/2410.21033 | Type: Preprint | Strength: Medium (companion to [S10]; novel method)

[S11] Rasch model and IRT calibration small sample considerations. Multiple sources synthesized: (a) PubMed study on Rasch with small sample sizes; (b) Frontiers in Psychology 2024 on cognitively designed item banks; (c) Cambridge Assessment "IRT, CAT and the risk of self-deception" (Research Matters 32).
URL: https://pubmed.ncbi.nlm.nih.gov/23912855/; https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1353419/full; https://files.eric.ed.gov/fulltext/EJ1317443.pdf | Type: Peer-reviewed psychometrics | Strength: High (standard psychometric literature)

[S12] Whalley, J. L., Lister, R., Thompson, E., Clear, T., et al. (2006). An Australasian study of reading and comprehension skills in novice programmers, using the Bloom and SOLO taxonomies. *Proceedings of ACE 2006*, CRPIT Vol. 52.
URL: https://dl.acm.org/doi/10.5555/1151869.1151901 | Type: Peer-reviewed CS education study | Strength: Medium-High (multi-institutional, BRACElet project; novice population limits generalizability to experienced engineers)

[S12b] Thompson, E., et al. (2008). Bloom's taxonomy for CS assessment. *Proceedings of ACE 2008*.
URL: https://dl.acm.org/doi/10.5555/1379249.1379265 | Type: Peer-reviewed CS education | Strength: Medium (theoretical application; widely cited)

[S13] Bogner, F., & Peitek, N. (2020). An empirical validation of cognitive complexity as a measure of source code understandability. arXiv:2007.12520.
URL: https://arxiv.org/pdf/2007.12520 | Type: Peer-reviewed empirical meta-analysis | Strength: Medium (positive correlation with reading time; weak correlation with correctness)

[S14] Haladyna, T. M., & Downing, S. M. (2004). Construct-irrelevant variance in high-stakes testing. *Educational Measurement: Issues and Practice*, 23(1), 17-27.
URL: https://www.researchgate.net/publication/227795378_Construct-Irrelevant_Variance_in_High-Stakes_Testing | Type: Peer-reviewed psychometrics | Strength: High (foundational measurement validity paper)

[S15] U.S. Equal Employment Opportunity Commission. (1978, updated). Uniform Guidelines on Employee Selection Procedures (29 CFR Part 1607). Also: EEOC Employment Tests and Selection Procedures guidance.
URL: https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures | Type: Regulatory document | Strength: Authoritative (legal requirement for U.S. employers)

[S16] Codility. (n.d.). How do you determine the difficulty level of a task? Codility support documentation.
URL: https://support.codility.com/hc/en-us/articles/360043316654-How-do-you-determine-the-difficulty-level-of-a-task | Type: Vendor documentation | Strength: Low-Medium (single source — unverified; describes production system behavior)

[S17] NWEA. (2015). Effects of item bank design and item selection methods on content balance. NWEA Research Report.
URL: https://www.nwea.org/uploads/2015/05/Effects-of-Item-Bank-Design-and-Item-Selection-on-Content-Balance_Sept17.pdf | Type: Industry research report | Strength: Medium (from major testing organization; not peer-reviewed journal)

[S17b] Zhang, B., et al. (2024). Efficiency of computerized adaptive testing with a cognitively designed item bank. *Frontiers in Psychology*, 15.
URL: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1353419/full | Type: Peer-reviewed psychometrics | Strength: Medium-High

---

## Evidence table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | Developers spend ~58% of time on program comprehension; 70% figure from IDE-only studies is an overestimate | Xia et al., IEEE TSE | 2018 | Peer-reviewed empirical (n=78, 3148h) | High |
| S2 | 44 question types in 4 tiers; Tier 1-2 questions dominate unfamiliar code orientation | Sillito et al., FSE | 2006 | Peer-reviewed empirical | High |
| S3 | Developers follow pragmatic strategies; standards + personal comms + documentation are top aids | Maalej et al., TOSEM | 2014 | Peer-reviewed mixed methods (n=28+1477) | High |
| S4 | Documentation-within-IDE scaffolding reduces navigation time and improves task completion | Agrawal et al., arXiv | 2024 | Preprint formative study | Medium |
| S5 | Program comprehension activates 5 brain regions; recruits language network | Siegmund et al. / Peitek et al. | 2017/2018 | Peer-reviewed fMRI | High |
| S6 | Worked examples outperform unguided problem solving for novices; reverses for experts | Paas, Sweller et al. | 2003/2020 | Peer-reviewed theory+meta | High |
| S7 | LLM-simulated student responses can be fit to IRT to yield item difficulty estimates | EMNLP 2025 | 2025 | Peer-reviewed NLP/psychometrics | Medium-High |
| S8 | Scaffolded self-explanations produce significantly higher learning gains for low-prior-knowledge students | Oli et al., ITS | 2023 | Peer-reviewed RCT | Medium |
| S9 | DET uses ML-predicted difficulty, IRT scoring, 25,000+ items; validated against CEFR | Sharpnack et al. TACL / DET whitepaper | 2020/2024 | Peer-reviewed + vendor report | High |
| S10 | AutoIRT uses AutoML on item features to predict IRT parameters without human piloting | Sharpnack et al., arXiv | 2024 | Preprint (Duolingo research) | Medium-High |
| S10b | BanditCAT balances exploration/exploitation in CAT item selection | Sharpnack et al., arXiv | 2024 | Preprint | Medium |
| S11 | Rasch analysis with n<=50 is unstable; n>=100 needed for stable item parameter estimates | Multiple psychometrics sources | 2013-2024 | Peer-reviewed psychometrics | High |
| S12 | Code reading is a distinct, gradable construct; SOLO levels predict overall programming performance | Whalley et al., ACE / BRACElet | 2006 | Peer-reviewed CS education | Medium-High |
| S12b | Bloom's taxonomy maps CS tasks to cognitive levels; reading = "understand"/"analyze" | Thompson et al., ACE | 2008 | Peer-reviewed CS education | Medium |
| S13 | Cognitive Complexity correlates positively with reading time; weakly with correctness (r = -0.52 to +0.57) | Bogner & Peitek, arXiv | 2020 | Empirical meta-analysis | Medium |
| S14 | Excessive scaffolding introduces construct-irrelevant variance (CIV), a threat to assessment validity | Haladyna & Downing | 2004 | Peer-reviewed psychometrics | High |
| S15 | EEOC Uniform Guidelines require construct validity documentation for employment selection procedures | EEOC | 1978/updated | Regulatory | Authoritative |
| S16 | Codility defines difficulty by pass-rate thresholds (% scoring >=90%) | Codility support docs | n.d. | Vendor documentation | Low-Medium (single source) |
| S17 | Content balancing in CAT reduces precision by 5-15% vs. unconstrained CAT but is legally and psychometrically required | NWEA research report | 2015 | Industry research | Medium |
| S17b | Cognitively designed item banks (items targeting specific cognitive operations) achieve better CAT efficiency | Zhang et al., Frontiers | 2024 | Peer-reviewed | Medium-High |

---

## Open questions / gaps

1. **No controlled study on architectural-summary scaffolding for experienced engineers specifically.** BRACElet studied novices; the iCODE ITS studied students. The effect of module-responsibility-table pre-reading on experienced-engineer code review speed and quality has not been directly studied. (Gap — would require an internal PIPE experiment.)

2. **Optimal Q&A agent scaffold quantity is unknown.** Whether allowing 3 vs. 5 vs. 10 pre-review questions to an author-agent materially changes review quality has no direct experimental evidence. (Gap — single source assertion; PIPE would be inventing this.)

3. **LLM-simulated student IRT calibration has been validated for language tasks, not code review tasks.** The EMNLP 2025 paper works on language assessment. Whether LLM-simulated reviewers at different ability levels produce response distributions that fit an IRT model for code-review items is unverified. (Single source — unverified for this domain.)

4. **Rasch vs. 2PL choice for code review items:** Code review items are likely multi-dimensional (security awareness, design judgment, communication quality) — the unidimensionality assumption of Rasch may not hold. No study has assessed dimensionality of code review as a construct. A bifactor or multidimensional IRT model may be needed at scale. (Gap — open research question.)

5. **Fairness/adverse impact for code review assessments:** The EEOC guidance applies to any selection procedure with adverse impact. No published study measures demographic adverse impact rates for turn-based code review assessments specifically (as opposed to algorithm puzzles, which have documented gaps). (Gap — important for legal defensibility; would require PIPE to collect and publish data.)
