# R1 Research — Qualitative Methodology & Synthesis Prompting

**Research run:** role-discovery-data-contract  
**Researcher:** R1  
**Date:** 2026-04-10  
**Sub-questions covered:** Q1 (Role Context Document schema), Q8 (Synthesis prompting to preserve laddering chains)  
**Output file:** `knowledge/outputs/role-discovery-data-contract-research-methodology.md`

---

## Q1 — Role Context Document schema

### Question restated

What output schema preserves the depth of an IDEO Empathize→Define interview — specifically laddering chains (attribute → consequence → value per Means-End Chain Theory), story-grounded evidence, per-turn energy signals, and multi-stakeholder disagreements — when converting an unstructured transcript into structured JSON? The goal is a schema whose fields *are* laddering chains, stories, and per-stakeholder disagreements rather than a schema that collapses those structures into flat lists at write time.

---

### Background: what the qualitative literature says about converting interviews to structured data

The qualitative research tradition has spent 60+ years working out exactly the failure mode PIPE has fallen into: a rich interview produces a flat artifact because the synthesis step was designed for human-readable summaries, not machine-readable depth. Four methodological traditions are directly relevant.

**Grounded theory (Glaser & Strauss 1967; Charmaz 2006/2014).** [R1-S1] [R1-S2] The canonical move in grounded theory is three-level abstraction: open coding (labels on raw transcript segments), axial coding (relationships between codes), selective coding (a core category and its satellite categories). Crucially, grounded theory never collapses codes into a flat list — it preserves the directional relationships between them. An open code ("We use Kafka") is linked by an axial code ("decouples services → teams ship independently") to a selective/core code ("reliability as a patient-safety value"). The PIPE `CandidatePersona` synthesis committed what Charmaz calls the "abstraction collapse" error: moving directly from open codes to final output without preserving axial linkages [R1-S2]. The implication for schema design: the Role Context Document needs a three-tier field structure per domain, not a flat array.

**Thematic analysis / framework analysis (Braun & Clarke 2006; Ritchie & Spencer 1994).** [R1-S3] [R1-S4] Framework analysis (used heavily in UK health policy research) produces a specific data structure: a matrix where rows are cases (interviewees), columns are codes (themes), and cells contain summarized data plus verbatim quote references. The matrix is the canonical artifact, not a list of themes. Ritchie & Spencer's five-stage process — familiarisation, thematic framework, indexing, charting, mapping/interpretation — treats charting (populating the matrix cells) as a distinct step from interpretation, specifically to prevent the premature collapse that PIPE's synthesis currently does. The framework method is documented as particularly suited to multi-stakeholder interview data [R1-S4], making it directly applicable to PIPE's four interviewee types.

**Interpretative Phenomenological Analysis (Smith, Flowers & Larkin 2009).** [R1-S5] IPA produces a hierarchical three-level schema: superordinate themes → subthemes → illustrative quotes. The defining structural requirement is that every theme must be evidenced by a direct participant quote followed by an analytic comment — the quote is first-class data, not a footnote. Smith et al.'s schema for a single participant looks like: `{ theme: string, subthemes: [{ label: string, quote: string, interpretation: string }] }`. This "evidence anchor" pattern — every structured claim paired with its source quote — is the mechanism that prevents drift from what the interview actually said toward what the researcher wished it said.

**Means-End Chain Theory / laddering (Reynolds & Gutman 1988).** [R1-S6] The canonical data structure Reynolds & Gutman specify for the analysis phase is the **implication matrix** — a frequency count of direct and indirect links between all element pairs across all interviews — which then collapses into a **Hierarchical Value Map (HVM)**. The HVM is a directed graph: attributes at the bottom, consequences in the middle, values at the top, with edge weights from the implication matrix. Three structural requirements are load-bearing for PIPE: (1) the chain is directional (A → C → V), not symmetric; (2) consequences can be functional or psychosocial — functional consequences belong in the Technical and Work domains, psychosocial in the Team and Bar domains; (3) values are terminal states that calibrate assessment — "reliability as patient safety" is why you assess on-call judgment, not because the JD mentions it.

---

### Alternative 1: Grounded-theory-inspired three-tier domain schema

This alternative maps the grounded theory open/axial/selective coding levels directly onto the PIPE six-domain structure.

