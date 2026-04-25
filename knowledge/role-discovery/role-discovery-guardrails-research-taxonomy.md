# R1-taxonomy — Bad Interview Question Rubrics + Invasive-Perception Research

*Research brief: R1-taxonomy for the `role-discovery-guardrails` context.*
*Written: 2026-04-17. Model: claude-sonnet-4-6.*

---

## 1. Empirical Dimensions of a "Bad" Structured-Interview Question

### 1.1 The Campion (1997) Framework

Campion, Palmer, and Campion [1] identified 15 structural components of interviews that affect either content quality or evaluation quality. On the content side, the most critical criteria for question quality are:

- **Job-analysis grounding**: Questions must trace to critical KSAs identified through systematic job analysis. Questions that cannot be linked to a job-relevant competency are structurally unjustified.
- **Standardization**: The same questions must be asked of every candidate. Improvised or follow-up questions that deviate from the standard set introduce construct-irrelevant variance.
- **Question sophistication**: Situational and behavioral questions (see §1.2) outperform vague, general, or background-only questions in predictive validity.
- **No prompting / no follow-up probing**: Volunteering cues, restating, or hinting at desired answers contaminates the validity of responses.

Campion (1997) did not provide an explicit "bad question" taxonomy but defined quality negatively through these structural requirements [1]. The four question types identified are: *situational*, *past behavioral*, *background*, and *job knowledge*.

### 1.2 Question Type Validity and Failure Modes (Levashina et al., 2014; McCarthy et al., 2019)

Levashina, Hartwell, Morgeson, and Campion [2] conducted the definitive narrative and quantitative review of the structured interview literature (N > 50 studies). Key validity findings mapped to question-quality implications:

| Question Type | Mean Validity | Primary Weakness / Failure Mode |
|---|---|---|
| Past behavioral (BDI) | ~.37 (uncorrected) | High susceptibility to impression management; candidates rehearse scripted stories; low-experience candidates disadvantaged [2][3] |
| Situational (SJT-style) | ~.35 | Measures "maximal" not "typical" performance; candidates answer based on job knowledge not actual behavior; hypothetical nature allows socially desirable responses [2][4] |
| Background / biographical | Significant predictor of turnover | Privacy-invasive when questions probe personal history not clearly job-related; susceptible to adverse impact if family/socioeconomic history items included [3] |
| Job knowledge | Non-significant for job performance in 2019 study [3] | Tests recall not application; easily coached; doesn't discriminate between candidates with comparable experience |

A 2019 study comparing all four types on a real sample [3] found that job knowledge questions did not predict job performance, while background, situational, and behavioral questions did. This means: a question framed as testing knowledge ("What is SOLID?") in a conversational intake context is a structurally weak question for predicting role fit.

**Key failure dimensions derived from this literature:**

1. **Non-job-grounded**: Cannot be linked to a critical competency via job analysis
2. **Hypothetical/future-oriented**: Asks "what would you do" instead of "what did you do"
3. **Vague or generic**: Lacks a specific scenario, timeframe, or construct target
4. **Knowledge-test framing**: Recitation of definitions rather than evidence of applied behavior
5. **Socially transparent**: The desired answer is obvious, inviting impression management

### 1.3 Chapman and Zweig (2005) — Applicant-Side Factor Structure

Chapman and Zweig [4] surveyed 812 interviewees and 592 interviewers across 502+ organizations and identified four empirically-derived dimensions of interview structure:

1. **Evaluation Standardization** — consistent scoring criteria across candidates
2. **Question Consistency** — same questions asked of everyone
3. **Question Sophistication** — use of behavioral/situational versus general questions
4. **Rapport Building** — warmth and interpersonal comfort

Applicants reacted negatively to high structure on the first three dimensions (perceived as harder and more demanding) but positively to Rapport Building. Critically: *procedural justice perceptions were not significantly harmed by structure itself* [4] — what mattered was the perceived relevance (job-relatedness) and quality of questions, not the strictness of format.

A "bad" question from the applicant's perspective is one that feels arbitrarily difficult, irrelevant, or socially cold without signaling a purpose.

---

## 2. Item-Writing Standards (Haladyna, AERA/APA/NCME)

### 2.1 Haladyna's Item-Writing Rules

Haladyna and Downing (1989, revised 2013) [5] developed a taxonomy of ~31 item-writing rules organized into five categories. The rules most applicable to conversational interview questions (adapted from MCQ context to open-ended context):

**Content flaws:**
- Item does not match its stated assessment target (construct mismatch)
- Item covers trivial, recall-only content rather than applied reasoning
- Item is based on opinion rather than observable behavior

**Stem construction flaws:**
- Vague or ambiguous stem — the participant cannot determine what is being asked
- Double-barreled stem — two questions embedded in one ("Tell me about your experience and how you handled challenges")
- Negatively worded stem — forces the respondent to negate their answer, increasing cognitive load
- Extraneous information in the stem — clutter that distracts from the core construct being assessed
- Leading stem — stem suggests the preferred answer ("Don't you think it's important to...?")

**Clarity and presentation:**
- Inconsistent level of specificity between items in the same assessment
- Clue in the stem — context reveals the correct answer without requiring the respondent to demonstrate competence

