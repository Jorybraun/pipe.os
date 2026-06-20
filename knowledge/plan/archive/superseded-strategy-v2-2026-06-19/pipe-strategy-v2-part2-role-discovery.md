# Pipe Strategy v2 — Part 2: Role Discovery Pipeline
*The existing RCD production path, decomposition design, and UAR migration.*

---

## What role discovery is, and why its quality bounds everything

Role discovery is the subsystem that turns a hiring team's messy, stakeholder-divergent, implicit understanding of what they need into a structured artifact that matching and scoring can operate on. The artifact is the **Role Context Document (RCD)** — a synthesis of a multi-stakeholder design-thinking interview across six domains (why, work, team, bar, codebase, process), capturing laddering chains, per-stakeholder perspectives, conflicts, dealbreakers with job-relatedness notes, BARS anchor overrides calibrated to the specific team, and dispositional weights that shape downstream agent behavior.

The quality of everything downstream is bounded by the quality of the RCD. If the RCD captures the team's intent faithfully, matching has a rich target to align candidates against, scoring has calibrated rubrics, the implementer agent has persona direction, and the culture interview has role-specific BARS overrides. If the RCD is thin or drifts from the team's actual intent, no amount of downstream sophistication recovers the loss. This is why role discovery gets its own document even though the entity is often treated as a derivative of the candidate flow in hiring products.

Pipe's RCD is **already richer than what most hiring platforms capture**. This is a competitive asset. The work ahead is not rebuilding it — it's exposing the richness structurally so the rest of the system can actually consume it.

---

## Current production path

The live role discovery flow runs entirely on legacy code that predates the Unified Agent Runtime. It works, it produces good RCDs, and it is not what the ADR-034 migration plan calls for long-term. Both facts matter.

**The entry point** is `POST /api/v1/role-contexts/:id/respond`, handled by `routes/discovery/roleContexts.ts` under Clerk authentication. A recruiter creates a pipeline and initiates a role discovery interview; participants (hiring manager, team member, internal recruiter, optionally others) are invited via token-linked URLs that carry participant JWTs. Each participant runs their own interview track, and the system eventually synthesizes across all tracks into a unified RCD.

**The agent** is `lib/roleAgent.ts` with prompts in `lib/roleAgentPrompts.ts`. It is not FSM-driven. It is turn-based with eight deterministic probes (six calibrated for the six domains plus two personality-reveal probes), emits exactly two candidate questions per turn (q-Na, q-Nb), uses a ReAct pattern with required `<thinking>` blocks, and tracks `domainCoverage` across the six domains. At budget exhaustion, the output switches to a synthesis shape that produces the legacy `CandidatePersona`. The agent uses `createRoleAgentProvider`, which routes to Vertex AI Gemma by default and falls back to Workers AI Gemma when configured, matching the dual-provider pattern used across Pipe's LLM call sites.

**The synthesis** runs in `lib/roleAgent/synthesizeRcd.ts`. It takes the per-participant transcripts, the emitted persona fragments, and the accumulated `knowledge_state`, and produces a full `RoleContextDocument`. The RCD is persisted to `role_contexts.rcd_json`, and a derived `consumer_slice` (which carries the legacy `CandidatePersona` shape) is also computed so that downstream consumers who haven't cut over to RCD can keep reading the legacy shape.

**The persistence surface** is the `role_contexts` table, which holds `baseline` (initial seed from the recruiter), `knowledge_state` (the 6-domain scratchpad merged per turn), `exchanges` (per-participant turn history), `rcd_json` (canonical synthesis artifact), `persona_json` (legacy), `job_description_md` (optional JD input), `recruitment_brief_json` (optional structured brief), `bars_overrides`, `role_searchable_profile`, and `embedding_json` (the ADR-040 ground-truth vector). Related tables: `role_context_participants` (one row per stakeholder with `invite_token`, `is_creator`, `exchanges`, `status`), `role_probe_bank` (per-role enriched probes with `source='rcd_enriched'` and `rcd_version` stamp).

