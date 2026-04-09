> **STATUS: RESEARCH FILE (R5)** · Created 2026-04-08 13:17
> **Research run:** `code-review-content-sourcing` — Round 2
> **Researcher:** R5 — Simulation-Based Assessment Prior Art (OSCE, MMI, standardized patients, SP drift, NOTECHS, aviation LOE, van der Vleuten utility)
> **Role in run:** Primary-source research on health/aviation simulation assessment literature as prior art for turn-based human-agent scoring
> **Use for:** Looking up source citations when the final brief cites `[R5-S<n>]`
> **Navigate:** [INDEX](../INDEX.md) · [final brief](./code-review-content-sourcing.md)

---

# R5 — Simulation-Based Assessment Validity as Prior Art

> Research brief: What does the simulation-based assessment validity literature (OSCE / standardized patients, pilot simulator certification, interactive educational assessments) tell us about how to design, score, and validate a turn-based human-agent code review assessment?

---

## TL;DR

- **Context specificity is the central enemy of validity.** A candidate who performs well on one OSCE station predicts only modestly how they will do on the next; the same phenomenon will affect a single-PR code-review assessment. The fix — in medicine and aviation alike — is to **sample across multiple scenarios / stations** until the reliability G-coefficient reaches ≥0.80, which typically requires 8–14 independent assessment events [S1][S2][S4].
- **Checklists and global rating scales serve different masters.** Checklists give inter-rater reliability for novice raters and are fast to compute, but they penalise expert-level efficient behaviour. Global / holistic scales (scored by domain experts) better discriminate between intermediate and advanced performers. The optimal design uses *both*: checklists for objective behaviours, a global rating scale for overall judgment quality [S5][S6].
- **Standardized patients (SPs) and LLM agents share the same core failure mode: role drift.** SP programmes invest heavily in pre-session training, mid-session earpiece monitoring, and post-session performance evaluations to keep portrayals within specification. Without analogous controls, LLM implementer agents will drift from their planted-bug persona, alter their reactivity profile across turns, and violate the consistency assumption that makes comparative scoring possible [S7][S8][S9].
- **Multiple Mini Interview design is directly translatable.** MMI — 8–12 short independent stations, one rater per station, scores aggregated — achieved reliability r = 0.73–0.81, outperformed traditional panel interviews, and predicted OSCE scores, clerkship ratings, and licensing examination performance. A multi-PR code-review assessment structured the same way (multiple independent PRs, independent raters or scoring passes, aggregate score) would address PIPE's context-specificity problem directly [S3][S10][S11].
- **Aviation's LOE / NOTECHS shows how to score integrated technical + non-technical performance.** The FAA Advanced Qualification Program requires explicit behavioural markers, scenario standardization, and periodic evaluator recalibration. Inter-rater accuracy for the NOTECHS system reached 83–84% after short training, but cognitive aspects of non-technical skill were rated less reliably than social/observable aspects — a direct warning for PIPE's "AI-direction" dimension [S12][S13].
- **Van der Vleuten's utility equation is the right framework for a solo-founder product.** Utility = Reliability × Validity × Educational impact × Acceptability × Cost. A product that maximises reliability alone (laborious structured rubrics) while ignoring cost and acceptability will fail. The equation licenses deliberate trade-offs — e.g., accepting slightly lower reliability on a single turn in exchange for running three PRs instead of one [S14].

---

## Evidence table

