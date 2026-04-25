# Pipe Strategy v2 — Part 5: Matching Architecture and Infrastructure Migration
*Per-element matching, evidence-structured reports, the Neo4j migration, and the master sequencing.*

---

## The matching problem, restated

The matching layer takes a role and a set of candidates and produces something useful: a ranked list, a set of match reports, actionable signal for recruiters making hiring decisions. In the current system, matching produces a triangulated score — a single number per candidate-role pair composed of four signals (role-repo alignment, candidate-repo fit, role-candidate cosine, skill coverage) with philosophy-dependent weights.

This works but has a ceiling. The number is opaque. When a recruiter sees Candidate A scored 0.78 and Candidate B scored 0.74, there's no direct way to see *why* — which requirements each candidate addressed, which they didn't, where the evidence came from, where the gaps are. The four triangulation signals combine rather than separate, flattening evidence attribution.

The reframe: **the match report is the primary output; the match score is a derived summary of the report**. Recruiters should be able to see, per candidate per role, a structured breakdown of how the candidate aligns with each role requirement, each cultural signal, each technical expectation, with specific evidence pointing to sub-elements on the candidate's graph. The aggregate score still exists — for sorting, for coarse filtering, for the recruiter dashboard — but it's computed from the report rather than produced independently.

This is the architectural payoff of the decomposition work in Parts 2, 3, and 4. Once entities are addressable at the sub-element level, matching operates per-element, and match reports become structurally rich by default.

---

## Per-element matching

The algorithm, at the level of detail needed to implement:

**Step one: candidate shortlisting.**

Given a role, retrieve a candidate shortlist via semantic recall. For each `Requirement` sub-element on the role, query CANDIDATE_INDEX (or the Neo4j equivalent) for the top-K candidate sub-elements above a similarity threshold. Threshold defaults to 0.6 but is tunable. Aggregate the union of returned candidate_ids as the shortlist. This is much broader than the current `topK=50` against a single candidate vector — the shortlist comes from many per-requirement queries and can exceed 100 candidates.

Apply structured filters at this step: seniority band within ±1 of role requirement, location/availability constraints from Context sub-elements, any hard dealbreakers that can be checked via structured properties without semantic matching (e.g., "must have legal authorization to work in X" as a boolean flag).

The shortlist is the population on which detailed per-element matching runs. Detailed matching is expensive — full evidence aggregation per candidate — so shortlisting matters for cost control.

**Step two: per-requirement evidence gathering.**

For each candidate in the shortlist, for each `Requirement` sub-element on the role:

Query the candidate's sub-elements (non-superseded, above confidence threshold) for the highest-similarity matches to this requirement. Return top-N matches (N=3 typically — we want evidence, not just the single best match). Each match carries the candidate sub-element type, the similarity score, a pointer to the sub-element's narrative and extracted properties, and the sub-element's source (resume, screening, enrichment, assessment).

Example: Role has `Requirement: "Must have 2+ years production experience with async job queue systems like Kafka or RabbitMQ"`. For candidate Alice, the query returns:

- Experience at Plaid (0.89 sim) — narrative mentions Kafka production work for 18 months, source: resume
- Project "event-stream-processor" (0.82 sim) — open-source project from GitHub enrichment, RabbitMQ-based
- TechnicalDemonstration from code review (0.71 sim) — demonstrated async reasoning on a streaming PR

These three are the evidence for Alice's match against this requirement. The per-requirement score for Alice on this requirement is `max(0.89, 0.82, 0.71) = 0.89` with the quality bonus from having multiple above-threshold matches.

**Step three: aggregation into per-dimension scores.**

Per-requirement scores aggregate into per-dimension scores. Dimensions group related requirements:

- Technical alignment — aggregated from `Requirement`, `TechnicalContext`, `CodebaseExpectation` matches
- Domain alignment — aggregated from `Requirement` matches tagged to specific domains, `DomainContext` matches
- Cultural alignment — aggregated from `CulturalSignal` matches
- Experience alignment — aggregated from matches against `Experience` and `Project` sub-elements as quality indicators
- Contextual fit — aggregated from `Context` matches (location, availability, preferences)

Aggregation per dimension uses the `avg(sim)` of above-threshold matches with the count bonus (`avg(sim) * log(1 + n)` where n is count of above-threshold matches). Unrelated sub-elements don't drag the score — only above-threshold matches count. This addresses the "unrelated things shouldn't drop the score" requirement from the conversation.

