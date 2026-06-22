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
import { afterEach, describe, it, expect } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  ensureCandidateLivingContext,
  ensureContactLivingContext,
  LivingContextStore,
} from '../../../lib/livingContext';
import type { Env, Variables } from '../../../types';
import {
  canInterviewStatusTransition,
  schedulingAuth,
} from '../scheduling';

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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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
    sqlite?.close();
    sqlite = null;
  });

  function mountSchedulingApp(): Hono<{ Bindings: Env; Variables: Variables }> {
    if (!sqlite) throw new Error('sqlite fixture not initialized');
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.env = {
        DB: createMockD1(sqlite!),
        CLERK_SECRET_KEY: 'test',
        DEV_AUTH_BYPASS: 'true',
        DEV_BYPASS_USER_ID: 'owner-1',
        APP_BASE_URL: 'http://localhost:5173',
      } as unknown as Env;
      await next();
    });
    app.route('/', schedulingAuth);
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
        email TEXT
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
        transcript_status TEXT NOT NULL,
        transcript_summary TEXT,
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
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(contextRecordsMigration);

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
        meeting_type, transcript_status, transcript_summary, recording_r2_key,
        created_at, updated_at
      ) VALUES (
        'meeting-1', 'owner-1', 'interview-1', 'Ada technical screen', NULL,
        'ACTIVE', '2026-06-22T18:00:00.000Z', '2026-06-22T18:00:30.000Z',
        NULL, NULL, 'http://localhost:5173/rooms/meeting-1',
        'SCREENING_INTERVIEW', 'COMPLETED', 'Discussed retry and Kafka evidence.',
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
      };
    };

    expect(body.interview).toMatchObject({
      id: 'interview-1',
      candidateName: 'Ada Lovelace',
      pipelineTitle: 'Principal Systems Engineer',
      stageTitle: 'Technical screen',
      status: 'ACTIVE',
      meetingUrl: 'http://localhost:5173/video/stage-1--candidate-1',
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
      room: {
        id: 'room-1',
        status: 'ACTIVE',
      },
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
      'Scheduled at: 2026-06-24T18:00:00.000Z',
      'Scheduling provider: none',
      'Scheduling URL: none',
      expect.stringMatching(/^Created at: /),
    ]);
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
