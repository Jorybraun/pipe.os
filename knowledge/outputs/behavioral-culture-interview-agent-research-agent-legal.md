> **STATUS: RESEARCH FILE (R4)** · Created 2026-04-07 11:04
> **Research run:** `behavioral-culture-interview-agent`
> **Researcher:** R4 — Agent Architecture + Legal/Ethics (Illinois AIVIA HB 3773, EEOC compliance, agent state machines, ReAct)
> **Role in run:** Primary-source research on agent architecture patterns and legal/regulatory constraints for AI interview systems
> **Use for:** Looking up source citations when the final brief cites `[R4-S<n>]`
> **Navigate:** [INDEX](../INDEX.md) · [final brief](./behavioral-culture-interview-agent.md)

---

# R4: Agent Architecture & Legal/Ethics

> **Researcher:** R4  
> **Date:** 2026-04-07  
> **Scope:** (A) Conversational interview agent design for behavioral/STAR interviews; (B) Legal, ethical, and bias landscape for AI-conducted hiring interviews  

---

## Part A: Conversational Interview Agent Design

### Architecture Patterns

Four main paradigms are used (often in combination) for conversational interview agents:

**1. Finite State Machine (FSM) / Flow-Based**  
The classic approach: interview progress is a directed graph of states (greeting → question-1 → probe → question-2 → close). Each node encodes a question or action; transitions are triggered by response signals (completeness, topic detection, timeout). FSMs give deterministic, auditable control over interview pacing and question ordering — important for compliance. The weakness is rigidity: every off-topic or unexpected response requires explicit fallback arcs. Rasa CALM (Conversational AI with Language Models) extends this model by pairing predefined task *flows* with an LLM-based `CommandGenerator` that interprets user intent and drives state transitions. This hybrid gives you FSM control without enumerating every intent variant. [S14]

**2. ReAct-Style (Reason + Act Loop)**  
Yao et al. (ICLR 2023) introduced ReAct, which interleaves a model's *thought* (internal reasoning trace), *action* (a tool call or utterance), and *observation* (user response or tool result) in a single loop. Applied to interviews, the agent reasons: *"Candidate mentioned a project but omitted the Result — I should probe for outcome."* Then it generates a targeted follow-up, observes the candidate's reply, and reasons again. ReAct agents handle novel situations gracefully and produce an auditable reasoning chain. The risk is that the loop can go off-script or generate reasoning chains that are too long for a natural interview cadence. [S3, S4]

**3. Multi-Agent / Orchestrator + Specialist Architecture**  
For more complex deployments, a lead *Orchestrator* agent tracks overall interview state, topic coverage, and pacing while delegating to specialist sub-agents (question generator, response evaluator, follow-up selector, transcript summariser). Each sub-agent operates in a focused context window and returns a compact result (scores, flags, candidate utterance) to the orchestrator. Anthropic's engineering team found this pattern delivers "substantial improvement over single-agent systems on complex research tasks" by isolating detailed analysis context within sub-agents and keeping the lead agent focused on synthesis. [S13]

**4. Memory-Augmented / Context-Engineered**  
All architectures benefit from structured memory:
- **Short-term (in-context):** The rolling transcript, current question set, and slot values (STAR components filled so far) in the system/user message.
- **Working memory (scratchpad/notes):** A persistent `notes.md` file or JSON scratchpad the agent updates after each exchange — e.g., "Q2: Situation + Task captured; Result missing. Flag for probe." Anthropic's context engineering research shows this lets agents maintain "precise tallies across thousands of steps" and recover coherence after context resets. [S13]
- **Long-term semantic store:** Embeddings of prior candidate statements retrieved via RAG to detect contradictions or build on earlier context across a 30–45-minute session.

**Recommended hybrid for a production async interview agent:**  
FSM/flow backbone (deterministic question ordering, pacing, topic coverage) + ReAct reasoning layer (decides whether to probe, redirect, or advance) + working-memory scratchpad (tracks STAR slot completeness) + sub-agent evaluator (scores responses independently, feeds signals back to orchestrator). [S3, S13, S14]

---

### Follow-up Probe Generation Strategies

**Core principle:** probe only when the new information extracted is worth the candidate's time and goodwill — i.e., when a gap in the STAR arc actually affects scoring. Over-probing feels interrogative; under-probing leaves gaps in evidence.

