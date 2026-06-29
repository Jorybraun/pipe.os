import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { checkStagedRolloutGate } from '../../../lib/challengeMatching/evaluation/metrics';
import type { EvaluationMetrics } from '../../../lib/challengeMatching/evaluation/types';
import { STAGED_ROLLOUT_THRESHOLDS, DEFAULT_ACCEPTANCE_THRESHOLDS } from '../../../lib/challengeMatching/evaluation/types';
import rolloutGate from '../rolloutGate';
import { clearGateCache } from '../../../lib/livingContext/rolloutEnforcement';

const gatesMigration = readFileSync(
  new URL('../../../../migrations/0105_rollout_gates.sql', import.meta.url),
  'utf8',
);
const auditMigration = readFileSync(
  new URL('../../../../migrations/0106_rollout_gate_audit_log.sql', import.meta.url),
  'utf8',
);

describe('rollout gate — criterion #8: controlled staged rollout', () => {
  function passingMetrics(overrides: Partial<EvaluationMetrics> = {}): EvaluationMetrics {
    return {
      corpusVersion: '1.0.0',
      corpusId: 'test-corpus',
      matchRunIds: ['run-1'],
      comparisonMatchRunIds: ['run-1'],
      evaluatedAt: new Date().toISOString(),
      recallAt50: 0.99,
      precisionAt3: 0.90,
      ndcgAt5: 0.90,
      guardrailViolationCount: 0,
      multiStretchViolationCount: 0,
      missingProvenanceCount: 0,
      missingMatchRunCount: 0,
      byteIdenticalRerun: true,
      rerunFingerprints: {},
      determinismComparisons: [],
      totalEvaluations: 20,
      evaluatedPairCount: 10,
      highlyRelevantInTop3: 18,
      relevantInTop3: 0,
      irrelevantInTop3: 0,
      forbiddenInResults: 0,
      syntheticFixtureCount: 0,
      expertLabelCount: 5,
      labelResults: [],
      expectedPacketCount: 5,
      packetCoverage: 1.0,
      pairCoverage: 1.0,
      comparisonCoverage: 1.0,
      missingPacketIds: [],
      packetIdentityMismatches: [],
      ...overrides,
    };
  }

  it('shadow stage passes with basic metrics', () => {
    const result = checkStagedRolloutGate(passingMetrics(), 'shadow');
    expect(result.stage).toBe('shadow');
    expect(result.ready).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('canary stage passes with full coverage and quality', () => {
    const result = checkStagedRolloutGate(passingMetrics(), 'canary');
    expect(result.stage).toBe('canary');
    expect(result.ready).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('production stage requires expert labels', () => {
    const result = checkStagedRolloutGate(
      passingMetrics({ expertLabelCount: 0, syntheticFixtureCount: 5 }),
      'production',
    );
    expect(result.stage).toBe('production');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('expert') || f.includes('Expert'))).toBe(true);
  });

  it('stages have progressively stricter thresholds', () => {
    const shadow = STAGED_ROLLOUT_THRESHOLDS.shadow;
    const canary = STAGED_ROLLOUT_THRESHOLDS.canary;
    const production = STAGED_ROLLOUT_THRESHOLDS.production;

    expect(shadow.minRecallAt50).toBeLessThanOrEqual(canary.minRecallAt50);
    expect(canary.minRecallAt50).toBeLessThanOrEqual(production.minRecallAt50);
    expect(shadow.minPairCoverage).toBeLessThanOrEqual(canary.minPairCoverage);
  });

  it('canary rejects low recall', () => {
    const result = checkStagedRolloutGate(
      passingMetrics({ recallAt50: 0.50 }),
      'canary',
    );
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('Recall'))).toBe(true);
  });

  it('canary rejects missing packet declarations', () => {
    const result = checkStagedRolloutGate(
      passingMetrics({ expectedPacketCount: 0, packetCoverage: 0 }),
      'canary',
    );
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('packet') || f.includes('declare'))).toBe(true);
  });

  it('returns structured result with metrics and thresholds', () => {
    const metrics = passingMetrics();
    const result = checkStagedRolloutGate(metrics, 'shadow');
    expect(result).toHaveProperty('stage');
    expect(result).toHaveProperty('ready');
    expect(result).toHaveProperty('failures');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('thresholds');
    expect(result.metrics).toBe(metrics);
  });
});

