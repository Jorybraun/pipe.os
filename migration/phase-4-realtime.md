# Phase 4: Real-time Signaling + Scheduling

**Status:** Not started
**Depends on:** Phase 3 (Candidate Profile + Assessment)
**Pages:** `/schedule`, video call overlay (embedded in stage view)

---

## 1. Overview

Phase 4 replaces the three real-time subsystems that currently depend on AppSync subscriptions and Lambda:

| Subsystem | Current (Amplify) | Target (Cloudflare) |
|---|---|---|
| **Video signaling** | AppSync `observeQuery` on `VideoSession` + `VideoSignal` models | Durable Object per session + WebSocket connections |
| **Scheduling dashboard** | AppSync `observeQuery` on `ScheduledInterview` | Polling (5s interval) via Workers API |
| **Scheduling OAuth + webhooks** | Lambda (`schedulingOAuth`, `schedulingWebhook`) via AppSync mutations + Function URL | Workers (OAuth flow, webhook receiver) |
| **TURN credentials** | Lambda (`turnCredentials`) via AppSync query | Worker endpoint proxying Metered.ca API |

The critical migration is video signaling. AppSync subscriptions currently handle SDP offer/answer exchange and ICE candidate trickle between recruiter and candidate. This is latency-sensitive (sub-200ms relay required for call setup) and stateful (each session has exactly two participants). Durable Objects are the correct replacement: each Durable Object is a single-threaded, persistent actor that can hold WebSocket connections and relay messages between exactly two peers.

Scheduling dashboard updates are not latency-sensitive (a 5-second delay between a Calendly webhook and the recruiter seeing "SCHEDULED" is acceptable). Polling is simpler, cheaper, and eliminates the complexity of maintaining persistent WebSocket connections for a feature that updates a few times per day.

---

## 2. BDD User Journeys

### 2.1 Video Call: Recruiter Initiates

```gherkin
Feature: Recruiter initiates video call with candidate

  Scenario: Recruiter starts a call from the stage view
    Given the recruiter is viewing a LIVE_VIDEO stage for candidate "Alice"
    And Alice has the candidate assessment page open
    When the recruiter clicks "Start Video Call"
    Then a VideoSession Durable Object is created with status WAITING
    And the recruiter's browser opens a WebSocket to the Durable Object
    And the recruiter sees a "Waiting for candidate..." indicator

  Scenario: Session creation fails gracefully
    Given the recruiter is viewing a LIVE_VIDEO stage
    When the recruiter clicks "Start Video Call"
    And the Durable Object creation fails (e.g., network error)
    Then the recruiter sees an error message "Failed to start call. Please try again."
    And no orphaned session exists
```

### 2.2 Video Call: Candidate Receives Notification and Joins

```gherkin
Feature: Candidate receives call and joins

  Scenario: Candidate sees incoming call notification
    Given the recruiter has created a VideoSession in WAITING state
    And Alice has the assessment page open with an active WebSocket to the signaling server
    When the recruiter sends an SDP OFFER
    Then Alice receives the OFFER via WebSocket within 200ms
    And Alice sees an "Incoming call from recruiter" notification
    And the notification includes "Accept" and "Decline" buttons

  Scenario: Candidate accepts the call
    Given Alice sees the incoming call notification
    When Alice clicks "Accept"
    Then Alice's browser creates an SDP ANSWER
    And the ANSWER is sent to the Durable Object via WebSocket
    And the Durable Object relays the ANSWER to the recruiter within 200ms

  Scenario: Candidate declines the call
    Given Alice sees the incoming call notification
    When Alice clicks "Decline"
    Then a HANGUP message is sent via WebSocket
    And the session transitions to ENDED
    And the recruiter sees "Candidate declined the call"
```

### 2.3 Video Call: WebRTC Offer/Answer/ICE Exchange

```gherkin
Feature: WebRTC signaling completes successfully

  Scenario: Full SDP + ICE exchange via Durable Object
    Given the recruiter has an open WebSocket to session DO "video:stage123:candidate456"
    And Alice has an open WebSocket to the same session DO
    When the recruiter sends message { type: "OFFER", sdp: "...", iceServers: [...] }
    Then the Durable Object relays it to Alice's WebSocket
    When Alice sends message { type: "ANSWER", sdp: "..." }
    Then the Durable Object relays it to the recruiter's WebSocket
    When the recruiter sends { type: "ICE_CANDIDATE", candidate: "...", sdpMid: "0", sdpMLineIndex: 0 }
    Then the Durable Object relays it to Alice's WebSocket
    When Alice sends { type: "ICE_CANDIDATE", candidate: "...", sdpMid: "0", sdpMLineIndex: 0 }
    Then the Durable Object relays it to the recruiter's WebSocket
    And both peers establish a direct media connection

  Scenario: ICE candidates arrive before ANSWER (trickle ICE)
    Given the recruiter has sent an OFFER
    When the recruiter sends ICE_CANDIDATE messages before Alice sends ANSWER
    Then the Durable Object buffers ICE_CANDIDATE messages for Alice
    And delivers them in order after Alice's WebSocket connects

  Scenario: WebSocket disconnects mid-negotiation
    Given the SDP exchange is in progress
    When Alice's WebSocket disconnects unexpectedly
    Then the Durable Object waits 30 seconds for reconnection
    And if Alice reconnects, replays any buffered messages
    And if Alice does not reconnect, sends HANGUP to the recruiter
    And transitions the session to ENDED
```

### 2.4 Video Call: Hangup and Session End

```gherkin
Feature: Either party hangs up

  Scenario: Recruiter ends the call
    Given a video call is active between recruiter and Alice
    When the recruiter clicks "End Call"
    Then a { type: "HANGUP", reason: "recruiter_ended" } message is sent via WebSocket
    And the Durable Object relays it to Alice
    And the Durable Object transitions session status to ENDED
    And both WebSocket connections are closed with code 1000
    And the Durable Object schedules a cleanup alarm for 60 seconds later
    # Note: Durable Objects don't "self-destruct." The alarm handler must explicitly
    # call this.ctx.storage.deleteAll() to clear persisted state. The DO is then
    # evicted from memory when idle, but storage persists unless explicitly deleted.

  Scenario: Candidate ends the call
    Given a video call is active between recruiter and Alice
    When Alice clicks "End Call"
    Then a { type: "HANGUP", reason: "candidate_ended" } message is sent via WebSocket
    And the Durable Object relays it to the recruiter
    And the session transitions to ENDED

  Scenario: Session times out
    Given a VideoSession has been in WAITING state for 5 minutes
    And no candidate has connected
    When the Durable Object alarm fires
    Then the session transitions to ENDED
    And the recruiter receives { type: "SESSION_TIMEOUT" }
    And the WebSocket is closed with code 4008 (timeout)
```

### 2.5 Scheduling: Recruiter Connects Calendly via OAuth

```gherkin
Feature: Recruiter connects Calendly account

  Scenario: Successful OAuth flow
    Given the recruiter is on the /schedule page
    And no scheduling connection exists
    When the recruiter clicks "Connect Calendly"
    Then the browser redirects to Calendly's OAuth consent page
    When the recruiter grants access
    Then Calendly redirects back with an authorization code
    And the frontend calls POST /api/scheduling/oauth/exchange
    And the Worker exchanges the code for access + refresh tokens
    And the Worker stores a SchedulingConnection record with status ACTIVE
    And the Worker registers a webhook subscription with Calendly
    And the recruiter sees "Connected as jane@company.com"

  Scenario: OAuth exchange fails
    Given the recruiter initiated the Calendly OAuth flow
    When Calendly redirects back with an error parameter
    Then the recruiter sees "Connection failed: [error description]"
    And no SchedulingConnection record is created
```

### 2.6 Scheduling: Webhook Receives Booking

