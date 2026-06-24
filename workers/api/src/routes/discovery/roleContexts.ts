/**
 * Role Context Routes — Multi-Stakeholder Role Discovery (ADR-028)
 *
 * POST /api/v1/role-contexts                — Create with baseline + creator participant
 * GET  /api/v1/role-contexts/:id            — Retrieve full state + participants
 * GET  /api/v1/role-contexts/:id/living-context — Retrieve source-backed role graph
 * POST /api/v1/role-contexts/:id/start      — Start interview (returns calibration question)
 * POST /api/v1/role-contexts/:id/respond    — Submit answer, get next question (per-participant)
 * POST /api/v1/role-contexts/:id/complete   — Force-complete a participant's interview
 * POST /api/v1/role-contexts/:id/invite     — Send interview invitations to team members
 * POST /api/v1/role-contexts/parse-jd       — Parse JD text or PDF into baseline
 * POST /api/v1/role-contexts/transcribe     — Whisper transcription for voice input
 * PATCH /api/v1/role-contexts/:id           — Link role context to a pipeline
 *
 * All routes require Clerk JWT auth. Ownership enforced on all mutations.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { createRoleContextSchema, createSimpleJobDescriptionRoleContextSchema, respondSchema, inviteSchema, calibrateSchema, synthesizeSchema, PARTICIPANT_ROLES } from '../../validation/roleContexts';
import { mergeKnowledgeState } from '../../lib/agents/interview/reducer';
import { callGapFillingAgent } from '../../lib/agents/calibration/gapFilling';
import { interviewReducer, createInitialState, selectPhase, readDomainCoverage, readEvpCoverage, readStories, readBooleanFlag, readProbesDelivered, readSoulProbesDelivered, readEnableSoulTrack } from '../../lib/agents/interview/reducer';
import { DOMAIN_COLUMN_ORDER } from '../../lib/agents/interview/types';
import { analyzeFeedback } from '../../lib/agents/question/feedbackAnalyzer';
// synthesizeRcd replaces the legacy synthesize() — removed in migration
import { synthesizeRcd, type SynthesizeRcdResult } from '../../lib/roleAgent/synthesizeRcd';
import { decomposeRcdIntoNodes, persistRoleNodes } from '../../lib/roleAgent/decomposeRcd';
import { deriveJobDescriptionFromRcd } from '../../lib/roleAgent/deriveJobDescription';
import { calibrateRcd } from '../../lib/roleAgent/calibrateRcd';
import { buildConversationContext, buildPhaseDirective } from '../../lib/roleAgentPrompts';
import { createRoleAgentProvider, createRoleAgentFallbackProvider, createRoleAgentSynthesisProvider, createRoleAgentSynthesisFallbackProvider } from '../../lib/llm/createProvider';
import { recordAiUsage } from '../../lib/aiUsage';
import { parseJobDescription } from '../../lib/jdParser';
import { sendNotificationEmail } from '../../lib/email';
import { embedAndUpsertRole } from '../../lib/roleDiscovery/embedRole';
import { buildRoleSearchableProfile } from '../../lib/roleDiscovery/buildRoleProfile';
import { buildRcdSearchProfile } from '../../lib/repoDiscovery/rcdSearchProfile';
import { LivingContextStore } from '../../lib/livingContext/persistence';
import { OPEN_TERM_RESOLVER_VERSION, openSemanticTerm } from '../../lib/livingContext/openTerms';
import { loadRoleContextLivingContext } from '../../lib/livingContext/readModel';
import type { Env, Variables, RoleContextRow, RoleContextParticipantRow, RoleExchange, ParticipantRole, RoleContextDocument } from '../../types';

export const roleContexts = new Hono<{ Bindings: Env; Variables: Variables }>();
roleContexts.use('*', authMiddleware);

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parseJsonColumn<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function now(): string {
  return new Date().toISOString();
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeSourceTerm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isTermBoundary(value: string | undefined): boolean {
  return !value || !/[a-z0-9+#.]/i.test(value);
}

function sourceContainsLiteralTerm(normalizedSource: string, normalizedTerm: string): boolean {
  let index = normalizedSource.indexOf(normalizedTerm);
  while (index >= 0) {
    const before = normalizedSource[index - 1];
    const after = normalizedSource[index + normalizedTerm.length];
    if (isTermBoundary(before) && isTermBoundary(after)) return true;
    index = normalizedSource.indexOf(normalizedTerm, index + 1);
  }
  return false;
}

function sourceBackedSelectedTerms(
  jobDescriptionMd: string,
  selectedTerms: string[] | undefined,
): { backedTerms: string[]; rejectedTerms: string[] } {
  if (!selectedTerms?.length) return { backedTerms: [], rejectedTerms: [] };
  const normalizedSource = normalizeSourceTerm(jobDescriptionMd);
  const backedTerms: string[] = [];
  const rejectedTerms: string[] = [];
  const seen = new Set<string>();
  for (const rawTerm of selectedTerms) {
    const term = rawTerm.trim();
    const normalizedTerm = normalizeSourceTerm(term);
    if (!term || seen.has(normalizedTerm)) continue;
    if (!sourceContainsLiteralTerm(normalizedSource, normalizedTerm)) {
      rejectedTerms.push(term);
      seen.add(normalizedTerm);
      continue;
    }
    backedTerms.push(term);
    seen.add(normalizedTerm);
  }
  return { backedTerms, rejectedTerms };
}

async function persistSimpleJobDescriptionContext(input: {
  db: D1Database;
  roleContextId: string;
  pipelineId: string | null;
  title: string;
  jobDescriptionMd: string;
  selectedTerms: string[];
  timestamp: string;
}): Promise<void> {
  const contentHash = `sha256:${await sha256Hex(input.jobDescriptionMd)}`;
  const encoded = new TextEncoder().encode(input.jobDescriptionMd);
  const lineCount = input.jobDescriptionMd.split(/\r\n|\r|\n/).length;
  const store = new LivingContextStore(input.db, () => input.timestamp);
  const artifact = await store.upsertArtifact({
    ingestionKey: `role-context:${input.roleContextId}:job-description`,
    artifactType: 'job_description',
    logicalKey: `role-context/${input.roleContextId}/job-description.md`,
    metadata: {
      roleContextId: input.roleContextId,
      pipelineId: input.pipelineId,
      source: 'simple_job_description',
    },
  });
  const version = await store.createArtifactVersion({
    ingestionKey: `role-context:${input.roleContextId}:job-description:${contentHash}`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/markdown',
    contentText: input.jobDescriptionMd,
    byteLength: encoded.byteLength,
    metadata: {
      roleContextId: input.roleContextId,
      source: 'simple_job_description',
    },
  });
  const span = await store.createSourceSpan({
    ingestionKey: `role-context:${input.roleContextId}:job-description:span:full`,
    artifactVersionId: version.id,
    stableSegmentId: 'job-description-full',
    byteStart: 0,
    byteEnd: encoded.byteLength,
    charStart: 0,
    charEnd: input.jobDescriptionMd.length,
    lineStart: 1,
    lineEnd: lineCount,
    exactText: input.jobDescriptionMd,
    metadata: {
      roleContextId: input.roleContextId,
      source: 'simple_job_description',
    },
  });

  const contextConcepts: Array<{ conceptId: string; relationship: string; weight: number }> = [];
  for (const selectedTerm of input.selectedTerms) {
    const term = openSemanticTerm(selectedTerm);
    if (!term) continue;
    const concept = await store.upsertConcept({
      ingestionKey: `role-context:${input.roleContextId}:selected-term:${term.canonicalKey}`,
      canonicalKey: term.canonicalKey,
      namespace: 'term',
      label: term.surface,
      metadata: {
        resolver: OPEN_TERM_RESOLVER_VERSION,
        source: 'simple_job_description',
        roleContextId: input.roleContextId,
      },
    });
    contextConcepts.push({
      conceptId: concept.id,
      relationship: 'source_term',
      weight: 1,
    });
  }

  await store.upsertContextRecord({
    ingestionKey: `role-context:${input.roleContextId}:job-description-context`,
    scopeType: 'role_context',
    scopeId: input.roleContextId,
    recordType: 'simple_job_description',
    predicate: 'defines role source text',
    narrative: `Simple job description source for ${input.title}.`,
    qualifiers: {
      roleContextId: input.roleContextId,
      pipelineId: input.pipelineId,
      selectedTerms: input.selectedTerms,
      contentHash,
    },
    confidence: 1,
    extractionVersion: 'simple-jd-v1',
    observedAt: input.timestamp,
    sources: [{ sourceSpanId: span.id, evidenceRole: 'source' }],
    entities: [
      {
        entityType: 'role_context',
        entityId: input.roleContextId,
        relationship: 'scope',
      },
      {
        entityType: 'job_description',
        entityId: artifact.id,
        relationship: 'source_artifact',
        metadata: {
          artifactVersionId: version.id,
          sourceSpanId: span.id,
          contentHash,
        },
      },
      ...input.selectedTerms.map((term) => ({
        entityType: 'selected_term',
        relationship: 'literal_term',
        value: { surface: term },
      })),
    ],
    concepts: contextConcepts,
  });
}

// ─── InterviewState reconstruction (new architecture backwards compatibility) ─

function reconstructInterviewStateFromDb(
  row: RoleContextRow,
  participant: RoleContextParticipantRow,
): import('../../lib/agents/interview/types').InterviewState {
  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const knowledgeState = parseJsonColumn<Record<string, Record<string, unknown>>>(row.knowledge_state, {});
  const exchanges = parseJsonColumn<RoleExchange[]>(participant.exchanges, []);
  const questionsAsked = participant.questions_asked;
  const questionBudget = participant.question_budget;
  const participantRole = (participant.participant_role as import('../../types').ParticipantRole | null) ?? null;

  const coverage = readDomainCoverage(knowledgeState);
  const phaseResult = selectPhase({
    questionsAsked,
    questionBudget,
    domainCoverage: coverage,
    evpCoverage: readEvpCoverage(knowledgeState),
    storiesExtracted: readStories(knowledgeState),
    mustHavesPrioritized: readBooleanFlag(knowledgeState, '_mustHavesPrioritized'),
    frictionProbed: readBooleanFlag(knowledgeState, '_frictionProbed'),
    dayInLifeProbed: readBooleanFlag(knowledgeState, '_dayInLifeProbed'),
    probesDelivered: readProbesDelivered(knowledgeState),
    soulProbesDelivered: readSoulProbesDelivered(knowledgeState),
    enableSoulTrack: readEnableSoulTrack(knowledgeState, baseline),
  });

  // Restore persisted domain state (column-by-column tracking) or initialize fresh
  const persistedDomainState = parseJsonColumn<{
    currentDomain: string | null;
    domainCompletion: Record<string, string>;
    domainQuestions: Record<string, unknown[]>;
    domainQuestionsDelivered: Record<string, number>;
    domainFollowUpsDelivered: number;
  } | null>(participant.domain_state, null);

  let currentDomain: import('../../lib/agents/interview/types').InterviewState['currentDomain'] = null;
  let domainCompletion: Record<string, import('../../lib/agents/interview/types').DomainCompletionStatus> = {};
  let domainQuestions: Record<string, import('../../lib/agents/interview/types').GeneratedQuestion[]> = {};
  let domainQuestionsDelivered: Record<string, number> = {};
  let domainFollowUpsDelivered = 0;

  if (persistedDomainState) {
    currentDomain = (persistedDomainState.currentDomain as import('../../lib/agents/interview/types').InterviewState['currentDomain']) ?? null;
    domainCompletion = (persistedDomainState.domainCompletion ?? {}) as Record<string, import('../../lib/agents/interview/types').DomainCompletionStatus>;
    domainQuestions = (persistedDomainState.domainQuestions ?? {}) as Record<string, import('../../lib/agents/interview/types').GeneratedQuestion[]>;
    domainQuestionsDelivered = persistedDomainState.domainQuestionsDelivered ?? {};
    domainFollowUpsDelivered = persistedDomainState.domainFollowUpsDelivered ?? 0;
    // Ensure all domains have entries
    for (const d of DOMAIN_COLUMN_ORDER) {
      if (!domainCompletion[d]) domainCompletion[d] = 'pending';
      if (domainQuestionsDelivered[d] === undefined) domainQuestionsDelivered[d] = 0;
    }
  } else {
    for (const d of DOMAIN_COLUMN_ORDER) {
      domainCompletion[d] = 'pending';
      domainQuestionsDelivered[d] = 0;
    }
  }

  return {
    baseline,
    participantRole,
    questionBudget,
    exchanges,
    knowledgeState,
    coverage,
    phase: phaseResult.phase,
    questionsAsked,
    synthesisReady: questionsAsked >= questionBudget || phaseResult.synthesisAllowed,
    reasoning: phaseResult.reasoning,
    urgentGaps: phaseResult.urgentGaps,
    questionStack: [],
    currentDomain,
    domainCompletion,
    domainQuestions,
    domainQuestionsDelivered,
    domainFollowUpsDelivered,
  };
}

/**
 * Build a searchable profile from the role's job description + persona.
 * Best-effort: if embedding fails we log and move on — role discovery
 * must never block on the vector layer.
 */
