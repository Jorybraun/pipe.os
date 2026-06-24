import { extractRepoPath, type DiffFile, type GitHubDiffResult } from '../fetchGitHubDiff';
import {
  buildRepoSnapshot,
  buildSourceArtifact,
  buildSourceArtifactVersion,
  buildSourceSpan,
  buildStructuralFact,
  buildSymbol,
} from './builders';
import type {
  NormalizedPullRequestFile,
  NormalizedPullRequestInput,
  NormalizedTestChange,
  PullRequestFileStatus,
  RepoSnapshot,
  SourceArtifact,
  SourceArtifactKind,
  SourceArtifactVersion,
  SourceSpan,
  StructuralFact,
  RepoSymbol,
  ExtractionDiagnostic,
} from './model';
import { getLanguageSupport } from './languagePolicy';

const TEST_PATH = /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/i;

function normalizeStatus(status: string): PullRequestFileStatus {
  switch (status) {
    case 'added':
    case 'modified':
    case 'deleted':
    case 'renamed':
      return status;
    case 'removed':
      return 'deleted';
    default:
      return 'modified';
  }
}

function languageFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.rb')) return 'ruby';
  if (lower.endsWith('.php')) return 'php';
  if (lower.endsWith('.cs')) return 'csharp';
  if (lower.endsWith('.swift')) return 'swift';
  if (lower.endsWith('.kt') || lower.endsWith('.kts')) return 'kotlin';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  return 'unknown';
}

function artifactKindFromPath(path: string): SourceArtifactKind {
  const lower = path.toLowerCase();
  if (TEST_PATH.test(path)) return 'test';
  if (lower.endsWith('package.json') || lower.endsWith('requirements.txt') || lower.endsWith('go.mod') || lower.endsWith('cargo.toml')) {
    return 'manifest';
  }
  if (lower.startsWith('.github/workflows/') || lower.includes('/.github/workflows/')) return 'ci';
  if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.includes('/docs/')) return 'documentation';
  return 'source';
}

function requiresProductionExtraction(kind: SourceArtifactKind, language: string): boolean {
  if (kind !== 'source' && kind !== 'test') return false;
  return getLanguageSupport(language).level === 'production';
}

function diagnosticReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error || 'unknown error');
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function symbolNameFromPath(path: string): string {
  return basename(path)
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_$]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'changed_source';
}

function lineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') offsets.push(index + 1);
  }
  return offsets;
}

function positionForOffset(text: string, offset: number): { byteOffset: number; line: number; column: number } {
  const starts = lineStartOffsets(text);
  let lineIndex = 0;
  for (let index = 0; index < starts.length; index++) {
    if (starts[index]! > offset) break;
    lineIndex = index;
  }
  return {
    byteOffset: new TextEncoder().encode(text.slice(0, offset)).byteLength,
    line: lineIndex + 1,
    column: offset - starts[lineIndex]! + 1,
  };
}

function reconstructedPatch(file: DiffFile): string {
  return file.hunks
    .map((hunk) => [
      hunk.header,
      ...hunk.lines.map((line) => {
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        return `${prefix}${line.content}`;
      }),
    ].join('\n'))
    .join('\n');
}

function spanTouchesLines(span: SourceSpan | undefined, lineNumbers: ReadonlySet<number>): boolean {
  if (!span || lineNumbers.size === 0) return false;
  for (let line = span.start.line; line <= span.end.line; line++) {
    if (lineNumbers.has(line)) return true;
  }
  return false;
}

function changedSymbolsForHunk(input: {
  hunk: DiffFile['hunks'][number];
  symbols: readonly RepoSymbol[];
  spans: readonly SourceSpan[];
  fallbackSymbolId: string;
}): string[] {
  const lines = new Set(
    input.hunk.lines
      .filter((line) => line.type !== 'removed')
      .map((line) => line.lineNumber),
  );
  const spansById = new Map(input.spans.map((span) => [span.id, span] as const));
  const touched = input.symbols
    .filter((symbol) => spanTouchesLines(spansById.get(symbol.definingSpanId), lines))
    .map((symbol) => symbol.id)
    .sort();
  return touched.length > 0 ? [...new Set(touched)] : [input.fallbackSymbolId];
}

async function spanForText(input: {
  snapshot: RepoSnapshot;
  artifactId: string;
  version: SourceArtifactVersion;
  text: string;
  startOffset: number;
  displayLabel: string;
  prSide: SourceSpan['prSide'];
}): Promise<SourceSpan> {
  return buildSourceSpan({
    repoSnapshotId: input.snapshot.id,
    artifactId: input.artifactId,
    artifactVersionId: input.version.id,
    contentHash: input.version.contentHash,
    start: positionForOffset(input.version.content, input.startOffset),
    end: positionForOffset(input.version.content, input.startOffset + input.text.length),
    exactText: input.text,
    displayLabel: input.displayLabel,
    prSide: input.prSide,
  });
}

