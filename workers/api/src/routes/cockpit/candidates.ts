/**
 * Candidate routes — Phase 2 + Phase 3
 *
 * POST  /api/v1/pipelines/:pipelineId/candidates — create candidate with invite token
 * GET   /api/v1/candidates/:candidateId          — recruiter: full profile with submissions
 * PATCH /api/v1/candidates/:candidateId          — update (move stage, update status)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { parseResume, persistParsedCV } from '../../lib/cvParser';
import { processResumeFromR2 } from '../../lib/enrichment/resumeIngestion';
import { sendNotificationEmail } from '../../lib/email';
import { checkDealbreakersForCandidate } from '../../lib/neo4j/matchingQueries';
import { buildNeo4jConfig, createNeo4jDriver } from '../../lib/neo4j/driver';
import { buildProfileSections } from '../../lib/candidateDiscovery/buildProfileSections';
import {
  ensureCandidateLivingContext,
  loadCandidateLivingContext,
  LivingContextStore,
  searchSourceContent,
  requireGate,
} from '../../lib/livingContext';
import {
  formatMatchNarrative,
  type MatchNarrative,
} from '../../lib/challengeMatching/matchNarrative';
import type {
  MatchExplanation,
  SourceRef as MatchSourceRef,
  RoleSourceReference,
} from '../../lib/challengeMatching/types';
import {
  hasSourceBackedReviewPacket,
  loadSourceBackedReviewPacketById,
} from '../../lib/review/sourceBackedReviewDiff';
import { INTERVIEW_TYPE_VALUES } from './scheduling';
import type { JsonObject, JsonValue } from '../../lib/livingContext';
import type { Env, Variables } from '../../types';

// ─── Validation ──────────────────────────────────────────────────────────────

const createCandidateSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  email: z.string().email('valid email required'),
  currentStageId: z.string().optional(),
  skipEmail: z.boolean().optional(),
  schedulingProvider: z.enum(['CALENDLY', 'CAL_COM', 'MANUAL']).optional(),
  schedulingUrl: z.string().optional(),
});

const updateCandidateSchema = z.object({
  currentStageId: z.string().optional(),
  status: z.enum(['INVITED', 'IN_PROGRESS', 'COMPLETED']).optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  resumeS3Key: z.string().optional(),
  phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be E.164 format').optional().nullable(),
});

/** Strip dangerous HTML characters from candidate names. */
function sanitizeCandidateName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('<script') || lower.includes('javascript:')) {
    throw new Error('FORBIDDEN_PATTERN');
  }
  return name.replace(/[<>]/g, '').trim();
}

export function normalizeCandidateEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const TALENT_POOL_MEMBERSHIP_SCHEMA_BLOCKER =
  'Current D1 schema has no TalentPoolMembership table; roleless intake records membership state in workspace_people.context_json until that table exists.';

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string | null): JsonObject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as JsonValue;
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringList(value: JsonValue | undefined): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === 'string' && entry.trim() ? [entry.trim()] : [],
  );
}

function uniqueStrings(...values: string[][]): string[] {
  return [...new Set(values.flat())].sort();
}

export function buildRolelessTalentPoolContext(
  existingContext: JsonObject,
  candidateId: string,
  joinedAt: string,
): JsonObject {
  const existingTalentPool = isJsonObject(existingContext.talentPool)
    ? existingContext.talentPool
    : {};
  return {
    ...existingContext,
    source: 'roleless_candidate_intake',
    sources: uniqueStrings(
      stringList(existingContext.sources),
      stringList(existingContext.source),
      ['roleless_candidate_intake'],
    ),
    legacyCandidateIds: uniqueStrings(
      stringList(existingContext.legacyCandidateIds),
      [candidateId],
    ),
    talentPool: {
      ...existingTalentPool,
      status: 'active',
      roleless: true,
      candidateId,
      joinedAt: typeof existingTalentPool.joinedAt === 'string' ? existingTalentPool.joinedAt : joinedAt,
      membershipSchemaBlocker: TALENT_POOL_MEMBERSHIP_SCHEMA_BLOCKER,
    },
  };
}

/** Maximum file size for CV uploads: 10 MB. */
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/** MIME types accepted for CV/resume uploads. */
const ALLOWED_RESUME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

type StandaloneReviewMatchStatus =
  | 'PENDING_INTAKE'
  | 'MATCHED'
  | 'NEEDS_MORE_EVIDENCE'
  | 'NO_ROLE_SAFE_CHALLENGE';

interface StandaloneReviewSourceRef {
  artifactId: string;
  artifactVersion: string;
  contentHash: string;
  startOffset: number;
  endOffset: number;
  sourceRefType?: string;
  sourceRefId?: string;
  sourceSpanId?: string;
  locator?: string;
  exactText?: string;
}

interface StandaloneReviewRoleSource {
  entityId: string;
  locator: string;
  conceptKeys: string[];
  sourceRefType?: string;
  sourceRefId?: string;
  sourceSpanId?: string;
  exactText?: string;
  contentHash?: string;
}

interface StandaloneReviewStretchArea {
  atomId: string;
  demandId: string;
  atomConcept: string;
  demandConcept: string;
  dimension: string;
  candidateSourceRefs: StandaloneReviewSourceRef[];
  challengeSourceRefs: StandaloneReviewSourceRef[];
}

interface StandaloneReviewAlignment {
  atomId: string;
  demandId: string;
  purpose: string | null;
  pairScore: number;
  sharedConcepts: string[];
  stretch: { dimension: string; atomConcept: string; demandConcept: string } | null;
  roleSourceRefs: StandaloneReviewRoleSource[];
  candidateSourceRefs: StandaloneReviewSourceRef[];
  challengeSourceRefs: StandaloneReviewSourceRef[];
}

interface StandaloneReviewRankedResult {
  rank: number | null;
  recallRank: number | null;
  challengeId: string;
  repoId: string;
  prNumber: number;
  score: number;
  alignedDemandCount: number;
  stretchCount: number;
  provenanceComplete: boolean;
  eligible: boolean;
  alignments: StandaloneReviewAlignment[];
  stretchAreas: StandaloneReviewStretchArea[];
  unmatchedDemandIds: string[];
  rejectionReasons: string[];
}

interface StandaloneReviewMatchNarrative {
  title: string;
  verdict: string;
  sections: Array<{ heading: string; items: string[] }>;
  plainText: string;
}

function toMatchSourceRef(ref: StandaloneReviewSourceRef): MatchSourceRef {
  return {
    artifactId: ref.artifactId,
    artifactVersion: ref.artifactVersion,
    contentHash: ref.contentHash,
    startOffset: ref.startOffset,
    endOffset: ref.endOffset,
    sourceRefType: ref.sourceRefType,
    sourceRefId: ref.sourceRefId,
    sourceSpanId: ref.sourceSpanId,
    locator: ref.locator,
    exactText: ref.exactText,
  };
}

function toRoleSourceReference(ref: StandaloneReviewRoleSource): RoleSourceReference {
  return {
    entityId: ref.entityId,
    locator: ref.locator,
    conceptKeys: ref.conceptKeys,
    sourceRefType: ref.sourceRefType,
    sourceRefId: ref.sourceRefId,
    sourceSpanId: ref.sourceSpanId,
    exactText: ref.exactText,
    contentHash: ref.contentHash,
  };
}

function buildNarrativeFromResult(
  matchStatus: StandaloneReviewMatchStatus,
  result: StandaloneReviewRankedResult | null,
  gaps: string[],
): StandaloneReviewMatchNarrative | null {
  if (!result && matchStatus === 'PENDING_INTAKE') return null;
  const status: MatchExplanation['status'] = matchStatus === 'PENDING_INTAKE'
    ? 'NEEDS_MORE_EVIDENCE'
    : matchStatus;
  const explanation: MatchExplanation = {
    status,
    challengeId: result?.challengeId,
    repoId: result?.repoId,
    prNumber: result?.prNumber,
    score: result?.score ?? 0,
    summary: '',
    evidence: (result?.alignments ?? []).map((a) => ({
      atomId: a.atomId,
      demandId: a.demandId,
      purpose: (a.purpose ?? 'validation') as 'validation' | 'deepening',
      pairScore: a.pairScore,
      episodeMultiplier: 1,
      stretch: a.stretch
        ? { atomConcept: a.stretch.atomConcept, demandConcept: a.stretch.demandConcept, dimension: a.stretch.dimension as 'technology' | 'mechanism' | 'domain' | 'scale' | 'review_practice' }
        : undefined,
      roleSourceRefs: a.roleSourceRefs.map(toRoleSourceReference),
      candidateSourceRefs: a.candidateSourceRefs.map(toMatchSourceRef),
      challengeSourceRefs: a.challengeSourceRefs.map(toMatchSourceRef),
    })),
    candidateSpans: [],
    repoSpans: [],
    roleSources: [],
    rejectedPackets: [],
    missingEvidence: gaps.map((reason) => ({ scope: 'candidate' as const, reason })),
    stretchAreas: (result?.stretchAreas ?? []).map((s) => ({
      atomId: s.atomId,
      demandId: s.demandId,
      atomConcept: s.atomConcept,
      demandConcept: s.demandConcept,
      dimension: s.dimension as 'technology' | 'mechanism' | 'domain' | 'scale' | 'review_practice',
      candidateSourceRefs: s.candidateSourceRefs.map(toMatchSourceRef),
      challengeSourceRefs: s.challengeSourceRefs.map(toMatchSourceRef),
    })),
    unmatchedDemandIds: result?.unmatchedDemandIds ?? [],
    rejectionReasons: result?.rejectionReasons ?? [],
  };
  const narrative = formatMatchNarrative(explanation);
  return {
    title: narrative.title,
    verdict: narrative.verdict,
    sections: narrative.sections,
    plainText: narrative.plainText,
  };
}

interface StandaloneReviewPacketMetadata {
  repoId: number | null;
  repoName: string | null;
  repoUrl: string | null;
  prNumber: number | null;
  prUrl: string | null;
  prTitle: string | null;
}

interface StandaloneReviewPacketDemand {
  id: string;
  family: string;
  narrative: string;
  conceptKeys: string[];
  sourceSpanIds: string[];
  changedSymbolIds: string[];
  weight: number;
}

interface StandaloneReviewPacketTestChange {
  path: string;
  framework: string | null;
  sourceSpanIds: string[];
  relatedSymbolIds: string[];
}

interface StandaloneReviewPacketIssue {
  number: number;
  title: string;
  labels: string[];
  sourceSpanIds: string[];
}

interface StandaloneReviewPacketQualityGate {
  gate: string;
  passed: boolean;
  reason: string;
}

interface StandaloneReviewPacketQuality {
  score: number;
  eligible: boolean;
  metrics: {
    provenanceCoverage: number;
    reviewableSize: number;
    testCoverage: number;
    issueContext: number;
    demandDiversity: number;
  };
  gates: StandaloneReviewPacketQualityGate[];
}

interface StandaloneReviewPacketDetail {
  packetId: string;
  changedFilePaths: string[];
  changedSymbolIds: string[];
  sourceSpanIds: string[];
  demandFamilies: string[];
  demands: StandaloneReviewPacketDemand[];
  testChanges: StandaloneReviewPacketTestChange[];
  issue: StandaloneReviewPacketIssue | null;
  quality: StandaloneReviewPacketQuality | null;
}

export type StandaloneReviewExclusionReason =
  | 'DEMAND_WITHOUT_SOURCE_SPANS'
  | 'MISSING_DEMAND_SOURCE_SPANS'
  | 'ROLE_GUARDRAIL_FAILED'
  | 'PACKET_NOT_PRODUCTION_READY'
  | 'PACKET_PROVENANCE_INVALID'
  | 'PACKET_CONTEXT_PROJECTION_INCOMPLETE';

export interface StandaloneReviewExcludedPacket {
  id: string;
  repoId: string | null;
  prNumber: number | null;
  reason: StandaloneReviewExclusionReason;
  demandIds: string[];
  missingSourceSpanIds: string[];
  gateFailures: string[];
  provenanceFailures: string[];
  contextProjectionFailures: string[];
  qualityScore: number | null;
}

export interface StandaloneReviewEvaluatedChallenge {
  challengeId: string;
  repoId: string;
  prNumber: number;
  recallRank: number | null;
  rank: number | null;
  eligible: boolean;
  rejectionReasons: string[];
  provenanceComplete: boolean;
  alignedDemandCount: number;
  stretchCount: number;
}

export interface StandaloneReviewDiagnostics {
  recalledPacketIds: string[];
  excludedPackets: StandaloneReviewExcludedPacket[];
  evaluatedChallenges: StandaloneReviewEvaluatedChallenge[];
}

export interface StandaloneReviewMatchSummary {
  summary: string;
  evidence: StandaloneReviewAlignment[];
  gaps: string[];
}

