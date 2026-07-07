import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { candidateOps } from '../candidates';
import { contacts } from '../contacts';
import type { Env, Variables } from '../../../types';

const livingContextGraphMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptSemanticProjectionsMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

describe('GET / contacts list', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        company TEXT,
        role TEXT,
        phone TEXT,
        linkedin TEXT,
        notes TEXT,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextGraphMigration);

    const insert = sqlite.prepare(`
      INSERT INTO contacts (
        id, owner_id, email, name, company, role, phone, linkedin, notes, type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'lead', ?, ?)
    `);
    const now = '2026-06-22T00:00:00.000Z';
    for (let i = 0; i < 105; i += 1) {
      insert.run(
        `contact-${i}`,
        'test-user',
        `person-${i}@example.com`,
        `Person ${i}`,
        'PIPE Labs',
        'Engineer',
        new Date(Date.parse(now) + i * 1000).toISOString(),
        now,
      );
    }
  });

  afterEach(() => {
    sqlite.close();
  });

  function createApp() {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.env = {
        DB: createMockD1(sqlite),
        CLERK_SECRET_KEY: 'test',
        DEV_AUTH_BYPASS: 'true',
        DEV_BYPASS_USER_ID: 'test-user',
      } as unknown as Env;
      await next();
    });
    app.route('/', contacts);
    return app;
  }

  it('bounds the default list response and returns pagination metadata', async () => {
    const response = await createApp().request('/');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      contacts: Array<{ id: string }>;
      total: number;
      page: number;
      limit: number;
      hasMore: boolean;
    };
    expect(body.contacts).toHaveLength(100);
    expect(body.total).toBe(105);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(100);
    expect(body.hasMore).toBe(true);
    expect(body.contacts[0]?.id).toBe('contact-104');
  });

  it('supports explicit page and limit parameters', async () => {
    const response = await createApp().request('/?page=3&limit=40');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      contacts: Array<{ id: string }>;
      total: number;
      page: number;
      limit: number;
      hasMore: boolean;
    };
    expect(body.contacts).toHaveLength(25);
    expect(body.total).toBe(105);
    expect(body.page).toBe(3);
    expect(body.limit).toBe(40);
    expect(body.hasMore).toBe(false);
  });

  it('includes roleless talent-pool people from the canonical person graph without duplicating contacts', async () => {
    const createdAt = '2026-06-22T00:05:00.000Z';
    sqlite.prepare(
      `INSERT INTO people (
         id, ingestion_key, display_name, primary_email, external_ids_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, '{}', ?, ?)`,
    ).run(
      'person-talent-1',
      'email:talent@example.com',
      'Talent Pool Person',
      'talent@example.com',
      createdAt,
      createdAt,
    );
    sqlite.prepare(
      `INSERT INTO workspace_people (
         id, ingestion_key, workspace_id, person_id, relationship_summary,
         context_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'workspace-person-talent-1',
      'workspace:test-user:person:person-talent-1',
      'test-user',
      'person-talent-1',
      'Joined the roleless Talent Pool.',
      JSON.stringify({
        source: 'roleless_candidate_intake',
        sources: ['roleless_candidate_intake'],
        legacyCandidateIds: ['candidate-talent-1'],
        talentPool: { status: 'active', roleless: true, candidateId: 'candidate-talent-1' },
      }),
      createdAt,
      createdAt,
    );

    const duplicateCreatedAt = '2026-06-22T00:06:00.000Z';
    sqlite.prepare(
      `INSERT INTO people (
         id, ingestion_key, display_name, primary_email, external_ids_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, '{}', ?, ?)`,
    ).run(
      'person-contact-104',
      'email:person-104@example.com',
      'Existing Contact Candidate',
      'person-104@example.com',
      duplicateCreatedAt,
      duplicateCreatedAt,
    );
    sqlite.prepare(
      `INSERT INTO workspace_people (
         id, ingestion_key, workspace_id, person_id, context_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'workspace-person-contact-104',
      'workspace:test-user:person:person-contact-104',
      'test-user',
      'person-contact-104',
      JSON.stringify({
        contactId: 'contact-104',
        legacyCandidateIds: ['candidate-contact-104'],
        talentPool: { status: 'active', roleless: true, candidateId: 'candidate-contact-104' },
      }),
      duplicateCreatedAt,
      duplicateCreatedAt,
    );

    const app = createApp();
    const response = await app.request('/?limit=110');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      contacts: Array<{ id: string; email: string; type: string; notes: string | null }>;
      total: number;
      hasMore: boolean;
    };
    expect(body.total).toBe(106);
    expect(body.hasMore).toBe(false);
    expect(body.contacts[0]).toMatchObject({
      id: 'person-talent-1',
      email: 'talent@example.com',
      type: 'candidate',
      notes: 'Joined the roleless Talent Pool.',
    });
    expect(body.contacts.filter((contact) => contact.email === 'person-104@example.com')).toHaveLength(1);
    expect(body.contacts.find((contact) => contact.id === 'contact-104')).toMatchObject({
      type: 'candidate',
    });

    const profileResponse = await app.request('/person-talent-1');
    expect(profileResponse.status).toBe(200);
    const profileBody = await profileResponse.json() as {
      contact: { id: string; email: string; name: string | null; type: string; notes: string | null };
    };
    expect(profileBody.contact).toMatchObject({
      id: 'person-talent-1',
      email: 'talent@example.com',
      name: 'Talent Pool Person',
      type: 'candidate',
      notes: 'Joined the roleless Talent Pool.',
    });
  });
});

