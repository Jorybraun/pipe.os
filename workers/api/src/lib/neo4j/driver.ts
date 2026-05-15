/**
 * Neo4j driver — lazy singleton with connection pooling.
 *
 * Designed for Cloudflare Workers with nodejs_compat.
 * The driver is created on first use and cached at module scope
 * (isolates reuse the same instance across warm requests).
 *
 * Call closeNeo4jDriver() in test teardown or graceful shutdown hooks.
 */

import neo4j, { type Driver, type AuthToken } from 'neo4j-driver';

let cachedDriver: Driver | null = null;

export interface Neo4jConnectionConfig {
  uri: string;
  user: string;
  password: string;
}

function buildAuth(config: Neo4jConnectionConfig): AuthToken {
  return neo4j.auth.basic(config.user, config.password);
}

/**
 * Create or return the cached Neo4j driver.
 * Logs connection parameters (without password) on first creation.
 *
 * ⚠️ In Cloudflare Workers, I/O objects cannot be reused across request
 * contexts. Use `createNeo4jDriver()` for per-request drivers and close
 * them in a finally block. This cached variant is safe only in long-lived
 * processes (Node, tests) or when called from the same isolate context.
 */
export function getNeo4jDriver(config: Neo4jConnectionConfig): Driver {
  if (cachedDriver) {
    return cachedDriver;
  }

  console.log('[neo4j] creating driver for', config.uri, 'as', config.user);

  cachedDriver = neo4j.driver(config.uri, buildAuth(config), {
    // Conservative pooling for serverless / worker environments
    maxConnectionPoolSize: 10,
    connectionAcquisitionTimeout: 30000,
    // Don't verify connectivity eagerly — let the first query fail fast
    // if Neo4j is down, so D1 fallback isn't blocked.
  });

  return cachedDriver;
}

/**
 * Create a fresh Neo4j driver (no caching).
 * Callers MUST close the returned driver to avoid connection leaks.
 * Required in Cloudflare Workers where I/O objects are request-scoped.
 */
export function createNeo4jDriver(config: Neo4jConnectionConfig): Driver {
  console.log('[neo4j] creating fresh driver for', config.uri, 'as', config.user);
  return neo4j.driver(config.uri, buildAuth(config), {
    maxConnectionPoolSize: 10,
    connectionAcquisitionTimeout: 30000,
  });
}

/**
 * Close the cached driver and clear the cache.
 * Safe to call even if no driver was created.
 */
export async function closeNeo4jDriver(): Promise<void> {
  if (cachedDriver) {
    await cachedDriver.close();
    cachedDriver = null;
    console.log('[neo4j] driver closed');
  }
}

/**
 * Build a connection config from the Worker Env.
 * Returns null if any required value is missing.
 */
export function buildNeo4jConfig(env: {
  NEO4J_URI?: string;
  NEO4J_USER?: string;
  NEO4J_PASSWORD?: string;
}): Neo4jConnectionConfig | null {
  const uri = env.NEO4J_URI;
  const user = env.NEO4J_USER ?? 'neo4j';
  const password = env.NEO4J_PASSWORD;

  if (!uri || !password) {
    return null;
  }

  return { uri, user, password };
}
