import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { slugifySkills } from '../slugifySkills';

function aliasDb(rows: Array<{ alias: string; canonical_slug: string }>): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return {
            all: async () => ({ results: rows, success: true, meta: {} }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('slugifySkills', () => {
  it('preserves unseen concepts with the same open normalization as the crawler', async () => {
    await expect(
      slugifySkills(aliasDb([]), ['@Novel/Runtime Kit', 'Kafka Streams']),
    ).resolves.toEqual(['novel-runtime-kit', 'kafka-streams']);
  });

  it('uses a persisted alias when evidence has resolved one', async () => {
    await expect(
      slugifySkills(aliasDb([
        { alias: 'observed surface', canonical_slug: 'resolved-concept' },
      ]), ['Observed Surface']),
    ).resolves.toEqual(['resolved-concept']);
  });
});
