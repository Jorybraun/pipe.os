# Research: Cognitive Science of Human Oversight of Automated/AI Systems

## Research Objective

This research examines the cognitive science literature on automation bias, metacognition, calibration, and human-AI teaming to identify what predicts effective versus ineffective supervision of AI systems. The focus is on documented failure modes, interventions that reduce complacency, and cognitive behaviors distinguishing effective supervisors from those who blindly defer to automation.

## Key Findings

### 1. Automation Bias: Documented Failure Modes and Interventions

#### 1.1 Definition and Frequency

Automation bias is "a fairly robust and generic effect across research fields" [S1] manifesting as the tendency to over-rely on automated recommendations at the expense of contradictory information or independent judgment. In systematic review evidence, automation bias occurs in **6-11% of cases where correct pre-advice decisions were reversed to incorrect post-advice decisions** (negative consultations) [S1]. Meta-analysis demonstrates that erroneous decision support system (DSS) advice was **26% more likely to be followed than control decisions** (RR 1.26, 95% CI 1.11-1.44) [S1].

Parasuraman and Manzey's attentional integration theory identifies automation complacency as occurring "under conditions of multiple-task load, when manual tasks compete with the automated task for operators' attention" [S2], affecting both novice and expert operators and persisting despite practice [S2].

#### 1.2 Failure Modes Across Domains

**Aviation:** Mode confusion represents a critical failure mode, with 73% of 1,268 surveyed pilots reporting inadvertent selection of wrong automation modes [S3]. Major cognitive skill failures include "failures to maintain awareness of the airplane's location, keep track of next steps, and recognize and handle instrument systems failures" [S4]. The shift from active to passive information processing under automation degrades situation awareness (SA) across multiple dimensions [S5].

**Medicine - Radiology:** When AI provided incorrect localized explanations in chest X-ray diagnosis, physician accuracy dropped catastrophically from **92.8% to 23.6%** [S6]. In mammography, experienced radiologists (>15 years) saw accuracy fall from **82% to 45.5%** when incorrect AI suggestions were presented [S7]. Notably, "radiologists and non-radiologists in the study tended to trust the AI diagnosis more quickly" when provided local explanations, regardless of accuracy [S6].

**Medicine - LLM Diagnostics:** Large language models induce automation bias even in AI-trained physicians, with "erroneous LLM recommendations significantly degrad[ing] physicians' diagnostic performance" [S8]. Reviewers were "more likely to align their diagnostic decision with AI advice and underwent a shorter period of consideration when AI provided local explanations" [S8].

**Nuclear Operations:** Automation in nuclear settings creates "poor operator vigilance and complacency [leading] to reductions in situation awareness and manual skills" [S9]. Research documents that "excessive reliance on automation can lead to mistakes due to complacency, operator inattentiveness, and lack of familiarity with the actual operations of a reactor plant" [S9].

**Autonomous Vehicles:** Drivers successfully detected silent automation failures in nearly all cases (only 0.25% lane exits), but response latency ranged from **1-2 seconds for critical failures** [S10]. Cognitive load (simulated distraction) increased response variability by approximately 10% and reduced steering wheel angle by 12% [S10]. In plausible scenarios with time-to-line-crossing of 2.0 seconds, cognitive load increased failure rate from 1.3% to **4.4%** [S10].

**Process Control:** In industrial process control, complacency manifests as "inappropriate checking and monitoring of automated functions," resulting in commission errors where operators follow false automated recommendations [S11]. This occurs despite clear awareness of the automation's imperfect reliability.

#### 1.3 Cognitive Mechanisms Underlying Failures

**Attentional Shift:** The transition from "actively searching for information" to "passively receiving information" reduces alertness and analytical capabilities [S5]. Higher automation levels significantly decrease situation awareness at the perception level (SA1: F=9.903, p<0.001) and projection level (SA3: mean difference 0.181, p<0.001) [S5].

**Trust Miscalibration:** Lee and See's influential model identifies trust calibration as "the correspondence between an operator's trust and the system's actual trustworthiness" [S12]. Miscalibration occurs in two directions: **overtrust** (exceeding system capability, leading to misuse) and **undertrust** (below system capability, leading to disuse) [S12]. Higher but imperfect system reliability paradoxically increases complacency [S1].

**Out-of-the-Loop Performance Problem:** Endsley and Kiris define this as operators being "handicapped in their ability to take over manual operations in the event of automation failure" due to loss of skills and situation awareness [S13]. Low SA corresponded with "out-of-the-loop performance decrements in decision time following a failure" [S13]. The four core mechanisms are: (a) vigilance decrements, (b) over-trust/complacency, (c) loss of situation awareness, and (d) manual skill decay [S13].

**Accumulated Perceptual Error:** In autonomous vehicle takeover, drivers respond to accumulated perceptual error rather than absolute error magnitude, "equating integration of a small error over a long time with the integration of a large error over a short time" [S10]. This explains slower but safer responses to gradual failures.

#### 1.4 Effect Mediators

**User Factors:**
- Task inexperience increased over-reliance, though inexperienced users showed best overall improvement despite higher automation bias risk [S1]
- User self-confidence inversely related to DSS reliance; higher confidence decreased acceptance of external support [S1]
- Trust in automation was "possibly the strongest driving factor in over-reliance" when miscalibrated [S1]

**Environmental Factors:**
- Increased workload and task complexity pressurized cognitive resources, biasing toward heuristic DSS use [S1]
- Time pressure heightened reliance on automation [S1]
- Higher (but imperfect) system reliability paradoxically increased complacency [S1]

