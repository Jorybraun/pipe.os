/**
 * PhoneCallDrawer — sidebar panel for phone screening calls.
 *
 * Three views:
 *   1. PreCall — candidate info, phone number, DIAL button
 *   2. ActiveCall — duration timer, mute/end controls
 *   3. PostCall — duration summary, notes textarea, save
 *
 * Renders in Layout's agentPanel slot, same pattern as RecruiterCallDrawer.
 */

import React, { useState, useCallback } from 'react';
import {
  Phone, PhoneOff, Mic, MicOff, X, Loader,
} from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useTwilioDevice } from '../../hooks/useTwilioDevice';
import { createApiClient } from '../../lib/api/client';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PhoneCallDrawerProps {
  candidateId: string;
  candidateName: string;
  phoneNumber: string;
  pipelineId: string;
  onClose: () => void;
  onCallComplete?: () => void;
}

type DrawerView = 'pre-call' | 'active' | 'post-call';

// ─── Component ──────────────────────────────────────────────────────────────

export function PhoneCallDrawer({
  candidateId,
  candidateName,
  phoneNumber,
  pipelineId,
  onClose,
  onCallComplete,
}: PhoneCallDrawerProps): React.ReactElement {
  const { getToken } = useAuth();
  const twilio = useTwilioDevice();
  const [view, setView] = useState<DrawerView>('pre-call');
  const [callId, setCallId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [dialError, setDialError] = useState<string | null>(null);

  const handleDial = useCallback(async (): Promise<void> => {
    setDialError(null);
    try {
      // Create call record in D1 first
      const api = createApiClient({ getToken });
      const result = await api.post<{ call: { id: string } }>('/api/v1/phone/calls', {
        candidateId,
        pipelineId,
      });
      setCallId(result.call.id);

      // Initiate browser-to-phone call via Twilio SDK
      await twilio.connect(phoneNumber);
      setView('active');
    } catch (err) {
      console.error('[PhoneCallDrawer] Dial failed:', err);
      setDialError(err instanceof Error ? err.message : 'Failed to initiate call');
    }
  }, [getToken, candidateId, pipelineId, phoneNumber, twilio]);

  const handleHangUp = useCallback((): void => {
    twilio.disconnect();
    setView('post-call');
  }, [twilio]);

  const handleSaveNotes = useCallback(async (): Promise<void> => {
    if (!callId || !notes.trim()) {
      onCallComplete?.();
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      const api = createApiClient({ getToken });
      await api.patch(`/api/v1/phone/calls/${callId}`, { recruiterNotes: notes });
    } catch (err) {
      console.error('[PhoneCallDrawer] Save notes failed:', err);
    } finally {
      setIsSaving(false);
      onCallComplete?.();
      onClose();
    }
  }, [callId, notes, getToken, onCallComplete, onClose]);

  // If Twilio call disconnects while active, move to post-call
  if (view === 'active' && !twilio.isConnected && !twilio.isConnecting) {
    setView('post-call');
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      color: '#e0e0e0',
      fontFamily: '"Space Mono", monospace',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Phone size={14} color="#4ade80" />
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em' }}>
            PHONE_SCREEN
          </span>
        </div>
        <button
          onClick={view === 'active' ? handleHangUp : onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      {view === 'pre-call' && (
        <PreCallView
          candidateName={candidateName}
          phoneNumber={phoneNumber}
          isReady={twilio.isReady}
          isConnecting={twilio.isConnecting}
          error={twilio.error || dialError}
          onDial={() => void handleDial()}
        />
      )}
      {view === 'active' && (
        <ActiveCallView
          candidateName={candidateName}
          phoneNumber={phoneNumber}
          duration={twilio.callDuration}
          isMuted={twilio.isMuted}
          onToggleMute={twilio.toggleMute}
          onHangUp={handleHangUp}
        />
      )}
      {view === 'post-call' && (
        <PostCallView
          candidateName={candidateName}
          duration={twilio.callDuration}
          notes={notes}
          onNotesChange={setNotes}
          isSaving={isSaving}
          onSave={() => void handleSaveNotes()}
          onClose={onClose}
        />
      )}
    </div>
  );
}

// ─── Pre-Call View ──────────────────────────────────────────────────────────

function PreCallView({ candidateName, phoneNumber, isReady, isConnecting, error, onDial }: {
  candidateName: string;
  phoneNumber: string;
  isReady: boolean;
  isConnecting: boolean;
  error: string | null;
  onDial: () => void;
}): React.ReactElement {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
      padding: 32,
    }}>
      {/* Candidate info */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'rgba(74,222,128,0.12)',
          border: '2px solid rgba(74,222,128,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          fontSize: 20,
          fontWeight: 700,
          color: '#4ade80',
        }}>
          {candidateName.charAt(0).toUpperCase()}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          {candidateName}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)' }}>
          {phoneNumber}
        </div>
      </div>

      {/* Status */}
      {!isReady && !error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 9,
          color: 'var(--pipe-text-dim)',
          letterSpacing: '0.1em',
        }}>
          <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
          CONNECTING_DEVICE...
        </div>
      )}

      {error && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(248,113,113,0.08)',
          border: '1px solid rgba(248,113,113,0.2)',
          borderRadius: 4,
          fontSize: 9,
          color: '#f87171',
          textAlign: 'center',
          maxWidth: 240,
        }}>
          {error}
        </div>
      )}

      {/* Dial button */}
      <button
        onClick={onDial}
        disabled={!isReady || isConnecting}
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          border: 'none',
          background: isReady && !isConnecting ? '#4ade80' : 'rgba(74,222,128,0.2)',
          color: '#0c0c0e',
          cursor: isReady && !isConnecting ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s',
        }}
      >
        {isConnecting ? (
          <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
        ) : (
          <Phone size={24} />
        )}
      </button>
      <div style={{ fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.15em' }}>
        {isConnecting ? 'DIALING...' : 'TAP_TO_CALL'}
      </div>
    </div>
  );
}

