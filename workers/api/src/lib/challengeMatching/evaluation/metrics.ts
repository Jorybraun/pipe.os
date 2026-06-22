import type {
  AcceptanceThresholds,
  DeterminismComparison,
  EvaluationCorpus,
  EvaluationMetrics,
  EvaluationResult,
  ExpertLabel,
  GuardrailViolation,
  LabelEvaluationResult,
  PersistedMatchAlignment,
  PersistedMatchRun,
  PersistedRankedChallenge,
  RelevanceGrade,
  StretchPath,
} from './types';

function pairKey(candidateId: string, roleId: string): string {
  return JSON.stringify([candidateId, roleId]);
}

function relevanceScore(grade: RelevanceGrade): number {
  switch (grade) {
    case 'highly_relevant':
      return 3;
    case 'relevant':
      return 2;
    case 'borderline':
      return 1;
    case 'irrelevant':
    case 'forbidden':
      return 0;
  }
}

function dcg(scores: number[]): number {
  return scores.reduce(
    (sum, score, index) => sum + (2 ** score - 1) / Math.log2(index + 2),
    0,
  );
}

function sourceRefsComplete(alignment: PersistedMatchAlignment): boolean {
  const nonEmptyString = (value: string | undefined) =>
    typeof value === 'string' && value.trim().length > 0;
  const complete = (references: PersistedMatchAlignment['candidateSourceRefs']) =>
    Array.isArray(references)
    && references.length > 0
    && references.every((reference) =>
      Boolean(reference.artifactId)
      && Boolean(reference.artifactVersion)
      && Boolean(reference.contentHash)
      && nonEmptyString(reference.sourceRefType)
      && nonEmptyString(reference.sourceRefId)
      && nonEmptyString(reference.exactText)
      && Number.isInteger(reference.startOffset)
      && Number.isInteger(reference.endOffset)
      && reference.startOffset >= 0
      && reference.endOffset > reference.startOffset
    );
  return complete(alignment.candidateSourceRefs)
    && complete(alignment.challengeSourceRefs);
}

function resultProvenanceComplete(result: PersistedRankedChallenge): boolean {
  return result.provenanceComplete === true
    && Boolean(result.challengeId)
    && Boolean(result.repoId)
    && result.prNumber > 0
    && Boolean(result.sourceVersion)
    && result.alignments.length > 0
    && result.alignments.every(sourceRefsComplete);
}

function stretchPaths(result: PersistedRankedChallenge | undefined): StretchPath[] {
  if (!result) return [];
  return result.alignments.flatMap((alignment) =>
    alignment.stretch ? [alignment.stretch] : []
  );
}

function labelEvaluation(
  label: ExpertLabel,
  result: PersistedRankedChallenge | undefined,
): LabelEvaluationResult {
  const actualRank = result?.eligible ? result.rank : null;
  const actualRecallRank = result?.recallRank ?? null;
  const provenanceComplete = result ? resultProvenanceComplete(result) : true;
  const violations: GuardrailViolation[] = [];
  if (label.relevanceGrade === 'forbidden' && actualRank !== null) {
    violations.push(...(
      label.guardrailViolations?.length
        ? label.guardrailViolations
        : ['expert_forbidden_result' as const]
    ));
  }
  if (result && result.eligible && result.stretchCount > 1) {
    violations.push('multi_stretch_exceeded');
  }
  if (result && result.eligible && !provenanceComplete) {
    violations.push('missing_provenance');
  }

  let failureReason: string | undefined;
  if (label.relevanceGrade === 'forbidden' && actualRank !== null) {
    failureReason = `expert-forbidden challenge was eligible at rank ${actualRank}`;
  } else if (label.relevanceGrade === 'highly_relevant' && (actualRank === null || actualRank > 3)) {
    failureReason = `highly relevant challenge was not in the eligible top 3`;
  } else if (label.relevanceGrade === 'relevant' && (actualRecallRank === null || actualRecallRank > 50)) {
    failureReason = `relevant challenge was not recalled in the top 50`;
  } else if (label.relevanceGrade === 'irrelevant' && actualRank !== null && actualRank <= 3) {
    failureReason = `irrelevant challenge appeared in the eligible top 3`;
  } else if (violations.includes('multi_stretch_exceeded')) {
    failureReason = 'eligible challenge used more than one adjacent stretch';
  } else if (violations.includes('missing_provenance')) {
    failureReason = 'eligible challenge is missing exact source provenance';
  }

  return {
    labelId: label.labelId,
    candidateId: label.candidateId,
    roleId: label.roleId,
    challengeId: label.challengeId,
    expectedGrade: label.relevanceGrade,
    actualRank,
    actualRecallRank,
    actualScore: result?.score ?? null,
    guardrailViolations: Array.from(new Set(violations)),
    stretchPathsUsed: stretchPaths(result),
    provenanceComplete,
    passed: failureReason === undefined,
    ...(failureReason ? { failureReason } : {}),
  };
}

