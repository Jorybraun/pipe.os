export interface MatchableConceptEvidence {
  concept_key: string | null;
  narrative?: string | null;
  exact_text?: string | null;
}

export interface ConceptEvidenceMatch<Row extends MatchableConceptEvidence> {
  row: Row;
  overlapTokens: string[];
  matchKind: 'exact' | 'token_overlap';
}

interface ConceptProfile {
  raw: string;
  normalizedKey: string;
  tokens: Set<string>;
}

const STOP_TOKENS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'async',
  'await',
  'be',
  'been',
  'being',
  'by',
  'can',
  'class',
  'code',
  'const',
  'context',
  'default',
  'do',
  'does',
  'done',
  'export',
  'false',
  'fix',
  'for',
  'from',
  'function',
  'get',
  'has',
  'have',
  'in',
  'is',
  'it',
  'key',
  'like',
  'new',
  'not',
  'null',
  'object',
  'of',
  'on',
  'or',
  'package',
  'packages',
  'proto',
  'prototype',
  'result',
  'return',
  'set',
  'source',
  'src',
  'string',
  'target',
  'test',
  'tests',
  'that',
  'the',
  'this',
  'to',
  'true',
  'type',
  'unknown',
  'value',
  'var',
  'v',
  'view',
  'with',
]);

function stripConceptPrefixes(value: string): string {
  let result = value.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const separatorIndex = result.indexOf(':');
    if (separatorIndex > 0) {
      result = result.slice(separatorIndex + 1);
      changed = true;
    }
  }
  return result;
}

function addToken(tokens: Set<string>, token: string): void {
  const normalized = token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (normalized.length <= 1 || STOP_TOKENS.has(normalized)) return;
  if (/^\d+$/.test(normalized)) return;

  tokens.add(normalized);

  if (normalized.endsWith('s') && normalized.length > 4) {
    const singular = normalized.slice(0, -1);
    if (!STOP_TOKENS.has(singular)) tokens.add(singular);
  }
}

function tokenizeValue(value: string): Set<string> {
  const tokens = new Set<string>();
  const stripped = stripConceptPrefixes(value);
  const camelSpaced = stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2');
  const compact = stripped.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (compact.length > 1) addToken(tokens, compact);

  for (const rawPiece of stripped.split(/[^a-zA-Z0-9]+/)) {
    const pieceCompact = rawPiece.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (pieceCompact.length > 1) addToken(tokens, pieceCompact);
  }

  for (const piece of camelSpaced.split(/[^a-zA-Z0-9]+/)) {
    addToken(tokens, piece);
  }

  return tokens;
}

export function buildConceptProfile(value: string): ConceptProfile {
  const stripped = stripConceptPrefixes(value);
  return {
    raw: value,
    normalizedKey: stripped.toLowerCase(),
    tokens: tokenizeValue(stripped),
  };
}

function buildEvidenceProfile(row: MatchableConceptEvidence): ConceptProfile {
  const tokens = new Set<string>();
  const rawParts = [
    row.concept_key ?? '',
    row.narrative ?? '',
    row.exact_text ?? '',
  ].filter((part) => part.length > 0);

  for (const part of rawParts) {
    for (const token of tokenizeValue(part)) {
      tokens.add(token);
    }
  }

  return {
    raw: rawParts.join(' '),
    normalizedKey: row.concept_key ? stripConceptPrefixes(row.concept_key).toLowerCase() : '',
    tokens,
  };
}

function sortedOverlap(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((token) => right.has(token)).sort();
}

function classifyProfileMatch(
  demand: ConceptProfile,
  evidence: ConceptProfile,
): { matched: boolean; overlapTokens: string[]; matchKind: ConceptEvidenceMatch<MatchableConceptEvidence>['matchKind'] } {
  if (demand.normalizedKey && demand.normalizedKey === evidence.normalizedKey) {
    return { matched: true, overlapTokens: [...demand.tokens].sort(), matchKind: 'exact' };
  }

  const overlapTokens = sortedOverlap(demand.tokens, evidence.tokens);
  if (overlapTokens.length === 0) {
    return { matched: false, overlapTokens, matchKind: 'token_overlap' };
  }

  const demandTokenCount = demand.tokens.size;
  return {
    matched: demandTokenCount > 0 && overlapTokens.length / demandTokenCount >= 0.5,
    overlapTokens,
    matchKind: 'token_overlap',
  };
}

export function findConceptEvidenceMatches<Row extends MatchableConceptEvidence>(
  demandConcept: string,
  evidenceRows: Row[],
): ConceptEvidenceMatch<Row>[] {
  const demandProfile = buildConceptProfile(demandConcept);
  const matches: ConceptEvidenceMatch<Row>[] = [];

  for (const row of evidenceRows) {
    const evidenceProfile = buildEvidenceProfile(row);
    const result = classifyProfileMatch(demandProfile, evidenceProfile);
    if (!result.matched) continue;

    matches.push({
      row,
      overlapTokens: result.overlapTokens,
      matchKind: result.matchKind,
    });
  }

  return matches;
}

function isGeneratedSourceFragment(concept: string): boolean {
  const key = stripConceptPrefixes(concept).toLowerCase();
  return key.startsWith('.changeset')
    || key.startsWith('packages-')
    || key.includes('...')
    || key.includes('-src-')
    || key.includes('-tests-')
    || (key.includes('.') && key !== 'arraybuffer.isview')
    || key.includes('.test.')
    || key.includes('.tsx')
    || key.includes('.ts')
    || key.length > 96;
}

export function scoreableDemandConcepts(concepts: string[]): string[] {
  const conceptsWithTokens = concepts.filter((concept) => buildConceptProfile(concept).tokens.size > 0);
  const conceptsWithoutGeneratedFragments = conceptsWithTokens.filter((concept) =>
    !isGeneratedSourceFragment(concept)
  );
  const candidateConcepts = conceptsWithoutGeneratedFragments.length > 0
    ? conceptsWithoutGeneratedFragments
    : conceptsWithTokens;

  if (candidateConcepts.length <= 12) return candidateConcepts;

  const multiTokenConcepts = candidateConcepts.filter((concept) => {
    const profile = buildConceptProfile(concept);
    return profile.tokens.size >= 2;
  });
  return multiTokenConcepts.length > 0 ? multiTokenConcepts : candidateConcepts;
}
