import type {
  AlignCandidateToChallengeInput,
  CandidateMatchQuery,
  CandidateSignal,
  ChallengeAlignment,
  ChallengeDemand,
  ChallengePacket,
  CompileCandidateMatchInput,
  CompileCandidateMatchResult,
  ConceptAdjacency,
  DemandAlignment,
  EvidenceLevel,
  MatchAssessmentQuality,
  MatchAssessmentQualityMetric,
  MatchExplanation,
  PairScore,
  QueryAtom,
  RecallReviewChallengesInput,
  RecallReviewChallengesResult,
  RecalledChallenge,
  RoleGuardrailSnapshot,
  Seniority,
  RankReviewChallengesResult,
} from './types';

const MAX_QUERY_ATOMS = 12;
const MAX_ATOMS_PER_CONCEPT = 2;
const MAX_ATOMS_PER_EPISODE = 2;
const DEFAULT_RECALL_LIMIT = 300;

const EVIDENCE_RANK: Record<EvidenceLevel, number> = {
  mentioned: 0,
  used: 1,
  explained: 2,
  selected: 3,
  implemented: 4,
  demonstrated: 5,
  validated: 6,
};

const SENIORITY_RANK: Record<Seniority, number> = {
  junior: 0,
  mid: 1,
  senior: 2,
  staff: 3,
  principal: 4,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalized(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

const OPEN_TERM_STOP_SEGMENTS = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'use',
  'type',
  'script',
  'java',
  'root',
  'src',
  'packages',
  'large',
  'component',
  'library',
  'experience',
  'engineer',
  'deep',
  'handling',
  'implemented',
  'designed',
  'validated',
  'comfortable',
  'assessing',
  'state',
]);

function openTermSegments(value: string): string[] {
  const splitCamel = value.replace(/([a-z0-9])([A-Z])/g, '$1-$2');
  return splitCamel
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function addDerivedTerm(terms: Set<string>, value: string): void {
  const normalizedValue = value.trim().toLowerCase().replace(/[^a-z0-9+#]+/g, '-').replace(/^-|-$/g, '');
  if (!normalizedValue || normalizedValue.length < 3) return;
  if (OPEN_TERM_STOP_SEGMENTS.has(normalizedValue)) return;
  terms.add(`term:${normalizedValue}`);
}

function singularSegment(segment: string): string | null {
  if (segment.length <= 3) return null;
  if (segment.endsWith('ies') && segment.length > 4) {
    return `${segment.slice(0, -3)}y`;
  }
  if (segment.endsWith('ses') || segment.endsWith('xes') || segment.endsWith('ches') || segment.endsWith('shes')) {
    return segment.slice(0, -2);
  }
  if (segment.endsWith('s') && !segment.endsWith('ss')) {
    return segment.slice(0, -1);
  }
  return null;
}

function actionStemSegment(segment: string): string | null {
  if (segment.length <= 5) return null;
  if (segment.endsWith('ments')) return segment.slice(0, -5);
  if (segment.endsWith('ment')) return segment.slice(0, -4);
  if (segment.endsWith('ing')) {
    const stem = segment.slice(0, -3);
    return stem.length >= 3 ? stem.replace(/([a-z])\1$/, '$1') : null;
  }
  return null;
}

function segmentVariants(segment: string): string[] {
  const variants = new Set<string>([segment]);
  const singular = singularSegment(segment);
  if (singular) variants.add(singular);
  for (const value of [...variants]) {
    const stem = actionStemSegment(value);
    if (stem) variants.add(stem);
  }
  return [...variants];
}

function expandOpenTermConcept(concept: string): string[] {
  const canonical = concept.trim().toLowerCase();
  if (!canonical.startsWith('term:')) return [canonical];

  const rawValue = canonical.slice('term:'.length);
  const expanded = new Set<string>([canonical]);

  const segments = openTermSegments(rawValue);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const next = segments[index + 1];
    const afterNext = segments[index + 2];
    for (const variant of segmentVariants(segment)) addDerivedTerm(expanded, variant);
    if (segment === 'use' && next && afterNext) {
      addDerivedTerm(expanded, `${segment}-${next}-${afterNext}`);
    }
  }
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index <= segments.length - size; index += 1) {
      const phraseSegments = segments.slice(index, index + size);
      addDerivedTerm(expanded, phraseSegments.join('-'));
      const variantPhrase = phraseSegments.map((segment) => segmentVariants(segment)[0] ?? segment).join('-');
      addDerivedTerm(expanded, variantPhrase);
      const singularPhrase = phraseSegments
        .map((segment) => singularSegment(segment) ?? segment)
        .join('-');
      addDerivedTerm(expanded, singularPhrase);
    }
  }

  return [...expanded];
}

function expandedConcepts(values: string[] | undefined): string[] {
  return normalized(normalized(values).flatMap(expandOpenTermConcept));
}

