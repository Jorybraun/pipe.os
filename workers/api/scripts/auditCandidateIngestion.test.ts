import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
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

const CONTENT_ADDRESSED_PROFILE_KEY = 'talent-intake/candidate-1/687edcc54818080206251abe464c600f3e63820374b8b20b74985f81455531b6-profile.txt';

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
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
      phone_number TEXT,
      timezone TEXT,
      availability TEXT,
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
      ingestion_key TEXT,
      scope_type TEXT,
      scope_id TEXT,
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
      source_span_id TEXT,
      evidence_role TEXT
    );
    CREATE TABLE context_record_concepts (
      context_record_id TEXT,
      concept_id TEXT,
      relationship TEXT,
      weight REAL
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
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      github_url TEXT,
      full_name TEXT
    );
    CREATE TABLE review_challenge_packets (
      id TEXT PRIMARY KEY,
      repo_snapshot_id TEXT,
      repo_id INTEGER,
      pr_number INTEGER,
      source_hash TEXT,
      production_ready INTEGER,
      quality_score REAL,
      packet_json TEXT
    );
  `);
}

function seedSourceBackedTalentPoolCandidate(db: Database.Database): void {
  const operationalFields = [
    { id: 'source-span-github', line: 'githubUrl: https://github.com/jordan' },
    { id: 'source-span-portfolio', line: 'portfolioUrl: https://jordan.example.dev' },
    { id: 'source-span-phone-consent', line: 'phoneScreenerConsent: true' },
    { id: 'source-span-phone-number', line: 'phoneNumber: +15551234567' },
    { id: 'source-span-timezone', line: 'timezone: America/Vancouver' },
    { id: 'source-span-availability', line: 'availability: Weekday afternoons after 2 PM.' },
  ];
  const operationalText = operationalFields.map((field) => field.line).join('\n');

  db.exec(`
    INSERT INTO candidates (id, owner_id, email, invite_token, resume_s3_key, pipeline_id)
    VALUES (
      'candidate-1',
      'owner-1',
      'jordan@example.com',
      'invite-token',
      '${CONTENT_ADDRESSED_PROFILE_KEY}',
      NULL
    );
    INSERT INTO talent_pool_intakes (
      candidate_id, profile_r2_key, profile_text_excerpt, github_url,
      linkedin_url, portfolio_url, phone_screener_consent, phone_number,
      timezone, availability, submitted_at
    )
    VALUES (
      'candidate-1',
      '${CONTENT_ADDRESSED_PROFILE_KEY}',
      'Jordan shipped TypeScript Workers APIs.',
      'https://github.com/jordan',
      NULL,
      'https://jordan.example.dev',
      1,
      '+15551234567',
      'America/Vancouver',
      'Weekday afternoons after 2 PM.',
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
    VALUES ('artifact-version-1', 'artifact-1', '${CONTENT_ADDRESSED_PROFILE_KEY}', 'Jordan shipped TypeScript Workers APIs.');
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
    INSERT INTO context_record_source_refs (context_record_id, source_ref_type, source_ref_id, source_span_id, evidence_role)
    VALUES ('context-record-1', 'source_span', 'source-span-1', 'source-span-1', 'source');
    INSERT INTO context_records (id, workspace_person_id, record_type, predicate, narrative, polarity)
    VALUES
      ('context-record-github', 'workspace-person-1', 'talent_pool_external_profile_ref', 'submitted_github_profile_url', 'Candidate submitted GitHub profile URL.', 1),
      ('context-record-portfolio', 'workspace-person-1', 'talent_pool_external_profile_ref', 'submitted_portfolio_url', 'Candidate submitted portfolio URL.', 1),
      ('context-record-phone', 'workspace-person-1', 'talent_pool_phone_screener_intent', 'consented_to_phone_screener', 'Candidate consented to Talent Pool phone screener.', 1);
    INSERT INTO context_record_source_refs (context_record_id, source_ref_type, source_ref_id, source_span_id, evidence_role)
    VALUES
      ('context-record-github', 'source_span', 'source-span-github', 'source-span-github', 'source'),
      ('context-record-portfolio', 'source_span', 'source-span-portfolio', 'source-span-portfolio', 'source'),
      ('context-record-phone', 'source_span', 'source-span-phone-consent', 'source-span-phone-consent', 'source'),
      ('context-record-phone', 'source_span', 'source-span-phone-number', 'source-span-phone-number', 'source'),
      ('context-record-phone', 'source_span', 'source-span-timezone', 'source-span-timezone', 'source'),
      ('context-record-phone', 'source_span', 'source-span-availability', 'source-span-availability', 'source');
    INSERT INTO challenge_design_queue (id, candidate_id, status)
    VALUES ('queue-1', 'candidate-1', 'queued');
  `);

  db.prepare(
    `INSERT INTO interactions (id, workspace_person_id, interaction_type, external_reference, metadata_json)
     VALUES ('interaction-operational', 'workspace-person-1', 'form_submission', 'candidate-1', '{"source":"roleless_candidate_intake","evidenceKind":"operational_intake_fields"}')`,
  ).run();
  db.prepare(
    `INSERT INTO artifacts (id, workspace_person_id, interaction_id, artifact_type, logical_key, metadata_json)
     VALUES ('artifact-operational', 'workspace-person-1', 'interaction-operational', 'form_submission', 'roleless_candidate_intake_fields', '{"source":"roleless_candidate_intake","evidenceKind":"operational_intake_fields"}')`,
  ).run();
  db.prepare(
    `INSERT INTO artifact_versions (id, artifact_id, storage_key, content_text)
     VALUES ('artifact-version-operational', 'artifact-operational', NULL, ?)`,
  ).run(operationalText);

  let charStart = 0;
  const insertSpan = db.prepare(
    `INSERT INTO source_spans (id, artifact_version_id, char_start, char_end, exact_text, exact_text_hash)
     VALUES (?, 'artifact-version-operational', ?, ?, ?, ?)`,
  );
  for (const field of operationalFields) {
    const charEnd = charStart + field.line.length;
    insertSpan.run(field.id, charStart, charEnd, field.line, sha256Text(field.line));
    charStart = charEnd + 1;
  }
}

function challengePacketJson(): string {
  return JSON.stringify({
    id: 'challenge-packet-973',
    repoSnapshotId: 'repo-snapshot-1',
    pullRequest: {
      number: 973,
      url: 'https://github.com/mui/base-ui/pull/973',
      title: 'Fix popover retry scheduling',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    demands: [{
      narrative: 'Repair retry scheduling so terminal events are emitted exactly once.',
    }],
    demandFamilies: ['runtime_reliability'],
    contentHash: 'sha256:challenge-packet-973',
  });
}

function seedSourceBackedChallengePacket(db: Database.Database): void {
  db.prepare(
    `INSERT INTO qualified_repos (id, github_url, full_name)
     VALUES (41, 'https://github.com/mui/base-ui', 'mui/base-ui')`,
  ).run();
  db.prepare(
    `INSERT INTO review_challenge_packets (
       id, repo_snapshot_id, repo_id, pr_number, source_hash,
       production_ready, quality_score, packet_json
     )
     VALUES (
       'challenge-packet-973', 'repo-snapshot-1', 41, 973,
       'sha256:challenge-packet-973', 1, 0.91, ?
     )`,
  ).run(challengePacketJson());
  db.prepare(
    `INSERT INTO context_records (
       id, ingestion_key, scope_type, scope_id, record_type, narrative, polarity
     )
     VALUES (
       'challenge-packet-context-973',
       'repo-challenge-packet-context:challenge-packet-973',
       'repo_snapshot',
       'repo-snapshot-1',
       'repo_challenge_packet',
       'Source-backed review challenge packet.',
       1
     )`,
  ).run();
  db.prepare(
    `INSERT INTO context_record_source_refs (
       context_record_id, source_ref_type, source_ref_id, evidence_role
     )
     VALUES (
       'challenge-packet-context-973',
       'repo_source_span',
       'repo-source-span-1',
       'source'
     )`,
  ).run();
  db.prepare(
    `INSERT INTO context_record_concepts (context_record_id, concept_id, relationship, weight)
     VALUES ('challenge-packet-context-973', 'concept-runtime-reliability', 'about', 1)`,
  ).run();
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

  it('does not report ready when there are no Talent Pool candidates to audit', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite));

    expect(audit.status).toBe('not_ready');
    expect(audit.auditedCandidateCount).toBe(0);
    expect(audit.failures).toContain('no Talent Pool candidates were found to audit');
    expect(audit.nextActions).toContain('Submit at least one Talent Pool candidate through /talent/:token before expecting audit proof.');
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
      contentAddressedProfileStorageKeyCount: 1,
      nonContentAddressedProfileStorageKeyCount: 0,
      candidateResumeStorageKeyCount: 1,
      candidateResumeMatchesIntakeCount: 1,
      externalProfileRefCount: 2,
      phoneScreenerIntentCount: 1,
    });
    expect(audit.ingestionState.steps).toEqual([
      { currentStep: 'talent_pool_profile_received', count: 1 },
    ]);
    expect(audit.sourceProof).toMatchObject({
      candidateNodeCount: 1,
      candidateNodeExactSourceQuoteCount: 1,
      submittedIntakeWithoutExactCandidateNodeCount: 0,
      artifactVersionCount: 2,
      sourceSpanCount: 7,
      sourceSpanTextMismatchCount: 0,
      sourceSpanHashMismatchCount: 0,
      profileUploadArtifactVersionCount: 0,
      documentProfileExtractionGapCount: 0,
      documentProfileMissingExtractionProofCount: 0,
      profileUploadReceiptContextCount: 0,
      contextSourceRefCount: 7,
      candidateNodeWithoutExactSourceCount: 0,
      candidateNodeSourceSpanMissingCount: 0,
      candidateNodeStaleProfileSourceCount: 0,
    });
    expect(audit.personProjection).toMatchObject({
      personCount: 1,
      workspacePersonCount: 1,
      talentPoolWorkspacePersonCount: 1,
      rolelessApplicationCount: 0,
      rolelessPersonRoleCount: 0,
      contextRecordCount: 4,
      externalProfileRefContextCount: 2,
      missingExternalProfileRefContextCount: 0,
      externalProfileRefSourceTextMismatchCount: 0,
      phoneScreenerIntentContextCount: 1,
      missingPhoneScreenerIntentContextCount: 0,
      phoneScreenerIntentSourceTextMismatchCount: 0,
      readyChallengeAssignmentCount: 0,
      unprovenChallengeAssignmentCount: 0,
      incompleteChallengeAssignmentCount: 0,
      designQueueCount: 1,
    });
    expect(audit.duplicateProjectedEdgeCount).toBe(0);
    expect(audit.sourceLessPositiveClaimCount).toBe(0);
    expect(audit.sourceLessDesignQueueSuggestionCount).toBe(0);
  });

  it('can bound unscoped audits to the most recent Talent Pool candidates without weakening checks inside the window', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      INSERT INTO candidates (id, owner_id, email, invite_token, resume_s3_key, pipeline_id)
      VALUES ('candidate-old-gap', 'owner-1', 'old-gap@example.com', 'old-gap-token', NULL, NULL);
      INSERT INTO talent_pool_intakes (
        candidate_id, profile_r2_key, profile_text_excerpt, github_url,
        linkedin_url, portfolio_url, phone_screener_consent, phone_number,
        timezone, availability, submitted_at
      )
      VALUES (
        'candidate-old-gap',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        NULL,
        NULL,
        NULL,
        '2026-07-01T00:00:00.000Z'
      );
    `);

    const unbounded = await auditCandidateIngestion(new SqliteQueryClient(sqlite));
    expect(unbounded.auditedCandidateCount).toBe(2);
    expect(unbounded.status).toBe('not_ready');
    expect(unbounded.scope.candidateLimit).toBeNull();
    expect(unbounded.failures).toContain('1 submitted Talent Pool intake(s) lack a profile storage key');

    const bounded = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      candidateLimit: 1,
      requireContextRecords: true,
    });
    expect(bounded.status).toBe('ready');
    expect(bounded.scope.candidateLimit).toBe(1);
    expect(bounded.auditedCandidateCount).toBe(1);
    expect(bounded.rawCapture.submittedIntakeCount).toBe(1);
    expect(bounded.sourceProof.candidateNodeStaleProfileSourceCount).toBe(0);
    expect(bounded.sourceLessPositiveClaimCount).toBe(0);
    expect(bounded.duplicateProjectedEdgeCount).toBe(0);
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
    expect(audit.personProjection.unprovenChallengeAssignmentCount).toBe(0);
    expect(audit.personProjection.incompleteChallengeAssignmentCount).toBe(1);
    expect(audit.nextActions).toContain(
      '1 challenge assignment row(s) lack repo URL or PR number and cannot safely become Talent Pool assessment readiness.',
    );
  });

  it('reports PR-backed assignment rows without packet proof as unproven readiness gaps', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(
      `INSERT INTO candidate_challenge_assignment (id, candidate_id, github_repo_url, github_pr_number)
       VALUES ('assignment-unproven', 'candidate-1', 'https://github.com/mui/base-ui', 973)`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('ready');
    expect(audit.personProjection.readyChallengeAssignmentCount).toBe(0);
    expect(audit.personProjection.unprovenChallengeAssignmentCount).toBe(1);
    expect(audit.personProjection.incompleteChallengeAssignmentCount).toBe(0);
    expect(audit.nextActions).toContain(
      '1 PR-backed challenge assignment row(s) lack source-backed review packet proof and cannot safely become Talent Pool assessment readiness.',
    );
  });

  it('counts only source-backed review packet assignments as ready', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    seedSourceBackedChallengePacket(sqlite);
    sqlite.prepare(
      `INSERT INTO candidate_challenge_assignment (id, candidate_id, github_repo_url, github_pr_number)
       VALUES ('assignment-ready', 'candidate-1', 'https://github.com/mui/base-ui', 973)`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('ready');
    expect(audit.personProjection.readyChallengeAssignmentCount).toBe(1);
    expect(audit.personProjection.unprovenChallengeAssignmentCount).toBe(0);
    expect(audit.personProjection.incompleteChallengeAssignmentCount).toBe(0);
    expect(audit.nextActions).not.toContain(
      '1 PR-backed challenge assignment row(s) lack source-backed review packet proof and cannot safely become Talent Pool assessment readiness.',
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

  it('flags profile storage keys that are not content addressed', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      UPDATE talent_pool_intakes
         SET profile_r2_key = 'talent-intake/candidate-1/2026-07-02T00-00-00-000Z.txt'
       WHERE candidate_id = 'candidate-1';
      UPDATE candidates
         SET resume_s3_key = 'talent-intake/candidate-1/2026-07-02T00-00-00-000Z.txt'
       WHERE id = 'candidate-1';
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.rawCapture.profileStorageKeyCount).toBe(1);
    expect(audit.rawCapture.candidateResumeMatchesIntakeCount).toBe(1);
    expect(audit.rawCapture.contentAddressedProfileStorageKeyCount).toBe(0);
    expect(audit.rawCapture.nonContentAddressedProfileStorageKeyCount).toBe(1);
    expect(audit.failures).toContain('1 Talent Pool profile storage key(s) are not content-addressed');
    expect(audit.nextActions).toContain('Replay or repair Talent Pool profile source capture so profile_r2_key and resume_s3_key use content-hash storage paths.');
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
    expect(audit.ingestionState.steps).toEqual([
      { currentStep: 'discover_profile', count: 1 },
    ]);
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
    expect(audit.personProjection.missingExternalProfileRefContextCount).toBe(2);
    expect(audit.personProjection.phoneScreenerIntentContextCount).toBe(0);
    expect(audit.personProjection.missingPhoneScreenerIntentContextCount).toBe(1);
    expect(audit.failures).toContain('2 external profile ref(s) lack source-backed operational context records');
    expect(audit.failures).toContain('1 phone screener intent(s) lack source-backed operational context records');
  });

  it('flags operational contexts whose predicates do not match the raw intake fields', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      UPDATE context_records
         SET predicate = 'submitted_github_profile_url'
       WHERE id = 'context-record-portfolio';
      UPDATE context_records
         SET predicate = 'submitted_phone_number'
       WHERE id = 'context-record-phone';
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.rawCapture.externalProfileRefCount).toBe(2);
    expect(audit.personProjection.externalProfileRefContextCount).toBe(2);
    expect(audit.personProjection.missingExternalProfileRefContextCount).toBe(1);
    expect(audit.rawCapture.phoneScreenerIntentCount).toBe(1);
    expect(audit.personProjection.phoneScreenerIntentContextCount).toBe(1);
    expect(audit.personProjection.missingPhoneScreenerIntentContextCount).toBe(1);
    expect(audit.failures).toContain('1 external profile ref(s) lack source-backed operational context records');
    expect(audit.failures).toContain('1 phone screener intent(s) lack source-backed operational context records');
  });

  it('flags operational contexts whose source refs do not cite exact raw field text', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      UPDATE context_record_source_refs
         SET source_ref_id = 'source-span-1',
             source_span_id = 'source-span-1'
       WHERE context_record_id = 'context-record-github';
      UPDATE context_record_source_refs
         SET source_ref_id = 'source-span-1',
             source_span_id = 'source-span-1'
       WHERE context_record_id = 'context-record-phone'
         AND source_ref_id = 'source-span-phone-consent';
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.personProjection.missingExternalProfileRefContextCount).toBe(0);
    expect(audit.personProjection.externalProfileRefSourceTextMismatchCount).toBe(1);
    expect(audit.personProjection.missingPhoneScreenerIntentContextCount).toBe(0);
    expect(audit.personProjection.phoneScreenerIntentSourceTextMismatchCount).toBe(1);
    expect(audit.failures).toContain('1 external profile ref field source ref(s) do not cite exact submitted field text');
    expect(audit.failures).toContain('1 phone screener field source ref(s) do not cite exact submitted field text');
    expect(audit.nextActions).toContain('Repair GitHub/LinkedIn/portfolio operational context source refs so each one cites its exact submitted field span.');
    expect(audit.nextActions).toContain('Repair phone screener operational source refs so consent, phone number, timezone, and availability cite their exact submitted field spans.');
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
    expect(audit.sourceProof.submittedIntakeWithoutExactCandidateNodeCount).toBe(1);
    expect(audit.failures).toContain('1 submitted Talent Pool intake(s) lack exact-source candidate-node projection');
    expect(audit.nextActions).toContain('Replay or repair Talent Pool profile ingestion so each submitted profile creates an exact-source candidate node.');
  });

  it('flags exact candidate nodes whose source span cannot be resolved', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.prepare(
      `UPDATE candidate_nodes
          SET source_reference = 'source_span:missing-source-span',
              extracted_properties_json = '{"source_quote":"Jordan shipped TypeScript Workers APIs.","source_quote_validated":true,"source_span_id":"missing-source-span","source_quote_char_start":0,"source_quote_char_end":39}'
        WHERE id = 'candidate-node-profile'`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.sourceProof.candidateNodeExactSourceQuoteCount).toBe(1);
    expect(audit.sourceProof.candidateNodeSourceSpanMissingCount).toBe(1);
    expect(audit.sourceProof.candidateNodeStaleProfileSourceCount).toBe(0);
    expect(audit.failures).toContain('1 exact candidate node(s) reference missing source spans');
    expect(audit.nextActions).toContain('Repair candidate-node source references so every exact candidate node resolves to an existing source span.');
  });

  it('flags exact candidate nodes whose source span belongs to an old profile key', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      INSERT INTO interactions (id, workspace_person_id, interaction_type, external_reference, metadata_json)
      VALUES ('interaction-old-profile', 'workspace-person-1', 'message', 'candidate-1', '{"source":"roleless_candidate_intake"}');
      INSERT INTO artifacts (id, workspace_person_id, interaction_id)
      VALUES ('artifact-old-profile', 'workspace-person-1', 'interaction-old-profile');
      INSERT INTO artifact_versions (id, artifact_id, storage_key, content_text)
      VALUES ('artifact-version-old-profile', 'artifact-old-profile', 'talent-intake/candidate-1/old-profile.txt', 'Jordan shipped TypeScript Workers APIs.');
      INSERT INTO source_spans (id, artifact_version_id, char_start, char_end, exact_text, exact_text_hash)
      VALUES (
        'source-span-old-profile',
        'artifact-version-old-profile',
        0,
        39,
        'Jordan shipped TypeScript Workers APIs.',
        '687edcc54818080206251abe464c600f3e63820374b8b20b74985f81455531b6'
      );
      UPDATE candidate_nodes
         SET source_reference = 'source_span:source-span-old-profile',
             extracted_properties_json = '{"source_quote":"Jordan shipped TypeScript Workers APIs.","source_quote_validated":true,"source_span_id":"source-span-old-profile","source_quote_char_start":0,"source_quote_char_end":39}'
       WHERE id = 'candidate-node-profile';
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.sourceProof.candidateNodeExactSourceQuoteCount).toBe(1);
    expect(audit.sourceProof.candidateNodeSourceSpanMissingCount).toBe(0);
    expect(audit.sourceProof.candidateNodeStaleProfileSourceCount).toBe(1);
    expect(audit.failures).toContain('1 exact profile/resume candidate node(s) do not cite the current Talent Pool profile source');
    expect(audit.nextActions).toContain('Replay or repair candidate-node projection so exact profile/resume nodes cite the current Talent Pool profile storage key.');
  });

  it('flags submitted candidates without exact-source nodes even when another candidate has extra exact nodes', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      INSERT INTO candidate_nodes (
        id, candidate_id, source_type, source_reference, confidence, extracted_properties_json
      )
      VALUES (
        'candidate-node-profile-extra',
        'candidate-1',
        'talent_pool_profile_intake',
        'source_span:source-span-1:extra',
        1,
        '{"source_quote":"Jordan shipped TypeScript Workers APIs.","source_quote_validated":true,"source_quote_char_start":1,"source_quote_char_end":39,"exact_text_hash":"extra"}'
      );
      INSERT INTO candidates (
        id, owner_id, email, invite_token, resume_s3_key, pipeline_id
      )
      VALUES (
        'candidate-2',
        'owner-1',
        'casey@example.com',
        'invite-token-2',
        'talent-intake/candidate-2/profile.txt',
        NULL
      );
      INSERT INTO talent_pool_intakes (
        candidate_id, profile_r2_key, profile_text_excerpt, github_url,
        linkedin_url, portfolio_url, phone_screener_consent, submitted_at
      )
      VALUES (
        'candidate-2',
        'talent-intake/candidate-2/profile.txt',
        'Casey submitted profile evidence.',
        NULL,
        NULL,
        NULL,
        0,
        '2026-07-02T00:00:00.000Z'
      );
      INSERT INTO candidate_ingestion (candidate_id, status, current_step, error_text, candidate_searchable_profile)
      VALUES ('candidate-2', 'pending', 'talent_pool_profile_received', NULL, NULL);
      INSERT INTO people (id, primary_email)
      VALUES ('person-2', 'casey@example.com');
      INSERT INTO workspace_people (id, workspace_id, person_id, context_json)
      VALUES (
        'workspace-person-2',
        'owner-1',
        'person-2',
        '{"talentPool":{"candidateId":"candidate-2","status":"active","roleless":true},"legacyCandidateIds":["candidate-2"]}'
      );
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite));

    expect(audit.status).toBe('not_ready');
    expect(audit.auditedCandidateCount).toBe(2);
    expect(audit.sourceProof.candidateNodeExactSourceQuoteCount).toBe(2);
    expect(audit.sourceProof.submittedIntakeWithoutExactCandidateNodeCount).toBe(1);
    expect(audit.failures).toContain('1 submitted Talent Pool intake(s) lack exact-source candidate-node projection');
  });

  it('reports receipt-backed PDF/DOCX extraction gaps without generic candidate-node gaps', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      DELETE FROM candidate_nodes WHERE candidate_id = 'candidate-1';
      DELETE FROM signal_evidence;
      DELETE FROM assertion_source_spans;
      DELETE FROM semantic_assertions;
      DELETE FROM context_record_source_refs WHERE context_record_id = 'context-record-1';
      DELETE FROM context_records WHERE id = 'context-record-1';
    `);
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
    sqlite.prepare(
      `UPDATE candidate_ingestion
          SET current_step = 'profile_text_extraction_needed'
        WHERE candidate_id = 'candidate-1'`,
    ).run();
    sqlite.exec(`
      INSERT INTO interactions (id, workspace_person_id, interaction_type, external_reference, metadata_json)
      VALUES ('interaction-upload', 'workspace-person-1', 'file_upload', 'candidate-1', '{"source":"roleless_candidate_intake"}');
      INSERT INTO artifacts (id, workspace_person_id, interaction_id, artifact_type, logical_key, metadata_json)
      VALUES ('artifact-upload', 'workspace-person-1', 'interaction-upload', 'profile_upload', 'roleless_candidate_profile_upload', '{"evidenceKind":"profile_upload_source"}');
      INSERT INTO artifact_versions (id, artifact_id, storage_key, content_text)
      VALUES ('artifact-version-upload', 'artifact-upload', 'talent-intake/candidate-1/profile.pdf', NULL);
      INSERT INTO context_records (id, workspace_person_id, record_type, predicate, narrative, polarity)
      VALUES (
        'context-record-upload-receipt',
        'workspace-person-1',
        'talent_pool_profile_upload_receipt',
        'received_profile_upload_artifact',
        'Candidate uploaded a Talent Pool profile or resume artifact.',
        1
      );
      INSERT INTO context_record_source_refs (context_record_id, source_ref_type, source_ref_id, evidence_role)
      VALUES ('context-record-upload-receipt', 'artifact_version', 'artifact-version-upload', 'source_artifact');
    `);

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.rawCapture.documentProfileStorageKeyCount).toBe(1);
    expect(audit.ingestionState.steps).toEqual([
      { currentStep: 'profile_text_extraction_needed', count: 1 },
    ]);
    expect(audit.sourceProof.candidateNodeExactSourceQuoteCount).toBe(0);
    expect(audit.sourceProof.submittedIntakeWithoutExactCandidateNodeCount).toBe(0);
    expect(audit.sourceProof.documentProfileSourceSpanCount).toBe(0);
    expect(audit.sourceProof.documentProfileExtractionGapCount).toBe(1);
    expect(audit.sourceProof.documentProfileMissingExtractionProofCount).toBe(0);
    expect(audit.sourceProof.profileUploadArtifactVersionCount).toBe(1);
    expect(audit.sourceProof.profileUploadReceiptContextCount).toBe(1);
    expect(audit.failures).toContain('1 PDF/DOCX Talent Pool profile upload(s) are explicit profile_text_extraction_needed evidence gaps with raw upload receipts and no extracted profile text');
    expect(audit.failures).not.toContain('1 submitted Talent Pool intake(s) lack exact-source candidate-node projection');
    expect(audit.nextActions).toContain('Run document extraction/backfill before projecting profile claims from PDF/DOCX uploads; keep the raw upload receipt as the only evidence until text exists.');
  });

  it('flags PDF/DOCX profile keys with neither extracted spans nor explicit gap proof', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedSourceBackedTalentPoolCandidate(sqlite);
    sqlite.exec(`
      DELETE FROM candidate_nodes WHERE candidate_id = 'candidate-1';
      DELETE FROM signal_evidence;
      DELETE FROM assertion_source_spans;
      DELETE FROM semantic_assertions;
      DELETE FROM context_record_source_refs WHERE context_record_id = 'context-record-1';
      DELETE FROM context_records WHERE id = 'context-record-1';
    `);
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
    sqlite.prepare(
      `UPDATE candidate_ingestion
          SET current_step = 'parse_resume'
        WHERE candidate_id = 'candidate-1'`,
    ).run();

    const audit = await auditCandidateIngestion(new SqliteQueryClient(sqlite), {
      inviteToken: 'invite-token',
      requireContextRecords: true,
    });

    expect(audit.status).toBe('not_ready');
    expect(audit.sourceProof.documentProfileSourceSpanCount).toBe(0);
    expect(audit.sourceProof.documentProfileExtractionGapCount).toBe(0);
    expect(audit.sourceProof.documentProfileMissingExtractionProofCount).toBe(1);
    expect(audit.sourceProof.profileUploadReceiptContextCount).toBe(0);
    expect(audit.sourceProof.submittedIntakeWithoutExactCandidateNodeCount).toBe(1);
    expect(audit.failures).toContain('1 PDF/DOCX Talent Pool profile upload(s) have neither extracted source spans nor an explicit profile_text_extraction_needed upload receipt gap');
    expect(audit.nextActions).toContain('Repair PDF/DOCX profile ingestion so each current document key has extracted source spans or an explicit profile_text_extraction_needed upload receipt gap.');
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
