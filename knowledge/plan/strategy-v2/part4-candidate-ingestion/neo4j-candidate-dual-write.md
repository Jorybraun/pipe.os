# Candidate Ingestion: Neo4j Dual-Write

**Source:** ADR-044  
**Phase:** B (Dual-write)  
**Status:** PENDING  
**Estimate:** 1 week  
**Cost:** $0 (dev)

---

## Purpose

Wire Neo4j graph writes into `runCandidateIngestion` so every candidate upload produces both D1 records and graph nodes. Fire-and-forget: Neo4j failure is non-fatal.

---

## What Changes

### Current flow (D1 only)

```
upsertPendingIngestion
  → discoverCandidateProfile (AI)
  → persistCandidateProfile
  → decomposeResumeToGraph (AI)
  → embedAndUpsertCandidate (AI + Vectorize)
  → matchReposForCandidate (Vectorize ANN + SQL)
  → candidateSituationFit (AI LLM rerank)
  → triangulateMatch
  → pickReviewPr + pickImplementationIssue
  → writeAssignment
```

### New flow (D1 + Neo4j dual-write)

```
upsertPendingIngestion
  → discoverCandidateProfile (AI)
  → persistCandidateProfile
  → decomposeResumeToGraph (AI)
    → NEW: writeCandidateGraph (Neo4j, fire-and-forget)
  → embedAndUpsertCandidate (AI + Vectorize)
  → matchReposForCandidate (Vectorize ANN + SQL)
  → candidateSituationFit (AI LLM rerank)
  → triangulateMatch
  → pickReviewPr + pickImplementationIssue
  → writeAssignment
```

The Neo4j write happens after `decomposeResumeToGraph` because that's when `candidate_nodes` exist. It is async and non-blocking.

---

## Implementation

### New file: `workers/api/src/lib/neo4j/writeCandidateGraph.ts`

```typescript
import { getNeo4jDriver } from './driver';
import { runWrite } from './query';

export interface CandidateGraphNode {
  id: string;
  node_type: string;        // Skill, Experience, Project, etc.
  narrative_text: string;
  embedding: number[];      // 1024 floats
  confidence: number;
  evidence_source?: string;
  created_at: number;
  superseded_at: number | null;
}

export async function writeCandidateGraph(
  candidateId: string,
  profileState: string,
  nodes: CandidateGraphNode[],
  env: Env,
): Promise<void> {
  const cypher = `
    MERGE (c:Candidate {candidate_id: $candidate_id})
    SET c.profile_state = $profile_state,
        c.last_engaged_at = datetime().epochSeconds,
        c.updated_at = datetime().epochSeconds
    WITH c
    UNWIND $nodes AS node
    MERGE (n:CandidateNode {id: node.id})
    SET n.narrative_text = node.narrative_text,
        n.embedding = node.embedding,
        n.confidence = node.confidence,
        n.node_type = node.node_type,
        n.evidence_source = node.evidence_source,
        n.created_at = node.created_at,
        n.superseded_at = node.superseded_at
    MERGE (c)-[:HAS]->(n)
  `;

  await runWrite(cypher, {
    candidate_id: candidateId,
    profile_state: profileState,
    nodes: nodes.map(n => ({
      ...n,
      // Ensure embedding is array of floats, not JSON string
      embedding: Array.isArray(n.embedding) ? n.embedding : JSON.parse(n.embedding),
    })),
  }, env);
}
```

### Patch: `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

After `decomposeResumeToGraph` succeeds and nodes are written to D1:

```typescript
// After: await persistCandidateNodes(candidateId, nodes, db);

if (env.DUAL_WRITE_NEO4J === 'true') {
  const graphNodes = nodes.map(n => ({
    id: n.id,
    node_type: n.node_type,
    narrative_text: n.narrative_text,
    embedding: n.embedding_json ? JSON.parse(n.embedding_json) : null,
    confidence: n.confidence ?? 0.7,
    evidence_source: n.evidence_source,
    created_at: n.created_at,
    superseded_at: n.superseded_at,
  }));

  writeCandidateGraph(candidateId, 'profile_generated', graphNodes, env)
    .catch(err => {
      console.error('[dual-write] candidate graph write failed:', {
        candidate_id: candidateId,
        error: err.message,
      });
    });
}
```

### New file: `workers/api/src/lib/neo4j/writeCandidateGraph.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { writeCandidateGraph } from './writeCandidateGraph';

