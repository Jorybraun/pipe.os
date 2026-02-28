import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoSignaling } from '../../hooks/useVideoSignaling';
import { useVideoSession } from '../../hooks/useVideoSession';
import { VideoDeviceCheck } from '../Video/VideoDeviceCheck';
import { VideoWaitingRoom } from '../Video/VideoWaitingRoom';
import { VideoIncomingCall } from '../Video/VideoIncomingCall';
import { VideoFloatingPiP } from '../Video/VideoFloatingPiP';
import type { VideoRole, VideoSignalType, VideoSignalPayload, SdpPayload, IceCandidatePayload } from '../../lib/video/types';

// ============================================================================
// Types
// ============================================================================

interface VideoShellProps {
  stageId: string;
  candidateId: string;
  /** Role of the current user. Candidate views come from /assess/:token. */
  role: VideoRole;
  children: React.ReactNode;
}

type DevicePhase = 'check' | 'ready';

// ============================================================================
// Component
// ============================================================================

/**
 * VideoShell — Stage-level wrapper that orchestrates the full video interview
 * lifecycle: device check → waiting room → call → active session → ended.
 *
 * When the session is idle/waiting/calling, this renders a waiting room screen.
 * Once ACTIVE, the challenge workspace (children) is shown behind a floating PiP.
 *
 * Signal routing:
 *  - OFFER  → candidate calls acceptCall()
 *  - ANSWER → recruiter calls _handleAnswer() (internal to useVideoSession)
 *  - ICE_CANDIDATE → both peers call addIceCandidate()
 *  - HANGUP → both peers call hangUp()
 */
export function VideoShell({
  stageId,
  candidateId,
  role,
  children,
}: VideoShellProps): JSX.Element {
  const [devicePhase, setDevicePhase] = useState<DevicePhase>('check');
  const [localStreamReady, setLocalStreamReady] = useState(false);

  // ---- Signaling hook (AppSync) -------------------------------------------

  const handleSignal = useCallback(
    (type: VideoSignalType, payload: VideoSignalPayload) => {
      // Dispatch to the WebRTC hook based on signal type
      // We use a ref to the session hook to avoid stale closures
      sessionHookRef.current?.dispatch(type, payload);
    },
    []
  );

  const signaling = useVideoSignaling({
    stageId,
    candidateId,
    role,
    onSignal: handleSignal,
  });

  // ---- WebRTC session hook ------------------------------------------------

  const handleSessionEnded = useCallback(() => {
    void signaling.markEnded();
  }, [signaling]);

  const session = useVideoSession({
    role,
    sendSignal: signaling.sendSignal,
    onEnded: handleSessionEnded,
  });

  // Bridge: expose a dispatcher to the signal handler above
  const sessionHookRef = useRef<{
    dispatch: (type: VideoSignalType, payload: VideoSignalPayload) => void;
  } | null>(null);

  useEffect(() => {
    sessionHookRef.current = {
      dispatch: (type, payload) => {
        if (type === 'OFFER' && role === 'CANDIDATE') {
          void session.acceptCall(payload as SdpPayload);
          void signaling.markActive();
        } else if (type === 'ANSWER' && role === 'RECRUITER') {
          // _handleAnswer is attached by useVideoSession for the recruiter
          const hook = session as unknown as {
            _handleAnswer?: (answer: SdpPayload) => Promise<void>;
          };
          if (hook._handleAnswer) {
            void hook._handleAnswer(payload as SdpPayload);
            void signaling.markActive();
          }
        } else if (type === 'ICE_CANDIDATE') {
          void session.addIceCandidate(payload as IceCandidatePayload);
        } else if (type === 'HANGUP') {
          void session.hangUp();
        }
      },
    };
  }, [session, signaling, role]);

  // ---- Handlers -----------------------------------------------------------

  const handleDeviceReady = useCallback(
    async (_stream: MediaStream): Promise<void> => {
      // The stream is already acquired inside VideoDeviceCheck + initMedia call below.
      // We just need to confirm init succeeded before advancing phase.
      const ok = await session.initMedia();
      if (ok) {
        setDevicePhase('ready');
        setLocalStreamReady(true);

        // Recruiter: create the session record in WAITING state
        if (role === 'RECRUITER' && !signaling.session) {
          await signaling.createSession();
        }
      }
    },
    [session, role, signaling]
  );

  const handleCall = useCallback(async (): Promise<void> => {
    await session.startCall();
    await signaling.markCalling();
  }, [session, signaling]);

  const handleAcceptIncomingCall = useCallback(async (): Promise<void> => {
    // The OFFER signal will trigger acceptCall via the signal dispatcher.
    // We just need to acknowledge the incoming call UI was dismissed.
    // acceptCall is driven by the OFFER signal already received.
  }, []);

  const handleDeclineCall = useCallback(async (): Promise<void> => {
    await signaling.markEnded();
  }, [signaling]);

  const handleHangUp = useCallback(async (): Promise<void> => {
    await session.hangUp();
    await signaling.markEnded();
  }, [session, signaling]);

  // ---- Derived state ------------------------------------------------------

  const sessionStatus = signaling.status;
  const connectionState = session.connectionState;
  const isConnected = connectionState === 'connected';
  const isIncomingCall =
    role === 'CANDIDATE' && sessionStatus === 'CALLING';
  const isCandidatePresent =
    role === 'RECRUITER' && sessionStatus !== null; // Session exists → candidate loaded the page

  // ---- Render: Device check phase -----------------------------------------

  if (devicePhase === 'check') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0c0c0e',
        }}
      >
        <VideoDeviceCheck
          onReady={(stream) => void handleDeviceReady(stream)}
          onError={(errType) => {
            console.error('[VideoShell] Device check failed:', errType);
            // Fall through: allow page to render but without video
            setDevicePhase('ready');
          }}
        />
      </div>
    );
  }

  // ---- Render: Waiting / pre-call phase -----------------------------------

  if (!isConnected && !isIncomingCall) {
    // Show waiting room if session is idle, WAITING, or CALLING from recruiter side
    const showWaiting =
      sessionStatus === null ||
      sessionStatus === 'WAITING' ||
      (role === 'RECRUITER' && sessionStatus === 'CALLING');

    if (showWaiting) {
      return (
        <VideoWaitingRoom
          localStream={localStreamReady ? session.localStream : null}
          isRecruiterWaiting={sessionStatus === 'WAITING' || sessionStatus === 'CALLING'}
          isCandidatePresent={isCandidatePresent}
          onCall={role === 'RECRUITER' ? () => void handleCall() : undefined}
          role={role}
        />
      );
    }
  }

  // ---- Render: Incoming call overlay (candidate) --------------------------

  // ---- Render: Active session — challenge workspace + floating PiP --------

  return (
    <div style={{ position: 'relative' }}>
      {/* Incoming call overlay */}
      {isIncomingCall && (
        <VideoIncomingCall
          onAccept={() => void handleAcceptIncomingCall()}
          onDecline={() => void handleDeclineCall()}
        />
      )}

      {/* Challenge workspace */}
      {children}

      {/* Floating PiP (only once connected) */}
      {isConnected && (
        <VideoFloatingPiP
          localStream={session.localStream}
          remoteStream={session.remoteStream}
          cameraEnabled={session.cameraEnabled}
          micEnabled={session.micEnabled}
          onToggleCamera={session.toggleCamera}
          onToggleMic={session.toggleMic}
          onHangUp={() => void handleHangUp()}
        />
      )}
    </div>
  );
}
