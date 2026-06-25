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

    let cancelled = false;
    (async () => {
      try {
        const result = await resolveToken(inviteToken);
        if (cancelled) return;
        setSession(result);

        const config = await getStageConfig(result.sessionToken);
        if (cancelled) return;
        setStageConfig(config);

        if (config.isComplete) {
          setPhase('complete');
        } else {
          setPhase('intake');
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load intake form');
        setPhase('error');
      }
    })();

    return () => { cancelled = true; };
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
          <Loader2 size={32} className="spin" color="var(--pipe-accent)" />
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginTop: 16, fontFamily: 'var(--font-mono)' }}>
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
          <AlertCircle size={32} color="#ef4444" />
          <div style={{ fontSize: 13, color: '#ef4444', marginTop: 16, textAlign: 'center', maxWidth: 400, lineHeight: 1.6 }}>
            {error}
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'complete') {
    return (
      <Shell>
        <div style={centerStyle}>
          <div style={{ width: '100%', maxWidth: 480 }} className="fade-in">
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 12, fontFamily: 'var(--font-mono)' }}>
                INTAKE_PROTOCOL
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--pipe-text)', margin: '0 0 8px 0' }}>
                Intake Complete
              </h2>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(34, 197, 94, 0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CheckCircle size={24} color="#22c55e" />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--pipe-text)' }}>
                  {session?.name || 'Candidate'}
                </div>
                {session && (
                  <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)' }}>
                    Candidate ID: {session.id}
                  </div>
                )}
              </div>
            </div>

            <div style={{
              padding: 24, background: 'var(--pipe-surface-solid)', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--pipe-border)', display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                <Mail size={10} style={{ marginRight: 6, display: 'inline', verticalAlign: 'middle' }} /> INTAKE_STATUS
              </div>
              <div style={{ fontSize: 13, color: '#22c55e' }}>
                ✓ Your profile has been received and analyzed
              </div>
              <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)', lineHeight: 1.6 }}>
                {ingestion?.status === 'matched'
                  ? 'We found a matching challenge for you. You will receive an email with your challenge link shortly.'
                  : 'Your profile is now in our talent pool. We will reach out when a matching opportunity comes up.'}
              </div>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'submitting') {
    return (
      <Shell>
        <div style={centerStyle}>
          <Loader2 size={32} className="spin" color="var(--pipe-accent)" />
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--pipe-text-muted)', marginTop: 16, fontFamily: 'var(--font-mono)' }}>
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
          <div style={{ width: '100%', maxWidth: 520 }} className="fade-in">
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 12, fontFamily: 'var(--font-mono)' }}>
                INGESTION_PROTOCOL
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--pipe-text)', margin: 0 }}>
                Analyzing Your Profile
              </h2>
              <p style={{ fontSize: 12, color: 'var(--pipe-text-muted)', marginTop: 8, lineHeight: 1.6 }}>
                We are decomposing your resume, building a candidate graph,
                and matching you to the best open-source challenges.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {INGESTION_STEPS.map((step, idx) => {
                const isDone = currentIdx > idx || ingestion?.status === 'matched' || ingestion?.status === 'embedded';
                const isActive = currentIdx === idx;
                const isPending = !isDone && !isActive;
                const Icon = step.icon;

                return (
                  <div
                    key={step.step}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '14px 18px',
                      background: isActive ? 'var(--pipe-accent-surface)' : 'var(--pipe-surface-solid)',
                      borderRadius: 'var(--radius-md)',
                      border: `1px solid ${isActive ? 'var(--pipe-accent-border)' : 'var(--pipe-border)'}`,
                      opacity: isPending ? 0.4 : 1,
                      transition: 'all 0.3s ease',
                    }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isDone ? 'rgba(34, 197, 94, 0.1)' : isActive ? 'var(--pipe-accent-surface)' : 'var(--pipe-surface)',
                    }}>
                      {isDone ? (
                        <CheckCircle size={16} color="#22c55e" />
                      ) : isActive ? (
                        <Loader2 size={16} className="spin" color="var(--pipe-accent)" />
                      ) : (
                        <Icon size={16} color="var(--pipe-text-dim)" />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 700,
                        color: isDone ? '#22c55e' : isActive ? 'var(--pipe-accent)' : 'var(--pipe-text-dim)',
                        letterSpacing: '0.05em',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {step.label.toUpperCase()}
                      </div>
                      {isActive && (
                        <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginTop: 2 }} className="pulse">
                          In progress...
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {ingestion?.estimated_completion_at && (
              <div style={{ textAlign: 'center', marginTop: 24, fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'var(--font-mono)' }}>
                Estimated completion: {new Date(ingestion.estimated_completion_at).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  // ── Intake form ───────────────────────────────────────────────────────────

  return (
    <Shell>
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px', overflowY: 'auto',
      }}>
        <div style={{ width: '100%', maxWidth: 560 }} className="fade-in">
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{
              fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 12,
              fontFamily: 'var(--font-mono)',
            }}>
              CANDIDATE_INTAKE_PROTOCOL
            </div>
            <h2 style={{
              fontSize: 20, fontWeight: 800, color: 'var(--pipe-text)', margin: '0 0 8px 0',
            }}>
              {stageConfig?.stageTitle || 'Upload Your CV'}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--pipe-text-muted)', lineHeight: 1.6 }}>
              Upload your resume so we can learn about your background and find the best challenges for you.
            </p>
          </div>

          {/* Upcoming challenges preview */}
          {stageConfig?.upcoming && stageConfig.upcoming.length > 0 && (
            <div style={{
              padding: 16, background: 'var(--pipe-surface-solid)', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--pipe-border)', marginBottom: 24,
            }}>
              <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 8, letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>
                UPCOMING_CHALLENGES
              </div>
              {stageConfig.upcoming.map((u, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--pipe-text-muted)', marginBottom: 4 }}>
                  <ChevronRight size={12} color="var(--pipe-accent)" />
                  {u.title}
                </div>
              ))}
            </div>
          )}

          {/* Upload zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${file ? 'rgba(34, 197, 94, 0.3)' : 'var(--pipe-border)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '32px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: file ? 'rgba(34, 197, 94, 0.03)' : 'var(--pipe-surface-solid)',
              transition: 'all 0.2s ease',
              marginBottom: 16,
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
                <Loader2 size={24} className="spin" color="var(--pipe-accent)" />
                <div style={{ fontSize: 11, color: 'var(--pipe-accent)', marginTop: 12, fontFamily: 'var(--font-mono)' }}>UPLOADING...</div>
              </>
            ) : file ? (
              <>
                <FileText size={24} color="#22c55e" />
                <div style={{ fontSize: 12, color: '#22c55e', marginTop: 12, fontWeight: 700 }}>
                  {file.name}
                </div>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  Click to replace
                </div>
              </>
            ) : (
              <>
                <Upload size={24} color="var(--pipe-text-dim)" />
                <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)', marginTop: 12 }}>
                  Drop your resume here or click to browse
                </div>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  .pdf or .docx · max 10MB
                </div>
              </>
            )}
          </div>

          {uploadError && (
            <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 16, textAlign: 'center' }}>
              {uploadError}
            </div>
          )}

          {/* GitHub handle */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 9, color: 'var(--pipe-text-dim)', letterSpacing: '0.1em', display: 'block', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
              GITHUB_HANDLE (OPTIONAL)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Github size={16} color="var(--pipe-text-dim)" style={{ flexShrink: 0 }} />
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
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 9, color: 'var(--pipe-text-dim)', letterSpacing: '0.1em', display: 'block', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
              LINKEDIN_URL (OPTIONAL)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Linkedin size={16} color="var(--pipe-text-dim)" style={{ flexShrink: 0 }} />
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
              fontSize: 11, color: '#ef4444', marginBottom: 16, textAlign: 'center',
              padding: '8px 12px', background: 'rgba(239, 68, 68, 0.05)',
              borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239, 68, 68, 0.15)',
            }}>
              {error}
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={() => void handleSubmit()}
            disabled={!resumeR2Key || isUploading}
            style={{
              width: '100%',
              minHeight: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              border: 'none', borderRadius: 'var(--radius-md)',
              background: resumeR2Key ? 'var(--pipe-accent)' : 'var(--pipe-surface)',
              color: resumeR2Key ? 'var(--pipe-bg)' : 'var(--pipe-text-dim)',
              fontSize: 11, fontWeight: 800, letterSpacing: '0.1em',
              fontFamily: 'var(--font-mono)',
              cursor: resumeR2Key ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
            }}
          >
            <ChevronRight size={16} />
            SUBMIT_INTAKE
          </button>
        </div>
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

// ── Styles ──────────────────────────────────────────────────────────────────

const centerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px 24px',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--pipe-surface-solid)',
  border: '1px solid var(--pipe-border)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 14px',
  color: 'var(--pipe-text)',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  outline: 'none',
  transition: 'border-color var(--transition-fast) ease',
};

// ── Hooks shim ──────────────────────────────────────────────────────────────

import { useParams } from 'react-router-dom';