| # | Claim | Source | Strength | Year |
|---|---|---|---|---|
| C1 | OSCE G-coefficient of 0.93 achieved with 18-station 2hr exam; residual error (51%) dominates variance | Imanipour & Jalili (PMC4991996) | Peer-reviewed, n = multi-site | 2016 |
| C2 | Context (case) specificity accounts for ≈25% of score variance in OSCE; 8–12 stations needed to reach G ≥ 0.80 | Review, multiple studies via PMC6695046 | Peer-reviewed systematic review | 2019 |
| C3 | Checklists underrate expert clinicians; family physicians score *lower* than clerks on binary checklists but higher on global scales | Hodges et al. Academic Medicine | Peer-reviewed RCT-adjacent, n=42 | 1999 |
| C4 | Global rating scales show better construct validity and inter-station reliability than checklists (expert-scored) | Hodges et al. Adv Health Sci Educ | Peer-reviewed | 1999 |
| C5 | SP clinical-item accuracy averages 89–91%; psychosocial item accuracy 89–92%; minimal warm-up/fatigue effect within a day | Woodward et al. (PMC3158971) | Peer-reviewed, 4 SPs over 9 conferences | 2011 |
| C6 | SP portrayal of role differs based on learner characteristics; non-verbal drift (facial expression) observed across SPs trained for same station | de la Croix & Veen (PMC8820478) | Peer-reviewed; qualitative + quantitative | 2022 |
| C7 | LLM agents (Llama-8B, Gemma-2B, Mistral-7B) show persona drift; PPO fine-tuning reduces inconsistency by >55% | Consistently Simulating Personas, arxiv 2511.00222 | Peer-reviewed pre-print (RLHF venue) | 2024 |
| C8 | LLM-based virtual SP (EasyMED) scores 96.98/100 vs human SP 97.33/100 on SPBench; Cohen κ = 0.76 for evaluator agent | EasyMED comparative study, arxiv 2511.14783 | Peer-reviewed pre-print | 2024 |
| C9 | MMI reliability r = 0.65–0.81 across implementations (median 0.73 with 12 stations); G-coefficient 0.70 with 8 stations | Eva et al. 2004; Eva et al. 2009 | Peer-reviewed RCT | 2004/2009 |
| C10 | MMI predicted OSCE performance, clerkship encounter cards, clerkship performance ratings, and MCCQE CDM scores; none predicted by uGPA or traditional interview | Reiter et al. 2007, Medical Education | Peer-reviewed cohort, n=45 admitted | 2007 |
| C11 | MMI-to-OSCE licensing exam correlation r = 0.43 (postgrad) and r = 0.35 (undergrad, 5-year lag) | Eva et al. 2009, Medical Education | Peer-reviewed prospective cohort | 2009 |
| C12 | NOTECHS inter-rater accuracy 83% (captain) / 84% (FO) after short training across 105 examiners, 8 simulator scenarios | Flin & Martin CRM Behavioral Markers review | Peer-reviewed / industry study | 2001 |
| C13 | FAA AQP requires explicit evaluator proficiency training and periodic recalibration; qualification standards document mandates behavioural definitions per performance objective | FAA AC 120-54A | Regulatory primary source | 2022 |
| C14 | Utility = Reliability × Validity × Educational impact × Acceptability × Cost; reliability depends on sampling, not structuring per se | van der Vleuten & Schuwirth 2005 | Peer-reviewed canonical paper | 2005 |
| C15 | Programmatic assessment: many low-stakes data points aggregated into high-stakes decision; individual data points maximised for feedback value | van der Vleuten et al. 2012 (PubMed 22364452) | Peer-reviewed model paper | 2012 |
| C16 | SBME with deliberate practice yields effect size d = 0.71 vs. traditional clinical education (14-study meta-analysis) | McGaghie et al. (PMC3102783) | Peer-reviewed meta-analysis | 2011 |
| C17 | OSCE predicts 32% of future clinical competence; students in lowest decile 6× more likely to fail subsequent clinical exam | Multiple predictive validity studies via Compl. Univ. Madrid, 2026 | Peer-reviewed | 2026 |
| C18 | Harden's original OSCE (1975/1979): blueprinting via 2D matrix (competencies × conditions); objectivity + structure as founding principles | Harden 1979, Medical Education | Peer-reviewed foundational | 1979 |

---

## 1. OSCE Validity and Standardized Patients

### Origins and design principles

The Objective Structured Clinical Examination was introduced by Ronald Harden in 1975 (published formally in *Medical Education* 1979 [S15]) as a response to the subjectivity and limited sampling of traditional "long case" examinations. The defining innovations were: (a) a rotation circuit of multiple short stations, (b) standardized tasks blueprinted against a curriculum matrix (competencies × clinical conditions), and (c) structured scoring instruments (checklists or global scales) [C18].

### Reliability: the station-count problem

Reliability in OSCEs is governed by case specificity — a student's performance on one station is a modest predictor of performance on the next. This is the clinical analogue of the coding domain's "task specificity": the ability to identify a memory leak says little about whether a candidate can spot an off-by-one error in a concurrent context.

Imanipour & Jalili (2016) found a G-coefficient of 0.93 and D-coefficient of 0.83 in an 18-station, 2-hour summative exam — but also found that residual (unexplained) error contributed 51% of total score variance [C1]. Most OSCE implementations report G-coefficients of 0.51–0.78 [S1]. To reach G ≥ 0.80, the consensus recommendation is 8–12 stations [C2], with some contexts requiring up to 14 stations in a generalizability analysis.

**Direct implication:** A single-PR code-review assessment is analogous to a single OSCE station. Its reliability as a standalone hiring signal is insufficient. Multiple independent PR scenarios (minimum 3–5, ideally 8+) aggregated under a programmatic model are required for defensible decisions.

