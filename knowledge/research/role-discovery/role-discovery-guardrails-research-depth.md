# R4-depth — Probing Depth, Pivot Signals, Per-Turn Consistency Classifier

_Research date: 2026-04-17. Minimum evidence bar: 14 cited sources, 3 empirical studies with numeric thresholds, 2 clinical-protocol documents, 2 NLP/dialogue-act papers._

---

## 1. Laddering Depth — Empirical Thresholds

### 1.1 The means-end chain model

Reynolds & Gutman (1988) [S1] defined laddering as a one-on-one interviewing technique that traces the chain: **concrete product attribute → functional consequence → psychosocial consequence → terminal personal value**. The canonical ladder therefore has **three to four distinct abstraction levels**, though the full Attributes → Consequences (functional) → Consequences (psychosocial) → Values path spans **four rungs** [S1][S2].

Grunert & Grunert (1995) [S2] formalized the elicitation procedure: the interviewer asks "why is that important to you?" at each rung until the respondent can no longer go higher or begins producing circular responses. Their methodological review establishes no single fixed stopping depth but identifies **circular or repeated answers** as the primary signal that the chain has reached its ceiling [S2].

### 1.2 Empirically observed chain depths

Three sources converge on a numeric range:

- **Human-moderated sessions average 3–4 rungs** before reaching either a terminal value or interviewee fatigue. AI-moderated sessions can reach **5–7 rungs** because adaptive probing eliminates dead time [S3] (single source — unverified for the AI figure; human average is consistent with [S1][S4]).
- The standard means-end chain progresses through **three mandatory levels** (attribute → consequence → value), with a fourth optional psychosocial-consequence rung. Empirical consumer studies consistently recover chains of this length [S4][S5].
- Wansink (2003) [S4] recommends continuing "why is that important to you?" probes only until the respondent "reaches a terminal value (they cannot go higher) or begins circular responses." No fixed numerical ceiling is stated, but the pattern described produces **3–5 probes per chain** before natural termination. The 5-Whys industrial technique — which Veludo-de-Oliveira et al. (2006) [S5] explicitly connect to laddering — uses five as its upper bound for causal chains, but notes "in practice it might take fewer or more than five."

**Key numeric finding for PIPE:** human laddering converges in **3–4 follow-up levels**; a fifth probe rarely introduces new conceptual information and frequently encounters circular or terminal responses. This range maps to **at most 3 follow-up turns on a single sub-topic** before the agent should treat the chain as exhausted.

### 1.3 Saturation signal taxonomy (inference from [S1][S2][S4][S5])

The literature identifies four conditions that signal laddering saturation:

1. **Circular answers** — the response paraphrases a prior rung (e.g., "because it's important to me").
2. **Terminal-value language** — broad abstractions like "security," "belonging," "happiness" — no higher concept exists.
3. **Refusal or inability to continue** — "I don't know why, it just is."
4. **Response length collapse** — answers become progressively shorter; "yes/no" or one-word replies.

The Kilwinger & van Dam (2021) [S6] methodological reassessment of MEC analysis does not add new stopping criteria but confirms that **constructs not mentioned may still be important** — a caution against treating silence as exhaustion. However, for conversational agents, inferred silence (brief, uncreative answers) remains the practical signal.

---

## 2. Clinical Interviewing — Pivot Heuristics

### 2.1 Motivational Interviewing (Miller & Rollnick)

The MI framework (3rd ed., 2013) [S7] and MITI 4.2 fidelity coding manual [S8] provide the most operationalized guidance of any clinical tradition:

**Reflection-to-question ratio:** Proficient MI practitioners maintain an **R:Q ratio ≥ 1.0** (at least one reflective response per question asked, with a proficiency target ≥ 1.36) [S9]. Exceeding a ratio of ~3 questions in a row without reflection is a codeable fidelity violation in MITI.

**Open-question percentage:** Proficiency benchmark is **≥ 70% open questions** (non-directive follow-ups). The PMC study of proficient practitioners [S9] found 61% open questions in initial encounters, described as meeting the benchmark threshold. Basic competence threshold per MITI is approximately 50%. Closed-question heavy exchanges are associated with sustain talk (resistance) rather than change talk [S7].

