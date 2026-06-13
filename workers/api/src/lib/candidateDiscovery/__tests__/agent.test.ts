/**
 * Candidate Discovery agent unit tests.
 *
 * Exercises the parse + normalize path with a stub LLMProvider. No network
 * calls — the stub returns canned JSON shaped like Gemma 4's expected output.
 */

import { describe, it, expect } from 'vitest';
import { discoverCandidateProfile } from '../agent';
import type { LLMProvider } from '../../llm/types';

function makeStubProvider(response: unknown, name = 'stub-gemma'): LLMProvider {
  return {
    name,
    supportsTools: false,
    async complete() {
      return { content: typeof response === 'string' ? response : JSON.stringify(response) };
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
});
