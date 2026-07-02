import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processResumeFromR2 } from '../resumeIngestion';
import type { Env } from '../../../types';

vi.mock('../../cvParser', () => ({
  parseResume: vi.fn(async () => ({
    parsedCV: { skills: ['TypeScript'], experiences: [], educationBlocks: [], credentials: [], projects: [] },
    decompositionResult: null,
  })),
  persistParsedCV: vi.fn(async () => undefined),
  extractTextFromResumeFile: vi.fn(async () =>
    'Jane Doe\nSenior Software Engineer with 8 years of experience building distributed systems.\n\nExperience\nLed migration from monolith to microservices at Acme Corp.',
  ),
}));

vi.mock('../../candidateDiscovery/orchestrate', () => ({
  runCandidateIngestion: vi.fn(async () => undefined),
}));

const mockIngestResume = vi.fn(async () => ({
  personId: 'person-1',
  workspacePersonId: 'wp-1',
  applicationId: 'app-1',
  interactionId: 'int-1',
  artifactId: 'art-1',
  artifactVersionId: 'av-1',
  sourceSpanCount: 3,
  assertionCount: 2,
  conceptCount: 1,
  signalEvidenceCount: 1,
}));

vi.mock('../../livingContext/resumeIngestion', () => ({
  ingestResumeToLivingContext: (...args: unknown[]) => mockIngestResume(...args),
}));

function buildMockEnv(
  db: D1Database,
  contentType = 'application/pdf',
): Env {
  return {
    DB: db,
    STORAGE: {
      get: vi.fn(async () => ({
        arrayBuffer: async () => new ArrayBuffer(10),
        httpMetadata: { contentType },
      })),
    },
    MOCK_AI: 'true',
  } as unknown as Env;
}

describe('processResumeFromR2 — living context integration', () => {
  let db: D1Database;

  beforeEach(() => {
    vi.clearAllMocks();
    db = {} as D1Database;
  });

  it('calls ingestResumeToLivingContext after legacy pipeline', async () => {
    const env = buildMockEnv(db);
    const result = await processResumeFromR2({
      env,
      db,
      candidateId: 'cand-123',
      r2Key: 'candidate-documents/cand-123/resume.pdf',
    });

    expect(result.success).toBe(true);
    expect(mockIngestResume).toHaveBeenCalledOnce();
    expect(mockIngestResume).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        candidateId: 'cand-123',
        storageKey: 'candidate-documents/cand-123/resume.pdf',
        mediaType: 'application/pdf',
        uploadedAt: expect.any(String),
      }),
    );
  });

  it('skips living context ingestion when resume text is too short', async () => {
    const { extractTextFromResumeFile } = await import('../../cvParser');
    vi.mocked(extractTextFromResumeFile).mockResolvedValueOnce('short');

    const env = buildMockEnv(db);
    const result = await processResumeFromR2({
      env,
      db,
      candidateId: 'cand-short',
      r2Key: 'candidate-documents/cand-short/resume.pdf',
    });

    expect(result.success).toBe(true);
    expect(mockIngestResume).not.toHaveBeenCalled();
  });

  it('does not fail the upload when living context ingestion throws', async () => {
    mockIngestResume.mockRejectedValueOnce(new Error('LC ingestion failed'));

    const env = buildMockEnv(db);
    const result = await processResumeFromR2({
      env,
      db,
      candidateId: 'cand-err',
      r2Key: 'candidate-documents/cand-err/resume.pdf',
    });

    expect(result.success).toBe(true);
    expect(mockIngestResume).toHaveBeenCalledOnce();
  });

  it('passes resumeText with length >= 20 to living context', async () => {
    const env = buildMockEnv(db);
    await processResumeFromR2({
      env,
      db,
      candidateId: 'cand-456',
      r2Key: 'candidate-documents/cand-456/cv.pdf',
    });

    const call = mockIngestResume.mock.calls[0];
    expect(call).toBeDefined();
    const input = call[1] as { resumeText: string };
    expect(input.resumeText.length).toBeGreaterThanOrEqual(20);
  });

  it('processes DOCX uploads into living context with source media type', async () => {
    const env = buildMockEnv(
      db,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const result = await processResumeFromR2({
      env,
      db,
      candidateId: 'cand-docx',
      r2Key: 'candidate-documents/cand-docx/profile.docx',
    });

    expect(result.success).toBe(true);
    expect(mockIngestResume).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        candidateId: 'cand-docx',
        storageKey: 'candidate-documents/cand-docx/profile.docx',
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
  });
});