**Automation Characteristics:**
- Display prominence of advice increased automation bias likelihood [S1]
- Status displays (vs. command-type advice) reduced over-reliance under time pressure [S1]
- Local explanations (highlighting specific areas) increased trust acceleration compared to global explanations, regardless of accuracy [S6]

#### 1.5 Interventions That Reduce Automation Bias

**Design Interventions:**
- **Reducing display prominence** of automation advice decreased automation bias likelihood [S1]
- **Providing confidence levels** alongside advice improved appropriateness of reliance [S1]
- **Supportive information rather than direct recommendations** mitigated bias [S1]
- **Transparency of DSS reasoning** improved appropriate reliance by enabling users to evaluate the basis for recommendations [S1]
- **Clearly displaying automation mode and status** is critical for pilots to effectively oversee automation and intervene appropriately [S14]

**Training Interventions:**
- **Exposure to automation failures during training** significantly decreased complacency in process control operators, though "might not avoid it completely" [S11]
- **Training on system's actual reliability** altered trust and reliance patterns, reducing complacency [S11]
- Training reduced commission errors and was more effective for complacency than for inherent automation bias [S1]
- **Manual skill practice** in mixed automation environments (alternating between manual and automated machines) reduced performance degradation and workload compared to full automation [S4]
- Aviation training using the CAMI acronym (Confirm that the correct mode or function is selected) helps maintain mode awareness [S3]

**Accountability Interventions:**
- **Enhanced accountability** decreased automation bias errors overall [S1]
- Making participants **accountable for decision accuracy or overall performance** led to lower automation bias rates [S15]
- However, externally-imposed accountability showed mixed results with professionals: pilots who **internally perceived accountability** were significantly more likely to verify automated cues and less likely to commit errors, while experimentally-manipulated accountability demands did not impact professional pilots [S15]
- Internal perception of accountability was more effective than external manipulation for reducing automation bias [S15]

**Verification and Monitoring:**
- **Verification-related cognitive engagement** serves as a critical debiasing mechanism [S15]
- Training behaviors that verify automated information against other available data proved more effective than simple accountability demands [S15]
- **Structured data acquisition and checklists** demonstrated sustained reductions in errors (catheter-related infections, surgical complications) [S16]

**Cognitive Forcing and Debiasing:**
- **Reflective practice:** "Deliberately reflecting upon initial diagnoses led to better diagnoses in difficult cases" [S16]
- **"Consider the opposite" techniques** showed promise as cognitive forcing strategies [S16]
- **Statistical prediction rules** typically equal or exceed expert intuitive judgment reliability [S16]
- However, randomized controlled trials of cognitive forcing strategies showed **null results**: no difference in error rates (mean 2.8 vs 3.1 cases correct, 95% CI -0.94 to 0.45, p=0.49) [S17], despite positive qualitative reception

**Automation Level Optimization:**
- **Intermediate levels of automation** generate better situation awareness than low automation or full automation [S9]
- **Blended decision-making** (human-automation collaboration) generates lowest mental workload [S9]
- Operators should be able to "easily and simply override the automation and take control" without the system fighting for control [S14]

**Skill Retention Interventions:**
- **Practice-based refreshers** supported skill retention but with higher mental workload than skill demonstration [S18]
- **Task-specific matching** is critical: interventions targeting procedural skills may not maintain knowledge, and vice versa [S18]
- **Periodic manual skill practice** prevents degradation from automation-induced disuse [S19]
- Aviation methodology proposes "balanced automation use, regular manual flying exercises in training sessions, and during line operations under safe conditions" [S4]

### 2. Metacognitive Behaviors Distinguishing Effective AI Supervisors

#### 2.1 The Performance-Metacognition Disconnect

Recent empirical studies document a troubling **disconnect between performance improvement and metacognitive accuracy** when using AI assistance. Participants using AI improved logical reasoning performance by three points compared to norms, yet **overestimated their performance by four points** [S20]. This creates a paradox: objective task gains occur while self-assessment accuracy deteriorates.

Critically, "higher AI literacy was linked to less accurate self-assessment" — those with greater technical knowledge of AI were **more confident but less precise** in judging their own performance [S20]. This inverts the expected relationship between expertise and calibration.

#### 2.2 Disappearance of the Dunning-Kruger Effect

A surprising finding: "the Dunning-Kruger effect, usually observed in this task, ceased to exist with AI" [S20]. Rather than low-performers overestimating ability and high-performers being calibrated (the classic pattern), AI use created **universal overestimation across all skill levels** [S21]. This "metacognitive leveling" suggests AI fundamentally alters the competence-confidence gradient.

The phenomenon is termed **AI-mediated metacognitive decoupling** — a widening gap among produced output quality, underlying understanding, calibration accuracy, and self-assessed ability [S22]. LLM use can "improve observable output and short-term task performance while degrading metacognitive accuracy" [S22].

#### 2.3 Metacognitive Accuracy vs. Metacognitive Sensitivity

**Metacognitive accuracy** refers to how well self-evaluations align with actual performance, enabling better decisions when limitations are recognized [S23]. It is shaped by:
- **Metacognitive bias:** consistent over/underestimation of abilities
- **Metacognitive noise:** random fluctuations in self-assessment, reducing sensitivity [S23]

**Metacognitive sensitivity** reflects the ability to distinguish between correct and incorrect judgments, typically measured by confidence ratings post-decision [S23]. This is quantified using signal detection theory measures:
- **Meta-d':** estimates "how effectively confidence judgments distinguish between correct and incorrect judgments" [S24]
- **M-ratio (metacognitive efficiency):** meta-d'/d', comparing metacognitive sensitivity to task performance, with optimal value of 1.0 [S24]

#### 2.4 AI Metacognitive Sensitivity and Human Decisions