**Taxonomy of follow-up triggers** (from ACL 2025 industry paper using Bloom's Taxonomy and Grice's Maxims):

| Trigger | What to ask | Example probe |
|---------|-------------|---------------|
| **Missing STAR component** | Elicit the absent element | "What was the specific outcome of that decision?" |
| **Vague quantifier** | Request specificity | "When you say the project was 'large', can you give me a sense of team size or timeline?" |
| **Attribution ambiguity** | Clarify the candidate's personal role | "Was that your decision alone, or a team decision?" |
| **Claim without evidence** | Surface concrete behaviour | "Can you walk me through how you actually handled that conversation?" |
| **Curiosity / depth** | Explore reasoning or learning | "What would you do differently now?" |

[S2, S5]

The FollowupQG framework (IJCNLP-AACL 2023, arXiv 2309.05007) modelled information-seeking follow-up question generation as a seq2seq task over 3,000+ real-world conversational QA pairs. Key finding: effective follow-ups are **information-asymmetric** — the asker knows that something is missing (a number, a causal link, a time bound) and frames the probe around that exact gap, rather than restating the prior question. This aligns well with STAR completeness detection. [S6]

**When to probe vs. move on:**  
- **Probe (max 2 follow-ups per question):** Missing Result or Action element; Impact stated in vague terms; Candidate asserts a skill without a behavioural example; Time or scope is absent and material to scoring.  
- **Move on:** Three or more complete STAR elements are present; Candidate has answered the same sub-question twice; Remaining probe would only add marginal scoring signal; Time budget for this question is exhausted (async timer or token budget).

---

### Handling Difficult Responses

**a) Evasive / vague answers**  
Acknowledge the content, then ask a *precision probe*: restate the vague element back as a concrete question. Example: *"You mentioned you 'helped with' the migration — what specifically was your contribution to the technical design?"* Avoid yes/no prompts; use open-ended *"walk me through"* or *"what did you personally do"* phrasing. If evasion persists across two probes, record the pattern and move on — the scoring model will reflect the missing specificity. [S2, S14]

**b) Off-topic responses**  
Rasa CALM's conversation repair patterns handle topic drift through *clarification links* that steer back to the open slot without abrupt interruption. The recommended pattern: (1) briefly acknowledge the off-topic information, (2) use a transitional bridge — *"That's helpful context. Returning to [topic] — [re-state the question more narrowly]."* Never hard-ignore the candidate's text; this reads as robotic. [S14]

**c) Overly brief answers (< 50 words, single STAR element)**  
Use a *scaffolding probe* — offer the missing structural framing. Example: *"Could you tell me a bit more about the situation you were in when that happened, and what you personally did to resolve it?"* This is less interrogative than point-blank "say more" and guides the candidate toward the STAR structure without revealing the scoring rubric. For genuinely terse candidates, a *calibration statement* helps: *"We're looking for detailed examples — feel free to take your time."*

**d) Very long / rambling answers**  
Async text interviews can receive 800–1,200-word responses that bury the STAR elements in narrative filler. The agent should: (1) extract and score the STAR elements from the full text; (2) in its reply, demonstrate it heard the key points (one-sentence reflection); (3) pose the *next* question without asking for elaboration. Do not truncate or penalise length in scoring — evaluate the density of concrete evidence vs. word count as a signal.

---

### STAR Completeness Detection

A STAR response is *complete enough to score* when it contains identifiable content for at least three of four elements at sufficient specificity:

| Element | Completeness signal | Weak signal |
|---------|---------------------|-------------|
| **S**ituation | Named context (project, team, timeframe) | "A time at work" |
| **T**ask | Stated ownership / responsibility | Vague "we had a problem" |
| **A**ction | Specific first-person steps taken | "We worked on it" |
| **R**esult | Quantified or observable outcome | "It went well" |

**Practical heuristics:**
1. **Slot-filling model:** Maintain a structured JSON object `{situation: null, task: null, action: null, result: null}` and update after each turn via LLM extraction. A response is *provisionally complete* when all four slots are non-null. *Sufficiently complete* requires at minimum S + A + R with specificity markers.
2. **Specificity classifier:** Score each element on a 3-point scale: 0 = absent, 1 = vague/generic, 2 = specific/concrete. Total ≥ 5 from 4 elements = no probe needed. Total ≤ 3 = probe required.
3. **Attribution check:** Is the candidate the grammatical subject of the Action sentences? If the pronoun is "we" throughout, a clarification probe may be needed.
4. **Temporal anchor:** Does the candidate describe a *specific past event* or a hypothetical/habitual pattern? Behavioural interviewing requires the former; a probe is needed if the answer is hypothetical ("I would usually...").

