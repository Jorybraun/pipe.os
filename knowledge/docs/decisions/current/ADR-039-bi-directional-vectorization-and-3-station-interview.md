# ADR-039. Bi-directional Vectorization + Repo-Personalized 3-Station Interview Trajectory

**Date:** 2026-04-19
**Status:** Proposed
**Extends:** [ADR-027](ADR-027-role-discovery-agent.md) (Role Discovery Agent), [ADR-029](ADR-029-culture-interview-agent.md) (Culture Interview Agent), [ADR-032](ADR-032-code-review-research-integration.md) (Code Review Research Integration), [ADR-034](ADR-034-challenge-authoring-system.md) (Challenge Authoring System), [ADR-036](ADR-036-role-discovery-data-contract.md) (Role Discovery + Repo Understanding Data Contract)
**Complements:** [ADR-031](ADR-031-ai-hiring-compliance-architecture.md) (AI Hiring Compliance), [ADR-038](ADR-038-role-discovery-agent-guardrails.md) (Role Discovery Guardrails)
**Research brief:** `knowledge/interview/repo-personalized-interview-config.md` (PASS WITH NOTES, dual-researcher synthesis, 2026-04-19; Verifier Notes A–M applied)
**Author:** Claude Opus 4.7 with founder

---

## Context

The 2026-04-14 Decision Log locked repo vectorization (`repo_searchable_profile` + `@cf/baai/bge-large-en-v1.5` in `REPO_INDEX`); the 2026-04-17 entry added the human-gated analyze → feedback → ingest split. Repos are now embeddable; roles and candidates are not. The 2026-04-18 EXPLORATORY entry sketched a symmetric three-entity vector space and a three-station OSCE-style interview anchored on a single matched repo per (role × candidate) pair. That sketch needed three things before any code: (1) a defensible measurement philosophy, (2) a UX/automation surface, (3) guardrails against legally and psychometrically foreseeable misuse. The synthesis brief at `knowledge/interview/repo-personalized-interview-config.md` resolves all three.

Two prior frames must be discarded. **First**, the symmetric T/V/H framing (tailored / validate / hybrid as peers) collapses Kane (2013) Interpretation-Use Argument: a single raw score cannot simultaneously support "this candidate matches this role" *and* "this candidate's claims about themselves are accurate." Those are different validity claims demanding different evidence. **Second**, the assumption that personalized items must be calibrated like fixed-form items is wrong: under personalization, per-item N≥100 may never materialize. Calibration must attach to ADR-034 template packs and BARS dimensions, not items (recorded 2026-04-18). Both reframes carry through this ADR.

---

## Decision

**Adopt an asymmetric measurement model — role-fit as the primary validity anchor, candidate-fit as a completion-rate floor — operationalized through four orthogonal config axes with locked defaults, gated by an N≥100 + per-dimension G≥0.70 summative-use threshold, and protected by five guardrails (3 BLOCK, 2 WARN). Build it on a dual-home schema: role-level defaults in `role_contexts`, per-pipeline overrides in a new `pipeline_match_config` table.**

### 1. Asymmetric measurement model

Role-fit is the primary scorecard claim ("does this candidate meet the criteria of this role, as evidenced by performance on a role-appropriate repo"). Candidate-fit is a completion-rate floor — it prevents pathological mismatches where the candidate cannot meaningfully engage with the repo (and so drops out, producing no signal in either direction). Candidate-fit is never the primary validity claim, never appears as a scalar on the recruiter scorecard. This is criterion-referenced measurement (per the 2026-04-18 companion entry), not norm-referenced ranking.

### 2. Four orthogonal config axes

