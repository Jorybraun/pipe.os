import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveCorpusGenericConcepts,
  matchContrastSeparation,
  matchCandidateToReviewChallenge,
} from '../d1Matcher';
import type { ChallengePacket } from '../types';
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
  sha256,
  type ChallengePacket as RepoChallengePacket,
  type NormalizedPullRequestInput,
  type SourceArtifactKind,
  type SymbolKind,
} from '../../repoSemanticGraph';
import { ingestMeetingTranscriptToLivingContext } from '../../livingContext/meetingTranscript';
import { ensureCandidateLivingContext } from '../../livingContext/compatibility';
import { insertCandidateNode } from '../../candidateDiscovery/candidateNodes';


const livingMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const candidateNodesMigration = readFileSync(
  new URL('../../../../migrations/0052_candidate_nodes.sql', import.meta.url),
  'utf8',
);
const candidateNodeIdempotencyMigration = readFileSync(
  new URL('../../../../migrations/0085_candidate_node_idempotency.sql', import.meta.url),
  'utf8',
);
const matchingMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
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
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const assessmentLayerMigration = readFileSync(
  new URL('../../../../migrations/0102_assessment_layer.sql', import.meta.url),
  'utf8',
);

describe('matchContrastSeparation', () => {
  it('uses candidate-evidence separation when blended final scores are flattened by role constants', () => {
    expect(matchContrastSeparation(
      { finalScore: 0.5371535955087716, candidateEvidenceAlignment: 0.10430719101754309 },
      { finalScore: 0.518449074074074, candidateEvidenceAlignment: 0.06689814814814814 },
    )).toBeCloseTo(0.03740904286939495, 8);
  });

  it('returns null when there is no comparable challenge', () => {
    expect(matchContrastSeparation(
      { finalScore: 0.5371535955087716, candidateEvidenceAlignment: 0.10430719101754309 },
      null,
    )).toBeNull();
  });
});

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

const require = createRequire(import.meta.url);
const DatabaseSync = require('better-sqlite3') as new (path: string) => NodeSqliteDatabase;

const OBSERVED_AT = '2026-06-14T08:00:00.000Z';

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
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      sqlite.exec('BEGIN');
      try {
        for (const statement of statements) {
          results.push(await statement.run<T>());
        }
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      return results;
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

async function buildRepoChangedFile(input: {
  repoSnapshotId: string;
  path: string;
  content: string;
  symbolName: string;
  symbolKind: SymbolKind;
  signature: string;
  artifactKind?: SourceArtifactKind;
}) {
  const artifact = await buildSourceArtifact({
    repoSnapshotId: input.repoSnapshotId,
    kind: input.artifactKind ?? 'source',
    path: input.path,
    language: 'typescript',
  });
  const artifactVersion = await buildSourceArtifactVersion({
    artifactId: artifact.id,
    repoSnapshotId: input.repoSnapshotId,
    content: input.content,
    createdAt: OBSERVED_AT,
  });
  const sourceSpan = await buildSourceSpan({
    repoSnapshotId: input.repoSnapshotId,
    artifactId: artifact.id,
    artifactVersionId: artifactVersion.id,
    contentHash: artifactVersion.contentHash,
    start: { byteOffset: 0, line: 1, column: 1 },
    end: sourceEndPosition(input.content),
    exactText: input.content,
    displayLabel: `${input.path}:1-${input.content.split('\n').length}`,
    prSide: 'head',
  });
  const symbol = await buildSymbol({
    repoSnapshotId: input.repoSnapshotId,
    language: 'typescript',
    qualifiedName: `${input.path}:${input.symbolName}`,
    name: input.symbolName,
    kind: input.symbolKind,
    signature: input.signature,
    definingSpanId: sourceSpan.id,
    exported: true,
  });

  return {
    file: {
      path: input.path,
      status: 'modified' as const,
      language: 'typescript',
      additions: input.content.split('\n').length,
      deletions: 0,
      artifact,
      artifactVersion,
      hunks: [{
        header: `@@ ${input.symbolName} @@`,
        patch: input.content,
        sourceSpan,
        changedSymbolIds: [symbol.id],
      }],
      symbols: [symbol],
    },
    sourceSpan,
    symbol,
  };
}

async function buildProductionReadyRepoChallengeFixture(): Promise<{
  input: NormalizedPullRequestInput;
  packet: RepoChallengePacket;
  graph: Parameters<typeof persistReviewChallengeGraph>[4];
}> {
  const repoSnapshot = await buildRepoSnapshot({
    repository: {
      provider: 'github',
      owner: 'pipe',
      name: 'orders',
      canonicalUrl: 'https://github.com/pipe/orders',
    },
    commitSha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    defaultBranch: 'main',
    observedAt: OBSERVED_AT,
  });
  const primary = await buildRepoChangedFile({
    repoSnapshotId: repoSnapshot.id,
    path: 'src/ordersKafkaRetry.ts',
    symbolName: 'publishKafkaRetry',
    symbolKind: 'function',
    signature: 'export function publishKafkaRetry(eventId: string, attempt: number): KafkaRetryEnvelope',
    content: [
      'import { createKafkaRetryKey } from "./kafkaRetryKey";',
      '',
      'export function publishKafkaRetry(eventId: string, attempt: number) {',
      '  const key = createKafkaRetryKey(eventId);',
      '  const topic = "orders.retry.kafka";',
      '  const headers = { "idempotency-key": key, attempt };',
      '  return { key, topic, headers, idempotent: true };',
      '}',
    ].join('\n'),
  });
  const helper = await buildRepoChangedFile({
    repoSnapshotId: repoSnapshot.id,
    path: 'src/kafkaRetryKey.ts',
    symbolName: 'createKafkaRetryKey',
    symbolKind: 'function',
    signature: 'export function createKafkaRetryKey(eventId: string): string',
    content: [
      'export function createKafkaRetryKey(eventId: string) {',
      '  const normalized = eventId.trim().toLowerCase();',
      '  const prefix = "kafka-retry";',
      '  const suffix = normalized || "missing-event";',
      '  return `${prefix}:${suffix}`;',
      '}',
    ].join('\n'),
  });
  const test = await buildRepoChangedFile({
    repoSnapshotId: repoSnapshot.id,
    path: 'src/ordersKafkaRetry.test.ts',
    symbolName: 'validatesKafkaRetryIdempotency',
    symbolKind: 'test',
    signature: 'it("validates kafka retry idempotency", () => void)',
    content: [
      'import { describe, expect, it } from "vitest";',
      'import { publishKafkaRetry } from "./ordersKafkaRetry";',
      '',
      'describe("publishKafkaRetry", () => {',
      '  it("validates kafka retry idempotency", () => {',
      '    const envelope = publishKafkaRetry("ORDER-123", 2);',
      '    expect(envelope.key).toBe("kafka-retry:order-123");',
      '    expect(envelope.headers["idempotency-key"]).toBe(envelope.key);',
      '  });',
      '});',
    ].join('\n'),
  });
  const issueText = [
    'Issue #88: Kafka retry publishing needs idempotent envelopes.',
    'The review should check exact retry keys, Kafka topic routing, and test coverage.',
  ].join('\n');
  const issueArtifact = await buildSourceArtifact({
    repoSnapshotId: repoSnapshot.id,
    kind: 'issue',
    externalRef: 'https://github.com/pipe/orders/issues/88',
    mediaType: 'text/markdown',
  });
  const issueVersion = await buildSourceArtifactVersion({
    artifactId: issueArtifact.id,
    repoSnapshotId: repoSnapshot.id,
    content: issueText,
    createdAt: OBSERVED_AT,
  });
  const issueSpan = await buildSourceSpan({
    repoSnapshotId: repoSnapshot.id,
    artifactId: issueArtifact.id,
    artifactVersionId: issueVersion.id,
    contentHash: issueVersion.contentHash,
    start: { byteOffset: 0, line: 1, column: 1 },
    end: sourceEndPosition(issueText),
    exactText: issueText,
    displayLabel: 'issues/88:1-2',
    prSide: 'metadata',
  });

  const input: NormalizedPullRequestInput = {
    repoSnapshot,
    number: 88,
    url: 'https://github.com/pipe/orders/pull/88',
    title: 'Add idempotent Kafka retry publishing',
    body: 'Implements exact Kafka retry keys and coverage for idempotent retry envelopes.',
    author: 'engineer',
    primaryLanguage: 'TypeScript',
    baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headSha: repoSnapshot.commitSha,
    mergedAt: OBSERVED_AT,
    metadataSourceSpanIds: [issueSpan.id],
    sourceArtifacts: [issueArtifact],
    sourceArtifactVersions: [issueVersion],
    sourceSpans: [primary.sourceSpan, helper.sourceSpan, test.sourceSpan, issueSpan],
    changedFiles: [primary.file, helper.file, test.file],
    tests: [{
      path: test.file.path,
      framework: 'vitest',
      sourceSpanIds: [test.sourceSpan.id],
      relatedSymbolIds: [test.symbol.id],
    }],
    issue: {
      number: 88,
      title: 'Kafka retry publishing needs idempotent envelopes',
      body: issueText,
      labels: [],
      sourceSpanIds: [issueSpan.id],
    },
  };
  const fact = await buildStructuralFact({
    repoSnapshotId: repoSnapshot.id,
    kind: 'calls',
    subject: { symbolId: primary.symbol.id },
    object: { symbolId: helper.symbol.id },
    sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id],
    confidence: 0.94,
    parser: 'typescript-compiler-api-test',
  });
  const episode = await buildCodeEpisode({
    repoSnapshotId: repoSnapshot.id,
    title: 'kafka-retry-idempotency',
    narrative: 'The PR implements Kafka retry idempotency and verifies the retry key contract.',
    symbolIds: [primary.symbol.id, helper.symbol.id, test.symbol.id],
    structuralFactIds: [fact.id],
    sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
    conceptKeys: ['term:kafka', 'term:retry', 'term:idempotency'],
  });
  const facet = await buildFacet({
    repoSnapshotId: repoSnapshot.id,
    kind: 'source-derived-mechanism',
    key: 'kafka-retry-idempotency',
    label: 'Kafka retry idempotency',
    aliases: [],
    sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
    confidence: 0.91,
  });
  const assertion = await buildSemanticAssertion({
    repoSnapshotId: repoSnapshot.id,
    episodeId: episode.id,
    subject: primary.symbol.id,
    predicate: 'implements.source.backed.kafka.retry.idempotency',
    object: 'term:kafka',
    narrative: 'The source implements Kafka retry idempotency with exact retry key verification.',
    qualifiers: { source: 'normalized-pr-fixture' },
    facetIds: [facet.id],
    conceptKeys: ['term:kafka', 'term:retry', 'term:idempotency'],
    sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
    confidence: 0.92,
    extractor: 'repo-semantic-test-v1',
  });
  const signal = await buildRepoSignal({
    repoSnapshotId: repoSnapshot.id,
    key: 'kafka-retry-idempotency',
    narrative: 'The repository demonstrates Kafka retry idempotency backed by exact source and test spans.',
    assertionIds: [assertion.id],
    facetIds: [facet.id],
    sourceSpanIds: [primary.sourceSpan.id, helper.sourceSpan.id, test.sourceSpan.id],
    confidence: 0.9,
    sourceDiversity: 3,
  });

  return {
    input,
    packet: await buildChallengePacket(input),
    graph: {
      structuralFacts: [fact],
      codeEpisodes: [episode],
      facets: [facet],
      semanticAssertions: [assertion],
      repoSignals: [signal],
    },
  };
}

