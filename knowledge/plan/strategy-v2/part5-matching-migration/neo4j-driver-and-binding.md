# Neo4j: JavaScript Driver Integration in Cloudflare Workers

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 317–318)
**Phase:** 2
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote

> JavaScript driver (`neo4j-driver`) imported in Workers for Bolt connection.

## Why

The `neo4j-driver` npm package needs explicit verification and configuration for Cloudflare Workers. Workers have a Node.js compat shim, not a full Node.js runtime — some neo4j-driver transports may not work without specific config. This is a thin but critical integration layer that all subsequent Neo4j work depends on.

## Subtasks (delegable)

### Subtask 1 — Driver installation and Workers compatibility verification
**Files:**
- `workers/api/package.json`
- `workers/api/wrangler.jsonc`
- `workers/api/src/lib/neo4j/driver.ts` (new)

**Spec:**
- Install `neo4j-driver` (verify latest version compatible with Workers — check `neo4j-driver-lite` as a lighter alternative if full driver fails).
- Add `nodejs_compat = true` to `wrangler.jsonc` compatibility flags if not already present.
- Export `getNeo4jDriver(env): Driver` — singleton driver factory:
  ```typescript
  import neo4j from 'neo4j-driver';
  
  let _driver: ReturnType<typeof neo4j.driver> | null = null;
  
  export function getNeo4jDriver(env: Env): ReturnType<typeof neo4j.driver> {
    if (!_driver) {
      _driver = neo4j.driver(
        env.NEO4J_URI,           // bolt://neo4j.<domain>:7687
        neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
        { encrypted: true }
      );
    }
    return _driver;
  }
  ```
- Add `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` to Worker secrets (not wrangler.jsonc vars).
- Write a smoke test: `GET /api/v1/internal/neo4j-health` (internal-only route) that runs `RETURN 1 AS ok` and returns 200.
- Verify the smoke test works end-to-end against the provisioned VPS.

**Status:** ⏳ PENDING

### Subtask 2 — Session management helper and Cypher execution wrapper
**Files:**
- `workers/api/src/lib/neo4j/query.ts` (new)
- `workers/api/src/lib/neo4j/query.test.ts` (new — unit tests with mocked driver)

**Spec:**
- Export `runQuery<T>(cypher: string, params: Record<string, unknown>, env: Env): Promise<T[]>`:
  - Opens a read session from the driver.
  - Runs query, maps results to typed `T[]` via a record mapper.
  - Closes session in `finally` block.
  - On error: log structured JSON `{ event: 'neo4j_query_error', query_hash, error_message }` (hash the Cypher, don't log it verbatim — may contain parameters).
  - Throws `Neo4jQueryError` (typed) for callers to handle.
- Export `runWrite<T>(cypher, params, env): Promise<T[]>` — same but write session.
- Unit tests with mocked driver: verify session open/close, error propagation, parameter passing.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `neo4j-vps-provisioning.md` (needs running Neo4j instance)
- Blocks: all other Neo4j plan files

## Acceptance criteria

- [ ] `neo4j-driver` (or `neo4j-driver-lite`) installs and compiles in Workers environment
- [ ] `GET /api/v1/internal/neo4j-health` returns 200 against live VPS
- [ ] Singleton driver pattern verified (single connection across Worker lifetime)
- [ ] `runQuery` and `runWrite` helpers with proper session management
- [ ] `npx tsc --noEmit` passes
