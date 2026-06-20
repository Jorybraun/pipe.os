# ADR-041e: Incremental RCD Re-synthesis

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Hans (founder)
**Extends:** [ADR-036](ADR-036-role-discovery-data-contract.md), [ADR-041c](ADR-041c-rcd-synthesis-wiring.md), [ADR-041d](ADR-041d-calibration-review-loop.md)
**Author:** Claude Opus 4.7 with founder

---

## Context

When a recruiter flags an RCD attribute during the calibration review loop (ADR-041d), the system receives a clarifying answer and must update the RCD. The naive approach — re-running the full three-layer synthesis pipeline (ADR-041c) with the new answer appended — is correct but expensive. It discards all verified cells, re-processes transcripts that have not changed, and burns two LLM calls for a single-cell correction.

The RCD is a matrix of up to 24 cells (4 stakeholders × 6 domains). In practice, a recruiter flags one chain in one cell. Re-synthesizing the entire matrix is wasteful and introduces regression risk: cells that passed verification on the first pass may be perturbed by the re-run.

This ADR specifies **scoped cell re-synthesis** — updating only the affected domain cell while preserving all others.

---

## Decision

### 1. Re-synthesis Scope

When `calibrateRcd` receives a gap-fill answer, it updates **exactly one cell**: the `(stakeholder, domain)` pair identified by the recruiter's flag. All other cells in the domain matrix are preserved verbatim.

If the flag does not specify a stakeholder (e.g., the recruiter flags an aggregate field like `technical_context.seniority_band`), the system targets the primary-authority cell for that domain:
- `technical_context` aggregates → re-synthesize `HIRING_MANAGER.work` and `HIRING_MANAGER.codebase`, then re-derive the aggregate.
- `team_culture_profile` aggregates → re-synthesize all stakeholder `team` cells, then re-derive the profile.

### 2. Cell Re-synthesis Prompt

The re-synthesis prompt (`DOMAIN_RE_SYNTHESIS_PROMPT` in `workers/api/src/lib/roleAgent/calibrateRcd.ts`) is a narrow system prompt with a single instruction:

> "Update ONLY the summary, open_codes, and laddering_chains of the provided cell. Preserve existing stories and axial_links unless the new answer directly contradicts them. Add one new laddering_chain derived from the new answer. Keep the summary diplomatic and constructive. Return ONLY a JSON object matching the DomainCell shape."

The user message packages:
- `domain` and `attribute` being corrected
- `recruiterNote` from the flag
- `existingCell` JSON
- `answer` from the gap-fill modal

### 3. Mechanical Fallback

If the LLM call fails (timeout, malformed JSON, schema violation), `calibrateRcd` falls back to a deterministic append:

1. Create a new laddering chain from the answer:
   - `attribute_quote` = first 200 characters of the answer
   - `source_exchange_id` = `"calibrate-1"`
   - `consequence` = "Clarifying answer on {attribute}: {answer}"
   - `value` = "Reinforces {domain} expectations for this role."
   - `energy_signal` = `"medium"`
   - `confidence` = `"medium"`
2. Append the chain to the existing cell's `laddering_chains`.
3. Update `coverage` from `"not_probed"` → `"sparse"` or `"sparse"` → `"partial"`.
4. Append the correction to the cell `summary`.

This fallback guarantees that the recruiter's correction is never lost, even if the LLM provider is unavailable.

### 4. Aggregate Re-derivation

After the cell is updated, any top-level aggregate fields that depend on that cell are re-derived deterministically (no LLM):

| Aggregate | Depends On | Re-derivation Rule |
|---|---|---|
| `technical_context.stack` | `domain_matrix.*.work` + `domain_matrix.*.codebase` | Union of all stack mentions, deduplicated, ordered by frequency. |
| `technical_context.constructs` | `domain_matrix.*.work` + `domain_matrix.*.codebase` | Union of construct slugs from open_codes matching the construct taxonomy. |
| `technical_context.seniority_band` | `domain_matrix.HIRING_MANAGER.bar` | Read from HM bar cell summary; if absent, fall back to baseline title. |
| `technical_context.codebase_expectations` | `domain_matrix.*.codebase` | Extract noun phrases from codebase cell summaries. |
| `technical_context.dispositional_weights` | `domain_matrix.*.bar` + `domain_matrix.*.team` | Count open_code frequency per disposition dimension, normalize to [0, 1]. |
| `consumer_slice` | All matrix cells + aggregates | Mechanical rules per ADR-041b §3. |

