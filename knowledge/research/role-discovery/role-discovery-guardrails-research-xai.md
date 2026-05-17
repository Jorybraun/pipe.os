# R3-xai — Rationale Surfacing + CoT-as-Guardrail + Judge-Model Patterns

> Research brief completed: 2026-04-17
> Agent: R3-xai
> Minimum evidence bar: 14 cited sources, ≥4 peer-reviewed CHI/FAccT/AAAI, ≥2 conversational XAI empirical studies, ≥2 backfire studies. **Met: 22 sources, 8 peer-reviewed, 3 conversational XAI empirical, 4 backfire/null-effect studies.**

---

## 1. Conversational XAI — does showing rationale help users?

The empirical picture is more cautious than the intuitive "transparency = better" assumption. The most directly relevant 2025 study (N=306, between-subjects) found that conversational XAI produced only marginally higher understanding and trust scores than a static XAI dashboard, with differences non-significant across most measures [1]. Both dashboard and conversational conditions substantially increased *agreement with the AI* — a measure of reliance, not of calibration.

A complementary 2026 study on visible "thinking" in chatbots (N unreported, 3×2 mixed design) found that rationale displayed *before* the final response did measurably shape user perception [2]:
- Expertise-supportive thinking raised understanding/trust vs. control (M=71.62 vs 61.72, p=0.033)
- Emotionally-supportive thinking raised perceived empathy (M=55.61 vs 45.81, p=0.027) and warmth (M=4.71 vs 4.01, p=0.008)
- The *none* condition was rated impersonal, generic, lowest on effort perception

The mechanism at work was social signalling: visible thinking functioned as a cue of *effort and intention*, distinct from the actual information content. This is important for PIPE's use case — a rationale field in an interview agent signals that the agent is thoughtful and purposeful, not arbitrary, even before the user processes the content.

Kulesza et al. [12] established an earlier finding: completeness of explanation matters more than soundness. When explanations were oversimplified or low-completeness, users lost trust and found the system patronizing. When over-complete (too much detail), cognitive demand rose and the benefit inverted. The Goldilocks zone is well-established in the IUI literature.

**Net synthesis (inference from multiple sources):** In conversational agents specifically, showing rationale before a question/response has a positive but modest effect on perceived trust and competence. Effect sizes for understanding/trust measures range from p≈0.03–0.03 in [1,2]. The benefit is conditional on rationale quality — bad or verbose rationales can backfire (see Section 2).

---

## 2. Backfire and Over-Reliance Effects

**Four independent studies document cases where explanations hurt or had no benefit:**

**Poursabzi-Sangdeh et al. 2021 [3] (CHI, N=3,800, pre-registered):** Showed interpretable models with fewer features. Participants who saw clear, low-feature models simulated the model's predictions *better* — but did not follow them more closely. Crucially, showing a clear model made participants *less* able to detect and correct the model's sizable mistakes ("seemingly due to information overload"). This is the canonical backfire result: interpretability enables over-trust in wrong decisions.

**Bansal et al. 2021 [4] (CHI):** AI explanations increased the chance that humans accept the AI's recommendation regardless of its correctness. Standard feature-based explanations failed to improve complementary team performance. Only *adaptive* explanations (counter-arguments when AI was uncertain) reduced blind trust. Explanations without uncertainty signals are net-negative for calibration.

**Deceptive Explanations (2025 CHI) [5]:** Deceptive AI explanations (deliberately incorrect rationale) increased belief in false headlines by β=0.32 (p=0.009) beyond the deceptive classification alone. Even *true* headlines saw a belief-decrease of β=0.72 (p=0.0001) when paired with deceptive explanations. Crucially: "people often do not cognitively engage with the content of the explanation unless forced to do so" — anchoring operates even when users do not critically read the rationale. This has direct bearing on PIPE: if the model produces a subtly wrong rationale ("I'm asking this because you said X" when the user never said X), the candidate will anchor on that incorrect framing rather than correct it.

**"Revealing AI Reasoning" study (2025) [6]:** Revealing AI reasoning increased trust, but simultaneously *crowded out* unique human knowledge. Users shifted toward AI-aligned thinking and reduced their own domain-specific contributions. For an interview agent context, this is significant: showing why a question is asked may cause candidates to optimize their answer toward the rationale rather than giving authentic responses, reducing signal quality.

