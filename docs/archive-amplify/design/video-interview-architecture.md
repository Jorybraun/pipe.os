# Video Interview Architecture

**Date:** 2026-02-28
**Status:** Proposed — Review before implementation
**Scope:** Live video interview stage for Pipe — WebRTC between recruiter and candidate, AWS-backed signaling, phone-call-style UX, composable with existing challenge system

---

## 1. The Problem

The existing challenge system is fully asynchronous. A candidate gets a link, completes challenges on their own time, and the recruiter reviews the results later. This covers code review, quiz, and code implementation challenges well.

But many hiring pipelines include a live technical interview — a synchronous session where the recruiter and candidate are in the same (virtual) room. Challenges may happen during that session (recruiter shares a problem, watches candidate work through it in real time), or the video stage itself is the assessment (conversation-based).

This document designs the architecture for a **live video interview stage** that:
- Is completely independent from the async challenge system
- Wraps around the existing challenge panels as a shell (using the same composable pattern)
- Uses WebRTC for peer-to-peer video
- Uses AppSync subscriptions as the signaling channel
- Has a phone-call-style UX: interviewer calls → candidate accepts

---

## 2. What's Missing From Your Current Thinking

Before diving into the design, here's a complete list of concerns the phone-call framing doesn't surface:

### 2.1 TURN Server (Critical — Don't Skip)

WebRTC is peer-to-peer, but it only works peer-to-peer in ideal network conditions (~80% of connections). The remaining ~20% of connections — candidates behind corporate firewalls, strict NAT, or cellular networks — require a TURN server: a relay that both parties route media through.

AWS does not provide a managed TURN service. You need a third-party option:

| Option | Cost | Setup |
|---|---|---|
| **Metered.ca** | ~$0.40/GB, free tier 1GB/month | 5 min, REST API for credentials |
| **Twilio NRTS** | ~$0.50/GB | Easy, but Twilio pricing is opaque |
| **Self-hosted Coturn on EC2** | ~$30/month EC2 t3.micro | High ops burden, not recommended solo |

**Recommendation:** Metered.ca for MVP. They have a REST API that returns temporary TURN credentials, so you never expose static TURN passwords in client code.

### 2.2 The Scheduling Problem

Your "phone call" framing implies the candidate is already waiting when the recruiter calls. But the current candidate flow is async — they click a link on their own schedule. Live video requires coordination: both parties need to be online at the same time.

Two models:

**Model A — Candidate Waits (MVP):** Candidate clicks the stage link and enters a waiting room. Recruiter gets an in-app notification (via AppSync) that candidate is ready. Recruiter joins and initiates the call. No scheduling system needed. Tradeoff: candidate doesn't know when recruiter will join.

**Model B — Scheduled Slot:** Recruiter sends a calendar invite with a specific time. Both join at the scheduled time. Requires calendaring infrastructure (Calendly integration or custom scheduling). Tradeoff: more complex, but better candidate experience.

**Recommendation:** Model A for MVP with a clear message to the candidate ("Your interviewer will join shortly"). Add a max wait time (e.g. 30 minutes) after which the session expires. Scheduling can be added post-MVP.

### 2.3 Candidate Auth in the Video Room

Candidates are unauthenticated in the current system — they use a `publicApiKey` auth mode with an `inviteToken` in the URL. This works for async challenges but creates a problem for live sessions: how do you prevent someone else from joining the candidate's video session?

The answer is room-scoping: the `VideoSession` record is created with a `roomToken` (UUID). Joining the room requires knowing both the candidate's `inviteToken` AND the `roomToken`, which is only stored in the database and returned to authenticated owners (recruiters) + the candidate themselves via apiKey.

### 2.4 Notification to Recruiter

When the candidate enters the waiting room, how does the recruiter know? Options:

- **AppSync subscription on the candidate list page** (in-app badge) — already have the infrastructure
- **Email via SES** — one Lambda call, reliable
- **Browser push notification** (Notification API) — requires permission, doesn't work in all contexts

