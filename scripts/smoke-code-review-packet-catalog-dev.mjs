#!/usr/bin/env node

import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_THRESHOLDS = {
  minProductionReadyPackets: 3,
  minProductionReadyRepos: 3,
  minProductionReadyPullRequests: 3,
  minReviewProfileReadyPackets: 2,
};

function valueFor(argv, flag) {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseOptions(argv = process.argv.slice(2), env = process.env) {
  return {
    databaseId: valueFor(argv, '--database-id')
      || env.CODE_REVIEW_RELIABILITY_D1_DATABASE_ID
      || env.MATCHING_EVALUATION_D1_DATABASE_ID
      || env.CLOUDFLARE_D1_DATABASE_ID
      || '',
    requirePass: hasFlag(argv, '--require-pass'),
    thresholds: {
      minProductionReadyPackets: positiveInteger(
        valueFor(argv, '--min-production-ready-packets'),
        DEFAULT_THRESHOLDS.minProductionReadyPackets,
      ),
      minProductionReadyRepos: positiveInteger(
        valueFor(argv, '--min-production-ready-repos'),
        DEFAULT_THRESHOLDS.minProductionReadyRepos,
      ),
      minProductionReadyPullRequests: positiveInteger(
        valueFor(argv, '--min-production-ready-prs'),
        DEFAULT_THRESHOLDS.minProductionReadyPullRequests,
      ),
      minReviewProfileReadyPackets: positiveInteger(
        valueFor(argv, '--min-review-profile-ready-packets'),
        DEFAULT_THRESHOLDS.minReviewProfileReadyPackets,
      ),
    },
  };
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function d1Query({ sql, databaseId, env = process.env, fetchImpl = fetch }) {
  const accountId = requiredEnv(env, 'CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv(env, 'CLOUDFLARE_API_TOKEN');
  if (!databaseId) {
    throw new Error(
      'Missing required D1 database id; pass --database-id or set CODE_REVIEW_RELIABILITY_D1_DATABASE_ID.',
    );
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`D1 returned non-JSON response (${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok || body?.success !== true) {
    const message = body?.errors?.[0]?.message ?? text.slice(0, 200);
    throw new Error(`D1 query failed (${response.status}): ${message}`);
  }

  const result = Array.isArray(body.result) ? body.result[0] : null;
  if (result?.success !== true) {
    throw new Error(`D1 statement failed: ${JSON.stringify(result ?? body).slice(0, 300)}`);
  }
  return Array.isArray(result.results) ? result.results : [];
}

export async function fetchPacketCatalog({ databaseId, env = process.env, fetchImpl = fetch }) {
  const metricsRows = await d1Query({
    databaseId,
    env,
    fetchImpl,
    sql: `
      SELECT
        COUNT(*) AS totalPackets,
        SUM(CASE WHEN production_ready = 1 THEN 1 ELSE 0 END) AS productionReadyPackets,
        COUNT(DISTINCT CASE WHEN production_ready = 1 THEN repo_id END) AS productionReadyRepoCount,
        COUNT(DISTINCT CASE WHEN production_ready = 1 THEN repo_id || ':' || pr_number END) AS productionReadyPullRequestCount,
        SUM(
          CASE
            WHEN production_ready = 1
             AND json_extract(packet_json, '$.reviewProfile.basis.changedFileCount') IS NOT NULL
             AND json_extract(packet_json, '$.reviewProfile.expectedTimeMinutes') IS NOT NULL
            THEN 1 ELSE 0
          END
        ) AS reviewProfileReadyPackets
      FROM review_challenge_packets
    `,
  });
  const repoRows = await d1Query({
    databaseId,
    env,
    fetchImpl,
    sql: `
      SELECT
        COALESCE(qr.full_name, 'repo:' || rcp.repo_id) AS repoName,
        rcp.repo_id AS repoId,
        COUNT(*) AS productionReadyPackets,
        COUNT(DISTINCT rcp.pr_number) AS productionReadyPullRequests,
        SUM(
          CASE
            WHEN json_extract(rcp.packet_json, '$.reviewProfile.basis.changedFileCount') IS NOT NULL
             AND json_extract(rcp.packet_json, '$.reviewProfile.expectedTimeMinutes') IS NOT NULL
            THEN 1 ELSE 0
          END
        ) AS reviewProfileReadyPackets
      FROM review_challenge_packets rcp
      LEFT JOIN qualified_repos qr ON qr.id = rcp.repo_id
      WHERE rcp.production_ready = 1
      GROUP BY rcp.repo_id, qr.full_name
      ORDER BY productionReadyPackets DESC, repoName ASC
    `,
  });

  return {
    metrics: metricsRows[0] ?? {},
    repos: repoRows,
  };
}

function numberValue(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function summarizePacketCatalog(catalog, {
  databaseId,
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  const metrics = {
    totalPackets: numberValue(catalog.metrics.totalPackets),
    productionReadyPackets: numberValue(catalog.metrics.productionReadyPackets),
    productionReadyRepoCount: numberValue(catalog.metrics.productionReadyRepoCount),
    productionReadyPullRequestCount: numberValue(catalog.metrics.productionReadyPullRequestCount),
    reviewProfileReadyPackets: numberValue(catalog.metrics.reviewProfileReadyPackets),
  };
  const repos = Array.isArray(catalog.repos)
    ? catalog.repos.map((repo) => ({
        repoName: String(repo.repoName ?? ''),
        repoId: numberValue(repo.repoId),
        productionReadyPackets: numberValue(repo.productionReadyPackets),
        productionReadyPullRequests: numberValue(repo.productionReadyPullRequests),
        reviewProfileReadyPackets: numberValue(repo.reviewProfileReadyPackets),
      }))
    : [];
  const failures = [];
  if (metrics.productionReadyPackets < thresholds.minProductionReadyPackets) {
    failures.push(`productionReadyPackets must be >= ${thresholds.minProductionReadyPackets}; got ${metrics.productionReadyPackets}`);
  }
  if (metrics.productionReadyRepoCount < thresholds.minProductionReadyRepos) {
    failures.push(`productionReadyRepoCount must be >= ${thresholds.minProductionReadyRepos}; got ${metrics.productionReadyRepoCount}`);
  }
  if (metrics.productionReadyPullRequestCount < thresholds.minProductionReadyPullRequests) {
    failures.push(`productionReadyPullRequestCount must be >= ${thresholds.minProductionReadyPullRequests}; got ${metrics.productionReadyPullRequestCount}`);
  }
  if (metrics.reviewProfileReadyPackets < thresholds.minReviewProfileReadyPackets) {
    failures.push(`reviewProfileReadyPackets must be >= ${thresholds.minReviewProfileReadyPackets}; got ${metrics.reviewProfileReadyPackets}`);
  }

  return {
    ok: failures.length === 0,
    databaseId: databaseId ?? null,
    thresholds,
    metrics,
    repos,
    failures,
  };
}

async function main() {
  dotenv.config({ path: '.env.local', quiet: true });
  dotenv.config({ path: '.env', quiet: true });

  const options = parseOptions();
  const catalog = await fetchPacketCatalog({ databaseId: options.databaseId });
  const summary = summarizePacketCatalog(catalog, {
    databaseId: options.databaseId,
    thresholds: options.thresholds,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (options.requirePass && !summary.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