UpTrain's *Response Completeness* evaluator (open source) operationalises this as: "Has the response answered all the aspects of the question specified?" It outputs a 0–1 score per dimension, usable as a probe trigger threshold. [S15]

---

### Conversation Flow Design

The ideal async behavioral interview session follows five phases:

```
1. WARM-UP (1 exchange)
   ├─ Agent: personalised greeting, job title, timeline/format explanation
   ├─ Agent: discloses AI nature and purpose [required — see Part B]
   └─ Candidate: any questions before starting?

2. CALIBRATION QUESTION (1–2 exchanges)
   ├─ A low-stakes open question ("Tell me about a recent project you're proud of")
   ├─ Purpose: calibrate response length, adjust probing strategy
   └─ No scoring — rapport-building only

3. CORE BEHAVIORAL QUESTIONS (3–5 questions, each 2–4 exchanges)
   ├─ Present question
   ├─ Evaluate STAR completeness
   ├─ 0–2 targeted follow-up probes
   ├─ Optional: brief acknowledgment ("Thank you, that's helpful")
   └─ Transition ("Moving on to the next area...")

4. CLOSING (1 exchange)
   ├─ Candidate's turn: "Do you have questions about the role?"
   ├─ Agent: next steps / timeline / what happens with their responses
   └─ Warm sign-off

5. POST-SESSION (background)
   ├─ STAR extraction and scoring
   ├─ Anomaly detection (very short/long, off-topic ratio)
   └─ Summary generation for recruiter
```

**Key design principles:**
- **Acknowledge before advancing.** A brief reflection (*"Thanks for sharing that example"*) before the next question maintains rapport and avoids the mechanical ping-pong feel.
- **Signal transitions explicitly.** *"I'd like to shift to a different area now"* reduces disorientation for candidates.
- **Manage time transparency.** Async interviews should inform candidates of expected total duration and progress (e.g., "Question 2 of 4"). This reduces abandonment.
- **Close with candidate agency.** Giving candidates a questions-to-ask slot (even if answered briefly) significantly improves perception of fairness. [S9]

---

### Memory & Context Management

For a 30–45-minute async interview (typically 300–1,500 tokens per exchange × 15–25 exchanges = 5,000–37,000 tokens):

**1. Structured working memory (scratchpad)**  
Maintain a compact JSON scratchpad updated after each turn:
```json
{
  "candidate_id": "c_xyz",
  "questions_completed": [1, 2],
  "current_question": 3,
  "q1_star": {"S": 2, "T": 1, "A": 2, "R": 1, "probes_used": 1},
  "q2_star": {"S": 2, "T": 2, "A": 2, "R": 2, "probes_used": 0},
  "q3_star": {"S": 0, "T": 0, "A": 0, "R": 0, "probes_used": 0},
  "running_themes": ["ownership", "cross-functional collaboration"],
  "anomalies": []
}
```
This scratchpad is prepended to the system prompt at each turn, keeping critical state fresh without inflating the transcript window. [S13]

**2. Rolling summary / compaction**  
Anthropic's context engineering research describes *compaction*: when the transcript approaches window limits, pass the full history to the model to produce a compressed summary preserving "architectural decisions, unresolved bugs, and implementation details while discarding redundant tool outputs." Applied to interviews: compress earlier exchanges into a structured summary (STAR slots filled, probe results, notable quotes) and drop raw transcript. This enables coherent 45-minute sessions without hitting context limits. [S13]

**3. Sliding window with pinned key exchanges**  
Keep: (a) the system prompt + scratchpad, (b) the current question + the last 3 exchanges, (c) pinned verbatim quotes from prior answers that the agent may need to reference (e.g., if candidate contradicts themselves). Drop: routine acknowledgment turns, fully-resolved STAR exchanges.

**4. FlowKV (research-stage)**  
FlowKV (arXiv 2505.15347) proposes isolated KV-cache management per conversational turn, allowing selective preservation of past-turn representations without full re-encoding. Relevant for production systems processing many concurrent interviews where cache efficiency matters. [S16]

