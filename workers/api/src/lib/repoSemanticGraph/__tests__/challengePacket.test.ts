import { describe, expect, it } from 'vitest';
import {
  ProvenanceValidationError,
  buildChallengePacket,
  buildRepoSnapshot,
  buildSourceArtifact,
  buildSourceArtifactVersion,
  buildSourceSpan,
  buildStructuralFact,
  buildSymbol,
  extractChallengeDemands,
  getLanguageSupport,
  scoreChallengeQuality,
  type NormalizedPullRequestFile,
  type NormalizedPullRequestInput,
  type RepoSnapshot,
  type SourceArtifactKind,
  type SourceSpan,
} from '../index';

const OBSERVED_AT = '2026-06-11T12:00:00.000Z';

async function makeSnapshot(): Promise<RepoSnapshot> {
  return buildRepoSnapshot({
    repository: {
      provider: 'github',
      owner: 'pipe-labs',
      name: 'orders',
      canonicalUrl: 'https://github.com/pipe-labs/orders',
    },
    commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    defaultBranch: 'main',
    observedAt: OBSERVED_AT,
    parentCommitShas: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  });
}

async function makeSpan(input: {
  snapshot: RepoSnapshot;
  kind: SourceArtifactKind;
  path: string;
  language: string;
  text: string;
  side?: 'base' | 'head' | 'metadata';
}): Promise<{
  artifact: Awaited<ReturnType<typeof buildSourceArtifact>>;
  version: Awaited<ReturnType<typeof buildSourceArtifactVersion>>;
  span: SourceSpan;
}> {
  const artifact = await buildSourceArtifact({
    repoSnapshotId: input.snapshot.id,
    kind: input.kind,
    path: input.path,
    language: input.language,
  });
  const version = await buildSourceArtifactVersion({
    artifactId: artifact.id,
    repoSnapshotId: input.snapshot.id,
    content: input.text,
    createdAt: OBSERVED_AT,
  });
  const span = await buildSourceSpan({
    repoSnapshotId: input.snapshot.id,
    artifactId: artifact.id,
    artifactVersionId: version.id,
    contentHash: version.contentHash,
    start: { byteOffset: 0, line: 1, column: 1 },
    end: {
      byteOffset: new TextEncoder().encode(input.text).byteLength,
      line: input.text.split('\n').length,
      column: 1,
    },
    exactText: input.text,
    displayLabel: input.path,
    prSide: input.side ?? 'head',
  });
  return { artifact, version, span };
}

async function makeFile(input: {
  snapshot: RepoSnapshot;
  path: string;
  language?: string;
  text: string;
  additions: number;
  deletions: number;
  kind?: SourceArtifactKind;
  symbolName: string;
}): Promise<{ file: NormalizedPullRequestFile; span: SourceSpan }> {
  const source = await makeSpan({
    snapshot: input.snapshot,
    kind: input.kind ?? 'source',
    path: input.path,
    language: input.language ?? 'typescript',
    text: input.text,
  });
  const symbol = await buildSymbol({
    repoSnapshotId: input.snapshot.id,
    language: input.language ?? 'typescript',
    qualifiedName: `${input.path}:${input.symbolName}`,
    name: input.symbolName,
    kind: input.kind === 'test' ? 'test' : 'function',
    definingSpanId: source.span.id,
    exported: true,
  });
  return {
    file: {
      path: input.path,
      status: 'modified',
      language: input.language ?? 'typescript',
      additions: input.additions,
      deletions: input.deletions,
      artifact: source.artifact,
      artifactVersion: source.version,
      hunks: [
        {
          header: `@@ ${input.symbolName} @@`,
          patch: input.text,
          sourceSpan: source.span,
          changedSymbolIds: [symbol.id],
        },
      ],
      symbols: [symbol],
    },
    span: source.span,
  };
}

async function makePullRequest(
  overrides: Partial<NormalizedPullRequestInput> = {},
): Promise<NormalizedPullRequestInput> {
  const snapshot = overrides.repoSnapshot ?? (await makeSnapshot());
  const metadata = await makeSpan({
    snapshot,
    kind: 'pull_request',
    path: '.pipe/pull-requests/42.json',
    language: 'json',
    text: 'Retry failed order events without duplicating writes',
    side: 'metadata',
  });
  const api = await makeFile({
    snapshot,
    path: 'src/api/orders.ts',
    text: '+ router.post("/orders", validateOrderRequest, createOrder)\n+ return response.json(order)',
    additions: 12,
    deletions: 2,
    symbolName: 'createOrder',
  });
  const worker = await makeFile({
    snapshot,
    path: 'src/workers/orderEvents.ts',
    text: '+ await kafka.consume({ retry: 3, idempotencyKey })\n+ await transaction.commit()',
    additions: 14,
    deletions: 4,
    symbolName: 'consumeOrderEvent',
  });
  const test = await makeFile({
    snapshot,
    path: 'src/workers/__tests__/orderEvents.test.ts',
    kind: 'test',
    text: '+ it("does not duplicate an order on retry", async () => {\n+   expect(await replay()).toEqual("once")\n+ })',
    additions: 10,
    deletions: 1,
    symbolName: 'doesNotDuplicateOrder',
  });
  const sourceSpans = [metadata.span, api.span, worker.span, test.span];
  const callFact = await buildStructuralFact({
    repoSnapshotId: snapshot.id,
    kind: 'calls',
    subject: { symbolId: worker.file.symbols[0]!.id },
    object: { concept: 'kafka.consume' },
    sourceSpanIds: [worker.span.id],
    confidence: 1,
    parser: 'fixture-parser',
  });
  const testCallFact = await buildStructuralFact({
    repoSnapshotId: snapshot.id,
    kind: 'calls',
    subject: { symbolId: test.file.symbols[0]!.id },
    object: { concept: 'expect.toEqual' },
    sourceSpanIds: [test.span.id],
    confidence: 1,
    parser: 'fixture-parser',
  });
  const base: NormalizedPullRequestInput = {
    repoSnapshot: snapshot,
    number: 42,
    url: 'https://github.com/pipe-labs/orders/pull/42',
    title: 'Retry failed order events without duplicating writes',
    body: 'Adds bounded retries and transactional idempotency for Kafka order events.',
    author: 'engineer',
    primaryLanguage: 'TypeScript',
    baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headSha: snapshot.commitSha,
    mergedAt: '2026-06-10T12:00:00.000Z',
    metadataSourceSpanIds: [metadata.span.id],
    sourceSpans,
    changedFiles: [api.file, worker.file, test.file],
    tests: [
      {
        path: test.file.path,
        framework: 'vitest',
        sourceSpanIds: [test.span.id],
        relatedSymbolIds: worker.file.symbols.map((symbol) => symbol.id),
      },
    ],
    structuralFacts: [callFact, testCallFact],
    issue: {
      number: 18,
      title: 'Order consumer retries can create duplicate writes',
      body: 'Kafka replay must be idempotent and preserve transaction integrity.',
      labels: ['bug', 'reliability'],
      sourceSpanIds: [metadata.span.id],
    },
  };
  return { ...base, ...overrides, repoSnapshot: snapshot };
}

