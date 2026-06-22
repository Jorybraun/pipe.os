import { describe, it, expect } from 'vitest';
import { formatMatchNarrative } from '../matchNarrative';
import type { MatchExplanation, SourceRef } from '../types';

function sourceRef(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    artifactId: 'art-1',
    artifactVersion: 'v1',
    contentHash: 'abc123',
    startOffset: 0,
    endOffset: 100,
    ...overrides,
  };
}

function matchedExplanation(overrides: Partial<MatchExplanation> = {}): MatchExplanation {
  return {
    status: 'MATCHED',
    challengeId: 'challenge-1',
    repoId: 'repo-acme',
    prNumber: 42,
    score: 0.78,
    summary: 'Matched 3 source-backed demands.',
    evidence: [
      {
        atomId: 'atom-1',
        demandId: 'demand-1',
        purpose: 'validation',
        pairScore: 0.85,
        episodeMultiplier: 1,
        candidateSourceRefs: [sourceRef({ locator: 'resume.pdf:L12' })],
        challengeSourceRefs: [sourceRef({ locator: 'src/auth.ts:45-60' })],
      },
      {
        atomId: 'atom-2',
        demandId: 'demand-2',
        purpose: 'validation',
        pairScore: 0.62,
        episodeMultiplier: 1,
        candidateSourceRefs: [sourceRef({ locator: 'meeting-2024-01.txt:P3' })],
        challengeSourceRefs: [sourceRef({ locator: 'src/db/queries.ts:10-25' })],
      },
    ],
    unmatchedDemands: [],
    stretchAreas: [],
    rejectionReasons: [],
    ...overrides,
  };
}

