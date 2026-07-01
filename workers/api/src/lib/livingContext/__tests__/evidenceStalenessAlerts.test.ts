import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  computeStalenessAlerts,
  loadCandidateStalenessAlerts,
} from '../evidenceStalenessAlerts';
import type { StalenessAlert } from '../evidenceStalenessAlerts';
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

function seedInteraction(
  sqlite: BetterSqliteDb,
  wpId: string,
  interactionId: string,
  interactionType: string,
  startedAt: string,
  externalRef: string = 'source-1',
): void {
  sqlite.exec(`
    INSERT INTO interactions (id, ingestion_key, workspace_person_id, interaction_type, started_at, external_reference, created_at, updated_at)
    VALUES ('${interactionId}', 'ik-${interactionId}', '${wpId}', '${interactionType}', '${startedAt}', '${externalRef}', ${NOW}, ${NOW});
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

function seedAssertion(
  sqlite: BetterSqliteDb,
  wpId: string,
  assertionId: string,
  observedAt: string,
  conceptId: string = 'concept-1',
): void {
  ensureConcept(sqlite, conceptId);
  sqlite.exec(`
    INSERT INTO semantic_assertions (id, ingestion_key, workspace_person_id, subject_type, predicate, narrative, observed_at, created_at, updated_at)
    VALUES ('${assertionId}', 'ik-${assertionId}', '${wpId}', 'person', 'knows', 'Knows TypeScript', '${observedAt}', ${NOW}, ${NOW});
    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES ('${assertionId}', '${conceptId}', 'subject', 1.0, ${NOW});
  `);
}

describe('evidenceStalenessAlerts', () => {
  describe('computeStalenessAlerts (pure)', () => {
    const now = new Date('2026-06-30T12:00:00Z');

    it('returns no alerts for fresh evidence across all core dimensions', () => {
      const recentDate = new Date(now.getTime() - 7 * 86_400_000).toISOString();
      const dimensions = [
        { dimension: 'resume', freshestAt: recentDate, evidenceCount: 3, sourceSpanCount: 10, distinctSources: 2 },
        { dimension: 'interview', freshestAt: recentDate, evidenceCount: 2, sourceSpanCount: 5, distinctSources: 2 },
        { dimension: 'assessment', freshestAt: recentDate, evidenceCount: 1, sourceSpanCount: 3, distinctSources: 1 },
        { dimension: 'code_review', freshestAt: recentDate, evidenceCount: 2, sourceSpanCount: 8, distinctSources: 2 },
      ];
      const concepts = { distinctConcepts: 10, freshestAt: recentDate };

      const alerts = computeStalenessAlerts(dimensions, concepts, { now });

      const nonInfo = alerts.filter((a) => a.severity !== 'info');
      expect(nonInfo).toEqual([]);
    });

    it('raises critical alert for stale evidence (>180 days)', () => {
      const staleDate = new Date(now.getTime() - 200 * 86_400_000).toISOString();
      const dimensions = [
        { dimension: 'resume', freshestAt: staleDate, evidenceCount: 1, sourceSpanCount: 2, distinctSources: 2 },
      ];
      const concepts = { distinctConcepts: 10, freshestAt: now.toISOString() };

      const alerts = computeStalenessAlerts(dimensions, concepts, { now });

      const staleAlerts = alerts.filter((a) => a.category === 'stale_evidence');
      expect(staleAlerts).toHaveLength(1);
      expect(staleAlerts[0]!.severity).toBe('critical');
      expect(staleAlerts[0]!.dimension).toBe('resume');
      expect(staleAlerts[0]!.ageDays).toBe(200);
      expect(staleAlerts[0]!.decayMultiplier).toBeLessThan(0.5);
    });

    it('raises warning alert for aging evidence (>90 days)', () => {
      const agingDate = new Date(now.getTime() - 120 * 86_400_000).toISOString();
      const dimensions = [
        { dimension: 'interview', freshestAt: agingDate, evidenceCount: 2, sourceSpanCount: 5, distinctSources: 2 },
      ];
      const concepts = { distinctConcepts: 10, freshestAt: now.toISOString() };

      const alerts = computeStalenessAlerts(dimensions, concepts, { now });

      const agingAlerts = alerts.filter((a) => a.category === 'aging_dimension');
      expect(agingAlerts).toHaveLength(1);
      expect(agingAlerts[0]!.severity).toBe('warning');
      expect(agingAlerts[0]!.dimension).toBe('interview');
      expect(agingAlerts[0]!.ageDays).toBe(120);
    });

    it('raises warning for missing core dimensions', () => {
      const dimensions = [
        { dimension: 'resume', freshestAt: now.toISOString(), evidenceCount: 1, sourceSpanCount: 2, distinctSources: 1 },
      ];
      const concepts = { distinctConcepts: 10, freshestAt: now.toISOString() };

      const alerts = computeStalenessAlerts(dimensions, concepts, { now });

      const missingAlerts = alerts.filter((a) => a.category === 'missing_dimension');
      expect(missingAlerts).toHaveLength(3);
      const missingDims = missingAlerts.map((a) => a.dimension).sort();
      expect(missingDims).toEqual(['assessment', 'code_review', 'interview']);
      expect(missingAlerts.every((a) => a.severity === 'warning')).toBe(true);
    });

    it('raises info alert for single-source dimensions', () => {
      const recentDate = now.toISOString();
      const dimensions = [
        { dimension: 'resume', freshestAt: recentDate, evidenceCount: 3, sourceSpanCount: 10, distinctSources: 1 },
        { dimension: 'interview', freshestAt: recentDate, evidenceCount: 2, sourceSpanCount: 5, distinctSources: 2 },
        { dimension: 'assessment', freshestAt: recentDate, evidenceCount: 1, sourceSpanCount: 3, distinctSources: 1 },
        { dimension: 'code_review', freshestAt: recentDate, evidenceCount: 2, sourceSpanCount: 8, distinctSources: 2 },
      ];
      const concepts = { distinctConcepts: 10, freshestAt: recentDate };

      const alerts = computeStalenessAlerts(dimensions, concepts, { now });

      const singleSource = alerts.filter((a) => a.category === 'single_source');
      expect(singleSource).toHaveLength(2);
      expect(singleSource.map((a) => a.dimension).sort()).toEqual(['assessment', 'resume']);
      expect(singleSource.every((a) => a.severity === 'info')).toBe(true);
    });

    it('raises low-coverage alert for few concepts', () => {
      const dimensions = [
        { dimension: 'resume', freshestAt: now.toISOString(), evidenceCount: 1, sourceSpanCount: 2, distinctSources: 2 },
        { dimension: 'interview', freshestAt: now.toISOString(), evidenceCount: 1, sourceSpanCount: 2, distinctSources: 1 },
        { dimension: 'assessment', freshestAt: now.toISOString(), evidenceCount: 1, sourceSpanCount: 2, distinctSources: 1 },
        { dimension: 'code_review', freshestAt: now.toISOString(), evidenceCount: 1, sourceSpanCount: 2, distinctSources: 1 },
      ];
      const concepts = { distinctConcepts: 2, freshestAt: now.toISOString() };

      const alerts = computeStalenessAlerts(dimensions, concepts, { now });

      const lowCoverage = alerts.filter((a) => a.category === 'low_coverage');
      expect(lowCoverage).toHaveLength(1);
      expect(lowCoverage[0]!.severity).toBe('info');
      expect(lowCoverage[0]!.detail).toContain('2 distinct concepts');
    });

    it('sorts alerts by severity: critical > warning > info', () => {
      const staleDate = new Date(now.getTime() - 200 * 86_400_000).toISOString();
      const dimensions = [
        { dimension: 'resume', freshestAt: staleDate, evidenceCount: 1, sourceSpanCount: 2, distinctSources: 1 },
      ];
      const concepts = { distinctConcepts: 2, freshestAt: now.toISOString() };

      const alerts = computeStalenessAlerts(dimensions, concepts, { now });

      const severities = alerts.map((a) => a.severity);
      const criticalIdx = severities.indexOf('critical');
      const warningIdx = severities.indexOf('warning');
      const infoIdx = severities.indexOf('info');
      if (criticalIdx >= 0 && warningIdx >= 0) expect(criticalIdx).toBeLessThan(warningIdx);
      if (warningIdx >= 0 && infoIdx >= 0) expect(warningIdx).toBeLessThan(infoIdx);
    });

    it('respects custom thresholds', () => {
      const agingDate = new Date(now.getTime() - 50 * 86_400_000).toISOString();
      const dimensions = [
        { dimension: 'resume', freshestAt: agingDate, evidenceCount: 1, sourceSpanCount: 2, distinctSources: 2 },
        { dimension: 'interview', freshestAt: now.toISOString(), evidenceCount: 1, sourceSpanCount: 2, distinctSources: 1 },
        { dimension: 'assessment', freshestAt: now.toISOString(), evidenceCount: 1, sourceSpanCount: 2, distinctSources: 1 },
        { dimension: 'code_review', freshestAt: now.toISOString(), evidenceCount: 1, sourceSpanCount: 2, distinctSources: 1 },
      ];
      const concepts = { distinctConcepts: 10, freshestAt: now.toISOString() };

      const alerts = computeStalenessAlerts(dimensions, concepts, {
        now,
        agingDaysThreshold: 30,
        staleDaysThreshold: 60,
      });

      const agingAlerts = alerts.filter((a) => a.category === 'aging_dimension');
      expect(agingAlerts).toHaveLength(1);
      expect(agingAlerts[0]!.dimension).toBe('resume');
    });
  });

  describe('loadCandidateStalenessAlerts (D1)', () => {
    let sqlite: BetterSqliteDb;

    beforeEach(() => {
      sqlite = new Database(':memory:');
      sqlite.exec('PRAGMA foreign_keys = ON;');
      sqlite.exec(`
        CREATE TABLE candidates (id TEXT PRIMARY KEY, owner_id TEXT, pipeline_id TEXT);
        CREATE TABLE pipelines (id TEXT PRIMARY KEY, owner_id TEXT);
      `);
      sqlite.exec(livingContextMigration);
      sqlite.exec(repoGraphMigration);
    });

    afterEach(() => {
      sqlite.close();
    });

    it('returns null for a candidate without workspace identity', async () => {
      seedCandidate(sqlite, 'c-1', 'user-1');
      const db = createMockD1(sqlite) as unknown as D1Database;

      const result = await loadCandidateStalenessAlerts(db, 'c-1');

      expect(result).toBeNull();
    });

    it('returns missing-dimension alerts for a candidate with no interactions', async () => {
      seedCandidate(sqlite, 'c-2', 'user-1');
      seedWorkspacePerson(sqlite, 'c-2', 'wp-2');
      const db = createMockD1(sqlite) as unknown as D1Database;

      const result = await loadCandidateStalenessAlerts(db, 'c-2');

      expect(result).not.toBeNull();
      expect(result!.candidateId).toBe('c-2');
      expect(result!.workspacePersonId).toBe('wp-2');

      const missingAlerts = result!.alerts.filter((a) => a.category === 'missing_dimension');
      expect(missingAlerts.length).toBeGreaterThanOrEqual(4);

      const lowCoverage = result!.alerts.filter((a) => a.category === 'low_coverage');
      expect(lowCoverage).toHaveLength(1);
    });

    it('produces stale alert for old resume evidence', async () => {
      seedCandidate(sqlite, 'c-3', 'user-1');
      seedWorkspacePerson(sqlite, 'c-3', 'wp-3');
      const staleDate = new Date(Date.now() - 200 * 86_400_000).toISOString();
      seedInteraction(sqlite, 'wp-3', 'int-1', 'resume_upload', staleDate);
      const db = createMockD1(sqlite) as unknown as D1Database;

      const result = await loadCandidateStalenessAlerts(db, 'c-3');

      expect(result).not.toBeNull();
      const staleAlerts = result!.alerts.filter(
        (a) => a.category === 'stale_evidence' && a.dimension === 'resume',
      );
      expect(staleAlerts).toHaveLength(1);
      expect(staleAlerts[0]!.severity).toBe('critical');
      expect(result!.criticalCount).toBeGreaterThanOrEqual(1);
      expect(result!.overallHealth).toBe('critical');
    });

    it('classifies overall health correctly with only warnings', async () => {
      seedCandidate(sqlite, 'c-4', 'user-1');
      seedWorkspacePerson(sqlite, 'c-4', 'wp-4');
      const recentDate = new Date(Date.now() - 5 * 86_400_000).toISOString();
      seedInteraction(sqlite, 'wp-4', 'int-r', 'resume_upload', recentDate, 'source-a');
      seedInteraction(sqlite, 'wp-4', 'int-i', 'interview', recentDate, 'source-b');
      seedInteraction(sqlite, 'wp-4', 'int-a', 'assessment', recentDate, 'source-c');
      seedInteraction(sqlite, 'wp-4', 'int-cr', 'code_review', recentDate, 'source-d');
      seedAssertion(sqlite, 'wp-4', 'sa-1', recentDate, 'concept-a');
      seedAssertion(sqlite, 'wp-4', 'sa-2', recentDate, 'concept-b');
      seedAssertion(sqlite, 'wp-4', 'sa-3', recentDate, 'concept-c');
      seedAssertion(sqlite, 'wp-4', 'sa-4', recentDate, 'concept-d');
      seedAssertion(sqlite, 'wp-4', 'sa-5', recentDate, 'concept-e');
      const db = createMockD1(sqlite) as unknown as D1Database;

      const result = await loadCandidateStalenessAlerts(db, 'c-4');

      expect(result).not.toBeNull();
      expect(result!.criticalCount).toBe(0);
      expect(result!.overallHealth).not.toBe('critical');
    });
  });
});
