import { beforeEach, describe, it, expect, vi } from 'vitest';
import { decomposeResumeToGraph } from '../resumeDecomposition';
import type { ParsedCV } from '../../cvParser';
import type { DecompositionResult } from '../candidateDecompositionPrompt';
import { embedCandidateNode, insertCandidateNode } from '../candidateNodes';
import { writeCandidateGraph } from '../../neo4j/writeCandidateGraph';

vi.mock('../candidateNodes', () => ({
  insertCandidateNode: vi.fn(async (_db, node) => ({
    ...node,
    id: crypto.randomUUID(),
    created_at: Date.now(),
    updated_at: Date.now(),
  })),
  embedCandidateNode: vi.fn(async () => Array(1024).fill(0.1)),
  repairCandidateResumeNodeSourceRefs: vi.fn(async () => ({ scanned: 0, repaired: 0 })),
}));

vi.mock('../candidateCoverage', () => ({
  computeCandidateCoverage: vi.fn(async () => undefined),
}));

vi.mock('../../skills/slugifySkills', () => ({
  slugifySkills: vi.fn(async (_db, skills: string[]) => skills.map((s) => s.toLowerCase())),
}));

vi.mock('../../neo4j/writeCandidateGraph', () => ({
  writeCandidateGraph: vi.fn(async () => undefined),
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

  it('anchors repeated experience title quotes to the matching company occurrence', async () => {
    const db = mockDb();
    const resumeText = [
      'History',
      'Morgan Stanley',
      'Senior UI Developer : January 2024 - March 2025',
      'Collaborated directly with stakeholders.',
      'Orium',
      'Fullstack Developer : March 2022 - August 2023',
      'Optimized dynamic CMS-driven components.',
      'Sycle',
      'Senior UI Developer : October 2021 - March 2022',
      'Built a HIPAA-compliant real-time chat feature.',
      'SAP',
      'UI Developer : April 2019 - February 2020',
      'Contributed to accessibility remediation efforts.',
      'SSENSE',
      'Fullstack Developer : May 2017 - July 2018',
      'Developed core Checkout and Cart pages.',
    ].join('\n');
    const parsedCV: ParsedCV = {
      name: 'Repeated Title Candidate',
      skills: [],
      experiences: [],
      educationBlocks: [],
      credentials: [],
      projects: [],
    };

    await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-repeated-title',
      resumeText,
      parsedCV,
      env: mockEnv,
      decompositionResult: {
        ...mockDecomposition,
        experiences: [
          {
            company: 'Morgan Stanley',
            role: 'Senior UI Developer',
            duration_months: 15,
            narrative: 'Collaborated directly with stakeholders.',
            skills_demonstrated: ['react'],
            confidence: 0.8,
            source_quote: 'Senior UI Developer',
          },
          {
            company: 'Orium',
            role: 'Fullstack Developer',
            duration_months: 18,
            narrative: 'Optimized dynamic CMS-driven components.',
            skills_demonstrated: ['react'],
            confidence: 0.8,
            source_quote: 'Fullstack Developer',
          },
          {
            company: 'Sycle',
            role: 'Senior UI Developer',
            duration_months: 6,
            narrative: 'Built a HIPAA-compliant real-time chat feature.',
            skills_demonstrated: ['react'],
            confidence: 0.8,
            source_quote: 'Senior UI Developer',
          },
          {
            company: 'SAP',
            role: 'UI Developer',
            duration_months: 11,
            narrative: 'Contributed to accessibility remediation efforts.',
            skills_demonstrated: ['accessibility'],
            confidence: 0.8,
            source_quote: 'UI Developer',
          },
          {
            company: 'SSENSE',
            role: 'Fullstack Developer',
            duration_months: 15,
            narrative: 'Developed core Checkout and Cart pages.',
            skills_demonstrated: ['vue'],
            confidence: 0.8,
            source_quote: 'Fullstack Developer',
          },
        ],
        projects: [],
        skills: [],
        education: [],
        credentials: [],
        career_arc: {
          narrative: 'Progressed through frontend roles.',
          growth_velocity: 'normal',
          transitions: [],
          confidence: 0.7,
        },
      },
    });

    const experienceProperties = new Map<string, {
      source_quote?: string;
      source_quote_validated?: boolean;
      source_quote_char_start?: number;
      source_quote_char_end?: number;
    }>();
    for (const call of vi.mocked(insertCandidateNode).mock.calls) {
      if (call[1].node_type !== 'Experience') continue;
      const properties = JSON.parse(String(call[1].extracted_properties_json)) as {
        company?: string;
        source_quote?: string;
        source_quote_validated?: boolean;
        source_quote_char_start?: number;
        source_quote_char_end?: number;
      };
      if (properties.company) experienceProperties.set(properties.company, properties);
    }

    for (const [company, quote] of [
      ['Morgan Stanley', 'Morgan Stanley\nSenior UI Developer'],
      ['Orium', 'Orium\nFullstack Developer'],
      ['Sycle', 'Sycle\nSenior UI Developer'],
      ['SAP', 'SAP\nUI Developer'],
      ['SSENSE', 'SSENSE\nFullstack Developer'],
    ] as const) {
      const quoteStart = resumeText.indexOf(quote);
      expect(experienceProperties.get(company)).toMatchObject({
        source_quote: quote,
        source_quote_validated: true,
        source_quote_char_start: quoteStart,
        source_quote_char_end: quoteStart + quote.length,
      });
    }
  });

  it('persists source-backed nodes even when embedding is unavailable', async () => {
    vi.mocked(embedCandidateNode).mockRejectedValueOnce(new Error('embedding unavailable'));
    const db = mockDb();
    const parsedCV: ParsedCV = {
      name: 'Jane Doe',
      skills: ['TypeScript'],
      experiences: [],
      educationBlocks: [],
      credentials: [],
      projects: [],
    };

    const result = await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-embed-down',
      resumeText: 'Jane Doe\nLed backend migration to microservices using Kafka.',
      parsedCV,
      env: mockEnv,
      decompositionResult: {
        ...mockDecomposition,
        projects: [],
        skills: [],
        education: [],
        credentials: [],
        career_arc: {
          narrative: 'Steady progression.',
          growth_velocity: 'normal',
          transitions: [],
          confidence: 0.7,
        },
      },
    });

    expect(result.nodesInserted).toBeGreaterThan(0);
    expect(result.errors.some((error) => error.includes('Embed failed'))).toBe(true);
    const experienceCall = vi.mocked(insertCandidateNode).mock.calls.find((call) =>
      call[1].node_type === 'Experience'
    );
    expect(experienceCall).toBeDefined();
    expect(experienceCall![1].embedding_json).toBeNull();
  });

  it('preserves exact raw review evidence as source-backed phrase nodes', async () => {
    const db = mockDb();
    const resumeText = [
      'Recently implemented popover trigger click handling in usePopoverRoot for a large component library.',
      'Designed a patient click threshold so impatient trigger clicks do not immediately close hover-open popovers.',
      'Comfortable assessing accessibility state, user interaction timing, JavaScript test runner regression tests, and maintainability trade-offs.',
    ].join(' ');
    const parsedCV: ParsedCV = {
      name: 'Jane Doe',
      skills: ['TypeScript', 'React'],
      experiences: [],
      educationBlocks: [],
      credentials: [],
      projects: [],
    };

    await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-review-evidence',
      resumeText,
      parsedCV,
      env: mockEnv,
      decompositionResult: {
        ...mockDecomposition,
        experiences: [],
        projects: [],
        skills: [],
        education: [],
        credentials: [],
      },
    });

    const reviewEvidenceCalls = vi.mocked(insertCandidateNode).mock.calls.filter((call) =>
      call[1].node_type === 'ReviewEvidence'
    );
    expect(reviewEvidenceCalls.length).toBeGreaterThanOrEqual(3);

    const canonicalTerms = reviewEvidenceCalls.flatMap((call) => {
      const properties = JSON.parse(String(call[1].extracted_properties_json)) as {
        semantic_terms?: Array<{ canonical_key?: string; evidence_level?: string }>;
        source_quote_validated?: boolean;
      };
      expect(properties.source_quote_validated).toBe(true);
      expect(properties.semantic_terms?.[0]?.evidence_level).toMatch(/implemented|validated|used|explained/);
      return properties.semantic_terms?.map((term) => term.canonical_key ?? '') ?? [];
    });

    expect(canonicalTerms).toContain('term:use-popover-root');
    expect(canonicalTerms).toContain('term:patient-click-threshold');
    expect(canonicalTerms.some((term) =>
      term.includes('javascript-test-runner')
      || term.includes('java-script-test-runner')
    )).toBe(true);
  });

  it('keeps diverse repo-matching terms from Workers-style CV evidence', async () => {
    const db = mockDb();
    const resumeText = [
      'Senior TypeScript backend engineer with 8 years building developer platforms and cloud infrastructure tools.',
      'Staff Engineer, Edge Platform Team: designed Cloudflare Workers-style runtime APIs, request routing, KV-backed configuration, durable task queues, and TypeScript SDK tooling for serverless deployments.',
      'Led debugging of source-mapped stack traces and CLI error handling in local dev tools, including crash-safe fallbacks and Vitest regression tests.',
    ].join(' ');
    const parsedCV: ParsedCV = {
      name: 'Repo Match Candidate',
      skills: ['TypeScript'],
      experiences: [],
      educationBlocks: [],
      credentials: [],
      projects: [],
    };

    await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-workers-review-evidence',
      resumeText,
      parsedCV,
      env: mockEnv,
      decompositionResult: {
        ...mockDecomposition,
        experiences: [],
        projects: [],
        skills: [],
        education: [],
        credentials: [],
      },
    });

    const canonicalTerms = vi.mocked(insertCandidateNode).mock.calls
      .filter((call) => call[1].node_type === 'ReviewEvidence')
      .flatMap((call) => {
        const properties = JSON.parse(String(call[1].extracted_properties_json)) as {
          semantic_terms?: Array<{ canonical_key?: string }>;
        };
        return properties.semantic_terms?.map((term) => term.canonical_key ?? '') ?? [];
      });
    expect(canonicalTerms.some((term) => term.includes('cloudflare-workers'))).toBe(true);
    expect(canonicalTerms.some((term) => term.includes('runtime'))).toBe(true);
    expect(canonicalTerms.some((term) => term.includes('request-routing'))).toBe(true);
    expect(canonicalTerms.some((term) => term.includes('durable-task-queues'))).toBe(true);
    expect(canonicalTerms).toContain('term:serverless-deployments');
    expect(canonicalTerms.some((term) => term.includes('source-mapped-stack'))).toBe(true);
    expect(canonicalTerms).toContain('term:vitest-regression-tests');

  });

  it('inserts all parser-only review evidence before embedding can block later CV lines', async () => {
    vi.mocked(embedCandidateNode).mockRejectedValue(new Error('embedding unavailable'));
    const db = mockDb();
    const resumeText = [
      'Senior TypeScript backend engineer with 8 years building developer platforms and cloud infrastructure tools.',
      'Staff Engineer, Edge Platform Team: designed Cloudflare Workers-style runtime APIs, request routing, KV-backed configuration, durable task queues, and TypeScript SDK tooling for serverless deployments.',
      'Led debugging of source-mapped stack traces and CLI error handling in local dev tools, including crash-safe fallbacks and Vitest regression tests.',
    ].join('\n');
    const parsedCV: ParsedCV = {
      name: 'Repo Match Candidate',
      skills: ['TypeScript'],
      experiences: [],
      educationBlocks: [],
      credentials: [],
      projects: [],
    };

    await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-parser-only-workers',
      resumeText,
      parsedCV,
      env: mockEnv,
      decompositionResult: null,
    });

    const insertOrder = vi.mocked(insertCandidateNode).mock.invocationCallOrder;
    const embedOrder = vi.mocked(embedCandidateNode).mock.invocationCallOrder;
    expect(Math.max(...insertOrder)).toBeLessThan(Math.min(...embedOrder));

    const canonicalTerms = vi.mocked(insertCandidateNode).mock.calls
      .filter((call) => call[1].node_type === 'ReviewEvidence')
      .flatMap((call) => {
        const properties = JSON.parse(String(call[1].extracted_properties_json)) as {
          semantic_terms?: Array<{ canonical_key?: string }>;
        };
        return properties.semantic_terms?.map((term) => term.canonical_key ?? '') ?? [];
      });
    expect(canonicalTerms.some((term) => term.includes('cloudflare-workers'))).toBe(true);
    expect(canonicalTerms.some((term) => term.includes('request-routing'))).toBe(true);
    expect(canonicalTerms.some((term) => term.includes('source-mapped-stack'))).toBe(true);
    expect(canonicalTerms).toContain('term:vitest-regression-tests');
  });

  it('signals source-backed evidence readiness before parser-only embeddings run', async () => {
    const db = mockDb();
    const ready = vi.fn(async () => undefined);
    const parsedCV: ParsedCV = {
      name: 'Repo Match Candidate',
      skills: ['TypeScript'],
      experiences: [],
      educationBlocks: [],
      credentials: [],
      projects: [],
    };

    await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-ready-before-embed',
      resumeText: 'Senior TypeScript engineer reviewing request routing bugs and Vitest regression tests.',
      parsedCV,
      env: mockEnv,
      decompositionResult: null,
      afterSourceBackedEvidence: ready,
    });

    expect(ready).toHaveBeenCalledTimes(1);
    expect(Math.max(...vi.mocked(insertCandidateNode).mock.invocationCallOrder)).toBeLessThan(
      vi.mocked(ready).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(ready).mock.invocationCallOrder[0]!).toBeLessThan(
      Math.min(...vi.mocked(embedCandidateNode).mock.invocationCallOrder),
    );
  });

  it('can skip parser-only node embeddings after source-backed evidence is persisted', async () => {
    const db = mockDb();
    const ready = vi.fn(async () => undefined);
    const parsedCV: ParsedCV = {
      name: 'Repo Match Candidate',
      skills: ['TypeScript'],
      experiences: [],
      educationBlocks: [],
      credentials: [],
      projects: [],
    };

    const result = await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-skip-node-embeddings',
      resumeText: 'Senior TypeScript engineer reviewing request routing bugs and Vitest regression tests.',
      parsedCV,
      env: mockEnv,
      decompositionResult: null,
      afterSourceBackedEvidence: ready,
      maxNodeEmbeddings: 0,
      maxParserOnlyNodes: 4,
      mirrorLivingContext: false,
      skipPostDecompositionMaintenance: true,
    });

    expect(result.nodesInserted).toBeGreaterThan(0);
    expect(result.nodesInserted).toBeLessThanOrEqual(5);
    expect(result.nodesEmbedded).toBe(0);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(insertCandidateNode).toHaveBeenCalled();
    expect(vi.mocked(insertCandidateNode).mock.calls.every((call) =>
      call[2]?.mirrorLivingContext === false
    )).toBe(true);
    expect(embedCandidateNode).not.toHaveBeenCalled();
    expect(writeCandidateGraph).not.toHaveBeenCalled();
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
      resumeText: 'TypeScript engineer. Led backend migration.',
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
      resumeText: 'TypeScript engineer. Led backend migration.',
      parsedCV,
      env: mockEnv,
    });

    expect(result.nodesInserted).toBeGreaterThan(0);
  });

  it('does not persist parser-only resume nodes without exact source quotes', async () => {
    const db = mockDb();
    const parsedCV: ParsedCV = {
      name: 'Jane Doe',
      skills: ['Rust'],
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

    await decomposeResumeToGraph({
      db,
      candidateId: 'candidate-source-filter',
      resumeText: 'TypeScript engineer. Led backend migration.',
      parsedCV,
      env: mockEnv,
      decompositionResult: null,
    });

    const resumeNodes = vi.mocked(insertCandidateNode).mock.calls
      .map((call) => call[1])
      .filter((node) => node.source_type === 'resume');
    expect(resumeNodes.length).toBeGreaterThan(0);
    expect(resumeNodes.every((node) => {
      const properties = JSON.parse(String(node.extracted_properties_json)) as {
        source_quote?: string;
        source_quote_validated?: boolean;
      };
      return properties.source_quote_validated === true
        && typeof properties.source_quote === 'string'
        && properties.source_quote.length > 0;
    })).toBe(true);
    expect(resumeNodes.some((node) => node.node_type === 'Skill'
      && node.narrative_text === 'rust')).toBe(false);
  });
});
