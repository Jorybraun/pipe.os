import { ChallengeRegistry } from '../Assessment/ChallengeRegistry';

// ============================================================================
// Types
// ============================================================================

interface PreviewTabProps {
  challenge: {
    id: string;
    type: string | null;
    title: string;
    instructions: string | null;
    config: any;
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * PreviewTab - Renders the challenge as a candidate would see it.
 * Uses ChallengeRegistry for high-fidelity preview.
 */
export function PreviewTab({ challenge }: PreviewTabProps): JSX.Element {
  // Parse config if it's a string (Amplify Data often returns it as string if not careful, 
  // though we defined it as a.json())
  const safeConfig = typeof challenge.config === 'string' 
    ? JSON.parse(challenge.config) 
    : challenge.config;

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: 24
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 0 16px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)'
      }}>
        <div>
          <div style={{ 
            fontSize: 9, 
            letterSpacing: '0.2em', 
            color: 'rgba(255,255,255,0.3)', 
            fontFamily: 'Space Mono, monospace',
            marginBottom: 4
          }}>
            CANDIDATE_VIEW_PROTOTYPE
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            This is exactly how the challenge will appear to candidates.
          </div>
        </div>
      </div>

      <div style={{ 
        flex: 1, 
        background: '#000', 
        borderRadius: 12, 
        border: '1px solid rgba(255,255,255,0.1)',
        overflow: 'hidden',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        position: 'relative'
      }}>
        <ChallengeRegistry
          challenge={{
            ...challenge,
            config: safeConfig
          }}
          onSubmissionChange={() => {}}
          onSubmit={() => {
            alert('Preview submission received!');
          }}
        />
      </div>
    </div>
  );
}
