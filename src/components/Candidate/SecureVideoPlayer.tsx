/**
 * SecureVideoPlayer — fetches video blob with recruiter auth, creates object URL.
 *
 * Extracted from CandidateProfilePage for reuse across profile sections.
 */

import { useState, useEffect } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';

export function SecureVideoPlayer({ candidateId, r2Key }: { candidateId: string; r2Key: string }): JSX.Element {
  const { getToken } = useClerkAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const token = await getToken();
        const baseUrl =
          typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
            ? (import.meta.env.VITE_API_URL as string)
            : '';
        const res = await fetch(
          `${baseUrl}/api/v1/candidates/${candidateId}/media?r2Key=${encodeURIComponent(r2Key)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) throw new Error(`Failed to load video (${res.status})`);
        const blob = await res.blob();
        if (!cancelled) {
          setUrl(URL.createObjectURL(blob));
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load video');
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [candidateId, r2Key, getToken]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--pipe-text-dim)', fontSize: 10, fontFamily: '"Space Mono", monospace' }}>
        LOADING VIDEO...
      </div>
    );
  }
  if (error || !url) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#f87171', fontSize: 10, fontFamily: '"Space Mono", monospace' }}>
        {error ?? 'VIDEO UNAVAILABLE'}
      </div>
    );
  }
  return (
    <video
      src={url}
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
  );
}
