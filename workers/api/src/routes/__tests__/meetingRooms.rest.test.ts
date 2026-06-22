import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import { candidateOps } from '../cockpit/candidates';
import { contacts } from '../cockpit/contacts';
import { meetingRooms, meetingsAuth } from '../meetingRooms';
import type { Env, Variables } from '../../types';

const contactsMigration = readMigration('0075_contacts.sql');
const meetingsMigration = readMigration('0076_meetings.sql');
const meetingParticipantsMigration = readMigration('0077_meeting_participants.sql');
const meetingRoomsMigration = readMigration('0081_meeting_rooms.sql');
const livingContextMigration = readMigration('0082_living_context_graph.sql');
const transcriptProjectionMigration = readMigration('0091_transcript_semantic_projections.sql');
const contextRecordsMigration = readMigration('0095_context_records.sql');

function readMigration(name: string): string {
  return readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8');
}

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

async function toArrayBuffer(value: unknown): Promise<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer;
  if (value instanceof Blob) return value.arrayBuffer();
  return new ArrayBuffer(0);
}

function createFakeStorage(): R2Bucket {
  const objects = new Map<string, {
    body: ArrayBuffer;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }>();
  return {
    async put(key: string, value: unknown, options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }) {
      objects.set(key, {
        body: await toArrayBuffer(value),
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
      });
      return null;
    },
    async get(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
        arrayBuffer: async () => object.body.slice(0),
        body: new Blob([object.body]).stream(),
      };
    },
  } as unknown as R2Bucket;
}

function createFakeAi(): Ai {
  return {
    run: vi.fn(async () => ({
      response: JSON.stringify({
        summary: 'Guest described lattice replay buffers for ecommerce order recovery.',
        decisions: [],
        actionItems: [],
        topics: ['lattice replay buffers'],
        followUps: [],
        semanticAssertions: [{
          sourceSegmentIds: ['utterance-0002'],
          subjectSegmentId: 'utterance-0002',
          predicate: 'implemented a source-described recovery mechanism',
          narrative: 'Implemented lattice replay buffers for ecommerce order recovery.',
          objectType: 'source-described mechanism',
          objectValue: { surface: 'lattice replay buffers' },
          qualifiers: {},
          confidence: 0.92,
          polarity: 1,
          concepts: [{
            surface: 'lattice replay buffers',
            relationship: 'mechanism implemented for ecommerce order recovery',
            weight: 0.9,
            evidenceLevel: 'implemented',
            strength: 0.88,
          }],
        }],
      }),
    })),
  } as unknown as Ai;
}

function installDeepgramFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    metadata: { channels: 2 },
    results: {
      utterances: [
        {
          id: 'dg-host-1',
          transcript: 'What system did you improve?',
          start: 1,
          end: 2,
          channel: 0,
          speaker: 0,
          confidence: 0.98,
        },
        {
          id: 'dg-guest-1',
          transcript: 'I implemented lattice replay buffers for ecommerce order recovery.',
          start: 2.1,
          end: 6.5,
          channel: 1,
          speaker: 1,
          confidence: 0.96,
        },
      ],
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
}

