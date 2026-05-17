# Pipe Business Requirements

> **STATUS: CANONICAL** · Extracted from knowledge/STRATEGY.md (2026-04-08) and Decision Log (2026-04-08 through 2026-04-22)
> **SUPERSEDED_BY:** docs/plans/strategy-v2/ for execution planning; docs/decisions/current/ for architecture

---

## Five Success Criteria

The product wins when all five are true:

1. **Code review signal** — A hiring manager can run a code review assessment that produces a defensible signal on seniority and real engineering judgment, not algorithmic puzzle-solving.
2. **Culture QWK ≥ 0.60** — A culture interview agent can score behavioral responses with human-expert reliability (QWK ≥ 0.60) and produce explainable reports.
3. **Legal defensibility** — Both assessments are legally defensible (content validity, adverse-impact monitoring, EEOC/AIVIA/EU AI Act compliance).
4. **<5% inference cost** — Both run at less than 5% of revenue in inference costs.
5. **Autonomous calibration** — Both improve over time via autonomous calibration loops.

Every decision traces back to these five criteria.

---

## Calibration Philosophy

### The Arena (`research/code-review-arena/`)

- **Status:** Legacy reference. Last touched 2026-03-30. Best calibration: 76.5% (v19) at mistral-medium-latest.
- **Use for:** Fast scorer-only iteration, scoring formula/weight changes, baseline regression testing.
- **Do NOT use for:** End-to-end changes, implementer behavior changes, real scoring API changes.

### The `/calibrate` Skill

- **Status:** Go-forward system. "The app IS the harness."
- **Rule:** Claude Code NEVER acts as scoring or implementer agent. All scoring and implementer responses are done by Devstral, called by the Worker API. Claude Code's role is ONLY: play personas in Chrome, wait for real pipeline results, analyze calibration data, and tune prompts.

### Division of Labor

| Layer | Lives In | Managed By | Changes Tracked In |
|---|---|---|---|
| Scoring formula / weights | `workers/api/src/lib/scorerAgent.ts` + `scorerPrompts.ts` | `/calibrate` in production, arena for offline iteration | git + `data/experiments/runs.jsonl` |
| Scorer prompts (BARS, anchors) | `workers/api/src/lib/scorerPrompts.ts` | `/calibrate` (primary), arena (secondary) | git + `data/experiments/runs.jsonl` |
| Implementer prompts | `workers/api/src/lib/prompts.ts` | `/calibrate` in production | git + `data/experiments/runs.jsonl` |
| Reviewer persona strategies | `/calibrate` skill file itself | edit the skill file directly | git |
| Golden cases (PR library) | `research/code-review-arena/golden/prepared/cases.json` + Worker seed data | hand-authored, future: AIG pipeline | git |
| Consistency classifier | Not built yet | to be built per ADR-032 | git + new tests |

---

## Stage Type Lock

Five canonical stage types. All other types are dead.

| Type | Meaning |
|---|---|
| `SCREENING` | Automated screener |
| `CULTURAL` | AI behavioral interview only (FSM-driven, STAR format, BARS scoring) |
| `CODE_REVIEW` | Multi-turn review session only (full `review_sessions` flow) |
| `OPEN_SOURCE` | Open source contribution assessment |
| `LIVE_PANEL` | Live panel interview |

Eliminated: `AI_COLLAB`, `PLANNING`, `VOICE`, `INGESTION`, `TECHNICAL`, `QUESTIONS`.

Locked: 2026-04-22. See Decision Log entry below.

---

## Measurement Philosophy

**Criterion-referenced, not norm-referenced.** Different tests per candidate are desirable and psychometrically defensible. The scorecard answer is "does this candidate meet this role's criteria, as evidenced by a role-appropriate repo?" not "where does this candidate rank vs. other candidates on one scale?"

Precedents: OSCE multi-station design, NCLEX / USMLE / CPA licensure batteries, competency-based assessment, mastery testing.

