import { hashObject, stableId, stableJson } from './hash';
import { buildChallengePacket } from './challengePacket';
import { LivingContextStore } from '../livingContext/persistence';
import type { ContextRecordInput, JsonObject } from '../livingContext/types';
import type {
  ChallengePacket,
  CodeEpisode,
  Facet,
  NormalizedPullRequestInput,
  RepoSignal,
  SemanticAssertion,
  SourceSpan,
  StructuralFact,
} from './model';

export interface RepoSemanticGraphPersistenceInput {
  structuralFacts?: StructuralFact[];
  codeEpisodes?: CodeEpisode[];
  semanticAssertions?: SemanticAssertion[];
  facets?: Facet[];
  repoSignals?: RepoSignal[];
  /** @deprecated Assertions now carry their episodeId directly. */
  assertionEpisodeIds?: Record<string, string>;
}

export class RepoSemanticGraphPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoSemanticGraphPersistenceError';
  }
}

function requireSnapshot(
  entityType: string,
  entity: { id: string; repoSnapshotId: string },
  repoSnapshotId: string,
): void {
  if (entity.repoSnapshotId !== repoSnapshotId) {
    throw new RepoSemanticGraphPersistenceError(
      `${entityType} ${entity.id} belongs to snapshot ${entity.repoSnapshotId}, expected ${repoSnapshotId}`,
    );
  }
}

function requireReferences(
  entityType: string,
  entityId: string,
  referenceType: string,
  references: readonly string[],
  available: ReadonlySet<string>,
): void {
  const missing = references.filter((reference) => !available.has(reference));
  if (missing.length > 0) {
    throw new RepoSemanticGraphPersistenceError(
      `${entityType} ${entityId} references missing ${referenceType}: ${missing.join(', ')}`,
    );
  }
}

function repoSpanLocator(
  span: SourceSpan,
  path: string | undefined,
  input: NormalizedPullRequestInput,
): JsonObject {
  return {
    repoSnapshotId: span.repoSnapshotId,
    artifactId: span.artifactId,
    artifactVersionId: span.artifactVersionId,
    path: path ?? null,
    byteStart: span.start.byteOffset,
    byteEnd: span.end.byteOffset,
    lineStart: span.start.line,
    lineEnd: span.end.line,
    columnStart: span.start.column,
    columnEnd: span.end.column,
    prSide: span.prSide ?? null,
    baseSha: input.baseSha,
    headSha: input.headSha,
  };
}

async function assertPersistedSourceSpanMatchesInput(
  db: D1Database,
  span: SourceSpan,
  path: string | undefined,
  input: NormalizedPullRequestInput,
): Promise<void> {
  const row = await db.prepare(
    `SELECT artifact_version_id, content_hash, path, byte_start, byte_end,
            line_start, line_end, pr_side, base_sha, head_sha, exact_text
       FROM repo_source_spans
      WHERE id = ?1`,
  ).bind(span.id).first<{
    artifact_version_id: string;
    content_hash: string;
    path: string | null;
    byte_start: number | null;
    byte_end: number | null;
    line_start: number | null;
    line_end: number | null;
    pr_side: string | null;
    base_sha: string | null;
    head_sha: string | null;
    exact_text: string;
  }>();
  if (!row) {
    throw new RepoSemanticGraphPersistenceError(
      `repo source span ${span.id} was not persisted`,
    );
  }

  const expected = {
    artifact_version_id: span.artifactVersionId,
    content_hash: span.contentHash,
    path: path ?? null,
    byte_start: span.start.byteOffset,
    byte_end: span.end.byteOffset,
    line_start: span.start.line,
    line_end: span.end.line,
    pr_side: span.prSide ?? null,
    base_sha: input.baseSha,
    head_sha: input.headSha,
    exact_text: span.exactText,
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => row[key as keyof typeof row] !== value)
    .map(([key]) => key)
    .sort();
  if (mismatches.length > 0) {
    throw new RepoSemanticGraphPersistenceError(
      `repo source span ${span.id} does not match immutable input fields: ${mismatches.join(', ')}`,
    );
  }
}