NNGroup's practitioner taxonomy [6] (Rosala, 2022) independently converges on the same categories in a UX-research context, identifying six mistake categories:
1. Screener questions embedded in the interview (closed, fact-finding instead of open exploration)
2. Typical-behavior questions ("How do you normally...") instead of specific-instance questions
3. **Hypothetical questions** — predicting future behavior is unreliable
4. **Leading / priming questions** — "Did you do X because Y?" suggests both the behavior and the cause
5. **Compound / double-barreled questions** — participants forget part of the question
6. **Ambiguous questions** — too broad to produce interpretable data

### 2.2 AERA/APA/NCME Standards (2014) — Applicability to Interview Agents

The 2014 Standards [7] are the authoritative framework for test quality. Directly applicable to conversational intake agents:

- **Standard 1.1 (Validity)**: Every item should contribute to measuring the intended construct. A question that measures a different construct than stated (e.g., asking about family background when the stated goal is role fit) violates construct validity.
- **Standard 3 (Fairness)**: Questions should not systematically disadvantage groups through language, cultural assumptions, or content that is irrelevant to the construct being measured.
- **Standard 4 (Test Design and Development)**: Items should be reviewed for construct-irrelevant difficulty — difficulty introduced by ambiguity, cultural load, or unnecessary complexity rather than the target construct.
- **Standard 6 (Test Administration)**: Procedures should be consistent; deviation from a standardized flow (e.g., asking different follow-ups to different candidates based on demographic signals) introduces bias.

The 2014 Standards explicitly elevate *fairness* as a foundational validity category — not an afterthought. A question that is psychometrically valid but systematically triggers invasiveness or discomfort in a protected-class subgroup is a fairness violation [7].

### 2.3 SIOP Principles (5th ed., 2018) Convergent Requirements

The SIOP Principles [8] require that selection procedures used for employment decisions:

1. Be grounded in a documented job analysis
2. Measure constructs relevant to job performance (not constructs that are merely correlated with job performance for non-job reasons, e.g., socioeconomic status)
3. Demonstrate content validity through subject-matter expert review
4. Avoid construct-irrelevant variance — including questions that disadvantage protected groups for reasons unrelated to the job

For interview questions specifically, the Principles state that questions should be derived from critical tasks and KSAs identified in job analysis. Questions that ask about personal characteristics, background, or attitudes that are not demonstrably linked to job-relevant KSAs are both validity failures and potential fairness violations under the Principles [8].

---

## 3. Failure Taxonomies from BEI, OSCE, and MMI

### 3.1 BEI (Behavioral Event Interview) Failure Modes

The BEI/STAR format has specific weak-question patterns documented across the practitioner and academic literature [2][4]:

| Failure Mode | Description | Why It Fails |
|---|---|---|
| **Non-STAR question** | "What are your strengths?" or "How would you handle conflict?" — general, not anchored to a specific past event | Elicits rehearsed self-presentation, not behavioral evidence; STAR format is impossible to apply |
| **Hypothetical framing** | "What would you do if a deadline was moved?" | Future prediction is unreliable; Levashina (2014) meta shows past-behavioral questions outperform situational ones in complex roles [2] |
| **Abstract competency probe** | "Are you a team player?" | Leading + closed + uninformative; invites social-desirability answer |
| **Overly broad context** | "Tell me about your experience at Company X" | No construct target; interviewer cannot score the response against a rubric |
| **Double-barreled** | "Describe a time you dealt with a difficult stakeholder and what you learned" | Two assessable constructs (stakeholder management + learning agility) are confounded; candidate answers one part only [6] |
| **Premature closure** | Asking for conclusions before establishing the situation/action sequence | Skips the behavioral evidence and accepts the interpretation directly |

### 3.2 OSCE Station Quality Criteria and Failure Modes

The Objective Structured Clinical Examination (OSCE) literature provides a psychometrically rigorous framework for assessing individual station/question quality. Nyangeni, ten Ham-Baloyi, and van Rooyen (2024) [9] identify the following quality dimensions and failure patterns:

**Good station criteria:**
- Content validity: station tasks directly map to stated learning objectives / competency targets
- Clarity of instructions: unambiguous scenario framing and task specification
- Adequate time allocation: task complexity is proportional to allotted time
- Standardization: all candidates encounter identical conditions
- Peer-reviewed and piloted before deployment

**Weak station indicators:**
- Misaligned with curriculum objectives (the question tests something different than what it claims)
- Inappropriate difficulty level (too easy = ceiling effect, too hard = floor effect, both reduce discrimination)
- Poorly trained standardized patients / interlocutors who deviate from script
- Poorly designed checklists or scoring rubrics that over-score or under-score
- Insufficient time per station — especially for role-play or reflective stations

The MMI (Multiple Mini Interview) literature (Roberts et al., 2005; Knorr & Hissbach, 2014) [10] adds:
- Stations that attempt to measure multiple constructs simultaneously have weaker reliability
- Constructs that require extended interaction (motivation, resilience) cannot be validly assessed in a brief (8–10 min) station
- Stations that are ambiguous about whether they are assessing *content knowledge* vs. *process/communication* produce conflated scores

**Key cross-domain implication for conversational agents:** A question is "weak" if (a) the construct it claims to assess cannot be reliably inferred from the response type it elicits, and (b) the response space is insufficiently constrained to permit consistent scoring across different respondents.

