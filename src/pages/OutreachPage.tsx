/**
 * OutreachPage — email provider connection + OAuth callback handler.
 *
 * Route: /outreach
 *
 * Acts as the redirect target for Gmail / Microsoft OAuth flows.
 * On mount, checks for ?code= in the URL and exchanges it for tokens.
 * After a successful exchange, cleans the URL and shows the connected state.
 */

import { useEffect, useState } from 'react';
import { Mail, CheckCircle, AlertCircle, Loader, Unlink, Link2 } from 'lucide-react';
import { useEmailConnection } from '../hooks/useEmailConnection';

type PageState =
  | { step: 'idle' }
  | { step: 'exchanging'; provider: string }
  | { step: 'connected' }
  | { step: 'error'; message: string };

export default function OutreachPage(): JSX.Element {
  const {
    connection,
    isLoading,
    getAuthUrl,
    exchangeOAuth,
    disconnect,
    refetch,
  } = useEmailConnection();

  const [pageState, setPageState] = useState<PageState>({ step: 'idle' });
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const redirectUri = `${window.location.origin}/outreach`;

  // ── Handle OAuth callback ───────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const stateRaw = params.get('state');

    if (!code || !stateRaw) return;

    let parsed: { providerId: string; nonce: string; type?: string };
    try {
      parsed = JSON.parse(atob(stateRaw)) as { providerId: string; nonce: string; type?: string };
    } catch {
      setPageState({ step: 'error', message: 'Invalid OAuth callback state' });
      return;
    }

    if (parsed.type !== 'email') return;

    const storedNonce = sessionStorage.getItem('pipe_email_oauth_nonce');
    sessionStorage.removeItem('pipe_email_oauth_nonce');
    if (!storedNonce || storedNonce !== parsed.nonce) {
      setPageState({ step: 'error', message: 'OAuth state mismatch — please try again' });
      return;
    }

    window.history.replaceState({}, '', `${window.location.origin}/outreach`);

    const codeVerifier = sessionStorage.getItem('pipe_email_oauth_verifier') ?? undefined;
    sessionStorage.removeItem('pipe_email_oauth_verifier');

    setPageState({ step: 'exchanging', provider: parsed.providerId });
    exchangeOAuth(
      parsed.providerId as 'GMAIL' | 'MICROSOFT',
      code,
      redirectUri,
      codeVerifier,
    )
      .then(() => {
        setPageState({ step: 'connected' });
        void refetch();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Exchange failed';
        setPageState({ step: 'error', message: msg });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleConnect = async (providerId: 'GMAIL' | 'MICROSOFT'): Promise<void> => {
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const state = btoa(JSON.stringify({ providerId, nonce, type: 'email' }));
    sessionStorage.setItem('pipe_email_oauth_nonce', nonce);

    try {
      const authUrl = await getAuthUrl(providerId, redirectUri);
      const url = new URL(authUrl);
      url.searchParams.set('state', state);
      window.location.href = url.toString();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start OAuth';
      setPageState({ step: 'error', message: msg });
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setIsDisconnecting(true);
    try {
      await disconnect();
      setPageState({ step: 'idle' });
    } catch {
      setPageState({ step: 'error', message: 'Failed to disconnect' });
    } finally {
      setIsDisconnecting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={pageWrap}>
      <div style={card}>
        <div style={cardHeader}>
          <Mail size={16} color="#60a5fa" />
          <span style={cardTitle}>EMAIL_PROVIDER</span>
        </div>
        <p style={description}>
          Connect your Gmail or Microsoft account to send candidate emails from your own address.
        </p>

        {(isLoading || pageState.step === 'exchanging') && (
          <div style={statusRow}>
            <Loader size={14} style={{ animation: 'spin 1s linear infinite', color: '#60a5fa' }} />
            <span style={dimText}>
              {pageState.step === 'exchanging'
                ? `Connecting to ${pageState.provider}...`
                : 'Loading...'}
            </span>
          </div>
        )}

        {pageState.step === 'error' && (
          <div style={{ ...statusRow, borderColor: 'rgba(248,113,113,0.2)' }}>
            <AlertCircle size={14} color="#f87171" />
            <span style={{ ...dimText, color: '#f87171', flex: 1 }}>{pageState.message}</span>
            <button onClick={() => setPageState({ step: 'idle' })} style={smallBtn}>
              TRY AGAIN
            </button>
          </div>
        )}

        {!isLoading && pageState.step !== 'exchanging' && pageState.step !== 'error' && connection && connection.status === 'ACTIVE' && (
          <div style={{ ...statusRow, borderColor: 'rgba(74,222,128,0.2)' }}>
            <CheckCircle size={14} color="#4ade80" />
            <div style={{ flex: 1 }}>
              <div style={{ ...dimText, color: '#4ade80', marginBottom: 2 }}>
                {connection.providerId === 'GMAIL' ? 'GMAIL' : 'MICROSOFT OUTLOOK'}
              </div>
              <div style={{ ...dimText, fontSize: 9, color: 'var(--pipe-text-dim)' }}>
                {connection.accountEmail}
              </div>
            </div>
            <button
              onClick={() => void handleDisconnect()}
              disabled={isDisconnecting}
              style={disconnectBtn}
            >
              {isDisconnecting
                ? <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} />
                : <Unlink size={10} />}
              DISCONNECT
            </button>
          </div>
        )}

        {!isLoading && pageState.step !== 'exchanging' && pageState.step !== 'error' && (!connection || connection.status !== 'ACTIVE') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => void handleConnect('GMAIL')} style={providerBtn}>
              <Mail size={14} />
              <span style={{ flex: 1, textAlign: 'left' }}>CONNECT GMAIL</span>
              <Link2 size={10} color="var(--pipe-text-dim)" />
            </button>
            <button onClick={() => void handleConnect('MICROSOFT')} style={providerBtn}>
              <Mail size={14} />
              <span style={{ flex: 1, textAlign: 'left' }}>CONNECT MICROSOFT OUTLOOK</span>
              <Link2 size={10} color="var(--pipe-text-dim)" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const pageWrap: React.CSSProperties = {
  padding: 32,
  maxWidth: 480,
};

const card: React.CSSProperties = {
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const cardHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const cardTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.1em',
  fontFamily: '"Space Mono", monospace',
  color: 'var(--pipe-text, #fff)',
};

const description: React.CSSProperties = {
  fontSize: 10,
  lineHeight: 1.6,
  color: 'var(--pipe-text-muted)',
  fontFamily: '"Space Mono", monospace',
  margin: 0,
};

const dimText: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.03em',
  fontFamily: '"Space Mono", monospace',
  color: 'var(--pipe-text-muted)',
};

const statusRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 14px',
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
};

const providerBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '14px 16px',
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  color: 'var(--pipe-text, #fff)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  fontFamily: '"Space Mono", monospace',
  cursor: 'pointer',
};

const disconnectBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  background: 'rgba(248,113,113,0.08)',
  border: '1px solid rgba(248,113,113,0.2)',
  color: '#f87171',
  fontSize: 9,
  letterSpacing: '0.1em',
  fontFamily: '"Space Mono", monospace',
  cursor: 'pointer',
  borderRadius: 4,
};

const smallBtn: React.CSSProperties = {
  padding: '6px 12px',
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  color: 'var(--pipe-text-dim)',
  fontSize: 9,
  letterSpacing: '0.1em',
  fontFamily: '"Space Mono", monospace',
  cursor: 'pointer',
  borderRadius: 4,
};
