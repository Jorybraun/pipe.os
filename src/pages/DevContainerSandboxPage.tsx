/**
 * DevContainerSandboxPage
 *
 * Isolated prototype route for testing the AWS Fargate + code-server lifecycle.
 * Route: /sandbox/dev-container (protected, inside AppLayout)
 *
 * Purpose:
 *   1. Prove that ECS.RunTask spin-up works end-to-end.
 *   2. Confirm the ALB routes traffic to the correct container.
 *   3. Validate automatic teardown on Destroy / timeout.
 *
 * Once the lifecycle is stable, the logic will be extracted into
 * <SystemEnvironmentShell> and integrated into CandidateAssessmentPage.
 */

import { useDevContainerSession } from '../hooks/useDevContainerSession';
import type { ContainerSessionState } from '../hooks/useDevContainerSession';
import React from 'react';
import { useData } from '../providers';

// ─── Status label + color mapping ────────────────────────────────────────────

const STATUS_LABELS: Record<ContainerSessionState, string> = {
  IDLE: 'IDLE — No environment running',
  LAUNCHING: 'LAUNCHING — Calling ECS.RunTask…',
  BOOTING: 'BOOTING — Waiting for real-time status update…',
  READY: 'READY — code-server is live',
  DESTROYING: 'DESTROYING — Stopping Fargate task…',
  ERROR: 'ERROR',
};

const STATUS_COLORS: Record<ContainerSessionState, string> = {
  IDLE: 'rgba(255,255,255,0.3)',
  LAUNCHING: '#fbbf24',
  BOOTING: '#fbbf24',
  READY: '#4ade80',
  DESTROYING: '#f87171',
  ERROR: '#f87171',
};

// ─── Pulse dot for active states ─────────────────────────────────────────────

