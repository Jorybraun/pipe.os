import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  scoreMatchConfidence,
  computeMatchConfidence,
} from '../matchConfidenceScoring';
import type { D1Database } from '@cloudflare/workers-types';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const repoGraphMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);


const NOW = "datetime('now')";

function seedCandidate(sqlite: BetterSqliteDb, candidateId: string, userId: string): void {
  sqlite.exec(`INSERT INTO candidates (id, owner_id) VALUES ('${candidateId}', '${userId}');`);
}

function seedWorkspacePerson(
  sqlite: BetterSqliteDb,
  candidateId: string,
  wpId: string,
): void {
  sqlite.exec(`
    INSERT INTO people (id, ingestion_key, created_at, updated_at)
    VALUES ('person-${wpId}', 'ik-person-${wpId}', ${NOW}, ${NOW});
    INSERT INTO workspace_people (id, person_id, workspace_id, ingestion_key, context_json, created_at, updated_at)
    VALUES ('${wpId}', 'person-${wpId}', 'ws-1', 'ik-wp-${wpId}', '{}', ${NOW}, ${NOW});
    INSERT INTO applications (id, workspace_person_id, legacy_candidate_id, ingestion_key, created_at, updated_at)
    VALUES ('app-${wpId}', '${wpId}', '${candidateId}', 'ik-app-${wpId}', ${NOW}, ${NOW});
  `);
}

function seedChallengePacket(
  sqlite: BetterSqliteDb,
  packetId: string,
  demands: Array<{ id: string; narrative: string; weight: number; concepts: string[] }>,
): void {
  const row = sqlite.prepare(
    `SELECT id FROM repo_snapshots LIMIT 1`,
  ).get() as { id: string } | undefined;
  let snapshotId = 'snapshot-1';
  if (!row) {
    const repoRow = sqlite.prepare(`SELECT id FROM qualified_repos LIMIT 1`).get() as { id: string } | undefined;
    let repoId: number;
    if (!repoRow) {
      sqlite.exec(`INSERT INTO qualified_repos (id, full_name, url, default_branch, created_at, updated_at) VALUES (1, 'test/repo', 'https://github.com/test/repo', 'main', ${NOW}, ${NOW});`);
      repoId = 1;
    } else {
      repoId = Number(repoRow.id);
    }
    sqlite.exec(`INSERT INTO repo_snapshots (id, repo_id, commit_sha, extractor_version) VALUES ('${snapshotId}', ${repoId}, 'abc123', '1.0.0');`);
  } else {
    snapshotId = row.id;
  }

  const packetJson = JSON.stringify({ id: packetId, demands });
  sqlite.exec(`
    INSERT INTO review_challenge_packets (id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash, quality_score, demand_families_json, packet_json)
    VALUES ('${packetId}', '${snapshotId}', 1, 1, '1.0.0', 'sha256:test', 0.8, '["test"]', '${packetJson.replace(/'/g, "''")}');
  `);
}

function ensureConcept(
  sqlite: BetterSqliteDb,
  conceptId: string,
): void {
  const existing = sqlite.prepare(
    `SELECT id FROM concepts WHERE id = ?`,
  ).get(conceptId) as { id: string } | undefined;
  if (existing) return;
  sqlite.exec(`
    INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, created_at, updated_at)
    VALUES ('${conceptId}', 'ik-${conceptId}', '${conceptId}', 'skill', '${conceptId}', ${NOW}, ${NOW});
  `);
}

function seedInteractionWithEvidence(
  sqlite: BetterSqliteDb,
  wpId: string,
  interactionId: string,
  interactionType: string,
  assertionId: string,
  conceptId: string,
  strength: number,
  observedAt: string,
): void {
  ensureConcept(sqlite, conceptId);

  sqlite.exec(`
    INSERT OR IGNORE INTO interactions (id, ingestion_key, workspace_person_id, interaction_type, started_at, external_reference, created_at, updated_at)
    VALUES ('${interactionId}', 'ik-${interactionId}', '${wpId}', '${interactionType}', '${observedAt}', 'ref-${interactionId}', ${NOW}, ${NOW});
  `);

  sqlite.exec(`
    INSERT INTO semantic_assertions (id, ingestion_key, workspace_person_id, subject_type, predicate, narrative, observed_at, created_at, updated_at)
    VALUES ('${assertionId}', 'ik-${assertionId}', '${wpId}', 'person', 'knows', 'Knows ${conceptId}', '${observedAt}', ${NOW}, ${NOW});
  `);

  sqlite.exec(`
    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES ('${assertionId}', '${conceptId}', 'subject', 1.0, ${NOW});
  `);

  sqlite.exec(`
    INSERT INTO signal_evidence (id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id, signal_key, evidence_level, strength, created_at, updated_at)
    VALUES ('se-${assertionId}', 'ik-se-${assertionId}', '${wpId}', '${interactionId}', '${assertionId}', '${conceptId}', '${conceptId}', 'demonstrated', ${strength}, ${NOW}, ${NOW});
  `);
}

