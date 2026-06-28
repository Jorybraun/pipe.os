import { describe, expect, it } from 'vitest';
import { formatMatchNarrative } from '../matchNarrative';
import type { MatchExplanation } from '../types';

function minimalExplanation(overrides: Partial<MatchExplanation> = {}): MatchExplanation {
  return {
    status: 'MATCHED',
    score: 0.85,
    summary: 'Strong match',
    evidence: [],
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

describe('formatMatchNarrative', () => {
  it('produces a matched narrative with direct evidence', () => {
    const explanation = minimalExplanation({
      selectedPr: { challengeId: 'ch-1', repoId: 'repo-1', prNumber: 42, sourceVersion: 'v1' },
      evidence: [
        {
          atomId: 'atom-1',
          demandId: 'demand-1',
          purpose: 'validation',
          pairScore: 0.9,
          episodeMultiplier: 1,
          roleSourceRefs: [],
          candidateSourceRefs: [{
            artifactId: 'a1',
            artifactVersion: 'v1',
            contentHash: 'h1',
            startOffset: 0,
            endOffset: 100,
            exactText: 'Built distributed caching layer',
          }],
          challengeSourceRefs: [{
            artifactId: 'a2',
            artifactVersion: 'v1',
            contentHash: 'h2',
            startOffset: 0,
            endOffset: 50,
            locator: 'src/cache.ts:10-25',
          }],
        },
      ],
    });

    const narrative = formatMatchNarrative(explanation);

    expect(narrative.title).toContain('PR #42');
    expect(narrative.title).toContain('85%');
    expect(narrative.verdict).toContain('1 direct evidence alignment');
    expect(narrative.sections).toHaveLength(1);
    expect(narrative.sections[0].heading).toBe('Direct Evidence');
    expect(narrative.sections[0].items[0]).toContain('[strong]');
    expect(narrative.sections[0].items[0]).toContain('atom-1');
    expect(narrative.sections[0].items[0]).toContain('demand-1');
    expect(narrative.plainText).toContain('Direct Evidence');
  });

  it('reports stretch areas and evidence gaps', () => {
    const explanation = minimalExplanation({
      prNumber: 99,
      score: 0.6,
      stretchAreas: [
        {
          atomId: 'atom-2',
          demandId: 'demand-2',
          atomConcept: 'React',
          demandConcept: 'Vue',
          dimension: 'technology',
          candidateSourceRefs: [],
          challengeSourceRefs: [],
        },
      ],
      missingEvidence: [
        { scope: 'candidate', reason: 'No evidence of GraphQL experience' },
        { scope: 'role', reason: 'Role requires senior-level system design' },
      ],
      unmatchedDemandIds: ['demand-3', 'demand-4'],
    });

    const narrative = formatMatchNarrative(explanation);

    expect(narrative.sections.some((s) => s.heading === 'Stretch Areas')).toBe(true);
    expect(narrative.sections.some((s) => s.heading === 'Evidence Gaps')).toBe(true);

    const stretchSection = narrative.sections.find((s) => s.heading === 'Stretch Areas');
    expect(stretchSection?.items[0]).toContain('React → Vue');
    expect(stretchSection?.items[0]).toContain('technology');

    const gapSection = narrative.sections.find((s) => s.heading === 'Evidence Gaps');
    expect(gapSection?.items.some((i) => i.includes('[role-required]'))).toBe(true);
    expect(gapSection?.items.some((i) => i.includes('[candidate]'))).toBe(true);
    expect(gapSection?.items.some((i) => i.includes('2 unmatched PR demands'))).toBe(true);
  });

  it('handles NEEDS_MORE_EVIDENCE status', () => {
    const explanation = minimalExplanation({
      status: 'NEEDS_MORE_EVIDENCE',
      score: 0.3,
      prNumber: 10,
    });

    const narrative = formatMatchNarrative(explanation);

    expect(narrative.title).toContain('Insufficient Evidence');
    expect(narrative.verdict).toContain('insufficient evidence');
  });

  it('handles NO_ROLE_SAFE_CHALLENGE status', () => {
    const explanation = minimalExplanation({
      status: 'NO_ROLE_SAFE_CHALLENGE',
      score: 0,
      rejectionReasons: ['No challenge meets language requirements'],
    });

    const narrative = formatMatchNarrative(explanation);

    expect(narrative.title).toContain('No Suitable Challenge Found');
    expect(narrative.verdict).toContain('No challenge meets language requirements');
  });

  it('classifies alignment strength correctly', () => {
    const explanation = minimalExplanation({
      prNumber: 1,
      evidence: [
        {
          atomId: 'a1', demandId: 'd1', purpose: 'validation', pairScore: 0.9,
          episodeMultiplier: 1, roleSourceRefs: [], candidateSourceRefs: [], challengeSourceRefs: [],
        },
        {
          atomId: 'a2', demandId: 'd2', purpose: 'validation', pairScore: 0.6,
          episodeMultiplier: 1, roleSourceRefs: [], candidateSourceRefs: [], challengeSourceRefs: [],
        },
        {
          atomId: 'a3', demandId: 'd3', purpose: 'deepening', pairScore: 0.3,
          episodeMultiplier: 1, roleSourceRefs: [], candidateSourceRefs: [], challengeSourceRefs: [],
        },
      ],
    });

    const narrative = formatMatchNarrative(explanation);
    const items = narrative.sections[0].items;

    expect(items[0]).toContain('[strong]');
    expect(items[1]).toContain('[moderate]');
    expect(items[2]).toContain('[partial]');
  });

  it('truncates long exactText in source locators', () => {
    const longText = 'A'.repeat(100);
    const explanation = minimalExplanation({
      prNumber: 5,
      evidence: [
        {
          atomId: 'a1', demandId: 'd1', purpose: 'validation', pairScore: 0.8,
          episodeMultiplier: 1, roleSourceRefs: [],
          candidateSourceRefs: [{
            artifactId: 'a1', artifactVersion: 'v1', contentHash: 'h1',
            startOffset: 0, endOffset: 100, exactText: longText,
          }],
          challengeSourceRefs: [],
        },
      ],
    });

    const narrative = formatMatchNarrative(explanation);
    expect(narrative.plainText).toContain('...');
    expect(narrative.plainText.length).toBeLessThan(longText.length + 500);
  });
});
