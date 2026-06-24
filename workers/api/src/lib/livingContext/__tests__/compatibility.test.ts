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
import { ingestPhoneCallToLivingContext } from '../phoneCall';
import { loadCandidateLivingContext, loadContactLivingContext } from '../readModel';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
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
    sqlite.exec(transcriptProjectionMigration);
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

  it('keeps a contact on the same living person graph when the contact email changes', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'contact-email-change',
      'workspace-1',
      'Lin Contact',
      'old@example.com',
      '+1 555 0300',
      'Graph Works',
      'Hiring Partner',
      'client',
    );

    const firstIdentity = await ensureContactLivingContext(db, 'contact-email-change');
    sqlite.prepare(
      `UPDATE contacts
          SET email = ?, name = ?, phone = ?, company = ?, role = ?
        WHERE id = ?`,
    ).run(
      'new@example.com',
      'Lin Updated',
      '+1 555 0301',
      'Graph Works Updated',
      'Executive Sponsor',
      'contact-email-change',
    );
    const secondIdentity = await ensureContactLivingContext(db, 'contact-email-change');

    expect(firstIdentity).not.toBeNull();
    expect(secondIdentity).not.toBeNull();
    expect(secondIdentity?.personId).toBe(firstIdentity?.personId);
    expect(secondIdentity?.workspacePersonId).toBe(firstIdentity?.workspacePersonId);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare(
      `SELECT primary_email, display_name, primary_phone, external_ids_json
         FROM people
        WHERE id = ?`,
    ).get(firstIdentity?.personId)).toEqual({
      primary_email: 'new@example.com',
      display_name: 'Lin Updated',
      primary_phone: '+1 555 0301',
      external_ids_json: JSON.stringify({ legacyContactId: 'contact-email-change' }),
    });
    expect(JSON.parse(sqlite.prepare(
      `SELECT context_json FROM workspace_people WHERE id = ?`,
    ).get(firstIdentity?.workspacePersonId)!.context_json as string)).toMatchObject({
      contactId: 'contact-email-change',
      company: 'Graph Works Updated',
      role: 'Executive Sponsor',
      source: 'legacy_contact',
      sources: ['legacy_contact'],
    });

    const graph = await loadContactLivingContext(db, 'contact-email-change');
    expect(graph?.person.personId).toBe(firstIdentity?.personId);
    expect(graph?.person.workspacePersonId).toBe(firstIdentity?.workspacePersonId);
    expect(graph?.person.primaryEmail).toBe('new@example.com');
    expect(graph?.person.displayName).toBe('Lin Updated');
    expect(graph?.person.primaryPhone).toBe('+1 555 0301');
    expect(graph?.person.roles.map((role) => role.roleType)).toEqual(['client']);
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

  it('uses validated resume source quotes as context record source text', async () => {
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

    await mirrorCandidateNodeToLivingContext(db, {
      ...node({
        source_quote: 'Built Kafka order processing pipelines at scale.',
        source_quote_validated: true,
        source_quote_char_start: 42,
        source_quote_char_end: 91,
        semantic_terms: [{
          surface: 'Kafka order processing',
          canonical_key: 'term:kafka-order-processing',
          evidence_level: 'implemented',
        }],
      }),
      source_type: 'resume',
      narrative_text: 'Candidate implemented Kafka order processing pipelines.',
      confidence: 0.88,
    });

    const sourceRow = sqlite.prepare(
      `SELECT ss.exact_text, ss.char_start, ss.char_end, ss.metadata_json, av.content_text
         FROM context_records cr
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crss.source_span_id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id`,
    ).get() as {
      exact_text: string;
      char_start: number;
      char_end: number;
      metadata_json: string;
      content_text: string;
    };
    expect(sourceRow.exact_text).toBe('Built Kafka order processing pipelines at scale.');
    expect(sourceRow.content_text).toBe('Built Kafka order processing pipelines at scale.');
    expect(sourceRow.char_start).toBe(0);
    expect(sourceRow.char_end).toBe('Built Kafka order processing pipelines at scale.'.length);
    expect(JSON.parse(sourceRow.metadata_json)).toMatchObject({
      sourceQuoteValidated: true,
      originalCharStart: 42,
      originalCharEnd: 91,
      generatedNarrative: 'Candidate implemented Kafka order processing pipelines.',
    });

    const graph = await loadCandidateLivingContext(db, 'candidate-1');
    expect(graph?.contextRecords[0]?.sources[0]?.exactText).toBe(
      'Built Kafka order processing pipelines at scale.',
    );
    expect(graph?.contextRecords[0]?.narrative).toBe(
      'Candidate implemented Kafka order processing pipelines.',
    );
  });

  it('resolves an applicant and client contact with the same normalized email to one workspace person without fabricating signals', async () => {
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-app',
      'workspace-1',
      'pipeline-9',
      'Ada Applicant',
      'ada@example.com',
      'active',
    );
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'contact-client',
      'workspace-1',
      'Ada Client',
      'ADA@example.com',
      '+1 555 0400',
      'Graph Works',
      'Decision Maker',
      'client',
    );

    const contactIdentity = await ensureContactLivingContext(db, 'contact-client');
    const candidateIdentity = await ensureCandidateLivingContext(db, 'candidate-app');

    expect(contactIdentity).not.toBeNull();
    expect(candidateIdentity).not.toBeNull();
    expect(candidateIdentity?.personId).toBe(contactIdentity?.personId);
    expect(candidateIdentity?.workspacePersonId).toBe(contactIdentity?.workspacePersonId);

    const candidateGraph = await loadCandidateLivingContext(db, 'candidate-app');
    const contactGraph = await loadContactLivingContext(db, 'contact-client');
    expect(candidateGraph?.person.personId).toBe(contactGraph?.person.personId);
    expect(candidateGraph?.person.workspacePersonId).toBe(contactGraph?.person.workspacePersonId);
    expect(candidateGraph?.person.pipelineId).toBe('pipeline-9');
    expect(candidateGraph?.person.applicationStatus).toBe('active');
    expect(candidateGraph?.person.roles.map((role) => role.roleType).sort()).toEqual([
      'candidate',
      'client',
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
    ).get('candidate-app')).toEqual({ pipeline_id: 'pipeline-9' });

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM semantic_assertions').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM signal_evidence').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM concepts').get()).toEqual({ count: 0 });
  });

  it('resolves a customer contact and roleless candidate with the same normalized email to one workspace person', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'contact-customer',
      'workspace-1',
      'Ada Customer',
      'ADA@example.com',
      '+1 555 0500',
      'Graph Works',
      'Buyer',
      'customer',
    );
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-cust',
      'workspace-1',
      null,
      'Ada Candidate',
      'ada@example.com',
      'talent_pool',
    );

    const contactIdentity = await ensureContactLivingContext(db, 'contact-customer');
    const candidateIdentity = await ensureCandidateLivingContext(db, 'candidate-cust');

    expect(candidateIdentity?.personId).toBe(contactIdentity?.personId);
    expect(candidateIdentity?.workspacePersonId).toBe(contactIdentity?.workspacePersonId);

    const contactGraph = await loadContactLivingContext(db, 'contact-customer');
    expect(contactGraph?.person.roles.map((role) => role.roleType).sort()).toEqual([
      'candidate',
      'customer',
    ]);
    expect(contactGraph?.person.pipelineId).toBeNull();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_people').get()).toEqual({
      count: 1,
    });
  });

  it('attaches resume, interview, message, assessment, and phone-call evidence to the shared person graph after convergence', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'contact-ev',
      'workspace-1',
      'Ada Contact',
      'ada@example.com',
      '+1 555 0600',
      'Graph Works',
      'Advisor',
      'advisor',
    );
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-ev',
      'workspace-1',
      'pipeline-ev',
      'Ada Candidate',
      'ada@example.com',
      'active',
    );

    await ensureContactLivingContext(db, 'contact-ev');
    await ensureCandidateLivingContext(db, 'candidate-ev');

    const baseNode = node({});
    for (const sourceType of ['resume', 'interview', 'message', 'assessment']) {
      await mirrorCandidateNodeToLivingContext(db, {
        ...baseNode,
        candidate_id: 'candidate-ev',
        id: `node-${sourceType}`,
        source_type: sourceType,
        source_reference: `ref-${sourceType}`,
        narrative_text: `Evidence captured from ${sourceType}.`,
        node_type: 'EvidenceCapture',
        confidence: 0.7,
        captured_at: 1_700_000_000,
      });
    }

    await ingestPhoneCallToLivingContext(db, {
      callId: 'call-ev',
      candidateId: 'candidate-ev',
      direction: 'OUTBOUND',
      startedAt: '2026-06-13T20:00:00.000Z',
      endedAt: '2026-06-13T20:10:00.000Z',
      transcript: 'Recruiter: Tell me about your experience.\nCandidate: I built distributed systems.',
      transcriptProvider: 'test',
    });

    const candidateGraph = await loadCandidateLivingContext(db, 'candidate-ev');
    const contactGraph = await loadContactLivingContext(db, 'contact-ev');

    expect(candidateGraph?.person.workspacePersonId).toBe(contactGraph?.person.workspacePersonId);

    const interactionTypes = candidateGraph?.interactions
      .map((interaction) => interaction.interactionType)
      .sort();
    expect(interactionTypes).toEqual(
      expect.arrayContaining(['assessment', 'interview', 'message', 'phone_call', 'resume']),
    );

    expect(candidateGraph?.summary.interactionCount).toBe(5);
    expect(candidateGraph?.summary.contextRecordCount).toBe(5);

    expect(contactGraph?.summary.interactionCount).toBe(5);
    expect(contactGraph?.summary.contextRecordCount).toBe(5);
    expect(contactGraph?.interactions
      .map((interaction) => interaction.interactionType)
      .sort()).toEqual(
      expect.arrayContaining(['assessment', 'interview', 'message', 'phone_call', 'resume']),
    );

    const contextRecordTypes = candidateGraph?.contextRecords
      .map((record) => record.recordType)
      .sort();
    expect(contextRecordTypes).toEqual(
      expect.arrayContaining([
        'legacy_candidate_node',
        'legacy_candidate_node',
        'legacy_candidate_node',
        'legacy_candidate_node',
        'phone_call_transcript',
      ]),
    );
  });

  it('keeps interaction-level records separate from accumulated person context', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'contact-sep',
      'workspace-1',
      'Ada Contact',
      'ada@example.com',
      '+1 555 0700',
      'Graph Works',
      'Advisor',
      'advisor',
    );
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-sep',
      'workspace-1',
      'pipeline-sep',
      'Ada Candidate',
      'ada@example.com',
      'active',
    );

    const candidateIdentity = await ensureCandidateLivingContext(db, 'candidate-sep');
    const contactIdentity = await ensureContactLivingContext(db, 'contact-sep');
    expect(candidateIdentity?.workspacePersonId).toBe(contactIdentity?.workspacePersonId);
    const workspacePersonId = candidateIdentity?.workspacePersonId;

    await mirrorCandidateNodeToLivingContext(db, {
      ...node({}),
      candidate_id: 'candidate-sep',
      id: 'node-sep',
      source_type: 'resume',
      source_reference: 'ref-sep',
      narrative_text: 'Interaction-level evidence narrative.',
      node_type: 'EvidenceCapture',
      confidence: 0.7,
      captured_at: 1_700_000_000,
    });

    const contextJson = JSON.parse(sqlite.prepare(
      `SELECT context_json FROM workspace_people WHERE id = ?`,
    ).get(workspacePersonId)!.context_json as string) as Record<string, unknown>;

    expect(contextJson).toMatchObject({
      contactId: 'contact-sep',
      source: expect.stringMatching(/^legacy_(candidate|contact)$/),
      sources: ['legacy_candidate', 'legacy_contact'],
    });
    expect(contextJson).not.toHaveProperty('narrative');
    expect(contextJson).not.toHaveProperty('narrative_text');
    expect(contextJson).not.toHaveProperty('interactionType');
    expect(contextJson).not.toHaveProperty('recordType');
    expect(contextJson).not.toHaveProperty('predicate');

    const interactionCount = sqlite.prepare('SELECT COUNT(*) AS count FROM interactions').get();
    expect(interactionCount).toEqual({ count: 1 });
    const contextRecordCount = sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get();
    expect(contextRecordCount).toEqual({ count: 1 });

    const interactionRow = sqlite.prepare(
      `SELECT interaction_type, external_reference FROM interactions WHERE workspace_person_id = ?`,
    ).get(workspacePersonId) as { interaction_type: string; external_reference: string };
    expect(interactionRow.interaction_type).toBe('resume');
    expect(interactionRow.external_reference).toBe('ref-sep');

    const contextRecordRow = sqlite.prepare(
      `SELECT record_type, narrative FROM context_records WHERE workspace_person_id = ?`,
    ).get(workspacePersonId) as { record_type: string; narrative: string };
    expect(contextRecordRow.record_type).toBe('legacy_candidate_node');
    expect(contextRecordRow.narrative).toBe('Interaction-level evidence narrative.');
  });

  it('preserves and merges existing workspace_people context_json instead of overwriting it', async () => {
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'contact-preserve',
      'workspace-1',
      'Ada Contact',
      'ada@example.com',
      '+1 555 0800',
      'Graph Works',
      'Advisor',
      'advisor',
    );
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-preserve',
      'workspace-1',
      null,
      'Ada Candidate',
      'ada@example.com',
      'talent_pool',
    );

    const contactIdentity = await ensureContactLivingContext(db, 'contact-preserve');
    const workspacePersonId = contactIdentity?.workspacePersonId;

    sqlite.prepare(
      `UPDATE workspace_people SET context_json = ? WHERE id = ?`,
    ).run(
      JSON.stringify({
        ...JSON.parse(sqlite.prepare(
          `SELECT context_json FROM workspace_people WHERE id = ?`,
        ).get(workspacePersonId)!.context_json as string),
        notes: 'pre-existing accumulated note',
        tags: ['vip', 'priority'],
      }),
      workspacePersonId,
    );

    await ensureCandidateLivingContext(db, 'candidate-preserve');

    const contextJson = JSON.parse(sqlite.prepare(
      `SELECT context_json FROM workspace_people WHERE id = ?`,
    ).get(workspacePersonId)!.context_json as string);
    expect(contextJson).toMatchObject({
      notes: 'pre-existing accumulated note',
      tags: ['vip', 'priority'],
      contactId: 'contact-preserve',
      source: 'legacy_candidate',
      sources: ['legacy_candidate', 'legacy_contact'],
    });
  });
});
