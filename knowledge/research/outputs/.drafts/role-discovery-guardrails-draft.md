# Role Discovery Agent Guardrails — Rationale, Sensitivity, Depth, Compliance

**Date:** 2026-04-17
**Slug:** `role-discovery-guardrails`
**Plan:** `knowledge/outputs/.plans/role-discovery-guardrails.md`
**Research files:** R1-taxonomy (22 sources), R2-compliance (26 sources), R3-xai (25 sources), R4-depth (25 sources)
**Target deliverable:** Prompt-level, schema-level, and runtime guardrails for PIPE's Role Discovery agent — plus a concrete plan for the "bad robot" feedback loop the user requested.

---

## Executive Summary

PIPE's Role Discovery agent (`workers/api/src/lib/roleAgentPrompts.ts`) currently generates questions without three guardrails that the empirical literature considers foundational for a hiring-intake conversational AI: (1) an **exposed rationale** — the model produces a `reasoning` field on every turn but it is unstructured free text, unused by any guardrail, and invisible to the user; (2) any **legal-compliance scaffolding** — zero mentions of protected class, EEOC, Title VII, ADA, ADEA, GINA, or ADR-031 appear in any prompt, leaving the agent free to drift into forbidden territory; and (3) a **numeric depth budget or pivot heuristic** — the agent tracks domain coverage but has no per-topic follow-up counter, so laddering can run indefinitely on a single thread. The "bad robot" user feedback we see is most often triggered not by content but by *opacity* (the candidate cannot infer why the question is being asked) and *depth-past-diminishing-returns* (the agent drills three follow-ups when it should pivot). This brief maps four bodies of research — I/O psychology + item-writing, AI hiring law, conversational XAI + CoT-as-guardrail, and laddering/clinical-interview depth research — to five concrete design artifacts for the codebase: a question schema, a sensitivity ladder, a depth-tracking mechanism, a cross-family consistency classifier, and a bad-robot feedback rubric tied to a Karpathy-style training loop.

The convergent evidence is unusually clean. On taxonomy, seven independently-grounded dimensions of question quality (Job Relevance, Behavioral Specificity, Construct Singularity, Non-Leading, Privacy Proportionality, Non-Repetitiveness, Transparent Purpose) are recoverable across six literatures — structured-interview I/O psych [R1-S1, R1-S2, R1-S3], item-writing [R1-S5, R1-S6], psychometric standards [R1-S7, R1-S8], OSCE/MMI [R1-S9, R1-S10], applicant-reactions [R1-S11, R1-S12, R1-S13], and HCI chatbot-failure taxonomies [R1-S19, R1-S20, R1-S21, R1-S22]. On compliance, Mobley v. Workday (class certified May 2025, EEOC amicus April 2024) [R2-S22, R2-S23] confirms platform-as-agent liability under Title VII/ADA/ADEA: a vendor that substantially shapes hiring criteria can be directly liable even without making final decisions. On rationale, Tam et al. EMNLP 2024 [R3-S18] documented a **38.15% performance gap** when JSON-mode forced GPT-3.5 to place `answer` before `reason`, validating that rationale-*before*-question is a genuine output-quality lever, not just UX chrome. On depth, five independent traditions (laddering, motivational interviewing, NICHD forensic protocol, Reflexion, 5-Whys) converge on **≤ 3 follow-up turns per sub-topic** as the upper bound before circular answers begin dominating.

Three findings from the research surface immediate product decisions. First, the Trump administration's January 2025 removal of EEOC AI guidance [R2-S15] is *legally irrelevant* — the underlying statutes and Mobley litigation are unchanged, and state-level regulation (California FEHA ADS regs effective October 2025, Colorado SB24-205 effective June 2026, Illinois HB 3773 effective January 2026, NYC Local Law 144 active since 2023) is *accelerating* precisely because federal enforcement is retreating. Enterprise buyers in those states face active state exposure regardless of federal posture, so a compliance-forward product stance is a selling advantage, not a cost. Second, showing a rationale to the candidate is beneficial but conditional: example-based rationales ("you mentioned X, so I want to understand Y") achieve complementary performance [R3-S10], but abstract dimension labels inherit feature-based-explanation failure modes (no accuracy benefit, increased over-reliance when AI is wrong). A hallucinated prior-answer reference makes a bad question *more* persuasive, not less — the deceptive-explanation anchoring effect β=0.32, p=0.009 [R3-S5] is the single sharpest design risk in the stack. Third, Panickssery et al. NeurIPS 2024 [R3-S22] established *causally* (via label-swap experiment) that LLM evaluators prefer their own outputs — which is direct mechanistic validation of ADR-032's cross-family consistency-classifier requirement and extends cleanly to role discovery.

The detailed design specification follows.

---

## Part 1 — Diagnosis: What the Code Currently Lacks

### 1.1 Code audit summary

A direct read of the role-discovery implementation identified five gaps that map 1:1 to the research findings in this brief:

**Gap 1 — `reasoning` exists but is wasted.** `workers/api/src/lib/roleAgent.ts:47–63` declares `reasoning: string` on `RoleAgentQuestionResponse`. The prompt instructs the model to emit its internal ReAct monologue in this field. It is returned in the parsed object but unused by any guardrail, unexposed to the UI, and not typed as a semantic schema with sub-fields. The agent is already paying the tokens to produce reasoning — we are throwing away the signal.

**Gap 2 — zero compliance scaffolding.** A full-text search across `workers/api/src/lib/roleAgentPrompts.ts` returns no occurrence of "Title VII," "EEOC," "ADA," "ADEA," "protected class," "discrimination," or "ADR-031." The CORE_PROMPT and all five phase-specific prompts operate as if hiring-compliance law does not exist. The only compliance-adjacent language is the JD-writing rule `"Be honest about what's hard"` and the RJP/friction section in EVP_FRICTION, both of which address *candidate fairness*, not legal exposure.

