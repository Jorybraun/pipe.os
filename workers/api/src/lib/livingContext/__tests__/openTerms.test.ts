import { describe, expect, it } from 'vitest';
import {
  normalizeOpenTermSurface,
  openSemanticTerm,
} from '../openTerms';

describe('open semantic terms', () => {
  it('normalizes branded casing consistently with lowercase source text', () => {
    expect(openSemanticTerm('TypeScript')?.canonicalKey).toBe('term:typescript');
    expect(openSemanticTerm('typescript')?.canonicalKey).toBe('term:typescript');
    expect(openSemanticTerm('GraphQL')?.canonicalKey).toBe('term:graphql');
    expect(openSemanticTerm('graphql')?.canonicalKey).toBe('term:graphql');
    expect(openSemanticTerm('PostgreSQL')?.canonicalKey).toBe('term:postgresql');
  });

  it('preserves exact surfaces while keeping unseen terms open-ended', () => {
    expect(openSemanticTerm('SomeNewTechnology')).toEqual({
      surface: 'SomeNewTechnology',
      canonicalKey: 'term:somenewtechnology',
    });
    expect(normalizeOpenTermSurface('Bio-Digital Scheduler v7'))
      .toBe('bio digital scheduler v7');
  });
});