export async function buildAndStoreRoleEmbedding(
  env: Env,
  roleContextId: string,
  jobDescription: string,
  persona: unknown,
): Promise<void> {
  // Step 0: read row to check for RCD (preferred) before falling back to JD+persona
  const rc = await env.DB.prepare('SELECT rcd_json FROM role_contexts WHERE id = ?')
    .bind(roleContextId)
    .first<{ rcd_json: string | null }>();

  let profile: string | null = null;

  if (rc?.rcd_json) {
    try {
      const rcd = JSON.parse(rc.rcd_json) as RoleContextDocument;
      profile = buildRcdSearchProfile(rcd);
    } catch {
      // ignore parse errors — fall through to legacy path
    }
  }

  if (!profile) {
    profile = buildRoleSearchableProfile(jobDescription, persona);
  }

  if (!profile || profile.trim().length < 50) {
    console.warn(`[roleContexts] skipping role embed for ${roleContextId}: profile too short`);
    return;
  }

  try {
    // Step 1: persist the searchable profile
    await env.DB.prepare(
      `UPDATE role_contexts SET role_searchable_profile = ?, updated_at = ? WHERE id = ?`,
    ).bind(profile, now(), roleContextId).run();

    // Step 2: read row back for metadata fields
    const rcRow = await env.DB.prepare('SELECT * FROM role_contexts WHERE id = ?')
      .bind(roleContextId)
      .first<RoleContextRow>();
    if (!rcRow) {
      console.warn(`[roleContexts] role context ${roleContextId} not found after profile update`);
      return;
    }

    // Step 3: build metadata (only non-null values)
    const metadata: Record<string, string | number | boolean> = {};
    if (rcRow.pipeline_id) metadata.pipeline_id = rcRow.pipeline_id;
    if (rcRow.rcd_json) {
      try {
        const rcd = JSON.parse(rcRow.rcd_json) as { technical_context?: { seniority_band?: string } };
        if (rcd.technical_context?.seniority_band) {
          metadata.seniority_band = rcd.technical_context.seniority_band;
        }
      } catch {
        // ignore parse errors
      }
    }

    // Step 4: embed and upsert via shared library
    await embedAndUpsertRole({
      ai: env.AI,
      vectorize: env.ROLE_INDEX,
      roleContextId: rcRow.id,
      profile,
      metadata,
      db: env.DB,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[roleContexts] role embed failed for ${roleContextId}:`, msg);
  }
}

/**
 * Run RCD synthesis across all participant transcripts for a role context.
 * Returns the RCD, derived persona, derived job description, and legacy synthesis string.
 */
async function runRcdSynthesis(
  env: Env,
  roleContextId: string,
  baseline: Record<string, unknown>,
): Promise<{ rcd: RoleContextDocument; persona: unknown; jobDescription: string; synthesis: string; issues: unknown[]; passed: boolean } | null> {
  const participantRows = await env.DB.prepare(
    'SELECT * FROM role_context_participants WHERE role_context_id = ?1 ORDER BY is_creator DESC, created_at ASC',
  )
    .bind(roleContextId)
    .all<RoleContextParticipantRow>();

  const participants = participantRows.results ?? [];
  if (participants.length === 0) return null;

  const stakeholderTranscripts = participants
    .filter((p) => p.participant_role && p.exchanges)
    .map((p) => ({
      stakeholder_type: p.participant_role as import('../../types').StakeholderType,
      interviewee_label: p.name || p.participant_role || 'Unknown',
      exchanges: parseJsonColumn<RoleExchange[]>(p.exchanges, []),
      knowledge_state: {},
    }));

  if (stakeholderTranscripts.length === 0) return null;

  const provider = createRoleAgentProvider(env);
  if (!provider) return null;

  try {
    const result = await synthesizeRcd({
      provider,
      roleContextId,
      pipelineId: (baseline.pipelineId as string | undefined) ?? '',
      baseline,
      stakeholderTranscripts,
    });

    const rcd = result.rcd;
    const persona = rcd.consumer_slice;
    const fallbackTitle = typeof baseline.title === 'string' ? baseline.title : '';
    const jobDescription = deriveJobDescriptionFromRcd(rcd, fallbackTitle);
    const synthesis = typeof persona.archetype === 'string' ? persona.archetype : '';

    return {
      rcd,
      persona,
      jobDescription,
      synthesis,
      issues: result.issues,
      passed: result.passed,
    };
  } catch (err) {
    console.error('[roleContexts] RCD synthesis failed:', err);
    return null;
  }
}

/**
 * Run RCD synthesis for a single participant from an InterviewState.
 * Used by the /synthesize endpoint (frontend calls this when synthesisReady).
 * Returns the RCD, derived persona, derived job description, and legacy synthesis string.
 */
async function runSingleParticipantRcdSynthesis(
  state: import('../../lib/agents/interview/types').InterviewState,
  roleContextId: string,
  provider: import('../../lib/llm/types').LLMProvider,
): Promise<{ rcd: RoleContextDocument; persona: unknown; jobDescription: string; synthesis: string; issues: unknown[]; passed: boolean } | null> {
  const baseline = state.baseline;
  const stakeholderTranscripts = [
    {
      stakeholder_type: (state.participantRole ?? 'HIRING_MANAGER') as import('../../types').StakeholderType,
      interviewee_label: state.participantRole ?? 'Hiring Manager',
      exchanges: state.exchanges,
      knowledge_state: state.knowledgeState,
    },
  ];

  try {
    const result = await synthesizeRcd({
      provider,
      roleContextId,
      pipelineId: (baseline.pipelineId as string | undefined) ?? '',
      baseline,
      stakeholderTranscripts,
    });

    const rcd = result.rcd;
    const persona = rcd.consumer_slice;
    const fallbackTitle = typeof baseline.title === 'string' ? baseline.title : '';
    const jobDescription = deriveJobDescriptionFromRcd(rcd, fallbackTitle);
    const synthesis = typeof (persona as unknown as Record<string, unknown>).archetype === 'string'
      ? (persona as unknown as Record<string, unknown>).archetype as string
      : '';

    return {
      rcd,
      persona,
      jobDescription,
      synthesis,
      issues: result.issues,
      passed: result.passed,
    };
  } catch (err) {
    console.error('[roleContexts] Single-participant RCD synthesis failed:', err);
    return null;
  }
}

// ─── New Architecture Turn Handler ────────────────────────────────────────────

interface NewTurnResult {
  type: 'question' | 'synthesis';
  acknowledgment: string;
  question?: import('../../lib/agents/question/generator').GeneratedQuestion['question'];
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, import('../../types').DomainCoverage>;
  state: import('../../lib/agents/interview/types').InterviewState;
  persona?: unknown;
  jobDescription?: string;
  rcd?: RoleContextDocument;
  synthesis?: string;
  toolsUsed: string[];
}

/**
 * Run a single turn using the new architecture (reducer + generator).
 * Replaces callRoleAgent in the /respond path.
 */
async function runNewArchitectureTurn(
  opts: {
    isCalibration: boolean;
    answer: string;
    participantRole: string | null;
    row: RoleContextRow;
    participant: RoleContextParticipantRow;
    clientState: import('../../lib/agents/interview/types').InterviewState | undefined;
    provider: ReturnType<typeof createRoleAgentProvider>;
    env: Env;
  },
): Promise<NewTurnResult> {
  const { isCalibration, answer, participantRole, row, participant, clientState, provider, env } = opts;

  // Use client state if provided; otherwise reconstruct from DB
  let state: import('../../lib/agents/interview/types').InterviewState;
  if (clientState) {
    state = clientState;
  } else {
    state = reconstructInterviewStateFromDb(row, participant);
  }

  if (isCalibration) {
    // Calibration: set participant role, do NOT add calibration to exchanges
    // (matches legacy behavior — calibration is ephemeral)
    state = {
      ...state,
      participantRole: (participantRole as import('../../types').ParticipantRole) ?? state.participantRole,
    };
  } else {
    // Normal turn: run the deterministic reducer to fill in the answer
    state = interviewReducer(state, { type: 'ANSWER', answer });
  }

  // If synthesis is ready, run RCD synthesis
  if (state.synthesisReady) {
    const rcdResult = await runRcdSynthesis(
      env,
      row.id,
      state.baseline,
    );

    return {
      type: 'synthesis',
      acknowledgment: 'Thank you for your insights. I have synthesized the role context.',
      knowledgeStateUpdate: {},
      domainCoverage: state.coverage,
      state,
      toolsUsed: [],
      persona: rcdResult?.persona,
      jobDescription: rcdResult?.jobDescription,
      rcd: rcdResult?.rcd,
      synthesis: rcdResult?.synthesis,
    };
  }

  // Generate next question
  if (!provider) {
    throw new Error('No AI provider is configured.');
  }

  const { getNextDomainDrivenQuestion } = await import('../../lib/agents/question/domainOrchestrator');
  const ddResult = await getNextDomainDrivenQuestion(state, provider);

  // All domains complete — run synthesis
  if (ddResult.type === 'complete') {
    const rcdResult = await runRcdSynthesis(
      env,
      row.id,
      state.baseline,
    );

    return {
      type: 'synthesis',
      acknowledgment: 'Thank you for your insights. I have synthesized the role context.',
      knowledgeStateUpdate: {},
      domainCoverage: state.coverage,
      state: { ...state, ...ddResult.statePatches, synthesisReady: true },
      toolsUsed: [],
      persona: rcdResult?.persona,
      jobDescription: rcdResult?.jobDescription,
      rcd: rcdResult?.rcd,
      synthesis: rcdResult?.synthesis,
    };
  }

  // Apply domain-driven state patches (tracks current domain, cache, depth, etc.)
  state = { ...state, ...ddResult.statePatches };

  const questionResult = ddResult.result;

  // Add the generated question to exchanges so the next /respond call finds it
  const nextExchange: RoleExchange = {
    questionId: questionResult.question.id,
    acknowledgment: questionResult.acknowledgment,
    question: questionResult.question.text,
    input: questionResult.question.input,
  };

  // Merge the question's knowledge-state update into our local state
  state = {
    ...state,
    exchanges: [...state.exchanges, nextExchange],
    knowledgeState: mergeKnowledgeState(state.knowledgeState, questionResult.knowledgeStateUpdate),
    coverage: { ...state.coverage, ...questionResult.domainCoverage },
  };

  return {
    type: 'question',
    acknowledgment: questionResult.acknowledgment,
    question: questionResult.question,
    knowledgeStateUpdate: questionResult.knowledgeStateUpdate,
    domainCoverage: questionResult.domainCoverage,
    state,
    toolsUsed: [],
  };
}

/**
 * Log role-discovery AI usage to ai_usage_events. Reads token counts from the
 * Vertex provider's `getLastUsage()` after a call. Safe to call even when the
 * provider is null, a non-Vertex provider, or the call errored — it just
 * writes whatever it knows, flipping `success=0` when appropriate.
 */
function logRoleAgentUsage(
  c: { env: Env; executionCtx: ExecutionContext },
  provider: ReturnType<typeof createRoleAgentProvider>,
  refs: { roleContextId: string; participantId: string },
  opts: { success: boolean; errorMessage?: string } = { success: true },
): void {
  if (!provider) return;
  // Duck-type: log usage for any provider that exposes getLastUsage() and getModelKey()
  const lastUsage = typeof (provider as unknown as Record<string, unknown>).getLastUsage === 'function'
    ? (provider as unknown as { getLastUsage(): import('../../lib/llm/types').LLMUsage | null }).getLastUsage()
    : null;
  if (!lastUsage && opts.success) return; // nothing to log

  const modelKey = typeof (provider as unknown as Record<string, unknown>).getModelKey === 'function'
    ? (provider as unknown as { getModelKey(): string }).getModelKey()
    : provider.name;

  recordAiUsage(c.env.DB, c.executionCtx, {
    feature: 'role_discovery',
    refId: refs.roleContextId,
    subRefId: refs.participantId,
    provider: provider.name,
    model: modelKey,
    usage: lastUsage ?? {},
    success: opts.success,
    ...(opts.errorMessage ? { errorMessage: opts.errorMessage } : {}),
  });
}

/** The hardcoded calibration question — always first, never agent-generated. */
function calibrationQuestion(): {
  acknowledgment: string;
  question: { id: string; text: string; input: { type: 'radio'; options: string[] } };
} {
  return {
    acknowledgment: "I'll help you build a detailed role profile. The more specific you are, the more targeted the assessments I can design. Let's start with one quick question.",
    question: {
      id: 'q-calibration',
      text: "What's your relationship to this role?",
      input: {
        type: 'radio' as const,
        options: ['Hiring Manager', 'Internal Recruiter', 'External Recruiter', 'Team Member'],
      },
    },
  };
}

/** Map calibration answer text to ParticipantRole enum value. */
function resolveParticipantRole(answer: string): ParticipantRole {
  const normalized = answer.trim().toUpperCase().replace(/\s+/g, '_');
  if ((PARTICIPANT_ROLES as readonly string[]).includes(normalized)) {
    return normalized as ParticipantRole;
  }
  // Fuzzy match
  if (answer.toLowerCase().includes('hiring')) return 'HIRING_MANAGER';
  if (answer.toLowerCase().includes('external')) return 'EXTERNAL_RECRUITER';
  if (answer.toLowerCase().includes('team')) return 'TEAM_MEMBER';
  return 'INTERNAL_RECRUITER';
}

// ─── POST / — Create role context with baseline + creator participant ───────

roleContexts.post('/', async (c) => {
  const userId = c.var.userId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = createRoleContextSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { baseline, questionBudget } = parsed.data;
  const id = generateId();
  const participantId = generateId();

  // Create role context + creator participant in a batch
  const batch = [
    c.env.DB.prepare(
      `INSERT INTO role_contexts (id, owner_id, baseline, question_budget, status)
       VALUES (?1, ?2, ?3, ?4, 'BASELINE')`,
    ).bind(id, userId, JSON.stringify(baseline), questionBudget),

    c.env.DB.prepare(
      `INSERT INTO role_context_participants (id, role_context_id, is_creator, question_budget, status)
       VALUES (?1, ?2, 1, ?3, 'PENDING')`,
    ).bind(participantId, id, questionBudget),
  ];

  await c.env.DB.batch(batch);

  return c.json(
    {
      id,
      participantId,
      status: 'BASELINE' as const,
      baseline,
      questionBudget,
      questionsAsked: 0,
    },
    201,
  );
});

// ─── POST /simple-job-description — Current-path role source ────────────────

roleContexts.post('/simple-job-description', async (c) => {
  const userId = c.var.userId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = createSimpleJobDescriptionRoleContextSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { jobDescriptionMd, title, pipelineId, selectedTerms } = parsed.data;
  if (pipelineId) {
    const pipeline = await c.env.DB.prepare(
      'SELECT id FROM pipelines WHERE id = ?1 AND owner_id = ?2',
    ).bind(pipelineId, userId).first<{ id: string }>();
    if (!pipeline) {
      return apiError(c, 'NOT_FOUND', 'Pipeline not found.');
    }
  }

  const { backedTerms, rejectedTerms } = sourceBackedSelectedTerms(jobDescriptionMd, selectedTerms);
  if (rejectedTerms.length > 0) {
    return apiError(
      c,
      'VALIDATION_ERROR',
      `Selected terms must appear as literal job-description text: ${rejectedTerms.join(', ')}.`,
    );
  }

  const id = generateId();
  const baseline = {
    title: title ?? 'Simple job description',
    source: 'simple_job_description',
  };
  const timestamp = now();

  await c.env.DB.prepare(
    `INSERT INTO role_contexts (
       id, pipeline_id, owner_id, baseline, knowledge_state, exchanges,
       question_budget, questions_asked, status, job_description_md,
       rcd_version, rcd_json, validation_metadata, non_negotiable_skills_json,
       created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, '{}', '[]', 0, 0, 'COMPLETE', ?5, ?6, NULL, ?7, ?8, ?9, ?9)`,
  ).bind(
    id,
    pipelineId ?? null,
    userId,
    JSON.stringify(baseline),
    jobDescriptionMd,
    'simple-jd-v1',
    JSON.stringify({
      source: 'simple_job_description',
      selectedTermsRequested: selectedTerms ?? [],
      selectedTermsPersisted: backedTerms,
    }),
    JSON.stringify(backedTerms),
    timestamp,
  ).run();

  await persistSimpleJobDescriptionContext({
    db: c.env.DB,
    roleContextId: id,
    pipelineId: pipelineId ?? null,
    title: baseline.title,
    jobDescriptionMd,
    selectedTerms: backedTerms,
    timestamp,
  });

  return c.json(
    {
      id,
      pipelineId: pipelineId ?? null,
      status: 'COMPLETE' as const,
      baseline,
      jobDescription: jobDescriptionMd,
      selectedTerms: backedTerms,
      rejectedSelectedTerms: [],
      roleSnapshotId: `role-context:${id}:source-backed:simple-jd-v1`,
    },
    201,
  );
});

// ─── POST /parse-jd — Parse JD text or PDF into baseline fields ─────────────

roleContexts.post('/parse-jd', async (c) => {
  const contentType = c.req.header('Content-Type') ?? '';
  const mock = c.env.MOCK_AI === 'true';

  // Multipart: file upload
  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file') as unknown as File | null;
    if (!file) {
      return apiError(c, 'VALIDATION_ERROR', 'No file provided.');
    }

    const buffer = await file.arrayBuffer();
    const parsed = await parseJobDescription({
      fileBuffer: buffer,
      contentType: file.type,
      env: c.env,
      mock,
    });

    if (!parsed) {
      return apiError(c, 'VALIDATION_ERROR', 'Could not parse the uploaded file.');
    }

    return c.json({ parsed });
  }

  // JSON: pasted text
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON or multipart form data.');
  }

  const text = (body as Record<string, unknown>)?.text;
  if (typeof text !== 'string' || text.trim().length < 20) {
    return apiError(c, 'VALIDATION_ERROR', 'text must be at least 20 characters.');
  }

  const parsed = await parseJobDescription({ text, env: c.env, mock });

  if (!parsed) {
    return apiError(c, 'INTERNAL_ERROR', 'Failed to parse job description.');
  }

  return c.json({ parsed });
});

// ─── POST /transcribe — Whisper transcription for voice input ───────────────

roleContexts.post('/transcribe', async (c) => {
  const contentType = c.req.header('Content-Type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return apiError(c, 'VALIDATION_ERROR', 'Expected multipart/form-data with an audio file.');
  }

  const formData = await c.req.formData();
  const file = formData.get('audio') as unknown as File | null;
  if (!file) {
    return apiError(c, 'VALIDATION_ERROR', 'No audio file provided.');
  }

  if (!c.env.AI) {
    return apiError(c, 'INTERNAL_ERROR', 'Workers AI not available.');
  }

  const buffer = await file.arrayBuffer();
  const audio = [...new Uint8Array(buffer)];

  async function runWhisper(): Promise<string | null> {
    const result = await c.env.AI.run(
      '@cf/openai/whisper' as Parameters<typeof c.env.AI.run>[0],
      { audio },
    ) as { text?: string };
    return result.text?.trim() || null;
  }

  let transcript: string | null = null;
  try {
    transcript = await runWhisper();
  } catch (err) {
    console.warn('[roleContexts/transcribe] Whisper attempt 1 failed, retrying:', err);
    // Single retry after short delay — error 1031 is transient upstream unavailability
    await new Promise((r) => setTimeout(r, 600));
    try {
      transcript = await runWhisper();
    } catch (retryErr) {
      console.error('[roleContexts/transcribe] Whisper failed after retry:', retryErr);
      return c.json({ error: 'Transcription temporarily unavailable. Please type your answer.' }, 503);
    }
  }

  console.log('[roleContexts/transcribe] Whisper result:', transcript?.slice(0, 100));
  return c.json({ transcript: transcript ?? '' });
});

// ─── GET /:id/living-context — Source-backed role graph ───────────────────

roleContexts.get('/:id/living-context', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  const row = await c.env.DB.prepare(
    'SELECT id, owner_id FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<{ id: string; owner_id: string }>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  const livingContext = await loadRoleContextLivingContext(c.env.DB, id);
  if (!livingContext) {
    return apiError(c, 'NOT_FOUND', 'Living context not found.');
  }

  return c.json({ livingContext });
});

// ─── GET /:id — Retrieve full state + participants ─────────────────────────

roleContexts.get('/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  // Fetch all participants
  const participantRows = await c.env.DB.prepare(
    'SELECT * FROM role_context_participants WHERE role_context_id = ?1 ORDER BY is_creator DESC, created_at ASC',
  )
    .bind(id)
    .all<RoleContextParticipantRow>();

  const sharedKnowledgeState = parseJsonColumn<Record<string, Record<string, unknown>>>(row.knowledge_state, {});

  const participants = (participantRows.results ?? []).map((p) => {
    const exchanges = parseJsonColumn<RoleExchange[]>(p.exchanges, []);
    // TODO: In multi-stakeholder interviews, phase should be computed from the
    // participant's own exchanges and questions_asked rather than sharedKnowledgeState.
    // Using shared state can show WRAP_UP for participant B because participant A
    // already delivered all probes. See handoff doc 2026-04-28 item C.
    const phaseResult = selectPhase({
      questionsAsked: p.questions_asked,
      questionBudget: p.question_budget,
      domainCoverage: readDomainCoverage(sharedKnowledgeState),
      evpCoverage: readEvpCoverage(sharedKnowledgeState),
      storiesExtracted: readStories(sharedKnowledgeState),
      mustHavesPrioritized: readBooleanFlag(sharedKnowledgeState, '_mustHavesPrioritized'),
      frictionProbed: readBooleanFlag(sharedKnowledgeState, '_frictionProbed'),
      dayInLifeProbed: readBooleanFlag(sharedKnowledgeState, '_dayInLifeProbed'),
      probesDelivered: readProbesDelivered(sharedKnowledgeState),
    soulProbesDelivered: readSoulProbesDelivered(sharedKnowledgeState),
    enableSoulTrack: readEnableSoulTrack(sharedKnowledgeState, {}),
    });

    const domainState = parseJsonColumn<{
      currentDomain: string | null;
      domainCompletion: Record<string, string>;
      domainQuestions: Record<string, unknown[]>;
      domainQuestionsDelivered: Record<string, number>;
      domainFollowUpsDelivered: number;
    } | null>(p.domain_state, null);

    return {
      id: p.id,
      name: p.name,
      email: p.email,
      participantRole: p.participant_role,
      isCreator: p.is_creator === 1,
      questionsAsked: p.questions_asked,
      questionBudget: p.question_budget,
      status: p.status,
      exchanges,
      phase: phaseResult.phase,
      currentDomain: domainState?.currentDomain ?? null,
      domainCompletion: domainState?.domainCompletion ?? undefined,
      domainQuestions: domainState?.domainQuestions ?? undefined,
      domainQuestionsDelivered: domainState?.domainQuestionsDelivered ?? undefined,
      domainFollowUpsDelivered: domainState?.domainFollowUpsDelivered ?? undefined,
    };
  });

  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const knowledgeState = parseJsonColumn<Record<string, unknown>>(row.knowledge_state, {});
  // Legacy: exchanges on role_contexts for backward compat during migration
  const exchanges = parseJsonColumn<RoleExchange[]>(row.exchanges, []);

  // Phase 0.1: read RCD consumer_slice primary, fall back to legacy persona_json.
  let persona: unknown = null;
  if (row.rcd_json) {
    try {
      const rcd = JSON.parse(row.rcd_json) as { consumer_slice?: unknown };
      persona = rcd.consumer_slice ?? null;
    } catch { /* fall through */ }
  }
  if (!persona && row.persona_json) {
    persona = parseJsonColumn(row.persona_json, null);
  }
  const jobDescription = row.job_description_md ?? null;

  return c.json({
    id: row.id,
    pipelineId: row.pipeline_id,
    status: row.status,
    baseline,
    knowledgeState,
    exchanges,
    persona,
    jobDescription,
    questionBudget: row.question_budget,
    questionsAsked: row.questions_asked,
    participants,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

// ─── POST /:id/start — Begin interview (calibration question) ──────────────

roleContexts.post('/:id/start', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: { participantId?: string } = {};
  try {
    body = (await c.req.json()) as { participantId?: string };
  } catch {
    // No body is fine — will use creator participant
  }

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  // Find participant — either by explicit ID or the creator
  let participant: RoleContextParticipantRow | null;
  if (body.participantId) {
    participant = await c.env.DB.prepare(
      'SELECT * FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
    )
      .bind(body.participantId, id)
      .first<RoleContextParticipantRow>();
  } else {
    participant = await c.env.DB.prepare(
      'SELECT * FROM role_context_participants WHERE role_context_id = ?1 AND is_creator = 1',
    )
      .bind(id)
      .first<RoleContextParticipantRow>();
  }

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }
  if (participant.status !== 'PENDING' && participant.status !== 'INVITED') {
    return apiError(c, 'VALIDATION_ERROR', `Cannot start interview from participant status '${participant.status}'.`);
  }

  // Return the hardcoded calibration question
  const cal = calibrationQuestion();

  // Store calibration exchange on the participant
  const exchange: RoleExchange = {
    questionId: cal.question.id,
    acknowledgment: cal.acknowledgment,
    question: cal.question.text,
    input: cal.question.input,
  };

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE role_context_participants
       SET status = 'CALIBRATING', exchanges = ?1, updated_at = ?2
       WHERE id = ?3`,
    ).bind(JSON.stringify([exchange]), now(), participant.id),

    // Transition role_contexts to INTERVIEWING if still BASELINE
    c.env.DB.prepare(
      `UPDATE role_contexts
       SET status = CASE WHEN status = 'BASELINE' THEN 'INTERVIEWING' ELSE status END,
           updated_at = ?1
       WHERE id = ?2`,
    ).bind(now(), id),
  ]);

  return c.json({
    participantId: participant.id,
    acknowledgment: cal.acknowledgment,
    question: cal.question,
    progress: {
      asked: 0,
      budget: participant.question_budget,
      domains: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    },
    status: 'CALIBRATING' as const,
  });
});