function conceptNamespace(canonicalKey: string): string {
  const separator = canonicalKey.indexOf(':');
  return separator > 0 ? canonicalKey.slice(0, separator) : 'open';
}

function conceptLabel(canonicalKey: string): string {
  const separator = canonicalKey.indexOf(':');
  const raw = separator >= 0 ? canonicalKey.slice(separator + 1) : canonicalKey;
  return raw.replace(/[-_]+/g, ' ').trim() || canonicalKey;
}

function buildChallengePacketContextRecordInput(
  input: NormalizedPullRequestInput,
  packet: ChallengePacket,
  contextConcepts: Array<{ conceptId: string; canonicalKey: string }>,
): ContextRecordInput {
  const pathByArtifactId = new Map(
    [
      ...(input.sourceArtifacts ?? []).flatMap((artifact) =>
        artifact.path ? [[artifact.id, artifact.path] as const] : []
      ),
      ...input.changedFiles.map((file) => [file.artifact.id, file.path] as const),
    ],
  );
  const spanById = new Map(input.sourceSpans.map((span) => [span.id, span] as const));
  const concepts = [...new Set(packet.demands.flatMap((demand) => demand.conceptKeys))].sort();

  return {
    ingestionKey: `repo-challenge-packet-context:${packet.id}`,
    scopeType: 'repo_snapshot',
    scopeId: packet.repoSnapshotId,
    recordType: 'repo_challenge_packet',
    predicate: 'defines reviewable pull request challenge',
    narrative: `Review challenge packet for ${packet.repository.owner}/${packet.repository.name} PR #${packet.pullRequest.number}: ${packet.pullRequest.title}`,
    qualifiers: {
      packetId: packet.id,
      policyVersion: packet.policyVersion,
      packetContentHash: packet.contentHash,
      qualityScore: packet.quality.score,
      productionReady: packet.quality.eligible,
      demandFamilies: packet.demandFamilies,
    },
    confidence: packet.quality.metrics.provenanceCoverage,
    extractionVersion: packet.schemaVersion,
    observedAt: input.repoSnapshot.observedAt,
    sources: packet.sourceSpanIds.map((spanId) => {
      const span = spanById.get(spanId);
      return {
        sourceRefType: 'repo_source_span',
        sourceRefId: spanId,
        evidenceRole: 'source',
        locator: span
          ? repoSpanLocator(span, pathByArtifactId.get(span.artifactId), input)
          : { repoSnapshotId: packet.repoSnapshotId },
        exactText: span?.exactText ?? null,
        contentHash: span?.contentHash ?? null,
        metadata: {
          source: 'review_challenge_packet',
          packetId: packet.id,
        },
      };
    }),
    entities: [
      {
        entityType: 'repo_snapshot',
        entityId: packet.repoSnapshotId,
        relationship: 'scope',
      },
      {
        entityType: 'repository',
        entityId: `${packet.repository.provider}:${packet.repository.owner}/${packet.repository.name}`,
        relationship: 'repository',
        value: {
          provider: packet.repository.provider,
          owner: packet.repository.owner,
          name: packet.repository.name,
          canonicalUrl: packet.repository.canonicalUrl,
        },
      },
      {
        entityType: 'pull_request',
        entityId: `${packet.repository.provider}:${packet.repository.owner}/${packet.repository.name}#${packet.pullRequest.number}`,
        relationship: 'pull_request',
        value: {
          number: packet.pullRequest.number,
          url: packet.pullRequest.url,
          title: packet.pullRequest.title,
          baseSha: packet.pullRequest.baseSha,
          headSha: packet.pullRequest.headSha,
        },
      },
      {
        entityType: 'review_challenge_packet',
        entityId: packet.id,
        relationship: 'packet',
        metadata: {
          contentHash: packet.contentHash,
          demandFamilies: packet.demandFamilies,
        },
      },
      ...packet.demands.map((demand) => ({
        entityType: 'challenge_demand',
        entityId: demand.id,
        relationship: 'demand',
        metadata: {
          family: demand.family,
          sourceSpanIds: demand.sourceSpanIds,
          changedSymbolIds: demand.changedSymbolIds,
          conceptKeys: demand.conceptKeys,
          weight: demand.weight,
          contentHash: demand.contentHash,
        },
      })),
      ...packet.changedSymbolIds.map((symbolId) => ({
        entityType: 'repo_symbol',
        entityId: symbolId,
        relationship: 'changed_symbol',
      })),
      ...concepts.map((conceptKey) => ({
        entityType: 'open_concept',
        relationship: 'concept',
        value: { canonicalKey: conceptKey },
      })),
    ],
    concepts: contextConcepts.map((concept) => ({
      conceptId: concept.conceptId,
      relationship: 'concept',
      weight: 1,
    })),
  };
}