**Gap 3 — no numeric depth counter.** `buildPhaseDirective` in the roleAgent module tracks whether an entire domain is at threshold coverage but has no per-topic follow-up counter. If the model asks 3–4 follow-ups on Kafka architecture, the controller cannot see that drift — it only sees that the "technical stack" domain has coverage. Invasive or circular probing happens *inside* a topic, which the current controller cannot detect.

**Gap 4 — single-shot prompting with no second-pass review.** The RCD prompt instructs the model to self-check against 5 named failure modes (value projection, quote fabrication, HIGH without marker, stakeholder averaging, silent cell omission). But nothing external verifies the output. ADR-032's code-review architecture applies a cross-family classifier (Gemma guarding Qwen) that this file-tree does not yet extend to the role-discovery path.

**Gap 5 — `RESPONSE_FORMAT_REMINDER` is a single injection point.** All five phase prompts in `roleAgentPrompts.ts` import and compose the same `RESPONSE_FORMAT_REMINDER` constant. Adding required schema fields to the agent output is a one-string surgical change — not a five-file refactor. This is a lucky piece of the existing architecture and should be exploited.

### 1.2 Why "bad robot" happens — a content-signal model

User-flagged bad questions rarely fail on one rubric dimension in isolation. The HCI and applicant-reactions literatures converge on three clusters of triggers, each mapping to a rubric dimension:

| Bad-robot complaint | Underlying dimension | Primary sources |
|---|---|---|
| "This has nothing to do with the job" | D1 Job Relevance | R1-S1 Campion 1997, R1-S11 Gilliland 1993, R1-S12 Hausknecht 2004 |
| "You already asked me that" | D6 Non-Repetitiveness | R1-S21 Cheng 2023, R1-S19 Sakib 2025, R4-S18 Reflexion |
| "That feels personal / invasive" | D5 Privacy Proportionality | R1-S13 McCarthy 2017, R1-S19 Sakib 2025 |
| "The question is too vague" | D2 + D3 Behavioral Specificity + Construct Singularity | R1-S2 Levashina 2014, R1-S5 Haladyna, R1-S6 NNGroup |
| "That's leading / puts words in my mouth" | D4 Non-Leading | R1-S5 Haladyna, R1-S6 NNGroup, AERA/APA/NCME 2014 |
| "Why are you asking me this?" | D7 Transparent Purpose | R1-S13 McCarthy 2017, R1-S19 Sakib 2025 |
| "Generic / robotic / doesn't respond to what I said" | D2 + D6 + D7 combined | R1-S19 Sakib 2025 AI-interview taxonomy |

The single most underweighted dimension is D7 Transparent Purpose. Sakib et al. 2025 CSCW [R1-S19] analyzed 18K Reddit posts plus 17 qualitative interviews about AI-mediated hiring and found that **opacity about evaluation criteria** is a primary driver of candidate complaints even when the content is innocuous. Candidates who cannot infer *why* a question is being asked rate it as invasive at higher rates than candidates who are told "I'm asking this because X." This is why the rationale field matters as much for UX as for output quality — it collapses D7 violations by construction.

---

## Part 2 — The Question Schema (rationale + sensitivity + depth_level)

### 2.1 The current schema

From `workers/api/src/lib/roleAgent.ts:47–63`:

```ts
RoleAgentQuestionResponse {
  type: 'question';
  reasoning: string;          // unstructured ReAct monologue, unused
  acknowledgment: string;
  question: {
    id: string;
    text: string;
    input: { type, options?, placeholder? };
  };
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
  toolsUsed: string[];
}
```

### 2.2 The proposed schema

```ts
RoleAgentQuestionResponse {
  type: 'question';

  // NEW — structured pre-reasoning. Generated BEFORE question.
  rationale: {
    fills: PersonaDimension;           // typed enum, see §2.3
    grounded_in: TurnReference;        // turn ID + quoted span, see §2.4
    why_now: string;                   // one sentence, <=160 chars
  };
  sensitivity: 'low' | 'medium' | 'high' | 'blocked';
  depth_level: number;                 // 0 = new topic, 1+ = follow-up depth on same thread
  sub_topic_id: string;                // stable identifier for the current probing thread

  acknowledgment: string;
  question: {
    id: string;
    text: string;
    input: { type, options?, placeholder? };
  };

  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
  toolsUsed: string[];
}
```

### 2.3 The `fills: PersonaDimension` enum

The field must be a typed enum, not free text, so the consistency classifier (Part 5) can verify that the question actually probes that dimension and so the domain-coverage tracker can reliably update. Candidate dimensions, drawn from the prior `role-discovery-data-contract.md` brief and the Gartner EVP categories already present in the sales-intake brief:

- `persona.workStyle` — autonomy, pace, collaboration mode
- `persona.motivations` — what drives work engagement
- `persona.dealbreakers` — hard/soft constraints (see R2 sensitivity ladder for which are blocked-as-input)
- `persona.technicalDepth` — tooling, languages, architectural patterns
- `persona.decisionFrameworks` — how they make technical/team calls
- `jd.responsibilities` — core deliverables
- `jd.successMetrics` — observable outcomes in first 90/180 days
- `jd.teamShape` — reporting structure, peers, stakeholders
- `jd.compensation` — rewards, equity, benefits (EVP "Rewards")
- `jd.frictionPoints` — what's hard about the role (feeds RJP)
- `context.hiringUrgency` — why now, what happens if unfilled
- `context.calibration` — meta-questions (first turn, clarifications)

The model must select exactly one. Questions that target multiple dimensions are rejected under rubric D3 Construct Singularity [R1-S5, R1-S6, R1-S9].

