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