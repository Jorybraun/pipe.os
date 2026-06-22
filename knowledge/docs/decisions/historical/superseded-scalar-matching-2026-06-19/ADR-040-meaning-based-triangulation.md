# ADR-040. Meaning-Based Candidate-Repo-Role Triangulation

**Date:** 2026-04-22
**Status:** Accepted
**Extends:** [ADR-036](ADR-036-role-discovery-data-contract.md) (Role Discovery + Repo Understanding Data Contract), [ADR-039](ADR-039-bi-directional-vectorization-and-3-station-interview.md) (Bi-directional Vectorization + 3-Station Interview)
**Author:** Claude Opus 4.7 with founder

---

## Context

Token-based matching (skills + cosine similarity) is insufficient for candidate→repo→role triangulation. The current pipeline (`matchReposForCandidate`) filters repos by must-have skill overlap and optionally reranks by embedding cosine, but this ignores the *situation* a candidate has worked in — company stage, team topology, primary challenge types, and growth trajectory. Two candidates with identical skill vectors can have radically different situational fits: one thrived in zero-to-one fintech infrastructure, the other in mature B2C feature factories. Token overlap cannot distinguish them.

ADR-039 introduced an asymmetric measurement model (role-fit as primary validity anchor, candidate-fit as completion-rate floor) and deferred the three-entity blending problem. This ADR resolves that deferred work by adding a *meaning-based* scorer that sits alongside the existing graph and cosine signals.

---

## Decision

**Add a structured LLM-based situational scorer (`candidateSituationFit`) modeled on `roleFitRerank`, and a weighted combinator (`triangulateMatch`) that blends role_repo_alignment, candidate_repo_fit, role_candidate_cosine, and skill_coverage into a single triangulated score per (role, candidate, repo) tuple.**

### 1. `candidateSituationFit` — structured situational scorer

Mirrors the `roleFitRerank` architecture (ADR-036 §2.3) but swaps the Role Context Document for a *Candidate Situation Document* extracted by an extended Candidate Discovery agent.

Inputs:
- `candidateSituation`: `{ career_context, situation_signature }` produced by `discoverCandidateProfile` (rich-agent v2).
- `repoEngineeringSignals`: `RepoEngineeringSignalsRow` for the candidate repo.
- `rcdTechnicalContext`: subset of the Role Context Document's `technical_context` (stack, constructs, codebase_expectations, seniority_band).

Outputs (JSON, forceJson=true, Gemma 4 26B):
- `fit_score`: number in [0.0, 1.0]
- `fit_band`: `"strong" | "moderate" | "weak" | "mismatch"` (same thresholds as roleFitRerank)
- `reasoning.matches`: 1–3 bullets quoting verbatim tokens from the candidate's `career_context` or `situation_signature`
- `reasoning.mismatches`: 0–3 bullets
- `reasoning.summary`: ≤30 words
- `per_signal_scores`: object with situational dimensions — `company_stage_match`, `challenge_type_match`, `team_topology_match`, `growth_trajectory_match`, `codebase_complexity_tolerance`, `review_culture_match` — each in [0, 1]

Hard rules inherited from `roleFitRerank`:
- Do not invent signals.
- Do not phrase as "disqualified" or "rejected."
- Reference input tokens verbatim for auditability.

### 2. `triangulateMatch` — weighted combinator

Consumes four scalar signals and emits a `TriangulatedMatchRow`:

| Signal | Source | Weight range |
|---|---|---|
| `role_repo_alignment` | `roleFitRerank` alignment_score | 0.0–1.0 |
| `candidate_repo_fit` | `candidateSituationFit` fit_score | 0.0–1.0 |
| `role_candidate_cosine` | Exact cosine from D1 ground-truth vectors (dual-layer embedding) | 0.0–1.0 |
| `skill_coverage` | `matchedMustSkills.length / mustHaveSkills.length` | 0.0–1.0 |

Formula (deterministic, no LLM):
```
triangulated_score = clamp01(
  w_role_repo   * role_repo_alignment +
  w_candidate   * candidate_repo_fit +
  w_cosine      * role_candidate_cosine +
  w_skills      * skill_coverage
)
```

