import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { roleContexts } from '../roleContexts';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import type { Env, Variables } from '../../../types';

vi.mock('../../../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'test-user');
    await next();
  },
}));

vi.mock('../../../lib/agents/question/generator', () => ({
  generateQuestion: vi.fn(),
  generateQuestionBatch: vi.fn(),
  generateQuestionStream: vi.fn(),
}));

vi.mock('../../../lib/agents/question/eval', () => ({
  evaluateQuestion: vi.fn(),
}));

vi.mock('../../../lib/llm/createProvider', () => ({
  createRoleAgentProvider: vi.fn(() => ({ name: 'mock' })),
  createRoleAgentFallbackProvider: vi.fn(() => null),
  createRoleAgentSynthesisProvider: vi.fn(() => ({ name: 'mock' })),
  createRoleAgentSynthesisFallbackProvider: vi.fn(() => null),
}));

const roleContextsMigration = readFileSync(
  new URL('../../../../migrations/0011_role_contexts.sql', import.meta.url),
  'utf8',
);
const roleContextParticipantsMigration = readFileSync(
  new URL('../../../../migrations/0012_role_context_participants.sql', import.meta.url),
  'utf8',
);
const personaJdMigration = readFileSync(
  new URL('../../../../migrations/0013_persona_jd.sql', import.meta.url),
  'utf8',
);
const participantDomainStateMigration = readFileSync(
  new URL('../../../../migrations/0073_participant_domain_state.sql', import.meta.url),
  'utf8',
);
const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

function buildApp(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/api/v1/role-contexts', roleContexts);
  return app;
}

