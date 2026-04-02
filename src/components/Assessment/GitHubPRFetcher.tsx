import { useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Trash2, Loader } from 'lucide-react';
import { useData } from '../../providers';

export interface GitHubPRFetcherProps {
  initialChallenge?: {
    githubRepoUrl?: string;
    githubPrNumber?: number;
  };
  onPRFetched: (prData: {
    githubRepoUrl: string;
    githubPrNumber: number;
    githubPrTitle: string;
    githubPrDescription: string;
    cachedDiffJson: any;
    cachedMetadata: any;
  }) => void;
  onCleared?: () => void;
  isLoading?: boolean;
}

interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: any[];
}

interface PRPreviewData {
  prNumber: number;
  title: string;
  description: string;
  author: string;
  state: string;
  createdAt: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  diff: {
    files: DiffFile[];
  };
  metadata: any;
  fetchedAt: string;
}

interface FetchError {
  code: string;
  message: string;
  retryable: boolean;
  details?: string;
}

type UIState = 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

/**
 * GitHubPRFetcher Component
 * 
 * Admin UI to fetch PR from GitHub and show preview.
 * Allows customization of ground truth annotations.
 */
export function GitHubPRFetcher({
  initialChallenge,
  onPRFetched,
  onCleared,
  isLoading: parentIsLoading = false,
}: GitHubPRFetcherProps): JSX.Element {
  const client = useData().createClient();

  const [repoUrl, setRepoUrl] = useState(initialChallenge?.githubRepoUrl || '');
  const [prNumber, setPrNumber] = useState(
    initialChallenge?.githubPrNumber ? String(initialChallenge.githubPrNumber) : ''
  );

  const [uiState, setUiState] = useState<UIState>('IDLE');
  const [error, setError] = useState<FetchError | null>(null);
  const [prData, setPrData] = useState<PRPreviewData | null>(null);

  const isValidUrl = (url: string): boolean => {
    try {
      return url.startsWith('https://github.com/') && url.split('/').filter(s => s).length >= 4;
    } catch {
      return false;
    }
  };

  const isValidPrNumber = (num: string): boolean => {
    const n = parseInt(num, 10);
    return !isNaN(n) && n > 0;
  };

  const isFetchDisabled = !isValidUrl(repoUrl) || !isValidPrNumber(prNumber) || parentIsLoading || uiState === 'LOADING';

  const handleFetch = async () => {
    if (!isValidUrl(repoUrl) || !isValidPrNumber(prNumber)) {
      setError({
        code: 'INVALID_INPUT',
        message: 'Please enter a valid GitHub URL and PR number',
        retryable: false,
      });
      setUiState('ERROR');
      return;
    }

    setUiState('LOADING');
    setError(null);

    try {
      const { data: raw, errors: gqlErrors } = await client.mutations.fetchGitHubPR!({
        repoUrl,
        prNumber: parseInt(prNumber, 10),
        skipCache: false,
      });

      if (gqlErrors?.length) {
        console.error('[GitHubPRFetcher] GraphQL errors:', gqlErrors);
        throw new Error(gqlErrors[0]?.message ?? 'GraphQL error');
      }

      const result = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
        success: boolean;
        data?: PRPreviewData;
        error?: FetchError;
      } | null;

      if (!result?.success) {
        setError(result?.error ?? { code: 'UNKNOWN_ERROR', message: 'Unknown error', retryable: false });
        setUiState('ERROR');
        setPrData(null);
        return;
      }

      setPrData(result.data ?? null);
      setUiState('SUCCESS');
      setError(null);
    } catch (err: unknown) {
      console.error('[GitHubPRFetcher] Error fetching PR:', err);
      setError({
        code: 'NETWORK_ERROR',
        message: 'Network error connecting to GitHub. Check console for details.',
        retryable: true,
        details: err instanceof Error ? err.message : String(err),
      });
      setUiState('ERROR');
      setPrData(null);
    }
  };

  const handleClear = () => {
    setRepoUrl('');
    setPrNumber('');
    setUiState('IDLE');
    setError(null);
    setPrData(null);
    onCleared?.();
  };

  const handleProceed = () => {
    if (!prData) return;

    onPRFetched({
      githubRepoUrl: repoUrl,
      githubPrNumber: parseInt(prNumber, 10),
      githubPrTitle: prData.title,
      githubPrDescription: prData.description,
      cachedDiffJson: prData.diff,
      cachedMetadata: prData.metadata,
    });
  };

  const getErrorMessage = (code: string, message: string): string => {
    const errorMessages: Record<string, string> = {
      PR_NOT_FOUND: `PR not found. It may have been deleted or the number is incorrect.`,
      INVALID_REPOSITORY: `Repository not found or private. Check the URL and ensure it's public.`,
      RATE_LIMIT_EXCEEDED: `GitHub API rate limit exceeded. Please wait a moment and try again.`,
      GITHUB_AUTH_ERROR: `GitHub authentication failed. The token may have expired.`,
      DIFF_TOO_LARGE: `This PR's diff is too large. Please choose a smaller PR.`,
      INVALID_INPUT: `Invalid GitHub URL or PR number format.`,
      NETWORK_ERROR: `Network error connecting to GitHub.`,
      UNKNOWN_ERROR: `An unexpected error occurred.`,
    };
    return errorMessages[code] || message;
  };

  const statusBadgeColor = (state: string): string => {
    switch (state) {
      case 'open':
        return '#4ade80';
      case 'merged':
        return '#60a5fa';
      case 'closed':
        return '#f87171';
      default:
        return 'rgba(255,255,255,0.3)';
    }
  };

  const diffPreviewLines = prData?.diff?.files?.[0]?.hunks?.[0]?.lines?.slice(0, 20) || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* INPUT SECTION */}
      {uiState !== 'SUCCESS' && (
        <div
          style={{
            padding: 24,
            background: 'rgba(12, 12, 14, 0.5)',
            border: '1px solid var(--pipe-border)',
            borderRadius: 8,
          }}
        >
          <div style={{ marginBottom: 20, fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', fontWeight: 700, letterSpacing: '0.2em' }}>
            GITHUB_PR_DETAILS
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Repository URL */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
                  REPOSITORY_URL *
                </label>
                {isValidUrl(repoUrl) && (
                  <CheckCircle2 size={14} color="#4ade80" />
                )}
              </div>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: `1px solid ${isValidUrl(repoUrl) ? 'rgba(74, 222, 128, 0.3)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 4,
                  color: 'var(--pipe-text, #fff)',
                  fontSize: 13,
                  fontFamily: 'Space Mono',
                  outline: 'none',
                }}
              />
              <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginTop: 6, fontFamily: 'Space Mono' }}>
                Format: https://github.com/{'{owner}'}/{'{repo}'}
              </div>
            </div>

            {/* PR Number */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
                  PR_NUMBER *
                </label>
                {isValidPrNumber(prNumber) && (
                  <CheckCircle2 size={14} color="#4ade80" />
                )}
              </div>
              <input
                type="text"
                value={prNumber}
                onChange={(e) => setPrNumber(e.target.value.replace(/\D/g, ''))}
                placeholder="42"
                style={{
                  width: '100%',
                  maxWidth: 120,
                  padding: '12px 16px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: `1px solid ${isValidPrNumber(prNumber) ? 'rgba(74, 222, 128, 0.3)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 4,
                  color: 'var(--pipe-text, #fff)',
                  fontSize: 13,
                  fontFamily: 'Space Mono',
                  outline: 'none',
                }}
              />
              <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginTop: 6, fontFamily: 'Space Mono' }}>
                Positive integer only
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <button
                onClick={handleFetch}
                disabled={isFetchDisabled}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 24px',
                  background: isFetchDisabled ? 'rgba(255,255,255,0.05)' : '#fff',
                  color: isFetchDisabled ? 'rgba(255,255,255,0.2)' : '#000',
                  border: 'none',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: 'Space Mono',
                  cursor: isFetchDisabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  opacity: isFetchDisabled ? 0.5 : 1,
                }}
              >
                {uiState === 'LOADING' ? (
                  <>
                    <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    FETCHING...
                  </>
                ) : (
                  'FETCH_FROM_GITHUB'
                )}
              </button>
              <button
                onClick={handleClear}
                disabled={uiState === 'LOADING'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 24px',
                  background: 'var(--pipe-surface)',
                  color: 'var(--pipe-text-dim)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: 'Space Mono',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <Trash2 size={12} />
                CLEAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOADING STATE */}
      {uiState === 'LOADING' && (
        <div
          style={{
            padding: 40,
            background: 'rgba(12, 12, 14, 0.5)',
            border: '1px solid var(--pipe-border)',
            borderRadius: 8,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <Loader size={24} style={{ animation: 'spin 1s linear infinite', color: 'rgba(255,255,255,0.3)' }} />
          <div>
            <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)', fontFamily: 'Space Mono' }}>
              Fetching PR metadata from GitHub...
            </div>
            <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginTop: 8 }}>
              (may take 1-2 seconds)
            </div>
          </div>
        </div>
      )}

      {/* ERROR STATE */}
      {uiState === 'ERROR' && error && (
        <div
          style={{
            padding: 24,
            background: 'rgba(248, 113, 113, 0.05)',
            border: '1px solid rgba(248, 113, 113, 0.2)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <AlertCircle size={20} color="#f87171" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#f87171', fontFamily: 'Space Mono', marginBottom: 8 }}>
                {error.code}
              </div>
              <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                {getErrorMessage(error.code, error.message)}
              </div>
              {error.details && (
                <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', marginBottom: 12, background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: 4, maxHeight: 100, overflow: 'auto' }}>
                  {error.details}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12 }}>
                {error.retryable && (
                  <button
                    onClick={handleFetch}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 16px',
                      background: 'rgba(248, 113, 113, 0.1)',
                      color: '#f87171',
                      border: '1px solid rgba(248, 113, 113, 0.3)',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: 'Space Mono',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <RefreshCw size={10} />
                    RETRY
                  </button>
                )}
                <button
                  onClick={handleClear}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    background: 'var(--pipe-surface)',
                    color: 'var(--pipe-text-dim)',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: 'Space Mono',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <Trash2 size={10} />
                  CLEAR_FORM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUCCESS STATE: PR PREVIEW */}
      {uiState === 'SUCCESS' && prData && (
        <div
          style={{
            padding: 24,
            background: 'rgba(12, 12, 14, 0.5)',
            border: '1px solid var(--pipe-border)',
            borderRadius: 8,
          }}
        >
          <div style={{ marginBottom: 20, fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', fontWeight: 700, letterSpacing: '0.2em' }}>
            PR_PREVIEW
          </div>

          {/* PR Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div
              style={{
                width: 32,
                height: 20,
                background: statusBadgeColor(prData.state),
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8,
                fontWeight: 800,
                color: '#000',
                fontFamily: 'Space Mono',
              }}
            >
              {prData.state.toUpperCase()}
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--pipe-text-muted)', fontFamily: 'Space Mono' }}>
              #{prData.prNumber}
            </div>
          </div>

          {/* PR Title */}
          <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--pipe-text, #fff)', marginBottom: 8, margin: 0 }}>
            {prData.title}
          </h3>

          {/* PR Description (first 2 lines) */}
          {prData.description && (
            <p style={{ fontSize: 12, color: 'var(--pipe-text-muted)', lineHeight: 1.6, marginBottom: 16, margin: 0 }}>
              {prData.description.split('\n').slice(0, 2).join('\n')}
            </p>
          )}

          {/* Author & Branch Info */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 11,
              color: 'var(--pipe-text-dim)',
              fontFamily: 'Space Mono',
              marginBottom: 16,
            }}
          >
            <div>{prData.metadata?.author || 'unknown'}</div>
            <div>•</div>
            <div>{new Date(prData.createdAt).toLocaleDateString()}</div>
            <div>•</div>
            <div>
              {prData.metadata?.featureBranch || 'unknown'} → {prData.metadata?.baseBranch || 'main'}
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, fontSize: 11, fontFamily: 'Space Mono' }}>
            <div>
              <span style={{ color: '#4ade80', fontWeight: 700 }}>+{prData.additions}</span>
              <span style={{ color: 'rgba(255,255,255,0.3)' }}> </span>
              <span style={{ color: '#f87171', fontWeight: 700 }}>-{prData.deletions}</span>
              <span style={{ color: 'rgba(255,255,255,0.3)' }}> </span>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{prData.filesChanged} files</span>
            </div>
          </div>

          {/* Diff Preview */}
          {diffPreviewLines.length > 0 && (
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 20,
              }}
            >
              {/* File Header */}
              <div
                style={{
                  padding: '12px 16px',
                  background: 'rgba(0, 0, 0, 0.5)',
                  borderBottom: '1px solid var(--pipe-border)',
                  fontSize: 10,
                  fontFamily: 'Space Mono',
                  color: 'var(--pipe-text-dim)',
                }}
              >
                {prData.diff.files[0].path} (
                {prData.diff.files[0].status.toUpperCase()})
              </div>

              {/* Diff Content */}
              <div style={{ maxHeight: 200, overflow: 'auto' }}>
                {diffPreviewLines.map((line: any, idx: number) => {
                  const bgColor =
                    line.type === 'addition'
                      ? 'rgba(74, 222, 128, 0.02)'
                      : line.type === 'deletion'
                        ? 'rgba(248, 113, 113, 0.02)'
                        : 'transparent';

                  const textColor =
                    line.type === 'addition'
                      ? '#4ade80'
                      : line.type === 'deletion'
                        ? '#f87171'
                        : 'rgba(255,255,255,0.3)';

                  const symbol =
                    line.type === 'addition'
                      ? '+'
                      : line.type === 'deletion'
                        ? '−'
                        : ' ';

                  return (
                    <div key={idx} style={{ background: bgColor, display: 'flex' }}>
                      <div
                        style={{
                          width: 24,
                          padding: '2px 8px',
                          textAlign: 'right',
                          fontSize: 10,
                          fontFamily: 'Space Mono',
                          color: 'rgba(255,255,255,0.1)',
                          borderRight: '1px solid rgba(255,255,255,0.04)',
                        }}
                      >
                        {symbol}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          padding: '2px 12px',
                          fontSize: 10,
                          fontFamily: 'Space Mono',
                          color: textColor,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        {line.content}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Proceed Button */}
          <button
            onClick={handleProceed}
            style={{
              width: '100%',
              padding: '12px 24px',
              background: '#fff',
              color: '#000',
              border: 'none',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 800,
              fontFamily: 'Space Mono',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            PROCEED_TO_CUSTOMIZE
          </button>
        </div>
      )}

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
