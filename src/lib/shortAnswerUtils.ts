/**
 * Short answer challenge utilities — extracted from challengeLibrary (removed).
 *
 * Used by ShortAnswerEditor, ChallengeRegistry, InlineChallengeAdder,
 * and StageConfigPanel.
 */

export type ShortAnswerInputMode = 'text' | 'voice' | 'video';

export interface QuizShortAnswerTextConfig {
  inputMode?: 'text'; // explicit text, or omitted for back-compat
  question: string;
  placeholder?: string;
  maxLength?: number;
  rubric?: string;
}

export interface QuizShortAnswerVoiceConfig {
  inputMode: 'voice';
  question: string;
  rubric?: string;
  /** S3 key of the recruiter's question video, readable by guest */
  questionVideoS3Key?: string;
}

export interface QuizShortAnswerVideoConfig {
  inputMode: 'video';
  question: string;
  rubric?: string;
  /** S3 key of the recruiter's question video, readable by guest */
  questionVideoS3Key?: string;
  /** Max recording duration in seconds (default 120) */
  maxDurationSeconds?: number;
}

/** Discriminated union of all QUIZ_SHORT_ANSWER config shapes */
export type QuizShortAnswerConfig =
  | QuizShortAnswerTextConfig
  | QuizShortAnswerVoiceConfig
  | QuizShortAnswerVideoConfig;

/**
 * Normalizes raw config from DB into a typed QuizShortAnswerConfig.
 * Existing records that omit inputMode are treated as 'text'.
 */
export function normalizeShortAnswerConfig(raw: unknown): QuizShortAnswerConfig {
  if (typeof raw !== 'object' || raw === null) {
    return { inputMode: 'text', question: '' };
  }
  const r = raw as Record<string, unknown>;
  const mode = r['inputMode'] as ShortAnswerInputMode | undefined;
  if (mode === 'voice') return raw as QuizShortAnswerVoiceConfig;
  if (mode === 'video') return raw as QuizShortAnswerVideoConfig;
  // Back-compat: anything without inputMode (or inputMode: 'text') is text
  return { ...r, inputMode: 'text' } as QuizShortAnswerTextConfig;
}
