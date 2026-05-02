import { useState, useCallback } from 'react';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { Loader2, Upload, ArrowRight, Code, MessageSquareText, Settings } from 'lucide-react';
import CandidateAssessmentPage from './CandidateAssessmentPage';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

interface DemoRegisterResponse {
  candidateId: string;
  pipelineId: string;
  sessionToken: string;
  status: string;
}

type AssessmentType = 'CODE_REVIEW' | 'CULTURE';

const ASSESSMENT_OPTIONS: Array<{ id: AssessmentType; label: string; description: string; icon: typeof Code }> = [
  {
    id: 'CODE_REVIEW',
    label: 'Code Review',
    description: 'Review a pull request and spot bugs, style issues, and design problems.',
    icon: Code,
  },
  {
    id: 'CULTURE',
    label: 'Culture Interview',
    description: 'Answer behavioral questions about ownership, collaboration, and learning.',
    icon: MessageSquareText,
  },
];

export default function DemoIntakePage(): JSX.Element {
  const [registered, setRegistered] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [assessmentType, setAssessmentType] = useState<AssessmentType>('CODE_REVIEW');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > 10 * 1024 * 1024) {
      setError('Resume must be under 10 MB');
      setResumeFile(null);
      return;
    }
    setError(null);
    setResumeFile(file);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !email.includes('@')) {
      setError('Please enter a valid name and email.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/rpc/demo-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          assessmentType,
        }),
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        const msg = (data as { error?: { message?: string } }).error?.message ?? 'Registration failed';
        throw new Error(msg);
      }

      const { candidateId, pipelineId, sessionToken } = (data as unknown) as DemoRegisterResponse;

      sessionStorage.setItem('pipe_session_token', sessionToken);
      sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
        id: candidateId,
        pipelineId,
        status: 'INVITED',
        name: name.trim(),
      }));

      setRegistered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }, [name, email, assessmentType]);

  if (registered) {
    return <CandidateAssessmentPage hideHeader />;
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0c0c0e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      <div style={{ maxWidth: 560, width: '100%' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.25em',
              color: 'rgba(255,255,255,0.35)',
              marginBottom: 12,
              textTransform: 'uppercase',
            }}
          >
            Self-Service Demo
          </div>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: '#fff',
              letterSpacing: '0.03em',
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            Try PIPE
          </h1>
          <p
            style={{
              fontSize: 13,
              color: 'rgba(255,255,255,0.5)',
              margin: '10px 0 0',
              lineHeight: 1.6,
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
            }}
          >
            Experience a real assessment. No recruiter needed — pick a track and jump in.
          </p>
        </div>

        <LiquidMetalCard variant="dark" style={{ padding: 32 }}>
          <form onSubmit={handleSubmit}>
            {/* Assessment Type Selector */}
            <div style={{ marginBottom: 28 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: 12,
                  textTransform: 'uppercase',
                }}
              >
                Assessment Type
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ASSESSMENT_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = assessmentType === opt.id;
                  return (
                    <label
                      key={opt.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 14,
                        padding: '16px 18px',
                        borderRadius: 10,
                        border: isSelected
                          ? '1px solid rgba(255,255,255,0.25)'
                          : '1px solid rgba(255,255,255,0.08)',
                        background: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <input
                        type="radio"
                        name="assessmentType"
                        value={opt.id}
                        checked={isSelected}
                        onChange={() => setAssessmentType(opt.id)}
                        style={{ marginTop: 2, accentColor: '#fff' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          <Icon size={14} color={isSelected ? '#fff' : 'rgba(255,255,255,0.5)'} />
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: isSelected ? '#fff' : 'rgba(255,255,255,0.7)',
                              letterSpacing: '0.02em',
                            }}
                          >
                            {opt.label}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            color: 'rgba(255,255,255,0.4)',
                            lineHeight: 1.5,
                            fontFamily: '"Space Grotesk", system-ui, sans-serif',
                          }}
                        >
                          {opt.description}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: 10,
                  textTransform: 'uppercase',
                }}
              >
                Full Name
              </label>
              <input
                type="text"
                placeholder="Ada Lovelace"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.03)',
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                  fontFamily: 'inherit',
                  letterSpacing: '0.02em',
                }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: 10,
                  textTransform: 'uppercase',
                }}
              >
                Email
              </label>
              <input
                type="email"
                placeholder="ada@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.03)',
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                  fontFamily: 'inherit',
                  letterSpacing: '0.02em',
                }}
              />
            </div>

            <div style={{ marginBottom: 28 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: 10,
                  textTransform: 'uppercase',
                }}
              >
                Resume / CV (optional)
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 8,
                  border: '1px dashed rgba(255,255,255,0.12)',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  transition: 'border-color 0.2s, background 0.2s',
                  background: resumeFile ? 'rgba(255,255,255,0.04)' : 'transparent',
                }}
              >
                <Upload size={16} color={resumeFile ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)'} />
                <span
                  style={{
                    fontSize: 12,
                    color: resumeFile ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    letterSpacing: '0.02em',
                  }}
                >
                  {resumeFile ? resumeFile.name : 'Drop PDF or DOCX, or click to browse'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.docx"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                  disabled={isSubmitting}
                />
              </label>
            </div>

            {error && (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  color: '#f87171',
                  fontSize: 12,
                  marginBottom: 24,
                  letterSpacing: '0.02em',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '16px 32px',
                background: isSubmitting
                  ? 'rgba(255,255,255,0.05)'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
                border: '1px solid rgba(255,255,255,0.15)',
                color: isSubmitting ? 'rgba(255,255,255,0.35)' : '#fff',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                fontFamily: 'inherit',
                borderRadius: 8,
                transition: 'opacity 0.2s',
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Starting Assessment...
                </>
              ) : (
                <>
                  Start {ASSESSMENT_OPTIONS.find(o => o.id === assessmentType)?.label}
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>

          {/* Admin configuration link */}
          <div
            style={{
              marginTop: 24,
              paddingTop: 20,
              borderTop: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Settings size={12} color="rgba(255,255,255,0.3)" />
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                window.location.href = '/';
              }}
              style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.3)',
                textDecoration: 'none',
                letterSpacing: '0.05em',
              }}
            >
              Admin: configure demo questions in the pipeline editor
            </a>
          </div>
        </LiquidMetalCard>
      </div>
    </div>
  );
}