**Validation** at the route boundary uses Zod schemas in `validation/roleContexts.ts` (baseline, create, respond, calibrate, invite). These are actively used and correct.

The production path works. Recruiters can complete multi-stakeholder discovery interviews, the synthesis produces rich RCDs with conflict records and dealbreakers, and the resulting `rcd_json` is the most structurally sophisticated role artifact in the platform. The issues are downstream: consumption cutover, structural flattening at the matching boundary, and the UAR migration that hasn't happened.

---

## The RCD schema, anchored

The `RoleContextDocument` is defined in `workers/api/src/types.ts:546-566`. Its shape is worth anchoring here because everything in the decomposition plan descends from it.

**Core fields:**

- `rcd_version`, `role_context_id`, `pipeline_id`, `created_at` — identity and versioning
- `domain_matrix: DomainMatrix` — the heart of the RCD. A structured matrix of up to 6 domains × up to 4 stakeholder types (hiring manager, team member, internal recruiter, optional others), where each cell (`DomainCell`) captures laddering chains, open codes, axial links, stories, coverage level, and a cell-level summary
- `conflicts: ConflictRecord[]` — explicit multi-stakeholder disagreements with evidence quotes, resolution notes, and provenance. Captures cases like "hiring manager rates SQL optimization 'nice to have'; team member rates 'CRITICAL'" without averaging them away.
- `technical_context: TechnicalContext` — stack, constructs, seniority_band, codebase_expectations, dispositional_weights. This is what the matching layer and the implementer agent both consume.
- `team_culture_profile: TeamCultureProfile` — per-stakeholder Competing Values Framework affinities (clan, adhocracy, market, hierarchy) and psychological_safety scores
- `bars_overrides: BarsOverride[]` — team-specific BARS anchor text that overrides the universal rubric when scoring assessments. If a team cares more about collaboration than code purity, the anchors shift.
- `probe_bank_enrichment: ProbeEnrichment` — role-specific probes that get added to the culture interview's question bank, persisted to `role_probe_bank` with the RCD version stamp
- `dealbreakers: DealbreakerRecord[]` — structured dealbreakers with `job_relatedness_note`, `job_relatedness_strength`, `evidence_quote`, and `source_stakeholder`. These are the gating signals the scoring layer should enforce but doesn't yet.
- `red_flags: RedFlagRecord[]` — soft warning signals with severity and stakeholder attribution
- `consumer_slice: CachedPersona` — the legacy `CandidatePersona` shape (seniority, archetype, mustHaveSkills, niceToHaveSkills, disposition, careerSignal, redFlags, dealbreakers) derived from the RCD for consumers that haven't cut over
- `validation_metadata` — synthesis-time quality indicators

**Supporting types** live in the same file: `DomainCell`, `DomainMatrix`, `ConflictRecord`, `DealbreakerRecord`, `RedFlagRecord`, `TeamCultureProfile`, `BarsOverride`, `TechnicalContext`, `ValidationMetadata`. The `DomainCell` is the atomic unit — it holds the laddering chains (attribute → consequence → value triples with source quotes and stakeholder attribution), which are the most structurally valuable content in the whole RCD.

`KnowledgeState` is intentionally untyped as `Record<string, Record<string, unknown>>` persisted to `role_contexts.knowledge_state`. It's merged every turn by `mergeKnowledgeState()` at `lib/roleAgent.ts:719`, carries `_coverage` and `_phase` metadata, and is alive in the interview loop. No downstream scorer or matcher reads it. This is deliberate for the interview loop — it needs flexibility — but means `knowledge_state` is not a target for matching consumption.

---

## What's consuming the RCD today (and what's not)

The consumer cutover is incomplete, and this is a primary source of matching quality loss. A consumer-by-consumer snapshot:

