import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../../types';
import {
  MISSING_INGESTION_RETRY_REASON,
  STALLED_INGESTION_RETRY_REASON,
  isRetryableCandidateDiscoveryOutputFailure,
  isRetryableStaleWorkersAIModelFailure,
  isRetryableStalledInProgressIngestion,
  maybeQueueRetryableStandaloneIngestion,
  processPipelineCandidateIngestionRetries,
  processStaleWorkersAIModelIngestionRetries,
  processTalentPoolOperationalContextRepairs,
  processTalentPoolRolelessApplicationRepairs,
  resolveCandidateIngestionRetryLimit,
  retryCandidateEvidenceIngestionFromSource,
} from '../staleWorkersAiRetry';
import { runCandidateIngestion } from '../orchestrate';
import { processResumeFromR2 } from '../../enrichment/resumeIngestion';
import { ensureRolelessTalentPoolIdentity } from '../../talentPoolIdentity';
import { extractTextFromResumeFile } from '../../cvParser';
import { repairCandidateResumeNodeSourceRefs } from '../candidateNodes';

vi.mock('../orchestrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../orchestrate')>();
  return {
    ...actual,
    runCandidateIngestion: vi.fn(async () => undefined),
  };
});

vi.mock('../../enrichment/resumeIngestion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../enrichment/resumeIngestion')>();
  return {
    ...actual,
    processResumeFromR2: vi.fn(async () => ({ success: true, parsed: null })),
  };
});

vi.mock('../../cvParser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cvParser')>();
  return {
    ...actual,
    extractTextFromResumeFile: vi.fn(async () =>
      'PDF Candidate\nSenior TypeScript engineer shipping source-backed assessment systems.',
    ),
  };
});

vi.mock('../../talentPoolIdentity', () => ({
  ensureRolelessTalentPoolIdentity: vi.fn(async () => ({
    personId: 'person-1',
    workspacePersonId: 'workspace-person-1',
  })),
}));

vi.mock('../candidateNodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../candidateNodes')>();
  return {
    ...actual,
    repairCandidateResumeNodeSourceRefs: vi.fn(async () => ({ scanned: 0, repaired: 0 })),
  };
});

interface PreparedCall {
  sql: string;
  params: unknown[];
  ran: boolean;
}

interface FakeD1 extends D1Database {
  __calls: PreparedCall[];
}

