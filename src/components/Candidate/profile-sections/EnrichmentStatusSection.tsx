/**
 * EnrichmentStatusSection — status badge + metadata rows.
 */

import { Github, AlertCircle, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../../';

interface IngestionRetryResult {
  scanned: number;
  queued: number;
  skipped: number;
  failed: number;
}

interface EnrichmentStatusSectionProps {
  props: {
    status?: string;
    modelUsed?: string | null;
    profileVersion?: string | null;
    decompositionVersion?: string | null;
    lastEnrichedAt?: string | null;
    profileGeneratedAt?: string | null;
    profileEmbeddedAt?: string | null;
    matchedAt?: string | null;
    errorText?: string | null;
    enrichmentJobStatus?: string | null;
    githubUrl?: string | null;
  };
  onRetryFailedIngestion?: (() => Promise<void>) | undefined;
  isRetryingIngestion?: boolean | undefined;
  retryIngestionError?: string | null | undefined;
  retryIngestionResult?: IngestionRetryResult | null | undefined;
}

function getStatusBadge(status: string) {
  const config: Record<
    string,
    { icon: React.ReactNode; color: string; bg: string; border: string; label: string }
  > = {
    pending: {
      icon: <Clock size={10} />,
      color: '#9ca3af',
      bg: 'rgba(156,163,175,0.1)',
      border: 'rgba(156,163,175,0.25)',
      label: 'PENDING',
    },
    profile_generated: {
      icon: <CheckCircle size={10} />,
      color: '#60a5fa',
      bg: 'rgba(96,165,250,0.1)',
      border: 'rgba(96,165,250,0.25)',
      label: 'PROFILE GENERATED',
    },
    embedded: {
      icon: <CheckCircle size={10} />,
      color: '#60a5fa',
      bg: 'rgba(96,165,250,0.1)',
      border: 'rgba(96,165,250,0.25)',
      label: 'EMBEDDED',
    },
    matched: {
      icon: <CheckCircle size={10} />,
      color: '#10b981',
      bg: 'rgba(16,185,129,0.1)',
      border: 'rgba(16,185,129,0.25)',
      label: 'MATCHED',
    },
    failed: {
      icon: <XCircle size={10} />,
      color: '#f87171',
      bg: 'rgba(248,113,113,0.1)',
      border: 'rgba(248,113,113,0.25)',
      label: 'FAILED',
    },
  };

  const c = config[status] ?? config.pending!;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        color: c.color,
        letterSpacing: '0.08em',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <span
        style={{
          fontSize: 9,
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--pipe-text)',
          fontFamily: '"Space Mono", monospace',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function EnrichmentStatusSection({
  props,
  onRetryFailedIngestion,
  isRetryingIngestion = false,
  retryIngestionError = null,
  retryIngestionResult = null,
}: EnrichmentStatusSectionProps): JSX.Element {
  const {
    status = 'pending',
    modelUsed,
    lastEnrichedAt,
    profileGeneratedAt,
    profileEmbeddedAt,
    matchedAt,
    errorText,
    enrichmentJobStatus,
    githubUrl,
  } = props;

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <SubTitle>ENRICHMENT STATUS</SubTitle>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {getStatusBadge(status)}
          {enrichmentJobStatus && (
            <span
              style={{
                fontSize: 9,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.08em',
              }}
            >
              JOB: {enrichmentJobStatus}
            </span>
          )}
        </div>

        {githubUrl && (
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: '#60a5fa',
              fontFamily: '"Space Mono", monospace',
              textDecoration: 'none',
            }}
          >
            <Github size={14} />
            {githubUrl.replace(/^https:\/\/github\.com\//, '')}
          </a>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lastEnrichedAt && (
            <MetaRow label="LAST ENRICHED" value={new Date(lastEnrichedAt).toLocaleString()} />
          )}
          {matchedAt && <MetaRow label="MATCHED AT" value={new Date(matchedAt).toLocaleString()} />}
          {profileGeneratedAt && (
            <MetaRow label="PROFILE GENERATED" value={new Date(profileGeneratedAt).toLocaleString()} />
          )}
          {profileEmbeddedAt && (
            <MetaRow label="PROFILE EMBEDDED" value={new Date(profileEmbeddedAt).toLocaleString()} />
          )}
          {modelUsed && <MetaRow label="MODEL" value={modelUsed.toUpperCase()} />}
          {props.profileVersion && <MetaRow label="PROFILE VERSION" value={props.profileVersion} />}
          {props.decompositionVersion && <MetaRow label="DECOMPOSITION VERSION" value={props.decompositionVersion} />}
        </div>

        {errorText && (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '12px 16px',
                background: 'rgba(248,113,113,0.06)',
                border: '1px solid rgba(248,113,113,0.15)',
                borderRadius: 6,
              }}
            >
              <AlertCircle size={14} color="#f87171" style={{ marginTop: 2, flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 11,
                  color: '#f87171',
                  lineHeight: 1.5,
                  fontFamily: '"Space Mono", monospace',
                  flex: 1,
                }}
              >
                {errorText}
              </span>
              {onRetryFailedIngestion && (
                <button
                  type="button"
                  onClick={() => void onRetryFailedIngestion()}
                  disabled={isRetryingIngestion}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '7px 10px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    borderRadius: 4,
                    color: 'var(--pipe-text)',
                    fontSize: 8,
                    fontWeight: 800,
                    letterSpacing: '0.12em',
                    fontFamily: '"Space Mono", monospace',
                    cursor: isRetryingIngestion ? 'wait' : 'pointer',
                    opacity: isRetryingIngestion ? 0.62 : 1,
                    flexShrink: 0,
                  }}
                >
                  <RefreshCw
                    size={11}
                    style={{ animation: isRetryingIngestion ? 'spin 1s linear infinite' : undefined }}
                  />
                  RETRY_FAILED
                </button>
              )}
            </div>
            {(retryIngestionError || retryIngestionResult) && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 10,
                  color: retryIngestionError ? '#fca5a5' : 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {retryIngestionError
                  ?? `Scanned ${retryIngestionResult?.scanned ?? 0}; queued ${retryIngestionResult?.queued ?? 0}; skipped ${retryIngestionResult?.skipped ?? 0}; failed ${retryIngestionResult?.failed ?? 0}.`}
              </div>
            )}
          </div>
        )}
      </div>
    </LiquidMetalCard>
  );
}
