import { describe, expect, it } from 'vitest';
import {
  normalizeOpenTermSurface,
  openSemanticTerm,
} from '../openTerms';

describe('open semantic terms', () => {
  it('splits CamelCase boundaries for open semantic keys', () => {
    expect(openSemanticTerm('TypeScript')?.canonicalKey).toBe('term:type-script');
    expect(openSemanticTerm('typescript')?.canonicalKey).toBe('term:typescript');
    expect(openSemanticTerm('GraphQL')?.canonicalKey).toBe('term:graph-ql');
    expect(openSemanticTerm('graphql')?.canonicalKey).toBe('term:graphql');
    expect(openSemanticTerm('PostgreSQL')?.canonicalKey).toBe('term:postgre-sql');
  });

  it('preserves exact surfaces while keeping unseen terms open-ended', () => {
    expect(openSemanticTerm('SomeNewTechnology')).toEqual({
      surface: 'SomeNewTechnology',
      canonicalKey: 'term:some-new-technology',
    });
    expect(normalizeOpenTermSurface('Bio-Digital Scheduler v7'))
      .toBe('bio digital scheduler v7');
  });
});
