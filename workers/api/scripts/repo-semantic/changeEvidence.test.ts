import { describe, expect, it } from 'vitest';
import type {
  RepoSymbol,
  SourceSpan,
  StructuralFact,
} from '../../src/lib/repoSemanticGraph';
import {
  changedLineNumbers,
  changedStructuralFacts,
  changedSymbolIds,
} from './changeEvidence';

function span(id: string, start: number, end: number): SourceSpan {
  return {
    schemaVersion: '1.0.0',
    id,
    repoSnapshotId: 'snapshot',
    artifactId: 'artifact',
    artifactVersionId: 'version',
    contentHash: `sha256:${id}` as SourceSpan['contentHash'],
    start: { byteOffset: start, line: start, column: 1 },
    end: { byteOffset: end, line: end, column: 1 },
    exactText: id,
    exactTextHash: `sha256:${id}-text` as SourceSpan['exactTextHash'],
    prSide: 'head',
  };
}

function symbol(id: string, definingSpanId: string): RepoSymbol {
  return {
    schemaVersion: '1.0.0',
    id,
    repoSnapshotId: 'snapshot',
    language: 'typescript',
    qualifiedName: id,
    name: id,
    kind: 'function',
    definingSpanId,
    exported: false,
    modifiers: [],
    contentHash: `sha256:${id}` as RepoSymbol['contentHash'],
  };
}

function fact(id: string, sourceSpanId: string): StructuralFact {
  return {
    schemaVersion: '1.0.0',
    id,
    repoSnapshotId: 'snapshot',
    kind: 'calls',
    subject: { symbolId: 'changed-symbol' },
    object: { concept: id },
    sourceSpanIds: [sourceSpanId],
    confidence: 1,
    parser: 'fixture',
    contentHash: `sha256:${id}` as StructuralFact['contentHash'],
  };
}

describe('change evidence mapping', () => {
  const hunk = {
    header: '@@ -10,4 +10,5 @@ function submit()',
    lines: [
      { type: 'context' as const },
      { type: 'removed' as const },
      { type: 'added' as const },
      { type: 'added' as const },
      { type: 'context' as const },
    ],
  };

  it('tracks exact changed lines independently on base and head', () => {
    expect(changedLineNumbers(hunk, 'base')).toEqual([11]);
    expect(changedLineNumbers(hunk, 'head')).toEqual([11, 12]);
  });

  it('promotes only symbols and facts touching changed lines', () => {
    const spans = [
      span('changed-definition', 8, 14),
      span('unchanged-definition', 20, 24),
      span('changed-call', 12, 12),
      span('unchanged-call', 21, 21),
    ];
    expect(changedSymbolIds({
      symbols: [
        symbol('changed-symbol', 'changed-definition'),
        symbol('unchanged-symbol', 'unchanged-definition'),
      ],
      spans,
      lineNumbers: [11, 12],
    })).toEqual(['changed-symbol']);
    expect(changedStructuralFacts({
      facts: [
        fact('changed-target', 'changed-call'),
        fact('unchanged-target', 'unchanged-call'),
      ],
      spans,
      lineNumbers: [11, 12],
    }).map((item) => item.id)).toEqual(['changed-target']);
  });
});
