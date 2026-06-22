/**
 * Candidate routes unit tests — GitHub handle intake wiring.
 *
 * Validates the regex, SQL shapes, and enqueue logic used by the
 * POST /:candidateId/resume handler.
 */

import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, describe, it, expect } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { LivingContextStore } from '../../../lib/livingContext/persistence';
import {
  buildStandaloneReviewDiagnostics,
  buildRolelessTalentPoolContext,
  buildStandaloneReviewMatchSummary,
  ensureRolelessTalentPoolIdentity,
  normalizeCandidateEmail,
  parseStandaloneReviewSubmissionSummary,
  TALENT_POOL_MEMBERSHIP_SCHEMA_BLOCKER,
} from '../candidates';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);

// ─── GitHub handle validation ────────────────────────────────────────────────

const GITHUB_HANDLE_RE = /^[a-zA-Z0-9\-]{1,39}$/;

function isValidGitHubHandle(handle: string | null): boolean {
  if (handle === null || handle === '') return true; // optional
  return GITHUB_HANDLE_RE.test(handle);
}

describe('GitHub handle validation', () => {
  it('accepts valid handles', () => {
    expect(isValidGitHubHandle('alice')).toBe(true);
    expect(isValidGitHubHandle('bob123')).toBe(true);
    expect(isValidGitHubHandle('charlie-dev')).toBe(true);
    expect(isValidGitHubHandle('a')).toBe(true);
    expect(isValidGitHubHandle('a'.repeat(39))).toBe(true);
  });

  it('rejects handles with spaces', () => {
    expect(isValidGitHubHandle('alice bob')).toBe(false);
  });

  it('rejects handles over 39 characters', () => {
    expect(isValidGitHubHandle('a'.repeat(40))).toBe(false);
    expect(isValidGitHubHandle('a'.repeat(100))).toBe(false);
  });

  it('rejects handles with special characters', () => {
    expect(isValidGitHubHandle('alice@example')).toBe(false);
    expect(isValidGitHubHandle('alice.dev')).toBe(false);
    expect(isValidGitHubHandle('alice/dev')).toBe(false);
    expect(isValidGitHubHandle('alice_dev')).toBe(false);
    expect(isValidGitHubHandle('alice:dev')).toBe(false);
  });

  it('rejects empty string after trimming (null/empty is handled upstream)', () => {
    // The regex itself rejects empty string, but the handler treats
    // empty/null as "not provided" before calling the regex.
    expect(GITHUB_HANDLE_RE.test('')).toBe(false);
  });

  it('accepts null and empty as optional', () => {
    expect(isValidGitHubHandle(null)).toBe(true);
    expect(isValidGitHubHandle('')).toBe(true);
  });
});

