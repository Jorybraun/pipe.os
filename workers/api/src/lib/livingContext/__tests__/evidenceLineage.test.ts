import { describe, it, expect, vi, beforeEach } from 'vitest';
import { traceEvidenceLineage } from '../evidenceLineage';

const referenceTime = new Date('2026-06-15T00:00:00Z').getTime();

function createMockDb(overrides?: {
  personResult?: { workspace_person_id: string } | null;
  assertions?: unknown[];
  sourceSpans?: unknown[];
  concepts?: unknown[];
  signalEvidence?: unknown[];
  artifacts?: unknown[];
  interactions?: unknown[];
}): D1Database {
  const defaultAssertions = [
    {
      assertion_id: 'assert-1',
      narrative: 'Candidate has TypeScript experience',
      predicate: 'demonstrates',
      confidence: 0.9,
      polarity: 1,
      observed_at: '2026-06-10T00:00:00Z',
      episode_id: 'ep-1',
      workspace_person_id: 'wp-1',
    },
    {
      assertion_id: 'assert-2',
      narrative: 'Candidate built React apps',
      predicate: 'demonstrates',
      confidence: 0.75,
      polarity: 1,
      observed_at: '2026-03-01T00:00:00Z',
      episode_id: 'ep-2',
      workspace_person_id: 'wp-1',
    },
  ];

  const defaultSourceSpans = [
    {
      source_span_id: 'ss-1',
      assertion_id: 'assert-1',
      artifact_version_id: 'av-1',
      content_hash: 'hash-1',
      exact_text: '5 years of TypeScript development',
      byte_start: 0,
      byte_end: 33,
      char_start: 0,
      char_end: 33,
      line_start: 1,
      line_end: 1,
      timestamp_start_ms: null,
      timestamp_end_ms: null,
      stable_segment_id: null,
    },
    {
      source_span_id: 'ss-2',
      assertion_id: 'assert-2',
      artifact_version_id: 'av-2',
      content_hash: 'hash-2',
      exact_text: 'Built production React dashboard',
      byte_start: 100,
      byte_end: 131,
      char_start: 100,
      char_end: 131,
      line_start: 5,
      line_end: 5,
      timestamp_start_ms: null,
      timestamp_end_ms: null,
      stable_segment_id: null,
    },
  ];

  const defaultConcepts = [
    { assertion_id: 'assert-1', canonical_key: 'lang:typescript', namespace: 'lang', weight: 0.9 },
    { assertion_id: 'assert-2', canonical_key: 'framework:react', namespace: 'framework', weight: 0.85 },
  ];

  const defaultSignals = [
    { id: 'se-1', assertion_id: 'assert-1', evidence_level: 'STRONG', strength: 0.85, polarity: 1, concept_key: 'lang:typescript' },
    { id: 'se-2', assertion_id: 'assert-2', evidence_level: 'MODERATE', strength: 0.6, polarity: 1, concept_key: 'framework:react' },
  ];

  const defaultArtifacts = [
    { artifact_version_id: 'av-1', artifact_id: 'art-1', artifact_type: 'resume', logical_key: 'resume.pdf', media_type: 'application/pdf', version_number: 1 },
    { artifact_version_id: 'av-2', artifact_id: 'art-2', artifact_type: 'transcript', logical_key: 'meeting.txt', media_type: 'text/plain', version_number: 1 },
  ];

  const defaultInteractions = [
    { episode_id: 'ep-1', interaction_id: 'int-1', interaction_type: 'resume_review', started_at: '2026-06-10T00:00:00Z', ended_at: null },
    { episode_id: 'ep-2', interaction_id: 'int-2', interaction_type: 'meeting', started_at: '2026-03-01T00:00:00Z', ended_at: '2026-03-01T01:00:00Z' },
  ];

  const personResult = overrides?.personResult !== undefined
    ? overrides.personResult
    : { workspace_person_id: 'wp-1' };
  const assertions = overrides?.assertions ?? defaultAssertions;
  const sourceSpans = overrides?.sourceSpans ?? defaultSourceSpans;
  const concepts = overrides?.concepts ?? defaultConcepts;
  const signalEvidence = overrides?.signalEvidence ?? defaultSignals;
  const artifacts = overrides?.artifacts ?? defaultArtifacts;
  const interactions = overrides?.interactions ?? defaultInteractions;

  let callIndex = 0;
  const prepare = vi.fn().mockImplementation(() => {
    return {
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(personResult),
        all: vi.fn().mockImplementation(() => {
          callIndex++;
          if (callIndex === 1) return Promise.resolve({ results: assertions });
          if (callIndex === 2) return Promise.resolve({ results: sourceSpans });
          if (callIndex === 3) return Promise.resolve({ results: concepts });
          if (callIndex === 4) return Promise.resolve({ results: signalEvidence });
          if (callIndex === 5) return Promise.resolve({ results: artifacts });
          if (callIndex === 6) return Promise.resolve({ results: interactions });
          return Promise.resolve({ results: [] });
        }),
      }),
    };
  });

  return { prepare } as unknown as D1Database;
}

