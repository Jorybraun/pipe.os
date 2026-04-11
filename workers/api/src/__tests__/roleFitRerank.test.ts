/**
 * Role-Fit Reranker tests — ADR-036 §2.3 Stage 2 (runtime rerank).
 *
 * BDD invariant: the rerank prompt MUST ground justifications in verbatim
 * RCD technical_context tokens. A rerank that scores by stars instead of
 * RCD fit is the silent failure mode this module exists to prevent.
 *
 * These tests use a mock LLMProvider to exercise the prompt construction,
 * JSON parsing, row assembly, and ordering without hitting a real model.
 */

import { describe, it, expect } from 'vitest';

import { roleFitRerank, type RerankCandidate } from '../lib/repoDiscovery/roleFitRerank';
import type { LLMProvider, LLMMessage, LLMCompletion } from '../lib/llm/types';
import type { RoleContextDocument, RepoEngineeringSignalsRow } from '../types';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function buildTestRcd(): RoleContextDocument {
  return {
    rcd_version: 'rcd-v1',
    role_context_id: 'rc-test-rerank',
    pipeline_id: 'pipe-test',
    created_at: '2026-04-10T00:00:00.000Z',
    domain_matrix: {
      HIRING_MANAGER: {
        codebase: {
          primary_authority: true,
          coverage: 'deep',
          laddering_chains: [],
          open_codes: [],
          axial_links: [],
          stories: [],
          summary: 'The team writes systems-level Rust with tight correctness budgets.',
        },
        work: {
          primary_authority: true,
          coverage: 'covered',
          laddering_chains: [],
          open_codes: [],
          axial_links: [],
          stories: [],
          summary: 'We build browser-based WebAssembly runtimes for real-time data pipelines.',
        },
      },
    },
    conflicts: [],
    technical_context: {
      stack: ['Rust', 'WebAssembly'],
      constructs: ['systems_programming', 'wasm_runtime'],
      seniority_band: 'senior',
      codebase_expectations: ['monorepo', 'zero_unsafe'],
      dispositional_weights: { rigor: 1.3, pragmatism: 0.9 },
    },
    team_culture_profile: { per_stakeholder: {} },
    bars_overrides: [],
    probe_bank_enrichment: { static_base_version: 'v1', enriched_probes: [] },
    dealbreakers: [],
    red_flags: [],
    consumer_slice: {} as never, // not read by roleFitRerank
    validation_metadata: {
      schema_version: 'rcd-v1',
      synthesis_model: 'mock',
      synthesis_prompt_version: 'v1',
      verification_pass_model: 'mock',
      face_validity_reviewed_at: null,
      face_validity_reviewer: null,
    },
  };
}

function buildSignals(overrides: Partial<RepoEngineeringSignalsRow> = {}): RepoEngineeringSignalsRow {
  return {
    repo_id: 1,
    signals_version: 'sig-v1',
    content_hash: 'hash-abc',
    test_touch_rate: 0.62,
    mean_changed_files: 3.1,
    p90_changed_files: 8,
    issue_link_rate: 0.78,
    complexity_band: 'medium',
    swe_bench_eligibility_rate: 0.31,
    architecture_style: 'modular_monolith',
    review_density: 0.85,
    commit_cadence: 4.2,
    satd_density: 0.04,
    engineering_narrative: 'High test discipline, modular monolith, reviewed changes.',
    signal_json: '{}',
    generated_at: '2026-04-09T12:00:00.000Z',
    model_used: 'claude-haiku-4-5',
    model_version: 'haiku-4-5-20251001',
    ...overrides,
  };
}

function buildCandidates(): RerankCandidate[] {
  return [
    {
      repo_id: 1,
      full_name: 'acme/wasm-runtime',
      signals: buildSignals({ repo_id: 1, test_touch_rate: 0.72 }),
    },
    {
      repo_id: 2,
      full_name: 'acme/crud-dashboard',
      signals: buildSignals({ repo_id: 2, test_touch_rate: 0.12, architecture_style: 'monolith' }),
    },
  ];
}

// ─── Mock provider ─────────────────────────────────────────────────────────

interface MockProvider extends LLMProvider {
  calls: Array<{ messages: LLMMessage[]; options: unknown }>;
}

