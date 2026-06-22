/**
 * D1-backed rollout gate tests — acceptance criterion #8
 *
 * Proves:
 * - Gates load from D1 and match seeded defaults
 * - Individual gate lookup from D1 works
 * - Stage updates persist and validate prerequisites
 * - Disabling a gate with enabled dependents is rejected
 * - Enabling a gate with disabled prerequisites is rejected
 * - D1 prerequisite validation detects inconsistencies
 * - Fallback to defaults when D1 table is empty
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  loadGatesFromD1,
  getGateFromD1,
  updateGateStage,
  validateD1GatePrerequisites,
  getAllGates,
  getGateAuditLog,
} from '../rollout';

let sqlite: BetterSqliteDb;
let db: D1Database;

function applyMigrations(): void {
  const migrationsDir = resolve(__dirname, '../../../../migrations');
  for (const file of ['0096_rollout_gates.sql', '0097_rollout_audit_log.sql']) {
    const sql = readFileSync(resolve(migrationsDir, file), 'utf-8');
    sqlite.exec(sql);
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  db = createMockD1(sqlite);
  applyMigrations();
});

afterEach(() => {
  sqlite.close();
});

describe('D1-backed rollout gates — criterion #8', () => {
  it('loads all gates from D1 matching seeded defaults', async () => {
    const gates = await loadGatesFromD1(db);
    const defaults = getAllGates();
    expect(gates.length).toBe(defaults.length);
    for (const defaultGate of defaults) {
      const d1Gate = gates.find((g) => g.key === defaultGate.key);
      expect(d1Gate).toBeDefined();
      expect(d1Gate!.stage).toBe(defaultGate.stage);
      expect(d1Gate!.label).toBe(defaultGate.label);
    }
  });

  it('looks up individual gate from D1', async () => {
    const gate = await getGateFromD1(db, 'deterministic_matching');
    expect(gate).toBeDefined();
    expect(gate!.key).toBe('deterministic_matching');
    expect(gate!.stage).toBe('general_availability');
    expect(gate!.prerequisiteGates).toContain('living_context_ingestion');
  });

  it('returns fallback for unknown gate key', async () => {
    const gate = await getGateFromD1(db, 'nonexistent_gate');
    expect(gate).toBeUndefined();
  });

  it('updates gate stage and persists', async () => {
    const result = await updateGateStage(db, 'match_explanation', 'general_availability', 'test-user');
    expect(result.success).toBe(true);

    const updated = await getGateFromD1(db, 'match_explanation');
    expect(updated!.stage).toBe('general_availability');
  });

  it('rejects enabling gate with disabled prerequisite', async () => {
    // Disable all dependents of deterministic_matching first
    await updateGateStage(db, 'match_explanation', 'disabled', 'test');
    await updateGateStage(db, 'expert_labelled_evaluation', 'disabled', 'test');
    await updateGateStage(db, 'repo_overlay_visualization', 'disabled', 'test');
    // Now disable deterministic_matching itself (no enabled dependents remain)
    const disableResult = await updateGateStage(db, 'deterministic_matching', 'disabled', 'test');
    expect(disableResult.success).toBe(true);

    // Try to re-enable match_explanation — its prereq (deterministic_matching) is now disabled
    const result = await updateGateStage(db, 'match_explanation', 'canary', 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('deterministic_matching');
    expect(result.error).toContain('disabled');
  });

  it('rejects disabling gate that has enabled dependents', async () => {
    // deterministic_matching is required by match_explanation (canary)
    const result = await updateGateStage(db, 'deterministic_matching', 'disabled', 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('match_explanation');
  });

  it('rejects invalid stage', async () => {
    const result = await updateGateStage(db, 'match_explanation', 'invalid' as 'disabled', 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid stage');
  });

  it('rejects unknown gate key in update', async () => {
    const result = await updateGateStage(db, 'nonexistent', 'canary', 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown gate');
  });

  it('validates D1 gate prerequisites — clean state has no errors', async () => {
    const errors = await validateD1GatePrerequisites(db);
    expect(errors).toEqual([]);
  });

  it('validates D1 prerequisites — detects broken chain', async () => {
    // Manually break the chain by setting deterministic_matching to disabled
    // while keeping match_explanation at canary
    sqlite.exec(`UPDATE rollout_gates SET stage = 'disabled' WHERE gate_key = 'deterministic_matching'`);

    const errors = await validateD1GatePrerequisites(db);
    expect(errors.length).toBeGreaterThan(0);
    const relevant = errors.find((e) => e.includes('match_explanation'));
    expect(relevant).toBeDefined();
  });

  it('falls back to defaults when D1 table is empty', async () => {
    sqlite.exec('DELETE FROM rollout_gates');
    const gates = await loadGatesFromD1(db);
    expect(gates.length).toBe(getAllGates().length);
  });

  it('logs audit entry on successful gate stage change', async () => {
    const result = await updateGateStage(db, 'match_explanation', 'general_availability', 'test-auditor', 'enabling for production');
    expect(result.success).toBe(true);

    const entries = await getGateAuditLog(db, 'match_explanation');
    expect(entries.length).toBe(1);
    expect(entries[0].gateKey).toBe('match_explanation');
    expect(entries[0].oldStage).toBe('canary');
    expect(entries[0].newStage).toBe('general_availability');
    expect(entries[0].changedBy).toBe('test-auditor');
    expect(entries[0].reason).toBe('enabling for production');
    expect(entries[0].createdAt).toBeTruthy();
  });

  it('accumulates audit entries across multiple changes', async () => {
    await updateGateStage(db, 'match_explanation', 'general_availability', 'user-1');
    await updateGateStage(db, 'match_explanation', 'canary', 'user-2', 'rolling back');

    const entries = await getGateAuditLog(db, 'match_explanation');
    expect(entries.length).toBe(2);
    expect(entries[0].newStage).toBe('canary');
    expect(entries[0].changedBy).toBe('user-2');
    expect(entries[0].reason).toBe('rolling back');
    expect(entries[1].newStage).toBe('general_availability');
    expect(entries[1].changedBy).toBe('user-1');
  });

  it('does not log audit entry on rejected change', async () => {
    const result = await updateGateStage(db, 'deterministic_matching', 'disabled', 'test');
    expect(result.success).toBe(false);

    const entries = await getGateAuditLog(db, 'deterministic_matching');
    expect(entries.length).toBe(0);
  });

  it('returns full audit log across all gates', async () => {
    await updateGateStage(db, 'match_explanation', 'general_availability', 'user-a');
    await updateGateStage(db, 'contact_living_context', 'general_availability', 'user-b');

    const all = await getGateAuditLog(db);
    expect(all.length).toBe(2);
  });
});