// ─── POST /:id/respond — Submit answer, get next question ───────────────────

/** Serialize domain-driven state for DB persistence. */
function serializeDomainState(state: import('../../lib/agents/interview/types').InterviewState): string {
  return JSON.stringify({
    currentDomain: state.currentDomain,
    domainCompletion: state.domainCompletion,
    domainQuestions: state.domainQuestions,
    domainQuestionsDelivered: state.domainQuestionsDelivered,
    domainFollowUpsDelivered: state.domainFollowUpsDelivered,
  });
}

/** Persist a newly-generated question to D1 (calibration or mid-interview). */
async function persistQuestionTurn(
  db: D1Database,
  roleContextId: string,
  participantId: string,
  turn: NewTurnResult,
  isCalibration: boolean,
  participantRole: string | null,
): Promise<void> {
  const domainStateJson = serializeDomainState(turn.state);

  if (isCalibration) {
    await db.batch([
      db.prepare(
        `UPDATE role_context_participants
         SET participant_role = ?1, status = 'INTERVIEWING', exchanges = ?2,
             questions_asked = ?3, domain_state = ?4, updated_at = ?5
         WHERE id = ?6`,
      ).bind(
        participantRole,
        JSON.stringify(turn.state.exchanges),
        turn.state.questionsAsked,
        domainStateJson,
        now(),
        participantId,
      ),
      db.prepare(
        `UPDATE role_contexts SET knowledge_state = ?1, updated_at = ?2 WHERE id = ?3`,
      ).bind(
        JSON.stringify(turn.state.knowledgeState),
        now(),
        roleContextId,
      ),
    ]);
  } else {
    await db.batch([
      db.prepare(
        `UPDATE role_context_participants
         SET exchanges = ?1, questions_asked = ?2, domain_state = ?3, updated_at = ?4
         WHERE id = ?5`,
      ).bind(
        JSON.stringify(turn.state.exchanges),
        turn.state.questionsAsked,
        domainStateJson,
        now(),
        participantId,
      ),
      db.prepare(
        `UPDATE role_contexts SET knowledge_state = ?1, updated_at = ?2 WHERE id = ?3`,
      ).bind(
        JSON.stringify(turn.state.knowledgeState),
        now(),
        roleContextId,
      ),
    ]);
  }
}

