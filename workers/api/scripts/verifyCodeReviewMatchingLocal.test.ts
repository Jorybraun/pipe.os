import { describe, expect, it } from 'vitest';
import type { AuditResult } from './auditReviewChallengePacketContexts';
import {
  buildLocalMatchingProof,
  summarizeDatabaseAudit,
} from './verifyCodeReviewMatchingLocal';

function audit(overrides: Partial<AuditResult>): AuditResult {
  return {
    status: 'no_packets',
    stats: {
      totalPackets: 0,
      productionReadyPackets: 0,
      fixturePackets: 0,
      realPackets: 0,
      withContextRecords: 0,
      withRepoSourceRefs: 0,
      withConceptLinks: 0,
      withReviewProfiles: 0,
      overlayReadyPackets: 0,
      realOverlayReadyPackets: 0,
      realOverlayReadyWithReviewProfiles: 0,
    },
    sourceStats: {
      qualifiedRepos: 0,
      samplePullRequests: 0,
      eligibleSamplePullRequests: 0,
    },
    rows: [],
    missingTables: [],
    missingContextRecordPacketIds: [],
    missingRepoSourceRefPacketIds: [],
    missingConceptLinkPacketIds: [],
    ...overrides,
  };
}

describe('verifyCodeReviewMatchingLocal', () => {
  it('fails closed when only fixture packets are overlay-ready', () => {
    const summary = summarizeDatabaseAudit('/tmp/fixture.sqlite', audit({
      status: 'fixture_only',
      stats: {
        totalPackets: 2,
        productionReadyPackets: 2,
        fixturePackets: 2,
        realPackets: 0,
        withContextRecords: 2,
        withRepoSourceRefs: 2,
        withConceptLinks: 2,
        withReviewProfiles: 2,
        overlayReadyPackets: 2,
        realOverlayReadyPackets: 0,
        realOverlayReadyWithReviewProfiles: 0,
      },
      sourceStats: {
        qualifiedRepos: 2,
        samplePullRequests: 2,
        eligibleSamplePullRequests: 0,
      },
      rows: [{
        packetId: 'packet-fixture',
        repoId: 1,
        repoFullName: 'pipe/e2e-source-backed',
        prNumber: 42,
        productionReady: true,
        isFixture: true,
        contextRecordId: 'context-fixture',
        repoSourceRefCount: 4,
        conceptLinkCount: 12,
        hasReviewProfile: true,
        reviewDifficultyBand: 'focused',
        reviewExpectedSeniority: 'senior',
        reviewExpectedTimeMinutes: 45,
        reviewProfileReady: true,
        overlayReady: true,
      }],
    }));

    const proof = buildLocalMatchingProof([summary]);

    expect(proof.ready).toBe(false);
    expect(proof.status).toBe('not_ready');
    expect(proof.failures).toContain('local overlay-ready packets are fixture-only and do not prove production repo matching');
    expect(proof.databases[0]!.readyPackets).toEqual([
      expect.objectContaining({
        repoFullName: 'pipe/e2e-source-backed',
        isFixture: true,
      }),
    ]);
  });

  it('requires at least two real source-backed packets before claiming contrast-ready matching', () => {
    const summary = summarizeDatabaseAudit('/tmp/real.sqlite', audit({
      status: 'ready',
      stats: {
        totalPackets: 1,
        productionReadyPackets: 1,
        fixturePackets: 0,
        realPackets: 1,
        withContextRecords: 1,
        withRepoSourceRefs: 1,
        withConceptLinks: 1,
        withReviewProfiles: 1,
        overlayReadyPackets: 1,
        realOverlayReadyPackets: 1,
        realOverlayReadyWithReviewProfiles: 1,
      },
      sourceStats: {
        qualifiedRepos: 1,
        samplePullRequests: 1,
        eligibleSamplePullRequests: 1,
      },
      rows: [{
        packetId: 'packet-real',
        repoId: 9,
        repoFullName: 'cloudflare/workers-sdk',
        prNumber: 14435,
        productionReady: true,
        isFixture: false,
        contextRecordId: 'context-real',
        repoSourceRefCount: 5,
        conceptLinkCount: 48,
        hasReviewProfile: true,
        reviewDifficultyBand: 'advanced',
        reviewExpectedSeniority: 'staff',
        reviewExpectedTimeMinutes: 75,
        reviewProfileReady: true,
        overlayReady: true,
      }],
    }));

    const proof = buildLocalMatchingProof([summary]);

    expect(proof.ready).toBe(false);
    expect(proof.status).toBe('not_ready');
    expect(proof.failures).toContain('fewer than two real overlay-ready CODE_REVIEW packets are available for contrast separation');
    expect(proof.databases[0]!.readyPackets[0]).toEqual(expect.objectContaining({
      repoFullName: 'cloudflare/workers-sdk',
      isFixture: false,
    }));
  });

  it('passes when multiple real source-backed packets are overlay-ready for contrast separation', () => {
    const summary = summarizeDatabaseAudit('/tmp/real.sqlite', audit({
      status: 'ready',
      stats: {
        totalPackets: 2,
        productionReadyPackets: 2,
        fixturePackets: 0,
        realPackets: 2,
        withContextRecords: 2,
        withRepoSourceRefs: 2,
        withConceptLinks: 2,
        withReviewProfiles: 2,
        overlayReadyPackets: 2,
        realOverlayReadyPackets: 2,
        realOverlayReadyWithReviewProfiles: 2,
      },
      sourceStats: {
        qualifiedRepos: 2,
        samplePullRequests: 2,
        eligibleSamplePullRequests: 2,
      },
      rows: [
        {
          packetId: 'packet-real-a',
          repoId: 9,
          repoFullName: 'cloudflare/workers-sdk',
          prNumber: 14435,
          productionReady: true,
          isFixture: false,
          contextRecordId: 'context-real-a',
          repoSourceRefCount: 5,
          conceptLinkCount: 48,
          hasReviewProfile: true,
          reviewDifficultyBand: 'advanced',
          reviewExpectedSeniority: 'staff',
          reviewExpectedTimeMinutes: 75,
          reviewProfileReady: true,
          overlayReady: true,
        },
        {
          packetId: 'packet-real-b',
          repoId: 10,
          repoFullName: 'mui/base-ui',
          prNumber: 973,
          productionReady: true,
          isFixture: false,
          contextRecordId: 'context-real-b',
          repoSourceRefCount: 8,
          conceptLinkCount: 56,
          hasReviewProfile: true,
          reviewDifficultyBand: 'focused',
          reviewExpectedSeniority: 'senior',
          reviewExpectedTimeMinutes: 45,
          reviewProfileReady: true,
          overlayReady: true,
        },
      ],
    }));

    const proof = buildLocalMatchingProof([summary]);

    expect(proof.ready).toBe(true);
    expect(proof.status).toBe('ready');
    expect(proof.selectedDatabasePath).toBe('/tmp/real.sqlite');
    expect(proof.failures).toEqual([]);
  });

  it('requires calibrated review profiles before claiming local matching readiness', () => {
    const summary = summarizeDatabaseAudit('/tmp/uncalibrated.sqlite', audit({
      status: 'ready',
      stats: {
        totalPackets: 2,
        productionReadyPackets: 2,
        fixturePackets: 0,
        realPackets: 2,
        withContextRecords: 2,
        withRepoSourceRefs: 2,
        withConceptLinks: 2,
        withReviewProfiles: 0,
        overlayReadyPackets: 2,
        realOverlayReadyPackets: 2,
        realOverlayReadyWithReviewProfiles: 0,
      },
      sourceStats: {
        qualifiedRepos: 2,
        samplePullRequests: 2,
        eligibleSamplePullRequests: 2,
      },
      rows: [
        {
          packetId: 'packet-real-a',
          repoId: 9,
          repoFullName: 'cloudflare/workers-sdk',
          prNumber: 14435,
          productionReady: true,
          isFixture: false,
          contextRecordId: 'context-real-a',
          repoSourceRefCount: 5,
          conceptLinkCount: 48,
          hasReviewProfile: false,
          reviewDifficultyBand: null,
          reviewExpectedSeniority: null,
          reviewExpectedTimeMinutes: null,
          reviewProfileReady: false,
          overlayReady: true,
        },
        {
          packetId: 'packet-real-b',
          repoId: 10,
          repoFullName: 'mui/base-ui',
          prNumber: 973,
          productionReady: true,
          isFixture: false,
          contextRecordId: 'context-real-b',
          repoSourceRefCount: 8,
          conceptLinkCount: 56,
          hasReviewProfile: false,
          reviewDifficultyBand: null,
          reviewExpectedSeniority: null,
          reviewExpectedTimeMinutes: null,
          reviewProfileReady: false,
          overlayReady: true,
        },
      ],
    }));

    const proof = buildLocalMatchingProof([summary]);

    expect(proof.ready).toBe(false);
    expect(proof.status).toBe('not_ready');
    expect(proof.databases[0]).toMatchObject({
      contrastReady: true,
      calibratedContrastReady: false,
    });
    expect(proof.failures).toContain('fewer than two real overlay-ready CODE_REVIEW packets include assessment-fit review profiles');
  });
});
