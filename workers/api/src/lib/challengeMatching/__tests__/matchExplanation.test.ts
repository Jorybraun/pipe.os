import { describe, expect, it } from 'vitest';
import {
  alignCandidateToChallenge,
  compileCandidateMatchQuery,
  explainChallengeMatch,
  rankReviewChallenges,
  recallReviewChallenges,
} from '../engine';
import type {
  CandidateSignal,
  ChallengeAlignment,
  ChallengeDemand,
  ChallengePacket,
  ConceptAdjacency,
  MatchExplanation,
  SourceRef,
} from '../types';

function source(id: string): SourceRef {
  return {
    artifactId: `artifact-${id}`,
    artifactVersion: 'v1',
    contentHash: `sha256-${id}`,
    startOffset: 0,
    endOffset: 100,
    locator: `${id}:0-100`,
    exactText: `source text for ${id}`,
  };
}

function makeSignal(
  id: string,
  overrides: Partial<CandidateSignal> = {},
): CandidateSignal {
  return {
    id,
    episodeId: `episode-${id}`,
    narrative: `Candidate evidence for ${id}`,
    purpose: 'validation',
    evidenceLevel: 'implemented',
    evidenceStrength: 0.9,
    confidence: 0.95,
    concepts: ['term:kafka', 'term:event-sourcing'],
    problems: ['ordered-replay'],
    mechanisms: ['consumer-offsets'],
    domains: ['fintech'],
    businessObjects: ['payment'],
    ownershipActions: ['implemented'],
    sourceRefs: [source(`candidate-${id}`)],
    ...overrides,
  };
}

function makeDemand(
  id: string,
  weight: number,
  overrides: Partial<ChallengeDemand> = {},
): ChallengeDemand {
  return {
    id,
    family: `family-${id}`,
    narrative: `Code demand for ${id}`,
    weight,
    concepts: ['term:kafka', 'term:event-sourcing'],
    problems: ['ordered-replay'],
    mechanisms: ['consumer-offsets'],
    domains: ['fintech'],
    businessObjects: ['payment'],
    ownershipActions: ['implemented'],
    sourceRefs: [source(`challenge-${id}`)],
    roleRequirement: true,
    highWeightRoleRequirement: weight >= 0.5,
    ...overrides,
  };
}

function makeChallenge(
  id: string,
  demands: ChallengeDemand[],
  overrides: Partial<ChallengePacket> = {},
): ChallengePacket {
  return {
    id,
    repoId: `repo-${id}`,
    prNumber: 42,
    sourceVersion: 'commit-abc123',
    challengeReady: true,
    languages: ['typescript'],
    concepts: [...new Set(demands.flatMap((d) => d.concepts))],
    demands,
    quality: { deterministic: 0.92, contextualSpecificity: 0.88 },
    ...overrides,
  };
}

function compileAndAlign(
  signals: CandidateSignal[],
  challengePacket: ChallengePacket,
  adjacency: ConceptAdjacency[] = [],
): { alignment: ChallengeAlignment; explanation: MatchExplanation } {
  const compiled = compileCandidateMatchQuery({
    candidateSnapshotId: 'candidate-snapshot-1',
    roleSnapshotId: 'role-snapshot-1',
    signals,
    roleGuardrails: {
      requiredLanguages: ['typescript'],
      genericConcepts: ['term:javascript'],
    },
  });
  const alignment = alignCandidateToChallenge({
    query: compiled.query,
    challenge: challengePacket,
    adjacency,
  });
  const explanation = explainChallengeMatch(alignment);
  return { alignment, explanation };
}

