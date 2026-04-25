# ADR-041c: RCD Synthesis Wiring

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Hans (founder)
**Extends:** [ADR-036](ADR-036-role-discovery-data-contract.md), [ADR-041b](ADR-041b-rcd-primary-artifact.md)
**Author:** Claude Opus 4.7 with founder

---

## Context

ADR-036 defined the RCD schema and the three-layer synthesis pattern (schema-guided generation, constrained decoding, verification pass). ADR-041b elevated the RCD to primary artifact. What remains is the **wiring**: how the synthesis prompt is invoked, where it sits in the request lifecycle, how its output is persisted, and which downstream consumers read which RCD fields.

The existing synthesis path is monolithic. When the question budget is exhausted or the user clicks "Finish," the backend calls a single Mistral prompt with the full transcript and receives a flat `persona` + `jobDescription` JSON. The RCD synthesis replaces this monolith with a multi-step pipeline that emits a structured matrix, runs a verification pass, and derives the consumer slice.

This ADR specifies the wiring for that pipeline.

---

## Decision

### 1. Synthesis Pipeline Architecture

The synthesis flow has three sequential steps:

```
Transcript + Baseline
    │
    ▼
┌─────────────────────┐
│ Step 1: Primary     │  Gemma 4 26B (Workers AI)
│   Synthesis         │  Emits full RCD JSON
│                     │  forceJson = true
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Step 2: Verification│  Gemma 4 12B (Workers AI)
│   Pass              │  Checks quote verbatimness,
│                     │  value projection, energy markers
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Step 3: Derive      │  Deterministic, no LLM
│   Consumer Slice    │  Mechanical rules from domain_matrix
└─────────────────────┘
```

All three steps run in the same Worker request. Total latency budget: < 8 seconds end-to-end. If Step 2 fails or times out, the pipeline falls back to the Step 1 output with `validation_metadata.verification_pass_model` set to `"FAILED"`.

### 2. Prompt Versioning

The RCD synthesis system prompt lives in `workers/api/src/lib/roleAgentPrompts.ts` as `RCD_SYNTHESIS_SYSTEM_PROMPT`. It carries a version constant:

```typescript
export const RCD_SYNTHESIS_PROMPT_VERSION = 'rcd-synth-2026-04-10';
```

This version is stamped into every emitted RCD at `validation_metadata.synthesis_prompt_version`. Downstream caches key on `(role_context_id, schema_version, synthesis_prompt_version)`. Changing the prompt invalidates cached derivations automatically.

### 3. Input Packaging

The synthesis user message (`buildRcdSynthesisUserMessage`) packages:
- `role_context_id`, `pipeline_id`, `created_at`
- Baseline form data (title, department, company, URL)
- Stakeholder transcripts grouped by `stakeholder_type`, each with exchanges and end-of-interview knowledge state

For single-stakeholder interviews (ADR-041f), the transcript array has one entry. For multi-stakeholder interviews (ADR-028), transcripts are ordered by authority priority: HIRING_MANAGER first, TEAM_MEMBER second, INTERNAL_RECRUITER third, EXTERNAL_RECRUITER last.

### 4. Constrained Decoding

Step 1 uses `response_format: { type: "json_object" }` (or equivalent structured-output mode) with a JSON Schema describing the full `RoleContextDocument` shape. The schema is inlined in the prompt and supplied as the constrained-decoding contract. This prevents field hallucination and guarantees that all six domain keys are present for every stakeholder.

### 5. Verification Pass Rules (Step 2)

The verification prompt receives:
- The original transcripts
- The RCD emitted by Step 1

It checks five named failure modes (ADR-036 §1.2):

1. **Quote verbatimness** — every `attribute_quote` appears character-for-character in the referenced exchange.
2. **Value projection** — no `value` field is a generic platitude ("collaboration", "growth") unless the transcript contains that exact word in an emphasis context.
3. **Consequence genericization** — consequences are behavior-level, not compressed to "better code quality."
4. **Energy-marker validity** — `energy_signal: "high"` requires a verbatim intensity marker in the quote.
5. **Cell completeness** — every stakeholder has all six domain cells, even if `coverage: "not_probed"`.

