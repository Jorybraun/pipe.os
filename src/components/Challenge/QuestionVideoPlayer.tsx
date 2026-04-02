import { useRef } from 'react';

export interface QuestionVideoPlayerProps {
  /** Full HTTPS URL — obtained via Storage.getUrl() or public S3 URL */
  src: string;
  /** Label shown above the player. Defaults to "RECRUITER_QUESTION" */
  label?: string;
}

/**
 * Renders a recruiter-recorded question video above the candidate's response area.
 * The caller is responsible for providing a valid HTTPS URL — this component
 * does no S3 resolution.
 */
export function QuestionVideoPlayer({ src, label = 'RECRUITER_QUESTION' }: QuestionVideoPlayerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 0 16px',
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.15em',
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <video
        ref={videoRef}
        src={src}
        controls
        preload="metadata"
        style={{
          width: '100%',
          maxHeight: 240,
          borderRadius: 6,
          border: '1px solid var(--pipe-border)',
          background: '#000',
          objectFit: 'contain',
        }}
      />
    </div>
  );
}
