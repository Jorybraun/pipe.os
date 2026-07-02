import { recordAssessmentCandidateProfileEvidence } from './assessmentLayer/candidateProfileEvidence';
import type { AssessmentEvidenceSourceRefInput } from './assessmentLayer/persistence';
import type { JsonObject } from './livingContext';
import type { ChallengePacket } from './repoSemanticGraph';
import {
  RepoTaskInterviewSessionStore,
  type AssessmentProgressSnapshot,
  type CreateRepoTaskInterviewSessionInput,
  type RecordAssessmentEventInput,
} from './repoTaskInterviewSession';

const GIT_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export interface MatchedOpenSourceChallengePacket {
  packetId: string;
  repositoryUrl: string;
  githubPrNumber: number;
  pullRequestUrl: string;
  baseCommitSha: string;
  headCommitSha: string;
  verificationCommand: string;
  title: string;
  instructions: string;
  successCriteria: string[];
  expectedEvidence: string[];
  sourceHash: string;
  repoSnapshotId: string;
  qualityScore: number | null;
  demandCount: number;
  demandFamilies: string[];
}

export interface OpenSourceChallengeSessionStore {
  createSession(input: CreateRepoTaskInterviewSessionInput): Promise<{ id: string }>;
  recordEvent(input: RecordAssessmentEventInput): Promise<unknown>;
  loadProgress(sessionId: string): Promise<AssessmentProgressSnapshot>;
}

interface MatchedOpenSourcePacketRow {
  id: string;
  repo_snapshot_id: string | null;
  pr_number: number | null;
  source_hash: string | null;
  packet_json: string;
  github_url: string | null;
  quality_score: number | null;
  context_record_id: string | null;
  repo_source_ref_count: number | null;
  concept_link_count: number | null;
}

function demandFamilyLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function packetDemands(packet: ChallengePacket): ChallengePacket['demands'] {
  return Array.isArray(packet.demands) ? packet.demands : [];
}

function packetDemandFamilies(packet: ChallengePacket): string[] {
  return Array.isArray(packet.demandFamilies)
    ? packet.demandFamilies.map((family) => String(family)).filter(Boolean)
    : [];
}

function matchedPacketInstructions(packet: ChallengePacket): string {
  const demandNarratives = packetDemands(packet)
    .slice(0, 4)
    .map((demand) => `- ${demand.narrative}`);
  return [
    `Work from the exact base commit ${packet.pullRequest.baseSha.toLowerCase()} and create a focused assessment branch.`,
    `Use the selected upstream pull request context as the source-backed task brief: ${packet.pullRequest.url}.`,
    'Implement a production-quality change that addresses the same repo demand without copying hidden ground truth.',
    ...(demandNarratives.length > 0 ? ['Source-backed demands:', ...demandNarratives] : []),
  ].join('\n');
}

function matchedPacketSuccessCriteria(packet: ChallengePacket): string[] {
  const families = packetDemandFamilies(packet).map(demandFamilyLabel).filter(Boolean);
  return [
    'The submitted commit is based on the assigned immutable base commit.',
    'The patch is focused, reviewable, and tied to the selected repo task packet.',
    'Relevant tests are run or a source-backed diagnostic explains why they could not be run.',
    ...(families.length > 0
      ? [`The solution addresses packet demands: ${families.slice(0, 4).join(', ')}.`]
      : []),
  ];
}

function matchedPacketExpectedEvidence(): string[] {
  return [
    'git_commit source ref for the submitted assessment commit',
    'code_diff source ref for the exact baseCommitSha..commitSha candidate patch',
    'terminal_command/test_run source refs for verification',
    'chat/transcript/AI source refs for explanation and AI-use behavior when present',
  ];
}

function matchedPacketVerificationCommand(): string {
  return 'git diff --check HEAD~1 HEAD && git diff --name-only HEAD~1 HEAD';
}

