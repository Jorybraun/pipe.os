import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CandidateNode } from '../../../types';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  candidateNodeTerms,
  ensureCandidateLivingContext,
  ensureContactLivingContext,
  mirrorCandidateNodeToLivingContext,
} from '../compatibility';
import { loadCandidateLivingContext, loadContactLivingContext } from '../readModel';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

function node(properties: Record<string, unknown>): CandidateNode {
  return {
    id: 'node-1',
    candidate_id: 'candidate-1',
    node_type: 'PreviouslyUnseenClassification',
    narrative_text: 'Source-backed narrative',
    extracted_properties_json: JSON.stringify(properties),
    embedding_json: null,
    source_type: 'previously_unseen_source',
    source_reference: 'source-1',
    captured_at: 1,
    confidence: 0.8,
    supersedes: null,
    superseded_at: null,
    decomposition_version: 'test',
    created_at: 1,
    updated_at: 1,
  };
}

describe('candidateNodeTerms', () => {
  it('does not turn arbitrary property values into semantic concepts', () => {
    const terms = candidateNodeTerms(node({
      date_range: '2013-2014',
      team_size: '20+',
      administrative_label: 'Region 7',
    }));

    expect(terms).toEqual([]);
  });

  it('promotes only extractor-explicit open terms to signal evidence', () => {
    const terms = candidateNodeTerms(node({
      date_range: '2013-2014',
      semantic_terms: [{
        surface: 'Temporal workflow compensation',
        canonical_key: 'term:temporal-workflow-compensation',
        evidence_level: 'demonstrated',
      }],
    }));

    expect(terms).toEqual([expect.objectContaining({
      canonicalKey: 'term:temporal-workflow-compensation',
      signalEligible: true,
      evidenceLevel: 'demonstrated',
    })]);
  });

  it('keeps an unseen invalid-evidence term searchable without fabricating a signal level', () => {
    const terms = candidateNodeTerms(node({
      semantic_terms: [{
        surface: 'Novel Source Surface',
        canonical_key: 'technology:kafka',
        evidence_level: 'not-a-protocol-level',
      }],
    }));
    expect(terms).toEqual([{
      surface: 'Novel Source Surface',
      canonicalKey: 'technology:kafka',
      signalEligible: false,
      evidenceLevel: null,
    }]);
  });
});

