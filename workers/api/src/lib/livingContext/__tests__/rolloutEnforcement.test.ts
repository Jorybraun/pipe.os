import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  checkGate,
  updateGateStage,
  listGates,
  queryAuditLog,
  clearGateCache,
} from '../rolloutEnforcement';

const gatesMigration = readFileSync(
  new URL('../../../../migrations/0105_rollout_gates.sql', import.meta.url),
  'utf8',
);
const auditMigration = readFileSync(
  new URL('../../../../migrations/0106_rollout_gate_audit_log.sql', import.meta.url),
  'utf8',
);

describe('Rollout enforcement', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(gatesMigration);
    sqlite.exec(auditMigration);
    db = createMockD1(sqlite);
    clearGateCache();
  });

  afterEach(() => {
    sqlite.close();
    clearGateCache();
  });

  it('returns disabled for a non-existent gate', async () => {
    const result = await checkGate(db, 'nonexistent');
    expect(result.allowed).toBe(false);
    expect(result.stage).toBe('disabled');
    expect(result.gate).toBe('nonexistent');
  });

  it('creates a gate and transitions through stages', async () => {
    await updateGateStage(db, 'living_context', 'internal_only', 'test-agent');

    let result = await checkGate(db, 'living_context');
    expect(result.allowed).toBe(true);
    expect(result.stage).toBe('internal_only');

    await updateGateStage(db, 'living_context', 'canary', 'test-agent', 'Passing shadow evaluation');
    clearGateCache();

    result = await checkGate(db, 'living_context');
    expect(result.allowed).toBe(true);
    expect(result.stage).toBe('canary');
  });

  it('disables a gate by setting stage to disabled', async () => {
    await updateGateStage(db, 'matching', 'GA', 'test-agent');
    clearGateCache();

    let result = await checkGate(db, 'matching');
    expect(result.allowed).toBe(true);

    await updateGateStage(db, 'matching', 'disabled', 'test-agent', 'Rolling back');
    clearGateCache();

    result = await checkGate(db, 'matching');
    expect(result.allowed).toBe(false);
  });

  it('lists all gates', async () => {
    await updateGateStage(db, 'alpha', 'canary', 'agent-1');
    await updateGateStage(db, 'beta', 'GA', 'agent-2');

    const gates = await listGates(db);
    expect(gates).toHaveLength(2);
    expect(gates.map((g) => g.gateKey).sort()).toEqual(['alpha', 'beta']);
  });

  it('records audit log entries for transitions', async () => {
    await updateGateStage(db, 'feature_x', 'internal_only', 'agent-1');
    await updateGateStage(db, 'feature_x', 'canary', 'agent-1', 'Shadow passed');
    await updateGateStage(db, 'feature_x', 'GA', 'agent-1', 'Canary stable');

    const logs = await queryAuditLog(db, 'feature_x');
    expect(logs).toHaveLength(3);

    const stages = logs.map((l) => l.newStage).sort();
    expect(stages).toEqual(['GA', 'canary', 'internal_only']);

    const gaLog = logs.find((l) => l.newStage === 'GA');
    expect(gaLog?.previousStage).toBe('canary');
    expect(gaLog?.reason).toBe('Canary stable');

    const initialLog = logs.find((l) => l.newStage === 'internal_only');
    expect(initialLog?.previousStage).toBe('disabled');
  });

  it('uses cache for repeated checks', async () => {
    await updateGateStage(db, 'cached_gate', 'GA', 'agent-1');
    clearGateCache();

    const first = await checkGate(db, 'cached_gate');
    expect(first.allowed).toBe(true);

    // Directly change the DB behind the cache
    sqlite.prepare(`UPDATE rollout_gates SET stage = 'disabled' WHERE gate_key = 'cached_gate'`).run();

    // Cache should still return GA
    const second = await checkGate(db, 'cached_gate');
    expect(second.allowed).toBe(true);
    expect(second.stage).toBe('GA');

    // After clearing cache, should see the DB state
    clearGateCache();
    const third = await checkGate(db, 'cached_gate');
    expect(third.allowed).toBe(false);
    expect(third.stage).toBe('disabled');
  });
});
