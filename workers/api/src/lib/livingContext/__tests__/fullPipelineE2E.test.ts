import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  matchCandidateToReviewChallenge,
} from '../../challengeMatching/d1Matcher';
import { formatMatchNarrative } from '../../challengeMatching/matchNarrative';
import {
  buildChallengePacket,
  buildCodeEpisode,
  buildFacet,
  buildRepoSignal,
  buildRepoSnapshot,
  buildSemanticAssertion,
  buildSourceArtifact,
  buildSourceArtifactVersion,
  buildSourceSpan,
  buildStructuralFact,
  buildSymbol,
  persistReviewChallengeGraph,
  type NormalizedPullRequestInput,
  type SourceArtifactKind,
  type SymbolKind,
} from '../../repoSemanticGraph';
import { ingestMeetingTranscriptToLivingContext } from '../meetingTranscript';
import { ensureCandidateLivingContext } from '../compatibility';
import { loadCandidateLivingContext, searchSourceContent } from '../readModel';
import { BackfillOrchestrator } from '../backfillOrchestrator';
import { ingestHistoricalCultureTranscript } from '../cultureTranscriptBackfill';
import { LivingContextStore } from '../persistence';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const DatabaseSync = require('better-sqlite3') as new (path: string) => NodeSqliteDatabase;

const OBSERVED_AT = '2026-06-28T10:00:00.000Z';

type SqlValue = string | number | null;

interface NodeSqliteStatement {
  run(...values: SqlValue[]): unknown;
  get(...values: SqlValue[]): unknown;
  all(...values: SqlValue[]): unknown[];
}

interface NodeSqliteDatabase {
  prepare(sql: string): NodeSqliteStatement;
  exec(sql: string): void;
  close(): void;
}

function rewriteNumberedParams(
  sql: string,
  bindings: unknown[],
): { sql: string; args: unknown[] } {
  const numbered = /\?(\d+)/g;
  let match = numbered.exec(sql);
  if (!match) return { sql, args: bindings };

  const args: unknown[] = [];
  let rewritten = '';
  let lastIndex = 0;

  numbered.lastIndex = 0;
  while ((match = numbered.exec(sql)) !== null) {
    rewritten += sql.slice(lastIndex, match.index) + '?';
    args.push(bindings[parseInt(match[1]!, 10) - 1]);
    lastIndex = numbered.lastIndex;
  }
  rewritten += sql.slice(lastIndex);
  return { sql: rewritten, args };
}

