import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import { runCandidateIngestion } from '../../lib/candidateDiscovery/orchestrate';
import { processResumeFromR2 } from '../../lib/enrichment/resumeIngestion';
import { talentPoolPublic } from '../talentPool';
import type { Env, Variables } from '../../types';

vi.mock('../../lib/candidateDiscovery/orchestrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/candidateDiscovery/orchestrate')>();
  return {
    ...actual,
    runCandidateIngestion: vi.fn(async () => undefined),
  };
});

vi.mock('../../lib/enrichment/resumeIngestion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/enrichment/resumeIngestion')>();
  return {
    ...actual,
    processResumeFromR2: vi.fn(async () => ({ success: true, parsed: null })),
  };
});

const talentPoolMigration = readFileSync(
  new URL('../../../migrations/0109_talent_pool_intake.sql', import.meta.url),
  'utf8',
);
const livingContextMigration = readFileSync(
  new URL('../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const candidateNodesMigration = readFileSync(
  new URL('../../../migrations/0052_candidate_nodes.sql', import.meta.url),
  'utf8',
);
const candidateNodeIdempotencyMigration = readFileSync(
  new URL('../../../migrations/0085_candidate_node_idempotency.sql', import.meta.url),
  'utf8',
);

interface MemoryR2PutRecord {
  text: string | null;
  byteLength: number;
  contentType: string | undefined;
  customMetadata: Record<string, string> | undefined;
}

interface MemoryR2 extends R2Bucket {
  puts: Map<string, MemoryR2PutRecord>;
}

interface TalentDashboardBody {
  status: string;
  candidateName: string | null;
  profileReceivedAt: string | null;
  phoneScreener: {
    consent: boolean;
    status: string;
    phoneNumber: string | null;
    timezone: string | null;
    availability: string | null;
  };
  readyChallenges: Array<{ title: string; type: string; entryUrl: string; summary: string }>;
  completedChallenges: Array<{ title: string; completedAt: string | null; summary: string }>;
}

const FORBIDDEN_CANDIDATE_RESPONSE_KEYS = new Set([
  'id',
  'candidateId',
  'candidate_id',
  'applicationId',
  'application_id',
  'workspacePersonId',
  'workspace_person_id',
  'personId',
  'person_id',
  'sourceSpanId',
  'source_span_id',
  'artifactId',
  'artifact_id',
  'artifactVersionId',
  'artifact_version_id',
  'assignmentId',
  'assignment_id',
  'challengeId',
  'challenge_id',
  'stageId',
  'stage_id',
  'pipelineId',
  'pipeline_id',
  'resumeS3Key',
  'resume_s3_key',
  'profileR2Key',
  'profile_r2_key',
]);

function collectObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => collectObjectKeys(entry));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...collectObjectKeys(child),
  ]);
}

function expectNoInternalCandidatePayload(value: unknown, forbiddenValues: string[] = []): void {
  for (const key of collectObjectKeys(value)) {
    expect(FORBIDDEN_CANDIDATE_RESPONSE_KEYS.has(key)).toBe(false);
  }

  const serialized = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    expect(serialized).not.toContain(forbiddenValue);
  }
  expect(serialized).not.toContain('WAITING_FOR_MATCH');
  expect(serialized).not.toContain('Repo matching');
  expect(serialized).not.toContain('workspace-person');
  expect(serialized).not.toContain('source_span');
  expect(serialized).not.toContain('artifact_version');
}

function expectCandidateSafeDashboard(body: TalentDashboardBody, forbiddenValues: string[] = []): void {
  expect(Object.keys(body).sort()).toEqual([
    'candidateName',
    'completedChallenges',
    'phoneScreener',
    'profileReceivedAt',
    'readyChallenges',
    'status',
  ]);
  expect(Object.keys(body.phoneScreener).sort()).toEqual([
    'availability',
    'consent',
    'phoneNumber',
    'status',
    'timezone',
  ]);
  for (const challenge of body.readyChallenges) {
    expect(Object.keys(challenge).sort()).toEqual(['entryUrl', 'summary', 'title', 'type']);
  }
  for (const challenge of body.completedChallenges) {
    expect(Object.keys(challenge).sort()).toEqual(['completedAt', 'summary', 'title']);
  }
  expectNoInternalCandidatePayload(body, forbiddenValues);
}

function createMemoryR2(): MemoryR2 {
  const puts = new Map<string, MemoryR2PutRecord>();
  return {
    puts,
    put: async (
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null,
      options?: R2PutOptions,
    ) => {
      let text: string | null = null;
      let byteLength = 0;
      if (typeof value === 'string') {
        text = value;
        byteLength = new TextEncoder().encode(value).byteLength;
      } else if (value instanceof ArrayBuffer) {
        byteLength = value.byteLength;
      } else if (ArrayBuffer.isView(value)) {
        byteLength = value.byteLength;
      } else if (value instanceof Blob) {
        byteLength = value.size;
      } else if (value) {
        byteLength = -1;
      }
      puts.set(key, {
        text,
        byteLength,
        contentType: options?.httpMetadata?.contentType,
        customMetadata: options?.customMetadata,
      });
      return null;
    },
  } as MemoryR2;
}

function buildStoredDocx(documentXml: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const fileName = encoder.encode('word/document.xml');
  const content = encoder.encode(documentXml);
  const localHeaderLength = 30 + fileName.length + content.length;
  const centralHeaderLength = 46 + fileName.length;
  const eocdLength = 22;
  const bytes = new Uint8Array(localHeaderLength + centralHeaderLength + eocdLength);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  view.setUint32(offset, 0x04034b50, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 8, 0, true);
  view.setUint32(offset + 14, 0, true);
  view.setUint32(offset + 18, content.length, true);
  view.setUint32(offset + 22, content.length, true);
  view.setUint16(offset + 26, fileName.length, true);
  bytes.set(fileName, offset + 30);
  bytes.set(content, offset + 30 + fileName.length);

  const centralOffset = localHeaderLength;
  offset = centralOffset;
  view.setUint32(offset, 0x02014b50, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 6, 20, true);
  view.setUint16(offset + 10, 0, true);
  view.setUint32(offset + 16, 0, true);
  view.setUint32(offset + 20, content.length, true);
  view.setUint32(offset + 24, content.length, true);
  view.setUint16(offset + 28, fileName.length, true);
  view.setUint32(offset + 42, 0, true);
  bytes.set(fileName, offset + 46);

  offset = centralOffset + centralHeaderLength;
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, 1, true);
  view.setUint16(offset + 10, 1, true);
  view.setUint32(offset + 12, centralHeaderLength, true);
  view.setUint32(offset + 16, centralOffset, true);

  return bytes.buffer;
}

