import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decomposeCodeReviewToGraph } from '../decomposeCodeReview';
import type { Env } from '../../../types';
import type { ScoreReport } from '../../scorerAgent';
import type { ReviewRound } from '../../implementerAgent';

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
              row.id = crypto.randomUUID();
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
      if (sql.includes('FROM candidate_nodes') && sql.includes('superseded_at')) {
        return {
          bind: () => ({
            all: async () => ({ results: [] }),
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

function makeScoreReport(partial?: Partial<ScoreReport['evidence']>): ScoreReport {
  return {
    dimensions: {
      issue_identification: 4,
      reasoning_quality: 3,
      prioritization: 5,
      question_formation: 2,
      revision_evaluation: 4,
      ai_direction: 3,
    },
    evidence: {
      issue_identification_evidence: 'Found the race condition in the auth middleware.',
      reasoning_quality_evidence: 'Explained the trade-off clearly but missed edge cases.',
      prioritization_evidence: 'Correctly ranked security issues above stylistic ones.',
      question_formation_evidence: '',
      revision_evaluation_evidence: 'Verified the fix covered both call sites.',
      ai_direction_evidence: 'Gave concrete refactoring suggestions.',
      ...partial,
    },
    metrics: {
      bugs_found: [1, 2],
      bugs_missed: [3],
      bugs_found_pct: 66.7,
      false_positive_count: 1,
      true_finding_count: 2,
      approved_with_unfound_critical: false,
      cave_ratio: 0.5,
      fix_verifications: 1,
    },
    effectiveness: {
      score: 58,
      band: 'weak',
      bugs_found: 2,
      bugs_missed: 1,
      false_positives: 1,
    },
    overall: {
      score: 43,
      band: 'weak',
      narrative: 'Weak overall performance.',
      strengths: ['Good issue identification'],
      growth_areas: ['Needs better questioning'],
    },
    scorer_a_summary: 'Scorer A summary.',
    scorer_b_summary: 'Scorer B summary.',
  };
}

describe('decomposeCodeReviewToGraph', () => {
  it('inserts 6 TechnicalDemonstration nodes for a full score report', async () => {
    const { db, inserts, coverageCalls } = buildMockDb();
    const env = buildMockEnv();

    await decomposeCodeReviewToGraph(
      db,
      env,
      {
        id: 'session-1',
        candidate_id: 'candidate-1',
        updated_at: new Date().toISOString(),
        implementer_persona: 'senior-rust',
        challenge_id: 'challenge-1',
      },
      makeScoreReport(),
    );

    expect(inserts.length).toBe(6);
    for (const row of inserts) {
      expect(row.node_type).toBe('TechnicalDemonstration');
      expect(row.candidate_id).toBe('candidate-1');
      expect(row.source_type).toBe('code_review_session');
      expect(row.source_reference).toBe('session-1');
    }
    expect(coverageCalls.length).toBe(1);
  });

  it('uses evidence strings when present', async () => {
    const { db, inserts } = buildMockDb();
    const env = buildMockEnv();

    await decomposeCodeReviewToGraph(
      db,
      env,
      {
        id: 'session-2',
        candidate_id: 'candidate-1',
        updated_at: new Date().toISOString(),
        implementer_persona: 'senior-rust',
        challenge_id: 'challenge-1',
      },
      makeScoreReport(),
    );

    const issueNode = inserts.find((r) => {
      const props = JSON.parse(r.extracted_properties_json as string);
      return props.dimension === 'issue_identification';
    });
    expect(issueNode).toBeDefined();
    expect(issueNode!.narrative_text).toBe('Found the race condition in the auth middleware.');
  });

  it('falls back to generic narrative when evidence is missing or empty', async () => {
    const { db, inserts } = buildMockDb();
    const env = buildMockEnv();

    await decomposeCodeReviewToGraph(
      db,
      env,
      {
        id: 'session-3',
        candidate_id: 'candidate-1',
        updated_at: new Date().toISOString(),
        implementer_persona: 'senior-rust',
        challenge_id: 'challenge-1',
      },
      makeScoreReport({ question_formation_evidence: '' }),
    );

    const questionNode = inserts.find((r) => {
      const props = JSON.parse(r.extracted_properties_json as string);
      return props.dimension === 'question_formation';
    });
    expect(questionNode).toBeDefined();
    expect(questionNode!.narrative_text).toContain('Code review dimension "question_formation" scored 2/5');
  });

  it('continues on individual embedding failure and still calls coverage', async () => {
    const { db, inserts, coverageCalls } = buildMockDb();
    const env = {
      AI: {
        run: vi.fn().mockRejectedValue(new Error('Embedding failed')),
      },
    } as unknown as Env;

    await decomposeCodeReviewToGraph(
      db,
      env,
      {
        id: 'session-4',
        candidate_id: 'candidate-1',
        updated_at: new Date().toISOString(),
        implementer_persona: 'senior-rust',
        challenge_id: 'challenge-1',
      },
      makeScoreReport(),
    );

    expect(inserts.length).toBe(0);
    expect(coverageCalls.length).toBe(1);
  });

  it('still inserts nodes when coverage computation fails', async () => {
    const { db, inserts, coverageCalls } = buildMockDb();
    const env = buildMockEnv();

    // Override the coverage query to throw
    const throwingDb = {
      prepare: (sql: string) => {
        if (sql.includes('INSERT INTO candidate_nodes')) {
          return db.prepare(sql);
        }
        if (sql.includes('INSERT INTO candidate_coverage')) {
          return {
            bind: () => ({
              run: async () => {
                throw new Error('Coverage insert failed');
              },
            }),
          };
        }
        if (sql.includes('FROM candidate_nodes') && sql.includes('superseded_at')) {
          return db.prepare(sql);
        }
        if (sql.includes('FROM role_contexts')) {
          return db.prepare(sql);
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    } as unknown as D1Database;

    await decomposeCodeReviewToGraph(
      throwingDb,
      env,
      {
        id: 'session-5',
        candidate_id: 'candidate-1',
        updated_at: new Date().toISOString(),
        implementer_persona: 'senior-rust',
        challenge_id: 'challenge-1',
      },
      makeScoreReport(),
    );

    expect(inserts.length).toBe(6);
    expect(coverageCalls.length).toBe(0);
  });

  it('writes correct extracted_properties_json shape', async () => {
    const { db, inserts } = buildMockDb();
    const env = buildMockEnv();

    await decomposeCodeReviewToGraph(
      db,
      env,
      {
        id: 'session-6',
        candidate_id: 'candidate-1',
        updated_at: new Date().toISOString(),
        implementer_persona: 'senior-rust',
        challenge_id: 'challenge-1',
      },
      makeScoreReport(),
    );

    const prioritizationNode = inserts.find((r) => {
      const props = JSON.parse(r.extracted_properties_json as string);
      return props.dimension === 'prioritization';
    });
    expect(prioritizationNode).toBeDefined();
    const props = JSON.parse(prioritizationNode!.extracted_properties_json as string);
    expect(props.bars_score).toBe(5);
    expect(props.effectiveness_metrics.bugs_found_pct).toBe(66.7);
    expect(props.implementer_persona).toBe('senior-rust');
    expect(props.challenge_repo_id).toBe('challenge-1');
  });

  it('sets confidence = bars_score / 5', async () => {
    const { db, inserts } = buildMockDb();
    const env = buildMockEnv();

    await decomposeCodeReviewToGraph(
      db,
      env,
      {
        id: 'session-7',
        candidate_id: 'candidate-1',
        updated_at: new Date().toISOString(),
        implementer_persona: 'senior-rust',
        challenge_id: 'challenge-1',
      },
      makeScoreReport(),
    );

    const issueNode = inserts.find((r) => {
      const props = JSON.parse(r.extracted_properties_json as string);
      return props.dimension === 'issue_identification';
    });
    expect(issueNode).toBeDefined();
    expect(issueNode!.confidence).toBe(0.8); // 4/5
  });

  it('uses LLM-generated transcript narrative when available', async () => {
    const { db, inserts } = buildMockDb();
    const env = {
      AI: {
        run: vi.fn().mockImplementation(async (_model: string, input: { messages?: Array<{ content: string }>; text?: string[] }) => {
          // Embedding call uses { text: [...] }
          if (input.text) {
            return { data: [new Array(1024).fill(0.1)] };
          }
          // Narrative generation call uses { messages: [...] }
          const lastMessage = input.messages?.[input.messages.length - 1]?.content ?? '';
          if (lastMessage.includes('Generate the 6 evidence narratives')) {
            return {
              response: JSON.stringify({
                issue_identification: 'The candidate spotted a critical race condition during code review.',
                reasoning_quality: 'They provided a thorough explanation of the threading model.',
                prioritization: 'Security concerns were elevated above minor style issues.',
                question_formation: 'They asked clarifying questions about the auth flow.',
                revision_evaluation: 'The candidate verified fixes across both affected call sites.',
                ai_direction: 'They suggested a cleaner abstraction for error handling.',
              }),
            };
          }
          return { data: [new Array(1024).fill(0.1)] };
        }),
      },
    } as unknown as Env;

    const transcript: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [
          {
            id: 1,
            file: 'src/auth.ts',
            line: 42,
            category: 'bug',
            severity: 'critical',
            what: 'Race condition in token refresh',
            why: 'Two concurrent requests can invalidate each other',
            suggestion: 'Use atomic compare-and-swap',
            positive: false,
          },
        ],
        reviewer_summary: 'Good first pass, found the main bug.',
        implementer_responses: [],
      },
    ];

    await decomposeCodeReviewToGraph(
      db,
      env,
      {
        id: 'session-11',
        candidate_id: 'candidate-1',
        updated_at: new Date().toISOString(),
        implementer_persona: 'senior-rust',
        challenge_id: 'challenge-1',
      },
      makeScoreReport(),
      undefined,
      transcript,
    );

    const issueNode = inserts.find((r) => {
      const props = JSON.parse(r.extracted_properties_json as string);
      return props.dimension === 'issue_identification';
    });
    expect(issueNode).toBeDefined();
    expect(issueNode!.narrative_text).toBe('The candidate spotted a critical race condition during code review.');

    const reasoningNode = inserts.find((r) => {
      const props = JSON.parse(r.extracted_properties_json as string);
      return props.dimension === 'reasoning_quality';
    });
    expect(reasoningNode).toBeDefined();
    expect(reasoningNode!.narrative_text).toBe('They provided a thorough explanation of the threading model.');
  });

  it('falls back to evidence when LLM transcript generation fails', async () => {
    const { db, inserts } = buildMockDb();
    const env = {
      AI: {
        run: vi.fn().mockImplementation(async (_model: string, input: { messages?: Array<{ content: string }>; text?: string[] }) => {
          if (input.text) {
            return { data: [new Array(1024).fill(0.1)] };
          }
          const lastMessage = input.messages?.[input.messages.length - 1]?.content ?? '';
          if (lastMessage.includes('Generate the 6 evidence narratives')) {
            throw new Error('LLM refused');
          }
          return { data: [new Array(1024).fill(0.1)] };
        }),
      },
    } as unknown as Env;

    const transcript: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [{ id: 1, file: 'src/main.ts', line: 1, category: 'bug', severity: 'major', what: 'Bug', why: 'Because', positive: false }],
        implementer_responses: [],
      },
    ];

    await decomposeCodeReviewToGraph(
      db,
      env,
      {
        id: 'session-12',
        candidate_id: 'candidate-1',
        updated_at: new Date().toISOString(),
        implementer_persona: 'senior-rust',
        challenge_id: 'challenge-1',
      },
      makeScoreReport(),
      undefined,
      transcript,
    );

    const issueNode = inserts.find((r) => {
      const props = JSON.parse(r.extracted_properties_json as string);
      return props.dimension === 'issue_identification';
    });
    expect(issueNode).toBeDefined();
    // Falls back to evidence string
    expect(issueNode!.narrative_text).toBe('Found the race condition in the auth middleware.');
  });

  it('falls back to evidence when transcript is empty', async () => {
    const { db, inserts } = buildMockDb();
    const env = buildMockEnv();

    await decomposeCodeReviewToGraph(
      db,
      env,
      {
        id: 'session-13',
        candidate_id: 'candidate-1',
        updated_at: new Date().toISOString(),
        implementer_persona: 'senior-rust',
        challenge_id: 'challenge-1',
      },
      makeScoreReport(),
      undefined,
      [], // empty transcript
    );

    const issueNode = inserts.find((r) => {
      const props = JSON.parse(r.extracted_properties_json as string);
      return props.dimension === 'issue_identification';
    });
    expect(issueNode).toBeDefined();
    expect(issueNode!.narrative_text).toBe('Found the race condition in the auth middleware.');
  });
});