**5. Cross-session persistence (if candidate returns)**  
Store extracted STAR slots, anomaly flags, and score signals in durable storage (D1/database). Re-inject into context on session resume as a structured brief, not raw transcript.

---

### Open-Source Implementations

| Framework/Repo | Language | Architecture | Notes |
|---|---|---|---|
| **Rasa CALM** | Python | FSM + LLM CommandGenerator | Full production framework; conversation repair, slot-filling, multi-turn dialogue [S14] |
| **LangGraph** (LangChain) | Python | Graph-based agent orchestration | State machine with LLM nodes; used in multiple interview prep implementations [S7, S8] |
| **anand-106/Mock_Interview_agents_using_Langchain** | Python/JS | LangChain multi-agent | Open source mock interview agents; multi-agent pattern [S7] |
| **StephaneWamba/InterviewLab** | Python/Next.js | LangGraph + LiveKit + FastAPI | Real-time voice interview with code execution sandbox [S8] |
| **vivian-my/FollowupQG** | Python | Seq2seq follow-up generation | Dataset + model for information-seeking follow-up Qs, directly applicable to probe generation [S6] |
| **UpTrain** | Python | LLM evaluation pipeline | Open-source `ResponseCompleteness` evaluator; usable as a STAR completeness detector [S15] |
| **Anthropic Claude + MCP** | Any | Context management + memory tool | Memory tool (public beta) for structured note-taking across long sessions [S13] |

---

## Part B: Legal, Ethical & Bias

### Illinois AEIA

**Statute:** Illinois Artificial Intelligence Video Interview Act (AIVIA), 820 ILCS 42/, effective January 1, 2020; expanded by HB 3773, effective January 1, 2025. [S1]

**Core requirements (original 2020 act):**
1. **Pre-interview written disclosure** — employer must inform the candidate in writing that AI will be used to analyse their interview, what it evaluates, and how it influences decisions.
2. **Written/recorded consent (opt-in)** — explicit informed consent before AI analysis begins; consent may be withdrawn at any time without penalty.
3. **Alternative non-AI pathway** — refusal to consent cannot disqualify a candidate; a non-AI evaluation option must be offered.
4. **Data deletion within 30 days** on candidate request; AI-generated data cannot be retained beyond this window.
5. **Vendor disclosure** — candidates must be told which AI vendor is used and given access to data retention policies.

**2025 expansion (HB 3773)** extends scope to:  
- AI resume-screening tools  
- AI-scored skills assessments  
- Candidate ranking/sorting algorithms  
- Willful violations now carry penalties up to **$2,500 per violation** (previously $500–$1,000).

**Does AIVIA apply to text-based async interviews?**  
The original 2020 statute is narrowly scoped to "video" interviews and AI analysis of "facial expressions, speech patterns, tone, and non-verbal cues." A **text-only** async interview agent that does not process video or audio would **not** be covered by the original AIVIA. However, the 2025 expansion captures AI skills assessments and candidate ranking algorithms regardless of modality. A text-based interview agent that generates scores or rankings used in hiring decisions in Illinois almost certainly falls under HB 3773 as of January 1, 2025. Additionally, if the text interview platform captures any biometric signals (typing cadence, timing), Illinois BIPA (740 ILCS 14/) may separately apply. [S1, S10]

**Jurisdiction:** Applies to any employer hiring for an Illinois role, or where the applicant resides in Illinois, regardless of employer headquarters.

---

### EEOC Guidance on AI Hiring

**Key guidance documents:**
- EEOC + DOJ Joint Technical Assistance on ADA and AI (May 2022) — focused on "screen-out" risk for disabled candidates [S11]
- EEOC Technical Assistance: *Select Issues: Assessing Adverse Impact in Software, Algorithms, and AI Used in Employment Selection Procedures Under Title VII* (May 2023) [S11]
- EEOC Brief: *What is the EEOC's Role in AI?* (April 2024) [S12]

**Core positions:**

1. **Employers remain liable regardless of vendor origin.** If an AI tool a vendor provides causes disparate impact, the employer using it bears Title VII liability — even if the vendor's own bias testing was incorrect. The EEOC explicitly stated: "Employers should consider conducting their own assessments." [S11]

