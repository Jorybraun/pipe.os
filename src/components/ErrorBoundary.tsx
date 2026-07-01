import { Component, type ReactNode, type ErrorInfo } from 'react';

const CHUNK_RELOAD_PREFIX = 'pipe:chunk-reload:v1:';
const CHUNK_ERROR_PATTERN = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk \d+ failed/i;
const CHUNK_URL_PATTERN = /https?:\/\/[^\s'")]+\/assets\/[^\s'")]+\.js/i;

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export function shouldRecoverFromChunkLoadError(error: Error): boolean {
  return CHUNK_ERROR_PATTERN.test(error.message);
}

function chunkReloadKey(error: Error, href: string): string {
  const chunkUrl = error.message.match(CHUNK_URL_PATTERN)?.[0] ?? href;
  return `${CHUNK_RELOAD_PREFIX}${chunkUrl}`;
}

export function recoverFromChunkLoadError(error: Error, win: Window = window): boolean {
  if (!shouldRecoverFromChunkLoadError(error)) return false;
  try {
    const key = chunkReloadKey(error, win.location.href);
    if (win.sessionStorage.getItem(key) === '1') return false;
    win.sessionStorage.setItem(key, '1');
    win.location.reload();
    return true;
  } catch (recoveryError) {
    console.error('[ErrorBoundary] Chunk recovery failed:', recoveryError);
    return false;
  }
}

/**
 * ErrorBoundary — Catches uncaught render errors and shows a recovery screen
 * instead of leaving the user with an empty white page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack);
    recoverFromChunkLoadError(error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            minHeight: '60vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              maxWidth: 480,
              textAlign: 'center',
              border: '1px solid var(--pipe-border)',
              borderRadius: 8,
              padding: 48,
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.2em',
                color: 'rgba(255,100,100,0.6)',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 24,
              }}
            >
              RENDER_ERROR
            </div>
            <p
              style={{
                fontSize: 13,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                lineHeight: 1.6,
                marginBottom: 32,
              }}
            >
              Something went wrong. Please refresh the page to continue.
            </p>
            {this.state.error && (
              <pre
                style={{
                  fontSize: 10,
                  color: 'rgba(255,100,100,0.4)',
                  fontFamily: '"Space Mono", monospace',
                  textAlign: 'left',
                  background: 'rgba(255,0,0,0.04)',
                  padding: 12,
                  borderRadius: 4,
                  overflow: 'auto',
                  maxHeight: 120,
                  marginBottom: 24,
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 24px',
                background: 'var(--pipe-surface-hover)',
                border: '1px solid var(--pipe-border)',
                color: 'var(--pipe-text, #fff)',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              REFRESH_PAGE
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