describe('POST /rollout-gate — gate stage management', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(gatesMigration);
    sqlite.exec(auditMigration);
    clearGateCache();
  });

  afterEach(() => {
    sqlite.close();
    clearGateCache();
  });

  it('creates a new gate and transitions it', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateKey: 'test_feature', stage: 'internal_only', reason: 'Initial enable' }),
    }, { DB: db });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; gateKey: string; stage: string };
    expect(body.ok).toBe(true);
    expect(body.gateKey).toBe('test_feature');
    expect(body.stage).toBe('internal_only');

    const row = sqlite.prepare('SELECT stage FROM rollout_gates WHERE gate_key = ?').get('test_feature') as { stage: string } | undefined;
    expect(row?.stage).toBe('internal_only');

    const audit = sqlite.prepare('SELECT * FROM rollout_gate_audit_log WHERE gate_key = ?').all('test_feature') as Array<{ new_stage: string; reason: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.new_stage).toBe('internal_only');
    expect(audit[0]!.reason).toBe('Initial enable');
  });

  it('rejects invalid stage values', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateKey: 'test_feature', stage: 'invalid_stage' }),
    }, { DB: db });

    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('rejects missing gateKey', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'canary' }),
    }, { DB: db });

    expect(res.status).toBe(400);
  });
});

describe('GET /rollout-gate/gates — list all gates', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(gatesMigration);
    sqlite.exec(auditMigration);
    clearGateCache();
  });

  afterEach(() => {
    sqlite.close();
    clearGateCache();
  });

  it('lists all configured gates', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, updated_by, created_at, updated_at)
      VALUES ('g1', 'living_context_backfill', 'canary', 'admin', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, updated_by, created_at, updated_at)
      VALUES ('g2', 'matching_v2', 'disabled', 'admin', datetime('now'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate/gates', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { gates: Array<{ gateKey: string; stage: string }> };
    expect(body.gates).toHaveLength(2);
    expect(body.gates.find((g) => g.gateKey === 'living_context_backfill')?.stage).toBe('canary');
    expect(body.gates.find((g) => g.gateKey === 'matching_v2')?.stage).toBe('disabled');
  });
});

describe('GET /rollout-gate/audit — gate audit log', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(gatesMigration);
    sqlite.exec(auditMigration);
    clearGateCache();
  });

  afterEach(() => {
    sqlite.close();
    clearGateCache();
  });

  it('returns audit trail for a gate', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gate_audit_log (id, gate_key, previous_stage, new_stage, updated_by, reason, created_at)
      VALUES ('a1', 'test_gate', 'disabled', 'internal_only', 'admin', 'enabling', datetime('now', '-2 minutes'));
    `);
    sqlite.exec(`
      INSERT INTO rollout_gate_audit_log (id, gate_key, previous_stage, new_stage, updated_by, reason, created_at)
      VALUES ('a2', 'test_gate', 'internal_only', 'canary', 'admin', 'promoting', datetime('now', '-1 minutes'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate/audit?gateKey=test_gate', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { gateKey: string; entries: Array<{ previousStage: string; newStage: string; reason: string }> };
    expect(body.gateKey).toBe('test_gate');
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]!.newStage).toBe('canary');
    expect(body.entries[1]!.newStage).toBe('internal_only');
  });

  it('requires gateKey parameter', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate/audit', undefined, { DB: db });
    expect(res.status).toBe(400);
  });
});

const evalMigration = readFileSync(
  new URL('../../../../migrations/0093_matching_evaluation.sql', import.meta.url),
  'utf8',
);