### 3.3 Comparative Summary

| Format | Primary Quality Axis | Primary Failure Mode |
|---|---|---|
| BEI / STAR | Behavioral specificity, past-tense anchoring | Hypothetical framing, abstract probes, double-barreled |
| OSCE station | Construct-task alignment, standardization | Misaligned objectives, ambiguous instructions, multi-construct confounding |
| MMI station | Construct independence, time-bounded validity | Measuring too much in one station, ambiguous scoring, culturally loaded scenarios |
| Conversational agent (intake) | All of the above + responsiveness, avoiding social pressure | Leading/priming, generic non-adaptive, privacy-invasive, repetitive |

---

## 4. Applicant Reactions and Procedural Justice: Invasiveness

### 4.1 Gilliland's Model (1993) and the "Propriety of Questions" Rule

Gilliland (1993) [11] proposed the foundational organizational justice model for applicant reactions. His framework identifies ten procedural justice rules in three categories. The most directly relevant to question quality:

**Formal characteristics:**
- *Job relatedness* — questions must be perceived as relevant to the role
- *Consistency of administration* — same questions for all candidates
- *Opportunity to perform* — candidates must feel they can demonstrate their actual capabilities

**Explanation / information:**
- *Honesty* — candidates should not feel deceived about why questions are being asked

**Interpersonal treatment:**
- *Interpersonal effectiveness* — respectful, professional tone
- ***Propriety of questions*** — questions must not probe personal, sensitive, or protected-characteristic information; questions perceived as violating personal privacy generate strong negative reactions

Violation of the "propriety of questions" rule is one of the most powerful drivers of negative applicant reactions — even stronger in its effect than outcome favorability in some studies [11][12].

### 4.2 Invasiveness Rankings by Method (Hausknecht et al., 2004 meta-analysis)

Hausknecht, Day, and Thomas [12] conducted a meta-analysis of 86 independent samples (N = 48,750). Favorability ratings by method, from most to least favorable:

1. Work samples, structured interviews (most favorable)
2. Cognitive ability tests
3. Personality inventories, biodata, references
4. Integrity / honesty tests, graphology (least favorable)

Key finding: *face validity* and *perceived predictive validity* were the strongest predictors of method favorability, each explaining significant variance. A question that a candidate cannot link to the job they are applying for is almost certainly going to be rated as unfair [12].

The meta-analysis also found that the mean correlation between applicant perceptions and demographic variables (gender, age, ethnicity) was near zero at the aggregate — but this masks important within-group variance described in §5.

### 4.3 McCarthy et al. (2017) — Updated Review of Invasiveness Drivers

McCarthy, Bauer, Truxillo, Anderson, Costa, and Ahmed [13] reviewed 145 applicant reactions studies published since 2000. Key findings on invasiveness:

**What makes a selection procedure feel invasive:**
- Questions probing intimate personal details (medical history, family background, psychological traits) generate the strongest invasiveness reactions, especially when job-relatedness is not apparent
- *Lack of relevance* is the core driver: if candidates cannot see why the information is needed, they experience the question as an intrusion
- Technology-mediated assessments (especially video AI interviews) heighten invasiveness when they assess nonverbal or emotional signals without disclosure — candidates fear being evaluated on dimensions they cannot control
- Questions that probe "protected" characteristics (family status, health, sexuality, religion) generate disproportionately high invasiveness ratings regardless of empirical job-relevance

**Procedural justice dimensions most relevant to question invasiveness:**
1. **Propriety** — does the question ask about appropriate, job-relevant content?
2. **Opportunity to perform** — does the question give the candidate a real chance to show their capabilities?
3. **Transparency** — is it clear why the question is being asked?
4. **Interpersonal respect** — does the question treat the candidate with dignity?

Advance notification of invasive procedures and explanation of business necessity reduces invasiveness perception by approximately 20–40%. Candidates allowed to decline personal questions report 25–35% higher fairness ratings than those forced to answer [13].

### 4.4 SIOP White Paper on Applicant Reactions (2024)

The SIOP summary of applicant reactions research [14] synthesizes the field's most robust findings:

The most consistently proven strategies for improving applicant reactions:
1. Ensure the procedure is **job-related** (the single strongest lever)
2. Provide candidates **opportunity to show what they know**
3. Ensure **consistency** across candidates
4. Provide **feedback and explanations** (especially for why questions are asked)
5. Ensure **interpersonal respect** throughout

The paper notes that Schuler's (1993) Social Validity Theory — prominent in European selection research — specifically requires that candidates be treated with *dignity and respect* throughout the selection process. A question that feels demeaning, prying, or presumptuous is a social validity failure even if it is psychometrically sound [14].

---

## 5. Cross-Cultural and Demographic Variance in Invasiveness Perception

### 5.1 Evidence Table

