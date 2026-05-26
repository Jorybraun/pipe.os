# Handoff: Pipe Strategy v2 Synthesis → Execution Plan
**Date:** 2026-04-24  
**From:** Strategy synthesis session  
**Context:** User requested synthesis of `/knowledge/plan` documents into broken-down steps per file.

---

## What Was Done in This Session

1. **Read all 6 strategy documents** in `/knowledge/plan/` (262–603 lines each, ~220KB total):
   - `pipe-strategy-v2-part1-north-star.md`
   - `pipe-strategy-v2-part2-role-discovery.md`
   - `pipe-strategy-v2-part3-repo-ingestion.md`
   - `pipe-strategy-v2-part4-candidate-ingestion.md`
   - `pipe-strategy-v2-part5-matching-migration.md`
   - `pipe-strategy-v2-part6-market-research.md`

2. **Synthesized into a phased execution plan** with file-level steps. Key organizing principle: **consumption cutover before decomposition before migration**. The original strategy's sequencing (Part 1 §The phased direction) was preserved and expanded with specific file targets.

3. **Identified 6 execution phases** totaling 30–50 weeks of focused work, plus an ongoing Phase 6 for maturity/validation.

---

## The Central Diagnosis (Preserved from Part 1)

> **"The problem is that structural richness is being collected and then dropped on the floor before it reaches the matching layer."**

Specifically:
- RCD is rich but **flattened** by `buildRoleSearchableProfile` into JD-based prose for ROLE_INDEX. The richer `buildRcdSearchProfile` is only used as query text, never stored.
- Candidate `candidate_searchable_profile` is flat prose while `career_context_json`, `situation_signature_json`, `key_concepts_json` sit in adjacent D1 columns, unread by matching.
- Repo Pass-3 output is one blob per repo. Features, architectural patterns, technical stack all concatenate into a single narrative. Matching can't find repos with specific event-driven patterns; only overall narrative similarity.
- UAR migration stalled at Phase 1 (runtime foundation done, 3 plugins are mock stubs returning "Mock question #N").
- Four-signal triangulation produces scores without evidence. Recruiters see numbers, not cases.

**The fix:** Decomposition of entities that are currently flat, consumption cutover for signals that already exist, and matching-layer rewrites that read structural depth rather than flattening it.

**Neo4j is the endpoint, not the beginning.** Decomposition must work on existing infrastructure first; then migration to Neo4j is a port of a graph-shaped data model into a graph database.

---

## Execution Plan Summary

### Phase 0 — Consumption Cutover & Production Hygiene (4–6 weeks)
*Theme: Finish what exists. Fix broken things. Consume existing signal. Zero new architecture.*

**Quick wins (Week 1–2):**
- Cache `candidateSituationFit` (saves Gemma cost)
- Inject structured JSON signals into `candidate_searchable_profile` prompt + backfill existing candidates
- Add embedding model version stamps to `candidate_ingestion`, `role_contexts`, `repo_engineering_signals`
- Normalize 3 `preprocessForEmbedding` bypass call sites (`adminRepos.ts:698`, `:1136`, `discover.ts:414`)
- Cut over `autoStageBuilder.ts`, `repoDiscovery/discover.ts`, cockpit routes to RCD primary (persona fallback)
- Switch ROLE_INDEX to store RCD narrative (`buildRcdSearchProfile`) instead of JD-based text; backfill
- Delete compile-broken evaluator files (`lib/roleDiscovery/evaluator.ts`, `evaluatorPrompt.ts`, `routes/internal/evaluateDiscovery.ts`)
- Fix `lib/agents/culture/plugin.ts` stub dimensions to match live `cultureScorer.ts`
- Fix staging `wrangler.jsonc` (D1/R2/Vectorize bindings currently commented out → shares prod)