```gherkin
Feature: Webhook processes Calendly booking

  Scenario: Candidate books via Calendly link
    Given a ScheduledInterview exists for Alice with status INVITED
    And the recruiter has an ACTIVE Calendly connection with a registered webhook
    When Calendly sends a POST to /api/scheduling/webhook with event "invitee.created"
    And the payload includes Alice's email and a scheduled time
    Then the Worker verifies the HMAC signature using the stored webhookSecret
    And the Worker finds the INVITED ScheduledInterview for Alice by email
    And the Worker updates the interview: status=SCHEDULED, scheduledAt=[time], meetingUrl=[url]
    And the Worker updates the connection's lastSyncAt timestamp

  Scenario: HMAC verification fails
    Given a webhook is configured with a secret
    When a POST arrives with an invalid or missing signature
    Then the Worker responds 401 Unauthorized
    And no records are modified
```

### 2.7 Scheduling: Candidate Cancels and Dashboard Updates

```gherkin
Feature: Cancellation propagates to recruiter dashboard

  Scenario: Candidate cancels via Calendly
    Given Alice has a SCHEDULED interview
    When Alice cancels via her Calendly confirmation email
    And Calendly sends "invitee.canceled" to the webhook
    Then the Worker updates the interview: status=CANCELLED
    And the next time the recruiter's dashboard polls (within 5s)
    Then the recruiter sees Alice's interview change from "SCHEDULED" to "CANCELLED"
```

### 2.8 Scheduling: Recruiter Sees Live Status Changes

```gherkin
Feature: Scheduling dashboard reflects current state

  Scenario: Dashboard loads with current data
    Given the recruiter has 3 scheduled interviews (1 INVITED, 1 SCHEDULED, 1 COMPLETED)
    When the recruiter navigates to /schedule
    Then the dashboard shows all 3 interviews with correct statuses

  Scenario: Dashboard picks up webhook-driven changes via polling
    Given the recruiter has the /schedule page open
    And the dashboard is polling GET /api/scheduling/interviews every 5 seconds
    When a Calendly webhook updates an interview from INVITED to SCHEDULED
    Then within 5 seconds the dashboard shows the updated status
    And no manual refresh is required

  Scenario: Dashboard handles offline gracefully
    Given the recruiter's browser loses network connectivity
    When polling fails
    Then the dashboard shows a "Connection lost, retrying..." indicator
    And when connectivity resumes, the dashboard resumes polling
    And stale data is replaced with fresh data on the next successful poll
```

### 2.9 Scheduling: Recruiter Disconnects Calendar Provider

```gherkin
Feature: Recruiter disconnects scheduling provider

  Scenario: Successful disconnect
    Given the recruiter has an ACTIVE Calendly connection
    When the recruiter clicks "Disconnect Calendly"
    And confirms the action
    Then the Worker deletes the webhook subscription from Calendly
    And the Worker marks the SchedulingConnection as REVOKED
    And the recruiter sees the "Connect Calendly" button again
    And future webhooks from Calendly return 404 (no active connection)
```

---

## 3. Acceptance Criteria

### Video Signaling

- [ ] SDP offer relayed from recruiter to candidate in < 200ms (measured at Durable Object, excluding network transit)
- [ ] SDP answer relayed from candidate to recruiter in < 200ms
- [ ] ICE candidates relayed in < 100ms per message
- [ ] Session cleanup: Durable Object alarm fires 60s after ENDED status, calls `this.ctx.storage.deleteAll()` to clear state, then DO is evicted from memory when idle
- [ ] Reconnection: if a WebSocket drops and reconnects within 30s, buffered messages are replayed
- [ ] Timeout: sessions in WAITING state for > 5 minutes auto-transition to ENDED
- [ ] Auth: recruiter WebSocket requires valid Clerk JWT; candidate WebSocket requires valid session token
- [ ] No internal IDs (Durable Object names, D1 row IDs) are exposed to the candidate client
- [ ] TURN credentials endpoint requires Clerk auth, returns Metered.ca ICE servers
- [ ] STUN-only fallback if TURN credential fetch fails
- [ ] ICE servers are embedded in the OFFER payload (candidate never calls TURN endpoint directly)

### Scheduling

- [ ] OAuth exchange Worker handles Calendly and Cal.com providers
- [ ] Webhook receiver verifies HMAC signatures; rejects invalid signatures with 401
- [ ] Webhook correctly transitions INVITED -> SCHEDULED and SCHEDULED -> CANCELLED
- [ ] Invalid status transitions are rejected (e.g., COMPLETED -> SCHEDULED)
- [ ] Dashboard polling interval: 5 seconds when tab is focused, paused when tab is hidden
- [ ] Dashboard shows connection status (ACTIVE/EXPIRED/REVOKED) with last sync time
- [ ] OAuth tokens are stored encrypted in D1 (access_token, refresh_token)
- [ ] Token auto-refresh when within 5 minutes of expiry
- [ ] Disconnect flow: webhook deleted from provider, connection marked REVOKED

### Cross-cutting

- [ ] All Worker endpoints return structured JSON errors, never stack traces
- [ ] All WebSocket messages conform to the typed protocol (see section 4.3)
- [ ] E2E test: recruiter initiates call, candidate joins, SDP exchange completes, both hang up
- [ ] E2E test: OAuth connect, webhook booking, dashboard shows update, disconnect

---

## 4. Durable Objects Architecture

### 4.1 Design: One Durable Object per VideoSession

Each video call is managed by a single Durable Object instance identified by a deterministic name derived from the stage and candidate:

```
video:{stageId}:{candidateId}
```

The Durable Object holds:
- Up to 2 WebSocket connections (one recruiter, one candidate)
- Session state machine (WAITING -> CALLING -> ACTIVE -> ENDED)
- Message buffer for early ICE candidates
- An alarm for session timeout (5 minutes in WAITING, configurable)

This is the correct granularity because:
1. A video session is inherently two-party -- a Durable Object is a single-threaded actor that can hold both connections.
2. Durable Objects colocate with their first connection -- since the recruiter always initiates, the DO runs close to the recruiter.
3. No shared state between sessions -- each DO is independent, no coordination needed.
4. Cleanup -- When a session ends, the alarm handler calls `this.ctx.storage.deleteAll()` to clear persisted state. The DO is then evicted from memory when idle. Without explicit storage cleanup, session data persists indefinitely even after WebSocket disconnection.

### 4.2 Session State Machine

```
                  createSession()
                       |
                       v
    +---------+   sendOffer()   +---------+   sendAnswer()   +--------+
    | WAITING | --------------> | CALLING | ---------------> | ACTIVE |
    +---------+                 +---------+                  +--------+
         |                           |                            |
         | timeout (5m)              | hangup                     | hangup
         v                           v                            v
    +---------+                 +---------+                  +---------+
    |  ENDED  |                 |  ENDED  |                  |  ENDED  |
    +---------+                 +---------+                  +---------+
```

State transitions are enforced server-side in the Durable Object. The client cannot set arbitrary states.

### 4.3 WebSocket Protocol

All messages are JSON. Every message has a `type` field. The Durable Object validates message shape before relaying.

**Client -> Server messages:**

```typescript
// Authenticate on connect (first message after WebSocket open)
type AuthMessage = {
  type: 'AUTH';
  role: 'RECRUITER' | 'CANDIDATE';
  token: string; // Clerk JWT (recruiter) or session token (candidate)
};

// Create a new session (recruiter only, must be first non-AUTH message)
type CreateSessionMessage = {
  type: 'CREATE_SESSION';
};

// SDP offer (recruiter -> server -> candidate)
type OfferMessage = {
  type: 'OFFER';
  sdp: string;
  iceServers: RTCIceServer[]; // Recruiter embeds TURN creds for candidate
};

// SDP answer (candidate -> server -> recruiter)
type AnswerMessage = {
  type: 'ANSWER';
  sdp: string;
};

// ICE candidate (either direction)
type IceCandidateMessage = {
  type: 'ICE_CANDIDATE';
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
};

// Hangup (either party)
type HangupMessage = {
  type: 'HANGUP';
  reason?: string;
};
```

