import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload,
  FileText,
  Loader2,
  ChevronRight,
  Github,
  Linkedin,
  CheckCircle,
  Mail,
  AlertCircle,
  Brain,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  resolveToken,
  getStageConfig,
  getIngestionStatus,
  uploadResume,
  submitChallengeResponse,
  type ResolveTokenResponse,
  type StageConfigResponse,
  type IngestionStatusResponse,
} from '../lib/api';

type Phase = 'loading' | 'intake' | 'submitting' | 'ingesting' | 'complete' | 'error';

const INGESTION_STEPS: Array<{ step: string; label: string; icon: typeof Brain }> = [
  { step: 'upsert_pending', label: 'Preparing ingestion', icon: FileText },
  { step: 'discover_profile', label: 'Analyzing your profile', icon: Brain },
  { step: 'persist_profile', label: 'Saving profile data', icon: CheckCircle },
  { step: 'decompose_resume', label: 'Decomposing resume into graph nodes', icon: Sparkles },
  { step: 'embed_profile', label: 'Embedding profile for matching', icon: Search },
  { step: 'match_and_assign', label: 'Matching to open-source challenges', icon: Github },
];

function stepIndex(currentStep: string | null): number {
  if (!currentStep) return -1;
  return INGESTION_STEPS.findIndex((s) => s.step === currentStep);
}