/** Persist synthesis results and mark participant complete. */
async function persistSynthesisTurn(
  db: D1Database,
  env: Env,
  roleContextId: string,
  participantId: string,
  turn: NewTurnResult,
): Promise<void> {
  const domainStateJson = serializeDomainState(turn.state);
  await db.batch([
    db.prepare(
      `UPDATE role_context_participants
       SET status = 'COMPLETE', exchanges = ?1, questions_asked = ?2,
           domain_state = ?3, updated_at = ?4
       WHERE id = ?5`,
    ).bind(
      JSON.stringify(turn.state.exchanges),
      turn.state.questionsAsked,
      domainStateJson,
      now(),
      participantId,
    ),
    db.prepare(
      `UPDATE role_contexts
       SET knowledge_state = ?1,
           questions_asked = questions_asked + ?2,
           persona_json = ?3,
           job_description_md = ?4,
           rcd_json = ?5,
           validation_metadata = ?6,
           updated_at = ?7
       WHERE id = ?8`,
    ).bind(
      JSON.stringify(turn.state.knowledgeState),
      turn.state.questionsAsked,
      turn.persona ? JSON.stringify(turn.persona) : null,
      turn.jobDescription || null,
      turn.rcd ? JSON.stringify(turn.rcd) : null,
      turn.rcd ? JSON.stringify(turn.rcd.validation_metadata) : null,
      now(),
      roleContextId,
    ),
  ]);

  if (turn.rcd) {
    try {
      const nodes = decomposeRcdIntoNodes(turn.rcd, roleContextId);
      await persistRoleNodes(nodes, env, db);
    } catch (decompErr) {
      const msg = decompErr instanceof Error ? decompErr.message : String(decompErr);
      console.error('[roleContexts] RCD decomposition failed:', msg);
    }
  }

  const incomplete = await db.prepare(
    `SELECT COUNT(*) as cnt FROM role_context_participants
     WHERE role_context_id = ?1 AND status != 'COMPLETE'`,
  )
    .bind(roleContextId)
    .first<{ cnt: number }>();

  if (incomplete && incomplete.cnt === 0) {
    await db.prepare(
      `UPDATE role_contexts SET status = 'COMPLETE', updated_at = ?1 WHERE id = ?2`,
    )
      .bind(now(), roleContextId)
      .run();
  }
}