describe('legacy contact/candidate identity compatibility', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pipeline_id TEXT,
        name TEXT,
        email TEXT,
        status TEXT NOT NULL
      );
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        phone TEXT,
        company TEXT,
        role TEXT,
        type TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordMigration);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('resolves a contact and roleless talent-pool candidate with the same normalized email to one workspace person read model', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'contact-1',
      'workspace-1',
      'Ada Contact',
      '  ADA@example.com ',
      '+1 555 0100',
      'Analytical Engines',
      'Advisor',
      'advisor',
    );
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-1',
      'workspace-1',
      null,
      'Ada Candidate',
      'ada@example.com',
      'talent_pool',
    );

    const contactIdentity = await ensureContactLivingContext(db, 'contact-1');
    const candidateIdentity = await ensureCandidateLivingContext(db, 'candidate-1');

    expect(contactIdentity).not.toBeNull();
    expect(candidateIdentity).not.toBeNull();
    expect(candidateIdentity?.personId).toBe(contactIdentity?.personId);
    expect(candidateIdentity?.workspacePersonId).toBe(contactIdentity?.workspacePersonId);

    const candidateGraph = await loadCandidateLivingContext(db, 'candidate-1');
    const contactGraph = await loadContactLivingContext(db, 'contact-1');
    expect(candidateGraph?.person.personId).toBe(contactGraph?.person.personId);
    expect(candidateGraph?.person.workspacePersonId).toBe(contactGraph?.person.workspacePersonId);
    expect(candidateGraph?.person.primaryEmail).toBe('ada@example.com');
    expect(candidateGraph?.person.pipelineId).toBeNull();
    expect(candidateGraph?.person.applicationStatus).toBe('talent_pool');
    expect(candidateGraph?.person.roles.map((role) => role.roleType).sort()).toEqual([
      'advisor',
      'candidate',
    ]);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM applications').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare(
      `SELECT pipeline_id FROM applications WHERE legacy_candidate_id = ?`,
    ).get('candidate-1')).toEqual({ pipeline_id: null });
    expect(JSON.parse(sqlite.prepare(
      `SELECT external_ids_json FROM people WHERE id = ?`,
    ).get(candidateIdentity?.personId)!.external_ids_json as string)).toEqual({
      legacyCandidateId: 'candidate-1',
      legacyContactId: 'contact-1',
    });
    expect(JSON.parse(sqlite.prepare(
      `SELECT context_json FROM workspace_people WHERE id = ?`,
    ).get(candidateIdentity?.workspacePersonId)!.context_json as string)).toMatchObject({
      contactId: 'contact-1',
      source: 'legacy_candidate',
      sources: ['legacy_candidate', 'legacy_contact'],
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM semantic_assertions').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM signal_evidence').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM concepts').get()).toEqual({ count: 0 });
  });

  it('keeps both legacy source markers when a roleless candidate is seen before the contact', async () => {
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-2',
      'workspace-1',
      null,
      'Grace Candidate',
      'grace@example.com',
      'talent_pool',
    );
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'contact-2',
      'workspace-1',
      'Grace Contact',
      'GRACE@example.com',
      '+1 555 0200',
      'Compiler Labs',
      'Maintainer',
      'advisor',
    );

    const candidateIdentity = await ensureCandidateLivingContext(db, 'candidate-2');
    const contactIdentity = await ensureContactLivingContext(db, 'contact-2');

    expect(candidateIdentity?.personId).toBe(contactIdentity?.personId);
    expect(candidateIdentity?.workspacePersonId).toBe(contactIdentity?.workspacePersonId);
    expect(JSON.parse(sqlite.prepare(
      `SELECT context_json FROM workspace_people WHERE id = ?`,
    ).get(candidateIdentity?.workspacePersonId)!.context_json as string)).toMatchObject({
      contactId: 'contact-2',
      source: 'legacy_contact',
      sources: ['legacy_candidate', 'legacy_contact'],
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({
      count: 1,
    });
  });

  it('mirrors legacy candidate nodes through source-backed context records and projection rows', async () => {
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-1',
      'workspace-1',
      'pipeline-1',
      'Ada Example',
      'ada@example.com',
      'active',
    );
    const legacyNode = node({
      semantic_terms: [
        {
          surface: 'Novel Source Surface',
          canonical_key: 'term:novel-source-surface',
          evidence_level: 'implemented',
        },
        {
          surface: 'Unscored Context Term',
          canonical_key: 'term:unscored-context-term',
          evidence_level: 'not-a-protocol-level',
        },
      ],
    });

    await mirrorCandidateNodeToLivingContext(db, {
      ...legacyNode,
      narrative_text: 'I implemented Novel Source Surface with an Unscored Context Term.',
      node_type: 'Open Predicate Nobody Has Seen',
      confidence: 0.77,
      captured_at: 1_800_000_000,
    });
    await mirrorCandidateNodeToLivingContext(db, {
      ...legacyNode,
      narrative_text: 'I implemented Novel Source Surface with an Unscored Context Term.',
      node_type: 'Open Predicate Nobody Has Seen',
      confidence: 0.77,
      captured_at: 1_800_000_000,
    });

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM semantic_assertions').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM signal_evidence').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_concepts').get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare(
      `SELECT cr.record_type,
              cr.predicate,
              cr.narrative,
              ss.exact_text
         FROM context_records cr
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crss.source_span_id`,
    ).get()).toEqual({
      record_type: 'legacy_candidate_node',
      predicate: 'node_type:open-predicate-nobody-has-seen',
      narrative: 'I implemented Novel Source Surface with an Unscored Context Term.',
      exact_text: 'I implemented Novel Source Surface with an Unscored Context Term.',
    });
    expect(sqlite.prepare(
      `SELECT c.canonical_key, crc.relationship
         FROM context_record_concepts crc
         JOIN concepts c ON c.id = crc.concept_id
        ORDER BY c.canonical_key`,
    ).all()).toEqual([
      { canonical_key: 'term:novel-source-surface', relationship: 'about' },
      { canonical_key: 'term:unscored-context-term', relationship: 'mentions' },
    ]);
    expect(JSON.parse(sqlite.prepare(
      `SELECT payload_json FROM projection_outbox`,
    ).get()!.payload_json as string)).toMatchObject({
      legacyCandidateNodeId: 'node-1',
    });

    const graph = await loadCandidateLivingContext(db, 'candidate-1');
    expect(graph?.summary.contextRecordCount).toBe(1);
    expect(graph?.contextRecords[0]).toMatchObject({
      recordType: 'legacy_candidate_node',
      predicate: 'node_type:open-predicate-nobody-has-seen',
      narrative: 'I implemented Novel Source Surface with an Unscored Context Term.',
    });
    expect(graph?.contextRecords[0]?.sources[0]?.exactText).toBe(
      'I implemented Novel Source Surface with an Unscored Context Term.',
    );
  });
});
