import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processResumeFromR2 } from '../resumeIngestion';
import { runCandidateIngestion } from '../../candidateDiscovery/orchestrate';
import type { Env } from '../../../types';

const talentPoolIdentityMock = vi.hoisted(() => ({
  ensureRolelessTalentPoolIdentity: vi.fn(async () => ({
    personId: 'person-auto-roleless',
    workspacePersonId: 'wp-auto-roleless',
  })),
}));

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

vi.mock('../../talentPoolIdentity', () => ({
  ensureRolelessTalentPoolIdentity: talentPoolIdentityMock.ensureRolelessTalentPoolIdentity,
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

function buildRolelessTalentPoolDb(): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => ({ success: true })),
        first: vi.fn(async () => (
          sql.includes('FROM candidates c') && sql.includes('JOIN talent_pool_intakes t')
            ? {
                candidate_id: 'cand-roleless-auto',
                owner_id: 'dev-user',
                name: 'Jane Roleless',
                email: 'jane@example.com',
                profile_r2_key: 'talent-intake/cand-roleless-auto/profile.pdf',
                profile_text_excerpt: 'Jane Roleless submitted a profile for Talent Pool matching.',
                github_url: 'https://github.com/jane',
                linkedin_url: null,
                portfolio_url: 'https://jane.example.com',
                phone_screener_consent: 1,
                phone_number: '+15555550123',
                timezone: 'America/Vancouver',
                availability: 'Weekday mornings',
              }
            : null
        )),
      })),
    })),
  } as unknown as D1Database;
}

describe('processResumeFromR2 — living context integration', () => {
  let db: D1Database;

  beforeEach(() => {
    vi.clearAllMocks();
    talentPoolIdentityMock.ensureRolelessTalentPoolIdentity.mockResolvedValue({
      personId: 'person-auto-roleless',
      workspacePersonId: 'wp-auto-roleless',
    });
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
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand-123',
      mirrorLivingContext: true,
    }));
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

  it('passes supplied roleless Talent Pool identity into living context ingestion', async () => {
    const env = buildMockEnv(db);
    const result = await processResumeFromR2({
      env,
      db,
      candidateId: 'cand-roleless',
      r2Key: 'talent-intake/cand-roleless/profile.pdf',
      livingContextIdentity: {
        personId: 'person-roleless',
        workspacePersonId: 'wp-roleless',
        applicationId: null,
      },
    });

    expect(result.success).toBe(true);
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand-roleless',
      mirrorLivingContext: false,
    }));
    expect(mockIngestResume).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        candidateId: 'cand-roleless',
        storageKey: 'talent-intake/cand-roleless/profile.pdf',
        identity: {
          personId: 'person-roleless',
          workspacePersonId: 'wp-roleless',
          applicationId: null,
        },
      }),
    );
  });

  it('passes candidate discovery bounds into the ingestion orchestrator', async () => {
    const env = buildMockEnv(db);
    const result = await processResumeFromR2({
      env,
      db,
      candidateId: 'cand-bounded',
      r2Key: 'candidate-documents/cand-bounded/resume.pdf',
      candidateDiscoveryTimeoutMs: 7000,
      candidateDiscoveryMaxAttempts: 1,
    });

    expect(result.success).toBe(true);
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand-bounded',
      candidateDiscoveryTimeoutMs: 7000,
      candidateDiscoveryMaxAttempts: 1,
    }));
  });

  it('auto-resolves roleless Talent Pool identity before document ingestion can mirror legacy applications', async () => {
    db = buildRolelessTalentPoolDb();
    const env = buildMockEnv(db);

    const result = await processResumeFromR2({
      env,
      db,
      candidateId: 'cand-roleless-auto',
      r2Key: 'talent-intake/cand-roleless-auto/profile.pdf',
    });

    expect(result.success).toBe(true);
    expect(talentPoolIdentityMock.ensureRolelessTalentPoolIdentity).toHaveBeenCalledWith(expect.objectContaining({
      db,
      userId: 'dev-user',
      candidateId: 'cand-roleless-auto',
      name: 'Jane Roleless',
      email: 'jane@example.com',
      messageStorageKey: 'talent-intake/cand-roleless-auto/profile.pdf',
      messageMediaType: 'application/pdf',
      operationalContext: expect.objectContaining({
        githubUrl: 'https://github.com/jane',
        portfolioUrl: 'https://jane.example.com',
        phoneScreenerConsent: true,
        phoneNumber: '+15555550123',
        timezone: 'America/Vancouver',
        availability: 'Weekday mornings',
      }),
    }));
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand-roleless-auto',
      mirrorLivingContext: false,
    }));
    expect(mockIngestResume).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        candidateId: 'cand-roleless-auto',
        storageKey: 'talent-intake/cand-roleless-auto/profile.pdf',
        identity: {
          personId: 'person-auto-roleless',
          workspacePersonId: 'wp-auto-roleless',
          applicationId: null,
        },
      }),
    );
  });

  it('fails closed when roleless Talent Pool identity repair throws', async () => {
    talentPoolIdentityMock.ensureRolelessTalentPoolIdentity.mockRejectedValueOnce(new Error('identity repair failed'));
    db = buildRolelessTalentPoolDb();
    const env = buildMockEnv(db);

    const result = await processResumeFromR2({
      env,
      db,
      candidateId: 'cand-roleless-auto',
      r2Key: 'talent-intake/cand-roleless-auto/profile.pdf',
    });

    expect(result.success).toBe(true);
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand-roleless-auto',
      mirrorLivingContext: false,
    }));
    expect(mockIngestResume).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        candidateId: 'cand-roleless-auto',
        identity: null,
      }),
    );
  });
});
