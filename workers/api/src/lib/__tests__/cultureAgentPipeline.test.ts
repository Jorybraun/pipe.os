import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  synthesizeCandidateProfile,
  decomposeTranscript,
  runInterviewTerminationPipeline,
  type CandidateProfile,
} from '../cultureAgentPipeline';
import type { LLMProvider } from '../llm/types';
import type { CultureTranscript } from '../cultureAgent';
import type { Env } from '../../types';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function buildMockProvider(response: unknown): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue({ content: JSON.stringify(response) }),
  } as unknown as LLMProvider;
}

function buildMockProviderWithText(content: string): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue({ content }),
  } as unknown as LLMProvider;
}

function buildMockProviderThatFails(): LLMProvider {
  return {
    complete: vi.fn().mockRejectedValue(new Error('LLM failure')),
  } as unknown as LLMProvider;
}

function makeTranscript(): CultureTranscript {
  return {
    turns: [
      {
        idx: 0,
        questionId: 'q1',
        questionText: 'Tell me about a time you took ownership of a project.',
        probeOf: null,
        candidateResponse: 'At Acme Corp, I led the migration of our payment system to Stripe. I was the sole engineer on the project for 3 months.',
        starSlots: null,
        timestamp: new Date().toISOString(),
      },
      {
        idx: 1,
        questionId: 'q2',
        questionText: 'How do you handle conflicts with teammates?',
        probeOf: null,
        candidateResponse: 'I prefer direct communication. At my last job, I had a disagreement with a PM about priorities. We scheduled a 1:1 and found a compromise.',
        starSlots: null,
        timestamp: new Date().toISOString(),
      },
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 0, 'conflict-handling': 0, 'self-awareness': 0 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
      mode: 'profile_builder',
      questionMetadata: [],
    },
  };
}

// ─── Synthesis ───────────────────────────────────────────────────────────────

describe('synthesizeCandidateProfile', () => {
  it('produces a rich profile from valid LLM JSON', async () => {
    const profile: CandidateProfile = {
      careerTimeline: [
        {
          company: 'Acme Corp',
          role: 'Senior Engineer',
          startDate: '2021-01',
          endDate: null,
          durationMonths: 36,
          teamSize: 5,
          scope: 'Led payment system migration',
          keyAccomplishments: ['Migrated to Stripe'],
          technologies: ['Stripe', 'Node.js'],
        },
      ],
      skillsInventory: [
        { skill: 'Node.js', proficiency: 'expert', evidence: 'Led migration', yearsExperience: 5 },
      ],
      projectPortfolio: [
        {
          name: 'Payment Migration',
          description: 'Migrated payment system to Stripe',
          role: 'Lead Engineer',
          outcomes: ['Reduced payment failures by 50%'],
          technologies: ['Stripe', 'Node.js'],
        },
      ],
      workingStyle: {
        collaborationPreference: 'Prefers direct communication',
        communicationStyle: 'Direct',
        decisionMaking: 'Data-driven',
        feedbackReceptiveness: 'Open to feedback',
      },
      motivation: {
        primaryDrivers: ['Impact', 'Autonomy'],
        dealbreakers: ['Micromanagement'],
        growthTrajectory: 'Wants to grow into staff engineer',
      },
      behavioralEvidence: [
        { dimension: 'ownership', evidence: 'Led the migration project', confidence: 0.9 },
      ],
    };

    const provider = buildMockProvider(profile);
    const result = await synthesizeCandidateProfile(provider, makeTranscript());

    expect(result).not.toBeNull();
    expect(result!.careerTimeline).toHaveLength(1);
    expect(result!.careerTimeline[0]!.company).toBe('Acme Corp');
    expect(result!.skillsInventory).toHaveLength(1);
    expect(result!.behavioralEvidence).toHaveLength(1);
  });

  it('returns null when no provider', async () => {
    const result = await synthesizeCandidateProfile(null, makeTranscript());
    expect(result).toBeNull();
  });

  it('returns null and logs on LLM failure', async () => {
    const provider = buildMockProviderThatFails();
    const result = await synthesizeCandidateProfile(provider, makeTranscript());
    expect(result).toBeNull();
  });

  it('returns null and logs on invalid JSON', async () => {
    const provider = buildMockProviderWithText('not json');
    const result = await synthesizeCandidateProfile(provider, makeTranscript());
    expect(result).toBeNull();
  });

  it('tolerates partial JSON with missing fields', async () => {
    const provider = buildMockProvider({
      careerTimeline: [],
      skillsInventory: [],
      projectPortfolio: [],
      workingStyle: {},
      motivation: {},
      behavioralEvidence: [],
    });
    const result = await synthesizeCandidateProfile(provider, makeTranscript());
    expect(result).not.toBeNull();
    expect(result!.careerTimeline).toEqual([]);
    expect(result!.workingStyle.collaborationPreference).toBe('');
  });
});

