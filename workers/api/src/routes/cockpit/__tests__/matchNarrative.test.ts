import { describe, expect, it } from 'vitest';
import { formatMatchNarrative } from '../../../lib/challengeMatching/matchNarrative';
import type { MatchExplanation } from '../../../lib/challengeMatching/types';

function makeMatchedExplanation(overrides?: Partial<MatchExplanation>): MatchExplanation {
  return {
    status: 'MATCHED',
    challengeId: 'challenge-1',
    repoId: 'repo-1',
    prNumber: 42,
    score: 0.85,
    summary: '',
    evidence: [{
      atomId: 'candidate-atom-1',
      demandId: 'repo-demand-1',
      purpose: 'validation',
      pairScore: 0.91,
      episodeMultiplier: 1,
      roleSourceRefs: [{
        entityId: 'role-source-1',
        locator: 'jd:span:1',
        conceptKeys: ['term:kafka'],
        exactText: 'Kafka experience required',
      }],
      candidateSourceRefs: [{
        artifactId: 'resume-artifact',
        artifactVersion: 'v1',
        contentHash: 'hash1',
        startOffset: 0,
        endOffset: 50,
        locator: 'resume line 7',
        exactText: 'Built Kafka order retries',
      }],
      challengeSourceRefs: [{
        artifactId: 'repo-artifact',
        artifactVersion: 'commit-abc',
        contentHash: 'hash2',
        startOffset: 100,
        endOffset: 200,
        locator: 'src/retry.ts:18',
        exactText: 'Add idempotent retry handling',
      }],
    }],
    candidateSpans: [],
    repoSpans: [],
    roleSources: [],
    rejectedPackets: [],
    missingEvidence: [],
    stretchAreas: [],
    unmatchedDemandIds: [],
    rejectionReasons: [],
    ...overrides,
  };
}

describe('match narrative — criteria #6: explain every match', () => {
  it('generates a narrative for a matched result', () => {
    const explanation = makeMatchedExplanation();
    const narrative = formatMatchNarrative(explanation);

    expect(narrative.title).toContain('PR #42');
    expect(narrative.title).toContain('85%');
    expect(narrative.verdict).toContain('Candidate matched');
    expect(narrative.verdict).toContain('1 direct evidence alignment');
    expect(narrative.sections.length).toBeGreaterThan(0);

    const directSection = narrative.sections.find((s) => s.heading === 'Direct Evidence');
    expect(directSection).toBeDefined();
    expect(directSection!.items[0]).toContain('[strong]');
    expect(directSection!.items[0]).toContain('candidate-atom-1');
    expect(directSection!.items[0]).toContain('repo-demand-1');
    expect(directSection!.items[0]).toContain('resume line 7');
    expect(directSection!.items[0]).toContain('src/retry.ts:18');
  });

  it('includes stretch areas in the narrative', () => {
    const explanation = makeMatchedExplanation({
      evidence: [{
        atomId: 'atom-1',
        demandId: 'demand-1',
        purpose: 'validation',
        pairScore: 0.6,
        episodeMultiplier: 1,
        stretch: {
          atomConcept: 'term:react',
          demandConcept: 'term:vue',
          dimension: 'technology',
        },
        roleSourceRefs: [],
        candidateSourceRefs: [],
        challengeSourceRefs: [],
      }],
      stretchAreas: [{
        atomId: 'atom-1',
        demandId: 'demand-1',
        atomConcept: 'term:react',
        demandConcept: 'term:vue',
        dimension: 'technology',
        candidateSourceRefs: [],
        challengeSourceRefs: [],
      }],
    });

    const narrative = formatMatchNarrative(explanation);
    const stretchSection = narrative.sections.find((s) => s.heading === 'Stretch Areas');
    expect(stretchSection).toBeDefined();
    expect(stretchSection!.items[0]).toContain('react');
    expect(stretchSection!.items[0]).toContain('vue');
  });

  it('reports evidence gaps and unmatched demands', () => {
    const explanation = makeMatchedExplanation({
      missingEvidence: [
        { scope: 'candidate', reason: 'No distributed systems evidence found' },
        { scope: 'role', reason: 'Senior-level experience required' },
      ],
      unmatchedDemandIds: ['demand-orphan-1', 'demand-orphan-2'],
    });

    const narrative = formatMatchNarrative(explanation);
    const gapSection = narrative.sections.find((s) => s.heading === 'Evidence Gaps');
    expect(gapSection).toBeDefined();
    expect(gapSection!.items).toEqual(expect.arrayContaining([
      expect.stringContaining('[candidate]'),
      expect.stringContaining('[role-required]'),
      expect.stringContaining('2 unmatched PR demand'),
    ]));
  });

  it('handles NEEDS_MORE_EVIDENCE status', () => {
    const explanation = makeMatchedExplanation({
      status: 'NEEDS_MORE_EVIDENCE',
      score: 0.3,
      evidence: [],
    });

    const narrative = formatMatchNarrative(explanation);
    expect(narrative.title).toContain('Insufficient Evidence');
    expect(narrative.verdict).toContain('insufficient evidence');
  });

  it('handles NO_ROLE_SAFE_CHALLENGE status', () => {
    const explanation = makeMatchedExplanation({
      status: 'NO_ROLE_SAFE_CHALLENGE',
      score: 0,
      evidence: [],
      rejectionReasons: ['PROVENANCE_INCOMPLETE', 'GENERIC_DEMAND_ONLY'],
    });

    const narrative = formatMatchNarrative(explanation);
    expect(narrative.title).toContain('No Suitable Challenge');
    expect(narrative.verdict).toContain('PROVENANCE_INCOMPLETE');
  });

  it('classifies alignment strength correctly', () => {
    const explanation = makeMatchedExplanation({
      evidence: [
        {
          atomId: 'strong-atom', demandId: 'demand-1', purpose: 'validation',
          pairScore: 0.95, episodeMultiplier: 1,
          roleSourceRefs: [], candidateSourceRefs: [], challengeSourceRefs: [],
        },
        {
          atomId: 'moderate-atom', demandId: 'demand-2', purpose: 'validation',
          pairScore: 0.65, episodeMultiplier: 1,
          roleSourceRefs: [], candidateSourceRefs: [], challengeSourceRefs: [],
        },
        {
          atomId: 'partial-atom', demandId: 'demand-3', purpose: 'validation',
          pairScore: 0.35, episodeMultiplier: 1,
          roleSourceRefs: [], candidateSourceRefs: [], challengeSourceRefs: [],
        },
      ],
    });

    const narrative = formatMatchNarrative(explanation);
    const section = narrative.sections.find((s) => s.heading === 'Direct Evidence');
    expect(section).toBeDefined();
    expect(section!.items[0]).toContain('[strong]');
    expect(section!.items[1]).toContain('[moderate]');
    expect(section!.items[2]).toContain('[partial]');
  });

  it('plainText includes all sections', () => {
    const explanation = makeMatchedExplanation({
      stretchAreas: [{
        atomId: 'atom-1', demandId: 'demand-1',
        atomConcept: 'a', demandConcept: 'b', dimension: 'domain',
        candidateSourceRefs: [], challengeSourceRefs: [],
      }],
      missingEvidence: [{ scope: 'candidate', reason: 'gap1' }],
    });

    const narrative = formatMatchNarrative(explanation);
    expect(narrative.plainText).toContain('## Direct Evidence');
    expect(narrative.plainText).toContain('## Stretch Areas');
    expect(narrative.plainText).toContain('## Evidence Gaps');
  });
});
