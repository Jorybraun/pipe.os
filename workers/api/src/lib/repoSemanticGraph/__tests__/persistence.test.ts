import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
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


const migration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const OBSERVED_AT = '2026-06-12T12:00:00.000Z';



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
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);');
    sqlite.exec('INSERT INTO qualified_repos (id) VALUES (41);');
    sqlite.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec(livingContextMigration);
    sqlite.exec(migration);
    sqlite.exec(contextRecordMigration);
  });

  afterEach(() => sqlite.close());

  it('persists an open semantic graph with exact provenance and replays idempotently', async () => {
    const data = await fixture();

    const packet = await buildChallengePacket(data.input);
    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, packet, data.graph);
    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, data.packet, data.graph);

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

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({
      count: 1,
    });
    const contextRecord = sqlite.prepare(
      `SELECT scope_type, scope_id, record_type, predicate, narrative,
              confidence, extraction_version
         FROM context_records`,
    ).get() as {
      scope_type: string;
      scope_id: string;
      record_type: string;
      predicate: string;
      narrative: string;
      confidence: number;
      extraction_version: string;
    };
    expect(contextRecord).toMatchObject({
      scope_type: 'repo_snapshot',
      scope_id: data.input.repoSnapshot.id,
      record_type: 'repo_challenge_packet',
      predicate: 'defines reviewable pull request challenge',
      extraction_version: '1.0.0',
    });
    expect(contextRecord.narrative).toContain('PR #7');
    expect(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM context_record_source_refs',
    ).get()).toEqual({ count: data.packet.sourceSpanIds.length });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_record_source_refs
        WHERE source_ref_type = 'repo_source_span'
          AND source_ref_id IN (${data.packet.sourceSpanIds.map(() => '?').join(',')})`,
    ).get(...data.packet.sourceSpanIds)).toEqual({ count: data.packet.sourceSpanIds.length });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_record_entities
        WHERE entity_type = 'challenge_demand'`,
    ).get()).toEqual({ count: data.packet.demands.length });
    const contextConceptRows = sqlite.prepare(
      `SELECT c.canonical_key, c.namespace, c.label, crc.relationship, crc.weight
         FROM context_record_concepts crc
         JOIN concepts c ON c.id = crc.concept_id
        ORDER BY c.canonical_key`,
    ).all() as Array<{
      canonical_key: string;
      namespace: string;
      label: string;
      relationship: string;
      weight: number;
    }>;
    expect(contextConceptRows).toEqual(expect.arrayContaining([{
      canonical_key: 'term:quantum-ledger',
      namespace: 'term',
      label: 'quantum ledger',
      relationship: 'concept',
      weight: 1,
    }]));
  });

  it('replaces stale derived semantics when the same snapshot is rebuilt', async () => {
    const data = await fixture();
    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, data.packet, data.graph);

    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, data.packet, {
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

    const packet = await buildChallengePacket(data.input);
    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, packet, data.graph);

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
      persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, data.packet, data.graph),
    ).rejects.toThrow(RepoSemanticGraphPersistenceError);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_semantic_assertions').get()).toEqual({
      count: 0,
    });
  });

  it('force-rebuild produces byte-identical rows and preserves exact source span text', async () => {
    const data = await fixture();

    // First persist
    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, data.packet, data.graph);

    // Capture full state snapshot
    const snapshotBefore = {
      spans: sqlite.prepare(
        'SELECT id, exact_text, byte_start, byte_end, line_start, line_end, content_hash, pr_side FROM repo_source_spans ORDER BY id',
      ).all() as { id: string; exact_text: string; byte_start: number; byte_end: number; line_start: number; line_end: number; content_hash: string; pr_side: string }[],
      symbols: sqlite.prepare(
        'SELECT id, qualified_name, symbol_kind, defining_span_id FROM repo_symbols ORDER BY id',
      ).all(),
      facts: sqlite.prepare(
        'SELECT id, fact_type, properties_json FROM repo_structural_facts ORDER BY id',
      ).all(),
      assertions: sqlite.prepare(
        'SELECT id, predicate, narrative, confidence, assertion_version FROM repo_semantic_assertions ORDER BY id',
      ).all(),
      assertionSpans: sqlite.prepare(
        'SELECT assertion_id, source_span_id FROM repo_assertion_source_spans ORDER BY assertion_id, source_span_id',
      ).all(),
      signals: sqlite.prepare(
        'SELECT id, confidence, evidence_assertion_ids_json FROM repo_signals ORDER BY id',
      ).all(),
      packets: sqlite.prepare(
        'SELECT id, source_hash, quality_score, production_ready, packet_json FROM review_challenge_packets ORDER BY id',
      ).all(),
    };

    // Simulate --force: delete derived semantics and re-persist
    sqlite.exec(`DELETE FROM repo_signals WHERE repo_snapshot_id = '${data.input.repoSnapshot.id}'`);
    sqlite.exec(`DELETE FROM repo_semantic_assertions WHERE repo_snapshot_id = '${data.input.repoSnapshot.id}'`);
    sqlite.exec(`DELETE FROM repo_code_episodes WHERE repo_snapshot_id = '${data.input.repoSnapshot.id}'`);
    sqlite.exec(`DELETE FROM repo_structural_facts WHERE repo_snapshot_id = '${data.input.repoSnapshot.id}'`);

    // Re-persist the identical graph (force-rebuild path)
    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, data.packet, data.graph);

    // Capture state after force-rebuild
    const snapshotAfter = {
      spans: sqlite.prepare(
        'SELECT id, exact_text, byte_start, byte_end, line_start, line_end, content_hash, pr_side FROM repo_source_spans ORDER BY id',
      ).all(),
      symbols: sqlite.prepare(
        'SELECT id, qualified_name, symbol_kind, defining_span_id FROM repo_symbols ORDER BY id',
      ).all(),
      facts: sqlite.prepare(
        'SELECT id, fact_type, properties_json FROM repo_structural_facts ORDER BY id',
      ).all(),
      assertions: sqlite.prepare(
        'SELECT id, predicate, narrative, confidence, assertion_version FROM repo_semantic_assertions ORDER BY id',
      ).all(),
      assertionSpans: sqlite.prepare(
        'SELECT assertion_id, source_span_id FROM repo_assertion_source_spans ORDER BY assertion_id, source_span_id',
      ).all(),
      signals: sqlite.prepare(
        'SELECT id, confidence, evidence_assertion_ids_json FROM repo_signals ORDER BY id',
      ).all(),
      packets: sqlite.prepare(
        'SELECT id, source_hash, quality_score, production_ready, packet_json FROM review_challenge_packets ORDER BY id',
      ).all(),
    };

    // Byte-identical across all tables
    expect(snapshotAfter).toEqual(snapshotBefore);

    // Verify exact source span provenance stored verbatim
    const sourceContent = 'export async function reconcileQuantumLedger() { return "stable"; }';
    const spans = snapshotBefore.spans;
    expect(spans.length).toBe(2);

    const fullSpan = spans.find((s) => s.exact_text === sourceContent)!;
    expect(fullSpan).toBeDefined();
    expect(fullSpan.byte_start).toBe(0);
    expect(fullSpan.byte_end).toBe(new TextEncoder().encode(sourceContent).byteLength);
    expect(fullSpan.line_start).toBe(1);
    expect(fullSpan.line_end).toBe(1);
    expect(fullSpan.pr_side).toBe('head');

    const detailText = 'return "stable";';
    const detailSpan = spans.find((s) => s.exact_text === detailText)!;
    expect(detailSpan).toBeDefined();
    expect(detailSpan.byte_start).toBe(sourceContent.indexOf(detailText));
    expect(detailSpan.byte_end).toBe(
      sourceContent.indexOf(detailText) + new TextEncoder().encode(detailText).byteLength,
    );
  });

  it('rejects stale packet provenance before writing review_challenge_packets', async () => {
    const data = await fixture();
    const stalePacket = {
      ...data.packet,
      sourceSpanIds: [data.ids.spans[0]!],
    };

    await expect(
      persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, stalePacket, data.graph),
    ).rejects.toThrow(/review challenge packet provenance is invalid/);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_source_artifacts').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_artifact_versions').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_source_spans').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_symbols').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_semantic_assertions').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_signals').get()).toEqual({
      count: 0,
    });
  });

  it('rejects packets that reference symbols not persisted from the current normalized PR input', async () => {
    const data = await fixture();
    const invalidInput: NormalizedPullRequestInput = {
      ...data.input,
      changedFiles: data.input.changedFiles.map((file) => ({
        ...file,
        hunks: file.hunks.map((hunk) => ({
          ...hunk,
          changedSymbolIds: [...hunk.changedSymbolIds, 'repo-symbol-not-in-current-input'],
        })),
      })),
    };
    const packetWithMissingSymbol = await buildChallengePacket(invalidInput);

    await expect(
      persistReviewChallengeGraph(createMockD1(sqlite), 41, invalidInput, packetWithMissingSymbol, data.graph),
    ).rejects.toThrow(/references missing persisted symbols/);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_source_artifacts').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_artifact_versions').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_source_spans').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_symbols').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_semantic_assertions').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_signals').get()).toEqual({
      count: 0,
    });
  });

  it('rejects packets whose demand-family projection no longer matches their demands', async () => {
    const data = await fixture();
    const stalePacket = {
      ...data.packet,
      demandFamilies: [],
      contentHash: (await buildChallengePacket({
        ...data.input,
        title: 'Reconcile the quantum ledger demand family drift',
      })).contentHash,
    };

    await expect(
      persistReviewChallengeGraph(createMockD1(sqlite), 41, {
        ...data.input,
        title: 'Reconcile the quantum ledger demand family drift',
      }, stalePacket, data.graph),
    ).rejects.toThrow(/demand families are stale/);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_semantic_assertions').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_signals').get()).toEqual({
      count: 0,
    });
  });

  it('rejects a self-consistent packet rebuilt from stale normalized PR content before writing source rows', async () => {
    const data = await fixture();
    const stalePacket = await buildChallengePacket({
      ...data.input,
      title: 'Stale title from an older pull request fetch',
    });

    expect(stalePacket.contentHash).not.toBe(data.packet.contentHash);

    await expect(
      persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, stalePacket, data.graph),
    ).rejects.toThrow(/current normalized pull request content/);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_source_spans').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({
      count: 0,
    });
  });

  it('rejects normalized PR input with source text that no longer matches its immutable hash', async () => {
    const data = await fixture();
    const invalidInput: NormalizedPullRequestInput = {
      ...data.input,
      sourceSpans: data.input.sourceSpans.map((span, index) =>
        index === 0
          ? { ...span, exactText: 'fabricated source text' }
          : span,
      ),
    };

    await expect(
      persistReviewChallengeGraph(createMockD1(sqlite), 41, invalidInput, data.packet, data.graph),
    ).rejects.toThrow(/review challenge input provenance is invalid/);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_source_artifacts').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_artifact_versions').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_source_spans').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_symbols').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({
      count: 0,
    });
  });

  it('does not replace existing semantic graph rows when packet provenance is stale', async () => {
    const data = await fixture();
    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, data.packet, data.graph);

    const stalePacket = {
      ...data.packet,
      sourceSpanIds: [data.ids.spans[0]!],
    };
    await expect(
      persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, stalePacket, {
        structuralFacts: [],
        codeEpisodes: [],
        facets: [],
        semanticAssertions: [],
        repoSignals: [],
      }),
    ).rejects.toThrow(/review challenge packet provenance is invalid/);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_semantic_assertions').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM repo_signals').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({
      count: 1,
    });
  });

  it('keeps packet persistence idempotent and backed by exact stored source spans', async () => {
    const data = await fixture();

    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, data.packet, data.graph);
    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, data.packet, data.graph);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_source_refs').get()).toEqual({
      count: data.packet.sourceSpanIds.length,
    });

    const row = sqlite.prepare(
      'SELECT source_hash, demand_families_json, packet_json FROM review_challenge_packets WHERE id = ?',
    ).get(data.packet.id) as {
      source_hash: string;
      demand_families_json: string;
      packet_json: string;
    };
    const packet = JSON.parse(row.packet_json);
    const spanRows = sqlite.prepare(
      'SELECT id, exact_text FROM repo_source_spans ORDER BY id',
    ).all() as { id: string; exact_text: string }[];
    const exactTextBySpan = new Map(spanRows.map((span) => [span.id, span.exact_text]));
    const sourceRefs = sqlite.prepare(
      `SELECT refs.source_ref_id, refs.exact_text, refs.content_hash, spans.exact_text AS span_exact_text,
              spans.content_hash AS span_content_hash
         FROM context_record_source_refs refs
         JOIN repo_source_spans spans ON spans.id = refs.source_ref_id
        WHERE refs.source_ref_type = 'repo_source_span'
        ORDER BY refs.source_ref_id`,
    ).all() as {
      source_ref_id: string;
      exact_text: string;
      content_hash: string;
      span_exact_text: string;
      span_content_hash: string;
    }[];

    expect(row.source_hash).toBe(data.packet.contentHash);
    expect(JSON.parse(row.demand_families_json)).toEqual(data.packet.demandFamilies);
    expect(packet.contentHash).toBe(data.packet.contentHash);
    expect(packet.sourceSpanIds.length).toBeGreaterThan(0);
    expect(packet.sourceSpanIds.every((spanId: string) => exactTextBySpan.has(spanId))).toBe(true);
    expect(sourceRefs).toHaveLength(data.packet.sourceSpanIds.length);
    expect(sourceRefs.every((ref) =>
      ref.exact_text === ref.span_exact_text
      && ref.content_hash === ref.span_content_hash,
    )).toBe(true);
    expect(packet.demands.every((demand: { sourceSpanIds: string[] }) =>
      demand.sourceSpanIds.length > 0
      && demand.sourceSpanIds.every((spanId) => exactTextBySpan.has(spanId)),
    )).toBe(true);
    expect([...exactTextBySpan.values()]).toEqual(
      expect.arrayContaining([
        'export async function reconcileQuantumLedger() { return "stable"; }',
        'return "stable";',
      ]),
    );
  });

  it('marks ineligible packets when provenance is incomplete', async () => {
    const data = await fixture();
    await persistReviewChallengeGraph(createMockD1(sqlite), 41, data.input, data.packet, data.graph);

    const packet = sqlite.prepare(
      'SELECT production_ready, quality_score FROM review_challenge_packets WHERE id = ?',
    ).get(data.packet.id) as { production_ready: number; quality_score: number };

    // The fixture has minimal files (1 file, 1 line) — below quality thresholds
    // so production_ready should be 0 (ineligible for matching)
    expect(packet.production_ready).toBe(0);
    expect(packet.quality_score).toBeGreaterThanOrEqual(0);
    expect(packet.quality_score).toBeLessThanOrEqual(1);
  });
});
