import { describe, expect, it } from 'vitest';
import {
  alignCandidateToChallenge,
  compileCandidateMatchQuery,
  explainChallengeMatch,
  rankReviewChallenges,
  recallReviewChallenges,
  type CandidateSignal,
  type ChallengeDemand,
  type ChallengePacket,
  type ConceptAdjacency,
  type QueryPurpose,
  type SourceRef,
} from '..';

function source(id: string): SourceRef {
  return {
    artifactId: `artifact-${id}`,
    artifactVersion: 'v1',
    contentHash: `sha256-${id}`,
    startOffset: 10,
    endOffset: 30,
    locator: `${id}:1:10-30`,
  };
}

function signal(
  id: string,
  overrides: Partial<CandidateSignal> = {},
): CandidateSignal {
  return {
    id,
    episodeId: `episode-${id}`,
    narrative: 'Implemented an ordered event processor and validated failure recovery.',
    purpose: 'validation',
    evidenceLevel: 'validated',
    evidenceStrength: 1,
    confidence: 1,
    concepts: ['technology:kafka', 'architecture:event-driven'],
    problems: ['ordered-replay'],
    mechanisms: ['consumer-offsets'],
    domains: ['ecommerce'],
    businessObjects: ['order'],
    ownershipActions: ['implemented'],
    embedding: [1, 0],
    sourceRefs: [source(`candidate-${id}`)],
    ...overrides,
  };
}

function nullSignal(
  id: string,
  overrides: Partial<CandidateSignal> = {},
): CandidateSignal {
  return {
    id,
    episodeId: `episode-${id}`,
    narrative: 'Implemented an ordered event processor and validated failure recovery.',
    purpose: 'validation',
    evidenceLevel: null,
    evidenceStrength: null,
    confidence: null,
    concepts: ['technology:kafka', 'architecture:event-driven'],
    problems: ['ordered-replay'],
    mechanisms: ['consumer-offsets'],
    domains: ['ecommerce'],
    businessObjects: ['order'],
    ownershipActions: ['implemented'],
    embedding: [1, 0],
    sourceRefs: [source(`candidate-${id}`)],
    ...overrides,
  };
}

function demand(
  id: string,
  weight: number,
  overrides: Partial<ChallengeDemand> = {},
): ChallengeDemand {
  return {
    id,
    family: `family-${id}`,
    narrative: 'Review an ordered event processor and verify failure recovery.',
    weight,
    concepts: ['technology:kafka', 'architecture:event-driven'],
    problems: ['ordered-replay'],
    mechanisms: ['consumer-offsets'],
    domains: ['ecommerce'],
    businessObjects: ['order'],
    ownershipActions: ['implemented'],
    embedding: [1, 0],
    sourceRefs: [source(`challenge-${id}`)],
    roleRequirement: true,
    highWeightRoleRequirement: id === 'one',
    ...overrides,
  };
}

function challenge(
  id: string,
  demands: ChallengeDemand[],
  overrides: Partial<ChallengePacket> = {},
): ChallengePacket {
  return {
    id,
    repoId: `repo-${id}`,
    prNumber: 10,
    sourceVersion: 'commit-abc',
    challengeReady: true,
    languages: ['typescript'],
    concepts: ['technology:kafka', 'architecture:event-driven'],
    demands,
    quality: {
      deterministic: 0.95,
      contextualSpecificity: 0.9,
    },
    ...overrides,
  };
}

function compile(signals: CandidateSignal[]) {
  return compileCandidateMatchQuery({
    candidateSnapshotId: 'candidate-snapshot',
    roleSnapshotId: 'role-snapshot',
    signals,
    roleGuardrails: {
      requiredLanguages: ['typescript'],
      minimumSeniority: 'senior',
      genericConcepts: ['language:typescript'],
    },
  });
}

function directEligibleFixture(purpose: QueryPurpose = 'validation') {
  const compiled = compile([
    signal('one', { purpose }),
    signal('two', {
      purpose,
      concepts: ['architecture:event-driven'],
      problems: ['backpressure'],
      mechanisms: ['bounded-queue'],
      ownershipActions: ['reviewed'],
    }),
  ]);
  const packet = challenge('direct', [
    demand('one', 0.5),
    demand('two', 0.5, {
      concepts: ['architecture:event-driven'],
      problems: ['backpressure'],
      mechanisms: ['bounded-queue'],
      ownershipActions: ['reviewed'],
    }),
  ]);
  return { compiled, packet };
}

