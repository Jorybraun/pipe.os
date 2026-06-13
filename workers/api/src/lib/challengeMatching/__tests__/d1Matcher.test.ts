import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveCorpusGenericConcepts,
  matchCandidateToReviewChallenge,
} from '../d1Matcher';
import type { ChallengePacket } from '../types';

interface SqliteStatement {
  run(...bindings: unknown[]): { changes: number | bigint };
  get(...bindings: unknown[]): unknown;
  all(...bindings: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};
const livingMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const matchingMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);

function d1(sqlite: SqliteDatabase): D1Database {
  return {
    prepare(query: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async run() {
          const result = sqlite.prepare(query).run(...bindings);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...bindings) as T | undefined) ?? null;
        },
        async all<T>() {
          return { success: true, results: sqlite.prepare(query).all(...bindings) as T[], meta: {} };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe('matchCandidateToReviewChallenge', () => {
  let sqlite: SqliteDatabase;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (id TEXT PRIMARY KEY);
      CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);
      INSERT INTO candidates (id) VALUES ('candidate-1');
    `);
    sqlite.exec(livingMigration);
    sqlite.exec(matchingMigration);
  });

  afterEach(() => sqlite.close());

  it('records NEEDS_MORE_EVIDENCE instead of selecting a generic fallback PR', async () => {
    const result = await matchCandidateToReviewChallenge(d1(sqlite), 'candidate-1');

    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.repoId).toBeUndefined();
    expect(sqlite.prepare(
      'SELECT status, selected_packet_id FROM match_runs WHERE id = ?',
    ).get(result.matchRunId)).toEqual({
      status: 'NEEDS_MORE_EVIDENCE',
      selected_packet_id: null,
    });
  });
});

describe('deriveCorpusGenericConcepts', () => {
  it('derives genericity from packet prevalence without a semantic vocabulary', () => {
    const packets = Array.from({ length: 5 }, (_, index) => ({
      id: `packet-${index}`,
      repoId: `repo-${index}`,
      prNumber: index,
      sourceVersion: `version-${index}`,
      challengeReady: true,
      languages: [],
      seniority: 'senior',
      concepts: [
        'term:shared-runtime-concept',
        ...(index === 0 ? ['term:never-before-seen-specific-concept'] : []),
      ],
      demands: [],
      quality: { deterministic: 1, contextualSpecificity: 1 },
    })) satisfies ChallengePacket[];

    expect(deriveCorpusGenericConcepts(packets)).toEqual([
      'term:shared-runtime-concept',
    ]);
  });

  it('derives genericity from packet prevalence without a semantic vocabulary (empty seniority)', () => {
    const packets = Array.from({ length: 5 }, (_, index) => ({
      id: `packet-${index}`,
      repoId: `repo-${index}`,
      prNumber: index,
      sourceVersion: `version-${index}`,
      challengeReady: true,
      languages: [],
      concepts: [
        'term:shared-runtime-concept',
        ...(index === 0 ? ['term:never-before-seen-specific-concept'] : []),
      ],
      demands: [],
      quality: { deterministic: 1, contextualSpecificity: 1 },
    })) satisfies ChallengePacket[];

    expect(deriveCorpusGenericConcepts(packets)).toEqual([
      'term:shared-runtime-concept',
    ]);
  });
});