The verifier outputs a JSON array of `finding` objects:
```json
{
  "findings": [
    { "severity": "major", "cell": "HIRING_MANAGER.work", "issue": "quote_fabrication", "quote": "...", "fix": "remove_chain" }
  ],
  "overall": "pass_with_notes"
}
```

Severity levels:
- `fatal` — Step 1 output is rejected; a partial re-synthesis is triggered for the affected cell.
- `major` — Finding is logged; the cell is patched by the verifier's suggested fix.
- `minor` — Finding is logged; no patch applied.

### 6. Persistence

After Step 3, the final RCD is written to `role_contexts.knowledge_state` as a JSON TEXT blob. The `status` column transitions from `INTERVIEWING` to `COMPLETE`. The `consumer_slice` is not stored separately; it is computed on read from the RCD until the migration window closes.

### 7. Downstream Wiring

| Downstream Consumer | RCD Field(s) Read | Read Trigger |
|---|---|---|
| Pipeline wizard | `consumer_slice` + `technical_context` | On `RoleContextReview` mount |
| Challenge authoring | `technical_context.stack`, `technical_context.codebase_expectations`, `domain_matrix.HIRING_MANAGER.work` | On pipeline stage creation |
| Culture interview | `team_culture_profile`, `domain_matrix.*.team` | On assessment start |
| Culture scorer | `team_culture_profile`, `bars_overrides` | On submission complete |
| Repo discovery | `technical_context.stack`, `technical_context.constructs` | On candidate resume upload |
| Repo matching (triangulation) | `technical_context`, `dispositional_weights` | On `candidate_repo_match` generation |
| JD renderer | `consumer_slice` + `job_description_md` | On "Copy JD" button click |

---

## Consequences

### Positive

- **Verifiable quality.** Every RCD carries an audit trail of what the verifier checked and what it found.
- **Prompt drift detection.** Version-stamped outputs make it trivial to correlate synthesis quality changes with prompt changes.
- **Schema enforcement at the token level.** Constrained decoding eliminates an entire class of parse failures.
- **Incremental extensibility.** New downstream consumers add a row to the wiring table without changing the synthesis prompt.

### Negative / Risks

- **Latency.** Two sequential LLM calls (Step 1 + Step 2) add 3–6 seconds to the "Finish" button response. Mitigation: Step 2 can be deferred to a background Durable Object task if latency is unacceptable, at the cost of delaying verifier findings.
- **Cost.** Two Gemma 4 calls per synthesis ≈ $0.04 per interview. At 1,000 interviews/month this is $40 — acceptable, but must be monitored.
- **Verifier false positives.** The 12B verifier may flag legitimate creative paraphrase as "quote fabrication." Mitigation: the `fix` field is advisory; the pipeline applies only `fatal` and `major` patches automatically. `minor` findings are logged for human review.

---

## Alternatives Considered

- **Single LLM call (no verification pass)** — Rejected: quote fabrication and value projection are the top two failure modes in the research brief. A second, smaller model checking the first model's work catches ~40% of errors at 50% of the primary call's cost.
- **Client-side synthesis** — Rejected: exposes the system prompt, allows prompt injection, and makes verifier integration impossible in the browser.
- **Store RCD as normalized D1 tables** — Rejected: the matrix is sparse and deeply nested. Normalizing it would require ~8 tables and complex JOINs for every read. JSON in TEXT is the pragmatic D1 pattern.

---

## Open Questions

1. **Verifier model sizing:** Is Gemma 4 12B sufficient for quote-level string matching, or should the verifier be a rule-based script (cheaper, deterministic) with LLM fallback for value-projection detection?
2. **Background vs. synchronous verifier:** If recruiter volume spikes, does the verifier move to a Durable Object queue? What is the SLA for "COMPLETE" status vs. "VERIFIED" status?
3. **Re-synthesis trigger:** If the verifier finds a `fatal` error, should the pipeline retry Step 1 automatically (with the verifier feedback injected) or surface the error to the recruiter for manual re-interview?
