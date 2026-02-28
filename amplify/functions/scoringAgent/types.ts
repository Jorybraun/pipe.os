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
