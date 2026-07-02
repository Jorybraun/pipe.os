#!/usr/bin/env tsx
/**
 * Read-only Talent Pool candidate-ingestion audit.
 *
 * Reports whether Talent Pool profile evidence has durable raw capture,
 * exact source spans/source refs, candidate-ingestion state, and person graph
 * projection. The audit treats person/living-context rows as rebuildable
 * projections; raw intake rows, stored artifacts, source spans, and candidate
 * nodes remain the evidence spine.
 */

import dotenv from 'dotenv';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
dotenv.config({ path: resolve(apiRoot, '.dev.vars'), quiet: true });

export interface QueryClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: Array<string | number | null>,
  ): Promise<T[]>;
}

interface LocalSqliteStatement {
  all(...values: Array<string | number | null>): unknown[];
}

interface LocalSqliteDatabase {
  prepare(sql: string): LocalSqliteStatement;
  close(): void;
}

class LocalQueryClient implements QueryClient {
  constructor(private readonly database: LocalSqliteDatabase) {}

  async query<T>(
    sql: string,
    params: Array<string | number | null> = [],
  ): Promise<T[]> {
    return this.database.prepare(sql).all(...params) as T[];
  }
}

export interface CandidateIngestionAuditOptions {
  candidateId?: string;
  inviteToken?: string;
  email?: string;
  requireContextRecords?: boolean;
}

export interface CandidateRawCaptureAudit {
  talentPoolIntakeCount: number;
  submittedIntakeCount: number;
  profileStorageKeyCount: number;
  profileTextExcerptCount: number;
  externalProfileRefCount: number;
  phoneScreenerIntentCount: number;
}

export interface CandidateIngestionStateAudit {
  rowCount: number;
  statuses: Array<{ status: string; count: number }>;
}

export interface CandidateSourceProofAudit {
  candidateNodeCount: number;
  candidateNodeExactSourceQuoteCount: number;
  candidateNodeWithoutExactSourceCount: number;
  artifactVersionCount: number;
  sourceSpanCount: number;
  contextSourceRefCount: number;
}

export interface CandidatePersonProjectionAudit {
  personCount: number;
  workspacePersonCount: number;
  talentPoolWorkspacePersonCount: number;
  rolelessApplicationCount: number;
  rolelessPersonRoleCount: number;
  contextRecordCount: number;
  signalEvidenceCount: number;
  readyChallengeAssignmentCount: number;
  designQueueCount: number;
}

export interface CandidateIngestionAudit {
  status: 'ready' | 'not_ready';
  checkedAt: string;
  scope: {
    candidateId: string | null;
    inviteToken: string | null;
    email: string | null;
    requireContextRecords: boolean;
  };
  auditedCandidateCount: number;
  missingTables: string[];
  rawCapture: CandidateRawCaptureAudit;
  ingestionState: CandidateIngestionStateAudit;
  sourceProof: CandidateSourceProofAudit;
  personProjection: CandidatePersonProjectionAudit;
  sourceLessPositiveClaimCount: number;
  duplicateProjectedEdgeCount: number;
  failures: string[];
  nextActions: string[];
}

interface CountRow {
  count: number;
}

interface StatusRow {
  status: string | null;
  count: number;
}

interface RawCaptureRow {
  talent_pool_intake_count: number | null;
  submitted_intake_count: number | null;
  profile_storage_key_count: number | null;
  profile_text_excerpt_count: number | null;
  external_profile_ref_count: number | null;
  phone_screener_intent_count: number | null;
}

interface SourceProofRow {
  candidate_node_count: number | null;
  candidate_node_exact_source_quote_count: number | null;
  candidate_node_without_exact_source_count: number | null;
  artifact_version_count: number | null;
  source_span_count: number | null;
  context_source_ref_count: number | null;
}

interface ProjectionRow {
  person_count: number | null;
  workspace_person_count: number | null;
  talent_pool_workspace_person_count: number | null;
  roleless_application_count: number | null;
  roleless_person_role_count: number | null;
  context_record_count: number | null;
  signal_evidence_count: number | null;
  ready_challenge_assignment_count: number | null;
  design_queue_count: number | null;
}