Research demonstrates that "AI metacognitive sensitivity — its ability to assign confidence scores that accurately distinguish correct from incorrect predictions" — significantly influences human decision quality [S25]. Critically, **an AI with lower raw accuracy but higher metacognitive sensitivity can enhance overall accuracy of human decision-making** [S25]. This suggests confidence calibration matters as much as, or more than, raw performance.

The framework emphasizes evaluating "AI assistance not only by accuracy but also by metacognitive sensitivity" [S25], as "confidence ratings alone are not necessarily enough to ensure proper usage of AI's advice" [S24]. AI systems must report their metacognitive sensitivity — how well their confidence judgments align with actual accuracy.

#### 2.5 Illusions of Knowledge from AI Assistance

When feedback is immediate or requires little effort (as with AI assistance), individuals develop "illusions of knowledge, overestimating how much they truly know" [S23]. AI assistance may promote three problematic illusions [S19]:
- **Explanatory depth:** overestimating understanding of how systems work
- **Exploratory breadth:** assuming all possibilities were considered
- **Objectivity:** ignoring embedded AI biases

This occurs because "AI-induced skill decay may operate outside the performer's awareness" — the disuse is at the level of cognitive skill engagement, not task engagement [S19]. A surgeon using AI may continue performing operations successfully while losing underlying cognitive capabilities like spatial navigation or anatomical assessment.

#### 2.6 Collaborative AI Metacognition as a Trainable Capacity

A validated scale for **Collaborative AI Metacognition** shows good internal consistency and predictive validity [S26]. However, research finds that ChatGPT use "may encourage over-reliance on AI, leading to 'metacognitive laziness,' reducing users' tendency for self-regulation and critical engagement" [S26].

**Positive evidence for training:**
- AI-powered training tools to improve metacognitive calibration significantly improved learning gains by **8.9%** [S27]
- Overconfident students receiving metacognitive calibration intervention showed **4.1% greater calibration improvement** than control groups [S27]
- Calibration training with intelligence analysts significantly reduced miscalibration and bias [S28]
- Performance feedback can improve calibration after making 200 judgments with intensive feedback [S28]
- Overconfidence could be eliminated by feedback after five deceptively difficult problems [S28]

**Critical success factor:** "The most effective way to improve calibration seems to be very simple: Stop to consider reasons why your judgment might be wrong" [S28].

#### 2.7 Stable Trait vs. Trainable Skill

The evidence suggests metacognitive accuracy is **primarily a trainable skill** rather than a stable trait, though individual differences exist:

**Trainability evidence:**
- Deliberate practice with feedback improves metacognitive calibration [S27, S28]
- Performance feedback reduces overconfidence while environmental feedback improves discrimination, demonstrating "calibration and discrimination are dissociable abilities that require separate training techniques" [S28]
- Commercial calibration training successfully reduced miscalibration in professional forecasters [S28]

**Individual differences:**
- "Individual differences in cognitive abilities often predict skill acquisition rates and levels of ultimate expertise" [S19]
- However, individual differences in susceptibility to automation bias or metacognitive accuracy are not extensively documented in the reviewed literature (research gap)

**Expertise development:** Expertise develops "neither automatically nor through extensive years of practice, but rather through deliberate practice" — individuals engaging with full concentration on improving specific aspects of performance [S29]. In medicine, "experience is unrelated to accuracy" in domains like general nursing and heart sound diagnosis without deliberate practice [S29].

### 3. Calibration Measurement and "Knowing What You Don't Know"

#### 3.1 Core Calibration Concepts

**Calibration** measures whether a model's or person's confidence matches their accuracy — a well-calibrated judge saying '80% confident' should be right about 80% of the time [S30]. In machine learning, "being correct isn't enough; we must also know when we are correct. A model that confidently gets things wrong is worse than one that hesitantly gets things right" [S31].

For human judgment, proper calibration represents **knowing what you don't know** — the ability to accurately assess one's own knowledge boundaries and uncertainty.

#### 3.2 Measurement Approaches

**Reliability Diagrams:**
- Plot average confidence (x-axis) against accuracy (y-axis) within binned groups [S30]
- Perfectly calibrated outcome appears as diagonal line [S30]
- Points below diagonal indicate overconfidence (less accurate than confidence suggests)
- Points above diagonal indicate underconfidence

**Expected Calibration Error (ECE):**
- Weighted average of absolute difference between average accuracy and average confidence across bins [S30]
- "De facto metric for measuring and comparing model calibration in deep learning" [S30]
- Limitation: sensitive to binning choices [S30]
- "A model which minimizes ECE does not necessarily have high accuracy" [S30]

**Brier Score:**
- Mean squared difference between predicted probability and actual outcome [S32]
- Lower scores indicate better calibration [S32]
- First term decomposes into calibration component [S32]
- More robust to calibration issues than log loss [S32]

**Log Loss:**
- Negative log probability of correct predictions [S32]
- More sensitive to differences in predicted probabilities than Brier score [S32]
- Better distinguishes models good at predicting probabilities [S32]
- Penalizes confident but incorrect predictions heavily

**Signal Detection Theory Measures (for metacognition):**
- **Meta-d':** represents "how much information, in signal-to-noise units, is available for metacognition" [S33]
- **Type 2 sensitivity:** efficacy with which confidence ratings discriminate between correct and incorrect classifications [S33]
- Provides "response-bias free measure of how well confidence ratings track task accuracy" [S33]

#### 3.3 Trust Calibration in Human-Automation Systems

**Measurement Scales:**

