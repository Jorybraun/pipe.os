import { Bug, CodeReviewConfig, QuizMCQConfig } from './types';

/**
 * server-side scoring logic for Code Review
 */
export function scoreCodeReview(
  submission: any,
  serverConfig: CodeReviewConfig
): number {
  const groundTruth = serverConfig.groundTruth || [];
  const annotationsMap = submission.annotations || {};
  
  let totalBugs = groundTruth.length;
  let bugsFound = 0;
  let severityMatches = 0;
  let falsePositives = 0;
  let validComments = 0;

  // For MVP we assume a single snippet or aggregate across them
  // This logic matches src/lib/scoring/codeReview.ts
  Object.entries(annotationsMap).forEach(([snippetId, snippetAnnotations]: [string, any]) => {
    snippetAnnotations.forEach((a: any) => {
      const match = groundTruth.find((bug: Bug) => Math.abs(a.line - bug.line) <= 1);
      
      if (match) {
        bugsFound++;
        if (match.severity === a.severity) {
          severityMatches++;
        }
        if (a.comment.trim().length > 10) {
          validComments++;
        }
      } else {
        falsePositives++;
      }
    });
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
  submission: any,
  serverConfig: QuizMCQConfig
): number {
  const selectedId = submission.answers?.current;
  const correctId = serverConfig.correctOptionId;
  
  return selectedId === correctId ? 100 : 0;
}

/**
 * Unified scorer function
 */
export function scorer(type: string, submission: any, serverConfig: any): number {
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
