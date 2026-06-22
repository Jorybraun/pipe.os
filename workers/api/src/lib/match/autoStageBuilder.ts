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
 *   - per-stage: CODE_REVIEW uses source-backed review packets and
 *     CODE_IMPLEMENTATION uses matchRepos; they may legitimately return the
 *     same repo (OQ-W2 — v1 accepts).
 *   - CODE_REVIEW selects repos and PRs from source-backed role context concepts
 *     against context-ready review packets.
 *   - CODE_IMPLEMENTATION still uses the legacy matchRepos skill path until
 *     implementation issue matching is moved onto source-backed context records.
 */

import type { CandidatePersona, RoleContextDocument, RoleContextRow } from '../../types';
import { loadRoleChallengeSemantics } from '../challengeMatching/roleGuardrails';
import { backfillRepoImplementationIssueContextRecords } from '../repoDiscovery/implementationIssueContext';
import { matchRepos, type MatchedRepo, type MatchRequest } from '../repoDiscovery/matchRepos';
import type { ChallengePacket } from '../repoSemanticGraph';

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

export interface PickReviewPrResult {
  prNumber: number;
  prTitle: string;
  selectionPath: 'source_backed_role_overlap';
}

interface ReviewPacketRepoRow {
  repo_id: number;
  full_name: string;
  github_url: string;
  description: string | null;
  seniority_band: string;
  detected_domain: string;
  pr_quality_score: number;
  stars: number;
  primary_language: string;
  pr_number: number;
  pr_url: string | null;
  pr_title: string | null;
  quality_score: number;
  packet_json: string;
}

export interface AutoStageBuilderResult {
  repoChoice: { repoId: number; fullName: string; rationale: string };
  stations: AutoStation[];
  /** Per-station match metadata for explainability + audit. */
  perStationRepo: Partial<
    Record<StationType, { repoId: number; fullName: string; score: number }>
  >;
}

export interface AutoStageBuilderInput {
  db: D1Database;
  roleContext: RoleContextRow;
  matchConfig: PipelineMatchConfig;
  requestedStationTypes?: Array<'CODE_REVIEW' | 'CODE_IMPLEMENTATION'>;
}

function exactSeniority(
  raw: string | null | undefined,
): MatchRequest['seniority'] {
  const normalized = raw?.trim().toLowerCase();
  return normalized === 'junior'
    || normalized === 'mid'
    || normalized === 'senior'
    || normalized === 'staff'
    ? normalized
    : undefined;
}

function parseRcd(roleContext: RoleContextRow): RoleContextDocument | null {
  if (!roleContext.rcd_json) return null;
  try {
    return JSON.parse(roleContext.rcd_json) as RoleContextDocument;
  } catch {
    return null;
  }
}

