import { Shield, ChevronDown, Github, ExternalLink, RefreshCw, FileText, MessageSquare } from 'lucide-react';
import { GitHubPRFetcherV2 } from '../Assessment/GitHubPRFetcherV2';
import { GroundTruthAnnotationEditor } from '../Assessment/GroundTruthAnnotationEditor';
import { LiquidMetalCard, SubTitle } from '../../components';
import { FollowUpConfiguration } from './FollowUpConfiguration';
import type { EditorFormProps } from './types';

interface CodeReviewEditorProps extends EditorFormProps {
  prFetched: boolean;
  onPrFetchedChange: (v: boolean) => void;
  groundTruthAnnotations: Record<string, unknown[]>;
  onGroundTruthChange: (v: Record<string, unknown[]>) => void;
}

export function CodeReviewEditor({
  challenge,
  onChange,
  prFetched,
  onPrFetchedChange,
  groundTruthAnnotations,
  onGroundTruthChange,
}: CodeReviewEditorProps): JSX.Element {
  const hasFollowUp = !!challenge.config?.enableFollowUp;

  const setConfig = (patch: Record<string, unknown>) => 
    onChange({ ...challenge, config: { ...challenge.config, ...patch } });

  const handlePRFetched = (prData: {
    githubRepoUrl: string;
    githubPrNumber: number;
    githubPrTitle: string;
    githubPrDescription: string;
    cachedDiffJson: unknown;
    cachedMetadata: unknown;
  }) => {
    onChange({
      ...challenge,
      githubRepoUrl: prData.githubRepoUrl,
      githubPrNumber: prData.githubPrNumber,
      githubPrTitle: prData.githubPrTitle,
      githubPrDescription: prData.githubPrDescription,
      cachedDiffJson: prData.cachedDiffJson,
      cachedMetadata: prData.cachedMetadata,
      diffCachedAt: new Date().toISOString(),
      instructions: challenge.instructions || `Review the following Pull Request: ${prData.githubPrTitle}\n\n${prData.githubPrDescription}`
    });
    onPrFetchedChange(true);
  };

  const sidebarSection = (title: string, icon: any, children: React.ReactNode) => (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ color: 'rgba(255,255,255,0.4)' }}>{icon}</div>
        <SubTitle>{title}</SubTitle>
      </div>
      {children}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 40, marginTop: 24, alignItems: "start" }}>
      
      {/* MAIN CONTENT AREA */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        
        <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
            <div style={{ padding: '32px 40px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 16 }}>
               <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fbbf24' }}>
                  <Github size={20} />
               </div>
               <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Connect Source Pull Request</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>STEP_1:_FETCH_GITHUB_PR</div>
               </div>
            </div>
            <div style={{ padding: '40px' }}>
              <GitHubPRFetcherV2
                initialRepoUrl={challenge.githubRepoUrl || ''}
                initialPrNumber={challenge.githubPrNumber || 0}
                showCached={prFetched}
                cachedTitle={challenge.githubPrTitle}
                cachedAuthor={typeof challenge.cachedMetadata === 'object' && challenge.cachedMetadata !== null ? (challenge.cachedMetadata as Record<string, unknown>)['author'] as string | undefined : undefined}
                cachedRepoUrl={challenge.githubRepoUrl}
                cachedPrNumber={challenge.githubPrNumber}
                onPRFetched={handlePRFetched}
                onCleared={() => {
                  onChange({
                    ...challenge,
                    githubRepoUrl: undefined,
                    githubPrNumber: undefined,
                    githubPrTitle: undefined,
                    githubPrDescription: undefined,
                    cachedDiffJson: undefined,
                    cachedMetadata: undefined,
                  });
                  onPrFetchedChange(false);
                }}
              />
            </div>
          </LiquidMetalCard>

        {prFetched && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {/* Instructions */}
            <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
              <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <FileText size={16} color="#fbbf24" />
                  <SubTitle>CHALLENGE_INSTRUCTIONS</SubTitle>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Github size={12} color="rgba(255,255,255,0.2)" />
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Mono' }}>SOURCE_SYNCED</span>
                </div>
              </div>
              <div style={{ padding: '32px' }}>
                <textarea
                  value={challenge.instructions || ''}
                  onChange={(e) => onChange({ ...challenge, instructions: e.target.value })}
                  placeholder="Markdown instructions for the candidate..."
                  style={{
                    width: '100%', minHeight: 200, padding: '24px', background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#fff', fontSize: 15, fontFamily: 'inherit',
                    lineHeight: 1.7, outline: 'none', resize: 'vertical',
                  }}
                />
              </div>
            </LiquidMetalCard>

            {/* Annotations / Questions */}
            <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
              <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <MessageSquare size={16} color="#4ade80" />
                  <SubTitle>EXPECTED_FINDINGS_&_QUESTIONS</SubTitle>
                </div>
              </div>
              <div style={{ padding: '32px' }}>
                <GroundTruthAnnotationEditor
                  initialAnnotations={groundTruthAnnotations}
                  onAnnotationsChange={onGroundTruthChange}
                />
              </div>
            </LiquidMetalCard>
          </div>
        )}
      </div>

      {/* CONFIGURATION SIDEBAR */}
      <aside>
        <LiquidMetalCard variant="chrome" style={{ padding: 32, borderRadius: 16 }}>
          
          {prFetched && (
            <div style={{ marginBottom: 40, paddingBottom: 32, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <Github size={14} color="rgba(255,255,255,0.4)" />
                <SubTitle>SOURCE_PR</SubTitle>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '16px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                  {challenge.githubPrTitle}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono', marginBottom: 12 }}>
                  #{challenge.githubPrNumber} • {challenge.githubRepoUrl?.split('/').pop()}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                   <a 
                    href={`${challenge.githubRepoUrl}/pull/${challenge.githubPrNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
                      color: '#fff', padding: '8px', borderRadius: 4, fontSize: 9,
                      fontFamily: 'Space Mono', cursor: 'pointer', textDecoration: 'none'
                    }}
                  >
                    <ExternalLink size={10} /> VIEW
                  </a>
                  <button 
                    onClick={() => onPrFetchedChange(false)}
                    style={{ 
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.6)', padding: '8px', borderRadius: 4, fontSize: 9,
                      fontFamily: 'Space Mono', cursor: 'pointer'
                    }}
                  >
                    <RefreshCw size={10} /> CHANGE
                  </button>
                </div>
              </div>
            </div>
          )}

          {sidebarSection('AI_FOLLOW_UP', <ChevronDown size={14} />, (
            <FollowUpConfiguration
              enabled={hasFollowUp}
              onChange={(val) => setConfig({ enableFollowUp: val })}
              accentColor="#fff"
            />
          ))}

          {sidebarSection('SCORING_LOGIC', <Shield size={14} />, (
            <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'Space Mono', lineHeight: 1.6 }}>
                Candidates are scored based on how many "Ground Truth" annotations they identify. 
              </div>
            </div>
          ))}

        </LiquidMetalCard>
      </aside>
    </div>
  );
}
