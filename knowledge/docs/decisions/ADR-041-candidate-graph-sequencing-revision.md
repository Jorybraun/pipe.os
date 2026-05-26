# ADR-041: Candidate Graph Sequencing Revision

**Date:** 2026-05-01
**Status:** Accepted
**Deciders:** Backend team, Founder

---

## Context

The original Part 4 strategy prescribed a strict sequence:

1. Phase 0: Hygiene (cache, prompt v3, version stamps) — **Done**
2. Phase 1: Resume decomposition into `candidate_nodes` — **Not done**
3. Phase 2: Public data enrichment — **Partially done**
4. Phase 3: Screener (mode-aware, probe bank, coverage) — **Partially done**
5. Phase 4: Assessment decomposition — **Done**

What actually happened: Phase 0 → Phase 4 → Phase 2 (light) → Phase 3 (infrastructure only). The graph substrate (`candidate_nodes`, `candidate_coverage`) exists and is populated by assessments and GitHub enrichment, but the resume — the primary seed signal — still produces a flat narrative. This is a material architectural reversal: the leaves were built before the trunk.

This ADR documents the decision to **add the seed retroactively** and specifies how it coexists with the existing graph.

---

## Decision

We will implement **resume decomposition as a hybrid parser + LLM pipeline** that feeds `candidate_nodes` retroactively. The graph will carry nodes from three source families:

- `resume` — seed nodes (Experience, Project, Skill, Education, Credential, CareerArc)
- `github_enrichment` — public data nodes (Project, Skill, WorkingStyle)
- `assessment` — validated nodes (TechnicalDemonstration, CulturalSignal, WorkingStyle)

Matching will consume all three families with source-aware confidence weighting. Assessment nodes retain priority for their dimensions because they represent validated signal.

---

## Alternatives Considered

### Option A — Full LLM Decomposition (Original Plan)
- **Pros:** Highest fidelity; single prompt produces all sub-element types with rich narratives.
- **Cons:** 3–4× per-candidate LLM cost; backfill of historical resumes is prohibitively expensive; risk of hallucinated Experience nodes.
- **Verdict:** Rejected. Too expensive for a retroactive seed, and the parser already extracts structured facts.

### Option B — Parser-Only Decomposition
- **Pros:** Near-zero cost; deterministic; fast.
- **Cons:** Narratives are thin; no CareerArc synthesis; Skill proficiency is binary (mentioned vs not mentioned); misses projects embedded in experience descriptions.
- **Verdict:** Rejected. Insufficient signal for matching. The whole point of decomposition is richer per-element matching.

### Option C — Hybrid Parser + LLM (Chosen)
- **Pros:** Parser provides skeleton (companies, dates, titles, skills, schools, certifications), reducing LLM input size and hallucination surface. LLM enriches narratives, derives CareerArc, scores Skill proficiency, and identifies Projects nested in Experience descriptions. Cost is ~1.5× current extraction instead of 3–4×.
- **Cons:** Two passes (parser + LLM) adds latency to intake. Parser quality caps extraction quality for badly formatted resumes.
- **Verdict:** Accepted. Best cost/fidelity trade-off. Parser already exists; we only add the enrichment/decomposition pass.

---

## Rationale

The original plan assumed resume decomposition would be built first, providing the seed for all downstream graph growth. In practice, assessment decomposition (Phase 4) was built first because it was higher-ROI and had clearer product demand. This created a graph that is healthy and populated but missing its primary upstream source.

Rather than restarting from Phase 1 and discarding the existing graph work, we chose to retroactively add the seed. The hybrid approach minimizes cost and risk: the parser handles structured extraction deterministically, and the LLM only enriches what the parser found. This keeps per-candidate costs predictable (~$0.10 vs ~$0.30) while still producing rich, matchable nodes.

Assessment nodes retain priority because they represent validated, elicited signal. Resume nodes fill gaps where assessment nodes are absent. This preserves the existing matching behavior while improving coverage for thin profiles.

---

## Consequences