**Server -> Client messages:**

```typescript
// Authentication result
type AuthResultMessage = {
  type: 'AUTH_OK';
  sessionStatus: 'WAITING' | 'CALLING' | 'ACTIVE' | 'ENDED';
};

type AuthErrorMessage = {
  type: 'AUTH_ERROR';
  message: string;
};

// Session created confirmation (to recruiter)
type SessionCreatedMessage = {
  type: 'SESSION_CREATED';
  status: 'WAITING';
};

// Relayed messages (same shape as client messages, with senderRole added)
type RelayedOfferMessage = {
  type: 'OFFER';
  sdp: string;
  iceServers: RTCIceServer[];
  senderRole: 'RECRUITER';
};

type RelayedAnswerMessage = {
  type: 'ANSWER';
  sdp: string;
  senderRole: 'CANDIDATE';
};

type RelayedIceCandidateMessage = {
  type: 'ICE_CANDIDATE';
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  senderRole: 'RECRUITER' | 'CANDIDATE';
};

type RelayedHangupMessage = {
  type: 'HANGUP';
  reason?: string;
  senderRole: 'RECRUITER' | 'CANDIDATE';
};

// Status change notification
type StatusChangeMessage = {
  type: 'STATUS_CHANGE';
  status: 'WAITING' | 'CALLING' | 'ACTIVE' | 'ENDED';
};

// Peer connected/disconnected
type PeerEventMessage = {
  type: 'PEER_CONNECTED' | 'PEER_DISCONNECTED';
  role: 'RECRUITER' | 'CANDIDATE';
};

// Timeout
type SessionTimeoutMessage = {
  type: 'SESSION_TIMEOUT';
};

// Error
type ErrorMessage = {
  type: 'ERROR';
  message: string;
  code: string; // e.g., 'INVALID_MESSAGE', 'NOT_AUTHORIZED', 'INVALID_STATE'
};
```

**WebSocket close codes:**

| Code | Meaning |
|------|---------|
| 1000 | Normal closure (hangup) |
| 4001 | Authentication failed |
| 4002 | Invalid message format |
| 4003 | Not authorized for this action |
| 4008 | Session timeout |
| 4009 | Session ended by other party |
| 4010 | Duplicate connection (same role already connected) |

### 4.4 Durable Object Implementation