function nonEmptyString(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasCompleteSourceRefs(refs: QueryAtom['sourceRefs']): boolean {
  return refs.length > 0 && refs.every((ref) =>
    Boolean(ref.artifactId)
    && Boolean(ref.artifactVersion)
    && Boolean(ref.contentHash)
    && nonEmptyString(ref.sourceRefType)
    && nonEmptyString(ref.sourceRefId)
    && nonEmptyString(ref.exactText)
    && Number.isInteger(ref.startOffset)
    && Number.isInteger(ref.endOffset)
    && ref.startOffset >= 0
    && ref.endOffset > ref.startOffset
  );
}

function compareSignals(
  a: CompileCandidateMatchInput['signals'][number],
  b: CompileCandidateMatchInput['signals'][number],
  selectionConcepts: Set<string>,
): number {
  const selectionScore = (signal: CompileCandidateMatchInput['signals'][number]) => {
    const originalConcepts = normalized(signal.concepts);
    if (originalConcepts.length === 0) return 0;
    const exactOverlap = originalConcepts.filter((concept) => selectionConcepts.has(concept)).length;
    const expandedOverlap = expandedConcepts(signal.concepts)
      .filter((concept) => selectionConcepts.has(concept)).length;
    return Math.min(1, Math.max(exactOverlap, expandedOverlap) / originalConcepts.length);
  };
  const specificityScore = (signal: CompileCandidateMatchInput['signals'][number]) => {
    return normalized(signal.concepts).reduce(
      (max, concept) => Math.max(max, conceptSpecificity(concept)),
      0,
    );
  };
  return (
    selectionScore(b) - selectionScore(a)
    || specificityScore(b) - specificityScore(a)
    || Number(Boolean(a.contradicted)) - Number(Boolean(b.contradicted))
    || (b.evidenceLevel == null ? -1 : EVIDENCE_RANK[b.evidenceLevel])
      - (a.evidenceLevel == null ? -1 : EVIDENCE_RANK[a.evidenceLevel])
    || clamp01(b.evidenceStrength ?? 0) - clamp01(a.evidenceStrength ?? 0)
    || clamp01(b.confidence ?? 0) - clamp01(a.confidence ?? 0)
    || a.id.localeCompare(b.id)
    || a.episodeId.localeCompare(b.episodeId)
  );
}

function hasSelectionConceptOverlap(
  signal: CompileCandidateMatchInput['signals'][number],
  selectionConcepts: Set<string>,
): boolean {
  return selectionConcepts.size > 0
    && expandedConcepts(signal.concepts).some((concept) => selectionConcepts.has(concept));
}

function withEpisodeMultipliers(atoms: QueryAtom[]): QueryAtom[] {
  const episodeCounts = new Map<string, number>();
  return atoms.map((atom) => {
    const count = episodeCounts.get(atom.episodeId) ?? 0;
    episodeCounts.set(atom.episodeId, count + 1);
    return {
      ...atom,
      episodeMultiplier: count === 0 ? 1 : count === 1 ? 0.35 : 0,
    };
  });
}

function conceptCapKeys(signal: CandidateSignal): string[] {
  const concepts = [...new Set(normalized(signal.concepts))];
  const idConcept = concepts.find((concept) => signal.id.endsWith(`:${concept}`));
  return idConcept ? [idConcept] : concepts;
}

export function compileCandidateMatchQuery(input: CompileCandidateMatchInput): CompileCandidateMatchResult {
  const excludedSignalIds: string[] = [];
  const recallOnlyAtoms: QueryAtom[] = [];
  const selected: QueryAtom[] = [];
  const episodeCounts = new Map<string, number>();
  const conceptCounts = new Map<string, number>();

  const selectionConcepts = new Set(expandedConcepts(input.selectionConcepts));
  for (const signal of [...input.signals].sort((a, b) => compareSignals(a, b, selectionConcepts))) {
    if (
      !hasCompleteSourceRefs(signal.sourceRefs)
      || signal.contradicted
      || signal.evidenceLevel == null
      || signal.evidenceStrength == null
      || signal.confidence == null
      || clamp01(signal.evidenceStrength) === 0
      || clamp01(signal.confidence) === 0
    ) {
      excludedSignalIds.push(signal.id);
      continue;
    }

    const atom: QueryAtom = {
      ...signal,
      evidenceLevel: signal.evidenceLevel,
      evidenceStrength: signal.evidenceStrength,
      confidence: signal.confidence,
      concepts: expandedConcepts(signal.concepts),
      problems: normalized(signal.problems),
      mechanisms: normalized(signal.mechanisms),
      domains: normalized(signal.domains),
      businessObjects: normalized(signal.businessObjects),
      ownershipActions: normalized(signal.ownershipActions),
      episodeMultiplier: 1,
      recallOnly: signal.evidenceLevel === 'mentioned',
    };

    if (atom.recallOnly) {
      recallOnlyAtoms.push(atom);
      continue;
    }

    if (selected.length >= MAX_QUERY_ATOMS) {
      excludedSignalIds.push(signal.id);
      continue;
    }

    const preserveRoleOverlap = hasSelectionConceptOverlap(signal, selectionConcepts);
    const episodeCount = episodeCounts.get(atom.episodeId) ?? 0;
    const concepts = conceptCapKeys(signal);
    const exceedsConceptCap = concepts.some(
      (concept) => (conceptCounts.get(concept) ?? 0) >= MAX_ATOMS_PER_CONCEPT,
    );
    if (!preserveRoleOverlap && (episodeCount >= MAX_ATOMS_PER_EPISODE || exceedsConceptCap)) {
      excludedSignalIds.push(signal.id);
      continue;
    }

    selected.push(atom);
    episodeCounts.set(atom.episodeId, episodeCount + 1);
    for (const concept of concepts) {
      conceptCounts.set(concept, (conceptCounts.get(concept) ?? 0) + 1);
    }
  }

  const weighted = withEpisodeMultipliers(selected);
  const query: CandidateMatchQuery = {
    candidateSnapshotId: input.candidateSnapshotId,
    roleSnapshotId: input.roleSnapshotId,
    policyVersion: 'candidate-pr-v1',
    validationAtoms: weighted.filter((atom) => atom.purpose === 'validation'),
    deepeningAtoms: weighted.filter((atom) => atom.purpose === 'deepening'),
    recallOnlyAtoms: recallOnlyAtoms.sort((a, b) => a.id.localeCompare(b.id)),
    roleGuardrails: {
      ...input.roleGuardrails,
      requiredLanguages: normalized(input.roleGuardrails.requiredLanguages),
      forbiddenLanguages: normalized(input.roleGuardrails.forbiddenLanguages),
      relevantConcepts: normalized(input.roleGuardrails.relevantConcepts),
      genericConcepts: normalized(input.roleGuardrails.genericConcepts),
      requiredConcepts: normalized(input.roleGuardrails.requiredConcepts),
      forbiddenConcepts: normalized(input.roleGuardrails.forbiddenConcepts),
    },
    maxAdjacentStretches: 1,
  };

  return {
    status: weighted.length === 0 ? 'NEEDS_MORE_EVIDENCE' : 'READY',
    query,
    excludedSignalIds: excludedSignalIds.sort(),
  };
}

function intersects(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = new Set(normalized(a));
  return normalized(b).some((value) => left.has(value));
}

function intersectionRatio(a: string[] | undefined, b: string[] | undefined): number {
  const left = normalized(a);
  const right = normalized(b);
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const overlap = left.filter((value) => rightSet.has(value)).length;
  return overlap / Math.max(left.length, right.length);
}

function containmentRatio(a: string[] | undefined, b: string[] | undefined): number {
  const left = normalized(a);
  const right = normalized(b);
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const overlap = left.filter((value) => rightSet.has(value)).length;
  return overlap / Math.min(left.length, right.length);
}

function cosine(a: number[] | undefined, b: number[] | undefined): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    const av = a[index]!;
    const bv = b[index]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return clamp01((dot / (Math.sqrt(normA) * Math.sqrt(normB)) + 1) / 2);
}