export function IntakePage(): JSX.Element {
  const { inviteToken } = useParams();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ResolveTokenResponse | null>(null);
  const [stageConfig, setStageConfig] = useState<StageConfigResponse | null>(null);
  const [ingestion, setIngestion] = useState<IngestionStatusResponse | null>(null);

  // Form state
  const [file, setFile] = useState<File | null>(null);
  const [resumeR2Key, setResumeR2Key] = useState('');
  const [githubHandle, setGithubHandle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resolvedRef = useRef(false);

  // Resolve token on mount
  useEffect(() => {
    if (!inviteToken) {
      setError('No invite token provided. Please use the link from your email.');
      setPhase('error');
      return;
    }

    if (resolvedRef.current) return;
    resolvedRef.current = true;

    (async () => {
      try {
        const result = await resolveToken(inviteToken);
        setSession(result);

        const config = await getStageConfig(result.sessionToken);
        setStageConfig(config);

        if (config.isComplete) {
          setPhase('complete');
        } else {
          setPhase('intake');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load intake form');
        setPhase('error');
      }
    })();
  }, [inviteToken]);

  // Poll ingestion status when in ingesting phase
  useEffect(() => {
    if (phase !== 'ingesting' || !session) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const status = await getIngestionStatus(session.sessionToken);
        if (cancelled) return;
        setIngestion(status);

        if (status.status === 'matched' || status.status === 'embedded') {
          setPhase('complete');
          return;
        }
        if (status.status === 'failed') {
          setError(status.error_text || 'Ingestion failed. Please try again or contact support.');
          setPhase('error');
          return;
        }

        setTimeout(poll, 3000);
      } catch {
        if (!cancelled) setTimeout(poll, 5000);
      }
    };

    void poll();
    return () => { cancelled = true; };
  }, [phase, session]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (
        selectedFile.type === 'application/pdf' ||
        selectedFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        setFile(selectedFile);
        setUploadError(null);
        void doUpload(selectedFile);
      } else {
        setUploadError('Only .pdf and .docx files are supported.');
      }
    }
  };

  const doUpload = useCallback(async (selectedFile: File) => {
    if (!session) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const result = await uploadResume(session.sessionToken, selectedFile, 'intake-upload');
      setResumeR2Key(result.r2Key);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setFile(null);
    } finally {
      setIsUploading(false);
    }
  }, [session]);

  const validateGithub = (handle: string): boolean => {
    if (!handle) return true;
    return /^[a-zA-Z0-9-]{1,39}$/.test(handle);
  };

  const validateLinkedIn = (url: string): boolean => {
    if (!url) return true;
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'www.linkedin.com' || parsed.hostname === 'linkedin.com';
    } catch {
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!session || !stageConfig) return;
    setError(null);

    if (!resumeR2Key) {
      setError('Please upload your resume.');
      return;
    }

    if (githubHandle && !validateGithub(githubHandle)) {
      setError('Invalid GitHub handle. Must be 1-39 characters, alphanumeric or hyphens only.');
      return;
    }

    if (linkedinUrl && !validateLinkedIn(linkedinUrl)) {
      setError('Invalid LinkedIn URL.');
      return;
    }

    setPhase('submitting');
    try {
      await submitChallengeResponse(session.sessionToken, 0, {
        resumeR2Key,
        ...(githubHandle.trim() ? { githubHandle: githubHandle.trim() } : {}),
        ...(linkedinUrl.trim() ? { linkedinUrl: linkedinUrl.trim() } : {}),
      });
      setPhase('ingesting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
      setPhase('intake');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <Shell>
        <div style={centerStyle}>
          <Loader2 size={28} className="spin" color="var(--pipe-text-dim)" />
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginTop: 16, fontFamily: '"Space Mono", monospace' }}>
            LOADING_INTAKE...
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'error') {
    return (
      <Shell>
        <div style={centerStyle}>
          <Card style={{ maxWidth: 440 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12, color: '#ef4444', lineHeight: 1.7, fontFamily: '"Space Mono", monospace' }}>
                {error}
              </div>
            </div>
          </Card>
        </div>
      </Shell>
    );
  }

  if (phase === 'complete') {
    return (
      <Shell>
        <div style={centerStyle}>
          <Card style={{ maxWidth: 'min(480px, 100%)', padding: 'clamp(24px, 4vw, 48px)' }} className="fade-in">
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 28 }}>
              INTAKE_PROTOCOL
            </div>

            <h1 style={{ fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 800, color: 'var(--pipe-text)', marginBottom: 12, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              Intake Complete
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, padding: '12px 14px', background: 'var(--pipe-surface)', border: '1px solid var(--pipe-border-light)', borderRadius: 6 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 4,
                background: 'rgba(34, 197, 94, 0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <CheckCircle size={14} color="#22c55e" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace' }}>
                  {session?.name || 'Candidate'}
                </div>
                {session && (
                  <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace' }}>
                    Candidate ID: {session.id}
                  </div>
                )}
              </div>
            </div>

            <div style={{
              padding: '12px 14px', background: 'rgba(34, 197, 94, 0.06)',
              border: '1px solid rgba(34, 197, 94, 0.15)', borderRadius: 6,
              display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 28,
            }}>
              <Mail size={14} color="#22c55e" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', fontFamily: '"Space Mono", monospace', letterSpacing: '0.08em', marginBottom: 4 }}>
                  STATUS
                </div>
                <div style={{ fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.6, fontFamily: '"Space Mono", monospace' }}>
                  {ingestion?.status === 'matched'
                    ? 'We found a matching challenge for you. You will receive an email with your challenge link shortly.'
                    : 'Your profile has been received and analyzed. We will reach out when a matching opportunity comes up.'}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </Shell>
    );
  }

  if (phase === 'submitting') {
    return (
      <Shell>
        <div style={centerStyle}>
          <Loader2 size={28} className="spin" color="var(--pipe-text-dim)" />
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginTop: 16, fontFamily: '"Space Mono", monospace' }}>
            SUBMITTING_INTAKE...
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'ingesting') {
    const currentIdx = stepIndex(ingestion?.current_step ?? null);
    return (
      <Shell>
        <div style={centerStyle}>
          <Card style={{ maxWidth: 'min(520px, 100%)', padding: 'clamp(24px, 4vw, 48px)' }} className="fade-in">
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 28 }}>
              INGESTION_PROTOCOL
            </div>

            <h1 style={{ fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 800, color: 'var(--pipe-text)', marginBottom: 12, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              Analyzing Your Profile
            </h1>

            <p style={{ fontSize: 'clamp(11px, 1.2vw, 13px)', color: 'var(--pipe-text-muted)', lineHeight: 1.7, fontFamily: '"Space Mono", monospace', marginBottom: 28 }}>
              We are decomposing your resume, building a candidate graph,
              and matching you to the best open-source challenges.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {INGESTION_STEPS.map((step, idx) => {
                const isDone = currentIdx > idx || ingestion?.status === 'matched' || ingestion?.status === 'embedded';
                const isActive = currentIdx === idx;
                const isPending = !isDone && !isActive;
                const Icon = step.icon;

                return (
                  <div
                    key={step.step}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12,
                      padding: 'clamp(10px, 1.5vw, 14px) clamp(12px, 2vw, 16px)',
                      background: isActive ? 'var(--pipe-surface-hover)' : 'var(--pipe-surface)',
                      border: `1px solid ${isActive ? 'var(--pipe-accent-border)' : 'var(--pipe-border-light)'}`,
                      borderRadius: 6,
                      opacity: isPending ? 0.4 : 1,
                      transition: 'all 0.3s ease',
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isDone ? 'rgba(34, 197, 94, 0.1)' : isActive ? 'var(--pipe-accent-surface)' : 'var(--pipe-surface-hover)',
                      flexShrink: 0,
                    }}>
                      {isDone ? (
                        <CheckCircle size={14} color="#22c55e" />
                      ) : isActive ? (
                        <Loader2 size={14} className="spin" color="var(--pipe-accent)" />
                      ) : (
                        <Icon size={14} color="var(--pipe-text-dim)" />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 'clamp(11px, 1.2vw, 13px)', fontWeight: 700,
                        color: isDone ? '#22c55e' : isActive ? 'var(--pipe-accent)' : 'var(--pipe-text-dim)',
                        fontFamily: '"Space Mono", monospace',
                      }}>
                        {step.label}
                      </div>
                      {isActive && (
                        <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginTop: 2, fontFamily: '"Space Mono", monospace' }} className="pulse">
                          In progress...
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {ingestion?.estimated_completion_at && (
              <div style={{ textAlign: 'center', marginTop: 16, fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                Estimated completion: {new Date(ingestion.estimated_completion_at).toLocaleTimeString()}
              </div>
            )}
          </Card>
        </div>
      </Shell>
    );
  }

  // ── Intake form ───────────────────────────────────────────────────────────

  return (
    <Shell>
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 'clamp(16px, 4vw, 40px)', overflowY: 'auto', boxSizing: 'border-box',
      }}>
        <Card style={{ maxWidth: 'min(640px, 100%)', width: '100%', padding: 'clamp(24px, 4vw, 48px)' }} className="fade-in">
          {/* Header meta */}
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 28 }}>
            CANDIDATE_INTAKE_PROTOCOL
          </div>

          {/* Headline */}
          <h1 style={{ fontSize: 'clamp(22px, 3vw, 30px)', fontWeight: 800, color: 'var(--pipe-text)', marginBottom: 12, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            {stageConfig?.stageTitle || 'Upload Your CV'}
          </h1>

          {/* Description */}
          <p style={{ fontSize: 'clamp(12px, 1.4vw, 14px)', color: 'var(--pipe-text-muted)', lineHeight: 1.7, fontFamily: '"Space Mono", monospace', marginBottom: 32 }}>
            Upload your resume so we can learn about your background and find the best challenges for you.
          </p>

          {/* Upcoming challenges preview */}
          {stageConfig?.upcoming && stageConfig.upcoming.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', fontWeight: 700, marginBottom: 14 }}>
                WHAT TO EXPECT
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {stageConfig.upcoming.map((u, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: 'clamp(10px, 1.5vw, 14px) clamp(12px, 2vw, 16px)',
                    background: 'var(--pipe-surface)', border: '1px solid var(--pipe-border-light)', borderRadius: 6,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 4,
                      background: 'var(--pipe-surface-hover)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--pipe-text-muted)', flexShrink: 0,
                    }}>
                      <ChevronRight size={14} />
                    </div>
                    <div style={{ fontSize: 'clamp(11px, 1.2vw, 13px)', fontWeight: 700, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace' }}>
                      {u.title}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upload zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `1px dashed ${file ? 'rgba(34, 197, 94, 0.3)' : 'var(--pipe-border)'}`,
              borderRadius: 6,
              padding: 'clamp(20px, 3vw, 32px) 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: file ? 'rgba(34, 197, 94, 0.03)' : 'var(--pipe-surface)',
              transition: 'all 0.2s ease',
              marginBottom: 20,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {isUploading ? (
              <>
                <Loader2 size={20} className="spin" color="var(--pipe-accent)" />
                <div style={{ fontSize: 11, color: 'var(--pipe-accent)', marginTop: 10, fontFamily: '"Space Mono", monospace' }}>UPLOADING...</div>
              </>
            ) : file ? (
              <>
                <FileText size={20} color="#22c55e" />
                <div style={{ fontSize: 12, color: '#22c55e', marginTop: 10, fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
                  {file.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginTop: 4, fontFamily: '"Space Mono", monospace' }}>
                  Click to replace
                </div>
              </>
            ) : (
              <>
                <Upload size={20} color="var(--pipe-text-dim)" />
                <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)', marginTop: 10, fontFamily: '"Space Mono", monospace' }}>
                  Drop your resume here or click to browse
                </div>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginTop: 4, fontFamily: '"Space Mono", monospace' }}>
                  .pdf or .docx · max 10MB
                </div>
              </>
            )}
          </div>

          {uploadError && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '12px 14px', background: 'rgba(239, 68, 68, 0.06)',
              border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: 6, marginBottom: 20,
            }}>
              <AlertCircle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 11, color: '#ef4444', fontFamily: '"Space Mono", monospace', lineHeight: 1.6 }}>
                {uploadError}
              </div>
            </div>
          )}

          {/* GitHub handle */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.2em', display: 'block', marginBottom: 10, fontFamily: '"Space Mono", monospace', fontWeight: 700 }}>
              GITHUB_HANDLE (OPTIONAL)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 4, background: 'var(--pipe-surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Github size={14} color="var(--pipe-text-muted)" />
              </div>
              <input
                type="text"
                value={githubHandle}
                onChange={(e) => setGithubHandle(e.target.value)}
                onBlur={() => setGithubHandle((prev) => prev.replace(/^@/, ''))}
                placeholder="your-github-username"
                style={inputStyle}
              />
            </div>
          </div>

          {/* LinkedIn URL */}
          <div style={{ marginBottom: 28 }}>
            <label style={{ fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.2em', display: 'block', marginBottom: 10, fontFamily: '"Space Mono", monospace', fontWeight: 700 }}>
              LINKEDIN_URL (OPTIONAL)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 4, background: 'var(--pipe-surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Linkedin size={14} color="var(--pipe-text-muted)" />
              </div>
              <input
                type="url"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://linkedin.com/in/your-profile"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '12px 14px', background: 'rgba(239, 68, 68, 0.06)',
              border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: 6, marginBottom: 28,
            }}>
              <AlertCircle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 11, color: '#ef4444', fontFamily: '"Space Mono", monospace', lineHeight: 1.6 }}>
                {error}
              </div>
            </div>
          )}

          {/* Separator */}
          <div style={{ borderTop: '1px solid var(--pipe-border)', marginBottom: 28 }} />

          {/* Submit button */}
          <button
            onClick={() => void handleSubmit()}
            disabled={!resumeR2Key || isUploading}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '16px 24px',
              background: resumeR2Key ? '#fff' : 'var(--pipe-surface)',
              color: resumeR2Key ? '#000' : 'var(--pipe-text-dim)',
              border: 'none', borderRadius: 4,
              fontSize: 12, fontWeight: 800, letterSpacing: '0.12em',
              fontFamily: '"Space Mono", monospace',
              cursor: resumeR2Key ? 'pointer' : 'not-allowed',
              transition: 'opacity 0.15s',
              opacity: resumeR2Key ? 1 : 0.5,
            }}
            onMouseEnter={(e) => { if (resumeR2Key) (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
            onMouseLeave={(e) => { if (resumeR2Key) (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          >
            SUBMIT_INTAKE
            <ChevronRight size={16} />
          </button>
        </Card>
      </div>
    </Shell>
  );
}

// ── Shell with pipe-blue background ─────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <>
      <div className="pipe-bg-glow" />
      <div className="pipe-mesh-grid" />
      <div className="pipe-content">{children}</div>
    </>
  );
}

// ── LiquidMetalCard equivalent ──────────────────────────────────────────────

function Card({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }): JSX.Element {
  return (
    <div
      className={className}
      style={{
        background: 'linear-gradient(135deg, var(--pipe-surface-solid-hover) 0%, var(--pipe-surface-elevated) 42%, var(--pipe-surface-solid) 100%)',
        border: '1px solid var(--pipe-border)',
        color: 'var(--pipe-text)',
        borderRadius: 6,
        position: 'relative',
        transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: '0 18px 52px var(--pipe-shadow)',
        backdropFilter: 'blur(22px) saturate(120%)',
        WebkitBackdropFilter: 'blur(22px) saturate(120%)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const centerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'clamp(16px, 4vw, 40px)',
  boxSizing: 'border-box',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  padding: '10px 14px',
  color: 'var(--pipe-text)',
  fontSize: 13,
  fontFamily: '"Space Mono", monospace',
  outline: 'none',
  transition: 'border-color 0.2s ease',
};

// ── Hooks shim ──────────────────────────────────────────────────────────────

import { useParams } from 'react-router-dom';
