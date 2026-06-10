import { useParams } from 'react-router-dom';
import { ChromeMeshGrid } from '../components/ChromeMeshGrid';
import { VideoInterviewStep } from '../components/Video/VideoInterviewStep';
import { SessionTokenProvider } from '../contexts/SessionTokenContext';
import { CandidateIdProvider } from '../contexts/CandidateIdContext';

/**
 * VideoJoinPage — public page for candidates to join a video call via invite link.
 *
 * Route: /video/:sessionId
 *
 * The sessionId param is in the format `stageId--candidateId`.
 * This page wraps VideoInterviewStep with the necessary context providers
 * so the candidate can connect to the Durable Object video room.
 */
export default function VideoJoinPage(): JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();

  // Parse stageId and candidateId from the session ID (format: stageId--candidateId)
  const parts = sessionId?.split('--') ?? [];
  const stageId = parts[0] ?? '';
  const candidateId = parts[1] ?? '';

  if (!stageId || !candidateId) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#0c0c0e', color: '#f87171',
        fontFamily: '"Space Mono", monospace', fontSize: 14,
      }}>
        <ChromeMeshGrid />
        <div style={{ textAlign: 'center', zIndex: 1 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: '#fff' }}>
            Invalid Meeting Link
          </h2>
          <p style={{ color: 'var(--pipe-text-dim)', fontSize: 13 }}>
            This link is invalid. Please contact your recruiter for a new invitation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SessionTokenProvider value={null}>
      <CandidateIdProvider value={{ stageId, candidateId }}>
        <div style={{ height: '100vh', overflow: 'hidden', background: '#0c0c0e' }}>
          <ChromeMeshGrid />
          <div style={{ position: 'relative', zIndex: 1, height: '100%' }}>
            <VideoInterviewStep />
          </div>
        </div>
      </CandidateIdProvider>
    </SessionTokenProvider>
  );
}