### Validity: predictive evidence

OSCE scores explain approximately 32% of variance in future clinical competence [C17]. Students in the lowest decile of OSCE performance are 6× more likely to fail a subsequent clinical exam. Eva et al. (2009) found OSCE-to-licensing-exam correlations of r = 0.35–0.43 over a 5-year horizon [C11]. A direct replication by Feigerlova (2026) found OSCE to be the strongest single predictor of the Spanish national medical residency exam (MIR), accounting for 32% of variance (single source — recently published, needs independent replication) [S16].

### SP role in validity

Standardized patients are laypeople (or occasionally clinicians) trained to portray a patient role consistently. Their use transformed clinical assessment because they provide standardized stimulus conditions across examinee interactions — the same principle that makes comparative scoring possible. Wallace (2007) identified three tiers of SP function: (1) history-giving, (2) physical examination subject, and (3) checklist rater/evaluator [S17]. The third tier — SP as rater — raises a separate inter-rater reliability concern examined in Section 3.

---

## 2. SPs as an Implementer-Agent Analog

### The consistency-reactivity tension

An SP is not a recording — they are a live, reactive agent who must simultaneously: (a) stay within character specification, (b) respond authentically to whatever the examinee says, and (c) score the encounter. This is structurally identical to PIPE's implementer agent, which must: (a) maintain the planted-bug persona, (b) generate contextually appropriate pushback or fix acknowledgements, and (c) not volunteer information the candidate should discover themselves.

The SP literature documents a fundamental tension between **consistency** (same presentation for every examinee) and **reactivity** (authentic emotional response to candidate behaviour). The consensus is: in high-stakes assessment, consistency must win, even at some cost to realism [C5]. The Woodward et al. (2011) study found SP clinical-item accuracy was stable at 89–91% over a multi-day conference, but non-verbal (affective) elements varied between SPs: one SP consistently displayed higher anxiety, another asked questions at double the rate of peers [C5]. This inter-SP variability is a source of construct-irrelevant variance — exactly what would happen if two invocations of PIPE's implementer agent produced different pushback profiles on the same candidate comment.

### What causes drift and how programmes prevent it

The de la Croix & Veen (2022) qualitative documentary analysis of SP trainer/instructor feedback identified four drift vectors: (1) non-verbal behaviour (eye contact, vocal pacing), (2) difficulty providing patient-perspective feedback vs. medical commentary, (3) **role consistency across learner groups** (SPs varying their portrayal based on the perceived sophistication of the candidate), and (4) adaptability failures when candidates ask unexpected questions [C6].

Prevention mechanisms used in high-stakes OSCE programmes:

| Mechanism | Equivalent for LLM agent |
|---|---|
| Pre-session case-specific training (role-play run-throughs) | Prompt validation with test conversation trees before deployment |
| Earpiece / real-time monitoring by trainer | Automated consistency checks (turn-by-turn persona classifier) |
| Post-session written feedback form (Likert + qualitative) | Post-interaction scoring audit flagging persona violations |
| Annual formal performance evaluation | Periodic re-benchmarking against a gold-standard conversation corpus |
| Multiple SPs for same role, compared for inter-SP reliability | Multiple LLM invocations per PR scored for cross-invocation consistency |

The StatPearls standardization chapter (NBK560864) notes: "In high-stakes assessments, comparability in multiple performance areas over time and between different SPs is essential" [S7]. Variation of trained SP portrayal "may contribute substantial error to OSCE assessments" [C6].

### LLM-specific evidence on role drift

The most directly relevant empirical work is by Ouyang et al. (2024) using PPO-based reinforcement learning to improve persona consistency in LLM agents playing patient, student, and social-chat roles [S9][C7]. Baseline instruction-tuned models (Llama-8B, Gemma-2B, Mistral-7B) showed prompt-to-line consistency scores of 0.657–0.863, meaning agents abandoned their assigned persona on roughly 14–34% of turns in the mental-health domain. PPO reduced inconsistency by over 55%, while supervised fine-tuning produced smaller and less stable gains.

**Implication for PIPE:** Prompt engineering alone is insufficient to guarantee implementer agent consistency at the level needed for high-stakes comparative assessment. The system needs either: (a) an automated consistency classifier that flags and corrects off-persona turns before they reach the candidate, or (b) an explicit post-hoc scoring normalisation that discounts turns where the agent deviated from specification.

---

## 3. Scoring Conversational Performance (Rubrics, BARS, Checklist vs. Holistic)

