import { describe, expect, it } from 'vitest';

import { resolveCodeReviewMatchHealthDatabaseId } from './auditCodeReviewMatchHealth';

describe('CODE_REVIEW match-health CLI database resolution', () => {
  it('prefers an explicit database id over environment values', () => {
    expect(resolveCodeReviewMatchHealthDatabaseId(
      { databaseId: 'explicit-db' },
      {
        MATCHING_EVALUATION_D1_DATABASE_ID: 'matching-db',
        CLOUDFLARE_D1_DATABASE_ID: 'generic-db',
      },
    )).toBe('explicit-db');
  });

  it('prefers the matching evaluation D1 database over the generic Cloudflare D1 database', () => {
    expect(resolveCodeReviewMatchHealthDatabaseId(
      {},
      {
        MATCHING_EVALUATION_D1_DATABASE_ID: 'matching-db',
        CLOUDFLARE_D1_DATABASE_ID: 'generic-db',
      },
    )).toBe('matching-db');
  });

  it('falls back to the generic Cloudflare D1 database when no matching database is configured', () => {
    expect(resolveCodeReviewMatchHealthDatabaseId(
      {},
      {
        CLOUDFLARE_D1_DATABASE_ID: 'generic-db',
      },
    )).toBe('generic-db');
  });
});
