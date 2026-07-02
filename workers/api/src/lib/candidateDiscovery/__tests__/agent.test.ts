/**
 * Candidate Discovery agent unit tests.
 *
 * Exercises the parse + normalize path with a stub LLMProvider. No network
 * calls — the stub returns canned JSON shaped like Gemma 4's expected output.
 */

import { describe, it, expect } from 'vitest';
import { buildSourceBackedCandidateDiscoveryFallback, discoverCandidateProfile } from '../agent';
import type { LLMProvider } from '../../llm/types';

function makeStubProvider(response: unknown, name = 'stub-gemma'): LLMProvider {
  return {
    name,
    model: name,
    supportsTools: false,
    async complete() {
      return { content: typeof response === 'string' ? response : JSON.stringify(response) };
    },
  };
}

function makeModelKeyProvider(response: unknown, modelKey: string): LLMProvider & { getModelKey(): string } {
  return {
    name: 'cloudflare-ai',
    model: '@cf/meta/llama-3.1-8b-instruct',
    supportsTools: false,
    async complete() {
      return { content: typeof response === 'string' ? response : JSON.stringify(response) };
    },
    getModelKey() {
      return modelKey;
    },
  };
}

const PROFILE_400 =
  'Jane is a mid-career full-stack engineer with a strong product orientation and a decade of shipping consumer-facing React applications at early-stage startups. ' +
  'Her recent work focuses on TypeScript monorepos, with particular depth in Next.js, tRPC, and PostgreSQL-backed services. ' +
  'She has contributed to high-scale subscription flows at a fintech employer and to several internal tools at a developer-tools startup. ' +
  'Notable strengths include clean component abstractions, TypeScript-first API design, and comfort owning features end-to-end. ' +
  'She is less experienced with platform engineering or deep infrastructure — her resume shows no Kubernetes or custom operator work. ' +
  'She has recently begun contributing to backend Rust services and lists this as a growth area rather than a primary competency. ' +
  'She favors pragmatic, well-tested codebases and has mentored junior engineers on testing discipline. Her domain lean is consumer SaaS and fintech.';