| Axis | Values | Default | Rationale |
|---|---|---|---|
| Match philosophy | `tailored` / `hybrid` / `validate` | `hybrid` | Tailored optimizes role-fit only; validate stresses candidate's claims; hybrid blends both with a deterministic mix ratio (open question OQ-V6 below). |
| Tolerance | `strict` / `moderate` / `lenient` | `moderate` | Cosine-distance band on the role↔repo and candidate↔repo edges. Tunes how far from optimal a match may stray. |
| Stage linkage | `shared-repo` / `per-stage` | `shared-repo` | Whether all three stations anchor on the same repo (consistency-across-modality signal) or each picks its own (broader sampling). |
| Automation granularity | `per-pipeline` / `per-candidate` / `per-stage` / `recruiter-override` | `per-candidate` | Where the config can vary. Recruiter-override is auditable; per-stage + per-pipeline simultaneously is a guardrail violation (see §4). |

Defaults are research-grounded working hypotheses, not optimums. They become tunable in production once volume permits.

### 3. Summative-use gate (N≥100 + per-dimension G≥0.70)

A 3-station OSCE-style encounter has a G-coefficient of 0.60–0.75 (Brennan generalizability theory; this is a ceiling, not a floor — synthesis §3.4). Below N≥100 per role + per-dimension G≥0.70, the output is **formative + advisory only**: it informs recruiter conversations and surfaces signal, but does not drive automated reject/hold/advance decisions. Above the gate, summative use is permitted with documented reliability evidence. Rasch SE ≈ 2/√N drives the N=100 threshold; difficulty band filter `|b − θ| ≤ 1 logit` per mode prevents ceiling/floor effects within personalized items. This satisfies UGESP §1607.5 (validation evidence required for selection procedures) and Kane's IUA chain.

### 4. Five guardrails

Three BLOCK (hard refusal — config cannot save), two WARN (recruiter must acknowledge):

- **BLOCK** — `tailored` + `strict` tolerance + uncommon stack + `auto-reject` enabled. Disparate-impact landmine: narrow stack matching plus auto-rejection plus tight tolerance produces a system that systematically excludes candidates whose backgrounds don't word-overlap the role. UGESP 4/5ths rule applied to difficulty-tier distributions makes this auditable (novel architectural inference from synthesis §4.5).
- **BLOCK** — `per-stage` + `per-pipeline` automation set simultaneously. Conflicting authority levels produce non-deterministic config resolution; recruiters cannot reason about what the system will do.
- **BLOCK** — `validate` mode + `auto-disqualify` enabled. Validate-mode failures probe claim-gap, not role-gap; auto-disqualifying on a claim-gap signal is a misuse of the validity argument and a Mobley v. Workday-style agent-liability risk.
- **WARN** — `tailored` + `strict` + `auto-reject`. Allowed but flagged; recruiter must acknowledge that strict tolerance with auto-reject narrows the funnel.
- **WARN** — `validate` mode + sparse candidate profile (insufficient text from intake to embed reliably). The validate signal will be unreliable; recruiter must opt in.

### 5. Dual-home schema

Role-level defaults extend `role_contexts`; per-pipeline overrides live in a new table. Canonical DDL is at synthesis §4.7 lines 213–232 — reused verbatim in the migration sketch:

```sql
ALTER TABLE role_contexts ADD COLUMN match_philosophy TEXT
  CHECK(match_philosophy IN ('tailored','hybrid','validate')) DEFAULT 'hybrid';
ALTER TABLE role_contexts ADD COLUMN tolerance TEXT
  CHECK(tolerance IN ('strict','moderate','lenient')) DEFAULT 'moderate';

CREATE TABLE pipeline_match_config (
  pipeline_id TEXT PRIMARY KEY REFERENCES pipelines(id),
  match_philosophy TEXT CHECK(match_philosophy IN ('tailored','hybrid','validate')),
  tolerance TEXT CHECK(tolerance IN ('strict','moderate','lenient')),
  stage_linkage TEXT CHECK(stage_linkage IN ('shared-repo','per-stage')) DEFAULT 'shared-repo',
  automation_granularity TEXT CHECK(automation_granularity IN
    ('per-pipeline','per-candidate','per-stage','recruiter-override')) DEFAULT 'per-candidate',
  recruiter_override_audit_json TEXT,
  updated_at INTEGER NOT NULL
);
```