Most frequently used self-report measures [S34]:
- **Checklist for Trust (Jian et al., 2000):** Most cited measure, though critiqued for "less sensitivity than other measures" and positivity bias [S34]
- **Human-Computer Trust Questionnaire (Madsen & Gregor, 2000):** 25 items capturing five facets (understandability, technical competence, reliability, personal attachment, faith) [S34]
- **Mayer & Davis (1999) Measures:** Separately captures ability, benevolence, integrity, propensity, and trust [S34]
- **TOAST (Wojton et al., 2020) and MDMT (Malle & Ullman, 2021):** Newer validated approaches explicitly connecting to trust models [S34]

**Dynamic Measurement Approaches:**
- Frequent sampling using single-item scales
- "Area under the trust curve" methodology capturing changes over time
- Behavioral indicators: compliance, reliance, intervention rates [S34]

**Psychometric Challenges:**
- Self-report measures show inconsistent alignment with behavioral measures [S34]
- Custom measures (overwhelmingly prevalent) lack external validation [S34]
- Construct validity remains difficult for latent variables [S34]

**Recommended validation:** Pairing behavioral measures with self-report scales for convergent validity, controlling extraneous variables (workload, risk perception), using repeated measurement to capture trust evolution [S34].

#### 3.4 Situational Awareness Measurement

**SAGAT (Situation Awareness Global Assessment Technique):**
- Objective measure based on queries during simulation freezes [S35]
- Displays blanked, operator queried about knowledge at time of freeze [S35]
- Most widely used query method, 94% sensitivity [S35]
- Originally for industrial machinery operators, adapted for multiple domains

**SART (Situation Awareness Rating Technique):**
- Subjective operator rating of SA [S35]
- 14 components rated on bipolar scales (demand on resources, supply of resources, understanding) [S35]
- SAGAT and SART were **not correlated** with each other [S35]
- SART had significantly lower sensitivity (64%) compared to SAGAT (94%) [S35]

**Key finding:** Objective measures (SAGAT) are more predictive of performance than subjective self-assessment (SART), parallel to the metacognition literature showing self-assessment often diverges from actual performance.

### 4. Expert vs. Novice Differences in AI Supervision

#### 4.1 Cognitive Processes Distinguishing Experts

**Pattern Recognition and Schema-Driven Reasoning:**
- Expert diagnostic reasoning is "largely schema driven, with previous patient encounters influencing medical evaluations of current cases" [S36]
- Recognition-Primed Decision Making (RPD): experts "match the current situation to one of the thousands of patterns they've internalized through years" [S37]
- Experts engage in "rapid mental simulations to test their responses before acting" — blending pattern recognition with analysis [S37]

**Hypothesis Generation Strategies:**
- **Novices:** use depth-first search, "considering and evaluating a single hypothesis at a time" with "tendency to maintain hypotheses despite contradictory evidence" [S36]
- **Intermediate/Advanced novices:** use breadth-first search, "consider and evaluate several hypotheses concurrently" [S36]
- **Experts:** employ forward-directed reasoning enabled by compiled knowledge networks [S36]

**Perceptual and Attentional Differences:**
- Experts demonstrate "significantly higher diagnostic accuracy, shorter time to diagnosis, and higher percentage of time spent viewing areas of diagnostic interest" [S36]
- Experts "categorize stimuli at a highly principled and functional level of abstraction" [S36]
- Experts filter irrelevant information: "able to focus only on the aspects of the problem critical to the diagnosis while ignoring or filtering out irrelevant information" [S36]

#### 4.2 Implications for AI Supervision

**Expertise Does Not Protect Against Automation Bias:**
- Experienced radiologists (>15 years) saw accuracy fall from 82% to 45.5% with incorrect AI suggestions — a **44% decline** [S7]
- "Incorrect advice by an AI-based decision support system could seriously impair the performance of radiologists at every level of expertise" [S7]
- Professional pilots showed no response to experimentally-manipulated accountability demands (though internal accountability perceptions still mattered) [S15]

**Two-Process Model Implications:**
- Experts' strength in pattern recognition creates vulnerability: when AI highlights a specific region (local explanation), experts' pattern-matching processes may lock onto that area prematurely
- "Two different types of diagnostic processes draw on different types of skills" — pattern recognition for familiar conditions, systematic reasoning for unfamiliar problems [S29]
- AI assistance may short-circuit the systematic reasoning process that experts normally employ for unfamiliar cases

**De-skilling Risk:**
- "Growing reliance on automation has reduced opportunities for manual flying practice, leading to a degradation of those skills" [S4]
- "Automation group showed the most performance degradation and highest workload, while the alternating group presented reduced performance degradation and workload" [S4]
- AI that "mimic[s] expert decision making by dynamically assessing problems" creates greater risk for skill deterioration than simpler automation [S19]

#### 4.3 What Distinguishes Effective Expert Supervision

The literature suggests effective supervision depends on **maintaining active cognitive engagement** rather than stable traits:

**Behavioral Markers:**
- **Verification behavior:** double-checking automated cues against other data sources [S15]
- **Internal accountability:** perception of personal responsibility for outcomes (vs. externally-imposed accountability) [S15]
- **Reflective practice:** deliberately reconsidering initial diagnoses [S16]
- **Mode awareness:** actively tracking automation state and system parameters [S3, S14]

**Cognitive Strategies:**
- **Consider the opposite:** actively generating alternative hypotheses [S16]
- **Avoiding premature closure:** continuing systematic evaluation despite initial pattern match
- **Metacognitive monitoring:** tracking confidence and identifying when AI output exceeds personal ability to verify

**Training and Practice:**
- **Exposure to failure cases:** experiencing automation errors during training [S11]
- **Deliberate practice:** focused improvement on specific aspects of supervisory performance [S29]
- **Alternating practice:** mixing manual and automated task performance [S4]

