import { useRef, useState, useCallback, useEffect } from 'react';
import { QuestionVideoPlayer } from '../Challenge/QuestionVideoPlayer';
import { useSpeechTranscription } from '../../hooks/useSpeechTranscription';
import { useSessionToken } from '../../contexts/SessionTokenContext';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

export interface VideoSubmissionPanelProps {
  /** Question heading displayed above the recording controls */
  question: string;
  /** S3 key once uploaded (controlled) — empty string while not yet uploaded */
  videoS3Key: string;
  /** Filename for recruiter display */
  filename: string;
  /** Called when upload completes — transcript is the live speech-to-text result */
  onUploaded: (s3Key: string, filename: string, transcript: string) => void;
  /** Full URL for the recruiter's question video — shown above controls if present */
  questionVideoUrl?: string;
  /** Max recording duration in seconds (default 120) */
  maxDurationSeconds?: number;
  /** Candidate ID — included in R2 path (candidate-submissions/{candidateId}/...) */
  candidateId: string;
  /** Challenge ID — used to derive the R2 key */
  challengeId: string;
}

type PanelState = 'idle' | 'recording' | 'recorded' | 'uploading' | 'done' | 'error';

/**
 * VideoSubmissionPanel — candidate records and uploads a video response.
 *
 * Uses MediaRecorder for recording, then POSTs the blob directly to
 * POST /rpc/upload-media (Cloudflare Worker → R2). The R2 key is passed
 * to onUploaded for inclusion in the challenge submission JSON.
 */