**Recommendation:** AppSync in-app badge for MVP (recruiter sees a "🟢 Ready" indicator appear on the candidate card). Add email notification when SES is wired.

### 2.5 Layout During Challenges

When video is active, where does the challenge content live? Two models:

**Model A — Full-Screen Video First:** Video is full-screen. Challenge panels are minimized/hidden until the interviewer pushes a challenge to the candidate. Think: video call with a "share screen" button that becomes "share problem".

**Model B — Split Layout:** Video is a corner PiP (Picture-in-Picture) overlay. Challenge panels occupy the main workspace. The candidate can do challenges while the interviewer watches.

**Recommendation:** Model B. The existing `WorkspaceLayout` (3-panel grid) becomes the primary interface. Video appears as a floating PiP in the top-right corner of the workspace. Both parties see the same panel layout. This fits the "AI-native interview" framing — the candidate is doing real work while being observed.

### 2.6 WebRTC Connection Failure / Reconnection

WebRTC connections can drop (network switch, timeout, ICE restart needed). You need:
- A reconnection strategy: attempt ICE restart before declaring the session failed
- A fallback UI: "Connection lost. Reconnecting..." with a manual "Retry" button
- Session state tracking in DynamoDB so a dropped-and-reconnected call doesn't lose its recording/state

### 2.7 Media Permissions UX

Camera and microphone require explicit browser permission. This is often the first thing that fails in a video call. You need:
- A pre-call device check screen (camera/mic selector, permission prompt)
- Graceful error handling if permission is denied
- Audio-only fallback if camera fails

### 2.8 What Happens to Challenges During Video

The recruiter needs to be able to:
- View the candidate's assessment in real-time (what challenge are they on, are they typing?)
- Send challenge assignments to the candidate (post-MVP: shared cursor / collaborative editor)

At MVP: the candidate's challenge progress updates via AppSync subscriptions visible on the recruiter's side panel.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    VIDEO INTERVIEW STAGE                             │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  VideoShell (outer behavioral wrapper)                        │  │
│  │  ─ manages WebRTC peer connection                            │  │
│  │  ─ manages signaling via AppSync subscriptions               │  │
│  │  ─ renders floating video PiP overlay                        │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │  TimerShell (existing)                                  │ │  │
│  │  │                                                          │ │  │
│  │  │  ┌───────────────────────────────────────────────────┐  │ │  │
│  │  │  │  WorkspaceLayout (existing)                       │  │ │  │
│  │  │  │  Challenge panels render here as normal           │  │ │  │
│  │  │  └───────────────────────────────────────────────────┘  │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─── Floating PiP ─────────────┐                                   │
│  │  [Local video]  [Remote video] │                                  │
│  │  [Mic] [Cam] [End Call]      │                                   │
│  └──────────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Key infrastructure choices:
- **Signaling:** AppSync real-time subscriptions (already exists, zero new infra)
- **TURN/STUN:** Metered.ca for TURN + Google STUN (free)
- **Video:** WebRTC native browser API (`RTCPeerConnection`)
- **Session management:** New `VideoSession` + `VideoSignal` DynamoDB models
- **Notifications:** AppSync subscription on `VideoSession.status` changes

---

## 4. Signaling Design

WebRTC requires a signaling channel to exchange SDP (Session Description Protocol) offers/answers and ICE candidates before the peer connection is established. This is not part of WebRTC itself — you bring your own signaling.

### Why AppSync subscriptions

AppSync is already the backbone of the app. Using it for signaling gives us:
- Real-time delivery to both parties (GraphQL subscriptions over WebSocket)
- DynamoDB persistence (signals are stored, not just transient)
- Same auth model (apiKey for candidates, userPool for recruiters)
- Zero new infrastructure

The main tradeoff is that AppSync has ~100ms latency for subscription delivery. For signaling (not media — media goes peer-to-peer), this is fine. ICE negotiation tolerates 200–500ms signaling latency.

### Signal flow

