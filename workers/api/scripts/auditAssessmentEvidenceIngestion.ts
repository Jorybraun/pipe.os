#!/usr/bin/env tsx
/**
 * Read-only assessment evidence ingestion audit.
 *
 * Reports whether each core assessment evidence family is captured in the raw
 * assessment spine, projected into person-scoped living context, missing, or
 * duplicated. This is intentionally conservative: projected evidence only
 * counts when a person-scoped context_record preserves a source ref.
 */

import dotenv from 'dotenv';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
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

type EvidenceStatus = 'captured' | 'projected' | 'missing' | 'duplicated';

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

interface EvidenceFamilyDefinition {
  key: string;
  label: string;
  eventKinds: string[];
  assessmentContextRecordTypes: string[];
  personContextRecordTypes: string[];
  sourceRefTypes: string[];
}

export interface AssessmentIngestionAuditOptions {
  sessionId?: string;
  requireAllFamilies?: boolean;
}

export interface EvidenceFamilyAudit {
  key: string;
  label: string;
  status: EvidenceStatus;
  rawEventCount: number;
  rawSourceRefCount: number;
  assessmentScopedContextCount: number;
  personProjectedContextCount: number;
  duplicateProjectedEdgeCount: number;
  missingPersonProjectionCount: number;
}

export interface AssessmentIngestionAudit {
  status: 'ready' | 'not_ready';
  checkedAt: string;
  scope: {
    sessionId: string | null;
    requireAllFamilies: boolean;
  };
  auditedAssessmentSessionCount: number;
  missingTables: string[];
  families: EvidenceFamilyAudit[];
  sourceLessPositiveClaimCount: number;
  duplicateProjectedEdgeCount: number;
  failures: string[];
  nextActions: string[];
}

interface CountRow {
  count: number;
}

const REQUIRED_TABLES = [
  'assessment_sessions',
  'assessment_evidence_events',
  'assessment_event_source_refs',
  'assessment_evaluation_reports',
  'assessment_evaluation_claims',
  'assessment_claim_source_refs',
  'context_records',
  'context_record_source_refs',
];

