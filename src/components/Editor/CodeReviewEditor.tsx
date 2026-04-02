import { useState, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { Shield, ChevronDown, Github, ExternalLink, RefreshCw, FileText, MessageSquare, GitBranch, HelpCircle, Loader } from 'lucide-react';
import { GitHubPRFetcherV2 } from '../Assessment/GitHubPRFetcherV2';
import { GroundTruthAnnotationEditor } from '../Assessment/GroundTruthAnnotationEditor';
import { DiffPanel, type DiffJson } from '../Assessment/DiffPanel';
import { LiquidMetalCard, SubTitle } from '../../components';
import { FollowUpConfiguration } from './FollowUpConfiguration';
import type { EditorFormProps } from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert the Worker's stored diff format → DiffPanel format */
function parseDiffJson(raw: unknown): DiffJson | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as {
    files?: Array<{
      path?: string;
      filename?: string;
      status: string;
      additions: number;
      deletions: number;
      hunks: Array<{
        header: string;
        lines: Array<{ type: string; lineNumber?: number; num?: number; content: string }>;
      }>;
    }>;
  };
  if (!r.files?.length) return null;

  const mapType = (t: string): 'addition' | 'deletion' | 'context' => {
    if (t === 'added' || t === 'addition') return 'addition';
    if (t === 'removed' || t === 'deletion') return 'deletion';
    return 'context';
  };

  return {
    files: r.files.map((f) => ({
      path: f.path ?? f.filename ?? 'unknown',
      status: f.status as 'added' | 'modified' | 'deleted',
      additions: f.additions,
      deletions: f.deletions,
      hunks: f.hunks.map((h) => ({
        header: h.header,
        lines: h.lines.map((l, idx) => ({
          type: mapType(l.type),
          num: l.lineNumber ?? l.num ?? (idx + 1),
          content: l.content,
        })),
      })),
    })),
    stats: {
      filesChanged: r.files.length,
      additions: r.files.reduce((s, f) => s + f.additions, 0),
      deletions: r.files.reduce((s, f) => s + f.deletions, 0),
    },
  };
}

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
  const { getToken } = useClerkAuth();
  const hasFollowUp = !!challenge.config?.enableFollowUp;
  const parsedDiff = prFetched ? parseDiffJson(challenge.cachedDiffJson) : null;
  const [isGeneratingContext, setIsGeneratingContext] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const setConfig = (patch: Record<string, unknown>) =>
    onChange({ ...challenge, config: { ...challenge.config, ...patch } });

  const setServerConfig = (patch: Record<string, unknown>) =>
    onChange({ ...challenge, serverConfig: { ...(challenge.serverConfig as Record<string, unknown> ?? {}), ...patch } });

  /** Fetch repo context from GitHub + AI and populate repoKnowledge */
  const generateRepoContext = useCallback(async (repoUrl: string, prNumber: number): Promise<void> => {
    setIsGeneratingContext(true);
    setContextError(null);
    try {
      const token = await getToken();
      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) authHeaders['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/v1/github/repo-context`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ repoUrl, prNumber }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as { success: boolean; data: { repoKnowledge: unknown } };
      if (result.success && result.data.repoKnowledge) {
        setServerConfig({ repoKnowledge: result.data.repoKnowledge });
        setConfig({ enableExplainer: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate context';
      setContextError(msg);
      console.error('[CodeReviewEditor] repo context generation failed:', msg);
    } finally {
      setIsGeneratingContext(false);
    }
  }, [getToken, setServerConfig, setConfig]);

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

    // Auto-generate explainer context in the background
    generateRepoContext(prData.githubRepoUrl, prData.githubPrNumber);
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
            <div style={{ padding: '32px 40px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', alignItems: 'center', gap: 16 }}>
               <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fbbf24' }}>
                  <Github size={20} />
               </div>
               <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--pipe-text, #fff)', marginBottom: 4 }}>Connect Source Pull Request</div>
                  <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>STEP_1:_FETCH_GITHUB_PR</div>
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
              <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <FileText size={16} color="#fbbf24" />
                  <SubTitle>CHALLENGE_INSTRUCTIONS</SubTitle>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Github size={12} color="var(--pipe-text-dim)" />
                  <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>SOURCE_SYNCED</span>
                </div>
              </div>
              <div style={{ padding: '32px' }}>
                <textarea
                  value={challenge.instructions || ''}
                  onChange={(e) => onChange({ ...challenge, instructions: e.target.value })}
                  placeholder="Markdown instructions for the candidate..."
                  style={{
                    width: '100%', minHeight: 200, padding: '24px', background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--pipe-border)', borderRadius: 8, color: 'var(--pipe-text, #fff)', fontSize: 15, fontFamily: 'inherit',
                    lineHeight: 1.7, outline: 'none', resize: 'vertical',
                  }}
                />
              </div>
            </LiquidMetalCard>

            {/* Diff preview */}
            {parsedDiff && (
              <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
                <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <GitBranch size={16} color="#60a5fa" />
                  <SubTitle>DIFF_PREVIEW</SubTitle>
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
                    {parsedDiff.stats.filesChanged} file(s) · +{parsedDiff.stats.additions} -{parsedDiff.stats.deletions}
                  </span>
                </div>
                <div style={{ padding: '0 32px 32px' }}>
                  <DiffPanel diff={parsedDiff} readOnly={true} />
                </div>
              </LiquidMetalCard>
            )}

            {/* Annotations / Questions */}
            <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
              <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

            {/* Explainer Context */}
            {!!challenge.config?.enableExplainer && (
              <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
                <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <HelpCircle size={16} color="#60a5fa" />
                    <SubTitle>EXPLAINER_CONTEXT</SubTitle>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isGeneratingContext && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: '#60a5fa', fontFamily: 'Space Mono' }}>
                        <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> GENERATING...
                      </span>
                    )}
                    {!isGeneratingContext && challenge.githubRepoUrl && challenge.githubPrNumber && (
                      <button
                        onClick={() => generateRepoContext(challenge.githubRepoUrl as string, challenge.githubPrNumber as number)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          background: 'transparent', border: '1px solid var(--pipe-border)',
                          color: 'var(--pipe-text-muted)', padding: '4px 10px', borderRadius: 4,
                          fontSize: 9, fontFamily: 'Space Mono', cursor: 'pointer',
                        }}
                      >
                        <RefreshCw size={10} /> REGENERATE
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ padding: '32px' }}>
                  {contextError && (
                    <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: '#ef4444', fontSize: 12, marginBottom: 16 }}>
                      {contextError}
                    </div>
                  )}
                  {(() => {
                    const sc = challenge.serverConfig as Record<string, unknown> | undefined;
                    const rk = sc?.repoKnowledge as Record<string, unknown> | undefined;
                    if (!rk) {
                      return (
                        <div style={{ color: 'var(--pipe-text-dim)', fontSize: 12, fontFamily: 'Space Mono', textAlign: 'center', padding: 20 }}>
                          {isGeneratingContext ? 'Analyzing repository...' : 'No context yet — fetch a PR to auto-generate.'}
                        </div>
                      );
                    }
                    return (
                      <textarea
                        value={JSON.stringify(rk, null, 2)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value) as unknown;
                            setServerConfig({ repoKnowledge: parsed });
                          } catch {
                            // Let the user keep typing — only update on valid JSON
                          }
                        }}
                        style={{
                          width: '100%', minHeight: 300, padding: 16,
                          background: 'rgba(0,0,0,0.3)', border: '1px solid var(--pipe-border)',
                          borderRadius: 8, color: '#94a3b8', fontSize: 12,
                          fontFamily: 'monospace', lineHeight: 1.5, outline: 'none', resize: 'vertical',
                        }}
                      />
                    );
                  })()}
                  <div style={{ marginTop: 8, fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
                    This context powers the "Ask" tab — the AI PR author uses it to answer candidate questions about the codebase.
                  </div>
                </div>
              </LiquidMetalCard>
            )}
          </div>
        )}
      </div>

      {/* CONFIGURATION SIDEBAR */}
      <aside>
        <LiquidMetalCard variant="chrome" style={{ padding: 32, borderRadius: 16 }}>
          
          {prFetched && (
            <div style={{ marginBottom: 40, paddingBottom: 32, borderBottom: '1px solid var(--pipe-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <Github size={14} color="var(--pipe-text-dim)" />
                <SubTitle>SOURCE_PR</SubTitle>
              </div>
              <div style={{ background: 'var(--pipe-surface)', border: '1px solid var(--pipe-border)', borderRadius: 8, padding: '16px' }}>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', marginBottom: 12 }}>
                  PR #{challenge.githubPrNumber}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                   <a
                    href={`${challenge.githubRepoUrl}/pull/${challenge.githubPrNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: 'var(--pipe-surface-hover)', border: '1px solid var(--pipe-border)',
                      color: 'var(--pipe-text, #fff)', padding: '8px', borderRadius: 4, fontSize: 9,
                      fontFamily: 'Space Mono', cursor: 'pointer', textDecoration: 'none'
                    }}
                  >
                    <ExternalLink size={10} /> VIEW
                  </a>
                  <button
                    onClick={() => onPrFetchedChange(false)}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: 'transparent', border: '1px solid var(--pipe-border)',
                      color: 'var(--pipe-text-muted)', padding: '8px', borderRadius: 4, fontSize: 9,
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
            <div style={{ padding: '16px', background: 'var(--pipe-surface)', border: '1px solid var(--pipe-border)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: 'Space Mono', lineHeight: 1.6 }}>
                Candidates are scored on findings and conversation quality.
                {(challenge.config as Record<string, unknown> | undefined)?.enableExplainer
                  ? ' When explainer is enabled, question quality provides supplementary signal.'
                  : ''}
              </div>
            </div>
          ))}

        </LiquidMetalCard>
      </aside>
    </div>
  );
}