describe('compileCandidateMatchQuery', () => {
  it('separates validation, deepening, and recall-only mentions', () => {
    const result = compile([
      signal('validation'),
      signal('deepening', { purpose: 'deepening' }),
      signal('mention', { evidenceLevel: 'mentioned' }),
    ]);

    expect(result.status).toBe('READY');
    expect(result.query.validationAtoms.map((atom) => atom.id)).toEqual(['validation']);
    expect(result.query.deepeningAtoms.map((atom) => atom.id)).toEqual(['deepening']);
    expect(result.query.recallOnlyAtoms.map((atom) => atom.id)).toEqual(['mention']);
    expect(result.query.recallOnlyAtoms[0]!.recallOnly).toBe(true);
  });

  it('enforces max 12 atoms, max 2 per exact concept, and max 2 per episode', () => {
    const signals = Array.from({ length: 16 }, (_, index) => signal(`signal-${String(index).padStart(2, '0')}`, {
      episodeId: index < 3 ? 'shared-episode' : `episode-${index}`,
      concepts: index < 5 ? ['term:shared-unseen-concept'] : [`unseen-${index}:value`],
    }));
    const result = compile(signals);
    const atoms = [...result.query.validationAtoms, ...result.query.deepeningAtoms];

    expect(atoms).toHaveLength(12);
    expect(atoms.filter((atom) => atom.episodeId === 'shared-episode')).toHaveLength(2);
    expect(atoms.filter((atom) => atom.concepts.includes('term:shared-unseen-concept'))).toHaveLength(2);
  });

  it('excludes zero-strength and zero-confidence placeholders from scoring', () => {
    const result = compile([
      signal('zero-strength', { evidenceStrength: 0 }),
      signal('zero-confidence', { confidence: 0 }),
      signal('valid'),
    ]);

    expect(result.query.validationAtoms.map((atom) => atom.id)).toEqual(['valid']);
    expect(result.excludedSignalIds).toEqual(['zero-confidence', 'zero-strength']);
  });

  it('excludes signals with null evidenceLevel, evidenceStrength, or confidence', () => {
    const result = compile([
      nullSignal('null-all'),
      signal('valid'),
    ]);

    expect(result.query.validationAtoms.map((atom) => atom.id)).toEqual(['valid']);
    expect(result.excludedSignalIds).toEqual(['null-all']);
  });

  it('handles unseen concepts without requiring code changes', () => {
    const result = compile([
      signal('seen-concept', { concepts: ['term:seen-concept'] }),
      signal('unseen-concept', { concepts: ['term:never-before-seen-concept'] }),
    ]);

    // Both should be included as they have valid evidence
    expect(result.query.validationAtoms.map((atom) => atom.id)).toEqual(['seen-concept', 'unseen-concept']);
    expect(result.excludedSignalIds).toEqual([]);
  });

  it('applies episode diminishing returns and excludes a third episode atom', () => {
    const result = compile([
      signal('a', { episodeId: 'same', concepts: ['domain:a'] }),
      signal('b', { episodeId: 'same', concepts: ['domain:b'] }),
      signal('c', { episodeId: 'same', concepts: ['domain:c'] }),
    ]);
    const atoms = result.query.validationAtoms;

    expect(atoms.map((atom) => atom.episodeMultiplier)).toEqual([1, 0.35]);
    expect(result.excludedSignalIds).toContain('c');
  });

  it('returns NEEDS_MORE_EVIDENCE when only mentions or ungrounded signals exist', () => {
    const result = compile([
      signal('mention', { evidenceLevel: 'mentioned' }),
      signal('ungrounded', { sourceRefs: [] }),
    ]);

    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.query.validationAtoms).toEqual([]);
    expect(result.query.recallOnlyAtoms).toHaveLength(1);
  });
});