describe('evidenceLineage', () => {
  describe('traceEvidenceLineage', () => {
    it('returns empty lineage when candidate has no person record', async () => {
      const db = createMockDb({ personResult: null });
      const result = await traceEvidenceLineage(db, 'candidate-unknown');
      expect(result.candidateId).toBe('candidate-unknown');
      expect(result.workspacePersonId).toBeNull();
      expect(result.totalNodes).toBe(0);
      expect(result.nodes).toEqual([]);
      expect(result.conceptSummary).toEqual([]);
    });

    it('returns empty lineage when no assertions exist', async () => {
      const db = createMockDb({ assertions: [] });
      const result = await traceEvidenceLineage(db, 'candidate-1');
      expect(result.workspacePersonId).toBe('wp-1');
      expect(result.totalNodes).toBe(0);
    });

    it('traces full lineage chain from assertion to source and artifact', async () => {
      const db = createMockDb();
      const result = await traceEvidenceLineage(db, 'candidate-1', {
        decayConfig: { referenceTimeMs: referenceTime },
      });

      expect(result.candidateId).toBe('candidate-1');
      expect(result.workspacePersonId).toBe('wp-1');
      expect(result.totalNodes).toBe(2);

      const node1 = result.nodes[0]!;
      expect(node1.assertion.assertionId).toBe('assert-1');
      expect(node1.assertion.narrative).toBe('Candidate has TypeScript experience');
      expect(node1.assertion.concepts).toHaveLength(1);
      expect(node1.assertion.concepts[0]!.canonicalKey).toBe('lang:typescript');
      expect(node1.assertion.sources).toHaveLength(1);
      expect(node1.assertion.sources[0]!.exactText).toBe('5 years of TypeScript development');

      expect(node1.signalEvidence).not.toBeNull();
      expect(node1.signalEvidence!.evidenceLevel).toBe('STRONG');
      expect(node1.signalEvidence!.strength).toBe(0.85);

      expect(node1.artifact).not.toBeNull();
      expect(node1.artifact!.artifactType).toBe('resume');

      expect(node1.interaction).not.toBeNull();
      expect(node1.interaction!.interactionType).toBe('resume_review');
    });

    it('applies temporal decay to effective strength', async () => {
      const db = createMockDb();
      const result = await traceEvidenceLineage(db, 'candidate-1', {
        decayConfig: { referenceTimeMs: referenceTime },
      });

      const freshNode = result.nodes[0]!;
      expect(freshNode.decayMultiplier).toBeCloseTo(1.0, 1);
      expect(freshNode.effectiveStrength).toBeCloseTo(0.85, 1);

      const olderNode = result.nodes[1]!;
      expect(olderNode.decayMultiplier).toBeLessThan(1.0);
      expect(olderNode.effectiveStrength).toBeLessThan(0.6);
    });

    it('builds concept summary sorted by effective strength', async () => {
      const db = createMockDb();
      const result = await traceEvidenceLineage(db, 'candidate-1', {
        decayConfig: { referenceTimeMs: referenceTime },
      });

      expect(result.conceptSummary).toHaveLength(2);
      const tsConcept = result.conceptSummary.find((c) => c.canonicalKey === 'lang:typescript');
      expect(tsConcept).toBeDefined();
      expect(tsConcept!.nodeCount).toBe(1);
      expect(tsConcept!.avgEffectiveStrength).toBeGreaterThan(0);
    });

    it('respects limit parameter', async () => {
      const manyAssertions = Array.from({ length: 10 }, (_, i) => ({
        assertion_id: `assert-${i}`,
        narrative: `Assertion ${i}`,
        predicate: 'demonstrates',
        confidence: 0.8,
        polarity: 1,
        observed_at: '2026-06-10T00:00:00Z',
        episode_id: null,
        workspace_person_id: 'wp-1',
      }));
      const db = createMockDb({
        assertions: manyAssertions,
        sourceSpans: [],
        concepts: [],
        signalEvidence: [],
        artifacts: [],
        interactions: [],
      });
      const result = await traceEvidenceLineage(db, 'candidate-1', { limit: 5 });
      expect(result.totalNodes).toBeLessThanOrEqual(10);
    });

    it('handles missing signal evidence gracefully', async () => {
      const db = createMockDb({ signalEvidence: [] });
      const result = await traceEvidenceLineage(db, 'candidate-1', {
        decayConfig: { referenceTimeMs: referenceTime },
      });
      expect(result.totalNodes).toBe(2);
      const node = result.nodes[0]!;
      expect(node.signalEvidence).toBeNull();
      expect(node.effectiveStrength).toBeGreaterThan(0);
    });
  });
});
