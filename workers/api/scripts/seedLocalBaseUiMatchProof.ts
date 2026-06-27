#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { ensureCandidateLivingContext } from '../src/lib/livingContext/compatibility';
import { ingestMeetingTranscriptToLivingContext } from '../src/lib/livingContext/meetingTranscript';

type SqlValue = string | number | bigint | null | Uint8Array;

interface SqliteStatement {
  get(...bindings: SqlValue[]): unknown;
  all(...bindings: SqlValue[]): unknown[];
  run(...bindings: SqlValue[]): { changes: number | bigint };
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const OWNER_ID = 'local-match-proof-owner';
const CANDIDATE_ID = 'local-base-ui-review-candidate';
const CANDIDATE_INVITE_TOKEN = 'local-base-ui-review-token';
const ROLE_CONTEXT_ID = 'local-role-context-mui-popover';
const CONTACT_ID = 'local-base-ui-review-contact';
const MEETING_ID = 'local-base-ui-review-meeting';
const PARTICIPANT_ID = 'local-base-ui-review-participant';
const OBSERVED_AT = '2026-06-26T00:00:00.000Z';

const TRANSCRIPT_TEXT = [
  'I implemented React TypeScript popover click handling in usePopoverRoot,',
  'introduced a patient click threshold for impatient trigger clicks,',
  'and validated the popover trigger behavior with a JavaScript test runner.',
].join(' ');

const ROLE_DESCRIPTION = [
  'Review React TypeScript trigger behavior pull requests for popup-style UI',
  'components, accessibility state, and JavaScript test coverage.',
].join(' ');

const ROLE_SKILLS = [
  'JavaScript test runner',
  'React',
  'TypeScript',
  'trigger',
];
const ROLE_CONTEXT_RECORD_ID = 'local-role-context-mui-popover-record';
const ROLE_NODE_ID = 'local-role-context-mui-popover-node';
const ROLE_CONCEPTS = [
  { surface: 'JavaScript test runner', canonicalKey: 'term:javascript-test-runner', label: 'javascript test runner' },
  { surface: 'React', canonicalKey: 'term:react', label: 'react' },
  { surface: 'trigger', canonicalKey: 'term:trigger', label: 'trigger' },
  { surface: 'TypeScript', canonicalKey: 'term:typescript', label: 'typescript' },
];

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function countRows(sqlite: SqliteDatabase, tableName: string): number {
  try {
    const result = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
    if (typeof result !== 'object' || result === null) return 0;
    const count = (result as { count?: number | bigint }).count;
    return typeof count === 'bigint' ? Number(count) : count ?? 0;
  } catch {
    return 0;
  }
}

function localDatabasePath(): string {
  const explicit = argument('--database');
  if (explicit) return resolve(explicit);
  const directory = resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const files = readdirSync(directory)
    .filter((entry) => entry.endsWith('.sqlite') && entry !== 'metadata.sqlite')
    .map((entry) => resolve(directory, entry));
  if (files.length === 0) throw new Error(`No local D1 database found under ${directory}`);
  if (files.length === 1) return files[0];

  const scoredFiles = files.map((path) => {
    let reviewPackets = 0;
    let sourceSpans = 0;
    let candidates = 0;
    const sqlite = new DatabaseSync(path);
    try {
      reviewPackets = countRows(sqlite, 'review_challenge_packets');
      sourceSpans = countRows(sqlite, 'repo_source_spans');
      candidates = countRows(sqlite, 'candidates');
    } finally {
      sqlite.close();
    }
    return {
      path,
      score: (reviewPackets * 1_000_000) + (sourceSpans * 1_000) + candidates,
      size: statSync(path).size,
    };
  });

  scoredFiles.sort((left, right) => (right.score - left.score) || (right.size - left.size));
  return scoredFiles[0].path;
}

function rewriteNumberedParams(sql: string, bindings: unknown[]): { sql: string; args: SqlValue[] } {
  const numbered = /\?(\d+)/g;
  const args: SqlValue[] = [];
  let rewritten = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  numbered.lastIndex = 0;
  while ((match = numbered.exec(sql)) !== null) {
    rewritten += sql.slice(lastIndex, match.index) + '?';
    args.push(bindings[Number(match[1]) - 1] as SqlValue);
    lastIndex = numbered.lastIndex;
  }
  rewritten += sql.slice(lastIndex);
  return {
    sql: rewritten,
    args: args.length > 0 ? args : bindings as SqlValue[],
  };
}

function d1(sqlite: SqliteDatabase): D1Database {
  return {
    prepare(query: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async run() {
          const { sql, args } = rewriteNumberedParams(query, bindings);
          const result = sqlite.prepare(sql).run(...args);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        },
        async first<T>() {
          const { sql, args } = rewriteNumberedParams(query, bindings);
          return (sqlite.prepare(sql).get(...args) as T | undefined) ?? null;
        },
        async all<T>() {
          const { sql, args } = rewriteNumberedParams(query, bindings);
          return {
            success: true,
            results: sqlite.prepare(sql).all(...args) as T[],
            meta: {},
          };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function conceptId(canonicalKey: string): string {
  return `local-concept-${canonicalKey.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function seedLegacyRows(sqlite: SqliteDatabase): void {
  sqlite.prepare(
    `INSERT INTO candidates (
       id, pipeline_id, owner_id, name, email, invite_token, status,
       current_stage_id, skills, years_of_experience, current_role, education,
       created_at, updated_at
     ) VALUES (?, NULL, ?, ?, ?, ?, 'INVITED', NULL, ?, 7, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       pipeline_id = excluded.pipeline_id,
       owner_id = excluded.owner_id,
       name = excluded.name,
       email = excluded.email,
       invite_token = excluded.invite_token,
       status = excluded.status,
       current_stage_id = excluded.current_stage_id,
       skills = excluded.skills,
       years_of_experience = excluded.years_of_experience,
       current_role = excluded.current_role,
       education = excluded.education,
       updated_at = excluded.updated_at`,
  ).run(
    CANDIDATE_ID,
    OWNER_ID,
    'Local Base UI Review Candidate',
    'local-base-ui-review-candidate@pipe.test',
    CANDIDATE_INVITE_TOKEN,
    JSON.stringify(['React', 'TypeScript', 'popover', 'testing']),
    'React component systems engineer',
    'BS Computer Science',
    OBSERVED_AT,
    OBSERVED_AT,
  );

  sqlite.prepare(
    `INSERT INTO contacts (
       id, owner_id, name, email, phone, company, role, type, created_at, updated_at
     ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id,
       name = excluded.name,
       email = excluded.email,
       role = excluded.role,
       type = excluded.type,
       updated_at = excluded.updated_at`,
  ).run(
    CONTACT_ID,
    OWNER_ID,
    'Local Base UI Review Candidate',
    'local-base-ui-review-candidate@pipe.test',
    'React component systems engineer',
    'candidate',
    OBSERVED_AT,
    OBSERVED_AT,
  );

  sqlite.prepare('DELETE FROM meetings WHERE id = ?').run(MEETING_ID);
  sqlite.prepare(
    `INSERT INTO meetings (id, owner_id, started_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    MEETING_ID,
    OWNER_ID,
    '2026-06-14T07:30:00.000Z',
    OBSERVED_AT,
    OBSERVED_AT,
    OBSERVED_AT,
  );

  sqlite.prepare('DELETE FROM meeting_participants WHERE id = ?').run(PARTICIPANT_ID);
  sqlite.prepare(
    `INSERT INTO meeting_participants (
       id, meeting_id, contact_id, role, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(PARTICIPANT_ID, MEETING_ID, CONTACT_ID, 'ATTENDEE', OBSERVED_AT, OBSERVED_AT);

  sqlite.prepare(
    `INSERT INTO role_contexts (
       id, pipeline_id, owner_id, job_description_md, rcd_version,
       non_negotiable_skills_json, status, created_at, updated_at
     ) VALUES (?, NULL, ?, ?, 'simple-jd-v1', ?, 'COMPLETE', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id,
       job_description_md = excluded.job_description_md,
       rcd_version = excluded.rcd_version,
       non_negotiable_skills_json = excluded.non_negotiable_skills_json,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(
    ROLE_CONTEXT_ID,
    OWNER_ID,
    ROLE_DESCRIPTION,
    JSON.stringify(ROLE_SKILLS),
    OBSERVED_AT,
    OBSERVED_AT,
  );

  seedRoleContextProjection(sqlite);
}

function seedRoleContextProjection(sqlite: SqliteDatabase): void {
  const observedEpoch = Math.floor(Date.parse(OBSERVED_AT) / 1000);
  for (const concept of ROLE_CONCEPTS) {
    sqlite.prepare(
      `INSERT INTO concepts (
         id, ingestion_key, canonical_key, namespace, label, aliases_json,
         metadata_json, created_at, updated_at, resolver_version, confidence
       ) VALUES (?, ?, ?, 'term', ?, '[]', '{}', ?, ?, 'open-source-term-v2', 1)
       ON CONFLICT(canonical_key) DO UPDATE SET
         label = excluded.label,
         updated_at = excluded.updated_at,
         resolver_version = COALESCE(concepts.resolver_version, excluded.resolver_version),
         confidence = COALESCE(concepts.confidence, excluded.confidence)`,
    ).run(
      conceptId(concept.canonicalKey),
      `local-role:${concept.canonicalKey}`,
      concept.canonicalKey,
      concept.label,
      OBSERVED_AT,
      OBSERVED_AT,
    );
  }

  sqlite.prepare('DELETE FROM context_record_concepts WHERE context_record_id = ?').run(ROLE_CONTEXT_RECORD_ID);
  sqlite.prepare('DELETE FROM context_record_source_refs WHERE context_record_id = ?').run(ROLE_CONTEXT_RECORD_ID);
  sqlite.prepare('DELETE FROM context_records WHERE id = ?').run(ROLE_CONTEXT_RECORD_ID);
  sqlite.prepare('DELETE FROM role_nodes WHERE id = ?').run(ROLE_NODE_ID);

  sqlite.prepare(
    `INSERT INTO context_records (
       id, ingestion_key, scope_type, scope_id, record_type, predicate, narrative,
       qualifiers_json, confidence, polarity, extraction_version, observed_at,
       created_at, updated_at
     ) VALUES (?, ?, 'role_context', ?, 'simple_job_description', 'requires', ?,
       '{}', 0.99, 1, 'local-base-ui-role-proof-v1', ?, ?, ?)`,
  ).run(
    ROLE_CONTEXT_RECORD_ID,
    `role-context:${ROLE_CONTEXT_ID}:local-base-ui-proof`,
    ROLE_CONTEXT_ID,
    ROLE_DESCRIPTION,
    OBSERVED_AT,
    OBSERVED_AT,
    OBSERVED_AT,
  );

  sqlite.prepare(
    `INSERT INTO context_record_source_refs (
       context_record_id, source_ref_type, source_ref_id, evidence_role,
       locator_json, exact_text, content_hash, metadata_json, created_at
     ) VALUES (?, 'job_description', ?, 'role_requirement', ?, ?, ?, '{}', ?)`,
  ).run(
    ROLE_CONTEXT_RECORD_ID,
    ROLE_CONTEXT_ID,
    JSON.stringify({ section: 'job_description_md' }),
    ROLE_DESCRIPTION,
    sha256(ROLE_DESCRIPTION),
    OBSERVED_AT,
  );

  for (const concept of ROLE_CONCEPTS) {
    sqlite.prepare(
      `INSERT INTO context_record_concepts (
         context_record_id, concept_id, relationship, weight, created_at
       )
       SELECT ?, id, 'requires', 1, ?
         FROM concepts
        WHERE canonical_key = ?`,
    ).run(ROLE_CONTEXT_RECORD_ID, OBSERVED_AT, concept.canonicalKey);
  }

  sqlite.prepare(
    `INSERT INTO role_nodes (
       id, role_context_id, rcd_version, node_type, narrative_text,
       extracted_properties_json, source_section, weight, superseded_at,
       created_at, updated_at, ingestion_key
     ) VALUES (?, ?, 'simple-jd-v1', 'job_description_requirement', ?, ?, 'job_description_md',
       1, NULL, ?, ?, ?)`,
  ).run(
    ROLE_NODE_ID,
    ROLE_CONTEXT_ID,
    ROLE_DESCRIPTION,
    JSON.stringify({
      semantic_terms: ROLE_CONCEPTS.map((concept) => ({
        surface: concept.surface,
        canonical_key: concept.canonicalKey,
      })),
    }),
    observedEpoch,
    observedEpoch,
    `role-context:${ROLE_CONTEXT_ID}:local-base-ui-proof-node`,
  );
}

async function seedLivingContext(database: D1Database): Promise<void> {
  await ingestMeetingTranscriptToLivingContext(database, {
    meetingId: MEETING_ID,
    ownerId: OWNER_ID,
    segments: [
      {
        stableSegmentId: 'host-1',
        text: 'What frontend review work have you done recently?',
        speakerRole: 'host',
        timestampStartMs: 1_000,
        timestampEndMs: 2_000,
      },
      {
        stableSegmentId: 'guest-1',
        text: TRANSCRIPT_TEXT,
        speakerRole: 'guest',
        contactId: CONTACT_ID,
        timestampStartMs: 2_100,
        timestampEndMs: 8_500,
        confidence: 0.98,
      },
    ],
    semanticAssertions: [
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Candidate implemented React popover click handling in usePopoverRoot.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'React popover click handling' },
        confidence: 0.98,
        concepts: [{ surface: 'React', relationship: 'about', weight: 1, evidenceLevel: 'implemented', strength: 1 }],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Candidate implemented TypeScript popover click handling in usePopoverRoot.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'TypeScript popover click handling' },
        confidence: 0.98,
        concepts: [{ surface: 'TypeScript', relationship: 'about', weight: 1, evidenceLevel: 'implemented', strength: 1 }],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Candidate implemented popover click handling in usePopoverRoot.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'popover click handling' },
        confidence: 0.98,
        concepts: [{ surface: 'popover', relationship: 'about', weight: 1, evidenceLevel: 'implemented', strength: 1 }],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Candidate implemented click handling in usePopoverRoot.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'click handling' },
        confidence: 0.98,
        concepts: [{ surface: 'click', relationship: 'about', weight: 1, evidenceLevel: 'implemented', strength: 1 }],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Candidate implemented usePopoverRoot behavior for popover clicks.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'usePopoverRoot' },
        confidence: 0.98,
        concepts: [{ surface: 'usePopoverRoot', relationship: 'about', weight: 1, evidenceLevel: 'implemented', strength: 1 }],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'introduced',
        narrative: 'Candidate introduced a patient click threshold for impatient trigger clicks.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'patient click threshold' },
        confidence: 0.99,
        concepts: [{ surface: 'patient click threshold', relationship: 'about', weight: 1, evidenceLevel: 'implemented', strength: 1 }],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'validated',
        narrative: 'Candidate validated popover trigger behavior with a JavaScript test runner.',
        objectType: 'source-described validation',
        objectValue: { surface: 'JavaScript test runner' },
        confidence: 0.99,
        concepts: [{ surface: 'JavaScript test runner', relationship: 'about', weight: 1, evidenceLevel: 'validated', strength: 1 }],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'validated',
        narrative: 'Candidate validated popover trigger behavior.',
        objectType: 'source-described validation',
        objectValue: { surface: 'popover trigger' },
        confidence: 0.99,
        concepts: [{ surface: 'popover trigger', relationship: 'about', weight: 1, evidenceLevel: 'validated', strength: 1 }],
      },
    ],
    extractorVersion: 'local-base-ui-match-proof-v1',
    provider: 'local-proof-seed',
    startedAt: '2026-06-14T07:30:00.000Z',
    endedAt: OBSERVED_AT,
  });

  const identity = await ensureCandidateLivingContext(database, CANDIDATE_ID);
  if (!identity) throw new Error(`Failed to ensure living context for ${CANDIDATE_ID}`);
}

async function main(): Promise<void> {
  const sqlite = new DatabaseSync(localDatabasePath());
  sqlite.exec('BEGIN');
  let succeeded = false;
  try {
    seedLegacyRows(sqlite);
    await seedLivingContext(d1(sqlite));
    const roleSourceHash = sha256(ROLE_DESCRIPTION);
    sqlite.exec('COMMIT');
    succeeded = true;
  console.log(JSON.stringify({
    candidateId: CANDIDATE_ID,
    inviteToken: CANDIDATE_INVITE_TOKEN,
    roleContextId: ROLE_CONTEXT_ID,
      roleSourceHash,
      transcriptText: TRANSCRIPT_TEXT,
      roleDescription: ROLE_DESCRIPTION,
      requiredSurfaces: ROLE_SKILLS,
    }, null, 2));
  } finally {
    if (!succeeded) sqlite.exec('ROLLBACK');
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
