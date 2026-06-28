import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  buildRepoSnapshot,
  buildSourceArtifact,
  buildSourceArtifactVersion,
} from '../../src/lib/repoSemanticGraph';
import { analyzeSourceFile } from './sourceAnalysis';

const hasGo = (() => {
  try {
    execSync('go version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

async function analyze(path: string, language: string, content: string) {
  const snapshot = await buildRepoSnapshot({
    repository: {
      provider: 'github',
      owner: 'pipe',
      name: 'semantic-test',
      canonicalUrl: 'https://github.com/pipe/semantic-test',
    },
    commitSha: 'abc123',
    defaultBranch: 'main',
    observedAt: '2026-06-12T00:00:00.000Z',
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
  return analyzeSourceFile({
    repoSnapshotId: snapshot.id,
    path,
    language,
    content,
    artifact,
    artifactVersion: version,
    prSide: 'head',
  });
}

function expectExactSpans(content: string, spans: Awaited<ReturnType<typeof analyze>>['sourceSpans']) {
  const encoded = new TextEncoder().encode(content);
  for (const span of spans) {
    expect(
      new TextDecoder().decode(
        encoded.slice(span.start.byteOffset, span.end.byteOffset),
      ),
    ).toBe(span.exactText);
  }
}

describe('analyzeSourceFile', () => {
  it('uses the TypeScript compiler API for symbols and structural facts', async () => {
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
    expectExactSpans(content, result.sourceSpans);
  });

  it('uses Python ast without a semantic term whitelist', async () => {
    const content = [
      'from ledger.events import publish',
      'class OrderService:',
      '    def submit(self, order_id):',
      '        return publish(order_id)',
    ].join('\n');
    const result = await analyze('orders.py', 'python', content);

    expect(result.parser).toBe('python-ast');
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(['orders.py', 'OrderService', 'submit']),
    );
    expect(result.structuralFacts.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining(['imports', 'calls', 'contains']),
    );
    expectExactSpans(content, result.sourceSpans);
  });

  it.skipIf(!hasGo)('uses go/parser for Go declarations and calls', async () => {
    const content = [
      'package orders',
      'import "context"',
      'type Service struct{}',
      'func (s Service) Submit(ctx context.Context) error {',
      '  return ctx.Err()',
      '}',
    ].join('\n');
    const result = await analyze('orders.go', 'go', content);

    expect(result.parser).toBe('go-parser');
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(['orders', 'Service', 'Submit']),
    );
    expect(result.structuralFacts.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining(['imports', 'calls', 'contains']),
    );
    expectExactSpans(content, result.sourceSpans);
  }, 60_000);
});
