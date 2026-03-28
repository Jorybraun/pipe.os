import { useRef, useState, useCallback, useEffect } from 'react';
import { useStorage } from '../../providers';

export interface QuestionVideoRecorderProps {
  /** Challenge ID — drives S3 path: challenge-questions/{challengeId}/question.webm */
  challengeId: string;
  /** Existing S3 key if a question video has already been uploaded */
  existingS3Key?: string;
  /** Called after successful upload with the S3 key */
  onUploaded: (s3Key: string) => void;
}

type RecorderState = 'idle' | 'recording' | 'recorded' | 'uploading' | 'done' | 'error';

/**
 * Recruiter-facing component for recording or replacing a question video.
 * Uploads directly to S3 via authenticated Amplify Storage (recruiter is always
 * a Cognito user).
 *
 * S3 path: challenge-questions/{challengeId}/question.webm
 */
export function QuestionVideoRecorder({
  challengeId,
  existingS3Key,
  onUploaded,
}: QuestionVideoRecorderProps): JSX.Element {
  const storage = useStorage();
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobEvent['data'][]>([]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [previewUrl]);

  const startRecording = useCallback(async () => {
    setError(null);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      setError('Could not access camera/microphone. Check browser permissions.');
      return;
    }

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true; // prevent feedback
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
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setRecordedBlob(blob);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.muted = false;
      }
      stream.getTracks().forEach((t) => t.stop());
      setState('recorded');
    };

    recorder.start(100);
    setState('recording');
  }, []);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const uploadRecording = useCallback(async () => {
    if (!recordedBlob) return;
    setState('uploading');
    setError(null);

    const s3Key = `challenge-questions/${challengeId}/question.webm`;

    try {
      await storage.upload({
        path: s3Key,
        data: recordedBlob,
        contentType: 'video/webm',
      });

      setState('done');
      onUploaded(s3Key);
    } catch (err) {
      console.error('[QuestionVideoRecorder] Upload failed:', err);
      setError('Upload failed. Please try again.');
      setState('error');
    }
  }, [recordedBlob, challengeId, onUploaded]);

  const reset = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecordedBlob(null);
    setError(null);
    setState('idle');
  }, [previewUrl]);

  const mono: React.CSSProperties = {
    fontFamily: '"Space Mono", monospace',
    fontSize: 10,
    letterSpacing: '0.1em',
  };

  const btn = (active = false): React.CSSProperties => ({
    ...mono,
    padding: '8px 16px',
    background: active ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${active ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)'}`,
    color: active ? '#fbbf24' : 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    borderRadius: 4,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {existingS3Key && state === 'idle' && (
        <div style={{ ...mono, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
          CURRENT: {existingS3Key}
        </div>
      )}

      <video
        ref={videoRef}
        style={{
          width: '100%',
          maxHeight: 200,
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.08)',
          background: '#000',
          objectFit: 'cover',
          display: state === 'idle' && !previewUrl ? 'none' : 'block',
        }}
        controls={state === 'recorded' || state === 'done'}
        playsInline
      />

      {error && (
        <div style={{ ...mono, color: '#f87171', lineHeight: 1.5 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {state === 'idle' && (
          <button onClick={() => void startRecording()} style={btn()}>
            {existingS3Key ? 'RE-RECORD' : 'START_RECORDING'}
          </button>
        )}
        {state === 'recording' && (
          <button onClick={stopRecording} style={btn(true)}>
            ● STOP_RECORDING
          </button>
        )}
        {state === 'recorded' && (
          <>
            <button onClick={() => void uploadRecording()} style={btn(true)}>
              UPLOAD_VIDEO
            </button>
            <button onClick={reset} style={btn()}>
              RE-RECORD
            </button>
          </>
        )}
        {state === 'uploading' && (
          <span style={{ ...mono, color: 'rgba(255,255,255,0.4)' }}>UPLOADING...</span>
        )}
        {(state === 'done' || state === 'error') && (
          <>
            {state === 'done' && (
              <span style={{ ...mono, color: '#4ade80' }}>✓ UPLOADED</span>
            )}
            <button onClick={reset} style={btn()}>
              RE-RECORD
            </button>
          </>
        )}
      </div>
    </div>
  );
}
