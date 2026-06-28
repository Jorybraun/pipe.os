import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../../types';
import {
  isRetryableStaleWorkersAIModelFailure,
  maybeQueueRetryableStandaloneIngestion,
  processStaleWorkersAIModelIngestionRetries,
  retryCandidateEvidenceIngestionFromSource,
} from '../staleWorkersAiRetry';
import { runCandidateIngestion } from '../orchestrate';
import { processResumeFromR2 } from '../../enrichment/resumeIngestion';

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

interface PreparedCall {
  sql: string;
  params: unknown[];
  ran: boolean;
}

interface FakeD1 extends D1Database {
  __calls: PreparedCall[];
}

function fakeD1(options: {
  first?: unknown;
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
      first: async () => options.first ?? null,
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

function fakeStorage(text: string | null): R2Bucket {
  return {
    get: vi.fn(async () => text === null
      ? null
      : ({
          text: async () => text,
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
    }));
  });

  it('routes uploaded resume retries through the normal R2 resume processor', async () => {
    const db = fakeD1();
    const env = buildEnv(db, fakeStorage('unused'));

    await retryCandidateEvidenceIngestionFromSource(
      env,
      'candidate-pdf',
      'candidate-documents/candidate-pdf/resume.pdf',
    );

    expect(processResumeFromR2).toHaveBeenCalledWith({
      env,
      db,
      candidateId: 'candidate-pdf',
      r2Key: 'candidate-documents/candidate-pdf/resume.pdf',
    });
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

    await expect(maybeQueueRetryableStandaloneIngestion(env, null, 'candidate-2')).resolves.toBe(true);

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
      ],
    });
    const env = buildEnv(db, fakeStorage(
      'Backend engineer building queue workers, runtime recovery, and exact provenance tests.',
    ));

    await expect(processStaleWorkersAIModelIngestionRetries(env, 2)).resolves.toEqual({
      scanned: 2,
      queued: 1,
      skipped: 1,
      failed: 0,
    });
    const selectCall = db.__calls.find((call) => call.sql.includes('FROM candidate_ingestion ci'))!;
    expect(selectCall.params).toEqual([2]);
    expect(runCandidateIngestion).toHaveBeenCalledTimes(1);
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'oldest',
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

  it('records append-only retry failure evidence when the original source is missing', async () => {
    const db = fakeD1();
    const env = buildEnv(db, fakeStorage(null));

    await retryCandidateEvidenceIngestionFromSource(
      env,
      'missing-source',
      'text-intake/missing-source/source',
      {
        trigger: 'scheduled_worker',
        originalErrorText: 'Discovery failed: 5028 deprecated model',
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
