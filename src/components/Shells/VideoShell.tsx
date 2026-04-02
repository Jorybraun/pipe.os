import React, { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, X } from "lucide-react";
import { useVideoSignaling } from "../../hooks/useVideoSignaling";
import { useVideoSession } from "../../hooks/useVideoSession";
import { VideoFloatingPiP } from "../Video/VideoFloatingPiP";
import type {
  VideoRole,
  VideoSignalType,
  VideoSignalPayload,
  SdpPayload,
  IceCandidatePayload,
} from "../../lib/video/types";

// ============================================================================
// Types
// ============================================================================

interface VideoShellProps {
  stageId: string;
  candidateId: string;
  /** Role of the current user. RECRUITER = authenticated. CANDIDATE = /assess/:token. */
  role: VideoRole;
  children: React.ReactNode;
}

// ============================================================================
// Compact floating widget styles
// ============================================================================

const WIDGET_STYLE: React.CSSProperties = {
  position: "fixed",
  top: 20,
  right: 20,
  width: 280,
  zIndex: 9000,
  background: "#0c0c0e",
  border: "1px solid var(--pipe-border)",
  borderRadius: 8,
  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
  fontFamily: '"Space Mono", monospace',
};

const PILL_STYLE: React.CSSProperties = {
  position: "fixed",
  top: 20,
  right: 20,
  zIndex: 9000,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  background: "rgba(12,12,14,0.92)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 999,
  boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  fontFamily: '"Space Mono", monospace',
  fontSize: 9,
  letterSpacing: "0.12em",
  color: "var(--pipe-text-dim)",
};

// ============================================================================
// Component
// ============================================================================

/**
 * VideoShell — Non-blocking wrapper that adds a floating video call widget
 * in the top-right corner. Always renders {children} — never replaces page content.
 *
 * Follows the same composable pattern as TimerShell: wraps children, adds
 * its own floating UI as position:fixed overlay.
 *
 * Phases:
 *  RECRUITER: device-setup → waiting-for-candidate → calling → connected → ended
 *  CANDIDATE: device-setup → waiting-for-recruiter → incoming → connected → ended
 *
 * Signal routing:
 *  OFFER  → candidate calls acceptCall()
 *  ANSWER → recruiter _handleAnswer()
 *  ICE_CANDIDATE → both peers addIceCandidate()
 *  HANGUP → both peers hangUp()
 */
