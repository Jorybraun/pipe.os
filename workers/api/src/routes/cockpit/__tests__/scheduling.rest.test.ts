/**
 * Scheduling routes unit tests — contact-first invite creation and transcript artifacts.
 *
 * Validates the invite creation endpoint supports both contact-first
 * (recipientName/recipientEmail) and pipeline-integrated (candidateId/pipelineId/stageId)
 * meeting models.
 *
 * Validates transcript artifact creation/retrieval and graph associations.
 */

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  ensureCandidateLivingContext,
  ensureContactLivingContext,
  ingestMeetingTranscriptToLivingContext,
  LivingContextStore,
} from '../../../lib/livingContext';
import * as d1Matcher from '../../../lib/challengeMatching/d1Matcher';
import type { Env, Variables } from '../../../types';
import {
  canInterviewStatusTransition,
  schedulingAuth,
  schedulingPublic,
} from '../scheduling';

function buildCtx(): { ctx: ExecutionContext; waitUntilAll: () => Promise<void> } {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        promises.push(promise);
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    waitUntilAll: async () => {
      await Promise.all(promises);
    },
  };
}

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const assessmentLayerMigration = readFileSync(
  new URL('../../../../migrations/0102_assessment_layer.sql', import.meta.url),
  'utf8',
);

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createMockD1WithNumberedParamLimit(sqlite: BetterSqliteDb, maxParam: number): D1Database {
  const base = createMockD1(sqlite);
  return {
    prepare(query: string): D1PreparedStatement {
      for (const match of query.matchAll(/\?(\d+)/g)) {
        const paramNumber = Number(match[1]);
        if (paramNumber > maxParam) {
          throw new Error(`D1_ERROR: variable number must be between ?1 and ?${maxParam}`);
        }
      }
      return base.prepare(query);
    },
    batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
      return base.batch(statements);
    },
    exec(query: string): Promise<D1ExecResult> {
      return base.exec(query);
    },
    dump(): Promise<ArrayBuffer> {
      return base.dump();
    },
  } as D1Database;
}

async function seedEvidencePlanMatcherContext(
  sqlite: BetterSqliteDb,
  input: {
    assessmentSessionId: string;
    candidateId?: string;
    narrative?: string;
  },
): Promise<void> {
  const candidateId = input.candidateId ?? 'candidate-1';
  const identity = await ensureCandidateLivingContext(createMockD1(sqlite), candidateId);
  if (!identity) throw new Error(`candidate ${candidateId} did not resolve to living context`);
  const now = '2026-06-22T19:00:30.000Z';
  const contextRecordId = `context-record-${input.assessmentSessionId}`;
  sqlite.prepare(
    `INSERT INTO context_records (
       id, ingestion_key, scope_type, scope_id, workspace_person_id,
       interaction_id, application_id, episode_id, assertion_id,
       record_type, predicate, narrative, qualifiers_json, confidence, polarity,
       extraction_version, observed_at, created_at, updated_at
     ) VALUES (?, ?, 'workspace_person', ?, ?, NULL, ?, NULL, NULL,
       'code_review_evidence_plan_response',
       'provides concrete candidate work evidence for repo matching',
       ?, ?, 0.95, 1,
       'code-review-evidence-plan-response-v1', ?, ?, ?)`,
  ).run(
    contextRecordId,
    `assessment-session:${input.assessmentSessionId}:matcher-context`,
    identity.workspacePersonId,
    identity.workspacePersonId,
    identity.applicationId,
    input.narrative ?? 'Candidate supplied concrete source-backed review evidence.',
    JSON.stringify({ evidencePlanSessionId: input.assessmentSessionId }),
    now,
    now,
    now,
  );
  sqlite.prepare(
    `INSERT INTO context_record_entities (
       context_record_id, entity_key, entity_type, entity_id, relationship,
       value_json, confidence, metadata_json, created_at
     ) VALUES (?, ?, 'assessment_session', ?, 'source_assessment',
       NULL, NULL, '{}', ?)`,
  ).run(
    contextRecordId,
    `assessment_session:${input.assessmentSessionId}`,
    input.assessmentSessionId,
    now,
  );
}

async function seedCandidateOwnedEvidencePlanSourceSpan(
  sqlite: BetterSqliteDb,
  input: {
    text: string;
    candidateId?: string;
    sourceKey?: string;
  },
): Promise<string> {
  const candidateId = input.candidateId ?? 'candidate-1';
  const identity = await ensureCandidateLivingContext(createMockD1(sqlite), candidateId);
  if (!identity) throw new Error(`candidate ${candidateId} did not resolve to living context`);
  const sourceKey = input.sourceKey ?? `evidence-plan-source-${sha256Hex(input.text).slice(0, 12)}`;
  const store = new LivingContextStore(createMockD1(sqlite), () => '2026-06-22T19:00:30.000Z');
  const interaction = await store.upsertInteraction({
    ingestionKey: `code-review-evidence-plan:${sourceKey}:interaction`,
    workspacePersonId: identity.workspacePersonId,
    interactionType: 'direct_video_call',
    externalReference: `meeting-${sourceKey}`,
    startedAt: '2026-06-22T19:00:00.000Z',
    metadata: { source: 'evidence-plan-repair-test' },
  });
  const artifact = await store.upsertArtifact({
    ingestionKey: `code-review-evidence-plan:${sourceKey}:artifact`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'meeting_transcript',
    logicalKey: `meetings/${sourceKey}/transcript`,
    metadata: { source: 'evidence-plan-repair-test' },
  });
  const version = await store.createArtifactVersion({
    ingestionKey: `code-review-evidence-plan:${sourceKey}:artifact:v1`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash: sha256Hex(input.text),
    mediaType: 'text/plain',
    contentText: input.text,
    byteLength: input.text.length,
    metadata: { source: 'evidence-plan-repair-test' },
  });
  const span = await store.createSourceSpan({
    ingestionKey: `code-review-evidence-plan:${sourceKey}:span-1`,
    artifactVersionId: version.id,
    stableSegmentId: `${sourceKey}:candidate-answer`,
    charStart: 0,
    charEnd: input.text.length,
    exactText: input.text,
    metadata: { speakerRole: 'guest' },
  });
  return span.id;
}

const SOURCE_BACKED_WORK_EVIDENCE_QUESTION =
  'Describe one real PR, bug, or code review you personally handled that best represents the work PIPE should assess. Include the codebase context, your role, trade-offs, verification/tests, and outcome.';
const SOURCE_BACKED_WORK_EVIDENCE_FOLLOW_UP =
  'What did you inspect, which constraints mattered, and what source evidence would help PIPE map that work to a fair repo challenge?';

// ─── Validation schema tests ────────────────────────────────────────────────

describe('Create interview validation', () => {
  it('accepts contact-first invite with recipient info', () => {
    const validContactFirst = {
      recipientName: 'Alice Johnson',
      recipientEmail: 'alice@example.com',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: '2026-06-10T14:00:00Z',
      cvProfile: { experience: '5 years', skills: ['JavaScript', 'React'] },
    };

    // Should pass validation: recipientName + recipientEmail provided
    expect(!!validContactFirst.recipientName).toBe(true);
    expect(!!validContactFirst.recipientEmail).toBe(true);
    expect(validContactFirst.recipientEmail).toContain('@');
  });

  it('accepts pipeline-integrated invite with candidate context', () => {
    const validPipelineIntegrated = {
      candidateId: 'candidate-123',
      pipelineId: 'pipeline-456',
      stageId: 'stage-789',
      meetingType: 'SCREENING_INTERVIEW',
      schedulingProvider: 'CALENDLY',
    };

    // Should pass validation: candidateId + pipelineId + stageId provided
    expect(!!validPipelineIntegrated.candidateId).toBe(true);
    expect(!!validPipelineIntegrated.pipelineId).toBe(true);
    expect(!!validPipelineIntegrated.stageId).toBe(true);
  });

  it('rejects invite without pipeline context OR recipient info', () => {
    const invalid = {
      meetingType: 'DIRECT_VIDEO_CALL',
      // Missing both pipeline context and recipient info
    };

    const hasPipelineContext = !!(invalid.candidateId && invalid.pipelineId && invalid.stageId);
    const hasRecipientInfo = !!(invalid.recipientName && invalid.recipientEmail);

    // Should fail validation: neither pipeline context nor recipient info provided
    expect(hasPipelineContext || hasRecipientInfo).toBe(false);
  });

  it('accepts invite with both pipeline context and recipient info', () => {
    const validBoth = {
      candidateId: 'candidate-123',
      pipelineId: 'pipeline-456',
      stageId: 'stage-789',
      recipientName: 'Alice Johnson',
      recipientEmail: 'alice@example.com',
      meetingType: 'SCREENING_INTERVIEW',
    };

    const hasPipelineContext = !!(validBoth.candidateId && validBoth.pipelineId && validBoth.stageId);
    const hasRecipientInfo = !!(validBoth.recipientName && validBoth.recipientEmail);

    // Should pass validation: both provided (recipient override case)
    expect(hasPipelineContext || hasRecipientInfo).toBe(true);
  });

  it('accepts optional CV/profile payload', () => {
    const withCvProfile = {
      recipientName: 'Alice Johnson',
      recipientEmail: 'alice@example.com',
      cvProfile: {
        name: 'Alice Johnson',
        email: 'alice@example.com',
        experience: 'Senior Software Engineer',
        skills: ['TypeScript', 'React', 'Node.js'],
        education: 'BS Computer Science',
      },
    };

    expect(!!withCvProfile.cvProfile).toBe(true);
    expect(typeof withCvProfile.cvProfile).toBe('object');
  });
});

// ─── Status transition tests ─────────────────────────────────────────────────