Fairness concerns that survive the reframe:
- Time-limit scaling per item (2000-LOC PR gets more time than 200-LOC PR)
- Difficulty banding (match algorithm hard-filters repos outside role's seniority band)
- Disparate-impact audit (protected-class candidates must not systematically get harder repos)
- Purpose-conditional scorecard (tailored-to-role vs validate-experience have different interpretations)

Locked: 2026-04-18. See Decision Log entry below.

---

## Provider Lock-In

- **All Gemma usage → Vertex AI MaaS in production**, Workers AI binding as fallback.
- **Role-discovery consistency classifier → `@cf/qwen/qwen3-30b-a3b-fp8` on Workers AI.** Cross-family from Gemma (Alibaba Qwen ≠ Google Gemma per Panickssery 2024 independence requirement).
- **Culture scorer → Gemma 4 26B on Vertex AI** (11 calls/run; Workers AI free tier would exhaust at scale).

Locked: 2026-04-18. See Decision Log entry below.

---

## Human-Gated Vectorization

Pass 3 repo ingest is split into three endpoints:
- `/pass3/analyze` — Gemma summary + D1 persist, no Vectorize
- `/pass3/feedback` — admin verdict (`approved`/`denied`) + optional critique
- `/pass3/ingest` — BGE embed + `REPO_INDEX` upsert, gated on `admin_verdict='approved'`

Rationale: narrative quality is too variable for blind vectorization. Admin verdict becomes training data for future automation.

Locked: 2026-04-17. See Decision Log entry below.

---

## Decision Log

Append-only. Every override, deferral, or plan change is recorded here.

| Date | Decision | Rationale | Who |
|---|---|---|---|
| 2026-04-08 | Defer reactivity calibration study (CR-7) until first paying customer | Cost of 15-expert study not justified pre-revenue; hand-tuned YAML acceptable for MVP | Founder + Lead |
| 2026-04-08 | Defer IRT calibration (CR-32) and AutoIRT (CR-33) | Need n≥100/item traffic first; ship uncalibrated and tighten with volume | Founder + Lead |
| 2026-04-08 | Defer 8-station summative mode (CR-31) | MVP is 3 PRs; summative only matters for enterprise summative hiring decisions | Founder + Lead |
| 2026-04-08 | Lock text-only (no audio/video) as architectural decision | HireVue cautionary tale; text eliminates accent/speech bias vector | Founder + Research (BC-27) |
| 2026-04-08 | Culture scores framed as attitudinal predictors, never performance | P-O fit performance ρ=.15 is weak; legal defensibility | Founder + Research (BC-21) |
| 2026-04-08 | Arena is legacy reference, /calibrate is go-forward | Arena last touched 2026-03-30 at 76.5%; /calibrate uses real Worker pipeline | Founder |
| 2026-04-09 | Add Challenge Authoring System as third research pillar (CA-*) | Research brief with 90 sources across AI generation, template architecture, UX/competitive. ADR-034. Supersedes ADR-004. | Founder + Lead |
| 2026-04-09 | Supersede ADR-004 (static TypeScript challenge library) with ADR-034 | Hardcoded TS library doesn't scale; need D1-backed templates with versioning, packs, and AI generation | Founder + Lead |
| 2026-04-09 | CR-13/CR-14: Replace generic "scrape" with role-matched repo discovery pipeline | Research brief (76 sources): Libraries.io dependent_repositories for dependency-first discovery, specfy/stack-analyser for tech stack detection, scc/lizard for seniority-complexity matching | Founder + Lead |
| 2026-04-10 | Flag drift: Role Discovery → downstream consumers (RD-1 through RD-22) | Research source: migration/dersign-thinking.md:355 Part 8 specifies Knowledge State JSON as canonical artifact. ADR-027 preserved this; ADR-028 introduced CandidatePersona as cached summary, but cached summary became canonical by default. Flagged per ADR-033 guardrail. Resolution: ADR-036. | Founder + Claude |
| 2026-04-10 | Flag drift: Repo library has no AI reasoning layer (RD-23, RD-24) | Crawler Pass 1 + Pass 2 are deterministic (zero LLM calls). matchRepos.ts is SQL-only CTE join. No reasoning layer reads repo_sample_prs + constructs + stack with a role in mind. Resolution: ADR-036 Repo Understanding Contract — crawler Pass 3 (offline Haiku) + runtime Worker role-fit rerank (Gemma). | Founder + Claude |
| 2026-04-10 | Research complete: Role Discovery + Repo Understanding Data Contract (RD-1 through RD-24) | 4 parallel researchers, 84 cited sources, PASS WITH NOTES verdict. Final brief at knowledge/outputs/role-discovery-data-contract.md. ADR-036 drafted. | Founder + Claude |
| 2026-04-11 | Path B complete: Phase 3 (code-review consumers) + Phase 4 (repo understanding) landed | Closes RD-17, RD-18, RD-19, RD-23, RD-24 end-to-end. Seven commits on feat/cloudflare-migration. Scorer model switched off Qwen family to Gemma 4 26B to satisfy ADR-032 independence rule. | Founder + Claude |
| 2026-04-11 | ADR-037 code-complete: Dev Containers on Cloudflare (Phase 3b) | Full implementation of Cloudflare Containers replacing AWS ECS Fargate. 48 tests pass. E2E tests written. Blocked on deployment: R2 not enabled on Cloudflare account. | Founder + Claude |
| 2026-04-14 | Architectural decision: candidate-facing app will be server-side rendered (SSR) | Security boundary. With CSR the Worker must send challenge data (including planted bug metadata, scoring rubrics, correct answers) to the browser. SSR renders HTML server-side — only rendered output reaches browser. Candidate experience: separate Cloudflare Pages deployment (interview.pipe.com) using React Router v7. Recruiter app (app.pipe.com) remains CSR. Deferred to post-MVP. | Founder |
| 2026-04-14 | Override: Repo matching extensions beyond RUC §2.3 (signals_version v2.0.0) | Extends canonical Repo Understanding Contract to solve library/plugin contamination and no semantic bridge between free-form RCD prose and repo signals. Additions: architecture_style='library' enum, test_style enum, Vectorize binding as PARALLEL recall path (not replacement), repo_searchable_profile, business_logic_ratio, cross_module_change_rate, challenge_surfaces. | Founder |
| 2026-04-15 | RD-P6: Issue Ingestion Pipeline for CODE_IMPLEMENTATION challenges | Crawler fetches PRs (CODE_REVIEW) but not issues. Architecture: repo_issues table (raw snapshot) + issue_challenge_signals table (AI-scored dimensions) + weekly Cloudflare Cron Worker + runtime issueStateVerifier.ts. | Founder + Claude |
| 2026-04-17 | Research complete: Role Discovery Agent Guardrails (RD-49 through RD-60) | 4 parallel Sonnet researchers, 98 cited sources, PASS WITH NOTES (0 FATAL, 6 MAJOR, 6 MINOR). Five design artifacts delivered: schema extension, 4-tier sensitivity ladder, depth-tracking, cross-family classifier, bad-robot feedback loop. ADR-038 drafted. | Founder + Claude |
| 2026-04-17 | Correction: Role Discovery provider + classifier model | Role-discovery primary runs gemma-4-26b-a4b-it on Vertex AI MaaS (not Workers AI). Classifier: @cf/qwen/qwen3-30b-a3b-fp8 on Workers AI (cross-family from Gemma). | Founder + Claude |
| 2026-04-17 | Human-gated vectorization for Pass 3 repo ingest | Splits one-shot POST /admin/repos/:id/pass3 into three endpoints: /pass3/analyze, /pass3/feedback, /pass3/ingest. Admin verdict gates vectorization. Rationale: narrative quality too variable for blind vectorization. | Founder + Claude |
| 2026-04-18 | Measurement philosophy: criterion-referenced (personalized items are a feature, not a bug) | Founder explicit position: different tests per candidate is desirable under criterion-referenced paradigm. Reframe (not un-defer) of CR-32/CR-33: calibration attaches to template packs and BARS dimensions, not individual items. | Founder |
| 2026-04-18 | EXPLORATORY DIRECTION: Bi-directional vectorization + repo-personalized 3-station interview trajectory | Extends repo-side vectorization to symmetric three-entity schema (repo, role, candidate all in one vector space). Three-way cosine match. New interview trajectory: Code Review → ADR Review → Code Implementation, all anchored on same repo. PROPOSED, not locked. | Founder |
| 2026-04-18 | Provider + classifier lock-in: all Gemma → Vertex AI, RD classifier = Qwen3-30b-a3b-fp8 on Workers AI | All Gemma usage runs on Vertex AI MaaS in production, Workers AI binding as fallback. Covers role discovery, culture interview agent, culture scorer, issue scorer cron, production code-review scorer, planned consistency classifier. | Founder + Claude |
| 2026-04-19 | Research complete: Repo-personalized interview config (PASS WITH NOTES) — ADR-039 unblocked | Synthesis brief landed. Five locked decisions: asymmetric reframe (role-fit primary, candidate-fit completion-rate floor), four orthogonal config axes, summative-use gate (N≥100 per role + G≥0.70), five guardrails (3 BLOCK, 2 WARN), dual-home schema. | Founder + Claude |
| 2026-04-19 | ADR-039 v1 slice shipped: Match-Config Wizard + auto-build to 2-station pipeline | Migration 0037, guardrails.ts, autoStageBuilder.ts, POST /api/v1/pipelines/auto-build, MatchConfigWizard component. | Founder + Claude |
| 2026-04-21 | Override: ADR-039 Implementation sequencing — build Candidate Discovery agent + per-candidate match now (skip deferral) | Compresses items (2), (3), and reduced form of (5) into one work stream now. Per-candidate repo matching becomes first-class, fires on resume upload only. New surfaces: candidate_ingestion table, candidate_challenge_assignment table, Candidate Discovery agent, CANDIDATE_INDEX Vectorize binding. | Founder |
| 2026-04-22 | Dual-layer embedding architecture + unified search endpoints | D1 stores embedding_json as ground truth; Vectorize remains fast ANN layer. Search endpoints: POST /api/v1/search/candidates and POST /api/v1/search/repos. | Founder + Claude |
| 2026-04-22 | Lock stage types to 5: SCREENING, CULTURAL, CODE_REVIEW, OPEN_SOURCE, LIVE_PANEL | Eliminate confusion from 3 incompatible type systems. Remove dead types (AI_COLLAB, PLANNING, VOICE, INGESTION, TECHNICAL, QUESTIONS). | Founder |
| 2026-04-22 | CULTURAL stage = AI behavioral interview only | Challenge-based fallback was accidental complexity. Culture is distinct agentic experience. | Founder |
| 2026-04-22 | CODE_REVIEW stage = multi-turn review session only | Challenge-type CODE_REVIEW still exists for single PR diff inside other stages, but a CODE_REVIEW stage runs full review_sessions flow. | Founder |
| 2026-04-22 | Dev containers = Phase 4, not Phase 2 | Infrastructure exists but candidate flow does not. Code review must be perfect first. | Founder |
| 2026-04-22 | Research drives roadmap, not retroactive justification | ADR-033 guardrail. Every claim on marketing site must be citeable. No feature gets built and then justified with research after the fact. | Founder |
| 2026-04-22 | Simple UI first, advanced panel second | 3 toggles per stage (mode, video, follow-up). Advanced config hidden behind collapsible. | Founder |