describe('GET /:id/living-context', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        company TEXT,
        role TEXT,
        phone TEXT,
        linkedin TEXT,
        notes TEXT,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO contacts (
        id, owner_id, email, name, company, role, phone, linkedin, notes, type, created_at, updated_at
      ) VALUES (
        'contact-1', 'test-user', 'ada@example.com', 'Ada Contact',
        'PIPE Labs', 'Systems Lead', NULL, NULL, NULL, 'candidate',
        '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
      );
    `);
    sqlite.exec(livingContextGraphMigration);
    sqlite.exec(transcriptSemanticProjectionsMigration);
    sqlite.exec(contextRecordsMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  function createApp() {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.env = {
        DB: createMockD1(sqlite),
        CLERK_SECRET_KEY: 'test',
        DEV_AUTH_BYPASS: 'true',
        DEV_BYPASS_USER_ID: 'test-user',
      } as unknown as Env;
      await next();
    });
    app.route('/', contacts);
    return app;
  }

  it('promotes a legacy contact into a source-ready living context graph before reading', async () => {
    const response = await createApp().request('/contact-1/living-context');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      person: {
        personId: string;
        workspacePersonId: string;
        displayName: string | null;
        primaryEmail: string | null;
        roles: Array<{ roleType: string; label: string | null }>;
      } | null;
      summary: {
        interactionCount: number;
        artifactCount: number;
        contextRecordCount: number;
        assertionCount: number;
        signalCount: number;
        sourceSpanCount: number;
      };
    };

    expect(body.person).toMatchObject({
      displayName: 'Ada Contact',
      primaryEmail: 'ada@example.com',
      roles: [expect.objectContaining({
        roleType: 'candidate',
        label: 'Systems Lead',
      })],
    });
    expect(body.summary).toEqual({
      interactionCount: 0,
      artifactCount: 0,
      contextRecordCount: 0,
      assertionCount: 0,
      signalCount: 0,
      sourceSpanCount: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({ count: 1 });
    expect(JSON.parse(sqlite.prepare(
      `SELECT context_json FROM workspace_people LIMIT 1`,
    ).get()!.context_json as string)).toMatchObject({
      contactId: 'contact-1',
      company: 'PIPE Labs',
      role: 'Systems Lead',
      source: 'legacy_contact',
      sources: ['legacy_contact'],
    });
  });

  it('loads a person profile and graph by canonical person id', async () => {
    const app = createApp();
    const contactGraphResponse = await app.request('/contact-1/living-context');
    expect(contactGraphResponse.status).toBe(200);
    const contactGraph = await contactGraphResponse.json() as {
      person: { personId: string; primaryEmail: string | null } | null;
    };
    const personId = contactGraph.person?.personId;
    expect(personId).toBeTruthy();

    const profileResponse = await app.request(`/${personId}`);
    expect(profileResponse.status).toBe(200);
    const profileBody = await profileResponse.json() as {
      contact: {
        id: string;
        email: string;
        name: string | null;
        company: string | null;
        role: string | null;
        type: string;
      };
    };
    expect(profileBody.contact).toMatchObject({
      id: personId,
      email: 'ada@example.com',
      name: 'Ada Contact',
      company: 'PIPE Labs',
      role: 'Systems Lead',
      type: 'person',
    });

    const graphResponse = await app.request(`/${personId}/living-context`);
    expect(graphResponse.status).toBe(200);
    const graphBody = await graphResponse.json() as {
      person: { personId: string; primaryEmail: string | null } | null;
    };
    expect(graphBody.person).toMatchObject({
      personId,
      primaryEmail: 'ada@example.com',
    });
  });

  it('returns a lightweight person summary without loading the full graph arrays', async () => {
    const app = createApp();

    const response = await app.request('/contact-1/living-context/summary');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      person: {
        personId: string;
        workspacePersonId: string;
        displayName: string | null;
        primaryEmail: string | null;
        roles: Array<{ roleType: string; label: string | null }>;
      } | null;
      summary: {
        interactionCount: number;
        artifactCount: number;
        contextRecordCount: number;
        assertionCount: number;
        signalCount: number;
        sourceSpanCount: number;
      };
      interactions: unknown[];
      artifacts: unknown[];
      contextRecords: unknown[];
      assertions: unknown[];
      signals: unknown[];
      relationships: unknown[];
    };

    expect(body.person).toMatchObject({
      displayName: 'Ada Contact',
      primaryEmail: 'ada@example.com',
      roles: [expect.objectContaining({
        roleType: 'candidate',
        label: 'Systems Lead',
      })],
    });
    expect(body.summary).toEqual({
      interactionCount: 0,
      artifactCount: 0,
      contextRecordCount: 0,
      assertionCount: 0,
      signalCount: 0,
      sourceSpanCount: 0,
    });
    expect(body.interactions).toEqual([]);
    expect(body.artifacts).toEqual([]);
    expect(body.contextRecords).toEqual([]);
    expect(body.assertions).toEqual([]);
    expect(body.signals).toEqual([]);
    expect(body.relationships).toEqual([]);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
  });

  it('keeps a contact living-context read attached after a same-email roleless candidate is created', async () => {
    sqlite.exec(`
      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL
      );
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT NOT NULL,
        invite_token TEXT NOT NULL,
        status TEXT NOT NULL,
        current_stage_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE candidate_ingestion (
        candidate_id TEXT PRIMARY KEY,
        status TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE scheduled_interviews (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        pipeline_id TEXT,
        stage_id TEXT,
        owner_id TEXT,
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

    const app = createApp();
    app.route('/candidates', candidateOps);

    const firstContactRead = await app.request('/contact-1/living-context');
    expect(firstContactRead.status).toBe(200);
    const firstContactGraph = await firstContactRead.json() as {
      person: { personId: string; workspacePersonId: string; primaryEmail: string | null } | null;
    };
    expect(firstContactGraph.person).toMatchObject({
      primaryEmail: 'ada@example.com',
    });

    const createdCandidate = await app.request('/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ada Candidate',
        email: 'ada@example.com',
        interviewType: 'SCREENING',
        message: 'Roleless smoke evidence: React, D1, and source-backed context debugging.',
        skipEmail: true,
      }),
    });
    expect(createdCandidate.status).toBe(201);
    const createdCandidateBody = await createdCandidate.json() as {
      candidate: { id: string };
    };

    const candidateGraphRead = await app.request(
      `/candidates/${createdCandidateBody.candidate.id}/living-context`,
    );
    expect(candidateGraphRead.status).toBe(200);
    const candidateGraph = await candidateGraphRead.json() as {
      livingContext: {
        person: {
          personId: string;
          workspacePersonId: string;
          applicationId: string | null;
          primaryEmail: string | null;
        };
      };
    };
    expect(candidateGraph.livingContext.person).toMatchObject({
      personId: firstContactGraph.person?.personId,
      workspacePersonId: firstContactGraph.person?.workspacePersonId,
      applicationId: null,
      primaryEmail: 'ada@example.com',
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM applications').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM person_roles').get()).toEqual({ count: 1 });

    const candidateSearch = await app.request(
      `/candidates/${createdCandidateBody.candidate.id}/living-context/search?q=Roleless`,
    );
    expect(candidateSearch.status).toBe(200);
    const searchBody = await candidateSearch.json() as {
      personId: string;
      hits: Array<{ exactText: string; sourceSpanId: string }>;
    };
    expect(searchBody.personId).toBe(firstContactGraph.person?.workspacePersonId);
    expect(searchBody.hits.some((hit) => hit.exactText.includes('Roleless smoke evidence'))).toBe(true);

    const evidenceDepth = await app.request(
      `/candidates/${createdCandidateBody.candidate.id}/living-context/evidence-depth`,
    );
    expect(evidenceDepth.status).toBe(200);
    const evidenceDepthBody = await evidenceDepth.json() as {
      workspacePersonId: string | null;
      totalInteractions: number;
      totalSourceSpans: number;
      totalContextRecords: number;
    };
    expect(evidenceDepthBody).toMatchObject({
      workspacePersonId: firstContactGraph.person?.workspacePersonId,
      totalInteractions: 1,
      totalSourceSpans: 1,
      totalContextRecords: 1,
    });

    const personSearch = await app.request(
      `/${firstContactGraph.person?.personId}/living-context/search?q=Roleless`,
    );
    expect(personSearch.status).toBe(200);
    const personSearchBody = await personSearch.json() as {
      personId: string;
      hits: Array<{ exactText: string; sourceSpanId: string }>;
    };
    expect(personSearchBody.personId).toBe(firstContactGraph.person?.workspacePersonId);
    expect(personSearchBody.hits.some((hit) => hit.exactText.includes('Roleless smoke evidence'))).toBe(true);

    const personTimeline = await app.request(
      `/${firstContactGraph.person?.personId}/living-context/timeline`,
    );
    expect(personTimeline.status).toBe(200);
    const personTimelineBody = await personTimeline.json() as {
      workspacePersonId: string;
      totalEntries: number;
      entries: Array<{ kind: string; sourceType?: string; description?: string }>;
    };
    expect(personTimelineBody.workspacePersonId).toBe(firstContactGraph.person?.workspacePersonId);
    expect(personTimelineBody.totalEntries).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(personTimelineBody.entries)).toContain('Candidate submitted Talent Pool profile evidence.');

    const personEvidenceDepth = await app.request(
      `/${firstContactGraph.person?.personId}/living-context/evidence-depth`,
    );
    expect(personEvidenceDepth.status).toBe(200);
    const personEvidenceDepthBody = await personEvidenceDepth.json() as {
      workspacePersonId: string | null;
      totalInteractions: number;
      totalSourceSpans: number;
      totalContextRecords: number;
    };
    expect(personEvidenceDepthBody).toMatchObject({
      workspacePersonId: firstContactGraph.person?.workspacePersonId,
      totalInteractions: 1,
      totalSourceSpans: 1,
      totalContextRecords: 1,
    });

    const secondContactRead = await app.request('/contact-1/living-context');
    expect(secondContactRead.status).toBe(200);
    const secondContactGraph = await secondContactRead.json() as {
      person: { personId: string; workspacePersonId: string; primaryEmail: string | null } | null;
      artifacts: Array<{ sourceSpans: Array<{ exactText: string }> }>;
    };
    expect(secondContactGraph.person).toMatchObject({
      personId: firstContactGraph.person?.personId,
      workspacePersonId: firstContactGraph.person?.workspacePersonId,
      primaryEmail: 'ada@example.com',
    });
    expect(
      secondContactGraph.artifacts
        .flatMap((artifact) => artifact.sourceSpans)
        .some((span) => span.exactText.includes('Roleless smoke evidence')),
    ).toBe(true);
  });
});
