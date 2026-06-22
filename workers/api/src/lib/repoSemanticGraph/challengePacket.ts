import { hashObject, sha256, stableId } from './hash';
import { getLanguageSupport, normalizeLanguage } from './languagePolicy';
import { openSemanticTerm } from '../livingContext/openTerms';
import {
  REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
  type ChallengeDemand,
  type ChallengeDemandFamily,
  type ChallengeGateResult,
  type ChallengePacket,
  type ChallengeQuality,
  type ChallengeQualityMetrics,
  type ExtractionDiagnostic,
  type NormalizedPullRequestFile,
  type NormalizedPullRequestInput,
  type SourceSpan,
} from './model';

const MIN_CHANGED_FILES = 3;
const MAX_CHANGED_FILES = 50;
const MIN_CHANGED_LINES = 20;
const MAX_CHANGED_LINES = 1_500;
const MIN_QUALITY_SCORE = 0.7;

const TEST_PATH = /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/i;
const NON_CODE_ARTIFACTS = new Set(['documentation', 'manifest', 'ci', 'issue', 'pull_request', 'commit_metadata']);

export class ProvenanceValidationError extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super(`Challenge packet provenance is invalid: ${failures.join('; ')}`);
    this.name = 'ProvenanceValidationError';
    this.failures = failures;
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function sortedOpenTerms(values: readonly (string | undefined)[]): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    if (!value?.trim()) continue;
    const term = openSemanticTerm(value);
    if (term) terms.add(term.canonicalKey);
  }
  return [...terms].sort();
}

