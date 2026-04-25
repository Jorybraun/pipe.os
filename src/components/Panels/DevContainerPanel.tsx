/**
 * DevContainerPanel
 *
 * Renders a code-server dev container inside the candidate assessment flow.
 * ADR-037: the panel is selected by the CODE_IMPLEMENTATION blueprint when a
 * challenge has `devContainerRepoUrl` set. Mounts a session via
 * `useDevContainerSession` on first render and swaps to a proxied iframe
 * once the container reaches READY.
 */

import { useEffect, useRef, useState } from 'react';
import { useDevContainerSession } from '../../hooks/useDevContainerSession';

export interface DevContainerPanelProps {
  challengeId: string;
}

function formatRemaining(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function DevContainerPanel({ challengeId }: DevContainerPanelProps): JSX.Element {
  const { state, containerUrl, error, expiresAt, expiringSoon, launch, destroy, reset } =
    useDevContainerSession();

  // Auto-launch exactly once when the panel mounts and there is no live
  // session. React strict-mode double-invokes effects in dev, so we guard
  // with a ref instead of relying on `state === 'IDLE'`.
  const launchedRef = useRef(false);
  useEffect(() => {
    if (launchedRef.current) return;
    if (state !== 'IDLE') return;
    launchedRef.current = true;
    void launch({ challengeId });
  }, [challengeId, launch, state]);

  // Tick every second while a session is live so the countdown re-renders.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const remaining = formatRemaining(expiresAt);

  if (state === 'ERROR') {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0c0c0e',
          color: '#f87171',
          fontFamily: '"Space Mono", monospace',
          padding: 32,
          gap: 16,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: '0.2em', fontWeight: 700 }}>
          DEV CONTAINER ERROR
        </div>
        <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', maxWidth: 480, textAlign: 'center' }}>
          {error ?? 'The dev environment could not start.'}
        </div>
        <button
          onClick={() => {
            launchedRef.current = false;
            reset();
          }}
          style={{
            padding: '10px 20px',
            background: 'rgba(248,113,113,0.15)',
            border: '1px solid rgba(248,113,113,0.4)',
            color: '#f87171',
            fontSize: 11,
            letterSpacing: '0.15em',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          RETRY
        </button>
      </div>
    );
  }

  if (state === 'READY' && containerUrl) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0c0c0e',
          fontFamily: '"Space Mono", monospace',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            background: 'var(--pipe-surface)',
            borderBottom: '1px solid var(--pipe-border)',
            fontSize: 10,
            letterSpacing: '0.15em',
            color: 'var(--pipe-text-dim)',
          }}
        >
          <span style={{ color: '#4ade80' }}>● DEV CONTAINER LIVE</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {remaining && (
              <span style={{ color: expiringSoon ? '#fbbf24' : 'var(--pipe-text-dim)' }}>
                TTL {remaining}
              </span>
            )}
            <button
              onClick={() => void destroy()}
              style={{
                padding: '4px 12px',
                background: 'transparent',
                border: '1px solid rgba(248,113,113,0.4)',
                color: '#f87171',
                fontSize: 9,
                letterSpacing: '0.15em',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              END SESSION
            </button>
          </div>
        </div>
        {expiringSoon && (
          <div
            role="alert"
            style={{
              padding: '8px 16px',
              background: 'rgba(251,191,36,0.08)',
              borderBottom: '1px solid rgba(251,191,36,0.4)',
              fontSize: 11,
              color: '#fbbf24',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            ⚠ SESSION ENDING SOON — save your work, the container will be destroyed in ~{remaining ?? '1:00'}.
          </div>
        )}
        <iframe
          src={containerUrl}
          title="code-server dev environment"
          style={{ flex: 1, width: '100%', border: 'none', background: '#1e1e2e' }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation"
        />
      </div>
    );
  }

  // LAUNCHING / BOOTING / IDLE (first paint before auto-launch effect runs)
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0c0c0e',
        color: 'var(--pipe-text, #fff)',
        fontFamily: '"Space Mono", monospace',
        gap: 16,
      }}
    >
      <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'var(--pipe-text-dim)' }}>
        PROVISIONING DEV ENVIRONMENT
      </div>
      <div style={{ fontSize: 12, color: '#fbbf24', letterSpacing: '0.1em' }}>
        {state === 'LAUNCHING' ? 'LAUNCHING…' : state === 'BOOTING' ? 'BOOTING CODE-SERVER…' : 'STARTING…'}
      </div>
      <div
        style={{
          width: 240,
          height: 2,
          background: 'var(--pipe-surface-hover)',
          borderRadius: 1,
          overflow: 'hidden',
          marginTop: 8,
        }}
      >
        <div
          style={{
            height: '100%',
            background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
            borderRadius: 1,
            animation: 'devcontainer-indeterminate 2s linear infinite',
            width: '40%',
          }}
        />
        <style>{`
          @keyframes devcontainer-indeterminate {
            0%   { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        `}</style>
      </div>
      <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginTop: 16, maxWidth: 360, textAlign: 'center' }}>
        The first boot may take 20–30 seconds while the container image warms up.
      </div>
    </div>
  );
}