```
INTERVIEWER                        APPSYNC                      CANDIDATE
     │                                │                              │
     │  [Candidate enters waiting room]                              │
     │  ◄──── subscription fires ─────┤◄── VideoSession.status=WAITING ──┤
     │                                │                              │
     │  click "CALL" ────────────────►│                              │
     │                                │── subscription fires ───────►│
     │                                │   (type: CALL_INITIATED)     │
     │                                │                              │
     │                                │◄─── CALL_ACCEPTED ──────────┤
     │◄── subscription fires ─────────┤                              │
     │                                │                              │
     │  createOffer() ────────────────►│                              │
     │  (SDP offer stored)            │── subscription fires ───────►│
     │                                │   (type: OFFER, sdp: ...)    │
     │                                │                              │
     │                                │◄─── type: ANSWER, sdp: ... ─┤
     │◄── subscription fires ─────────┤                              │
     │                                │                              │
     │  ◄──── ICE candidates ─────────┤◄─── ICE candidates ─────────┤
     │  ─────► ICE candidates ────────┤──── ICE candidates ─────────►│
     │                                │                              │
     │  ════════════ WebRTC P2P media established ═══════════════════│
     │  (video/audio flows direct, not through AppSync/TURN)        │
```

### VideoSignal message types

```typescript
type VideoSignalType =
  | 'CALL_INITIATED'     // Interviewer pushed "Call" button
  | 'CALL_ACCEPTED'      // Candidate accepted the call
  | 'CALL_DECLINED'      // Candidate declined (missed call → retry)
  | 'OFFER'              // SDP offer from interviewer
  | 'ANSWER'             // SDP answer from candidate
  | 'ICE_CANDIDATE'      // ICE candidate from either party
  | 'ICE_RESTART'        // Reconnection request
  | 'CALL_ENDED'         // Either party ended the call
  | 'HEARTBEAT'          // Keep-alive ping every 30s while in room
```

---

## 5. Data Model

### 5.1 New models to add to `amplify/data/resource.ts`

```typescript
/**
 * VideoSession Model
 *
 * Tracks a live video interview session for a Stage + Candidate pair.
 * One session per (stageId, candidateId). Status drives the waiting room UX.
 */
VideoSession: a
  .model({
    stageId: a.id().required(),
    stage: a.belongsTo('Stage', 'stageId'),
    candidateId: a.id().required(),
    candidate: a.belongsTo('Candidate', 'candidateId'),
    assessmentId: a.id(),              // Linked assessment for this session

    // Lifecycle
    status: a.enum([
      'WAITING',      // Candidate is in waiting room, recruiter not yet present
      'CALLING',      // Recruiter initiated call, waiting for candidate to accept
      'ACTIVE',       // Call is live
      'COMPLETED',    // Call ended normally
      'MISSED',       // Candidate or recruiter didn't show / timed out
    ]).required(),

    // Room identity — never expose to client raw; validate server-side
    roomToken: a.string().required(),  // UUID, tied to both parties

    // Timing
    waitingSince: a.datetime(),
    startedAt: a.datetime(),
    endedAt: a.datetime(),
    durationSeconds: a.integer(),

    // Post-MVP
    recordingS3Key: a.string(),

    // Signaling
    signals: a.hasMany('VideoSignal', 'sessionId'),
  })
  .authorization((allow) => [
    allow.owner(),                          // Recruiter owns
    allow.publicApiKey().to(['read', 'create', 'update']), // Candidate via apiKey
  ]),

/**
 * VideoSignal Model
 *
 * Ephemeral WebRTC signaling messages — SDP offers/answers, ICE candidates.
 * These are persisted briefly for resilience but are logically transient.
 * TTL cleanup via DynamoDB TTL attribute (expiresAt).
 */
VideoSignal: a
  .model({
    sessionId: a.id().required(),
    session: a.belongsTo('VideoSession', 'sessionId'),

    fromRole: a.enum(['INTERVIEWER', 'CANDIDATE']).required(),
    type: a.enum([
      'CALL_INITIATED', 'CALL_ACCEPTED', 'CALL_DECLINED',
      'OFFER', 'ANSWER', 'ICE_CANDIDATE', 'ICE_RESTART',
      'CALL_ENDED', 'HEARTBEAT',
    ]).required(),

    payload: a.json().required(),    // SDP string or RTCIceCandidate JSON

    // DynamoDB TTL — signals expire after 1 hour
    expiresAt: a.integer(),          // Unix timestamp
  })
  .authorization((allow) => [
    allow.owner(),
    allow.publicApiKey().to(['create', 'read']),
  ]),
```