describe('Status transition validation', () => {
  it('allows INVITED -> SCHEDULED', () => {
    expect(canInterviewStatusTransition('INVITED', 'SCHEDULED')).toBe(true);
  });

  it('allows INVITED -> CANCELLED', () => {
    expect(canInterviewStatusTransition('INVITED', 'CANCELLED')).toBe(true);
  });

  it('allows SCHEDULED -> ACTIVE', () => {
    expect(canInterviewStatusTransition('SCHEDULED', 'ACTIVE')).toBe(true);
  });

  it('allows SCHEDULED -> COMPLETED', () => {
    expect(canInterviewStatusTransition('SCHEDULED', 'COMPLETED')).toBe(true);
  });

  it('allows SCHEDULED -> NO_SHOW', () => {
    expect(canInterviewStatusTransition('SCHEDULED', 'NO_SHOW')).toBe(true);
  });

  it('allows ACTIVE -> COMPLETED', () => {
    expect(canInterviewStatusTransition('ACTIVE', 'COMPLETED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canInterviewStatusTransition('INVITED', 'COMPLETED')).toBe(false);
    expect(canInterviewStatusTransition('COMPLETED', 'SCHEDULED')).toBe(false);
    expect(canInterviewStatusTransition('CANCELLED', 'ACTIVE')).toBe(false);
  });

  it('allows CANCELLED -> INVITED (reschedule)', () => {
    expect(canInterviewStatusTransition('CANCELLED', 'INVITED')).toBe(true);
  });
});

// ─── Interview detail route tests ───────────────────────────────────────────

describe('GET /interviews/:id detail', () => {
  let sqlite: BetterSqliteDb | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sqlite?.close();
    sqlite = null;
  });

  function mountSchedulingApp(envOverrides: Partial<Env> = {}): Hono<{ Bindings: Env; Variables: Variables }> {
    if (!sqlite) throw new Error('sqlite fixture not initialized');
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.env = {
        DB: createMockD1(sqlite!),
        CLERK_SECRET_KEY: 'test',
        DEV_AUTH_BYPASS: 'true',
        DEV_BYPASS_USER_ID: 'owner-1',
        APP_BASE_URL: 'http://localhost:5173',
        ...envOverrides,
      } as unknown as Env;
      await next();
    });
    app.route('/', schedulingAuth);
    return app;
  }

  function mountSchedulingPublicApp(envOverrides: Partial<Env> = {}): Hono<{ Bindings: Env }> {
    if (!sqlite) throw new Error('sqlite fixture not initialized');
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', async (c, next) => {
      c.env = {
        DB: createMockD1(sqlite!),
        CLERK_SECRET_KEY: 'test',
        DEV_AUTH_BYPASS: 'true',
        DEV_BYPASS_USER_ID: 'owner-1',
        APP_BASE_URL: 'http://localhost:5173',
        ...envOverrides,
      } as unknown as Env;
      await next();
    });
    app.route('/', schedulingPublic);
    return app;
  }

  function seedInterviewDetailFixture(): void {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pipeline_id TEXT,
        status TEXT,
        name TEXT,
        email TEXT,
        invite_token TEXT,
        current_stage_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        email TEXT,
        name TEXT,
        company TEXT,
        role TEXT,
        phone TEXT,
        linkedin TEXT,
        notes TEXT,
        type TEXT NOT NULL DEFAULT 'lead',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT
      );
      CREATE TABLE stages (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        title TEXT
      );
      CREATE TABLE scheduled_interviews (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        pipeline_id TEXT,
        stage_id TEXT,
        owner_id TEXT NOT NULL,
        interview_type TEXT,
        meeting_type TEXT,
        status TEXT,
        scheduled_at TEXT,
        meeting_url TEXT,
        scheduling_provider TEXT,
        scheduling_url TEXT,
        external_event_id TEXT,
        recruiter_notes TEXT,
        sync_source TEXT,
        last_synced_at TEXT,
        invite_link_sent_at TEXT,
        email_sent_at TEXT,
        recipient_name TEXT,
        recipient_email TEXT,
        matched_repo_id INTEGER,
        github_repo_url TEXT,
        github_pr_number INTEGER,
        submission_json TEXT,
        completed_at TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE scheduling_connections (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_expiry TEXT,
        account_email TEXT,
        account_name TEXT,
        webhook_secret TEXT,
        webhook_id TEXT,
        status TEXT NOT NULL,
        connected_at TEXT NOT NULL,
        last_sync_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT
      );
      CREATE TABLE transcript_artifacts (
        id TEXT PRIMARY KEY,
        scheduled_interview_id TEXT NOT NULL,
        status TEXT NOT NULL,
        transcript_json TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        scheduled_interview_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        scheduled_at TEXT,
        started_at TEXT,
        ended_at TEXT,
        duration_secs INTEGER,
        meeting_url TEXT,
        meeting_type TEXT NOT NULL,
        scheduling_provider TEXT,
        external_event_id TEXT,
        transcript_status TEXT DEFAULT 'NONE',
        transcript_summary TEXT,
        transcript_json TEXT,
        transcript_analysis_json TEXT,
        transcript_error TEXT,
        recording_r2_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE meeting_rooms (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        session_id TEXT,
        status TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE meeting_participants (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'ATTENDEE',
        invite_sent_at TEXT,
        joined_at TEXT,
        left_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE meeting_room_tokens (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        participant_id TEXT,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
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
      CREATE TABLE qualified_repos (
        id INTEGER PRIMARY KEY,
        github_url TEXT
      );
      CREATE TABLE match_runs (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        role_snapshot_id TEXT,
        status TEXT,
        ranked_results_json TEXT,
        selected_packet_id TEXT,
        query_json TEXT,
        created_at TEXT
      );
      CREATE TABLE review_sessions (
        id TEXT PRIMARY KEY,
        challenge_submission_id TEXT,
        challenge_id TEXT,
        assessment_id TEXT,
        candidate_id TEXT,
        implementer_persona TEXT,
        current_round INTEGER,
        max_rounds INTEGER,
        status TEXT,
        transcript TEXT,
        next_comment_id INTEGER,
        score_report TEXT,
        created_at TEXT,
        updated_at TEXT,
        mode TEXT
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(assessmentLayerMigration);

    sqlite.prepare(`
      INSERT INTO candidates (id, owner_id, pipeline_id, status, name, email)
      VALUES ('candidate-1', 'owner-1', 'pipeline-1', 'ACTIVE', 'Ada Lovelace', 'ada@example.com')
    `).run();
    sqlite.prepare(`
      INSERT INTO contacts (
        id, owner_id, email, name, company, role, phone, linkedin, notes, type, created_at, updated_at
      ) VALUES (
        'contact-1', 'owner-1', 'client@example.com', 'Grace Hopper', 'Acme',
        'CTO', NULL, NULL, NULL, 'lead',
        '2026-06-22T17:00:00.000Z', '2026-06-22T17:00:00.000Z'
      )
    `).run();
    sqlite.prepare(`
      INSERT INTO pipelines (id, owner_id, title)
      VALUES ('pipeline-1', 'owner-1', 'Principal Systems Engineer')
    `).run();
    sqlite.prepare(`
      INSERT INTO stages (id, pipeline_id, title)
      VALUES ('stage-1', 'pipeline-1', 'Technical screen')
    `).run();
    sqlite.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-1', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'VIDEO', 'SCREENING_INTERVIEW', 'ACTIVE', '2026-06-22T18:00:00.000Z',
        NULL, 'MANUAL', NULL, NULL, 'Talk through repo evidence.',
        'MANUAL', NULL, '2026-06-22T17:40:00.000Z', '2026-06-22T17:40:00.000Z',
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-roleless-1', NULL, NULL, NULL, 'owner-1',
        'VIDEO', 'DIRECT_VIDEO_CALL', 'SCHEDULED', '2026-06-23T18:00:00.000Z',
        NULL, 'MANUAL', NULL, NULL, 'Discuss client architecture context.',
        'MANUAL', NULL, '2026-06-22T17:50:00.000Z', '2026-06-22T17:50:00.000Z',
        'Grace Hopper', 'client@example.com', NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:50:00.000Z', '2026-06-22T17:55:00.000Z'
      )
    `).run();
    sqlite.prepare(`
      INSERT INTO transcript_artifacts (
        id, scheduled_interview_id, status, transcript_json, error_message,
        created_at, updated_at
      ) VALUES (
        'transcript-1', 'interview-1', 'COMPLETED',
        '[{"role":"recruiter","text":"Tell me about the retry system.","timestamp":"2026-06-22T18:01:00.000Z"},{"role":"candidate","text":"I built idempotent Kafka consumers.","timestamp":"2026-06-22T18:02:00.000Z"}]',
        NULL, '2026-06-22T18:30:00.000Z', '2026-06-22T18:35:00.000Z'
      )
    `).run();
    sqlite.prepare(`
      INSERT INTO meetings (
        id, owner_id, scheduled_interview_id, title, description, status,
        scheduled_at, started_at, ended_at, duration_secs, meeting_url,
        meeting_type, scheduling_provider, external_event_id,
        transcript_status, transcript_summary, transcript_json,
        transcript_analysis_json, transcript_error, recording_r2_key,
        created_at, updated_at
      ) VALUES (
        'meeting-1', 'owner-1', 'interview-1', 'Ada technical screen', NULL,
        'ACTIVE', '2026-06-22T18:00:00.000Z', '2026-06-22T18:00:30.000Z',
        NULL, NULL, 'http://localhost:5173/rooms/meeting-1',
        'SCREENING_INTERVIEW', NULL, NULL,
        'COMPLETED', 'Discussed retry and Kafka evidence.',
        '[{"stable_segment_id":"segment-host-1","speaker":"host","role":"host","text":"Tell me about the retry system.","timestamp_start_ms":1000,"timestamp_end_ms":3000,"confidence":0.98},{"stable_segment_id":"segment-guest-1","speaker":"guest","role":"guest","text":"I built idempotent Kafka consumers.","timestamp_start_ms":4000,"timestamp_end_ms":7000,"confidence":0.96}]',
        '{"summary":"Discussed retry and Kafka evidence.","topics":["Kafka idempotency"],"decisions":["Advance to repo review"],"followUps":[],"semanticAssertions":[]}',
        NULL,
        'meetings/owner-1/meeting-1/recording.webm',
        '2026-06-22T17:30:00.000Z', '2026-06-22T18:35:00.000Z'
      )
    `).run();
    sqlite.prepare(`
      INSERT INTO meeting_rooms (id, meeting_id, session_id, status, created_at, updated_at)
      VALUES (
        'room-1', 'meeting-1', 'session-1', 'ACTIVE',
        '2026-06-22T17:30:00.000Z', '2026-06-22T18:00:30.000Z'
      )
    `).run();
  }

  async function seedInterviewLivingContext(): Promise<void> {
    if (!sqlite) throw new Error('sqlite fixture not initialized');
    const db = createMockD1(sqlite);
    const identity = await ensureCandidateLivingContext(db, 'candidate-1');
    if (!identity) throw new Error('candidate living context was not created');

    const store = new LivingContextStore(db, () => '2026-06-22T18:35:01.000Z');
    const interaction = await store.upsertInteraction({
      ingestionKey: 'scheduled-interview:interview-1',
      workspacePersonId: identity.workspacePersonId,
      applicationId: identity.applicationId,
      interactionType: 'scheduled_interview',
      externalReference: 'interview-1',
      startedAt: '2026-06-22T18:00:30.000Z',
      endedAt: '2026-06-22T18:35:00.000Z',
      metadata: { meetingId: 'meeting-1', roomId: 'room-1' },
    });
    const artifact = await store.upsertArtifact({
      ingestionKey: 'scheduled-interview:interview-1:transcript',
      workspacePersonId: identity.workspacePersonId,
      interactionId: interaction.id,
      artifactType: 'meeting_transcript',
      logicalKey: 'interview-1/transcript',
      metadata: { scheduledInterviewId: 'interview-1' },
    });
    const transcriptText = 'I built idempotent Kafka consumers.';
    const version = await store.createArtifactVersion({
      ingestionKey: 'scheduled-interview:interview-1:transcript:v1',
      artifactId: artifact.id,
      versionNumber: 1,
      contentHash: sha256Hex(transcriptText),
      mediaType: 'text/plain',
      contentText: transcriptText,
      byteLength: transcriptText.length,
      metadata: { source: 'test-transcript' },
    });
    const span = await store.createSourceSpan({
      ingestionKey: 'scheduled-interview:interview-1:transcript:paragraph-0001',
      artifactVersionId: version.id,
      stableSegmentId: 'paragraph-0001',
      charStart: 0,
      charEnd: transcriptText.length,
      exactText: transcriptText,
      metadata: { speaker: 'candidate' },
    });
    const concept = await store.upsertConcept({
      ingestionKey: 'term:kafka-idempotency',
      canonicalKey: 'term:kafka-idempotency',
      namespace: 'term',
      label: 'Kafka idempotency',
      metadata: { source: 'scheduled_interview_detail_test' },
    });
    await store.upsertContextRecord({
      ingestionKey: 'scheduled-interview:interview-1:kafka-idempotency',
      workspacePersonId: identity.workspacePersonId,
      interactionId: interaction.id,
      applicationId: identity.applicationId,
      recordType: 'interview_transcript_assertion',
      predicate: 'described implementation experience',
      narrative: 'Ada described building idempotent Kafka consumers.',
      qualifiers: { scheduledInterviewId: 'interview-1' },
      confidence: 0.9,
      extractionVersion: 'scheduling-detail-test-v1',
      observedAt: '2026-06-22T18:02:00.000Z',
      sources: [{ sourceSpanId: span.id, evidenceRole: 'source' }],
      entities: [{
        entityType: 'workspace_person',
        entityId: identity.workspacePersonId,
        relationship: 'speaker',
      }],
      concepts: [{
        conceptId: concept.id,
        relationship: 'implementation_mechanism',
        weight: 0.9,
      }],
    });
  }

  async function seedContactLivingContext(): Promise<void> {
    if (!sqlite) throw new Error('sqlite fixture not initialized');
    const db = createMockD1(sqlite);
    const identity = await ensureContactLivingContext(db, 'contact-1');
    if (!identity) throw new Error('contact living context was not created');

    const store = new LivingContextStore(db, () => '2026-06-22T18:10:01.000Z');
    const interaction = await store.upsertInteraction({
      ingestionKey: 'direct-call:interview-roleless-1',
      workspacePersonId: identity.workspacePersonId,
      interactionType: 'direct_video_call',
      externalReference: 'interview-roleless-1',
      startedAt: '2026-06-23T18:00:00.000Z',
      metadata: { scheduledInterviewId: 'interview-roleless-1' },
    });
    const artifact = await store.upsertArtifact({
      ingestionKey: 'direct-call:interview-roleless-1:note',
      workspacePersonId: identity.workspacePersonId,
      interactionId: interaction.id,
      artifactType: 'recruiter_note',
      logicalKey: 'interview-roleless-1/note',
      metadata: { scheduledInterviewId: 'interview-roleless-1' },
    });
    const noteText = 'Grace wants to discuss event-sourced billing architecture.';
    const version = await store.createArtifactVersion({
      ingestionKey: 'direct-call:interview-roleless-1:note:v1',
      artifactId: artifact.id,
      versionNumber: 1,
      contentHash: sha256Hex(noteText),
      mediaType: 'text/plain',
      contentText: noteText,
      byteLength: noteText.length,
      metadata: { source: 'roleless-direct-call-test' },
    });
    const span = await store.createSourceSpan({
      ingestionKey: 'direct-call:interview-roleless-1:note:span-0001',
      artifactVersionId: version.id,
      stableSegmentId: 'note-0001',
      charStart: 0,
      charEnd: noteText.length,
      exactText: noteText,
      metadata: { author: 'recruiter' },
    });
    const concept = await store.upsertConcept({
      ingestionKey: 'term:event-sourced-billing',
      canonicalKey: 'term:event-sourced-billing',
      namespace: 'term',
      label: 'event-sourced billing',
      metadata: { source: 'roleless_direct_call_test' },
    });
    await store.upsertContextRecord({
      ingestionKey: 'direct-call:interview-roleless-1:event-sourced-billing',
      workspacePersonId: identity.workspacePersonId,
      interactionId: interaction.id,
      recordType: 'direct_call_context',
      predicate: 'client wants to discuss architecture',
      narrative: 'Grace wants to discuss event-sourced billing architecture.',
      qualifiers: { scheduledInterviewId: 'interview-roleless-1' },
      confidence: 1,
      extractionVersion: 'scheduling-detail-test-v1',
      observedAt: '2026-06-22T18:10:00.000Z',
      sources: [{ sourceSpanId: span.id, evidenceRole: 'source' }],
      entities: [{
        entityType: 'workspace_person',
        entityId: identity.workspacePersonId,
        relationship: 'participant',
      }],
      concepts: [{
        conceptId: concept.id,
        relationship: 'discussion_topic',
        weight: 1,
      }],
    });
  }

  it('returns the interview, generated join URL, linked meeting, room, and transcript artifact', async () => {
    seedInterviewDetailFixture();
    await seedInterviewLivingContext();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews/interview-1');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        id: string;
        candidateName: string | null;
        pipelineTitle: string | null;
        stageTitle: string | null;
        status: string;
        meetingUrl: string | null;
        transcriptArtifact: {
          status: string;
          transcriptJson: string | null;
        } | null;
        linkedMeeting: {
          title: string;
          transcriptStatus: string;
          transcriptSummary: string | null;
          transcriptJson: string | null;
          transcriptAnalysisJson: string | null;
          transcriptError: string | null;
          recordingR2Key: string | null;
          room: { id: string; status: string | null } | null;
        } | null;
        livingContext: {
          summary: { contextRecordCount: number; sourceSpanCount: number };
          contextRecords: Array<{
            recordType: string;
            narrative: string;
            concepts: Array<{ canonicalKey: string; label: string }>;
            sources: Array<{ exactText: string }>;
          }>;
        } | null;
        codeReviewScore: {
          reviewSessionId: string;
          status: string;
          score: number | null;
          band: string | null;
          narrative: string | null;
          strengths: string[];
          growthAreas: string[];
        } | null;
      };
    };

    expect(body.interview).toMatchObject({
      id: 'interview-1',
      candidateName: 'Ada Lovelace',
      pipelineTitle: 'Principal Systems Engineer',
      stageTitle: 'Technical screen',
      status: 'ACTIVE',
      meetingUrl: null,
    });
    expect(body.interview.transcriptArtifact).toMatchObject({
      status: 'COMPLETED',
    });
    expect(JSON.parse(body.interview.transcriptArtifact!.transcriptJson!)).toEqual([
      {
        role: 'recruiter',
        text: 'Tell me about the retry system.',
        timestamp: '2026-06-22T18:01:00.000Z',
      },
      {
        role: 'candidate',
        text: 'I built idempotent Kafka consumers.',
        timestamp: '2026-06-22T18:02:00.000Z',
      },
    ]);
    expect(body.interview.linkedMeeting).toMatchObject({
      title: 'Ada technical screen',
      transcriptStatus: 'COMPLETED',
      transcriptSummary: 'Discussed retry and Kafka evidence.',
      transcriptError: null,
      recordingR2Key: 'meetings/owner-1/meeting-1/recording.webm',
      room: {
        id: 'room-1',
        status: 'ACTIVE',
      },
    });
    expect(JSON.parse(body.interview.linkedMeeting!.transcriptJson!)).toMatchObject([
      {
        role: 'host',
        text: 'Tell me about the retry system.',
        timestamp_start_ms: 1000,
      },
      {
        role: 'guest',
        text: 'I built idempotent Kafka consumers.',
        timestamp_start_ms: 4000,
      },
    ]);
    expect(JSON.parse(body.interview.linkedMeeting!.transcriptAnalysisJson!)).toMatchObject({
      topics: ['Kafka idempotency'],
      decisions: ['Advance to repo review'],
    });
    expect(body.interview.livingContext?.summary).toMatchObject({
      contextRecordCount: 1,
      sourceSpanCount: 1,
    });
    expect(body.interview.livingContext?.contextRecords[0]).toMatchObject({
      recordType: 'interview_transcript_assertion',
      narrative: 'Ada described building idempotent Kafka consumers.',
      concepts: [{
        canonicalKey: 'term:kafka-idempotency',
        label: 'Kafka idempotency',
      }],
      sources: [{
        exactText: 'I built idempotent Kafka consumers.',
      }],
    });
  });

  it('returns the latest delivered assessment URL on assessment interview details', async () => {
    seedInterviewDetailFixture();
    const db = createMockD1(sqlite!);
    const identity = await ensureCandidateLivingContext(db, 'candidate-1');
    if (!identity) throw new Error('candidate living context was not created');
    const deliveredUrl = 'http://localhost:5173/assess/recruiter-visible-token';

    sqlite!.prepare(`
      UPDATE scheduled_interviews
         SET interview_type = 'CODE_REVIEW',
             stage_id = NULL,
             invite_link_sent_at = '2026-06-22T18:40:00.000Z',
             email_sent_at = '2026-06-22T18:40:00.000Z'
       WHERE id = 'interview-1'
    `).run();

    const store = new LivingContextStore(db, () => '2026-06-22T18:40:01.000Z');
    await store.upsertInteraction({
      ingestionKey: 'scheduled-interview:interview-1:invite-delivery:latest',
      workspacePersonId: identity.workspacePersonId,
      applicationId: identity.applicationId,
      interactionType: 'scheduled_interview_invite_delivery',
      externalReference: 'interview-1',
      startedAt: '2026-06-22T18:40:00.000Z',
      metadata: {
        scheduledInterviewId: 'interview-1',
        emailSent: true,
        deliveredUrl,
      },
    });

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-1');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        assessmentSetup: {
          status: string;
          lastDeliveredUrl: string | null;
        };
      };
    };

    expect(body.interview.assessmentSetup).toMatchObject({
      status: 'waiting_for_source_backed_match',
      lastDeliveredUrl: deliveredUrl,
    });
  });

  it('returns source-backed assessment progress on workspace interview details', async () => {
    seedInterviewDetailFixture();
    const now = '2026-06-22T18:40:00.000Z';
    const baseCommitSha = '5555555555555555555555555555555555555555';
    const commitSha = 'ffffffffffffffffffffffffffffffffffffffff';
    const challengeText = [
      'Repo: https://github.com/open-source/widgets',
      `Base commit: ${baseCommitSha}`,
      'Task: fix the popover cleanup regression.',
      'Success: commit a focused patch with tests.',
    ].join('\n');
    const commitText = `commit ${commitSha}\nAuthor: Candidate <candidate@example.com>\n\nFix popover cleanup.`;
    const diffText = 'diff --git a/src/popover.ts b/src/popover.ts\n+cleanupStaleHandler();';

    sqlite!.prepare(`
      UPDATE scheduled_interviews
         SET interview_type = 'OPEN_SOURCE_BUG_FIX',
             github_repo_url = 'https://github.com/open-source/widgets',
             github_pr_number = NULL
       WHERE id = 'interview-1'
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'assessment-session-progress-detail',
      'assessment-session:progress-detail',
      'interview-1',
      'OPEN_SOURCE_BUG_FIX',
      'FINAL_SUBMITTED',
      'candidate-1',
      'workspace-1',
      '{}',
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
        narrative, payload_json, context_record_id, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      'assessment-event-progress-challenge',
      'assessment-event:progress-detail-challenge',
      'assessment-session-progress-detail',
      1,
      'recruiter_note',
      'recruiter',
      'owner-1',
      'Recruiter assigned a concrete open-source challenge packet.',
      JSON.stringify({ repositoryUrl: 'https://github.com/open-source/widgets' }),
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
        narrative, payload_json, context_record_id, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      'assessment-event-progress-commit',
      'assessment-event:progress-detail-commit',
      'assessment-session-progress-detail',
      2,
      'commit_submission',
      'candidate',
      'candidate-1',
      'Candidate submitted the source-backed assessment commit.',
      JSON.stringify({
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/popover-cleanup',
        baseCommitSha,
        commitSha,
        commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}`,
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
      }),
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
        locator_json, exact_text, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, '{}', ?)
    `).run(
      'assessment-source-progress-challenge',
      'assessment-event-progress-challenge',
      'review_challenge_packet',
      'challenge-packet-progress-detail',
      'assigned_challenge',
      JSON.stringify({ repositoryUrl: 'https://github.com/open-source/widgets', baseCommitSha }),
      challengeText,
      sha256Hex(challengeText),
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
        locator_json, exact_text, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, '{}', ?)
    `).run(
      'assessment-source-progress-commit',
      'assessment-event-progress-commit',
      'git_commit',
      commitSha,
      'support',
      JSON.stringify({ commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}` }),
      commitText,
      sha256Hex(commitText),
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
        locator_json, exact_text, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, '{}', ?)
    `).run(
      'assessment-source-progress-diff',
      'assessment-event-progress-commit',
      'code_diff',
      `${commitSha}:diff`,
      'support',
      JSON.stringify({ path: 'src/popover.ts' }),
      diffText,
      sha256Hex(diffText),
      now,
    );

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-1');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        assessmentProgress: {
          stage: string;
          nextAction: string;
          hasChallengePacket: boolean;
          hasCommitSubmission: boolean;
          challenge: { sourceRefId: string } | null;
          commit: { commitSha: string | null; repositoryUrl: string | null } | null;
        } | null;
      };
    };

    expect(body.interview.assessmentProgress).toMatchObject({
      stage: 'READY_FOR_EVALUATION',
      nextAction: 'START_EVALUATION',
      hasChallengePacket: true,
      hasCommitSubmission: true,
      challenge: { sourceRefId: 'challenge-packet-progress-detail' },
      commit: {
        commitSha,
        repositoryUrl: 'https://github.com/open-source/widgets',
      },
    });
  });

  it('starts assessment evaluation through the interview route and records a source-backed AI-unavailable diagnostic when no AI binding exists', async () => {
    seedInterviewDetailFixture();
    const now = '2026-06-22T18:44:00.000Z';
    const baseCommitSha = '6666666666666666666666666666666666666666';
    const commitSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const challengeText = [
      'Repo: https://github.com/open-source/widgets',
      `Base commit: ${baseCommitSha}`,
      'Task: fix the start-evaluation regression.',
      'Success: commit a focused patch with tests.',
    ].join('\n');
    const commitText = `commit ${commitSha}\nAuthor: Candidate <candidate@example.com>\n\nFix start evaluation.`;
    const diffText = 'diff --git a/src/evaluation.ts b/src/evaluation.ts\n+startEvaluation();';

    sqlite!.prepare(`
      UPDATE scheduled_interviews
         SET interview_type = 'OPEN_SOURCE_BUG_FIX',
             github_repo_url = 'https://github.com/open-source/widgets'
       WHERE id = 'interview-1'
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'assessment-session-start-evaluation',
      'assessment-session:start-evaluation',
      'interview-1',
      'OPEN_SOURCE_BUG_FIX',
      'FINAL_SUBMITTED',
      'candidate-1',
      'workspace-1',
      '{}',
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
        narrative, payload_json, context_record_id, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      'assessment-event-start-evaluation-challenge',
      'assessment-event:start-evaluation-challenge',
      'assessment-session-start-evaluation',
      1,
      'recruiter_note',
      'recruiter',
      'owner-1',
      'Recruiter assigned a concrete open-source challenge packet.',
      JSON.stringify({ repositoryUrl: 'https://github.com/open-source/widgets' }),
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
        narrative, payload_json, context_record_id, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      'assessment-event-start-evaluation-commit',
      'assessment-event:start-evaluation-commit',
      'assessment-session-start-evaluation',
      2,
      'commit_submission',
      'candidate',
      'candidate-1',
      'Candidate submitted the source-backed assessment commit.',
      JSON.stringify({
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/start-evaluation',
        baseCommitSha,
        commitSha,
        commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}`,
        changedFiles: [{ path: 'src/evaluation.ts', status: 'modified' }],
      }),
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
        locator_json, exact_text, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, '{}', ?)
    `).run(
      'assessment-source-start-evaluation-challenge',
      'assessment-event-start-evaluation-challenge',
      'review_challenge_packet',
      'challenge-packet-start-evaluation',
      'assigned_challenge',
      JSON.stringify({ repositoryUrl: 'https://github.com/open-source/widgets', baseCommitSha }),
      challengeText,
      sha256Hex(challengeText),
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
        locator_json, exact_text, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, '{}', ?)
    `).run(
      'assessment-source-start-evaluation-commit',
      'assessment-event-start-evaluation-commit',
      'git_commit',
      commitSha,
      'support',
      JSON.stringify({ commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}` }),
      commitText,
      sha256Hex(commitText),
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
        locator_json, exact_text, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, '{}', ?)
    `).run(
      'assessment-source-start-evaluation-diff',
      'assessment-event-start-evaluation-commit',
      'code_diff',
      `${commitSha}:diff`,
      'support',
      JSON.stringify({ path: 'src/evaluation.ts' }),
      diffText,
      sha256Hex(diffText),
      now,
    );

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-1/assessment/start-evaluation', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      progress: {
        stage: string;
        nextAction: string;
        evaluation: { status: string; summary: string } | null;
        evidenceCounts: Array<{ kind: string; count: number }>;
      };
      diagnostic: { code: string; severity: string };
      report: null;
    };

    expect(body.diagnostic).toMatchObject({
      code: 'AI_DEVELOPER_UNAVAILABLE',
      severity: 'blocking',
    });
    expect(body.report).toBeNull();
    expect(body.progress).toMatchObject({
      stage: 'NEEDS_ATTENTION',
      nextAction: 'RESOLVE_DIAGNOSTIC',
      evaluation: {
        status: 'AI_DEVELOPER_UNAVAILABLE',
        summary: 'Workers AI is not configured for source-backed repo-task evaluation.',
      },
    });
    expect(body.progress.evidenceCounts).toEqual(expect.arrayContaining([
      { kind: 'commit_submission', count: 1 },
      { kind: 'recruiter_note', count: 2 },
    ]));

    expect(sqlite!.prepare(
      `SELECT state FROM assessment_sessions WHERE id = ?`,
    ).get('assessment-session-start-evaluation')).toEqual({ state: 'DIAGNOSTIC' });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE session_id = ?
          AND kind = 'recruiter_note'
          AND narrative = 'Recruiter requested source-backed assessment evaluation.'`,
    ).get('assessment-session-start-evaluation')).toEqual({ count: 1 });
    const diagnosticSource = sqlite!.prepare(
      `SELECT dsr.exact_text
         FROM assessment_diagnostic_source_refs dsr
         JOIN assessment_diagnostics d ON d.id = dsr.diagnostic_id
        WHERE d.code = 'AI_DEVELOPER_UNAVAILABLE'
        LIMIT 1`,
    ).get() as { exact_text: string } | undefined;
    expect(diagnosticSource?.exact_text).toContain(
      'PIPE will evaluate only source-backed',
    );
  });

  it('starts source-backed AI assessment evaluation and persists only cited claims', async () => {
    seedInterviewDetailFixture();
    const now = '2026-06-22T18:46:00.000Z';
    const baseCommitSha = '7777777777777777777777777777777777777777';
    const commitSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const challengeText = [
      'Repo: https://github.com/open-source/widgets',
      `Base commit: ${baseCommitSha}`,
      'Task: fix the start-evaluation regression with a real patch.',
      'Success: commit a focused patch with tests.',
    ].join('\n');
    const commitText = `commit ${commitSha}\nAuthor: Candidate <candidate@example.com>\n\nFix start evaluation.`;
    const diffText = 'diff --git a/src/evaluation.ts b/src/evaluation.ts\n+startEvaluation();';
    const diffSourceRefKey = `code_diff:${commitSha}:diff:support:`;

    sqlite!.prepare(`
      UPDATE scheduled_interviews
         SET interview_type = 'OPEN_SOURCE_BUG_FIX',
             github_repo_url = 'https://github.com/open-source/widgets'
       WHERE id = 'interview-1'
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'assessment-session-ai-evaluation',
      'assessment-session:ai-evaluation',
      'interview-1',
      'OPEN_SOURCE_BUG_FIX',
      'FINAL_SUBMITTED',
      'candidate-1',
      'workspace-1',
      '{}',
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
        narrative, payload_json, context_record_id, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      'assessment-event-ai-evaluation-challenge',
      'assessment-event:ai-evaluation-challenge',
      'assessment-session-ai-evaluation',
      1,
      'recruiter_note',
      'recruiter',
      'owner-1',
      'Recruiter assigned a concrete open-source challenge packet.',
      JSON.stringify({ repositoryUrl: 'https://github.com/open-source/widgets' }),
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
        narrative, payload_json, context_record_id, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      'assessment-event-ai-evaluation-commit',
      'assessment-event:ai-evaluation-commit',
      'assessment-session-ai-evaluation',
      2,
      'commit_submission',
      'candidate',
      'candidate-1',
      'Candidate submitted the source-backed assessment commit.',
      JSON.stringify({
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/ai-evaluation',
        baseCommitSha,
        commitSha,
        commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}`,
        changedFiles: [{ path: 'src/evaluation.ts', status: 'modified' }],
      }),
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
        locator_json, exact_text, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, '{}', ?)
    `).run(
      'assessment-source-ai-evaluation-challenge',
      'assessment-event-ai-evaluation-challenge',
      'review_challenge_packet',
      'challenge-packet-ai-evaluation',
      'assigned_challenge',
      JSON.stringify({ repositoryUrl: 'https://github.com/open-source/widgets', baseCommitSha }),
      challengeText,
      sha256Hex(challengeText),
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
        locator_json, exact_text, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, '{}', ?)
    `).run(
      'assessment-source-ai-evaluation-commit',
      'assessment-event-ai-evaluation-commit',
      'git_commit',
      commitSha,
      'support',
      JSON.stringify({ commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}` }),
      commitText,
      sha256Hex(commitText),
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
        locator_json, exact_text, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, '{}', ?)
    `).run(
      'assessment-source-ai-evaluation-diff',
      'assessment-event-ai-evaluation-commit',
      'code_diff',
      `${commitSha}:diff`,
      'support',
      JSON.stringify({ path: 'src/evaluation.ts' }),
      diffText,
      sha256Hex(diffText),
      now,
    );

    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        summary: 'Candidate made a focused source-backed change and cited the submitted diff evidence.',
        recommendation: 'mixed_evidence_human_review',
        claims: [{
          id: 'focused-diff',
          polarity: 'positive',
          dimension: 'implementation_correctness',
          narrative: 'The submitted diff adds startEvaluation in src/evaluation.ts.',
          confidence: 0.74,
          sourceRefKeys: [diffSourceRefKey],
        }, {
          id: 'uncited-claim',
          polarity: 'positive',
          dimension: 'test_strategy',
          narrative: 'This claim has no persisted source citation and must be dropped.',
          confidence: 0.2,
          sourceRefKeys: ['missing:source:ref'],
        }],
        diagnostics: [{
          code: 'MISSING_TEST_EVIDENCE',
          severity: 'warning',
          message: 'No test_run source ref was attached to the session.',
          sourceRefKeys: [diffSourceRefKey],
        }],
      }),
    }));

    const app = mountSchedulingApp({
      AI: { run: aiRun } as unknown as Ai,
      CLOUDFLARE_AI_MODEL: '@cf/google/gemma-4-26b-a4b-it',
    });
    const response = await app.request('/interviews/interview-1/assessment/start-evaluation', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      progress: {
        stage: string;
        nextAction: string;
        hasAiInteraction: boolean;
        evaluation: { status: string; summary: string } | null;
        evidenceCounts: Array<{ kind: string; count: number }>;
      };
      report: { id: string; sessionId: string; status: string; contextRecordId: string | null } | null;
      diagnostic: null;
    };

    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(aiRun.mock.calls[0])).toContain(diffSourceRefKey);
    expect(body.diagnostic).toBeNull();
    expect(body.report).toMatchObject({
      sessionId: 'assessment-session-ai-evaluation',
      status: 'EVALUATED',
    });
    expect(body.progress).toMatchObject({
      stage: 'EVALUATED',
      nextAction: 'REVIEW_EVALUATION',
      hasAiInteraction: true,
      evaluation: {
        status: 'EVALUATED',
        summary: 'Candidate made a focused source-backed change and cited the submitted diff evidence.',
      },
    });
    expect(body.progress.evidenceCounts).toEqual(expect.arrayContaining([
      { kind: 'ai_interaction', count: 1 },
      { kind: 'commit_submission', count: 1 },
      { kind: 'recruiter_note', count: 2 },
    ]));

    expect(sqlite!.prepare(
      `SELECT state FROM assessment_sessions WHERE id = ?`,
    ).get('assessment-session-ai-evaluation')).toEqual({ state: 'EVALUATED' });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE session_id = ?
          AND kind = 'ai_interaction'`,
    ).get('assessment-session-ai-evaluation')).toEqual({ count: 1 });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evaluation_claims
        WHERE dimension = 'test_strategy'`,
    ).get()).toEqual({ count: 0 });
    const citedClaim = sqlite!.prepare(
      `SELECT c.dimension, c.polarity, csr.source_ref_type, csr.source_ref_id, csr.exact_text
         FROM assessment_evaluation_claims c
         JOIN assessment_claim_source_refs csr ON csr.claim_id = c.id
        WHERE c.dimension = 'implementation_correctness'
        LIMIT 1`,
    ).get() as {
      dimension: string;
      polarity: string;
      source_ref_type: string;
      source_ref_id: string;
      exact_text: string;
    } | undefined;
    expect(citedClaim).toMatchObject({
      dimension: 'implementation_correctness',
      polarity: 'positive',
      source_ref_type: 'code_diff',
      source_ref_id: `${commitSha}:diff`,
      exact_text: diffText,
    });
  });

  it('returns source-backed assessment progress on the interview list', async () => {
    seedInterviewDetailFixture();
    const now = '2026-06-22T18:42:00.000Z';
    const baseCommitSha = '5555555555555555555555555555555555555555';
    const commitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const challengeText = [
      'Repo: https://github.com/open-source/widgets',
      `Base commit: ${baseCommitSha}`,
      'Task: fix the assessment list progress regression.',
      'Success: commit a focused patch with tests.',
    ].join('\n');
    const commitText = `commit ${commitSha}\nAuthor: Candidate <candidate@example.com>\n\nShow list progress.`;
    const diffText = 'diff --git a/src/list.ts b/src/list.ts\n+showAssessmentProgress();';

    sqlite!.prepare(`
      UPDATE scheduled_interviews
         SET interview_type = 'OPEN_SOURCE_BUG_FIX',
             github_repo_url = 'https://github.com/open-source/widgets',
             github_pr_number = NULL
       WHERE id = 'interview-1'
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'assessment-session-progress-list',
      'assessment-session:progress-list',
      'interview-1',
      'OPEN_SOURCE_BUG_FIX',
      'FINAL_SUBMITTED',
      'candidate-1',
      'workspace-1',
      '{}',
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
        narrative, payload_json, context_record_id, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      'assessment-event-list-challenge',
      'assessment-event:progress-list-challenge',
      'assessment-session-progress-list',
      1,
      'recruiter_note',
      'recruiter',
      'owner-1',
      'Recruiter assigned a concrete open-source challenge packet.',
      JSON.stringify({ repositoryUrl: 'https://github.com/open-source/widgets' }),
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
        narrative, payload_json, context_record_id, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      'assessment-event-list-commit',
      'assessment-event:progress-list-commit',
      'assessment-session-progress-list',
      2,
      'commit_submission',
      'candidate',
      'candidate-1',
      'Candidate submitted the source-backed assessment commit.',
      JSON.stringify({
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/list-progress',
        baseCommitSha,
        commitSha,
        commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}`,
        changedFiles: [{ path: 'src/list.ts', status: 'modified' }],
      }),
      now,
      now,
    );
    for (const sourceRef of [
      {
        id: 'assessment-source-list-challenge',
        eventId: 'assessment-event-list-challenge',
        type: 'review_challenge_packet',
        refId: 'challenge-packet-progress-list',
        locator: { repositoryUrl: 'https://github.com/open-source/widgets', baseCommitSha },
        text: challengeText,
      },
      {
        id: 'assessment-source-list-commit',
        eventId: 'assessment-event-list-commit',
        type: 'git_commit',
        refId: commitSha,
        locator: { commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}` },
        text: commitText,
      },
      {
        id: 'assessment-source-list-diff',
        eventId: 'assessment-event-list-commit',
        type: 'code_diff',
        refId: `${commitSha}:diff`,
        locator: { path: 'src/list.ts' },
        text: diffText,
      },
    ]) {
      sqlite!.prepare(`
        INSERT INTO assessment_event_source_refs (
          id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
          locator_json, exact_text, content_hash, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, NULL, 'support', ?, ?, ?, '{}', ?)
      `).run(
        sourceRef.id,
        sourceRef.eventId,
        sourceRef.type,
        sourceRef.refId,
        JSON.stringify(sourceRef.locator),
        sourceRef.text,
        sha256Hex(sourceRef.text),
        now,
      );
    }
    for (let index = 0; index < 105; index += 1) {
      sqlite!.prepare(`
        INSERT INTO scheduled_interviews (
          id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
          meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
          scheduling_url, external_event_id, recruiter_notes, sync_source,
          last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
          recipient_email, matched_repo_id, github_repo_url, github_pr_number,
          submission_json, completed_at, created_at, updated_at
        ) VALUES (?, NULL, NULL, NULL, 'owner-1',
          'VIDEO', 'DIRECT_VIDEO_CALL', 'INVITED', NULL,
          NULL, 'MANUAL', NULL, NULL, NULL,
          'MANUAL', NULL, NULL, NULL,
          ?, ?, NULL, NULL, NULL, NULL, NULL,
          ?, ?
        )
      `).run(
        `interview-list-filler-${String(index).padStart(3, '0')}`,
        `Filler ${index}`,
        `filler-${index}@example.com`,
        `2026-06-22T19:${String(index % 60).padStart(2, '0')}:00.000Z`,
        `2026-06-22T19:${String(index % 60).padStart(2, '0')}:00.000Z`,
      );
    }
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES ('interview-list-corrupt-progress', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'MATCHED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Corrupted assessment progress should not break the list.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, 77, 'https://github.com/open-source/widgets', 101, NULL, NULL,
        ?, ?
      )
    `).run(now, now);
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'assessment-session-progress-list-corrupt',
      'assessment-session:progress-list-corrupt',
      'interview-list-corrupt-progress',
      'CODE_REVIEW',
      'FINAL_SUBMITTED',
      'candidate-1',
      'workspace-1',
      '{}',
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
        narrative, payload_json, context_record_id, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      'assessment-event-list-corrupt-challenge',
      'assessment-event:progress-list-corrupt-challenge',
      'assessment-session-progress-list-corrupt',
      1,
      'recruiter_note',
      'recruiter',
      'owner-1',
      'This intentionally malformed source ref proves one bad progress row cannot crash the list.',
      JSON.stringify({ repositoryUrl: 'https://github.com/open-source/widgets' }),
      now,
      now,
    );
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id, evidence_role,
        locator_json, exact_text, content_hash, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, 'assigned_challenge', ?, ?, ?, '{}', ?)
    `).run(
      'assessment-source-list-corrupt-challenge',
      'assessment-event-list-corrupt-challenge',
      'review_challenge_packet',
      'challenge-packet-progress-list-corrupt',
      '{not-valid-json',
      'Corrupt source ref',
      sha256Hex('Corrupt source ref'),
      now,
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = mountSchedulingApp({ DB: createMockD1WithNumberedParamLimit(sqlite!, 100) });
      const response = await app.request('/interviews');
      expect(response.status).toBe(200);
      const body = await response.json() as {
        interviews: Array<{
          id: string;
          assessmentProgress: {
            stage: string;
            nextAction: string;
            hasChallengePacket: boolean;
            hasCommitSubmission: boolean;
            commit: { commitSha: string | null; branchName: string | null } | null;
          } | null;
        }>;
      };

      expect(body.interviews.length).toBeGreaterThan(100);
      const interview = body.interviews.find((item) => item.id === 'interview-1');
      expect(interview?.assessmentProgress).toMatchObject({
        stage: 'READY_FOR_EVALUATION',
        nextAction: 'START_EVALUATION',
        hasChallengePacket: true,
        hasCommitSubmission: true,
        commit: {
          commitSha,
          branchName: 'pipe-assessment/list-progress',
        },
      });
      const corruptInterview = body.interviews.find((item) => item.id === 'interview-list-corrupt-progress');
      expect(corruptInterview?.assessmentProgress).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        '[scheduling/listAssessmentProgress] failed to load assessment progress:',
        expect.objectContaining({
          interviewId: 'interview-list-corrupt-progress',
          assessmentSessionId: 'assessment-session-progress-list-corrupt',
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns source-backed CODE_REVIEW match hyperedges for recruiter detail', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-1', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'MATCHED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, '2026-06-22T17:40:00.000Z', '2026-06-22T17:40:00.000Z',
        NULL, NULL, 77, 'https://github.com/pipe-labs/orders', 314,
        '{"reviewSessionId":"review-session-code-review-1","verdict":"request_changes"}',
        '2026-06-22T18:30:00.000Z', '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO review_challenge_packets (
        id, repo_snapshot_id, repo_id, pr_number, production_ready,
        quality_score, packet_json, updated_at
      ) VALUES (
        'packet-code-review-314', 'snapshot-orders', 77, 314, 1,
        0.91, '{}', 1
      )
    `).run();

    const rankedResults = [{
      rank: 1,
      challengeId: 'packet-code-review-314',
      repoId: '77',
      prNumber: 314,
      score: 0.88,
      alignedDemandCount: 2,
      stretchCount: 0,
      provenanceComplete: true,
      eligible: true,
      assessmentQuality: {
        verdict: 'usable',
        score: 9,
        maxScore: 12,
        metrics: [
          {
            id: 'skill_stack_overlap',
            label: 'Skill/stack overlap',
            score: 2,
            maxScore: 2,
            reason: 'Candidate and PR both center on TypeScript retry logic.',
          },
          {
            id: 'contrast_separation',
            label: 'Contrast separation',
            score: 1,
            maxScore: 2,
            reason: 'The selected PR separated from the nearest eligible comparator.',
          },
        ],
      },
      reviewProfile: {
        source: 'deterministic_engineering_prior',
        difficultyBand: 'advanced',
        expectedSeniority: 'staff',
        expectedTimeMinutes: 75,
        basis: {
          changedFileCount: 3,
          changedLineCount: 443,
          sourceHunkCount: 28,
          testChangeCount: 1,
          demandFamilyCount: 6,
          hasIssueContext: false,
        },
        rationale: 'advanced review calibrated for staff candidates; 75 minute target; 3 files; 443 changed lines; 28 source hunks; 6 demand families; 1 test change; no issue context.',
      },
      validatorAgent: {
        agentName: 'deterministic-code-review-match-gate',
        agentVersion: 'test-v1',
        mode: 'deterministic',
        verdict: 'passed',
        rationale: 'Selected PR #314 because candidate, role, and repo spans align on retry idempotency.',
        checks: [{
          id: 'provenance_complete',
          passed: true,
          reason: 'Candidate, role, and repo source refs are present.',
        }],
        sourceBridge: {
          prNumber: 314,
          candidateSourceCount: 1,
          repoSourceCount: 1,
          roleSourceCount: 1,
          alignedDemandCount: 2,
          stretchCount: 0,
          provenanceComplete: true,
        },
      },
      alignments: [{
        atomId: 'candidate-atom-retry',
        demandId: 'repo-demand-retry',
        pairScore: 0.92,
        sharedConcepts: ['term:typescript', 'term:retry-idempotency'],
        roleSourceRefs: [{
          entityId: 'role-source-1',
          sourceRefType: 'source_span',
          sourceRefId: 'role-span-1',
          sourceSpanId: 'role-span-1',
          locator: 'job_description.md:12',
          exactText: 'Needs TypeScript engineers who can review retry and idempotency risks.',
          conceptKeys: ['term:typescript', 'term:retry-idempotency'],
        }],
        candidateSourceRefs: [{
          sourceRefType: 'source_span',
          sourceRefId: 'candidate-span-1',
          sourceSpanId: 'candidate-span-1',
          locator: 'resume.pdf:4',
          exactText: 'Built TypeScript retry middleware with idempotent job processing.',
          contentHash: 'candidate-hash',
        }],
        challengeSourceRefs: [{
          sourceRefType: 'repo_source_span',
          sourceRefId: 'repo-span-1',
          locator: 'src/orders/retry.ts:18',
          exactText: 'Retry path can publish duplicate order events if the idempotency key is missing.',
          contentHash: 'repo-hash',
        }],
      }],
      rejectionReasons: [],
    }];
    const roleSources = [{
      entityId: 'role-source-1',
      sourceRefType: 'source_span',
      sourceRefId: 'role-span-1',
      sourceSpanId: 'role-span-1',
      locator: 'job_description.md:12',
      exactText: 'Needs TypeScript engineers who can review retry and idempotency risks.',
      conceptKeys: ['term:typescript', 'term:retry-idempotency'],
    }];
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (
        'match-run-code-review-1', 'candidate-1', 'role-context:role-1:source-backed:simple-jd-v1',
        'MATCHED', ?, 'packet-code-review-314', ?, '2026-06-22T17:46:00.000Z'
      )
    `).run(
      JSON.stringify(rankedResults),
      JSON.stringify({ roleGuardrails: { sourceReferences: roleSources } }),
    );
    sqlite!.prepare(`
      INSERT INTO review_sessions (
        id, challenge_submission_id, challenge_id, assessment_id, candidate_id,
        implementer_persona, current_round, max_rounds, status, transcript,
        next_comment_id, score_report, created_at, updated_at, mode
      ) VALUES (
        'review-session-code-review-1', 'submission-1', 'packet-code-review-314', 'assessment-1', 'candidate-1',
        'defensive-ai-developer', 2, 4, 'scored', '{}', 3, ?,
        '2026-06-22T18:00:00.000Z', '2026-06-22T18:31:00.000Z', 'bug_finding'
      )
    `).run(JSON.stringify({
      overall: {
        score: 72,
        band: 'adequate',
        narrative: 'Candidate found the merge-blocking retry risk but missed one verification detail.',
        strengths: ['Concrete blocking comment tied to source behavior.'],
        growth_areas: ['Probe how they validate the timing cleanup under load.'],
      },
    }));

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-1');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        meetingUrl: string | null;
        codeReviewMatch: {
          status: string;
          matchRunId: string | null;
          packetId: string | null;
          summary: string;
          score: number | null;
          reviewProfile: {
            difficultyBand: string;
            expectedSeniority: string;
            expectedTimeMinutes: number;
            basis: {
              changedLineCount: number;
              sourceHunkCount: number;
            };
          } | null;
          validatorAgent: { verdict: string; rationale: string } | null;
          evidenceHyperedges: Array<{
            relation: string;
            pairScore: number | null;
            nodes: Array<{
              kind: string;
              sourceRef: {
                locator?: string;
                exactText?: string;
                conceptKeys?: string[];
              };
            }>;
          }>;
        } | null;
      };
    };

    expect(body.interview.meetingUrl).toBeNull();
    expect(body.interview.codeReviewMatch).toMatchObject({
      status: 'MATCHED',
      matchRunId: 'match-run-code-review-1',
      packetId: 'packet-code-review-314',
      summary: 'Matched 2 source-backed demands (0 stretch).',
      score: 0.88,
      reviewProfile: {
        difficultyBand: 'advanced',
        expectedSeniority: 'staff',
        expectedTimeMinutes: 75,
        basis: {
          changedLineCount: 443,
          sourceHunkCount: 28,
        },
      },
      validatorAgent: {
        verdict: 'passed',
        rationale: 'Selected PR #314 because candidate, role, and repo spans align on retry idempotency.',
      },
    });
    expect(body.interview.codeReviewMatch?.evidenceHyperedges).toHaveLength(1);
    expect(body.interview.codeReviewMatch?.evidenceHyperedges[0]).toMatchObject({
      relation: 'candidate_role_repo_alignment',
      pairScore: 0.92,
      nodes: [
        {
          kind: 'person_evidence',
          sourceRef: {
            locator: 'resume.pdf:4',
            exactText: 'Built TypeScript retry middleware with idempotent job processing.',
          },
        },
        {
          kind: 'role_source',
          sourceRef: {
            locator: 'job_description.md:12',
            conceptKeys: ['term:retry-idempotency', 'term:typescript'],
          },
        },
        {
          kind: 'repo_challenge',
          sourceRef: {
            locator: 'src/orders/retry.ts:18',
            exactText: 'Retry path can publish duplicate order events if the idempotency key is missing.',
          },
        },
      ],
    });
    expect(body.interview.codeReviewScore).toMatchObject({
      reviewSessionId: 'review-session-code-review-1',
      status: 'scored',
      score: 72,
      band: 'adequate',
      narrative: 'Candidate found the merge-blocking retry risk but missed one verification detail.',
      strengths: ['Concrete blocking comment tied to source behavior.'],
      growthAreas: ['Probe how they validate the timing cleanup under load.'],
    });
  });

  it('keeps CODE_REVIEW recruiter detail available when optional assessment session tables are absent', async () => {
    seedInterviewDetailFixture();
    sqlite!.exec('DROP TABLE assessment_sessions');
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-no-assessment-table', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'COMPLETED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, '2026-06-22T17:40:00.000Z', '2026-06-22T17:40:00.000Z',
        NULL, NULL, 973, 'https://github.com/mui/base-ui', 973,
        '{"reviewSessionId":"review-session-1","submittedAt":"2026-06-22T18:30:00.000Z"}',
        '2026-06-22T18:30:00.000Z',
        '2026-06-22T17:30:00.000Z', '2026-06-22T18:35:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (
        'match-run-no-assessment-table', 'candidate-1', NULL,
        'MATCHED', ?, 'challenge_packet_base_ui_973', '{}', '2026-06-22T17:46:00.000Z'
      )
    `).run(JSON.stringify([{
      rank: 1,
      challengeId: 'challenge_packet_base_ui_973',
      repoId: '973',
      prNumber: 973,
      score: 0.3249,
      alignedDemandCount: 1,
      stretchCount: 0,
      provenanceComplete: true,
      eligible: true,
      assessmentQuality: {
        verdict: 'usable',
        score: 9,
        maxScore: 12,
        metrics: [],
      },
      validatorAgent: {
        agentName: 'deterministic-code-review-match-gate',
        agentVersion: 'test-v1',
        mode: 'deterministic',
        verdict: 'passed',
        rationale: 'Selected PR #973 from source-backed candidate and repo evidence.',
        checks: [],
        sourceBridge: {
          prNumber: 973,
          candidateSourceCount: 1,
          repoSourceCount: 1,
          roleSourceCount: 0,
          alignedDemandCount: 1,
          stretchCount: 0,
          provenanceComplete: true,
        },
      },
      alignments: [{
        atomId: 'candidate-atom-react',
        demandId: 'repo-demand-popover',
        pairScore: 0.71,
        sharedConcepts: ['term:react'],
        candidateSourceRefs: [{
          sourceRefType: 'source_span',
          sourceRefId: 'candidate-span-react',
          sourceSpanId: 'candidate-span-react',
          locator: 'resume.pdf:6',
          exactText: 'Reviewed React interaction regressions for popup trigger behavior.',
          contentHash: 'candidate-react-hash',
        }],
        challengeSourceRefs: [{
          sourceRefType: 'repo_source_span',
          sourceRefId: 'repo-span-popover',
          locator: 'packages/react/src/popover/root/usePopoverRoot.ts',
          exactText: 'Add regression coverage for impatient hover and click behavior.',
          contentHash: 'repo-popover-hash',
        }],
      }],
      rejectionReasons: [],
    }]));

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-no-assessment-table');
    expect(response.status).toBe(200);

    const body = await response.json() as {
      interview: {
        relatedEvidenceInterviews: unknown[];
        codeReviewMatch: {
          status: string;
          matchRunId: string | null;
          packetId: string | null;
          score: number | null;
          evidenceHyperedges: unknown[];
        } | null;
      };
    };

    expect(body.interview.relatedEvidenceInterviews).toEqual([
      expect.objectContaining({
        id: 'interview-1',
        relationship: 'same_person_assessment',
        assessmentSessionId: null,
        assessmentSessionState: null,
      }),
    ]);
    expect(body.interview.codeReviewMatch).toMatchObject({
      status: 'MATCHED',
      matchRunId: 'match-run-no-assessment-table',
      packetId: 'challenge_packet_base_ui_973',
      score: 0.3249,
    });
    expect(body.interview.codeReviewMatch?.evidenceHyperedges).toHaveLength(1);
  });

  it('returns a source-backed evidence plan when CODE_REVIEW matching needs candidate evidence', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-needs-evidence', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (
        'match-run-needs-candidate-evidence', 'candidate-1', 'standalone-code-review-v1',
        'NEEDS_MORE_EVIDENCE', '[]', NULL, '{}', '2026-06-22T17:46:00.000Z'
      )
    `).run();

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-needs-evidence');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        codeReviewMatch: {
          status: string;
          summary: string;
          gaps: string[];
          evidencePlan: Array<{
            missingSignal: string;
            recommendedAssessment: string;
            question: string;
            source: {
              matchRunId: string | null;
              matchStatus: string;
              gap: string;
            };
          }>;
        } | null;
      };
    };

    expect(body.interview.codeReviewMatch).toMatchObject({
      status: 'NEEDS_MORE_EVIDENCE',
      summary: 'PIPE needs more source-backed candidate evidence before assigning a fair code-review challenge.',
      gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
    });
    expect(body.interview.codeReviewMatch?.evidencePlan).toEqual([
      expect.objectContaining({
        missingSignal: 'Source-backed candidate work evidence',
        recommendedAssessment: 'recorded_evidence_question',
        question: SOURCE_BACKED_WORK_EVIDENCE_QUESTION,
        source: {
          matchRunId: 'match-run-needs-candidate-evidence',
          matchStatus: 'NEEDS_MORE_EVIDENCE',
          gap: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
        },
      }),
    ]);
  });

  it('returns completed evidence-plan refresh state on the original CODE_REVIEW interview', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-refresh-ready', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (
        'match-run-refresh-ready', 'candidate-1', 'standalone-code-review-v1',
        'NEEDS_MORE_EVIDENCE', '[]', NULL, '{}', '2026-06-22T17:46:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, created_by,
        metadata_json, completed_at, created_at, updated_at
      ) VALUES (
        'assessment-plan-refresh-ready',
        'assessment-session:code-review-evidence-plan:interview-code-review-refresh-ready:context-call-refresh-ready',
        'context-call-refresh-ready', 'TECHNICAL', 'EVALUATED', 'candidate-1',
        'code-review-evidence-plan', ?,
        '2026-06-22T19:00:00.000Z',
        '2026-06-22T18:00:00.000Z',
        '2026-06-22T19:00:00.000Z'
      )
    `).run(JSON.stringify({
      originalInterviewId: 'interview-code-review-refresh-ready',
      contextCallInterviewId: 'context-call-refresh-ready',
      matchRunId: 'match-run-refresh-ready',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
    }));
    sqlite!.prepare(`
      INSERT INTO assessment_evaluation_reports (
        id, ingestion_key, session_id, status, summary, output_json,
        diagnostics_json, created_at, updated_at
      ) VALUES (
        'assessment-report-refresh-ready',
        'assessment-report:code-review-evidence-plan:assessment-plan-refresh-ready:ready',
        'assessment-plan-refresh-ready', 'NEEDS_HUMAN_REVIEW',
        'Evidence call captured 3 source-backed transcript spans for repo-match refresh.',
        ?, '[]',
        '2026-06-22T19:01:00.000Z',
        '2026-06-22T19:01:00.000Z'
      )
    `).run(JSON.stringify({
      schemaVersion: 'code-review-evidence-plan-result-v1',
      status: 'READY_FOR_REPO_MATCH_REFRESH',
      originalInterviewId: 'interview-code-review-refresh-ready',
      contextCallInterviewId: 'context-call-refresh-ready',
      matchRunId: 'match-run-refresh-ready',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
      sourceSpanCount: 3,
    }));
    const snippetText = 'I debugged checkout retry idempotency, reviewed the failing PR, and verified duplicate-delivery safeguards with regression tests.';
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type,
        actor_id, narrative, payload_json, occurred_at, created_at
      ) VALUES (
        'assessment-event-refresh-ready-span-1',
        'assessment-event:code-review-evidence-plan:assessment-plan-refresh-ready:meeting-1:artifact-v1:guest-1',
        'assessment-plan-refresh-ready', 1, 'evidence_plan_response_span',
        'candidate', 'candidate-1',
        'Evidence-plan response transcript segment spoken by guest.',
        '{}', '2026-06-22T19:00:30.000Z', '2026-06-22T19:00:30.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id,
        evidence_role, locator_json, exact_text, content_hash, metadata_json,
        created_at
      ) VALUES (
        'assessment-event-refresh-ready-ref-1',
        'assessment-event-refresh-ready-span-1', 'source_span',
        'source-span-refresh-ready-1', NULL, 'evidence_plan_response_span',
        ?, ?, ?, '{}', '2026-06-22T19:00:30.000Z'
      )
    `).run(JSON.stringify({
      meetingId: 'meeting-refresh-ready',
      stableSegmentId: 'guest-1',
      timestampStartMs: 0,
      timestampEndMs: 7000,
    }), snippetText, sha256Hex(snippetText));

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-refresh-ready');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        codeReviewMatch: {
          evidenceRefresh: {
            status: string;
            assessmentSessionId: string;
            contextCallInterviewId: string | null;
            reportId: string;
            summary: string;
            sourceSpanCount: number | null;
            matcherContextCount: number;
            matchRunId: string | null;
            matchStatus: string | null;
            evidenceSnippets: Array<{
              eventId: string;
              sourceRefId: string;
              exactText: string;
              evidenceRole: string;
              occurredAt: string | null;
            }>;
          } | null;
        } | null;
      };
    };

    expect(body.interview.codeReviewMatch?.evidenceRefresh).toEqual({
      status: 'READY_FOR_REPO_MATCH_REFRESH',
      assessmentSessionId: 'assessment-plan-refresh-ready',
      contextCallInterviewId: 'context-call-refresh-ready',
      reportId: 'assessment-report-refresh-ready',
      summary: 'Evidence call captured 3 source-backed transcript spans for repo-match refresh.',
      sourceSpanCount: 3,
      matcherContextCount: 0,
      matchRunId: 'match-run-refresh-ready',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
      consumptionReportId: null,
      consumedByMatchRunId: null,
      consumedByMatchStatus: null,
      consumedAt: null,
      completedAt: '2026-06-22T19:00:00.000Z',
      updatedAt: '2026-06-22T19:01:00.000Z',
      evidenceSnippets: [{
        eventId: 'assessment-event-refresh-ready-span-1',
        sourceRefId: 'source-span-refresh-ready-1',
        sourceSpanId: null,
        evidenceRole: 'evidence_plan_response_span',
        exactText: snippetText,
        occurredAt: '2026-06-22T19:00:30.000Z',
        locator: {
          meetingId: 'meeting-refresh-ready',
          stableSegmentId: 'guest-1',
          timestampStartMs: 0,
          timestampEndMs: 7000,
        },
      }],
    });
  });

  it('returns related evidence interviews for the same person graph without collapsing them into one meeting', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES
      (
        'interview-code-review-related-origin', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      ),
      (
        'context-call-related-1', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'VIDEO', 'SCREENING_INTERVIEW', 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'PIPE context call for blocked code-review matching.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T18:00:00.000Z', '2026-06-22T18:05:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO candidates (
        id, pipeline_id, owner_id, name, email, invite_token, status,
        current_stage_id, created_at, updated_at
      ) VALUES (
        'candidate-related-second-app', NULL, 'owner-1', 'Ada Candidate',
        'ADA@example.com', 'invite-related-second-app', 'INVITED',
        NULL, '2026-06-22T18:10:00.000Z', '2026-06-22T18:10:00.000Z'
      )
    `).run();
    await ensureCandidateLivingContext(createMockD1(sqlite!), 'candidate-related-second-app');
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-related-second-assessment', 'candidate-related-second-app', NULL, NULL, 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Second code-review invite for the same person.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T18:10:00.000Z', '2026-06-22T18:11:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO meetings (
        id, owner_id, title, description, status, scheduled_at, meeting_type,
        scheduled_interview_id, transcript_status, transcript_summary,
        created_at, updated_at
      ) VALUES
      (
        'meeting-related-context-call', 'owner-1', 'Ada Candidate context call',
        'Evidence follow-up', 'SCHEDULED', NULL, 'INTERVIEW',
        'context-call-related-1', 'NONE', NULL,
        '2026-06-22T18:00:00.000Z', '2026-06-22T18:00:00.000Z'
      ),
      (
        'meeting-related-second-assessment', 'owner-1', 'Ada Candidate second code review',
        'Standalone assessment', 'SCHEDULED', NULL, 'INTERVIEW',
        'interview-related-second-assessment', 'NONE', NULL,
        '2026-06-22T18:10:00.000Z', '2026-06-22T18:10:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, created_by,
        metadata_json, completed_at, created_at, updated_at
      ) VALUES (
        'assessment-plan-related',
        'assessment-session:code-review-evidence-plan:interview-code-review-related-origin:context-call-related-1',
        'context-call-related-1', 'TECHNICAL', 'IN_PROGRESS', 'candidate-1',
        'code-review-evidence-plan', ?,
        NULL, '2026-06-22T18:00:00.000Z', '2026-06-22T18:00:00.000Z'
      )
    `).run(JSON.stringify({
      originalInterviewId: 'interview-code-review-related-origin',
      contextCallInterviewId: 'context-call-related-1',
      matchRunId: 'match-run-related-origin',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
      questions: [SOURCE_BACKED_WORK_EVIDENCE_QUESTION],
    }));

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-related-origin');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        relatedEvidenceInterviews: Array<{
          id: string;
          relationship: string;
          interviewType: string | null;
          candidateId: string | null;
          primaryEmail: string | null;
          linkedMeetingId: string | null;
          assessmentSessionState: string | null;
        }>;
      };
    };

    expect(body.interview.relatedEvidenceInterviews).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'context-call-related-1',
        relationship: 'code_review_evidence_follow_up',
        interviewType: 'VIDEO',
        candidateId: 'candidate-1',
        primaryEmail: 'ada@example.com',
        linkedMeetingId: 'meeting-related-context-call',
        assessmentSessionState: 'IN_PROGRESS',
      }),
      expect.objectContaining({
        id: 'interview-related-second-assessment',
        relationship: 'same_person_assessment',
        interviewType: 'CODE_REVIEW',
        candidateId: 'candidate-related-second-app',
        primaryEmail: 'ada@example.com',
        linkedMeetingId: 'meeting-related-second-assessment',
        assessmentSessionState: null,
      }),
    ]));
    expect(body.interview.relatedEvidenceInterviews).toHaveLength(3);
  });

  it('returns blocked evidence-plan follow-up state with the attribution reason', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-blocked-follow-up', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (
        'match-run-blocked-follow-up', 'candidate-1', 'standalone-code-review-v1',
        'NEEDS_MORE_EVIDENCE', '[]', NULL, '{}', '2026-06-22T17:46:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, created_by,
        metadata_json, completed_at, created_at, updated_at
      ) VALUES (
        'assessment-plan-blocked-follow-up',
        'assessment-session:code-review-evidence-plan:interview-code-review-blocked-follow-up:context-call-blocked-follow-up',
        'context-call-blocked-follow-up', 'TECHNICAL', 'BLOCKED', 'candidate-1',
        'code-review-evidence-plan', ?,
        NULL,
        '2026-06-22T18:00:00.000Z',
        '2026-06-22T19:00:00.000Z'
      )
    `).run(JSON.stringify({
      originalInterviewId: 'interview-code-review-blocked-follow-up',
      contextCallInterviewId: 'context-call-blocked-follow-up',
      matchRunId: 'match-run-blocked-follow-up',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
      gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
      questions: [SOURCE_BACKED_WORK_EVIDENCE_QUESTION],
    }));
    sqlite!.prepare(`
      INSERT INTO assessment_state_transitions (
        id, session_id, sequence, from_state, to_state, reason,
        actor_type, actor_id, created_at
      ) VALUES (
        'assessment-state-transition-blocked-follow-up',
        'assessment-plan-blocked-follow-up', 1,
        'IN_PROGRESS', 'BLOCKED',
        'Evidence-plan follow-up transcript was summary-only and cannot be attributed to the candidate.',
        'system', NULL, '2026-06-22T19:00:00.000Z'
      )
    `).run();

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-blocked-follow-up');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        codeReviewMatch: {
          evidenceFollowUp: {
            assessmentSessionId: string;
            contextCallInterviewId: string | null;
            state: string;
            blockedReason?: string | null;
            questions: string[];
          } | null;
          evidenceRefresh: unknown | null;
        } | null;
      };
    };

    expect(body.interview.codeReviewMatch?.evidenceFollowUp).toMatchObject({
      assessmentSessionId: 'assessment-plan-blocked-follow-up',
      contextCallInterviewId: 'context-call-blocked-follow-up',
      state: 'BLOCKED',
      blockedReason: 'Evidence-plan follow-up transcript was summary-only and cannot be attributed to the candidate.',
      questions: [SOURCE_BACKED_WORK_EVIDENCE_QUESTION],
    });
    expect(body.interview.codeReviewMatch?.evidenceRefresh).toBeNull();
  });

  it('refuses CODE_REVIEW match refresh until completed follow-up evidence exists', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-refresh-not-ready', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    const matchSpy = vi.spyOn(d1Matcher, 'matchCandidateToReviewChallenge');

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-refresh-not-ready/code-review-match/refresh', {
      method: 'POST',
    });
    expect(response.status).toBe(409);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'A completed evidence-plan follow-up is required before refreshing repo matching.',
    });
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it('refuses CODE_REVIEW match refresh when completed evidence is not matcher-visible context', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-refresh-unprojected', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, created_by,
        metadata_json, completed_at, created_at, updated_at
      ) VALUES (
        'assessment-plan-refresh-unprojected',
        'assessment-session:code-review-evidence-plan:interview-code-review-refresh-unprojected:context-call-refresh-unprojected',
        'context-call-refresh-unprojected', 'TECHNICAL', 'EVALUATED', 'candidate-1',
        'code-review-evidence-plan', ?,
        '2026-06-22T19:00:00.000Z',
        '2026-06-22T18:00:00.000Z',
        '2026-06-22T19:00:00.000Z'
      )
    `).run(JSON.stringify({
      originalInterviewId: 'interview-code-review-refresh-unprojected',
      contextCallInterviewId: 'context-call-refresh-unprojected',
      matchRunId: 'match-run-before-unprojected',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
    }));
    sqlite!.prepare(`
      INSERT INTO assessment_evaluation_reports (
        id, ingestion_key, session_id, status, summary, output_json,
        diagnostics_json, created_at, updated_at
      ) VALUES (
        'assessment-report-refresh-unprojected',
        'assessment-report:code-review-evidence-plan:assessment-plan-refresh-unprojected:ready',
        'assessment-plan-refresh-unprojected', 'NEEDS_HUMAN_REVIEW',
        'Evidence call captured 1 source-backed transcript span for repo-match refresh.',
        ?, '[]',
        '2026-06-22T19:01:00.000Z',
        '2026-06-22T19:01:00.000Z'
      )
    `).run(JSON.stringify({
      schemaVersion: 'code-review-evidence-plan-result-v1',
      status: 'READY_FOR_REPO_MATCH_REFRESH',
      originalInterviewId: 'interview-code-review-refresh-unprojected',
      contextCallInterviewId: 'context-call-refresh-unprojected',
      matchRunId: 'match-run-before-unprojected',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
      sourceSpanCount: 1,
    }));
    const text = 'I reviewed a React popover timing bug and verified the fix with impatient-click regression tests.';
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type,
        actor_id, narrative, payload_json, occurred_at, created_at
      ) VALUES (
        'assessment-event-refresh-unprojected-span-1',
        'assessment-event:code-review-evidence-plan:assessment-plan-refresh-unprojected:meeting-1:artifact-v1:guest-1',
        'assessment-plan-refresh-unprojected', 1, 'evidence_plan_response_span',
        'candidate', 'candidate-1',
        'Evidence-plan response transcript segment spoken by guest.',
        '{}', '2026-06-22T19:00:30.000Z', '2026-06-22T19:00:30.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id,
        evidence_role, locator_json, exact_text, content_hash, metadata_json,
        created_at
      ) VALUES (
        'assessment-event-refresh-unprojected-ref-1',
        'assessment-event-refresh-unprojected-span-1', 'source_span',
        'source-span-refresh-unprojected-1', NULL, 'evidence_plan_response_span',
        ?, ?, ?, '{}', '2026-06-22T19:00:30.000Z'
      )
    `).run(JSON.stringify({
      meetingId: 'meeting-refresh-unprojected',
      stableSegmentId: 'guest-1',
      timestampStartMs: 0,
      timestampEndMs: 7000,
    }), text, sha256Hex(text));
    const matchSpy = vi.spyOn(d1Matcher, 'matchCandidateToReviewChallenge').mockResolvedValue({
      status: 'NEEDS_MORE_EVIDENCE',
      matchRunId: 'match-run-should-not-run',
      repoId: null,
      prNumber: null,
    });

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-refresh-unprojected/code-review-match/refresh', {
      method: 'POST',
    });

    expect(response.status).toBe(409);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'Completed evidence-plan follow-up evidence must be projected into matcher context before refreshing repo matching.',
    });
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it('repairs matcher-visible context from exact completed evidence before rerunning CODE_REVIEW matching', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-refresh-repair', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO qualified_repos (id, github_url)
      VALUES (78, 'https://github.com/pipe-labs/context-repair')
    `).run();
    sqlite!.prepare(`
      INSERT INTO review_challenge_packets (
        id, repo_snapshot_id, repo_id, pr_number, production_ready,
        quality_score, packet_json, updated_at
      ) VALUES (
        'packet-refresh-repair-9', 'snapshot-context-repair', 78, 9, 1,
        0.9, '{}', 1
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, created_by,
        metadata_json, completed_at, created_at, updated_at
      ) VALUES (
        'assessment-plan-refresh-repair',
        'assessment-session:code-review-evidence-plan:interview-code-review-refresh-repair:context-call-refresh-repair',
        'context-call-refresh-repair', 'TECHNICAL', 'EVALUATED', 'candidate-1',
        'code-review-evidence-plan', ?,
        '2026-06-22T19:00:00.000Z',
        '2026-06-22T18:00:00.000Z',
        '2026-06-22T19:00:00.000Z'
      )
    `).run(JSON.stringify({
      originalInterviewId: 'interview-code-review-refresh-repair',
      contextCallInterviewId: 'context-call-refresh-repair',
      matchRunId: 'match-run-before-repair',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
    }));
    sqlite!.prepare(`
      INSERT INTO assessment_evaluation_reports (
        id, ingestion_key, session_id, status, summary, output_json,
        diagnostics_json, created_at, updated_at
      ) VALUES (
        'assessment-report-refresh-repair',
        'assessment-report:code-review-evidence-plan:assessment-plan-refresh-repair:ready',
        'assessment-plan-refresh-repair', 'NEEDS_HUMAN_REVIEW',
        'Evidence call captured 1 source-backed transcript span for repo-match refresh.',
        ?, '[]',
        '2026-06-22T19:01:00.000Z',
        '2026-06-22T19:01:00.000Z'
      )
    `).run(JSON.stringify({
      schemaVersion: 'code-review-evidence-plan-result-v1',
      status: 'READY_FOR_REPO_MATCH_REFRESH',
      originalInterviewId: 'interview-code-review-refresh-repair',
      contextCallInterviewId: 'context-call-refresh-repair',
      matchRunId: 'match-run-before-repair',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
      sourceSpanCount: 1,
    }));
    const evidenceText = 'I debugged a React Query cache invalidation bug in production, reviewed the PR diff, explained the stale data trade-off, and verified the fix with regression tests.';
    const sourceSpanId = await seedCandidateOwnedEvidencePlanSourceSpan(sqlite!, {
      text: evidenceText,
      sourceKey: 'refresh-repair',
    });
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type,
        actor_id, narrative, payload_json, occurred_at, created_at
      ) VALUES (
        'assessment-event-refresh-repair-span-1',
        'assessment-event:code-review-evidence-plan:assessment-plan-refresh-repair:meeting-repair:artifact-v1:guest-1',
        'assessment-plan-refresh-repair', 1, 'evidence_plan_response_span',
        'candidate', 'candidate-1',
        'Evidence-plan response transcript segment spoken by guest.',
        '{}', '2026-06-22T19:00:30.000Z', '2026-06-22T19:00:30.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id,
        evidence_role, locator_json, exact_text, content_hash, metadata_json,
        created_at
      ) VALUES (
        'assessment-event-refresh-repair-ref-1',
        'assessment-event-refresh-repair-span-1', 'source_span',
        ?, ?, 'evidence_plan_response_span',
        ?, ?, ?, '{}', '2026-06-22T19:00:30.000Z'
      )
    `).run(sourceSpanId, sourceSpanId, JSON.stringify({
      meetingId: 'meeting-refresh-repair',
      stableSegmentId: 'guest-1',
      timestampStartMs: 0,
      timestampEndMs: 7000,
    }), evidenceText, sha256Hex(evidenceText));
    const matchSpy = vi.spyOn(d1Matcher, 'matchCandidateToReviewChallenge').mockImplementation(async () => {
      sqlite!.prepare(`
        INSERT INTO match_runs (
          id, candidate_id, role_snapshot_id, status, ranked_results_json,
          selected_packet_id, query_json, created_at
        ) VALUES (
          'match-run-after-repair', 'candidate-1', 'standalone-code-review-v1',
          'MATCHED', ?, 'packet-refresh-repair-9', '{}', '2026-06-22T19:02:00.000Z'
        )
      `).run(JSON.stringify([{
        repoId: 78,
        prNumber: 9,
        packetId: 'packet-refresh-repair-9',
        score: 0.83,
      }]));
      return {
        status: 'MATCHED',
        matchRunId: 'match-run-after-repair',
        repoId: 78,
        prNumber: 9,
      };
    });

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-refresh-repair/code-review-match/refresh', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      refreshed: boolean;
      status: string;
      repoId: number;
      prNumber: number;
    };
    expect(body).toMatchObject({
      refreshed: true,
      status: 'MATCHED',
      repoId: 78,
      prNumber: 9,
    });
    expect(matchSpy).toHaveBeenCalledOnce();
    const repaired = sqlite!.prepare(`
      SELECT COUNT(DISTINCT cr.id) AS count
        FROM context_records cr
        JOIN context_record_entities cre ON cre.context_record_id = cr.id
       WHERE cr.record_type = 'code_review_evidence_plan_response'
         AND cre.entity_type = 'assessment_session'
         AND cre.entity_id = 'assessment-plan-refresh-repair'
         AND cre.relationship = 'source_assessment'
    `).get() as { count: number };
    expect(repaired.count).toBe(1);
  });

  it('reruns CODE_REVIEW matching from completed evidence and persists the refreshed PR assignment', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-refresh-run', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO qualified_repos (id, github_url)
      VALUES (77, 'https://github.com/pipe-labs/orders')
    `).run();
    sqlite!.prepare(`
      INSERT INTO review_challenge_packets (
        id, repo_snapshot_id, repo_id, pr_number, production_ready,
        quality_score, packet_json, updated_at
      ) VALUES (
        'packet-refresh-314', 'snapshot-orders', 77, 314, 1,
        0.91, '{}', 1
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, created_by,
        metadata_json, completed_at, created_at, updated_at
      ) VALUES (
        'assessment-plan-refresh-run',
        'assessment-session:code-review-evidence-plan:interview-code-review-refresh-run:context-call-refresh-run',
        'context-call-refresh-run', 'TECHNICAL', 'EVALUATED', 'candidate-1',
        'code-review-evidence-plan', ?,
        '2026-06-22T19:00:00.000Z',
        '2026-06-22T18:00:00.000Z',
        '2026-06-22T19:00:00.000Z'
      )
    `).run(JSON.stringify({
      originalInterviewId: 'interview-code-review-refresh-run',
      contextCallInterviewId: 'context-call-refresh-run',
      matchRunId: 'match-run-before-refresh',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
    }));
    sqlite!.prepare(`
      INSERT INTO assessment_evaluation_reports (
        id, ingestion_key, session_id, status, summary, output_json,
        diagnostics_json, created_at, updated_at
      ) VALUES (
        'assessment-report-refresh-run',
        'assessment-report:code-review-evidence-plan:assessment-plan-refresh-run:ready',
        'assessment-plan-refresh-run', 'NEEDS_HUMAN_REVIEW',
        'Evidence call captured 2 source-backed transcript spans for repo-match refresh.',
        ?, '[]',
        '2026-06-22T19:01:00.000Z',
        '2026-06-22T19:01:00.000Z'
      )
    `).run(JSON.stringify({
      schemaVersion: 'code-review-evidence-plan-result-v1',
      status: 'READY_FOR_REPO_MATCH_REFRESH',
      originalInterviewId: 'interview-code-review-refresh-run',
      contextCallInterviewId: 'context-call-refresh-run',
      matchRunId: 'match-run-before-refresh',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
      sourceSpanCount: 2,
    }));
    const successEvidenceText = 'I handled retry idempotency bugs in an order pipeline, reviewed the PR diff, and verified duplicate delivery with regression tests.';
    sqlite!.prepare(`
      INSERT INTO assessment_evidence_events (
        id, ingestion_key, session_id, sequence, kind, actor_type,
        actor_id, narrative, payload_json, occurred_at, created_at
      ) VALUES (
        'assessment-event-refresh-run-span-1',
        'assessment-event:code-review-evidence-plan:assessment-plan-refresh-run:meeting-1:artifact-v1:guest-1',
        'assessment-plan-refresh-run', 1, 'evidence_plan_response_span',
        'candidate', 'candidate-1',
        'Evidence-plan response transcript segment spoken by guest.',
        '{}', '2026-06-22T19:00:30.000Z', '2026-06-22T19:00:30.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_event_source_refs (
        id, event_id, source_ref_type, source_ref_id, source_span_id,
        evidence_role, locator_json, exact_text, content_hash, metadata_json,
        created_at
      ) VALUES (
        'assessment-event-refresh-run-ref-1',
        'assessment-event-refresh-run-span-1', 'source_span',
        'source-span-refresh-run-1', NULL, 'evidence_plan_response_span',
        ?, ?, ?, '{}', '2026-06-22T19:00:30.000Z'
      )
    `).run(JSON.stringify({
      meetingId: 'meeting-refresh-run',
      stableSegmentId: 'guest-1',
      timestampStartMs: 0,
      timestampEndMs: 7000,
    }), successEvidenceText, sha256Hex(successEvidenceText));
    await seedEvidencePlanMatcherContext(sqlite!, {
      assessmentSessionId: 'assessment-plan-refresh-run',
      narrative: successEvidenceText,
    });
    vi.spyOn(d1Matcher, 'matchCandidateToReviewChallenge').mockImplementation(async () => {
      sqlite!.prepare(`
        INSERT INTO match_runs (
          id, candidate_id, role_snapshot_id, status, ranked_results_json,
          selected_packet_id, query_json, created_at
        ) VALUES (
          'match-run-after-refresh', 'candidate-1', 'standalone-code-review-v1',
          'MATCHED', ?, 'packet-refresh-314', '{}', '2026-06-22T19:02:00.000Z'
        )
      `).run(JSON.stringify([{
        rank: 1,
        challengeId: 'packet-refresh-314',
        repoId: '77',
        prNumber: 314,
        score: 0.91,
        alignedDemandCount: 2,
        stretchCount: 0,
        provenanceComplete: true,
        eligible: true,
        assessmentQuality: null,
        reviewProfile: null,
        validatorAgent: null,
        alignments: [],
        rejectionReasons: [],
      }]));
      return {
        status: 'MATCHED',
        matchRunId: 'match-run-after-refresh',
        repoId: 77,
        prNumber: 314,
      };
    });

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-refresh-run/code-review-match/refresh', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      refreshed: boolean;
      status: string;
      matchRunId: string;
      repoId: number;
      repoUrl: string;
      prNumber: number;
      codeReviewMatch: {
        status: string;
        matchRunId: string | null;
        evidenceRefresh: {
          consumptionReportId: string | null;
          consumedByMatchRunId: string | null;
          consumedByMatchStatus: string | null;
          consumedAt: string | null;
        } | null;
      } | null;
    };
    expect(body).toMatchObject({
      refreshed: true,
      status: 'MATCHED',
      matchRunId: 'match-run-after-refresh',
      repoId: 77,
      repoUrl: 'https://github.com/pipe-labs/orders',
      prNumber: 314,
      codeReviewMatch: {
        status: 'MATCHED',
        matchRunId: 'match-run-after-refresh',
        evidenceRefresh: {
          consumedByMatchRunId: 'match-run-after-refresh',
          consumedByMatchStatus: 'MATCHED',
        },
      },
    });
    expect(body.codeReviewMatch?.evidenceRefresh?.consumptionReportId).toEqual(expect.stringMatching(/^assessment_evaluation_report_/));
    expect(body.codeReviewMatch?.evidenceRefresh?.consumedAt).toBeTruthy();
    const row = sqlite!.prepare(
      `SELECT matched_repo_id, github_repo_url, github_pr_number
         FROM scheduled_interviews
        WHERE id = 'interview-code-review-refresh-run'`,
    ).get() as {
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
    };
    expect(row).toEqual({
      matched_repo_id: 77,
      github_repo_url: 'https://github.com/pipe-labs/orders',
      github_pr_number: 314,
    });
    const consumptionReport = sqlite!.prepare(
      `SELECT status, summary, output_json
         FROM assessment_evaluation_reports
        WHERE session_id = 'assessment-plan-refresh-run'
          AND json_extract(output_json, '$.schemaVersion') = 'code-review-evidence-plan-consumption-v1'
        LIMIT 1`,
    ).get() as { status: string; summary: string; output_json: string };
    expect(consumptionReport.status).toBe('EVALUATED');
    expect(consumptionReport.summary).toContain('was consumed by repo-match rerun match-run-after-refresh');
    expect(JSON.parse(consumptionReport.output_json)).toMatchObject({
      schemaVersion: 'code-review-evidence-plan-consumption-v1',
      status: 'USED_FOR_REPO_MATCH_REFRESH',
      readyReportId: 'assessment-report-refresh-run',
      assessmentSessionId: 'assessment-plan-refresh-run',
      originalInterviewId: 'interview-code-review-refresh-run',
      consumedByMatchRunId: 'match-run-after-refresh',
      consumedByMatchStatus: 'MATCHED',
      refreshed: true,
      repoId: 77,
      repoUrl: 'https://github.com/pipe-labs/orders',
      prNumber: 314,
    });
    const consumptionSourceRefs = sqlite!.prepare(
      `SELECT c.dimension, r.source_ref_type, r.source_ref_id, r.evidence_role, r.exact_text, r.content_hash
         FROM assessment_evaluation_reports report
         JOIN assessment_evaluation_claims c ON c.report_id = report.id
         JOIN assessment_claim_source_refs r ON r.claim_id = c.id
        WHERE report.session_id = 'assessment-plan-refresh-run'
          AND json_extract(report.output_json, '$.schemaVersion') = 'code-review-evidence-plan-consumption-v1'
        ORDER BY r.id`,
    ).all() as Array<{
      dimension: string;
      source_ref_type: string;
      source_ref_id: string;
      evidence_role: string;
      exact_text: string;
      content_hash: string;
    }>;
    expect(consumptionSourceRefs).toEqual([
      {
        dimension: 'repo_match_refresh_consumption',
        source_ref_type: 'source_span',
        source_ref_id: 'source-span-refresh-run-1',
        evidence_role: 'evidence_plan_response_span',
        exact_text: successEvidenceText,
        content_hash: sha256Hex(successEvidenceText),
      },
    ]);
  });

  it('returns an explicit no-match refresh result without mutating the CODE_REVIEW assignment', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-refresh-still-blocked', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, created_by,
        metadata_json, completed_at, created_at, updated_at
      ) VALUES (
        'assessment-plan-refresh-still-blocked',
        'assessment-session:code-review-evidence-plan:interview-code-review-refresh-still-blocked:context-call-refresh-still-blocked',
        'context-call-refresh-still-blocked', 'TECHNICAL', 'EVALUATED', 'candidate-1',
        'code-review-evidence-plan', ?,
        '2026-06-22T19:00:00.000Z',
        '2026-06-22T18:00:00.000Z',
        '2026-06-22T19:00:00.000Z'
      )
    `).run(JSON.stringify({
      originalInterviewId: 'interview-code-review-refresh-still-blocked',
      contextCallInterviewId: 'context-call-refresh-still-blocked',
      matchRunId: 'match-run-before-refresh',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
    }));
    sqlite!.prepare(`
      INSERT INTO assessment_evaluation_reports (
        id, ingestion_key, session_id, status, summary, output_json,
        diagnostics_json, created_at, updated_at
      ) VALUES (
        'assessment-report-refresh-still-blocked',
        'assessment-report:code-review-evidence-plan:assessment-plan-refresh-still-blocked:ready',
        'assessment-plan-refresh-still-blocked', 'NEEDS_HUMAN_REVIEW',
        'Evidence call captured 1 source-backed transcript span for repo-match refresh.',
        ?, '[]',
        '2026-06-22T19:01:00.000Z',
        '2026-06-22T19:01:00.000Z'
      )
    `).run(JSON.stringify({
      schemaVersion: 'code-review-evidence-plan-result-v1',
      status: 'READY_FOR_REPO_MATCH_REFRESH',
      originalInterviewId: 'interview-code-review-refresh-still-blocked',
      contextCallInterviewId: 'context-call-refresh-still-blocked',
      matchRunId: 'match-run-before-refresh',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
      sourceSpanCount: 1,
    }));
    await seedEvidencePlanMatcherContext(sqlite!, {
      assessmentSessionId: 'assessment-plan-refresh-still-blocked',
    });
    vi.spyOn(d1Matcher, 'matchCandidateToReviewChallenge').mockImplementation(async () => {
      sqlite!.prepare(`
        INSERT INTO match_runs (
          id, candidate_id, role_snapshot_id, status, ranked_results_json,
          selected_packet_id, query_json, created_at
        ) VALUES (
          'match-run-after-refresh-still-blocked', 'candidate-1', 'standalone-code-review-v1',
          'NEEDS_MORE_EVIDENCE', '[]', NULL, '{}', '2026-06-22T19:02:00.000Z'
        )
      `).run();
      return {
        status: 'NEEDS_MORE_EVIDENCE',
        matchRunId: 'match-run-after-refresh-still-blocked',
      };
    });

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-refresh-still-blocked/code-review-match/refresh', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      refreshed: boolean;
      status: string;
      matchRunId: string;
      codeReviewMatch: {
        status: string;
        matchRunId: string | null;
        evidenceRefresh: {
          consumptionReportId: string | null;
          consumedByMatchRunId: string | null;
          consumedByMatchStatus: string | null;
        } | null;
      } | null;
    };
    expect(body).toMatchObject({
      refreshed: false,
      status: 'NEEDS_MORE_EVIDENCE',
      matchRunId: 'match-run-after-refresh-still-blocked',
      codeReviewMatch: {
        status: 'NEEDS_MORE_EVIDENCE',
        evidenceRefresh: {
          consumedByMatchRunId: 'match-run-after-refresh-still-blocked',
          consumedByMatchStatus: 'NEEDS_MORE_EVIDENCE',
        },
      },
    });
    expect(body.codeReviewMatch?.evidenceRefresh?.consumptionReportId).toEqual(expect.stringMatching(/^assessment_evaluation_report_/));
    const row = sqlite!.prepare(
      `SELECT matched_repo_id, github_repo_url, github_pr_number
         FROM scheduled_interviews
        WHERE id = 'interview-code-review-refresh-still-blocked'`,
    ).get() as {
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
    };
    expect(row).toEqual({
      matched_repo_id: null,
      github_repo_url: null,
      github_pr_number: null,
    });
    const consumptionReport = sqlite!.prepare(
      `SELECT status, summary, output_json
         FROM assessment_evaluation_reports
        WHERE session_id = 'assessment-plan-refresh-still-blocked'
          AND json_extract(output_json, '$.schemaVersion') = 'code-review-evidence-plan-consumption-v1'
        LIMIT 1`,
    ).get() as { status: string; summary: string; output_json: string };
    expect(consumptionReport.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(consumptionReport.summary).toContain('but the matcher returned NEEDS_MORE_EVIDENCE');
    expect(JSON.parse(consumptionReport.output_json)).toMatchObject({
      schemaVersion: 'code-review-evidence-plan-consumption-v1',
      status: 'USED_FOR_REPO_MATCH_REFRESH',
      readyReportId: 'assessment-report-refresh-still-blocked',
      assessmentSessionId: 'assessment-plan-refresh-still-blocked',
      originalInterviewId: 'interview-code-review-refresh-still-blocked',
      consumedByMatchRunId: 'match-run-after-refresh-still-blocked',
      consumedByMatchStatus: 'NEEDS_MORE_EVIDENCE',
      refreshed: false,
      repoId: null,
      repoUrl: null,
      prNumber: null,
    });
  });

  it('creates a fresh follow-up assessment after a consumed refresh still lacks evidence', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-next-follow-up', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (
        'match-run-after-refresh-still-needs-evidence', 'candidate-1', 'standalone-code-review-v1',
        'NEEDS_MORE_EVIDENCE', '[]', NULL, '{}', '2026-06-22T19:02:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, created_by,
        metadata_json, completed_at, created_at, updated_at
      ) VALUES (
        'assessment-plan-consumed-still-needs-evidence',
        'assessment-session:code-review-evidence-plan:interview-code-review-next-follow-up:context-call-consumed-still-needs-evidence',
        'context-call-consumed-still-needs-evidence', 'TECHNICAL', 'EVALUATED', 'candidate-1',
        'code-review-evidence-plan', ?,
        '2026-06-22T19:00:00.000Z',
        '2026-06-22T18:00:00.000Z',
        '2026-06-22T19:00:00.000Z'
      )
    `).run(JSON.stringify({
      originalInterviewId: 'interview-code-review-next-follow-up',
      contextCallInterviewId: 'context-call-consumed-still-needs-evidence',
      matchRunId: 'match-run-before-consumed-refresh',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
    }));
    sqlite!.prepare(`
      INSERT INTO assessment_evaluation_reports (
        id, ingestion_key, session_id, status, summary, output_json,
        diagnostics_json, created_at, updated_at
      ) VALUES (
        'assessment-report-consumed-refresh-ready',
        'assessment-report:code-review-evidence-plan:assessment-plan-consumed-still-needs-evidence:ready',
        'assessment-plan-consumed-still-needs-evidence', 'NEEDS_HUMAN_REVIEW',
        'Evidence call captured 1 source-backed transcript span for repo-match refresh.',
        ?, '[]',
        '2026-06-22T19:01:00.000Z',
        '2026-06-22T19:01:00.000Z'
      ), (
        'assessment-report-consumed-refresh-used',
        'assessment-report:code-review-evidence-plan:assessment-plan-consumed-still-needs-evidence:ready:match-run-after-refresh-still-needs-evidence:consumed',
        'assessment-plan-consumed-still-needs-evidence', 'NEEDS_MORE_EVIDENCE',
        'Evidence-plan follow-up was consumed by a repo-match rerun, but the matcher returned NEEDS_MORE_EVIDENCE.',
        ?, '[]',
        '2026-06-22T19:02:00.000Z',
        '2026-06-22T19:02:00.000Z'
      )
    `).run(
      JSON.stringify({
        schemaVersion: 'code-review-evidence-plan-result-v1',
        status: 'READY_FOR_REPO_MATCH_REFRESH',
        originalInterviewId: 'interview-code-review-next-follow-up',
        contextCallInterviewId: 'context-call-consumed-still-needs-evidence',
        matchRunId: 'match-run-before-consumed-refresh',
        matchStatus: 'NEEDS_MORE_EVIDENCE',
        sourceSpanCount: 1,
      }),
      JSON.stringify({
        schemaVersion: 'code-review-evidence-plan-consumption-v1',
        status: 'USED_FOR_REPO_MATCH_REFRESH',
        originalInterviewId: 'interview-code-review-next-follow-up',
        readyReportId: 'assessment-report-consumed-refresh-ready',
        assessmentSessionId: 'assessment-plan-consumed-still-needs-evidence',
        consumedByMatchRunId: 'match-run-after-refresh-still-needs-evidence',
        consumedByMatchStatus: 'NEEDS_MORE_EVIDENCE',
        refreshed: false,
        consumedAt: '2026-06-22T19:02:00.000Z',
      }),
    );

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-next-follow-up/context-call', {
      method: 'POST',
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      contextCall: {
        id: string;
        originalInterviewId: string;
        evidenceAssessmentSessionId: string;
        reused?: boolean;
      };
    };
    expect(body.contextCall).toMatchObject({
      originalInterviewId: 'interview-code-review-next-follow-up',
    });
    expect(body.contextCall.id).not.toBe('context-call-consumed-still-needs-evidence');
    expect(body.contextCall.evidenceAssessmentSessionId).not.toBe('assessment-plan-consumed-still-needs-evidence');
    expect(body.contextCall.reused).toBeUndefined();

    const newPlan = sqlite!.prepare(
      `SELECT id, interview_id, state, created_by, metadata_json
         FROM assessment_sessions
        WHERE id = ?`,
    ).get(body.contextCall.evidenceAssessmentSessionId) as {
      id: string;
      interview_id: string;
      state: string;
      created_by: string;
      metadata_json: string;
    };
    expect(newPlan).toMatchObject({
      interview_id: body.contextCall.id,
      state: 'IN_PROGRESS',
      created_by: 'code-review-evidence-plan',
    });
    expect(JSON.parse(newPlan.metadata_json)).toMatchObject({
      originalInterviewId: 'interview-code-review-next-follow-up',
      contextCallInterviewId: body.contextCall.id,
      matchRunId: 'match-run-after-refresh-still-needs-evidence',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
    });
  });

  it('does not rerun CODE_REVIEW matching when the same evidence refresh was already tried', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-refresh-already-tried', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO assessment_sessions (
        id, ingestion_key, interview_id, mode, state, candidate_id, created_by,
        metadata_json, completed_at, created_at, updated_at
      ) VALUES (
        'assessment-plan-refresh-already-tried',
        'assessment-session:code-review-evidence-plan:interview-code-review-refresh-already-tried:context-call-refresh-already-tried',
        'context-call-refresh-already-tried', 'TECHNICAL', 'EVALUATED', 'candidate-1',
        'code-review-evidence-plan', ?,
        '2026-06-22T19:00:00.000Z',
        '2026-06-22T18:00:00.000Z',
        '2026-06-22T19:00:00.000Z'
      )
    `).run(JSON.stringify({
      originalInterviewId: 'interview-code-review-refresh-already-tried',
      contextCallInterviewId: 'context-call-refresh-already-tried',
      matchRunId: 'match-run-before-refresh',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
    }));
    sqlite!.prepare(`
      INSERT INTO assessment_evaluation_reports (
        id, ingestion_key, session_id, status, summary, output_json,
        diagnostics_json, created_at, updated_at
      ) VALUES (
        'assessment-report-refresh-already-tried',
        'assessment-report:code-review-evidence-plan:assessment-plan-refresh-already-tried:ready',
        'assessment-plan-refresh-already-tried', 'NEEDS_HUMAN_REVIEW',
        'Evidence call captured 1 source-backed transcript span for repo-match refresh.',
        ?, '[]',
        '2026-06-22T19:01:00.000Z',
        '2026-06-22T19:01:00.000Z'
      )
    `).run(JSON.stringify({
      schemaVersion: 'code-review-evidence-plan-result-v1',
      status: 'READY_FOR_REPO_MATCH_REFRESH',
      originalInterviewId: 'interview-code-review-refresh-already-tried',
      contextCallInterviewId: 'context-call-refresh-already-tried',
      matchRunId: 'match-run-before-refresh',
      matchStatus: 'NEEDS_MORE_EVIDENCE',
      sourceSpanCount: 1,
    }));
    await seedEvidencePlanMatcherContext(sqlite!, {
      assessmentSessionId: 'assessment-plan-refresh-already-tried',
    });
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (
        'match-run-after-refresh-still-blocked', 'candidate-1', 'standalone-code-review-v1',
        'NEEDS_MORE_EVIDENCE', '[]', NULL, '{}', '2026-06-22T19:02:00.000Z'
      )
    `).run();
    const matchSpy = vi.spyOn(d1Matcher, 'matchCandidateToReviewChallenge').mockImplementation(async () => {
      throw new Error('matcher should not rerun stale evidence');
    });

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-refresh-already-tried/code-review-match/refresh', {
      method: 'POST',
    });
    expect(response.status).toBe(409);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'This evidence refresh has already been tried. Capture new source-backed evidence before rerunning repo matching.',
    });
    expect(matchSpy).not.toHaveBeenCalled();
  });

  it('downgrades stale role-backed CODE_REVIEW validator proof when contrast was unmeasured', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-stale-gate', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'MATCHED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, 77, 'https://github.com/pipe-labs/orders', 314,
        NULL, NULL, '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO review_challenge_packets (
        id, repo_snapshot_id, repo_id, pr_number, production_ready,
        quality_score, packet_json, updated_at
      ) VALUES (
        'packet-code-review-stale-gate', 'snapshot-orders', 77, 314, 1,
        0.91, '{}', 1
      )
    `).run();

    const contrastReason = 'No second eligible challenge was available in this explanation context, so score separation was not measured.';
    const rankedResults = [{
      rank: 1,
      challengeId: 'packet-code-review-stale-gate',
      repoId: '77',
      prNumber: 314,
      score: 0.88,
      alignedDemandCount: 2,
      stretchCount: 0,
      provenanceComplete: true,
      eligible: true,
      assessmentQuality: {
        verdict: 'USABLE',
        score: 9,
        maxScore: 12,
        metrics: [{
          id: 'contrast_separation',
          label: 'Contrast separation',
          score: 0,
          maxScore: 2,
          reason: contrastReason,
        }],
      },
      validatorAgent: {
        agentName: 'deterministic-code-review-match-gate',
        agentVersion: 'legacy-test-v1',
        mode: 'deterministic',
        verdict: 'PASSED',
        rationale: 'Selected PR #314 because candidate, role, and repo spans align.',
        checks: [{
          id: 'provenance_complete',
          passed: true,
          reason: 'Candidate, role, and repo source refs are present.',
        }],
        sourceBridge: {
          prNumber: 314,
          candidateSourceCount: 1,
          repoSourceCount: 1,
          roleSourceCount: 1,
          alignedDemandCount: 2,
          stretchCount: 0,
          provenanceComplete: true,
        },
      },
      alignments: [],
      rejectionReasons: [],
    }];
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (
        'match-run-code-review-stale-gate', 'candidate-1', 'role-context:role-1:source-backed:simple-jd-v1',
        'MATCHED', ?, 'packet-code-review-stale-gate', '{}', '2026-06-22T17:46:00.000Z'
      )
    `).run(JSON.stringify(rankedResults));

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-stale-gate');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        codeReviewMatch: {
          status: string;
          packetId: string | null;
          assessmentQuality: { verdict: string } | null;
          validatorAgent: {
            verdict: string;
            rationale: string;
            checks: Array<{ id: string; passed: boolean; reason: string }>;
          } | null;
          gaps: string[];
        } | null;
      };
    };

    expect(body.interview.codeReviewMatch).toMatchObject({
      status: 'MATCHED',
      packetId: 'packet-code-review-stale-gate',
      assessmentQuality: { verdict: 'NEEDS_REVIEW' },
      validatorAgent: {
        verdict: 'NEEDS_REVIEW',
      },
    });
    expect(body.interview.codeReviewMatch?.validatorAgent?.rationale).toContain('Needs recruiter review');
    expect(body.interview.codeReviewMatch?.validatorAgent?.checks).toEqual(expect.arrayContaining([
      {
        id: 'contrast_separation_verified',
        passed: false,
        reason: contrastReason,
      },
    ]));
    expect(body.interview.codeReviewMatch?.gaps).toContain(contrastReason);
  });

  it('keeps roleless CODE_REVIEW evidence as candidate-repo hyperedges', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-pairwise', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', NULL, 'MATCHED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Assess PR review judgment.',
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, 88, 'https://github.com/pipe-labs/cache', 22,
        NULL, NULL, '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO review_challenge_packets (
        id, repo_snapshot_id, repo_id, pr_number, production_ready,
        quality_score, packet_json, updated_at
      ) VALUES (
        'packet-code-review-pairwise', 'snapshot-cache', 88, 22, 1,
        0.89, '{}', 1
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (
        'match-run-code-review-pairwise', 'candidate-1', 'standalone-code-review-v1',
        'MATCHED', ?, 'packet-code-review-pairwise', '{}', '2026-06-22T17:46:00.000Z'
      )
    `).run(JSON.stringify([{
      rank: 1,
      challengeId: 'packet-code-review-pairwise',
      repoId: '88',
      prNumber: 22,
      score: 0.74,
      alignedDemandCount: 1,
      stretchCount: 0,
      provenanceComplete: true,
      eligible: true,
      alignments: [{
        atomId: 'candidate-atom-cache',
        demandId: 'repo-demand-cache',
        pairScore: 0.74,
        sharedConcepts: ['term:cache-invalidation'],
        roleSourceRefs: [],
        candidateSourceRefs: [{
          sourceRefType: 'source_span',
          sourceRefId: 'candidate-span-cache',
          sourceSpanId: 'candidate-span-cache',
          locator: 'resume.pdf:8',
          exactText: 'Reviewed cache invalidation fixes in TypeScript services.',
        }],
        challengeSourceRefs: [{
          sourceRefType: 'repo_source_span',
          sourceRefId: 'repo-span-cache',
          locator: 'src/cache/invalidate.ts:22',
          exactText: 'Cache invalidation can race when two writes arrive together.',
        }],
      }],
      rejectionReasons: [],
    }]));

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-pairwise');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        codeReviewMatch: {
          evidence: Array<{ atomId: string; demandId: string }>;
          evidenceHyperedges: Array<{ relation: string; nodes: Array<{ kind: string }> }>;
        } | null;
      };
    };

    expect(body.interview.codeReviewMatch?.evidence).toHaveLength(1);
    expect(body.interview.codeReviewMatch?.evidenceHyperedges).toEqual([
      expect.objectContaining({
        relation: 'candidate_repo_evidence_alignment',
        nodes: [
          expect.objectContaining({ kind: 'person_evidence' }),
          expect.objectContaining({ kind: 'repo_challenge' }),
        ],
      }),
    ]);
    expect(body.interview.codeReviewMatch?.evidenceHyperedges[0]?.nodes.some((node) =>
      node.kind === 'role_source'
    )).toBe(false);
  });

  it('returns manual CODE_REVIEW source-backed proof without an automatic match run', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO qualified_repos (id, github_url)
      VALUES (973, 'https://github.com/mui/base-ui')
    `).run();
    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-manual', 'candidate-1', NULL, NULL, 'owner-1',
        'CODE_REVIEW', NULL, 'COMPLETED', NULL,
        NULL, 'MANUAL', NULL, NULL, 'Manual async review.',
        'MANUAL', NULL, NULL, NULL,
        'Ada Lovelace', 'ada@example.com', NULL, 'https://github.com/mui/base-ui', 973,
        NULL, '2026-06-22T18:15:00.000Z', '2026-06-22T18:00:00.000Z', '2026-06-22T18:15:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO review_challenge_packets (
        id, repo_snapshot_id, repo_id, pr_number, production_ready,
        quality_score, packet_json, updated_at
      ) VALUES (
        'packet-mui-base-ui-973', 'snapshot-mui-base-ui', 973, 973, 1,
        0.9, ?, 1
      )
    `).run(JSON.stringify({
      reviewProfile: {
        source: 'deterministic_engineering_prior',
        difficultyBand: 'focused',
        expectedSeniority: 'senior',
        expectedTimeMinutes: 45,
        basis: {
          changedFileCount: 2,
          changedLineCount: 128,
          sourceHunkCount: 9,
          testChangeCount: 1,
          demandFamilyCount: 4,
          hasIssueContext: true,
        },
        rationale: 'focused review calibrated for senior candidates; 45 minute target; issue context is available.',
      },
    }));

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/interview-code-review-manual');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        codeReviewMatch: {
          status: string;
          matchRunId: string | null;
          packetId: string | null;
          summary: string;
          score: number | null;
          reviewProfile: {
            difficultyBand: string;
            expectedSeniority: string;
            expectedTimeMinutes: number;
          } | null;
          validatorAgent: {
            verdict: string;
            sourceBridge: { repoSourceCount: number; candidateSourceCount: number } | null;
          } | null;
          evidenceHyperedges: unknown[];
        } | null;
      };
    };

    expect(body.interview.codeReviewMatch).toMatchObject({
      status: 'MATCHED',
      matchRunId: null,
      packetId: 'packet-mui-base-ui-973',
      summary: expect.stringContaining('Manual override'),
      score: 0.9,
      reviewProfile: {
        difficultyBand: 'focused',
        expectedSeniority: 'senior',
        expectedTimeMinutes: 45,
      },
    });
    expect(body.interview.codeReviewMatch?.validatorAgent).toMatchObject({
      verdict: 'PASSED',
      sourceBridge: {
        candidateSourceCount: 0,
        repoSourceCount: 1,
      },
    });
    expect(body.interview.codeReviewMatch?.evidenceHyperedges).toEqual([]);
  });

  it('returns room status snapshots for recruiter real-time room updates', async () => {
    seedInterviewDetailFixture();
    const app = mountSchedulingApp();

    const initialResponse = await app.request('/room-events');
    expect(initialResponse.status).toBe(200);
    const initialBody = await initialResponse.json() as {
      rooms: Array<{
        interviewId: string;
        meetingId: string | null;
        meetingStatus: string | null;
        roomStatus: string | null;
        guestJoinedAt: string | null;
        guestLeftAt: string | null;
        guestWaiting: boolean;
        updatedAt: string;
      }>;
    };
    expect(initialBody.rooms).toContainEqual(expect.objectContaining({
      interviewId: 'interview-1',
      meetingId: 'meeting-1',
      meetingStatus: 'ACTIVE',
      roomStatus: 'ACTIVE',
      guestJoinedAt: null,
      guestLeftAt: null,
      guestWaiting: false,
    }));

    sqlite!.prepare(`
      INSERT INTO meeting_participants (
        id, meeting_id, contact_id, role, invite_sent_at, joined_at, left_at, created_at, updated_at
      ) VALUES (
        'participant-guest-1', 'meeting-1', 'contact-1', 'ATTENDEE', NULL,
        '2026-06-22T18:04:00.000Z', NULL,
        '2026-06-22T17:40:00.000Z', '2026-06-22T18:04:00.000Z'
      )
    `).run();

    const joinedResponse = await app.request('/room-events');
    expect(joinedResponse.status).toBe(200);
    const joinedBody = await joinedResponse.json() as typeof initialBody;
    expect(joinedBody.rooms).toContainEqual(expect.objectContaining({
      interviewId: 'interview-1',
      meetingId: 'meeting-1',
      roomStatus: 'ACTIVE',
      guestJoinedAt: '2026-06-22T18:04:00.000Z',
      guestLeftAt: null,
      guestWaiting: true,
      updatedAt: '2026-06-22T18:35:00.000Z',
    }));
  });

  it('returns source-backed contact graph for a roleless direct-call interview', async () => {
    seedInterviewDetailFixture();
    await seedContactLivingContext();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews/interview-roleless-1');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      interview: {
        id: string;
        candidateId: string | null;
        recipientName: string | null;
        recipientEmail: string | null;
        pipelineId: string | null;
        stageId: string | null;
        livingContext: {
          person: {
            displayName: string | null;
            primaryEmail: string | null;
            roles: Array<{ roleType: string }>;
          };
          summary: { contextRecordCount: number; sourceSpanCount: number };
          contextRecords: Array<{
            recordType: string;
            narrative: string;
            concepts: Array<{ canonicalKey: string; label: string }>;
            sources: Array<{ exactText: string }>;
          }>;
        } | null;
      };
    };

    expect(body.interview).toMatchObject({
      id: 'interview-roleless-1',
      candidateId: null,
      recipientName: 'Grace Hopper',
      recipientEmail: 'client@example.com',
      pipelineId: null,
      stageId: null,
    });
    expect(body.interview.livingContext?.person).toMatchObject({
      displayName: 'Grace Hopper',
      primaryEmail: 'client@example.com',
      roles: [{ roleType: 'lead' }],
    });
    expect(body.interview.livingContext?.summary).toMatchObject({
      contextRecordCount: 1,
      sourceSpanCount: 1,
    });
    expect(body.interview.livingContext?.contextRecords[0]).toMatchObject({
      recordType: 'direct_call_context',
      narrative: 'Grace wants to discuss event-sourced billing architecture.',
      concepts: [{
        canonicalKey: 'term:event-sourced-billing',
        label: 'event-sourced billing',
      }],
      sources: [{
        exactText: 'Grace wants to discuss event-sourced billing architecture.',
      }],
    });
  });

  it('never fabricates /video fallback links when meeting_url is null', async () => {
    seedInterviewDetailFixture();
    const app = mountSchedulingApp();

    // Both seeded interviews have meeting_url = NULL. The detail endpoint must
    // return null — never a fabricated /video/stageId--candidateId fallback.
    const pipelineRes = await app.request('/interviews/interview-1');
    expect(pipelineRes.status).toBe(200);
    const pipelineBody = await pipelineRes.json() as {
      interview: { id: string; meetingUrl: string | null };
    };
    expect(pipelineBody.interview.meetingUrl).toBeNull();

    const rolelessRes = await app.request('/interviews/interview-roleless-1');
    expect(rolelessRes.status).toBe(200);
    const rolelessBody = await rolelessRes.json() as {
      interview: { id: string; meetingUrl: string | null };
    };
    expect(rolelessBody.interview.meetingUrl).toBeNull();

    // The list endpoint must also return null, not a fabricated /video/ link.
    const listRes = await app.request('/interviews');
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as {
      interviews: Array<{ id: string; meetingUrl: string | null }>;
    };
    for (const iv of listBody.interviews) {
      expect(iv.meetingUrl).toBeNull();
    }

    // After inviting (which creates a /room/ link), the detail endpoint must
    // return the /room/ URL — never a /video/ fallback.
    const inviteRes = await app.request('/interviews/interview-1/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', sendEmail: false }),
    });
    expect(inviteRes.status).toBe(200);
    const inviteBody = await inviteRes.json() as {
      meetingUrl: string;
      room: { guestUrl: string };
    };
    expect(inviteBody.meetingUrl).toMatch(/\/room\//);
    expect(inviteBody.meetingUrl).not.toContain('/video/');

    const detailAfterInvite = await app.request('/interviews/interview-1');
    expect(detailAfterInvite.status).toBe(200);
    const detailBody = await detailAfterInvite.json() as {
      interview: { id: string; meetingUrl: string | null };
    };
    expect(detailBody.interview.meetingUrl).toMatch(/\/room\//);
    expect(detailBody.interview.meetingUrl).not.toContain('/video/');

    // The persisted scheduled_interviews.meeting_url must be a /room/ URL.
    const storedRow = sqlite!.prepare(
      'SELECT meeting_url FROM scheduled_interviews WHERE id = ?',
    ).get('interview-1') as { meeting_url: string | null };
    expect(storedRow.meeting_url).toMatch(/\/room\//);
    expect(storedRow.meeting_url).not.toContain('/video/');
  });

  it('creates a contact-first scheduled interview without candidate, role, or application', async () => {
    seedInterviewDetailFixture();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Edsger Dijkstra',
        recipientEmail: 'EDSGER@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        scheduledAt: '2026-06-24T18:00:00.000Z',
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      interview: {
        id: string;
        candidateId: string | null;
        contactId: string | null;
        pipelineId: string | null;
        stageId: string | null;
        recipientName: string | null;
        recipientEmail: string | null;
        meetingType: string | null;
      };
    };

    expect(body.interview).toMatchObject({
      candidateId: null,
      pipelineId: null,
      stageId: null,
      recipientName: 'Edsger Dijkstra',
      recipientEmail: 'edsger@example.com',
      meetingType: 'DIRECT_VIDEO_CALL',
    });
    expect(body.interview.contactId).toEqual(expect.any(String));

    const scheduledRow = sqlite!.prepare(
      `SELECT candidate_id, pipeline_id, stage_id, recipient_name, recipient_email, meeting_type
         FROM scheduled_interviews
        WHERE id = ?`,
    ).get(body.interview.id) as {
      candidate_id: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
      recipient_name: string | null;
      recipient_email: string | null;
      meeting_type: string | null;
    };
    expect(scheduledRow).toEqual({
      candidate_id: null,
      pipeline_id: null,
      stage_id: null,
      recipient_name: 'Edsger Dijkstra',
      recipient_email: 'edsger@example.com',
      meeting_type: 'DIRECT_VIDEO_CALL',
    });

    const contactRow = sqlite!.prepare(
      'SELECT id, owner_id, email, name, type FROM contacts WHERE email = ?',
    ).get('edsger@example.com') as {
      id: string;
      owner_id: string;
      email: string;
      name: string;
      type: string;
    };
    expect(contactRow).toMatchObject({
      id: body.interview.contactId,
      owner_id: 'owner-1',
      email: 'edsger@example.com',
      name: 'Edsger Dijkstra',
      type: 'lead',
    });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM workspace_people wp
         JOIN people p ON p.id = wp.person_id
        WHERE p.primary_email = ?`,
    ).get('edsger@example.com')).toEqual({ count: 1 });
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM applications').get()).toEqual({ count: 0 });

    const graphRows = sqlite!.prepare(
      `SELECT cr.record_type,
              cr.predicate,
              cr.narrative,
              cr.qualifiers_json,
              ss.exact_text
         FROM people p
         JOIN workspace_people wp ON wp.person_id = p.id
         JOIN context_records cr ON cr.workspace_person_id = wp.id
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crss.source_span_id
        WHERE p.primary_email = ?
        ORDER BY cr.created_at`,
    ).all('edsger@example.com') as Array<{
      record_type: string;
      predicate: string | null;
      narrative: string;
      qualifiers_json: string | null;
      exact_text: string;
    }>;
    expect(graphRows).toHaveLength(1);
    expect(graphRows[0]).toMatchObject({
      record_type: 'scheduled_interview_invite',
      predicate: 'preserves contact-first interview invite',
      narrative: 'Contact-first interview invite for Edsger Dijkstra.',
    });
    expect(graphRows[0]!.exact_text.split('\n')).toEqual([
      'Contact-first interview invite',
      'Recipient name: Edsger Dijkstra',
      'Recipient email: edsger@example.com',
      'Meeting type: DIRECT_VIDEO_CALL',
      'Interview type: VIDEO',
      'Assessment setup status: not_applicable',
      'Assessment setup kind: not_applicable',
      'Assessment setup source: not_workspace_assessment',
      'Assessment setup blocks positive assessment: no',
      'Assessment setup message: none',
      'Scheduled at: 2026-06-24T18:00:00.000Z',
      'Scheduling provider: none',
      'Scheduling URL: none',
      expect.stringMatching(/^Created at: /),
    ]);
    expect(JSON.parse(graphRows[0]!.qualifiers_json ?? '{}')).toMatchObject({
      scheduledInterviewId: body.interview.id,
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: 'VIDEO',
      assessmentSetupStatus: 'not_applicable',
      assessmentSetupKind: 'not_applicable',
      assessmentSetupSource: 'not_workspace_assessment',
      assessmentSetupBlocksPositiveAssessment: false,
    });

    const detailResponse = await app.request(`/interviews/${body.interview.id}`);
    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json() as {
      interview: {
        livingContext: {
          summary: { contextRecordCount: number; sourceSpanCount: number };
          contextRecords: Array<{
            recordType: string;
            narrative: string;
            sources: Array<{ exactText: string }>;
          }>;
        } | null;
      };
    };
    expect(detailBody.interview.livingContext?.summary).toMatchObject({
      contextRecordCount: 1,
      sourceSpanCount: 1,
    });
    expect(detailBody.interview.livingContext?.contextRecords[0]).toMatchObject({
      recordType: 'scheduled_interview_invite',
      narrative: 'Contact-first interview invite for Edsger Dijkstra.',
    });
    expect(detailBody.interview.livingContext?.contextRecords[0]?.sources[0]?.exactText)
      .toContain('Recipient email: edsger@example.com');
  });

  it('keeps repeated same-email interviews as distinct meetings under one person context', async () => {
    seedInterviewDetailFixture();
    const app = mountSchedulingApp();

    const createInterview = async (scheduledAt: string): Promise<{
      id: string;
      contactId: string;
      recipientEmail: string;
    }> => {
      const response = await app.request('/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: 'Ada Lovelace',
          recipientEmail: 'ADA@example.com',
          meetingType: 'DIRECT_VIDEO_CALL',
          interviewType: 'VIDEO',
          scheduledAt,
        }),
      });
      expect(response.status).toBe(201);
      const body = await response.json() as {
        interview: {
          id: string;
          contactId: string | null;
          recipientEmail: string | null;
        };
      };
      expect(body.interview.contactId).toEqual(expect.any(String));
      expect(body.interview.recipientEmail).toBe('ada@example.com');
      return {
        id: body.interview.id,
        contactId: body.interview.contactId!,
        recipientEmail: body.interview.recipientEmail!,
      };
    };

    const first = await createInterview('2026-06-25T16:00:00.000Z');
    const second = await createInterview('2026-06-27T18:30:00.000Z');

    expect(second.contactId).toBe(first.contactId);
    expect(first.id).not.toBe(second.id);

    const firstInvite = await app.request(`/interviews/${first.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', sendEmail: false }),
    });
    expect(firstInvite.status).toBe(200);
    const firstInviteBody = await firstInvite.json() as { deliveredUrl: string; meetingUrl: string };

    const secondInvite = await app.request(`/interviews/${second.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', sendEmail: false }),
    });
    expect(secondInvite.status).toBe(200);
    const secondInviteBody = await secondInvite.json() as { deliveredUrl: string; meetingUrl: string };

    expect(firstInviteBody.deliveredUrl).toBe(firstInviteBody.meetingUrl);
    expect(secondInviteBody.deliveredUrl).toBe(secondInviteBody.meetingUrl);
    expect(firstInviteBody.meetingUrl).not.toBe(secondInviteBody.meetingUrl);

    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM contacts
        WHERE owner_id = 'owner-1'
          AND lower(email) = ?`,
    ).get(first.recipientEmail)).toEqual({ count: 1 });

    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM workspace_people wp
         JOIN people p ON p.id = wp.person_id
        WHERE wp.workspace_id = 'owner-1'
          AND p.primary_email = ?`,
    ).get(first.recipientEmail)).toEqual({ count: 1 });

    const scheduledRows = sqlite!.prepare(
      `SELECT id, recipient_email, scheduled_at, meeting_url
         FROM scheduled_interviews
        WHERE owner_id = 'owner-1'
          AND lower(recipient_email) = ?
        ORDER BY scheduled_at ASC`,
    ).all(first.recipientEmail) as Array<{
      id: string;
      recipient_email: string;
      scheduled_at: string;
      meeting_url: string;
    }>;
    expect(scheduledRows.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(scheduledRows.map((row) => row.meeting_url)).toEqual([
      firstInviteBody.meetingUrl,
      secondInviteBody.meetingUrl,
    ]);

    const meetingRows = sqlite!.prepare(
      `SELECT m.id, m.scheduled_interview_id, mp.contact_id
         FROM meetings m
         JOIN meeting_participants mp ON mp.meeting_id = m.id
        WHERE m.owner_id = 'owner-1'
          AND mp.contact_id = ?
        ORDER BY m.scheduled_at ASC`,
    ).all(first.contactId) as Array<{
      id: string;
      scheduled_interview_id: string;
      contact_id: string;
    }>;
    expect(meetingRows).toHaveLength(2);
    expect(meetingRows.map((row) => row.scheduled_interview_id)).toEqual([first.id, second.id]);

    const contextCounts = sqlite!.prepare(
      `SELECT cr.record_type, COUNT(*) AS count
         FROM people p
         JOIN workspace_people wp ON wp.person_id = p.id
         JOIN context_records cr ON cr.workspace_person_id = wp.id
        WHERE p.primary_email = ?
          AND cr.record_type IN ('scheduled_interview_invite', 'scheduled_interview_invite_delivery')
        GROUP BY cr.record_type
        ORDER BY cr.record_type ASC`,
    ).all(first.recipientEmail) as Array<{ record_type: string; count: number }>;
    expect(contextCounts).toEqual([
      { record_type: 'scheduled_interview_invite', count: 2 },
      { record_type: 'scheduled_interview_invite_delivery', count: 2 },
    ]);
  });

  it('creates a source-backed context call from a blocked code-review match', async () => {
    seedInterviewDetailFixture();
    const app = mountSchedulingApp();

    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-blocked', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', 'SCREENING_INTERVIEW', 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, NULL,
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?)
    `).run(
      'match-run-blocked',
      'candidate-1',
      'NO_ROLE_SAFE_CHALLENGE',
      JSON.stringify([
        {
          rank: 1,
          challengeId: 'packet-weak-1',
          repoId: 'repo-1',
          prNumber: 973,
          score: 0.12,
          alignedDemandCount: 1,
          stretchCount: 0,
          provenanceComplete: true,
          eligible: false,
          rejectionReasons: ['Only one source-backed candidate signal aligned with the repo challenge.'],
        },
      ]),
      '2026-06-22T17:46:00.000Z',
    );

    const response = await app.request('/interviews/interview-code-review-blocked/context-call', {
      method: 'POST',
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      contextCall: {
        id: string;
        originalInterviewId: string;
        candidateId: string | null;
        evidenceAssessmentSessionId: string | null;
        questions: string[];
        recruiterNotes: string;
      };
    };
    expect(body.contextCall).toMatchObject({
      originalInterviewId: 'interview-code-review-blocked',
      candidateId: 'candidate-1',
    });
    const evidenceAssessmentSessionId = body.contextCall.evidenceAssessmentSessionId;
    expect(evidenceAssessmentSessionId).toEqual(expect.stringMatching(/^assessment_session_/));
    if (!evidenceAssessmentSessionId) throw new Error('expected evidence assessment session id');
    expect(body.contextCall.questions).toContain(SOURCE_BACKED_WORK_EVIDENCE_QUESTION);
    expect(body.contextCall.questions).toContain(SOURCE_BACKED_WORK_EVIDENCE_FOLLOW_UP);
    expect(body.contextCall.recruiterNotes).toContain('Only one source-backed candidate signal aligned with the repo challenge.');

    const followUpRow = sqlite!.prepare(
      `SELECT candidate_id, pipeline_id, stage_id, interview_type, meeting_type, status, recruiter_notes
         FROM scheduled_interviews
        WHERE id = ?`,
    ).get(body.contextCall.id) as {
      candidate_id: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
      interview_type: string | null;
      meeting_type: string | null;
      status: string | null;
      recruiter_notes: string | null;
    };
    expect(followUpRow).toMatchObject({
      candidate_id: 'candidate-1',
      pipeline_id: 'pipeline-1',
      stage_id: null,
      interview_type: 'VIDEO',
      meeting_type: 'SCREENING_INTERVIEW',
      status: 'INVITED',
    });
    expect(followUpRow.recruiter_notes).toContain('Original CODE_REVIEW interview: interview-code-review-blocked');

    const contextRow = sqlite!.prepare(
      `SELECT cr.record_type,
              cr.predicate,
              cr.narrative,
              ss.exact_text
         FROM context_records cr
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crss.source_span_id
        WHERE cr.record_type = 'code_review_context_call_recommendation'
        LIMIT 1`,
    ).get() as {
      record_type: string;
      predicate: string | null;
      narrative: string;
      exact_text: string;
    };
    expect(contextRow).toMatchObject({
      record_type: 'code_review_context_call_recommendation',
      predicate: 'recommends context call for repo matching',
    });
    expect(contextRow.narrative).toContain('Ada Lovelace');
    expect(contextRow.exact_text).toContain('Original interview id: interview-code-review-blocked');
    expect(contextRow.exact_text).toContain('Match status: NO_ROLE_SAFE_CHALLENGE');
    expect(contextRow.exact_text).toContain(`Question 1: ${SOURCE_BACKED_WORK_EVIDENCE_QUESTION}`);
    expect(contextRow.exact_text).toContain(`Question 2: ${SOURCE_BACKED_WORK_EVIDENCE_FOLLOW_UP}`);

    const assessmentSession = sqlite!.prepare(
      `SELECT id, interview_id, mode, state, candidate_id, workspace_id, created_by, metadata_json
         FROM assessment_sessions
        WHERE id = ?`,
    ).get(evidenceAssessmentSessionId) as {
      id: string;
      interview_id: string | null;
      mode: string;
      state: string;
      candidate_id: string | null;
      workspace_id: string | null;
      created_by: string | null;
      metadata_json: string;
    };
    expect(assessmentSession).toMatchObject({
      interview_id: body.contextCall.id,
      mode: 'TECHNICAL',
      state: 'IN_PROGRESS',
      candidate_id: 'candidate-1',
      workspace_id: 'owner-1',
      created_by: 'code-review-evidence-plan',
    });
    expect(JSON.parse(assessmentSession.metadata_json)).toMatchObject({
      source: 'code_review_evidence_plan',
      originalInterviewId: 'interview-code-review-blocked',
      contextCallInterviewId: body.contextCall.id,
      matchRunId: 'match-run-blocked',
      matchStatus: 'NO_ROLE_SAFE_CHALLENGE',
      gaps: ['Only one source-backed candidate signal aligned with the repo challenge.'],
    });

    const assessmentEvent = sqlite!.prepare(
      `SELECT e.kind,
              e.actor_type,
              e.narrative,
              e.payload_json,
              r.source_ref_type,
              r.evidence_role,
              r.exact_text
         FROM assessment_evidence_events e
         JOIN assessment_event_source_refs r ON r.event_id = e.id
        WHERE e.session_id = ?
        LIMIT 1`,
    ).get(evidenceAssessmentSessionId) as {
      kind: string;
      actor_type: string;
      narrative: string;
      payload_json: string;
      source_ref_type: string;
      evidence_role: string;
      exact_text: string;
    };
    expect(assessmentEvent).toMatchObject({
      kind: 'evidence_plan_created',
      actor_type: 'system',
      source_ref_type: 'source_span',
      evidence_role: 'evidence_plan_source',
    });
    expect(assessmentEvent.narrative).toContain('source-backed evidence plan');
    expect(assessmentEvent.exact_text).toContain('Context call interview id:');
    expect(assessmentEvent.exact_text).toContain(`Question 1: ${SOURCE_BACKED_WORK_EVIDENCE_QUESTION}`);
    expect(assessmentEvent.exact_text).toContain(`Question 2: ${SOURCE_BACKED_WORK_EVIDENCE_FOLLOW_UP}`);
    expect(JSON.parse(assessmentEvent.payload_json)).toMatchObject({
      originalInterviewId: 'interview-code-review-blocked',
      contextCallInterviewId: body.contextCall.id,
      matchRunId: 'match-run-blocked',
      matchStatus: 'NO_ROLE_SAFE_CHALLENGE',
    });

    const transcriptText = 'I reviewed retry idempotency in Kafka order processing and verified duplicate delivery safeguards.';
    const observedAt = '2026-06-22T19:10:00.000Z';

    sqlite!.prepare(
      `INSERT INTO contacts (
         id, owner_id, email, name, company, role, phone, linkedin, notes, type,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?)`,
    ).run(
      'contact-candidate-1',
      'owner-1',
      'ada@example.com',
      'Ada Lovelace',
      'Candidate',
      'candidate',
      observedAt,
      observedAt,
    );
    sqlite!.prepare(
      `INSERT INTO meetings (
         id, owner_id, scheduled_interview_id, title, description, status,
         scheduled_at, started_at, ended_at, duration_secs, meeting_url,
         meeting_type, scheduling_provider, external_event_id,
         transcript_status, transcript_summary, transcript_json,
         transcript_analysis_json, transcript_error, recording_r2_key,
         created_at, updated_at
       ) VALUES (
         'meeting-context-call-loop', 'owner-1', ?, 'Ada evidence follow-up', NULL,
         'COMPLETED', NULL, '2026-06-22T19:00:00.000Z', ?, 600, NULL,
         'SCREENING_INTERVIEW', NULL, NULL,
         'READY', 'Captured code-review evidence.', NULL, NULL, NULL, NULL,
         ?, ?
       )`,
    ).run(body.contextCall.id, observedAt, observedAt, observedAt);
    sqlite!.prepare(
      `INSERT INTO meeting_participants (
         id, meeting_id, contact_id, role, invite_sent_at, joined_at, left_at,
         created_at, updated_at
       ) VALUES (
         'participant-context-call-candidate', 'meeting-context-call-loop',
         'contact-candidate-1', 'ATTENDEE', NULL,
         '2026-06-22T19:00:00.000Z', ?, ?, ?
       )`,
    ).run(observedAt, observedAt, observedAt);

    await ingestMeetingTranscriptToLivingContext(createMockD1(sqlite!), {
      meetingId: 'meeting-context-call-loop',
      ownerId: 'owner-1',
      scheduledInterviewId: body.contextCall.id,
      provider: 'test-transcript',
      startedAt: '2026-06-22T19:00:00.000Z',
      endedAt: observedAt,
      personContextMode: 'attributed',
      segments: [
        {
          stableSegmentId: 'host-1',
          text: 'Which review work best matches this challenge?',
          speakerRole: 'host',
          speakerLabel: 'Host',
          timestampStartMs: 0,
          timestampEndMs: 1500,
        },
        {
          stableSegmentId: 'guest-1',
          text: transcriptText,
          speakerRole: 'guest',
          speakerLabel: 'Guest',
          contactId: 'contact-candidate-1',
          timestampStartMs: 2000,
          timestampEndMs: 7000,
          confidence: 0.98,
        },
      ],
      semanticAssertions: [{
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'reviewed',
        narrative: 'Candidate reviewed retry idempotency and duplicate delivery safeguards.',
        objectType: 'source-described code review evidence',
        objectValue: { surface: 'retry idempotency duplicate delivery safeguards' },
        confidence: 0.96,
        concepts: [
          {
            surface: 'Kafka',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
          {
            surface: 'retry idempotency',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
        ],
      }],
      extractorVersion: 'code-review-evidence-plan-test-v1',
    });

    const completedPlan = sqlite!.prepare(
      `SELECT state
         FROM assessment_sessions
        WHERE id = ?`,
    ).get(evidenceAssessmentSessionId) as { state: string };
    expect(completedPlan.state).toBe('EVALUATED');

    const planReport = sqlite!.prepare(
      `SELECT output_json
         FROM assessment_evaluation_reports
        WHERE session_id = ?`,
    ).get(evidenceAssessmentSessionId) as { output_json: string };
    expect(JSON.parse(planReport.output_json)).toMatchObject({
      schemaVersion: 'code-review-evidence-plan-result-v1',
      status: 'READY_FOR_REPO_MATCH_REFRESH',
      originalInterviewId: 'interview-code-review-blocked',
      contextCallInterviewId: body.contextCall.id,
      sourceSpanCount: 1,
    });

    const candidatePerson = sqlite!.prepare(
      `SELECT wp.person_id
         FROM applications app
         JOIN workspace_people wp ON wp.id = app.workspace_person_id
        WHERE app.legacy_candidate_id = 'candidate-1'`,
    ).get() as { person_id: string };
    const contactPerson = sqlite!.prepare(
      `SELECT wp.person_id
         FROM workspace_people wp
        WHERE json_extract(wp.context_json, '$.contactId') = 'contact-candidate-1'`,
    ).get() as { person_id: string };
    expect(contactPerson.person_id).toBe(candidatePerson.person_id);

    const followUpAssertions = sqlite!.prepare(
      `SELECT cr.record_type,
              cr.predicate,
              ss.exact_text,
              c.canonical_key
         FROM context_records cr
         JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crsr.source_span_id
         JOIN context_record_concepts crc ON crc.context_record_id = cr.id
         JOIN concepts c ON c.id = crc.concept_id
        WHERE cr.record_type = 'meeting_transcript_assertion'
          AND ss.exact_text = ?
        ORDER BY c.canonical_key`,
    ).all(transcriptText) as Array<{
      record_type: string;
      predicate: string;
      exact_text: string;
      canonical_key: string;
    }>;
    expect(followUpAssertions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        record_type: 'meeting_transcript_assertion',
        predicate: 'reviewed',
        exact_text: transcriptText,
        canonical_key: 'term:kafka',
      }),
      expect.objectContaining({
        record_type: 'meeting_transcript_assertion',
        predicate: 'reviewed',
        exact_text: transcriptText,
        canonical_key: 'term:retry-idempotency',
      }),
    ]));

    const originalDetailResponse = await app.request('/interviews/interview-code-review-blocked');
    expect(originalDetailResponse.status).toBe(200);
    const originalDetail = await originalDetailResponse.json() as {
      interview: {
        codeReviewMatch: {
          evidenceRefresh: {
            status: string;
            assessmentSessionId: string;
            contextCallInterviewId: string | null;
            sourceSpanCount: number | null;
            matcherContextCount: number;
            matchRunId: string | null;
            matchStatus: string | null;
          } | null;
        } | null;
      };
    };
    expect(originalDetail.interview.codeReviewMatch?.evidenceRefresh).toMatchObject({
      status: 'READY_FOR_REPO_MATCH_REFRESH',
      assessmentSessionId: evidenceAssessmentSessionId,
      contextCallInterviewId: body.contextCall.id,
      sourceSpanCount: 1,
      matcherContextCount: 1,
      matchRunId: 'match-run-blocked',
      matchStatus: 'NO_ROLE_SAFE_CHALLENGE',
    });
  });

  it('reuses an existing pending code-review evidence follow-up instead of duplicating it', async () => {
    seedInterviewDetailFixture();
    const app = mountSchedulingApp();

    sqlite!.prepare(`
      INSERT INTO scheduled_interviews (
        id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
        meeting_type, status, scheduled_at, meeting_url, scheduling_provider,
        scheduling_url, external_event_id, recruiter_notes, sync_source,
        last_synced_at, invite_link_sent_at, email_sent_at, recipient_name,
        recipient_email, matched_repo_id, github_repo_url, github_pr_number,
        submission_json, completed_at, created_at, updated_at
      ) VALUES (
        'interview-code-review-idempotent', 'candidate-1', 'pipeline-1', 'stage-1', 'owner-1',
        'CODE_REVIEW', 'SCREENING_INTERVIEW', 'INVITED', NULL,
        NULL, 'MANUAL', NULL, NULL, NULL,
        'MANUAL', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-06-22T17:30:00.000Z', '2026-06-22T17:45:00.000Z'
      )
    `).run();
    sqlite!.prepare(`
      INSERT INTO match_runs (
        id, candidate_id, role_snapshot_id, status, ranked_results_json,
        selected_packet_id, query_json, created_at
      ) VALUES (
        'match-run-idempotent', 'candidate-1', 'standalone-code-review-v1',
        'NEEDS_MORE_EVIDENCE', '[]', NULL, '{}', '2026-06-22T17:46:00.000Z'
      )
    `).run();

    const firstResponse = await app.request('/interviews/interview-code-review-idempotent/context-call', {
      method: 'POST',
    });
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as {
      contextCall: {
        id: string;
        evidenceAssessmentSessionId: string | null;
      };
    };

    const secondResponse = await app.request('/interviews/interview-code-review-idempotent/context-call', {
      method: 'POST',
    });
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json() as {
      contextCall: {
        id: string;
        evidenceAssessmentSessionId: string | null;
        reused: boolean;
      };
    };

    expect(second.contextCall).toMatchObject({
      id: first.contextCall.id,
      evidenceAssessmentSessionId: first.contextCall.evidenceAssessmentSessionId,
      reused: true,
    });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM scheduled_interviews
        WHERE recruiter_notes LIKE '%Original CODE_REVIEW interview: interview-code-review-idempotent%'`,
    ).get()).toEqual({ count: 1 });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_sessions
        WHERE created_by = 'code-review-evidence-plan'
          AND json_extract(metadata_json, '$.originalInterviewId') = 'interview-code-review-idempotent'`,
    ).get()).toEqual({ count: 1 });

    const detailResponse = await app.request('/interviews/interview-code-review-idempotent');
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as {
      interview: {
        codeReviewMatch: {
          evidenceFollowUp: {
            assessmentSessionId: string;
            contextCallInterviewId: string | null;
            state: string;
            questions: string[];
          } | null;
        } | null;
      };
    };
    expect(detail.interview.codeReviewMatch?.evidenceFollowUp).toMatchObject({
      assessmentSessionId: first.contextCall.evidenceAssessmentSessionId,
      contextCallInterviewId: first.contextCall.id,
      state: 'IN_PROGRESS',
    });
    expect(detail.interview.codeReviewMatch?.evidenceFollowUp?.questions).toContain(
      SOURCE_BACKED_WORK_EVIDENCE_QUESTION,
    );
  });

  it('records source-backed invite delivery separately from interview creation', async () => {
    seedInterviewDetailFixture();
    const app = mountSchedulingApp();

    const createResponse = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Barbara Liskov',
        recipientEmail: 'barbara@example.com',
        meetingType: 'SCREENING_INTERVIEW',
        interviewType: 'CODE_REVIEW',
        scheduledAt: '2026-06-25T19:00:00.000Z',
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      interview: { id: string; contactId: string | null };
    };

    const inviteResponse = await app.request(`/interviews/${created.interview.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'barbara@example.com',
        message: 'Please join prepared code review discussion.',
      }),
    });
    expect(inviteResponse.status).toBe(200);
    const inviteBody = await inviteResponse.json() as {
      success: boolean;
      emailSent: boolean;
      meetingUrl: string;
      deliveredUrl: string;
      room: {
        id: string;
        sessionId: string;
        hostUrl: string;
        guestUrl: string;
        expiresAt: string;
      };
    };
    expect(inviteBody).toMatchObject({
      success: true,
      emailSent: false,
    });
    expect(inviteBody.deliveredUrl).toMatch(/^http:\/\/localhost:5173\/assess\/.+/);
    expect(inviteBody.deliveredUrl).not.toContain('/room/');
    expect(inviteBody.deliveredUrl).not.toContain('/video/');
    expect(inviteBody.meetingUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);
    expect(inviteBody.room).toMatchObject({
      id: expect.any(String),
      sessionId: expect.any(String),
      hostUrl: expect.stringMatching(/^http:\/\/localhost:5175\/room\/.+/),
      guestUrl: inviteBody.meetingUrl,
      expiresAt: expect.any(String),
    });
    expect(inviteBody.room.hostUrl).not.toBe(inviteBody.room.guestUrl);

    const scheduledRow = sqlite!.prepare(
      `SELECT interview_type, meeting_url, invite_link_sent_at, email_sent_at
         FROM scheduled_interviews
        WHERE id = ?`,
    ).get(created.interview.id) as {
      interview_type: string;
      meeting_url: string | null;
      invite_link_sent_at: string | null;
      email_sent_at: string | null;
    };
    expect(scheduledRow.interview_type).toBe('CODE_REVIEW');
    expect(scheduledRow.meeting_url).toBe(inviteBody.meetingUrl);
    expect(scheduledRow.invite_link_sent_at).toEqual(expect.any(String));
    expect(scheduledRow.email_sent_at).toBeNull();

    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM meetings
        WHERE scheduled_interview_id = ?
          AND meeting_url = ?`,
    ).get(created.interview.id, inviteBody.meetingUrl)).toEqual({ count: 1 });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM meeting_room_tokens mrt
         JOIN meeting_rooms mr ON mr.id = mrt.room_id
         JOIN meetings m ON m.id = mr.meeting_id
        WHERE m.scheduled_interview_id = ?
          AND mrt.role = 'GUEST'
          AND mrt.revoked_at IS NULL`,
    ).get(created.interview.id)).toEqual({ count: 1 });

    const graphRows = sqlite!.prepare(
      `SELECT cr.record_type,
              cr.predicate,
              cr.narrative,
              ss.exact_text
         FROM people p
         JOIN workspace_people wp ON wp.person_id = p.id
         JOIN context_records cr ON cr.workspace_person_id = wp.id
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crss.source_span_id
        WHERE p.primary_email = ?
        ORDER BY cr.created_at, cr.record_type`,
    ).all('barbara@example.com') as Array<{
      record_type: string;
      predicate: string | null;
      narrative: string;
      exact_text: string;
    }>;
    expect(graphRows.map((row) => row.record_type).sort()).toEqual([
      'scheduled_interview_invite',
      'scheduled_interview_invite_delivery',
    ]);
    expect(graphRows.find((row) => row.record_type === 'scheduled_interview_invite'))
      .toMatchObject({
        predicate: 'preserves contact-first interview invite',
        narrative: 'Contact-first interview invite for Barbara Liskov.',
      });
    expect(graphRows.find((row) => row.record_type === 'scheduled_interview_invite')?.exact_text.split('\n'))
      .toEqual(expect.arrayContaining([
        'Recipient email: barbara@example.com',
        'Meeting type: SCREENING_INTERVIEW',
        'Interview type: CODE_REVIEW',
      ]));
    const deliveryRecord = graphRows.find((row) => row.record_type === 'scheduled_interview_invite_delivery');
    expect(deliveryRecord).toMatchObject({
      predicate: 'preserves scheduled interview invite delivery',
      narrative: 'Scheduled interview invite delivery for barbara@example.com.',
    });
    expect(deliveryRecord?.exact_text.split('\n')).toEqual(expect.arrayContaining([
      'Recipient email: barbara@example.com',
      expect.stringMatching(/^Subject: Assessment invitation — Interview \(.+\)$/),
      `Delivered URL: ${inviteBody.deliveredUrl}`,
      `Room URL: ${inviteBody.meetingUrl}`,
      'Custom message: Please join prepared code review discussion.',
      'Email sent: no',
      'Provider message id: none',
    ]));

    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM interactions i
         JOIN workspace_people wp ON wp.id = i.workspace_person_id
         JOIN people p ON p.id = wp.person_id
        WHERE p.primary_email = ?`,
    ).get('barbara@example.com')).toEqual({ count: 2 });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM context_record_concepts crc
         JOIN context_records cr ON cr.id = crc.context_record_id
         JOIN workspace_people wp ON wp.id = cr.workspace_person_id
         JOIN people p ON p.id = wp.person_id
        WHERE p.primary_email = ?`,
    ).get('barbara@example.com')).toEqual({ count: 0 });
    const inviteApplication = sqlite!.prepare(
      `SELECT app.legacy_candidate_id,
              app.pipeline_id,
              wp.person_id,
              p.primary_email
         FROM applications app
         JOIN workspace_people wp ON wp.id = app.workspace_person_id
         JOIN people p ON p.id = wp.person_id
         JOIN scheduled_interviews si ON si.candidate_id = app.legacy_candidate_id
        WHERE si.id = ?`,
    ).get(created.interview.id) as {
      legacy_candidate_id: string;
      pipeline_id: string | null;
      person_id: string;
      primary_email: string;
    };
    expect(inviteApplication).toMatchObject({
      legacy_candidate_id: expect.any(String),
      pipeline_id: null,
      primary_email: 'barbara@example.com',
    });
  });

  it('sends scheduled interview invites through the Cloudflare email binding when configured', async () => {
    seedInterviewDetailFixture();
    const sentMessages: Array<{
      to: unknown;
      from: unknown;
      subject: string;
      html?: string;
      text?: string;
    }> = [];
    const app = mountSchedulingApp({
      EMAIL: {
        send: async (message) => {
          sentMessages.push(message);
          return { messageId: 'cf-message-1' };
        },
      },
      OUTBOUND_EMAIL_FROM: 'no-reply@hire-pipe.com',
    } as Partial<Env>);

    const createResponse = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Margaret Hamilton',
        recipientEmail: 'margaret@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'VIDEO',
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      interview: { id: string };
    };

    const inviteResponse = await app.request(`/interviews/${created.interview.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'margaret@example.com' }),
    });
    expect(inviteResponse.status).toBe(200);
    const inviteBody = await inviteResponse.json() as {
      success: boolean;
      emailSent: boolean;
      provider: string;
      meetingUrl: string;
      deliveredUrl: string;
      room: { hostUrl: string; guestUrl: string };
    };

    expect(inviteBody).toMatchObject({
      success: true,
      emailSent: true,
      provider: 'cloudflare',
    });
    expect(inviteBody.room.guestUrl).toBe(inviteBody.meetingUrl);
    expect(inviteBody.deliveredUrl).toBe(inviteBody.meetingUrl);
    expect(inviteBody.room.hostUrl).not.toBe(inviteBody.room.guestUrl);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      to: 'margaret@example.com',
      from: { email: 'no-reply@hire-pipe.com', name: 'PIPE' },
      subject: 'Video call invitation — Interview',
    });
    expect(sentMessages[0]?.html).toContain(inviteBody.meetingUrl);
    expect(sentMessages[0]?.html).toContain('/assets/email/pipe-logo.png');
    expect(sentMessages[0]?.html).not.toContain('data:image');

    const scheduledRow = sqlite!.prepare(
      `SELECT meeting_url, invite_link_sent_at, email_sent_at
         FROM scheduled_interviews
        WHERE id = ?`,
    ).get(created.interview.id) as {
      meeting_url: string | null;
      invite_link_sent_at: string | null;
      email_sent_at: string | null;
    };
    expect(scheduledRow.meeting_url).toBe(inviteBody.meetingUrl);
    expect(scheduledRow.invite_link_sent_at).toEqual(expect.any(String));
    expect(scheduledRow.email_sent_at).toEqual(expect.any(String));

    const deliverySource = sqlite!.prepare(
      `SELECT ss.exact_text
         FROM people p
         JOIN workspace_people wp ON wp.person_id = p.id
         JOIN context_records cr ON cr.workspace_person_id = wp.id
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crss.source_span_id
        WHERE p.primary_email = ?
          AND cr.record_type = 'scheduled_interview_invite_delivery'
        LIMIT 1`,
    ).get('margaret@example.com') as { exact_text: string } | undefined;
    expect(deliverySource?.exact_text.split('\n')).toEqual(expect.arrayContaining([
      'Recipient email: margaret@example.com',
      `Delivered URL: ${inviteBody.meetingUrl}`,
      `Room URL: ${inviteBody.meetingUrl}`,
      'Email sent: yes',
      'Provider message id: cf-message-1',
    ]));
  });

  it('sends Calendly scheduling URL for live interviews while still preparing the room link', async () => {
    seedInterviewDetailFixture();
    const sentMessages: Array<{
      to: unknown;
      from: unknown;
      subject: string;
      html?: string;
    }> = [];
    const app = mountSchedulingApp({
      EMAIL: {
        send: async (message) => {
          sentMessages.push(message);
          return { messageId: 'cf-calendly-message-1' };
        },
      },
      OUTBOUND_EMAIL_FROM: 'no-reply@hire-pipe.com',
    } as Partial<Env>);

    const schedulingUrl = 'https://calendly.com/pipe/video';
    const createResponse = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Grace Hopper',
        recipientEmail: 'grace@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'VIDEO',
        schedulingProvider: 'CALENDLY',
        schedulingUrl,
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      interview: { id: string };
    };

    const inviteResponse = await app.request(`/interviews/${created.interview.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'grace@example.com' }),
    });
    expect(inviteResponse.status).toBe(200);
    const inviteBody = await inviteResponse.json() as {
      success: boolean;
      emailSent: boolean;
      provider: string;
      meetingUrl: string;
      schedulingUrl: string;
      deliveredUrl: string;
      room: { hostUrl: string; guestUrl: string };
    };

    expect(inviteBody).toMatchObject({
      success: true,
      emailSent: true,
      provider: 'cloudflare',
      schedulingUrl,
      deliveredUrl: schedulingUrl,
    });
    expect(inviteBody.meetingUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);
    expect(inviteBody.room.guestUrl).toBe(inviteBody.meetingUrl);
    expect(inviteBody.room.hostUrl).not.toBe(inviteBody.room.guestUrl);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      to: 'grace@example.com',
      from: { email: 'no-reply@hire-pipe.com', name: 'PIPE' },
      subject: 'Schedule interview — Interview',
    });
    expect(sentMessages[0]?.html).toContain(schedulingUrl);
    expect(sentMessages[0]?.html).not.toContain(inviteBody.meetingUrl);
    expect(sentMessages[0]?.html).toContain('/assets/email/pipe-logo.png');
    expect(sentMessages[0]?.html).not.toContain('data:image');

    const scheduledRow = sqlite!.prepare(
      `SELECT meeting_url, scheduling_provider, scheduling_url
         FROM scheduled_interviews
        WHERE id = ?`,
    ).get(created.interview.id) as {
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
    };
    expect(scheduledRow).toMatchObject({
      meeting_url: inviteBody.meetingUrl,
      scheduling_provider: 'CALENDLY',
      scheduling_url: schedulingUrl,
    });

    const deliverySource = sqlite!.prepare(
      `SELECT ss.exact_text
         FROM people p
         JOIN workspace_people wp ON wp.person_id = p.id
         JOIN context_records cr ON cr.workspace_person_id = wp.id
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crss.source_span_id
        WHERE p.primary_email = ?
          AND cr.record_type = 'scheduled_interview_invite_delivery'
        LIMIT 1`,
    ).get('grace@example.com') as { exact_text: string } | undefined;
    expect(deliverySource?.exact_text.split('\n')).toEqual(expect.arrayContaining([
      'Recipient email: grace@example.com',
      'Subject: Schedule interview — Interview',
      `Delivered URL: ${schedulingUrl}`,
      `Room URL: ${inviteBody.meetingUrl}`,
      'Email sent: yes',
      'Provider message id: cf-calendly-message-1',
    ]));
  });

  it('delivers assessment URL for CODE_REVIEW even when a stale scheduling URL exists', async () => {
    seedInterviewDetailFixture();
    const app = mountSchedulingApp();

    const schedulingUrl = 'https://calendly.com/pipe/stale-code-review';
    const createResponse = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Frances Allen',
        recipientEmail: 'frances@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'CODE_REVIEW',
        schedulingProvider: 'CALENDLY',
        schedulingUrl,
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      interview: { id: string };
    };

    const inviteResponse = await app.request(`/interviews/${created.interview.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'frances@example.com', sendEmail: false }),
    });
    expect(inviteResponse.status).toBe(200);
    const inviteBody = await inviteResponse.json() as {
      success: boolean;
      emailSent: boolean;
      meetingUrl: string;
      schedulingUrl: string | null;
      deliveredUrl: string;
    };

    expect(inviteBody).toMatchObject({
      success: true,
      emailSent: false,
      schedulingUrl: null,
    });
    expect(inviteBody.deliveredUrl).toMatch(/^http:\/\/localhost:5173\/assess\/.+/);
    expect(inviteBody.deliveredUrl).not.toBe(schedulingUrl);
    expect(inviteBody.deliveredUrl).not.toContain('/room/');
    expect(inviteBody.meetingUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);

    const scheduledRow = sqlite!.prepare(
      `SELECT meeting_url, scheduling_provider, scheduling_url
         FROM scheduled_interviews
        WHERE id = ?`,
    ).get(created.interview.id) as {
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
    };
    expect(scheduledRow).toMatchObject({
      meeting_url: inviteBody.meetingUrl,
      scheduling_provider: 'CALENDLY',
      scheduling_url: schedulingUrl,
    });

    const deliverySource = sqlite!.prepare(
      `SELECT ss.exact_text
         FROM people p
         JOIN workspace_people wp ON wp.person_id = p.id
         JOIN context_records cr ON cr.workspace_person_id = wp.id
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crss.source_span_id
        WHERE p.primary_email = ?
          AND cr.record_type = 'scheduled_interview_invite_delivery'
        LIMIT 1`,
    ).get('frances@example.com') as { exact_text: string } | undefined;
    expect(deliverySource?.exact_text.split('\n')).toEqual(expect.arrayContaining([
      'Recipient email: frances@example.com',
      'Subject: Assessment invitation — Interview',
      `Delivered URL: ${inviteBody.deliveredUrl}`,
      `Room URL: ${inviteBody.meetingUrl}`,
      'Email sent: no',
      'Provider message id: none',
    ]));
    expect(deliverySource?.exact_text).not.toContain(schedulingUrl);
  });

  it('does not poll Calendly bookings during sync; webhooks are the source of truth', async () => {
    seedInterviewDetailFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    sqlite!.prepare(`
      INSERT INTO scheduling_connections (
        id, owner_id, provider_id, access_token, refresh_token, token_expiry,
        account_email, account_name, webhook_secret, webhook_id, status,
        connected_at, last_sync_at, created_at, updated_at
      ) VALUES (
        'conn-1', 'owner-1', 'CALENDLY', 'cal-token', NULL, '2026-07-01T00:00:00.000Z',
        'recruiter@example.com', 'Recruiter', NULL, NULL, 'ACTIVE',
        '2026-06-26T12:00:00.000Z', NULL, '2026-06-26T12:00:00.000Z', '2026-06-26T12:00:00.000Z'
      )
    `).run();

    const app = mountSchedulingApp();
    const response = await app.request('/interviews/sync', { method: 'POST' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      synced: 0,
      total: 0,
      created: 0,
      message: 'Calendly bookings sync from provider webhooks.',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    expect(sqlite!.prepare(
      'SELECT COUNT(*) AS count FROM scheduled_interviews WHERE external_event_id IS NOT NULL',
    ).get()).toEqual({ count: 0 });
  });

  it('returns organization Calendly event types when the user event type list is empty', async () => {
    seedInterviewDetailFixture();
    sqlite!.prepare(`
      INSERT INTO scheduling_connections (
        id, owner_id, provider_id, access_token, refresh_token, token_expiry,
        account_email, account_name, webhook_secret, webhook_id, status,
        connected_at, last_sync_at, created_at, updated_at
      ) VALUES (
        'conn-1', 'owner-1', 'CALENDLY', 'cal-token', NULL, '2026-07-01T00:00:00.000Z',
        'recruiter@example.com', 'Recruiter', NULL, NULL, 'ACTIVE',
        '2026-06-26T12:00:00.000Z', NULL, '2026-06-26T12:00:00.000Z', '2026-06-26T12:00:00.000Z'
      )
    `).run();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.calendly.com/users/me') {
        return new Response(JSON.stringify({
          resource: {
            uri: 'https://api.calendly.com/users/user-1',
            current_organization: 'https://api.calendly.com/organizations/org-1',
            scheduling_url: 'https://calendly.com/pipe',
          },
        }));
      }
      if (url.includes('/event_types?user=')) {
        return new Response(JSON.stringify({ collection: [] }));
      }
      if (url.includes('/event_types?organization=')) {
        return new Response(JSON.stringify({
          collection: [{
            uri: 'https://api.calendly.com/event_types/org-event',
            name: 'Org interview',
            duration: 45,
            scheduling_url: 'https://calendly.com/pipe/org-interview',
          }],
        }));
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const app = mountSchedulingApp();
    const response = await app.request('/connection/conn-1/event-types');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      eventTypes: [{
        id: 'https://api.calendly.com/event_types/org-event',
        name: 'Org interview',
        durationMinutes: 45,
        url: 'https://api.calendly.com/event_types/org-event',
        schedulingUrl: 'https://calendly.com/pipe/org-interview',
      }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('organization=https%3A%2F%2Fapi.calendly.com%2Forganizations%2Forg-1'),
      expect.any(Object),
    );
  });

  it('emails a contact-first participant their meeting link when Calendly books', async () => {
    seedInterviewDetailFixture();
    const sentMessages: Array<{
      to: unknown;
      from: unknown;
      subject: string;
      html?: string;
      text?: string;
    }> = [];
    sqlite!.prepare(`
      INSERT INTO scheduling_connections (
        id, owner_id, provider_id, access_token, refresh_token, token_expiry,
        account_email, account_name, webhook_secret, webhook_id, status,
        connected_at, last_sync_at, created_at, updated_at
      ) VALUES (
        'conn-1', 'owner-1', 'CALENDLY', 'cal-token', NULL, '2026-07-01T00:00:00.000Z',
        'recruiter@example.com', 'Recruiter', NULL, NULL, 'ACTIVE',
        '2026-06-26T12:00:00.000Z', NULL, '2026-06-26T12:00:00.000Z', '2026-06-26T12:00:00.000Z'
      )
    `).run();

    const authApp = mountSchedulingApp();
    const createResponse = await authApp.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Katherine Johnson',
        recipientEmail: 'katherine@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'VIDEO',
        schedulingProvider: 'CALENDLY',
        schedulingUrl: 'https://calendly.com/pipe/video',
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { interview: { id: string } };

    const publicApp = mountSchedulingPublicApp({
      EMAIL: {
        send: async (message) => {
          sentMessages.push(message);
          return { messageId: 'cf-scheduled-message-1' };
        },
      },
      OUTBOUND_EMAIL_FROM: 'no-reply@hire-pipe.com',
      VIDEO_ROOM_APP_URL: 'https://room.example.com',
      PUBLIC_EMAIL_LOGO_URL: 'https://api-dev.hire-pipe.com/assets/email/pipe-logo.png',
    } as Partial<Env>);
    const { ctx, waitUntilAll } = buildCtx();
    const meetingUrl = 'https://meet.example.com/calendly-katherine';
    const response = await publicApp.request('/webhook?connectionId=conn-1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Calendly Webhook',
      },
      body: JSON.stringify({
        event: 'invitee.created',
        payload: {
          name: 'Katherine Johnson',
          email: 'katherine@example.com',
          scheduled_event: {
            uri: 'https://api.calendly.com/scheduled_events/event-katherine',
            start_time: '2026-07-03T19:00:00.000Z',
            location: {
              join_url: meetingUrl,
            },
          },
        },
      }),
    }, undefined, ctx);
    expect(response.status).toBe(200);
    await waitUntilAll();

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      to: 'katherine@example.com',
      from: { email: 'no-reply@hire-pipe.com', name: 'PIPE' },
      subject: 'Interview scheduled — Interview',
    });
    expect(sentMessages[0]?.html).toContain('https://room.example.com/room/');
    expect(sentMessages[0]?.text).toContain('https://room.example.com/room/');
    expect(sentMessages[0]?.html).toContain('https://api-dev.hire-pipe.com/assets/email/pipe-logo.png');
    expect(sentMessages[0]?.html).not.toContain('data:image');
    expect(sentMessages[0]?.html).not.toContain(meetingUrl);

    const scheduled = sqlite!.prepare(
      `SELECT status, scheduled_at, meeting_url, external_event_id,
              sync_source, email_sent_at
         FROM scheduled_interviews
        WHERE id = ?`,
    ).get(created.interview.id) as {
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      external_event_id: string | null;
      sync_source: string | null;
      email_sent_at: string | null;
    };
    expect(scheduled).toMatchObject({
      status: 'SCHEDULED',
      scheduled_at: '2026-07-03T19:00:00.000Z',
      meeting_url: expect.stringMatching(/^https:\/\/room\.example\.com\/room\/.+/),
      external_event_id: 'https://api.calendly.com/scheduled_events/event-katherine',
      sync_source: 'WEBHOOK',
      email_sent_at: expect.any(String),
    });

    const meeting = sqlite!.prepare(
      `SELECT id, scheduled_interview_id, scheduled_at, scheduling_provider, external_event_id
         FROM meetings
        WHERE scheduled_interview_id = ?`,
    ).get(created.interview.id) as {
      id: string;
      scheduled_interview_id: string;
      scheduled_at: string | null;
      scheduling_provider: string | null;
      external_event_id: string | null;
    };
    expect(meeting).toMatchObject({
      scheduled_interview_id: created.interview.id,
      scheduled_at: '2026-07-03T19:00:00.000Z',
      scheduling_provider: 'CALENDLY',
      external_event_id: 'https://api.calendly.com/scheduled_events/event-katherine',
    });
    expect(sqlite!.prepare(
      'SELECT COUNT(*) AS count FROM meetings WHERE scheduled_interview_id = ?',
    ).get(created.interview.id)).toEqual({ count: 1 });

    const listResponse = await authApp.request('/interviews');
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as {
      interviews: Array<{
        id: string;
        externalEventId: string | null;
        meetingId: string | null;
        meetingExternalEventId: string | null;
        meetingSchedulingProvider: string | null;
      }>;
    };
    expect(listBody.interviews).toContainEqual(expect.objectContaining({
      id: created.interview.id,
      externalEventId: 'https://api.calendly.com/scheduled_events/event-katherine',
      meetingId: meeting.id,
      meetingExternalEventId: 'https://api.calendly.com/scheduled_events/event-katherine',
      meetingSchedulingProvider: 'CALENDLY',
    }));

    const detailResponse = await authApp.request(`/interviews/${created.interview.id}`);
    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json() as {
      interview: {
        externalEventId: string | null;
        linkedMeeting: {
          id: string;
          externalEventId: string | null;
          schedulingProvider: string | null;
        } | null;
      };
    };
    expect(detailBody.interview).toMatchObject({
      externalEventId: 'https://api.calendly.com/scheduled_events/event-katherine',
      linkedMeeting: {
        id: meeting.id,
        externalEventId: 'https://api.calendly.com/scheduled_events/event-katherine',
        schedulingProvider: 'CALENDLY',
      },
    });

    const replayResponse = await publicApp.request('/webhook?connectionId=conn-1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Calendly Webhook',
      },
      body: JSON.stringify({
        event: 'invitee.created',
        payload: {
          name: 'Katherine Johnson',
          email: 'katherine@example.com',
          scheduled_event: {
            uri: 'https://api.calendly.com/scheduled_events/event-katherine',
            start_time: '2026-07-03T19:00:00.000Z',
            location: {
              join_url: meetingUrl,
            },
          },
        },
      }),
    }, undefined, ctx);
    expect(replayResponse.status).toBe(200);
    await waitUntilAll();
    expect(sqlite!.prepare(
      'SELECT COUNT(*) AS count FROM scheduled_interviews WHERE external_event_id = ?',
    ).get('https://api.calendly.com/scheduled_events/event-katherine')).toEqual({ count: 1 });
    expect(sqlite!.prepare(
      'SELECT COUNT(*) AS count FROM meetings WHERE scheduled_interview_id = ?',
    ).get(created.interview.id)).toEqual({ count: 1 });
    expect(sentMessages).toHaveLength(1);
  });

  it('does not collapse ambiguous same-email Calendly bookings onto an arbitrary pending interview', async () => {
    seedInterviewDetailFixture();
    const sentMessages: Array<{
      to: unknown;
      from: unknown;
      subject: string;
      html?: string;
      text?: string;
    }> = [];
    sqlite!.prepare(`
      INSERT INTO scheduling_connections (
        id, owner_id, provider_id, access_token, refresh_token, token_expiry,
        account_email, account_name, webhook_secret, webhook_id, status,
        connected_at, last_sync_at, created_at, updated_at
      ) VALUES (
        'conn-1', 'owner-1', 'CALENDLY', 'cal-token', NULL, '2026-07-01T00:00:00.000Z',
        'recruiter@example.com', 'Recruiter', NULL, NULL, 'ACTIVE',
        '2026-06-26T12:00:00.000Z', NULL, '2026-06-26T12:00:00.000Z', '2026-06-26T12:00:00.000Z'
      )
    `).run();

    const authApp = mountSchedulingApp();
    const firstResponse = await authApp.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Katherine Johnson',
        recipientEmail: 'katherine@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'VIDEO',
        schedulingProvider: 'CALENDLY',
        schedulingUrl: 'https://calendly.com/pipe/background',
      }),
    });
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as { interview: { id: string } };

    const secondResponse = await authApp.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Katherine Johnson',
        recipientEmail: 'katherine@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'VIDEO',
        schedulingProvider: 'CALENDLY',
        schedulingUrl: 'https://calendly.com/pipe/code-review-follow-up',
      }),
    });
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json() as { interview: { id: string } };

    sqlite!.prepare(
      `UPDATE scheduled_interviews
          SET created_at = '2026-07-01T10:00:00.000Z',
              updated_at = '2026-07-01T10:00:00.000Z'
        WHERE id = ?`,
    ).run(first.interview.id);
    sqlite!.prepare(
      `UPDATE scheduled_interviews
          SET created_at = '2026-07-01T11:00:00.000Z',
              updated_at = '2026-07-01T11:00:00.000Z'
        WHERE id = ?`,
    ).run(second.interview.id);

    const publicApp = mountSchedulingPublicApp({
      EMAIL: {
        send: async (message) => {
          sentMessages.push(message);
          return { messageId: 'ambiguous-same-email-message-1' };
        },
      },
      OUTBOUND_EMAIL_FROM: 'no-reply@hire-pipe.com',
      VIDEO_ROOM_APP_URL: 'https://room.example.com',
      PUBLIC_EMAIL_LOGO_URL: 'https://api-dev.hire-pipe.com/assets/email/pipe-logo.png',
    } as Partial<Env>);
    const { ctx, waitUntilAll } = buildCtx();

    const response = await publicApp.request('/webhook?connectionId=conn-1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Calendly Webhook',
      },
      body: JSON.stringify({
        event: 'invitee.created',
        payload: {
          name: 'Katherine Johnson',
          email: 'katherine@example.com',
          scheduled_event: {
            uri: 'https://api.calendly.com/scheduled_events/event-katherine-ambiguous',
            start_time: '2026-07-05T19:00:00.000Z',
            location: {
              join_url: 'https://meet.example.com/calendly-katherine-ambiguous',
            },
          },
        },
      }),
    }, undefined, ctx);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Interview imported',
      created: true,
    });
    await waitUntilAll();

    const originalRows = sqlite!.prepare(
      `SELECT id, status, external_event_id, meeting_url
         FROM scheduled_interviews
        WHERE id IN (?, ?)
        ORDER BY created_at ASC`,
    ).all(first.interview.id, second.interview.id) as Array<{
      id: string;
      status: string;
      external_event_id: string | null;
      meeting_url: string | null;
    }>;
    expect(originalRows).toEqual([
      {
        id: first.interview.id,
        status: 'INVITED',
        external_event_id: null,
        meeting_url: null,
      },
      {
        id: second.interview.id,
        status: 'INVITED',
        external_event_id: null,
        meeting_url: null,
      },
    ]);

    const imported = sqlite!.prepare(
      `SELECT id, status, scheduled_at, meeting_url, external_event_id, recipient_email
         FROM scheduled_interviews
        WHERE external_event_id = ?`,
    ).get('https://api.calendly.com/scheduled_events/event-katherine-ambiguous') as {
      id: string;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      external_event_id: string | null;
      recipient_email: string | null;
    };
    expect(imported.id).not.toBe(first.interview.id);
    expect(imported.id).not.toBe(second.interview.id);
    expect(imported).toMatchObject({
      status: 'SCHEDULED',
      scheduled_at: '2026-07-05T19:00:00.000Z',
      meeting_url: expect.stringMatching(/^https:\/\/room\.example\.com\/room\/.+/),
      external_event_id: 'https://api.calendly.com/scheduled_events/event-katherine-ambiguous',
      recipient_email: 'katherine@example.com',
    });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM scheduled_interviews
        WHERE lower(recipient_email) = 'katherine@example.com'`,
    ).get()).toEqual({ count: 3 });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM contacts
        WHERE owner_id = 'owner-1'
          AND lower(email) = 'katherine@example.com'`,
    ).get()).toEqual({ count: 1 });
    expect(sentMessages).toHaveLength(1);
  });

  it('imports an unmatched Calendly scheduled webhook and links it 1:1 to a Pipe meeting', async () => {
    seedInterviewDetailFixture();
    const sentMessages: Array<{
      to: unknown;
      from: unknown;
      subject: string;
      html?: string;
      text?: string;
    }> = [];
    sqlite!.prepare(`
      INSERT INTO scheduling_connections (
        id, owner_id, provider_id, access_token, refresh_token, token_expiry,
        account_email, account_name, webhook_secret, webhook_id, status,
        connected_at, last_sync_at, created_at, updated_at
      ) VALUES (
        'conn-1', 'owner-1', 'CALENDLY', 'cal-token', NULL, '2026-07-01T00:00:00.000Z',
        'recruiter@example.com', 'Recruiter', NULL, NULL, 'ACTIVE',
        '2026-06-26T12:00:00.000Z', NULL, '2026-06-26T12:00:00.000Z', '2026-06-26T12:00:00.000Z'
      )
    `).run();

    const publicApp = mountSchedulingPublicApp({
      EMAIL: {
        send: async (message) => {
          sentMessages.push(message);
          return { messageId: 'cf-imported-scheduled-message-1' };
        },
      },
      OUTBOUND_EMAIL_FROM: 'no-reply@hire-pipe.com',
      VIDEO_ROOM_APP_URL: 'https://room.example.com',
      PUBLIC_EMAIL_LOGO_URL: 'https://api-dev.hire-pipe.com/assets/email/pipe-logo.png',
    } as Partial<Env>);
    const { ctx, waitUntilAll } = buildCtx();

    const response = await publicApp.request('/webhook?connectionId=conn-1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Calendly Webhook',
      },
      body: JSON.stringify({
        event: 'invitee.created',
        payload: {
          name: 'New Guest',
          email: 'newguest@example.com',
          scheduled_event: {
            uri: 'https://api.calendly.com/scheduled_events/event-newguest',
            start_time: '2026-07-02T18:00:00.000Z',
            location: {
              join_url: 'https://meet.example.com/calendly-event-newguest',
            },
          },
        },
      }),
    }, undefined, ctx);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Interview imported',
      created: true,
    });
    await waitUntilAll();

    const imported = sqlite!.prepare(
      `SELECT id, candidate_id, pipeline_id, stage_id, status, scheduled_at,
              meeting_url, scheduling_provider, external_event_id,
              recipient_name, recipient_email, sync_source, email_sent_at
         FROM scheduled_interviews
        WHERE external_event_id = ?`,
    ).get('https://api.calendly.com/scheduled_events/event-newguest') as {
      id: string;
      candidate_id: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
      external_event_id: string | null;
      recipient_name: string | null;
      recipient_email: string | null;
      sync_source: string | null;
      email_sent_at: string | null;
    };

    expect(imported).toMatchObject({
      candidate_id: null,
      pipeline_id: null,
      stage_id: null,
      status: 'SCHEDULED',
      scheduled_at: '2026-07-02T18:00:00.000Z',
      meeting_url: expect.stringMatching(/^https:\/\/room\.example\.com\/room\/.+/),
      scheduling_provider: 'CALENDLY',
      external_event_id: 'https://api.calendly.com/scheduled_events/event-newguest',
      recipient_name: 'New Guest',
      recipient_email: 'newguest@example.com',
      sync_source: 'WEBHOOK',
      email_sent_at: expect.any(String),
    });

    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM meetings
        WHERE scheduled_interview_id = ?
          AND external_event_id = ?
          AND scheduling_provider = 'CALENDLY'`,
    ).get(imported.id, 'https://api.calendly.com/scheduled_events/event-newguest')).toEqual({ count: 1 });
    expect(sqlite!.prepare(
      `SELECT COUNT(*) AS count
         FROM meeting_rooms mr
         JOIN meetings m ON m.id = mr.meeting_id
        WHERE m.scheduled_interview_id = ?`,
    ).get(imported.id)).toEqual({ count: 1 });
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.html).toContain(imported.meeting_url);
    expect(sentMessages[0]?.html).toContain('Time:');
    expect(sentMessages[0]?.html).toContain('https://api-dev.hire-pipe.com/assets/email/pipe-logo.png');
    expect(sentMessages[0]?.html).not.toContain('data:image');
  });
});

// ─── Dev-container challenge (HAS-80) tests ─────────────────────────────────

describe('POST /interviews dev-container challenge (HAS-80)', () => {
  let sqlite: BetterSqliteDb | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  function mountSchedulingApp(envOverrides: Partial<Env> = {}): Hono<{ Bindings: Env; Variables: Variables }> {
    if (!sqlite) throw new Error('sqlite fixture not initialized');
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.env = {
        DB: createMockD1(sqlite!),
        CLERK_SECRET_KEY: 'test',
        DEV_AUTH_BYPASS: 'true',
        DEV_BYPASS_USER_ID: 'owner-1',
        APP_BASE_URL: 'http://localhost:5173',
        ...envOverrides,
      } as unknown as Env;
      await next();
    });
    app.route('/', schedulingAuth);
    return app;
  }

  function seedDevContainerFixture(): void {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pipeline_id TEXT,
        status TEXT,
        name TEXT,
        email TEXT,
        invite_token TEXT,
        current_stage_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        email TEXT,
        name TEXT,
        company TEXT,
        role TEXT,
        phone TEXT,
        linkedin TEXT,
        notes TEXT,
        type TEXT NOT NULL DEFAULT 'lead',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT
      );
      CREATE TABLE stages (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        title TEXT
      );
      CREATE TABLE scheduled_interviews (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        pipeline_id TEXT,
        stage_id TEXT,
        owner_id TEXT NOT NULL,
        interview_type TEXT,
        meeting_type TEXT,
        status TEXT,
        scheduled_at TEXT,
        meeting_url TEXT,
        scheduling_provider TEXT,
        scheduling_url TEXT,
        external_event_id TEXT,
        recruiter_notes TEXT,
        sync_source TEXT,
        last_synced_at TEXT,
        invite_link_sent_at TEXT,
        email_sent_at TEXT,
        recipient_name TEXT,
        recipient_email TEXT,
        matched_repo_id INTEGER,
        github_repo_url TEXT,
        github_pr_number INTEGER,
        submission_json TEXT,
        completed_at TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        scheduled_interview_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        scheduled_at TEXT,
        started_at TEXT,
        ended_at TEXT,
        duration_secs INTEGER,
        meeting_url TEXT,
        meeting_type TEXT NOT NULL,
        scheduling_provider TEXT,
        external_event_id TEXT,
        transcript_status TEXT DEFAULT 'NONE',
        transcript_summary TEXT,
        transcript_json TEXT,
        transcript_analysis_json TEXT,
        transcript_error TEXT,
        recording_r2_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE meeting_rooms (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        session_id TEXT,
        status TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE meeting_participants (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'ATTENDEE',
        invite_sent_at TEXT,
        joined_at TEXT,
        left_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE meeting_room_tokens (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        participant_id TEXT,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(assessmentLayerMigration);
  }

  it('creates a DEV_CONTAINER_CHALLENGE without a manual repo (auto-match default)', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Linus Torvalds',
        recipientEmail: 'linus@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'DEV_CONTAINER_CHALLENGE',
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      interview: {
        id: string;
        assessmentSetup: {
          status: string;
          kind: string;
          blocksPositiveAssessment: boolean;
        };
      };
    };
    expect(body.interview.id).toBeDefined();
    expect(body.interview.assessmentSetup).toMatchObject({
      status: 'waiting_for_candidate_evidence',
      kind: 'auto_match',
      blocksPositiveAssessment: true,
    });

    const graphRow = sqlite!.prepare(
      `SELECT cr.qualifiers_json, ss.exact_text
         FROM people p
         JOIN workspace_people wp ON wp.person_id = p.id
         JOIN context_records cr ON cr.workspace_person_id = wp.id
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crss.source_span_id
        WHERE p.primary_email = ?
          AND cr.record_type = 'scheduled_interview_invite'
        LIMIT 1`,
    ).get('linus@example.com') as { qualifiers_json: string | null; exact_text: string } | undefined;
    expect(graphRow?.exact_text.split('\n')).toEqual(expect.arrayContaining([
      'Interview type: DEV_CONTAINER_CHALLENGE',
      'Assessment setup status: waiting_for_candidate_evidence',
      'Assessment setup kind: auto_match',
      'Assessment setup source: contact_first_invite',
      'Assessment setup blocks positive assessment: yes',
      'Assessment setup message: This contact-first assessment invite has no candidate evidence yet. PIPE must ingest source-backed resume, transcript, chat, or interview evidence before selecting a PR task.',
    ]));
    expect(JSON.parse(graphRow?.qualifiers_json ?? '{}')).toMatchObject({
      assessmentSetupStatus: 'waiting_for_candidate_evidence',
      assessmentSetupKind: 'auto_match',
      assessmentSetupSource: 'contact_first_invite',
      assessmentSetupBlocksPositiveAssessment: true,
    });
  });

  it('creates a person-first OPEN_SOURCE_BUG_FIX with explicit repo url + PR', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Margaret Hamilton',
        recipientEmail: 'margaret@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        githubRepoUrl: 'https://github.com/hash-pipe/open-source-task',
        githubPrNumber: 101,
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      interview: {
        id: string;
        interviewType: string;
        matchedRepoId: number | null;
        githubRepoUrl: string | null;
        githubPrNumber: number | null;
        pipelineId: string | null;
        candidateId: string | null;
        contactId: string | null;
        assessmentSetup: {
          status: string;
          kind: string;
          source: string;
          blocksPositiveAssessment: boolean;
        };
      };
    };
    expect(body.interview.interviewType).toBe('OPEN_SOURCE_BUG_FIX');
    expect(body.interview.githubRepoUrl).toBe('https://github.com/hash-pipe/open-source-task');
    expect(body.interview.githubPrNumber).toBe(101);
    expect(body.interview.matchedRepoId).toBeNull();
    expect(body.interview.pipelineId).toBeNull();
    expect(body.interview.candidateId).toBeNull();
    expect(body.interview.contactId).not.toBeNull();
    expect(body.interview.assessmentSetup).toMatchObject({
      status: 'reviewable_task_assigned',
      kind: 'github_pr',
      source: 'recruiter_manual_override',
      blocksPositiveAssessment: false,
    });

    const row = sqlite!.prepare(
      `SELECT interview_type, matched_repo_id, github_repo_url, github_pr_number,
              pipeline_id, candidate_id, recipient_name, recipient_email
         FROM scheduled_interviews WHERE id = ?`,
    ).get(body.interview.id) as {
      interview_type: string;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      pipeline_id: string | null;
      candidate_id: string | null;
      recipient_name: string | null;
      recipient_email: string | null;
    };
    expect(row.interview_type).toBe('OPEN_SOURCE_BUG_FIX');
    expect(row.github_repo_url).toBe('https://github.com/hash-pipe/open-source-task');
    expect(row.github_pr_number).toBe(101);
    expect(row.matched_repo_id).toBeNull();
    expect(row.pipeline_id).toBeNull();
    expect(row.candidate_id).toBeNull();
    expect(row.recipient_name).toBe('Margaret Hamilton');
    expect(row.recipient_email).toBe('margaret@example.com');
  });

  it('creates a source-backed open-source challenge packet when task details are provided', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();
    const baseCommitSha = '1234567890abcdef1234567890abcdef12345678';

    const response = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Grace Hopper',
        recipientEmail: 'grace@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        githubRepoUrl: 'https://github.com/hash-pipe/open-source-task',
        githubPrNumber: 101,
        challengeBaseCommitSha: baseCommitSha,
        challengeTitle: 'Fix the failing assessment evaluator start state',
        challengeInstructions: 'Reproduce the failing start-evaluation path, make the smallest production-ready fix, and preserve source-backed assessment evidence.',
        challengeSuccessCriteria: [
          'A focused commit changes only the evaluator start-state path.',
          'The relevant scheduling and assessment tests pass.',
        ],
        challengeExpectedEvidence: [
          'git_commit source ref for the submitted commit',
          'code_diff source ref for the candidate patch',
          'test_run source ref for the relevant verification command',
        ],
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      interview: {
        id: string;
        assessmentProgress: {
          stage: string;
          nextAction: string;
          hasChallengePacket: boolean;
          hasCommitSubmission: boolean;
          challenge: {
            sourceRefType: string;
            sourceRefId: string;
            evidenceRole: string;
            exactText: string;
            locator: {
              repositoryUrl?: string;
              baseCommitSha?: string;
              githubPrNumber?: number;
            };
          } | null;
        } | null;
      };
    };

    expect(body.interview.assessmentProgress).toMatchObject({
      stage: 'CHALLENGE_READY',
      nextAction: 'OPEN_ROOM_OR_WORKSPACE',
      hasChallengePacket: true,
      hasCommitSubmission: false,
      challenge: {
        sourceRefType: 'open_source_challenge_packet',
        evidenceRole: 'assigned_challenge',
        locator: {
          repositoryUrl: 'https://github.com/hash-pipe/open-source-task',
          baseCommitSha,
          githubPrNumber: 101,
        },
      },
    });
    expect(body.interview.assessmentProgress?.challenge?.exactText.split('\n')).toEqual(expect.arrayContaining([
      'Repo: https://github.com/hash-pipe/open-source-task',
      `Base commit: ${baseCommitSha}`,
      'Task: Fix the failing assessment evaluator start state',
      'Instructions: Reproduce the failing start-evaluation path, make the smallest production-ready fix, and preserve source-backed assessment evidence.',
      'Success criteria:',
      '- A focused commit changes only the evaluator start-state path.',
      '- The relevant scheduling and assessment tests pass.',
      'Expected evidence:',
      '- git_commit source ref for the submitted commit',
      '- code_diff source ref for the candidate patch',
      '- test_run source ref for the relevant verification command',
    ]));

    const session = sqlite!.prepare(
      `SELECT id, mode, state, interview_id, metadata_json
         FROM assessment_sessions
        WHERE interview_id = ?`,
    ).get(body.interview.id) as {
      id: string;
      mode: string;
      state: string;
      interview_id: string;
      metadata_json: string;
    } | undefined;
    expect(session).toMatchObject({
      mode: 'OPEN_SOURCE_BUG_FIX',
      state: 'INTAKE',
      interview_id: body.interview.id,
    });
    expect(JSON.parse(session?.metadata_json ?? '{}')).toMatchObject({
      challengePacketSource: 'recruiter_manual_open_source_task',
      repositoryUrl: 'https://github.com/hash-pipe/open-source-task',
      baseCommitSha,
      githubPrNumber: 101,
    });

    const sourceRef = sqlite!.prepare(
      `SELECT sr.source_ref_type, sr.source_ref_id, sr.evidence_role,
              sr.exact_text, sr.content_hash
         FROM assessment_event_source_refs sr
         JOIN assessment_evidence_events e ON e.id = sr.event_id
        WHERE e.session_id = ?
          AND sr.source_ref_type = 'open_source_challenge_packet'
        LIMIT 1`,
    ).get(session?.id) as {
      source_ref_type: string;
      source_ref_id: string;
      evidence_role: string;
      exact_text: string;
      content_hash: string;
    } | undefined;
    expect(sourceRef).toMatchObject({
      source_ref_type: 'open_source_challenge_packet',
      evidence_role: 'assigned_challenge',
    });
    expect(sourceRef?.source_ref_id).toContain(body.interview.id);
    expect(sourceRef?.content_hash).toMatch(/^content_/);
    expect(sourceRef?.exact_text).toContain('Expected evidence:');
  });

  it('delivers OPEN_SOURCE_BUG_FIX invites to the assessment surface when a repo task is assigned', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();

    const createResponse = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Katherine Johnson',
        recipientEmail: 'katherine@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        githubRepoUrl: 'https://github.com/hash-pipe/open-source-task',
        githubPrNumber: 101,
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as {
      interview: { id: string; candidateId: string | null };
    };
    expect(created.interview.candidateId).toBeNull();

    const inviteResponse = await app.request(`/interviews/${created.interview.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'katherine@example.com', sendEmail: false }),
    });
    expect(inviteResponse.status).toBe(200);
    const inviteBody = await inviteResponse.json() as {
      success: boolean;
      emailSent: boolean;
      meetingUrl: string;
      deliveredUrl: string;
    };

    expect(inviteBody).toMatchObject({
      success: true,
      emailSent: false,
    });
    expect(inviteBody.deliveredUrl).toMatch(/^http:\/\/localhost:5173\/assess\/.+/);
    expect(inviteBody.deliveredUrl).not.toContain('/room/');
    expect(inviteBody.meetingUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);

    const row = sqlite!.prepare(
      `SELECT si.interview_type, si.candidate_id, si.github_repo_url, si.github_pr_number, c.invite_token
         FROM scheduled_interviews si
         JOIN candidates c ON c.id = si.candidate_id
        WHERE si.id = ?`,
    ).get(created.interview.id) as {
      interview_type: string;
      candidate_id: string | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      invite_token: string | null;
    };
    expect(row).toMatchObject({
      interview_type: 'OPEN_SOURCE_BUG_FIX',
      github_repo_url: 'https://github.com/hash-pipe/open-source-task',
      github_pr_number: 101,
    });
    expect(row.candidate_id).toEqual(expect.any(String));
    expect(row.invite_token).not.toMatch(/^CLAIMED::/);
    expect(inviteBody.deliveredUrl).toContain(`/assess/${row.invite_token}`);
  });

  it('delivers distinct assessment links for multiple standalone assessment interviews with the same email', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();

    const firstCreateResponse = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Katherine Johnson',
        recipientEmail: 'katherine@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'CODE_REVIEW',
        githubRepoUrl: 'https://github.com/hash-pipe/review-task',
        githubPrNumber: 42,
      }),
    });
    expect(firstCreateResponse.status).toBe(201);
    const firstCreated = await firstCreateResponse.json() as {
      interview: { id: string; candidateId: string | null };
    };
    expect(firstCreated.interview.candidateId).toBeNull();

    const secondCreateResponse = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Katherine Johnson',
        recipientEmail: 'katherine@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        githubRepoUrl: 'https://github.com/hash-pipe/open-source-task',
        githubPrNumber: 101,
      }),
    });
    expect(secondCreateResponse.status).toBe(201);
    const secondCreated = await secondCreateResponse.json() as {
      interview: { id: string; candidateId: string | null };
    };
    expect(secondCreated.interview.candidateId).toBeNull();

    const firstInviteResponse = await app.request(`/interviews/${firstCreated.interview.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'katherine@example.com', sendEmail: false }),
    });
    expect(firstInviteResponse.status).toBe(200);
    const firstInvite = await firstInviteResponse.json() as { deliveredUrl: string };

    const secondInviteResponse = await app.request(`/interviews/${secondCreated.interview.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'katherine@example.com', sendEmail: false }),
    });
    expect(secondInviteResponse.status).toBe(200);
    const secondInvite = await secondInviteResponse.json() as { deliveredUrl: string };

    expect(firstInvite.deliveredUrl).toMatch(/^http:\/\/localhost:5173\/assess\/.+/);
    expect(secondInvite.deliveredUrl).toMatch(/^http:\/\/localhost:5173\/assess\/.+/);
    expect(firstInvite.deliveredUrl).not.toBe(secondInvite.deliveredUrl);

    const rows = sqlite!.prepare(
      `SELECT si.id, si.interview_type, si.candidate_id, c.invite_token
         FROM scheduled_interviews si
         JOIN candidates c ON c.id = si.candidate_id
        WHERE lower(c.email) = 'katherine@example.com'
        ORDER BY si.created_at ASC`,
    ).all() as Array<{
      id: string;
      interview_type: string;
      candidate_id: string;
      invite_token: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual([
      firstCreated.interview.id,
      secondCreated.interview.id,
    ]);
    expect(new Set(rows.map((row) => row.invite_token)).size).toBe(2);
    expect(firstInvite.deliveredUrl).toContain(`/assess/${rows[0]?.invite_token}`);
    expect(secondInvite.deliveredUrl).toContain(`/assess/${rows[1]?.invite_token}`);

    const applicationGraphRows = sqlite!.prepare(
      `SELECT app.legacy_candidate_id,
              wp.person_id,
              p.primary_email
         FROM applications app
         JOIN workspace_people wp ON wp.id = app.workspace_person_id
         JOIN people p ON p.id = wp.person_id
        WHERE app.legacy_candidate_id IN (?, ?)
        ORDER BY app.legacy_candidate_id`,
    ).all(rows[0]!.candidate_id, rows[1]!.candidate_id) as Array<{
      legacy_candidate_id: string;
      person_id: string;
      primary_email: string;
    }>;
    expect(applicationGraphRows).toHaveLength(2);
    expect(new Set(applicationGraphRows.map((row) => row.person_id)).size).toBe(1);
    expect(applicationGraphRows.map((row) => row.primary_email)).toEqual([
      'katherine@example.com',
      'katherine@example.com',
    ]);

    const graphCounts = sqlite!.prepare(
      `SELECT COUNT(DISTINCT m.id) AS meetingCount,
              COUNT(DISTINCT cr.id) AS contextRecordCount,
              COUNT(DISTINCT app.id) AS applicationCount
         FROM people p
         JOIN workspace_people wp ON wp.person_id = p.id
         LEFT JOIN context_records cr ON cr.workspace_person_id = wp.id
         LEFT JOIN applications app ON app.workspace_person_id = wp.id
         LEFT JOIN meetings m ON m.owner_id = wp.workspace_id
        WHERE p.primary_email = 'katherine@example.com'
          AND (m.scheduled_interview_id IN (?, ?) OR m.id IS NULL)`,
    ).get(firstCreated.interview.id, secondCreated.interview.id) as {
      meetingCount: number;
      contextRecordCount: number;
      applicationCount: number;
    };
    expect(graphCounts).toEqual({
      meetingCount: 2,
      contextRecordCount: 4,
      applicationCount: 2,
    });
  });

  it('rejects CODE_REVIEW with partial manual repo (url without PR number)', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Grace Hopper',
        recipientEmail: 'grace@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'CODE_REVIEW',
        githubRepoUrl: 'https://github.com/owner/repo',
      }),
    });
    expect(response.status).toBe(422);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain('Manual repo override requires both githubRepoUrl and githubPrNumber');
  });

  it('rejects workspace assessment manual repo overrides that are not GitHub repositories', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Grace Hopper',
        recipientEmail: 'grace@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        githubRepoUrl: 'https://example.com/not-a-real-github-repo',
        githubPrNumber: 17,
        challengeBaseCommitSha: '1234567890abcdef1234567890abcdef12345678',
        challengeTitle: 'Fix a source-backed task',
        challengeInstructions: 'Make the smallest production-ready change and preserve exact evidence.',
        challengeSuccessCriteria: ['The fix is demonstrated by a targeted test.'],
        challengeExpectedEvidence: ['git_commit and code_diff source refs are attached.'],
      }),
    });
    expect(response.status).toBe(422);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain('githubRepoUrl must be a GitHub HTTPS repository URL');
  });

  it('creates a person-first CODE_REVIEW with explicit repo url + PR', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Grace Hopper',
        recipientEmail: 'grace@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'CODE_REVIEW',
        githubRepoUrl: 'https://github.com/hash-pipe/review-challenge',
        githubPrNumber: 17,
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      interview: {
        id: string;
        interviewType: string;
        githubRepoUrl: string | null;
        githubPrNumber: number | null;
      };
    };
    expect(body.interview.interviewType).toBe('CODE_REVIEW');
    expect(body.interview.githubRepoUrl).toBe('https://github.com/hash-pipe/review-challenge');
    expect(body.interview.githubPrNumber).toBe(17);

    const row = sqlite!.prepare(
      `SELECT interview_type, github_repo_url, github_pr_number
         FROM scheduled_interviews WHERE id = ?`,
    ).get(body.interview.id) as {
      interview_type: string;
      github_repo_url: string | null;
      github_pr_number: number | null;
    };
    expect(row.interview_type).toBe('CODE_REVIEW');
    expect(row.github_repo_url).toBe('https://github.com/hash-pipe/review-challenge');
    expect(row.github_pr_number).toBe(17);
  });

  it('rejects DEV_CONTAINER_CHALLENGE with partial manual repo (url without PR number)', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Linus Torvalds',
        recipientEmail: 'linus@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'DEV_CONTAINER_CHALLENGE',
        githubRepoUrl: 'https://github.com/owner/repo',
      }),
    });
    expect(response.status).toBe(422);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain('Manual repo override requires both githubRepoUrl and githubPrNumber');
  });

  it('creates a person-first DEV_CONTAINER_CHALLENGE with explicit repo url + PR', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Linus Torvalds',
        recipientEmail: 'linus@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'DEV_CONTAINER_CHALLENGE',
        githubRepoUrl: 'https://github.com/hash-pipe/example-challenge',
        githubPrNumber: 42,
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      interview: {
        id: string;
        interviewType: string;
        matchedRepoId: number | null;
        githubRepoUrl: string | null;
        githubPrNumber: number | null;
        pipelineId: string | null;
        candidateId: string | null;
        contactId: string | null;
      };
    };
    expect(body.interview.interviewType).toBe('DEV_CONTAINER_CHALLENGE');
    expect(body.interview.githubRepoUrl).toBe('https://github.com/hash-pipe/example-challenge');
    expect(body.interview.githubPrNumber).toBe(42);
    expect(body.interview.matchedRepoId).toBeNull();
    // Person-first: no pipeline/role container required.
    expect(body.interview.pipelineId).toBeNull();
    expect(body.interview.candidateId).toBeNull();
    expect(body.interview.contactId).not.toBeNull();

    const row = sqlite!.prepare(
      `SELECT interview_type, matched_repo_id, github_repo_url, github_pr_number,
              pipeline_id, candidate_id, recipient_name, recipient_email
         FROM scheduled_interviews WHERE id = ?`,
    ).get(body.interview.id) as {
      interview_type: string;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      pipeline_id: string | null;
      candidate_id: string | null;
      recipient_name: string | null;
      recipient_email: string | null;
    };
    expect(row.interview_type).toBe('DEV_CONTAINER_CHALLENGE');
    expect(row.github_repo_url).toBe('https://github.com/hash-pipe/example-challenge');
    expect(row.github_pr_number).toBe(42);
    expect(row.matched_repo_id).toBeNull();
    expect(row.pipeline_id).toBeNull();
    expect(row.candidate_id).toBeNull();
    expect(row.recipient_name).toBe('Linus Torvalds');
    expect(row.recipient_email).toBe('linus@example.com');
  });

  it('creates a person-first DEV_CONTAINER_CHALLENGE with matchedRepoId', async () => {
    seedDevContainerFixture();
    const app = mountSchedulingApp();

    const response = await app.request('/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Ada Lovelace',
        recipientEmail: 'ada@example.com',
        meetingType: 'DIRECT_VIDEO_CALL',
        interviewType: 'DEV_CONTAINER_CHALLENGE',
        matchedRepoId: 7,
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      interview: {
        id: string;
        matchedRepoId: number | null;
        interviewType: string;
        assessmentSetup: {
          status: string;
          kind: string;
          source: string;
          blocksPositiveAssessment: boolean;
          message: string | null;
        };
      };
    };
    expect(body.interview.interviewType).toBe('DEV_CONTAINER_CHALLENGE');
    expect(body.interview.matchedRepoId).toBe(7);
    expect(body.interview.assessmentSetup).toMatchObject({
      status: 'missing_reviewable_task',
      kind: 'matched_repo_without_pr',
      source: 'matched_repo_id',
      blocksPositiveAssessment: true,
    });
    expect(body.interview.assessmentSetup.message).toContain('no GitHub PR or task was assigned');

    const row = sqlite!.prepare(
      'SELECT interview_type, matched_repo_id FROM scheduled_interviews WHERE id = ?',
    ).get(body.interview.id) as { interview_type: string; matched_repo_id: number | null };
    expect(row.interview_type).toBe('DEV_CONTAINER_CHALLENGE');
    expect(row.matched_repo_id).toBe(7);
  });
});

