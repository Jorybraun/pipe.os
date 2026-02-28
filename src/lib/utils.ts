export function sanitizeChallengeConfig(config: any, challengeType: string): any {
  if (challengeType === 'QUIZ_MCQ' && config?.correctOptionId) {
    const sanitizedConfig = { ...config };
    delete sanitizedConfig.correctOptionId;
    return sanitizedConfig;
  }

  if (challengeType === 'CODE_REVIEW' && config?.bugLocations?.groundTruth) {
    const sanitizedConfig = { ...config };
    delete sanitizedConfig.bugLocations.groundTruth;
    return sanitizedConfig;
  }

  return config;
}

export type CandidateSignal = 'STRONG' | 'YES' | 'MAYBE' | 'NO';

export function calculateSignal(score: number | null): CandidateSignal {
  if (score === null) return 'MAYBE';
  if (score >= 85) return 'STRONG';
  if (score >= 70) return 'YES';
  if (score >= 50) return 'MAYBE';
  return 'NO';
}