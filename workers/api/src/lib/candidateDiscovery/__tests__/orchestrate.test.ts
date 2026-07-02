import { describe, expect, it } from 'vitest';

import type { LLMProvider } from '../../llm/types';
import {
  discoverCandidateProfileWithProviderFallbacks,
  type CandidateDiscoveryAttemptEvent,
} from '../orchestrate';

const PROFILE_400 =
  'Avery is a product-minded TypeScript engineer who has worked across frontend systems, API integrations, and source-backed regression testing in collaborative application codebases. ' +
  'Their resume evidence points to hands-on implementation with React, Node.js, Cloudflare Workers, and test automation, with repeated attention to accessibility, review quality, and maintainable component boundaries. ' +
  'They have handled ambiguous bugs by tracing behavior from user-facing symptoms through code paths, adding focused tests, and keeping implementation changes small enough for reviewers to reason about. ' +
  'The strongest source-backed signal is practical end-to-end ownership in web application work rather than deep infrastructure ownership. ' +
  'The evidence does not prove senior platform scope, distributed systems operations, or formal staff-level technical leadership, so those claims should remain unmade. ' +
  'Structured depth: key_concepts include TypeScript, React, Cloudflare Workers, and test automation; career_context includes product engineering and collaborative review environments; situation_signature includes debugging, refactoring, accessibility, and source-backed regression testing.';

function provider(name: string, content: string): LLMProvider {
  return {
    name,
    model: name,
    supportsTools: false,
    async complete() {
      return { content };
    },
  };
}

describe('discoverCandidateProfileWithProviderFallbacks', () => {
  it('tries a later real provider when the first model misses the JSON contract', async () => {
    const events: CandidateDiscoveryAttemptEvent[] = [];
    const result = await discoverCandidateProfileWithProviderFallbacks({
      providers: [
        provider('bad-json-model', 'I can summarize this candidate, but not as JSON.'),
        provider('working-json-model', JSON.stringify({
          candidate_searchable_profile: PROFILE_400,
          key_concepts: {
            mustHaveSkills: ['TypeScript', 'React', 'Cloudflare Workers'],
            niceToHaveSkills: ['Vitest'],
            seniority: null,
            primary_language: 'typescript',
            detected_domain: 'developer-tools',
          },
          career_context: {
            company_stages: ['unknown'],
            company_size_exposure: ['unknown'],
            tenure_pattern: 'unknown',
            progression_velocity: 'unknown',
            ownership_depth: 'service',
            system_scale_exposure: ['serverless'],
            greenfield_ratio: null,
          },
          situation_signature: {
            primary_challenge_types: ['debugging', 'refactoring'],
            architecture_exposure: ['serverless'],
            test_culture_exposure: 'Source-backed regression testing is present.',
            review_culture: 'Collaborative code review evidence is present.',
            impact_signals: [],
          },
        })),
      ],
      parsed: { skills: ['TypeScript', 'React'] },
      resumeText: 'Built React and Cloudflare Workers features with Vitest regression tests.',
      timeoutMs: 1000,
      maxAttempts: 2,
      onAttempt: (event) => {
        events.push(event);
      },
    });

    expect(result.modelUsed).toBe('working-json-model');
    expect(result.keyConcepts.mustHaveSkills).toEqual(['typescript', 'react', 'cloudflare workers']);
    expect(events.map((event) => `${event.attempt}:${event.status}:${event.model}`)).toEqual([
      '1:started:bad-json-model/bad-json-model',
      '1:failed:bad-json-model/bad-json-model',
      '2:started:working-json-model/working-json-model',
      '2:succeeded:working-json-model',
    ]);
  });

  it('stops after an application timeout instead of starting overlapping Workers AI calls', async () => {
    let secondProviderCalled = false;
    const events: CandidateDiscoveryAttemptEvent[] = [];
    const neverReturns: LLMProvider = {
      name: 'slow-model',
      model: 'slow-model',
      supportsTools: false,
      async complete() {
        return new Promise<never>(() => undefined);
      },
    };
    const secondProvider: LLMProvider = {
      name: 'second-model',
      model: 'second-model',
      supportsTools: false,
      async complete() {
        secondProviderCalled = true;
        return { content: '{}' };
      },
    };

    await expect(discoverCandidateProfileWithProviderFallbacks({
      providers: [neverReturns, secondProvider],
      parsed: { skills: ['TypeScript'] },
      resumeText: 'Built TypeScript systems.',
      timeoutMs: 5,
      maxAttempts: 2,
      onAttempt: (event) => {
        events.push(event);
      },
    })).rejects.toThrow(/failed after 1 attempt/i);

    expect(secondProviderCalled).toBe(false);
    expect(events.map((event) => `${event.attempt}:${event.status}:${event.model}`)).toEqual([
      '1:started:slow-model/slow-model',
      '1:failed:slow-model/slow-model',
    ]);
  });
});