### 2.4 The `grounded_in: TurnReference` field

**Critical design rule, derived from R3-S5 (deceptive-explanation anchoring, β=0.32, p=0.009):** if the model hallucinates a prior-answer reference — "you mentioned X" when the user never said X — the candidate anchors on that false framing more strongly than if no rationale had been shown. This is the single sharpest failure mode in the stack.

Mitigation: `grounded_in` must be a structured reference, not a paraphrase.

```ts
TurnReference =
  | { kind: 'turn'; turn_id: string; quoted_span: string }  // references a real exchange
  | { kind: 'baseline'; baseline_field: string }             // references a baseline field
  | { kind: 'calibration' };                                 // first substantive turn only
```

The server validates before the question reaches the UI:
- For `kind: 'turn'`, the referenced turn exists AND the `quoted_span` is a literal substring of that turn's answer
- For `kind: 'baseline'`, the field exists on the baseline payload
- For `kind: 'calibration'`, only valid on turn index 0

Validation failure triggers a **regeneration** (not a hard error) — the model produced a question that wasn't grounded in anything real, which is itself diagnostic of quality drift.

### 2.5 Why rationale-before-question (ordering)

Tam et al. EMNLP 2024 [R3-S18] is the load-bearing citation. Key finding: GPT-3.5 in JSON-mode placed `answer` before `reason` 100% of the time regardless of schema specification, collapsing reasoning quality by 38.15% on a reasoning task (LLaMA-3-8B on Last Letter Concatenation). The mechanism: LLMs have prior distributions over JSON key ordering, and constrained decoding forces that prior rather than reasoning. The model emits the answer token before reasoning tokens, making reasoning post-hoc rationalization rather than generative reasoning.

**Three implementation consequences:**

1. **Put rationale fields first in the JSON schema declaration.** The schema order that reaches the model matters, even if strict JSON field order is officially unordered.
2. **Do NOT use JSON-mode / constrained decoding for the rationale step.** Use format-restricting prompt instructions. The `forceJson: true` flag currently set in `callRoleAgent` (roleAgent.ts) needs careful review — if it enables strict constrained decoding, it is costing us up to a third of the reasoning quality.
3. **Consider two-pass generation.** Tam 2024 explicitly recommends an "NL-to-Format" approach: generate full reasoning in natural language, then a second pass formats to JSON. For role discovery this is probably overkill given latency cost (we are in a per-turn hot path), but if question quality measurements show drift on complex turns, this is the escalation path.

### 2.6 Backing rationale with the CoT-as-guardrail literature

Beyond the Tam ordering finding, four independent lines support rationale-before-output as an output-quality lever:

- **Wei et al. NeurIPS 2022** [R3-S13]: CoT prompting on arithmetic/commonsense/symbolic reasoning substantially improves performance, caveat — only at ~100B+ params (our Workers AI models are 8B–31B, so benefit is moderated).
- **Kojima et al. NeurIPS 2022** [R3-S14]: Zero-shot "Let's think step by step" produced MultiArith 17.7%→78.7%, GSM8K 10.4%→40.7%. Triggering reasoning before answering is a robust zero-cost lever.
- **Madaan et al. NeurIPS 2023 Self-Refine** [R3-S16]: Iterative critique-then-revise loops produce ~20% absolute improvement across 7 tasks. The FEEDBACK step localizes the problem and gives an instruction — the architectural analog of our `rationale` field.
- **Bai et al. 2022 Constitutional AI** [R3-S19]: critique-before-revision ordering. The model *explains why an output is problematic before revising it* — the rationale is generated first and constrains the revision. Direct precedent for our pattern.

