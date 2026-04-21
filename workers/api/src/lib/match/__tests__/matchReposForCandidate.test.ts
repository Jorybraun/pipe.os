/**
 * matchReposForCandidate unit tests.
 *
 * Stubs D1 + Ai + VectorizeIndex. Exercises the graph-only path, cosine
 * rerank, winner flip when cosine dominates, and empty-must-have guard.
 */

import { describe, it, expect, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { matchReposForCandidate } from '../matchReposForCandidate';
import type { CandidateKeyConcepts } from '../../candidateDiscovery/agent';

// ─── Shared stub fixtures (same shape as autoStageBuilder.test.ts) ────────────

interface RepoFixture {
  id: number;
  full_name: string;
  github_url: string;
  description: string | null;
  seniority_band: string;
  detected_domain: string;
  pr_quality_score: number;
  contamination_risk: number;
  stars: number;
  primary_language: string;
  skills: string[];
}

interface PrFixture {
  repo_id: number;
  pr_number: number;
  title: string;
  swe_bench_eligible: boolean;
}

interface IssueFixture {
  repo_id: number;
  issue_id: number;
  issue_number: number;
  title: string;
  has_merged_pr: boolean;
  difficulty_band: 'junior' | 'mid' | 'senior';
  disqualified: boolean;
  implementability_score: number;
  clarity_score: number;
}

interface DbState {
  repos: RepoFixture[];
  prs: PrFixture[];
  issues: IssueFixture[];
}

function buildStubDb(state: DbState): D1Database {
  const prepare = (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...args: unknown[]) {
        return {
          async first<T = unknown>(): Promise<T | null> {
            if (normalized.startsWith('SELECT pr_number, title FROM repo_sample_prs')) {
              const [repoId] = args as [number];
              const row = state.prs
                .filter((p) => p.repo_id === repoId && p.swe_bench_eligible)
                .sort((a, b) => b.pr_number - a.pr_number)[0];
              return (row ? { pr_number: row.pr_number, title: row.title } : null) as T | null;
            }
            if (normalized.startsWith('SELECT ri.issue_number, ri.title FROM repo_issues')) {
              const [repoId, band] = args as [number, string];
              const row = state.issues
                .filter(
                  (i) =>
                    i.repo_id === repoId &&
                    !i.has_merged_pr &&
                    !i.disqualified &&
                    i.difficulty_band === band,
                )
                .sort(
                  (a, b) =>
                    b.implementability_score - a.implementability_score ||
                    b.clarity_score - a.clarity_score,
                )[0];
              return (row ? { issue_number: row.issue_number, title: row.title } : null) as T | null;
            }
            return null;
          },
          async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
            if (normalized.startsWith('SELECT alias, canonical_slug FROM skill_aliases')) {
              return { results: [] as T[], success: true, meta: {} };
            }
            if (normalized.startsWith('WITH scored AS')) {
              const allArgs = args as unknown[];
              const knownSkills = new Set(state.repos.flatMap((r) => r.skills));
              const requiredSkills = allArgs.filter(
                (a): a is string => typeof a === 'string' && knownSkills.has(a),
              );
              const matched = state.repos
                .filter((r) => requiredSkills.every((s) => r.skills.includes(s)))
                .map((r) => ({
                  id: r.id,
                  full_name: r.full_name,
                  github_url: r.github_url,
                  description: r.description,
                  seniority_band: r.seniority_band,
                  detected_domain: r.detected_domain,
                  pr_quality_score: r.pr_quality_score,
                  contamination_risk: r.contamination_risk,
                  stars: r.stars,
                  primary_language: r.primary_language,
                  must_hits: requiredSkills.length,
                  nice_hits: 0,
                  construct_hits: 0,
                  score: r.pr_quality_score + r.stars / 100000,
                }))
                .sort((a, b) => b.score - a.score);
              return { results: matched as T[], success: true, meta: {} };
            }
            if (normalized.startsWith('SELECT repo_id, skill_slug, source FROM repo_skills')) {
              const allArgs = args as unknown[];
              const repoIds = allArgs.filter((a): a is number => typeof a === 'number');
              const skills = allArgs.filter((a): a is string => typeof a === 'string');
              const rows: Array<{ repo_id: number; skill_slug: string; source: string }> = [];
              for (const repoId of repoIds) {
                const repo = state.repos.find((r) => r.id === repoId);
                if (!repo) continue;
                for (const skill of skills) {
                  if (repo.skills.includes(skill)) {
                    rows.push({ repo_id: repoId, skill_slug: skill, source: 'fixture' });
                  }
                }
              }
              return { results: rows as T[], success: true, meta: {} };
            }
            if (normalized.startsWith('SELECT repo_id, construct_slug FROM repo_constructs')) {
              return { results: [] as T[], success: true, meta: {} };
            }
            if (
              normalized.startsWith(
                'SELECT repo_id, pr_number, pr_url, title, swe_bench_eligible, changed_file_count FROM repo_sample_prs',
              )
            ) {
              const repoIds = (args as unknown[]).filter((a): a is number => typeof a === 'number');
              const rows = state.prs
                .filter((p) => repoIds.includes(p.repo_id) && p.swe_bench_eligible)
                .map((p) => ({
                  repo_id: p.repo_id,
                  pr_number: p.pr_number,
                  pr_url: `https://github.com/x/y/pull/${p.pr_number}`,
                  title: p.title,
                  swe_bench_eligible: 1,
                  changed_file_count: 5,
                }));
              return { results: rows as T[], success: true, meta: {} };
            }
            return { results: [] as T[], success: true, meta: {} };
          },
          async run() {
            return { success: true, meta: {} };
          },
        };
      },
    };
  };
  return { prepare } as unknown as D1Database;
}

