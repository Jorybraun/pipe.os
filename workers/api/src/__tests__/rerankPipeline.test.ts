/**
 * Rerank Pipeline tests — ADR-036 §2.3 Stage 2 cache-aware wrapper.
 *
 * Locks the three contracts this module owns:
 *   1. Cache key invariant — stale rcd_version is treated as a miss.
 *   2. Miss handling — missing offline signals row is a SKIP, not a crash.
 *   3. Write-through — fresh rerank results land in repo_role_alignment via
 *      INSERT OR REPLACE, and are observable in the returned result map.
 *
 * Uses an in-memory D1 stub that mirrors the three SQL shapes the pipeline
 * issues (SELECT FROM repo_role_alignment, SELECT FROM repo_engineering_signals,
 * INSERT OR REPLACE INTO repo_role_alignment). The stub does NOT parse SQL —
 * it matches on prefix and replays a canned backing store. This is enough
 * to exercise the cache-hit, cache-miss, and write-through paths without
 * spinning up miniflare.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

import { rerankMatchedRepos, type MatchedRepoLite } from '../lib/repoDiscovery/rerankPipeline';
import type { LLMProvider, LLMCompletion, LLMMessage } from '../lib/llm/types';
import type {
  RoleContextDocument,
  RepoEngineeringSignalsRow,
  RepoRoleAlignmentRow,
} from '../types';

// ─── RCD fixture ───────────────────────────────────────────────────────────

function buildTestRcd(overrides: Partial<RoleContextDocument> = {}): RoleContextDocument {
  return {
    rcd_version: 'rcd-v1',
    role_context_id: 'rc-test',
    pipeline_id: 'pipe-test',
    created_at: '2026-04-10T00:00:00.000Z',
    domain_matrix: {
      HIRING_MANAGER: {
        codebase: {
          primary_authority: true,
          coverage: 'deep',
          laddering_chains: [],
          open_codes: [],
          axial_links: [],
          stories: [],
          summary: 'Systems-level Rust with tight correctness budgets.',
        },
      },
    },
    conflicts: [],
    technical_context: {
      stack: ['Rust', 'WebAssembly'],
      constructs: ['systems_programming'],
      seniority_band: 'senior',
      codebase_expectations: ['monorepo'],
      dispositional_weights: { rigor: 1.3 },
    },
    team_culture_profile: { per_stakeholder: {} },
    bars_overrides: [],
    probe_bank_enrichment: { static_base_version: 'v1', enriched_probes: [] },
    dealbreakers: [],
    red_flags: [],
    consumer_slice: {} as never,
    validation_metadata: {
      schema_version: 'rcd-v1',
      synthesis_model: 'mock',
      synthesis_prompt_version: 'v1',
      verification_pass_model: 'mock',
      face_validity_reviewed_at: null,
      face_validity_reviewer: null,
    },
    ...overrides,
  };
}

function buildSignalsRow(repoId: number, signalsVersion = 'sig-v1'): RepoEngineeringSignalsRow {
  return {
    repo_id: repoId,
    signals_version: signalsVersion,
    content_hash: `hash-${repoId}`,
    test_touch_rate: 0.72,
    mean_changed_files: 3.1,
    p90_changed_files: 8,
    issue_link_rate: 0.78,
    complexity_band: 'medium',
    swe_bench_eligibility_rate: 0.31,
    architecture_style: 'modular_monolith',
    review_density: 0.85,
    commit_cadence: 4.2,
    satd_density: 0.04,
    engineering_narrative: `Repo ${repoId} engineering narrative.`,
    signal_json: '{}',
    generated_at: '2026-04-09T12:00:00.000Z',
    model_used: 'claude-haiku-4-5',
    model_version: 'haiku-4-5-20251001',
  };
}

function buildCachedAlignmentRow(
  repoId: number,
  overrides: Partial<RepoRoleAlignmentRow> = {},
): RepoRoleAlignmentRow {
  return {
    role_context_id: 'rc-test',
    repo_id: repoId,
    alignment_score: 0.8,
    alignment_band: 'strong',
    reasoning_json: JSON.stringify({
      matches: ['cached: Rust stack match'],
      mismatches: [],
      summary: 'cached summary',
    }),
    per_signal_scores: JSON.stringify({ test_touch_rate: 0.9 }),
    rcd_version: 'rcd-v1',
    signals_version: 'sig-v1',
    generated_at: '2026-04-10T00:00:00.000Z',
    model_used: '@cf/google/gemma-4-26b-a4b-it',
    ...overrides,
  };
}

// ─── D1 stub ───────────────────────────────────────────────────────────────

interface StubStore {
  alignments: RepoRoleAlignmentRow[];
  signals: RepoEngineeringSignalsRow[];
}

interface StubDb {
  db: D1Database;
  store: StubStore;
  writes: RepoRoleAlignmentRow[];
}

function buildStubDb(initial: StubStore): StubDb {
  const store: StubStore = {
    alignments: [...initial.alignments],
    signals: [...initial.signals],
  };
  const writes: RepoRoleAlignmentRow[] = [];

  const prepare = (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    return {
      bind(...args: unknown[]) {
        return {
          async first() {
            return null;
          },
          async all<T>() {
            if (normalized.startsWith('SELECT role_context_id, repo_id, alignment_score')) {
              // repo_role_alignment read
              const [roleContextId, rcdVersion, ...repoIds] = args as [string, string, ...number[]];
              const rows = store.alignments.filter(
                (a) =>
                  a.role_context_id === roleContextId &&
                  a.rcd_version === rcdVersion &&
                  repoIds.includes(a.repo_id),
              );
              return { results: rows as T[], success: true, meta: {} };
            }
            if (normalized.startsWith('SELECT repo_id, signals_version, content_hash')) {
              // repo_engineering_signals full read
              const repoIds = args as number[];
              const rows = store.signals.filter((s) => repoIds.includes(s.repo_id));
              return { results: rows as T[], success: true, meta: {} };
            }
            if (normalized.startsWith('SELECT repo_id, signals_version FROM repo_engineering_signals')) {
              // repo_engineering_signals lightweight version check
              const repoIds = args as number[];
              const rows = store.signals
                .filter((s) => repoIds.includes(s.repo_id))
                .map((s) => ({ repo_id: s.repo_id, signals_version: s.signals_version }));
              return { results: rows as T[], success: true, meta: {} };
            }
            return { results: [] as T[], success: true, meta: {} };
          },
          async run() {
            if (normalized.startsWith('INSERT OR REPLACE INTO repo_role_alignment')) {
              const [
                roleContextId,
                repoId,
                alignmentScore,
                alignmentBand,
                reasoningJson,
                perSignalScores,
                rcdVersion,
                signalsVersion,
                generatedAt,
                modelUsed,
              ] = args as [
                string, number, number, string, string, string, string, string, string, string,
              ];
              const row: RepoRoleAlignmentRow = {
                role_context_id: roleContextId,
                repo_id: repoId,
                alignment_score: alignmentScore,
                alignment_band: alignmentBand as RepoRoleAlignmentRow['alignment_band'],
                reasoning_json: reasoningJson,
                per_signal_scores: perSignalScores,
                rcd_version: rcdVersion,
                signals_version: signalsVersion,
                generated_at: generatedAt,
                model_used: modelUsed,
              };
              writes.push(row);
              const existingIdx = store.alignments.findIndex(
                (a) => a.role_context_id === roleContextId && a.repo_id === repoId,
              );
              if (existingIdx >= 0) store.alignments[existingIdx] = row;
              else store.alignments.push(row);
            }
            return { success: true, meta: {} };
          },
        };
      },
    };
  };

  return {
    db: { prepare } as unknown as D1Database,
    store,
    writes,
  };
}

// ─── Mock LLM provider ─────────────────────────────────────────────────────

interface MockProvider extends LLMProvider {
  calls: Array<{ candidateCount: number }>;
}

function createMockProvider(scoreByRepoId: Record<number, number>): MockProvider {
  const calls: MockProvider['calls'] = [];
  return {
    name: 'mock-gemma-4-26b',
    supportsTools: false,
    calls,
    async complete(messages: LLMMessage[]): Promise<LLMCompletion> {
      // Parse the repo_ids out of the user message the real rerank would send.
      const userMessage = messages[messages.length - 1]?.content ?? '';
      const repoIdMatches = [...userMessage.matchAll(/repo_id=(\d+)/g)].map((m) => Number(m[1]));
      calls.push({ candidateCount: repoIdMatches.length });

      const rankings = repoIdMatches.map((id) => ({
        repo_id: id,
        alignment_score: scoreByRepoId[id] ?? 0.5,
        alignment_band:
          (scoreByRepoId[id] ?? 0.5) >= 0.75 ? 'strong'
          : (scoreByRepoId[id] ?? 0.5) >= 0.5 ? 'moderate'
          : 'weak',
        reasoning: {
          matches: [`Rust stack match for repo_id=${id}`],
          mismatches: [],
          summary: `Fresh rerank summary for repo_id=${id}`,
        },
        per_signal_scores: { test_touch_rate: 0.9 },
      }));

      return { content: JSON.stringify({ rankings }) };
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('rerankMatchedRepos', () => {
  let stub: StubDb;
  let provider: MockProvider;
  const rcd = buildTestRcd();

  beforeEach(() => {
    stub = buildStubDb({ alignments: [], signals: [] });
    provider = createMockProvider({});
  });

  it('returns an empty result when matchedRepos is empty', async () => {
    const result = await rerankMatchedRepos({
      db: stub.db, provider, rcd, matchedRepos: [],
    });
    expect(result.alignments.size).toBe(0);
    expect(result.rankedRepoIds).toEqual([]);
    expect(result.cacheHits).toBe(0);
    expect(result.cacheMisses).toBe(0);
    expect(result.freshRerankCount).toBe(0);
    expect(result.skippedForMissingSignals).toBe(0);
    expect(provider.calls).toHaveLength(0);
  });

  it('returns cached alignments without calling the provider on full cache hit', async () => {
    stub = buildStubDb({
      alignments: [
        buildCachedAlignmentRow(1, { alignment_score: 0.9 }),
        buildCachedAlignmentRow(2, { alignment_score: 0.4, alignment_band: 'weak' }),
      ],
      signals: [buildSignalsRow(1), buildSignalsRow(2)],
    });
    provider = createMockProvider({});

    const matched: MatchedRepoLite[] = [
      { repoId: 1, fullName: 'acme/one' },
      { repoId: 2, fullName: 'acme/two' },
    ];
    const result = await rerankMatchedRepos({ db: stub.db, provider, rcd, matchedRepos: matched });

    expect(provider.calls).toHaveLength(0);
    expect(result.cacheHits).toBe(2);
    expect(result.cacheMisses).toBe(0);
    expect(result.freshRerankCount).toBe(0);
    expect(result.alignments.get(1)?.alignment_score).toBe(0.9);
    expect(result.rankedRepoIds).toEqual([1, 2]); // 0.9 before 0.4
    expect(stub.writes).toHaveLength(0);
  });

  it('calls the provider for cache misses, writes rows through, and merges with cached hits', async () => {
    stub = buildStubDb({
      alignments: [buildCachedAlignmentRow(1, { alignment_score: 0.9 })],
      signals: [buildSignalsRow(1), buildSignalsRow(2), buildSignalsRow(3)],
    });
    provider = createMockProvider({ 2: 0.82, 3: 0.35 });

    const matched: MatchedRepoLite[] = [
      { repoId: 1, fullName: 'acme/one' },
      { repoId: 2, fullName: 'acme/two' },
      { repoId: 3, fullName: 'acme/three' },
    ];
    const result = await rerankMatchedRepos({ db: stub.db, provider, rcd, matchedRepos: matched });

    expect(result.cacheHits).toBe(1);
    expect(result.cacheMisses).toBe(2);
    expect(result.freshRerankCount).toBe(2);
    expect(result.skippedForMissingSignals).toBe(0);

    // Cached alignment for repo_id 1 preserved, not re-written.
    expect(result.alignments.get(1)?.alignment_score).toBe(0.9);

    // Fresh alignments for repos 2 and 3 present.
    expect(result.alignments.get(2)?.alignment_score).toBeCloseTo(0.82, 6);
    expect(result.alignments.get(3)?.alignment_score).toBeCloseTo(0.35, 6);

    // Write-through: only 2 and 3 were written, not 1.
    expect(stub.writes.map((w) => w.repo_id).sort()).toEqual([2, 3]);
    expect(stub.writes.every((w) => w.rcd_version === 'rcd-v1')).toBe(true);
    expect(stub.writes.every((w) => w.signals_version === 'sig-v1')).toBe(true);

    // Provider was called exactly once, with the two miss candidates.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.candidateCount).toBe(2);

    // Stable ordering: 0.9 (cached) > 0.82 (fresh) > 0.35 (fresh).
    expect(result.rankedRepoIds).toEqual([1, 2, 3]);
  });

  it('treats a stale rcd_version row as a cache miss (cache key invariant)', async () => {
    // Stored row has rcd_version='rcd-OLD' — should be invalidated by the
    // current rcd_version='rcd-v1', forcing a fresh rerank and write-through.
    stub = buildStubDb({
      alignments: [
        buildCachedAlignmentRow(1, {
          rcd_version: 'rcd-OLD',
          alignment_score: 0.1, // low so we can detect if it leaks through
        }),
      ],
      signals: [buildSignalsRow(1)],
    });
    provider = createMockProvider({ 1: 0.88 });

    const matched: MatchedRepoLite[] = [{ repoId: 1, fullName: 'acme/one' }];
    const result = await rerankMatchedRepos({ db: stub.db, provider, rcd, matchedRepos: matched });

    expect(result.cacheHits).toBe(0);
    expect(result.cacheMisses).toBe(1);
    expect(result.freshRerankCount).toBe(1);
    // Fresh score wins — stale row is NOT returned.
    expect(result.alignments.get(1)?.alignment_score).toBeCloseTo(0.88, 6);
    expect(result.alignments.get(1)?.rcd_version).toBe('rcd-v1');
    expect(stub.writes).toHaveLength(1);
    expect(stub.writes[0]!.repo_id).toBe(1);
  });

  it('skips repos with no offline signals row instead of reranking or crashing', async () => {
    stub = buildStubDb({
      alignments: [],
      signals: [buildSignalsRow(1)], // only repo 1 has signals
    });
    provider = createMockProvider({ 1: 0.77 });

    const matched: MatchedRepoLite[] = [
      { repoId: 1, fullName: 'acme/one' },
      { repoId: 2, fullName: 'acme/no-signals' }, // no signals row
    ];
    const result = await rerankMatchedRepos({ db: stub.db, provider, rcd, matchedRepos: matched });

    expect(result.cacheHits).toBe(0);
    expect(result.cacheMisses).toBe(2);
    expect(result.freshRerankCount).toBe(1);
    expect(result.skippedForMissingSignals).toBe(1);
    expect(result.alignments.has(1)).toBe(true);
    expect(result.alignments.has(2)).toBe(false);
    expect(provider.calls[0]!.candidateCount).toBe(1);
  });

  it('does not call the provider when every miss lacks offline signals', async () => {
    stub = buildStubDb({ alignments: [], signals: [] });
    provider = createMockProvider({});

    const matched: MatchedRepoLite[] = [{ repoId: 99, fullName: 'acme/nothing' }];
    const result = await rerankMatchedRepos({ db: stub.db, provider, rcd, matchedRepos: matched });

    expect(provider.calls).toHaveLength(0);
    expect(result.cacheMisses).toBe(1);
    expect(result.skippedForMissingSignals).toBe(1);
    expect(result.freshRerankCount).toBe(0);
    expect(result.alignments.size).toBe(0);
  });

  it('sorts rankedRepoIds by alignment_score desc with repo_id tiebreak', async () => {
    stub = buildStubDb({
      alignments: [
        buildCachedAlignmentRow(10, { alignment_score: 0.75 }),
        buildCachedAlignmentRow(20, { alignment_score: 0.75 }),
        buildCachedAlignmentRow(30, { alignment_score: 0.50 }),
      ],
      signals: [buildSignalsRow(10), buildSignalsRow(20), buildSignalsRow(30)],
    });

    const matched: MatchedRepoLite[] = [
      { repoId: 30, fullName: 'acme/three' },
      { repoId: 20, fullName: 'acme/two' },
      { repoId: 10, fullName: 'acme/one' },
    ];
    const result = await rerankMatchedRepos({ db: stub.db, provider, rcd, matchedRepos: matched });

    // 10 and 20 tied at 0.75, 10 comes first (lower repo_id tiebreak).
    expect(result.rankedRepoIds).toEqual([10, 20, 30]);
  });
});
