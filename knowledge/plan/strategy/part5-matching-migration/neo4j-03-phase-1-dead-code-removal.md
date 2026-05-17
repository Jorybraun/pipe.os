# Phase 1: Dead Code Removal — Detailed Instructions

This phase removes all code that is gated behind `false` environment variables and has zero active callers. It is **zero-risk** — no production behavior changes.

---

## 1. Files to Delete (Zero Active Callers)

### 1.1 `workers/api/src/lib/match/shadowRead.ts`

**Why dead:** The `SHADOW_READ_NEO4J` env var is set to `'false'` in all environments. The shadow read pattern was:
```typescript
if (env.SHADOW_READ_NEO4J === 'true') {
  const neo4jResult = await shadowRead(...);
  logParity(d1Result, neo4jResult);
}
```
Since the condition is never true, this entire module is unreachable.

**Action:** Delete the file.

**Verify no callers:**
```bash
grep -r "shadowRead" workers/api/src/ --include="*.ts"
```
Expected: Only import statements gated by `SHADOW_READ_NEO4J === 'true'`.

**Clean up imports:** After deleting, check for orphaned imports in:
- `workers/api/src/routes/search.ts` (or wherever shadow reads were invoked)

### 1.2 `workers/api/src/routes/internal/neo4jParity.ts`

**Why dead:** This route (`GET /internal/neo4j-parity`) compares D1 vs Neo4j results and returns a parity report. No UI or monitoring system calls this endpoint.

**Action:** Delete the file.

**Verify no callers:**
```bash
grep -r "neo4j-parity" src/ workers/api/src/ --include="*.ts" --include="*.tsx"
grep -r "neo4jParity" workers/api/src/ --include="*.ts"
```

**Clean up router registration:** Check `workers/api/src/index.ts` (or the main Hono router) for:
```typescript
app.route('/internal', internalRoutes);
```
If `neo4jParity.ts` was the only route in `internalRoutes`, delete the entire internal router. If other routes exist, remove only the parity route registration.

---

## 2. Environment Variables to Remove

### 2.1 `DUAL_WRITE_NEO4J`

**Current usage (grep results):**
```bash
grep -rn "DUAL_WRITE_NEO4J" workers/api/src/ --include="*.ts"
```

Expected locations:
- `workers/api/wrangler.jsonc` — env var definition
- `workers/api/src/types.ts` or `workers/api/src/config.ts` — type definition
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts` — gated block
- `workers/api/src/lib/roleAgent/decomposeRcd.ts` — gated block
- `workers/api/src/scripts/crawl-repos/pass3/persist.ts` — gated block

**Action for each location:**

**`wrangler.jsonc`:**
```json
// BEFORE
"vars": {
  "DUAL_WRITE_NEO4J": "false",
  "SHADOW_READ_NEO4J": "false",
  "PRIMARY_MATCH_STORE": "d1"
}

// AFTER
"vars": {
  "PRIMARY_MATCH_STORE": "d1"
}
```

**`types.ts` (or wherever Env type is defined):**
```typescript
// BEFORE
type Env = {
  DUAL_WRITE_NEO4J: string;
  SHADOW_READ_NEO4J: string;
  PRIMARY_MATCH_STORE: string;
  // ...
};

// AFTER
// Remove DUAL_WRITE_NEO4J and SHADOW_READ_NEO4J from the type
// Keep PRIMARY_MATCH_STORE for now (needed for cutover)
```

### 2.2 `SHADOW_READ_NEO4J`

Same pattern as above. Remove from `wrangler.jsonc`, `types.ts`, and any conditional blocks.

### 2.3 `PRIMARY_MATCH_STORE` — KEEP for now

**Decision:** Do NOT remove yet. We need it as a feature flag during the Neo4j cutover:
- `"d1"` → use existing Vectorize/D1 matching
- `"neo4j"` → use new Cypher matching

After Phase 3 validation (1 week of production use), remove this env var and always use Neo4j.

---

## 3. Remove Gated Blocks from Ingestion Pipeline

### 3.1 `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Locate the gated block:**
```bash
grep -n "DUAL_WRITE_NEO4J" workers/api/src/lib/candidateDiscovery/orchestrate.ts
```

**Expected pattern:**
```typescript
if (env.DUAL_WRITE_NEO4J === 'true') {
  await writeCandidateGraph(driver, candidateId, nodes);
}
```

**Action:** Remove the `if` wrapper. Keep the `writeCandidateGraph` call but make it unconditional:
```typescript
// BEFORE
if (env.DUAL_WRITE_NEO4J === 'true') {
  await writeCandidateGraph(driver, candidateId, nodes);
}

// AFTER
await writeCandidateGraph(driver, candidateId, nodes);
```

**Also remove:** The D1 batch insert of `candidate_nodes` that happens in the same function. Search for:
```typescript
await db.batchInsert('candidate_nodes', ...);
```
This is the redundant D1 write. Remove it — Neo4j is now the sole write target for sub-elements.

### 3.2 `workers/api/src/lib/roleAgent/decomposeRcd.ts`

**Same pattern:** Find `DUAL_WRITE_NEO4J` gated block, remove the `if` wrapper, keep the Neo4j write.

**Also remove:** D1 batch insert of `role_sub_elements`.

### 3.3 `workers/api/src/scripts/crawl-repos/pass3/persist.ts`

**Same pattern:** Find and remove `DUAL_WRITE_NEO4J` gated block.

---