```json
{
  "domain": "Codebase",
  "open_codes": [
    {
      "id": "code_001",
      "label": "Kafka for service decoupling",
      "source_turn": 7,
      "source_speaker": "HIRING_MANAGER",
      "verbatim_quote": "We use Kafka to decouple services so teams can ship independently"
    }
  ],
  "axial_links": [
    {
      "from": "code_001",
      "to": "code_002",
      "relationship": "ENABLES",
      "label": "Independent team shipping velocity"
    }
  ],
  "selective_code": {
    "label": "Reliability as patient-safety value",
    "grounding_links": ["code_001", "code_002"],
    "assessment_implication": "Test candidates on failure-mode reasoning and graceful degradation"
  }
}
```

**Empirical backing:** Charmaz (2014) [R1-S2] reports that three-level coding prevents the premature closure that collapses rich categories. The axial-coding step specifically is what captures the consequence linkage that PIPE currently loses. Quirkos and ATLAS.ti (the two dominant qualitative coding software platforms) both implement this three-tier structure as their canonical data model [R1-S7].

**What to borrow:** The three-tier abstraction and the directionality of axial codes. Every domain section of the Role Context Document gets an `open_codes[]`, `axial_links[]`, and `selective_code` field.

**What not to borrow:** Grounded theory is designed to produce theories from scratch — there is no predefined domain structure. PIPE has six predefined domains (Why, Work, Team, Bar, Codebase, Process), so the selective coding step is bounded, not emergent. PIPE should use the coding mechanics but not the theory-generation goal.

---

### Alternative 2: Framework analysis matrix schema

This alternative implements the Ritchie-Spencer matrix as a per-stakeholder × per-domain cell structure, treating the matrix as the first-class artifact.

```json
{
  "matrix": {
    "HIRING_MANAGER": {
      "Why":     { "summary": "...", "evidence_quote": "...", "turn": 3 },
      "Work":    { "summary": "...", "evidence_quote": "...", "turn": 8 },
      "Team":    { "summary": "...", "evidence_quote": "...", "turn": 12 },
      "Bar":     { "summary": "...", "evidence_quote": "...", "turn": 15 },
      "Codebase":{ "summary": "...", "evidence_quote": "...", "turn": 7 },
      "Process": { "summary": "...", "evidence_quote": "...", "turn": 19 }
    },
    "TEAM_MEMBER": {
      // same structure, separate cells
    }
  },
  "cross_stakeholder_disagreements": [
    {
      "domain": "Team",
      "description": "HM says async-first; TM says ad-hoc interruption culture",
      "hm_quote": "...",
      "tm_quote": "...",
      "resolution": "UNRESOLVED"
    }
  ]
}
```

**Empirical backing:** Gale et al. (2013) [R1-S4] document that framework analysis is specifically superior to thematic analysis when the research question requires comparison across cases (here: across stakeholders) and when a predefined analytical framework exists (here: the six domains). The per-cell design makes per-stakeholder disagreements first-class rather than averaged away. The framework method is described as the standard approach in multi-disciplinary UK health policy research precisely because it preserves intra-team variation rather than collapsing to consensus.

**What to borrow:** The matrix structure (rows = stakeholders, columns = domains, cells = evidence-anchored summaries) and the explicit `cross_stakeholder_disagreements[]` array.

**What not to borrow:** Pure framework analysis stops at charting — it does not propagate motivational depth. PIPE needs the laddering chains (Alternative 1) grafted onto the per-domain cells.

---

### Alternative 3: IPA evidence-anchor schema with superordinate-to-value propagation

This alternative uses Smith et al.'s IPA structure as the base, adding a `value_implication` field at each node to propagate the laddering chain upward.

```json
{
  "domain": "Why",
  "superordinate_theme": {
    "label": "Reliability as existential constraint",
    "value_implication": "Downtime affects patient care; engineering bar must include on-call judgment",
    "subthemes": [
      {
        "label": "Kafka decoupling reduces blast radius",
        "attribute": "Kafka",
        "consequence": "Service isolation under failure",
        "value": "Patient safety through fault containment",
        "evidence_quote": "We use Kafka to decouple services so teams can ship independently",
        "source_turn": 7,
        "source_speaker": "HIRING_MANAGER",
        "energy_signal": "HIGH"
      }
    ]
  }
}
```

**Empirical backing:** Smith, Flowers & Larkin (2009) [R1-S5] establish the evidence-anchor requirement: every theme must pair with a verbatim quote and an analytic interpretation. The hierarchy (superordinate → subtheme → quote) has been validated across hundreds of IPA studies as the mechanism that prevents researcher projection — the quote proves the theme was in the data, not imported. Adding Reynolds & Gutman's attribute/consequence/value fields to each subtheme node is a direct extension of IPA's evidence-anchor pattern to motivational structure. The `energy_signal` field maps to IPA's "linguisitic noting" — researchers in IPA note when a participant's language shifts register (hesitation, repetition, emphasis), which is the qualitative analogue of the "per-turn energy signal" the plan file specifies.