async function buildMuiBaseUiPopoverChallengeFixture(): Promise<{
  input: NormalizedPullRequestInput;
  packet: RepoChallengePacket;
  graph: Parameters<typeof persistReviewChallengeGraph>[4];
}> {
  const repoSnapshot = await buildRepoSnapshot({
    repository: {
      provider: 'github',
      owner: 'mui',
      name: 'base-ui',
      canonicalUrl: 'https://github.com/mui/base-ui',
    },
    commitSha: '33e161fd46dfc287dfcde05427594db9a7225335',
    defaultBranch: 'main',
    parentCommitShas: ['58dff8444fa56e4444a3a1dd991c76b49cf4ab7e'],
    observedAt: '2024-12-09T00:08:55.000Z',
  });
  const root = await buildRepoChangedFile({
    repoSnapshotId: repoSnapshot.id,
    path: 'packages/react/src/popover/root/usePopoverRoot.ts',
    symbolName: 'usePopoverRoot',
    symbolKind: 'function',
    signature: 'export function usePopoverRoot(params: PopoverRootParams): PopoverRootReturnValue',
    content: [
      'import * as React from "react";',
      'import { useClick } from "@floating-ui/react";',
      'import { PATIENT_CLICK_THRESHOLD } from "../utils/constants";',
      '',
      'export function usePopoverRoot(params: PopoverRootParams) {',
      '  const { context } = params;',
      '  const clickEnabledTimeoutRef = React.useRef<number | null>(null);',
      '  const [clickEnabled, setClickEnabled] = React.useState(true);',
      '',
      '  React.useEffect(() => {',
      '    if (!context.open) {',
      '      setClickEnabled(true);',
      '      return undefined;',
      '    }',
      '',
      '    setClickEnabled(false);',
      '    clickEnabledTimeoutRef.current = window.setTimeout(() => {',
      '      setClickEnabled(true);',
      '    }, PATIENT_CLICK_THRESHOLD);',
      '',
      '    return () => {',
      '      if (clickEnabledTimeoutRef.current !== null) {',
      '        window.clearTimeout(clickEnabledTimeoutRef.current);',
      '      }',
      '    };',
      '  }, [context.open]);',
      '',
      '  return useClick(context, {',
      '    enabled: clickEnabled,',
      '    stickIfOpen: false,',
      '  });',
      '}',
    ].join('\n'),
  });
  const constants = await buildRepoChangedFile({
    repoSnapshotId: repoSnapshot.id,
    path: 'packages/react/src/popover/utils/constants.ts',
    symbolName: 'PATIENT_CLICK_THRESHOLD',
    symbolKind: 'constant',
    signature: 'export const PATIENT_CLICK_THRESHOLD = 500',
    content: [
      'export const OPEN_DELAY = 300;',
      'export const PATIENT_CLICK_THRESHOLD = 500;',
    ].join('\n'),
  });
  const test = await buildRepoChangedFile({
    repoSnapshotId: repoSnapshot.id,
    path: 'packages/react/src/popover/trigger/PopoverTrigger.test.tsx',
    symbolName: 'doesNotCloseForImpatientClicks',
    symbolKind: 'test',
    artifactKind: 'test',
    signature: 'it("does not close for impatient trigger clicks after hover open", async () => void)',
    content: [
      'import { expect } from "chai";',
      'import { PATIENT_CLICK_THRESHOLD } from "../utils/constants";',
      '',
      'describe("PopoverTrigger", () => {',
      '  it("does not close for impatient trigger clicks after hover open", async () => {',
      '    const trigger = await renderPopoverTrigger();',
      '    await user.hover(trigger);',
      '    await wait(PATIENT_CLICK_THRESHOLD - 1);',
      '',
      '    trigger.click();',
      '',
      '    expect(trigger).to.have.attribute("data-popup-open");',
      '  });',
      '});',
    ].join('\n'),
  });
  const prText = [
    '[popover] Better handle impatient clicks',
    '',
    'When a popover opens from hover, an impatient click on the trigger should not immediately close it.',
    'Ignore trigger clicks for the patient click threshold window, then re-enable normal click closing.',
  ].join('\n');
  const prArtifact = await buildSourceArtifact({
    repoSnapshotId: repoSnapshot.id,
    kind: 'pull_request',
    externalRef: 'https://github.com/mui/base-ui/pull/973',
    mediaType: 'text/markdown',
  });
  const prVersion = await buildSourceArtifactVersion({
    artifactId: prArtifact.id,
    repoSnapshotId: repoSnapshot.id,
    content: prText,
    createdAt: '2024-12-09T00:08:55.000Z',
  });
  const prSpan = await buildSourceSpan({
    repoSnapshotId: repoSnapshot.id,
    artifactId: prArtifact.id,
    artifactVersionId: prVersion.id,
    contentHash: prVersion.contentHash,
    start: { byteOffset: 0, line: 1, column: 1 },
    end: sourceEndPosition(prText),
    exactText: prText,
    displayLabel: 'pull/973:1-4',
    prSide: 'metadata',
  });
  const callsFact = await buildStructuralFact({
    repoSnapshotId: repoSnapshot.id,
    kind: 'calls',
    subject: { symbolId: root.symbol.id },
    object: { concept: 'use click' },
    sourceSpanIds: [root.sourceSpan.id],
    confidence: 0.94,
    parser: 'typescript-compiler-api-live-shaped-test',
  });
  const importsFact = await buildStructuralFact({
    repoSnapshotId: repoSnapshot.id,
    kind: 'imports',
    subject: { symbolId: root.symbol.id },
    object: { symbolId: constants.symbol.id },
    sourceSpanIds: [root.sourceSpan.id, constants.sourceSpan.id],
    confidence: 0.93,
    parser: 'typescript-compiler-api-live-shaped-test',
  });
  const containsFact = await buildStructuralFact({
    repoSnapshotId: repoSnapshot.id,
    kind: 'contains',
    subject: { symbolId: root.symbol.id },
    object: { concept: 'popover click delay gate' },
    sourceSpanIds: [root.sourceSpan.id],
    confidence: 0.9,
    parser: 'typescript-compiler-api-live-shaped-test',
  });
  const sourceSpanIds = [root.sourceSpan.id, constants.sourceSpan.id, test.sourceSpan.id, prSpan.id];
  const input: NormalizedPullRequestInput = {
    repoSnapshot,
    number: 973,
    url: 'https://github.com/mui/base-ui/pull/973',
    title: '[popover] Better handle impatient clicks',
    body: 'If clicked within 500ms after hover open, ignore click; if open longer than the patient click threshold, close normally.',
    author: 'michaldudak',
    primaryLanguage: 'TypeScript',
    baseSha: '58dff8444fa56e4444a3a1dd991c76b49cf4ab7e',
    headSha: repoSnapshot.commitSha,
    mergedAt: '2024-12-09T00:08:55.000Z',
    metadataSourceSpanIds: [prSpan.id],
    sourceArtifacts: [prArtifact],
    sourceArtifactVersions: [prVersion],
    sourceSpans: [root.sourceSpan, constants.sourceSpan, test.sourceSpan, prSpan],
    changedFiles: [root.file, constants.file, test.file],
    tests: [{
      path: test.file.path,
      framework: 'javascript test runner',
      sourceSpanIds: [test.sourceSpan.id],
      relatedSymbolIds: [test.symbol.id],
    }],
    issue: {
      number: 973,
      title: '[popover] Better handle impatient clicks',
      body: prText,
      labels: [],
      sourceSpanIds: [prSpan.id],
    },
    structuralFacts: [callsFact, importsFact, containsFact],
  };
  const episode = await buildCodeEpisode({
    repoSnapshotId: repoSnapshot.id,
    title: 'popover-patient-click-threshold',
    narrative: 'The PR gates impatient popover trigger clicks with a patient click threshold and verifies the behavior.',
    symbolIds: [root.symbol.id, constants.symbol.id, test.symbol.id],
    structuralFactIds: [callsFact.id, importsFact.id, containsFact.id],
    sourceSpanIds,
    conceptKeys: [
      'term:popover',
      'term:click',
      'term:patient-click-threshold',
      'term:react',
      'term:typescript',
      'term:javascript-test-runner',
    ],
  });
  const facet = await buildFacet({
    repoSnapshotId: repoSnapshot.id,
    kind: 'source-derived-mechanism',
    key: 'popover-patient-click-threshold',
    label: 'Popover patient click threshold',
    aliases: ['impatient click handling'],
    sourceSpanIds,
    confidence: 0.92,
  });
  const assertion = await buildSemanticAssertion({
    repoSnapshotId: repoSnapshot.id,
    episodeId: episode.id,
    subject: root.symbol.id,
    predicate: 'implements.source.backed.popover.patient.click.threshold',
    object: 'term:patient-click-threshold',
    narrative: 'The source implements patient click threshold handling for popover trigger clicks.',
    qualifiers: { source: 'live-shaped-mui-base-ui-973-test' },
    facetIds: [facet.id],
    conceptKeys: [
      'term:popover',
      'term:click',
      'term:patient-click-threshold',
      'term:react',
      'term:typescript',
      'term:javascript-test-runner',
    ],
    sourceSpanIds,
    confidence: 0.93,
    extractor: 'repo-semantic-live-shaped-test-v1',
  });
  const signal = await buildRepoSignal({
    repoSnapshotId: repoSnapshot.id,
    key: 'popover-patient-click-threshold',
    narrative: 'The repository demonstrates source-backed popover impatient click handling with tests.',
    assertionIds: [assertion.id],
    facetIds: [facet.id],
    sourceSpanIds,
    confidence: 0.91,
    sourceDiversity: 4,
  });

  return {
    input,
    packet: await buildChallengePacket(input),
    graph: {
      structuralFacts: [callsFact, importsFact, containsFact],
      codeEpisodes: [episode],
      facets: [facet],
      semanticAssertions: [assertion],
      repoSignals: [signal],
    },
  };
}

async function seedProductionReadyPacket(
  sqlite: NodeSqliteDatabase,
  repoId = 41,
): Promise<{
  input: NormalizedPullRequestInput;
  packet: RepoChallengePacket;
  graph: Parameters<typeof persistReviewChallengeGraph>[4];
}> {
  sqlite.prepare('INSERT INTO qualified_repos (id) VALUES (?)').run(repoId);
  const data = await buildProductionReadyRepoChallengeFixture();
  await persistReviewChallengeGraph(
    createNodeSqliteD1(sqlite),
    repoId,
    data.input,
    data.packet,
    data.graph,
  );
  return data;
}

function testConceptIdForKey(canonicalKey: string): string {
  return `repo-context-concept-${canonicalKey.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function testConceptNamespace(canonicalKey: string): string {
  const separator = canonicalKey.indexOf(':');
  return separator > 0 ? canonicalKey.slice(0, separator) : 'open';
}

function testConceptLabel(canonicalKey: string): string {
  const separator = canonicalKey.indexOf(':');
  const raw = separator >= 0 ? canonicalKey.slice(separator + 1) : canonicalKey;
  return raw.replace(/[-_]+/g, ' ').trim() || canonicalKey;
}

function seedReviewPacketContextProjection(
  sqlite: NodeSqliteDatabase,
  packet: RepoChallengePacket,
): void {
  const contextRecordId = `context-record-${packet.id}`;
  sqlite.prepare(
    `INSERT INTO context_records (
       id, ingestion_key, scope_type, scope_id, record_type, predicate, narrative,
       qualifiers_json, confidence, polarity, extraction_version, observed_at, created_at, updated_at
     ) VALUES (?, ?, 'repo_snapshot', ?, 'repo_challenge_packet',
       'defines reviewable pull request challenge', ?, '{}', ?, 1, ?, ?, ?, ?)`,
  ).run(
    contextRecordId,
    `repo-challenge-packet-context:${packet.id}`,
    packet.repoSnapshotId,
    `Review challenge packet for ${packet.repository.owner}/${packet.repository.name} PR #${packet.pullRequest.number}: ${packet.pullRequest.title}`,
    packet.quality.metrics.provenanceCoverage,
    packet.schemaVersion,
    OBSERVED_AT,
    OBSERVED_AT,
    OBSERVED_AT,
  );

  for (const spanId of [...new Set(packet.sourceSpanIds)].sort()) {
    sqlite.prepare(
      `INSERT INTO context_record_source_refs (
         context_record_id, source_ref_type, source_ref_id, source_span_id,
         evidence_role, locator_json, exact_text, content_hash, metadata_json, created_at
       ) VALUES (?, 'repo_source_span', ?, NULL, 'source', '{}', NULL, NULL, '{}', ?)`,
    ).run(contextRecordId, spanId, OBSERVED_AT);
  }

  for (const canonicalKey of [...new Set(packet.demands.flatMap((demand) => demand.conceptKeys))].sort()) {
    const existing = sqlite.prepare(
      'SELECT id FROM concepts WHERE canonical_key = ?',
    ).get(canonicalKey) as { id: string } | undefined;
    const conceptId = existing?.id ?? testConceptIdForKey(canonicalKey);
    if (!existing) {
      sqlite.prepare(
        `INSERT INTO concepts (
           id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, '[]', '{}', ?, ?)`,
      ).run(
        conceptId,
        `repo-context-concept:${canonicalKey}`,
        canonicalKey,
        testConceptNamespace(canonicalKey),
        testConceptLabel(canonicalKey),
        OBSERVED_AT,
        OBSERVED_AT,
      );
    }
    sqlite.prepare(
      `INSERT INTO context_record_concepts (
         context_record_id, concept_id, relationship, weight, created_at
       ) VALUES (?, ?, 'concept', 1, ?)`,
    ).run(contextRecordId, conceptId, OBSERVED_AT);
  }
}

