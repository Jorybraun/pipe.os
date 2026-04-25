# Screener Answer Decomposition — Single-Turn Sub-Element Extraction

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 181–183, 188–189)
**Phase:** 3
**Status:** PENDING
**Estimate:** 1.5 weeks

## Source quote
> Each answer is sent to the same LLM extraction pipeline used for resumes (but in single-answer mode rather than full-document mode). The output is a typed sub-element array. These attach to the candidate's graph with `source_type='automated_screener'`, `source_reference=<screening_session_id>`, confidence scored by the extraction LLM, captured_at set to the turn timestamp.
>
> Build `candidate_coverage` computation. A function that reads the candidate's non-superseded sub-elements and computes per-dimension completeness.

## Why
The screener's value is proportional to the quality of the sub-element extraction from each answer. A vague extraction prompt produces thin nodes that don't move coverage scores. A well-designed single-answer prompt that receives both the answer and the current candidate graph state produces rich, calibrated nodes that genuinely advance the profile.

## Subtasks (delegable)

### Subtask 1 — Single-answer decomposition prompt
**Files:**
- `workers/api/src/lib/candidateDiscovery/prompts.ts`

**Spec:**
Add `buildScreenerAnswerDecompositionPrompt(probe: string, answer: string, existingNodeSummaries: CandidateNodeSummary[]): string`. The prompt provides Gemma with: (1) the probe question asked, (2) the candidate's answer, (3) a summary of existing graph nodes (type + narrative headline, max 10 existing nodes to stay within context). Instructs Gemma to extract sub-elements as a JSON array: each item has `node_type`, `narrative_text` (2-3 sentences, third person), `extracted_properties`, `confidence` (0–1), and `updates_existing_node_id` (optional — if the answer clearly updates an existing node, reference its id for supersession). Prompt must specify: JSON only, no commentary, no markdown. Version tag: `screener-decomp-v1`.

**Status:** ⏳ PENDING

---

### Subtask 2 — Answer decomposition runner
**Files:**
- `workers/api/src/lib/candidateDiscovery/extractCandidateNodes.ts`

**Spec:**
Add `extractNodesFromScreenerAnswer(probe: string, answer: string, candidateId: string, sessionId: string, turnTimestamp: number, db: D1Database, ai: Ai): Promise<CandidateNode[]>`. Fetches existing node summaries via `getActiveCandidateNodes(db, candidateId)` (first 10 by recency). Calls `buildScreenerAnswerDecompositionPrompt`. JSON.parses LLM response. Validates shape. For each returned node: call `insertCandidateNode` with `source_type='automated_screener'`, `source_reference=sessionId`, `captured_at=turnTimestamp`. If `updates_existing_node_id` is set: call `supersedeCandidateNode` atomically. Call `embedCandidateNode` for each new node. Returns all inserted nodes. Throws on parse failure.

**Status:** ⏳ PENDING

---

### Subtask 3 — Wire into screener FSM turn processing
**Files:**
- `workers/api/src/lib/agents/culture/cultureAgent.ts`

**Spec:**
In the Mode-1 turn-processing path (after recording the candidate's answer), call `extractNodesFromScreenerAnswer`. Catch any decomposition errors and log `[cultureAgent] decomposition failed on turn <N>, continuing` — decomposition failure must not abort the screening session. After successful extraction, call `computeCandidateCoverage(db, candidateId)` to update coverage and determine next probe target. The updated `next_probe_target` drives the next probe selection. Coverage update feeds back into termination check.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md`, `candidate-decomposition-prompt.md` (reuses extraction patterns), `screener-coverage-computation.md`, `screener-mode-generalization.md`
- Blocks: `candidate-profile-view.md` (screener nodes are what make the profile interesting post-launch)

## Acceptance criteria
- [ ] `extractNodesFromScreenerAnswer` produces >= 1 node for a substantive mock answer
- [ ] `updates_existing_node_id` causes supersession atomically (old node has `superseded_at` set)
- [ ] Decomposition failure on a turn doesn't abort the session — next turn proceeds
- [ ] All new nodes have `source_type='automated_screener'` and correct `source_reference`
- [ ] `captured_at` equals the turn timestamp, not server insert time
- [ ] Coverage recomputed after each turn and written to `candidate_coverage`
- [ ] `npx tsc --noEmit` clean