### 5.2 Stage model additions

Add a `videoConfig` JSON field and `mode` enum to Stage:

```typescript
// In Stage model, add:
mode: a.enum(['ASYNC', 'LIVE_VIDEO']).default('ASYNC'),
videoConfig: a.json(),  // VideoStageConfig — see below
```

```typescript
// TypeScript type for Stage.videoConfig
interface VideoStageConfig {
  enabled: true;
  durationLimitMinutes?: number;   // Max call duration. null = unlimited.
  waitingRoomMessage?: string;     // Shown to candidate while waiting
  requiresCamera: boolean;         // Default: true. false = audio-only OK.
  allowAudioFallback: boolean;     // Default: true. If camera fails, audio continues.
  // Post-MVP
  recordingEnabled?: boolean;
  scheduledAt?: string;            // ISO datetime for scheduled sessions
}
```

### 5.3 What stays the same

- `Pipeline`, `Candidate`, `Assessment` — no changes
- Challenges still exist inside video stages (candidate does challenges during the call)
- Assessment records per challenge — same as async flow
- `inviteToken`-based candidate URL — same, just routes to video waiting room

---

## 6. Component Architecture

### 6.1 Component tree

```
src/
├── components/
│   ├── Shells/
│   │   ├── TimerShell.tsx           (existing)
│   │   ├── RecordingShell.tsx       (post-MVP)
│   │   └── VideoShell.tsx           ← NEW: outer wrapper for video stages
│   │
│   ├── Video/                        ← NEW: self-contained video module
│   │   ├── VideoShell.tsx            ← main shell component (see §6.2)
│   │   ├── VideoFloatingPiP.tsx      ← floating video overlay (local + remote)
│   │   ├── VideoControls.tsx         ← mic/cam toggle, end call button
│   │   ├── VideoDeviceCheck.tsx      ← pre-call permission + device selector
│   │   ├── VideoWaitingRoom.tsx      ← candidate waiting room screen
│   │   ├── VideoIncomingCall.tsx     ← candidate call accept/decline screen
│   │   └── RecruiterCallPanel.tsx    ← recruiter "Call" button + session status
│   │
│   └── Assessment/
│       └── ChallengeRegistry.tsx     (existing — unchanged)
│
├── hooks/
│   ├── useVideoSession.ts            ← NEW: WebRTC peer connection management
│   └── useVideoSignaling.ts          ← NEW: AppSync signaling subscription
│
└── lib/
    └── video/
        ├── webrtcConfig.ts           ← ICE server config (STUN + TURN credentials)
        ├── turnCredentials.ts        ← Metered.ca credential fetcher
        └── mediaPermissions.ts       ← camera/mic permission helpers
```

### 6.2 VideoShell

The outer behavioral shell. Composes outside the `TimerShell` + `WorkspaceLayout` chain:

```tsx
// src/components/Shells/VideoShell.tsx
interface VideoShellProps {
  stageId: string;
  candidateId: string;
  role: 'INTERVIEWER' | 'CANDIDATE';
  videoConfig: VideoStageConfig;
  children: ReactNode;              // ← TimerShell + WorkspaceLayout go here
}

export function VideoShell({ stageId, candidateId, role, videoConfig, children }: VideoShellProps) {
  const session = useVideoSession({ stageId, candidateId, role });
  const signaling = useVideoSignaling({ sessionId: session.id, role });

  // Candidate sees waiting room until call is accepted
  if (role === 'CANDIDATE' && session.status === 'WAITING') {
    return <VideoWaitingRoom
      message={videoConfig.waitingRoomMessage}
      onCancel={() => session.leave()}
    />;
  }

  // Candidate sees incoming call UI
  if (role === 'CANDIDATE' && session.status === 'CALLING') {
    return <VideoIncomingCall
      onAccept={() => signaling.sendSignal({ type: 'CALL_ACCEPTED', payload: {} })}
      onDecline={() => signaling.sendSignal({ type: 'CALL_DECLINED', payload: {} })}
    />;
  }

  return (
    <div className="video-shell-container">
      {/* Challenges render as normal */}
      {children}

      {/* Floating video overlay — only visible when call is active */}
      {session.status === 'ACTIVE' && (
        <VideoFloatingPiP
          localStream={session.localStream}
          remoteStream={session.remoteStream}
          controls={
            <VideoControls
              isMicMuted={session.isMicMuted}
              isCamOff={session.isCamOff}
              onToggleMic={session.toggleMic}
              onToggleCam={session.toggleCam}
              onEndCall={session.endCall}
            />
          }
        />
      )}
    </div>
  );
}
```

