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
      resume_s3_key TEXT,
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
      error_text TEXT,
      candidate_searchable_profile TEXT
    );
    CREATE TABLE candidate_nodes (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      ingestion_key TEXT,
      node_type TEXT,
      narrative_text TEXT,
      source_type TEXT,
      source_reference TEXT,
      confidence REAL,
      extracted_properties_json TEXT,
      superseded_at INTEGER
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
      interaction_id TEXT,
      artifact_type TEXT,
      logical_key TEXT,
      metadata_json TEXT
    );
    CREATE TABLE artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT,
      storage_key TEXT,
      content_text TEXT
    );
    CREATE TABLE source_spans (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT,
      char_start INTEGER,
      char_end INTEGER,
      exact_text TEXT,
      exact_text_hash TEXT
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
      status TEXT,
      suggested_repo_families TEXT
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
    INSERT INTO candidates (id, owner_id, email, invite_token, resume_s3_key, pipeline_id)
    VALUES (
      'candidate-1',
      'owner-1',
      'jordan@example.com',
      'invite-token',
      'talent-intake/candidate-1/profile.txt',
      NULL
    );
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
    INSERT INTO candidate_ingestion (candidate_id, status, current_step, error_text, candidate_searchable_profile)
    VALUES ('candidate-1', 'pending', 'talent_pool_profile_received', NULL, NULL);
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
    INSERT INTO source_spans (id, artifact_version_id, char_start, char_end, exact_text, exact_text_hash)
    VALUES (
      'source-span-1',
      'artifact-version-1',
      0,
      39,
      'Jordan shipped TypeScript Workers APIs.',
      '687edcc54818080206251abe464c600f3e63820374b8b20b74985f81455531b6'
    );
    INSERT INTO semantic_assertions (id, workspace_person_id, polarity)
    VALUES ('assertion-1', 'workspace-person-1', 1);
    INSERT INTO assertion_source_spans (assertion_id, source_span_id)
    VALUES ('assertion-1', 'source-span-1');
    INSERT INTO signal_evidence (id, workspace_person_id, assertion_id, strength)
    VALUES ('signal-1', 'workspace-person-1', 'assertion-1', 0.8);
    INSERT INTO candidate_nodes (id, candidate_id, source_type, source_reference, confidence, extracted_properties_json)
    VALUES (
      'candidate-node-profile',
      'candidate-1',
      'talent_pool_profile_intake',
      'source_span:source-span-1',
      1,
      '{"source_quote":"Jordan shipped TypeScript Workers APIs.","source_quote_validated":true,"source_quote_char_start":0,"source_quote_char_end":39}'
    );
    INSERT INTO context_records (id, workspace_person_id, record_type, predicate, narrative, polarity)
    VALUES ('context-record-1', 'workspace-person-1', 'talent_pool_profile_intake', 'submitted_profile', 'Candidate submitted source-backed Talent Pool profile evidence.', 1);
    INSERT INTO context_record_source_refs (context_record_id, source_ref_type, source_ref_id, evidence_role)
    VALUES ('context-record-1', 'source_span', 'source-span-1', 'source');
    INSERT INTO context_records (id, workspace_person_id, record_type, predicate, narrative, polarity)
    VALUES
      ('context-record-github', 'workspace-person-1', 'talent_pool_external_profile_ref', 'submitted_github_profile_url', 'Candidate submitted GitHub profile URL.', 1),
      ('context-record-portfolio', 'workspace-person-1', 'talent_pool_external_profile_ref', 'submitted_portfolio_url', 'Candidate submitted portfolio URL.', 1),
      ('context-record-phone', 'workspace-person-1', 'talent_pool_phone_screener_intent', 'consented_to_phone_screener', 'Candidate consented to Talent Pool phone screener.', 1);
    INSERT INTO context_record_source_refs (context_record_id, source_ref_type, source_ref_id, evidence_role)
    VALUES
      ('context-record-github', 'source_span', 'source-span-1', 'source'),
      ('context-record-portfolio', 'source_span', 'source-span-1', 'source'),
      ('context-record-phone', 'source_span', 'source-span-1', 'source');
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
      candidateResumeStorageKeyCount: 1,
      candidateResumeMatchesIntakeCount: 1,
      externalProfileRefCount: 2,
      phoneScreenerIntentCount: 1,
    });
    expect(audit.sourceProof).toMatchObject({
      candidateNodeCount: 1,
      candidateNodeExactSourceQuoteCount: 1,
      artifactVersionCount: 1,
      sourceSpanCount: 1,
      sourceSpanTextMismatchCount: 0,
      sourceSpanHashMismatchCount: 0,
      profileUploadArtifactVersionCount: 0,
      contextSourceRefCount: 4,
      candidateNodeWithoutExactSourceCount: 0,
    });
    expect(audit.personProjection).toMatchObject({
      personCount: 1,
      workspacePersonCount: 1,
      talentPoolWorkspacePersonCount: 1,
      rolelessApplicationCount: 0,
      rolelessPersonRoleCount: 0,
      contextRecordCount: 4,
      externalProfileRefContextCount: 2,
      phoneScreenerIntentContextCount: 1,
      readyChallengeAssignmentCount: 0,
      incompleteChallengeAssignmentCount: 0,
      designQueueCount: 1,
    });
    expect(audit.duplicateProjectedEdgeCount).toBe(0);
    expect(audit.sourceLessPositiveClaimCount).toBe(0);
    expect(audit.sourceLessDesignQueueSuggestionCount).toBe(0);
  });

  it('reports assignment rows without repo and PR as assessment setup gaps', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(
      `INSERT INTO candidate_challenge_assignment (id, candidate_id, github_repo_url, github_pr_number)
       VALUES ('assignment-incomplete', 'candidate-1', NULL, NULL)`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('ready');
    expect(audit.personProjection.readyChallengeAssignmentCount).toBe(0);
    expect(audit.personProjection.incompleteChallengeAssignmentCount).toBe(1);
    expect(audit.nextActions).toContain(
      '1 challenge assignment row(s) lack repo URL or PR number and cannot safely become Talent Pool assessment readiness.',
    );
  });

  it('flags submitted Talent Pool candidates whose candidate row lacks a resume storage key', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(
      `UPDATE candidates
          SET resume_s3_key = NULL
        WHERE id = 'candidate-1'`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.rawCapture.candidateResumeStorageKeyCount).toBe(0);
    expect(audit.rawCapture.candidateResumeMatchesIntakeCount).toBe(0);
    expect(audit.failures).toContain('1 submitted Talent Pool candidate row(s) lack resume_s3_key');
  });

  it('flags candidate resume storage keys that drift from the latest intake profile key', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(
      `UPDATE candidates
          SET resume_s3_key = 'talent-intake/candidate-1/stale-profile.txt'
        WHERE id = 'candidate-1'`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.rawCapture.candidateResumeStorageKeyCount).toBe(1);
    expect(audit.rawCapture.candidateResumeMatchesIntakeCount).toBe(0);
    expect(audit.failures).toContain('1 Talent Pool candidate row resume_s3_key value(s) do not match current intake profile_r2_key');
  });

  it('flags failed candidate_ingestion state for submitted Talent Pool candidates', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(
      `UPDATE candidate_ingestion
          SET status = 'failed',
              current_step = 'discover_profile',
              error_text = 'Discovery failed: request timeout'
        WHERE candidate_id = 'candidate-1'`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.ingestionState.failedRowCount).toBe(1);
    expect(audit.ingestionState.errorTextRowCount).toBe(1);
    expect(audit.failures).toContain('1 submitted Talent Pool candidate_ingestion row(s) are failed');
    expect(audit.failures).toContain('1 submitted Talent Pool candidate_ingestion row(s) still carry error_text');
    expect(audit.nextActions).toContain('Replay or repair failed Talent Pool candidate_ingestion rows before treating ingestion as ready.');
  });

  it('flags lingering candidate_ingestion error text after state recovery', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(
      `UPDATE candidate_ingestion
          SET status = 'embedded',
              current_step = 'embed_profile',
              error_text = 'Previous discovery failure'
        WHERE candidate_id = 'candidate-1'`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.ingestionState.failedRowCount).toBe(0);
    expect(audit.ingestionState.errorTextRowCount).toBe(1);
    expect(audit.failures).toContain('1 submitted Talent Pool candidate_ingestion row(s) still carry error_text');
  });

  it('flags duplicate active candidate-node evidence groups', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      INSERT INTO candidate_nodes (
        id, candidate_id, node_type, narrative_text, source_type, source_reference,
        confidence, extracted_properties_json, superseded_at
      )
      VALUES
        (
          'candidate-node-exp-1',
          'candidate-1',
          'Experience',
          'Senior Engineer at Acme Corp',
          'resume',
          NULL,
          0.8,
          '{"company":"Acme Corp","role":"Senior Engineer","source_quote":"Senior Engineer","source_quote_validated":true,"source_quote_char_start":10,"source_quote_char_end":25}',
          NULL
        ),
        (
          'candidate-node-exp-2',
          'candidate-1',
          'Experience',
          'Senior Engineer at Acme Corp',
          'resume',
          NULL,
          0.8,
          '{"company":"Acme Corp","role":"Senior Engineer","source_quote":"Senior Engineer","source_quote_validated":true,"source_quote_char_start":10,"source_quote_char_end":25}',
          NULL
        );
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.sourceProof.duplicateCandidateNodeEvidenceCount).toBe(1);
    expect(audit.sourceProof.candidateNodeSourceAnchorConflictCount).toBe(0);
    expect(audit.failures).toContain('1 duplicate active candidate-node evidence group(s) were found');
    expect(audit.nextActions).toContain('Replay or repair candidate-node ingestion so active source-backed evidence rows are idempotent.');
  });

  it('flags active candidate nodes whose structured facts cite the same resume anchor', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      INSERT INTO candidate_nodes (
        id, candidate_id, node_type, narrative_text, source_type, source_reference,
        confidence, extracted_properties_json, superseded_at
      )
      VALUES
        (
          'candidate-node-morgan',
          'candidate-1',
          'Experience',
          'Senior UI Developer at Morgan Stanley',
          'resume',
          NULL,
          0.8,
          '{"company":"Morgan Stanley","role":"Senior UI Developer","source_quote":"Senior UI Developer","source_quote_validated":true,"source_quote_char_start":94,"source_quote_char_end":113}',
          NULL
        ),
        (
          'candidate-node-sycle',
          'candidate-1',
          'Experience',
          'Senior UI Developer at Sycle',
          'resume',
          NULL,
          0.8,
          '{"company":"Sycle","role":"Senior UI Developer","source_quote":"Senior UI Developer","source_quote_validated":true,"source_quote_char_start":94,"source_quote_char_end":113}',
          NULL
        );
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.sourceProof.duplicateCandidateNodeEvidenceCount).toBe(0);
    expect(audit.sourceProof.candidateNodeSourceAnchorConflictCount).toBe(1);
    expect(audit.failures).toContain('1 active candidate-node source anchor conflict group(s) were found');
    expect(audit.nextActions).toContain('Repair resume decomposition source anchoring so repeated titles or labels cite the matching source occurrence.');
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

  it('flags raw external refs and phone intent that lack source-backed operational context', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      DELETE FROM context_record_source_refs
       WHERE context_record_id IN ('context-record-github', 'context-record-portfolio', 'context-record-phone');
      DELETE FROM context_records
       WHERE id IN ('context-record-github', 'context-record-portfolio', 'context-record-phone');
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.personProjection.externalProfileRefContextCount).toBe(0);
    expect(audit.personProjection.phoneScreenerIntentContextCount).toBe(0);
    expect(audit.failures).toContain('2 external profile ref(s) lack source-backed operational context records');
    expect(audit.failures).toContain('1 phone screener intent(s) lack source-backed operational context records');
  });

  it('flags submitted profiles that lack exact-source candidate-node projection', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(`DELETE FROM candidate_nodes WHERE candidate_id = 'candidate-1'`).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.sourceProof.candidateNodeExactSourceQuoteCount).toBe(0);
    expect(audit.failures).toContain('1 submitted Talent Pool intake(s) lack exact-source candidate-node projection');
    expect(audit.nextActions).toContain('Replay or repair Talent Pool profile ingestion so each submitted profile creates an exact-source candidate node.');
  });

  it('flags PDF/DOCX profile keys without extracted source spans', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(
      `UPDATE talent_pool_intakes
          SET profile_r2_key = 'talent-intake/candidate-1/profile.pdf'
        WHERE candidate_id = 'candidate-1'`,
    ).run();
    sqlite.prepare(
      `UPDATE candidates
          SET resume_s3_key = 'talent-intake/candidate-1/profile.pdf'
        WHERE id = 'candidate-1'`,
    ).run();
    sqlite.exec(`
      INSERT INTO interactions (id, workspace_person_id, interaction_type, external_reference, metadata_json)
      VALUES ('interaction-upload', 'workspace-person-1', 'file_upload', 'candidate-1', '{"source":"roleless_candidate_intake"}');
      INSERT INTO artifacts (id, workspace_person_id, interaction_id, artifact_type, logical_key, metadata_json)
      VALUES ('artifact-upload', 'workspace-person-1', 'interaction-upload', 'profile_upload', 'roleless_candidate_profile_upload', '{"evidenceKind":"profile_upload_source"}');
      INSERT INTO artifact_versions (id, artifact_id, storage_key, content_text)
      VALUES ('artifact-version-upload', 'artifact-upload', 'talent-intake/candidate-1/profile.pdf', NULL);
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.rawCapture.documentProfileStorageKeyCount).toBe(1);
    expect(audit.sourceProof.documentProfileSourceSpanCount).toBe(0);
    expect(audit.sourceProof.profileUploadArtifactVersionCount).toBe(1);
    expect(audit.failures).toContain('1 PDF/DOCX Talent Pool profile upload(s) lack extracted source spans for the current profile key');
    expect(audit.nextActions).toContain('Replay or repair PDF/DOCX profile extraction so the current profile storage key has exact source spans.');
  });

  it('flags source spans whose exact text does not match artifact coordinates', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(
      `UPDATE source_spans
          SET exact_text = 'Jordan shipped unrelated evidence.',
              exact_text_hash = 'eb9227fea96f6233b079ce647091b14cf73786291ced7107b6a1b62f167f0e00',
              char_start = 0,
              char_end = 37
        WHERE id = 'source-span-1'`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.sourceProof.sourceSpanTextMismatchCount).toBe(1);
    expect(audit.sourceProof.sourceSpanHashMismatchCount).toBe(0);
    expect(audit.failures).toContain('1 source span(s) do not match their artifact_version content_text slice');
    expect(audit.nextActions).toContain('Repair source span coordinates so exact_text matches the immutable artifact content_text slice.');
  });

  it('flags source spans whose exact text hash does not match exact text', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(
      `UPDATE source_spans
          SET exact_text_hash = 'wrong-hash'
        WHERE id = 'source-span-1'`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.sourceProof.sourceSpanTextMismatchCount).toBe(0);
    expect(audit.sourceProof.sourceSpanHashMismatchCount).toBe(1);
    expect(audit.failures).toContain('1 source span(s) have exact_text_hash values that do not match exact_text');
    expect(audit.nextActions).toContain('Repair source span hashes so exact_text_hash is the SHA-256 of exact_text.');
  });

  it('flags design-queue repo-family suggestions for unextracted document uploads', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      UPDATE talent_pool_intakes
         SET profile_r2_key = 'talent-intake/candidate-1/profile.pdf'
       WHERE candidate_id = 'candidate-1';
      UPDATE challenge_design_queue
         SET suggested_repo_families = '["general TypeScript application code"]'
       WHERE candidate_id = 'candidate-1';
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.sourceLessDesignQueueSuggestionCount).toBe(1);
    expect(audit.failures).toContain('1 design-queue repo-family suggestion(s) lack extracted PDF/DOCX source spans');
    expect(audit.nextActions).toContain('Clear suggested repo families and keep challenge design in a missing-evidence state until PDF/DOCX profile extraction creates exact source spans.');
  });
});