export interface StandaloneReviewSubmissionSummary {
  verdict: string | null;
  summary: string | null;
  annotationCount: number;
  annotations: Array<{
    file: string | null;
    line: number | null;
    severity: string | null;
    comment: string;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseReviewAnnotations(value: unknown): StandaloneReviewSubmissionSummary['annotations'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((annotation) => {
    if (!isRecord(annotation)) return [];
    const comment = asOptionalString(annotation.comment) ?? asOptionalString(annotation.what);
    if (!comment) return [];
    return [{
      file: asOptionalString(annotation.file),
      line: typeof annotation.line === 'number' ? annotation.line : null,
      severity: asOptionalString(annotation.severity),
      comment,
    }];
  });
}

function parseReviewTranscriptAnnotations(value: unknown): StandaloneReviewSubmissionSummary['annotations'] {
  if (!isRecord(value) || !Array.isArray(value.rounds)) return [];
  return value.rounds.flatMap((round) => {
    if (!isRecord(round)) return [];
    return parseReviewAnnotations(round.reviewer_comments);
  });
}

function parseReviewVerdict(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (isRecord(value)) {
    return asOptionalString(value.decision);
  }
  return null;
}

export function parseStandaloneReviewSubmissionSummary(
  value: string | null,
): StandaloneReviewSubmissionSummary | null {
  if (!value) return null;
  let parsed: unknown = value;
  for (let depth = 0; depth < 2 && typeof parsed === 'string'; depth += 1) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;

  const transcript = isRecord(parsed.transcript) ? parsed.transcript : parsed;
  const transcriptVerdict = isRecord(transcript) ? transcript.verdict : null;
  const annotations = parseReviewAnnotations(parsed.annotations);
  const transcriptAnnotations = annotations.length > 0
    ? annotations
    : parseReviewTranscriptAnnotations(transcript);

  return {
    verdict: asOptionalString(parsed.verdict) ?? parseReviewVerdict(transcriptVerdict),
    summary: asOptionalString(parsed.summary)
      ?? (isRecord(transcriptVerdict) ? asOptionalString(transcriptVerdict.summary) : null),
    annotationCount: transcriptAnnotations.length,
    annotations: transcriptAnnotations.slice(0, 3),
  };
}

function parseStandaloneReviewSessionId(value: string | null): string | null {
  if (!value) return null;
  let parsed: unknown = value;
  for (let depth = 0; depth < 2 && typeof parsed === 'string'; depth += 1) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return isRecord(parsed) ? asOptionalString(parsed.reviewSessionId) : null;
}

async function loadStandaloneReviewSubmissionSummary(
  db: D1Database,
  candidateId: string,
  submissionJson: string | null,
): Promise<StandaloneReviewSubmissionSummary | null> {
  const directSummary = parseStandaloneReviewSubmissionSummary(submissionJson);
  if (
    directSummary
    && (directSummary.verdict || directSummary.summary || directSummary.annotationCount > 0)
  ) {
    return directSummary;
  }

  const reviewSessionId = parseStandaloneReviewSessionId(submissionJson);
  if (!reviewSessionId) {
    return directSummary;
  }

  const session = await db.prepare(
    `SELECT transcript
       FROM review_sessions
      WHERE id = ?1
        AND candidate_id = ?2
      LIMIT 1`,
  ).bind(reviewSessionId, candidateId).first<{ transcript: string | null }>();

  return parseStandaloneReviewSubmissionSummary(session?.transcript ?? null) ?? directSummary;
}

function parseStandaloneReviewSourceRefs(value: unknown): StandaloneReviewSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const artifactId = item.artifactId;
    const artifactVersion = item.artifactVersion;
    const contentHash = item.contentHash;
    const startOffset = item.startOffset;
    const endOffset = item.endOffset;
    if (
      typeof artifactId !== 'string'
      || typeof artifactVersion !== 'string'
      || typeof contentHash !== 'string'
      || typeof startOffset !== 'number'
      || typeof endOffset !== 'number'
    ) {
      return [];
    }
    const sourceRefType = typeof item.sourceRefType === 'string' ? item.sourceRefType : undefined;
    const sourceRefId = typeof item.sourceRefId === 'string' ? item.sourceRefId : undefined;
    const sourceSpanId = typeof item.sourceSpanId === 'string' ? item.sourceSpanId : undefined;
    const locator = typeof item.locator === 'string' ? item.locator : undefined;
    const exactText = typeof item.exactText === 'string' ? item.exactText : undefined;
    return [{
      artifactId,
      artifactVersion,
      contentHash,
      startOffset,
      endOffset,
      sourceRefType,
      sourceRefId,
      sourceSpanId,
      locator,
      exactText,
    }];
  });
}

function parseStandaloneReviewRoleSources(value: unknown): StandaloneReviewRoleSource[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Map<string, StandaloneReviewRoleSource>();
  for (const source of value) {
    if (!isRecord(source)) continue;
    const { entityId, locator } = source;
    if (typeof entityId !== 'string' || typeof locator !== 'string') continue;
    const roleSource: StandaloneReviewRoleSource = {
      entityId,
      locator,
      conceptKeys: [...new Set(asStringArray(source.conceptKeys))].sort(),
    };
    if (typeof source.sourceRefType === 'string') roleSource.sourceRefType = source.sourceRefType;
    if (typeof source.sourceRefId === 'string') roleSource.sourceRefId = source.sourceRefId;
    if (typeof source.sourceSpanId === 'string') roleSource.sourceSpanId = source.sourceSpanId;
    if (typeof source.exactText === 'string') roleSource.exactText = source.exactText;
    if (typeof source.contentHash === 'string') roleSource.contentHash = source.contentHash;
    deduped.set(JSON.stringify(roleSource), roleSource);
  }
  return [...deduped.values()].sort((left, right) =>
    left.entityId.localeCompare(right.entityId)
    || left.locator.localeCompare(right.locator)
  );
}

function parseStandaloneReviewRoleSourcesFromQuery(value: string | null): StandaloneReviewRoleSource[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.roleGuardrails)) return [];
  return parseStandaloneReviewRoleSources(parsed.roleGuardrails.sourceReferences);
}

function roleSourcesForSharedConcepts(
  roleSources: StandaloneReviewRoleSource[],
  sharedConcepts: string[],
): StandaloneReviewRoleSource[] {
  if (roleSources.length === 0 || sharedConcepts.length === 0) return [];
  const shared = new Set(sharedConcepts);
  return roleSources.filter((source) =>
    source.conceptKeys.some((conceptKey) => shared.has(conceptKey))
  );
}

function parseStandaloneReviewRankedResults(
  value: string | null,
  fallbackRoleSources: StandaloneReviewRoleSource[] = [],
): StandaloneReviewRankedResult[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!isRecord(item)) return [];
    const challengeId = item.challengeId;
    const repoId = item.repoId;
    const prNumber = item.prNumber;
    const score = item.score;
    const alignedDemandCount = item.alignedDemandCount;
    const stretchCount = item.stretchCount;
    const provenanceComplete = item.provenanceComplete;
    const eligible = item.eligible;
    if (
      typeof challengeId !== 'string'
      || typeof repoId !== 'string'
      || typeof prNumber !== 'number'
      || typeof score !== 'number'
      || typeof alignedDemandCount !== 'number'
      || typeof stretchCount !== 'number'
      || typeof provenanceComplete !== 'boolean'
      || typeof eligible !== 'boolean'
    ) {
      return [];
    }
    const rank = typeof item.rank === 'number' ? item.rank : null;
    const recallRank = typeof item.recallRank === 'number' ? item.recallRank : null;
    const alignments = Array.isArray(item.alignments)
      ? item.alignments.flatMap((alignment) => {
          if (!isRecord(alignment)) return [];
          const atomId = alignment.atomId;
          const demandId = alignment.demandId;
          const pairScore = alignment.pairScore;
          if (
            typeof atomId !== 'string'
            || typeof demandId !== 'string'
            || typeof pairScore !== 'number'
          ) {
            return [];
          }
          const sharedConcepts = asStringArray(alignment.sharedConcepts);
          const hasPersistedRoleSourceRefs = Array.isArray(alignment.roleSourceRefs);
          const stretchRaw = isRecord(alignment.stretch) ? alignment.stretch : null;
          const stretch = stretchRaw
            && typeof stretchRaw.dimension === 'string'
            && typeof stretchRaw.atomConcept === 'string'
            && typeof stretchRaw.demandConcept === 'string'
            ? { dimension: stretchRaw.dimension, atomConcept: stretchRaw.atomConcept, demandConcept: stretchRaw.demandConcept }
            : null;
          return [{
            atomId,
            demandId,
            purpose: typeof alignment.purpose === 'string' ? alignment.purpose : null,
            pairScore,
            sharedConcepts,
            stretch,
            roleSourceRefs: hasPersistedRoleSourceRefs
              ? parseStandaloneReviewRoleSources(alignment.roleSourceRefs)
              : roleSourcesForSharedConcepts(fallbackRoleSources, sharedConcepts),
            candidateSourceRefs: parseStandaloneReviewSourceRefs(alignment.candidateSourceRefs),
            challengeSourceRefs: parseStandaloneReviewSourceRefs(alignment.challengeSourceRefs),
          }];
        })
      : [];
    const stretchAreas: StandaloneReviewStretchArea[] = alignments
      .filter((entry): entry is StandaloneReviewAlignment & { stretch: NonNullable<StandaloneReviewAlignment['stretch']> } =>
        entry.stretch !== null)
      .map((entry) => ({
        atomId: entry.atomId,
        demandId: entry.demandId,
        atomConcept: entry.stretch.atomConcept,
        demandConcept: entry.stretch.demandConcept,
        dimension: entry.stretch.dimension,
        candidateSourceRefs: entry.candidateSourceRefs,
        challengeSourceRefs: entry.challengeSourceRefs,
      }));
    return [{
      rank,
      recallRank,
      challengeId,
      repoId,
      prNumber,
      score,
      alignedDemandCount,
      stretchCount,
      provenanceComplete,
      eligible,
      alignments,
      stretchAreas,
      unmatchedDemandIds: asStringArray(item.unmatchedDemandIds),
      rejectionReasons: asStringArray(item.rejectionReasons),
    }];
  });
}

function parseStandaloneReviewPacketMetadata(
  row: { repo_id: number | null; pr_number: number | null; packet_json: string | null } | null,
): StandaloneReviewPacketMetadata | null {
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = row.packet_json ? JSON.parse(row.packet_json) : null;
  } catch {
    parsed = null;
  }

  const packet = isRecord(parsed) ? parsed : {};
  const repository = isRecord(packet.repository) ? packet.repository : {};
  const pullRequest = isRecord(packet.pullRequest) ? packet.pullRequest : {};
  const repoOwner = asOptionalString(repository.owner);
  const repoName = asOptionalString(repository.name);
  const packetPrNumber = typeof pullRequest.number === 'number' ? pullRequest.number : null;

  return {
    repoId: typeof row.repo_id === 'number' ? row.repo_id : null,
    repoName: repoOwner && repoName ? `${repoOwner}/${repoName}` : null,
    repoUrl: asOptionalString(repository.canonicalUrl),
    prNumber: typeof row.pr_number === 'number' ? row.pr_number : packetPrNumber,
    prUrl: asOptionalString(pullRequest.url),
    prTitle: asOptionalString(pullRequest.title),
  };
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseStandaloneReviewPacketDemand(item: unknown): StandaloneReviewPacketDemand[] {
  if (!isRecord(item) || typeof item.id !== 'string' || typeof item.family !== 'string') return [];
  return [{
    id: item.id,
    family: item.family,
    narrative: asOptionalString(item.narrative) ?? '',
    conceptKeys: asStringArray(item.conceptKeys),
    sourceSpanIds: asStringArray(item.sourceSpanIds),
    changedSymbolIds: asStringArray(item.changedSymbolIds),
    weight: asOptionalNumber(item.weight) ?? 0,
  }];
}

function parseStandaloneReviewPacketTestChange(item: unknown): StandaloneReviewPacketTestChange[] {
  if (!isRecord(item) || typeof item.path !== 'string') return [];
  return [{
    path: item.path,
    framework: asOptionalString(item.framework),
    sourceSpanIds: asStringArray(item.sourceSpanIds),
    relatedSymbolIds: asStringArray(item.relatedSymbolIds),
  }];
}

function parseStandaloneReviewPacketQuality(value: unknown): StandaloneReviewPacketQuality | null {
  if (!isRecord(value)) return null;
  const metricsRecord = isRecord(value.metrics) ? value.metrics : {};
  const gates = Array.isArray(value.gates)
    ? value.gates.flatMap((gate): StandaloneReviewPacketQualityGate[] => {
        if (!isRecord(gate) || typeof gate.gate !== 'string') return [];
        return [{
          gate: gate.gate,
          passed: gate.passed === true,
          reason: asOptionalString(gate.reason) ?? '',
        }];
      })
    : [];
  return {
    score: asOptionalNumber(value.score) ?? 0,
    eligible: value.eligible === true,
    metrics: {
      provenanceCoverage: asOptionalNumber(metricsRecord.provenanceCoverage) ?? 0,
      reviewableSize: asOptionalNumber(metricsRecord.reviewableSize) ?? 0,
      testCoverage: asOptionalNumber(metricsRecord.testCoverage) ?? 0,
      issueContext: asOptionalNumber(metricsRecord.issueContext) ?? 0,
      demandDiversity: asOptionalNumber(metricsRecord.demandDiversity) ?? 0,
    },
    gates,
  };
}