2. **Algorithmic tools as selection procedures.** Any AI tool used "as a basis for an employment decision — hiring, promotion, termination" is a selection procedure subject to the 1978 Uniform Guidelines on Employee Selection Procedures (UGESP). This includes chatbot pre-screeners, video interview analyzers, and virtual assistants that interact with candidates. [S11]

3. **Four-fifths rule is insufficient alone.** The EEOC warned that the 80% (four-fifths) adverse impact rule is "not always appropriate" — smaller statistical differences may still constitute adverse impact at scale. Employers should also evaluate *statistical significance*, not just ratio-based tests. [S11]

4. **Ongoing monitoring required.** The EEOC recommends self-analysis on an "ongoing basis," not only at initial deployment. [S11]

5. **Title VII protected classes:** Race, color, religion, sex (incl. gender identity, sexual orientation, pregnancy), national origin, age (40+), disability, genetic information. AI tools must not produce disparate impact on any of these. [S12]

**Note on Trump administration rollback:** The 2022 ADA AI guidance was removed from the EEOC website in January 2025. However, the underlying Title VII and ADA statutes remain unchanged — the removal of agency guidance does not alter employer obligations under the law. [S17]

---

### EU AI Act

**Regulation:** EU Regulation 2024/1689 (the AI Act), entered into force August 1, 2024. [S9]

**Classification of AI hiring tools:**  
Employment-related AI systems are explicitly listed in **Annex III, Category 4** as **high-risk systems**. This covers:
- Recruitment and candidate screening
- Candidate evaluation and scoring
- Performance monitoring
- Targeted job advertising using AI
- Candidate ranking/sorting algorithms [S9, S10]

**Key obligations for deployers (entities using AI in hiring):**

| Obligation | What it requires |
|---|---|
| **Risk assessment** | Mandatory conformity assessment before deployment |
| **Technical documentation** | Document training data, architecture, bias test results |
| **Bias monitoring** | Continuous monitoring for discriminatory outcomes; ensure training data is representative |
| **Human oversight (Article 14)** | Qualified humans must be able to detect and override AI outputs; no final placement/rejection decisions by AI alone |
| **Candidate transparency (Article 26(7))** | Workers and candidates must be informed that AI is used, how it functions, and what role it plays in decisions |
| **Right to explanation (Article 86)** | Candidates may request an explanation of the main factors behind AI-influenced decisions |
| **Log retention** | Deployers must retain system logs for at least 6 months |
| **AI literacy** | Staff exercising oversight must be trained; AI literacy obligations already in effect (since Feb 2025) |

**Timeline:**
- August 1, 2024: Act entered into force
- February 2025: Prohibited practices take effect (includes emotion recognition in workplaces with some exceptions; biometric categorisation)
- **August 2, 2026:** Full high-risk system obligations (Annex III) enforceable — including all employment AI

**Penalties:** Up to €15 million or 3% of global annual turnover for violations of high-risk obligations; up to €35 million or 7% for prohibited AI practices. [S9, S10]

**Extraterritorial reach:** Applies if AI output affects persons in the EU, regardless of where the employer is headquartered. [S9]

**Note on Article 6(3) exemptions:** AI systems that perform only narrow procedural tasks (e.g., document sorting) may be exempt. However, any system that profiles candidates (evaluates suitability, predicts performance) is almost certainly not exempt — profiling under GDPR Article 4(4) removes the Article 6(3) exemption. [S9]

---

### Documented Demographic Biases

**1. Racial and gender bias in LLM resume screening (Brookings / AAAI AIES 2025)**  
A simulation of LLM-based resume screening across 550 resumes and 571 job descriptions found:
- **Gender bias:** Men's names preferred over women's in 51.9% of cases; equal selection in only 37% of tests across three large embedding models.
- **Racial bias (severe):** White-associated names preferred in 85.1% of tests; Black-associated names preferred in only 8.6%.
- **Intersectional harm:** Names associated with Black men were selected 0% of the time vs. white men's names in direct comparison — the most severe disparity, which single-axis analysis would obscure.
- Study used E5-Mistral-7b-Instruct, GritLM-7B, and SFR-Embedding-Mistral models. [S17]

