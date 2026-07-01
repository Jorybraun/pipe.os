/**
 * Repository decomposition overlay — loads a challenge packet's structural
 * graph (files, symbols, demands, structural facts) and maps candidate
 * evidence onto specific code regions.
 *
 * Criteria #4 (understand repositories) + #7 (visualize the living graph).
 */

export interface RepoFileNode {
  path: string;
  language: string | null;
  artifactType: string;
  lineCount: number | null;
  symbolCount: number;
  demandCount: number;
  candidateAlignmentScore: number | null;
}

export interface RepoSymbolNode {
  id: string;
  qualifiedName: string;
  kind: string;
  language: string;
  signature: string | null;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  containingSymbolId: string | null;
  demandIds: string[];
  candidateAlignmentScore: number | null;
}

export interface RepoDemandNode {
  id: string;
  family: string;
  narrative: string;
  conceptKeys: string[];
  weight: number;
  sourceFilePaths: string[];
  symbolIds: string[];
  candidateAlignmentScore: number | null;
  candidateEvidenceCount: number;
}

export interface RepoStructuralFactNode {
  id: string;
  factType: string;
  subjectSymbolId: string | null;
  objectSymbolId: string | null;
  sourceFilePath: string | null;
}

export interface CandidateEvidenceOverlay {
  conceptKey: string;
  evidenceCount: number;
  totalStrength: number;
  sourceTypes: string[];
}

export interface RepoDecompositionOverlay {
  packetId: string;
  repoSnapshotId: string;
  repoName: string;
  prNumber: number;
  prTitle: string;
  primaryLanguage: string;
  files: RepoFileNode[];
  symbols: RepoSymbolNode[];
  demands: RepoDemandNode[];
  structuralFacts: RepoStructuralFactNode[];
  candidateEvidenceOverlay: CandidateEvidenceOverlay[];
  coverageSummary: {
    totalDemands: number;
    coveredDemands: number;
    partialDemands: number;
    uncoveredDemands: number;
    overallScore: number;
  };
}

interface PacketRow {
  id: string;
  repo_snapshot_id: string;
  pr_number: number;
  packet_json: string;
  repo_id: number;
}

interface RepoRow {
  id: number;
  full_name: string;
}

interface SymbolRow {
  id: string;
  qualified_name: string;
  symbol_kind: string;
  language: string;
  signature: string | null;
  containing_symbol_id: string | null;
  defining_span_id: string;
}

interface SpanRow {
  id: string;
  path: string | null;
  line_start: number | null;
  line_end: number | null;
  artifact_version_id: string;
}

interface FactRow {
  id: string;
  fact_type: string;
  subject_symbol_id: string | null;
  object_symbol_id: string | null;
  source_span_id: string;
}

interface ArtifactRow {
  id: string;
  path: string | null;
  artifact_type: string;
}

interface CandidateEvidenceRow {
  concept_key: string;
  evidence_count: number;
  total_strength: number;
  source_types: string;
}

interface ParsedPacket {
  id: string;
  pullRequest: {
    number: number;
    title: string;
  };
  languageSupport?: {
    language?: string;
  };
  demands: Array<{
    id: string;
    family: string;
    narrative: string;
    conceptKeys: string[];
    weight: number;
    sourceSpanIds: string[];
    changedSymbolIds: string[];
  }>;
  changedFilePaths: string[];
}