```typescript
// workers/src/durable-objects/video-session.ts

import { DurableObject } from 'cloudflare:workers';

interface SessionState {
  status: 'WAITING' | 'CALLING' | 'ACTIVE' | 'ENDED';
  recruiterRole: AuthenticatedPeer | null;
  candidateRole: AuthenticatedPeer | null;
  createdAt: number;
  iceBuffer: Map<string, IceCandidateMessage[]>; // role -> buffered ICE candidates
}

interface AuthenticatedPeer {
  ws: WebSocket;
  role: 'RECRUITER' | 'CANDIDATE';
  userId: string; // Clerk user ID (recruiter) or opaque session ID (candidate)
  connectedAt: number;
}

type ClientMessage =
  | AuthMessage
  | CreateSessionMessage
  | OfferMessage
  | AnswerMessage
  | IceCandidateMessage
  | HangupMessage;

const VALID_TRANSITIONS: Record<string, string[]> = {
  WAITING: ['CALLING', 'ENDED'],
  CALLING: ['ACTIVE', 'ENDED'],
  ACTIVE: ['ENDED'],
  ENDED: [],
};

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_DELAY_MS = 60 * 1000; // 60 seconds after ENDED
const RECONNECT_GRACE_MS = 30 * 1000; // 30 seconds for reconnection

export class VideoSessionDO extends DurableObject<Env> {
  private state: SessionState = {
    status: 'WAITING',
    recruiterRole: null,
    candidateRole: null,
    createdAt: Date.now(),
    iceBuffer: new Map(),
  };

  // Tracks unauthenticated WebSockets pending AUTH message
  private pendingAuth = new Map<WebSocket, NodeJS.Timeout>();

  // Tracks disconnected peers for reconnection grace period
  private disconnectTimers = new Map<string, NodeJS.Timeout>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      return this.handleWebSocketUpgrade(request);
    }

    // Health check / status endpoint (internal, not exposed to clients)
    if (url.pathname === '/status') {
      return Response.json({
        status: this.state.status,
        recruiterConnected: !!this.state.recruiterRole,
        candidateConnected: !!this.state.candidateRole,
        createdAt: this.state.createdAt,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  private handleWebSocketUpgrade(request: Request): Response {
    if (this.state.status === 'ENDED') {
      return new Response('Session ended', { status: 410 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    // Give the client 5 seconds to send AUTH message
    const authTimeout = setTimeout(() => {
      this.pendingAuth.delete(server);
      server.close(4001, 'Authentication timeout');
    }, 5000);
    this.pendingAuth.set(server, authTimeout);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    if (typeof rawMessage !== 'string') {
      this.sendError(ws, 'Binary messages not supported', 'INVALID_MESSAGE');
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(rawMessage) as ClientMessage;
    } catch {
      this.sendError(ws, 'Invalid JSON', 'INVALID_MESSAGE');
      return;
    }

    if (!msg.type) {
      this.sendError(ws, 'Missing message type', 'INVALID_MESSAGE');
      return;
    }

    // Handle AUTH for unauthenticated connections
    if (this.pendingAuth.has(ws)) {
      if (msg.type !== 'AUTH') {
        this.sendError(ws, 'Must authenticate first', 'NOT_AUTHORIZED');
        ws.close(4001, 'Must authenticate first');
        return;
      }
      await this.handleAuth(ws, msg as AuthMessage);
      return;
    }

    // All other messages require an authenticated peer
    const peer = this.findPeer(ws);
    if (!peer) {
      this.sendError(ws, 'Not authenticated', 'NOT_AUTHORIZED');
      ws.close(4001, 'Not authenticated');
      return;
    }

    switch (msg.type) {
      case 'CREATE_SESSION':
        this.handleCreateSession(peer);
        break;
      case 'OFFER':
        this.handleOffer(peer, msg as OfferMessage);
        break;
      case 'ANSWER':
        this.handleAnswer(peer, msg as AnswerMessage);
        break;
      case 'ICE_CANDIDATE':
        this.handleIceCandidate(peer, msg as IceCandidateMessage);
        break;
      case 'HANGUP':
        this.handleHangup(peer, msg as HangupMessage);
        break;
      default:
        this.sendError(ws, `Unknown message type: ${msg.type}`, 'INVALID_MESSAGE');
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string): Promise<void> {
    // Clean up pending auth
    const authTimeout = this.pendingAuth.get(ws);
    if (authTimeout) {
      clearTimeout(authTimeout);
      this.pendingAuth.delete(ws);
      return;
    }

    const peer = this.findPeer(ws);
    if (!peer) return;

    // Notify the other party
    const otherPeer = this.getOtherPeer(peer.role);
    if (otherPeer) {
      this.send(otherPeer.ws, { type: 'PEER_DISCONNECTED', role: peer.role });
    }

    // Start reconnection grace period
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(peer.role);
      // If still disconnected after grace period, end the session
      const currentPeer = peer.role === 'RECRUITER'
        ? this.state.recruiterRole
        : this.state.candidateRole;
      if (currentPeer?.ws === ws) {
        // Still the same (disconnected) WebSocket -- peer did not reconnect
        this.transitionTo('ENDED');
        if (otherPeer) {
          this.send(otherPeer.ws, {
            type: 'HANGUP',
            reason: `${peer.role.toLowerCase()}_disconnected`,
            senderRole: peer.role,
          });
          otherPeer.ws.close(4009, 'Other party disconnected');
        }
      }
    }, RECONNECT_GRACE_MS);

    this.disconnectTimers.set(peer.role, timer);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    // Treat errors as disconnection -- webSocketClose will fire next
    console.error('[VideoSessionDO] WebSocket error for session');
  }

  // ----------- Alarm (session timeout + cleanup) -----------

  async alarm(): Promise<void> {
    if (this.state.status === 'ENDED') {
      // Cleanup phase: delete stored state
      await this.ctx.storage.deleteAll();
      return;
    }

    if (this.state.status === 'WAITING') {
      // Session timed out waiting for candidate
      if (this.state.recruiterRole) {
        this.send(this.state.recruiterRole.ws, { type: 'SESSION_TIMEOUT' });
        this.state.recruiterRole.ws.close(4008, 'Session timeout');
      }
      this.transitionTo('ENDED');
    }
  }

  // ----------- Auth -----------

  private async handleAuth(ws: WebSocket, msg: AuthMessage): Promise<void> {
    const authTimeout = this.pendingAuth.get(ws);
    if (authTimeout) {
      clearTimeout(authTimeout);
      this.pendingAuth.delete(ws);
    }

    // Validate the token
    const userId = await this.verifyToken(msg.token, msg.role);
    if (!userId) {
      this.send(ws, { type: 'AUTH_ERROR', message: 'Invalid token' });
      ws.close(4001, 'Invalid token');
      return;
    }

    // Check for duplicate role connection
    const existingPeer = msg.role === 'RECRUITER'
      ? this.state.recruiterRole
      : this.state.candidateRole;

    if (existingPeer) {
      // This is a reconnection -- cancel the disconnect timer
      const timer = this.disconnectTimers.get(msg.role);
      if (timer) {
        clearTimeout(timer);
        this.disconnectTimers.delete(msg.role);
      }
      // Close the old WebSocket
      try { existingPeer.ws.close(4010, 'Replaced by new connection'); } catch {}
    }

    const peer: AuthenticatedPeer = {
      ws,
      role: msg.role,
      userId,
      connectedAt: Date.now(),
    };

    if (msg.role === 'RECRUITER') {
      this.state.recruiterRole = peer;
    } else {
      this.state.candidateRole = peer;
    }

    this.send(ws, { type: 'AUTH_OK', sessionStatus: this.state.status });

    // Notify the other party
    const otherPeer = this.getOtherPeer(msg.role);
    if (otherPeer) {
      this.send(otherPeer.ws, { type: 'PEER_CONNECTED', role: msg.role });
    }

    // Flush any buffered ICE candidates for this peer
    const buffered = this.state.iceBuffer.get(msg.role);
    if (buffered && buffered.length > 0) {
      const senderRole = msg.role === 'RECRUITER' ? 'CANDIDATE' : 'RECRUITER';
      for (const ice of buffered) {
        this.send(ws, { ...ice, senderRole });
      }
      this.state.iceBuffer.delete(msg.role);
    }
  }

  private async verifyToken(token: string, role: string): Promise<string | null> {
    if (role === 'RECRUITER') {
      // Verify Clerk JWT
      // In production, use Clerk's JWKS endpoint to verify the JWT signature.
      // The CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are available in env.
      try {
        const payload = await this.verifyClerkJwt(token);
        return payload.sub;
      } catch (err) {
        console.error('[VideoSessionDO] Clerk JWT verification failed:', err);
        return null;
      }
    } else {
      // Verify candidate session token
      // Session tokens are short-lived JWTs issued by the resolveToken Lambda
      // (migrated to a Worker in Phase 3). Verify signature using shared secret.
      try {
        const payload = await this.verifySessionToken(token);
        return payload.candidateId;
      } catch (err) {
        console.error('[VideoSessionDO] Session token verification failed:', err);
        return null;
      }
    }
  }

  private async verifyClerkJwt(token: string): Promise<{ sub: string }> {
    // Implementation: fetch JWKS from Clerk, verify RS256 signature, check exp/iss/aud
    // This is a standard JWT verification -- use jose or a lightweight JWT lib
    // compiled for Workers (e.g., @clerk/backend verifyToken)
    throw new Error('TODO: implement Clerk JWT verification');
  }

  private async verifySessionToken(token: string): Promise<{ candidateId: string }> {
    // Implementation: verify HMAC-SHA256 signature using SESSION_TOKEN_SECRET from env
    // Check expiry. Extract candidateId from payload.
    throw new Error('TODO: implement session token verification');
  }

  // ----------- Message handlers -----------

  private handleCreateSession(peer: AuthenticatedPeer): void {
    if (peer.role !== 'RECRUITER') {
      this.sendError(peer.ws, 'Only recruiter can create sessions', 'NOT_AUTHORIZED');
      return;
    }

    if (this.state.status !== 'WAITING') {
      this.sendError(peer.ws, `Cannot create session in ${this.state.status} state`, 'INVALID_STATE');
      return;
    }

    // Set timeout alarm
    this.ctx.storage.setAlarm(Date.now() + SESSION_TIMEOUT_MS);

    this.send(peer.ws, { type: 'SESSION_CREATED', status: 'WAITING' });
  }

  private handleOffer(peer: AuthenticatedPeer, msg: OfferMessage): void {
    if (peer.role !== 'RECRUITER') {
      this.sendError(peer.ws, 'Only recruiter can send OFFER', 'NOT_AUTHORIZED');
      return;
    }

    if (this.state.status !== 'WAITING') {
      this.sendError(peer.ws, `Cannot send OFFER in ${this.state.status} state`, 'INVALID_STATE');
      return;
    }

    if (!msg.sdp || !msg.iceServers) {
      this.sendError(peer.ws, 'OFFER requires sdp and iceServers', 'INVALID_MESSAGE');
      return;
    }

    this.transitionTo('CALLING');

    const candidate = this.state.candidateRole;
    if (candidate) {
      this.send(candidate.ws, {
        type: 'OFFER',
        sdp: msg.sdp,
        iceServers: msg.iceServers,
        senderRole: 'RECRUITER',
      });
    } else {
      // Buffer the offer for when candidate connects
      // Store in Durable Object storage for persistence across hibernation
      this.ctx.storage.put('pendingOffer', {
        sdp: msg.sdp,
        iceServers: msg.iceServers,
      });
    }
  }

  private handleAnswer(peer: AuthenticatedPeer, msg: AnswerMessage): void {
    if (peer.role !== 'CANDIDATE') {
      this.sendError(peer.ws, 'Only candidate can send ANSWER', 'NOT_AUTHORIZED');
      return;
    }

    if (this.state.status !== 'CALLING') {
      this.sendError(peer.ws, `Cannot send ANSWER in ${this.state.status} state`, 'INVALID_STATE');
      return;
    }

    if (!msg.sdp) {
      this.sendError(peer.ws, 'ANSWER requires sdp', 'INVALID_MESSAGE');
      return;
    }

    this.transitionTo('ACTIVE');

    const recruiter = this.state.recruiterRole;
    if (recruiter) {
      this.send(recruiter.ws, {
        type: 'ANSWER',
        sdp: msg.sdp,
        senderRole: 'CANDIDATE',
      });
    }
  }

  private handleIceCandidate(peer: AuthenticatedPeer, msg: IceCandidateMessage): void {
    if (this.state.status !== 'CALLING' && this.state.status !== 'ACTIVE') {
      this.sendError(peer.ws, `Cannot send ICE_CANDIDATE in ${this.state.status} state`, 'INVALID_STATE');
      return;
    }

    if (!msg.candidate) {
      this.sendError(peer.ws, 'ICE_CANDIDATE requires candidate', 'INVALID_MESSAGE');
      return;
    }

    const targetRole = peer.role === 'RECRUITER' ? 'CANDIDATE' : 'RECRUITER';
    const targetPeer = this.getOtherPeer(peer.role);

    const relayed: Record<string, unknown> = {
      type: 'ICE_CANDIDATE',
      candidate: msg.candidate,
      sdpMid: msg.sdpMid,
      sdpMLineIndex: msg.sdpMLineIndex,
      senderRole: peer.role,
    };

    if (targetPeer) {
      this.send(targetPeer.ws, relayed);
    } else {
      // Buffer for later delivery
      const buffer = this.state.iceBuffer.get(targetRole) ?? [];
      buffer.push(msg);
      this.state.iceBuffer.set(targetRole, buffer);
    }
  }

  private handleHangup(peer: AuthenticatedPeer, msg: HangupMessage): void {
    this.transitionTo('ENDED');

    const otherPeer = this.getOtherPeer(peer.role);
    if (otherPeer) {
      this.send(otherPeer.ws, {
        type: 'HANGUP',
        reason: msg.reason ?? `${peer.role.toLowerCase()}_ended`,
        senderRole: peer.role,
      });
      otherPeer.ws.close(4009, 'Session ended by other party');
    }

    peer.ws.close(1000, 'Session ended');

    // Schedule cleanup
    this.ctx.storage.setAlarm(Date.now() + CLEANUP_DELAY_MS);
  }

  // ----------- Helpers -----------

  private transitionTo(newStatus: SessionState['status']): void {
    const allowed = VALID_TRANSITIONS[this.state.status];
    if (!allowed?.includes(newStatus)) {
      console.error(
        `[VideoSessionDO] Invalid transition: ${this.state.status} -> ${newStatus}`
      );
      return;
    }

    this.state.status = newStatus;

    // Broadcast status change to all connected peers
    const msg = { type: 'STATUS_CHANGE', status: newStatus };
    if (this.state.recruiterRole) this.send(this.state.recruiterRole.ws, msg);
    if (this.state.candidateRole) this.send(this.state.candidateRole.ws, msg);
  }

  private findPeer(ws: WebSocket): AuthenticatedPeer | null {
    if (this.state.recruiterRole?.ws === ws) return this.state.recruiterRole;
    if (this.state.candidateRole?.ws === ws) return this.state.candidateRole;
    return null;
  }

  private getOtherPeer(role: string): AuthenticatedPeer | null {
    return role === 'RECRUITER' ? this.state.candidateRole : this.state.recruiterRole;
  }

  private send(ws: WebSocket, data: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      console.error('[VideoSessionDO] Failed to send message:', err);
    }
  }

  private sendError(ws: WebSocket, message: string, code: string): void {
    this.send(ws, { type: 'ERROR', message, code });
  }
}
```