function matchRunMap(runs: PersistedMatchRun[]): Map<string, PersistedMatchRun> {
  const mapped = new Map<string, PersistedMatchRun>();
  for (const run of runs) {
    const key = pairKey(run.candidateId, run.roleId);
    const existing = mapped.get(key);
    if (existing) {
      throw new Error(
        `Multiple match runs supplied for candidate-role pair: ${existing.matchRunId}, ${run.matchRunId}`,
      );
    }
    mapped.set(key, run);
  }
  return mapped;
}

export function computeMatchRunFingerprint(run: PersistedMatchRun): string {
  const ranked = [...run.rankedChallenges]
    .sort((left, right) =>
      left.recallRank - right.recallRank
      || left.challengeId.localeCompare(right.challengeId)
    )
    .map((result) => ({
      rank: result.rank,
      recallRank: result.recallRank,
      challengeId: result.challengeId,
      repoId: result.repoId,
      prNumber: result.prNumber,
      sourceVersion: result.sourceVersion,
      score: result.score,
      candidateEvidenceAlignment: result.candidateEvidenceAlignment,
      roleRelevance: result.roleRelevance,
      contextualSpecificity: result.contextualSpecificity,
      challengeQuality: result.challengeQuality,
      validationDeepeningValue: result.validationDeepeningValue,
      alignedDemandCount: result.alignedDemandCount,
      stretchCount: result.stretchCount,
      stretchDemandWeightRatio: result.stretchDemandWeightRatio,
      provenanceComplete: result.provenanceComplete,
      eligible: result.eligible,
      alignments: result.alignments.map((alignment) => ({
        atomId: alignment.atomId,
        demandId: alignment.demandId,
        pairScore: alignment.pairScore,
        pairScoreBreakdown: alignment.pairScoreBreakdown ?? null,
        weightedScore: alignment.weightedScore ?? null,
        stretch: alignment.stretch ?? null,
        sharedConcepts: alignment.sharedConcepts,
        candidateSourceRefs: alignment.candidateSourceRefs,
        challengeSourceRefs: alignment.challengeSourceRefs,
      })),
      rejectionReasons: result.rejectionReasons,
    }));
  return JSON.stringify({
    candidateId: run.candidateId,
    roleId: run.roleId,
    candidateSnapshotId: run.candidateSnapshotId,
    policyVersion: run.policyVersion,
    modelVersion: run.modelVersion,
    status: run.status,
    ranked,
  });
}

export function verifyByteIdenticalRerun(
  firstRun: PersistedMatchRun,
  secondRun: PersistedMatchRun,
): { identical: boolean; fingerprint: string; comparisonFingerprint: string } {
  const firstFingerprint = computeMatchRunFingerprint(firstRun);
  const comparisonFingerprint = computeMatchRunFingerprint(secondRun);
  return {
    identical: firstFingerprint === comparisonFingerprint,
    fingerprint: firstFingerprint,
    comparisonFingerprint,
  };
}