async function seedProductionReadyPacketWithoutSourceSpans(
  sqlite: NodeSqliteDatabase,
  repoId = 1,
): Promise<{
  input: NormalizedPullRequestInput;
  packet: RepoChallengePacket;
}> {
  sqlite.prepare('INSERT INTO qualified_repos (id) VALUES (?)').run(repoId);
  const data = await buildProductionReadyRepoChallengeFixture();
  sqlite.prepare(
    `INSERT INTO repo_snapshots (
       id, repo_id, commit_sha, extractor_version
     ) VALUES (?, ?, ?, ?)`,
  ).run(
    data.input.repoSnapshot.id,
    repoId,
    data.input.repoSnapshot.commitSha,
    '1.0.0',
  );
  sqlite.prepare(
    `INSERT INTO review_challenge_packets (
       id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash,
       language, production_ready, quality_score, demand_families_json, packet_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    data.packet.id,
    data.packet.repoSnapshotId,
    repoId,
    data.packet.pullRequest.number,
    data.packet.policyVersion,
    data.packet.contentHash,
    data.packet.languageSupport.normalizedLanguage,
    1,
    data.packet.quality.score,
    JSON.stringify(data.packet.demandFamilies),
    JSON.stringify(data.packet),
  );
  seedReviewPacketContextProjection(sqlite, data.packet);
  return data;
}


function seedCandidateEvidence(sqlite: NodeSqliteDatabase): void {
  const now = OBSERVED_AT;
  sqlite.exec(`
    INSERT INTO people (
      id, ingestion_key, display_name, primary_email, external_ids_json, created_at, updated_at
    ) VALUES (
      'person-1', 'person-1', 'Candidate One', 'candidate@example.com', '{}', '${now}', '${now}'
    );
    INSERT INTO workspace_people (
      id, ingestion_key, workspace_id, person_id, context_json, created_at, updated_at
    ) VALUES (
      'workspace-person-1', 'workspace-person-1', 'workspace-1', 'person-1', '{}', '${now}', '${now}'
    );
    INSERT INTO applications (
      id, ingestion_key, workspace_person_id, legacy_candidate_id, context_json, created_at, updated_at
    ) VALUES (
      'application-1', 'application-1', 'workspace-person-1', 'candidate-1', '{}', '${now}', '${now}'
    );
    INSERT INTO interactions (
      id, ingestion_key, workspace_person_id, application_id, interaction_type, metadata_json, created_at, updated_at
    ) VALUES (
      'interaction-1', 'interaction-1', 'workspace-person-1', 'application-1', 'assessment', '{}', '${now}', '${now}'
    );
    INSERT INTO artifacts (
      id, ingestion_key, workspace_person_id, interaction_id, artifact_type, metadata_json, created_at, updated_at
    ) VALUES (
      'artifact-1', 'artifact-1', 'workspace-person-1', 'interaction-1', 'assessment_response', '{}', '${now}', '${now}'
    );
    INSERT INTO artifact_versions (
      id, ingestion_key, artifact_id, version_number, content_hash, media_type, content_text, byte_length, metadata_json, created_at
    ) VALUES (
      'artifact-version-1', 'artifact-version-1', 'artifact-1', 1, 'sha256:candidate', 'text/plain',
      'implemented kafka idempotency and validated retry handling', 57, '{}', '${now}'
    );
    INSERT INTO source_spans (
      id, ingestion_key, artifact_version_id, byte_start, byte_end, char_start, char_end,
      line_start, line_end, exact_text, exact_text_hash, metadata_json, created_at
    ) VALUES
      (
        'candidate-span-1', 'candidate-span-1', 'artifact-version-1', 0, 28, 0, 28, 1, 1,
        'implemented kafka idempotency', 'sha256:candidate-span-1', '{}', '${now}'
      ),
      (
        'candidate-span-2', 'candidate-span-2', 'artifact-version-1', 33, 57, 33, 57, 1, 1,
        'validated retry handling', 'sha256:candidate-span-2', '{}', '${now}'
      );
    INSERT INTO episodes (
      id, ingestion_key, workspace_person_id, interaction_id, narrative, metadata_json, created_at, updated_at
    ) VALUES
      (
        'episode-1', 'episode-1', 'workspace-person-1', 'interaction-1',
        'Candidate described implemented Kafka idempotency.', '{}', '${now}', '${now}'
      ),
      (
        'episode-2', 'episode-2', 'workspace-person-1', 'interaction-1',
        'Candidate described validated retry handling.', '{}', '${now}', '${now}'
      );
    INSERT INTO concepts (
      id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, created_at, updated_at
    ) VALUES (
      'concept-kafka', 'concept-kafka', 'term:kafka', 'term', 'kafka', '[]', '{}', '${now}', '${now}'
    );
    INSERT INTO semantic_assertions (
      id, ingestion_key, workspace_person_id, episode_id, subject_type, subject_id,
      predicate, object_type, object_value_json, narrative, qualifiers_json, confidence,
      polarity, extraction_version, observed_at, created_at, updated_at
    ) VALUES
      (
        'assertion-1', 'assertion-1', 'workspace-person-1', 'episode-1', 'person', 'person-1',
        'implemented', 'concept', '{"value":"kafka"}',
        'Candidate implemented Kafka idempotency.', '{}', 1, 1, 'test', '${now}', '${now}', '${now}'
      ),
      (
        'assertion-2', 'assertion-2', 'workspace-person-1', 'episode-2', 'person', 'person-1',
        'validated', 'concept', '{"value":"kafka"}',
        'Candidate validated retry handling.', '{}', 1, 1, 'test', '${now}', '${now}', '${now}'
      );
    INSERT INTO assertion_source_spans (assertion_id, source_span_id, evidence_role, created_at)
    VALUES
      ('assertion-1', 'candidate-span-1', 'support', '${now}'),
      ('assertion-2', 'candidate-span-2', 'support', '${now}');
    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES
      ('assertion-1', 'concept-kafka', 'about', 1, '${now}'),
      ('assertion-2', 'concept-kafka', 'about', 1, '${now}');
    INSERT INTO signal_evidence (
      id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id,
      signal_key, evidence_level, strength, polarity, metadata_json, created_at, updated_at
    ) VALUES
      (
        'evidence-1', 'evidence-1', 'workspace-person-1', 'interaction-1', 'assertion-1', 'concept-kafka',
        'term:kafka', 'implemented', 1, 1, '{}', '${now}', '${now}'
      ),
      (
        'evidence-2', 'evidence-2', 'workspace-person-1', 'interaction-1', 'assertion-2', 'concept-kafka',
        'term:kafka', 'validated', 1, 1, '{}', '${now}', '${now}'
      );
  `);
}

async function seedMeetingTranscriptCandidateEvidence(
  sqlite: NodeSqliteDatabase,
): Promise<{ transcriptText: string }> {
  const transcriptText = 'I implemented Kafka retry idempotency for order replay and validated retry behavior.';
  sqlite.prepare(
    `INSERT INTO contacts (
       id, owner_id, name, email, phone, company, role, type, created_at, updated_at
     ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
  ).run(
    'contact-1',
    'workspace-1',
    'Candidate One',
    'candidate@example.com',
    'Distributed systems engineer',
    'candidate',
    OBSERVED_AT,
    OBSERVED_AT,
  );
  sqlite.prepare(
    `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    'meeting-1',
    'workspace-1',
    '2026-06-14T07:30:00.000Z',
    OBSERVED_AT,
    OBSERVED_AT,
  );
  sqlite.prepare(
    `INSERT INTO meeting_participants (
       id, meeting_id, contact_id, role, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'participant-1',
    'meeting-1',
    'contact-1',
    'ATTENDEE',
    OBSERVED_AT,
    OBSERVED_AT,
  );

  const db = createNodeSqliteD1(sqlite);
  await ingestMeetingTranscriptToLivingContext(db, {
    meetingId: 'meeting-1',
    ownerId: 'workspace-1',
    segments: [
      {
        stableSegmentId: 'host-1',
        text: 'What production systems have you owned?',
        speakerRole: 'host',
        timestampStartMs: 1_000,
        timestampEndMs: 2_000,
      },
      {
        stableSegmentId: 'guest-1',
        text: transcriptText,
        speakerRole: 'guest',
        contactId: 'contact-1',
        timestampStartMs: 2_100,
        timestampEndMs: 6_500,
        confidence: 0.98,
      },
    ],
    semanticAssertions: [
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Candidate implemented Kafka retry idempotency.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'Kafka retry idempotency' },
        confidence: 0.96,
        concepts: [
          {
            surface: 'Kafka',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
          {
            surface: 'idempotency',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'validated',
        narrative: 'Candidate validated retry behavior.',
        objectType: 'source-described validation',
        objectValue: { surface: 'retry behavior validation' },
        confidence: 0.96,
        concepts: [
          {
            surface: 'Kafka',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
          {
            surface: 'retry',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
        ],
      },
    ],
    extractorVersion: 'matcher-transcript-proof-v1',
    provider: 'test-transcript-provider',
    startedAt: '2026-06-14T07:30:00.000Z',
    endedAt: OBSERVED_AT,
    personContextMode: 'attributed',
  });
  const identity = await ensureCandidateLivingContext(db, 'candidate-1');
  expect(identity).not.toBeNull();
  return { transcriptText };
}

async function seedMuiBaseUiMeetingTranscriptCandidateEvidence(
  sqlite: NodeSqliteDatabase,
): Promise<{ transcriptText: string }> {
  const transcriptText = [
    'I implemented React TypeScript popover click handling in usePopoverRoot,',
    'introduced a patient click threshold for impatient trigger clicks,',
    'and validated the popover trigger behavior with a JavaScript test runner.',
  ].join(' ');
  sqlite.prepare(
    `INSERT INTO contacts (
       id, owner_id, name, email, phone, company, role, type, created_at, updated_at
     ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
  ).run(
    'contact-mui-1',
    'workspace-1',
    'Candidate One',
    'candidate@example.com',
    'React component systems engineer',
    'candidate',
    OBSERVED_AT,
    OBSERVED_AT,
  );
  sqlite.prepare(
    `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    'meeting-mui-1',
    'workspace-1',
    '2026-06-14T07:30:00.000Z',
    OBSERVED_AT,
    OBSERVED_AT,
  );
  sqlite.prepare(
    `INSERT INTO meeting_participants (
       id, meeting_id, contact_id, role, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'participant-mui-1',
    'meeting-mui-1',
    'contact-mui-1',
    'ATTENDEE',
    OBSERVED_AT,
    OBSERVED_AT,
  );

  const db = createNodeSqliteD1(sqlite);
  await ingestMeetingTranscriptToLivingContext(db, {
    meetingId: 'meeting-mui-1',
    ownerId: 'workspace-1',
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
        text: transcriptText,
        speakerRole: 'guest',
        contactId: 'contact-mui-1',
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
        concepts: [
          {
            surface: 'React',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Candidate implemented TypeScript popover click handling in usePopoverRoot.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'TypeScript popover click handling' },
        confidence: 0.98,
        concepts: [
          {
            surface: 'TypeScript',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Candidate implemented popover click handling in usePopoverRoot.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'popover click handling' },
        confidence: 0.98,
        concepts: [
          {
            surface: 'popover',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Candidate implemented click handling in usePopoverRoot.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'click handling' },
        confidence: 0.98,
        concepts: [
          {
            surface: 'click',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'implemented',
        narrative: 'Candidate implemented usePopoverRoot behavior for popover clicks.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'usePopoverRoot' },
        confidence: 0.98,
        concepts: [
          {
            surface: 'usePopoverRoot',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'introduced',
        narrative: 'Candidate introduced a patient click threshold for impatient trigger clicks.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'patient click threshold' },
        confidence: 0.99,
        concepts: [
          {
            surface: 'patient click threshold',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'validated',
        narrative: 'Candidate validated popover trigger behavior with a JavaScript test runner.',
        objectType: 'source-described validation',
        objectValue: { surface: 'JavaScript test runner' },
        confidence: 0.99,
        concepts: [
          {
            surface: 'JavaScript test runner',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'validated',
        narrative: 'Candidate validated popover trigger behavior.',
        objectType: 'source-described validation',
        objectValue: { surface: 'popover trigger' },
        confidence: 0.99,
        concepts: [
          {
            surface: 'popover trigger',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'validated',
        narrative: 'Candidate validated trigger click behavior.',
        objectType: 'source-described validation',
        objectValue: { surface: 'trigger click behavior' },
        confidence: 0.98,
        concepts: [
          {
            surface: 'click',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
        ],
      },
    ],
    extractorVersion: 'matcher-mui-transcript-proof-v1',
    provider: 'test-transcript-provider',
    startedAt: '2026-06-14T07:30:00.000Z',
    endedAt: OBSERVED_AT,
    personContextMode: 'attributed',
  });
  const identity = await ensureCandidateLivingContext(db, 'candidate-1');
  expect(identity).not.toBeNull();
  return { transcriptText };
}

async function seedMuiBaseUiResumeCandidateEvidence(
  sqlite: NodeSqliteDatabase,
  options: {
    mirrorLivingContext?: boolean;
    termMode?: 'ideal' | 'extractor-compounds';
  } = {},
): Promise<{ resumeText: string }> {
  const db = createNodeSqliteD1(sqlite);
  const resumeText = [
    'Senior frontend platform engineer with deep React and TypeScript experience.',
    'Recently implemented popover trigger click handling in usePopoverRoot for a large component library.',
    'Designed a patient click threshold so impatient trigger clicks do not immediately close hover-open popovers.',
    'Validated the behavior with JavaScript test runner coverage and defended review decisions to implementation authors.',
  ].join(' ');
  const capturedAt = Math.floor(new Date(OBSERVED_AT).getTime() / 1000);
  const idealTerms = [
    { surface: 'popover', canonical_key: 'term:popover', evidence_level: 'demonstrated' },
    { surface: 'click', canonical_key: 'term:click', evidence_level: 'demonstrated' },
    { surface: 'patient click threshold', canonical_key: 'term:patient-click-threshold', evidence_level: 'demonstrated' },
    { surface: 'React', canonical_key: 'term:react', evidence_level: 'demonstrated' },
    { surface: 'TypeScript', canonical_key: 'term:typescript', evidence_level: 'demonstrated' },
    { surface: 'JavaScript test runner', canonical_key: 'term:javascript-test-runner', evidence_level: 'validated' },
  ];
  const productionCompoundTerms = [
    [
      { surface: 'click handling usePopoverRoot', canonical_key: 'term:click-handling-use-popover-root', evidence_level: 'implemented' },
    ],
    [
      { surface: 'click threshold impatient', canonical_key: 'term:click-threshold-impatient', evidence_level: 'implemented' },
    ],
    [
      { surface: 'javascript test runner', canonical_key: 'term:javascript-test-runner', evidence_level: 'validated' },
    ],
  ];
  const nodeInputs = [
    {
      type: 'Experience',
      narrative: 'Implemented React TypeScript popover trigger click handling in usePopoverRoot.',
      terms: options.termMode === 'extractor-compounds' ? productionCompoundTerms[0]! : idealTerms,
      confidence: 0.98,
    },
    {
      type: 'Project',
      narrative: 'Designed patient click threshold behavior for impatient trigger clicks.',
      terms: options.termMode === 'extractor-compounds' ? productionCompoundTerms[1]! : idealTerms,
      confidence: 0.97,
    },
    {
      type: 'Skill',
      narrative: 'Validated popover trigger behavior with a JavaScript test runner.',
      terms: options.termMode === 'extractor-compounds' ? productionCompoundTerms[2]! : idealTerms,
      confidence: 0.96,
    },
  ];

  for (const [index, node] of nodeInputs.entries()) {
    await insertCandidateNode(
      db,
      {
        candidate_id: 'candidate-1',
        node_type: node.type,
        narrative_text: node.narrative,
        extracted_properties_json: JSON.stringify({
          semantic_terms: node.terms,
          source_quote: resumeText,
          source_quote_validated: true,
          source_quote_char_start: 0,
          source_quote_char_end: resumeText.length,
          index,
        }),
        embedding_json: null,
        source_type: 'resume',
        source_reference: 'resume-smoke',
        captured_at: capturedAt,
        confidence: node.confidence,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'test-resume-v1',
      },
      { mirrorLivingContext: options.mirrorLivingContext },
    );
  }

  const identity = await ensureCandidateLivingContext(db, 'candidate-1');
  expect(identity).not.toBeNull();
  return { resumeText };
}

function moveCandidateMeaningToContextRecords(sqlite: NodeSqliteDatabase): void {
  const now = OBSERVED_AT;
  sqlite.exec(`
    DELETE FROM assertion_source_spans;
    DELETE FROM assertion_concepts;
    INSERT INTO context_records (
      id, ingestion_key, scope_type, scope_id, workspace_person_id,
      interaction_id, application_id, episode_id, assertion_id, record_type,
      predicate, narrative, qualifiers_json, confidence, polarity,
      extraction_version, observed_at, created_at, updated_at
    ) VALUES
      (
        'context-record-1', 'context-record-1', 'workspace_person', 'workspace-person-1', 'workspace-person-1',
        'interaction-1', 'application-1', 'episode-1', 'assertion-1', 'assessment_context_assertion',
        'implemented', 'Candidate implemented Kafka idempotency.', '{}', 1, 1,
        'test', '${now}', '${now}', '${now}'
      ),
      (
        'context-record-2', 'context-record-2', 'workspace_person', 'workspace-person-1', 'workspace-person-1',
        'interaction-1', 'application-1', 'episode-2', 'assertion-2', 'assessment_context_assertion',
        'validated', 'Candidate validated retry handling.', '{}', 1, 1,
        'test', '${now}', '${now}', '${now}'
      );
    INSERT INTO context_record_source_refs (
      context_record_id, source_ref_type, source_ref_id, source_span_id,
      evidence_role, locator_json, exact_text, content_hash, metadata_json, created_at
    ) VALUES
      (
        'context-record-1', 'source_span', 'candidate-span-1', 'candidate-span-1',
        'source', '{}', 'implemented kafka idempotency', 'sha256:candidate', '{}', '${now}'
      ),
      (
        'context-record-2', 'source_span', 'candidate-span-2', 'candidate-span-2',
        'source', '{}', 'validated retry handling', 'sha256:candidate', '{}', '${now}'
      );
    INSERT INTO context_record_concepts (context_record_id, concept_id, relationship, weight, created_at)
    VALUES
      ('context-record-1', 'concept-kafka', 'about', 1, '${now}'),
      ('context-record-2', 'concept-kafka', 'about', 1, '${now}');
  `);
}

function seedIneligiblePacket(sqlite: NodeSqliteDatabase): void {
  const packet: RepoChallengePacket = {
    schemaVersion: '1.0.0',
    policyVersion: 'repo-challenge-v1',
    id: 'packet-ineligible-smallest-pr',
    repoSnapshotId: 'snapshot-ineligible',
    repository: {
      provider: 'github',
      owner: 'pipe',
      name: 'orders',
      canonicalUrl: 'https://github.com/pipe/orders',
    },
    pullRequest: {
      number: 1,
      url: 'https://github.com/pipe/orders/pull/1',
      title: 'Rust retry implementation',
      author: 'engineer',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'cccccccccccccccccccccccccccccccccccccccc',
      mergedAt: '2026-06-14T08:00:00.000Z',
    },
    languageSupport: {
      language: 'Rust',
      normalizedLanguage: 'rust',
      level: 'structural_only',
      parser: 'tree-sitter-rust',
      challengePacketsAllowed: false,
      reason: 'rust is searchable through structural extraction but is not validated for challenge packets',
    },
    changedFilePaths: ['src/orders.rs'],
    changedSymbolIds: [],
    sourceSpanIds: ['repo-span-ineligible'],
    testChanges: [],
    demands: [
      {
        id: 'demand-ineligible',
        family: 'artifact:source',
        narrative: 'Review Kafka idempotency implementation.',
        conceptKeys: ['term:kafka'],
        mechanisms: ['term:kafka'],
        sourceSpanIds: ['repo-span-ineligible'],
        changedSymbolIds: [],
        weight: 1,
        contentHash: 'sha256:demand-ineligible',
      },
    ],
    demandFamilies: ['artifact:source'],
    quality: {
      score: 0.4,
      metrics: {
        provenanceCoverage: 1,
        reviewableSize: 1,
        testCoverage: 0,
        issueContext: 0,
        demandDiversity: 0.25,
      },
      gates: [
        {
          gate: 'production_language',
          passed: false,
          reason: 'rust is searchable through structural extraction but is not validated for challenge packets',
        },
      ],
      eligible: false,
    },
    contentHash: 'sha256:packet-ineligible',
  };

  sqlite.exec(`
    INSERT INTO qualified_repos (id) VALUES (2);
    INSERT INTO repo_snapshots (
      id, repo_id, commit_sha, extractor_version
    ) VALUES (
      'snapshot-ineligible', 2, 'cccccccccccccccccccccccccccccccccccccccc', '1.0.0'
    );
    INSERT INTO repo_source_artifacts (
      id, repo_snapshot_id, artifact_type, path, external_reference
    ) VALUES (
      'repo-artifact-ineligible', 'snapshot-ineligible', 'source', 'src/orders.rs',
      'https://github.com/pipe/orders/blob/cccc/src/orders.rs'
    );
    INSERT INTO repo_artifact_versions (
      id, artifact_id, content_hash, inline_content, byte_length, media_type
    ) VALUES (
      'repo-version-ineligible', 'repo-artifact-ineligible', 'sha256:repo-ineligible',
      'fn process_kafka_retry() {}', 27, 'text/plain'
    );
    INSERT INTO repo_source_spans (
      id, artifact_version_id, content_hash, path, byte_start, byte_end,
      line_start, line_end, pr_side, base_sha, head_sha, exact_text
    ) VALUES (
      'repo-span-ineligible', 'repo-version-ineligible', 'sha256:repo-ineligible',
      'src/orders.rs', 0, 27, 1, 1, 'head',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'cccccccccccccccccccccccccccccccccccccccc',
      'fn process_kafka_retry() {}'
    );
  `);
  sqlite.prepare(
    `INSERT INTO review_challenge_packets (
       id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash,
       language, production_ready, quality_score, demand_families_json, packet_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    packet.id,
    packet.repoSnapshotId,
    2,
    packet.pullRequest.number,
    packet.policyVersion,
    packet.contentHash,
    packet.languageSupport.normalizedLanguage,
    0,
    packet.quality.score,
    JSON.stringify(packet.demandFamilies),
    JSON.stringify(packet),
  );
}

function seedLegacyHandShapedPacket(sqlite: NodeSqliteDatabase): void {
  const packet: RepoChallengePacket = {
    schemaVersion: '1.0.0',
    policyVersion: 'repo-challenge-v1',
    id: 'packet-eligible',
    repoSnapshotId: 'snapshot-eligible',
    repository: {
      provider: 'github',
      owner: 'pipe',
      name: 'orders',
      canonicalUrl: 'https://github.com/pipe/orders',
    },
    pullRequest: {
      number: 42,
      url: 'https://github.com/pipe/orders/pull/42',
      title: 'Retry Kafka events idempotently',
      author: 'engineer',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'dddddddddddddddddddddddddddddddddddddddd',
      mergedAt: '2026-06-14T08:00:00.000Z',
    },
    languageSupport: {
      language: 'TypeScript',
      normalizedLanguage: 'typescript',
      level: 'production',
      parser: 'typescript-compiler-api',
      challengePacketsAllowed: true,
      reason: 'typescript has a validated semantic extraction adapter',
    },
    changedFilePaths: ['src/orders.ts', 'src/orders.test.ts'],
    changedSymbolIds: [],
    sourceSpanIds: ['repo-span-1', 'repo-span-2'],
    testChanges: [],
    demands: [
      {
        id: 'demand-1',
        family: 'artifact:source',
        narrative: 'Review implemented Kafka idempotency.',
        conceptKeys: ['term:kafka'],
        mechanisms: ['term:kafka'],
        sourceSpanIds: ['repo-span-1'],
        changedSymbolIds: [],
        weight: 0.5,
        contentHash: 'sha256:demand1',
      },
      {
        id: 'demand-2',
        family: 'verification:retry',
        narrative: 'Review validated retry handling for Kafka events.',
        conceptKeys: ['term:kafka'],
        mechanisms: ['term:kafka'],
        sourceSpanIds: ['repo-span-2'],
        changedSymbolIds: [],
        weight: 0.5,
        contentHash: 'sha256:demand2',
      },
    ],
    demandFamilies: ['artifact:source', 'verification:retry'],
    quality: {
      score: 1,
      metrics: {
        provenanceCoverage: 1,
        reviewableSize: 1,
        testCoverage: 1,
        issueContext: 1,
        demandDiversity: 1,
      },
      gates: [],
      eligible: true,
    },
    contentHash: 'sha256:packet-eligible',
  };

  sqlite.exec(`
    INSERT INTO qualified_repos (id) VALUES (3);
    INSERT INTO repo_snapshots (
      id, repo_id, commit_sha, extractor_version
    ) VALUES (
      'snapshot-eligible', 3, 'dddddddddddddddddddddddddddddddddddddddd', '1.0.0'
    );
    INSERT INTO repo_source_artifacts (
      id, repo_snapshot_id, artifact_type, path, external_reference
    ) VALUES
      (
        'repo-artifact-1', 'snapshot-eligible', 'source', 'src/orders.ts',
        'https://github.com/pipe/orders/blob/dddd/src/orders.ts'
      ),
      (
        'repo-artifact-2', 'snapshot-eligible', 'test', 'src/orders.test.ts',
        'https://github.com/pipe/orders/blob/dddd/src/orders.test.ts'
      );
    INSERT INTO repo_artifact_versions (
      id, artifact_id, content_hash, inline_content, byte_length, media_type
    ) VALUES
      (
        'repo-version-1', 'repo-artifact-1', 'sha256:repo-1',
        'implement kafka idempotency for order events', 44, 'text/plain'
      ),
      (
        'repo-version-2', 'repo-artifact-2', 'sha256:repo-2',
        'validate retry handling for kafka events', 40, 'text/plain'
      );
    INSERT INTO repo_source_spans (
      id, artifact_version_id, content_hash, path, byte_start, byte_end,
      line_start, line_end, pr_side, base_sha, head_sha, exact_text
    ) VALUES
      (
        'repo-span-1', 'repo-version-1', 'sha256:repo-span-1',
        'src/orders.ts', 0, 44, 1, 1, 'head',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'dddddddddddddddddddddddddddddddddddddddd',
        'implement kafka idempotency for order events'
      ),
      (
        'repo-span-2', 'repo-version-2', 'sha256:repo-span-2',
        'src/orders.test.ts', 0, 40, 1, 1, 'head',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'dddddddddddddddddddddddddddddddddddddddd',
        'validate retry handling for kafka events'
      );
  `);
  sqlite.prepare(
    `INSERT INTO review_challenge_packets (
       id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash,
       language, production_ready, quality_score, demand_families_json, packet_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    packet.id,
    packet.repoSnapshotId,
    3,
    packet.pullRequest.number,
    packet.policyVersion,
    packet.contentHash,
    packet.languageSupport.normalizedLanguage,
    1,
    packet.quality.score,
    JSON.stringify(packet.demandFamilies),
    JSON.stringify(packet),
  );
}

describe('matchCandidateToReviewChallenge', () => {
  let sqlite: NodeSqliteDatabase;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
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
      INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
      VALUES ('candidate-1', 'workspace-1', NULL, 'Candidate One', 'candidate@example.com', 'active');
    `);
    sqlite.exec(candidateNodesMigration);
    sqlite.exec(candidateNodeIdempotencyMigration);
    sqlite.exec(livingMigration);
    sqlite.exec(matchingMigration);
    sqlite.exec(conceptRegistryMigration);
    sqlite.exec(contextRecordMigration);
    sqlite.exec(transcriptProjectionMigration);
  });

  afterEach(() => sqlite.close());

  it('records NEEDS_MORE_EVIDENCE instead of selecting a generic fallback PR', async () => {
    sqlite.exec(assessmentLayerMigration);

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.repoId).toBeUndefined();
    expect(result.explanation).toEqual(expect.objectContaining({
      status: 'NEEDS_MORE_EVIDENCE',
      evidence: [],
      rejectedPackets: [],
      missingEvidence: [
        expect.objectContaining({
          scope: 'candidate',
          reason: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
        }),
      ],
      rejectionReasons: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
    }));
    expect(result.explanation?.selectedPr).toBeUndefined();
    expect(result.diagnostics).toEqual(expect.objectContaining({
      excludedPackets: [],
      recalledPacketIds: [],
      evaluatedChallenges: [],
    }));
    expect(result.diagnostics?.candidateEvidenceDepth).toEqual({
      sourceDiversity: 0,
      totalInteractions: 0,
      totalAssertions: 0,
      totalSourceSpans: 0,
      sourceTypes: {},
    });
    expect(sqlite.prepare(
      'SELECT status, selected_packet_id FROM match_runs WHERE id = ?',
    ).get(result.matchRunId)).toEqual({
      status: 'NEEDS_MORE_EVIDENCE',
      selected_packet_id: null,
    });
    expect(sqlite.prepare(
      'SELECT scope_type, scope_id, record_type, confidence FROM context_records WHERE scope_id = ?',
    ).get(result.matchRunId)).toEqual({
      scope_type: 'match_run',
      scope_id: result.matchRunId,
      record_type: 'candidate_pr_match_decision',
      confidence: null,
    });
    expect(sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, evidence_role
         FROM context_record_source_refs
        WHERE source_ref_id = ?`,
    ).get(result.matchRunId)).toEqual({
      source_ref_type: 'match_run',
      source_ref_id: result.matchRunId,
      evidence_role: 'decision_record',
    });

    const assessmentSession = sqlite.prepare(
      `SELECT id, mode, state, candidate_id, workspace_id
         FROM assessment_sessions
        WHERE ingestion_key = ?`,
    ).get(`assessment-session:repo-match:${result.matchRunId}`) as {
      id: string;
      mode: string;
      state: string;
      candidate_id: string;
      workspace_id: string;
    };
    expect(assessmentSession).toMatchObject({
      mode: 'REPO_MATCHING',
      state: 'DIAGNOSTIC',
      candidate_id: 'candidate-1',
      workspace_id: 'workspace-1',
    });
    const assessmentReport = sqlite.prepare(
      `SELECT id, status, summary
         FROM assessment_evaluation_reports
        WHERE ingestion_key = ?`,
    ).get(`assessment-diagnostic:repo-match:${result.matchRunId}:NEEDS_MORE_EVIDENCE`) as {
      id: string;
      status: string;
      summary: string;
    };
    expect(assessmentReport).toMatchObject({
      status: 'NEEDS_MORE_EVIDENCE',
      summary: expect.stringContaining('needs more source-backed candidate evidence'),
    });
    const diagnosticSource = sqlite.prepare(
      `SELECT d.code, d.severity, d.retryable,
              r.source_ref_type, r.source_ref_id, r.evidence_role, r.exact_text
         FROM assessment_diagnostics d
         JOIN assessment_diagnostic_source_refs r ON r.diagnostic_id = d.id
        WHERE d.report_id = ?`,
    ).get(assessmentReport.id) as {
      code: string;
      severity: string;
      retryable: number;
      source_ref_type: string;
      source_ref_id: string;
      evidence_role: string;
      exact_text: string;
    };
    expect(diagnosticSource).toMatchObject({
      code: 'NEEDS_MORE_EVIDENCE',
      severity: 'warning',
      retryable: 1,
      source_ref_type: 'match_run',
      source_ref_id: result.matchRunId,
      evidence_role: 'decision_record',
    });
    expect(diagnosticSource.exact_text).toContain('"status":"NEEDS_MORE_EVIDENCE"');
  });

  it('uses completed evidence-plan follow-up transcript evidence on the next repo-match rerun', async () => {
    sqlite.exec(assessmentLayerMigration);
    sqlite.prepare('INSERT INTO qualified_repos (id) VALUES (?)').run(973);
    const data = await buildMuiBaseUiPopoverChallengeFixture();
    await persistReviewChallengeGraph(
      createNodeSqliteD1(sqlite),
      973,
      data.input,
      data.packet,
      data.graph,
    );

    const first = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');
    expect(first.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(first.repoId).toBeUndefined();
    expect(first.explanation?.missingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'candidate',
        reason: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
      }),
    ]));

    const transcriptText = [
      'I reviewed React TypeScript popover trigger behavior in usePopoverRoot,',
      'caught the impatient click timing bug, and asked for a patient click threshold',
      'regression test with a JavaScript test runner before approval.',
    ].join(' ');
    const observedAt = '2026-06-22T19:10:00.000Z';
    sqlite.prepare(
      `INSERT INTO assessment_sessions (
         id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
         created_by, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'assessment-plan-rerun-1',
      'assessment-session:code-review-evidence-plan:code-review-rerun-1:scheduled-follow-up-1',
      'scheduled-follow-up-1',
      'TECHNICAL',
      'IN_PROGRESS',
      'candidate-1',
      'workspace-1',
      'code-review-evidence-plan',
      JSON.stringify({
        source: 'code_review_evidence_plan',
        originalInterviewId: 'code-review-rerun-1',
        contextCallInterviewId: 'scheduled-follow-up-1',
        matchRunId: first.matchRunId,
        matchStatus: 'NEEDS_MORE_EVIDENCE',
      }),
      '2026-06-22T19:00:00.000Z',
      '2026-06-22T19:00:00.000Z',
    );
    sqlite.prepare(
      `INSERT INTO contacts (
         id, owner_id, name, email, phone, company, role, type, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    ).run(
      'contact-follow-up-1',
      'workspace-1',
      'Candidate One',
      'candidate@example.com',
      'Frontend systems engineer',
      'candidate',
      observedAt,
      observedAt,
    );
    sqlite.prepare(
      `INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'meeting-follow-up-1',
      'workspace-1',
      '2026-06-22T19:00:00.000Z',
      observedAt,
      observedAt,
    );
    sqlite.prepare(
      `INSERT INTO meeting_participants (
         id, meeting_id, contact_id, role, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'participant-follow-up-1',
      'meeting-follow-up-1',
      'contact-follow-up-1',
      'ATTENDEE',
      observedAt,
      observedAt,
    );

    await ingestMeetingTranscriptToLivingContext(createNodeSqliteD1(sqlite), {
      meetingId: 'meeting-follow-up-1',
      ownerId: 'workspace-1',
      scheduledInterviewId: 'scheduled-follow-up-1',
      provider: 'test-transcript',
      startedAt: '2026-06-22T19:00:00.000Z',
      endedAt: observedAt,
      personContextMode: 'attributed',
      segments: [
        {
          stableSegmentId: 'host-1',
          text: 'Which frontend code-review work should PIPE use as evidence?',
          speakerRole: 'host',
          speakerLabel: 'Host',
          timestampStartMs: 0,
          timestampEndMs: 1500,
        },
        {
          stableSegmentId: 'guest-1',
          text: transcriptText,
          speakerRole: 'guest',
          speakerLabel: 'Guest',
          contactId: 'contact-follow-up-1',
          timestampStartMs: 2000,
          timestampEndMs: 8000,
          confidence: 0.98,
        },
      ],
      semanticAssertions: [{
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'reviewed',
        narrative: 'Candidate reviewed React TypeScript popover trigger timing and asked for regression coverage.',
        objectType: 'source-described code-review evidence',
        objectValue: { surface: 'React TypeScript popover patient click threshold regression test' },
        confidence: 0.97,
        concepts: [
          {
            surface: 'popover',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
          {
            surface: 'patient click threshold',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
          {
            surface: 'JavaScript test runner',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
          {
            surface: 'React',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
          {
            surface: 'TypeScript',
            relationship: 'about',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
        ],
      }],
      extractorVersion: 'code-review-evidence-plan-rerun-test-v1',
    });

    expect(sqlite.prepare(
      `SELECT state
         FROM assessment_sessions
        WHERE id = 'assessment-plan-rerun-1'`,
    ).get()).toEqual({ state: 'EVALUATED' });
    expect(sqlite.prepare(
      `SELECT json_extract(output_json, '$.sourceSpanCount') AS source_span_count
         FROM assessment_evaluation_reports
        WHERE session_id = 'assessment-plan-rerun-1'`,
    ).get()).toEqual({ source_span_count: 1 });

    const second = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(second.status).toBe('MATCHED');
    expect(second.repoId).toBe(973);
    expect(second.prNumber).toBe(973);
    expect(second.explanation?.selectedPr).toEqual({
      challengeId: data.packet.id,
      repoId: '973',
      prNumber: 973,
      sourceVersion: data.input.repoSnapshot.id,
    });
    expect(second.explanation?.missingEvidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'candidate',
        reason: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
      }),
    ]));
    expect(second.explanation?.candidateSpans.flatMap((span) =>
      span.sourceRefs.map((source) => source.exactText),
    )).toContain(transcriptText);
    const ranked = sqlite.prepare(
      `SELECT status, selected_packet_id, ranked_results_json
         FROM match_runs
        WHERE id = ?`,
    ).get(second.matchRunId) as {
      status: string;
      selected_packet_id: string;
      ranked_results_json: string;
    };
    expect(ranked.status).toBe('MATCHED');
    expect(ranked.selected_packet_id).toBe(data.packet.id);
    const [rankedResult] = JSON.parse(ranked.ranked_results_json) as Array<{
      alignments: Array<{
        sharedConcepts: string[];
        candidateSourceRefs: Array<{ exactText?: string; sourceRefType?: string }>;
      }>;
    }>;
    const sharedConcepts = new Set(rankedResult.alignments.flatMap((alignment) => alignment.sharedConcepts));
    expect(sharedConcepts.has('term:patient-click-threshold')).toBe(true);
    expect(rankedResult.alignments.some((alignment) =>
      alignment.candidateSourceRefs.some((ref) =>
        ref.sourceRefType === 'source_span'
        && ref.exactText === transcriptText
      )
    )).toBe(true);
  });

  it('rejects production-ready packets whose source-backed context projection is missing', async () => {
    seedCandidateEvidence(sqlite);
    const data = await seedProductionReadyPacket(sqlite, 42);
    sqlite.prepare(
      `DELETE FROM context_records
        WHERE ingestion_key = ?`,
    ).run(`repo-challenge-packet-context:${data.packet.id}`);

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(result.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(result.repoId).toBeUndefined();
    expect(result.diagnostics?.excludedPackets).toEqual([
      expect.objectContaining({
        id: data.packet.id,
        repoId: '42',
        prNumber: data.packet.pullRequest.number,
        reason: 'PACKET_CONTEXT_PROJECTION_INCOMPLETE',
        contextRecordId: null,
        repoSourceRefCount: 0,
        conceptLinkCount: 0,
        contextProjectionFailures: expect.arrayContaining([
          `review challenge packet ${data.packet.id} is missing its repo_challenge_packet context record`,
          `review challenge packet ${data.packet.id} is missing repo_source_span context refs`,
          `review challenge packet ${data.packet.id} is missing context_record_concepts links`,
        ]),
      }),
    ]);
    expect(result.diagnostics?.recalledPacketIds).toEqual([]);
    expect(result.diagnostics?.evaluatedChallenges).toEqual([]);
    expect(result.explanation?.rejectedPackets).toEqual([
      expect.objectContaining({
        id: data.packet.id,
        repoId: '42',
        prNumber: data.packet.pullRequest.number,
        reasons: ['PACKET_CONTEXT_PROJECTION_INCOMPLETE'],
        contextProjectionFailures: expect.arrayContaining([
          `review challenge packet ${data.packet.id} is missing its repo_challenge_packet context record`,
        ]),
      }),
    ]);
    expect(result.explanation?.missingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'repo',
        reason: 'PACKET_CONTEXT_PROJECTION_INCOMPLETE',
        challengeId: data.packet.id,
      }),
    ]));

    const row = sqlite.prepare(
      'SELECT selected_packet_id, excluded_packets_json, ranked_results_json FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as {
      selected_packet_id: string | null;
      excluded_packets_json: string;
      ranked_results_json: string;
    };
    expect(row.selected_packet_id).toBeNull();
    expect(JSON.parse(row.excluded_packets_json)).toEqual([
      expect.objectContaining({
        id: data.packet.id,
        reason: 'PACKET_CONTEXT_PROJECTION_INCOMPLETE',
        contextRecordId: null,
        repoSourceRefCount: 0,
        conceptLinkCount: 0,
      }),
    ]);
    expect(JSON.parse(row.ranked_results_json)).toEqual([]);
  });

  it('rejects production-ready packets whose demand spans are not persisted', async () => {
    seedCandidateEvidence(sqlite);
    const data = await seedProductionReadyPacketWithoutSourceSpans(sqlite);
    const expectedDemandIds = data.packet.demands.map((demand) => demand.id).sort();
    const expectedMissingSpanIds = [...new Set(
      data.packet.demands.flatMap((demand) => demand.sourceSpanIds),
    )].sort();

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(result.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(result.repoId).toBeUndefined();
    expect(result.diagnostics?.excludedPackets).toEqual([
      expect.objectContaining({
        id: data.packet.id,
        reason: 'MISSING_DEMAND_SOURCE_SPANS',
        demandIds: expectedDemandIds,
        missingSourceSpanIds: expectedMissingSpanIds,
      }),
    ]);
    expect(result.explanation).toEqual(expect.objectContaining({
      status: 'NO_ROLE_SAFE_CHALLENGE',
      rejectedPackets: [
        expect.objectContaining({
          id: data.packet.id,
          reasons: ['MISSING_DEMAND_SOURCE_SPANS'],
          demandIds: expectedDemandIds,
          missingSourceSpanIds: expectedMissingSpanIds,
        }),
      ],
      missingEvidence: [
        expect.objectContaining({
          scope: 'repo',
          reason: 'MISSING_DEMAND_SOURCE_SPANS',
          challengeId: data.packet.id,
        }),
      ],
    }));
    expect(result.explanation?.selectedPr).toBeUndefined();
    expect(result.diagnostics?.recalledPacketIds).toEqual([]);
    expect(result.diagnostics?.evaluatedChallenges).toEqual([]);
    const row = sqlite.prepare(
      'SELECT selected_packet_id, excluded_packets_json, ranked_results_json FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as {
      selected_packet_id: string | null;
      excluded_packets_json: string;
      ranked_results_json: string;
    };
    expect(row.selected_packet_id).toBeNull();
    expect(JSON.parse(row.excluded_packets_json)).toEqual([
      expect.objectContaining({
        id: data.packet.id,
        reason: 'MISSING_DEMAND_SOURCE_SPANS',
        demandIds: expectedDemandIds,
        missingSourceSpanIds: expectedMissingSpanIds,
      }),
    ]);
    expect(JSON.parse(row.ranked_results_json)).toEqual([]);
    const contextRecord = sqlite.prepare(
      'SELECT id, scope_type, scope_id, record_type FROM context_records WHERE scope_id = ?',
    ).get(result.matchRunId) as {
      id: string;
      scope_type: string;
      scope_id: string;
      record_type: string;
    };
    expect(contextRecord).toMatchObject({
      scope_type: 'match_run',
      scope_id: result.matchRunId,
      record_type: 'candidate_pr_match_decision',
    });
    expect(sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, evidence_role
         FROM context_record_source_refs
        WHERE context_record_id = ?
          AND source_ref_type = 'review_challenge_packet'`,
    ).get(contextRecord.id)).toEqual({
      source_ref_type: 'review_challenge_packet',
      source_ref_id: data.packet.id,
      evidence_role: 'considered_packet',
    });
    expect(sqlite.prepare(
      `SELECT entity_type, entity_id, relationship
        FROM context_record_entities
       WHERE context_record_id = ?
          AND entity_id = ?
          AND relationship = 'rejected_packet'`,
    ).get(contextRecord.id, data.packet.id)).toEqual({
      entity_type: 'review_challenge_packet',
      entity_id: data.packet.id,
      relationship: 'rejected_packet',
    });
  });

  it('retains DB-loaded candidate rows with null evidence as excluded diagnostics', async () => {
    seedCandidateEvidence(sqlite);
    const data = await seedProductionReadyPacket(sqlite, 3);
    sqlite.prepare("DELETE FROM signal_evidence WHERE id = 'evidence-2'").run();

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(result.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(result.explanation?.missingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'candidate',
        reason: 'CANDIDATE_SIGNALS_EXCLUDED_FOR_MISSING_OR_NULL_EVIDENCE',
      }),
    ]));
    const row = sqlite.prepare(
      'SELECT query_json FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as { query_json: string };
    const query = JSON.parse(row.query_json) as {
      validationAtoms: Array<{ id: string }>;
    };
    expect(query.validationAtoms.map((atom) => atom.id)).toEqual(['assertion-1:term:kafka']);
    expect(result.diagnostics?.evaluatedChallenges).toEqual([
      expect.objectContaining({
        challengeId: data.packet.id,
        alignedDemandCount: 1,
        stretchCount: 0,
      }),
    ]);
  });

  it('loads source-backed candidate semantics from context records when assertion projections are absent', async () => {
    seedCandidateEvidence(sqlite);
    moveCandidateMeaningToContextRecords(sqlite);
    const data = await seedProductionReadyPacket(sqlite, 3);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM assertion_source_spans').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM assertion_concepts').get()).toEqual({ count: 0 });

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');
    expect(result.status).toBe('MATCHED');
    expect(result.repoId).toBe(3);
    expect(result.prNumber).toBe(data.packet.pullRequest.number);
    expect(result.explanation?.missingEvidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'candidate',
        reason: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
      }),
    ]));
    expect(result.explanation?.evidence).toHaveLength(2);
    expect(result.explanation?.candidateSpans.flatMap((span) =>
      span.sourceRefs.map((ref) => ref.exactText),
    ).sort()).toEqual([
      'implemented kafka idempotency',
      'validated retry handling',
    ]);

    const row = sqlite.prepare(
      'SELECT query_json FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as { query_json: string };
    const query = JSON.parse(row.query_json) as {
      validationAtoms: Array<{
        id: string;
        concepts: string[];
        sourceRefs: Array<{ locator?: string; sourceRefType?: string; exactText?: string }>;
      }>;
    };
    expect(query.validationAtoms.map((atom) => atom.id).sort()).toEqual([
      'assertion-1:term:kafka',
      'assertion-2:term:kafka',
    ]);
    expect(query.validationAtoms.every((atom) =>
      atom.concepts.includes('term:kafka')
      && atom.sourceRefs.some((ref) =>
        ref.locator?.startsWith('context_record:')
        && ref.sourceRefType === 'source_span'
        && ref.exactText,
      ),
    )).toBe(true);
  });

  it('honors excluded packet IDs during review challenge matching', async () => {
    seedCandidateEvidence(sqlite);
    moveCandidateMeaningToContextRecords(sqlite);
    const data = await seedProductionReadyPacket(sqlite, 3);

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1', {
      excludePacketIds: [data.packet.id],
    });

    expect(result.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(result.repoId).toBeUndefined();
    expect(result.prNumber).toBeUndefined();
    expect(result.diagnostics?.recalledPacketIds).not.toContain(data.packet.id);
    expect(result.diagnostics?.evaluatedChallenges).toEqual([]);

    const row = sqlite.prepare(
      'SELECT selected_packet_id, ranked_results_json FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as {
      selected_packet_id: string | null;
      ranked_results_json: string;
    };
    expect(row.selected_packet_id).toBeNull();
    expect(JSON.parse(row.ranked_results_json)).toEqual([]);
  });

  it('matches source-backed PR challenges from meeting transcript-derived person evidence', async () => {
    const { transcriptText } = await seedMeetingTranscriptCandidateEvidence(sqlite);
    const data = await seedProductionReadyPacket(sqlite, 3);

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(result.status).toBe('MATCHED');
    expect(result.repoId).toBe(3);
    expect(result.prNumber).toBe(data.packet.pullRequest.number);
    expect(result.explanation?.missingEvidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'candidate',
        reason: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
      }),
    ]));
    expect(result.explanation?.selectedPr).toEqual(expect.objectContaining({
      challengeId: data.packet.id,
      repoId: '3',
      prNumber: data.packet.pullRequest.number,
    }));
    expect(result.explanation?.evidence.some((entry) =>
      entry.candidateSourceRefs.some((source) =>
        source.sourceRefType === 'source_span'
        && source.exactText === transcriptText
      )
      && entry.challengeSourceRefs.some((source) => source.sourceRefType === 'repo_source_span')
    )).toBe(true);
    expect(result.explanation?.candidateSpans.flatMap((span) =>
      span.sourceRefs.map((source) => source.exactText),
    )).toContain(transcriptText);

    const queryRow = sqlite.prepare(
      'SELECT query_json FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as { query_json: string };
    const query = JSON.parse(queryRow.query_json) as {
      validationAtoms: Array<{
        concepts: string[];
        sourceRefs: Array<{ sourceRefType?: string; exactText?: string }>;
      }>;
    };
    expect(query.validationAtoms.some((atom) =>
      atom.concepts.includes('term:kafka')
      && atom.sourceRefs.some((source) =>
        source.sourceRefType === 'source_span'
        && source.exactText === transcriptText
      )
    )).toBe(true);

    const transcriptRecord = sqlite.prepare(
      `SELECT cr.record_type, ss.exact_text
         FROM context_records cr
         JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
         JOIN source_spans ss ON ss.id = crsr.source_span_id
        WHERE cr.record_type = 'meeting_transcript_assertion'
          AND ss.exact_text = ?`,
    ).get(transcriptText) as { record_type: string; exact_text: string } | undefined;
    expect(transcriptRecord).toEqual({
      record_type: 'meeting_transcript_assertion',
      exact_text: transcriptText,
    });
  });

  it('matches recorded person and role evidence to a live-shaped mui/base-ui PR packet', async () => {
    const { transcriptText } = await seedMuiBaseUiMeetingTranscriptCandidateEvidence(sqlite);
    sqlite.prepare('INSERT INTO qualified_repos (id) VALUES (?)').run(973);
    sqlite.prepare('INSERT INTO role_contexts (id) VALUES (?)').run('role-context-mui-popover');
    const data = await buildMuiBaseUiPopoverChallengeFixture();
    const packetConcepts = new Set(data.packet.demands.flatMap((demand) => demand.conceptKeys));

    expect(data.packet.quality.eligible).toBe(true);
    expect(data.packet.quality.score).toBeGreaterThanOrEqual(0.7);
    expect(data.packet.pullRequest.number).toBe(973);
    expect(data.packet.repository).toEqual(expect.objectContaining({
      owner: 'mui',
      name: 'base-ui',
    }));
    expect(data.packet.demandFamilies).toEqual(expect.arrayContaining([
      'artifact:source',
      'artifact:test',
      'structure:calls',
      'structure:contains',
      'structure:imports',
      'verification:term:javascript-test-runner',
    ]));
    for (const concept of [
      'term:popover',
      'term:patient-click-threshold',
      'term:typescript',
      'term:react',
      'term:javascript-test-runner',
    ]) {
      expect(packetConcepts.has(concept)).toBe(true);
    }

    await persistReviewChallengeGraph(
      createNodeSqliteD1(sqlite),
      973,
      data.input,
      data.packet,
      data.graph,
    );

    const roleExactText = [
      'Review React TypeScript popover pull requests that add patient click threshold',
      'handling for impatient trigger clicks and verify the behavior with tests.',
    ].join(' ');
    const roleConcepts = [
      'term:click',
      'term:javascript-test-runner',
      'term:patient-click-threshold',
      'term:popover',
      'term:popover-trigger',
      'term:react',
      'term:typescript',
      'term:use-popover-root',
    ];
    const roleSourceReferences = [{
      entityId: 'role-source-mui-popover',
      locator: 'simple_job_description:source_span:mui-popover',
      conceptKeys: roleConcepts,
      exactText: roleExactText,
      contentHash: await sha256(roleExactText),
    }];

    sqlite.exec(assessmentLayerMigration);

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1', {
      roleContextId: 'role-context-mui-popover',
      roleSnapshotId: 'role-context:mui-popover:source-backed:simple-jd-v1',
      roleConcepts,
      requiredConcepts: ['term:popover', 'term:patient-click-threshold'],
      requiredLanguages: ['typescript'],
      conceptResolverVersion: 'open-source-term-v2',
      roleSourceReferences,
    });

    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.repoId).toBeUndefined();
    expect(result.prNumber).toBeUndefined();
    expect(result.explanation?.selectedPr).toBeUndefined();
    expect(result.explanation?.evidence).toEqual([]);
    expect(result.explanation?.roleSources).toEqual(roleSourceReferences);
    expect(result.explanation?.rejectionReasons).toEqual(['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE']);
    expect(result.diagnostics?.evaluatedChallenges).toEqual([
      expect.objectContaining({
        challengeId: data.packet.id,
        repoId: '973',
        prNumber: 973,
        alignedDemandCount: expect.any(Number),
        provenanceComplete: true,
        contextProjectionComplete: true,
        eligible: true,
      }),
    ]);

    const ranked = sqlite.prepare(
      'SELECT status, ranked_results_json, selected_packet_id FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as {
      status: string;
      ranked_results_json: string;
      selected_packet_id: string | null;
    };
    expect(ranked.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(ranked.selected_packet_id).toBeNull();
    const [rankedResult] = JSON.parse(ranked.ranked_results_json) as Array<{
      challengeId: string;
      assessmentQuality: {
        metrics: Array<{ id: string; score: number }>;
      };
      alignments: Array<{
        sharedConcepts: string[];
        roleSourceRefs: Array<{ exactText?: string; conceptKeys?: string[] }>;
        candidateSourceRefs: Array<{ sourceRefType?: string; exactText?: string }>;
        challengeSourceRefs: Array<{ sourceRefType?: string; exactText?: string }>;
      }>;
    }>;
    expect(rankedResult).toEqual(expect.objectContaining({
      challengeId: data.packet.id,
    }));
    const sharedConcepts = new Set(rankedResult.alignments.flatMap((alignment) => alignment.sharedConcepts));
    expect(sharedConcepts.has('term:patient-click-threshold')).toBe(true);
    expect([...sharedConcepts].some((key) => key === 'term:popover' || key === 'term:popover-trigger')).toBe(true);
    expect(rankedResult.alignments.some((alignment) =>
      alignment.roleSourceRefs.some((source) => source.exactText === roleExactText)
    )).toBe(true);
    expect(rankedResult.alignments.every((alignment) =>
      alignment.candidateSourceRefs.some((ref) =>
        ref.sourceRefType === 'source_span'
        && ref.exactText === transcriptText
      )
      && alignment.challengeSourceRefs.some((ref) =>
        ref.sourceRefType === 'repo_source_span'
        && ref.exactText
      ),
    )).toBe(true);
    expect(rankedResult.assessmentQuality.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'contrast_separation',
        score: 0,
      }),
    ]));

    const contextRecord = sqlite.prepare(
      `SELECT id, scope_type, scope_id, record_type, predicate
         FROM context_records
        WHERE scope_id = ?
          AND record_type = 'candidate_pr_match_decision'`,
    ).get(result.matchRunId) as {
      id: string;
      scope_type: string;
      scope_id: string;
      record_type: string;
      predicate: string;
    };
    expect(contextRecord).toMatchObject({
      scope_type: 'match_run',
      scope_id: result.matchRunId,
      record_type: 'candidate_pr_match_decision',
      predicate: 'records match diagnostic',
    });
    const contextRefs = sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, exact_text, content_hash, evidence_role
         FROM context_record_source_refs
        WHERE context_record_id = ?
        ORDER BY evidence_role, source_ref_id`,
    ).all(contextRecord.id) as Array<{
      source_ref_type: string;
      source_ref_id: string;
      exact_text: string | null;
      content_hash: string | null;
      evidence_role: string;
    }>;
    expect(contextRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_ref_type: 'review_challenge_packet',
        source_ref_id: data.packet.id,
        content_hash: data.packet.contentHash,
        evidence_role: 'considered_packet',
      }),
      expect.objectContaining({
        source_ref_type: 'role_source',
        source_ref_id: 'role-source-mui-popover',
        exact_text: roleExactText,
        evidence_role: 'role_source',
      }),
      expect.objectContaining({
        source_ref_type: 'source_span',
        exact_text: transcriptText,
        evidence_role: 'candidate_evidence',
      }),
    ]));
    expect(contextRefs.some((ref) => ref.evidence_role === 'selected_packet')).toBe(false);
    expect(contextRefs.some((ref) => ref.evidence_role === 'selected_repo_evidence')).toBe(false);
    expect(sqlite.prepare(
      `SELECT entity_type, entity_id, relationship
         FROM context_record_entities
        WHERE context_record_id = ?
          AND relationship = 'selected_packet'`,
    ).get(contextRecord.id)).toBeUndefined();
    expect(sqlite.prepare(
      `SELECT entity_type, entity_id, relationship
         FROM context_record_entities
        WHERE context_record_id = ?
          AND relationship = 'role_context'`,
    ).get(contextRecord.id)).toEqual({
      entity_type: 'role_context',
      entity_id: 'role-context-mui-popover',
      relationship: 'role_context',
    });
    const matchConcepts = sqlite.prepare(
      `SELECT c.canonical_key
         FROM context_record_concepts crc
         JOIN concepts c ON c.id = crc.concept_id
        WHERE crc.context_record_id = ?
        ORDER BY c.canonical_key`,
    ).all(contextRecord.id) as Array<{ canonical_key: string }>;
    const matchConceptKeys = matchConcepts.map((row) => row.canonical_key);
    expect(matchConceptKeys).toEqual([]);

    const assessmentSession = sqlite.prepare(
      `SELECT mode, state, candidate_id, workspace_id, metadata_json
         FROM assessment_sessions
        WHERE ingestion_key = ?`,
    ).get(`assessment-session:repo-match:${result.matchRunId}`) as {
      mode: string;
      state: string;
      candidate_id: string;
      workspace_id: string;
      metadata_json: string;
    };
    expect(assessmentSession).toEqual(expect.objectContaining({
      mode: 'REPO_MATCHING',
      state: 'DIAGNOSTIC',
      candidate_id: 'candidate-1',
      workspace_id: 'workspace-1',
    }));
    expect(JSON.parse(assessmentSession.metadata_json)).toEqual(expect.objectContaining({
      matchRunId: result.matchRunId,
      roleContextId: 'role-context-mui-popover',
      selectedPacketId: null,
      source: 'match_runs',
    }));

    const assessmentRefs = sqlite.prepare(
      `SELECT r.source_ref_type, r.source_ref_id, r.evidence_role, r.exact_text, r.content_hash
         FROM assessment_evidence_events e
         JOIN assessment_event_source_refs r ON r.event_id = e.id
        WHERE e.ingestion_key = ?
        ORDER BY r.evidence_role, r.source_ref_type, r.source_ref_id`,
    ).all(`assessment-event:repo-match:${result.matchRunId}:decision`) as Array<{
      source_ref_type: string;
      source_ref_id: string;
      evidence_role: string;
      exact_text: string;
      content_hash: string;
    }>;
    expect(assessmentRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_ref_type: 'match_run',
        source_ref_id: result.matchRunId,
        evidence_role: 'decision_record',
      }),
    ]));
    expect(assessmentRefs.some((ref) =>
      ref.source_ref_type === 'match_run'
      && ref.exact_text.includes('"selectedPacketId":null')
      && ref.exact_text.includes('"status":"NEEDS_MORE_EVIDENCE"')
    )).toBe(true);
    expect(assessmentRefs.some((ref) => ref.evidence_role === 'selected_packet')).toBe(false);
    expect(assessmentRefs.some((ref) => ref.evidence_role === 'selected_repo_evidence')).toBe(false);
  });

  it('auto-matches roleless resume evidence to a live-shaped mui/base-ui PR packet', async () => {
    const { resumeText } = await seedMuiBaseUiResumeCandidateEvidence(sqlite);
    sqlite.prepare('INSERT INTO qualified_repos (id) VALUES (?)').run(973);
    const data = await buildMuiBaseUiPopoverChallengeFixture();

    await persistReviewChallengeGraph(
      createNodeSqliteD1(sqlite),
      973,
      data.input,
      data.packet,
      data.graph,
    );

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(result.status).toBe('MATCHED');
    expect(result.repoId).toBe(973);
    expect(result.prNumber).toBe(973);
    expect(result.explanation?.selectedPr).toEqual({
      challengeId: data.packet.id,
      repoId: '973',
      prNumber: 973,
      sourceVersion: data.input.repoSnapshot.id,
    });
    expect(result.explanation?.roleSources).toEqual([]);
    expect(result.explanation?.validatorAgent).toEqual(expect.objectContaining({
      agentName: 'source_backed_match_validator',
      verdict: 'PASSED',
      sourceBridge: expect.objectContaining({
        candidateSourceCount: expect.any(Number),
        repoSourceCount: expect.any(Number),
        roleSourceCount: 0,
        provenanceComplete: true,
      }),
    }));
    expect(result.explanation?.validatorAgent?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'role_context_alignment',
        passed: true,
        reason: 'No role source was supplied for this standalone match.',
      }),
    ]));
    expect(result.explanation?.assessmentQuality?.verdict).toMatch(/^(STRONG|USABLE)$/);
    expect(result.explanation?.missingEvidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'candidate',
        reason: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
      }),
    ]));
    expect(result.explanation?.rejectedPackets).toEqual([]);
    expect(result.explanation?.evidence.every((entry) => entry.roleSourceRefs.length === 0)).toBe(true);
    expect(result.explanation?.candidateSpans.flatMap((span) =>
      span.sourceRefs.map((source) => source.exactText),
    )).toContain(resumeText);
    expect(result.explanation?.evidence.length ?? 0).toBeGreaterThanOrEqual(4);

    const matchRun = sqlite.prepare(
      `SELECT role_context_id, role_snapshot_id, selected_packet_id, ranked_results_json
         FROM match_runs
        WHERE id = ?`,
    ).get(result.matchRunId) as {
      role_context_id: string | null;
      role_snapshot_id: string;
      selected_packet_id: string;
      ranked_results_json: string;
    };
    expect(matchRun.role_context_id).toBeNull();
    expect(matchRun.role_snapshot_id).toBe('standalone-code-review-v1');
    expect(matchRun.selected_packet_id).toBe(data.packet.id);
    const [rankedResult] = JSON.parse(matchRun.ranked_results_json) as Array<{
      validatorAgent: { verdict: string; sourceBridge: { roleSourceCount: number } };
      alignments: Array<{
        sharedConcepts: string[];
        roleSourceRefs: unknown[];
      }>;
    }>;
    expect(rankedResult.validatorAgent).toEqual(expect.objectContaining({
      verdict: 'PASSED',
      sourceBridge: expect.objectContaining({ roleSourceCount: 0 }),
    }));
    const sharedConcepts = new Set(rankedResult.alignments.flatMap((alignment) => alignment.sharedConcepts));
    expect(sharedConcepts.has('term:patient-click-threshold')).toBe(true);
    expect(sharedConcepts.has('term:popover')).toBe(true);
    expect(sharedConcepts.has('term:javascript-test-runner')).toBe(true);
    expect(rankedResult.alignments.every((alignment) => alignment.roleSourceRefs.length === 0)).toBe(true);
  });

  it('repairs unprojected resume candidate nodes before role-backed code-review matching', async () => {
    const { resumeText } = await seedMuiBaseUiResumeCandidateEvidence(sqlite, {
      mirrorLivingContext: false,
      termMode: 'extractor-compounds',
    });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_records
        WHERE ingestion_key LIKE 'candidate-node:%:context-record'`,
    ).get()).toEqual({ count: 0 });

    sqlite.prepare('INSERT INTO qualified_repos (id) VALUES (?)').run(973);
    const data = await buildMuiBaseUiPopoverChallengeFixture();
    await persistReviewChallengeGraph(
      createNodeSqliteD1(sqlite),
      973,
      data.input,
      data.packet,
      data.graph,
    );

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1', {
      roleConcepts: [
        'term:patient-click-threshold',
        'term:react',
        'term:typescript',
        'term:javascript-test-runner',
        'term:use-popover-root',
      ],
      minEvidenceInteractions: 1,
      minEvidenceDiversity: 0,
    });

    expect(result.status).toBe('MATCHED');
    expect(result.repoId).toBe(973);
    expect(result.prNumber).toBe(973);
    expect(result.explanation?.selectedPr).toEqual({
      challengeId: data.packet.id,
      repoId: '973',
      prNumber: 973,
      sourceVersion: data.input.repoSnapshot.id,
    });
    expect(result.explanation?.candidateSpans.flatMap((span) =>
      span.sourceRefs.map((source) => source.exactText),
    )).toContain(resumeText);
    const matchRun = sqlite.prepare(
      `SELECT ranked_results_json
         FROM match_runs
        WHERE id = ?`,
    ).get(result.matchRunId) as { ranked_results_json: string };
    const [rankedResult] = JSON.parse(matchRun.ranked_results_json) as Array<{
      alignments: Array<{ sharedConcepts: string[] }>;
    }>;
    const sharedConcepts = new Set(rankedResult.alignments.flatMap((alignment) => alignment.sharedConcepts));
    expect(sharedConcepts.has('term:patient-click-threshold')).toBe(true);
    expect(sharedConcepts.has('term:use-popover-root')).toBe(true);
    expect(sharedConcepts.has('term:javascript-test-runner')).toBe(true);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_records
        WHERE ingestion_key LIKE 'candidate-node:%:context-record'`,
    ).get()).toEqual({ count: 3 });
  });

  it('auto-matches roleless resume evidence to a live-shaped mui/base-ui PR packet', async () => {
    const { resumeText } = await seedMuiBaseUiResumeCandidateEvidence(sqlite);
    sqlite.prepare('INSERT INTO qualified_repos (id) VALUES (?)').run(973);
    const data = await buildMuiBaseUiPopoverChallengeFixture();

    await persistReviewChallengeGraph(
      createNodeSqliteD1(sqlite),
      973,
      data.input,
      data.packet,
      data.graph,
    );

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(result.status).toBe('MATCHED');
    expect(result.repoId).toBe(973);
    expect(result.prNumber).toBe(973);
    expect(result.explanation?.selectedPr).toEqual({
      challengeId: data.packet.id,
      repoId: '973',
      prNumber: 973,
      sourceVersion: data.input.repoSnapshot.id,
    });
    expect(result.explanation?.roleSources).toEqual([]);
    expect(result.explanation?.validatorAgent).toEqual(expect.objectContaining({
      agentName: 'source_backed_match_validator',
      verdict: 'PASSED',
      sourceBridge: expect.objectContaining({
        candidateSourceCount: expect.any(Number),
        repoSourceCount: expect.any(Number),
        roleSourceCount: 0,
        provenanceComplete: true,
      }),
    }));
    expect(result.explanation?.validatorAgent?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'role_context_alignment',
        passed: true,
        reason: 'No role source was supplied for this standalone match.',
      }),
    ]));
    expect(result.explanation?.assessmentQuality?.verdict).toMatch(/^(STRONG|USABLE)$/);
    expect(result.explanation?.missingEvidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'candidate',
        reason: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
      }),
    ]));
    expect(result.explanation?.rejectedPackets).toEqual([]);
    expect(result.explanation?.evidence.every((entry) => entry.roleSourceRefs.length === 0)).toBe(true);
    expect(result.explanation?.candidateSpans.flatMap((span) =>
      span.sourceRefs.map((source) => source.exactText),
    )).toContain(resumeText);
    expect(result.explanation?.evidence.length ?? 0).toBeGreaterThanOrEqual(4);

    const matchRun = sqlite.prepare(
      `SELECT role_context_id, role_snapshot_id, selected_packet_id, ranked_results_json
         FROM match_runs
        WHERE id = ?`,
    ).get(result.matchRunId) as {
      role_context_id: string | null;
      role_snapshot_id: string;
      selected_packet_id: string;
      ranked_results_json: string;
    };
    expect(matchRun.role_context_id).toBeNull();
    expect(matchRun.role_snapshot_id).toBe('standalone-code-review-v1');
    expect(matchRun.selected_packet_id).toBe(data.packet.id);
    const [rankedResult] = JSON.parse(matchRun.ranked_results_json) as Array<{
      validatorAgent: { verdict: string; sourceBridge: { roleSourceCount: number } };
      alignments: Array<{
        sharedConcepts: string[];
        roleSourceRefs: unknown[];
      }>;
    }>;
    expect(rankedResult.validatorAgent).toEqual(expect.objectContaining({
      verdict: 'PASSED',
      sourceBridge: expect.objectContaining({ roleSourceCount: 0 }),
    }));
    const sharedConcepts = new Set(rankedResult.alignments.flatMap((alignment) => alignment.sharedConcepts));
    expect(sharedConcepts.has('term:patient-click-threshold')).toBe(true);
    expect(sharedConcepts.has('term:popover')).toBe(true);
    expect(sharedConcepts.has('term:javascript-test-runner')).toBe(true);
    expect(rankedResult.alignments.every((alignment) => alignment.roleSourceRefs.length === 0)).toBe(true);
  });

  it('returns NO_ROLE_SAFE_CHALLENGE instead of falling back to a persisted ineligible smallest PR', async () => {
    sqlite.exec(assessmentLayerMigration);
    seedCandidateEvidence(sqlite);
    seedIneligiblePacket(sqlite);

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(result.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(result.repoId).toBeUndefined();
    expect(result.diagnostics?.excludedPackets).toEqual([
      expect.objectContaining({
        id: 'packet-ineligible-smallest-pr',
        repoId: '2',
        prNumber: 1,
        reason: 'PACKET_NOT_PRODUCTION_READY',
        gateFailures: ['production_language'],
        qualityScore: 0.4,
      }),
    ]);
    expect(result.diagnostics?.recalledPacketIds).toEqual([]);
    expect(result.diagnostics?.evaluatedChallenges).toEqual([]);
    expect(result.explanation?.rejectedPackets).toEqual([
      expect.objectContaining({
        id: 'packet-ineligible-smallest-pr',
        repoId: '2',
        prNumber: 1,
        reasons: ['PACKET_NOT_PRODUCTION_READY'],
        gateFailures: ['production_language'],
        qualityScore: 0.4,
      }),
    ]);
    const row = sqlite.prepare(
      'SELECT status, selected_packet_id, excluded_packets_json, ranked_results_json FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as {
      status: string;
      selected_packet_id: string | null;
      excluded_packets_json: string;
      ranked_results_json: string;
    };
    expect(row.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(row.selected_packet_id).toBeNull();
    expect(JSON.parse(row.excluded_packets_json)).toEqual([
      expect.objectContaining({
        id: 'packet-ineligible-smallest-pr',
        reason: 'PACKET_NOT_PRODUCTION_READY',
        gateFailures: ['production_language'],
        qualityScore: 0.4,
      }),
    ]);
    expect(JSON.parse(row.ranked_results_json)).toEqual([]);
    const assessmentSession = sqlite.prepare(
      `SELECT id, state
         FROM assessment_sessions
        WHERE ingestion_key = ?`,
    ).get(`assessment-session:repo-match:${result.matchRunId}`) as {
      id: string;
      state: string;
    };
    expect(assessmentSession.state).toBe('DIAGNOSTIC');
    const assessmentReport = sqlite.prepare(
      `SELECT id, status, summary
         FROM assessment_evaluation_reports
        WHERE ingestion_key = ?`,
    ).get(`assessment-diagnostic:repo-match:${result.matchRunId}:NO_ROLE_SAFE_CHALLENGE`) as {
      id: string;
      status: string;
      summary: string;
    };
    expect(assessmentReport).toMatchObject({
      status: 'NO_ROLE_SAFE_CHALLENGE',
      summary: expect.stringContaining('no role-safe review challenge'),
    });
    expect(sqlite.prepare(
      `SELECT d.code, d.severity, d.retryable,
              r.source_ref_type, r.source_ref_id, r.evidence_role
         FROM assessment_diagnostics d
         JOIN assessment_diagnostic_source_refs r ON r.diagnostic_id = d.id
        WHERE d.report_id = ?`,
    ).get(assessmentReport.id)).toEqual({
      code: 'NO_ROLE_SAFE_CHALLENGE',
      severity: 'blocking',
      retryable: 0,
      source_ref_type: 'match_run',
      source_ref_id: result.matchRunId,
      evidence_role: 'decision_record',
    });
  });

  it('rejects legacy hand-shaped challenge packets before recall', async () => {
    seedCandidateEvidence(sqlite);
    seedLegacyHandShapedPacket(sqlite);

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(result.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(result.repoId).toBeUndefined();
    expect(result.diagnostics?.excludedPackets).toEqual([
      expect.objectContaining({
        id: 'packet-eligible',
        repoId: '3',
        prNumber: 42,
        reason: 'PACKET_PROVENANCE_INVALID',
        provenanceFailures: expect.arrayContaining([
          expect.stringContaining('contentHash is stale'),
        ]),
      }),
    ]);
    expect(result.diagnostics?.recalledPacketIds).toEqual([]);
    expect(result.diagnostics?.evaluatedChallenges).toEqual([]);
    expect(result.explanation?.rejectedPackets).toEqual([
      expect.objectContaining({
        id: 'packet-eligible',
        repoId: '3',
        prNumber: 42,
        reasons: ['PACKET_PROVENANCE_INVALID'],
        provenanceFailures: expect.arrayContaining([
          expect.stringContaining('contentHash is stale'),
        ]),
      }),
    ]);
    expect(result.explanation?.missingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'repo',
        reason: 'PACKET_PROVENANCE_INVALID',
        challengeId: 'packet-eligible',
      }),
    ]));
  });

  it('includes repo and PR context for role-guardrail rejected packets', async () => {
    seedCandidateEvidence(sqlite);
    const data = await seedProductionReadyPacket(sqlite, 3);

    const result = await matchCandidateToReviewChallenge(
      createNodeSqliteD1(sqlite),
      'candidate-1',
      { requiredLanguages: ['python'] },
    );

    expect(result.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(result.diagnostics?.excludedPackets).toEqual([
      expect.objectContaining({
        id: data.packet.id,
        reason: 'ROLE_GUARDRAIL_FAILED',
        repoId: '3',
        prNumber: data.packet.pullRequest.number,
      }),
    ]);
    expect(result.explanation?.rejectedPackets).toEqual([
      expect.objectContaining({
        id: data.packet.id,
        repoId: '3',
        prNumber: data.packet.pullRequest.number,
        reasons: ['ROLE_GUARDRAIL_FAILED'],
      }),
    ]);
    const row = sqlite.prepare(
      'SELECT excluded_packets_json FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as { excluded_packets_json: string };
    expect(JSON.parse(row.excluded_packets_json)).toEqual([
      expect.objectContaining({
        id: data.packet.id,
        repoId: '3',
        prNumber: data.packet.pullRequest.number,
        reason: 'ROLE_GUARDRAIL_FAILED',
      }),
    ]);
  });

  it('persists matched explanations as source-backed match context records', async () => {
    seedCandidateEvidence(sqlite);
    sqlite.prepare('INSERT INTO role_contexts (id) VALUES (?)').run('role-context-1');
    const data = await seedProductionReadyPacket(sqlite, 3);
    const roleSourceReferences = [{
      entityId: 'context-record-jd',
      locator: 'simple_job_description:source_span:jd-span-1',
      conceptKeys: ['term:kafka'],
    }];

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1', {
      roleContextId: 'role-context-1',
      roleSnapshotId: 'role-context:role-context-1:source-backed:simple-jd-v1',
      roleConcepts: ['term:kafka'],
      requiredConcepts: ['term:kafka'],
      conceptResolverVersion: 'open-term-v1',
      roleSourceReferences,
    });

    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.repoId).toBeUndefined();
    expect(result.prNumber).toBeUndefined();
    expect(result.explanation?.evidence).toEqual([]);
    expect(result.explanation?.selectedPr).toBeUndefined();
    expect(result.explanation?.candidateSpans).toEqual([]);
    expect(result.explanation?.repoSpans).toEqual([]);
    expect(result.explanation?.roleSources).toEqual(roleSourceReferences);
    expect(result.diagnostics?.evaluatedChallenges).toEqual([
      expect.objectContaining({
        challengeId: data.packet.id,
        alignedDemandCount: 2,
        stretchCount: 0,
      }),
    ]);

    const contextRecord = sqlite.prepare(
      `SELECT id, scope_type, scope_id, record_type, predicate, confidence
         FROM context_records WHERE scope_id = ?`,
    ).get(result.matchRunId) as {
      id: string;
      scope_type: string;
      scope_id: string;
      record_type: string;
      predicate: string;
      confidence: number;
    };
    expect(contextRecord).toMatchObject({
      scope_type: 'match_run',
      scope_id: result.matchRunId,
      record_type: 'candidate_pr_match_decision',
      predicate: 'records match diagnostic',
    });

    const matchRun = sqlite.prepare(
      `SELECT role_context_id, role_snapshot_id, query_json, status, selected_packet_id, ranked_results_json
         FROM match_runs
        WHERE id = ?`,
    ).get(result.matchRunId) as {
      role_context_id: string;
      role_snapshot_id: string;
      query_json: string;
      status: string;
      selected_packet_id: string | null;
      ranked_results_json: string;
    };
    expect(matchRun.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(matchRun.selected_packet_id).toBeNull();
    expect(matchRun.role_context_id).toBe('role-context-1');
    expect(matchRun.role_snapshot_id).toBe('role-context:role-context-1:source-backed:simple-jd-v1');
    expect(JSON.parse(matchRun.query_json)).toEqual(expect.objectContaining({
      roleGuardrails: expect.objectContaining({
        requiredConcepts: ['term:kafka'],
        sourceReferences: roleSourceReferences,
      }),
    }));
    const [rankedResult] = JSON.parse(matchRun.ranked_results_json) as Array<{
      challengeId: string;
      assessmentQuality: { metrics: Array<{ id: string; score: number }> };
    }>;
    expect(rankedResult.challengeId).toBe(data.packet.id);
    expect(rankedResult.assessmentQuality.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'contrast_separation',
        score: 0,
      }),
    ]));

    const refs = sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, source_span_id, evidence_role, exact_text, content_hash
         FROM context_record_source_refs
        WHERE context_record_id = ?
        ORDER BY source_ref_type, source_ref_id, evidence_role`,
    ).all(contextRecord.id);
    expect(refs).toEqual(expect.arrayContaining([
      {
        source_ref_type: 'match_run',
        source_ref_id: result.matchRunId,
        source_span_id: null,
        evidence_role: 'decision_record',
        exact_text: null,
        content_hash: null,
      },
      {
        source_ref_type: 'review_challenge_packet',
        source_ref_id: data.packet.id,
        source_span_id: null,
        evidence_role: 'considered_packet',
        exact_text: null,
        content_hash: data.packet.contentHash,
      },
      {
        source_ref_type: 'role_source',
        source_ref_id: 'context-record-jd',
        source_span_id: null,
        evidence_role: 'role_source',
        exact_text: null,
        content_hash: null,
      },
      {
        source_ref_type: 'source_span',
        source_ref_id: 'candidate-span-1',
        source_span_id: 'candidate-span-1',
        evidence_role: 'candidate_evidence',
        exact_text: 'implemented kafka idempotency',
        content_hash: 'sha256:candidate',
      },
      {
        source_ref_type: 'source_span',
        source_ref_id: 'candidate-span-2',
        source_span_id: 'candidate-span-2',
        evidence_role: 'candidate_evidence',
        exact_text: 'validated retry handling',
        content_hash: 'sha256:candidate',
      },
      {
        source_ref_type: 'repo_source_span',
        source_ref_id: data.packet.demands[0]!.sourceSpanIds[0]!,
        source_span_id: null,
        evidence_role: 'repo_evidence',
        exact_text: expect.any(String),
        content_hash: expect.any(String),
      },
      {
        source_ref_type: 'repo_source_span',
        source_ref_id: data.packet.demands[1]!.sourceSpanIds[0]!,
        source_span_id: null,
        evidence_role: 'repo_evidence',
        exact_text: expect.any(String),
        content_hash: expect.any(String),
      },
    ]));
    expect(refs.some((ref) => ref.evidence_role === 'selected_packet')).toBe(false);
    expect(refs.some((ref) => ref.evidence_role === 'selected_candidate_evidence')).toBe(false);
    expect(refs.some((ref) => ref.evidence_role === 'selected_repo_evidence')).toBe(false);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_record_source_spans
        WHERE context_record_id = ?`,
    ).get(contextRecord.id)).toEqual({ count: 2 });
    expect(sqlite.prepare(
      `SELECT entity_type, entity_id, relationship
         FROM context_record_entities
        WHERE context_record_id = ?
          AND relationship = 'selected_packet'`,
    ).get(contextRecord.id)).toBeUndefined();
    expect(sqlite.prepare(
      `SELECT entity_type, entity_id, relationship
         FROM context_record_entities
        WHERE context_record_id = ?
          AND relationship = 'role_context'`,
    ).get(contextRecord.id)).toEqual({
      entity_type: 'role_context',
      entity_id: 'role-context-1',
      relationship: 'role_context',
    });
    const roleSourceRef = sqlite.prepare(
      `SELECT locator_json, metadata_json
         FROM context_record_source_refs
        WHERE context_record_id = ?
          AND source_ref_type = 'role_source'`,
    ).get(contextRecord.id) as {
      locator_json: string;
      metadata_json: string;
    };
    expect(JSON.parse(roleSourceRef.locator_json)).toEqual({
      roleContextId: 'role-context-1',
      locator: 'simple_job_description:source_span:jd-span-1',
    });
    expect(JSON.parse(roleSourceRef.metadata_json)).toEqual({
      conceptKeys: ['term:kafka'],
      roleSourceEntityId: 'context-record-jd',
    });
    expect(sqlite.prepare(
      `SELECT c.canonical_key, crc.relationship, crc.weight
         FROM context_record_concepts crc
         JOIN concepts c ON c.id = crc.concept_id
        WHERE crc.context_record_id = ?
        ORDER BY c.canonical_key`,
    ).all(contextRecord.id)).toEqual([]);
  });

  it('matches against a production-ready packet persisted through repo graph ingestion', async () => {
    seedCandidateEvidence(sqlite);
    sqlite.prepare('INSERT INTO qualified_repos (id) VALUES (?)').run(41);
    const data = await buildProductionReadyRepoChallengeFixture();

    expect(data.packet.quality.eligible).toBe(true);
    expect(data.packet.quality.score).toBeGreaterThanOrEqual(0.7);
    expect(data.packet.demandFamilies).toEqual([
      'artifact:source',
      'verification:term:vitest',
    ]);
    expect(data.packet.demands).toHaveLength(2);
    expect(data.packet.demands.every((demand) =>
      demand.sourceSpanIds.length > 0
      && demand.conceptKeys.includes('term:kafka'),
    )).toBe(true);

    await persistReviewChallengeGraph(
      createNodeSqliteD1(sqlite),
      41,
      data.input,
      data.packet,
      data.graph,
    );

    expect(sqlite.prepare(
      `SELECT production_ready, quality_score, packet_json
         FROM review_challenge_packets
        WHERE id = ?`,
    ).get(data.packet.id)).toEqual({
      production_ready: 1,
      quality_score: data.packet.quality.score,
      packet_json: JSON.stringify(data.packet),
    });

    const result = await matchCandidateToReviewChallenge(createNodeSqliteD1(sqlite), 'candidate-1');

    expect(result.status).toBe('MATCHED');
    expect(result.repoId).toBe(41);
    expect(result.prNumber).toBe(88);
    expect(result.explanation?.selectedPr).toEqual({
      challengeId: data.packet.id,
      repoId: '41',
      prNumber: 88,
      sourceVersion: data.input.repoSnapshot.id,
    });
    expect(result.explanation?.evidence).toHaveLength(2);
    expect(result.explanation?.candidateSpans).toHaveLength(2);
    expect(result.explanation?.repoSpans).toHaveLength(2);
    expect(result.explanation?.missingEvidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'candidate',
        reason: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
      }),
    ]));
    expect(result.explanation?.rejectedPackets).toEqual([]);
    expect(result.diagnostics?.evaluatedChallenges).toEqual([
      expect.objectContaining({
        challengeId: data.packet.id,
        repoId: '41',
        prNumber: 88,
        alignedDemandCount: 2,
        stretchCount: 0,
        provenanceComplete: true,
        eligible: true,
      }),
    ]);

    const repoExactTexts = new Set(data.input.sourceSpans.map((span) => span.exactText));
    expect(result.explanation?.evidence.every((entry) =>
      entry.candidateSourceRefs.length > 0
      && entry.challengeSourceRefs.length > 0
      && entry.candidateSourceRefs.every((ref) => ref.sourceRefType === 'source_span' && ref.exactText)
      && entry.challengeSourceRefs.every((ref) =>
        ref.sourceRefType === 'repo_source_span'
        && ref.exactText
        && repoExactTexts.has(ref.exactText)
        && ref.locator?.startsWith('src/')
      ),
    )).toBe(true);

    const ranked = sqlite.prepare(
      'SELECT ranked_results_json, selected_packet_id FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as {
      ranked_results_json: string;
      selected_packet_id: string;
    };
    expect(ranked.selected_packet_id).toBe(data.packet.id);
    const [rankedResult] = JSON.parse(ranked.ranked_results_json) as Array<{
      challengeId: string;
      alignments: Array<{
        sharedConcepts: string[];
        candidateSourceRefs: Array<{ sourceRefType?: string; exactText?: string }>;
        challengeSourceRefs: Array<{ sourceRefType?: string; exactText?: string }>;
      }>;
    }>;
    expect(rankedResult).toEqual(expect.objectContaining({
      challengeId: data.packet.id,
    }));
    expect(rankedResult.alignments.every((alignment) =>
      alignment.sharedConcepts.includes('term:kafka')
      && alignment.candidateSourceRefs.some((ref) => ref.sourceRefType === 'source_span' && ref.exactText)
      && alignment.challengeSourceRefs.some((ref) => ref.sourceRefType === 'repo_source_span' && ref.exactText),
    )).toBe(true);

    const contextRecord = sqlite.prepare(
      `SELECT id, scope_type, scope_id, record_type, predicate
         FROM context_records
        WHERE scope_id = ?
          AND record_type = 'candidate_pr_match_decision'`,
    ).get(result.matchRunId) as {
      id: string;
      scope_type: string;
      scope_id: string;
      record_type: string;
      predicate: string;
    };
    expect(contextRecord).toMatchObject({
      scope_type: 'match_run',
      scope_id: result.matchRunId,
      record_type: 'candidate_pr_match_decision',
      predicate: 'selects review challenge',
    });

    const contextRefs = sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, exact_text, content_hash, evidence_role
         FROM context_record_source_refs
        WHERE context_record_id = ?
        ORDER BY evidence_role, source_ref_id`,
    ).all(contextRecord.id) as Array<{
      source_ref_type: string;
      source_ref_id: string;
      exact_text: string | null;
      content_hash: string | null;
      evidence_role: string;
    }>;
    expect(contextRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_ref_type: 'review_challenge_packet',
        source_ref_id: data.packet.id,
        content_hash: data.packet.contentHash,
        evidence_role: 'selected_packet',
      }),
      expect.objectContaining({
        source_ref_type: 'source_span',
        source_ref_id: 'candidate-span-1',
        exact_text: 'implemented kafka idempotency',
        evidence_role: 'selected_candidate_evidence',
      }),
      expect.objectContaining({
        source_ref_type: 'source_span',
        source_ref_id: 'candidate-span-2',
        exact_text: 'validated retry handling',
        evidence_role: 'selected_candidate_evidence',
      }),
    ]));
    const selectedRepoContextRefs = contextRefs.filter((ref) =>
      ref.evidence_role === 'selected_repo_evidence'
      && ref.source_ref_type === 'repo_source_span'
      && ref.exact_text
      && repoExactTexts.has(ref.exact_text),
    );
    const explanationRepoRefIds = new Set(
      result.explanation?.evidence.flatMap((entry) =>
        entry.challengeSourceRefs.flatMap((ref) => ref.sourceRefId ? [ref.sourceRefId] : [])
      ) ?? [],
    );
    expect(selectedRepoContextRefs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(selectedRepoContextRefs.map((ref) => ref.source_ref_id))).toEqual(explanationRepoRefIds);
  });

  it('returns NEEDS_MORE_EVIDENCE when evidence diversity is below threshold', async () => {
    const db = createNodeSqliteD1(sqlite);
    await ensureCandidateLivingContext(db, 'candidate-1');

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      transcript: 'Discussed distributed systems architecture',
      segments: [{ speaker: 'host', text: 'Discussed distributed systems architecture', timestampMs: 0 }],
      startedAt: OBSERVED_AT,
      endedAt: OBSERVED_AT,
      provider: 'test',
    });

    const result = await matchCandidateToReviewChallenge(db, 'candidate-1', {
      minEvidenceDiversity: 0.5,
    });

    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.diagnostics?.candidateEvidenceDepth).toBeDefined();
    expect(result.diagnostics!.candidateEvidenceDepth!.sourceDiversity).toBeLessThan(0.5);
    expect(result.diagnostics!.evaluatedChallenges).toEqual([]);
  });

  it('does not gate when defaults are zero (preserves existing behavior)', async () => {
    const db = createNodeSqliteD1(sqlite);
    await ensureCandidateLivingContext(db, 'candidate-1');

    const result = await matchCandidateToReviewChallenge(db, 'candidate-1', {
      minEvidenceDiversity: 0,
      minEvidenceInteractions: 0,
    });

    // Defaults are 0/0, so the evidence depth gate never fires.
    // The engine proceeds and returns NEEDS_MORE_EVIDENCE because no signals exist.
    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.diagnostics?.candidateEvidenceDepth).toBeDefined();
    // The explanation is populated by the engine (not short-circuited by our gate).
    expect(result.explanation).toBeDefined();
  });

  it('returns NEEDS_MORE_EVIDENCE when interaction count is below threshold', async () => {
    const db = createNodeSqliteD1(sqlite);
    await ensureCandidateLivingContext(db, 'candidate-1');

    const result = await matchCandidateToReviewChallenge(db, 'candidate-1', {
      minEvidenceInteractions: 5,
    });

    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.diagnostics?.candidateEvidenceDepth).toBeDefined();
    expect(result.diagnostics!.candidateEvidenceDepth!.totalInteractions).toBeLessThan(5);
  });
});

