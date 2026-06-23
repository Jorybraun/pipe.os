/**
 * VideoRoom Durable Object — WebRTC signaling room.
 *
 * Each video session gets its own DO instance (keyed by session ID).
 * Manages WebSocket connections for two peers (recruiter + candidate)
 * and routes signaling messages between them.
 *
 * Uses the Hibernation API — peer tracking via state.getWebSockets()
 * (survives hibernation) instead of in-memory Maps (lost on wake).
 *
 * Session lifecycle: WAITING → CALLING → ACTIVE → ENDED
 *
 * Messages are JSON-encoded with the format:
 *   { type: 'OFFER' | 'ANSWER' | 'ICE_CANDIDATE' | 'HANGUP' | 'STATUS_UPDATE',
 *     role: 'RECRUITER' | 'CANDIDATE',
 *     payload: ... }
 *
 * Status updates are broadcast to both peers:
 *   { type: 'STATUS_UPDATE', status: 'WAITING' | 'CALLING' | 'ACTIVE' | 'ENDED' }
 */

import type { DurableObjectState } from '@cloudflare/workers-types';

type VideoRole = 'RECRUITER' | 'CANDIDATE' | 'HOST' | 'GUEST';
type SessionStatus = 'WAITING' | 'CALLING' | 'ACTIVE' | 'ENDED';
type SignalStatus = SessionStatus | 'LEFT';

interface SignalMessage {
  type: 'OFFER' | 'ANSWER' | 'ICE_CANDIDATE' | 'HANGUP' | 'STATUS_UPDATE';
  role?: VideoRole;
  status?: SignalStatus;
  payload?: unknown;
}

interface VideoRoomMetadata {
  stageId?: string;
  candidateId?: string;
  recruiterId?: string;
  scheduledInterviewId?: string;  // For transcript artifact association
  meetingId?: string;
  hostId?: string;
}

export class VideoRoom {
  private state: DurableObjectState;
  private sessionStatus: SessionStatus = 'WAITING';
  private metadata: VideoRoomMetadata = {};

