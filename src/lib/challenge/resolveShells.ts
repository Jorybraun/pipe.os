export interface ResolvedShells {
  timer: {
    enabled: boolean;
    timeLimit: number | null; // Minutes
  };
  recording: {
    enabled: boolean;
  };
}

/**
 * Maps challenge config → which shells to wrap (timer, recording).
 */
export function resolveShells(
  challenge: { config?: any },
  stageTimeLimit?: number | null
): ResolvedShells {
  const config = typeof challenge.config === 'string' 
    ? JSON.parse(challenge.config) 
    : (challenge.config || {});

  // Challenge-level limit takes precedence over Stage-level limit
  const timeLimit = config.timeLimit ?? stageTimeLimit ?? null;

  return {
    timer: {
      enabled: timeLimit !== null,
      timeLimit,
    },
    recording: {
      enabled: config.recording === true,
    },
  };
}
