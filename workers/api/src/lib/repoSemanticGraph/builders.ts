import { hashObject, sha256, stableId } from './hash';
import {
  REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
  type CodeEpisode,
  type Facet,
  type FacetKind,
  type RepoSignal,
  type RepoSnapshot,
  type RepositoryRef,
  type SemanticAssertion,
  type SourceArtifact,
  type SourceArtifactKind,
  type SourceArtifactVersion,
  type SourcePosition,
  type SourceSpan,
  type StructuralFact,
  type StructuralFactEndpoint,
  type StructuralFactKind,
  type SymbolKind,
  type RepoSymbol,
} from './model';

function requireText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must not be empty`);
  return normalized;
}

function requireConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('confidence must be between 0 and 1');
  }
  return value;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeRepository(repository: RepositoryRef): RepositoryRef {
  return {
    provider: repository.provider,
    owner: requireText(repository.owner, 'repository.owner'),
    name: requireText(repository.name, 'repository.name'),
    canonicalUrl: requireText(repository.canonicalUrl, 'repository.canonicalUrl'),
  };
}

export async function buildRepoSnapshot(input: {
  repository: RepositoryRef;
  commitSha: string;
  defaultBranch: string;
  observedAt: string;
  treeHash?: string;
  parentCommitShas?: string[];
}): Promise<RepoSnapshot> {
  const identity = {
    repository: normalizeRepository(input.repository),
    commitSha: requireText(input.commitSha, 'commitSha').toLowerCase(),
  };
  const content = {
    ...identity,
    defaultBranch: requireText(input.defaultBranch, 'defaultBranch'),
    treeHash: input.treeHash?.trim() || undefined,
    parentCommitShas: sortedUnique(input.parentCommitShas ?? []).map((sha) => sha.toLowerCase()),
  };
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('snapshot', identity),
    ...content,
    observedAt: requireText(input.observedAt, 'observedAt'),
    contentHash: await hashObject(content),
  };
}

export async function buildSourceArtifact(input: {
  repoSnapshotId: string;
  kind: SourceArtifactKind;
  path?: string;
  externalRef?: string;
  language?: string;
  mediaType?: string;
}): Promise<SourceArtifact> {
  const identity = {
    repoSnapshotId: requireText(input.repoSnapshotId, 'repoSnapshotId'),
    kind: input.kind,
    path: input.path?.trim() || undefined,
    externalRef: input.externalRef?.trim() || undefined,
  };
  if (!identity.path && !identity.externalRef) {
    throw new TypeError('source artifact requires path or externalRef');
  }
  const content = {
    ...identity,
    language: input.language?.trim().toLowerCase() || undefined,
    mediaType: input.mediaType?.trim() || 'text/plain',
  };
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('artifact', identity),
    ...content,
    contentHash: await hashObject(content),
  };
}

export async function buildSourceArtifactVersion(input: {
  artifactId: string;
  repoSnapshotId: string;
  content: string;
  createdAt: string;
}): Promise<SourceArtifactVersion> {
  const contentHash = await sha256(input.content);
  const identity = {
    artifactId: requireText(input.artifactId, 'artifactId'),
    repoSnapshotId: requireText(input.repoSnapshotId, 'repoSnapshotId'),
    contentHash,
  };
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('artifact_version', identity),
    ...identity,
    content: input.content,
    encoding: 'utf-8',
    byteLength: new TextEncoder().encode(input.content).byteLength,
    createdAt: requireText(input.createdAt, 'createdAt'),
  };
}

function validatePosition(position: SourcePosition, name: string): SourcePosition {
  if (
    !Number.isInteger(position.byteOffset) ||
    !Number.isInteger(position.line) ||
    !Number.isInteger(position.column) ||
    position.byteOffset < 0 ||
    position.line < 1 ||
    position.column < 1
  ) {
    throw new RangeError(`${name} is invalid`);
  }
  return { ...position };
}

export async function buildSourceSpan(input: {
  repoSnapshotId: string;
  artifactId: string;
  artifactVersionId: string;
  contentHash: SourceArtifactVersion['contentHash'];
  start: SourcePosition;
  end: SourcePosition;
  exactText: string;
  displayLabel?: string;
  prSide?: SourceSpan['prSide'];
}): Promise<SourceSpan> {
  const start = validatePosition(input.start, 'start');
  const end = validatePosition(input.end, 'end');
  if (end.byteOffset < start.byteOffset || end.line < start.line) {
    throw new RangeError('source span end must not precede start');
  }
  const exactTextHash = await sha256(input.exactText);
  const identity = {
    repoSnapshotId: requireText(input.repoSnapshotId, 'repoSnapshotId'),
    artifactId: requireText(input.artifactId, 'artifactId'),
    artifactVersionId: requireText(input.artifactVersionId, 'artifactVersionId'),
    contentHash: input.contentHash,
    start,
    end,
    exactTextHash,
    prSide: input.prSide,
  };
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('span', identity),
    ...identity,
    exactText: input.exactText,
    displayLabel: input.displayLabel?.trim() || undefined,
  };
}

export async function buildSymbol(input: {
  repoSnapshotId: string;
  language: string;
  qualifiedName: string;
  name: string;
  kind: SymbolKind;
  signature?: string;
  containingSymbolId?: string;
  definingSpanId: string;
  exported?: boolean;
  modifiers?: string[];
}): Promise<RepoSymbol> {
  const identity = {
    repoSnapshotId: requireText(input.repoSnapshotId, 'repoSnapshotId'),
    language: requireText(input.language, 'language').toLowerCase(),
    qualifiedName: requireText(input.qualifiedName, 'qualifiedName'),
    kind: input.kind,
  };
  const content = {
    ...identity,
    name: requireText(input.name, 'name'),
    signature: input.signature?.trim() || undefined,
    containingSymbolId: input.containingSymbolId?.trim() || undefined,
    definingSpanId: requireText(input.definingSpanId, 'definingSpanId'),
    exported: input.exported ?? false,
    modifiers: sortedUnique(input.modifiers ?? []),
  };
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('symbol', identity),
    ...content,
    contentHash: await hashObject(content),
  };
}

function normalizeEndpoint(endpoint: StructuralFactEndpoint): StructuralFactEndpoint {
  const normalized = {
    symbolId: endpoint.symbolId?.trim() || undefined,
    concept: endpoint.concept?.trim().toLowerCase() || undefined,
    literal: endpoint.literal?.trim() || undefined,
  };
  if (!normalized.symbolId && !normalized.concept && !normalized.literal) {
    throw new TypeError('structural fact endpoint must identify a symbol, concept, or literal');
  }
  return normalized;
}

export async function buildStructuralFact(input: {
  repoSnapshotId: string;
  kind: StructuralFactKind;
  subject: StructuralFactEndpoint;
  object: StructuralFactEndpoint;
  sourceSpanIds: string[];
  confidence: number;
  parser: string;
}): Promise<StructuralFact> {
  const content = {
    repoSnapshotId: requireText(input.repoSnapshotId, 'repoSnapshotId'),
    kind: input.kind,
    subject: normalizeEndpoint(input.subject),
    object: normalizeEndpoint(input.object),
    sourceSpanIds: sortedUnique(input.sourceSpanIds),
    confidence: requireConfidence(input.confidence),
    parser: requireText(input.parser, 'parser'),
  };
  if (content.sourceSpanIds.length === 0) throw new TypeError('structural fact requires provenance');
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('fact', content),
    ...content,
    contentHash: await hashObject(content),
  };
}

export async function buildCodeEpisode(input: {
  repoSnapshotId: string;
  title: string;
  narrative: string;
  symbolIds?: string[];
  structuralFactIds?: string[];
  sourceSpanIds: string[];
  conceptKeys?: string[];
}): Promise<CodeEpisode> {
  const content = {
    repoSnapshotId: requireText(input.repoSnapshotId, 'repoSnapshotId'),
    title: requireText(input.title, 'title'),
    narrative: requireText(input.narrative, 'narrative'),
    symbolIds: sortedUnique(input.symbolIds ?? []),
    structuralFactIds: sortedUnique(input.structuralFactIds ?? []),
    sourceSpanIds: sortedUnique(input.sourceSpanIds),
    conceptKeys: sortedUnique(input.conceptKeys ?? []).map((key) => key.toLowerCase()),
  };
  if (content.sourceSpanIds.length === 0) throw new TypeError('code episode requires provenance');
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('episode', content),
    ...content,
    contentHash: await hashObject(content),
  };
}

export async function buildFacet(input: {
  repoSnapshotId: string;
  kind: FacetKind;
  key: string;
  label: string;
  aliases?: string[];
  sourceSpanIds: string[];
  confidence: number;
}): Promise<Facet> {
  const repoSnapshotId = requireText(input.repoSnapshotId, 'repoSnapshotId');
  const identity = {
    kind: input.kind,
    key: requireText(input.key, 'key').toLowerCase(),
  };
  const content = {
    ...identity,
    label: requireText(input.label, 'label'),
    aliases: sortedUnique(input.aliases ?? []).map((alias) => alias.toLowerCase()),
    sourceSpanIds: sortedUnique(input.sourceSpanIds),
    confidence: requireConfidence(input.confidence),
  };
  if (content.sourceSpanIds.length === 0) throw new TypeError('facet requires provenance');
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('facet', identity),
    repoSnapshotId,
    ...content,
    contentHash: await hashObject(content),
  };
}

export async function buildSemanticAssertion(input: {
  repoSnapshotId: string;
  episodeId?: string;
  subject: string;
  predicate: string;
  object: string;
  narrative: string;
  qualifiers?: Record<string, string | number | boolean>;
  facetIds?: string[];
  conceptKeys?: string[];
  sourceSpanIds: string[];
  confidence: number;
  extractor: string;
}): Promise<SemanticAssertion> {
  const content = {
    repoSnapshotId: requireText(input.repoSnapshotId, 'repoSnapshotId'),
    episodeId: input.episodeId?.trim() || undefined,
    subject: requireText(input.subject, 'subject'),
    predicate: requireText(input.predicate, 'predicate'),
    object: requireText(input.object, 'object'),
    narrative: requireText(input.narrative, 'narrative'),
    qualifiers: input.qualifiers ?? {},
    facetIds: sortedUnique(input.facetIds ?? []),
    conceptKeys: sortedUnique(input.conceptKeys ?? []).map((key) => key.toLowerCase()),
    sourceSpanIds: sortedUnique(input.sourceSpanIds),
    confidence: requireConfidence(input.confidence),
    extractor: requireText(input.extractor, 'extractor'),
  };
  if (content.sourceSpanIds.length === 0) throw new TypeError('semantic assertion requires provenance');
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('assertion', content),
    ...content,
    contentHash: await hashObject(content),
  };
}

export async function buildRepoSignal(input: {
  repoSnapshotId: string;
  key: string;
  narrative: string;
  assertionIds: string[];
  facetIds?: string[];
  sourceSpanIds: string[];
  confidence: number;
  sourceDiversity: number;
}): Promise<RepoSignal> {
  if (!Number.isInteger(input.sourceDiversity) || input.sourceDiversity < 1) {
    throw new RangeError('sourceDiversity must be a positive integer');
  }
  const content = {
    repoSnapshotId: requireText(input.repoSnapshotId, 'repoSnapshotId'),
    key: requireText(input.key, 'key').toLowerCase(),
    narrative: requireText(input.narrative, 'narrative'),
    assertionIds: sortedUnique(input.assertionIds),
    facetIds: sortedUnique(input.facetIds ?? []),
    sourceSpanIds: sortedUnique(input.sourceSpanIds),
    confidence: requireConfidence(input.confidence),
    evidenceCount: sortedUnique(input.assertionIds).length,
    sourceDiversity: input.sourceDiversity,
  };
  if (content.assertionIds.length === 0 || content.sourceSpanIds.length === 0) {
    throw new TypeError('repo signal requires assertions and provenance');
  }
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('repo_signal', content),
    ...content,
    contentHash: await hashObject(content),
  };
}