function createMockProvider(responseText: string): MockProvider {
  const calls: MockProvider['calls'] = [];
  return {
    name: 'mock-gemma-4-26b',
    supportsTools: false,
    calls,
    async complete(messages, options): Promise<LLMCompletion> {
      calls.push({ messages, options });
      return { content: responseText };
    },
  };
}

// ─── Canned model output ───────────────────────────────────────────────────

function buildMockResponse(): string {
  return JSON.stringify({
    rankings: [
      {
        repo_id: 1,
        alignment_score: 0.84,
        alignment_band: 'strong',
        reasoning: {
          matches: [
            'Strong Rust systems-programming fingerprint with high test_touch_rate',
            'WebAssembly runtime aligns with the role codebase_expectations',
          ],
          mismatches: ['Uses a modular_monolith instead of the team monorepo layout'],
          summary: 'Rust + WebAssembly fit with monorepo expectations is strong for this senior role.',
        },
        per_signal_scores: {
          test_touch_rate: 0.9,
          architecture_style: 0.7,
          language_match: 0.95,
        },
      },
      {
        repo_id: 2,
        alignment_score: 0.22,
        alignment_band: 'mismatch',
        reasoning: {
          matches: ['monorepo conventions present but minimal'],
          mismatches: [
            'No Rust or WebAssembly signal in the engineering narrative',
            'test_touch_rate far below senior-band expectation',
          ],
          summary: 'Crud dashboard does not match the Rust stack this role is anchored in.',
        },
        per_signal_scores: {
          test_touch_rate: 0.2,
          language_match: 0.1,
        },
      },
    ],
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('roleFitRerank', () => {
  it('returns empty result when candidates list is empty', async () => {
    const provider = createMockProvider('{"rankings":[]}');
    const result = await roleFitRerank({ provider, rcd: buildTestRcd(), candidates: [] });

    expect(result.alignments).toEqual([]);
    expect(result.rawText).toBe('');
    expect(provider.calls).toHaveLength(0);
  });

  it('calls the provider with forceJson and includes RCD technical_context in the user message', async () => {
    const provider = createMockProvider(buildMockResponse());
    const rcd = buildTestRcd();

    await roleFitRerank({ provider, rcd, candidates: buildCandidates() });

    expect(provider.calls).toHaveLength(1);
    const { messages, options } = provider.calls[0]!;
    expect((options as { forceJson?: boolean }).forceJson).toBe(true);

    // Last message is the user message containing the RCD block.
    const userMsg = messages[messages.length - 1]!.content ?? '';
    expect(userMsg).toContain('Rust');
    expect(userMsg).toContain('WebAssembly');
    expect(userMsg).toContain('monorepo');
    expect(userMsg).toContain('zero_unsafe');
    // Candidate signals block must include both repo_ids we sent.
    expect(userMsg).toContain('acme/wasm-runtime');
    expect(userMsg).toContain('acme/crud-dashboard');
  });

  it('parses rankings into RepoRoleAlignmentRow[] sorted by alignment_score desc', async () => {
    const provider = createMockProvider(buildMockResponse());
    const rcd = buildTestRcd();

    const { alignments } = await roleFitRerank({
      provider, rcd, candidates: buildCandidates(),
    });

    expect(alignments).toHaveLength(2);
    // First row is the higher-scoring repo.
    expect(alignments[0]!.repo_id).toBe(1);
    expect(alignments[0]!.alignment_band).toBe('strong');
    expect(alignments[0]!.alignment_score).toBeCloseTo(0.84, 6);
    expect(alignments[1]!.repo_id).toBe(2);
    expect(alignments[1]!.alignment_band).toBe('mismatch');
  });

  it('stamps rcd_version and signals_version on every alignment row (cache key invariant)', async () => {
    const provider = createMockProvider(buildMockResponse());
    const rcd = buildTestRcd();
    const candidates = buildCandidates();

    const { alignments } = await roleFitRerank({ provider, rcd, candidates });

    for (const row of alignments) {
      expect(row.rcd_version).toBe('rcd-v1');
      expect(row.signals_version).toBe('sig-v1');
      expect(row.role_context_id).toBe('rc-test-rerank');
      expect(typeof row.generated_at).toBe('string');
      expect(row.generated_at.length).toBeGreaterThan(0);
    }
  });

  it('preserves reasoning JSON with matches that reference verbatim RCD tokens (BDD invariant)', async () => {
    const provider = createMockProvider(buildMockResponse());
    const rcd = buildTestRcd();

    const { alignments } = await roleFitRerank({
      provider, rcd, candidates: buildCandidates(),
    });

    const top = alignments[0]!;
    const reasoning = JSON.parse(top.reasoning_json) as {
      matches: string[];
      mismatches: string[];
      summary: string;
    };

    // At least one match bullet must quote a technical_context token verbatim.
    const rcdTokens = [
      ...rcd.technical_context.stack,
      ...rcd.technical_context.codebase_expectations,
    ];
    const hasVerbatim = reasoning.matches.some((m) =>
      rcdTokens.some((t) => m.includes(t)),
    );
    expect(hasVerbatim).toBe(true);
    expect(reasoning.summary.length).toBeGreaterThan(0);
  });

  it('drops rankings whose repo_id was not in the candidate pool (hallucination guard)', async () => {
    const hallucinated = JSON.stringify({
      rankings: [
        {
          repo_id: 1,
          alignment_score: 0.7,
          alignment_band: 'moderate',
          reasoning: { matches: ['Rust match'], mismatches: [], summary: 'Rust fit.' },
          per_signal_scores: {},
        },
        {
          repo_id: 999, // not in candidate pool
          alignment_score: 0.9,
          alignment_band: 'strong',
          reasoning: { matches: ['fake'], mismatches: [], summary: 'hallucinated.' },
          per_signal_scores: {},
        },
      ],
    });
    const provider = createMockProvider(hallucinated);
    const rcd = buildTestRcd();

    const { alignments } = await roleFitRerank({
      provider, rcd, candidates: buildCandidates(),
    });

    expect(alignments).toHaveLength(1);
    expect(alignments[0]!.repo_id).toBe(1);
  });

  it('clamps alignment_score into [0, 1] and derives band when model sends invalid band', async () => {
    const sloppy = JSON.stringify({
      rankings: [
        {
          repo_id: 1,
          alignment_score: 1.5,            // out of range
          alignment_band: 'outstanding',   // not a valid enum
          reasoning: { matches: ['Rust'], mismatches: [], summary: 'Rust fit.' },
          per_signal_scores: {},
        },
      ],
    });
    const provider = createMockProvider(sloppy);
    const { alignments } = await roleFitRerank({
      provider, rcd: buildTestRcd(), candidates: [buildCandidates()[0]!],
    });

    expect(alignments).toHaveLength(1);
    expect(alignments[0]!.alignment_score).toBe(1);
    expect(alignments[0]!.alignment_band).toBe('strong'); // derived from clamped 1.0
  });

  it('throws when the provider returns an empty response', async () => {
    const provider = createMockProvider('');
    await expect(
      roleFitRerank({ provider, rcd: buildTestRcd(), candidates: buildCandidates() }),
    ).rejects.toThrow(/empty response/);
  });

  it('throws when the response is not valid JSON', async () => {
    const provider = createMockProvider('not json at all');
    await expect(
      roleFitRerank({ provider, rcd: buildTestRcd(), candidates: buildCandidates() }),
    ).rejects.toThrow(/failed to parse JSON/);
  });

  it('strips markdown code fences before parsing', async () => {
    const fenced = '```json\n' + buildMockResponse() + '\n```';
    const provider = createMockProvider(fenced);
    const { alignments } = await roleFitRerank({
      provider, rcd: buildTestRcd(), candidates: buildCandidates(),
    });
    expect(alignments).toHaveLength(2);
  });

  it('uses provider.name as the stamped model_used unless modelName override is provided', async () => {
    const provider = createMockProvider(buildMockResponse());
    const rcd = buildTestRcd();

    const defaultRun = await roleFitRerank({ provider, rcd, candidates: buildCandidates() });
    expect(defaultRun.alignments[0]!.model_used).toBe('mock-gemma-4-26b');

    const overrideRun = await roleFitRerank({
      provider, rcd, candidates: buildCandidates(),
      modelName: 'gemma-4-26b-production',
    });
    expect(overrideRun.alignments[0]!.model_used).toBe('gemma-4-26b-production');
  });
});
