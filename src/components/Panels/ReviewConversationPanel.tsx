/**
 * ReviewConversationPanel — wrapper that wires ConversationPanel to review RPC endpoints.
 *
 * Replaces the connectInterview HOC version (which was a stub).
 * Uses useInterview() for submission state + useReviewSession() for actual RPC calls.
 *
 * Registered as 'conversation' in COMPONENT_MAP.
 */

import { useCallback, useRef } from 'react';
import { useInterview } from '../../contexts/InterviewContext';
import { useReviewSession } from '../../hooks/useReviewSession';
import { ConversationPanel } from './ConversationPanel';
import type { Thread, ReviewRound, ReviewVerdict } from '../../types/conversation';
import { buildThreadsFromRounds } from '../../types/conversation';
import type { Annotation } from '../Assessment/DiffPanel';

export function ReviewConversationPanel(): JSX.Element {
  const ctx = useInterview();
  const existingSession = (ctx.submission.sessionId as string | null) ?? null;
  const { submitReview, submitResponse, submitVerdict, isLoading } = useReviewSession(existingSession);
  const submittingRef = useRef(false);

  // Read state from interview context
  const rounds = (ctx.submission.rounds as ReviewRound[]) ?? [];
  const threads: Thread[] = buildThreadsFromRounds(rounds);
  const currentRound = (ctx.submission.currentRound as number) ?? 1;
  const maxRounds = (ctx.submission.maxRounds as number) ?? 4;
  const verdict = (ctx.submission.verdict as ReviewVerdict | null) ?? null;
  const summary = (ctx.submission.summary as string) ?? '';
  const isAwaitingResponse = (ctx.submission.isAwaitingResponse as boolean) ?? false;
  const annotations = (ctx.submission.annotations as Annotation[]) ?? [];
  const annotationCount = annotations.length;

  const handleVerdictChange = useCallback(
    (v: ReviewVerdict) => ctx.updateSubmission({ verdict: v }),
    [ctx],
  );

  const handleSummaryChange = useCallback(
    (s: string) => ctx.updateSubmission({ summary: s }),
    [ctx],
  );

  const handleSubmitRound = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;

    try {
      ctx.updateSubmission({ isAwaitingResponse: true });

      const existingSessionId = ctx.submission.sessionId as string | null;
      if (currentRound === 1 && !existingSessionId) {
        // First round: submit initial review with annotations
        const annotations = (ctx.submission.annotations as Annotation[]) ?? [];
        const reviewSummary = (ctx.submission.summary as string) ?? 'Review submitted.';

        const challengeOrder = ctx.currentIndex;

        const result = await submitReview(
          challengeOrder,
          annotations,
          reviewSummary || 'Review submitted.',
        );

        // Mark all annotations as submitted after round 1
        const allAnnotations = (ctx.submission.annotations as Annotation[]) ?? [];
        const allIds = allAnnotations.map((a) => a.id);

        ctx.updateSubmission({
          rounds: result.rounds,
          currentRound: result.round + 1,
          sessionId: result.sessionId,
          submittedAnnotationIds: allIds,
          isAwaitingResponse: false,
        });
      } else {
        // Follow-up rounds: send replies + any new annotations added since last round
        const threadReplies = (ctx.submission.threadReplies as Record<number, string>) ?? {};
        const replies = Object.entries(threadReplies)
          .filter(([, content]) => content.trim() !== '')
          .map(([commentId, content]) => ({
            toCommentId: Number(commentId),
            content,
          }));

        // Collect new annotations not yet submitted
        const allAnnotations = (ctx.submission.annotations as Annotation[]) ?? [];
        const submittedIds = new Set((ctx.submission.submittedAnnotationIds as string[]) ?? []);
        const newAnnotations = allAnnotations.filter((a) => !submittedIds.has(a.id));

        if (replies.length === 0 && newAnnotations.length === 0) {
          ctx.updateSubmission({ isAwaitingResponse: false });
          return;
        }

        const result = await submitResponse(replies, newAnnotations.length > 0 ? newAnnotations : undefined);

        // Mark all annotations as submitted
        const allIds = allAnnotations.map((a) => a.id);

        ctx.updateSubmission({
          rounds: result.rounds,
          currentRound: result.round + 1,
          threadReplies: {},
          submittedAnnotationIds: allIds,
          isAwaitingResponse: false,
        });
      }
    } catch (err) {
      console.error('[ReviewConversationPanel] submit round failed:', err);
      ctx.updateSubmission({ isAwaitingResponse: false });
    } finally {
      submittingRef.current = false;
    }
  }, [ctx, currentRound, submitReview, submitResponse]);

  const handleSubmitVerdict = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;

    try {
      const v = (ctx.submission.verdict as ReviewVerdict) ?? 'comment_only';
      const s = (ctx.submission.summary as string) ?? '';

      await submitVerdict(v, s);

      // After verdict, trigger the standard submission flow to advance
      ctx.submit();
    } catch (err) {
      console.error('[ReviewConversationPanel] submit verdict failed:', err);
    } finally {
      submittingRef.current = false;
    }
  }, [ctx, submitVerdict]);

  const handleThreadReplyChange = useCallback(
    (commentId: number, value: string) => {
      const current = (ctx.submission.threadReplies as Record<number, string>) ?? {};
      ctx.updateSubmission({ threadReplies: { ...current, [commentId]: value } });
    },
    [ctx],
  );

  return (
    <ConversationPanel
      threads={threads}
      currentRound={currentRound}
      maxRounds={maxRounds}
      verdict={verdict}
      summary={summary}
      isAwaitingResponse={isAwaitingResponse || isLoading}
      onVerdictChange={handleVerdictChange}
      onSummaryChange={handleSummaryChange}
      annotationCount={annotationCount}
      onSubmitRound={handleSubmitRound}
      onSubmitVerdict={handleSubmitVerdict}
      onThreadReplyChange={handleThreadReplyChange}
    />
  );
}