NULL columns in `pipeline_match_config` inherit the role-level default. This collapses the configuration surface area without sacrificing per-pipeline control.

---

## Rationale (research traceability)

| Decision | Finding (synthesis §) | Why this and not the alternative |
|---|---|---|
| Asymmetric reframe | §3.1 (Kane 2013 IUA) | Symmetric T/V/H violates the validity argument; same raw score cannot serve two interpretations. |
| Hybrid default | §3.2 (sampling diversity reduces single-source bias) | Tailored-default optimizes too aggressively; validate-default produces too much noise on sparse profiles. |
| N≥100 + G≥0.70 gate | §3.4 (Brennan; Rasch SE) | OSCE 3-station ceiling is 0.75; gating at 0.70 gives margin. Per-dimension (not per-item) reflects the personalization context. |
| 5 guardrails | §4.5 (UGESP 4/5ths; Mobley) | All five enforce a documented legal or psychometric constraint; none are stylistic. |
| Dual-home schema | §4.7 | Per-pipeline overrides must be auditable separately from role defaults; merging into one table loses the audit boundary. |
| Defer item-level IRT | 2026-04-18 companion entry | CR-32/CR-33 reframed: calibration unit is template + dimension, not item. |

Verifier Notes A–M applied at the source brief; this ADR inherits those constraints.

---

## Consequences

### Positive

- Recruiter scorecard claim is defensible under Kane (2013) IUA + UGESP §1607.5.
- 3-station consistency-across-modality becomes a first-class scorer signal once `shared-repo` is the linkage default.
- Five guardrails materially reduce Mobley-class agent-liability exposure (CO/IL/NYC/EU statute coverage per the synthesis legal scan).
- Dual-home schema lets recruiters customize per pipeline without schema bloat.

### Negative / open

Nine open questions deferred to follow-up calibration cycles (synthesis §7):

