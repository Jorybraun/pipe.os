import { describe, it, expect } from 'vitest';
import type {
  ProvenanceMatchDecision,
  ProvenanceDemandLink,
  ProvenanceSignalNode,
  ProvenanceAssertionNode,
  ProvenanceArtifactNode,
  ProvenanceInteractionNode,
  ProvenanceChainEntry,
  MatchProvenanceChain,
} from '../matchProvenanceChain';

describe('matchProvenanceChain types', () => {
  it('ProvenanceMatchDecision has correct shape', () => {
    const decision: ProvenanceMatchDecision = {
      matchRunId: 'run-1',
      candidateId: 'cand-1',
      status: 'MATCHED',
      selectedPacketId: 'pkt-1',
      policyVersion: 'candidate-pr-v1',
      createdAt: 1719705600,
    };

    expect(decision.matchRunId).toBe('run-1');
    expect(decision.status).toBe('MATCHED');
    expect(decision.selectedPacketId).toBe('pkt-1');
  });

  it('ProvenanceDemandLink includes stretch info when present', () => {
    const link: ProvenanceDemandLink = {
      demandId: 'd-1',
      demandNarrative: 'TypeScript API development',
      demandWeight: 0.8,
      demandConcepts: ['lang:typescript', 'pattern:api'],
      atomId: 'atom-1',
      pairScore: 0.85,
      stretch: {
        atomConcept: 'lang:javascript',
        demandConcept: 'lang:typescript',
        dimension: 'technology',
      },
    };

    expect(link.stretch).not.toBeNull();
    expect(link.stretch?.dimension).toBe('technology');
  });

  it('ProvenanceDemandLink has null stretch for direct matches', () => {
    const link: ProvenanceDemandLink = {
      demandId: 'd-2',
      demandNarrative: 'React component architecture',
      demandWeight: 0.6,
      demandConcepts: ['framework:react'],
      atomId: 'atom-2',
      pairScore: 0.92,
      stretch: null,
    };

    expect(link.stretch).toBeNull();
  });

  it('ProvenanceSignalNode captures source refs from query atoms', () => {
    const signal: ProvenanceSignalNode = {
      atomId: 'atom-1',
      episodeId: 'ep-1',
      narrative: 'Built production TypeScript APIs',
      purpose: 'validation',
      evidenceLevel: 'demonstrated',
      evidenceStrength: 0.9,
      concepts: ['lang:typescript', 'pattern:api'],
      sourceRefs: [{
        artifactId: 'art-1',
        contentHash: 'abc123',
        exactText: 'Led migration of REST APIs to TypeScript',
        startOffset: 100,
        endOffset: 140,
      }],
    };

    expect(signal.sourceRefs).toHaveLength(1);
    expect(signal.concepts).toContain('lang:typescript');
  });

  it('ProvenanceAssertionNode includes decay multiplier and source spans', () => {
    const assertion: ProvenanceAssertionNode = {
      assertionId: 'sa-1',
      narrative: 'Candidate demonstrated TypeScript proficiency',
      predicate: 'has_skill',
      confidence: 0.9,
      polarity: 1,
      observedAt: '2026-06-15T10:00:00Z',
      decayMultiplier: 0.95,
      concepts: ['lang:typescript'],
      sourceSpans: [{
        sourceSpanId: 'ss-1',
        exactText: 'I have 5 years of TypeScript experience',
        lineStart: 12,
        lineEnd: 12,
        charStart: 0,
        charEnd: 39,
      }],
    };

    expect(assertion.decayMultiplier).toBe(0.95);
    expect(assertion.sourceSpans).toHaveLength(1);
    expect(assertion.sourceSpans[0].exactText).toContain('TypeScript');
  });

  it('ProvenanceArtifactNode tracks artifact metadata', () => {
    const artifact: ProvenanceArtifactNode = {
      artifactId: 'art-1',
      artifactType: 'resume',
      logicalKey: 'resume-v2.pdf',
      mediaType: 'application/pdf',
      versionNumber: 2,
      contentHash: 'sha256:deadbeef',
    };

    expect(artifact.artifactType).toBe('resume');
    expect(artifact.versionNumber).toBe(2);
  });

  it('ProvenanceInteractionNode tracks interaction provenance', () => {
    const interaction: ProvenanceInteractionNode = {
      interactionId: 'int-1',
      interactionType: 'culture_interview',
      startedAt: '2026-06-10T14:00:00Z',
      endedAt: '2026-06-10T14:45:00Z',
    };

    expect(interaction.interactionType).toBe('culture_interview');
  });

  it('ProvenanceChainEntry links demand to full evidence chain', () => {
    const entry: ProvenanceChainEntry = {
      demandLink: {
        demandId: 'd-1',
        demandNarrative: 'TypeScript API experience',
        demandWeight: 0.8,
        demandConcepts: ['lang:typescript'],
        atomId: 'atom-1',
        pairScore: 0.85,
        stretch: null,
      },
      signals: [{
        atomId: 'atom-1',
        episodeId: 'ep-1',
        narrative: 'Built TypeScript APIs',
        purpose: 'validation',
        evidenceLevel: 'demonstrated',
        evidenceStrength: 0.9,
        concepts: ['lang:typescript'],
        sourceRefs: [],
      }],
      assertions: [{
        assertionId: 'sa-1',
        narrative: 'TypeScript proficiency',
        predicate: 'has_skill',
        confidence: 0.9,
        polarity: 1,
        observedAt: '2026-06-15T00:00:00Z',
        decayMultiplier: 0.95,
        concepts: ['lang:typescript'],
        sourceSpans: [],
      }],
      artifacts: [{
        artifactId: 'art-1',
        artifactType: 'resume',
        logicalKey: 'resume.pdf',
        mediaType: 'application/pdf',
        versionNumber: 1,
        contentHash: 'sha256:abc',
      }],
      interactions: [{
        interactionId: 'int-1',
        interactionType: 'resume_review',
        startedAt: '2026-06-01T00:00:00Z',
        endedAt: null,
      }],
    };

    expect(entry.demandLink.demandId).toBe('d-1');
    expect(entry.signals).toHaveLength(1);
    expect(entry.assertions).toHaveLength(1);
    expect(entry.artifacts).toHaveLength(1);
    expect(entry.interactions).toHaveLength(1);
  });

  it('MatchProvenanceChain aggregates all chain entries', () => {
    const chain: MatchProvenanceChain = {
      decision: {
        matchRunId: 'run-1',
        candidateId: 'cand-1',
        status: 'MATCHED',
        selectedPacketId: 'pkt-1',
        policyVersion: 'candidate-pr-v1',
        createdAt: 1719705600,
      },
      challengeId: 'pkt-1',
      repoId: 'repo-1',
      prNumber: 42,
      totalDemands: 5,
      alignedDemands: 3,
      unmatchedDemands: 2,
      stretchCount: 1,
      chain: [{
        demandLink: {
          demandId: 'd-1',
          demandNarrative: 'Test demand',
          demandWeight: 0.5,
          demandConcepts: [],
          atomId: 'atom-1',
          pairScore: 0.7,
          stretch: null,
        },
        signals: [],
        assertions: [],
        artifacts: [],
        interactions: [],
      }],
    };

    expect(chain.totalDemands).toBe(5);
    expect(chain.alignedDemands).toBe(3);
    expect(chain.unmatchedDemands).toBe(2);
    expect(chain.stretchCount).toBe(1);
    expect(chain.chain).toHaveLength(1);
  });

  it('MatchProvenanceChain handles unmatched state', () => {
    const chain: MatchProvenanceChain = {
      decision: {
        matchRunId: 'run-2',
        candidateId: 'cand-2',
        status: 'NEEDS_MORE_EVIDENCE',
        selectedPacketId: null,
        policyVersion: 'candidate-pr-v1',
        createdAt: 1719705600,
      },
      challengeId: null,
      repoId: null,
      prNumber: null,
      totalDemands: 0,
      alignedDemands: 0,
      unmatchedDemands: 0,
      stretchCount: 0,
      chain: [],
    };

    expect(chain.decision.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(chain.challengeId).toBeNull();
    expect(chain.chain).toHaveLength(0);
  });
});