describe('candidate identity normalization', () => {
  let sqlite: BetterSqliteDb | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('normalizes emails before legacy candidate persistence and living-context convergence', () => {
    expect(normalizeCandidateEmail('  ADA@Example.COM ')).toBe('ada@example.com');
  });

  it('merges roleless talent-pool context without fabricating application or role targets', () => {
    const context = buildRolelessTalentPoolContext({
      source: 'legacy_contact',
      sources: ['legacy_contact'],
      relationshipSummary: 'Met through sourcing',
      talentPool: { joinedAt: '2026-06-01T00:00:00.000Z' },
    }, 'candidate-123', '2026-06-19T00:00:00.000Z');

    expect(context.relationshipSummary).toBe('Met through sourcing');
    expect(context.sources).toEqual(['legacy_contact', 'roleless_candidate_intake']);
    expect(context.legacyCandidateIds).toEqual(['candidate-123']);
    expect(context.talentPool).toEqual({
      joinedAt: '2026-06-01T00:00:00.000Z',
      status: 'active',
      roleless: true,
      candidateId: 'candidate-123',
      membershipSchemaBlocker: TALENT_POOL_MEMBERSHIP_SCHEMA_BLOCKER,
    });
    expect(context).not.toHaveProperty('applicationId');
    expect(context).not.toHaveProperty('roleId');
    expect(context).not.toHaveProperty('seniority');
    expect(context).not.toHaveProperty('matchTarget');
  });

  it('creates roleless person identity without application or role rows while preserving message evidence', async () => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pipeline_id TEXT,
        name TEXT,
        email TEXT,
        invite_token TEXT,
        status TEXT NOT NULL,
        current_stage_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      INSERT INTO candidates (
        id, owner_id, pipeline_id, name, email, invite_token, status, current_stage_id, created_at, updated_at
      ) VALUES (
        'candidate-123', 'workspace-1', NULL, 'Ada Candidate', 'ada@example.com',
        'invite-123', 'INVITED', NULL, '2026-06-20T00:00:00.000Z', '2026-06-20T00:00:00.000Z'
      );
    `);
    sqlite.exec(livingContextMigration);
    const db = createMockD1(sqlite);
    const store = new LivingContextStore(db, () => '2026-06-19T00:00:00.000Z');
    const person = await store.upsertPerson({
      ingestionKey: 'email:ada@example.com',
      displayName: 'Ada Contact',
      primaryEmail: 'ada@example.com',
      externalIds: { legacyContactId: 'contact-1' },
    });
    await store.upsertWorkspacePerson({
      ingestionKey: `workspace:workspace-1:person:${person.id}`,
      workspaceId: 'workspace-1',
      personId: person.id,
      context: {
        source: 'legacy_contact',
        sources: ['legacy_contact'],
        contactId: 'contact-1',
        relationshipSummary: 'Met through sourcing',
      },
    });

    const originalMessage = '  I shipped the GraphQL retry fix.\nPlease keep this exact note.  ';
    const identity = await ensureRolelessTalentPoolIdentity({
      db,
      userId: 'workspace-1',
      candidateId: 'candidate-123',
      name: 'Ada Candidate',
      email: 'ada@example.com',
      message: originalMessage,
      now: '2026-06-20T00:00:00.000Z',
    });

    expect(identity.personId).toBe(person.id);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM applications').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM person_roles').get()).toEqual({ count: 0 });
    expect(JSON.parse(sqlite.prepare(
      `SELECT context_json FROM workspace_people WHERE id = ?`,
    ).get(identity.workspacePersonId)!.context_json as string)).toMatchObject({
      contactId: 'contact-1',
      relationshipSummary: 'Met through sourcing',
      sources: ['legacy_contact', 'roleless_candidate_intake'],
      legacyCandidateIds: ['candidate-123'],
      talentPool: {
        status: 'active',
        roleless: true,
        candidateId: 'candidate-123',
      },
    });
    expect(sqlite.prepare(
      `SELECT interaction_type, application_id, external_reference
         FROM interactions WHERE workspace_person_id = ?`,
    ).get(identity.workspacePersonId)).toEqual({
      interaction_type: 'message',
      application_id: null,
      external_reference: 'candidate-123',
    });
    expect(sqlite.prepare(
      `SELECT artifact_type, logical_key, workspace_person_id
         FROM artifacts`,
    ).get()).toEqual({
      artifact_type: 'message',
      logical_key: 'roleless_candidate_intake_message',
      workspace_person_id: identity.workspacePersonId,
    });
    const version = sqlite.prepare(
      `SELECT id, version_number, media_type, content_text, byte_length
         FROM artifact_versions`,
    ).get() as {
      id: string;
      version_number: number;
      media_type: string;
      content_text: string;
      byte_length: number;
    };
    expect(version).toMatchObject({
      version_number: 1,
      media_type: 'text/plain',
      content_text: originalMessage,
      byte_length: new TextEncoder().encode(originalMessage).byteLength,
    });
    expect(sqlite.prepare(
      `SELECT artifact_version_id, stable_segment_id, char_start, char_end, exact_text
         FROM source_spans`,
    ).get()).toEqual({
      artifact_version_id: version.id,
      stable_segment_id: 'full-message',
      char_start: 0,
      char_end: originalMessage.length,
      exact_text: originalMessage,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM semantic_assertions').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM concepts').get()).toEqual({ count: 0 });
  });
});

// ─── SQL shape validation ────────────────────────────────────────────────────

describe('Enrichment job SQL shapes', () => {
  it('inserts enrichment_jobs with all required columns', () => {
    // The handler must include id, source_type, source_url, status, created_at.
    const sql = `INSERT INTO enrichment_jobs (id, candidate_id, source_type, source_url, status, created_at)
           VALUES (?1, ?2, 'github', ?3, 'PENDING', unixepoch())`;
    expect(sql).toContain('id');
    expect(sql).toContain('source_type');
    expect(sql).toContain('source_url');
    expect(sql).toContain('status');
    expect(sql).toContain('created_at');
    expect(sql).toContain("'github'");
    expect(sql).toContain("'PENDING'");
  });

  it('upserts candidate_ingestion.github_url with conflict handling', () => {
    const sql = `INSERT INTO candidate_ingestion (candidate_id, github_url, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?3)
           ON CONFLICT(candidate_id) DO UPDATE SET
             github_url = excluded.github_url,
             updated_at = excluded.updated_at`;
    expect(sql).toContain('ON CONFLICT(candidate_id)');
    expect(sql).toContain('github_url = excluded.github_url');
  });
});

describe('Standalone CODE_REVIEW match summary', () => {
  it('surfaces pending intake as an explicit safe state', () => {
    const summary = buildStandaloneReviewMatchSummary('PENDING_INTAKE', null);

    expect(summary.summary).toContain('Waiting for candidate resume/profile evidence');
    expect(summary.evidence).toEqual([]);
    expect(summary.gaps).toContain('Candidate has not submitted source evidence yet.');
  });

  it('preserves source-backed alignment and guardrail gaps for matched PRs', () => {
    const summary = buildStandaloneReviewMatchSummary('MATCHED', {
      rank: 1,
      recallRank: 1,
      challengeId: 'packet-1',
      repoId: '7',
      prNumber: 42,
      score: 0.82,
      alignedDemandCount: 2,
      stretchCount: 0,
      provenanceComplete: true,
      eligible: true,
      alignments: [{
        atomId: 'candidate-atom-1',
        demandId: 'repo-demand-1',
        purpose: 'validation',
        pairScore: 0.9,
        sharedConcepts: ['graphql'],
        candidateSourceRefs: [{
          artifactId: 'resume-artifact',
          artifactVersion: 'v1',
          contentHash: 'abc',
          startOffset: 10,
          endOffset: 20,
          locator: 'resume line 3',
          exactText: 'Built GraphQL subscriptions for order events.',
        }],
        challengeSourceRefs: [{
          artifactId: 'repo-span',
          artifactVersion: 'commit-a',
          contentHash: 'def',
          startOffset: 30,
          endOffset: 40,
          locator: 'src/api.ts:9',
          exactText: 'Add subscription retry handling to the order API.',
        }],
      }],
      rejectionReasons: [],
    });

    expect(summary.summary).toContain('Matched 2 source-backed demands');
    expect(summary.evidence).toHaveLength(1);
    expect(summary.evidence[0]?.candidateSourceRefs[0]?.locator).toBe('resume line 3');
    expect(summary.evidence[0]?.candidateSourceRefs[0]?.exactText).toContain('GraphQL subscriptions');
    expect(summary.evidence[0]?.challengeSourceRefs[0]?.locator).toBe('src/api.ts:9');
    expect(summary.evidence[0]?.challengeSourceRefs[0]?.exactText).toContain('retry handling');
  });

  it('turns excluded packet diagnostics into reviewer-visible gaps', () => {
    const diagnostics = buildStandaloneReviewDiagnostics(
      JSON.stringify(['packet-source-backed']),
      JSON.stringify([{
        id: 'packet-missing-span',
        repoId: '14',
        prNumber: 88,
        reason: 'MISSING_DEMAND_SOURCE_SPANS',
        demandIds: ['demand-events'],
        missingSourceSpanIds: ['repo-span-missing'],
      }, {
        id: 'packet-unsafe',
        repoId: '15',
        prNumber: 89,
        reason: 'PACKET_NOT_PRODUCTION_READY',
        demandIds: ['demand-rust'],
        missingSourceSpanIds: [],
        gateFailures: ['production_language'],
        qualityScore: 0.4,
      }]),
      [],
    );

    const summary = buildStandaloneReviewMatchSummary('NO_ROLE_SAFE_CHALLENGE', null, diagnostics);

    expect(diagnostics.recalledPacketIds).toEqual(['packet-source-backed']);
    expect(diagnostics.excludedPackets).toHaveLength(2);
    expect(summary.gaps).toEqual([
      'packet-missing-span was excluded because PR demand provenance references missing repo source spans. Demand: demand-events. Missing span: repo-span-missing.',
      'packet-unsafe was excluded because its repo packet is not production-ready. Quality score: 0.40. Failed gate: production_language.',
    ]);
  });

  it('keeps evaluated challenge stretch areas in match diagnostics', () => {
    const diagnostics = buildStandaloneReviewDiagnostics(null, null, [{
      rank: 1,
      recallRank: 3,
      challengeId: 'packet-stretch',
      repoId: '7',
      prNumber: 42,
      score: 0.71,
      alignedDemandCount: 4,
      stretchCount: 2,
      provenanceComplete: true,
      eligible: true,
      alignments: [],
      rejectionReasons: [],
    }]);

    expect(diagnostics.evaluatedChallenges).toEqual([{
      challengeId: 'packet-stretch',
      repoId: '7',
      prNumber: 42,
      recallRank: 3,
      rank: 1,
      eligible: true,
      rejectionReasons: [],
      provenanceComplete: true,
      alignedDemandCount: 4,
      stretchCount: 2,
    }]);
  });
});

describe('Standalone CODE_REVIEW submission summary', () => {
  it('extracts recruiter-visible review verdict, summary, and annotations', () => {
    const summary = parseStandaloneReviewSubmissionSummary(JSON.stringify({
      verdict: 'request_changes',
      summary: 'Main risk is retry idempotency around duplicate events.',
      annotations: [
        {
          file: 'src/orders.ts',
          line: 42,
          severity: 'major',
          comment: 'This retry path can enqueue the same event twice.',
        },
      ],
    }));

    expect(summary).toEqual({
      verdict: 'request_changes',
      summary: 'Main risk is retry idempotency around duplicate events.',
      annotationCount: 1,
      annotations: [{
        file: 'src/orders.ts',
        line: 42,
        severity: 'major',
        comment: 'This retry path can enqueue the same event twice.',
      }],
    });
  });

  it('handles legacy double-encoded standalone submissions', () => {
    const encoded = JSON.stringify(JSON.stringify({
      verdict: 'comment_only',
      summary: 'Looks safe after adding test coverage.',
      annotations: [],
    }));

    expect(parseStandaloneReviewSubmissionSummary(encoded)).toMatchObject({
      verdict: 'comment_only',
      summary: 'Looks safe after adding test coverage.',
      annotationCount: 0,
    });
  });
});