export async function loadRepoDecompositionOverlay(
  db: D1Database,
  packetId: string,
  candidateId: string,
): Promise<RepoDecompositionOverlay | null> {
  const packetRow = await db.prepare(
    `SELECT id, repo_snapshot_id, pr_number, packet_json, repo_id
     FROM review_challenge_packets
     WHERE id = ?`,
  ).bind(packetId).first<PacketRow>();

  if (!packetRow) return null;

  const repoRow = await db.prepare(
    `SELECT id, full_name FROM qualified_repos WHERE id = ?`,
  ).bind(packetRow.repo_id).first<RepoRow>();

  let parsed: ParsedPacket;
  try {
    parsed = JSON.parse(packetRow.packet_json) as ParsedPacket;
  } catch {
    return null;
  }

  const snapshotId = packetRow.repo_snapshot_id;

  const [symbolRows, factRows, artifactRows, candidateEvidence] = await Promise.all([
    db.prepare(
      `SELECT s.id, s.qualified_name, s.symbol_kind, s.language, s.signature,
              s.containing_symbol_id, s.defining_span_id
       FROM repo_symbols s
       WHERE s.repo_snapshot_id = ?`,
    ).bind(snapshotId).all<SymbolRow>(),

    db.prepare(
      `SELECT f.id, f.fact_type, f.subject_symbol_id, f.object_symbol_id, f.source_span_id
       FROM repo_structural_facts f
       WHERE f.repo_snapshot_id = ?`,
    ).bind(snapshotId).all<FactRow>(),

    db.prepare(
      `SELECT a.id, a.path, a.artifact_type
       FROM repo_source_artifacts a
       WHERE a.repo_snapshot_id = ?`,
    ).bind(snapshotId).all<ArtifactRow>(),

    loadCandidateConceptEvidence(db, candidateId),
  ]);

  const spanIds = new Set<string>();
  for (const sym of symbolRows.results) spanIds.add(sym.defining_span_id);
  for (const fact of factRows.results) spanIds.add(fact.source_span_id);
  for (const demand of parsed.demands) {
    for (const spanId of demand.sourceSpanIds) spanIds.add(spanId);
  }

  const spanMap = new Map<string, SpanRow>();
  if (spanIds.size > 0) {
    const spanIdList = [...spanIds];
    const batchSize = 50;
    for (let i = 0; i < spanIdList.length; i += batchSize) {
      const batch = spanIdList.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const rows = await db.prepare(
        `SELECT id, path, line_start, line_end, artifact_version_id
         FROM repo_source_spans
         WHERE id IN (${placeholders})`,
      ).bind(...batch).all<SpanRow>();
      for (const row of rows.results) {
        spanMap.set(row.id, row);
      }
    }
  }

  const candidateConceptMap = new Map<string, CandidateEvidenceRow>();
  for (const row of candidateEvidence) {
    candidateConceptMap.set(row.concept_key, row);
  }

  const demandSymbolIndex = new Map<string, Set<string>>();
  const demandFileIndex = new Map<string, Set<string>>();
  for (const demand of parsed.demands) {
    const symSet = new Set<string>();
    const fileSet = new Set<string>();
    for (const symId of demand.changedSymbolIds) symSet.add(symId);
    for (const spanId of demand.sourceSpanIds) {
      const span = spanMap.get(spanId);
      if (span?.path) fileSet.add(span.path);
    }
    demandSymbolIndex.set(demand.id, symSet);
    demandFileIndex.set(demand.id, fileSet);
  }

  const symbolSpanMap = new Map<string, SpanRow>();
  for (const sym of symbolRows.results) {
    const span = spanMap.get(sym.defining_span_id);
    if (span) symbolSpanMap.set(sym.id, span);
  }

  const files = buildFileNodes(
    artifactRows.results,
    symbolRows.results,
    symbolSpanMap,
    parsed.demands,
    demandFileIndex,
    candidateConceptMap,
  );

  const symbols = buildSymbolNodes(
    symbolRows.results,
    symbolSpanMap,
    parsed.demands,
    demandSymbolIndex,
    candidateConceptMap,
  );

  const demands = buildDemandNodes(
    parsed.demands,
    demandFileIndex,
    demandSymbolIndex,
    candidateConceptMap,
  );

  const structuralFacts = buildFactNodes(factRows.results, spanMap);

  const candidateEvidenceOverlay = buildEvidenceOverlay(candidateEvidence);

  const coverageSummary = computeCoverageSummary(demands);

  return {
    packetId,
    repoSnapshotId: snapshotId,
    repoName: repoRow?.full_name ?? `repo-${packetRow.repo_id}`,
    prNumber: packetRow.pr_number,
    prTitle: parsed.pullRequest?.title ?? '',
    primaryLanguage: parsed.languageSupport?.language ?? '',
    files,
    symbols,
    demands,
    structuralFacts,
    candidateEvidenceOverlay,
    coverageSummary,
  };
}

