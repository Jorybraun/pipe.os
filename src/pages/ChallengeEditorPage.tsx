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
import { ChallengeRegistry } from '../components/Assessment/ChallengeRegistry';
import { TimerProvider } from '../components/Assessment/TimerContext';

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
                    <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 12, fontFamily: 'Space Mono' }}>TIME_LIMIT_OVERRIDE (MINS)</label>
                    <input 
                      type="number"
                      value={(() => {
                        const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                        return config.timeLimit || '';
                      })()}
                      onChange={e => {
                        const val = e.target.value ? parseInt(e.target.value) : null;
                        const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                        setChallenge({
                          ...challenge,
                          config: JSON.stringify({ ...config, timeLimit: val })
                        });
                      }}
                      placeholder="Inherit from stage"
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
                  {challenge.type === 'CODE_REVIEW' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 12, fontFamily: 'Space Mono' }}>BUGGY_CODE_SNIPPET</label>
                        <textarea 
                          value={(() => {
                            const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                            return config.code || '';
                          })()}
                          onChange={e => {
                            const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                            setChallenge({
                              ...challenge,
                              config: JSON.stringify({ ...config, code: e.target.value })
                            });
                          }}
                          style={{ width: '100%', height: 400, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', color: '#60a5fa', fontSize: 13, outline: 'none', resize: 'none', lineHeight: 1.6, fontFamily: 'Space Mono' }}
                        />
                      </div>
                    </div>
                  )}

                  {challenge.type === 'QUIZ_MCQ' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 12, fontFamily: 'Space Mono' }}>QUESTION_TEXT</label>
                        <textarea 
                          value={(() => {
                            const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                            return config.question || '';
                          })()}
                          onChange={e => {
                            const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                            setChallenge({
                              ...challenge,
                              config: JSON.stringify({ ...config, question: e.target.value })
                            });
                          }}
                          placeholder="Enter the quiz question here..."
                          style={{ width: '100%', height: 100, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none', resize: 'none', lineHeight: 1.5 }}
                        />
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono' }}>ANSWER_OPTIONS</label>
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Mono' }}>SELECT_CORRECT_ANSWER</div>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {(() => {
                            const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                            const options = config.options || [];
                            const correctId = config.correctOptionId;

                            // Auto-initialize if empty
                            if (options.length === 0) {
                              const initialOptions = [
                                { id: 'a', text: '' },
                                { id: 'b', text: '' },
                                { id: 'c', text: '' },
                                { id: 'd', text: '' }
                              ];
                              setTimeout(() => {
                                setChallenge({
                                  ...challenge,
                                  config: JSON.stringify({ ...config, options: initialOptions })
                                });
                              }, 0);
                              return null;
                            }

                            return (
                              <>
                                {options.map((opt: any, idx: number) => (
                                  <div key={opt.id || idx} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                    <button 
                                      onClick={() => {
                                        setChallenge({
                                          ...challenge,
                                          config: JSON.stringify({ ...config, correctOptionId: opt.id })
                                        });
                                      }}
                                      title="Mark as correct answer"
                                      style={{ 
                                        width: 24, height: 24, borderRadius: '50%', 
                                        background: correctId === opt.id ? '#4ade80' : 'transparent',
                                        border: `2px solid ${correctId === opt.id ? '#4ade80' : 'rgba(255,255,255,0.1)'}`,
                                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.2s'
                                      }}
                                    >
                                      {correctId === opt.id && <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#000' }} />}
                                    </button>
                                    
                                    <div style={{ 
                                      width: 24, fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Mono' 
                                    }}>
                                      {opt.id.toUpperCase()}
                                    </div>

                                    <input 
                                      value={opt.text}
                                      onChange={e => {
                                        const newOptions = [...options];
                                        newOptions[idx] = { ...opt, text: e.target.value };
                                        setChallenge({
                                          ...challenge,
                                          config: JSON.stringify({ ...config, options: newOptions })
                                        });
                                      }}
                                      placeholder={`Option ${opt.id.toUpperCase()} text...`}
                                      style={{ flex: 1, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', color: '#fff', fontSize: 13, outline: 'none', borderRadius: 4 }}
                                    />
                                    
                                    <button 
                                      onClick={() => {
                                        const newOptions = options.filter((_: any, i: number) => i !== idx);
                                        setChallenge({
                                          ...challenge,
                                          config: JSON.stringify({ ...config, options: newOptions })
                                        });
                                      }}
                                      style={{ background: 'none', border: 'none', color: 'rgba(255,80,80,0.3)', cursor: 'pointer', padding: 8 }}
                                    >
                                      <Shield size={14} />
                                    </button>
                                  </div>
                                ))}
                                <button 
                                  onClick={() => {
                                    const nextId = String.fromCharCode(97 + options.length);
                                    const newOptions = [...options, { id: nextId, text: '' }];
                                    setChallenge({
                                      ...challenge,
                                      config: JSON.stringify({ ...config, options: newOptions })
                                    });
                                  }}
                                  style={{ marginTop: 8, padding: '10px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: 700, fontFamily: 'Space Mono', cursor: 'pointer', alignSelf: 'flex-start' }}
                                >
                                  + ADD_OPTION
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 12, fontFamily: 'Space Mono' }}>EXPLANATION (SHOWN AFTER SUBMISSION)</label>
                        <textarea 
                          value={(() => {
                            const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                            return config.explanation || '';
                          })()}
                          onChange={e => {
                            const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                            setChallenge({
                              ...challenge,
                              config: JSON.stringify({ ...config, explanation: e.target.value })
                            });
                          }}
                          placeholder="Provide context for why the correct answer is right..."
                          style={{ width: '100%', height: 80, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', color: '#fff', fontSize: 13, outline: 'none', resize: 'none', borderRadius: 4, lineHeight: 1.5 }}
                        />
                      </div>
                    </div>
                  )}

                  {challenge.type === 'QUIZ_SHORT_ANSWER' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 12, fontFamily: 'Space Mono' }}>QUESTION_PROMPT</label>
                        <textarea 
                          value={(() => {
                            const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                            return config.question || '';
                          })()}
                          onChange={e => {
                            const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                            setChallenge({
                              ...challenge,
                              config: JSON.stringify({ ...config, question: e.target.value })
                            });
                          }}
                          style={{ width: '100%', height: 120, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none', resize: 'none' }}
                        />
                      </div>
                    </div>
                  )}

                  {challenge.type === 'CODE_IMPLEMENTATION' && (
                    <div style={{ padding: 40, border: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center' }}>
                      <AlertCircle size={24} color="rgba(255,255,255,0.2)" style={{ marginBottom: 16 }} />
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>
                        CODE_IMPLEMENTATION_EDITOR_COMING_SOON
                      </div>
                      <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 8 }}>Templates are pre-configured. Edit instructions in the DETAILS tab.</p>
                    </div>
                  )}
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
                  <TimerProvider>
                    <ChallengeRegistry 
                      challenge={challenge as any}
                      onSubmissionChange={() => {}}
                      onSubmit={() => {}}
                    />
                  </TimerProvider>
                </div>
              </div>
            )}
          </LiquidMetalCard>
        </main>
      </div>
    </div>
  );
}
