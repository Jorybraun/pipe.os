import type {
  ChallengePacket,
  CodeEpisode,
  Facet,
  NormalizedPullRequestInput,
  RepoSignal,
  SemanticAssertion,
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

async function persistSemanticGraph(
  db: D1Database,
  repoSnapshotId: string,
  graph: RepoSemanticGraphPersistenceInput,
  persistedSpanIds: ReadonlySet<string>,
  persistedSymbolIds: ReadonlySet<string>,
): Promise<void> {
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

  const persistedFacetIds = new Map<string, string>();
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
  for (const file of input.changedFiles) {
    artifactPaths.set(file.artifact.id, file.path);
    await db.prepare(
      `INSERT INTO repo_source_artifacts (
         id, repo_snapshot_id, artifact_type, path, external_reference, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      file.artifact.id,
      input.repoSnapshot.id,
      file.artifact.kind,
      file.path,
      file.artifact.externalRef ?? null,
    ).run();
    await db.prepare(
      `INSERT INTO repo_artifact_versions (
         id, artifact_id, content_hash, storage_key, inline_content,
         byte_length, media_type, created_at
       ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, unixepoch())
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      file.artifactVersion.id,
      file.artifact.id,
      file.artifactVersion.contentHash,
      file.artifactVersion.content,
      file.artifactVersion.byteLength,
      file.artifact.mediaType,
    ).run();
    persistedVersions.add(file.artifactVersion.id);
  }

  for (const span of input.sourceSpans) {
    if (!persistedVersions.has(span.artifactVersionId)) continue;
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
      artifactPaths.get(span.artifactId) ?? null,
      span.start.byteOffset,
      span.end.byteOffset,
      span.start.line,
      span.end.line,
      span.prSide ?? null,
      input.baseSha,
      input.headSha,
      span.exactText,
    ).run();
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

  await persistSemanticGraph(
    db,
    input.repoSnapshot.id,
    graph,
    persistedSpanIds,
    symbolIds,
  );
  await persistChallengePacket(db, repoId, packet);
}
