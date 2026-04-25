# Pipe — Master Task Tracker

**Source of truth:** `knowledge/plan/pipe-strategy-v2-part*-north-star.md` (6-part strategy)
**Last updated:** 2026-04-25
**Status tags:** [NOT_STARTED] | [IN_PROGRESS] | [BLOCKED] | [DONE] | [DEPRECATED]

---

## How to use this

1. **Pick a task** from the active phases below
2. **Assign owner** (Frontend / Backend / Architect / Designer / Orchestrator)
3. **Move to [IN_PROGRESS]** when work begins
4. **Update acceptance criteria** as scope clarifies
5. **Mark [DONE]** when typecheck passes and PR is merged

**Contradictions found?** Document in `contradictions.md` before overriding.

---

## Phase 0 — Consumption Cutover & Production Hygiene (Weeks 1–6)

**Goal:** Finish what exists. Consume existing signal. No new infrastructure.

| # | Task | Owner | Status | Acceptance Criteria | Notes |
|---|---|---|---|---|---|
| 0.1 | Get RCD consumers off `persona_json` | Backend | [NOT_STARTED] | `autoStageBuilder.ts`, `repoDiscovery/discover.ts`, cockpit routes read RCD primary, `persona_json` fallback only | 5 consumers identified in Part 2 |
| 0.2 | Wire vector signal slots in triangulation | Backend | [NOT_STARTED] | `orchestrate.ts` passes `vector_role_repo`, `vector_role_cand`, `vector_cand_repo` to `triangulateMatch`; `match_feedback` table has columns for them | Currently `VECTOR_WEIGHTS` preset is unreachable |
| 0.3 | Store RCD narrative in ROLE_INDEX | Backend | [NOT_STARTED] | `buildRcdSearchProfile` output is embedded and stored in ROLE_INDEX, not just used as query text into REPO_INDEX | Role-candidate cosine currently thin-to-thin |
| 0.4 | Wire dealbreaker gate enforcement | Backend | [NOT_STARTED] | Dealbreakers with `job_relatedness_strength='strong'` auto-fail matches before assessment scheduling; `moderate` flags for HITL; `weak` is advisory | Currently only `cultureScorer.ts` reads dealbreakers, advisory-only |
| 0.5 | Fix broken evaluator imports OR delete dead code | Backend | [IN_PROGRESS] | Either: (a) define `CandidateQuestion`, `DomainCoverage`, `EvalResult`, `RoleExchange` in `types.ts`, or (b) remove `evaluator.ts`, `evaluatorPrompt.ts`, `routes/internal/evaluateDiscovery.ts` | `tsc --noEmit` must pass |
| 0.6 | Add embedding model version stamps | Backend | [NOT_STARTED] | Every table with `embedding_json` gets `embedding_model_version` column; all write sites populate it | Currently no way to detect stale vectors on BGE swap |
| 0.7 | Normalize 3 bypass `preprocessForEmbedding` call sites | Backend | [NOT_STARTED] | `adminRepos.ts:698`, `adminRepos.ts:1136`, `discover.ts:414` all use `preprocessForEmbedding` consistently | Inconsistent preprocessing creates vector drift |
| 0.8 | Add `skill_aliases` unknown-slug alerting | Backend | [NOT_STARTED] | Failed alias lookup emits `console.error` or writes to an `alias_failure_log` table; does NOT silently fall back to `.toLowerCase()` | Currently "Node.js" → "node.js" fails silently, zero matches |
| 0.9 | Ungate Pass 3 vectorize via confidence thresholds | Backend | [NOT_STARTED] | Auto-approve Pass 3 output when `architecture_style` ≠ `unknown` AND `challenge_surfaces` length ≥ 3 AND `engineering_narrative` length ≥ 100; human verdict only for edge cases | Currently 1000s of repos stuck at pass=2 |
| 0.10 | Cache `candidateSituationFit` | Backend | [NOT_STARTED] | Deduplicate by `candidate_id + repo_id`; cache hit returns cached score, no redundant Gemma calls | Every ingestion pays full Gemma cost |