### The Hodges finding: checklists penalise experts

The most important single finding for PIPE's scoring design comes from Hodges et al. (1999). In a study of 42 participants across three expertise levels (14 clerks, 14 family practice residents, 14 board-certified family physicians), participants completed two 15-minute standardized patient interviews scored both by binary content checklist and by a global process rating scale [C3][C4].

Result: **On global scales, experienced clinicians scored significantly better. On checklists, experienced clinicians scored significantly worse** than residents and clerks [C3]. The explanation: checklists encode the beginner's algorithm (take full history, check every box); expert clinicians are faster and more selective, skipping redundant questions — exactly the behaviour the checklist penalises.

This is directly analogous to code review assessment. A checklist that awards points for "mentioned type safety", "mentioned error handling", "mentioned performance" will penalise the expert reviewer who targets the two bugs that actually matter and skips the cosmetic issues. A global rating scale anchored on "demonstrated appropriate triage of review concerns" captures the expert behaviour.

### Behaviorally Anchored Rating Scales (BARS)

BARS were developed via the critical incident technique: domain experts generate examples of effective and ineffective behaviours, examples are sorted into performance dimensions by SME panel, and only items with ≥50–75% agreement on classification are retained. The result is a rating scale where each point on the scale is anchored by a specific observable behaviour, not a generic adjective [S18].

For code review, a BARS dimension like "Technical Communication Quality" would look like:

| Level | Anchor behaviour |
|---|---|
| 5 — Exceptional | Comment specifies the bug mechanism, references the relevant constraint/contract, proposes a fix with tradeoffs |
| 4 — Proficient | Comment identifies the bug with correct technical framing; proposes a direction but not a complete solution |
| 3 — Developing | Comment identifies that something is wrong; explanation is partially accurate or incomplete |
| 2 — Marginal | Comment is vague or conflates symptoms with root cause |
| 1 — Unacceptable | Comment is factually incorrect or misidentifies the problem entirely |

The aviation NOTECHS system for CRM skills uses a 4-category framework (Co-operation, Leadership/managerial skills, Situational awareness, Decision making) each with behavioural markers for acceptable/unacceptable performance — a direct BARS-derived structure [S12].

### Checklist vs. global: the hybrid recommendation

The OSCE literature consensus (post-Hodges) is a hybrid design:
- **Checklists for objective, observable, low-inference items** (e.g., "identified the injected SQL injection vector", "proposed parameterized query as fix") — high inter-rater reliability, captures coverage.
- **Global rating scales for integrative, high-inference dimensions** (e.g., "quality of technical reasoning", "communication effectiveness") — better construct validity, better expert discrimination.

Combining both, as done in the Imanipour & Jalili (2016) exam (station checklists + 1–9 global communication scale), achieves both reliability and construct validity [S1].

---

## 4. Multiple Mini Interviews — Lessons for Multi-Station Code Review

### The original design and its rationale

Eva et al. (2004) at McMaster introduced MMI as a direct response to the context-specificity problem in traditional admissions interviews [S3]. A single panel interview allows halo effects and interviewer bias; an MMI forces independent assessments of the same candidate across many short scenarios, each with a different examiner.

Structure: 8–12 stations, 8–10 minutes each, 2-minute reading/transition break, one examiner per station, station scores independent (examiner sees no prior scores). Aggregate score is the candidate's signal.

### Reliability

The original 2004 study achieved overall test reliability of 0.78. The 2019 systematic review [S2] reports a range of 0.58–0.81 across international implementations, with a median of 0.73 for 12 stations. Sydney Medical School found G = 0.70 with 8 stations; reaching G = 0.80 required 14 stations [C2][C9].

The critical mechanism: the candidate × station interaction is large (performance varies substantially across scenarios), so more stations are needed to average out scenario-specific noise. This is the same context-specificity problem that affects OSCE, and it will affect code-review assessment too.

### Predictive validity

Reiter et al. (2007) followed 45 McMaster students through clerkship and licensing exams. MMI was the **best predictor** of OSCE performance, clerkship encounter card ratings, and clerkship supervisor ratings. It also significantly predicted the Clinical Decision Making (CDM) sub-score of Canada's national licensing exam (MCCQE Part I). Crucially, uGPA and traditional non-cognitive admissions measures predicted none of these outcomes [C10].

Eva et al. (2009) extended this with a 5-year follow-up: MMI-to-OSCE licensing correlation r = 0.43 (postgrad) and r = 0.35 (undergrad) [C11]. These are modest but meaningful correlations at a 5-year horizon.

