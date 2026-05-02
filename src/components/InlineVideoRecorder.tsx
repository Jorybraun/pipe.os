import { useRef, useState, useCallback, useEffect } from 'react';

export interface InlineVideoRecorderProps {
  /** Called when a recording is completed */
  onRecorded: (blob: Blob) => void;
  /** Called when the user clears/re-records */
  onClear: () => void;
  /** Existing blob to show in playback mode */
  recordedBlob?: Blob | null;
}

type RecorderState = 'idle' | 'previewing' | 'recording' | 'recorded';

/**
 * Lightweight inline video recorder for recruiter preview / demo flows.
 *
 * - Requests camera + mic on first interaction
 * - Shows live preview
 * - Records to a webm Blob
 * - Plays back the recorded clip
 */
export function InlineVideoRecorder({
  onRecorded,
  onClear,
  recordedBlob,
}: InlineVideoRecorderProps): JSX.Element {
  const [state, setState] = useState<RecorderState>(recordedBlob ? 'recorded' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobEvent['data'][]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialise playback when a recordedBlob is provided from parent
  useEffect(() => {
    if (recordedBlob && state !== 'recording') {
      const url = URL.createObjectURL(recordedBlob);
      setPreviewUrl(url);
      setState('recorded');
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.muted = false;
      }
      return () => {
        URL.revokeObjectURL(url);
      };
    }
    return undefined;
  }, [recordedBlob]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [previewUrl]);

  const startPreview = useCallback(async () => {
    setError(null);
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
      videoRef.current.muted = true;
      void videoRef.current.play();
    }
    setState('previewing');
  }, []);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    setElapsed(0);

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.muted = false;
      }
      setState('recorded');
      onRecorded(blob);
    };

    recorder.start(100);
    setState('recording');

    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  }, [onRecorded]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const handleReRecord = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setElapsed(0);
    setError(null);
    onClear();
    // Re-acquire camera immediately for a fresh preview
    void startPreview();
  }, [previewUrl, onClear, startPreview]);

  const timeStr = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const mono: React.CSSProperties = {
    fontFamily: '"Space Mono", monospace',
    fontSize: 10,
    letterSpacing: '0.1em',
  };

  const btn = (variant: 'primary' | 'danger' | 'neutral' = 'neutral'): React.CSSProperties => {
    const map: Record<string, React.CSSProperties> = {
      primary: {
        background: 'rgba(74,222,128,0.1)',
        borderColor: 'rgba(74,222,128,0.4)',
        color: '#4ade80',
      },
      danger: {
        background: 'rgba(248,113,113,0.1)',
        borderColor: 'rgba(248,113,113,0.4)',
        color: '#f87171',
      },
      neutral: {
        background: 'var(--pipe-surface)',
        borderColor: 'var(--pipe-border)',
        color: 'var(--pipe-text-muted)',
      },
    };
    return {
      ...mono,
      padding: '10px 20px',
      border: '1px solid',
      borderRadius: 4,
      cursor: 'pointer',
      ...map[variant],
    };
  };

  const showVideo = state !== 'idle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {showVideo && (
        <div style={{ position: 'relative' }}>
          <video
            ref={videoRef}
            style={{
              width: '100%',
              maxHeight: 260,
              borderRadius: 6,
              border: '1px solid var(--pipe-border)',
              background: '#000',
              objectFit: 'cover',
              display: 'block',
            }}
            controls={state === 'recorded'}
            playsInline
          />
          {state === 'recording' && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(0,0,0,0.6)',
                padding: '4px 10px',
                borderRadius: 4,
                ...mono,
                color: '#f87171',
                fontSize: 11,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f87171', display: 'inline-block' }} />
              REC {timeStr(elapsed)}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ ...mono, color: '#f87171', lineHeight: 1.5 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {state === 'idle' && (
          <button onClick={() => void startPreview()} style={btn('primary')}>
            ● ENABLE_CAMERA
          </button>
        )}

        {state === 'previewing' && (
          <button onClick={startRecording} style={btn('primary')}>
            ● START_RECORDING
          </button>
        )}

        {state === 'recording' && (
          <button onClick={stopRecording} style={btn('danger')}>
            ■ STOP_RECORDING
          </button>
        )}

        {state === 'recorded' && (
          <>
            <button onClick={handleReRecord} style={btn('neutral')}>
              RE-RECORD
            </button>
            <span style={{ ...mono, color: '#4ade80' }}>✓ RECORDED</span>
          </>
        )}
      </div>
    </div>
  );
}