**Step four: dealbreaker gates.**

For each `Dealbreaker` sub-element on the role, run an explicit check. Query the candidate's sub-elements for any match above a stricter threshold (0.75). If no match is found — meaning no evidence the candidate addresses the dealbreaker concern — the match receives a `dealbreaker_fail` flag.

Dealbreakers with `job_relatedness_strength='strong'` auto-fail the match: overall score is nulled, match report surfaces the specific dealbreaker and the absence of evidence, recruiter sees "this candidate doesn't meet a must-have criterion." Strength `moderate` flags for recruiter review without auto-fail. Strength `weak` is advisory in the report.

This is the scoring-layer gate enforcement that's currently missing. Dealbreakers in RCD carry `job_relatedness_note` and `evidence_quote`; the matching layer reads them and enforces them as explicit checks rather than leaving them as free-text fields `cultureScorer.ts` pattern-matches optionally.

**Step five: overall score synthesis.**

The overall match score is a weighted sum of per-dimension scores. Weights are philosophy-dependent (matching the existing `triangulateMatch` preset structure):

| Dimension | Validate | Tailored | Hybrid |
|---|---|---|---|
| Technical alignment | 0.40 | 0.25 | 0.35 |
| Domain alignment | 0.15 | 0.15 | 0.15 |
| Cultural alignment | 0.20 | 0.30 | 0.25 |
| Experience alignment | 0.15 | 0.20 | 0.15 |
| Contextual fit | 0.10 | 0.10 | 0.10 |

Dealbreaker fails override the weighted sum with a null/explicit-fail result.

**The four-signal triangulation stays as a summary layer.** `triangulateMatch` continues to exist. It's now computed from the per-dimension scores above rather than from four independent queries. `role_repo_alignment` becomes an aggregate of Technical + Domain alignment; `candidate_repo_fit` becomes an aggregate of how well the candidate's demonstrated abilities align with the assigned repo's challenge surfaces; `role_candidate_cosine` becomes the overall per-element match score; `skill_coverage` becomes the Technical alignment sub-score. The four signals are views on the richer decomposed data rather than independently-computed inputs.

---

## The match report

The match report is the structured output of per-element matching. It's what recruiters see. It's auditable. It's what makes the matching defensible.

**Shape:**

```
MatchReport {
  candidate_id, role_context_id,
  overall_score: 0.0 - 1.0,
  match_philosophy: 'validate' | 'tailored' | 'hybrid',
  dealbreaker_fails: DealbreakerFailure[],    -- empty means no hard fails
  dimension_scores: [
    { dimension: 'technical', score, weight, contributing_requirements: [...] },
    { dimension: 'cultural', score, weight, contributing_signals: [...] },
    ...
  ],
  requirement_matches: [
    {
      requirement_id, requirement_text, requirement_weight,
      per_requirement_score,
      top_evidence: [
        { candidate_sub_element_id, sub_element_type, narrative, similarity, source_type },
        ...  -- up to 3
      ]
    },
    ...
  ],
  cultural_alignment: [
    {
      cultural_signal_id, cultural_signal_text,
      candidate_position: 1-5 | null,
      role_expected_position: 1-5 | null,
      divergence: float,
      evidence: [...]
    },
    ...
  ],
  unaddressed_concerns: [
    { type: 'dealbreaker' | 'requirement' | 'cultural_gap',
      description, strength, recommendation }
  ],
  confidence: 0.0 - 1.0,          -- bounded by candidate graph density
  evidence_density: 0.0 - 1.0,    -- how much of candidate's graph is populated
  sources_consumed: {resume, screening, enrichment, code_review, implementation, culture_interview},
  generated_at, matching_version
}
```

This is stored per candidate-role pair in a new `match_reports` table in D1 (or Neo4j `:MatchReport` node linking candidate and role after migration). Reports are versioned — each time matching re-runs for a candidate-role pair (new evidence available, rubric changes, philosophy change), a new version is written. Old versions stay for audit.

**Recruiter UI implications:**

A match report renders as a structured view rather than a single number. For each role requirement, the recruiter sees the top-matching candidate evidence with ability to click into the underlying sub-element. For each dealbreaker, pass/fail with surfaced evidence (or absence). For each cultural dimension, the candidate's position versus the role's expected position with divergence highlighted. For each unaddressed concern, a human-readable description and a recommended next step (probe deeper in screening, request references, schedule follow-up).