**Pivot trigger:** MI does not use a numeric turn count for topic switching. Instead, the practitioner monitors the **change talk / sustain talk ratio**. When a respondent is producing sustained sustain talk — expressing desire not to change direction across multiple consecutive turns — the MI practitioner uses a "strategic reflection" to acknowledge and then pivot: *"It sounds like you've thought a lot about X. Can you tell me what brought you here today?"* [S7]. This is a **content-signal pivot** (the nature of the response triggers the move, not a count).

**Rolling with resistance:** The formal MI concept (now renamed "discord" in 3rd ed.) is activated when the interviewer's probes are producing pushback or defensiveness. The response is not to probe harder but to "shift focus conversationally" [S7] — i.e., to change direction.

**Numeric guidance (single source):** The NCBI chapter on MI [S7] states: *"Follow open questions with at least one reflective listening response — but preferably two or three responses — before asking another question."* This implies a **question-question spacing** norm: no more than 2–3 consecutive questions on a single theme.

### 2.2 NICHD Child Forensic Interview Protocol (Lamb et al.)

The NICHD protocol [S10][S11] provides the strongest documented hierarchy for depth-versus-pivot decisions:

**Funnel principle:** Begin each substantive topic with free-recall open prompts ("Tell me everything about..."). Exhaust open prompts before proceeding to directive questions ("You mentioned X — tell me more about X"). Only introduce option-posing questions ("Did it happen in the morning or the evening?") if crucial details are still missing after directive prompts are exhausted. **Leading questions are prohibited.**

**Topic-exhaustion heuristic:** "Use [open prompts] as often as needed throughout this section" — but in practice NICHD training materials instruct interviewers to treat a topic as exhausted when the child has given "a complete narrative" and directive follow-ups produce no new forensically relevant information. The protocol does not specify a numeric count [S10][S11].

**Critical pivot rule:** Interviewers receive a **strategic break** near the end of the substantive phase to review what has been disclosed; if missing details exist they are addressed with focused follow-ups then, not mid-flow. This separates topic management (stay on topic until exhausted) from repair management (address gaps at a designated checkpoint, not by interrupting current flow) [S11].

**Evidence on over-questioning:** Lamb et al. (2007) [S10] found that option-posing and suggestive questions "contaminate later phases" — even with protocol use, ~25% of elicited information came from non-open prompts, a finding that argues for fewer directive follow-ups, not more.

### 2.3 Investigative journalism / practitioner guidance

Bernstein & Woodward's interviewing principles and Fisher's Cognitive Interview protocol both emphasize **exhausting free recall before narrowing** — a pattern identical to NICHD [S12] (single source for journalism framing; the cognitive interview evidence base is robust). Neither discipline specifies a numeric follow-up count, but both use **content depletion** as the trigger: when the interviewee's free-narrative responses stop introducing new facts, the interviewer pivots.

---

## 3. Dialogue-Act Taxonomies + Topic Shift

### 3.1 DAMSL and SWBD-DAMSL

The DAMSL annotation scheme (Allen & Core, 1997) [S13] organizes dialogue acts across multiple orthogonal dimensions. Topic management is treated as a **secondary dimension modifier** (the `^t` diacritic in SWBD-DAMSL) applied to primary speech acts rather than as a first-class act category. The 42-label SWBD-DAMSL scheme (Stolcke et al., 2000) [S14] — derived from 205,000 utterances in the Switchboard corpus — encodes topic management markers implicitly through:
- Task-management markers (`^t`): utterances that explicitly organize the discourse agenda
- No dedicated "topic shift" label exists in the final 42-category scheme; topic changes are inferred from the sequence of speech acts and are handled by the discourse-level model

**For PIPE:** This means there is no off-the-shelf "pivot needed" label that can be lifted directly from dialogue-act theory. Topic shift is an emergent property of the conversation state, not a single-utterance signal [S13][S14].

### 3.2 Topic shift detection as classification task

Recent NLP work (Lin et al., 2023 — Multi-Granularity Prompts for Topic Shift Detection) [S15] casts topic shift as a **binary boundary classification** task on utterance pairs/triples, using multi-granularity features (label, turn, topic level). The method's signals include:
- **Semantic divergence** between the current utterance and the prior 2–3 turns (embedding cosine similarity drop below threshold)
- **Turn-level vocabulary shift** — new entities or concepts appearing
- **Label-level**: the classifier predicts whether the current utterance continues or breaks the prior topic

