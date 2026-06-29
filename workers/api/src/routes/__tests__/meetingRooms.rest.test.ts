import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import { candidateOps } from '../cockpit/candidates';
import { contacts } from '../cockpit/contacts';
import { meetingRooms, meetingsAuth } from '../meetingRooms';
import { matchCandidateToReviewChallenge } from '../../lib/challengeMatching/d1Matcher';
import {
  buildChallengePacket,
  buildCodeEpisode,
  buildFacet,
  buildRepoSignal,
  buildRepoSnapshot,
  buildSemanticAssertion,
  buildSourceArtifact,
  buildSourceArtifactVersion,
  buildSourceSpan,
  buildStructuralFact,
  buildSymbol,
  persistReviewChallengeGraph,
  type ChallengePacket as RepoChallengePacket,
  type NormalizedPullRequestInput,
} from '../../lib/repoSemanticGraph';
import type { Env, Variables } from '../../types';

const contactsMigration = readMigration('0075_contacts.sql');
const candidateNodesMigration = readMigration('0052_candidate_nodes.sql');
const candidateNodeIdempotencyMigration = readMigration('0085_candidate_node_idempotency.sql');
const meetingsMigration = readMigration('0076_meetings.sql');
const meetingParticipantsMigration = readMigration('0077_meeting_participants.sql');
const meetingRoomsMigration = readMigration('0081_meeting_rooms.sql');
const livingContextMigration = readMigration('0082_living_context_graph.sql');
const repoSemanticGraphMigration = readMigration('0083_repo_semantic_graph_and_match_runs.sql');
const transcriptProjectionMigration = readMigration('0091_transcript_semantic_projections.sql');
const contextRecordsMigration = readMigration('0095_context_records.sql');
const assessmentLayerMigration = readMigration('0102_assessment_layer.sql');
const OBSERVED_AT = '2026-06-14T08:00:00.000Z';

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
    async head(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        key,
        version: '',
        size: object.body.byteLength,
        etag: '',
        uploaded: new Date(),
        checksums: {},
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
        range: undefined,
        storageClass: 'Standard',
        writeHttpMetadata: () => {},
      };
    },
  } as unknown as R2Bucket;
}

function createFakeAi(): Ai {
  return {
    run: vi.fn(async (model: unknown) => {
      if (String(model).includes('whisper')) {
        return {
          text: 'Mixed audio transcript: I implemented lattice replay buffers for ecommerce order recovery.',
        };
      }
      return {
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
      };
    }),
  } as unknown as Ai;
}

function createMatchingFakeAi(): Ai {
  return {
    run: vi.fn(async (model: unknown) => {
      if (String(model).includes('whisper')) {
        return {
          text: 'Mixed audio transcript: I implemented TypeScript lattice replay buffers for ecommerce order recovery and validated Vitest coverage.',
        };
      }
      return {
        response: JSON.stringify({
          summary: 'Guest described lattice replay buffers for ecommerce order recovery.',
          decisions: [],
          actionItems: [],
          topics: ['lattice replay buffers', 'ecommerce order recovery'],
          followUps: [],
          semanticAssertions: [
            {
              sourceSegmentIds: ['utterance-0002'],
              subjectSegmentId: 'utterance-0002',
              predicate: 'implemented a source-described recovery mechanism',
              narrative: 'Implemented lattice replay buffers for ecommerce order recovery.',
              objectType: 'source-described mechanism',
              objectValue: { surface: 'lattice replay buffers' },
              qualifiers: {},
              confidence: 1,
              polarity: 1,
              concepts: [
                {
                  surface: 'lattice replay buffers',
                  relationship: 'mechanism implemented for ecommerce order recovery',
                  weight: 1,
                  evidenceLevel: 'implemented',
                  strength: 1,
                },
              ],
            },
            {
              sourceSegmentIds: ['utterance-0002'],
              subjectSegmentId: 'utterance-0002',
              predicate: 'implemented ecommerce order recovery work',
              narrative: 'Implemented ecommerce order recovery work.',
              objectType: 'source-described domain',
              objectValue: { surface: 'ecommerce order recovery' },
              qualifiers: {},
              confidence: 1,
              polarity: 1,
              concepts: [
                {
                  surface: 'ecommerce order recovery',
                  relationship: 'domain where the mechanism was implemented',
                  weight: 1,
                  evidenceLevel: 'implemented',
                  strength: 1,
                },
              ],
            },
            {
              sourceSegmentIds: ['utterance-0002'],
              subjectSegmentId: 'utterance-0002',
              predicate: 'validated order recovery behavior',
              narrative: 'Validated order recovery behavior.',
              objectType: 'source-described validation',
              objectValue: { surface: 'order recovery' },
              qualifiers: {},
              confidence: 1,
              polarity: 1,
              concepts: [
                {
                  surface: 'order recovery',
                  relationship: 'recovery domain described by candidate',
                  weight: 1,
                  evidenceLevel: 'validated',
                  strength: 1,
                },
              ],
            },
            {
              sourceSegmentIds: ['utterance-0002'],
              subjectSegmentId: 'utterance-0002',
              predicate: 'implemented TypeScript source changes',
              narrative: 'Implemented TypeScript source changes.',
              objectType: 'source-described implementation',
              objectValue: { surface: 'TypeScript' },
              qualifiers: {},
              confidence: 1,
              polarity: 1,
              concepts: [
                {
                  surface: 'TypeScript',
                  relationship: 'implementation language used for source changes',
                  weight: 1,
                  evidenceLevel: 'implemented',
                  strength: 1,
                },
              ],
            },
            {
              sourceSegmentIds: ['utterance-0002'],
              subjectSegmentId: 'utterance-0002',
              predicate: 'validated Vitest coverage',
              narrative: 'Validated Vitest coverage.',
              objectType: 'source-described validation',
              objectValue: { surface: 'Vitest coverage' },
              qualifiers: {},
              confidence: 1,
              polarity: 1,
              concepts: [
                {
                  surface: 'Vitest',
                  relationship: 'test framework used for validation coverage',
                  weight: 1,
                  evidenceLevel: 'validated',
                  strength: 1,
                },
              ],
            },
            {
              sourceSegmentIds: ['utterance-0002'],
              subjectSegmentId: 'utterance-0002',
              predicate: 'explained replay buffer mechanism',
              narrative: 'Explained replay buffers as the recovery mechanism.',
              objectType: 'source-described mechanism',
              objectValue: { surface: 'replay buffers' },
              qualifiers: {},
              confidence: 1,
              polarity: 1,
              concepts: [
                {
                  surface: 'replay buffers',
                  relationship: 'mechanism used for order recovery validation',
                  weight: 1,
                  evidenceLevel: 'explained',
                  strength: 1,
                },
              ],
            },
          ],
        }),
      };
    }),
  } as unknown as Ai;
}

