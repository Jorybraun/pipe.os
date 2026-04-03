/**
 * VideoRoom Durable Object — WebRTC signaling room.
 *
 * Each video session gets its own DO instance (keyed by session ID).
 * Manages WebSocket connections for two peers (recruiter + candidate)
 * and routes signaling messages between them.
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

type VideoRole = 'RECRUITER' | 'CANDIDATE';
type SessionStatus = 'WAITING' | 'CALLING' | 'ACTIVE' | 'ENDED';

interface SignalMessage {
  type: 'OFFER' | 'ANSWER' | 'ICE_CANDIDATE' | 'HANGUP' | 'STATUS_UPDATE';
  role?: VideoRole;
  status?: SessionStatus;
  payload?: unknown;
}

interface PeerConnection {
  ws: WebSocket;
  role: VideoRole;
}

export class VideoRoom {
  private state: DurableObjectState;
  private peers: Map<string, PeerConnection> = new Map();
  private sessionStatus: SessionStatus = 'WAITING';
  private metadata: {
    stageId?: string;
    candidateId?: string;
    recruiterId?: string;
  } = {};

  constructor(state: DurableObjectState) {
    this.state = state;

    // Restore status from storage on cold start
    void state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<SessionStatus>('status');
      if (stored) this.sessionStatus = stored;
      const meta = await state.storage.get<typeof this.metadata>('metadata');
      if (meta) this.metadata = meta;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /init — initialize session metadata (called before WebSocket)
    if (request.method === 'POST' && url.pathname === '/init') {
      const body = await request.json() as {
        stageId: string;
        candidateId: string;
        recruiterId: string;
      };
      this.metadata = {
        stageId: body.stageId,
        candidateId: body.candidateId,
        recruiterId: body.recruiterId,
      };
      this.sessionStatus = 'WAITING';
      await this.state.storage.put('metadata', this.metadata);
      await this.state.storage.put('status', this.sessionStatus);

      return new Response(JSON.stringify({ status: 'WAITING' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /status — return current session status
    if (request.method === 'GET' && url.pathname === '/status') {
      return new Response(JSON.stringify({
        status: this.sessionStatus,
        metadata: this.metadata,
        peers: this.peers.size,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade for /ws?role=RECRUITER|CANDIDATE
    if (url.pathname === '/ws') {
      const role = url.searchParams.get('role') as VideoRole | null;
      if (!role || !['RECRUITER', 'CANDIDATE'].includes(role)) {
        return new Response('Missing or invalid role parameter', { status: 400 });
      }

      // Check if this role is already connected
      for (const [, peer] of this.peers) {
        if (peer.role === role) {
          return new Response(`${role} is already connected`, { status: 409 });
        }
      }

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      const peerId = crypto.randomUUID();

      this.state.acceptWebSocket(server, [role]);

      this.peers.set(peerId, { ws: server, role });

      // Send current status to the new peer
      server.send(JSON.stringify({
        type: 'STATUS_UPDATE',
        status: this.sessionStatus,
        metadata: this.metadata,
      }));

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response('Not found', { status: 404 });
  }

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

    // Find the sender
    const senderEntry = [...this.peers.entries()].find(([, p]) => p.ws === ws);
    if (!senderEntry) return;

    const [, sender] = senderEntry;

    // Handle status updates
    if (message.type === 'STATUS_UPDATE' && message.status) {
      this.sessionStatus = message.status;
      await this.state.storage.put('status', this.sessionStatus);

      // Broadcast to all peers
      this.broadcast(JSON.stringify({
        type: 'STATUS_UPDATE',
        status: this.sessionStatus,
        role: sender.role,
      }));

      // If ENDED, schedule cleanup
      if (this.sessionStatus === 'ENDED') {
        // Give peers 5 seconds to receive the ENDED message, then clean up
        void this.state.storage.setAlarm(Date.now() + 5000);
      }
      return;
    }

    // Route signaling messages to the remote peer
    const remoteRole: VideoRole = sender.role === 'RECRUITER' ? 'CANDIDATE' : 'RECRUITER';
    const remotePeer = [...this.peers.values()].find((p) => p.role === remoteRole);

    if (remotePeer) {
      remotePeer.ws.send(JSON.stringify({
        type: message.type,
        role: sender.role,
        payload: message.payload,
      }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string): Promise<void> {
    // Remove the disconnected peer
    for (const [id, peer] of this.peers) {
      if (peer.ws === ws) {
        this.peers.delete(id);

        // Notify the remaining peer
        this.broadcast(JSON.stringify({
          type: 'PEER_DISCONNECTED',
          role: peer.role,
          code,
        }));

        break;
      }
    }

    // If both peers are gone and session is active, mark as ended
    if (this.peers.size === 0 && this.sessionStatus !== 'ENDED') {
      this.sessionStatus = 'ENDED';
      await this.state.storage.put('status', this.sessionStatus);
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    // Same as close — remove the peer
    await this.webSocketClose(ws, 1011, 'error');
  }

  async alarm(): Promise<void> {
    // Clean up storage after session ends
    await this.state.storage.deleteAll();
    this.peers.clear();
  }

  private broadcast(message: string): void {
    for (const [, peer] of this.peers) {
      try {
        peer.ws.send(message);
      } catch {
        // Ignore — peer may have already disconnected
      }
    }
  }
}
