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
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeMatchedOpenSourcePacket } from '../src/lib/openSourceChallengeSessions';
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
  contentAddressedProfileStorageKeyCount: number;
  nonContentAddressedProfileStorageKeyCount: number;
  candidateResumeStorageKeyCount: number;
  candidateResumeMatchesIntakeCount: number;
  documentProfileStorageKeyCount: number;
  profileTextExcerptCount: number;
  externalProfileRefCount: number;
  phoneScreenerIntentCount: number;
}

export interface CandidateIngestionStateAudit {
  rowCount: number;
  statuses: Array<{ status: string; count: number }>;
  steps: Array<{ currentStep: string; count: number }>;
  failedRowCount: number;
  errorTextRowCount: number;
}

export interface CandidateSourceProofAudit {
  candidateNodeCount: number;
  candidateNodeExactSourceQuoteCount: number;
  submittedIntakeWithoutExactCandidateNodeCount: number;
  candidateNodeWithoutExactSourceCount: number;
  duplicateCandidateNodeEvidenceCount: number;
  candidateNodeSourceAnchorConflictCount: number;
  artifactVersionCount: number;
  sourceSpanCount: number;
  sourceSpanTextMismatchCount: number;
  sourceSpanHashMismatchCount: number;
  documentProfileSourceSpanCount: number;
  profileUploadArtifactVersionCount: number;
  contextSourceRefCount: number;
}