describe('matchConfidenceScoring', () => {
  describe('scoreMatchConfidence (pure)', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const recentDate = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const oldDate = new Date(now.getTime() - 200 * 86_400_000).toISOString();

    it('returns high confidence when all demands have strong recent evidence', () => {
      const evidence = [
        { assertion_id: 'a1', narrative: 'Knows TypeScript', concept_key: 'typescript', strength: 0.9, evidence_level: 'primary', observed_at: recentDate, exact_text: 'TS expert', interaction_type: 'interview' },
        { assertion_id: 'a2', narrative: 'Knows TypeScript', concept_key: 'typescript', strength: 0.85, evidence_level: 'primary', observed_at: recentDate, exact_text: 'TS code', interaction_type: 'code_review' },
        { assertion_id: 'a3', narrative: 'Knows React', concept_key: 'react', strength: 0.8, evidence_level: 'primary', observed_at: recentDate, exact_text: 'React components', interaction_type: 'assessment' },
      ];
      const demands = [
        { id: 'd1', narrative: 'TypeScript proficiency', weight: 0.8, concepts: ['typescript'] },
        { id: 'd2', narrative: 'React experience', weight: 0.6, concepts: ['react'] },
      ];

      const result = scoreMatchConfidence(evidence, demands, { now });

      expect(result.compositeLevel).toBe('high');
      expect(result.compositeScore).toBeGreaterThan(0.6);
      expect(result.strongMatches.length).toBeGreaterThanOrEqual(1);
      expect(result.stretchAreas).toHaveLength(0);
    });

    it('returns lower confidence when evidence is stale', () => {
      const evidence = [
        { assertion_id: 'a1', narrative: 'Knows TypeScript', concept_key: 'typescript', strength: 0.9, evidence_level: 'primary', observed_at: oldDate, exact_text: 'TS expert', interaction_type: 'interview' },
      ];
      const freshEvidence = [
        { assertion_id: 'a1', narrative: 'Knows TypeScript', concept_key: 'typescript', strength: 0.9, evidence_level: 'primary', observed_at: recentDate, exact_text: 'TS expert', interaction_type: 'interview' },
      ];
      const demands = [
        { id: 'd1', narrative: 'TypeScript proficiency', weight: 0.8, concepts: ['typescript'] },
      ];

      const staleResult = scoreMatchConfidence(evidence, demands, { now });
      const freshResult = scoreMatchConfidence(freshEvidence, demands, { now });

      expect(staleResult.compositeScore).toBeLessThan(freshResult.compositeScore);
      expect(staleResult.dimensions.find((d) => d.name === 'recency')!.score)
        .toBeLessThan(freshResult.dimensions.find((d) => d.name === 'recency')!.score);
    });

    it('returns insufficient confidence when no evidence matches demands', () => {
      const evidence = [
        { assertion_id: 'a1', narrative: 'Knows Python', concept_key: 'python', strength: 0.9, evidence_level: 'primary', observed_at: recentDate, exact_text: 'Python expert', interaction_type: 'interview' },
      ];
      const demands = [
        { id: 'd1', narrative: 'TypeScript proficiency', weight: 0.8, concepts: ['typescript'] },
        { id: 'd2', narrative: 'React experience', weight: 0.6, concepts: ['react'] },
      ];

      const result = scoreMatchConfidence(evidence, demands, { now });

      expect(result.compositeLevel).toBe('insufficient');
      expect(result.compositeScore).toBeLessThan(0.2);
      expect(result.demands.every((d) => d.coverageRatio === 0)).toBe(true);
    });

    it('identifies stretch areas when partial concept overlap', () => {
      const evidence = [
        { assertion_id: 'a1', narrative: 'Knows JS', concept_key: 'javascript', strength: 0.7, evidence_level: 'primary', observed_at: recentDate, exact_text: 'JS dev', interaction_type: 'interview' },
      ];
      const demands = [
        { id: 'd1', narrative: 'Full-stack TypeScript', weight: 0.8, concepts: ['typescript', 'javascript', 'nodejs', 'react'] },
      ];

      const result = scoreMatchConfidence(evidence, demands, { now });

      expect(result.stretchAreas).toHaveLength(1);
      expect(result.stretchAreas[0]!.isStretch).toBe(true);
      expect(result.stretchAreas[0]!.matchedConcepts).toEqual(['javascript']);
      expect(result.stretchAreas[0]!.missingConcepts).toEqual(['typescript', 'nodejs', 'react']);
    });

    it('rewards multi-source corroboration', () => {
      const singleSourceEvidence = [
        { assertion_id: 'a1', narrative: 'Knows TS', concept_key: 'typescript', strength: 0.8, evidence_level: 'primary', observed_at: recentDate, exact_text: 'TS', interaction_type: 'interview' },
      ];
      const multiSourceEvidence = [
        { assertion_id: 'a1', narrative: 'Knows TS', concept_key: 'typescript', strength: 0.8, evidence_level: 'primary', observed_at: recentDate, exact_text: 'TS', interaction_type: 'interview' },
        { assertion_id: 'a2', narrative: 'Knows TS', concept_key: 'typescript', strength: 0.75, evidence_level: 'primary', observed_at: recentDate, exact_text: 'TS', interaction_type: 'code_review' },
        { assertion_id: 'a3', narrative: 'Knows TS', concept_key: 'typescript', strength: 0.7, evidence_level: 'secondary', observed_at: recentDate, exact_text: 'TS', interaction_type: 'assessment' },
      ];
      const demands = [
        { id: 'd1', narrative: 'TypeScript', weight: 1.0, concepts: ['typescript'] },
      ];

      const singleResult = scoreMatchConfidence(singleSourceEvidence, demands, { now });
      const multiResult = scoreMatchConfidence(multiSourceEvidence, demands, { now });

      expect(multiResult.demands[0]!.corroboratingSourceCount).toBe(3);
      expect(singleResult.demands[0]!.corroboratingSourceCount).toBe(1);
      expect(multiResult.dimensions.find((d) => d.name === 'depth')!.score)
        .toBeGreaterThan(singleResult.dimensions.find((d) => d.name === 'depth')!.score);
    });

    it('produces recommendations for insufficient and stretch areas', () => {
      const evidence = [
        { assertion_id: 'a1', narrative: 'Knows JS', concept_key: 'javascript', strength: 0.7, evidence_level: 'primary', observed_at: recentDate, exact_text: 'JS', interaction_type: 'interview' },
      ];
      const demands = [
        { id: 'd1', narrative: 'TypeScript expertise', weight: 0.9, concepts: ['typescript', 'type-safety'] },
        { id: 'd2', narrative: 'JavaScript experience', weight: 0.5, concepts: ['javascript', 'nodejs', 'es-modules', 'closures'] },
      ];

      const result = scoreMatchConfidence(evidence, demands, { now });

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some((r) => r.includes('lack sufficient evidence') || r.includes('stretch'))).toBe(true);
    });

    it('handles empty demands list gracefully', () => {
      const evidence = [
        { assertion_id: 'a1', narrative: 'Knows TS', concept_key: 'typescript', strength: 0.8, evidence_level: 'primary', observed_at: recentDate, exact_text: 'TS', interaction_type: 'interview' },
      ];
      const demands: Array<{ id: string; narrative: string; weight: number; concepts: string[] }> = [];

      const result = scoreMatchConfidence(evidence, demands, { now });

      expect(result.demands).toHaveLength(0);
      expect(result.dimensions).toHaveLength(4);
      // With no demands, consistency defaults to 1.0 so composite may be non-zero
      // from the consistency dimension weight alone
      expect(result.compositeScore).toBeLessThan(0.2);
    });

    it('handles empty evidence list gracefully', () => {
      const demands = [
        { id: 'd1', narrative: 'TypeScript', weight: 0.8, concepts: ['typescript'] },
      ];

      const result = scoreMatchConfidence([], demands, { now });

      expect(result.compositeLevel).toBe('insufficient');
      expect(result.demands[0]!.confidenceLevel).toBe('insufficient');
      expect(result.demands[0]!.coverageRatio).toBe(0);
    });

    it('weighs high-weight demands more in composite score', () => {
      const evidence = [
        { assertion_id: 'a1', narrative: 'Knows TS', concept_key: 'typescript', strength: 0.9, evidence_level: 'primary', observed_at: recentDate, exact_text: 'TS', interaction_type: 'interview' },
      ];

      const highWeightFirst = [
        { id: 'd1', narrative: 'TypeScript', weight: 1.0, concepts: ['typescript'] },
        { id: 'd2', narrative: 'Go', weight: 0.1, concepts: ['golang'] },
      ];
      const lowWeightFirst = [
        { id: 'd1', narrative: 'TypeScript', weight: 0.1, concepts: ['typescript'] },
        { id: 'd2', narrative: 'Go', weight: 1.0, concepts: ['golang'] },
      ];

      const highResult = scoreMatchConfidence(evidence, highWeightFirst, { now });
      const lowResult = scoreMatchConfidence(evidence, lowWeightFirst, { now });

      expect(highResult.compositeScore).toBeGreaterThan(lowResult.compositeScore);
    });

    it('recognizes adjacent source-backed runtime concepts without matching unrelated frontend evidence', () => {
      const workersEvidence = [
        {
          assertion_id: 'workers-1',
          narrative: 'Debugged Uint8Array and ArrayBuffer typed-array serialization bugs in Cloudflare Workers SDK runtime persistence.',
          concept_key: 'term:array-buffer-typed',
          strength: 0.9,
          evidence_level: 'primary',
          observed_at: recentDate,
          exact_text: 'Resolved sliced Uint8Array output dragging oversized backing ArrayBuffer into workflow storage.',
          interaction_type: 'code_review',
        },
        {
          assertion_id: 'workers-2',
          narrative: 'Added regression tests for Workflows storage normalization and local wrangler runtime parity.',
          concept_key: 'term:cloudflare-workers-sdk',
          strength: 0.85,
          evidence_level: 'primary',
          observed_at: recentDate,
          exact_text: 'Tests cover normalizeForStorage, workflows, wrangler, and step output persistence.',
          interaction_type: 'assessment',
        },
      ];
      const frontendEvidence = [
        {
          assertion_id: 'mui-1',
          narrative: 'Reviewed React popover onOpenChange and impatient click behavior.',
          concept_key: 'term:react-typescript-popup',
          strength: 0.9,
          evidence_level: 'primary',
          observed_at: recentDate,
          exact_text: 'Focused on hover safe polygon and active trigger ownership.',
          interaction_type: 'code_review',
        },
      ];
      const demands = [
        {
          id: 'workers-runtime',
          narrative: 'Review Workflows Uint8Array storage normalization in Workers SDK',
          weight: 1,
          concepts: [
            'term:uint8array',
            'term:array-buffer-view',
            'term:normalize-for-storage',
            'term:workflows',
            'term:wrangler',
          ],
        },
      ];

      const workersResult = scoreMatchConfidence(workersEvidence, demands, { now });
      const frontendResult = scoreMatchConfidence(frontendEvidence, demands, { now });

      expect(workersResult.demands[0]!.matchedConcepts).toEqual([
        'term:uint8array',
        'term:array-buffer-view',
        'term:normalize-for-storage',
        'term:workflows',
        'term:wrangler',
      ]);
      expect(workersResult.compositeScore).toBeGreaterThanOrEqual(0.45);
      expect(workersResult.compositeScore - frontendResult.compositeScore).toBeGreaterThanOrEqual(0.25);
      expect(frontendResult.demands[0]!.matchedConcepts).toEqual([]);
    });

    it('discounts generated source boilerplate when scoring large PR demand concept lists', () => {
      const evidence = [
        {
          assertion_id: 'workers-1',
          narrative: 'Debugged Uint8Array and ArrayBuffer typed-array serialization bugs in workflow persistence.',
          concept_key: 'term:array-buffer-typed',
          strength: 0.9,
          evidence_level: 'primary',
          observed_at: recentDate,
          exact_text: 'normalizeForStorage keeps sliced Uint8Array values from persisting oversized ArrayBuffers.',
          interaction_type: 'code_review',
        },
      ];
      const demands = [
        {
          id: 'generated-pr-demand',
          narrative: 'Generated source demand with boilerplate and domain terms',
          weight: 1,
          concepts: [
            'artifact:source',
            'term:async',
            'term:await',
            'term:class',
            'term:context',
            'term:export',
            'term:function',
            'term:get',
            'term:new',
            'term:object',
            'term:packages',
            'term:src',
            'term:string',
            'term:type',
            'term:uint8array',
            'term:array-buffer-view',
            'term:normalize-for-storage',
            'term:workflows',
          ],
        },
      ];

      const result = scoreMatchConfidence(evidence, demands, { now });

      expect(result.demands[0]!.matchedConcepts).toEqual([
        'term:uint8array',
        'term:array-buffer-view',
        'term:normalize-for-storage',
        'term:workflows',
      ]);
      expect(result.demands[0]!.missingConcepts).toEqual([]);
      expect(result.demands[0]!.coverageRatio).toBe(1);
    });
  });

  describe('computeMatchConfidence (D1 integration)', () => {
    let sqlite: BetterSqliteDb;
    let mockDb: D1Database;

    beforeEach(() => {
      sqlite = new Database(':memory:');
      sqlite.pragma('journal_mode = WAL');
      sqlite.exec(`
        CREATE TABLE candidates (id TEXT PRIMARY KEY, owner_id TEXT, pipeline_id TEXT);
        CREATE TABLE pipelines (id TEXT PRIMARY KEY, owner_id TEXT);
        CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY, full_name TEXT, url TEXT, default_branch TEXT, created_at TEXT, updated_at TEXT);
      `);
      sqlite.exec(livingContextMigration);
      sqlite.exec(repoGraphMigration);
      mockDb = createMockD1(sqlite) as unknown as D1Database;
    });

    afterEach(() => {
      sqlite.close();
    });

    it('loads evidence from D1 and produces a confidence report', async () => {
      seedCandidate(sqlite, 'cand-1', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-1', 'wp-1');

      const now = new Date('2026-07-01T00:00:00Z');
      const recentDate = new Date(now.getTime() - 3 * 86_400_000).toISOString();

      seedInteractionWithEvidence(sqlite, 'wp-1', 'int-1', 'interview', 'assert-1', 'typescript', 0.85, recentDate);
      seedInteractionWithEvidence(sqlite, 'wp-1', 'int-2', 'code_review', 'assert-2', 'typescript', 0.8, recentDate);
      seedInteractionWithEvidence(sqlite, 'wp-1', 'int-3', 'assessment', 'assert-3', 'react', 0.7, recentDate);

      seedChallengePacket(sqlite, 'packet-1', [
        { id: 'demand-1', narrative: 'TypeScript expertise', weight: 0.8, concepts: ['typescript'] },
        { id: 'demand-2', narrative: 'React experience', weight: 0.6, concepts: ['react'] },
      ]);

      const report = await computeMatchConfidence(mockDb, 'cand-1', 'packet-1', { now });

      expect(report.candidateId).toBe('cand-1');
      expect(report.workspacePersonId).toBe('wp-1');
      expect(report.challengeId).toBe('packet-1');
      expect(report.compositeScore).toBeGreaterThan(0);
      expect(report.dimensions).toHaveLength(4);
      expect(report.demands).toHaveLength(2);
      expect(report.computedAt).toBe(now.toISOString());
    });

    it('throws when challenge packet is not found', async () => {
      seedCandidate(sqlite, 'cand-1', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-1', 'wp-1');

      await expect(
        computeMatchConfidence(mockDb, 'cand-1', 'nonexistent-packet'),
      ).rejects.toThrow('Challenge packet nonexistent-packet not found');
    });

    it('returns zero confidence when candidate has no workspace person', async () => {
      seedCandidate(sqlite, 'cand-orphan', 'user-1');
      seedChallengePacket(sqlite, 'packet-2', [
        { id: 'demand-1', narrative: 'TypeScript', weight: 1.0, concepts: ['typescript'] },
      ]);

      const report = await computeMatchConfidence(mockDb, 'cand-orphan', 'packet-2');

      expect(report.workspacePersonId).toBeNull();
      expect(report.compositeScore).toBeLessThan(0.2);
      expect(report.compositeLevel).toBe('insufficient');
    });
  });
});
