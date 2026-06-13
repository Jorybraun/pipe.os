import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

import {
  buildSourceSpan,
  buildStructuralFact,
  buildSymbol,
  normalizeLanguage,
  type RepoSymbol,
  type SourceArtifact,
  type SourceArtifactVersion,
  type SourceSpan,
  type StructuralFact,
  type StructuralFactKind,
  type SymbolKind,
} from '../../src/lib/repoSemanticGraph';

const helperDir = dirname(fileURLToPath(import.meta.url));

interface ParsedDeclaration {
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
  parentQualifiedName?: string | null;
  signature?: string;
}

interface ParsedFact {
  kind: StructuralFactKind;
  subjectQualifiedName: string;
  objectConcept: string;
  startByte: number;
  endByte: number;
}

interface ParsedSource {
  declarations: ParsedDeclaration[];
  facts: ParsedFact[];
}

export interface SourceAnalysis {
  symbols: RepoSymbol[];
  sourceSpans: SourceSpan[];
  structuralFacts: StructuralFact[];
  parser: string;
}

function byteOffset(content: string, charOffset: number): number {
  return new TextEncoder().encode(content.slice(0, charOffset)).byteLength;
}

function positionForByte(content: string, offset: number): { line: number; column: number } {
  const prefix = new TextDecoder().decode(
    new TextEncoder().encode(content).slice(0, offset),
  );
  const lines = prefix.split('\n');
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function declarationKind(node: ts.Node): SymbolKind | null {
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return 'function';
  }
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return 'method';
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return 'property';
  if (ts.isVariableDeclaration(node)) return 'variable';
  return null;
}

function typescriptAnalysis(path: string, content: string): ParsedSource {
  const scriptKind = path.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : path.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind);
  const declarations: ParsedDeclaration[] = [{
    kind: 'module',
    name: path,
    qualifiedName: path,
    startByte: 0,
    endByte: Math.max(1, new TextEncoder().encode(content).byteLength),
    startLine: 1,
    endLine: Math.max(1, content.split('\n').length),
  }];
  const facts: ParsedFact[] = [];
  const scope: string[] = [path];

  const nameOf = (node: ts.Node): string | null => {
    const named = node as ts.NamedDeclaration;
    if (named.name && ts.isIdentifier(named.name)) return named.name.text;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
    return null;
  };

  const visit = (node: ts.Node): void => {
    const kind = declarationKind(node);
    const name = kind ? nameOf(node) : null;
    let pushed = false;
    if (kind && name) {
      const start = node.getStart(file);
      const end = node.getEnd();
      const startPosition = file.getLineAndCharacterOfPosition(start);
      const endPosition = file.getLineAndCharacterOfPosition(end);
      declarations.push({
        kind,
        name,
        qualifiedName: [...scope, name].join('.'),
        startByte: byteOffset(content, start),
        endByte: byteOffset(content, end),
        startLine: startPosition.line + 1,
        endLine: endPosition.line + 1,
        parentQualifiedName: scope.join('.'),
        signature: node.getText(file).split(/\r?\n/, 1)[0]?.slice(0, 240),
      });
      scope.push(name);
      pushed = true;
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      facts.push({
        kind: 'imports',
        subjectQualifiedName: scope.join('.'),
        objectConcept: node.moduleSpecifier.text,
        startByte: byteOffset(content, node.getStart(file)),
        endByte: byteOffset(content, node.getEnd()),
      });
    } else if (ts.isCallExpression(node)) {
      const target = node.expression.getText(file).trim();
      if (target) {
        facts.push({
          kind: 'calls',
          subjectQualifiedName: scope.join('.'),
          objectConcept: target,
          startByte: byteOffset(content, node.getStart(file)),
          endByte: byteOffset(content, node.getEnd()),
        });
      }
    }

    ts.forEachChild(node, visit);
    if (pushed) scope.pop();
  };
  visit(file);
  return { declarations, facts };
}

function externalAnalysis(
  command: string,
  args: string[],
  path: string,
  content: string,
): ParsedSource {
  const result = spawnSync(command, args, {
    input: JSON.stringify({ path, content }),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: command === 'go'
      ? {
          ...process.env,
          GOCACHE: resolve(tmpdir(), 'pipe-go-build-cache'),
          GOTMPDIR: tmpdir(),
        }
      : process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} parser failed for ${path}: ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout) as ParsedSource;
}

