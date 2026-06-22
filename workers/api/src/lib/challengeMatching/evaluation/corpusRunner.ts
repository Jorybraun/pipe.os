/**
 * Offline corpus evaluation runner.
 *
 * Bridges the seed corpus to the matching engine: converts corpus evidence
 * to CandidateSignals, runs the full compile→recall→align→rank pipeline
 * for each candidate-role pair, then evaluates results against expert labels.
 *
 * Runs entirely in-memory without a live D1 database.
 *
 * Acceptance criterion #8: expert-labelled evaluation with deterministic matching.
 */

import {
  alignCandidateToChallenge,
  compileCandidateMatchQuery,
  recallReviewChallenges,
  rankReviewChallenges,
  explainChallengeMatch,
} from '../engine';
import type {
  CandidateSignal,
  ChallengeAlignment,
  ChallengePacket,
  ConceptAdjacency,
  DemandAlignment,
  MatchExplanation,
  PairScore,
  RoleGuardrailSnapshot,
} from '../types';
import { evaluateMatchRuns, checkAcceptanceThresholds } from './metrics';
import { validateCorpus } from './corpus';
import type {
  AcceptanceThresholds,
  CandidatePersonEvidence,
  EvaluationCorpus,
  EvaluationResult,
  PersistedMatchAlignment,
  PersistedMatchRun,
  PersistedRankedChallenge,
  RoleRequirements,
} from './types';
import { DEFAULT_ACCEPTANCE_THRESHOLDS } from './types';

export interface CorpusRunnerInput {
  corpus: EvaluationCorpus;
  challengePackets: ChallengePacket[];
  adjacency?: ConceptAdjacency[];
  thresholds?: Partial<AcceptanceThresholds>;
}

export interface CorpusRunnerOutput {
  result: EvaluationResult;
  matchRuns: PersistedMatchRun[];
  explanations: Map<string, MatchExplanation>;
}

function evidenceToSignal(evidence: CandidatePersonEvidence): CandidateSignal {
  return {
    id: evidence.evidenceId,
    episodeId: evidence.episodeId,
    narrative: evidence.narrative,
    purpose: 'validation',
    evidenceLevel: 'demonstrated',
    evidenceStrength: 0.8,
    confidence: 0.9,
    concepts: evidence.concepts,
    problems: evidence.problems,
    mechanisms: evidence.mechanisms,
    domains: evidence.domains,
    businessObjects: evidence.businessObjects,
    ownershipActions: evidence.ownershipActions,
    sourceRefs: evidence.evidenceReferences.map((ref) => ({
      artifactId: ref.artifactId,
      artifactVersion: ref.artifactVersion,
      contentHash: ref.contentHash,
      startOffset: ref.startOffset,
      endOffset: ref.endOffset,
      locator: ref.locator,
      exactText: ref.exactText,
    })),
  };
}

function roleToGuardrails(role: RoleRequirements): RoleGuardrailSnapshot {
  return {
    requiredLanguages: role.requiredLanguages,
    forbiddenLanguages: role.forbiddenLanguages ?? [],
    relevantConcepts: role.relevantConcepts ?? [],
    genericConcepts: role.genericConcepts ?? [],
    requiredConcepts: role.requiredConcepts ?? [],
    forbiddenConcepts: role.forbiddenConcepts ?? [],
    minimumSeniority: role.minimumSeniority,
    sourceReferences: role.sourceReferences,
  };
}

function pairKey(candidateId: string, roleId: string): string {
  return JSON.stringify([candidateId, roleId]);
}

function toPersistedAlignment(
  da: DemandAlignment,
  candidateSourceRefs: PersistedMatchAlignment['candidateSourceRefs'],
  challengeSourceRefs: PersistedMatchAlignment['challengeSourceRefs'],
  sharedConcepts: string[],
): PersistedMatchAlignment {
  return {
    atomId: da.atom.id,
    demandId: da.demand.id,
    pairScore: da.pairScore.total,
    pairScoreBreakdown: da.pairScore,
    weightedScore: da.weightedScore,
    stretch: da.stretch
      ? {
          atomConcept: da.stretch.atomConcept,
          demandConcept: da.stretch.demandConcept,
          dimension: da.stretch.dimension,
        }
      : null,
    sharedConcepts,
    candidateSourceRefs,
    challengeSourceRefs,
  };
}

