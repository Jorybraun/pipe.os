import { beforeEach, describe, it, expect, vi } from 'vitest';
import { decomposeResumeToGraph } from '../resumeDecomposition';
import type { ParsedCV } from '../../cvParser';
import type { DecompositionResult } from '../candidateDecompositionPrompt';
import { insertCandidateNode } from '../candidateNodes';

vi.mock('../candidateNodes', () => ({
  insertCandidateNode: vi.fn(async (_db, node) => ({
    ...node,
    id: crypto.randomUUID(),
    created_at: Date.now(),
    updated_at: Date.now(),
  })),
  embedCandidateNode: vi.fn(async () => Array(1024).fill(0.1)),
}));

vi.mock('../candidateCoverage', () => ({
  computeCandidateCoverage: vi.fn(async () => undefined),
}));

vi.mock('../../skills/slugifySkills', () => ({
  slugifySkills: vi.fn(async (_db, skills: string[]) => skills.map((s) => s.toLowerCase())),
}));

const mockEnv = {
  AI: { run: vi.fn() },
} as unknown as import('../../types').Env;

beforeEach(() => {
  vi.clearAllMocks();
});

function mockDb(): import('../../types').D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({})),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({})),
      })),
    })),
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({})),
    dump: vi.fn(async () => new ArrayBuffer(0)),
  } as unknown as import('../../types').D1Database;
}

const mockDecomposition: DecompositionResult = {
  candidate_name: 'Jane Doe',
  experiences: [
    {
      company: 'Acme Corp',
      role: 'Senior Engineer',
      duration_months: 24,
      scope: 'service',
      narrative: 'Led backend migration to microservices.',
      skills_demonstrated: ['typescript', 'kafka'],
      confidence: 0.85,
      source_quote: 'Led backend migration to microservices using Kafka.',
    },
  ],
  projects: [
    {
      name: 'CLI Tool',
      description: 'Open-source TypeScript utility.',
      skills_demonstrated: ['typescript'],
      confidence: 0.8,
    },
  ],
  skills: [
    {
      name: 'typescript',
      proficiency: 'expert',
      years_exposure: 5,
      confidence: 0.9,
    },
  ],
  education: [
    {
      institution: 'MIT',
      degree: 'B.S.',
      field: 'Computer Science',
      year: '2019',
      confidence: 0.95,
    },
  ],
  credentials: [],
  career_arc: {
    narrative: 'Steady progression from junior to senior.',
    growth_velocity: 'fast',
    transitions: [{ from: 'IC', to: 'senior', at_company: 'Acme' }],
    confidence: 0.8,
  },
};

describe('decomposeResumeToGraph', () => {
  it('inserts and embeds nodes from decomposition result', async () => {
    const db = mockDb();
    const parsedCV: ParsedCV = {
      name: 'Jane Doe',
      skills: ['TypeScript', 'React'],
      yearsOfExperience: 5,
      currentRole: 'Senior Engineer',
      experiences: [
        {
          company: 'Acme Corp',
          role: 'Senior Engineer',
          startDate: '2022-01',
          endDate: '2024-05',
          description: 'Led backend migration.',
        },
      ],
      educationBlocks: [
        { institution: 'MIT', degree: 'B.S.', field: 'CS', year: '2019' },
      ],
      credentials: [],
      projects: [{ name: 'CLI Tool', description: 'Utility', url: 'https://github.com/jane/cli' }],
    };

    const result = await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-123',
      resumeText: 'Jane Doe\nLed backend migration to microservices using Kafka.',
      parsedCV,
      env: mockEnv,
      decompositionResult: mockDecomposition,
    });

    expect(result.nodesInserted).toBeGreaterThan(0);
    expect(result.decompositionVersion).toBe('adr041-v1');
    expect(insertCandidateNode).toHaveBeenCalled();
    const experienceCall = vi.mocked(insertCandidateNode).mock.calls.find((call) =>
      call[1].node_type === 'Experience'
    );
    expect(experienceCall).toBeDefined();
    expect(JSON.parse(String(experienceCall![1].extracted_properties_json))).toMatchObject({
      source_quote: 'Led backend migration to microservices using Kafka.',
      source_quote_validated: true,
      source_quote_char_start: 'Jane Doe\n'.length,
      source_quote_char_end: 'Jane Doe\nLed backend migration to microservices using Kafka.'.length,
    });
  });

  it('falls back to parser-only nodes when decompositionResult is null', async () => {
    const db = mockDb();
    const parsedCV: ParsedCV = {
      name: 'Jane Doe',
      skills: ['TypeScript'],
      experiences: [
        {
          company: 'Acme Corp',
          role: 'Senior Engineer',
          description: 'Led backend migration.',
        },
      ],
      educationBlocks: [],
      credentials: [],
      projects: [],
    };

    const result = await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-456',
      resumeText: 'short text',
      parsedCV,
      env: mockEnv,
      decompositionResult: null,
    });

    expect(result.nodesInserted).toBeGreaterThan(0);
  });

  it('falls back to parser-only nodes when decompositionResult is omitted', async () => {
    const db = mockDb();
    const parsedCV: ParsedCV = {
      name: 'Jane Doe',
      skills: ['TypeScript'],
      experiences: [
        {
          company: 'Acme Corp',
          role: 'Senior Engineer',
          description: 'Led backend migration.',
        },
      ],
      educationBlocks: [],
      credentials: [],
      projects: [],
    };

    const result = await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-789',
      resumeText: 'short text',
      parsedCV,
      env: mockEnv,
    });

    expect(result.nodesInserted).toBeGreaterThan(0);
  });
});
