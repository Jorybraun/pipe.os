/**
 * Candidate Situation Fit scorer unit tests.
 *
 * Exercises `candidateSituationFit` with a stub LLMProvider.
 * Pattern mirrors `roleFitRerank.ts` parse/normalize path.
 */

import { describe, it, expect } from 'vitest';
import { candidateSituationFit } from '../candidateSituationFit';
import type { LLMProvider } from '../../llm/types';
import type { CandidateDiscoveryResult } from '../agent';
import type { RepoEngineeringSignalsRow, CandidateNode } from '../../../types';

function makeStubProvider(response: unknown, name = 'stub-gemma'): LLMProvider {
  return {
    name,
    supportsTools: false,
    async complete() {
      return { content: typeof response === 'string' ? response : JSON.stringify(response) };
    },
  };
}

function validResponse(repoId = 42) {
  return {
    rankings: [
      {
        repo_id: repoId,
        fit_score: 0.82,
        fit_band: 'strong',
        reasoning: {
          matches: ['Candidate has microservices experience matching repo architecture'],
          mismatches: [],
          summary: 'Strong fit for platform-level candidate.',
        },
        per_signal_scores: {
          skill_coverage: 0.9,
          seniority_fit: 0.85,
          complexity_fit: 0.8,
          architecture_fit: 0.9,
          test_culture_fit: 0.75,
          challenge_surface_fit: 0.8,
        },
      },
    ],
  };
}

function makeCandidateResult(): CandidateDiscoveryResult {
  return {
    candidateSearchableProfile: 'Jane is a senior platform engineer...',
    keyConcepts: {
      mustHaveSkills: ['typescript', 'nodejs'],
      niceToHaveSkills: ['rust'],
      seniority: 'senior',
      primary_language: 'typescript',
      detected_domain: 'fintech',
    },
    careerContext: {
      company_stages: ['series-b', 'growth'],
      company_size_exposure: ['50-200', '200-1000'],
      tenure_pattern: 'stable',
      progression_velocity: 'fast',
      ownership_depth: 'platform',
      system_scale_exposure: ['microservices', 'high-throughput'],
      greenfield_ratio: 0.4,
    },
    situationSignature: {
      primary_challenge_types: ['scaling', 'reliability'],
      architecture_exposure: ['microservices', 'event-driven'],
      test_culture_exposure: 'TDD, high coverage',
      review_culture: 'small PRs, thorough review',
      impact_signals: ['reduced latency 40%'],
    },
    profileVersion: 'candidate-v2',
    modelUsed: 'stub-gemma',
    rawText: '',
  };
}

function makeRepoSignals(repoId: number): RepoEngineeringSignalsRow {
  return {
    repo_id: repoId,
    signals_version: 'v2.0.0',
    content_hash: 'abc',
    test_touch_rate: 0.8,
    mean_changed_files: 5,
    p90_changed_files: 12,
    issue_link_rate: 0.7,
    complexity_band: 'high',
    swe_bench_eligibility_rate: 0.6,
    architecture_style: 'microservice',
    review_density: 2.5,
    commit_cadence: null,
    satd_density: null,
    test_style: 'integration_heavy',
    challenge_surfaces: null,
    repo_searchable_profile: 'A microservice repo...',
    engineering_narrative: 'Engineering narrative...',
    signal_json: '',
    generated_at: '',
    model_used: '',
    model_version: '',
  };
}

