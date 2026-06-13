import { useState, useEffect, useCallback } from 'react';
import { Link2, Unlink, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useSchedulingConnection } from '../../hooks/useSchedulingConnection';
import type { SchedulingConnectionInfo } from '../../hooks/useSchedulingConnection';
import { getAllPlugins } from '../../lib/scheduling/pluginRegistry';
import type { SchedulingPlugin } from '../../lib/scheduling/pluginRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowState =
  | { step: 'idle' }
  | { step: 'choosing' }
  | { step: 'waiting'; provider: string }
  | { step: 'exchanging'; provider: string }
  | { step: 'error'; message: string }
  | { step: 'connected' };

// ---------------------------------------------------------------------------
// ConnectionSetup
// ---------------------------------------------------------------------------

/**
 * ConnectionSetup — OAuth connection wizard for scheduling providers.
 *
 * Flow:
 * 1. Recruiter clicks "Connect" → sees provider buttons (Calendly / Cal.com)
 * 2. Clicks a provider → opens OAuth consent screen (same window redirect)
 * 3. Provider redirects back with ?code=XXX&state=YYY
 * 4. Component detects the code, exchanges it via the Lambda
 * 5. Shows "Connected ✓" or error
 *
 * The redirect URI is the current page URL (minus query params).
 */
