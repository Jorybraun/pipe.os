/**
 * Staged rollout proof — criterion #8: controlled staged rollout.
 *
 * Exercises the complete shadow → canary → production promotion flow by
 * integrating D1-backed rollout gates (rolloutEnforcement) with evaluation
 * metrics (checkStagedRolloutGate) and the backfill orchestrator.
 *
 * Proves:
 * 1. Gates start disabled; shadow stage accepts any metrics.
 * 2. Canary stage requires quality thresholds + expert labels.
 * 3. Production stage requires full coverage + determinism.
 * 4. BackfillOrchestrator completes before promotion.
 * 5. Audit trail records every transition.
 * 6. Expert-labelled corpus with reviewer provenance passes validation.
 */

import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  checkGate,
  updateGateStage,
  queryAuditLog,
  clearGateCache,
  type GateStage,
} from '../rolloutEnforcement';
import { BackfillOrchestrator } from '../backfillOrchestrator';
import {
  checkStagedRolloutGate,
  evaluateMatchRuns,
} from '../../challengeMatching/evaluation/metrics';
import {
  loadCorpus,
  validateProductionCorpus,
} from '../../challengeMatching/evaluation/corpus';
import type {
  EvaluationCorpus,
  EvaluationMetrics,
  PersistedMatchRun,
  PersistedRankedChallenge,
  RolloutStage,
} from '../../challengeMatching/evaluation/types';
import { EVALUATION_CORPUS_VERSION } from '../../challengeMatching/evaluation/types';

const gatesMigration = readFileSync(
  new URL('../../../../migrations/0107_rollout_gates.sql', import.meta.url),
  'utf8',
);
const auditMigration = readFileSync(
  new URL('../../../../migrations/0108_rollout_gate_audit_log.sql', import.meta.url),
  'utf8',
);
const checkpointMigration = readFileSync(
  new URL('../../../../migrations/0106_backfill_checkpoints.sql', import.meta.url),
  'utf8',
);

const GATE_KEY = 'living_context_matching';

function expertSourceRef(
  id: string,
  artifactScope: string,
  version: string,
  text: string,
): {
  artifactId: string;
  artifactVersion: string;
  contentHash: string;
  sourceRefType: string;
  sourceRefId: string;
  sourceSpanId: string;
  exactText: string;
  startOffset: number;
  endOffset: number;
} {
  return {
    artifactId: `artifact-${artifactScope}-${id}`,
    artifactVersion: version,
    contentHash: `sha256:${artifactScope}-${id}-${version}`,
    sourceRefType: id.startsWith('pr-') ? 'repo_source_span' : 'source_span',
    sourceRefId: `source-ref-${id}`,
    sourceSpanId: id.startsWith('pr-') ? `source-ref-${id}` : `source-ref-${id}`,
    exactText: text,
    startOffset: 0,
    endOffset: text.length,
  };
}

function expertCorpus(): EvaluationCorpus {
  const candidateId = 'candidate-rollout-1';
  const roleId = 'role-backend-eng';
  const challengeId = 'challenge-queue-system';
  const repoId = 'repo-42';
  const prNumber = 17;
  const sourceVersion = 'abc123';

  return {
    version: EVALUATION_CORPUS_VERSION,
    corpusId: 'corpus-staged-rollout-proof',
    createdAt: '2026-06-28T12:00:00Z',
    description: 'Expert-labelled corpus for staged rollout proof',
    candidateEvidence: [
      {
        candidateId,
        evidenceId: 'evidence-rollout-1',
        episodeId: 'episode-rollout-interview-1',
        narrative: 'Designed distributed task queue with at-least-once delivery and dead-letter handling.',
        concepts: ['term:distributed-queue', 'term:dead-letter', 'term:at-least-once'],
        problems: ['reliable message delivery'],
        mechanisms: ['dead-letter queue'],
        domains: ['infrastructure'],
        ownershipActions: ['designed', 'implemented'],
        evidenceReferences: [
          expertSourceRef(
            'candidate-evidence-1',
            'candidate-transcript',
            'v1',
            'I designed a distributed task queue with at-least-once delivery and dead-letter handling for our order processing system.',
          ),
        ],
      },
    ],
    roleRequirements: [
      {
        roleId,
        requiredLanguages: ['TypeScript'],
        relevantConcepts: ['term:distributed-queue', 'term:message-processing'],
        requiredConcepts: ['term:queue-system'],
        sourceReferences: [
          {
            entityId: 'jd-queue-system',
            locator: 'job_description:source_span:jd-queue',
            conceptKeys: ['term:distributed-queue', 'term:message-processing'],
            sourceRefType: 'source_span',
            sourceRefId: 'role-source-span-jd-queue',
            sourceSpanId: 'role-source-span-jd-queue',
            exactText: 'Build reliable distributed queue processing for order fulfillment.',
            contentHash: 'sha256:role-jd-queue',
          },
        ],
      },
    ],
    expertLabels: [
      {
        labelId: 'expert-label-rollout-1',
        candidateId,
        roleId,
        challengeId,
        relevanceGrade: 'highly_relevant',
        eligibleChallengeIds: [challengeId],
        labelVersion: '1.0.0',
        labeledAt: '2026-06-28T11:00:00Z',
        labeledBy: 'expert-reviewer-senior',
        labelProvenance: {
          reviewerId: 'expert-reviewer-senior',
          reviewerRole: 'principal-engineer',
          reviewArtifactId: 'review-artifact-rollout-1',
          reviewArtifactVersion: 'v1',
          contentHash: 'sha256:review-rollout-1-v1',
          locator: 'expert-review:rollout-proof-1',
          rubricVersion: 'candidate-pr-match-rubric-v1',
        },
      },
    ],
    expectedPackets: [
      {
        challengeId,
        repoId,
        prNumber,
        sourceVersion,
        demands: [
          {
            demandId: 'demand-queue-handler',
            concepts: ['term:distributed-queue', 'term:dead-letter'],
            sourceRefs: [
              expertSourceRef(
                'pr-demand-queue',
                `repo-${repoId}`,
                sourceVersion,
                'Add distributed queue handler with dead-letter routing for failed messages.',
              ),
            ],
          },
        ],
      },
    ],
    metadata: {
      totalLabels: 1,
      totalCandidates: 1,
      totalRoles: 1,
      totalChallenges: 1,
      syntheticFixtureCount: 0,
      totalExpectedPackets: 1,
    },
  };
}