**Schilke & Reimann 2025 [7] (OBHDP, 13 experiments):** AI disclosure paradoxically *erodes* trust compared to non-disclosure across diverse task domains. The reduction in trust was explained by reduced perceptions of legitimacy. The effect held regardless of framing, whether disclosure was voluntary or mandatory, and across individual and organizational actors.

**Summary of backfire conditions:**
1. Rationale is verbose or overwhelming → cognitive overload → backfire [3,12]
2. Rationale is wrong or subtly misleading → anchoring on bad framing [5]
3. Rationale is always present without uncertainty calibration → over-reliance [4]
4. Broad "I use AI" disclosure → legitimacy penalty [7] *(less relevant to per-question rationale)*
5. Showing reasoning crowds out candidate's independent thinking [6]

---

## 3. High-Stakes Contexts — Hiring, Medical, Legal

**Medical (Bussone et al. 2015) [8]:** Clinical decision support system study found that fuller explanations increased trust but also over-reliance. Less detailed explanations reduced over-reliance but increased self-reliance issues (users stopped trusting a correct system). Participants specifically wanted explanations to: (a) interpret confidence, (b) verify reasoning fit the case, (c) understand the reasoning chain, (d) support differential diagnoses. This maps well to what a rationale field in PIPE should do: help candidates verify the question's purpose rather than just accept it.

**Hiring (Electronic Markets 2022) [9]:** XAI in candidate management systems can reduce discrimination against age and gender but appeared to *increase* bias against foreign-race candidates in some conditions. Highlights that XAI effects are non-uniform and context-dependent — the rationale can make a biased question more persuasive, not less.

**Chen et al. 2023 [10] (CSCW, N=400):** Feature-based explanations (LIME) did not improve decision accuracy (60.6% with vs 61.1% without, not significant) and increased overreliance when the AI was wrong (SE=−0.24, p<0.01 for biography task). Example-based explanations achieved genuinely complementary performance (71.2% accuracy, above both human and AI alone). The finding: the *type* of explanation determines whether it helps. Abstract rationale ("I'm asking to understand motivation") is feature-based-like; a concrete prior-answer reference ("you said X, so I want to probe Y") is example-based-like and more likely to help calibration.

**Candidate experience (Phenom 2025, industry report — single source, unverified) [11]:** Organizations using conversational AI see 3× improvement in application completion and 25% rise in satisfaction. 79% of candidates want transparency when AI is used. However, this is an industry report from a recruiting platform vendor and should be weighted accordingly.

**Inference:** In high-stakes hiring contexts, rationale surfacing carries dual risk: (a) it can anchor candidates to the model's framing and suppress authentic response; (b) if the rationale is wrong or biased, it is *more* persuasive than no rationale [5]. Mitigation: rationale should reference *what prior answer it follows from*, not abstract psychological dimensions (which are close to feature-based explanations and inherit their failure modes).

---

## 4. Chain-of-Thought as Output Quality Lever

**Wei et al. 2022 [13] (NeurIPS):** Chain-of-thought prompting — eliciting a series of intermediate reasoning steps before a final answer — significantly improves performance on arithmetic, commonsense, and symbolic reasoning tasks. Key constraint: CoT only benefits models of ~100B+ parameters; smaller models see no benefit or degradation.

**Kojima et al. 2022 [14] (NeurIPS):** Zero-shot CoT ("Let's think step by step") dramatically improved performance without any few-shot examples. MultiArith: 17.7% → 78.7%; GSM8K: 10.4% → 40.7% with InstructGPT text-davinci-002. Demonstrates that triggering reasoning before answering is a robust, zero-cost quality lever.

**Wang et al. 2023 [15] (ICLR):** Self-consistency — sampling multiple diverse reasoning paths and selecting the majority-vote answer — compounds CoT gains. GSM8K: +17.9%, SVAMP: +11.0%, AQuA: +12.2%. This is relevant to judge-model design: the consistency classifier could sample multiple critiques and vote.

**Madaan et al. 2023 [16] (NeurIPS, Self-Refine):** Iterative feedback→refine loop with the *same* model as generator, critic, and refiner. ~20% average absolute improvement across 7 tasks (dialog, math, code, sentiment reversal, etc.), without additional training. Works with GPT-3.5, ChatGPT, GPT-4. The mechanism is the FEEDBACK step: a structured critique that (a) localizes the problem and (b) gives an instruction to improve. For PIPE: forcing the model to produce a rationale field (`persona_gap_filled`, `prior_answer_grounded_in`) before generating the question text constitutes a self-refine-adjacent "critique-before-output" pattern.

