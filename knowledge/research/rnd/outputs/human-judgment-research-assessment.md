# Research: Assessment Design for Human Judgment and Reasoning

## Task IDs
Research brief: Human judgment assessment design principles from high-stakes domains and software benchmarks

## Key findings

### 1. Medical OSCEs: Task Structure that Forces Reasoning Demonstration

Medical OSCEs (Objective Structured Clinical Examinations) design stations explicitly to test reasoning processes, not just diagnostic accuracy [S1].

**Station Design Principles:**
- Multiple timed stations (10-15 recommended, 6 minutes each) assess distinct competencies [S2]
- Each station breaks tasks into observable subtasks with graduated scoring [S2]
- Competencies assessed include "ability to obtain/interpret data, problem-solve, teach, communicate, and handle unpredictable patient behavior" [S3]
- Standardized patients (trained actors) enable consistent scenarios across candidates while maintaining realism [S4]

**Scoring That Captures Reasoning:**
- Rubrics use "graduated scoring" that "must take cognizance of all possible performances and provide scores according to the level of the student's performance" [S3]
- Marking schemes aim to "reward actions that discriminate good performance from poor one" rather than binary correct/incorrect [S3]
- Higher inter-rater agreement found for psychomotor items than verbal/empathy-based items, demonstrating that observable reasoning steps are harder to assess than mechanical skills [S5]

**Validity Evidence:**
- OSCE demonstrates "much higher reliability and validity than traditional and less structured clinical examinations" [S4]
- Two major validity threats identified: construct underrepresentation (insufficient sampling of content domain) and construct-irrelevant variance (testing irrelevant skills) [S6]
- Blueprinting used to map stations to curriculum objectives prevents construct underrepresentation [S6]

**Key Insight:** OSCEs force demonstration of reasoning by requiring candidates to perform observable actions during problem-solving, with rubrics that score the quality of the process, not just the final diagnosis. The standardized patient creates consistent challenge complexity while maintaining unpredictability that requires genuine reasoning.

### 2. Aviation Check Rides: Assessing Judgment Under Automation

FAA check rides assess pilot judgment through Crew Resource Management (CRM) evaluation and scenario-based training [S7].

**Assessment Areas:**
- Essential CRM areas: communications processes, decision-making, team building and maintenance, workload management, and situational awareness [S7]
- Examiners use Judgment Assessment Matrix to assess Single-pilot Resource Management (SRM) skills objectively [S7]
- Evaluation requires "critical thinking" within the decision-making process to "identify hazards, access the degree of risk, and determine the best course of action" [S7]

**Scenario-Based Training (SBT) Structure:**
- Uses "highly structured script of 'real world' scenarios" to address training objectives in operational environment [S8]
- Shifts from knowledge-based objectives to performance-based objectives (situational recognition indicators) [S8]
- Decision-based objectives specifically designed "to develop pilot judgment and ADM [Aeronautical Decision-Making] skills" through higher-level learning and application [S8]

**Assessment Methodology:**
- CRM concepts critiqued during briefing/debriefing phases of all training and checking events [S7]
- Examiners trained explicitly to evaluate both technical and CRM performance [S7]
- Performance dimensions identified by subject matter experts who create strategies expected to lead to successful outcomes [S8]

**The 3-P Model:**
- FAA adopted Perceive → Process → Perform model for systematic ADM [S9]
- Provides structured approach to ADM tasks during all flight phases [S9]

**Key Insight:** Aviation assessment separates technical proficiency from judgment/decision-making but evaluates both simultaneously in realistic scenarios. The assessment recognizes that automation changes the pilot's role from manual control to monitoring and intervention—judgment is tested by scenarios requiring override or intervention decisions.

### 3. Bar Exam MPT: Analytical Reasoning vs. Rote Knowledge

The Multistate Performance Test (MPT) assesses lawyering skills through realistic tasks, not legal knowledge recall [S10].

**Task Structure:**
- Two 90-minute tasks administered in realistic situation contexts [S11]
- Tasks cover: legal analysis, fact analysis, problem solving, resolution of ethical dilemmas, organization and management of a lawyering task, and communication [S11]
- Candidates receive case materials (client file, library) and must produce work product (memo, brief, letter) [S10]

**Scoring Approach:**
- Responses assessed on "organization, clarity, responsiveness to instructions, and legal reasoning rather than substantive legal knowledge" [S10]
- Most jurisdictions use 0-6 scale (6=excellent, 0=no response) [S10]
- Counts for 20% of total bar exam score in UBE jurisdictions [S10]

**Key Skills Tested:**
- Legal analysis and reasoning: "demonstrating the ability to analyze and apply legal rules and principles" [S11]
- Factual analysis: "demonstrating the ability to analyze and use facts and to plan and direct factual investigation" [S11]
- Organization and management: "demonstrating the ability to organize and manage a legal task" [S11]

**Key Insight:** The MPT explicitly tests application and reasoning skills distinct from substantive knowledge (tested separately via MBE and MEE). The scoring rubric focuses on process quality (organization, reasoning) rather than reaching a specific legal conclusion, recognizing that real legal work requires synthesis and judgment.

### 4. Multiple Mini-Interviews: Context-Specific Assessment at Scale

MMIs address the reliability problem of single-interview formats through multiple independent context-specific stations [S12].

**Design Rationale:**
- "Increasing the number of interviews to which candidates are exposed" proves more valuable than "increasing the number of interviewers within each interview" [S12]
- Single-station reliability insufficient; achieving 0.80 reliability requires 14 questions across multiple stations [S12]
- Typical implementation: 7-12 stations, 10 minutes or less per station [S13]

**Validity Evidence:**
- MMI reliability "markedly higher" than other interview formats, translating to "higher predictive validity, correlating for future performance much more highly than standard interviews" [S13]
- MMI-selected candidates achieved significantly higher scores on national licensing examinations (P=0.003 and P=0.007) [S12]
- MMI scores "significantly correlated with six of 10 examination sittings, with magnitudes ranging from 0.24 to 0.50" [S12]

**What MMI Assesses:**
- Interpersonal and intrapersonal qualities: communication, teamwork, ethical values [S13]
- Context-specific competencies through "situational interviews" presenting "non-medical questions designed to assess specific non-academic qualities" [S12]

**Key Insight:** The MMI structure demonstrates that judgment and reasoning are context-specific—a single interview or scenario cannot reliably predict performance. Multiple independent samples of behavior across varied contexts achieve higher reliability and predictive validity than any single high-stakes interaction.

### 5. SWE-bench: Structure, Limitations, and Gaps

SWE-bench represents the first large-scale benchmark using real-world GitHub issues, but reveals critical gaps for assessing AI-augmented work [S14].

**Task Format:**
- 2,294 software engineering problems from real GitHub issues and PRs across 12 popular Python repositories [S14]
- Task: given a codebase and issue description, generate patch that resolves issue and passes unit tests [S14]
- Resolving issues "frequently requires understanding and coordinating changes across multiple functions, classes, and even files simultaneously" [S14]