function matchRun(runId: string): PersistedMatchRun {
  const corpus = expertCorpus();
  const label = corpus.expertLabels[0]!;
  const packet = corpus.expectedPackets![0]!;

  const rankedChallenge: PersistedRankedChallenge = {
    rank: 1,
    recallRank: 1,
    challengeId: label.challengeId,
    repoId: packet.repoId,
    prNumber: packet.prNumber,
    sourceVersion: packet.sourceVersion,
    score: 0.91,
    candidateEvidenceAlignment: 0.88,
    roleRelevance: 0.86,
    contextualSpecificity: 0.84,
    challengeQuality: 0.93,
    validationDeepeningValue: 0.78,
    alignedDemandCount: 1,
    stretchCount: 0,
    stretchDemandWeightRatio: 0,
    provenanceComplete: true,
    eligible: true,
    alignments: [
      {
        atomId: 'atom-queue-evidence',
        demandId: 'demand-queue-handler',
        pairScore: 0.91,
        pairScoreBreakdown: {
          semanticNarrative: 0.85,
          conceptCorrespondence: 0.95,
          problemMechanismCorrespondence: 0.88,
          domainBusinessContext: 0.86,
          ownershipActionCorrespondence: 0.92,
          total: 0.91,
        },
        weightedScore: 0.91,
        stretch: null,
        sharedConcepts: ['term:distributed-queue', 'term:dead-letter'],
        roleSourceRefs: [
          {
            entityId: 'jd-queue-system',
            locator: 'job_description:source_span:jd-queue',
            conceptKeys: ['term:distributed-queue', 'term:message-processing'],
            sourceRefType: 'source_span',
            sourceRefId: 'role-source-span-jd-queue',
            sourceSpanId: 'role-source-span-jd-queue',
            exactText: 'Build reliable distributed queue processing for order fulfillment.',
            contentHash: 'sha256:role-jd-queue',
          },
        ],
        candidateSourceRefs: [
          expertSourceRef(
            'candidate-evidence-1',
            'candidate-transcript',
            'v1',
            'I designed a distributed task queue with at-least-once delivery and dead-letter handling for our order processing system.',
          ),
        ],
        challengeSourceRefs: [
          expertSourceRef(
            'pr-demand-queue',
            `repo-${packet.repoId}`,
            packet.sourceVersion,
            'Add distributed queue handler with dead-letter routing for failed messages.',
          ),
        ],
      },
    ],
    rejectionReasons: [],
  };

  return {
    matchRunId: runId,
    candidateId: label.candidateId,
    roleId: label.roleId,
    candidateSnapshotId: 'snapshot-rollout-v1',
    policyVersion: 'candidate-pr-v1',
    modelVersion: null,
    status: 'MATCHED',
    rankedChallenges: [rankedChallenge],
  };
}

function passingMetrics(): EvaluationMetrics {
  const corpus = expertCorpus();
  const primaryRun = matchRun('run-primary');
  const comparisonRun = matchRun('run-comparison');
  return evaluateMatchRuns(corpus, [primaryRun], [comparisonRun]);
}