function semanticSimilarity(atom: QueryAtom, demand: ChallengeDemand): number | null {
  return cosine(atom.embedding, demand.embedding);
}

function hasComparableEmbeddings(atom: QueryAtom, demand: ChallengeDemand): boolean {
  return Boolean(
    atom.embedding
    && demand.embedding
    && atom.embedding.length > 0
    && atom.embedding.length === demand.embedding.length,
  );
}

function findStretch(
  atom: QueryAtom,
  demand: ChallengeDemand,
  adjacency: ConceptAdjacency[],
): DemandAlignment['stretch'] | undefined {
  const atomConcepts = normalized([
    ...atom.concepts,
    ...(atom.problems ?? []).map((value) => `problem:${value}`),
    ...(atom.mechanisms ?? []).map((value) => `mechanism:${value}`),
  ]);
  const demandConcepts = normalized([
    ...demand.concepts,
    ...(demand.problems ?? []).map((value) => `problem:${value}`),
    ...(demand.mechanisms ?? []).map((value) => `mechanism:${value}`),
  ]);
  const candidates = adjacency
    .flatMap((edge) => {
      if (edge.stretchAllowed === false) return [];
      const from = edge.from.toLowerCase();
      const to = edge.to.toLowerCase();
      if (atomConcepts.includes(from) && demandConcepts.includes(to)) {
        return [{ atomConcept: from, demandConcept: to, dimension: edge.dimension }];
      }
      if (atomConcepts.includes(to) && demandConcepts.includes(from)) {
        return [{ atomConcept: to, demandConcept: from, dimension: edge.dimension }];
      }
      return [];
    })
    .sort((a, b) =>
      a.dimension.localeCompare(b.dimension)
      || a.atomConcept.localeCompare(b.atomConcept)
      || a.demandConcept.localeCompare(b.demandConcept)
    );
  return candidates[0];
}

function hasDirectSemanticGate(atom: QueryAtom, demand: ChallengeDemand): boolean {
  return intersects(atom.concepts, demand.concepts)
    || intersects(atom.problems, demand.problems)
    || intersects(atom.mechanisms, demand.mechanisms);
}