| Consumer | Reads | Path | Status |
|---|---|---|---|
| `cultureRoleResolution.ts` | **RCD primary**, persona fallback | `lib/cultureRoleResolution.ts:89-132` | ✓ Cut over |
| `autoStageBuilder.ts` | `persona_json` only | `lib/match/autoStageBuilder.ts:109-121` | ✗ Legacy |
| `repoDiscovery/discover.ts` | `mustHaveSkills`, `niceToHaveSkills`, `seniority` | `lib/repoDiscovery/discover.ts:65-88` | ✗ Legacy |
| Cockpit routes | `persona_json` | `routes/cockpit/agent.ts:55-58`, `repoDiscovery.ts:73-75` | ✗ Legacy |
| Scorer agents | `dispositional_weights` scalar only | `lib/scorerAgent.ts:67` | ✗ Partial |

Only `cultureRoleResolution.ts` is fully reading the RCD. Everything else is pulling from the legacy `persona_json` or reading a narrow slice of the RCD (just `dispositional_weights` in the scorer case). This means the rich domain matrix, the per-stakeholder perspectives, the conflicts, the dealbreakers, the BARS overrides, and the technical context are largely invisible to matching.

The flattening is worst at the matching boundary. `buildRoleSearchableProfile` — the function that generates the text stored in ROLE_INDEX — takes `job_description_md` if it's ≥200 characters and strips markdown headings from it; if JD is thin, it synthesizes sparse text from `persona.seniority + archetype + mustHaveSkills + niceToHaveSkills`. The rich RCD narrative is not stored. `buildRcdSearchProfile`, which produces a richer 400–600 word narrative incorporating technical_context, domain matrix summaries (dedup'd, limited to 8), top-3 STAR stories, and BARS override anchor text, is only used as **query text** when searching REPO_INDEX. It never goes into ROLE_INDEX. This means `role_candidate_cosine` in triangulation compares thin candidate prose against JD-thin role prose, not against the structural RCD depth.

Dealbreakers carry `job_relatedness_note`, `evidence_quote`, `source_stakeholder`, and `jobRelatednessStrength`. They are **advisory-only**. `cultureScorer.ts:424` runs a case-insensitive substring match against responses and raises `hitlReviewRequired: true` when a pattern matches, but never auto-fails. This is legally correct (Griggs, EEOC, NYC Local Law 144, EU AI Act Art 14), but it's also incomplete — the matching layer should be able to use dealbreakers as gates before assessments are even scheduled, not just flag them after culture scoring runs. A candidate whose resume or screener clearly contradicts a must-have dealbreaker shouldn't be routed into a technical assessment at all.

BARS overrides are captured in the RCD and persisted to `bars_overrides` on the role context. The code review scorer reads them via the `dispositional_weights` scalar, which shifts dimension weights ±50% clamped to [0.5, 1.5]. This is a narrow consumption — the actual BARS anchor text overrides aren't being read by the scorer yet, only the weight shifts.

---

## Scaffolded role-discovery code and its status

Between the legacy production path and the UAR target, there is a set of role-discovery code on the current branch that's neither fully production nor fully integrated. Each piece needs a disposition:

**`lib/roleDiscovery/evaluator.ts` + `evaluatorPrompt.ts`** — an eval-gated question pipeline. **Compile-broken.** Imports `CandidateQuestion`, `DomainCoverage`, `EvalResult`, `RoleExchange` from `types.ts` but none of those are defined there. `tsc --noEmit` will fail. `evaluateQuestion` has no callers. This is unstaged WIP that either needs the missing types added and wired in or needs to be deleted. Decision deferred to Phase 0 triage.

**`routes/internal/evaluateDiscovery.ts`** — a shared-secret (`X-Evaluate-Discovery-Token`) transcript evaluator running Qwen3-30b. **Not registered in `index.ts`.** Dead code. Either wire it or delete it. My recommendation: delete. The cross-family consistency guard (Gemma guarding Qwen, Qwen guarding Gemma per Panickssery 2024) is a valid pattern, but the implementation here is disconnected from the live pipeline and the evaluator work should happen inside the UAR plugin's `EvalGate` rather than as a separate internal route.

**`validation/roleContexts.ts`** — Zod schemas, actively used by the live route. Keep.

