# Research Brief: Assessment Template Architecture for Dimensional Matching

**Status:** RESEARCH — do not implement until Phase 2+ post-Neo4j migration  
**Date:** 2026-05-15  
**Trigger:** Founder review of hardcoded dimension weights in `matchRouter.ts`  
**Related:** `knowledge/plan/strategy-v2/part5-matching-migration/UNIFIED-NEO4J-MIGRATION.md` §Phase 6

---

## Problem Statement

Current state (commit 977e339af):
- Dimension weights are hardcoded in `matchRouter.ts` as philosophy presets (validate/tailored/hybrid)
- Matching logic lives in Cypher + TypeScript, not in the graph
- No auditable `MatchAssessment` object exists
- Two candidates matched against the same role cannot be explained dimension-by-dimension without re-running the query

This is EAV-flexible but audit-fragile. Comparable to risk assessment platforms where the *assessment template* is a first-class configurable object with dimension weights, thresholds, and rules.

---

## Reference Architecture (Risk Assessment Pattern)

```
Risk ──→ Risk Assessment Template ──→ Dimensions ──→ Rules ──→ Evaluation
  │              │                       │              │            │
  │              │                       │              │            └── Immutable result with provenance
  │              │                       │              └── "IF technical < 0.6 THEN flag_for_review"
  │              │                       └── Technical, Cultural, Domain, Contextual
  │              └── Configurable per risk type (credit, insurance, compliance)
  └── The entity being evaluated
```

Key insight: the *same underlying entity* produces different evaluations depending on which assessment template is applied. The template is data, not code.

---

## Open Questions for Research

### 1. Assessment Template Scope
- [ ] One template per role? Per pipeline? Per company/account? Per industry vertical?
- [ ] Can recruiters override weights for a single candidate? (ad-hoc assessment)
- [ ] Do templates version? (template v1 → v2, what happens to historical match assessments?)

### 2. Dimension Model
- [ ] Are dimensions fixed (Technical, Cultural, Domain, Experience, Contextual) or extensible?
- [ ] Can a role define custom dimensions? (e.g. "Leadership" for Staff+ roles)
- [ ] How do dimensions map to Neo4j node types? (1:1 or many:1?)

### 3. Rules Engine
- [ ] Threshold rules: "minimum score per dimension" vs "overall score"
- [ ] Dealbreaker rules: "any strong dealbreaker fails → null score" (current) or configurable?
- [ ] Composite rules: "IF Technical > 0.8 AND Cultural < 0.4 THEN flag mismatch"
- [ ] Rule syntax: Cypher extensions? JSON DSL? YAML?

### 4. Score Normalization
- [ ] Current: `tanh(avg(sim) * log(1 + count))` per dimension, weighted sum overall
- [ ] Alternative: z-score normalization across candidate pool per role?
- [ ] Alternative: percentile ranking instead of absolute score?

### 5. Persistence Model
- [ ] `MatchAssessment` node per (candidate, role, template_version)?
- [ ] Do we store per-dimension scores? Per-requirement evidence?
- [ ] Historical trajectory: can recruiter see "Candidate A improved from 0.62 to 0.78 after code review"?

### 6. Explainability Surface
- [ ] What does recruiter see? Dimension bars? Requirement-level evidence cards?
- [ ] What does candidate see (if anything)? GDPR Article 22 implications
- [ ] Audit log: who changed the template? when? what was the impact on existing matches?

### 7. Performance
- [ ] Template lookup per match adds latency. Cacheable?
- [ ] Rule evaluation in Cypher vs. application layer
- [ ] Batch assessment: pre-compute all candidates for a role when template changes?

---

## Research Deliverables

