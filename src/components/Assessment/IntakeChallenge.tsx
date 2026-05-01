/**
 * IntakeChallenge — candidate-facing self-serve profile building.
 *
 * Collects:
 *   • Resume upload (PDF/DOCX)
 *   • GitHub handle (optional)
 *   • LinkedIn URL (optional)
 *
 * On submit, the payload is passed to onSubmit({ resumeR2Key, githubHandle, linkedinUrl })
 * and the backend queues resume parsing + ingestion via the enrichment worker.
 */

import React, { useState, useRef, useCallback } from 'react';
import { Upload, FileText, Loader2, ChevronRight, Github, Linkedin } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useSessionToken } from '../../contexts/SessionTokenContext';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

interface IntakeChallengeProps {
  challengeId: string;
  onSubmit: (submission: { resumeR2Key?: string; githubHandle?: string; linkedinUrl?: string }) => void;
  isSubmitting?: boolean;
}

export function IntakeChallenge({ challengeId, onSubmit, isSubmitting }: IntakeChallengeProps): JSX.Element {
  const { theme } = useTheme();
  const sessionToken = useSessionToken();
  const isLight = theme.mode === 'light' || theme.mode === 'anatomy';

  const [file, setFile] = useState<File | null>(null);
  const [resumeR2Key, setResumeR2Key] = useState<string>('');
  const [githubHandle, setGithubHandle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (
        selectedFile.type === 'application/pdf' ||
        selectedFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        setFile(selectedFile);
        setError(null);
        // Auto-upload on selection
        void uploadFile(selectedFile);
      } else {
        setError('Only .pdf and .docx files are supported.');
      }
    }
  };

  const uploadFile = useCallback(
    async (selectedFile: File) => {
      setIsUploading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('challengeId', challengeId);

        const response = await fetch(`${API_BASE}/rpc/upload-media`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(body.error?.message || `Upload failed (${response.status})`);
        }

        const result = (await response.json()) as { r2Key: string };
        setResumeR2Key(result.r2Key);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setError(msg);
        setFile(null);
      } finally {
        setIsUploading(false);
      }
    },
    [challengeId, sessionToken],
  );

  const handleGithubBlur = () => {
    setGithubHandle((prev) => prev.replace(/^@/, ''));
  };

  const validateGithub = (handle: string): boolean => {
    if (!handle) return true;
    return /^[a-zA-Z0-9\-]{1,39}$/.test(handle);
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

  const handleSubmit = () => {
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

    onSubmit({
      resumeR2Key,
      ...(githubHandle.trim() ? { githubHandle: githubHandle.trim() } : {}),
      ...(linkedinUrl.trim() ? { linkedinUrl: linkedinUrl.trim() } : {}),
    });
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        overflowY: 'auto',
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
              fontFamily: 'Space Mono',
              marginBottom: 12,
            }}
          >
            CANDIDATE_INTAKE_PROTOCOL
          </div>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: 'var(--pipe-text, #fff)',
              margin: '0 0 8px 0',
            }}
          >
            BUILD YOUR PROFILE
          </h2>
          <p
            style={{
              fontSize: 12,
              color: 'var(--pipe-text-muted)',
              lineHeight: 1.6,
              maxWidth: 400,
              margin: '0 auto',
            }}
          >
            Upload your resume and optionally share your GitHub and LinkedIn.
            We&apos;ll use this to find the best challenges for you.
          </p>
        </div>

        {/* Resume Upload */}
        <div style={{ marginBottom: 32 }}>
          <label
            style={{
              display: 'block',
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              marginBottom: 12,
              fontFamily: 'Space Mono',
              fontWeight: 600,
            }}
          >
            RESUME_UPLOAD (.PDF, .DOCX) *
          </label>
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: isLight
                ? '1px dashed var(--pipe-border)'
                : '1px dashed rgba(255,255,255,0.15)',
              borderRadius: 8,
              padding: 40,
              textAlign: 'center',
              cursor: isUploading ? 'default' : 'pointer',
              background: file ? 'rgba(255,255,255,0.02)' : 'transparent',
              transition: 'all 0.2s ease',
              opacity: isUploading ? 0.6 : 1,
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              style={{ display: 'none' }}
              accept=".pdf,.docx"
              disabled={isUploading}
            />
            {isUploading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <Loader2 size={24} className="animate-spin" color="#60a5fa" />
                <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
                  UPLOADING...
                </div>
              </div>
            ) : file ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'rgba(96, 165, 250, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FileText size={24} color="#60a5fa" />
                </div>
                <div style={{ fontSize: 13, color: 'var(--pipe-text, #fff)', fontWeight: 700 }}>
                  {file.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
                  {(file.size / 1024 / 1024).toFixed(2)} MB • CLICK_TO_REPLACE
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <Upload size={32} color="var(--pipe-text-dim)" />
                <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
                  DRAG_&_DROP_OR_CLICK_TO_UPLOAD
                </div>
              </div>
            )}
          </div>
        </div>

        {/* GitHub Handle */}
        <div style={{ marginBottom: 24 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              marginBottom: 12,
              fontFamily: 'Space Mono',
              fontWeight: 600,
            }}
          >
            <Github size={12} />
            GITHUB_HANDLE (OPTIONAL)
          </label>
          <input
            type="text"
            value={githubHandle}
            onChange={(e) => setGithubHandle(e.target.value)}
            onBlur={handleGithubBlur}
            placeholder="username (not the full URL)"
            disabled={isSubmitting}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border-light)',
              borderRadius: 4,
              color: 'var(--pipe-text, #fff)',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <div
            style={{
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              fontFamily: 'Space Mono',
              marginTop: 8,
              lineHeight: 1.5,
            }}
          >
            We&apos;ll use your public GitHub activity to enrich your profile. We only read public data.
          </div>
        </div>

        {/* LinkedIn URL */}
        <div style={{ marginBottom: 32 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              marginBottom: 12,
              fontFamily: 'Space Mono',
              fontWeight: 600,
            }}
          >
            <Linkedin size={12} />
            LINKEDIN_PROFILE (OPTIONAL)
          </label>
          <input
            type="text"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://linkedin.com/in/your-profile"
            disabled={isSubmitting}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border-light)',
              borderRadius: 4,
              color: 'var(--pipe-text, #fff)',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: 12,
              background: 'rgba(248, 113, 113, 0.1)',
              border: '1px solid rgba(248, 113, 113, 0.2)',
              color: '#f87171',
              fontSize: 11,
              fontFamily: 'Space Mono',
              borderRadius: 4,
              marginBottom: 24,
            }}
          >
            ERROR: {error.toUpperCase()}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || isUploading || !resumeR2Key}
          style={{
            width: '100%',
            padding: '16px',
            background: 'var(--pipe-text, #fff)',
            color: '#000',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 800,
            fontFamily: 'Space Mono',
            cursor: isSubmitting || isUploading || !resumeR2Key ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            opacity: isSubmitting || isUploading || !resumeR2Key ? 0.5 : 1,
          }}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              BUILDING_PROFILE...
            </>
          ) : (
            <>
              CONTINUE <ChevronRight size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