export function evaluateMatchRuns(
  corpus: EvaluationCorpus,
  matchRuns: PersistedMatchRun[],
  comparisonRuns: PersistedMatchRun[] = [],
): EvaluationMetrics {
  const runs = matchRunMap(matchRuns);
  const comparisons = matchRunMap(comparisonRuns);
  const labelsByPair = new Map<string, ExpertLabel[]>();
  for (const label of corpus.expertLabels) {
    const key = pairKey(label.candidateId, label.roleId);
    labelsByPair.set(key, [...(labelsByPair.get(key) ?? []), label]);
  }

  const labelResults: LabelEvaluationResult[] = [];
  let relevantRecallNumerator = 0;
  let relevantRecallDenominator = 0;
  let precisionNumerator = 0;
  let precisionDenominator = 0;
  let ndcgTotal = 0;
  let evaluatedPairCount = 0;
  let missingMatchRunCount = 0;
  let highlyRelevantInTop3 = 0;
  let relevantInTop3 = 0;
  let irrelevantInTop3 = 0;
  let forbiddenInResults = 0;
  const countedResults = new Set<string>();
  let multiStretchViolationCount = 0;
  let missingProvenanceCount = 0;
  let guardrailViolationCount = 0;

  for (const [key, labels] of Array.from(labelsByPair.entries())) {
    const run = runs.get(key);
    if (!run) {
      missingMatchRunCount++;
      labelResults.push(...labels.map((label) => labelEvaluation(label, undefined)));
      continue;
    }
    evaluatedPairCount++;
    const resultById = new Map(
      run.rankedChallenges.map((result) => [result.challengeId, result]),
    );
    const eligible = run.rankedChallenges
      .filter((result) => result.eligible && result.rank !== null)
      .sort((left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity));
    const labelByChallenge = new Map(labels.map((label) => [label.challengeId, label]));

    const relevantLabels = labels.filter((label) =>
      label.relevanceGrade === 'highly_relevant'
      || label.relevanceGrade === 'relevant'
    );
    relevantRecallDenominator += relevantLabels.length;
    relevantRecallNumerator += relevantLabels.filter((label) => {
      const result = resultById.get(label.challengeId);
      return result !== undefined && result.recallRank <= 50;
    }).length;

    const top3 = eligible.slice(0, 3);
    precisionDenominator += top3.length;
    precisionNumerator += top3.filter((result) => {
      const label = labelByChallenge.get(result.challengeId);
      const grade = label?.relevanceGrade;
      return grade === 'highly_relevant' || grade === 'relevant';
    }).length;

    const actualGrades = eligible.slice(0, 5).map((result) => {
      const label = labelByChallenge.get(result.challengeId);
      return relevanceScore(label?.relevanceGrade ?? 'irrelevant');
    });
    const idealGrades = labels
      .map((label) => relevanceScore(label.relevanceGrade))
      .sort((left, right) => right - left)
      .slice(0, 5);
    const idealDcg = dcg(idealGrades);
    ndcgTotal += idealDcg === 0 ? 1 : dcg(actualGrades) / idealDcg;

    for (const result of run.rankedChallenges) {
      const resultKey = `${run.matchRunId}\u0000${result.challengeId}`;
      if (countedResults.has(resultKey) || !result.eligible) continue;
      countedResults.add(resultKey);
      if (result.stretchCount > 1 || result.stretchDemandWeightRatio > 0.20 + 1e-12) {
        multiStretchViolationCount++;
      }
      if (!resultProvenanceComplete(result)) missingProvenanceCount++;
    }

    for (const label of labels) {
      const evaluation = labelEvaluation(label, resultById.get(label.challengeId));
      labelResults.push(evaluation);
      guardrailViolationCount += evaluation.guardrailViolations.filter(
        (violation) =>
          violation !== 'multi_stretch_exceeded'
          && violation !== 'missing_provenance',
      ).length;
      if (evaluation.actualRank !== null && evaluation.actualRank <= 3) {
        if (label.relevanceGrade === 'highly_relevant') highlyRelevantInTop3++;
        if (label.relevanceGrade === 'relevant') relevantInTop3++;
        if (label.relevanceGrade === 'irrelevant') irrelevantInTop3++;
        if (label.relevanceGrade === 'forbidden') forbiddenInResults++;
      }
    }
  }

  const rerunFingerprints: Record<string, string> = {};
  const determinismComparisons: DeterminismComparison[] = [];
  let byteIdenticalRerun = runs.size > 0 && runs.size === comparisons.size;
  for (const [key, run] of Array.from(runs.entries())) {
    const pair = JSON.parse(key) as [string, string];
    const comparison = comparisons.get(key);
    if (!comparison) {
      byteIdenticalRerun = false;
      const fingerprint = computeMatchRunFingerprint(run);
      rerunFingerprints[key] = fingerprint;
      determinismComparisons.push({
        candidateId: pair[0],
        roleId: pair[1],
        matchRunId: run.matchRunId,
        comparisonMatchRunId: null,
        identical: false,
        fingerprint,
        comparisonFingerprint: null,
      });
      continue;
    }
    const verification = verifyByteIdenticalRerun(run, comparison);
    rerunFingerprints[key] = verification.fingerprint;
    determinismComparisons.push({
      candidateId: pair[0],
      roleId: pair[1],
      matchRunId: run.matchRunId,
      comparisonMatchRunId: comparison.matchRunId,
      identical: verification.identical,
      fingerprint: verification.fingerprint,
      comparisonFingerprint: verification.comparisonFingerprint,
    });
    if (!verification.identical) byteIdenticalRerun = false;
  }

  const syntheticFixtureCount = corpus.expertLabels.filter(
    (label) => label.labeledBy === 'synthetic-fixture',
  ).length;
  return {
    corpusVersion: corpus.version,
    corpusId: corpus.corpusId,
    matchRunIds: matchRuns.map((run) => run.matchRunId).sort(),
    comparisonMatchRunIds: comparisonRuns.map((run) => run.matchRunId).sort(),
    evaluatedAt: new Date().toISOString(),
    recallAt50: relevantRecallDenominator === 0
      ? 0
      : relevantRecallNumerator / relevantRecallDenominator,
    precisionAt3: precisionDenominator === 0
      ? 0
      : precisionNumerator / precisionDenominator,
    ndcgAt5: evaluatedPairCount === 0 ? 0 : ndcgTotal / evaluatedPairCount,
    guardrailViolationCount,
    multiStretchViolationCount,
    missingProvenanceCount,
    missingMatchRunCount,
    byteIdenticalRerun,
    rerunFingerprints,
    determinismComparisons,
    totalEvaluations: labelResults.length,
    evaluatedPairCount,
    highlyRelevantInTop3,
    relevantInTop3,
    irrelevantInTop3,
    forbiddenInResults,
    syntheticFixtureCount,
    expertLabelCount: corpus.expertLabels.length - syntheticFixtureCount,
    labelResults,
  };
}

