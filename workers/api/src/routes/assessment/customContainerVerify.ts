import { Hono } from 'hono';
import { apiError } from '../../middleware/errors';
import { RepoTaskInterviewSessionStore } from '../../lib/repoTaskInterviewSession';
import type { Env } from '../../types';

interface VerifyRequestBody {
  sessionId?: string;
  command?: string;
  exitCode?: number;
  output?: string;
  passed?: boolean;
  artifacts?: string[];
}

export const customContainerVerify = new Hono<{ Bindings: Env }>();

// POST /api/v1/dev-container/verify
// Called by a custom container after it runs the verification command (PIPE_TEST_COMMAND).
// The sessionId is the dev container session id returned by POST /dev-container/launch.
customContainerVerify.post('/', async (c) => {
  const body = (await c.req.json()) as VerifyRequestBody;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const command = typeof body.command === 'string' ? body.command.trim() : '';
  const output = typeof body.output === 'string' ? body.output : '';
  const exitCode = typeof body.exitCode === 'number' ? body.exitCode : null;
  const passed = typeof body.passed === 'boolean' ? body.passed : exitCode === 0;

  if (!sessionId) {
    return apiError(c, 'VALIDATION_ERROR', 'sessionId is required.');
  }
  if (!command) {
    return apiError(c, 'VALIDATION_ERROR', 'command is required.');
  }
  if (exitCode === null) {
    return apiError(c, 'VALIDATION_ERROR', 'exitCode is required.');
  }

  const db = c.env.DB;

  const session = await db
    .prepare(
      `SELECT dcs.session_id, dcs.candidate_id, dcs.challenge_id
       FROM dev_container_sessions dcs
       WHERE dcs.session_id = ?1
       LIMIT 1`,
    )
    .bind(sessionId)
    .first<{ session_id: string; candidate_id: string; challenge_id: string | null }>();

  if (!session) {
    return apiError(c, 'NOT_FOUND', 'Dev container session not found.');
  }

  const interview = await db
    .prepare(
      `SELECT si.id AS interview_id, si.candidate_id
       FROM scheduled_interviews si
       WHERE si.candidate_id = ?1
         AND si.interview_type = 'CUSTOM_CONTAINER'
         AND (si.challenge_id = ?2 OR (?2 IS NULL AND si.challenge_id IS NULL))
         AND si.status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY si.created_at DESC
       LIMIT 1`,
    )
    .bind(session.candidate_id, session.challenge_id)
    .first<{ interview_id: string; candidate_id: string }>();

  if (!interview) {
    return apiError(c, 'NOT_FOUND', 'No active CUSTOM_CONTAINER interview for this session.');
  }

  const assessmentSession = await db
    .prepare(
      `SELECT id FROM assessment_sessions
       WHERE interview_id = ?1 AND candidate_id = ?2 AND mode = 'CUSTOM_CONTAINER'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(interview.interview_id, interview.candidate_id)
    .first<{ id: string }>();

  if (!assessmentSession) {
    return apiError(c, 'NOT_FOUND', 'Assessment session not found.');
  }

  const now = new Date().toISOString();
  const store = new RepoTaskInterviewSessionStore(db);
  const testRunSourceRefId = `custom-container:${sessionId}:${crypto.randomUUID()}`;

  const testRunEvent = await store.recordEvent({
    sessionId: assessmentSession.id,
    ingestionKey: `assessment-event:custom-container-test-run:${assessmentSession.id}:${now}`,
    kind: 'test_run',
    actorType: 'candidate',
    actorId: session.candidate_id,
    narrative: `Verification command "${command}" completed with exit code ${exitCode} and passed=${passed}.`,
    payload: {
      command,
      exitCode,
      passed,
      outputLength: output.length,
      artifacts: Array.isArray(body.artifacts) ? body.artifacts : [],
    },
    occurredAt: now,
    sourceRefs: [
      {
        sourceRefType: 'test_run',
        sourceRefId: testRunSourceRefId,
        exactText: output,
        metadata: {
          command,
          exitCode,
          passed,
        },
      },
    ],
  });

  if (passed) {
    await store.recordEvent({
      sessionId: assessmentSession.id,
      ingestionKey: `assessment-event:custom-container-final-submission:${assessmentSession.id}:${now}`,
      kind: 'final_submission',
      actorType: 'candidate',
      actorId: session.candidate_id,
      narrative: 'Custom container verification passed. Candidate finalized the challenge.',
      payload: {
        verificationCommand: command,
        exitCode,
        passed,
      },
      occurredAt: now,
      sourceRefs: [
        {
          sourceRefType: 'test_run',
          sourceRefId: testRunSourceRefId,
          evidenceRole: 'verification',
        },
      ],
    });

    const currentSession = await store.loadSession(assessmentSession.id);
    if (currentSession.state === 'IN_PROGRESS') {
      await store.transitionState({
        sessionId: assessmentSession.id,
        toState: 'FINAL_SUBMITTED',
        reason: 'Custom container verification passed.',
        createdBy: 'candidate',
      });
    }
  }

  return c.json({
    accepted: true,
    assessmentSessionId: assessmentSession.id,
    testRunEventId: testRunEvent.id,
    passed,
  });
});