---

## The decomposition design for roles

The goal: turn the rich RCD from a single JSON blob in `role_contexts.rcd_json` into a set of addressable sub-element nodes that the matching layer can query per-requirement with evidence attribution. The RCD itself stays — it remains the authoritative synthesis artifact. The sub-elements are a *derivative view* of the RCD, regenerated when the RCD is written or updated, pointed back to the RCD sections they came from for traceability.

**Sub-element types for roles:**

| Sub-element type | Source in RCD | Narrative shape |
|---|---|---|
| `Requirement` | Laddering chains in `domain_matrix` (work, bar, codebase cells) + `mustHaveSkills` / `niceToHaveSkills` | The full laddering chain as coherent paragraph: "Must have X because we do Y, which matters for Z, evidenced by quote." Carries stakeholder attribution, weight (must/nice), source quote, domain tag. |
| `Responsibility` | `domain_matrix` (work, team cells) ownership scope items | What the hire will own, autonomy level, scope, specific domains |
| `CulturalSignal` | `team_culture_profile` per-stakeholder CVF + psychological_safety + `domain_matrix` team/process cells | One per culture dimension: autonomy, risk-tolerance, conflict-handling, learning-orientation, collaboration-style, etc. Evidence + stakeholder attribution. |
| `TeamContext` | `domain_matrix` team cells + per-stakeholder summaries | Team composition, collaboration style, stakeholder perspectives. Multiple sub-elements when perspectives diverge enough to warrant separate nodes. |
| `Dealbreaker` | `dealbreakers: DealbreakerRecord[]` | Each dealbreaker as its own sub-element with `gatekeeping_rule`, `job_relatedness_note`, `job_relatedness_strength`, `source_stakeholder` |
| `RedFlag` | `red_flags: RedFlagRecord[]` | Each as its own sub-element with severity and stakeholder attribution |
| `TechnicalContext` | `technical_context` stack, constructs, seniority_band | Stack elements, architecture patterns, constructs, seniority band. Multiple sub-elements (one per stack component, one per construct) rather than a single monolithic context node. |
| `CodebaseExpectation` | `technical_context.codebase_expectations` | Quality standards, shipping cadence, test culture, PR conventions, review density |
| `ProcessExpectation` | `domain_matrix` process cells | PR/code-review culture, release cadence, team rituals |
| `Conflict` | `conflicts: ConflictRecord[]` | Each multi-stakeholder disagreement as a first-class node. Links to the requirements or expectations it relates to. Enables queries like "surface all open disagreements on this role" for recruiter awareness. |
| `BarsOverride` | `bars_overrides: BarsOverride[]` | Each override as a sub-element with anchor text, dimension, source rationale. Consumed by scorers at assessment time. |

Each sub-element gets its own embedding (rich narrative prepended with type tag: "Requirement: ..." or "CulturalSignal: ..."). Type prefixing helps the embedding model distinguish different kinds of signal even when content overlaps. Embeddings are generated at RCD synthesis time, stored in a new `role_nodes` table in D1 during the transition period, and surfaced into Neo4j during the graph migration.

**Storage shape during transition (D1):**

```
role_nodes (
  id TEXT PK,
  role_context_id TEXT NOT NULL,
  rcd_version TEXT NOT NULL,
  node_type ENUM,
  narrative_text TEXT,
  extracted_properties_json TEXT,  -- structured fields per type
  embedding_json TEXT,              -- ADR-040 ground truth
  source_section TEXT,              -- pointer back to RCD section for traceability
  source_stakeholder TEXT,          -- null if aggregated
  weight REAL,                      -- must/nice scoring weight, null if not applicable
  created_at INTEGER,
  updated_at INTEGER
)
```

In Vectorize, vectors go into ROLE_INDEX with metadata: `entity_type='role'`, `entity_id=role_context_id`, `node_type=<type>`, `rcd_version=<version>`. This allows Vectorize queries filtered by role and node type during the transition period, and it allows efficient cutover when Neo4j goes live.

