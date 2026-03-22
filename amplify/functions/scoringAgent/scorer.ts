import { Bug, CodeReviewConfig, QuizMCQConfig } from './types';

// Minimal annotation shape used by the scoring logic
interface AnnotationInput {
  line: number;
  severity: string;
  comment: string;
}

/**
 * Normalize submission.annotations to a flat array.
 *
 * Handles two formats:
 *   - New (DiffPanel): flat `Annotation[]` — `{ annotations: [...], verdict, summary }`
 *   - Legacy (DiffReviewCanvas): map `{ [snippetId]: Annotation[] }`
 */
function normalizeAnnotations(rawAnnotations: unknown): AnnotationInput[] {
  if (Array.isArray(rawAnnotations)) {
    // New format: flat array from DiffPanel/CodeReviewChallenge
    return rawAnnotations as AnnotationInput[];
  }
  if (rawAnnotations && typeof rawAnnotations === 'object') {
    // Legacy format: map of snippetId → Annotation[]
    return Object.values(rawAnnotations as Record<string, AnnotationInput[]>).flat();
  }
  return [];
}

/**
 * server-side scoring logic for Code Review
 */
export function scoreCodeReview(
  submission: unknown,
  serverConfig: CodeReviewConfig
): number {
  if (!submission || typeof submission !== 'object') return 0;
  const sub = submission as Record<string, unknown>;
  const groundTruth: Bug[] = serverConfig.groundTruth ?? [];

  const allAnnotations = normalizeAnnotations(sub['annotations']);

  const totalBugs = groundTruth.length;
  let bugsFound = 0;
  let severityMatches = 0;
  let falsePositives = 0;
  let validComments = 0;

  allAnnotations.forEach((a) => {
    const match = groundTruth.find((bug) => Math.abs(a.line - bug.line) <= 1);
    if (match) {
      bugsFound++;
      if (match.severity === a.severity) severityMatches++;
      if (a.comment.trim().length > 10) validComments++;
    } else {
      falsePositives++;
    }
  });

  const bugsFoundScore = totalBugs > 0 ? (bugsFound / totalBugs) * 50 : 0;
  const severityScore = bugsFound > 0 ? (severityMatches / bugsFound) * 25 : 0;
  const fixQualityScore = bugsFound > 0 ? (validComments / bugsFound) * 25 : 0;
  const penalty = Math.min(falsePositives * 10, 50);

  return Math.round(Math.max(0, Math.min(100, bugsFoundScore + severityScore + fixQualityScore - penalty)));
}

/**
 * server-side scoring logic for MCQ
 */
export function scoreQuizMCQ(
  submission: unknown,
  serverConfig: QuizMCQConfig
): number {
  if (!submission || typeof submission !== 'object') return 0;
  const sub = submission as Record<string, unknown>;
  const answers = sub['answers'] as Record<string, unknown> | undefined;
  const selectedId = answers?.['current'];
  const correctId = serverConfig.correctOptionId;
  return selectedId === correctId ? 100 : 0;
}

/**
 * Unified scorer function
 */
export function scorer(type: string, submission: unknown, serverConfig: unknown): number {
  switch (type) {
    case 'CODE_REVIEW':
      return scoreCodeReview(submission, serverConfig as CodeReviewConfig);
    case 'QUIZ_MCQ':
      return scoreQuizMCQ(submission, serverConfig as QuizMCQConfig);
    default:
      console.warn(`No scoring logic implemented for type: ${type}`);
      return 0;
  }
}