describe('recallReviewChallenges', () => {
  it('uses mentions for recall but never treats a mention-only query as scoreable evidence', () => {
    const compiled = compile([signal('mention', { evidenceLevel: 'mentioned' })]);
    const result = recallReviewChallenges({
      query: compiled.query,
      challenges: [challenge('mention-target', [demand('one', 1)])],
    });

    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.challenges).toEqual([]);
  });

  it('allows a mention to widen recall without contributing an alignment', () => {
    const compiled = compile([
      signal('scoring', {
        concepts: ['domain:payments'],
        problems: ['chargeback'],
        mechanisms: ['idempotency-key'],
      }),
      signal('mention', {
        evidenceLevel: 'mentioned',
        concepts: ['technology:kafka'],
        problems: [],
        mechanisms: [],
      }),
    ]);
    const packet = challenge('mention-recall', [
      demand('one', 1, {
        concepts: ['technology:kafka'],
        problems: [],
        mechanisms: [],
      }),
    ]);

    const recalled = recallReviewChallenges({
      query: compiled.query,
      challenges: [packet],
    });
    const alignment = alignCandidateToChallenge({
      query: compiled.query,
      challenge: packet,
    });

    expect(recalled.status).toBe('READY');
    expect(recalled.challenges[0]!.matchedAtomIds).toEqual(['mention']);
    expect(alignment.alignments).toEqual([]);
    expect(alignment.eligible).toBe(false);
  });

  it('filters challenges that violate language guardrails', () => {
    const compiled = compile([signal('one')]);
    const unsafe = challenge('unsafe', [demand('one', 1)], {
      languages: ['python'],
    });
    const result = recallReviewChallenges({
      query: compiled.query,
      challenges: [unsafe],
    });

    expect(result.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(result.excludedChallengeIds).toEqual(['unsafe']);
  });
});