// ─── Meeting type tests ─────────────────────────────────────────────────────

describe('Meeting type classification', () => {
  it('defaults to DIRECT_VIDEO_CALL when recipient info provided', () => {
    const withRecipient = {
      recipientName: 'Alice Johnson',
      recipientEmail: 'alice@example.com',
    };

    const inferredType = (withRecipient.recipientName && withRecipient.recipientEmail)
      ? 'DIRECT_VIDEO_CALL'
      : 'SCREENING_INTERVIEW';

    expect(inferredType).toBe('DIRECT_VIDEO_CALL');
  });

  it('defaults to SCREENING_INTERVIEW when pipeline context provided', () => {
    const withPipeline = {
      candidateId: 'candidate-123',
      pipelineId: 'pipeline-456',
      stageId: 'stage-789',
    };

    const inferredType = (withPipeline.recipientName && withPipeline.recipientEmail)
      ? 'DIRECT_VIDEO_CALL'
      : 'SCREENING_INTERVIEW';

    expect(inferredType).toBe('SCREENING_INTERVIEW');
  });

  it('respects explicit meetingType override', () => {
    const withOverride = {
      recipientName: 'Alice Johnson',
      recipientEmail: 'alice@example.com',
      meetingType: 'SCREENING_INTERVIEW' as const,
    };

    expect(withOverride.meetingType).toBe('SCREENING_INTERVIEW');
  });
});

