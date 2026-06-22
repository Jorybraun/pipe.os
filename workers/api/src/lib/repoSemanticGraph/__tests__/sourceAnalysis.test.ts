import { describe, expect, it } from 'vitest';
import {
  buildRepoSnapshot,
  buildSourceArtifact,
  buildSourceArtifactVersion,
} from '../index';
import { analyzeRuntimeSourceFile } from '../sourceAnalysis';

async function analyze(path: string, language: string, content: string) {
  const snapshot = await buildRepoSnapshot({
    repository: {
      provider: 'github',
      owner: 'pipe',
      name: 'runtime-semantic-test',
      canonicalUrl: 'https://github.com/pipe/runtime-semantic-test',
    },
    commitSha: 'abc123',
    defaultBranch: 'main',
    observedAt: '2026-06-20T00:00:00.000Z',
  });
  const artifact = await buildSourceArtifact({
    repoSnapshotId: snapshot.id,
    kind: 'source',
    path,
    language,
  });
  const version = await buildSourceArtifactVersion({
    artifactId: artifact.id,
    repoSnapshotId: snapshot.id,
    content,
    createdAt: snapshot.observedAt,
  });
  return analyzeRuntimeSourceFile({
    repoSnapshotId: snapshot.id,
    path,
    language,
    content,
    artifact,
    artifactVersion: version,
    prSide: 'head',
  });
}

describe('analyzeRuntimeSourceFile', () => {
  it('extracts source-backed TypeScript symbols and structural facts', async () => {
    const content = [
      "import { publish } from './events';",
      'export class OrderService {',
      '  submit(id: string) { return publish(id); }',
      '}',
    ].join('\n');

    const result = await analyze('src/orders.ts', 'typescript', content);

    expect(result.parser).toBe('typescript-compiler-api');
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(['src/orders.ts', 'OrderService', 'submit']),
    );
    expect(result.structuralFacts.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining(['imports', 'calls', 'contains']),
    );

    const encoded = new TextEncoder().encode(content);
    for (const span of result.sourceSpans) {
      expect(
        new TextDecoder().decode(
          encoded.slice(span.start.byteOffset, span.end.byteOffset),
        ),
      ).toBe(span.exactText);
    }
  });
});
