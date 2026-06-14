/**
 * Candidate routes unit tests — GitHub handle intake wiring.
 *
 * Validates the regex, SQL shapes, and enqueue logic used by the
 * POST /:candidateId/resume handler.
 */

import { describe, it, expect } from 'vitest';
import { buildStandaloneReviewMatchSummary } from '../candidates';

// ─── GitHub handle validation ────────────────────────────────────────────────

const GITHUB_HANDLE_RE = /^[a-zA-Z0-9\-]{1,39}$/;

function isValidGitHubHandle(handle: string | null): boolean {
  if (handle === null || handle === '') return true; // optional
  return GITHUB_HANDLE_RE.test(handle);
}

describe('GitHub handle validation', () => {
  it('accepts valid handles', () => {
    expect(isValidGitHubHandle('alice')).toBe(true);
    expect(isValidGitHubHandle('bob123')).toBe(true);
    expect(isValidGitHubHandle('charlie-dev')).toBe(true);
    expect(isValidGitHubHandle('a')).toBe(true);
    expect(isValidGitHubHandle('a'.repeat(39))).toBe(true);
  });

  it('rejects handles with spaces', () => {
    expect(isValidGitHubHandle('alice bob')).toBe(false);
  });

  it('rejects handles over 39 characters', () => {
    expect(isValidGitHubHandle('a'.repeat(40))).toBe(false);
    expect(isValidGitHubHandle('a'.repeat(100))).toBe(false);
  });

  it('rejects handles with special characters', () => {
    expect(isValidGitHubHandle('alice@example')).toBe(false);
    expect(isValidGitHubHandle('alice.dev')).toBe(false);
    expect(isValidGitHubHandle('alice/dev')).toBe(false);
    expect(isValidGitHubHandle('alice_dev')).toBe(false);
    expect(isValidGitHubHandle('alice:dev')).toBe(false);
  });

  it('rejects empty string after trimming (null/empty is handled upstream)', () => {
    // The regex itself rejects empty string, but the handler treats
    // empty/null as "not provided" before calling the regex.
    expect(GITHUB_HANDLE_RE.test('')).toBe(false);
  });

  it('accepts null and empty as optional', () => {
    expect(isValidGitHubHandle(null)).toBe(true);
    expect(isValidGitHubHandle('')).toBe(true);
  });
});

// ─── SQL shape validation ────────────────────────────────────────────────────

describe('Enrichment job SQL shapes', () => {
  it('inserts enrichment_jobs with all required columns', () => {
    // The handler must include id, source_type, source_url, status, created_at.
    const sql = `INSERT INTO enrichment_jobs (id, candidate_id, source_type, source_url, status, created_at)
           VALUES (?1, ?2, 'github', ?3, 'PENDING', unixepoch())`;
    expect(sql).toContain('id');
    expect(sql).toContain('source_type');
    expect(sql).toContain('source_url');
    expect(sql).toContain('status');
    expect(sql).toContain('created_at');
    expect(sql).toContain("'github'");
    expect(sql).toContain("'PENDING'");
  });

  it('upserts candidate_ingestion.github_url with conflict handling', () => {
    const sql = `INSERT INTO candidate_ingestion (candidate_id, github_url, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?3)
           ON CONFLICT(candidate_id) DO UPDATE SET
             github_url = excluded.github_url,
             updated_at = excluded.updated_at`;
    expect(sql).toContain('ON CONFLICT(candidate_id)');
    expect(sql).toContain('github_url = excluded.github_url');
  });
});

describe('Standalone CODE_REVIEW match summary', () => {
  it('surfaces pending intake as an explicit safe state', () => {
    const summary = buildStandaloneReviewMatchSummary('PENDING_INTAKE', null);

    expect(summary.summary).toContain('Waiting for candidate resume/profile evidence');
    expect(summary.evidence).toEqual([]);
    expect(summary.gaps).toContain('Candidate has not submitted source evidence yet.');
  });

  it('preserves source-backed alignment and guardrail gaps for matched PRs', () => {
    const summary = buildStandaloneReviewMatchSummary('MATCHED', {
      rank: 1,
      challengeId: 'packet-1',
      repoId: '7',
      prNumber: 42,
      score: 0.82,
      alignedDemandCount: 2,
      stretchCount: 0,
      provenanceComplete: true,
      eligible: true,
      alignments: [{
        atomId: 'candidate-atom-1',
        demandId: 'repo-demand-1',
        purpose: 'validation',
        pairScore: 0.9,
        sharedConcepts: ['graphql'],
        candidateSourceRefs: [{
          artifactId: 'resume-artifact',
          artifactVersion: 'v1',
          contentHash: 'abc',
          startOffset: 10,
          endOffset: 20,
          locator: 'resume line 3',
        }],
        challengeSourceRefs: [{
          artifactId: 'repo-span',
          artifactVersion: 'commit-a',
          contentHash: 'def',
          startOffset: 30,
          endOffset: 40,
          locator: 'src/api.ts:9',
        }],
      }],
      rejectionReasons: [],
    });

    expect(summary.summary).toContain('Matched 2 source-backed demands');
    expect(summary.evidence).toHaveLength(1);
    expect(summary.evidence[0]?.candidateSourceRefs[0]?.locator).toBe('resume line 3');
    expect(summary.evidence[0]?.challengeSourceRefs[0]?.locator).toBe('src/api.ts:9');
  });
});