function parseStandaloneReviewPacketDetail(
  packetId: string | null,
  row: { packet_json: string | null } | null,
): StandaloneReviewPacketDetail | null {
  if (!row || !row.packet_json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.packet_json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const demands = Array.isArray(parsed.demands)
    ? parsed.demands.flatMap(parseStandaloneReviewPacketDemand)
    : [];
  const testChanges = Array.isArray(parsed.testChanges)
    ? parsed.testChanges.flatMap(parseStandaloneReviewPacketTestChange)
    : [];
  const issueRecord = isRecord(parsed.issue) && typeof parsed.issue.number === 'number'
    ? {
        number: parsed.issue.number,
        title: asOptionalString(parsed.issue.title) ?? '',
        labels: asStringArray(parsed.issue.labels),
        sourceSpanIds: asStringArray(parsed.issue.sourceSpanIds),
      }
    : null;
  return {
    packetId: packetId ?? asOptionalString(parsed.id) ?? '',
    changedFilePaths: asStringArray(parsed.changedFilePaths),
    changedSymbolIds: asStringArray(parsed.changedSymbolIds),
    sourceSpanIds: asStringArray(parsed.sourceSpanIds),
    demandFamilies: asStringArray(parsed.demandFamilies),
    demands,
    testChanges,
    issue: issueRecord,
    quality: parseStandaloneReviewPacketQuality(parsed.quality),
  };
}

function parseStandaloneReviewRecalledPacketIds(value: string | null): string[] {
  if (!value) return [];
  try {
    return asStringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseStandaloneReviewExcludedPackets(value: string | null): StandaloneReviewExcludedPacket[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.reason !== 'string') return [];
    if (
      item.reason !== 'DEMAND_WITHOUT_SOURCE_SPANS'
      && item.reason !== 'MISSING_DEMAND_SOURCE_SPANS'
      && item.reason !== 'ROLE_GUARDRAIL_FAILED'
      && item.reason !== 'PACKET_NOT_PRODUCTION_READY'
      && item.reason !== 'PACKET_PROVENANCE_INVALID'
      && item.reason !== 'PACKET_CONTEXT_PROJECTION_INCOMPLETE'
    ) {
      return [];
    }
    return [{
      id: item.id,
      repoId: typeof item.repoId === 'string' ? item.repoId : null,
      prNumber: typeof item.prNumber === 'number' ? item.prNumber : null,
      reason: item.reason,
      demandIds: asStringArray(item.demandIds),
      missingSourceSpanIds: asStringArray(item.missingSourceSpanIds),
      gateFailures: asStringArray(item.gateFailures),
      provenanceFailures: asStringArray(item.provenanceFailures),
      contextProjectionFailures: asStringArray(item.contextProjectionFailures),
      qualityScore: typeof item.qualityScore === 'number' ? item.qualityScore : null,
    }];
  });
}

function buildStandaloneReviewEvaluatedChallenges(
  rankedResults: StandaloneReviewRankedResult[],
): StandaloneReviewEvaluatedChallenge[] {
  return rankedResults.map((result) => ({
    challengeId: result.challengeId,
    repoId: result.repoId,
    prNumber: result.prNumber,
    recallRank: result.recallRank,
    rank: result.eligible ? result.rank : null,
    eligible: result.eligible,
    rejectionReasons: result.rejectionReasons,
    provenanceComplete: result.provenanceComplete,
    alignedDemandCount: result.alignedDemandCount,
    stretchCount: result.stretchCount,
  }));
}

export function buildStandaloneReviewDiagnostics(
  recalledPacketsJson: string | null,
  excludedPacketsJson: string | null,
  rankedResults: StandaloneReviewRankedResult[],
): StandaloneReviewDiagnostics {
  return {
    recalledPacketIds: parseStandaloneReviewRecalledPacketIds(recalledPacketsJson),
    excludedPackets: parseStandaloneReviewExcludedPackets(excludedPacketsJson),
    evaluatedChallenges: buildStandaloneReviewEvaluatedChallenges(rankedResults),
  };
}

function standaloneReviewExclusionGap(packet: StandaloneReviewExcludedPacket): string {
  if (packet.reason === 'ROLE_GUARDRAIL_FAILED') {
    return `${packet.id} did not satisfy the job-description guardrails.`;
  }
  if (packet.reason === 'PACKET_NOT_PRODUCTION_READY') {
    const scoreSuffix = packet.qualityScore !== null
      ? ` Quality score: ${packet.qualityScore.toFixed(2)}.`
      : '';
    const gateSuffix = packet.gateFailures.length
      ? ` Failed gate${packet.gateFailures.length === 1 ? '' : 's'}: ${packet.gateFailures.join(', ')}.`
      : '';
    return `${packet.id} was excluded because its repo packet is not production-ready.${scoreSuffix}${gateSuffix}`;
  }
  if (packet.reason === 'PACKET_PROVENANCE_INVALID') {
    const failureSuffix = packet.provenanceFailures.length
      ? ` ${packet.provenanceFailures.slice(0, 3).join(' ')}`
      : '';
    return `${packet.id} was excluded because its repo packet provenance is invalid.${failureSuffix}`;
  }
  if (packet.reason === 'PACKET_CONTEXT_PROJECTION_INCOMPLETE') {
    const failureSuffix = packet.contextProjectionFailures.length
      ? ` ${packet.contextProjectionFailures.slice(0, 3).join(' ')}`
      : '';
    return `${packet.id} was excluded because its repo packet is missing source-backed graph context.${failureSuffix}`;
  }
  const demandSuffix = packet.demandIds.length
    ? ` Demand${packet.demandIds.length === 1 ? '' : 's'}: ${packet.demandIds.join(', ')}.`
    : '';
  if (packet.reason === 'DEMAND_WITHOUT_SOURCE_SPANS') {
    return `${packet.id} was excluded because one or more PR demands have no source span provenance.${demandSuffix}`;
  }
  const missingSuffix = packet.missingSourceSpanIds.length
    ? ` Missing span${packet.missingSourceSpanIds.length === 1 ? '' : 's'}: ${packet.missingSourceSpanIds.join(', ')}.`
    : '';
  return `${packet.id} was excluded because PR demand provenance references missing repo source spans.${demandSuffix}${missingSuffix}`;
}

export function buildStandaloneReviewMatchSummary(
  status: StandaloneReviewMatchStatus,
  selectedResult: StandaloneReviewRankedResult | null,
  diagnostics?: StandaloneReviewDiagnostics,
): StandaloneReviewMatchSummary {
  if (status === 'PENDING_INTAKE') {
    return {
      summary: 'Waiting for candidate resume/profile evidence before matching to a PR.',
      evidence: [],
      gaps: ['Candidate has not submitted source evidence yet.'],
    };
  }
  if (status === 'NEEDS_MORE_EVIDENCE') {
    return {
      summary: 'No deterministic challenge can be selected until more candidate evidence is available.',
      evidence: [],
      gaps: ['Candidate graph has no sufficient source-backed validation or deepening atoms.'],
    };
  }
  if (status === 'NO_ROLE_SAFE_CHALLENGE') {
    const diagnosticGaps = diagnostics?.excludedPackets.map(standaloneReviewExclusionGap) ?? [];
    return {
      summary: 'Matcher found candidate evidence, but no reviewable PR passed guardrails.',
      evidence: selectedResult?.alignments ?? [],
      gaps: [
        ...(selectedResult?.rejectionReasons ?? []),
        ...diagnosticGaps,
      ].length
        ? [
            ...(selectedResult?.rejectionReasons ?? []),
            ...diagnosticGaps,
          ]
        : ['No eligible challenge had complete provenance and non-generic alignment.'],
    };
  }
  return {
    summary: selectedResult
      ? `Matched ${selectedResult.alignedDemandCount} source-backed demand${selectedResult.alignedDemandCount === 1 ? '' : 's'} (${selectedResult.stretchCount} stretch).`
      : 'Matched to a reviewable PR challenge.',
    evidence: selectedResult?.alignments ?? [],
    gaps: selectedResult?.rejectionReasons ?? [],
  };
}

// ─── Pipeline-scoped routes ──────────────────────────────────────────────────

const pipelineCandidates = new Hono<{ Bindings: Env; Variables: Variables }>();
pipelineCandidates.use('*', authMiddleware);