function PulseDot({ color }: { color: string }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 6px ${color}`,
        marginRight: 8,
        flexShrink: 0,
      }}
    />
  );
}

// ─── Progress bar for booting state ──────────────────────────────────────────

function BootProgressBar(): JSX.Element {
  return (
    <div
      style={{
        width: '100%',
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
          animation: 'indeterminate 2s linear infinite',
          width: '40%',
        }}
      />
      <style>{`
        @keyframes indeterminate {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

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

export default function DevContainerSandboxPage(): JSX.Element {
  const {
    state,
    containerUrl,
    taskArn,
    error,
    expiresAt,
    expiringSoon,
    launch,
    destroy,
    reset,
  } = useDevContainerSession();
  const dataFactory = useData();
  const [logs, setLogs] = React.useState<string[]>([]);
  const [autoRefreshLogs, setAutoRefreshLogs] = React.useState(true);

  // Tick every second while a session is live so the countdown re-renders.
  const [, setNow] = React.useState(0);
  React.useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const remaining = formatRemaining(expiresAt);

  // Fetch logs when we have a taskArn
  React.useEffect(() => {
    console.log('[DevContainerSandboxPage] Log fetch effect triggered:', { taskArn, autoRefreshLogs });
    if (!taskArn || !autoRefreshLogs) {
      console.log('[DevContainerSandboxPage] Skipping log fetch - missing taskArn or autoRefresh disabled');
      return;
    }

    const fetchLogs = async () => {
      const client = dataFactory.createClient();
      console.log('[DevContainerSandboxPage] Fetching logs for taskArn:', taskArn);
      try {
        const getContainerLogs = client.queries['getContainerLogs'];
        if (!getContainerLogs) throw new Error('getContainerLogs query not available');
        const { data, errors } = await getContainerLogs({ taskArn, limit: 50 });
        console.log('[DevContainerSandboxPage] getContainerLogs response:', { data, errors });
        if (errors) throw new Error(errors[0]?.message ?? 'Unknown error');
        const result = JSON.parse(data as string);
        console.log('[DevContainerSandboxPage] Parsed result:', result);
        if (result.logs) setLogs(result.logs);
      } catch (err) {
        console.error('[DevContainerSandboxPage] Failed to fetch logs:', err);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [taskArn, autoRefreshLogs, dataFactory]);

  const isActive = state === 'LAUNCHING' || state === 'BOOTING';
  const statusColor = STATUS_COLORS[state];

  return (
    <div
      style={{
        minHeight: '100%',
        background: '#0c0c0e',
        color: 'var(--pipe-text, #fff)',
        fontFamily: '"Space Mono", monospace',
        padding: '40px 48px',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.25em',
            color: 'var(--pipe-text-dim)',
            marginBottom: 8,
          }}
        >
          SANDBOX / DEV CONTAINER
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: '0.05em',
            margin: 0,
            marginBottom: 8,
          }}
        >
          AWS FARGATE PROTOTYPE
        </h1>
        <p
          style={{
            fontSize: 11,
            color: 'var(--pipe-text-dim)',
            lineHeight: 1.7,
            margin: 0,
            maxWidth: 600,
          }}
        >
          Isolated lifecycle test for the Fargate + code-server pipeline. Launch
          a container, verify the iframe renders, then destroy it. Once stable,
          this will be extracted into{' '}
          <code style={{ color: 'var(--pipe-accent)' }}>SystemEnvironmentShell</code>.
        </p>
      </div>

      {/* ── Status card ─────────────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--pipe-surface)',
          border: '1px solid var(--pipe-border)',
          borderRadius: 2,
          padding: '20px 24px',
          marginBottom: 24,
          maxWidth: 720,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <PulseDot color={statusColor} />
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.15em',
              color: statusColor,
              fontWeight: 700,
            }}
          >
            {STATUS_LABELS[state]}
          </span>
        </div>

        {isActive && <BootProgressBar />}

        {taskArn && (
          <div
            style={{
              marginTop: 12,
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              letterSpacing: '0.05em',
              wordBreak: 'break-all',
            }}
          >
            TASK ARN: {taskArn}
          </div>
        )}

        {remaining && (state === 'READY' || state === 'BOOTING') && (
          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: expiringSoon ? '#fbbf24' : 'var(--pipe-text-dim)',
              letterSpacing: '0.1em',
              fontWeight: 700,
            }}
          >
            TTL REMAINING: {remaining}
          </div>
        )}

        {expiringSoon && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: '10px 14px',
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.4)',
              borderRadius: 2,
              fontSize: 11,
              color: '#fbbf24',
              lineHeight: 1.5,
            }}
          >
            ⚠ SESSION ENDING SOON — save your work, the container will be destroyed in ~{remaining ?? '1:00'}.
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: '#f87171',
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* ── Action buttons ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        {(state === 'IDLE' || state === 'ERROR') && (
          <button
            onClick={() => {
              if (state === 'ERROR') reset();
              else void launch();
            }}
            style={{
              padding: '14px 28px',
              background:
                state === 'ERROR'
                  ? 'rgba(248,113,113,0.15)'
                  : 'linear-gradient(135deg, var(--pipe-accent-surface), var(--pipe-accent-surface))',
              border: `1px solid ${state === 'ERROR' ? 'rgba(248,113,113,0.4)' : 'var(--pipe-accent-surface)'}`,
              color: state === 'ERROR' ? '#f87171' : 'var(--pipe-accent)',
              fontSize: 11,
              letterSpacing: '0.15em',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {state === 'ERROR' ? 'RESET' : 'LAUNCH ENVIRONMENT'}
          </button>
        )}

        {state === 'READY' && (
          <>
            <button
              onClick={destroy}
              style={{
                padding: '14px 28px',
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
              DESTROY ENVIRONMENT
            </button>
            {containerUrl && (
              <a
                href={containerUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '14px 28px',
                  background: 'transparent',
                  border: '1px solid rgba(74,222,128,0.3)',
                  color: '#4ade80',
                  fontSize: 11,
                  letterSpacing: '0.15em',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                OPEN IN NEW TAB ↗
              </a>
            )}
          </>
        )}

        {(state === 'LAUNCHING' || state === 'BOOTING' || state === 'DESTROYING') && (
          <button
            disabled
            style={{
              padding: '14px 28px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text-dim)',
              fontSize: 11,
              letterSpacing: '0.15em',
              fontWeight: 700,
              cursor: 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            {state === 'DESTROYING' ? 'DESTROYING…' : 'LAUNCHING…'}
          </button>
        )}
      </div>

      {/* ── code-server iframe (visible only when READY) ─────────────── */}
      {state === 'READY' && containerUrl && (
        <div
          style={{
            border: '1px solid rgba(74,222,128,0.2)',
            borderRadius: 2,
            overflow: 'hidden',
            maxWidth: '100%',
          }}
        >
          <div
            style={{
              background: 'rgba(74,222,128,0.05)',
              padding: '8px 16px',
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'rgba(74,222,128,0.6)',
              borderBottom: '1px solid rgba(74,222,128,0.1)',
            }}
          >
            CODE-SERVER — {containerUrl}
          </div>
          <iframe
            src={containerUrl}
            title="code-server dev environment"
            style={{
              width: '100%',
              height: 600,
              border: 'none',
              display: 'block',
              background: '#1e1e2e',
            }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation"
          />
        </div>
      )}

      {/* ── Container logs ──────────────────────────────────────────── */}
      {taskArn && (
        <div
          style={{
            marginTop: 32,
            border: '1px solid var(--pipe-border)',
            borderRadius: 2,
            overflow: 'hidden',
            maxWidth: '100%',
          }}
        >
          <div
            style={{
              background: 'var(--pipe-surface)',
              padding: '12px 16px',
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
              borderBottom: '1px solid var(--pipe-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>CONTAINER LOGS (CloudWatch)</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoRefreshLogs}
                onChange={(e) => setAutoRefreshLogs(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: 9 }}>AUTO-REFRESH</span>
            </label>
          </div>
          <div
            style={{
              background: '#0a0a0c',
              padding: '16px',
              fontFamily: '"Courier New", monospace',
              fontSize: 11,
              color: '#00ff00',
              maxHeight: 300,
              overflowY: 'auto',
              lineHeight: 1.6,
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.3)' }}>
                {autoRefreshLogs ? 'Waiting for logs...' : 'Enable auto-refresh to see container logs...'}
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i}>{log}</div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Architecture notes ──────────────────────────────────────── */}
      <div
        style={{
          marginTop: 48,
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingTop: 32,
          maxWidth: 720,
        }}
      >
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            marginBottom: 16,
          }}
        >
          ARCHITECTURE NOTES
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--pipe-text-dim)',
            lineHeight: 1.8,
          }}
        >
          <div>• Launch → ECS.RunTask (Fargate, 1 vCPU / 2 GB RAM)</div>
          <div>• Status → ECS Task State Change → EventBridge → ecsStatusBridge Lambda → AppSync subscription (real-time, &lt;2 s)</div>
          <div>• Fallback → ECS poll every 5 s (catches missed events after page refresh or AppSync multi-auth delivery gap)</div>
          <div>• Ready → ALB routes /session/:id → container port 8080</div>
          <div>• Destroy → ECS.StopTask + automatic 60-min session timeout</div>
          <div>• Cost → ~$0.05 per 60-min interview session</div>
          <div style={{ marginTop: 8, color: 'var(--pipe-accent)' }}>
            ADR-016 — docs/decisions/historical/ADR-016-dev-container-architecture.md
          </div>
        </div>
      </div>
    </div>
  );
}