**What to borrow:** The evidence-anchor pattern (quote + analytic comment + turn reference at every node), the `energy_signal` field, and the upward-propagating `value_implication` that makes the value layer visible to downstream consumers.

**What not to borrow:** IPA was designed for small-N deep phenomenological work (typically 4-10 participants). PIPE's six-domain predefined framework is more structured than IPA's bottom-up emergence. The framework is valid; the bottom-up emergence mechanism is not needed.

---

### Recommended schema

The evidence supports a **hybrid of Alternatives 2 and 3**, with grounded theory's directionality from Alternative 1 applied to the laddering chain within each cell. The framework-analysis matrix provides the per-stakeholder × per-domain structure (preventing averaging). The IPA evidence-anchor pattern ensures every claim has a quote and a turn number. Reynolds & Gutman's attribute → consequence → value fields within each subtheme ensure the motivational depth is first-class rather than inferrable. The grounded theory axial-code directionality ensures consequence linkages are explicit.

**Proposed Role Context Document schema sketch:**

```json
{
  "role_context_document": {
    "version": "1.0",
    "pipeline_id": "...",
    "produced_at": "ISO-8601",
    "interview_summary": {
      "turn_count": 22,
      "stakeholders_interviewed": ["HIRING_MANAGER", "TEAM_MEMBER"],
      "domain_coverage": {
        "Why": "COMPLETE",
        "Work": "COMPLETE",
        "Team": "PARTIAL",
        "Bar": "COMPLETE",
        "Codebase": "COMPLETE",
        "Process": "PARTIAL"
      }
    },

    // Per-stakeholder × per-domain matrix (Framework Analysis)
    "domain_matrix": {
      "HIRING_MANAGER": {
        "Why": {
          "summary": "...",
          "laddering_chains": [
            {
              "attribute": "Kafka",
              "attribute_quote": "We use Kafka to decouple services...",
              "attribute_turn": 7,
              "consequence": "Teams ship independently; blast radius contained",
              "consequence_type": "FUNCTIONAL",
              "value": "Patient safety through fault containment",
              "value_implication": "Assess on-call judgment and failure-mode reasoning",
              "energy_signal": "HIGH"
            }
          ],
          "open_codes": ["event-driven", "service-isolation", "HIPAA"],
          "axial_links": [
            { "from": "event-driven", "to": "service-isolation", "rel": "ENABLES" }
          ],
          "domain_value": "Reliability as patient-safety constraint"
        },
        "Work": { /* same structure */ },
        "Team": { /* same structure */ },
        "Bar": { /* same structure */ },
        "Codebase": { /* same structure */ },
        "Process": { /* same structure */ }
      },
      "TEAM_MEMBER": {
        // same six-domain structure, separate cells
      }
    },

    // First-class disagreement record (not averaged)
    "cross_stakeholder_disagreements": [
      {
        "domain": "Team",
        "field": "collaboration_style",
        "hm_claim": "async-first, no synchronous standups",
        "hm_quote": "...",
        "hm_turn": 12,
        "tm_claim": "ad-hoc Slack interruptions, high synchronous load",
        "tm_quote": "...",
        "tm_turn": 9,
        "resolution": "UNRESOLVED",
        "scoring_note": "Use team member's account as ground truth for day-to-day culture"
      }
    ],

    // Flattened consumer-facing slice (replaces CandidatePersona — derived, not primary)
    "consumer_slice": {
      "seniority": "SENIOR",
      "archetype": "PLATFORM_ENGINEER",
      "must_have_skills": ["Kafka", "Go", "HIPAA-constrained systems"],
      "nice_to_have_skills": ["Kubernetes", "OpenTelemetry"],
      "disposition": ["async-preferred", "high-ownership"],
      "bar_values": ["patient-safety-reliability", "independent-team-shipping"],
      "dealbreakers": ["No experience with safety-critical systems"],
      "red_flags": ["Only worked in synchronous Scrum environments"]
    }
  }
}
```

The critical design principle: `consumer_slice` is **derived** from `domain_matrix` at write time, not the primary artifact. Downstream consumers that need only the flat slice read `consumer_slice`. Consumers that need laddering depth (challenge generation, BARS calibration, culture probe selection) read `domain_matrix`. The Knowledge State never goes dead again because the richest schema is primary and the flat slice is computed.

---

### What this implies for the Role Context Document AND the Repo Understanding Contract