export function materializeMatchedOpenSourcePacket(
  row: MatchedOpenSourcePacketRow,
): MatchedOpenSourceChallengePacket | null {
  if (!row.github_url || !row.source_hash || !row.context_record_id) return null;
  if ((row.repo_source_ref_count ?? 0) <= 0 || (row.concept_link_count ?? 0) <= 0) return null;

  let packet: ChallengePacket;
  try {
    packet = JSON.parse(row.packet_json) as ChallengePacket;
  } catch {
    return null;
  }

  const baseCommitSha = packet.pullRequest?.baseSha?.toLowerCase();
  const headCommitSha = packet.pullRequest?.headSha?.toLowerCase();
  if (
    packet.id !== row.id
    || packet.contentHash !== row.source_hash
    || !baseCommitSha
    || !GIT_COMMIT_SHA_PATTERN.test(baseCommitSha)
    || !headCommitSha
    || !GIT_COMMIT_SHA_PATTERN.test(headCommitSha)
    || !packet.pullRequest?.url
    || !packet.pullRequest?.title
    || !Number.isInteger(packet.pullRequest?.number)
    || packet.pullRequest.number <= 0
    || packet.pullRequest.number !== row.pr_number
  ) {
    return null;
  }

  const demandFamilies = packetDemandFamilies(packet);
  return {
    packetId: packet.id,
    repositoryUrl: row.github_url,
    githubPrNumber: packet.pullRequest.number,
    pullRequestUrl: packet.pullRequest.url,
    baseCommitSha,
    headCommitSha,
    verificationCommand: matchedPacketVerificationCommand(),
    title: packet.pullRequest.title,
    instructions: matchedPacketInstructions(packet),
    successCriteria: matchedPacketSuccessCriteria(packet),
    expectedEvidence: matchedPacketExpectedEvidence(),
    sourceHash: row.source_hash,
    repoSnapshotId: packet.repoSnapshotId,
    qualityScore: row.quality_score,
    demandCount: packetDemands(packet).length,
    demandFamilies,
  };
}

export async function loadMatchedOpenSourceChallengePacket(
  db: D1Database,
  input: {
    matchedRepoId?: number | null;
    repositoryUrl?: string | null;
    githubPrNumber?: number | null;
  },
): Promise<MatchedOpenSourceChallengePacket | null> {
  const repositoryUrl = input.repositoryUrl?.trim() || null;
  if (typeof input.matchedRepoId !== 'number' && !repositoryUrl) return null;

  try {
    const rows = await db.prepare(
      `SELECT rcp.id,
              rcp.repo_snapshot_id,
              rcp.pr_number,
              rcp.source_hash,
              rcp.packet_json,
              rcp.quality_score,
              qr.github_url,
              cr.id AS context_record_id,
              (
                SELECT COUNT(*)
                  FROM context_record_source_refs crsr
                 WHERE crsr.context_record_id = cr.id
                   AND crsr.source_ref_type = 'repo_source_span'
              ) AS repo_source_ref_count,
              (
                SELECT COUNT(*)
                  FROM context_record_concepts crc
                 WHERE crc.context_record_id = cr.id
              ) AS concept_link_count
         FROM review_challenge_packets rcp
         JOIN qualified_repos qr ON qr.id = rcp.repo_id
         LEFT JOIN context_records cr
           ON cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
          AND cr.scope_type = 'repo_snapshot'
          AND cr.scope_id = rcp.repo_snapshot_id
          AND cr.record_type = 'repo_challenge_packet'
        WHERE (
             (?1 IS NOT NULL AND rcp.repo_id = ?1)
          OR (?2 IS NOT NULL AND qr.github_url = ?2)
        )
          AND (?3 IS NULL OR rcp.pr_number = ?3)
          AND rcp.production_ready = 1
          AND rcp.quality_score >= 0.70
        ORDER BY rcp.quality_score DESC, rcp.pr_number`,
    ).bind(
      input.matchedRepoId ?? null,
      repositoryUrl,
      input.githubPrNumber ?? null,
    ).all<MatchedOpenSourcePacketRow>();

    for (const row of rows.results ?? []) {
      const packet = materializeMatchedOpenSourcePacket(row);
      if (packet) return packet;
    }
  } catch (error) {
    console.error('[openSourceChallengeSessions] failed to load matched packet:', error instanceof Error ? error.message : String(error));
  }
  return null;
}

function buildMatchedOpenSourceChallengeExactText(
  input: MatchedOpenSourceChallengePacket,
): string {
  return [
    `Repo: ${input.repositoryUrl}`,
    `Base commit: ${input.baseCommitSha}`,
    `Pull request: #${input.githubPrNumber}`,
    `Pull request URL: ${input.pullRequestUrl}`,
    `Task: ${input.title}`,
    `Instructions: ${input.instructions}`,
    `Verification command: ${input.verificationCommand}`,
    'Success criteria:',
    ...input.successCriteria.map((criterion) => `- ${criterion}`),
    'Expected evidence:',
    ...input.expectedEvidence.map((evidence) => `- ${evidence}`),
  ].join('\n');
}

async function loadCandidateOwnerId(
  db: D1Database,
  candidateId: string | null,
): Promise<string | null> {
  if (!candidateId) return null;
  const row = await db.prepare(
    `SELECT owner_id
       FROM candidates
      WHERE id = ?1
      LIMIT 1`,
  ).bind(candidateId).first<{ owner_id: string | null }>().catch(() => null);
  return row?.owner_id?.trim() || null;
}