## Assessment Design Implications

### 1. Reveal Automation Bias Susceptibility

**Task Design Principle:** Include scenarios where AI/automated suggestions are confidently wrong on cases that should be within the candidate's domain expertise.

**Rationale:** Automation bias occurs in 6-11% of negative consultations [S1], and experienced physicians' accuracy drops from 92.8% to 23.6% with incorrect AI advice [S6]. Measuring whether candidates **override incorrect AI** distinguishes those who verify from those who defer.

**Observable Behaviors:**
- Does the candidate verify AI suggestions against available data?
- Do they identify contradictory evidence that conflicts with AI recommendations?
- Do they exhibit "shorter period of consideration" when AI provides explanations [S8]?

**Measurement Approach:** Track override rate on incorrect AI suggestions, time spent reviewing AI rationale, and whether candidate seeks additional information sources before accepting recommendation.

### 2. Test Metacognitive Accuracy Under AI Assistance

**Task Design Principle:** After tasks completed with AI assistance, elicit confidence judgments about performance and compare to actual accuracy.

**Rationale:** AI users overestimate performance by four points while improving by three points [S20], and "higher AI literacy was linked to less accurate self-assessment" [S20]. Measuring the **performance-metacognition gap** reveals whether candidates maintain calibrated self-awareness.

**Observable Behaviors:**
- Post-task confidence ratings for each decision/output
- Self-assessment of which AI suggestions were most/least reliable
- Explicit uncertainty expression when appropriate

**Measurement Approach:** Calculate calibration curves (confidence vs. accuracy), ECE scores [S30], and Brier scores [S32] for candidate confidence judgments. High performers with accurate metacognition demonstrate both task competence and supervisory capacity.

### 3. Measure Out-of-the-Loop Performance

**Task Design Principle:** Present scenarios where automation fails or produces degraded output, requiring manual intervention or recovery.

**Rationale:** Out-of-the-loop operators are "handicapped in their ability to take over manual operations" [S13], with response latency ranging from 1-2 seconds [S10]. Measuring **takeover latency and accuracy** reveals situation awareness maintenance.

**Observable Behaviors:**
- Time to detect automation failure or degraded output
- Accuracy of manual intervention after relying on automation
- Situation awareness when automation state changes

**Measurement Approach:** Measure decision time following automation failure [S13], accuracy of recovery actions, and SAGAT-style queries [S35] about system state during automated operation.

### 4. Assess Verification and Monitoring Behaviors

**Task Design Principle:** Provide automation assistance but ensure additional verification data sources are available and relevant.

**Rationale:** "Verification-related cognitive engagement serves as a critical debiasing mechanism" [S15], and pilots who internally perceived accountability were "significantly more likely to double-check automated cues" [S15].

**Observable Behaviors:**
- Frequency of consulting alternative data sources beyond AI output
- Systematic checking of AI reasoning against domain knowledge
- Explicit hypothesis generation beyond AI suggestions

**Measurement Approach:** Log which information sources are accessed, order of information consultation, and whether verification occurs before accepting AI recommendations. Compare verification rates on high-confidence vs. low-confidence AI outputs.

### 5. Reveal Skill Degradation Susceptibility

**Task Design Principle:** Include tasks first completed with AI assistance, then repeated without assistance after a delay.

**Rationale:** AI assistance "may accelerate skill decay and hinder skill development without performers' awareness" [S19], with "high performance observed in the AI-assisted group, but limits on learning remain hidden until AI assistance is removed" [S19].

**Observable Behaviors:**
- Performance comparison: AI-assisted vs. unassisted conditions
- Time to complete tasks without AI after prior AI-assisted practice
- Explicit awareness of skill dependencies on AI tools

**Measurement Approach:** Measure performance delta (assisted → unassisted), retention interval testing, and metacognitive awareness of skill gaps through post-task interviews.

### 6. Test Appropriate Reliance Calibration

**Task Design Principle:** Vary AI accuracy and confidence across tasks, measuring whether candidates appropriately increase reliance on high-quality suggestions and decrease reliance on low-quality ones.

**Rationale:** "An AI with lower predictive accuracy but higher metacognitive sensitivity can enhance the overall accuracy of human decision making" [S25], and appropriate reliance requires distinguishing "correct advice to follow" from "incorrect advice to turn down" [S38].

**Observable Behaviors:**
- Reliance patterns correlated with AI confidence/quality signals
- Ability to identify when AI is outside reliable performance envelope
- Adaptive trust based on experience with AI accuracy

**Measurement Approach:** Calculate Appropriateness of Reliance (AoR) as two-dimensional measure [S38]: correct advice followed + incorrect advice rejected. Track trust calibration relative to actual AI capability.

### 7. Measure Cognitive Forcing and Debiasing Capacity

**Task Design Principle:** Present cases susceptible to common cognitive biases (anchoring, confirmation bias, premature closure) and observe whether candidates employ debiasing strategies.

**Rationale:** While cognitive forcing strategies showed null results in RCTs [S17], **reflective practice** and **"consider the opposite" techniques** improved diagnoses in difficult cases [S16]. The capacity to self-correct, not the training intervention, predicts performance.

**Observable Behaviors:**
- Explicit generation of alternative hypotheses beyond initial impression
- Revisiting initial conclusions when new evidence emerges
- Articulating reasons judgment might be wrong [S28]

**Measurement Approach:** Code verbal protocols or written rationales for presence of "consider the opposite" statements, alternative hypothesis generation, and evidence-based revision of initial judgments.

### 8. Assess Mode Awareness and System State Tracking

