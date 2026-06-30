import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { checkGate, updateGateStage, clearGateCache } from '../../../lib/livingContext/rolloutEnforcement';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const rolloutGatesMigration = readFileSync(
  new URL('../../../../migrations/0105_rollout_gates.sql', import.meta.url),
  'utf8',
);
const rolloutGateAuditMigration = readFileSync(
  new URL('../../../../migrations/0106_rollout_gate_audit_log.sql', import.meta.url),
  'utf8',
);

describe('living context route gate enforcement — criterion #8: controlled staged rollout', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(rolloutGatesMigration);
    sqlite.exec(rolloutGateAuditMigration);
    clearGateCache();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('disabled gate blocks living context reads', async () => {
    const db = createMockD1(sqlite);
    const result = await checkGate(db, 'living_context_read');
    expect(result.allowed).toBe(false);
    expect(result.stage).toBe('disabled');
  });

  it('internal_only gate allows living context reads', async () => {
    const db = createMockD1(sqlite);
    await updateGateStage(db, 'living_context_read', 'internal_only', 'system');
    clearGateCache();
    const result = await checkGate(db, 'living_context_read');
    expect(result.allowed).toBe(true);
    expect(result.stage).toBe('internal_only');
  });

  it('canary gate allows living context reads', async () => {
    const db = createMockD1(sqlite);
    await updateGateStage(db, 'living_context_read', 'canary', 'system');
    clearGateCache();
    const result = await checkGate(db, 'living_context_read');
    expect(result.allowed).toBe(true);
    expect(result.stage).toBe('canary');
  });

  it('GA gate allows living context reads', async () => {
    const db = createMockD1(sqlite);
    await updateGateStage(db, 'living_context_read', 'GA', 'system');
    clearGateCache();
    const result = await checkGate(db, 'living_context_read');
    expect(result.allowed).toBe(true);
    expect(result.stage).toBe('GA');
  });

  it('gate transitions create audit trail', async () => {
    const db = createMockD1(sqlite);
    await updateGateStage(db, 'living_context_read', 'internal_only', 'deployer', 'shadow metrics pass');
    await updateGateStage(db, 'living_context_read', 'canary', 'deployer', 'canary traffic clean');
    clearGateCache();

    const auditRows = await db.prepare(
      `SELECT gate_key, previous_stage, new_stage, updated_by, reason
         FROM rollout_gate_audit_log
        WHERE gate_key = ?1
        ORDER BY created_at`,
    ).bind('living_context_read').all<{
      gate_key: string;
      previous_stage: string;
      new_stage: string;
      updated_by: string;
      reason: string | null;
    }>();

    const entries = auditRows.results ?? [];
    expect(entries.length).toBe(2);

    const sorted = [...entries].sort((a, b) => {
      const stageOrder = ['disabled', 'internal_only', 'canary', 'GA'];
      return stageOrder.indexOf(a.new_stage) - stageOrder.indexOf(b.new_stage);
    });
    expect(sorted[0]!.previous_stage).toBe('disabled');
    expect(sorted[0]!.new_stage).toBe('internal_only');
    expect(sorted[0]!.reason).toBe('shadow metrics pass');
    expect(sorted[1]!.previous_stage).toBe('internal_only');
    expect(sorted[1]!.new_stage).toBe('canary');
    expect(sorted[1]!.reason).toBe('canary traffic clean');
  });
});