function createSqlite(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(`
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      invite_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('INVITED', 'IN_PROGRESS', 'COMPLETED')),
      pipeline_id TEXT,
      current_stage_id TEXT,
      resume_s3_key TEXT,
      phone_number TEXT,
      skills TEXT,
      years_of_experience INTEGER,
      current_role TEXT,
      education TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE candidate_ingestion (
      candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending','profile_generated','embedded','enriching','enriched','matched','failed')) DEFAULT 'pending',
      github_url TEXT,
      linkedin_url TEXT,
      current_step TEXT,
      error_text TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE challenges (
      id TEXT PRIMARY KEY,
      title TEXT,
      type TEXT
    );

    CREATE TABLE candidate_challenge_assignment (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      stage_id TEXT,
      challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      github_repo_url TEXT,
      github_pr_number INTEGER,
      assigned_at TEXT
    );

    CREATE TABLE scheduled_interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      interview_type TEXT,
      status TEXT NOT NULL,
      updated_at TEXT
    );
  `);
  sqlite.exec(talentPoolMigration);
  sqlite.exec(livingContextMigration);
  sqlite.exec(contextRecordsMigration);
  sqlite.exec(candidateNodesMigration);
  sqlite.exec(candidateNodeIdempotencyMigration);
  return sqlite;
}

function createEnv(sqlite: BetterSqliteDb, storage = createMemoryR2()): Env & { STORAGE: MemoryR2 } {
  return {
    DB: createMockD1(sqlite),
    STORAGE: storage,
  } as Env & { STORAGE: MemoryR2 };
}

function createApp(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/rpc/talent', talentPoolPublic);
  return app;
}

function buildCtx(): { ctx: ExecutionContext; waitUntilAll: () => Promise<void> } {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      promises.push(promise);
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return {
    ctx,
    waitUntilAll: async () => {
      await Promise.all(promises);
    },
  };
}

interface SeedCandidateOptions {
  id?: string;
  ownerId?: string;
  name?: string | null;
  email?: string | null;
  inviteToken?: string;
}

function seedCandidate(sqlite: BetterSqliteDb, options: SeedCandidateOptions = {}): void {
  const candidateId = options.id ?? 'candidate-1';
  const ownerId = options.ownerId ?? 'owner-1';
  const name = options.name === undefined ? 'Jordan Talent' : options.name;
  const email = options.email === undefined ? 'jordan@example.com' : options.email;
  const inviteToken = options.inviteToken ?? 'invite-token';
  sqlite.prepare(
    `INSERT INTO candidates (
       id, owner_id, name, email, invite_token, status, pipeline_id,
       current_stage_id, resume_s3_key, phone_number, created_at, updated_at
     )
     VALUES (
       ?, ?, ?, ?, ?, 'INVITED', NULL, NULL, NULL, NULL,
      '2026-06-30T00:00:00.000Z', '2026-06-30T00:00:00.000Z'
     )`,
  ).bind(candidateId, ownerId, name, email, inviteToken).run();
}

function seedSubmittedTalentPoolIntake(sqlite: BetterSqliteDb, candidateId = 'candidate-1'): void {
  sqlite.prepare(
    `INSERT INTO talent_pool_intakes (
       candidate_id, status, profile_r2_key, profile_text_excerpt, submitted_at
     )
     VALUES (
       ?, 'CHALLENGE_PREPARING', 'talent-intake/candidate-1/profile.txt',
       'Jordan shipped TypeScript Workers APIs.',
       '2026-06-30T02:00:00.000Z'
     )`,
  ).bind(candidateId).run();
  sqlite.prepare(
    `UPDATE candidates
        SET resume_s3_key = 'talent-intake/candidate-1/profile.txt'
      WHERE id = ?`,
  ).bind(candidateId).run();
}

