import { describe, expect, it } from 'vitest';
import {
  auditCodeReviewJudgeExamples,
  parseWranglerD1Rows,
  type JudgeExampleRow,
} from './verifyCodeReviewJudgeExamples';

function row(overrides: Partial<JudgeExampleRow> = {}): JudgeExampleRow {
  const promptInput = {
    schemaVersion: 'code-review-judge-example-v1',
    task: 'score_and_improve_code_review_judge',
    candidateReview: {
      comments: [{
        round: 1,
        commentId: 1,
        what: 'The retry path can double-submit the order.',
      }],
    },
    aiDeveloperPushback: [{
      round: 1,
      toCommentId: 1,
      move: 'pushback',
      content: 'The queue already deduplicates retries.',
    }],
    metrics: {
      roundCount: 1,
      commentCount: 1,
      pushbackCount: 1,
      hasFinalVerdict: true,
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
    schemaVersion: 'code-review-judge-example-v1',
    sourceTables: ['review_sessions', 'challenge_submissions'],
    observedAt: '2026-06-27T12:00:00.000Z',
  };

  return {
    id: 'example_1',
    sessionId: 'sess_1',
    status: 'READY',
    promptInputJson: JSON.stringify(promptInput),
    expectedOutputJson: null,
    judgeFeedbackJson: null,
    provenanceJson: JSON.stringify(provenance),
    updatedAt: '2026-06-27T12:00:00.000Z',
    ...overrides,
  };
}

describe('verifyCodeReviewJudgeExamples', () => {
  it('reports an empty queue as not ready with next action guidance', () => {
    const audit = auditCodeReviewJudgeExamples([]);

    expect(audit.status).toBe('not_ready');
    expect(audit.replayReady).toBe(false);
    expect(audit.calibrationReady).toBe(false);
    expect(audit.failures).toContain('no code_review_judge_examples rows found');
    expect(audit.nextActions[0]).toContain('Run a CODE_REVIEW full-submit smoke');
  });

  it('treats complete READY examples as replay-ready but not calibration-ready', () => {
    const audit = auditCodeReviewJudgeExamples([row()]);

    expect(audit.status).toBe('replay_ready');
    expect(audit.replayReady).toBe(true);
    expect(audit.calibrationReady).toBe(false);
    expect(audit.counts).toEqual(expect.objectContaining({
      total: 1,
      ready: 1,
      labelled: 0,
      replayable: 1,
      calibrationReady: 0,
    }));
    expect(audit.examples[0]).toEqual(expect.objectContaining({
      replayable: true,
      labelled: false,
      calibrationReady: false,
      commentCount: 1,
      pushbackCount: 1,
      missing: [],
    }));
    expect(audit.nextActions).toContain('Apply recruiter score overrides or human labels until at least one replay-ready example is LABELLED.');
  });

  it('treats labelled examples with score output as calibration-ready', () => {
    const audit = auditCodeReviewJudgeExamples([
      row({
        status: 'LABELLED',
        expectedOutputJson: JSON.stringify({
          overall: {
            score: 91,
            band: 'strong',
          },
          dimensions: {
            issue_identification: 5,
            reasoning_quality: 5,
          },
          judgeFailureModes: ['candidate_caved_to_weak_pushback'],
        }),
        judgeFeedbackJson: JSON.stringify({
          labelType: 'human_score_report',
          producer: 'recruiter_override',
          judgeFailureModes: ['severity_calibration_wrong'],
        }),
      }),
    ]);

    expect(audit.status).toBe('calibration_ready');
    expect(audit.replayReady).toBe(true);
    expect(audit.calibrationReady).toBe(true);
    expect(audit.counts).toEqual(expect.objectContaining({
      labelled: 1,
      replayable: 1,
      calibrationReady: 1,
    }));
    expect(audit.failureModes).toEqual([
      'candidate_caved_to_weak_pushback',
      'severity_calibration_wrong',
    ]);
    expect(audit.examples[0]).toEqual(expect.objectContaining({
      labelled: true,
      calibrationReady: true,
      missing: [],
    }));
  });

  it('fails replay readiness when pushback or provenance is missing', () => {
    const incompletePrompt = {
      task: 'score_and_improve_code_review_judge',
      candidateReview: {
        comments: [{ what: 'Missing regression coverage.' }],
      },
      aiDeveloperPushback: [],
      improvementUses: ['human_label_queue'],
    };

    const audit = auditCodeReviewJudgeExamples([
      row({
        promptInputJson: JSON.stringify(incompletePrompt),
        provenanceJson: JSON.stringify({ sourceTables: ['review_sessions'] }),
      }),
    ]);

    expect(audit.status).toBe('not_ready');
    expect(audit.replayReady).toBe(false);
    expect(audit.failures).toContain('fewer than 1 replay-ready judge example(s) are available');
    expect(audit.examples[0]!.missing).toEqual(expect.arrayContaining([
      'AI developer pushback',
      'improvement use: judge_prompt_regression',
      'improvement use: feedback_prompt_regression',
      'improvement use: cross_model_calibration',
      'source table: challenge_submissions',
    ]));
  });

  it('parses Wrangler D1 JSON envelopes into judge example rows', () => {
    const rows = parseWranglerD1Rows([{
      results: [{
        id: 'example_remote',
        session_id: 'sess_remote',
        status: 'LABELLED',
        prompt_input_json: '{}',
        expected_output_json: '{}',
        judge_feedback_json: '{}',
        provenance_json: '{}',
        updated_at: '2026-07-03T13:33:10.562Z',
      }],
    }]);

    expect(rows).toEqual([{
      id: 'example_remote',
      sessionId: 'sess_remote',
      status: 'LABELLED',
      promptInputJson: '{}',
      expectedOutputJson: '{}',
      judgeFeedbackJson: '{}',
      provenanceJson: '{}',
      updatedAt: '2026-07-03T13:33:10.562Z',
    }]);
  });
});