roleContexts.post('/:id/respond', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { answer, questionId, state: clientState } = parsed.data;
  const participantId = (body as Record<string, unknown>)?.participantId;
  if (typeof participantId !== 'string') {
    return apiError(c, 'VALIDATION_ERROR', 'participantId is required.');
  }

  // Fetch role context and participant in parallel
  const [row, participant] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM role_contexts WHERE id = ?1')
      .bind(id)
      .first<RoleContextRow>(),
    c.env.DB.prepare(
      'SELECT * FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
    )
      .bind(participantId, id)
      .first<RoleContextParticipantRow>(),
  ]);

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }
  if (participant.status !== 'CALIBRATING' && participant.status !== 'INTERVIEWING') {
    return apiError(c, 'VALIDATION_ERROR', `Cannot respond in participant status '${participant.status}'.`);
  }

  const isCalibration = questionId === 'q-calibration';
  const resolvedParticipantRole = isCalibration
    ? resolveParticipantRole(answer)
    : participant.participant_role;
  const provider = createRoleAgentProvider(c.env);

  // ── Shared turn execution ──
  const executeTurn = async (): Promise<NewTurnResult> => {
    return runNewArchitectureTurn({
      isCalibration,
      answer,
      participantRole: resolvedParticipantRole,
      row,
      participant,
      clientState: clientState as import('../../lib/agents/interview/types').InterviewState | undefined,
      provider,
      env: c.env,
    });
  };

  // ── Streaming path: SSE ──
  const acceptHeader = c.req.header('Accept');
  if (acceptHeader === 'text/event-stream') {
    const response = streamSSE(c, async (stream) => {
      try {
        const turnResult = await executeTurn();

        if (turnResult.type === 'synthesis') {
          await persistSynthesisTurn(c.env.DB, c.env, id, participant.id, turnResult);
          buildAndStoreRoleEmbedding(c.env, id, turnResult.jobDescription ?? '', turnResult.persona).catch(() => {});

          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({
              participantId: participant.id,
              synthesis: turnResult.synthesis,
              persona: turnResult.persona,
              jobDescription: turnResult.jobDescription,
              rcd: turnResult.rcd ? JSON.parse(JSON.stringify(turnResult.rcd)) : null,
              knowledgeState: turnResult.state.knowledgeState,
              progress: {
                asked: turnResult.state.questionsAsked,
                budget: participant.question_budget,
                domains: turnResult.state.coverage,
              },
            }),
          });
          return;
        }

        await persistQuestionTurn(c.env.DB, id, participant.id, turnResult, isCalibration, resolvedParticipantRole);

        const payload: Record<string, unknown> = {
          participantId: participant.id,
          acknowledgment: turnResult.acknowledgment,
          question: turnResult.question,
          knowledgeState: turnResult.state.knowledgeState,
          progress: {
            asked: turnResult.state.questionsAsked,
            budget: participant.question_budget,
            domains: turnResult.state.coverage,
          },
          status: 'INTERVIEWING',
          toolsUsed: turnResult.toolsUsed,
        };
        if (isCalibration) {
          payload.participantRole = resolvedParticipantRole;
        }

        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify(payload),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[roleContexts/respond] Streaming error:', msg);
        await stream.writeSSE({ event: 'error', data: msg });
      }
    });
    response.headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    return response;
  }

  // ── Non-streaming path ──
  try {
    const turnResult = await executeTurn();

    if (turnResult.type === 'synthesis') {
      await persistSynthesisTurn(c.env.DB, c.env, id, participant.id, turnResult);
      c.executionCtx.waitUntil(
        buildAndStoreRoleEmbedding(c.env, id, turnResult.jobDescription ?? '', turnResult.persona),
      );

      return c.json({
        participantId: participant.id,
        type: 'synthesis',
        synthesis: turnResult.synthesis,
        persona: turnResult.persona,
        jobDescription: turnResult.jobDescription,
        rcd: turnResult.rcd ? JSON.parse(JSON.stringify(turnResult.rcd)) : null,
        state: turnResult.state,
        knowledgeState: turnResult.state.knowledgeState,
        progress: {
          asked: turnResult.state.questionsAsked,
          budget: participant.question_budget,
          domains: turnResult.state.coverage,
          currentDomain: turnResult.state.currentDomain,
          domainCompletion: turnResult.state.domainCompletion,
        },
        status: 'COMPLETE',
      });
    }

    await persistQuestionTurn(c.env.DB, id, participant.id, turnResult, isCalibration, resolvedParticipantRole);

    const questionMetadata = turnResult.question as { metadata?: { reasoning?: unknown } } | undefined;
    const payload: Record<string, unknown> = {
      participantId: participant.id,
      type: 'question',
      acknowledgment: turnResult.acknowledgment,
      question: turnResult.question,
      state: turnResult.state,
      progress: {
        asked: turnResult.state.questionsAsked,
        budget: participant.question_budget,
        domains: turnResult.state.coverage,
        currentDomain: turnResult.state.currentDomain,
        domainCompletion: turnResult.state.domainCompletion,
        phase: turnResult.state.phase,
        phaseReasoning: turnResult.state.reasoning,
        questionReasoning: typeof questionMetadata?.metadata?.reasoning === 'string'
          ? questionMetadata.metadata.reasoning
          : undefined,
      },
      status: 'INTERVIEWING',
      toolsUsed: turnResult.toolsUsed,
    };
    if (isCalibration) {
      payload.participantRole = resolvedParticipantRole;
    }

    return c.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[roleContexts/respond] Non-streaming error:', msg);
    return apiError(c, 'INTERNAL_ERROR', msg);
  }
});