Key implication for PIPE: a lightweight per-turn classifier (similar to the consistency classifier in ADR-032) can detect **when the agent's own follow-up questions are semantically similar to already-answered material** — a proxy for topic re-coverage rather than deepening.

### 3.3 PCQPR — Monte Carlo planning for follow-up depth

Guo et al. (EMNLP 2024) [S16] introduced PCQPR, which uses an MCTS-like lookahead to plan follow-up question sequences. The system terminates a follow-up chain when a simulated future response **semantically matches a target outcome** (SimCSE similarity ≥ 0.6) or a **maximum step count** is reached (exact count not published in the paper; 10 MCTS simulations with k=5 actions per node implies a bounded search space). The reflection component allows the planner to backtrack when a probing direction produces diminishing returns. This is the closest published system to a principled depth-budget mechanism for interview-style LLM agents [S16].

---

## 4. Agentic LLM Follow-Up Control

### 4.1 ReAct (Yao et al., 2022)

ReAct [S17] interleaves explicit reasoning traces with tool-calling actions. It does not define a follow-up depth budget for conversational settings, but empirically the benchmarked trajectories on HotPotQA and Fever complete in **2–6 reasoning+action steps**. No formal stopping criterion is published; the agent terminates when it produces a final answer token. Implication: ReAct leaves depth control to the task prompt, not an internal mechanism.

### 4.2 Reflexion (Shinn et al., 2023)

Reflexion [S18] adds verbal self-reflection to episodic memory. Its **hard stopping heuristics** are:
1. If the agent executes **the same action and receives the same response for >3 consecutive cycles**, it self-reflects and changes direction.
2. If the **total number of actions in the current environment exceeds 30**, the agent self-reflects on inefficient planning.
3. Memory window is **truncated to the last 3 self-reflections** to prevent context overflow.

For conversational interviewing, rules 1 and 2 translate directly: if the agent is asking equivalent follow-up questions and getting equivalent answers for 3+ turns, it should switch approach. This is an explicit **same-action repetition heuristic** — consistent with the laddering saturation signals in Section 1.3.

### 4.3 Agent-as-a-Judge (Zhuge et al., 2024)

The Agent-as-a-Judge framework [S19] deploys a **separate evaluator agent** to provide per-step feedback on a primary agent's decision chain, rather than evaluating only final outputs. Empirical evaluation shows ~90% agreement with human expert evaluation vs. ~70% for LLM-as-a-Judge (final-output only). The judge agent operates on process logs, not just answers, enabling intermediate-step quality assessment — directly analogous to what PIPE's consistency classifier does for code review [S19].

### 4.4 CGPO / Mixed-Judges pattern

Xu et al. (2024) [S20] (cited in the LLMs-as-Judges survey) showed that assigning **task-category-specific reward models** ("Mixed Judges") rather than a single universal judge reduces reward-model goal conflicts in RLHF. The key principle is model specialization by task type — the same architecture underlying ADR-032's decision to use a different model family for the consistency classifier than for the implementer.

---

## 5. Consistency Classifier Generalization

### 5.1 The ADR-032 pattern

ADR-032 uses Gemma 4 12B as a per-turn classifier that audits Qwen 2.5-Coder's dialogue decisions during code review (4-axis JSON output). The design principle is: **different model family, per-turn, independent perspective**. The rationale (from PIPE codebase) is that same-family auditing is useless; cross-family provides genuine independence.

### 5.2 Published evidence for the generalization

Multiple lines of evidence support applying this pattern to conversational interview agents:

**LM vs LM (Cohen et al., EMNLP 2023)** [S21]: An examiner LLM probes an examinee LLM in multi-turn interaction, detecting factual inconsistencies that the examinee's single-turn outputs would not reveal. The examiner outperforms confidence-score baselines, confirming that **cross-model dialogue auditing provides signal unavailable to the primary model**. The two-model adversarial setup is functionally identical to PIPE's consistency classifier pattern applied to factual coherence.

**Agent-as-a-Judge** [S19]: Independent agent-evaluators applied to intermediate steps of primary agents achieve 90% human-agreement vs. 70% for output-only judges. This validates per-step (per-turn) evaluation as meaningfully superior to turn-agnostic evaluation.

