import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play } from 'lucide-react';
import { ChromeMeshGrid, LiquidMetalCard } from '../components';

/**
 * CandidateScreeningPage - Candidate-facing screening interface
 *
 * Placeholder implementation for MVP scaffolding
 */
export default function CandidateScreeningPage(): JSX.Element {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e', fontFamily: '"Space Mono", monospace', color: '#fff' }}>
      <ChromeMeshGrid />

      {/* Progress bar */}
      <div style={{ height: 4, background: 'rgba(255,255,255,0.05)' }}>
        <div style={{ width: '33%', height: '100%', background: 'linear-gradient(90deg, rgba(150,255,150,0.6), rgba(150,255,150,0.8))' }} />
      </div>

      <div style={{ padding: '60px 32px', maxWidth: 800, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>SCREENING // QUESTION 1 OF 3</div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: 0,
              background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            VIDEO RESPONSE
          </h1>
        </div>

        <LiquidMetalCard variant="mercury" style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ marginBottom: 32 }}>
            <p style={{ fontSize: 16, color: '#fff', lineHeight: 1.7, marginBottom: 24 }}>
              Tell us about a recent project where you used AI tools to enhance your development workflow.
            </p>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Time limit: 2 minutes</div>
          </div>

          <div
            style={{
              width: '100%',
              height: 300,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 32,
            }}
          >
            <div>
              <Play size={48} color="rgba(255,255,255,0.3)" />
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 16 }}>CLICK TO RECORD</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => navigate(-1)}
              style={{
                padding: '12px 24px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'rgba(255,255,255,0.6)',
                fontSize: 10,
                letterSpacing: '0.15em',
                cursor: 'pointer',
              }}
            >
              <ArrowLeft size={12} style={{ display: 'inline', marginRight: 8 }} />
              BACK
            </button>
            <button
              onClick={() => navigate(-1)}
              style={{
                padding: '12px 32px',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                fontSize: 10,
                letterSpacing: '0.15em',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              NEXT QUESTION →
            </button>
          </div>
        </LiquidMetalCard>
      </div>
    </div>
  );
}