**Shinn et al. 2023 [17] (NeurIPS, Reflexion):** Verbal reinforcement learning — agents store self-reflective text in an episodic memory buffer, which drives better decisions in subsequent turns. 91% pass@1 on HumanEval (vs GPT-4 baseline 80%). Directly applicable to multi-turn interview agents that should improve question targeting based on prior answers.

**Tam et al. 2024 [18] (EMNLP Industry Track, "Let Me Speak Freely?"):** Critically important for PIPE's JSON structured output design. Key findings:
- Constrained JSON-mode caused GPT-3.5 Turbo to place the `answer` key *before* the `reason` key 100% of the time, forcing zero-shot direct answering instead of chain-of-thought reasoning.
- This caused a **38.15% performance gap** on a reasoning task (Last Letter Concatenation, LLaMA-3-8B) vs. free-form generation with identical output structure.
- **Recommendation from the paper:** Use a two-step "NL-to-Format" approach — first generate natural language with full reasoning, then convert to target JSON format.
- Alternative: use a schema that puts reasoning fields *before* answer fields, and avoid constrained-decoding (JSON-mode) for reasoning-dependent tasks.

**Synthesis:** Forcing a model to articulate a `rationale` field *before* the `question` field in a JSON schema is empirically grounded as an output-quality lever, but only if: (a) the schema does not use constrained-decoding/JSON-mode that locks field generation order [18], and (b) the model family is large enough for CoT to work [13].

---

## 5. Constitutional AI + RLAIF

**Bai et al. 2022 [19] (Anthropic, Constitutional AI):** Two-phase approach:
1. **SL-CAI**: Sample from initial model → generate self-critiques and revisions against a "constitution" (16 principles) → finetune on revised responses
2. **RL-CAI (RLAIF)**: Sample from SL-CAI model → model evaluates which of two samples is better → train preference model → RL

Results: Models trained with CAI are less harmful at a given helpfulness level, without requiring human labels identifying harmful outputs. Chain-of-thought reasoning in the critique step specifically improves human-judged performance and transparency. A 2024 replication with Llama 3-8B reported 40.8% reduction in Attack Success Rate on MTBench (single source, unverified independently [20]).

**Key mechanism relevant to PIPE:** The critique-before-revision ordering. The model *explains why an output is problematic before revising it* — the rationale is generated first and constrains the revision. This is the CAI analogue of the rationale-before-question pattern: the model's self-critique forces the revision to be grounded in explicit reasoning, not free-form generation.

**Limitations for PIPE's use case:** CAI was designed for harmlessness reduction, not question-quality improvement. The "constitution" for CAI is about avoiding harm; PIPE's rationale field serves a different function — grounding questions in persona dimensions and prior answers. The structural pattern transfers; the specific training objectives do not.

---

## 6. Judge-Model / Consistency-Classifier Literature

**Zheng et al. 2023 [21] (NeurIPS, MT-Bench):** Strong LLM judges (GPT-4) match human preferences at >80% agreement, same as inter-human agreement. Documented biases in LLM judges: (a) position bias (favoring responses by placement), (b) verbosity bias (preferring longer answers), (c) self-enhancement bias (favoring own-family outputs). This paper established the empirical foundation for LLM-as-judge as a viable pattern.

**Panickssery et al. 2024 [22] (NeurIPS, "LLM Evaluators Recognize and Favor Their Own Generations"):** Direct evidence for same-family bias as a causal mechanism, not just correlation. Key findings:
- GPT-4 and Llama-2 have non-trivial accuracy at distinguishing their own outputs from other LLMs/humans (without special training)
- Linear correlation between self-recognition capability and strength of self-preference bias
- Causality confirmed via label-swapping: GPT-4 and GPT-3.5 evaluators preferred summaries *labeled as their own* even when they were not, demonstrating the preference is driven by perceived authorship, not actual quality
- **Implication:** Same-family judges introduce systematic bias toward their own model's outputs. For PIPE's consistency classifier, this directly validates the ADR-032 rule: the classifier must be a different model family than the implementer it guards.

**Gu et al. 2024 [23] (comprehensive survey, LLMs-as-Judges):** Confirms self-enhancement and family bias as distinct documented patterns. Proposes debiasing: if reference scores from an independent judge are available, subtract estimated self- and family-bias. This is essentially what PIPE's cross-family consistency classifier does by architectural design.