### 4.5 Worker Entry Point (WebSocket Upgrade Router)

```typescript
// workers/src/routes/video.ts

import { Hono } from 'hono';

const video = new Hono<{ Bindings: Env }>();

/**
 * WebSocket upgrade endpoint for video signaling.
 *
 * Route: GET /api/video/:stageId/:candidateId/ws
 *
 * The stageId and candidateId are used to derive the Durable Object name.
 * Authentication happens inside the Durable Object after WebSocket upgrade
 * (the first message must be AUTH).
 *
 * Note: candidateId here is NOT exposed to the candidate. The candidate
 * client derives this from the session token (resolved server-side).
 * The candidate client calls GET /api/video/connect?sessionToken=xxx
 * which resolves to the correct stageId:candidateId internally.
 */
video.get('/connect', async (c) => {
  const sessionToken = c.req.query('token');
  if (!sessionToken) {
    return c.json({ error: 'Missing session token' }, 400);
  }

  // Resolve session token to stageId + candidateId server-side
  // This ensures the candidate never learns internal IDs
  const session = await resolveSessionToken(sessionToken, c.env);
  if (!session) {
    return c.json({ error: 'Invalid session token' }, 401);
  }

  const doName = `video:${session.stageId}:${session.candidateId}`;
  const id = c.env.VIDEO_SESSION.idFromName(doName);
  const stub = c.env.VIDEO_SESSION.get(id);

  // Forward the upgrade request to the Durable Object
  const url = new URL(c.req.url);
  url.pathname = '/ws';
  return stub.fetch(new Request(url.toString(), c.req.raw));
});

video.get('/:stageId/:candidateId/ws', async (c) => {
  // Recruiter path: stageId and candidateId from URL (recruiter is authenticated)
  const { stageId, candidateId } = c.req.param();

  const doName = `video:${stageId}:${candidateId}`;
  const id = c.env.VIDEO_SESSION.idFromName(doName);
  const stub = c.env.VIDEO_SESSION.get(id);

  const url = new URL(c.req.url);
  url.pathname = '/ws';
  return stub.fetch(new Request(url.toString(), c.req.raw));
});

export { video };
```

### 4.6 TURN Credentials Worker

```typescript
// workers/src/routes/turn.ts

import { Hono } from 'hono';
import { clerkAuth } from '../middleware/clerk-auth';

const turn = new Hono<{ Bindings: Env }>();

// TURN credentials are only available to authenticated recruiters.
// Candidates receive ICE servers embedded in the OFFER payload.
turn.get('/credentials', clerkAuth(), async (c) => {
  const apiKey = c.env.METERED_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'TURN service not configured' }, 503);
  }

  const response = await fetch(
    `https://pipe-os.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
  );

  if (!response.ok) {
    console.error('[turn] Metered API error:', response.status);
    // Return STUN fallback
    return c.json([
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]);
  }

  const servers = await response.json();
  return c.json(servers);
});