// ─── Active Call View ───────────────────────────────────────────────────────

function ActiveCallView({ candidateName, phoneNumber, duration, isMuted, onToggleMute, onHangUp }: {
  candidateName: string;
  phoneNumber: string;
  duration: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onHangUp: () => void;
}): React.ReactElement {
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 32,
      padding: 32,
    }}>
      {/* Timer */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 36,
          fontWeight: 700,
          color: '#4ade80',
          letterSpacing: '0.08em',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {timeStr}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', marginTop: 8 }}>
          {candidateName}
        </div>
        <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', opacity: 0.6, marginTop: 2 }}>
          {phoneNumber}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 24 }}>
        {/* Mute */}
        <button
          onClick={onToggleMute}
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: 'none',
            background: isMuted ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.06)',
            color: isMuted ? '#f87171' : '#e0e0e0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        {/* Hang up */}
        <button
          onClick={onHangUp}
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: 'none',
            background: '#f87171',
            color: '#0c0c0e',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PhoneOff size={20} />
        </button>
      </div>

      {/* Recording indicator */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 8,
        color: '#f87171',
        letterSpacing: '0.12em',
      }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#f87171',
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
        RECORDING
      </div>
    </div>
  );
}

// ─── Post-Call View ─────────────────────────────────────────────────────────

function PostCallView({ candidateName, duration, notes, onNotesChange, isSaving, onSave, onClose }: {
  candidateName: string;
  duration: number;
  notes: string;
  onNotesChange: (v: string) => void;
  isSaving: boolean;
  onSave: () => void;
  onClose: () => void;
}): React.ReactElement {
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      padding: 20,
      gap: 20,
    }}>
      {/* Summary */}
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', letterSpacing: '0.15em', marginBottom: 8 }}>
          CALL_ENDED
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          {candidateName}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>
          {timeStr}
        </div>
      </div>

      {/* Notes */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '0.15em',
          color: 'var(--pipe-text-dim)',
        }}>
          RECRUITER_NOTES
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="How did the call go? Key observations, red flags, strengths..."
          style={{
            flex: 1,
            padding: 12,
            fontSize: 11,
            fontFamily: '"Space Mono", monospace',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: 'var(--pipe-text)',
            outline: 'none',
            resize: 'none',
            minHeight: 120,
          }}
        />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            padding: '10px 0',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            background: 'transparent',
            border: '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
          }}
        >
          SKIP
        </button>
        <button
          onClick={onSave}
          disabled={isSaving}
          style={{
            flex: 1,
            padding: '10px 0',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            background: 'rgba(74,222,128,0.12)',
            border: '1px solid rgba(74,222,128,0.3)',
            borderRadius: 4,
            color: '#4ade80',
            cursor: isSaving ? 'default' : 'pointer',
          }}
        >
          {isSaving ? 'SAVING...' : 'SAVE_NOTES'}
        </button>
      </div>
    </div>
  );
}