describe('POST /rollout-gate/auto-progress — automated gate progression', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(gatesMigration);
    sqlite.exec(auditMigration);
    sqlite.exec(evalMigration);
    clearGateCache();
  });

  afterEach(() => {
    sqlite.close();
    clearGateCache();
  });

  it('bootstrap-progresses from disabled to internal_only without evaluation', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate/auto-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateKey: 'living_context', corpusId: 'test-corpus' }),
    }, { DB: db });

    expect(res.status).toBe(200);
    const body = await res.json() as { progressed: boolean; from: string; to: string };
    expect(body.progressed).toBe(true);
    expect(body.from).toBe('disabled');
    expect(body.to).toBe('internal_only');

    const row = sqlite.prepare('SELECT stage FROM rollout_gates WHERE gate_key = ?').get('living_context') as { stage: string } | undefined;
    expect(row?.stage).toBe('internal_only');
  });

  it('blocks progression to canary when no evaluation result exists', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, updated_by, created_at, updated_at)
      VALUES ('g1', 'living_context', 'internal_only', 'admin', datetime('now'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate/auto-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateKey: 'living_context', corpusId: 'test-corpus' }),
    }, { DB: db });

    expect(res.status).toBe(200);
    const body = await res.json() as { progressed: boolean; reason: string; readiness: { failures: string[] } };
    expect(body.progressed).toBe(false);
    expect(body.reason).toContain('readiness check failed');
    expect(body.readiness.failures.length).toBeGreaterThan(0);
  });

  it('reports terminal stage when already at GA', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, updated_by, created_at, updated_at)
      VALUES ('g1', 'living_context', 'GA', 'admin', datetime('now'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate/auto-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateKey: 'living_context', corpusId: 'test-corpus' }),
    }, { DB: db });

    expect(res.status).toBe(200);
    const body = await res.json() as { progressed: boolean; reason: string };
    expect(body.progressed).toBe(false);
    expect(body.reason).toContain('terminal stage');
  });

  it('dry-run mode does not mutate the gate', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate/auto-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateKey: 'living_context', corpusId: 'test-corpus', dryRun: true }),
    }, { DB: db });

    expect(res.status).toBe(200);
    const body = await res.json() as { progressed: boolean; dryRun: boolean; to: string };
    expect(body.progressed).toBe(false);
    expect(body.dryRun).toBe(true);
    expect(body.to).toBe('internal_only');

    const row = sqlite.prepare('SELECT * FROM rollout_gates WHERE gate_key = ?').get('living_context');
    expect(row).toBeUndefined();
  });

  it('progresses to canary when evaluation passes', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, updated_by, created_at, updated_at)
      VALUES ('g1', 'living_context', 'internal_only', 'admin', datetime('now'), datetime('now'));
    `);

    const passingResult = {
      metrics: {
        corpusVersion: '1.0.0',
        corpusId: 'test-corpus',
        recallAt50: 0.95,
        precisionAt3: 0.85,
        ndcgAt5: 0.85,
        guardrailViolationCount: 0,
        multiStretchViolationCount: 0,
        missingProvenanceCount: 0,
        missingMatchRunCount: 0,
        byteIdenticalRerun: true,
        determinismComparisons: [],
        totalEvaluations: 10,
        evaluatedPairCount: 5,
        highlyRelevantInTop3: 8,
        relevantInTop3: 0,
        irrelevantInTop3: 0,
        forbiddenInResults: 0,
        syntheticFixtureCount: 0,
        expertLabelCount: 5,
        labelResults: [],
        expectedPacketCount: 0,
        packetCoverage: 0,
        pairCoverage: 1.0,
        comparisonCoverage: 0,
        missingPacketIds: [],
        packetIdentityMismatches: [],
        matchRunIds: ['run-1'],
        comparisonMatchRunIds: [],
        evaluatedAt: new Date().toISOString(),
        rerunFingerprints: {},
      },
      thresholds: DEFAULT_ACCEPTANCE_THRESHOLDS,
      passed: true,
      failures: [],
      warnings: [],
    };

    // Insert corpus and passing evaluation result
    sqlite.exec(`
      INSERT INTO evaluation_corpora (corpus_id, schema_version, corpus_hash, corpus_json, expert_label_count, synthetic_fixture_count, frozen_at)
      VALUES ('test-corpus', '1.0.0', 'hash123', '${JSON.stringify({ version: '1.0.0', corpusId: 'test-corpus', createdAt: '2026-01-01', description: 'test', candidateEvidence: [], roleRequirements: [], expertLabels: [], metadata: { totalLabels: 5, totalCandidates: 2, totalRoles: 1, totalChallenges: 3, syntheticFixtureCount: 0 } })}', 5, 0, ${Math.floor(Date.now() / 1000)});
    `);
    sqlite.exec(`
      INSERT INTO evaluation_results (id, corpus_id, match_run_ids_json, comparison_match_run_ids_json, metrics_json, result_json, passed, created_at)
      VALUES ('eval-1', 'test-corpus', '["run-1"]', '[]', '${JSON.stringify(passingResult.metrics)}', '${JSON.stringify(passingResult)}', 1, ${Math.floor(Date.now() / 1000)});
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', rolloutGate);

    const res = await app.request('/rollout-gate/auto-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateKey: 'living_context', corpusId: 'test-corpus' }),
    }, { DB: db });

    expect(res.status).toBe(200);
    const body = await res.json() as { progressed: boolean; from: string; to: string; evalStage: string };
    expect(body.progressed).toBe(true);
    expect(body.from).toBe('internal_only');
    expect(body.to).toBe('canary');
    expect(body.evalStage).toBe('shadow');

    const row = sqlite.prepare('SELECT stage FROM rollout_gates WHERE gate_key = ?').get('living_context') as { stage: string } | undefined;
    expect(row?.stage).toBe('canary');

    const audit = sqlite.prepare('SELECT * FROM rollout_gate_audit_log WHERE gate_key = ?').all('living_context') as Array<{ updated_by: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.updated_by).toBe('auto-progress');
  });
});