// ─── Decomposition ───────────────────────────────────────────────────────────

describe('decomposeTranscript', () => {
  it('produces typed nodes from valid LLM JSON', async () => {
    const decomposition = {
      nodes: [
        {
          nodeType: 'Experience',
          narrative: 'Led payment migration at Acme Corp',
          properties: { company: 'Acme Corp', role: 'Senior Engineer' },
          confidence: 0.9,
        },
        {
          nodeType: 'Skill',
          narrative: 'Expert in Node.js and Stripe integration',
          properties: { skill: 'Node.js', proficiency: 'expert' },
          confidence: 0.85,
        },
      ],
    };

    const provider = buildMockProvider(decomposition);
    const result = await decomposeTranscript(provider, makeTranscript());

    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(2);
    expect(result!.nodes[0]!.nodeType).toBe('Experience');
    expect(result!.nodes[1]!.nodeType).toBe('Skill');
  });

  it('preserves previously unseen semantic node types', async () => {
    const decomposition = {
      nodes: [
        { nodeType: 'Experience', narrative: 'Valid', properties: {}, confidence: 0.9 },
        { nodeType: 'InvalidType', narrative: 'Bad', properties: {}, confidence: 0.5 },
        { nodeType: 'Skill', narrative: 'Valid too', properties: {}, confidence: 0.8 },
      ],
    };

    const provider = buildMockProvider(decomposition);
    const result = await decomposeTranscript(provider, makeTranscript());

    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(3);
    expect(result!.nodes[1]!.nodeType).toBe('InvalidType');
  });

  it('returns null when no provider', async () => {
    const result = await decomposeTranscript(null, makeTranscript());
    expect(result).toBeNull();
  });

  it('returns null on LLM failure', async () => {
    const provider = buildMockProviderThatFails();
    const result = await decomposeTranscript(provider, makeTranscript());
    expect(result).toBeNull();
  });
});

// ─── Full pipeline ───────────────────────────────────────────────────────────