## 4. Stop Vectorize Writes (Keep Read-Only)

### 4.1 `workers/api/src/lib/candidateDiscovery/embed.ts`

**Locate:**
```bash
grep -n "CANDIDATE_INDEX" workers/api/src/lib/candidateDiscovery/embed.ts
```

**Expected:**
```typescript
await env.CANDIDATE_INDEX.upsert([{
  id: candidateId,
  values: embedding,
  metadata: { ... }
}]);
```

**Action:** Delete the `upsert` call. Keep the `CANDIDATE_INDEX` binding in `wrangler.jsonc`.

### 4.2 `workers/api/src/lib/roleDiscovery/embedRole.ts`

Remove `ROLE_INDEX.upsert()` call.

### 4.3 `workers/api/src/lib/roleAgent/decomposeRcd.ts`

Remove `ROLE_INDEX.upsert()` call (if present in addition to the D1 write).

### 4.4 `workers/api/src/routes/cockpit/adminRepos.ts`

Remove `REPO_INDEX.upsert()` calls.

### 4.5 `workers/api/src/scripts/crawl-repos/pass3/persist.ts`

Remove `upsertToVectorize()` and `upsertRepoNodesToVectorize()` function calls.

**Note:** Do NOT delete the `upsertToVectorize` function definition yet — it may be called from other scripts. Only remove the call sites within the main ingestion pipeline.

### 4.6 `workers/api/src/lib/cultureAgentPipeline.ts`

Remove `CANDIDATE_INDEX.upsert()` call.

### 4.7 `workers/api/src/lib/candidateDiscovery/decomposeCodeReview.ts`

Remove `CANDIDATE_INDEX.upsert()` call.

---

## 5. D1 Table Deprecation

### 5.1 `candidate_nodes` table

**Action:** Stop writing new rows. Do NOT drop the table — it contains historical data.

**Add deprecation comment to schema:**
```sql
-- candidate_nodes: DEPRECATED — Neo4j is the sole write target for sub-elements
-- This table is retained as a read-only historical archive
-- New writes go to Neo4j CandidateNode nodes
```

Location: Add comment to the migration file that created `candidate_nodes`, or create a new migration:
```sql
-- workers/api/migrations/00XX_deprecate_candidate_nodes.sql
COMMENT ON TABLE candidate_nodes IS 'DEPRECATED: Neo4j is the sole write target. Read-only historical archive.';
```

### 5.2 `role_sub_elements` table

Same treatment as `candidate_nodes`.

---

## 6. Verification Checklist

After completing Phase 1, run these checks:

```bash
# 1. No references to deleted env vars
grep -rn "DUAL_WRITE_NEO4J\|SHADOW_READ_NEO4J" workers/api/src/ --include="*.ts"
# Expected: 0 results

# 2. No references to deleted files
grep -rn "shadowRead\|neo4jParity" workers/api/src/ --include="*.ts"
# Expected: 0 results

# 3. No Vectorize upserts in ingestion pipeline
grep -rn "\.upsert(" workers/api/src/lib/candidateDiscovery/ --include="*.ts"
grep -rn "\.upsert(" workers/api/src/lib/roleAgent/ --include="*.ts"
grep -rn "\.upsert(" workers/api/src/lib/roleDiscovery/ --include="*.ts"
# Expected: 0 results in these directories

# 4. TypeScript compiles
npx tsc --noEmit -p workers/api/tsconfig.json

# 5. Tests pass
npm test -- --run
```

---

## 7. Files Modified (Summary)

| File | Change |
|------|--------|
| `workers/api/src/lib/match/shadowRead.ts` | **DELETE** |
| `workers/api/src/routes/internal/neo4jParity.ts` | **DELETE** |
| `workers/api/wrangler.jsonc` | Remove `DUAL_WRITE_NEO4J`, `SHADOW_READ_NEO4J` from vars |
| `workers/api/src/types.ts` | Remove `DUAL_WRITE_NEO4J`, `SHADOW_READ_NEO4J` from Env type |
| `workers/api/src/lib/candidateDiscovery/orchestrate.ts` | Remove D1 `candidate_nodes` batch insert; make `writeCandidateGraph` unconditional |
| `workers/api/src/lib/roleAgent/decomposeRcd.ts` | Remove D1 `role_sub_elements` batch insert; make `writeRoleGraph` unconditional |
| `workers/api/src/scripts/crawl-repos/pass3/persist.ts` | Remove `DUAL_WRITE_NEO4J` gated block |
| `workers/api/src/lib/candidateDiscovery/embed.ts` | Remove `CANDIDATE_INDEX.upsert()` |
| `workers/api/src/lib/roleDiscovery/embedRole.ts` | Remove `ROLE_INDEX.upsert()` |
| `workers/api/src/routes/cockpit/adminRepos.ts` | Remove `REPO_INDEX.upsert()` |
| `workers/api/src/lib/cultureAgentPipeline.ts` | Remove `CANDIDATE_INDEX.upsert()` |
| `workers/api/src/lib/candidateDiscovery/decomposeCodeReview.ts` | Remove `CANDIDATE_INDEX.upsert()` |

---

## 8. Estimated Effort

- **Deletion of 2 files:** 5 minutes
- **Env var cleanup:** 15 minutes
- **Gated block removal (5 files):** 30 minutes
- **Vectorize upsert removal (6 files):** 30 minutes
- **Testing & verification:** 30 minutes

**Total: ~2 hours**