export async function ensureMatchedOpenSourceChallengeAssessmentSession(
  db: D1Database,
  input: {
    interviewId: string;
    candidateId: string | null;
    matchedRepoId?: number | null;
    repositoryUrl?: string | null;
    githubPrNumber?: number | null;
    userId?: string | null;
    createdAt?: string;
    sessionStore?: OpenSourceChallengeSessionStore;
    recordCandidateProfileEvidence?: typeof recordAssessmentCandidateProfileEvidence;
  },
): Promise<AssessmentProgressSnapshot | null> {
  const packet = await loadMatchedOpenSourceChallengePacket(db, {
    matchedRepoId: input.matchedRepoId,
    repositoryUrl: input.repositoryUrl,
    githubPrNumber: input.githubPrNumber,
  });
  if (!packet) return null;

  const userId = input.userId?.trim()
    || await loadCandidateOwnerId(db, input.candidateId)
    || null;
  const store = input.sessionStore ?? new RepoTaskInterviewSessionStore(db);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const matchedRepoId = input.matchedRepoId ?? null;
  const metadata: JsonObject = {
    challengePacketSource: 'matched_review_challenge_packet',
    ...(typeof matchedRepoId === 'number' ? { matchedRepoId } : {}),
    repositoryUrl: packet.repositoryUrl,
    githubPrNumber: packet.githubPrNumber,
    baseCommitSha: packet.baseCommitSha,
    verificationCommand: packet.verificationCommand,
    challengePacketId: packet.packetId,
    repoSnapshotId: packet.repoSnapshotId,
    challengeTitle: packet.title,
  };
  const session = await store.createSession({
    ingestionKey: `assessment-session:${input.interviewId}:matched-open-source-challenge:${packet.packetId}`,
    interviewId: input.interviewId,
    mode: 'OPEN_SOURCE_BUG_FIX',
    candidateId: input.candidateId,
    createdBy: userId,
    metadata,
  });
  const exactText = buildMatchedOpenSourceChallengeExactText(packet);
  const sourceRef: AssessmentEvidenceSourceRefInput = {
    sourceRefType: 'review_challenge_packet',
    sourceRefId: packet.packetId,
    evidenceRole: 'assigned_challenge',
    locator: {
      scheduledInterviewId: input.interviewId,
      ...(typeof matchedRepoId === 'number' ? { matchedRepoId } : {}),
      repositoryUrl: packet.repositoryUrl,
      githubPrNumber: packet.githubPrNumber,
      pullRequestUrl: packet.pullRequestUrl,
      baseCommitSha: packet.baseCommitSha,
      headCommitSha: packet.headCommitSha,
      verificationCommand: packet.verificationCommand,
      repoSnapshotId: packet.repoSnapshotId,
    },
    exactText,
    contentHash: packet.sourceHash,
    metadata: {
      schemaVersion: 'matched-open-source-challenge-packet-v1',
      source: 'matched_review_challenge_packet',
      qualityScore: packet.qualityScore,
      demandCount: packet.demandCount,
      demandFamilies: packet.demandFamilies,
    },
  };

  await store.recordEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:${session.id}:matched-open-source-challenge:${packet.packetId}`,
    kind: 'match_decision',
    actorType: 'system',
    actorId: 'pipe-matcher',
    narrative: 'PIPE assigned a source-backed open-source implementation challenge packet from the matched repository.',
    payload: {
      ...(typeof matchedRepoId === 'number' ? { matchedRepoId } : {}),
      repositoryUrl: packet.repositoryUrl,
      githubPrNumber: packet.githubPrNumber,
      pullRequestUrl: packet.pullRequestUrl,
      baseCommitSha: packet.baseCommitSha,
      verificationCommand: packet.verificationCommand,
      title: packet.title,
      successCriteria: packet.successCriteria,
      expectedEvidence: packet.expectedEvidence,
      challengePacketId: packet.packetId,
      repoSnapshotId: packet.repoSnapshotId,
      qualityScore: packet.qualityScore,
    },
    occurredAt: createdAt,
    sourceRefs: [sourceRef],
  });

  const recordProfile = input.recordCandidateProfileEvidence ?? recordAssessmentCandidateProfileEvidence;
  await recordProfile(db, {
    sessionId: session.id,
    candidateId: input.candidateId,
    actorId: userId ?? 'pipe-assessment',
    occurredAt: createdAt,
  });

  return store.loadProgress(session.id);
}