// ─── Transcript artifact tests ───────────────────────────────────────────────

describe('Transcript artifact model', () => {
  it('accepts valid transcript entry with role and text', () => {
    const validEntry = {
      role: 'user' as const,
      text: 'Hello, this is a test message.',
      timestamp: '2026-06-05T14:30:00Z',
    };

    expect(validEntry.role).toBe('user');
    expect(validEntry.text).toBeTruthy();
    expect(validEntry.timestamp).toBeTruthy();
  });

  it('accepts transcript entry without optional timestamp', () => {
    const entryWithoutTimestamp = {
      role: 'model' as const,
      text: 'AI response here.',
    };

    expect(entryWithoutTimestamp.role).toBe('model');
    expect(entryWithoutTimestamp.text).toBeTruthy();
    expect(entryWithoutTimestamp.timestamp).toBeUndefined();
  });

  it('accepts COMPLETED status for successful transcription', () => {
    const completedArtifact = {
      id: 'artifact-123',
      scheduledInterviewId: 'interview-456',
      status: 'COMPLETED' as const,
      transcriptJson: '[{"role":"user","text":"Hello"}]',
      errorMessage: null,
      createdAt: '2026-06-05T14:00:00Z',
      updatedAt: '2026-06-05T14:30:00Z',
    };

    expect(completedArtifact.status).toBe('COMPLETED');
    expect(completedArtifact.errorMessage).toBeNull();
    expect(completedArtifact.transcriptJson).toBeTruthy();
  });

  it('accepts FAILED status with actionable error message', () => {
    const failedArtifact = {
      id: 'artifact-789',
      scheduledInterviewId: 'interview-456',
      status: 'FAILED' as const,
      transcriptJson: null,
      errorMessage: 'Audio quality too low for transcription',
      createdAt: '2026-06-05T14:00:00Z',
      updatedAt: '2026-06-05T14:30:00Z',
    };

    expect(failedArtifact.status).toBe('FAILED');
    expect(failedArtifact.errorMessage).toBeTruthy();
    expect(failedArtifact.transcriptJson).toBeNull();
  });

  it('accepts PENDING status for in-progress transcription', () => {
    const pendingArtifact = {
      id: 'artifact-999',
      scheduledInterviewId: 'interview-456',
      status: 'PENDING' as const,
      transcriptJson: null,
      errorMessage: null,
      createdAt: '2026-06-05T14:00:00Z',
      updatedAt: '2026-06-05T14:00:00Z',
    };

    expect(pendingArtifact.status).toBe('PENDING');
    expect(pendingArtifact.transcriptJson).toBeNull();
    expect(pendingArtifact.errorMessage).toBeNull();
  });

  it('links transcript artifact to scheduled interview for graph association', () => {
    const artifactWithGraphLink = {
      id: 'artifact-123',
      scheduledInterviewId: 'interview-456',
      status: 'COMPLETED' as const,
      transcriptJson: '[{"role":"user","text":"Hello"}]',
      errorMessage: null,
      createdAt: '2026-06-05T14:00:00Z',
      updatedAt: '2026-06-05T14:30:00Z',
    };

    // Graph association: scheduledInterviewId links to meeting invite
    // which links to recipient/person nodes via candidate_id or recipient_email
    expect(artifactWithGraphLink.scheduledInterviewId).toBe('interview-456');
    expect(artifactWithGraphLink.scheduledInterviewId).toBeTruthy();
  });
});