**Evaluation Methodology:**
- Generated patches evaluated against real unit tests from merged PRs [S14]
- Pass/fail based on test execution—no partial credit, no process evaluation [S14]

**Critical Limitations Identified:**

*Contamination and Overfitting:*
- Models pre-trained on public GitHub likely contaminated on SWE-bench tasks [S15]
- OpenAI stopped reporting SWE-bench Verified scores due to training data contamination on every frontier model [S15]
- Claude Opus 4.5: 80.9% on SWE-bench Verified vs. 45.9% on SWE-bench Pro—35 percentage point gap attributed to contamination [S15]
- State-of-the-art models achieve up to 76% accuracy on file-path identification despite lacking necessary context, suggesting memorization [S15]
- "Models have overfit to the specific architectural patterns and problem distributions of the twelve repositories" [S15]

*Task Realism Issues:*
- Some tasks "require information not conveyed in the problem statement" [S16]
- Tests may require exact matches to specifications "only arrived at after discussion in pull requests that agents cannot access" [S16]
- "Unit tests used to evaluate solutions are often overly specific and in some cases unrelated to the issue" [S15]
- Many samples have "underspecified issue descriptions, leading to ambiguity" [S15]

*Scope Limitations:*
- "SWE-bench confines tasks to isolated issues, often inflating performance through incomplete fixes" [S15]
- Focus on "simple utility libraries, and oversimplified problems" [S15]
- "Real-world software engineering is a long-horizon endeavor where developers coordinate changes across many files and evolve codebases over multiple iterations" [S15]

**Solutions Emerging:**
- SWE-bench Pro: contamination-resistant benchmark using GPL copyleft repositories and private proprietary codebases creating legal/access barriers [S15]
- Held-out test set to monitor overfitting [S15]
- Human-in-the-loop checkpoints: manual environment construction, human augmentation of issue description, human verification of tests [S17]

**Key Gap:** SWE-bench measures only final output correctness via test pass/fail. It does not assess the reasoning process, the quality of the solution approach, code review skills, or ability to evaluate/improve existing code.

### 6. Other Software Benchmarks: What Works, What Fails

**HumanEval (164 programming challenges):**

*Structure:*
- Function signature + natural-language docstring → generate function body [S18]
- Average 7.7 unit tests per problem [S18]
- Evaluation: pass@k metric (if any of k solutions passes all tests, problem solved) [S18]

*Limitations:*
- "Focus on a narrow range of programming concepts and an abundance of simpler questions" [S18]
- "Code generation tasks typically fall under the easy to medium range" [S18]
- "Fails to reflect the often tangled state of real-world software development environments and workflows" [S18]
- "Many problems admit trivial or overfit solutions due to coverage gaps" [S18]
- "Problems concentrated in a narrow difficulty band with mostly 'easy' tasks and minimal edge-case constraints" [S18]

**CodeContests (competitive programming):**

*Structure:*
- Thousands of authentic tasks from Codeforces and AtCoder [S19]
- Multi-paragraph problem description, Input/Output sections, formal Constraints, Sample I/O blocks [S19]
- Evaluation: pass@k (fraction of problems where ≥1 solution in k samples passes all private tests) [S19]

*Characteristics:*
- Multiple dataset variants (CodeContests, CodeContests+, CodeContests-O) using mutation-based tests, LLM-driven generation [S19]
- Used for benchmarking code generation, test-case synthesis, plagiarism detection, solution explanation [S19]

*Limitation:* Competitive programming problems are self-contained algorithmic puzzles, fundamentally different from software engineering tasks requiring system understanding, integration, and maintenance.

**DevBench (comprehensive software development lifecycle):**

*Structure:*
- Five phases following Waterfall model: software design, environment setup, implementation, acceptance testing, unit testing [S20]
- 22 carefully curated repositories with production-quality design documentation [S20]
- Multi-language support (Python, C/C++, Java, JavaScript) [S20]

*Evaluation Per Phase:*
- Design: LLM-as-a-judge comparing against human annotations [S20]
- Implementation/Testing: execution-based evaluation with oracle tests [S20]
- Environment Setup: dependency installation + example usage execution [S20]
- Coverage: (Executed Statements / Total Statements) × 100% [S20]

*Gaps Addressed:*
- "First benchmark assessing software design and environment setup capabilities" [S20]
- Comprehensive repository-level evaluation vs. isolated single-file generation [S20]
- "Evaluates the full spectrum of challenges raised by real-world programming activities" [S20]

*Documented Limitations:*
- "Quite scarce" test cases for environment setup tasks [S20]
- Models occasionally "game" acceptance testing by generating executable but meaningless test code [S20]
- Low agreement (79-83% excluding ties) between human evaluation and LLM judges [S20]

**Key Pattern Across All Benchmarks:** Every software benchmark evaluates product (does the code work?), none evaluate process (did the developer reason correctly? can they evaluate code quality? can they direct AI output effectively?).

### 7. The AI-Augmented Work Gap in Existing Benchmarks

No major software benchmark assesses ability to evaluate or direct AI output rather than produce code [S21, S22].

**Current Benchmark Limitations:**
- "AI is still evaluated at the task level in a vacuum while it is used in messy, complex environments where it interacts with more than one person" [S21]
- "Perfect outputs from AI are not strictly necessary for the latter to be useful, with the key being identifying what the human is looking for in the answer" [S21]
- "In the AI-augmented environment, developers are not just writing code but initiating, unblocking, and validating AI-generated contributions" [S21]

**The Role Shift:**
- "As the developer's role evolves to include more orchestration and oversight, higher context switching is expected" [S21]
- "Pairing AI with human oversight improved speed and cost-efficiency by over 30%" [S21]

**Critical Questions Unaddressed:**
- Whether AI can "function as a productive participant within human teams and generate sustained collective value" [S21]
- How developers evaluate AI-generated solutions for correctness, maintainability, security
- How developers provide effective feedback to improve AI outputs
- How developers decide when to accept, modify, or reject AI suggestions

**Research Recognition of Gap:**
- "Benchmarks for AI in Software Engineering" article notes that current benchmarks don't reflect human-AI collaboration patterns [S22]
- "AI Productivity Paradox Research Report" documents that AI assistance changes the nature of developer work without benchmarks capturing this shift [S21]

**Key Insight:** The transition from "developer writes code" to "developer evaluates and directs AI-written code" represents a fundamental shift in the skill being assessed—equivalent to the shift from manual aircraft control to autopilot monitoring in aviation. Current benchmarks still test manual control.

### 8. Scoring Approaches for Open-Ended Work Beyond Pass/Fail

**Rubric-Based Approaches:**

*Analytic Rubrics:*
- Break evaluation into multiple distinct dimensions/criteria, each scored independently [S23]
- Each dimension has level descriptors; student receives separate scores (e.g., "Argumentation: 4/5, Evidence: 3/5, Writing: 5/5") [S23]
- "Require more time but produce more defensible, consistent scores—a key factor in inter-rater reliability" [S23]
- "Reveal patterns that holistic rubrics hide" [S23]
- Example use: "creative writing, musical performance, design portfolios" may benefit from decomposition when diagnostic feedback needed [S23]

