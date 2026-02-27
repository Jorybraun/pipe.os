import { Annotation } from '../../components/ReviewCanvas';
import { Bug } from '../../content/codeReviewSnippets';

// ============================================================================
// Types
// ============================================================================

interface SnippetSubmission {
  annotations: Record<string, Annotation[]>;
}

interface SnippetConfig {
  id: string;
  groundTruth: Bug[];
}

export interface ScoreBreakdown {
  bugsFound: number;
  totalBugs: number;
  severityAccuracy: number;
  falsePositives: number;
  fixQuality: number; // For MVP, this is based on comment length/presence
}

export interface ScoreResult {
  total: number;
  breakdown: ScoreBreakdown;
}

// ============================================================================
// Logic
// ============================================================================

/**
 * scoreCodeReview - Computes a score based on candidate annotations vs ground truth.
 * 
 * Rubric:
 * - Bugs found (40%): How many ground truth bugs were identified?
 * - Severity accuracy (25%): Did the candidate correctly identify the severity?
 * - False positives (-10% penalty): Annotations on lines that are NOT bugs.
 * - Fix quality (25%): For MVP, check if the comment is > 10 chars.
 */
export function scoreCodeReview(
  submission: SnippetSubmission,
  snippets: SnippetConfig[]
): ScoreResult {
  let totalBugs = 0;
  let bugsFound = 0;
  let severityMatches = 0;
  let falsePositives = 0;
  let validComments = 0;

  const annotationsMap = submission.annotations || {};

  snippets.forEach(snippet => {
    const snippetAnnotations = annotationsMap[snippet.id] || [];
    const snippetBugs = snippet.groundTruth || [];
    totalBugs += snippetBugs.length;

    // 1. Check bugs found and severity accuracy
    snippetBugs.forEach(bug => {
      const match = snippetAnnotations.find(a => Math.abs(a.line - bug.line) <= 1); // Allow +/- 1 line off
      
      if (match) {
        bugsFound++;
        if (match.severity === bug.severity) {
          severityMatches++;
        }
        if (match.comment.trim().length > 10) {
          validComments++;
        }
      }
    });

    // 2. Check for false positives
    snippetAnnotations.forEach(a => {
      const isBug = snippetBugs.some(bug => Math.abs(a.line - bug.line) <= 1);
      if (!isBug) {
        falsePositives++;
      }
    });
  });

  // Calculate percentages
  const bugsFoundScore = totalBugs > 0 ? (bugsFound / totalBugs) * 50 : 0;
  const severityScore = bugsFound > 0 ? (severityMatches / bugsFound) * 25 : 0;
  const fixQualityScore = bugsFound > 0 ? (validComments / bugsFound) * 25 : 0;
  const penalty = Math.min(falsePositives * 10, 50); // Max 50% penalty

  const total = Math.max(0, Math.min(100, bugsFoundScore + severityScore + fixQualityScore - penalty));

  return {
    total: Math.round(total),
    breakdown: {
      bugsFound,
      totalBugs,
      severityAccuracy: Math.round(bugsFound > 0 ? (severityMatches / bugsFound) * 100 : 0),
      falsePositives,
      fixQuality: Math.round(bugsFound > 0 ? (validComments / bugsFound) * 100 : 0)
    }
  };
}
