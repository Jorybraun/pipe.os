/**
 * Pass 3 — content hash.
 *
 * Deterministic SHA-256 over the inputs that determine a summary. Re-running
 * Pass 3 on a repo whose inputs haven't changed is a hash lookup, not a
 * Devstral call — this is the cost guardrail for the offline batch.
 *
 * Includes `signals_version` in the digest so a prompt version bump
 * invalidates every cached hash. Orders constructs + PRs canonically so
 * reshuffling by a re-run of Pass 2 doesn't falsely invalidate the cache.
 */

import { createHash } from 'node:crypto';

import type { Pass3Input } from './types.js';

export function computeContentHash(input: Pass3Input, signalsVersion: string): string {
  const sortedConstructs = [...input.constructs]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((c) => ({ slug: c.slug, count: c.evidence_count }));

  const sortedPrs = [...input.sample_prs]
    .sort((a, b) => a.pr_number - b.pr_number)
    .map((pr) => ({
      pr_number: pr.pr_number,
      changed_file_count: pr.changed_file_count,
      modifies_tests: pr.modifies_tests,
      construct_slugs_json: pr.construct_slugs_json,
      swe_bench_eligible: pr.swe_bench_eligible,
    }));

  const canonical = JSON.stringify({
    signals_version: signalsVersion,
    full_name: input.full_name,
    primary_language: input.primary_language,
    sloc: input.sloc,
    file_count: input.file_count,
    mean_ccn: input.mean_ccn,
    has_ci: input.has_ci,
    has_tests: input.has_tests,
    test_framework: input.test_framework,
    seniority_band: input.seniority_band,
    detected_domain: input.detected_domain,
    detected_stack_json: input.detected_stack_json,
    pr_quality_score: input.pr_quality_score,
    constructs: sortedConstructs,
    sample_prs: sortedPrs,
  });

  return createHash('sha256').update(canonical).digest('hex');
}

// ─── CLI entry ───────────────────────────────────────────────────────────────
// Reads `{ input: Pass3Input, signals_version: string }` on stdin, writes
// `{ content_hash, prior_content_hash, is_cache_hit }` on stdout.

async function readStdin(): Promise<string> {
  let buf = '';
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const payload = JSON.parse(raw) as { input: Pass3Input; signals_version: string };
  const contentHash = computeContentHash(payload.input, payload.signals_version);
  const priorHash = payload.input.prior_content_hash;
  const priorVersion = payload.input.prior_signals_version;
  const isCacheHit =
    priorHash === contentHash && priorVersion === payload.signals_version;

  process.stdout.write(
    JSON.stringify({
      content_hash: contentHash,
      prior_content_hash: priorHash,
      prior_signals_version: priorVersion,
      is_cache_hit: isCacheHit,
    }) + '\n',
  );
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error('[pass3/hash] failed:', err);
    process.exit(1);
  });
}