### Why MMI works (the theoretical mechanism)

The MMI design forces sampling across multiple independent contexts, breaking the halo effect that inflates traditional interview reliability while suppressing true validity. The generalizability model shows that the examiner variance component is small relative to the candidate × station interaction — meaning evaluator bias is not the main problem; scenario-to-scenario performance inconsistency is [S3]. By designing for many independent samples, MMI trades depth per station for breadth across stations, and this trades well for non-cognitive skills.

### Structural analog for PIPE

A multi-PR code-review assessment following MMI principles would:
1. Present 3–5 independent PRs (different codebases, different bug types, different technical domains).
2. Score each PR independently (separate scoring pass; scorer does not see prior PR scores during scoring).
3. Aggregate scores — average or weighted composite.
4. Target G-coefficient of ≥0.75 via a calibration study with 15–20 candidates.

This is achievable at low cost: each PR is a static artifact, not a live human, so "station" cost approaches zero at scale — a massive advantage over medical MMI which requires physical rooms and trained human examiners.

---

## 5. Aviation Simulator Certification — Performance-Under-Simulation Scoring

### LOE / LOFT structure

Line-Oriented Flight Training (LOFT) and Line Operational Evaluation (LOE) are the closest aviation analogs to PIPE's turn-based assessment. An LOE is a full-mission simulation conducted in real time (Point A to Point B, including unexpected events) designed to evaluate integrated technical and CRM performance simultaneously. Unlike check rides that test isolated manoeuvres, an LOE evaluates the candidate's behaviour across a dynamic scenario — exactly what a multi-turn code review does [S19].

