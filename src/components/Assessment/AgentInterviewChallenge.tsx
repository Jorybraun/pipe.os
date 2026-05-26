/**
 * AgentInterviewChallenge — renders the AIChat conversation UI for
 * AGENT_INTERVIEW challenge type.
 *
 * Reads challengeId from InterviewContext and sessionToken from
 * SessionTokenContext. Creates a candidateConversationAdapter scoped to this
 * challenge and hands it to AIChat.
 *
 * On completion the transcript is written into the submission so the
 * InterviewContext / StageShell "Next" button becomes active.
 */

import { useState, useMemo } from 'react';
import type { JSX } from 'react';
import { useInterview } from '../../contexts/InterviewContext';
import { useSessionToken } from '../../contexts/SessionTokenContext';
import { useConversation } from '../../hooks/useConversation';
import { AIChat } from '../AIChat';
import { createCandidateConversationAdapter } from '../../lib/adapters/candidateConversationAdapter';
import type { SynthesisResult } from '../AIChat/types';

export function AgentInterviewChallenge(): JSX.Element {
  const { currentChallenge, updateSubmission, submit } = useInterview();
  const sessionToken = useSessionToken();

  const [done, setDone] = useState(false);

  const adapter = useMemo(
    () =>
      createCandidateConversationAdapter({
        challengeId: currentChallenge.id,
        sessionToken: sessionToken ?? '',
      }),
    // Adapter is keyed to the challenge — recreate only when challenge changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentChallenge.id],
  );

  // Own the conversation state here so <AIChat> reads the same instance as
  // any future side-panels (transcript, coach overlay, etc.) on this page.
  const conv = useConversation(adapter);

  const initConfig = useMemo(
    () => ({
      challengeId: currentChallenge.id,
      sessionToken,
    }),
    // Same key as adapter — stable for the challenge lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentChallenge.id],
  );

  const handleComplete = (result: SynthesisResult): void => {
    setDone(true);

    // Build a plain-text transcript so the submission is non-empty and the
    // StageShell "Next" button becomes active.
    const transcriptText = result.transcript
      ? result.transcript.map((t) => `${t.role}: ${t.text}`).join('\n')
      : result.synthesis;

    // Structured turns with video keys for recruiter profile rendering
    const turns = result.transcript
      ? result.transcript.map((t) => ({
          role: t.role,
          text: t.text,
          ...(t.videoR2Key ? { videoR2Key: t.videoR2Key } : {}),
        }))
      : [];

    const fullSubmission = {
      transcript: transcriptText,
      turns,
      completedAt: new Date().toISOString(),
    };
    updateSubmission(fullSubmission);
    // Auto-submit so the candidate doesn't need to click "Next" manually.
    // The override ensures we submit the complete data even before React
    // batches the setState update.
    submit(fullSubmission);
  };

  if (done) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          fontFamily: '"Space Mono", monospace',
          color: 'var(--pipe-text-muted)',
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: '0.1em' }}>INTERVIEW_COMPLETE</div>
      </div>
    );
  }

  return (
    <AIChat
      conv={conv}
      initConfig={initConfig}
      enableVoice
      enableTTS
      enableVideo
      enableLiveVoice={false}
      onComplete={handleComplete}
      showDomainBars
    />
  );
}