Mode presets:

| Mode | Description | Weights (role_repo / candidate / cosine / skills) |
|---|---|---|
| `validate` | Stresses role-repo alignment; candidate fit is a sanity check only | 0.35 / 0.30 / 0.15 / 0.20 |
| `tailored` | Ignores role-repo alignment; optimizes candidate-repo fit + cosine | 0.00 / 0.50 / 0.20 / 0.30 |
| `hybrid` | Blends both with role-leaning default | 0.25 / 0.35 / 0.20 / 0.20 |

Mode is selected from `pipeline_match_config.match_philosophy` (ADR-039 §2), falling back to `role_contexts.match_philosophy`. All weights are stamped on the output row for reproducibility.

### 3. Schema additions

`candidate_ingestion` (v2 rich-agent output):
- `career_context_json` — JSON blob with `company_stages`, `team_topologies`, `primary_challenge_types`, `growth_trajectory`.
- `situation_signature_json` — JSON blob with `primary_challenge_types`, `complexity_tolerance_band`, `review_culture_preference`.
- `embedding_json` — BGE-large-en-v1.5 vector JSON (dual-layer ground truth; mirrored in `CANDIDATE_INDEX`).

`repo_engineering_signals` (Pass 3 output):
- `embedding_json` — BGE-large-en-v1.5 vector JSON (dual-layer ground truth; mirrored in `REPO_INDEX`).

`role_contexts` (Role Discovery output):
- `role_searchable_profile` — 400–600 word narrative describing the role, built from `job_description_md`.
- `embedding_json` — BGE-large-en-v1.5 vector JSON (dual-layer ground truth).

`candidate_repo_match` (new table):
- `candidate_id`, `repo_id`, `role_context_id`
- `triangulated_score`, `triangulated_band`
- `role_repo_alignment`, `candidate_repo_fit`, `role_candidate_cosine`, `skill_coverage`
- `weights_json` — the four weights used
- `mode` — `validate | tailored | hybrid`
- `model_used` — Gemma 4 identifier for the LLM-based signals
- `generated_at`

`match_feedback` (new table):
- `match_id` → `candidate_repo_match.id`
- `recruiter_id`
- `feedback_type` — `thumbs_up | thumbs_down | override`
- `override_repo_id` — nullable, recruiter manual pick
- `notes`
- `created_at`

### 4. Orchestration hook

On resume upload:
1. Candidate Discovery v2 runs (`discoverCandidateProfile` → rich fields).
2. `candidateSituationFit` runs against the matched repo (from `matchReposForCandidate`).
3. `triangulateMatch` runs in the mode selected by pipeline/role config.
4. Result is written to `candidate_repo_match`.
5. Recruiter sees the match on the candidate profile with reasoning fold-out.

---

## Rationale

| Decision | Why this and not the alternative |
|---|---|
| LLM-based situational scorer | Token overlap fails on situational nuance; embedding cosine fails on sparse profiles. A structured Gemma scorer gives auditable, per-dimension reasoning at ~$0.06/candidate. |
| Mirror `roleFitRerank` architecture | Proven prompt pattern, same model-family routing rules (Gemma 4 runtime), same parse/normalize/test paths. Reduces cognitive load and bug surface. |
| Deterministic combinator after LLM | Keeps the combinator fast, cheap, and reproducible. The LLM pays once per resume; the combinator pays zero per query. |
| `match_feedback` table | Empirical weight calibration requires ground-truth labels. Recruiter thumbs-down on a match is the cheapest, highest-fidelity label available. |
| Hybrid default | Same rationale as ADR-039 §3.2: sampling diversity reduces single-source bias. Role-leaning (0.35) reflects the asymmetric model without ignoring candidate fit. |

---

## Consequences

### Positive

- Richer, context-aware matching that reasons about *where* a candidate succeeded, not just *what* technologies they used.
- Auditable reasoning per match — every `candidate_repo_fit` carries verbatim quotes from the candidate profile.
- Empirical tuning via `match_feedback` — weights can be recalibrated quarterly against recruiter labels.
- Symmetric architecture with repo-side `roleFitRerank` — same team owns both scorers, same observability, same guardrails.