function fixtureState(): DbState {
  return {
    repos: [
      {
        id: 101,
        full_name: 'acme/widgets',
        github_url: 'https://github.com/acme/widgets',
        description: 'a',
        seniority_band: 'mid',
        detected_domain: 'general',
        pr_quality_score: 0.9,
        contamination_risk: 0.05,
        stars: 5000,
        primary_language: 'typescript',
        skills: ['typescript', 'react', 'postgres'],
      },
      {
        id: 102,
        full_name: 'acme/things',
        github_url: 'https://github.com/acme/things',
        description: 'b',
        seniority_band: 'mid',
        detected_domain: 'general',
        pr_quality_score: 0.7,
        contamination_risk: 0.05,
        stars: 2500,
        primary_language: 'typescript',
        skills: ['typescript', 'react', 'postgres'],
      },
    ],
    prs: [
      { repo_id: 101, pr_number: 42, title: 'fix off-by-one', swe_bench_eligible: true },
      { repo_id: 102, pr_number: 9, title: 'thing fix', swe_bench_eligible: true },
    ],
    issues: [
      { repo_id: 101, issue_id: 1, issue_number: 100, title: 'add caching', has_merged_pr: false, difficulty_band: 'mid', disqualified: false, implementability_score: 0.9, clarity_score: 0.8 },
      { repo_id: 102, issue_id: 2, issue_number: 200, title: 'thing issue', has_merged_pr: false, difficulty_band: 'mid', disqualified: false, implementability_score: 0.8, clarity_score: 0.8 },
    ],
  };
}

const KC: CandidateKeyConcepts = {
  mustHaveSkills: ['typescript', 'react', 'postgres'],
  niceToHaveSkills: [],
  seniority: 'mid',
  primary_language: 'typescript',
  detected_domain: 'general',
};

function makeAi(vector: number[] = new Array(1024).fill(0.01)): Ai {
  return { run: vi.fn(async () => ({ data: [vector] })) } as unknown as Ai;
}

function makeVectorize(scores: Record<number, number>): VectorizeIndex {
  return {
    query: vi.fn(async () => ({
      matches: Object.entries(scores).map(([id, score]) => ({
        id: `repo_${id}`,
        score,
      })),
    })),
    upsert: vi.fn(),
  } as unknown as VectorizeIndex;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('matchReposForCandidate', () => {
  it('returns a repo + PR + issue using graph score only when ai/vectorize are absent', async () => {
    const db = buildStubDb(fixtureState());
    const result = await matchReposForCandidate({
      db,
      candidateProfile: 'Jane is a mid-level fullstack engineer...',
      keyConcepts: KC,
    });

    expect(result.repoChoice.repoId).toBe(101);
    expect(result.repoChoice.cosine).toBeNull();
    expect(result.review?.prNumber).toBe(42);
    expect(result.implementation?.issueNumber).toBe(100);
  });

  it('reranks with cosine when ai + vectorize provided', async () => {
    const db = buildStubDb(fixtureState());
    const ai = makeAi();
    // Repo 102 gets the higher cosine — enough to flip the winner at cosineWeight=0.9.
    const vectorize = makeVectorize({ 101: 0.1, 102: 0.9 });

    const result = await matchReposForCandidate({
      db,
      ai,
      vectorize,
      candidateProfile: 'Jane profile…',
      keyConcepts: KC,
      cosineWeight: 0.9,
    });

    expect(result.repoChoice.repoId).toBe(102);
    expect(result.repoChoice.cosine).toBe(0.9);
  });

  it('keeps the graph winner when cosine weight is low', async () => {
    const db = buildStubDb(fixtureState());
    const ai = makeAi();
    const vectorize = makeVectorize({ 101: 0.1, 102: 0.9 });

    const result = await matchReposForCandidate({
      db,
      ai,
      vectorize,
      candidateProfile: 'Jane profile…',
      keyConcepts: KC,
      cosineWeight: 0.1,
    });

    // At weight 0.1, graph score still dominates: 101 wins.
    expect(result.repoChoice.repoId).toBe(101);
  });

  it('throws when candidate has no must-have skills', async () => {
    const db = buildStubDb(fixtureState());
    await expect(
      matchReposForCandidate({
        db,
        candidateProfile: 'p',
        keyConcepts: { ...KC, mustHaveSkills: [] },
      }),
    ).rejects.toThrow(/no must-have skills/);
  });

  it('throws when matchRepos returns no repos', async () => {
    const db = buildStubDb({ repos: [], prs: [], issues: [] });
    await expect(
      matchReposForCandidate({ db, candidateProfile: 'p', keyConcepts: KC }),
    ).rejects.toThrow(/no candidate repos/);
  });

  it('returns null PR / issue when repo has none, without throwing', async () => {
    const state = fixtureState();
    state.prs = []; // no PRs anywhere
    state.issues = []; // no issues
    const db = buildStubDb(state);

    const result = await matchReposForCandidate({
      db,
      candidateProfile: 'p',
      keyConcepts: KC,
    });

    expect(result.repoChoice.repoId).toBe(101);
    expect(result.review).toBeNull();
    expect(result.implementation).toBeNull();
  });

  it('falls back to graph-only when embed returns wrong-dim vector', async () => {
    const db = buildStubDb(fixtureState());
    const ai = makeAi(new Array(512).fill(0.01)); // wrong dim
    const vectorize = makeVectorize({ 102: 0.99 });

    const result = await matchReposForCandidate({
      db,
      ai,
      vectorize,
      candidateProfile: 'p',
      keyConcepts: KC,
      cosineWeight: 0.9,
    });

    // embed rejected → cosine scores never fetched → graph winner wins.
    expect(result.repoChoice.repoId).toBe(101);
    expect(result.repoChoice.cosine).toBeNull();
  });
});