**2. HireVue FTC complaint (EPIC, 2019)**  
The Electronic Privacy Information Center filed an FTC complaint against HireVue, alleging:
- Facial expression analysis encoded racial and gender stereotypes into scoring
- Proprietary algorithm trained on existing employee profiles propagated historical hiring biases
- Candidates were not informed of what was being measured or why
- HireVue subsequently dropped facial expression analysis (2021) after public pressure [S18]

**3. ACLU complaint on "bias-free" claims**  
The ACLU filed an FTC complaint against Predictim and similar vendors for marketing hiring assessments as "bias-free" without evidence; the complaint argued that automated personality/trait scoring from text and video encodes cultural and linguistic norms that disadvantage non-native speakers and candidates from minority backgrounds. [S19]

**4. Accent bias in automated and AI-mediated interviews**  
A meta-analysis in the *International Journal of Selection and Assessment* (Wiley, 2025) found that accent bias in employee interviews is moderated by interview modality — structured and automated interviews show accent effects, with non-native accented speech associated with lower perceived competence ratings even when controlling for content. This is particularly relevant for ASR-based or voice-analysing interview tools. [S20]

**5. Amazon's scrapped AI recruiter (2018)**  
Amazon abandoned an internally-developed AI resume ranker after discovering it penalised resumes from graduates of all-women's colleges and downgraded CVs containing the word "women's." The system had been trained on historical (male-dominated) hiring outcomes. [Referenced in S17]

**6. Disability bias in AI scoring**  
Research found that resumes mentioning disability-related awards or recognitions received worse AI screening outcomes than identical resumes without those mentions — demonstrating that indirect proxies for protected characteristics can produce ADA-actionable disparate impact. [S17]

---

### Mitigation Strategies

**Technical approaches:**

