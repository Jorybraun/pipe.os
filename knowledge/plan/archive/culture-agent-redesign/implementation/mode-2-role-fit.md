# Mode-2: Role Fit Specification

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §4.2  
**Blocked by:** `architecture/agent-flow-spec.md`, `implementation/mode-1-profile-builder.md`  
**Blocks:** `integration/candidate-nodes-consumer.md`  

---

## 1. Problem Statement

Mode-2 is the existing production culture interview, repositioned. It runs after matching, with RCD-enriched probes, team-calibrated BARS anchors, and a required HITL gate. The key change: its decomposition output now writes to `candidate_nodes` with `source_type = 'culture_interview'`, and Mode-2 nodes may supersede Mode-1 nodes for the same dimension.

## 2. Current State

The current Mode-2 (`cultureAgent.ts` + `cultureAgentAdaptive.ts`):
- Trigger: Candidate reaches `CULTURAL` stage in assessment pipeline.
- Probe bank: `role_probe_bank` (existing) + RCD-enriched probes.
- BARS anchors: Team-specific overrides from `role_contexts.rcd_json`.
- Output: Score report in `culture_interview_sessions.score_report_json`.
- Decomposition: Writes to logs only.
- HITL gate: Required.

**What works:** Keep all of it. The scoring pipeline, compliance audit, and HITL gate are production-grade.

**What changes:**
1. Decomposition writes to `candidate_nodes` (not logs).
2. Mode-2 nodes supersede Mode-1 nodes for same dimension.
3. The FSM adopts the new phase architecture (rapport → probing → drilling → wrap_up → scoring).

## 3. Target State

### 3.1 Trigger

```
Candidate completes CODE_REVIEW stage
  → get-stage-config returns CULTURAL stage
  → Mode-2 interview starts
  → RCD loaded from role_contexts
  → role_probe_bank loaded + RCD-enriched probes merged
```

### 3.2 Probe bank

**Existing table:** `role_probe_bank`

**RCD enrichment:**
- `teamContext.barsOverrides` → override BARS anchor text per dimension.
- `teamContext.dealbreakers` → add dealbreaker probes to bank.
- `teamContext.teamStories` → add story-based probes.

**Merge logic:**
```typescript
function buildMode2ProbeBank(
  baseBank: RoleProbe[],
  rcd: CultureTeamContext,
): Mode2Probe[] {
  const enriched = baseBank.map(probe => ({
    ...probe,
    barsAnchors: rcd.barsOverrides.find(o => o.dimension === probe.dimension)?.overrideAnchorText
      ?? probe.barsAnchors,
  }));

  const dealbreakerProbes = rcd.dealbreakers.map(d => ({
    id: `db-${d.pattern.slice(0, 20)}`,
    dimension: 'cultural', // dealbreakers map to competency dimensions
    text: buildDealbreakerProbe(d),
    source: 'rcd_enriched',
    rcdVersion: rcd.rcdVersion,
  }));

  return [...enriched, ...dealbreakerProbes];
}
```

### 3.3 BARS calibration

**Current:** `cultureScorer.ts:195–299` has inline BARS rubrics.

**Target:** BARS anchors are loaded from RCD overrides, with inline defaults as fallback.

```typescript
function getBarsAnchors(
  dimension: CompetencyDimension,
  rcd: CultureTeamContext | null,
): BarsAnchors {
  const override = rcd?.barsOverrides.find(o => o.dimension === dimension);
  if (override) {
    return parseOverrideAnchors(override.overrideAnchorText);
  }
  return DEFAULT_BARS_ANCHORS[dimension];
}
```

### 3.4 Temporal layering

When Mode-2 writes nodes, it checks for existing Mode-1 nodes:

```typescript
async function writeMode2Nodes(
  db: D1Database,
  candidateId: string,
  nodes: CandidateNodeDraft[],
  sessionId: string,
): Promise<void> {
  for (const node of nodes) {
    // Check for existing Mode-1 node of same type + dimension
    const existing = await db.prepare(`
      SELECT id FROM candidate_nodes
      WHERE candidate_id = ? AND node_type = ?
        AND json_extract(extracted_properties_json, '$.dimension') = ?
        AND source_type = 'automated_screener'
        AND superseded IS NULL
      ORDER BY captured_at DESC
      LIMIT 1
    `).bind(candidateId, node.nodeType, node.dimension).first();

    const nodeId = cryptoRandomId();

    await db.prepare(`
      INSERT INTO candidate_nodes (...)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nodeId, candidateId, node.nodeType, node.narrativeText,
      JSON.stringify(node.extractedProperties),
      null, // embedding filled later
      'culture_interview', sessionId, Date.now(), node.confidence,
      existing?.id ?? null // supersedes
    ).run();

    if (existing) {
      await db.prepare(`
        UPDATE candidate_nodes
        SET superseded = ?, superseded_at = ?
        WHERE id = ?
      `).bind(nodeId, Date.now(), existing.id).run();
    }
  }
}
```

### 3.5 Mode-2 consumes Mode-1

The Mode-2 prompt includes the candidate's Mode-1 nodes:

```markdown
# Prior screening (Mode-1)
The candidate completed a profile-building screener. Here is what we learned:
- ownership: "quote" (score_estimate: 4)
- collaboration: "quote" (score_estimate: 3)
...

Do NOT re-ask questions that were well-answered in Mode-1. Go deeper on dimensions where Mode-1 signal was thin.
```

This prevents interview fatigue. Total candidate-facing time: Mode-1 (10–15 min) + Mode-2 (10–15 min) = 20–30 min, not 40+ min of repetition.

### 3.6 Output

On termination:
1. Run scoring pipeline (11 LLM calls, parallel, in `waitUntil`).
2. Write score report to `culture_interview_sessions.score_report_json`.
3. Batch write nodes to `candidate_nodes` with `source_type = 'culture_interview'`.
4. Update `candidate_nodes` superseded pointers.
5. HITL gate: recruiter reviews score report.
6. **No re-embed, no re-match.** Matching already happened. Mode-2 enriches graph for future role switches.

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/cultureAgent.ts` | **Modify.** Add Mode-2 path. Load RCD context. Use `role_probe_bank`. |
| `workers/api/src/lib/cultureScorer.ts` | **Modify.** Load BARS anchors from RCD overrides. Keep inline defaults as fallback. |
| `workers/api/src/lib/cultureAgentDecomposition.ts` | **Modify.** Add `supersedes` logic for Mode-2 nodes. |
| `workers/api/src/routes/screening/culture.ts` | **Modify.** Cache RCD + probe bank at session start. |

### 4.2 Session caching

```typescript
// At session creation (consent handler)
const roleContext = await resolveCultureRoleContext(db, assessmentId);
const probeBank = roleContext.teamContext
  ? await loadRoleProbeBank(db, roleContext.teamContext.roleContextId)
  : EMPTY_PROBE_BANK;

// Store in session row
await db.prepare(`
  UPDATE culture_interview_sessions
  SET role_context_json = ?, probe_bank_json = ?
  WHERE id = ?
`).bind(
  JSON.stringify(roleContext),
  JSON.stringify(probeBank),
  sessionId
).run();
```

This eliminates the 10 round-trips for static data.

## 5. Open Questions

1. **Should Mode-2 re-trigger matching?** If Mode-2 reveals a dealbreaker, the candidate should not proceed. But the match already happened. — **Recommendation:** No re-match. Dealbreaker flags surface in recruiter dashboard. Recruiter can manually reject.

2. **What if RCD changes between Mode-1 and Mode-2?** E.g., recruiter updates RCD after Mode-1. — **Recommendation:** Use RCD version at session creation time. Store `rcd_version` in session row. Do not re-resolve mid-interview.

3. **Should Mode-2 nodes be embedded?** Mode-2 does not trigger matching, so embedding seems wasted. — **Recommendation:** Embed anyway. Future role switches or re-matching will need them. Embedding is cheap (~300ms per node).

## 6. Validation Criteria

- **Unit test:** `buildMode2ProbeBank` correctly merges base bank + dealbreaker probes.
- **Unit test:** `getBarsAnchors` returns RCD override when present, default otherwise.
- **E2E test:** Mode-2 interview does not re-ask questions well-answered in Mode-1.
- **E2E test:** After Mode-2, `candidate_nodes` has `source_type = 'culture_interview'` with `supersedes` pointers where applicable.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mode-2 interview feels repetitive after Mode-1 | Medium | High | Consume Mode-1 nodes in prompt; skip well-covered dimensions |
| RCD loading fails mid-interview | Low | High | Cache at session start; fallback to default anchors |
| Dealbreaker probe is too obvious | Medium | High | Frame dealbreaker as behavioral question, not direct ask |
| Supersedes logic creates orphan nodes | Low | Medium | Application-level enforcement; periodic cleanup job |