function conceptSpecificity(concept: string): number {
  const raw = concept.includes(':') ? concept.slice(concept.indexOf(':') + 1) : concept;
  return raw
    .split(/[^a-z0-9+#.]+/i)
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length >= 3 && !OPEN_TERM_STOP_SEGMENTS.has(segment))
    .length;
}

function sharedConceptSpecificity(atom: QueryAtom, demand: ChallengeDemand): number {
  const demandConcepts = new Set(normalized(demand.concepts));
  return normalized(atom.concepts)
    .filter((concept) => demandConcepts.has(concept))
    .reduce((max, concept) => Math.max(max, conceptSpecificity(concept)), 0);
}

function primaryAtomConcept(atom: QueryAtom): string | null {
  const atomId = atom.id.trim().toLowerCase();
  return normalized(atom.concepts).find((concept) => atomId.endsWith(`:${concept}`)) ?? null;
}

function sourceBackedConceptCorrespondenceFloor(atom: QueryAtom, demand: ChallengeDemand): number {
  if (!hasCompleteSourceRefs(atom.sourceRefs) || !hasCompleteSourceRefs(demand.sourceRefs)) return 0;
  const demandConcepts = new Set(normalized(demand.concepts));
  const primaryConcept = primaryAtomConcept(atom);
  if (primaryConcept && !demandConcepts.has(primaryConcept)) return 0;
  const specificity = primaryConcept ? conceptSpecificity(primaryConcept) : sharedConceptSpecificity(atom, demand);
  if (specificity >= 3) return 0.45;
  if (specificity >= 2) return 0.32;
  return 0;
}

function scorePair(
  atom: QueryAtom,
  demand: ChallengeDemand,
  adjacency: ConceptAdjacency[],
): { score: PairScore; stretch?: DemandAlignment['stretch'] } | null {
  const direct = hasDirectSemanticGate(atom, demand);
  const stretch = direct ? undefined : findStretch(atom, demand, adjacency);
  if (!direct && !stretch) return null;

  const semanticNarrative = semanticSimilarity(atom, demand);
  const pairScore: PairScore = {
    semanticNarrative: semanticNarrative ?? 0,
    conceptCorrespondence: Math.max(
      containmentRatio(atom.concepts, demand.concepts),
      direct ? sourceBackedConceptCorrespondenceFloor(atom, demand) : 0,
    ),
    problemMechanismCorrespondence: Math.max(
      intersectionRatio(atom.problems, demand.problems),
      intersectionRatio(atom.mechanisms, demand.mechanisms),
    ),
    domainBusinessContext: Math.max(
      intersectionRatio(atom.domains, demand.domains),
      intersectionRatio(atom.businessObjects, demand.businessObjects),
    ),
    ownershipActionCorrespondence: intersectionRatio(atom.ownershipActions, demand.ownershipActions),
    total: 0,
  };
  if (stretch) {
    if (stretch.dimension === 'technology') pairScore.conceptCorrespondence = Math.max(pairScore.conceptCorrespondence, 0.6);
    if (stretch.dimension === 'mechanism') pairScore.problemMechanismCorrespondence = Math.max(pairScore.problemMechanismCorrespondence, 0.6);
    if (stretch.dimension === 'domain') pairScore.domainBusinessContext = Math.max(pairScore.domainBusinessContext, 0.6);
    if (stretch.dimension === 'review_practice') pairScore.ownershipActionCorrespondence = Math.max(pairScore.ownershipActionCorrespondence, 0.6);
  }
  const semanticAvailable = hasComparableEmbeddings(atom, demand);
  const dimensions = [
    { score: pairScore.semanticNarrative, weight: 0.15, available: semanticAvailable },
    {
      score: pairScore.conceptCorrespondence,
      weight: 0.35,
      available: atom.concepts.length > 0 && demand.concepts.length > 0,
    },
    {
      score: pairScore.problemMechanismCorrespondence,
      weight: 0.25,
      available:
        (atom.problems?.length ?? 0) + (atom.mechanisms?.length ?? 0) > 0
        && (demand.problems?.length ?? 0) + (demand.mechanisms?.length ?? 0) > 0,
    },
    {
      score: pairScore.domainBusinessContext,
      weight: 0.15,
      available:
        (atom.domains?.length ?? 0) + (atom.businessObjects?.length ?? 0) > 0
        && (demand.domains?.length ?? 0) + (demand.businessObjects?.length ?? 0) > 0,
    },
    {
      score: pairScore.ownershipActionCorrespondence,
      weight: 0.10,
      available:
        (atom.ownershipActions?.length ?? 0) > 0
        && (demand.ownershipActions?.length ?? 0) > 0,
    },
  ].filter((dimension) => dimension.available);
  const availableWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  pairScore.total = availableWeight === 0
    ? 0
    : clamp01(
        dimensions.reduce(
          (sum, dimension) => sum + dimension.score * dimension.weight,
          0,
        ) / availableWeight,
      );
  return { score: pairScore, stretch };
}

function challengePassesGuardrails(challenge: ChallengePacket, guardrails: RoleGuardrailSnapshot): boolean {
  const languages = normalized(challenge.languages);
  const concepts = normalized(challenge.concepts);
  if (!challenge.challengeReady) return false;
  if (guardrails.requiredLanguages.some((language) => !languages.includes(language))) return false;
  if (normalized(guardrails.forbiddenLanguages).some((language) => languages.includes(language))) return false;
  if (normalized(guardrails.requiredConcepts).some((concept) => !concepts.includes(concept))) return false;
  if (normalized(guardrails.forbiddenConcepts).some((concept) => concepts.includes(concept))) return false;
  if (
    guardrails.minimumSeniority
    && challenge.seniority
    && SENIORITY_RANK[challenge.seniority] < SENIORITY_RANK[guardrails.minimumSeniority]
  ) return false;
  return true;
}

function allQueryAtoms(query: CandidateMatchQuery, includeRecallOnly = false): QueryAtom[] {
  const atoms = [...query.validationAtoms, ...query.deepeningAtoms];
  if (includeRecallOnly) atoms.push(...query.recallOnlyAtoms);
  return atoms.sort((a, b) => a.id.localeCompare(b.id));
}

export function recallReviewChallenges(input: RecallReviewChallengesInput): RecallReviewChallengesResult {
  const scoringAtoms = allQueryAtoms(input.query);
  if (scoringAtoms.length === 0) {
    return { status: 'NEEDS_MORE_EVIDENCE', challenges: [], excludedChallengeIds: [] };
  }

  const adjacency = input.adjacency ?? [];
  const recallAtoms = allQueryAtoms(input.query, true);
  const excludedChallengeIds: string[] = [];
  const recalled: RecalledChallenge[] = [];

  for (const challenge of [...input.challenges].sort((a, b) =>
    a.repoId.localeCompare(b.repoId) || a.prNumber - b.prNumber || a.id.localeCompare(b.id)
  )) {
    if (!challengePassesGuardrails(challenge, input.query.roleGuardrails)) {
      excludedChallengeIds.push(challenge.id);
      continue;
    }

    const matchedAtoms = new Map<string, number>();
    for (const atom of recallAtoms) {
      let best = 0;
      for (const demand of challenge.demands) {
        const pair = scorePair(atom, demand, adjacency);
        if (pair) best = Math.max(best, pair.score.total);
      }
      if (best > 0) matchedAtoms.set(atom.id, best);
    }
    if (matchedAtoms.size === 0) continue;
    const recallScore = [...matchedAtoms.values()].reduce((sum, value) => sum + value, 0) / matchedAtoms.size;
    recalled.push({
      challenge,
      recallScore,
      matchedAtomIds: [...matchedAtoms.keys()].sort(),
    });
  }

  recalled.sort((a, b) =>
    b.recallScore - a.recallScore
    || a.challenge.repoId.localeCompare(b.challenge.repoId)
    || a.challenge.prNumber - b.challenge.prNumber
    || a.challenge.id.localeCompare(b.challenge.id)
  );
  const limited = recalled.slice(0, input.limit ?? DEFAULT_RECALL_LIMIT);
  return {
    status: limited.length > 0 ? 'READY' : 'NO_ROLE_SAFE_CHALLENGE',
    challenges: limited,
    excludedChallengeIds: excludedChallengeIds.sort(),
  };
}

interface AssignmentState {
  score: number;
  specificity: number;
  pairs: Array<{ atomIndex: number; demandIndex: number; pair: NonNullable<ReturnType<typeof scorePair>> }>;
  signature: string;
}

function betterAssignment(candidate: AssignmentState, current: AssignmentState | undefined): boolean {
  if (!current) return true;
  if (Math.abs(candidate.score - current.score) > 1e-12) return candidate.score > current.score;
  if (Math.abs(candidate.specificity - current.specificity) > 1e-12) {
    return candidate.specificity > current.specificity;
  }
  return candidate.signature < current.signature;
}

function maximumWeightAssignment(
  atoms: QueryAtom[],
  demands: ChallengeDemand[],
  adjacency: ConceptAdjacency[],
): AssignmentState {
  let states = new Map<number, AssignmentState>([
    [0, { score: 0, specificity: 0, pairs: [], signature: '' }],
  ]);

  for (let demandIndex = 0; demandIndex < demands.length; demandIndex++) {
    const demand = demands[demandIndex]!;
    const next = new Map(states);
    for (const [mask, state] of states) {
      for (let atomIndex = 0; atomIndex < atoms.length; atomIndex++) {
        const bit = 1 << atomIndex;
        if ((mask & bit) !== 0) continue;
        const atom = atoms[atomIndex]!;
        const pair = scorePair(atom, demand, adjacency);
        if (!pair) continue;
        const weighted = pair.score.total
          * clamp01(demand.weight)
          * clamp01(atom.evidenceStrength)
          * clamp01(atom.confidence)
          * atom.episodeMultiplier;
        if (weighted <= 0) continue;
        const pairs = [...state.pairs, { atomIndex, demandIndex, pair }];
        const signature = pairs
          .map((entry) => `${demands[entry.demandIndex]!.id}:${atoms[entry.atomIndex]!.id}`)
          .join('|');
        const candidate: AssignmentState = {
          score: state.score + weighted,
          specificity: state.specificity + sharedConceptSpecificity(atom, demand) * weighted,
          pairs,
          signature,
        };
        const nextMask = mask | bit;
        if (betterAssignment(candidate, next.get(nextMask))) next.set(nextMask, candidate);
      }
    }
    states = next;
  }

  let best: AssignmentState = { score: 0, specificity: 0, pairs: [], signature: '' };
  for (const state of states.values()) {
    if (betterAssignment(state, best)) best = state;
  }
  return best;
}

function nonGenericAlignment(
  alignment: DemandAlignment,
  genericConcepts: string[] | undefined,
): boolean {
  const direct = normalized(alignment.atom.concepts)
    .filter((concept) => normalized(alignment.demand.concepts).includes(concept));
  const generic = new Set(normalized(genericConcepts));
  if (direct.some((concept) => !generic.has(concept))) return true;
  return intersects(alignment.atom.problems, alignment.demand.problems)
    || intersects(alignment.atom.mechanisms, alignment.demand.mechanisms)
    || intersects(alignment.atom.domains, alignment.demand.domains)
    || intersects(alignment.atom.businessObjects, alignment.demand.businessObjects);
}

function sourceBackedSparseAlignment(input: {
  alignments: DemandAlignment[];
  candidateEvidenceAlignment: number;
  challengeQuality: number;
  contextualSpecificity: number;
  hasRoleRequirements: boolean;
  roleRelevance: number;
  hasNonGenericAlignment: boolean;
  provenanceComplete: boolean;
  stretchCount: number;
}): boolean {
  const candidateSourceCount = uniqueSourceRefCount(
    input.alignments.flatMap((entry) => entry.atom.sourceRefs),
  );
  const repoSourceCount = uniqueSourceRefCount(
    input.alignments.flatMap((entry) => entry.demand.sourceRefs),
  );
  const directExactFloorPasses = input.candidateEvidenceAlignment >= 0.10;
  const sparseMultiSpanFloorPasses = input.candidateEvidenceAlignment >= 0.07
    && input.alignments.length >= 2
    && candidateSourceCount >= 2
    && repoSourceCount >= 1;
  const denseRoleBackedFloorPasses = input.candidateEvidenceAlignment >= 0.035
    && input.alignments.length >= 5
    && candidateSourceCount >= 5
    && repoSourceCount >= 5
    && input.roleRelevance >= 0.75;
  const roleGatePasses = !input.hasRoleRequirements
    || (
      input.roleRelevance >= 0.60
      && input.alignments.length >= 2
    );
  return roleGatePasses
    && input.alignments.length > 0
    && repoSourceCount >= 1
    && (directExactFloorPasses || sparseMultiSpanFloorPasses || denseRoleBackedFloorPasses)
    && input.challengeQuality >= 0.85
    && input.contextualSpecificity >= 0.75
    && input.hasNonGenericAlignment
    && input.provenanceComplete
    && input.stretchCount === 0;
}

function weightedCoverage(
  alignments: DemandAlignment[],
  demands: ChallengeDemand[],
  predicate: (demand: ChallengeDemand) => boolean,
): number {
  const relevant = alignments.filter((entry) => predicate(entry.demand));
  const denominator = demands
    .filter(predicate)
    .reduce((sum, demand) => sum + clamp01(demand.weight), 0);
  if (denominator === 0) return 0;
  return clamp01(
    relevant.reduce(
      (sum, entry) => sum + entry.pairScore.total * clamp01(entry.demand.weight) * entry.atom.episodeMultiplier,
      0,
    ) / denominator,
  );
}

export function alignCandidateToChallenge(input: AlignCandidateToChallengeInput): ChallengeAlignment {
  const atoms = allQueryAtoms(input.query);
  const demands = [...input.challenge.demands].sort((a, b) => a.id.localeCompare(b.id));
  const assignment = maximumWeightAssignment(atoms, demands, input.adjacency ?? []);
  const alignments: DemandAlignment[] = assignment.pairs.map(({ atomIndex, demandIndex, pair }) => {
    const atom = atoms[atomIndex]!;
    const demand = demands[demandIndex]!;
    return {
      atom,
      demand,
      pairScore: pair.score,
      weightedScore: pair.score.total
        * clamp01(demand.weight)
        * clamp01(atom.evidenceStrength)
        * clamp01(atom.confidence)
        * atom.episodeMultiplier,
      stretch: pair.stretch,
    };
  }).sort((a, b) => a.demand.id.localeCompare(b.demand.id) || a.atom.id.localeCompare(b.atom.id));

  const totalDemandWeight = demands.reduce((sum, demand) => sum + clamp01(demand.weight), 0);
  const hasRoleRequirements = demands.some((demand) => demand.roleRequirement);
  const hasHighWeightRoleRequirements = demands.some((demand) => demand.highWeightRoleRequirement);
  const candidateEvidenceAlignment = totalDemandWeight === 0
    ? 0
    : clamp01(alignments.reduce((sum, entry) => sum + entry.weightedScore, 0) / totalDemandWeight);
  const candidateRoleCoverage = weightedCoverage(
    alignments,
    demands,
    (demand) => Boolean(demand.roleRequirement),
  );
  const roleDemandCoverage = totalDemandWeight === 0
    ? 0
    : clamp01(
        demands
          .filter((demand) => Boolean(demand.roleRequirement))
          .reduce((sum, demand) => sum + clamp01(demand.weight), 0) / totalDemandWeight,
      );
  const roleRelevance = hasRoleRequirements
    ? Math.max(candidateRoleCoverage, roleDemandCoverage)
    : candidateRoleCoverage;
  const contextualSpecificity = clamp01(input.challenge.quality.contextualSpecificity);
  const challengeQuality = clamp01(input.challenge.quality.deterministic);
  const validationWeight = alignments
    .filter((entry) => entry.atom.purpose === 'validation')
    .reduce((sum, entry) => sum + entry.weightedScore, 0);
  const deepeningWeight = alignments
    .filter((entry) => entry.atom.purpose === 'deepening')
    .reduce((sum, entry) => sum + entry.weightedScore, 0);
  const validationDeepeningValue = clamp01(
    candidateEvidenceAlignment === 0
      ? 0
      : Math.min(1, validationWeight + deepeningWeight * 1.1) / Math.max(totalDemandWeight, 1),
  );
  const stretches = alignments.filter((entry) => entry.stretch);
  const stretchDemandWeight = stretches.reduce((sum, entry) => sum + clamp01(entry.demand.weight), 0);
  const stretchDemandWeightRatio = totalDemandWeight === 0 ? 0 : stretchDemandWeight / totalDemandWeight;
  const provenanceComplete = alignments.length > 0 && alignments.every(
    (entry) => hasCompleteSourceRefs(entry.atom.sourceRefs) && hasCompleteSourceRefs(entry.demand.sourceRefs),
  );
  const demandFamilies = new Set(alignments.map((entry) => entry.demand.family));
  const hasNonGeneric = alignments.some((alignment) =>
    nonGenericAlignment(alignment, input.query.roleGuardrails.genericConcepts)
  );
  const hasHighWeightRoleRequirement = alignments.some((entry) => entry.demand.highWeightRoleRequirement);
  const finalScore = clamp01(
    candidateEvidenceAlignment * 0.40
    + roleRelevance * 0.20
    + contextualSpecificity * 0.15
    + challengeQuality * 0.15
    + validationDeepeningValue * 0.10,
  );

  const candidateAlignmentThreshold = hasRoleRequirements ? 0.50 : 0.45;
  const exactSourceBackedSparse = sourceBackedSparseAlignment({
    alignments,
    candidateEvidenceAlignment,
    challengeQuality,
    contextualSpecificity,
    hasRoleRequirements,
    roleRelevance,
    hasNonGenericAlignment: hasNonGeneric,
    provenanceComplete,
    stretchCount: stretches.length,
  });
  const rejectionReasons: string[] = [];
  if (!challengePassesGuardrails(input.challenge, input.query.roleGuardrails)) rejectionReasons.push('ROLE_GUARDRAIL_FAILED');
  if (candidateEvidenceAlignment < candidateAlignmentThreshold && !exactSourceBackedSparse) {
    rejectionReasons.push('CANDIDATE_ALIGNMENT_BELOW_THRESHOLD');
  }
  if (hasRoleRequirements && roleRelevance < 0.60) rejectionReasons.push('ROLE_RELEVANCE_BELOW_THRESHOLD');
  if (challengeQuality < 0.70) rejectionReasons.push('CHALLENGE_QUALITY_BELOW_THRESHOLD');
  if (demandFamilies.size < 2 && !exactSourceBackedSparse) rejectionReasons.push('INSUFFICIENT_DEMAND_FAMILIES');
  if (!hasNonGeneric) rejectionReasons.push('NO_NON_GENERIC_ALIGNMENT');
  if (hasHighWeightRoleRequirements && !hasHighWeightRoleRequirement) rejectionReasons.push('NO_HIGH_WEIGHT_ROLE_REQUIREMENT');
  if (!provenanceComplete) rejectionReasons.push('INCOMPLETE_PROVENANCE');
  if (stretches.length > input.query.maxAdjacentStretches) rejectionReasons.push('TOO_MANY_STRETCHES');
  if (stretchDemandWeightRatio > 0.20 + 1e-12) rejectionReasons.push('STRETCH_WEIGHT_EXCEEDED');

  return {
    challenge: input.challenge,
    alignments,
    unmatchedDemandIds: demands
      .filter((demand) => !alignments.some((entry) => entry.demand.id === demand.id))
      .map((demand) => demand.id),
    candidateEvidenceAlignment,
    roleRelevance,
    contextualSpecificity,
    challengeQuality,
    validationDeepeningValue,
    finalScore,
    stretchCount: stretches.length,
    stretchDemandWeightRatio,
    hasNonGenericAlignment: hasNonGeneric,
    hasHighWeightRoleRequirement,
    provenanceComplete,
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
  };
}

export function rankReviewChallenges(
  query: CandidateMatchQuery,
  alignments: ChallengeAlignment[],
): RankReviewChallengesResult {
  if (allQueryAtoms(query).length === 0) return { status: 'NEEDS_MORE_EVIDENCE', matches: [] };
  const selectionFitScore = (alignment: ChallengeAlignment): number => {
    const hasRoleRequirements = alignment.challenge.demands.some((demand) => demand.roleRequirement);
    return hasRoleRequirements
      ? clamp01(
          alignment.candidateEvidenceAlignment * 0.45
          + alignment.roleRelevance * 0.40
          + alignment.validationDeepeningValue * 0.15,
        )
      : clamp01(
          alignment.candidateEvidenceAlignment * 0.80
          + alignment.validationDeepeningValue * 0.20,
        );
  };
  const eligible = alignments
    .filter((alignment) => alignment.eligible)
    .sort((a, b) =>
      selectionFitScore(b) - selectionFitScore(a)
      || b.candidateEvidenceAlignment - a.candidateEvidenceAlignment
      || b.roleRelevance - a.roleRelevance
      || b.finalScore - a.finalScore
      || b.challengeQuality - a.challengeQuality
      || a.challenge.repoId.localeCompare(b.challenge.repoId)
      || a.challenge.prNumber - b.challenge.prNumber
      || a.challenge.id.localeCompare(b.challenge.id)
    );
  return {
    status: eligible.length > 0 ? 'MATCHED' : 'NO_ROLE_SAFE_CHALLENGE',
    matches: eligible.map((alignment, index) => ({ rank: index + 1, alignment })),
  };
}

function percent(value: number): string {
  return `${roundedPercent(value)}%`;
}

function roundedPercent(value: number): number {
  return Math.round(clamp01(value) * 100);
}

function scoreBand(value: number, strongThreshold: number, usableThreshold: number): 0 | 1 | 2 {
  if (value >= strongThreshold) return 2;
  if (value >= usableThreshold) return 1;
  return 0;
}

function sourceRefKey(ref: QueryAtom['sourceRefs'][number]): string {
  return [
    ref.sourceRefType ?? '',
    ref.sourceRefId ?? '',
    ref.sourceSpanId ?? '',
    ref.contentHash,
    ref.locator ?? '',
    ref.exactText ?? '',
  ].join('|');
}

function uniqueSourceRefCount(refs: QueryAtom['sourceRefs']): number {
  return new Set(refs.map(sourceRefKey)).size;
}

function assessmentQualityVerdict(
  metrics: MatchAssessmentQualityMetric[],
  options: { contrastMeasured: boolean },
): MatchAssessmentQuality['verdict'] {
  const score = metrics.reduce((sum, metric) => sum + metric.score, 0);
  const coreMetricFailed = metrics.some((metric) =>
    metric.id !== 'contrast_separation' && metric.score === 0
  );
  const contrastMetric = metrics.find((metric) => metric.id === 'contrast_separation');
  const measuredNearTie = options.contrastMeasured && contrastMetric?.score === 0;
  if (!coreMetricFailed && !measuredNearTie && score >= 10) return 'STRONG';
  if (!coreMetricFailed && score >= 7) return 'USABLE';
  return 'WEAK';
}

function buildAssessmentQuality(
  alignment: ChallengeAlignment,
  scoreSeparation?: number | null,
): MatchAssessmentQuality {
  const candidateSourceCount = uniqueSourceRefCount(
    alignment.alignments.flatMap((entry) => entry.atom.sourceRefs),
  );
  const repoSourceCount = uniqueSourceRefCount(
    alignment.alignments.flatMap((entry) => entry.demand.sourceRefs),
  );
  const demandFamilies = new Set(alignment.alignments.map((entry) => entry.demand.family));
  const hasRoleRequirements = alignment.challenge.demands.some((demand) => demand.roleRequirement);
  const separation = typeof scoreSeparation === 'number' && Number.isFinite(scoreSeparation)
    ? Math.max(0, scoreSeparation)
    : null;
  const roundedSeparationPercent = separation === null ? null : roundedPercent(separation);
  const candidateStrongThreshold = hasRoleRequirements ? 0.75 : 0.60;
  const candidateUsableThreshold = hasRoleRequirements ? 0.50 : 0.45;
  const exactSourceBackedSparse = sourceBackedSparseAlignment({
    alignments: alignment.alignments,
    candidateEvidenceAlignment: alignment.candidateEvidenceAlignment,
    challengeQuality: alignment.challengeQuality,
    contextualSpecificity: alignment.contextualSpecificity,
    hasRoleRequirements,
    roleRelevance: alignment.roleRelevance,
    hasNonGenericAlignment: alignment.hasNonGenericAlignment,
    provenanceComplete: alignment.provenanceComplete,
    stretchCount: alignment.stretchCount,
  });
  const candidateOverlapScore = scoreBand(
    alignment.candidateEvidenceAlignment,
    candidateStrongThreshold,
    candidateUsableThreshold,
  );

  const metrics: MatchAssessmentQualityMetric[] = [
    {
      id: 'skill_stack_overlap',
      label: 'Skill/stack overlap',
      score: candidateOverlapScore === 0 && exactSourceBackedSparse ? 1 : candidateOverlapScore,
      maxScore: 2,
      reason: exactSourceBackedSparse && candidateOverlapScore === 0
        ? `Candidate source evidence covers ${percent(alignment.candidateEvidenceAlignment)} of the selected PR demand weight, with exact source-backed symbol overlap.`
        : `Candidate source evidence covers ${percent(alignment.candidateEvidenceAlignment)} of the selected PR demand weight.`,
    },
    {
      id: 'role_demand_overlap',
      label: 'Role/JD overlap',
      score: hasRoleRequirements
        ? scoreBand(alignment.roleRelevance, 0.75, 0.60)
        : 1,
      maxScore: 2,
      reason: hasRoleRequirements
        ? `Role-backed demands cover ${percent(alignment.roleRelevance)} of the selected challenge.`
        : 'No role/JD source was supplied, so the match is evaluated as a roleless standalone assessment.',
    },
    {
      id: 'pr_reviewability',
      label: 'PR reviewability',
      score: alignment.challengeQuality >= 0.85 && (demandFamilies.size >= 2 || exactSourceBackedSparse)
        ? 2
        : alignment.challengeQuality >= 0.70 && demandFamilies.size >= 1
          ? 1
          : 0,
      maxScore: 2,
      reason: `${demandFamilies.size} source-backed demand famil${demandFamilies.size === 1 ? 'y' : 'ies'} and ${percent(alignment.challengeQuality)} deterministic challenge quality.`,
    },
    {
      id: 'match_specificity',
      label: 'Match specificity',
      score: alignment.contextualSpecificity >= 0.75 && alignment.hasNonGenericAlignment
        ? 2
        : alignment.contextualSpecificity >= 0.55 || alignment.hasNonGenericAlignment
          ? 1
          : 0,
      maxScore: 2,
      reason: alignment.hasNonGenericAlignment
        ? `The match uses non-generic evidence with ${percent(alignment.contextualSpecificity)} contextual specificity.`
        : `The match relies on generic concepts with ${percent(alignment.contextualSpecificity)} contextual specificity.`,
    },
    {
      id: 'source_coverage',
      label: 'Source coverage',
      score: alignment.provenanceComplete && candidateSourceCount > 0 && repoSourceCount > 0
        ? 2
        : candidateSourceCount > 0 || repoSourceCount > 0
          ? 1
          : 0,
      maxScore: 2,
      reason: `${candidateSourceCount} candidate source span(s) and ${repoSourceCount} repo source span(s) support the selected challenge.`,
    },
    {
      id: 'contrast_separation',
      label: 'Contrast separation',
      score: roundedSeparationPercent === null
        ? 0
        : roundedSeparationPercent >= 8
          ? 2
          : roundedSeparationPercent >= 2
            ? 1
            : 0,
      maxScore: 2,
      reason: separation === null
        ? 'No second eligible challenge was available in this explanation context, so score separation was not measured.'
        : `The selected challenge leads the next comparable challenge by ${percent(separation)}.`,
    },
  ];
  return {
    verdict: assessmentQualityVerdict(metrics, { contrastMeasured: separation !== null }),
    score: metrics.reduce((sum, metric) => sum + metric.score, 0),
    maxScore: 12,
    metrics,
  };
}

type ExplainChallengeMatchContext = Partial<Pick<
  MatchExplanation,
  'rejectedPackets' | 'missingEvidence' | 'roleSources'
>> & {
  scoreSeparation?: number | null;
};

export function explainChallengeMatch(
  alignment: ChallengeAlignment,
  context: ExplainChallengeMatchContext = {
    rejectedPackets: [],
    missingEvidence: [],
    roleSources: [],
  },
): MatchExplanation {
  const status = alignment.eligible ? 'MATCHED' : 'NO_ROLE_SAFE_CHALLENGE';
  const directCount = alignment.alignments.length - alignment.stretchCount;
  const summary = alignment.eligible
    ? `Matched ${alignment.alignments.length} source-backed demands (${directCount} direct, ${alignment.stretchCount} adjacent stretch).`
    : `Challenge rejected: ${alignment.rejectionReasons.join(', ') || 'no eligible source-backed alignment'}.`;
  const alignmentMissingEvidence: MatchExplanation['missingEvidence'] = [
    ...alignment.unmatchedDemandIds.map((demandId) => ({
      scope: 'candidate' as const,
      reason: 'NO_SOURCE_BACKED_CANDIDATE_ALIGNMENT',
      challengeId: alignment.challenge.id,
      demandId,
      sourceRefs: alignment.challenge.demands.find((demand) => demand.id === demandId)?.sourceRefs ?? [],
    })),
    ...(
      alignment.provenanceComplete
        ? []
        : [{
            scope: 'challenge' as const,
            reason: 'INCOMPLETE_PROVENANCE',
            challengeId: alignment.challenge.id,
          }]
    ),
  ];
  const evidence = alignment.alignments.map((entry) => ({
    atomId: entry.atom.id,
    demandId: entry.demand.id,
    purpose: entry.atom.purpose,
    pairScore: entry.pairScore.total,
    episodeMultiplier: entry.atom.episodeMultiplier,
    stretch: entry.stretch,
    roleSourceRefs: [],
    candidateSourceRefs: entry.atom.sourceRefs,
    challengeSourceRefs: entry.demand.sourceRefs,
  }));
  return {
    status,
    challengeId: alignment.challenge.id,
    repoId: alignment.challenge.repoId,
    prNumber: alignment.challenge.prNumber,
    selectedPr: alignment.eligible
      ? {
          challengeId: alignment.challenge.id,
          repoId: alignment.challenge.repoId,
          prNumber: alignment.challenge.prNumber,
          sourceVersion: alignment.challenge.sourceVersion,
        }
      : undefined,
    score: alignment.finalScore,
    summary,
    assessmentQuality: buildAssessmentQuality(alignment, context.scoreSeparation),
    evidence,
    candidateSpans: evidence.map((entry) => ({
      atomId: entry.atomId,
      demandId: entry.demandId,
      purpose: entry.purpose,
      sourceRefs: entry.candidateSourceRefs,
    })),
    repoSpans: evidence.map((entry) => ({
      atomId: entry.atomId,
      demandId: entry.demandId,
      sourceRefs: entry.challengeSourceRefs,
    })),
    roleSources: context.roleSources ?? [],
    rejectedPackets: context.rejectedPackets ?? [],
    missingEvidence: [...alignmentMissingEvidence, ...(context.missingEvidence ?? [])],
    stretchAreas: alignment.alignments.flatMap((entry) =>
      entry.stretch
        ? [{
            atomId: entry.atom.id,
            demandId: entry.demand.id,
            atomConcept: entry.stretch.atomConcept,
            demandConcept: entry.stretch.demandConcept,
            dimension: entry.stretch.dimension,
            candidateSourceRefs: entry.atom.sourceRefs,
            challengeSourceRefs: entry.demand.sourceRefs,
          }]
        : []
    ),
    unmatchedDemandIds: alignment.unmatchedDemandIds,
    rejectionReasons: alignment.rejectionReasons,
  };
}