1. Tolerance threshold tuning — what cosine bands map to strict/moderate/lenient empirically?
2. Per-stage automation default — should this become first-class or stay an override?
3. Recruiter-override audit retention window (likely aligned with ADR-031, but not yet specified).
4. Wizard vs chip+modal UX final pick (synthesis §4.4 leans chip+modal; needs candidate-side test).
5. Embedding-space disparate-impact audit cadence — quarterly? per-pipeline?
6. Hybrid mode deterministic mix ratio — 0.6/0.4 default mirrors the dual-query rerank weights but is not yet validated.
7. OCR/parser fallback path for sparse candidate profiles (intake text below embedding-quality floor).
8. Candidate-facing XAI text variant testing (Gilliland & Hausknecht class-level envelope; Fok & Weld 2023 over-explanation guard — **task #4 in the implementation queue**).
9. Consistency-across-modality scorer weight inside the existing dispositional-weights overlay.
10. **OQ-V2 carried forward:** `ADR_REVIEW` as a distinct challenge type (working assumption in §Implementation sequencing #5) vs. an extension of `CODE_REVIEW`. The working assumption is grounded in BARS code-review dimensions targeting diff-level critique (ADR-032 §Rubric) while architecture-review competency probes design trade-off reasoning; a short rubric-comparison research pass is required before the template pack work ships.

### Invariant

**Candidate-fit never surfaces as a scalar on the recruiter scorecard.** It is a pre-match eligibility check (completion-rate floor) and appears in the match-audit trail only. Any UI regression that exposes candidate-fit as a ranked or scored quantity collapses the asymmetric model back into symmetric T/V/H through a side channel and must be blocked at code review.

### Migration impact

- **Schema:** D1 migration `0036_pipeline_match_config.sql` applies the §5 DDL. Backwards-compatible (new columns NULL-default to role-level inheritance).
- **Role Discovery prompt:** three new prompt variants required to populate `match_philosophy` + `tolerance` from the intake conversation (synthesis §4.6 names them `tailored-probe`, `validate-probe`, `hybrid-probe`).
- **Pipeline UI:** chip + modal control on the Pipeline detail page exposing the four axes; recruiter overrides write to `pipeline_match_config` and the `recruiter_override_audit_json` blob.
- **Guardrail enforcement:** `workers/api/src/lib/match/guardrails.ts` (new) — pure function `(roleConfig, pipelineConfig) → { allowed, blocks[], warnings[] }`. Called at config-write and at match-time.

### Implementation sequencing (blocked on this ADR landing)

1. D1 migration + dual-home schema.
2. Candidate Discovery agent (Vertex AI Gemma 4 26B; mirror Role Discovery FSM; produces `candidate_searchable_profile`).
3. Role + candidate ingest endpoints (mirror `pass3/ingest`; symmetric `*_profile_version` cache-key stamping).
4. Three-way match endpoint (`POST /api/v1/admin/roles/:id/match-candidates`; dual-query rerank, default 0.6 role / 0.4 candidate).
5. `ADR_REVIEW` challenge type via ADR-034 pipeline (new template pack + BARS rubric for design-trade-off reasoning). **Blocked on OQ-V2 resolution** (see §Open #10).
6. Three-station session runner (orchestrates A → B → C with shared repo context; emits consistency-across-modality signal).

---

## Alternatives rejected

- **Symmetric T/V/H** — collapses the validity argument; rejected on Kane (2013) grounds.
- **Per-item IRT calibration** — N may never materialize per personalized item; reframed to template + dimension.
- **Single-table schema (everything in `role_contexts`)** — loses per-pipeline audit boundary.
- **Midpoint averaging for three-way match** — can land in no-man's-land when role and candidate diverge; dual-query rerank is empirically more robust (synthesis §4.3).
- **Auto-reject under any `validate` configuration** — claim-gap signal misused as role-gap signal; explicit BLOCK guardrail.

---

## Decision log

| Date | Change | Source |
|---|---|---|
| 2026-04-19 | Initial draft (Proposed) | Synthesis brief PASS WITH NOTES; STRATEGY.md Decision Log 2026-04-19 entry |
| 2026-04-19 | v1 wizard + auto-build slice landed: (a) wizard lives inside Role Discovery (post-Synthesis, pre-pipeline-create); per-stage chip on `StageStepper` is read-only with "Override coming soon" tooltip — resolves OQ-V4 by splitting capture vs. expose. (b) Added `non_negotiable_skills_json` constraint at the wizard step `non-negotiable`; passed through to `matchRepos.mustHaveSkills` so the existing `HAVING must_hits = must_total` clause guarantees coverage in the auto-built repo pick. (c) `hybrid_mix_ratio` default = 0.6 (role-leaning per synthesis §4.3) — resolves OQ-V6 with an explicit caveat that the value is a working default, not validated. (d) v1 ships **2 stations** (CODE_REVIEW + CODE_IMPLEMENTATION); ADR_REVIEW remains deferred until OQ-V2 (rubric research). (e) Migration `0037_match_config_extensions.sql` adds the two columns ADR-039 §2 named but `0036` had not yet shipped (`role_contexts.non_negotiable_skills_json`, `pipeline_match_config.hybrid_mix_ratio`). (f) Guardrails enforced at `/auto-build` for the 3 BLOCK rules; the 2 WARN rules are logged but not yet surfaced (UI deferred). | `workers/api/src/routes/cockpit/pipelinesAutoBuild.ts`; `workers/api/src/lib/match/{autoStageBuilder,guardrails}.ts`; `src/components/RoleDiscovery/MatchConfigWizard.tsx`; plan `polymorphic-wobbling-tiger.md` |