describe('candidateSituationFit', () => {
  it('parses a well-formed Gemma response into structured result', async () => {
    const provider = makeStubProvider(validResponse(101));

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
    });

    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0]!.repo_id).toBe(101);
    expect(result.rankings[0]!.fit_score).toBe(0.82);
    expect(result.rankings[0]!.fit_band).toBe('strong');
    expect(result.rankings[0]!.reasoning.matches[0]).toContain('microservices');
  });

  it('strips markdown code fences around the JSON response', async () => {
    const provider = makeStubProvider(
      '```json\n' + JSON.stringify(validResponse(101)) + '\n```',
    );

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
    });

    expect(result.rankings[0]!.fit_score).toBe(0.82);
  });

  it('returns empty rankings when repos array is empty', async () => {
    const provider = makeStubProvider(validResponse());

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [],
    });

    expect(result.rankings).toEqual([]);
    expect(result.rawText).toBe('');
  });

  it('clamps fit_score to [0, 1]', async () => {
    const provider = makeStubProvider({
      rankings: [
        {
          repo_id: 101,
          fit_score: 2.5,
          fit_band: 'strong',
          reasoning: { matches: [], mismatches: [], summary: '' },
          per_signal_scores: { skill_coverage: 1.2 },
        },
      ],
    });

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
    });

    expect(result.rankings[0]!.fit_score).toBe(1);
  });

  it('derives fit_band from score when band is missing/invalid', async () => {
    const provider = makeStubProvider({
      rankings: [
        {
          repo_id: 101,
          fit_score: 0.3,
          fit_band: 'INVALID',
          reasoning: { matches: [], mismatches: [], summary: '' },
          per_signal_scores: {},
        },
      ],
    });

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
    });

    expect(result.rankings[0]!.fit_band).toBe('weak');
  });

  it('throws when rankings array is missing', async () => {
    const provider = makeStubProvider({});

    await expect(
      candidateSituationFit({
        provider,
        candidateResult: makeCandidateResult(),
        candidateKeyConcepts: makeCandidateResult().keyConcepts,
        repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      }),
    ).rejects.toThrow(/rankings/i);
  });

  it('throws on empty provider response', async () => {
    const provider: LLMProvider = {
      name: 'empty',
      supportsTools: false,
      async complete() {
        return { content: null };
      },
    };

    await expect(
      candidateSituationFit({
        provider,
        candidateResult: makeCandidateResult(),
        candidateKeyConcepts: makeCandidateResult().keyConcepts,
        repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      }),
    ).rejects.toThrow(/empty/i);
  });

  it('appends cultural signal block when nodes are provided', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: LLMProvider = {
      name: 'capture',
      supportsTools: false,
      async complete(messages) {
        capturedMessages = messages as Array<{ role: string; content: string }>;
        return { content: JSON.stringify(validResponse(101)) };
      },
    };

    const nodes: CandidateNode[] = [
      {
        id: 'node-1',
        candidate_id: 'candidate-1',
        node_type: 'CulturalSignal',
        narrative_text: 'Ownership signal',
        extracted_properties_json: JSON.stringify({
          dimension: 'ownership',
          bars_score: 4,
          reasoning: 'Strong ownership evidence',
          is_role_specific: false,
        }),
        embedding_json: null,
        source_type: 'automated_screener',
        source_reference: 'session-1',
        captured_at: 1234567890,
        confidence: 0.8,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'culture_v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      culturalSignalNodes: nodes,
    });

    const userMessage = capturedMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('### cultural_signals');
    expect(userMessage).toContain('ownership: 4/5');
    expect(userMessage).toContain('Strong ownership evidence');
  });

  it('prefers role-specific cultural signals when roleContextId is provided', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: LLMProvider = {
      name: 'capture',
      supportsTools: false,
      async complete(messages) {
        capturedMessages = messages as Array<{ role: string; content: string }>;
        return { content: JSON.stringify(validResponse(101)) };
      },
    };

    const nodes: CandidateNode[] = [
      {
        id: 'node-generic',
        candidate_id: 'candidate-1',
        node_type: 'CulturalSignal',
        narrative_text: 'Generic ownership',
        extracted_properties_json: JSON.stringify({
          dimension: 'ownership',
          bars_score: 3,
          reasoning: 'Generic ownership evidence',
          is_role_specific: false,
        }),
        embedding_json: null,
        source_type: 'automated_screener',
        source_reference: 'session-1',
        captured_at: 1234567890,
        confidence: 0.7,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'culture_v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
      {
        id: 'node-role',
        candidate_id: 'candidate-1',
        node_type: 'CulturalSignal',
        narrative_text: 'Role-specific ownership',
        extracted_properties_json: JSON.stringify({
          dimension: 'ownership',
          bars_score: 5,
          reasoning: 'Role-specific ownership evidence',
          is_role_specific: true,
          role_context_id: 'role-123',
        }),
        embedding_json: null,
        source_type: 'culture_interview',
        source_reference: 'session-2',
        captured_at: 1234567890,
        confidence: 0.9,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'culture_v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      culturalSignalNodes: nodes,
      roleContextId: 'role-123',
    });

    const userMessage = capturedMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('ownership: 5/5');
    expect(userMessage).toContain('Role-specific ownership evidence');
    expect(userMessage).not.toContain('Generic ownership evidence');
  });

  it('injects experience, project, and skill nodes into prompt', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: LLMProvider = {
      name: 'capture',
      supportsTools: false,
      async complete(messages) {
        capturedMessages = messages as Array<{ role: string; content: string }>;
        return { content: JSON.stringify(validResponse(101)) };
      },
    };

    const experiences: CandidateNode[] = [
      {
        id: 'exp-1',
        candidate_id: 'candidate-1',
        node_type: 'Experience',
        narrative_text: 'Led backend migration to microservices',
        extracted_properties_json: JSON.stringify({ company: 'Acme Corp', role: 'Senior Engineer' }),
        embedding_json: null,
        source_type: 'resume',
        source_reference: null,
        captured_at: Math.floor(Date.now() / 1000),
        confidence: 0.9,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'adr041-v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    const projects: CandidateNode[] = [
      {
        id: 'proj-1',
        candidate_id: 'candidate-1',
        node_type: 'Project',
        narrative_text: 'Open-source CLI tool for deployment automation',
        extracted_properties_json: JSON.stringify({ name: 'DeployKit', description: 'Open-source CLI tool' }),
        embedding_json: null,
        source_type: 'resume',
        source_reference: null,
        captured_at: Math.floor(Date.now() / 1000),
        confidence: 0.85,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'adr041-v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    const skills: CandidateNode[] = [
      {
        id: 'skill-1',
        candidate_id: 'candidate-1',
        node_type: 'Skill',
        narrative_text: 'typescript (expert, 5 years)',
        extracted_properties_json: JSON.stringify({ name: 'typescript', proficiency: 'expert', years_exposure: 5 }),
        embedding_json: null,
        source_type: 'resume',
        source_reference: null,
        captured_at: Math.floor(Date.now() / 1000),
        confidence: 0.9,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'adr041-v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      experienceNodes: experiences,
      projectNodes: projects,
      skillNodes: skills,
    });

    const userMessage = capturedMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('### candidate_experiences');
    expect(userMessage).toContain('Acme Corp');
    expect(userMessage).toContain('### candidate_projects');
    expect(userMessage).toContain('DeployKit');
    expect(userMessage).toContain('### candidate_skills');
    expect(userMessage).toContain('typescript (expert, 5 years)');
  });

  it('skips low-confidence nodes in prompt blocks', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: LLMProvider = {
      name: 'capture',
      supportsTools: false,
      async complete(messages) {
        capturedMessages = messages as Array<{ role: string; content: string }>;
        return { content: JSON.stringify(validResponse(101)) };
      },
    };

    const lowConfidenceSkills: CandidateNode[] = [
      {
        id: 'skill-low',
        candidate_id: 'candidate-1',
        node_type: 'Skill',
        narrative_text: 'rust (beginner)',
        extracted_properties_json: JSON.stringify({ name: 'rust', proficiency: 'beginner' }),
        embedding_json: null,
        source_type: 'resume',
        source_reference: null,
        captured_at: Math.floor(Date.now() / 1000),
        confidence: 0.3,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'adr041-v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      skillNodes: lowConfidenceSkills,
    });

    const userMessage = capturedMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).not.toContain('### candidate_skills');
  });

  it('applies recency multiplier to fit scores', async () => {
    const provider = makeStubProvider(validResponse(101));

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      recencyMultiplier: 0.5,
    });

    expect(result.rankings[0]!.fit_score).toBe(0.41); // 0.82 * 0.5 = 0.41
  });

  it('defaults recency multiplier to 1.0 when not provided', async () => {
    const provider = makeStubProvider(validResponse(101));

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
    });

    expect(result.rankings[0]!.fit_score).toBe(0.82);
  });

  it('injects enriched experience fields into prompt when present', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: LLMProvider = {
      name: 'capture',
      supportsTools: false,
      async complete(messages) {
        capturedMessages = messages as Array<{ role: string; content: string }>;
        return { content: JSON.stringify(validResponse(101)) };
      },
    };

    const experiences: CandidateNode[] = [
      {
        id: 'exp-1',
        candidate_id: 'candidate-1',
        node_type: 'Experience',
        narrative_text: 'Led backend migration to microservices',
        extracted_properties_json: JSON.stringify({
          company: 'Acme Corp',
          role: 'Senior Engineer',
          domain: 'fintech',
          company_stage: 'growth',
          impact_summary: 'Reduced latency by 40% across payment flows',
        }),
        embedding_json: null,
        source_type: 'resume',
        source_reference: null,
        captured_at: Math.floor(Date.now() / 1000),
        confidence: 0.9,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'adr041-v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      experienceNodes: experiences,
    });

    const userMessage = capturedMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('### candidate_experiences');
    expect(userMessage).toContain('domain: fintech');
    expect(userMessage).toContain('stage: growth');
    expect(userMessage).toContain('impact: Reduced latency by 40% across payment flows');
  });

  it('injects depth_pattern into skill block when present', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: LLMProvider = {
      name: 'capture',
      supportsTools: false,
      async complete(messages) {
        capturedMessages = messages as Array<{ role: string; content: string }>;
        return { content: JSON.stringify(validResponse(101)) };
      },
    };

    const skills: CandidateNode[] = [
      {
        id: 'skill-1',
        candidate_id: 'candidate-1',
        node_type: 'Skill',
        narrative_text: 'typescript (expert, 5 years)',
        extracted_properties_json: JSON.stringify({
          name: 'typescript',
          proficiency: 'expert',
          years_exposure: 5,
          depth_pattern: 'primary across 5 roles',
        }),
        embedding_json: null,
        source_type: 'resume',
        source_reference: null,
        captured_at: Math.floor(Date.now() / 1000),
        confidence: 0.9,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'adr041-v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      skillNodes: skills,
    });

    const userMessage = capturedMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('### candidate_skills');
    expect(userMessage).toContain('typescript (expert, 5 years, primary across 5 roles)');
  });

  it('injects CareerArc block when nodes are provided', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: LLMProvider = {
      name: 'capture',
      supportsTools: false,
      async complete(messages) {
        capturedMessages = messages as Array<{ role: string; content: string }>;
        return { content: JSON.stringify(validResponse(101)) };
      },
    };

    const careerArcs: CandidateNode[] = [
      {
        id: 'arc-1',
        candidate_id: 'candidate-1',
        node_type: 'CareerArc',
        narrative_text: 'Steady progression from IC to platform architect across fintech startups',
        extracted_properties_json: JSON.stringify({
          domain_specialization: 'fintech infrastructure',
          company_stage_pattern: ['seed', 'series-b', 'growth'],
          ownership_progression: 'IC → senior → staff → platform architect',
          impact_themes: ['latency reduction', 'reliability engineering', 'cost optimization'],
        }),
        embedding_json: null,
        source_type: 'resume',
        source_reference: null,
        captured_at: Math.floor(Date.now() / 1000),
        confidence: 0.85,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'adr041-v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      careerArcNodes: careerArcs,
    });

    const userMessage = capturedMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('### candidate_career_arc');
    expect(userMessage).toContain('domain specialization: fintech infrastructure');
    expect(userMessage).toContain('company stages: seed, series-b, growth');
    expect(userMessage).toContain('ownership progression: IC → senior → staff → platform architect');
    expect(userMessage).toContain('impact themes: latency reduction, reliability engineering, cost optimization');
  });

  it('omits enriched annotations when fields are absent (backward compatible)', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const provider: LLMProvider = {
      name: 'capture',
      supportsTools: false,
      async complete(messages) {
        capturedMessages = messages as Array<{ role: string; content: string }>;
        return { content: JSON.stringify(validResponse(101)) };
      },
    };

    const experiences: CandidateNode[] = [
      {
        id: 'exp-1',
        candidate_id: 'candidate-1',
        node_type: 'Experience',
        narrative_text: 'Led backend migration to microservices',
        extracted_properties_json: JSON.stringify({ company: 'Acme Corp', role: 'Senior Engineer' }),
        embedding_json: null,
        source_type: 'resume',
        source_reference: null,
        captured_at: Math.floor(Date.now() / 1000),
        confidence: 0.9,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'adr041-v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    const skills: CandidateNode[] = [
      {
        id: 'skill-1',
        candidate_id: 'candidate-1',
        node_type: 'Skill',
        narrative_text: 'typescript (expert, 5 years)',
        extracted_properties_json: JSON.stringify({ name: 'typescript', proficiency: 'expert', years_exposure: 5 }),
        embedding_json: null,
        source_type: 'resume',
        source_reference: null,
        captured_at: Math.floor(Date.now() / 1000),
        confidence: 0.9,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'adr041-v1',
        created_at: 1234567890,
        updated_at: 1234567890,
      },
    ];

    await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      experienceNodes: experiences,
      skillNodes: skills,
    });

    const userMessage = capturedMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('Senior Engineer at Acme Corp');
    // The user message naturally contains 'detected_domain:' and 'impact_signals:' in the
    // flat profile sections. We need to check that the EXPERIENCE line lacks enriched annotations.
    const experienceLine = userMessage.split('\n').find((l) => l.includes('Senior Engineer at Acme Corp'));
    expect(experienceLine).toBeDefined();
    expect(experienceLine).not.toContain('[domain:');
    expect(experienceLine).not.toContain('[impact:');
    expect(userMessage).toContain('typescript (expert, 5 years)');
    const skillLine = userMessage.split('\n').find((l) => l.includes('typescript (expert, 5 years)'));
    expect(skillLine).toBeDefined();
    expect(skillLine).not.toContain('primary across');
  });
});
