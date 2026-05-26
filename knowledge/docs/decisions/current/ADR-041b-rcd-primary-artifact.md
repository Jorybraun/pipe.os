# ADR-041b: Role Context Document as Primary Artifact

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Hans (founder)
**Extends:** [ADR-036](ADR-036-role-discovery-data-contract.md)
**Supersedes:** Any code path treating `CandidatePersona` as the canonical output of Role Discovery

---

## Context

ADR-036 defined the Role Context Document (RCD) schema — a domain matrix keyed by `(stakeholder_type, domain)` with laddering chains, open codes, axial links, stories, and conflict records. ADR-036 also introduced a `consumer_slice` field as a derived cache for legacy readers. However, the implementation deferred the question of which artifact is **primary**: the flat `CandidatePersona` (8 fields) or the structured RCD.

That deferral has created ambiguity in three places:

1. **Pipeline creation** reads `persona.mustHaveSkills` to populate challenge configs. It ignores the RCD's `technical_context.stack` and `codebase_expectations`.
2. **Culture scoring** reads `persona.seniority` and `persona.disposition`. It does not read `team_culture_profile` or the Team domain laddering chains.
3. **Repo discovery** reads `persona.mustHaveSkills` for keyword filtering. It has no access to `technical_context.constructs` or `dispositional_weights`.

The result is that the richest structured output of Role Discovery remains dead inventory while downstream consumers eat a flattened, lossy derivative. This ADR resolves the ambiguity by elevating the RCD to primary status and formally demoting `CandidatePersona` to a backward-compatible derived slice.

---

## Decision

### 1. The RCD Is the Canonical Output

After Role Discovery synthesis completes, the `role_contexts.knowledge_state` column stores the full `RoleContextDocument` JSON. This is the **source of truth** for all downstream agents, UI components, and API responses.

The `consumer_slice` field inside the RCD is a **read-only derived cache**. It is regenerated whenever the RCD is re-synthesized. No downstream consumer may write to it. No consumer may treat it as authoritative when the parent RCD fields are available.

### 2. CandidatePersona Is a Legacy View

The existing `CandidatePersona` TypeScript type (`workers/api/src/types.ts`) is retained for backward compatibility during the migration window. New code must not introduce additional `CandidatePersona` consumers. Existing consumers are migrated to read from the RCD per the priority order below.

Migration priority (highest first):

| Consumer | Current Read | New Read | ADR |
|---|---|---|---|
| Culture scorer | `persona.seniority`, `persona.disposition` | `technical_context.seniority_band`, `team_culture_profile` | ADR-029, ADR-030 |
| Challenge generation | `persona.mustHaveSkills`, `persona.niceToHaveSkills` | `technical_context.stack`, `technical_context.codebase_expectations` | ADR-034 |
| Repo discovery / matching | `persona.mustHaveSkills` | `technical_context.stack`, `technical_context.constructs`, `domain_matrix.*.bar` | ADR-036, ADR-040 |
| Pipeline wizard | `persona.archetype`, `persona.careerSignal` | `consumer_slice` (derived) | This ADR |
| JD renderer | `jobDescription` string | `consumer_slice` + `technical_context` | This ADR |

### 3. Derived-Cache Regeneration Rules

The `consumer_slice` is rebuilt from the RCD domain matrix by deterministic mechanical rules — no LLM call, no inference:

- `seniority` ← `technical_context.seniority_band`
- `archetype` ← `work` cell summary + `seniority`
- `mustHaveSkills` ← `technical_context.stack` + `technical_context.codebase_expectations`
- `niceToHaveSkills` ← `work`/`codebase` `open_codes` not already in `mustHaveSkills`
- `disposition` ← `team` + `process` cell summaries + keys from `dispositional_weights`
- `careerSignal` ← highest-energy laddering chain in `work` or `bar` domains
- `redFlags` ← `red_flags[].label`
- `dealbreakers` ← `dealbreakers[].label`

If the matrix is thin, the slice is thin. Padding is forbidden.

### 4. API Contract Change

`GET /api/v1/role-contexts/:id` returns the full RCD in `knowledgeState` (already true). The `persona` field on that response is removed in v2 of the API. During the migration window, v1 continues to serve `persona` as a computed field from `consumer_slice`.

Frontend components (`RoleContextReview`, `OverviewPage`) render the RCD directly. The old `persona` card on `OverviewPage` is replaced with a summary derived from `consumer_slice` rendered inside the RCD view.

### 5. Validation Metadata

Every RCD carries `validation_metadata` with:
- `schema_version` — RCD schema semver
- `synthesis_model` — model that produced the matrix
- `synthesis_prompt_version` — prompt version stamp
- `verification_pass_model` — model that ran the quote-verification pass
- `face_validity_reviewed_at` — null until human review
- `face_validity_reviewer` — null until human review

This enables downstream consumers to cache RCD-derived data invalidly when the schema or prompt changes.

---

## Consequences

### Positive

- **Downstream agents get richer inputs.** Culture scoring can weight OCAI archetypes. Challenge generation can reference specific codebase expectations. Repo matching can reason over constructs, not just skill keywords.
- **Single source of truth.** No drift between "what the recruiter said" and "what the pipeline thinks the recruiter said."
- **Auditability.** Every claim in the RCD traces to a verbatim `attribute_quote` with `source_exchange_id`. Compliance review (ADR-031) can inspect the evidentiary chain.
- **Multi-stakeholder fidelity.** Cross-stakeholder conflicts are first-class data, not flattened into a single disposition string.

### Negative / Risks

- **Migration cost.** Three downstream consumers (culture scorer, challenge generation, repo discovery) must be updated to read new paths. Estimated 2–3 engineering days.
- **RCD size.** A fully populated RCD with 4 stakeholders × 6 domains can exceed 50 KB JSON. D1 TEXT columns handle this, but API responses become large. Mitigation: `GET` supports a `?slice=consumer` query param that returns only `consumer_slice` for lightweight readers.
- **Schema versioning burden.** Every RCD schema change requires a semver bump and cache invalidation across downstream consumers. Mitigation: `validation_metadata.schema_version` is checked at read time; mismatches trigger a warning log.

---

## Alternatives Considered

- **Dual-primary (both RCD and CandidatePersona equally canonical)** — Rejected: creates synchronization ambiguity. Two sources of truth always diverge.
- **Keep CandidatePersona primary, augment with RCD fields** — Rejected: perpetuates the flattening problem. The 8-field shape cannot hold laddering chains, conflict records, or per-stakeholder cells.
- **Delete CandidatePersona immediately** — Rejected: breaks the pipeline wizard and JD renderer before they are migrated. The derived-slice bridge gives a safe deprecation path.

---

## Open Questions

1. **Migration deadline:** When does v1 API (with `persona` field) get deprecated? Target: 30 days after all internal consumers are migrated.
2. **D1 column migration:** Should `role_contexts.knowledge_state` be renamed to `role_contexts.rcd` to make the primary-artifact semantics obvious? Backwards-compatible but requires a migration.
3. **Consumer-slice staleness:** If a recruiter edits the RCD via the calibration review loop (ADR-041d), does the consumer_slice regenerate synchronously or asynchronously? Synchronous is simpler; asynchronous risks stale reads.