export function VideoSubmissionPanel({
  question,
  videoS3Key,
  filename: _filename,
  onUploaded,
  questionVideoUrl,
  maxDurationSeconds = 120,
  candidateId,
  challengeId,
}: VideoSubmissionPanelProps): JSX.Element {
  const sessionToken = useSessionToken();
  const [panelState, setPanelState] = useState<PanelState>(
    videoS3Key ? 'done' : 'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const speech = useSpeechTranscription();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobEvent['data'][]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [previewUrl]);

  const startRecording = useCallback(async () => {
    setErrorMsg(null);
    chunksRef.current = [];
    setElapsed(0);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      setErrorMsg('Could not access camera/microphone. Check browser permissions.');
      return;
    }

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      void videoRef.current.play();
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      blobRef.current = blob;
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.muted = false;
      }
      setPanelState('recorded');
    };

    recorder.start(100);
    speech.start();
    setPanelState('recording');

    // Timer + auto-stop at maxDurationSeconds
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= maxDurationSeconds) {
          recorder.stop();
        }
        return next;
      });
    }, 1000);
  }, [maxDurationSeconds]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    speech.stop();
  }, [speech]);

  const uploadRecording = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;
    setPanelState('uploading');
    setErrorMsg(null);

    // Guard: candidateId and session token must be present
    if (!candidateId) {
      console.error('[VideoSubmissionPanel] Cannot upload: missing candidateId');
      setErrorMsg('Session error — please refresh and try again.');
      setPanelState('error');
      return;
    }
    if (!sessionToken) {
      console.error('[VideoSubmissionPanel] Cannot upload: missing session token');
      setErrorMsg('Session expired — please refresh and try again.');
      setPanelState('error');
      return;
    }

    // POST the blob directly to the Worker media upload endpoint
    const formData = new FormData();
    formData.append('file', blob, `response-${challengeId}.webm`);
    formData.append('challengeId', challengeId);

    let r2Key: string;
    try {
      const res = await fetch(`${API_BASE}/rpc/upload-media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: formData,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: { message?: string } };
        const msg = payload.error?.message ?? `Upload failed (HTTP ${res.status})`;
        throw new Error(msg);
      }
      const data = await res.json() as { r2Key: string };
      r2Key = data.r2Key;
    } catch (err) {
      console.error('[VideoSubmissionPanel] upload-media error:', err);
      setErrorMsg('Upload to storage failed. Please try again.');
      setPanelState('error');
      return;
    }

    const fname = `response-${challengeId}.webm`;
    setPanelState('done');
    onUploaded(r2Key, fname, speech.transcript);
  }, [candidateId, challengeId, sessionToken, onUploaded, speech.transcript]);

  const reset = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    blobRef.current = null;
    setErrorMsg(null);
    setElapsed(0);
    speech.reset();
    setPanelState('idle');
    if (videoRef.current) {
      videoRef.current.src = '';
      videoRef.current.srcObject = null;
    }
  }, [previewUrl, speech]);

  const mono: React.CSSProperties = {
    fontFamily: '"Space Mono", monospace',
  };

  const btnBase: React.CSSProperties = {
    ...mono,
    fontSize: 11,
    letterSpacing: '0.1em',
    padding: '10px 20px',
    borderRadius: 4,
    cursor: 'pointer',
    border: '1px solid',
  };

  const timeStr = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: '24px 32px',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* Recruiter question video */}
      {questionVideoUrl && <QuestionVideoPlayer src={questionVideoUrl} />}

      {/* Question heading */}
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.9)',
          lineHeight: 1.4,
          maxWidth: 700,
        }}
      >
        {question}
      </div>

      {/* Camera preview / playback */}
      <video
        ref={videoRef}
        style={{
          width: '100%',
          maxHeight: 300,
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.08)',
          background: '#000',
          objectFit: 'cover',
          display:
            panelState === 'idle' && !previewUrl && !videoS3Key ? 'none' : 'block',
        }}
        controls={panelState === 'recorded' || panelState === 'done'}
        playsInline
      />

      {/* Max duration hint */}
      {panelState === 'idle' && (
        <div style={{ ...mono, fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
          MAX_DURATION: {timeStr(maxDurationSeconds)}
          {speech.isSupported && ' · LIVE_TRANSCRIPTION: ON'}
        </div>
      )}

      {/* Recording timer */}
      {panelState === 'recording' && (
        <div style={{ ...mono, fontSize: 12, color: '#f87171', letterSpacing: '0.15em' }}>
          ● REC &nbsp;{timeStr(elapsed)} / {timeStr(maxDurationSeconds)}
        </div>
      )}

      {/* Live transcript */}
      {(panelState === 'recording' || panelState === 'recorded' || panelState === 'done') &&
        speech.isSupported && (speech.transcript || speech.interimText) && (
        <div
          style={{
            ...mono,
            fontSize: 12,
            color: 'rgba(255,255,255,0.7)',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            padding: '12px 16px',
            lineHeight: 1.7,
            maxHeight: 120,
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 6, letterSpacing: '0.1em' }}>
            TRANSCRIPT
          </div>
          {speech.transcript}
          {speech.interimText && (
            <span style={{ color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>
              {speech.interimText}
            </span>
          )}
        </div>
      )}

      {/* Error message */}
      {errorMsg && (
        <div style={{ ...mono, fontSize: 10, color: '#f87171', lineHeight: 1.5 }}>
          {errorMsg}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {panelState === 'idle' && (
          <button
            onClick={() => void startRecording()}
            style={{
              ...btnBase,
              background: 'rgba(74,222,128,0.1)',
              borderColor: 'rgba(74,222,128,0.4)',
              color: '#4ade80',
            }}
          >
            ● START_RECORDING
          </button>
        )}

        {panelState === 'recording' && (
          <button
            onClick={stopRecording}
            style={{
              ...btnBase,
              background: 'rgba(248,113,113,0.1)',
              borderColor: 'rgba(248,113,113,0.4)',
              color: '#f87171',
            }}
          >
            ■ STOP_RECORDING
          </button>
        )}

        {panelState === 'recorded' && (
          <>
            <button
              onClick={() => void uploadRecording()}
              style={{
                ...btnBase,
                background: 'rgba(251,191,36,0.12)',
                borderColor: 'rgba(251,191,36,0.4)',
                color: '#fbbf24',
              }}
            >
              SUBMIT_VIDEO
            </button>
            <button
              onClick={reset}
              style={{
                ...btnBase,
                background: 'rgba(255,255,255,0.04)',
                borderColor: 'rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              RE-RECORD
            </button>
          </>
        )}

        {panelState === 'uploading' && (
          <span style={{ ...mono, fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>
            UPLOADING...
          </span>
        )}

        {panelState === 'done' && (
          <>
            <span style={{ ...mono, fontSize: 10, color: '#4ade80', letterSpacing: '0.1em' }}>
              ✓ VIDEO_SAVED
            </span>
            <button
              onClick={reset}
              style={{
                ...btnBase,
                fontSize: 10,
                background: 'rgba(255,255,255,0.04)',
                borderColor: 'rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.4)',
              }}
            >
              RE-RECORD
            </button>
          </>
        )}

        {panelState === 'error' && (
          <button
            onClick={reset}
            style={{
              ...btnBase,
              background: 'rgba(255,255,255,0.04)',
              borderColor: 'rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            TRY_AGAIN
          </button>
        )}
      </div>
    </div>
  );
}
