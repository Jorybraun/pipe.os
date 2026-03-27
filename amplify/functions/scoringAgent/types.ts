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

// ---------------------------------------------------------------------------
// CODE_IMPLEMENTATION types
// ---------------------------------------------------------------------------

export interface VirtualFileServer {
  content: string;
  language: string;
  readOnly?: boolean;
}

export type VirtualFSServer = Record<string, VirtualFileServer>;

export interface CodeImplPublicConfig {
  mode: 'backend' | 'frontend';
  language: string;
  files: VirtualFSServer;
  sampleTestFiles?: VirtualFSServer;
}

export interface CodeImplServerConfig {
  hiddenTestFiles: VirtualFSServer;
  testLanguage: string;
  scoringWeights?: { sampleTests: number; hiddenTests: number };
}

export interface CodeImplTestResult {
  name: string;
  status: 'pass' | 'fail' | 'error';
  error?: string;
  durationMs?: number;
}

export interface CodeImplFeedback {
  score: number;
  summary: string;
  sampleTests: CodeImplTestResult[];
  hiddenTests: { passed: number; total: number };
  executionError?: string;
}