async function validateChallengePacketPersistence(
  packet: ChallengePacket,
  expectedPacket: ChallengePacket,
  repoSnapshotId: string,
  persistedSpanIds: ReadonlySet<string>,
  persistedSymbolIds: ReadonlySet<string>,
): Promise<void> {
  const failures: string[] = [];
  const packetSpanIds = new Set(packet.sourceSpanIds);
  const demandFamilies = packet.demands.map((demand) => demand.family).sort();
  const identity = {
    repoSnapshotId: packet.repoSnapshotId,
    prNumber: packet.pullRequest.number,
    baseSha: packet.pullRequest.baseSha.toLowerCase(),
    headSha: packet.pullRequest.headSha.toLowerCase(),
    policyVersion: packet.policyVersion,
  };
  const content = {
    ...identity,
    repository: packet.repository,
    pullRequest: {
      number: packet.pullRequest.number,
      url: packet.pullRequest.url,
      title: packet.pullRequest.title,
      body: packet.pullRequest.body,
      author: packet.pullRequest.author,
      baseSha: identity.baseSha,
      headSha: identity.headSha,
      mergedAt: packet.pullRequest.mergedAt,
    },
    languageSupport: packet.languageSupport,
    changedFilePaths: packet.changedFilePaths,
    changedSymbolIds: packet.changedSymbolIds,
    sourceSpanIds: packet.sourceSpanIds,
    testChanges: packet.testChanges,
    issue: packet.issue,
    demands: packet.demands,
    demandFamilies: packet.demandFamilies,
    quality: packet.quality,
  };

  if (packet.repoSnapshotId !== repoSnapshotId) {
    failures.push(`packet ${packet.id} belongs to snapshot ${packet.repoSnapshotId}, expected ${repoSnapshotId}`);
  }
  if (packet.schemaVersion !== expectedPacket.schemaVersion) {
    failures.push(`packet ${packet.id} schema version is stale; expected ${expectedPacket.schemaVersion}`);
  }
  if (packet.sourceSpanIds.length === 0) {
    failures.push(`packet ${packet.id} has no source spans`);
  }
  const missingPacketSpans = packet.sourceSpanIds.filter((spanId) => !persistedSpanIds.has(spanId));
  if (missingPacketSpans.length > 0) {
    failures.push(`packet ${packet.id} references missing persisted source spans: ${missingPacketSpans.join(', ')}`);
  }
  const missingPacketSymbols = packet.changedSymbolIds.filter((symbolId) => !persistedSymbolIds.has(symbolId));
  if (missingPacketSymbols.length > 0) {
    failures.push(`packet ${packet.id} references missing persisted symbols: ${missingPacketSymbols.join(', ')}`);
  }
  if (stableJson(packet.demandFamilies) !== stableJson(demandFamilies)) {
    failures.push(`packet ${packet.id} demand families are stale`);
  }

  for (const demand of packet.demands) {
    if (demand.sourceSpanIds.length === 0) {
      failures.push(`demand ${demand.id} has no source spans`);
    }
    const demandSpansMissingFromPacket = demand.sourceSpanIds.filter((spanId) => !packetSpanIds.has(spanId));
    if (demandSpansMissingFromPacket.length > 0) {
      failures.push(`demand ${demand.id} references spans absent from packet: ${demandSpansMissingFromPacket.join(', ')}`);
    }
    const missingDemandSpans = demand.sourceSpanIds.filter((spanId) => !persistedSpanIds.has(spanId));
    if (missingDemandSpans.length > 0) {
      failures.push(`demand ${demand.id} references missing persisted source spans: ${missingDemandSpans.join(', ')}`);
    }
    const missingDemandSymbols = demand.changedSymbolIds.filter((symbolId) => !persistedSymbolIds.has(symbolId));
    if (missingDemandSymbols.length > 0) {
      failures.push(`demand ${demand.id} references missing persisted symbols: ${missingDemandSymbols.join(', ')}`);
    }
  }

  for (const test of packet.testChanges) {
    const missingTestSpans = test.sourceSpanIds.filter((spanId) => !persistedSpanIds.has(spanId));
    if (missingTestSpans.length > 0) {
      failures.push(`test change ${test.path} references missing persisted source spans: ${missingTestSpans.join(', ')}`);
    }
  }

  const missingIssueSpans = packet.issue?.sourceSpanIds.filter((spanId) => !persistedSpanIds.has(spanId)) ?? [];
  if (missingIssueSpans.length > 0) {
    failures.push(`issue metadata references missing persisted source spans: ${missingIssueSpans.join(', ')}`);
  }

  const expectedId = await stableId('challenge_packet', identity);
  if (packet.id !== expectedId) {
    failures.push(`packet ${packet.id} has stale identity; expected ${expectedId}`);
  }
  if (packet.id !== expectedPacket.id) {
    failures.push(`packet ${packet.id} does not match the current normalized pull request identity; expected ${expectedPacket.id}`);
  }
  const expectedContentHash = await hashObject(content);
  if (packet.contentHash !== expectedContentHash) {
    failures.push(`packet ${packet.id} content hash is stale; expected ${expectedContentHash}`);
  }
  if (packet.contentHash !== expectedPacket.contentHash) {
    failures.push(`packet ${packet.id} does not match the current normalized pull request content; expected ${expectedPacket.contentHash}`);
  }

  if (failures.length > 0) {
    throw new RepoSemanticGraphPersistenceError(
      `review challenge packet provenance is invalid: ${failures.sort().join('; ')}`,
    );
  }
}

