/**
 * SmartTextareaPanel — unified interview input for QUIZ_SHORT_ANSWER challenges.
 *
 * Replaces the basic TextareaPanel with SmartInterviewInput, bringing the same
 * rich input experience (auto-expand textarea, push-to-talk voice, inline video
 * recording, TTS replay, suggested chips) to the screener stage.
 *
 * Video blobs are uploaded to R2 via /rpc/upload-media and the resulting key
 * is stored in the submission as videoS3Key.
 */

import { useState, useCallback, type JSX } from 'react';
import { SmartInterviewInput } from '../AIChat/SmartInterviewInput';
import { useSessionToken } from '../../contexts/SessionTokenContext';
import { useCandidateId } from '../../contexts/CandidateIdContext';

const API_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '';

interface SmartTextareaPanelProps {
  question: string;
  value: string;
  onChange: (text: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  maxLength?: number;
  enableVoice?: boolean;
  enableVideo?: boolean;
  enableTTS?: boolean;
  /** When true and enableVideo is true, a video recording is required to submit. */
  requireVideo?: boolean;
  /** Challenge ID for R2 upload path */
  challengeId?: string;
  /** Direct submission updater so we can write inputMode / videoS3Key */
  updateSubmission?: (patch: Record<string, unknown>) => void;
}

export function SmartTextareaPanel({
  question,
  value,
  onChange,
  onSubmit,
  placeholder = 'Take your time and answer thoughtfully…',
  maxLength,
  enableVoice = false,
  enableVideo = false,
  enableTTS = false,
  requireVideo = false,
  challengeId,
  updateSubmission,
}: SmartTextareaPanelProps): JSX.Element {
  const sessionToken = useSessionToken();
  const candidateId = useCandidateId();
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoS3Key, setVideoS3Key] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleVideoRecorded = useCallback(
    async (blob: Blob) => {
      setUploadError(null);

      if (!sessionToken || !candidateId) {
        setUploadError('Session error — please refresh and try again.');
        return;
      }

      setVideoUploading(true);
      try {
        const effectiveChallengeId = String(challengeId || candidateId || 'unknown');
        const formData = new FormData();
        formData.append('file', blob, `response-${effectiveChallengeId}.webm`);
        formData.append('challengeId', effectiveChallengeId);

        const res = await fetch(`${API_BASE}/rpc/upload-media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionToken}` },
          body: formData,
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(body.error?.message ?? `Upload failed (${res.status})`);
        }

        const data = (await res.json()) as { r2Key?: string };
        if (data.r2Key) {
          setVideoS3Key(data.r2Key);
          const filename = `response-${effectiveChallengeId}.webm`;
          // Persist video metadata in the submission so StageShell + profile can read it
          updateSubmission?.({
            inputMode: 'video',
            videoS3Key: data.r2Key,
            filename,
          });
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setVideoUploading(false);
      }
    },
    [sessionToken, candidateId, challengeId, updateSubmission],
  );

  const handleVideoClear = useCallback(() => {
    setVideoS3Key(null);
    setUploadError(null);
    onChange('');
    updateSubmission?.({ videoS3Key: '', filename: '', text: '' });
  }, [onChange, updateSubmission]);

  const handleSubmit = useCallback(() => {
    onSubmit?.();
  }, [onSubmit]);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', width: '100%', padding: '40px 20px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h2 style={{
        fontSize: 22, fontWeight: 700, color: 'var(--pipe-text, #fff)',
        marginBottom: 32, lineHeight: 1.4, letterSpacing: '-0.01em',
      }}>
        {question}
      </h2>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <SmartInterviewInput
          value={value}
          onChange={onChange}
          onSubmit={handleSubmit}
          questionText={question}
          enableVoice={enableVoice}
          enableVideo={enableVideo}
          requireVideo={requireVideo}
          enableTTS={enableTTS}
          isLoading={videoUploading}
          placeholder={placeholder}
          submitLabel="SUBMIT"
          onVideoRecorded={handleVideoRecorded}
          onVideoClear={handleVideoClear}
        />

        {uploadError && (
          <div style={{
            marginTop: 12, padding: '10px 14px',
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
            borderRadius: 6, fontSize: 11, color: '#f87171', fontFamily: '"Space Mono", monospace',
          }}>
            {uploadError}
          </div>
        )}

        {videoS3Key && !videoUploading && (
          <div style={{
            marginTop: 12, display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 10, color: '#4ade80', fontFamily: '"Space Mono", monospace', letterSpacing: '0.06em',
          }}>
            <span>✓</span>
            <span>VIDEO UPLOADED</span>
          </div>
        )}

        {maxLength && (
          <div style={{
            position: 'absolute', bottom: 16, right: 24,
            fontSize: 10,
            color: value.length >= maxLength ? '#f87171' : 'rgba(255,255,255,0.2)',
            fontFamily: 'Space Mono', letterSpacing: '0.1em',
          }}>
            {value.length} / {maxLength}_CHARS
          </div>
        )}
      </div>
    </div>
  );
}