async function loadCandidateConceptEvidence(
  db: D1Database,
  candidateId: string,
): Promise<CandidateEvidenceRow[]> {
  const result = await db.prepare(
    `SELECT
       c.canonical_key as concept_key,
       COUNT(*) as evidence_count,
       COALESCE(SUM(cc.weight), 0) as total_strength,
       GROUP_CONCAT(DISTINCT cr.record_type) as source_types
     FROM context_record_concepts cc
     JOIN concepts c ON c.id = cc.concept_id
     JOIN context_records cr ON cr.id = cc.context_record_id
     WHERE cr.scope_type = 'candidate' AND cr.scope_id = ?
     GROUP BY c.canonical_key`,
  ).bind(candidateId).all<CandidateEvidenceRow>();
  return result.results;
}

function computeDemandAlignmentScore(
  demand: { conceptKeys: string[] },
  candidateConceptMap: Map<string, CandidateEvidenceRow>,
): number | null {
  if (demand.conceptKeys.length === 0) return null;
  let matched = 0;
  let totalWeight = 0;
  for (const key of demand.conceptKeys) {
    const evidence = candidateConceptMap.get(key);
    if (evidence) {
      matched += Math.min(evidence.total_strength, 1);
    }
    totalWeight += 1;
  }
  return totalWeight > 0 ? matched / totalWeight : null;
}

function buildFileNodes(
  artifacts: ArtifactRow[],
  symbols: SymbolRow[],
  symbolSpanMap: Map<string, SpanRow>,
  demands: ParsedPacket['demands'],
  demandFileIndex: Map<string, Set<string>>,
  candidateConceptMap: Map<string, CandidateEvidenceRow>,
): RepoFileNode[] {
  const fileSymbolCounts = new Map<string, number>();
  for (const sym of symbols) {
    const span = symbolSpanMap.get(sym.id);
    if (span?.path) {
      fileSymbolCounts.set(span.path, (fileSymbolCounts.get(span.path) ?? 0) + 1);
    }
  }

  const fileDemandCounts = new Map<string, number>();
  const fileDemandConcepts = new Map<string, string[]>();
  for (const demand of demands) {
    const files = demandFileIndex.get(demand.id);
    if (!files) continue;
    for (const filePath of files) {
      fileDemandCounts.set(filePath, (fileDemandCounts.get(filePath) ?? 0) + 1);
      const existing = fileDemandConcepts.get(filePath) ?? [];
      existing.push(...demand.conceptKeys);
      fileDemandConcepts.set(filePath, existing);
    }
  }

  const nodes: RepoFileNode[] = [];
  const seenPaths = new Set<string>();

  for (const artifact of artifacts) {
    const path = artifact.path;
    if (!path || seenPaths.has(path)) continue;
    seenPaths.add(path);

    const concepts = fileDemandConcepts.get(path) ?? [];
    const alignmentScore = concepts.length > 0
      ? computeDemandAlignmentScore({ conceptKeys: concepts }, candidateConceptMap)
      : null;

    nodes.push({
      path,
      language: inferLanguage(path),
      artifactType: artifact.artifact_type,
      lineCount: null,
      symbolCount: fileSymbolCounts.get(path) ?? 0,
      demandCount: fileDemandCounts.get(path) ?? 0,
      candidateAlignmentScore: alignmentScore,
    });
  }

  return nodes.sort((a, b) => (b.demandCount - a.demandCount) || a.path.localeCompare(b.path));
}