describe('GET /api/v1/role-contexts/:id/living-context', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL
      );
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY
      );
    `);
    sqlite.exec(roleContextsMigration);
    sqlite.exec(roleContextParticipantsMigration);
    sqlite.exec(personaJdMigration);
    sqlite.exec(participantDomainStateMigration);
    sqlite.exec(`
      ALTER TABLE role_contexts ADD COLUMN rcd_version TEXT;
      ALTER TABLE role_contexts ADD COLUMN rcd_json TEXT;
      ALTER TABLE role_contexts ADD COLUMN validation_metadata TEXT;
      ALTER TABLE role_contexts ADD COLUMN non_negotiable_skills_json TEXT;
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns source-backed role context records, concepts, entities, and exact JD text', async () => {
    const app = buildApp();
    const jobDescriptionMd = [
      '# Staff Platform Engineer',
      '',
      'We need Kafka experience for order processing workflows.',
      'The work includes source-backed observability and API reliability.',
    ].join('\n');

    const createResponse = await app.request(
      '/api/v1/role-contexts/simple-job-description',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer fake-token',
        },
        body: JSON.stringify({
          title: 'Staff Platform Engineer',
          jobDescriptionMd,
          selectedTerms: ['Kafka', 'order processing'],
        }),
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json<{
      id: string;
      selectedTerms: string[];
    }>();
    expect(created.selectedTerms).toEqual(['Kafka', 'order processing']);

    const graphResponse = await app.request(
      `/api/v1/role-contexts/${created.id}/living-context`,
      {
        headers: { Authorization: 'Bearer fake-token' },
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(graphResponse.status).toBe(200);
    const body = await graphResponse.json<{
      livingContext: {
        scope: {
          scopeType: string;
          scopeId: string;
          label: string | null;
          ownerId: string | null;
          metadata: Record<string, unknown>;
        };
        summary: {
          artifactCount: number;
          contextRecordCount: number;
          sourceSpanCount: number;
        };
        artifacts: Array<{
          artifactType: string;
          logicalKey: string | null;
          sourceSpans: Array<{ exactText: string; lineStart: number | null; lineEnd: number | null }>;
        }>;
        contextRecords: Array<{
          scopeType: string;
          scopeId: string;
          recordType: string;
          predicate: string | null;
          narrative: string;
          qualifiers: Record<string, unknown>;
          sources: Array<{ exactText?: string | null; sourceRefType: string; evidenceRole: string | null }>;
          entities: Array<{
            entityType: string;
            entityId: string | null;
            relationship: string;
            value: unknown;
          }>;
          concepts: Array<{
            canonicalKey: string;
            label: string;
            relationship: string;
            weight: number;
          }>;
        }>;
      };
    }>();

    expect(body.livingContext.scope).toMatchObject({
      scopeType: 'role_context',
      scopeId: created.id,
      label: 'Staff Platform Engineer',
      ownerId: 'test-user',
      metadata: {
        baseline: {
          title: 'Staff Platform Engineer',
          source: 'simple_job_description',
        },
        hasJobDescription: true,
      },
    });
    expect(body.livingContext.summary).toMatchObject({
      artifactCount: 1,
      contextRecordCount: 1,
      sourceSpanCount: 1,
    });
    expect(body.livingContext.artifacts[0]).toMatchObject({
      artifactType: 'job_description',
      logicalKey: `role-context/${created.id}/job-description.md`,
    });
    expect(body.livingContext.artifacts[0]?.sourceSpans).toEqual([
      expect.objectContaining({
        exactText: jobDescriptionMd,
        lineStart: 1,
        lineEnd: 4,
      }),
    ]);

    const record = body.livingContext.contextRecords[0];
    expect(record).toMatchObject({
      scopeType: 'role_context',
      scopeId: created.id,
      recordType: 'simple_job_description',
      predicate: 'defines role source text',
      narrative: 'Simple job description source for Staff Platform Engineer.',
      qualifiers: {
        roleContextId: created.id,
        selectedTerms: ['Kafka', 'order processing'],
      },
    });
    expect(record?.sources).toEqual([
      expect.objectContaining({
        sourceRefType: 'source_span',
        evidenceRole: 'source',
        exactText: jobDescriptionMd,
      }),
    ]);
    expect(record?.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'role_context',
        entityId: created.id,
        relationship: 'scope',
      }),
      expect.objectContaining({
        entityType: 'job_description',
        relationship: 'source_artifact',
      }),
      expect.objectContaining({
        entityType: 'selected_term',
        relationship: 'literal_term',
        value: { surface: 'Kafka' },
      }),
      expect.objectContaining({
        entityType: 'selected_term',
        relationship: 'literal_term',
        value: { surface: 'order processing' },
      }),
    ]));
    expect(record?.concepts.map((concept) => ({
      canonicalKey: concept.canonicalKey,
      label: concept.label,
      relationship: concept.relationship,
      weight: concept.weight,
    }))).toEqual(expect.arrayContaining([
      {
        canonicalKey: 'term:kafka',
        label: 'Kafka',
        relationship: 'source_term',
        weight: 1,
      },
      {
        canonicalKey: 'term:order-processing',
        label: 'order processing',
        relationship: 'source_term',
        weight: 1,
      },
    ]));
  });

  it('projects role conversation exchanges into source-backed role context records', async () => {
    const app = buildApp();
    const timestamp = '2026-06-24T04:30:00.000Z';
    const exchanges = [
      {
        questionId: 'q-calibration',
        acknowledgment: 'Let us calibrate.',
        question: "What's your relationship to this role?",
        input: { type: 'radio', options: ['Hiring Manager'] },
        answer: 'Hiring Manager',
      },
      {
        questionId: 'q-role-1',
        acknowledgment: 'Got it.',
        question: 'What kind of work will this person own?',
        input: { type: 'textarea' },
        answer: 'They will own Temporal Shard Knitting for workflow recovery and reduce callback drift.',
      },
    ];

    sqlite.prepare(
      `INSERT INTO role_contexts (
         id, pipeline_id, owner_id, baseline, knowledge_state, exchanges,
         question_budget, questions_asked, status, job_description_md,
         rcd_version, rcd_json, validation_metadata, non_negotiable_skills_json,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, '{}', '[]', 4, 2, 'INTERVIEWING', NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    ).run(
      'role-conversation-1',
      null,
      'test-user',
      JSON.stringify({ title: 'Workflow Platform Lead' }),
      timestamp,
      timestamp,
    );
    sqlite.prepare(
      `INSERT INTO role_context_participants (
         id, role_context_id, name, email, participant_role, is_creator,
         exchanges, questions_asked, question_budget, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, 2, 4, 'INTERVIEWING', ?, ?)`,
    ).run(
      'participant-1',
      'role-conversation-1',
      'Hiring Lead',
      'lead@example.com',
      'HIRING_MANAGER',
      JSON.stringify(exchanges),
      timestamp,
      timestamp,
    );

    const graphResponse = await app.request(
      '/api/v1/role-contexts/role-conversation-1/living-context',
      {
        headers: { Authorization: 'Bearer fake-token' },
      },
      { DB: db, CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(graphResponse.status).toBe(200);
    const body = await graphResponse.json<{
      livingContext: {
        summary: {
          artifactCount: number;
          contextRecordCount: number;
          sourceSpanCount: number;
        };
        artifacts: Array<{
          artifactType: string;
          logicalKey: string | null;
          sourceSpans: Array<{
            stableSegmentId: string | null;
            exactText: string;
            lineStart: number | null;
            lineEnd: number | null;
            metadata: Record<string, unknown>;
          }>;
        }>;
        contextRecords: Array<{
          recordType: string;
          predicate: string | null;
          narrative: string;
          qualifiers: Record<string, unknown>;
          sources: Array<{
            exactText?: string | null;
            sourceRefType: string;
            evidenceRole: string | null;
            stableSegmentId?: string | null;
          }>;
          entities: Array<{
            entityType: string;
            entityId: string | null;
            relationship: string;
            value: unknown;
          }>;
          concepts: Array<{
            canonicalKey: string;
            label: string;
            relationship: string;
          }>;
        }>;
      };
    }>();

    expect(body.livingContext.summary).toMatchObject({
      artifactCount: 1,
      contextRecordCount: 2,
      sourceSpanCount: 4,
    });
    expect(body.livingContext.artifacts[0]).toMatchObject({
      artifactType: 'role_conversation_transcript',
      logicalKey: 'role-context/role-conversation-1/participants/participant-1/conversation.md',
    });

    const sourceTexts = body.livingContext.artifacts[0]?.sourceSpans.map((span) => span.exactText) ?? [];
    expect(sourceTexts).toEqual(expect.arrayContaining([
      "What's your relationship to this role?",
      'Hiring Manager',
      'What kind of work will this person own?',
      'They will own Temporal Shard Knitting for workflow recovery and reduce callback drift.',
    ]));

    const roleAnswerRecord = body.livingContext.contextRecords.find((record) =>
      record.qualifiers.questionId === 'q-role-1',
    );
    expect(roleAnswerRecord).toMatchObject({
      recordType: 'role_conversation_exchange',
      predicate: 'captures stakeholder role context',
      narrative: 'Role stakeholder answered "What kind of work will this person own?"',
      qualifiers: {
        roleContextId: 'role-conversation-1',
        participantId: 'participant-1',
        participantRole: 'HIRING_MANAGER',
        questionId: 'q-role-1',
        inputType: 'textarea',
        source: 'role_conversation',
      },
    });
    expect(roleAnswerRecord?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRefType: 'source_span',
        evidenceRole: 'question',
        exactText: 'What kind of work will this person own?',
      }),
      expect.objectContaining({
        sourceRefType: 'source_span',
        evidenceRole: 'answer',
        exactText: 'They will own Temporal Shard Knitting for workflow recovery and reduce callback drift.',
      }),
    ]));
    expect(roleAnswerRecord?.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'role_context',
        entityId: 'role-conversation-1',
        relationship: 'scope',
      }),
      expect.objectContaining({
        entityType: 'role_context_participant',
        entityId: 'participant-1',
        relationship: 'stakeholder',
      }),
      expect.objectContaining({
        entityType: 'role_conversation_exchange',
        relationship: 'exchange',
        value: { questionId: 'q-role-1', exchangeIndex: 1 },
      }),
    ]));
    expect(roleAnswerRecord?.concepts.map((concept) => ({
      canonicalKey: concept.canonicalKey,
      label: concept.label,
      relationship: concept.relationship,
    }))).toEqual(expect.arrayContaining([
      {
        canonicalKey: 'term:temporal-shard-knitting',
        label: 'Temporal Shard Knitting',
        relationship: 'mentioned_in_role_conversation',
      },
    ]));
  });
});
