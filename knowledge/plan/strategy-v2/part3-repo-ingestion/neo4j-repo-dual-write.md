# Repo Ingestion: Neo4j Dual-Write

**Source:** ADR-045
**Phase:** B (Dual-write)
**Status:** PENDING
**Estimate:** 1.5 weeks
**Cost:** $0 (dev)

---

## Purpose

Wire Neo4j graph writes into Pass 3 repo ingestion so every approved repo produces both D1 records and graph nodes. Fire-and-forget during Phase B.

---

## What Changes

### Current Pass 3 flow (D1 + Vectorize)

```
Pass 2 signals → Gemma → repo_searchable_profile (blob)
  → embed → REPO_INDEX (Vectorize)
  → write repo_engineering_signals (D1)
```

### New Pass 3 flow (D1 + Vectorize + Neo4j dual-write)

```
Pass 2 signals → Gemma → repo_searchable_profile (blob, preserved)
  → sub-elements (Feature, Pattern, ChallengeSurface, etc.)
  → embed each sub-element
  → write repo_nodes (D1, preserved)
  → NEW: writeRepoGraph (Neo4j, fire-and-forget)
  → REPO_INDEX (Vectorize, preserved during dual-write)
```

The aggregate `repo_searchable_profile` and `REPO_INDEX` upsert continue unchanged during dual-write. They are retired in Phase E.

---

## Implementation

### New file: `workers/api/src/lib/neo4j/writeRepoGraph.ts`

```typescript
import { runWrite } from './query';

export interface RepoGraphNode {
  id: string;                    // <repo_id>_<node_type>_<slug>
  node_type: string;             // Feature, ArchitecturalPattern, etc.
  narrative_text: string;        // "Feature: ..."
  embedding: number[];           // 1024 floats
  source_reference: string;      // signals_version or pr_id
  created_at: number;
}

export async function writeRepoGraph(
  repoId: number,
  fullName: string,
  adminStatus: string,
  signalsVersion: string,
  subElements: RepoGraphNode[],
  env: Env,
): Promise<void> {
  const cypher = `
    MERGE (r:Repo {repo_id: $repo_id})
    SET r.full_name = $full_name,
        r.admin_status = $admin_status,
        r.signals_version = $signals_version,
        r.updated_at = datetime().epochSeconds
    WITH r
    UNWIND $subElements AS elem
    MERGE (n:RepoNode {id: elem.id})
    SET n.narrative_text = elem.narrative_text,
        n.embedding = elem.embedding,
        n.node_type = elem.node_type,
        n.source_reference = elem.source_reference,
        n.created_at = elem.created_at
    MERGE (r)-[:HAS]->(n)
  `;

  await runWrite(cypher, {
    repo_id: repoId,
    full_name: fullName,
    admin_status: adminStatus,
    signals_version: signalsVersion,
    subElements: subElements.map(e => ({
      ...e,
      embedding: Array.isArray(e.embedding) ? e.embedding : JSON.parse(e.embedding),
    })),
  }, env);
}
```

### Patch: `workers/api/scripts/crawl-repos/pass3/run.ts`

After Gemma returns and sub-elements are validated:

```typescript
// After: await db.batch([...repo_nodes inserts...]);

if (env.DUAL_WRITE_NEO4J === 'true') {
  const subElements = pass3Output.subElements.map(se => ({
    id: `${repo.id}_${se.node_type}_${slugify(se.narrative_text)}`,
    node_type: se.node_type,
    narrative_text: se.narrative_text,
    embedding: se.embedding, // already computed during D1 write
    source_reference: se.source_reference || signalsVersion,
    created_at: now,
  }));

  // PRSample and IssueCandidate from existing tables
  const prSamples = await db.prepare(`
    SELECT * FROM repo_sample_prs WHERE repo_id = ?
  `).bind(repo.id).all();

  for (const pr of prSamples.results) {
    subElements.push({
      id: `${repo.id}_PRSample_${pr.pr_number}`,
      node_type: 'PRSample',
      narrative_text: `PRSample: ${pr.title}. ${pr.body?.slice(0, 200) || ''}`,
      embedding: pr.embedding_json ? JSON.parse(pr.embedding_json) : null,
      source_reference: `pr-${pr.pr_number}`,
      created_at: now,
    });
  }

  writeRepoGraph(repo.id, repo.full_name, repo.admin_status, signalsVersion, subElements, env)
    .catch(err => {
      console.error('[dual-write] repo graph write failed:', {
        repo_id: repo.id,
        error: err.message,
      });
    });
}
```

### Slug generation

```typescript
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 30)
    .replace(/^-|-$/g, '');
}
```

---

## Pass 3 Prompt Change