function seedSchema(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE pipelines (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT
    );
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT,
      owner_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      invite_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      current_stage_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE candidate_ingestion (
      candidate_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE scheduled_interviews (
      id TEXT PRIMARY KEY
    );
  `);
  sqlite.exec(contactsMigration);
  sqlite.exec(meetingsMigration);
  sqlite.exec(meetingParticipantsMigration);
  sqlite.exec(meetingRoomsMigration);
  sqlite.exec(livingContextMigration);
  sqlite.exec(transcriptProjectionMigration);
  sqlite.exec(contextRecordsMigration);
}

function mountApp(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/meetings', meetingsAuth);
  app.route('/meeting', meetingRooms);
  app.route('/candidates', candidateOps);
  app.route('/contacts', contacts);
  return app;
}

interface GraphBody {
  person: {
    personId: string;
    workspacePersonId: string;
    primaryEmail: string | null;
  } | null;
  summary: {
    interactionCount: number;
    artifactCount: number;
    contextRecordCount: number;
    assertionCount: number;
    signalCount: number;
    sourceSpanCount: number;
  };
  artifacts: Array<{
    artifactType: string;
    sourceSpans: Array<{ exactText: string }>;
  }>;
  contextRecords: Array<{
    recordType: string;
    predicate: string | null;
    concepts: Array<{ canonicalKey: string; relationship: string; weight: number }>;
    sources: Array<{ exactText: string | null }>;
  }>;
  assertions: Array<{
    predicate: string;
    narrative: string;
    sources: Array<{ exactText: string }>;
  }>;
  signals: Array<{
    signalKey: string;
    conversationScore: number | null;
    totalScore: number;
    evidenceCount: number;
    evidence: Array<{ sources: Array<{ exactText: string }> }>;
  }>;
}

describe('meeting room recording living-context route', () => {
  let sqlite: BetterSqliteDb;
  let env: Env;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    seedSchema(sqlite);
    installDeepgramFetch();
    env = {
      DB: createMockD1(sqlite),
      STORAGE: createFakeStorage(),
      AI: createFakeAi(),
      CLERK_SECRET_KEY: 'test',
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'owner-1',
      APP_BASE_URL: 'http://localhost:5173',
      VIDEO_ROOM_APP_URL: 'http://localhost:5175',
      DEEPGRAM_API_KEY: 'test-deepgram',
    } as unknown as Env;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sqlite.close();
  });

  it('prepares stable guest and fresh host video room links for a meeting', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Room Prep Person',
        recipientEmail: 'room-prep@example.com',
        title: 'Room prep interview',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { meeting: { id: string } };

    const firstRes = await app.request(`/meetings/${created.meeting.id}/room`, {
      method: 'POST',
    }, env, ctx);
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json() as {
      room: { id: string; sessionId: string; hostUrl: string; guestUrl: string; expiresAt: string };
    };
    expect(first.room.hostUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);
    expect(first.room.guestUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);
    expect(sqlite.prepare(
      'SELECT meeting_url FROM meetings WHERE id = ?',
    ).get(created.meeting.id)).toEqual({ meeting_url: first.room.guestUrl });

    const secondRes = await app.request(`/meetings/${created.meeting.id}/room`, {
      method: 'POST',
    }, env, ctx);
    expect(secondRes.status).toBe(200);
    const second = await secondRes.json() as {
      room: { id: string; sessionId: string; hostUrl: string; guestUrl: string; expiresAt: string };
    };
    expect(second.room.id).toBe(first.room.id);
    expect(second.room.sessionId).toBe(first.room.sessionId);
    expect(second.room.hostUrl).not.toBe(first.room.hostUrl);
    expect(second.room.guestUrl).toBe(first.room.guestUrl);

    const tokenCounts = sqlite.prepare(
      `SELECT role,
              COUNT(*) AS count,
              SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active
         FROM meeting_room_tokens
        GROUP BY role
        ORDER BY role`,
    ).all();
    expect(tokenCounts).toEqual([
      { role: 'GUEST', count: 1, active: 1 },
      { role: 'HOST', count: 3, active: 1 },
    ]);
  });

  it('routes a recorded meeting transcript into the same graph after roleless candidate convergence', async () => {
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    const personEmail = 'meeting-graph-person@example.com';
    const rolelessMessage =
      'Roleless follow-up: the same person can discuss lattice replay buffers and join the talent pool.';

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Meeting Graph Person',
        recipientEmail: personEmail,
        title: 'Living graph technical discussion',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      meeting: { id: string; contactId: string };
      hostToken: string;
    };

    const inviteRes = await app.request(`/meetings/${created.meeting.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: personEmail }),
    }, env, ctx);
    expect(inviteRes.status).toBe(200);
    await expect(inviteRes.json()).resolves.toMatchObject({ guestToken: expect.any(String) });

    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'STARTED' }),
    }, env, ctx);

    const recordingRes = await app.request(`/meeting/${created.hostToken}/recording`, {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        'Content-Length': '3',
      },
      body: new Uint8Array([1, 2, 3]),
    }, env, ctx);
    expect(recordingRes.status).toBe(202);
    await waitUntilAll();

    expect(sqlite.prepare(
      `SELECT transcript_status, transcript_summary FROM meetings WHERE id = ?`,
    ).get(created.meeting.id)).toEqual({
      transcript_status: 'READY',
      transcript_summary: 'Guest described lattice replay buffers for ecommerce order recovery.',
    });

    const contactGraphRes = await app.request(
      `/contacts/${created.meeting.contactId}/living-context`,
      {},
      env,
      ctx,
    );
    expect(contactGraphRes.status).toBe(200);
    const contactGraph = await contactGraphRes.json() as GraphBody;
    expect(contactGraph.person?.primaryEmail).toBe(personEmail);
    expect(contactGraph.summary).toMatchObject({
      interactionCount: 1,
      artifactCount: 1,
      contextRecordCount: 2,
      assertionCount: 1,
      signalCount: 1,
      sourceSpanCount: 2,
    });
    expect(contactGraph.assertions[0]).toMatchObject({
      predicate: 'implemented a source-described recovery mechanism',
      narrative: 'Implemented lattice replay buffers for ecommerce order recovery.',
    });
    expect(contactGraph.assertions[0]?.sources.map((source) => source.exactText)).toEqual([
      'I implemented lattice replay buffers for ecommerce order recovery.',
    ]);
    expect(contactGraph.signals[0]).toMatchObject({
      signalKey: 'term:lattice-replay-buffers',
      conversationScore: 0.88,
      totalScore: 0.88,
      evidenceCount: 1,
    });

    const candidateRes = await app.request('/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Meeting Graph Candidate',
        email: personEmail,
        message: rolelessMessage,
        skipEmail: true,
      }),
    }, env, ctx);
    expect(candidateRes.status).toBe(201);
    const candidateBody = await candidateRes.json() as { candidate: { id: string } };

    const candidateGraphRes = await app.request(
      `/candidates/${candidateBody.candidate.id}/living-context`,
      {},
      env,
      ctx,
    );
    expect(candidateGraphRes.status).toBe(200);
    const candidateGraphBody = await candidateGraphRes.json() as { livingContext: GraphBody };
    const candidateGraph = candidateGraphBody.livingContext;
    expect(candidateGraph.person?.personId).toBe(contactGraph.person?.personId);
    expect(candidateGraph.person?.workspacePersonId).toBe(contactGraph.person?.workspacePersonId);
    expect(candidateGraph.person?.primaryEmail).toBe(personEmail);
    expect(candidateGraph.summary).toMatchObject({
      interactionCount: 2,
      artifactCount: 2,
      contextRecordCount: 2,
      assertionCount: 1,
      signalCount: 1,
      sourceSpanCount: 3,
    });
    expect(
      candidateGraph.artifacts
        .flatMap((artifact) => artifact.sourceSpans)
        .map((span) => span.exactText),
    ).toEqual(expect.arrayContaining([
      'I implemented lattice replay buffers for ecommerce order recovery.',
      rolelessMessage,
    ]));
    expect(candidateGraph.contextRecords.map((record) => record.recordType).sort()).toEqual([
      'meeting_transcript',
      'meeting_transcript_assertion',
    ]);
    expect(candidateGraph.contextRecords).toContainEqual(expect.objectContaining({
      recordType: 'meeting_transcript_assertion',
      predicate: 'implemented a source-described recovery mechanism',
      concepts: [expect.objectContaining({
        canonicalKey: 'term:lattice-replay-buffers',
        relationship: 'mechanism implemented for ecommerce order recovery',
        weight: 0.9,
      })],
    }));
    expect(candidateGraph.signals[0]?.evidence[0]?.sources[0]?.exactText).toBe(
      'I implemented lattice replay buffers for ecommerce order recovery.',
    );

    const contactAfterCandidateRes = await app.request(
      `/contacts/${created.meeting.contactId}/living-context`,
      {},
      env,
      ctx,
    );
    expect(contactAfterCandidateRes.status).toBe(200);
    const contactAfterCandidate = await contactAfterCandidateRes.json() as GraphBody;
    expect(contactAfterCandidate.person?.personId).toBe(candidateGraph.person?.personId);
    expect(contactAfterCandidate.person?.workspacePersonId).toBe(
      candidateGraph.person?.workspacePersonId,
    );
    expect(
      contactAfterCandidate.artifacts
        .flatMap((artifact) => artifact.sourceSpans)
        .some((span) => span.exactText === rolelessMessage),
    ).toBe(true);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({ count: 1 });
  });
});