### 6.3 ChallengeRegistry integration

The `ChallengeRegistry` in `resolveShells` gets a new shell type:

```typescript
// src/lib/challenge/resolveShells.ts — addition
export interface ResolvedShells {
  timer: { enabled: boolean; timeLimit: number | null };
  recording: { enabled: boolean };
  video: { enabled: boolean; config: VideoStageConfig | null };  // ← NEW
}

export function resolveShells(challenge: ChallengeWithConfig, stage: Stage): ResolvedShells {
  return {
    timer: { ... },
    recording: { ... },
    video: {
      enabled: stage.mode === 'LIVE_VIDEO',
      config: stage.videoConfig ? JSON.parse(stage.videoConfig) : null,
    },
  };
}
```

And in `ChallengeRegistry`, VideoShell wraps everything:

```tsx
// Compose shells outside-in: Video → Timer → WorkspaceLayout
let composed: ReactNode = workspace;
if (shells.recording.enabled) {
  composed = <RecordingShell>{composed}</RecordingShell>;
}
if (shells.timer.enabled) {
  composed = <TimerShell timeLimit={shells.timer.timeLimit}>{composed}</TimerShell>;
}
if (shells.video.enabled && shells.video.config) {
  composed = (
    <VideoShell
      stageId={challenge.stageId}
      candidateId={candidateId}
      role={role}
      videoConfig={shells.video.config}
    >
      {composed}
    </VideoShell>
  );
}
```

### 6.4 useVideoSession hook

```typescript
// src/hooks/useVideoSession.ts
interface UseVideoSessionOptions {
  stageId: string;
  candidateId: string;
  role: 'INTERVIEWER' | 'CANDIDATE';
}

interface VideoSessionState {
  id: string | null;
  status: VideoSessionStatus;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMicMuted: boolean;
  isCamOff: boolean;
  connectionQuality: 'good' | 'fair' | 'poor' | 'disconnected';

  // Actions
  initiateCall: () => Promise<void>;   // Interviewer only
  endCall: () => Promise<void>;
  toggleMic: () => void;
  toggleCam: () => void;
  leave: () => void;                   // Candidate leaves waiting room
}
```

This hook:
1. Fetches or creates the `VideoSession` record for the stageId + candidateId pair
2. Subscribes to `VideoSession.status` changes via AppSync
3. Manages the `RTCPeerConnection` lifecycle
4. Wires signaling events (OFFER → setRemoteDescription → createAnswer, etc.)
5. Handles ICE candidate exchange

### 6.5 useVideoSignaling hook

```typescript
// src/hooks/useVideoSignaling.ts
interface UseVideoSignalingOptions {
  sessionId: string;
  role: 'INTERVIEWER' | 'CANDIDATE';
  onSignal: (signal: VideoSignal) => void;  // Called for every incoming signal
}

// Sends a signal to the other party via AppSync mutation
const { sendSignal } = useVideoSignaling({
  sessionId,
  role: 'INTERVIEWER',
  onSignal: (signal) => {
    if (signal.type === 'ANSWER') handleRemoteAnswer(signal.payload);
    if (signal.type === 'ICE_CANDIDATE') peerConnection.addIceCandidate(signal.payload);
  },
});
```

