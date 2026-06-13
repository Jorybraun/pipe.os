import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RepoSemanticGraphPersistenceError,
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
} from '../index';

interface SqliteStatement {
  run(...bindings: unknown[]): { changes: number | bigint };
  get(...bindings: unknown[]): unknown;
  all(...bindings: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};
const migration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const OBSERVED_AT = '2026-06-12T12:00:00.000Z';

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
          const result = sqlite.prepare(query).run(...bindings);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...bindings) as T | undefined) ?? null;
        },
        async all<T>() {
          return { success: true, results: sqlite.prepare(query).all(...bindings) as T[], meta: {} };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

async function fixture() {
  const snapshot = await buildRepoSnapshot({
    repository: {
      provider: 'github',
      owner: 'pipe-labs',
      name: 'open-semantics',
      canonicalUrl: 'https://github.com/pipe-labs/open-semantics',
    },
    commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    defaultBranch: 'main',
    observedAt: OBSERVED_AT,
  });
  const content = 'export async function reconcileQuantumLedger() { return "stable"; }';
  const artifact = await buildSourceArtifact({
    repoSnapshotId: snapshot.id,
    kind: 'source',
    path: 'src/quantumLedger.ts',
    language: 'typescript',
  });
  const version = await buildSourceArtifactVersion({
    artifactId: artifact.id,
    repoSnapshotId: snapshot.id,
    content,
    createdAt: OBSERVED_AT,
  });
  const span = await buildSourceSpan({
    repoSnapshotId: snapshot.id,
    artifactId: artifact.id,
    artifactVersionId: version.id,
    contentHash: version.contentHash,
    start: { byteOffset: 0, line: 1, column: 1 },
    end: { byteOffset: version.byteLength, line: 1, column: content.length + 1 },
    exactText: content,
    prSide: 'head',
  });
  const returnText = 'return "stable";';
  const returnStart = content.indexOf(returnText);
  const detailSpan = await buildSourceSpan({
    repoSnapshotId: snapshot.id,
    artifactId: artifact.id,
    artifactVersionId: version.id,
    contentHash: version.contentHash,
    start: { byteOffset: returnStart, line: 1, column: returnStart + 1 },
    end: {
      byteOffset: returnStart + new TextEncoder().encode(returnText).byteLength,
      line: 1,
      column: returnStart + returnText.length + 1,
    },
    exactText: returnText,
    prSide: 'head',
  });
  const symbol = await buildSymbol({
    repoSnapshotId: snapshot.id,
    language: 'typescript',
    qualifiedName: 'src/quantumLedger.ts:reconcileQuantumLedger',
    name: 'reconcileQuantumLedger',
    kind: 'function',
    definingSpanId: span.id,
    exported: true,
  });
  const input: NormalizedPullRequestInput = {
    repoSnapshot: snapshot,
    number: 7,
    url: 'https://github.com/pipe-labs/open-semantics/pull/7',
    title: 'Reconcile the quantum ledger',
    author: 'engineer',
    primaryLanguage: 'TypeScript',
    baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headSha: snapshot.commitSha,
    mergedAt: OBSERVED_AT,
    metadataSourceSpanIds: [span.id],
    sourceSpans: [span, detailSpan],
    changedFiles: [{
      path: 'src/quantumLedger.ts',
      status: 'modified',
      language: 'typescript',
      additions: 1,
      deletions: 0,
      artifact,
      artifactVersion: version,
      hunks: [{ header: '@@ reconcile @@', patch: content, sourceSpan: span, changedSymbolIds: [symbol.id] }],
      symbols: [symbol],
    }],
    tests: [],
  };
  const fact = await buildStructuralFact({
    repoSnapshotId: snapshot.id,
    kind: 'calls',
    subject: { symbolId: symbol.id },
    object: { concept: 'term:quantum-ledger' },
    sourceSpanIds: [span.id, detailSpan.id],
    confidence: 0.91,
    parser: 'tree-sitter-typescript-v1',
  });
  const episode = await buildCodeEpisode({
    repoSnapshotId: snapshot.id,
    title: 'quantum-ledger-reconciliation',
    narrative: 'The change reconciles an unfamiliar ledger protocol.',
    symbolIds: [symbol.id],
    structuralFactIds: [fact.id],
    sourceSpanIds: [span.id, detailSpan.id],
    conceptKeys: ['term:quantum-ledger'],
  });
  const builtFacet = await buildFacet({
    repoSnapshotId: snapshot.id,
    kind: 'mechanism',
    key: 'quantum-ledger-reconciliation',
    label: 'Quantum ledger reconciliation',
    aliases: ['qlr'],
    sourceSpanIds: [span.id, detailSpan.id],
    confidence: 0.87,
  });
  const facet = { ...builtFacet, kind: 'unseen-mechanism-family' };
  const assertion = await buildSemanticAssertion({
    repoSnapshotId: snapshot.id,
    subject: symbol.id,
    predicate: 'reconciles.without.semantic.whitelist',
    object: 'term:quantum-ledger',
    narrative: 'The function reconciles the quantum ledger.',
    qualifiers: { mode: 'deterministic' },
    facetIds: [facet.id],
    conceptKeys: ['term:quantum-ledger'],
    sourceSpanIds: [span.id, detailSpan.id],
    confidence: 0.88,
    extractor: 'open-extractor-v9',
  });
  const signal = await buildRepoSignal({
    repoSnapshotId: snapshot.id,
    key: 'quantum-ledger-reconciliation',
    narrative: 'The repository demonstrates quantum ledger reconciliation.',
    assertionIds: [assertion.id],
    facetIds: [facet.id],
    sourceSpanIds: [span.id, detailSpan.id],
    confidence: 0.86,
    sourceDiversity: 1,
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
      assertionEpisodeIds: { [assertion.id]: episode.id },
    },
    ids: {
      fact: fact.id,
      episode: episode.id,
      facet: facet.id,
      assertion: assertion.id,
      signal: signal.id,
      spans: [span.id, detailSpan.id].sort(),
    },
  };
}

describe('persistReviewChallengeGraph semantic persistence', () => {
  let sqlite: SqliteDatabase;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);');
    sqlite.exec('INSERT INTO qualified_repos (id) VALUES (41);');
    sqlite.exec(migration);
  });

  afterEach(() => sqlite.close());

  it('persists an open semantic graph with exact provenance and replays idempotently', async () => {
    const data = await fixture();

    await persistReviewChallengeGraph(d1(sqlite), 41, data.input, data.packet, data.graph);
    await persistReviewChallengeGraph(d1(sqlite), 41, data.input, data.packet, data.graph);

    for (const table of [
      'repo_structural_facts',
      'repo_code_episodes',
      'repo_facets',
      'repo_semantic_assertions',
      'repo_assertion_facets',
      'repo_signals',
    ]) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 1 });
    }
    expect(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM repo_assertion_source_spans',
    ).get()).toEqual({ count: 2 });

    const fact = sqlite.prepare(
      'SELECT fact_type, source_span_id, properties_json FROM repo_structural_facts WHERE id = ?',
    ).get(data.ids.fact) as { fact_type: string; source_span_id: string; properties_json: string };
    expect(fact.fact_type).toBe('calls');
    expect(fact.source_span_id).toBe(data.ids.spans[0]);
    expect(JSON.parse(fact.properties_json)).toMatchObject({
      sourceSpanIds: data.ids.spans,
      parser: 'tree-sitter-typescript-v1',
      object: { concept: 'term:quantum-ledger' },
    });

    const episode = sqlite.prepare(
      'SELECT episode_type, member_ids_json FROM repo_code_episodes WHERE id = ?',
    ).get(data.ids.episode) as { episode_type: string; member_ids_json: string };
    expect(episode.episode_type).toBe('quantum-ledger-reconciliation');
    expect(JSON.parse(episode.member_ids_json)).toMatchObject({
      structuralFactIds: [data.ids.fact],
      sourceSpanIds: data.ids.spans,
      conceptKeys: ['term:quantum-ledger'],
    });

    const persistedFacet = sqlite.prepare(
      'SELECT id, family, aliases_json FROM repo_facets WHERE family = ?',
    ).get('unseen-mechanism-family') as { id: string; family: string; aliases_json: string };
    expect(persistedFacet.id).toBe(data.ids.facet);
    expect(JSON.parse(persistedFacet.aliases_json)).toMatchObject({
      aliases: ['qlr'],
      sourceSpanIds: data.ids.spans,
    });

    expect(sqlite.prepare(
      `SELECT predicate, episode_id, assertion_version
         FROM repo_semantic_assertions WHERE id = ?`,
    ).get(data.ids.assertion)).toEqual({
      predicate: 'reconciles.without.semantic.whitelist',
      episode_id: data.ids.episode,
      assertion_version: 'open-extractor-v9',
    });
    expect(sqlite.prepare(
      `SELECT source_span_id
         FROM repo_assertion_source_spans
        WHERE assertion_id = ?
        ORDER BY source_span_id`,
    ).all(data.ids.assertion)).toEqual(
      [...data.ids.spans].sort().map((source_span_id) => ({ source_span_id })),
    );

    const persistedSignal = sqlite.prepare(
      'SELECT evidence_assertion_ids_json FROM repo_signals WHERE id = ?',
    ).get(data.ids.signal) as { evidence_assertion_ids_json: string };
    expect(JSON.parse(persistedSignal.evidence_assertion_ids_json)).toMatchObject({
      assertionIds: [data.ids.assertion],
      facetIds: [data.ids.facet],
      sourceSpanIds: data.ids.spans,
      key: 'quantum-ledger-reconciliation',
    });
  });

  it('replaces stale derived semantics when the same snapshot is rebuilt', async () => {
    const data = await fixture();
    await persistReviewChallengeGraph(d1(sqlite), 41, data.input, data.packet, data.graph);

    await persistReviewChallengeGraph(d1(sqlite), 41, data.input, data.packet, {
      structuralFacts: [],
      codeEpisodes: [],
      facets: [],
      semanticAssertions: [],
      repoSignals: [],
    });

    for (const table of [
      'repo_structural_facts',
      'repo_code_episodes',
      'repo_semantic_assertions',
      'repo_assertion_source_spans',
      'repo_assertion_facets',
      'repo_signals',
    ]) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
        count: 0,
      });
    }
  });

  it('canonicalizes repeated declarations without discarding their source spans', async () => {
    const data = await fixture();
    const file = data.input.changedFiles[0]!;
    const firstSymbol = file.symbols[0]!;
    const secondSymbol = await buildSymbol({
      repoSnapshotId: data.input.repoSnapshot.id,
      language: firstSymbol.language,
      qualifiedName: firstSymbol.qualifiedName,
      name: firstSymbol.name,
      kind: firstSymbol.kind,
      signature: 'export function reconcileQuantumLedger(): Promise<void>',
      definingSpanId: data.input.sourceSpans[1]!.id,
      exported: true,
    });

    expect(secondSymbol.id).toBe(firstSymbol.id);
    expect(secondSymbol.contentHash).not.toBe(firstSymbol.contentHash);

    data.input.changedFiles.push({
      ...file,
      artifact: file.artifact,
      artifactVersion: file.artifactVersion,
      hunks: [],
      symbols: [secondSymbol],
    });
    data.input.sourceSpans = [
      ...data.input.sourceSpans,
      data.input.sourceSpans[1]!,
    ];

    await persistReviewChallengeGraph(d1(sqlite), 41, data.input, data.packet, data.graph);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_symbols').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_source_spans').get()).toEqual({
      count: 2,
    });
  });

  it('rejects dangling provenance before writing semantic rows', async () => {
    const data = await fixture();
    data.graph.semanticAssertions[0] = {
      ...data.graph.semanticAssertions[0],
      sourceSpanIds: ['missing-source-span'],
    };

    await expect(
      persistReviewChallengeGraph(d1(sqlite), 41, data.input, data.packet, data.graph),
    ).rejects.toThrow(RepoSemanticGraphPersistenceError);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_semantic_assertions').get()).toEqual({
      count: 0,
    });
  });
});