const mockRunWrite = vi.fn();
vi.mock('./query', () => ({ runWrite: mockRunWrite }));

describe('writeCandidateGraph', () => {
  it('merges candidate and nodes', async () => {
    await writeCandidateGraph('cand-1', 'active', [
      {
        id: 'cand-1_skill_react',
        node_type: 'Skill',
        narrative_text: 'Skill: React',
        embedding: new Array(1024).fill(0.1),
        confidence: 0.9,
        created_at: 1234567890,
        superseded_at: null,
      },
    ], {} as Env);

    expect(mockRunWrite).toHaveBeenCalledOnce();
    const [, params] = mockRunWrite.mock.calls[0];
    expect(params.candidate_id).toBe('cand-1');
    expect(params.nodes).toHaveLength(1);
    expect(params.nodes[0].node_type).toBe('Skill');
  });

  it('parses embedding_json string if needed', async () => {
    await writeCandidateGraph('cand-2', 'active', [
      {
        id: 'cand-2_skill_ts',
        node_type: 'Skill',
        narrative_text: 'Skill: TypeScript',
        embedding: JSON.stringify(new Array(1024).fill(0.2)),
        confidence: 0.85,
        created_at: 1234567890,
        superseded_at: null,
      },
    ], {} as Env);

    const [, params] = mockRunWrite.mock.calls[0];
    expect(Array.isArray(params.nodes[0].embedding)).toBe(true);
    expect(params.nodes[0].embedding).toHaveLength(1024);
  });
});
```

---

## Backfill Script

### New file: `workers/api/scripts/backfillCandidateGraph.ts`

```typescript
// Backfill all candidates with nodes but no Neo4j entry
// Usage: npx tsx scripts/backfillCandidateGraph.ts --batch 100 --dry-run

import { getDb } from '../src/lib/db';
import { writeCandidateGraph } from '../src/lib/neo4j/writeCandidateGraph';

async function backfill(batchSize = 100, dryRun = false) {
  const db = getDb();

  // Find candidates with nodes but no Neo4j entry
  // (We track this via a new column or just backfill all)
  const candidates = await db.prepare(`
    SELECT c.candidate_id, c.profile_state
    FROM candidates c
    JOIN candidate_nodes n ON n.candidate_id = c.candidate_id
    WHERE c.profile_state IN ('enriched', 'matched')
    GROUP BY c.candidate_id
    LIMIT ?
  `).bind(batchSize).all();

  for (const row of candidates.results) {
    const nodes = await db.prepare(`
      SELECT * FROM candidate_nodes
      WHERE candidate_id = ? AND superseded_at IS NULL
    `).bind(row.candidate_id).all();

    if (dryRun) {
      console.log(`[dry-run] Would backfill ${row.candidate_id} with ${nodes.results.length} nodes`);
      continue;
    }

    await writeCandidateGraph(
      row.candidate_id as string,
      row.profile_state as string,
      nodes.results as any,
      process.env as any,
    );

    console.log(`[backfill] ${row.candidate_id}: ${nodes.results.length} nodes`);
  }
}

const args = process.argv.slice(2);
const batch = parseInt(args.find(a => a.startsWith('--batch'))?.split('=')[1] || '100');
const dryRun = args.includes('--dry-run');

backfill(batch, dryRun).catch(console.error);
```

---

## Dependencies

- `neo4j-driver-and-binding.md` (driver must work in Workers)
- `neo4j-schema-and-constraints.md` (schema must exist)
- `candidate-nodes-schema.md` (D1 table must exist)
- `candidate-sub-element-embedding.md` (nodes must have embeddings)

---

## Acceptance Criteria

- [ ] `writeCandidateGraph` exports MERGE Cypher for candidate + nodes
- [ ] `orchestrate.ts` calls `writeCandidateGraph` after `decomposeResumeToGraph`
- [ ] Call is fire-and-forget: wrapped in `.catch()`, does not block D1 path
- [ ] `DUAL_WRITE_NEO4J` feature flag gates the call
- [ ] Unit tests verify MERGE semantics and parameter passing
- [ ] Backfill script supports `--dry-run`, `--batch N`
- [ ] Backfill script runs against local Neo4j without errors
- [ ] `npx tsc --noEmit` passes
- [ ] `CHANGELOG.md` updated