describe('alignCandidateToChallenge', () => {
  it('rejects generic keyword overlap without non-generic correspondence', () => {
    const compiled = compile([
      signal('generic', {
        narrative: 'Worked with TypeScript.',
        concepts: ['language:typescript'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
    ]);
    const packet = challenge('generic', [
      demand('one', 0.5, {
        narrative: 'Review TypeScript.',
        concepts: ['language:typescript'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
      demand('two', 0.5, {
        family: 'second-family',
        narrative: 'Review TypeScript code.',
        concepts: ['language:typescript'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
    ], { concepts: ['language:typescript'] });

    const result = alignCandidateToChallenge({ query: compiled.query, challenge: packet });

    expect(result.eligible).toBe(false);
    expect(result.rejectionReasons).toContain('NO_NON_GENERIC_ALIGNMENT');
  });

  it('uses each atom and demand at most once in the maximum-weight assignment', () => {
    const { compiled, packet } = directEligibleFixture();
    const result = alignCandidateToChallenge({ query: compiled.query, challenge: packet });

    expect(new Set(result.alignments.map((entry) => entry.atom.id)).size).toBe(result.alignments.length);
    expect(new Set(result.alignments.map((entry) => entry.demand.id)).size).toBe(result.alignments.length);
    expect(result.alignments.map((entry) => `${entry.demand.id}:${entry.atom.id}`)).toEqual([
      'one:one',
      'two:two',
    ]);
    expect(result.eligible).toBe(true);
  });

  it('discounts duplicate episode evidence to 35 percent', () => {
    const compiled = compile([
      signal('one', { episodeId: 'shared', concepts: ['domain:first'] }),
      signal('two', { episodeId: 'shared', concepts: ['domain:second'] }),
    ]);
    const packet = challenge('episode', [
      demand('one', 0.5, { concepts: ['domain:first'] }),
      demand('two', 0.5, { concepts: ['domain:second'] }),
    ]);
    const result = alignCandidateToChallenge({ query: compiled.query, challenge: packet });
    const second = result.alignments.find((entry) => entry.atom.id === 'two');

    expect(second?.atom.episodeMultiplier).toBe(0.35);
    expect(second!.weightedScore).toBeCloseTo(second!.pairScore.total * 0.5 * 0.35);
  });

  it('accepts exactly one adjacent stretch when it is at most 20 percent of demand weight', () => {
    const compiled = compile([
      signal('one'),
      signal('two', {
        concepts: ['architecture:event-driven'],
        problems: ['backpressure'],
        mechanisms: ['bounded-queue'],
      }),
      signal('stretch', {
        purpose: 'deepening',
        concepts: ['technology:kafka'],
        problems: [],
        mechanisms: [],
      }),
    ]);
    const packet = challenge('one-stretch', [
      demand('one', 0.4),
      demand('two', 0.4, {
        concepts: ['architecture:event-driven'],
        problems: ['backpressure'],
        mechanisms: ['bounded-queue'],
      }),
      demand('stretch', 0.2, {
        concepts: ['technology:pulsar'],
        problems: [],
        mechanisms: [],
        highWeightRoleRequirement: false,
      }),
    ]);
    const adjacency: ConceptAdjacency[] = [
      { from: 'technology:kafka', to: 'technology:pulsar', dimension: 'technology' },
    ];

    const result = alignCandidateToChallenge({
      query: compiled.query,
      challenge: packet,
      adjacency,
    });

    expect(result.stretchCount).toBe(1);
    expect(result.stretchDemandWeightRatio).toBeCloseTo(0.2);
    expect(result.eligible).toBe(true);
  });

  it('rejects two adjacent stretches even when their combined weight is 20 percent', () => {
    const compiled = compile([
      signal('one'),
      signal('stretch-a', {
        concepts: ['technology:kafka'],
        problems: [],
        mechanisms: [],
      }),
      signal('stretch-b', {
        concepts: ['domain:retail'],
        problems: [],
        mechanisms: [],
      }),
    ]);
    const packet = challenge('two-stretches', [
      demand('one', 0.8),
      demand('stretch-a', 0.1, {
        concepts: ['technology:pulsar'],
        problems: [],
        mechanisms: [],
        highWeightRoleRequirement: false,
      }),
      demand('stretch-b', 0.1, {
        concepts: ['domain:marketplace'],
        problems: [],
        mechanisms: [],
        highWeightRoleRequirement: false,
      }),
    ]);
    const adjacency: ConceptAdjacency[] = [
      { from: 'technology:kafka', to: 'technology:pulsar', dimension: 'technology' },
      { from: 'domain:retail', to: 'domain:marketplace', dimension: 'domain' },
    ];

    const result = alignCandidateToChallenge({
      query: compiled.query,
      challenge: packet,
      adjacency,
    });

    expect(result.stretchCount).toBe(2);
    expect(result.rejectionReasons).toContain('TOO_MANY_STRETCHES');
    expect(result.eligible).toBe(false);
  });

  it('rejects a challenge that violates role guardrails even if evidence aligns', () => {
    const { compiled, packet } = directEligibleFixture();
    const unsafe = { ...packet, languages: ['python'] };
    const result = alignCandidateToChallenge({ query: compiled.query, challenge: unsafe });

    expect(result.eligible).toBe(false);
    expect(result.rejectionReasons).toContain('ROLE_GUARDRAIL_FAILED');
  });

  it('produces byte-identical deterministic results across reruns', () => {
    const { compiled, packet } = directEligibleFixture();
    const first = alignCandidateToChallenge({ query: compiled.query, challenge: packet });
    const second = alignCandidateToChallenge({ query: compiled.query, challenge: packet });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('ranking and explanations', () => {
  it('uses deterministic final tie-breaks by repo id then PR number', () => {
    const { compiled, packet } = directEligibleFixture();
    const packetB = { ...packet, id: 'b', repoId: 'repo-b', prNumber: 1 };
    const packetA2 = { ...packet, id: 'a2', repoId: 'repo-a', prNumber: 2 };
    const packetA1 = { ...packet, id: 'a1', repoId: 'repo-a', prNumber: 1 };
    const alignments = [packetB, packetA2, packetA1].map((item) =>
      alignCandidateToChallenge({ query: compiled.query, challenge: item })
    );

    const ranked = rankReviewChallenges(compiled.query, alignments);

    expect(ranked.status).toBe('MATCHED');
    expect(ranked.matches.map((match) => match.alignment.challenge.id)).toEqual(['a1', 'a2', 'b']);
  });

  it('returns NO_ROLE_SAFE_CHALLENGE when every alignment is ineligible', () => {
    const compiled = compile([signal('generic', {
      concepts: ['language:typescript'],
      problems: [],
      mechanisms: [],
      domains: [],
      businessObjects: [],
      ownershipActions: [],
    })]);
    const packet = challenge('generic', [demand('one', 1, {
      concepts: ['language:typescript'],
      problems: [],
      mechanisms: [],
      domains: [],
      businessObjects: [],
      ownershipActions: [],
    })], { concepts: ['language:typescript'] });
    const alignment = alignCandidateToChallenge({ query: compiled.query, challenge: packet });

    expect(rankReviewChallenges(compiled.query, [alignment]).status).toBe('NO_ROLE_SAFE_CHALLENGE');
  });

  it('explains matches with exact candidate and challenge source references', () => {
    const { compiled, packet } = directEligibleFixture('deepening');
    const alignment = alignCandidateToChallenge({ query: compiled.query, challenge: packet });
    const explanation = explainChallengeMatch(alignment);

    expect(explanation.status).toBe('MATCHED');
    expect(explanation.evidence).toHaveLength(2);
    expect(explanation.evidence[0]!.candidateSourceRefs[0]!.contentHash).toMatch(/^sha256-candidate-/);
    expect(explanation.evidence[0]!.challengeSourceRefs[0]!.contentHash).toMatch(/^sha256-challenge-/);
    expect(explanation.evidence.every((entry) => entry.purpose === 'deepening')).toBe(true);
  });
});
