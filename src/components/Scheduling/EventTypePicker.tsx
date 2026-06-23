/**
 * EventTypePicker — select a provider event type to associate with a pipeline.
 *
 * Fetches event types from the recruiter's SchedulingConnection via the
 * schedulingOAuth Lambda (tokens never leave the server). Shows a
 * dropdown for selection + persistence to Pipeline.schedulingEventTypeId.
 */

import { useState, useEffect, useCallback } from 'react';
import { Calendar, RefreshCw, AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { useSchedulingConnection } from '../../hooks/useSchedulingConnection';
import type { ProviderEventType, SchedulingConnectionInfo } from '../../hooks/useSchedulingConnection';

interface EventTypePickerProps {
  /** Currently saved event type ID on the pipeline, or null */
  currentEventTypeId: string | null | undefined;
  /** Callback when the recruiter selects a new event type */
  onSelect: (eventTypeId: string) => void;
}

/**
 * EventTypePicker — renders a styled dropdown of event types from the
 * recruiter's connected scheduling provider.
 *
 * When no connection exists, shows a prompt to connect first.
 * When loading fails, shows a retry button.
 */
export function EventTypePicker({
  currentEventTypeId,
  onSelect,
}: EventTypePickerProps): JSX.Element {
  const { connection, isLoading: connLoading, fetchEventTypes } = useSchedulingConnection();

  const [eventTypes, setEventTypes] = useState<ProviderEventType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEventTypes = useCallback(async (conn: SchedulingConnectionInfo) => {
    setLoading(true);
    setError(null);
    try {
      const types = await fetchEventTypes(conn.id);
      setEventTypes(types);
    } catch (err) {
      console.error('[EventTypePicker] Failed to fetch event types:', err);
      setError(err instanceof Error ? err.message : 'Failed to load event types');
    } finally {
      setLoading(false);
    }
  }, [fetchEventTypes]);

  useEffect(() => {
    if (connection && connection.status === 'ACTIVE') {
      loadEventTypes(connection);
    }
  }, [connection, loadEventTypes]);

  // No connection yet
  if (connLoading) {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} color="var(--pipe-text-dim)" />
          <span style={labelStyle}>Loading connection…</span>
        </div>
      </div>
    );
  }

  if (!connection || connection.status !== 'ACTIVE') {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--pipe-text-dim)' }}>
          <Calendar size={14} />
          <span style={labelStyle}>
            Connect a scheduling provider to assign event types
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} color="#fbbf24" />
          <span style={{ ...labelStyle, color: '#fbbf24' }}>{error}</span>
          <button
            onClick={() => loadEventTypes(connection)}
            style={retryButtonStyle}
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  // Loading event types
  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} color="var(--pipe-text-dim)" />
          <span style={labelStyle}>Fetching event types…</span>
        </div>
      </div>
    );
  }

  // No event types found
  if (eventTypes.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--pipe-text-dim)' }}>
          <AlertTriangle size={14} />
          <span style={labelStyle}>
            No event types found. Create one in {connection.providerId === 'CALENDLY' ? 'Calendly' : 'Cal.com'} first.
          </span>
        </div>
      </div>
    );
  }

  const selected = eventTypes.find((et) => et.id === currentEventTypeId);

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Calendar size={12} color="var(--pipe-text-dim)" />
        <span style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
          EVENT_TYPE
        </span>
        {selected && <Check size={10} color="#4ade80" />}
      </div>

      {/* Custom select wrapper */}
      <div style={{ position: 'relative' }}>
        <select
          value={currentEventTypeId ?? ''}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value);
          }}
          style={selectStyle}
        >
          <option value="">Select event type…</option>
          {eventTypes.map((et) => (
            <option key={et.id} value={et.id}>
              {et.name} ({et.duration} min)
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          color="var(--pipe-text-dim)"
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  padding: '12px 16px',
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: '"Space Mono", monospace',
  color: 'var(--pipe-text-muted)',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 28px 8px 10px',
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  borderRadius: 4,
  color: 'var(--pipe-text, #fff)',
  fontSize: 12,
  fontFamily: '"Space Mono", monospace',
  appearance: 'none',
  cursor: 'pointer',
  outline: 'none',
};

const retryButtonStyle: React.CSSProperties = {
  marginLeft: 8,
  padding: '4px 10px',
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  color: 'var(--pipe-text, #fff)',
  fontSize: 9,
  letterSpacing: '0.1em',
  fontFamily: '"Space Mono", monospace',
  cursor: 'pointer',
  borderRadius: 4,
};