### 5. Conflict Detection on Re-synthesis

If the new answer contradicts an existing chain in the same cell (e.g., the recruiter now says "we do NOT pair program" but the cell previously contained "daily pairing"), the re-synthesis prompt detects the contradiction and:

1. Marks the old chain with `confidence: "low"` and appends a note: `"Contradicted by calibrate-1 answer."`
2. Adds the new chain with `confidence: "high"`.
3. Adds an `axial_link`: `{ from_code: "old_code", to_code: "new_code", relation: "contradicts" }`.

If the contradiction is cross-stakeholder (e.g., HM says "autonomous" but TM says "micro-managed"), this is not a re-synthesis issue — it is a `ConflictRecord` that should already exist from the primary synthesis. The re-synthesis does not modify `conflicts`.

### 6. Versioning

Every re-synthesis increments a hidden `rcd_revision` counter on the `role_contexts` row (not stored inside the RCD JSON). This enables optimistic concurrency: if two recruiters flag two different cells simultaneously, both updates succeed because they touch disjoint matrix paths. If they flag the same cell, last-write-wins is acceptable because the calibration loop is single-user per role context.

---

## Consequences

### Positive

- **Cost reduction.** A cell re-synthesis uses one small LLM call (~$0.005) vs. two full-synthesis calls (~$0.04). At 100 calibrations/month, savings are ~$3.50 — small in absolute terms, but the latency reduction (1–2 seconds vs. 6–8 seconds) is the real win.
- **Regression prevention.** Verified cells are never re-opened. A correct `team` cell from a Team Member cannot be corrupted by a correction to the Hiring Manager's `bar` cell.
- **Fast iteration.** Recruiters see updates in near-real time, encouraging them to flag more issues rather than abandoning the review.

### Negative / Risks

- **Aggregate staleness.** If a cell update changes an open_code that feeds into `technical_context.constructs`, the aggregate re-derivation may miss indirect effects. Mitigation: the re-derivation rules are exhaustive — every aggregate is recomputed after every cell update.
- **Contradiction accumulation.** Repeated calibrations on the same cell can produce a long list of low-confidence chains with contradiction links, making the cell noisy. Mitigation: the UI collapses low-confidence chains by default; a "clean up" action (future feature) could request an LLM summarization pass.
- **Fallback quality.** The mechanical fallback produces generic chains that lack the laddering structure (`attribute_quote` → `consequence` → `value`). Mitigation: the fallback is rare (only when LLM fails); the recruiter's answer is still preserved as a quote, and a future full re-synthesis can re-ladder it.

---

## Alternatives Considered

- **Full re-synthesis on every flag** — Rejected: expensive, slow, and introduces regression risk. Correct but impractical at scale.
- **No re-synthesis (append only)** — Rejected: appending raw answers to the RCD without structural integration leaves downstream consumers with unstructured text. The RCD's value is its structured matrix.
- **Cell re-synthesis via rule engine (no LLM)** — Rejected: rule-based extraction cannot generate new laddering chains or rewrite summaries in diplomatic register. The LLM is needed for qualitative synthesis; the rule engine handles aggregates only.

---

## Open Questions

1. **Batch calibration:** Should a recruiter be able to flag multiple cells and submit all answers at once, triggering parallel cell re-syntheses? Parallel calls reduce latency but increase cost and complicate aggregate re-derivation (which must run after all cells finish).
2. **Calibration history:** Should the RCD preserve a history of cell versions, or only the latest? A history would enable "undo" and audit trails but doubles JSON size.
3. **Auto-calibration triggers:** Can the system proactively suggest calibration flags ("this cell has only one chain and low confidence — would you like to add detail?")? This would increase review friction but improve RCD quality.