// POST /:pipelineId/candidates
pipelineCandidates.post('/:pipelineId/candidates', async (c) => {
  const userId = c.var.userId;
  const { pipelineId } = c.req.param();
  const db = c.env.DB;

  // Ownership check — fetch title for email
  const pipeline = await db
    .prepare('SELECT id, title FROM pipelines WHERE id = ? AND owner_id = ?')
    .bind(pipelineId, userId)
    .first<{ id: string; title: string }>();
  if (!pipeline) return apiError(c, 'NOT_FOUND', 'Pipeline not found.');

  const body = await c.req.json();
  const parsed = createCandidateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  let { name, email, currentStageId: requestedStageId, skipEmail, schedulingProvider, schedulingUrl } = parsed.data;
  try {
    name = sanitizeCandidateName(name);
    email = normalizeCandidateEmail(email);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'FORBIDDEN_PATTERN') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Name contains forbidden pattern' } }, 400);
    }
    return apiError(c, 'VALIDATION_ERROR', 'Name contains invalid characters');
  }

  // Duplicate-email guard for this pipeline
  const existing = await db
    .prepare('SELECT id FROM candidates WHERE pipeline_id = ? AND email = ?')
    .bind(pipelineId, email)
    .first<{ id: string }>();
  if (existing) {
    return apiError(c, 'CONFLICT', 'Email already exists in this pipeline');
  }

  const id = crypto.randomUUID();
  const inviteToken = crypto.randomUUID();
  const now = new Date().toISOString();
  let scheduledInterview: { id: string; status: string; meetingUrl: string | null } | null = null;

  // Use requested stage or fall back to first stage
  let stageId = requestedStageId ?? null;
  if (!stageId) {
    const firstStage = await db
      .prepare(
        'SELECT id FROM stages WHERE pipeline_id = ? ORDER BY sort_order ASC LIMIT 1'
      )
      .bind(pipelineId)
      .first();
    stageId = (firstStage?.id as string) ?? null;
  }

  try {
    await db
      .prepare(
        `INSERT INTO candidates (id, pipeline_id, owner_id, name, email, invite_token, status, current_stage_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'INVITED', ?, ?, ?)`
      )
      .bind(id, pipelineId, userId, name, email, inviteToken, stageId, now, now)
      .run();

    // Ensure ingestion tracking row exists so post-screener enrichment can update it
    await db
      .prepare(
        `INSERT INTO candidate_ingestion (candidate_id, status, created_at, updated_at)
         VALUES (?1, 'pending', ?2, ?2)
         ON CONFLICT(candidate_id) DO NOTHING`
      )
      .bind(id, now)
      .run();

    await ensureCandidateLivingContext(db, id);

    // Create scheduled_interviews row for scheduled/LIVE_VIDEO stages
    if (stageId) {
      const stageCheck = await db
        .prepare('SELECT mode, is_scheduled FROM stages WHERE id = ?')
        .bind(stageId)
        .first<{ mode: string | null; is_scheduled: number | null }>();

      if (stageCheck?.is_scheduled || stageCheck?.mode === 'LIVE_VIDEO') {
        const interviewId = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO scheduled_interviews (id, candidate_id, pipeline_id, stage_id, owner_id, status, scheduling_provider, scheduling_url, sync_source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'INVITED', ?, ?, 'MANUAL', ?, ?)`
          )
          .bind(interviewId, id, pipelineId, stageId, userId, schedulingProvider ?? null, schedulingUrl ?? null, now, now)
          .run();
        scheduledInterview = { id: interviewId, status: 'INVITED', meetingUrl: null };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE constraint failed') || msg.includes('idx_candidates_pipeline_email')) {
      return apiError(c, 'CONFLICT', 'Email already exists in this pipeline');
    }
    throw err;
  }

  // Fire-and-forget assessment email for non-scheduled stages. Scheduled
  // interviews use /scheduling/interviews/:id/invite so room links, email
  // delivery, and living-context evidence stay on one canonical path.
  if (c.env.RESEND_API_KEY && !skipEmail && !scheduledInterview) {
    const baseUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';
    const assessUrl = `${baseUrl}/assess/${inviteToken}`;

    // Fetch stage info (mode, templates) and scheduling connection for booking URL
    let stageTemplatesJson: string | null = null;
    let bookingUrl: string | undefined;
    let stageName: string | undefined;

    if (stageId) {
      const stageRow = await db
        .prepare('SELECT title, mode, notification_templates, is_scheduled, scheduling_event_type_id FROM stages WHERE id = ?')
        .bind(stageId)
        .first<{ title: string; mode: string | null; notification_templates: string | null; is_scheduled: number | null; scheduling_event_type_id: string | null }>();
      stageTemplatesJson = stageRow?.notification_templates ?? null;
      stageName = stageRow?.title;

      // If stage is scheduled (LIVE_VIDEO or is_scheduled flag), look up booking URL
      console.log('[candidates] Stage check:', { is_scheduled: stageRow?.is_scheduled, mode: stageRow?.mode, scheduling_event_type_id: stageRow?.scheduling_event_type_id });
      if (stageRow?.is_scheduled || stageRow?.mode === 'LIVE_VIDEO') {
        // Use provided schedulingUrl if available (from frontend Calendly selection)
        if (schedulingUrl) {
          bookingUrl = schedulingUrl;
          console.log('[candidates] Using provided scheduling URL:', bookingUrl);
        } else {
          // Fallback to existing logic: fetch from Calendly
          const conn = await db
            .prepare(
              `SELECT access_token, provider_id FROM scheduling_connections
               WHERE owner_id = ? AND status = 'ACTIVE' LIMIT 1`
            )
            .bind(userId)
            .first<{ access_token: string; provider_id: string }>();

          console.log('[candidates] Scheduling connection:', { found: !!conn, provider: conn?.provider_id });
          if (conn && conn.provider_id === 'CALENDLY') {
            try {
              // Use stage-specific event type or fetch the first available one
              const eventTypeUri = stageRow.scheduling_event_type_id;
              if (eventTypeUri) {
                console.log('[candidates] Fetching event type:', eventTypeUri);
                const etRes = await fetch(eventTypeUri, {
                  headers: { Authorization: `Bearer ${conn.access_token}` },
                });
                console.log('[candidates] Event type response:', { status: etRes.status });
                if (etRes.ok) {
                  const etData = await etRes.json() as { resource?: { scheduling_url?: string } };
                  console.log('[candidates] Event type scheduling_url:', etData.resource?.scheduling_url);
                  bookingUrl = etData.resource?.scheduling_url;
                } else {
                  const errText = await etRes.text();
                  console.error('[candidates] Event type fetch failed:', errText);
                }
              } else {
                // No event type configured — use first available from the account
                console.log('[candidates] No event type configured, using fallback');
                const userRes = await fetch('https://api.calendly.com/users/me', {
                  headers: { Authorization: `Bearer ${conn.access_token}` },
                });
                console.log('[candidates] /users/me response:', { status: userRes.status });
                if (userRes.ok) {
                  const userData = await userRes.json() as { resource?: { uri?: string } };
                  const userUri = userData.resource?.uri;
                  console.log('[candidates] User URI:', userUri);
                  if (userUri) {
                    const etListRes = await fetch(
                      `https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}&active=true&count=1`,
                      { headers: { Authorization: `Bearer ${conn.access_token}` } },
                    );
                    console.log('[candidates] Event types list response:', { status: etListRes.status });
                    if (etListRes.ok) {
                      const etList = await etListRes.json() as { collection?: { scheduling_url?: string }[] };
                      console.log('[candidates] Event types collection:', JSON.stringify(etList.collection?.map(e => e.scheduling_url)));
                      bookingUrl = etList.collection?.[0]?.scheduling_url;
                    }
                  }
                } else {
                  const errText = await userRes.text();
                  console.error('[candidates] /users/me failed:', errText);
                }
              }
            } catch (err) {
              console.error('[candidates] Calendly fetch error:', err instanceof Error ? err.message : String(err));
            }
          }
        }
      }
    }

    console.log('[candidates] Final bookingUrl:', bookingUrl ?? 'NONE');

    c.executionCtx.waitUntil(
      sendNotificationEmail({
        apiKey: c.env.RESEND_API_KEY,
        trigger: 'INVITATION',
        to: email,
        variables: {
          name,
          email,
          pipelineName: pipeline.title,
          ...(stageName ? { stageName } : {}),
          assessUrl,
          ...(bookingUrl ? { bookingUrl } : {}),
        },
        stageTemplatesJson,
      }),
    );
  }

  return c.json({
    candidate: {
      id,
      name,
      email,
      inviteToken,
      status: 'INVITED',
      currentStageId: stageId,
      scheduledInterview,
    },
  }, 201);
});

// ─── Flat candidate routes ───────────────────────────────────────────────────

const candidateOps = new Hono<{ Bindings: Env; Variables: Variables }>();
candidateOps.use('*', authMiddleware);

// ─── Standalone candidate creation (no pipeline required) ────────────────────

const createStandaloneCandidateSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  email: z.string().email('valid email required'),
  interviewType: z.enum(INTERVIEW_TYPE_VALUES).optional(),
  scheduledAt: z.string().optional(),
  schedulingProvider: z.enum(['CALENDLY', 'CAL_COM', 'MANUAL']).optional(),
  schedulingUrl: z.string().optional(),
  githubRepoUrl: z.string().trim().url().nullable().optional(),
  githubPrNumber: z.number().int().positive().nullable().optional(),
  message: z.string().max(2000).optional(),
  skipEmail: z.boolean().optional(),
}).superRefine((value, ctx) => {
  const hasRepoUrl = Boolean(value.githubRepoUrl);
  const hasPrNumber = Boolean(value.githubPrNumber);
  const supportsRepoOverride = value.interviewType === 'CODE_REVIEW'
    || value.interviewType === 'DEV_CONTAINER_CHALLENGE'
    || value.interviewType === 'OPEN_SOURCE_BUG_FIX';
  if (hasRepoUrl !== hasPrNumber) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Manual repo override requires both githubRepoUrl and githubPrNumber, or omit both for auto-match.',
      path: ['githubRepoUrl'],
    });
  }
  if ((hasRepoUrl || hasPrNumber) && !supportsRepoOverride) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Manual repo override is only supported for workspace-backed assessment interviews.',
      path: ['interviewType'],
    });
  }
});

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadWorkspacePersonContext(
  db: D1Database,
  workspaceId: string,
  personId: string,
): Promise<JsonObject> {
  const existing = await db.prepare(
    `SELECT context_json
       FROM workspace_people
      WHERE workspace_id = ?1 AND person_id = ?2
      LIMIT 1`,
  ).bind(workspaceId, personId).first<{ context_json: string | null }>();
  return parseJsonObject(existing?.context_json ?? null);
}

async function persistRolelessMessageArtifact(input: {
  store: LivingContextStore;
  workspacePersonId: string;
  candidateId: string;
  message: string;
  now: string;
}): Promise<void> {
  const message = input.message;
  if (!message.trim()) return;

  const contentHash = await sha256Hex(message);
  const baseKey = `candidate:${input.candidateId}:roleless-message:${contentHash}`;
  const interaction = await input.store.upsertInteraction({
    ingestionKey: baseKey,
    workspacePersonId: input.workspacePersonId,
    interactionType: 'message',
    externalReference: input.candidateId,
    startedAt: input.now,
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
    },
  });
  const artifact = await input.store.upsertArtifact({
    ingestionKey: baseKey,
    workspacePersonId: input.workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'message',
    logicalKey: 'roleless_candidate_intake_message',
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
    },
  });
  const version = await input.store.createArtifactVersion({
    ingestionKey: `${baseKey}:v1`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/plain',
    contentText: message,
    byteLength: new TextEncoder().encode(message).byteLength,
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
    },
  });
  await input.store.createSourceSpan({
    ingestionKey: `${baseKey}:span:full`,
    artifactVersionId: version.id,
    stableSegmentId: 'full-message',
    charStart: 0,
    charEnd: message.length,
    exactText: message,
    exactTextHash: contentHash,
    metadata: {
      source: 'roleless_candidate_intake',
      roleless: true,
    },
  });
}

export async function ensureRolelessTalentPoolIdentity(input: {
  db: D1Database;
  userId: string;
  candidateId: string;
  name: string;
  email: string;
  message?: string;
  now: string;
}): Promise<{ personId: string; workspacePersonId: string }> {
  const { db, userId, candidateId, name, email, message, now } = input;
  const store = new LivingContextStore(db);
  const existingPerson = await db.prepare(
    `SELECT id, ingestion_key
       FROM people
      WHERE primary_email = ?1
      ORDER BY created_at
      LIMIT 1`,
  ).bind(email).first<{ id: string; ingestion_key: string }>();

  const person = await store.upsertPerson({
    ingestionKey: existingPerson?.ingestion_key ?? `email:${email}`,
    displayName: name,
    primaryEmail: email,
    externalIds: { legacyCandidateId: candidateId },
  });

  const existingContext = await loadWorkspacePersonContext(db, userId, person.id);
  const workspacePerson = await store.upsertWorkspacePerson({
    ingestionKey: `workspace:${userId}:person:${person.id}`,
    workspaceId: userId,
    personId: person.id,
    context: buildRolelessTalentPoolContext(existingContext, candidateId, now),
  });

  await persistRolelessMessageArtifact({
    store,
    workspacePersonId: workspacePerson.id,
    candidateId,
    message: message ?? '',
    now,
  });

  return { personId: person.id, workspacePersonId: workspacePerson.id };
}

// POST / — create a standalone candidate (talent pool, no pipeline)
candidateOps.post('/', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json();
  const parsed = createStandaloneCandidateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  let {
    name,
    email,
    interviewType,
    scheduledAt,
    message: customMessage,
    skipEmail,
    githubRepoUrl,
    githubPrNumber,
  } = parsed.data;
  try {
    name = sanitizeCandidateName(name);
    email = normalizeCandidateEmail(email);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'FORBIDDEN_PATTERN') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Name contains forbidden pattern' } }, 400);
    }
    return apiError(c, 'VALIDATION_ERROR', 'Name contains invalid characters');
  }

  // Duplicate-email guard scoped to owner (no pipeline scope)
  const existing = await db
    .prepare('SELECT id, invite_token, status FROM candidates WHERE owner_id = ? AND email = ? AND pipeline_id IS NULL')
    .bind(userId, email)
    .first<{ id: string; invite_token: string; status: 'INVITED' | 'IN_PROGRESS' | 'COMPLETED' }>();

  const id = existing?.id ?? crypto.randomUUID();
  const inviteToken = existing?.invite_token ?? crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    if (existing) {
      await db
        .prepare(
          `UPDATE candidates
              SET name = COALESCE(NULLIF(?1, ''), name),
                  email = ?2,
                  updated_at = ?3
            WHERE id = ?4`,
        )
        .bind(name, email, now, id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO candidates (id, pipeline_id, owner_id, name, email, invite_token, status, current_stage_id, created_at, updated_at)
           VALUES (?, NULL, ?, ?, ?, ?, 'INVITED', NULL, ?, ?)`
        )
        .bind(id, userId, name, email, inviteToken, now, now)
        .run();
    }

    // Ensure ingestion tracking row exists
    await db
      .prepare(
        `INSERT INTO candidate_ingestion (candidate_id, status, created_at, updated_at)
         VALUES (?1, 'pending', ?2, ?2)
         ON CONFLICT(candidate_id) DO NOTHING`
      )
      .bind(id, now)
      .run();

    await ensureRolelessTalentPoolIdentity({
      db,
      userId,
      candidateId: id,
      name,
      email,
      message: customMessage,
      now,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE constraint failed')) {
      return apiError(c, 'CONFLICT', 'Candidate with this email already exists');
    }
    throw err;
  }

  // Create scheduled_interviews row if interview type specified
  if (interviewType) {
    const interviewId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO scheduled_interviews (
           id, candidate_id, pipeline_id, stage_id, owner_id, interview_type,
           status, scheduled_at, scheduling_provider, scheduling_url, sync_source,
           github_repo_url, github_pr_number,
           created_at, updated_at
         )
         VALUES (?, ?, NULL, NULL, ?, ?, 'INVITED', ?, ?, ?, 'MANUAL', ?, ?, ?, ?)`
      )
      .bind(
        interviewId,
        id,
        userId,
        interviewType,
        scheduledAt ?? null,
        parsed.data.schedulingProvider ?? null,
        parsed.data.schedulingUrl ?? null,
        githubRepoUrl ?? null,
        githubPrNumber ?? null,
        now,
        now,
      )
      .run();
  }

  // Fire-and-forget invitation email
  if (c.env.RESEND_API_KEY && !skipEmail) {
    const baseUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';
    const assessUrl = `${baseUrl}/assess/${inviteToken}`;

    c.executionCtx.waitUntil(
      sendNotificationEmail({
        apiKey: c.env.RESEND_API_KEY,
        trigger: 'INVITATION',
        to: email,
        variables: {
          name,
          email,
          assessUrl,
          ...(customMessage ? { customMessage } : {}),
        },
        stageTemplatesJson: null,
      }),
    );
  }

  return c.json({
    candidate: {
      id,
      name,
      email,
      inviteToken,
      status: existing?.status ?? 'INVITED',
      interviewType: interviewType ?? null,
      pipelineId: null,
      intakeState: 'roleless_talent_pool',
      membershipSchemaBlocker: TALENT_POOL_MEMBERSHIP_SCHEMA_BLOCKER,
    },
  }, existing ? 200 : 201);
});

// GET /:candidateId/living-context — source-backed person graph read model
candidateOps.get('/:candidateId/living-context', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;
  const candidate = await db.prepare(
    `SELECT c.id
       FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.id = ?1 AND (c.owner_id = ?2 OR p.owner_id = ?2)`,
  ).bind(candidateId, userId).first<{ id: string }>();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  await ensureCandidateLivingContext(db, candidateId);
  const livingContext = await loadCandidateLivingContext(db, candidateId);
  if (!livingContext) {
    return apiError(c, 'NOT_FOUND', 'Living context not found.');
  }
  return c.json({ livingContext });
});

// GET /:candidateId/living-context/search?q=... — search candidate source content
candidateOps.get('/:candidateId/living-context/search', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;
  const query = c.req.query('q') ?? '';

  const candidate = await db.prepare(
    `SELECT c.id
       FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.id = ?1 AND (c.owner_id = ?2 OR p.owner_id = ?2)`,
  ).bind(candidateId, userId).first<{ id: string }>();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const wp = await db.prepare(
    `SELECT wp.id
       FROM applications app
       JOIN workspace_people wp ON wp.id = app.workspace_person_id
      WHERE app.legacy_candidate_id = ?1
      LIMIT 1`,
  ).bind(candidateId).first<{ id: string }>();
  if (!wp) return c.json({ personId: candidateId, query, hits: [] });

  const result = await searchSourceContent(db, wp.id, query);
  return c.json(result);
});

// GET /:candidateId/living-context/timeline — chronological evidence accumulation feed
candidateOps.get('/:candidateId/living-context/timeline', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;
  const limitParam = c.req.query('limit');
  const before = c.req.query('before') ?? undefined;
  const after = c.req.query('after') ?? undefined;

  const candidate = await db.prepare(
    `SELECT c.id
       FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.id = ?1 AND (c.owner_id = ?2 OR p.owner_id = ?2)`,
  ).bind(candidateId, userId).first<{ id: string }>();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const wp = await db.prepare(
    `SELECT wp.id
       FROM applications app
       JOIN workspace_people wp ON wp.id = app.workspace_person_id
      WHERE app.legacy_candidate_id = ?1
      LIMIT 1`,
  ).bind(candidateId).first<{ id: string }>();
  if (!wp) return c.json({ workspacePersonId: null, totalEntries: 0, entries: [] });

  const { loadPersonEvidenceTimeline } = await import('../../lib/livingContext');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 500) : 100;
  const timeline = await loadPersonEvidenceTimeline(db, wp.id, { limit, before, after });
  return c.json(timeline);
});

// GET /:candidateId/living-context/match-narrative — recruiter-facing match narrative
candidateOps.get('/:candidateId/living-context/match-narrative', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  const candidate = await db.prepare(
    `SELECT c.id
       FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.id = ?1 AND (c.owner_id = ?2 OR p.owner_id = ?2)`,
  ).bind(candidateId, userId).first<{ id: string }>();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const latestRun = await db.prepare(
    `SELECT id, status, ranked_results_json, excluded_packets_json, query_json, selected_packet_id
       FROM match_runs
      WHERE candidate_id = ?1
        AND role_snapshot_id = 'standalone-code-review-v1'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
  ).bind(candidateId).first<{
    id: string;
    status: 'MATCHED' | 'NEEDS_MORE_EVIDENCE' | 'NO_ROLE_SAFE_CHALLENGE' | 'FAILED';
    ranked_results_json: string | null;
    excluded_packets_json: string | null;
    query_json: string | null;
    selected_packet_id: string | null;
  }>();

  if (!latestRun) {
    return c.json({
      candidateId,
      matchRunId: null,
      narrative: null,
    });
  }

  const roleSources = parseStandaloneReviewRoleSourcesFromQuery(latestRun.query_json);
  const rankedResults = parseStandaloneReviewRankedResults(
    latestRun.ranked_results_json,
    roleSources,
  );
  const selectedResult = rankedResults.find((r) =>
    r.challengeId === latestRun.selected_packet_id
  ) ?? rankedResults.find((r) => r.rank === 1)
    ?? rankedResults.find((r) => r.eligible)
    ?? rankedResults[0]
    ?? null;

  const matchStatus: StandaloneReviewMatchStatus = latestRun.status === 'MATCHED'
    || latestRun.status === 'NEEDS_MORE_EVIDENCE'
    || latestRun.status === 'NO_ROLE_SAFE_CHALLENGE'
      ? latestRun.status
      : 'PENDING_INTAKE';

  const narrative = buildNarrativeFromResult(matchStatus, selectedResult, []);
  return c.json({
    candidateId,
    matchRunId: latestRun.id,
    narrative,
  });
});