describe('repository semantic graph challenge packets', () => {
  it('builds byte-stable deterministic packets independent of normalized file ordering', async () => {
    const input = await makePullRequest();
    const first = await buildChallengePacket(input);
    const second = await buildChallengePacket({
      ...input,
      changedFiles: [...input.changedFiles].reverse(),
      sourceSpans: [...input.sourceSpans].reverse(),
    });

    expect(second).toEqual(first);
    expect(first.id).toMatch(/^challenge_packet_[a-f0-9]{24}$/);
    expect(first.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('rejects a hunk whose exact source span does not match the normalized patch', async () => {
    const input = await makePullRequest();
    const changedFiles = [...input.changedFiles];
    const firstFile = changedFiles[0]!;
    changedFiles[0] = {
      ...firstFile,
      hunks: firstFile.hunks.map((hunk) => ({ ...hunk, patch: `${hunk.patch}\n+ hidden mutation` })),
    };

    await expect(buildChallengePacket({ ...input, changedFiles })).rejects.toBeInstanceOf(
      ProvenanceValidationError,
    );
  });

  it('allows production packets only for TypeScript/JavaScript, Python, and Go', () => {
    expect(getLanguageSupport('TSX')).toMatchObject({
      normalizedLanguage: 'typescript',
      level: 'production',
      challengePacketsAllowed: true,
    });
    expect(getLanguageSupport('Python')).toMatchObject({
      level: 'production',
      challengePacketsAllowed: true,
    });
    expect(getLanguageSupport('Go')).toMatchObject({
      level: 'production',
      challengePacketsAllowed: true,
    });
    expect(getLanguageSupport('Rust')).toMatchObject({
      level: 'structural_only',
      challengePacketsAllowed: false,
    });
    expect(getLanguageSupport('Elixir')).toMatchObject({
      level: 'unsupported',
      challengePacketsAllowed: false,
    });
  });

  it('extracts protocol demand families and open concepts without a semantic whitelist', async () => {
    const input = await makePullRequest();
    const demands = await extractChallengeDemands(input);
    const families = demands.map((demand) => demand.family);

    expect(families).toEqual([
      'artifact:source',
      'artifact:test',
      'issue:term:bug',
      'issue:term:reliability',
      'structure:calls',
      'verification:term:vitest',
    ]);
    expect(demands.every((demand) => demand.sourceSpanIds.length > 0)).toBe(true);
    expect(demands.every((demand) => demand.conceptKeys.includes('term:typescript'))).toBe(true);
    expect(
      demands.find((demand) => demand.family === 'structure:calls')?.conceptKeys,
    ).toContain('term:kafka.consume');
    expect(
      demands.find((demand) => demand.family === 'structure:calls')?.conceptKeys,
    ).not.toContain('term:expect.toequal');
    expect(
      demands.find((demand) => demand.family === 'issue:term:bug')?.conceptKeys,
    ).not.toContain('term:kafka.consume');
  });

  it('scores a well-provenanced review challenge as eligible and fails oversized challenges', async () => {
    const input = await makePullRequest();
    const demands = await extractChallengeDemands(input);
    const quality = scoreChallengeQuality({ pr: input, demands, provenanceValid: true });

    expect(quality.eligible).toBe(true);
    expect(quality.score).toBeGreaterThanOrEqual(0.7);
    expect(quality.gates.every((gate) => gate.passed)).toBe(true);

    const oversized = {
      ...input,
      changedFiles: input.changedFiles.map((file, index) =>
        index === 0 ? { ...file, additions: 1_600 } : file,
      ),
    };
    const oversizedQuality = scoreChallengeQuality({
      pr: oversized,
      demands,
      provenanceValid: true,
    });

    expect(oversizedQuality.eligible).toBe(false);
    expect(
      oversizedQuality.gates.find((gate) => gate.gate === 'reviewable_change_size'),
    ).toMatchObject({ passed: false });
  });

  it('builds structural-only packets but marks them ineligible for production use', async () => {
    const input = await makePullRequest({ primaryLanguage: 'Rust' });
    const packet = await buildChallengePacket(input);

    expect(packet.languageSupport.level).toBe('structural_only');
    expect(packet.quality.eligible).toBe(false);
    expect(packet.quality.gates.find((gate) => gate.gate === 'production_language')).toMatchObject({
      passed: false,
    });
  });
});