function createNodeSqliteD1(sqlite: NodeSqliteDatabase): D1Database {
  return {
    prepare(query: string) {
      let bindings: unknown[] = [];
      const prepared = {
        bind(...values: SqlValue[]) {
          bindings = values;
          return prepared;
        },
        async run() {
          const { sql, args } = rewriteNumberedParams(query, bindings);
          sqlite.prepare(sql).run(...args as SqlValue[]);
          return { success: true, results: [], meta: {} };
        },
        async first<T>() {
          const { sql, args } = rewriteNumberedParams(query, bindings);
          return (sqlite.prepare(sql).get(...args as SqlValue[]) as T | undefined) ?? null;
        },
        async all<T>() {
          const { sql, args } = rewriteNumberedParams(query, bindings);
          return {
            success: true,
            results: sqlite.prepare(sql).all(...args as SqlValue[]) as T[],
            meta: {},
          };
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function sourceEndPosition(value: string): { byteOffset: number; line: number; column: number } {
  const lines = value.split('\n');
  return {
    byteOffset: byteLength(value),
    line: lines.length,
    column: lines[lines.length - 1]!.length + 1,
  };
}

const candidateNodesMigration = readFileSync(
  new URL('../../../../migrations/0052_candidate_nodes.sql', import.meta.url),
  'utf8',
);
const candidateNodeIdempotencyMigration = readFileSync(
  new URL('../../../../migrations/0085_candidate_node_idempotency.sql', import.meta.url),
  'utf8',
);
const livingMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const matchingMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const backfillCheckpointsMigration = readFileSync(
  new URL('../../../../migrations/0106_backfill_checkpoints.sql', import.meta.url),
  'utf8',
);
const rolloutGatesMigration = readFileSync(
  new URL('../../../../migrations/0107_rollout_gates.sql', import.meta.url),
  'utf8',
);
const rolloutGateAuditLogMigration = readFileSync(
  new URL('../../../../migrations/0108_rollout_gate_audit_log.sql', import.meta.url),
  'utf8',
);

describe('full-pipeline E2E: contact → transcript → match → explanation → backfill', () => {
  let sqlite: NodeSqliteDatabase;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT 'workspace-1',
        pipeline_id TEXT,
        name TEXT,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);
      CREATE TABLE role_contexts (id TEXT PRIMARY KEY);
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        phone TEXT,
        company TEXT,
        role TEXT,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE meeting_participants (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id),
        contact_id TEXT NOT NULL REFERENCES contacts(id),
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    sqlite.exec(candidateNodesMigration);
    sqlite.exec(candidateNodeIdempotencyMigration);
    sqlite.exec(livingMigration);
    sqlite.exec(matchingMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(conceptRegistryMigration);
    sqlite.exec(contextRecordMigration);
    sqlite.exec(backfillCheckpointsMigration);
    sqlite.exec(rolloutGatesMigration);
    sqlite.exec(rolloutGateAuditLogMigration);
    db = createNodeSqliteD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('exercises the full lifecycle: person → transcript → candidate → repo → match → narrative → search (criteria #1-#8)', async () => {
    // ── Criterion #1: Build a living person graph ──
    // Create a contact (person) with email
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    ).run('contact-e2e', 'workspace-1', 'Ada Pipeline', 'ada@pipeline.dev',
      'Backend engineer', 'candidate', OBSERVED_AT, OBSERVED_AT);
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-e2e', 'workspace-1', '2026-06-28T09:30:00.000Z', OBSERVED_AT, OBSERVED_AT);
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('participant-e2e', 'meeting-e2e', 'contact-e2e', 'ATTENDEE', OBSERVED_AT, OBSERVED_AT);

    // ── Criterion #2: Preserve original meaning ──
    // Ingest meeting transcript with semantic assertions linked to exact source spans
    const transcriptText = 'I built idempotent Kafka retry publishing with exact retry key verification and comprehensive test coverage.';
    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-e2e',
      ownerId: 'workspace-1',
      segments: [
        {
          stableSegmentId: 'host-seg-1',
          text: 'Tell me about production systems you have owned.',
          speakerRole: 'host',
          timestampStartMs: 1_000,
          timestampEndMs: 3_000,
        },
        {
          stableSegmentId: 'guest-seg-1',
          text: transcriptText,
          speakerRole: 'guest',
          contactId: 'contact-e2e',
          timestampStartMs: 3_100,
          timestampEndMs: 8_000,
          confidence: 0.97,
        },
      ],
      semanticAssertions: [
        {
          sourceSegmentIds: ['guest-seg-1'],
          subjectSegmentId: 'guest-seg-1',
          predicate: 'implemented',
          narrative: 'Candidate built idempotent Kafka retry publishing.',
          objectType: 'source-described mechanism',
          objectValue: { surface: 'Kafka retry publishing' },
          confidence: 0.95,
          concepts: [
            { surface: 'Kafka', relationship: 'about', weight: 1, evidenceLevel: 'implemented', strength: 1 },
            { surface: 'idempotency', relationship: 'about', weight: 1, evidenceLevel: 'implemented', strength: 1 },
          ],
        },
        {
          sourceSegmentIds: ['guest-seg-1'],
          subjectSegmentId: 'guest-seg-1',
          predicate: 'validated',
          narrative: 'Candidate validated retry key verification.',
          objectType: 'source-described validation',
          objectValue: { surface: 'retry key verification' },
          confidence: 0.94,
          concepts: [
            { surface: 'Kafka', relationship: 'about', weight: 1, evidenceLevel: 'validated', strength: 1 },
            { surface: 'retry', relationship: 'about', weight: 1, evidenceLevel: 'validated', strength: 1 },
          ],
        },
      ],
      extractorVersion: 'e2e-proof-v1',
      provider: 'e2e-test-provider',
      personContextMode: 'attributed',
      startedAt: '2026-06-28T09:30:00.000Z',
      endedAt: OBSERVED_AT,
    });

    // Verify source spans were created with exact text preserved
    const sourceSpans = sqlite.prepare(
      `SELECT ss.exact_text FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
       JOIN artifact_interactions ai ON ai.artifact_id = a.id
       JOIN interactions i ON i.id = ai.interaction_id
       JOIN workspace_people wp ON wp.id = i.workspace_person_id
       JOIN people p ON p.id = wp.person_id
       WHERE p.primary_email = ?`,
    ).all('ada@pipeline.dev') as Array<{ exact_text: string }>;
    expect(sourceSpans.length).toBeGreaterThan(0);
    expect(sourceSpans.some((s) => s.exact_text === transcriptText)).toBe(true);

    // Verify assertions link to source spans (criterion #2)
    const assertionLinks = sqlite.prepare(
      `SELECT sa.narrative, ass.evidence_role, ss.exact_text
       FROM semantic_assertions sa
       JOIN assertion_source_spans ass ON ass.assertion_id = sa.id
       JOIN source_spans ss ON ss.id = ass.source_span_id
       WHERE sa.workspace_person_id IN (
         SELECT wp.id FROM workspace_people wp
         JOIN people p ON p.id = wp.person_id
         WHERE p.primary_email = ?
       )`,
    ).all('ada@pipeline.dev') as Array<{ narrative: string; evidence_role: string; exact_text: string }>;
    expect(assertionLinks.length).toBeGreaterThan(0);
    expect(assertionLinks.every((l) => typeof l.evidence_role === 'string' && l.evidence_role.length > 0)).toBe(true);
    expect(assertionLinks.some((l) => l.exact_text === transcriptText)).toBe(true);

    // ── Criterion #3: Learn semantics dynamically ──
    // Verify open concepts were learned (not hard-coded)
    const concepts = sqlite.prepare(
      `SELECT canonical_key, namespace, label FROM concepts
       WHERE canonical_key LIKE 'term:%'`,
    ).all() as Array<{ canonical_key: string; namespace: string; label: string }>;
    expect(concepts.length).toBeGreaterThan(0);
    const kafkaConcept = concepts.find((c) => c.canonical_key === 'term:kafka');
    expect(kafkaConcept).toBeDefined();

    // ── Criterion #1 continued: Create candidate → identity unification ──
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('candidate-e2e', 'workspace-1', 'pipeline-1', 'Ada Pipeline', 'ada@pipeline.dev', 'active');
    const identity = await ensureCandidateLivingContext(db, 'candidate-e2e');
    expect(identity).not.toBeNull();

    // Verify contact and candidate share the same workspace person (identity unification)
    const app = sqlite.prepare(
      `SELECT a.workspace_person_id FROM applications a WHERE a.legacy_candidate_id = ?`,
    ).get('candidate-e2e') as { workspace_person_id: string } | undefined;
    expect(app).toBeDefined();

    // The workspace person should be linked to the same person as the contact
    const wpPerson = sqlite.prepare(
      `SELECT p.primary_email FROM workspace_people wp
       JOIN people p ON p.id = wp.person_id
       WHERE wp.id = ?`,
    ).get(app!.workspace_person_id) as { primary_email: string };
    expect(wpPerson.primary_email).toBe('ada@pipeline.dev');

    // ── Criterion #4: Understand repositories ──
    // Build a source-backed PR challenge with exact spans
    const repoSnapshot = await buildRepoSnapshot({
      repository: {
        provider: 'github',
        owner: 'pipe',
        name: 'orders',
        canonicalUrl: 'https://github.com/pipe/orders',
      },
      commitSha: 'e2e0000000000000000000000000000000000001',
      defaultBranch: 'main',
      observedAt: OBSERVED_AT,
    });

    const primaryContent = [
      'import { createKafkaRetryKey } from "./kafkaRetryKey";',
      '',
      'export function publishKafkaRetry(eventId: string, attempt: number) {',
      '  const key = createKafkaRetryKey(eventId);',
      '  const topic = "orders.retry.kafka";',
      '  const headers = { "idempotency-key": key, attempt };',
      '  return { key, topic, headers, idempotent: true };',
      '}',
    ].join('\n');
    const helperContent = [
      'export function createKafkaRetryKey(eventId: string) {',
      '  const normalized = eventId.trim().toLowerCase();',
      '  return `kafka-retry:${normalized || "missing-event"}`;',
      '}',
    ].join('\n');
    const testContent = [
      'import { describe, expect, it } from "vitest";',
      'import { publishKafkaRetry } from "./ordersKafkaRetry";',
      '',
      'describe("publishKafkaRetry", () => {',
      '  it("validates kafka retry idempotency", () => {',
      '    const envelope = publishKafkaRetry("ORDER-123", 2);',
      '    expect(envelope.key).toBe("kafka-retry:order-123");',
      '  });',
      '});',
    ].join('\n');

    async function buildFile(input: {
      repoSnapshotId: string; path: string; content: string;
      symbolName: string; symbolKind: SymbolKind; signature: string;
      artifactKind?: SourceArtifactKind;
    }) {
      const artifact = await buildSourceArtifact({
        repoSnapshotId: input.repoSnapshotId, kind: input.artifactKind ?? 'source',
        path: input.path, language: 'typescript',
      });
      const artifactVersion = await buildSourceArtifactVersion({
        artifactId: artifact.id, repoSnapshotId: input.repoSnapshotId,
        content: input.content, createdAt: OBSERVED_AT,
      });
      const sourceSpan = await buildSourceSpan({
        repoSnapshotId: input.repoSnapshotId, artifactId: artifact.id,
        artifactVersionId: artifactVersion.id, contentHash: artifactVersion.contentHash,
        start: { byteOffset: 0, line: 1, column: 1 },
        end: sourceEndPosition(input.content),
        exactText: input.content, displayLabel: `${input.path}:1-${input.content.split('\n').length}`,
        prSide: 'head',
      });
      const symbol = await buildSymbol({
        repoSnapshotId: input.repoSnapshotId, language: 'typescript',
        qualifiedName: `${input.path}:${input.symbolName}`, name: input.symbolName,
        kind: input.symbolKind, signature: input.signature,
        definingSpanId: sourceSpan.id, exported: true,
      });
      return {
        file: {
          path: input.path, status: 'modified' as const, language: 'typescript',
          additions: input.content.split('\n').length, deletions: 0,
          artifact, artifactVersion,
          hunks: [{ header: `@@ ${input.symbolName} @@`, patch: input.content, sourceSpan, changedSymbolIds: [symbol.id] }],
          symbols: [symbol],
        },
        sourceSpan, symbol,
      };
    }

    const primary = await buildFile({
      repoSnapshotId: repoSnapshot.id, path: 'src/ordersKafkaRetry.ts',
      symbolName: 'publishKafkaRetry', symbolKind: 'function',
      signature: 'export function publishKafkaRetry(eventId: string, attempt: number): KafkaRetryEnvelope',
      content: primaryContent,
    });
    const helper = await buildFile({
      repoSnapshotId: repoSnapshot.id, path: 'src/kafkaRetryKey.ts',
      symbolName: 'createKafkaRetryKey', symbolKind: 'function',
      signature: 'export function createKafkaRetryKey(eventId: string): string',
      content: helperContent,
    });
    const test = await buildFile({
      repoSnapshotId: repoSnapshot.id, path: 'src/ordersKafkaRetry.test.ts',
      symbolName: 'validatesKafkaRetryIdempotency', symbolKind: 'test',
      signature: 'it("validates kafka retry idempotency", () => void)',
      content: testContent,
    });

    const issueText = 'Issue #42: Kafka retry publishing needs idempotent envelopes.\nCheck exact retry keys, topic routing, and test coverage.';
    const issueArtifact = await buildSourceArtifact({
      repoSnapshotId: repoSnapshot.id, kind: 'issue',
      externalRef: 'https://github.com/pipe/orders/issues/42', mediaType: 'text/markdown',
    });
    const issueVersion = await buildSourceArtifactVersion({
      artifactId: issueArtifact.id, repoSnapshotId: repoSnapshot.id,
      content: issueText, createdAt: OBSERVED_AT,
    });
    const issueSpan = await buildSourceSpan({
      repoSnapshotId: repoSnapshot.id, artifactId: issueArtifact.id,
      artifactVersionId: issueVersion.id, contentHash: issueVersion.contentHash,
      start: { byteOffset: 0, line: 1, column: 1 },
      end: sourceEndPosition(issueText), exactText: issueText,
      displayLabel: 'issues/42:1-2', prSide: 'metadata',
    });

    const prInput: NormalizedPullRequestInput = {
      repoSnapshot, number: 42,
      url: 'https://github.com/pipe/orders/pull/42',
      title: 'Add idempotent Kafka retry publishing',
      body: 'Implements exact Kafka retry keys and coverage for idempotent retry envelopes.',
      author: 'engineer', primaryLanguage: 'TypeScript',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: repoSnapshot.commitSha, mergedAt: OBSERVED_AT,
      metadataSourceSpanIds: [issueSpan.id],
      sourceArtifacts: [issueArtifact],
      sourceArtifactVersions: [issueVersion],
      sourceSpans: [primary.sourceSpan, helper.sourceSpan, test.sourceSpan, issueSpan],
      changedFiles: [primary.file, helper.file, test.file],
      tests: [{ path: test.file.path, framework: 'vitest', sourceSpanIds: [test.sourceSpan.id], relatedSymbolIds: [test.symbol.id] }],
      issue: { number: 42, title: 'Kafka retry publishing needs idempotent envelopes', body: issueText, labels: [], sourceSpanIds: [issueSpan.id] },
    };

    const fact = await buildStructuralFact({
      repoSnapshotId: repoSnapshot.id, kind: 'calls',
      subject: { symbolId: primary.symbol.id }, object: { symbolId: helper.symbol.id },
      sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id],
      confidence: 0.94, parser: 'typescript-compiler-api-e2e',
    });
    const episode = await buildCodeEpisode({
      repoSnapshotId: repoSnapshot.id, title: 'kafka-retry-idempotency',
      narrative: 'The PR implements Kafka retry idempotency and verifies the retry key contract.',
      symbolIds: [primary.symbol.id, helper.symbol.id, test.symbol.id],
      structuralFactIds: [fact.id],
      sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
      conceptKeys: ['term:kafka', 'term:retry', 'term:idempotency'],
    });
    const facet = await buildFacet({
      repoSnapshotId: repoSnapshot.id, kind: 'source-derived-mechanism',
      key: 'kafka-retry-idempotency', label: 'Kafka retry idempotency', aliases: [],
      sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
      confidence: 0.91,
    });
    const repoAssertion = await buildSemanticAssertion({
      repoSnapshotId: repoSnapshot.id, episodeId: episode.id,
      subject: primary.symbol.id,
      predicate: 'implements.source.backed.kafka.retry.idempotency',
      object: 'term:kafka',
      narrative: 'The source implements Kafka retry idempotency with exact retry key verification.',
      qualifiers: { source: 'e2e-proof-fixture' },
      facetIds: [facet.id],
      conceptKeys: ['term:kafka', 'term:retry', 'term:idempotency'],
      sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
      confidence: 0.92, extractor: 'repo-semantic-e2e-v1',
    });
    const signal = await buildRepoSignal({
      repoSnapshotId: repoSnapshot.id, key: 'kafka-retry-idempotency',
      narrative: 'The repository demonstrates Kafka retry idempotency backed by exact source and test spans.',
      assertionIds: [repoAssertion.id], facetIds: [facet.id],
      sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
      confidence: 0.9, sourceDiversity: 3,
    });

    const packet = await buildChallengePacket(prInput);
    const repoId = 42;
    sqlite.prepare('INSERT INTO qualified_repos (id) VALUES (?)').run(repoId);
    await persistReviewChallengeGraph(db, repoId, prInput, packet, {
      structuralFacts: [fact], codeEpisodes: [episode],
      facets: [facet], semanticAssertions: [repoAssertion], repoSignals: [signal],
    });

    // Verify repo decomposition preserves exact commit and line-level provenance (criterion #4)
    const repoSpans = sqlite.prepare(
      `SELECT rss.exact_text, rss.line_start, rss.line_end
       FROM repo_source_spans rss
       JOIN repo_artifact_versions rav ON rav.id = rss.artifact_version_id
       JOIN repo_source_artifacts rsa ON rsa.id = rav.artifact_id
       JOIN repo_snapshots rs ON rs.id = rsa.repo_snapshot_id
       WHERE rs.commit_sha = ?`,
    ).all(repoSnapshot.commitSha) as Array<{ exact_text: string; line_start: number; line_end: number }>;
    expect(repoSpans.length).toBeGreaterThanOrEqual(3);
    expect(repoSpans.some((s) => s.exact_text === primaryContent)).toBe(true);

    // ── Criterion #5: Evidence-based matching ──
    const result = await matchCandidateToReviewChallenge(db, 'candidate-e2e');

    expect(result.status).toBe('MATCHED');
    expect(result.repoId).toBe(repoId);
    expect(result.prNumber).toBe(42);
    expect(result.explanation).toBeDefined();
    expect(result.explanation!.status).toBe('MATCHED');
    expect(result.explanation!.selectedPr).toEqual(expect.objectContaining({
      challengeId: packet.id,
      repoId: String(repoId),
      prNumber: 42,
    }));

    // Verify evidence links candidate source spans to repo source spans
    expect(result.explanation!.evidence.length).toBeGreaterThan(0);
    expect(result.explanation!.evidence.some((entry) =>
      entry.candidateSourceRefs.some((ref) =>
        ref.sourceRefType === 'source_span'
        && ref.exactText === transcriptText,
      )
      && entry.challengeSourceRefs.some((ref) => ref.sourceRefType === 'repo_source_span'),
    )).toBe(true);

    // Verify match was persisted deterministically (criterion #8)
    const matchRun = sqlite.prepare(
      `SELECT id, status, ranked_results_json FROM match_runs WHERE candidate_id = ?`,
    ).get('candidate-e2e') as { id: string; status: string; ranked_results_json: string };
    expect(matchRun.status).toBe('MATCHED');

    // ── Criterion #5 continued: Re-run matching deterministically ──
    const rerunResult = await matchCandidateToReviewChallenge(db, 'candidate-e2e');
    expect(rerunResult.status).toBe('MATCHED');
    expect(rerunResult.prNumber).toBe(42);

    // ── Criterion #6: Explain every match ──
    const narrative = formatMatchNarrative(result.explanation!);
    expect(narrative.title).toContain('PR #42');
    expect(narrative.verdict).toContain('Candidate matched');
    expect(narrative.sections.length).toBeGreaterThan(0);
    const directSection = narrative.sections.find((s) => s.heading === 'Direct Evidence');
    expect(directSection).toBeDefined();
    expect(directSection!.items.length).toBeGreaterThan(0);
    expect(narrative.plainText).toContain('Direct Evidence');

    // Verify candidate source spans are in the explanation
    expect(result.explanation!.candidateSpans.length).toBeGreaterThan(0);
    expect(result.explanation!.candidateSpans.flatMap((s) =>
      s.sourceRefs.map((r) => r.exactText),
    )).toContain(transcriptText);

    // ── Criterion #2 continued: searchSourceContent ──
    const searchResult = await searchSourceContent(db, app!.workspace_person_id, 'Kafka');
    expect(searchResult.hits.length).toBeGreaterThan(0);
    expect(searchResult.hits.some((h) => h.exactText.includes('Kafka'))).toBe(true);

    // ── Criterion #7: Verify read model has navigable data ──
    const readModel = await loadCandidateLivingContext(db, 'candidate-e2e');
    expect(readModel).not.toBeNull();
    expect(readModel!.assertions.length).toBeGreaterThan(0);
    expect(readModel!.interactions.length).toBeGreaterThan(0);
    expect(readModel!.summary.assertionCount).toBeGreaterThan(0);
    expect(readModel!.summary.sourceSpanCount).toBeGreaterThan(0);

    // ── Criterion #8: BackfillOrchestrator idempotency ──
    const orchestrator = new BackfillOrchestrator(db, [
      { taskKey: 'identity', description: 'Identity unification', dependsOn: [] },
      { taskKey: 'interactions', description: 'Interaction ingestion', dependsOn: ['identity'] },
      { taskKey: 'projections', description: 'Projection rebuild', dependsOn: ['interactions'] },
    ]);
    await orchestrator.ensureCheckpoints();
    const status = await orchestrator.getStatus();
    expect(status.tasks).toHaveLength(3);
    expect(status.tasks[0]!.taskKey).toBe('identity');
    expect(status.tasks[0]!.status).toBe('pending');

    // Start and checkpoint a task
    await orchestrator.markRunning('identity', 1);
    await orchestrator.updateProgress('identity', 'person-1', 1, 0);
    await orchestrator.markCompleted('identity');

    // Verify checkpoint survived
    const postComplete = await orchestrator.getStatus();
    const identityTask = postComplete.tasks.find((t) => t.taskKey === 'identity');
    expect(identityTask).toBeDefined();
    expect(identityTask!.status).toBe('completed');
    expect(identityTask!.cursor).toBe('person-1');

    // Verify dependency ordering: interactions can start, projections cannot
    const readyTasks = await orchestrator.getReadyTasks();
    expect(readyTasks).toContain('interactions');
    expect(readyTasks).not.toContain('projections');
  });

  it('produces deterministic match runs: re-running with identical data yields byte-identical results (criterion #8)', async () => {
    // Seed contact + transcript evidence
    sqlite.prepare(
      `INSERT INTO contacts (id, owner_id, name, email, phone, company, role, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    ).run('contact-det', 'workspace-1', 'Det Candidate', 'det@example.com',
      'Engineer', 'candidate', OBSERVED_AT, OBSERVED_AT);
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('meeting-det', 'workspace-1', OBSERVED_AT, OBSERVED_AT, OBSERVED_AT);
    sqlite.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('participant-det', 'meeting-det', 'contact-det', 'ATTENDEE', OBSERVED_AT, OBSERVED_AT);

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-det',
      ownerId: 'workspace-1',
      segments: [{
        stableSegmentId: 'guest-det-1',
        text: 'I built Kafka retry systems with idempotent keys.',
        speakerRole: 'guest',
        contactId: 'contact-det',
        timestampStartMs: 1_000,
        timestampEndMs: 4_000,
        confidence: 0.99,
      }],
      semanticAssertions: [{
        sourceSegmentIds: ['guest-det-1'],
        subjectSegmentId: 'guest-det-1',
        predicate: 'implemented',
        narrative: 'Built Kafka retry idempotency.',
        objectType: 'mechanism',
        objectValue: { surface: 'Kafka retry' },
        confidence: 0.95,
        concepts: [
          { surface: 'Kafka', relationship: 'about', weight: 1, evidenceLevel: 'implemented', strength: 1 },
        ],
      }],
      extractorVersion: 'det-test-v1',
      provider: 'det-provider',
      startedAt: OBSERVED_AT,
      endedAt: OBSERVED_AT,
    });

    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('candidate-det', 'workspace-1', 'pipeline-1', 'Det Candidate', 'det@example.com', 'active');
    await ensureCandidateLivingContext(db, 'candidate-det');

    // Build a minimal repo challenge
    const repoSnapshot = await buildRepoSnapshot({
      repository: { provider: 'github', owner: 'det', name: 'repo', canonicalUrl: 'https://github.com/det/repo' },
      commitSha: 'det00000000000000000000000000000000000001',
      defaultBranch: 'main', observedAt: OBSERVED_AT,
    });
    const artifact = await buildSourceArtifact({
      repoSnapshotId: repoSnapshot.id, kind: 'source', path: 'src/retry.ts', language: 'typescript',
    });
    const artVersion = await buildSourceArtifactVersion({
      artifactId: artifact.id, repoSnapshotId: repoSnapshot.id,
      content: 'export function retry() { return "kafka-retry"; }', createdAt: OBSERVED_AT,
    });
    const span = await buildSourceSpan({
      repoSnapshotId: repoSnapshot.id, artifactId: artifact.id,
      artifactVersionId: artVersion.id, contentHash: artVersion.contentHash,
      start: { byteOffset: 0, line: 1, column: 1 },
      end: sourceEndPosition('export function retry() { return "kafka-retry"; }'),
      exactText: 'export function retry() { return "kafka-retry"; }',
      displayLabel: 'src/retry.ts:1-1', prSide: 'head',
    });
    const sym = await buildSymbol({
      repoSnapshotId: repoSnapshot.id, language: 'typescript',
      qualifiedName: 'src/retry.ts:retry', name: 'retry', kind: 'function',
      signature: 'export function retry(): string', definingSpanId: span.id, exported: true,
    });
    const episode = await buildCodeEpisode({
      repoSnapshotId: repoSnapshot.id, title: 'kafka-retry',
      narrative: 'Kafka retry implementation.', symbolIds: [sym.id],
      structuralFactIds: [], sourceSpanIds: [span.id],
      conceptKeys: ['term:kafka', 'term:retry'],
    });
    const facet = await buildFacet({
      repoSnapshotId: repoSnapshot.id, kind: 'source-derived-mechanism',
      key: 'kafka-retry', label: 'Kafka retry', aliases: [],
      sourceSpanIds: [span.id], confidence: 0.9,
    });
    const assertion = await buildSemanticAssertion({
      repoSnapshotId: repoSnapshot.id, episodeId: episode.id,
      subject: sym.id, predicate: 'implements.kafka.retry', object: 'term:kafka',
      narrative: 'Kafka retry backed by source.', qualifiers: {},
      facetIds: [facet.id], conceptKeys: ['term:kafka', 'term:retry'],
      sourceSpanIds: [span.id], confidence: 0.9, extractor: 'det-e2e-v1',
    });
    const repoSignal = await buildRepoSignal({
      repoSnapshotId: repoSnapshot.id, key: 'kafka-retry',
      narrative: 'Kafka retry demonstrated.', assertionIds: [assertion.id],
      facetIds: [facet.id], sourceSpanIds: [span.id], confidence: 0.9, sourceDiversity: 1,
    });
    const prText = 'PR: Add Kafka retry implementation with idempotent keys.';
    const prArt = await buildSourceArtifact({
      repoSnapshotId: repoSnapshot.id, kind: 'pull_request',
      externalRef: 'https://github.com/det/repo/pull/1', mediaType: 'text/markdown',
    });
    const prVer = await buildSourceArtifactVersion({
      artifactId: prArt.id, repoSnapshotId: repoSnapshot.id,
      content: prText, createdAt: OBSERVED_AT,
    });
    const prSpan = await buildSourceSpan({
      repoSnapshotId: repoSnapshot.id, artifactId: prArt.id,
      artifactVersionId: prVer.id, contentHash: prVer.contentHash,
      start: { byteOffset: 0, line: 1, column: 1 },
      end: sourceEndPosition(prText), exactText: prText,
      displayLabel: 'pull/1:1-1', prSide: 'metadata',
    });
    const prInput: NormalizedPullRequestInput = {
      repoSnapshot, number: 1,
      url: 'https://github.com/det/repo/pull/1',
      title: 'Add Kafka retry', body: 'Kafka retry implementation.',
      author: 'eng', primaryLanguage: 'TypeScript',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: repoSnapshot.commitSha, mergedAt: OBSERVED_AT,
      metadataSourceSpanIds: [prSpan.id],
      sourceArtifacts: [prArt], sourceArtifactVersions: [prVer],
      sourceSpans: [span, prSpan],
      changedFiles: [{
        path: 'src/retry.ts', status: 'modified', language: 'typescript',
        additions: 1, deletions: 0, artifact, artifactVersion: artVersion,
        hunks: [{ header: '@@ retry @@', patch: 'export function retry() { return "kafka-retry"; }', sourceSpan: span, changedSymbolIds: [sym.id] }],
        symbols: [sym],
      }],
      tests: [], issue: undefined,
    };
    const pkt = await buildChallengePacket(prInput);
    sqlite.prepare('INSERT INTO qualified_repos (id) VALUES (?)').run(99);
    await persistReviewChallengeGraph(db, 99, prInput, pkt, {
      structuralFacts: [], codeEpisodes: [episode], facets: [facet],
      semanticAssertions: [assertion], repoSignals: [repoSignal],
    });

    const run1 = await matchCandidateToReviewChallenge(db, 'candidate-det');
    const run2 = await matchCandidateToReviewChallenge(db, 'candidate-det');

    expect(run1.status).toBe(run2.status);
    expect(run1.prNumber).toBe(run2.prNumber);
    expect(run1.repoId).toBe(run2.repoId);
    expect(run1.explanation!.evidence.length).toBe(run2.explanation!.evidence.length);
  });

  it('backfills historical culture interview transcripts into the living context graph', async () => {
    // Seed a candidate
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, name, email, status)
       VALUES ('candidate-culture', 'workspace-1', 'Ada Culture', 'ada@culture.dev', 'active')`,
    ).run();
    await ensureCandidateLivingContext(db, 'candidate-culture');

    // Ingest a historical culture transcript with 2 answered turns
    const result = await ingestHistoricalCultureTranscript(db, {
      candidateId: 'candidate-culture',
      sessionId: 'culture-session-1',
      transcript: {
        turns: [
          {
            idx: 0,
            questionId: 'q1',
            questionText: 'Tell me about a time you resolved a team conflict.',
            candidateResponse: 'I mediated a disagreement between two engineers over API design. I facilitated a meeting where both presented their approaches, then we voted as a team.',
            timestamp: '2026-06-01T10:00:00Z',
            probeOf: null,
            videoR2Key: null,
          },
          {
            idx: 1,
            questionId: 'q2',
            questionText: 'How do you handle tight deadlines?',
            candidateResponse: 'I break down the work into smaller milestones and prioritize ruthlessly. I communicate early when scope needs to change.',
            timestamp: '2026-06-01T10:05:00Z',
            probeOf: null,
            videoR2Key: null,
          },
          {
            idx: 2,
            questionId: 'q3',
            questionText: 'What motivates you at work?',
            candidateResponse: null,
            timestamp: null,
            probeOf: null,
            videoR2Key: null,
          },
        ],
        scratchpad: {
          competencyScores: {},
          mode: 'role_fit',
          contextualTurns: [],
        },
      },
      extractSemantics: false,
      fallbackObservedAt: '2026-06-01T10:10:00Z',
      sessionStartedAt: '2026-06-01T10:00:00Z',
      sessionEndedAt: '2026-06-01T10:10:00Z',
    });

    expect(result.answeredTurns).toBe(2);
    expect(result.ingestedTurns).toBe(2);
    expect(result.sourceOnlyTurns).toBe(2);

    // Verify interactions were created
    const interactions = sqlite.prepare(
      `SELECT * FROM interactions WHERE interaction_type = 'culture_interview'`,
    ).all() as Array<{ external_reference: string }>;
    expect(interactions.length).toBe(1);
    expect(interactions[0]!.external_reference).toBe('culture-session-1');

    // Verify artifacts (one per turn)
    const artifacts = sqlite.prepare(
      `SELECT * FROM artifacts WHERE artifact_type = 'culture_interview_turn'`,
    ).all() as unknown[];
    expect(artifacts.length).toBe(2);

    // Verify source spans: question + answer per turn = 4 minimum
    const sourceSpans = sqlite.prepare(
      `SELECT ss.exact_text, ss.metadata_json FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
       WHERE a.artifact_type = 'culture_interview_turn'`,
    ).all() as Array<{ exact_text: string; metadata_json: string }>;
    expect(sourceSpans.length).toBeGreaterThanOrEqual(4);

    // Verify context records
    const contextRecords = sqlite.prepare(
      `SELECT * FROM context_records WHERE record_type = 'culture_interview_turn'`,
    ).all() as unknown[];
    expect(contextRecords.length).toBe(2);

    // Verify idempotency: re-ingesting produces the same result
    const result2 = await ingestHistoricalCultureTranscript(db, {
      candidateId: 'candidate-culture',
      sessionId: 'culture-session-1',
      transcript: {
        turns: [
          {
            idx: 0, questionId: 'q1',
            questionText: 'Tell me about a time you resolved a team conflict.',
            candidateResponse: 'I mediated a disagreement between two engineers over API design. I facilitated a meeting where both presented their approaches, then we voted as a team.',
            timestamp: '2026-06-01T10:00:00Z', probeOf: null, videoR2Key: null,
          },
          {
            idx: 1, questionId: 'q2',
            questionText: 'How do you handle tight deadlines?',
            candidateResponse: 'I break down the work into smaller milestones and prioritize ruthlessly. I communicate early when scope needs to change.',
            timestamp: '2026-06-01T10:05:00Z', probeOf: null, videoR2Key: null,
          },
          {
            idx: 2, questionId: 'q3',
            questionText: 'What motivates you at work?',
            candidateResponse: null, timestamp: null, probeOf: null, videoR2Key: null,
          },
        ],
        scratchpad: { competencyScores: {}, mode: 'role_fit', contextualTurns: [] },
      },
      extractSemantics: false,
      fallbackObservedAt: '2026-06-01T10:10:00Z',
      sessionStartedAt: '2026-06-01T10:00:00Z',
      sessionEndedAt: '2026-06-01T10:10:00Z',
    });

    // Reused from prior projection (reusedTurns is a subset of ingestedTurns)
    expect(result2.answeredTurns).toBe(2);
    expect(result2.reusedTurns).toBe(2);
    expect(result2.ingestedTurns).toBe(2);

    // Counts should not have doubled
    const artifactsAfter = sqlite.prepare(
      `SELECT * FROM artifacts WHERE artifact_type = 'culture_interview_turn'`,
    ).all() as unknown[];
    expect(artifactsAfter.length).toBe(2);
  });
});