  constructor(state: DurableObjectState) {
    this.state = state;

    // Restore status from storage on cold start
    void state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<unknown>('status');
      if (this.isSessionStatus(stored)) this.sessionStatus = stored;
      const meta = await state.storage.get<VideoRoomMetadata>('metadata');
      if (meta) this.metadata = meta;
      const offer = await state.storage.get<string>('lastOffer');
      if (offer) this._lastOffer = offer;
    });
  }

  private _lastOffer: string | null = null;

  // ── Helpers: use Hibernation API for peer tracking ──────────────────────

  /** Get all active WebSockets for a specific role */
  private getWebSocketsByRole(role: VideoRole): WebSocket[] {
    return this.state.getWebSockets(role);
  }

  /** Get the role tag from a WebSocket */
  private getRoleFromWs(ws: WebSocket): VideoRole | null {
    const tags = this.state.getTags(ws);
    if (tags.includes('RECRUITER')) return 'RECRUITER';
    if (tags.includes('CANDIDATE')) return 'CANDIDATE';
    if (tags.includes('HOST')) return 'HOST';
    if (tags.includes('GUEST')) return 'GUEST';
    return null;
  }

  private isHostRole(role: VideoRole): boolean {
    return role === 'RECRUITER' || role === 'HOST';
  }

  private remoteRole(role: VideoRole): VideoRole {
    if (role === 'RECRUITER') return 'CANDIDATE';
    if (role === 'CANDIDATE') return 'RECRUITER';
    if (role === 'HOST') return 'GUEST';
    return 'HOST';
  }

  private isSessionStatus(status: unknown): status is SessionStatus {
    return status === 'WAITING'
      || status === 'CALLING'
      || status === 'ACTIVE'
      || status === 'ENDED';
  }

  /** Get all active WebSockets */
  private getAllWebSockets(): WebSocket[] {
    return this.state.getWebSockets();
  }

  /** Broadcast a message to all connected peers */
  private broadcast(message: string): void {
    for (const ws of this.getAllWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // Ignore — peer may have already disconnected
      }
    }
  }

  /** Send a message to all peers EXCEPT the given WebSocket */
  private broadcastExcept(ws: WebSocket, message: string): void {
    for (const peer of this.getAllWebSockets()) {
      if (peer !== ws) {
        try {
          peer.send(message);
        } catch {
          // Ignore
        }
      }
    }
  }

  private async persistSessionStatus(status: SessionStatus, endedByHost = false): Promise<void> {
    this.sessionStatus = status;
    await this.state.storage.put('status', this.sessionStatus);
    if (endedByHost) {
      await this.state.storage.put('endedByHost', true);
    } else if (status !== 'ENDED') {
      await this.state.storage.delete('endedByHost');
    }
  }

  private async endSession(senderRole: VideoRole): Promise<void> {
    const alreadyEnded = this.sessionStatus === 'ENDED';
    this._lastOffer = null;
    await this.state.storage.delete('lastOffer');
    await this.persistSessionStatus('ENDED', true);
    this.broadcast(JSON.stringify({
      type: 'STATUS_UPDATE',
      status: this.sessionStatus,
      role: senderRole,
    }));
    if (!alreadyEnded) {
      void this.state.storage.setAlarm(Date.now() + 5000);
    }
  }

  // ── HTTP handler ────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /init — initialize session metadata (called before WebSocket)
    if (request.method === 'POST' && url.pathname === '/init') {
      const body = await request.json() as {
        stageId?: string;
        candidateId?: string;
        recruiterId?: string;
        scheduledInterviewId?: string;
        meetingId?: string;
        hostId?: string;
      };
      this.metadata = {
        stageId: body.stageId,
        candidateId: body.candidateId,
        recruiterId: body.recruiterId,
        scheduledInterviewId: body.scheduledInterviewId,
        meetingId: body.meetingId,
        hostId: body.hostId,
      };
      this.sessionStatus = 'WAITING';
      this._lastOffer = null;
      await this.state.storage.put('metadata', this.metadata);
      await this.persistSessionStatus(this.sessionStatus);
      await this.state.storage.delete('lastOffer');

      return new Response(JSON.stringify({ status: 'WAITING' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /ensure — idempotently initialize a standalone meeting room.
    if (request.method === 'POST' && url.pathname === '/ensure') {
      const body = await request.json() as {
        meetingId: string;
        hostId: string;
        resetEnded?: boolean;
      };
      if (!this.metadata.meetingId) {
        this.metadata = { meetingId: body.meetingId, hostId: body.hostId };
        await this.state.storage.put('metadata', this.metadata);
      }
      const storedStatus = await this.state.storage.get<unknown>('status');
      const endedByHost = await this.state.storage.get<boolean>('endedByHost');
      if (
        !this.isSessionStatus(storedStatus)
        || (storedStatus === 'ENDED' && body.resetEnded && !endedByHost)
      ) {
        this.sessionStatus = 'WAITING';
        await this.persistSessionStatus(this.sessionStatus);
        this._lastOffer = null;
        await this.state.storage.delete('lastOffer');
      } else {
        this.sessionStatus = storedStatus;
      }
      return new Response(JSON.stringify({ status: this.sessionStatus }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /status — return current session status
    if (request.method === 'GET' && url.pathname === '/status') {
      const peerCount = this.getAllWebSockets().length;
      return new Response(JSON.stringify({
        status: this.sessionStatus,
        metadata: this.metadata,
        peers: peerCount,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade for legacy recruiter/candidate and meeting host/guest roles.
    if (url.pathname === '/ws') {
      const role = url.searchParams.get('role') as VideoRole | null;
      if (!role || !['RECRUITER', 'CANDIDATE', 'HOST', 'GUEST'].includes(role)) {
        return new Response('Missing or invalid role parameter', { status: 400 });
      }

      // Close any stale connections for this role (can happen after hibernation/reconnect)
      const existingForRole = this.getWebSocketsByRole(role);
      for (const staleWs of existingForRole) {
        try {
          staleWs.close(1000, 'Replaced by new connection');
        } catch {
          // Already closed
        }
      }

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      // Accept the WebSocket with the role as a tag (survives hibernation)
      this.state.acceptWebSocket(server, [role]);

      const peerCount = this.getAllWebSockets().length;

      // Send current status to the new peer
      server.send(JSON.stringify({
        type: 'STATUS_UPDATE',
        status: this.sessionStatus,
        metadata: this.metadata,
        peers: peerCount,
      }));

      // Notify other peers that this role has connected
      this.broadcastExcept(server, JSON.stringify({
        type: 'PEER_CONNECTED',
        role,
      }));

      // Replay stored OFFER to late-joining candidates
      if (!this.isHostRole(role) && this._lastOffer && this.sessionStatus === 'CALLING') {
        server.send(this._lastOffer);
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // ── Hibernation API handlers ────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const messageStr = typeof rawMessage === 'string'
      ? rawMessage
      : new TextDecoder().decode(rawMessage);

    let message: SignalMessage;
    try {
      message = JSON.parse(messageStr) as SignalMessage;
    } catch {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON' }));
      return;
    }

    // Identify the sender by their tag
    const senderRole = this.getRoleFromWs(ws);
    if (!senderRole) return;

    // Handle status updates
    if (message.type === 'STATUS_UPDATE' && message.status) {
      if (message.status === 'LEFT') {
        this.broadcastExcept(ws, JSON.stringify({
          type: 'PEER_DISCONNECTED',
          role: senderRole,
          code: 1000,
        }));
        return;
      }

      if (!this.isSessionStatus(message.status)) {
        ws.send(JSON.stringify({
          type: 'STATUS_UPDATE_REJECTED',
          status: message.status,
          reason: 'INVALID_STATUS',
        }));
        return;
      }

      if (message.status === 'ENDED' && !this.isHostRole(senderRole)) {
        ws.send(JSON.stringify({
          type: 'STATUS_UPDATE_REJECTED',
          status: message.status,
          reason: 'ONLY_HOST_CAN_END_ROOM',
        }));
        return;
      }

      if (message.status === 'ENDED') {
        await this.endSession(senderRole);
        return;
      }

      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'STATUS_UPDATE_REJECTED',
          status: message.status,
          reason: 'ROOM_ENDED',
        }));
        return;
      }

      if (
        !this.isHostRole(senderRole)
        && (message.status === 'WAITING' || message.status === 'CALLING')
      ) {
        ws.send(JSON.stringify({
          type: 'STATUS_UPDATE_REJECTED',
          status: message.status,
          reason: 'ONLY_HOST_CAN_SET_STATUS',
        }));
        return;
      }

      await this.persistSessionStatus(message.status);

      // Broadcast to all peers
      this.broadcast(JSON.stringify({
        type: 'STATUS_UPDATE',
        status: this.sessionStatus,
        role: senderRole,
      }));
      return;
    }

    if (message.type === 'HANGUP' && !this.isHostRole(senderRole)) {
      ws.send(JSON.stringify({
        type: 'SIGNAL_REJECTED',
        signalType: message.type,
        reason: 'ONLY_HOST_CAN_END_ROOM',
      }));
      return;
    }

    if (message.type === 'HANGUP') {
      await this.endSession(senderRole);
    }

    if (this.sessionStatus === 'ENDED' && message.type !== 'HANGUP') {
      ws.send(JSON.stringify({
        type: 'SIGNAL_REJECTED',
        signalType: message.type,
        reason: 'ROOM_ENDED',
      }));
      return;
    }

    // Store OFFER for replay to late-joining candidates
    if (message.type === 'OFFER' && this.isHostRole(senderRole)) {
      this._lastOffer = JSON.stringify({
        type: 'OFFER',
        role: senderRole,
        payload: message.payload,
      });
      await this.state.storage.put('lastOffer', this._lastOffer);
      if (this.sessionStatus !== 'ENDED') {
        await this.persistSessionStatus('CALLING');
      }
    }

    // Route signaling messages to the remote peer
    const remoteRole = this.remoteRole(senderRole);
    const remotePeers = this.getWebSocketsByRole(remoteRole);

    for (const remotePeer of remotePeers) {
      try {
        remotePeer.send(JSON.stringify({
          type: message.type,
          role: senderRole,
          payload: message.payload,
        }));
      } catch {
        // Remote peer may have disconnected
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const role = this.getRoleFromWs(ws);
    const replacedByReconnect = code === 1000 && reason === 'Replaced by new connection';

    // Socket closes include refreshes, hibernation resumes, mobile network
    // handoffs, and our own stale-socket replacement. They must not clear the
    // room status or the replayable offer.
    if (role && !replacedByReconnect) {
      this.broadcastExcept(ws, JSON.stringify({
        type: 'PEER_DISCONNECTED',
        role,
        code,
      }));
    }

    // A browser refresh, mobile sleep, network handoff, or temporary tab close
    // must not permanently end the room. Only an explicit HOST/RECRUITER
    // hangup or STATUS_UPDATE:ENDED transition ends the session.
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.webSocketClose(ws, 1011, 'error');
  }

  async alarm(): Promise<void> {
    // Clean up storage after session ends
    await this.state.storage.deleteAll();
  }

}
