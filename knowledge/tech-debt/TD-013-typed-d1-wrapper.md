# TD-013: Raw D1 SQL with No Typed Query Builder

**Status:** 🔴 PENDING  
**Priority:** P2 — Medium  
**Severity:** No compile-time guarantee that SQL columns match TypeScript shapes  
**Estimated Effort:** 2–3 days  
**Owner:** Unassigned

---

## Problem

The project uses raw D1 prepared statements with no ORM or typed query builder. There are **~316 `.prepare()` calls** and **~280 `.first()/.all()/.run()` executions** in non-test code.

Results are assigned to local `*Row` interfaces, but there is **zero compile-time guarantee** that the SQL columns match the TypeScript shape.

### Why This Is Bad

- A typo in a SQL column name (e.g., `candiate_id` instead of `candidate_id`) compiles fine and crashes at runtime.
- Schema migrations require manual scanning of all `.prepare()` calls to ensure columns are still correct.
- Refactoring a column name (e.g., `score_json` -> `score_report_json`) is error-prone.

---

## Evidence

```ts
// Typical pattern — no type parameter on D1 methods
const row = await db.prepare('SELECT * FROM pipelines WHERE id = ?')
  .bind(id)
  .first();

// Followed by non-null assertions and casts:
id: updated!.id as string,
```

There is no connection between `'SELECT * FROM pipelines'` and `PipelineRow`.

---

## Solution

### Option A: Kysely with D1 Dialect (Recommended)

[Kysely](https://kysely.dev/) is a type-safe SQL query builder with a [D1 dialect](https://github.com/aidenwallis/kysely-d1).

```ts
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Database } from './db-types';

export function createDb(env: { DB: D1Database }) {
  return new Kysely<Database>({
    dialect: new D1Dialect({ database: env.DB }),
  });
}

// Usage:
const pipeline = await db.selectFrom('pipelines')
  .selectAll()
  .where('id', '=', id)
  .executeTakeFirst();

// pipeline is typed as PipelineRow | undefined
```

**Migration strategy**:
1. Add `kysely` and `kysely-d1` to `package.json`.
2. Define `Database` interface in `db-types.ts` (can be generated from existing `types.ts`).
3. Migrate one module per PR. Start with low-risk reads.
4. Keep raw SQL for complex queries that Kysely cannot express.

### Option B: Thin Typed Wrapper

If Kysely adds too much bundle size, create a thin wrapper:

```ts
// lib/db.ts
export function query<T>(db: D1Database, sql: string, ...params: unknown[]) {
  return {
    async first(): Promise<T | null> {
      return db.prepare(sql).bind(...params).first() as Promise<T | null>;
    },
    async all(): Promise<T[]> {
      const result = await db.prepare(sql).bind(...params).all();
      return (result.results ?? []) as T[];
    },
  };
}

// Usage:
const row = await query<PipelineRow>(db, 'SELECT * FROM pipelines WHERE id = ?', id).first();
```

This is less safe than Kysely (SQL is still a string) but gives TypeScript types on the result.

---

## Acceptance Criteria

- [ ] At least one module uses Kysely (or the typed wrapper) for all its queries.
- [ ] Zero new raw `.prepare()` calls are added without type parameters.
- [ ] A migration plan exists for converting all 316 `.prepare()` calls.
- [ ] Bundle size impact is measured and documented.

## Related

- TD-010 (fragmented row types) — Kysely needs a single `Database` type; this forces consolidation.
- TD-001 (god route files) — splitting routes first makes query migration easier.