This is a significant UI build — current recruiter views show score summaries, not evidence structures. Phased rollout: backend writes match reports, API surfaces them, recruiter UI consumes them progressively (first pass: just show the dimension breakdown alongside the current score; later: full evidence drill-down).

---

## Triangulation as a summary layer

The existing `triangulateMatch` code has meaningful logic worth preserving even as the primary matching moves to per-element. What it provides:

- A single overall score for coarse sorting
- Philosophy-dependent weighting
- Integration with match_feedback for eventual learning-to-rank

The transition: `triangulateMatch` becomes an adapter over match reports. It reads the match report, extracts the dimension scores, applies philosophy weights, returns the summary number. The existing callers keep working without change; the underlying computation is now rooted in per-element evidence.

The vector signal slots in `VECTOR_WEIGHTS` (the currently-unpopulated vector_role_repo, vector_role_cand, vector_cand_repo terms) become populated from the match report's dimension scores rather than from independent cosine queries. The unreachable branch becomes reachable with real values.

`match_feedback` schema extends to carry per-dimension and per-requirement recruiter feedback alongside the overall thumbs-up/down, enabling eventual dimension-specific calibration.

---

## The skill adjacency work

Covered partially in Part 3 for the SQL matchRepos rewrite. The full scope:

**Hand-curated `skill_adjacency` table:**

Initial curation covers ~50 technology groupings:

- Frontend frameworks: React, Vue, Angular, Svelte, Solid, Ember — pairwise weights
- Backend languages: Go, Rust, Java, Kotlin, Scala, C#, Python, Ruby, Node.js — pairwise weights calibrated to actual substitutability
- Relational databases: Postgres, MySQL, SQLite, MariaDB, SQL Server, Oracle — pairwise weights
- NoSQL databases: MongoDB, Cassandra, DynamoDB, Redis, Elasticsearch — partial adjacency reflecting different paradigms
- Message brokers: Kafka, RabbitMQ, Pulsar, SQS, NATS — pairwise weights reflecting delivery semantics differences
- Cloud providers: AWS, GCP, Azure, Cloudflare — pairwise weights reflecting primitive overlap
- Container/orchestration: Docker, Kubernetes, Nomad, ECS, Cloud Run — pairwise weights
- CI/CD: GitHub Actions, CircleCI, Jenkins, GitLab CI, ArgoCD — pairwise weights
- Testing: Jest, Vitest, Mocha, pytest, rspec — pairwise weights reflecting ecosystem overlap
- Frontend styling: Tailwind, CSS Modules, styled-components, Emotion, vanilla CSS — pairwise weights

Each pair has `source_skill_id`, `target_skill_id`, `weight`, `evidence_type` (how the adjacency was determined: documentation cross-reference, job posting co-occurrence, community migration guide, manual curation). Updated quarterly; review when a new major framework emerges.

**SQL query rewrite:**

Current `matchRepos.ts`:
```sql
HAVING must_hits = must_total
```

Rewrite:
```sql
WITH skill_coverage AS (
  SELECT repo_id,
    SUM(CASE
      WHEN direct_match THEN 1.0
      WHEN adjacency.weight IS NOT NULL THEN adjacency.weight
      ELSE 0.0
    END) AS weighted_coverage
  FROM repo_skills
  LEFT JOIN skill_adjacency adjacency ON repo_skills.skill_id = adjacency.source_skill_id
  WHERE adjacency.target_skill_id IN (:candidate_skills)
     OR repo_skills.skill_id IN (:candidate_skills)
  GROUP BY repo_id
)
SELECT repo_id FROM skill_coverage
WHERE weighted_coverage >= :coverage_threshold
```

`coverage_threshold` comes from the match philosophy — 0.85 for validate (strict), 0.70 for tailored (relaxed). Feature-flag for A/B testing strict vs. relaxed.

**The silent fallback fix:**

`matchRepos.ts` currently does `skill.toLowerCase()` as fallback when `skill_aliases` lookup fails. Remove the silent fallback. Log a warning with the unknown skill and role context. Periodic review extends `skill_aliases`. If you want a fallback to avoid dead-ending pipelines, make it a **loose substring match with low weight** rather than exact-match normalization — less likely to silently miss valid adjacencies.

---

## Reliability hardening (preserved from Part 1 of the original strategy)

