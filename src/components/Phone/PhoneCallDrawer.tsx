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
  Phone, PhoneOff, Mic, MicOff, X, Loader, Delete,
} from 'lucide-react';
import { useClerkAuth } from '../../providers/clerk';
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
  const { getToken } = useClerkAuth();
  const twilio = useTwilioDevice();
  const [view, setView] = useState<DrawerView>('pre-call');
  const [callId, setCallId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [dialError, setDialError] = useState<string | null>(null);

  const handleDial = useCallback(async (numberToCall: string): Promise<void> => {
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
      await twilio.connect(numberToCall);
      setView('active');
    } catch (err) {
      console.error('[PhoneCallDrawer] Dial failed:', err);
      setDialError(err instanceof Error ? err.message : 'Failed to initiate call');
    }
  }, [getToken, candidateId, pipelineId, twilio]);

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
         aria-label="Close">
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
          onDial={(n) => void handleDial(n)}
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
          onSendDigits={twilio.sendDigits}
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

// ─── Shared Dialpad ─────────────────────────────────────────────────────────

const DIAL_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
] as const;

const KEY_SUB: Record<string, string> = {
  '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO',
  '7': 'PQRS', '8': 'TUV', '9': 'WXYZ', '0': '+', '1': '', '*': '', '#': '',
};

function Dialpad({ onKey }: { onKey: (k: string) => void }): React.ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {DIAL_KEYS.flat().map((key) => (
        <button
          key={key}
          onClick={() => onKey(key)}
          style={{
            height: 52,
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--pipe-text)',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            transition: 'background 0.1s',
            fontFamily: '"Space Mono", monospace',
          }}
          onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'; }}
          onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{key}</span>
          {KEY_SUB[key] && (
            <span style={{ fontSize: 7, color: 'var(--pipe-text-dim)', letterSpacing: '0.1em' }}>
              {KEY_SUB[key]}
            </span>
          )}
        </button>
      ))}
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
  onDial: (number: string) => void;
}): React.ReactElement {
  const [input, setInput] = useState(phoneNumber);

  const handleKey = (k: string): void => {
    setInput((prev) => prev + k);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px', gap: 16, overflowY: 'auto' }}>
      {/* Candidate info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: '#4ade80',
        }}>
          {candidateName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{candidateName}</div>
        </div>
      </div>

      {/* Number display */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--pipe-border)',
        borderRadius: 6,
      }}>
        <span style={{
          flex: 1, fontSize: 18, fontWeight: 700, letterSpacing: '0.06em',
          fontVariantNumeric: 'tabular-nums', color: 'var(--pipe-text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {input || <span style={{ color: 'var(--pipe-text-dim)', fontWeight: 400, fontSize: 13 }}>enter number</span>}
        </span>
        {input && (
          <button
            onClick={() => setInput((prev) => prev.slice(0, -1))}
            style={{ background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer', padding: 2 }}
          >
            <Delete size={16} />
          </button>
        )}
      </div>

      {/* Status / error */}
      {!isReady && !error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--pipe-text-dim)', letterSpacing: '0.1em' }}>
          <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} />
          CONNECTING_DEVICE...
        </div>
      )}
      {error && (
        <div style={{ padding: '8px 10px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 4, fontSize: 9, color: '#f87171' }}>
          {error}
        </div>
      )}

      {/* Dialpad */}
      <Dialpad onKey={handleKey} />

      {/* Call button */}
      <button
        onClick={() => onDial(input)}
        disabled={!isReady || isConnecting || !input}
        style={{
          height: 52, borderRadius: 8, border: 'none',
          background: isReady && !isConnecting && input ? '#4ade80' : 'rgba(74,222,128,0.15)',
          color: isReady && !isConnecting && input ? '#0c0c0e' : 'rgba(74,222,128,0.4)',
          cursor: isReady && !isConnecting && input ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
          fontFamily: '"Space Mono", monospace',
          transition: 'all 0.2s',
        }}
      >
        {isConnecting
          ? <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> DIALING...</>
          : <><Phone size={16} /> CALL</>}
      </button>
    </div>
  );
}

// ─── Active Call View ───────────────────────────────────────────────────────

function ActiveCallView({ candidateName, phoneNumber, duration, isMuted, onToggleMute, onHangUp, onSendDigits }: {
  candidateName: string;
  phoneNumber: string;
  duration: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onHangUp: () => void;
  onSendDigits: (digits: string) => void;
}): React.ReactElement {
  const [showDialpad, setShowDialpad] = useState(false);
  const [dtmfInput, setDtmfInput] = useState('');

  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const handleDtmfKey = (k: string): void => {
    setDtmfInput((prev) => prev + k);
    onSendDigits(k);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px', gap: 16 }}>
      {/* Timer + caller */}
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <div style={{ fontSize: 32, fontWeight: 700, color: '#4ade80', letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums' }}>
          {timeStr}
        </div>
        <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', marginTop: 4 }}>{candidateName}</div>
        <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', opacity: 0.6, marginTop: 2 }}>{phoneNumber}</div>
      </div>

      {/* Recording indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 8, color: '#f87171', letterSpacing: '0.12em' }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f87171', animation: 'pulse 1.5s ease-in-out infinite' }} />
        RECORDING
      </div>

      {/* DTMF input display — shown when dialpad is open */}
      {showDialpad && (
        <div style={{
          padding: '8px 14px', background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--pipe-border)', borderRadius: 6,
          fontSize: 18, fontWeight: 700, letterSpacing: '0.1em',
          fontVariantNumeric: 'tabular-nums', minHeight: 42,
          color: dtmfInput ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
          textAlign: 'center',
        }}>
          {dtmfInput || <span style={{ fontSize: 11, fontWeight: 400 }}>keypad input</span>}
        </div>
      )}

      {/* Dialpad */}
      {showDialpad && <Dialpad onKey={handleDtmfKey} />}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
        {/* Mute */}
        <button
          onClick={onToggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          style={{
            flex: 1, height: 48, borderRadius: 8, border: 'none',
            background: isMuted ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.06)',
            color: isMuted ? '#f87171' : '#e0e0e0',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', fontFamily: '"Space Mono", monospace',
          }}
        >
          {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
          {isMuted ? 'MUTED' : 'MUTE'}
        </button>

        {/* Dialpad toggle */}
        <button
          onClick={() => setShowDialpad((v) => !v)}
          title="Keypad"
          style={{
            flex: 1, height: 48, borderRadius: 8, border: 'none',
            background: showDialpad ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.06)',
            color: showDialpad ? '#4ade80' : '#e0e0e0',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', fontFamily: '"Space Mono", monospace',
          }}
        >
          <span style={{ fontSize: 15 }}>⌨</span> PAD
        </button>

        {/* Hang up */}
        <button
          onClick={onHangUp}
          aria-label="Hang up"
          style={{
            flex: 1, height: 48, borderRadius: 8, border: 'none',
            background: '#f87171', color: '#0c0c0e',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', fontFamily: '"Space Mono", monospace',
          }}
        >
          <PhoneOff size={15} /> END
        </button>
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