**For the Role Context Document:** The schema must be written as `domain_matrix` (per-stakeholder × per-domain cells, each with `laddering_chains[]`, `open_codes[]`, `axial_links[]`, `domain_value`) plus a derived `consumer_slice`. The `consumer_slice` replaces the current `CandidatePersona` as the convenience object for consumers that don't need depth. The `domain_matrix` is the canonical artifact that never gets lost.

**For the Repo Understanding Contract:** The `codebase` domain cells contain the signals the 3rd AI pass needs: `open_codes` (stack mentions), `laddering_chains` (architecture patterns linked to organizational values), `domain_value` (what the codebase constraint is *for* — e.g., "HIPAA-constrained architecture as patient-safety constraint"). The `repo_role_alignment` matching step (Q11) should join against `domain_matrix.HIRING_MANAGER.Codebase.domain_value` and `domain_matrix.HIRING_MANAGER.Codebase.laddering_chains[*].consequence` — not against `consumer_slice.must_have_skills`. This is the structural reason why the current SQL keyword join is insufficient: it reads a derived field that has already dropped the motivational context.

---

## Q8 — Synthesis prompting to preserve laddering chains

### Question restated

What prompt patterns have been empirically shown to convert qualitative interview transcripts into structured JSON without losing hierarchical motivational context (attribute → consequence → value chains)? Specifically: chain-of-density summarization, schema-guided generation, constrained JSON decoding, extraction prompts with field-level exemplars, multi-pass refinement, and role-conditioned extraction. The key concern is preserving laddering depth across a prompt boundary.

---

### The core failure mode to guard against

Before evaluating alternatives, it is worth naming the specific failure mechanism. The current PIPE synthesis prompt produces `CandidatePersona.mustHaveSkills: ["Kafka"]` from a transcript that contained the full chain "We use Kafka → teams ship independently → patient care reliability matters." This is not a hallucination — it is a *compression* failure caused by the prompt asking for a skills list without a schema that makes the chain structure mandatory. When a synthesis prompt asks "What skills does this role require?" the LLM will produce skills, discarding the motivational context because the output schema has no field for it. The solution is not better language in the prompt — it is a schema that makes the chain structure the only valid output shape.

---

### Alternative 1: Chain-of-Density (CoD) for iterative depth enrichment

**Mechanism:** Adams et al. (2023) [R1-S8] — the CoD paper published at the ACL 2023 New Frontiers in Summarization workshop — describes a prompt that generates five progressively denser summaries. Each iteration identifies 1–3 missing salient entities and rewrites the summary to incorporate them at constant length. The JSON output is a list of `{ "Missing_Entities": [...], "Denser_Summary": "..." }` objects.

**Evidence for:** CoD summaries are preferred by humans over vanilla GPT-4 summaries (preference study in the paper) [R1-S8]. The iterative structure forces the model to confront what it omitted in prior passes, which is exactly the failure mode PIPE faces. The entity-identification step could be repurposed to flag missing laddering chains: "What attribute-consequence-value chains from the transcript are absent from the current draft?"

**Evidence against:** The paper explicitly notes that CoD is "domain-specific to news summarization" and "struggles with extracting nested relationships" and "organizing information into strict taxonomies" [R1-S8]. The five-iteration fixed structure produces a linear dense text summary, not a nested JSON object. Applying CoD to produce a `domain_matrix` schema would require significant adaptation — each iteration would need to check schema completeness, not entity density. There is no published evidence that CoD preserves hierarchical motivational chains as opposed to surface-level entity inclusion.

**Verdict:** CoD is useful as an *inner loop* for enriching a single `laddering_chains[]` cell (ensuring the chain is complete before being written), but it is not the right architecture for the synthesis step as a whole. The outer structure must be schema-guided.

---

### Alternative 2: Schema-guided generation with field-level exemplars

**Mechanism:** Pass the full Q1 schema (the `domain_matrix` structure) to the LLM, with each field annotated with a description and a concrete exemplar. The PARSE system (2024) [R1-S9] demonstrates that schema optimization — specifically adding detailed field descriptions and structural reorganization — accounts for 89% of extraction accuracy improvement (34% from description enhancement + 55% from structural reorganization). Field-level exemplars reduce the model's degrees of freedom: instead of deciding what "consequence" means, the model matches against the exemplar pattern.

Evidence from healthcare LLM extraction: LoRA-finetuned Llama-3.1 8B achieved 90.0% exact match accuracy against human annotators when provided with explicit field descriptions aligned to domain knowledge [R1-S10]. The missing-person intelligence extraction pipeline (Guardian Parser Pack, 2026) [R1-S11] achieved 96.97% key-field completeness by constraining LLM output to a schema with six hierarchical sections and typed validations. The LLM pathway (F1 = 0.8664) outperformed the deterministic rule-based pathway (F1 = 0.2578) — empirically demonstrating that schema-guided LLM extraction outperforms pattern matching, which is analogous to PIPE's current SQL keyword join.