describe('runInterviewTerminationPipeline', () => {
  function buildMockDb() {
    const queries: Array<{ sql: string; args: unknown[] }> = [];
    const inserts: Array<Record<string, unknown>> = [];

    const db = {
      prepare: (sql: string) => {
        return {
          bind: (...args: unknown[]) => {
            queries.push({ sql, args });
            // candidate_ingestion select for loadDiscoveryResultFromDb
            if (sql.includes('FROM candidate_ingestion') && sql.includes('candidate_searchable_profile')) {
              return {
                first: async <T>(): Promise<T | null> =>
                  ({
                    candidate_searchable_profile: 'Test profile',
                    key_concepts_json: JSON.stringify({ mustHaveSkills: ['js'], niceToHaveSkills: [], seniority: 'senior', primary_language: 'typescript', detected_domain: 'web' }),
                    career_context_json: JSON.stringify({ company_stages: ['startup'], company_size_exposure: ['small'], tenure_pattern: 'stable', progression_velocity: 'normal', ownership_depth: 'feature', system_scale_exposure: [], greenfield_ratio: 0.5 }),
                    situation_signature_json: JSON.stringify({ primary_challenge_types: [], architecture_exposure: [], test_culture_exposure: '', review_culture: '', impact_signals: [] }),
                    profile_version: 'v1',
                    model_used: 'test',
                  } as T),
              };
            }
            // candidate_ingestion update for markCandidateEnriching
            if (sql.includes("SET status = 'enriching'")) {
              return { run: async () => ({}) };
            }
            // candidate_ingestion update for markCandidateEnriched
            if (sql.includes("SET status = 'enriched'")) {
              return { run: async () => ({}) };
            }
            // candidate_nodes insert
            if (sql.includes('INSERT INTO candidate_nodes')) {
              return {
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
              };
            }
            // candidate_nodes select for enrichment
            if (sql.includes('FROM candidate_nodes') && sql.includes('superseded_at IS NULL')) {
              return {
                all: async <T>(): Promise<{ results: T[] }> => ({
                  results: [
                    {
                      id: 'node1',
                      candidate_id: args[0],
                      node_type: 'Experience',
                      narrative_text: 'Test',
                      extracted_properties_json: '{}',
                      embedding_json: JSON.stringify(new Array(1024).fill(0.1)),
                      source_type: 'automated_screener',
                      source_reference: 'sess1',
                      captured_at: 1234567890,
                      confidence: 0.9,
                      supersedes: null,
                      superseded_at: null,
                      decomposition_version: 'v1',
                      created_at: 1234567890,
                      updated_at: 1234567890,
                    },
                  ] as T[],
                }),
              };
            }
            // coverage update
            if (sql.includes('INSERT INTO candidate_coverage')) {
              return { run: async () => ({}) };
            }
            // Generic fallback for other queries (pipeline_match_config, candidates, etc.)
            return {
              first: async <T>(): Promise<T | null> => null,
              all: async <T>(): Promise<{ results: T[] }> => ({ results: [] }),
              run: async () => ({}),
            };
          },
        };
      },
    } as unknown as D1Database;

    return { db, queries, inserts };
  }

  function buildMockEnv(db: D1Database): Env {
    const vector = new Array(1024).fill(0.1);
    return {
      DB: db,
      AI: {
        run: vi.fn().mockResolvedValue({ data: [vector] }),
      },
      CANDIDATE_INDEX: {
        upsert: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ matches: [] }),
      },
      REPO_INDEX: {
        upsert: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ matches: [] }),
      },
    } as unknown as Env;
  }

  it('runs synthesis + decomposition + enrichment + matching end-to-end', async () => {
    const { db } = buildMockDb();
    const env = buildMockEnv(db);

    const provider = buildMockProvider({
      careerTimeline: [{ company: 'Acme', role: 'Dev', startDate: '2020', endDate: null, durationMonths: 48, teamSize: null, scope: 'Build', keyAccomplishments: [], technologies: [] }],
      skillsInventory: [],
      projectPortfolio: [],
      workingStyle: { collaborationPreference: '', communicationStyle: '', decisionMaking: '', feedbackReceptiveness: '' },
      motivation: { primaryDrivers: [], dealbreakers: [], growthTrajectory: '' },
      behavioralEvidence: [],
      nodes: [
        { nodeType: 'Experience', narrative: 'Test exp', properties: {}, confidence: 0.9 },
      ],
    });

    await runInterviewTerminationPipeline({
      env,
      db,
      candidateId: 'cand1',
      sessionId: 'sess1',
      transcript: makeTranscript(),
      mode: 'profile_builder',
      provider,
      assessmentId: 'assess1',
    });

    // LLM should have been called twice (synthesis + decomposition)
    expect(provider.complete).toHaveBeenCalledTimes(2);
    // Vectorize upsert is skipped in read-only archive mode
    expect(env.CANDIDATE_INDEX.upsert).toHaveBeenCalledTimes(0);
  });

  it('completes gracefully when provider is null', async () => {
    const { db } = buildMockDb();
    const env = buildMockEnv(db);

    // Should not throw
    await runInterviewTerminationPipeline({
      env,
      db,
      candidateId: 'cand1',
      sessionId: 'sess1',
      transcript: makeTranscript(),
      mode: 'profile_builder',
      provider: null,
      assessmentId: 'assess1',
    });

    // Vectorize upsert is skipped in read-only archive mode
    expect(env.CANDIDATE_INDEX.upsert).toHaveBeenCalledTimes(0);
  });

  it('completes gracefully when discovery result is missing', async () => {
    const queries: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          queries.push({ sql, args });
          // Return empty for discovery result
          if (sql.includes('FROM candidate_ingestion') && sql.includes('candidate_searchable_profile')) {
            return { first: async <T>(): Promise<T | null> => null };
          }
          if (sql.includes("SET status = 'enriching'")) {
            return { run: async () => ({}) };
          }
          if (sql.includes("SET status = 'enriched'")) {
            return { run: async () => ({}) };
          }
          return { first: async <T>(): Promise<T | null> => null, all: async <T>(): Promise<{ results: T[] }> => ({ results: [] }), run: async () => ({}) };
        },
      }),
    } as unknown as D1Database;

    const env = buildMockEnv(db);
    const provider = buildMockProvider({
      careerTimeline: [],
      skillsInventory: [],
      projectPortfolio: [],
      workingStyle: {},
      motivation: {},
      behavioralEvidence: [],
      nodes: [{ nodeType: 'Skill', narrative: 'Test skill', properties: {}, confidence: 0.8 }],
    });

    await runInterviewTerminationPipeline({
      env,
      db,
      candidateId: 'cand1',
      sessionId: 'sess1',
      transcript: makeTranscript(),
      mode: 'profile_builder',
      provider,
      assessmentId: 'assess1',
    });

    // Should complete without throwing even though matching was skipped
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });
});
