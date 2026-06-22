import { describe, expect, it } from 'vitest';
import {
  backfillRepos,
  LEGACY_REPO_BACKFILL_DISABLED,
} from './backfillNeo4j';

describe('backfillNeo4j legacy repo path', () => {
  it('fails closed instead of projecting legacy repo_nodes into Neo4j', async () => {
    const db = {
      prepare() {
        throw new Error('repo_nodes should not be queried');
      },
    };

    await expect(backfillRepos(db)).rejects.toThrow(LEGACY_REPO_BACKFILL_DISABLED);
  });
});
