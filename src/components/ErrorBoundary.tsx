import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
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
              border: '1px solid rgba(255,255,255,0.08)',
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
                color: 'rgba(255,255,255,0.4)',
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
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
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
