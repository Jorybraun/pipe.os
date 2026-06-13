import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decomposeCultureScoreToGraph } from '../decomposeCultureScore';
import type { Env } from '../../../types';
import type { CultureScoreReport } from '../../cultureScorer';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function buildMockDb() {
  const inserts: Array<Record<string, unknown>> = [];
  const coverageCalls: string[] = [];

  const db = {
    prepare: (sql: string) => {
      if (sql.includes('INSERT INTO candidate_nodes')) {
        return {
          bind: (...args: unknown[]) => ({
            first: async <T>(): Promise<T> => {
              const row = Object.fromEntries(
                [
                  'id', 'candidate_id', 'node_type', 'narrative_text',
                  'extracted_properties_json', 'embedding_json', 'source_type',
                  'source_reference', 'captured_at', 'confidence',
                  'supersedes', 'superseded_at', 'decomposition_version',
                  'created_at', 'updated_at',
                ].map((k, i) => [k, args[i]]),
              );
              inserts.push(row);
              return row as T;
            },
          }),
        };
      }
      if (sql.includes('INSERT INTO candidate_coverage')) {
        return {
          bind: () => ({
            run: async () => {
              coverageCalls.push('compute');
              return {};
            },
          }),
        };
      }
      if (sql.includes('FROM applications app')) {
        return {
          bind: () => ({
            all: async () => ({ results: [] }),
          }),
        };
      }
      if (sql.includes('DELETE FROM candidate_coverage_dimensions')) {
        return {
          bind: () => ({
            run: async () => ({}),
          }),
        };
      }
      if (sql.includes('FROM role_contexts')) {
        return {
          bind: () => ({
            first: async <T>(): Promise<T | null> => null,
          }),
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as D1Database;

  return { db, inserts, coverageCalls };
}

function buildMockEnv(): Env {
  const vector = new Array(1024).fill(0.1);
  return {
    AI: {
      run: vi.fn().mockResolvedValue({ data: [vector] }),
    },
  } as unknown as Env;
}

function makeScoreReport(): CultureScoreReport {
  return {
    competencyScores: [
      {
        dimension: 'ownership',
        score: 4,
        rawScore: 4,
        dispositionalWeight: 0,
        barsOverrideApplied: false,
        evidenceQuotes: ['I took initiative on the project'],
        confidence: 0.85,
        reasoning: 'Strong ownership with clear initiative.',
        repromptCount: 0,
      },
      {
        dimension: 'collaboration',
        score: 3,
        rawScore: 3,
        dispositionalWeight: 0,
        barsOverrideApplied: false,
        evidenceQuotes: ['We worked together closely'],
        confidence: 0.75,
        reasoning: 'Adequate collaboration evidence.',
        repromptCount: 0,
      },
      {
        dimension: 'learning-orientation',
        score: 5,
        rawScore: 5,
        dispositionalWeight: 0,
        barsOverrideApplied: false,
        evidenceQuotes: ['I spent weekends learning Rust'],
        confidence: 0.9,
        reasoning: 'Exceptional learning orientation.',
        repromptCount: 0,
      },
      {
        dimension: 'conflict-handling',
        score: 3,
        rawScore: 3,
        dispositionalWeight: 0,
        barsOverrideApplied: false,
        evidenceQuotes: [],
        confidence: 0.6,
        reasoning: 'Limited conflict evidence.',
        repromptCount: 0,
      },
      {
        dimension: 'self-awareness',
        score: 4,
        rawScore: 4,
        dispositionalWeight: 0,
        barsOverrideApplied: false,
        evidenceQuotes: ['I know my weakness is delegation'],
        confidence: 0.8,
        reasoning: 'Good self-awareness.',
        repromptCount: 0,
      },
    ],
    profileScores: [
      {
        dimension: 'autonomy',
        candidatePosition: 4,
        evidenceQuotes: ['I prefer to work independently'],
        confidence: 0.8,
        reasoning: 'High autonomy preference.',
        repromptCount: 0,
      },
      {
        dimension: 'risk-tolerance',
        candidatePosition: 3,
        evidenceQuotes: ['I weigh risks carefully'],
        confidence: 0.7,
        reasoning: 'Moderate risk tolerance.',
        repromptCount: 0,
      },
      {
        dimension: 'work-pace',
        candidatePosition: 4,
        evidenceQuotes: ['I thrive in fast environments'],
        confidence: 0.75,
        reasoning: 'Fast pace preference.',
        repromptCount: 0,
      },
      {
        dimension: 'collaboration-style',
        candidatePosition: 3,
        evidenceQuotes: ['I like pair programming'],
        confidence: 0.7,
        reasoning: 'Collaborative style.',
        repromptCount: 0,
      },
      {
        dimension: 'feedback-orientation',
        candidatePosition: 5,
        evidenceQuotes: ['I seek feedback aggressively'],
        confidence: 0.85,
        reasoning: 'Very feedback-oriented.',
        repromptCount: 0,
      },
    ],
    dealbreakerFlags: [],
    hitlReviewRequired: false,
    synthesis: {
      headline: 'Strong culture fit',
      narrative: 'Candidate shows strong alignment.',
      recommendation: 'HIRE',
    },
    orgBenchmark: {
      autonomy: 4,
      riskTolerance: 3,
      workPace: 4,
      collaborationStyle: 3,
      feedbackOrientation: 5,
    },
    scoredAt: new Date().toISOString(),
  };
}

describe('decomposeCultureScoreToGraph', () => {
  it('inserts 10 CulturalSignal nodes for a full score report', async () => {
    const { db, inserts, coverageCalls } = buildMockDb();
    const env = buildMockEnv();

    await decomposeCultureScoreToGraph({
      db,
      env,
      session: {
        id: 'session-1',
        candidate_id: 'candidate-1',
        screener_mode: 'profile_builder',
        assessment_id: 'assessment-1',
        updated_at: new Date().toISOString(),
      },
      scoreReport: makeScoreReport(),
    });

    expect(inserts.length).toBe(10);
    for (const row of inserts) {
      expect(row.node_type).toBe('CulturalSignal');
      expect(row.candidate_id).toBe('candidate-1');
      expect(row.source_type).toBe('automated_screener');
    }
    expect(coverageCalls.length).toBe(1);
  });

  it('sets is_role_specific=true for role_fit sessions', async () => {
    const { db, inserts } = buildMockDb();
    const env = buildMockEnv();

    await decomposeCultureScoreToGraph({
      db,
      env,
      session: {
        id: 'session-2',
        candidate_id: 'candidate-1',
        screener_mode: 'role_fit',
        assessment_id: 'assessment-1',
        updated_at: new Date().toISOString(),
      },
      scoreReport: makeScoreReport(),
    });

    expect(inserts.length).toBe(10);
    for (const row of inserts) {
      const props = JSON.parse(row.extracted_properties_json as string);
      expect(props.is_role_specific).toBe(true);
      expect(row.source_type).toBe('culture_interview');
    }
  });

  it('includes dimension_type and dimension in extracted properties', async () => {
    const { db, inserts } = buildMockDb();
    const env = buildMockEnv();

    await decomposeCultureScoreToGraph({
      db,
      env,
      session: {
        id: 'session-3',
        candidate_id: 'candidate-1',
        screener_mode: 'profile_builder',
        assessment_id: 'assessment-1',
        updated_at: new Date().toISOString(),
      },
      scoreReport: makeScoreReport(),
    });

    const ownershipNode = inserts.find((r) => {
      const props = JSON.parse(r.extracted_properties_json as string);
      return props.dimension === 'ownership';
    });
    expect(ownershipNode).toBeDefined();
    const props = JSON.parse(ownershipNode!.extracted_properties_json as string);
    expect(props.dimension_type).toBe('competency');
    expect(props.bars_score).toBe(4);
    expect(props.semantic_terms).toEqual([{
      surface: 'ownership',
      canonical_key: 'term:ownership',
      evidence_level: 'explained',
    }]);

    const autonomyNode = inserts.find((r) => {
      const p = JSON.parse(r.extracted_properties_json as string);
      return p.dimension === 'autonomy';
    });
    expect(autonomyNode).toBeDefined();
    const autonomyProps = JSON.parse(autonomyNode!.extracted_properties_json as string);
    expect(autonomyProps.dimension_type).toBe('profile');
    expect(autonomyProps.bars_score).toBe(4);
  });

  it('continues on individual node failure and still calls coverage', async () => {
    const { db, inserts, coverageCalls } = buildMockDb();
    const env = {
      AI: {
        run: vi.fn().mockRejectedValue(new Error('Embedding failed')),
      },
    } as unknown as Env;


    await decomposeCultureScoreToGraph({
      db,
      env,
      session: {
        id: 'session-4',
        candidate_id: 'candidate-1',
        screener_mode: 'profile_builder',
        assessment_id: 'assessment-1',
        updated_at: new Date().toISOString(),
      },
      scoreReport: makeScoreReport(),
    });

    expect(inserts.length).toBe(0);
    expect(coverageCalls.length).toBe(1);
  });
});