// GET /:candidateId/living-context/evidence-depth — per-source-type evidence scoring
candidateOps.get('/:candidateId/living-context/evidence-depth', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  const candidate = await db.prepare(
    `SELECT c.id
       FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.id = ?1 AND (c.owner_id = ?2 OR p.owner_id = ?2)`,
  ).bind(candidateId, userId).first<{ id: string }>();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const wp = await db.prepare(
    `SELECT wp.id
       FROM applications app
       JOIN workspace_people wp ON wp.id = app.workspace_person_id
      WHERE app.legacy_candidate_id = ?1
      LIMIT 1`,
  ).bind(candidateId).first<{ id: string }>();
  if (!wp) {
    return c.json({
      candidateId,
      workspacePersonId: null,
      sourceDiversity: 0,
      totalInteractions: 0,
      totalAssertions: 0,
      totalSourceSpans: 0,
      totalContextRecords: 0,
      sources: {},
      topConcepts: [],
    });
  }

  const [interactionBreakdown, assertionCount, sourceSpanCount, contextRecordCount, topConcepts] = await Promise.all([
    db.prepare(
      `SELECT interaction_type, COUNT(*) AS cnt
         FROM interactions
        WHERE workspace_person_id = ?1
        GROUP BY interaction_type
        ORDER BY cnt DESC`,
    ).bind(wp.id).all<{ interaction_type: string; cnt: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS cnt FROM semantic_assertions WHERE workspace_person_id = ?1`,
    ).bind(wp.id).first<{ cnt: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS cnt
         FROM source_spans ss
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE a.workspace_person_id = ?1`,
    ).bind(wp.id).first<{ cnt: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS cnt FROM context_records WHERE workspace_person_id = ?1`,
    ).bind(wp.id).first<{ cnt: number }>(),
    db.prepare(
      `SELECT c.canonical_key, c.label, COUNT(DISTINCT ac.assertion_id) AS evidence_count
         FROM concepts c
         JOIN assertion_concepts ac ON ac.concept_id = c.id
         JOIN semantic_assertions sa ON sa.id = ac.assertion_id
        WHERE sa.workspace_person_id = ?1
        GROUP BY c.id, c.canonical_key, c.label
        ORDER BY evidence_count DESC
        LIMIT 20`,
    ).bind(wp.id).all<{ canonical_key: string; label: string; evidence_count: number }>(),
  ]);

  const sources: Record<string, number> = {};
  let totalInteractions = 0;
  for (const row of interactionBreakdown.results ?? []) {
    sources[row.interaction_type] = row.cnt;
    totalInteractions += row.cnt;
  }

  const distinctSourceTypes = Object.keys(sources).length;
  const maxSourceTypes = 6; // resume, meeting, culture_interview, code_review, phone_call, assessment
  const sourceDiversity = Math.min(distinctSourceTypes / maxSourceTypes, 1);

  return c.json({
    candidateId,
    workspacePersonId: wp.id,
    sourceDiversity,
    totalInteractions,
    totalAssertions: assertionCount?.cnt ?? 0,
    totalSourceSpans: sourceSpanCount?.cnt ?? 0,
    totalContextRecords: contextRecordCount?.cnt ?? 0,
    sources,
    topConcepts: (topConcepts.results ?? []).map((row) => ({
      key: row.canonical_key,
      label: row.label,
      evidenceCount: row.evidence_count,
    })),
  });
});

// POST /:candidateId/living-context/rematch — recruiter triggers a fresh match run
candidateOps.post('/:candidateId/living-context/rematch', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  const candidate = await db.prepare(
    `SELECT c.id
       FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.id = ?1 AND (c.owner_id = ?2 OR p.owner_id = ?2)`,
  ).bind(candidateId, userId).first<{ id: string }>();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const wp = await db.prepare(
    `SELECT wp.id
       FROM applications app
       JOIN workspace_people wp ON wp.id = app.workspace_person_id
      WHERE app.legacy_candidate_id = ?1
      LIMIT 1`,
  ).bind(candidateId).first<{ id: string }>();
  if (!wp) {
    return c.json({
      candidateId,
      status: 'NEEDS_MORE_EVIDENCE' as const,
      matchRunId: null,
      reason: 'Candidate has no living context workspace identity yet.',
      evaluatedCount: 0,
      topChallenge: null,
    }, 200);
  }

  const { matchCandidateToReviewChallenge } = await import('../../lib/challengeMatching/d1Matcher');
  const match = await matchCandidateToReviewChallenge(db, candidateId, {
    temporalDecay: { halfLifeDays: 90 },
  });

  const evaluated = match.diagnostics?.evaluatedChallenges ?? [];
  const top = evaluated.length > 0
    ? evaluated.reduce((best, cur) =>
        (cur.rank !== null && (best.rank === null || cur.rank < best.rank)) ? cur : best,
      )
    : null;

  return c.json({
    candidateId,
    status: match.status,
    matchRunId: match.matchRunId,
    repoId: match.repoId ?? null,
    prNumber: match.prNumber ?? null,
    evaluatedCount: evaluated.length,
    topChallenge: top ? {
      challengeId: top.challengeId,
      repoId: top.repoId,
      prNumber: top.prNumber,
      rank: top.rank,
      alignedDemandCount: top.alignedDemandCount,
      stretchCount: top.stretchCount,
      eligible: top.eligible,
    } : null,
  });
});

// GET /:candidateId — full profile with stages + challenge submissions
candidateOps.get('/:candidateId', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check via pipeline (relaxed for local dev QA)
  const candidate = await db
    .prepare(
      `SELECT c.id, c.name, c.email, c.status, c.pipeline_id,
              c.current_stage_id, c.resume_s3_key, c.phone_number,
              c.invite_token,
              c.skills, c.years_of_experience, c.current_role, c.education,
              c.created_at, c.updated_at
       FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND (c.owner_id = ? OR p.owner_id = ?)`
    )
    .bind(candidateId, userId, userId)
    .first<{
      id: string;
      name: string | null;
      email: string | null;
      status: string;
      pipeline_id: string | null;
      current_stage_id: string | null;
      resume_s3_key: string | null;
      phone_number: string | null;
      invite_token: string;
      skills: string | null;
      years_of_experience: number | null;
      current_role: string | null;
      education: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  // Fetch stages with challenges for this pipeline
  const stagesResult = await db
    .prepare(
      `SELECT id, title, sort_order, mode
       FROM stages
       WHERE pipeline_id = ?
       ORDER BY sort_order ASC`
    )
    .bind(candidate.pipeline_id)
    .all<{ id: string; title: string; sort_order: number; mode: string | null }>();

  const stages = stagesResult.results ?? [];

  // Fetch all challenges for those stages — include server_config for recruiter view
  // (correctOptionId, ideal answers etc. are recruiter-visible on the profile)
  const challengesResult = await db
    .prepare(
      `SELECT id, stage_id, type, title, instructions, config, server_config, sort_order
       FROM challenges
       WHERE stage_id IN (SELECT id FROM stages WHERE pipeline_id = ?)
       ORDER BY sort_order ASC`
    )
    .bind(candidate.pipeline_id)
    .all<{
      id: string;
      stage_id: string;
      type: string;
      title: string;
      instructions: string | null;
      config: string | null;
      server_config: string | null;
      sort_order: number;
    }>();

  const challenges = challengesResult.results ?? [];

  // Fetch all challenge submissions for this candidate
  const submissionsResult = await db
    .prepare(
      `SELECT id, challenge_id, score, feedback, response_json, submitted_at, scored_at
       FROM challenge_submissions
       WHERE candidate_id = ?
       ORDER BY submitted_at ASC`
    )
    .bind(candidateId)
    .all<{
      id: string;
      challenge_id: string;
      score: number | null;
      feedback: string | null;
      response_json: string | null;
      submitted_at: string | null;
      scored_at: string | null;
    }>();

  const submissions = submissionsResult.results ?? [];

  // Map submissions by challenge_id for quick lookup
  const submissionsByChallenge = new Map(
    submissions.map((s) => [s.challenge_id, s])
  );

  // Fetch all review sessions for this candidate
  const reviewSessionsResult = await db
    .prepare(
      `SELECT id, challenge_id, status, current_round, max_rounds, score_report, created_at, updated_at
       FROM review_sessions
       WHERE candidate_id = ?`
    )
    .bind(candidateId)
    .all<{
      id: string;
      challenge_id: string;
      status: string;
      current_round: number;
      max_rounds: number;
      score_report: string | null;
      created_at: string;
      updated_at: string;
    }>();

  const reviewSessionsByChallenge = new Map<string, typeof reviewSessionsResult.results>();
  for (const rs of reviewSessionsResult.results ?? []) {
    const list = reviewSessionsByChallenge.get(rs.challenge_id) ?? [];
    list.push(rs);
    reviewSessionsByChallenge.set(rs.challenge_id, list);
  }

  // Fetch scheduled interviews for this candidate
  const interviewsResult = await db
    .prepare(
      `SELECT id, candidate_id, pipeline_id, stage_id, interview_type, meeting_type,
              status, scheduled_at, meeting_url, scheduling_provider, scheduling_url,
              matched_repo_id, github_repo_url, github_pr_number, completed_at,
              created_at, updated_at
       FROM scheduled_interviews
       WHERE candidate_id = ?
       ORDER BY created_at DESC`
    )
    .bind(candidateId)
    .all<{
      id: string;
      candidate_id: string;
      pipeline_id: string | null;
      stage_id: string | null;
      interview_type: string | null;
      meeting_type: string | null;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    }>();

  const scheduledInterviews = (interviewsResult.results ?? []).map((interview) => ({
    id: interview.id,
    candidateId: interview.candidate_id,
    pipelineId: interview.pipeline_id,
    stageId: interview.stage_id,
    interviewType: interview.interview_type ?? 'VIDEO',
    meetingType: interview.meeting_type,
    status: interview.status,
    scheduledAt: interview.scheduled_at,
    meetingUrl: interview.meeting_url,
    schedulingProvider: interview.scheduling_provider,
    schedulingUrl: interview.scheduling_url,
    matchedRepoId: interview.matched_repo_id,
    githubRepoUrl: interview.github_repo_url,
    githubPrNumber: interview.github_pr_number,
    completedAt: interview.completed_at,
    createdAt: interview.created_at,
    updatedAt: interview.updated_at,
  }));

  const interviewsByStage = new Map(
    (interviewsResult.results ?? []).map((iv) => [iv.stage_id, iv])
  );

  // Build stages with nested challenges + submissions
  const stagesWithChallenges = stages.map((stage) => {
    const stageChallenges = challenges
      .filter((ch) => ch.stage_id === stage.id)
      .map((ch) => {
        const sub = submissionsByChallenge.get(ch.id);
        // Merge server_config into config for recruiter view
        // (e.g. correctOptionId for MCQ, idealAnswer for SHORT_ANSWER)
        const publicConfig = ch.config
          ? (JSON.parse(ch.config) as Record<string, unknown>)
          : {};
        const serverConfig = ch.server_config
          ? (JSON.parse(ch.server_config) as Record<string, unknown>)
          : {};
        const mergedConfig = { ...publicConfig, ...serverConfig };
        const reviewSessions = reviewSessionsByChallenge.get(ch.id) ?? [];
        const primaryReviewSession = reviewSessions[0] ?? null;
        return {
          id: ch.id,
          type: ch.type,
          title: ch.title,
          instructions: ch.instructions,
          config: mergedConfig,
          order: ch.sort_order,
          submission: sub
            ? {
                id: sub.id,
                score: sub.score,
                feedback: sub.feedback,
                response: sub.response_json
                  ? (JSON.parse(sub.response_json) as Record<string, unknown>)
                  : null,
                submittedAt: sub.submitted_at,
                scoredAt: sub.scored_at,
              }
            : null,
          reviewSession: primaryReviewSession
            ? {
                id: primaryReviewSession.id,
                status: primaryReviewSession.status,
                currentRound: primaryReviewSession.current_round,
                maxRounds: primaryReviewSession.max_rounds,
                scoreReport: primaryReviewSession.score_report
                  ? (JSON.parse(primaryReviewSession.score_report) as Record<string, unknown>)
                  : null,
                createdAt: primaryReviewSession.created_at,
                updatedAt: primaryReviewSession.updated_at,
              }
            : null,
        };
      });
    const interview = interviewsByStage.get(stage.id);
    return {
      id: stage.id,
      title: stage.title,
      order: stage.sort_order,
      mode: stage.mode,
      challenges: stageChallenges,
      ...(interview ? {
        scheduledInterview: {
          id: interview.id,
          status: interview.status,
          scheduledAt: interview.scheduled_at,
          meetingUrl: interview.meeting_url,
          provider: interview.scheduling_provider,
        },
      } : {}),
    };
  });

  // Compute overall average score from all submissions with scores
  const scoredSubs = submissions.filter((s) => s.score !== null);
  const avgScore =
    scoredSubs.length > 0
      ? Math.round(
          scoredSubs.reduce((sum, s) => sum + (s.score ?? 0), 0) /
            scoredSubs.length
        )
      : null;

  // Run dealbreaker gate against the pipeline's role context (if any)
  let dealbreakerResult: {
    autoFail: boolean;
    failures: Array<{ dealbreakerId: string; label: string; reason: string }>;
    warnings: Array<{ dealbreakerId: string; label: string; reason: string }>;
  } | null = null;
  try {
    const roleCtxRow = await db
      .prepare(`SELECT id FROM role_contexts WHERE pipeline_id = ?1 LIMIT 1`)
      .bind(candidate.pipeline_id)
      .first<{ id: string }>();

    if (roleCtxRow) {
      const neo4jConfig = buildNeo4jConfig(c.env);
      if (neo4jConfig) {
        const driver = createNeo4jDriver(neo4jConfig);
        try {
          const failures = await checkDealbreakersForCandidate(driver, roleCtxRow.id, candidateId);
          dealbreakerResult = {
            autoFail: failures.length > 0,
            failures: failures.map((f) => ({
              dealbreakerId: f.dealbreaker_id,
              label: f.narrative_text,
              reason: `similarity ${(f.matched_similarity ?? 0).toFixed(2)}`,
            })),
            warnings: [],
          };
        } finally {
          await driver.close();
        }
      }
    }
  } catch (err) {
    console.error('[candidates] Dealbreaker gate failed:', err);
  }

  // Fetch phone calls for this candidate (table may not exist if migration 0008 not applied)
  let phoneCallsResults: Array<{
    id: string; candidate_id: string; pipeline_id: string;
    direction: string; status: string; from_number: string; to_number: string;
    twilio_call_sid: string | null; duration_seconds: number | null;
    recording_s3_key: string | null; transcription: string | null;
    transcription_status: string | null; recruiter_notes: string | null;
    started_at: string | null; ended_at: string | null; created_at: string;
  }> = [];
  try {
    const phoneCallsResult = await db
      .prepare(
        `SELECT id, candidate_id, pipeline_id, direction, status, from_number, to_number,
                twilio_call_sid, duration_seconds, recording_s3_key, transcription,
                transcription_status, recruiter_notes, started_at, ended_at, created_at
         FROM phone_calls
         WHERE candidate_id = ?
         ORDER BY created_at DESC`
      )
      .bind(candidateId)
      .all();
    phoneCallsResults = (phoneCallsResult.results ?? []) as typeof phoneCallsResults;
  } catch {
    // phone_calls table may not exist yet
  }

  const phoneCalls = phoneCallsResults.map((pc) => ({
    id: pc.id,
    candidateId: pc.candidate_id,
    pipelineId: pc.pipeline_id,
    direction: pc.direction,
    status: pc.status,
    fromNumber: pc.from_number,
    toNumber: pc.to_number,
    twilioCallSid: pc.twilio_call_sid,
    durationSeconds: pc.duration_seconds,
    recordingS3Key: pc.recording_s3_key,
    transcription: pc.transcription,
    transcriptionStatus: pc.transcription_status,
    recruiterNotes: pc.recruiter_notes,
    startedAt: pc.started_at,
    endedAt: pc.ended_at,
    createdAt: pc.created_at,
  }));

  // Fetch candidate ingestion / enrichment data
  let ingestionRow: Record<string, unknown> | null = null;

  try {
    ingestionRow = await db
      .prepare(
        `SELECT id, status, candidate_searchable_profile, key_concepts_json,
                profile_version, model_used, decomposition_version,
                triangulated_score, role_candidate_cosine,
                dimensions_json, reasoning_json, match_philosophy,
                career_context_json, situation_signature_json, key_situations_json,
                github_url, last_enriched_at,
                profile_generated_at, profile_embedded_at, matched_at,
                error_text, github_calendar_json, profile_sections_json,
                matched_repo_id
         FROM candidate_ingestion
         WHERE candidate_id = ?`,
      )
      .bind(candidateId)
      .first<Record<string, unknown>>();
  } catch {
    // candidate_ingestion table may not exist yet
  }

  // Fetch matched repo info separately
  let matchedRepoName: string | null = null;
  let matchedRepoUrl: string | null = null;
  if (ingestionRow?.matched_repo_id) {
    try {
      const repoRow = await db
        .prepare(`SELECT full_name, github_url FROM qualified_repos WHERE id = ?`)
        .bind(ingestionRow.matched_repo_id)
        .first<{ full_name: string | null; github_url: string | null }>();
      matchedRepoName = repoRow?.full_name ?? null;
      matchedRepoUrl = repoRow?.github_url ?? null;
    } catch {}
  }

  // Fetch latest enrichment job status separately
  let enrichmentJobStatus: string | null = null;
  try {
    const jobRow = await db
      .prepare(`SELECT status FROM enrichment_jobs WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(candidateId)
      .first<{ status: string | null }>();
    enrichmentJobStatus = jobRow?.status ?? null;
  } catch {}

  // Fetch top-3 repo matches for this candidate
  let topRepoMatches: Array<{
    rank: number;
    repoName: string;
    repoUrl: string;
    score: number;
    locationTag: string | null;
  }> = [];
  try {
    const matchesResult = await db
      .prepare(
        `SELECT m.rank, m.triangulated_score, m.location_tag,
                r.full_name, r.github_url
         FROM candidate_repo_matches m
         JOIN qualified_repos r ON r.id = m.repo_id
         WHERE m.candidate_id = ?
         ORDER BY m.rank ASC
         LIMIT 3`
      )
      .bind(candidateId)
      .all<{ rank: number; triangulated_score: number; location_tag: string | null; full_name: string; github_url: string }>();
    topRepoMatches = (matchesResult.results ?? []).map((row) => ({
      rank: row.rank,
      repoName: row.full_name,
      repoUrl: row.github_url,
      score: row.triangulated_score,
      locationTag: row.location_tag,
    }));
  } catch {}

  let standaloneReviewMatch: {
    interviewId: string;
    interviewStatus: string;
    matchStatus: StandaloneReviewMatchStatus;
    matchRunId: string | null;
    packetId: string | null;
    repoId: number | null;
    repoName: string | null;
    repoUrl: string | null;
    prNumber: number | null;
    prUrl: string | null;
    prTitle: string | null;
    score: number | null;
    summary: string;
    evidence: StandaloneReviewAlignment[];
    roleSources: StandaloneReviewRoleSource[];
    stretchAreas: StandaloneReviewStretchArea[];
    unmatchedDemandIds: string[];
    gaps: string[];
    matchNarrative: StandaloneReviewMatchNarrative | null;
    diagnostics: StandaloneReviewDiagnostics;
    packet: StandaloneReviewPacketDetail | null;
    submitted: boolean;
    submission: StandaloneReviewSubmissionSummary | null;
    completedAt: string | null;
  } | null = null;

  try {
    const standaloneInterview = await db.prepare(
      `SELECT id, status, matched_repo_id, github_repo_url, github_pr_number,
              submission_json, completed_at
         FROM scheduled_interviews
        WHERE candidate_id = ?1
          AND interview_type = 'CODE_REVIEW'
          AND stage_id IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
    ).bind(candidateId).first<{
      id: string;
      status: string;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      submission_json: string | null;
      completed_at: string | null;
    }>();

    if (standaloneInterview) {
      const cachedInterviewIsSourceBacked = !!(
        standaloneInterview.github_repo_url
        && standaloneInterview.github_pr_number
        && await hasSourceBackedReviewPacket(
          db,
          standaloneInterview.github_repo_url,
          standaloneInterview.github_pr_number,
        )
      );
      const cachedInterviewRepoId = cachedInterviewIsSourceBacked
        ? standaloneInterview.matched_repo_id
        : null;
      const cachedInterviewRepoUrl = cachedInterviewIsSourceBacked
        ? standaloneInterview.github_repo_url
        : null;
      const cachedInterviewPrNumber = cachedInterviewIsSourceBacked
        ? standaloneInterview.github_pr_number
        : null;

      const latestRun = await db.prepare(
        `SELECT id, status, recalled_packets_json, excluded_packets_json,
                ranked_results_json, selected_packet_id, query_json
           FROM match_runs
          WHERE candidate_id = ?1
            AND role_snapshot_id = 'standalone-code-review-v1'
          ORDER BY
            CASE
              WHEN ?2 IS NOT NULL
               AND ?3 IS NOT NULL
               AND status = 'MATCHED'
               AND selected_packet_id IN (
                 SELECT id FROM review_challenge_packets
                  WHERE repo_id = ?2 AND pr_number = ?3
               )
              THEN 0
              ELSE 1
            END,
            created_at DESC,
            id DESC
          LIMIT 1`,
      ).bind(
        candidateId,
        cachedInterviewRepoId,
        cachedInterviewPrNumber,
      ).first<{
        id: string;
        status: 'MATCHED' | 'NEEDS_MORE_EVIDENCE' | 'NO_ROLE_SAFE_CHALLENGE' | 'FAILED';
        recalled_packets_json: string | null;
        excluded_packets_json: string | null;
        ranked_results_json: string | null;
        selected_packet_id: string | null;
        query_json: string | null;
      }>();

      const roleSources = parseStandaloneReviewRoleSourcesFromQuery(latestRun?.query_json ?? null);
      const rankedResults = parseStandaloneReviewRankedResults(
        latestRun?.ranked_results_json ?? null,
        roleSources,
      );
      const diagnostics = buildStandaloneReviewDiagnostics(
        latestRun?.recalled_packets_json ?? null,
        latestRun?.excluded_packets_json ?? null,
        rankedResults,
      );
      const selectedResult = rankedResults.find((result) =>
        result.challengeId === latestRun?.selected_packet_id
      ) ?? rankedResults.find((result) => result.rank === 1)
        ?? rankedResults.find((result) => result.eligible)
        ?? rankedResults[0]
        ?? null;
      const selectedPacketId = latestRun?.selected_packet_id ?? selectedResult?.challengeId ?? null;
      const selectedPacketRow = selectedPacketId
        ? await loadSourceBackedReviewPacketById(db, selectedPacketId)
        : null;
      const selectedPacketMetadata = selectedPacketId
        ? parseStandaloneReviewPacketMetadata(selectedPacketRow)
        : null;
      const selectedPacketDetail = parseStandaloneReviewPacketDetail(selectedPacketId, selectedPacketRow);
      const selectedPacketContextMissing = !!(selectedPacketId && !selectedPacketMetadata);
      const selectedResultForDisplay = selectedPacketContextMissing ? null : selectedResult;
      const matchStatus: StandaloneReviewMatchStatus = cachedInterviewIsSourceBacked && !latestRun
        ? 'MATCHED'
        : latestRun?.status === 'MATCHED'
        || latestRun?.status === 'NEEDS_MORE_EVIDENCE'
        || latestRun?.status === 'NO_ROLE_SAFE_CHALLENGE'
        ? selectedPacketContextMissing && latestRun.status === 'MATCHED'
          ? 'NO_ROLE_SAFE_CHALLENGE'
          : latestRun.status
        : 'PENDING_INTAKE';
      const repoId = cachedInterviewRepoId
        ?? selectedPacketMetadata?.repoId
        ?? (selectedResultForDisplay ? Number(selectedResultForDisplay.repoId) : null);
      let repoName: string | null = selectedPacketMetadata?.repoName ?? null;
      let repoUrl = cachedInterviewRepoUrl ?? selectedPacketMetadata?.repoUrl ?? null;
      if (repoId !== null && Number.isFinite(repoId)) {
        const repoRow = await db.prepare(
          `SELECT full_name, github_url FROM qualified_repos WHERE id = ?1`,
        ).bind(repoId).first<{ full_name: string | null; github_url: string | null }>();
        repoName = repoRow?.full_name ?? repoName;
        repoUrl = repoUrl ?? repoRow?.github_url ?? null;
      }
      const prNumber = cachedInterviewPrNumber
        ?? selectedPacketMetadata?.prNumber
        ?? selectedResultForDisplay?.prNumber
        ?? null;
      let prTitle: string | null = selectedPacketMetadata?.prTitle ?? null;
      let prUrl: string | null = selectedPacketMetadata?.prUrl
        ?? (repoUrl && prNumber ? `${repoUrl}/pull/${prNumber}` : null);
      if (repoId !== null && Number.isFinite(repoId) && prNumber !== null) {
        const prRow = await db.prepare(
          `SELECT title, pr_url FROM repo_sample_prs WHERE repo_id = ?1 AND pr_number = ?2`,
        ).bind(repoId, prNumber).first<{ title: string | null; pr_url: string | null }>();
        prTitle = prRow?.title ?? prTitle;
        prUrl = prRow?.pr_url ?? prUrl;
      }
      const summary = buildStandaloneReviewMatchSummary(matchStatus, selectedResultForDisplay, diagnostics);
      const graphContextGaps = selectedPacketContextMissing
        ? [`Selected review packet ${selectedPacketId} is missing source-backed graph context.`]
        : [];
      const submission = await loadStandaloneReviewSubmissionSummary(
        db,
        candidateId,
        standaloneInterview.submission_json,
      );
      const selectedStretchAreas = selectedResultForDisplay?.stretchAreas ?? [];
      const selectedUnmatchedDemandIds = selectedResultForDisplay?.unmatchedDemandIds ?? [];
      const allGaps = [...graphContextGaps, ...summary.gaps];
      const matchNarrative = buildNarrativeFromResult(matchStatus, selectedResultForDisplay, allGaps);
      standaloneReviewMatch = {
        interviewId: standaloneInterview.id,
        interviewStatus: standaloneInterview.status,
        matchStatus,
        matchRunId: latestRun?.id ?? null,
        packetId: selectedResultForDisplay ? selectedPacketId : null,
        repoId: repoId !== null && Number.isFinite(repoId) ? repoId : null,
        repoName,
        repoUrl,
        prNumber,
        prUrl,
        prTitle,
        score: selectedResultForDisplay?.score ?? null,
        summary: summary.summary,
        evidence: summary.evidence,
        roleSources,
        stretchAreas: selectedStretchAreas,
        unmatchedDemandIds: selectedUnmatchedDemandIds,
        gaps: allGaps,
        matchNarrative,
        diagnostics,
        packet: selectedPacketDetail,
        submitted: standaloneInterview.submission_json !== null,
        submission,
        completedAt: standaloneInterview.completed_at,
      };
    }
  } catch (err) {
    console.error('[candidates] Failed to load standalone code review match:', err);
  }

  const ingestion = ingestionRow?.id != null
    ? {
        status: ingestionRow.status as
          | 'pending'
          | 'profile_generated'
          | 'embedded'
          | 'matched'
          | 'failed',
        candidateSearchableProfile: ingestionRow.candidate_searchable_profile,
        keyConcepts: ingestionRow.key_concepts_json
          ? (JSON.parse(ingestionRow.key_concepts_json as string) as Record<string, unknown>)
          : null,
        profileVersion: ingestionRow.profile_version,
        modelUsed: ingestionRow.model_used,
        decompositionVersion: ingestionRow.decomposition_version,
        triangulatedScore: ingestionRow.triangulated_score,
        roleCandidateCosine: ingestionRow.role_candidate_cosine,
        dimensions: ingestionRow.dimensions_json
          ? (() => {
              const d = JSON.parse(ingestionRow.dimensions_json as string) as Record<string, number>;
              return {
                skillCoverage: d.skill_coverage ?? 0,
                semanticSimilarity: d.semantic_similarity ?? 0,
                situationFit: d.situation_fit ?? 0,
                roleAlignment: d.role_alignment ?? 0,
              };
            })()
          : null,
        reasoning: ingestionRow.reasoning_json
          ? (JSON.parse(ingestionRow.reasoning_json as string) as {
              matches: string[];
              mismatches: string[];
            })
          : null,
        matchPhilosophy: ingestionRow.match_philosophy,
        careerContext: ingestionRow.career_context_json
          ? (JSON.parse(ingestionRow.career_context_json as string) as Record<string, unknown>)
          : null,
        situationSignature: ingestionRow.situation_signature_json
          ? (JSON.parse(ingestionRow.situation_signature_json as string) as Record<string, unknown>)
          : null,
        keySituations: ingestionRow.key_situations_json
          ? (JSON.parse(ingestionRow.key_situations_json as string) as unknown[])
          : null,
        matchedRepoName,
        matchedRepoUrl,
        githubUrl: ingestionRow.github_url,
        lastEnrichedAt: ingestionRow.last_enriched_at,
        profileGeneratedAt: ingestionRow.profile_generated_at,
        profileEmbeddedAt: ingestionRow.profile_embedded_at,
        matchedAt: ingestionRow.matched_at,
        errorText: ingestionRow.error_text,
        enrichmentJobStatus,
        topRepoMatches,
        githubCalendar: ingestionRow.github_calendar_json
          ? (JSON.parse(ingestionRow.github_calendar_json as string) as {
              totalContributions: number;
              weeks: Array<{ contributionDays: Array<{ date: string; count: number }> }>;
            })
          : null,
      }
    : null;

  // Fetch culture interview sessions for this candidate (in-progress or complete)
  let cultureInterviewSessions: Array<{
    id: string;
    challengeId: string;
    assessmentId: string;
    state: string;
    transcript: Record<string, unknown>;
    scoreReport: Record<string, unknown> | null;
    completedAt: string | null;
    createdAt: string;
  }> = [];
  try {
    const cisResult = await db
      .prepare(
        `SELECT id, challenge_id, assessment_id, state, transcript, score_report, completed_at, created_at
         FROM culture_interview_sessions
         WHERE candidate_id = ?
         ORDER BY created_at DESC`
      )
      .bind(candidateId)
      .all<{
        id: string;
        challenge_id: string;
        assessment_id: string;
        state: string;
        transcript: string;
        score_report: string | null;
        completed_at: string | null;
        created_at: string;
      }>();
    cultureInterviewSessions = (cisResult.results ?? []).map((row) => ({
      id: row.id,
      challengeId: row.challenge_id,
      assessmentId: row.assessment_id,
      state: row.state,
      transcript: JSON.parse(row.transcript) as Record<string, unknown>,
      scoreReport: row.score_report ? (JSON.parse(row.score_report) as Record<string, unknown>) : null,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    }));
  } catch {
    // culture_interview_sessions table may not exist yet
  }

  // Build or load profile sections for dynamic rendering
  let profileSections: Array<{ type: string; props: Record<string, unknown> }> = [];
  if (ingestionRow?.profile_sections_json) {
    try {
      profileSections = JSON.parse(ingestionRow.profile_sections_json as string) as typeof profileSections;
    } catch {
      // ignore parse errors
    }
  }
  if (profileSections.length === 0 && ingestion) {
    // Compute on-the-fly from available ingestion data
    const matchData = ingestion.status === 'matched' && ingestion.triangulatedScore !== null
      ? {
          score: ingestion.triangulatedScore as number,
          dimensions: ingestion.dimensions ?? undefined,
          reasoning: ingestion.reasoning ?? undefined,
          philosophy: (ingestion.matchPhilosophy as string | undefined) ?? undefined,
          repoName: ingestion.matchedRepoName ?? undefined,
          repoUrl: ingestion.matchedRepoUrl ?? undefined,
        }
      : null;
    const calendar = ingestion.githubCalendar
      ? {
          totalContributions: ingestion.githubCalendar.totalContributions,
          weeks: ingestion.githubCalendar.weeks,
        }
      : null;
    profileSections = buildProfileSections(null, {
      candidateSearchableProfile: ingestion.candidateSearchableProfile ?? '',
      keyConcepts: ingestion.keyConcepts ?? {
        mustHaveSkills: [],
        niceToHaveSkills: [],
        seniority: 'unknown',
        primary_language: '',
        detected_domain: '',
      },
      careerContext: ingestion.careerContext,
      situationSignature: ingestion.situationSignature,
      profileVersion: ingestion.profileVersion ?? '',
      modelUsed: ingestion.modelUsed ?? '',
      rawText: '',
    } as any, matchData, calendar);
  }

  let identity: { personId: string; workspacePersonId: string; applicationId: string } | null = null;
  try {
    identity = await ensureCandidateLivingContext(db, candidateId);
  } catch (err) {
    console.warn('[candidates] Candidate/person identity bridge unavailable:', err);
  }
  let contactId: string | null = null;
  if (candidate.email) {
    try {
      const contact = await db.prepare(
        `SELECT id
           FROM contacts
          WHERE owner_id = ?1
            AND lower(email) = ?2
          ORDER BY created_at ASC
          LIMIT 1`,
      ).bind(userId, candidate.email.toLowerCase()).first<{ id: string }>();
      contactId = contact?.id ?? null;
    } catch {
      contactId = null;
    }
  }

  return c.json({
    candidate: {
      id: candidate.id,
      personId: identity?.personId ?? null,
      workspacePersonId: identity?.workspacePersonId ?? null,
      applicationId: identity?.applicationId ?? null,
      contactId,
      name: candidate.name,
      email: candidate.email,
      phoneNumber: candidate.phone_number,
      status: candidate.status,
      pipelineId: candidate.pipeline_id,
      currentStageId: candidate.current_stage_id,
      resumeS3Key: candidate.resume_s3_key,
      inviteToken: candidate.invite_token,
      skills: candidate.skills ? (JSON.parse(candidate.skills) as string[]) : null,
      yearsOfExperience: candidate.years_of_experience,
      currentRole: candidate.current_role,
      education: candidate.education ? (JSON.parse(candidate.education) as string[]) : null,
      score: avgScore,
      createdAt: candidate.created_at,
      updatedAt: candidate.updated_at,
      dealbreakerAutoFail: dealbreakerResult?.autoFail ?? false,
      dealbreakerFails: dealbreakerResult?.failures ?? [],
      dealbreakerWarnings: dealbreakerResult?.warnings ?? [],
    },
    stages: stagesWithChallenges,
    phoneCalls,
    scheduledInterviews,
    ingestion,
    standaloneReviewMatch,
    profileSections,
    cultureInterviewSessions,
  });
});

// POST /:candidateId/resume — direct upload of CV/resume to R2
candidateOps.post('/:candidateId/resume', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check via pipeline
  const candidate = await db
    .prepare(
      `SELECT c.id FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND (c.owner_id = ? OR p.owner_id = ?)`
    )
    .bind(candidateId, userId, userId)
    .first<{ id: string }>();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request must be multipart/form-data.');
  }

  const fileEntry = formData.get('file') as unknown as File | null;
  if (!fileEntry) {
    return apiError(c, 'VALIDATION_ERROR', 'No file field found in the request.');
  }

  if (!ALLOWED_RESUME_TYPES.has(fileEntry.type)) {
    return apiError(c, 'VALIDATION_ERROR', 'Only PDF and DOCX files are accepted.');
  }

  if (fileEntry.size > MAX_RESUME_BYTES) {
    return apiError(c, 'VALIDATION_ERROR', 'File exceeds the 10 MB limit.');
  }

  // Validate optional GitHub handle
  const githubHandle = formData.get('githubHandle') as string | null;
  if (githubHandle !== null && githubHandle !== '') {
    if (!/^[a-zA-Z0-9\-]{1,39}$/.test(githubHandle)) {
      return apiError(c, 'VALIDATION_ERROR', 'Invalid GitHub handle. Must be 1-39 characters, alphanumeric or hyphens only.');
    }
  }

  // Sanitise the filename — strip path traversal attempts, keep extension only
  const rawName = fileEntry.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const r2Key = `candidate-documents/${candidateId}/${rawName}`;

  // Upload to R2
  const arrayBuffer = await fileEntry.arrayBuffer();
  // Clone before R2 put — ArrayBuffer may be detached/transfered by the binding
  const fileBuffer = arrayBuffer.slice(0);
  await c.env.STORAGE.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: fileEntry.type },
    customMetadata: { candidateId, originalName: fileEntry.name },
  });

  // Persist the R2 key on the candidate record
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE candidates SET resume_s3_key = ?, updated_at = ? WHERE id = ?`)
    .bind(r2Key, now, candidateId)
    .run();

  // Parse the resume for structured data (skills, role, experience)
  const isMock = c.env.MOCK_AI === 'true';
  const parseResult = await parseResume({
    fileBuffer,
    contentType: fileEntry.type,
    env: c.env,
    mock: isMock,
  });
  const parsed = parseResult?.parsedCV ?? null;
  const decompositionResult = parseResult?.decompositionResult ?? null;

  if (parsed) {
    await persistParsedCV(db, candidateId, parsed);
  }

  // Persist GitHub handle
  if (githubHandle) {
    const githubUrl = `https://github.com/${githubHandle}`;
    try {
      await db
        .prepare(
          `INSERT INTO candidate_ingestion (candidate_id, github_url, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?3)
           ON CONFLICT(candidate_id) DO UPDATE SET
             github_url = excluded.github_url,
             updated_at = excluded.updated_at`,
        )
        .bind(candidateId, githubUrl, now)
        .run();

      // Queue github enrichment — this is genuinely async / fire-and-forget
      await db
        .prepare(
          `INSERT INTO enrichment_jobs (id, candidate_id, source_type, source_url, status, created_at)
           VALUES (?1, ?2, 'github', ?3, 'PENDING', unixepoch())`,
        )
        .bind(crypto.randomUUID(), candidateId, githubUrl)
        .run();

      console.log(`[intake] queued github enrichment for candidate ${candidateId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[candidates/resume] failed to queue github enrichment for ${candidateId}:`, msg);
      // Non-fatal: don't fail the upload if enrichment queuing fails
    }
  }

  // Run resume ingestion synchronously — fire-and-forget, no queue needed yet
  let ingestionResult: { success: boolean; error?: string } = { success: false };
  try {
    ingestionResult = await processResumeFromR2({
      env: c.env,
      db,
      candidateId,
      r2Key,
      preParsed: parseResult,
    });
    console.log(`[intake] synchronous resume ingestion for candidate ${candidateId}:`, ingestionResult.success);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[candidates/resume] synchronous ingestion failed for ${candidateId}:`, msg);
    ingestionResult = { success: false, error: msg };
  }

  return c.json({ success: true, r2Key, parsed, ingestion: ingestionResult }, 201);
});

// GET /:candidateId/resume — stream CV/resume from R2 to the recruiter
candidateOps.get('/:candidateId/resume', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check — also fetch the stored R2 key
  const candidate = await db
    .prepare(
      `SELECT c.resume_s3_key FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND (c.owner_id = ? OR p.owner_id = ?)`
    )
    .bind(candidateId, userId, userId)
    .first<{ resume_s3_key: string | null }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');
  if (!candidate.resume_s3_key) return apiError(c, 'NOT_FOUND', 'No resume on file.');

  const object = await c.env.STORAGE.get(candidate.resume_s3_key);
  if (!object) {
    return apiError(c, 'NOT_FOUND', 'Resume file not found in storage.');
  }

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  // Derive a download filename from the R2 key (last path segment)
  const filename = candidate.resume_s3_key.split('/').at(-1) ?? 'resume';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
});

// PATCH /:candidateId
candidateOps.patch('/:candidateId', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check via pipeline
  const candidate = await db
    .prepare(
      `SELECT c.id, c.pipeline_id FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND (c.owner_id = ? OR p.owner_id = ?)`
    )
    .bind(candidateId, userId, userId)
    .first();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const body = await c.req.json();
  const parsed = updateCandidateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (parsed.data.currentStageId !== undefined) {
    updates.push('current_stage_id = ?');
    values.push(parsed.data.currentStageId);
  }
  if (parsed.data.status !== undefined) {
    updates.push('status = ?');
    values.push(parsed.data.status);
  }
  if (parsed.data.name !== undefined) {
    try {
      const sanitizedName = sanitizeCandidateName(parsed.data.name);
      updates.push('name = ?');
      values.push(sanitizedName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'FORBIDDEN_PATTERN') {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Name contains forbidden pattern' } }, 400);
      }
      return apiError(c, 'VALIDATION_ERROR', 'Name contains invalid characters');
    }
  }
  if (parsed.data.email !== undefined) {
    updates.push('email = ?');
    values.push(normalizeCandidateEmail(parsed.data.email));
  }
  if (parsed.data.resumeS3Key !== undefined) {
    updates.push('resume_s3_key = ?');
    values.push(parsed.data.resumeS3Key);
  }
  if (parsed.data.phoneNumber !== undefined) {
    updates.push('phone_number = ?');
    values.push(parsed.data.phoneNumber);
  }

  if (updates.length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'No fields to update.');
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(candidateId);

  await db
    .prepare(`UPDATE candidates SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  await ensureCandidateLivingContext(db, candidateId);

  return c.json({ success: true });
});

// GET /:candidateId/assignments — list candidate_challenge_assignment rows
candidateOps.get('/:candidateId/assignments', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  const candidate = await db
    .prepare(
      `SELECT c.id FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND (c.owner_id = ? OR p.owner_id = ?)`
    )
    .bind(candidateId, userId, userId)
    .first<{ id: string }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const rows = await db
    .prepare(
      `SELECT stage_id, challenge_id, repo_id, github_repo_url,
              github_pr_number, issue_number, assigned_at
       FROM candidate_challenge_assignment
       WHERE candidate_id = ?
       ORDER BY assigned_at DESC`
    )
    .bind(candidateId)
    .all<{
      stage_id: string;
      challenge_id: string;
      repo_id: number;
      github_repo_url: string;
      github_pr_number: number | null;
      issue_number: number | null;
      assigned_at: string;
    }>();

  const assignments = (rows.results ?? []).map((r) => ({
    stageId: r.stage_id,
    challengeId: r.challenge_id,
    repoId: r.repo_id,
    githubRepoUrl: r.github_repo_url,
    githubPrNumber: r.github_pr_number,
    issueNumber: r.issue_number,
    assignedAt: r.assigned_at,
  }));

  return c.json({ assignments });
});

// POST /:candidateId/refresh-link — regenerate invite token
candidateOps.post('/:candidateId/refresh-link', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check via pipeline
  const candidate = await db
    .prepare(
      `SELECT c.id, c.status FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND (c.owner_id = ? OR p.owner_id = ?)`
    )
    .bind(candidateId, userId, userId)
    .first<{ id: string; status: string }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const newToken = crypto.randomUUID();
  const now = new Date().toISOString();

  // Wipe previous attempt data so the candidate starts fresh.
  // Order matters: delete child tables with FK constraints before parents.
  await db.batch([
    db.prepare(`DELETE FROM culture_compliance_audit WHERE session_id IN (SELECT id FROM culture_interview_sessions WHERE candidate_id = ?)`).bind(candidateId),
    db.prepare(`DELETE FROM culture_interview_sessions WHERE candidate_id = ?`).bind(candidateId),
    db.prepare(`DELETE FROM review_sessions WHERE candidate_id = ?`).bind(candidateId),
    db.prepare(`DELETE FROM challenge_submissions WHERE candidate_id = ?`).bind(candidateId),
    db.prepare(`DELETE FROM assessments WHERE candidate_id = ?`).bind(candidateId),
    db.prepare(
      `UPDATE candidates SET invite_token = ?, status = 'INVITED', updated_at = ? WHERE id = ?`
    ).bind(newToken, now, candidateId),
  ]);

  return c.json({ inviteToken: newToken });
});

// GET /:candidateId/media — stream media (video/audio) from R2 by r2Key
// Used by the recruiter profile to play candidate video responses.
candidateOps.get('/:candidateId/media', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const r2Key = c.req.query('r2Key');
  const db = c.env.DB;

  if (!r2Key || r2Key.trim().length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'r2Key query parameter is required.');
  }

  // Ownership check via pipeline
  const candidate = await db
    .prepare(
      `SELECT c.id FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND (c.owner_id = ? OR p.owner_id = ?)`
    )
    .bind(candidateId, userId, userId)
    .first<{ id: string }>();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  if (!c.env.STORAGE) {
    return apiError(c, 'SERVER_ERROR', 'Storage not configured.');
  }

  const object = await c.env.STORAGE.get(r2Key.trim());
  if (!object) return apiError(c, 'NOT_FOUND', 'Media file not found in storage.');

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'video/webm',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// DELETE /:candidateId — permanently delete a candidate and all related data
candidateOps.delete('/:candidateId', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  const candidate = await db
    .prepare(
      `SELECT c.id FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND (c.owner_id = ? OR p.owner_id = ?)`
    )
    .bind(candidateId, userId, userId)
    .first<{ id: string }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  // Hard delete with explicit cleanup to avoid FK constraint errors
  // (not all related tables have ON DELETE CASCADE)
  const tables = [
    'candidate_nodes',
    'candidate_coverage',
    'candidate_ingestion',
    'culture_interview_sessions',
    'scheduled_interviews',
    'phone_calls',
    'enrichment_jobs',
    'review_sessions',
    'challenge_submissions',
    'assessments',
    'candidate_challenge_assignment',
    'candidate_profile_state',
    'dev_container_exchange_tokens',
    'step_duration_samples',
  ];
  for (const table of tables) {
    try {
      await db.prepare(`DELETE FROM ${table} WHERE candidate_id = ?`).bind(candidateId).run();
    } catch {
      // table may not exist yet
    }
  }
  await db.prepare(`DELETE FROM candidates WHERE id = ?`).bind(candidateId).run();

  return new Response(null, { status: 204 });
});

export { pipelineCandidates, candidateOps };
