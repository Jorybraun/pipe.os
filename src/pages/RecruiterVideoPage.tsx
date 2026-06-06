import { useParams } from 'react-router-dom';
import { VideoShell } from '../components/Shells/VideoShell';
import { ChromeMeshGrid } from '../components/ChromeMeshGrid';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { Video } from 'lucide-react';

export default function RecruiterVideoPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  
  // For recruiter video page, we use the interview ID as both stage ID and candidate ID
  // This allows the VideoShell to work with contact-first interviews
  const stageId = id || '';
  const candidateId = id || '';

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: '#0c0c0e' }}>
      <ChromeMeshGrid />
      <VideoShell
        stageId={stageId}
        candidateId={candidateId}
        role="RECRUITER"
      >
        <div style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}>
          <LiquidMetalCard variant="chrome" style={{ maxWidth: 480, padding: 48, textAlign: 'center' }}>
            <Video size={48} color="var(--pipe-text, #fff)" style={{ marginBottom: 24 }} />
            <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--pipe-text, #fff)', marginBottom: 16 }}>
              Recruiter Video Call
            </h2>
            <p style={{ fontSize: 14, color: 'var(--pipe-text-muted)', lineHeight: 1.6, marginBottom: 8, fontFamily: '"Space Mono", monospace' }}>
              Interview ID: {id}
            </p>
            <p style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
              Waiting for recipient to join...
            </p>
          </LiquidMetalCard>
        </div>
      </VideoShell>
    </div>
  );
}