async function persistSemanticGraph(
  db: D1Database,
  repoSnapshotId: string,
  graph: RepoSemanticGraphPersistenceInput,
  persistedSpanIds: ReadonlySet<string>,
  persistedSymbolIds: ReadonlySet<string>,
): Promise<void> {
  validateSemanticGraphReferences(repoSnapshotId, graph, persistedSpanIds, persistedSymbolIds);

  // Semantic rows are a rebuildable projection of immutable source records.
  // Replaying an extractor version must replace stale derived meaning rather
  // than preserve the union of previous and current outputs.
  await db.prepare(
    'DELETE FROM repo_signals WHERE repo_snapshot_id = ?1',
  ).bind(repoSnapshotId).run();
  await db.prepare(
    'DELETE FROM repo_semantic_assertions WHERE repo_snapshot_id = ?1',
  ).bind(repoSnapshotId).run();
  await db.prepare(
    'DELETE FROM repo_code_episodes WHERE repo_snapshot_id = ?1',
  ).bind(repoSnapshotId).run();
  await db.prepare(
    'DELETE FROM repo_structural_facts WHERE repo_snapshot_id = ?1',
  ).bind(repoSnapshotId).run();

  const structuralFacts = graph.structuralFacts ?? [];
  const codeEpisodes = graph.codeEpisodes ?? [];
  const facets = graph.facets ?? [];
  const assertions = graph.semanticAssertions ?? [];
  const signals = graph.repoSignals ?? [];

  const persistedFacetIds = new Map<string, string>();
  for (const fact of structuralFacts) {
    await db.prepare(
      `INSERT INTO repo_structural_facts (
         id, repo_snapshot_id, fact_type, subject_symbol_id, object_symbol_id,
         source_span_id, properties_json, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         fact_type = excluded.fact_type,
         subject_symbol_id = excluded.subject_symbol_id,
         object_symbol_id = excluded.object_symbol_id,
         source_span_id = excluded.source_span_id,
         properties_json = excluded.properties_json`,
    ).bind(
      fact.id,
      repoSnapshotId,
      fact.kind,
      fact.subject.symbolId ?? null,
      fact.object.symbolId ?? null,
      fact.sourceSpanIds[0],
      JSON.stringify({
        schemaVersion: fact.schemaVersion,
        subject: fact.subject,
        object: fact.object,
        sourceSpanIds: fact.sourceSpanIds,
        confidence: fact.confidence,
        parser: fact.parser,
        contentHash: fact.contentHash,
      }),
    ).run();
  }

  for (const episode of codeEpisodes) {
    await db.prepare(
      `INSERT INTO repo_code_episodes (
         id, repo_snapshot_id, episode_type, narrative, member_ids_json, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         episode_type = excluded.episode_type,
         narrative = excluded.narrative,
         member_ids_json = excluded.member_ids_json`,
    ).bind(
      episode.id,
      repoSnapshotId,
      episode.title,
      episode.narrative,
      JSON.stringify({
        schemaVersion: episode.schemaVersion,
        symbolIds: episode.symbolIds,
        structuralFactIds: episode.structuralFactIds,
        sourceSpanIds: episode.sourceSpanIds,
        conceptKeys: episode.conceptKeys,
        contentHash: episode.contentHash,
      }),
    ).run();
  }

  for (const facet of facets) {
    const aliasesJson = JSON.stringify({
      aliases: facet.aliases,
      repoSnapshotId: facet.repoSnapshotId,
      sourceSpanIds: facet.sourceSpanIds,
      confidence: facet.confidence,
      contentHash: facet.contentHash,
      schemaVersion: facet.schemaVersion,
    });
    await db.prepare(
      `INSERT INTO repo_facets (
         id, family, slug, label, parent_id, aliases_json, created_at
       ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, unixepoch())
       ON CONFLICT(family, slug) DO UPDATE SET
         label = excluded.label,
         aliases_json = excluded.aliases_json`,
    ).bind(
      facet.id,
      facet.kind,
      facet.key,
      facet.label,
      aliasesJson,
    ).run();
    const persisted = await db.prepare(
      'SELECT id FROM repo_facets WHERE family = ?1 AND slug = ?2',
    ).bind(facet.kind, facet.key).first<{ id: string }>();
    if (!persisted) {
      throw new RepoSemanticGraphPersistenceError(
        `facet ${facet.id} was not persisted`,
      );
    }
    persistedFacetIds.set(facet.id, persisted.id);
  }

  for (const assertion of assertions) {
    await db.prepare(
      `INSERT INTO repo_semantic_assertions (
         id, repo_snapshot_id, episode_id, subject, predicate, object,
         narrative, qualifiers_json, confidence, assertion_version, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         episode_id = excluded.episode_id,
         subject = excluded.subject,
         predicate = excluded.predicate,
         object = excluded.object,
         narrative = excluded.narrative,
         qualifiers_json = excluded.qualifiers_json,
         confidence = excluded.confidence,
         assertion_version = excluded.assertion_version`,
    ).bind(
      assertion.id,
      repoSnapshotId,
      assertion.episodeId ?? graph.assertionEpisodeIds?.[assertion.id] ?? null,
      assertion.subject,
      assertion.predicate,
      assertion.object,
      assertion.narrative,
      JSON.stringify({
        ...assertion.qualifiers,
        conceptKeys: assertion.conceptKeys,
        contentHash: assertion.contentHash,
        schemaVersion: assertion.schemaVersion,
      }),
      assertion.confidence,
      assertion.extractor,
    ).run();

    for (const sourceSpanId of assertion.sourceSpanIds) {
      await db.prepare(
        `INSERT INTO repo_assertion_source_spans (assertion_id, source_span_id)
         VALUES (?1, ?2)
         ON CONFLICT(assertion_id, source_span_id) DO NOTHING`,
      ).bind(assertion.id, sourceSpanId).run();
    }
    for (const facetId of assertion.facetIds) {
      await db.prepare(
        `INSERT INTO repo_assertion_facets (assertion_id, facet_id, weight)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(assertion_id, facet_id) DO UPDATE SET weight = excluded.weight`,
      ).bind(assertion.id, persistedFacetIds.get(facetId), assertion.confidence).run();
    }
  }

  for (const signal of signals) {
    const mappedFacetIds = signal.facetIds.map((facetId) => persistedFacetIds.get(facetId)!);
    await db.prepare(
      `INSERT INTO repo_signals (
         id, repo_snapshot_id, facet_id, narrative, confidence,
         evidence_assertion_ids_json, signal_version, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         facet_id = excluded.facet_id,
         narrative = excluded.narrative,
         confidence = excluded.confidence,
         evidence_assertion_ids_json = excluded.evidence_assertion_ids_json,
         signal_version = excluded.signal_version`,
    ).bind(
      signal.id,
      repoSnapshotId,
      mappedFacetIds[0] ?? null,
      signal.narrative,
      signal.confidence,
      JSON.stringify({
        assertionIds: signal.assertionIds,
        facetIds: mappedFacetIds,
        sourceSpanIds: signal.sourceSpanIds,
        evidenceCount: signal.evidenceCount,
        sourceDiversity: signal.sourceDiversity,
        key: signal.key,
        contentHash: signal.contentHash,
        schemaVersion: signal.schemaVersion,
      }),
      `${signal.schemaVersion}:${signal.key}`,
    ).run();
  }
}