The original strategy's ingestion reliability recommendations remain valid despite ADR-040 landing dual-layer storage. The work shields LLM calls from transient failures and creates observable, diagnosable pipeline state.

**Retry with exponential backoff per provider:**

Wrap every Gemma and BGE call in a retry helper. Provider-specific parameters:

- Vertex AI Gemma 4 26B: base_delay=2s, max_delay=120s, max_retries=5, jitter=1s. Retries on 429/500/502/503.
- Workers AI Qwen/Gemma: base_delay=30s fixed (cold-start pattern), max_delay=300s, max_retries=3. Retries on 3050 errors.
- Workers AI BGE embedding: base_delay=2s, max_retries=5. Embedding is fast and rarely fails.
- Anthropic fallback: standard exponential backoff, max_retries=3. Only used as emergency fallback.

Error classification helper: `classifyError(err) → 'TRANSIENT' | 'DEGRADED' | 'PERMANENT'`. 429/5xx transient. Context-length-exceeded and content-filter DEGRADED (switch to fallback model). 401/400/422 PERMANENT (fail fast, no retry). Applied at every LLM call site via a shared middleware or Durable Object method.

**Circuit breakers per provider:**

Use opossum. Separate breakers for Vertex AI (Gemma), Workers AI (Qwen), Workers AI (BGE). Thresholds:

- Vertex AI: 5 failures in 60s trips the breaker, 30s recovery timeout, 3 probe requests
- Workers AI (Qwen): 3 failures in 120s (3050 errors are expensive to retry), 15s recovery, 2 probe requests
- Workers AI (BGE): 5 failures in 60s, 30s recovery, 3 probe requests

