import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  autoStageBuilder,
  buildMatchRequest,
  pickReviewPr,
  resolveMustHaveSkills,
  type PipelineMatchConfig,
} from '../autoStageBuilder';
import type { CandidatePersona, RoleContextRow } from '../../../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PERSONA: CandidatePersona = {
  seniority: 'mid',
  archetype: 'Backend-leaning fullstack',
  mustHaveSkills: ['typescript', 'react', 'postgres'],
  niceToHaveSkills: ['kubernetes'],
  disposition: ['ships incrementally'],
  careerSignal: 'shipped a greenfield system end-to-end',
  redFlags: [],
  dealbreakers: [],
};

function makeRoleContext(overrides?: Partial<RoleContextRow> & { non_negotiable_skills_json?: string | null }): RoleContextRow {
  const base: RoleContextRow = {
    id: 'rc-1',
    pipeline_id: null,
    owner_id: 'user-1',
    baseline: null,
    knowledge_state: null,
    exchanges: null,
    question_budget: 8,
    questions_asked: 0,
    status: 'COMPLETE',
    persona_json: JSON.stringify(PERSONA),
    job_description_md: '# JD',
    rcd_version: '1.0.0',
    rcd_json: null,
    validation_metadata: null,
    bars_overrides: null,
    recruitment_brief_json: null,
    created_at: '2026-04-19T00:00:00Z',
    updated_at: '2026-04-19T00:00:00Z',
  };
  return { ...base, ...overrides } as RoleContextRow;
}

function baseConfig(overrides?: Partial<PipelineMatchConfig>): PipelineMatchConfig {
  return {
    match_philosophy: 'hybrid',
    tolerance: 'moderate',
    stage_linkage: 'shared-repo',
    automation_granularity: 'per-candidate',
    hybrid_mix_ratio: 0.6,
    ...overrides,
  };
}

// ─── D1 stub ──────────────────────────────────────────────────────────────────

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
  skills: string[]; // canonical slugs the repo "has"
}

interface PrFixture {
  repo_id: number;
  pr_number: number;
  title: string;
  swe_bench_eligible: boolean;
  conceptKeys?: string[];
}

interface IssueFixture {
  repo_id: number;
  issue_id: number;
  issue_number: number;
  title: string;
  body: string | null;
  state_at_crawl: 'open' | 'closed';
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
  roleContextConcepts?: Array<{ canonicalKey: string; label: string }>;
}

interface StubDb {
  db: D1Database;
  matchReposCalls: number;
}

