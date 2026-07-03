import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  buildRuleBasedParsedCV,
  extractTextFromResumeFile,
  persistParsedCV,
} from '../lib/cvParser';
import { runCandidateIngestion } from '../lib/candidateDiscovery/orchestrate';
import { processResumeFromR2 } from '../lib/enrichment/resumeIngestion';
import { loadMatchedOpenSourceChallengePacket } from '../lib/openSourceChallengeSessions';
import {
  ensureRolelessTalentPoolIdentity,
  removeRolelessTalentPoolApplicationBridge,
  type TalentPoolSourceArtifactInput,
  type TalentPoolOperationalContextInput,
} from '../lib/talentPoolIdentity';
import type { Env, Variables } from '../types';

interface RolelessTalentPoolIdentity {
  personId: string;
  workspacePersonId: string;
}

type TalentPoolStatus =
  | 'PROFILE_NEEDED'
  | 'PROFILE_RECEIVED'
  | 'PHONE_SCREENER_OFFERED'
  | 'PHONE_SCREENER_SCHEDULED'
  | 'CHALLENGE_PREPARING'
  | 'CHALLENGE_READY'
  | 'ASSESSMENT_IN_PROGRESS'
  | 'COMPLETED';

type PhoneScreenerStatus = 'NOT_REQUESTED' | 'PHONE_SCREENER_OFFERED' | 'PHONE_SCREENER_SCHEDULED';

interface CandidateRow {
  id: string;
  owner_id: string;
  name: string | null;
  email: string | null;
  invite_token: string;
  status: 'INVITED' | 'IN_PROGRESS' | 'COMPLETED';
  pipeline_id: string | null;
  current_stage_id: string | null;
  resume_s3_key: string | null;
  phone_number: string | null;
}

interface IntakeRow {
  status: TalentPoolStatus;
  profile_r2_key: string | null;
  profile_text_excerpt: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  phone_screener_consent: number;
  phone_number: string | null;
  timezone: string | null;
  availability: string | null;
  submitted_at: string | null;
}

interface ReadyChallengeRow {
  title: string | null;
  type: string | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
}

interface CompletedChallengeRow {
  interview_type: string | null;
  updated_at: string | null;
}

interface ReadyChallenge {
  title: string;
  type: string;
  entryUrl: string;
  summary: string;
}

interface CompletedChallenge {
  title: string;
  completedAt: string | null;
  summary: string;
}

interface TalentPoolDashboardResponse {
  status: TalentPoolStatus;
  candidateName: string | null;
  profileReceivedAt: string | null;
  phoneScreener: {
    consent: boolean;
    status: PhoneScreenerStatus;
    phoneNumber: string | null;
    timezone: string | null;
    availability: string | null;
  };
  readyChallenges: ReadyChallenge[];
  completedChallenges: CompletedChallenge[];
}

const route = new Hono<{ Bindings: Env; Variables: Variables }>();
const MAX_PROFILE_FILE_BYTES = 10 * 1024 * 1024;
const TALENT_POOL_LIVE_MAX_NODE_EMBEDDINGS = 0;
const TALENT_POOL_LIVE_MAX_PARSER_ONLY_NODES = 12;
const TALENT_POOL_LIVE_DISCOVERY_TIMEOUT_MS = 8_000;
const TALENT_POOL_LIVE_DISCOVERY_MAX_ATTEMPTS = 2;
const TALENT_POOL_PASTED_PROFILE_SOURCE_KIND = 'pasted_profile_text';
const TALENT_POOL_UPLOADED_PROFILE_SOURCE_KIND = 'uploaded_profile_file';
const ALLOWED_PROFILE_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const optionalUrl = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().max(500).url().optional(),
);

function optionalText(max: number): z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown> {
  return z.preprocess(
    emptyStringToUndefined,
    z.string().trim().max(max).optional(),
  );
}

const resolveSchema = z.object({
  inviteToken: z.string().trim().min(1).max(300),
});

