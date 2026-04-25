/**
 * Candidate Discovery rich-agent v2 unit tests.
 *
 * Exercises the extended `discoverCandidateProfile` path that returns
 * `career_context` and `situation_signature` alongside the legacy
 * `candidate_searchable_profile` + `key_concepts`.
 *
 * Uses the same stub provider pattern as agent.test.ts.
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

describe('discoverCandidateProfile rich-agent v2', () => {
  it('returns career_context and situation_signature alongside legacy fields', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['TypeScript', 'React', 'Next.js', 'PostgreSQL'],
        niceToHaveSkills: ['Rust', 'GraphQL'],
        seniority: 'mid',
        primary_language: 'typescript',
        detected_domain: 'fintech',
      },
      career_context: {
        company_stages: ['early-stage', 'series-b'],
        team_topologies: ['stream-aligned', 'platform-adjacent'],
        primary_challenge_types: ['zero-to-one', 'scale-out'],
        growth_trajectory: 'broadening_into_backend',
      },
      situation_signature: {
        primary_challenge_types: ['zero-to-one', 'scale-out'],
        complexity_tolerance_band: 'moderate',
        review_culture_preference: 'rigorous',
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

    expect(result.careerContext).toBeDefined();
    expect(result.situationSignature).toBeDefined();
    expect(result.candidateSearchableProfile).toBe(PROFILE_400);
    expect(result.keyConcepts.seniority).toBe('mid');
  });

  it('ensures career_context.company_stages is an array of strings', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['Go'],
        niceToHaveSkills: [],
        seniority: 'senior',
        primary_language: 'go',
        detected_domain: 'infrastructure',
      },
      career_context: {
        company_stages: ['enterprise', 'late-stage'],
        team_topologies: ['platform'],
        primary_challenge_types: ['maintenance', 'modernization'],
        growth_trajectory: 'deepening_specialist',
      },
      situation_signature: {
        primary_challenge_types: ['maintenance'],
        complexity_tolerance_band: 'high',
        review_culture_preference: 'lightweight',
      },
    });

    const result = await discoverCandidateProfile({
      provider,
      parsed: { skills: ['Go'] },
    });

    expect(Array.isArray(result.careerContext?.company_stages)).toBe(true);
    expect(result.careerContext?.company_stages.every((s: unknown) => typeof s === 'string')).toBe(true);
  });

  it('ensures situation_signature.primary_challenge_types is an array', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['Python'],
        niceToHaveSkills: [],
        seniority: 'junior',
        primary_language: 'python',
        detected_domain: 'general',
      },
      career_context: {
        company_stages: ['seed'],
        team_topologies: ['stream-aligned'],
        primary_challenge_types: ['greenfield'],
        growth_trajectory: 'rapid_learner',
      },
      situation_signature: {
        primary_challenge_types: ['greenfield', 'prototype'],
        complexity_tolerance_band: 'low',
        review_culture_preference: 'async',
      },
    });

    const result = await discoverCandidateProfile({
      provider,
      parsed: { skills: ['Python'] },
    });

    expect(Array.isArray(result.situationSignature?.primary_challenge_types)).toBe(true);
    expect(result.situationSignature?.primary_challenge_types.length).toBeGreaterThan(0);
  });

  it('falls back gracefully when model returns invalid JSON for rich fields', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['TypeScript'],
        niceToHaveSkills: [],
        seniority: 'mid',
        primary_language: 'typescript',
        detected_domain: 'general',
      },
      career_context: 'not-an-object', // malformed
      situation_signature: null, // malformed
    });

    // Should not throw; rich fields should be defaulted or null.
    const result = await discoverCandidateProfile({
      provider,
      parsed: { skills: ['TypeScript'] },
    });

    expect(result.candidateSearchableProfile).toBe(PROFILE_400);
    expect(result.careerContext.tenure_pattern).toBe('unknown');
    expect(result.situationSignature.test_culture_exposure).toBe('unknown');
  });

  it('falls back gracefully when rich fields are missing entirely', async () => {
    const provider = makeStubProvider({
      candidate_searchable_profile: PROFILE_400,
      key_concepts: {
        mustHaveSkills: ['Rust'],
        niceToHaveSkills: [],
        seniority: 'senior',
        primary_language: 'rust',
        detected_domain: 'systems',
      },
      // career_context and situation_signature omitted
    });

    const result = await discoverCandidateProfile({
      provider,
      parsed: { skills: ['Rust'] },
    });

    expect(result.candidateSearchableProfile).toBe(PROFILE_400);
    expect(result.careerContext.tenure_pattern).toBe('unknown');
    expect(result.situationSignature.test_culture_exposure).toBe('unknown');
  });
});