function buildStubDb(state: DbState): StubDb {
  let matchReposCalls = 0;

  const prepare = (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    return {
      bind(...args: unknown[]) {
        return {
          async first<T = unknown>(): Promise<T | null> {
            // pickReviewPr
            if (normalized.startsWith('SELECT pr_number, title FROM repo_sample_prs')) {
              const [repoId] = args as [number];
              const candidates = state.prs
                .filter((p) => p.repo_id === repoId && p.swe_bench_eligible)
                .sort((a, b) => b.pr_number - a.pr_number);
              const row = candidates[0];
              return (row ? { pr_number: row.pr_number, title: row.title } : null) as T | null;
            }

            // pickImplementationIssue
            if (normalized.startsWith('SELECT ri.issue_number, ri.title FROM repo_issues')) {
              const [repoId, band] = args as [number, string];
              const candidates = state.issues
                .filter(
                  (i) =>
                    i.repo_id === repoId &&
                    i.state_at_crawl === 'open' &&
                    Boolean(i.body?.trim()) &&
                    !i.has_merged_pr &&
                    !i.disqualified &&
                    i.difficulty_band === band,
                )
                .sort(
                  (a, b) =>
                    b.implementability_score - a.implementability_score ||
                    b.clarity_score - a.clarity_score,
                );
              const row = candidates[0];
              return (row ? { issue_number: row.issue_number, title: row.title } : null) as T | null;
            }

            return null;
          },

          async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
            if (normalized.startsWith('SELECT id, rcd_version, source_section, narrative_text, extracted_properties_json FROM role_nodes')) {
              return { results: [] as T[], success: true, meta: {} };
            }

            if (normalized.startsWith('SELECT cr.id AS context_record_id')) {
              const rows = (state.roleContextConcepts ?? []).map((concept, index) => ({
                context_record_id: `role-context-record-${index + 1}`,
                record_type: 'simple_job_description_context',
                extraction_version: 'simple-jd-v1',
                canonical_key: concept.canonicalKey,
                label: concept.label,
                source_ref_type: 'source_span',
                source_ref_id: `role-source-span-${index + 1}`,
              }));
              return { results: rows as T[], success: true, meta: {} };
            }

            if (normalized.startsWith('SELECT rcp.pr_number, rcp.quality_score, rcp.packet_json FROM review_challenge_packets')) {
              const [repoId] = args as [number];
              const repo = state.repos.find((candidate) => candidate.id === repoId);
              const rows = state.prs
                .filter((pr) => pr.repo_id === repoId && pr.swe_bench_eligible)
                .map((pr) => ({
                  pr_number: pr.pr_number,
                  quality_score: 0.9,
                  packet_json: JSON.stringify({
                    pullRequest: { number: pr.pr_number, title: pr.title },
                    demands: (pr.conceptKeys ?? (repo?.skills ?? []).map((skill) => `term:${skill}`)).map((conceptKey) => ({
                      conceptKeys: [conceptKey],
                    })),
                  }),
                }));
              return { results: rows as T[], success: true, meta: {} };
            }

            if (normalized.startsWith('SELECT qr.id AS repo_id')) {
              const rows = state.prs.flatMap((pr) => {
                if (!pr.swe_bench_eligible) return [];
                const repo = state.repos.find((candidate) => candidate.id === pr.repo_id);
                if (!repo) return [];
                return [{
                  repo_id: repo.id,
                  full_name: repo.full_name,
                  github_url: repo.github_url,
                  description: repo.description,
                  seniority_band: repo.seniority_band,
                  detected_domain: repo.detected_domain,
                  pr_quality_score: repo.pr_quality_score,
                  stars: repo.stars,
                  primary_language: repo.primary_language,
                  pr_number: pr.pr_number,
                  pr_url: `https://github.com/x/y/pull/${pr.pr_number}`,
                  pr_title: pr.title,
                  quality_score: 0.9,
                  packet_json: JSON.stringify({
                    pullRequest: { number: pr.pr_number, title: pr.title },
                    demands: (pr.conceptKeys ?? repo.skills.map((skill) => `term:${skill}`)).map((conceptKey) => ({
                      conceptKeys: [conceptKey],
                    })),
                  }),
                }];
              });
              return { results: rows as T[], success: true, meta: {} };
            }

            // skill_aliases lookup — return empty so the open term survives unchanged.
            if (normalized.startsWith('SELECT alias, canonical_slug FROM skill_aliases')) {
              return { results: [] as T[], success: true, meta: {} };
            }

            // matchRepos main query: starts with WITH scored AS
            if (normalized.startsWith('WITH scored AS')) {
              matchReposCalls += 1;

              // Reconstruct must-have skill list from args. The query order is:
              //   ...mustSlugs, ...niceSlugs, ...constructSlugs, lang, ...bands, staleCutoff,
              //   mustTotal, mustTotal, max(niceTotal,1), domain, max(constructTotal,1), limit
              // The trailing `mustTotal` is the HAVING parameter — we need it to slice mustSlugs.
              // Easiest: scan the trailing numerics for the limit + denominators and parse from there.
              // For a stub, just rely on the persona we know — use the full args list and
              // pick the leading string args matching our skill universe.
              const allSkills = new Set<string>();
              for (const a of args) {
                if (typeof a === 'string' && /^[a-z0-9-]+$/.test(a) && a.length < 30) {
                  allSkills.add(a);
                }
              }

              // The repos that match: every must-skill must be in repo.skills
              // We can't infer mustSlugs precisely without parsing the query, so we
              // reconstruct by filtering args to only the canonical skills our fixture knows.
              const knownSkillSet = new Set(state.repos.flatMap((r) => r.skills));
              const seenAsSkills = [...allSkills].filter((s) => knownSkillSet.has(s));

              // Heuristic: in fixtures we never set niceToHaveSkills duplicates with must,
              // so all skill-shaped args we recognise are must OR nice. We use the
              // resolveMustHaveSkills() value implicitly by checking the test setup —
              // for the stub, we assume *all* recognized skills must be present (strict).
              // This is fine because the tests assert against this behavior explicitly.
              const requiredSkills = seenAsSkills;

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
                  // Score: deterministic by stars so per-stage runs return same top-1
                  score: r.pr_quality_score + r.stars / 100000,
                }))
                .sort((a, b) => b.score - a.score);

              return { results: matched as T[], success: true, meta: {} };
            }

            // matchRepos secondary: skill rows
            if (normalized.startsWith('SELECT repo_id, skill_slug, source FROM repo_skills')) {
              const allArgs = args as unknown[];
              // First N args are repoIds (numbers), remaining are skill slugs.
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

            // matchRepos secondary: constructs (we have none)
            if (normalized.startsWith('SELECT repo_id, construct_slug FROM repo_constructs')) {
              return { results: [] as T[], success: true, meta: {} };
            }

            // matchRepos secondary: sample PRs (used by matchRepos itself, separate from pickReviewPr)
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

  return {
    db: { prepare } as unknown as D1Database,
    get matchReposCalls() {
      return matchReposCalls;
    },
  } as StubDb;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveMustHaveSkills', () => {
  it('returns persona.mustHaveSkills when non_negotiable_skills_json is absent', () => {
    const rc = makeRoleContext();
    expect(resolveMustHaveSkills(rc)).toEqual(['typescript', 'react', 'postgres']);
  });

  it('prefers non_negotiable_skills_json over persona.mustHaveSkills', () => {
    const rc = makeRoleContext({ non_negotiable_skills_json: JSON.stringify(['typescript', 'react']) });
    expect(resolveMustHaveSkills(rc)).toEqual(['typescript', 'react']);
  });

  it('falls back to persona when non_negotiable list is empty array', () => {
    const rc = makeRoleContext({ non_negotiable_skills_json: JSON.stringify([]) });
    expect(resolveMustHaveSkills(rc)).toEqual(['typescript', 'react', 'postgres']);
  });

  it('returns [] when neither field is set', () => {
    const rc = makeRoleContext({ persona_json: null });
    expect(resolveMustHaveSkills(rc)).toEqual([]);
  });
});

describe('buildMatchRequest', () => {
  it('does not invent seniority, language, or domain constraints', () => {
    const request = buildMatchRequest(makeRoleContext({
      persona_json: JSON.stringify({ ...PERSONA, seniority: 'Mid, 3-5 years' }),
    }));

    expect(request.seniority).toBeUndefined();
    expect(request.primaryLanguage).toBeUndefined();
    expect(request.domain).toBeUndefined();
  });
});

describe('autoStageBuilder', () => {
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
          seniority_band: 'senior',
          detected_domain: 'general',
          pr_quality_score: 0.6,
          contamination_risk: 0.1,
          stars: 1500,
          primary_language: 'typescript',
          skills: ['typescript', 'react'], // missing postgres
        },
      ],
      prs: [
        { repo_id: 101, pr_number: 42, title: 'fix off-by-one', swe_bench_eligible: true },
        { repo_id: 101, pr_number: 17, title: 'old fix', swe_bench_eligible: true },
        { repo_id: 102, pr_number: 9, title: 'thing fix', swe_bench_eligible: true },
      ],
      roleContextConcepts: [{ canonicalKey: 'term:typescript', label: 'typescript' }],
      issues: [
        { repo_id: 101, issue_id: 1, issue_number: 100, title: 'add caching', body: 'Cache expensive widget lookups.', state_at_crawl: 'open', has_merged_pr: false, difficulty_band: 'mid', disqualified: false, implementability_score: 0.9, clarity_score: 0.8 },
        { repo_id: 101, issue_id: 2, issue_number: 101, title: 'add metrics', body: 'Expose request metrics for widgets.', state_at_crawl: 'open', has_merged_pr: false, difficulty_band: 'mid', disqualified: false, implementability_score: 0.7, clarity_score: 0.7 },
        { repo_id: 101, issue_id: 3, issue_number: 102, title: 'merged already', body: 'Already solved in a merged PR.', state_at_crawl: 'open', has_merged_pr: true, difficulty_band: 'mid', disqualified: false, implementability_score: 0.95, clarity_score: 0.95 },
        { repo_id: 102, issue_id: 4, issue_number: 200, title: 'thing issue', body: 'Implement the thing endpoint.', state_at_crawl: 'open', has_merged_pr: false, difficulty_band: 'mid', disqualified: false, implementability_score: 0.8, clarity_score: 0.8 },
      ],
    };
  }

  it('builds 2 stations on shared-repo with the same repoId for both', async () => {
    const stub = buildStubDb(fixtureState());
    const result = await autoStageBuilder({
      db: stub.db,
      roleContext: makeRoleContext(),
      matchConfig: baseConfig({ stage_linkage: 'shared-repo' }),
    });

    expect(result.stations).toHaveLength(2);
    const [review, impl] = result.stations;
    expect(review!.type).toBe('CODE_REVIEW');
    expect(impl!.type).toBe('CODE_IMPLEMENTATION');
    expect(review!.repoId).toBe(impl!.repoId);
    expect(review!.repoId).toBe(101); // higher pr_quality_score wins
    expect(review!.githubPrNumber).toBe(17); // stable PR-number tie-break after equal evidence
    expect(impl!.issueNumber).toBe(100);
    expect(stub.matchReposCalls).toBe(0);
  });

  it('runs implementation matchRepos once when stage_linkage=per-stage', async () => {
    const stub = buildStubDb(fixtureState());
    await autoStageBuilder({
      db: stub.db,
      roleContext: makeRoleContext(),
      matchConfig: baseConfig({ stage_linkage: 'per-stage' }),
    });
    expect(stub.matchReposCalls).toBe(1);
  });

  it('uses non_negotiable_skills (subset of mustHaveSkills) to filter repos', async () => {
    // Non-negotiable = [typescript, react]; persona.must = [..., postgres]
    // With stricter must=postgres, repo 102 would be filtered out.
    // Without postgres in must list, both repos qualify.
    const stub = buildStubDb(fixtureState());
    const result = await autoStageBuilder({
      db: stub.db,
      roleContext: makeRoleContext({
        non_negotiable_skills_json: JSON.stringify(['typescript', 'react']),
      }),
      matchConfig: baseConfig(),
      requestedStationTypes: ['CODE_IMPLEMENTATION'],
    });
    // Top-1 by pr_quality_score is still 101 (0.9 > 0.6).
    expect(result.stations[0]!.repoId).toBe(101);
    expect(result.stations[0]!.type).toBe('CODE_IMPLEMENTATION');
    expect(stub.matchReposCalls).toBe(1);
  });

  it('uses persisted role context concepts to select source-backed review PRs', async () => {
    const state = fixtureState();
    state.roleContextConcepts = [{ canonicalKey: 'term:kafka', label: 'kafka' }];
    state.prs = [
      { repo_id: 101, pr_number: 42, title: 'persona-surface PR', swe_bench_eligible: true, conceptKeys: ['term:typescript'] },
      { repo_id: 101, pr_number: 84, title: 'source-backed Kafka PR', swe_bench_eligible: true, conceptKeys: ['term:kafka'] },
    ];
    const stub = buildStubDb(state);

    const result = await autoStageBuilder({
      db: stub.db,
      roleContext: makeRoleContext({
        non_negotiable_skills_json: JSON.stringify(['kafka']),
        job_description_md: 'We need kafka ownership.',
      }),
      matchConfig: baseConfig(),
      requestedStationTypes: ['CODE_REVIEW'],
    });

    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]!.githubPrNumber).toBe(84);
    expect(result.stations[0]!.prTitle).toBe('source-backed Kafka PR');
  });

  it('builds code review from source-backed role concepts without legacy must-have skills', async () => {
    const state = fixtureState();
    state.roleContextConcepts = [{ canonicalKey: 'term:kafka', label: 'kafka' }];
    state.prs = [
      { repo_id: 101, pr_number: 84, title: 'source-backed Kafka PR', swe_bench_eligible: true, conceptKeys: ['term:kafka'] },
    ];
    const stub = buildStubDb(state);

    const result = await autoStageBuilder({
      db: stub.db,
      roleContext: makeRoleContext({
        persona_json: null,
        non_negotiable_skills_json: null,
        job_description_md: 'We need kafka ownership.',
      }),
      matchConfig: baseConfig(),
      requestedStationTypes: ['CODE_REVIEW'],
    });

    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]).toMatchObject({
      type: 'CODE_REVIEW',
      repoId: 101,
      githubPrNumber: 84,
      prTitle: 'source-backed Kafka PR',
    });
    expect(result.perStationRepo.CODE_REVIEW).toMatchObject({
      repoId: 101,
      fullName: 'acme/widgets',
    });
    expect(stub.matchReposCalls).toBe(0);
  });

  it('throws when no source-backed review concepts can be resolved', async () => {
    const state = fixtureState();
    state.roleContextConcepts = [];
    const stub = buildStubDb(state);
    await expect(
      autoStageBuilder({
        db: stub.db,
        roleContext: makeRoleContext({ persona_json: null }),
        matchConfig: baseConfig(),
      }),
    ).rejects.toThrow(/no source-backed role concepts resolvable for review station/);
  });

  it('throws when implementation has no must-have skills and no review repo to share', async () => {
    const stub = buildStubDb(fixtureState());
    await expect(
      autoStageBuilder({
        db: stub.db,
        roleContext: makeRoleContext({ persona_json: null }),
        matchConfig: baseConfig(),
        requestedStationTypes: ['CODE_IMPLEMENTATION'],
      }),
    ).rejects.toThrow(/no must-have skills resolvable for implementation station/);
  });

  it('builds only code review when requested', async () => {
    const stub = buildStubDb(fixtureState());
    const result = await autoStageBuilder({
      db: stub.db,
      roleContext: makeRoleContext(),
      matchConfig: baseConfig(),
      requestedStationTypes: ['CODE_REVIEW'],
    });
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]!.type).toBe('CODE_REVIEW');
    expect(result.perStationRepo.CODE_IMPLEMENTATION).toBeUndefined();
    expect(stub.matchReposCalls).toBe(0);
  });

  it('builds only code implementation when requested', async () => {
    const stub = buildStubDb(fixtureState());
    const result = await autoStageBuilder({
      db: stub.db,
      roleContext: makeRoleContext(),
      matchConfig: baseConfig(),
      requestedStationTypes: ['CODE_IMPLEMENTATION'],
    });
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]!.type).toBe('CODE_IMPLEMENTATION');
    expect(result.perStationRepo.CODE_REVIEW).toBeUndefined();
    expect(stub.matchReposCalls).toBe(1);
  });

  it('defaults to both stations when requested station list is empty', async () => {
    const stub = buildStubDb(fixtureState());
    const result = await autoStageBuilder({
      db: stub.db,
      roleContext: makeRoleContext(),
      matchConfig: baseConfig(),
      requestedStationTypes: [],
    });
    expect(result.stations).toHaveLength(2);
    expect(result.stations[0]!.type).toBe('CODE_REVIEW');
    expect(result.stations[1]!.type).toBe('CODE_IMPLEMENTATION');
  });

  it('skips issues with has_merged_pr=1 and prefers highest implementability_score', async () => {
    const stub = buildStubDb(fixtureState());
    const result = await autoStageBuilder({
      db: stub.db,
      roleContext: makeRoleContext(),
      matchConfig: baseConfig(),
    });
    expect(result.stations[1]!.issueNumber).toBe(100); // not 102 (merged), not 101 (lower score)
  });

  it('skips implementation issues without captured source body or open crawl state', async () => {
    const state = fixtureState();
    state.issues = [
      { ...state.issues[0]!, issue_number: 100, body: null, implementability_score: 0.99 },
      { ...state.issues[1]!, issue_number: 101, state_at_crawl: 'closed', implementability_score: 0.98 },
      { ...state.issues[1]!, issue_number: 103, title: 'source-backed issue', body: 'Implement from this source issue body.', state_at_crawl: 'open', implementability_score: 0.6 },
    ];
    const stub = buildStubDb(state);
    const result = await autoStageBuilder({
      db: stub.db,
      roleContext: makeRoleContext(),
      matchConfig: baseConfig(),
    });

    expect(result.stations[1]!.issueNumber).toBe(103);
  });

  it('throws if no source-backed role-safe PR exists for the matched repo', async () => {
    const state = fixtureState();
    state.prs = state.prs.map((p) => ({ ...p, swe_bench_eligible: false }));
    const stub = buildStubDb(state);
    await expect(
      autoStageBuilder({
        db: stub.db,
        roleContext: makeRoleContext(),
        matchConfig: baseConfig(),
      }),
    ).rejects.toThrow(/no candidate repos matched source-backed role evidence/);
  });

  it('throws if no eligible implementation issue', async () => {
    const state = fixtureState();
    state.issues = state.issues.map((i) => ({ ...i, disqualified: true }));
    const stub = buildStubDb(state);
    await expect(
      autoStageBuilder({
        db: stub.db,
        roleContext: makeRoleContext(),
        matchConfig: baseConfig(),
      }),
    ).rejects.toThrow(/no eligible implementation issue/);
  });
});

describe('pickReviewPr', () => {
  it('only considers context-ready source-backed review packets', async () => {
    const sqls: string[] = [];
    const db = {
      prepare(sql: string) {
        sqls.push(sql);
        return {
          bind() {
            return {
              async all<T>() {
                return { results: [] as T[], success: true, meta: {} };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    await pickReviewPr(db, 101, ['term:typescript']);

    expect(sqls[0]).toContain('JOIN context_records cr');
    expect(sqls[0]).toContain("cr.record_type = 'repo_challenge_packet'");
    expect(sqls[0]).toContain("crsr.source_ref_type = 'repo_source_span'");
    expect(sqls[0]).toContain('FROM context_record_concepts crc');
  });
});