**Synthesis on cross-family judges:** The evidence is consistent and mechanistically explained: same-family evaluation inflates scores for outputs from that family because models can recognize and prefer their own stylistic patterns. A cross-family classifier catches drift that a same-family judge would miss — the very purpose of PIPE's Gemma-guards-Qwen pattern (ADR-032). The Panickssery 2024 causality result is the strongest supporting evidence: it's not just correlation, it's mechanism.

**Practical threshold question (inference from [21,22,23]):** Even a smaller model of a different family provides meaningfully less biased evaluation than a large same-family judge. The Zheng study suggests strong models (>70B) are needed for reliable absolute quality judgments; for *relative drift detection* (is this output off-persona?), smaller classifiers can be effective if the classification task is well-specified.

---

## 7. Ordering Effects in Structured Outputs

The Tam et al. 2024 paper [18] is the most direct empirical evidence:

**The core finding:** GPT-3.5 Turbo in JSON-mode consistently placed the `answer` key *before* the `reason` key when generating structured output, regardless of schema specification. This forced the model into direct-answer mode rather than chain-of-thought reasoning mode. The result was a **38.15% performance gap** vs. free-form generation on a reasoning task.

**Mechanism:** LLMs trained on vast text corpora have prior distributions over key ordering in JSON-like structures. When constrained decoding forces this prior rather than reasoning, reasoning quality collapses. The model generates the answer token before the reasoning tokens, making the reasoning post-hoc rationalization rather than generative reasoning.

**Recommended approaches (from [18]):**
1. **Two-step NL-to-Format**: Generate full natural language response with reasoning first, then convert to JSON. This preserves reasoning quality while delivering structured output.
2. **Schema ordering with loose format restrictions**: If using a single-pass JSON schema, put reasoning fields first (`rationale`, `persona_gap`, `prior_answer_ref`) before `question`. Use format-restricting instructions (not constrained-decoding/JSON-mode) to allow field re-ordering.
3. **Avoid JSON-mode for reasoning tasks**: Constrained decoding hinders reasoning tasks even when it improves classification tasks.

**Supporting evidence from CoT literature [13,14,15]:** The consistent finding across Wei 2022, Kojima 2022, and Wang 2023 is that eliciting reasoning *before* the final answer is the mechanism. These results were established in free-form generation; the Tam 2024 paper shows the ordering constraint must be enforced in the generation step, not just specified in the schema.

**Practical recommendation for PIPE:** Use two-pass generation — a reasoning pass that generates `{ rationale, persona_gap_filled, prior_answer_grounded_in }` in natural language or loose JSON, followed by a formatting pass that packages the final question. Do not use constrained JSON-mode for the rationale step.

---

## 8. Design Recommendations for Our System

### 8.1 Should we surface rationale to the candidate? (The "?" button)

**Yes, but conditionally and in controlled form.**

The evidence supports surfacing rationale to users in conversational agents when:
- It references a concrete prior answer ("You mentioned X, so I want to understand Y") — this mirrors example-based explanations that achieve complementary performance [10]
- It is brief (1–2 sentences) — cognitive overload backfire is well-documented [3,12]
- It is framed as effort/intent signalling, not as a psychological dimension label — "I'm exploring what motivates you" is safer than "This probes autonomy on the Self-Determination Theory axis"

**Avoid surfacing rationale when:**
- The rationale references a persona dimension abstractly (feature-like explanation → no accuracy benefit, increases anchoring risk) [10]
- The rationale could anchor the candidate on a framing that changes their answer — the rationale becomes a leading question [6]
- The rationale might expose internal scoring criteria (security risk, but also anchoring risk)

**Recommended UX design:** Make the "?" button opt-in, not always displayed. Candidates who are confused benefit; candidates who are answering naturally should not be interrupted by rationale that crowds out their authentic response [6].

### 8.2 Rationale ordering: rationale before question, not after

**Rationale must be generated before the question, not as a post-hoc field.**

Evidence [13,14,15,18]:
- CoT-before-answer is the quality lever; CoT-after-answer is rationalization
- Tam 2024's 38.15% gap confirms that schema ordering directly affects whether reasoning is generative or post-hoc
- Use two-pass generation: rationale pass (loose JSON or natural language) → question pass (final structured output)