function sourceIdentifierSurfaces(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const surfaces = new Set<string>([value]);
  const rawParts = value
    .split(/[^A-Za-z0-9+#.]+|\.(?=[A-Za-z])/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
  for (const part of rawParts) {
    surfaces.add(part);
    const phrase = part.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    surfaces.add(phrase);
    for (const component of phrase.split(/\s+/)) {
      if (component.length >= 3) surfaces.add(component);
    }
  }
  return [...surfaces];
}

function roundScore(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function spanMap(input: NormalizedPullRequestInput): Map<string, SourceSpan> {
  return new Map(input.sourceSpans.map((span) => [span.id, span]));
}

function artifactVersionContent(input: NormalizedPullRequestInput): Map<string, string> {
  return new Map([
    ...input.changedFiles.map((file) => [
      file.artifactVersion.id,
      file.artifactVersion.content,
    ] as const),
    ...(input.sourceArtifactVersions ?? []).map((version) => [
      version.id,
      version.content,
    ] as const),
  ]);
}

export async function validateChallengeProvenance(input: NormalizedPullRequestInput): Promise<void> {
  const failures: string[] = [];
  const spans = spanMap(input);
  const versionContent = artifactVersionContent(input);
  const artifactIds = new Set(input.changedFiles.map((file) => file.artifact.id));
  const referencedSpanIds = new Set<string>(input.metadataSourceSpanIds);

  if (spans.size !== input.sourceSpans.length) {
    failures.push('source span IDs are not unique');
  }
  if (input.metadataSourceSpanIds.length === 0) {
    failures.push('PR metadata has no source span');
  }

  for (const artifact of input.sourceArtifacts ?? []) {
    artifactIds.add(artifact.id);
    if (artifact.repoSnapshotId !== input.repoSnapshot.id) {
      failures.push(`source artifact ${artifact.id} belongs to another repo snapshot`);
    }
  }

  for (const version of input.sourceArtifactVersions ?? []) {
    if (version.repoSnapshotId !== input.repoSnapshot.id) {
      failures.push(`source artifact version ${version.id} belongs to another repo snapshot`);
    }
    if (!artifactIds.has(version.artifactId)) {
      failures.push(`source artifact version ${version.id} references an unknown artifact`);
    }
    if (await sha256(version.content) !== version.contentHash) {
      failures.push(`source artifact version ${version.id} content hash is invalid`);
    }
  }

  for (const span of input.sourceSpans) {
    if (span.repoSnapshotId !== input.repoSnapshot.id) {
      failures.push(`span ${span.id} belongs to another repo snapshot`);
    }
    if (!span.exactText || !span.exactTextHash || !span.contentHash) {
      failures.push(`span ${span.id} does not preserve exact source content`);
    }
    if (await sha256(span.exactText) !== span.exactTextHash) {
      failures.push(`span ${span.id} exact text hash is invalid`);
    }
    const content = versionContent.get(span.artifactVersionId);
    if (!content) {
      failures.push(`span ${span.id} references an unknown artifact version`);
    } else {
      const encodedContent = new TextEncoder().encode(content);
      const sourceSlice = new TextDecoder().decode(
        encodedContent.slice(span.start.byteOffset, span.end.byteOffset),
      );
      if (sourceSlice !== span.exactText) {
        failures.push(`span ${span.id} offsets do not resolve to its exact text`);
      }
    }
  }

  for (const file of input.changedFiles) {
    if (file.artifact.repoSnapshotId !== input.repoSnapshot.id) {
      failures.push(`artifact ${file.artifact.id} belongs to another repo snapshot`);
    }
    if (
      file.artifactVersion.artifactId !== file.artifact.id ||
      file.artifactVersion.repoSnapshotId !== input.repoSnapshot.id
    ) {
      failures.push(`artifact version ${file.artifactVersion.id} is not attached to ${file.artifact.id}`);
    }
    if (await sha256(file.artifactVersion.content) !== file.artifactVersion.contentHash) {
      failures.push(`artifact version ${file.artifactVersion.id} content hash is invalid`);
    }
    for (const hunk of file.hunks) {
      referencedSpanIds.add(hunk.sourceSpan.id);
      if (hunk.sourceSpan.artifactId !== file.artifact.id) {
        failures.push(`hunk span ${hunk.sourceSpan.id} is attached to the wrong artifact`);
      }
      if (hunk.sourceSpan.artifactVersionId !== file.artifactVersion.id) {
        failures.push(`hunk span ${hunk.sourceSpan.id} is attached to the wrong artifact version`);
      }
      if (hunk.sourceSpan.contentHash !== file.artifactVersion.contentHash) {
        failures.push(`hunk span ${hunk.sourceSpan.id} content hash does not match its artifact version`);
      }
      if (hunk.sourceSpan.exactText !== hunk.patch) {
        failures.push(`hunk span ${hunk.sourceSpan.id} exact text does not match its normalized patch`);
      }
    }
    for (const symbol of file.symbols) {
      referencedSpanIds.add(symbol.definingSpanId);
      if (symbol.repoSnapshotId !== input.repoSnapshot.id) {
        failures.push(`symbol ${symbol.id} belongs to another repo snapshot`);
      }
    }
  }

  for (const test of input.tests) {
    test.sourceSpanIds.forEach((id) => referencedSpanIds.add(id));
  }
  input.issue?.sourceSpanIds.forEach((id) => referencedSpanIds.add(id));

  for (const spanId of referencedSpanIds) {
    if (!spans.has(spanId)) failures.push(`referenced source span ${spanId} is missing`);
  }

  if (failures.length > 0) throw new ProvenanceValidationError(sortedUnique(failures));
}

function fileSearchText(file: NormalizedPullRequestFile): string {
  return [
    file.path,
    file.previousPath ?? '',
    file.language,
    ...file.hunks.flatMap((hunk) => [hunk.header, hunk.patch]),
    ...file.symbols.flatMap((symbol) => [symbol.name, symbol.qualifiedName, symbol.signature ?? '']),
  ].join('\n');
}

function extractConceptKeys(
  input: NormalizedPullRequestInput,
  family: ChallengeDemandFamily,
  sourceSpanIds: readonly string[],
  changedSymbolIds: readonly string[],
): string[] {
  const concepts = new Set<string>([family]);
  const spanIds = new Set(sourceSpanIds);
  const symbolIds = new Set(changedSymbolIds);
  const symbols = new Map(
    input.changedFiles
      .flatMap((file) => file.symbols)
      .map((symbol) => [symbol.id, symbol] as const),
  );
  const addConcept = (surface: string | undefined): void => {
    if (!surface?.trim()) return;
    const normalized = surface.trim();
    if (/^[a-z][a-z0-9_-]*:[^\s]+$/i.test(normalized)) {
      concepts.add(normalized.toLowerCase());
      return;
    }
    const term = openSemanticTerm(normalized);
    if (term) concepts.add(term.canonicalKey);
  };
  const addSourceIdentifierConcepts = (surface: string | undefined): void => {
    sourceIdentifierSurfaces(surface).forEach(addConcept);
  };

  addConcept(normalizeLanguage(input.primaryLanguage));

  for (const file of input.changedFiles) {
    const relevantHunks = file.hunks.filter((hunk) => spanIds.has(hunk.sourceSpan.id));
    const relevantSymbols = file.symbols.filter((symbol) =>
      symbolIds.has(symbol.id) || spanIds.has(symbol.definingSpanId)
    );
    if (relevantHunks.length === 0 && relevantSymbols.length === 0) continue;
    addConcept(file.language);
    addSourceIdentifierConcepts(file.path);
    addSourceIdentifierConcepts(file.previousPath);
    relevantSymbols.forEach((symbol) => {
      addSourceIdentifierConcepts(symbol.name);
      addSourceIdentifierConcepts(symbol.qualifiedName);
      addSourceIdentifierConcepts(symbol.signature);
    });
  }

  for (const fact of input.structuralFacts ?? []) {
    if (!fact.sourceSpanIds.some((spanId) => spanIds.has(spanId))) continue;
    addSourceIdentifierConcepts(fact.object.concept);
    addSourceIdentifierConcepts(symbols.get(fact.subject.symbolId ?? '')?.name);
    addSourceIdentifierConcepts(symbols.get(fact.object.symbolId ?? '')?.name);
  }

  for (const test of input.tests) {
    if (
      !test.sourceSpanIds.some((spanId) => spanIds.has(spanId))
      && !test.relatedSymbolIds.some((symbolId) => symbolIds.has(symbolId))
    ) {
      continue;
    }
    addSourceIdentifierConcepts(test.path);
    addSourceIdentifierConcepts(test.framework);
    test.relatedSymbolIds.forEach((symbolId) =>
      addSourceIdentifierConcepts(symbols.get(symbolId)?.name)
    );
  }

  if (input.issue?.sourceSpanIds.some((spanId) => spanIds.has(spanId))) {
    input.issue.labels.forEach(addConcept);
  }

  return [...concepts].sort();
}

function conceptLabel(conceptKey: string): string {
  const value = conceptKey.includes(':')
    ? conceptKey.slice(conceptKey.indexOf(':') + 1)
    : conceptKey;
  return value.replace(/[-_]+/g, ' ').trim() || conceptKey;
}

function familyLabel(family: ChallengeDemandFamily): string {
  const [namespace, ...rest] = family.split(':');
  const detail = rest.join(':');
  if (!detail) return conceptLabel(namespace ?? family);
  return `${conceptLabel(detail)} ${conceptLabel(namespace ?? 'demand')}`.trim();
}

function firstEvidenceLine(span: SourceSpan): string {
  const line = span.exactText
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith('@@'));
  const normalized = (line ?? span.exactText.trim()).replace(/\s+/g, ' ');
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function demandEvidenceSummary(
  input: NormalizedPullRequestInput,
  sourceSpanIds: readonly string[],
): string {
  const spans = spanMap(input);
  return sourceSpanIds
    .map((id) => spans.get(id))
    .filter((span): span is SourceSpan => Boolean(span))
    .sort((a, b) => (a.displayLabel ?? a.id).localeCompare(b.displayLabel ?? b.id))
    .slice(0, 3)
    .map((span) => `${span.displayLabel ?? span.id}: ${firstEvidenceLine(span)}`)
    .join(' | ');
}

function pathParts(path: string): string[] {
  return path
    .split(/[/.\\_-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function extractDemandDimensions(
  input: NormalizedPullRequestInput,
  family: ChallengeDemandFamily,
  sourceSpanIds: readonly string[],
  changedSymbolIds: readonly string[],
): Pick<
  ChallengeDemand,
  'problems' | 'mechanisms' | 'domains' | 'businessObjects' | 'ownershipActions'
> {
  const spanIds = new Set(sourceSpanIds);
  const symbolIds = new Set(changedSymbolIds);
  const symbols = new Map(
    input.changedFiles
      .flatMap((file) => file.symbols)
      .map((symbol) => [symbol.id, symbol] as const),
  );
  const relevantFiles = input.changedFiles.filter((file) =>
    file.hunks.some((hunk) => spanIds.has(hunk.sourceSpan.id)),
  );
  const relevantFacts = (input.structuralFacts ?? []).filter((fact) =>
    fact.sourceSpanIds.some((spanId) => spanIds.has(spanId)),
  );
  const relevantTests = input.tests.filter((test) =>
    test.sourceSpanIds.some((spanId) => spanIds.has(spanId))
    || test.relatedSymbolIds.some((id) => symbolIds.has(id)),
  );
  const issueRelevant = input.issue
    && input.issue.sourceSpanIds.some((spanId) => spanIds.has(spanId));
  const familyParts = family.split(':');
  const familyNamespace = familyParts[0] ?? family;
  const familyDetail = familyParts.slice(1).join(':');

  const mechanisms = sortedOpenTerms([
    familyNamespace,
    familyDetail,
    ...relevantFacts.flatMap((fact) => [
      fact.kind,
      fact.object.concept,
      symbols.get(fact.subject.symbolId ?? '')?.name,
      symbols.get(fact.object.symbolId ?? '')?.name,
    ]),
    ...relevantTests.map((test) => test.framework),
  ]);
  const problems = sortedOpenTerms([
    ...(issueRelevant
      ? [
          input.issue?.title,
          input.issue?.body,
          ...(input.issue?.labels ?? []),
        ]
      : []),
    ...(familyNamespace === 'issue' ? [familyDetail] : []),
  ]);
  const domains = sortedOpenTerms([
    input.repoSnapshot.repository.name,
    ...relevantFiles.flatMap((file) => pathParts(file.path).slice(0, 3)),
  ]);
  const businessObjects = sortedOpenTerms([
    ...relevantFiles.flatMap((file) => pathParts(file.path).slice(-3)),
    ...changedSymbolIds.map((id) => symbols.get(id)?.name),
  ]);
  const ownershipActions = sortedOpenTerms([
    ...relevantFiles.map((file) => file.status),
    ...relevantFacts.map((fact) => fact.kind),
    ...(relevantTests.length > 0 ? ['verified by test change'] : []),
  ]);

  return {
    ...(problems.length > 0 ? { problems } : {}),
    ...(mechanisms.length > 0 ? { mechanisms } : {}),
    ...(domains.length > 0 ? { domains } : {}),
    ...(businessObjects.length > 0 ? { businessObjects } : {}),
    ...(ownershipActions.length > 0 ? { ownershipActions } : {}),
  };
}

function buildDemandNarrative(input: {
  pr: NormalizedPullRequestInput;
  family: ChallengeDemandFamily;
  conceptKeys: readonly string[];
  sourceSpanIds: readonly string[];
}): string {
  const evidence = demandEvidenceSummary(input.pr, input.sourceSpanIds);
  const concepts = input.conceptKeys
    .filter((key) => key !== input.family)
    .map(conceptLabel)
    .slice(0, 8)
    .join(', ');
  return [
    `Review ${familyLabel(input.family)} in pull request #${input.pr.number}.`,
    evidence ? `Source evidence: ${evidence}.` : '',
    concepts ? `Source-derived terms: ${concepts}.` : '',
  ].filter(Boolean).join(' ');
}

export async function extractChallengeDemands(
  input: NormalizedPullRequestInput,
): Promise<ChallengeDemand[]> {
  const evidence = new Map<ChallengeDemandFamily, { spans: Set<string>; symbols: Set<string> }>();
  const testSpanIds = new Set(
    input.sourceSpans
      .filter((span) => {
        const path = span.displayLabel?.split(':', 1)[0] ?? '';
        return TEST_PATH.test(path);
      })
      .map((span) => span.id),
  );

  const addEvidence = (
    family: ChallengeDemandFamily,
    sourceSpanIds: readonly string[],
    symbolIds: readonly string[],
  ): void => {
    const existing = evidence.get(family) ?? { spans: new Set<string>(), symbols: new Set<string>() };
    sourceSpanIds.forEach((id) => existing.spans.add(id));
    symbolIds.forEach((id) => existing.symbols.add(id));
    evidence.set(family, existing);
  };

  for (const file of input.changedFiles) {
    const hunkSpanIds = file.hunks.map((hunk) => hunk.sourceSpan.id);
    const symbolIds = file.hunks.flatMap((hunk) => hunk.changedSymbolIds);
    if (hunkSpanIds.length > 0) {
      addEvidence(`artifact:${file.artifact.kind}`, hunkSpanIds, symbolIds);
    }
  }

  for (const test of input.tests) {
    const family = openSemanticTerm(test.framework ?? 'source test');
    addEvidence(
      `verification:${family?.canonicalKey ?? 'term:source-test'}`,
      test.sourceSpanIds,
      test.relatedSymbolIds,
    );
  }

  for (const fact of input.structuralFacts ?? []) {
    if (
      fact.sourceSpanIds.length > 0
      && fact.sourceSpanIds.every((spanId) => testSpanIds.has(spanId))
    ) {
      continue;
    }
    addEvidence(
      `structure:${fact.kind}`,
      fact.sourceSpanIds,
      [fact.subject.symbolId, fact.object.symbolId].filter(
        (value): value is string => Boolean(value),
      ),
    );
  }

  for (const label of input.issue?.labels ?? []) {
    const term = openSemanticTerm(label);
    if (term) {
      addEvidence(
        `issue:${term.canonicalKey}`,
        input.issue?.sourceSpanIds ?? [],
        [],
      );
    }
  }

  const demands: ChallengeDemand[] = [];
  const families = [...evidence.keys()].sort();
  for (const family of families) {
    const familyEvidence = evidence.get(family)!;
    const sourceSpanIds = [...familyEvidence.spans].sort();
    if (sourceSpanIds.length === 0) continue;
    const changedSymbolIds = [...familyEvidence.symbols].sort();
    const concepts = extractConceptKeys(input, family, sourceSpanIds, changedSymbolIds);
    const dimensions = extractDemandDimensions(input, family, sourceSpanIds, changedSymbolIds);
    const narrative = buildDemandNarrative({
      pr: input,
      family,
      conceptKeys: concepts,
      sourceSpanIds,
    });
    const identity = { repoSnapshotId: input.repoSnapshot.id, prNumber: input.number, family, sourceSpanIds };
    const content = { ...identity, narrative, conceptKeys: concepts, ...dimensions, changedSymbolIds };
    demands.push({
      id: await stableId('challenge_demand', identity),
      family,
      narrative,
      conceptKeys: concepts,
      ...dimensions,
      sourceSpanIds,
      changedSymbolIds,
      weight: 0,
      contentHash: await hashObject(content),
    });
  }

  const rawWeight = demands.length > 0 ? 1 / demands.length : 0;
  return demands.map((demand) => ({ ...demand, weight: roundScore(rawWeight) }));
}

function reviewableSizeScore(fileCount: number, changedLines: number): number {
  if (
    fileCount < MIN_CHANGED_FILES ||
    fileCount > MAX_CHANGED_FILES ||
    changedLines < MIN_CHANGED_LINES ||
    changedLines > MAX_CHANGED_LINES
  ) {
    return 0;
  }
  const fileScore = fileCount <= 20 ? 1 : (MAX_CHANGED_FILES - fileCount) / (MAX_CHANGED_FILES - 20);
  const lineScore = changedLines <= 800 ? 1 : (MAX_CHANGED_LINES - changedLines) / (MAX_CHANGED_LINES - 800);
  return roundScore(Math.max(0, Math.min(fileScore, lineScore)));
}

function gate(gateName: ChallengeGateResult['gate'], passed: boolean, reason: string): ChallengeGateResult {
  return { gate: gateName, passed, reason };
}

function extractionDiagnostics(input: NormalizedPullRequestInput): ExtractionDiagnostic[] {
  const value = input.extractionDiagnostics;
  return Array.isArray(value) ? value : [];
}

function extractionDiagnosticReason(diagnostics: readonly ExtractionDiagnostic[]): string {
  if (diagnostics.length === 0) return 'all evidence resolves to exact source spans';
  return diagnostics
    .map((diagnostic) =>
      `${diagnostic.kind} failed for ${diagnostic.path} (${diagnostic.language}): ${diagnostic.reason}`
    )
    .join('; ');
}

export function scoreChallengeQuality(input: {
  pr: NormalizedPullRequestInput;
  demands: ChallengeDemand[];
  provenanceValid: boolean;
}): ChallengeQuality {
  const { pr, demands, provenanceValid } = input;
  const languageSupport = getLanguageSupport(pr.primaryLanguage);
  const diagnostics = extractionDiagnostics(pr).filter((diagnostic) => {
    const support = getLanguageSupport(diagnostic.language);
    return support.level === 'production';
  });
  const completeProvenance = provenanceValid && diagnostics.length === 0;
  const fileCount = pr.changedFiles.length;
  const changedLines = pr.changedFiles.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const sourceHunkCount = pr.changedFiles.reduce((sum, file) => sum + file.hunks.length, 0);
  const codeFileCount = pr.changedFiles.filter((file) => !NON_CODE_ARTIFACTS.has(file.artifact.kind)).length;
  const demandFamilyCount = new Set(demands.map((demand) => demand.family)).size;
  const reviewableSize = reviewableSizeScore(fileCount, changedLines);
  const issueContext = pr.issue
    ? pr.issue.body?.trim() || pr.issue.labels.length > 0
      ? 1
      : 0.7
    : 0;
  const metrics: ChallengeQualityMetrics = {
    provenanceCoverage: completeProvenance ? 1 : 0,
    reviewableSize,
    testCoverage: pr.tests.length > 0 ? 1 : 0,
    issueContext,
    demandDiversity: roundScore(Math.min(1, demandFamilyCount / 4)),
  };
  const score = roundScore(
    metrics.provenanceCoverage * 0.3 +
      metrics.reviewableSize * 0.25 +
      metrics.testCoverage * 0.2 +
      metrics.issueContext * 0.1 +
      metrics.demandDiversity * 0.15,
  );
  const gates: ChallengeGateResult[] = [
    gate('production_language', languageSupport.challengePacketsAllowed, languageSupport.reason),
    gate('merged_pull_request', pr.mergedAt !== null, pr.mergedAt ? 'pull request is merged' : 'pull request is not merged'),
    gate('reviewable_file_count', fileCount >= MIN_CHANGED_FILES && fileCount <= MAX_CHANGED_FILES, `${fileCount} changed files; expected ${MIN_CHANGED_FILES}-${MAX_CHANGED_FILES}`),
    gate('reviewable_change_size', changedLines >= MIN_CHANGED_LINES && changedLines <= MAX_CHANGED_LINES, `${changedLines} changed lines; expected ${MIN_CHANGED_LINES}-${MAX_CHANGED_LINES}`),
    gate('contains_code_change', codeFileCount > 0, `${codeFileCount} source code files changed`),
    gate('contains_source_hunk', sourceHunkCount > 0, `${sourceHunkCount} source hunks available`),
    gate('contains_tests', pr.tests.length > 0, `${pr.tests.length} normalized test changes available`),
    gate('demand_diversity', demandFamilyCount >= 2, `${demandFamilyCount} distinct demand families extracted`),
    gate(
      'complete_provenance',
      completeProvenance,
      completeProvenance ? 'all evidence resolves to exact source spans' : extractionDiagnosticReason(diagnostics),
    ),
    gate('minimum_quality', score >= MIN_QUALITY_SCORE, `quality score ${score}; minimum ${MIN_QUALITY_SCORE}`),
  ];
  return { score, metrics, gates, eligible: gates.every((result) => result.passed) };
}

export async function buildChallengePacket(
  input: NormalizedPullRequestInput,
): Promise<ChallengePacket> {
  await validateChallengeProvenance(input);
  const demands = await extractChallengeDemands(input);
  const languageSupport = getLanguageSupport(input.primaryLanguage);
  const quality = scoreChallengeQuality({ pr: input, demands, provenanceValid: true });
  const sourceSpanIds = sortedUnique([
    ...input.metadataSourceSpanIds,
    ...input.changedFiles.flatMap((file) => file.hunks.map((hunk) => hunk.sourceSpan.id)),
    ...input.tests.flatMap((test) => test.sourceSpanIds),
    ...(input.issue?.sourceSpanIds ?? []),
    ...demands.flatMap((demand) => demand.sourceSpanIds),
  ]);
  const changedSymbolIds = sortedUnique(
    input.changedFiles.flatMap((file) => [
      ...file.symbols.map((symbol) => symbol.id),
      ...file.hunks.flatMap((hunk) => hunk.changedSymbolIds),
    ]),
  );
  const identity = {
    repoSnapshotId: input.repoSnapshot.id,
    prNumber: input.number,
    baseSha: input.baseSha.toLowerCase(),
    headSha: input.headSha.toLowerCase(),
    policyVersion: 'repo-challenge-v1' as const,
  };
  const content = {
    ...identity,
    repository: input.repoSnapshot.repository,
    pullRequest: {
      number: input.number,
      url: input.url,
      title: input.title,
      body: input.body,
      author: input.author,
      baseSha: identity.baseSha,
      headSha: identity.headSha,
      mergedAt: input.mergedAt,
    },
    languageSupport,
    changedFilePaths: sortedUnique(input.changedFiles.map((file) => file.path)),
    changedSymbolIds,
    sourceSpanIds,
    testChanges: [...input.tests].sort((a, b) => a.path.localeCompare(b.path)),
    issue: input.issue
      ? { ...input.issue, labels: sortedUnique(input.issue.labels), sourceSpanIds: sortedUnique(input.issue.sourceSpanIds) }
      : undefined,
    demands,
    demandFamilies: demands.map((demand) => demand.family).sort(),
    quality,
  };
  return {
    schemaVersion: REPO_SEMANTIC_GRAPH_SCHEMA_VERSION,
    id: await stableId('challenge_packet', identity),
    ...content,
    contentHash: await hashObject(content),
  };
}