// ─── POST /:id/question — DEPRECATED: Use /respond instead ───────────────────

roleContexts.post('/:id/question', async (c) => {
  return c.json({ error: 'DEPRECATED: Use POST /:id/respond instead.' }, 410);
});

roleContexts.post('/:id/question/prefetch', async (c) => {
  return c.json({ error: 'DEPRECATED: Use POST /:id/respond instead.' }, 410);
});

// ─── POST /:id/synthesize — Synthesize persona + JD from state ───────────────

roleContexts.post('/:id/synthesize', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = synthesizeSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { state: clientState } = parsed.data;

  // Verify ownership
  const row = await c.env.DB.prepare('SELECT owner_id FROM role_contexts WHERE id = ?1')
    .bind(id)
    .first<{ owner_id: string }>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  // After zod parsing, use the validated state
  const state = clientState as unknown as import('../../lib/agents/interview/types').InterviewState;
  const provider = createRoleAgentSynthesisProvider(c.env);
  const fallbackProvider = createRoleAgentSynthesisFallbackProvider(c.env);

  let result = await runSingleParticipantRcdSynthesis(state, id, provider!);
  let activeProvider = provider;

  if (!result) {
    // Try fallback
    if (fallbackProvider) {
      try {
        result = await runSingleParticipantRcdSynthesis(state, id, fallbackProvider);
        activeProvider = fallbackProvider;
      } catch (fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        logRoleAgentUsage(c, fallbackProvider, { roleContextId: id, participantId: 'synthesize-api' }, { success: false, errorMessage: msg });
        return apiError(c, 'INTERNAL_ERROR', `Synthesis failed on fallback: ${msg}`);
      }
    }
    if (!result) {
      logRoleAgentUsage(c, provider, { roleContextId: id, participantId: 'synthesize-api' }, { success: false, errorMessage: 'Primary and fallback synthesis both failed' });
      return apiError(c, 'INTERNAL_ERROR', 'Synthesis failed. Please try again.');
    }
  }

  logRoleAgentUsage(c, activeProvider, { roleContextId: id, participantId: 'synthesize-api' });

  // Persist RCD + derived artifacts
  const { rcd, persona, jobDescription, synthesis } = result;
  await c.env.DB.prepare(
    `UPDATE role_contexts
     SET rcd_json = ?1,
         persona_json = ?2,
         job_description_md = ?3,
         validation_metadata = ?4,
         status = 'COMPLETE',
         updated_at = ?5
     WHERE id = ?6`,
  ).bind(
    JSON.stringify(rcd),
    persona ? JSON.stringify(persona) : null,
    jobDescription || null,
    JSON.stringify(rcd.validation_metadata),
    now(),
    id,
  ).run();

  // Decompose RCD into role_nodes
  try {
    const nodes = decomposeRcdIntoNodes(rcd, id);
    await persistRoleNodes(nodes, c.env, c.env.DB);
  } catch (decompErr) {
    const msg = decompErr instanceof Error ? decompErr.message : String(decompErr);
    console.error('[roleContexts/synthesize] RCD decomposition failed:', msg);
    // Non-fatal: synthesis succeeded, decomposition is best-effort
  }

  // Build and store embedding
  c.executionCtx.waitUntil(
    buildAndStoreRoleEmbedding(c.env, id, jobDescription, persona).catch(() => {}),
  );

  // Return legacy-compatible response with rcd included
  return c.json({
    reasoning: typeof (rcd as unknown as Record<string, unknown>).reasoning === 'string'
      ? (rcd as unknown as Record<string, unknown>).reasoning
      : '',
    persona,
    jobDescription,
    synthesis,
    knowledgeStateUpdate: {},
    domainCoverage: state.coverage,
    rcd,
  });
});

