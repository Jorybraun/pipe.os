export const REPO_SEMANTIC_GRAPH_SCHEMA_VERSION = '1.0.0' as const;

export type IsoDateTime = string;
export type Sha256 = `sha256:${string}`;

export type RepositoryProvider = 'github' | 'gitlab' | 'bitbucket' | 'other';

export interface RepositoryRef {
  provider: RepositoryProvider;
  owner: string;
  name: string;
  canonicalUrl: string;
}

export interface RepoSnapshot {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  id: string;
  repository: RepositoryRef;
  commitSha: string;
  defaultBranch: string;
  observedAt: IsoDateTime;
  treeHash?: string;
  parentCommitShas: string[];
  contentHash: Sha256;
}

export type SourceArtifactKind =
  | 'source'
  | 'test'
  | 'manifest'
  | 'documentation'
  | 'ci'
  | 'issue'
  | 'pull_request'
  | 'patch'
  | 'commit_metadata'
  | 'other';

export interface SourceArtifact {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  id: string;
  repoSnapshotId: string;
  kind: SourceArtifactKind;
  path?: string;
  externalRef?: string;
  language?: string;
  mediaType: string;
  contentHash: Sha256;
}

export interface SourceArtifactVersion {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  id: string;
  artifactId: string;
  repoSnapshotId: string;
  contentHash: Sha256;
  content: string;
  encoding: 'utf-8';
  byteLength: number;
  createdAt: IsoDateTime;
}

export interface SourcePosition {
  byteOffset: number;
  line: number;
  column: number;
}

export interface SourceSpan {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  id: string;
  repoSnapshotId: string;
  artifactId: string;
  artifactVersionId: string;
  contentHash: Sha256;
  start: SourcePosition;
  end: SourcePosition;
  exactText: string;
  exactTextHash: Sha256;
  displayLabel?: string;
  prSide?: 'base' | 'head' | 'metadata';
}

export type SymbolKind =
  | 'module'
  | 'namespace'
  | 'class'
  | 'interface'
  | 'type'
  | 'function'
  | 'method'
  | 'constructor'
  | 'property'
  | 'variable'
  | 'constant'
  | 'route'
  | 'test'
  | 'other';

export interface RepoSymbol {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  id: string;
  repoSnapshotId: string;
  language: string;
  qualifiedName: string;
  name: string;
  kind: SymbolKind;
  signature?: string;
  containingSymbolId?: string;
  definingSpanId: string;
  exported: boolean;
  modifiers: string[];
  contentHash: Sha256;
}

export type StructuralFactKind =
  | 'imports'
  | 'calls'
  | 'reads'
  | 'writes'
  | 'routes_to'
  | 'tests'
  | 'inherits'
  | 'implements'
  | 'contains'
  | 'changed_symbol'
  | 'other';

export interface StructuralFactEndpoint {
  symbolId?: string;
  concept?: string;
  literal?: string;
}

export interface StructuralFact {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  id: string;
  repoSnapshotId: string;
  kind: StructuralFactKind;
  subject: StructuralFactEndpoint;
  object: StructuralFactEndpoint;
  sourceSpanIds: string[];
  confidence: number;
  parser: string;
  contentHash: Sha256;
}

export interface CodeEpisode {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  id: string;
  repoSnapshotId: string;
  title: string;
  narrative: string;
  symbolIds: string[];
  structuralFactIds: string[];
  sourceSpanIds: string[];
  conceptKeys: string[];
  contentHash: Sha256;
}

/** Open facet namespace persisted as data rather than a code-owned ontology. */
export type FacetKind = string;

export interface Facet {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  id: string;
  repoSnapshotId: string;
  kind: FacetKind;
  key: string;
  label: string;
  aliases: string[];
  sourceSpanIds: string[];
  confidence: number;
  contentHash: Sha256;
}

export interface SemanticAssertion {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  id: string;
  repoSnapshotId: string;
  episodeId?: string;
  subject: string;
  predicate: string;
  object: string;
  narrative: string;
  qualifiers: Record<string, string | number | boolean>;
  facetIds: string[];
  conceptKeys: string[];
  sourceSpanIds: string[];
  confidence: number;
  extractor: string;
  contentHash: Sha256;
}

