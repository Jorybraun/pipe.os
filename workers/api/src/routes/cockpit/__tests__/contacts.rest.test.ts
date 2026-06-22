import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
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
});