describe('discoverCandidateProfile', () => {
  it('parses a well-formed Gemma response into structured result', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['TypeScript', 'React', 'Next.js', 'PostgreSQL'],
        niceToHaveSkills: ['Rust', 'GraphQL'],
        seniority: 'mid',
        primary_language: 'typescript',
        detected_domain: 'fintech',
      },
    });

    const result = await discoverCandidateProfile({
      provider,
      parsed: {
        skills: ['TypeScript', 'React'],
        yearsOfExperience: 5,
        currentRole: 'Senior Frontend Engineer',
      },
      resumeText: 'Full resume body here...',
    });

    expect(result.candidateSearchableProfile).toBe(PROFILE_400);
    expect(result.keyConcepts.mustHaveSkills).toEqual(['typescript', 'react', 'next.js', 'postgresql']);
    expect(result.keyConcepts.seniority).toBe('mid');
    expect(result.keyConcepts.primary_language).toBe('typescript');
    expect(result.profileVersion).toBe('candidate-v3');
    expect(result.modelUsed).toBe('stub-gemma');
  });

  it('records the exact provider model key when the provider exposes one', async () => {
    const provider = makeModelKeyProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['TypeScript', 'Cloudflare Workers'],
        niceToHaveSkills: ['Vitest'],
        seniority: 'senior',
        primary_language: 'typescript',
        detected_domain: 'developer-tools',
      },
    }, 'workers-ai/@cf/google/gemma-4-26b-a4b-it');

    const result = await discoverCandidateProfile({
      provider,
      parsed: {
        skills: ['TypeScript', 'Cloudflare Workers'],
        yearsOfExperience: 8,
      },
      resumeText: 'Full resume body here...',
    });

    expect(result.modelUsed).toBe('workers-ai/@cf/google/gemma-4-26b-a4b-it');
  });

  it('strips markdown code fences around the JSON response', async () => {
    const provider = makeStubProvider(
      '```json\n' +
        JSON.stringify({
          candidate_searchable_profile: PROFILE_400,
          key_concepts: {
            mustHaveSkills: ['go'],
            niceToHaveSkills: [],
            seniority: 'senior',
            primary_language: 'go',
            detected_domain: 'infrastructure',
          },
        }) +
        '\n```',
    );

    const result = await discoverCandidateProfile({
      provider,
      parsed: { skills: ['Go'] },
    });

    expect(result.keyConcepts.primary_language).toBe('go');
  });

  it('extracts a balanced JSON object from provider preamble without accepting plain prose', async () => {
    const provider = makeStubProvider(
      'Here is the JSON object you requested:\n' +
        JSON.stringify({
          candidate_searchable_profile: `${PROFILE_400} They also mention JSON-shaped snippets like {"not":"outer"} inside the narrative without breaking parsing.`,
          key_concepts: {
            mustHaveSkills: ['Cloudflare Workers', 'TypeScript'],
            niceToHaveSkills: ['Vitest'],
            seniority: null,
            primary_language: 'typescript',
            detected_domain: 'developer-tools',
          },
        }) +
        '\nDone.',
    );

    const result = await discoverCandidateProfile({
      provider,
      parsed: { skills: ['TypeScript', 'Cloudflare Workers'] },
    });

    expect(result.keyConcepts.mustHaveSkills).toEqual(['cloudflare workers', 'typescript']);
    expect(result.keyConcepts.primary_language).toBe('typescript');
  });

  it('rejects array-shaped provider output instead of accepting an inner object', async () => {
    const provider = makeStubProvider([
      {
        candidate_searchable_profile: PROFILE_400,
        key_concepts: {
          mustHaveSkills: ['go'],
          niceToHaveSkills: [],
          seniority: 'senior',
          primary_language: 'go',
          detected_domain: 'infrastructure',
        },
      },
    ]);

    await expect(
      discoverCandidateProfile({ provider, parsed: { skills: ['Go'] } }),
    ).rejects.toThrow(/JSON object/i);
  });

  it('throws if the profile is shorter than MIN_PROFILE_CHARS', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: 'too short',
      key_concepts: { mustHaveSkills: [], niceToHaveSkills: [], seniority: 'junior', primary_language: 'go', detected_domain: 'general' },
    });

    await expect(
      discoverCandidateProfile({ provider, parsed: { skills: [] } }),
    ).rejects.toThrow(/profile too short/i);
  });

  it('does not fabricate seniority when model output is unsupported', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['go'],
        niceToHaveSkills: [],
        seniority: 'wizard', // invalid band
        primary_language: 'go',
        detected_domain: 'general',
      },
    });

    const result = await discoverCandidateProfile({
      provider,
      parsed: { skills: ['Go'], yearsOfExperience: 12 },
    });

    expect(result.keyConcepts.seniority).toBeNull();
  });

  it('does not fabricate a greenfield ratio when model output is unsupported', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['go'],
        niceToHaveSkills: [],
        seniority: 'senior',
        primary_language: 'go',
        detected_domain: 'infrastructure',
      },
      career_context: {
        company_stages: ['growth'],
        company_size_exposure: ['200-1000'],
        tenure_pattern: 'stable',
        progression_velocity: 'normal',
        ownership_depth: 'service',
        system_scale_exposure: ['distributed-systems'],
        greenfield_ratio: 'unclear',
      },
    });

    const result = await discoverCandidateProfile({
      provider,
      parsed: { skills: ['Go'] },
    });

    expect(result.careerContext.greenfield_ratio).toBeNull();
  });

  it('preserves a source-backed greenfield ratio when the model provides a valid number', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['go'],
        niceToHaveSkills: [],
        seniority: 'senior',
        primary_language: 'go',
        detected_domain: 'infrastructure',
      },
      career_context: {
        company_stages: ['growth'],
        company_size_exposure: ['200-1000'],
        tenure_pattern: 'stable',
        progression_velocity: 'normal',
        ownership_depth: 'service',
        system_scale_exposure: ['distributed-systems'],
        greenfield_ratio: 0.75,
      },
    });

    const result = await discoverCandidateProfile({
      provider,
      parsed: { skills: ['Go'] },
    });

    expect(result.careerContext.greenfield_ratio).toBe(0.75);
  });

  it('dedupes and normalizes skill arrays', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['React', 'react', 'REACT', 'typescript', 'typescript'],
        niceToHaveSkills: [],
        seniority: 'mid',
        primary_language: 'typescript',
        detected_domain: 'general',
      },
    });

    const result = await discoverCandidateProfile({ provider, parsed: { skills: [] } });

    expect(result.keyConcepts.mustHaveSkills).toEqual(['react', 'typescript']);
  });

  it('throws when the model returns non-JSON content', async () => {
    const provider = makeStubProvider('I am a helpful AI assistant and I cannot comply with that request.');

    await expect(
      discoverCandidateProfile({ provider, parsed: { skills: [] } }),
    ).rejects.toThrow(/JSON object/i);
  });

  it('throws when the model returns an empty response', async () => {
    const provider: LLMProvider = {
      name: 'empty',
      supportsTools: false,
      async complete() {
        return { content: null };
      },
    };

    await expect(
      discoverCandidateProfile({ provider, parsed: { skills: [] } }),
    ).rejects.toThrow(/empty content/i);
  });

  it('builds a clearly labelled source-backed fallback profile without model claims', () => {
    const result = buildSourceBackedCandidateDiscoveryFallback({
      reason: 'Candidate Discovery AI failed: empty response',
      parsed: {
        name: 'Avery Candidate',
        skills: ['TypeScript', 'React'],
        currentRole: 'Frontend Engineer',
        experiences: [
          {
            company: 'Acme',
            role: 'Frontend Engineer',
            description: 'Implemented React accessibility fixes with regression tests.',
          },
        ],
        educationBlocks: [],
        credentials: [],
        projects: [
          {
            name: 'Open Review',
            description: 'Reviewed routing bugs and wrote Vitest coverage.',
          },
        ],
      },
      resumeText:
        'Avery Candidate implemented React accessibility fixes, reviewed routing bugs, and wrote Vitest regression coverage for an open source frontend project.',
    });

    expect(result.modelUsed).toBe('source-backed-fallback');
    expect(result.profileVersion).toContain('source-backed-fallback');
    expect(result.candidateSearchableProfile).toContain('Source-backed candidate profile fallback');
    expect(result.candidateSearchableProfile).toContain('Implemented React accessibility fixes');
    expect(result.keyConcepts.seniority).toBeNull();
    expect(result.keyConcepts.mustHaveSkills).toContain('typescript');
  });
});