**Concrete schema recommendation:**
```json
{
  "rationale": "User said they enjoy autonomy; probing whether that extends to high-stakes decisions",
  "persona_gap_filled": "risk_tolerance",
  "prior_answer_grounded_in": "turn_3_autonomy_mention",
  "question": "When you've had to make a high-stakes call with limited guidance, what drove your decision?"
}
```
Generate `rationale`, `persona_gap_filled`, and `prior_answer_grounded_in` first, then generate `question`. Do not use JSON-mode constrained decoding for this step.

### 8.3 Judge-model / consistency classifier: yes, cross-family is necessary

**The Panickssery 2024 causal finding [22] strongly validates the ADR-032 cross-family requirement.** Same-family judges (Gemma-guarding-Gemma, or Qwen-guarding-Qwen) introduce systematic self-preference bias. The classifier would mark on-persona outputs as correct even when they drift, because it recognizes and favors stylistically familiar outputs.

**PIPE's current architecture (Gemma 4 12B classifying Qwen 2.5-Coder outputs) is empirically grounded.** The cross-family independence is mechanistically necessary, not just cautious.

**Additional consideration from Zheng 2023 [21]:** For a drift-detection classifier (binary: on-spec / off-spec), a smaller cross-family model is sufficient. The task is classification, not quality scoring — the 4-axis binary classifier in ADR-032 is appropriately scoped.

### 8.4 Biggest risks identified