function validateSemanticGraphReferences(
  repoSnapshotId: string,
  graph: RepoSemanticGraphPersistenceInput,
  persistedSpanIds: ReadonlySet<string>,
  persistedSymbolIds: ReadonlySet<string>,
): void {
  const structuralFacts = graph.structuralFacts ?? [];
  const codeEpisodes = graph.codeEpisodes ?? [];
  const facets = graph.facets ?? [];
  const assertions = graph.semanticAssertions ?? [];
  const signals = graph.repoSignals ?? [];
  const factIds = new Set(structuralFacts.map((fact) => fact.id));
  const episodeIds = new Set(codeEpisodes.map((episode) => episode.id));
  const facetIds = new Set(facets.map((facet) => facet.id));
  const assertionIds = new Set(assertions.map((assertion) => assertion.id));

  for (const fact of structuralFacts) {
    requireSnapshot('structural fact', fact, repoSnapshotId);
    requireReferences('structural fact', fact.id, 'source spans', fact.sourceSpanIds, persistedSpanIds);
    requireReferences(
      'structural fact',
      fact.id,
      'symbols',
      [fact.subject.symbolId, fact.object.symbolId].filter((id): id is string => Boolean(id)),
      persistedSymbolIds,
    );
  }
  for (const episode of codeEpisodes) {
    requireSnapshot('code episode', episode, repoSnapshotId);
    requireReferences('code episode', episode.id, 'source spans', episode.sourceSpanIds, persistedSpanIds);
    requireReferences('code episode', episode.id, 'symbols', episode.symbolIds, persistedSymbolIds);
    requireReferences(
      'code episode',
      episode.id,
      'structural facts',
      episode.structuralFactIds,
      factIds,
    );
  }
  for (const facet of facets) {
    requireSnapshot('facet', facet, repoSnapshotId);
    requireReferences('facet', facet.id, 'source spans', facet.sourceSpanIds, persistedSpanIds);
  }
  for (const assertion of assertions) {
    requireSnapshot('semantic assertion', assertion, repoSnapshotId);
    requireReferences(
      'semantic assertion',
      assertion.id,
      'source spans',
      assertion.sourceSpanIds,
      persistedSpanIds,
    );
    requireReferences('semantic assertion', assertion.id, 'facets', assertion.facetIds, facetIds);
    const episodeId = assertion.episodeId ?? graph.assertionEpisodeIds?.[assertion.id];
    if (episodeId) {
      requireReferences('semantic assertion', assertion.id, 'episodes', [episodeId], episodeIds);
    }
  }
  for (const signal of signals) {
    requireSnapshot('repo signal', signal, repoSnapshotId);
    requireReferences('repo signal', signal.id, 'source spans', signal.sourceSpanIds, persistedSpanIds);
    requireReferences('repo signal', signal.id, 'assertions', signal.assertionIds, assertionIds);
    requireReferences('repo signal', signal.id, 'facets', signal.facetIds, facetIds);
  }
}