### Positive
- The graph finally has a seed. Matching quality improves for all new intakes immediately, and for historical candidates steadily.
- The hybrid approach keeps LLM costs predictable (~$0.10 per candidate vs $0.30+ for full LLM).
- Assessment nodes retain priority, so existing matching behavior is preserved; resume nodes only add signal where assessment nodes are absent.
- No schema breakage. `candidate_nodes` already supports all required types and provenance fields.

### Negative / Trade-offs
- Resume decomposition adds ~2–4s to intake latency (parser is synchronous, LLM enrichment is a second call).
- Historical candidates without assessments will see the biggest matching quality jump; candidates with rich assessments will see marginal improvement. This creates a "two-tier" candidate pool during backfill.
- `candidateSituationFit` prompt will grow larger as it consumes Experience/Project/Skill nodes, potentially requiring token budget increases or stricter capping.

### Risks
- **Parser + LLM drift:** If the parser extracts a company name wrong, the LLM may hallucinate a narrative around it. Mitigation: parser output is labeled as "extracted facts" in the LLM prompt, with anti-hallucination rules. The raw resume text is also provided for verification.
- **Coverage computation bias:** `candidate_coverage` currently weights all nodes equally. Resume-derived nodes may inflate coverage scores without validated depth. Mitigation: source-aware coverage weighting (assessment nodes count more than resume nodes).
- **Backfill cost surprise:** If the parser fails on a large fraction of historical resumes, the backfill may produce low-quality nodes. Mitigation: dry-run the backfill on 50 candidates and audit output before scaling to the full 1500.

---

## Key Sub-Decisions

### Duplicate Handling: Resume vs Assessment Nodes
When a resume-derived `Skill` node for "TypeScript" coexists with a code-review-derived `TechnicalDemonstration` that demonstrates TypeScript debugging:

- **Decision:** Keep separate. Do not merge.
- **Rationale:** Provenance is load-bearing for compliance (NYC LL144, EU AI Act Art 14) and for matching explainability. The matching layer already filters by `source_type` and `confidence`. We add a `source_family` weight to the matching algorithm instead of collapsing nodes.
- **Matching weight hierarchy:** `technical_interview` > `code_review_session` > `implementation_challenge` > `automated_screener` > `github_enrichment` > `resume`.

### Screener Hosting: Standalone vs Assessment-Linked
The screener `profile_builder` mode needs to run pre-match, but `culture_interview_sessions` is assessment-linked.

- **Decision:** Extend `culture_interview_sessions` with nullable `challenge_id` and `assessment_id` for Mode 1. A new `screening_sessions` table is deferred until the schema becomes unwieldy.
- **Rationale:** Minimizes migration scope. The adaptive agent infrastructure (`cultureAgentAdaptive.ts`) already supports `profile_builder` mode. The route handler can accept a null assessment context. If Mode 1 volume grows or compliance requires stricter separation, we split tables in a later phase.

### Backfill Strategy
- **Decision:** Nightly rate-limited cron, 10 candidates/hour, starting with most-recently-active candidates.
- **Rationale:** Avoids a big-bang backfill that blocks the release. Historical candidates who never engaged beyond intake are lower priority. The cron uses the same decomposition pipeline as live intake to guarantee parity.

---

## Follow-up

- **Execution plan:** [`/Users/hans/.kimi/plans/sif-tempest-starman.md`](/Users/hans/.kimi/plans/sif-tempest-starman.md) — 5-phase detailed plan with subtasks, file ownership, and migration sequencing.
- **Handoff document:** [`docs/handoffs/2026-05-01-candidate-ingestion-resume-decomposition-handoff.md`](/Users/hans/Code/PIPE/PIPE-OS/docs/handoffs/2026-05-01-candidate-ingestion-resume-decomposition-handoff.md) — single-file comprehensive agent briefing (contains full ADR, all phases, file map, gotchas, and testing strategy).
- **Original strategy:** [`knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md`](/Users/hans/Code/PIPE/PIPE-OS/knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md) — the north star document that defined the living graph reframe.
- **Update Part 4 INDEX:** Mark original Phase 1 plans as superseded by this revised sequencing.
- **Weight tuning:** After 50+ new decomposed candidates, run offline analysis to compare match_feedback thumbs for decomposed vs non-decomposed candidates.