**Phase 0 blockers:** None yet. All tasks are independent and can run in parallel.

---

## Phase 1 — Candidate Decomposition (Weeks 7–14)

**Goal:** Rewrite candidate ingestion to produce structured sub-elements rather than flat narrative.

| # | Task | Owner | Status | Acceptance Criteria | Notes |
|---|---|---|---|---|---|
| 1.1 | Design candidate sub-element taxonomy | Architect | [NOT_STARTED] | Define types: Experience, Project, Accomplishment, Skill, Credential, CulturalSignal, TechnicalDemonstration, CommunicationStyle | ESCO vocabulary for Skill nodes |
| 1.2 | Create `candidate_nodes` table schema | Backend | [NOT_STARTED] | Per-sub-element rows with `candidate_id`, `node_type`, `narrative`, `embedding`, `provenance`, `confidence`, `created_at`, `superseded_by` | D1 table, ADR required |
| 1.3 | Rewrite `candidateDiscovery/prompts.ts` for structured output | Backend | [NOT_STARTED] | LLM produces JSON array of sub-elements instead of flat `candidate_searchable_profile` prose | Keep `candidate_searchable_profile` as aggregate during transition |
| 1.4 | Build ingestion pipeline for sub-elements | Backend | [NOT_STARTED] | Resume parse → seed nodes; enrichment → additional nodes; screening → additional nodes; assessment → additional nodes | Each source tags its provenance |
| 1.5 | Backfill existing candidates | Backend | [NOT_STARTED] | Run new extraction against all existing `candidate_searchable_profile` rows; populate `candidate_nodes`; verify no data loss | Batch job, monitor for failures |
| 1.6 | Update matching to read `candidate_nodes` | Backend | [NOT_STARTED] | `matchRepos` and triangulation query sub-elements instead of flat profile | Fallback to flat profile if no nodes exist |

---

## Phase 2 — Role & Repo Decomposition (Weeks 15–20)

**Goal:** Expose RCD and Pass-3 structural depth as addressable sub-elements.

| # | Task | Owner | Status | Acceptance Criteria | Notes |
|---|---|---|---|---|---|
| 2.1 | Design role sub-element taxonomy | Architect | [NOT_STARTED] | Requirement, Responsibility, CulturalSignal, TeamContext, Dealbreaker, TechnicalContext, CodebaseExpectation | RCD already has the depth; expose it |
| 2.2 | Create `role_nodes` table schema | Backend | [NOT_STARTED] | Per-sub-element rows from RCD; link to `role_contexts` via `role_context_id` | |
| 2.3 | Design repo sub-element taxonomy | Architect | [NOT_STARTED] | Feature, ArchitecturalPattern, TechnicalStack, ChallengeSurface, QualitySignal, DomainContext | Decompose Pass-3 labeled template |
| 2.4 | Create `repo_nodes` table schema | Backend | [NOT_STARTED] | Per-sub-element rows from Pass-3; link to `qualified_repos` via `repo_id` | |
| 2.5 | Rewrite Pass-3 output for decomposition | Backend | [NOT_STARTED] | Gemma produces structured sub-elements with separate embeddings instead of concatenated narrative | Cost: one call per repo → one call per repo (same) |
| 2.6 | Backfill existing roles and repos | Backend | [NOT_STARTED] | Run decomposition against all existing RCDs and Pass-3 outputs; populate `role_nodes` and `repo_nodes` | |

---

## Phase 3 — Per-Element Matching Rewrite (Weeks 21–26)

**Goal:** Matching operates on sub-elements; match reports are primary output.