export interface RepoSignal {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  id: string;
  repoSnapshotId: string;
  key: string;
  narrative: string;
  assertionIds: string[];
  facetIds: string[];
  sourceSpanIds: string[];
  confidence: number;
  evidenceCount: number;
  sourceDiversity: number;
  contentHash: Sha256;
}

export type LanguageSupportLevel = 'production' | 'structural_only' | 'unsupported';

export interface LanguageSupportDecision {
  language: string;
  normalizedLanguage: string;
  level: LanguageSupportLevel;
  parser: string | null;
  challengePacketsAllowed: boolean;
  reason: string;
}

export type PullRequestFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface NormalizedPullRequestHunk {
  header: string;
  patch: string;
  sourceSpan: SourceSpan;
  changedSymbolIds: string[];
}

export interface NormalizedPullRequestFile {
  path: string;
  previousPath?: string;
  status: PullRequestFileStatus;
  language: string;
  additions: number;
  deletions: number;
  artifact: SourceArtifact;
  artifactVersion: SourceArtifactVersion;
  hunks: NormalizedPullRequestHunk[];
  symbols: RepoSymbol[];
}

export interface NormalizedTestChange {
  path: string;
  framework?: string;
  sourceSpanIds: string[];
  relatedSymbolIds: string[];
}

export interface NormalizedIssueMetadata {
  number: number;
  title: string;
  body?: string;
  labels: string[];
  sourceSpanIds: string[];
}

export interface ExtractionDiagnostic {
  kind: 'full_source_fetch' | 'semantic_parser';
  path: string;
  language: string;
  reason: string;
}

export interface NormalizedPullRequestInput {
  repoSnapshot: RepoSnapshot;
  number: number;
  url: string;
  title: string;
  body?: string;
  author: string;
  primaryLanguage: string;
  baseSha: string;
  headSha: string;
  mergedAt: IsoDateTime | null;
  metadataSourceSpanIds: string[];
  sourceArtifacts?: SourceArtifact[];
  sourceArtifactVersions?: SourceArtifactVersion[];
  sourceSpans: SourceSpan[];
  changedFiles: NormalizedPullRequestFile[];
  tests: NormalizedTestChange[];
  issue?: NormalizedIssueMetadata;
  structuralFacts?: StructuralFact[];
  extractionDiagnostics?: ExtractionDiagnostic[];
}

/** Open, source-derived demand family. */
export type ChallengeDemandFamily = string;

export interface ChallengeDemand {
  id: string;
  family: ChallengeDemandFamily;
  narrative: string;
  conceptKeys: string[];
  problems?: string[];
  mechanisms?: string[];
  domains?: string[];
  businessObjects?: string[];
  ownershipActions?: string[];
  sourceSpanIds: string[];
  changedSymbolIds: string[];
  weight: number;
  contentHash: Sha256;
}

export interface ChallengeQualityMetrics {
  provenanceCoverage: number;
  reviewableSize: number;
  testCoverage: number;
  issueContext: number;
  demandDiversity: number;
}

export type ChallengeQualityGate =
  | 'production_language'
  | 'merged_pull_request'
  | 'reviewable_file_count'
  | 'reviewable_change_size'
  | 'contains_code_change'
  | 'contains_source_hunk'
  | 'contains_tests'
  | 'demand_diversity'
  | 'complete_provenance'
  | 'minimum_quality';

export interface ChallengeGateResult {
  gate: ChallengeQualityGate;
  passed: boolean;
  reason: string;
}

export interface ChallengeQuality {
  score: number;
  metrics: ChallengeQualityMetrics;
  gates: ChallengeGateResult[];
  eligible: boolean;
}

export interface ChallengePacket {
  schemaVersion: typeof REPO_SEMANTIC_GRAPH_SCHEMA_VERSION;
  policyVersion: 'repo-challenge-v1';
  id: string;
  repoSnapshotId: string;
  repository: RepositoryRef;
  pullRequest: {
    number: number;
    url: string;
    title: string;
    body?: string;
    author: string;
    baseSha: string;
    headSha: string;
    mergedAt: IsoDateTime | null;
  };
  languageSupport: LanguageSupportDecision;
  changedFilePaths: string[];
  changedSymbolIds: string[];
  sourceSpanIds: string[];
  testChanges: NormalizedTestChange[];
  issue?: NormalizedIssueMetadata;
  demands: ChallengeDemand[];
  demandFamilies: ChallengeDemandFamily[];
  quality: ChallengeQuality;
  contentHash: Sha256;
}