describe('formatMatchNarrative — acceptance criterion #6', () => {
  it('produces a title with PR number and score for matched explanations', () => {
    const narrative = formatMatchNarrative(matchedExplanation());
    expect(narrative.title).toBe('Match: PR #42 (score 78%)');
  });

  it('produces a title indicating rejection for non-matched explanations', () => {
    const narrative = formatMatchNarrative(matchedExplanation({
      status: 'NO_ROLE_SAFE_CHALLENGE',
      score: 0.2,
      rejectionReasons: ['STRETCH_WEIGHT_EXCEEDED'],
    }));
    expect(narrative.title).toBe('No Match: PR #42');
    expect(narrative.verdict).toContain('STRETCH_WEIGHT_EXCEEDED');
  });

  it('includes direct evidence alignment section with source locators', () => {
    const narrative = formatMatchNarrative(matchedExplanation());
    const directSection = narrative.sections.find((s) => s.heading === 'Direct Evidence Alignments');
    expect(directSection).toBeDefined();
    expect(directSection!.body).toContain('resume.pdf:L12');
    expect(directSection!.body).toContain('src/auth.ts:45-60');
    expect(directSection!.body).toContain('strong alignment (85%)');
    expect(directSection!.body).toContain('moderate alignment (62%)');
  });

  it('categorizes alignment strength correctly', () => {
    const narrative = formatMatchNarrative(matchedExplanation({
      evidence: [
        {
          atomId: 'atom-1',
          demandId: 'demand-1',
          purpose: 'validation',
          pairScore: 0.95,
          episodeMultiplier: 1,
          candidateSourceRefs: [sourceRef()],
          challengeSourceRefs: [sourceRef()],
        },
        {
          atomId: 'atom-2',
          demandId: 'demand-2',
          purpose: 'validation',
          pairScore: 0.3,
          episodeMultiplier: 1,
          candidateSourceRefs: [sourceRef()],
          challengeSourceRefs: [sourceRef()],
        },
      ],
    }));
    const directSection = narrative.sections.find((s) => s.heading === 'Direct Evidence Alignments');
    expect(directSection!.body).toContain('strong alignment (95%)');
    expect(directSection!.body).toContain('partial alignment (30%)');
  });

  it('includes stretch alignment section when stretch evidence exists', () => {
    const narrative = formatMatchNarrative(matchedExplanation({
      evidence: [
        {
          atomId: 'atom-1',
          demandId: 'demand-1',
          purpose: 'validation',
          pairScore: 0.7,
          episodeMultiplier: 1,
          stretch: { atomConcept: 'react', demandConcept: 'vue', dimension: 'technology' },
          candidateSourceRefs: [sourceRef()],
          challengeSourceRefs: [sourceRef()],
        },
      ],
      stretchAreas: [{
        atomId: 'atom-1',
        demandId: 'demand-1',
        atomConcept: 'react',
        demandConcept: 'vue',
        dimension: 'technology',
        candidateNarrative: 'Built React components',
        demandNarrative: 'Vue component architecture',
        candidateSourceRefs: [sourceRef({ exactText: 'Implemented complex React hooks' })],
        challengeSourceRefs: [sourceRef()],
      }],
    }));
    const stretchSection = narrative.sections.find((s) => s.heading === 'Stretch Areas');
    expect(stretchSection).toBeDefined();
    expect(stretchSection!.body).toContain('react');
    expect(stretchSection!.body).toContain('vue');
    expect(stretchSection!.body).toContain('technology');
    expect(stretchSection!.body).toContain('Implemented complex React hooks');
  });

  it('includes evidence gaps section separating role-required from other gaps', () => {
    const narrative = formatMatchNarrative(matchedExplanation({
      unmatchedDemands: [
        {
          demandId: 'demand-3',
          family: 'infrastructure',
          narrative: 'Kubernetes pod scheduling and resource limits configuration',
          weight: 0.8,
          concepts: ['kubernetes', 'container-orchestration'],
          challengeSourceRefs: [sourceRef({ locator: 'deploy/k8s.yaml:10-30' })],
          roleRequirement: true,
        },
        {
          demandId: 'demand-4',
          family: 'observability',
          narrative: 'Prometheus metrics instrumentation',
          weight: 0.3,
          concepts: ['prometheus', 'observability'],
          challengeSourceRefs: [sourceRef()],
          roleRequirement: false,
        },
      ],
    }));
    const gapsSection = narrative.sections.find((s) => s.heading === 'Evidence Gaps');
    expect(gapsSection).toBeDefined();
    expect(gapsSection!.body).toContain('Role-required gaps:');
    expect(gapsSection!.body).toContain('Kubernetes pod scheduling');
    expect(gapsSection!.body).toContain('[kubernetes, container-orchestration]');
    expect(gapsSection!.body).toContain('Additional gaps:');
    expect(gapsSection!.body).toContain('Prometheus metrics');
  });

  it('omits gaps section when there are no unmatched demands', () => {
    const narrative = formatMatchNarrative(matchedExplanation({ unmatchedDemands: [] }));
    const gapsSection = narrative.sections.find((s) => s.heading === 'Evidence Gaps');
    expect(gapsSection).toBeUndefined();
  });

  it('produces plainText combining all sections', () => {
    const narrative = formatMatchNarrative(matchedExplanation({
      unmatchedDemands: [{
        demandId: 'demand-3',
        family: 'infra',
        narrative: 'Deploy to production',
        weight: 0.5,
        concepts: ['deployment'],
        challengeSourceRefs: [sourceRef()],
        roleRequirement: false,
      }],
    }));
    expect(narrative.plainText).toContain('Match: PR #42');
    expect(narrative.plainText).toContain('## Direct Evidence Alignments');
    expect(narrative.plainText).toContain('## Evidence Gaps');
  });

  it('verdict includes counts for direct, stretch, and gap', () => {
    const narrative = formatMatchNarrative(matchedExplanation({
      evidence: [
        {
          atomId: 'atom-1', demandId: 'demand-1', purpose: 'validation',
          pairScore: 0.9, episodeMultiplier: 1,
          candidateSourceRefs: [sourceRef()], challengeSourceRefs: [sourceRef()],
        },
        {
          atomId: 'atom-2', demandId: 'demand-2', purpose: 'validation',
          pairScore: 0.6, episodeMultiplier: 1,
          stretch: { atomConcept: 'a', demandConcept: 'b', dimension: 'domain' },
          candidateSourceRefs: [sourceRef()], challengeSourceRefs: [sourceRef()],
        },
      ],
      stretchAreas: [{
        atomId: 'atom-2', demandId: 'demand-2',
        atomConcept: 'a', demandConcept: 'b', dimension: 'domain',
        candidateNarrative: 'n', demandNarrative: 'n',
        candidateSourceRefs: [sourceRef()], challengeSourceRefs: [sourceRef()],
      }],
      unmatchedDemands: [{
        demandId: 'demand-3', family: 'x', narrative: 'gap',
        weight: 0.4, concepts: [], challengeSourceRefs: [sourceRef()],
        roleRequirement: false,
      }],
    }));
    expect(narrative.verdict).toContain('1 direct evidence alignment');
    expect(narrative.verdict).toContain('1 stretch area');
    expect(narrative.verdict).toContain('1 evidence gap');
  });

  it('collects all source refs per section for provenance linking', () => {
    const candidateRef = sourceRef({ locator: 'resume.pdf:L5' });
    const challengeRef = sourceRef({ locator: 'src/main.ts:1-10' });
    const narrative = formatMatchNarrative(matchedExplanation({
      evidence: [{
        atomId: 'atom-1', demandId: 'demand-1', purpose: 'validation',
        pairScore: 0.8, episodeMultiplier: 1,
        candidateSourceRefs: [candidateRef],
        challengeSourceRefs: [challengeRef],
      }],
    }));
    const directSection = narrative.sections.find((s) => s.heading === 'Direct Evidence Alignments');
    expect(directSection!.sourceRefs).toContain(candidateRef);
    expect(directSection!.sourceRefs).toContain(challengeRef);
  });

  it('handles explanation with no evidence gracefully', () => {
    const narrative = formatMatchNarrative(matchedExplanation({
      status: 'NO_ROLE_SAFE_CHALLENGE',
      evidence: [],
      rejectionReasons: ['NO_PROVENANCE'],
    }));
    expect(narrative.sections).toHaveLength(0);
    expect(narrative.verdict).toContain('NO_PROVENANCE');
  });

  it('falls back to offset-based locator when locator field is absent', () => {
    const narrative = formatMatchNarrative(matchedExplanation({
      evidence: [{
        atomId: 'atom-1', demandId: 'demand-1', purpose: 'validation',
        pairScore: 0.9, episodeMultiplier: 1,
        candidateSourceRefs: [sourceRef({ locator: undefined, artifactVersion: 'v2', startOffset: 50, endOffset: 120 })],
        challengeSourceRefs: [sourceRef({ locator: 'file.ts:1' })],
      }],
    }));
    const directSection = narrative.sections.find((s) => s.heading === 'Direct Evidence Alignments');
    expect(directSection!.body).toContain('v2[50:120]');
  });
});