function buildSymbolNodes(
  symbols: SymbolRow[],
  symbolSpanMap: Map<string, SpanRow>,
  demands: ParsedPacket['demands'],
  demandSymbolIndex: Map<string, Set<string>>,
  candidateConceptMap: Map<string, CandidateEvidenceRow>,
): RepoSymbolNode[] {
  const symbolDemandIds = new Map<string, string[]>();
  for (const demand of demands) {
    const syms = demandSymbolIndex.get(demand.id);
    if (!syms) continue;
    for (const symId of syms) {
      const existing = symbolDemandIds.get(symId) ?? [];
      existing.push(demand.id);
      symbolDemandIds.set(symId, existing);
    }
  }

  return symbols.map((sym) => {
    const span = symbolSpanMap.get(sym.id);
    const demandIds = symbolDemandIds.get(sym.id) ?? [];
    const relatedConcepts: string[] = [];
    for (const demand of demands) {
      if (demandIds.includes(demand.id)) {
        relatedConcepts.push(...demand.conceptKeys);
      }
    }
    const alignmentScore = relatedConcepts.length > 0
      ? computeDemandAlignmentScore({ conceptKeys: relatedConcepts }, candidateConceptMap)
      : null;

    return {
      id: sym.id,
      qualifiedName: sym.qualified_name,
      kind: sym.symbol_kind,
      language: sym.language,
      signature: sym.signature,
      filePath: span?.path ?? null,
      lineStart: span?.line_start ?? null,
      lineEnd: span?.line_end ?? null,
      containingSymbolId: sym.containing_symbol_id,
      demandIds,
      candidateAlignmentScore: alignmentScore,
    };
  });
}

function buildDemandNodes(
  demands: ParsedPacket['demands'],
  demandFileIndex: Map<string, Set<string>>,
  demandSymbolIndex: Map<string, Set<string>>,
  candidateConceptMap: Map<string, CandidateEvidenceRow>,
): RepoDemandNode[] {
  return demands.map((demand) => {
    const files = demandFileIndex.get(demand.id);
    const syms = demandSymbolIndex.get(demand.id);
    const alignmentScore = computeDemandAlignmentScore(demand, candidateConceptMap);
    let evidenceCount = 0;
    for (const key of demand.conceptKeys) {
      const evidence = candidateConceptMap.get(key);
      if (evidence) evidenceCount += evidence.evidence_count;
    }

    return {
      id: demand.id,
      family: demand.family,
      narrative: demand.narrative,
      conceptKeys: demand.conceptKeys,
      weight: demand.weight,
      sourceFilePaths: files ? [...files] : [],
      symbolIds: syms ? [...syms] : [],
      candidateAlignmentScore: alignmentScore,
      candidateEvidenceCount: evidenceCount,
    };
  });
}

function buildFactNodes(
  facts: FactRow[],
  spanMap: Map<string, SpanRow>,
): RepoStructuralFactNode[] {
  return facts.map((fact) => {
    const span = spanMap.get(fact.source_span_id);
    return {
      id: fact.id,
      factType: fact.fact_type,
      subjectSymbolId: fact.subject_symbol_id,
      objectSymbolId: fact.object_symbol_id,
      sourceFilePath: span?.path ?? null,
    };
  });
}

function buildEvidenceOverlay(
  evidence: CandidateEvidenceRow[],
): CandidateEvidenceOverlay[] {
  return evidence.map((row) => ({
    conceptKey: row.concept_key,
    evidenceCount: row.evidence_count,
    totalStrength: row.total_strength,
    sourceTypes: row.source_types ? row.source_types.split(',') : [],
  }));
}

function computeCoverageSummary(demands: RepoDemandNode[]): RepoDecompositionOverlay['coverageSummary'] {
  let coveredDemands = 0;
  let partialDemands = 0;
  let uncoveredDemands = 0;
  let totalScore = 0;

  for (const demand of demands) {
    const score = demand.candidateAlignmentScore;
    if (score === null || score === 0) {
      uncoveredDemands++;
    } else if (score >= 0.6) {
      coveredDemands++;
      totalScore += score;
    } else {
      partialDemands++;
      totalScore += score;
    }
  }

  return {
    totalDemands: demands.length,
    coveredDemands,
    partialDemands,
    uncoveredDemands,
    overallScore: demands.length > 0 ? totalScore / demands.length : 0,
  };
}

function inferLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
    py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', rb: 'Ruby',
    cs: 'C#', cpp: 'C++', c: 'C', swift: 'Swift', kt: 'Kotlin',
    php: 'PHP', scala: 'Scala', hs: 'Haskell', sql: 'SQL',
    html: 'HTML', css: 'CSS', scss: 'SCSS', json: 'JSON',
    md: 'Markdown', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  };
  return map[ext] ?? null;
}
