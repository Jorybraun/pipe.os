import { describe, expect, it } from 'vitest';
import {
  alignCandidateToChallenge,
  compileCandidateMatchQuery,
  deriveCandidateSignalFacets,
  explainChallengeMatch,
  rankReviewChallenges,
  recallReviewChallenges,
  type CandidateSignal,
  type ChallengeAlignment,
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
    sourceRefType: id.startsWith('challenge-') ? 'repo_source_span' : 'source_span',
    sourceRefId: `source-ref-${id}`,
    sourceSpanId: id.startsWith('challenge-') ? undefined : `source-ref-${id}`,
    locator: `${id}:1:10-30`,
    exactText: `Exact source text for ${id}.`,
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

function rankableAlignment(
  packet: ChallengePacket,
  overrides: Partial<ChallengeAlignment> = {},
): ChallengeAlignment {
  return {
    challenge: packet,
    alignments: [],
    unmatchedDemandIds: [],
    candidateEvidenceAlignment: 0,
    roleRelevance: 0,
    contextualSpecificity: packet.quality.contextualSpecificity,
    challengeQuality: packet.quality.deterministic,
    validationDeepeningValue: 0,
    finalScore: 0,
    stretchCount: 0,
    stretchDemandWeightRatio: 0,
    hasNonGenericAlignment: true,
    hasHighWeightRoleRequirement: false,
    provenanceComplete: true,
    eligible: true,
    rejectionReasons: [],
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
    expect(result.query.validationAtoms.map((atom) => atom.id).sort()).toEqual(['seen-concept', 'unseen-concept']);
    expect(result.excludedSignalIds).toEqual([]);
  });

  it('expands source-backed compound terms into atomic recall keys', () => {
    const result = compile([
      signal('compound-popover', {
        concepts: ['term:trigger-click-handling-use-popover-root'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
      signal('compound-typescript', {
        concepts: ['term:react-typescript-experience'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
    ]);

    const popoverAtom = result.query.validationAtoms.find((atom) => atom.id === 'compound-popover');
    expect(popoverAtom?.concepts).toEqual(expect.arrayContaining([
      'term:trigger-click-handling-use-popover-root',
      'term:trigger',
      'term:click',
      'term:popover',
      'term:use-popover-root',
    ]));

    const typescriptAtom = result.query.validationAtoms.find((atom) => atom.id === 'compound-typescript');
    expect(typescriptAtom?.concepts).toEqual(expect.arrayContaining([
      'term:react-typescript-experience',
      'term:react',
      'term:typescript',
    ]));
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

  it('excludes source refs that cannot point to exact original evidence', () => {
    const complete = source('candidate-valid');
    const result = compile([
      signal('missing-ref-type', {
        sourceRefs: [{ ...complete, sourceRefType: undefined }],
      }),
      signal('missing-ref-id', {
        sourceRefs: [{ ...complete, sourceRefId: undefined }],
      }),
      signal('missing-exact-text', {
        sourceRefs: [{ ...complete, exactText: undefined }],
      }),
      signal('blank-exact-text', {
        sourceRefs: [{ ...complete, exactText: '   ' }],
      }),
      signal('valid', { sourceRefs: [complete] }),
    ]);

    expect(result.status).toBe('READY');
    expect(result.query.validationAtoms.map((atom) => atom.id)).toEqual(['valid']);
    expect(result.excludedSignalIds).toEqual([
      'blank-exact-text',
      'missing-exact-text',
      'missing-ref-id',
      'missing-ref-type',
    ]);
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

  it('recalls concept-near popup PRs from compound popover trigger evidence', () => {
    const compiled = compile([
      signal('compound-popover', {
        narrative: 'Implemented popover trigger click handling in usePopoverRoot.',
        concepts: ['term:trigger-click-handling-use-popover-root'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
    ]);
    const exactPopover = challenge('popover-pr', [
      demand('popover', 1, {
        concepts: ['term:popover', 'term:click', 'term:use-popover-root'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ]);
    const nearbyPopup = challenge('popup-trigger-pr', [
      demand('popup-trigger', 1, {
        concepts: ['term:popup', 'term:trigger'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ]);
    const unrelatedProgress = challenge('progress-pr', [
      demand('progress', 1, {
        concepts: ['term:progress', 'term:aria'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ]);

    const recalled = recallReviewChallenges({
      query: compiled.query,
      challenges: [unrelatedProgress, nearbyPopup, exactPopover],
    });
    const ranked = rankReviewChallenges(compiled.query, [
      alignCandidateToChallenge({ query: compiled.query, challenge: nearbyPopup }),
      alignCandidateToChallenge({ query: compiled.query, challenge: exactPopover }),
    ]);

    expect(recalled.status).toBe('READY');
    expect(recalled.challenges.map((item) => item.challenge.id)).toEqual([
      'popover-pr',
      'popup-trigger-pr',
    ]);
    expect(ranked.status).toBe('MATCHED');
    expect(ranked.matches.map((match) => match.alignment.challenge.id)).toEqual([
      'popover-pr',
      'popup-trigger-pr',
    ]);
    expect(ranked.matches[1]?.alignment.eligible).toBe(true);
  });
});

describe('alignCandidateToChallenge', () => {
  it('derives source-backed candidate facets for repo-specific standalone matching', () => {
    const facets = deriveCandidateSignalFacets({
      concepts: [
        'term:typescript-sdk',
        'term:runtime',
        'term:kv',
        'term:queues',
        'term:serverless',
        'term:deployments',
        'term:cloudflare',
        'term:workers',
      ],
      narrative: 'Candidate supplied review evidence for TypeScript SDK tooling.',
      exactText: 'Staff Engineer, Edge Platform Team: designed Cloudflare Workers-style runtime APIs, request routing, KV-backed configuration, durable task queues, and TypeScript SDK tooling for serverless deployments.',
    });

    expect(facets.concepts).toEqual(expect.arrayContaining([
      'term:typescript-sdk',
      'term:runtime',
      'term:kv',
      'term:queues',
      'term:serverless',
      'term:deployments',
      'term:cloudflare',
      'term:workers',
    ]));
    expect(facets.mechanisms).toEqual(expect.arrayContaining([
      'term:typescript-sdk',
      'term:runtime',
      'term:kv',
      'term:queues',
      'term:serverless',
      'term:deployments',
    ]));
    expect(facets.domains).toEqual([]);
  });

  it('uses decomposed source facets to prefer Workers SDK over generic TypeScript UI packets', () => {
    const facets = deriveCandidateSignalFacets({
      concepts: [
        'term:typescript-sdk',
        'term:runtime',
        'term:kv',
        'term:queues',
        'term:serverless',
        'term:deployments',
        'term:cloudflare',
        'term:workers',
      ],
      narrative: 'Candidate supplied review evidence for TypeScript SDK tooling.',
      exactText: 'Staff Engineer, Edge Platform Team: designed Cloudflare Workers-style runtime APIs, request routing, KV-backed configuration, durable task queues, and TypeScript SDK tooling for serverless deployments.',
    });
    const compiled = compileCandidateMatchQuery({
      candidateSnapshotId: 'candidate-cloudflare',
      roleSnapshotId: 'standalone-code-review-v1',
      signals: [
        signal('cloudflare-workers', {
          concepts: facets.concepts,
          problems: facets.problems,
          mechanisms: facets.mechanisms,
          domains: facets.domains,
          businessObjects: facets.businessObjects,
          ownershipActions: facets.ownershipActions,
        }),
      ],
      roleGuardrails: {
        requiredLanguages: ['typescript'],
        genericConcepts: ['term:typescript'],
      },
    });
    const workersPacket = challenge('workers-sdk', [
      demand('workers-sdk', 1, {
        concepts: ['term:typescript', 'term:workers-sdk', 'term:runtime', 'term:serverless'],
        mechanisms: ['term:deploy', 'term:runtime'],
        domains: ['term:workers-sdk', 'term:serverless'],
        businessObjects: ['term:deploy', 'term:runtime'],
        ownershipActions: ['term:modified'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ], {
      repoId: '79',
      concepts: ['term:typescript', 'term:workers-sdk', 'term:runtime', 'term:serverless'],
      quality: { deterministic: 0.9, contextualSpecificity: 1 },
    });
    const genericUiPacket = challenge('base-ui', [
      demand('base-ui', 1, {
        concepts: ['term:typescript', 'term:active-trigger-id'],
        mechanisms: ['term:active-trigger-id'],
        domains: ['term:base-ui', 'term:react'],
        businessObjects: ['term:active-trigger-id'],
        ownershipActions: ['term:modified'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ], {
      repoId: '973',
      concepts: ['term:typescript', 'term:active-trigger-id'],
      quality: { deterministic: 0.9, contextualSpecificity: 1 },
    });

    const workersAlignment = alignCandidateToChallenge({
      query: compiled.query,
      challenge: workersPacket,
    });
    const genericAlignment = alignCandidateToChallenge({
      query: compiled.query,
      challenge: genericUiPacket,
    });
    const ranked = rankReviewChallenges(compiled.query, [genericAlignment, workersAlignment]);

    expect(workersAlignment.hasNonGenericAlignment).toBe(true);
    expect(workersAlignment.eligible).toBe(true);
    expect(genericAlignment.eligible).toBe(false);
    expect(genericAlignment.rejectionReasons).toContain('NO_NON_GENERIC_ALIGNMENT');
    expect(ranked.status).toBe('MATCHED');
    expect(ranked.matches[0]!.alignment.challenge.repoId).toBe('79');
  });

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
  it('prefers candidate-specific fit over static packet polish after eligibility', () => {
    const compiled = compile([
      signal('runtime-sdk', {
        concepts: ['term:workers-sdk', 'term:runtime'],
        problems: [],
        mechanisms: ['term:runtime'],
        domains: ['term:serverless'],
        businessObjects: [],
        ownershipActions: ['reviewed'],
      }),
    ]);
    const polishedGeneric = challenge('polished-generic', [
      demand('generic', 1, {
        concepts: ['term:typescript', 'term:runtime'],
        problems: [],
        mechanisms: ['term:runtime'],
        domains: [],
        businessObjects: [],
        ownershipActions: ['reviewed'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ], {
      quality: { deterministic: 1, contextualSpecificity: 1 },
    });
    const candidateSpecific = challenge('candidate-specific', [
      demand('workers', 1, {
        concepts: ['term:workers-sdk', 'term:runtime'],
        problems: [],
        mechanisms: ['term:runtime'],
        domains: ['term:serverless'],
        businessObjects: [],
        ownershipActions: ['reviewed'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ], {
      quality: { deterministic: 0.85, contextualSpecificity: 0.75 },
    });

    const ranked = rankReviewChallenges(compiled.query, [
      rankableAlignment(polishedGeneric, {
        candidateEvidenceAlignment: 0.45,
        validationDeepeningValue: 0.45,
        finalScore: 0.61,
      }),
      rankableAlignment(candidateSpecific, {
        candidateEvidenceAlignment: 0.60,
        validationDeepeningValue: 0.60,
        finalScore: 0.58,
      }),
    ]);

    expect(ranked.status).toBe('MATCHED');
    expect(ranked.matches[0]!.alignment.challenge.id).toBe('candidate-specific');
    expect(ranked.matches[1]!.alignment.challenge.id).toBe('polished-generic');
  });

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
    expect(explanation.selectedPr).toEqual({
      challengeId: 'direct',
      repoId: 'repo-direct',
      prNumber: 10,
      sourceVersion: 'commit-abc',
    });
    expect(explanation.candidateSpans).toHaveLength(2);
    expect(explanation.repoSpans).toHaveLength(2);
    expect(explanation.rejectedPackets).toEqual([]);
    expect(explanation.missingEvidence).toEqual([]);
    expect(explanation.stretchAreas).toEqual([]);
    expect(explanation.assessmentQuality).toEqual(expect.objectContaining({
      verdict: 'STRONG',
      score: 10,
      maxScore: 12,
      metrics: expect.arrayContaining([
        expect.objectContaining({ id: 'skill_stack_overlap', score: 2 }),
        expect.objectContaining({ id: 'pr_reviewability', score: 2 }),
        expect.objectContaining({ id: 'source_coverage', score: 2 }),
      ]),
    }));
  });

  it('downgrades assessment quality when eligible matches are nearly tied', () => {
    const { compiled, packet } = directEligibleFixture('deepening');
    const alignment = alignCandidateToChallenge({ query: compiled.query, challenge: packet });
    const explanation = explainChallengeMatch(alignment, { scoreSeparation: 0.01 });

    const contrastMetric = explanation.assessmentQuality?.metrics.find((metric) =>
      metric.id === 'contrast_separation'
    );
    expect(contrastMetric).toEqual(expect.objectContaining({
      score: 0,
      reason: expect.stringContaining('1%'),
    }));
    expect(explanation.assessmentQuality?.verdict).toBe('USABLE');
  });

  it('treats rounded 2 percent contrast separation as measurable positive separation', () => {
    const { compiled, packet } = directEligibleFixture('deepening');
    const alignment = alignCandidateToChallenge({ query: compiled.query, challenge: packet });
    const explanation = explainChallengeMatch(alignment, { scoreSeparation: 0.018704521434697585 });

    const contrastMetric = explanation.assessmentQuality?.metrics.find((metric) =>
      metric.id === 'contrast_separation'
    );
    expect(contrastMetric).toEqual(expect.objectContaining({
      score: 1,
      reason: expect.stringContaining('2%'),
    }));
    expect(explanation.assessmentQuality?.verdict).toBe('STRONG');
  });

  it('separates opposing candidate profiles across different review packets', () => {
    const kafkaCompiled = compile([
      signal('kafka-one'),
      signal('kafka-two', {
        concepts: ['architecture:event-driven'],
        problems: ['backpressure'],
        mechanisms: ['bounded-queue'],
        ownershipActions: ['reviewed'],
      }),
    ]);
    const reactCompiled = compile([
      signal('react-one', {
        narrative: 'Reviewed React hooks for stale UI state and component data flow.',
        concepts: ['technology:react', 'architecture:frontend-state'],
        problems: ['stale-ui-state'],
        mechanisms: ['react-hooks'],
        domains: ['frontend'],
        businessObjects: ['component'],
        ownershipActions: ['reviewed'],
        embedding: [0, 1],
      }),
      signal('react-two', {
        narrative: 'Validated component render behavior and state reset coverage.',
        concepts: ['technology:react'],
        problems: ['render-regression'],
        mechanisms: ['component-tests'],
        domains: ['frontend'],
        businessObjects: ['component'],
        ownershipActions: ['validated'],
        embedding: [0, 1],
      }),
    ]);
    const kafkaPacket = challenge('kafka-review', [
      demand('kafka-one', 0.5),
      demand('kafka-two', 0.5, {
        concepts: ['architecture:event-driven'],
        problems: ['backpressure'],
        mechanisms: ['bounded-queue'],
        ownershipActions: ['reviewed'],
      }),
    ]);
    const reactPacket = challenge('react-review', [
      demand('react-one', 0.55, {
        narrative: 'Review React hook state flow for stale UI state.',
        concepts: ['technology:react', 'architecture:frontend-state'],
        problems: ['stale-ui-state'],
        mechanisms: ['react-hooks'],
        domains: ['frontend'],
        businessObjects: ['component'],
        ownershipActions: ['reviewed'],
        embedding: [0, 1],
      }),
      demand('react-two', 0.45, {
        narrative: 'Review component test coverage for render regressions.',
        concepts: ['technology:react'],
        problems: ['render-regression'],
        mechanisms: ['component-tests'],
        domains: ['frontend'],
        businessObjects: ['component'],
        ownershipActions: ['validated'],
        embedding: [0, 1],
      }),
    ], {
      concepts: ['technology:react', 'architecture:frontend-state'],
    });

    const kafkaRanked = rankReviewChallenges(kafkaCompiled.query, [
      alignCandidateToChallenge({ query: kafkaCompiled.query, challenge: reactPacket }),
      alignCandidateToChallenge({ query: kafkaCompiled.query, challenge: kafkaPacket }),
    ]);
    const reactRanked = rankReviewChallenges(reactCompiled.query, [
      alignCandidateToChallenge({ query: reactCompiled.query, challenge: kafkaPacket }),
      alignCandidateToChallenge({ query: reactCompiled.query, challenge: reactPacket }),
    ]);

    expect(kafkaRanked.status).toBe('MATCHED');
    expect(reactRanked.status).toBe('MATCHED');
    expect(kafkaRanked.matches[0]?.alignment.challenge.id).toBe('kafka-review');
    expect(reactRanked.matches[0]?.alignment.challenge.id).toBe('react-review');
    expect(kafkaRanked.matches[0]?.alignment.challenge.id).not.toBe(
      reactRanked.matches[0]?.alignment.challenge.id,
    );
  });

  it('keeps an eligible source-backed match selected while explaining rejected packets, missing evidence, and stretch areas', () => {
    const compiled = compile([
      signal('one'),
      signal('stretch', {
        purpose: 'deepening',
        concepts: ['technology:kafka'],
        problems: [],
        mechanisms: [],
      }),
    ]);
    const packet = challenge('stretch-diagnostic', [
      demand('one', 0.8),
      demand('stretch', 0.2, {
        concepts: ['technology:pulsar'],
        problems: [],
        mechanisms: [],
        highWeightRoleRequirement: false,
      }),
      demand('unmatched', 0.2, {
        concepts: ['term:unseen-packet-demand'],
        problems: ['unknown-review-risk'],
        mechanisms: [],
        highWeightRoleRequirement: false,
      }),
    ]);
    const alignment = alignCandidateToChallenge({
      query: compiled.query,
      challenge: packet,
      adjacency: [{ from: 'technology:kafka', to: 'technology:pulsar', dimension: 'technology' }],
    });

    const explanation = explainChallengeMatch(alignment, {
      rejectedPackets: [{
        id: 'packet-with-missing-span',
        repoId: 'repo-7',
        prNumber: 77,
        reasons: ['MISSING_DEMAND_SOURCE_SPANS'],
        demandIds: ['demand-x'],
        missingSourceSpanIds: ['repo-span-x'],
      }],
      missingEvidence: [{
        scope: 'repo',
        reason: 'MISSING_DEMAND_SOURCE_SPANS',
        challengeId: 'packet-with-missing-span',
      }],
    });

    expect(alignment.eligible).toBe(true);
    expect(alignment.rejectionReasons).toEqual([]);
    expect(explanation.status).toBe('MATCHED');
    expect(explanation.selectedPr).toEqual({
      challengeId: 'stretch-diagnostic',
      repoId: 'repo-stretch-diagnostic',
      prNumber: 10,
      sourceVersion: 'commit-abc',
    });
    expect(explanation.rejectedPackets).toEqual([
      expect.objectContaining({
        id: 'packet-with-missing-span',
        reasons: ['MISSING_DEMAND_SOURCE_SPANS'],
        missingSourceSpanIds: ['repo-span-x'],
      }),
    ]);
    expect(explanation.unmatchedDemandIds).toEqual(['unmatched']);
    expect(explanation.missingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'candidate',
        reason: 'NO_SOURCE_BACKED_CANDIDATE_ALIGNMENT',
        demandId: 'unmatched',
      }),
      expect.objectContaining({
        scope: 'repo',
        reason: 'MISSING_DEMAND_SOURCE_SPANS',
      }),
    ]));
    expect(explanation.stretchAreas).toEqual([
      expect.objectContaining({
        atomId: 'stretch',
        demandId: 'stretch',
        atomConcept: 'technology:kafka',
        demandConcept: 'technology:pulsar',
        dimension: 'technology',
      }),
    ]);
  });
});

describe('fake semantics and fallback removal (HAS-86)', () => {
  it('prevents embedding-only match decisions when concepts do not overlap', () => {
    const compiled = compile([
      signal('one', {
        concepts: ['technology:kafka'],
        problems: ['ordered-replay'],
        mechanisms: ['consumer-offsets'],
        embedding: [1, 0],
      }),
    ]);
    const packet = challenge('embedding-only', [
      demand('one', 0.5, {
        concepts: ['technology:redis'],
        problems: ['cache-invalidation'],
        mechanisms: ['ttl-eviction'],
        embedding: [1, 0],
      }),
      demand('two', 0.5, {
        family: 'second-family',
        concepts: ['technology:redis'],
        problems: ['cache-invalidation'],
        mechanisms: ['ttl-eviction'],
        embedding: [1, 0],
      }),
    ], { concepts: ['technology:redis'] });

    const result = alignCandidateToChallenge({ query: compiled.query, challenge: packet });

    expect(result.alignments).toEqual([]);
    expect(result.eligible).toBe(false);
    expect(result.rejectionReasons).toContain('CANDIDATE_ALIGNMENT_BELOW_THRESHOLD');
  });

  it('does not fabricate semantic similarity from text overlap when embeddings are absent', () => {
    const compiled = compile([
      signal('one', {
        narrative: 'Implemented an ordered event processor and validated failure recovery.',
        concepts: ['technology:kafka'],
        problems: ['ordered-replay'],
        mechanisms: ['consumer-offsets'],
        embedding: undefined,
      }),
      signal('two', {
        narrative: 'Implemented a bounded queue for backpressure handling.',
        concepts: ['architecture:event-driven'],
        problems: ['backpressure'],
        mechanisms: ['bounded-queue'],
        embedding: undefined,
      }),
    ]);
    const packet = challenge('no-embedding', [
      demand('one', 0.5, {
        narrative: 'Review an ordered event processor and verify failure recovery.',
        concepts: ['technology:kafka'],
        problems: ['ordered-replay'],
        mechanisms: ['consumer-offsets'],
        embedding: undefined,
      }),
      demand('two', 0.5, {
        family: 'second-family',
        narrative: 'Review a bounded queue for backpressure handling.',
        concepts: ['architecture:event-driven'],
        problems: ['backpressure'],
        mechanisms: ['bounded-queue'],
        embedding: undefined,
      }),
    ]);

    const result = alignCandidateToChallenge({ query: compiled.query, challenge: packet });

    expect(result.alignments).toHaveLength(2);
    expect(result.alignments.every((entry) => entry.pairScore.semanticNarrative === 0)).toBe(true);
  });

  it('does not penalize direct source-backed concept matches when embeddings are absent', () => {
    const compiled = compile([
      signal('one', {
        concepts: ['term:lattice-replay-buffers'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
        embedding: undefined,
      }),
    ]);
    const packet = challenge('direct-concept-no-embedding', [
      demand('one', 1, {
        concepts: ['term:lattice-replay-buffers'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
        embedding: undefined,
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ], { concepts: ['term:lattice-replay-buffers'] });

    const result = alignCandidateToChallenge({ query: compiled.query, challenge: packet });

    expect(result.alignments).toHaveLength(1);
    expect(result.alignments[0]!.pairScore.semanticNarrative).toBe(0);
    expect(result.alignments[0]!.pairScore.conceptCorrespondence).toBe(1);
    expect(result.alignments[0]!.pairScore.total).toBe(1);
    expect(result.candidateEvidenceAlignment).toBe(1);
  });

  it('makes role discovery optional — a challenge is eligible without role requirements', () => {
    const compiled = compile([
      signal('one', {
        concepts: ['domain:payments'],
        problems: ['chargeback'],
        mechanisms: ['idempotency-key'],
      }),
      signal('two', {
        concepts: ['domain:fraud'],
        problems: ['false-positive'],
        mechanisms: ['rate-limiting'],
      }),
    ]);
    const packet = challenge('no-role', [
      demand('one', 0.5, {
        concepts: ['domain:payments'],
        problems: ['chargeback'],
        mechanisms: ['idempotency-key'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('two', 0.5, {
        family: 'second-family',
        concepts: ['domain:fraud'],
        problems: ['false-positive'],
        mechanisms: ['rate-limiting'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ]);

    const result = alignCandidateToChallenge({ query: compiled.query, challenge: packet });

    expect(result.eligible).toBe(true);
    expect(result.rejectionReasons).not.toContain('ROLE_RELEVANCE_BELOW_THRESHOLD');
    expect(result.rejectionReasons).not.toContain('NO_HIGH_WEIGHT_ROLE_REQUIREMENT');
  });

  it('accepts moderate source-backed coverage for roleless standalone review matches', () => {
    const compiled = compile([
      signal('use-popover-root', {
        concepts: ['term:use-popover-root'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
      signal('patient-click-threshold', {
        concepts: ['term:patient-click-threshold'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
      signal('javascript-test-runner', {
        concepts: ['term:javascript-test-runner'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
    ]);
    const packet = challenge('roleless-moderate', [
      demand('source', 1 / 6, {
        concepts: ['term:use-popover-root'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('threshold', 1 / 6, {
        concepts: ['term:patient-click-threshold'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('test', 1 / 6, {
        concepts: ['term:javascript-test-runner'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('calls', 1 / 6, {
        concepts: ['term:click-enabled-timeout-ref'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('imports', 1 / 6, {
        concepts: ['term:constants'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('contains', 1 / 6, {
        concepts: ['term:popover-trigger'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ], {
      concepts: [
        'term:use-popover-root',
        'term:patient-click-threshold',
        'term:javascript-test-runner',
        'term:click-enabled-timeout-ref',
        'term:constants',
        'term:popover-trigger',
      ],
    });

    const alignment = alignCandidateToChallenge({ query: compiled.query, challenge: packet });
    const ranked = rankReviewChallenges(compiled.query, [alignment]);
    const explanation = explainChallengeMatch(alignment, { scoreSeparation: 0.09 });

    expect(alignment.candidateEvidenceAlignment).toBeGreaterThanOrEqual(0.45);
    expect(alignment.candidateEvidenceAlignment).toBeLessThan(0.60);
    expect(alignment.eligible).toBe(true);
    expect(ranked.status).toBe('MATCHED');
    expect(explanation.assessmentQuality.verdict).not.toBe('WEAK');
  });

  it('accepts moderate candidate coverage when role-backed source terms align to a reviewable subset', () => {
    const compiled = compile([
      signal('use-popover-root', {
        concepts: ['term:use-popover-root'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
      signal('patient-click-threshold', {
        concepts: ['term:patient-click-threshold'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
      signal('typescript', {
        concepts: ['term:typescript'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
    ]);
    const packet = challenge('role-backed-moderate', [
      demand('source', 1 / 6, {
        concepts: ['term:use-popover-root'],
        roleRequirement: true,
        highWeightRoleRequirement: false,
      }),
      demand('threshold', 1 / 6, {
        concepts: ['term:patient-click-threshold'],
        roleRequirement: true,
        highWeightRoleRequirement: false,
      }),
      demand('typescript', 1 / 6, {
        concepts: ['term:typescript'],
        roleRequirement: true,
        highWeightRoleRequirement: false,
      }),
      demand('test', 1 / 6, {
        concepts: ['term:javascript-test-runner'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('calls', 1 / 6, {
        concepts: ['term:click-enabled-timeout-ref'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('contains', 1 / 6, {
        concepts: ['term:popover-trigger'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ], {
      concepts: [
        'term:use-popover-root',
        'term:patient-click-threshold',
        'term:typescript',
        'term:javascript-test-runner',
        'term:click-enabled-timeout-ref',
        'term:popover-trigger',
      ],
    });

    const alignment = alignCandidateToChallenge({ query: compiled.query, challenge: packet });
    const explanation = explainChallengeMatch(alignment, { scoreSeparation: 0.03 });

    expect(alignment.candidateEvidenceAlignment).toBeGreaterThanOrEqual(0.50);
    expect(alignment.candidateEvidenceAlignment).toBeLessThan(0.60);
    expect(alignment.roleRelevance).toBe(1);
    expect(alignment.eligible).toBe(true);
    expect(alignment.rejectionReasons).toEqual([]);
    expect(explanation.assessmentQuality.verdict).not.toBe('WEAK');
  });

  it('keeps source-backed role-overlap atoms when production resume extraction emits compound terms', () => {
    const roleConcepts = [
      'term:dom-id-versus-internal-registry-state',
      'term:javascript-test-runner-regression-tests',
      'term:patient-click-thresholds',
      'term:react',
      'term:rendered-trigger-id-ownership',
      'term:typescript',
      'term:use-popover-root',
    ];
    const compiled = compileCandidateMatchQuery({
      candidateSnapshotId: 'candidate-snapshot',
      roleSnapshotId: 'role-snapshot',
      roleGuardrails: {
        requiredLanguages: [],
        relevantConcepts: roleConcepts,
        genericConcepts: [],
      },
      selectionConcepts: roleConcepts,
      signals: [
        signal('deep-react-typescript', {
          episodeId: 'episode-resume',
          evidenceLevel: 'used',
          evidenceStrength: 0.85,
          confidence: 0.85,
          concepts: deriveCandidateSignalFacets({
            narrative: 'Candidate supplied review evidence for deep React typescript.',
            exactText: 'Senior frontend platform engineer with deep React and TypeScript experience.',
            concepts: ['term:deep-react-typescript'],
          }).concepts,
        }),
        signal('use-popover-root', {
          episodeId: 'episode-resume',
          evidenceLevel: 'implemented',
          evidenceStrength: 0.85,
          confidence: 0.85,
          concepts: deriveCandidateSignalFacets({
            narrative: 'Candidate supplied review evidence for click handling usePopoverRoot.',
            exactText: 'Recently implemented popover trigger click handling in usePopoverRoot for a large component library.',
            concepts: ['term:click-handling-use-popover-root'],
          }).concepts,
        }),
        signal('click-threshold-impatient', {
          episodeId: 'episode-resume',
          evidenceLevel: 'implemented',
          evidenceStrength: 0.85,
          confidence: 0.85,
          concepts: deriveCandidateSignalFacets({
            narrative: 'Candidate supplied review evidence for click threshold impatient.',
            exactText: 'Designed a patient click threshold so impatient trigger clicks do not immediately close hover-open popovers.',
            concepts: ['term:click-threshold-impatient'],
          }).concepts,
        }),
        signal('javascript-test-runner', {
          episodeId: 'episode-resume',
          evidenceLevel: 'validated',
          evidenceStrength: 0.85,
          confidence: 0.85,
          concepts: deriveCandidateSignalFacets({
            narrative: 'Candidate supplied review evidence for javascript test runner.',
            exactText: 'Comfortable assessing JavaScript test runner regression tests and maintainability trade-offs.',
            concepts: ['term:javascript-test-runner'],
          }).concepts,
        }),
      ],
    });

    const atomConcepts = new Set(compiled.query.validationAtoms.flatMap((atom) => atom.concepts));
    expect(atomConcepts.has('term:use-popover-root')).toBe(true);
    expect(atomConcepts.has('term:patient-click-threshold')).toBe(true);
    expect(atomConcepts.has('term:javascript-test-runner')).toBe(true);
    expect(compiled.query.validationAtoms.length).toBeGreaterThanOrEqual(3);
  });

  it('accepts sparse exact source-backed evidence when a role-backed PR is strongly role-relevant', () => {
    const compiled = compile([
      signal('use-popover-root', {
        concepts: ['term:use-popover-root'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
      signal('patient-click-threshold', {
        concepts: ['term:patient-click-threshold'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
    ]);
    const packet = challenge('role-backed-sparse-exact', [
      demand('source', 1 / 6, {
        concepts: ['term:use-popover-root'],
        roleRequirement: true,
        highWeightRoleRequirement: true,
      }),
      demand('threshold', 1 / 6, {
        concepts: ['term:patient-click-threshold'],
        roleRequirement: true,
        highWeightRoleRequirement: false,
      }),
      demand('rendered-trigger', 1 / 6, {
        concepts: ['term:rendered-trigger-id-ownership'],
        roleRequirement: true,
        highWeightRoleRequirement: false,
      }),
      demand('javascript-test', 1 / 6, {
        concepts: ['term:javascript-test-runner-regression-tests'],
        roleRequirement: true,
        highWeightRoleRequirement: false,
      }),
      demand('calls', 1 / 6, {
        concepts: ['term:click-enabled-timeout-ref'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('contains', 1 / 6, {
        concepts: ['term:popover-trigger'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ], {
      concepts: [
        'term:use-popover-root',
        'term:patient-click-threshold',
        'term:rendered-trigger-id-ownership',
        'term:javascript-test-runner-regression-tests',
        'term:click-enabled-timeout-ref',
        'term:popover-trigger',
      ],
    });

    const alignment = alignCandidateToChallenge({ query: compiled.query, challenge: packet });
    const ranked = rankReviewChallenges(compiled.query, [alignment]);
    const explanation = explainChallengeMatch(alignment);

    expect(alignment.candidateEvidenceAlignment).toBeGreaterThanOrEqual(0.10);
    expect(alignment.candidateEvidenceAlignment).toBeLessThan(0.50);
    expect(alignment.roleRelevance).toBeGreaterThanOrEqual(0.60);
    expect(alignment.eligible).toBe(true);
    expect(alignment.rejectionReasons).toEqual([]);
    expect(ranked.status).toBe('MATCHED');
    expect(explanation.assessmentQuality.verdict).toBe('USABLE');
  });

  it('accepts source-backed Workers SDK matches when broad extracted concepts dilute exact overlap', () => {
    const workersTerms = [
      'term:runtime',
      'term:wrangler',
      'term:workflows',
      'term:durable-object',
      'term:typed-array',
    ];
    const broadCandidateTerms = [
      'term:cloudflare-workers-sdk',
      'term:typescript',
      'term:edge-platform',
      'term:serverless-runtime',
      'term:request-routing',
      'term:deployment-pipeline',
      'term:test-harness',
      'term:compatibility-date',
      'term:configuration',
      'term:observability',
      'term:queue-processing',
    ];
    const broadDemandTerms = [
      'term:workers-sdk',
      'term:pull-request-review',
      'term:package-workspace',
      'term:regression-tests',
      'term:ci-fixtures',
      'term:source-map',
      'term:runtime-binding',
      'term:developer-experience',
      'term:miniflare',
      'term:vitest',
      'term:release-note',
    ];
    const compiled = compile(workersTerms.map((term) =>
      signal(term.replace('term:', 'workers-'), {
        narrative: `Source-backed resume evidence for ${term}.`,
        evidenceLevel: 'used',
        evidenceStrength: 0.85,
        confidence: 0.85,
        concepts: [term, ...broadCandidateTerms],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
        embedding: undefined,
      })
    ));
    const packet = challenge('workers-sdk-broad-overlap', workersTerms.map((term, index) =>
      demand(term.replace('term:', 'demand-'), 0.2, {
        family: `workers-family-${index}`,
        narrative: `Review a source-backed Workers SDK PR demand for ${term}.`,
        concepts: [term, ...broadDemandTerms],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
        embedding: undefined,
        roleRequirement: true,
        highWeightRoleRequirement: index === 0,
      })
    ), {
      id: 'workers-sdk-broad-overlap',
      repoId: 'cloudflare/workers-sdk',
      prNumber: 14150,
      concepts: [...workersTerms, ...broadDemandTerms],
    });

    const alignment = alignCandidateToChallenge({ query: compiled.query, challenge: packet });
    const ranked = rankReviewChallenges(compiled.query, [alignment]);
    const explanation = explainChallengeMatch(alignment);

    expect(alignment.candidateEvidenceAlignment).toBeGreaterThanOrEqual(0.07);
    expect(alignment.candidateEvidenceAlignment).toBeLessThan(0.50);
    expect(alignment.roleRelevance).toBeGreaterThanOrEqual(0.60);
    expect(alignment.provenanceComplete).toBe(true);
    expect(alignment.stretchCount).toBe(0);
    expect(alignment.eligible).toBe(true);
    expect(alignment.rejectionReasons).toEqual([]);
    expect(ranked.status).toBe('MATCHED');
    expect(explanation.assessmentQuality.verdict).toBe('USABLE');
  });

  it('accepts exact source-backed symbol evidence for roleless standalone review when corpus has one strong packet', () => {
    const compiled = compile([
      signal('use-popover-root', {
        concepts: ['term:use-popover-root'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
    ]);
    const packet = challenge('roleless-exact-symbol', [
      demand('source', 1 / 6, {
        concepts: ['term:use-popover-root'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('threshold', 1 / 6, {
        concepts: ['term:patient-click-threshold'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('test', 1 / 6, {
        concepts: ['term:javascript-test-runner'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('calls', 1 / 6, {
        concepts: ['term:click-enabled-timeout-ref'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('imports', 1 / 6, {
        concepts: ['term:constants'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
      demand('contains', 1 / 6, {
        concepts: ['term:popover-trigger'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ], {
      concepts: [
        'term:use-popover-root',
        'term:patient-click-threshold',
        'term:javascript-test-runner',
        'term:click-enabled-timeout-ref',
        'term:constants',
        'term:popover-trigger',
      ],
    });

    const alignment = alignCandidateToChallenge({ query: compiled.query, challenge: packet });
    const ranked = rankReviewChallenges(compiled.query, [alignment]);
    const explanation = explainChallengeMatch(alignment);

    expect(alignment.candidateEvidenceAlignment).toBeGreaterThanOrEqual(0.10);
    expect(alignment.candidateEvidenceAlignment).toBeLessThan(0.45);
    expect(alignment.eligible).toBe(true);
    expect(alignment.rejectionReasons).toEqual([]);
    expect(ranked.status).toBe('MATCHED');
    expect(explanation.assessmentQuality.verdict).toBe('USABLE');
  });

  it('still enforces role relevance when role-backed demand coverage is weak', () => {
    const compiled = compile([
      signal('one', {
        concepts: ['domain:payments'],
        problems: ['chargeback'],
        mechanisms: ['idempotency-key'],
      }),
    ]);
    const packet = challenge('role-required', [
      demand('one', 0.5, {
        concepts: ['domain:role-only'],
        problems: ['role-specific-review'],
        mechanisms: ['role-specific-mechanism'],
        roleRequirement: true,
        highWeightRoleRequirement: false,
      }),
      demand('two', 0.5, {
        family: 'second-family',
        concepts: ['domain:payments'],
        problems: ['chargeback'],
        mechanisms: ['idempotency-key'],
        roleRequirement: false,
        highWeightRoleRequirement: false,
      }),
    ]);

    const result = alignCandidateToChallenge({ query: compiled.query, challenge: packet });

    expect(result.eligible).toBe(false);
    expect(result.roleRelevance).toBeLessThan(0.60);
    expect(result.rejectionReasons).toContain('ROLE_RELEVANCE_BELOW_THRESHOLD');
  });

  it('includes explicit rejection reasons for every rejected packet', () => {
    const compiled = compile([
      signal('generic', {
        concepts: ['language:typescript'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
    ]);
    const packet = challenge('rejected', [
      demand('one', 1, {
        concepts: ['language:typescript'],
        problems: [],
        mechanisms: [],
        domains: [],
        businessObjects: [],
        ownershipActions: [],
      }),
    ], { concepts: ['language:typescript'] });
    const alignment = alignCandidateToChallenge({ query: compiled.query, challenge: packet });

    expect(alignment.eligible).toBe(false);
    expect(alignment.rejectionReasons.length).toBeGreaterThan(0);
    const explanation = explainChallengeMatch(alignment);
    expect(explanation.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(explanation.rejectionReasons).toEqual(alignment.rejectionReasons);
    expect(explanation.rejectionReasons.length).toBeGreaterThan(0);
  });
});