1. **Pre-deployment bias audit with demographic parity testing.** Measure selection rates across protected groups before going live. Use both the four-fifths rule AND statistical significance tests (EEOC's recommendation). For a behavioral interview scorer, this means synthetic or real candidate data stratified by demographic group. [S11, S17]

2. **Intersectional testing.** Audit for combinations of race × gender, not just each axis independently. California's intersectionality law (2024) and Brookings research both show that single-axis audits systematically understate harm. [S17]

3. **Fairness constraints at inference time.** Constrained optimisation at scoring layer: calibrate score distributions to be comparable across demographic groups. Approaches include re-weighting, post-hoc calibration (Platt scaling per group), and counterfactual fairness constraints. [S11]

4. **Decouple content scoring from style scoring.** STAR behavioral scoring should evaluate the *content* of what the candidate describes (specificity, relevance, ownership, outcome) rather than linguistic style, vocabulary richness, or fluency markers — which correlate with socioeconomic background, native language, and education. [S17, S20]

5. **Remove explicit demographic proxies from model inputs.** Names, graduation year, geographic identifiers, and certain institutional affiliations are demographic proxies. Strip or hash these before scoring (though Brookings research notes this is insufficient alone — indirect proxies remain). [S17]

6. **Continuous monitoring post-deployment.** EU AI Act requires this; EEOC recommends it. Track pass-rate parity quarterly and re-audit after significant model updates. [S9, S11]

**Procedural approaches:**

7. **Human-in-the-loop for final decisions.** No candidate should be rejected solely by AI output. Human review of AI-flagged candidates — particularly those just below a pass threshold — is required under EU AI Act Article 14 and recommended by EEOC. This also reduces automation bias risk. [S9, S11]

8. **Structured rubric scoring, not holistic AI judgment.** Define explicit, dimension-level scoring rubrics (e.g., STAR slot completeness × 4 + specificity × 3 + role clarity × 2) rather than asking the LLM to give a single holistic score. Structured rubrics are more auditable and less susceptible to style/proxy bias. [S11]

9. **Third-party bias audits.** NYC Local Law 144 (effective July 2023) requires employers using Automated Employment Decision Tools (AEDTs) in NYC to conduct independent bias audits annually and publish summary results. Colorado SB24-205 (effective 2026) adds similar requirements. Commission an external audit before and after major model changes. [S17, S21]

10. **Candidate recourse mechanism.** Allow candidates to flag concerns about the AI assessment and request human review. Colorado's SB24-205 explicitly grants candidates the right to appeal adverse AI decisions. [S17]

---

### Disclosure Requirements

**What candidates must be told — jurisdiction by jurisdiction:**

| Jurisdiction | Law | Requirement | Modality scope |
|---|---|---|---|
| **Illinois** | AIVIA (820 ILCS 42/) | Written notice + explicit opt-in consent; must name AI vendor; must offer non-AI alternative | Video (2020); expanded to all AI assessments (2025) |
| **New York City** | Local Law 144 | Notify candidates that an AEDT will be used; publish bias audit results publicly; allow candidates to request alternative process | AI tools that "substantially assist or replace" human hiring decisions |
| **Colorado** | SB24-205 (2026) | Disclosure when AI makes "consequential decisions" in employment; right to appeal adverse AI decisions | Broad — employment AI |
| **EU** | AI Act Art. 26(7) + Art. 86 | Inform candidates before AI deployment; explain main factors in AI-influenced decisions upon request | All high-risk employment AI |
| **Canada (Ontario)** | AODA / proposed AI rules | Proposed 2025–2026: disclose AI use in job postings; candidates must be informed | Under development |

**Practical minimum disclosure (recommended for any jurisdiction):**
1. State clearly that the interview is AI-conducted or AI-evaluated.
2. Explain what the AI measures (e.g., "structured behavioral responses evaluated for specificity and relevance").
3. State that a human will review results before any hiring decision is made.
4. Provide a contact for questions or concerns about the AI assessment.
5. Confirm data retention and deletion rights (especially for Illinois candidates).

**Ethical best practice beyond legal minimum:** Offer the candidate an easy link to a human-interview alternative, even where not legally required. SHRM research shows this significantly improves candidate experience and perceived fairness — which in turn affects employer brand and candidate conversion rates. [S22]

---

## Key Sources

| # | Title | Year | URL / ArXiv | Key Finding |
|---|---|---|---|---|
| S1 | Illinois AIVIA Compliance Guide (EmployArmor) | 2026 | https://www.employarmor.com/law/illinois-aivia | Comprehensive analysis of 820 ILCS 42/ including 2025 HB 3773 expansion |
| S2 | Generating Follow-Up Questions Using Bloom's Taxonomy and Grice's Maxims (ACL 2025) | 2025 | https://aclanthology.org/2025.acl-industry.93.pdf | Probe generation using information-gap and maxim-violation signals |
| S3 | ReAct: Synergizing Reasoning and Acting in Language Models (Yao et al., ICLR 2023) | 2023 | https://arxiv.org/abs/2210.03629 | Thought-action-observation loop for LLM agents; foundational architecture |
| S4 | The ReAct Pattern Deep Dive (Arun Baby) | 2025 | https://arunbaby.com/ai-agents/0014-react-pattern-deep-dive/ | Applied ReAct pattern walkthrough for production agents |
| S5 | What Should I Ask: Knowledge-driven Follow-up Generation in Conversational Surveys (Ge et al., UIUC) | 2023 | https://www.ziangxiao.com/pdf/[p]Xiao_2023_What_should_I_Ask... | Knowledge-graph-driven probing strategy for conversational information gathering |
| S6 | FOLLOWUPQG: Towards Information-Seeking Follow-up Question Generation | 2023 | https://arxiv.org/abs/2309.05007 | 3K+ real-world follow-up QA dataset; seq2seq probe generation; information-asymmetry model |
| S7 | Mock_Interview_agents_using_Langchain (anand-106, GitHub) | 2025 | https://github.com/anand-106/Mock_Interview_agents_using_Langchain | Open-source LangChain multi-agent interview implementation |
| S8 | InterviewLab (StephaneWamba, GitHub) | 2024 | https://github.com/StephaneWamba/InterviewLab | LangGraph + LiveKit real-time voice interview with feedback |
| S9 | EU AI Act for Staffing Businesses (artificialintelligenceact.eu) | 2026 | https://artificialintelligenceact.eu/what-the-act-means-for-staffing-businesses/ | Annex III Cat. 4 classification; Aug 2026 compliance deadline; penalties |
| S10 | HR & Recruitment AI High-Risk Under EU AI Act (ClearAct) | 2025 | https://clearact.net/de/articles/hr-recruitment-ai-the-most-common-high-risk-category-under-the-eu-ai-act | Obligations for deployers; Article 6(3) exemption analysis |
| S11 | EEOC Technical Assistance: AI and Adverse Impact Under Title VII (May 2023) | 2023 | https://ogletree.com/insights-resources/blog-posts/eeoc-issues-new-guidance-on-employer-use-of-ai-and-disparate-impact-potential/ | Four-fifths rule insufficiency; employer liability for vendor tools; ongoing assessment |
| S12 | What is the EEOC's Role in AI? (EEOC, April 2024) | 2024 | https://www.eeoc.gov/sites/default/files/2024-04/20240429_What%20is%20the%20EEOCs%20role%20in%20AI.pdf | EEOC enforcement role; protected classes; AI as selection procedure |
| S13 | Effective Context Engineering for AI Agents (Anthropic, 2025) | 2025 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | Compaction, structured note-taking, sub-agent architectures for long-horizon coherence |
| S14 | Rasa CALM Conversation Design Documentation | 2025 | https://rasa.com/docs/learn/best-practices/conversation-design/ | FSM + LLM hybrid; conversation repair patterns; slot-filling |
| S15 | UpTrain Response Completeness Evaluator | 2024 | https://docs.uptrain.ai/predefined-evaluations/response-quality/response-completeness | Open-source LLM response completeness scoring; usable as STAR probe trigger |
| S16 | FlowKV: Enhancing Multi-Turn Conversational Coherence via Isolated KV Cache Management | 2025 | https://arxiv.org/html/2505.15347v1 | Per-turn KV cache isolation for improved long-session coherence in LLMs |
| S17 | Gender, Race, and Intersectional Bias in AI Resume Screening (Brookings / AAAI AIES 2025) | 2025 | https://www.brookings.edu/articles/gender-race-and-intersectional-bias-in-ai-resume-screening-via-language-model-retrieval | Black men selected 0% vs. white men; 85.1% preference for white-associated names |
| S18 | EPIC FTC Complaint Against HireVue (Electronic Privacy Information Center) | 2019 | https://epic.org/wp-content/uploads/privacy/ftc/hirevue/EPIC_FTC_HireVue_Complaint.pdf | Facial expression analysis encodes racial/gender stereotypes; lack of transparency |
| S19 | ACLU FTC Complaint: Hiring Vendor "Bias-Free" Claims | 2021 | https://www.aclu.org/press-releases/aclu-files-ftc-complaint-against-major-hiring-technology-vendor | Deceptive bias-free marketing; automated trait scoring disadvantages minorities |
| S20 | Meta-Analysis of Accent Bias in Employee Interviews (IJSA, Wiley 2025) | 2025 | https://onlinelibrary.wiley.com/doi/10.1111/ijsa.12519 | Accent bias persists in structured and automated interview formats |
| S21 | NYC Local Law 144 — Automated Employment Decision Tools (NYC Rules) | 2023 | https://rules.cityofnewyork.us/rule/automated-employment-decision-tools-updated/ | First US mandatory annual bias audit + public disclosure for AEDTs |
| S22 | AI in Hiring: Why Transparency Matters More Than Ever (SHRM) | 2025 | https://www.shrm.org/executive-network/insights/ai-hiring-why-transparency-matters-more-than-ever | Transparency and candidate-control options significantly improve perceived fairness |

---

## Gaps & Next Steps

**Gaps not fully answered:**
1. **STAR completeness detection at scale** — no peer-reviewed benchmark exists for automated STAR element extraction accuracy across diverse demographic groups. Building an internal labeled dataset would be important before production deployment.
2. **Async text interview agent vs. synchronous voice** — most regulatory guidance and academic bias research focuses on video/voice AI. The legal applicability of AIVIA 2020 to text-only agents remains a grey area pending Illinois IDOL clarification or case law.
3. **Long-session coherence benchmarks** — FlowKV and similar research is nascent; no production benchmark exists for multi-turn behavioral interview coherence beyond 20 exchanges.
4. **Intersectional bias in *text-only* behavioral scoring** — Brookings study covers resume screening; there is limited published research on bias in scored *free-text* behavioral interview responses specifically.

**Recommended next steps:**
- Consult Illinois employment counsel on whether a text-based async interview agent with candidate scoring constitutes an "AI skills assessment" under HB 3773.
- Build or commission a bias audit protocol using demographic-parity testing on pilot interview data before launch.
- Implement a candidate disclosure screen before any AI interview begins, even if not yet operating in Illinois or NYC.
- Design the scoring rubric at the dimension level (STAR slots + specificity) rather than holistic LLM scoring to maximise auditability and minimise proxy-bias risk.