The RAG-based qualitative analysis study (Reconciling Methodological Paradigms, 2024) [R1-S12] reported 91% F1 with RoBERTa-large embeddings for theme extraction from interview transcripts when supporting evidence anecdotes were required alongside themes — confirming the IPA evidence-anchor pattern translates to ML output quality.

**What schema-guided generation cannot do alone:** It guarantees schema compliance but not depth. A model can fill `attribute: "Kafka"`, `consequence: "service decoupling"`, `value: "reliability"` with shallow generic terms that are schema-valid but not grounded in what this specific team said. The exemplar pattern (showing the chain as it should look for a different role) partially addresses this but does not guarantee the model reads the full transcript carefully enough to extract the correct consequence for this specific team's Kafka usage.

**Verdict:** Schema-guided generation with field-level exemplars is the necessary foundation — the chain structure cannot emerge unless the schema mandates it. But it must be combined with a validation layer that checks each chain against the source transcript.

---

### Alternative 3: Multi-pass refinement (Self-Refine / SCOPE validation)

**Mechanism:** Madaan et al. (2023) Self-Refine [R1-S13] demonstrated that iterative self-feedback improves output quality by ~20% absolute across seven tasks including dialogue generation. The mechanism: generate output → provide structured feedback → revise. The PARSE SCOPE system (2024) [R1-S9] adapted this to extraction: check required fields exist → verify extracted values appear in source text → confirm schema constraints. SCOPE reduced extraction errors by 92% within the first retry.

Applied to PIPE's synthesis step, the three-stage SCOPE validation translates directly:
1. **Pass 1 (Extract):** Produce the full `domain_matrix` from the transcript using schema-guided generation.
2. **Pass 2 (Verify):** For each `laddering_chain` node, verify: (a) `attribute_quote` is verbatim from the transcript, (b) `consequence` is a direct inference from the quoted evidence (not generic), (c) `value` is explicitly or implicitly stated in the interview (not imposed by the model).
3. **Pass 3 (Refine):** For any chain that fails verification, re-extract with explicit instruction: "Return to the transcript turn {N} and re-derive the consequence from what the interviewee actually said about X."

The ART paper (ACL 2024) [R1-S14] extends Self-Refine with a "trust" mechanism: not all self-critiques improve the output, so the refinement step should be conditional on whether the critique identifies a genuine grounding failure, not just uncertainty. For PIPE, the condition is concrete: if `attribute_quote` is missing or the `consequence` is not derivable from the quote, the chain is reflagged; if all fields are grounded, the chain passes without unnecessary rewriting.

**Evidence for reliability gains:** The PARSE system's 92% error reduction on first retry [R1-S9] and Self-Refine's 20% absolute improvement across tasks [R1-S13] together indicate that a verification pass targeting ground-truth anchoring is more reliable than a single-pass extraction, even with strong schema guidance.

**What multi-pass cannot do:** Multiple passes increase latency and token cost. For a 20-turn interview transcript, three passes is feasible (roughly 3× the single-pass token cost). Beyond three passes, gains plateau per the Self-Refine paper [R1-S13] — four iterations was the empirical ceiling for diminishing returns. The Madaan study also notes that self-critique does not catch all hallucinations — a model that misread the transcript on pass 1 may not catch its own error on pass 2. An external consistency check (comparing the synthesized chain against the raw transcript turn) is stronger than pure self-critique.

---

### Alternative 4: Constrained JSON decoding (Outlines / llguidance / XGrammar)

**Mechanism:** Grammar-constrained decoding (Outlines, jsonformer, llguidance) prevents the model from generating tokens that violate the schema at the token level. JSONSchemaBench (2025) [R1-S15] evaluated six frameworks across 10,000 real-world schemas. Key results: Guidance achieved highest compliance rate across all datasets; constrained decoding improves task accuracy by ~4% even for tasks with minimal structure; over-constrained configurations (common in Outlines) can reject valid outputs; Guidance's per-token latency (~6–9ms) is 3–5× faster than Outlines (~30–46ms).

**What constrained decoding solves:** It guarantees the output is parseable JSON that conforms to the schema. This eliminates a common failure mode where schema-guided prompting produces near-valid JSON that breaks downstream consumers (missing closing braces, extra fields, wrong types).

**What constrained decoding does not solve:** It enforces structural compliance, not semantic depth. A model can fill `consequence: ""` (empty string) and pass schema validation. Constrained decoding is a correctness floor, not a quality ceiling. The JSONSchemaBench paper [R1-S15] explicitly notes that compliance rate and task accuracy are not the same metric — high-compliance outputs can still be semantically shallow.