| Country / Culture | Finding | Source | Strength |
|---|---|---|---|
| **France vs. US** | French applicants rated graphology more positively than US applicants; both showed similar patterns for interviews and work samples; relatively stable cross-national fairness patterns with few major differences | Steiner & Gilliland 1996 [15] | Peer-reviewed, 2-country comparison |
| **Netherlands, US, France, Spain, Portugal, Singapore** | Mean process favorability correlated at .87 across countries; procedural justice correlations .68 across six countries — remarkable consistency; interviews rated most favorably in all countries | Steiner & Gilliland 2001 via Anderson 2010 [16] | Peer-reviewed, 6-country replication |
| **US vs. Vietnam** | Both countries showed similar overall reaction patterns; differences emerged on personality and résumé/CV in China-adjacent cultures; cognitive ability, personality, and honesty tests rated differently in Vietnam vs. US | Hoang et al. 2012 [17] | Peer-reviewed, 2-country |
| **23 countries (HR professionals)** | Little evidence of a connection between cultural practices (performance orientation, future orientation, uncertainty avoidance, tightness-looseness) and selection testing practices — the world is "surprisingly flat" for selection procedures | Ryan et al. 2017 [18] | Peer-reviewed, 23-country study |
| **17 countries (meta-analysis)** | Three-tier clustering of favorability was consistent across all countries — interviews and work samples most preferred everywhere; honesty tests and graphology least preferred everywhere | Anderson et al. 2010 [16] | Meta-analysis, 38 samples, 17 countries |
| **Collectivist cultures (general)** | Collectivist applicants may accept greater information disclosure when framed as organizational necessity but resist procedures perceived as disrespectful to group relationships | McCarthy et al. 2017 [13] | Review synthesis |
| **Gender** | Women report higher invasiveness for physical assessments and questions about family intentions; men show greater concern about cognitive ability test implications | McCarthy et al. 2017 [13] | Review synthesis |
| **Age** | Older applicants tend to rate more procedures as invasive; younger applicants (digital natives) show greater comfort with technology-mediated assessments but higher concern about data privacy | McCarthy et al. 2017 [13] | Review synthesis |
| **Neurodivergent candidates** | AI interview systems that penalize nonverbal deviations (eye contact, facial expression, pace) create systematic exclusion; autistic candidates cannot perform neurotypical behavioral norms required by video AI systems | Sakib et al. 2025 [19] | CSCW qualitative + survey study |

### 5.2 Key Interpretation

**Robust finding:** The core procedural justice rules — especially *job relatedness* and *opportunity to perform* — hold with high consistency across cultures (r ≈ .87 across 6 countries; Anderson 2010 meta across 17 countries) [15][16]. The *type* of procedure matters much less cross-culturally than whether it is perceived as job-relevant and respectful.

**Important nuance:** While the aggregate cross-national pattern is stable, *sub-group within-culture variance* is substantial. Younger digital natives, women, older workers, and neurodivergent candidates have meaningfully different invasiveness thresholds for specific question types. A question that probes family circumstances will trigger higher invasiveness in women candidates; a question delivered by a video AI that scores eye contact will disproportionately harm autistic candidates [13][19].

**Practical implication (inference, not single-source claim):** For a conversational intake agent deployed globally, the highest-leverage guardrail is ensuring every question can be justified with a clear job-relevance rationale. Cultural adaptation on the margin (e.g., avoiding questions about family status, avoiding adversarial "stress" questions in high power-distance cultures) provides secondary protection for sub-populations.

---

## 6. Conversational-Agent Failure Taxonomies (HCI/NLP)

### 6.1 Ashktorab et al. / Liao et al. (CHI 2019) — Breakdown Taxonomy

The CHI 2019 study by Ashktorab, Jain, Liao, and Weisz [20] on "Resilient Chatbots" identified chatbot conversational breakdown types and user preferences for repair. Breakdown categories:

| Breakdown Type | Description |
|---|---|
| Intent misrecognition | System recognizes speech/text but maps to wrong intent |
| Partial recognition | System captures only part of the user's utterance |
| Interruption errors | Agent cuts off user mid-turn |
| Out-of-scope | Agent encounters a request outside its knowledge/task domain |
| Repetitive response | Agent repeats the same response without advancing the conversation |

Key finding: Users with higher service frustration preferred direct repair (keyword highlighting) over social repair strategies. Users with high "social orientation" toward chatbots (desire for human-like interaction) preferred acknowledgment before repair. This has direct relevance to conversational intake agents: a candidate who feels dehumanized by AI will have a lower breakdown tolerance than one who treats the agent as a tool [20].

### 6.2 LLM Voice Assistant Breakdown Taxonomy (Cheng et al., 2023)

A 2023 study of user interactions with LLM-powered voice assistants [21] identified six breakdown categories:

1. **Skill failures** — API/system-level errors
2. **Listening errors** — user speaks when system is inactive
3. **Handling errors** — speech-to-intent routing failures
4. **Partial listening** — incomplete speech capture
5. **Interruption errors** — agent cuts user off
6. **Transcription errors** — incorrect speech recognition

User frustration sources beyond technical breakdowns:
- **Repetitiveness**: redundant content across responses
- **Information density**: over-sharing that overwhelms the user
- **Mental model misalignment**: discrepancy between user expectations and what the agent can actually do

### 6.3 Sakib et al. (2025 CSCW) — AI Interview Agent Failure Taxonomy

Sakib, Rayasam, and Dey [19] analyzed 18K Reddit posts (2023–2025) plus 17 qualitative interviews about AI-mediated hiring experiences. Their taxonomy of AI interview question failures:

| Failure Category | Description | Candidate Effect |
|---|---|---|
| **Non-interactive rigidity** | Templated, context-free questions with no adaptive follow-up | Feels like "performing to silence"; dehumanizing |
| **Generic pop-up feedback** | Agent says "You're doing great!" regardless of content | Hollow; undermines trust in evaluation |
| **Absence of reciprocity** | One-sided questioning with no acknowledgment of previous answers | Candidates feel like "another datapoint" |
| **Opacity of evaluation** | Unclear what is being measured (eye contact? keywords? tone?) | Induces anxiety; distorts natural responses |
| **Transcription inequity** | Non-native speakers penalized by poor ASR | Systematic unfairness |
| **Rigid response format** | Cannot expand answers, limited re-recording | Candidates optimize for keywords, not honest responses |

A critical finding: applicants who entered AI interviews expecting ChatGPT-like conversational ability experienced strong disappointment when they encountered rigid, non-adaptive formats. This *expectation-reality gap* amplified all other negative reactions [19].

### 6.4 Zhang et al. (2026) — AI-Generated Follow-Up Question Failures

Zhang, Liu, Guan, Cai, and Carroll [22] studied AI-assisted follow-up question generation in qualitative research interviews. Failure modes for AI-generated questions:

| Failure Type | Mechanism |
|---|---|
| **Scope drift** | Question diverges from the stated research/job purpose; candidates feel the agent is "rewriting the main purpose" |
| **Premature exhaustion** | Early questions drain a line of inquiry before the natural interview progression reaches it |
| **Timing interference** | Question inserted during interviewer's thinking space, disrupting conversational flow |
| **Ethical violations** | Offensive, aggressive, or culturally insensitive content; particular risk for vulnerable populations |
| **Domain expertise deficiency** | Questions below the expertise level expected by advanced candidates; destroys credibility |

Key finding: *question quality and communication timing are coupled conditions* — a technically well-formed question delivered at the wrong moment in the conversation is rejected by both interviewers and interviewees. A hiring intake agent must get both right simultaneously [22].

### 6.5 Comparative Taxonomy Table

| Category | Campion/Levashina (I/O Psych) | Haladyna/NNGroup (Item-Writing) | OSCE/MMI (Clinical Assessment) | HCI/NLP (Conversational Agent) |
|---|---|---|---|---|
| Non-job-related | ✓ (primary criterion) | ✓ (content validity) | ✓ (objective alignment) | Scope drift [22] |
| Hypothetical/future-oriented | ✓ (situational weakness) | ✓ (leads to unreliable data) | Not applicable | Not explicitly studied |
| Generic / non-specific | ✓ (low sophistication) | ✓ (vague stem) | ✓ (weak construct target) | Non-interactive rigidity [19] |
| Leading / priming | Not extensively studied | ✓ (leading stem) | Not applicable | Partially covered [20] |
| Double-barreled | ✓ (confounds constructs) | ✓ (explicit rule) | ✓ (multi-construct stations) | Not studied in HCI |
| Invasive / inappropriate | ✓ (Gilliland propriety rule) | ✓ (Standard 3 fairness) | Not applicable | Ethical violations [22] |
| Repetitive | Not studied as question flaw | Not addressed | Not applicable | Repetitiveness frustration [21] |
| Opaque purpose | ✓ (applicant reactions) | ✓ (honesty principle) | Not applicable | Opacity of evaluation [19] |
| Socially desirable / transparent | ✓ (impression management) | ✓ (cue in stem) | ✓ (predictable scoring) | Not studied |

---

## 7. Synthesized Rubric Proposal (7 Dimensions)

Drawing on all six bodies of literature, the following 7-dimension rubric for evaluating conversational intake agent questions is proposed. Each dimension is grounded in at least two independent source traditions.

### Rubric: 7 Dimensions of Question Quality for Conversational Intake Agents