export { turn };
```

---

## 5. Scheduling Workers

### 5.1 OAuth Flow Worker

Replaces `amplify/functions/schedulingOAuth/handler.ts`. Same action-dispatch pattern, adapted to Workers.

```
POST /api/scheduling/oauth/exchange   { providerId, code, redirectUri, codeVerifier? }
POST /api/scheduling/oauth/refresh    { connectionId }
GET  /api/scheduling/oauth/event-types?connectionId=xxx
POST /api/scheduling/oauth/disconnect { connectionId }
POST /api/scheduling/oauth/register-webhook { connectionId }
```

All endpoints require Clerk authentication. Token storage moves from DynamoDB to D1 with the `access_token` and `refresh_token` columns encrypted at rest using a `SCHEDULING_ENCRYPTION_KEY` environment secret.

Key differences from the Lambda implementation:
1. No SSM parameter lookups -- environment variables are set directly in `wrangler.toml` (non-secret) or via `wrangler secret` (secret).
2. No DynamoDB SDK -- replaced with D1 SQL queries.
3. Identity comes from Clerk JWT middleware instead of AppSync Cognito context.

### 5.2 Webhook Receiver Worker

Replaces `amplify/functions/schedulingWebhook/handler.ts`. Exposed as a public Worker route (no auth -- HMAC verification replaces auth).

```
POST /api/scheduling/webhook
```

The webhook URL registered with Calendly/Cal.com is:
```
https://api.pipe-os.com/api/scheduling/webhook?connectionId={connectionId}
```

Processing steps (identical to current Lambda):
1. Identify provider from request headers
2. Look up SchedulingConnection by connectionId query param
3. Verify HMAC signature using stored `webhookSecret`
4. Normalize payload (Calendly vs Cal.com format)
5. Find matching ScheduledInterview (by externalEventId, then by candidate email)
6. Validate status transition
7. Update interview record in D1
8. Update connection `lastSyncAt`

### 5.3 Scheduling Dashboard API

```
GET /api/scheduling/interviews          (Clerk auth, returns all for recruiter)
GET /api/scheduling/connection          (Clerk auth, returns active connection)
```

These are simple D1 queries that the frontend polls.

---

## 6. Polling vs WebSocket Decision Matrix

| Feature | Transport | Interval | Justification |
|---|---|---|---|
| Video signaling (SDP, ICE) | **WebSocket** (Durable Object) | Real-time | Sub-200ms latency required for call setup. Trickle ICE generates 10-30 messages in the first 2 seconds. Polling would make call setup take 30-60 seconds. |
| Video session status | **WebSocket** (Durable Object) | Real-time | Status changes (WAITING -> CALLING -> ACTIVE) must reflect immediately for the candidate to see the incoming call notification. |
| Scheduled interviews list | **Polling** | 5 seconds | Updates happen a few times per day (webhook-driven). A 5s delay is imperceptible. WebSocket would require a persistent connection for a feature used ~5 min/day. |
| Scheduling connection status | **Polling** | 30 seconds | Connection status changes are rare (connect/disconnect). Even 30s delay is fine. |
| TURN credentials | **HTTP GET** | On demand | Fetched once per session. Cached for 1 hour client-side. |
| OAuth exchange | **HTTP POST** | On demand | One-time action, not a subscription. |
| Webhook processing | **HTTP POST** (inbound) | Event-driven | External provider pushes to our endpoint. |

**Why not WebSockets for scheduling?**

The scheduling dashboard is open for minutes at a time, but receives updates perhaps once every few hours. Maintaining a persistent WebSocket connection for this has costs:
- Durable Object billing (duration-based)
- Connection management complexity (reconnection, heartbeats)
- No benefit over polling at 5s intervals for the user experience

If scheduling volume grows to hundreds of updates per minute (unlikely for MVP), this decision can be revisited.

---

## 7. Task List

### 7.1 Infrastructure

- [ ] **T4-001** Add Durable Object binding to `wrangler.toml`
  ```toml
  [durable_objects]
  bindings = [
    { name = "VIDEO_SESSION", class_name = "VideoSessionDO" }
  ]
  ```
- [ ] **T4-002** Add D1 migration for scheduling tables
  ```sql
  CREATE TABLE scheduling_connections (
    id TEXT PRIMARY KEY,
    recruiter_id TEXT NOT NULL,
    provider_id TEXT NOT NULL CHECK (provider_id IN ('CALENDLY', 'CAL_COM')),
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    token_expiry TEXT,
    account_email TEXT,
    account_name TEXT,
    webhook_secret TEXT NOT NULL,
    webhook_id TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
    connected_at TEXT NOT NULL,
    last_sync_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_connections_recruiter ON scheduling_connections(recruiter_id);
  CREATE INDEX idx_connections_provider_status ON scheduling_connections(provider_id, status);
  ```
- [ ] **T4-003** Add Wrangler secrets: `METERED_API_KEY`, `SCHEDULING_ENCRYPTION_KEY`, `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`, `CALCOM_CLIENT_ID`, `CALCOM_CLIENT_SECRET`, `SESSION_TOKEN_SECRET`
- [ ] **T4-004** Terraform: configure custom domain for WebSocket endpoint (wss://api.pipe-os.com)

### 7.2 Durable Object: Video Signaling

- [ ] **T4-010** Implement `VideoSessionDO` class with state machine, WebSocket handling, auth, and message relay
- [ ] **T4-011** Implement Clerk JWT verification inside DO (fetch JWKS, verify RS256)
- [ ] **T4-012** Implement session token verification inside DO (HMAC-SHA256)
- [ ] **T4-013** Implement alarm-based session timeout (5 min WAITING, 60s cleanup after ENDED)
- [ ] **T4-014** Implement ICE candidate buffering for trickle ICE before peer connects
- [ ] **T4-015** Implement reconnection grace period (30s) with message replay
- [ ] **T4-016** Implement Durable Object storage for pending OFFER (survives hibernation)

### 7.3 Workers: Video Routes

- [ ] **T4-020** Implement `GET /api/video/:stageId/:candidateId/ws` (recruiter WebSocket upgrade)
- [ ] **T4-021** Implement `GET /api/video/connect?token=xxx` (candidate WebSocket upgrade, resolves token server-side)
- [ ] **T4-022** Implement `GET /api/turn/credentials` (Clerk auth, Metered.ca proxy)

### 7.4 Workers: Scheduling

- [ ] **T4-030** Implement `POST /api/scheduling/oauth/exchange` (code -> tokens -> D1 record -> webhook registration)
- [ ] **T4-031** Implement `POST /api/scheduling/oauth/refresh` (token refresh with auto-retry)
- [ ] **T4-032** Implement `GET /api/scheduling/oauth/event-types` (fetch from Calendly/Cal.com API)
- [ ] **T4-033** Implement `POST /api/scheduling/oauth/disconnect` (delete webhook, mark REVOKED)
- [ ] **T4-034** Implement `POST /api/scheduling/oauth/register-webhook` (re-register webhook)
- [ ] **T4-035** Implement `POST /api/scheduling/webhook` (HMAC verify, normalize, update D1)
- [ ] **T4-036** Implement `GET /api/scheduling/interviews` (D1 query, Clerk auth)
- [ ] **T4-037** Implement `GET /api/scheduling/connection` (D1 query, Clerk auth)
- [ ] **T4-038** Port Calendly normalizer (`providers/calendly.ts`)
- [ ] **T4-039** Port Cal.com normalizer (`providers/calcom.ts`)

### 7.5 Frontend: Video Signaling Hook

- [ ] **T4-050** Rewrite `useVideoSignaling` to use native WebSocket instead of AppSync `observeQuery`
  - Open WebSocket to `/api/video/connect?token=xxx` (candidate) or `/api/video/:stageId/:candidateId/ws` (recruiter)
  - Send AUTH message with Clerk JWT or session token
  - Map incoming WebSocket messages to the existing `onSignal` callback interface
  - Implement automatic reconnection with exponential backoff
- [ ] **T4-051** Rewrite `webrtcConfig.ts` to fetch TURN credentials from `GET /api/turn/credentials` instead of AppSync query
- [ ] **T4-052** Update `VideoSignalPayload` types to match new WebSocket protocol (minimal changes -- same shape, different transport)

### 7.6 Frontend: Scheduling Hooks

- [ ] **T4-060** Rewrite `useScheduledInterviews` to use polling instead of AppSync `observeQuery`
  - Fetch `GET /api/scheduling/interviews` every 5 seconds when tab is focused
  - Use `document.visibilityState` to pause polling when tab is hidden
  - Resume with immediate fetch when tab becomes visible
- [ ] **T4-061** Rewrite `useSchedulingConnection` to use Workers API instead of AppSync mutations
  - `exchangeOAuth` -> `POST /api/scheduling/oauth/exchange`
  - `fetchEventTypes` -> `GET /api/scheduling/oauth/event-types`
  - `disconnect` -> `POST /api/scheduling/oauth/disconnect`
  - `registerWebhook` -> `POST /api/scheduling/oauth/register-webhook`
  - Connection status via `GET /api/scheduling/connection` (polled at 30s)
- [ ] **T4-062** Add visibility-aware polling hook (`usePolling`) as a shared utility

### 7.7 Cleanup

- [ ] **T4-070** Remove AppSync VideoSession/VideoSignal model usage from frontend
- [ ] **T4-071** Remove AppSync ScheduledInterview/SchedulingConnection `observeQuery` usage
- [ ] **T4-072** Remove `amplify/functions/turnCredentials/`
- [ ] **T4-073** Remove `amplify/functions/schedulingOAuth/`
- [ ] **T4-074** Remove `amplify/functions/schedulingWebhook/`
- [ ] **T4-075** Update `amplify/data/resource.ts` to remove `getTurnCredentials`, `processSchedulingWebhook`, `exchangeSchedulingOAuth` queries/mutations (if not already removed in earlier phases)

---

## 8. BDD Test Specifications

### 8.1 Durable Object Unit Tests (Vitest + Miniflare)

```typescript
// workers/test/video-session.test.ts

describe('VideoSessionDO', () => {
  describe('Authentication', () => {
    it('should reject WebSocket connections that do not send AUTH within 5 seconds', async () => {
      const ws = await connectWebSocket(doStub);
      await sleep(5100);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(ws.closeCode).toBe(4001);
    });

    it('should reject AUTH with invalid Clerk JWT', async () => {
      const ws = await connectWebSocket(doStub);
      ws.send(JSON.stringify({ type: 'AUTH', role: 'RECRUITER', token: 'invalid' }));
      const msg = await nextMessage(ws);
      expect(msg.type).toBe('AUTH_ERROR');
    });

    it('should accept AUTH with valid Clerk JWT and return session status', async () => {
      const ws = await connectWebSocket(doStub);
      ws.send(JSON.stringify({ type: 'AUTH', role: 'RECRUITER', token: validClerkJwt }));
      const msg = await nextMessage(ws);
      expect(msg.type).toBe('AUTH_OK');
      expect(msg.sessionStatus).toBe('WAITING');
    });

    it('should accept candidate AUTH with valid session token', async () => {
      const ws = await connectWebSocket(doStub);
      ws.send(JSON.stringify({ type: 'AUTH', role: 'CANDIDATE', token: validSessionToken }));
      const msg = await nextMessage(ws);
      expect(msg.type).toBe('AUTH_OK');
    });
  });

  describe('Session Lifecycle', () => {
    it('should transition WAITING -> CALLING when recruiter sends OFFER', async () => {
      const recruiter = await authenticateAs('RECRUITER', doStub);
      recruiter.send(JSON.stringify({ type: 'CREATE_SESSION' }));
      await nextMessage(recruiter); // SESSION_CREATED

      recruiter.send(JSON.stringify({
        type: 'OFFER',
        sdp: 'v=0\r\n...',
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      }));

      const statusMsg = await nextMessage(recruiter);
      expect(statusMsg.type).toBe('STATUS_CHANGE');
      expect(statusMsg.status).toBe('CALLING');
    });

    it('should transition CALLING -> ACTIVE when candidate sends ANSWER', async () => {
      const { recruiter, candidate } = await setupCallingState(doStub);

      candidate.send(JSON.stringify({ type: 'ANSWER', sdp: 'v=0\r\n...' }));

      const statusMsg = await nextMessage(recruiter);
      expect(statusMsg.type).toBe('STATUS_CHANGE');
      expect(statusMsg.status).toBe('ACTIVE');
    });

    it('should reject OFFER from candidate', async () => {
      const candidate = await authenticateAs('CANDIDATE', doStub);
      candidate.send(JSON.stringify({
        type: 'OFFER',
        sdp: 'v=0\r\n...',
        iceServers: [],
      }));

      const msg = await nextMessage(candidate);
      expect(msg.type).toBe('ERROR');
      expect(msg.code).toBe('NOT_AUTHORIZED');
    });

    it('should reject ANSWER in WAITING state', async () => {
      const candidate = await authenticateAs('CANDIDATE', doStub);
      candidate.send(JSON.stringify({ type: 'ANSWER', sdp: 'v=0\r\n...' }));

      const msg = await nextMessage(candidate);
      expect(msg.type).toBe('ERROR');
      expect(msg.code).toBe('INVALID_STATE');
    });
  });

  describe('ICE Candidate Relay', () => {
    it('should relay ICE candidates from recruiter to candidate', async () => {
      const { recruiter, candidate } = await setupActiveState(doStub);

      recruiter.send(JSON.stringify({
        type: 'ICE_CANDIDATE',
        candidate: 'candidate:1 1 UDP 2130706431 ...',
        sdpMid: '0',
        sdpMLineIndex: 0,
      }));

      const msg = await nextMessage(candidate);
      expect(msg.type).toBe('ICE_CANDIDATE');
      expect(msg.senderRole).toBe('RECRUITER');
      expect(msg.candidate).toBe('candidate:1 1 UDP 2130706431 ...');
    });

    it('should buffer ICE candidates when target peer is not connected', async () => {
      const recruiter = await authenticateAs('RECRUITER', doStub);
      recruiter.send(JSON.stringify({ type: 'CREATE_SESSION' }));
      await nextMessage(recruiter);

      recruiter.send(JSON.stringify({
        type: 'OFFER',
        sdp: 'v=0\r\n...',
        iceServers: [],
      }));
      await nextMessage(recruiter); // STATUS_CHANGE

      // Send ICE candidate before candidate connects
      recruiter.send(JSON.stringify({
        type: 'ICE_CANDIDATE',
        candidate: 'candidate:1 ...',
        sdpMid: '0',
        sdpMLineIndex: 0,
      }));

      // Now candidate connects
      const candidate = await authenticateAs('CANDIDATE', doStub);

      // Candidate should receive the buffered ICE candidate
      const msg = await nextMessage(candidate);
      expect(msg.type).toBe('ICE_CANDIDATE');
      expect(msg.candidate).toBe('candidate:1 ...');
    });
  });

  describe('Hangup', () => {
    it('should transition to ENDED and notify both parties', async () => {
      const { recruiter, candidate } = await setupActiveState(doStub);

      recruiter.send(JSON.stringify({ type: 'HANGUP', reason: 'call_complete' }));

      const candidateMsg = await nextMessage(candidate);
      expect(candidateMsg.type).toBe('HANGUP');
      expect(candidateMsg.senderRole).toBe('RECRUITER');
      expect(candidateMsg.reason).toBe('call_complete');
    });

    it('should close WebSockets with appropriate codes', async () => {
      const { recruiter, candidate } = await setupActiveState(doStub);
      recruiter.send(JSON.stringify({ type: 'HANGUP' }));

      await waitForClose(recruiter);
      expect(recruiter.closeCode).toBe(1000);

      await waitForClose(candidate);
      expect(candidate.closeCode).toBe(4009);
    });
  });

  describe('Timeout', () => {
    it('should end session after 5 minutes in WAITING state', async () => {
      const recruiter = await authenticateAs('RECRUITER', doStub);
      recruiter.send(JSON.stringify({ type: 'CREATE_SESSION' }));
      await nextMessage(recruiter);

      // Advance time by 5 minutes (Miniflare supports this)
      await advanceTime(5 * 60 * 1000);

      const msg = await nextMessage(recruiter);
      expect(msg.type).toBe('SESSION_TIMEOUT');
    });
  });

  describe('Reconnection', () => {
    it('should allow reconnection within 30-second grace period', async () => {
      const { recruiter, candidate } = await setupActiveState(doStub);

      // Simulate candidate disconnect
      candidate.close();

      // Reconnect within grace period
      const newCandidate = await authenticateAs('CANDIDATE', doStub);
      const authMsg = await nextMessage(newCandidate);
      expect(authMsg.type).toBe('AUTH_OK');
      expect(authMsg.sessionStatus).toBe('ACTIVE');
    });

    it('should end session if peer does not reconnect within 30 seconds', async () => {
      const { recruiter, candidate } = await setupActiveState(doStub);

      candidate.close();

      await advanceTime(31 * 1000);

      const msg = await nextMessage(recruiter);
      expect(msg.type).toBe('HANGUP');
      expect(msg.reason).toBe('candidate_disconnected');
    });
  });
});
```

### 8.2 Scheduling Worker Tests (Vitest + Miniflare)

```typescript
// workers/test/scheduling.test.ts

describe('Scheduling Webhook Worker', () => {
  it('should verify Calendly HMAC and update interview status', async () => {
    // Setup: create connection + interview in D1
    await seedConnection({ id: 'conn-1', webhookSecret: 'secret123', status: 'ACTIVE' });
    await seedInterview({ id: 'int-1', candidateEmail: 'alice@example.com', status: 'INVITED' });

    const payload = JSON.stringify(calendlyBookingPayload);
    const signature = computeHmac(payload, 'secret123');

    const res = await worker.fetch('/api/scheduling/webhook?connectionId=conn-1', {
      method: 'POST',
      headers: {
        'calendly-webhook-signature': signature,
        'content-type': 'application/json',
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const interview = await getInterview('int-1');
    expect(interview.status).toBe('SCHEDULED');
    expect(interview.scheduled_at).toBeTruthy();
  });

  it('should reject webhook with invalid HMAC signature', async () => {
    await seedConnection({ id: 'conn-1', webhookSecret: 'secret123', status: 'ACTIVE' });

    const res = await worker.fetch('/api/scheduling/webhook?connectionId=conn-1', {
      method: 'POST',
      headers: {
        'calendly-webhook-signature': 'invalid',
        'content-type': 'application/json',
      },
      body: '{}',
    });

    expect(res.status).toBe(401);
  });

  it('should reject invalid status transition', async () => {
    await seedConnection({ id: 'conn-1', webhookSecret: 'secret123', status: 'ACTIVE' });
    await seedInterview({ id: 'int-1', status: 'COMPLETED' });

    const res = await sendCalendlyWebhook('conn-1', 'secret123', {
      event: 'invitee.created',
      status: 'SCHEDULED',
    });

    expect(res.status).toBe(200); // 200 but no update
    const body = await res.json();
    expect(body.message).toContain('Transition not allowed');
  });
});

describe('Scheduling OAuth Worker', () => {
  it('should exchange OAuth code and store encrypted tokens', async () => {
    mockCalendlyTokenEndpoint({ access_token: 'at-123', refresh_token: 'rt-456' });
    mockCalendlyUserInfo({ email: 'jane@co.com', name: 'Jane' });

    const res = await authedFetch('/api/scheduling/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'CALENDLY',
        code: 'auth-code-xyz',
        redirectUri: 'https://app.pipe-os.com/schedule/callback',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.accountEmail).toBe('jane@co.com');

    // Verify tokens are encrypted in D1
    const row = await getD1Row('scheduling_connections', body.data.connectionId);
    expect(row.access_token_encrypted).not.toBe('at-123');
    expect(row.access_token_encrypted).toBeTruthy();
  });

  it('should disconnect and revoke webhook', async () => {
    await seedConnection({ id: 'conn-1', webhookId: 'wh-1', status: 'ACTIVE' });
    mockCalendlyDeleteWebhook('wh-1');

    const res = await authedFetch('/api/scheduling/oauth/disconnect', {
      method: 'POST',
      body: JSON.stringify({ connectionId: 'conn-1' }),
    });

    expect(res.status).toBe(200);
    const conn = await getD1Row('scheduling_connections', 'conn-1');
    expect(conn.status).toBe('REVOKED');
  });
});
```

### 8.3 Frontend Hook Tests (Vitest + Testing Library)

```typescript
// src/hooks/__tests__/useVideoSignaling.test.ts

describe('useVideoSignaling (Cloudflare)', () => {
  it('should open WebSocket and authenticate on mount', async () => {
    const mockWs = new MockWebSocket();
    vi.spyOn(window, 'WebSocket').mockReturnValue(mockWs);

    renderHook(() => useVideoSignaling({
      stageId: 'stage-1',
      candidateId: 'cand-1',
      role: 'RECRUITER',
      onSignal: vi.fn(),
    }));

    expect(mockWs.url).toContain('/api/video/stage-1/cand-1/ws');
    // Verify AUTH message sent after connection opens
    mockWs.triggerOpen();
    expect(JSON.parse(mockWs.lastSentMessage)).toEqual({
      type: 'AUTH',
      role: 'RECRUITER',
      token: expect.any(String),
    });
  });

  it('should call onSignal when remote OFFER arrives', async () => {
    const onSignal = vi.fn();
    const mockWs = new MockWebSocket();

    renderHook(() => useVideoSignaling({
      stageId: 'stage-1',
      candidateId: 'cand-1',
      role: 'CANDIDATE',
      onSignal,
    }));

    mockWs.triggerOpen();
    mockWs.triggerMessage({ type: 'AUTH_OK', sessionStatus: 'CALLING' });
    mockWs.triggerMessage({
      type: 'OFFER',
      sdp: 'v=0\r\n...',
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      senderRole: 'RECRUITER',
    });

    expect(onSignal).toHaveBeenCalledWith('OFFER', {
      type: 'offer',
      sdp: 'v=0\r\n...',
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
  });

  it('should reconnect with exponential backoff on disconnect', async () => {
    // Test that WebSocket reconnects after unexpected close
  });
});

// src/hooks/__tests__/useScheduledInterviews.test.ts

describe('useScheduledInterviews (polling)', () => {
  it('should poll every 5 seconds when tab is focused', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ id: '1', status: 'INVITED' }]))
    );

    renderHook(() => useScheduledInterviews());

    // Initial fetch
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // After 5 seconds
    vi.advanceTimersByTime(5000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('should pause polling when tab is hidden', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]))
    );

    renderHook(() => useScheduledInterviews());
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Simulate tab hidden
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(15000);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // No additional fetches
  });
});
```

### 8.4 E2E Tests (Playwright)

```typescript
// e2e/video-signaling.spec.ts

