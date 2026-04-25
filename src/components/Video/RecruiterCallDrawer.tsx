/**
 * RecruiterCallDrawer — sidebar panel for managing video calls.
 *
 * Three views:
 *   1. CallList — upcoming/active scheduled interviews for today
 *   2. CallDetail — pre-call device check + START button
 *   3. ActiveCall — live video streams + controls
 *
 * Renders in Layout's agentPanel slot.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, ChevronLeft, User } from 'lucide-react';
import { useScheduledInterviews } from '../../hooks/useScheduledInterviews';
import { useVideoRoom } from '../../hooks/useVideoRoom';
import type { ScheduledInterview } from '../../lib/scheduling/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RecruiterCallDrawerProps {
  onClose: () => void;
}

type DrawerView = 'list' | 'detail' | 'active';

// ─── Styles ─────────────────────────────────────────────────────────────────

const HEADER_STYLE: React.CSSProperties = {
  padding: '16px 20px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: '"Space Mono", monospace',
};

const LIST_ITEM: React.CSSProperties = {
  padding: '12px 20px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  cursor: 'pointer',
  transition: 'background 0.15s',
  fontFamily: '"Space Mono", monospace',
};

const STATUS_COLORS: Record<string, string> = {
  INVITED: '#fbbf24',
  SCHEDULED: '#60a5fa',
  COMPLETED: '#4ade80',
  CANCELLED: '#f87171',
  NO_SHOW: '#9ca3af',
};

// ─── Component ──────────────────────────────────────────────────────────────

export function RecruiterCallDrawer({ onClose }: RecruiterCallDrawerProps): React.ReactElement {
  const [view, setView] = useState<DrawerView>('list');
  const [selectedInterview, setSelectedInterview] = useState<ScheduledInterview | null>(null);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', color: '#e0e0e0' }}>
      {view === 'list' && (
        <CallListView
          onSelect={(interview) => {
            setSelectedInterview(interview);
            setView('detail');
          }}
          onClose={onClose}
        />
      )}
      {view === 'detail' && selectedInterview && (
        <CallDetailView
          interview={selectedInterview}
          onBack={() => setView('list')}
          onCallStarted={() => setView('active')}
        />
      )}
      {view === 'active' && selectedInterview && (
        <ActiveCallView
          interview={selectedInterview}
          onBack={() => setView('list')}
          onEnded={() => {
            setView('list');
            setSelectedInterview(null);
          }}
        />
      )}
    </div>
  );
}

// ─── CallListView ───────────────────────────────────────────────────────────

function CallListView({
  onSelect,
  onClose,
}: {
  onSelect: (interview: ScheduledInterview) => void;
  onClose: () => void;
}): React.ReactElement {
  const { interviews, isLoading } = useScheduledInterviews();

  // Filter to today's interviews and upcoming ones
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const relevant = interviews.filter((i) => {
    if (i.status === 'CANCELLED' || i.status === 'NO_SHOW') return false;
    if (!i.scheduledAt) return i.status === 'INVITED' || i.status === 'SCHEDULED';
    return i.scheduledAt.slice(0, 10) >= todayStr;
  });

  return (
    <>
      <div style={HEADER_STYLE}>
        <Phone size={16} />
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>CALLS</span>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#888',
            cursor: 'pointer', padding: 4,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && (
          <div style={{ padding: 20, color: '#666', fontSize: 12 }}>Loading...</div>
        )}
        {!isLoading && relevant.length === 0 && (
          <div style={{ padding: 20, color: '#666', fontSize: 12 }}>
            No upcoming calls
          </div>
        )}
        {relevant.map((interview) => (
          <div
            key={interview.id}
            style={LIST_ITEM}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            onClick={() => onSelect(interview)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <User size={14} style={{ color: '#888' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {interview.candidateId.slice(0, 8)}...
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: `${STATUS_COLORS[interview.status ?? 'INVITED']}20`,
                  color: STATUS_COLORS[interview.status ?? 'INVITED'],
                  fontWeight: 600,
                }}
              >
                {interview.status}
              </span>
            </div>
            {interview.scheduledAt && (
              <div style={{ fontSize: 11, color: '#666' }}>
                {new Date(interview.scheduledAt).toLocaleString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── CallDetailView ─────────────────────────────────────────────────────────

function CallDetailView({
  interview,
  onBack,
  onCallStarted,
}: {
  interview: ScheduledInterview;
  onBack: () => void;
  onCallStarted: () => void;
}): React.ReactElement {
  const [candidatePresent, setCandidatePresent] = useState(false);

  // Poll DO /status to detect candidate presence
  useEffect(() => {
    const sessionId = `${interview.stageId}--${interview.candidateId}`;
    let cancelled = false;

    const checkPresence = async (): Promise<void> => {
      try {
        const clerkToken = await getClerkTokenForRoom();
        const res = await fetch(`${API_BASE}/api/v1/video/sessions/${sessionId}/status`, {
          headers: clerkToken ? { Authorization: `Bearer ${clerkToken}` } : {},
        });
        if (res.ok) {
          const data = await res.json() as { peers: number };
          if (!cancelled) setCandidatePresent(data.peers > 0);
        }
      } catch {
        // Ignore — session may not exist yet
      }
    };

    void checkPresence();
    const interval = setInterval(() => void checkPresence(), 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [interview.stageId, interview.candidateId]);

  return (
    <>
      <div style={HEADER_STYLE}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', color: '#888',
            cursor: 'pointer', padding: 4,
          }}
        >
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>CALL DETAIL</span>
      </div>
      <div style={{ padding: 20, flex: 1 }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>CANDIDATE</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{interview.candidateId.slice(0, 8)}...</div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>STAGE</div>
          <div style={{ fontSize: 14 }}>{interview.stageId.slice(0, 8)}...</div>
        </div>
        {interview.scheduledAt && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>SCHEDULED</div>
            <div style={{ fontSize: 14 }}>
              {new Date(interview.scheduledAt).toLocaleString()}
            </div>
          </div>
        )}

        {/* Candidate presence indicator */}
        <div style={{
          marginBottom: 20, padding: 16,
          background: candidatePresent
            ? 'rgba(52,211,153,0.06)'
            : 'rgba(255,255,255,0.02)',
          border: `1px solid ${candidatePresent ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 4, fontSize: 12,
          color: candidatePresent ? '#34d399' : '#888',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: candidatePresent ? '#34d399' : '#555',
            boxShadow: candidatePresent ? '0 0 8px rgba(52,211,153,0.5)' : 'none',
          }} />
          {candidatePresent
            ? 'Candidate is in the room'
            : 'Waiting for candidate to join...'}
        </div>

        <button
          onClick={candidatePresent ? onCallStarted : undefined}
          disabled={!candidatePresent}
          style={{
            width: '100%', padding: '12px 0',
            background: candidatePresent ? '#4ade80' : '#333',
            color: candidatePresent ? '#0c0c0e' : '#666',
            border: 'none', borderRadius: 4,
            fontFamily: '"Space Mono", monospace',
            fontWeight: 700, fontSize: 13,
            cursor: candidatePresent ? 'pointer' : 'not-allowed',
            letterSpacing: '0.5px',
          }}
        >
          {candidatePresent ? 'START CALL' : 'WAITING FOR CANDIDATE...'}
        </button>
      </div>
    </>
  );
}

// ─── ActiveCallView ─────────────────────────────────────────────────────────

function ActiveCallView({
  interview,
  onEnded,
}: {
  interview: ScheduledInterview;
  onBack: () => void;
  onEnded: () => void;
}): React.ReactElement {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Defer WS connect until after DO /init completes to avoid stale state
  const computedSessionId = `${interview.stageId}--${interview.candidateId}`;
  const [sessionReady, setSessionReady] = useState(false);

  const room = useVideoRoom({
    sessionId: sessionReady ? computedSessionId : null,
    role: 'RECRUITER',
  });

  // Init DO session first, THEN allow WS connect
  useEffect(() => {
    let cancelled = false;
    const init = async (): Promise<void> => {
      await room.initMedia();
      // Create/reset the DO session via the existing API endpoint
      try {
        const clerkToken = await getClerkTokenForRoom();
        await fetch(`${API_BASE}/api/v1/video/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(clerkToken ? { Authorization: `Bearer ${clerkToken}` } : {}),
          },
          body: JSON.stringify({ stageId: interview.stageId, candidateId: interview.candidateId }),
        });
      } catch (err) {
        console.error('[ActiveCallView] Failed to create session:', err);
      }
      if (!cancelled) setSessionReady(true);
    };
    void init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach streams to video elements
  useEffect(() => {
    if (localVideoRef.current && room.localStream) {
      localVideoRef.current.srcObject = room.localStream;
    }
  }, [room.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && room.remoteStream) {
      remoteVideoRef.current.srcObject = room.remoteStream;
    }
  }, [room.remoteStream]);

  // Auto-end notification
  useEffect(() => {
    if (room.phase === 'ended') onEnded();
  }, [room.phase, onEnded]);

  const canCall = room.phase === 'peer_connected';
  const isConnected = room.phase === 'connected';
  const isWaiting = room.phase === 'waiting' || room.phase === 'disconnected';
  const statusLabel = isConnected ? 'LIVE' : canCall ? 'READY' : room.phase.toUpperCase();

  return (
    <>
      <div style={HEADER_STYLE}>
        <button
          onClick={() => {
            void room.hangUp();
            onEnded();
          }}
          style={{
            background: 'none', border: 'none', color: '#888',
            cursor: 'pointer', padding: 4,
          }}
        >
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>
          {statusLabel}
        </span>
        {isConnected && (
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#4ade80', animation: 'pulse 2s infinite',
          }} />
        )}
      </div>

      {/* START CALL button when candidate is present but call hasn't started */}
      {canCall && (
        <div style={{ padding: 20 }}>
          <button
            onClick={() => void room.startCall()}
            style={{
              width: '100%', padding: '12px 0',
              background: '#4ade80', color: '#0c0c0e',
              border: 'none', borderRadius: 4,
              fontFamily: '"Space Mono", monospace',
              fontWeight: 700, fontSize: 13,
              cursor: 'pointer', letterSpacing: '0.5px',
            }}
          >
            START CALL
          </button>
        </div>
      )}

      {/* Remote video (main) */}
      <div style={{ flex: 1, position: 'relative', background: '#000', minHeight: 200 }}>
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {!room.remoteStream && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#666', fontSize: 12,
          }}>
            {isWaiting ? 'Waiting for candidate...' : canCall ? 'Ready to call' : 'Connecting...'}
          </div>
        )}

        {/* Local video (self-view, bottom-right) */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute', bottom: 8, right: 8,
            width: 100, height: 75, objectFit: 'cover',
            borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)',
          }}
        />
      </div>

      {/* Controls */}
      <div style={{
        padding: '12px 20px',
        display: 'flex', justifyContent: 'center', gap: 12,
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        <button
          onClick={room.toggleCamera}
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: room.cameraEnabled ? 'rgba(255,255,255,0.1)' : '#f87171',
            border: 'none', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {room.cameraEnabled ? <Video size={16} /> : <VideoOff size={16} />}
        </button>
        <button
          onClick={room.toggleMic}
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: room.micEnabled ? 'rgba(255,255,255,0.1)' : '#f87171',
            border: 'none', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {room.micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
        </button>
        <button
          onClick={() => {
            void room.hangUp();
            onEnded();
          }}
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: '#f87171',
            border: 'none', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <PhoneOff size={16} />
        </button>
      </div>
    </>
  );
}

// Helper to get Clerk token for session creation
async function getClerkTokenForRoom(): Promise<string | null> {
  try {
    const clerk = (window as unknown as { Clerk?: { session?: { getToken: () => Promise<string> } } }).Clerk;
    return clerk?.session ? await clerk.session.getToken() : null;
  } catch { return null; }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';