---

## 7. The Full UX Flow

### 7.1 Candidate journey (LIVE_VIDEO stage)

```
1. Candidate clicks invite link → /assess/:token
2. useAssessment resolves stages; encounters a LIVE_VIDEO stage
3. VideoShell renders immediately (before any challenge content)
4. Device check screen: "Allow camera and microphone access"
   └── User grants permission → camera preview shown
   └── User selects preferred camera/mic (if multiple)
5. Candidate enters waiting room:
   ┌────────────────────────────────────────────────────┐
   │  PIPE  ·  LIVE TECHNICAL INTERVIEW                │
   │                                                    │
   │  [Your camera preview]                             │
   │                                                    │
   │  ✓ Camera ready                                   │
   │  ✓ Microphone ready                               │
   │                                                    │
   │  Your interviewer will join shortly.               │
   │  Please stay on this page.                        │
   │                                                    │
   │  Waiting...  ●  [Leave]                           │
   └────────────────────────────────────────────────────┘
   → VideoSession created with status: WAITING

6. Interviewer initiates call (see §7.2)
7. Candidate receives CALL_INITIATED signal → VideoIncomingCall renders:
   ┌────────────────────────────────────────────────────┐
   │  INCOMING CALL                                     │
   │  Your interviewer is calling                       │
   │                                                    │
   │  [DECLINE]              [ACCEPT]                   │
   └────────────────────────────────────────────────────┘

8. Candidate taps ACCEPT → sends CALL_ACCEPTED signal
9. WebRTC negotiation completes (OFFER → ANSWER → ICE exchange)
10. Call goes ACTIVE:
    ┌────────────────────────────────────────────────────┐
    │  PIPE · LIVE INTERVIEW  · 32:14 ←                 │
    │  ────────────────────────────────────────────────  │
    │                                                    │
    │  [Challenge content — ProblemPanel + MonacoPanel] │
    │                                                    │
    │         ┌──────────────────────┐ ← floating PiP  │
    │         │ [remote] │ [local]   │                  │
    │         │ 🎤 📷  [End Call]   │                  │
    │         └──────────────────────┘                  │
    └────────────────────────────────────────────────────┘

11. Candidate completes challenges during the call (submits via challenge system as normal)
12. Interviewer ends call → VideoSession.status: COMPLETED
```

### 7.2 Recruiter / Interviewer journey

The recruiter's experience lives in two places:

**On the Candidate Profile page** (before/during the call):

```
CANDIDATE: Alice Johnson · Senior Frontend Engineer
─────────────────────────────────────────────────────────
STAGE 1: ASYNC CODE REVIEW          ✓ COMPLETED · Score: 78
STAGE 2: LIVE TECHNICAL INTERVIEW   🟢 WAITING SINCE 2:34 PM

  [START INTERVIEW CALL]
```

When the recruiter clicks "START INTERVIEW CALL":
1. A new tab/modal opens with the `RecruiterCallPanel`
2. The recruiter sees their own camera preview + candidate's waiting room indicator
3. Click "CALL" → sends `CALL_INITIATED` signal → waits for `CALL_ACCEPTED`
4. WebRTC connects → full interview interface renders