test.describe('Video Call E2E', () => {
  test('recruiter initiates call, candidate joins, both hang up', async ({
    recruiterPage,
    candidatePage,
  }) => {
    // Recruiter navigates to live video stage
    await recruiterPage.goto(`/pipeline/${pipelineId}/stages/${stageId}`);
    await recruiterPage.click('[data-testid="start-video-call"]');
    await expect(recruiterPage.locator('[data-testid="call-status"]')).toHaveText('Waiting for candidate...');

    // Candidate sees incoming call
    await candidatePage.goto(`/assess/${inviteToken}`);
    await expect(candidatePage.locator('[data-testid="incoming-call"]')).toBeVisible({ timeout: 10000 });
    await candidatePage.click('[data-testid="accept-call"]');

    // Both connected
    await expect(recruiterPage.locator('[data-testid="call-status"]')).toHaveText('Connected');
    await expect(candidatePage.locator('[data-testid="call-status"]')).toHaveText('Connected');

    // Recruiter hangs up
    await recruiterPage.click('[data-testid="end-call"]');
    await expect(recruiterPage.locator('[data-testid="call-status"]')).toHaveText('Call ended');
    await expect(candidatePage.locator('[data-testid="call-status"]')).toHaveText('Call ended');
  });
});

// e2e/scheduling.spec.ts