// ─── POST /:id/complete — Force-complete a participant's interview ──────────

roleContexts.post('/:id/complete', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: { participantId?: string } = {};
  try {
    body = (await c.req.json()) as { participantId?: string };
  } catch {
    // No body
  }

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  // Find participant
  let participant: RoleContextParticipantRow | null;
  if (body.participantId) {
    participant = await c.env.DB.prepare(
      'SELECT * FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
    )
      .bind(body.participantId, id)
      .first<RoleContextParticipantRow>();
  } else {
    participant = await c.env.DB.prepare(
      'SELECT * FROM role_context_participants WHERE role_context_id = ?1 AND is_creator = 1',
    )
      .bind(id)
      .first<RoleContextParticipantRow>();
  }

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }
  if (participant.status !== 'INTERVIEWING') {
    return apiError(c, 'VALIDATION_ERROR', `Cannot complete from participant status '${participant.status}'.`);
  }

  // Force synthesis via the new architecture reducer
  const state = reconstructInterviewStateFromDb(row, participant);
  const forcedState = interviewReducer(state, { type: 'FORCE_SYNTHESIZE' });

  // Run RCD synthesis
  const rcdResult = await runRcdSynthesis(c.env, id, state.baseline);
  const synthesis = rcdResult?.synthesis ?? '';
  const persona = rcdResult?.persona ?? null;
  const jobDescription = rcdResult?.jobDescription ?? '';
  const rcd = rcdResult?.rcd ?? null;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE role_context_participants
       SET status = 'COMPLETE', exchanges = ?1, questions_asked = ?2, updated_at = ?3
       WHERE id = ?4`,
    ).bind(
      JSON.stringify(forcedState.exchanges),
      forcedState.questionsAsked,
      now(),
      participant.id,
    ),
    c.env.DB.prepare(
      `UPDATE role_contexts
       SET knowledge_state = ?1,
           questions_asked = questions_asked + ?2,
           persona_json = ?3,
           job_description_md = ?4,
           rcd_json = ?5,
           validation_metadata = ?6,
           updated_at = ?7
       WHERE id = ?8`,
    ).bind(
      JSON.stringify(forcedState.knowledgeState),
      forcedState.questionsAsked,
      persona ? JSON.stringify(persona) : null,
      jobDescription || null,
      rcd ? JSON.stringify(rcd) : null,
      rcd ? JSON.stringify(rcd.validation_metadata) : null,
      now(),
      id,
    ),
  ]);

  if (rcd) {
    try {
      const nodes = decomposeRcdIntoNodes(rcd, id);
      await persistRoleNodes(nodes, c.env, c.env.DB);
    } catch (decompErr) {
      const msg = decompErr instanceof Error ? decompErr.message : String(decompErr);
      console.error('[roleContexts] RCD decomposition failed:', msg);
    }
  }

  // Check if all complete
  const incomplete = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM role_context_participants
     WHERE role_context_id = ?1 AND status != 'COMPLETE'`,
  )
    .bind(id)
    .first<{ cnt: number }>();

  if (incomplete && incomplete.cnt === 0) {
    await c.env.DB.prepare(
      `UPDATE role_contexts SET status = 'COMPLETE', updated_at = ?1 WHERE id = ?2`,
    )
      .bind(now(), id)
      .run();
  }

  // Best-effort role embedding
  c.executionCtx.waitUntil(
    buildAndStoreRoleEmbedding(c.env, id, jobDescription, persona),
  );

  return c.json({
    participantId: participant.id,
    synthesis,
    persona,
    jobDescription,
    rcd: rcd ? JSON.parse(JSON.stringify(rcd)) : null,
    knowledgeState: forcedState.knowledgeState,
    progress: {
      asked: forcedState.questionsAsked,
      budget: participant.question_budget,
      domains: forcedState.coverage,
    },
    status: 'COMPLETE' as const,
  });
});

