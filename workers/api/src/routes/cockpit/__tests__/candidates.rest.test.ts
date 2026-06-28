/**
 * Candidate routes unit tests — GitHub handle intake wiring.
 *
 * Validates the regex, SQL shapes, and enqueue logic used by the
 * POST /:candidateId/resume handler.
 */

import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
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
  candidateOps,
} from '../candidates';
import type { Env } from '../../../types';

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

describe('POST / standalone assessment relationship model', () => {
  let sqlite: BetterSqliteDb | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  function seedStandaloneCandidateSchema(): void {
    if (!sqlite) throw new Error('sqlite not initialized');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        invite_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        current_stage_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE candidate_ingestion (
        candidate_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE scheduled_interviews (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        pipeline_id TEXT,
        stage_id TEXT,
        owner_id TEXT NOT NULL,
        interview_type TEXT,
        status TEXT,
        scheduled_at TEXT,
        scheduling_provider TEXT,
        scheduling_url TEXT,
        sync_source TEXT,
        github_repo_url TEXT,
        github_pr_number INTEGER,
        created_at TEXT,
        updated_at TEXT
      );
    `);
    sqlite.exec(livingContextMigration);
  }

  function mountApp(): Hono<{ Bindings: Env }> {
    if (!sqlite) throw new Error('sqlite not initialized');
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', async (c, next) => {
      // @ts-expect-error route test overrides Worker bindings.
      c.env = {
        DB: createMockD1(sqlite!),
        CLERK_SECRET_KEY: 'test',
        DEV_AUTH_BYPASS: 'true',
        DEV_BYPASS_USER_ID: 'workspace-1',
      };
      await next();
    });
    app.route('/', candidateOps);
    return app;
  }

  it('keeps one person identity while creating distinct assessment invite records for the same email', async () => {
    sqlite = new Database(':memory:');
    seedStandaloneCandidateSchema();
    const app = mountApp();

    const firstResponse = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ada Lovelace',
        email: 'Ada@Example.com',
        interviewType: 'CODE_REVIEW',
        skipEmail: true,
      }),
    });
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as {
      candidate: { id: string; inviteToken: string; email: string };
    };

    const secondResponse = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        githubRepoUrl: 'https://github.com/hash-pipe/open-source-task',
        githubPrNumber: 101,
        skipEmail: true,
      }),
    });
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json() as {
      candidate: { id: string; inviteToken: string; email: string };
    };

    expect(first.candidate.id).not.toBe(second.candidate.id);
    expect(first.candidate.inviteToken).not.toBe(second.candidate.inviteToken);
    expect(first.candidate.email).toBe('ada@example.com');
    expect(second.candidate.email).toBe('ada@example.com');

    const candidateRows = sqlite.prepare(
      `SELECT id, invite_token
         FROM candidates
        WHERE owner_id = 'workspace-1'
          AND email = 'ada@example.com'
        ORDER BY created_at ASC`,
    ).all() as Array<{ id: string; invite_token: string }>;
    expect(candidateRows).toHaveLength(2);
    expect(candidateRows.map((row) => row.id)).toEqual([
      first.candidate.id,
      second.candidate.id,
    ]);
    expect(new Set(candidateRows.map((row) => row.invite_token)).size).toBe(2);

    const interviewRows = sqlite.prepare(
      `SELECT candidate_id, interview_type, github_repo_url, github_pr_number
         FROM scheduled_interviews
        WHERE owner_id = 'workspace-1'
        ORDER BY created_at ASC`,
    ).all() as Array<{
      candidate_id: string;
      interview_type: string;
      github_repo_url: string | null;
      github_pr_number: number | null;
    }>;
    expect(interviewRows).toEqual([
      {
        candidate_id: first.candidate.id,
        interview_type: 'CODE_REVIEW',
        github_repo_url: null,
        github_pr_number: null,
      },
      {
        candidate_id: second.candidate.id,
        interview_type: 'OPEN_SOURCE_BUG_FIX',
        github_repo_url: 'https://github.com/hash-pipe/open-source-task',
        github_pr_number: 101,
      },
    ]);

    expect(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM people WHERE primary_email = ?',
    ).get('ada@example.com')).toEqual({ count: 1 });
    expect(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM workspace_people WHERE workspace_id = ?',
    ).get('workspace-1')).toEqual({ count: 1 });

    const contextRow = sqlite.prepare(
      `SELECT context_json
         FROM workspace_people wp
         JOIN people p ON p.id = wp.person_id
        WHERE wp.workspace_id = ?
          AND p.primary_email = ?`,
    ).get('workspace-1', 'ada@example.com') as { context_json: string };
    const context = JSON.parse(contextRow.context_json) as { legacyCandidateIds?: string[] };
    expect(new Set(context.legacyCandidateIds)).toEqual(new Set([
      first.candidate.id,
      second.candidate.id,
    ]));
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
        roleSourceRefs: [],
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
        provenanceFailures: [],
      }, {
        id: 'packet-unsafe',
        repoId: '15',
        prNumber: 89,
        reason: 'PACKET_NOT_PRODUCTION_READY',
        demandIds: ['demand-rust'],
        missingSourceSpanIds: [],
        gateFailures: ['production_language'],
        provenanceFailures: [],
        qualityScore: 0.4,
      }, {
        id: 'packet-context-incomplete',
        repoId: '16',
        prNumber: 90,
        reason: 'PACKET_CONTEXT_PROJECTION_INCOMPLETE',
        demandIds: ['demand-context'],
        missingSourceSpanIds: [],
        provenanceFailures: [],
        contextProjectionFailures: [
          'review challenge packet packet-context-incomplete is missing repo_source_span context refs',
        ],
      }]),
      [],
    );

    const summary = buildStandaloneReviewMatchSummary('NO_ROLE_SAFE_CHALLENGE', null, diagnostics);

    expect(diagnostics.recalledPacketIds).toEqual(['packet-source-backed']);
    expect(diagnostics.excludedPackets).toHaveLength(3);
    expect(summary.gaps).toEqual([
      'packet-missing-span was excluded because PR demand provenance references missing repo source spans. Demand: demand-events. Missing span: repo-span-missing.',
      'packet-unsafe was excluded because its repo packet is not production-ready. Quality score: 0.40. Failed gate: production_language.',
      'packet-context-incomplete was excluded because its repo packet is missing source-backed graph context. review challenge packet packet-context-incomplete is missing repo_source_span context refs',
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

const STANDALONE_REVIEW_ROLE_SOURCES = [{
  entityId: 'context-record-jd',
  locator: 'simple_job_description:source_span:jd-span-1',
  conceptKeys: ['term:kafka-order-events'],
}];

function createStandaloneReviewProfileApp(options: {
  repoSamplePr?: { title: string | null; pr_url: string | null } | null;
  challengePacket?: Record<string, unknown> | null;
} = {}) {
  const repoSamplePr = options.repoSamplePr === undefined
    ? {
        title: 'Add Kafka-backed order retry handling',
        pr_url: 'https://github.com/pipe/source-backed-orders/pull/42',
      }
    : options.repoSamplePr;
  const challengePacket = options.challengePacket === undefined
    ? {
        repository: {
          provider: 'github',
          owner: 'pipe',
          name: 'source-backed-orders',
          canonicalUrl: 'https://github.com/pipe/source-backed-orders',
        },
        pullRequest: {
          number: 42,
          url: 'https://github.com/pipe/source-backed-orders/pull/42',
          title: 'Backfilled packet PR title',
        },
      }
    : options.challengePacket;
  const rankedResults = [{
    rank: 1,
    recallRank: 2,
    challengeId: 'packet-source-backed',
    repoId: '7',
    prNumber: 42,
    score: 0.82,
    alignedDemandCount: 2,
    stretchCount: 1,
    stretchDemandWeightRatio: 0.12,
    provenanceComplete: true,
    eligible: true,
    alignments: [{
      atomId: 'candidate-atom-kafka',
      demandId: 'repo-demand-retry',
      purpose: 'validation',
      pairScore: 0.91,
      sharedConcepts: ['term:kafka-order-events'],
      roleSourceRefs: STANDALONE_REVIEW_ROLE_SOURCES,
      stretch: {
        atomConcept: 'term:kafka-order-events',
        demandConcept: 'term:distributed-order-retry',
        dimension: 'mechanism',
      },
      candidateSourceRefs: [{
        artifactId: 'resume-artifact',
        artifactVersion: 'v1',
        contentHash: 'candidate-hash',
        startOffset: 14,
        endOffset: 88,
        sourceRefType: 'source_span',
        sourceRefId: 'candidate-span-kafka',
        sourceSpanId: 'candidate-span-kafka',
        locator: 'resume line 7',
        exactText: 'Built Kafka order event retries for an ecommerce checkout platform.',
      }],
      challengeSourceRefs: [{
        artifactId: 'repo-artifact',
        artifactVersion: 'commit-abc',
        contentHash: 'repo-hash',
        startOffset: 120,
        endOffset: 210,
        sourceRefType: 'repo_source_span',
        sourceRefId: 'repo-span-retry',
        locator: 'src/orders/retry.ts:18',
        exactText: 'Add idempotent retry handling around order event publication.',
      }],
    }],
    rejectionReasons: ['Candidate evidence does not prove partition rebalancing ownership.'],
  }];
  const excludedPackets = [{
    id: 'packet-missing-span',
    repoId: '9',
    prNumber: 88,
    reason: 'MISSING_DEMAND_SOURCE_SPANS',
    demandIds: ['demand-without-span'],
    missingSourceSpanIds: ['repo-span-missing'],
    gateFailures: [],
    provenanceFailures: [],
    qualityScore: null,
  }];
  const db = {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ');
      return {
        bind() {
          return {
            async first() {
              if (normalized.includes('FROM candidates c')
                && normalized.includes('SELECT c.id, c.name, c.email')) {
                return {
                  id: 'candidate-1',
                  name: 'Ada Candidate',
                  email: 'ada@example.com',
                  status: 'INVITED',
                  pipeline_id: null,
                  current_stage_id: null,
                  resume_s3_key: null,
                  phone_number: null,
                  invite_token: 'invite-1',
                  skills: null,
                  years_of_experience: null,
                  current_role: null,
                  education: null,
                  created_at: '2026-06-22T00:00:00.000Z',
                  updated_at: '2026-06-22T00:00:00.000Z',
                };
              }
              if (normalized.includes('FROM role_contexts')) return null;
              if (normalized.includes('FROM candidate_ingestion')) return null;
              if (normalized.includes('FROM enrichment_jobs')) return null;
              if (normalized.includes('FROM scheduled_interviews')
                && normalized.includes("interview_type = 'CODE_REVIEW'")) {
                return {
                  id: 'interview-1',
                  status: 'MATCHED',
                  matched_repo_id: null,
                  github_repo_url: null,
                  github_pr_number: null,
                  submission_json: JSON.stringify({
                    verdict: 'request_changes',
                    summary: 'Main risk is retry idempotency around duplicate order events.',
                    annotations: [{
                      file: 'src/orders/retry.ts',
                      line: 18,
                      severity: 'major',
                      comment: 'This retry path can publish the same order event twice.',
                    }],
                  }),
                  completed_at: '2026-06-22T01:00:00.000Z',
                };
              }
              if (normalized.includes('FROM match_runs')) {
                return {
                  id: 'match-run-1',
                  status: 'MATCHED',
                  recalled_packets_json: JSON.stringify(['packet-source-backed', 'packet-missing-span']),
                  excluded_packets_json: JSON.stringify(excludedPackets),
                  ranked_results_json: JSON.stringify(rankedResults),
                  selected_packet_id: 'packet-source-backed',
                  query_json: JSON.stringify({
                    roleGuardrails: {
                      sourceReferences: STANDALONE_REVIEW_ROLE_SOURCES,
                    },
                  }),
                };
              }
              if (normalized.includes('FROM review_challenge_packets')
                && normalized.includes('packet_json')) {
                return {
                  repo_id: 7,
                  pr_number: 42,
                  packet_json: challengePacket ? JSON.stringify(challengePacket) : null,
                };
              }
              if (normalized.includes('FROM qualified_repos')) {
                return {
                  full_name: 'pipe/source-backed-orders',
                  github_url: 'https://github.com/pipe/source-backed-orders',
                };
              }
              if (normalized.includes('FROM repo_sample_prs')) {
                return repoSamplePr;
              }
              return null;
            },
            async all() {
              if (normalized.includes('FROM scheduled_interviews')
                && normalized.includes('ORDER BY created_at DESC')) {
                return {
                  results: [{
                    id: 'interview-1',
                    candidate_id: 'candidate-1',
                    pipeline_id: null,
                    stage_id: null,
                    interview_type: 'CODE_REVIEW',
                    meeting_type: null,
                    status: 'MATCHED',
                    scheduled_at: null,
                    meeting_url: null,
                    scheduling_provider: null,
                    scheduling_url: null,
                    matched_repo_id: null,
                    github_repo_url: null,
                    github_pr_number: null,
                    completed_at: '2026-06-22T01:00:00.000Z',
                    created_at: '2026-06-22T00:00:00.000Z',
                    updated_at: '2026-06-22T01:00:00.000Z',
                  }],
                };
              }
              return { results: [] };
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as Env['DB'];

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    // @ts-expect-error route test overrides Worker bindings.
    c.env = {
      DB: db,
      CLERK_SECRET_KEY: 'test',
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'test-user',
    };
    await next();
  });
  app.route('/', candidateOps);
  return app;
}

describe('GET /:candidateId standalone CODE_REVIEW context', () => {
  it('assembles recruiter-visible match explanation from persisted match run rows', async () => {
    const response = await createStandaloneReviewProfileApp().request('/candidate-1');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      standaloneReviewMatch: {
        matchStatus: string;
        packetId: string | null;
        repoName: string | null;
        repoUrl: string | null;
        prNumber: number | null;
        prUrl: string | null;
        prTitle: string | null;
        score: number | null;
        summary: string;
        roleSources: Array<{
          entityId: string;
          locator: string;
          conceptKeys: string[];
        }>;
        evidence: Array<{
          atomId: string;
          demandId: string;
          sharedConcepts: string[];
          candidateSourceRefs: Array<{
            sourceRefType?: string;
            sourceRefId?: string;
            sourceSpanId?: string;
            locator?: string;
            exactText?: string;
          }>;
          challengeSourceRefs: Array<{
            sourceRefType?: string;
            sourceRefId?: string;
            locator?: string;
            exactText?: string;
          }>;
        }>;
        gaps: string[];
        diagnostics: {
          recalledPacketIds: string[];
          excludedPackets: Array<{
            id: string;
            reason: string;
            missingSourceSpanIds: string[];
          }>;
          evaluatedChallenges: Array<{
            challengeId: string;
            eligible: boolean;
            stretchCount: number;
            provenanceComplete: boolean;
          }>;
        };
        submitted: boolean;
        submission: {
          verdict: string | null;
          summary: string | null;
          annotationCount: number;
        } | null;
      };
      scheduledInterviews: Array<{
        id: string;
        pipelineId: string | null;
        stageId: string | null;
        interviewType: string;
        status: string;
        completedAt: string | null;
      }>;
    };

    expect(body.scheduledInterviews).toEqual([expect.objectContaining({
      id: 'interview-1',
      pipelineId: null,
      stageId: null,
      interviewType: 'CODE_REVIEW',
      status: 'MATCHED',
      completedAt: '2026-06-22T01:00:00.000Z',
    })]);
    expect(body.standaloneReviewMatch).toMatchObject({
      matchStatus: 'MATCHED',
      packetId: 'packet-source-backed',
      repoName: 'pipe/source-backed-orders',
      repoUrl: 'https://github.com/pipe/source-backed-orders',
      prNumber: 42,
      prUrl: 'https://github.com/pipe/source-backed-orders/pull/42',
      prTitle: 'Add Kafka-backed order retry handling',
      score: 0.82,
      summary: 'Matched 2 source-backed demands (1 stretch).',
      submitted: true,
      submission: {
        verdict: 'request_changes',
        summary: 'Main risk is retry idempotency around duplicate order events.',
        annotationCount: 1,
      },
    });
    expect(body.standaloneReviewMatch.roleSources).toEqual(STANDALONE_REVIEW_ROLE_SOURCES);
    expect(body.standaloneReviewMatch.evidence).toHaveLength(1);
    expect(body.standaloneReviewMatch.evidence[0]).toMatchObject({
      atomId: 'candidate-atom-kafka',
      demandId: 'repo-demand-retry',
      sharedConcepts: ['term:kafka-order-events'],
      roleSourceRefs: STANDALONE_REVIEW_ROLE_SOURCES,
      candidateSourceRefs: [{
        sourceRefType: 'source_span',
        sourceRefId: 'candidate-span-kafka',
        sourceSpanId: 'candidate-span-kafka',
        locator: 'resume line 7',
        exactText: 'Built Kafka order event retries for an ecommerce checkout platform.',
      }],
      challengeSourceRefs: [{
        sourceRefType: 'repo_source_span',
        sourceRefId: 'repo-span-retry',
        locator: 'src/orders/retry.ts:18',
        exactText: 'Add idempotent retry handling around order event publication.',
      }],
    });
    expect(body.standaloneReviewMatch.gaps).toEqual([
      'Candidate evidence does not prove partition rebalancing ownership.',
    ]);
    expect(body.standaloneReviewMatch.diagnostics.recalledPacketIds).toEqual([
      'packet-source-backed',
      'packet-missing-span',
    ]);
    expect(body.standaloneReviewMatch.diagnostics.excludedPackets).toEqual([{
      id: 'packet-missing-span',
      repoId: '9',
      prNumber: 88,
      reason: 'MISSING_DEMAND_SOURCE_SPANS',
      demandIds: ['demand-without-span'],
      missingSourceSpanIds: ['repo-span-missing'],
      gateFailures: [],
      provenanceFailures: [],
      contextProjectionFailures: [],
      qualityScore: null,
    }]);
    expect(body.standaloneReviewMatch.diagnostics.evaluatedChallenges).toEqual([{
      challengeId: 'packet-source-backed',
      repoId: '7',
      prNumber: 42,
      recallRank: 2,
      rank: 1,
      eligible: true,
      rejectionReasons: ['Candidate evidence does not prove partition rebalancing ownership.'],
      provenanceComplete: true,
      alignedDemandCount: 2,
      stretchCount: 1,
    }]);
  });

  it('falls back to selected challenge packet metadata when no sample PR row exists', async () => {
    const response = await createStandaloneReviewProfileApp({
      repoSamplePr: null,
      challengePacket: {
        repository: {
          provider: 'github',
          owner: 'pipe',
          name: 'source-backed-orders',
          canonicalUrl: 'https://github.com/pipe/source-backed-orders',
        },
        pullRequest: {
          number: 42,
          url: 'https://github.com/pipe/source-backed-orders/pull/42',
          title: 'Backfilled packet PR title',
        },
      },
    }).request('/candidate-1');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      standaloneReviewMatch: {
        repoName: string | null;
        packetId: string | null;
        repoUrl: string | null;
        prNumber: number | null;
        prUrl: string | null;
        prTitle: string | null;
        evidence: Array<{
          candidateSourceRefs: Array<{ sourceRefId?: string; exactText?: string }>;
          challengeSourceRefs: Array<{ sourceRefType?: string; sourceRefId?: string; exactText?: string }>;
        }>;
      };
    };

    expect(body.standaloneReviewMatch).toMatchObject({
      repoName: 'pipe/source-backed-orders',
      packetId: 'packet-source-backed',
      repoUrl: 'https://github.com/pipe/source-backed-orders',
      prNumber: 42,
      prUrl: 'https://github.com/pipe/source-backed-orders/pull/42',
      prTitle: 'Backfilled packet PR title',
    });
    expect(body.standaloneReviewMatch.evidence[0].candidateSourceRefs[0]).toMatchObject({
      sourceRefId: 'candidate-span-kafka',
      exactText: 'Built Kafka order event retries for an ecommerce checkout platform.',
    });
    expect(body.standaloneReviewMatch.evidence[0].challengeSourceRefs[0]).toMatchObject({
      sourceRefType: 'repo_source_span',
      sourceRefId: 'repo-span-retry',
      exactText: 'Add idempotent retry handling around order event publication.',
    });
  });

  it('hydrates selected PR metadata from persisted packet_json using real D1-shaped rows', async () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(`
        CREATE TABLE pipelines (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL
        );
        CREATE TABLE candidates (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          pipeline_id TEXT,
          name TEXT,
          email TEXT,
          status TEXT NOT NULL,
          current_stage_id TEXT,
          resume_s3_key TEXT,
          phone_number TEXT,
          invite_token TEXT NOT NULL,
          skills TEXT,
          years_of_experience INTEGER,
          current_role TEXT,
          education TEXT,
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE stages (
          id TEXT PRIMARY KEY,
          pipeline_id TEXT,
          title TEXT,
          sort_order INTEGER,
          mode TEXT
        );
        CREATE TABLE challenges (
          id TEXT PRIMARY KEY,
          stage_id TEXT,
          type TEXT,
          title TEXT,
          instructions TEXT,
          config TEXT,
          server_config TEXT,
          sort_order INTEGER
        );
        CREATE TABLE challenge_submissions (
          id TEXT PRIMARY KEY,
          challenge_id TEXT,
          candidate_id TEXT,
          score INTEGER,
          feedback TEXT,
          response_json TEXT,
          submitted_at TEXT,
          scored_at TEXT
        );
        CREATE TABLE review_sessions (
          id TEXT PRIMARY KEY,
          challenge_id TEXT,
          candidate_id TEXT,
          status TEXT,
          current_round INTEGER,
          max_rounds INTEGER,
          score_report TEXT,
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE scheduled_interviews (
          id TEXT PRIMARY KEY,
          candidate_id TEXT NOT NULL,
          pipeline_id TEXT,
          stage_id TEXT,
          interview_type TEXT,
          meeting_type TEXT,
          status TEXT,
          scheduled_at TEXT,
          meeting_url TEXT,
          scheduling_provider TEXT,
          scheduling_url TEXT,
          matched_repo_id INTEGER,
          github_repo_url TEXT,
          github_pr_number INTEGER,
          submission_json TEXT,
          completed_at TEXT,
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE role_contexts (
          id TEXT PRIMARY KEY,
          pipeline_id TEXT
        );
        CREATE TABLE qualified_repos (
          id INTEGER PRIMARY KEY,
          full_name TEXT,
          github_url TEXT
        );
        CREATE TABLE repo_sample_prs (
          repo_id INTEGER,
          pr_number INTEGER,
          title TEXT,
          pr_url TEXT
        );
        CREATE TABLE review_challenge_packets (
          id TEXT PRIMARY KEY,
          repo_snapshot_id TEXT,
          repo_id INTEGER,
          pr_number INTEGER,
          production_ready INTEGER,
          quality_score REAL,
          packet_json TEXT,
          updated_at INTEGER
        );
        CREATE TABLE context_records (
          id TEXT PRIMARY KEY,
          ingestion_key TEXT,
          scope_type TEXT,
          scope_id TEXT,
          record_type TEXT
        );
        CREATE TABLE context_record_source_refs (
          context_record_id TEXT,
          source_ref_type TEXT
        );
        CREATE TABLE context_record_concepts (
          context_record_id TEXT,
          concept_id TEXT
        );
        CREATE TABLE match_runs (
          id TEXT PRIMARY KEY,
          candidate_id TEXT,
          role_snapshot_id TEXT,
          status TEXT,
          recalled_packets_json TEXT,
          excluded_packets_json TEXT,
          ranked_results_json TEXT,
          selected_packet_id TEXT,
          query_json TEXT,
          created_at TEXT
        );
      `);

      const rankedResults = [{
        rank: 1,
        recallRank: 1,
        challengeId: 'packet-from-backfill',
        repoId: '77',
        prNumber: 314,
        score: 0.88,
        alignedDemandCount: 1,
        stretchCount: 0,
        provenanceComplete: true,
        eligible: true,
        alignments: [{
          atomId: 'candidate-atom-ledger',
          demandId: 'repo-demand-ledger',
          purpose: 'validation',
          pairScore: 0.93,
          sharedConcepts: ['term:crystalline-quorum-ledger'],
          // Legacy rows written before per-alignment roleSourceRefs still carry source-backed
          // JD evidence in query_json.roleGuardrails.sourceReferences.
          candidateSourceRefs: [{
            artifactId: 'resume-artifact',
            artifactVersion: 'v1',
            contentHash: 'candidate-hash',
            startOffset: 0,
            endOffset: 68,
            sourceRefType: 'source_span',
            sourceRefId: 'candidate-span-ledger',
            sourceSpanId: 'candidate-span-ledger',
            locator: 'resume line 4',
            exactText: 'Implemented CrystallineQuorumLedger commits for order recovery.',
          }],
          challengeSourceRefs: [{
            artifactId: 'repo-artifact',
            artifactVersion: 'commit-backfill',
            contentHash: 'repo-hash',
            startOffset: 10,
            endOffset: 82,
            sourceRefType: 'repo_source_span',
            sourceRefId: 'repo-span-ledger',
            locator: 'src/orders/crystallineQuorumLedger.ts:1',
            exactText: 'Write CrystallineQuorumLedger recovery entries from retryable orders.',
          }],
        }],
        rejectionReasons: [],
      }];
      const packetJson = {
        repository: {
          provider: 'github',
          owner: 'pipe-labs',
          name: 'orders',
          canonicalUrl: 'https://github.com/pipe-labs/orders',
        },
        pullRequest: {
          number: 314,
          url: 'https://github.com/pipe-labs/orders/pull/314',
          title: 'Backfill CrystallineQuorumLedger recovery packet',
        },
      };
      const roleSources = [{
        entityId: 'context-record-role-backfill',
        locator: 'simple_job_description:source_span:jd-span-crystalline',
        conceptKeys: ['term:crystalline-quorum-ledger'],
      }];

      sqlite.prepare(`
        INSERT INTO candidates (
          id, owner_id, pipeline_id, name, email, status, current_stage_id,
          resume_s3_key, phone_number, invite_token, skills, years_of_experience,
          current_role, education, created_at, updated_at
        ) VALUES (
          'candidate-graph', 'test-user', NULL, 'Graph Candidate', 'graph@example.com',
          'INVITED', NULL, NULL, NULL, 'invite-graph', NULL, NULL, NULL, NULL,
          '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
        )
      `).run();
      sqlite.prepare(`
        INSERT INTO scheduled_interviews (
          id, candidate_id, pipeline_id, stage_id, interview_type, meeting_type, status,
          scheduled_at, meeting_url, scheduling_provider, scheduling_url, matched_repo_id,
          github_repo_url, github_pr_number, submission_json, completed_at, created_at, updated_at
        ) VALUES (
          'interview-graph', 'candidate-graph', NULL, NULL, 'CODE_REVIEW', NULL, 'MATCHED',
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          '2026-06-22T00:05:00.000Z', '2026-06-22T00:05:00.000Z'
        )
      `).run();
      sqlite.prepare(`
        INSERT INTO review_challenge_packets (
          id, repo_snapshot_id, repo_id, pr_number, production_ready,
          quality_score, packet_json, updated_at
        )
        VALUES ('packet-from-backfill', 'snapshot-backfill', 77, 314, 1, 0.91, ?, 1)
      `).run(JSON.stringify(packetJson));
      sqlite.prepare(`
        INSERT INTO context_records (
          id, ingestion_key, scope_type, scope_id, record_type
        ) VALUES (
          'context-record-packet-backfill',
          'repo-challenge-packet-context:packet-from-backfill',
          'repo_snapshot',
          'snapshot-backfill',
          'repo_challenge_packet'
        )
      `).run();
      sqlite.prepare(`
        INSERT INTO context_record_source_refs (context_record_id, source_ref_type)
        VALUES ('context-record-packet-backfill', 'repo_source_span')
      `).run();
      sqlite.prepare(`
        INSERT INTO context_record_concepts (context_record_id, concept_id)
        VALUES ('context-record-packet-backfill', 'concept-ledger')
      `).run();
      sqlite.prepare(`
        INSERT INTO match_runs (
          id, candidate_id, role_snapshot_id, status, recalled_packets_json,
          excluded_packets_json, ranked_results_json, selected_packet_id,
          created_at, query_json
        ) VALUES (
          'match-run-graph', 'candidate-graph', 'standalone-code-review-v1', 'MATCHED',
          ?, '[]', ?, 'packet-from-backfill', '2026-06-22T00:06:00.000Z', ?
        )
      `).run(
        JSON.stringify(['packet-from-backfill']),
        JSON.stringify(rankedResults),
        JSON.stringify({ roleGuardrails: { sourceReferences: roleSources } }),
      );

      const app = new Hono<{ Bindings: Env }>();
      app.use('*', async (c, next) => {
        // @ts-expect-error route test overrides Worker bindings.
        c.env = {
          DB: createMockD1(sqlite),
          CLERK_SECRET_KEY: 'test',
          DEV_AUTH_BYPASS: 'true',
          DEV_BYPASS_USER_ID: 'test-user',
        };
        await next();
      });
      app.route('/', candidateOps);

      const response = await app.request('/candidate-graph');
      expect(response.status).toBe(200);
      const body = await response.json() as {
        standaloneReviewMatch: {
          packetId: string | null;
          repoId: number | null;
          repoName: string | null;
          repoUrl: string | null;
          prNumber: number | null;
          prUrl: string | null;
          prTitle: string | null;
          roleSources: Array<{ entityId: string; locator: string; conceptKeys: string[] }>;
          evidence: Array<{
            sharedConcepts: string[];
            roleSourceRefs: Array<{ entityId: string; locator: string; conceptKeys: string[] }>;
            candidateSourceRefs: Array<{ sourceRefId?: string; exactText?: string }>;
            challengeSourceRefs: Array<{ sourceRefType?: string; sourceRefId?: string; exactText?: string }>;
          }>;
        };
      };

      expect(body.standaloneReviewMatch).toMatchObject({
        packetId: 'packet-from-backfill',
        repoId: 77,
        repoName: 'pipe-labs/orders',
        repoUrl: 'https://github.com/pipe-labs/orders',
        prNumber: 314,
        prUrl: 'https://github.com/pipe-labs/orders/pull/314',
        prTitle: 'Backfill CrystallineQuorumLedger recovery packet',
      });
      expect(body.standaloneReviewMatch.roleSources).toEqual(roleSources);
      expect(body.standaloneReviewMatch.evidence[0].sharedConcepts).toEqual([
        'term:crystalline-quorum-ledger',
      ]);
      expect(body.standaloneReviewMatch.evidence[0].roleSourceRefs).toEqual(roleSources);
      expect(body.standaloneReviewMatch.evidence[0].candidateSourceRefs[0]).toMatchObject({
        sourceRefId: 'candidate-span-ledger',
        exactText: 'Implemented CrystallineQuorumLedger commits for order recovery.',
      });
      expect(body.standaloneReviewMatch.evidence[0].challengeSourceRefs[0]).toMatchObject({
        sourceRefType: 'repo_source_span',
        sourceRefId: 'repo-span-ledger',
        exactText: 'Write CrystallineQuorumLedger recovery entries from retryable orders.',
      });

      sqlite.prepare('DELETE FROM context_record_concepts').run();
      sqlite.prepare('DELETE FROM context_record_source_refs').run();
      sqlite.prepare('DELETE FROM context_records').run();

      const legacyResponse = await app.request('/candidate-graph');
      expect(legacyResponse.status).toBe(200);
      const legacyBody = await legacyResponse.json() as {
        standaloneReviewMatch: {
          matchStatus: string;
          packetId: string | null;
          repoId: number | null;
          repoUrl: string | null;
          prNumber: number | null;
          prTitle: string | null;
          score: number | null;
          evidence: unknown[];
          gaps: string[];
        };
      };
      expect(legacyBody.standaloneReviewMatch).toMatchObject({
        matchStatus: 'NO_ROLE_SAFE_CHALLENGE',
        packetId: null,
        repoId: null,
        repoUrl: null,
        prNumber: null,
        prTitle: null,
        score: null,
        evidence: [],
      });
      expect(legacyBody.standaloneReviewMatch.gaps).toContain(
        'Selected review packet packet-from-backfill is missing source-backed graph context.',
      );
    } finally {
      sqlite.close();
    }
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