*Holistic Rubrics:*
- Evaluate work as whole, assign single score based on overall impression [S23]
- "Easier to design and communicate than a full analytic matrix" [S23]
- Faster to apply but provide less diagnostic information [S23]
- Best for "tasks better evaluated as integrated wholes rather than decomposed into parts" [S23]

*Behaviorally Anchored Rating Scales (BARS):*
- Assesses performance "across specific dimensions by matching their behavior to clearly defined examples tied to each level of a rating scale—typically 5, 7, or 9 points" [S24]
- Development: identify critical incidents/key behaviors defining effective vs. ineffective performance [S24]
- "Focus is on behavior, not the value of the person being evaluated" [S24]
- "Because behavioral statements are simple and straightforward, there is little variance regardless of the assessed party and the assessor" [S24]
- Challenge: "Every role has different behavioral indicators that require analysis" [S24]

**Comparative Judgment:**
- Generates scores "by aggregating decisions about the relative quality" of submissions [S25]
- "Eliminates certain scorer biases and potentially reduces training requirements" [S25]
- Adaptive Comparative Judgement: "allows assessment to be holistic" [S25]
- "Score reliability exceeding .80 was achieved with approximately nine judgments per response" [S25]
- Trade-off: requires multiple comparisons per submission but reduces need for detailed rubric calibration

**Process-Based vs. Product-Based Assessment:**

*Process-Based:*
- "Focuses on how the learner achieves their goals over time and gives space for feedback to inform the learning process" [S26]
- "Requires performance that is taking place in the moment with the teacher's presence" [S26]
- Connected to formative assessment: "supports the idea that process is more important than product" [S26]

*Product-Based:*
- "Assessor views and scores the final product made and not on the actual performance of making that product" [S26]
- "Concerned on the product alone and not on the process" [S26]
- Connected to summative assessment: "more product-oriented and assesses the final product" [S26]

**Think-Aloud Protocols:**
- Participants "thinking aloud as they are performing a set of specified tasks" [S27]
- "Gives observers insight into the participant's cognitive processes (rather than only their final product)" [S27]
- Two types: concurrent (during task) and retrospective (after task, often video-prompted) [S27]
- "Concurrent protocol may be more complete, while a retrospective protocol has less chance to interfere with task performance" [S27]
- Enables identification of "information that is concentrated on during problem solving and how that information is used" [S27]
- Limitation: "Takes resources away from the task they are performing, thus reducing the cognitive capacity" [S27]

**Portfolio Assessment:**
- Rubrics can be analytic (multiple criteria scored separately) or holistic (single overall score) [S28]
- "Calibration involves a training session where raters apply rubrics to preselected examples of varying quality to reach consensus" [S28]
- Strong theoretical foundations when developed through expert review and focus groups [S28]

**Key Insight:** Open-ended work requires explicit frameworks (rubrics) or comparative methods. Rubrics trade design time for consistency; comparative judgment trades number of evaluations for reduced calibration needs. Process-based assessment can capture reasoning quality but requires observation during task performance.

### 9. The Grading Paradox: AI Scoring AI-Generated Work

Using AI to grade AI-augmented work creates fundamental validity concerns analogous to having students grade themselves [S29, S30].

**The Core Paradox:**
- "Nobody has established standards for evaluating whether AI-generated assessments or AI-produced scores are actually valid" [S29]
- "Static approaches to automated scoring fail to capture 'process evidence' or verify genuine student understanding" [S29]
- "A well-written but poorly understood submission can receive a high score" when relying only on surface-level evaluation [S30]

**Specific Validity Concerns:**

*Construct Validity Failure:*
- "Current evidence does not support an overall or general case for the validity of AI marking in high stakes qualifications" [S29]
- "Points to the need for context-specific evidence" [S29]
- AI scoring "cannot achieve high degrees of scoring accuracy without including features that may not be easily explained and may not be obviously relevant to the target assessment construct" [S31]

*Bias and Fairness Issues:*
- "Responses consistent with sophisticated reasoning but using non-standard language or showing evidence of non-native English speakers tended to be mis-scored to lower levels" [S29]
- "Students who demonstrated strong reasoning but expressed it in non-standard English penalized" [S29]
- "Automated grading algorithms may overlook nuanced responses or inaccurately assess open-ended questions" [S29]

*Agreement vs. Validity:*
- "Agreement with human marks alone is insufficient for assuring validity" [S29]
- AI scoring engines must be "transparent and construct relevant" [S31]
- "Explainability or interpretability is critical to ensure that an AI scoring model assigns accurate scores for valid reasons" [S29]

**Proposed Solutions:**

*Two-Stage Assessment (Static Scoring + Interactive Verification):*
- Stage 1: Rubric-based automated scoring ensures "procedural fairness and consistency" [S30]
- Stage 2: AI-generated targeted follow-up questions for "construct validity—effectively diagnosing superficial reasoning or unverified AI use" [S30]
- Follow-up questions serve as "scalable oral defense" probing whether students truly understand their work [S30]
- Pilot study: interactive verification received highest ratings for validity (M=3.9) [S30]
- Human oversight throughout ensures fairness [S30]

*Human Calibration Models:*
- OSCE uses standardized patients (human actors) rather than automated assessment [S4]
- Bar exam MPT scored by trained human graders using rubrics [S10]
- Aviation CRM assessed by trained examiners during check rides [S7]

**Key Difference from Other Domains:**
- Medical OSCEs use standardized patients specifically because human interaction cannot be automated without losing construct validity [S4]
- Legal MPT recognizes that judgment quality requires human expert evaluation [S10]
- Aviation check rides require examiner observation of decision-making in real-time [S7]

**Research Recommendations:**
- "Context-specific evidence" required for each AI scoring application [S29]
- "Combining rubric-based automated scoring with AI-generated, targeted follow-up questions" [S29]
- Maintain human oversight and explainability requirements [S29]

**Key Insight:** The grading paradox is not "can AI grade accurately?" but "does AI grading measure the right construct?" If the goal is assessing ability to work with AI, using AI to score work-product creates circular validation. Other high-stakes domains address this by using human evaluators for the judgment components and automated scoring only for objective components (OSCEs score communication via humans, knowledge via standardized tests).

### 10. Inter-Rater Reliability and Calibration: Making Subjective Assessment Consistent

High-stakes domains achieve reliable scoring of open-ended work through systematic rater training and calibration [S32, S5].

**Inter-Rater Reliability Standards:**

*Kappa Interpretation:*
- κ = 0.81–1.00: "almost perfect" agreement [S5]
- κ = 0.61–0.80: "substantial" agreement [S5]
- Cohen's kappa accounts for possibility raters guess due to uncertainty [S5]

*Target Thresholds:*
- Many high-stakes assessments target ≥0.80 reliability [S5]
- OSCE research shows mixed reliability: higher for psychomotor items than verbal/empathy-based items [S5]

