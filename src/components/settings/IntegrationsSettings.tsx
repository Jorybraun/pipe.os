/**
 * IntegrationsSettings — Scheduling provider connection management.
 *
 * Panel-friendly layout for:
 * 1. Connecting Calendly / Cal.com via OAuth
 * 2. Viewing connection status
 * 3. Selecting event types for scheduling links
 * 4. Disconnecting
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Link2,
  Unlink,
  CheckCircle,
  AlertCircle,
  Loader,
  Calendar,
  ExternalLink,
  RefreshCw,
  Phone,
  Mail,
} from 'lucide-react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../../lib/api/client';
import { useSchedulingConnection } from '../../hooks/useSchedulingConnection';
import type { SchedulingConnectionInfo, ProviderEventType } from '../../hooks/useSchedulingConnection';
import { useEmailConnection } from '../../hooks/useEmailConnection';
import { getAllPlugins } from '../../lib/scheduling/pluginRegistry';
import type { SchedulingPlugin } from '../../lib/scheduling/pluginRegistry';
// Side-effect import: registers Calendly + Cal.com plugins
import '../../components/Scheduling/provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowState =
  | { step: 'idle' }
  | { step: 'waiting'; provider: string }
  | { step: 'exchanging'; provider: string }
  | { step: 'error'; message: string }
  | { step: 'connected' };

// ---------------------------------------------------------------------------
// IntegrationsSettings
// ---------------------------------------------------------------------------

export function IntegrationsSettings(): JSX.Element {
  const {
    connection,
    isLoading,
    error: hookError,
    exchangeOAuth,
    fetchEventTypes,
    disconnect,
    refetch,
  } = useSchedulingConnection();

  const {
    connection: emailConnection,
    isLoading: emailLoading,
    error: emailHookError,
    exchangeOAuth: exchangeEmailOAuth,
    disconnect: disconnectEmail,
    refetch: refetchEmail,
  } = useEmailConnection();

  const { getToken } = useClerkAuth();
  const navigate = useNavigate();

  const [flow, setFlow] = useState<FlowState>({ step: 'idle' });
  const [emailFlow, setEmailFlow] = useState<FlowState>({ step: 'idle' });
  const [isDisconnectingEmail, setIsDisconnectingEmail] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [eventTypes, setEventTypes] = useState<ProviderEventType[]>([]);

  // Twilio phone connection state
  const [twilioConnected, setTwilioConnected] = useState(false);
  const [twilioPhone, setTwilioPhone] = useState<string | null>(null);
  const [twilioLoading, setTwilioLoading] = useState(true);
  const [loadingEventTypes, setLoadingEventTypes] = useState(false);

  const plugins = getAllPlugins();
  const redirectUri = `${window.location.origin}/schedule`;

  // ── Handle OAuth callback ─────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const stateRaw = params.get('state');

    if (!code || !stateRaw) return;

    let providerId: string;
    try {
      const parsed = JSON.parse(atob(stateRaw)) as { providerId: string; nonce: string; type?: string };
      // Skip email OAuth callbacks — handled by the email callback effect
      if (parsed.type === 'email') return;
      providerId = parsed.providerId;

      const storedNonce = sessionStorage.getItem('pipe_oauth_state_nonce');
      sessionStorage.removeItem('pipe_oauth_state_nonce');
      if (!storedNonce || storedNonce !== parsed.nonce) {
        setFlow({ step: 'error', message: 'OAuth state mismatch — please try again' });
        return;
      }
    } catch {
      setFlow({ step: 'error', message: 'Invalid OAuth callback state' });
      return;
    }

    // Clean URL
    window.history.replaceState({}, '', `${window.location.origin}${window.location.pathname}`);

    const codeVerifier = sessionStorage.getItem('pipe_oauth_code_verifier') ?? undefined;
    sessionStorage.removeItem('pipe_oauth_code_verifier');

    setFlow({ step: 'exchanging', provider: providerId });
    exchangeOAuth(providerId as 'CALENDLY' | 'CAL_COM', code, redirectUri, codeVerifier)
      .then(() => {
        setFlow({ step: 'connected' });
        void refetch();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Exchange failed';
        setFlow({ step: 'error', message: msg });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load event types when connected ────────────────────────────────────
  useEffect(() => {
    if (!connection || connection.status !== 'ACTIVE') return;
    setLoadingEventTypes(true);
    fetchEventTypes(connection.id)
      .then(setEventTypes)
      .catch(() => setEventTypes([]))
      .finally(() => setLoadingEventTypes(false));
  }, [connection?.id, connection?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Check Twilio connection ────────────────────────────────────────────
  useEffect(() => {
    const api = createApiClient({ getToken });
    api.get<{ connected: boolean; phoneNumber: string | null }>('/api/v1/phone/connection')
      .then((data) => {
        setTwilioConnected(data.connected);
        setTwilioPhone(data.phoneNumber);
      })
      .catch(() => {
        setTwilioConnected(false);
      })
      .finally(() => setTwilioLoading(false));
  }, [getToken]);

  // ── Handle Email OAuth callback ────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const stateRaw = params.get('state');

    if (!code || !stateRaw) return;

    let parsed: { providerId: string; nonce: string; type?: string };
    try {
      parsed = JSON.parse(atob(stateRaw)) as { providerId: string; nonce: string; type?: string };
    } catch {
      return; // scheduling callback handler will pick this up
    }

    // Only handle email OAuth callbacks
    if (parsed.type !== 'email') return;

    const storedNonce = sessionStorage.getItem('pipe_email_oauth_nonce');
    sessionStorage.removeItem('pipe_email_oauth_nonce');
    if (!storedNonce || storedNonce !== parsed.nonce) {
      setEmailFlow({ step: 'error', message: 'OAuth state mismatch — please try again' });
      return;
    }

    window.history.replaceState({}, '', `${window.location.origin}${window.location.pathname}`);

    const codeVerifier = sessionStorage.getItem('pipe_email_oauth_verifier') ?? undefined;
    sessionStorage.removeItem('pipe_email_oauth_verifier');

    setEmailFlow({ step: 'exchanging', provider: parsed.providerId });
    exchangeEmailOAuth(
      parsed.providerId as 'GMAIL' | 'MICROSOFT',
      code,
      `${window.location.origin}/outreach`,
      codeVerifier,
    )
      .then(() => {
        setEmailFlow({ step: 'connected' });
        void refetchEmail();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Exchange failed';
        setEmailFlow({ step: 'error', message: msg });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────

const handleEmailDisconnect = useCallback(async (): Promise<void> => {
    setIsDisconnectingEmail(true);
    try {
      await disconnectEmail();
      setEmailFlow({ step: 'idle' });
    } catch {
      setEmailFlow({ step: 'error', message: 'Failed to disconnect' });
    } finally {
      setIsDisconnectingEmail(false);
    }
  }, [disconnectEmail]);

  const handleConnect = useCallback((plugin: SchedulingPlugin): void => {
    if (!plugin.getAuthUrl) {
      setFlow({ step: 'error', message: `${plugin.label} does not support OAuth` });
      return;
    }

    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const state = btoa(JSON.stringify({ providerId: plugin.type, nonce }));
    sessionStorage.setItem('pipe_oauth_state_nonce', nonce);

    const authUrl = plugin.getAuthUrl!(redirectUri, state);
    setFlow({ step: 'waiting', provider: plugin.type });
    window.location.href = authUrl;
  }, [redirectUri]);

  const handleDisconnect = useCallback(async (conn: SchedulingConnectionInfo): Promise<void> => {
    setIsDisconnecting(true);
    try {
      await disconnect(conn.id);
      setFlow({ step: 'idle' });
      setEventTypes([]);
    } catch {
      setFlow({ step: 'error', message: 'Failed to disconnect' });
    } finally {
      setIsDisconnecting(false);
    }
  }, [disconnect]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={labelSmall}>Loading connection...</span>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Section: Scheduling Provider */}
      <div>
        <label style={sectionLabel}>SCHEDULING_PROVIDER</label>
        <p style={descriptionStyle}>
          Connect your calendar to auto-sync interviews and send scheduling links to candidates.
        </p>

        {/* Exchanging state */}
        {flow.step === 'exchanging' && (
          <div style={statusCard}>
            <Loader size={14} style={{ animation: 'spin 1s linear infinite', color: '#60a5fa' }} />
            <span style={labelSmall}>Connecting to {flow.provider.replace('_', '.')}...</span>
          </div>
        )}

        {/* Error state */}
        {(flow.step === 'error' || hookError) && (
          <div style={{ ...statusCard, borderColor: 'rgba(248,113,113,0.2)' }}>
            <AlertCircle size={14} color="#f87171" />
            <span style={{ ...labelSmall, color: '#f87171' }}>
              {flow.step === 'error' ? flow.message : hookError?.message ?? 'Unknown error'}
            </span>
            <button onClick={() => setFlow({ step: 'idle' })} style={smallButton}>
              TRY AGAIN
            </button>
          </div>
        )}

        {/* Connected state */}
        {connection && connection.status === 'ACTIVE' && flow.step !== 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ ...statusCard, borderColor: 'rgba(74,222,128,0.2)' }}>
              <CheckCircle size={14} color="#4ade80" />
              <div style={{ flex: 1 }}>
                <div style={{ ...labelSmall, color: '#4ade80', marginBottom: 2 }}>
                  {connection.providerId?.replace('_', '.') ?? 'Provider'}
                </div>
                {connection.accountEmail && (
                  <div style={{ ...labelSmall, color: 'var(--pipe-text-dim)', fontSize: 9 }}>
                    {connection.accountEmail}
                  </div>
                )}
              </div>
              <button
                onClick={() => handleDisconnect(connection)}
                disabled={isDisconnecting}
                style={disconnectBtn}
              >
                {isDisconnecting ? (
                  <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Unlink size={10} />
                )}
                DISCONNECT
              </button>
            </div>

            {connection.lastSyncAt && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
                <RefreshCw size={10} color="var(--pipe-text-dim)" />
                <span style={{ ...labelSmall, fontSize: 9, color: 'var(--pipe-text-dim)' }}>
                  Last sync: {new Date(connection.lastSyncAt).toLocaleString(undefined, {
                    dateStyle: 'short', timeStyle: 'short',
                  })}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Expired state */}
        {connection && connection.status === 'EXPIRED' && (
          <div style={{ ...statusCard, borderColor: 'rgba(251,191,36,0.2)' }}>
            <AlertCircle size={14} color="#fbbf24" />
            <span style={{ ...labelSmall, color: '#fbbf24', flex: 1 }}>
              Connection expired — reconnect to resume
            </span>
            {plugins.map((plugin) => (
              <button key={plugin.type} onClick={() => handleConnect(plugin)} style={connectBtn}>
                <Link2 size={10} />
                RECONNECT
              </button>
            ))}
          </div>
        )}

        {/* Not connected — show provider buttons */}
        {!connection && flow.step !== 'exchanging' && flow.step !== 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plugins.map((plugin) => (
              <button
                key={plugin.type}
                onClick={() => handleConnect(plugin)}
                style={providerButton}
              >
                <Calendar size={14} />
                <span style={{ flex: 1, textAlign: 'left' }}>
                  CONNECT {plugin.label.toUpperCase()}
                </span>
                <ExternalLink size={10} color="var(--pipe-text-dim)" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Section: Event Types */}
      {connection && connection.status === 'ACTIVE' && (
        <div>
          <label style={sectionLabel}>EVENT_TYPES</label>
          <p style={descriptionStyle}>
            Available event types from your connected calendar. These are used when generating scheduling links for candidates.
          </p>

          {loadingEventTypes && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
              <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={labelSmall}>Loading event types...</span>
            </div>
          )}

          {!loadingEventTypes && eventTypes.length === 0 && (
            <div style={{
              padding: '16px',
              background: 'var(--pipe-surface)',
              border: '1px dashed var(--pipe-border)',
              borderRadius: 6,
              textAlign: 'center',
            }}>
              <span style={{ ...labelSmall, color: 'var(--pipe-text-dim)' }}>
                No event types found. Create one in your calendar provider first.
              </span>
            </div>
          )}

          {!loadingEventTypes && eventTypes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {eventTypes.map((et) => (
                <div key={et.id} style={eventTypeRow}>
                  <Calendar size={12} color="var(--pipe-text-dim)" />
                  <div style={{ flex: 1 }}>
                    <div style={{ ...labelSmall, color: 'var(--pipe-text, #fff)', fontWeight: 600 }}>
                      {et.name}
                    </div>
                    <div style={{ ...labelSmall, color: 'var(--pipe-text-dim)', fontSize: 9 }}>
                      {et.duration} min
                    </div>
                  </div>
                  <a
                    href={et.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--pipe-text-dim)', padding: 4 }}
                  >
                    <ExternalLink size={10} />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Section: Email Provider (Send-As) */}
      <div>
        <label style={sectionLabel}>EMAIL_PROVIDER</label>
        <p style={descriptionStyle}>
          Connect your Gmail or Microsoft account to send candidate emails from your own address instead of the default platform address.
        </p>

        {emailLoading && (
          <div style={statusCard}>
            <Loader size={14} style={{ animation: 'spin 1s linear infinite', color: '#60a5fa' }} />
            <span style={labelSmall}>Checking email connection...</span>
          </div>
        )}

        {/* Exchanging state */}
        {emailFlow.step === 'exchanging' && (
          <div style={statusCard}>
            <Loader size={14} style={{ animation: 'spin 1s linear infinite', color: '#60a5fa' }} />
            <span style={labelSmall}>Connecting to {emailFlow.provider}...</span>
          </div>
        )}

        {/* Error state */}
        {(emailFlow.step === 'error' || emailHookError) && (
          <div style={{ ...statusCard, borderColor: 'rgba(248,113,113,0.2)' }}>
            <AlertCircle size={14} color="#f87171" />
            <span style={{ ...labelSmall, color: '#f87171' }}>
              {emailFlow.step === 'error' ? emailFlow.message : emailHookError?.message ?? 'Unknown error'}
            </span>
            <button onClick={() => setEmailFlow({ step: 'idle' })} style={smallButton}>
              TRY AGAIN
            </button>
          </div>
        )}

        {/* Connected state */}
        {!emailLoading && emailConnection && emailConnection.status === 'ACTIVE' && emailFlow.step !== 'error' && (
          <div style={{ ...statusCard, borderColor: 'rgba(74,222,128,0.2)' }}>
            <CheckCircle size={14} color="#4ade80" />
            <div style={{ flex: 1 }}>
              <div style={{ ...labelSmall, color: '#4ade80', marginBottom: 2 }}>
                {emailConnection.providerId === 'GMAIL' ? 'GMAIL' : 'MICROSOFT OUTLOOK'}
              </div>
              <div style={{ ...labelSmall, color: 'var(--pipe-text-dim)', fontSize: 9 }}>
                {emailConnection.accountEmail}
              </div>
            </div>
            <button
              onClick={() => void handleEmailDisconnect()}
              disabled={isDisconnectingEmail}
              style={disconnectBtn}
            >
              {isDisconnectingEmail ? (
                <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Unlink size={10} />
              )}
              DISCONNECT
            </button>
          </div>
        )}

        {/* Expired state */}
        {!emailLoading && emailConnection && emailConnection.status === 'EXPIRED' && (
          <div style={{ ...statusCard, borderColor: 'rgba(251,191,36,0.2)' }}>
            <AlertCircle size={14} color="#fbbf24" />
            <span style={{ ...labelSmall, color: '#fbbf24', flex: 1 }}>
              Connection expired — reconnect to resume
            </span>
            <button onClick={() => navigate('/outreach')} style={connectBtn}>
              <Link2 size={10} />
              RECONNECT
            </button>
          </div>
        )}

        {/* Not connected — redirect to /outreach to connect */}
        {!emailLoading && !emailConnection && emailFlow.step !== 'exchanging' && emailFlow.step !== 'error' && (
          <button
            onClick={() => navigate('/outreach')}
            style={providerButton}
          >
            <Mail size={14} />
            <span style={{ flex: 1, textAlign: 'left' }}>CONNECT EMAIL PROVIDER</span>
            <ExternalLink size={10} color="var(--pipe-text-dim)" />
          </button>
        )}
      </div>

      {/* Section: Phone Screening */}
      <div>
        <label style={sectionLabel}>PHONE_SCREENING</label>
        <p style={descriptionStyle}>
          Twilio powers browser-to-phone calling for candidate screening. Calls are recorded and transcribed automatically.
        </p>

        {twilioLoading ? (
          <div style={statusCard}>
            <Loader size={14} style={{ animation: 'spin 1s linear infinite', color: '#60a5fa' }} />
            <span style={labelSmall}>Checking phone configuration...</span>
          </div>
        ) : twilioConnected ? (
          <div style={statusCard}>
            <CheckCircle size={14} color="#4ade80" />
            <div style={{ flex: 1 }}>
              <div style={{ ...labelSmall, color: '#4ade80' }}>CONNECTED</div>
              {twilioPhone && (
                <div style={{ ...labelSmall, color: 'var(--pipe-text-dim)', marginTop: 2, fontSize: 10, fontWeight: 600 }}>
                  <Phone size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  {twilioPhone}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={statusCard}>
            <AlertCircle size={14} color="var(--pipe-text-dim)" />
            <div style={{ flex: 1 }}>
              <div style={{ ...labelSmall, color: 'var(--pipe-text-dim)' }}>NOT_CONFIGURED</div>
              <div style={{ ...labelSmall, color: 'var(--pipe-text-dim)', marginTop: 2, fontSize: 9, opacity: 0.7 }}>
                Set TWILIO_* environment variables in Worker secrets to enable phone screening.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.15em',
  color: 'var(--pipe-text-dim)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 8,
};

const descriptionStyle: React.CSSProperties = {
  fontSize: 10,
  lineHeight: 1.6,
  color: 'var(--pipe-text-muted)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 12,
  marginTop: 0,
};

const labelSmall: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.03em',
  fontFamily: '"Space Mono", monospace',
  color: 'var(--pipe-text-muted)',
};

const statusCard: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 14px',
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
};

const providerButton: React.CSSProperties = {
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
  transition: 'all 0.15s',
};

const connectBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  background: 'rgba(96,165,250,0.12)',
  border: '1px solid rgba(96,165,250,0.25)',
  color: '#60a5fa',
  fontSize: 9,
  letterSpacing: '0.1em',
  fontFamily: '"Space Mono", monospace',
  cursor: 'pointer',
  borderRadius: 4,
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

const smallButton: React.CSSProperties = {
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

const eventTypeRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
};