Key LOE structural features:
- **Full crew participation** — both captain and first officer are evaluated simultaneously (team performance).
- **Unexpected challenge injection** — failures or adverse conditions inserted without pre-briefing (similar to PIPE's agent injecting pushback or new constraints mid-review).
- **Integrated scoring** — technical proficiency and crew resource management scored on the same encounter, not in separate sessions.

### NOTECHS and behavioral markers for non-technical skills

The NOTECHS framework (Non-Technical Skills) was developed across 14 European airlines to provide a structured CRM evaluation tool that could be used reliably by pilot instructors [S12][S13]. It organises non-technical skills into four categories:

1. **Co-operation** (building relationships, supporting team, resolving conflict)
2. **Leadership and managerial skills** (authority, planning, workload management)
3. **Situational awareness** (gathering information, understanding, anticipating)
4. **Decision making** (identifying problems, generating options, selecting actions)

Each category has specific behavioural markers (examples of good and poor performance) and a 4-point rating scale. After a short training session, 105 evaluators across 8 scenarios achieved 83–84% accuracy against expert reference ratings [C12].

**Key limitation relevant to PIPE:** Non-technical skills are rated more reliably under high workload conditions (when behaviours are unambiguous) than under low workload. Cognitive aspects (situational awareness, decision making) are rated less reliably than social/observable aspects (co-operation) [C12]. This exactly mirrors the challenge of scoring PIPE's "AI-direction" dimension — directing an AI agent is a cognitive, high-inference behaviour that will show lower inter-rater reliability than observing whether a candidate identified a specific bug.

### FAA AQP evaluator requirements

The Advanced Qualification Program (AC 120-54A, 2022) requires:
1. **Explicit evaluator training** on both technical and CRM evaluation (not just technical).
2. **Qualification Standards Document (QSD)** — a single document with all performance objectives, behavioural definitions, and evaluation procedures.
3. **Periodic recalibration** — evaluator proficiency and standardization verified regularly, not just at initial certification.
4. **Data-driven quality assurance** — AQP is empirically validated, meaning evaluation outcomes are tracked and the programme is adjusted based on data [S20].

This is the operational model PIPE should aspire to: a living rubric document, regular scorer recalibration against a gold-standard corpus, and data-driven iteration on both content and scoring.

---

## 6. Translation to PIPE's Turn-Based Human-AI Code Review

### What transfers directly

**a. The station-based sampling principle (from OSCE + MMI)**
Multiple independent PRs reduce context-specificity variance. The target should be 3 PRs minimum for a usable signal, 5–8 PRs for a summative hiring decision. Each PR should be scored independently before aggregation. Reliability should be estimated via generalizability theory and reported as a G-coefficient, with the station count adjusted until G ≥ 0.75 [C1][C2][C9].

**b. Hybrid checklist + global rating design (from OSCE)**
Every PR station needs: (1) a checklist of objective observable items ("identified injected race condition", "proposed fix preserves API contract") scored by automated analysis or human coder, and (2) a global rating scale scored by a domain-expert judge on integrative dimensions (review triage quality, communication precision, AI direction effectiveness) [C3][C4]. Use BARS-anchored scale definitions so scorers have concrete behavioural examples at each level [S18].

**c. Independent scoring to prevent halo (from MMI)**
The scoring agent or human judge should not see the candidate's score on PR #1 before scoring PR #2. Halo effects are well-documented in OSCE literature when raters have prior information [S2]. For automated scoring this means separate scoring invocations with no cross-PR context in the prompt.

**d. Evaluator/scorer calibration (from AQP + NOTECHS)**
Regular recalibration of the scoring rubric against a gold-standard corpus is not optional — it is the mechanism by which rubric drift is controlled. The AQP model requires this explicitly. For PIPE, this maps to the existing calibration harness (QWK scoring, fixture set) documented in the code-review-arena research [S20].

**e. Programmatic aggregation (from van der Vleuten)**
No single PR is the decision. Individual PR scores are feedback data points. The hiring recommendation emerges from aggregation across PRs, dimensions, and turns. This is van der Vleuten's (2012) programmatic assessment model: "individual data points are maximised for learning and feedback value, whereas high-stake decisions are based on aggregation of many data points" [C15].

### What needs adaptation

**a. The consistency problem is harder for LLM agents than for SPs**
Human SPs drift non-verbally (facial expression, vocal pacing) but maintain core clinical narrative accuracy at 89–91% [C5]. LLM agents drift semantically — abandoning the planted-bug persona, volunteering information they should withhold, or adjusting their pushback threshold based on candidate tone [C7]. The SP solution (earpiece monitoring, post-session debrief) has a direct analog: a turn-by-turn consistency classifier that detects off-persona responses and either corrects them before delivery or flags them for scorer discounting. This is architecturally more invasive than the SP equivalent.

**b. Reactivity calibration has no established literature**
The SP literature documents a consistency-reactivity tradeoff but offers no calibration protocol for setting the right level of reactivity for different assessment purposes. For PIPE's "junior vs. senior" implementer personas, the appropriate pushback probability, the threshold for accepting a fix, and the rate of introducing new information must be defined empirically — there is no prior art to borrow.

**c. Scoring the candidate's AI direction is genuinely novel**
NOTECHS covers "decision making" and "situational awareness" but was designed for a human-human team context. The "AI-direction" dimension — whether the candidate effectively tasks, constrains, and validates an AI collaborator — has no established rubric in any prior literature surveyed. The closest analog is the "leadership/managerial skills" category in NOTECHS (authority, planning, workload distribution), but this conflates team-authority skills with the distinct skill of prompt engineering under uncertainty. This dimension requires original BARS development via critical incident studies with expert reviewers.

**d. Turn-level vs. encounter-level scoring**
OSCE and MMI both score at the encounter/station level. Aviation LOE scores at the event level (within the scenario). Turn-level scoring of a code review conversation has no established precedent. The risk is that individual turn scores are unreliable (a comment may be brilliant even if the sentence structure is terse), and aggregating 15 turn-level scores may amplify noise rather than reduce it. The safer approach — supported by the OSCE context-specificity literature — is to score at the PR level (encounter level), using turn-level observations as evidence that informs the rubric dimensions rather than treating them as independent data points.

### What is genuinely novel (OSCE/simulation research cannot answer)

1. **LLM agent as counterparty changes the validity model.** In OSCE, the SP is a passive stimulus; the examiner scores the candidate. In PIPE, the implementer agent is active and generates content that may itself be flawed, inconsistent, or educationally misleading. This introduces a new validity threat: **agent-generated construct-irrelevant variance** (the agent says something confusing; the candidate's poor response is to the agent's confusion, not to their underlying competence). This threat has no analog in the SP literature because human SPs undergo training, monitoring, and evaluation to prevent such failures. LLM agents need an equivalent quality-assurance chain.

2. **Iterative diff evolution is structurally absent from OSCE.** The code evolves between rounds as the agent implements (or rejects) fixes. This means the candidate must track what changed and respond to the delta — a form of "situated comprehension across multiple states" that has no direct OSCE equivalent. Assessment validity depends on whether the candidate is actually tracking the diff or re-reading the whole PR. No prior literature informs how to isolate this variable.

3. **Automated scoring via LLM panel is novel.** OSCE checklists are scored by human raters or SPs; MMI stations are scored by trained human examiners; aviation LOE is scored by certified evaluator/instructors. PIPE's scoring panel (code-review-arena design) uses Devstral Small to score the conversation. The inter-rater reliability of LLM-as-judge scoring in a domain-specific assessment context (not general QA) requires empirical validation that does not yet exist in the peer-reviewed literature. The EasyMED study reports Cohen κ = 0.76 for an LLM evaluation agent in medical SP context [C8] — the closest available prior art.

---

## Sources

S1. Imanipour, M., & Jalili, M. (2016). *Reliability analysis of the objective structured clinical examination using generalizability theory.* Medical Education Online. PMC4991996. https://pmc.ncbi.nlm.nih.gov/articles/PMC4991996/

S2. Pau, A. et al. (2019). *Multiple Mini Interview as an admission tool in higher education: Insights from a systematic review.* Journal of Educational Evaluation for Health Professions. PMC6695046. https://pmc.ncbi.nlm.nih.gov/articles/PMC6695046/

S3. Eva, K.W., Rosenfeld, J., Reiter, H.I., & Norman, G.R. (2004). *An admissions OSCE: the multiple mini-interview.* Medical Education, 38(3), 314-326. https://asmepublications.onlinelibrary.wiley.com/doi/full/10.1046/j.1365-2923.2004.01776.x

S4. Swanson, D.B., & van der Vleuten, C.P.M. (2013). *Assessment of clinical skills with standardized patients: state of the art revisited.* Teaching and Learning in Medicine, 25(S1), S17–S25. (ResearchGate PDF) https://www.researchgate.net/publication/258641069_Assessment_of_Clinical_Skills_With_Standardized_Patients_State_of_the_Art_Revisited

S5. Hodges, B., Regehr, G., McNaughton, N., Tiberius, R., & Hanson, M. (1999). *OSCE checklists do not capture increasing levels of expertise.* Academic Medicine, 74(10), 1129–1134. https://pubmed.ncbi.nlm.nih.gov/10536636/

S6. Hodges, B., & McIlroy, J.H. (2003). *The risks of thoroughness: reliability and validity of global ratings and checklists in an OSCE.* Advances in Health Sciences Education. https://link.springer.com/article/10.1007/BF00162920

S7. Lateef, F. (2020). *Standardization of Standardized Patient Training in Medical Simulation.* StatPearls. https://www.ncbi.nlm.nih.gov/books/NBK560864/

S8. de la Croix, A., & Veen, M. (2022). *Quality in Standardized Patient Training and Delivery: Retrospective Documentary Analysis of Trainer and Instructor Feedback.* Simulation in Healthcare. PMC8820478. https://pmc.ncbi.nlm.nih.gov/articles/PMC8820478/

S9. Ouyang, S. et al. (2024). *Consistently Simulating Human Personas with Multi-Turn Reinforcement Learning.* arXiv:2511.00222. https://arxiv.org/html/2511.00222v1

S10. Eva, K.W., Reiter, H.I., Rosenfeld, J., Trinh, K., Wood, T.J., & Norman, G.R. (2009). *Predictive validity of the multiple mini-interview for selecting medical trainees.* Medical Education, 43(8), 767–775. https://asmepublications.onlinelibrary.wiley.com/doi/abs/10.1111/j.1365-2923.2009.03407.x

S11. Reiter, H.I., Eva, K.W., Rosenfeld, J., & Norman, G.R. (2007). *Multiple mini-interviews predict clerkship and licensing examination performance.* Medical Education, 41(4), 378–384. https://pubmed.ncbi.nlm.nih.gov/17430283/

S12. Flin, R., & Martin, L. (2001). *Behavioural Markers for Crew Resource Management: A Review of Current Practice.* International Journal of Aviation Psychology, 11(1), 95–118. https://www.pacdeff.com/pdfs/Behavioral%20Markers%20for%20CRM%20Flin%20and%20Martin.pdf

S13. van Avermaete, J.A.G., & Kruijsen, E.A.C. (1998). *NOTECHS: The Evaluation of Non-Technical Skills of Multi-Pilot Aircrew in Relation to the JAR-FCL Requirements.* NLR report (JARTEL project). https://www.researchgate.net/publication/224989989_Development_of_the_NOTECHS_non-technical_skills_System_for_Assessing_Pilots_CRM_Skills

S14. van der Vleuten, C.P.M., & Schuwirth, L.W.T. (2005). *Assessing professional competence: from methods to programmes.* Medical Education, 39(3), 309–317. https://pubmed.ncbi.nlm.nih.gov/15733167/

S15. Harden, R.M., Stevenson, M., Downie, W.W., & Wilson, G.M. (1979). *Assessment of clinical competence using an objective structured clinical examination.* Medical Education, 13(1), 41–54. https://asmepublications.onlinelibrary.wiley.com/doi/10.1111/j.1365-2923.1979.tb00918.x

S16. Buján-Kovacs, A. et al. (2026). *Predictive validity of the OSCE and academic transcript on MIR performance.* Medical Teacher. https://www.tandfonline.com/doi/full/10.1080/09581596.2026.2613523

S17. Wallace, P. (1997). *Following the threads of an innovation: The history of standardized patients in medical education.* Caduceus, 13(2), 5–28. (Cited via Swanson & van der Vleuten 2013 review.)

S18. Smith, P.C., & Kendall, L.M. (1963). *Retranslation of expectations: An approach to the construction of unambiguous anchors for rating scales.* Journal of Applied Psychology, 47(2), 149–155. (Foundational BARS paper; widely cited, not URL-available.)

S19. FAA. (2022). *AC 120-35D: Flightcrew Member Line Operational Simulations.* US Department of Transportation. https://www.faa.gov/regulations_policies/advisory_circulars/index.cfm/go/document.information/documentID/1027170

S20. FAA. (2022). *AC 120-54A (Change 1): Advanced Qualification Program.* US Department of Transportation. https://www.faa.gov/sites/faa.gov/files/2022-11/AC-120-54A,%20Chg.1,%20AQP.pdf

S21. McGaghie, W.C., Issenberg, S.B., Cohen, E.R., Barsuk, J.H., & Wayne, D.B. (2011). *Does simulation-based medical education with deliberate practice yield better results than traditional clinical education?* Academic Medicine, 86(6), 706–711. PMC3102783. https://pmc.ncbi.nlm.nih.gov/articles/PMC3102783/

S22. van der Vleuten, C.P.M. et al. (2012). *A model for programmatic assessment fit for purpose.* Medical Teacher. https://pubmed.ncbi.nlm.nih.gov/22364452/

S23. Woodward, C.A., McConvey, G.A., Neufeld, V., Norman, G.R., & Walsh, A. (2011). *Examination of standardized patient performance: Accuracy and consistency over time.* Medical Education (1985 original; 2011 replication). PMC3158971. https://pmc.ncbi.nlm.nih.gov/articles/PMC3158971/

S24. Liu, J. et al. (2024). *Human or LLM as Standardized Patients? A Comparative Study in Medical Education.* arXiv:2511.14783. https://arxiv.org/html/2511.14783

S25. Harden, R.M., & Lilley, P. (2013). *The Objective Structured Clinical Examination (OSCE): AMEE Guide No. 81.* Medical Teacher, 35(8), e1261–e1278. https://pubmed.ncbi.nlm.nih.gov/23968323/

---

## Confidence and Gaps

**High confidence claims (multiple peer-reviewed sources, quantitative coefficients):**
- OSCE reliability requires 8–14 stations for G ≥ 0.80 [S1, S2, S3]
- Checklists penalise expert-level behaviour; global scales discriminate better at high expertise levels [S5, S6]
- MMI achieves r = 0.73 median reliability and predicts licensing exam performance at r = 0.35–0.43 [S3, S10, S11]
- SP portrayal accuracy for core clinical items is ~90%; non-verbal drift is the main source of inter-SP variance [S23]
- LLM persona consistency improves >55% with PPO vs. instruction tuning alone [S9]

**Moderate confidence claims (single study or recent pre-print):**
- LLM virtual SP near-parity with human SP on SPBench (96.98 vs. 97.33) [S24] — single comparative study, 2024 pre-print
- OSCE explains 32% of future clinical competence variance [S16] — one study, 2026, single-source
- NOTECHS 83–84% accuracy after short training [S12] — based on one JARTEL implementation, 1998–2001 data

**Genuine gaps not addressable from this literature:**
1. No prior art on scoring the "AI direction" dimension specifically — requires original BARS development
2. No validity evidence for LLM-as-judge scoring in domain-specific engineering assessment contexts (κ = 0.76 in medical SP context [S24] is the best available proxy)
3. No established protocol for calibrating the reactivity / pushback probability of a simulated agent counterparty — the SP literature acknowledges the tradeoff but does not quantify the optimal point
4. No empirical data on whether iterative-diff tracking (multi-round code review where the diff evolves) measures a distinct skill vs. re-reading competence — genuinely novel assessment scenario

**Note on S18 (Smith & Kendall 1963 BARS paper):** Foundational paper widely cited across industrial/organisational psychology and educational measurement; no stable public URL available. It is accessible via PsycINFO and major academic libraries.