Circuit state in D1 with TTL. When a circuit opens, pipeline routes to fallback where possible (Qwen → Gemma for implementer agent with capability degradation flag) or queues for retry when no fallback (profile discovery requires Gemma's context window).

**Idempotency keys on re-ingestion:**

`POST /:candidateId/reingest` currently lacks idempotency protection. Add `Idempotency-Key` header requirement. Client generates UUID per submission. Server stores the key + cached response in D1 with 24h TTL; duplicate requests within TTL return cached response. Combined with Durable Objects per-candidate serialization, this eliminates the race conditions where concurrent re-ingestion corrupts state.

**Partial materialization per pipeline step:**

The 11-step candidate ingestion currently marks the whole row failed on any step's transient error. Extend `candidate_ingestion` with per-step status columns (profile_status, embed_status, match_status, etc.) and transition the pipeline to resume from the first failed step rather than restart from pending. This means a Vertex 429 during situation_fit doesn't cause the embedding (which succeeded) to be recomputed on retry.

Each step has a version stamp. If the embedding is stale (BGE version bumped) the resumption logic recomputes from that point rather than trusting old intermediate state.

**Heartbeats and stale run detection:**

Cron-triggered Worker scans for in-flight `ingestion_runs` with `heartbeat_at` older than 5 minutes, marks them failed, enables re-ingestion. Heartbeat updates happen after each step completes. Cloudflare Workers can be terminated without notification; heartbeats make interrupted runs detectable.

**Dead-letter queue for permanent failures:**

Extended beyond the current opaque "failed" status to structured diagnostic objects. Each failure captures: failed_step, error_type classification, error_code (provider-specific), retry_count, retry_exhausted, checkpoint_preserved flag, recovery_endpoint for manual retry, recruiter-friendly error_message. Cloudflare Queues handles the DLQ with at-least-once semantics. Consumer worker runs automatic retries for transient failures, routes permanent failures to the admin queue with full context, and emits operational alerts on failure category trends (spike in VERTEX_AI_429 indicates quota planning issue).

---

## Observability

Current observability is console.error / console.warn tailed via Cloudflare Workers Logs. No structured tracing, no OpenTelemetry, no Sentry. Cost metering exists (aiUsage.ts, culture_ai_usage_events, admin dashboard) but there's no step-level latency or error categorization.

**OpenTelemetry for AI:**

`@microlabs/otel-cf-workers` provides Workers-compatible OpenTelemetry SDK. OTLP/HTTP export to Grafana Cloud, Axiom, or Honeycomb via Cloudflare Destinations — no agent installation, just endpoint configuration.

`gen_ai` semantic conventions for LLM calls: capture `gen_ai.request.model`, `gen_ai.request.max_tokens`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reason`. Never log prompt content by default — candidate privacy concern.

Span hierarchy for candidate ingestion:

```
TRACE: ingestion_pipeline (candidate_id_hash)
├── SPAN: ingestion.discover_profile
│   ├── SPAN: llm.call.vertex_ai [token counts, finish_reason]
│   └── SPAN: profile.persist_d1
├── SPAN: ingestion.embed
│   ├── SPAN: embedding.bge_large
│   └── SPAN: vectorize.upsert
├── SPAN: ingestion.match_repos
│   ├── SPAN: sql.graph_query
│   ├── SPAN: vectorize.semantic_recall
│   └── SPAN: gemma.rerank
└── SPAN: ingestion.triangulate
    └── SPAN: gemma.situation_fit
```

When a match looks wrong, the trace shows where time went and which LLM calls produced which outputs. Diagnostic drill-down becomes possible.

**Sampling strategy:**

- 100% for development
- 5-10% for production success (cost management)
- 100% tail-based for errors (complete failure analysis)
- 100% for high-token requests >2K output tokens (cost anomaly detection)

**Structured recruiter-facing status:**

Replace the current opaque "failed" with structured status reflecting pipeline progress: pending, profile_generated, embedded, matching, matched, failed_step_X (with reason + ETA), failed_permanent (with action recommendation). D1 schema extension to `candidate_ingestion`: `step_timestamps` JSON, `current_step` enum, `estimated_completion` (from historical p50 per step), `recovery_options` JSON array. Recruiter dashboard polls via Server-Sent Events for real-time updates.

---

## The Neo4j migration

All the decomposition work in Parts 2, 3, and 4 produces graph-shaped data stored transitionally in D1 + Vectorize. The final migration moves that graph into Neo4j as the system of record.

**When to migrate:**

After Phase 0 (consumption cutover) and Phase 1 (candidate decomposition) are complete and validated. Before Phase 4 (screener) if time allows, because the screener's graph-traversal queries (coverage computation, gap identification) are cleaner in Cypher than in application code.

Rough calendar position: months 4–6 of the overall trajectory. Not first, not last.

**Infrastructure setup:**

- Self-hosted Neo4j Community Edition on a Linux VPS. DigitalOcean or Hetzner. 4–8 GB RAM, 2 vCPU. Costs €10–40/month depending on provider and region.
- Ubuntu LTS, Neo4j Community 5.x (or whatever current version is at migration time).
- Caddy reverse proxy for automatic TLS. Bolt protocol (port 7687) exposed only to Cloudflare IP ranges via firewall.
- `neo4j-admin dump` daily cron, dumps piped to R2 or S3 with 30-day retention.
- Snapshot the VPS weekly on top of Neo4j's own backups. Belt and suspenders.
- UptimeRobot monitoring for external liveness. Grafana Cloud free tier for internal metrics if desired.
- JavaScript driver (`neo4j-driver`) imported in Workers for Bolt connection.

Total ops overhead: setup ~8 hours, ongoing ~2 hours per month for updates, patches, backup verification.

**Schema mapping to Cypher:**

Entities become top-level nodes with root labels:

- `:Candidate {candidate_id, created_at, updated_at, profile_state, last_engaged_at}`
- `:Role {role_context_id, pipeline_id, rcd_version, created_at}`
- `:Repo {repo_id, github_url, signals_version, admin_status, crawled_at}`

Sub-elements become typed nodes linked to their parent entity:

- `:CandidateNode :Experience {id, narrative, extracted_properties, embedding, source_type, confidence, captured_at, superseded_at}`
- `:CandidateNode :Project {...}`
- `:CandidateNode :CulturalSignal {...}`
- `:RoleNode :Requirement {id, narrative, embedding, weight, stakeholder, source_quote}`
- `:RoleNode :Dealbreaker {id, narrative, embedding, job_relatedness_note, job_relatedness_strength, gatekeeping_rule}`
- `:RepoNode :Feature {id, narrative, embedding, complexity}`
- `:RepoNode :ChallengeSurface {id, narrative, embedding}`

Embeddings are stored as properties using Neo4j's native vector index (available in 5.11+).

Relationships:

- `(:Candidate)-[:HAS]->(:CandidateNode)`
- `(:Candidate)-[:SUPERSEDED_BY]->(:CandidateNode)` — optional convenience edge
- `(:CandidateNode)-[:SUPERSEDES]->(:CandidateNode)` — explicit supersedes chain
- `(:Role)-[:HAS]->(:RoleNode)`
- `(:Role)-[:HAS_REQUIREMENT {weight}]->(:Requirement)` — weight on edge for easy query
- `(:Role)-[:HAS_DEALBREAKER {strength}]->(:Dealbreaker)`
- `(:Role)-[:HAS_CONFLICT]->(:Conflict)-[:BETWEEN]->(:RoleNode)` — conflicts link to the requirements they affect
- `(:Repo)-[:HAS]->(:RepoNode)`
- `(:MatchReport)-[:FOR_CANDIDATE]->(:Candidate)`
- `(:MatchReport)-[:FOR_ROLE]->(:Role)`
- `(:MatchReport)-[:EVIDENCED_BY]->(:CandidateNode)` — evidence attribution for audit

Constraints:

- Unique constraint on `candidate_id` for `:Candidate`, `role_context_id` for `:Role`, `repo_id` for `:Repo`
- Vector index on embedding property for each node type that carries embeddings

**Matching queries in Cypher:**

The per-requirement matching from earlier in this document becomes natural Cypher:

```cypher
MATCH (role:Role {role_context_id: $role_id})-[:HAS]->(req:Requirement)
MATCH (cand:Candidate)-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL
  AND node.confidence >= 0.6
WITH role, req, cand, node,
     vector.similarity.cosine(req.embedding, node.embedding) AS sim
WHERE sim >= 0.6
WITH role, req, cand, avg(sim) * log(1 + count(node)) AS per_req_score,
     collect({node_id: node.id, sim: sim, type: labels(node)})[0..3] AS top_evidence
WITH cand,
     collect({
       requirement_id: req.id,
       requirement_text: req.narrative,
       weight: req.weight,
       score: per_req_score,
       evidence: top_evidence
     }) AS requirement_matches,
     sum(per_req_score * req.weight) / sum(req.weight) AS overall_score
RETURN cand.candidate_id AS candidate_id,
       overall_score,
       requirement_matches
ORDER BY overall_score DESC
LIMIT 50
```

This is a single query that does what currently requires orchestration across D1 SQL, Vectorize similarity queries, and JavaScript aggregation. The Cypher engine handles the joins, the vector similarity, the aggregation, the evidence collection.

Dealbreaker gates become a parallel query checking for evidence absence:

```cypher
MATCH (role:Role {role_context_id: $role_id})-[:HAS_DEALBREAKER {strength: 'strong'}]->(db:Dealbreaker)
MATCH (cand:Candidate {candidate_id: $cand_id})
OPTIONAL MATCH (cand)-[:HAS]->(node:CandidateNode)
  WHERE node.superseded_at IS NULL
  WITH db, node,
       vector.similarity.cosine(db.embedding, node.embedding) AS sim
WITH db, max(coalesce(sim, 0)) AS best_match
WHERE best_match < 0.75
RETURN db.id AS dealbreaker_id,
       db.narrative AS dealbreaker_text,
       db.job_relatedness_note AS rationale,
       'auto_fail' AS action
```

Any returned rows are dealbreaker fails. Empty result means no strong dealbreakers are unaddressed.

**Migration approach — dual-write then cutover:**

Phase A (weeks 1–2): Stand up Neo4j. Implement schema. Run parity tests against synthetic data to verify query correctness.

Phase B (weeks 3–6): Dual-write from ingestion. Every time D1 + Vectorize gets a write, the same data is also written to Neo4j. Reads stay on D1 + Vectorize. Both paths run in production; Neo4j serves no traffic. Parity dashboards compare the two stores for drift.

Phase C (weeks 7–10): Shadow-read. Matching queries run against both stores; D1 + Vectorize results are served to users while Neo4j results are computed in parallel and compared. Any deviations get logged for investigation. This phase catches correctness gaps without production impact.

Phase D (weeks 11–12): Primary-read cutover. Matching queries now served from Neo4j. D1 + Vectorize stay populated as fallback for ~1 month. If Neo4j experiences issues, traffic can fail back via feature flag.

Phase E (month 4+): Retire dual-write. D1 + Vectorize become read-only archives for audit purposes. New writes go only to Neo4j for graph-shaped data. D1 retains its role for transactional operational data (candidates table, pipelines, stages, assessments, session stores, compliance audit).

**What stays in D1:**

- Identity and auth tables (candidates, pipelines, stages, auth state)
- Operational state (assessments, challenge_submissions, review_sessions, culture_interview_sessions, agent_sessions)
- Compliance and audit trails (culture_compliance_audit, ai_usage_events, culture_ai_usage_events)
- Configuration (challenges, pipeline_match_config, email_connections)
- Crawler working data (qualified_repos pass=1/2 before Pass 3 approval, repo_sample_prs, repo_issues)
- Match reports (written after matching computes, can live in D1 or Neo4j depending on query patterns)

The principle: **graph-shaped data (decomposed entities, relationships, evidence attribution) goes to Neo4j; transactional and operational state stays on Cloudflare**.

**What gets retired:**

- Vectorize (once Neo4j vector indexes are serving matching)
- `candidate_ingestion.embedding_json`, `role_contexts.embedding_json`, `repo_engineering_signals.embedding_json` (aggregate-level ground truth vectors become redundant once sub-element vectors are in Neo4j)

The retirement doesn't have to happen on a strict timeline. These can persist indefinitely as long as they're not being actively written to. Retire them when the maintenance cost (or the Vectorize bill, or the disk usage) becomes annoying.

---

## The [ACTIVE] / [IN-FLIGHT] / [LEGACY-REPLACING] / [DEFERRED] / [PARK] master list

Pulling together the full sequencing from across the five documents.

**[ACTIVE] — priority work:**

- Cache `candidateSituationFit` by key (Part 4)
- Inject structured JSON signals into `candidate_searchable_profile` (Part 4)
- Add embedding model version stamps to candidate_ingestion, role_contexts, repo_engineering_signals (Parts 1, 2, 3)
- Cut over `autoStageBuilder`, `repoDiscovery/discover.ts`, cockpit routes to RCD primary (Part 2)
- Switch ROLE_INDEX to store RCD narrative, backfill existing roles (Part 2)
- Delete compile-broken evaluator files or wire them to UAR (Part 2)
- Wire dealbreaker gate enforcement in matching (Parts 2, 5)
- Normalize the three preprocessEmbedding bypass call sites (Part 3)
- Confidence-threshold auto-approval for Pass 3 vectorize (Part 3)
- Hand-curated skill_adjacency table, threshold-based matchRepos SQL rewrite (Parts 3, 5)
- Fix silent skill_aliases fallback with alerting (Part 3)
- Issue body pre-fetch for implementation challenges (Part 3)
- Candidate decomposition: candidate_nodes table, prompts rewrite, sub-element embeddings (Part 4)
- Backfill existing candidates through new decomposition pipeline (Part 4)
- Build implementation challenge scorer (Sherlock-based) (Parts 3, 4)
- Extend assessment scoring to write sub-elements back to candidate graph (Part 4)
- Per-element matching rewrite; match reports as primary output (Part 5)
- Triangulation as summary layer over match reports (Part 5)
- Reliability hardening: retry, circuit breakers, idempotency, partial materialization, heartbeats, DLQ (Part 5)
- Structured recruiter-facing status page (Part 5)

**[IN-FLIGHT] — scaffolded, needs completion:**

- UAR Phase 1 is done. Phases 2–5 are the work:
- UAR Phase 2: role discovery migration to UAR plugin (replace mock, dual-path parity, retire legacy) (Part 2)
- UAR Phase 3: code review migration to UAR plugin (Part 4)
- UAR Phase 4: culture fresh build on UAR (Mode 1 screener first, then Mode 2 cutover) (Part 4)
- UAR Phase 5: agent_sessions migration 0043 applied, D1SessionStore swap, auth middleware on routes/agents.ts, session table unification (Parts 4, 5)
- Public data enrichment pipeline (GitHub first) (Part 4)
- Automated screener Mode 1 (role-agnostic profile builder) (Part 4)
- Profile probe bank curation (~100 probes) (Part 4)
- Candidate coverage computation (Part 4)

**[LEGACY-REPLACING] — currently production, will be superseded:**

- `lib/roleAgent.ts` (legacy role discovery) — replaced by UAR role_discovery plugin
- `lib/implementerAgent.ts` (legacy code review) — replaced by UAR code_review plugin
- `lib/cultureAgent.ts` (legacy culture interview) — replaced by UAR culture plugin (fresh build)
- `buildRoleSearchableProfile` JD-based embedding — replaced by buildRcdSearchProfile-based storage
- `candidate_searchable_profile` as single flat prose — replaced by per-sub-element embeddings with aggregate view
- `persona_json` reads throughout cockpit and matching — replaced by RCD primary reads
- D1 + Vectorize for graph-shaped data — replaced by Neo4j (keep D1 for transactional/operational)

**[DEFERRED] — good idea, wrong time:**

- Formal Kappa calibration study with expert panel (revisit after volume and hire outcome data)
- Multi-LLM ensemble scoring at 3× cost
- BGE fine-tuning for skill adjacency (hand-curated covers 80% of value)
- Early fusion joint embedding
- Learning-to-rank on recruiter feedback (data infra now, model later)
- Real-time affect detection in culture interview (validate static first)
- Hierarchical summarization for long-horizon agents (not at current turn limits)
- KV cache compression (gated on Workers AI)
- Fairness constraint optimization (monitor first; add constraint optimization when volume justifies)
- Adversarial debiasing (much later)
- Candidate self-service onboarding surface (separate product phase)

**[PARK] — not pursuing:**

- Keystroke biometrics (GDPR Article 9 complexity outweighs 1–8% EER gain)
- LinkedIn scraping (ToS and ethics, candidate-initiated import only)

---

## What changes the plan

External signals that should cause reprioritization:

**First paying customer.** Triggers faster hardening on whatever they're actually using. Reliability and observability jump higher in priority. Fairness monitoring becomes more urgent if hiring recommendations become consequential.

**First 10 hires where outcome data is accessible.** Unlocks the validation phase earlier than the planned sequence. Golden set becomes real. Kappa study becomes possible.

**Cost anomaly.** If Gemma spend spikes, observability jumps to the front. If per-candidate cost threatens unit economics, the implementation scorer gets revisited (maybe cheaper model for initial pass, Gemma only for HITL-flagged cases).

**Regulatory inquiry.** NYC Local Law 144 audit, EU AI Act assessment, EEOC complaint. Fairness and compliance work become immediate. The existing architecture (finite recruiter-approved probe banks, HITL gates, never-auto-fail dealbreakers) is designed to withstand audit but hasn't been tested under pressure.

**Recruiter feedback volume reaches ~50/month.** Justifies learning-to-rank model training. Unlocks dimension-specific calibration.

**Major Gemma regression from Vertex.** The model is not stable — Vertex may silently upgrade or degrade. Golden set re-scoring should be weekly; if drift is detected, emergency fallback to Anthropic or alternative.

---

## Closing — what this strategy commits to

A summary of the architectural commitments that carry across all five documents:

The **three-entity decomposition** (candidates, roles, repos) with per-sub-element embeddings and evidence attribution. This is the core technical bet; everything else rests on it.

The **candidate as living graph** — resume as seed, not profile. Multi-source accumulation over time with provenance, temporal layering, and supersedes. Screener as first-class profile-building mechanism, not an afterthought.

**Per-element matching with evidence-structured reports** as the primary output. Triangulated scores remain as summaries, not as independent inputs.

**Neo4j as the graph substrate** for decomposed entities, with phased migration from D1 + Vectorize. Cloudflare Workers remain the application layer and the transactional data plane.

**UAR migration** as long-horizon consolidation, not urgency. Legacy paths work; UAR earns its way in by demonstrating parity first.

**Honest sequencing** — consumption cutover before decomposition before migration. Fix what exists before building what's new.

**Research base grounding** — Sherlock, Core-O/ESCO, Rubric-Is-All-You-Need, Cohen's/Fleiss' Kappa, retry patterns, OpenTelemetry — integrated where applicable, revised where superseded by current state, dropped where unjustified.

**Compliance and fairness as constraints throughout**, not deferred. Finite approved probe banks, HITL gates, never-auto-fail dealbreakers, audit trails. The architecture is built to stand up to regulatory scrutiny because regulatory scrutiny will arrive.

**Quality bounded by extraction and by data sources**, not by infrastructure. No amount of graph database sophistication rescues thin extraction or impoverished source data. The leverage is in the prompts, in the screener design, in the enrichment quality, in the rubric calibration.

This is a 30–50 week trajectory of focused work. Achievable. Ambitious. Aligned with what you've built and what you're reaching for.

---

*End of Part 5. End of Pipe Strategy v2.*