describe('deriveCorpusGenericConcepts', () => {
  it('derives genericity from packet prevalence without a semantic vocabulary', () => {
    const packets = Array.from({ length: 5 }, (_, index) => ({
      id: `packet-${index}`,
      repoId: `repo-${index}`,
      prNumber: index,
      sourceVersion: `version-${index}`,
      challengeReady: true,
      languages: [],
      seniority: 'senior',
      concepts: [
        'term:shared-runtime-concept',
        ...(index === 0 ? ['term:never-before-seen-specific-concept'] : []),
      ],
      demands: [],
      quality: { deterministic: 1, contextualSpecificity: 1 },
    })) satisfies ChallengePacket[];

    expect(deriveCorpusGenericConcepts(packets)).toEqual([
      'term:shared-runtime-concept',
    ]);
  });

  it('derives genericity from packet prevalence without a semantic vocabulary (empty seniority)', () => {
    const packets = Array.from({ length: 5 }, (_, index) => ({
      id: `packet-${index}`,
      repoId: `repo-${index}`,
      prNumber: index,
      sourceVersion: `version-${index}`,
      challengeReady: true,
      languages: [],
      concepts: [
        'term:shared-runtime-concept',
        ...(index === 0 ? ['term:never-before-seen-specific-concept'] : []),
      ],
      demands: [],
      quality: { deterministic: 1, contextualSpecificity: 1 },
    })) satisfies ChallengePacket[];

    expect(deriveCorpusGenericConcepts(packets)).toEqual([
      'term:shared-runtime-concept',
    ]);
  });
});