test.describe('Scheduling Dashboard E2E', () => {
  test('webhook updates scheduling dashboard within 5 seconds', async ({
    recruiterPage,
    request,
  }) => {
    // Navigate to scheduling dashboard
    await recruiterPage.goto('/schedule');
    await expect(recruiterPage.locator('[data-testid="interview-alice"]')).toHaveText(/INVITED/);

    // Simulate Calendly webhook (call the webhook endpoint directly)
    await request.post(`${apiBaseUrl}/api/scheduling/webhook?connectionId=${connectionId}`, {
      headers: {
        'calendly-webhook-signature': computeHmac(webhookPayload, webhookSecret),
        'content-type': 'application/json',
      },
      data: webhookPayload,
    });

    // Dashboard should update within polling interval
    await expect(recruiterPage.locator('[data-testid="interview-alice"]')).toHaveText(/SCHEDULED/, {
      timeout: 10000,
    });
  });
});
```

---

## 9. Definition of Done

Phase 4 is complete when:

1. **Video signaling works end-to-end on Cloudflare** -- a recruiter can start a video call, the candidate receives the notification, the SDP/ICE exchange completes via Durable Objects, and media flows between peers.

2. **Scheduling OAuth works end-to-end on Cloudflare** -- a recruiter can connect Calendly, receive webhook-driven booking updates, and disconnect the provider.

3. **No AppSync subscriptions remain** -- all `observeQuery` calls in `useVideoSignaling`, `useScheduledInterviews`, and `useSchedulingConnection` are replaced with WebSocket (video) or polling (scheduling).

4. **No Amplify Lambda functions remain for these features** -- `turnCredentials`, `schedulingOAuth`, and `schedulingWebhook` are fully replaced by Workers.

5. **All BDD acceptance tests pass** -- Durable Object unit tests, Worker integration tests, frontend hook tests, and Playwright E2E tests.

6. **Security invariants hold**:
   - No internal IDs exposed to candidate clients
   - Candidate WebSocket connections require valid session tokens
   - Recruiter WebSocket connections require valid Clerk JWTs
   - OAuth tokens encrypted at rest in D1
   - Webhook HMAC verification rejects tampered payloads

7. **TypeScript strict mode** -- no `any`, all exports have explicit return types, all WebSocket messages are typed.

8. **CHANGELOG.md updated** with all changes under `[Unreleased]`.
