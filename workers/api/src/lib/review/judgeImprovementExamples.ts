import type { ReviewRound } from '../implementerAgent';
import { deterministicEntityId, stableJson } from '../livingContext/persistence';
import type { JsonObject } from '../livingContext/types';

export interface CodeReviewJudgeExampleTranscript {
  rounds: ReviewRound[];
  verdict?: {
    decision: string;
    summary: string;
    submittedAt: string;
  };
}

export interface PersistCodeReviewJudgeExampleInput {
  db: D1Database;
  sessionId: string;
  assessmentId: string;
  challengeId: string;
  candidateId: string;
  transcript: CodeReviewJudgeExampleTranscript;
  observedAt: string;
}

export interface LabelCodeReviewJudgeExampleInput extends PersistCodeReviewJudgeExampleInput {
  expectedOutputJson: string;
  producer: 'automated_scorer' | 'recruiter_override';
  producerId?: string | null;
  source?: 'review_session_score_override' | 'automated_score_report';
  reviewerFeedback?: string | null;
  judgeFailureModes?: string[];
}

interface CompiledReviewComment {
  round: number;
  commentId: number;
  file: string | null;
  line: number | null;
  severity: string | null;
  what: string;
  why: string;
  suggestion: string | null;
  positive: boolean;
}

interface CompiledPushback {
  round: number;
  toCommentId: number;
  move: string;
  content: string;
  updatedCode: string | null;
}

const EXAMPLE_VERSION = 'code-review-judge-example-v1';

function compileComments(rounds: ReviewRound[]): CompiledReviewComment[] {
  return rounds.flatMap((round) =>
    round.reviewer_comments.flatMap((comment) => {
      const what = comment.what.trim();
      if (!what) return [];
      return [{
        round: round.round,
        commentId: comment.id,
        file: comment.file ?? null,
        line: typeof comment.line === 'number' ? comment.line : null,
        severity: comment.severity ?? null,
        what,
        why: comment.why?.trim() ?? '',
        suggestion: comment.suggestion?.trim() ?? null,
        positive: comment.positive === true,
      }];
    })
  );
}

function compilePushback(rounds: ReviewRound[]): CompiledPushback[] {
  return rounds.flatMap((round) =>
    round.implementer_responses.map((response) => ({
      round: round.round,
      toCommentId: response.to_comment_id,
      move: response.move,
      content: response.content,
      updatedCode: response.updated_code ?? null,
    }))
  );
}

function compileRoundSummaries(rounds: ReviewRound[]): Array<{
  round: number;
  summary: string;
}> {
  return rounds.flatMap((round) => {
    const summary = round.reviewer_summary?.trim();
    return summary ? [{ round: round.round, summary }] : [];
  });
}

export function buildCodeReviewJudgeExample(
  input: Omit<PersistCodeReviewJudgeExampleInput, 'db'>,
): { promptInputJson: string; provenanceJson: string } {
  const comments = compileComments(input.transcript.rounds);
  const pushback = compilePushback(input.transcript.rounds);
  const finalVerdict = input.transcript.verdict?.decision ?? null;
  const finalSummary = input.transcript.verdict?.summary ?? null;
  const promptInput = {
    schemaVersion: EXAMPLE_VERSION,
    task: 'score_and_improve_code_review_judge',
    session: {
      sessionId: input.sessionId,
      assessmentId: input.assessmentId,
      challengeId: input.challengeId,
      candidateId: input.candidateId,
    },
    candidateReview: {
      finalVerdict,
      finalSummary,
      comments,
      roundSummaries: compileRoundSummaries(input.transcript.rounds),
    },
    aiDeveloperPushback: pushback,
    metrics: {
      roundCount: input.transcript.rounds.length,
      commentCount: comments.length,
      pushbackCount: pushback.length,
      hasFinalVerdict: finalVerdict !== null,
    },
    improvementUses: [
      'judge_prompt_regression',
      'feedback_prompt_regression',
      'human_label_queue',
      'cross_model_calibration',
    ],
    labelSlots: {
      idealScoreReport: null,
      reviewerFeedback: null,
      judgeFailureModes: [],
    },
  };
  const provenance = {
    schemaVersion: EXAMPLE_VERSION,
    sourceTables: ['review_sessions', 'challenge_submissions'],
    rawTranscriptRef: {
      table: 'review_sessions',
      id: input.sessionId,
      transcriptHash: null,
    },
    assessmentId: input.assessmentId,
    challengeId: input.challengeId,
    candidateId: input.candidateId,
    observedAt: input.observedAt,
  };

  return {
    promptInputJson: stableJson(promptInput as unknown as JsonObject),
    provenanceJson: stableJson(provenance as unknown as JsonObject),
  };
}

export async function persistCodeReviewJudgeExample(
  input: PersistCodeReviewJudgeExampleInput,
): Promise<string> {
  const id = await deterministicEntityId(
    'code_review_judge_example',
    input.sessionId,
  );
  const compiled = buildCodeReviewJudgeExample(input);
  await input.db.prepare(
    `INSERT INTO code_review_judge_examples (
       id, session_id, assessment_id, challenge_id, candidate_id,
       example_version, prompt_input_json, expected_output_json,
       judge_feedback_json, provenance_json, status, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8, 'READY', ?9, ?9)
     ON CONFLICT(session_id) DO UPDATE SET
       assessment_id = excluded.assessment_id,
       challenge_id = excluded.challenge_id,
       candidate_id = excluded.candidate_id,
       example_version = excluded.example_version,
       prompt_input_json = excluded.prompt_input_json,
       provenance_json = excluded.provenance_json,
       status = CASE
         WHEN code_review_judge_examples.status = 'LABELLED' THEN code_review_judge_examples.status
         ELSE 'READY'
       END,
       updated_at = excluded.updated_at`,
  ).bind(
    id,
    input.sessionId,
    input.assessmentId,
    input.challengeId,
    input.candidateId,
    EXAMPLE_VERSION,
    compiled.promptInputJson,
    compiled.provenanceJson,
    input.observedAt,
  ).run();
  return id;
}

export async function labelCodeReviewJudgeExample(
  input: LabelCodeReviewJudgeExampleInput,
): Promise<string> {
  const id = await persistCodeReviewJudgeExample(input);
  const feedback = {
    schemaVersion: EXAMPLE_VERSION,
    source: input.source ?? (
      input.producer === 'recruiter_override'
        ? 'review_session_score_override'
        : 'automated_score_report'
    ),
    labelType: input.producer === 'recruiter_override'
      ? 'human_score_report'
      : 'machine_score_report',
    producer: input.producer,
    producerId: input.producerId ?? null,
    reviewerFeedback: input.reviewerFeedback ?? null,
    judgeFailureModes: input.judgeFailureModes ?? [],
    labelledAt: input.observedAt,
  };

  await input.db.prepare(
    `UPDATE code_review_judge_examples
        SET expected_output_json = ?1,
            judge_feedback_json = ?2,
            status = 'LABELLED',
            updated_at = ?3
      WHERE session_id = ?4`,
  ).bind(
    input.expectedOutputJson,
    stableJson(feedback as unknown as JsonObject),
    input.observedAt,
    input.sessionId,
  ).run();

  return id;
}