**Task Design Principle:** In any task involving multiple tools or automation modes, measure whether candidates maintain awareness of which systems are active and in what state.

**Rationale:** 73% of pilots inadvertently selected wrong automation modes [S3], and "clearly and saliently displaying automation mode and status is critical to the ability of pilots to effectively oversee it" [S14]. Mode confusion represents a major failure mode.

**Observable Behaviors:**
- Accurate reporting of system state when queried
- Detecting mode transitions or unexpected automation behavior
- Communicating mode changes (if collaborative task)

**Measurement Approach:** SAGAT-style queries [S35] about automation state, logging of mode-related errors, and tracking recovery time from mode confusion incidents.

### 9. Differentiate Expert Pattern Recognition from Over-Reliance

**Task Design Principle:** Include cases where rapid pattern recognition is appropriate (familiar, well-structured problems) and cases requiring systematic analysis (unfamiliar, ambiguous problems).

**Rationale:** Experts use "schema-driven" reasoning for familiar cases but must "rely on reasoning and systematic generation of alternatives" for unfamiliar problems [S29]. Effective experts **switch strategies** based on problem type.

**Observable Behaviors:**
- Strategy selection (pattern matching vs. systematic analysis) appropriate to problem structure
- Explicit recognition when a case is outside familiar pattern space
- Switching from fast heuristic processing to slower analytical processing when needed

**Measurement Approach:** Compare time-to-decision and reasoning depth across high-familiarity and low-familiarity cases, coding for evidence of dual-process reasoning.

### 10. Measure Training Responsiveness to Calibration Feedback

**Task Design Principle:** Provide performance feedback after initial judgments and measure whether candidates adjust calibration in subsequent trials.

**Rationale:** "Performance feedback reduced participants' overconfidence" [S28], and calibration training with 200 judgments and intensive feedback enabled learning [S28]. Responsiveness to feedback indicates trainability.

**Observable Behaviors:**
- Calibration improvement across trials after feedback
- Explicit acknowledgment of overconfidence or underconfidence
- Strategy adjustments based on feedback

**Measurement Approach:** Calculate calibration metrics (Brier score, ECE) pre-feedback and post-feedback, tracking learning rate and asymptotic calibration quality.

### 11. Identify Internal vs. External Accountability Orientation

**Task Design Principle:** Frame tasks with varying accountability contexts and measure whether intrinsic responsibility motivates verification behavior.

**Rationale:** "Pilots who reported an internalized perception of accountability for their performance were significantly more likely to double-check automated cues" [S15], while externally-imposed accountability showed mixed results.

**Observable Behaviors:**
- Verification behavior in low-accountability vs. high-accountability framing
- Self-initiated quality checks vs. checklist compliance
- Expressions of personal responsibility for outcomes

**Measurement Approach:** Compare verification rates across accountability conditions; code for language indicating internal vs. external locus of control; measure behavior on unmonitored tasks.

### 12. Reveal Illusions of Explanatory Depth

**Task Design Principle:** After AI-assisted task completion, probe understanding of the underlying process through explanation or teach-back tasks.

**Rationale:** AI assistance creates "illusions of knowledge, overestimating how much they truly know" [S23], including illusions of explanatory depth [S19]. High performers with AI may lack transferable understanding.

**Observable Behaviors:**
- Ability to explain reasoning steps without AI output visible
- Quality of teaching/explaining the solution to another person
- Performance on transfer tasks requiring conceptual understanding

**Measurement Approach:** Scoring of explanation quality, teach-back accuracy, and transfer task performance. Gap between assisted performance and explanation quality reveals illusion of understanding.

## Open Questions and Research Gaps

### 1. Individual Differences in Automation Bias Susceptibility

**Gap:** While effect mediators (workload, trust, experience) are documented [S1], the literature provides limited evidence on whether automation bias susceptibility represents a stable individual difference or is primarily situational. Do some individuals consistently verify AI across contexts while others consistently defer?

**Assessment Implication:** If individual differences are stable, screening for automation bias susceptibility may be valuable. If primarily situational, assessment should focus on context-specific behaviors.

### 2. Metacognitive Sensitivity as Trait vs. State

**Gap:** Evidence shows metacognitive calibration is trainable [S27, S28], but whether **baseline metacognitive sensitivity** (independent of training) predicts learning rate or ultimate performance ceiling remains unclear.

**Assessment Implication:** Should assessments measure current metacognitive state (trainable) or underlying metacognitive capacity (possibly trait-like)?

### 3. Transfer of Calibration Across Domains

**Gap:** Calibration training improves performance in trained domains [S28], but whether calibration training in one domain (e.g., medical diagnosis) transfers to another (e.g., code review, strategic forecasting) is not established.

**Assessment Implication:** Domain-general metacognitive measures may not predict domain-specific AI supervision performance.

### 4. Optimal Automation Level for Learning

**Gap:** While intermediate automation levels optimize situation awareness [S9], the relationship between automation level and **skill development** (not just current performance) is underexplored. Does partial automation accelerate or hinder learning?

**Assessment Implication:** Assessment task design must consider whether AI assistance during assessment predicts or undermines future unassisted performance.

### 5. Long-Term Skill Degradation Trajectories

**Gap:** Short-term studies document performance decrements when automation is removed [S19], but longitudinal data on skill degradation rates, recovery trajectories, and permanent skill loss are limited.

**Assessment Implication:** Single-session assessment may not capture long-term supervisory effectiveness or de-skilling vulnerability.

### 6. Cognitive Forcing Strategy Mechanism Failures

**Gap:** Cognitive forcing strategies showed null effects in RCTs [S17] despite positive qualitative reception. Why do explicit debiasing techniques fail? Is the issue implementation fidelity, strategy selection, or fundamental cognitive constraints?