**RecruiterCallPanel includes:**
- Floating video (their cam + candidate's cam)
- The same challenge panels the candidate is looking at (read-only view for recruiter — what challenge the candidate is on, their current code, annotations in progress)
- A "Notes" side panel for recruiter's private notes (saved to `Assessment.feedback`)
- End call button

---

## 8. WebRTC Configuration

```typescript
// src/lib/video/webrtcConfig.ts

// Fetch temporary TURN credentials from your backend
// (which fetches from Metered.ca API)
async function getIceServers(): Promise<RTCIceServer[]> {
  const { data } = await client.queries.getVideoCredentials();
  return [
    // STUN — free, Google's public STUN
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },

    // TURN — from Metered.ca via your Lambda
    {
      urls: data.turnUrls,         // ['turn:relay.metered.ca:80', ...]
      username: data.username,     // Temporary credential (TTL: 24h)
      credential: data.credential,
    },
  ];
}

// RTCPeerConnection options
const PC_CONFIG: RTCConfiguration = {
  iceServers: await getIceServers(),
  iceCandidatePoolSize: 10,     // Pre-gather candidates for faster connection
  bundlePolicy: 'max-bundle',   // Bundle audio + video on same port
  rtcpMuxPolicy: 'require',
};
```

### TURN credential Lambda

```typescript
// amplify/functions/videoCredentials/handler.ts
// Fetches temporary credentials from Metered.ca
// Called via Amplify custom query:
//   getVideoCredentials: a.query().returns(a.json()).handler(a.handler.function('videoCredentials'))

export const handler = async () => {
  const response = await fetch(
    `https://pipe.metered.live/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`
  );
  // Returns: [{ urls, username, credential }]
  return response.json();
};
```

---

## 9. Security Model

### 9.1 Room access control

The `VideoSession` has a `roomToken` (UUID). This token is generated server-side when the session is created and is:
- Readable by the owner (recruiter, via Cognito)
- Readable by the candidate via `publicApiKey` auth (they have the `inviteToken` URL)
- Never sent to anyone else

The room is implicitly scoped to a `(stageId, candidateId)` pair — there's no way to join another candidate's room without knowing their `candidateId`.

### 9.2 Signal scoping

`VideoSignal` records are scoped to a `sessionId`. AppSync subscriptions filter by `sessionId`, so each party only receives signals for their own session.

### 9.3 TURN credential security

TURN credentials are fetched via a Lambda that holds the Metered.ca API key as an Amplify secret. Credentials are time-limited (24 hours TTL from Metered.ca). Even if leaked, they only allow relaying — not accessing any application data.

### 9.4 Media never touches your servers

WebRTC media (video/audio) flows peer-to-peer or through the TURN relay. It never touches AppSync, DynamoDB, or any Amplify infrastructure. This simplifies HIPAA/GDPR concerns at MVP.

---

## 10. Stage Configuration UI (Pipeline Builder)

When a recruiter creates a stage, they see a new toggle: **"Live Video Interview"**.

When enabled, the stage builder shows:

```
STAGE: LIVE TECHNICAL INTERVIEW
────────────────────────────────────────────────────────
[●] Live Video Interview         ← toggle

When enabled, candidates enter a video waiting room before completing
challenges. You initiate the call from the candidate profile page.

Duration limit: [60] minutes  (optional — leave blank for unlimited)

Waiting room message (shown to candidate):
┌────────────────────────────────────────────────────┐
│ Your interviewer will join shortly. Please keep    │
│ this tab open and ensure your camera and mic are   │
│ working.                                           │
└────────────────────────────────────────────────────┘

[●] Require camera
[●] Allow audio-only fallback if camera unavailable

CHALLENGES (shown to candidate during the call):
  [ + ADD CHALLENGE ]
```

This updates `Stage.mode = 'LIVE_VIDEO'` and `Stage.videoConfig = { enabled: true, ... }`.

---

## 11. Recruiter Notification (Candidate Ready)

When the candidate enters the waiting room, `VideoSession.status` changes to `WAITING`. The recruiter's `ListingPage` and `CandidateProfilePage` subscribe to VideoSession status changes via AppSync:

```tsx
// In CandidateProfilePage:
useEffect(() => {
  const sub = client.models.VideoSession.observeQuery({
    filter: { candidateId: { eq: candidateId } },
  }).subscribe(({ items }) => {
    const waiting = items.find(s => s.status === 'WAITING');
    setHasWaitingSession(!!waiting);
  });
  return () => sub.unsubscribe();
}, [candidateId]);
```

```
CANDIDATE: Alice Johnson
─────────────────────────────────────────────────────────
STAGE 2: LIVE INTERVIEW    🟢 READY — Waiting since 2:34 PM

                           [START INTERVIEW]   ← enabled