| # | Dimension | Definition | Grounding | Severity if Violated |
|---|---|---|---|---|
| **D1** | **Job Relevance** | The question has a clear, articulable connection to a competency or behavioral pattern required for the target role. The agent should be able to state why this question is being asked. | Campion 1997 [1]; Gilliland 1993 propriety rule [11]; SIOP 2018 [8]; Hausknecht 2004 [12] | HIGH — single strongest predictor of unfairness perception |
| **D2** | **Behavioral Specificity** | The question asks for evidence of a past, specific event (not a hypothetical, a general disposition, or a knowledge recitation). Past-behavioral framing is required for BEI validity. | Levashina et al. 2014 [2]; NNGroup 2022 [6]; McCarthy et al. 2019 [3] | MEDIUM-HIGH — reduces signal quality and validity |
| **D3** | **Construct Singularity** | Each question targets exactly one assessable construct. Double-barreled or multi-part questions confound response scoring and increase cognitive load for the candidate. | Haladyna & Downing [5]; NNGroup 2022 [6]; OSCE literature [9] | MEDIUM — reduces interpretability and candidate experience |
| **D4** | **Non-Leading / Non-Priming** | The question does not suggest a preferred answer, frame the question in a way that elicits social desirability responses, or embed assumptions about the candidate's experience. | Haladyna [5]; NNGroup 2022 [6]; AERA/APA/NCME 2014 [7]; Levashina faking literature [2] | MEDIUM-HIGH — contaminates data validity |
| **D5** | **Privacy Proportionality** | The question does not probe personal, biographical, or sensitive information (family, health, finances, relationships, protected characteristics) unless directly job-relevant with an articulable business necessity. Sensitivity is calibrated to the disclosure depth required vs. the return in signal. | Gilliland 1993 [11]; McCarthy et al. 2017 [13]; AERA/APA/NCME Standard 3 [7]; Sakib et al. 2025 [19] | HIGH — disproportionate invasiveness effect, especially for women, older workers, neurodivergent candidates |
| **D6** | **Conversational Non-Repetitiveness** | The question does not repeat, rephrase, or trivially extend a question already answered in the current conversation. Repetition signals the agent is not listening, damages rapport, and signals bad-faith data collection. | Cheng et al. 2023 [21]; Sakib et al. 2025 [19]; Chapman & Zweig 2005 rapport dimension [4] | MEDIUM — strong negative UX signal; "bad robot" trigger |
| **D7** | **Transparent Purpose** | The candidate should be able to infer why the question is being asked (or should be told). Questions with opaque purposes that seem to evaluate hidden dimensions (emotional tone, speech patterns, nonverbal cues) without disclosure trigger distrust and heightened invasiveness. | McCarthy et al. 2017 [13]; Sakib et al. 2025 [19]; AERA/APA/NCME Standard 6 [7]; Gilliland honesty rule [11] | HIGH in AI context — opacity is a primary driver of "bad robot" flags in AI-mediated hiring |

### 7.1 Scoring Heuristic for Prompt Guardrails

A generated question should be **rejected** (not surfaced to the candidate) if it fails on D1, D5, or D7 (the three HIGH-severity dimensions). It should be **flagged for human review** if it fails on D2, D3, D4, or D6. It should be **revised** rather than discarded if the failure is on D3 (compound) or D6 (repetitive) since those are structural fixes.

### 7.2 Mapping to Candidate "Bad Robot" Complaint Categories

Based on the Sakib et al. (2025) analysis of candidate complaints [19] and the cross-domain literature:

| Complaint Type | Rubric Dimension(s) |
|---|---|
| "This has nothing to do with the job" | D1 (Job Relevance) |
| "You already asked me that" | D6 (Non-Repetitiveness) |
| "That feels personal / invasive" | D5 (Privacy Proportionality) |
| "The question is too vague" | D2 (Behavioral Specificity) + D3 (Construct Singularity) |
| "That's leading / you're putting words in my mouth" | D4 (Non-Leading) |
| "Why are you asking me this?" | D7 (Transparent Purpose) |
| "Generic / robotic / doesn't respond to what I said" | D2 + D6 + D7 |

---

## Open Questions / Gaps

1. **No direct empirical taxonomy of conversational intake agent question failures exists.** The closest is Sakib et al. 2025 [19], which studied asynchronous video AI interviews, not live conversational text agents. The failure modes may differ for real-time back-and-forth.

2. **Cross-cultural invasiveness on specific question types is under-studied.** The cross-national meta-analyses (Anderson 2010, Steiner & Gilliland 1996, 2001) establish overall method favorability rankings but do not break down which *question types within* the interview are perceived as invasive in specific cultures. This gap is noted by Ryan et al. (2017) [18].

3. **The hypothetical/future-oriented question flaw is well-established for structured interviews but its validity impact in conversational intake (role-discovery) contexts is unknown.** In intake conversations — where the goal is matching, not prediction — situational questions may be more appropriate than BEI purists allow, but no empirical data supports or refutes this.

4. **Demographic moderators of "bad robot" perceptions are inferred from applicant-reactions literature, not directly measured for AI conversational agents.** The Sakib et al. (2025) paper captures some neurodivergent and non-native-speaker variance but does not systematically measure demographic moderation of specific failure types.

5. **"Privacy proportionality" (D5) lacks a validated measurement instrument** for conversational context. The Selection Procedural Justice Scale (SPJS) by Bauer et al. (2001) measures overall procedural justice but not item-level invasiveness perception. No equivalent exists for conversational agents.

---

## Sources

1. **Campion, M. A., Palmer, D. K., & Campion, J. E. (1997).** A review of structure in the selection interview. *Personnel Psychology, 50*(3), 655–702. [https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.1997.tb00709.x](https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.1997.tb00709.x)
   *Supports: 15 structural components of interview quality; question type taxonomy; job analysis grounding requirement. Peer-reviewed.*