**Assessment Implication:** If debiasing is "an inexact science" [S16], assessing debiasing capacity may require behavioral observation rather than self-report or knowledge tests.

### 7. Expertise-Specific Automation Vulnerabilities

**Gap:** Experts showed massive accuracy drops with incorrect AI [S7], but the **mechanism** linking expertise to vulnerability is unclear. Do experts' pattern-matching strengths create anchoring weaknesses? Does overconfidence in domain mastery reduce verification?

**Assessment Implication:** Supervisor assessment for experts may require different design than for novices, emphasizing override behavior and verification rather than raw accuracy.

### 8. Measurement Validity of Trust Scales in AI Contexts

**Gap:** Trust scales were validated for traditional automation [S34], but AI systems exhibiting emergent behaviors, opacity, and dynamic capabilities may not fit the same trust constructs. "Trusting" a statistical model differs from "trusting" an LLM.

**Assessment Implication:** Off-the-shelf trust scales may lack construct validity for modern AI supervision assessment.

### 9. Metacognitive Laziness Reversibility

**Gap:** AI use induces "metacognitive laziness, reducing users' tendency for self-regulation" [S26], but whether this is a temporary state or a persistent habit is unknown. Can users "snap out of" laziness when stakes are high?

**Assessment Implication:** Low-stakes assessment may not predict high-stakes supervisory behavior if metacognitive engagement is context-dependent.

### 10. Interaction Between Explainability and Automation Bias

**Gap:** Explanations increased trust but also increased **incorrect reliance** when AI was wrong [S6, S8]. The optimal explainability design for promoting appropriate reliance (not just trust) is unresolved.

**Assessment Implication:** Assessment tasks using explainable AI may systematically induce different biases than opaque AI, confounding measurement.

## Sources