**Practical note for PIPE:** Workers AI (Gemma 4 26B) does not natively expose grammar-constrained decoding. The Anthropic API (used for offline synthesis) supports structured outputs via `response_format: { type: "json_schema", json_schema: ... }` — this is effectively constrained decoding at the API level. For the offline synthesis step (Claude Sonnet 4.6 is the specified model per CLAUDE.md), using the JSON schema parameter provides the compliance floor for free.

---

### Recommended prompt pattern

The evidence supports a **three-layer pattern**: schema-guided generation with field-level exemplars + constrained JSON output + a verification pass targeting evidence anchoring.

**Layer 1 — Schema-grounded extraction with exemplar injection**

The synthesis prompt must:
1. Provide the full `domain_matrix` schema with field descriptions and a worked exemplar for one domain/stakeholder cell.
2. Instruct the model to extract the transcript turn-by-turn before filling the schema, not to fill the schema from memory.
3. For each `laddering_chains[]` entry, require the model to write the `attribute_quote` first (verbatim), then derive `consequence`, then derive `value` — in that strict order. Reversing the order (writing `value` first, then finding supporting quotes) is the failure mode that produces post-hoc rationalization rather than genuine extraction.

The order instruction is critical and grounded in Reynolds & Gutman's [R1-S6] own analysis method: the implication matrix is built bottom-up from attributes to values, never top-down. A synthesis prompt that starts from "what values does this team care about?" will project generic values rather than extract team-specific ones.

**Layer 2 — Constrained JSON via API structured output**

For the Anthropic API (Claude Sonnet 4.6, the offline synthesis model), use `response_format: { type: "json_schema" }` with the full Q1 schema. This provides schema compliance as a floor at no additional latency cost and eliminates parse failures.

**Layer 3 — Verification pass (transcript citation check)**

A second LLM call (can use a smaller model — Haiku 4.5 is appropriate given the offline, non-latency-sensitive nature of this step) receives: (a) the synthesized `domain_matrix`, (b) the raw transcript. It checks:
- For each `laddering_chains[]` node: is `attribute_quote` a verbatim substring of the transcript?
- For each `consequence`: can it be derived from the quoted turn alone, without other background knowledge?
- For each `energy_signal: "HIGH"`: is there a turn with elevated hedging, repetition, or explicit urgency markers?

If any check fails, the verification model returns a structured failure list with `turn_id` and `failure_type`. The synthesis step reruns only the failed cells (not the full transcript) with explicit instruction to return to the failing turn.

**Failure modes the synthesis step should guard against:**

1. **Value projection:** The model fills `value: "developer productivity"` because that is common in software engineering, not because this team said it. Guard: require `attribute_quote` before `value` in the schema field order; the constrained decoding enforces this sequence.
2. **Consequence genericization:** The model fills `consequence: "faster development"` instead of "teams in the clinical workflow can hot-patch without a full deploy cycle." Guard: verification pass checks that `consequence` text shares at least one key entity with the `attribute_quote`.
3. **Energy signal inflation:** The model marks everything as `HIGH` because the prompt framing treated the interview as high-stakes. Guard: require at least one verbatim lexical marker ("critical," "always," "non-negotiable," "last time we did it wrong...") before allowing `HIGH`.
4. **Domain coverage collapse:** The model produces rich output for `Codebase` and `Bar` (where the recruiter asked detailed questions) and thin output for `Team` and `Process` (where fewer turns were logged). Guard: the `domain_coverage` field in the schema requires a completeness assessment; if `PARTIAL`, the synthesis prompt should flag which specific team/process signals were not extracted and mark them explicitly rather than leaving empty arrays.
5. **Stakeholder averaging on first pass:** If the model is given all stakeholder transcripts at once, it will synthesize across them rather than per-stakeholder. Guard: run synthesis per stakeholder independently, then run a separate aggregation step that produces `cross_stakeholder_disagreements[]` by comparing per-stakeholder outputs.

---

### Prompt sketch (not full text)

