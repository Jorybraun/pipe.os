# ADR-050: Graph-First Culture Interview Questioning

**Date:** 2026-06-10
**Status:** Proposed
**Deciders:** Jory Braun, Devin

---

## Context

The culture interview's stated purpose is to build the candidate graph (`candidate_nodes` → Neo4j) that drives repo matching for code review / live coding interviews (`matchReposForCandidateNeo4j` in `workers/api/src/lib/neo4j/matchingQueries.ts`). In practice the interview is question-first, not graph-first:

1. **Main questions** are now LLM-generated (PR #43 wired in `cultureGenerativePlanner.ts`), but the planner optimizes for covering the 6 static culture dimensions — not for filling gaps in the graph the matcher actually consumes.
2. **Follow-up probes** still come from a fixed STAR-slot template bank ("What actions did you take?", "How did you become aware of this situation?"). Verified in live transcripts: probes are generic, frequently redundant with the answer already given, and their answers decompose into low-signal graph nodes.
3. **The matcher consumes embeddings of candidate nodes** compared against repo sub-elements of types `Feature`, `TechnicalStack`, `ArchitecturalPattern`, `PRSample` (cosine sim ≥ 0.55, score = avg(sim) × log(1 + match_count)). Generic answers ("I communicated with my team") produce generic nodes with near-uniform similarity to everything — measured top-5 score spreads of 0.8–1.6% in this session's rubric evaluation.
4. **The CV graph is ignored at interview time.** Candidates with an ingested CV (skills, projects, stack already in the graph) still get generic openers; the interview re-collects what the graph already knows instead of deepening weak nodes.
5. **Termination is a fixed question budget**, not graph sufficiency — interviews can end with thin graphs or waste turns after the graph is already rich.

Constraints: keep the existing FSM (`cultureInterviewState.ts`) and the agent route contract; no schema change to `candidate_nodes`; per-turn latency must stay within one LLM call for planning.

---

## Decision

Invert the planner: every interview turn is selected to maximize expected contribution to the candidate graph that `matchReposForCandidateNeo4j` consumes. Questions and probes are generated from the current graph state (CV nodes + nodes extracted so far), and the interview terminates on graph coverage, not a fixed budget.

---

## Design

### 1. Graph-gap planner input
Before each turn, build a `GraphCoverageSummary` from active `candidate_nodes`:

```ts
interface GraphCoverageSummary {
  nodesByType: Record<NodeType, { count: number; avgConfidence: number; topNarratives: string[] }>;
  // node types the matcher consumes, mirrored from repo-side:
  // TechnicalStack-like (skills/tools), Feature-like (things built),
  // ArchitecturalPattern-like (design decisions), plus CulturalSignal
  gaps: Array<{ nodeType: NodeType; reason: 'missing' | 'low_confidence' | 'no_named_entity' }>;
}
```

The planner prompt receives this summary plus the transcript, and must target the highest-value gap. Each generated question carries `targetGap` metadata for auditability.

### 2. CV-seeded opener
If the candidate has graph nodes at interview start (CV ingested), Q1 is generated from the weakest high-value node instead of `ownership-001`:
> "Your CV mentions Kafka at Streamline Data — what part of that pipeline did you own end-to-end?"

Bank opener remains the fallback only when the graph is empty.

### 3. Generative, gated probes (kill the STAR template bank)
After each answer, run the existing extraction; probe **only if** the answer yielded no extractable node (no named technology, project, person, decision, or outcome). The probe is LLM-written, must quote the candidate's words, and must name the missing entity type:
> "You said you 'rebuilt the ingestion layer' — what did you rebuild it with, and what did you replace?"

One probe max per question. Delete `PROBE_LIBRARY` lookups from the advance path.

### 4. Coverage-based termination
Terminate when `GraphCoverageSummary` has ≥ N high-confidence nodes per matcher-consumed type (suggested start: 3 TechnicalStack, 2 Feature, 1 ArchitecturalPattern, 3 CulturalSignal), bounded by the existing min/max turn caps as safety rails.

### 5. Per-turn contribution scoring (telemetry first)
Log `nodes_added`, `nodes_strengthened`, and `targetGap` per turn to the existing audit log. No automatic pruning yet — collect data first, prune question strategies in a follow-up once we can see which turns add nothing.

---

## Alternatives Considered

### Option A — Graph-first planner (chosen)
- **Pros:** Interview output is exactly what matching consumes; eliminates generic probes; shorter interviews for strong CVs; auditable (`targetGap` per question).
- **Cons:** Planner prompt grows (graph summary + transcript); coverage thresholds need tuning; extraction quality becomes load-bearing.

### Option B — Keep dimension-first planning, make probes generative only
- **Pros:** Small change; fixes the most visible symptom (generic probes).
- **Cons:** Doesn't fix redundant questions for CV-rich candidates, fixed budgets, or low matcher signal; the graph stays a side effect rather than the goal.

### Option C — Drop the interview's matching role; match on CV ingestion only
- **Pros:** Simplest; standalone code-review flow already proves CV-only matching works.
- **Cons:** Wastes the interview's signal entirely; cultural/working-style nodes (CulturalSignal) are unobtainable from a CV; contradicts the product thesis that the interview builds the graph.

---

## Rationale

The rubric evaluation in this session showed matching quality is limited by node quality, not matcher logic: near-uniform similarities (avg 0.785 vs the 0.55 threshold) mean ranking degenerates to node counting. The highest-leverage fix is making every interview turn produce a discriminative node. Option B fixes tone but not signal; Option C abandons the differentiator. Option A makes the interview literally an interactive graph builder, which is its stated purpose.

---

## Consequences

### Positive
- Probes reference the candidate's actual words; no more template probes.
- CV-rich candidates skip redundant questions; interviews end when the graph is sufficient.
- Matching gains discriminative nodes; per-turn telemetry shows which questions earn their keep.

### Negative / Trade-offs
- Extraction failures now cause extra probes (mitigated by the one-probe-per-question cap).
- Coverage thresholds are new tunables; bad values shorten or lengthen interviews.
- Slightly larger planner prompt per turn.

### Risks
- LLM-written probes can drift off-policy → keep the per-question quality gate (anchored? non-duplicate? targets a gap?) with bank fallback after N regeneration failures, and log every fallback (never silent).
- Coverage-based termination could end interviews before scoring dimensions have evidence → termination requires BOTH graph coverage and the scorer's existing minimum-dimension coverage.

---

## Follow-up

- Implement `GraphCoverageSummary` builder + planner prompt changes in `cultureGenerativePlanner.ts` / `cultureAgentContext.ts`.
- Replace probe-library lookup in `cultureAgent.ts` advance path with the extraction-gated generative probe.
- Tune coverage thresholds against the seeded repo graph (1,746 matchable RepoNodes locally).
- Follow-up ADR once telemetry exists: automatic pruning of low-contribution question strategies.
- Related: standalone match path should pass the candidate embedding to `pickReviewPr` (gap found in rubric evaluation, tracked separately).