export async function persistChallengePacket(
  db: D1Database,
  repoId: number,
  packet: ChallengePacket,
): Promise<void> {
  await db.prepare(
    `INSERT INTO review_challenge_packets (
       id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash,
       language, production_ready, quality_score, demand_families_json,
       packet_json, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, unixepoch(), unixepoch())
     ON CONFLICT(repo_snapshot_id, pr_number, packet_version) DO UPDATE SET
       source_hash = excluded.source_hash,
       language = excluded.language,
       production_ready = excluded.production_ready,
       quality_score = excluded.quality_score,
       demand_families_json = excluded.demand_families_json,
       packet_json = excluded.packet_json,
       updated_at = unixepoch()`,
  ).bind(
    packet.id,
    packet.repoSnapshotId,
    repoId,
    packet.pullRequest.number,
    packet.policyVersion,
    packet.contentHash,
    packet.languageSupport.normalizedLanguage,
    packet.quality.eligible ? 1 : 0,
    packet.quality.score,
    JSON.stringify(packet.demandFamilies),
    JSON.stringify(packet),
  ).run();
}

export async function persistReviewChallengeGraph(
  db: D1Database,
  repoId: number,
  input: NormalizedPullRequestInput,
  packet: ChallengePacket,
  graph: RepoSemanticGraphPersistenceInput = {},
): Promise<void> {
  let expectedPacket: ChallengePacket;
  try {
    expectedPacket = await buildChallengePacket(input);
  } catch (error) {
    throw new RepoSemanticGraphPersistenceError(
      `review challenge input provenance is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    packet.schemaVersion !== expectedPacket.schemaVersion
    || packet.id !== expectedPacket.id
    || packet.contentHash !== expectedPacket.contentHash
  ) {
    throw new RepoSemanticGraphPersistenceError(
      `review challenge packet provenance is invalid: packet ${packet.id} does not match the current normalized pull request content; expected ${expectedPacket.contentHash}`,
    );
  }

  const inputSpanIds = new Set(input.sourceSpans.map((span) => span.id));
  const inputSymbolIds = new Set(input.changedFiles.flatMap((file) => file.symbols.map((symbol) => symbol.id)));
  await validateChallengePacketPersistence(
    packet,
    expectedPacket,
    input.repoSnapshot.id,
    inputSpanIds,
    inputSymbolIds,
  );
  validateSemanticGraphReferences(
    input.repoSnapshot.id,
    graph,
    inputSpanIds,
    inputSymbolIds,
  );

  await db.prepare(
    `INSERT INTO repo_snapshots (
       id, repo_id, commit_sha, tree_hash, extractor_version, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
     ON CONFLICT(repo_id, commit_sha, extractor_version) DO NOTHING`,
  ).bind(
    input.repoSnapshot.id,
    repoId,
    input.repoSnapshot.commitSha,
    input.repoSnapshot.treeHash ?? null,
    input.repoSnapshot.schemaVersion,
  ).run();

  const persistedVersions = new Set<string>();
  const persistedSpanIds = new Set<string>();
  const artifactPaths = new Map<string, string>();
  const artifacts = new Map<string, {
    id: string;
    repoSnapshotId: string;
    kind: string;
    path?: string;
    externalRef?: string;
    mediaType: string;
  }>();
  const artifactVersions = new Map<string, {
    id: string;
    artifactId: string;
    contentHash: string;
    content: string;
    byteLength: number;
  }>();
  for (const artifact of input.sourceArtifacts ?? []) {
    artifacts.set(artifact.id, artifact);
    if (artifact.path) artifactPaths.set(artifact.id, artifact.path);
  }
  for (const version of input.sourceArtifactVersions ?? []) {
    artifactVersions.set(version.id, version);
  }
  for (const file of input.changedFiles) {
    artifactPaths.set(file.artifact.id, file.path);
    artifacts.set(file.artifact.id, file.artifact);
    artifactVersions.set(file.artifactVersion.id, file.artifactVersion);
  }

  for (const artifact of artifacts.values()) {
    await db.prepare(
      `INSERT INTO repo_source_artifacts (
         id, repo_snapshot_id, artifact_type, path, external_reference, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      artifact.id,
      input.repoSnapshot.id,
      artifact.kind,
      artifact.path ?? null,
      artifact.externalRef ?? null,
    ).run();
  }

  for (const version of artifactVersions.values()) {
    const artifact = artifacts.get(version.artifactId);
    await db.prepare(
      `INSERT INTO repo_artifact_versions (
         id, artifact_id, content_hash, storage_key, inline_content,
         byte_length, media_type, created_at
       ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, unixepoch())
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      version.id,
      version.artifactId,
      version.contentHash,
      version.content,
      version.byteLength,
      artifact?.mediaType ?? 'text/plain',
    ).run();
    persistedVersions.add(version.id);
  }

  for (const span of input.sourceSpans) {
    if (!persistedVersions.has(span.artifactVersionId)) continue;
    const path = artifactPaths.get(span.artifactId);
    await db.prepare(
      `INSERT INTO repo_source_spans (
         id, artifact_version_id, content_hash, path,
         byte_start, byte_end, line_start, line_end, pr_side,
         base_sha, head_sha, exact_text, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, unixepoch())
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      span.id,
      span.artifactVersionId,
      span.contentHash,
      path ?? null,
      span.start.byteOffset,
      span.end.byteOffset,
      span.start.line,
      span.end.line,
      span.prSide ?? null,
      input.baseSha,
      input.headSha,
      span.exactText,
    ).run();
    await assertPersistedSourceSpanMatchesInput(db, span, path, input);
    persistedSpanIds.add(span.id);
  }

  const symbols = input.changedFiles
    .flatMap((file) => file.symbols)
    .filter((symbol) => persistedSpanIds.has(symbol.definingSpanId));
  for (const symbol of symbols) {
    await db.prepare(
      `INSERT INTO repo_symbols (
         id, repo_snapshot_id, language, qualified_name, symbol_kind,
         signature, containing_symbol_id, defining_span_id, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch())
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      symbol.id,
      input.repoSnapshot.id,
      symbol.language,
      symbol.qualifiedName,
      symbol.kind,
      symbol.signature ?? null,
      null,
      symbol.definingSpanId,
    ).run();
  }
  const symbolIds = new Set(symbols.map((symbol) => symbol.id));
  for (const symbol of symbols) {
    if (!symbol.containingSymbolId || !symbolIds.has(symbol.containingSymbolId)) continue;
    await db.prepare(
      `UPDATE repo_symbols SET containing_symbol_id = ?2 WHERE id = ?1`,
    ).bind(symbol.id, symbol.containingSymbolId).run();
  }

  await validateChallengePacketPersistence(
    packet,
    expectedPacket,
    input.repoSnapshot.id,
    persistedSpanIds,
    symbolIds,
  );
  await persistSemanticGraph(
    db,
    input.repoSnapshot.id,
    graph,
    persistedSpanIds,
    symbolIds,
  );
  const contextStore = new LivingContextStore(db, () => input.repoSnapshot.observedAt);
  const contextConcepts: Array<{ conceptId: string; canonicalKey: string }> = [];
  const packetConceptKeys = [...new Set(packet.demands.flatMap((demand) => demand.conceptKeys))]
    .map((conceptKey) => conceptKey.trim())
    .filter((conceptKey) => conceptKey.length > 0)
    .sort();
  for (const canonicalKey of packetConceptKeys) {
    const concept = await contextStore.upsertConcept({
      ingestionKey: `repo-open-concept:${canonicalKey}`,
      canonicalKey,
      namespace: conceptNamespace(canonicalKey),
      label: conceptLabel(canonicalKey),
      metadata: {
        source: 'repo_challenge_packet',
        repoSnapshotId: input.repoSnapshot.id,
        packetId: packet.id,
        policyVersion: packet.policyVersion,
      },
    });
    contextConcepts.push({ conceptId: concept.id, canonicalKey });
  }
  await contextStore.upsertContextRecord(
    buildChallengePacketContextRecordInput(input, packet, contextConcepts),
  );
  await persistChallengePacket(db, repoId, packet);
}