| # | Task | Owner | Status | Acceptance Criteria | Notes |
|---|---|---|---|---|---|
| 3.1 | Implement candidate shortlisting | Backend | [NOT_STARTED] | Per-Requirement query to CANDIDATE_INDEX; union of candidate_ids; apply structured filters (senity ±1, dealbreakers) | Top-K per requirement, not top-50 single vector |
| 3.2 | Implement per-requirement evidence gathering | Backend | [NOT_STARTED] | For each candidate-role pair, for each Requirement, find top-N matching sub-elements with similarity, provenance, narrative | N=3 default |
| 3.3 | Implement per-dimension aggregation | Backend | [NOT_STARTED] | Technical, Domain, Cultural, Experience, Contextual dimensions; `avg(sim) * log(1 + n)` with count bonus | |
| 3.4 | Implement dealbreaker gates | Backend | [NOT_STARTED] | Strict threshold 0.75; `strong` auto-fail, `moderate` HITL flag, `weak` advisory | Currently missing |
| 3.5 | Implement match report generation | Backend | [NOT_STARTED] | Structured `MatchReport` with `dimension_scores`, `requirement_matches`, `dealbreaker_fails`, `evidence_attribution` | Auditable, defensible |
| 3.6 | Wire match report into recruiter UI | Frontend | [NOT_STARTED] | New page or modal showing per-candidate per-role match report with evidence | Replaces opaque score |
| 3.7 | Retire `triangulateMatch` or convert to summary layer | Backend | [NOT_STARTED] | Four signals computed from per-dimension scores, not independent queries | Maintain backward compat for dashboard |

---

## Phase 4 — Screener Consolidation & UAR Migration (Weeks 27–36)

**Goal:** Behavioral interview becomes automated screener; UAR plugins go from mock to real.

| # | Task | Owner | Status | Acceptance Criteria | Notes |
|---|---|---|---|---|---|
| 4.1 | Extend culture interview for dual-mode | Backend | [NOT_STARTED] | Same FSM runs: (a) loose pre-match profile-building, (b) role-specific post-match culture fit | Phase 0.55 in original plan |
| 4.2 | Implement screener termination conditions | Backend | [NOT_STARTED] | Coverage-complete, turn-budget-exhausted, or candidate-disengaged | 20 question hard cap |
| 4.3 | Build UAR culture plugin | Backend | [NOT_STARTED] | Replace bespoke culture path with UAR plugin; preserve all existing behavior | Fresh build cleaner than migration |
| 4.4 | Build UAR code review plugin | Backend | [NOT_STARTED] | Replace legacy implementer agent with UAR plugin; preserve ADR-032 scoring | Migrate after culture |
| 4.5 | Build UAR role discovery plugin | Backend | [NOT_STARTED] | Replace `lib/roleAgent.ts` with UAR plugin; preserve 8-probe structure | Migrate last |
| 4.6 | Implement CODE_IMPLEMENTATION scorer | Backend | [NOT_STARTED] | Sherlock rubric (Reasoning & Decomposition, Code Construction, Adaptability, Debugging) with BARS anchors | Currently score is always null |
| 4.7 | Implement QUIZ_SHORT_ANSWER scorer | Backend | [NOT_STARTED] | LLM-based scoring for short-answer quiz submissions | Currently score is always null |

---

## Phase 5 — Graph DB Migration (Weeks 37–46)

**Goal:** Neo4j Community Edition as primary graph store; D1+Vectorize as legacy fallback.

| # | Task | Owner | Status | Acceptance Criteria | Notes |
|---|---|---|---|---|---|
| 5.1 | Provision Neo4j VPS | Backend | [NOT_STARTED] | Self-hosted Community Edition; HTTPS access from Cloudflare Workers; €25–50/month | |
| 5.2 | Define Cypher schema | Architect | [NOT_STARTED] | Node labels, relationship types, property indexes, vector indexes | Native Cypher + vector similarity |
| 5.3 | Build dual-write ingestion | Backend | [NOT_STARTED] | Every write goes to both D1 and Neo4j; read from Neo4j, fallback to D1 | Validate parity before cutover |
| 5.4 | Port matching queries to Cypher | Backend | [NOT_STARTED] | Per-element matching expressed as Cypher; combine structural traversal + vector similarity | Single-query per requirement |
| 5.5 | Validate matching parity | Backend | [NOT_STARTED] | Run both paths for 30 days; compare results; deviation >5% triggers investigation | |
| 5.6 | Cut over matching reads | Backend | [NOT_STARTED] | Switch `matchRepos` and triangulation to read from Neo4j | D1 stays for legacy consumers |
| 5.7 | Deprecate Vectorize | Backend | [NOT_STARTED] | Stop writing to Vectorize; keep for audit trail | Not urgent, can linger |

