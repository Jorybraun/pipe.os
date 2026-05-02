import { useState, useCallback } from 'react';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { Loader2, Upload, ArrowRight, Github, Linkedin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

interface DemoRegisterResponse {
  candidateId: string;
  pipelineId: string;
  sessionToken: string;
  inviteToken: string;
  status: string;
}

export default function DemoIntakePage(): JSX.Element {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [githubHandle, setGithubHandle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
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

    if (linkedinUrl.trim()) {
      try {
        const parsed = new URL(linkedinUrl.trim());
        if (parsed.hostname !== 'www.linkedin.com' && parsed.hostname !== 'linkedin.com') {
          setError('Invalid LinkedIn URL.');
          return;
        }
      } catch {
        setError('Invalid LinkedIn URL.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const payload: Record<string, string> = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
      };
      if (githubHandle.trim()) payload.githubHandle = githubHandle.trim().replace(/^@/, '');
      if (linkedinUrl.trim()) payload.linkedinUrl = linkedinUrl.trim();

      const res = await fetch(`${API_BASE}/rpc/demo-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        const msg = (data as { error?: { message?: string } }).error?.message ?? 'Registration failed';
        throw new Error(msg);
      }

      const { candidateId, pipelineId, sessionToken, inviteToken } = data as unknown as DemoRegisterResponse;

      // Cache session token so CandidateAssessmentPage can use it
      sessionStorage.setItem('pipe_session_token', sessionToken);
      sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
        id: candidateId,
        pipelineId,
        status: 'INVITED',
        name: name.trim(),
      }));

      // Redirect to token-based assessment URL
      navigate(`/assess/${inviteToken}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }, [name, email, githubHandle, linkedinUrl, navigate]);

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
      <div style={{ maxWidth: 520, width: '100%' }}>
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
            Experience a real code review assessment. No recruiter needed — just you and the code.
          </p>
        </div>

        <LiquidMetalCard variant="dark" style={{ padding: 32 }}>
          <form onSubmit={handleSubmit}>
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
                <Github size={10} style={{ display: 'inline', marginRight: 6 }} />
                GitHub Handle (optional)
              </label>
              <input
                type="text"
                placeholder="username"
                value={githubHandle}
                onChange={(e) => setGithubHandle(e.target.value)}
                disabled={isSubmitting}
                onBlur={() => setGithubHandle((prev) => prev.replace(/^@/, ''))}
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
                <Linkedin size={10} style={{ display: 'inline', marginRight: 6 }} />
                LinkedIn Profile (optional)
              </label>
              <input
                type="text"
                placeholder="https://linkedin.com/in/your-profile"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
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
                  Start Code Review
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>
        </LiquidMetalCard>
      </div>
    </div>
  );
}