function fakeD1(options: {
  first?: unknown | ((call: PreparedCall) => unknown);
  all?: unknown[];
} = {}): FakeD1 {
  const calls: PreparedCall[] = [];

  const prepare = (sql: string): D1PreparedStatement => {
    const call: PreparedCall = { sql, params: [], ran: false };
    calls.push(call);
    const stmt = {
      bind: (...params: unknown[]) => {
        call.params = params;
        return stmt;
      },
      first: async () => {
        if (typeof options.first === 'function') {
          return options.first(call) ?? null;
        }
        return options.first ?? null;
      },
      all: async () => ({
        results: options.all ?? [],
        success: true,
        meta: {},
      }),
      run: async () => {
        call.ran = true;
        return { success: true, meta: { changes: 1 } };
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement;
    return stmt;
  };

  return {
    prepare,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    __calls: calls,
  } as unknown as FakeD1;
}

function fakeStorage(
  text: string | null,
  contentType = 'text/plain;charset=utf-8',
  customMetadata?: Record<string, string>,
): R2Bucket {
  return {
    get: vi.fn(async () => text === null
      ? null
      : ({
          text: async () => text,
          arrayBuffer: async () => new TextEncoder().encode(text).buffer,
          size: new TextEncoder().encode(text).byteLength,
          httpMetadata: { contentType },
          customMetadata,
        })),
  } as unknown as R2Bucket;
}

function buildEnv(db: D1Database, storage?: R2Bucket): Env {
  return {
    DB: db,
    STORAGE: storage,
  } as unknown as Env;
}

describe('stale Workers AI candidate-ingestion retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies only stale provider deprecations during discovery as retryable', () => {
    expect(isRetryableStaleWorkersAIModelFailure({
      status: 'failed',
      current_step: 'discover_profile',
      error_text: 'Discovery failed: 5028: This model was deprecated on 2026-05-30.',
    })).toBe(true);
    expect(isRetryableStaleWorkersAIModelFailure({
      status: 'failed',
      current_step: 'discover_profile',
      error_text: 'Discovery failed: Candidate Discovery response was not a JSON object',
    })).toBe(false);
    expect(isRetryableStaleWorkersAIModelFailure({
      status: 'pending',
      current_step: 'discover_profile',
      error_text: '5028: deprecated',
    })).toBe(false);
  });

  it('classifies candidate discovery output contract failures as retryable after prompt/model fixes', () => {
    expect(isRetryableCandidateDiscoveryOutputFailure({
      status: 'failed',
      current_step: 'discover_profile',
      error_text: 'Discovery failed: Candidate Discovery response was not a JSON object',
    })).toBe(true);
    expect(isRetryableCandidateDiscoveryOutputFailure({
      status: 'failed',
      current_step: 'discover_profile',
      error_text: 'Discovery failed: Candidate Discovery profile too short: got 0 chars, need >= 400',
    })).toBe(true);
    expect(isRetryableCandidateDiscoveryOutputFailure({
      status: 'failed',
      current_step: 'discover_profile',
      error_text: 'Discovery failed: Cloudflare Workers AI call failed for model @cf/zai-org/glm-4.7-flash: 3046: Request timeout',
    })).toBe(true);
    expect(isRetryableCandidateDiscoveryOutputFailure({
      status: 'failed',
      current_step: 'discover_profile',
      error_text: 'Discovery failed: Candidate Discovery AI workers-ai/@cf/zai-org/glm-4.7-flash timed out after 18000ms',
    })).toBe(true);
    expect(isRetryableCandidateDiscoveryOutputFailure({
      status: 'failed',
      current_step: 'embed_profile',
      error_text: 'Embed failed: Candidate Discovery response was not a JSON object',
    })).toBe(false);
  });

  it('classifies only stale in-progress source-backed ingestion as retryable', () => {
    const now = Date.parse('2026-06-28T21:30:00.000Z');

    expect(isRetryableStalledInProgressIngestion({
      status: 'pending',
      current_step: 'decompose_resume',
      updated_at: '2026-06-28T21:19:59.999Z',
    }, now)).toBe(true);
    expect(isRetryableStalledInProgressIngestion({
      status: 'pending',
      current_step: 'decompose_resume',
      updated_at: '2026-06-28T21:20:30.000Z',
    }, now)).toBe(false);
    expect(isRetryableStalledInProgressIngestion({
      status: 'failed',
      current_step: 'decompose_resume',
      updated_at: '2026-06-28T21:00:00.000Z',
    }, now)).toBe(false);
    expect(isRetryableStalledInProgressIngestion({
      status: 'pending',
      current_step: null,
      updated_at: '2026-06-28T21:00:00.000Z',
    }, now)).toBe(false);
    expect(isRetryableStalledInProgressIngestion({
      status: 'pending',
      current_step: 'talent_pool_profile_received',
      updated_at: '2026-06-28T21:00:00.000Z',
    }, now)).toBe(true);
  });

  it('resolves scheduled retry batch size from env with conservative bounds', () => {
    expect(resolveCandidateIngestionRetryLimit({} as Env)).toBe(3);
    expect(resolveCandidateIngestionRetryLimit({ CANDIDATE_INGESTION_RETRY_LIMIT: '12' } as Env)).toBe(12);
    expect(resolveCandidateIngestionRetryLimit({ CANDIDATE_INGESTION_RETRY_LIMIT: '0' } as Env)).toBe(1);
    expect(resolveCandidateIngestionRetryLimit({ CANDIDATE_INGESTION_RETRY_LIMIT: '99' } as Env)).toBe(25);
    expect(resolveCandidateIngestionRetryLimit({ CANDIDATE_INGESTION_RETRY_LIMIT: 'not-a-number' } as Env)).toBe(3);
  });

  it('retries text-intake evidence from the original R2 source', async () => {
    const db = fakeD1();
    const storage = fakeStorage(
      'Staff TypeScript engineer building Cloudflare Workers runtime tooling and source-backed tests.',
    );
    const env = buildEnv(db, storage);

    await retryCandidateEvidenceIngestionFromSource(
      env,
      'candidate-1',
      'text-intake/candidate-1/2026-06-27T10:33:04.051Z',
    );

    expect(storage.get).toHaveBeenCalledWith('text-intake/candidate-1/2026-06-27T10:33:04.051Z');
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      env,
      db,
      candidateId: 'candidate-1',
      resumeText: expect.stringContaining('Cloudflare Workers runtime tooling'),
      decompositionResult: null,
      maxNodeEmbeddings: 0,
      maxParserOnlyNodes: 12,
      mirrorLivingContext: false,
      skipPostDecompositionMaintenance: true,
    }));
  });

  it('retries Talent Pool text evidence from the original R2 source', async () => {
    const db = fakeD1({
      first: {
        owner_id: 'owner-1',
        name: 'Talent Candidate',
        email: 'talent@example.com',
        profile_r2_key: 'talent-intake/talent-candidate-1/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-profile.txt',
        github_url: 'https://github.com/talent-candidate',
        linkedin_url: 'https://linkedin.com/in/talent-candidate',
        portfolio_url: 'https://talent.example.dev',
        phone_screener_consent: 1,
        phone_number: '+15551234567',
        timezone: 'America/Vancouver',
        availability: 'Weekday afternoons after 2 PM.',
        submitted_at: '2026-07-02T18:22:39.331Z',
        updated_at: '2026-07-02T18:22:39.331Z',
      },
    });
    const storage = fakeStorage(
      'Staff product engineer building source-backed hiring assessments and deterministic evidence replay.',
    );
    const env = buildEnv(db, storage);

    const profileStorageKey = 'talent-intake/talent-candidate-1/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-profile.txt';

    await retryCandidateEvidenceIngestionFromSource(
      env,
      'talent-candidate-1',
      profileStorageKey,
    );

    expect(storage.get).toHaveBeenCalledWith(profileStorageKey);
    expect(ensureRolelessTalentPoolIdentity).toHaveBeenCalledWith(expect.objectContaining({
      db,
      userId: 'owner-1',
      candidateId: 'talent-candidate-1',
      name: 'Talent Candidate',
      email: 'talent@example.com',
      operationalContext: {
        githubUrl: 'https://github.com/talent-candidate',
        linkedinUrl: 'https://linkedin.com/in/talent-candidate',
        portfolioUrl: 'https://talent.example.dev',
        phoneScreenerConsent: true,
        phoneNumber: '+15551234567',
        timezone: 'America/Vancouver',
        availability: 'Weekday afternoons after 2 PM.',
      },
      message: expect.stringContaining('source-backed hiring assessments'),
      messageStorageKey: profileStorageKey,
      messageMediaType: 'text/plain',
      projectMessageAsProfileEvidence: true,
      now: '2026-07-02T18:22:39.331Z',
    }));
    expect(repairCandidateResumeNodeSourceRefs).toHaveBeenCalledWith(db, 'talent-candidate-1');
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      env,
      db,
      candidateId: 'talent-candidate-1',
      resumeText: expect.stringContaining('source-backed hiring assessments'),
      decompositionResult: null,
      maxNodeEmbeddings: 0,
      maxParserOnlyNodes: 12,
      mirrorLivingContext: false,
      skipPostDecompositionMaintenance: true,
    }));
  });

  it('routes uploaded resume retries through bounded pre-extracted document recovery', async () => {
    const db = fakeD1();
    const env = buildEnv(db, fakeStorage('unused', 'application/pdf'));

    await retryCandidateEvidenceIngestionFromSource(
      env,
      'candidate-pdf',
      'candidate-documents/candidate-pdf/resume.pdf',
    );

    expect(extractTextFromResumeFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'application/pdf',
    );
    expect(processResumeFromR2).toHaveBeenCalledWith(expect.objectContaining({
      env,
      db,
      candidateId: 'candidate-pdf',
      r2Key: 'candidate-documents/candidate-pdf/resume.pdf',
      candidateDiscoveryTimeoutMs: 18000,
      candidateDiscoveryMaxAttempts: 2,
      maxNodeEmbeddings: 0,
      maxParserOnlyNodes: 12,
      skipPostDecompositionMaintenance: true,
      preExtractedResumeText: expect.stringContaining('TypeScript engineer'),
      preParsed: expect.objectContaining({
        decompositionResult: null,
        parsedCV: expect.objectContaining({
          experiences: expect.any(Array),
          educationBlocks: expect.any(Array),
          credentials: expect.any(Array),
          projects: expect.any(Array),
        }),
      }),
    }));
  });

  it('passes roleless Talent Pool identity into document retries', async () => {
    const db = fakeD1({
      first: {
        owner_id: 'owner-1',
        name: 'PDF Candidate',
        email: 'pdf@example.com',
        github_url: 'https://github.com/pdf-candidate',
        linkedin_url: null,
        portfolio_url: null,
        phone_screener_consent: 0,
        phone_number: null,
        timezone: null,
        availability: null,
        submitted_at: '2026-07-02T19:37:48.430Z',
        updated_at: '2026-07-02T19:37:48.430Z',
      },
    });
    const env = buildEnv(db, fakeStorage('unused'));

    await retryCandidateEvidenceIngestionFromSource(
      env,
      'talent-pdf',
      'talent-intake/talent-pdf/resume.pdf',
    );

    expect(ensureRolelessTalentPoolIdentity).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'talent-pdf',
      email: 'pdf@example.com',
      operationalContext: expect.objectContaining({
        githubUrl: 'https://github.com/pdf-candidate',
        phoneScreenerConsent: false,
      }),
    }));
    expect(extractTextFromResumeFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'application/pdf',
    );
    expect(processResumeFromR2).toHaveBeenCalledWith(expect.objectContaining({
      env,
      db,
      candidateId: 'talent-pdf',
      r2Key: 'talent-intake/talent-pdf/resume.pdf',
      candidateDiscoveryTimeoutMs: 18000,
      candidateDiscoveryMaxAttempts: 2,
      maxNodeEmbeddings: 0,
      maxParserOnlyNodes: 12,
      skipPostDecompositionMaintenance: true,
      preExtractedResumeText: expect.stringContaining('TypeScript engineer'),
      preParsed: expect.objectContaining({
        decompositionResult: null,
        parsedCV: expect.objectContaining({
          experiences: expect.any(Array),
          educationBlocks: expect.any(Array),
          credentials: expect.any(Array),
          projects: expect.any(Array),
        }),
      }),
      livingContextIdentity: {
        personId: 'person-1',
        workspacePersonId: 'workspace-person-1',
      },
    }));
  });

  it('passes candidate-keyed roleless identity into document retries when email is missing', async () => {
    const db = fakeD1({
      first: {
        owner_id: 'owner-1',
        name: 'No Email PDF Candidate',
        email: null,
        github_url: 'https://github.com/no-email-pdf-candidate',
        linkedin_url: null,
        portfolio_url: null,
        phone_screener_consent: 0,
        phone_number: null,
        timezone: null,
        availability: null,
        submitted_at: '2026-07-02T19:37:48.430Z',
        updated_at: '2026-07-02T19:37:48.430Z',
      },
    });
    const env = buildEnv(db, fakeStorage('unused'));

    await retryCandidateEvidenceIngestionFromSource(
      env,
      'talent-pdf-no-email',
      'talent-intake/talent-pdf-no-email/resume.pdf',
    );

    expect(ensureRolelessTalentPoolIdentity).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'talent-pdf-no-email',
      name: 'No Email PDF Candidate',
      email: null,
      operationalContext: expect.objectContaining({
        githubUrl: 'https://github.com/no-email-pdf-candidate',
        phoneScreenerConsent: false,
      }),
    }));
    expect(processResumeFromR2).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'talent-pdf-no-email',
      r2Key: 'talent-intake/talent-pdf-no-email/resume.pdf',
      livingContextIdentity: {
        personId: 'person-1',
        workspacePersonId: 'workspace-person-1',
      },
    }));
  });

  it('queues and runs a candidate-scoped stale retry from the RPC path', async () => {
    const db = fakeD1({
      first: {
        resume_s3_key: 'text-intake/candidate-2/source',
        status: 'failed',
        current_step: 'discover_profile',
        error_text: 'Discovery failed: This model was decommissioned.',
      },
    });
    const env = buildEnv(db, fakeStorage(
      'Frontend systems engineer building collaborative editors and deterministic Playwright checks.',
    ));

    await expect(maybeQueueRetryableStandaloneIngestion(env, null, 'candidate-2')).resolves.toMatchObject({
      reasonCode: 'stale_workers_ai_model_failure',
      originalStep: 'discover_profile',
    });

    expect(db.__calls.some((call) =>
      call.ran
      && call.sql.includes("current_step = 'retry_queued'")
      && call.params[0] === 'candidate-2'
    )).toBe(true);
    const retryEventCall = db.__calls.find((call) =>
      call.ran
      && call.sql.includes('INSERT INTO session_events')
      && call.params[1] === 'ingestion-candidate-2'
      && call.params[4] === 'ingestion_retry_queued'
    );
    expect(retryEventCall).toBeDefined();
    expect(JSON.parse(retryEventCall!.params[5] as string)).toMatchObject({
      trigger: 'candidate_rpc',
      reason: 'stale_workers_ai_model_failure',
      sourceRef: {
        type: 'text_intake_r2_object',
        key: 'text-intake/candidate-2/source',
      },
    });
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'candidate-2',
      resumeText: expect.stringContaining('collaborative editors'),
    }));
  });

  it('queues and runs a candidate-scoped retry when source-backed ingestion stalls in progress', async () => {
    const db = fakeD1({
      first: {
        resume_s3_key: 'text-intake/stalled/source',
        status: 'pending',
        current_step: 'talent_pool_profile_received',
        error_text: null,
        updated_at: '2026-06-28T18:00:00.000Z',
      },
    });
    const env = buildEnv(db, fakeStorage(
      'Staff frontend engineer building dev-container assessments, repo-task tooling, and evidence-backed tests.',
    ));

    await expect(maybeQueueRetryableStandaloneIngestion(env, null, 'stalled')).resolves.toMatchObject({
      reason: STALLED_INGESTION_RETRY_REASON,
      reasonCode: 'stalled_candidate_evidence_ingestion',
      originalStep: 'talent_pool_profile_received',
      originalUpdatedAt: '2026-06-28T18:00:00.000Z',
    });

    const retryEventCall = db.__calls.find((call) =>
      call.ran
      && call.sql.includes('INSERT INTO session_events')
      && call.params[1] === 'ingestion-stalled'
      && call.params[4] === 'ingestion_retry_queued'
    );
    expect(retryEventCall).toBeDefined();
    expect(JSON.parse(retryEventCall!.params[5] as string)).toMatchObject({
      trigger: 'candidate_rpc',
      reason: 'stalled_candidate_evidence_ingestion',
      originalStep: 'talent_pool_profile_received',
      originalUpdatedAt: '2026-06-28T18:00:00.000Z',
      sourceRef: {
        type: 'text_intake_r2_object',
        key: 'text-intake/stalled/source',
      },
    });
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'stalled',
      resumeText: expect.stringContaining('repo-task tooling'),
    }));
  });

  it('queues and runs ingestion when a candidate has an uploaded resume but no ingestion row', async () => {
    const db = fakeD1({
      first: {
        resume_s3_key: 'candidate-documents/candidate-missing/resume.pdf',
        status: null,
        current_step: null,
        error_text: null,
        updated_at: null,
      },
    });
    const env = buildEnv(db, fakeStorage('unused'));

    await expect(maybeQueueRetryableStandaloneIngestion(env, null, 'candidate-missing')).resolves.toMatchObject({
      reason: MISSING_INGESTION_RETRY_REASON,
      reasonCode: 'missing_candidate_evidence_ingestion',
      originalStep: null,
      originalUpdatedAt: null,
    });

    const queuedCall = db.__calls.find((call) =>
      call.ran
      && call.sql.includes('INSERT INTO candidate_ingestion')
      && call.sql.includes("current_step = 'retry_queued'")
      && call.params[0] === 'candidate-missing'
    );
    expect(queuedCall).toBeDefined();

    const retryEventCall = db.__calls.find((call) =>
      call.ran
      && call.sql.includes('INSERT INTO session_events')
      && call.params[1] === 'ingestion-candidate-missing'
      && call.params[4] === 'ingestion_retry_queued'
    );
    expect(retryEventCall).toBeDefined();
    expect(JSON.parse(retryEventCall!.params[5] as string)).toMatchObject({
      trigger: 'candidate_rpc',
      reason: 'missing_candidate_evidence_ingestion',
      staleFailureStep: 'not_recorded',
      originalStep: null,
      sourceRef: {
        type: 'resume_r2_object',
        key: 'candidate-documents/candidate-missing/resume.pdf',
      },
    });
    expect(processResumeFromR2).toHaveBeenCalledWith(expect.objectContaining({
      env,
      db,
      candidateId: 'candidate-missing',
      r2Key: 'candidate-documents/candidate-missing/resume.pdf',
      candidateDiscoveryTimeoutMs: 18000,
      candidateDiscoveryMaxAttempts: 2,
      maxNodeEmbeddings: 0,
      maxParserOnlyNodes: 12,
      skipPostDecompositionMaintenance: true,
      preExtractedResumeText: expect.stringContaining('TypeScript engineer'),
      preParsed: expect.objectContaining({
        decompositionResult: null,
        parsedCV: expect.objectContaining({
          experiences: expect.any(Array),
          educationBlocks: expect.any(Array),
          credentials: expect.any(Array),
          projects: expect.any(Array),
        }),
      }),
    }));
  });

  it('cron processes a bounded batch of stale discovery failures', async () => {
    const db = fakeD1({
      all: [
        {
          candidate_id: 'oldest',
          resume_s3_key: 'text-intake/oldest/source',
          status: 'failed',
          current_step: 'discover_profile',
          error_text: 'Discovery failed: 5028: This model was deprecated on 2026-05-30.',
        },
        {
          candidate_id: 'bad-json',
          resume_s3_key: 'text-intake/bad-json/source',
          status: 'failed',
          current_step: 'discover_profile',
          error_text: 'Discovery failed: Candidate Discovery response was not a JSON object',
        },
        {
          candidate_id: 'request-timeout',
          resume_s3_key: 'text-intake/request-timeout/source',
          status: 'failed',
          current_step: 'discover_profile',
          error_text: 'Discovery failed: Cloudflare Workers AI call failed for model @cf/zai-org/glm-4.7-flash: 3046: Request timeout',
        },
        {
          candidate_id: 'stalled',
          resume_s3_key: 'text-intake/stalled/source',
          status: 'pending',
          current_step: 'decompose_resume',
          error_text: null,
          updated_at: '2026-06-28T18:00:00.000Z',
        },
      ],
    });
    const env = buildEnv(db, fakeStorage(
      'Backend engineer building queue workers, runtime recovery, and exact provenance tests.',
    ));

    await expect(processStaleWorkersAIModelIngestionRetries(env, 3)).resolves.toEqual({
      scanned: 4,
      queued: 3,
      skipped: 1,
      failed: 0,
    });
    const selectCall = db.__calls.find((call) => call.sql.includes('FROM candidate_ingestion ci'))!;
    expect(selectCall.sql).toContain("ci.current_step IN ('talent_pool_profile_received', 'queued', 'retry_queued', 'parse_resume', 'decompose_resume', 'discover_profile', 'embed_profile', 'match_and_assign')");
    expect(selectCall.sql).toContain("CASE WHEN ci.status = 'pending' THEN 0 ELSE 1 END");
    expect(selectCall.sql).toContain("c.resume_s3_key LIKE 'candidate-documents/%'");
    expect(selectCall.sql).toContain("c.resume_s3_key LIKE 'talent-intake/%'");
    expect(selectCall.sql).toContain("CASE WHEN ci.status = 'pending' THEN ci.updated_at END DESC");
    expect(selectCall.sql).toContain("CASE WHEN ci.status = 'failed' THEN ci.updated_at END DESC");
    expect(selectCall.params[1]).toBe(18);
    expect(runCandidateIngestion).toHaveBeenCalledTimes(3);
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'oldest',
    }));
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'bad-json',
    }));
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'request-timeout',
    }));
    const retryEventCall = db.__calls.find((call) =>
      call.ran
      && call.sql.includes('INSERT INTO session_events')
      && call.params[1] === 'ingestion-oldest'
      && call.params[4] === 'ingestion_retry_queued'
    );
    expect(retryEventCall).toBeDefined();
    expect(JSON.parse(retryEventCall!.params[5] as string)).toMatchObject({
      trigger: 'scheduled_worker',
      originalErrorText: expect.stringContaining('5028'),
      sourceRef: {
        type: 'text_intake_r2_object',
        key: 'text-intake/oldest/source',
      },
    });
  });

  it('cron uses env configured retry throughput when no explicit limit is passed', async () => {
    const db = fakeD1({
      all: Array.from({ length: 6 }, (_, index) => ({
        candidate_id: `candidate-${index}`,
        resume_s3_key: `text-intake/candidate-${index}/source`,
        status: 'failed',
        current_step: 'discover_profile',
        error_text: 'Discovery failed: Candidate Discovery response was not a JSON object',
      })),
    });
    const env = {
      ...buildEnv(db, fakeStorage(
        'Backend engineer building queue workers, runtime recovery, and exact provenance tests.',
      )),
      CANDIDATE_INGESTION_RETRY_LIMIT: '4',
    } as Env;

    await expect(processStaleWorkersAIModelIngestionRetries(env)).resolves.toEqual({
      scanned: 6,
      queued: 4,
      skipped: 2,
      failed: 0,
    });
    const selectCall = db.__calls.find((call) => call.sql.includes('FROM candidate_ingestion ci'))!;
    expect(selectCall.params[1]).toBe(24);
    expect(runCandidateIngestion).toHaveBeenCalledTimes(4);
  });

  it('retries failed pipeline candidate ingestion from original source evidence', async () => {
    const db = fakeD1({
      all: [
        {
          candidate_id: 'pipeline-candidate-1',
          resume_s3_key: 'text-intake/pipeline-candidate-1/source',
          status: 'failed',
          current_step: 'discover_profile',
          error_text: 'Discovery failed: Candidate Discovery response was not a JSON object',
          updated_at: '2026-07-01T22:00:00.000Z',
        },
        {
          candidate_id: 'pipeline-candidate-2',
          resume_s3_key: 'text-intake/pipeline-candidate-2/source',
          status: null,
          current_step: null,
          error_text: null,
          updated_at: null,
        },
        {
          candidate_id: 'non-retryable',
          resume_s3_key: 'text-intake/non-retryable/source',
          status: 'embedded',
          current_step: 'embed_profile',
          error_text: null,
          updated_at: '2026-07-01T22:00:00.000Z',
        },
      ],
    });
    const env = buildEnv(db, fakeStorage(
      'Pipeline candidate evidence. Built React TypeScript workflows, fixed queue retry bugs, and wrote Vitest coverage.',
    ));

    await expect(processPipelineCandidateIngestionRetries(env, {
      pipelineId: 'pipeline-1',
      ownerId: 'owner-1',
      limit: 2,
      executionCtx: null,
    })).resolves.toEqual({
      scanned: 3,
      queued: 2,
      skipped: 1,
      failed: 0,
    });

    const selectCall = db.__calls.find((call) => call.sql.includes('JOIN pipelines p ON p.id = c.pipeline_id'))!;
    expect(selectCall.params.slice(0, 2)).toEqual(['pipeline-1', 'owner-1']);
    expect(selectCall.sql).toContain('c.resume_s3_key IS NOT NULL');
    expect(runCandidateIngestion).toHaveBeenCalledTimes(2);
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'pipeline-candidate-1',
      resumeText: expect.stringContaining('Pipeline candidate evidence'),
      skipPostDecompositionMaintenance: true,
    }));
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'pipeline-candidate-2',
    }));
  });

  it('cron repairs missing Talent Pool operational context projections', async () => {
    const db = fakeD1({
      all: [
        { candidate_id: 'talent-1' },
        { candidate_id: 'talent-2' },
      ],
      first: {
        owner_id: 'owner-1',
        name: 'Talent Candidate',
        email: 'talent@example.com',
        github_url: 'https://github.com/talent-candidate',
        linkedin_url: 'https://linkedin.com/in/talent-candidate',
        portfolio_url: 'https://talent.example.dev',
        phone_screener_consent: 1,
        phone_number: '+15551234567',
        timezone: 'America/Vancouver',
        availability: 'Weekday afternoons after 2 PM.',
        submitted_at: '2026-07-02T18:22:39.331Z',
        updated_at: '2026-07-02T18:22:39.331Z',
      },
    });
    const env = buildEnv(db, fakeStorage('unused'));

    await expect(processTalentPoolOperationalContextRepairs(env, 2)).resolves.toEqual({
      scanned: 2,
      repaired: 2,
      skipped: 0,
      failed: 0,
    });

    const selectCall = db.__calls.find((call) => call.sql.includes('FROM talent_pool_intakes'))!;
    expect(selectCall.params[0]).toBe(2);
    expect(selectCall.sql).toContain('FROM applications app');
    expect(ensureRolelessTalentPoolIdentity).toHaveBeenCalledTimes(2);
    expect(ensureRolelessTalentPoolIdentity).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'talent-1',
      operationalContext: expect.objectContaining({
        githubUrl: 'https://github.com/talent-candidate',
        phoneScreenerConsent: true,
      }),
    }));
    expect(repairCandidateResumeNodeSourceRefs).toHaveBeenCalledTimes(2);
    expect(repairCandidateResumeNodeSourceRefs).toHaveBeenCalledWith(db, 'talent-1');
    expect(repairCandidateResumeNodeSourceRefs).toHaveBeenCalledWith(db, 'talent-2');
  });

  it('cron backfills missing Talent Pool upload receipt artifacts from the original R2 object', async () => {
    const storageKey = 'talent-intake/talent-upload/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-profile.pdf';
    const objectBytes = 'pdf bytes for immutable Talent Pool upload receipt';
    const db = fakeD1({
      all: [
        { candidate_id: 'talent-upload' },
      ],
      first: (call) => {
        if (call.sql.includes('receipt_count')) return { receipt_count: 0 };
        if (call.sql.includes('source_span_count')) return { source_span_count: 2 };
        return {
          owner_id: 'owner-1',
          name: 'Uploaded Candidate',
          email: null,
          profile_r2_key: storageKey,
          github_url: null,
          linkedin_url: null,
          portfolio_url: null,
          phone_screener_consent: 0,
          phone_number: null,
          timezone: null,
          availability: null,
          submitted_at: '2026-07-02T18:22:39.331Z',
          updated_at: '2026-07-02T18:22:39.331Z',
        };
      },
    });
    const storage = fakeStorage(objectBytes, 'application/pdf', {
      source: 'talent_pool_intake',
      candidateId: 'talent-upload',
      sourceKind: 'uploaded_profile_file',
      originalFileName: 'profile.pdf',
    });
    const env = buildEnv(db, storage);

    await expect(processTalentPoolOperationalContextRepairs(env, 1)).resolves.toEqual({
      scanned: 1,
      repaired: 1,
      skipped: 0,
      failed: 0,
    });

    expect(storage.get).toHaveBeenCalledWith(storageKey);
    const identityInput = vi.mocked(ensureRolelessTalentPoolIdentity).mock.calls[0]?.[0];
    expect(identityInput).toMatchObject({
      candidateId: 'talent-upload',
      name: 'Uploaded Candidate',
      email: null,
      sourceArtifact: {
        storageKey,
        mediaType: 'application/pdf',
        byteLength: new TextEncoder().encode(objectBytes).byteLength,
        originalFileName: 'profile.pdf',
        extractedTextAvailable: true,
      },
    });
    expect(identityInput?.message).toBeUndefined();
    expect(identityInput?.messageStorageKey).toBeNull();
    expect(identityInput?.sourceArtifact?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repairCandidateResumeNodeSourceRefs).toHaveBeenCalledWith(db, 'talent-upload');
    const scanCall = db.__calls.find((call) => call.sql.includes('FROM talent_pool_intakes'))!;
    expect(scanCall.sql).toContain('t.profile_r2_key');
  });

  it('cron replays pasted Talent Pool profile text as source-backed profile evidence, not an upload receipt', async () => {
    const storageKey = 'talent-intake/talent-pasted/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-profile.txt';
    const pastedProfileText = 'Pasted profile text is raw source evidence for a senior TypeScript engineer shipping deterministic ingestion replay.';
    const db = fakeD1({
      all: [
        { candidate_id: 'talent-pasted' },
      ],
      first: (call) => {
        if (call.sql.includes('receipt_count')) return { receipt_count: 0 };
        if (call.sql.includes('source_span_count')) return { source_span_count: 0 };
        return {
          owner_id: 'owner-1',
          name: 'Pasted Candidate',
          email: 'pasted@example.com',
          profile_r2_key: storageKey,
          github_url: null,
          linkedin_url: null,
          portfolio_url: null,
          phone_screener_consent: 0,
          phone_number: null,
          timezone: null,
          availability: null,
          submitted_at: '2026-07-02T18:22:39.331Z',
          updated_at: '2026-07-02T18:22:39.331Z',
        };
      },
    });
    const storage = fakeStorage(
      pastedProfileText,
      'text/plain;charset=utf-8',
      {
        source: 'talent_pool_intake',
        candidateId: 'talent-pasted',
        sourceKind: 'pasted_profile_text',
      },
    );
    const env = buildEnv(db, storage);

    await expect(processTalentPoolOperationalContextRepairs(env, 1)).resolves.toEqual({
      scanned: 1,
      repaired: 1,
      skipped: 0,
      failed: 0,
    });

    expect(storage.get).toHaveBeenCalledWith(storageKey);
    const identityInput = vi.mocked(ensureRolelessTalentPoolIdentity).mock.calls[0]?.[0];
    expect(identityInput).toMatchObject({
      candidateId: 'talent-pasted',
      name: 'Pasted Candidate',
      email: 'pasted@example.com',
      message: pastedProfileText,
      messageStorageKey: storageKey,
      messageMediaType: 'text/plain',
      projectMessageAsProfileEvidence: true,
    });
    expect(identityInput?.sourceArtifact).toBeUndefined();
    expect(repairCandidateResumeNodeSourceRefs).toHaveBeenCalledWith(db, 'talent-pasted');
  });

  it('cron skips Talent Pool upload receipt backfill when the profile upload artifact already exists', async () => {
    const storageKey = 'talent-intake/talent-upload/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-profile.pdf';
    const db = fakeD1({
      all: [
        { candidate_id: 'talent-upload' },
      ],
      first: (call) => {
        if (call.sql.includes('receipt_count')) return { receipt_count: 1 };
        return {
          owner_id: 'owner-1',
          name: 'Uploaded Candidate',
          email: 'uploaded@example.com',
          profile_r2_key: storageKey,
          github_url: null,
          linkedin_url: null,
          portfolio_url: null,
          phone_screener_consent: 0,
          phone_number: null,
          timezone: null,
          availability: null,
          submitted_at: '2026-07-02T18:22:39.331Z',
          updated_at: '2026-07-02T18:22:39.331Z',
        };
      },
    });
    const storage = fakeStorage('should not be read', 'application/pdf');
    const env = buildEnv(db, storage);

    await expect(processTalentPoolOperationalContextRepairs(env, 1)).resolves.toEqual({
      scanned: 1,
      repaired: 1,
      skipped: 0,
      failed: 0,
    });

    expect(storage.get).not.toHaveBeenCalled();
    const identityInput = vi.mocked(ensureRolelessTalentPoolIdentity).mock.calls[0]?.[0];
    expect(identityInput?.sourceArtifact).toBeUndefined();
  });

  it('cron removes generated roleless Talent Pool application rows', async () => {
    const db = fakeD1({
      all: [
        { application_id: 'application-1' },
        { application_id: 'application-2' },
      ],
    });
    const env = buildEnv(db, fakeStorage('unused'));

    await expect(processTalentPoolRolelessApplicationRepairs(env, 2)).resolves.toEqual({
      scanned: 2,
      deletedApplications: 2,
      deletedPersonRoles: 2,
      failed: 0,
    });

    const selectCall = db.__calls.find((call) => call.sql.includes('FROM applications app'))!;
    expect(selectCall.params[0]).toBe(2);
    const deleteRoleCalls = db.__calls.filter((call) =>
      call.ran && call.sql.includes('DELETE FROM person_roles')
    );
    const deleteApplicationCalls = db.__calls.filter((call) =>
      call.ran && call.sql.includes('DELETE FROM applications')
    );
    expect(deleteRoleCalls.map((call) => call.params[0])).toEqual(['application-1', 'application-2']);
    expect(deleteApplicationCalls.map((call) => call.params[0])).toEqual(['application-1', 'application-2']);
  });

  it('records append-only retry failure evidence when the original source is missing', async () => {
    const db = fakeD1();
    const env = buildEnv(db, fakeStorage(null));

    await retryCandidateEvidenceIngestionFromSource(
      env,
      'missing-source',
      'text-intake/missing-source/source',
      {
        trigger: 'scheduled_worker',
        reasonCode: 'stale_workers_ai_model_failure',
        originalErrorText: 'Discovery failed: 5028 deprecated model',
        originalStep: 'discover_profile',
      },
    );

    expect(db.__calls.some((call) =>
      call.ran
      && call.sql.includes('candidate_ingestion')
      && call.params[0] === 'missing-source'
      && String(call.params[1]).includes('Retry failed: original text intake source not found')
    )).toBe(true);
    const failureEventCall = db.__calls.find((call) =>
      call.ran
      && call.sql.includes('INSERT INTO session_events')
      && call.params[1] === 'ingestion-missing-source'
      && call.params[4] === 'ingestion_retry_failed'
    );
    expect(failureEventCall).toBeDefined();
    expect(JSON.parse(failureEventCall!.params[5] as string)).toMatchObject({
      trigger: 'scheduled_worker',
      reason: 'stale_workers_ai_model_failure',
      originalErrorText: 'Discovery failed: 5028 deprecated model',
      errorText: expect.stringContaining('Retry failed: original text intake source not found'),
      sourceRef: {
        type: 'text_intake_r2_object',
        key: 'text-intake/missing-source/source',
      },
    });
  });
});
