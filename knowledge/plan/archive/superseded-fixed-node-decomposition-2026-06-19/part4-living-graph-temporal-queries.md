# Living Graph — Temporal Queries and Re-Engagement Triggers

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md (lines 303–318)
**Phase:** 3 / 4
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> When a candidate re-engages with Pipe (new role opens that loose-matches them, or the candidate updates their profile), the re-engagement triggers:
> - Re-enrichment of public sources if URLs exist
> - An optional abbreviated Mode 1 screener focused on dimensions that have low recency
> - Recompute loose match against any open roles
> - Recompute match reports for any role the candidate is still actively considered for
>
> "Show me this candidate's cultural profile trajectory" becomes a graph query walking CulturalSignal sub-elements ordered by captured_at, surfacing how specific dimensions evolved.

## Why
Re-engagement is the living-graph model's value proposition materialized. A candidate who applied 6 months ago and has since done significant open-source work, or whose motivation has shifted, should be matchable against new roles without a full re-ingestion. Temporal queries make this visible to recruiters and drive automated re-enrichment.

## Subtasks (delegable)

### Subtask 1 — Profile recency analysis
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`

**Spec:**
Export `analyzeProfileRecency(db, candidateId: string): Promise<RecencyReport>`. `RecencyReport = { dimensions: Record<CoverageAspect, { lastCapturedAt: number | null, nodeCount: number, staleFlag: boolean }>, overallStaleness: 'fresh' | 'partial' | 'stale' }`. `staleFlag=true` when `lastCapturedAt < Date.now() - 365 * 24 * 3600 * 1000` (12 months). `overallStaleness='stale'` when motivation and context dimensions are both stale. `'partial'` when 1-2 dimensions stale. `'fresh'` otherwise. Threshold configurable via constant `STALENESS_THRESHOLD_MS`.

**Status:** ⏳ PENDING

---

### Subtask 2 — Re-engagement trigger on new role match
**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Spec:**
Add `checkAndTriggerReEngagement(db, candidateId: string, newRoleId: string): Promise<ReEngagementPlan>`. `ReEngagementPlan = { needsReEnrichment: boolean, needsScreener: boolean, thinDimensions: CoverageAspect[], shouldRecomputeMatch: boolean }`. Logic: call `analyzeProfileRecency`. If `overallStaleness='stale'`, set `needsScreener=true` with `thinDimensions` being the stale ones. If `last_enriched_at` is null or > 6 months, set `needsReEnrichment=true` (insert new `enrichment_jobs` row if GitHub URL exists). If candidate has active nodes (non-empty graph), `shouldRecomputeMatch=true`. Log the plan. Return it — callers decide how to surface it (recruiter notification, automated invite). Do not auto-trigger the screener here; that requires recruiter consent and invite flow.

**Status:** ⏳ PENDING

---

### Subtask 3 — Dimension trajectory query (recruiter view)
**Files:**
- `workers/api/src/routes/cockpit/candidateProfile.ts`

**Spec:**
`GET /api/v1/candidates/:candidateId/profile/trajectory?dimension=<dim>` — Clerk-authed. Returns `CulturalSignal | TechnicalDemonstration` nodes for the candidate in the requested dimension, ordered by `captured_at` ASC, including superseded nodes (marked). Response shape: `{ nodes: CandidateNode[], dimensionTrend: 'improving' | 'stable' | 'declining' | 'insufficient_data' }`. `dimensionTrend` computed by comparing `bars_score` across sequential non-superseded nodes (min 3 data points for non-insufficient_data). This query is what enables "show me this candidate's cultural profile trajectory" from the strategy.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `living-graph-supersedes-schema.md`, `candidate-profile-state-schema.md`
- Depends on: `code-review-graph-decomposition.md`, `culture-interview-graph-decomposition.md` (needs assessment nodes to have temporal data worth querying)
- Blocks: nothing (observability and re-engagement feature)

## Acceptance criteria
- [ ] `analyzeProfileRecency` returns `stale` for a candidate whose most recent node is 13 months old
- [ ] `analyzeProfileRecency` returns `fresh` for a candidate with all dimensions updated within 6 months
- [ ] `checkAndTriggerReEngagement` sets `needsScreener=true` for a stale motivation dimension
- [ ] Trajectory query includes superseded nodes with `superseded_at` set
- [ ] `dimensionTrend='insufficient_data'` for a candidate with 1 data point
- [ ] `npx tsc --noEmit` clean