**Backward compatibility.** `role_contexts.rcd_json` stays canonical. `persona_json` stays populated via the existing `deriveConsumerSlice` code path for legacy consumers. `role_searchable_profile` and `embedding_json` stay for the transition — but the embedding content migrates from JD-based (`buildRoleSearchableProfile`) to RCD-narrative-based (`buildRcdSearchProfile`) so that `role_candidate_cosine` actually reflects RCD depth. This is a one-line routing change plus a backfill of existing role contexts.

**Decomposition trigger.** Sub-element generation runs as a step in `synthesizeRcd.ts` — after the RCD is written, the synthesizer calls a new `decomposeRcdIntoNodes` function that walks the RCD and produces the sub-element rows. A single RCD synthesis produces one `role_contexts` row, one persona derivation, and N `role_nodes` rows (typically 20–60 depending on role complexity). On RCD update, existing nodes are marked superseded and new ones are written with a bumped `rcd_version`.

---

## Role matching: what changes

With role sub-elements available, the matching layer operates per-requirement rather than per-whole-entity. Details live in Part 5, but the role-side shape is worth anchoring here:

For each `Requirement` sub-element in the role, the matching layer finds the most semantically similar candidate sub-elements above a threshold. The threshold starts at 0.6 for inclusion (tune from data). Above the inclusion threshold, scoring aggregates pairs by `max(sim)` per requirement (the candidate's single best match for each requirement) with a count penalty reward (log(1+n)) favoring candidates who have multiple strong pieces of evidence over those with one narrow match.

For each `Dealbreaker` sub-element, the matching runs an **explicit check** at a higher similarity threshold (0.75). If no candidate sub-element addresses the dealbreaker concern above this threshold, the match receives a `dealbreaker_fail` flag. Dealbreakers with `job_relatedness_strength='strong'` auto-fail the match; `moderate` flags for recruiter review; `weak` are advisory. This is the scoring-layer gate that's currently missing.

For each `CulturalSignal`, the matching compares against candidate sub-elements that carry cultural texture. After screening runs, these candidate-side sub-elements come from the behavioural interview transcript decomposition (Part 4). Pre-screening, these are sparse — which is precisely why loose match is explicitly framed as low-confidence.

`Conflict` sub-elements don't directly contribute to scoring; they're surfaced in the match report so recruiters know where the hiring team hasn't aligned. A match might score high overall but still flag "hiring manager and team member disagree on SQL optimization importance — candidate's evidence here is thin — consider which perspective to trust."

`BarsOverride` sub-elements feed the scoring agents at assessment time, not the matching layer. Their role here is ensuring overrides are addressable per-dimension rather than applied as a global scalar.

---

## UAR migration for role discovery

ADR-034 defines a five-phase migration from the legacy per-agent implementations into the Unified Agent Runtime. For role discovery, the migration is Phase 2.

**Current UAR state for role discovery:**

- Plugin registered: `lib/agents/roleDiscovery/plugin.ts`
- Type tag: `role_discovery`
- FSM config: min 1 turn, max 20 turns, terminates at `questionBudget`
- Eval gate: 2 dimensions (`goal_alignment`, `tone`), approval rule `all_pass`
- Scoring config: none (role discovery produces a synthesis artifact, not BARS scores)
- `generateTurn`: **mock stub** returning "Mock question #N for role discovery"
- Plugin dimensions in the ADR don't align with what the live `roleAgent.ts` does

**Migration steps:**

First, define the real `generateTurn` for role discovery inside the plugin. This is a port of `callRoleAgent` / `callRoleAgentStream` logic from `lib/roleAgent.ts` into the plugin contract, reusing `roleAgentPrompts.ts` unchanged. The turn-based 8-probe deterministic pattern stays; what changes is that the runtime (UAR) provides retry, timeout, force-JSON, per-turn eval gate, and session persistence, which are currently implemented ad-hoc in the legacy path.

Second, wire the eval gate properly. The existing Qwen3-30b cross-family evaluator in `routes/internal/evaluateDiscovery.ts` should be deleted and replaced with UAR's `EvalGate` running the same model-family-separation principle inside the plugin. The two eval dimensions (`goal_alignment`, `tone`) are reasonable defaults; they may need calibration against the actual interview quality criteria.

Third, align the session store. Migration 0043 (`agent_sessions`) needs to be applied and `D1SessionStore` needs to replace the in-memory store. The route at `routes/agents.ts` needs auth middleware added — this is a known gap. The new `agent_sessions` schema uses `transcript JSON` / `score_report JSON` / `eval_results JSON` blobs, but for role discovery there is no scoring (synthesis is a separate operation that runs after the session ends), so `score_report` is null and `synthesis_json` would need to be a new column or reused as the extension point.

Fourth, wire synthesis into the UAR flow. `synthesizeRcd.ts` is called today from the legacy route at session completion. In UAR, synthesis should be a post-FSM step triggered when `state` transitions from `in_progress` to `scoring` (or a new `synthesizing` state if role discovery doesn't fit the existing state machine cleanly). The synthesis produces the RCD, writes it to `role_contexts.rcd_json`, derives the persona for legacy consumers, and triggers the decomposition into `role_nodes`.

Fifth, swap the route. The legacy route at `routes/discovery/roleContexts.ts` delegates to UAR instead of calling `callRoleAgent` directly. This happens behind a feature flag so production traffic can be incrementally migrated. Once the UAR path is handling 100% of traffic and producing RCDs of equal or better quality (measured against a held-out set of RCDs generated both ways), the legacy `lib/roleAgent.ts` can be deleted.

**Why migrate, given the legacy path works.** Three reasons:

One, consolidation. Currently the platform has three separate agent implementations (roleAgent, implementerAgent, cultureAgent) with three different retry patterns, three different session shapes, three different eval approaches. UAR unifies them. The engineering cost of maintaining three divergent agent frameworks as the product grows is real.

Two, quality gates. UAR's per-turn `EvalGate` is a principled quality mechanism that the legacy role agent doesn't have. The current 8-probe deterministic pattern is rigorous but brittle — if Gemma emits a weak question, there's no second-pass evaluation before it goes to the candidate. UAR's eval gate catches this.

Three, extensibility. As role discovery evolves (dynamic probe generation from a growing question bank, adaptive depth based on stakeholder response quality, multi-session continuity), the UAR plugin contract gives you a cleaner extension point than the monolithic legacy code.

**Migration risk.** The legacy path is producing good RCDs today. Migrating to UAR without rigorous parity checking could regress quality. The mitigation: dual-run both paths against the same inputs for at least 30 real discovery sessions, compare RCDs for domain coverage, laddering depth, conflict detection, and dealbreaker extraction, and only cut over when parity is established. This is a slow migration by design.

---

## Role-discovery work, sequenced

Organized by phase, mapped to the overall sequencing from Part 1:

**Phase 0 — Consumption cutover and hygiene (part of the 4–6 week Phase 0):**

Cut over `autoStageBuilder.ts`, `repoDiscovery/discover.ts`, and the cockpit routes to read RCD primary with persona fallback, matching what `cultureRoleResolution.ts` already does. This is straightforward — each consumer currently reads `persona_json`; change the read to check `rcd_json` first, derive the needed fields from RCD (via `rcd_json.consumer_slice` for the legacy shape, or from structured RCD fields where the consumer needs more depth), and fall through to `persona_json` if `rcd_json` is null.

Switch `ROLE_INDEX` to store the RCD narrative instead of JD-based text. Change the embedding source in the three call sites (`routes/discovery/roleContexts.ts:109`, `:775`, `:1170`) from `buildRoleSearchableProfile` to `buildRcdSearchProfile`. Backfill existing role contexts via `scripts/backfillRoleEmbeddings.ts` (which already exists).

Fix or delete the compile-broken evaluator files. Recommendation: delete `lib/roleDiscovery/evaluator.ts`, `evaluatorPrompt.ts`, and `routes/internal/evaluateDiscovery.ts`. The evaluator work belongs inside the UAR plugin's `EvalGate`; the standalone files are abandoned WIP. If there's salvageable prompt content in `evaluatorPrompt.ts`, port it to the UAR plugin and delete the rest.

Wire dealbreaker gate enforcement. When a candidate is matched to a role, the matching layer checks each `Dealbreaker` sub-element explicitly. Strong-strength dealbreakers that aren't addressed by candidate evidence auto-fail the match. Moderate-strength dealbreakers flag for recruiter review. This reads dealbreakers from the RCD and applies them as explicit gates rather than advisory flags.

**Phase 2 — Role decomposition (4–6 weeks):**

Implement `decomposeRcdIntoNodes` as a new function in `lib/roleAgent/synthesizeRcd.ts` (or a new `lib/roleAgent/decomposeRcd.ts`). Called at the end of RCD synthesis, walks the RCD, produces sub-element rows for `role_nodes`, generates embeddings per sub-element, writes to Vectorize with metadata tags.

Add the `role_nodes` table via a new migration (0044 or successor). Columns as specified above. Indexes on `role_context_id`, `node_type`, `rcd_version`.

Backfill existing role contexts. All live RCDs get decomposed into sub-element rows. The RCD itself is not modified; sub-elements are a derivative view. Existing consumers keep reading `rcd_json` directly until they cut over to reading sub-elements.

Update `matchReposForCandidate` (Part 3) and the matching pipeline (Part 5) to consume sub-elements rather than flat role text. This happens alongside repo decomposition since matching spans both sides.

**Phase 4 — UAR migration for role discovery (part of 6–10 week Phase 4):**

Port `callRoleAgent` logic into `lib/agents/roleDiscovery/plugin.ts`. Replace the mock stub. Run dual-path for at least 30 real sessions. Delete the legacy `lib/roleAgent.ts` when parity is established.

Apply migration 0043, wire `D1SessionStore`, add auth middleware to `routes/agents.ts`. These are shared infrastructure changes that also benefit the other two UAR plugins.

**Phase 5 — Graph migration (part of 6–10 week Phase 5):**

`role_nodes` rows and their embeddings become Neo4j nodes with `:RoleNode` and type-specific sub-labels. Edges connect them to the `:Role` root node and cross-link conflicts to requirements. Matching queries rewrite from application-layer orchestration to Cypher. Details in Part 5.

---

## Honest caveats

Three things about role discovery that I want to flag so nothing is oversold:

One, **the quality of the RCD is bounded by the quality of the discovery interview**. If a hiring team provides thin stakeholder input (a 15-minute rushed interview with only the hiring manager), the RCD reflects that. The rich fields get synthesized but with low coverage, sparse evidence, and weak laddering. No amount of downstream sophistication recovers from under-informed synthesis. Recruiter training on how to run a good discovery interview, and product guardrails (minimum stakeholder count, minimum coverage per domain before synthesis, recruiter-facing "your RCD is thin, consider re-interviewing X stakeholder") matter more than the decomposition architecture.

Two, **the UAR migration is not urgent unless the legacy path breaks or degrades**. The legacy `roleAgent.ts` works. The UAR migration is architectural consolidation that pays off over a long horizon. If product pressure points elsewhere, UAR for role discovery can stay at Phase 2 status (plugin registered, stub in place, real implementation deferred) for months without harm. Don't let the ADR-034 phase numbering create artificial urgency.

Three, **sub-element decomposition multiplies the storage and the compute**. Each RCD becomes ~20–60 sub-element rows with embeddings. Each embedding costs a BGE call and a Vectorize upsert. At scale this is not free, though at your current scale it's cheap. The gain is matching quality and explainability. If the decomposition doesn't demonstrably improve matching quality on a golden set, the compute spend isn't justified. The measurement discipline (golden set, A/B on match quality, parity checking) is as important as the decomposition itself.

---

*End of Part 2.*