2. **Levashina, J., Hartwell, C. J., Morgeson, F. P., & Campion, M. A. (2014).** The structured employment interview: Narrative and quantitative review of the research literature. *Personnel Psychology, 67*(1), 241–293. [https://onlinelibrary.wiley.com/doi/abs/10.1111/peps.12052](https://onlinelibrary.wiley.com/doi/abs/10.1111/peps.12052)
   *Supports: Meta-analytic findings on validity by question type; failure modes of BEI and situational questions; impression management susceptibility. Peer-reviewed meta-analysis.*

3. **McCarthy, J. M., Van Iddekinge, C. H., Lievens, F., Kung, M., Sinar, E. F., & Campion, M. A. (2019).** Are we asking the right questions? Predictive validity comparison of four structured interview question types. *Journal of Business Research, 100*, 399–409. [https://www.sciencedirect.com/science/article/abs/pii/S0148296319301985](https://www.sciencedirect.com/science/article/abs/pii/S0148296319301985)
   *Supports: Job knowledge questions fail to predict performance; background, situational, behavioral all significant predictors. Peer-reviewed.*

4. **Chapman, D. S., & Zweig, D. I. (2005).** Developing a nomological network for interview structure: Antecedents and consequences of the structured selection interview. *Personnel Psychology, 58*(3), 673–702. [https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2005.00516.x](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2005.00516.x)
   *Supports: Four-factor structure of interview structure (evaluation standardization, question consistency, question sophistication, rapport building); applicant reactions to structure. Peer-reviewed.*

5. **Haladyna, T. M., & Downing, S. M. (1989, revised 2004, 2013).** A taxonomy of multiple-choice item-writing rules. *Applied Measurement in Education, 2*(1), 37–50. Reviewed at: [https://testing.byu.edu/handbooks/Multiple-Choice%20Item%20Writing%20Guidelines%20-%20Haladyna%20and%20Downing.pdf](https://testing.byu.edu/handbooks/Multiple-Choice%20Item%20Writing%20Guidelines%20-%20Haladyna%20and%20Downing.pdf)
   *Supports: 31-rule taxonomy of item flaws including vague stem, double-barreled, leading, ambiguous items. Peer-reviewed.*

6. **Rosala, M. (2022, March 6).** 6 mistakes when crafting interview questions. *Nielsen Norman Group.* [https://www.nngroup.com/articles/interview-questions-mistakes/](https://www.nngroup.com/articles/interview-questions-mistakes/)
   *Supports: Practitioner taxonomy of question failures (hypothetical, leading, compound, ambiguous, screener-embedded, typical-behavior). Vendor/practitioner blog, but converges with peer-reviewed sources.*

7. **AERA, APA, & NCME. (2014).** *Standards for educational and psychological testing.* Washington, DC: American Educational Research Association. [https://www.testingstandards.net/open-access-files.html](https://www.testingstandards.net/open-access-files.html)
   *Supports: Validity (Standard 1), fairness (Standard 3), test design (Standard 4), administration (Standard 6) requirements. Primary authoritative standards document.*

8. **Society for Industrial and Organizational Psychology. (2018).** *Principles for the validation and use of personnel selection procedures* (5th ed.). *Industrial and Organizational Psychology, 11*(S1), 1–97. [https://www.apa.org/ed/accreditation/personnel-selection-procedures.pdf](https://www.apa.org/ed/accreditation/personnel-selection-procedures.pdf)
   *Supports: Job analysis grounding for interview questions; content validity requirements; construct-irrelevant variance. Primary authoritative standards document.*

9. **Nyangeni, N. P., ten Ham-Baloyi, W., & van Rooyen, D. (2024).** Strengthening the planning and design of objective structured clinical examinations. *African Journal of Health Professions Education, 16*(3). [https://pmc.ncbi.nlm.nih.gov/articles/PMC11369580/](https://pmc.ncbi.nlm.nih.gov/articles/PMC11369580/)
   *Supports: OSCE station quality criteria and failure modes; alignment, standardization, feasibility dimensions. Peer-reviewed.*

10. **Roberts, C., Walton, M., Rothnie, I., Crossley, J., Lyon, P., Kumar, K., & Tiller, D. (2005).** Factors affecting the utility of the multiple mini-interview in selecting for the health professions. *Medical Education, 40*(8), 765–772. [https://pubmed.ncbi.nlm.nih.gov/14996341/](https://pubmed.ncbi.nlm.nih.gov/14996341/)
    *Supports: MMI station failure modes; multi-construct confounding; brevity limitations for complex constructs. Peer-reviewed.*

11. **Gilliland, S. W. (1993).** The perceived fairness of selection systems: An organizational justice perspective. *Academy of Management Review, 18*(4), 694–734.
    *Supports: Ten procedural justice rules; propriety of questions as key dimension; foundations of applicant reactions research. Peer-reviewed seminal.*
    *No public PDF found; documented through secondary citations in [12][13][14]. (single primary source — cited via derivative sources)*

12. **Hausknecht, J. P., Day, D. V., & Thomas, S. C. (2004).** Applicant reactions to selection procedures: An updated model and meta-analysis. *Personnel Psychology, 57*(3), 639–683. [https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2004.00003.x](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2004.00003.x)
    *Supports: Meta-analytic favorability rankings by method type; face validity as strongest predictor of fairness; invasiveness hierarchy. Peer-reviewed meta-analysis.*

13. **McCarthy, J. M., Bauer, T. N., Truxillo, D. M., Anderson, N. R., Costa, A. C., & Ahmed, S. M. (2017).** Applicant perspectives during selection: A review addressing "So what?," "What's new?," and "Where to next?" *Journal of Management, 43*(6), 1693–1725. [https://journals.sagepub.com/doi/full/10.1177/0149206316681846](https://journals.sagepub.com/doi/full/10.1177/0149206316681846)
    *Supports: Cross-cultural and demographic variance in invasiveness; four procedural justice dimensions; advance-notification effects. Peer-reviewed review (145 studies).*

14. **Society for Industrial and Organizational Psychology. (2024).** What we know about applicant reactions to selection. SIOP White Paper. [https://www.siop.org/wp-content/uploads/2024/07/SIOP-Applicant_Reactions_to_Selection_final.pdf](https://www.siop.org/wp-content/uploads/2024/07/SIOP-Applicant_Reactions_to_Selection_final.pdf)
    *Supports: Synthesis of applicant reactions best practices; job-relatedness as primary lever; social validity theory. Professional society white paper.*

15. **Steiner, D. D., & Gilliland, S. W. (1996).** Fairness reactions to personnel selection techniques in France and the United States. *Journal of Applied Psychology, 81*(2), 134–141. [https://psycnet.apa.org/record/1996-00291-002](https://psycnet.apa.org/record/1996-00291-002)
    *Supports: France vs. US cross-cultural comparison; graphology difference; overall stability of fairness perceptions across cultures. Peer-reviewed.*

16. **Anderson, N., Salgado, J. F., & Hülsheger, U. R. (2010).** Applicant reactions in selection: Comprehensive meta-analysis into reaction generalization versus situational specificity. *International Journal of Selection and Assessment, 18*(3), 291–304. [https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1468-2389.2010.00512.x](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1468-2389.2010.00512.x)
    *Supports: 17-country meta-analysis; three-tier favorability cluster consistency across cultures; convergence of cross-national reaction patterns. Peer-reviewed meta-analysis.*

17. **Hoang, T. G., Truxillo, D. M., Erdogan, B., & Bauer, T. N. (2012).** Cross-cultural examination of applicant reactions to selection methods: United States and Vietnam. *International Journal of Selection and Assessment, 20*(2), 209–219. [https://onlinelibrary.wiley.com/doi/10.1111/j.1468-2389.2012.00593.x](https://onlinelibrary.wiley.com/doi/10.1111/j.1468-2389.2012.00593.x)
    *Supports: US–Vietnam applicant reaction comparison; differences on personality and biodata; Gilliland framework cross-cultural application. Peer-reviewed.*

18. **Ryan, A. M., Boyce, A. S., Ghumman, S., Jundt, D., Schmidt, G., & Gibby, R. (2017).** Culture and testing practices: Is the world flat? *Applied Psychology: An International Review, 68*(1), 230–274. [https://iaap-journals.onlinelibrary.wiley.com/doi/abs/10.1111/apps.12095](https://iaap-journals.onlinelibrary.wiley.com/doi/abs/10.1111/apps.12095)
    *Supports: 23-country study showing minimal cultural practice variation in selection testing; "surprisingly flat" finding. Peer-reviewed.*

19. **Sakib, M. N., Rayasam, N. M., & Dey, S. (2025).** Experience and adaptation in AI-mediated hiring systems: A combined analysis of online discourse and interface design. *CSCW 2025.* [https://arxiv.org/html/2601.02775v1](https://arxiv.org/html/2601.02775v1)
    *Supports: AI interview failure taxonomy (rigidity, opacity, dehumanization, transcription inequity); neurodivergent exclusion; expectation-reality gap. Peer-reviewed, CSCW venue.*

20. **Ashktorab, Z., Jain, M., Liao, Q. V., & Weisz, J. D. (2019).** Resilient chatbots: Repair strategy preferences for conversational breakdowns. *CHI 2019 Conference on Human Factors in Computing Systems.* [https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300484](https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300484)
    *Supports: Chatbot breakdown taxonomy; user repair preferences; social orientation moderator. Peer-reviewed, CHI venue.*

21. **Cheng, Y., et al. (2023).** User interaction patterns and breakdowns in conversing with LLM-powered voice assistants. *arXiv preprint.* [https://arxiv.org/html/2309.13879v2](https://arxiv.org/html/2309.13879v2)
    *Supports: Six LLM VA breakdown types; repetitiveness and information density as frustration sources; mental model misalignment. Preprint — not peer-reviewed.*

22. **Zhang, H., Liu, Y., Guan, X., Cai, J., & Carroll, J. M. (2026).** Harnessing the power of AI in qualitative research: Role assignment, engagement, and user perceptions of AI-generated follow-up questions in semi-structured interviews. *arXiv preprint.* [https://arxiv.org/html/2509.12709v1](https://arxiv.org/html/2509.12709v1)
    *Supports: AI-generated question failure taxonomy (scope drift, premature exhaustion, timing interference, ethical violations, domain deficiency); question quality + timing coupling. Preprint — peer review status unknown.*

---

*Total sources cited: 22. Of these: 14 peer-reviewed journal articles or meta-analyses, 2 authoritative standards documents (AERA/APA/NCME, SIOP), 2 peer-reviewed conference papers (CHI, CSCW), 2 arXiv preprints (not peer-reviewed), 1 professional society white paper, 1 practitioner blog (NNGroup, convergent evidence).*

*Cross-cultural / demographic variance sources: [13][15][16][17][18][19] (6 sources — exceeds minimum bar of 2).*
*Conversational agent failure taxonomy sources: [19][20][21][22] (4 sources — exceeds minimum bar of 2).*
*Peer-reviewed meta-analyses / authoritative standards: [2][7][8][12][13][16] (6 sources — exceeds minimum bar of 3).*
