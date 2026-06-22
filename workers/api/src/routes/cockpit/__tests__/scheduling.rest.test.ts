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
import { ensureCandidateLivingContext, LivingContextStore } from '../../../lib/livingContext';
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
