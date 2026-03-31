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
  const { submitReview, submitResponse, submitVerdict, isLoading } = useReviewSession();
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

      if (currentRound === 1) {
        // First round: submit initial review with annotations
        const annotations = (ctx.submission.annotations as Annotation[]) ?? [];
        const reviewSummary = (ctx.submission.summary as string) ?? 'Review submitted.';

        const challengeOrder = ctx.currentIndex;

        const result = await submitReview(
          challengeOrder,
          annotations,
          reviewSummary || 'Review submitted.',
        );

        ctx.updateSubmission({
          rounds: result.rounds,
          currentRound: result.round + 1,
          sessionId: result.sessionId,
          isAwaitingResponse: false,
        });
      } else {
        // Follow-up rounds: send replies from thread textareas
        const threadReplies = (ctx.submission.threadReplies as Record<number, string>) ?? {};
        const replies = Object.entries(threadReplies)
          .filter(([, content]) => content.trim() !== '')
          .map(([commentId, content]) => ({
            toCommentId: Number(commentId),
            content,
          }));

        if (replies.length === 0) {
          ctx.updateSubmission({ isAwaitingResponse: false });
          return;
        }

        const result = await submitResponse(replies);

        ctx.updateSubmission({
          rounds: result.rounds,
          currentRound: result.round + 1,
          threadReplies: {},
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