export function VideoShell({
  stageId,
  candidateId,
  role,
  children,
}: VideoShellProps): JSX.Element {
  const [deviceReady, setDeviceReady] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Deferred-accept: store the incoming OFFER for the candidate to accept
  // via user action instead of auto-accepting on signal arrival.
  const pendingOfferRef = useRef<SdpPayload | null>(null);
  const [hasPendingOffer, setHasPendingOffer] = useState(false);

  // ---- Signaling hook (AppSync) -------------------------------------------

  const handleSignal = useCallback(
    (type: VideoSignalType, payload: VideoSignalPayload) => {
      sessionHookRef.current?.dispatch(type, payload);
    },
    [],
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

  // Bridge: expose a dispatcher to the signal handler.
  //
  // OFFER → store for user action (candidate clicks ACCEPT).
  // ANSWER → recruiter processes immediately (recruiter already initiated).
  // ICE_CANDIDATE → both peers buffer/apply.
  // HANGUP → both peers clean up.
  const sessionHookRef = useRef<{
    dispatch: (type: VideoSignalType, payload: VideoSignalPayload) => void;
  } | null>(null);

  useEffect(() => {
    sessionHookRef.current = {
      dispatch: (type, payload) => {
        if (type === "OFFER" && role === "CANDIDATE") {
          // Store the offer — don't auto-accept. Candidate must click ACCEPT.
          pendingOfferRef.current = payload as SdpPayload;
          setHasPendingOffer(true);
        } else if (type === "ANSWER" && role === "RECRUITER") {
          const hook = session as unknown as {
            _handleAnswer?: (answer: SdpPayload) => Promise<void>;
          };
          if (hook._handleAnswer) {
            void hook._handleAnswer(payload as SdpPayload);
          }
        } else if (type === "ICE_CANDIDATE") {
          void session.addIceCandidate(payload as IceCandidatePayload);
        } else if (type === "HANGUP") {
          void session.hangUp();
        }
      },
    };
  }, [session, role]);

  // ---- Device init (non-blocking: happens in background) ------------------

  const handleDeviceReady = useCallback(async (): Promise<void> => {
    const ok = await session.initMedia();
    if (ok) {
      setDeviceReady(true);
      if (role === "RECRUITER" && !signaling.session) {
        await signaling.createSession();
      }
    } else {
      setDeviceError("Could not access camera/microphone.");
    }
  }, [session, role, signaling]);

  // Probe for device permission once on mount (silent, non-blocking)
  useEffect(() => {
    if (deviceReady || deviceError) return;
    void handleDeviceReady();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Handlers -----------------------------------------------------------

  /** Recruiter: initiate the call (create SDP offer + send via signaling) */
  const handleCall = useCallback(async (): Promise<void> => {
    await session.startCall();
    await signaling.markCalling();
  }, [session, signaling]);

  /** Candidate: accept the pending offer from the recruiter */
  const handleAccept = useCallback(async (): Promise<void> => {
    const offer = pendingOfferRef.current;
    if (!offer) return;
    pendingOfferRef.current = null;
    setHasPendingOffer(false);

    // Ensure camera is ready (in case the permission dialog was still open)
    if (!deviceReady) {
      const ok = await session.initMedia();
      if (!ok) {
        setDeviceError("Failed to start camera for call.");
        return;
      }
      setDeviceReady(true);
    }

    await session.acceptCall(offer);
    await signaling.markActive();
  }, [deviceReady, session, signaling]);

  const handleHangUp = useCallback(async (): Promise<void> => {
    await session.hangUp();
    await signaling.markEnded();
  }, [session, signaling]);

  const handleDecline = useCallback(async (): Promise<void> => {
    pendingOfferRef.current = null;
    setHasPendingOffer(false);
    await signaling.markEnded();
  }, [signaling]);

  // ---- Derived state ------------------------------------------------------

  const sessionStatus = signaling.status;
  const connectionState = session.connectionState;
  const isConnected = connectionState === "connected";
  const isEnded = sessionStatus === "ENDED" || connectionState === "ended";

  // Incoming call: candidate received an OFFER and hasn't acted yet
  const isIncomingCall =
    role === "CANDIDATE" && sessionStatus === "CALLING" && hasPendingOffer;

  // Recruiter calling: offer sent, waiting for candidate to accept
  const isCalling = role === "RECRUITER" && sessionStatus === "CALLING";

  // Waiting: session exists but call hasn't started, OR no session yet
  const isWaiting =
    sessionStatus === "WAITING" || (sessionStatus === null && !signaling.isLoading);

  // Connecting: call accepted (session ACTIVE) but WebRTC not yet connected
  const isConnecting =
    sessionStatus === "ACTIVE" && !isConnected && !isEnded;

  // ---- Render: always render children first, widget floats on top ----------

  return (
    <>
      {/* Page content — never replaced, always visible */}
      {children}

      {/* Pre-call widget (waiting / calling / incoming) — not during connecting phase */}
      {!dismissed && !isEnded && !isConnected && !isConnecting && (
        <VideoWidget
          role={role}
          deviceReady={deviceReady}
          deviceError={deviceError}
          isWaiting={isWaiting}
          isCalling={isCalling}
          isIncomingCall={isIncomingCall}
          onCall={handleCall}
          onAccept={handleAccept}
          onDecline={handleDecline}
          onDismiss={() => setDismissed(true)}
          localStream={session.localStream}
        />
      )}

      {/* Connecting indicator — ICE negotiation in progress */}
      {!dismissed && isConnecting && (
        <div style={PILL_STYLE}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "rgba(52,211,153,0.7)",
              boxShadow: "0 0 8px rgba(52,211,153,0.4)",
              animation: "pulse 1.5s infinite",
            }}
          />
          CONNECTING...
        </div>
      )}

      {/* Active call — VideoFloatingPiP is already position:fixed */}
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

      {/* Ended pill */}
      {isEnded && (
        <div style={PILL_STYLE}>
          <PhoneOff size={10} color="rgba(248,113,113,0.7)" />
          CALL_ENDED
        </div>
      )}
    </>
  );
}

// ============================================================================
// VideoWidget — compact floating panel for pre-call phases
// ============================================================================

interface VideoWidgetProps {
  role: VideoRole;
  deviceReady: boolean;
  deviceError: string | null;
  isWaiting: boolean;
  isCalling: boolean;
  isIncomingCall: boolean;
  localStream: MediaStream | null;
  onCall: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}

function VideoWidget({
  role,
  deviceReady,
  deviceError,
  isWaiting,
  isCalling,
  isIncomingCall,
  localStream,
  onCall,
  onAccept,
  onDecline,
  onDismiss,
}: VideoWidgetProps): JSX.Element | null {
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Candidate just sees a waiting-for-recruiter pill once devices are ready
  if (role === "CANDIDATE" && deviceReady && isWaiting && !isIncomingCall) {
    return (
      <div style={PILL_STYLE}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "rgba(96,165,250,0.7)",
            boxShadow: "0 0 6px rgba(96,165,250,0.5)",
            animation: "pulse 2s infinite",
          }}
        />
        LIVE_SESSION_READY
      </div>
    );
  }

  // Incoming call for candidate
  if (isIncomingCall) {
    return (
      <div style={WIDGET_STYLE}>
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--pipe-border)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.15em",
              color: "rgba(96,165,250,0.8)",
              marginBottom: 4,
            }}
          >
            ⦿ INCOMING_VIDEO_CALL
          </div>
          <div style={{ fontSize: 11, color: "var(--pipe-text-muted)" }}>
            Recruiter is calling
          </div>
        </div>
        <div style={{ display: "flex", gap: 0 }}>
          <button
            onClick={onDecline}
            style={{
              flex: 1,
              padding: "12px 0",
              background: "rgba(239,68,68,0.08)",
              border: "none",
              borderTop: "none",
              borderRight: "1px solid var(--pipe-border)",
              color: "rgba(248,113,113,0.8)",
              fontSize: 9,
              letterSpacing: "0.12em",
              fontFamily: '"Space Mono", monospace',
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <PhoneOff size={10} /> DECLINE
          </button>
          <button
            onClick={onAccept}
            style={{
              flex: 1,
              padding: "12px 0",
              background: "rgba(16,185,129,0.12)",
              border: "none",
              color: "rgba(52,211,153,0.9)",
              fontSize: 9,
              letterSpacing: "0.12em",
              fontFamily: '"Space Mono", monospace',
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Phone size={10} /> ACCEPT
          </button>
        </div>
      </div>
    );
  }

  // Recruiter waiting for candidate or setting up
  if (role === "RECRUITER") {
    // Device still initializing
    if (!deviceReady && !deviceError) {
      return (
        <div style={{ ...PILL_STYLE }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "rgba(251,191,36,0.6)",
              animation: "pulse 1.5s infinite",
            }}
          />
          CAMERA_INIT...
        </div>
      );
    }

    // Device error
    if (deviceError) {
      return (
        <div style={WIDGET_STYLE}>
          <div
            style={{
              padding: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: "rgba(248,113,113,0.7)",
                letterSpacing: "0.1em",
              }}
            >
              {deviceError}
            </div>
            <button
              onClick={onDismiss}
              style={{
                background: "none",
                border: "none",
                color: "var(--pipe-text-dim)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      );
    }

    // Ready: waiting for candidate / can initiate call
    if (isWaiting) {
      return (
        <div style={WIDGET_STYLE}>
          {/* Self-preview */}
          {localStream && (
            <div
              style={{
                position: "relative",
                background: "#000",
                aspectRatio: "16/9",
                borderRadius: "7px 7px 0 0",
                overflow: "hidden",
              }}
            >
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: "scaleX(-1)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 6,
                  left: 8,
                  fontSize: 8,
                  color: "var(--pipe-text-dim)",
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: "0.1em",
                }}
              >
                SELF_PREVIEW
              </div>
            </div>
          )}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--pipe-border-light)",
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: "rgba(96,165,250,0.7)",
                letterSpacing: "0.12em",
                marginBottom: 2,
              }}
            >
              LIVE_VIDEO_STAGE
            </div>
            <div style={{ fontSize: 10, color: "var(--pipe-text-dim)" }}>
              Ready to start call
            </div>
          </div>
          <div style={{ display: "flex", gap: 0 }}>
            <button
              onClick={onDismiss}
              style={{
                flex: 1,
                padding: "10px 0",
                background: "transparent",
                border: "none",
                borderRight: "1px solid var(--pipe-border)",
                color: "var(--pipe-text-dim)",
                fontSize: 9,
                letterSpacing: "0.1em",
                fontFamily: '"Space Mono", monospace',
                cursor: "pointer",
              }}
            >
              DISMISS
            </button>
            <button
              onClick={onCall}
              style={{
                flex: 2,
                padding: "10px 0",
                background: "rgba(96,165,250,0.08)",
                border: "none",
                color: "rgba(96,165,250,0.9)",
                fontSize: 9,
                letterSpacing: "0.12em",
                fontFamily: '"Space Mono", monospace',
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Phone size={10} /> START_CALL
            </button>
          </div>
        </div>
      );
    }

    // Calling — waiting for candidate to answer
    if (isCalling) {
      return (
        <div style={WIDGET_STYLE}>
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--pipe-border-light)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "rgba(96,165,250,0.7)",
                boxShadow: "0 0 8px rgba(96,165,250,0.5)",
                animation: "pulse 1.5s infinite",
                flexShrink: 0,
              }}
            />
            <div>
              <div
                style={{
                  fontSize: 9,
                  color: "rgba(96,165,250,0.7)",
                  letterSpacing: "0.12em",
                  marginBottom: 2,
                }}
              >
                CALLING...
              </div>
              <div style={{ fontSize: 10, color: "var(--pipe-text-dim)" }}>
                Waiting for candidate
              </div>
            </div>
          </div>
          <button
            onClick={onDecline}
            style={{
              width: "100%",
              padding: "10px 0",
              background: "transparent",
              border: "none",
              color: "rgba(248,113,113,0.7)",
              fontSize: 9,
              letterSpacing: "0.1em",
              fontFamily: '"Space Mono", monospace',
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <PhoneOff size={10} /> CANCEL_CALL
          </button>
        </div>
      );
    }
  }

  // Candidate device initializing
  if (role === "CANDIDATE" && !deviceReady && !deviceError) {
    return (
      <div style={PILL_STYLE}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "rgba(251,191,36,0.6)",
            animation: "pulse 1.5s infinite",
          }}
        />
        VIDEO_INIT...
      </div>
    );
  }

  return null;
}
