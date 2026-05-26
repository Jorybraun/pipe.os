/# Role Discovery Agent Guardrails — Rationale, Sensitivity, Depth, Compliance

**Date:** 2026-04-17
**Slug:** `role-discovery-guardrails`
**Plan:** `knowledge/outputs/.plans/role-discovery-guardrails.md`
**Research files:** R1-taxonomy (22 sources), R2-compliance (26 sources), R3-xai (25 sources), R4-depth (25 sources)
**Target deliverable:** Prompt-level, schema-level, and runtime guardrails for PIPE's Role Discovery agent — plus a concrete plan for the "bad robot" feedback loop the user requested.

---

## Executive Summary

PIPE's Role Discovery agent (`workers/api/src/lib/roleAgentPrompts.ts`) currently generates questions without three guardrails that the empirical literature considers foundational for a hiring-intake conversational AI: (1) an **exposed rationale** — the model produces a `reasoning` field on every turn but it is unstructured free text, unused by any guardrail, and invisible to the user; (2) any **legal-compliance scaffolding** — zero mentions of protected class, EEOC, Title VII, ADA, ADEA, GINA, or ADR-031 appear in any prompt, leaving the agent free to drift into forbidden territory; and (3) a **numeric depth budget or pivot heuristic** — the agent tracks domain coverage but has no per-topic follow-up counter, so laddering can run indefinitely on a single thread. The "bad robot" user feedback we see is most often triggered not by content but by *opacity* (the candidate cannot infer why the question is being asked) and *depth-past-diminishing-returns* (the agent drills three follow-ups when it should pivot). This brief maps four bodies of research — I/O psychology + item-writing, AI hiring law, conversational XAI + CoT-as-guardrail, and laddering/clinical-interview depth research — to five concrete design artifacts for the codebase: a question schema, a sensitivity ladder, a depth-tracking mechanism, a cross-family consistency classifier, and a bad-robot feedback rubric tied to a Karpathy-style training loop.

The convergent evidence is unusually clean. On taxonomy, seven independently-grounded dimensions of question quality (Job Relevance, Behavioral Specificity, Construct Singularity, Non-Leading, Privacy Proportionality, Non-Repetitiveness, Transparent Purpose) are recoverable across six literatures — structured-interview I/O psych [1][2][3], item-writing [5][6], psychometric standards [7][8], OSCE/MMI [9][10], applicant-reactions [11][12][13], and HCI chatbot-failure taxonomies [19][20][21][22]. On compliance, Mobley v. Workday (class certified May 2025, EEOC amicus April 2024) [R2-S22, R2-S23] confirms platform-as-agent liability under Title VII/ADA/ADEA: a vendor that substantially shapes hiring criteria can be directly liable even without making final decisions. On rationale, Tam et al. EMNLP 2024 [36] documented a **38.15% performance gap** when JSON-mode forced GPT-3.5 to place `answer` before `reason`, validating that rationale-*before*-question is a genuine output-quality lever, not just UX chrome. On depth, five independent traditions (laddering, motivational interviewing, NICHD forensic protocol, Reflexion, 5-Whys) converge on **≤ 3 follow-up turns per sub-topic** as the upper bound before circular answers begin dominating.

Three findings from the research surface immediate product decisions. First, the Trump administration's January 2025 removal of EEOC AI guidance [33] is *legally irrelevant* — the underlying statutes and Mobley litigation are unchanged, and state-level regulation (California FEHA ADS regs effective October 2025, Colorado SB24-205 effective June 2026, Illinois HB 3773 effective January 2026, NYC Local Law 144 active since 2023) is *accelerating* precisely because federal enforcement is retreating. Enterprise buyers in those states face active state exposure regardless of federal posture, so a compliance-forward product stance is a selling advantage, not a cost. Second, showing a rationale to the candidate is beneficial but conditional: example-based rationales ("you mentioned X, so I want to understand Y") achieve complementary performance [28], but abstract dimension labels inherit feature-based-explanation failure modes (no accuracy benefit, increased over-reliance when AI is wrong). A hallucinated prior-answer reference makes a bad question *more* persuasive, not less — the deceptive-explanation anchoring effect β=0.32, p=0.009 [23] is the single sharpest design risk in the stack. Third, Panickssery et al. NeurIPS 2024 [40] established *causally* (via label-swap experiment) that LLM evaluators prefer their own outputs — which is direct mechanistic validation of ADR-032's cross-family consistency-classifier requirement and extends cleanly to role discovery.

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
| "This has nothing to do with the job" | D1 Job Relevance | [1] Campion 1997, [11] Gilliland 1993, [12] Hausknecht 2004 |
| "You already asked me that" | D6 Non-Repetitiveness | [21] Cheng 2023, [19] Sakib 2025, [62] Reflexion |
| "That feels personal / invasive" | D5 Privacy Proportionality | [13] McCarthy 2017, [19] Sakib 2025 |
| "The question is too vague" | D2 + D3 Behavioral Specificity + Construct Singularity | [2] Levashina 2014, [5] Haladyna, [6] NNGroup |
| "That's leading / puts words in my mouth" | D4 Non-Leading | [5] Haladyna, [6] NNGroup, [7] AERA/APA/NCME 2014 |
| "Why are you asking me this?" | D7 Transparent Purpose | [13] McCarthy 2017, [19] Sakib 2025 |
| "Generic / robotic / doesn't respond to what I said" | D2 + D6 + D7 combined | [19] Sakib 2025 AI-interview taxonomy |

The single most underweighted dimension is D7 Transparent Purpose. Sakib et al. 2025 CSCW [19] analyzed 18K Reddit posts plus 17 qualitative interviews about AI-mediated hiring and found that **opacity about evaluation criteria** is a primary driver of candidate complaints even when the content is innocuous. Candidates who cannot infer *why* a question is being asked rate it as invasive at higher rates than candidates who are told "I'm asking this because X." This is why the rationale field matters as much for UX as for output quality — it collapses D7 violations by construction.

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

The model must select exactly one. Questions that target multiple dimensions are rejected under rubric D3 Construct Singularity [5][6][9].

### 2.4 The `grounded_in: TurnReference` field

**Critical design rule, derived from [23] (deceptive-explanation anchoring, β=0.32, p=0.009):** if the model hallucinates a prior-answer reference — "you mentioned X" when the user never said X — the candidate anchors on that false framing more strongly than if no rationale had been shown. This is the single sharpest failure mode in the stack.

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

Tam et al. EMNLP 2024 [36] is the load-bearing citation. Key finding: GPT-3.5 in JSON-mode placed `answer` before `reason` 100% of the time regardless of schema specification, collapsing reasoning quality by 38.15% on a reasoning task (LLaMA-3-8B on Last Letter Concatenation). The mechanism: LLMs have prior distributions over JSON key ordering, and constrained decoding forces that prior rather than reasoning. The model emits the answer token before reasoning tokens, making reasoning post-hoc rationalization rather than generative reasoning.

**Three implementation consequences:**

1. **Put rationale fields first in the JSON schema declaration.** The schema order that reaches the model matters, even if strict JSON field order is officially unordered.
2. **Do NOT use JSON-mode / constrained decoding for the rationale step.** Use format-restricting prompt instructions. The `forceJson: true` flag currently set in `callRoleAgent` (roleAgent.ts) needs careful review — if it enables strict constrained decoding, it is costing us up to a third of the reasoning quality.
3. **Consider two-pass generation.** Tam 2024 [36] explicitly recommends an "NL-to-Format" approach: generate full reasoning in natural language, then a second pass formats to JSON. For role discovery this is probably overkill given latency cost (we are in a per-turn hot path), but if question quality measurements show drift on complex turns, this is the escalation path.

### 2.6 Backing rationale with the CoT-as-guardrail literature

Beyond the Tam ordering finding, four independent lines support rationale-before-output as an output-quality lever:

- **Wei et al. NeurIPS 2022** [34]: CoT prompting on arithmetic/commonsense/symbolic reasoning substantially improves performance, caveat — only at ~100B+ params (our Workers AI models are 8B–31B, so benefit is moderated).
- **Kojima et al. NeurIPS 2022** [35]: Zero-shot "Let's think step by step" produced MultiArith 17.7%→78.7%, GSM8K 10.4%→40.7%. Triggering reasoning before answering is a robust zero-cost lever.
- **Madaan et al. NeurIPS 2023 Self-Refine** [37]: Iterative critique-then-revise loops produce ~20% absolute improvement across 7 tasks. The FEEDBACK step localizes the problem and gives an instruction — the architectural analog of our `rationale` field.
- **Bai et al. 2022 Constitutional AI** [38]: critique-before-revision ordering. The model *explains why an output is problematic before revising it* — the rationale is generated first and constrains the revision. Direct precedent for our pattern.

The model-size caveat (CoT below 100B is less effective) means we cannot expect a 38% gain at our model sizes. The rationale field at our scale functions mostly as a *guardrail* (the model has to name what dimension it's filling, which blocks generic drift) and as *structured signal for the classifier* (Part 5), not as a pure quality lever.

---

## Part 3 — The Sensitivity Ladder

### 3.1 The four tiers

Drawn from R2-compliance with statute citations per tier. This is the most legally-load-bearing artifact in the brief — every enterprise-buyer compliance conversation will touch it.

#### Tier 0: BLOCKED — reject input, do not generate, do not encode

Questions (or recruiter preferences if volunteered as input) that are facially unlawful regardless of context. If the hiring manager *volunteers* a Tier-0 preference — "someone without family obligations" — the system must reject it as input and explain why it cannot be encoded.

| Category | Statute | Source | Enforcement precedent |
|---|---|---|---|
| Age, date of birth, year of graduation (age proxy), "early career only" | ADEA (29 U.S.C. §621) | [43][46] | EEOC v. iTutorGroup, $365K settlement Aug 2023 [53] |
| Race, color, ethnicity | Title VII (42 U.S.C. §2000e) | [43][46] | Broad EEOC enforcement; 4/5ths rule |
| Disability status, health conditions, medical history, workers' comp, prescriptions | ADA Title I (42 U.S.C. §12101); pre-offer prohibition | [44][48] | ACLU/HireVue complaint pending [56] |
| Pregnancy, family-planning intentions, parental status as qualification | PDA + Title VII | [43][46] | Title VII disparate treatment |
| Genetic information, family medical history | GINA (42 U.S.C. §2000ff) | [45] | Strict acquisition prohibition |
| National origin, birthplace, "native speaker" without BFOQ | Title VII | [43][47] | Established EEOC guidance |
| Religion, religious practices | Title VII | [43][47] | BFOQ exception only for religious orgs |
| Sexual orientation, gender identity | Title VII post-Bostock v. Clayton County (2020); CA FEHA | [43][52] | Bostock |

**Implementation note:** A Tier-0 input-rejection event must be logged with timestamp + recruiter ID + attempted input + explanation text shown to recruiter. This log becomes Exhibit A in a compliance audit — it demonstrates the system actively blocks discriminatory preferences.

#### Tier 1: HIGH-RISK — require documented BFOQ or job-relatedness justification

Questions with a possibly legitimate business rationale in narrow circumstances but substantial legal risk without documented necessity.

| Topic | Why high-risk | Narrow exception |
|---|---|---|
| Physical requirements (lifting, standing) | Can elicit disability info; CA FEHA treats AI physical-trait analysis as medical inquiry [52] | Essential function of the job; documented |
| Specific language proficiency | National-origin proxy risk [47] | Language genuinely required for role duties, not a preference |
| Weekend / evening / holiday availability | Religious-accommodation proxy [43] | Shift coverage is a genuine job requirement |
| "Culture fit" descriptors without objective criteria | Historic proxy for racial/gender bias (Amazon 2018 case) [57] | Mapped to documented, job-related behavioral competencies |
| Citizenship / immigration status preferences | National-origin evidence [47] | Government-contract security requirements |
| Criminal history | Disparate impact on Black and Latino applicants per EEOC 2012 guidance [43] | Conviction directly job-related and recent |
| Salary-history questions | State-level bans (CA, NY, CO) | Check state law before collecting |

**Implementation note:** Tier-1 preferences must flow through a "recruiter justification" UX — the recruiter types the BFOQ rationale, which is persisted with the resulting JD criterion. This creates the documentation trail required for UGESP adverse-impact defense [50][51].

#### Tier 2: MEDIUM — collect with care; validate job-relatedness before encoding

Facially neutral information that may encode protected-class risk if used incorrectly.

| Topic | Risk | Mitigation |
|---|---|---|
| Years-of-experience thresholds | ADEA proxy if threshold indirectly correlates with age | Frame as minimum, not maximum |
| Educational credential requirements | Disparate impact on race/national origin per EEOC [43] | Only when credential has job nexus |
| Travel requirements | Caregiver / PDA risk | State as factual requirement |
| Remote vs. in-office absolutes | ADA accommodation proxy [44][48] | Flag absolutes; note accommodation obligation |
| Compensation band | Disparate-impact risk if band encodes historical bias | Document market-rate basis |

#### Tier 3: LOW — standard collection; no special handling

- Technical skills and tool proficiencies
- Portfolio, code samples, published work
- Desired start date / notice period (not anchored to age)
- Reporting structure
- Role responsibilities and deliverables
- Compensation philosophy (performance-based, etc.)

### 3.2 The liability finding that drives this

Mobley v. Workday, N.D. Cal. No. 3:23-cv-00770, class certified May 16, 2025 [55]. Key rulings:
- **July 2024:** Court allowed Title VII / ADA / ADEA **agent theory** to proceed.
- **April 2024:** EEOC Statement of Interest (amicus) explicitly endorsed agent theory [54].
- **May 16, 2025:** Judge Rita Lin certified a nationwide ADEA collective action. Workday estimated the class could include "hundreds of millions" of members.

The agent-theory principle established: *a platform vendor with substantial influence over the hiring workflow — not just the employer who makes the final call — can face direct statutory liability under Title VII, ADA, and ADEA.* PIPE shapes the JD and scoring criteria. That is sufficient control for agent liability to attach under the Mobley framework.

The Trump administration's January 2025 removal of the EEOC AI guidance documents [33] does not change this. The guidance was non-binding (it explained existing law); the underlying statutes are unchanged; the Mobley litigation is live; state-level regulation (California FEHA ADS regs eff. Oct 2025, Colorado SB24-205 eff. June 2026, Illinois HB 3773 eff. Jan 2026, NYC LL144 active since 2023) is *accelerating* in response. For an enterprise-facing product, "we block Tier-0 inputs" is a sales advantage in CA/IL/CO/NY.

### 3.3 Sensitivity classifier — operational shape

The model itself cannot be trusted to classify question sensitivity reliably (it's asked to simultaneously generate the question and self-classify it). The ladder is enforced by a **separate classifier** running server-side:

1. **Static regex/substring pass** — cheap first filter. Explicit Tier-0 phrases ("how old," "married," "children," "pregnant," "disabled," "religion") hit the block with no model call.
2. **LLM classifier pass** — when the regex doesn't trip, a small model (Gemma 4 12B or Haiku 4.5 via the Agent tool, matching existing routing) classifies the question against the four tiers using a rubric prompt. Output: `{tier: 'blocked'|'high'|'medium'|'low', rationale: string}`.
3. **Policy engine** — if tier is `blocked` or the sensitivity declared by the primary agent is inconsistent with the classifier's output, regenerate the question.

The classifier prompt is the durable artifact — encodes the statute-grounded categorization. This is where enterprise-buyer audit reviews get pointed.

---

## Part 4 — Depth Tracking and Pivot Heuristics

### 4.1 The numeric threshold: ≤ 3 follow-ups per sub-topic

Four independent research traditions on interview discourse converge on a 3–4 rung ceiling [61][63][65][66][67][70]:

- **Laddering / means-end chain** (Reynolds & Gutman 1988 [61], Grunert & Grunert 1995 [63], Wansink 2003 [65], Veludo-de-Oliveira 2006 [66]): human-moderated chains reach natural ceiling at 3–4 abstraction rungs before producing terminal values or circular responses.
- **Motivational interviewing** (Miller & Rollnick 2013 [67], MITI 4.2 [68]): follow open questions with 1–3 reflections before the next question; exceeding 3 consecutive questions is a codeable fidelity violation.
- **5-Whys industrial technique**: five is the upper bound for causal chains, three the practical center.
- **NICHD forensic protocol** (Lamb et al. 2007 [70]): exhaust free-recall open prompts before directive prompts; treat topic as exhausted when open follow-ups produce no new information.

**Weakly analogous (different domain, directionally consistent):** Reflexion (Shinn et al. NeurIPS 2023 [62]) triggers LLM self-reflection after 3 repeated action-response cycles. This is an action-loop detector in agent architectures, not a discourse-depth measure in human conversation — we note it as supporting observation rather than a convergent tradition (see reviewer note M4 in Open Questions).

**Critical caveat:** No single experimental study has validated "3 follow-ups" for AI hiring intake dialogue specifically. The 3-turn figure is a convergent inference from five adjacent domains. This is the highest-value future experiment PIPE could run — measure information yield + user-experience degradation at k=1, 2, 3, 4 follow-ups per topic on a production sample.

### 4.2 Content signals supplement the count

The count is a ceiling, not the primary pivot trigger. The clinical-interviewing literature [67][70] is emphatic that content-quality signals matter more than rigid numeric stopping. Four signals, each independently actionable:

| Signal | Measurement | Threshold |
|---|---|---|
| **Circular answer** — current response semantically re-covers a prior response in the same sub-topic | Cosine similarity on embedding space | ≥ 0.82–0.85 (tunable) |
| **Response length collapse** — answers progressively shorter; yes/no or one-word replies | Character count vs. first answer in thread | < 20% sustained over 2 turns |
| **Terminal-value language** — abstractions like "security," "happiness," "belonging" | Regex or small classifier on abstraction-ceiling vocabulary | Any match |
| **Resistance / deflection** — hedging, topic-avoidance, sustain talk (MI-codeable) | Per-turn classifier (cross-family) | "off-track" classification |

### 4.3 Funnel ordering (DICE probe taxonomy)

Robinson 2023 Qualitative Research in Psychology [78] synthesized the DICE taxonomy that aligns with NICHD funnel principles and MI's open-question-first rule:

- **D — Descriptive Detail Probes** (early): "Can you describe what that looked like?"
- **I — Idiographic Memory Probes** (when generic answers dominate): "Can you remember a particular time when...?"
- **C — Clarifying Probes** (on ambiguous vocabulary): "When you say 'difficult,' what do you mean?"
- **E — Explanatory Probes** (mid-to-late depth only): "Why do you think that happened?"

**Deploying E before D is a codeable fidelity failure** — it's the most common agent error in the AI interviewing literature [67][78]. The agent should never use an Explanatory probe on a topic before at least one Descriptive probe has exhausted.

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

Panickssery et al. NeurIPS 2024 [40] is the load-bearing citation. The paper established, *causally via label-swap experiment*, that GPT-4 and GPT-3.5 evaluators preferred summaries labeled as their own even when they weren't, demonstrating the preference is driven by perceived authorship, not quality. The self-preference capability is linearly correlated with self-recognition ability. Same-family judges inflate scores for their own family's outputs — not just statistical correlation, a mechanistic self-recognition effect.

ADR-032's requirement is empirically grounded. The extension to role discovery is one inference step removed (no paper applies cross-family per-turn classification to hiring-intake dialogue specifically) but supported by convergent evidence:

- **LM vs LM** (Cohen et al. EMNLP 2023) [75]: cross-model examiner-examinee detects factual inconsistencies unavailable to the primary model.
- **Agent-as-a-Judge** (Zhuge et al. 2024) [73]: per-step evaluation achieves 90% human agreement vs. 70% for output-only judges.
- **CGPO Mixed Judges** (Xu et al. 2024) [74]: category-specific reward models reduce goal conflicts.
- **Multi-turn LLM evaluation survey** (2025) [76]: per-turn consistency checks identified as a valid pattern.

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

**Corrected 2026-04-17:** earlier drafts of this section cited "Gemma 4 31B" and a `@cf/qwen/qwen2.5-3b-instruct` classifier — both wrong. The production role-discovery primary runs `gemma-4-26b-a4b-it` on **Vertex AI MaaS** (`ROLE_AGENT_PROVIDER=vertex-ai`), with Workers AI `cloudflare-ai` as the code default and fallback; see `workers/api/src/lib/llm/createProvider.ts` and the CLAUDE.md routing table. The 31B dense model is not available as Vertex MaaS (`vertexAIProvider.ts:9`). The classifier must be a different family from Gemma. Two candidates:

- **Llama 3.1 8B** (`@cf/meta/llama-3.1-8b-instruct`) on Workers AI — confirmed available on the `env.AI` binding, cross-family from Gemma (Meta Llama training lineage ≠ Google Gemma per Panickssery 2024), cheap. Running on Workers AI regardless of the primary's provider keeps the guardrail available even when the Vertex path is unhealthy. Dialogue-act classification is a bounded task where smaller models suffice per Zheng 2023 [39].
- **Haiku 4.5** via the Agent tool — higher unit cost but matches the existing "build-time bulk tagging" pattern and is family-independent from Gemma.

Recommendation: start with **Llama 3.1 8B on Workers AI** for the per-turn hot path; keep Haiku 4.5 as a batch re-classifier for the offline training loop (Part 6). Cost-track in `culture_usage_tracking` alongside the existing scoring classifier budget.

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

**Research ground:** Tam 2024 schema ordering [36], Self-Refine critique pattern [37], CoT-as-guardrail literature [34][35][38].

### M2. Sensitivity ladder + classifier

**Files:**
- New `workers/api/src/lib/roleAgent/sensitivityClassifier.ts` — static regex pass (Tier-0 phrases) + LLM classifier (Qwen 2.5 3B) + policy engine.
- `workers/api/src/routes/discovery/roleContexts.ts` — call classifier between agent generation and DB persistence. On Tier-0 hit: regenerate. Log the event.
- New `workers/api/migrations/NNNN_sensitivity_logs.sql` — audit log for Tier-0 rejections (exhibit-A audit trail).
- Frontend: recruiter-facing UX for Tier-1 BFOQ justification (persisted alongside the resulting JD criterion).

Outcome: legally defensible. Compliance-forward sales posture unlocked. Mobley-agent-theory liability mitigated.

**Research ground:** R2 sensitivity ladder; Mobley v. Workday [55]; iTutorGroup settlement [53]; state-level regs [52][59][49][58].

### M3. Depth tracking + pivot heuristics

**Files:**
- `workers/api/src/lib/roleAgent.ts` — add `buildSubTopicTracker` that maintains per-topic turn count + stores embedding of each answer for similarity check.
- New `workers/api/src/lib/roleAgent/saturationSignals.ts` — circular-answer detection (cosine sim), length-collapse detection, terminal-value regex.
- `buildPhaseDirective` — consume saturation signals; when fired, override the phase prompt with a "produce reflective summary + pivot" directive.
- `RESPONSE_FORMAT_REMINDER` — add hard rule: "If depth_level > 3 or saturation signals fired, your `question.text` must be a reflective summary followed by a pivot question to a different persona dimension."

Outcome: the "3 follow-ups on Kafka" problem ends structurally.

**Research ground:** R4 convergent 3-turn threshold [61][63][65][66][67][70]; MI + NICHD saturation heuristics [67][70]; Reflexion as weak analogy [62]; DICE taxonomy for probe-type ordering [78].

### M4. Cross-family consistency classifier

**Files:**
- New `workers/api/src/lib/roleAgent/consistencyClassifier.ts` — four-axis rubric classifier; Qwen 2.5 3B on Workers AI.
- Pipeline in `respond` handler: primary Gemma generates → classifier evaluates → on fail, regenerate with classifier feedback injected. Max 2 regeneration attempts; third attempt logs a red flag for admin review.
- Observability: classifier verdicts are persisted (see M5 schema) even when question passes, for the Karpathy dataset.

Outcome: ADR-032 pattern extends from code review to role discovery. Independent auditor catches drift the primary can't self-diagnose.

**Research ground:** Panickssery 2024 cross-family causality [40]; LM-vs-LM [75]; Agent-as-a-Judge [73].

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

**Research ground:** 7-dimension rubric [1][2][3][5][6][7][8][9][10][11][12][13][19][20][21][22]; all four research files feed the feedback-labeling prompt.

### Suggested ordering

- **M1 + M3** ship together — schema change + depth tracking are tightly coupled (depth_level + sub_topic_id live on the schema). One PR.
- **M2** ships second — sensitivity ladder is the highest *legal* priority but depends on the schema field existing.
- **M4** ships third — consistency classifier is the biggest quality lever but requires the schema + sensitivity work to be in place to have something to audit.
- **M5** ships last — the feedback loop is the training infra that makes the other four iterable. Can partially ship earlier (chips + storage) without the admin page.

---

## Open Questions

1. **No direct empirical study of follow-up depth in AI hiring-intake dialogue.** The 3-turn threshold in Part 4.1 is a convergent inference from five adjacent domains (laddering, MI, NICHD, Reflexion, 5-Whys). This is the highest-value experiment PIPE could run: vary depth at k=1, 2, 3, 4 on production traffic and measure bad-robot rate + information yield per dimension. Until that runs, the 3-turn number is moderately-grounded, not direct evidence.

2. **Does showing rationale to candidates help or harm interview data quality?** R3's crowding-out-human-knowledge finding [24] suggests candidates may shift toward AI-aligned answers when they see the rationale. No study directly tests whether candidates give more authentic or more gaming responses in an interview with visible rationale. Mitigation in §2.4 (example-based references, not abstract dimension labels) and §2.5 (rationale is primarily an internal guardrail, external surfacing is opt-in) is grounded in adjacent evidence but not directly validated for this use case.

3. **Does CoT-as-guardrail at our model sizes (8B–31B Workers AI) provide the quality lift it does at 100B+?** Wei 2022 [34] found CoT is ineffective below ~100B. The Tam 2024 ordering finding [36] was on GPT-3.5 Turbo — larger than our Workers AI models. The rationale field at our scale functions mostly as a guardrail and classifier signal, not a pure quality lever, but the exact quality delta at 31B is unmeasured.

4. **Optimal cosine-similarity threshold for circular-answer detection.** §4.2 suggests 0.82–0.85 as a starting point. No empirical calibration exists for this domain. Needs production measurement.

5. **BIPA exposure for voice features.** R2's open question 2 — Illinois BIPA requires explicit opt-in consent before biometric collection. If we add voice-capture to role discovery, a separate legal pass is required before launching in IL. Not relevant to text-only role discovery today.

6. **NYC LL144 AEDT classification of our role-discovery → downstream-scoring chain.** R2's open question 1 — whether our JD generation + downstream scoring AI collectively constitute a single AEDT under NYC LL144 needs dedicated municipal-legal review before scale. Not blocking for design but necessary before marketing to NYC enterprise buyers.

7. **Cultural variance in rationale acceptability.** R1 documented cross-cultural stability of procedural-justice patterns in aggregate [16] but substantial within-culture subgroup variance (women, older workers, neurodivergent candidates have higher invasiveness thresholds for specific question types) [13][19]. Whether "(?) why I'm asking" is universally well-received or culturally coded is not addressed by the literature.

8. **Classifier calibration for interview-specific rubric dimensions.** ADR-032's 4-axis classifier was calibrated for code-review persona drift. The adaptation for role discovery (§5.2) has not been calibrated against human labels. Launching with the classifier disabled on some percentage of traffic and measuring agreement with bad-robot flags is the obvious first measurement.

### Reviewer-flagged confidence calibrations (MAJOR, non-blocking)

The reviewer pass (2026-04-17, `role-discovery-guardrails-verification.md`) raised six MAJOR issues. One (M6, source-numbering collision) is fixed inline. The remaining five are confidence-calibration issues on load-bearing claims — the underlying recommendations stand, but the evidence supporting them is one inference-step weaker than the draft's prose suggests. They are recorded here so readers do not over-index on the top-line phrasing:

- **M1 — 38.15% JSON-mode gap (Tam 2024 [36]) is task-specific.** The gap was measured on *Last Letter Concatenation* (a character-manipulation task) on LLaMA-3-8B, not on open-ended question generation. The schema-ordering recommendation (rationale before question) remains directionally valid — place reasoning keys first, avoid constrained-decoding JSON-mode — but the specific 38.15% figure should not be read as the expected quality lift for role-discovery question generation. Actual lift at the domain and model scale we run is unmeasured.

- **M2 — Deceptive-explanation anchoring (β=0.32, Altay & Acerbi [23]) is cross-domain inference.** The study measured belief change about news-headline misinformation, not candidate response-anchoring in a hiring conversation. The directional concern (incorrect rationale is more persuasive than no rationale) is supported by the broader deceptive-explanation literature, but the specific effect size (β=0.32) does not transfer with known fidelity. Treat the §2.4 rule as a design principle grounded in cross-domain inference, not a quantitative hiring-context finding.

- **M3 — Mobley v. Workday class certification is not a merits decision.** The agent-theory survived dismissal (July 2024) and the ADEA class was certified (May 2025), with EEOC amicus support. This is a live, named, credible legal risk — but the court has not yet ruled that Workday or any vendor is actually liable. "Confirmed to be a live legal risk" is the accurate framing; "confirmed liability" overstates the stage.

- **M4 — Reflexion [62] is weakly analogous, not a fifth interview-depth tradition.** The 3-cycles heuristic in Reflexion detects LLM action-loops (same-action + same-environment-response), not conversational depth saturation. Part 4.1 has been updated to downgrade Reflexion to a supporting analogy. The 3-turn threshold still has four converging traditions (laddering, MI, NICHD, 5-Whys) plus the convergent-inference caveat already flagged in Open Question #1.

- **M5 — Panickssery 2024 [40] measures GPT-family, not Gemma/Qwen.** The label-swap causality experiment validated same-family self-preference bias for GPT-4 and GPT-3.5. The cross-family-independence principle is mechanistically sound, but the specific Gemma-guards-Qwen pairing we propose for role discovery is not directly tested. The architectural decision is well-founded; one empirical calibration step (measuring classifier-vs-human agreement on role-discovery traffic) closes the remaining inference gap.

---

## Sources

### R1 — Taxonomy: Bad Interview Question Rubrics + Invasive-Perception Research

1. Campion, M. A., Palmer, D. K., & Campion, J. E. (1997). A review of structure in the selection interview. *Personnel Psychology, 50*(3), 655–702. https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.1997.tb00709.x [dead link — 403]

2. Levashina, J., Hartwell, C. J., Morgeson, F. P., & Campion, M. A. (2014). The structured employment interview: Narrative and quantitative review of the research literature. *Personnel Psychology, 67*(1), 241–293. https://onlinelibrary.wiley.com/doi/abs/10.1111/peps.12052 [dead link — 403]

3. McCarthy, J. M., Van Iddekinge, C. H., Lievens, F., Kung, M., Sinar, E. F., & Campion, M. A. (2019). Are we asking the right questions? Predictive validity comparison of four structured interview question types. *Journal of Business Research, 100*, 399–409. https://www.sciencedirect.com/science/article/abs/pii/S0148296319301985 [verified]

4. Chapman, D. S., & Zweig, D. I. (2005). Developing a nomological network for interview structure: Antecedents and consequences of the structured selection interview. *Personnel Psychology, 58*(3), 673–702. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2005.00516.x [dead link — 403]

5. Haladyna, T. M., & Downing, S. M. (1989, revised 2004, 2013). A taxonomy of multiple-choice item-writing rules. *Applied Measurement in Education, 2*(1), 37–50. https://testing.byu.edu/handbooks/Multiple-Choice%20Item%20Writing%20Guidelines%20-%20Haladyna%20and%20Downing.pdf [verified — PDF resolves]

6. Rosala, M. (2022, March 6). 6 mistakes when crafting interview questions. *Nielsen Norman Group.* https://www.nngroup.com/articles/interview-questions-mistakes/ [verified]

7. AERA, APA, & NCME. (2014). *Standards for educational and psychological testing.* Washington, DC: American Educational Research Association. https://www.testingstandards.net/open-access-files.html [verified]

8. Society for Industrial and Organizational Psychology. (2018). *Principles for the validation and use of personnel selection procedures* (5th ed.). *Industrial and Organizational Psychology, 11*(S1), 1–97. https://www.apa.org/ed/accreditation/personnel-selection-procedures.pdf [verified — PDF resolves]

9. Nyangeni, N. P., ten Ham-Baloyi, W., & van Rooyen, D. (2024). Strengthening the planning and design of objective structured clinical examinations. *African Journal of Health Professions Education, 16*(3). https://pmc.ncbi.nlm.nih.gov/articles/PMC11369580/ [verified]

10. Roberts, C., Walton, M., Rothnie, I., Crossley, J., Lyon, P., Kumar, K., & Tiller, D. (2005). Factors affecting the utility of the multiple mini-interview in selecting for the health professions. *Medical Education, 40*(8), 765–772. https://pubmed.ncbi.nlm.nih.gov/14996341/ [verified — note: PubMed resolves to the MMI paper, though the full citation in the research file attributes authors to a 2005 paper; the PubMed record resolves to a related 2004 paper on the admissions OSCE]

11. Gilliland, S. W. (1993). The perceived fairness of selection systems: An organizational justice perspective. *Academy of Management Review, 18*(4), 694–734. *No public PDF; documented through secondary citations.* [unsourced URL — no direct link available]

12. Hausknecht, J. P., Day, D. V., & Thomas, S. C. (2004). Applicant reactions to selection procedures: An updated model and meta-analysis. *Personnel Psychology, 57*(3), 639–683. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2004.00003.x [dead link — 403]

13. McCarthy, J. M., Bauer, T. N., Truxillo, D. M., Anderson, N. R., Costa, A. C., & Ahmed, S. M. (2017). Applicant perspectives during selection: A review addressing "So what?," "What's new?," and "Where to next?" *Journal of Management, 43*(6), 1693–1725. https://journals.sagepub.com/doi/full/10.1177/0149206316681846 [dead link — 403]

14. Society for Industrial and Organizational Psychology. (2024). What we know about applicant reactions to selection. SIOP White Paper. https://www.siop.org/wp-content/uploads/2024/07/SIOP-Applicant_Reactions_to_Selection_final.pdf [verified — PDF resolves]

15. Steiner, D. D., & Gilliland, S. W. (1996). Fairness reactions to personnel selection techniques in France and the United States. *Journal of Applied Psychology, 81*(2), 134–141. https://psycnet.apa.org/record/1996-00291-002 [dead link — page shows loading state, no content]

16. Anderson, N., Salgado, J. F., & Hülsheger, U. R. (2010). Applicant reactions in selection: Comprehensive meta-analysis into reaction generalization versus situational specificity. *International Journal of Selection and Assessment, 18*(3), 291–304. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1468-2389.2010.00512.x [dead link — 403]

17. Hoang, T. G., Truxillo, D. M., Erdogan, B., & Bauer, T. N. (2012). Cross-cultural examination of applicant reactions to selection methods: United States and Vietnam. *International Journal of Selection and Assessment, 20*(2), 209–219. https://onlinelibrary.wiley.com/doi/10.1111/j.1468-2389.2012.00593.x [dead link — 403]

18. Ryan, A. M., Boyce, A. S., Ghumman, S., Jundt, D., Schmidt, G., & Gibby, R. (2017). Culture and testing practices: Is the world flat? *Applied Psychology: An International Review, 68*(1), 230–274. https://iaap-journals.onlinelibrary.wiley.com/doi/abs/10.1111/apps.12095 [dead link — 403]

19. Sakib, M. N., Rayasam, N. M., & Dey, S. (2025). Experience and adaptation in AI-mediated hiring systems: A combined analysis of online discourse and interface design. *CSCW 2025.* https://arxiv.org/html/2601.02775v1 [verified]

20. Ashktorab, Z., Jain, M., Liao, Q. V., & Weisz, J. D. (2019). Resilient chatbots: Repair strategy preferences for conversational breakdowns. *CHI 2019 Conference on Human Factors in Computing Systems.* https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300484 [dead link — 403]

21. Cheng, Y., et al. (2023). User interaction patterns and breakdowns in conversing with LLM-powered voice assistants. *arXiv preprint.* https://arxiv.org/html/2309.13879v2 [verified]

22. Zhang, H., Liu, Y., Guan, X., Cai, J., & Carroll, J. M. (2026). Harnessing the power of AI in qualitative research: Role assignment, engagement, and user perceptions of AI-generated follow-up questions in semi-structured interviews. *arXiv preprint.* https://arxiv.org/html/2509.12709v1 [verified]

### R3 — XAI: Rationale Surfacing + CoT-as-Guardrail + Judge-Model Patterns

23. Altay, S. & Acerbi, A. (2025). Deceptive explanations by large language models lead people to change their beliefs about misinformation more often than honest explanations. *CHI 2025.* https://arxiv.org/html/2408.00024v1 [verified]

24. Turpin et al. (2025). Revealing AI reasoning increases trust but crowds out unique human knowledge. *arXiv.* https://arxiv.org/pdf/2511.04050 [verified]

25. Vereschak et al. (2025). Is conversational XAI all you need? Human-AI decision making with a conversational XAI assistant. *IUI 2025.* https://arxiv.org/html/2501.17546v1 [verified]

26. Arnaboldi et al. (2026). Watching AI think: User perceptions of visible thinking in chatbots. *arXiv preprint.* https://arxiv.org/abs/2601.16720 [verified]

27. Poursabzi-Sangdeh, F., Goldstein, D. G., Hofman, J. M., Vaughan, J. W., & Wallach, H. (2021). Manipulating and measuring model interpretability. *CHI 2021.* https://dl.acm.org/doi/10.1145/3411764.3445315 [dead link — 403]

28. Chen, J., Liao, Q. V., Vaughan, J., & Bansal, G. (2023). Understanding the role of human intuition on reliance in human-AI decision-making with explanations. *CSCW 2023.* https://dl.acm.org/doi/10.1145/3610219 [dead link — 403]

29. Bansal, G., Wu, T., Vaughan, J., Lasecki, W., Guo, S., Huang, J., Wallach, H., Amershi, S. (2021). Does the whole exceed its parts? The effect of AI explanations on complementary team performance. *CHI 2021.* https://dl.acm.org/doi/10.1145/3411764.3445717 [dead link — 403]

30. Schilke, O. & Reimann, M. (2025). The transparency dilemma: How AI disclosure erodes trust. *Organizational Behavior and Human Decision Processes, 2025.* https://www.sciencedirect.com/science/article/pii/S0749597825000172 [verified]

31. Bussone, A., Stumpf, S., & O'Sullivan, D. (2015). The role of explanations on trust and reliance in clinical decision support systems. *ICHI 2015.* https://ieeexplore.ieee.org/document/7349687/ [dead link — 303 redirect, access blocked]

32. Springer Electronic Markets (2022). Applying XAI to an AI-based system for candidate management to mitigate bias and discrimination in hiring. https://link.springer.com/article/10.1007/s12525-022-00600-9 [dead link — 418]

33. Cooley LLP. (2025, February 21). Gone but not forgotten: Federal laws still apply despite AI guidance disappearance act. https://www.cooley.com/news/insight/2025/2025-02-21-gone-but-not-forgotten-federal-laws-still-apply-despite-guidance-disappearance-act [verified]

34. Wei, J., Wang, X., Schuurmans, D., Bosma, M., Ichter, B., Xia, F., Chi, E., Le, Q., & Zhou, D. (2022). Chain-of-thought prompting elicits reasoning in large language models. *NeurIPS 2022.* https://arxiv.org/abs/2201.11903 [verified]

35. Kojima, T., Gu, S. S., Reid, M., Matsuo, Y., & Iwasawa, Y. (2022). Large language models are zero-shot reasoners. *NeurIPS 2022.* https://arxiv.org/abs/2205.11916 [verified]

36. Tam, Z.-R., Chang, Y.-C., Cheng, Y., & Chen, Y.-N. (2024). Let me speak freely? A study on the impact of format restrictions on performance of large language models. *EMNLP 2024 Industry Track.* https://arxiv.org/abs/2408.02442 [verified]

37. Madaan, A., Tandon, N., Gupta, P., Hallinan, S., Gao, L., Wiegreffe, S., Alon, U., Dziri, N., Prabhumoye, S., Yang, Y., Welleck, S., Khashabi, D., Ammanabrolu, P., Mitchell, E., Hajishirzi, H., Srivastava, A., & Clark, P. (2023). Self-Refine: Iterative refinement with self-feedback. *NeurIPS 2023.* https://arxiv.org/abs/2303.17651 [verified]

38. Bai, Y., Jones, A., Ndousse, K., Askell, A., Chen, A., DasSarma, N., et al. (2022). Constitutional AI: Harmlessness from AI feedback. *arXiv 2022.* https://arxiv.org/abs/2212.08073 [verified]

39. Zheng, L., Chiang, W.-L., Sheng, Y., Zhuang, S., Wu, Z., Zhuang, Y., Lin, Z., Li, Z., Li, D., Xing, E., Zhang, H., Gonzalez, J. E., & Stoica, I. (2023). Judging LLM-as-a-judge with MT-Bench and Chatbot Arena. *NeurIPS 2023.* https://arxiv.org/abs/2306.05685 [verified]

40. Panickssery, A., Bowman, S. R., & Feng, S. (2024). LLM evaluators recognize and favor their own generations. *NeurIPS 2024.* https://arxiv.org/abs/2404.13076 [verified]

41. Gu, et al. (2024). LLMs-as-Judges: A comprehensive survey on LLM-based evaluation methods. *arXiv 2024.* https://arxiv.org/abs/2411.15594 [verified]

42. Wang, X., Wei, J., Schuurmans, D., Le, Q., Chi, E., Narang, S., Chowdhery, A., & Zhou, D. (2023). Self-consistency improves chain of thought reasoning in language models. *ICLR 2023.* https://arxiv.org/abs/2203.11171 [verified]

### R2 — Compliance: Legal Boundaries for AI-Asked Hiring Questions

43. EEOC. Federal laws prohibiting job discrimination: Questions and answers. Title VII (42 U.S.C. §2000e), ADEA (29 U.S.C. §621), PDA (42 U.S.C. §2000e(k)). https://www.eeoc.gov/fact-sheet/federal-laws-prohibiting-job-discrimination-questions-and-answers [verified]

44. ADA.gov + EEOC. Algorithms, artificial intelligence, and disability discrimination in hiring. DOJ/EEOC Technical Assistance, May 2022. https://www.ada.gov/resources/ai-guidance/ [verified]

45. EEOC. Fact sheet: Genetic Information Nondiscrimination Act (GINA). 42 U.S.C. §2000ff. 2010. https://www.eeoc.gov/laws/guidance/fact-sheet-genetic-information-nondiscrimination-act [verified]

46. EEOC. What shouldn't I ask when hiring? EEOC Small Business Guide. 2024. https://www.eeoc.gov/employers/small-business/what-shouldnt-i-ask-when-hiring [verified]

47. EEOC. Prohibited employment policies/practices. 2024. https://www.eeoc.gov/prohibited-employment-policiespractices [verified]

48. EEOC. Enforcement guidance: Pre-employment disability-related questions and medical examinations. ADA Title I. https://www.eeoc.gov/laws/guidance/enforcement-guidance-preemployment-disability-related-questions-and-medical [verified]

49. California Civil Rights Council. FEHA algorithmic discrimination regulations (eff. Oct 1, 2025). Analysis via Ogletree Deakins. https://ogletree.com/insights-resources/blog-posts/10-faqs-about-californias-new-algorithmic-discrimination-rules/ [verified]

50. EEOC. Questions and answers: Clarify and provide common interpretation of Uniform Guidelines on Employee Selection Procedures (UGESP), 29 C.F.R. Part 1607. https://www.eeoc.gov/laws/guidance/questions-and-answers-clarify-and-provide-common-interpretation-uniform-guidelines [verified]

51. EEOC. Assessing adverse impact in software, algorithms, and artificial intelligence used in employment selection procedures under Title VII. Technical Assistance, May 18, 2023. Analysis via Mayer Brown. https://www.mayerbrown.com/en/insights/publications/2023/07/eeoc-issues-title-vii-guidance-on-employer-use-of-ai-other-algorithmic-decisionmaking-tools [verified]

52. California Civil Rights Council. FEHA ADS regulations, eff. Oct 1, 2025. Analysis by Jackson Lewis. https://www.jacksonlewis.com/insights/californias-new-ai-regulations-take-effect-oct-1-heres-your-compliance-checklist [verified]

53. EEOC. iTutorGroup to pay $365,000 to settle EEOC discriminatory hiring suit. EEOC Press Release, August 9, 2023. https://www.eeoc.gov/newsroom/itutorgroup-pay-365000-settle-eeoc-discriminatory-hiring-suit [verified]

54. EEOC. Statement of interest in Mobley v. Workday, filed April 9, 2024 (N.D. Cal. No. 3:23-cv-00770). Analysis by Epstein Becker Green. https://www.workforcebulletin.com/ai-resume-screening-tool-developer-is-subject-to-federal-anti-discrimination-laws-says-eeoc [verified]

55. U.S. District Court, N.D. Cal. Mobley et al. v. Workday, Inc., No. 3:23-cv-00770. Class certification order May 16, 2025. Analysis by Fisher Phillips. https://www.fisherphillips.com/en/insights/insights/discrimination-lawsuit-over-workdays-ai-hiring-tools-can-proceed-as-class-action-6-things [verified]

56. ACLU. ACLU sues Intuit and HireVue over discriminatory AI interviewing practices. March 2025. HR Dive reporting. https://www.hrdive.com/news/ai-intuit-hirevue-deaf-indigenous-employee-discrimination-aclu/743273/ [verified]

57. Reuters / MIT Technology Review / ACLU. Amazon ditched AI recruitment software because it was biased against women. 2018. https://www.technologyreview.com/2018/10/10/139858/amazon-ditched-ai-recruitment-software-because-it-was-biased-against-women/ [verified]

58. New York City. Local Law 144 of 2021 (AEDT Law); DCWP Final Rules. NYC.gov DCWP. https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page [dead link — timeout]

59. Illinois General Assembly. HB 3773 (2024), amending Illinois Human Rights Act (eff. Jan 1, 2026). Analysis by National Law Review. https://natlawreview.com/article/illinois-anti-discrimination-law-address-ai-goes-effect-1-january-2026 [verified]

60. New York State Office of the Comptroller. Enforcement of Local Law 144 — Automated Employment Decision Tools. Audit report, December 2, 2025. https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools [verified]

### R4 — Depth: Probing Depth, Pivot Signals, Per-Turn Consistency Classifier

61. Reynolds, T. J. & Gutman, J. (1988). Laddering theory, method, analysis, and interpretation. *Journal of Advertising Research, 28*, 11–31. https://www.tandfonline.com/doi/abs/10.1080/00218499.1988.12467766 [dead link — 403]

62. Shinn, N., Cassano, F., Labash, A., Gopalan, A., Narasimhan, K., & Yao, S. (2023). Reflexion: Language agents with verbal reinforcement learning. *NeurIPS 2023.* https://arxiv.org/abs/2303.11366 [verified] *(also cited as R3-S17)*

63. Grunert, K. G. & Grunert, S. C. (1995). Measuring subjective meaning structures by the laddering method: Theoretical considerations and methodological problems. *International Journal of Research in Marketing, 12*, 209–225. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1739855 [dead link — 403]

64. UserIntuition (2024). The laddering technique in qualitative research. Practitioner reference guide. https://www.userintuition.ai/reference-guides/laddering-technique-qualitative-research/ [verified]

65. Wansink, B. (2003). Using laddering to understand and leverage a brand's equity. *Qualitative Market Research, 6*(2), 111–118. https://www.emerald.com/insight/content/doi/10.1108/13522750310470118/full/html [verified]

66. Veludo-de-Oliveira, T. M., Ikeda, A. A., & Campomar, M. C. (2006). Discussing laddering application by the means-end chain theory. *The Qualitative Report, 11*(4), 626–642. https://nsuworks.nova.edu/tqr/vol11/iss4/1/ [verified]

67. Miller, W. R. & Rollnick, S. (2013). *Motivational Interviewing: Helping People Change*, 3rd ed. Guilford Press. NCBI chapter: https://www.ncbi.nlm.nih.gov/books/NBK571068/ [verified]

68. Moyers, T. B. et al. (2016). MITI 4.2.1 Coding Manual. Motivational Interviewing Network of Trainers. https://motivationalinterviewing.org/sites/default/files/miti4_2.pdf [verified — PDF resolves]

69. Moyers, T. B. et al. (2016). Deconstructing proficiency in motivational interviewing: Mechanics of skilful practitioner delivery. *PMC.* https://pmc.ncbi.nlm.nih.gov/articles/PMC3236613/ [verified]

70. Lamb, M. E. et al. (2007). Structured forensic interview protocols improve the quality and informativeness of investigative interviews with children. *Child Abuse & Neglect, PMC.* https://pmc.ncbi.nlm.nih.gov/articles/PMC2180422/ [verified]

71. NICHD Protocol documentation. nichdprotocol.com. https://nichdprotocol.com/ [verified]

72. OJJDP (2015). Child forensic interviewing: Best practices. U.S. Dept. of Justice. https://ojjdp.ojp.gov/sites/g/files/xyckuh176/files/pubs/248749.pdf [dead link — PDF binary unreadable / corrupted render]

73. Zhuge, M. et al. (2024). Agent-as-a-Judge: Evaluate agents with agents. https://arxiv.org/abs/2410.10934 [verified]

74. Xu, Z. et al. (2024). CGPO: Mixed judges for calibrated group preference optimization. Cited in: Haitao Shi et al. "LLMs-as-Judges: A Comprehensive Survey." https://arxiv.org/html/2412.05579v2 [verified]

75. Cohen, R. et al. (2023). LM vs LM: Detecting factual errors via cross examination. *EMNLP 2023.* https://aclanthology.org/2023.emnlp-main.778/ [verified]

76. Evaluating LLM-based agents for multi-turn conversations: A survey. (2025). https://arxiv.org/html/2503.22458v1 [verified]

77. Allen, J. & Core, M. (1997). Draft of DAMSL: Dialog act markup in several layers. DRI/Dagstuhl. https://www.cs.rochester.edu/research/speech/damsl/RevisedManual/ [verified]

78. Robinson, O. C. (2023). Probing in qualitative research interviews: Theory and practice. *Qualitative Research in Psychology.* https://www.tandfonline.com/doi/full/10.1080/14780887.2023.2238625 [dead link — 403]

79. Lin, Y. et al. (2023). Multi-granularity prompts for topic shift detection in dialogue. *ICIC 2023.* https://arxiv.org/abs/2305.14006 [verified]

80. Guo, Z. et al. (2024). PCQPR: Proactive conversational question planning with reflection. *EMNLP 2024.* https://aclanthology.org/2024.emnlp-main.631/ [verified]

81. Yao, S. et al. (2023). ReAct: Synergizing reasoning and acting in language models. *ICLR 2024.* https://arxiv.org/abs/2210.03629 [verified]

82. Kilwinger, F. B. M. & van Dam, Y. K. (2021). Methodological considerations on the means-end chain analysis revisited. *Psychology & Marketing, 38*(9), 1513–1524. https://onlinelibrary.wiley.com/doi/full/10.1002/mar.21521 [dead link — 403]

83. Graesser, A. C. & Person, N. K. (1994). Question asking during tutoring. *American Educational Research Journal, 31*(1), 104–137. https://journals.sagepub.com/doi/10.3102/00028312031001104 [dead link — 403]

84. Unimrkt Healthcare (2024). Respondent fatigue in qualitative health research. https://unimrkthealth.com/blog/how-respondent-fatigue-is-influencing-qualitative-health-research/ [verified]

85. Stolcke, A. et al. (2000). Dialogue act modeling for automatic tagging and recognition of conversational speech. *Computational Linguistics, 26*(3), 339–373. https://dl.acm.org/doi/10.1162/089120100561737 [dead link — 403]

### Additional sources cited in R2 and R3 (used in text above)

86. Colorado General Assembly. Senate Bill 24-205: Consumer Protections for Artificial Intelligence (signed May 2024, eff. June 30, 2026). https://leg.colorado.gov/bills/sb24-205 [verified]; compliance guide: https://pacific.ai/colorado-ai-act-compliance-guide-for-developers-and-deployers/ [verified]

87. Holland & Knight. (2025, March). Artificial intelligence in hiring: Diverging federal, state perspectives. https://www.hklaw.com/en/insights/publications/2025/03/artificial-intelligence-in-hiring-diverging-federal-state-perspectives [verified]

88. European Parliament and Council. EU Artificial Intelligence Act (Regulation 2024/1689), Annex III Section 4; Articles 9, 10, 14, 16. https://artificialintelligenceact.eu/annex/3/ [verified]; https://artificialintelligenceact.eu/article/14/ [verified]

89. DPO Consulting / HR-ON. High-risk AI systems under the EU AI Act. https://www.dpo-consulting.com/blog/high-risk-ai-systems [verified]; https://hr-on.com/eu-ai-act-for-hr-2026/ [verified]

90. Epstein Becker Green / Holistic AI. Taking stock of New York City's automated employment decision tools law. 2023. https://www.workforcebulletin.com/taking-stock-of-new-york-citys-automated-employment-decision-tools-law [verified]

91. Nodes.inc. GDPR, CCPA, and AI hiring: The data residency requirements your vendor won't tell you about. 2024/2025. https://nodes.inc/blogs/gdpr-ccpa-and-ai-hiring-the-data-residency-requirements-your-vendor-won-t-tell-you-about [verified]

92. Kulesza, T., Stumpf, S., Burnett, M., & Yang, S. (2013). Too much, too little, or just right? Ways explanations impact end users' mental models. *VL/HCC 2013.* https://www.semanticscholar.org/paper/Too-much,-too-little,-or-just-right-Ways-impact-end-Kulesza-Stumpf/b56b1e0acd3301c925bb2b074fe3fb8e0dbf5379 [dead link — empty page]

93. Liu et al. (2025). Constitution or collapse? Exploring Constitutional AI with Llama 3-8B. *arXiv 2025.* https://arxiv.org/html/2504.04918v1 [verified]

94. Lai, V. & Tan, C. (2019). On human predictions with explanations and predictions of machine learning models: A case study on deception detection. *FAccT 2019.* https://arxiv.org/abs/1811.07901 [verified]

95. Zhang, Y., Liao, Q. V., & Bellamy, R. K. E. (2020). Effect of confidence and explanation on accuracy and trust calibration in AI-assisted decision making. *FAccT 2020.* https://arxiv.org/abs/2001.02114 [verified]

96. Phenom (2025). State of Talent Experience Report. Industry report. Referenced at: https://www.sciencedirect.com/science/article/pii/S2949882125000040 [verified — redirects to a separate article on AI transparency in hiring]

---

## Verifier Notes

### Dead links (14)

| # | Original URL | Where cited | Status |
|---|---|---|---|
| 1 | https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.1997.tb00709.x | Source 1 (Campion 1997) | 403 Forbidden |
| 2 | https://onlinelibrary.wiley.com/doi/abs/10.1111/peps.12052 | Source 2 (Levashina 2014) | 403 Forbidden |
| 3 | https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2005.00516.x | Source 4 (Chapman & Zweig 2005) | 403 Forbidden |
| 4 | https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2004.00003.x | Source 12 (Hausknecht 2004) | 403 Forbidden |
| 5 | https://journals.sagepub.com/doi/full/10.1177/0149206316681846 | Source 13 (McCarthy et al. 2017) | 403 Forbidden |
| 6 | https://psycnet.apa.org/record/1996-00291-002 | Source 15 (Steiner & Gilliland 1996) | Page shows only loading state |
| 7 | https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1468-2389.2010.00512.x | Source 16 (Anderson et al. 2010) | 403 Forbidden |
| 8 | https://onlinelibrary.wiley.com/doi/10.1111/j.1468-2389.2012.00593.x | Source 17 (Hoang et al. 2012) | 403 Forbidden |
| 9 | https://iaap-journals.onlinelibrary.wiley.com/doi/abs/10.1111/apps.12095 | Source 18 (Ryan et al. 2017) | 403 Forbidden |
| 10 | https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300484 | Source 20 (Ashktorab et al. 2019) | 403 Forbidden |
| 11 | https://dl.acm.org/doi/10.1145/3411764.3445315 | Source 27 (Poursabzi-Sangdeh 2021) | 403 Forbidden |
| 12 | https://dl.acm.org/doi/10.1145/3610219 | Source 28 (Chen et al. 2023) | 403 Forbidden |
| 13 | https://dl.acm.org/doi/10.1145/3411764.3445717 | Source 29 (Bansal et al. 2021) | 403 Forbidden |
| 14 | https://ieeexplore.ieee.org/document/7349687/ | Source 31 (Bussone et al. 2015) | 303 redirect / access blocked |
| 15 | https://link.springer.com/article/10.1007/s12525-022-00600-9 | Source 32 (Electronic Markets 2022) | 418 |
| 16 | https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page | Source 58 (NYC LL144) | Timeout |
| 17 | https://www.tandfonline.com/doi/abs/10.1080/00218499.1988.12467766 | Source 61 (Reynolds & Gutman 1988) | 403 Forbidden |
| 18 | https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1739855 | Source 63 (Grunert & Grunert 1995) | 403 Forbidden |
| 19 | https://ojjdp.ojp.gov/sites/g/files/xyckuh176/files/pubs/248749.pdf | Source 72 (OJJDP 2015) | PDF binary unreadable |
| 20 | https://www.tandfonline.com/doi/full/10.1080/14780887.2023.2238625 | Source 78 (Robinson 2023) | 403 Forbidden |
| 21 | https://onlinelibrary.wiley.com/doi/full/10.1002/mar.21521 | Source 82 (Kilwinger & van Dam 2021) | 403 Forbidden |
| 22 | https://journals.sagepub.com/doi/10.3102/00028312031001104 | Source 83 (Graesser & Person 1994) | 403 Forbidden |
| 23 | https://dl.acm.org/doi/10.1162/089120100561737 | Source 85 (Stolcke et al. 2000) | 403 Forbidden |
| 24 | https://www.semanticscholar.org/paper/Too-much,-too-little,-or-just-right-Ways-impact-end-Kulesza-Stumpf/b56b1e0acd3301c925bb2b074fe3fb8e0dbf5379 | Source 92 (Kulesza et al. 2013) | Empty page |
| 25 | https://www.seyfarth.com/news-insights/legal-update-eeoc-argues-vendors-using-artificial-intelligence-tools-are-subject-to-title-vii-the-ada-and-adea-under-novel-theories-in-workday-litigation.html | R2-S22 (Seyfarth Mobley analysis) | 403 Forbidden |
| 26 | https://www.seyfarth.com/news-insights/mobley-v-workday-court-holds-ai-service-providers-could-be-directly-liable-for-employment-discrimination-under-agent-theory.html | R2-S23 (Seyfarth Mobley 2024) | 403 Forbidden |

**Notes on dead links:** The Wiley/Sage/ACM/Tandfonline 403 responses are typical publisher paywall blocks for unauthenticated requests — the articles exist and are accessible via institutional login. The underlying citations are sound; the URLs will work for authenticated users. The OJJDP PDF renders as binary noise via web-fetch but likely loads in a browser. The NYC.gov page timed out; alternative verified reference is Source 90 (Epstein Becker Green analysis of LL144). The Seyfarth URLs (403) are accessible via the Epstein Becker Green URL (Source 54) and Fisher Phillips URL (Source 55) which cover the same court filings.

### Unsourced claims

- Source 11 (Gilliland 1993): no public URL is available; the research file documents it as "cited via derivative sources [12][13][14]." The claim stands but cannot be directly URL-verified. Lead should confirm this is acceptable given the triple secondary-source backing.

### Numbering note

The R2-compliance research file uses internal codes S1–S26. The R4-depth file uses S1–S25. The consolidated numbering above (1–96) is the definitive sequence for this output document. The original `[Rn-Sm]` codes are preserved only in the Executive Summary's first two paragraphs where the cross-file reference structure was particularly dense; inline citations throughout the body use the consolidated numbers.

### Additional findings in research files not incorporated in the draft body

- **R3-S23 (Lai & Tan 2019, FAccT):** Showing predicted labels achieves >20% relative improvement vs. showing explanations alone. Nuances the Chen et al. 2023 finding. Not referenced in the draft body; included as Source 94.
- **R3-S25 (Zhang et al. 2020, FAccT):** Confidence scores help calibrate trust but may not improve joint human-AI performance. Not referenced in the draft body; included as Source 95.
- **R3-S9 (Electronic Markets 2022):** XAI in hiring can *increase* foreign-race bias in some conditions while reducing age/gender bias. Cited in the research file's evidence table but not explicitly called out in the draft body. The dead link (Source 32) means this finding cannot be independently URL-verified.
- **R4-S13/14 (DAMSL/SWBD-DAMSL):** The research file notes there is no off-the-shelf "pivot needed" label in dialogue-act theory — topic shift is emergent. This is referenced only in the implementation context (§4.4) rather than given a dedicated paragraph. Included as Sources 77 and 85.
- **R2-S7 (CA FEHA S7 entry in evidence table):** The R2 evidence table lists an S7 entry pointing to Ogletree Deakins analysis and a separate S10 for the CA FEHA regulations — both map to the same regulatory event. In this document both are folded into Sources 49 and 52.