| Deliverable | Owner | Due | Output Location |
|---|---|---|---|
| Survey of risk assessment platforms (credit, insurance, compliance) | Research | TBD | `knowledge/outputs/assessment-survey.md` |
| Dimensional scoring in existing ATS/HR tech (Greenhouse, Lever, Workday) | Research | TBD | `knowledge/outputs/ats-scoring-survey.md` |
| Academic literature on multi-dimensional matching with explainability | Research | TBD | `knowledge/outputs/academic-matching-lit.md` |
| Neo4j schema proposal for AssessmentTemplate + MatchAssessment | Architecture | TBD | `knowledge/outputs/assessment-schema-proposal.md` |
| UI/UX mockups for explainable match scores | Design | TBD | `knowledge/outputs/match-explainability-ui.md` |
| Compliance analysis (NYC Local Law 144, GDPR Article 22) | Legal/Research | TBD | `knowledge/outputs/assessment-compliance.md` |

---

## Decision Gates

**Gate 1:** Research complete → Go/No-Go on building assessment template layer  
**Gate 2:** Schema approved → Begin Neo4j migration for assessment nodes  
**Gate 3:** Prototype with 1 role → Recruiter feedback  
**Gate 4:** Full rollout → Deprecate hardcoded weights

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Over-engineering: building a rules engine when simple weights suffice | High | Medium | Gate 1 is Go/No-Go; default to "no" unless customer demands it |
| Performance: template + rules evaluation adds >50ms to matching | Medium | High | Benchmark before building; keep rules in Cypher |
| Compliance: configurable weights create audit surface area | Medium | High | Every template change logs audit event; version templates immutably |
| Scope creep: assessment layer becomes a full BI platform | Medium | High | Hard boundary: assessment produces scores, not reports. Reports are downstream. |

---

## Related Code

- `workers/api/src/lib/match/matchRouter.ts` — hardcoded weights (line ~66-112)
- `workers/api/src/lib/neo4j/matchingQueries.ts` — Cypher scoring logic
- `workers/api/src/lib/match/triangulateMatch.ts` — legacy four-signal triangulation (retired but present)
- `docs/decisions/current/ADR-047-per-element-cypher-matching.md` — current matching ADR
- `workers/api/src/lib/roleAgent/decomposeRcd.ts` — RCD decomposition (produces role subgraph with signals that could seed template weights)
- `workers/api/src/routes/roleContexts.ts` — role discovery endpoints (interview output is the *source* of template priors)

---

## Key Insight: Role Discovery Already Produces This Embedding

The role discovery interview already generates a **structural embedding** of the role. The AssessmentTemplate just makes it explicit, configurable, and auditable.

### What discovery produces now

```
Text/voice interview → synthesis → RCD JSON → decomposition → Neo4j subgraph
```

The RCD contains dimension priors:
- `technical_context.stack` depth → "this role cares deeply about technical fit"
- `team_culture_profile.conflict_style` → "cultural alignment matters"
- `domain_matrix.primary` → "domain expertise is weighted"
- `dealbreakers[].job_relatedness_strength` → "these are hard gates"

These are **implicit weights**. We throw them away. Matching uses hardcoded presets instead.

### What discovery-derived templates would do

```
Discovery interview → RCD subgraph → auto-generate AssessmentTemplate → recruiter reviews/adjusts → persist → matching uses template
```

The recruiter sees:
- "Based on your interview, technical alignment is weighted at 0.35. Adjust?"
- "You mentioned 'must know Kafka' 3 times. Make this a dealbreaker?"
- "Cultural signals were mixed. Lower weight to 0.15?"

The discovery output becomes the **initial embedding**. The recruiter refines it. The matching geometry is grounded in their actual intent.

### Why this matters

| Current | With Templates |
|---|---|
| Discovery builds the graph | Discovery builds the graph AND the scoring geometry |
| Matching ignores graph structure | Matching uses the graph's own assessment of what matters |
| Recruiter can't explain weights | Recruiter configured (or at least reviewed) the weights |
| Same weights for all roles | Each role has its own metric tensor |

This is not a new feature. It's **surfacing what already exists** in the discovery output and making it queryable, editable, and auditable.

---

## Notes

- Founder has direct experience with risk assessment dimensional architecture — consult when research begins
- This is NOT a build task. Do not create files in `workers/api/src/` for this.
- Blocked by: Neo4j migration stability (6-month window per ADR-043)