**Multi-turn LLM evaluation survey (2025)** [S22]: Identifies "recollection, expansion, refinement, and follow-up" as the four key interaction patterns in multi-turn dialogue evaluation. Per-turn consistency checks (e.g., does this follow-up contradict earlier dialogue state?) are explicitly identified as a use case for LLM-as-judge at the turn level.

**CGPO Mixed Judges** [S20]: Cross-model specialization reduces reward conflicts; a classifier trained for "is this follow-up question productive given the dialogue history?" is a natural extension.

**Verdict:** The pattern **generalizes with medium-to-high confidence**. No paper has applied it verbatim to hiring-intake dialogue, so direct evidence is one level of inference removed. However, the convergent support from LM-vs-LM (factual consistency), Agent-as-a-Judge (process audit), and CGPO (mixed judges) is strong. The main risk is prompt-engineering specificity: the classifier's 4-axis rubric must be carefully designed for interview-dialogue acts (not code comments or factual claims) — but the architectural pattern transfers.

**Key design constraint from literature:** The auditor must be **a different model family** from the primary agent — this is validated by the LM-vs-LM approach (same-model auditing is trivially defeated by the model's own consistent biases) [S21][S20].

---

## 6. Productive vs Unproductive Probes

### 6.1 DICE taxonomy (Robinson, 2023)

Robinson's (2023) theoretical review [S23] proposed the DICE taxonomy for probe types in qualitative research interviews:

- **D — Descriptive Detail Probes**: Request sensory or narrative elaboration ("Can you describe what that looked like?"). Productive at early turns.
- **I — Idiographic Memory Probes**: Anchor recall to specific episodes ("Can you remember a particular time when...?"). Productive when generic answers dominate.
- **C — Clarifying Probes**: Resolve ambiguity in prior response ("When you say 'difficult,' what do you mean?"). Productive when vocabulary is underspecified.
- **E — Explanatory Probes**: Elicit causal attribution ("Why do you think that happened?"). Productive at mid-to-late depth; risks circularity at very deep levels.

An **unproductive probe** is implicitly one that (a) re-asks a question the respondent has already answered (re-coverage), (b) applies the wrong type for the current context (e.g., Explanatory probe on a topic the respondent hasn't yet described), or (c) continues past the point of terminal abstraction [S23].

### 6.2 Graesser & Person (1994) — Tutoring dialogue

Graesser & Person (1994) [S24] found that in one-on-one tutoring sessions, **tutor questions accounted for >90% of instances** and were almost exclusively **student-assessment probes** (checking comprehension alignment). Crucially, learning outcomes correlated with **quality of questions, not quantity** — frequency of tutor questions was NOT correlated with achievement; quality (deep reasoning questions vs. surface recall) was [S24]. For PIPE: more follow-ups does not mean better signal; the type and timing matter more.

### 6.3 Respondent fatigue signals

Unimrkt Healthcare qualitative research guidance [S25] documents observable fatigue cues:
- Shortened responses ("yes," "I agree," brief phrases)
- Reduced engagement with follow-up probes — follow-ups yield limited expansion or repeated phrasing
- Generic or rehearsed language
- Accelerated pace with fewer pauses

Causes: "excessive probing or unfocused follow-ups that increase effort without adding clarity" and "repetition across studies and topic framing" [S25]. For PIPE: these signals are algorithmically detectable (response length drop, cosine similarity spike between successive answers).

### 6.4 MI active listening — productive probe indicators

From the MI proficiency analysis [S9] and NCBI textbook chapter [S7]:
- **Productive probe**: an open question that elicits **new information in the response** (measurable via semantic novelty)
- **Unproductive probe**: a directive question that elicits sustain talk / resistance or re-states already-covered ground
- Proficient MI practitioners shifted from elicitation-heavy to reflection-heavy framing **across the interview arc** — fewer questions, more reflections as depth increased [S9]

---

## 7. Recommended Thresholds + Pivot Heuristics for Our Agent

### 7.1 Numeric depth threshold

**Supported recommendation: ≤ 3 follow-up turns on any single sub-topic before forcing a pivot or reflective summary.**

Grounding:
- Laddering literature: human moderated chains reach natural ceiling at 3–4 rungs [S1][S3][S4]; a 4th probe in practice often yields terminal-value language or circular responses
- 5-Whys / soft laddering: 5 is an acknowledged upper bound even in root-cause analysis; 3 is the practical center for interview settings [S5]
- Reflexion: same-response-for-3-cycles triggers self-reflection [S18] — identical heuristic from an entirely different domain
- MI guidance: no more than 2–3 consecutive questions without at least one reflection [S7]

**Caveat:** No single study has experimentally tested "3 follow-ups per topic" as an optimal threshold in hiring-intake dialogue specifically. The 3-turn figure is an inference from convergent evidence across five domains (single source confirmation not available for the exact number). Mark as **moderately grounded convergent inference**, not a direct experimental finding.

### 7.2 Top 3 pivot heuristics from clinical interviewing

**Heuristic 1 — Circular-answer detection (from [S1][S2][S4]):**
If the semantic similarity between the current answer and any prior answer in the same sub-topic chain exceeds a threshold (suggested starting point: cosine similarity ≥ 0.85 on embedding space), treat the chain as exhausted. The agent should produce a reflective summary and move on.

**Heuristic 2 — Sustain-talk / resistance detection (from [S7][S8]):**
If consecutive responses on a single topic show resistance signals (hedging, deflection, topic-avoidance language, very short responses), stop probing that topic. MI's "rolling with resistance / discord" concept maps to: when the response quality degrades, the probe is not the problem — the topic or framing is. Pivot to an adjacent topic or offer a reflection. Do not interpret brief answers as "needs more prompting."

**Heuristic 3 — Exhausted free-recall before narrowing (from [S10][S11]):**
Exhaust open prompts ("Tell me more about X") before asking directive follow-ups ("Was X related to Y?"). This funnel ordering reduces contamination risk. If three open follow-ups have produced only terminal-value or circular responses, the NICHD-derived heuristic says: move to a strategic summary checkpoint, not a fourth directive probe.

### 7.3 Signal combination for the agent

| Signal | Measurement approach | Threshold |
|---|---|---|
| Circular answer | Cosine sim(current answer, previous answers same topic) | ≥ 0.82–0.85 (tunable) |
| Response length collapse | Character count drop to < 20% of first answer length | Sustained over 2 turns |
| Follow-up count | Turn counter per sub-topic | ≥ 3 follow-ups → force pivot |
| Terminal-value language | Regex / classifier for abstraction-ceiling vocabulary | Any match |
| Resistance / deflection | Per-turn consistency classifier (second model) | "off-track" classification |

### 7.4 Consistency classifier — design recommendation

Apply the ADR-032 pattern (second model family, per-turn) with a 4-axis rubric adapted for interview dialogue:

1. **On-topic** — Is this follow-up probe genuinely deepening the topic or re-covering already-answered ground?
2. **Proportionate** — Is the probing depth appropriate to the depth already achieved (i.e., has depth budget been exceeded)?
3. **Probe type fit** — Does the probe type (DICE taxonomy) match the current conversation state (e.g., not deploying Explanatory probes before Descriptive probes)?
4. **Fatigue risk** — Are there response-quality signals (length, vocabulary, similarity) that suggest continued probing is diminishing, not increasing, information yield?

Model family constraint: if the primary role-discovery agent is Gemma-based (per current PIPE routing), the consistency classifier should use a Qwen or Mistral family model (or vice versa) — cross-family independence is the validated principle [S21][S20].

### 7.5 Open questions / gaps

1. **No hiring-specific empirical study**: All numeric thresholds are inferred from consumer-laddering, clinical MI, and forensic interviewing. A direct experiment on AI hiring intake agents varying follow-up depth (1 vs. 2 vs. 3 vs. 4 probes per topic) and measuring information yield + user experience does not appear to exist in the published literature as of April 2026.
2. **Circular-answer threshold calibration**: The 0.82–0.85 cosine-similarity threshold for detecting circular answers is a design suggestion, not an empirically validated number for this domain.
3. **Optimal classifier model size**: ADR-032 chose Gemma 4 12B for the code-review classifier on cost grounds. For dialogue acts (fewer tokens per classification), a smaller model may suffice, but no study compares classifier sizes on interview-dialogue per-turn classification.
4. **Interaction effects**: The literature does not address how depth fatigue interacts with topic ordering — e.g., whether users tolerate deeper probing on self-reported strengths vs. motivations vs. background.

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | Laddering chains span 3–4 abstraction levels; circular answers signal ceiling | Reynolds & Gutman, JAR | 1988 | Peer-reviewed | Strong |
| S2 | Laddering stops when respondent produces circular responses or terminal values | Grunert & Grunert, IJRM | 1995 | Peer-reviewed | Strong |
| S3 | Human moderators average 3–4 levels; AI reaches 5–7 | UserIntuition reference guide | 2024 | Practitioner guide | Moderate (AI figure single source) |
| S4 | Soft laddering continues "why" until dead end; 5-Why upper bound = 5 | Wansink, QMR | 2003 | Peer-reviewed | Strong |
| S5 | Laddering mirrors 5-Whys; both converge in practice in 3–5 probes | Veludo-de-Oliveira et al., TQR | 2006 | Peer-reviewed | Moderate |
| S6 | MEC analysis methodological challenges; silence ≠ exhaustion | Kilwinger & van Dam, Psych & Mktg | 2021 | Peer-reviewed | Moderate |
| S7 | MI: follow open questions with 1–3 reflections before next question; pivot on sustained resistance | Miller & Rollnick / NCBI textbook | 2013 | Clinical protocol | Strong |
| S8 | MITI 4.2 fidelity coding manual; proficiency thresholds for open-question ratio | MINT / MITI 4.2 manual | 2016 | Clinical protocol | Strong |
| S9 | Proficient MI: 61% open questions, R:Q ≥ 1.36; question-heavy style predicts resistance | Moyers et al., PMC | 2016 | Empirical study | Strong |
| S10 | NICHD: exhaust free-recall before directive prompts; option-posing contaminates | Lamb et al., PMC review | 2007 | Peer-reviewed | Strong |
| S11 | NICHD: strategic break to review gaps; topic-exhaustion not numerically defined | NICHD protocol documentation | 2018 | Clinical protocol | Strong |
| S12 | Cognitive interview / journalism: exhaust free-recall before narrowing questions | Forensic interviewing best practices, OJJDP | 2015 | Government doc | Moderate |
| S13 | DAMSL: topic management is a secondary dimension; no dedicated topic-shift label | Allen & Core, DAMSL manual | 1997 | Technical spec | Strong |
| S14 | SWBD-DAMSL: 42-label scheme; topic management encoded as `^t` modifier | Stolcke et al., Computational Linguistics | 2000 | Peer-reviewed | Strong |
| S15 | Topic shift detection via multi-granularity prompts; semantic divergence key signal | Lin et al., 2023 | 2023 | Peer-reviewed | Moderate |
| S16 | PCQPR: MCTS-based follow-up planning; terminates on semantic match or max steps | Guo et al., EMNLP | 2024 | Peer-reviewed | Moderate |
| S17 | ReAct: reasoning+action interleaved; no built-in follow-up budget | Yao et al., ICLR | 2023 | Peer-reviewed | Strong |
| S18 | Reflexion: same-action-3-cycles → self-reflect; >30 actions → reflect on planning | Shinn et al., NeurIPS | 2023 | Peer-reviewed | Strong |
| S19 | Agent-as-a-Judge: per-step evaluation 90% human agreement vs 70% for output-only | Zhuge et al., 2024 | 2024 | Peer-reviewed | Strong |
| S20 | CGPO Mixed Judges: category-specific reward models reduce goal conflicts | Xu et al., cited in LLMs-as-Judges survey | 2024 | Peer-reviewed | Moderate |
| S21 | LM vs LM: cross-model examiner-examinee detects factual inconsistencies via dialogue | Cohen et al., EMNLP | 2023 | Peer-reviewed | Strong |
| S22 | Multi-turn LLM evaluation: per-turn consistency checks as valid evaluation pattern | Multi-turn agent evaluation survey | 2025 | Survey | Moderate |
| S23 | DICE probe taxonomy: D/I/C/E types; unproductive = re-coverage or type mismatch | Robinson, Qual Research in Psych | 2023 | Peer-reviewed | Moderate |
| S24 | Tutoring: question quality (not quantity) predicts learning; >90% probes are assessment | Graesser & Person, AERJ | 1994 | Peer-reviewed | Strong |
| S25 | Interview fatigue: shortened responses, repeated phrasing = unproductive probe signal | Unimrkt Healthcare qualitative guide | 2024 | Practitioner | Moderate |

---

## Direct Implications for the Project

1. **Hard depth limit of 3 follow-up turns per sub-topic.** Laddering, MI, Reflexion, and the 5-Whys technique all independently converge on a 3–4 probe upper bound. Implement a per-topic turn counter; at turn 3, the agent must either produce a reflective summary ("So what I'm hearing is...") or explicitly pivot to the next area. This is the single most actionable numeric finding.

2. **Classify probes before generating them, not after.** The ADR-032 consistency-classifier architecture generalizes directly: a second-family model running per-turn to evaluate the pending follow-up question across 4 axes (on-topic, proportionate, DICE-type fit, fatigue risk) before it is emitted. Cohen et al.'s LM-vs-LM (S21) and Agent-as-a-Judge (S19) both validate that cross-model per-turn audit delivers signal unavailable to the primary model.

3. **Use content signals, not just counts.** The primary pivot trigger should be **circular-answer detection** (cosine-similarity spike between the candidate's current response and prior responses on the same topic) supplemented by the count limit. Clinical protocols (MI, NICHD) all emphasize content-quality signals over rigid numeric stopping.

4. **Funnel ordering is non-negotiable.** All clinical and forensic evidence converges: open prompts must precede directive prompts must precede closed / option-posing prompts. The agent should never use a directive ("Did you manage a team?") on a topic before it has used at least one open prompt ("Tell me about your management experience"). This ordering also reduces contamination of answers by the agent's own framing.

5. **Match probe type to conversation state using DICE.** Descriptive and Idiographic probes early; Clarifying probes on ambiguous vocabulary; Explanatory probes only after adequate description is established. Deploying Explanatory probes too early is a codeable fidelity failure in MI (MITI) and the most common agent error in the AI interviewing literature (S7, S23).

---

## Sources

1. Reynolds, T.J. & Gutman, J. (1988). "Laddering Theory, Method, Analysis, and Interpretation." _Journal of Advertising Research_, 28, 11–31. [https://www.tandfonline.com/doi/abs/10.1080/00218499.1988.12467766](https://www.tandfonline.com/doi/abs/10.1080/00218499.1988.12467766)

2. Grunert, K.G. & Grunert, S.C. (1995). "Measuring subjective meaning structures by the laddering method: theoretical considerations and methodological problems." _International Journal of Research in Marketing_, 12, 209–225. SSRN: [https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1739855](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1739855)

3. UserIntuition (2024). "The Laddering Technique in Qualitative Research." Practitioner reference guide. [https://www.userintuition.ai/reference-guides/laddering-technique-qualitative-research/](https://www.userintuition.ai/reference-guides/laddering-technique-qualitative-research/)

4. Wansink, B. (2003). "Using Laddering to Understand and Leverage a Brand's Equity." _Qualitative Market Research_, 6(2), 111–118. [https://www.emerald.com/insight/content/doi/10.1108/13522750310470118/full/html](https://www.emerald.com/insight/content/doi/10.1108/13522750310470118/full/html)

5. Veludo-de-Oliveira, T.M., Ikeda, A.A., & Campomar, M.C. (2006). "Discussing Laddering Application by the Means-End Chain Theory." _The Qualitative Report_, 11(4), 626–642. [https://nsuworks.nova.edu/tqr/vol11/iss4/1/](https://nsuworks.nova.edu/tqr/vol11/iss4/1/)

6. Kilwinger, F.B.M. & van Dam, Y.K. (2021). "Methodological considerations on the means-end chain analysis revisited." _Psychology & Marketing_, 38(9), 1513–1524. [https://onlinelibrary.wiley.com/doi/full/10.1002/mar.21521](https://onlinelibrary.wiley.com/doi/full/10.1002/mar.21521)

7. Miller, W.R. & Rollnick, S. (2013). _Motivational Interviewing: Helping People Change_, 3rd ed. Guilford Press. NCBI chapter: [https://www.ncbi.nlm.nih.gov/books/NBK571068/](https://www.ncbi.nlm.nih.gov/books/NBK571068/)

8. Moyers, T.B. et al. (2016). "MITI 4.2.1 Coding Manual." Motivational Interviewing Network of Trainers. [https://motivationalinterviewing.org/sites/default/files/miti4_2.pdf](https://motivationalinterviewing.org/sites/default/files/miti4_2.pdf)

9. Moyers, T.B. et al. (2016). "Deconstructing Proficiency in Motivational Interviewing: Mechanics of Skilful Practitioner Delivery." _PMC_. [https://pmc.ncbi.nlm.nih.gov/articles/PMC3236613/](https://pmc.ncbi.nlm.nih.gov/articles/PMC3236613/)

10. Lamb, M.E. et al. (2007). "Structured forensic interview protocols improve the quality and informativeness of investigative interviews with children." _Child Abuse & Neglect_, PMC. [https://pmc.ncbi.nlm.nih.gov/articles/PMC2180422/](https://pmc.ncbi.nlm.nih.gov/articles/PMC2180422/)

11. NICHD Protocol documentation. nichdprotocol.com. [https://nichdprotocol.com/](https://nichdprotocol.com/)

12. OJJDP (2015). "Child Forensic Interviewing: Best Practices." U.S. Dept. of Justice. [https://ojjdp.ojp.gov/sites/g/files/xyckuh176/files/pubs/248749.pdf](https://ojjdp.ojp.gov/sites/g/files/xyckuh176/files/pubs/248749.pdf)

13. Allen, J. & Core, M. (1997). "Draft of DAMSL: Dialog Act Markup in Several Layers." DRI/Dagstuhl. [https://www.cs.rochester.edu/research/speech/damsl/RevisedManual/](https://www.cs.rochester.edu/research/speech/damsl/RevisedManual/)

14. Stolcke, A. et al. (2000). "Dialogue Act Modeling for Automatic Tagging and Recognition of Conversational Speech." _Computational Linguistics_, 26(3), 339–373. [https://dl.acm.org/doi/10.1162/089120100561737](https://dl.acm.org/doi/10.1162/089120100561737)

15. Lin, Y. et al. (2023). "Multi-Granularity Prompts for Topic Shift Detection in Dialogue." ICIC 2023. [https://arxiv.org/abs/2305.14006](https://arxiv.org/abs/2305.14006)

16. Guo, Z. et al. (2024). "PCQPR: Proactive Conversational Question Planning with Reflection." EMNLP 2024. [https://aclanthology.org/2024.emnlp-main.631/](https://aclanthology.org/2024.emnlp-main.631/)

17. Yao, S. et al. (2023). "ReAct: Synergizing Reasoning and Acting in Language Models." ICLR 2024. [https://arxiv.org/abs/2210.03629](https://arxiv.org/abs/2210.03629)

18. Shinn, N. et al. (2023). "Reflexion: Language Agents with Verbal Reinforcement Learning." NeurIPS 2023. [https://arxiv.org/abs/2303.11366](https://arxiv.org/abs/2303.11366)

19. Zhuge, M. et al. (2024). "Agent-as-a-Judge: Evaluate Agents with Agents." [https://arxiv.org/abs/2410.10934](https://arxiv.org/abs/2410.10934)

20. Xu, Z. et al. (2024). "CGPO: Mixed Judges for Calibrated Group Preference Optimization." Cited in: Haitao Shi et al. "LLMs-as-Judges: A Comprehensive Survey." [https://arxiv.org/html/2412.05579v2](https://arxiv.org/html/2412.05579v2)

21. Cohen, R. et al. (2023). "LM vs LM: Detecting Factual Errors via Cross Examination." EMNLP 2023. [https://aclanthology.org/2023.emnlp-main.778/](https://aclanthology.org/2023.emnlp-main.778/)

22. "Evaluating LLM-based Agents for Multi-Turn Conversations: A Survey." (2025). [https://arxiv.org/html/2503.22458v1](https://arxiv.org/html/2503.22458v1)

23. Robinson, O.C. (2023). "Probing in qualitative research interviews: Theory and practice." _Qualitative Research in Psychology_. [https://www.tandfonline.com/doi/full/10.1080/14780887.2023.2238625](https://www.tandfonline.com/doi/full/10.1080/14780887.2023.2238625)

24. Graesser, A.C. & Person, N.K. (1994). "Question Asking During Tutoring." _American Educational Research Journal_, 31(1), 104–137. [https://journals.sagepub.com/doi/10.3102/00028312031001104](https://journals.sagepub.com/doi/10.3102/00028312031001104)

25. Unimrkt Healthcare (2024). "Respondent Fatigue in Qualitative Health Research." Practitioner guide. [https://unimrkthealth.com/blog/how-respondent-fatigue-is-influencing-qualitative-health-research/](https://unimrkthealth.com/blog/how-respondent-fatigue-is-influencing-qualitative-health-research/)