[S1] Goddard, K., Roudsari, A., & Wyatt, J. C. (2012). [Automation bias: a systematic review of frequency, effect mediators, and mitigators](https://pmc.ncbi.nlm.nih.gov/articles/PMC3240751/). *Journal of the American Medical Informatics Association*, 19(1), 121-127.

[S2] Parasuraman, R., & Manzey, D. H. (2010). [Complacency and Bias in Human Use of Automation: An Attentional Integration](https://journals.sagepub.com/doi/10.1177/0018720810376055). *Human Factors*, 52(3), 381-410.

[S3] SKYbrary Aviation Safety. (n.d.). [Mode Confusion Analysis](https://skybrary.aero/articles/cockpit-automation-advantages-and-safety-challenges). Retrieved April 2026.

[S4] [Methods for Preventing the Degradation of Manual Flying Skills in an Automated Cockpit Environment](https://ojs.library.okstate.edu/osu/index.php/CARI/article/view/10345). *The Collegiate Aviation Review International*.

[S5] Lee, J., et al. (2017). [Effects of Automation for Emergency Operating Procedures on Human Performance in a Nuclear Power Plant](https://pmc.ncbi.nlm.nih.gov/articles/PMC8300853/). *Frontiers in Psychology*.

[S6] Radiological Society of North America. (2024, November). [Incorrect AI Advice Influences Diagnostic Decisions](https://www.rsna.org/news/2024/november/ai-influences-diagnostic-decisions). *RSNA News*.

[S7] Radiological Society of North America. (2023, May). [AI Bias May Impair Radiologist Accuracy on Mammogram](https://www.rsna.org/news/2023/may/ai-bias-may-impair-accuracy). *RSNA News*.

[S8] [Automation Bias in Large Language Model Assisted Diagnostic Reasoning Among AI-Trained Physicians](https://www.medrxiv.org/content/10.1101/2025.08.23.25334280v1). *medRxiv* preprint, 2025.

[S9] [Levels of Automation for a Computer-Based Procedure for Simulated Nuclear Power Plant Operation](https://www.mdpi.com/2313-576X/11/1/22). *MDPI*, 2025.

[S10] Bourrelly, A., et al. (2020). [Predicting takeover response to silent automated vehicle failures](https://pmc.ncbi.nlm.nih.gov/articles/PMC7703974/). *PLOS ONE*, 15(11).

[S11] Manzey, D., Bahner, J. E., & Hueper, A. D. (2008). [Misuse of automated decision aids: Complacency, automation bias and the impact of training experience](https://www.sciencedirect.com/science/article/abs/pii/S1071581908000724). *International Journal of Human-Computer Studies*, 66(9), 688-699.

[S12] Lee, J. D., & See, K. A. (2004). [Trust in automation: Designing for appropriate reliance](https://journals.sagepub.com/doi/10.1518/hfes.46.1.50_30392). *Human Factors*, 46(1), 50-80.

[S13] Endsley, M. R., & Kiris, E. O. (1995). [The Out-of-the-Loop Performance Problem and Level of Control in Automation](https://journals.sagepub.com/doi/10.1518/001872095779064555). *Human Factors*, 37(2), 381-394.

[S14] [Cockpit Automation - Advantages and Safety Challenges](https://skybrary.aero/articles/cockpit-automation-advantages-and-safety-challenges). *SKYbrary Aviation Safety*. Retrieved April 2026.

[S15] Mosier, K. L., Skitka, L. J., Burdick, M. D., & Heers, S. T. (1996). [Automation Bias, Accountability, and Verification Behaviors](https://journals.sagepub.com/doi/10.1177/154193129604000413). *Proceedings of the Human Factors and Ergonomics Society Annual Meeting*, 40(4), 238-242.

[S16] Croskerry, P., Singhal, G., & Mamede, S. (2013). [Cognitive debiasing 2: impediments to and strategies for change](https://pmc.ncbi.nlm.nih.gov/articles/PMC3786644/). *BMJ Quality & Safety*, 22(Suppl 2), ii65-ii72.

[S17] Sherbino, J., et al. (2014). [Ineffectiveness of cognitive forcing strategies to reduce biases in diagnostic reasoning: a controlled trial](https://pubmed.ncbi.nlm.nih.gov/24423999/). *Canadian Journal of Emergency Medicine*, 16(1), 34-40.

[S18] de Visser, E., et al. (2013). [Counteracting skill decay: four refresher interventions and their effect on skill and knowledge retention](https://pubmed.ncbi.nlm.nih.gov/24382262/). *Ergonomics*, 57(3), 310-321.

[S19] Moore, M. J., & Risko, E. F. (2024). [Does using artificial intelligence assistance accelerate skill decay and hinder skill development without performers' awareness?](https://pmc.ncbi.nlm.nih.gov/articles/PMC11239631/). *Cognitive Research: Principles and Implications*, 9(1).

[S20] [Performance and Metacognition Disconnect when Reasoning in Human-AI Interaction](https://arxiv.org/abs/2409.16708). *arXiv* preprint arXiv:2409.16708, 2024.

[S21] [AI is changing the Dunning-Kruger Effect, with higher AI literacy correlating with overestimation of competence](https://realkm.com/2025/11/19/ai-is-changing-the-dunning-kruger-effect-with-higher-ai-literacy-correlating-with-overestimation-of-competence/). *RealKM*, 2025.

[S22] [Beyond the Steeper Curve: AI-Mediated Metacognitive Decoupling and the Limits of the Dunning-Kruger Metaphor](https://arxiv.org/abs/2603.29681). *arXiv* preprint arXiv:2603.29681, 2026.

[S23] [Knowing (Not) to Know: Explainable Artificial Intelligence and Human Metacognition](https://pubsonline.informs.org/doi/10.1287/isre.2024.1431). *Information Systems Research*, 2024.

[S24] [Metacognitive sensitivity: The key to calibrating trust and optimal decision making with AI](https://pmc.ncbi.nlm.nih.gov/articles/PMC12103939/). *PLOS ONE*, 2025.

[S25] [Beyond Accuracy: How AI Metacognitive Sensitivity improves AI-assisted Decision Making](https://arxiv.org/abs/2507.22365). *arXiv* preprint arXiv:2507.22365, 2025.

[S26] Park, S., et al. (2025). [Generative AI in Human-AI Collaboration: Validation of the Collaborative AI Literacy and Collaborative AI Metacognition Scales](https://www.tandfonline.com/doi/full/10.1080/10447318.2025.2543997). *International Journal of Human-Computer Interaction*.

[S27] Shi, L., et al. (2025). [Learning Behaviors Mediate the Effect of AI-powered Support for Metacognitive Calibration on Learning Outcomes](https://dl.acm.org/doi/10.1145/3706598.3713960). *Proceedings of the 2025 CHI Conference*.

[S28] Lichtenstein, S., & Fischhoff, B. (1980). [Training to Improve Calibration and Discrimination](https://pubmed.ncbi.nlm.nih.gov/11056072/). *Organizational Behavior and Human Performance*, 26(2), 149-171.

[S29] Ericsson, K. A. (2008). [Deliberate practice and acquisition of expert performance](https://pubmed.ncbi.nlm.nih.gov/18778378/). *Academic Medicine*, 83(10), S70-S81.

[S30] [Understanding Model Calibration - Expected Calibration Error (ECE)](https://iclr-blogposts.github.io/2025/blog/calibration/). *ICLR Blogposts*, 2025.

[S31] [Knowing When You Don't Know: AI Engineering in an Uncertain World](https://www.sei.cmu.edu/library/knowing-when-you-dont-know-ai-engineering-in-an-uncertain-world/). *SEI Carnegie Mellon*, 2025.

[S32] [Calibration Checks: Brier Score and Reliability Diagrams](https://www.statstest.com/calibration-checks-brier-score-reliability-diagrams). *StatsTest Blog*, 2025.

[S33] Maniscalco, B., & Lau, H. (2012). [A signal detection theoretic approach for estimating metacognitive sensitivity from confidence ratings](https://pubmed.ncbi.nlm.nih.gov/22071269/). *Consciousness and Cognition*, 21(1), 422-430.

[S34] Akash, K., et al. (2021). [Measurement of Trust in Automation: A Narrative Review and Reference Guide](https://pmc.ncbi.nlm.nih.gov/articles/PMC8562383/). *Frontiers in Psychology*, 12, 604977.

[S35] Endsley, M. R., et al. (1998). [A Comparative Analysis of SAGAT and SART for Evaluations of Situation Awareness](https://journals.sagepub.com/doi/abs/10.1177/154193129804200119). *Proceedings of the Human Factors and Ergonomics Society Annual Meeting*, 42(1), 82-86.

[S36] [Expert/Novice differences in Diagnostic Medical Cognition](https://users.sussex.ac.uk/~bend/papers/csrp508.pdf). *University of Sussex Cognitive Science Research Paper*, CSRP 508.

[S37] Klein, G. (2008). [Recognition-Primed Decision Making](https://www.decisionskills.com/rpd.html). *Decision Skills*.

[S38] Schemmer, M., et al. (2023). [Appropriate Reliance on AI Advice: Conceptualization and the Effect of Explanations](https://dl.acm.org/doi/fullHtml/10.1145/3581641.3584066). *Proceedings of the 28th International Conference on Intelligent User Interfaces*, 410-422.