const EVIDENCE_FAMILIES: EvidenceFamilyDefinition[] = [
  {
    key: 'candidate_profile_resume',
    label: 'Candidate profile / resume evidence',
    eventKinds: ['candidate_profile', 'resume_upload', 'profile_intake', 'profile_text'],
    assessmentContextRecordTypes: [
      'assessment_candidate_profile',
      'assessment_resume_upload',
      'assessment_profile_intake',
      'assessment_profile_text',
    ],
    personContextRecordTypes: ['resume', 'resume_section', 'candidate_profile', 'candidate_profile_claim'],
    sourceRefTypes: ['resume', 'candidate_profile', 'candidate_profile_text'],
  },
  {
    key: 'meeting_transcripts',
    label: 'Meeting transcripts',
    eventKinds: ['transcript_span'],
    assessmentContextRecordTypes: ['assessment_transcript_span'],
    personContextRecordTypes: ['meeting_transcript', 'meeting_transcript_assertion', 'assessment:transcript_span'],
    sourceRefTypes: ['meeting_transcript', 'transcript_span', 'source_span'],
  },
  {
    key: 'video_room_events',
    label: 'Video-room events',
    eventKinds: ['dev_container_event', 'media_control', 'recording_event', 'room_lifecycle'],
    assessmentContextRecordTypes: [
      'assessment_dev_container_event',
      'assessment_media_control',
      'assessment_recording_event',
      'assessment_room_lifecycle',
    ],
    personContextRecordTypes: [
      'assessment:dev_container_event',
      'assessment:media_control',
      'assessment:recording_event',
      'assessment:room_lifecycle',
      'meeting_session_event',
    ],
    sourceRefTypes: [
      'meeting_session_event',
      'dev_container_workspace_launch',
      'dev_container_workspace_stop',
      'room_media_control',
    ],
  },
  {
    key: 'chat',
    label: 'Chat',
    eventKinds: ['message'],
    assessmentContextRecordTypes: ['assessment_message'],
    personContextRecordTypes: ['assessment:message', 'chat_message', 'meeting_session_event'],
    sourceRefTypes: ['meeting_session_event', 'chat_message', 'room_chat_message'],
  },
  {
    key: 'clippy_devin_interactions',
    label: 'Clippy / Devin interactions',
    eventKinds: ['ai_interaction', 'tool_usage'],
    assessmentContextRecordTypes: ['assessment_ai_interaction', 'assessment_tool_usage'],
    personContextRecordTypes: ['assessment:ai_interaction', 'assessment:tool_usage'],
    sourceRefTypes: [
      'ai_prompt',
      'ai_blocked_prompt',
      'ai_user_prompt',
      'ai_user_prompt_blocked',
      'agent_response',
      'ai_agent_response',
      'ai_usage_event',
    ],
  },
  {
    key: 'terminal_commands_output',
    label: 'Terminal commands / output',
    eventKinds: ['terminal_output'],
    assessmentContextRecordTypes: ['assessment_terminal_output'],
    personContextRecordTypes: ['assessment:terminal_output', 'meeting_session_event'],
    sourceRefTypes: ['terminal_command', 'terminal_output', 'meeting_session_event'],
  },
  {
    key: 'code_server_file_activity',
    label: 'Code-server / file activity',
    eventKinds: ['code_editor_open', 'workspace_file_save', 'code_diff'],
    assessmentContextRecordTypes: [
      'assessment_code_editor_open',
      'assessment_workspace_file_save',
      'assessment_code_diff',
    ],
    personContextRecordTypes: [
      'assessment:code_editor_open',
      'assessment:workspace_file_save',
      'assessment:code_diff',
      'meeting_session_event',
    ],
    sourceRefTypes: ['code_server_file_observation', 'workspace_file', 'code_diff'],
  },
  {
    key: 'commit_submissions',
    label: 'Commit submissions',
    eventKinds: ['commit_submission', 'final_submission'],
    assessmentContextRecordTypes: ['assessment_commit_submission', 'assessment_final_submission'],
    personContextRecordTypes: ['assessment:commit_submission', 'assessment:final_submission'],
    sourceRefTypes: ['git_commit'],
  },
  {
    key: 'diffs',
    label: 'Diffs',
    eventKinds: ['code_diff', 'commit_submission', 'final_submission'],
    assessmentContextRecordTypes: ['assessment_code_diff', 'assessment_commit_submission', 'assessment_final_submission'],
    personContextRecordTypes: ['assessment:code_diff', 'assessment:commit_submission', 'assessment:final_submission'],
    sourceRefTypes: ['code_diff'],
  },
  {
    key: 'test_output',
    label: 'Test output',
    eventKinds: ['test_run', 'terminal_output'],
    assessmentContextRecordTypes: ['assessment_test_run', 'assessment_terminal_output'],
    personContextRecordTypes: ['assessment:test_run', 'assessment:terminal_output'],
    sourceRefTypes: ['test_run'],
  },
  {
    key: 'upstream_pr_refs',
    label: 'Upstream PR refs',
    eventKinds: ['commit_submission', 'final_submission'],
    assessmentContextRecordTypes: ['assessment_commit_submission', 'assessment_final_submission'],
    personContextRecordTypes: ['assessment:commit_submission', 'assessment:final_submission'],
    sourceRefTypes: ['upstream_pull_request', 'github_pull_request'],
  },
  {
    key: 'evaluator_reports',
    label: 'Evaluator reports',
    eventKinds: [],
    assessmentContextRecordTypes: ['assessment_evaluation_report'],
    personContextRecordTypes: ['assessment_evaluation_report'],
    sourceRefTypes: ['assessment_evaluation_report'],
  },
  {
    key: 'human_reviewer_decisions',
    label: 'Human reviewer decisions',
    eventKinds: ['human_assessment_decision'],
    assessmentContextRecordTypes: ['assessment_human_assessment_decision'],
    personContextRecordTypes: ['assessment:human_assessment_decision', 'human_assessment_decision'],
    sourceRefTypes: ['human_assessment_decision', 'assessment_evaluation_report'],
  },
  {
    key: 'code_review_annotations',
    label: 'Code-review annotations',
    eventKinds: ['recruiter_note', 'code_review_annotation'],
    assessmentContextRecordTypes: ['assessment_recruiter_note', 'assessment_code_review_annotation'],
    personContextRecordTypes: ['assessment:recruiter_note', 'assessment:code_review_annotation', 'code_review_annotation'],
    sourceRefTypes: ['code_review_annotation', 'review_annotation', 'code_diff'],
  },
];

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