export async function normalizeGitHubPullRequest(input: {
  repoUrl: string;
  prNumber: number;
  diffResult: GitHubDiffResult;
  primaryLanguage?: string | null;
  defaultBranch?: string | null;
  observedAt?: string;
}): Promise<NormalizedPullRequestInput> {
  const repoPath = extractRepoPath(input.repoUrl);
  if (!repoPath) throw new TypeError('repoUrl must be a GitHub repository URL');
  const [owner, name] = repoPath.split('/');
  if (!owner || !name) throw new TypeError('repoUrl must include owner and repository name');

  const metadata = input.diffResult.metadata;
  if (!metadata.base_sha || !metadata.head_sha) {
    throw new TypeError('GitHub PR metadata must include base and head SHAs');
  }

  const observedAt = input.observedAt ?? new Date().toISOString();
  const snapshot = await buildRepoSnapshot({
    repository: {
      provider: 'github',
      owner,
      name,
      canonicalUrl: `https://github.com/${owner}/${name}`,
    },
    commitSha: metadata.head_sha,
    defaultBranch: input.defaultBranch ?? metadata.base,
    observedAt,
    parentCommitShas: [metadata.base_sha],
  });

  const sourceArtifacts: SourceArtifact[] = [];
  const sourceArtifactVersions: SourceArtifactVersion[] = [];
  const sourceSpans: SourceSpan[] = [];

  const metadataContent = JSON.stringify({
    number: input.prNumber,
    url: `${snapshot.repository.canonicalUrl}/pull/${input.prNumber}`,
    title: metadata.title,
    body: metadata.description,
    author: metadata.author,
    state: metadata.state,
    base: metadata.base,
    head: metadata.head,
    baseSha: metadata.base_sha,
    headSha: metadata.head_sha,
    mergedAt: metadata.merged_at,
  }, null, 2);
  const metadataArtifact = await buildSourceArtifact({
    repoSnapshotId: snapshot.id,
    kind: 'pull_request',
    path: `.pipe/pull-requests/${input.prNumber}.json`,
    language: 'json',
    mediaType: 'application/json',
  });
  const metadataVersion = await buildSourceArtifactVersion({
    artifactId: metadataArtifact.id,
    repoSnapshotId: snapshot.id,
    content: metadataContent,
    createdAt: observedAt,
  });
  const metadataSpan = await spanForText({
    snapshot,
    artifactId: metadataArtifact.id,
    version: metadataVersion,
    text: metadataContent,
    startOffset: 0,
    displayLabel: metadataArtifact.path ?? `PR #${input.prNumber}`,
    prSide: 'metadata',
  });
  sourceArtifacts.push(metadataArtifact);
  sourceArtifactVersions.push(metadataVersion);
  sourceSpans.push(metadataSpan);

  const changedFiles: NormalizedPullRequestFile[] = [];
  const tests: NormalizedTestChange[] = [];
  const structuralFacts: StructuralFact[] = [];
  const extractionDiagnostics: ExtractionDiagnostic[] = [];
  for (const file of input.diffResult.diff.files) {
    const language = languageFromPath(file.filename);
    const kind = artifactKindFromPath(file.filename);
    const patch = reconstructedPatch(file);
    if (!patch.trim()) continue;
    let fullFileSpan: SourceSpan | undefined;
    let analyzedSymbols: RepoSymbol[] = [];
    let analysisSpans: SourceSpan[] = [];
    const productionExtractionRequired = requiresProductionExtraction(kind, language);
    if (file.headContent && file.headContent.length > 0) {
      const sourceArtifact = await buildSourceArtifact({
        repoSnapshotId: snapshot.id,
        kind,
        path: file.filename,
        externalRef: file.headContentUrl
          ?? `${snapshot.repository.canonicalUrl}/blob/${metadata.head_sha}/${file.filename}`,
        language,
        mediaType: 'text/plain',
      });
      const sourceVersion = await buildSourceArtifactVersion({
        artifactId: sourceArtifact.id,
        repoSnapshotId: snapshot.id,
        content: file.headContent,
        createdAt: observedAt,
      });
      const { canAnalyzeRuntimeSource, analyzeRuntimeSourceFile } = await import('./sourceAnalysis');
      if (canAnalyzeRuntimeSource(language)) {
        try {
          const analysis = await analyzeRuntimeSourceFile({
            repoSnapshotId: snapshot.id,
            path: file.filename,
            language,
            content: file.headContent,
            artifact: sourceArtifact,
            artifactVersion: sourceVersion,
            prSide: 'head',
          });
          analyzedSymbols = analysis.symbols;
          analysisSpans = analysis.sourceSpans;
          structuralFacts.push(...analysis.structuralFacts);
          fullFileSpan = analysis.sourceSpans.find((span) =>
            span.start.byteOffset === 0
            && span.end.byteOffset === sourceVersion.byteLength
          );
        } catch (error) {
          extractionDiagnostics.push({
            kind: 'semantic_parser',
            path: file.filename,
            language,
            reason: diagnosticReason(error),
          });
        }
      } else if (productionExtractionRequired) {
        extractionDiagnostics.push({
          kind: 'semantic_parser',
          path: file.filename,
          language,
          reason: `${language} has no runtime source analysis adapter`,
        });
      }
      if (!fullFileSpan) {
        fullFileSpan = await spanForText({
          snapshot,
          artifactId: sourceArtifact.id,
          version: sourceVersion,
          text: file.headContent,
          startOffset: 0,
          displayLabel: `${file.filename}@${metadata.head_sha}`,
          prSide: 'head',
        });
        analysisSpans = [...analysisSpans, fullFileSpan];
      }
      sourceArtifacts.push(sourceArtifact);
      sourceArtifactVersions.push(sourceVersion);
      sourceSpans.push(...analysisSpans);
    } else if (productionExtractionRequired && normalizeStatus(file.status) !== 'deleted') {
      extractionDiagnostics.push({
        kind: 'full_source_fetch',
        path: file.filename,
        language,
        reason: 'GitHub head file content was unavailable for a production-language changed file',
      });
    }

    const artifact = await buildSourceArtifact({
      repoSnapshotId: snapshot.id,
      kind,
      path: file.filename,
      language,
      mediaType: 'text/x-diff',
    });
    const version = await buildSourceArtifactVersion({
      artifactId: artifact.id,
      repoSnapshotId: snapshot.id,
      content: patch,
      createdAt: observedAt,
    });

    const hunks = [];
    let searchFrom = 0;
    for (const hunk of file.hunks) {
      const hunkPatch = [
        hunk.header,
        ...hunk.lines.map((line) => {
          const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
          return `${prefix}${line.content}`;
        }),
      ].join('\n');
      const offset = patch.indexOf(hunkPatch, searchFrom);
      const startOffset = offset >= 0 ? offset : searchFrom;
      searchFrom = startOffset + hunkPatch.length;
      const sourceSpan = await spanForText({
        snapshot,
        artifactId: artifact.id,
        version,
        text: hunkPatch,
        startOffset,
        displayLabel: `${file.filename}:${hunk.header}`,
        prSide: 'head',
      });
      sourceSpans.push(sourceSpan);
      hunks.push({
        header: hunk.header,
        patch: hunkPatch,
        sourceSpan,
        changedSymbolIds: [],
      });
    }

    const fileSymbol = await buildSymbol({
      repoSnapshotId: snapshot.id,
      language,
      qualifiedName: `${file.filename}:${symbolNameFromPath(file.filename)}`,
      name: symbolNameFromPath(file.filename),
      kind: kind === 'test' ? 'test' : 'module',
      definingSpanId: fullFileSpan?.id ?? hunks[0]?.sourceSpan.id ?? metadataSpan.id,
      exported: false,
      modifiers: fullFileSpan ? ['github-head-source', 'github-pr-diff'] : ['github-pr-diff'],
    });
    const fileSymbols = analyzedSymbols.length > 0 ? [...analyzedSymbols, fileSymbol] : [fileSymbol];
    const spanEvidence = [...analysisSpans, ...hunks.map((hunk) => hunk.sourceSpan)];
    const hunksWithSymbols = hunks.map((hunk, index) => ({
      ...hunk,
      changedSymbolIds: changedSymbolsForHunk({
        hunk: file.hunks[index] ?? {
          header: hunk.header,
          lines: [],
        },
        symbols: fileSymbols,
        spans: spanEvidence,
        fallbackSymbolId: fileSymbol.id,
      }),
    }));
    for (const hunk of hunksWithSymbols) {
      for (const symbolId of hunk.changedSymbolIds) {
        structuralFacts.push(await buildStructuralFact({
          repoSnapshotId: snapshot.id,
          kind: 'changed_symbol',
          subject: { symbolId },
          object: { literal: normalizeStatus(file.status) },
          sourceSpanIds: [hunk.sourceSpan.id],
          confidence: 1,
          parser: 'github-pr-diff',
        }));
      }
    }
    changedFiles.push({
      path: file.filename,
      status: normalizeStatus(file.status),
      language,
      additions: file.additions,
      deletions: file.deletions,
      artifact,
      artifactVersion: version,
      hunks: hunksWithSymbols,
      symbols: fileSymbols,
    });
    sourceArtifacts.push(artifact);
    sourceArtifactVersions.push(version);

    if (kind === 'test') {
      tests.push({
        path: file.filename,
        framework: undefined,
        sourceSpanIds: hunksWithSymbols.map((hunk) => hunk.sourceSpan.id),
        relatedSymbolIds: [...new Set(
          hunksWithSymbols.flatMap((hunk) => hunk.changedSymbolIds),
        )],
      });
    }
  }

  return {
    repoSnapshot: snapshot,
    number: input.prNumber,
    url: `${snapshot.repository.canonicalUrl}/pull/${input.prNumber}`,
    title: metadata.title,
    body: metadata.description,
    author: metadata.author,
    primaryLanguage: input.primaryLanguage ?? languageFromPath(
      changedFiles.find((file) => file.language !== 'unknown')?.path ?? '',
    ),
    baseSha: metadata.base_sha,
    headSha: metadata.head_sha,
    mergedAt: metadata.merged_at,
    metadataSourceSpanIds: [metadataSpan.id],
    sourceArtifacts,
    sourceArtifactVersions,
    sourceSpans,
    changedFiles,
    tests,
    structuralFacts,
    extractionDiagnostics,
  };
}
