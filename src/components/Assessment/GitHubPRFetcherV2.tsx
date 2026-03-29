/**
 * GitHubPRFetcherV2
 *
 * Fetches GitHub PR diff and metadata via the Worker API proxy.
 * Replaces GitHubPRFetcher for pages migrated away from Amplify.
 *
 * POST /api/v1/github/pr — no GitHub token exposed to the browser.
 */

import { useState } from 'react';
import { Github, Loader, CheckCircle2, AlertCircle } from 'lucide-react';
import { useGitHubPR } from '../../hooks/useGitHubPR';
import type { GitHubPRData } from '../../hooks/useGitHubPR';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface GitHubPRFetcherV2Props {
  /** Pre-populate the form with known values (e.g. loading an existing challenge). */
  initialRepoUrl?: string | undefined;
  initialPrNumber?: number | undefined;
  /** Called once a PR has been successfully fetched. */
  onPRFetched: (data: {
    githubRepoUrl: string;
    githubPrNumber: number;
    githubPrTitle: string;
    githubPrDescription: string;
    cachedDiffJson: GitHubPRData['diff'];
    cachedMetadata: GitHubPRData['metadata'];
  }) => void;
  /** Called when the user clears the cached PR and returns to the empty form. */
  onCleared?: (() => void) | undefined;
  /** When true, show the cached PR info panel instead of the fetch form. */
  showCached?: boolean | undefined;
  cachedTitle?: string | undefined;
  cachedAuthor?: string | undefined;
  cachedRepoUrl?: string | undefined;
  cachedPrNumber?: number | undefined;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GitHubPRFetcherV2({
  initialRepoUrl = '',
  initialPrNumber,
  onPRFetched,
  onCleared,
  showCached = false,
  cachedTitle,
  cachedAuthor,
  cachedRepoUrl,
  cachedPrNumber,
}: GitHubPRFetcherV2Props): JSX.Element {
  const { fetchPR, isLoading, error } = useGitHubPR();

  const [repoUrl, setRepoUrl] = useState(initialRepoUrl);
  const [prNumberStr, setPrNumberStr] = useState(
    initialPrNumber ? String(initialPrNumber) : '',
  );
  const [successData, setSuccessData] = useState<GitHubPRData | null>(null);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Space Mono, monospace',
    outline: 'none',
  };

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '11px 24px',
    background: 'rgba(251,191,36,0.15)',
    border: '1px solid rgba(251,191,36,0.3)',
    borderRadius: 6,
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'Space Mono, monospace',
    cursor: 'pointer',
    letterSpacing: '0.08em',
    transition: 'background 0.15s',
  };

  const handleFetch = async (): Promise<void> => {
    const prNum = parseInt(prNumberStr, 10);
    if (!repoUrl || isNaN(prNum) || prNum < 1) return;

    const data = await fetchPR(repoUrl, prNum);
    if (data) {
      setSuccessData(data);
      onPRFetched({
        githubRepoUrl: repoUrl,
        githubPrNumber: prNum,
        githubPrTitle: data.metadata.title,
        githubPrDescription: data.metadata.description ?? '',
        cachedDiffJson: data.diff,
        cachedMetadata: data.metadata,
      });
    }
  };

  // ─── Cached PR panel ───────────────────────────────────────────────────────

  if (showCached && (cachedTitle || cachedAuthor)) {
    return (
      <div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
            {[
              cachedTitle,
              cachedAuthor && `by ${cachedAuthor}`,
              cachedRepoUrl && cachedRepoUrl.replace('https://github.com/', ''),
              cachedPrNumber && `#${cachedPrNumber}`,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        {onCleared && (
          <button
            onClick={onCleared}
            style={{
              ...btnStyle,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.4)',
            }}
          >
            CLEAR &amp; RE-FETCH
          </button>
        )}
        {/* Allow re-fetch when PR is already cached */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono', letterSpacing: '0.1em', marginBottom: 6, display: 'block' }}>
                REPO_URL
              </label>
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                style={inputStyle}
              />
            </div>
            <div style={{ width: 100 }}>
              <label style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono', letterSpacing: '0.1em', marginBottom: 6, display: 'block' }}>
                PR_NUMBER
              </label>
              <input
                type="number"
                value={prNumberStr}
                onChange={(e) => setPrNumberStr(e.target.value)}
                placeholder="PR number"
                style={inputStyle}
              />
            </div>
            <button onClick={() => void handleFetch()} disabled={isLoading} style={btnStyle}>
              {isLoading ? <Loader size={14} className="animate-spin" /> : <Github size={14} />}
              REFRESH
            </button>
          </div>
        </div>
        {error && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, fontSize: 11, color: '#f87171', fontFamily: 'Space Mono' }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // ─── Success state (just fetched) ──────────────────────────────────────────

  if (successData) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 8, marginBottom: 12 }}>
          <CheckCircle2 size={16} color="#34d399" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{successData.metadata.title}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>
              {successData.metadata.author} · {successData.diff.files.length} file(s) changed
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Idle / fetch form ─────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono', letterSpacing: '0.1em', marginBottom: 6, display: 'block' }}>
            REPO_URL
          </label>
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono', letterSpacing: '0.1em', marginBottom: 6, display: 'block' }}>
            PR_NUMBER
          </label>
          <input
            type="number"
            value={prNumberStr}
            onChange={(e) => setPrNumberStr(e.target.value)}
            placeholder="PR number"
            min={1}
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => void handleFetch()}
            disabled={isLoading || !repoUrl || !prNumberStr}
            style={{
              ...btnStyle,
              opacity: isLoading || !repoUrl || !prNumberStr ? 0.5 : 1,
              cursor: isLoading || !repoUrl || !prNumberStr ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? <Loader size={14} /> : <Github size={14} />}
            FETCH
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <AlertCircle size={14} color="#f87171" />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171', fontFamily: 'Space Mono' }}>FETCH_ERROR</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{error}</p>
        </div>
      )}
    </div>
  );
}