async function count(client: QueryClient, sql: string, params: Array<string | number | null> = []): Promise<number> {
  const rows = await client.query<CountRow>(sql, params);
  return Number(rows[0]?.count ?? 0);
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

async function auditFamily(
  client: QueryClient,
  definition: EvidenceFamilyDefinition,
  options: AssessmentIngestionAuditOptions = {},
): Promise<EvidenceFamilyAudit> {
  const eventKindSql = definition.eventKinds.length > 0 ? placeholders(definition.eventKinds) : "''";
  const assessmentContextTypeSql = definition.assessmentContextRecordTypes.length > 0
    ? placeholders(definition.assessmentContextRecordTypes)
    : "''";
  const personContextTypeSql = definition.personContextRecordTypes.length > 0
    ? placeholders(definition.personContextRecordTypes)
    : "''";
  const sourceRefSql = definition.sourceRefTypes.length > 0 ? placeholders(definition.sourceRefTypes) : "''";
  const sessionFilter = options.sessionId ? ' AND ev.session_id = ?' : '';
  const eventTableSessionFilter = options.sessionId ? ' AND session_id = ?' : '';
  const sessionParams = options.sessionId ? [options.sessionId] : [];
  const assessmentScopeFilter = options.sessionId ? ' AND cr.scope_id = ?' : '';
  const assessmentScopeParams = options.sessionId ? [options.sessionId] : [];
  const personScopeFilter = options.sessionId
    ? ` AND cr.interaction_id IN (
          SELECT id FROM interactions WHERE external_reference = ?
        )`
    : ` AND cr.interaction_id IN (
          SELECT i.id
            FROM interactions i
            JOIN assessment_sessions ass ON ass.id = i.external_reference
        )`;
  const missingProjectionEligibilityFilter = `
    AND EXISTS (
      SELECT 1
        FROM assessment_sessions ass
        LEFT JOIN scheduled_interviews si ON si.id = ass.interview_id
        JOIN candidates c ON c.id = COALESCE(ass.candidate_id, si.candidate_id)
       WHERE ass.id = ev.session_id
         AND (ass.candidate_id IS NOT NULL OR si.candidate_id IS NOT NULL)
    )`;
  const personScopeParams = options.sessionId ? [options.sessionId] : [];

  const rawEventCount = definition.eventKinds.length > 0
    ? await count(
        client,
        `SELECT COUNT(*) AS count
           FROM assessment_evidence_events
          WHERE kind IN (${eventKindSql})${eventTableSessionFilter}`,
        [...definition.eventKinds, ...sessionParams],
      )
    : 0;

  const rawSourceRefCount = definition.sourceRefTypes.length > 0
    ? await count(
        client,
        `SELECT COUNT(*) AS count
           FROM (
             SELECT sr.source_ref_type
               FROM assessment_event_source_refs sr
               JOIN assessment_evidence_events ev ON ev.id = sr.event_id
              WHERE 1 = 1${sessionFilter}
             UNION ALL
             SELECT csr.source_ref_type
               FROM assessment_claim_source_refs csr
               JOIN assessment_evaluation_claims c ON c.id = csr.claim_id
               JOIN assessment_evaluation_reports ev ON ev.id = c.report_id
              WHERE 1 = 1${sessionFilter}
           )
          WHERE source_ref_type IN (${sourceRefSql})`,
        [...sessionParams, ...sessionParams, ...definition.sourceRefTypes],
      )
    : 0;

  const assessmentScopedContextCount = await count(
    client,
    `SELECT COUNT(DISTINCT cr.id) AS count
       FROM context_records cr
       LEFT JOIN context_record_source_refs sr ON sr.context_record_id = cr.id
      WHERE cr.scope_type = 'assessment_session'
        ${assessmentScopeFilter}
        AND (
          cr.record_type IN (${assessmentContextTypeSql})
          OR sr.source_ref_type IN (${sourceRefSql})
        )`,
    [
      ...assessmentScopeParams,
      ...definition.assessmentContextRecordTypes,
      ...definition.sourceRefTypes,
    ],
  );

  const personProjectedContextCount = await count(
    client,
    `SELECT COUNT(DISTINCT cr.id) AS count
       FROM context_records cr
       JOIN context_record_source_refs sr ON sr.context_record_id = cr.id
      WHERE cr.workspace_person_id IS NOT NULL
        ${personScopeFilter}
        AND (
          cr.record_type IN (${personContextTypeSql})
          OR sr.source_ref_type IN (${sourceRefSql})
        )`,
    [
      ...personScopeParams,
      ...definition.personContextRecordTypes,
      ...definition.sourceRefTypes,
    ],
  );

  const duplicateProjectedEdgeCount = await count(
    client,
    `SELECT COUNT(*) AS count
       FROM (
         SELECT cr.workspace_person_id, cr.record_type, cr.narrative,
                sr.source_ref_type, sr.source_ref_id, sr.evidence_role,
                COUNT(*) AS duplicate_count
           FROM context_records cr
          JOIN context_record_source_refs sr ON sr.context_record_id = cr.id
          WHERE cr.workspace_person_id IS NOT NULL
            ${personScopeFilter}
            AND (
              cr.record_type IN (${personContextTypeSql})
              OR sr.source_ref_type IN (${sourceRefSql})
            )
          GROUP BY cr.workspace_person_id, cr.record_type, cr.narrative,
                   sr.source_ref_type, sr.source_ref_id, sr.evidence_role
         HAVING COUNT(*) > 1
       )`,
    [
      ...personScopeParams,
      ...definition.personContextRecordTypes,
      ...definition.sourceRefTypes,
    ],
  );

  const missingPersonProjectionCount = definition.eventKinds.length > 0
    ? await count(
        client,
        `SELECT COUNT(*) AS count
          FROM assessment_evidence_events ev
          WHERE ev.kind IN (${eventKindSql})
            ${sessionFilter}
            ${missingProjectionEligibilityFilter}
            AND NOT EXISTS (
              SELECT 1
                FROM context_records cr
               WHERE cr.ingestion_key = 'assessment_event_context:' || ev.id
                 AND cr.workspace_person_id IS NOT NULL
            )`,
        [...definition.eventKinds, ...sessionParams],
      )
    : 0;

  const status: EvidenceStatus = duplicateProjectedEdgeCount > 0
    ? 'duplicated'
    : personProjectedContextCount > 0
      ? 'projected'
      : rawEventCount > 0 || rawSourceRefCount > 0 || assessmentScopedContextCount > 0
        ? 'captured'
        : 'missing';

  return {
    key: definition.key,
    label: definition.label,
    status,
    rawEventCount,
    rawSourceRefCount,
    assessmentScopedContextCount,
    personProjectedContextCount,
    duplicateProjectedEdgeCount,
    missingPersonProjectionCount,
  };
}

export async function auditAssessmentEvidenceIngestion(
  client: QueryClient,
  options: AssessmentIngestionAuditOptions = {},
): Promise<AssessmentIngestionAudit> {
  const missingTables: string[] = [];
  for (const tableName of REQUIRED_TABLES) {
    if (!await tableExists(client, tableName)) missingTables.push(tableName);
  }

  if (missingTables.length > 0) {
    return {
      status: 'not_ready',
      checkedAt: new Date().toISOString(),
      scope: {
        sessionId: options.sessionId ?? null,
        requireAllFamilies: options.requireAllFamilies === true,
      },
      auditedAssessmentSessionCount: 0,
      missingTables,
      families: [],
      sourceLessPositiveClaimCount: 0,
      duplicateProjectedEdgeCount: 0,
      failures: [`missing ingestion tables: ${missingTables.join(', ')}`],
      nextActions: ['Apply the assessment-layer and living-context migrations before auditing evidence ingestion.'],
    };
  }

  const auditedAssessmentSessionCount = options.sessionId
    ? await count(
        client,
        `SELECT COUNT(*) AS count
           FROM assessment_sessions
          WHERE id = ?`,
        [options.sessionId],
      )
    : await count(
        client,
        `SELECT COUNT(*) AS count
           FROM assessment_sessions`,
      );
  const families = await Promise.all(
    EVIDENCE_FAMILIES.map((definition) => auditFamily(client, definition, options)),
  );
  const sourceLessPositiveClaimCount = await count(
    client,
    `SELECT COUNT(*) AS count
       FROM assessment_evaluation_claims c
       JOIN assessment_evaluation_reports r ON r.id = c.report_id
      WHERE c.polarity = 'positive'
        ${options.sessionId ? 'AND r.session_id = ?' : ''}
        AND NOT EXISTS (
          SELECT 1
            FROM assessment_claim_source_refs sr
           WHERE sr.claim_id = c.id
        )`,
    options.sessionId ? [options.sessionId] : [],
  );
  const duplicateProjectedEdgeCount = families.reduce(
    (sum, family) => sum + family.duplicateProjectedEdgeCount,
    0,
  );

  const failures = [
    ...(options.sessionId && auditedAssessmentSessionCount === 0
      ? [`assessment session ${options.sessionId} was not found`]
      : []),
    ...families
      .filter((family) => options.requireAllFamilies === true && family.status === 'missing')
      .map((family) => `${family.label} is missing from the assessment evidence spine`),
    ...families
      .filter((family) => family.status === 'duplicated')
      .map((family) => `${family.label} has duplicate person-projected evidence edges`),
    ...families
      .filter((family) => family.status === 'captured' && family.missingPersonProjectionCount === 0)
      .map((family) => `${family.label} has captured source refs or assessment context not projected to person context`),
    ...families
      .filter((family) => family.rawEventCount > 0 && family.missingPersonProjectionCount > 0)
      .map((family) => `${family.label} has ${family.missingPersonProjectionCount} raw event(s) not projected to person context`),
    ...(sourceLessPositiveClaimCount > 0
      ? [`${sourceLessPositiveClaimCount} positive evaluation claim(s) have no source refs`]
      : []),
  ];

  const nextActions = [
    ...families
      .filter((family) => family.status === 'captured')
      .map((family) => `Run assessments_to_living_context backfill for captured ${family.label.toLowerCase()} records.`),
    ...families
      .filter((family) => family.status === 'missing')
      .map((family) => `Coverage gap: no ${family.label.toLowerCase()} was found in the audited scope.`),
    ...(sourceLessPositiveClaimCount > 0
      ? ['Repair evaluator output so positive claims are backed by exact assessment source refs, then replay ingestion.']
      : []),
  ];

  return {
    status: failures.length === 0 ? 'ready' : 'not_ready',
    checkedAt: new Date().toISOString(),
    scope: {
      sessionId: options.sessionId ?? null,
      requireAllFamilies: options.requireAllFamilies === true,
    },
    auditedAssessmentSessionCount,
    missingTables,
    families,
    sourceLessPositiveClaimCount,
    duplicateProjectedEdgeCount,
    failures,
    nextActions: [...new Set(nextActions)],
  };
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/auditAssessmentEvidenceIngestion.ts [options]',
    '',
    'Options:',
    '  --local               Audit local Wrangler D1 database (default)',
    '  --remote              Audit Cloudflare D1 via REST',
    '  --database-path PATH  Override local SQLite discovery',
    '  --session-id ID       Limit counts and projection checks to one assessment session',
    '  --require-all-families Treat missing evidence families as failures',
    '  --json                Print machine-readable JSON',
    '  --help, -h            Show this help',
  ].join('\n');
}