function parseSource(path: string, language: string, content: string): {
  parsed: ParsedSource;
  parser: string;
} {
  const normalized = normalizeLanguage(language);
  if (normalized === 'typescript' || normalized === 'javascript') {
    return { parsed: typescriptAnalysis(path, content), parser: 'typescript-compiler-api' };
  }
  if (normalized === 'python') {
    return {
      parsed: externalAnalysis(
        'python3',
        [resolve(helperDir, 'python_ast_helper.py')],
        path,
        content,
      ),
      parser: 'python-ast',
    };
  }
  if (normalized === 'go') {
    return {
      parsed: externalAnalysis(
        'go',
        ['run', resolve(helperDir, 'go_ast_helper.go')],
        path,
        content,
      ),
      parser: 'go-parser',
    };
  }
  return {
    parsed: {
      declarations: [{
        kind: 'module',
        name: path,
        qualifiedName: path,
        startByte: 0,
        endByte: Math.max(1, new TextEncoder().encode(content).byteLength),
        startLine: 1,
        endLine: Math.max(1, content.split('\n').length),
      }],
      facts: [],
    },
    parser: 'structural-file-fallback',
  };
}

export async function analyzeSourceFile(input: {
  repoSnapshotId: string;
  path: string;
  language: string;
  content: string;
  artifact: SourceArtifact;
  artifactVersion: SourceArtifactVersion;
  prSide: SourceSpan['prSide'];
}): Promise<SourceAnalysis> {
  const { parsed, parser } = parseSource(input.path, input.language, input.content);
  const encoded = new TextEncoder().encode(input.content);
  const sourceSpans = new Map<string, SourceSpan>();

  const spanFor = async (startByte: number, endByte: number, label: string): Promise<SourceSpan> => {
    const safeStart = Math.max(0, Math.min(startByte, Math.max(0, encoded.length - 1)));
    const safeEnd = Math.max(
      safeStart + 1,
      Math.min(Math.max(endByte, safeStart + 1), encoded.length),
    );
    const exactText = new TextDecoder().decode(encoded.slice(safeStart, safeEnd));
    const start = positionForByte(input.content, safeStart);
    const end = positionForByte(input.content, safeEnd);
    const span = await buildSourceSpan({
      repoSnapshotId: input.repoSnapshotId,
      artifactId: input.artifact.id,
      artifactVersionId: input.artifactVersion.id,
      contentHash: input.artifactVersion.contentHash,
      start: { byteOffset: safeStart, ...start },
      end: { byteOffset: safeEnd, ...end },
      exactText,
      displayLabel: label,
      prSide: input.prSide,
    });
    sourceSpans.set(span.id, span);
    return span;
  };

  const symbols: RepoSymbol[] = [];
  const symbolsByQualifiedName = new Map<string, RepoSymbol>();
  for (const declaration of parsed.declarations) {
    const span = await spanFor(
      declaration.startByte,
      declaration.endByte,
      `${input.path}:${declaration.startLine}-${declaration.endLine}`,
    );
    const symbol = await buildSymbol({
      repoSnapshotId: input.repoSnapshotId,
      language: input.language,
      qualifiedName: declaration.qualifiedName,
      name: declaration.name,
      kind: declaration.kind,
      signature: declaration.signature,
      containingSymbolId: declaration.parentQualifiedName
        ? symbolsByQualifiedName.get(declaration.parentQualifiedName)?.id
        : undefined,
      definingSpanId: span.id,
      exported: false,
    });
    symbols.push(symbol);
    symbolsByQualifiedName.set(declaration.qualifiedName, symbol);
  }

  const structuralFacts: StructuralFact[] = [];
  for (const fact of parsed.facts) {
    if (!fact.objectConcept.trim()) continue;
    const span = await spanFor(
      fact.startByte,
      fact.endByte,
      `${input.path}:${fact.kind}`,
    );
    structuralFacts.push(await buildStructuralFact({
      repoSnapshotId: input.repoSnapshotId,
      kind: fact.kind,
      subject: {
        symbolId: symbolsByQualifiedName.get(fact.subjectQualifiedName)?.id
          ?? symbols[0]?.id,
      },
      object: { concept: fact.objectConcept },
      sourceSpanIds: [span.id],
      confidence: 1,
      parser,
    }));
  }

  for (const symbol of symbols) {
    if (!symbol.containingSymbolId) continue;
    structuralFacts.push(await buildStructuralFact({
      repoSnapshotId: input.repoSnapshotId,
      kind: 'contains',
      subject: { symbolId: symbol.containingSymbolId },
      object: { symbolId: symbol.id },
      sourceSpanIds: [symbol.definingSpanId],
      confidence: 1,
      parser,
    }));
  }

  return {
    symbols,
    sourceSpans: [...sourceSpans.values()],
    structuralFacts,
    parser,
  };
}
