/**
 * autoStageBuilder — picks a repo + a PR + an issue from the qualified-repos
 * catalog and returns a 2-station plan (CODE_REVIEW + CODE_IMPLEMENTATION) that
 * the /auto-build route writes into pipelines/stages/challenges in one
 * transaction.
 *
 * Pure function (no D1 writes). Reads only.
 *
 * v1 scope per .claude/plans/polymorphic-wobbling-tiger.md:
 *   - 2 stations (CODE_REVIEW + CODE_IMPLEMENTATION). ADR_REVIEW deferred.
 *   - Top-1 repo from matchRepos by score. Tolerance band → cosine threshold
 *     mapping is OQ-W1 — v1 uses raw score rank.
 *   - shared-repo: same repo for both stations.
 *   - per-stage: matchRepos called twice; second call may legitimately return
 *     the same repo (OQ-W2 — v1 accepts).
 *   - non_negotiable_skills_json drives mustHaveSkills for matchRepos. Falls
 *     back to persona_json.mustHaveSkills if NULL. The existing
 *     `HAVING must_hits = must_total` clause in matchRepos.ts:168 guarantees
 *     coverage — no new SQL needed.
 */

import type { CandidatePersona, RoleContextRow } from '../../types';
import { matchRepos, type MatchedRepo, type MatchRequest } from '../repoDiscovery/matchRepos';

export type StationType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION';

export interface PipelineMatchConfig {
  match_philosophy: 'tailored' | 'hybrid' | 'validate';
  tolerance: 'strict' | 'moderate' | 'lenient';
  stage_linkage: 'shared-repo' | 'per-stage';
  automation_granularity: 'per-pipeline' | 'per-candidate' | 'per-stage' | 'recruiter-override';
  hybrid_mix_ratio: number | null;
}

export interface AutoStation {
  type: StationType;
  title: string;
  repoId: number;
  githubRepoUrl: string;
  /** CODE_REVIEW only. */
  githubPrNumber?: number;
  /** CODE_REVIEW only — title used to seed the stage challenge title. */
  prTitle?: string;
  /** CODE_IMPLEMENTATION only — issue number from repo_issues. */
  issueNumber?: number;
  /** CODE_IMPLEMENTATION only. */
  issueTitle?: string;
  sortOrder: number;
}

export interface AutoStageBuilderResult {
  repoChoice: { repoId: number; fullName: string; rationale: string };
  stations: AutoStation[];
  /** Per-station match metadata for explainability + audit. */
  perStationRepo: Record<StationType, { repoId: number; fullName: string; score: number }>;
}

export interface AutoStageBuilderInput {
  db: D1Database;
  roleContext: RoleContextRow;
  matchConfig: PipelineMatchConfig;
}

const DEFAULT_LANGUAGE = 'typescript';
const DEFAULT_DOMAIN = 'general';
const DEFAULT_SENIORITY: CandidatePersona['seniority'] | string = 'mid';

/**
 * Coerce free-text seniority strings ("Mid-to-senior, 5–8 years") into the
 * 4-band enum matchRepos expects. Conservative: anything ambiguous → 'mid'.
 */
function normalizeSeniority(raw: string): 'junior' | 'mid' | 'senior' | 'staff' {
  const s = raw.toLowerCase();
  if (s.includes('staff') || s.includes('principal')) return 'staff';
  if (s.includes('senior')) return 'senior';
  if (s.includes('junior') || s.includes('entry') || s.includes('grad')) return 'junior';
  return 'mid';
}

function parsePersona(roleContext: RoleContextRow): CandidatePersona | null {
  // Phase 0.1: read RCD primary, fall back to legacy persona_json.
  if (roleContext.rcd_json) {
    try {
      const rcd = JSON.parse(roleContext.rcd_json) as { consumer_slice?: CandidatePersona };
      if (rcd.consumer_slice) return rcd.consumer_slice;
    } catch {
      // fall through to legacy path
    }
  }
  if (!roleContext.persona_json) return null;
  try {
    return JSON.parse(roleContext.persona_json) as CandidatePersona;
  } catch {
    return null;
  }
}

