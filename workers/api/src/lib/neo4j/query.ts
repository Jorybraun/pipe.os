/**
 * Neo4j query helpers — session lifecycle + result helpers.
 *
 * All queries should use `runQuery()` to ensure sessions are properly closed.
 * Read queries use READ sessions; writes use WRITE sessions.
 */

import type { Driver, QueryResult, Record as Neo4jRecord } from 'neo4j-driver';
import { getNeo4jDriver, type Neo4jConnectionConfig } from './driver';

export type QueryParameters = Record<string, unknown>;

export interface QueryOptions {
  /** 'READ' or 'WRITE'. Default: 'READ'. */
  accessMode?: 'READ' | 'WRITE';
  /** Optional database name (Neo4j 4+). Default: undefined (system default). */
  database?: string;
}

/**
 * Run a single Cypher query and return the result.
 * Automatically manages session lifecycle.
 */
export async function runQuery(
  driver: Driver,
  cypher: string,
  params: QueryParameters = {},
  options: QueryOptions = {},
): Promise<QueryResult> {
  const session = driver.session({
    defaultAccessMode: options.accessMode === 'WRITE' ? 'WRITE' : 'READ',
    database: options.database,
  });

  try {
    const result = await session.run(cypher, params);
    return result;
  } finally {
    await session.close();
  }
}

/**
 * Convenience: run a read query and map each record.
 */
export async function runReadQuery<T>(
  driver: Driver,
  cypher: string,
  params: QueryParameters = {},
  mapFn: (record: Neo4jRecord) => T,
): Promise<T[]> {
  const result = await runQuery(driver, cypher, params, { accessMode: 'READ' });
  return result.records.map(mapFn);
}

/**
 * Convenience: run a write query and return summary counters.
 */
export async function runWriteQuery(
  driver: Driver,
  cypher: string,
  params: QueryParameters = {},
): Promise<{ nodesCreated: number; nodesSet: number; relationshipsCreated: number }> {
  const result = await runQuery(driver, cypher, params, { accessMode: 'WRITE' });
  const counters = result.summary.counters.updates();
  return {
    nodesCreated: counters.nodesCreated ?? 0,
    nodesSet: counters.propertiesSet ?? 0,
    relationshipsCreated: counters.relationshipsCreated ?? 0,
  };
}

/**
 * One-shot health check: RETURN 1.
 * Returns true if Neo4j responds within timeoutMs.
 */
export async function neo4jHealthCheck(
  driver: Driver,
  timeoutMs = 5000,
): Promise<boolean> {
  try {
    const result = await runQuery(driver, 'RETURN 1 AS n', {}, { accessMode: 'READ' });
    const n = result.records[0]?.get('n');
    return n === 1 || n?.toNumber?.() === 1 || n?.toInt?.() === 1;
  } catch (err) {
    console.warn('[neo4j] health check failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Convenience: get driver from config, or null if config is invalid.
 */
export function getDriverOrNull(config: Neo4jConnectionConfig | null): Driver | null {
  if (!config) return null;
  return getNeo4jDriver(config);
}