export interface CandidatePersonProjectionAudit {
  personCount: number;
  workspacePersonCount: number;
  talentPoolWorkspacePersonCount: number;
  rolelessApplicationCount: number;
  rolelessPersonRoleCount: number;
  contextRecordCount: number;
  externalProfileRefContextCount: number;
  missingExternalProfileRefContextCount: number;
  phoneScreenerIntentContextCount: number;
  missingPhoneScreenerIntentContextCount: number;
  signalEvidenceCount: number;
  readyChallengeAssignmentCount: number;
  unprovenChallengeAssignmentCount: number;
  incompleteChallengeAssignmentCount: number;
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
  sourceLessDesignQueueSuggestionCount: number;
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

interface CurrentStepRow {
  current_step: string | null;
  count: number;
}

interface IngestionStateSummaryRow {
  failed_row_count: number | null;
  error_text_row_count: number | null;
}

interface RawCaptureRow {
  talent_pool_intake_count: number | null;
  submitted_intake_count: number | null;
  profile_storage_key_count: number | null;
  content_addressed_profile_storage_key_count: number | null;
  non_content_addressed_profile_storage_key_count: number | null;
  candidate_resume_storage_key_count: number | null;
  candidate_resume_matches_intake_count: number | null;
  document_profile_storage_key_count: number | null;
  profile_text_excerpt_count: number | null;
  external_profile_ref_count: number | null;
  phone_screener_intent_count: number | null;
}

interface SourceProofRow {
  candidate_node_count: number | null;
  candidate_node_exact_source_quote_count: number | null;
  submitted_intake_without_exact_candidate_node_count: number | null;
  candidate_node_without_exact_source_count: number | null;
  duplicate_candidate_node_evidence_count: number | null;
  candidate_node_source_anchor_conflict_count: number | null;
  artifact_version_count: number | null;
  source_span_count: number | null;
  source_span_text_mismatch_count: number | null;
  document_profile_source_span_count: number | null;
  profile_upload_artifact_version_count: number | null;
  context_source_ref_count: number | null;
}

interface SourceSpanHashRow {
  exact_text: string | null;
  exact_text_hash: string | null;
}

interface ProjectionRow {
  person_count: number | null;
  workspace_person_count: number | null;
  talent_pool_workspace_person_count: number | null;
  roleless_application_count: number | null;
  roleless_person_role_count: number | null;
  context_record_count: number | null;
  external_profile_ref_context_count: number | null;
  missing_external_profile_ref_context_count: number | null;
  phone_screener_intent_context_count: number | null;
  missing_phone_screener_intent_context_count: number | null;
  signal_evidence_count: number | null;
  design_queue_count: number | null;
}

interface ChallengeAssignmentProofRow {
  assignment_id: string | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
  id: string | null;
  repo_snapshot_id: string | null;
  pr_number: number | null;
  source_hash: string | null;
  packet_json: string | null;
  github_url: string | null;
  quality_score: number | null;
  context_record_id: string | null;
  repo_source_ref_count: number | null;
  concept_link_count: number | null;
}

interface ChallengeAssignmentProofCounts {
  readyChallengeAssignmentCount: number;
  unprovenChallengeAssignmentCount: number;
  incompleteChallengeAssignmentCount: number;
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
  'context_record_concepts',
  'challenge_design_queue',
  'candidate_challenge_assignment',
  'qualified_repos',
  'review_challenge_packets',
];

function toNumber(value: number | null | undefined): number {
  return Number(value ?? 0);
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
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
  const profileKeyPrefix = "'talent-intake/' || t.candidate_id || '/'";
  const profileKeyHash = `LOWER(substr(t.profile_r2_key, LENGTH(${profileKeyPrefix}) + 1, 64))`;
  const nonHexProfileKeyHashCharacters = [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
  ].reduce((expression, character) => `REPLACE(${expression}, '${character}', '')`, profileKeyHash);
  const contentAddressedProfileKeyPredicate = `
    substr(t.profile_r2_key, 1, LENGTH(${profileKeyPrefix})) = ${profileKeyPrefix}
    AND LENGTH(substr(t.profile_r2_key, LENGTH(${profileKeyPrefix}) + 1, 64)) = 64
    AND LENGTH(${nonHexProfileKeyHashCharacters}) = 0
    AND substr(t.profile_r2_key, LENGTH(${profileKeyPrefix}) + 65, 1) = '-'
  `;
  const rows = await client.query<RawCaptureRow>(
    `${scopeSql}
     SELECT
       COUNT(DISTINCT t.candidate_id) AS talent_pool_intake_count,
       COUNT(DISTINCT CASE WHEN t.submitted_at IS NOT NULL THEN t.candidate_id END) AS submitted_intake_count,
       COUNT(DISTINCT CASE WHEN t.profile_r2_key IS NOT NULL AND TRIM(t.profile_r2_key) <> '' THEN t.candidate_id END) AS profile_storage_key_count,
       COUNT(DISTINCT CASE
         WHEN t.profile_r2_key IS NOT NULL
          AND TRIM(t.profile_r2_key) <> ''
          AND ${contentAddressedProfileKeyPredicate}
         THEN t.candidate_id
       END) AS content_addressed_profile_storage_key_count,
       COUNT(DISTINCT CASE
         WHEN t.profile_r2_key IS NOT NULL
          AND TRIM(t.profile_r2_key) <> ''
          AND NOT (${contentAddressedProfileKeyPredicate})
         THEN t.candidate_id
       END) AS non_content_addressed_profile_storage_key_count,
       COUNT(DISTINCT CASE
         WHEN t.submitted_at IS NOT NULL
          AND c.resume_s3_key IS NOT NULL
          AND TRIM(c.resume_s3_key) <> ''
         THEN t.candidate_id
       END) AS candidate_resume_storage_key_count,
       COUNT(DISTINCT CASE
         WHEN t.submitted_at IS NOT NULL
          AND t.profile_r2_key IS NOT NULL
          AND TRIM(t.profile_r2_key) <> ''
          AND c.resume_s3_key = t.profile_r2_key
         THEN t.candidate_id
       END) AS candidate_resume_matches_intake_count,
       COUNT(DISTINCT CASE
         WHEN t.profile_r2_key IS NOT NULL
          AND (
            substr(LOWER(t.profile_r2_key), -4) = '.pdf'
            OR substr(LOWER(t.profile_r2_key), -5) = '.docx'
          )
         THEN t.candidate_id
       END) AS document_profile_storage_key_count,
       COUNT(DISTINCT CASE WHEN t.profile_text_excerpt IS NOT NULL AND TRIM(t.profile_text_excerpt) <> '' THEN t.candidate_id END) AS profile_text_excerpt_count,
       SUM(
         CASE WHEN t.github_url IS NOT NULL AND TRIM(t.github_url) <> '' THEN 1 ELSE 0 END
         + CASE WHEN t.linkedin_url IS NOT NULL AND TRIM(t.linkedin_url) <> '' THEN 1 ELSE 0 END
         + CASE WHEN t.portfolio_url IS NOT NULL AND TRIM(t.portfolio_url) <> '' THEN 1 ELSE 0 END
       ) AS external_profile_ref_count,
       COUNT(DISTINCT CASE WHEN t.phone_screener_consent = 1 THEN t.candidate_id END) AS phone_screener_intent_count
      FROM audited_candidates ac
      JOIN candidates c ON c.id = ac.id
      LEFT JOIN talent_pool_intakes t ON t.candidate_id = ac.id`,
    params,
  );
  const row = rows[0];
  return {
    talentPoolIntakeCount: toNumber(row?.talent_pool_intake_count),
    submittedIntakeCount: toNumber(row?.submitted_intake_count),
    profileStorageKeyCount: toNumber(row?.profile_storage_key_count),
    contentAddressedProfileStorageKeyCount: toNumber(row?.content_addressed_profile_storage_key_count),
    nonContentAddressedProfileStorageKeyCount: toNumber(row?.non_content_addressed_profile_storage_key_count),
    candidateResumeStorageKeyCount: toNumber(row?.candidate_resume_storage_key_count),
    candidateResumeMatchesIntakeCount: toNumber(row?.candidate_resume_matches_intake_count),
    documentProfileStorageKeyCount: toNumber(row?.document_profile_storage_key_count),
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
  const steps = await client.query<CurrentStepRow>(
    `${scopeSql}
     SELECT COALESCE(NULLIF(TRIM(ci.current_step), ''), 'missing') AS current_step,
            COUNT(*) AS count
       FROM audited_candidates ac
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = ac.id
      GROUP BY COALESCE(NULLIF(TRIM(ci.current_step), ''), 'missing')
      ORDER BY current_step`,
    params,
  );
  const summaryRows = await client.query<IngestionStateSummaryRow>(
    `${scopeSql}
     SELECT
       COUNT(DISTINCT CASE WHEN ci.status = 'failed' THEN ci.candidate_id END) AS failed_row_count,
       COUNT(DISTINCT CASE
         WHEN ci.error_text IS NOT NULL
          AND TRIM(ci.error_text) <> ''
         THEN ci.candidate_id
       END) AS error_text_row_count
       FROM audited_candidates ac
       JOIN talent_pool_intakes t ON t.candidate_id = ac.id
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = ac.id
      WHERE t.submitted_at IS NOT NULL`,
    params,
  );
  const summary = summaryRows[0];
  return {
    rowCount,
    statuses: statuses.map((row) => ({
      status: row.status ?? 'missing',
      count: toNumber(row.count),
    })),
    steps: steps.map((row) => ({
      currentStep: row.current_step ?? 'missing',
      count: toNumber(row.count),
    })),
    failedRowCount: toNumber(summary?.failed_row_count),
    errorTextRowCount: toNumber(summary?.error_text_row_count),
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
          JOIN candidate_nodes cn ON cn.candidate_id = ac.id
         WHERE cn.superseded_at IS NULL) AS candidate_node_count,
       (SELECT COUNT(DISTINCT cn.id)
          FROM audited_candidates ac
          JOIN candidate_nodes cn ON cn.candidate_id = ac.id
         WHERE cn.superseded_at IS NULL
           AND json_extract(cn.extracted_properties_json, '$.source_quote_validated') = 1) AS candidate_node_exact_source_quote_count,
       (SELECT COUNT(DISTINCT ac.id)
          FROM audited_candidates ac
          JOIN talent_pool_intakes t ON t.candidate_id = ac.id
         WHERE t.submitted_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
               FROM candidate_nodes cn
              WHERE cn.candidate_id = ac.id
                AND cn.superseded_at IS NULL
                AND json_extract(cn.extracted_properties_json, '$.source_quote_validated') = 1
           )) AS submitted_intake_without_exact_candidate_node_count,
       (SELECT COUNT(DISTINCT cn.id)
          FROM audited_candidates ac
          JOIN candidate_nodes cn ON cn.candidate_id = ac.id
         WHERE cn.superseded_at IS NULL
           AND COALESCE(cn.confidence, 0) > 0
           AND cn.source_type = 'resume'
           AND COALESCE(json_extract(cn.extracted_properties_json, '$.source_quote_validated'), 0) <> 1
           AND (cn.source_reference IS NULL OR TRIM(cn.source_reference) = '')) AS candidate_node_without_exact_source_count,
       (SELECT COUNT(*) FROM (
          SELECT
            cn.candidate_id,
            cn.node_type,
            cn.source_type,
            COALESCE(cn.source_reference, '') AS source_reference,
            COALESCE(json_extract(cn.extracted_properties_json, '$.source_span_id'), '') AS source_span_id,
            COALESCE(json_extract(cn.extracted_properties_json, '$.exact_text_hash'), '') AS exact_text_hash,
            COALESCE(json_extract(cn.extracted_properties_json, '$.source_quote_char_start'), '') AS source_quote_char_start,
            COALESCE(json_extract(cn.extracted_properties_json, '$.source_quote_char_end'), '') AS source_quote_char_end,
            COALESCE(json_extract(cn.extracted_properties_json, '$.term_canonical_key'), '') || '|' ||
            COALESCE(json_extract(cn.extracted_properties_json, '$.canonical_slug'), '') || '|' ||
            COALESCE(json_extract(cn.extracted_properties_json, '$.name'), '') || '|' ||
            COALESCE(json_extract(cn.extracted_properties_json, '$.company'), '') || '|' ||
            COALESCE(json_extract(cn.extracted_properties_json, '$.role'), '') || '|' ||
            COALESCE(json_extract(cn.extracted_properties_json, '$.institution'), '') || '|' ||
            COALESCE(json_extract(cn.extracted_properties_json, '$.degree'), '') || '|' ||
            COALESCE(cn.narrative_text, '') AS extracted_fact_key,
            COUNT(*) AS duplicate_count
          FROM audited_candidates ac
          JOIN candidate_nodes cn ON cn.candidate_id = ac.id
         WHERE cn.superseded_at IS NULL
           AND COALESCE(cn.confidence, 0) > 0
         GROUP BY
            cn.candidate_id,
            cn.node_type,
            cn.source_type,
            COALESCE(cn.source_reference, ''),
            COALESCE(json_extract(cn.extracted_properties_json, '$.source_span_id'), ''),
            COALESCE(json_extract(cn.extracted_properties_json, '$.exact_text_hash'), ''),
            COALESCE(json_extract(cn.extracted_properties_json, '$.source_quote_char_start'), ''),
            COALESCE(json_extract(cn.extracted_properties_json, '$.source_quote_char_end'), ''),
            extracted_fact_key
        HAVING COUNT(*) > 1
       )) AS duplicate_candidate_node_evidence_count,
       (SELECT COUNT(*) FROM (
          SELECT
            cn.candidate_id,
            cn.node_type,
            json_extract(cn.extracted_properties_json, '$.source_quote_char_start') AS source_quote_char_start,
            json_extract(cn.extracted_properties_json, '$.source_quote_char_end') AS source_quote_char_end,
            COUNT(DISTINCT
              COALESCE(json_extract(cn.extracted_properties_json, '$.company'), '') || '|' ||
              COALESCE(json_extract(cn.extracted_properties_json, '$.role'), '') || '|' ||
              COALESCE(json_extract(cn.extracted_properties_json, '$.name'), '') || '|' ||
              COALESCE(json_extract(cn.extracted_properties_json, '$.institution'), '') || '|' ||
              COALESCE(json_extract(cn.extracted_properties_json, '$.degree'), '')
            ) AS extracted_fact_count
          FROM audited_candidates ac
          JOIN candidate_nodes cn ON cn.candidate_id = ac.id
         WHERE cn.superseded_at IS NULL
           AND cn.source_type = 'resume'
           AND cn.node_type IN ('Experience', 'Project', 'Education', 'Credential')
           AND json_extract(cn.extracted_properties_json, '$.source_quote_validated') = 1
         GROUP BY
            cn.candidate_id,
            cn.node_type,
            json_extract(cn.extracted_properties_json, '$.source_quote_char_start'),
            json_extract(cn.extracted_properties_json, '$.source_quote_char_end')
        HAVING COUNT(*) > 1
           AND extracted_fact_count > 1
       )) AS candidate_node_source_anchor_conflict_count,
       (SELECT COUNT(DISTINCT artifact_version_id)
          FROM source_artifact_versions) AS artifact_version_count,
       (SELECT COUNT(DISTINCT ss.id)
          FROM source_artifact_versions sav
          JOIN source_spans ss ON ss.artifact_version_id = sav.artifact_version_id) AS source_span_count,
       (SELECT COUNT(DISTINCT ss.id)
          FROM source_artifact_versions sav
          JOIN artifact_versions av ON av.id = sav.artifact_version_id
          JOIN source_spans ss ON ss.artifact_version_id = av.id
         WHERE av.content_text IS NOT NULL
           AND ss.char_start IS NOT NULL
           AND ss.char_end IS NOT NULL
           AND ss.exact_text <> substr(av.content_text, ss.char_start + 1, ss.char_end - ss.char_start)) AS source_span_text_mismatch_count,
       (SELECT COUNT(DISTINCT ss.id)
          FROM audited_candidates ac
          JOIN talent_pool_intakes t ON t.candidate_id = ac.id
          JOIN artifact_versions av ON av.storage_key = t.profile_r2_key
          JOIN source_spans ss ON ss.artifact_version_id = av.id
         WHERE t.profile_r2_key IS NOT NULL
           AND (
             substr(LOWER(t.profile_r2_key), -4) = '.pdf'
             OR substr(LOWER(t.profile_r2_key), -5) = '.docx'
           )) AS document_profile_source_span_count,
       (SELECT COUNT(DISTINCT av.id)
          FROM audited_candidates ac
          JOIN talent_pool_intakes t ON t.candidate_id = ac.id
          JOIN linked_workspace_people lwp ON lwp.candidate_id = ac.id
          JOIN artifacts a ON a.workspace_person_id = lwp.workspace_person_id
          JOIN artifact_versions av ON av.artifact_id = a.id
         WHERE t.profile_r2_key IS NOT NULL
           AND av.storage_key = t.profile_r2_key
           AND (
             a.artifact_type = 'profile_upload'
             OR a.logical_key = 'roleless_candidate_profile_upload'
             OR json_extract(a.metadata_json, '$.evidenceKind') = 'profile_upload_source'
           )) AS profile_upload_artifact_version_count,
       (SELECT COUNT(DISTINCT crsr.context_record_id || ':' || crsr.source_ref_type || ':' || crsr.source_ref_id || ':' || crsr.evidence_role)
          FROM linked_workspace_people lwp
          JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id
          JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id) AS context_source_ref_count`,
    params,
  );
  const row = rows[0];
  const sourceSpanHashMismatchCount = await loadSourceSpanHashMismatchCount(client, scopeSql, params);
  return {
    candidateNodeCount: toNumber(row?.candidate_node_count),
    candidateNodeExactSourceQuoteCount: toNumber(row?.candidate_node_exact_source_quote_count),
    submittedIntakeWithoutExactCandidateNodeCount: toNumber(row?.submitted_intake_without_exact_candidate_node_count),
    candidateNodeWithoutExactSourceCount: toNumber(row?.candidate_node_without_exact_source_count),
    duplicateCandidateNodeEvidenceCount: toNumber(row?.duplicate_candidate_node_evidence_count),
    candidateNodeSourceAnchorConflictCount: toNumber(row?.candidate_node_source_anchor_conflict_count),
    artifactVersionCount: toNumber(row?.artifact_version_count),
    sourceSpanCount: toNumber(row?.source_span_count),
    sourceSpanTextMismatchCount: toNumber(row?.source_span_text_mismatch_count),
    sourceSpanHashMismatchCount,
    documentProfileSourceSpanCount: toNumber(row?.document_profile_source_span_count),
    profileUploadArtifactVersionCount: toNumber(row?.profile_upload_artifact_version_count),
    contextSourceRefCount: toNumber(row?.context_source_ref_count),
  };
}

async function loadSourceSpanHashMismatchCount(
  client: QueryClient,
  scopeSql: string,
  params: Array<string | number | null>,
): Promise<number> {
  const rows = await client.query<SourceSpanHashRow>(
    `${scopeSql}
     SELECT ss.exact_text, ss.exact_text_hash
       FROM source_artifact_versions sav
       JOIN source_spans ss ON ss.artifact_version_id = sav.artifact_version_id
      WHERE ss.exact_text_hash IS NOT NULL
        AND TRIM(ss.exact_text_hash) <> ''`,
    params,
  );
  return rows.filter((row) => sha256Hex(row.exact_text ?? '') !== row.exact_text_hash?.toLowerCase()).length;
}

async function loadChallengeAssignmentProofCounts(
  client: QueryClient,
  scopeSql: string,
  params: Array<string | number | null>,
): Promise<ChallengeAssignmentProofCounts> {
  const rows = await client.query<ChallengeAssignmentProofRow>(
    `${scopeSql}
     SELECT cca.id AS assignment_id,
            cca.github_repo_url,
            cca.github_pr_number,
            rcp.id,
            rcp.repo_snapshot_id,
            rcp.pr_number,
            rcp.source_hash,
            rcp.packet_json,
            rcp.quality_score,
            qr.github_url,
            cr.id AS context_record_id,
            (
              SELECT COUNT(*)
                FROM context_record_source_refs crsr
               WHERE crsr.context_record_id = cr.id
                 AND crsr.source_ref_type = 'repo_source_span'
            ) AS repo_source_ref_count,
            (
              SELECT COUNT(*)
                FROM context_record_concepts crc
               WHERE crc.context_record_id = cr.id
            ) AS concept_link_count
       FROM audited_candidates ac
       JOIN candidate_challenge_assignment cca ON cca.candidate_id = ac.id
       LEFT JOIN qualified_repos qr ON qr.github_url = cca.github_repo_url
       LEFT JOIN review_challenge_packets rcp
         ON rcp.repo_id = qr.id
        AND rcp.pr_number = cca.github_pr_number
        AND rcp.production_ready = 1
        AND rcp.quality_score >= 0.70
       LEFT JOIN context_records cr
         ON cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
        AND cr.scope_type = 'repo_snapshot'
        AND cr.scope_id = rcp.repo_snapshot_id
        AND cr.record_type = 'repo_challenge_packet'`,
    params,
  );

  const completeAssignmentIds = new Set<string>();
  const incompleteAssignmentIds = new Set<string>();
  const sourceBackedAssignmentIds = new Set<string>();

  for (const row of rows) {
    if (!row.assignment_id) continue;
    if (!row.github_repo_url || row.github_pr_number === null) {
      incompleteAssignmentIds.add(row.assignment_id);
      continue;
    }

    completeAssignmentIds.add(row.assignment_id);
    if (!row.id || !row.packet_json) continue;
    const packet = materializeMatchedOpenSourcePacket({
      id: row.id,
      repo_snapshot_id: row.repo_snapshot_id,
      pr_number: row.pr_number,
      source_hash: row.source_hash,
      packet_json: row.packet_json,
      github_url: row.github_url,
      quality_score: row.quality_score,
      context_record_id: row.context_record_id,
      repo_source_ref_count: row.repo_source_ref_count,
      concept_link_count: row.concept_link_count,
    });
    if (packet) sourceBackedAssignmentIds.add(row.assignment_id);
  }

  return {
    readyChallengeAssignmentCount: sourceBackedAssignmentIds.size,
    unprovenChallengeAssignmentCount: [...completeAssignmentIds]
      .filter((assignmentId) => !sourceBackedAssignmentIds.has(assignmentId)).length,
    incompleteChallengeAssignmentCount: incompleteAssignmentIds.size,
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
       (SELECT COUNT(DISTINCT cr.id)
          FROM linked_workspace_people lwp
          JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id
         WHERE cr.record_type = 'talent_pool_external_profile_ref') AS external_profile_ref_context_count,
       (SELECT COALESCE(SUM(
          CASE
            WHEN t.github_url IS NOT NULL
             AND TRIM(t.github_url) <> ''
             AND NOT EXISTS (
               SELECT 1
                 FROM linked_workspace_people lwp
                 JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id
                 JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
                WHERE lwp.candidate_id = ac.id
                  AND cr.record_type = 'talent_pool_external_profile_ref'
                  AND cr.predicate = 'submitted_github_profile_url'
             )
            THEN 1 ELSE 0
          END
          + CASE
            WHEN t.linkedin_url IS NOT NULL
             AND TRIM(t.linkedin_url) <> ''
             AND NOT EXISTS (
               SELECT 1
                 FROM linked_workspace_people lwp
                 JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id
                 JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
                WHERE lwp.candidate_id = ac.id
                  AND cr.record_type = 'talent_pool_external_profile_ref'
                  AND cr.predicate = 'submitted_linkedin_profile_url'
             )
            THEN 1 ELSE 0
          END
          + CASE
            WHEN t.portfolio_url IS NOT NULL
             AND TRIM(t.portfolio_url) <> ''
             AND NOT EXISTS (
               SELECT 1
                 FROM linked_workspace_people lwp
                 JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id
                 JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
                WHERE lwp.candidate_id = ac.id
                  AND cr.record_type = 'talent_pool_external_profile_ref'
                  AND cr.predicate = 'submitted_portfolio_url'
             )
            THEN 1 ELSE 0
          END
        ), 0)
          FROM audited_candidates ac
          JOIN talent_pool_intakes t ON t.candidate_id = ac.id) AS missing_external_profile_ref_context_count,
       (SELECT COUNT(DISTINCT cr.id)
          FROM linked_workspace_people lwp
          JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id
         WHERE cr.record_type = 'talent_pool_phone_screener_intent') AS phone_screener_intent_context_count,
       (SELECT COUNT(DISTINCT ac.id)
          FROM audited_candidates ac
          JOIN talent_pool_intakes t ON t.candidate_id = ac.id
         WHERE t.phone_screener_consent = 1
           AND NOT EXISTS (
             SELECT 1
               FROM linked_workspace_people lwp
               JOIN context_records cr ON cr.workspace_person_id = lwp.workspace_person_id
               JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
              WHERE lwp.candidate_id = ac.id
                AND cr.record_type = 'talent_pool_phone_screener_intent'
                AND cr.predicate = 'consented_to_phone_screener'
           )) AS missing_phone_screener_intent_context_count,
       (SELECT COUNT(DISTINCT se.id)
          FROM linked_workspace_people lwp
          JOIN signal_evidence se ON se.workspace_person_id = lwp.workspace_person_id) AS signal_evidence_count,
       (SELECT COUNT(DISTINCT cdq.id)
          FROM audited_candidates ac
          JOIN challenge_design_queue cdq ON cdq.candidate_id = ac.id
         WHERE cdq.status IN ('queued', 'in_review', 'ready_to_assign')) AS design_queue_count`,
    params,
  );
  const row = rows[0];
  const challengeAssignmentProofCounts = await loadChallengeAssignmentProofCounts(client, scopeSql, params);
  return {
    personCount: toNumber(row?.person_count),
    workspacePersonCount: toNumber(row?.workspace_person_count),
    talentPoolWorkspacePersonCount: toNumber(row?.talent_pool_workspace_person_count),
    rolelessApplicationCount: toNumber(row?.roleless_application_count),
    rolelessPersonRoleCount: toNumber(row?.roleless_person_role_count),
    contextRecordCount: toNumber(row?.context_record_count),
    externalProfileRefContextCount: toNumber(row?.external_profile_ref_context_count),
    missingExternalProfileRefContextCount: toNumber(row?.missing_external_profile_ref_context_count),
    phoneScreenerIntentContextCount: toNumber(row?.phone_screener_intent_context_count),
    missingPhoneScreenerIntentContextCount: toNumber(row?.missing_phone_screener_intent_context_count),
    signalEvidenceCount: toNumber(row?.signal_evidence_count),
    readyChallengeAssignmentCount: challengeAssignmentProofCounts.readyChallengeAssignmentCount,
    unprovenChallengeAssignmentCount: challengeAssignmentProofCounts.unprovenChallengeAssignmentCount,
    incompleteChallengeAssignmentCount: challengeAssignmentProofCounts.incompleteChallengeAssignmentCount,
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

async function loadSourceLessDesignQueueSuggestionCount(
  client: QueryClient,
  scopeSql: string,
  params: Array<string | number | null>,
): Promise<number> {
  return await count(
    client,
    `${scopeSql}
     SELECT COUNT(DISTINCT cdq.id) AS count
       FROM audited_candidates ac
       JOIN talent_pool_intakes t ON t.candidate_id = ac.id
       JOIN challenge_design_queue cdq ON cdq.candidate_id = ac.id
      WHERE cdq.status IN ('queued', 'in_review', 'ready_to_assign')
        AND t.profile_r2_key IS NOT NULL
        AND (
          substr(LOWER(t.profile_r2_key), -4) = '.pdf'
          OR substr(LOWER(t.profile_r2_key), -5) = '.docx'
        )
        AND COALESCE(TRIM(cdq.suggested_repo_families), '') NOT IN ('', '[]')
        AND NOT EXISTS (
          SELECT 1
            FROM artifact_versions av
            JOIN source_spans ss ON ss.artifact_version_id = av.id
           WHERE av.storage_key = t.profile_r2_key
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
      contentAddressedProfileStorageKeyCount: 0,
      nonContentAddressedProfileStorageKeyCount: 0,
      candidateResumeStorageKeyCount: 0,
      candidateResumeMatchesIntakeCount: 0,
      documentProfileStorageKeyCount: 0,
      profileTextExcerptCount: 0,
      externalProfileRefCount: 0,
      phoneScreenerIntentCount: 0,
    },
    ingestionState: {
      rowCount: 0,
      statuses: [],
      steps: [],
      failedRowCount: 0,
      errorTextRowCount: 0,
    },
    sourceProof: {
      candidateNodeCount: 0,
      candidateNodeExactSourceQuoteCount: 0,
      submittedIntakeWithoutExactCandidateNodeCount: 0,
      candidateNodeWithoutExactSourceCount: 0,
      duplicateCandidateNodeEvidenceCount: 0,
      candidateNodeSourceAnchorConflictCount: 0,
      artifactVersionCount: 0,
      sourceSpanCount: 0,
      sourceSpanTextMismatchCount: 0,
      sourceSpanHashMismatchCount: 0,
      documentProfileSourceSpanCount: 0,
      profileUploadArtifactVersionCount: 0,
      contextSourceRefCount: 0,
    },
    personProjection: {
      personCount: 0,
      workspacePersonCount: 0,
      talentPoolWorkspacePersonCount: 0,
      rolelessApplicationCount: 0,
      rolelessPersonRoleCount: 0,
      contextRecordCount: 0,
      externalProfileRefContextCount: 0,
      missingExternalProfileRefContextCount: 0,
      phoneScreenerIntentContextCount: 0,
      missingPhoneScreenerIntentContextCount: 0,
      signalEvidenceCount: 0,
      readyChallengeAssignmentCount: 0,
      unprovenChallengeAssignmentCount: 0,
      incompleteChallengeAssignmentCount: 0,
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
      sourceLessDesignQueueSuggestionCount: 0,
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
  const sourceLessDesignQueueSuggestionCount = await loadSourceLessDesignQueueSuggestionCount(
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
    ...(!scoped(options) && auditedCandidateCount === 0
      ? ['no Talent Pool candidates were found to audit']
      : []),
    ...(rawCapture.submittedIntakeCount > rawCapture.profileStorageKeyCount
      ? [`${rawCapture.submittedIntakeCount - rawCapture.profileStorageKeyCount} submitted Talent Pool intake(s) lack a profile storage key`]
      : []),
    ...(rawCapture.submittedIntakeCount > rawCapture.candidateResumeStorageKeyCount
      ? [`${rawCapture.submittedIntakeCount - rawCapture.candidateResumeStorageKeyCount} submitted Talent Pool candidate row(s) lack resume_s3_key`]
      : []),
    ...(rawCapture.profileStorageKeyCount > rawCapture.candidateResumeMatchesIntakeCount
      ? [`${rawCapture.profileStorageKeyCount - rawCapture.candidateResumeMatchesIntakeCount} Talent Pool candidate row resume_s3_key value(s) do not match current intake profile_r2_key`]
      : []),
    ...(rawCapture.nonContentAddressedProfileStorageKeyCount > 0
      ? [`${rawCapture.nonContentAddressedProfileStorageKeyCount} Talent Pool profile storage key(s) are not content-addressed`]
      : []),
    ...(rawCapture.submittedIntakeCount > ingestionState.rowCount
      ? [`${rawCapture.submittedIntakeCount - ingestionState.rowCount} submitted Talent Pool intake(s) lack candidate_ingestion state`]
      : []),
    ...(ingestionState.failedRowCount > 0
      ? [`${ingestionState.failedRowCount} submitted Talent Pool candidate_ingestion row(s) are failed`]
      : []),
    ...(ingestionState.errorTextRowCount > 0
      ? [`${ingestionState.errorTextRowCount} submitted Talent Pool candidate_ingestion row(s) still carry error_text`]
      : []),
    ...(rawCapture.submittedIntakeCount > personProjection.talentPoolWorkspacePersonCount
      ? [`${rawCapture.submittedIntakeCount - personProjection.talentPoolWorkspacePersonCount} submitted Talent Pool intake(s) lack active workspace_people Talent Pool projection`]
      : []),
    ...(rawCapture.submittedIntakeCount > 0
      && sourceProof.sourceSpanCount === 0
      && sourceProof.candidateNodeExactSourceQuoteCount === 0
      ? ['submitted Talent Pool profile evidence has no exact source spans or exact candidate-node quotes']
      : []),
    ...(rawCapture.documentProfileStorageKeyCount > 0 && sourceProof.documentProfileSourceSpanCount === 0
      ? [`${rawCapture.documentProfileStorageKeyCount} PDF/DOCX Talent Pool profile upload(s) lack extracted source spans for the current profile key`]
      : []),
    ...(sourceProof.sourceSpanTextMismatchCount > 0
      ? [`${sourceProof.sourceSpanTextMismatchCount} source span(s) do not match their artifact_version content_text slice`]
      : []),
    ...(sourceProof.sourceSpanHashMismatchCount > 0
      ? [`${sourceProof.sourceSpanHashMismatchCount} source span(s) have exact_text_hash values that do not match exact_text`]
      : []),
    ...(sourceProof.submittedIntakeWithoutExactCandidateNodeCount > 0
      ? [`${sourceProof.submittedIntakeWithoutExactCandidateNodeCount} submitted Talent Pool intake(s) lack exact-source candidate-node projection`]
      : []),
    ...(sourceProof.candidateNodeWithoutExactSourceCount > 0
      ? [`${sourceProof.candidateNodeWithoutExactSourceCount} positive candidate node(s) lack an exact validated resume source quote`]
      : []),
    ...(sourceProof.duplicateCandidateNodeEvidenceCount > 0
      ? [`${sourceProof.duplicateCandidateNodeEvidenceCount} duplicate active candidate-node evidence group(s) were found`]
      : []),
    ...(sourceProof.candidateNodeSourceAnchorConflictCount > 0
      ? [`${sourceProof.candidateNodeSourceAnchorConflictCount} active candidate-node source anchor conflict group(s) were found`]
      : []),
    ...(sourceLessPositiveClaimCount > 0
      ? [`${sourceLessPositiveClaimCount} positive person-context claim(s) have no source refs or source spans`]
      : []),
    ...(sourceLessDesignQueueSuggestionCount > 0
      ? [`${sourceLessDesignQueueSuggestionCount} design-queue repo-family suggestion(s) lack extracted PDF/DOCX source spans`]
      : []),
    ...(personProjection.missingExternalProfileRefContextCount > 0
      ? [`${personProjection.missingExternalProfileRefContextCount} external profile ref(s) lack source-backed operational context records`]
      : []),
    ...(personProjection.missingPhoneScreenerIntentContextCount > 0
      ? [`${personProjection.missingPhoneScreenerIntentContextCount} phone screener intent(s) lack source-backed operational context records`]
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
    ...(ingestionState.failedRowCount > 0 || ingestionState.errorTextRowCount > 0
      ? ['Replay or repair failed Talent Pool candidate_ingestion rows before treating ingestion as ready.']
      : []),
    ...(rawCapture.documentProfileStorageKeyCount > 0 && sourceProof.documentProfileSourceSpanCount === 0
      ? ['Replay or repair PDF/DOCX profile extraction so the current profile storage key has exact source spans.']
      : []),
    ...(rawCapture.nonContentAddressedProfileStorageKeyCount > 0
      ? ['Replay or repair Talent Pool profile source capture so profile_r2_key and resume_s3_key use content-hash storage paths.']
      : []),
    ...(sourceProof.sourceSpanTextMismatchCount > 0
      ? ['Repair source span coordinates so exact_text matches the immutable artifact content_text slice.']
      : []),
    ...(sourceProof.sourceSpanHashMismatchCount > 0
      ? ['Repair source span hashes so exact_text_hash is the SHA-256 of exact_text.']
      : []),
    ...(sourceProof.submittedIntakeWithoutExactCandidateNodeCount > 0
      ? ['Replay or repair Talent Pool profile ingestion so each submitted profile creates an exact-source candidate node.']
      : []),
    ...(sourceProof.candidateNodeWithoutExactSourceCount > 0
      ? ['Repair candidate-node decomposition so positive nodes carry validated source_quote offsets or remain non-projecting diagnostics.']
      : []),
    ...(sourceProof.duplicateCandidateNodeEvidenceCount > 0
      ? ['Replay or repair candidate-node ingestion so active source-backed evidence rows are idempotent.']
      : []),
    ...(sourceProof.candidateNodeSourceAnchorConflictCount > 0
      ? ['Repair resume decomposition source anchoring so repeated titles or labels cite the matching source occurrence.']
      : []),
    ...(sourceLessDesignQueueSuggestionCount > 0
      ? ['Clear suggested repo families and keep challenge design in a missing-evidence state until PDF/DOCX profile extraction creates exact source spans.']
      : []),
    ...(personProjection.missingExternalProfileRefContextCount > 0
      ? ['Project GitHub/LinkedIn/portfolio refs into operational context records with exact intake source refs.']
      : []),
    ...(personProjection.missingPhoneScreenerIntentContextCount > 0
      ? ['Project phone screener intent as operational context with source refs instead of a default profile claim.']
      : []),
    ...(personProjection.readyChallengeAssignmentCount === 0 && personProjection.designQueueCount > 0
      ? ['Challenge readiness is correctly still a design-queue gap; do not expose a ready assessment until a source-backed assignment exists.']
      : []),
    ...(personProjection.unprovenChallengeAssignmentCount > 0
      ? [`${personProjection.unprovenChallengeAssignmentCount} PR-backed challenge assignment row(s) lack source-backed review packet proof and cannot safely become Talent Pool assessment readiness.`]
      : []),
    ...(personProjection.incompleteChallengeAssignmentCount > 0
      ? [`${personProjection.incompleteChallengeAssignmentCount} challenge assignment row(s) lack repo URL or PR number and cannot safely become Talent Pool assessment readiness.`]
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
    sourceLessDesignQueueSuggestionCount,
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
  console.log(`  source-less queue hints: ${report.sourceLessDesignQueueSuggestionCount}`);
  console.log(`  duplicate projections: ${report.duplicateProjectedEdgeCount}`);
  console.log('');
  console.log('Raw capture:');
  console.log(`  intakes:               ${report.rawCapture.talentPoolIntakeCount}`);
  console.log(`  submitted:             ${report.rawCapture.submittedIntakeCount}`);
  console.log(`  storage keys:          ${report.rawCapture.profileStorageKeyCount}`);
  console.log(`  content-hash keys:     ${report.rawCapture.contentAddressedProfileStorageKeyCount}`);
  console.log(`  non-hash keys:         ${report.rawCapture.nonContentAddressedProfileStorageKeyCount}`);
  console.log(`  candidate resume keys: ${report.rawCapture.candidateResumeStorageKeyCount}`);
  console.log(`  resume key matches:    ${report.rawCapture.candidateResumeMatchesIntakeCount}`);
  console.log(`  document keys:         ${report.rawCapture.documentProfileStorageKeyCount}`);
  console.log(`  external refs:         ${report.rawCapture.externalProfileRefCount}`);
  console.log(`  phone intent:          ${report.rawCapture.phoneScreenerIntentCount}`);
  console.log('');
  console.log('Ingestion state:');
  console.log(`  rows:                  ${report.ingestionState.rowCount}`);
  console.log(`  failed rows:           ${report.ingestionState.failedRowCount}`);
  console.log(`  rows with errors:      ${report.ingestionState.errorTextRowCount}`);
  console.log(`  current steps:         ${report.ingestionState.steps.map((row) => `${row.currentStep}:${row.count}`).join(', ') || 'none'}`);
  console.log('');
  console.log('Source proof:');
  console.log(`  candidate nodes:       ${report.sourceProof.candidateNodeCount}`);
  console.log(`  exact node quotes:     ${report.sourceProof.candidateNodeExactSourceQuoteCount}`);
  console.log(`  submitted node gaps:   ${report.sourceProof.submittedIntakeWithoutExactCandidateNodeCount}`);
  console.log(`  node quote gaps:       ${report.sourceProof.candidateNodeWithoutExactSourceCount}`);
  console.log(`  duplicate nodes:       ${report.sourceProof.duplicateCandidateNodeEvidenceCount}`);
  console.log(`  anchor conflicts:      ${report.sourceProof.candidateNodeSourceAnchorConflictCount}`);
  console.log(`  artifact versions:     ${report.sourceProof.artifactVersionCount}`);
  console.log(`  source spans:          ${report.sourceProof.sourceSpanCount}`);
  console.log(`  span text mismatches:  ${report.sourceProof.sourceSpanTextMismatchCount}`);
  console.log(`  span hash mismatches:  ${report.sourceProof.sourceSpanHashMismatchCount}`);
  console.log(`  document source spans: ${report.sourceProof.documentProfileSourceSpanCount}`);
  console.log(`  upload artifact refs:  ${report.sourceProof.profileUploadArtifactVersionCount}`);
  console.log(`  context source refs:   ${report.sourceProof.contextSourceRefCount}`);
  console.log('');
  console.log('Person projection:');
  console.log(`  people:                ${report.personProjection.personCount}`);
  console.log(`  workspace people:      ${report.personProjection.workspacePersonCount}`);
  console.log(`  context records:       ${report.personProjection.contextRecordCount}`);
  console.log(`  profile ref contexts:  ${report.personProjection.externalProfileRefContextCount}`);
  console.log(`  profile ref gaps:      ${report.personProjection.missingExternalProfileRefContextCount}`);
  console.log(`  phone intent contexts: ${report.personProjection.phoneScreenerIntentContextCount}`);
  console.log(`  phone intent gaps:     ${report.personProjection.missingPhoneScreenerIntentContextCount}`);
  console.log(`  signal evidence:       ${report.personProjection.signalEvidenceCount}`);
  console.log(`  ready assignments:     ${report.personProjection.readyChallengeAssignmentCount}`);
  console.log(`  unproven assignments:  ${report.personProjection.unprovenChallengeAssignmentCount}`);
  console.log(`  incomplete assignments: ${report.personProjection.incompleteChallengeAssignmentCount}`);
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