```

For the candidate list view, a waiting indicator appears on the card. No email required at MVP — the recruiter sees it immediately on the dashboard if they have the page open.

---

## 12. Deferred (Post-MVP)

| Feature | Why deferred |
|---|---|
| **Recording** | Needs S3 + MediaRecorder API + candidate consent UX + retention policy |
| **Scheduled sessions** | Requires calendaring system (Calendly API or custom). MVP uses "candidate waits" model |
| **Multi-interviewer** | WebRTC mesh/SFU complexity. Start 1:1 |
| **Screen sharing** | `getDisplayMedia` API is straightforward to add, but adds UX complexity |
| **Live collaborative editor** | Real-time cursor sync (Yjs/CRDT) — significant complexity. Recruiter can observe candidate's code submissions as they're saved |
| **AI transcription** | AWS Transcribe Streaming or Deepgram. Add post-MVP for notes/summaries |
| **Browser push notifications** | Notification API requires permission grant. Email via SES is simpler fallback |
| **Mobile-optimized PiP** | iOS Safari WebRTC has quirks. Desktop-first at MVP |
| **SFU (Selective Forwarding Unit)** | For panels > 2 participants. Not needed at 1:1 |
| **Connection quality adaptive bitrate** | `RTCRtpSender.setParameters()` for bandwidth adaptation |

---

## 13. Implementation Phases

### Phase 1 — Signaling & Session (no video yet)
1. Add `VideoSession` + `VideoSignal` models to schema; add `Stage.mode` + `Stage.videoConfig`
2. Deploy schema: `npx ampx sandbox`
3. Build `useVideoSession` hook (session CRUD + status subscription)
4. Build `useVideoSignaling` hook (AppSync mutations + subscriptions for signals)
5. Build `VideoWaitingRoom` and `VideoIncomingCall` components (no video — just state management)
6. Wire `ChallengeRegistry` to apply `VideoShell` when `stage.mode === 'LIVE_VIDEO'`
7. Add "Start Interview" button + waiting indicator to `CandidateProfilePage`

**Deliverable:** The waiting room flow works end-to-end. No video yet — just the state machine.

### Phase 2 — WebRTC Media
1. Implement `turnCredentials` Lambda + `getVideoCredentials` query
2. Build `webrtcConfig.ts` + ICE server configuration
3. Build `mediaPermissions.ts` + `VideoDeviceCheck` pre-call screen
4. Add WebRTC peer connection management to `useVideoSession`
5. Build `VideoFloatingPiP` and `VideoControls` components
6. Wire signaling to peer connection (offer/answer/ICE exchange)

**Deliverable:** Video calls work between interviewer and candidate.

### Phase 3 — Pipeline Builder Config
1. Add "Live Video Interview" toggle to stage builder in `OverviewPage`
2. Build `VideoStageConfig` editor (duration, waiting room message, camera settings)
3. Update stage presets to support `LIVE_VIDEO` mode

**Deliverable:** Recruiters can create video interview stages from the pipeline builder.

### Phase 4 — Stability & Edge Cases
1. ICE restart on connection drop
2. Audio-only fallback when camera unavailable
3. Session timeout (candidate waits > 30 minutes → `MISSED`)
4. Connection quality indicator
5. "Reconnect" flow

**Deliverable:** Production-ready. Handles network failures gracefully.

---

## 14. ADR Required

Write `docs/decisions/ADR-010-video-interview-webrtc.md` before implementation, capturing:

- Decision: WebRTC (browser-native) + AppSync signaling + Metered.ca TURN
- Alternatives: Amazon IVS (managed, $0.002/min + no WebRTC), Daily.co (managed, $0.004/min), Twilio Video (managed, very expensive)
- Decision rationale: Maximum control, minimum recurring cost, no third-party data processor
- Consequences: Must manage TURN infrastructure, must implement signaling

---

## 15. Dependencies to Install

```bash
# No new npm packages required for core WebRTC
# WebRTC APIs are native browser APIs

# Optional: better TypeScript types for WebRTC
npm i --save-dev @types/webrtc

# If adding recording post-MVP:
npm i recordrtc    # MediaRecorder wrapper with cross-browser support
```

TURN credentials and signaling use Amplify + AppSync — no new packages.
