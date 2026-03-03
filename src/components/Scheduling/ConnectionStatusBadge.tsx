import { CheckCircle, AlertCircle, XCircle } from 'lucide-react';

interface ConnectionStatusBadgeProps {
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | null;
  providerLabel?: string;
}

const STATUS_CONFIG: Record<string, {
  icon: typeof CheckCircle;
  color: string;
  bg: string;
  border: string;
  label: string;
}> = {
  ACTIVE: {
    icon: CheckCircle,
    color: '#4ade80',
    bg: 'rgba(74,222,128,0.08)',
    border: 'rgba(74,222,128,0.2)',
    label: 'CONNECTED',
  },
  EXPIRED: {
    icon: AlertCircle,
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.2)',
    label: 'EXPIRED',
  },
  REVOKED: {
    icon: XCircle,
    color: '#f87171',
    bg: 'rgba(248,113,113,0.08)',
    border: 'rgba(248,113,113,0.2)',
    label: 'DISCONNECTED',
  },
};

/**
 * ConnectionStatusBadge — small inline indicator for the scheduling
 * provider connection status. Follows the same visual pattern as
 * InterviewStatusBadge.
 */
export function ConnectionStatusBadge({
  status,
  providerLabel,
}: ConnectionStatusBadgeProps): JSX.Element {
  const config = STATUS_CONFIG[status ?? ''] ?? STATUS_CONFIG['REVOKED'];
  const Icon   = config.icon;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        fontSize: 9,
        letterSpacing: '0.12em',
        fontFamily: '"Space Mono", monospace',
        color: config.color,
        background: config.bg,
        border: `1px solid ${config.border}`,
        borderRadius: 4,
      }}
      title={providerLabel ? `${providerLabel}: ${config.label}` : config.label}
    >
      <Icon size={10} />
      {config.label}
    </span>
  );
}