**Matching fixes (Week 3–4):**
- Wire vector signal slots in `triangulateMatch` (currently unreachable — `orchestrate.ts` never passes params)
- Add `vector_role_repo`, `vector_role_cand`, `vector_cand_repo` columns to `match_feedback`
- Hand-curate `skill_adjacency` table (~50 groupings); rewrite `matchRepos.ts` SQL from strict `HAVING must_hits = must_total` to threshold-based coverage
- Fix silent `skill_aliases` fallback (`skill.toLowerCase()`); add alerting on unknown slugs
- Issue body pre-fetch for implementation challenges (`repo_issues.body_cache_json`)
- Confidence-threshold auto-approval for Pass 3 vectorize (replaces manual admin gate)
- Wire dealbreaker gate enforcement in matching (strong → auto-fail, moderate → flag, weak → advisory)

**Reliability & observability (Week 5–6):**
- Retry helpers with provider-specific params (Vertex: 2s/120s/5 retries; Workers AI Qwen: 30s fixed/300s/3 retries; BGE: 2s/5 retries)
- Circuit breakers via opossum per provider
- `Idempotency-Key` on `POST /:candidateId/reingest` (24h TTL cache)
- Per-step status columns on `candidate_ingestion` (resume from failed step, don't restart)
- Heartbeats + stale-run detection cron
- Dead-letter queue with structured diagnostics
- OpenTelemetry `@microlabs/otel-cf-workers` with `gen_ai` semantic conventions
- Structured recruiter-facing status page (replace opaque "failed")

### Phase 1 — Candidate Decomposition (6–8 weeks)
- Rewrite `candidateDiscovery/prompts.ts` to output structured sub-element JSON (Experience, Project, Accomplishment, Skill, Education, Credential)
- New `candidate_nodes` table + `candidate_coverage` table
- Per-sub-element embeddings in CANDIDATE_INDEX with metadata tags
- Keep aggregate `candidate_searchable_profile` as derived view for backward compat
- Backfill all existing candidates via idempotent batch job
- Update matching to consume sub-elements when present, fallback to aggregate

### Phase 2 — Role & Repo Decomposition (4–6 weeks)
- New `role_nodes` table; implement `decomposeRcdIntoNodes` called from `synthesizeRcd.ts`
- Sub-element types: Requirement, Responsibility, CulturalSignal, TeamContext, Dealbreaker, RedFlag, TechnicalContext, CodebaseExpectation, ProcessExpectation, Conflict, BarsOverride
- New `repo_nodes` table; update Pass 3 prompt to produce structured sub-element JSON
- Sub-element types: Feature, ArchitecturalPattern, TechnicalStack, Construct, ChallengeSurface, QualitySignal, DomainContext
- Backfill existing RCDs and pass=3 repos

### Phase 3 — Per-Element Matching Rewrite (4–6 weeks)
- Match report is primary output; score is derived summary
- New `MatchReport` type with dimension scores, requirement matches, cultural alignment, unaddressed concerns, dealbreaker fails, confidence, evidence density
- Candidate shortlisting via per-requirement vector queries (threshold 0.6)
- Per-requirement evidence gathering (top-N sub-elements with similarity + source)
- Per-dimension aggregation: `avg(sim) * log(1 + count)` for above-threshold matches
- Dealbreaker gate at strict threshold 0.75
- Rewrite `triangulateMatch` as adapter over match reports
- New `match_reports` table (versioned per candidate-role pair)

### Phase 4 — Screener, Assessment Scoring & UAR Migration (6–10 weeks)
- **Build `lib/implementationScorer.ts`** (Sherlock-based 4-dimension rubric) — *highest ROI new scoring work*
  - Reasoning & Decomposition (30%), Code Construction Process (30%), Adaptability (20%), Debugging & Maintenance (20%)
  - Wire into `/rpc/score-submission` via `ctx.waitUntil`
  - HITL gate + cost metering
  - Decompose into TechnicalDemonstration + WorkingStyle sub-elements
- Extend code review scoring to decompose transcript into candidate sub-elements
- Extend culture scoring to write CulturalSignal sub-elements
- **Screener Mode 1** (role-agnostic profile builder): generalize `cultureAgent.ts`, build `profile_probe_bank` (~100 probes), gap identification, coverage computation
- **UAR migration**: apply migration 0043, D1SessionStore, auth middleware
  - Build Mode 1 fresh on UAR culture plugin (no parity risk)
  - Build Mode 2 on UAR culture plugin, dual-path with legacy
  - UAR code review plugin, UAR role discovery plugin (30+ session parity before cutover)

### Phase 5 — Graph DB Migration (6–10 weeks)
- Self-hosted Neo4j Community on VPS (~€10–40/month)
- Schema: `:Candidate`, `:Role`, `:Repo` roots; sub-element nodes with type-specific labels; relationships `HAS`, `HAS_REQUIREMENT`, `HAS_DEALBREAKER`, `SUPERSEDES`, `EVIDENCED_BY`
- Dual-write from ingestion to both D1+Vectorize and Neo4j
- Shadow-read phase: compute both paths, log deviations
- Primary-read cutover with feature-flag fallback
- Retire dual-write; D1+Vectorize become read-only archives

### Phase 6 — Scoring Maturity & Validation (Ongoing)
- Kappa calibration study (Cohen's κ, Fleiss' κ) when volume permits
- Golden set regression testing (weekly) to detect Gemma drift
- Recruiter feedback loops → per-dimension calibration (~50 events/month threshold)
- Leniency metric on calibration dashboards
- Rubric lock milestones per CodeSignal model (Pilot → Tuned → Monitored → Revision)

---

## Files with Known Issues (Fix in Phase 0)

| File | Issue | Fix |
|------|-------|-----|
| `lib/roleDiscovery/evaluator.ts` | Broken imports, `tsc --noEmit` fails | **Delete** |
| `lib/roleDiscovery/evaluatorPrompt.ts` | Orphaned, no callers | **Delete** (salvage prompts to UAR if useful) |
| `routes/internal/evaluateDiscovery.ts` | Not registered in `index.ts` | **Delete** |
| `lib/agents/culture/plugin.ts` | Stub dimensions don't match live scorer | Update to 5 competency + 5 profile dimensions |
| `adminRepos.ts:698`, `:1136` | Skip `preprocessForEmbedding` | Normalize to shared preprocessing |
| `discover.ts:414` | Skip `preprocessForEmbedding` | Normalize to shared preprocessing |
| `matchRepos.ts` | Silent `skill.toLowerCase()` fallback | Remove silent fallback, add alerting |
| `orchestrate.ts` | Never passes vector signal params | Wire VECTOR_WEIGHTS population |
| `wrangler.jsonc` (staging) | D1/R2/Vectorize bindings commented out | Uncomment for isolated staging |

---

## Key Decisions from This Session

1. **Sequencing is non-negotiable:** Phase 0 (consumption) must complete before Phase 1 (decomposition). Phase 1–3 must complete before Phase 5 (Neo4j). Doing migration before decomposition multiplies work and defers quality improvements.

2. **Highest ROI single change:** Injecting structured JSON (`career_context_json`, `situation_signature_json`, `key_concepts_json`) into the candidate embedding narrative. Prompt-only change, no schema impact, materially improves matching quality.

3. **Highest ROI new build:** `lib/implementationScorer.ts` with Sherlock-based rubric. Unblocks the most expensive assessment moment (1–4 hours of candidate work) from depending on manual recruiter evaluation.

4. **UAR migration is consolidation, not urgency.** Legacy paths work. UAR earns its way in via parity checking. Role discovery UAR is lowest priority unless legacy path breaks.

5. **Screener Mode 1 (profile builder) should be built fresh on UAR** rather than migrating legacy culture interview. No parity-checking risk for new functionality.

6. **Deferred items (explicitly not doing now):** Multi-LLM ensemble scoring (3× cost), BGE fine-tuning (hand-curated adjacency covers 80%), early fusion joint embedding, learning-to-rank, adversarial debiasing, keystroke biometrics (parked), LinkedIn scraping (parked), real-time affect detection, KV cache compression.

---

## What Stays, What Moves, What Retires

### Stays on Cloudflare (always)
- API surface, auth, job orchestration, email, dev containers, voice sessions
- Transactional operational data: candidates, pipelines, stages, assessments, challenge_submissions, sessions, compliance audit trails
- R2 for resume blobs and media
- Workers AI for embedding generation + model routing

### Moves to Neo4j (graph-shaped data)
- Decomposed entity graph: candidate_nodes, role_nodes, repo_nodes
- Relationships and evidence attribution
- Match reports (can live in either; Cypher queries favor Neo4j)

### Retired (eventually, after cutover)
- Vectorize (once Neo4j vector indexes serve matching)
- Aggregate ground-truth embeddings (`embedding_json` columns) become redundant
- `persona_json` reads (after all consumers cut over to RCD)
- `lib/roleAgent.ts`, `lib/implementerAgent.ts`, `lib/cultureAgent.ts` (after UAR parity validated)

---

## Immediate Next Steps for Next Agent / Session

1. **Start Phase 0, step 1:** Cache `candidateSituationFit`. Simple key-value cache by `(candidate_id, repo_id, profile_version, signals_version)`.
2. **Parallel:** Rewrite `lib/candidateDiscovery/prompts.ts` to inject structured JSON into embedded narrative. Re-embed existing candidates.
3. **Parallel:** Add `embedding_model_version` column migrations to all 3 tables.
4. **Parallel:** Cut over `autoStageBuilder.ts` to RCD primary read.

All four are independent, low-risk, high-ROI changes that don't require schema redesign.

---

## Research Base Status

| Finding | Status | Where Applied |
|---------|--------|---------------|
| Sherlock AI framework | **Preserved** | Implementation scorer (Phase 4) |
| Core-O decomposition discipline | **Preserved** | Sub-element type taxonomy vocabulary |
| ESCO skill vocabulary | **Preserved** | Optional `esco_id` on Skill sub-elements |
| "Rubric Is All You Need" | **Preserved** | Validates BARS investment; Leniency metric added |
| CodeSignal phased calibration | **Preserved** | Rubric maturity path (Phase 6) |
| Cohen's / Fleiss' Kappa | **Preserved** | Supplementary to QWK (Phase 6) |
| Retry / circuit breakers / DLQ | **Preserved** | Reliability hardening (Phase 0) |
| OpenTelemetry gen_ai conventions | **Preserved** | Observability target (Phase 0) |
| Skill adjacency modeling | **Preserved** | Hand-curated table (Phase 0) |
| Fairness framework | **Preserved** | Compliance constraints throughout |
| Keystroke biometrics | **Parked** | GDPR Article 9 complexity > 1–8% EER gain |
| Multi-LLM ensemble scoring | **Deferred** | Single-scorer QWK adequate at stage |
| Adversarial debiasing | **Deferred** | Monitoring first |
| BGE fine-tuning | **Deferred** | Hand-curated covers 80% at 2% effort |
| Early fusion joint embedding | **Deferred** | Late fusion has headroom |
| Learning-to-rank | **Deferred** | Data infra now, model when volume justifies |

---

## Regulatory / Compliance Context

Existing architecture is already defensible:
- Dealbreakers never auto-fail (HITL flag only) — Griggs / EEOC / EU AI Act Art 14
- Culture question bank is finite, recruiter-approved, versioned — NYC Local Law 144
- HITL gates on all scoring surfaces — EU AI Act Art 14
- Compliance audit trail (`culture_compliance_audit`) with 7-year retention
- Dealbreaker records carry `job_relatedness_note` + `job_relatedness_strength`

**Still needed as platform scales:**
- Formal bias audit (NYC Local Law 144 annual requirement)
- Unified candidate AI-use disclosure UX
- Protected attribute collection with consent (for disparate impact monitoring)
- GDPR Article 22 compliance surface (human-makes-final-decision explanation)
- Data Subject Access Request tooling
- Right to erasure with retention exceptions

---

## Contact / Context

This handoff was generated from reading the full Pipe Strategy v2 document set (Parts 1–6) located in `/knowledge/plan/`. The synthesized execution plan prioritizes consuming existing signal before building new architecture. The user confirmed they wanted steps broken down per file, which was delivered in the conversation preceding this handoff.

**If picking this up:** Start with Phase 0 steps. They are independent, low-risk, and compound. Do not skip to decomposition or Neo4j before Phase 0 is validated.