function installDeepgramFetch(
  guestTranscript = 'I implemented lattice replay buffers for ecommerce order recovery.',
): void {
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
          transcript: guestTranscript,
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

function installDeepgramFetchWithReversedChannels(
  guestTranscript = 'I implemented lattice replay buffers for ecommerce order recovery.',
): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    metadata: { channels: 2 },
    results: {
      utterances: [
        {
          id: 'dg-host-1',
          transcript: 'What system did you improve?',
          start: 1,
          end: 2,
          channel: 1,
          speaker: 0,
          confidence: 0.98,
        },
        {
          id: 'dg-guest-1',
          transcript: guestTranscript,
          start: 2.1,
          end: 6.5,
          channel: 0,
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

function defaultRecordingSpeakerMetadataForTest(): {
  version: 1;
  transcriptionAudio: {
    channelLayout: string;
    channelCount: number;
    channels: Array<{ channel: number; role: 'host' | 'guest'; source: 'local' | 'remote' }>;
  };
} {
  return {
    version: 1,
    transcriptionAudio: {
      channelLayout: 'host-local-guest-remote-v1',
      channelCount: 2,
      channels: [
        { channel: 0, role: 'host', source: 'local' },
        { channel: 1, role: 'guest', source: 'remote' },
      ],
    },
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function sourceEndPosition(value: string): { byteOffset: number; line: number; column: number } {
  const lines = value.split('\n');
  return {
    byteOffset: byteLength(value),
    line: lines.length,
    column: lines[lines.length - 1]!.length + 1,
  };
}

async function buildRepoChangedFile(input: {
  repoSnapshotId: string;
  path: string;
  content: string;
  symbolName: string;
  symbolKind: 'function' | 'test';
  signature: string;
}) {
  const artifact = await buildSourceArtifact({
    repoSnapshotId: input.repoSnapshotId,
    kind: 'source',
    path: input.path,
    language: 'typescript',
  });
  const artifactVersion = await buildSourceArtifactVersion({
    artifactId: artifact.id,
    repoSnapshotId: input.repoSnapshotId,
    content: input.content,
    createdAt: OBSERVED_AT,
  });
  const sourceSpan = await buildSourceSpan({
    repoSnapshotId: input.repoSnapshotId,
    artifactId: artifact.id,
    artifactVersionId: artifactVersion.id,
    contentHash: artifactVersion.contentHash,
    start: { byteOffset: 0, line: 1, column: 1 },
    end: sourceEndPosition(input.content),
    exactText: input.content,
    displayLabel: `${input.path}:1-${input.content.split('\n').length}`,
    prSide: 'head',
  });
  const symbol = await buildSymbol({
    repoSnapshotId: input.repoSnapshotId,
    language: 'typescript',
    qualifiedName: `${input.path}:${input.symbolName}`,
    name: input.symbolName,
    kind: input.symbolKind,
    signature: input.signature,
    definingSpanId: sourceSpan.id,
    exported: true,
  });

  return {
    file: {
      path: input.path,
      status: 'modified' as const,
      language: 'typescript',
      additions: input.content.split('\n').length,
      deletions: 0,
      artifact,
      artifactVersion,
      hunks: [{
        header: `@@ ${input.symbolName} @@`,
        patch: input.content,
        sourceSpan,
        changedSymbolIds: [symbol.id],
      }],
      symbols: [symbol],
    },
    sourceSpan,
    symbol,
  };
}

async function buildLatticeReviewChallengeFixture(): Promise<{
  input: NormalizedPullRequestInput;
  packet: RepoChallengePacket;
  graph: Parameters<typeof persistReviewChallengeGraph>[4];
}> {
  const repoSnapshot = await buildRepoSnapshot({
    repository: {
      provider: 'github',
      owner: 'pipe',
      name: 'order-recovery',
      canonicalUrl: 'https://github.com/pipe/order-recovery',
    },
    commitSha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    defaultBranch: 'main',
    observedAt: OBSERVED_AT,
  });
  const primary = await buildRepoChangedFile({
    repoSnapshotId: repoSnapshot.id,
    path: 'src/orderRecoveryReplay.ts',
    symbolName: 'recoverOrderWithLatticeReplayBuffers',
    symbolKind: 'function',
    signature: 'export function recoverOrderWithLatticeReplayBuffers(orderId: string, attempts: number): RecoveryPlan',
    content: [
      'import { createLatticeReplayBufferKey } from "./latticeReplayBuffers";',
      '',
      'export function recoverOrderWithLatticeReplayBuffers(orderId: string, attempts: number) {',
      '  const replayKey = createLatticeReplayBufferKey(orderId);',
      '  const recoveryTopic = "orders.recovery.lattice";',
      '  const recoveryWindow = Math.max(1, attempts);',
      '  return {',
      '    replayKey,',
      '    recoveryTopic,',
      '    recoveryWindow,',
      '    mechanism: "lattice replay buffers",',
      '    domain: "ecommerce order recovery",',
      '  };',
      '}',
    ].join('\n'),
  });
  const helper = await buildRepoChangedFile({
    repoSnapshotId: repoSnapshot.id,
    path: 'src/latticeReplayBuffers.ts',
    symbolName: 'createLatticeReplayBufferKey',
    symbolKind: 'function',
    signature: 'export function createLatticeReplayBufferKey(orderId: string): string',
    content: [
      'export function createLatticeReplayBufferKey(orderId: string) {',
      '  const normalized = orderId.trim().toLowerCase();',
      '  const prefix = "lattice-replay-buffers";',
      '  const suffix = normalized || "missing-order";',
      '  return `${prefix}:${suffix}`;',
      '}',
    ].join('\n'),
  });
  const test = await buildRepoChangedFile({
    repoSnapshotId: repoSnapshot.id,
    path: 'src/orderRecoveryReplay.test.ts',
    symbolName: 'validatesLatticeReplayBuffersForOrderRecovery',
    symbolKind: 'test',
    signature: 'it("validates lattice replay buffers for ecommerce order recovery", () => void)',
    content: [
      'import { describe, expect, it } from "vitest";',
      'import { recoverOrderWithLatticeReplayBuffers } from "./orderRecoveryReplay";',
      '',
      'describe("recoverOrderWithLatticeReplayBuffers", () => {',
      '  it("validates lattice replay buffers for ecommerce order recovery", () => {',
      '    const plan = recoverOrderWithLatticeReplayBuffers("ORDER-123", 2);',
      '    expect(plan.replayKey).toBe("lattice-replay-buffers:order-123");',
      '    expect(plan.mechanism).toBe("lattice replay buffers");',
      '    expect(plan.domain).toBe("ecommerce order recovery");',
      '  });',
      '});',
    ].join('\n'),
  });
  const issueText = [
    'Issue #144: Ecommerce order recovery needs source-backed lattice replay buffers.',
    'The review should verify replay keys, recovery topic routing, and regression coverage.',
  ].join('\n');
  const issueArtifact = await buildSourceArtifact({
    repoSnapshotId: repoSnapshot.id,
    kind: 'issue',
    externalRef: 'https://github.com/pipe/order-recovery/issues/144',
    mediaType: 'text/markdown',
  });
  const issueVersion = await buildSourceArtifactVersion({
    artifactId: issueArtifact.id,
    repoSnapshotId: repoSnapshot.id,
    content: issueText,
    createdAt: OBSERVED_AT,
  });
  const issueSpan = await buildSourceSpan({
    repoSnapshotId: repoSnapshot.id,
    artifactId: issueArtifact.id,
    artifactVersionId: issueVersion.id,
    contentHash: issueVersion.contentHash,
    start: { byteOffset: 0, line: 1, column: 1 },
    end: sourceEndPosition(issueText),
    exactText: issueText,
    displayLabel: 'issues/144:1-2',
    prSide: 'metadata',
  });

  const input: NormalizedPullRequestInput = {
    repoSnapshot,
    number: 144,
    url: 'https://github.com/pipe/order-recovery/pull/144',
    title: 'Add lattice replay buffers for ecommerce order recovery',
    body: 'Implements source-backed lattice replay buffers and regression coverage for order recovery.',
    author: 'engineer',
    primaryLanguage: 'TypeScript',
    baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headSha: repoSnapshot.commitSha,
    mergedAt: OBSERVED_AT,
    metadataSourceSpanIds: [issueSpan.id],
    sourceArtifacts: [issueArtifact],
    sourceArtifactVersions: [issueVersion],
    sourceSpans: [primary.sourceSpan, helper.sourceSpan, test.sourceSpan, issueSpan],
    changedFiles: [primary.file, helper.file, test.file],
    tests: [{
      path: test.file.path,
      framework: 'vitest',
      sourceSpanIds: [test.sourceSpan.id],
      relatedSymbolIds: [test.symbol.id],
    }],
    issue: {
      number: 144,
      title: 'Ecommerce order recovery needs source-backed lattice replay buffers',
      body: issueText,
      labels: ['lattice replay buffers', 'ecommerce order recovery', 'order recovery', 'replay buffers'],
      sourceSpanIds: [issueSpan.id],
    },
  };
  const fact = await buildStructuralFact({
    repoSnapshotId: repoSnapshot.id,
    kind: 'calls',
    subject: { symbolId: primary.symbol.id },
    object: { symbolId: helper.symbol.id },
    sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id],
    confidence: 0.94,
    parser: 'typescript-compiler-api-test',
  });
  const episode = await buildCodeEpisode({
    repoSnapshotId: repoSnapshot.id,
    title: 'lattice-replay-buffers-order-recovery',
    narrative: 'The PR implements lattice replay buffers for ecommerce order recovery and verifies the replay key contract.',
    symbolIds: [primary.symbol.id, helper.symbol.id, test.symbol.id],
    structuralFactIds: [fact.id],
    sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
    conceptKeys: ['term:lattice-replay-buffers', 'term:ecommerce-order-recovery', 'term:order-recovery'],
  });
  const facet = await buildFacet({
    repoSnapshotId: repoSnapshot.id,
    kind: 'source-derived-mechanism',
    key: 'lattice-replay-buffers-order-recovery',
    label: 'Lattice replay buffers for ecommerce order recovery',
    aliases: [],
    sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
    confidence: 0.91,
  });
  const assertion = await buildSemanticAssertion({
    repoSnapshotId: repoSnapshot.id,
    episodeId: episode.id,
    subject: primary.symbol.id,
    predicate: 'implements.source.backed.lattice.replay.buffers',
    object: 'term:lattice-replay-buffers',
    narrative: 'The source implements lattice replay buffers for ecommerce order recovery.',
    qualifiers: { source: 'normalized-pr-fixture' },
    facetIds: [facet.id],
    conceptKeys: ['term:lattice-replay-buffers', 'term:ecommerce-order-recovery', 'term:order-recovery'],
    sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
    confidence: 0.92,
    extractor: 'repo-semantic-test-v1',
  });
  const signal = await buildRepoSignal({
    repoSnapshotId: repoSnapshot.id,
    key: 'lattice-replay-buffers-order-recovery',
    narrative: 'The repository demonstrates lattice replay buffers backed by exact source and test spans.',
    assertionIds: [assertion.id],
    facetIds: [facet.id],
    sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
    confidence: 0.9,
    sourceDiversity: 3,
  });

  return {
    input,
    packet: await buildChallengePacket(input),
    graph: {
      structuralFacts: [fact],
      codeEpisodes: [episode],
      facets: [facet],
      semanticAssertions: [assertion],
      repoSignals: [signal],
    },
  };
}

async function seedLatticeReviewChallengePacket(
  db: D1Database,
  repoId = 144,
): Promise<{
  input: NormalizedPullRequestInput;
  packet: RepoChallengePacket;
  graph: Parameters<typeof persistReviewChallengeGraph>[4];
}> {
  await db.prepare('INSERT INTO qualified_repos (id) VALUES (?1)').bind(repoId).run();
  const data = await buildLatticeReviewChallengeFixture();
  await persistReviewChallengeGraph(db, repoId, data.input, data.packet, data.graph);
  return data;
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
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      owner_id TEXT,
      recipient_name TEXT,
      recipient_email TEXT,
      interview_type TEXT,
      github_repo_url TEXT,
      github_pr_number INTEGER,
      matched_repo_id INTEGER,
      status TEXT NOT NULL DEFAULT 'INVITED',
      completed_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      github_url TEXT
    );
    CREATE TABLE dev_container_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      candidate_id TEXT,
      challenge_id TEXT,
      pipeline_id TEXT,
      meeting_id TEXT,
      meeting_room_id TEXT,
      owner_id TEXT,
      access_scope TEXT NOT NULL DEFAULT 'candidate',
      status TEXT NOT NULL DEFAULT 'LAUNCHING',
      instance_type TEXT NOT NULL DEFAULT 'standard-1',
      ttl_seconds INTEGER NOT NULL,
      ttl_source TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      warned_at TEXT,
      url TEXT,
      repo_r2_key TEXT,
      repo_git_url TEXT,
      challenge_branch TEXT,
      base_branch TEXT,
      started_at TEXT,
      stopped_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  sqlite.exec(candidateNodesMigration);
  sqlite.exec(candidateNodeIdempotencyMigration);
  sqlite.exec(contactsMigration);
  sqlite.exec(meetingsMigration);
  sqlite.exec(meetingParticipantsMigration);
  sqlite.exec(meetingRoomsMigration);
  sqlite.exec(`
    ALTER TABLE meetings ADD COLUMN video_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE meetings ADD COLUMN workspace_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE meetings ADD COLUMN recording_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE meetings ADD COLUMN clippy_enabled INTEGER NOT NULL DEFAULT 1;
  `);
  sqlite.exec(livingContextMigration);
  sqlite.exec(repoSemanticGraphMigration);
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sqlite.close();
  });

  it('links repeated meetings for the same email to one normalized contact', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();

    const firstRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Ada Uppercase',
        recipientEmail: 'Ada.Relationships@Example.com',
        title: 'First relationship interview',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(firstRes.status).toBe(201);
    const first = await firstRes.json() as { meeting: { id: string; contactId: string } };

    const secondRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Ada Lowercase',
        recipientEmail: 'ada.relationships@example.com',
        title: 'Second relationship interview',
        meetingType: 'FOLLOW_UP',
      }),
    }, env, ctx);
    expect(secondRes.status).toBe(201);
    const second = await secondRes.json() as { meeting: { id: string; contactId: string } };

    expect(second.meeting.id).not.toBe(first.meeting.id);
    expect(second.meeting.contactId).toBe(first.meeting.contactId);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM contacts
        WHERE owner_id = 'owner-1'
          AND lower(email) = 'ada.relationships@example.com'`,
    ).get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      `SELECT email, name
         FROM contacts
        WHERE id = ?`,
    ).get(first.meeting.contactId)).toEqual({
      email: 'ada.relationships@example.com',
      name: 'Ada Uppercase',
    });
    expect(sqlite.prepare(
      `SELECT COUNT(DISTINCT meeting_id) AS meetingCount,
              COUNT(DISTINCT contact_id) AS contactCount
         FROM meeting_participants
        WHERE contact_id = ?`,
    ).get(first.meeting.contactId)).toEqual({
      meetingCount: 2,
      contactCount: 1,
    });
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

    const firstHostToken = new URL(first.room.hostUrl).pathname.split('/').pop()!;
    const secondHostToken = new URL(second.room.hostUrl).pathname.split('/').pop()!;
    const [firstHostRes, secondHostRes] = await Promise.all([
      app.request(`/meeting/${firstHostToken}`, {}, env, ctx),
      app.request(`/meeting/${secondHostToken}`, {}, env, ctx),
    ]);
    expect(firstHostRes.status).toBe(404);
    expect(secondHostRes.status).toBe(200);
    const secondHost = await secondHostRes.json() as {
      room: { id: string; sessionId: string; role: string };
    };
    expect(secondHost.room).toEqual(expect.objectContaining({
      id: first.room.id,
      sessionId: first.room.sessionId,
      role: 'HOST',
    }));

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

    const endedRes = await app.request(`/meeting/${secondHostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'ENDED' }),
    }, env, ctx);
    expect(endedRes.status).toBe(200);
    expect(sqlite.prepare(
      'SELECT status FROM meeting_rooms WHERE id = ?',
    ).get(first.room.id)).toEqual({ status: 'ENDED' });

    const reopenedRes = await app.request(`/meetings/${created.meeting.id}/room`, {
      method: 'POST',
    }, env, ctx);
    expect(reopenedRes.status).toBe(200);
    const reopened = await reopenedRes.json() as {
      room: { id: string; sessionId: string; hostUrl: string; guestUrl: string };
    };
    expect(reopened.room.id).toBe(first.room.id);
    expect(reopened.room.sessionId).not.toBe(first.room.sessionId);
    expect(reopened.room.guestUrl).toBe(first.room.guestUrl);
    expect(reopened.room.hostUrl).not.toBe(second.room.hostUrl);
    expect(sqlite.prepare(
      'SELECT status FROM meeting_rooms WHERE id = ?',
    ).get(first.room.id)).toEqual({ status: 'WAITING' });
  });

  it('clears recording status when a room ends before recording upload arrives', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Disconnected Guest',
        recipientEmail: 'disconnected@example.com',
        title: 'Disconnected interview',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { meeting: { id: string } };

    const roomRes = await app.request(`/meetings/${created.meeting.id}/room`, {
      method: 'POST',
    }, env, ctx);
    expect(roomRes.status).toBe(200);
    const prepared = await roomRes.json() as {
      room: { hostUrl: string };
    };
    const hostToken = new URL(prepared.room.hostUrl).pathname.split('/').pop()!;

    const startedRes = await app.request(`/meeting/${hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'STARTED' }),
    }, env, ctx);
    expect(startedRes.status).toBe(200);
    expect(sqlite.prepare(
      'SELECT status, transcript_status, recording_r2_key FROM meetings WHERE id = ?',
    ).get(created.meeting.id)).toEqual({
      status: 'IN_PROGRESS',
      transcript_status: 'NONE',
      recording_r2_key: null,
    });

    const recordingStartedRes = await app.request(`/meeting/${hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'RECORDING_STARTED' }),
    }, env, ctx);
    expect(recordingStartedRes.status).toBe(200);
    expect(sqlite.prepare(
      'SELECT status, transcript_status, recording_r2_key FROM meetings WHERE id = ?',
    ).get(created.meeting.id)).toEqual({
      status: 'IN_PROGRESS',
      transcript_status: 'RECORDING',
      recording_r2_key: null,
    });

    const endedRes = await app.request(`/meeting/${hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'ENDED' }),
    }, env, ctx);
    expect(endedRes.status).toBe(200);

    expect(sqlite.prepare(
      'SELECT status, transcript_status, recording_r2_key FROM meetings WHERE id = ?',
    ).get(created.meeting.id)).toEqual({
      status: 'COMPLETED',
      transcript_status: 'NONE',
      recording_r2_key: null,
    });
  });

  it('captures validated session events separately from room lifecycle events', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, candidate_id, owner_id, recipient_name, recipient_email, interview_type, status, updated_at
       ) VALUES (?, NULL, ?, ?, ?, 'DEV_CONTAINER_CHALLENGE', 'INVITED', ?)`,
    ).run(
      'scheduled-session-event',
      'owner-1',
      'Session Event Candidate',
      'session-event@example.com',
      now,
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Session Event Candidate',
        recipientEmail: 'session-event@example.com',
        title: 'Session event room',
        meetingType: 'INTERVIEW',
        scheduledInterviewId: 'scheduled-session-event',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      hostToken: string;
    };

    const lifecycleRes = await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window_open',
        text: 'Microsoft Edge',
        actor: 'guest',
      }),
    }, env, ctx);
    expect(lifecycleRes.status).toBe(422);

    const fakeWindowOpenRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window_open',
        text: 'Microsoft Edge',
        actor: 'guest',
        properties: {
          windowId: 'browser',
          windowType: 'browser',
          surface: 'win95',
        },
      }),
    }, env, ctx);
    expect(fakeWindowOpenRes.status).toBe(422);

    const sourceOnlyWindowOpenRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window_open',
        text: 'Microsoft Edge',
        actor: 'guest',
        properties: {
          source: 'window_lifecycle_client_submit',
          lifecycleSource: 'clippy_action',
          lifecycleKind: 'open',
          actor: 'guest',
          windowId: 'browser',
          windowType: 'browser',
          windowTitle: 'Microsoft Edge',
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(sourceOnlyWindowOpenRes.status).toBe(422);

    const sessionEventRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window_open',
        text: 'Microsoft Edge',
        actor: 'guest',
        properties: {
          source: 'window_lifecycle_client_submit',
          lifecycleSource: 'clippy_action',
          lifecycleKind: 'open',
          windowLifecycleId: 'window-lifecycle:guest:1782601200000:open:browser',
          capturedAtMs: 1782601200000,
          actor: 'guest',
          windowId: 'browser',
          windowType: 'browser',
          windowTitle: 'Microsoft Edge',
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(sessionEventRes.status).toBe(200);
    await expect(sessionEventRes.json()).resolves.toMatchObject({
      captured: true,
      nodeId: expect.any(String),
    });

    const linked = sqlite.prepare(
      'SELECT candidate_id FROM scheduled_interviews WHERE id = ?',
    ).get('scheduled-session-event') as { candidate_id: string } | undefined;
    expect(linked?.candidate_id).toEqual(expect.any(String));

    const candidate = sqlite.prepare(
      'SELECT id, owner_id, pipeline_id, name, email FROM candidates WHERE id = ?',
    ).get(linked?.candidate_id) as {
      id: string;
      owner_id: string;
      pipeline_id: string | null;
      name: string;
      email: string;
    } | undefined;
    expect(candidate).toMatchObject({
      owner_id: 'owner-1',
      pipeline_id: null,
      name: 'Session Event Candidate',
      email: 'session-event@example.com',
    });

    const node = sqlite.prepare(
      `SELECT id, candidate_id, node_type, narrative_text, source_type, source_reference, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ?`,
    ).get(linked?.candidate_id) as {
      id: string;
      candidate_id: string;
      node_type: string;
      narrative_text: string;
      source_type: string;
      source_reference: string;
      extracted_properties_json: string;
    } | undefined;
    expect(node).toMatchObject({
      candidate_id: linked?.candidate_id,
      node_type: 'session_window_open',
      source_type: 'meeting_session',
    });
    expect(node?.narrative_text).toContain('Window opened: Microsoft Edge');
    expect(JSON.parse(node?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      sessionId: node?.source_reference,
      windowId: 'browser',
      lifecycleSource: 'clippy_action',
      surface: 'win95',
    });

    const sessionContextRecord = sqlite.prepare(
      `SELECT id, workspace_person_id, interaction_id, record_type, predicate,
              narrative, qualifiers_json, confidence
         FROM context_records
        WHERE record_type = 'meeting_session_event'
          AND predicate = 'session_event:window_open'`,
    ).get() as {
      id: string;
      workspace_person_id: string;
      interaction_id: string;
      record_type: string;
      predicate: string;
      narrative: string;
      qualifiers_json: string;
      confidence: number;
    } | undefined;
    expect(sessionContextRecord).toMatchObject({
      record_type: 'meeting_session_event',
      predicate: 'session_event:window_open',
      confidence: 1,
    });
    expect(sessionContextRecord?.narrative).toContain('Window opened: Microsoft Edge');
    expect(JSON.parse(sessionContextRecord?.qualifiers_json ?? '{}')).toMatchObject({
      eventType: 'window_open',
      actor: 'guest',
      sessionId: node?.source_reference,
      surface: 'win95',
    });

    const contextSources = sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, source_span_id, evidence_role,
              exact_text, content_hash, locator_json
         FROM context_record_source_refs
        WHERE context_record_id = ?
        ORDER BY source_ref_type`,
    ).all(sessionContextRecord?.id) as Array<{
      source_ref_type: string;
      source_ref_id: string;
      source_span_id: string | null;
      evidence_role: string;
      exact_text: string | null;
      content_hash: string | null;
      locator_json: string;
    }>;
    expect(contextSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_ref_type: 'meeting_session_event',
        source_ref_id: node?.id,
        evidence_role: 'source_event',
      }),
      expect.objectContaining({
        source_ref_type: 'source_span',
        evidence_role: 'source_text',
        exact_text: expect.stringContaining('Window opened: Microsoft Edge'),
        source_span_id: expect.any(String),
      }),
    ]));
    const eventSource = contextSources.find(
      (source) => source.source_ref_type === 'meeting_session_event',
    );
    expect(JSON.parse(eventSource?.exact_text ?? '{}')).toMatchObject({
      type: 'window_open',
      sessionId: node?.source_reference,
      candidateId: linked?.candidate_id,
      actor: 'guest',
      text: 'Microsoft Edge',
      properties: {
        actor: 'guest',
        windowId: 'browser',
        lifecycleSource: 'clippy_action',
        surface: 'win95',
      },
      candidateNodeId: node?.id,
    });
    expect(eventSource?.content_hash).toEqual(expect.stringMatching(/^content_[a-f0-9]{32}$/));
    expect(JSON.parse(eventSource?.locator_json ?? '{}')).toMatchObject({
      sessionId: node?.source_reference,
      eventType: 'window_open',
      actor: 'guest',
      candidateNodeId: node?.id,
    });

    const fakeBrowserNavigationRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'browser_navigation',
        text: 'https://example.com/review',
        actor: 'guest',
        properties: {
          source: 'browser_url_claim',
          windowId: 'browser',
          url: 'https://example.com/review',
          surface: 'win95',
        },
      }),
    }, env, ctx);
    expect(fakeBrowserNavigationRes.status).toBe(422);

    const sourceOnlyBrowserNavigationRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'browser_navigation',
        text: 'https://example.com/review?step=1',
        actor: 'guest',
        properties: {
          source: 'room_browser_window',
          navigationSource: 'browser_window_client_submit',
          actor: 'guest',
          windowId: 'browser',
          navigationTrigger: 'go_button',
          url: 'https://example.com/review?step=1',
          urlHost: 'example.com',
          urlProtocol: 'https',
          urlPath: '/review?step=1',
          knownEmbedBlocked: false,
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(sourceOnlyBrowserNavigationRes.status).toBe(422);

    const browserNavigationRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'browser_navigation',
        text: 'https://example.com/review?step=1',
        actor: 'guest',
        properties: {
          source: 'room_browser_window',
          navigationSource: 'browser_window_client_submit',
          actor: 'guest',
          windowId: 'browser',
          navigationTrigger: 'go_button',
          browserNavigationId: 'browser-navigation:guest:1782601300000:browser:go_button:nav_54d2c495',
          capturedAtMs: 1782601300000,
          urlFingerprint: 'nav_54d2c495',
          url: 'https://example.com/review?step=1',
          urlHost: 'example.com',
          urlProtocol: 'https',
          urlPath: '/review?step=1',
          knownEmbedBlocked: false,
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(browserNavigationRes.status).toBe(200);

    const browserNavigationNode = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_browser_nav'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(browserNavigationNode).toMatchObject({
      node_type: 'session_browser_nav',
      source_type: 'meeting_session',
    });
    expect(browserNavigationNode?.narrative_text).toContain('Browser navigated to: https://example.com/review?step=1');
    expect(JSON.parse(browserNavigationNode?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      source: 'room_browser_window',
      navigationSource: 'browser_window_client_submit',
      windowId: 'browser',
      navigationTrigger: 'go_button',
      browserNavigationId: 'browser-navigation:guest:1782601300000:browser:go_button:nav_54d2c495',
      capturedAtMs: 1782601300000,
      urlFingerprint: 'nav_54d2c495',
      urlHost: 'example.com',
      urlProtocol: 'https',
      surface: 'win95',
      roomPhase: 'connected',
    });

    const reloadBrowserNavigationRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'browser_navigation',
        text: 'https://example.com/review?step=1',
        actor: 'guest',
        properties: {
          source: 'room_browser_window',
          navigationSource: 'browser_window_client_submit',
          actor: 'guest',
          windowId: 'browser',
          navigationTrigger: 'reload_button',
          browserNavigationId: 'browser-navigation:guest:1782601300001:browser:reload_button:nav_54d2c495',
          capturedAtMs: 1782601300001,
          urlFingerprint: 'nav_54d2c495',
          url: 'https://example.com/review?step=1',
          urlHost: 'example.com',
          urlProtocol: 'https',
          urlPath: '/review?step=1',
          knownEmbedBlocked: false,
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(reloadBrowserNavigationRes.status).toBe(200);

    const externalOpenBrowserNavigationRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'browser_navigation',
        text: 'https://example.com/review?step=1',
        actor: 'guest',
        properties: {
          source: 'room_browser_window',
          navigationSource: 'browser_window_client_submit',
          actor: 'guest',
          windowId: 'browser',
          navigationTrigger: 'external_open',
          browserNavigationId: 'browser-navigation:guest:1782601300002:browser:external_open:nav_54d2c495',
          capturedAtMs: 1782601300002,
          urlFingerprint: 'nav_54d2c495',
          url: 'https://example.com/review?step=1',
          urlHost: 'example.com',
          urlProtocol: 'https',
          urlPath: '/review?step=1',
          knownEmbedBlocked: false,
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(externalOpenBrowserNavigationRes.status).toBe(200);

    const fileLinkBrowserNavigationRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'browser_navigation',
        text: 'https://example.com/review?step=1',
        actor: 'guest',
        properties: {
          source: 'room_browser_window',
          navigationSource: 'browser_window_client_submit',
          actor: 'guest',
          windowId: 'browser',
          navigationTrigger: 'file_system_link_open',
          browserNavigationId: 'browser-navigation:guest:1782601300003:browser:file_system_link_open:nav_54d2c495',
          capturedAtMs: 1782601300003,
          urlFingerprint: 'nav_54d2c495',
          url: 'https://example.com/review?step=1',
          urlHost: 'example.com',
          urlProtocol: 'https',
          urlPath: '/review?step=1',
          knownEmbedBlocked: false,
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(fileLinkBrowserNavigationRes.status).toBe(200);

    const fakeChatRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'chat_message',
        text: 'I think the retry test should fail before the fix.',
        actor: 'guest',
        properties: {
          source: 'room_chat_claim',
          roomMessageId: 'chat-message-1',
        },
      }),
    }, env, ctx);
    expect(fakeChatRes.status).toBe(422);

    const chatRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'chat_message',
        text: 'I think the retry test should fail before the fix.',
        actor: 'guest',
        properties: {
          source: 'room_chat_client_submit',
          chatEventSource: 'browser_room_chat_window',
          actor: 'guest',
          roomMessageId: 'chat-message-1',
          clientId: 'browser-client-1',
          messageCreatedAt: 1782602000000,
          messageLength: 50,
          deliveryStatus: 'pending',
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(chatRes.status).toBe(200);

    const chatNode = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_chat_message'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(chatNode).toMatchObject({
      node_type: 'session_chat_message',
      source_type: 'meeting_session',
    });
    expect(chatNode?.narrative_text).toContain(
      'Room chat message from guest: "I think the retry test should fail before the fix."',
    );
    expect(JSON.parse(chatNode?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      source: 'room_chat_client_submit',
      chatEventSource: 'browser_room_chat_window',
      roomMessageId: 'chat-message-1',
      clientId: 'browser-client-1',
      deliveryStatus: 'pending',
      surface: 'win95',
      roomPhase: 'connected',
    });

    const fakeTerminalCommandRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'terminal_command',
        text: 'npm test',
        actor: 'guest',
        properties: {
          source: 'terminal_claim',
          terminalSessionId: 'terminal-workspace-session-1-guest',
          terminalCommandSequence: 1,
          commandLength: 8,
        },
      }),
    }, env, ctx);
    expect(fakeTerminalCommandRes.status).toBe(422);

    const terminalCommandRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'terminal_command',
        text: 'npm test',
        actor: 'guest',
        properties: {
          source: 'container_terminal',
          terminalEventSource: 'browser_terminal_ws',
          terminalSessionId: 'terminal-workspace-session-1-guest',
          terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000001000:1:terminal_dc5964d6',
          terminalCommandSequence: 1,
          actor: 'guest',
          capturedAtMs: 1700000001000,
          commandFingerprint: 'terminal_dc5964d6',
          commandLength: 8,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
        },
      }),
    }, env, ctx);
    expect(terminalCommandRes.status).toBe(200);

    const terminalOutputRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'terminal_output',
        text: 'PASS src/app.test.ts\n',
        actor: 'system',
        properties: {
          source: 'container_terminal',
          terminalEventSource: 'browser_terminal_ws',
          terminalSessionId: 'terminal-workspace-session-1-guest',
          terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000001000:1:terminal_dc5964d6',
          terminalOutputChunkId: 'terminal-workspace-session-1-guest:output:system:1700000002000:1:terminal_4f2d0d8f',
          terminalOutputSequence: 1,
          actor: 'system',
          capturedAtMs: 1700000002000,
          outputFingerprint: 'terminal_4f2d0d8f',
          outputLength: 21,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
        },
      }),
    }, env, ctx);
    expect(terminalOutputRes.status).toBe(200);

    const terminalNodes = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ?
          AND node_type IN ('session_terminal_command', 'session_terminal_output')
        ORDER BY node_type`,
    ).all(linked?.candidate_id) as Array<{
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    }>;
    expect(terminalNodes).toHaveLength(2);
    expect(terminalNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        node_type: 'session_terminal_command',
        source_type: 'meeting_session',
        narrative_text: expect.stringContaining('Terminal command: npm test'),
      }),
      expect.objectContaining({
        node_type: 'session_terminal_output',
        source_type: 'meeting_session',
        narrative_text: expect.stringContaining('Terminal output: PASS src/app.test.ts'),
      }),
    ]));
    expect(terminalNodes.map((node) => JSON.parse(node.extracted_properties_json))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'container_terminal',
        terminalEventSource: 'browser_terminal_ws',
        terminalSessionId: 'terminal-workspace-session-1-guest',
        terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000001000:1:terminal_dc5964d6',
        actor: 'guest',
        capturedAtMs: 1700000001000,
        workspaceSessionId: 'workspace-session-1',
      }),
      expect.objectContaining({
        source: 'container_terminal',
        terminalEventSource: 'browser_terminal_ws',
        terminalOutputChunkId: 'terminal-workspace-session-1-guest:output:system:1700000002000:1:terminal_4f2d0d8f',
        terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000001000:1:terminal_dc5964d6',
        actor: 'system',
        capturedAtMs: 1700000002000,
        workspaceSessionId: 'workspace-session-1',
      }),
    ]));

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-27T23:05:00.000Z'));

    const browserWindowMoveEvent = {
      type: 'window_update',
      text: 'Window state updated: browser',
      actor: 'guest',
      properties: {
        source: 'window_state_client_submit',
        stateSource: 'win95_window_chrome',
        actor: 'guest',
        windowId: 'browser',
        action: 'move',
        windowStateChangeId: 'window-state:guest:1782601500000:browser:move',
        capturedAtMs: 1782601500000,
        statePatch: { x: 120, y: 80 },
        stateKeys: ['x', 'y'],
        surface: 'win95',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
        clientCapturedAtMs: 1782601500000,
      },
    };
    const beaconSessionEventRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        ...browserWindowMoveEvent,
        properties: {
          ...browserWindowMoveEvent.properties,
          clientEventId: 'browser-window-move-1',
        },
      }),
    }, env, ctx);
    expect(beaconSessionEventRes.status).toBe(200);
    const firstBeaconBody = await beaconSessionEventRes.json() as { captured: boolean; nodeId: string };
    expect(firstBeaconBody).toMatchObject({
      captured: true,
      nodeId: expect.any(String),
    });

    const duplicateBeaconSessionEventRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        ...browserWindowMoveEvent,
        properties: {
          ...browserWindowMoveEvent.properties,
          clientEventId: 'browser-window-move-1',
        },
      }),
    }, env, ctx);
    expect(duplicateBeaconSessionEventRes.status).toBe(200);
    await expect(duplicateBeaconSessionEventRes.json()).resolves.toMatchObject({
      captured: true,
      nodeId: firstBeaconBody.nodeId,
    });

    const secondBeaconSessionEventRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        ...browserWindowMoveEvent,
        properties: {
          ...browserWindowMoveEvent.properties,
          clientEventId: 'browser-window-move-2',
        },
      }),
    }, env, ctx);
    expect(secondBeaconSessionEventRes.status).toBe(200);
    const secondBeaconBody = await secondBeaconSessionEventRes.json() as { captured: boolean; nodeId: string };
    expect(secondBeaconBody).toMatchObject({
      captured: true,
      nodeId: expect.any(String),
    });
    expect(secondBeaconBody.nodeId).not.toBe(firstBeaconBody.nodeId);

    const beaconNodes = sqlite.prepare(
      `SELECT id, node_type, narrative_text, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ?
          AND node_type = 'session_window_update'
        ORDER BY id`,
    ).all(linked?.candidate_id) as Array<{
      id: string;
      node_type: string;
      narrative_text: string;
      extracted_properties_json: string;
    }>;
    expect(beaconNodes).toHaveLength(2);
    expect(beaconNodes.map((node) => node.id).sort()).toEqual([
      firstBeaconBody.nodeId,
      secondBeaconBody.nodeId,
    ].sort());
    const beaconProperties = beaconNodes.map((node) =>
      JSON.parse(node.extracted_properties_json) as { clientEventId: string; clientCapturedAtMs: number },
    );
    expect(beaconNodes[0]?.narrative_text).toContain('Window updated: Window state updated: browser');
    expect(beaconProperties.map((properties) => properties.clientEventId).sort()).toEqual([
      'browser-window-move-1',
      'browser-window-move-2',
    ]);
    expect(beaconProperties).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: 'guest',
        source: 'window_state_client_submit',
        windowId: 'browser',
        surface: 'win95',
        windowStateChangeId: 'window-state:guest:1782601500000:browser:move',
        capturedAtMs: 1782601500000,
        clientCapturedAtMs: 1782601500000,
      }),
    ]));

    const windowUpdateContextRecords = sqlite.prepare(
      `SELECT id, qualifiers_json
         FROM context_records
        WHERE record_type = 'meeting_session_event'
          AND predicate = 'session_event:window_update'
        ORDER BY id`,
    ).all() as Array<{ id: string; qualifiers_json: string }>;
    expect(windowUpdateContextRecords).toHaveLength(2);
    const windowUpdateContextClientIds = windowUpdateContextRecords.map((record) => {
      const qualifiers = JSON.parse(record.qualifiers_json) as {
        properties: { clientEventId: string };
      };
      return qualifiers.properties.clientEventId;
    });
    expect(windowUpdateContextClientIds.sort()).toEqual([
      'browser-window-move-1',
      'browser-window-move-2',
    ]);
    expect(JSON.parse(beaconNodes[0]?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      source: 'window_state_client_submit',
      windowId: 'browser',
      surface: 'win95',
      windowStateChangeId: 'window-state:guest:1782601500000:browser:move',
      capturedAtMs: 1782601500000,
    });

    const sourceOnlyRoomSurfaceRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'room_surface_change',
        text: 'Room surface changed to 95 Until Infinity desktop',
        actor: 'guest',
        properties: {
          source: 'room_surface_control',
          actor: 'guest',
          surface: 'win95',
          previousSurface: 'standard',
          action: 'enter_desktop',
          roomPhase: 'connected',
        },
      }),
    }, env, ctx);
    expect(sourceOnlyRoomSurfaceRes.status).toBe(422);

    const roomSurfaceRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'room_surface_change',
        text: 'Room surface changed to 95 Until Infinity desktop',
        actor: 'guest',
        properties: {
          source: 'room_surface_control',
          surfaceControlEventSource: 'browser_room_surface_toggle',
          actor: 'guest',
          surfaceChangeId: 'surface:guest:1782601510000:standard:win95',
          capturedAtMs: 1782601510000,
          surface: 'win95',
          previousSurface: 'standard',
          action: 'enter_desktop',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(roomSurfaceRes.status).toBe(200);

    const surfaceNode = sqlite.prepare(
      `SELECT node_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_room_surface_change'
        ORDER BY captured_at DESC
        LIMIT 1`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(JSON.parse(surfaceNode?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      source: 'room_surface_control',
      surfaceControlEventSource: 'browser_room_surface_toggle',
      surfaceChangeId: 'surface:guest:1782601510000:standard:win95',
      surface: 'win95',
      previousSurface: 'standard',
      durableObjectReplayExpected: true,
    });

    const sourceOnlyStartMenuRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'desktop_menu_toggle',
        text: 'Start menu opened',
        actor: 'guest',
        properties: {
          source: 'win95_start_menu_control',
          menuEventSource: 'win95_start_button',
          actor: 'guest',
          menuId: 'start',
          action: 'open',
          open: true,
          surface: 'win95',
          roomPhase: 'connected',
        },
      }),
    }, env, ctx);
    expect(sourceOnlyStartMenuRes.status).toBe(422);

    const startMenuRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'desktop_menu_toggle',
        text: 'Start menu opened',
        actor: 'guest',
        properties: {
          source: 'win95_start_menu_control',
          menuEventSource: 'win95_start_button',
          actor: 'guest',
          menuId: 'start',
          action: 'open',
          open: true,
          startMenuEventId: 'start-menu:guest:1782601520000:open:win95_start_button',
          capturedAtMs: 1782601520000,
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(startMenuRes.status).toBe(200);

    const startMenuNode = sqlite.prepare(
      `SELECT node_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_desktop_menu_toggle'
        ORDER BY captured_at DESC
        LIMIT 1`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(JSON.parse(startMenuNode?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      source: 'win95_start_menu_control',
      menuEventSource: 'win95_start_button',
      startMenuEventId: 'start-menu:guest:1782601520000:open:win95_start_button',
      menuId: 'start',
      action: 'open',
      open: true,
      surface: 'win95',
      durableObjectReplayExpected: true,
    });

    const fakeWorkspaceStateRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'workspace_state',
        text: 'Workspace state changed to READY',
        actor: 'host',
        properties: {
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
        },
      }),
    }, env, ctx);
    expect(fakeWorkspaceStateRes.status).toBe(422);

    const workspaceStateRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'workspace_state',
        text: 'Workspace state changed to READY',
        actor: 'host',
        properties: {
          source: 'workspace_state_client_submit',
          workspaceEventSource: 'browser_workspace_state_observer',
          workspaceStateSource: 'launch',
          workspaceStateEventId: 'workspace-state:host:1700000000700:launch:workspace-session-1:READY',
          capturedAtMs: 1700000000700,
          actor: 'host',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/acme/orders',
          githubPrNumber: 42,
          matchedRepoId: 12,
          challengeStatus: 'github_pr_assigned',
          challengeKind: 'github_pr',
          challengeSource: 'scheduled_interview.github_pr_number',
          challengeMessage: null,
          workspaceTelemetryPersisted: true,
          proxyUrlPersisted: false,
        },
      }),
    }, env, ctx);
    expect(workspaceStateRes.status).toBe(200);

    const workspaceStateNode = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_workspace_state'
          AND extracted_properties_json LIKE '%workspace_state_client_submit%'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(workspaceStateNode).toMatchObject({
      node_type: 'session_workspace_state',
      source_type: 'meeting_session',
    });
    expect(workspaceStateNode?.narrative_text).toContain('Workspace state changed to READY');
    const workspaceStateProperties = JSON.parse(workspaceStateNode?.extracted_properties_json ?? '{}') as Record<string, unknown>;
    expect(workspaceStateProperties).toMatchObject({
      actor: 'host',
      source: 'workspace_state_client_submit',
      workspaceEventSource: 'browser_workspace_state_observer',
      workspaceStateSource: 'launch',
      workspaceStateEventId: 'workspace-state:host:1700000000700:launch:workspace-session-1:READY',
      capturedAtMs: 1700000000700,
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-session-1',
      proxyUrlPersisted: false,
    });
    expect(JSON.stringify(workspaceStateProperties)).not.toContain('/workspace/proxy/');

    const fakeParticipantJoinRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'participant_join',
        text: 'Host joined the 95 Until Infinity room',
        actor: 'host',
        properties: {
          source: 'meeting_room_lifecycle',
          lifecycleEvent: 'JOINED',
          participantRole: 'HOST',
        },
      }),
    }, env, ctx);
    expect(fakeParticipantJoinRes.status).toBe(422);

    const contextEntities = sqlite.prepare(
      `SELECT entity_type, entity_id, relationship, value_json, metadata_json
         FROM context_record_entities
        WHERE context_record_id = ?
        ORDER BY entity_type, relationship`,
    ).all(sessionContextRecord?.id) as Array<{
      entity_type: string;
      entity_id: string | null;
      relationship: string;
      value_json: string | null;
      metadata_json: string;
    }>;
    expect(contextEntities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity_type: 'meeting_session',
        entity_id: node?.source_reference,
        relationship: 'source_session',
      }),
      expect.objectContaining({
        entity_type: 'session_event',
        relationship: 'source_event',
      }),
      expect.objectContaining({
        entity_type: 'workspace_person',
        entity_id: sessionContextRecord?.workspace_person_id,
        relationship: 'subject',
      }),
    ]));

    const fakeClippyPromptRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_prompt',
        text: 'Would you like to start recording?',
        actor: 'host',
        properties: {
          promptId: 'prompt-start-recording',
          clientId: 'host-client',
          promptSource: 'system',
        },
      }),
    }, env, ctx);
    expect(fakeClippyPromptRes.status).toBe(422);

    const clippyPromptRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_prompt',
        text: 'Would you like to start recording?',
        actor: 'host',
        properties: {
          source: 'clippy_prompt_client_submit',
          promptEventSource: 'browser_proactive_clippy_prompt',
          promptTrigger: 'recording_start_suggestion',
          actor: 'host',
          promptId: 'prompt-start-recording',
          clientId: 'host-client',
          promptCreatedAt: 1782601501000,
          promptLength: 'Would you like to start recording?'.length,
          promptSource: 'system',
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          agentResponseClaimed: false,
        },
      }),
    }, env, ctx);
    expect(clippyPromptRes.status).toBe(200);

    const clippyPromptNode = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_clippy_prompt'
          AND extracted_properties_json LIKE '%clippy_prompt_client_submit%'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(clippyPromptNode).toMatchObject({
      node_type: 'session_clippy_prompt',
      source_type: 'meeting_session',
    });
    expect(clippyPromptNode?.narrative_text).toContain('Clippy prompted');
    expect(JSON.parse(clippyPromptNode?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'host',
      source: 'clippy_prompt_client_submit',
      promptEventSource: 'browser_proactive_clippy_prompt',
      promptTrigger: 'recording_start_suggestion',
      promptId: 'prompt-start-recording',
      promptLength: 'Would you like to start recording?'.length,
      agentResponseClaimed: false,
    });

    const fakeClippyActionRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_action',
        text: 'Clippy action: start recording',
        actor: 'host',
        properties: {
          actionId: 'start-recording',
          surface: 'win95',
        },
      }),
    }, env, ctx);
    expect(fakeClippyActionRes.status).toBe(422);

    const legacyBridgeActionRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_action',
        text: 'devin suggested room action: open-terminal',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          origin: 'agent',
          executionStatus: 'suggested',
          actionId: 'open-terminal',
          actionSource: 'agent_stdout',
          actionProtocol: 'bridge_actions_field',
          bridgeEventType: 'ROOM_ACTION',
          agent: 'devin',
          observedAt: '2026-06-27T21:10:00.000Z',
          capturedAtMs: 1782594600000,
          clippyActionEventId: 'clippy-action:agent:1782594600000:clippy_agent_bridge:agent:suggested:open-terminal',
          bridgePersisted: true,
          browserPromptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          browserPromptFingerprint: 'clippy_0123abcd',
          browserPromptTimestamp: 1782603900000,
          browserPromptLength: 48,
        },
      }),
    }, env, ctx);
    expect(legacyBridgeActionRes.status).toBe(422);

    const attributedUiActionRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_action',
        text: 'Clippy action: start recording',
        actor: 'host',
        properties: {
          source: 'clippy_prompt_ui',
          actionId: 'start-recording',
          origin: 'prompt',
          executedBy: 'host',
          actionSource: 'clippy_prompt_ui',
          executionStatus: 'executed',
          capturedAtMs: 1782594200000,
          clippyActionEventId: 'clippy-action:host:1782594200000:clippy_prompt_ui:prompt:executed:start-recording',
          agent: 'devin',
          agentResponseClaimed: false,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
        },
      }),
    }, env, ctx);
    expect(attributedUiActionRes.status).toBe(422);

    const clippyActionRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_action',
        text: 'Clippy action: start recording',
        actor: 'host',
        properties: {
          source: 'clippy_prompt_ui',
          actionId: 'start-recording',
          origin: 'prompt',
          executedBy: 'host',
          actionSource: 'clippy_prompt_ui',
          executionStatus: 'executed',
          capturedAtMs: 1782594200000,
          clippyActionEventId: 'clippy-action:host:1782594200000:clippy_prompt_ui:prompt:executed:start-recording',
          agent: null,
          agentResponseClaimed: false,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
        },
      }),
    }, env, ctx);
    expect(clippyActionRes.status).toBe(200);

    const clippyChatOpenRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_action',
        text: 'Clippy chat opened from the room chat window',
        actor: 'host',
        properties: {
          source: 'clippy_chat_ui',
          actionId: 'open-clippy-chat',
          origin: 'chat',
          executedBy: 'host',
          actionSource: 'clippy_chat_window',
          executionStatus: 'opened',
          capturedAtMs: 1782594250000,
          clippyActionEventId: 'clippy-action:host:1782594250000:clippy_chat_ui:chat:opened:open-clippy-chat',
          agent: null,
          agentResponseClaimed: false,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
        },
      }),
    }, env, ctx);
    expect(clippyChatOpenRes.status).toBe(200);

    const clippyChatCloseRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_action',
        text: 'Clippy chat window closed',
        actor: 'host',
        properties: {
          source: 'clippy_chat_ui',
          actionId: 'close-clippy-chat',
          origin: 'chat',
          executedBy: 'host',
          actionSource: 'clippy_chat_window',
          executionStatus: 'closed',
          capturedAtMs: 1782594300000,
          clippyActionEventId: 'clippy-action:host:1782594300000:clippy_chat_ui:chat:closed:close-clippy-chat',
          agent: null,
          agentResponseClaimed: false,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
        },
      }),
    }, env, ctx);
    expect(clippyChatCloseRes.status).toBe(200);

    const clippyAuthBrowserRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_action',
        text: 'Clippy opened Devin browser authentication',
        actor: 'host',
        properties: {
          source: 'clippy_prompt_ui',
          actionId: 'open-devin-auth-browser',
          origin: 'prompt',
          executedBy: 'host',
          actionSource: 'clippy_prompt_ui',
          executionStatus: 'executed',
          capturedAtMs: 1782594350000,
          clippyActionEventId: 'clippy-action:host:1782594350000:clippy_prompt_ui:prompt:executed:open-devin-auth-browser',
          agent: null,
          agentResponseClaimed: false,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
        },
      }),
    }, env, ctx);
    expect(clippyAuthBrowserRes.status).toBe(200);

    const clippyAuthTerminalRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_action',
        text: 'Clippy action: open terminal for Devin authentication',
        actor: 'host',
        properties: {
          source: 'clippy_prompt_ui',
          actionId: 'open-devin-auth-terminal',
          origin: 'prompt',
          executedBy: 'host',
          actionSource: 'clippy_prompt_ui',
          executionStatus: 'executed',
          capturedAtMs: 1782594400000,
          clippyActionEventId: 'clippy-action:host:1782594400000:clippy_prompt_ui:prompt:executed:open-devin-auth-terminal',
          agent: null,
          agentResponseClaimed: false,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
        },
      }),
    }, env, ctx);
    expect(clippyAuthTerminalRes.status).toBe(200);

    const clippyAgentSuggestionRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clippy_action',
        text: 'devin suggested room action: open-terminal',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          origin: 'agent',
          executionStatus: 'suggested',
          actionId: 'open-terminal',
          actionSource: 'agent_stdout',
          actionProtocol: 'clippy_room_action_tag',
          bridgeEventType: 'ROOM_ACTION',
          agent: 'devin',
          agentActionLabel: 'Open Terminal',
          agentActionText: 'Open a terminal so we can inspect the failure.',
          autoExecute: false,
          url: null,
          observedAt: '2026-06-27T21:10:00.000Z',
          capturedAtMs: 1782594600000,
          clippyActionEventId: 'clippy-action:agent:1782594600000:clippy_agent_bridge:agent:suggested:open-terminal',
          bridgePersisted: true,
          browserPromptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          browserPromptFingerprint: 'clippy_0123abcd',
          browserPromptTimestamp: 1782603900000,
          browserPromptLength: 48,
        },
      }),
    }, env, ctx);
    expect(clippyAgentSuggestionRes.status).toBe(200);

    const clippyNodes = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_clippy_action'
        ORDER BY narrative_text`,
    ).all(linked?.candidate_id) as Array<{
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    }>;
    expect(clippyNodes).toHaveLength(6);
    expect(clippyNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        node_type: 'session_clippy_action',
        source_type: 'meeting_session',
        narrative_text: expect.stringContaining('Clippy action: start recording'),
      }),
      expect.objectContaining({
        node_type: 'session_clippy_action',
        source_type: 'meeting_session',
        narrative_text: expect.stringContaining('Clippy chat opened from the room chat window'),
      }),
      expect.objectContaining({
        node_type: 'session_clippy_action',
        source_type: 'meeting_session',
        narrative_text: expect.stringContaining('Clippy chat window closed'),
      }),
      expect.objectContaining({
        node_type: 'session_clippy_action',
        source_type: 'meeting_session',
        narrative_text: expect.stringContaining('Clippy opened Devin browser authentication'),
      }),
      expect.objectContaining({
        node_type: 'session_clippy_action',
        source_type: 'meeting_session',
        narrative_text: expect.stringContaining('Clippy action: open terminal for Devin authentication'),
      }),
      expect.objectContaining({
        node_type: 'session_clippy_action',
        source_type: 'meeting_session',
        narrative_text: expect.stringContaining('devin suggested room action: open-terminal'),
      }),
    ]));
    expect(clippyNodes.map((entry) => JSON.parse(entry.extracted_properties_json))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: 'host',
        source: 'clippy_prompt_ui',
        actionId: 'start-recording',
        actionSource: 'clippy_prompt_ui',
        executionStatus: 'executed',
        capturedAtMs: 1782594200000,
        clippyActionEventId: 'clippy-action:host:1782594200000:clippy_prompt_ui:prompt:executed:start-recording',
        surface: 'win95',
      }),
      expect.objectContaining({
        actor: 'host',
        source: 'clippy_chat_ui',
        actionId: 'open-clippy-chat',
        actionSource: 'clippy_chat_window',
        executionStatus: 'opened',
        capturedAtMs: 1782594250000,
        clippyActionEventId: 'clippy-action:host:1782594250000:clippy_chat_ui:chat:opened:open-clippy-chat',
        surface: 'win95',
      }),
      expect.objectContaining({
        actor: 'host',
        source: 'clippy_chat_ui',
        actionId: 'close-clippy-chat',
        actionSource: 'clippy_chat_window',
        executionStatus: 'closed',
        capturedAtMs: 1782594300000,
        clippyActionEventId: 'clippy-action:host:1782594300000:clippy_chat_ui:chat:closed:close-clippy-chat',
        surface: 'win95',
      }),
      expect.objectContaining({
        actor: 'host',
        source: 'clippy_prompt_ui',
        actionId: 'open-devin-auth-browser',
        actionSource: 'clippy_prompt_ui',
        executionStatus: 'executed',
        capturedAtMs: 1782594350000,
        clippyActionEventId: 'clippy-action:host:1782594350000:clippy_prompt_ui:prompt:executed:open-devin-auth-browser',
        surface: 'win95',
      }),
      expect.objectContaining({
        actor: 'host',
        source: 'clippy_prompt_ui',
        actionId: 'open-devin-auth-terminal',
        actionSource: 'clippy_prompt_ui',
        executionStatus: 'executed',
        capturedAtMs: 1782594400000,
        clippyActionEventId: 'clippy-action:host:1782594400000:clippy_prompt_ui:prompt:executed:open-devin-auth-terminal',
        surface: 'win95',
      }),
      expect.objectContaining({
        actor: 'agent',
        source: 'clippy_agent_bridge',
        actionId: 'open-terminal',
        bridgeEventType: 'ROOM_ACTION',
        observedAt: '2026-06-27T21:10:00.000Z',
        capturedAtMs: 1782594600000,
        clippyActionEventId: 'clippy-action:agent:1782594600000:clippy_agent_bridge:agent:suggested:open-terminal',
        bridgePersisted: true,
        browserPromptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
      }),
    ]));

    const agentActionContextRecord = sqlite.prepare(
      `SELECT qualifiers_json
         FROM context_records
        WHERE record_type = 'meeting_session_event'
          AND predicate = 'session_event:clippy_action'
          AND narrative LIKE '%devin suggested room action%'`,
    ).get() as { qualifiers_json: string } | undefined;
    expect(JSON.parse(agentActionContextRecord?.qualifiers_json ?? '{}')).toMatchObject({
      eventType: 'clippy_action',
      actor: 'agent',
      correlationRefs: {
        browserPrompt: {
          promptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          fingerprint: 'clippy_0123abcd',
          timestamp: 1782603900000,
          length: 48,
        },
        clippyAction: {
          actionEventId: 'clippy-action:agent:1782594600000:clippy_agent_bridge:agent:suggested:open-terminal',
        },
      },
    });

    const fakeAgentStatusRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_agent_status',
        text: 'devin is definitely ready.',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          agent: 'devin',
          status: 'idle',
        },
      }),
    }, env, ctx);
    expect(fakeAgentStatusRes.status).toBe(422);

    const browserAgentStatusRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_agent_status',
        text: 'devin is starting from the real container bridge.',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          agentStatusEventSource: 'browser_clippy_agent_ws',
          agent: 'devin',
          status: 'starting',
          bridgeMessageSource: 'agent_status',
          observedAt: '2026-06-27T21:12:00.000Z',
          capturedAtMs: 1782594720000,
          agentStatusEventId: 'agent-status:devin:1782594720000:agent_status:starting:none',
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          messageTimestamp: 1782601920000,
          agentResponseClaimed: false,
        },
      }),
    }, env, ctx);
    expect(browserAgentStatusRes.status).toBe(200);

    const bridgeDiagnosticStatusRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_agent_status',
        text: 'devin chat prompt delivered to process stdin.',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          agent: 'devin',
          status: 'thinking',
          diagnosticSource: 'agent_prompt_sent',
          bridgeMessageSource: 'bridge_diagnostic',
          observedAt: '2026-06-27T21:13:00.000Z',
          capturedAtMs: 1782594780000,
          agentStatusEventId: 'agent-status:devin:1782594780000:bridge_diagnostic:thinking:agent_prompt_sent',
          promptType: 'chat_prompt',
          deliveredToAgent: true,
          promptLength: 120,
          promptFingerprint: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          bridgePersisted: true,
        },
      }),
    }, env, ctx);
    expect(bridgeDiagnosticStatusRes.status).toBe(200);

    const agentStatusNodes = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_agent_status'
        ORDER BY narrative_text`,
    ).all(linked?.candidate_id) as Array<{
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    }>;
    expect(agentStatusNodes).toHaveLength(2);
    expect(agentStatusNodes.map((entry) => JSON.parse(entry.extracted_properties_json))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: 'agent',
        source: 'clippy_agent_bridge',
        agentStatusEventSource: 'browser_clippy_agent_ws',
        bridgeMessageSource: 'agent_status',
        observedAt: '2026-06-27T21:12:00.000Z',
        capturedAtMs: 1782594720000,
        agentStatusEventId: 'agent-status:devin:1782594720000:agent_status:starting:none',
        agentResponseClaimed: false,
      }),
      expect.objectContaining({
        actor: 'agent',
        source: 'clippy_agent_bridge',
        bridgeMessageSource: 'bridge_diagnostic',
        diagnosticSource: 'agent_prompt_sent',
        observedAt: '2026-06-27T21:13:00.000Z',
        capturedAtMs: 1782594780000,
        agentStatusEventId: 'agent-status:devin:1782594780000:bridge_diagnostic:thinking:agent_prompt_sent',
        bridgePersisted: true,
      }),
    ]));

    const fakeCursorPresenceRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'cursor_presence',
        text: 'Guest cursor presence sampled on 95 Until Infinity desktop',
        actor: 'guest',
        properties: {
          source: 'room_cursor_claim',
          surface: 'standard',
          normalizedX: 1.2,
          normalizedY: 0.5,
        },
      }),
    }, env, ctx);
    expect(fakeCursorPresenceRes.status).toBe(422);

    const sourceOnlyCursorPresenceRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'cursor_presence',
        text: 'Guest cursor presence sampled on 95 Until Infinity desktop',
        actor: 'guest',
        properties: {
          source: 'win95_cursor_presence_client_sample',
          surface: 'win95',
          roomPhase: 'connected',
          normalizedX: 0.42,
          normalizedY: 0.61,
          evidenceSampling: 'presence_sample',
          rawCursorMovesPersisted: false,
        },
      }),
    }, env, ctx);
    expect(sourceOnlyCursorPresenceRes.status).toBe(422);

    const cursorPresenceRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'cursor_presence',
        text: 'Guest cursor presence sampled on 95 Until Infinity desktop',
        actor: 'guest',
        properties: {
          source: 'win95_cursor_presence_client_sample',
          cursorEventSource: 'browser_win95_desktop_pointermove',
          actor: 'guest',
          cursorSampleId: 'cursor:guest:1761592321000:420:610',
          sampledAtMs: 1761592321000,
          surface: 'win95',
          roomPhase: 'connected',
          normalizedX: 0.42,
          normalizedY: 0.61,
          previousNormalizedX: null,
          previousNormalizedY: null,
          distanceFromPrevious: null,
          evidenceSampling: 'presence_sample',
          sampleIntervalMs: 15000,
          movementThreshold: 0.03,
          rawCursorMovesPersisted: false,
        },
      }),
    }, env, ctx);
    expect(cursorPresenceRes.status).toBe(200);

    const cursorNode = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_cursor_presence'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(cursorNode).toMatchObject({
      node_type: 'session_cursor_presence',
      source_type: 'meeting_session',
    });
    expect(cursorNode?.narrative_text).toContain('Guest cursor presence sampled');
    expect(JSON.parse(cursorNode?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      source: 'win95_cursor_presence_client_sample',
      cursorEventSource: 'browser_win95_desktop_pointermove',
      cursorSampleId: 'cursor:guest:1761592321000:420:610',
      surface: 'win95',
      normalizedX: 0.42,
      normalizedY: 0.61,
      sampleIntervalMs: 15000,
      movementThreshold: 0.03,
      rawCursorMovesPersisted: false,
    });

    const fakeMediaControlRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'media_control',
        text: 'Guest turned microphone off',
        actor: 'guest',
        properties: {
          source: 'browser_media_claim',
          control: 'microphone',
          enabled: false,
          surface: 'win95',
          roomPhase: 'connected',
        },
      }),
    }, env, ctx);
    expect(fakeMediaControlRes.status).toBe(422);

    const sourceOnlyMediaControlRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'media_control',
        text: 'Guest turned microphone off',
        actor: 'guest',
        properties: {
          source: 'video_room_media_controls',
          control: 'microphone',
          enabled: false,
          action: 'disabled',
          surface: 'win95',
          roomPhase: 'connected',
          controlSurface: 'win95_video_window',
          mediaSource: 'local_media_stream',
          rawMediaStreamPersisted: false,
        },
      }),
    }, env, ctx);
    expect(sourceOnlyMediaControlRes.status).toBe(422);

    const mediaControlRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'media_control',
        text: 'Guest turned microphone off',
        actor: 'guest',
        properties: {
          source: 'video_room_media_controls',
          mediaControlEventSource: 'browser_video_control_button',
          actor: 'guest',
          mediaControlId: 'media:guest:microphone:1761592322000:disabled',
          capturedAtMs: 1761592322000,
          control: 'microphone',
          previousEnabled: true,
          enabled: false,
          action: 'disabled',
          surface: 'win95',
          roomPhase: 'connected',
          controlSurface: 'win95_video_window',
          controlAction: 'toggle',
          mediaSource: 'local_media_stream',
          rawMediaStreamPersisted: false,
        },
      }),
    }, env, ctx);
    expect(mediaControlRes.status).toBe(200);

    const mediaControlNode = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_media_control'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(mediaControlNode).toMatchObject({
      node_type: 'session_media_control',
      source_type: 'meeting_session',
    });
    expect(mediaControlNode?.narrative_text).toContain('Media control changed: Guest turned microphone off');
    expect(JSON.parse(mediaControlNode?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      source: 'video_room_media_controls',
      mediaControlEventSource: 'browser_video_control_button',
      mediaControlId: 'media:guest:microphone:1761592322000:disabled',
      control: 'microphone',
      previousEnabled: true,
      enabled: false,
      action: 'disabled',
      surface: 'win95',
      roomPhase: 'connected',
      controlSurface: 'win95_video_window',
      controlAction: 'toggle',
      rawMediaStreamPersisted: false,
    });

    const fakeRecordingStartRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'recording_start',
        text: 'Recording started',
        actor: 'host',
        properties: {
          source: 'video_room_recording',
          hasTranscriptionAudio: true,
        },
      }),
    }, env, ctx);
    expect(fakeRecordingStartRes.status).toBe(422);

    const recordingStartRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'recording_start',
        text: 'Recording started',
        actor: 'host',
        properties: {
          source: 'video_room_recording',
          recordingEventSource: 'browser_media_recorder',
          recordingLifecycleKind: 'start',
          iceProvider: 'cloudflare',
          hasTranscriptionAudio: true,
          speakerMetadataVersion: 1,
          speakerChannelLayout: 'host-local-guest-remote-v1',
          speakerChannelCount: 2,
          speakerChannels: [
            { channel: 0, role: 'host', source: 'local' },
            { channel: 1, role: 'guest', source: 'remote' },
          ],
        },
      }),
    }, env, ctx);
    expect(recordingStartRes.status).toBe(200);

    const recordingStopRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'recording_stop',
        text: 'Recording stopped',
        actor: 'host',
        properties: {
          source: 'video_room_recording',
          recordingEventSource: 'browser_media_recorder',
          recordingLifecycleKind: 'stop',
          iceProvider: 'cloudflare',
          hasTranscriptionAudio: true,
          speakerMetadataVersion: 1,
          speakerChannelLayout: 'host-local-guest-remote-v1',
          speakerChannelCount: 2,
          speakerChannels: [
            { channel: 0, role: 'host', source: 'local' },
            { channel: 1, role: 'guest', source: 'remote' },
          ],
          uploadStatus: 'attempting',
          recordingBytes: 12345,
          recordingMimeType: 'video/webm;codecs=vp9,opus',
          transcriptionBytes: 2345,
          transcriptionMimeType: 'audio/webm;codecs=opus',
        },
      }),
    }, env, ctx);
    expect(recordingStopRes.status).toBe(200);

    const recordingNodes = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ?
          AND node_type IN ('session_recording_start', 'session_recording_stop')
        ORDER BY node_type`,
    ).all(linked?.candidate_id) as Array<{
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    }>;
    expect(recordingNodes.map((node) => node.node_type)).toEqual([
      'session_recording_start',
      'session_recording_stop',
    ]);
    expect(recordingNodes[0]?.narrative_text).toContain('Recording started');
    expect(recordingNodes[1]?.narrative_text).toContain('Recording stopped');
    expect(JSON.parse(recordingNodes[0]?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'host',
      source: 'video_room_recording',
      recordingEventSource: 'browser_media_recorder',
      recordingLifecycleKind: 'start',
      speakerChannelLayout: 'host-local-guest-remote-v1',
      speakerChannelCount: 2,
    });
    expect(JSON.parse(recordingNodes[1]?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'host',
      source: 'video_room_recording',
      recordingEventSource: 'browser_media_recorder',
      recordingLifecycleKind: 'stop',
      uploadStatus: 'attempting',
      recordingBytes: 12345,
      transcriptionBytes: 2345,
    });

    const fakeWin95FileChangeRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'file_change',
        text: 'Guest saved Notes.txt',
        actor: 'guest',
        properties: {
          source: 'win95_shared_file_system',
          fileEventSource: 'browser_client_submit',
          operation: 'upsert',
          fileId: 'desktop-notes',
          fileName: 'Notes.txt',
          fileKind: 'text',
          surface: 'win95',
          roomPhase: 'connected',
          contentLength: 31,
        },
      }),
    }, env, ctx);
    expect(fakeWin95FileChangeRes.status).toBe(422);

    const win95FileChangeRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'file_change',
        text: 'Guest saved Notes.txt',
        actor: 'guest',
        properties: {
          source: 'win95_shared_file_system',
          fileEventSource: 'browser_client_submit',
          actor: 'guest',
          fileChangeId: 'file:guest:1700000001100:upsert:desktop-notes',
          operation: 'upsert',
          fileId: 'desktop-notes',
          fileName: 'Notes.txt',
          fileKind: 'text',
          mimeType: 'text/plain',
          path: 'Desktop/Notes.txt',
          surface: 'win95',
          roomPhase: 'connected',
          capturedAtMs: 1700000001100,
          contentLength: 31,
          contentHash: 'content_0123456789abcdef0123456789abcdef',
          contentPreview: 'Candidate noted retry evidence.',
          fileCreatedAt: 1700000000000,
          fileUpdatedAt: 1700000001000,
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(win95FileChangeRes.status).toBe(200);

    const win95FileChangeNode = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_file_change'
          AND extracted_properties_json LIKE '%win95_shared_file_system%'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(win95FileChangeNode).toMatchObject({
      node_type: 'session_file_change',
      source_type: 'meeting_session',
    });
    expect(win95FileChangeNode?.narrative_text).toContain('File upsert: Guest saved Notes.txt');
    expect(JSON.parse(win95FileChangeNode?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      source: 'win95_shared_file_system',
      fileEventSource: 'browser_client_submit',
      fileChangeId: 'file:guest:1700000001100:upsert:desktop-notes',
      operation: 'upsert',
      fileId: 'desktop-notes',
      fileName: 'Notes.txt',
      contentHash: 'content_0123456789abcdef0123456789abcdef',
      capturedAtMs: 1700000001100,
      durableObjectReplayExpected: true,
    });

    const codeServerDeleteRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'file_change',
        text: 'src/old-orders.ts',
        actor: 'system',
        properties: {
          source: 'code_server_workspace',
          observedBy: 'clippy_agent_bridge',
          bridgeEventType: 'FILE_CHANGED',
          editorSurface: 'code-server',
          codeServerFileChangeId: 'code-server-file:workspace-session-1:1782594420000:deleted:path_7f2bf00a:abcdefabcdefabcd',
          path: 'src/old-orders.ts',
          action: 'deleted',
          observedAt: '2026-06-27T21:07:00.000Z',
          contentHash: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          sizeBytes: 64,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/acme/orders',
          bridgePersisted: false,
        },
      }),
    }, env, ctx);
    expect(codeServerDeleteRes.status).toBe(200);

    const fakeCodeEditorOpenRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'code_editor_open',
        text: 'VS Code workspace opened for https://github.com/acme/orders',
        actor: 'guest',
        properties: {
          source: 'code_server_workspace',
          editor: 'code-server',
          workspaceSessionId: 'workspace-session-1',
          workspaceStatus: 'READY',
        },
      }),
    }, env, ctx);
    expect(fakeCodeEditorOpenRes.status).toBe(422);

    const codeEditorOpenRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'code_editor_open',
        text: 'VS Code workspace opened for https://github.com/acme/orders',
        actor: 'guest',
        properties: {
          source: 'code_server_workspace',
          editorEventSource: 'browser_code_server_iframe',
          codeEditorOpenId: 'code-editor-open:guest:1700000002100:workspace-session-1',
          editor: 'code-server',
          openStatus: 'loaded',
          actor: 'guest',
          capturedAtMs: 1700000002100,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceSessionId: 'workspace-session-1',
          workspaceStatus: 'READY',
          repoUrl: 'https://github.com/acme/orders',
          githubPrNumber: 42,
          matchedRepoId: 12,
          challengeStatus: 'github_pr_assigned',
          challengeKind: 'github_pr',
          challengeSource: 'scheduled_interview.github_pr_number',
          challengeMessage: null,
          proxyUrlPersisted: false,
        },
      }),
    }, env, ctx);
    expect(codeEditorOpenRes.status).toBe(200);

    const codeEditorOpenNode = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_code_editor_open'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(codeEditorOpenNode).toMatchObject({
      node_type: 'session_code_editor_open',
      source_type: 'meeting_session',
    });
    expect(codeEditorOpenNode?.narrative_text).toContain('Opened in editor');
    const codeEditorOpenProperties = JSON.parse(codeEditorOpenNode?.extracted_properties_json ?? '{}') as Record<string, unknown>;
    expect(codeEditorOpenProperties).toMatchObject({
      actor: 'guest',
      source: 'code_server_workspace',
      editorEventSource: 'browser_code_server_iframe',
      codeEditorOpenId: 'code-editor-open:guest:1700000002100:workspace-session-1',
      editor: 'code-server',
      openStatus: 'loaded',
      capturedAtMs: 1700000002100,
      workspaceSessionId: 'workspace-session-1',
      workspaceStatus: 'READY',
      proxyUrlPersisted: false,
    });
    expect(JSON.stringify(codeEditorOpenProperties)).not.toContain('/workspace/proxy/');

    const fakeCodeEditorSaveRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'code_editor_save',
        text: 'src/orders.ts',
        actor: 'system',
        properties: {
          source: 'browser_guess',
          path: 'src/orders.ts',
          observedAt: '2026-06-27T21:06:00.000Z',
        },
      }),
    }, env, ctx);
    expect(fakeCodeEditorSaveRes.status).toBe(422);

    const sourceOnlyCodeEditorSaveRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'code_editor_save',
        text: 'src/orders.ts',
        actor: 'system',
        properties: {
          source: 'code_server_workspace',
          observedBy: 'agent_bridge',
          path: 'src/orders.ts',
          observedAt: '2026-06-27T21:06:00.000Z',
          contentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          sizeBytes: 128,
        },
      }),
    }, env, ctx);
    expect(sourceOnlyCodeEditorSaveRes.status).toBe(422);

    const codeEditorSaveRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'code_editor_save',
        text: 'src/orders.ts',
        actor: 'system',
        properties: {
          source: 'code_server_workspace',
          observedBy: 'agent_bridge',
          bridgeEventType: 'FILE_CHANGED',
          editorSurface: 'code-server',
          path: 'src/orders.ts',
          action: 'modified',
          observedAt: '2026-06-27T21:06:00.000Z',
          contentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          sizeBytes: 128,
          workspaceRoot: '/workspace',
          bridgePersisted: true,
        },
      }),
    }, env, ctx);
    expect(codeEditorSaveRes.status).toBe(200);

    const codeEditorSaveNode = sqlite.prepare(
      `SELECT node_type, narrative_text, source_type, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_code_editor_save'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      source_type: string;
      extracted_properties_json: string;
    } | undefined;
    expect(codeEditorSaveNode).toMatchObject({
      node_type: 'session_code_editor_save',
      source_type: 'meeting_session',
    });
    expect(codeEditorSaveNode?.narrative_text).toContain('Saved in editor: src/orders.ts');
    expect(JSON.parse(codeEditorSaveNode?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'system',
      source: 'code_server_workspace',
      observedBy: 'agent_bridge',
      bridgeEventType: 'FILE_CHANGED',
      editorSurface: 'code-server',
      path: 'src/orders.ts',
      action: 'modified',
      contentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      sizeBytes: 128,
      workspaceRoot: '/workspace',
      bridgePersisted: true,
    });

    const fakeClippyUserChatRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_chat_user',
        text: 'Can you explain the failing order recovery test?',
        actor: 'guest',
        properties: {
          source: 'clippy_agent_chat',
          surface: 'win95',
          workspaceSessionId: 'workspace-session-1',
        },
      }),
    }, env, ctx);
    expect(fakeClippyUserChatRes.status).toBe(422);
    await expect(fakeClippyUserChatRes.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid session event.',
      },
    });

    const attributedClippyUserChatRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_chat_user',
        text: 'Can you explain the failing order recovery test?',
        actor: 'guest',
        properties: {
          source: 'clippy_agent_chat_client_submit',
          agentChatEventSource: 'browser_clippy_chat_window',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'clippy_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          promptFingerprint: 'clippy_0123abcd',
          promptLength: 48,
          promptTimestamp: 1782603900000,
          deliveredToAgentBridge: true,
          agent: 'devin',
          agentResponseClaimed: false,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/acme/orders',
        },
      }),
    }, env, ctx);
    expect(attributedClippyUserChatRes.status).toBe(422);
    await expect(attributedClippyUserChatRes.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid session event.',
      },
    });

    const deliveredClippyUserChatRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_chat_user',
        text: 'Can you explain the failing order recovery test?',
        actor: 'guest',
        properties: {
          source: 'clippy_agent_chat_client_submit',
          agentChatEventSource: 'browser_clippy_chat_window',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'clippy_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          promptFingerprint: 'clippy_0123abcd',
          promptLength: 48,
          promptTimestamp: 1782603900000,
          deliveredToAgentBridge: true,
          agent: null,
          agentResponseClaimed: false,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/acme/orders',
        },
      }),
    }, env, ctx);
    expect(deliveredClippyUserChatRes.status).toBe(422);
    await expect(deliveredClippyUserChatRes.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid session event.',
      },
    });

    const clippyUserChatRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_chat_user',
        text: 'Can you explain the failing order recovery test?',
        actor: 'guest',
        properties: {
          source: 'clippy_agent_chat_client_submit',
          agentChatEventSource: 'browser_clippy_chat_window',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'clippy_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          promptFingerprint: 'clippy_0123abcd',
          promptLength: 48,
          promptTimestamp: 1782603900000,
          browserQueuedBridgeMessage: true,
          bridgeDeliveryConfirmed: false,
          agent: null,
          agentResponseClaimed: false,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/acme/orders',
        },
      }),
    }, env, ctx);
    expect(clippyUserChatRes.status).toBe(200);

    const fakeClippyAgentChatRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_chat_agent',
        text: 'The fake agent claims it inspected the code.',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_chat',
          agent: 'devin',
          surface: 'win95',
          workspaceSessionId: 'workspace-session-1',
        },
      }),
    }, env, ctx);
    expect(fakeClippyAgentChatRes.status).toBe(422);
    await expect(fakeClippyAgentChatRes.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid session event.',
      },
    });

    const fakeBridgeAgentChatRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_chat_agent',
        text: 'The fake bridge-shaped agent claims it inspected the code.',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          agent: 'devin',
          bridgeEventType: 'CHAT_RESPONSE',
          observedAt: '2026-06-27T21:05:00.000Z',
        },
      }),
    }, env, ctx);
    expect(fakeBridgeAgentChatRes.status).toBe(422);

    const clippyAgentChatRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_chat_agent',
        text: 'The failing test is asserting replay idempotency after an inventory timeout.',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          agent: 'devin',
          bridgeEventType: 'CHAT_RESPONSE',
          bridgeMessageSource: 'agent_stdout',
          observedAt: '2026-06-27T21:05:00.000Z',
          capturedAtMs: 1782594300000,
          agentChatResponseId: 'agent-chat:devin:1782594300000:CHAT_RESPONSE:agent_4c000d1c',
          responseFingerprint: 'agent_4c000d1c',
          responseLength: 76,
          actionCount: 0,
          bridgePersisted: true,
          browserPromptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          browserPromptFingerprint: 'clippy_0123abcd',
          browserPromptTimestamp: 1782603900000,
          browserPromptLength: 48,
          surface: 'win95',
          workspaceSessionId: 'workspace-session-1',
        },
      }),
    }, env, ctx);
    expect(clippyAgentChatRes.status).toBe(200);

    const malformedPromptRefAgentChatRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_chat_agent',
        text: 'The failing test is asserting replay idempotency after an inventory timeout.',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          agent: 'devin',
          bridgeEventType: 'CHAT_RESPONSE',
          bridgeMessageSource: 'agent_stdout',
          observedAt: '2026-06-27T21:05:00.000Z',
          capturedAtMs: 1782594300000,
          agentChatResponseId: 'agent-chat:devin:1782594300000:CHAT_RESPONSE:agent_4c000d1c',
          responseFingerprint: 'agent_4c000d1c',
          responseLength: 76,
          actionCount: 0,
          bridgePersisted: true,
          browserPromptId: 'source-less-prompt-ref',
          browserPromptFingerprint: 'clippy_0123abcd',
          browserPromptTimestamp: 1782603900000,
          browserPromptLength: 48,
        },
      }),
    }, env, ctx);
    expect(malformedPromptRefAgentChatRes.status).toBe(422);

    const clippyAgentFallbackRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ai_chat_agent',
        text: 'I saw the same timeout in the order recovery test output.',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          agent: 'devin',
          bridgeEventType: 'CHAT_RESPONSE',
          bridgeMessageSource: 'agent_stdout',
          observedAt: '2026-06-27T21:06:00.000Z',
          capturedAtMs: 1782594360000,
          agentChatResponseId: 'agent-chat:devin:1782594360000:CHAT_RESPONSE:agent_525b9849',
          responseFingerprint: 'agent_525b9849',
          responseLength: 57,
          bridgePersisted: false,
          persistenceFallback: 'browser_after_bridge_persist_failed',
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          messageTimestamp: 1782603960000,
          agentResponseClaimed: true,
        },
      }),
    }, env, ctx);
    expect(clippyAgentFallbackRes.status).toBe(200);

    const chatNodes = sqlite.prepare(
      `SELECT node_type, narrative_text, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ?
          AND node_type IN ('session_chat_user', 'session_chat_agent')
        ORDER BY node_type`,
    ).all(linked?.candidate_id) as Array<{
      node_type: string;
      narrative_text: string;
      extracted_properties_json: string;
    }>;
    expect(chatNodes).toHaveLength(3);
    expect(chatNodes.map((node) => node.node_type)).toEqual([
      'session_chat_agent',
      'session_chat_agent',
      'session_chat_user',
    ]);
    expect(chatNodes[0]?.narrative_text).toContain('Agent responded');
    expect(chatNodes.map((node) => node.narrative_text).join('\n')).toContain('replay idempotency');
    expect(chatNodes.map((node) => node.narrative_text).join('\n')).toContain('order recovery test output');
    const agentChatProperties = chatNodes
      .filter((node) => node.node_type === 'session_chat_agent')
      .map((node) => JSON.parse(node.extracted_properties_json ?? '{}') as Record<string, unknown>);
    expect(agentChatProperties).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: 'agent',
        source: 'clippy_agent_bridge',
        agent: 'devin',
        bridgeEventType: 'CHAT_RESPONSE',
        bridgeMessageSource: 'agent_stdout',
        observedAt: '2026-06-27T21:05:00.000Z',
        capturedAtMs: 1782594300000,
        agentChatResponseId: 'agent-chat:devin:1782594300000:CHAT_RESPONSE:agent_4c000d1c',
        responseFingerprint: 'agent_4c000d1c',
        responseLength: 76,
        actionCount: 0,
        bridgePersisted: true,
        workspaceSessionId: 'workspace-session-1',
      }),
      expect.objectContaining({
        actor: 'agent',
        source: 'clippy_agent_bridge',
        agent: 'devin',
        bridgeEventType: 'CHAT_RESPONSE',
        bridgeMessageSource: 'agent_stdout',
        observedAt: '2026-06-27T21:06:00.000Z',
        capturedAtMs: 1782594360000,
        agentChatResponseId: 'agent-chat:devin:1782594360000:CHAT_RESPONSE:agent_525b9849',
        responseFingerprint: 'agent_525b9849',
        responseLength: 57,
        bridgePersisted: false,
        persistenceFallback: 'browser_after_bridge_persist_failed',
        messageTimestamp: 1782603960000,
        agentResponseClaimed: true,
      }),
    ]));

    const agentChatContextRecord = sqlite.prepare(
      `SELECT qualifiers_json
         FROM context_records
        WHERE record_type = 'meeting_session_event'
          AND predicate = 'session_event:ai_chat_agent'
          AND narrative LIKE '%replay idempotency%'`,
    ).get() as { qualifiers_json: string } | undefined;
    expect(JSON.parse(agentChatContextRecord?.qualifiers_json ?? '{}')).toMatchObject({
      eventType: 'ai_chat_agent',
      actor: 'agent',
      correlationRefs: {
        browserPrompt: {
          promptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          fingerprint: 'clippy_0123abcd',
          timestamp: 1782603900000,
          length: 48,
        },
        agentResponse: {
          responseId: 'agent-chat:devin:1782594300000:CHAT_RESPONSE:agent_4c000d1c',
        },
      },
    });

    expect(chatNodes[2]?.narrative_text).toContain('User asked');
    expect(chatNodes[2]?.narrative_text).toContain('order recovery test');
    expect(JSON.parse(chatNodes[2]?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      source: 'clippy_agent_chat_client_submit',
      agentChatEventSource: 'browser_clippy_chat_window',
      bridgeMessageType: 'CHAT',
      promptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
      promptFingerprint: 'clippy_0123abcd',
      promptLength: 48,
      browserQueuedBridgeMessage: true,
      bridgeDeliveryConfirmed: false,
      agentResponseClaimed: false,
      workspaceSessionId: 'workspace-session-1',
    });
  });

  it('persists Win95 source-specific window lifecycle evidence with exact source provenance', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, candidate_id, owner_id, recipient_name, recipient_email, interview_type, status, updated_at
       ) VALUES (?, NULL, ?, ?, ?, 'DEV_CONTAINER_CHALLENGE', 'INVITED', ?)`,
    ).run(
      'scheduled-start-menu-window-evidence',
      'owner-1',
      'Start Menu Candidate',
      'start-menu-window@example.com',
      now,
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Start Menu Candidate',
        recipientEmail: 'start-menu-window@example.com',
        title: 'Start menu evidence room',
        meetingType: 'INTERVIEW',
        scheduledInterviewId: 'scheduled-start-menu-window-evidence',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { hostToken: string };

    const lifecycleRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window_open',
        text: 'notes.txt - Notepad',
        actor: 'guest',
        properties: {
          source: 'window_lifecycle_client_submit',
          lifecycleSource: 'win95_start_menu',
          lifecycleKind: 'open',
          windowLifecycleId: 'window-lifecycle:guest:1782601800000:open:notepad',
          capturedAtMs: 1782601800000,
          actor: 'guest',
          windowId: 'notepad',
          windowType: 'notepad',
          windowTitle: 'notes.txt - Notepad',
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(lifecycleRes.status).toBe(200);

    const linked = sqlite.prepare(
      'SELECT candidate_id FROM scheduled_interviews WHERE id = ?',
    ).get('scheduled-start-menu-window-evidence') as { candidate_id: string } | undefined;
    const node = sqlite.prepare(
      `SELECT node_type, narrative_text, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_window_open'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      extracted_properties_json: string;
    } | undefined;
    expect(node?.narrative_text).toContain('Window opened: notes.txt - Notepad');
    expect(JSON.parse(node?.extracted_properties_json ?? '{}')).toMatchObject({
      source: 'window_lifecycle_client_submit',
      lifecycleSource: 'win95_start_menu',
      lifecycleKind: 'open',
      actor: 'guest',
      windowId: 'notepad',
      windowType: 'notepad',
      windowTitle: 'notes.txt - Notepad',
      windowLifecycleId: 'window-lifecycle:guest:1782601800000:open:notepad',
      capturedAtMs: 1782601800000,
      surface: 'win95',
    });

    const fileManagerLifecycleRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window_open',
        text: 'notes.txt - Notepad',
        actor: 'guest',
        properties: {
          source: 'window_lifecycle_client_submit',
          lifecycleSource: 'win95_file_system',
          lifecycleKind: 'open',
          windowLifecycleId: 'window-lifecycle:guest:1782601800100:open:notepad',
          capturedAtMs: 1782601800100,
          actor: 'guest',
          windowId: 'notepad',
          windowType: 'notepad',
          windowTitle: 'notes.txt - Notepad',
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(fileManagerLifecycleRes.status).toBe(200);

    const fileManagerNode = sqlite.prepare(
      `SELECT node_type, narrative_text, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ?
          AND node_type = 'session_window_open'
          AND extracted_properties_json LIKE '%win95_file_system%'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      extracted_properties_json: string;
    } | undefined;
    expect(fileManagerNode?.narrative_text).toContain('Window opened: notes.txt - Notepad');
    expect(JSON.parse(fileManagerNode?.extracted_properties_json ?? '{}')).toMatchObject({
      source: 'window_lifecycle_client_submit',
      lifecycleSource: 'win95_file_system',
      lifecycleKind: 'open',
      actor: 'guest',
      windowId: 'notepad',
      windowType: 'notepad',
      windowTitle: 'notes.txt - Notepad',
      windowLifecycleId: 'window-lifecycle:guest:1782601800100:open:notepad',
      capturedAtMs: 1782601800100,
      surface: 'win95',
    });
  });

  it('requires stable source-backed evidence for synced window data updates', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, candidate_id, owner_id, recipient_name, recipient_email, interview_type, status, updated_at
       ) VALUES (?, NULL, ?, ?, ?, 'DEV_CONTAINER_CHALLENGE', 'INVITED', ?)`,
    ).run(
      'scheduled-window-data-evidence',
      'owner-1',
      'Window Data Candidate',
      'window-data@example.com',
      now,
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Window Data Candidate',
        recipientEmail: 'window-data@example.com',
        title: 'Window data evidence room',
        meetingType: 'INTERVIEW',
        scheduledInterviewId: 'scheduled-window-data-evidence',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { hostToken: string };

    const sourceOnlyRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window_update',
        text: 'Window data updated: notepad',
        actor: 'guest',
        properties: {
          source: 'window_data_client_submit',
          dataSource: 'win95_window_data_sync',
          actor: 'guest',
          windowId: 'notepad',
          action: 'edit_text',
          dataKeys: ['text'],
          dataValueFingerprints: { text: 'data_81a94acf' },
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(sourceOnlyRes.status).toBe(422);

    const validRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window_update',
        text: 'Window data updated: notepad',
        actor: 'guest',
        properties: {
          source: 'window_data_client_submit',
          dataSource: 'win95_window_data_sync',
          actor: 'guest',
          windowId: 'notepad',
          action: 'edit_text',
          windowDataUpdateId: 'window-data:guest:1782601700000:notepad:edit_text',
          capturedAtMs: 1782601700000,
          dataKeys: ['text'],
          dataValueFingerprints: { text: 'data_81a94acf' },
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(validRes.status).toBe(200);

    const deleteClearRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window_update',
        text: 'Window data updated: notepad',
        actor: 'guest',
        properties: {
          source: 'window_data_client_submit',
          dataSource: 'win95_file_delete_sync',
          actor: 'guest',
          windowId: 'notepad',
          action: 'edit_text',
          windowDataUpdateId: 'window-data:guest:1782601700100:notepad:edit_text',
          capturedAtMs: 1782601700100,
          dataKeys: ['text'],
          dataValueFingerprints: { text: 'data_12345678' },
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);
    expect(deleteClearRes.status).toBe(200);

    const linked = sqlite.prepare(
      'SELECT candidate_id FROM scheduled_interviews WHERE id = ?',
    ).get('scheduled-window-data-evidence') as { candidate_id: string } | undefined;
    const node = sqlite.prepare(
      `SELECT node_type, narrative_text, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND node_type = 'session_window_update'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      extracted_properties_json: string;
    } | undefined;
    expect(node?.narrative_text).toContain('Window updated: Window data updated: notepad');
    expect(JSON.parse(node?.extracted_properties_json ?? '{}')).toMatchObject({
      source: 'window_data_client_submit',
      dataSource: 'win95_window_data_sync',
      actor: 'guest',
      windowId: 'notepad',
      action: 'edit_text',
      windowDataUpdateId: 'window-data:guest:1782601700000:notepad:edit_text',
      capturedAtMs: 1782601700000,
      dataKeys: ['text'],
      dataValueFingerprints: { text: 'data_81a94acf' },
    });

    const deleteClearNode = sqlite.prepare(
      `SELECT node_type, narrative_text, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ?
          AND node_type = 'session_window_update'
          AND extracted_properties_json LIKE '%win95_file_delete_sync%'`,
    ).get(linked?.candidate_id) as {
      node_type: string;
      narrative_text: string;
      extracted_properties_json: string;
    } | undefined;
    expect(deleteClearNode?.narrative_text).toContain('Window updated: Window data updated: notepad');
    expect(JSON.parse(deleteClearNode?.extracted_properties_json ?? '{}')).toMatchObject({
      source: 'window_data_client_submit',
      dataSource: 'win95_file_delete_sync',
      actor: 'guest',
      windowId: 'notepad',
      action: 'edit_text',
      windowDataUpdateId: 'window-data:guest:1782601700100:notepad:edit_text',
      capturedAtMs: 1782601700100,
      dataKeys: ['text'],
      dataValueFingerprints: { text: 'data_12345678' },
    });
  });

  it('returns non-OK when a valid session event cannot be persisted', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, candidate_id, owner_id, recipient_name, recipient_email, interview_type, status, updated_at
       ) VALUES (?, NULL, ?, ?, ?, 'DEV_CONTAINER_CHALLENGE', 'INVITED', ?)`,
    ).run(
      'scheduled-session-persist-failure',
      'owner-1',
      'Persist Failure Candidate',
      'persist-failure@example.com',
      now,
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Persist Failure Candidate',
        recipientEmail: 'persist-failure@example.com',
        title: 'Session event persistence failure',
        meetingType: 'INTERVIEW',
        scheduledInterviewId: 'scheduled-session-persist-failure',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { hostToken: string };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    sqlite.exec('DROP TABLE candidate_nodes');

    const sessionEventRes = await app.request(`/meeting/${created.hostToken}/session-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'window_update',
        text: 'Window state updated: browser',
        actor: 'guest',
        properties: {
          source: 'window_state_client_submit',
          stateSource: 'win95_start_menu',
          actor: 'guest',
          windowId: 'browser',
          action: 'restore_or_focus',
          windowStateChangeId: 'window-state:guest:1782601600000:browser:restore_or_focus',
          capturedAtMs: 1782601600000,
          statePatch: { minimized: false, focused: true },
          stateKeys: ['focused', 'minimized'],
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      }),
    }, env, ctx);

    expect(sessionEventRes.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      '[sessionEvents] Failed to capture event:',
      expect.any(Error),
    );
    consoleError.mockRestore();
    await expect(sessionEventRes.json()).resolves.toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Session event could not be persisted.',
      },
    });
  });

  it('syncs durable room activity into the candidate context graph before graph reads', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    const activitySnapshot = {
      desktopActivityLog: [
        {
          role: 'HOST',
          recordedAt: 1700000000000,
          event: {
            id: 'evt-enter-95',
            clientId: 'host-client',
            createdAt: 1700000000000,
            kind: 'SET_ROOM_SURFACE',
            surface: 'win95',
            previousSurface: 'standard',
            action: 'enter_desktop',
            source: 'room_surface_control',
            surfaceControlEventSource: 'browser_room_surface_toggle',
            actor: 'host',
            surfaceChangeId: 'surface:host:1700000000000:standard:win95',
            capturedAtMs: 1700000000000,
            roomPhase: 'connected',
            durableObjectReplayExpected: true,
          },
        },
        {
          role: 'HOST',
          recordedAt: 1700000000500,
          event: {
            id: 'evt-browser-move-1',
            clientId: 'host-client',
            createdAt: 1700000000500,
            kind: 'UPDATE_WINDOW_STATE',
            windowId: 'browser',
            x: 120,
            y: 80,
            focused: true,
            evidence: {
              source: 'window_state_client_submit',
              stateSource: 'win95_window_chrome',
              actor: 'host',
              windowId: 'browser',
              action: 'move',
              windowStateChangeId: 'window-state:host:1700000000500:browser:move',
              capturedAtMs: 1700000000500,
              surface: 'win95',
              roomPhase: 'connected',
              durableObjectReplayExpected: true,
            },
          },
        },
        {
          role: 'HOST',
          recordedAt: 1700000000600,
          event: {
            id: 'evt-browser-move-2',
            clientId: 'host-client',
            createdAt: 1700000000600,
            kind: 'UPDATE_WINDOW_STATE',
            windowId: 'browser',
            x: 180,
            y: 120,
            focused: true,
            evidence: {
              source: 'window_state_client_submit',
              stateSource: 'win95_window_chrome',
              actor: 'host',
              windowId: 'browser',
              action: 'move',
              windowStateChangeId: 'window-state:host:1700000000600:browser:move',
              capturedAtMs: 1700000000600,
              surface: 'win95',
              roomPhase: 'connected',
              durableObjectReplayExpected: true,
            },
          },
        },
        {
          role: 'HOST',
          recordedAt: 1700000001000,
          event: {
            id: 'evt-workspace-ready',
            clientId: 'host-client',
            createdAt: 1700000001000,
            kind: 'WORKSPACE_STATE_CHANGED',
            actor: 'host',
            workspaceStateEventId: 'workspace-state:host:1700000001000:launch:workspace-session-1:READY',
            capturedAtMs: 1700000001000,
            status: 'READY',
            workspaceSessionId: 'workspace-session-1',
            repoUrl: 'https://github.com/cloudflare/workers-sdk',
            githubPrNumber: 14435,
            matchedRepoId: 42,
            challengeStatus: 'github_pr_assigned',
            challengeKind: 'github_pr',
            challengeSource: 'scheduled_interview.github_pr_number',
            challengeMessage: null,
            ttlSeconds: 3600,
            ttlSource: 'default',
            expiringSoon: false,
            source: 'browser_workspace_state_observer',
            workspaceEventSource: 'browser_workspace_state_observer',
            workspaceStateSource: 'launch',
            workspaceTelemetryPersisted: true,
            proxyUrlPersisted: false,
          },
        },
      ],
      chatActivityLog: [
        {
          role: 'GUEST',
          recordedAt: 1700000002000,
          message: {
            id: 'chat-1',
            clientId: 'guest-client',
            createdAt: 1700000002000,
            role: 'GUEST',
            text: 'I found the retry bug in the queue worker.',
            deliveryStatus: 'accepted',
            evidence: {
              source: 'room_chat_client_submit',
              chatEventSource: 'browser_room_chat_window',
              actor: 'guest',
              roomMessageId: 'chat-1',
              clientId: 'guest-client',
              messageCreatedAt: 1700000002000,
              messageLength: 'I found the retry bug in the queue worker.'.length,
              deliveryStatus: 'accepted',
              surface: 'win95',
              roomPhase: 'connected',
              durableObjectReplayExpected: true,
            },
          },
        },
      ],
      codeServerFileActivityLog: [
        {
          role: 'GUEST',
          recordedAt: 1700000002400,
          event: {
            id: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
            clientId: 'guest-client',
            createdAt: 1700000002400,
            eventType: 'code_editor_save',
            actor: 'system',
            text: 'src/app.ts',
            evidence: {
              source: 'code_server_workspace',
              observedBy: 'clippy_agent_bridge',
              bridgeEventType: 'FILE_CHANGED',
              editorSurface: 'code-server',
              codeServerFileChangeId: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
              action: 'modified',
              surface: 'win95',
              roomPhase: 'connected',
              workspaceStatus: 'READY',
              workspaceSessionId: 'workspace-session-1',
              repoUrl: 'https://github.com/cloudflare/workers-sdk',
              path: 'src/app.ts',
              observedAt: '2026-06-27T20:01:40.000Z',
              contentHash: 'a'.repeat(64),
              sizeBytes: 421,
              contentPreview: 'export const answer = 42;',
              bridgePersisted: false,
              durableObjectReplayExpected: true,
            },
          },
        },
      ],
      terminalActivityLog: [
        {
          role: 'GUEST',
          recordedAt: 1700000002500,
          event: {
            id: 'terminal-command-sync',
            clientId: 'guest-client',
            createdAt: 1700000002500,
            kind: 'COMMAND',
            text: 'npm test',
            evidence: {
              source: 'container_terminal',
              terminalEventSource: 'browser_terminal_ws',
              terminalSessionId: 'terminal-workspace-session-1-guest',
              terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000002500:1:terminal_dc5964d6',
              terminalCommandSequence: 1,
              actor: 'guest',
              capturedAtMs: 1700000002500,
              commandFingerprint: 'terminal_dc5964d6',
              commandLength: 8,
              surface: 'win95',
              roomPhase: 'connected',
              workspaceStatus: 'READY',
              workspaceSessionId: 'workspace-session-1',
              repoUrl: 'https://github.com/cloudflare/workers-sdk',
              durableObjectReplayExpected: true,
            },
          },
        },
        {
          role: 'GUEST',
          recordedAt: 1700000002600,
          event: {
            id: 'terminal-output-sync',
            clientId: 'guest-client',
            createdAt: 1700000002600,
            kind: 'OUTPUT',
            text: 'PASS src/app.test.ts\n',
            evidence: {
              source: 'container_terminal',
              terminalEventSource: 'browser_terminal_ws',
              terminalSessionId: 'terminal-workspace-session-1-guest',
              terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000002500:1:terminal_dc5964d6',
              terminalOutputChunkId: 'terminal-workspace-session-1-guest:output:system:1700000002600:1:terminal_4f2d0d8f',
              terminalOutputSequence: 1,
              actor: 'system',
              capturedAtMs: 1700000002600,
              outputFingerprint: 'terminal_4f2d0d8f',
              outputLength: 21,
              surface: 'win95',
              roomPhase: 'connected',
              workspaceStatus: 'READY',
              workspaceSessionId: 'workspace-session-1',
              repoUrl: 'https://github.com/cloudflare/workers-sdk',
              durableObjectReplayExpected: true,
            },
          },
        },
      ],
      clippyPromptActivityLog: [
        {
          role: 'HOST',
          recordedAt: 1700000003000,
          prompt: {
            id: 'prompt-open-workspace',
            clientId: 'host-client',
            createdAt: 1700000003000,
            source: 'system',
            promptEventSource: 'browser_proactive_clippy_prompt',
            promptTrigger: 'host_waiting_prepare_workspace',
            surface: 'win95',
            roomPhase: 'connected',
            workspaceStatus: 'READY',
            workspaceSessionId: 'workspace-session-1',
            agentResponseClaimed: false,
            text: 'Would you like to open the workspace?',
            actions: [{ id: 'open-workspace', label: 'Open workspace' }],
          },
        },
      ],
      clippyInteractionActivityLog: [
        {
          role: 'GUEST',
          recordedAt: 1700000003200,
          event: {
            id: 'clippy-user-chat-sync',
            clientId: 'guest-client',
            createdAt: 1700000003200,
            eventType: 'ai_chat_user',
            actor: 'guest',
            text: 'Can you inspect the failing test?',
            evidence: {
              source: 'clippy_agent_chat_client_submit',
              agentChatEventSource: 'browser_clippy_chat_window',
              bridgeMessageType: 'CHAT',
              bridgeProtocol: 'clippy_dev_container_ws',
              promptId: 'workspace-session-1:guest:prompt:1700000003200:clippy_0123abcd',
              promptFingerprint: 'clippy_0123abcd',
              promptLength: 'Can you inspect the failing test?'.length,
              promptTimestamp: 1700000003200,
              browserQueuedBridgeMessage: true,
              bridgeDeliveryConfirmed: false,
              agent: null,
              surface: 'win95',
              roomPhase: 'connected',
              workspaceStatus: 'READY',
              workspaceSessionId: 'workspace-session-1',
              repoUrl: 'https://github.com/cloudflare/workers-sdk',
              agentResponseClaimed: false,
              actor: 'guest',
              durableObjectReplayExpected: true,
            },
          },
        },
        {
          role: 'GUEST',
          recordedAt: 1700000003300,
          event: {
            id: 'clippy-agent-status-sync',
            clientId: 'guest-client',
            createdAt: 1700000003300,
            eventType: 'ai_agent_status',
            actor: 'agent',
            text: 'devin is ready.',
            evidence: {
              source: 'clippy_agent_bridge',
              agentStatusEventSource: 'browser_clippy_agent_ws',
              agent: 'devin',
              status: 'idle',
              diagnosticSource: null,
              bridgeMessageSource: 'agent_status',
              observedAt: '2026-06-27T20:00:00.000Z',
              capturedAtMs: 1700000003300,
              agentStatusEventId: 'agent-status:devin:1700000003300:agent_status:idle:none',
              surface: 'win95',
              roomPhase: 'connected',
              workspaceStatus: 'READY',
              workspaceSessionId: 'workspace-session-1',
              messageTimestamp: 1700000003300,
              agentResponseClaimed: false,
              durableObjectReplayExpected: true,
            },
          },
        },
      ],
      fileSystemActivityLog: [
        {
          role: 'GUEST',
          recordedAt: 1700000004000,
          event: {
            id: 'fs-notes-save',
            clientId: 'guest-client',
            createdAt: 1700000004000,
            kind: 'UPSERT_FILE',
            file: {
              id: 'notepad',
              name: 'notes.txt',
              kind: 'text',
              content: 'Candidate identified retry bug evidence.',
              mimeType: 'text/plain',
              createdAt: 1700000004000,
              updatedAt: 1700000004000,
            },
            evidence: {
              source: 'win95_shared_file_system',
              fileEventSource: 'browser_client_submit',
              fileChangeId: 'file:guest:1700000004000:upsert:notepad',
              actor: 'guest',
              operation: 'upsert',
              fileId: 'notepad',
              fileName: 'notes.txt',
              fileKind: 'text',
              surface: 'win95',
              roomPhase: 'connected',
              capturedAtMs: 1700000004000,
              durableObjectReplayExpected: true,
            },
          },
        },
      ],
    };
    const doFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/activity-log') {
        return new Response(JSON.stringify(activitySnapshot), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    env.VIDEO_ROOM = {
      idFromName: vi.fn(() => ({}) as DurableObjectId),
      get: vi.fn(() => ({ fetch: doFetch }) as unknown as DurableObjectStub),
    } as unknown as DurableObjectNamespace;
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, candidate_id, owner_id, recipient_name, recipient_email, interview_type, status, updated_at
       ) VALUES (?, NULL, ?, ?, ?, 'DEV_CONTAINER_CHALLENGE', 'INVITED', ?)`,
    ).run(
      'scheduled-activity-graph',
      'owner-1',
      'Activity Graph Candidate',
      'activity-graph@example.com',
      new Date().toISOString(),
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Activity Graph Candidate',
        recipientEmail: 'activity-graph@example.com',
        title: 'Activity graph room',
        meetingType: 'INTERVIEW',
        scheduledInterviewId: 'scheduled-activity-graph',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { hostToken: string };

    const graphRes = await app.request(`/meeting/${created.hostToken}/context-graph`, {
      method: 'GET',
    }, env, ctx);
    expect(graphRes.status).toBe(200);
    const graphBody = await graphRes.json() as {
      candidateId: string;
      events: Array<{
        nodeType: string;
        narrativeText: string;
        properties: Record<string, unknown> | null;
      }>;
    };
    expect(graphBody.events.map((event) => event.nodeType)).toEqual([
      'session_room_surface_change',
      'session_window_update',
      'session_window_update',
      'session_workspace_state',
      'session_chat_message',
      'session_code_editor_save',
      'session_terminal_command',
      'session_terminal_output',
      'session_agent_status',
      'session_chat_user',
      'session_clippy_prompt',
      'session_file_change',
    ]);
    expect(graphBody.events.map((event) => event.narrativeText).join('\n')).toContain(
      'I found the retry bug in the queue worker.',
    );
    expect(graphBody.events.find((event) => event.nodeType === 'session_workspace_state')?.properties).toMatchObject({
      roomActivitySource: 'durable_object',
      source: 'browser_workspace_state_observer',
      workspaceEventSource: 'browser_workspace_state_observer',
      workspaceStateSource: 'launch',
      actor: 'host',
      workspaceStateEventId: 'workspace-state:host:1700000001000:launch:workspace-session-1:READY',
      capturedAtMs: 1700000001000,
      workspaceTelemetryPersisted: true,
      proxyUrlPersisted: false,
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-session-1',
    });
    expect(graphBody.events.find((event) => event.nodeType === 'session_chat_message')?.properties).toMatchObject({
      roomActivitySource: 'durable_object',
      source: 'room_chat_client_submit',
      chatEventSource: 'browser_room_chat_window',
      actor: 'guest',
      roomMessageId: 'chat-1',
      clientId: 'guest-client',
      messageCreatedAt: 1700000002000,
      messageLength: 'I found the retry bug in the queue worker.'.length,
      deliveryStatus: 'accepted',
      surface: 'win95',
      roomPhase: 'connected',
      durableObjectReplayExpected: true,
    });
    expect(graphBody.events.find((event) => event.nodeType === 'session_code_editor_save')?.properties).toMatchObject({
      roomActivitySource: 'durable_object',
      roomActivityKind: 'code_server_file',
      source: 'code_server_workspace',
      observedBy: 'clippy_agent_bridge',
      bridgeEventType: 'FILE_CHANGED',
      editorSurface: 'code-server',
      action: 'modified',
      path: 'src/app.ts',
      contentHash: 'a'.repeat(64),
      sizeBytes: 421,
      bridgePersisted: false,
      codeServerFileChangeId: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
      roomEventId: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
      workspaceSessionId: 'workspace-session-1',
    });
    expect(graphBody.events.find((event) => event.nodeType === 'session_terminal_command')?.properties).toMatchObject({
      roomActivitySource: 'durable_object',
      roomActivityKind: 'terminal',
      source: 'container_terminal',
      terminalEventSource: 'browser_terminal_ws',
      terminalSessionId: 'terminal-workspace-session-1-guest',
      terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000002500:1:terminal_dc5964d6',
      terminalCommandSequence: 1,
      actor: 'guest',
      roomEventId: 'terminal-command-sync',
      capturedAtMs: 1700000002500,
      workspaceSessionId: 'workspace-session-1',
    });
    expect(graphBody.events.find((event) => event.nodeType === 'session_terminal_output')?.properties).toMatchObject({
      roomActivitySource: 'durable_object',
      roomActivityKind: 'terminal',
      source: 'container_terminal',
      terminalEventSource: 'browser_terminal_ws',
      terminalOutputChunkId: 'terminal-workspace-session-1-guest:output:system:1700000002600:1:terminal_4f2d0d8f',
      terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000002500:1:terminal_dc5964d6',
      actor: 'system',
      roomEventId: 'terminal-output-sync',
      capturedAtMs: 1700000002600,
      workspaceSessionId: 'workspace-session-1',
    });
    expect(graphBody.events.find((event) => event.nodeType === 'session_clippy_prompt')?.properties).toMatchObject({
      roomActivitySource: 'durable_object',
      source: 'clippy_prompt_client_submit',
      promptEventSource: 'browser_proactive_clippy_prompt',
      promptTrigger: 'host_waiting_prepare_workspace',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-session-1',
      agentResponseClaimed: false,
      promptCreatedAt: 1700000003000,
      promptLength: 'Would you like to open the workspace?'.length,
    });
    expect(graphBody.events.find((event) => event.nodeType === 'session_chat_user')?.properties).toMatchObject({
      roomActivitySource: 'durable_object',
      roomActivityKind: 'clippy_interaction',
      source: 'clippy_agent_chat_client_submit',
      agentChatEventSource: 'browser_clippy_chat_window',
      promptId: 'workspace-session-1:guest:prompt:1700000003200:clippy_0123abcd',
      browserQueuedBridgeMessage: true,
      bridgeDeliveryConfirmed: false,
      agent: null,
      actor: 'guest',
      roomEventId: 'clippy-user-chat-sync',
      workspaceSessionId: 'workspace-session-1',
    });
    expect(graphBody.events.find((event) => event.nodeType === 'session_agent_status')?.properties).toMatchObject({
      roomActivitySource: 'durable_object',
      roomActivityKind: 'clippy_interaction',
      source: 'clippy_agent_bridge',
      agentStatusEventSource: 'browser_clippy_agent_ws',
      agent: 'devin',
      status: 'idle',
      agentStatusEventId: 'agent-status:devin:1700000003300:agent_status:idle:none',
      actor: 'agent',
      roomEventId: 'clippy-agent-status-sync',
      workspaceSessionId: 'workspace-session-1',
    });
    expect(graphBody.events.at(-1)?.properties).toMatchObject({
      roomActivitySource: 'durable_object',
      operation: 'upsert',
      fileId: 'notepad',
      contentPreview: 'Candidate identified retry bug evidence.',
    });

    const nodeCountAfterFirstRead = sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM candidate_nodes
        WHERE candidate_id = ? AND source_type = 'meeting_session'`,
    ).get(graphBody.candidateId) as { count: number };
    expect(nodeCountAfterFirstRead.count).toBe(12);
    const windowUpdateRows = sqlite.prepare(
      `SELECT extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ?
          AND source_type = 'meeting_session'
          AND node_type = 'session_window_update'
        ORDER BY captured_at ASC, id ASC`,
    ).all(graphBody.candidateId) as Array<{ extracted_properties_json: string }>;
    expect(windowUpdateRows).toHaveLength(2);
    expect(windowUpdateRows.map((row) => JSON.parse(row.extracted_properties_json).roomEventId).sort()).toEqual([
      'evt-browser-move-1',
      'evt-browser-move-2',
    ]);

    const secondGraphRes = await app.request(`/meeting/${created.hostToken}/context-graph`, {
      method: 'GET',
    }, env, ctx);
    expect(secondGraphRes.status).toBe(200);
    const nodeCountAfterSecondRead = sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM candidate_nodes
        WHERE candidate_id = ? AND source_type = 'meeting_session'`,
    ).get(graphBody.candidateId) as { count: number };
    expect(nodeCountAfterSecondRead.count).toBe(12);
    expect(doFetch).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://do/activity-log',
    }));
  });

  it('syncs durable room activity into source-backed evidence when the host ends the room', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    const activitySnapshot = {
      desktopActivityLog: [
        {
          role: 'HOST',
          recordedAt: 1700000100000,
          event: {
            id: 'evt-enter-95-on-end',
            clientId: 'host-client',
            createdAt: 1700000100000,
            kind: 'SET_ROOM_SURFACE',
            surface: 'win95',
            previousSurface: 'standard',
            action: 'enter_desktop',
            source: 'room_surface_control',
            surfaceControlEventSource: 'browser_room_surface_toggle',
            actor: 'host',
            surfaceChangeId: 'surface:host:1700000100000:standard:win95',
            capturedAtMs: 1700000100000,
            roomPhase: 'connected',
            durableObjectReplayExpected: true,
          },
        },
      ],
      chatActivityLog: [
        {
          role: 'GUEST',
          recordedAt: 1700000101000,
          message: {
            id: 'chat-end-1',
            clientId: 'guest-client',
            createdAt: 1700000101000,
            role: 'GUEST',
            text: 'I would test the retry branch before touching the queue worker.',
            deliveryStatus: 'accepted',
            evidence: {
              source: 'room_chat_client_submit',
              chatEventSource: 'browser_room_chat_window',
              actor: 'guest',
              roomMessageId: 'chat-end-1',
              clientId: 'guest-client',
              messageCreatedAt: 1700000101000,
              messageLength: 'I would test the retry branch before touching the queue worker.'.length,
              deliveryStatus: 'accepted',
              surface: 'win95',
              roomPhase: 'connected',
              durableObjectReplayExpected: true,
            },
          },
        },
      ],
      clippyPromptActivityLog: [],
      fileSystemActivityLog: [
        {
          role: 'GUEST',
          recordedAt: 1700000102000,
          event: {
            id: 'fs-end-notes-save',
            clientId: 'guest-client',
            createdAt: 1700000102000,
            kind: 'UPSERT_FILE',
            file: {
              id: 'end-notes',
              name: 'review-notes.txt',
              kind: 'text',
              content: 'Candidate plans a focused retry test.',
              mimeType: 'text/plain',
              createdAt: 1700000102000,
              updatedAt: 1700000102000,
            },
            evidence: {
              source: 'win95_shared_file_system',
              fileEventSource: 'browser_client_submit',
              fileChangeId: 'file:guest:1700000102000:upsert:end-notes',
              actor: 'guest',
              operation: 'upsert',
              fileId: 'end-notes',
              fileName: 'review-notes.txt',
              fileKind: 'text',
              surface: 'win95',
              roomPhase: 'connected',
              capturedAtMs: 1700000102000,
              durableObjectReplayExpected: true,
            },
          },
        },
      ],
    };
    const doFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/activity-log') {
        return new Response(JSON.stringify(activitySnapshot), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    env.VIDEO_ROOM = {
      idFromName: vi.fn(() => ({}) as DurableObjectId),
      get: vi.fn(() => ({ fetch: doFetch }) as unknown as DurableObjectStub),
    } as unknown as DurableObjectNamespace;
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, candidate_id, owner_id, recipient_name, recipient_email, interview_type, status, updated_at
       ) VALUES (?, NULL, ?, ?, ?, 'OPEN_SOURCE_BUG_FIX', 'INVITED', ?)`,
    ).run(
      'scheduled-end-sync',
      'owner-1',
      'End Sync Candidate',
      'end-sync@example.com',
      new Date().toISOString(),
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'End Sync Candidate',
        recipientEmail: 'end-sync@example.com',
        title: 'End sync room',
        meetingType: 'INTERVIEW',
        scheduledInterviewId: 'scheduled-end-sync',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { hostToken: string };

    const endedRes = await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'ENDED' }),
    }, env, ctx);
    expect(endedRes.status).toBe(200);

    const linked = sqlite.prepare(
      'SELECT candidate_id FROM scheduled_interviews WHERE id = ?',
    ).get('scheduled-end-sync') as { candidate_id: string } | undefined;
    expect(linked?.candidate_id).toEqual(expect.any(String));

    const evidenceRows = sqlite.prepare(
      `SELECT node_type, narrative_text, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND source_type = 'meeting_session'
        ORDER BY captured_at ASC`,
    ).all(linked?.candidate_id) as Array<{
      node_type: string;
      narrative_text: string;
      extracted_properties_json: string | null;
    }>;
    expect(evidenceRows.map((row) => row.node_type)).toEqual([
      'session_room_surface_change',
      'session_chat_message',
      'session_file_change',
    ]);
    expect(evidenceRows.map((row) => row.narrative_text).join('\n')).toContain(
      'I would test the retry branch before touching the queue worker.',
    );
    const fileEvidence = evidenceRows.find((row) => row.node_type === 'session_file_change');
    expect(JSON.parse(fileEvidence?.extracted_properties_json ?? '{}')).toMatchObject({
      roomActivitySource: 'durable_object',
      operation: 'upsert',
      fileId: 'end-notes',
      contentPreview: 'Candidate plans a focused retry test.',
    });

    const contextRows = sqlite.prepare(
      `SELECT predicate
         FROM context_records
        WHERE record_type = 'meeting_session_event'
        ORDER BY observed_at ASC`,
    ).all() as Array<{ predicate: string }>;
    expect(contextRows.map((row) => row.predicate)).toEqual([
      'session_event:room_surface_change',
      'session_event:chat_message',
      'session_event:file_change',
    ]);
    expect(doFetch).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://do/activity-log',
    }));
  });

  it('captures real room lifecycle events as source-backed session evidence', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    const doFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/activity-log') {
        return new Response(JSON.stringify({
          desktopActivityLog: [],
          chatActivityLog: [],
          clippyPromptActivityLog: [],
          fileSystemActivityLog: [],
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    env.VIDEO_ROOM = {
      idFromName: vi.fn(() => ({}) as DurableObjectId),
      get: vi.fn(() => ({ fetch: doFetch }) as unknown as DurableObjectStub),
    } as unknown as DurableObjectNamespace;
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, candidate_id, owner_id, recipient_name, recipient_email, interview_type, status, updated_at
       ) VALUES (?, NULL, ?, ?, ?, 'OPEN_SOURCE_BUG_FIX', 'INVITED', ?)`,
    ).run(
      'scheduled-lifecycle-evidence',
      'owner-1',
      'Lifecycle Evidence Candidate',
      'lifecycle-evidence@example.com',
      new Date().toISOString(),
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Lifecycle Evidence Candidate',
        recipientEmail: 'lifecycle-evidence@example.com',
        title: 'Lifecycle evidence room',
        meetingType: 'INTERVIEW',
        scheduledInterviewId: 'scheduled-lifecycle-evidence',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      meeting: { id: string };
      hostToken: string;
    };

    const inviteRes = await app.request(`/meetings/${created.meeting.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'lifecycle-evidence@example.com' }),
    }, env, ctx);
    expect(inviteRes.status).toBe(200);
    const invite = await inviteRes.json() as { guestToken: string };

    const guestJoinedRes = await app.request(`/meeting/${invite.guestToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'JOINED' }),
    }, env, ctx);
    expect(guestJoinedRes.status).toBe(200);

    const recordingStartedRes = await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'RECORDING_STARTED' }),
    }, env, ctx);
    expect(recordingStartedRes.status).toBe(200);

    const guestLeftRes = await app.request(`/meeting/${invite.guestToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'LEFT' }),
    }, env, ctx);
    expect(guestLeftRes.status).toBe(200);

    const endedRes = await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'ENDED' }),
    }, env, ctx);
    expect(endedRes.status).toBe(200);

    const linked = sqlite.prepare(
      'SELECT candidate_id FROM scheduled_interviews WHERE id = ?',
    ).get('scheduled-lifecycle-evidence') as { candidate_id: string } | undefined;
    expect(linked?.candidate_id).toEqual(expect.any(String));

    const evidenceRows = sqlite.prepare(
      `SELECT node_type, narrative_text, extracted_properties_json
         FROM candidate_nodes
        WHERE candidate_id = ? AND source_type = 'meeting_session'
        ORDER BY node_type`,
    ).all(linked?.candidate_id) as Array<{
      node_type: string;
      narrative_text: string;
      extracted_properties_json: string | null;
    }>;
    expect(evidenceRows.map((row) => row.node_type).sort()).toEqual([
      'session_participant_join',
      'session_participant_leave',
      'session_recording_start',
      'session_recording_stop',
    ]);
    expect(evidenceRows.map((row) => row.narrative_text).join('\n')).toContain(
      'Participant joined: Guest joined the 95 Until Infinity room',
    );
    expect(evidenceRows.map((row) => row.narrative_text).join('\n')).toContain(
      'Recording started',
    );
    const guestJoin = evidenceRows.find((row) => row.node_type === 'session_participant_join');
    expect(JSON.parse(guestJoin?.extracted_properties_json ?? '{}')).toMatchObject({
      actor: 'guest',
      source: 'meeting_room_lifecycle',
      roomLifecycleEventSource: 'meeting_room_event_route',
      lifecycleEvent: 'JOINED',
      participantRole: 'GUEST',
      roomLifecycleObservedAt: expect.any(String),
      roomLifecycleTimestamp: expect.any(Number),
    });

    const contextRows = sqlite.prepare(
      `SELECT predicate
         FROM context_records
        WHERE record_type = 'meeting_session_event'
        ORDER BY predicate`,
    ).all() as Array<{ predicate: string }>;
    expect(contextRows.map((row) => row.predicate)).toEqual([
      'session_event:participant_join',
      'session_event:participant_leave',
      'session_event:recording_start',
      'session_event:recording_stop',
    ]);

    const contextSources = sqlite.prepare(
      `SELECT csr.exact_text
         FROM context_record_source_refs csr
         INNER JOIN context_records cr ON cr.id = csr.context_record_id
        WHERE cr.record_type = 'meeting_session_event'
          AND csr.source_ref_type = 'meeting_session_event'
        ORDER BY csr.exact_text`,
    ).all() as Array<{ exact_text: string | null }>;
    const sourceEventTexts = contextSources
      .map((source) => JSON.parse(source.exact_text ?? '{}') as { text?: string })
      .map((source) => source.text)
      .sort();
    expect(sourceEventTexts).toEqual([
      'Guest joined the 95 Until Infinity room',
      'Guest left the 95 Until Infinity room',
      'Recording started for the 95 Until Infinity room',
      'Recording stopped for the 95 Until Infinity room',
    ]);
  });

  it('embeds basic auth in returned dev room links without persisting credentials', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    env.ENV = 'dev';
    env.DEV_BASIC_AUTH_USER = 'pipe-user';
    env.DEV_BASIC_AUTH_PASSWORD = 'room pass!';

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Dev Room Person',
        recipientEmail: 'dev-room@example.com',
        title: 'Dev room interview',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { meeting: { id: string } };

    const roomRes = await app.request(`/meetings/${created.meeting.id}/room`, {
      method: 'POST',
    }, env, ctx);
    expect(roomRes.status).toBe(200);
    const body = await roomRes.json() as {
      room: { hostUrl: string; guestUrl: string };
    };

    const hostUrl = new URL(body.room.hostUrl);
    const guestUrl = new URL(body.room.guestUrl);
    expect(hostUrl.username).toBe('pipe-user');
    expect(hostUrl.password).toBe('room%20pass!');
    expect(guestUrl.username).toBe('pipe-user');
    expect(guestUrl.password).toBe('room%20pass!');

    const stored = sqlite.prepare(
      'SELECT meeting_url FROM meetings WHERE id = ?',
    ).get(created.meeting.id) as { meeting_url: string };
    const storedUrl = new URL(stored.meeting_url);
    expect(storedUrl.username).toBe('');
    expect(storedUrl.password).toBe('');
    expect(storedUrl.pathname).toBe(guestUrl.pathname);
  });

  it('prefers video-room-specific basic auth credentials when set', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    env.ENV = 'dev';
    env.DEV_BASIC_AUTH_USER = 'pipe-user';
    env.DEV_BASIC_AUTH_PASSWORD = 'room pass!';
    env.VIDEO_ROOM_DEV_AUTH_USER = 'room-user';
    env.VIDEO_ROOM_DEV_AUTH_PASSWORD = 'secret-room';

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Dev Room Person',
        recipientEmail: 'dev-room@example.com',
        title: 'Dev room interview',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { meeting: { id: string } };

    const roomRes = await app.request(`/meetings/${created.meeting.id}/room`, {
      method: 'POST',
    }, env, ctx);
    expect(roomRes.status).toBe(200);
    const body = await roomRes.json() as {
      room: { hostUrl: string; guestUrl: string };
    };

    const hostUrl = new URL(body.room.hostUrl);
    const guestUrl = new URL(body.room.guestUrl);
    expect(hostUrl.username).toBe('room-user');
    expect(hostUrl.password).toBe('secret-room');
    expect(guestUrl.username).toBe('room-user');
    expect(guestUrl.password).toBe('secret-room');

    delete env.VIDEO_ROOM_DEV_AUTH_USER;
    delete env.VIDEO_ROOM_DEV_AUTH_PASSWORD;
  });

  it('launches a live workspace on the selected GitHub PR head ref', async () => {
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    const initBodies: unknown[] = [];
    const doFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      initBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(null, { status: 204 });
    });
    env.DEV_CONTAINER = {
      idFromName: vi.fn(() => ({}) as DurableObjectId),
      get: vi.fn(() => ({ fetch: doFetch }) as unknown as DurableObjectStub),
    } as unknown as DurableObjectNamespace;
    env.DEV_CONTAINER_DEFAULT_TTL_SECONDS = '3600';
    env.DEV_CONTAINER_MAX_TTL_SECONDS = '7200';
    env.API_BASE_URL = 'http://localhost:8787';
    env.DEVIN_API_KEY = 'test-devin-api-key';
    env.DEVIN_ORG_ID = 'test-devin-org-id';

    const scheduledInterviewId = 'scheduled-interview-workspace-pr';
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, interview_type, github_repo_url, github_pr_number, status, updated_at
       ) VALUES (?, 'DEV_CONTAINER_CHALLENGE', ?, ?, 'INVITED', ?)`,
    ).run(
      scheduledInterviewId,
      'https://github.com/pipe/order-recovery',
      144,
      new Date().toISOString(),
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Workspace Guest',
        recipientEmail: 'workspace-guest@example.com',
        title: 'Workspace PR challenge',
        meetingType: 'INTERVIEW',
        scheduledInterviewId,
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      meeting: { id: string };
      hostToken: string;
    };

    const launchRes = await app.request(`/meeting/${created.hostToken}/workspace/launch`, {
      method: 'POST',
    }, env, ctx);
    expect(launchRes.status).toBe(201);
    const body = await launchRes.json() as {
      workspace: {
        repoUrl: string;
        githubPrNumber: number;
        session: {
          status: string;
          sessionId: string;
          proxyPath: string | null;
        };
      };
    };
    expect(body.workspace.repoUrl).toBe('https://github.com/pipe/order-recovery');
    expect(body.workspace.githubPrNumber).toBe(144);
    expect(body.workspace.session.status).toBe('LAUNCHING');
    expect(body.workspace.session.proxyPath).toBeNull();
    await waitUntilAll();

    expect(sqlite.prepare(
      `SELECT repo_git_url, challenge_branch
         FROM dev_container_sessions
        WHERE session_id = ?`,
    ).get(body.workspace.session.sessionId)).toEqual({
      repo_git_url: 'https://github.com/pipe/order-recovery',
      challenge_branch: 'refs/pull/144/head',
    });
    expect(initBodies).toContainEqual(expect.objectContaining({
      repoGitUrl: 'https://github.com/pipe/order-recovery',
      challengeBranch: 'refs/pull/144/head',
      agentType: 'devin',
      agentApiKey: 'test-devin-api-key',
      agentOrgId: 'test-devin-org-id',
      pipeApiUrl: 'http://localhost:8787',
      roomToken: created.hostToken,
    }));
    expect(JSON.stringify(body)).not.toContain('test-devin-api-key');
  });

  it('marks room workspace launch as ERROR when dev-container init fails before the DO can report status', async () => {
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    const leakedToken = 'cog_testtoken1234567890abcdef';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const doFetch = vi.fn(async () => {
      throw new Error(`network refused DEVIN_API_KEY=${leakedToken} https://example.test/?token=raw-token`);
    });
    env.DEV_CONTAINER = {
      idFromName: vi.fn(() => ({}) as DurableObjectId),
      get: vi.fn(() => ({ fetch: doFetch }) as unknown as DurableObjectStub),
    } as unknown as DurableObjectNamespace;

    const scheduledInterviewId = 'scheduled-interview-workspace-init-failure';
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, interview_type, github_repo_url, github_pr_number, status, updated_at
       ) VALUES (?, 'DEV_CONTAINER_CHALLENGE', ?, ?, 'INVITED', ?)`,
    ).run(
      scheduledInterviewId,
      'https://github.com/pipe/runtime-diagnostics',
      77,
      new Date().toISOString(),
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Workspace Failure Guest',
        recipientEmail: 'workspace-failure@example.com',
        title: 'Workspace init failure',
        meetingType: 'INTERVIEW',
        scheduledInterviewId,
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      hostToken: string;
    };

    const launchRes = await app.request(`/meeting/${created.hostToken}/workspace/launch`, {
      method: 'POST',
    }, env, ctx);
    expect(launchRes.status).toBe(201);
    const body = await launchRes.json() as {
      workspace: {
        session: {
          sessionId: string;
          status: string;
          proxyPath: string | null;
        };
      };
    };
    expect(body.workspace.session.status).toBe('LAUNCHING');
    expect(body.workspace.session.proxyPath).toBeNull();

    await waitUntilAll();
    consoleSpy.mockRestore();

    const row = sqlite.prepare(
      `SELECT status, error_message
         FROM dev_container_sessions
        WHERE session_id = ?`,
    ).get(body.workspace.session.sessionId) as {
      status: string;
      error_message: string | null;
    };

    expect(row.status).toBe('ERROR');
    expect(row.error_message).toContain('Dev-container init request failed');
    expect(row.error_message).toContain('DEVIN_API_KEY=[redacted]');
    expect(row.error_message).toContain('token=[redacted]');
    expect(row.error_message).not.toContain(leakedToken);

    const workspaceRes = await app.request(`/meeting/${created.hostToken}/workspace`, {
      method: 'GET',
    }, env, ctx);
    expect(workspaceRes.status).toBe(200);
    const workspaceBody = await workspaceRes.json() as {
      workspace: {
        session: {
          status: string;
          proxyPath: string | null;
          errorMessage: string | null;
        };
      };
    };
    expect(workspaceBody.workspace.session.status).toBe('ERROR');
    expect(workspaceBody.workspace.session.proxyPath).toBeNull();
    expect(workspaceBody.workspace.session.errorMessage).toBe(row.error_message);
  });

  it('surfaces a matched repo without a PR as a missing reviewable task diagnostic', async () => {
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    const initBodies: unknown[] = [];
    const doFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      initBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(null, { status: 204 });
    });
    env.DEV_CONTAINER = {
      idFromName: vi.fn(() => ({}) as DurableObjectId),
      get: vi.fn(() => ({ fetch: doFetch }) as unknown as DurableObjectStub),
    } as unknown as DurableObjectNamespace;

    sqlite.prepare(
      `INSERT INTO qualified_repos (id, github_url)
       VALUES (?, ?)`,
    ).run(987, 'https://github.com/pipe/source-backed-worker');
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, interview_type, matched_repo_id, status, updated_at
       ) VALUES (?, 'DEV_CONTAINER_CHALLENGE', ?, 'INVITED', ?)`,
    ).run('scheduled-interview-matched-repo-gap', 987, new Date().toISOString());

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Matched Repo Guest',
        recipientEmail: 'matched-repo-guest@example.com',
        title: 'Matched repo challenge gap',
        meetingType: 'INTERVIEW',
        scheduledInterviewId: 'scheduled-interview-matched-repo-gap',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      hostToken: string;
    };

    const launchRes = await app.request(`/meeting/${created.hostToken}/workspace/launch`, {
      method: 'POST',
    }, env, ctx);
    expect(launchRes.status).toBe(201);
    const body = await launchRes.json() as {
      workspace: {
        repoUrl: string;
        githubPrNumber: number | null;
        matchedRepoId: number;
        challenge: {
          status: string;
          kind: string | null;
          source: string;
          message: string | null;
        };
        session: { sessionId: string };
      };
    };

    expect(body.workspace.repoUrl).toBe('https://github.com/pipe/source-backed-worker');
    expect(body.workspace.githubPrNumber).toBeNull();
    expect(body.workspace.matchedRepoId).toBe(987);
    expect(body.workspace.challenge).toMatchObject({
      status: 'missing_reviewable_task',
      kind: 'repo_only',
      source: 'matched_repo_without_pr',
    });
    expect(body.workspace.challenge.message).toContain('no GitHub PR or task was assigned');
    await waitUntilAll();

    expect(sqlite.prepare(
      `SELECT repo_git_url, challenge_branch
         FROM dev_container_sessions
        WHERE session_id = ?`,
    ).get(body.workspace.session.sessionId)).toEqual({
      repo_git_url: 'https://github.com/pipe/source-backed-worker',
      challenge_branch: null,
    });
    expect(initBodies).toContainEqual(expect.objectContaining({
      repoGitUrl: 'https://github.com/pipe/source-backed-worker',
      challengeBranch: null,
      matchedRepoId: 987,
      githubPrNumber: null,
      challengeStatus: 'missing_reviewable_task',
      challengeKind: 'repo_only',
      challengeSource: 'matched_repo_without_pr',
    }));
  });

  it('accepts a source-backed commit submission from the guest assessment room token', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    sqlite.exec(assessmentLayerMigration);
    const now = new Date().toISOString();
    const scheduledInterviewId = 'scheduled-interview-room-commit';
    const assessmentSessionId = 'assessment-session-room-commit';
    const baseCommitSha = 'a'.repeat(40);
    const commitSha = 'b'.repeat(40);

    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, owner_id, recipient_name, recipient_email, interview_type,
         github_repo_url, status, updated_at
       ) VALUES (?, ?, ?, ?, 'OPEN_SOURCE_BUG_FIX', ?, 'INVITED', ?)`,
    ).run(
      scheduledInterviewId,
      'owner-1',
      'Commit Candidate',
      'commit-candidate@example.com',
      'https://github.com/pipe/source-backed-worker',
      now,
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Commit Candidate',
        recipientEmail: 'commit-candidate@example.com',
        title: 'Open-source commit assessment',
        meetingType: 'INTERVIEW',
        scheduledInterviewId,
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      meeting: { id: string; contactId: string };
    };

    const roomRes = await app.request(`/meetings/${created.meeting.id}/room`, {
      method: 'POST',
    }, env, ctx);
    expect(roomRes.status).toBe(200);
    const roomBody = await roomRes.json() as {
      room: { guestUrl: string };
    };
    const guestToken = new URL(roomBody.room.guestUrl).pathname.split('/').filter(Boolean).pop();
    expect(guestToken).toBeTruthy();

    sqlite.prepare(
      `INSERT INTO assessment_sessions (
         id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
         created_by, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'OPEN_SOURCE_BUG_FIX', 'IN_PROGRESS', ?, ?, ?, '{}', ?, ?)`,
    ).run(
      assessmentSessionId,
      `assessment-session:open-source:${scheduledInterviewId}`,
      scheduledInterviewId,
      created.meeting.contactId,
      'owner-1',
      'owner-1',
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_evidence_events (
         id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
         narrative, payload_json, occurred_at, created_at
       ) VALUES (?, ?, ?, 1, 'dev_container_event', 'system', NULL, ?, ?, ?, ?)`,
    ).run(
      'assessment-event-room-challenge',
      `assessment-event:challenge:${scheduledInterviewId}`,
      assessmentSessionId,
      'Assigned open-source challenge packet for source-backed-worker.',
      JSON.stringify({
        repositoryUrl: 'https://github.com/pipe/source-backed-worker',
        baseCommitSha,
        task: 'Fix the source-backed worker retry path.',
      }),
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_event_source_refs (
         id, event_id, source_ref_type, source_ref_id, evidence_role,
         locator_json, exact_text, content_hash, metadata_json, created_at
       ) VALUES (?, ?, 'open_source_challenge_packet', ?, 'assigned_challenge', ?, ?, ?, '{}', ?)`,
    ).run(
      'assessment-source-room-challenge',
      'assessment-event-room-challenge',
      `challenge:${scheduledInterviewId}`,
      JSON.stringify({
        repositoryUrl: 'https://github.com/pipe/source-backed-worker',
        baseCommitSha,
      }),
      `Repo: https://github.com/pipe/source-backed-worker\nBase commit: ${baseCommitSha}\nTask: Fix the source-backed worker retry path.`,
      'challenge-content-hash',
      now,
    );

    const diffText = [
      'diff --git a/src/retry.ts b/src/retry.ts',
      'index 1111111..2222222 100644',
      '--- a/src/retry.ts',
      '+++ b/src/retry.ts',
      '@@ -1,3 +1,4 @@',
      '+export const retryBackoff = "source-backed";',
    ].join('\n');
    const submitRes = await app.request(`/meeting/${guestToken}/assessment/commit-submission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        narrative: 'Candidate submitted a focused retry-path fix with tests passing locally.',
        repositoryUrl: 'https://github.com/pipe/source-backed-worker',
        forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
        branchName: 'pipe-assessment/retry-path',
        baseCommitSha,
        commitSha,
        commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
        upstreamPrConsent: false,
        changedFiles: [{
          path: 'src/retry.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
        }],
        occurredAt: now,
        sourceRefs: [
          {
            sourceRefType: 'git_commit',
            sourceRefId: commitSha,
            evidenceRole: 'submitted_commit',
            locator: {
              repositoryUrl: 'https://github.com/candidate/source-backed-worker',
              commitSha,
            },
            exactText: `commit ${commitSha}\nAuthor: Commit Candidate\n\nFix retry path`,
            contentHash: 'commit-content-hash',
          },
          {
            sourceRefType: 'code_diff',
            sourceRefId: `${baseCommitSha}..${commitSha}`,
            evidenceRole: 'submitted_diff',
            locator: {
              repositoryUrl: 'https://github.com/candidate/source-backed-worker',
              baseCommitSha,
              commitSha,
            },
            exactText: diffText,
            contentHash: 'diff-content-hash',
          },
        ],
      }),
    }, env, ctx);
    expect(submitRes.status).toBe(201);
    const body = await submitRes.json() as {
      submission: {
        accepted: boolean;
        repositoryUrl: string;
        branchName: string;
        commitSha: string;
        commitUrl: string;
      };
      progress: {
        mode: string;
        state: string;
        stage: string;
        nextAction: string;
        hasChallengePacket: boolean;
        hasCommitSubmission: boolean;
        latestEvent: { kind: string; sequence: number };
        commit: { commitSha: string; branchName: string; changedFiles: unknown[] };
      };
    };

    expect(body.submission).toMatchObject({
      accepted: true,
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      branchName: 'pipe-assessment/retry-path',
      commitSha,
      commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
    });
    expect(body.progress).toMatchObject({
      mode: 'OPEN_SOURCE_BUG_FIX',
      state: 'FINAL_SUBMITTED',
      stage: 'READY_FOR_EVALUATION',
      nextAction: 'START_EVALUATION',
      hasChallengePacket: true,
      hasCommitSubmission: true,
      latestEvent: { kind: 'commit_submission', sequence: 2 },
    });
    expect(body.progress.commit).toMatchObject({
      commitSha,
      branchName: 'pipe-assessment/retry-path',
    });
    expect(body.progress.commit.changedFiles).toHaveLength(1);
    const serializedResponse = JSON.stringify(body);
    expect(serializedResponse).not.toContain(assessmentSessionId);
    expect(serializedResponse).not.toContain(`assessment-session:open-source:${scheduledInterviewId}`);
    expect(serializedResponse).not.toContain(created.meeting.contactId);

    const persistedCommit = sqlite.prepare(
      `SELECT e.kind, e.actor_type, e.actor_id, e.narrative, e.payload_json,
              COUNT(sr.id) AS source_ref_count
         FROM assessment_evidence_events e
         JOIN assessment_event_source_refs sr ON sr.event_id = e.id
        WHERE e.session_id = ?
          AND e.kind = 'commit_submission'
        GROUP BY e.id`,
    ).get(assessmentSessionId) as {
      kind: string;
      actor_type: string;
      actor_id: string | null;
      narrative: string;
      payload_json: string;
      source_ref_count: number;
    };
    expect(persistedCommit).toMatchObject({
      kind: 'commit_submission',
      actor_type: 'candidate',
      actor_id: created.meeting.contactId,
      narrative: 'Candidate submitted a focused retry-path fix with tests passing locally.',
      source_ref_count: 2,
    });
    expect(JSON.parse(persistedCommit.payload_json)).toMatchObject({
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
      branchName: 'pipe-assessment/retry-path',
      baseCommitSha,
      commitSha,
      upstreamPrConsent: false,
    });
    expect(sqlite.prepare(
      'SELECT state FROM assessment_sessions WHERE id = ?',
    ).get(assessmentSessionId)).toEqual({ state: 'FINAL_SUBMITTED' });
  });

  it('rejects room commit submissions when no assessment session exists for the scheduled interview', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    sqlite.exec(assessmentLayerMigration);
    const now = new Date().toISOString();
    const scheduledInterviewId = 'scheduled-interview-room-commit-missing-session';
    const baseCommitSha = 'a'.repeat(40);
    const commitSha = 'c'.repeat(40);

    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, owner_id, recipient_name, recipient_email, interview_type,
         github_repo_url, status, updated_at
       ) VALUES (?, ?, ?, ?, 'OPEN_SOURCE_BUG_FIX', ?, 'INVITED', ?)`,
    ).run(
      scheduledInterviewId,
      'owner-1',
      'Missing Session Candidate',
      'missing-session@example.com',
      'https://github.com/pipe/source-backed-worker',
      now,
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Missing Session Candidate',
        recipientEmail: 'missing-session@example.com',
        title: 'Open-source commit missing session',
        meetingType: 'INTERVIEW',
        scheduledInterviewId,
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { meeting: { id: string } };

    const roomRes = await app.request(`/meetings/${created.meeting.id}/room`, {
      method: 'POST',
    }, env, ctx);
    expect(roomRes.status).toBe(200);
    const roomBody = await roomRes.json() as {
      room: { guestUrl: string };
    };
    const guestToken = new URL(roomBody.room.guestUrl).pathname.split('/').filter(Boolean).pop();
    expect(guestToken).toBeTruthy();

    const submitRes = await app.request(`/meeting/${guestToken}/assessment/commit-submission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        narrative: 'Candidate submitted a commit, but no assessment session exists.',
        repositoryUrl: 'https://github.com/pipe/source-backed-worker',
        branchName: 'pipe-assessment/missing-session',
        baseCommitSha,
        commitSha,
        changedFiles: [{
          path: 'src/retry.ts',
          status: 'modified',
        }],
        sourceRefs: [
          {
            sourceRefType: 'git_commit',
            sourceRefId: commitSha,
            exactText: `commit ${commitSha}`,
            contentHash: 'commit-content-hash',
          },
          {
            sourceRefType: 'code_diff',
            sourceRefId: `${baseCommitSha}..${commitSha}`,
            exactText: 'diff --git a/src/retry.ts b/src/retry.ts',
            contentHash: 'diff-content-hash',
          },
        ],
      }),
    }, env, ctx);
    expect(submitRes.status).toBe(409);
    const body = await submitRes.json() as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'This room is not linked to an assessment session. Create the assessment session before accepting commit evidence.',
    });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE kind = 'commit_submission'`,
    ).get()).toEqual({ count: 0 });
  });

  it('keeps standard meeting rooms off the workspace desktop path', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    const ensureBodies: unknown[] = [];
    const doFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/ensure') {
        ensureBodies.push(JSON.parse(await request.text()) as unknown);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    env.VIDEO_ROOM = {
      idFromName: vi.fn(() => ({}) as DurableObjectId),
      get: vi.fn(() => ({ fetch: doFetch }) as unknown as DurableObjectStub),
    } as unknown as DurableObjectNamespace;

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Standard Guest',
        recipientEmail: 'standard-guest@example.com',
        title: 'Standard video call',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { hostToken: string };

    const workspaceRes = await app.request(`/meeting/${created.hostToken}/workspace`, {
      method: 'GET',
    }, env, ctx);
    expect(workspaceRes.status).toBe(200);
    const workspaceBody = await workspaceRes.json() as {
      workspace: { enabled: boolean; canLaunch: boolean };
    };
    expect(workspaceBody.workspace.enabled).toBe(false);
    expect(workspaceBody.workspace.canLaunch).toBe(false);

    const launchRes = await app.request(`/meeting/${created.hostToken}/workspace/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/pipe/standard-call' }),
    }, env, ctx);
    expect(launchRes.status).toBe(403);
    const launchBody = await launchRes.json() as { error: { message: string } };
    expect(launchBody.error.message).toContain('dev-container');

    const wsRes = await app.request(`/meeting/${created.hostToken}/ws`, {
      headers: { Upgrade: 'websocket' },
    }, env, ctx);
    expect(wsRes.status).toBe(200);
    expect(ensureBodies).toContainEqual(expect.objectContaining({
      meetingId: expect.any(String),
      initialSurface: 'standard',
    }));
  });

  it('starts dev-container challenge meeting rooms on the 95 desktop', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();
    const ensureBodies: unknown[] = [];
    const doFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/ensure') {
        ensureBodies.push(JSON.parse(await request.text()) as unknown);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    env.VIDEO_ROOM = {
      idFromName: vi.fn(() => ({}) as DurableObjectId),
      get: vi.fn(() => ({ fetch: doFetch }) as unknown as DurableObjectStub),
    } as unknown as DurableObjectNamespace;

    const scheduledInterviewId = 'scheduled-interview-95-surface';
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (
         id, interview_type, github_repo_url, status, updated_at
       ) VALUES (?, 'DEV_CONTAINER_CHALLENGE', ?, 'INVITED', ?)`,
    ).run(
      scheduledInterviewId,
      'https://github.com/pipe/order-recovery',
      new Date().toISOString(),
    );

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: '95 Workspace Guest',
        recipientEmail: 'workspace-95@example.com',
        title: '95 workspace challenge',
        meetingType: 'INTERVIEW',
        scheduledInterviewId,
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as { hostToken: string };

    const wsRes = await app.request(`/meeting/${created.hostToken}/ws`, {
      headers: { Upgrade: 'websocket' },
    }, env, ctx);
    expect(wsRes.status).toBe(200);
    expect(ensureBodies).toContainEqual(expect.objectContaining({
      meetingId: expect.any(String),
      initialSurface: 'win95',
    }));
  });

  it('routes a recorded meeting transcript into the same graph after roleless candidate convergence', async () => {
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    const personEmail = 'meeting-graph-person@example.com';
    const scheduledInterviewId = 'scheduled-interview-graph-1';
    const rolelessMessage =
      'Roleless follow-up: the same person can discuss lattice replay buffers and join the talent pool.';
    sqlite.prepare(
      `INSERT INTO scheduled_interviews (id, status, updated_at)
       VALUES (?, 'INVITED', ?)`,
    ).run(scheduledInterviewId, new Date().toISOString());

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Meeting Graph Person',
        recipientEmail: personEmail,
        title: 'Living graph technical discussion',
        meetingType: 'INTERVIEW',
        scheduledInterviewId,
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
    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'RECORDING_STARTED' }),
    }, env, ctx);

    expect(sqlite.prepare(
      'SELECT status, completed_at FROM scheduled_interviews WHERE id = ?',
    ).get(scheduledInterviewId)).toEqual({
      status: 'ACTIVE',
      completed_at: null,
    });

    const form = new FormData();
    form.append(
      'recording',
      new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }),
      'recording.webm',
    );
    form.append(
      'transcriptionAudio',
      new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
      'transcription-audio.webm',
    );
    form.append('speakerMetadata', JSON.stringify(defaultRecordingSpeakerMetadataForTest()));
    const recordingRes = await app.request(`/meeting/${created.hostToken}/recording`, {
      method: 'POST',
      body: form,
    }, env, ctx);
    expect(recordingRes.status).toBe(202);
    await waitUntilAll();

    const endedRes = await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'ENDED' }),
    }, env, ctx);
    expect(endedRes.status).toBe(200);

    const endedState = sqlite.prepare(
      `SELECT mr.status AS room_status,
              m.status AS meeting_status,
              m.started_at,
              m.ended_at,
              m.duration_secs
         FROM meeting_rooms mr
         INNER JOIN meetings m ON m.id = mr.meeting_id
        WHERE m.id = ?`,
    ).get(created.meeting.id) as {
      room_status: string;
      meeting_status: string;
      started_at: string | null;
      ended_at: string | null;
      duration_secs: number | null;
    };
    expect(endedState.room_status).toBe('ENDED');
    expect(endedState.meeting_status).toBe('COMPLETED');
    expect(endedState.started_at).toEqual(expect.any(String));
    expect(endedState.ended_at).toEqual(expect.any(String));
    expect(endedState.duration_secs).not.toBeNull();
    const interviewState = sqlite.prepare(
      'SELECT status, completed_at FROM scheduled_interviews WHERE id = ?',
    ).get(scheduledInterviewId) as { status: string; completed_at: string | null };
    expect(interviewState.status).toBe('ACTIVE');
    expect(interviewState.completed_at).toBeNull();

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
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_record_entities
        WHERE entity_type = 'scheduled_interview'
          AND entity_id = ?`,
    ).get(scheduledInterviewId)).toEqual({ count: 2 });

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

  it('uses uploaded speaker metadata instead of implicit channel order for transcript evidence', async () => {
    installDeepgramFetchWithReversedChannels();
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    const personEmail = 'speaker-map-person@example.com';

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Speaker Map Person',
        recipientEmail: personEmail,
        title: 'Speaker map interview',
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

    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'STARTED' }),
    }, env, ctx);
    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'RECORDING_STARTED' }),
    }, env, ctx);

    const speakerMetadata = {
      version: 1,
      transcriptionAudio: {
        channelLayout: 'test-reversed-host-guest',
        channelCount: 2,
        channels: [
          { channel: 0, role: 'guest', source: 'remote' },
          { channel: 1, role: 'host', source: 'local' },
        ],
      },
    };
    const form = new FormData();
    form.append(
      'recording',
      new Blob([new Uint8Array([4, 5, 6])], { type: 'video/webm' }),
      'recording.webm',
    );
    form.append(
      'transcriptionAudio',
      new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
      'transcription-audio.webm',
    );
    form.append('speakerMetadata', JSON.stringify(speakerMetadata));

    const recordingRes = await app.request(`/meeting/${created.hostToken}/recording`, {
      method: 'POST',
      body: form,
    }, env, ctx);
    expect(recordingRes.status).toBe(202);
    await waitUntilAll();

    const meetingRow = sqlite.prepare(
      `SELECT transcript_status, transcript_json, transcript_analysis_json
         FROM meetings
        WHERE id = ?`,
    ).get(created.meeting.id) as {
      transcript_status: string;
      transcript_json: string;
      transcript_analysis_json: string;
    };
    expect(meetingRow.transcript_status).toBe('READY');
    const transcriptSegments = JSON.parse(meetingRow.transcript_json) as Array<{
      stable_segment_id: string;
      role: string | null;
      contact_id: string | null;
      channel: number | null;
      text: string;
      metadata: {
        providerSegmentId?: string | null;
        speakerMetadataRole?: string | null;
        speakerMetadataSource?: string | null;
      } | null;
    }>;
    expect(transcriptSegments).toContainEqual(expect.objectContaining({
      stable_segment_id: 'utterance-0001',
      role: 'host',
      contact_id: null,
      channel: 1,
      text: 'What system did you improve?',
      metadata: expect.objectContaining({
        providerSegmentId: 'dg-host-1',
        speakerMetadataRole: 'host',
        speakerMetadataSource: 'local',
      }),
    }));
    expect(transcriptSegments).toContainEqual(expect.objectContaining({
      stable_segment_id: 'utterance-0002',
      role: 'guest',
      contact_id: created.meeting.contactId,
      channel: 0,
      text: 'I implemented lattice replay buffers for ecommerce order recovery.',
      metadata: expect.objectContaining({
        providerSegmentId: 'dg-guest-1',
        speakerMetadataRole: 'guest',
        speakerMetadataSource: 'remote',
      }),
    }));
    expect(JSON.parse(meetingRow.transcript_analysis_json)).toMatchObject({
      personContextMode: 'attributed',
      speakerMetadata,
      speakerMetadataOrigin: 'recording_upload_form',
    });

    const transcriptArtifactMetadata = sqlite.prepare(
      `SELECT metadata_json
         FROM artifacts
        WHERE artifact_type = 'meeting_transcript'
          AND logical_key = ?`,
    ).get(created.meeting.id) as { metadata_json: string } | undefined;
    expect(JSON.parse(transcriptArtifactMetadata?.metadata_json ?? '{}')).toMatchObject({
      speakerMetadata,
      speakerMetadataOrigin: 'recording_upload_form',
      provider: 'deepgram-multichannel',
    });

    const guestSpan = sqlite.prepare(
      `SELECT ss.metadata_json AS span_metadata_json,
              ssa.metadata_json AS attribution_metadata_json
         FROM source_spans ss
         JOIN source_span_attributions ssa ON ssa.source_span_id = ss.id
        WHERE ss.stable_segment_id = 'utterance-0002'`,
    ).get() as {
      span_metadata_json: string;
      attribution_metadata_json: string;
    } | undefined;
    expect(JSON.parse(guestSpan?.span_metadata_json ?? '{}')).toMatchObject({
      speakerRole: 'guest',
      channel: 0,
      speakerMetadataOrigin: 'recording_upload_form',
      providerSegmentId: 'dg-guest-1',
      speakerMetadataRole: 'guest',
      speakerMetadataSource: 'remote',
    });
    expect(JSON.parse(guestSpan?.attribution_metadata_json ?? '{}')).toMatchObject({
      contactId: created.meeting.contactId,
      speakerRole: 'guest',
      channel: 0,
      speakerMetadataOrigin: 'recording_upload_form',
      providerSegmentId: 'dg-guest-1',
      speakerMetadataRole: 'guest',
      speakerMetadataSource: 'remote',
    });

    const contactGraphRes = await app.request(
      `/contacts/${created.meeting.contactId}/living-context`,
      {},
      env,
      ctx,
    );
    expect(contactGraphRes.status).toBe(200);
    const contactGraph = await contactGraphRes.json() as GraphBody;
    expect(contactGraph.summary).toMatchObject({
      assertionCount: 1,
      signalCount: 1,
    });
    expect(contactGraph.assertions[0]?.sources.map((source) => source.exactText)).toEqual([
      'I implemented lattice replay buffers for ecommerce order recovery.',
    ]);
  });

  it('rejects separate transcription audio without explicit speaker metadata', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Missing Metadata Person',
        recipientEmail: 'missing-speaker-metadata@example.com',
        title: 'Missing speaker metadata interview',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      hostToken: string;
    };

    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'STARTED' }),
    }, env, ctx);
    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'RECORDING_STARTED' }),
    }, env, ctx);

    const form = new FormData();
    form.append(
      'recording',
      new Blob([new Uint8Array([4, 5, 6])], { type: 'video/webm' }),
      'recording.webm',
    );
    form.append(
      'transcriptionAudio',
      new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
      'transcription-audio.webm',
    );

    const recordingRes = await app.request(`/meeting/${created.hostToken}/recording`, {
      method: 'POST',
      body: form,
    }, env, ctx);
    expect(recordingRes.status).toBe(422);
    await expect(recordingRes.json()).resolves.toMatchObject({
      error: {
        message: 'Speaker metadata is required when uploading separate transcription audio.',
      },
    });
  });

  it('uses recording-route transcript evidence to select a source-backed PR challenge', async () => {
    env.AI = createMatchingFakeAi();
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    const personEmail = 'recording-match-person@example.com';
    const transcriptText =
      'I implemented TypeScript lattice replay buffers for ecommerce order recovery and validated Vitest coverage.';
    installDeepgramFetch(transcriptText);

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Recording Match Person',
        recipientEmail: personEmail,
        title: 'Recording-to-match interview',
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

    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'STARTED' }),
    }, env, ctx);
    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'RECORDING_STARTED' }),
    }, env, ctx);

    const form = new FormData();
    form.append(
      'recording',
      new Blob([new Uint8Array([4, 5, 6])], { type: 'video/webm' }),
      'recording.webm',
    );
    form.append(
      'transcriptionAudio',
      new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
      'transcription-audio.webm',
    );
    form.append('speakerMetadata', JSON.stringify(defaultRecordingSpeakerMetadataForTest()));
    const recordingRes = await app.request(`/meeting/${created.hostToken}/recording`, {
      method: 'POST',
      body: form,
    }, env, ctx);
    expect(recordingRes.status).toBe(202);
    await waitUntilAll();

    const recordingKey = `meetings/owner-1/${created.meeting.id}/recording.webm`;
    const transcriptionAudioKey = `meetings/owner-1/${created.meeting.id}/transcription-audio.webm`;
    await expect(env.STORAGE.head(recordingKey)).resolves.toEqual(expect.objectContaining({
      key: recordingKey,
    }));
    await expect(env.STORAGE.head(transcriptionAudioKey)).resolves.toEqual(expect.objectContaining({
      key: transcriptionAudioKey,
    }));
    expect(sqlite.prepare(
      `SELECT transcript_status, recording_r2_key FROM meetings WHERE id = ?`,
    ).get(created.meeting.id)).toEqual({
      transcript_status: 'READY',
      recording_r2_key: recordingKey,
    });
    const transcriptArtifactMetadata = sqlite.prepare(
      `SELECT metadata_json
         FROM artifacts
        WHERE artifact_type = 'meeting_transcript'
          AND logical_key = ?`,
    ).get(created.meeting.id) as { metadata_json: string } | undefined;
    expect(JSON.parse(transcriptArtifactMetadata?.metadata_json ?? '{}')).toEqual(expect.objectContaining({
      recordingKey,
      transcriptionAudioKey,
      provider: 'deepgram-multichannel',
      transcriptStatus: 'READY',
    }));

    const candidateRes = await app.request('/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Recording Match Candidate',
        email: personEmail,
        message: 'Joining the talent pool after the recorded technical discussion.',
        skipEmail: true,
      }),
    }, env, ctx);
    expect(candidateRes.status).toBe(201);
    const candidateBody = await candidateRes.json() as { candidate: { id: string } };

    const packetData = await seedLatticeReviewChallengePacket(env.DB, 144);
    expect(packetData.packet.quality.eligible).toBe(true);

    const match = await matchCandidateToReviewChallenge(env.DB, candidateBody.candidate.id);

    expect(match.status).toBe('MATCHED');
    expect(match.repoId).toBe(144);
    expect(match.prNumber).toBe(packetData.packet.pullRequest.number);
    expect(match.explanation?.selectedPr).toEqual(expect.objectContaining({
      challengeId: packetData.packet.id,
      repoId: '144',
      prNumber: packetData.packet.pullRequest.number,
    }));
    expect(match.explanation?.evidence.some((entry) =>
      entry.candidateSourceRefs.some((source) =>
        source.sourceRefType === 'source_span'
        && source.exactText === transcriptText
      )
      && entry.challengeSourceRefs.some((source) =>
        source.sourceRefType === 'repo_source_span'
        && source.exactText?.includes('lattice replay buffers')
      )
    )).toBe(true);

    const queryRow = sqlite.prepare(
      'SELECT query_json FROM match_runs WHERE id = ?',
    ).get(match.matchRunId) as { query_json: string };
    const query = JSON.parse(queryRow.query_json) as {
      validationAtoms: Array<{
        concepts: string[];
        sourceRefs: Array<{ sourceRefType?: string; exactText?: string }>;
      }>;
    };
    expect(query.validationAtoms.some((atom) =>
      atom.concepts.includes('term:lattice-replay-buffers')
      && atom.sourceRefs.some((source) =>
        source.sourceRefType === 'source_span'
        && source.exactText === transcriptText
      )
    )).toBe(true);

    const matchSourceRefs = sqlite.prepare(
      `SELECT crsr.source_ref_type, crsr.evidence_role, crsr.exact_text
         FROM context_records cr
         JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
        WHERE cr.scope_type = 'match_run'
          AND cr.scope_id = ?
          AND cr.record_type = 'candidate_pr_match_decision'`,
    ).all(match.matchRunId) as Array<{
      source_ref_type: string;
      evidence_role: string;
      exact_text: string | null;
    }>;
    expect(matchSourceRefs).toContainEqual(expect.objectContaining({
      source_ref_type: 'source_span',
      evidence_role: 'selected_candidate_evidence',
      exact_text: transcriptText,
    }));
    expect(matchSourceRefs.some((source) =>
      source.source_ref_type === 'repo_source_span'
      && source.evidence_role === 'selected_repo_evidence'
      && source.exact_text?.includes('lattice replay buffers')
    )).toBe(true);
  });

  it('retries transcript processing from an existing saved room recording', async () => {
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    sqlite.exec(assessmentLayerMigration);
    const personEmail = 'retry-transcript@example.com';

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Retry Transcript Person',
        recipientEmail: personEmail,
        title: 'Retry transcript interview',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      meeting: { id: string; contactId: string };
    };

    const inviteRes = await app.request(`/meetings/${created.meeting.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: personEmail }),
    }, env, ctx);
    expect(inviteRes.status).toBe(200);

    const recordingKey = `meetings/owner-1/${created.meeting.id}/recording.webm`;
    const transcriptionKey = `meetings/owner-1/${created.meeting.id}/transcription-audio.webm`;
    await env.STORAGE.put(recordingKey, new Uint8Array([7, 7, 7]), {
      httpMetadata: { contentType: 'video/webm' },
    });
    await env.STORAGE.put(transcriptionKey, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: 'audio/webm' },
      customMetadata: {
        speakerMetadata: JSON.stringify(defaultRecordingSpeakerMetadataForTest()),
        speakerMetadataVersion: '1',
        speakerChannelLayout: 'host-local-guest-remote-v1',
      },
    });
    sqlite.prepare(
      `UPDATE meetings
          SET status = 'COMPLETED',
              transcript_status = 'PROCESSING',
              recording_r2_key = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(recordingKey, new Date().toISOString(), created.meeting.id);

    const retryRes = await app.request(`/meetings/${created.meeting.id}/transcript/retry`, {
      method: 'POST',
    }, env, ctx);
    expect(retryRes.status).toBe(202);
    await waitUntilAll();

    const meetingRow = sqlite.prepare(
      `SELECT transcript_status, transcript_summary, transcript_error,
              recording_r2_key, transcript_analysis_json
         FROM meetings
        WHERE id = ?`,
    ).get(created.meeting.id) as {
      transcript_status: string;
      transcript_summary: string | null;
      transcript_error: string | null;
      recording_r2_key: string | null;
      transcript_analysis_json: string;
    };
    expect(meetingRow).toMatchObject({
      transcript_status: 'READY',
      transcript_summary: 'Guest described lattice replay buffers for ecommerce order recovery.',
      transcript_error: null,
      recording_r2_key: recordingKey,
    });
    expect(JSON.parse(meetingRow.transcript_analysis_json)).toMatchObject({
      personContextMode: 'attributed',
      speakerMetadataOrigin: 'recording_r2_custom_metadata',
      speakerMetadata: defaultRecordingSpeakerMetadataForTest(),
    });

    const transcriptArtifactMetadata = sqlite.prepare(
      `SELECT metadata_json
         FROM artifacts
        WHERE artifact_type = 'meeting_transcript'
          AND logical_key = ?`,
    ).get(created.meeting.id) as { metadata_json: string } | undefined;
    expect(JSON.parse(transcriptArtifactMetadata?.metadata_json ?? '{}')).toMatchObject({
      provider: 'deepgram-multichannel',
      speakerMetadataOrigin: 'recording_r2_custom_metadata',
      speakerMetadata: defaultRecordingSpeakerMetadataForTest(),
    });

    const assessmentSession = sqlite.prepare(
      `SELECT metadata_json
         FROM assessment_sessions
        WHERE ingestion_key = ?`,
    ).get(`assessment-session:meeting-transcript:${created.meeting.id}`) as {
      metadata_json: string;
    } | undefined;
    expect(JSON.parse(assessmentSession?.metadata_json ?? '{}')).toMatchObject({
      source: 'meeting_transcript_living_context',
      speakerMetadataOrigin: 'recording_r2_custom_metadata',
      speakerMetadata: defaultRecordingSpeakerMetadataForTest(),
    });

    const retryGuestSpan = sqlite.prepare(
      `SELECT ss.metadata_json AS span_metadata_json,
              ssa.metadata_json AS attribution_metadata_json
         FROM source_spans ss
         JOIN source_span_attributions ssa ON ssa.source_span_id = ss.id
        WHERE ss.stable_segment_id = 'utterance-0002'`,
    ).get() as {
      span_metadata_json: string;
      attribution_metadata_json: string;
    } | undefined;
    expect(JSON.parse(retryGuestSpan?.span_metadata_json ?? '{}')).toMatchObject({
      speakerRole: 'guest',
      channel: 1,
      speakerMetadataOrigin: 'recording_r2_custom_metadata',
      speakerMetadataRole: 'guest',
      speakerMetadataSource: 'remote',
    });
    expect(JSON.parse(retryGuestSpan?.attribution_metadata_json ?? '{}')).toMatchObject({
      contactId: created.meeting.contactId,
      speakerRole: 'guest',
      channel: 1,
      speakerMetadataOrigin: 'recording_r2_custom_metadata',
      speakerMetadataRole: 'guest',
      speakerMetadataSource: 'remote',
    });

    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_records
        WHERE record_type IN ('meeting_transcript', 'meeting_transcript_assertion')`,
    ).get()).toEqual({ count: 2 });

    const contactGraphRes = await app.request(
      `/contacts/${created.meeting.contactId}/living-context`,
      {},
      env,
      ctx,
    );
    expect(contactGraphRes.status).toBe(200);
    const contactGraph = await contactGraphRes.json() as GraphBody;
    expect(contactGraph.artifacts.flatMap((artifact) => artifact.sourceSpans)).toContainEqual(
      expect.objectContaining({
        exactText: 'I implemented lattice replay buffers for ecommerce order recovery.',
      }),
    );
    expect(contactGraph.contextRecords).toContainEqual(expect.objectContaining({
      recordType: 'meeting_transcript_assertion',
      predicate: 'implemented a source-described recovery mechanism',
    }));
  });

  it('keeps mixed Whisper fallback transcripts summary-only without person semantic signals', async () => {
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    delete (env as { DEEPGRAM_API_KEY?: string }).DEEPGRAM_API_KEY;

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Mixed Audio Person',
        recipientEmail: 'mixed-audio@example.com',
        title: 'Mixed audio fallback call',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      meeting: { id: string; contactId: string };
      hostToken: string;
    };

    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'STARTED' }),
    }, env, ctx);
    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'RECORDING_STARTED' }),
    }, env, ctx);

    const recordingRes = await app.request(`/meeting/${created.hostToken}/recording`, {
      method: 'POST',
      headers: {
        'Content-Type': 'video/webm',
        'Content-Length': '3',
        'X-Pipe-E2E-Meeting-Analysis': JSON.stringify({
          summary: 'Mixed audio discussed lattice replay buffers.',
          decisions: [],
          actionItems: [],
          topics: ['lattice replay buffers'],
          followUps: [],
          semanticAssertions: [{
            sourceSegmentIds: ['mixed-0001'],
            subjectSegmentId: 'mixed-0001',
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
      },
      body: new Uint8Array([9, 9, 9]),
    }, env, ctx);
    expect(recordingRes.status).toBe(202);
    await waitUntilAll();

    const meetingRow = sqlite.prepare(
      `SELECT transcript_status, transcript_analysis_json, recording_r2_key
         FROM meetings
        WHERE id = ?`,
    ).get(created.meeting.id) as {
      transcript_status: string;
      transcript_analysis_json: string;
      recording_r2_key: string;
    };
    expect(meetingRow.transcript_status).toBe('READY');
    expect(meetingRow.recording_r2_key).toBe(
      `meetings/owner-1/${created.meeting.id}/recording.webm`,
    );
    expect(JSON.parse(meetingRow.transcript_analysis_json)).toMatchObject({
      semanticAssertions: [],
      semanticAssertionsSuppressed: 1,
      semanticAssertionsSuppressedReason: 'mixed_audio_without_speaker_attribution',
      personContextMode: 'summary_only',
      personContextReason: 'mixed_audio_without_speaker_attribution',
    });
    const transcriptRecord = sqlite.prepare(
      `SELECT qualifiers_json
         FROM context_records
        WHERE record_type = 'meeting_transcript'`,
    ).get() as { qualifiers_json: string };
    expect(JSON.parse(transcriptRecord.qualifiers_json)).toMatchObject({
      provider: 'workers-ai-whisper-summary-only',
      personContextMode: 'summary_only',
      personContextReason: 'mixed_audio_without_speaker_attribution',
    });

    const contactGraphRes = await app.request(
      `/contacts/${created.meeting.contactId}/living-context`,
      {},
      env,
      ctx,
    );
    expect(contactGraphRes.status).toBe(200);
    const contactGraph = await contactGraphRes.json() as GraphBody;
    expect(contactGraph.summary).toMatchObject({
      interactionCount: 1,
      artifactCount: 1,
      contextRecordCount: 1,
      assertionCount: 0,
      signalCount: 0,
      sourceSpanCount: 1,
    });
    expect(contactGraph.assertions).toEqual([]);
    expect(contactGraph.signals).toEqual([]);
    expect(contactGraph.contextRecords).toContainEqual(expect.objectContaining({
      recordType: 'meeting_transcript',
      predicate: 'preserves meeting transcript',
    }));
  });

  it('marks transcript processing failed when Whisper transcription times out', async () => {
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    sqlite.exec(assessmentLayerMigration);
    delete (env as { DEEPGRAM_API_KEY?: string }).DEEPGRAM_API_KEY;
    env.AI = {
      run: vi.fn(() => new Promise(() => undefined)),
    } as unknown as Ai;
    vi.useFakeTimers();

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Timeout Person',
        recipientEmail: 'timeout@example.com',
        title: 'Timeout interview',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      meeting: { id: string };
      hostToken: string;
    };

    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'STARTED' }),
    }, env, ctx);
    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'RECORDING_STARTED' }),
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

    const processing = waitUntilAll();
    await vi.advanceTimersByTimeAsync(30_001);
    await processing;

    const meetingRow = sqlite.prepare(
      `SELECT transcript_status, transcript_error, recording_r2_key
         FROM meetings
        WHERE id = ?`,
    ).get(created.meeting.id) as {
      transcript_status: string;
      transcript_error: string | null;
      recording_r2_key: string | null;
    };
    expect(meetingRow.transcript_status).toBe('FAILED');
    expect(meetingRow.transcript_error).toContain('Workers AI transcription timed out');
    expect(meetingRow.recording_r2_key).toBe(
      `meetings/owner-1/${created.meeting.id}/recording.webm`,
    );

    const assessmentSession = sqlite.prepare(
      `SELECT mode, state, interview_id, candidate_id, workspace_id
         FROM assessment_sessions
        WHERE ingestion_key = ?`,
    ).get(`assessment-session:meeting-transcript:${created.meeting.id}`) as {
      mode: string;
      state: string;
      interview_id: string;
      candidate_id: string;
      workspace_id: string;
    };
    expect(assessmentSession).toMatchObject({
      mode: 'STANDARD_VIDEO_INTERVIEW',
      state: 'DIAGNOSTIC',
      interview_id: created.meeting.id,
      workspace_id: 'owner-1',
    });

    const assessmentEvent = sqlite.prepare(
      `SELECT e.kind, e.narrative, r.source_ref_type, r.evidence_role,
              r.exact_text, r.content_hash
         FROM assessment_evidence_events e
         JOIN assessment_event_source_refs r ON r.event_id = e.id
        WHERE e.session_id = (
          SELECT id FROM assessment_sessions WHERE ingestion_key = ?
        )`,
    ).get(`assessment-session:meeting-transcript:${created.meeting.id}`) as {
      kind: string;
      narrative: string;
      source_ref_type: string;
      evidence_role: string;
      exact_text: string;
      content_hash: string;
    };
    expect(assessmentEvent).toMatchObject({
      kind: 'system_diagnostic',
      source_ref_type: 'meeting_transcript_processing',
      evidence_role: 'processing_failure',
    });
    expect(assessmentEvent.narrative).toContain('Workers AI transcription timed out');
    expect(JSON.parse(assessmentEvent.exact_text)).toMatchObject({
      sourceKind: 'meeting_transcript_processing.failure',
      meetingId: created.meeting.id,
      ownerId: 'owner-1',
      recordingKey: `meetings/owner-1/${created.meeting.id}/recording.webm`,
      transcriptionSourceKey: `meetings/owner-1/${created.meeting.id}/recording.webm`,
      errorMessage: expect.stringContaining('Workers AI transcription timed out'),
    });
  });

  it('exposes source-backed interaction context and transcript search for a recorded meeting', async () => {
    const app = mountApp();
    const { ctx, waitUntilAll } = buildCtx();
    const personEmail = 'interaction-context-person@example.com';
    const scheduledInterviewId = 'scheduled-interview-interaction-context';

    sqlite.prepare(
      `INSERT INTO scheduled_interviews (id, status, updated_at)
       VALUES (?, 'INVITED', ?)`,
    ).run(scheduledInterviewId, new Date().toISOString());

    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Interaction Context Person',
        recipientEmail: personEmail,
        title: 'Interaction context discussion',
        meetingType: 'INTERVIEW',
        scheduledInterviewId,
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      meeting: { id: string; contactId: string };
      hostToken: string;
    };

    await app.request(`/meetings/${created.meeting.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: personEmail }),
    }, env, ctx);

    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'STARTED' }),
    }, env, ctx);
    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'RECORDING_STARTED' }),
    }, env, ctx);

    const recordingRes = await app.request(`/meeting/${created.hostToken}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', 'Content-Length': '3' },
      body: new Uint8Array([1, 2, 3]),
    }, env, ctx);
    expect(recordingRes.status).toBe(202);
    await waitUntilAll();

    await app.request(`/meeting/${created.hostToken}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'ENDED' }),
    }, env, ctx);

    // GET /meetings/:id/interaction-context keeps the interaction context
    // separately reviewable from the accumulated person graph.
    const interactionContextRes = await app.request(
      `/meetings/${created.meeting.id}/interaction-context`,
      {},
      env,
      ctx,
    );
    expect(interactionContextRes.status).toBe(200);
    const interactionContext = await interactionContextRes.json() as {
      meetingId: string;
      interactions: Array<{
        interaction: { externalReference: string; interactionType: string };
        assertions: Array<{ predicate: string; sources: Array<{ exactText: string }> }>;
        contextRecords: Array<{ recordType: string }>;
        signalEvidence: Array<{ signalKey: string }>;
        summary: { assertionCount: number; contextRecordCount: number };
      }>;
      sharedArtifacts: Array<{
        artifactType: string;
        sourceSpans: Array<{ exactText: string }>;
      }>;
      contextRecords: Array<{ recordType: string }>;
      summary: {
        interactionCount: number;
        artifactCount: number;
        assertionCount: number;
        contextRecordCount: number;
      };
    };
    expect(interactionContext.meetingId).toBe(created.meeting.id);
    expect(interactionContext.interactions).toHaveLength(1);
    expect(interactionContext.interactions[0]?.interaction.externalReference).toBe(
      created.meeting.id,
    );
    expect(interactionContext.interactions[0]?.summary).toMatchObject({
      assertionCount: 0,
      contextRecordCount: 0,
    });
    expect(interactionContext.interactions[0]?.assertions).toEqual([]);
    expect(interactionContext.interactions[0]?.signalEvidence).toEqual([]);
    expect(interactionContext.sharedArtifacts).toHaveLength(1);
    expect(interactionContext.sharedArtifacts[0]?.artifactType).toBe('meeting_transcript');
    expect(interactionContext.sharedArtifacts[0]?.sourceSpans.map((span) => span.exactText))
      .toEqual([
        'What system did you improve?',
        'I implemented lattice replay buffers for ecommerce order recovery.',
      ]);
    expect(interactionContext.contextRecords.map((record) => record.recordType)).toEqual([
      'meeting_transcript',
    ]);
    expect(interactionContext.summary).toMatchObject({
      interactionCount: 1,
      artifactCount: 1,
      assertionCount: 0,
      contextRecordCount: 1,
    });

    // GET /meetings/:id/transcript/search?q= searches original transcript text
    // and explains each hit with exact spans and citing records.
    const searchRes = await app.request(
      `/meetings/${created.meeting.id}/transcript/search?q=${encodeURIComponent('lattice replay buffers')}`,
      {},
      env,
      ctx,
    );
    expect(searchRes.status).toBe(200);
    const searchResult = await searchRes.json() as {
      meetingId: string;
      query: string;
      hits: Array<{
        exactText: string;
        matchOffset: number;
        matchLength: number;
        stableSegmentId: string;
        citingAssertionIds: string[];
        citingContextRecordIds: string[];
      }>;
    };
    expect(searchResult.meetingId).toBe(created.meeting.id);
    expect(searchResult.query).toBe('lattice replay buffers');
    expect(searchResult.hits).toHaveLength(1);
    const hit = searchResult.hits[0]!;
    expect(hit.exactText).toBe(
      'I implemented lattice replay buffers for ecommerce order recovery.',
    );
    expect(hit.matchLength).toBe('lattice replay buffers'.length);
    expect(hit.stableSegmentId).toBe('utterance-0002');
    expect(hit.citingAssertionIds).toHaveLength(0);
    expect(hit.citingContextRecordIds.length).toBeGreaterThanOrEqual(1);

    // A missing query parameter is rejected.
    const missingQueryRes = await app.request(
      `/meetings/${created.meeting.id}/transcript/search`,
      {},
      env,
      ctx,
    );
    expect(missingQueryRes.status).toBe(422);

    // An unknown meeting returns 404.
    const unknownMeetingRes = await app.request(
      '/meetings/nonexistent-meeting/interaction-context',
      {},
      env,
      ctx,
    );
    expect(unknownMeetingRes.status).toBe(404);
  });

  it('never fabricates /video fallback links for roleless meetings', async () => {
    const app = mountApp();
    const { ctx } = buildCtx();

    // Roleless MVP flow: create a meeting without a pipeline or stage.
    // The person can interview without a role — no pipeline-first UX required.
    const createMeetingRes = await app.request('/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Roleless Link Person',
        recipientEmail: 'roleless-links@example.com',
        title: 'Roleless link interview',
        meetingType: 'INTERVIEW',
      }),
    }, env, ctx);
    expect(createMeetingRes.status).toBe(201);
    const created = await createMeetingRes.json() as {
      meeting: { id: string; contactId: string };
      hostToken: string;
    };
    const opaqueRoomTokenPattern = /^[A-Za-z0-9_-]{43}$/;

    // The host token is an opaque 32-byte base64url room token, never a
    // stageId--candidateId fabrication.
    expect(created.hostToken).toMatch(opaqueRoomTokenPattern);

    // Prepare room links — both host and guest URLs must use /room/:token.
    const roomRes = await app.request(`/meetings/${created.meeting.id}/room`, {
      method: 'POST',
    }, env, ctx);
    expect(roomRes.status).toBe(200);
    const room = await roomRes.json() as {
      room: { hostUrl: string; guestUrl: string; sessionId: string };
    };
    expect(room.room.hostUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);
    expect(room.room.guestUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);
    // Explicitly assert no /video/ fallback is fabricated.
    expect(room.room.hostUrl).not.toContain('/video/');
    expect(room.room.guestUrl).not.toContain('/video/');
    // Session ID is an opaque UUID, not a stageId--candidateId pair.
    expect(room.room.sessionId).not.toContain('--');

    // The persisted meeting_url must be a /room/ URL, never a /video/ URL.
    const storedMeeting = sqlite.prepare(
      'SELECT meeting_url FROM meetings WHERE id = ?',
    ).get(created.meeting.id) as { meeting_url: string };
    expect(storedMeeting.meeting_url).toMatch(/^http:\/\/localhost:5175\/room\/.+/);
    expect(storedMeeting.meeting_url).not.toContain('/video/');

    // Invite a guest — the join link must use /room/:token, not /video/.
    const inviteRes = await app.request(`/meetings/${created.meeting.id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'roleless-links@example.com' }),
    }, env, ctx);
    expect(inviteRes.status).toBe(200);
    const invite = await inviteRes.json() as {
      success: boolean;
      joinUrl: string;
      guestToken: string;
    };
    expect(invite.joinUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);
    expect(invite.joinUrl).not.toContain('/video/');
    expect(invite.guestToken).toMatch(opaqueRoomTokenPattern);

    // Resolve the guest token via the public room endpoint.
    const guestToken = new URL(invite.joinUrl).pathname.split('/').pop()!;
    const guestRoomRes = await app.request(`/meeting/${guestToken}`, {}, env, ctx);
    expect(guestRoomRes.status).toBe(200);
    const guestRoom = await guestRoomRes.json() as {
      room: { id: string; sessionId: string; role: string };
    };
    expect(guestRoom.room.role).toBe('GUEST');
    expect(guestRoom.room.sessionId).not.toContain('--');

    // Reopening the room must still produce /room/ links, never /video/ fallbacks.
    const reopenRes = await app.request(`/meetings/${created.meeting.id}/room`, {
      method: 'POST',
    }, env, ctx);
    expect(reopenRes.status).toBe(200);
    const reopened = await reopenRes.json() as {
      room: { hostUrl: string; guestUrl: string };
    };
    expect(reopened.room.hostUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);
    expect(reopened.room.guestUrl).toMatch(/^http:\/\/localhost:5175\/room\/.+/);
    expect(reopened.room.hostUrl).not.toContain('/video/');
    expect(reopened.room.guestUrl).not.toContain('/video/');

    // Every meeting_url in the database must be a /room/ URL — no /video/ fallbacks.
    const allMeetingUrls = sqlite.prepare(
      'SELECT meeting_url FROM meetings WHERE meeting_url IS NOT NULL',
    ).all() as Array<{ meeting_url: string }>;
    expect(allMeetingUrls.length).toBeGreaterThan(0);
    for (const row of allMeetingUrls) {
      expect(row.meeting_url).toMatch(/\/room\//);
      expect(row.meeting_url).not.toContain('/video/');
    }
  });
});
