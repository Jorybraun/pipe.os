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
import { AIChat } from '../AIChat';
import { createCandidateConversationAdapter } from '../../lib/adapters/candidateConversationAdapter';
import type { SynthesisResult } from '../AIChat/types';

export function AgentInterviewChallenge(): JSX.Element {
  const { currentChallenge, updateSubmission } = useInterview();
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

    updateSubmission({ transcript: transcriptText, completedAt: new Date().toISOString() });
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
      adapter={adapter}
      initConfig={initConfig}
      enableVoice
      enableLiveVoice={false}
      onComplete={handleComplete}
    />
  );
}