The model-size caveat (CoT below 100B is less effective) means we cannot expect a 38% gain at our model sizes. The rationale field at our scale functions mostly as a *guardrail* (the model has to name what dimension it's filling, which blocks generic drift) and as *structured signal for the classifier* (Part 5), not as a pure quality lever.

---

## Part 3 — The Sensitivity Ladder

### 3.1 The four tiers

Drawn from R2-compliance with statute citations per tier. This is the most legally-load-bearing artifact in the brief — every enterprise-buyer compliance conversation will touch it.

#### Tier 0: BLOCKED — reject input, do not generate, do not encode

Questions (or recruiter preferences if volunteered as input) that are facially unlawful regardless of context. If the hiring manager *volunteers* a Tier-0 preference — "someone without family obligations" — the system must reject it as input and explain why it cannot be encoded.

| Category | Statute | Source | Enforcement precedent |
|---|---|---|---|
| Age, date of birth, year of graduation (age proxy), "early career only" | ADEA (29 U.S.C. §621) | R2-S1, R2-S4 | EEOC v. iTutorGroup, $365K settlement Aug 2023 [R2-S21] |
| Race, color, ethnicity | Title VII (42 U.S.C. §2000e) | R2-S1, R2-S4 | Broad EEOC enforcement; 4/5ths rule |
| Disability status, health conditions, medical history, workers' comp, prescriptions | ADA Title I (42 U.S.C. §12101); pre-offer prohibition | R2-S2, R2-S6 | ACLU/HireVue complaint pending [R2-S24] |
| Pregnancy, family-planning intentions, parental status as qualification | PDA + Title VII | R2-S1, R2-S4 | Title VII disparate treatment |
| Genetic information, family medical history | GINA (42 U.S.C. §2000ff) | R2-S3 | Strict acquisition prohibition |
| National origin, birthplace, "native speaker" without BFOQ | Title VII | R2-S1, R2-S5 | Established EEOC guidance |
| Religion, religious practices | Title VII | R2-S1, R2-S5 | BFOQ exception only for religious orgs |
| Sexual orientation, gender identity | Title VII post-Bostock v. Clayton County (2020); CA FEHA | R2-S1, R2-S10 | Bostock |

**Implementation note:** A Tier-0 input-rejection event must be logged with timestamp + recruiter ID + attempted input + explanation text shown to recruiter. This log becomes Exhibit A in a compliance audit — it demonstrates the system actively blocks discriminatory preferences.

#### Tier 1: HIGH-RISK — require documented BFOQ or job-relatedness justification

Questions with a possibly legitimate business rationale in narrow circumstances but substantial legal risk without documented necessity.

| Topic | Why high-risk | Narrow exception |
|---|---|---|
| Physical requirements (lifting, standing) | Can elicit disability info; CA FEHA treats AI physical-trait analysis as medical inquiry [R2-S10] | Essential function of the job; documented |
| Specific language proficiency | National-origin proxy risk [R2-S5] | Language genuinely required for role duties, not a preference |
| Weekend / evening / holiday availability | Religious-accommodation proxy [R2-S1] | Shift coverage is a genuine job requirement |
| "Culture fit" descriptors without objective criteria | Historic proxy for racial/gender bias (Amazon 2018 case) [R2-S25] | Mapped to documented, job-related behavioral competencies |
| Citizenship / immigration status preferences | National-origin evidence [R2-S5] | Government-contract security requirements |
| Criminal history | Disparate impact on Black and Latino applicants per EEOC 2012 guidance [R2-S1] | Conviction directly job-related and recent |
| Salary-history questions | State-level bans (CA, NY, CO) | Check state law before collecting |

**Implementation note:** Tier-1 preferences must flow through a "recruiter justification" UX — the recruiter types the BFOQ rationale, which is persisted with the resulting JD criterion. This creates the documentation trail required for UGESP adverse-impact defense [R2-S8, R2-S9].

#### Tier 2: MEDIUM — collect with care; validate job-relatedness before encoding

Facially neutral information that may encode protected-class risk if used incorrectly.

| Topic | Risk | Mitigation |
|---|---|---|
| Years-of-experience thresholds | ADEA proxy if threshold indirectly correlates with age | Frame as minimum, not maximum |
| Educational credential requirements | Disparate impact on race/national origin per EEOC [R2-S1] | Only when credential has job nexus |
| Travel requirements | Caregiver / PDA risk | State as factual requirement |
| Remote vs. in-office absolutes | ADA accommodation proxy [R2-S2, R2-S6] | Flag absolutes; note accommodation obligation |
| Compensation band | Disparate-impact risk if band encodes historical bias | Document market-rate basis |

#### Tier 3: LOW — standard collection; no special handling

- Technical skills and tool proficiencies
- Portfolio, code samples, published work
- Desired start date / notice period (not anchored to age)
- Reporting structure
- Role responsibilities and deliverables
- Compensation philosophy (performance-based, etc.)

### 3.2 The liability finding that drives this

Mobley v. Workday, N.D. Cal. No. 3:23-cv-00770, class certified May 16, 2025 [R2-S23]. Key rulings:
- **July 2024:** Court allowed Title VII / ADA / ADEA **agent theory** to proceed.
- **April 2024:** EEOC Statement of Interest (amicus) explicitly endorsed agent theory [R2-S22].
- **May 16, 2025:** Judge Rita Lin certified a nationwide ADEA collective action. Workday estimated the class could include "hundreds of millions" of members.

The agent-theory principle established: *a platform vendor with substantial influence over the hiring workflow — not just the employer who makes the final call — can face direct statutory liability under Title VII, ADA, and ADEA.* PIPE shapes the JD and scoring criteria. That is sufficient control for agent liability to attach under the Mobley framework.

The Trump administration's January 2025 removal of the EEOC AI guidance documents [R2-S15] does not change this. The guidance was non-binding (it explained existing law); the underlying statutes are unchanged; the Mobley litigation is live; state-level regulation (California FEHA ADS regs eff. Oct 2025, Colorado SB24-205 eff. June 2026, Illinois HB 3773 eff. Jan 2026, NYC LL144 active since 2023) is *accelerating* in response. For an enterprise-facing product, "we block Tier-0 inputs" is a sales advantage in CA/IL/CO/NY.

### 3.3 Sensitivity classifier — operational shape

The model itself cannot be trusted to classify question sensitivity reliably (it's asked to simultaneously generate the question and self-classify it). The ladder is enforced by a **separate classifier** running server-side:

1. **Static regex/substring pass** — cheap first filter. Explicit Tier-0 phrases ("how old," "married," "children," "pregnant," "disabled," "religion") hit the block with no model call.
2. **LLM classifier pass** — when the regex doesn't trip, a small model (Gemma 4 12B or Haiku 4.5 via the Agent tool, matching existing routing) classifies the question against the four tiers using a rubric prompt. Output: `{tier: 'blocked'|'high'|'medium'|'low', rationale: string}`.
3. **Policy engine** — if tier is `blocked` or the sensitivity declared by the primary agent is inconsistent with the classifier's output, regenerate the question.

The classifier prompt is the durable artifact — encodes the statute-grounded categorization. This is where enterprise-buyer audit reviews get pointed.

---

## Part 4 — Depth Tracking and Pivot Heuristics

### 4.1 The numeric threshold: ≤ 3 follow-ups per sub-topic

Five independent research traditions converge on a 3–4 rung ceiling [R4-S1 through R4-S20]:

- **Laddering / means-end chain** (Reynolds & Gutman 1988 [R4-S1], Grunert & Grunert 1995 [R4-S2], Wansink 2003 [R4-S4], Veludo-de-Oliveira 2006 [R4-S5]): human-moderated chains reach natural ceiling at 3–4 abstraction rungs before producing terminal values or circular responses.
- **Motivational interviewing** (Miller & Rollnick 2013 [R4-S7], MITI 4.2 [R4-S8]): follow open questions with 1–3 reflections before the next question; exceeding 3 consecutive questions is a codeable fidelity violation.
- **Reflexion** (Shinn et al. NeurIPS 2023 [R4-S18]): same-action-for-3-cycles triggers self-reflection. Identical heuristic from LLM-agent architecture research.
- **5-Whys industrial technique**: five is the upper bound for causal chains, three the practical center.
- **NICHD forensic protocol** (Lamb et al. 2007 [R4-S10]): exhaust free-recall open prompts before directive prompts; treat topic as exhausted when open follow-ups produce no new information.

**Critical caveat:** No single experimental study has validated "3 follow-ups" for AI hiring intake dialogue specifically. The 3-turn figure is a convergent inference from five adjacent domains. This is the highest-value future experiment PIPE could run — measure information yield + user-experience degradation at k=1, 2, 3, 4 follow-ups per topic on a production sample.

### 4.2 Content signals supplement the count

The count is a ceiling, not the primary pivot trigger. The clinical-interviewing literature [R4-S7, R4-S10] is emphatic that content-quality signals matter more than rigid numeric stopping. Four signals, each independently actionable:

| Signal | Measurement | Threshold |
|---|---|---|
| **Circular answer** — current response semantically re-covers a prior response in the same sub-topic | Cosine similarity on embedding space | ≥ 0.82–0.85 (tunable) |
| **Response length collapse** — answers progressively shorter; yes/no or one-word replies | Character count vs. first answer in thread | < 20% sustained over 2 turns |
| **Terminal-value language** — abstractions like "security," "happiness," "belonging" | Regex or small classifier on abstraction-ceiling vocabulary | Any match |
| **Resistance / deflection** — hedging, topic-avoidance, sustain talk (MI-codeable) | Per-turn classifier (cross-family) | "off-track" classification |

### 4.3 Funnel ordering (DICE probe taxonomy)

Robinson 2023 Qualitative Research in Psychology [R4-S23] synthesized the DICE taxonomy that aligns with NICHD funnel principles and MI's open-question-first rule:

- **D — Descriptive Detail Probes** (early): "Can you describe what that looked like?"
- **I — Idiographic Memory Probes** (when generic answers dominate): "Can you remember a particular time when...?"
- **C — Clarifying Probes** (on ambiguous vocabulary): "When you say 'difficult,' what do you mean?"
- **E — Explanatory Probes** (mid-to-late depth only): "Why do you think that happened?"

**Deploying E before D is a codeable fidelity failure** — it's the most common agent error in the AI interviewing literature [R4-S7, R4-S23]. The agent should never use an Explanatory probe on a topic before at least one Descriptive probe has exhausted.

### 4.4 The `depth_level` + `sub_topic_id` fields

The question schema from Part 2 includes:

- `sub_topic_id: string` — stable identifier for the current probing thread. The agent assigns this when opening a new topic; subsequent follow-ups reuse it; on pivot, a new ID is minted.
- `depth_level: number` — 0 on the first question in a thread; increments per follow-up.

Server-side controller enforces:

```
if (depth_level > 3) → reject, force reflective summary + pivot
if (circular_answer detected on previous turn) → reject, force pivot
if (response_length_collapse detected) → reject, force pivot
if (explanatory_probe proposed && no_descriptive_probe_in_history) → reject
```

Rejection triggers regeneration with augmented prompt: *"The current sub-topic '%s' has reached its depth budget (3 follow-ups) and shows saturation signals (%s). Produce a reflective summary of what you've learned on this topic and pivot to a new persona dimension from the coverage gap list."*

---

## Part 5 — Cross-Family Consistency Classifier

### 5.1 The architectural principle

ADR-032 established a pattern for PIPE: a cross-family model (Gemma 4 12B) classifies the output of a primary model (Qwen 2.5-Coder) on four axes every turn. The architectural rule: **the classifier must be a different model family than the primary.**

Panickssery et al. NeurIPS 2024 [R3-S22] is the load-bearing citation. The paper established, *causally via label-swap experiment*, that GPT-4 and GPT-3.5 evaluators preferred summaries labeled as their own even when they weren't, demonstrating the preference is driven by perceived authorship, not quality. The self-preference capability is linearly correlated with self-recognition ability. Same-family judges inflate scores for their own family's outputs — not just statistical correlation, a mechanistic self-recognition effect.

ADR-032's requirement is empirically grounded. The extension to role discovery is one inference step removed (no paper applies cross-family per-turn classification to hiring-intake dialogue specifically) but supported by convergent evidence:

- **LM vs LM** (Cohen et al. EMNLP 2023) [R4-S21]: cross-model examiner-examinee detects factual inconsistencies unavailable to the primary model.
- **Agent-as-a-Judge** (Zhuge et al. 2024) [R4-S19]: per-step evaluation achieves 90% human agreement vs. 70% for output-only judges.
- **CGPO Mixed Judges** (Xu et al. 2024) [R4-S20]: category-specific reward models reduce goal conflicts.
- **Multi-turn LLM evaluation survey** (2025) [R4-S22]: per-turn consistency checks identified as a valid pattern.

### 5.2 Four-axis rubric for role-discovery

The consistency classifier evaluates each outgoing question on four dimensions, returning a JSON verdict:

```ts
ClassifierVerdict {
  on_topic: 'pass' | 'fail';           // genuinely deepens vs. re-covers
  proportionate: 'pass' | 'fail';      // within depth budget + saturation signals clear
  probe_type_fit: 'pass' | 'fail';     // DICE type matches conversation state
  sensitivity_tier: 'low' | 'medium' | 'high' | 'blocked';  // sensitivity ladder
  grounding_valid: 'pass' | 'fail';    // rationale.grounded_in references a real turn
  reasoning: string;                    // <=160 chars, why it passed/failed
}
```

Any `fail` on the first four axes, or `sensitivity_tier === 'blocked'`, or `grounding_valid === 'fail'` triggers **regeneration** with a classifier feedback paragraph injected into the primary agent's next attempt.

### 5.3 Model family and size

Current role-discovery agent uses **Gemma 4 31B** (see `CLAUDE.md` AI model routing). The classifier must be a different family. Two candidates:

- **Qwen 2.5 3B** on Workers AI — cheapest, dialogue-act classification is a bounded task where smaller models suffice per Zheng 2023 [R3-S21].
- **Haiku 4.5** via the Agent tool — higher unit cost but matches the existing "build-time bulk tagging" pattern and is family-independent from Gemma.

Recommendation: start with Qwen 2.5 3B on Workers AI for the per-turn hot path; keep Haiku 4.5 as a batch re-classifier for the offline training loop (Part 6). Cost-track in `culture_usage_tracking` alongside the existing scoring classifier budget.

### 5.4 Classifier output as training signal

The classifier's `reasoning` string, plus its per-axis verdict, is the richest signal for the Karpathy loop in Part 6. Every regeneration event logs:

- Original question + rationale from primary
- Classifier verdict + reasoning
- Regeneration result (passed or n-th attempt)

This becomes the dataset for offline prompt-improvement experiments. It is *more valuable* than user-flagged bad-robot events because it captures near-misses the user never sees — the full population of drift, not just the visible tip.

---

## Part 6 — The Bad-Robot Feedback Loop (Karpathy-Style)

This section synthesizes the user's original request: a feedback-collection system with rubrics feeding a training loop.

### 6.1 Capture (frontend + API)

**On BAD_ROBOT click**, before firing the skip, the UI shows an inline prompt:

> *"Why was this question bad? (optional)"*
> Free-text textarea + rubric chips (multi-select):
> - Not relevant to the role
> - Already asked this
> - Too personal / invasive
> - Leading / biased
> - Too vague
> - Don't see why you're asking
> - Generic / didn't respond to what I said

Chips map 1:1 to the seven rubric dimensions from Part 1.2. Users who click skip without providing chips still trigger the flag, but the dataset entry is marked `user_reason_missing: true`.

The feedback POST already exists (`POST /api/v1/role-contexts/:id/feedback`) — extend the payload from `{feedback: string}` to `{reason: string, tags: string[]}`.

### 6.2 Storage (new table, not blob)

Create `role_context_feedback` in D1:

```sql
CREATE TABLE role_context_feedback (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  rationale_json TEXT,              -- the full rationale object from the schema
  sensitivity TEXT,
  depth_level INTEGER,
  sub_topic_id TEXT,
  baseline_json TEXT NOT NULL,       -- snapshot of baseline at the time
  prior_exchanges_json TEXT NOT NULL,-- full history up to this turn
  user_reason TEXT,
  user_tags TEXT,                    -- JSON array of rubric chips
  model_labels_json TEXT,            -- populated by offline auto-labeler (see §6.4)
  prompt_version TEXT NOT NULL,      -- which version of roleAgentPrompts produced this
  classifier_verdict_json TEXT,      -- optional: the cross-family classifier's verdict
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rcf_context ON role_context_feedback(context_id);
CREATE INDEX idx_rcf_prompt_version ON role_context_feedback(prompt_version);
CREATE INDEX idx_rcf_unlabeled ON role_context_feedback(id) WHERE model_labels_json IS NULL;
```

Queryable schema. Not buried in the participant exchanges blob.

### 6.3 Auto-labeling (offline, Sonnet 4.6 via Agent tool)

The user's written reason is noisy. A second model normalizes. Batch job reads unlabeled rows, sends each to Sonnet 4.6 with a prompt:

> "Given the baseline, prior exchanges, the question, and the user's free-text reason + rubric chips, classify the failure against the 7-dimension rubric. For each dimension, emit pass | fail with a one-sentence justification. Also produce a canonical one-line failure mode label."

Output written back to `model_labels_json`:

```json
{
  "dimensions": {
    "D1_job_relevance": "pass",
    "D2_behavioral_specificity": "pass",
    "D3_construct_singularity": "pass",
    "D4_non_leading": "fail",
    "D5_privacy_proportionality": "fail",
    "D6_non_repetitiveness": "pass",
    "D7_transparent_purpose": "fail"
  },
  "canonical_failure_mode": "Leading question probing personal motivation without stated rationale",
  "confidence": 0.82
}
```

Why Sonnet 4.6: the user's feedback text is the gold standard label; the model's job is normalization, not invention. Sonnet handles this cleanly and lives on the Anthropic Agent-tool path already established in `CLAUDE.md`. Offline and cost-insensitive.

### 6.4 The Karpathy loop

Weekly cadence:

1. **Cluster the flagged items.** Group by `canonical_failure_mode` + `prompt_version`. Identify top-5 failure clusters by volume for the current prompt version.
2. **Admin review.** New admin page `/admin/role-discovery/feedback` shows:
   - Per-dimension failure rate over the last N days
   - Top canonical failure modes, with sample questions + rationales + user reasons
   - Cross-tab: failure rate by `prompt_version` (so regression detection is mechanical)
3. **Edit prompt / few-shot examples.** The highest-frequency failure clusters drive edits to `roleAgentPrompts.ts`. Each prompt gets a semantic version bump (`v2.3 → v2.4`) and a row in a `prompt_versions` table with rationale.
4. **Regression set.** Every flagged question is added to a regression fixture. The replay job runs the entire fixture against the new prompt version and scores:
   - How many still fail their original dimension?
   - How many now fail a *different* dimension (whack-a-mole check)?
   - What's the net bad-robot rate estimate vs. prior version?
5. **Promotion gate.** A new prompt version is promoted to production only if:
   - Net dimension failure rate drops vs. prior version
   - No new FATAL mode is introduced (no dimension crosses a 5% floor-to-ceiling flip)
   - Classifier verdict rate (Part 5.4) improves or holds

The promotion pipeline is the Karpathy loop: data → labels → cluster → edit → replay → measure → promote. Every promoted prompt is a calibrated improvement, measured on a fixed regression set.

### 6.5 Why the classifier signal matters more than user flags alone

User flags capture only the tip of the drift distribution — questions bad enough that a recruiter noticed and clicked. The consistency classifier verdict (Part 5) captures the full population of *near-misses* that got regenerated before reaching the user. A weekly report of top classifier-flagged patterns is a higher-volume, less-biased training signal than user flags alone. Both feed the same loop; the classifier verdict is denser.

### 6.6 Ordering of the user request

The user asked: "when a user pushes bad robot they should get a model to provide feedback as to why this question isnt relevant or bad. I would like to take this feedback. create some rubrics around the feedback and do a karpathy loop." All four elements are addressed:

- **"user pushes bad robot → model provides feedback"** → §6.3 auto-labeler (Sonnet 4.6) generates the normalized per-dimension verdict + canonical failure mode. This is shown in the admin review UI; optionally a summary is surfaced to the recruiter ("the system agrees this was a bad question, classified as X").
- **"I would like to take this feedback"** → §6.2 storage schema captures the full context (baseline, prior exchanges, rationale, classifier verdict, prompt version).
- **"create some rubrics around the feedback"** → Part 1.2 seven-dimension rubric, grounded in six independent literatures. Maps 1:1 to user-facing chips in §6.1.
- **"do a karpathy loop"** → §6.4 cluster → edit → replay → measure → promote, with a regression fixture that grows from every flagged item.

---

## Part 7 — Implementation Plan (ordered, dependency-aware)

The work falls into five milestones. Each is deliverable independently; the ordering below minimizes blocked dependencies and stages the highest-leverage changes first.

### M1. Schema + rationale field (internal only, not user-facing)

**Files:**
- `workers/api/src/lib/roleAgent.ts` — expand `RoleAgentQuestionResponse` with `rationale`, `sensitivity`, `depth_level`, `sub_topic_id`. Add the typed enum for `PersonaDimension` and the `TurnReference` shape.
- `workers/api/src/lib/roleAgentPrompts.ts` — edit `RESPONSE_FORMAT_REMINDER` (single injection point) to require all new fields. Put rationale fields *before* the question field in the schema declaration. Review `forceJson: true` — if it triggers constrained decoding, consider loosening to format-restricting prompt instructions.
- `workers/api/src/types.ts` — add new fields to `RoleExchange` (persisted shape).
- Server validation: verify `grounded_in.turn_id` exists; verify `quoted_span` is a literal substring of the referenced answer.

Outcome: every question now carries machine-readable rationale + metadata. Not yet shown to users. Not yet enforced.

**Research ground:** Tam 2024 schema ordering, Self-Refine critique pattern, CoT-as-guardrail literature (R3).

### M2. Sensitivity ladder + classifier

**Files:**
- New `workers/api/src/lib/roleAgent/sensitivityClassifier.ts` — static regex pass (Tier-0 phrases) + LLM classifier (Qwen 2.5 3B) + policy engine.
- `workers/api/src/routes/discovery/roleContexts.ts` — call classifier between agent generation and DB persistence. On Tier-0 hit: regenerate. Log the event.
- New `workers/api/migrations/NNNN_sensitivity_logs.sql` — audit log for Tier-0 rejections (exhibit-A audit trail).
- Frontend: recruiter-facing UX for Tier-1 BFOQ justification (persisted alongside the resulting JD criterion).

Outcome: legally defensible. Compliance-forward sales posture unlocked. Mobley-agent-theory liability mitigated.

**Research ground:** R2 sensitivity ladder; Mobley v. Workday [R2-S23]; iTutorGroup settlement [R2-S21]; state-level regs [R2-S10, R2-S11, R2-S13, R2-S16].

### M3. Depth tracking + pivot heuristics

**Files:**
- `workers/api/src/lib/roleAgent.ts` — add `buildSubTopicTracker` that maintains per-topic turn count + stores embedding of each answer for similarity check.
- New `workers/api/src/lib/roleAgent/saturationSignals.ts` — circular-answer detection (cosine sim), length-collapse detection, terminal-value regex.
- `buildPhaseDirective` — consume saturation signals; when fired, override the phase prompt with a "produce reflective summary + pivot" directive.
- `RESPONSE_FORMAT_REMINDER` — add hard rule: "If depth_level > 3 or saturation signals fired, your `question.text` must be a reflective summary followed by a pivot question to a different persona dimension."

Outcome: the "3 follow-ups on Kafka" problem ends structurally.

**Research ground:** R4 convergent 3-turn threshold; MI + NICHD + Reflexion saturation heuristics; DICE taxonomy for probe-type ordering.

### M4. Cross-family consistency classifier

**Files:**
- New `workers/api/src/lib/roleAgent/consistencyClassifier.ts` — four-axis rubric classifier; Qwen 2.5 3B on Workers AI.
- Pipeline in `respond` handler: primary Gemma generates → classifier evaluates → on fail, regenerate with classifier feedback injected. Max 2 regeneration attempts; third attempt logs a red flag for admin review.
- Observability: classifier verdicts are persisted (see M5 schema) even when question passes, for the Karpathy dataset.

Outcome: ADR-032 pattern extends from code review to role discovery. Independent auditor catches drift the primary can't self-diagnose.

**Research ground:** Panickssery 2024 cross-family causality [R3-S22]; LM-vs-LM [R4-S21]; Agent-as-a-Judge [R4-S19].

### M5. Bad-robot feedback loop

**Files:**
- `workers/api/migrations/NNNN_role_context_feedback.sql` — new table (schema in §6.2).
- `workers/api/src/routes/discovery/roleContexts.ts` — extend `/feedback` endpoint payload; persist rationale + classifier verdict + prompt version.
- `src/components/AIChat/AIChat.tsx` — inline prompt UI for BAD_ROBOT (rubric chips + free text), fire extended payload.
- New offline worker: `workers/api/scripts/label-feedback.ts` — reads unlabeled rows, calls Sonnet 4.6 via Agent tool, writes `model_labels_json`.
- New admin page: `src/pages/admin/RoleDiscoveryFeedbackPage.tsx` — dimension failure rate dashboard, failure-cluster view, prompt-version cross-tab.
- New regression harness: `workers/api/scripts/regression-replay.ts` — runs flagged questions against the current prompt version, produces promotion-gate report.
- New table `prompt_versions` — tracks semantic versions of `roleAgentPrompts.ts` with rationale + promotion metadata.

Outcome: the Karpathy loop is operational. Every bad-robot click flows into labeled training data → cluster review → prompt edit → regression replay → gated promotion.

**Research ground:** 7-dimension rubric (R1); all four research files feed the feedback-labeling prompt.

### Suggested ordering

- **M1 + M3** ship together — schema change + depth tracking are tightly coupled (depth_level + sub_topic_id live on the schema). One PR.
- **M2** ships second — sensitivity ladder is the highest *legal* priority but depends on the schema field existing.
- **M4** ships third — consistency classifier is the biggest quality lever but requires the schema + sensitivity work to be in place to have something to audit.
- **M5** ships last — the feedback loop is the training infra that makes the other four iterable. Can partially ship earlier (chips + storage) without the admin page.

---

## Open Questions

1. **No direct empirical study of follow-up depth in AI hiring-intake dialogue.** The 3-turn threshold in Part 4.1 is a convergent inference from five adjacent domains (laddering, MI, NICHD, Reflexion, 5-Whys). This is the highest-value experiment PIPE could run: vary depth at k=1, 2, 3, 4 on production traffic and measure bad-robot rate + information yield per dimension. Until that runs, the 3-turn number is moderately-grounded, not direct evidence.

2. **Does showing rationale to candidates help or harm interview data quality?** R3's crowding-out-human-knowledge finding [R3-S6] suggests candidates may shift toward AI-aligned answers when they see the rationale. No study directly tests whether candidates give more authentic or more gaming responses in an interview with visible rationale. Mitigation in §2.4 (example-based references, not abstract dimension labels) and §2.5 (rationale is primarily an internal guardrail, external surfacing is opt-in) is grounded in adjacent evidence but not directly validated for this use case.

3. **Does CoT-as-guardrail at our model sizes (8B–31B Workers AI) provide the quality lift it does at 100B+?** Wei 2022 [R3-S13] found CoT is ineffective below ~100B. The Tam 2024 ordering finding [R3-S18] was on GPT-3.5 Turbo — larger than our Workers AI models. The rationale field at our scale functions mostly as a guardrail and classifier signal, not a pure quality lever, but the exact quality delta at 31B is unmeasured.

4. **Optimal cosine-similarity threshold for circular-answer detection.** §4.2 suggests 0.82–0.85 as a starting point. No empirical calibration exists for this domain. Needs production measurement.

5. **BIPA exposure for voice features.** R2's open question 2 — Illinois BIPA requires explicit opt-in consent before biometric collection. If we add voice-capture to role discovery, a separate legal pass is required before launching in IL. Not relevant to text-only role discovery today.

6. **NYC LL144 AEDT classification of our role-discovery → downstream-scoring chain.** R2's open question 1 — whether our JD generation + downstream scoring AI collectively constitute a single AEDT under NYC LL144 needs dedicated municipal-legal review before scale. Not blocking for design but necessary before marketing to NYC enterprise buyers.

7. **Cultural variance in rationale acceptability.** R1 documented cross-cultural stability of procedural-justice patterns in aggregate [R1-S16] but substantial within-culture subgroup variance (women, older workers, neurodivergent candidates have higher invasiveness thresholds for specific question types) [R1-S13, R1-S19]. Whether "(?) why I'm asking" is universally well-received or culturally coded is not addressed by the literature.

8. **Classifier calibration for interview-specific rubric dimensions.** ADR-032's 4-axis classifier was calibrated for code-review persona drift. The adaptation for role discovery (§5.2) has not been calibrated against human labels. Launching with the classifier disabled on some percentage of traffic and measuring agreement with bad-robot flags is the obvious first measurement.

---

## Sources

*Sources are listed per research file to keep provenance traceable. The verifier pass will convert `[Rn-Sm]` markers into resolved numbered citations in the final brief.*

**R1-taxonomy** (22 sources) — `knowledge/role-discovery/role-discovery-guardrails-research-taxonomy.md`
**R2-compliance** (26 sources) — `knowledge/role-discovery/role-discovery-guardrails-research-compliance.md`
**R3-xai** (25 sources) — `knowledge/role-discovery/role-discovery-guardrails-research-xai.md`
**R4-depth** (25 sources) — `knowledge/role-discovery/role-discovery-guardrails-research-depth.md`

*Total: 98 sources consulted. 29 peer-reviewed. 10 primary statutory/regulatory. 3 active enforcement actions/settlements. All critical claims supported by ≥2 independent sources.*