### Negative / Trade-offs

- **Higher latency:** one additional LLM call per resume upload (Candidate Discovery already runs; this extends it with a second call for situational scoring, or a single larger prompt — implementation detail TBD).
- **Higher cost:** ~$0.06 per candidate at Gemma 4 26B Vertex AI pricing. At 1,000 candidates/month this is ~$60 — acceptable for the signal quality, but must be monitored.
- **Schema migration:** two new JSON columns on `candidate_ingestion`, one new match table, one feedback table — backwards-compatible but requires D1 migration.
- **Guardrail complexity:** `validate` mode with high `role_repo_alignment` weight + auto-reject is a BLOCK per ADR-039 §4. The combinator must call `guardrails.ts` before writing `candidate_repo_match`.

### Risks

- LLM scorer drift: if Gemma 4 weights change at Vertex AI, per-signal score distributions may shift. Mitigation: version-stamp `model_used` and run a rolling calibration window.
- **Dual-layer embedding architecture:** D1 stores `embedding_json` as ground truth (exact cosine, index rebuild source); Vectorize (`REPO_INDEX`, `CANDIDATE_INDEX`) remains the fast ANN layer. This enables exact `role_candidate_cosine` computation at match time and bidirectional search endpoints (`POST /api/v1/search/candidates`, `POST /api/v1/search/repos`).
- Privacy of candidate embeddings: `role_candidate_cosine` requires candidate embeddings in the same space as repo embeddings. Candidate text (resume, profile) is sensitive PII. Mitigation: embeddings are vectors, not reversibly decryptable; access control follows ADR-031 consent gate.

---

## Alternatives Considered

- **Pure cosine** — Rejected: cannot encode situational context (company stage, challenge types) in a 1024-dim BGE vector without fine-tuning, which we do not have labeled data for.
- **Pure graph** — Rejected: the existing skill-coverage graph has no situational edges. Adding them would require a taxonomy of company stages and challenge types we do not maintain.
- **Full meaning graph (deferred)** — A knowledge-graph approach (candidate → company → stage → challenge → repo) would be elegant and explainable, but requires months of ontology engineering and curation. The LLM scorer is a pragmatic stopgap; a meaning graph may replace it once the ontology matures. Deferred to post-MVP research track.

---

## Open Questions

1. **Weight calibration:** The preset weights (validate/tailored/hybrid) are grounded in ADR-039's working hypotheses but are not yet validated. First calibration pass at N=100 recruiter feedback rows.
2. **Scale of LLM costs:** If candidate volume exceeds 5,000/month, the $0.06/candidate line item becomes material. A caching layer (same resume hash → skip re-scoring) or a smaller model fallback may be needed.
3. **Privacy of candidate embeddings:** Candidate embeddings in `REPO_INDEX` (or a separate `CANDIDATE_INDEX`) raise GDPR-scope questions. ADR-031 covers consent; a separate privacy review for vector retention may be required.
4. **Prompt size:** The combined Candidate Discovery + situational scorer prompt may exceed Gemma 4's context window for long resumes. A two-call pipeline (discovery → situational) is safer but doubles latency. TBD during implementation.
5. **Hybrid mode deterministic mix ratio:** ADR-039 OQ-V6 set 0.6 role / 0.4 candidate for the dual-query rerank. The combinator's `hybrid` preset uses 0.35/0.25/0.25/0.15. These should converge to a single validated ratio in a future calibration cycle.

---

## Decision log

| Date | Change | Source |
|---|---|---|
| 2026-04-22 | Initial draft (Proposed) | STRATEGY.md Decision Log 2026-04-22 entry; `roleFitRerank.ts` pattern reuse |
| 2026-04-22 | Accepted + dual-layer embedding implementation | Migration 0042, `lib/embedding/cosine.ts`, unified search endpoints, `role_candidate_cosine` now computed from D1 ground truth |
