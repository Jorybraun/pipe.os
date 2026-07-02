import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import { talentPoolPublic } from '../talentPool';
import type { Env, Variables } from '../../types';

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

interface MemoryR2 extends R2Bucket {
  puts: Map<string, string>;
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

function createMemoryR2(): MemoryR2 {
  const puts = new Map<string, string>();
  return {
    puts,
    put: async (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null) => {
      puts.set(key, typeof value === 'string' ? value : '');
      return null;
    },
  } as MemoryR2;
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

function seedCandidate(sqlite: BetterSqliteDb): void {
  sqlite.prepare(
    `INSERT INTO candidates (
       id, owner_id, name, email, invite_token, status, pipeline_id,
       current_stage_id, resume_s3_key, phone_number, created_at, updated_at
     )
     VALUES (
       'candidate-1', 'owner-1', 'Jordan Talent', 'jordan@example.com',
       'invite-token', 'INVITED', NULL, NULL, NULL, NULL,
       '2026-06-30T00:00:00.000Z', '2026-06-30T00:00:00.000Z'
     )`,
  ).run();
}

describe('talent pool candidate RPC', () => {
  let sqlite: BetterSqliteDb | null = null;

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
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('candidate-1');
    expect(serialized).not.toContain('WAITING_FOR_MATCH');
    expect(serialized).not.toContain('Repo matching');
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
    expect(JSON.stringify(body)).not.toContain('candidate-1');
    expect(JSON.stringify(body)).not.toContain('WAITING_FOR_MATCH');

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

  it('accepts token-scoped profile file uploads before an assessment session exists', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
    const storage = createMemoryR2();
    const app = createApp();
    const formData = new FormData();
    formData.set('inviteToken', 'invite-token');
    formData.set('file', new File([
      'Taylor has shipped TypeScript frontend systems, Workers APIs, and source-backed accessibility fixes.',
    ], 'taylor-profile.txt', { type: 'text/plain' }));
    formData.set('githubUrl', 'https://github.com/taylor-upload');

    const res = await app.request('/rpc/talent/upload-profile', {
      method: 'POST',
      body: formData,
    }, createEnv(sqlite, storage));

    expect(res.status).toBe(200);
    const body = await res.json() as TalentDashboardBody;
    expect(body.status).toBe('CHALLENGE_PREPARING');
    expect(body.candidateName).toBe('Jordan Talent');
    expect(JSON.stringify(body)).not.toContain('candidate-1');
    expect(JSON.stringify(body)).not.toContain('WAITING_FOR_MATCH');

    expect([...storage.puts.keys()][0]).toMatch(/^talent-intake\/candidate-1\/.*taylor-profile\.txt$/);
    const intake = sqlite.prepare(
      `SELECT profile_r2_key, profile_text_excerpt, github_url
         FROM talent_pool_intakes
        WHERE candidate_id = 'candidate-1'`,
    ).get() as { profile_r2_key: string; profile_text_excerpt: string; github_url: string };
    expect(intake.profile_r2_key).toMatch(/^talent-intake\/candidate-1\/.*taylor-profile\.txt$/);
    expect(intake.profile_text_excerpt).toContain('Taylor has shipped TypeScript');
    expect(intake.github_url).toBe('https://github.com/taylor-upload');

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

    const replayFormData = new FormData();
    replayFormData.set('inviteToken', 'invite-token');
    replayFormData.set('file', new File([
      'Taylor has shipped TypeScript frontend systems, Workers APIs, and source-backed accessibility fixes.',
    ], 'taylor-profile.txt', { type: 'text/plain' }));
    replayFormData.set('githubUrl', 'https://github.com/taylor-upload');

    const replay = await app.request('/rpc/talent/upload-profile', {
      method: 'POST',
      body: replayFormData,
    }, createEnv(sqlite, storage));

    expect(replay.status).toBe(200);
    expect(storage.puts.size).toBe(1);
    expect([...storage.puts.keys()][0]).toBe(intake.profile_r2_key);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM candidate_nodes').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      `SELECT json_extract(extracted_properties_json, '$.source_quote_validated') AS source_quote_validated,
              json_extract(extracted_properties_json, '$.source_quote') AS source_quote
         FROM candidate_nodes
        WHERE candidate_id = 'candidate-1'
        LIMIT 1`,
    ).get()).toMatchObject({
      source_quote_validated: 1,
      source_quote: 'Taylor has shipped TypeScript frontend systems, Workers APIs, and source-backed accessibility fixes.',
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_source_refs').get()).toEqual({ count: 2 });
  });

  it('keeps unextractable document uploads as explicit evidence gaps', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
    const storage = createMemoryR2();
    const app = createApp();
    const formData = new FormData();
    formData.set('inviteToken', 'invite-token');
    formData.set('file', new File(['not a real pdf'], 'empty-profile.pdf', { type: 'application/pdf' }));

    const res = await app.request('/rpc/talent/upload-profile', {
      method: 'POST',
      body: formData,
    }, createEnv(sqlite, storage));

    expect(res.status).toBe(200);
    const body = await res.json() as TalentDashboardBody;
    expect(body.status).toBe('CHALLENGE_PREPARING');
    expect(body.readyChallenges).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('candidate-1');
    expect(JSON.stringify(body)).not.toContain('WAITING_FOR_MATCH');

    const storedKey = [...storage.puts.keys()][0];
    expect(storedKey).toMatch(/^talent-intake\/candidate-1\/.*empty-profile\.pdf$/);
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
      current_step: 'talent_pool_profile_received',
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
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM candidate_nodes').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({ count: 0 });
  });

  it('shows assessment entry only when a real challenge assignment exists', async () => {
    sqlite = createSqlite();
    seedCandidate(sqlite);
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
      title: 'Source-backed review',
      type: 'CODE_REVIEW',
      entryUrl: '/assess/invite-token',
      summary: 'Ready for mui/base-ui PR #973.',
    }]);
    expect(JSON.stringify(body)).not.toContain('assignment-1');
    expect(JSON.stringify(body)).not.toContain('challenge-1');
  });
});