function challengePacketJson(): string {
  return JSON.stringify({
    id: 'challenge-packet-973',
    repoSnapshotId: 'repo-snapshot-1',
    pullRequest: {
      number: 973,
      url: 'https://github.com/mui/base-ui/pull/973',
      title: 'Fix popover retry scheduling',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    demands: [{
      narrative: 'Repair retry scheduling so terminal events are emitted exactly once.',
    }],
    demandFamilies: ['runtime_reliability'],
    contentHash: 'sha256:challenge-packet-973',
  });
}

function seedOpenSourceChallengePacketTables(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS qualified_repos (
      id INTEGER PRIMARY KEY,
      github_url TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_challenge_packets (
      id TEXT PRIMARY KEY,
      repo_snapshot_id TEXT NOT NULL,
      repo_id INTEGER NOT NULL,
      pr_number INTEGER NOT NULL,
      packet_version TEXT NOT NULL DEFAULT 'test',
      source_hash TEXT NOT NULL,
      production_ready INTEGER NOT NULL,
      quality_score REAL NOT NULL,
      packet_json TEXT NOT NULL
    );
  `);
}

function seedSourceBackedChallengePacket(sqlite: BetterSqliteDb): void {
  seedOpenSourceChallengePacketTables(sqlite);
  sqlite.prepare(
    `INSERT INTO qualified_repos (id, github_url, full_name)
     VALUES (41, 'https://github.com/mui/base-ui', 'mui/base-ui')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO review_challenge_packets (
       id, repo_snapshot_id, repo_id, pr_number, source_hash,
       production_ready, quality_score, packet_json
     )
     VALUES (
       'challenge-packet-973', 'repo-snapshot-1', 41, 973,
       'sha256:challenge-packet-973', 1, 0.91, ?
     )`,
  ).bind(challengePacketJson()).run();
  sqlite.prepare(
    `INSERT INTO context_records (
       id, ingestion_key, scope_type, scope_id, record_type, narrative,
       qualifiers_json, polarity, created_at, updated_at
     )
     VALUES (
       'challenge-packet-context-973',
       'repo-challenge-packet-context:challenge-packet-973',
       'repo_snapshot',
       'repo-snapshot-1',
       'repo_challenge_packet',
       'Source-backed review challenge packet.',
       '{}',
       1,
       '2026-06-30T02:00:00.000Z',
       '2026-06-30T02:00:00.000Z'
     )`,
  ).run();
  sqlite.prepare(
    `INSERT INTO context_record_source_refs (
       context_record_id, source_ref_type, source_ref_id, evidence_role,
       locator_json, metadata_json, created_at
     )
     VALUES (
       'challenge-packet-context-973',
       'repo_source_span',
       'repo-source-span-1',
       'source',
       '{}',
       '{}',
       '2026-06-30T02:00:00.000Z'
     )`,
  ).run();
  sqlite.prepare(
    `INSERT INTO concepts (
       id, ingestion_key, canonical_key, namespace, label,
       aliases_json, metadata_json, created_at, updated_at
     )
     VALUES (
       'concept-runtime-reliability',
       'test:runtime-reliability',
       'runtime_reliability',
       'repo_demand_family',
       'Runtime reliability',
       '[]',
       '{}',
       '2026-06-30T02:00:00.000Z',
       '2026-06-30T02:00:00.000Z'
     )`,
  ).run();
  sqlite.prepare(
    `INSERT INTO context_record_concepts (
       context_record_id, concept_id, relationship, weight, created_at
     )
     VALUES (
       'challenge-packet-context-973',
       'concept-runtime-reliability',
       'about',
       1,
       '2026-06-30T02:00:00.000Z'
     )`,
  ).run();
}

describe('talent pool candidate RPC', () => {
  let sqlite: BetterSqliteDb | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('resolves an intake token without exposing internal candidate ids or match states', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);

    const app = createApp();
    const res = await app.request('/rpc/talent/resolve-token', {
      method: 'POST',
      body: JSON.stringify({ inviteToken: 'invite-token' }),
      headers: { 'Content-Type': 'application/json' },
    }, createEnv(sqlite));

    expect(res.status).toBe(200);
    const body = await res.json() as TalentDashboardBody;
    expect(body.status).toBe('PROFILE_NEEDED');
    expect(body.candidateName).toBe('Jordan Talent');
    expect(body.readyChallenges).toEqual([]);
    expect(body.completedChallenges).toEqual([]);
    expectCandidateSafeDashboard(body, ['candidate-1']);
  });

  it('returns candidate-safe errors without exposing internal ids', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);

    const app = createApp();
    const res = await app.request('/rpc/talent/resolve-token', {
      method: 'POST',
      body: JSON.stringify({ inviteToken: 'missing-token' }),
      headers: { 'Content-Type': 'application/json' },
    }, createEnv(sqlite));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Invite not found.',
      },
    });
    expectNoInternalCandidatePayload(body, ['candidate-1', 'owner-1']);
  });

  it('persists profile intake, phone screener consent, and a private design queue item', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
    const storage = createMemoryR2();
    const app = createApp();
    const payload = {
      inviteToken: 'invite-token',
      resumeText: 'Senior frontend engineer with React, Cloudflare Workers, accessibility, and open-source review experience.',
      githubUrl: 'https://github.com/jordan-talent',
      linkedinUrl: 'https://linkedin.com/in/jordan-talent',
      portfolioUrl: 'https://jordan.example.dev',
      phoneScreenerConsent: true,
      phoneNumber: '+15551234567',
      timezone: 'America/Vancouver',
      availability: 'Weekday afternoons after 2 PM.',
    };

    const res = await app.request('/rpc/talent/submit-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }, createEnv(sqlite, storage));

    expect(res.status).toBe(200);
    const body = await res.json() as TalentDashboardBody;
    expect(body.status).toBe('CHALLENGE_PREPARING');
    expect(body.profileReceivedAt).not.toBeNull();
    expect(body.phoneScreener).toMatchObject({
      consent: true,
      status: 'PHONE_SCREENER_OFFERED',
      phoneNumber: '+15551234567',
      timezone: 'America/Vancouver',
      availability: 'Weekday afternoons after 2 PM.',
    });
    expect(body.readyChallenges).toEqual([]);
    expectCandidateSafeDashboard(body, ['candidate-1', 'owner-1']);

    expect(storage.puts.size).toBe(1);
    const intake = sqlite.prepare(
      `SELECT status, profile_r2_key, github_url, linkedin_url, portfolio_url,
              phone_screener_consent, phone_number, timezone, availability
         FROM talent_pool_intakes
        WHERE candidate_id = 'candidate-1'`,
    ).get();
    expect(intake).toMatchObject({
      status: 'CHALLENGE_PREPARING',
      github_url: 'https://github.com/jordan-talent',
      linkedin_url: 'https://linkedin.com/in/jordan-talent',
      portfolio_url: 'https://jordan.example.dev',
      phone_screener_consent: 1,
      phone_number: '+15551234567',
      timezone: 'America/Vancouver',
      availability: 'Weekday afternoons after 2 PM.',
    });
    expect((intake as { profile_r2_key: string }).profile_r2_key).toMatch(/^talent-intake\/candidate-1\//);
    expect(storage.puts.get((intake as { profile_r2_key: string }).profile_r2_key)).toMatchObject({
      text: payload.resumeText,
      contentType: 'text/plain; charset=utf-8',
      customMetadata: {
        source: 'talent_pool_intake',
        candidateId: 'candidate-1',
      },
    });

    expect(sqlite.prepare(
      `SELECT status, github_url, linkedin_url, current_step, error_text
         FROM candidate_ingestion
        WHERE candidate_id = 'candidate-1'`,
    ).get()).toEqual({
      status: 'pending',
      github_url: 'https://github.com/jordan-talent',
      linkedin_url: 'https://linkedin.com/in/jordan-talent',
      current_step: 'talent_pool_profile_received',
      error_text: null,
    });

    const queue = sqlite.prepare(
      `SELECT owner_id, status, missing_signal, inventory_failure_reason,
              suggested_repo_families, proposed_challenge_type, validation_status
         FROM challenge_design_queue
        WHERE candidate_id = 'candidate-1'`,
    ).get() as {
      owner_id: string;
      status: string;
      missing_signal: string;
      inventory_failure_reason: string;
      suggested_repo_families: string;
      proposed_challenge_type: string;
      validation_status: string;
    };
    expect(queue.owner_id).toBe('owner-1');
    expect(queue.status).toBe('queued');
    expect(queue.missing_signal).toContain('source-backed challenge assignment');
    expect(queue.inventory_failure_reason).toContain('No ready challenge assignment');
    expect(JSON.parse(queue.suggested_repo_families)).toContain('frontend application code');
    expect(queue.proposed_challenge_type).toBe('CODE_REVIEW');
    expect(queue.validation_status).toBe('needs_design');

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM applications').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM person_roles').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM interactions').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifacts').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifact_versions').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM source_spans').get()).toEqual({ count: 8 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({ count: 5 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_source_refs').get()).toEqual({ count: 8 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM candidate_nodes').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      `SELECT exact_text FROM source_spans WHERE exact_text = ? LIMIT 1`,
    ).get(payload.resumeText)).toEqual({ exact_text: payload.resumeText });
    expect(sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, source_reference,
              json_extract(extracted_properties_json, '$.source_quote_validated') AS source_quote_validated,
              json_extract(extracted_properties_json, '$.source_quote') AS source_quote,
              json_extract(extracted_properties_json, '$.source_span_id') AS source_span_id
         FROM candidate_nodes
        WHERE candidate_id = 'candidate-1'
        LIMIT 1`,
    ).get()).toMatchObject({
      node_type: 'TalentPoolProfileIntake',
      narrative_text: 'Candidate submitted Talent Pool profile evidence.',
      source_type: 'talent_pool_profile_intake',
      source_quote_validated: 1,
      source_quote: payload.resumeText,
    });
    const profileNodeRef = sqlite.prepare(
      `SELECT source_reference,
              json_extract(extracted_properties_json, '$.source_span_id') AS source_span_id
         FROM candidate_nodes
        WHERE candidate_id = 'candidate-1'
        LIMIT 1`,
    ).get() as { source_reference: string; source_span_id: string };
    expect(profileNodeRef.source_reference).toBe(`source_span:${profileNodeRef.source_span_id}`);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_records
        WHERE record_type = 'talent_pool_external_profile_ref'`,
    ).get()).toEqual({ count: 3 });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_records
        WHERE record_type = 'talent_pool_phone_screener_intent'`,
    ).get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      `SELECT ss.exact_text
         FROM context_records cr
         JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crsr.source_span_id
        WHERE cr.predicate = 'submitted_github_profile_url'
        LIMIT 1`,
    ).get()).toEqual({ exact_text: 'githubUrl: https://github.com/jordan-talent' });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_records cr
         JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
        WHERE cr.record_type = 'talent_pool_phone_screener_intent'`,
    ).get()).toEqual({ count: 4 });
    expect(sqlite.prepare(
      `SELECT record_type, predicate, narrative
         FROM context_records
        WHERE record_type = 'talent_pool_profile_intake'
        LIMIT 1`,
    ).get()).toEqual({
      record_type: 'talent_pool_profile_intake',
      predicate: 'submitted_profile_evidence',
      narrative: 'Candidate submitted Talent Pool profile evidence.',
    });
    expect(sqlite.prepare(
      `SELECT display_name, primary_email FROM people LIMIT 1`,
    ).get()).toEqual({
      display_name: 'Jordan Talent',
      primary_email: 'jordan@example.com',
    });
    expect(JSON.parse(sqlite.prepare(
      `SELECT context_json FROM workspace_people LIMIT 1`,
    ).get()!.context_json as string)).toMatchObject({
      source: 'roleless_candidate_intake',
      sources: ['roleless_candidate_intake'],
      legacyCandidateIds: ['candidate-1'],
      talentPool: {
        status: 'active',
        roleless: true,
        candidateId: 'candidate-1',
      },
    });

    const replay = await app.request('/rpc/talent/submit-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }, createEnv(sqlite, storage));
    expect(replay.status).toBe(200);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM interactions').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifacts').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifact_versions').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM source_spans').get()).toEqual({ count: 8 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({ count: 5 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_source_refs').get()).toEqual({ count: 8 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM candidate_nodes').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM challenge_design_queue').get()).toEqual({ count: 1 });
  });

  it('schedules text profile ingestion directly from submitted source text', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
    const storage = createMemoryR2();
    const app = createApp();
    const { ctx, waitUntilAll } = buildCtx();
    const payload = {
      inviteToken: 'invite-token',
      resumeText: 'Senior frontend engineer with React, TypeScript, Cloudflare Workers, accessibility fixes, source-backed tests, and open-source review experience.',
      githubUrl: 'https://github.com/jordan-talent',
      linkedinUrl: 'https://linkedin.com/in/jordan-talent',
      phoneScreenerConsent: false,
    };

    const res = await app.request('/rpc/talent/submit-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }, createEnv(sqlite, storage), ctx);

    expect(res.status).toBe(200);
    await waitUntilAll();

    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'candidate-1',
      resumeText: payload.resumeText,
      decompositionResult: null,
      mirrorLivingContext: false,
      maxNodeEmbeddings: 0,
      maxParserOnlyNodes: 12,
      skipPostDecompositionMaintenance: true,
      candidateDiscoveryTimeoutMs: 8000,
      candidateDiscoveryMaxAttempts: 2,
      parsed: expect.objectContaining({
        skills: expect.any(Array),
        experiences: expect.any(Array),
      }),
    }));
  });

  it('preserves completed ingestion progress when submitted profile evidence is replayed', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
    sqlite.prepare(
      `INSERT INTO candidate_ingestion (
         candidate_id, status, github_url, linkedin_url, current_step, error_text,
         created_at, updated_at
       )
       VALUES (
         'candidate-1', 'embedded', 'https://github.com/jordan-original', NULL,
         'embed_profile', NULL,
         '2026-06-30T01:00:00.000Z', '2026-06-30T01:00:00.000Z'
       )`,
    ).run();
    const storage = createMemoryR2();
    const app = createApp();
    const payload = {
      inviteToken: 'invite-token',
      resumeText: 'Replay source-backed profile text with TypeScript, Workers, accessibility, and evidence ingestion experience.',
      githubUrl: 'https://github.com/jordan-replay',
      linkedinUrl: 'https://linkedin.com/in/jordan-replay',
    };

    const res = await app.request('/rpc/talent/submit-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }, createEnv(sqlite, storage));

    expect(res.status).toBe(200);
    expect(sqlite.prepare(
      `SELECT status, github_url, linkedin_url, current_step, error_text
         FROM candidate_ingestion
        WHERE candidate_id = 'candidate-1'`,
    ).get()).toEqual({
      status: 'embedded',
      github_url: 'https://github.com/jordan-replay',
      linkedin_url: 'https://linkedin.com/in/jordan-replay',
      current_step: 'embed_profile',
      error_text: null,
    });
  });

  it('projects email-less profile intake into the unified person graph idempotently', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite, { email: null });
    const storage = createMemoryR2();
    const app = createApp();
    const payload = {
      inviteToken: 'invite-token',
      resumeText: 'Backend engineer with Cloudflare Workers, durable evidence ingestion, and source-backed graph projection experience.',
      githubUrl: 'https://github.com/no-email-talent',
    };

    const res = await app.request('/rpc/talent/submit-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }, createEnv(sqlite, storage));

    expect(res.status).toBe(200);
    const body = await res.json() as TalentDashboardBody;
    expect(body.status).toBe('CHALLENGE_PREPARING');
    expect(body.candidateName).toBe('Jordan Talent');
    expectCandidateSafeDashboard(body, ['candidate-1', 'owner-1']);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM applications').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM person_roles').get()).toEqual({ count: 0 });
    expect(sqlite.prepare(
      `SELECT ingestion_key, display_name, primary_email FROM people LIMIT 1`,
    ).get()).toEqual({
      ingestion_key: 'candidate:candidate-1:roleless-person',
      display_name: 'Jordan Talent',
      primary_email: null,
    });
    expect(JSON.parse(sqlite.prepare(
      `SELECT context_json FROM workspace_people LIMIT 1`,
    ).get()!.context_json as string)).toMatchObject({
      legacyCandidateIds: ['candidate-1'],
      talentPool: {
        status: 'active',
        roleless: true,
        candidateId: 'candidate-1',
      },
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM candidate_nodes').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_source_refs').get()).toEqual({ count: 2 });

    const replay = await app.request('/rpc/talent/submit-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }, createEnv(sqlite, storage));

    expect(replay.status).toBe(200);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM candidate_nodes').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_source_refs').get()).toEqual({ count: 2 });
  });

  it('accepts token-scoped profile file uploads before an assessment session exists', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
    const storage = createMemoryR2();
    const app = createApp();
    const formData = new FormData();
    const uploadedText = 'Taylor has shipped TypeScript frontend systems, Workers APIs, and source-backed accessibility fixes.';
    formData.set('inviteToken', 'invite-token');
    formData.set('file', new File([uploadedText], 'taylor-profile.txt', { type: 'text/plain' }));
    formData.set('githubUrl', 'https://github.com/taylor-upload');

    const res = await app.request('/rpc/talent/upload-profile', {
      method: 'POST',
      body: formData,
    }, createEnv(sqlite, storage));

    expect(res.status).toBe(200);
    const body = await res.json() as TalentDashboardBody;
    expect(body.status).toBe('CHALLENGE_PREPARING');
    expect(body.candidateName).toBe('Jordan Talent');
    expectCandidateSafeDashboard(body, ['candidate-1', 'owner-1']);

    expect([...storage.puts.keys()][0]).toMatch(/^talent-intake\/candidate-1\/.*taylor-profile\.txt$/);
    const intake = sqlite.prepare(
      `SELECT profile_r2_key, profile_text_excerpt, github_url
         FROM talent_pool_intakes
        WHERE candidate_id = 'candidate-1'`,
    ).get() as { profile_r2_key: string; profile_text_excerpt: string; github_url: string };
    expect(intake.profile_r2_key).toMatch(/^talent-intake\/candidate-1\/.*taylor-profile\.txt$/);
    expect(intake.profile_text_excerpt).toContain('Taylor has shipped TypeScript');
    expect(intake.github_url).toBe('https://github.com/taylor-upload');
    expect(storage.puts.get(intake.profile_r2_key)).toMatchObject({
      byteLength: new TextEncoder().encode(uploadedText).byteLength,
      contentType: 'text/plain',
      customMetadata: {
        source: 'talent_pool_intake',
        candidateId: 'candidate-1',
      },
    });

    expect(sqlite.prepare(
      `SELECT resume_s3_key
         FROM candidates
        WHERE id = 'candidate-1'`,
    ).get()).toEqual({ resume_s3_key: intake.profile_r2_key });
    expect(sqlite.prepare(
      `SELECT storage_key, media_type
         FROM artifact_versions
        WHERE storage_key = ?
        LIMIT 1`,
    ).get(intake.profile_r2_key)).toEqual({
      storage_key: intake.profile_r2_key,
      media_type: 'text/plain',
    });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM interactions`,
    ).get()).toEqual({ count: 3 });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM artifacts`,
    ).get()).toEqual({ count: 3 });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM artifact_versions`,
    ).get()).toEqual({ count: 3 });

    const uploadedTextArtifactRows = sqlite.prepare(
      `SELECT i.interaction_type,
              a.artifact_type,
              a.logical_key,
              av.media_type,
              av.storage_key,
              av.content_text,
              length(av.content_hash) AS hash_length,
              json_extract(av.metadata_json, '$.evidenceKind') AS evidence_kind,
              json_extract(av.metadata_json, '$.extractedTextAvailable') AS extracted_text_available,
              json_extract(av.metadata_json, '$.originalFileName') AS original_file_name
         FROM artifact_versions av
         JOIN artifacts a ON a.id = av.artifact_id
         JOIN interactions i ON i.id = a.interaction_id
        WHERE av.storage_key = ?
        ORDER BY a.artifact_type`,
    ).all(intake.profile_r2_key);
    expect(uploadedTextArtifactRows).toEqual([
      {
        interaction_type: 'message',
        artifact_type: 'message',
        logical_key: 'roleless_candidate_intake_message',
        media_type: 'text/plain',
        storage_key: intake.profile_r2_key,
        content_text: uploadedText,
        hash_length: 64,
        evidence_kind: null,
        extracted_text_available: null,
        original_file_name: null,
      },
      {
        interaction_type: 'file_upload',
        artifact_type: 'profile_upload',
        logical_key: 'roleless_candidate_profile_upload',
        media_type: 'text/plain',
        storage_key: intake.profile_r2_key,
        content_text: null,
        hash_length: 64,
        evidence_kind: 'profile_upload_source',
        extracted_text_available: 1,
        original_file_name: 'taylor-profile.txt',
      },
    ]);
    expect(sqlite.prepare(
      `SELECT ss.exact_text, av.storage_key
         FROM source_spans ss
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
        WHERE av.storage_key = ?
          AND ss.exact_text = ?
        LIMIT 1`,
    ).get(
      intake.profile_r2_key,
      uploadedText,
    )).toEqual({
      exact_text: uploadedText,
      storage_key: intake.profile_r2_key,
    });
    expect(sqlite.prepare(
      `SELECT cr.record_type, cr.predicate, ss.exact_text, av.storage_key
         FROM context_records cr
         JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crsr.source_span_id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
        WHERE cr.record_type = 'talent_pool_profile_intake'
        LIMIT 1`,
    ).get()).toEqual({
      record_type: 'talent_pool_profile_intake',
      predicate: 'submitted_profile_evidence',
      exact_text: uploadedText,
      storage_key: intake.profile_r2_key,
    });
    expect(sqlite.prepare(
      `SELECT cn.node_type, av.storage_key
         FROM candidate_nodes cn
         JOIN source_spans ss ON cn.source_reference = 'source_span:' || ss.id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
        WHERE cn.candidate_id = 'candidate-1'
        LIMIT 1`,
    ).get()).toEqual({
      node_type: 'TalentPoolProfileIntake',
      storage_key: intake.profile_r2_key,
    });

    const replayFormData = new FormData();
    replayFormData.set('inviteToken', 'invite-token');
    replayFormData.set('file', new File([uploadedText], 'taylor-profile.txt', { type: 'text/plain' }));
    replayFormData.set('githubUrl', 'https://github.com/taylor-upload');

    const replay = await app.request('/rpc/talent/upload-profile', {
      method: 'POST',
      body: replayFormData,
    }, createEnv(sqlite, storage));

    expect(replay.status).toBe(200);
    expect(storage.puts.size).toBe(1);
    expect([...storage.puts.keys()][0]).toBe(intake.profile_r2_key);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM interactions').get()).toEqual({ count: 3 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifacts').get()).toEqual({ count: 3 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifact_versions').get()).toEqual({ count: 3 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM source_spans').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM candidate_nodes').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      `SELECT json_extract(extracted_properties_json, '$.source_quote_validated') AS source_quote_validated,
              json_extract(extracted_properties_json, '$.source_quote') AS source_quote
         FROM candidate_nodes
        WHERE candidate_id = 'candidate-1'
        LIMIT 1`,
    ).get()).toMatchObject({
      source_quote_validated: 1,
      source_quote: uploadedText,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_source_refs').get()).toEqual({ count: 2 });
  });

  it('projects extracted DOCX uploads into source-backed person evidence idempotently', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
    const storage = createMemoryR2();
    const app = createApp();
    const expectedDocxText = [
      'Experience',
      'Source Docs',
      'Backend Engineer — January 2021 – Present',
      'Built Cloudflare Workers ingestion replay with TypeScript.',
    ].join('\n');
    const docx = buildStoredDocx(`
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Experience</w:t></w:r></w:p>
          <w:p><w:r><w:t>Source Docs</w:t></w:r></w:p>
          <w:p><w:r><w:t>Backend Engineer — January 2021 – Present</w:t></w:r></w:p>
          <w:p><w:r><w:t>Built Cloudflare Workers ingestion replay with TypeScript.</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `);
    const formData = new FormData();
    formData.set('inviteToken', 'invite-token');
    formData.set(
      'file',
      new File([docx], 'source-docs-profile.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );

    const res = await app.request('/rpc/talent/upload-profile', {
      method: 'POST',
      body: formData,
    }, createEnv(sqlite, storage));

    expect(res.status).toBe(200);
    const body = await res.json() as TalentDashboardBody;
    expect(body.status).toBe('CHALLENGE_PREPARING');
    expectCandidateSafeDashboard(body, ['candidate-1', 'owner-1']);

    const storedKey = [...storage.puts.keys()][0];
    expect(storedKey).toMatch(/^talent-intake\/candidate-1\/.*source-docs-profile\.docx$/);
    expect(storage.puts.get(storedKey)).toMatchObject({
      byteLength: docx.byteLength,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      customMetadata: {
        source: 'talent_pool_intake',
        candidateId: 'candidate-1',
      },
    });
    const intake = sqlite.prepare(
      `SELECT profile_r2_key, profile_text_excerpt
         FROM talent_pool_intakes
        WHERE candidate_id = 'candidate-1'`,
    ).get() as { profile_r2_key: string; profile_text_excerpt: string };
    expect(intake.profile_r2_key).toBe(storedKey);
    expect(intake.profile_text_excerpt).toContain('Built Cloudflare Workers ingestion replay');
    expect(sqlite.prepare(
      `SELECT resume_s3_key
         FROM candidates
        WHERE id = 'candidate-1'`,
    ).get()).toEqual({ resume_s3_key: storedKey });

    const docxArtifactRows = sqlite.prepare(
      `SELECT i.interaction_type,
              a.artifact_type,
              a.logical_key,
              av.media_type,
              av.storage_key,
              av.content_text,
              length(av.content_hash) AS hash_length,
              json_extract(av.metadata_json, '$.evidenceKind') AS evidence_kind,
              json_extract(av.metadata_json, '$.extractedTextAvailable') AS extracted_text_available,
              json_extract(av.metadata_json, '$.originalFileName') AS original_file_name
         FROM artifact_versions av
         JOIN artifacts a ON a.id = av.artifact_id
         JOIN interactions i ON i.id = a.interaction_id
        WHERE av.storage_key = ?
        ORDER BY a.artifact_type`,
    ).all(storedKey);
    expect(docxArtifactRows).toEqual([
      {
        interaction_type: 'message',
        artifact_type: 'message',
        logical_key: 'roleless_candidate_intake_message',
        media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        storage_key: storedKey,
        content_text: expectedDocxText,
        hash_length: 64,
        evidence_kind: null,
        extracted_text_available: null,
        original_file_name: null,
      },
      {
        interaction_type: 'file_upload',
        artifact_type: 'profile_upload',
        logical_key: 'roleless_candidate_profile_upload',
        media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        storage_key: storedKey,
        content_text: null,
        hash_length: 64,
        evidence_kind: 'profile_upload_source',
        extracted_text_available: 1,
        original_file_name: 'source-docs-profile.docx',
      },
    ]);
    expect(sqlite.prepare(
      `SELECT ss.exact_text, av.storage_key
         FROM source_spans ss
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
        WHERE av.storage_key = ?
          AND ss.exact_text = ?
        LIMIT 1`,
    ).get(storedKey, expectedDocxText)).toEqual({
      exact_text: expectedDocxText,
      storage_key: storedKey,
    });
    expect(sqlite.prepare(
      `SELECT cr.record_type, cr.predicate, ss.exact_text, av.storage_key
         FROM context_records cr
         JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crsr.source_span_id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
        WHERE cr.record_type = 'talent_pool_profile_intake'
        LIMIT 1`,
    ).get()).toEqual({
      record_type: 'talent_pool_profile_intake',
      predicate: 'submitted_profile_evidence',
      exact_text: expectedDocxText,
      storage_key: storedKey,
    });
    expect(sqlite.prepare(
      `SELECT cn.node_type,
              av.storage_key,
              json_extract(cn.extracted_properties_json, '$.source_quote_validated') AS source_quote_validated,
              json_extract(cn.extracted_properties_json, '$.source_quote') AS source_quote
         FROM candidate_nodes cn
         JOIN source_spans ss ON cn.source_reference = 'source_span:' || ss.id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
        WHERE cn.candidate_id = 'candidate-1'
        LIMIT 1`,
    ).get()).toEqual({
      node_type: 'TalentPoolProfileIntake',
      storage_key: storedKey,
      source_quote_validated: 1,
      source_quote: expectedDocxText,
    });

    const replayFormData = new FormData();
    replayFormData.set('inviteToken', 'invite-token');
    replayFormData.set(
      'file',
      new File([docx], 'source-docs-profile.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );

    const replay = await app.request('/rpc/talent/upload-profile', {
      method: 'POST',
      body: replayFormData,
    }, createEnv(sqlite, storage));

    expect(replay.status).toBe(200);
    expect(storage.puts.size).toBe(1);
    expect([...storage.puts.keys()][0]).toBe(storedKey);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM interactions').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifacts').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifact_versions').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM source_spans').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM candidate_nodes').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_source_refs').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM challenge_design_queue').get()).toEqual({ count: 1 });
  });

  it('keeps unextractable document uploads as explicit evidence gaps', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
    const storage = createMemoryR2();
    const app = createApp();
    const { ctx, waitUntilAll } = buildCtx();
    const formData = new FormData();
    formData.set('inviteToken', 'invite-token');
    formData.set('file', new File(['not a real pdf'], 'empty-profile.pdf', { type: 'application/pdf' }));

    const res = await app.request('/rpc/talent/upload-profile', {
      method: 'POST',
      body: formData,
    }, createEnv(sqlite, storage), ctx);

    expect(res.status).toBe(200);
    await waitUntilAll();
    expect(processResumeFromR2).not.toHaveBeenCalled();
    const body = await res.json() as TalentDashboardBody;
    expect(body.status).toBe('CHALLENGE_PREPARING');
    expect(body.readyChallenges).toEqual([]);
    expectCandidateSafeDashboard(body, ['candidate-1', 'owner-1']);

    const storedKey = [...storage.puts.keys()][0];
    expect(storedKey).toMatch(/^talent-intake\/candidate-1\/.*empty-profile\.pdf$/);
    expect(storage.puts.get(storedKey)).toMatchObject({
      byteLength: 14,
      contentType: 'application/pdf',
      customMetadata: {
        source: 'talent_pool_intake',
        candidateId: 'candidate-1',
      },
    });
    const intake = sqlite.prepare(
      `SELECT status, profile_r2_key, profile_text_excerpt
         FROM talent_pool_intakes
        WHERE candidate_id = 'candidate-1'`,
    ).get() as { status: string; profile_r2_key: string; profile_text_excerpt: string };
    expect(intake).toEqual({
      status: 'CHALLENGE_PREPARING',
      profile_r2_key: storedKey,
      profile_text_excerpt: 'Uploaded empty-profile.pdf',
    });
    expect(sqlite.prepare(
      `SELECT resume_s3_key
         FROM candidates
        WHERE id = 'candidate-1'`,
    ).get()).toEqual({ resume_s3_key: storedKey });
    expect(sqlite.prepare(
      `SELECT status, current_step, error_text
         FROM candidate_ingestion
        WHERE candidate_id = 'candidate-1'`,
    ).get()).toEqual({
      status: 'pending',
      current_step: 'profile_text_extraction_needed',
      error_text: null,
    });

    const queue = sqlite.prepare(
      `SELECT candidate_summary, missing_signal, inventory_failure_reason,
              suggested_repo_families, desired_assessment_signal
         FROM challenge_design_queue
        WHERE candidate_id = 'candidate-1'`,
    ).get() as {
      candidate_summary: string;
      missing_signal: string;
      inventory_failure_reason: string;
      suggested_repo_families: string;
      desired_assessment_signal: string;
    };
    expect(queue.candidate_summary).toContain('Profile upload received, but no extractable source text was available.');
    expect(queue.candidate_summary).not.toContain('Uploaded profile file');
    expect(queue.missing_signal).toContain('extractable source-backed profile evidence');
    expect(queue.inventory_failure_reason).toContain('No exact profile or resume source text');
    expect(JSON.parse(queue.suggested_repo_families)).toEqual([]);
    expect(queue.desired_assessment_signal).toContain('Extract source-backed profile or resume evidence');
    expect(JSON.stringify(queue)).not.toContain('general TypeScript application code');

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM applications').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM person_roles').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM interactions').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifacts').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifact_versions').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      `SELECT i.interaction_type,
              a.artifact_type,
              a.logical_key,
              av.media_type,
              av.storage_key,
              av.byte_length,
              av.content_text,
              length(av.content_hash) AS hash_length,
              json_extract(av.metadata_json, '$.evidenceKind') AS evidence_kind,
              json_extract(av.metadata_json, '$.extractedTextAvailable') AS extracted_text_available,
              json_extract(av.metadata_json, '$.originalFileName') AS original_file_name
         FROM artifact_versions av
         JOIN artifacts a ON a.id = av.artifact_id
         JOIN interactions i ON i.id = a.interaction_id
        LIMIT 1`,
    ).get()).toEqual({
      interaction_type: 'file_upload',
      artifact_type: 'profile_upload',
      logical_key: 'roleless_candidate_profile_upload',
      media_type: 'application/pdf',
      storage_key: storedKey,
      byte_length: 14,
      content_text: null,
      hash_length: 64,
      evidence_kind: 'profile_upload_source',
      extracted_text_available: 0,
      original_file_name: 'empty-profile.pdf',
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM source_spans').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM candidate_nodes').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({ count: 0 });

    const replayFormData = new FormData();
    replayFormData.set('inviteToken', 'invite-token');
    replayFormData.set('file', new File(['not a real pdf'], 'empty-profile.pdf', { type: 'application/pdf' }));

    const replay = await app.request('/rpc/talent/upload-profile', {
      method: 'POST',
      body: replayFormData,
    }, createEnv(sqlite, storage));

    expect(replay.status).toBe(200);
    expect(storage.puts.size).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM challenge_design_queue').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM interactions').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifacts').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM artifact_versions').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM source_spans').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM candidate_nodes').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({ count: 0 });
  });

  it('keeps PR-backed assignments preparing until a source-backed challenge packet exists', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
    seedSubmittedTalentPoolIntake(sqlite);
    seedOpenSourceChallengePacketTables(sqlite);
    sqlite.prepare(
      `INSERT INTO challenges (id, title, type)
       VALUES ('challenge-1', 'Source-backed review', 'CODE_REVIEW')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO candidate_challenge_assignment (
         id, candidate_id, stage_id, challenge_id, github_repo_url, github_pr_number, assigned_at
       )
       VALUES (
         'assignment-1', 'candidate-1', 'stage-1', 'challenge-1',
         'https://github.com/mui/base-ui', 973, '2026-06-30T01:00:00.000Z'
       )`,
    ).run();

    const app = createApp();
    const res = await app.request('/rpc/talent/resolve-token', {
      method: 'POST',
      body: JSON.stringify({ inviteToken: 'invite-token' }),
      headers: { 'Content-Type': 'application/json' },
    }, createEnv(sqlite));

    expect(res.status).toBe(200);
    const body = await res.json() as TalentDashboardBody;
    expect(body.status).toBe('CHALLENGE_PREPARING');
    expect(body.readyChallenges).toEqual([]);
    expectCandidateSafeDashboard(body, ['candidate-1', 'assignment-1', 'challenge-1', 'stage-1']);
  });

  it('shows assessment entry only when a challenge assignment has source-backed packet proof', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
    seedSubmittedTalentPoolIntake(sqlite);
    seedSourceBackedChallengePacket(sqlite);
    sqlite.prepare(
      `INSERT INTO challenges (id, title, type)
       VALUES ('challenge-1', 'Source-backed review', 'CODE_REVIEW')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO candidate_challenge_assignment (
         id, candidate_id, stage_id, challenge_id, github_repo_url, github_pr_number, assigned_at
       )
       VALUES (
         'assignment-1', 'candidate-1', 'stage-1', 'challenge-1',
         'https://github.com/mui/base-ui', 973, '2026-06-30T01:00:00.000Z'
       )`,
    ).run();

    const app = createApp();
    const res = await app.request('/rpc/talent/resolve-token', {
      method: 'POST',
      body: JSON.stringify({ inviteToken: 'invite-token' }),
      headers: { 'Content-Type': 'application/json' },
    }, createEnv(sqlite));

    expect(res.status).toBe(200);
    const body = await res.json() as TalentDashboardBody;
    expect(body.status).toBe('CHALLENGE_READY');
    expect(body.readyChallenges).toEqual([{
      title: 'Fix popover retry scheduling',
      type: 'CODE_REVIEW',
      entryUrl: '/assess/invite-token',
      summary: 'Ready for mui/base-ui PR #973.',
    }]);
    expectCandidateSafeDashboard(body, [
      'candidate-1',
      'assignment-1',
      'challenge-1',
      'stage-1',
      'challenge-packet-973',
      'challenge-packet-context-973',
      'repo-source-span-1',
    ]);
  });
});