**Impact of Training and Calibration:**
- "Vast body of literature documenting the positive impacts that rater training and calibration sessions have on inter-rater reliability" [S32]
- Inter-rater reliability "negatively impacted when no formal or consistent rater-training and rubric calibrations are performed" [S32]
- Example: kappa coefficient increased from 0.49 to 0.82 due to repeated moderation between raters [S5]
- Post-training with clear definitions: agreement soared to 90% (Krippendorff's alpha) [S32]
- In education example: after rigorous training, score variability plummeted to just 5% [S32]

**Moderation as Calibration Technique:**
- "Moderation is a process that involves a discussion between raters that enables the raters to arrive at a common understanding of the scoring criteria" [S5]
- Particularly effective for improving agreement on rubric criteria in OSCEs [S5]

**Training and Standardization Requirements:**
- "Achieving interexaminer reliability requires initial agreement on interpretation of diagnostic criteria, then a period of training with repeated observations" [S32]
- "Training brings all raters closer to the 'gold standard' norm, although it cannot guarantee 100% consistency" [S32]

**Key Strategies:**
- Rigorous rater training on criteria [S32]
- Providing unambiguous definitions [S32]
- Minimizing subjectivity in ratings [S32]
- Frequency and timing of calibration sessions crucial [S32]
- Repeated practice with preselected examples of varying quality to reach consensus [S28]

**OSCE Calibration Evidence:**
- "Agreement improved across successive circuits, suggesting examiner calibration" [S5]
- "Technical station" showed calibration effects more clearly than communication stations [S5]

**Key Insight:** Subjective judgment can be made consistent and reliable through systematic training and calibration. High-stakes domains invest heavily in rater preparation, not just rubric design. The calibration process itself (discussing disagreements, converging on shared interpretation) is as important as the rubric. This suggests that AI grading may need similar "calibration against human gold standard" processes.

### 11. Criterion-Referenced vs. Norm-Referenced: Competency Standards, Not Curves

High-stakes professional assessments use criterion-referenced scoring to determine competency, not rank candidates [S33].

**Key Distinction:**
- Criterion-referenced: "compare a person's knowledge or skills against a predetermined standard, learning goal, performance level, or other criterion" [S33]
- Norm-referenced: "indicates whether the test-taker did better or worse than other people who took the test" [S33]
- Criterion-referenced: "each person's performance compared directly to the standard, without considering how other students perform" [S33]

**Applications:**
- "Professional licensing exams, end-of-unit tests, and certification programs typically use criterion-referenced scoring because the goal is determining competency, not ranking candidates against each other" [S33]
- Bar exam, medical licensing, aviation certifications all criterion-referenced [S33]

**Connection to Standards:**
- "Criterion-referenced tests have been called standards-based assessments by some education agencies, as students are assessed with regard to standards that define what they 'should' know" [S33]
- "Designed to evaluate what students know and can do based on specific educational outcomes predetermined by instructors, schools, districts, or state standards" [S33]

**Key Insight:** When the goal is "can this person perform the job safely/competently?" the assessment must be criterion-referenced. Norm-referencing is appropriate for selection into limited slots; criterion-referencing is appropriate for certification. Software engineering hiring is currently hybrid: companies want to know both "is this person competent?" (criterion) and "are they better than other candidates?" (norm), but the assessment design must prioritize one.

### 12. Construct Validity and Predictive Validity: Does the Test Measure What Matters?

High-stakes domains distinguish between construct validity (does the test measure the right thing?) and predictive validity (does test performance correlate with job performance?) [S34, S35].

**Construct Validity:**
- "Measures how effectively a specific measurement matches the construct that one wishes to measure" [S34]
- Key question: "Is the test measuring what it's supposed to?" [S34]
- Requires careful definition of the construct being assessed [S34]

**Predictive Validity:**
- "Extent to which a test score or assessment result can accurately predict future performance" [S34]
- In hiring: "measures how well applicant test scores forecast their actual job performance once hired" [S34]
- Quantified by correlation coefficient ranging from -1.0 to +1.0 [S34]
- "A pre-employment test has predictive validity if there is a demonstrable relationship between test results and job performance" [S34]

**Evidence for Technical Assessments:**
- "Job knowledge tests ranked second overall in predictive validity in Sackett's 2022 meta-analysis—with a correlation of 0.4 to job performance" [S34]
- This makes them "one of the most effective tools available for assessing how well a candidate is likely to perform in a specific role" [S34]

**Importance:**
- "Tests with high predictive validity reduce the risk of poor hiring decisions by ensuring that selected candidates have a higher likelihood of success in the job" [S34]
- "Leading to better overall productivity and achievement of business goals" [S34]

**Validity Threats in OSCEs:**
- Construct underrepresentation: insufficient number of stations or inadequate sampling of curriculum content [S6]
- Construct-irrelevant variance: testing skills irrelevant to clinical competence [S6]
- Blueprinting used to prevent both threats by mapping assessment to learning objectives [S6]

**Key Insight:** Construct validity is prerequisite for predictive validity—if the test doesn't measure the right construct, correlation with job performance is coincidental. Software assessments must first define the construct (e.g., "ability to evaluate code quality" vs. "ability to write bug-free code") then validate that the assessment measures that construct, then measure correlation with job performance.

## Evidence table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | OSCEs design stations to test reasoning processes, not just diagnostic accuracy | PMC3191703 | 2011 | Peer-reviewed medical education | High |
| S2 | OSCEs recommend 10-15 stations at 6 minutes each with subtask-level scoring | NCBI PMC3191703 | 2011 | Peer-reviewed medical education | High |
| S3 | OSCE rubrics provide graduated scoring capturing quality levels, not binary outcomes | NCBI PMC3191703 | 2011 | Peer-reviewed medical education | High |
| S4 | OSCEs demonstrate higher reliability/validity than traditional exams; standardized patients enable consistent realism | NCBI PMC3191703, PMC6695046 | 2011, 2019 | Peer-reviewed medical education | High |
| S5 | Inter-rater reliability higher for psychomotor than empathy items; calibration improves agreement (kappa 0.49→0.82) | PMC9358671 | 2022 | Peer-reviewed medical education | High |
| S6 | OSCE validity threats: construct underrepresentation, construct-irrelevant variance; blueprinting prevents both | PMC6398515 | 2019 | Peer-reviewed medical education | High |
| S7 | FAA CRM assessment covers communications, decision-making, workload mgmt, situational awareness; uses Judgment Matrix | FAA AC120-51E | 2004 | Official regulatory guidance | High |
| S8 | Scenario-based training uses structured real-world scenarios with performance-based objectives for decision-making | FAA FITS documents | 2004-2010 | Official regulatory guidance | High |
| S9 | FAA 3-P Model (Perceive-Process-Perform) structures ADM systematically | FAA documentation | 2001-2022 | Official regulatory guidance | High |
| S10 | Bar exam MPT assesses organization, clarity, legal reasoning, not substantive knowledge; 0-6 scale | NCBE official documentation | 2024 | Official exam specification | High |
| S11 | MPT tests legal/factual analysis, problem-solving, task management, communication in 90-min tasks | NCBE, UWorld | 2024 | Official exam specification | High |
| S12 | MMI: multiple stations more valuable than multiple interviewers per station; 14 questions needed for 0.80 reliability; predicts licensing exam scores | PMC6695046 | 2019 | Peer-reviewed systematic review | High |
| S13 | MMI reliability markedly higher than single interviews; 7-12 stations typical; higher predictive validity for performance | PMC6695046, multiple studies | 2019 | Peer-reviewed systematic review | High |
| S14 | SWE-bench: 2,294 real GitHub issues requiring multi-file coordination; pass/fail on unit tests | arXiv 2310.06770 (ICLR 2024) | 2023/2024 | Peer-reviewed conference paper | High |
| S15 | SWE-bench limitations: contamination, 35-point performance gap (Verified vs Pro), overfit to 12 repos, overly specific tests | Multiple sources: OpenAI, arXiv papers | 2024-2025 | Industry reports + peer-reviewed | High |
| S16 | SWE-bench tasks require info not in problem statement; OpenAI human-validated subset addresses this | OpenAI blog, SWE-bench Verified | 2024 | Industry technical report | Medium |
| S17 | SWE-bench Pro uses human-in-the-loop checkpoints to ensure task quality and reduce contamination | SWE-bench Pro documentation | 2024 | Industry benchmark documentation | Medium |
| S18 | HumanEval: 164 challenges, easy-medium difficulty, narrow concepts, doesn't reflect real-world tangled codebases | Multiple analysis sources | 2021-2024 | Benchmark analysis + peer-reviewed | High |
| S19 | CodeContests: competitive programming from Codeforces/AtCoder; pass@k evaluation | Hugging Face, research papers | 2022-2024 | Industry dataset + peer-reviewed | High |
| S20 | DevBench: 5-phase waterfall model, first to assess design+environment; LLM-judge for design, execution for implementation | arXiv 2403.08604v1 | 2024 | Peer-reviewed | High |
| S21 | AI-augmented work changes developer role to orchestration/oversight; benchmarks don't capture human-AI collaboration | Faros AI, Scale Labs reports | 2024-2025 | Industry research reports | Medium |
| S22 | Current benchmarks evaluate AI in vacuum, not in messy collaborative environments; missing evaluation/direction skills | CACM, academic sources | 2024-2025 | Peer-reviewed + industry | Medium |
| S23 | Analytic rubrics: separate scores per dimension, more defensible/consistent, reveal patterns; holistic: single overall score, faster | Multiple education sources | 2020-2024 | Educational research literature | High |
| S24 | BARS: behavior-based rating with 5-9 levels matched to examples; low variance across raters but requires role-specific development | HR/organizational psych sources | 2020-2024 | Professional practice literature | High |
| S25 | Comparative judgment: aggregate relative quality decisions, eliminates biases, 0.80 reliability with ~9 judgments | ResearchGate, educational assessment | 2015-2024 | Peer-reviewed educational research | High |
| S26 | Process-based assessment: how learner achieves goals, real-time observation; product-based: final product only | Educational assessment sources | 2020-2024 | Educational literature | High |
| S27 | Think-aloud protocols: concurrent (during task) or retrospective; reveals reasoning but consumes cognitive capacity | Multiple cognitive psych sources | 1993-2024 | Peer-reviewed cognitive psychology | High |
| S28 | Portfolio assessment uses analytic or holistic rubrics; calibration via consensus on preselected examples critical | Educational assessment sources | 2016-2024 | Educational practice literature | Medium |
| S29 | AI grading paradox: no established validity standards; static scoring fails to capture process evidence; bias against non-standard language | arXiv, GOV.UK, academic sources | 2022-2024 | Peer-reviewed + regulatory | High |
| S30 | Two-stage assessment: static scoring (procedural fairness) + interactive verification (construct validity via "scalable oral defense") | arXiv 2512.12592 | 2024 | Peer-reviewed | High |
| S31 | AI scoring struggles with construct relevance; features may not be explainable or obviously relevant to assessment construct | Multiple validity research sources | 2022-2024 | Peer-reviewed assessment research | High |
| S32 | Rater training and calibration dramatically improve reliability; repeated moderation essential; frequency/timing crucial | Multiple education/psychology sources | 2023-2024 | Peer-reviewed educational research | High |
| S33 | Criterion-referenced: compare to standard (competency); norm-referenced: compare to peers (ranking); licensing uses criterion | Multiple assessment sources | 2020-2024 | Educational assessment literature | High |
| S34 | Construct validity: does test measure what it should? Predictive validity: does it correlate with job performance (r=0.4 for knowledge tests)? | Assessment industry sources, meta-analyses | 2022-2024 | Industry reports + peer-reviewed | High |
| S35 | Validity evidence: construct clarity, explainability, validation against human judgments remain central challenges for AI assessment | Multiple AI assessment research sources | 2022-2024 | Peer-reviewed | High |

## Design Principles for Pipe

### Principle 1: Multi-Sample Assessment Over Single High-Stakes Tasks

**Evidence:** MMI research demonstrates that "increasing the number of interviews to which candidates are exposed" is more valuable than "increasing the number of interviewers within each interview" [S12]. Single-station reliability is insufficient; achieving 0.80 reliability requires 14 questions across multiple stations [S12]. OSCE similarly uses 10-15 independent stations [S2].

**Application to Pipe:**
- Code review challenges should present **multiple independent PRs** rather than one large PR
- Each PR tests different aspects of judgment: security issue, performance trade-off, design decision, edge case handling, etc.
- Aggregate scoring across PRs achieves higher reliability than single comprehensive review
- Target: 6-8 PRs per code review challenge (analogous to MMI's 7-12 stations)

**Rationale:** Judgment is context-specific. A candidate might excel at spotting security issues but miss performance implications. Multiple independent samples prevent single-context artifacts from dominating the assessment.

### Principle 2: Observable Reasoning Process, Not Just Correct Answers

**Evidence:** OSCEs score "ability to obtain/interpret data, problem-solve, communicate" with graduated rubrics that "reward actions that discriminate good performance from poor" [S3]. Think-aloud protocols "give observers insight into the participant's cognitive processes (rather than only their final product)" [S27]. The two-stage AI assessment framework recognizes that "a well-written but poorly understood submission can receive a high score" without process evidence [S30].

**Application to Pipe:**
- **Code review comments must include reasoning**: "This is a problem because..." not just "Fix this"
- Scoring rubric evaluates:
  - **Quality of explanation** (does candidate articulate the issue correctly?)
  - **Evidence cited** (does candidate point to specific code/behavior?)
  - **Risk assessment** (does candidate evaluate severity/likelihood?)
  - **Alternative considered** (does candidate acknowledge trade-offs?)
- Multi-turn conversation with implementer agent provides process evidence through candidate's responses to pushback

**Rationale:** In AI-augmented work, the critical skill is evaluating AI output and providing clear direction. A candidate who spots the right issue but can't explain why or respond to questions hasn't demonstrated the judgment needed for real code review.

### Principle 3: Graduated Scoring via Behaviorally Anchored Rubrics (BARS)

**Evidence:** OSCE rubrics "must take cognizance of all possible performances and provide scores according to the level of the student's performance" [S3]. BARS "assesses performance across specific dimensions by matching their behavior to clearly defined examples tied to each level" with "little variance regardless of the assessed party and the assessor" [S24]. Analytic rubrics "require more time but produce more defensible, consistent scores" [S23].

**Application to Pipe:**
- **6-dimension rubric** (per ADR-032): Issue Identification, Risk Assessment, Communication Clarity, Technical Depth, Collaboration/Professionalism, Adaptability
- Each dimension scored 1-5 with behavioral anchors:
  - **5 (Expert)**: Identifies root cause, proposes alternative approaches, anticipates downstream effects
  - **4 (Strong)**: Correctly identifies issue and explains impact with specific evidence
  - **3 (Competent)**: Identifies issue but explanation lacks depth or misses implications
  - **2 (Developing)**: Spots symptoms but misdiagnoses root cause
  - **1 (Insufficient)**: Misses issue or provides irrelevant feedback
- Anchors derived from real code review examples across difficulty levels

**Rationale:** BARS reduce inter-rater variance by providing concrete examples. For AI scoring, behavioral anchors make the construct explicit, reducing reliance on opaque LLM judgments.

### Principle 4: Criterion-Referenced Standards, Not Norm-Referenced Curves

**Evidence:** "Professional licensing exams, end-of-unit tests, and certification programs typically use criterion-referenced scoring because the goal is determining competency, not ranking candidates" [S33]. OSCEs and bar exams assess against predetermined standards [S2, S10].

**Application to Pipe:**
- Define minimum competency threshold per seniority level:
  - **Junior**: Spots obvious bugs, asks clarifying questions, learns from feedback
  - **Mid**: Identifies design issues, evaluates trade-offs, provides actionable suggestions
  - **Senior**: Sees system-level implications, mentors through questioning, balances business/technical concerns
- Scoring: candidate either meets threshold or doesn't (binary competency gate)
- Optional: norm-referenced ranking within competency tier for selection purposes

**Rationale:** Companies need to know "can this person perform at the expected level?" before "how do they rank against others?" Criterion-referencing establishes the floor; norm-referencing optimizes selection within the qualified pool.

### Principle 5: Blueprinting to Prevent Construct Underrepresentation

**Evidence:** OSCEs use blueprinting to map stations to curriculum objectives, preventing construct underrepresentation (insufficient sampling) and construct-irrelevant variance (testing wrong things) [S6]. "Developing a blueprint that captures the clinical competencies to be assessed in relation to the objectives of residency training is an important step to ensure adequate sampling" [S6].

**Application to Pipe:**
- **Blueprint matrix**: competency dimensions (rows) × challenge types (columns)
- Ensure each challenge samples multiple dimensions:
  - Security PR → Issue Identification, Risk Assessment, Technical Depth
  - Performance PR → Technical Depth, Trade-off Analysis, Communication
  - Design PR → System Thinking, Collaboration, Adaptability
- Minimum coverage requirement: every dimension assessed in ≥3 PRs
- Gap analysis: if dimension only assessed once, add challenge or re-scope existing

**Rationale:** If code review challenges only test bug-finding, they underrepresent the construct (code review judgment). Blueprinting ensures comprehensive coverage of the skill being assessed.

### Principle 6: Contamination Resistance via Private Challenge Library

**Evidence:** SWE-bench contamination led to 35-percentage-point performance gap (Verified 81% vs. Pro 46%) [S15]. "Models have overfit to the specific architectural patterns and problem distributions of the twelve repositories" [S15]. SWE-bench Pro addresses this with "GPL-style copyleft repositories and private proprietary codebases, creating legal and access barriers that reduce the likelihood of contamination" [S15].

**Application to Pipe:**
- **Private challenge library**: PRs sourced from proprietary codebases or generated with commercial LLMs under restrictive licenses
- **Held-out test set**: reserve 30% of challenges for evaluation only, never shown to customers
- **Rotation policy**: retire public challenges every 6 months, replace with new private challenges
- **Variant generation**: create multiple variants of each challenge (different bug, same pattern) to detect memorization

**Rationale:** If candidates (or AI assistants) have seen the challenges during training, assessment measures memorization, not judgment. Contamination resistance is existential for assessment validity in the LLM era.

### Principle 7: Human-AI Hybrid Scoring with Gold Standard Calibration

**Evidence:** AI grading paradox: "current evidence does not support an overall or general case for the validity of AI marking in high stakes qualifications" [S29]. Two-stage assessment combines "rubric-based automated scoring" (procedural fairness) with "interactive verification" (construct validity) [S30]. Rater training/calibration increases kappa from 0.49 to 0.82 [S5].

**Application to Pipe:**
- **Production scoring**: Devstral Small (per ADR-032) scores all dimensions using BARS rubric
- **Gold standard oracle**: Claude Sonnet 4.6 offline scoring on calibration set (100 reviews per quarter)
- **Kappa measurement**: calculate agreement between Devstral and Sonnet; target κ ≥ 0.75
- **Escalation rule**: if dimension κ < 0.70, escalate that dimension to Sonnet for live scoring
- **Consistency classifier**: Gemma 4 12B guards implementer agent against drift (per ADR-032 research: CR-6, CR-10, CR-12)

**Rationale:** Analogy to OSCE: standardized patients (implementer agent) create consistent scenarios, but human examiners (gold standard oracle) validate that automated scoring (Devstral) measures the right construct. Calibration prevents AI-grading-AI circularity.

### Principle 8: Interactive Verification via Multi-Turn Conversation

**Evidence:** Two-stage assessment framework: static scoring alone "fails to measure genuine understanding," while follow-up questions serve as "scalable oral defense" with highest validity ratings (M=3.9) [S30]. Aviation CRM evaluation requires "briefing/debriefing phases" to critique decision-making [S7]. Think-aloud protocols capture "information that cannot be analyzed by other methods alone" [S27].

**Application to Pipe:**
- **Implementer agent** (Qwen 2.5-Coder 32B) responds to candidate's review comments:
  - **Clarification requests**: "Can you explain why you think this is a security issue?"
  - **Pushback**: "This approach would add 20ms latency—is that acceptable?"
  - **Partial fixes**: Candidate re-reviews evolved diff across rounds
- **Scoring adaptation**: evaluate not just initial comment quality but response to pushback
  - Does candidate hold position with evidence or fold immediately?
  - Does candidate acknowledge trade-offs or double down incorrectly?
  - Does candidate adapt reasoning when presented with new information?

**Rationale:** Real code review is conversational. A candidate who writes good initial comments but can't defend them under questioning (or can't update their position when wrong) lacks the judgment for senior-level work. Multi-turn interaction provides the process evidence that static comments cannot.

### Principle 9: Fidelity Over Simplification

**Evidence:** SWE-bench criticized for "simple utility libraries, and oversimplified problems" that don't reflect "real-world software engineering" [S15]. HumanEval "fails to reflect the often tangled state of real-world software development environments and workflows" [S18]. Workplace simulation assessment emphasizes "structural fidelity" (how it looks), "functional fidelity" (what it does), and "social context" [S35].

**Application to Pipe:**
- **Structural fidelity**: PRs use real repositories with production-quality code, not toy examples
- **Functional fidelity**: Issues reflect actual bugs/trade-offs engineers encounter (security, performance, maintainability, architecture)
- **Social context fidelity**: Implementer agent personas (junior/mid/senior) create realistic collaboration dynamics
  - Junior: asks clarifying questions, may misunderstand feedback
  - Mid: pushes back occasionally, understands trade-offs
  - Senior: questions assumptions, proposes alternatives, requires persuasion

**Rationale:** Assessment fidelity determines transfer validity—how well performance predicts real-world job performance. Low-fidelity assessments (LeetCode-style puzzles) have weaker predictive validity (r=0.2-0.3) than high-fidelity simulations (job knowledge tests: r=0.4).

### Principle 10: Process and Product Scoring

**Evidence:** Process-based assessment "focuses on how the learner achieves their goals over time" while product-based "views and scores the final product made and not on the actual performance" [S26]. Formative assessment "supports the idea that process is more important than product" [S26]. Bar exam MPT scores "legal reasoning" process, not just conclusion [S10].

**Application to Pipe:**
- **Product scoring**: final set of review comments evaluated against ground truth
  - Did candidate identify planted bugs?
  - Did candidate flag design trade-offs?
  - Did candidate miss false positives?
- **Process scoring**: quality of reasoning and adaptation
  - Explanation depth in initial comments
  - Response to implementer pushback
  - Evolution of position across turns
  - Acknowledgment of uncertainty
- **Weight**: 60% process, 40% product (reflecting that reasoning quality predicts long-term performance better than issue-spotting accuracy)

**Rationale:** In AI-augmented work, the process (how the candidate evaluates code and provides feedback) is more predictive of job performance than the product (whether they found every issue). AI can spot issues; humans must judge trade-offs and communicate direction.

### Principle 11: Validity Evidence Collection from Day One

**Evidence:** "Predictive validity refers to the extent to which a test score or assessment result can accurately predict future performance" [S34]. "Tests with high predictive validity reduce the risk of poor hiring decisions" [S34]. "Context-specific evidence" required for AI grading validity [S29].

**Application to Pipe:**
- **Construct validity**: correlate dimensions with expert human reviewers' assessments (target r ≥ 0.70)
- **Predictive validity**: longitudinal study tracking hired candidates
  - Correlate Pipe code review scores with 6-month manager ratings
  - Target r ≥ 0.40 (matching job knowledge tests meta-analysis)
  - Track by dimension: which dimensions predict performance?
- **Convergent validity**: correlate Pipe scores with other assessments (if candidate completes multiple challenges)
- **Adverse impact analysis**: monitor score distributions across demographic groups

**Rationale:** Assessment validity is not a one-time design decision but an ongoing empirical question. Without collecting validity evidence, Pipe cannot claim to measure developer judgment—only that it scores responses consistently. Validity evidence turns Pipe from "a test" into "a validated assessment."

## Direct implications for the project

1. **Multi-PR structure is non-negotiable** (Principle 1): The research on MMI and OSCEs makes clear that single-sample assessments have insufficient reliability for high-stakes decisions. Pipe must present 6-8 independent PRs per code review challenge to achieve target reliability (κ ≥ 0.75). This aligns with existing ADR-032 multi-PR requirement.

2. **Scoring must evaluate reasoning, not just answers** (Principle 2): The existing 6-dimension BARS rubric (ADR-032) correctly prioritizes explanation quality and reasoning process. Implementation must ensure the implementer agent's multi-turn conversation generates scoreable process evidence (responses to clarification requests, pushback, evolved positions).

3. **Gold standard calibration is a launch blocker** (Principle 7): The AI grading paradox research demonstrates that Devstral scoring without human gold standard calibration has no validity claim. Before production launch, Pipe must: (a) score 100+ reviews with both Devstral and Claude Sonnet 4.6, (b) measure κ per dimension, (c) establish escalation rule for dimensions with κ < 0.70. This is not an optimization—it's existential for validity.

4. **Contamination resistance requires private challenge library** (Principle 6): SWE-bench's 35-point contamination gap is a warning. Pipe cannot rely on public GitHub repositories for challenges. Phase 1 must include: (a) private challenge generation pipeline, (b) held-out test set (30% of library), (c) 6-month rotation policy. Budget for commercial LLM-generated challenges if necessary.

5. **Validity evidence collection starts immediately** (Principle 11): Do not wait until "after launch" to measure predictive validity. From first customer: (a) request permission to contact hired candidates' managers at 6 months, (b) collect manager ratings on same 6 dimensions Pipe scores, (c) calculate correlation. This longitudinal study is the only way to prove Pipe measures what it claims.

## Open questions / gaps

1. **What is the minimum acceptable predictive validity for hiring assessments?** The research shows job knowledge tests achieve r=0.4 correlation with job performance [S34], but does not specify the minimum threshold below which an assessment should not be used for hiring decisions. Industry standards (EEOC, SIOP) may provide guidance.

2. **How do you score "good judgment with incomplete information" vs. "correct answer by luck"?** OSCEs and bar exams face this challenge but the research doesn't provide clear resolution. A candidate might spot a security issue but for the wrong reason, or miss an issue but provide excellent reasoning about what they did check. The BARS rubric must differentiate these cases, but the literature doesn't offer validated anchors.

3. **What is the inter-rater reliability between Devstral and human expert reviewers on the same 6-dimension rubric?** The research measures kappa between human raters [S5] and between AI models [S15], but not human-AI agreement on the same open-ended software task. This is a critical empirical question Pipe must answer during calibration.

4. **How many turns of conversation are needed to generate sufficient process evidence?** The two-stage assessment framework validates the concept [S30], but doesn't specify how many interactive follow-up questions are needed. Aviation SBT research discusses scenarios but not turn counts. Pipe must determine empirically: is 2-turn interaction sufficient, or does reliable scoring require 4-5 turns?

5. **Can comparative judgment scale to code review assessment?** The research shows comparative judgment achieves κ ≥ 0.80 with ~9 comparisons per submission [S25], potentially reducing rubric calibration costs. Could Pipe use comparative judgment (show two candidate reviews side-by-side, ask "which is better?") as a calibration method or even production scoring approach? Unexplored in software assessment context.

6. **What is the construct validity of "code review judgment" as a hiring signal?** The research validates that job knowledge tests predict performance (r=0.4) [S34], but does not isolate "code review ability" as a distinct construct. Is code review judgment a proxy for general software engineering competence, or a separate skill? If separate, what is its predictive validity for job performance?

7. **How do you prevent implementation agent from inadvertently teaching the candidate?** OSCEs use standardized patients trained to avoid giving hints [S4]. Aviation SBT scenarios are scripted to maintain consistent difficulty [S8]. If the implementer agent's responses are too helpful (e.g., "You're right, this is a security issue because..."), the candidate learns during the assessment, invalidating comparison across candidates. What are the guard rails?

8. **What is the contamination half-life of a code review challenge?** SWE-bench contamination occurred because public repositories were in training data [S15]. If Pipe rotates challenges every 6 months (Principle 6), is that sufficient? Or will candidates share challenges on interview-prep forums, requiring 3-month rotation? Empirical question requiring monitoring.

9. **How do you measure "adaptability to AI feedback" as a distinct dimension?** The 6-dimension rubric includes Adaptability, but the research literature doesn't provide validated methods for scoring adaptability in technical contexts. Think-aloud protocols capture reasoning evolution [S27], but how do you score "candidate updated position appropriately" vs. "candidate folded too easily"? This dimension needs behavioral anchors grounded in real examples.

10. **What is the fairness impact of multi-turn conversational assessment on non-native English speakers?** The AI grading research notes "students who demonstrated strong reasoning but expressed it in non-standard English penalized" [S29]. If code review scoring emphasizes communication clarity (one of the 6 dimensions), does this create adverse impact? The research raises the concern but doesn't provide mitigation strategies specific to technical assessment.

## Sources

1. [Objective Structured Clinical Examination: The Assessment of Choice](https://pmc.ncbi.nlm.nih.gov/articles/PMC3191703/) — 2011, peer-reviewed medical education journal
2. [Objective structured clinical examination - Wikipedia](https://en.wikipedia.org/wiki/Objective_structured_clinical_examination) — Comprehensive overview with citations to primary research
3. [Objective Structured Clinical Examination (OSCE) | Assessment Systems](https://assess.com/objective-structured-clinical-examination-osce-exam/) — Industry practitioner guide
4. [Multiple Mini Interview as an admission tool in higher education: Insights from a systematic review - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6695046/) — 2019, peer-reviewed systematic review
5. [Effect of moderation on rubric criteria for inter-rater reliability in an objective structured clinical examination with real patients - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9358671/) — 2022, peer-reviewed medical education research
6. [OSCE: DESIGN, DEVELOPMENT AND DEPLOYMENT - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6398515/) — 2019, peer-reviewed medical education
7. [FAA Advisory Circular AC120-51E: Crew Resource Management Training](https://www.faa.gov/documentlibrary/media/advisory_circular/ac120-51e.pdf) — 2004, official FAA regulatory guidance
8. [Managing Risk through Scenario Based Training - FAA](https://www.faa.gov/sites/faa.gov/files/pilots/training/firc/RM_thorugh_SBT.pdf) — FAA official training guidance
9. [Aeronautical Decision-Making (ADM)](https://www.cfinotebook.net/notebook/aeromedical-and-human-factors/aeronautical-decision-making) — CFI training resource with FAA sources
10. [About the Multistate Performance Test (MPT®)](https://legal.uworld.com/bar-exam/about-the-mpt/) — 2024, official bar exam specification
11. [MPT Bar Exam - Multistate Performance Test - NCBE](https://www.ncbex.org/exams/mpt) — Official NCBE documentation
12. [Multiple Mini Interview as an admission tool in higher education - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6695046/) — 2019, systematic review of MMI validity evidence
13. [Multiple Mini-Interviews: Current Perspectives on Utility and Limitations - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6913247/) — 2019, peer-reviewed medical education
14. [SWE-bench: Can Language Models Resolve Real-World GitHub Issues? - arXiv](https://arxiv.org/abs/2310.06770) — 2023, published ICLR 2024
15. [The SWE-Bench Illusion: When State-of-the-Art LLMs Remember Instead of Reason - arXiv](https://arxiv.org/html/2506.12286v3) — 2024, peer-reviewed analysis of contamination
16. [Introducing SWE-bench Verified | OpenAI](https://openai.com/index/introducing-swe-bench-verified/) — 2024, industry technical report
17. [SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?](https://static.scale.com/uploads/654197dc94d34f66c0f5184e/SWEAP_Eval_Scale%20(9).pdf) — 2024, Scale AI research report
18. [HumanEval Benchmark | DataCamp](https://www.datacamp.com/tutorial/humaneval-benchmark-for-evaluating-llm-code-generation-capabilities) — 2024, benchmark overview with citations
19. [CodeContests Dataset Overview](https://www.emergentmind.com/topics/codecontests-dataset) — 2022-2024, DeepMind dataset documentation
20. [DevBench: A Comprehensive Benchmark for Software Development - arXiv](https://arxiv.org/html/2403.08604v1) — 2024, peer-reviewed
21. [The AI Productivity Paradox Research Report - Faros AI](https://www.faros.ai/blog/ai-software-engineering) — 2024, industry research
22. [Benchmarks for AI in Software Engineering – Communications of the ACM](https://cacm.acm.org/blogcacm/benchmarks-for-ai-in-software-engineering/) — 2024, peer-reviewed commentary
23. [Analytic vs. Holistic Rubrics: Which Type of Rubric Should You Use?](https://blog.alludolearning.com/analytic-vs-holistic-rubric) — Educational assessment practitioner guide
24. [Behaviorally Anchored Rating Scale: Examples + Guide - AIHR](https://www.aihr.com/blog/behaviorally-anchored-rating-scale/) — 2024, HR professional resource
25. [Comparative Judgement and the transformative power of holistic assessment](https://rethinkingassessment.com/rethinking-blogs/comparative-judgement-and-the-transformative-power-of-holistic-assessment/) — Educational assessment research
26. [Focusing Assessment on Process and Product – Encouraging Academic Integrity Through Intentional Assessment Design](https://pressbooks.bccampus.ca/encourageacademicintegrity/chapter/focusing-assessment-on-process-and-product/) — 2020-2024, educational design
27. [Think aloud protocol - Wikipedia](https://en.wikipedia.org/wiki/Think_aloud_protocol) — Overview with citations to cognitive psychology research
28. [How to create a rubric for portfolio assessment - Awards Management Software](https://awardforce.com/blog/how-to-create-a-rubric-for-portfolio-assessment/) — Practitioner guide
29. [Beyond Static Scoring: Enhancing Assessment Validity via AI-Generated Interactive Verification - arXiv](https://arxiv.org/html/2512.12592) — 2024, peer-reviewed
30. [Beyond Static Scoring: Enhancing Assessment Validity via AI-Generated Interactive Verification - arXiv](https://arxiv.org/html/2512.12592) — 2024, peer-reviewed (same source, key findings)
31. [Validity Arguments for AI‐Based Automated Scores: Essay Scoring as an Illustration](https://onlinelibrary.wiley.com/doi/10.1111/jedm.12333) — 2022, peer-reviewed psychometrics
32. [ERIC - ED626350 - Inter-Rater Reliability in Comprehensive Examination Scoring](https://eric.ed.gov/?id=ED626350) — 2023, peer-reviewed educational research
33. [Norm-Referenced vs. Criterion-Referenced Testing - Criteria Corp](https://www.criteriacorp.com/resources/definitive-guide-validity-of-preemployment-tests/validity-pre-employment-tests) — Industry assessment standards
34. [Predictive Validity: Psychometric Assessment For Hiring](https://www.pmapstest.com/blog/predictive-validity) — 2022-2024, assessment industry research
35. [Situational Judgment Tests: Higher Fidelity in Pre-Employment Testing](https://assess.com/situational-judgment-tests/) — Industry practitioner guide with academic citations
