import { describe, expect, it } from 'vitest';

import {
  parseOptions,
  summarizePacketCatalog,
} from './smoke-code-review-packet-catalog-dev.mjs';

describe('CODE_REVIEW packet catalog readiness smoke', () => {
  it('resolves database id and threshold flags without falling back to production', () => {
    expect(parseOptions([
      '--database-id',
      'app-dev-d1',
      '--require-pass',
      '--min-production-ready-packets',
      '8',
      '--min-production-ready-repos=3',
      '--min-production-ready-prs',
      '8',
      '--min-review-profile-ready-packets=5',
    ], {
      CLOUDFLARE_D1_DATABASE_ID: 'production-db',
    })).toEqual({
      databaseId: 'app-dev-d1',
      requirePass: true,
      thresholds: {
        minProductionReadyPackets: 8,
        minProductionReadyRepos: 3,
        minProductionReadyPullRequests: 8,
        minReviewProfileReadyPackets: 5,
      },
    });
  });

  it('passes a catalog with enough source-backed packet breadth and review profiles', () => {
    expect(summarizePacketCatalog({
      metrics: {
        totalPackets: 10,
        productionReadyPackets: 8,
        productionReadyRepoCount: 3,
        productionReadyPullRequestCount: 8,
        reviewProfileReadyPackets: 5,
      },
      repos: [
        {
          repoName: 'mui/base-ui',
          repoId: 973,
          productionReadyPackets: 3,
          productionReadyPullRequests: 3,
          reviewProfileReadyPackets: 0,
        },
        {
          repoName: 'cloudflare/workers-sdk',
          repoId: 79,
          productionReadyPackets: 3,
          productionReadyPullRequests: 3,
          reviewProfileReadyPackets: 3,
        },
        {
          repoName: 'vercel/swr',
          repoId: 4271,
          productionReadyPackets: 2,
          productionReadyPullRequests: 2,
          reviewProfileReadyPackets: 2,
        },
      ],
    }, {
      databaseId: 'app-dev-d1',
    })).toMatchObject({
      ok: true,
      databaseId: 'app-dev-d1',
      metrics: {
        productionReadyPackets: 8,
        productionReadyRepoCount: 3,
        productionReadyPullRequestCount: 8,
        reviewProfileReadyPackets: 5,
      },
      repos: [
        { repoName: 'mui/base-ui' },
        { repoName: 'cloudflare/workers-sdk' },
        { repoName: 'vercel/swr' },
      ],
      failures: [],
    });
  });

  it('fails closed when the catalog collapses to one repo or lacks persisted review profiles', () => {
    const summary = summarizePacketCatalog({
      metrics: {
        totalPackets: 2,
        productionReadyPackets: 2,
        productionReadyRepoCount: 1,
        productionReadyPullRequestCount: 2,
        reviewProfileReadyPackets: 0,
      },
      repos: [
        {
          repoName: 'mui/base-ui',
          repoId: 973,
          productionReadyPackets: 2,
          productionReadyPullRequests: 2,
          reviewProfileReadyPackets: 0,
        },
      ],
    }, {
      databaseId: 'app-dev-d1',
    });

    expect(summary.ok).toBe(false);
    expect(summary.failures).toEqual(expect.arrayContaining([
      'productionReadyPackets must be >= 3; got 2',
      'productionReadyRepoCount must be >= 3; got 1',
      'productionReadyPullRequestCount must be >= 3; got 2',
      'reviewProfileReadyPackets must be >= 2; got 0',
    ]));
  });
});