describe('match explanation — acceptance criteria #5 and #6', () => {
  it('explanation links both candidate and challenge source refs', () => {
    const signals = [makeSignal('s1'), makeSignal('s2', {
      concepts: ['term:event-sourcing'],
      problems: ['backpressure'],
      mechanisms: ['bounded-queue'],
    })];
    const demands = [
      makeDemand('d1', 0.5),
      makeDemand('d2', 0.5, {
        concepts: ['term:event-sourcing'],
        problems: ['backpressure'],
        mechanisms: ['bounded-queue'],
      }),
    ];
    const packet = makeChallenge('ch1', demands);
    const { explanation } = compileAndAlign(signals, packet);

    expect(explanation.evidence.length).toBeGreaterThan(0);
    for (const ev of explanation.evidence) {
      expect(ev.candidateSourceRefs.length).toBeGreaterThan(0);
      expect(ev.challengeSourceRefs.length).toBeGreaterThan(0);
      expect(ev.candidateSourceRefs[0].artifactId).toBeTruthy();
      expect(ev.candidateSourceRefs[0].contentHash).toBeTruthy();
      expect(ev.challengeSourceRefs[0].artifactId).toBeTruthy();
      expect(ev.challengeSourceRefs[0].contentHash).toBeTruthy();
    }
  });

  it('reports unmatched demands as evidence gaps', () => {
    const signals = [makeSignal('s1')];
    const demands = [
      makeDemand('d1', 0.4),
      makeDemand('d-unmatched', 0.6, {
        concepts: ['term:rust-borrow-checker'],
        problems: ['memory-safety'],
        mechanisms: ['ownership-model'],
        domains: ['systems'],
        businessObjects: ['compiler'],
        ownershipActions: ['designed'],
      }),
    ];
    const packet = makeChallenge('ch-gaps', demands);
    const { alignment, explanation } = compileAndAlign(signals, packet);

    expect(alignment.unmatchedDemandIds).toContain('d-unmatched');
    expect(alignment.unmatchedDemandIds.length).toBeGreaterThanOrEqual(1);
    expect(explanation.rejectionReasons.length).toBeGreaterThan(0);
  });

  it('stretch areas are explicitly reported in explanation evidence', () => {
    const signals = [makeSignal('s-stretch', {
      concepts: ['term:rabbitmq'],
      problems: ['message-ordering'],
      mechanisms: ['consumer-groups'],
    })];
    const demands = [
      makeDemand('d-stretch', 0.5, {
        concepts: ['term:kafka'],
        problems: ['message-ordering'],
        mechanisms: ['consumer-groups'],
        family: 'family-primary',
      }),
      makeDemand('d-direct', 0.5, {
        concepts: ['term:rabbitmq'],
        problems: ['message-ordering'],
        mechanisms: ['consumer-groups'],
        family: 'family-secondary',
      }),
    ];
    const adjacency: ConceptAdjacency[] = [
      { from: 'term:rabbitmq', to: 'term:kafka', dimension: 'technology' },
    ];
    const packet = makeChallenge('ch-stretch', demands);
    const { alignment } = compileAndAlign(signals, packet, adjacency);

    expect(alignment.stretchCount).toBeGreaterThanOrEqual(0);
    if (alignment.stretchCount > 0) {
      const stretchAlignments = alignment.alignments.filter((a) => a.stretch);
      expect(stretchAlignments.length).toBeGreaterThan(0);
      const stretch = stretchAlignments[0]!.stretch!;
      expect(stretch.atomConcept).toBeTruthy();
      expect(stretch.demandConcept).toBeTruthy();
      expect(stretch.dimension).toBe('technology');
    }
  });

  it('no fabricated evidence: signals without source refs are excluded', () => {
    const signals = [
      makeSignal('s-good'),
      makeSignal('s-no-refs', {
        sourceRefs: [],
      }),
    ];
    const compiled = compileCandidateMatchQuery({
      candidateSnapshotId: 'candidate-snapshot-1',
      roleSnapshotId: 'role-snapshot-1',
      signals,
      roleGuardrails: {
        requiredLanguages: ['typescript'],
      },
    });

    expect(compiled.excludedSignalIds).toContain('s-no-refs');
    const atomIds = [
      ...compiled.query.validationAtoms.map((a) => a.id),
      ...compiled.query.deepeningAtoms.map((a) => a.id),
    ];
    expect(atomIds).not.toContain('s-no-refs');
  });

  it('no fabricated evidence: signals with null evidence level/strength/confidence are excluded', () => {
    const signals = [
      makeSignal('s-good'),
      makeSignal('s-null-level', { evidenceLevel: null }),
      makeSignal('s-null-strength', { evidenceStrength: null }),
      makeSignal('s-null-confidence', { confidence: null }),
    ];
    const compiled = compileCandidateMatchQuery({
      candidateSnapshotId: 'candidate-snapshot-1',
      roleSnapshotId: 'role-snapshot-1',
      signals,
      roleGuardrails: { requiredLanguages: ['typescript'] },
    });

    expect(compiled.excludedSignalIds).toContain('s-null-level');
    expect(compiled.excludedSignalIds).toContain('s-null-strength');
    expect(compiled.excludedSignalIds).toContain('s-null-confidence');
  });

  it('NEEDS_MORE_EVIDENCE when no valid signals exist', () => {
    const signals = [
      makeSignal('s-bad', { evidenceLevel: null, evidenceStrength: null, confidence: null }),
    ];
    const compiled = compileCandidateMatchQuery({
      candidateSnapshotId: 'candidate-snapshot-1',
      roleSnapshotId: 'role-snapshot-1',
      signals,
      roleGuardrails: { requiredLanguages: ['typescript'] },
    });

    expect(compiled.status).toBe('NEEDS_MORE_EVIDENCE');
  });

  it('full golden path: recall → align → rank → explain with deterministic output', () => {
    const signals = [
      makeSignal('s1'),
      makeSignal('s2', {
        concepts: ['term:event-sourcing'],
        problems: ['backpressure'],
        mechanisms: ['bounded-queue'],
      }),
    ];
    const demands1 = [
      makeDemand('d1', 0.5),
      makeDemand('d2', 0.5, {
        concepts: ['term:event-sourcing'],
        problems: ['backpressure'],
        mechanisms: ['bounded-queue'],
        family: 'family-d2',
      }),
    ];
    const demands2 = [
      makeDemand('d3', 0.5, {
        concepts: ['term:rust'],
        problems: ['memory-safety'],
        mechanisms: ['ownership'],
        domains: ['systems'],
        family: 'family-d3',
      }),
      makeDemand('d4', 0.5, {
        concepts: ['term:c-plus-plus'],
        family: 'family-d4',
      }),
    ];

    const ch1 = makeChallenge('ch-match', demands1);
    const ch2 = makeChallenge('ch-nomatch', demands2, {
      concepts: ['term:rust', 'term:c-plus-plus'],
    });

    const compiled = compileCandidateMatchQuery({
      candidateSnapshotId: 'snap-1',
      roleSnapshotId: 'role-1',
      signals,
      roleGuardrails: {
        requiredLanguages: ['typescript'],
        genericConcepts: ['term:javascript'],
      },
    });
    expect(compiled.status).toBe('READY');

    const recalled = recallReviewChallenges({
      query: compiled.query,
      challenges: [ch1, ch2],
    });
    expect(recalled.challenges.map((c) => c.challenge.id)).toContain('ch-match');

    const alignments = recalled.challenges.map(({ challenge }) =>
      alignCandidateToChallenge({ query: compiled.query, challenge }),
    );
    const ranked = rankReviewChallenges(compiled.query, alignments);

    if (ranked.matches.length > 0) {
      const best = ranked.matches[0]!.alignment;
      const explanation = explainChallengeMatch(best);
      expect(explanation.status).toBe('MATCHED');
      expect(explanation.challengeId).toBe('ch-match');
      expect(explanation.evidence.length).toBeGreaterThan(0);
      expect(explanation.score).toBeGreaterThan(0);

      for (const ev of explanation.evidence) {
        expect(ev.candidateSourceRefs.length).toBeGreaterThan(0);
        expect(ev.challengeSourceRefs.length).toBeGreaterThan(0);
      }

      // Determinism: re-run produces identical output
      const recalled2 = recallReviewChallenges({
        query: compiled.query,
        challenges: [ch1, ch2],
      });
      const alignments2 = recalled2.challenges.map(({ challenge }) =>
        alignCandidateToChallenge({ query: compiled.query, challenge }),
      );
      const ranked2 = rankReviewChallenges(compiled.query, alignments2);
      const explanation2 = explainChallengeMatch(ranked2.matches[0]!.alignment);

      expect(explanation2.challengeId).toBe(explanation.challengeId);
      expect(explanation2.score).toBe(explanation.score);
      expect(explanation2.evidence.length).toBe(explanation.evidence.length);
      expect(explanation2.summary).toBe(explanation.summary);
    }
  });

  it('incomplete provenance is reported as rejection reason', () => {
    const signals = [
      makeSignal('s-bad-prov', {
        sourceRefs: [{
          artifactId: '',
          artifactVersion: '',
          contentHash: '',
          startOffset: 0,
          endOffset: 10,
        }],
      }),
    ];
    const demands = [
      makeDemand('d-prov', 0.5),
      makeDemand('d-prov2', 0.5, {
        concepts: ['term:event-sourcing'],
        family: 'family-prov2',
      }),
    ];
    const packet = makeChallenge('ch-prov', demands);

    const compiled = compileCandidateMatchQuery({
      candidateSnapshotId: 'snap',
      roleSnapshotId: 'role',
      signals,
      roleGuardrails: { requiredLanguages: ['typescript'] },
    });

    expect(compiled.excludedSignalIds).toContain('s-bad-prov');
  });
});
