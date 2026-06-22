import type {
  AlignCandidateToChallengeInput,
  CandidateMatchQuery,
  ChallengeAlignment,
  ChallengeDemand,
  ChallengePacket,
  CompileCandidateMatchInput,
  CompileCandidateMatchResult,
  ConceptAdjacency,
  DemandAlignment,
  EvidenceLevel,
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
    const concepts = normalized(signal.concepts);
    if (concepts.length === 0) return 0;
    const overlap = concepts.filter((concept) => selectionConcepts.has(concept)).length;
    return overlap / concepts.length;
  };
  return (
    selectionScore(b) - selectionScore(a)
    || Number(Boolean(a.contradicted)) - Number(Boolean(b.contradicted))
    || (b.evidenceLevel == null ? -1 : EVIDENCE_RANK[b.evidenceLevel])
      - (a.evidenceLevel == null ? -1 : EVIDENCE_RANK[a.evidenceLevel])
    || clamp01(b.evidenceStrength ?? 0) - clamp01(a.evidenceStrength ?? 0)
    || clamp01(b.confidence ?? 0) - clamp01(a.confidence ?? 0)
    || a.id.localeCompare(b.id)
    || a.episodeId.localeCompare(b.episodeId)
  );
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

export function compileCandidateMatchQuery(input: CompileCandidateMatchInput): CompileCandidateMatchResult {
  const excludedSignalIds: string[] = [];
  const recallOnlyAtoms: QueryAtom[] = [];
  const selected: QueryAtom[] = [];
  const episodeCounts = new Map<string, number>();
  const conceptCounts = new Map<string, number>();

  const selectionConcepts = new Set(normalized(input.selectionConcepts));
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
      concepts: normalized(signal.concepts),
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

    const episodeCount = episodeCounts.get(atom.episodeId) ?? 0;
    const concepts = [...new Set(atom.concepts)];
    const exceedsConceptCap = concepts.some(
      (concept) => (conceptCounts.get(concept) ?? 0) >= MAX_ATOMS_PER_CONCEPT,
    );
    if (episodeCount >= MAX_ATOMS_PER_EPISODE || exceedsConceptCap) {
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

function jaccardText(a: string, b: string): number {
  const tokenize = (value: string) => new Set(
    value.toLowerCase().split(/[^a-z0-9+#.-]+/).filter((token) => token.length > 2),
  );
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap++;
  }
  return overlap / (left.size + right.size - overlap);
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

function semanticSimilarity(atom: QueryAtom, demand: ChallengeDemand): number {
  return cosine(atom.embedding, demand.embedding) ?? jaccardText(atom.narrative, demand.narrative);
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

function scorePair(
  atom: QueryAtom,
  demand: ChallengeDemand,
  adjacency: ConceptAdjacency[],
): { score: PairScore; stretch?: DemandAlignment['stretch'] } | null {
  const direct = hasDirectSemanticGate(atom, demand);
  const stretch = direct ? undefined : findStretch(atom, demand, adjacency);
  if (!direct && !stretch) return null;

  const pairScore: PairScore = {
    semanticNarrative: semanticSimilarity(atom, demand),
    conceptCorrespondence: containmentRatio(atom.concepts, demand.concepts),
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
  const dimensions = [
    { score: pairScore.semanticNarrative, weight: 0.15, available: true },
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
  pairs: Array<{ atomIndex: number; demandIndex: number; pair: NonNullable<ReturnType<typeof scorePair>> }>;
  signature: string;
}

function betterAssignment(candidate: AssignmentState, current: AssignmentState | undefined): boolean {
  if (!current) return true;
  if (Math.abs(candidate.score - current.score) > 1e-12) return candidate.score > current.score;
  return candidate.signature < current.signature;
}

function maximumWeightAssignment(
  atoms: QueryAtom[],
  demands: ChallengeDemand[],
  adjacency: ConceptAdjacency[],
): AssignmentState {
  let states = new Map<number, AssignmentState>([
    [0, { score: 0, pairs: [], signature: '' }],
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
          pairs,
          signature,
        };
        const nextMask = mask | bit;
        if (betterAssignment(candidate, next.get(nextMask))) next.set(nextMask, candidate);
      }
    }
    states = next;
  }

  let best: AssignmentState = { score: 0, pairs: [], signature: '' };
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
  const candidateEvidenceAlignment = totalDemandWeight === 0
    ? 0
    : clamp01(alignments.reduce((sum, entry) => sum + entry.weightedScore, 0) / totalDemandWeight);
  const roleRelevance = weightedCoverage(
    alignments,
    demands,
    (demand) => Boolean(demand.roleRequirement),
  );
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

  const rejectionReasons: string[] = [];
  if (!challengePassesGuardrails(input.challenge, input.query.roleGuardrails)) rejectionReasons.push('ROLE_GUARDRAIL_FAILED');
  if (candidateEvidenceAlignment < 0.60) rejectionReasons.push('CANDIDATE_ALIGNMENT_BELOW_THRESHOLD');
  if (roleRelevance < 0.60) rejectionReasons.push('ROLE_RELEVANCE_BELOW_THRESHOLD');
  if (challengeQuality < 0.70) rejectionReasons.push('CHALLENGE_QUALITY_BELOW_THRESHOLD');
  if (demandFamilies.size < 2) rejectionReasons.push('INSUFFICIENT_DEMAND_FAMILIES');
  if (!hasNonGeneric) rejectionReasons.push('NO_NON_GENERIC_ALIGNMENT');
  if (!hasHighWeightRoleRequirement) rejectionReasons.push('NO_HIGH_WEIGHT_ROLE_REQUIREMENT');
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
  const eligible = alignments
    .filter((alignment) => alignment.eligible)
    .sort((a, b) =>
      b.finalScore - a.finalScore
      || b.candidateEvidenceAlignment - a.candidateEvidenceAlignment
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

export function explainChallengeMatch(
  alignment: ChallengeAlignment,
  context: Partial<Pick<MatchExplanation, 'rejectedPackets' | 'missingEvidence' | 'roleSources'>> = {
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
