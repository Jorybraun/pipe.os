/**
 * buildProfileSections tests.
 */

import { describe, it, expect } from 'vitest';
import { buildProfileSections } from '../buildProfileSections';
import type { DecompositionResult } from '../candidateDecompositionPrompt';
import type { CandidateDiscoveryResult } from '../agent';
import type { ContributionCalendar } from '../../enrichment/githubClient';

describe('buildProfileSections', () => {
  it('returns minimal sections for a candidate with no enrichment', () => {
    const sections = buildProfileSections(null, null, null, null);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.type).toBe('hero');
    expect(sections[1]!.type).toBe('enrichment-status');
  });

  it('returns correct sections for a candidate with full data', () => {
    const decomposition: DecompositionResult = {
      candidate_name: 'Alice Smith',
      experiences: [
        {
          company: 'Acme',
          role: 'Engineer',
          duration_months: 24,
          domain: 'fintech',
          company_stage: 'growth',
          impact_summary: 'Built core payments API',
          narrative: 'Led payments team',
          skills_demonstrated: ['typescript', 'postgres'],
          confidence: 0.9,
        },
        {
          company: 'BetaCorp',
          role: 'Senior Engineer',
          duration_months: 36,
          domain: 'saas',
          company_stage: 'series-a',
          impact_summary: 'Scaled infra to 1M users',
          narrative: 'Owned infra',
          skills_demonstrated: ['go', 'k8s'],
          confidence: 0.9,
        },
      ],
      projects: [
        { name: 'open-source-cli', description: 'A CLI tool', skills_demonstrated: ['rust'], confidence: 0.8 },
      ],
      skills: [
        { name: 'typescript', proficiency: 'expert', years_exposure: 5, confidence: 0.95 },
        { name: 'go', proficiency: 'proficient', years_exposure: 3, confidence: 0.9 },
      ],
      education: [{ institution: 'MIT', degree: 'BS', field: 'CS', year: '2018', confidence: 0.95 }],
      credentials: [],
      career_arc: {
        narrative: 'Strong upward trajectory',
        growth_velocity: 'fast',
        transitions: [{ from: 'Engineer', to: 'Senior Engineer', at_company: 'BetaCorp' }],
        confidence: 0.9,
      },
    };

    const discovery: CandidateDiscoveryResult = {
      candidateSearchableProfile: 'Alice is a strong full-stack engineer with 5+ years of experience.',
      keyConcepts: {
        mustHaveSkills: ['typescript', 'go'],
        niceToHaveSkills: ['rust'],
        seniority: 'senior',
        primary_language: 'typescript',
        detected_domain: 'fintech',
      },
      careerContext: {
        company_stages: ['seed', 'series-a', 'growth'],
        company_size_exposure: ['10-50', '50-200'],
        tenure_pattern: 'stable',
        progression_velocity: 'fast',
        ownership_depth: 'service',
        system_scale_exposure: ['high'],
        greenfield_ratio: 0.3,
      },
      situationSignature: {
        primary_challenge_types: ['scaling', 'architecture'],
        architecture_exposure: ['microservices'],
        test_culture_exposure: 'strong',
        review_culture: 'collaborative',
        impact_signals: ['mentorship', 'tech-lead'],
      },
      profileVersion: 'discovery-v1',
      modelUsed: 'gemma-4-26b',
      rawText: '',
    };

    const matchData = {
      score: 87,
      dimensions: {
        skillCoverage: 85,
        semanticSimilarity: 90,
        situationFit: 80,
        roleAlignment: 88,
      },
      reasoning: {
        matches: ['Strong TypeScript', 'Microservices experience'],
        mismatches: ['No Kubernetes'],
      },
      philosophy: 'hybrid',
      repoName: 'org/repo',
      repoUrl: 'https://github.com/org/repo',
    };

    const calendar: ContributionCalendar = {
      totalContributions: 1247,
      weeks: [
        {
          contributionDays: [
            { date: '2025-04-01', count: 5 },
            { date: '2025-04-02', count: 0 },
          ],
        },
      ],
    };

    const sections = buildProfileSections(decomposition, discovery, matchData, calendar);

    const types = sections.map((s) => s.type);
    expect(types).toContain('hero');
    expect(types).toContain('narrative');
    expect(types).toContain('github-activity');
    expect(types).toContain('experience-timeline');
    expect(types).toContain('project-showcase');
    expect(types).toContain('skill-landscape');
    expect(types).toContain('career-arc');
    expect(types).toContain('education');
    expect(types).toContain('situation-signature');
    expect(types).toContain('career-context');
    expect(types).toContain('match-score');
    expect(types).toContain('enrichment-status');

    const hero = sections.find((s) => s.type === 'hero');
    expect(hero!.props.name).toBe('Alice Smith');
    expect(hero!.props.seniority).toBe('senior');

    const matchSection = sections.find((s) => s.type === 'match-score');
    expect(matchSection!.props.score).toBe(87);

    const githubSection = sections.find((s) => s.type === 'github-activity');
    expect(githubSection!.props.calendar.totalContributions).toBe(1247);
  });

  it('skips experience timeline with fewer than 2 experiences', () => {
    const decomposition: DecompositionResult = {
      experiences: [
        { company: 'Acme', role: 'Engineer', duration_months: 24, confidence: 0.9 },
      ],
      projects: [],
      skills: [],
      education: [],
      credentials: [],
      career_arc: { narrative: '', growth_velocity: 'normal', transitions: [], confidence: 0.5 },
    };

    const sections = buildProfileSections(decomposition, null, null, null);
    const types = sections.map((s) => s.type);
    expect(types).not.toContain('experience-timeline');
    expect(types).toContain('hero');
  });

  it('skips github-activity when calendar has zero contributions', () => {
    const calendar: ContributionCalendar = {
      totalContributions: 0,
      weeks: [],
    };

    const sections = buildProfileSections(null, null, null, calendar);
    const types = sections.map((s) => s.type);
    expect(types).not.toContain('github-activity');
  });
});
