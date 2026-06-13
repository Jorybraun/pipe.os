import type {
  RepoSymbol,
  SourceSpan,
  StructuralFact,
} from '../../src/lib/repoSemanticGraph';

interface DiffLine {
  type: 'context' | 'added' | 'removed';
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export type DiffSide = 'base' | 'head';

export function changedLineNumbers(hunk: DiffHunk, side: DiffSide): number[] {
  const header = hunk.header.match(
    /@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/,
  );
  if (!header) return [];

  let baseLine = Number(header[1]);
  let headLine = Number(header[2]);
  const changed = new Set<number>();

  for (const line of hunk.lines) {
    if (line.type === 'context') {
      baseLine++;
      headLine++;
    } else if (line.type === 'removed') {
      if (side === 'base') changed.add(baseLine);
      baseLine++;
    } else {
      if (side === 'head') changed.add(headLine);
      headLine++;
    }
  }

  return [...changed].sort((left, right) => left - right);
}

function spanTouchesLines(span: SourceSpan, lines: ReadonlySet<number>): boolean {
  for (let line = span.start.line; line <= span.end.line; line++) {
    if (lines.has(line)) return true;
  }
  return false;
}

export function changedSymbolIds(input: {
  symbols: readonly RepoSymbol[];
  spans: readonly SourceSpan[];
  lineNumbers: readonly number[];
}): string[] {
  const lines = new Set(input.lineNumbers);
  if (lines.size === 0) return [];
  const spans = new Map(input.spans.map((span) => [span.id, span]));
  return [...new Set(
    input.symbols
      .filter((symbol) => {
        const span = spans.get(symbol.definingSpanId);
        return Boolean(span && spanTouchesLines(span, lines));
      })
      .map((symbol) => symbol.id),
  )].sort();
}

export function changedStructuralFacts(input: {
  facts: readonly StructuralFact[];
  spans: readonly SourceSpan[];
  lineNumbers: readonly number[];
}): StructuralFact[] {
  const lines = new Set(input.lineNumbers);
  if (lines.size === 0) return [];
  const spans = new Map(input.spans.map((span) => [span.id, span]));
  return input.facts.filter((fact) =>
    fact.sourceSpanIds.some((spanId) => {
      const span = spans.get(spanId);
      return Boolean(span && spanTouchesLines(span, lines));
    })
  );
}