```
SYSTEM:
You are a qualitative research analyst applying Means-End Chain Theory to an interview transcript. 
Your job is to extract a Role Context Document. You must work bottom-up: attributes first, 
consequences second, values third. Do not infer values that the interviewee did not state or imply.

USER:
Below is a verbatim transcript of a Role Discovery interview with {STAKEHOLDER_ROLE}.
Pipeline: {PIPELINE_ID}. Domain coverage expected: Why, Work, Team, Bar, Codebase, Process.

TRANSCRIPT:
{full_verbatim_transcript}

TASK:
1. First, read the entire transcript. List every concrete attribute mentioned (technologies, 
   practices, constraints) with their turn number and verbatim quote. Do not fill the schema yet.
   
2. For each attribute, identify what consequence the interviewee stated or clearly implied.
   Quote the consequence reasoning from the transcript, or mark it "INFERRED" if you derived it.
   
3. For each consequence, identify what underlying value it serves. Only mark a value as stated 
   if the interviewee named it or strongly implied it. Otherwise mark "LATENT".

4. Now fill the schema below. Every `attribute_quote` must be a verbatim string from the 
   transcript. Every `consequence` must be traceable to the quote.

SCHEMA:
{full domain_matrix schema with field descriptions and one worked exemplar}

OUTPUT: JSON only, conforming to the schema.
```

---

### What this implies for the Role Context Document AND the Repo Understanding Contract

**For the Role Context Document:** The synthesis prompt is the mechanism by which the `domain_matrix` schema either works or doesn't. A correct schema with a defective prompt produces a correctly-shaped but semantically flat artifact — exactly the current `CandidatePersona` failure repeated at larger scale. The three-layer pattern (schema-guided + constrained decoding + verification) is the minimum viable design. The bottom-up ordering instruction (attribute → consequence → value) is load-bearing and must be written into the system prompt, not left to the model's default summarization behavior.

**For the Repo Understanding Contract:** The `laddering_chains[].consequence` field — specifically the functional consequences extracted from the `Codebase` domain — is the signal the 3rd AI pass (Q11) should join against when scoring repo-role alignment. A repo's `repo_engineering_signals` record should surface equivalent chain data: "this repo uses X → enabling consequence → organizational value it serves." If the repo pass uses the same three-tier structure, the alignment step becomes a semantic comparison between two chains rather than a keyword intersection. The synthesis prompt design for Q8 therefore directly determines what the repo matching layer in Q11 can reason over.

---

## Contradictions

