# Post-Screener Matching Trigger

**Owner:** Backend Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §5.2  
**Blocked by:** `implementation/decomposition-pipeline.md`, `integration/stage-progression-gate.md`  
**Blocks:** `integration/candidate-nodes-consumer.md`  

---

## 1. Problem Statement

After Mode-1 screener termination, the candidate's graph must be enriched, re-embedded, and matched. This is an async pipeline that runs in the background. The candidate sees `WAITING_FOR_MATCH` until it completes. This document specifies the exact orchestration.

## 2. Current State

No post-screener enrichment exists. What exists:
- `runCandidateIngestion()` in `orchestrate.ts` runs matching at resume upload time.
- `embedAndUpsertCandidate()` in `embed.ts` embeds the resume narrative.
- `candidate_nodes` exists but matching ignores it.

## 3. Target State

### 3.1 Pipeline flow

```
Mode-1 termination
  → cultureAgent.ts calls onInterviewComplete()
    → scoreReport = await runScoringPipeline() [waitUntil]
    → decomposition = await decomposeTranscript() [waitUntil]
      → await persistDecompositionBatch() [waitUntil]
        → c.executionCtx.waitUntil(runPostScreenerEnrichment(candidateId, env))
```

### 3.2 `runPostScreenerEnrichment` function

```typescript
// workers/api/src/lib/candidateDiscovery/postScreenerEnrichment.ts

export async function runPostScreenerEnrichment(
  candidateId: string,
  env: Env,
): Promise<void> {
  const db = env.DB;
  const vectorize = env.CANDIDATE_INDEX;

  try {
    // 1. Mark enriching
    await markCandidateEnriching(db, candidateId);

    // 2. Fetch all candidate_nodes (resume + screener)
    const nodes = await db.prepare(`
      SELECT id, node_type, narrative_text, embedding_json
      FROM candidate_nodes
      WHERE candidate_id = ? AND superseded IS NULL
    `).bind(candidateId).all<{ id: string; node_type: string; narrative_text: string; embedding_json: string | null }>();

    // 3. Embed unembedded nodes
    const nodesNeedingEmbed = nodes.results?.filter(n => !n.embedding_json) ?? [];
    for (const node of nodesNeedingEmbed) {
      const vector = await env.AI.run('@cf/baai/bge-large-en-v1.5', {
        text: [node.narrative_text],
      });
      await db.prepare(`
        UPDATE candidate_nodes SET embedding_json = ? WHERE id = ?
      `).bind(JSON.stringify(vector.data[0]), node.id).run();
    }

    // 4. Re-fetch all nodes (now all have embeddings)
    const allNodes = await db.prepare(`
      SELECT embedding_json FROM candidate_nodes
      WHERE candidate_id = ? AND superseded IS NULL
    `).bind(candidateId).all<{ embedding_json: string }>();

    // 5. Mean-pool
    const vectors = allNodes.results
      ?.map(n => safeParseEmbedding(n.embedding_json))
      .filter((v): v is number[] => v !== null && v.length === 1024) ?? [];

    if (vectors.length === 0) {
      throw new Error('No valid embeddings found for candidate');
    }

    const aggregateVector = meanPoolVectors(vectors);

    // 6. Upsert to Vectorize
    await upsertCandidateVector({
      vectorize,
      candidateId,
      vector: aggregateVector,
      metadata: {
        seniority: await getCandidateSeniority(db, candidateId),
        primary_language: await getCandidatePrimaryLanguage(db, candidateId),
        aggregate_source: 'screener_enriched',
      },
      db,
    });

    // 7. Update candidate_ingestion
    await db.prepare(`
      UPDATE candidate_ingestion
      SET status = 'enriched',
          enriched_embedding_json = ?,
          aggregate_source = 'screener_enriched',
          screener_completed_at = ?
      WHERE candidate_id = ?
    `).bind(JSON.stringify(aggregateVector), new Date().toISOString(), candidateId).run();

    // 8. Run matching
    await runCandidateMatching(candidateId, env);

  } catch (err) {
    console.error('[postScreenerEnrichment] failed:', {
      candidateId,
      error: err instanceof Error ? err.message : String(err),
    });

    await db.prepare(`
      UPDATE candidate_ingestion
      SET status = 'failed',
          error_text = ?,
          current_step = 'post_screener_enrichment'
      WHERE candidate_id = ?
    `).bind((err as Error).message.slice(0, 500), candidateId).run();
  }
}
```

### 3.3 Retry logic

```typescript
async function runPostScreenerEnrichmentWithRetry(
  candidateId: string,
  env: Env,
  maxRetries = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await runPostScreenerEnrichment(candidateId, env);
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      await sleep(delay);
    }
  }
}
```

### 3.4 Timeout and stale run detection

```sql
-- Cron job runs every 5 minutes
SELECT candidate_id FROM candidate_ingestion
WHERE status = 'enriching'
  AND screener_completed_at < datetime('now', '-10 minutes');
```

For stale runs, reset to `'embedded'` and alert recruiter.

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/candidateDiscovery/postScreenerEnrichment.ts` | **New.** Orchestrates re-embed + match trigger. |
| `workers/api/src/lib/candidateDiscovery/persist.ts` | **Modify.** Add `markCandidateEnriching()`. |
| `workers/api/src/lib/candidateDiscovery/embed.ts` | **Modify.** Add `reEmbedCandidateFromNodes()`. |
| `workers/api/src/lib/cultureAgent.ts` | **Modify.** Call `runPostScreenerEnrichment` in termination handler. |

### 4.2 Constraint check

- BGE calls: 20–30 nodes × ~300ms = 6–9s
- Vectorize upsert: 1 call
- Matching: reuses existing `runMatchAndAssign()` logic
- **Total: ~15–20s** — within Workers `waitUntil` limit (30s CPU, but `waitUntil` can run longer for I/O)

## 5. Open Questions

1. **What if embedding fails for one node?** Skip it and continue. The mean-pool will have slightly fewer vectors. Log the failure.

2. **What if the candidate has 0 resume nodes?** E.g., intake was via form, not resume. — **Recommendation:** Mean-pool of screener nodes only. The aggregate vector is still valid.

3. **Should we delete the old resume-only vector?** No. Keep it in Vectorize with `aggregate_source = 'resume_only'`. The new vector has `aggregate_source = 'screener_enriched'`. Matching reads the latest.

## 6. Validation Criteria

- **Unit test:** `runPostScreenerEnrichment` completes successfully with 20 mock nodes.
- **Unit test:** Retry logic attempts 3 times with exponential backoff.
- **E2E test:** After screener completion, candidate_ingestion.status = 'enriched' within 30s.
- **E2E test:** CANDIDATE_INDEX contains vector with `aggregate_source = 'screener_enriched'`.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| BGE rate limit hit during bulk embedding | Medium | High | Sequential calls with 100ms delay between. Alert if >30 nodes. |
| Vectorize upsert fails | Low | High | Retry with exponential backoff. Fallback: mark status = 'enriched' without vector. |
| Matching fails after enrichment | Low | High | Mark status = 'match_failed'. Recruiter can manually assign. |
| Candidate refreshes during enrichment | Medium | Low | Idempotent: re-running enrichment is safe (same nodes, same vectors). |
