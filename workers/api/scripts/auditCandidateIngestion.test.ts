import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditCandidateIngestion,
  type QueryClient,
} from './auditCandidateIngestion';

type SqlValue = string | number | null;

class SqliteQueryClient implements QueryClient {
  constructor(private readonly db: Database.Database) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: SqlValue[] = [],
  ): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      email TEXT,
      invite_token TEXT,
      pipeline_id TEXT
    );
    CREATE TABLE talent_pool_intakes (
      candidate_id TEXT PRIMARY KEY,
      profile_r2_key TEXT,
      profile_text_excerpt TEXT,
      github_url TEXT,
      linkedin_url TEXT,
      portfolio_url TEXT,
      phone_screener_consent INTEGER,
      submitted_at TEXT
    );
    CREATE TABLE candidate_ingestion (
      candidate_id TEXT PRIMARY KEY,
      status TEXT,
      current_step TEXT,
      candidate_searchable_profile TEXT
    );
    CREATE TABLE candidate_nodes (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      source_type TEXT,
      source_reference TEXT,
      confidence REAL,
      extracted_properties_json TEXT
    );
    CREATE TABLE people (
      id TEXT PRIMARY KEY,
      primary_email TEXT
    );
    CREATE TABLE workspace_people (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      person_id TEXT,
      context_json TEXT
    );
    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT,
      legacy_candidate_id TEXT
    );
    CREATE TABLE person_roles (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT,
      application_id TEXT
    );
    CREATE TABLE interactions (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT,
      interaction_type TEXT,
      external_reference TEXT,
      metadata_json TEXT
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT,
      interaction_id TEXT
    );
    CREATE TABLE artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT,
      storage_key TEXT,
      content_text TEXT
    );
    CREATE TABLE source_spans (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT
    );
    CREATE TABLE semantic_assertions (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT,
      polarity REAL
    );
    CREATE TABLE assertion_source_spans (
      assertion_id TEXT,
      source_span_id TEXT
    );
    CREATE TABLE signal_evidence (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT,
      assertion_id TEXT,
      strength REAL
    );
    CREATE TABLE context_records (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT,
      record_type TEXT,
      predicate TEXT,
      narrative TEXT,
      polarity REAL
    );
    CREATE TABLE context_record_source_refs (
      context_record_id TEXT,
      source_ref_type TEXT,
      source_ref_id TEXT,
      evidence_role TEXT
    );
    CREATE TABLE challenge_design_queue (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      status TEXT
    );
    CREATE TABLE candidate_challenge_assignment (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      github_repo_url TEXT,
      github_pr_number INTEGER
    );
  `);
}

function seedSourceBackedTalentPoolCandidate(db: Database.Database): void {
  db.exec(`
    INSERT INTO candidates (id, owner_id, email, invite_token, pipeline_id)
    VALUES ('candidate-1', 'owner-1', 'jordan@example.com', 'invite-token', NULL);
    INSERT INTO talent_pool_intakes (
      candidate_id, profile_r2_key, profile_text_excerpt, github_url,
      linkedin_url, portfolio_url, phone_screener_consent, submitted_at
    )
    VALUES (
      'candidate-1',
      'talent-intake/candidate-1/profile.txt',
      'Jordan shipped TypeScript Workers APIs.',
      'https://github.com/jordan',
      NULL,
      'https://jordan.example.dev',
      1,
      '2026-07-02T00:00:00.000Z'
    );
    INSERT INTO candidate_ingestion (candidate_id, status, current_step, candidate_searchable_profile)
    VALUES ('candidate-1', 'pending', 'talent_pool_profile_received', NULL);
    INSERT INTO people (id, primary_email)
    VALUES ('person-1', 'jordan@example.com');
    INSERT INTO workspace_people (id, workspace_id, person_id, context_json)
    VALUES (
      'workspace-person-1',
      'owner-1',
      'person-1',
      '{"talentPool":{"candidateId":"candidate-1","status":"active","roleless":true},"legacyCandidateIds":["candidate-1"]}'
    );
    INSERT INTO interactions (id, workspace_person_id, interaction_type, external_reference, metadata_json)
    VALUES ('interaction-1', 'workspace-person-1', 'message', 'candidate-1', '{"source":"roleless_candidate_intake"}');
    INSERT INTO artifacts (id, workspace_person_id, interaction_id)
    VALUES ('artifact-1', 'workspace-person-1', 'interaction-1');
    INSERT INTO artifact_versions (id, artifact_id, storage_key, content_text)
    VALUES ('artifact-version-1', 'artifact-1', NULL, 'Jordan shipped TypeScript Workers APIs.');
    INSERT INTO source_spans (id, artifact_version_id)
    VALUES ('source-span-1', 'artifact-version-1');
    INSERT INTO semantic_assertions (id, workspace_person_id, polarity)
    VALUES ('assertion-1', 'workspace-person-1', 1);
    INSERT INTO assertion_source_spans (assertion_id, source_span_id)
    VALUES ('assertion-1', 'source-span-1');
    INSERT INTO signal_evidence (id, workspace_person_id, assertion_id, strength)
    VALUES ('signal-1', 'workspace-person-1', 'assertion-1', 0.8);
    INSERT INTO context_records (id, workspace_person_id, record_type, predicate, narrative, polarity)
    VALUES ('context-record-1', 'workspace-person-1', 'talent_pool_profile_intake', 'submitted_profile', 'Candidate submitted source-backed Talent Pool profile evidence.', 1);
    INSERT INTO context_record_source_refs (context_record_id, source_ref_type, source_ref_id, evidence_role)
    VALUES ('context-record-1', 'source_span', 'source-span-1', 'source');
    INSERT INTO challenge_design_queue (id, candidate_id, status)
    VALUES ('queue-1', 'candidate-1', 'queued');
  `);
}

describe('auditCandidateIngestion', () => {
  let sqlite: Database.Database | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('fails early when required candidate-ingestion tables are missing', async () => {
    sqlite = new Database(':memory:');

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite));

    expect(audit.status).toBe('not_ready');
    expect(audit.missingTables).toContain('candidates');
    expect(audit.failures[0]).toContain('missing candidate-ingestion tables');
  });

  it('reports a source-backed roleless Talent Pool candidate as ready', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('ready');
    expect(audit.auditedCandidateCount).toBe(1);
    expect(audit.rawCapture).toMatchObject({
      submittedIntakeCount: 1,
      profileStorageKeyCount: 1,
      externalProfileRefCount: 2,
      phoneScreenerIntentCount: 1,
    });
    expect(audit.sourceProof).toMatchObject({
      artifactVersionCount: 1,
      sourceSpanCount: 1,
      contextSourceRefCount: 1,
      candidateNodeWithoutExactSourceCount: 0,
    });
    expect(audit.personProjection).toMatchObject({
      personCount: 1,
      workspacePersonCount: 1,
      talentPoolWorkspacePersonCount: 1,
      rolelessApplicationCount: 0,
      rolelessPersonRoleCount: 0,
      contextRecordCount: 1,
      designQueueCount: 1,
    });
    expect(audit.duplicateProjectedEdgeCount).toBe(0);
    expect(audit.sourceLessPositiveClaimCount).toBe(0);
  });

  it('fails scoped audits when no candidate matches', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      candidateId: 'missing-candidate',
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.failures).toContain('no candidate matched the requested audit scope');
  });

  it('flags duplicate projected edges, source-less positive claims, and candidate node source gaps', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      INSERT INTO context_records (id, workspace_person_id, record_type, predicate, narrative, polarity)
      VALUES ('context-record-2', 'workspace-person-1', 'talent_pool_profile_intake', 'submitted_profile', 'Candidate submitted source-backed Talent Pool profile evidence.', 1);
      INSERT INTO context_record_source_refs (context_record_id, source_ref_type, source_ref_id, evidence_role)
      VALUES ('context-record-2', 'source_span', 'source-span-1', 'source');
      INSERT INTO semantic_assertions (id, workspace_person_id, polarity)
      VALUES ('assertion-without-source', 'workspace-person-1', 1);
      INSERT INTO candidate_nodes (id, candidate_id, source_type, source_reference, confidence, extracted_properties_json)
      VALUES ('candidate-node-1', 'candidate-1', 'resume', NULL, 0.7, '{"name":"TypeScript"}');
      INSERT INTO applications (id, workspace_person_id, legacy_candidate_id)
      VALUES ('application-1', 'workspace-person-1', 'candidate-1');
      INSERT INTO person_roles (id, workspace_person_id, application_id)
      VALUES ('person-role-1', 'workspace-person-1', 'application-1');
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      email: 'jordan@example.com',
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.duplicateProjectedEdgeCount).toBe(1);
    expect(audit.sourceLessPositiveClaimCount).toBe(1);
    expect(audit.sourceProof.candidateNodeWithoutExactSourceCount).toBe(1);
    expect(audit.personProjection.rolelessApplicationCount).toBe(1);
    expect(audit.personProjection.rolelessPersonRoleCount).toBe(1);
    expect(audit.failures).toContain('1 duplicate person-projected context edge group(s) were found');
    expect(audit.failures).toContain('1 positive person-context claim(s) have no source refs or source spans');
    expect(audit.failures).toContain('1 positive candidate node(s) lack an exact validated resume source quote');
    expect(audit.failures).toContain('1 roleless Talent Pool candidate(s) have application rows before a role-backed process exists');
  });
});
