import { Bug, CodeReviewConfig, QuizMCQConfig } from './types';
import type { CodeImplPublicConfig, CodeImplServerConfig, CodeImplFeedback, VirtualFSServer } from './types';
import { executeCodeChallenge } from './codeExecutor';

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

// ---------------------------------------------------------------------------
// CODE_IMPLEMENTATION scoring
// ---------------------------------------------------------------------------

function extractContentMap(vfs: VirtualFSServer | undefined): Record<string, string> {
  if (!vfs) return {};
  const out: Record<string, string> = {};
  for (const [path, file] of Object.entries(vfs)) {
    out[path] = typeof file === 'object' && file !== null ? file.content : String(file);
  }
  return out;
}

export async function scoreCodeImplementation(
  submission: unknown,
  serverConfig: CodeImplServerConfig,
  publicConfig: CodeImplPublicConfig,
): Promise<{ score: number; feedback: string }> {
  const sub = (submission && typeof submission === 'object') ? submission as Record<string, unknown> : {};
  const submittedFiles = (sub['files'] as Record<string, string>) ?? {};

  // Merge submitted content over starter files to get complete candidate FS
  const starterFiles = extractContentMap(publicConfig.files);
  const candidateFiles: Record<string, string> = { ...starterFiles };
  for (const [path, content] of Object.entries(submittedFiles)) {
    candidateFiles[path] = content;
  }

  const mode = publicConfig.mode ?? 'backend';
  const sampleTestContent = extractContentMap(publicConfig.sampleTestFiles);
  const hiddenTestContent = extractContentMap(serverConfig.hiddenTestFiles);
  const weights = serverConfig.scoringWeights ?? { sampleTests: 0.3, hiddenTests: 0.7 };

  // Run sample tests
  const sampleResult = Object.keys(sampleTestContent).length > 0
    ? await executeCodeChallenge(mode, candidateFiles, sampleTestContent, 10000)
    : { tests: [], logs: [], durationMs: 0 };

  // Run hidden tests
  const hiddenResult = Object.keys(hiddenTestContent).length > 0
    ? await executeCodeChallenge(mode, candidateFiles, hiddenTestContent, 10000)
    : { tests: [], logs: [], durationMs: 0 };

  const samplePassed = sampleResult.tests.filter(t => t.status === 'pass').length;
  const sampleTotal = sampleResult.tests.length;
  const hiddenPassed = hiddenResult.tests.filter(t => t.status === 'pass').length;
  const hiddenTotal = hiddenResult.tests.length;

  // Weighted score
  const sampleScore = sampleTotal > 0 ? samplePassed / sampleTotal : 0;
  const hiddenScore = hiddenTotal > 0 ? hiddenPassed / hiddenTotal : 0;

  let score: number;
  if (sampleTotal === 0 && hiddenTotal === 0) {
    score = 0;
  } else if (hiddenTotal === 0) {
    score = Math.round(sampleScore * 100);
  } else if (sampleTotal === 0) {
    score = Math.round(hiddenScore * 100);
  } else {
    score = Math.round((sampleScore * weights.sampleTests + hiddenScore * weights.hiddenTests) * 100);
  }

  const totalPassed = samplePassed + hiddenPassed;
  const totalTests = sampleTotal + hiddenTotal;

  const feedbackObj: CodeImplFeedback = {
    score,
    summary: `Passed ${totalPassed}/${totalTests} tests (${score}%)`,
    sampleTests: sampleResult.tests,
    hiddenTests: { passed: hiddenPassed, total: hiddenTotal },
    ...(sampleResult.error || hiddenResult.error
      ? { executionError: sampleResult.error || hiddenResult.error }
      : {}),
  };

  return { score, feedback: JSON.stringify(feedbackObj) };
}

/**
 * Unified scorer function (sync — CODE_IMPLEMENTATION uses scoreCodeImplementation directly)
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