Current prompt produces single blob. New prompt produces structured JSON:

```json
{
  "architecture_style": "...",
  "engineering_narrative": "...",
  "repo_searchable_profile": "...",
  "subElements": [
    {
      "node_type": "Feature",
      "narrative_text": "Feature: React Hooks-based state management with 50+ custom hooks",
      "extracted_properties": { "scale_indicator": "50+", "technology": "React Hooks" }
    },
    {
      "node_type": "ArchitecturalPattern",
      "narrative_text": "ArchitecturalPattern: Micro-frontend architecture with module federation",
      "extracted_properties": { "pattern": "micro-frontend", "tooling": "Webpack Module Federation" }
    }
  ]
}
```

Prompt constraints:
- Enumerate features the repo **actually supports** (don't invent)
- Each narrative: 2-3 sentences, repo-specific, cite technologies and scale indicators
- Rich repos: 20+ sub-elements. Thin repos: 3-5. No forced count.
- `PRSample` and `IssueCandidate` are derived from existing tables, not Gemma

---

## Zod Validation

```typescript
import { z } from 'zod';

const RepoSubElementSchema = z.object({
  node_type: z.enum(['Feature', 'ArchitecturalPattern', 'TechnicalStack', 'Construct', 'ChallengeSurface', 'QualitySignal', 'DomainContext']),
  narrative_text: z.string().min(10).max(1000),
  extracted_properties: z.record(z.unknown()).optional(),
});

const Pass3OutputSchema = z.object({
  architecture_style: z.string(),
  engineering_narrative: z.string(),
  repo_searchable_profile: z.string(),
  subElements: z.array(RepoSubElementSchema).min(1),
});

// Validate before any D1 or Neo4j write
const validated = Pass3OutputSchema.parse(gemmaOutput);
```

---

## Backfill Script

### New file: `workers/api/scripts/backfillRepoGraph.ts`

```typescript
// Backfill all pass>=3 repos to Neo4j
// Usage: npx tsx scripts/backfillRepoGraph.ts --batch 50 --dry-run

import { getDb } from '../src/lib/db';
import { writeRepoGraph } from '../src/lib/neo4j/writeRepoGraph';

async function backfill(batchSize = 50, dryRun = false) {
  const db = getDb();

  const repos = await db.prepare(`
    SELECT id, full_name, admin_status, signals_version
    FROM qualified_repos
    WHERE pass >= 3
    ORDER BY id
    LIMIT ?
  `).bind(batchSize).all();

  for (const repo of repos.results) {
    const nodes = await db.prepare(`
      SELECT * FROM repo_nodes WHERE repo_id = ?
    `).bind(repo.id).all();

    if (dryRun) {
      console.log(`[dry-run] Would backfill repo ${repo.id} with ${nodes.results.length} nodes`);
      continue;
    }

    const subElements = nodes.results.map(n => ({
      id: n.id,
      node_type: n.node_type,
      narrative_text: n.narrative_text,
      embedding: n.embedding_json ? JSON.parse(n.embedding_json) : null,
      source_reference: n.source_reference,
      created_at: n.created_at,
    }));

    await writeRepoGraph(
      repo.id as number,
      repo.full_name as string,
      repo.admin_status as string,
      repo.signals_version as string,
      subElements as any,
      process.env as any,
    );

    console.log(`[backfill] repo ${repo.id}: ${nodes.results.length} nodes`);
  }
}

const args = process.argv.slice(2);
const batch = parseInt(args.find(a => a.startsWith('--batch'))?.split('=')[1] || '50');
const dryRun = args.includes('--dry-run');

backfill(batch, dryRun).catch(console.error);
```

---

## Dependencies

- `neo4j-driver-and-binding.md`
- `neo4j-schema-and-constraints.md`
- `repo-decomposition-schema.md` (D1 table must exist)
- `phase2-role-nodes-migration.md` (embedding model version stamp)

---

## Acceptance Criteria

- [ ] Pass 3 prompt produces `subElements` array alongside legacy fields
- [ ] Zod validation rejects malformed output before any write
- [ ] `writeRepoGraph` MERGEs repo + sub-elements with correct IDs
- [ ] `PRSample` and `IssueCandidate` derived from existing tables, not Gemma
- [ ] Pass 3 runner calls `writeRepoGraph` fire-and-forget after D1 write
- [ ] `DUAL_WRITE_NEO4J` flag gates the call
- [ ] Backfill script supports `--dry-run`, `--batch N`, `--repo-id <id>`
- [ ] Legacy `repo_searchable_profile` still populated (backward compatibility)
- [ ] `npx tsc --noEmit` passes
- [ ] `CHANGELOG.md` updated
