import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Settings, 
  Code, 
  Shield, 
  Save, 
  Eye, 
  AlertCircle,
} from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../components';
import { Skeleton } from '../components/ui/Skeleton';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { ChallengeRenderer } from '../components/Assessment/ChallengeRegistry';

const client = generateClient<Schema>();

type Challenge = Schema['Challenge']['type'];

/**
 * ChallengeEditorPage - Advanced editor for creating and modifying pipeline challenges.
 * Supports multiple challenge types with specialized editors per type.
 */
export default function ChallengeEditorPage(): JSX.Element {
  const { challengeId } = useParams<{ pipelineId: string; challengeId: string }>();
  const navigate = useNavigate();

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSubmitting] = useState(false);
  const [activeTab, setActiveSection] = useState<'DETAILS' | 'CONTENT' | 'SCORING' | 'PREVIEW'>('DETAILS');

  const fetchData = useCallback(async () => {
    if (!challengeId) return;
    try {
      setIsLoading(true);
      const { data } = await client.models.Challenge.get({ id: challengeId });
      if (data) {
        setChallenge(data);
      }
    } catch (err) {
      console.error('[ChallengeEditor] Error fetching challenge:', err);
    } finally {
      setIsLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!challenge) return;
    setIsSubmitting(true);
    try {
      await client.models.Challenge.update({
        id: challenge.id,
        title: challenge.title,
        instructions: challenge.instructions,
        config: challenge.config,
      });
      // In real app, we might also update or create a CodeArtifact here
      navigate(-1);
    } catch (err) {
      console.error('[ChallengeEditor] Error saving challenge:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: 40 }}>
        <Skeleton width={200} height={32} style={{ marginBottom: 40 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2, 3, 4].map(i => <Skeleton key={i} height={40} />)}
          </div>
          <Skeleton height={600} />
        </div>
      </div>
    );
  }

  if (!challenge) return <div>Challenge not found.</div>;

  const TABS = [
    { id: 'DETAILS', label: 'CHALLENGE_DETAILS', icon: Settings },
    { id: 'CONTENT', label: 'CONTENT_EDITOR', icon: Code },
    { id: 'SCORING', label: 'SCORING_RUBRIC', icon: Shield },
    { id: 'PREVIEW', label: 'CANDIDATE_PREVIEW', icon: Eye },
  ];

  return (
    <div style={{ paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8, fontFamily: 'Space Mono' }}>
              CHALLENGE_EDITOR / {challenge.type}
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>{challenge.title}</h1>
          </div>
        </div>

        <button 
          onClick={handleSave}
          disabled={isSaving}
          style={{ 
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 24px', 
            background: '#fff', color: '#000', border: 'none', borderRadius: 4, 
            fontSize: 11, fontWeight: 800, fontFamily: 'Space Mono', cursor: 'pointer' 
          }}
        >
          <Save size={16} />
          {isSaving ? 'SAVING...' : 'SAVE_CHANGES'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 40, alignItems: 'flex-start' }}>
        {/* Navigation Sidebar */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id as any)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
                  background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                  border: 'none', borderRadius: 8,
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', fontFamily: 'Space Mono',
                  textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                <tab.icon size={14} color={isActive ? '#fff' : 'rgba(255,255,255,0.2)'} />
                {tab.label}
              </button>
            );
          })}
        </aside>

        {/* Main Editor Surface */}
        <main>
          <LiquidMetalCard variant="dark" style={{ minHeight: 600, padding: 48 }}>
            {activeTab === 'DETAILS' && (
              <div style={{ maxWidth: 600 }}>
                <SubTitle>IDENTIFICATION</SubTitle>
                <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 32 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 12, fontFamily: 'Space Mono' }}>CHALLENGE_TITLE</label>
                    <input 
                      value={challenge.title}
                      onChange={e => setChallenge({...challenge, title: e.target.value})}
                      style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 12, fontFamily: 'Space Mono' }}>CANDIDATE_INSTRUCTIONS</label>
                    <textarea 
                      value={challenge.instructions || ''}
                      onChange={e => setChallenge({...challenge, instructions: e.target.value})}
                      style={{ width: '100%', height: 200, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', color: '#fff', fontSize: 13, outline: 'none', resize: 'none', lineHeight: 1.6 }}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'CONTENT' && (
              <div>
                <SubTitle>CHALLENGE_CONTENT</SubTitle>
                <div style={{ marginTop: 32 }}>
                  {/* Specialized editor would go here based on challenge.type */}
                  <div style={{ padding: 40, border: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center' }}>
                    <AlertCircle size={24} color="rgba(255,255,255,0.2)" style={{ marginBottom: 16 }} />
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>
                      CONTENT_EDITOR_FOR_{challenge.type}_COMING_SOON
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'SCORING' && (
              <div>
                <SubTitle>SCORING_&_RUBRIC</SubTitle>
                <div style={{ marginTop: 32 }}>
                  <div style={{ padding: 40, border: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center' }}>
                    <Shield size={24} color="rgba(255,255,255,0.2)" style={{ marginBottom: 16 }} />
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>
                      SCORING_CONFIGURATION_COMING_SOON
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'PREVIEW' && (
              <div>
                <SubTitle>CANDIDATE_PREVIEW</SubTitle>
                <div style={{ marginTop: 32, opacity: 0.8 }}>
                  <ChallengeRenderer 
                    type={challenge.type as any} 
                    config={typeof challenge.config === 'string' ? JSON.parse(challenge.config) : challenge.config}
                    context={{ codeArtifact: (challenge as any).codeArtifact }}
                    onSubmissionChange={() => {}}
                  />
                </div>
              </div>
            )}
          </LiquidMetalCard>
        </main>
      </div>
    </div>
  );
}