interface CliOptions {
  target: 'local' | 'remote';
  databasePath?: string;
  sessionId?: string;
  requireAllFamilies: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { target: 'local', requireAllFamilies: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--local') {
      options.target = 'local';
    } else if (arg === '--remote') {
      options.target = 'remote';
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--require-all-families') {
      options.requireAllFamilies = true;
    } else if (arg === '--session-id' || arg.startsWith('--session-id=')) {
      const inline = arg.match(/^--session-id=(.+)$/)?.[1];
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--session-id requires a value');
      options.sessionId = value;
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
    ? resolve(apiRoot, databasePath)
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

function printHuman(report: AssessmentIngestionAudit, databasePath: string): void {
  console.log('assessment evidence ingestion audit');
  console.log(`  status:                ${report.status}`);
  console.log(`  database:              ${databasePath}`);
  console.log(`  session scope:         ${report.scope.sessionId ?? 'all'}`);
  console.log(`  sessions audited:      ${report.auditedAssessmentSessionCount}`);
  console.log(`  source-less positives: ${report.sourceLessPositiveClaimCount}`);
  console.log(`  duplicate projections: ${report.duplicateProjectedEdgeCount}`);
  console.log('');
  console.log('Evidence families:');
  for (const family of report.families) {
    console.log(
      `- ${family.status.padEnd(10)} ${family.label}: raw=${family.rawEventCount}, refs=${family.rawSourceRefCount}, assessment_context=${family.assessmentScopedContextCount}, person_context=${family.personProjectedContextCount}`,
    );
  }
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
    const report = await auditAssessmentEvidenceIngestion(client, {
      sessionId: options.sessionId,
      requireAllFamilies: options.requireAllFamilies,
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

if (process.argv[1]?.endsWith('auditAssessmentEvidenceIngestion.ts')) {
  main().catch((error) => {
    console.error('[auditAssessmentEvidenceIngestion] Fatal:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