// ─── POST /:id/feedback — Flag a question with feedback for prompt tuning ────

roleContexts.post('/:id/feedback', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const { participantId, questionId, feedback } = body as Record<string, unknown>;
  if (typeof participantId !== 'string') {
    return apiError(c, 'VALIDATION_ERROR', 'participantId is required.');
  }
  if (typeof questionId !== 'string') {
    return apiError(c, 'VALIDATION_ERROR', 'questionId is required.');
  }
  if (typeof feedback !== 'string' || feedback.trim().length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'feedback must be a non-empty string.');
  }

  const row = await c.env.DB.prepare(
    'SELECT owner_id FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<{ owner_id: string }>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  const participant = await c.env.DB.prepare(
    'SELECT id, exchanges, participant_role FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
  )
    .bind(participantId, id)
    .first<{ id: string; exchanges: string | null; participant_role: string | null }>();

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }

  const exchanges = parseJsonColumn<RoleExchange[]>(participant.exchanges, []);
  const exchange = exchanges.find((ex) => ex.questionId === questionId);
  if (!exchange) {
    return apiError(c, 'NOT_FOUND', `Exchange with questionId '${questionId}' not found.`);
  }

  exchange.feedback = feedback.trim();

  await c.env.DB.prepare(
    'UPDATE role_context_participants SET exchanges = ?1, updated_at = ?2 WHERE id = ?3',
  )
    .bind(JSON.stringify(exchanges), now(), participant.id)
    .run();

  // ─── Adaptive feedback loop: auto-generate prompt patch ─────────────────────
  let analysis: { action: string; patchId?: string; ruleId?: string } | undefined;
  try {
    const provider = createRoleAgentProvider(c.env);
    analysis = await analyzeFeedback({
      db: c.env.DB,
      ai: c.env.AI,
      provider,
      questionText: exchange.question,
      acknowledgment: exchange.acknowledgment ?? '',
      feedback: feedback.trim(),
      participantRole: participant.participant_role,
      questionId,
      roleContextId: id,
    });
  } catch (err) {
    console.error('[feedback] analyzeFeedback failed:', err);
    // Don't fail the feedback request if patch generation fails
  }

  return c.json({ success: true, analysis });
});

// ─── POST /:id/calibrate — Recruiter flags a gap, get a clarifying question ──

roleContexts.post('/:id/calibrate', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = calibrateSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { participantId, flagType, domain, attribute, note } = parsed.data;

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  const participant = await c.env.DB.prepare(
    'SELECT * FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
  )
    .bind(participantId, id)
    .first<RoleContextParticipantRow>();

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }

  const rcd = row.rcd_json
    ? parseJsonColumn<RoleContextDocument | null>(row.rcd_json, null)
    : null;

  const exchanges = parseJsonColumn<RoleExchange[]>(participant.exchanges, []);
  const transcript = exchanges
    .map((ex) => `Q: ${ex.question}\nA: ${ex.answer ?? '(no answer)'}`)
    .join('\n\n');

  const provider = createRoleAgentProvider(c.env);
  const gapResult = await callGapFillingAgent({
    provider,
    rcd: (rcd ?? {}) as unknown as Record<string, unknown>,
    flagType,
    domain,
    attribute,
    recruiterNote: note ?? '',
    transcript,
  });

  return c.json({
    clarifyingQuestion: gapResult.clarifyingQuestion,
    domain,
    attribute,
  });
});

// ─── POST /:id/calibrate/respond — Gap-filling answer, re-synthesize domain ──

roleContexts.post('/:id/calibrate/respond', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const b = body as Record<string, unknown>;
  const participantId = typeof b.participantId === 'string' ? b.participantId : '';
  const answer = typeof b.answer === 'string' ? b.answer : '';
  const domain = typeof b.domain === 'string' ? b.domain : '';
  const attribute = typeof b.attribute === 'string' ? b.attribute : '';
  const flagType = typeof b.flagType === 'string' ? b.flagType : '';
  const note = typeof b.note === 'string' ? b.note : '';

  if (!participantId || !answer || !domain || !attribute) {
    return apiError(c, 'VALIDATION_ERROR', 'participantId, answer, domain, and attribute are required.');
  }

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  const participant = await c.env.DB.prepare(
    'SELECT * FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
  )
    .bind(participantId, id)
    .first<RoleContextParticipantRow>();

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }

  const rcd = row.rcd_json
    ? parseJsonColumn<RoleContextDocument | null>(row.rcd_json, null)
    : null;

  if (!rcd) {
    return apiError(c, 'VALIDATION_ERROR', 'No RCD exists for this role context. Complete an interview first.');
  }

  const exchanges = parseJsonColumn<RoleExchange[]>(participant.exchanges, []);
  const transcript = exchanges
    .map((ex) => `Q: ${ex.question}\nA: ${ex.answer ?? '(no answer)'}`)
    .join('\n\n');

  const provider = createRoleAgentProvider(c.env);
  const calibrationResult = await calibrateRcd({
    provider,
    rcd: rcd as import('../../types').RoleContextDocument,
    flagType,
    domain: domain as import('../../types').Domain,
    attribute,
    recruiterNote: note,
    transcript,
    answer,
    stakeholder: (participant.participant_role as import('../../types').StakeholderType) ?? 'HIRING_MANAGER',
  });

  const baselineForCalibrate = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const updatedRcd = calibrationResult.rcd;
  const persona = updatedRcd.consumer_slice;
  const fallbackTitle = typeof baselineForCalibrate.title === 'string' ? baselineForCalibrate.title : '';
  const jobDescription = deriveJobDescriptionFromRcd(updatedRcd, fallbackTitle);

  await c.env.DB.prepare(
    `UPDATE role_contexts
     SET rcd_json = ?1,
         validation_metadata = ?2,
         persona_json = ?3,
         job_description_md = ?4,
         updated_at = ?5
     WHERE id = ?6`,
  ).bind(
    JSON.stringify(updatedRcd),
    JSON.stringify(updatedRcd.validation_metadata),
    JSON.stringify(persona),
    jobDescription,
    now(),
    id,
  ).run();

  return c.json({
    updatedCell: calibrationResult.updatedCell,
    persona,
    jobDescription,
    rcd: JSON.parse(JSON.stringify(updatedRcd)),
  });
});

// ─── POST /:id/invite — Send interview invitations to team members ──────────

roleContexts.post('/:id/invite', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const roleTitle = typeof baseline.title === 'string' ? baseline.title : 'a role';
  const resendApiKey = c.env.RESEND_API_KEY ?? '';
  const appUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';

  const created: Array<{ id: string; name: string; email: string }> = [];

  for (const invitee of parsed.data.invitees) {
    const pid = generateId();
    const token = generateId();

    await c.env.DB.prepare(
      `INSERT INTO role_context_participants (id, role_context_id, name, email, invite_token, is_creator, question_budget, status)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, 5, 'INVITED')`,
    )
      .bind(pid, id, invitee.name, invitee.email, token)
      .run();

    // Send invitation email (non-blocking — log errors, don't throw)
    if (resendApiKey) {
      const interviewUrl = `${appUrl}/role-interview/${token}`;
      await sendNotificationEmail({
        apiKey: resendApiKey,
        trigger: 'INVITATION',
        to: invitee.email,
        variables: {
          name: invitee.name,
          email: invitee.email,
          pipelineName: roleTitle,
          assessUrl: interviewUrl,
        },
      });
    }

    created.push({ id: pid, name: invitee.name, email: invitee.email });
  }

  return c.json({ invited: created }, 201);
});

// ─── PATCH /:id — Link role context to a pipeline ───────────────────────────

roleContexts.patch('/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const pipelineId = (body as Record<string, unknown>)?.pipelineId;
  if (typeof pipelineId !== 'string') {
    return apiError(c, 'VALIDATION_ERROR', 'pipelineId must be a string.');
  }

  const row = await c.env.DB.prepare(
    'SELECT owner_id FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<{ owner_id: string }>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  await c.env.DB.prepare(
    'UPDATE role_contexts SET pipeline_id = ?1, updated_at = ?2 WHERE id = ?3',
  )
    .bind(pipelineId, now(), id)
    .run();

  return c.json({ success: true });
});