export function ConnectionSetup(): JSX.Element {
  const {
    connection,
    isLoading,
    error: hookError,
    exchangeOAuth,
    disconnect,
  } = useSchedulingConnection();

  const [flow, setFlow] = useState<FlowState>({ step: 'idle' });
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const plugins = getAllPlugins();

  // Build the redirect URI — use fixed path to ensure consistency
  const redirectUri = `${window.location.origin}/schedule`;

  // ---------------------------------------------------------------------------
  // Handle OAuth callback (code + state in URL)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const stateRaw = params.get('state');

    if (!code || !stateRaw) return;

    // Parse state (contains providerId + CSRF nonce)
    let providerId: string;
    try {
      const parsed = JSON.parse(atob(stateRaw));
      providerId = parsed.providerId;

      // Validate CSRF nonce
      const storedNonce = sessionStorage.getItem('pipe_oauth_state_nonce');
      sessionStorage.removeItem('pipe_oauth_state_nonce');
      if (!storedNonce || storedNonce !== parsed.nonce) {
        console.error('[ConnectionSetup] OAuth state nonce mismatch — possible CSRF');
        setFlow({ step: 'error', message: 'OAuth state mismatch — please try again' });
        return;
      }
    } catch {
      console.error('[ConnectionSetup] Failed to parse OAuth state');
      setFlow({ step: 'error', message: 'Invalid OAuth callback state' });
      return;
    }

    // Clean URL
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, '', cleanUrl);

    // Retrieve PKCE verifier stored before the redirect
    const codeVerifier = sessionStorage.getItem('pipe_oauth_code_verifier') ?? undefined;
    sessionStorage.removeItem('pipe_oauth_code_verifier');

    // Exchange the code
    setFlow({ step: 'exchanging', provider: providerId });
    exchangeOAuth(providerId as 'CALENDLY' | 'CAL_COM', code, redirectUri, codeVerifier)
      .then(() => setFlow({ step: 'connected' }))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Exchange failed';
        setFlow({ step: 'error', message: msg });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleConnect = useCallback((plugin: SchedulingPlugin): void => {
    if (!plugin.getAuthUrl) {
      setFlow({ step: 'error', message: `${plugin.label} does not support OAuth` });
      return;
    }

    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const state = btoa(JSON.stringify({ providerId: plugin.type, nonce }));
    sessionStorage.setItem('pipe_oauth_state_nonce', nonce);

    // Generate PKCE pair (required by Calendly)
    const verifierArray = crypto.getRandomValues(new Uint8Array(32));
    const verifier = Array.from(verifierArray).map(b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('pipe_oauth_code_verifier', verifier);

    // Compute S256 challenge asynchronously then redirect
    void window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(digest => {
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const authUrl = plugin.getAuthUrl!(redirectUri, state, challenge);
      setFlow({ step: 'waiting', provider: plugin.type });
      window.location.href = authUrl;
    });
  }, [redirectUri]);

  const handleDisconnect = useCallback(async (conn: SchedulingConnectionInfo): Promise<void> => {
    setIsDisconnecting(true);
    try {
      await disconnect(conn.id);
      setFlow({ step: 'idle' });
    } catch {
      setFlow({ step: 'error', message: 'Failed to disconnect' });
    } finally {
      setIsDisconnecting(false);
    }
  }, [disconnect]);

  // ---------------------------------------------------------------------------
  // Render: Loading
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div style={containerStyle}>
        <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={labelStyle}>Loading connection…</span>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Connected
  // ---------------------------------------------------------------------------
  if (connection && connection.status === 'ACTIVE') {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle size={14} color="#4ade80" />
          <span style={{ ...labelStyle, color: '#4ade80' }}>
            Connected to {connection.providerId?.replace('_', '.') ?? 'provider'}
          </span>
          {connection.accountEmail && (
            <span style={{ ...labelStyle, color: 'var(--pipe-text-dim)', fontSize: 10 }}>
              ({connection.accountEmail})
            </span>
          )}
        </div>

        <button
          onClick={() => handleDisconnect(connection)}
          disabled={isDisconnecting}
          style={disconnectButtonStyle}
          title="Disconnect scheduling provider"
        >
          {isDisconnecting ? (
            <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Unlink size={10} />
          )}
          DISCONNECT
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Expired connection
  // ---------------------------------------------------------------------------
  if (connection && connection.status === 'EXPIRED') {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={14} color="#fbbf24" />
          <span style={{ ...labelStyle, color: '#fbbf24' }}>
            Connection expired — reconnect to resume syncing
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {plugins.map((plugin) => (
            <button
              key={plugin.type}
              onClick={() => handleConnect(plugin)}
              style={connectButtonStyle}
            >
              <Link2 size={10} />
              RECONNECT {plugin.label.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Exchanging
  // ---------------------------------------------------------------------------
  if (flow.step === 'exchanging') {
    return (
      <div style={containerStyle}>
        <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={labelStyle}>Connecting to {flow.provider.replace('_', '.')}…</span>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Error
  // ---------------------------------------------------------------------------
  if (flow.step === 'error' || hookError) {
    const msg = flow.step === 'error' ? flow.message : hookError?.message ?? 'Unknown error';
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={14} color="#f87171" />
          <span style={{ ...labelStyle, color: '#f87171' }}>{msg}</span>
        </div>

        <button
          onClick={() => setFlow({ step: 'choosing' })}
          style={connectButtonStyle}
        >
          TRY AGAIN
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Not connected — show connect buttons
  // ---------------------------------------------------------------------------
  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link2 size={14} color="var(--pipe-text-dim)" />
        <span style={labelStyle}>
          Connect a scheduling provider for automatic interview sync
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {plugins.map((plugin) => (
          <button
            key={plugin.type}
            onClick={() => handleConnect(plugin)}
            style={connectButtonStyle}
          >
            <Link2 size={10} />
            CONNECT {plugin.label.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — inline to match existing scheduling component patterns
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '12px 20px',
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.05em',
  fontFamily: '"Space Mono", monospace',
  color: 'var(--pipe-text-muted)',
};

const connectButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  background: 'rgba(96,165,250,0.12)',
  border: '1px solid rgba(96,165,250,0.25)',
  color: '#60a5fa',
  fontSize: 10,
  letterSpacing: '0.1em',
  fontFamily: '"Space Mono", monospace',
  cursor: 'pointer',
  borderRadius: 4,
  transition: 'all 0.2s',
};

const disconnectButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  background: 'rgba(248,113,113,0.08)',
  border: '1px solid rgba(248,113,113,0.2)',
  color: '#f87171',
  fontSize: 10,
  letterSpacing: '0.1em',
  fontFamily: '"Space Mono", monospace',
  cursor: 'pointer',
  borderRadius: 4,
  transition: 'all 0.2s',
};