function parseNonNegotiable(roleContext: RoleContextRow): string[] | null {
  // The migration 0037 column lives on the row but is not part of RoleContextRow
  // yet. Read defensively from the dynamic row shape.
  const raw = (roleContext as unknown as Record<string, unknown>).non_negotiable_skills_json;
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * Resolve must-have skills for the matchRepos call. Non-negotiable wins; falls
 * back to persona.mustHaveSkills if no non-negotiable list is set.
 */
export function resolveMustHaveSkills(roleContext: RoleContextRow): string[] {
  const nonNegotiable = parseNonNegotiable(roleContext);
  if (nonNegotiable && nonNegotiable.length > 0) return nonNegotiable;
  const persona = parsePersona(roleContext);
  return persona?.mustHaveSkills ?? [];
}

function buildMatchRequest(roleContext: RoleContextRow): MatchRequest {
  const persona = parsePersona(roleContext);
  const mustHaveSkills = resolveMustHaveSkills(roleContext);

  // Pull primary language + domain from persona if available; fall back to
  // safe defaults. v1 doesn't read TechnicalContext.stack[] — it would require
  // RCD parsing and is non-trivial for the slice. v2 wires it.
  const niceToHaveSkills = persona?.niceToHaveSkills ?? [];
  const seniority = normalizeSeniority(persona?.seniority ?? DEFAULT_SENIORITY);

  return {
    mustHaveSkills,
    niceToHaveSkills,
    seniority,
    domain: DEFAULT_DOMAIN,
    primaryLanguage: DEFAULT_LANGUAGE,
    limit: 5,
  };
}

/**
 * Pick the top PR for a given repo from repo_sample_prs, preferring SWE-bench
 * eligible PRs (`swe_bench_eligible = 1`).
 */
export async function pickReviewPr(
  db: D1Database,
  repoId: number,
): Promise<{ prNumber: number; prTitle: string } | null> {
  const row = await db
    .prepare(
      `SELECT pr_number, title
         FROM repo_sample_prs
        WHERE repo_id = ?
          AND swe_bench_eligible = 1
        ORDER BY changed_file_count ASC, pr_number DESC
        LIMIT 1`,
    )
    .bind(repoId)
    .first<{ pr_number: number; title: string }>();

  if (!row) return null;
  return { prNumber: row.pr_number, prTitle: row.title };
}

/**
 * Pick the top implementation issue for a given repo. Constraints:
 *   - issue_challenge_signals.disqualified = 0 (passed scoring gate)
 *   - repo_issues.has_merged_pr = 0 (no contamination from existing PR)
 *   - difficulty_band matches normalized persona seniority (or any band if
 *     persona is unknown)
 */
export async function pickImplementationIssue(
  db: D1Database,
  repoId: number,
  seniority: 'junior' | 'mid' | 'senior' | 'staff',
): Promise<{ issueNumber: number; issueTitle: string } | null> {
  // issue_challenge_signals.difficulty_band only carries 'junior' | 'mid' | 'senior'
  // (per issueScorer.ts). 'staff' rolls up to 'senior'.
  const band = seniority === 'staff' ? 'senior' : seniority;

  const row = await db
    .prepare(
      `SELECT ri.issue_number, ri.title
         FROM repo_issues ri
         JOIN issue_challenge_signals ics ON ics.issue_id = ri.id
        WHERE ri.repo_id = ?
          AND ri.has_merged_pr = 0
          AND ics.disqualified = 0
          AND ics.difficulty_band = ?
        ORDER BY ics.implementability_score DESC, ics.clarity_score DESC
        LIMIT 1`,
    )
    .bind(repoId, band)
    .first<{ issue_number: number; title: string }>();

  if (!row) return null;
  return { issueNumber: row.issue_number, issueTitle: row.title };
}

export async function autoStageBuilder(
  input: AutoStageBuilderInput,
): Promise<AutoStageBuilderResult> {
  const { db, roleContext, matchConfig } = input;

  const baseRequest = buildMatchRequest(roleContext);
  if (baseRequest.mustHaveSkills.length === 0) {
    throw new Error(
      'autoStageBuilder: no must-have skills resolvable from role context (set non_negotiable_skills_json or persona.mustHaveSkills)',
    );
  }

  // 1. Match for CODE_REVIEW.
  const reviewMatches = await matchRepos(db, baseRequest);
  const reviewRepo: MatchedRepo | undefined = reviewMatches[0];
  if (!reviewRepo) {
    throw new Error('autoStageBuilder: matchRepos returned no candidate repos for review station');
  }

  // 2. Match for CODE_IMPLEMENTATION.
  let implRepo: MatchedRepo;
  if (matchConfig.stage_linkage === 'shared-repo') {
    implRepo = reviewRepo;
  } else {
    const implMatches = await matchRepos(db, baseRequest);
    const top = implMatches[0];
    if (!top) {
      throw new Error(
        'autoStageBuilder: matchRepos returned no candidate repos for implementation station',
      );
    }
    implRepo = top;
  }

  // 3. Pick PR + issue.
  const pr = await pickReviewPr(db, reviewRepo.id);
  if (!pr) {
    throw new Error(
      `autoStageBuilder: no SWE-bench-eligible PR found for repo ${reviewRepo.fullName} (id=${reviewRepo.id})`,
    );
  }
  const issue = await pickImplementationIssue(db, implRepo.id, baseRequest.seniority);
  if (!issue) {
    throw new Error(
      `autoStageBuilder: no eligible implementation issue found for repo ${implRepo.fullName} (id=${implRepo.id}, seniority=${baseRequest.seniority})`,
    );
  }

  const stations: AutoStation[] = [
    {
      type: 'CODE_REVIEW',
      title: `Review PR #${pr.prNumber}: ${pr.prTitle}`,
      repoId: reviewRepo.id,
      githubRepoUrl: reviewRepo.githubUrl,
      githubPrNumber: pr.prNumber,
      prTitle: pr.prTitle,
      sortOrder: 0,
    },
    {
      type: 'CODE_IMPLEMENTATION',
      title: `Implement issue #${issue.issueNumber}: ${issue.issueTitle}`,
      repoId: implRepo.id,
      githubRepoUrl: implRepo.githubUrl,
      issueNumber: issue.issueNumber,
      issueTitle: issue.issueTitle,
      sortOrder: 1,
    },
  ];

  const rationale =
    matchConfig.stage_linkage === 'shared-repo'
      ? `Matched ${reviewRepo.fullName} (score ${reviewRepo.score.toFixed(3)}) covering all ${baseRequest.mustHaveSkills.length} non-negotiable skill(s); shared across both stations.`
      : `Per-stage linkage: review on ${reviewRepo.fullName} (score ${reviewRepo.score.toFixed(3)}), implementation on ${implRepo.fullName} (score ${implRepo.score.toFixed(3)}).`;

  return {
    repoChoice: {
      repoId: reviewRepo.id,
      fullName: reviewRepo.fullName,
      rationale,
    },
    stations,
    perStationRepo: {
      CODE_REVIEW: { repoId: reviewRepo.id, fullName: reviewRepo.fullName, score: reviewRepo.score },
      CODE_IMPLEMENTATION: { repoId: implRepo.id, fullName: implRepo.fullName, score: implRepo.score },
    },
  };
}