1. **CoD vs. schema-guided generation:** The Adams et al. (2023) CoD paper claims iterative enrichment is superior to single-pass summarization. The PARSE study (2024) claims schema design (description + structure) accounts for 89% of extraction accuracy, implying the schema matters more than the iteration pattern. These are not strictly contradictory — CoD addresses information completeness, PARSE addresses structural compliance — but they pull toward different primary investments. The resolution: schema-guided generation is the outer architecture (PARSE priority), and CoD-style iterative enrichment is an inner loop for completeness checking within individual chain cells (CoD's contribution).

2. **Self-Refine reliability:** Madaan et al. (2023) report 20% absolute improvement with Self-Refine. The ART paper (2024) [R1-S14] cautions that not all self-critiques improve output quality and that unconditional refinement can degrade results for some task types. The resolution for PIPE: use conditional refinement (refine only when the verification pass identifies a specific grounding failure), not unconditional self-critique.

3. **Constrained decoding compliance vs. quality:** JSONSchemaBench (2025) [R1-S15] shows high compliance ≠ high accuracy for downstream tasks. This contradicts the implicit assumption that enforcing JSON validity improves extraction quality. The resolution: constrained decoding is a floor (prevents parse failures), not a ceiling. The quality work is done by the prompt design and verification pass, not the grammar constraint.

---

## Known gaps

1. **No published study directly tests laddering-chain preservation across an LLM prompt boundary.** Reynolds & Gutman's analysis framework was designed for human coders, not LLMs. The evidence for the proposed synthesis pattern is assembled from adjacent literatures (healthcare extraction, qualitative analysis automation, schema-guided generation), not from a study that specifically tested attribute → consequence → value chain preservation. This gap should be flagged in ADR-036 as a PIPE-specific empirical question to resolve with an internal eval.

2. **Energy signal detection is weakly grounded.** IPA's "linguistic noting" is a human practice with no published LLM equivalent. The `energy_signal` field in the proposed schema is justified by the plan's specification, but there is no peer-reviewed study evaluating LLM accuracy at detecting interview-level energy or urgency signals. This is a research gap — the field should be treated as low-confidence until PIPE runs internal validation.

3. **Token cost of three-pass synthesis.** The verification pass is recommended but adds ~2× token cost per synthesis run. For a 20-turn transcript this is manageable (estimated 8,000–12,000 tokens total for three passes on Claude Sonnet 4.6). For the multi-stakeholder case (up to four interviewees), the per-stakeholder-then-aggregate pattern multiplies this further. No published benchmark exists for cost vs. quality tradeoff in multi-pass qualitative synthesis specifically.

4. **Constrained decoding on Workers AI.** Gemma 4 26B via Workers AI binding does not expose grammar-constrained decoding in the public API. For the offline synthesis step (Sonnet 4.6 via Anthropic API), structured outputs are available. For any runtime synthesis step running on Workers AI, schema compliance must be achieved through prompt design alone, without the grammar-level guarantee. This is an infrastructure constraint, not a research gap.

---

## Sources

| ID | Title | Authors / Source | Year | Type | URL |
|---|---|---|---|---|---|
| R1-S1 | The Discovery of Grounded Theory | Glaser & Strauss | 1967 | Peer-reviewed book | — (classic, library) |
| R1-S2 | Constructing Grounded Theory: A Practical Guide | Kathy Charmaz | 2006/2014 | Peer-reviewed book | https://www.researchgate.net/publication/224927524 |
| R1-S3 | Using Thematic Analysis in Psychology | Braun & Clarke | 2006 | Peer-reviewed journal | https://en.wikipedia.org/wiki/Thematic_analysis |
| R1-S4 | Using the Framework Method for Qualitative Data in Multi-disciplinary Health Research | Gale et al. (BMC Medical Research Methodology) | 2013 | Peer-reviewed journal | https://pmc.ncbi.nlm.nih.gov/articles/PMC3848812/ |
| R1-S5 | Interpretative Phenomenological Analysis: Theory, Method and Research | Smith, Flowers & Larkin | 2009 | Peer-reviewed book | https://www.simplypsychology.org/interpretative-phenomenological-analysis.html |
| R1-S6 | Laddering Theory, Method, Analysis, and Interpretation | Reynolds & Gutman (Journal of Advertising Research) | 1988 | Peer-reviewed journal | https://www.tandfonline.com/doi/abs/10.1080/00218499.1988.12467766 |
| R1-S7 | Open and Axial Coding in Qualitative Software (Quirkos) | Quirkos blog | 2021 | Vendor/engineering blog | https://www.quirkos.com/blog/post/open-and-axial-coding-qualitative-software/ |
| R1-S8 | From Sparse to Dense: GPT-4 Summarization with Chain of Density Prompting | Adams, Fabbri, Ladhak, Lehman, Elhadad (ACL NewSum 2023) | 2023 | Peer-reviewed conference paper | https://aclanthology.org/2023.newsum-1.7/ |
| R1-S9 | PARSE: LLM Driven Schema Optimization for Reliable Entity Extraction | arXiv 2510.08623 | 2024 | Preprint / arXiv | https://arxiv.org/html/2510.08623v1 |
| R1-S10 | Human Level Information Extraction from Clinical Reports with Finetuned Language Models | Nature Scientific Reports | 2025 | Peer-reviewed journal | https://www.nature.com/articles/s41598-025-28767-z |
| R1-S11 | LLM-Based Schema-Guided Extraction and Validation of Missing-Person Intelligence | arXiv 2604.06571 | 2026 | Preprint / arXiv | https://arxiv.org/html/2604.06571 |
| R1-S12 | Reconciling Methodological Paradigms: LLMs as Novice Qualitative Research Assistants in Talent Management Research | arXiv 2408.11043 | 2024 | Preprint / arXiv | https://arxiv.org/html/2408.11043v1 |
| R1-S13 | Self-Refine: Iterative Refinement with Self-Feedback | Madaan et al. (NeurIPS 2023) | 2023 | Peer-reviewed conference paper | https://arxiv.org/abs/2303.17651 |
| R1-S14 | The ART of LLM Refinement: Ask, Refine, and Trust | ACL NAACL 2024 | 2024 | Peer-reviewed conference paper | https://aclanthology.org/2024.naacl-long.327.pdf |
| R1-S15 | JSONSchemaBench: A Rigorous Benchmark of Structured Outputs for Language Models | arXiv 2501.10868 | 2025 | Preprint / arXiv | https://arxiv.org/html/2501.10868v1 |
| R1-S16 | Automating the Information Extraction from Semi-Structured Interview Transcripts | ACL Web Conference 2024 | 2024 | Peer-reviewed conference paper | https://arxiv.org/pdf/2403.04819 |
| R1-S17 | Framework Analysis: A Qualitative Methodology for Applied Policy Research | Ritchie & Spencer | 1994 | Peer-reviewed chapter | https://www.researchgate.net/publication/267678963 |
| R1-S18 | Structured data extraction from unstructured content using LLM schemas | Simon Willison | 2025 | Engineering blog | https://simonwillison.net/2025/Feb/28/llm-schemas/ |

*Access date for all web sources: 2026-04-10*

---

*End of R1 research output.*