function parsePersona(roleContext: RoleContextRow): CandidatePersona | null {
  // Phase 0.1: read RCD primary, fall back to legacy persona_json.
  const rcd = parseRcd(roleContext);
  if (rcd?.consumer_slice) return rcd.consumer_slice;
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
 * Resolve must-have skills for the matchRepos call. Non-negotiable wins; then
 * RCD technical_context.stack; falls back to persona.mustHaveSkills.
 */
export function resolveMustHaveSkills(roleContext: RoleContextRow): string[] {
  const nonNegotiable = parseNonNegotiable(roleContext);
  if (nonNegotiable && nonNegotiable.length > 0) return nonNegotiable;

  const rcd = parseRcd(roleContext);
  if (rcd && rcd.technical_context.stack.length > 0) {
    return rcd.technical_context.stack;
  }

  const persona = parsePersona(roleContext);
  return persona?.mustHaveSkills ?? [];
}

export function buildMatchRequest(roleContext: RoleContextRow): MatchRequest {
  const persona = parsePersona(roleContext);
  const mustHaveSkills = resolveMustHaveSkills(roleContext);

  const rcd = parseRcd(roleContext);
  if (rcd) {
    const tc = rcd.technical_context;
    const niceToHaveSkills = persona?.niceToHaveSkills ?? [];

    return {
      mustHaveSkills,
      niceToHaveSkills,
      seniority: exactSeniority(tc.seniority_band),
      limit: 5,
    };
  }

  const niceToHaveSkills = persona?.niceToHaveSkills ?? [];

  return {
    mustHaveSkills,
    niceToHaveSkills,
    seniority: exactSeniority(persona?.seniority),
    limit: 5,
  };
}

function roleContextSemanticInput(roleContext: RoleContextRow): Parameters<typeof loadRoleChallengeSemantics>[1] {
  const raw = (roleContext as unknown as Record<string, unknown>).non_negotiable_skills_json;
  return {
    id: roleContext.id,
    rcd_version: roleContext.rcd_version,
    rcd_json: roleContext.rcd_json,
    job_description_md: roleContext.job_description_md,
    non_negotiable_skills_json: typeof raw === 'string' ? raw : null,
  };
}

function packetConcepts(packet: ChallengePacket): Set<string> {
  return new Set(packet.demands.flatMap((demand) => demand.conceptKeys));
}

function rankedPacketConceptOverlap(
  packetJson: string,
  roleConcepts: Set<string>,
  requiredConcepts: Set<string>,
): { concepts: Set<string>; overlap: number } | null {
  let packet: ChallengePacket;
  try {
    packet = JSON.parse(packetJson) as ChallengePacket;
  } catch {
    return null;
  }
  const concepts = packetConcepts(packet);
  if ([...requiredConcepts].some((concept) => !concepts.has(concept))) return null;
  const overlap = [...roleConcepts].filter((concept) => concepts.has(concept)).length;
  return overlap > 0 ? { concepts, overlap } : null;
}

/**
 * Select candidate repos directly from context-ready review packets when a role
 * has source-backed concepts but no legacy must-have skill list. This keeps
 * CODE_REVIEW auto-build usable for simple JD/open-concept roles without
 * fabricating repo-skill constraints.
 */
export async function matchReviewReposByRoleConcepts(
  db: D1Database,
  roleConcepts: string[],
  requiredConcepts: string[] = [],
  limit = 5,
): Promise<MatchedRepo[]> {
  if (roleConcepts.length === 0) return [];
  const rows = await db.prepare(
    `SELECT qr.id AS repo_id,
            qr.full_name,
            qr.github_url,
            qr.description,
            qr.seniority_band,
            qr.detected_domain,
            qr.pr_quality_score,
            qr.stars,
            qr.primary_language,
            rcp.pr_number,
            rsp.pr_url,
            rsp.title AS pr_title,
            rcp.quality_score,
            rcp.packet_json
       FROM review_challenge_packets rcp
       JOIN qualified_repos qr ON qr.id = rcp.repo_id
       JOIN context_records cr
         ON cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
        AND cr.scope_type = 'repo_snapshot'
        AND cr.scope_id = rcp.repo_snapshot_id
        AND cr.record_type = 'repo_challenge_packet'
       LEFT JOIN repo_sample_prs rsp
         ON rsp.repo_id = rcp.repo_id
        AND rsp.pr_number = rcp.pr_number
      WHERE rcp.production_ready = 1
        AND rcp.quality_score >= 0.70
        AND COALESCE(qr.disqualified, 0) = 0
        AND (
          SELECT COUNT(*)
            FROM context_record_source_refs crsr
           WHERE crsr.context_record_id = cr.id
             AND crsr.source_ref_type = 'repo_source_span'
        ) > 0
        AND (
          SELECT COUNT(*)
            FROM context_record_concepts crc
           WHERE crc.context_record_id = cr.id
        ) > 0
      ORDER BY rcp.quality_score DESC, qr.id, rcp.pr_number`,
  ).bind().all<ReviewPacketRepoRow>();

  const relevant = new Set(roleConcepts);
  const required = new Set(requiredConcepts);
  const byRepo = new Map<number, MatchedRepo & { bestOverlap: number; bestQuality: number }>();

  for (const row of rows.results ?? []) {
    const overlap = rankedPacketConceptOverlap(row.packet_json, relevant, required);
    if (!overlap) continue;
    const score = overlap.overlap + row.quality_score;
    const current = byRepo.get(row.repo_id);
    const samplePr: MatchedRepo['samplePrs'][number] = {
      prNumber: row.pr_number,
      prUrl: row.pr_url ?? `${row.github_url}/pull/${row.pr_number}`,
      title: row.pr_title ?? `PR #${row.pr_number}`,
      sweBenchEligible: true,
      changedFileCount: 0,
    };
    if (
      current
      && (
        current.bestOverlap > overlap.overlap
        || (
          current.bestOverlap === overlap.overlap
          && current.bestQuality > row.quality_score
        )
      )
    ) {
      current.samplePrs.push(samplePr);
      continue;
    }

    byRepo.set(row.repo_id, {
      id: row.repo_id,
      fullName: row.full_name,
      githubUrl: row.github_url,
      description: row.description,
      seniorityBand: row.seniority_band,
      detectedDomain: row.detected_domain,
      prQualityScore: row.pr_quality_score,
      stars: row.stars,
      primaryLanguage: row.primary_language,
      score,
      matchedMustSkills: [],
      matchedNiceSkills: [...overlap.concepts].filter((concept) => relevant.has(concept)).sort(),
      matchedConstructs: [],
      samplePrs: current ? [samplePr, ...current.samplePrs] : [samplePr],
      bestOverlap: overlap.overlap,
      bestQuality: row.quality_score,
    });
  }

  return [...byRepo.values()]
    .sort((left, right) =>
      right.bestOverlap - left.bestOverlap
      || right.bestQuality - left.bestQuality
      || right.score - left.score
      || left.id - right.id
    )
    .slice(0, limit)
    .map(({ bestOverlap: _bestOverlap, bestQuality: _bestQuality, ...repo }) => repo);
}

/**
 * Pick a production-ready challenge packet that overlaps persisted role
 * concepts. The packet already passed source-provenance and reviewability
 * gates during repository graph extraction.
 */
export async function pickReviewPr(
  db: D1Database,
  repoId: number,
  roleConcepts: string[],
  requiredConcepts: string[] = [],
): Promise<PickReviewPrResult | null> {
  if (roleConcepts.length === 0) return null;
  const rows = await db
    .prepare(
      `SELECT rcp.pr_number,
              rcp.quality_score,
              rcp.packet_json
         FROM review_challenge_packets rcp
         JOIN context_records cr
           ON cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
          AND cr.scope_type = 'repo_snapshot'
          AND cr.scope_id = rcp.repo_snapshot_id
          AND cr.record_type = 'repo_challenge_packet'
        WHERE rcp.repo_id = ?
          AND rcp.production_ready = 1
          AND rcp.quality_score >= 0.70
          AND (
            SELECT COUNT(*)
              FROM context_record_source_refs crsr
             WHERE crsr.context_record_id = cr.id
               AND crsr.source_ref_type = 'repo_source_span'
          ) > 0
          AND (
            SELECT COUNT(*)
              FROM context_record_concepts crc
             WHERE crc.context_record_id = cr.id
          ) > 0
        ORDER BY rcp.quality_score DESC, rcp.pr_number`,
    )
    .bind(repoId)
    .all<{ pr_number: number; quality_score: number; packet_json: string }>();

  const relevant = new Set(roleConcepts);
  const required = new Set(requiredConcepts);
  const ranked = (rows.results ?? []).flatMap((row) => {
    let packet: ChallengePacket;
    try {
      packet = JSON.parse(row.packet_json) as ChallengePacket;
    } catch {
      return [];
    }
    const concepts = packetConcepts(packet);
    if ([...required].some((concept) => !concepts.has(concept))) return [];
    const overlap = [...relevant].filter((concept) => concepts.has(concept)).length;
    if (overlap === 0) return [];
    return [{
      prNumber: row.pr_number,
      prTitle: packet.pullRequest.title,
      overlap,
      qualityScore: row.quality_score,
    }];
  }).sort((left, right) =>
    right.overlap - left.overlap
    || right.qualityScore - left.qualityScore
    || left.prNumber - right.prNumber
  );

  const selected = ranked[0];
  return selected
    ? {
        prNumber: selected.prNumber,
        prTitle: selected.prTitle,
        selectionPath: 'source_backed_role_overlap',
      }
    : null;
}

/**
 * Pick the top implementation issue for a given repo. Constraints:
 *   - issue_challenge_signals.disqualified = 0 (passed scoring gate)
 *   - repo_issues.has_merged_pr = 0 (no contamination from existing PR)
 *   - repo_issues.state_at_crawl = 'open'
 *   - repo_issues.body contains captured source text for the candidate to inspect
 *   - difficulty_band matches normalized persona seniority (or any band if
 *     persona is unknown)
 */
export async function pickImplementationIssue(
  db: D1Database,
  repoId: number,
  seniority?: 'junior' | 'mid' | 'senior' | 'staff',
): Promise<{ issueNumber: number; issueTitle: string } | null> {
  await backfillRepoImplementationIssueContextRecords(db, { repoId });

  const band = seniority === 'staff' ? 'senior' : seniority;
  const difficultyClause = band ? 'AND ics.difficulty_band = ?' : '';

  const row = await db
    .prepare(
      `SELECT ri.issue_number, ri.title
         FROM repo_issues ri
         JOIN issue_challenge_signals ics ON ics.issue_id = ri.id
        WHERE ri.repo_id = ?
          AND ri.has_merged_pr = 0
          AND ri.state_at_crawl = 'open'
          AND NULLIF(TRIM(COALESCE(ri.body, '')), '') IS NOT NULL
          AND ics.disqualified = 0
          AND EXISTS (
            SELECT 1
              FROM context_records cr
              JOIN context_record_source_refs crsr
                ON crsr.context_record_id = cr.id
             WHERE cr.record_type = 'repo_implementation_issue'
               AND cr.scope_type = 'qualified_repo'
               AND cr.scope_id = CAST(ri.repo_id AS TEXT)
               AND crsr.source_ref_type = 'repo_issue'
               AND crsr.source_ref_id = CAST(ri.id AS TEXT)
               AND crsr.exact_text IS NOT NULL
               AND crsr.content_hash IS NOT NULL
          )
          ${difficultyClause}
        ORDER BY ics.implementability_score DESC, ics.clarity_score DESC
        LIMIT 1`,
    )
    .bind(repoId, ...(band ? [band] : []))
    .first<{ issue_number: number; title: string }>();

  if (!row) return null;
  return { issueNumber: row.issue_number, issueTitle: row.title };
}

export async function autoStageBuilder(
  input: AutoStageBuilderInput,
): Promise<AutoStageBuilderResult> {
  const { db, roleContext, matchConfig } = input;
  const requestedStationTypes = new Set(
    input.requestedStationTypes?.length
      ? input.requestedStationTypes
      : ['CODE_REVIEW', 'CODE_IMPLEMENTATION'],
  );
  const includeReview = requestedStationTypes.has('CODE_REVIEW');
  const includeImplementation = requestedStationTypes.has('CODE_IMPLEMENTATION');

  if (!includeReview && !includeImplementation) {
    throw new Error('autoStageBuilder: requestedStations must include CODE_REVIEW and/or CODE_IMPLEMENTATION');
  }

  const baseRequest = buildMatchRequest(roleContext);
  const roleSemantics = await loadRoleChallengeSemantics(db, roleContextSemanticInput(roleContext));
  const roleConcepts = roleSemantics.relevantConcepts;
  const requiredConcepts = roleSemantics.requiredConcepts;

  if (
    includeReview
    && roleConcepts.length === 0
  ) {
    throw new Error(
      'autoStageBuilder: no source-backed role concepts resolvable for review station',
    );
  }
  if (
    includeImplementation
    && baseRequest.mustHaveSkills.length === 0
    && (!includeReview || matchConfig.stage_linkage === 'per-stage')
  ) {
    throw new Error(
      'autoStageBuilder: no must-have skills resolvable for implementation station',
    );
  }

  let reviewRepo: MatchedRepo | undefined;
  let implRepo: MatchedRepo | undefined;

  if (includeReview) {
    const reviewMatches = await matchReviewReposByRoleConcepts(
      db,
      roleConcepts,
      requiredConcepts,
      baseRequest.limit,
    );
    reviewRepo = reviewMatches[0];
    if (!reviewRepo) {
      throw new Error('autoStageBuilder: no candidate repos matched source-backed role evidence for review station');
    }

    if (includeImplementation && matchConfig.stage_linkage === 'per-stage') {
      const implMatches = await matchRepos(db, baseRequest);
      const top = implMatches[0];
      if (!top) {
        throw new Error(
          'autoStageBuilder: matchRepos returned no candidate repos for implementation station',
        );
      }
      implRepo = top;
    } else if (includeImplementation) {
      implRepo = reviewRepo;
    }
  } else if (includeImplementation) {
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
  const stations: AutoStation[] = [];
  const perStationRepo: AutoStageBuilderResult['perStationRepo'] = {};

  if (includeReview) {
    if (!reviewRepo) {
      throw new Error('autoStageBuilder: internal inconsistency while resolving review station');
    }

    const pr = await pickReviewPr(db, reviewRepo.id, roleConcepts, requiredConcepts);
    if (!pr) {
      throw new Error(
        `autoStageBuilder: no source-backed role-safe review challenge found for repo ${reviewRepo.fullName} (id=${reviewRepo.id})`,
      );
    }
    stations.push({
      type: 'CODE_REVIEW',
      title: `Review PR #${pr.prNumber}: ${pr.prTitle}`,
      repoId: reviewRepo.id,
      githubRepoUrl: reviewRepo.githubUrl,
      githubPrNumber: pr.prNumber,
      prTitle: pr.prTitle,
      sortOrder: 0,
    });
    perStationRepo.CODE_REVIEW = {
      repoId: reviewRepo.id,
      fullName: reviewRepo.fullName,
      score: reviewRepo.score,
    };
  }

  if (includeImplementation) {
    if (!implRepo) {
      throw new Error('autoStageBuilder: internal inconsistency while resolving implementation station');
    }
    const issue = await pickImplementationIssue(db, implRepo.id, baseRequest.seniority);
    if (!issue) {
      throw new Error(
        `autoStageBuilder: no eligible implementation issue found for repo ${implRepo.fullName} (id=${implRepo.id})`,
      );
    }
    stations.push({
      type: 'CODE_IMPLEMENTATION',
      title: `Implement issue #${issue.issueNumber}: ${issue.issueTitle}`,
      repoId: implRepo.id,
      githubRepoUrl: implRepo.githubUrl,
      issueNumber: issue.issueNumber,
      issueTitle: issue.issueTitle,
      sortOrder: includeReview ? 1 : 0,
    });
    perStationRepo.CODE_IMPLEMENTATION = {
      repoId: implRepo.id,
      fullName: implRepo.fullName,
      score: implRepo.score,
    };
  }

  const first = stations[0];
  const primaryRepo = first ?
    (first.type === 'CODE_REVIEW'
      ? reviewRepo
      : implRepo)
    : undefined;

  if (!primaryRepo || !first) {
    throw new Error('autoStageBuilder: no stations were built for this request');
  }

  const rationale =
    stations.length === 1
      ? includeReview
        ? `Matched ${reviewRepo!.fullName} (score ${reviewRepo!.score.toFixed(3)}) from source-backed role evidence for code review.`
        : `Matched ${implRepo!.fullName} (score ${implRepo!.score.toFixed(3)}) for implementation.`
      : matchConfig.stage_linkage === 'shared-repo'
        ? `Matched ${reviewRepo!.fullName} (score ${reviewRepo!.score.toFixed(3)}) from source-backed role evidence; shared across both stations.`
        : `Per-stage linkage: review on ${reviewRepo!.fullName} (score ${reviewRepo!.score.toFixed(3)}), implementation on ${implRepo!.fullName} (score ${implRepo!.score.toFixed(3)}).`;

  return {
    repoChoice: {
      repoId: primaryRepo.id,
      fullName: primaryRepo.fullName,
      rationale,
    },
    stations,
    perStationRepo,
  };
}