const submitProfileSchema = z.object({
  inviteToken: z.string().trim().min(1).max(300),
  resumeText: z.string().trim().min(20).max(50_000),
  githubUrl: optionalUrl,
  linkedinUrl: optionalUrl,
  portfolioUrl: optionalUrl,
  phoneScreenerConsent: z.boolean().optional().default(false),
  phoneNumber: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().regex(/^\+[1-9]\d{1,14}$/, 'phoneNumber must be E.164 format').optional(),
  ),
  timezone: optionalText(100),
  availability: optionalText(1000),
});

type SubmitProfileInput = z.infer<typeof submitProfileSchema>;
const uploadProfileSchema = submitProfileSchema.omit({ resumeText: true }).extend({
  resumeText: z.string().trim().max(50_000).optional().default(''),
});
type UploadProfileInput = z.infer<typeof uploadProfileSchema>;
type TalentContext = Context<{ Bindings: Env; Variables: Variables }>;

async function readJson(c: TalentContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function errorResponse(
  c: TalentContext,
  code: string,
  message: string,
  status: 400 | 404 | 413 | 415 | 500,
): Response {
  return c.json({ error: { code, message } }, status);
}

async function loadCandidateByInviteToken(
  db: D1Database,
  inviteToken: string,
): Promise<CandidateRow | null> {
  return await db
    .prepare(
      `SELECT id, owner_id, name, email, invite_token, status, pipeline_id,
              current_stage_id, resume_s3_key, phone_number
         FROM candidates
        WHERE invite_token = ?1
        LIMIT 1`,
    )
    .bind(inviteToken)
    .first<CandidateRow>();
}

async function loadIntake(db: D1Database, candidateId: string): Promise<IntakeRow | null> {
  return await db
    .prepare(
      `SELECT status, profile_r2_key, profile_text_excerpt, github_url, linkedin_url,
              portfolio_url, phone_screener_consent, phone_number, timezone,
              availability, submitted_at
         FROM talent_pool_intakes
        WHERE candidate_id = ?1
        LIMIT 1`,
    )
    .bind(candidateId)
    .first<IntakeRow>();
}

function readyChallengeSummary(repositoryUrl: string, githubPrNumber: number): string {
  let repoName = 'the assigned repository';
  try {
    repoName = new URL(repositoryUrl).pathname.replace(/^\//, '') || repoName;
  } catch {
    repoName = 'the assigned repository';
  }
  return `Ready for ${repoName} PR #${githubPrNumber}.`;
}

async function loadReadyChallenges(
  db: D1Database,
  candidateId: string,
  inviteToken: string,
): Promise<ReadyChallenge[]> {
  const result = await db
    .prepare(
      `SELECT ch.title, ch.type, cca.github_repo_url, cca.github_pr_number
         FROM candidate_challenge_assignment cca
         JOIN challenges ch ON ch.id = cca.challenge_id
        WHERE cca.candidate_id = ?1
          AND cca.github_repo_url IS NOT NULL
          AND cca.github_pr_number IS NOT NULL
        ORDER BY cca.assigned_at DESC
        LIMIT 5`,
    )
    .bind(candidateId)
    .all<ReadyChallengeRow>();

  const readyChallenges: ReadyChallenge[] = [];
  for (const row of result.results ?? []) {
    const packet = await loadMatchedOpenSourceChallengePacket(db, {
      repositoryUrl: row.github_repo_url,
      githubPrNumber: row.github_pr_number,
    });
    if (!packet) continue;

    readyChallenges.push({
      title: packet.title || row.title || 'Code review challenge',
      type: row.type ?? 'CODE_REVIEW',
      entryUrl: `/assess/${encodeURIComponent(inviteToken)}`,
      summary: readyChallengeSummary(packet.repositoryUrl, packet.githubPrNumber),
    });
  }
  return readyChallenges;
}

async function loadCompletedChallenges(
  db: D1Database,
  candidateId: string,
): Promise<CompletedChallenge[]> {
  const result = await db
    .prepare(
      `SELECT interview_type, updated_at
         FROM scheduled_interviews
        WHERE candidate_id = ?1
          AND status = 'COMPLETED'
        ORDER BY updated_at DESC
        LIMIT 5`,
    )
    .bind(candidateId)
    .all<CompletedChallengeRow>();

  return (result.results ?? []).map((row) => ({
    title: row.interview_type ? row.interview_type.replace(/_/g, ' ') : 'Completed work',
    completedAt: row.updated_at,
    summary: 'Completed',
  }));
}

function phoneStatus(intake: IntakeRow | null): PhoneScreenerStatus {
  if (!intake?.phone_screener_consent) return 'NOT_REQUESTED';
  return intake.status === 'PHONE_SCREENER_SCHEDULED'
    ? 'PHONE_SCREENER_SCHEDULED'
    : 'PHONE_SCREENER_OFFERED';
}

function dashboardStatus(input: {
  candidate: CandidateRow;
  intake: IntakeRow | null;
  readyChallenges: ReadyChallenge[];
  completedChallenges: CompletedChallenge[];
}): TalentPoolStatus {
  if (input.candidate.status === 'COMPLETED' || input.completedChallenges.length > 0) {
    return 'COMPLETED';
  }
  if (input.candidate.status === 'IN_PROGRESS') return 'ASSESSMENT_IN_PROGRESS';
  if (input.readyChallenges.length > 0) return 'CHALLENGE_READY';
  if (input.intake?.submitted_at || input.candidate.resume_s3_key) return 'CHALLENGE_PREPARING';
  return 'PROFILE_NEEDED';
}

async function buildDashboard(
  db: D1Database,
  candidate: CandidateRow,
): Promise<TalentPoolDashboardResponse> {
  const intake = await loadIntake(db, candidate.id);
  const readyChallenges = await loadReadyChallenges(db, candidate.id, candidate.invite_token);
  const completedChallenges = await loadCompletedChallenges(db, candidate.id);
  const status = dashboardStatus({ candidate, intake, readyChallenges, completedChallenges });

  return {
    status,
    candidateName: candidate.name,
    profileReceivedAt: intake?.submitted_at ?? (candidate.resume_s3_key ? intake?.submitted_at ?? null : null),
    phoneScreener: {
      consent: Boolean(intake?.phone_screener_consent),
      status: phoneStatus(intake),
      phoneNumber: intake?.phone_number ?? candidate.phone_number,
      timezone: intake?.timezone ?? null,
      availability: intake?.availability ?? null,
    },
    readyChallenges,
    completedChallenges,
  };
}

function excerpt(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 1200 ? `${normalized.slice(0, 1197)}...` : normalized;
}

function suggestedRepoFamilies(input: SubmitProfileInput, sourceBackedProfileEvidence = true): string[] {
  if (!sourceBackedProfileEvidence) return [];

  const haystack = [
    input.resumeText,
    input.githubUrl ?? '',
    input.linkedinUrl ?? '',
    input.portfolioUrl ?? '',
  ].join(' ').toLowerCase();
  const families = new Set<string>();
  if (haystack.includes('react') || haystack.includes('frontend')) families.add('frontend application code');
  if (haystack.includes('worker') || haystack.includes('cloudflare')) families.add('edge and serverless systems');
  if (haystack.includes('api') || haystack.includes('backend')) families.add('backend service code');
  if (haystack.includes('accessibility') || haystack.includes('a11y')) families.add('accessible UI systems');
  if (families.size === 0) families.add('general TypeScript application code');
  return [...families];
}

function candidateSummary(
  candidate: CandidateRow,
  input: SubmitProfileInput,
  sourceBackedProfileEvidence = true,
): string {
  const parts = [
    candidate.name ? `Candidate: ${candidate.name}` : null,
    candidate.email ? `Email: ${candidate.email}` : null,
    sourceBackedProfileEvidence
      ? `Profile excerpt: ${excerpt(input.resumeText)}`
      : 'Profile upload received, but no extractable source text was available.',
    input.githubUrl ? `GitHub: ${input.githubUrl}` : null,
    input.linkedinUrl ? `LinkedIn: ${input.linkedinUrl}` : null,
    input.portfolioUrl ? `Portfolio: ${input.portfolioUrl}` : null,
    input.phoneScreenerConsent ? 'Phone screener: candidate is open to a short phone screen.' : null,
  ];
  return parts.filter((part): part is string => Boolean(part)).join('\n');
}

interface ChallengeDesignQueueEvidenceOptions {
  sourceBackedProfileEvidence?: boolean;
}

interface ChallengeDesignQueuePayload {
  summary: string;
  repoFamilies: string;
  missingSignal: string;
  inventoryFailureReason: string;
  desiredAssessmentSignal: string;
}

function challengeDesignQueuePayload(
  candidate: CandidateRow,
  input: SubmitProfileInput,
  options: ChallengeDesignQueueEvidenceOptions = {},
): ChallengeDesignQueuePayload {
  const sourceBackedProfileEvidence = options.sourceBackedProfileEvidence ?? true;
  if (!sourceBackedProfileEvidence) {
    return {
      summary: candidateSummary(candidate, input, false),
      repoFamilies: JSON.stringify([]),
      missingSignal: 'Needs extractable source-backed profile evidence before challenge design.',
      inventoryFailureReason: 'No exact profile or resume source text has been extracted from the uploaded artifact yet.',
      desiredAssessmentSignal: 'Extract source-backed profile or resume evidence before selecting assessment inventory.',
    };
  }

  return {
    summary: candidateSummary(candidate, input, true),
    repoFamilies: JSON.stringify(suggestedRepoFamilies(input, true)),
    missingSignal: 'Needs a validated source-backed challenge assignment for the submitted candidate profile.',
    inventoryFailureReason: 'No ready challenge assignment was available at intake completion.',
    desiredAssessmentSignal: 'Assess code review judgment against source-backed production code once inventory is ready.',
  };
}

function safeFileName(name: string): string {
  const normalized = name.trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+/, '');
  return normalized.slice(0, 160) || 'profile';
}

async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function profileTextStorageKey(candidateId: string, resumeText: string): Promise<string> {
  const textHash = await sha256Hex(new TextEncoder().encode(resumeText));
  return `talent-intake/${candidateId}/${textHash}-profile.txt`;
}

function normalizeProfileContentType(contentType: string, fileName: string): string {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized) return normalized;
  if (fileName.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  if (fileName.toLowerCase().endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (fileName.toLowerCase().endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

function formString(formData: FormData, field: string): string | undefined {
  const value = formData.get(field);
  return typeof value === 'string' ? value : undefined;
}

function formBoolean(formData: FormData, field: string): boolean {
  const value = formString(formData, field);
  return value === 'true' || value === '1' || value === 'on';
}

function operationalContextFromInput(input: SubmitProfileInput): TalentPoolOperationalContextInput {
  return {
    githubUrl: input.githubUrl,
    linkedinUrl: input.linkedinUrl,
    portfolioUrl: input.portfolioUrl,
    phoneScreenerConsent: input.phoneScreenerConsent,
    phoneNumber: input.phoneNumber,
    timezone: input.timezone,
    availability: input.availability,
  };
}

interface ProfileFileEntry {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function isProfileFileEntry(value: unknown): value is ProfileFileEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string'
    && typeof candidate.type === 'string'
    && typeof candidate.size === 'number'
    && typeof candidate.arrayBuffer === 'function'
  );
}

function queueBackgroundTask(c: TalentContext, label: string, task: () => Promise<unknown>): void {
  let executionCtx: ExecutionContext | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    return;
  }
  if (!executionCtx || typeof executionCtx.waitUntil !== 'function') return;

  executionCtx.waitUntil(
    task().catch((err) => {
      console.error(`[talentPool/${label}] background task failed:`, err instanceof Error ? err.message : String(err));
    }),
  );
}

async function ingestTextProfile(input: {
  env: Env;
  candidateId: string;
  resumeText: string;
  mirrorLivingContext?: boolean;
}): Promise<void> {
  const parsedCV = buildRuleBasedParsedCV(input.resumeText);
  await persistParsedCV(input.env.DB, input.candidateId, parsedCV);
  await runCandidateIngestion({
    env: input.env,
    db: input.env.DB,
    candidateId: input.candidateId,
    parsed: parsedCV,
    resumeText: input.resumeText,
    decompositionResult: null,
    mirrorLivingContext: input.mirrorLivingContext ?? false,
    maxNodeEmbeddings: TALENT_POOL_LIVE_MAX_NODE_EMBEDDINGS,
    maxParserOnlyNodes: TALENT_POOL_LIVE_MAX_PARSER_ONLY_NODES,
    skipPostDecompositionMaintenance: true,
    candidateDiscoveryTimeoutMs: TALENT_POOL_LIVE_DISCOVERY_TIMEOUT_MS,
    candidateDiscoveryMaxAttempts: TALENT_POOL_LIVE_DISCOVERY_MAX_ATTEMPTS,
  });
}

function queueProfileIngestion(input: {
  c: TalentContext;
  candidateId: string;
  profileKey: string;
  contentType: string;
  resumeText: string;
  livingContextIdentity?: RolelessTalentPoolIdentity | null;
  sourceTextUnavailable?: boolean;
}): void {
  const trimmedText = input.resumeText.trim();
  if (trimmedText.length >= 20) {
    queueBackgroundTask(
      input.c,
      'text-ingestion',
      async () => {
        await ingestTextProfile({
          env: input.c.env,
          candidateId: input.candidateId,
          resumeText: trimmedText,
          mirrorLivingContext: false,
        });
        await removeRolelessTalentPoolApplicationBridge({
          db: input.c.env.DB,
          candidateId: input.candidateId,
        });
      },
    );
    return;
  }

  if (
    !input.sourceTextUnavailable
    && (
      input.contentType === 'application/pdf'
      || input.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  ) {
    queueBackgroundTask(
      input.c,
      'document-ingestion',
      async () => {
        await processResumeFromR2({
          env: input.c.env,
          db: input.c.env.DB,
          candidateId: input.candidateId,
          r2Key: input.profileKey,
          livingContextIdentity: input.livingContextIdentity ?? null,
        });
        await removeRolelessTalentPoolApplicationBridge({
          db: input.c.env.DB,
          candidateId: input.candidateId,
        });
      },
    );
  }
}

async function ensureCandidateIngestionQueued(
  db: D1Database,
  candidateId: string,
  input: SubmitProfileInput,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO candidate_ingestion (
         candidate_id, status, github_url, linkedin_url, current_step, created_at, updated_at
       )
       VALUES (?1, 'pending', ?2, ?3, 'talent_pool_profile_received', ?4, ?4)
       ON CONFLICT(candidate_id) DO UPDATE SET
         status = CASE
           WHEN status IN ('embedded', 'enriched', 'matched') THEN status
           ELSE 'pending'
         END,
         github_url = COALESCE(excluded.github_url, github_url),
         linkedin_url = COALESCE(excluded.linkedin_url, linkedin_url),
         current_step = CASE
           WHEN status IN ('embedded', 'enriched', 'matched') THEN COALESCE(current_step, excluded.current_step)
           ELSE excluded.current_step
         END,
         error_text = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(candidateId, input.githubUrl ?? null, input.linkedinUrl ?? null, now)
    .run();
}

async function markProfileTextExtractionNeeded(
  db: D1Database,
  candidateId: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE candidate_ingestion
          SET status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END,
              current_step = 'profile_text_extraction_needed',
              error_text = NULL,
              updated_at = ?1
        WHERE candidate_id = ?2`,
    )
    .bind(now, candidateId)
    .run();
}

async function persistIntake(
  c: TalentContext,
  candidate: CandidateRow,
  input: SubmitProfileInput,
  now: string,
  options: {
    profileKey?: string;
    profileExcerpt?: string;
    sourceTextForPerson?: string;
    sourceMediaTypeForPerson?: string;
    sourceArtifactForPerson?: TalentPoolSourceArtifactInput;
  } = {},
): Promise<RolelessTalentPoolIdentity | null> {
  const profileKey = options.profileKey ?? await profileTextStorageKey(candidate.id, input.resumeText);
  if (!options.profileKey) {
    await c.env.STORAGE.put(profileKey, input.resumeText, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
      customMetadata: {
        source: 'talent_pool_intake',
        candidateId: candidate.id,
        sourceKind: TALENT_POOL_PASTED_PROFILE_SOURCE_KIND,
      },
    });
  }

  await c.env.DB
    .prepare(
      `INSERT INTO talent_pool_intakes (
         candidate_id, status, profile_r2_key, profile_text_excerpt,
         github_url, linkedin_url, portfolio_url, phone_screener_consent,
         phone_number, timezone, availability, submitted_at, created_at, updated_at
       )
       VALUES (
         ?1, 'CHALLENGE_PREPARING', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?11
       )
       ON CONFLICT(candidate_id) DO UPDATE SET
         status = 'CHALLENGE_PREPARING',
         profile_r2_key = excluded.profile_r2_key,
         profile_text_excerpt = excluded.profile_text_excerpt,
         github_url = excluded.github_url,
         linkedin_url = excluded.linkedin_url,
         portfolio_url = excluded.portfolio_url,
         phone_screener_consent = excluded.phone_screener_consent,
         phone_number = excluded.phone_number,
         timezone = excluded.timezone,
         availability = excluded.availability,
         submitted_at = excluded.submitted_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      candidate.id,
      profileKey,
      options.profileExcerpt ?? excerpt(input.resumeText),
      input.githubUrl ?? null,
      input.linkedinUrl ?? null,
      input.portfolioUrl ?? null,
      input.phoneScreenerConsent ? 1 : 0,
      input.phoneNumber ?? null,
      input.timezone ?? null,
      input.availability ?? null,
      now,
    )
    .run();

  await c.env.DB
    .prepare(
      `UPDATE candidates
          SET resume_s3_key = ?1,
              phone_number = COALESCE(?2, phone_number),
              updated_at = ?3
        WHERE id = ?4`,
    )
    .bind(profileKey, input.phoneNumber ?? null, now, candidate.id)
    .run();

  await ensureCandidateIngestionQueued(c.env.DB, candidate.id, input, now);

  const candidateEmail = candidate.email?.trim() || null;
  const sourceTextForPerson = options.sourceTextForPerson ?? (!options.profileKey ? input.resumeText : undefined);
  return await ensureRolelessTalentPoolIdentity({
    db: c.env.DB,
    userId: candidate.owner_id,
    candidateId: candidate.id,
    name: candidate.name?.trim() || candidateEmail || 'Talent Pool Candidate',
    email: candidateEmail,
    message: sourceTextForPerson,
    messageStorageKey: options.profileKey && sourceTextForPerson ? profileKey : null,
    messageMediaType: options.profileKey && sourceTextForPerson
      ? options.sourceMediaTypeForPerson ?? 'text/plain'
      : null,
    sourceArtifact: options.sourceArtifactForPerson,
    operationalContext: operationalContextFromInput(input),
    now,
  });
}

async function ensureChallengeDesignQueueItem(
  db: D1Database,
  candidate: CandidateRow,
  input: SubmitProfileInput,
  now: string,
  options: ChallengeDesignQueueEvidenceOptions = {},
): Promise<void> {
  const existing = await db
    .prepare(
      `SELECT id
         FROM challenge_design_queue
        WHERE candidate_id = ?1
          AND status IN ('queued', 'in_review')
        LIMIT 1`,
    )
    .bind(candidate.id)
    .first<{ id: string }>();

  const payload = challengeDesignQueuePayload(candidate, input, options);

  if (existing) {
    await db
      .prepare(
        `UPDATE challenge_design_queue
            SET candidate_summary = ?1,
                missing_signal = ?2,
                inventory_failure_reason = ?3,
                suggested_repo_families = ?4,
                desired_assessment_signal = ?5,
                updated_at = ?6
          WHERE id = ?7`,
      )
      .bind(
        payload.summary,
        payload.missingSignal,
        payload.inventoryFailureReason,
        payload.repoFamilies,
        payload.desiredAssessmentSignal,
        now,
        existing.id,
      )
      .run();
    return;
  }

  await db
    .prepare(
      `INSERT INTO challenge_design_queue (
         id, candidate_id, owner_id, status, candidate_summary, missing_signal,
         inventory_failure_reason, suggested_repo_families, desired_assessment_signal,
         proposed_challenge_type, validation_status, created_at, updated_at
       )
       VALUES (
         ?1, ?2, ?3, 'queued', ?4, ?5, ?6, ?7, ?8, 'CODE_REVIEW', 'needs_design', ?9, ?9
       )`,
    )
    .bind(
      crypto.randomUUID(),
      candidate.id,
      candidate.owner_id,
      payload.summary,
      payload.missingSignal,
      payload.inventoryFailureReason,
      payload.repoFamilies,
      payload.desiredAssessmentSignal,
      now,
    )
    .run();
}

route.post('/resolve-token', async (c) => {
  const parsed = resolveSchema.safeParse(await readJson(c));
  if (!parsed.success) {
    return errorResponse(c, 'BAD_REQUEST', 'inviteToken is required.', 400);
  }

  const candidate = await loadCandidateByInviteToken(c.env.DB, parsed.data.inviteToken);
  if (!candidate) return errorResponse(c, 'NOT_FOUND', 'Invite not found.', 404);

  return c.json(await buildDashboard(c.env.DB, candidate));
});

route.post('/upload-profile', async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return errorResponse(c, 'BAD_REQUEST', 'Request must be multipart/form-data.', 400);
  }

  const fileEntry = formData.get('file') as unknown;
  if (!isProfileFileEntry(fileEntry)) {
    return errorResponse(c, 'BAD_REQUEST', 'A profile file is required.', 400);
  }

  const contentType = normalizeProfileContentType(fileEntry.type, fileEntry.name);
  if (!ALLOWED_PROFILE_MIME_TYPES.has(contentType)) {
    return errorResponse(
      c,
      'UNSUPPORTED_MEDIA_TYPE',
      'Upload a PDF, DOCX, or plain text profile file.',
      415,
    );
  }

  if (fileEntry.size > MAX_PROFILE_FILE_BYTES) {
    return errorResponse(c, 'PAYLOAD_TOO_LARGE', 'Profile file exceeds the 10 MB limit.', 413);
  }

  const parsed = uploadProfileSchema.safeParse({
    inviteToken: formString(formData, 'inviteToken'),
    resumeText: formString(formData, 'resumeText') ?? '',
    githubUrl: formString(formData, 'githubUrl'),
    linkedinUrl: formString(formData, 'linkedinUrl'),
    portfolioUrl: formString(formData, 'portfolioUrl'),
    phoneScreenerConsent: formBoolean(formData, 'phoneScreenerConsent'),
    phoneNumber: formString(formData, 'phoneNumber'),
    timezone: formString(formData, 'timezone'),
    availability: formString(formData, 'availability'),
  });
  if (!parsed.success) {
    return errorResponse(
      c,
      'BAD_REQUEST',
      parsed.error.issues[0]?.message ?? 'Profile upload payload is invalid.',
      400,
    );
  }

  const candidate = await loadCandidateByInviteToken(c.env.DB, parsed.data.inviteToken);
  if (!candidate) return errorResponse(c, 'NOT_FOUND', 'Invite not found.', 404);

  const now = new Date().toISOString();
  const rawFileName = safeFileName(fileEntry.name);
  const arrayBuffer = await fileEntry.arrayBuffer();
  const fileHash = await sha256Hex(arrayBuffer);
  const profileKey = `talent-intake/${candidate.id}/${fileHash}-${rawFileName}`;
  let resumeText = parsed.data.resumeText.trim();
  let foregroundDocumentExtractionAttempted = false;
  if (contentType === 'text/plain' && resumeText.length === 0) {
    resumeText = new TextDecoder().decode(arrayBuffer).trim().slice(0, 50_000);
  }
  if (
    resumeText.length === 0
    && (contentType === 'application/pdf'
      || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  ) {
    foregroundDocumentExtractionAttempted = true;
    try {
      resumeText = (await extractTextFromResumeFile(arrayBuffer, contentType)).trim().slice(0, 50_000);
    } catch (err) {
      console.error('[talentPool/upload-profile] profile text extraction failed:', {
        candidateId: candidate.id,
        fileName: rawFileName,
        contentType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const sourceTextUnavailable = foregroundDocumentExtractionAttempted && resumeText.length < 20;

  const profileInput: SubmitProfileInput = {
    ...parsed.data,
    resumeText: resumeText.length >= 20 ? resumeText : `Uploaded profile file: ${rawFileName}`,
  };

  await c.env.STORAGE.put(profileKey, arrayBuffer, {
    httpMetadata: { contentType },
    customMetadata: {
      source: 'talent_pool_intake',
      candidateId: candidate.id,
      sourceKind: TALENT_POOL_UPLOADED_PROFILE_SOURCE_KIND,
      originalFileName: rawFileName,
    },
  });

  const livingContextIdentity = await persistIntake(c, candidate, profileInput, now, {
    profileKey,
    profileExcerpt: resumeText.length >= 20 ? excerpt(resumeText) : `Uploaded ${rawFileName}`,
    sourceTextForPerson: resumeText.length >= 20 ? resumeText : undefined,
    sourceMediaTypeForPerson: contentType,
    sourceArtifactForPerson: {
      storageKey: profileKey,
      mediaType: contentType,
      contentHash: fileHash,
      byteLength: arrayBuffer.byteLength,
      originalFileName: rawFileName,
      extractedTextAvailable: resumeText.length >= 20,
    },
  });
  if (sourceTextUnavailable) {
    await markProfileTextExtractionNeeded(c.env.DB, candidate.id, now);
  }

  const readyChallenges = await loadReadyChallenges(c.env.DB, candidate.id, candidate.invite_token);
  if (readyChallenges.length === 0) {
    await ensureChallengeDesignQueueItem(c.env.DB, candidate, profileInput, now, {
      sourceBackedProfileEvidence: resumeText.length >= 20,
    });
  }
  queueProfileIngestion({
    c,
    candidateId: candidate.id,
    profileKey,
    contentType,
    resumeText,
    livingContextIdentity,
    sourceTextUnavailable,
  });

  const refreshed = await loadCandidateByInviteToken(c.env.DB, parsed.data.inviteToken);
  if (!refreshed) return errorResponse(c, 'NOT_FOUND', 'Invite not found.', 404);

  return c.json(await buildDashboard(c.env.DB, refreshed));
});

route.post('/submit-profile', async (c) => {
  const parsed = submitProfileSchema.safeParse(await readJson(c));
  if (!parsed.success) {
    return errorResponse(
      c,
      'BAD_REQUEST',
      parsed.error.issues[0]?.message ?? 'Profile payload is invalid.',
      400,
    );
  }

  const candidate = await loadCandidateByInviteToken(c.env.DB, parsed.data.inviteToken);
  if (!candidate) return errorResponse(c, 'NOT_FOUND', 'Invite not found.', 404);

  const now = new Date().toISOString();
  await persistIntake(c, candidate, parsed.data, now);

  const readyChallenges = await loadReadyChallenges(c.env.DB, candidate.id, candidate.invite_token);
  if (readyChallenges.length === 0) {
    await ensureChallengeDesignQueueItem(c.env.DB, candidate, parsed.data, now);
  }
  queueProfileIngestion({
    c,
    candidateId: candidate.id,
    profileKey: `talent-intake/${candidate.id}/${now.replace(/[:.]/g, '-')}.txt`,
    contentType: 'text/plain',
    resumeText: parsed.data.resumeText,
  });

  const refreshed = await loadCandidateByInviteToken(c.env.DB, parsed.data.inviteToken);
  if (!refreshed) return errorResponse(c, 'NOT_FOUND', 'Invite not found.', 404);

  return c.json(await buildDashboard(c.env.DB, refreshed));
});

export { route as talentPoolPublic };
