export interface ScoringRequest {
  assessmentId: string;
  challengeId: string;
  submission: string; // JSON string
}

export interface ScoringResponse {
  success: boolean;
  score: number;
  error?: string;
}

/**
 * Structured feedback returned by the agentic CODE_REVIEW scoring pass.
 * Serialised to JSON and stored in Assessment.feedback.
 * Frontend detects this shape via JSON.parse; old plain-string feedback still renders.
 */
export interface AgenticFeedback {
  score: number;
  summary: string;
  strengths: string[];
  concerns: string[];
  skillProfile: {
    bugIdentification: number;
    severityJudgment: number;
    analyticalWriting: number;
    technicalDepth: number;
  };
}

export interface Bug {
  line: number;
  type: string;
  severity: 'critical' | 'major' | 'minor';
  explanation: string;
}

export interface CodeReviewConfig {
  groundTruth: Bug[];
}

export interface QuizMCQConfig {
  correctOptionId: string;
}