const REQUIRED_TABLES = [
  'candidates',
  'talent_pool_intakes',
  'candidate_ingestion',
  'candidate_nodes',
  'people',
  'workspace_people',
  'applications',
  'person_roles',
  'interactions',
  'artifacts',
  'artifact_versions',
  'source_spans',
  'semantic_assertions',
  'assertion_source_spans',
  'signal_evidence',
  'context_records',
  'context_record_source_refs',
  'challenge_design_queue',
  'candidate_challenge_assignment',
];

function toNumber(value: number | null | undefined): number {
  return Number(value ?? 0);
}

async function count(
  client: QueryClient,
  sql: string,
  params: Array<string | number | null> = [],
): Promise<number> {
  const rows = await client.query<CountRow>(sql, params);
  return toNumber(rows[0]?.count);
}

async function tableExists(client: QueryClient, tableName: string): Promise<boolean> {
  const rows = await client.query<{ name: string }>(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND name = ?`,
    [tableName],
  );
  return rows.length > 0;
}

function scoped(options: CandidateIngestionAuditOptions): boolean {
  return Boolean(options.candidateId ?? options.inviteToken ?? options.email);
}

function candidateScope(options: CandidateIngestionAuditOptions): {
  cte: string;
  params: Array<string | number | null>;
} {
  const filters: string[] = [];
  const params: Array<string | number | null> = [];
  if (options.candidateId) {
    filters.push('c.id = ?');
    params.push(options.candidateId);
  }
  if (options.inviteToken) {
    filters.push('c.invite_token = ?');
    params.push(options.inviteToken);
  }
  if (options.email) {
    filters.push('LOWER(c.email) = LOWER(?)');
    params.push(options.email);
  }

  const filterSql = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';
  const defaultTalentPoolFilter = scoped(options) ? '' : ' AND t.candidate_id IS NOT NULL';
  return {
    params,
    cte: `
      WITH audited_candidates AS (
        SELECT DISTINCT c.id
          FROM candidates c
          LEFT JOIN talent_pool_intakes t ON t.candidate_id = c.id
         WHERE 1 = 1
           ${filterSql}
           ${defaultTalentPoolFilter}
      ),
      linked_workspace_people AS (
        SELECT DISTINCT ac.id AS candidate_id, wp.id AS workspace_person_id, wp.person_id
          FROM audited_candidates ac
          JOIN workspace_people wp
            ON json_extract(wp.context_json, '$.talentPool.candidateId') = ac.id
        UNION
        SELECT DISTINCT ac.id AS candidate_id, app.workspace_person_id, wp.person_id
          FROM audited_candidates ac
          JOIN applications app ON app.legacy_candidate_id = ac.id
          JOIN workspace_people wp ON wp.id = app.workspace_person_id
      ),
      source_artifact_versions AS (
        SELECT DISTINCT ac.id AS candidate_id, av.id AS artifact_version_id
          FROM audited_candidates ac
          JOIN interactions i ON i.external_reference = ac.id
          JOIN artifacts a ON a.interaction_id = i.id
          JOIN artifact_versions av ON av.artifact_id = a.id
        UNION
        SELECT DISTINCT ac.id AS candidate_id, av.id AS artifact_version_id
          FROM audited_candidates ac
          JOIN talent_pool_intakes t ON t.candidate_id = ac.id
          JOIN artifact_versions av ON av.storage_key = t.profile_r2_key
      )
    `,
  };
}

async function loadRawCapture(
  client: QueryClient,
  scopeSql: string,
  params: Array<string | number | null>,
): Promise<CandidateRawCaptureAudit> {
  const rows = await client.query<RawCaptureRow>(
    `${scopeSql}
     SELECT
       COUNT(DISTINCT t.candidate_id) AS talent_pool_intake_count,
       COUNT(DISTINCT CASE WHEN t.submitted_at IS NOT NULL THEN t.candidate_id END) AS submitted_intake_count,
       COUNT(DISTINCT CASE WHEN t.profile_r2_key IS NOT NULL AND TRIM(t.profile_r2_key) <> '' THEN t.candidate_id END) AS profile_storage_key_count,
       COUNT(DISTINCT CASE WHEN t.profile_text_excerpt IS NOT NULL AND TRIM(t.profile_text_excerpt) <> '' THEN t.candidate_id END) AS profile_text_excerpt_count,
       SUM(
         CASE WHEN t.github_url IS NOT NULL AND TRIM(t.github_url) <> '' THEN 1 ELSE 0 END
         + CASE WHEN t.linkedin_url IS NOT NULL AND TRIM(t.linkedin_url) <> '' THEN 1 ELSE 0 END
         + CASE WHEN t.portfolio_url IS NOT NULL AND TRIM(t.portfolio_url) <> '' THEN 1 ELSE 0 END
       ) AS external_profile_ref_count,
       COUNT(DISTINCT CASE WHEN t.phone_screener_consent = 1 THEN t.candidate_id END) AS phone_screener_intent_count
      FROM audited_candidates ac
      LEFT JOIN talent_pool_intakes t ON t.candidate_id = ac.id`,
    params,
  );
  const row = rows[0];
  return {
    talentPoolIntakeCount: toNumber(row?.talent_pool_intake_count),
    submittedIntakeCount: toNumber(row?.submitted_intake_count),
    profileStorageKeyCount: toNumber(row?.profile_storage_key_count),
    profileTextExcerptCount: toNumber(row?.profile_text_excerpt_count),
    externalProfileRefCount: toNumber(row?.external_profile_ref_count),
    phoneScreenerIntentCount: toNumber(row?.phone_screener_intent_count),
  };
}

async function loadIngestionState(
  client: QueryClient,
  scopeSql: string,
  params: Array<string | number | null>,
): Promise<CandidateIngestionStateAudit> {
  const rowCount = await count(
    client,
    `${scopeSql}
     SELECT COUNT(DISTINCT ci.candidate_id) AS count
       FROM audited_candidates ac
       JOIN candidate_ingestion ci ON ci.candidate_id = ac.id`,
    params,
  );
  const statuses = await client.query<StatusRow>(
    `${scopeSql}
     SELECT COALESCE(ci.status, 'missing') AS status, COUNT(*) AS count
       FROM audited_candidates ac
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = ac.id
      GROUP BY COALESCE(ci.status, 'missing')
      ORDER BY status`,
    params,
  );
  return {
    rowCount,
    statuses: statuses.map((row) => ({
      status: row.status ?? 'missing',
      count: toNumber(row.count),
    })),
  };
}

async function loadSourceProof(
  client: QueryClient,
  scopeSql: string,
  params: Array<string | number | null>,
): Promise<CandidateSourceProofAudit> {
  const rows = await client.query<SourceProofRow>(
    `${scopeSql}
     SELECT
       (SELECT COUNT(DISTINCT cn.id)
          FROM audited_candidates ac
          JOIN candidate_nodes cn ON cn.candidate_id = ac.id) AS candidate_node_count,
       (SELECT COUNT(DISTINCT cn.id)
          FROM audited_candidates ac
          JOIN candidate_nodes cn ON cn.candidate_id = ac.id
         WHERE json_extract(cn.extracted_properties_json, '$.source_quote_validated') = 1) AS candidate_node_exact_source_quote_count,
       (SELECT COUNT(DISTINCT cn.id)
          FROM audited_candidates ac
          JOIN candidate_nodes cn ON cn.candidate_id = ac.id
         WHERE COALESCE(cn.confidence, 0) > 0
           AND cn.source_type = 'resume'
           AND COALESCE(json_extract(cn.extracted_properties_json, '$.source_quote_validated'), 0) <> 1
           AND (cn.source_reference IS NULL OR TRIM(cn.source_reference) = '')) AS candidate_node_without_exact_source_count,
       (SELECT COUNT(DISTINCT artifact_version_id)
          FROM source_artifact_versions) AS artifact_version_count,
       (SELECT COUNT(DISTINCT ss.id)
          FROM source_artifact_versions sav
          JOIN source_spans ss ON ss.artifact_version_id = sav.artifact_version_id) AS source_span_count,
       (SELECT COUNT(DISTINCT crsr.context_record_id || ':' || crsr.source_ref_type || ':' || crsr.source_ref_id || ':' || crsr.evidence_role)
          FROM linked_workspace_people lwp
          JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id
          JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id) AS context_source_ref_count`,
    params,
  );
  const row = rows[0];
  return {
    candidateNodeCount: toNumber(row?.candidate_node_count),
    candidateNodeExactSourceQuoteCount: toNumber(row?.candidate_node_exact_source_quote_count),
    candidateNodeWithoutExactSourceCount: toNumber(row?.candidate_node_without_exact_source_count),
    artifactVersionCount: toNumber(row?.artifact_version_count),
    sourceSpanCount: toNumber(row?.source_span_count),
    contextSourceRefCount: toNumber(row?.context_source_ref_count),
  };
}

async function loadPersonProjection(
  client: QueryClient,
  scopeSql: string,
  params: Array<string | number | null>,
): Promise<CandidatePersonProjectionAudit> {
  const rows = await client.query<ProjectionRow>(
    `${scopeSql}
     SELECT
       (SELECT COUNT(DISTINCT p.id)
          FROM linked_workspace_people lwp
          JOIN people p ON p.id = lwp.person_id) AS person_count,
       (SELECT COUNT(DISTINCT workspace_person_id)
          FROM linked_workspace_people) AS workspace_person_count,
       (SELECT COUNT(DISTINCT wp.id)
          FROM audited_candidates ac
          JOIN workspace_people wp
            ON json_extract(wp.context_json, '$.talentPool.candidateId') = ac.id
         WHERE json_extract(wp.context_json, '$.talentPool.status') = 'active') AS talent_pool_workspace_person_count,
       (SELECT COUNT(DISTINCT app.id)
          FROM audited_candidates ac
          JOIN candidates c ON c.id = ac.id
          JOIN applications app ON app.legacy_candidate_id = ac.id
         WHERE c.pipeline_id IS NULL) AS roleless_application_count,
       (SELECT COUNT(DISTINCT pr.id)
          FROM audited_candidates ac
          JOIN candidates c ON c.id = ac.id
          JOIN applications app ON app.legacy_candidate_id = ac.id
          JOIN person_roles pr ON pr.application_id = app.id
         WHERE c.pipeline_id IS NULL) AS roleless_person_role_count,
       (SELECT COUNT(DISTINCT cr.id)
          FROM linked_workspace_people lwp
          JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id) AS context_record_count,
       (SELECT COUNT(DISTINCT se.id)
          FROM linked_workspace_people lwp
          JOIN signal_evidence se ON se.workspace_person_id = lwp.workspace_person_id) AS signal_evidence_count,
       (SELECT COUNT(DISTINCT cca.id)
          FROM audited_candidates ac
          JOIN candidate_challenge_assignment cca ON cca.candidate_id = ac.id
         WHERE cca.github_repo_url IS NOT NULL
           AND cca.github_pr_number IS NOT NULL) AS ready_challenge_assignment_count,
       (SELECT COUNT(DISTINCT cdq.id)
          FROM audited_candidates ac
          JOIN challenge_design_queue cdq ON cdq.candidate_id = ac.id
         WHERE cdq.status IN ('queued', 'in_review', 'ready_to_assign')) AS design_queue_count`,
    params,
  );
  const row = rows[0];
  return {
    personCount: toNumber(row?.person_count),
    workspacePersonCount: toNumber(row?.workspace_person_count),
    talentPoolWorkspacePersonCount: toNumber(row?.talent_pool_workspace_person_count),
    rolelessApplicationCount: toNumber(row?.roleless_application_count),
    rolelessPersonRoleCount: toNumber(row?.roleless_person_role_count),
    contextRecordCount: toNumber(row?.context_record_count),
    signalEvidenceCount: toNumber(row?.signal_evidence_count),
    readyChallengeAssignmentCount: toNumber(row?.ready_challenge_assignment_count),
    designQueueCount: toNumber(row?.design_queue_count),
  };
}

async function loadSourceLessPositiveClaimCount(
  client: QueryClient,
  scopeSql: string,
  params: Array<string | number | null>,
): Promise<number> {
  return await count(
    client,
    `${scopeSql}
     SELECT (
       (SELECT COUNT(DISTINCT sa.id)
          FROM linked_workspace_people lwp
          JOIN semantic_assertions sa ON sa.workspace_person_id = lwp.workspace_person_id
         WHERE COALESCE(sa.polarity, 1) > 0
           AND NOT EXISTS (
             SELECT 1 FROM assertion_source_spans ass
              WHERE ass.assertion_id = sa.id
           ))
       +
       (SELECT COUNT(DISTINCT cr.id)
          FROM linked_workspace_people lwp
          JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id
         WHERE COALESCE(cr.polarity, 1) > 0
           AND NOT EXISTS (
             SELECT 1 FROM context_record_source_refs crsr
              WHERE crsr.context_record_id = cr.id
           ))
       +
       (SELECT COUNT(DISTINCT se.id)
          FROM linked_workspace_people lwp
          JOIN signal_evidence se ON se.workspace_person_id = lwp.workspace_person_id
         WHERE COALESCE(se.strength, 0) > 0
           AND NOT EXISTS (
             SELECT 1 FROM assertion_source_spans ass
              WHERE ass.assertion_id = se.assertion_id
           ))
     ) AS count`,
    params,
  );
}

async function loadDuplicateProjectedEdgeCount(
  client: QueryClient,
  scopeSql: string,
  params: Array<string | number | null>,
): Promise<number> {
  return await count(
    client,
    `${scopeSql}
     SELECT COUNT(*) AS count
       FROM (
         SELECT cr.workspace_person_id, cr.record_type, cr.predicate, cr.narrative,
                crsr.source_ref_type, crsr.source_ref_id, crsr.evidence_role,
                COUNT(*) AS duplicate_count
           FROM linked_workspace_people lwp
           JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id
           JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
          GROUP BY cr.workspace_person_id, cr.record_type, cr.predicate, cr.narrative,
                   crsr.source_ref_type, crsr.source_ref_id, crsr.evidence_role
         HAVING COUNT(*) > 1
       )`,
    params,
  );
}

export async function auditCandidateIngestion(
  client: QueryClient,
  options: CandidateIngestionAuditOptions = {},
): Promise<CandidateIngestionAudit> {
  const missingTables: string[] = [];
  for (const tableName of REQUIRED_TABLES) {
    if (!await tableExists(client, tableName)) missingTables.push(tableName);
  }

  const emptyReport = {
    rawCapture: {
      talentPoolIntakeCount: 0,
      submittedIntakeCount: 0,
      profileStorageKeyCount: 0,
      profileTextExcerptCount: 0,
      externalProfileRefCount: 0,
      phoneScreenerIntentCount: 0,
    },
    ingestionState: {
      rowCount: 0,
      statuses: [],
    },
    sourceProof: {
      candidateNodeCount: 0,
      candidateNodeExactSourceQuoteCount: 0,
      candidateNodeWithoutExactSourceCount: 0,
      artifactVersionCount: 0,
      sourceSpanCount: 0,
      contextSourceRefCount: 0,
    },
    personProjection: {
      personCount: 0,
      workspacePersonCount: 0,
      talentPoolWorkspacePersonCount: 0,
      rolelessApplicationCount: 0,
      rolelessPersonRoleCount: 0,
      contextRecordCount: 0,
      signalEvidenceCount: 0,
      readyChallengeAssignmentCount: 0,
      designQueueCount: 0,
    },
  };

  const base = {
    checkedAt: new Date().toISOString(),
    scope: {
      candidateId: options.candidateId ?? null,
      inviteToken: options.inviteToken ?? null,
      email: options.email ?? null,
      requireContextRecords: options.requireContextRecords === true,
    },
  };

  if (missingTables.length > 0) {
    return {
      ...base,
      status: 'not_ready',
      auditedCandidateCount: 0,
      missingTables,
      ...emptyReport,
      sourceLessPositiveClaimCount: 0,
      duplicateProjectedEdgeCount: 0,
      failures: [`missing candidate-ingestion tables: ${missingTables.join(', ')}`],
      nextActions: ['Apply Talent Pool, living-context, and context-record migrations before auditing candidate ingestion.'],
    };
  }

  const scopeDefinition = candidateScope(options);
  const auditedCandidateCount = await count(
    client,
    `${scopeDefinition.cte}
     SELECT COUNT(*) AS count FROM audited_candidates`,
    scopeDefinition.params,
  );

  const rawCapture = await loadRawCapture(client, scopeDefinition.cte, scopeDefinition.params);
  const ingestionState = await loadIngestionState(client, scopeDefinition.cte, scopeDefinition.params);
  const sourceProof = await loadSourceProof(client, scopeDefinition.cte, scopeDefinition.params);
  const personProjection = await loadPersonProjection(client, scopeDefinition.cte, scopeDefinition.params);
  const sourceLessPositiveClaimCount = await loadSourceLessPositiveClaimCount(
    client,
    scopeDefinition.cte,
    scopeDefinition.params,
  );
  const duplicateProjectedEdgeCount = await loadDuplicateProjectedEdgeCount(
    client,
    scopeDefinition.cte,
    scopeDefinition.params,
  );

  const failures = [
    ...(scoped(options) && auditedCandidateCount === 0
      ? ['no candidate matched the requested audit scope']
      : []),
    ...(rawCapture.submittedIntakeCount > rawCapture.profileStorageKeyCount
      ? [`${rawCapture.submittedIntakeCount - rawCapture.profileStorageKeyCount} submitted Talent Pool intake(s) lack a profile storage key`]
      : []),
    ...(rawCapture.submittedIntakeCount > ingestionState.rowCount
      ? [`${rawCapture.submittedIntakeCount - ingestionState.rowCount} submitted Talent Pool intake(s) lack candidate_ingestion state`]
      : []),
    ...(rawCapture.submittedIntakeCount > personProjection.talentPoolWorkspacePersonCount
      ? [`${rawCapture.submittedIntakeCount - personProjection.talentPoolWorkspacePersonCount} submitted Talent Pool intake(s) lack active workspace_people Talent Pool projection`]
      : []),
    ...(rawCapture.submittedIntakeCount > 0
      && sourceProof.sourceSpanCount === 0
      && sourceProof.candidateNodeExactSourceQuoteCount === 0
      ? ['submitted Talent Pool profile evidence has no exact source spans or exact candidate-node quotes']
      : []),
    ...(sourceProof.candidateNodeWithoutExactSourceCount > 0
      ? [`${sourceProof.candidateNodeWithoutExactSourceCount} positive candidate node(s) lack an exact validated resume source quote`]
      : []),
    ...(sourceLessPositiveClaimCount > 0
      ? [`${sourceLessPositiveClaimCount} positive person-context claim(s) have no source refs or source spans`]
      : []),
    ...(duplicateProjectedEdgeCount > 0
      ? [`${duplicateProjectedEdgeCount} duplicate person-projected context edge group(s) were found`]
      : []),
    ...(personProjection.rolelessApplicationCount > 0
      ? [`${personProjection.rolelessApplicationCount} roleless Talent Pool candidate(s) have application rows before a role-backed process exists`]
      : []),
    ...(personProjection.rolelessPersonRoleCount > 0
      ? [`${personProjection.rolelessPersonRoleCount} roleless Talent Pool candidate role row(s) exist before a role-backed process exists`]
      : []),
    ...(options.requireContextRecords === true && rawCapture.submittedIntakeCount > personProjection.contextRecordCount
      ? [`${rawCapture.submittedIntakeCount - personProjection.contextRecordCount} submitted Talent Pool intake(s) lack person context records`]
      : []),
  ];

  const nextActions = [
    ...(auditedCandidateCount === 0 && !scoped(options)
      ? ['Submit at least one Talent Pool candidate through /talent/:token before expecting audit proof.']
      : []),
    ...(rawCapture.submittedIntakeCount > 0 && sourceProof.sourceSpanCount === 0
      ? ['Replay or repair profile ingestion so pasted text and extracted uploads create artifact_versions and source_spans.']
      : []),
    ...(sourceProof.candidateNodeWithoutExactSourceCount > 0
      ? ['Repair candidate-node decomposition so positive nodes carry validated source_quote offsets or remain non-projecting diagnostics.']
      : []),
    ...(rawCapture.externalProfileRefCount > 0 && sourceProof.contextSourceRefCount === 0
      ? ['Project GitHub/LinkedIn/portfolio refs into context records only when exact intake source refs survive.']
      : []),
    ...(rawCapture.phoneScreenerIntentCount > 0 && sourceProof.contextSourceRefCount === 0
      ? ['Project phone screener intent as operational context with source refs instead of a default profile claim.']
      : []),
    ...(personProjection.readyChallengeAssignmentCount === 0 && personProjection.designQueueCount > 0
      ? ['Challenge readiness is correctly still a design-queue gap; do not expose a ready assessment until a source-backed assignment exists.']
      : []),
    ...(personProjection.contextRecordCount === 0
      ? ['Run candidate profile/resume projection or retry background ingestion if person read models need claim-level context now.']
      : []),
  ];

  return {
    ...base,
    status: failures.length === 0 ? 'ready' : 'not_ready',
    auditedCandidateCount,
    missingTables,
    rawCapture,
    ingestionState,
    sourceProof,
    personProjection,
    sourceLessPositiveClaimCount,
    duplicateProjectedEdgeCount,
    failures,
    nextActions: [...new Set(nextActions)],
  };
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/auditCandidateIngestion.ts [options]',
    '',
    'Options:',
    '  --local                   Audit local Wrangler D1 database (default)',
    '  --remote                  Audit Cloudflare D1 via REST',
    '  --database-path PATH      Override local SQLite discovery',
    '  --candidate-id ID         Limit audit to one candidate id',
    '  --invite-token TOKEN      Limit audit to one Talent Pool invite token',
    '  --email EMAIL             Limit audit to one candidate email',
    '  --require-context-records Fail when submitted intakes lack person context records',
    '  --json                    Print machine-readable JSON',
    '  --help, -h                Show this help',
  ].join('\n');
}

interface CliOptions extends CandidateIngestionAuditOptions {
  target: 'local' | 'remote';
  databasePath?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { target: 'local', json: false, requireContextRecords: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--local') {
      options.target = 'local';
    } else if (arg === '--remote') {
      options.target = 'remote';
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--require-context-records') {
      options.requireContextRecords = true;
    } else if (arg === '--candidate-id' || arg.startsWith('--candidate-id=')) {
      const inline = arg.match(/^--candidate-id=(.+)$/)?.[1];
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--candidate-id requires a value');
      options.candidateId = value;
    } else if (arg === '--invite-token' || arg.startsWith('--invite-token=')) {
      const inline = arg.match(/^--invite-token=(.+)$/)?.[1];
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--invite-token requires a value');
      options.inviteToken = value;
    } else if (arg === '--email' || arg.startsWith('--email=')) {
      const inline = arg.match(/^--email=(.+)$/)?.[1];
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--email requires a value');
      options.email = value;
    } else if (arg === '--database-path' || arg.startsWith('--database-path=')) {
      const inline = arg.match(/^--database-path=(.+)$/)?.[1];
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--database-path requires a value');
      options.databasePath = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.target === 'remote' && options.databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  return options;
}

function openLocalDatabase(databasePath?: string): { database: LocalSqliteDatabase; path: string } {
  const require = createRequire(import.meta.url);
  const BetterSqlite3 = require('better-sqlite3') as new (path: string) => LocalSqliteDatabase;
  const resolvedPath = databasePath
    ? (isAbsolute(databasePath) ? databasePath : resolve(apiRoot, databasePath))
    : (() => {
        const directory = resolve(apiRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
        const candidates = readdirSync(directory)
          .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
          .map((name) => resolve(directory, name));
        if (candidates.length !== 1) {
          throw new Error(
            `Expected one local D1 database; pass --database-path. Found: ${candidates.join(', ') || 'none'}`,
          );
        }
        return candidates[0]!;
      })();
  return { database: new BetterSqlite3(resolvedPath), path: resolvedPath };
}

function printHuman(report: CandidateIngestionAudit, databasePath: string): void {
  console.log('candidate ingestion audit');
  console.log(`  status:                ${report.status}`);
  console.log(`  database:              ${databasePath}`);
  console.log(`  candidate scope:       ${report.scope.candidateId ?? report.scope.inviteToken ?? report.scope.email ?? 'all talent pool intakes'}`);
  console.log(`  candidates audited:    ${report.auditedCandidateCount}`);
  console.log(`  source-less positives: ${report.sourceLessPositiveClaimCount}`);
  console.log(`  duplicate projections: ${report.duplicateProjectedEdgeCount}`);
  console.log('');
  console.log('Raw capture:');
  console.log(`  intakes:               ${report.rawCapture.talentPoolIntakeCount}`);
  console.log(`  submitted:             ${report.rawCapture.submittedIntakeCount}`);
  console.log(`  storage keys:          ${report.rawCapture.profileStorageKeyCount}`);
  console.log(`  external refs:         ${report.rawCapture.externalProfileRefCount}`);
  console.log(`  phone intent:          ${report.rawCapture.phoneScreenerIntentCount}`);
  console.log('');
  console.log('Source proof:');
  console.log(`  candidate nodes:       ${report.sourceProof.candidateNodeCount}`);
  console.log(`  exact node quotes:     ${report.sourceProof.candidateNodeExactSourceQuoteCount}`);
  console.log(`  node quote gaps:       ${report.sourceProof.candidateNodeWithoutExactSourceCount}`);
  console.log(`  artifact versions:     ${report.sourceProof.artifactVersionCount}`);
  console.log(`  source spans:          ${report.sourceProof.sourceSpanCount}`);
  console.log(`  context source refs:   ${report.sourceProof.contextSourceRefCount}`);
  console.log('');
  console.log('Person projection:');
  console.log(`  people:                ${report.personProjection.personCount}`);
  console.log(`  workspace people:      ${report.personProjection.workspacePersonCount}`);
  console.log(`  context records:       ${report.personProjection.contextRecordCount}`);
  console.log(`  signal evidence:       ${report.personProjection.signalEvidenceCount}`);
  console.log(`  ready assignments:     ${report.personProjection.readyChallengeAssignmentCount}`);
  console.log(`  design queue:          ${report.personProjection.designQueueCount}`);
  if (report.failures.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const failure of report.failures) console.log(`- ${failure}`);
  }
  if (report.nextActions.length > 0) {
    console.log('');
    console.log('Next actions:');
    for (const action of report.nextActions) console.log(`- ${action}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const opened = options.target === 'local' ? openLocalDatabase(options.databasePath) : null;
  const database = opened?.database;
  try {
    const client: QueryClient = database ? new LocalQueryClient(database) : new D1Client(loadD1Config());
    const report = await auditCandidateIngestion(client, {
      candidateId: options.candidateId,
      inviteToken: options.inviteToken,
      email: options.email,
      requireContextRecords: options.requireContextRecords,
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHuman(report, opened?.path ?? 'remote');
    }
    if (report.status !== 'ready') process.exitCode = 1;
  } finally {
    database?.close();
  }
}

if (process.argv[1]?.endsWith('auditCandidateIngestion.ts')) {
  main().catch((error) => {
    console.error('[auditCandidateIngestion] Fatal:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
