# Role Discovery: Neo4j Dual-Write

**Source:** ADR-046
**Phase:** B (Dual-write)
**Status:** PENDING
**Estimate:** 1 week
**Cost:** $0 (dev)

---

## Purpose

Wire Neo4j graph writes into RCD synthesis so every role context document produces both D1 records and graph nodes with weighted edges. Fire-and-forget during Phase B.

---

## What Changes

### Current RCD flow (D1 + Vectorize)

```
Stakeholder inputs → RCD synthesis (Gemma) → role_contexts.rcd_json
  → role_searchable_profile (blob)
  → embed → ROLE_INDEX (Vectorize)
  → role_nodes (D1, optional)
```

### New RCD flow (D1 + Vectorize + Neo4j dual-write)

```
Stakeholder inputs → RCD synthesis (Gemma) → role_contexts.rcd_json
  → decomposeRcdIntoNodes (11 types)
  → embed each node
  → persistRoleNodes (D1)
  → NEW: writeRoleGraph (Neo4j, fire-and-forget)
  → ROLE_INDEX (Vectorize, preserved during dual-write)
```

---

## Implementation

### New file: `workers/api/src/lib/neo4j/writeRoleGraph.ts`

```typescript
import { runWrite } from './query';

export interface RoleGraphNode {
  id: string;
  node_type: string;
  narrative_text: string;
  embedding: number[];
  weight?: number;
  strength?: string;
  source_section?: string;
  affected_node_ids?: string[];
  created_at: number;
}

export async function writeRoleGraph(
  roleContextId: string,
  pipelineId: string,
  rcdVersion: string,
  nodes: RoleGraphNode[],
  env: Env,
): Promise<void> {
  const cypher = `
    MERGE (r:Role {role_context_id: $role_context_id})
    SET r.pipeline_id = $pipeline_id,
        r.rcd_version = $rcd_version,
        r.updated_at = datetime().epochSeconds

    WITH r
    // Requirements with weighted edges
    UNWIND [n IN $nodes WHERE n.node_type = 'Requirement'] AS req
    MERGE (reqNode:RoleNode:Requirement {id: req.id})
    SET reqNode.narrative_text = req.narrative_text,
        reqNode.embedding = req.embedding,
        reqNode.weight = req.weight,
        reqNode.source_section = req.source_section,
        reqNode.created_at = req.created_at
    MERGE (r)-[:HAS_REQUIREMENT {weight: req.weight}]->(reqNode)

    WITH r
    // Dealbreakers with strength edges
    UNWIND [n IN $nodes WHERE n.node_type = 'Dealbreaker'] AS db
    MERGE (dbNode:RoleNode:Dealbreaker {id: db.id})
    SET dbNode.narrative_text = db.narrative_text,
        dbNode.embedding = db.embedding,
        dbNode.job_relatedness_strength = db.strength,
        dbNode.created_at = db.created_at
    MERGE (r)-[:HAS_DEALBREAKER {strength: db.strength}]->(dbNode)

    WITH r
    // Cultural signals
    UNWIND [n IN $nodes WHERE n.node_type = 'CulturalSignal'] AS cs
    MERGE (csNode:RoleNode:CulturalSignal {id: cs.id})
    SET csNode.narrative_text = cs.narrative_text,
        csNode.embedding = cs.embedding,
        csNode.source_section = cs.source_section,
        csNode.created_at = cs.created_at
    MERGE (r)-[:HAS]->(csNode)

    WITH r
    // Technical context
    UNWIND [n IN $nodes WHERE n.node_type = 'TechnicalContext'] AS tc
    MERGE (tcNode:RoleNode:TechnicalContext {id: tc.id})
    SET tcNode.narrative_text = tc.narrative_text,
        tcNode.embedding = tc.embedding,
        tcNode.created_at = tc.created_at
    MERGE (r)-[:HAS]->(tcNode)

    WITH r
    // Conflicts (with BETWEEN edges)
    UNWIND [n IN $nodes WHERE n.node_type = 'Conflict'] AS cf
    MERGE (cfNode:RoleNode:Conflict {id: cf.id})
    SET cfNode.narrative_text = cf.narrative_text,
        cfNode.created_at = cf.created_at
    MERGE (r)-[:HAS_CONFLICT]->(cfNode)
    WITH r, cfNode, cf
    UNWIND cf.affected_node_ids AS affectedId
    MATCH (affected:RoleNode {id: affectedId})
    MERGE (cfNode)-[:BETWEEN]->(affected)
  `;

  await runWrite(cypher, {
    role_context_id: roleContextId,
    pipeline_id: pipelineId,
    rcd_version: rcdVersion,
    nodes: nodes.map(n => ({
      ...n,
      embedding: Array.isArray(n.embedding) ? n.embedding : JSON.parse(n.embedding),
    })),
  }, env);
}
```

### Patch: `workers/api/src/lib/roleAgent/synthesizeRcd.ts`

After RCD is written to D1 and decomposed:

```typescript
// After: await persistRoleNodes(nodes, env, db);

if (env.DUAL_WRITE_NEO4J === 'true') {
  const graphNodes = nodes.map(n => ({
    id: n.id,
    node_type: n.node_type,
    narrative_text: n.narrative_text,
    embedding: n.embedding_json ? JSON.parse(n.embedding_json) : null,
    weight: n.weight,
    strength: n.node_type === 'Dealbreaker' ? 
      JSON.parse(n.extracted_properties_json || '{}').job_relatedness_strength : undefined,
    source_section: n.source_section,
    affected_node_ids: n.node_type === 'Conflict' ?
      JSON.parse(n.extracted_properties_json || '{}').affected_node_ids : undefined,
    created_at: n.created_at,
  }));

  writeRoleGraph(roleContextId, pipelineId, rcdVersion, graphNodes, env)
    .catch(err => {
      console.error('[dual-write] role graph write failed:', {
        role_context_id: roleContextId,
        error: err.message,
      });
    });
}
```

### Edge Property Handling

Neo4j MERGE with edge properties requires special handling. The Cypher above uses separate UNWIND clauses per node type to ensure correct edge properties. Alternative pattern if needed:

```cypher
// Generic pattern for edge properties
MERGE (r)-[rel:HAS_REQUIREMENT]->(n)
SET rel.weight = req.weight
```

This creates the relationship if it doesn't exist, then sets the property either way.

---

## Node Type Mapping

| RCD Section | Node Type | Edge Type | Edge Property |
|---|---|---|---|
| domain_matrix (must-have) | `:Requirement` | `[:HAS_REQUIREMENT]` | `weight: 1.0` |
| domain_matrix (nice-to-have) | `:Requirement` | `[:HAS_REQUIREMENT]` | `weight: 0.5` |
| dealbreakers (strong) | `:Dealbreaker` | `[:HAS_DEALBREAKER]` | `strength: 'strong'` |
| dealbreakers (moderate) | `:Dealbreaker` | `[:HAS_DEALBREAKER]` | `strength: 'moderate'` |
| team_culture_profile | `:CulturalSignal` | `[:HAS]` | none |
| technical_context | `:TechnicalContext` | `[:HAS]` | none |
| conflicts | `:Conflict` | `[:HAS_CONFLICT]` | none |
| bars_overrides | `:BarsOverride` | `[:HAS]` | none |

---

## Backfill Script

### New file: `workers/api/scripts/backfillRoleGraph.ts`

```typescript
// Backfill all roles with RCD to Neo4j
// Usage: npx tsx scripts/backfillRoleGraph.ts --batch 50 --dry-run

import { getDb } from '../src/lib/db';
import { writeRoleGraph } from '../src/lib/neo4j/writeRoleGraph';

async function backfill(batchSize = 50, dryRun = false) {
  const db = getDb();

  const roles = await db.prepare(`
    SELECT rc.id, rc.pipeline_id, rc.rcd_version
    FROM role_contexts rc
    WHERE rc.rcd_json IS NOT NULL
    ORDER BY rc.id
    LIMIT ?
  `).bind(batchSize).all();

  for (const role of roles.results) {
    const nodes = await db.prepare(`
      SELECT * FROM role_nodes WHERE role_context_id = ? AND superseded_at IS NULL
    `).bind(role.id).all();

    if (dryRun) {
      console.log(`[dry-run] Would backfill role ${role.id} with ${nodes.results.length} nodes`);
      continue;
    }

    const graphNodes = nodes.results.map(n => ({
      id: n.id,
      node_type: n.node_type,
      narrative_text: n.narrative_text,
      embedding: n.embedding_json ? JSON.parse(n.embedding_json) : null,
      weight: n.weight,
      strength: n.node_type === 'Dealbreaker' ?
        JSON.parse(n.extracted_properties_json || '{}').job_relatedness_strength : undefined,
      source_section: n.source_section,
      affected_node_ids: n.node_type === 'Conflict' ?
        JSON.parse(n.extracted_properties_json || '{}').affected_node_ids : undefined,
      created_at: n.created_at,
    }));

    await writeRoleGraph(
      role.id as string,
      role.pipeline_id as string,
      role.rcd_version as string,
      graphNodes as any,
      process.env as any,
    );

    console.log(`[backfill] role ${role.id}: ${nodes.results.length} nodes`);
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
- `phase2-rcd-decomposition.md` (D1 decomposition must exist)
- `phase2-role-nodes-migration.md` (table must exist)

---

## Acceptance Criteria

- [ ] `writeRoleGraph` MERGEs role with correct edge properties per node type
- [ ] `[:HAS_REQUIREMENT]` edges carry `weight` property (1.0 or 0.5)
- [ ] `[:HAS_DEALBREAKER]` edges carry `strength` property (strong/moderate/weak)
- [ ] `[:HAS_CONFLICT]` → `[:BETWEEN]` chain created for Conflict nodes
- [ ] `synthesizeRcd.ts` calls `writeRoleGraph` fire-and-forget after D1 write
- [ ] `DUAL_WRITE_NEO4J` flag gates the call
- [ ] Backfill script supports `--dry-run`, `--batch N`
- [ ] Backfill handles superseded nodes correctly (only active nodes written)
- [ ] `npx tsc --noEmit` passes
- [ ] `CHANGELOG.md` updated