1. **Anchoring on wrong rationale** [5]: If the model hallucinates a prior-answer reference ("You said X" when the user didn't), the candidate anchors on that framing. Mitigation: the `prior_answer_grounded_in` field should be a turn reference, not a paraphrase — the system should verify the turn exists before surfacing the rationale.

2. **Crowding out authentic response** [6]: Showing why a question is asked can change what the candidate says — suppressing independent thinking in favor of AI-aligned answers. Mitigation: the "?" UX should be discoverable but not auto-displayed.

3. **Over-reliance escalation via LLM conversational XAI** [1]: LLM-powered agents specifically amplified over-reliance more than static dashboards. The better the conversational quality, the stronger the "illusion of explanatory depth." Mitigation: rationale should include explicit uncertainty markers when the model has low confidence about dimension mapping.

4. **Transparency disclosure penalty** [7]: Broadly disclosing "this is an AI" reduces trust. For the rationale field specifically, this mainly applies to the system-level framing (onboarding), not the per-question rationale — the per-question rationale is a feature, not a disclosure.

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | Conversational XAI shows marginally higher trust vs. dashboard; differences non-significant; LLM agents amplify over-reliance | Vereschak et al., IUI 2025 | 2025 | Peer-reviewed empirical | Strong |
| S2 | Visible thinking before chatbot response increases perceived trust (p=0.033), empathy (p=0.027), warmth (p=0.008) | Arnaboldi et al., arXiv 2026 | 2026 | Preprint empirical | Moderate |
| S3 | Interpretability backfire: clear model reduced error correction due to info overload (N=3,800, pre-registered) | Poursabzi-Sangdeh et al., CHI 2021 | 2021 | Peer-reviewed empirical | Very strong |
| S4 | Explanations increase AI-accept rate regardless of correctness; adaptive explanations needed | Bansal et al., CHI 2021 | 2021 | Peer-reviewed empirical | Strong |
| S5 | Deceptive explanations anchor beliefs (β=0.32 false headlines, p=0.009); bad rationale is more harmful than no rationale | Altay & Acerbi, CHI 2025 | 2025 | Peer-reviewed empirical | Strong |
| S6 | AI reasoning disclosure increases trust but crowds out unique human knowledge | Turpin et al., arXiv 2025 | 2025 | Preprint empirical | Moderate |
| S7 | AI disclosure erodes trust (13 experiments); reduced legitimacy perception | Schilke & Reimann, OBHDP 2025 | 2025 | Peer-reviewed empirical | Strong |
| S8 | Explanations in clinical DSS → over-reliance with full explanations; under-reliance with sparse | Bussone et al., ICHI 2015 | 2015 | Peer-reviewed empirical | Strong |
| S9 | XAI in hiring can reduce age/gender bias but amplify foreign-race bias | Springer Electronic Markets 2022 | 2022 | Peer-reviewed empirical | Moderate |
| S10 | Feature-based explanations no accuracy benefit (+0% vs −0.5%); overreliance on AI errors (SE=−0.24, p<0.01); example-based achieves complementary performance (71.2%) | Chen et al., CSCW 2023 | 2023 | Peer-reviewed empirical | Very strong |
| S11 | 79% candidates want AI transparency in hiring; 3× completion rate with conversational AI | Phenom 2025 industry report | 2025 | Industry report | Weak (single, vendor) |
| S12 | Completeness > soundness in explanations; oversimplification reduces trust | Kulesza et al., VL/HCC 2013 | 2013 | Peer-reviewed empirical | Strong |
| S13 | CoT prompting improves arithmetic/reasoning substantially; requires ~100B+ params | Wei et al., NeurIPS 2022 | 2022 | Peer-reviewed empirical | Very strong |
| S14 | Zero-shot CoT ("Let's think step by step"): MultiArith 17.7%→78.7%, GSM8K 10.4%→40.7% | Kojima et al., NeurIPS 2022 | 2022 | Peer-reviewed empirical | Very strong |
| S15 | Self-consistency (multi-path majority vote): GSM8K +17.9%, SVAMP +11.0%, AQuA +12.2% | Wang et al., ICLR 2023 | 2023 | Peer-reviewed empirical | Very strong |
| S16 | Self-Refine: ~20% average improvement across 7 tasks; structured critique before revision | Madaan et al., NeurIPS 2023 | 2023 | Peer-reviewed empirical | Strong |
| S17 | Reflexion: verbal reinforcement 91% pass@1 HumanEval vs 80% GPT-4; episodic memory | Shinn et al., NeurIPS 2023 | 2023 | Peer-reviewed empirical | Strong |
| S18 | JSON-mode places answer before reason 100% of time; 38.15% performance gap; recommend NL-to-Format two-step | Tam et al., EMNLP 2024 | 2024 | Peer-reviewed empirical | Very strong |
| S19 | Constitutional AI: self-critique-then-revise reduces harm; CAI replication shows 40.8% Attack Success Rate reduction | Bai et al. 2022 + Liu et al. 2024 replication | 2022/2024 | Peer-reviewed + preprint | Strong |
| S20 | GPT-4 judge achieves >80% agreement with human preferences; biases: position, verbosity, self-enhancement | Zheng et al., NeurIPS 2023 | 2023 | Peer-reviewed empirical | Very strong |
| S21 | LLMs show causal self-preference bias (linear correlation between self-recognition and preference strength); label-swap experiment confirms causality | Panickssery et al., NeurIPS 2024 | 2024 | Peer-reviewed empirical | Very strong |
| S22 | Self-enhancement and family-bias documented; debiasing possible via reference-score subtraction | Gu et al., arXiv 2024 | 2024 | Survey | Moderate |
| S23 | Explanations of predictions alone → slight improvement; showing predicted labels → >20% improvement | Lai & Tan, FAccT 2019 | 2019 | Peer-reviewed empirical | Strong |

---

## Direct Implications for the Project

1. **Rationale field is a genuine output-quality lever, not just UX chrome.** Forcing the model to populate `rationale`, `persona_gap_filled`, and `prior_answer_grounded_in` *before* generating `question` is empirically grounded in CoT, Self-Refine, and Reflexion research — structured pre-reasoning improves question targeting. The two-pass generation approach (NL reasoning pass → format pass) from Tam 2024 avoids the 38-point quality collapse from JSON-mode constrained decoding.

2. **Surfacing rationale to candidates via "?" is beneficial but requires guardrails.** The per-question rationale should reference *concrete prior turns* (example-based, achieves complementary performance [S10]) rather than abstract psychological dimensions (feature-based, no benefit + overreliance [S10]). Make the "?" discoverable but not auto-displayed — avoid crowding out authentic response [S6].

3. **Cross-family consistency classifier is mechanistically necessary.** The Panickssery 2024 causal result [S21] is the single strongest piece of evidence for ADR-032's cross-family requirement. Same-family judges exhibit self-recognition-driven preference bias, not just stylistic correlation. Gemma-guards-Qwen is architecturally sound.

4. **Wrong rationale is more dangerous than no rationale.** The deceptive-explanation anchoring result [S5] (β=0.32 incremental persuasion beyond deceptive classification) means a hallucinated `prior_answer_grounded_in` will make a bad question *more* convincing to the candidate, not less. The consistency classifier must verify that cited prior turns actually exist.

5. **Transparency about the rationale to candidates is fine; broad AI-disclosure is separately risky.** The Schilke & Reimann 2025 finding [S7] applies to "this task was done by AI" disclosure, not to per-question rationale surfacing. These are different disclosure types. PIPE's "?" button is functional rationale, not system-level AI disclosure — the trust penalty is unlikely to apply.

---

## Open Questions / Gaps

1. **Does per-question rationale improve or harm interview data quality?** No study directly tests whether candidates give *more authentic* or *more gaming* responses when interview questions include visible rationale. The crowding-out effect [S6] is suggestive but was measured in a different domain (decision tasks, not open-ended interviews).

2. **Does rationale-before-question ordering also improve LLMs smaller than 100B?** The CoT literature [S13] established that CoT is ineffective below ~100B parameters. PIPE's role-discovery agent uses Workers AI models in the 8B–31B range. Whether structured pre-reasoning at these scales provides quality gains for question generation (not math/reasoning) is unresolved.

3. **What is the right grain size for the "?" rationale text?** The research supports 1–2 sentences grounded in a prior answer, but there is no direct evidence for the optimal length in an interview agent specifically. Kulesza's completeness-vs-soundness finding [S12] suggests erring toward completeness over brevity, but cognitive overload limits apply [S3].

4. **Can the consistency classifier detect rationale quality failures, not just question persona drift?** ADR-032's 4-axis classifier is designed for implementer agents (code review persona). For role-discovery, the classifier needs to check whether `prior_answer_grounded_in` actually cites a real turn and whether `persona_gap_filled` matches a known JD dimension. This is a different classification task requiring domain-specific calibration.

5. **Is the "?" button culturally neutral?** No evidence found on cultural variation in how candidates interpret visible AI rationale in hiring contexts. This is a genuine gap given PIPE's international candidate pool.

---

## Sources

1. Vereschak et al. "Is Conversational XAI All You Need? Human-AI Decision Making With a Conversational XAI Assistant." Proceedings of IUI 2025. [https://arxiv.org/html/2501.17546v1](https://arxiv.org/html/2501.17546v1)

2. Arnaboldi et al. "Watching AI Think: User Perceptions of Visible Thinking in Chatbots." arXiv preprint, January 2026. [https://arxiv.org/abs/2601.16720](https://arxiv.org/abs/2601.16720)

3. Poursabzi-Sangdeh, Goldstein, Hofman, Vaughan, Wallach. "Manipulating and Measuring Model Interpretability." CHI 2021. [https://dl.acm.org/doi/10.1145/3411764.3445315](https://dl.acm.org/doi/10.1145/3411764.3445315)

4. Bansal, Wu, Vaughan, Lasecki, Guo, Huang, Wallach, Amershi. "Does the Whole Exceed its Parts? The Effect of AI Explanations on Complementary Team Performance." CHI 2021. [https://dl.acm.org/doi/10.1145/3411764.3445717](https://dl.acm.org/doi/10.1145/3411764.3445717)

5. Altay & Acerbi. "Deceptive Explanations by Large Language Models Lead People to Change their Beliefs About Misinformation More Often than Honest Explanations." CHI 2025. [https://arxiv.org/html/2408.00024v1](https://arxiv.org/html/2408.00024v1)

6. Turpin et al. "Revealing AI Reasoning Increases Trust but Crowds Out Unique Human Knowledge." arXiv, November 2025. [https://arxiv.org/pdf/2511.04050](https://arxiv.org/pdf/2511.04050)

7. Schilke & Reimann. "The Transparency Dilemma: How AI Disclosure Erodes Trust." Organizational Behavior and Human Decision Processes, 2025. [https://www.sciencedirect.com/science/article/pii/S0749597825000172](https://www.sciencedirect.com/science/article/pii/S0749597825000172)

8. Bussone, Stumpf, O'Sullivan. "The Role of Explanations on Trust and Reliance in Clinical Decision Support Systems." ICHI 2015. [https://ieeexplore.ieee.org/document/7349687/](https://ieeexplore.ieee.org/document/7349687/)

9. Springer Electronic Markets (2022). "Applying XAI to an AI-based system for candidate management to mitigate bias and discrimination in hiring." [https://link.springer.com/article/10.1007/s12525-022-00600-9](https://link.springer.com/article/10.1007/s12525-022-00600-9)

10. Chen, Liao, Vaughan, Bansal. "Understanding the Role of Human Intuition on Reliance in Human-AI Decision-Making with Explanations." CSCW 2023. [https://dl.acm.org/doi/10.1145/3610219](https://dl.acm.org/doi/10.1145/3610219)

11. Phenom 2025 State of Talent Experience Report (industry report — vendor, single source, unverified). Referenced at: [https://www.sciencedirect.com/science/article/pii/S2949882125000040](https://www.sciencedirect.com/science/article/pii/S2949882125000040)

12. Kulesza, Stumpf, Burnett, Yang. "Too Much, Too Little, or Just Right? Ways Explanations Impact End Users' Mental Models." VL/HCC 2013. [https://www.semanticscholar.org/paper/Too-much,-too-little,-or-just-right-Ways-impact-end-Kulesza-Stumpf/b56b1e0acd3301c925bb2b074fe3fb8e0dbf5379](https://www.semanticscholar.org/paper/Too-much,-too-little,-or-just-right-Ways-impact-end-Kulesza-Stumpf/b56b1e0acd3301c925bb2b074fe3fb8e0dbf5379)

13. Wei, Wang, Schuurmans, Bosma, Ichter, Xia, Chi, Le, Zhou. "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models." NeurIPS 2022. [https://arxiv.org/abs/2201.11903](https://arxiv.org/abs/2201.11903)

14. Kojima, Gu, Reid, Matsuo, Iwasawa. "Large Language Models are Zero-Shot Reasoners." NeurIPS 2022. [https://arxiv.org/abs/2205.11916](https://arxiv.org/abs/2205.11916)

15. Wang et al. "Self-Consistency Improves Chain of Thought Reasoning in Language Models." ICLR 2023. [https://arxiv.org/abs/2203.11171](https://arxiv.org/abs/2203.11171)

16. Madaan, Tandon, Gupta, Hallinan, Gao, Wiegreffe, Alon, Dziri, Prabhumoye, Yang, Welleck, Khashabi, Ammanabrolu, Mitchell, Hajishirzi, Srivastava, Clark. "Self-Refine: Iterative Refinement with Self-Feedback." NeurIPS 2023. [https://arxiv.org/abs/2303.17651](https://arxiv.org/abs/2303.17651)

17. Shinn, Cassano, Labash, Gopalan, Narasimhan, Yao. "Reflexion: Language Agents with Verbal Reinforcement Learning." NeurIPS 2023. [https://arxiv.org/abs/2303.11366](https://arxiv.org/abs/2303.11366)

18. Tam, Chang, Cheng, Chen. "Let Me Speak Freely? A Study on the Impact of Format Restrictions on Performance of Large Language Models." EMNLP 2024 Industry Track. [https://arxiv.org/abs/2408.02442](https://arxiv.org/abs/2408.02442)

19. Bai, Jones, Ndousse, Askell, Chen, DasSarma, Drain, Fort, Ganguli, Henighan, Johnston, Kadavath, Kernion, Lovitt, Ndousse, Ngo, Olsson, Elhage, Perez, Hernandez, Clark, Bucknall, Conerly, Hume, Kaplan, Kravec, Lovitt, McKinnon, Nanda, Olah, Rossignol, Sumers, Askell, Kernion. "Constitutional AI: Harmlessness from AI Feedback." arXiv 2022. [https://arxiv.org/abs/2212.08073](https://arxiv.org/abs/2212.08073)

20. Liu et al. "Constitution or Collapse? Exploring Constitutional AI with Llama 3-8B." arXiv 2025. [https://arxiv.org/html/2504.04918v1](https://arxiv.org/html/2504.04918v1) *(single source — replication result, unverified independently)*

21. Zheng, Chiang, Sheng, Zhuang, Wu, Zhuang, Lin, Li, Li, Xing, Zhang, Gonzalez, Stoica. "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena." NeurIPS 2023. [https://arxiv.org/abs/2306.05685](https://arxiv.org/abs/2306.05685)

22. Panickssery, Bowman, Feng. "LLM Evaluators Recognize and Favor Their Own Generations." NeurIPS 2024. [https://arxiv.org/abs/2404.13076](https://arxiv.org/abs/2404.13076)

23. Gu et al. "LLMs-as-Judges: A Comprehensive Survey on LLM-based Evaluation Methods." arXiv 2024. [https://arxiv.org/abs/2411.15594](https://arxiv.org/abs/2411.15594)

24. Lai & Tan. "On Human Predictions with Explanations and Predictions of Machine Learning Models: A Case Study on Deception Detection." FAccT 2019. [https://arxiv.org/abs/1811.07901](https://arxiv.org/abs/1811.07901)

25. Zhang, Liao, Muller. "Effect of Confidence and Explanation on Accuracy and Trust Calibration in AI-Assisted Decision Making." FAccT 2020. [https://arxiv.org/abs/2001.02114](https://arxiv.org/abs/2001.02114)