export function checkAcceptanceThresholds(
  metrics: EvaluationMetrics,
  thresholds: AcceptanceThresholds,
): EvaluationResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  if (metrics.recallAt50 < thresholds.minRecallAt50) {
    failures.push(`Recall@50 ${metrics.recallAt50} below ${thresholds.minRecallAt50}`);
  }
  if (metrics.precisionAt3 < thresholds.minPrecisionAt3) {
    failures.push(`Precision@3 ${metrics.precisionAt3} below ${thresholds.minPrecisionAt3}`);
  }
  if (metrics.ndcgAt5 < thresholds.minNdcgAt5) {
    failures.push(`nDCG@5 ${metrics.ndcgAt5} below ${thresholds.minNdcgAt5}`);
  }
  if (metrics.guardrailViolationCount > thresholds.maxGuardrailViolations) {
    failures.push(`Guardrail violations ${metrics.guardrailViolationCount} exceed ${thresholds.maxGuardrailViolations}`);
  }
  if (metrics.multiStretchViolationCount > thresholds.maxMultiStretchViolations) {
    failures.push(`Multi-stretch violations ${metrics.multiStretchViolationCount} exceed ${thresholds.maxMultiStretchViolations}`);
  }
  if (metrics.missingProvenanceCount > thresholds.maxMissingProvenance) {
    failures.push(`Missing provenance ${metrics.missingProvenanceCount} exceeds ${thresholds.maxMissingProvenance}`);
  }
  if (metrics.missingMatchRunCount > thresholds.maxMissingMatchRuns) {
    failures.push(`Missing match runs ${metrics.missingMatchRunCount} exceed ${thresholds.maxMissingMatchRuns}`);
  }
  if (thresholds.requireByteIdenticalRerun && !metrics.byteIdenticalRerun) {
    failures.push('Byte-identical rerun verification was not proven');
  }
  if (
    thresholds.requireExpertLabels
    && (metrics.expertLabelCount === 0 || metrics.syntheticFixtureCount > 0)
  ) {
    failures.push('Production evaluation requires a fully expert-labelled corpus');
  }
  if (metrics.syntheticFixtureCount > 0) {
    warnings.push(`${metrics.syntheticFixtureCount} synthetic fixture labels are present`);
  }
  return {
    metrics,
    thresholds,
    passed: failures.length === 0,
    failures,
    warnings,
  };
}