export function runCorpusEvaluation(input: CorpusRunnerInput): CorpusRunnerOutput {
  validateCorpus(input.corpus);

  const { corpus, challengePackets, adjacency } = input;
  const thresholds: AcceptanceThresholds = {
    ...DEFAULT_ACCEPTANCE_THRESHOLDS,
    ...input.thresholds,
  };

  const evidenceByCandidateId = new Map<string, CandidatePersonEvidence[]>();
  for (const evidence of corpus.candidateEvidence) {
    const existing = evidenceByCandidateId.get(evidence.candidateId) ?? [];
    existing.push(evidence);
    evidenceByCandidateId.set(evidence.candidateId, existing);
  }

  const roleById = new Map(corpus.roleRequirements.map((r) => [r.roleId, r]));

  const pairs = new Map<string, { candidateId: string; roleId: string }>();
  for (const label of corpus.expertLabels) {
    pairs.set(pairKey(label.candidateId, label.roleId), {
      candidateId: label.candidateId,
      roleId: label.roleId,
    });
  }

  const matchRuns: PersistedMatchRun[] = [];
  const explanations = new Map<string, MatchExplanation>();

  for (const pair of pairs.values()) {
    const evidence = evidenceByCandidateId.get(pair.candidateId) ?? [];
    const role = roleById.get(pair.roleId);
    if (!role) continue;

    const signals = evidence.map(evidenceToSignal);
    const guardrails = roleToGuardrails(role);
    const candidateSnapshotId = `snapshot-${pair.candidateId}`;
    const roleSnapshotId = `snapshot-${pair.roleId}`;

    const compiled = compileCandidateMatchQuery({
      candidateSnapshotId,
      roleSnapshotId,
      signals,
      roleGuardrails: guardrails,
      selectionConcepts: role.relevantConcepts,
    });

    if (compiled.status === 'NEEDS_MORE_EVIDENCE') {
      matchRuns.push({
        matchRunId: `run-${pair.candidateId}-${pair.roleId}`,
        candidateId: pair.candidateId,
        roleId: pair.roleId,
        candidateSnapshotId,
        policyVersion: compiled.query.policyVersion,
        modelVersion: null,
        status: 'NEEDS_MORE_EVIDENCE',
        rankedChallenges: [],
      });
      continue;
    }

    const recalled = recallReviewChallenges({
      query: compiled.query,
      challenges: challengePackets,
      adjacency,
    });

    if (recalled.status !== 'READY') {
      matchRuns.push({
        matchRunId: `run-${pair.candidateId}-${pair.roleId}`,
        candidateId: pair.candidateId,
        roleId: pair.roleId,
        candidateSnapshotId,
        policyVersion: compiled.query.policyVersion,
        modelVersion: null,
        status: recalled.status,
        rankedChallenges: [],
      });
      continue;
    }

    const alignments: ChallengeAlignment[] = recalled.challenges.map((rc) =>
      alignCandidateToChallenge({
        query: compiled.query,
        challenge: rc.challenge,
        adjacency,
      }),
    );

    const ranked = rankReviewChallenges(compiled.query, alignments);

    const rankedChallenges: PersistedRankedChallenge[] = [];
    for (const match of ranked.matches) {
      const a = match.alignment;
      const persistedAlignments: PersistedMatchAlignment[] = a.alignments.map((da) =>
        toPersistedAlignment(
          da,
          da.atom.sourceRefs,
          da.demand.sourceRefs,
          da.atom.concepts.filter((c) =>
            da.demand.concepts.map((d) => d.toLowerCase()).includes(c.toLowerCase()),
          ),
        ),
      );

      rankedChallenges.push({
        rank: a.eligible ? match.rank : null,
        recallRank: match.rank,
        challengeId: a.challenge.id,
        repoId: a.challenge.repoId,
        prNumber: a.challenge.prNumber,
        sourceVersion: a.challenge.sourceVersion,
        score: a.finalScore,
        candidateEvidenceAlignment: a.candidateEvidenceAlignment,
        roleRelevance: a.roleRelevance,
        contextualSpecificity: a.contextualSpecificity,
        challengeQuality: a.challengeQuality,
        validationDeepeningValue: a.validationDeepeningValue,
        alignedDemandCount: a.alignments.length,
        stretchCount: a.stretchCount,
        stretchDemandWeightRatio: a.stretchDemandWeightRatio,
        provenanceComplete: a.provenanceComplete,
        eligible: a.eligible,
        alignments: persistedAlignments,
        rejectionReasons: a.rejectionReasons,
      });

      if (a.eligible && match.rank === 1) {
        const explanation = explainChallengeMatch(a);
        explanations.set(pairKey(pair.candidateId, pair.roleId), explanation);
      }
    }

    matchRuns.push({
      matchRunId: `run-${pair.candidateId}-${pair.roleId}`,
      candidateId: pair.candidateId,
      roleId: pair.roleId,
      candidateSnapshotId,
      policyVersion: compiled.query.policyVersion,
      modelVersion: null,
      status: ranked.status,
      rankedChallenges,
    });
  }

  const metrics = evaluateMatchRuns(corpus, matchRuns, matchRuns);
  const result = checkAcceptanceThresholds(metrics, thresholds);

  return { result, matchRuns, explanations };
}
