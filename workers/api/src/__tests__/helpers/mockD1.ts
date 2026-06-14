import Database from 'better-sqlite3';

export type BetterSqliteDb = InstanceType<typeof Database>;

/**
 * Convert D1-style numbered parameters (`?1`, `?2`, ...) into sequential `?`
 * placeholders, expanding bindings when a numbered parameter is reused.
 *
 * better-sqlite3 does not support `?N` syntax with positional `.run()`
 * arguments, so we rewrite before handing off.
 */
function rewriteNumberedParams(
  sql: string,
  bindings: unknown[],
): { sql: string; args: unknown[] } {
  const numbered = /\?(\d+)/g;
  let match = numbered.exec(sql);
  if (!match) return { sql, args: bindings };

  const args: unknown[] = [];
  let rewritten = '';
  let lastIndex = 0;

  numbered.lastIndex = 0;
  while ((match = numbered.exec(sql)) !== null) {
    rewritten += sql.slice(lastIndex, match.index) + '?';
    const paramIndex = parseInt(match[1], 10) - 1;
    args.push(bindings[paramIndex]);
    lastIndex = numbered.lastIndex;
  }
  rewritten += sql.slice(lastIndex);

  return { sql: rewritten, args };
}

export function createMockD1(sqlite: BetterSqliteDb): D1Database {
  return {
    prepare(query: string) {
      let bindings: unknown[] = [];
      const prepared = {
        bind(...values: unknown[]) {
          bindings = values;
          return prepared;
        },
        async run() {
          const { sql, args } = rewriteNumberedParams(query, bindings);
          const result = sqlite.prepare(sql).run(...args);
          return {
            success: true,
            meta: { changes: result.changes },
            results: [],
          };
        },
        async first<T>() {
          const { sql, args } = rewriteNumberedParams(query, bindings);
          return (sqlite.prepare(sql).get(...args) as T | undefined) ?? null;
        },
        async all<T>() {
          const { sql, args } = rewriteNumberedParams(query, bindings);
          return {
            success: true,
            results: sqlite.prepare(sql).all(...args) as T[],
            meta: {},
          };
        },
        async raw<T>() {
          const { sql, args } = rewriteNumberedParams(query, bindings);
          return sqlite.prepare(sql).raw().all(...args) as T[];
        },
      };
      return prepared;
    },
    async batch(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}