---

## Phase 6 — Scoring Maturity (Ongoing)

| # | Task | Owner | Status | Acceptance Criteria | Notes |
|---|---|---|---|---|---|
| 6.1 | Kappa calibration study | Orchestrator | [NOT_STARTED] | Cohen's κ for single-rater, Fleiss' κ for multi-rater; track against QWK ≥ 0.60 target | |
| 6.2 | Golden set regression testing | Backend | [NOT_STARTED] | Fixed set of scored submissions; re-run on every scorer change; detect drift | |
| 6.3 | Recruiter feedback loops | Backend | [NOT_STARTED] | Per-dimension calibration from recruiter thumbs up/down on match reports | |
| 6.4 | Hiring outcome tracking | Backend | [NOT_STARTED] | Where permitted by candidates/employers, track hire/no-hire and correlate with scores | |
| 6.5 | Add OpenTelemetry gen_ai conventions | Backend | [NOT_STARTED] | Structured observability for LLM calls, not just `console.error` tailing | Deferred from original strategy |

---

## Cross-Cutting Concerns

| # | Task | Owner | Status | Notes |
|---|---|---|---|---|---|
| CC.1 | Add retry-with-exponential-backoff to LLM calls | Backend | [NOT_STARTED] | Currently no transient failure shielding |
| CC.2 | Add circuit breakers per provider | Backend | [NOT_STARTED] | Vertex AI 429: 2s/4s/8s/16s/32s; Workers AI 3050: 30s fixed |
| CC.3 | Add idempotency keys to pipeline operations | Backend | [NOT_STARTED] | Prevent duplicate candidate creation, duplicate scoring |
| CC.4 | Hierarchical summarization for multi-turn transcripts | Backend | [NOT_STARTED] | For long culture interviews and code reviews |
| CC.5 | Fairness framework implementation | Architect | [NOT_STARTED] | Conditional statistical parity, equal opportunity, equalized odds |
| CC.6 | Skill adjacency table | Backend | [NOT_STARTED] | Hand-curated ~50 framework groupings with graded weights |

---

## Deprecation / Parked

| # | Task | Reason | Status |
|---|---|---|---|
| D.1 | Keystroke biometrics | GDPR Article 9 complexity > 1–8% EER gain | [PARK] |
| D.2 | Adversarial debiasing | Monitoring first, constraint optimization later | [PARK] |
| D.3 | Multi-LLM ensemble scoring | 3× cost unjustified at current stage | [PARK] |
| D.4 | Real-time affect detection | Validate static version first; bias risk | [PARK] |
| D.5 | KV cache compression | Gated on Workers AI exposing it | [PARK] |
| D.6 | BGE fine-tuning | Hand-curated adjacency covers 80% at 2% effort | [PARK] |
| D.7 | Early fusion joint embedding | Late fusion has plenty of headroom | [PARK] |
| D.8 | Learning-to-rank (BPR, LambdaMART) | Data infrastructure now, model training later | [PARK] |

---

## Task Count Summary

| Phase | Tasks | Status |
|---|---|---|
| Phase 0 | 10 | All [NOT_STARTED] |
| Phase 1 | 6 | All [NOT_STARTED] |
| Phase 2 | 6 | All [NOT_STARTED] |
| Phase 3 | 7 | All [NOT_STARTED] |
| Phase 4 | 7 | All [NOT_STARTED] |
| Phase 5 | 7 | All [NOT_STARTED] |
| Phase 6 | 5 | All [NOT_STARTED] |
| Cross-Cutting | 6 | All [NOT_STARTED] |
| **Total Active** | **47** | |
| Parked | 8 | [PARK] |

---

## Next Action

Pick Phase 0.1–0.10. They are independent, bounded, and consume existing signal without building new infrastructure. Start with 0.5 (fix broken evaluator) as a quick win, or 0.1 (RCD consumer cutover) as the highest-impact.