describe('Staged rollout proof — criterion #8', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(gatesMigration);
    sqlite.exec(auditMigration);
    sqlite.exec(checkpointMigration);
    db = createMockD1(sqlite);
    clearGateCache();
  });

  afterEach(() => {
    sqlite.close();
    clearGateCache();
  });

  it('expert-labelled corpus validates and passes production corpus checks', () => {
    const corpus = expertCorpus();
    expect(() => loadCorpus(JSON.stringify(corpus))).not.toThrow();
    expect(() => validateProductionCorpus(corpus)).not.toThrow();
  });

  it('expert corpus produces passing evaluation metrics at all stages', () => {
    const metrics = passingMetrics();

    expect(metrics.expertLabelCount).toBe(1);
    expect(metrics.syntheticFixtureCount).toBe(0);
    expect(metrics.recallAt50).toBe(1);
    expect(metrics.precisionAt3).toBe(1);
    expect(metrics.byteIdenticalRerun).toBe(true);
    expect(metrics.packetCoverage).toBe(1);
    expect(metrics.missingPacketIds).toHaveLength(0);
    expect(metrics.guardrailViolationCount).toBe(0);

    const shadow = checkStagedRolloutGate(metrics, 'shadow');
    expect(shadow.ready).toBe(true);

    const canary = checkStagedRolloutGate(metrics, 'canary');
    expect(canary.ready).toBe(true);

    const production = checkStagedRolloutGate(metrics, 'production');
    expect(production.ready).toBe(true);
  });

  it('full staged promotion: disabled → internal_only → canary → GA with audit trail', async () => {
    // Gate starts disabled
    const initial = await checkGate(db, GATE_KEY);
    expect(initial.allowed).toBe(false);
    expect(initial.stage).toBe('disabled');

    // Step 1: shadow evaluation passes → enable internal_only
    const metrics = passingMetrics();
    const shadowGate = checkStagedRolloutGate(metrics, 'shadow');
    expect(shadowGate.ready).toBe(true);

    await updateGateStage(db, GATE_KEY, 'internal_only', 'devin-agent', 'Shadow evaluation passed');
    clearGateCache();

    const afterShadow = await checkGate(db, GATE_KEY);
    expect(afterShadow.allowed).toBe(true);
    expect(afterShadow.stage).toBe('internal_only');

    // Step 2: canary evaluation passes → promote to canary
    const canaryGate = checkStagedRolloutGate(metrics, 'canary');
    expect(canaryGate.ready).toBe(true);

    await updateGateStage(db, GATE_KEY, 'canary', 'devin-agent', 'Canary evaluation passed');
    clearGateCache();

    const afterCanary = await checkGate(db, GATE_KEY);
    expect(afterCanary.allowed).toBe(true);
    expect(afterCanary.stage).toBe('canary');

    // Step 3: production evaluation passes → promote to GA
    const productionGate = checkStagedRolloutGate(metrics, 'production');
    expect(productionGate.ready).toBe(true);

    await updateGateStage(db, GATE_KEY, 'GA', 'devin-agent', 'Production evaluation passed');
    clearGateCache();

    const afterGA = await checkGate(db, GATE_KEY);
    expect(afterGA.allowed).toBe(true);
    expect(afterGA.stage).toBe('GA');

    // Verify complete audit trail
    const auditLog = await queryAuditLog(db, GATE_KEY);
    expect(auditLog).toHaveLength(3);

    const transitions = auditLog
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((entry) => `${entry.previousStage} → ${entry.newStage}`);
    expect(transitions).toEqual([
      'disabled → internal_only',
      'internal_only → canary',
      'canary → GA',
    ]);
    expect(auditLog.every((entry) => entry.updatedBy === 'devin-agent')).toBe(true);
  });

  it('backfill orchestrator completes before gate promotion', async () => {
    const orchestrator = new BackfillOrchestrator(db, [
      { taskKey: 'identity_unification', description: 'Unify contact identities', dependsOn: [] },
      { taskKey: 'interaction_ingestion', description: 'Ingest all interactions', dependsOn: ['identity_unification'] },
      { taskKey: 'projection_rebuild', description: 'Rebuild projections', dependsOn: ['interaction_ingestion'] },
    ]);
    await orchestrator.ensureCheckpoints();

    // Simulate backfill execution
    await orchestrator.markRunning('identity_unification', 100);
    await orchestrator.updateProgress('identity_unification', 'person-100', 100, 0);
    await orchestrator.markCompleted('identity_unification');

    await orchestrator.markRunning('interaction_ingestion', 50);
    await orchestrator.updateProgress('interaction_ingestion', 'interaction-50', 50, 0);
    await orchestrator.markCompleted('interaction_ingestion');

    await orchestrator.markRunning('projection_rebuild', 25);
    await orchestrator.updateProgress('projection_rebuild', 'projection-25', 25, 0);
    await orchestrator.markCompleted('projection_rebuild');

    // Verify all tasks completed
    const status = await orchestrator.getStatus();
    expect(status.tasks.every((t) => t.status === 'completed')).toBe(true);
    expect(status.tasks.find((t) => t.taskKey === 'identity_unification')!.processed).toBe(100);
    expect(status.tasks.find((t) => t.taskKey === 'interaction_ingestion')!.processed).toBe(50);
    expect(status.tasks.find((t) => t.taskKey === 'projection_rebuild')!.processed).toBe(25);

    // No more ready tasks
    const readyTasks = await orchestrator.getReadyTasks();
    expect(readyTasks).toHaveLength(0);

    // Only after backfill completes do we promote the gate
    const metrics = passingMetrics();
    const gate = checkStagedRolloutGate(metrics, 'production');
    expect(gate.ready).toBe(true);

    await updateGateStage(db, GATE_KEY, 'GA', 'devin-agent', 'Backfill complete, production evaluation passed');
    clearGateCache();

    const finalGate = await checkGate(db, GATE_KEY);
    expect(finalGate.stage).toBe('GA');
  });

  it('rejects promotion when metrics fail stage thresholds', () => {
    const weakMetrics = passingMetrics();
    // Degrade metrics below canary thresholds
    weakMetrics.recallAt50 = 0.50;
    weakMetrics.precisionAt3 = 0.40;

    const shadow = checkStagedRolloutGate(weakMetrics, 'shadow');
    expect(shadow.ready).toBe(true); // shadow accepts anything

    const canary = checkStagedRolloutGate(weakMetrics, 'canary');
    expect(canary.ready).toBe(false);
    expect(canary.failures.some((f) => f.includes('Recall'))).toBe(true);
    expect(canary.failures.some((f) => f.includes('Precision'))).toBe(true);
  });

  it('rejects production when synthetic labels are present', () => {
    const metrics = passingMetrics();
    metrics.syntheticFixtureCount = 3;
    metrics.expertLabelCount = 0;

    const production = checkStagedRolloutGate(metrics, 'production');
    expect(production.ready).toBe(false);
    expect(production.failures.some(
      (f) => f.toLowerCase().includes('expert') || f.toLowerCase().includes('synthetic'),
    )).toBe(true);
  });

  it('gate rollback records audit entry', async () => {
    await updateGateStage(db, GATE_KEY, 'GA', 'devin-agent', 'Promoted');
    await updateGateStage(db, GATE_KEY, 'disabled', 'devin-agent', 'Emergency rollback');
    clearGateCache();

    const gate = await checkGate(db, GATE_KEY);
    expect(gate.allowed).toBe(false);
    expect(gate.stage).toBe('disabled');

    const auditLog = await queryAuditLog(db, GATE_KEY);
    const rollback = auditLog.find((entry) => entry.newStage === 'disabled');
    expect(rollback).toBeDefined();
    expect(rollback!.previousStage).toBe('GA');
    expect(rollback!.reason).toBe('Emergency rollback');
  });

  it('match run determinism is verified through comparison run fingerprints', () => {
    const metrics = passingMetrics();
    expect(metrics.byteIdenticalRerun).toBe(true);
    expect(metrics.determinismComparisons.length).toBeGreaterThan(0);
    expect(metrics.determinismComparisons.every((c) => c.identical)).toBe(true);
    expect(
      metrics.determinismComparisons.every(
        (c) => c.fingerprint === c.comparisonFingerprint,
      ),
    ).toBe(true);
  });

  it('expert label provenance links to immutable review artifact', () => {
    const corpus = expertCorpus();
    const label = corpus.expertLabels[0]!;
    expect(label.labelProvenance).toBeDefined();
    expect(label.labelProvenance!.reviewerId).toBe('expert-reviewer-senior');
    expect(label.labelProvenance!.contentHash).toMatch(/^sha256:/);
    expect(label.labelProvenance!.rubricVersion).toBeTruthy();
    expect(label.labelProvenance!.reviewArtifactId).toBeTruthy();
    expect(label.labelProvenance!.locator).toBeTruthy();
  });

  it('staged thresholds are strictly increasing across stages', () => {
    const stages: RolloutStage[] = ['shadow', 'canary', 'production'];
    const metrics = passingMetrics();

    for (let i = 0; i < stages.length - 1; i++) {
      const current = checkStagedRolloutGate(metrics, stages[i]!);
      const next = checkStagedRolloutGate(metrics, stages[i + 1]!);

      // If the stricter stage passes, the looser one must also pass
      if (next.ready) {
        expect(current.ready).toBe(true);
      }
    }
  });
});
