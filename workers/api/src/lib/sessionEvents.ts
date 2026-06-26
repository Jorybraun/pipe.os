/**
 * sessionEvents.ts — Capture meeting session events as candidate_nodes.
 *
 * Every event during a meeting (AI chat, terminal I/O, file changes,
 * browser navigation, window state) becomes a CandidateNode with
 * source_type = 'meeting_session', linked to the candidate being
 * interviewed. These nodes are written to D1 and mirrored to Neo4j,
 * becoming part of the candidate's knowledge graph ("brain").
 *
 * The agent (Devin) can query this brain via the /context endpoint
 * on the agent bridge, giving it full context about the person
 * it's pair-programming with.
 */

import type { CandidateNode } from '../types';
import { insertCandidateNode } from './candidateDiscovery/candidateNodes';
import { writeCandidateGraphFireAndForget } from './neo4j/writeCandidateGraph';

export type SessionEventType =
  | 'ai_chat_user'
  | 'ai_chat_agent'
  | 'ai_agent_status'
  | 'terminal_command'
  | 'terminal_output'
  | 'file_change'
  | 'browser_navigation'
  | 'window_open'
  | 'window_close'
  | 'window_focus'
  | 'participant_join'
  | 'participant_leave'
  | 'clippy_action'
  | 'recording_start'
  | 'recording_stop'
  | 'code_editor_open'
  | 'code_editor_save';

export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  candidateId: string;
  timestamp: number;
  actor: 'host' | 'guest' | 'agent' | 'system';
  text: string;
  properties?: Record<string, unknown>;
}

/**
 * Convert a session event to a CandidateNode insertion payload.
 */
function eventToNodePayload(event: SessionEvent): Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> {
  const nodeType = mapEventTypeToNodeType(event.type);
  const narrativeText = formatEventNarrative(event);
  const extractedProperties = event.properties
    ? JSON.stringify({ ...event.properties, actor: event.actor, sessionId: event.sessionId })
    : JSON.stringify({ actor: event.actor, sessionId: event.sessionId });

  return {
    candidate_id: event.candidateId,
    node_type: nodeType,
    narrative_text: narrativeText,
    extracted_properties_json: extractedProperties,
    embedding_json: null, // Embeddings generated lazily or by background job
    source_type: 'meeting_session',
    source_reference: event.sessionId,
    captured_at: event.timestamp,
    confidence: 1.0,
    supersedes: null,
    superseded_at: null,
    decomposition_version: 'session-v1',
  };
}

function mapEventTypeToNodeType(type: SessionEventType): string {
  const mapping: Record<SessionEventType, string> = {
    ai_chat_user: 'session_chat_user',
    ai_chat_agent: 'session_chat_agent',
    ai_agent_status: 'session_agent_status',
    terminal_command: 'session_terminal_command',
    terminal_output: 'session_terminal_output',
    file_change: 'session_file_change',
    browser_navigation: 'session_browser_nav',
    window_open: 'session_window_open',
    window_close: 'session_window_close',
    window_focus: 'session_window_focus',
    participant_join: 'session_participant_join',
    participant_leave: 'session_participant_leave',
    clippy_action: 'session_clippy_action',
    recording_start: 'session_recording_start',
    recording_stop: 'session_recording_stop',
    code_editor_open: 'session_code_editor_open',
    code_editor_save: 'session_code_editor_save',
  };
  return mapping[type] ?? 'session_event';
}

function formatEventNarrative(event: SessionEvent): string {
  const time = new Date(event.timestamp * 1000).toISOString();
  switch (event.type) {
    case 'ai_chat_user':
      return `[${time}] User asked: "${event.text}"`;
    case 'ai_chat_agent':
      return `[${time}] Agent responded: "${event.text}"`;
    case 'ai_agent_status':
      return `[${time}] Agent status: ${event.text}`;
    case 'terminal_command':
      return `[${time}] Terminal command: ${event.text}`;
    case 'terminal_output':
      return `[${time}] Terminal output: ${event.text.slice(0, 500)}`;
    case 'file_change':
      return `[${time}] File ${event.properties?.action ?? 'changed'}: ${event.text}`;
    case 'browser_navigation':
      return `[${time}] Browser navigated to: ${event.text}`;
    case 'window_open':
      return `[${time}] Window opened: ${event.text}`;
    case 'window_close':
      return `[${time}] Window closed: ${event.text}`;
    case 'window_focus':
      return `[${time}] Window focused: ${event.text}`;
    case 'participant_join':
      return `[${time}] Participant joined: ${event.text}`;
    case 'participant_leave':
      return `[${time}] Participant left: ${event.text}`;
    case 'clippy_action':
      return `[${time}] ${event.text}`;
    case 'recording_start':
      return `[${time}] Recording started`;
    case 'recording_stop':
      return `[${time}] Recording stopped`;
    case 'code_editor_open':
      return `[${time}] Opened in editor: ${event.text}`;
    case 'code_editor_save':
      return `[${time}] Saved in editor: ${event.text}`;
    default:
      return `[${time}] ${event.text}`;
  }
}

/**
 * Persist a session event as a candidate_node in D1 and mirror to Neo4j.
 */
export async function captureSessionEvent(
  db: D1Database,
  event: SessionEvent,
  env?: { NEO4J_URI?: string; NEO4J_USER?: string; NEO4J_PASSWORD?: string },
): Promise<CandidateNode | null> {
  try {
    const payload = eventToNodePayload(event);
    const node = await insertCandidateNode(db, payload);

    // Fire-and-forget write to Neo4j graph
    if (env?.NEO4J_URI && env?.NEO4J_PASSWORD) {
      writeCandidateGraphFireAndForget({
        candidateId: event.candidateId,
        nodes: [node],
        env,
      });
    }

    return node;
  } catch (err) {
    console.error('[sessionEvents] Failed to capture event:', err);
    return null;
  }
}

/**
 * Batch capture multiple events at once.
 */
export async function captureSessionEvents(
  db: D1Database,
  events: SessionEvent[],
  env?: { NEO4J_URI?: string; NEO4J_USER?: string; NEO4J_PASSWORD?: string },
): Promise<{ captured: number; failed: number }> {
  let captured = 0;
  let failed = 0;

  // Batch insert to D1, then fire-and-forget Neo4j write
  const nodes: CandidateNode[] = [];
  for (const event of events) {
    try {
      const payload = eventToNodePayload(event);
      const node = await insertCandidateNode(db, payload);
      nodes.push(node);
      captured++;
    } catch {
      failed++;
    }
  }

  if (nodes.length > 0 && env?.NEO4J_URI && env?.NEO4J_PASSWORD) {
    // Group by candidateId for Neo4j writes
    const byCandidate = new Map<string, CandidateNode[]>();
    for (const node of nodes) {
      const existing = byCandidate.get(node.candidate_id) ?? [];
      existing.push(node);
      byCandidate.set(node.candidate_id, existing);
    }
    for (const [candidateId, candidateNodes] of byCandidate) {
      writeCandidateGraphFireAndForget({
        candidateId,
        nodes: candidateNodes,
        env,
      });
    }
  }

  return { captured, failed };
}

/**
 * Retrieve the full session context graph for a candidate.
 * Returns all session event nodes, ordered by timestamp.
 */
export async function getSessionContextGraph(
  db: D1Database,
  candidateId: string,
  sessionId?: string,
): Promise<SessionContextNode[]> {
  const nodes = sessionId
    ? await db
        .prepare(
          `SELECT * FROM candidate_nodes
           WHERE candidate_id = ?1 AND source_type = 'meeting_session' AND source_reference = ?2
           ORDER BY captured_at ASC`,
        )
        .bind(candidateId, sessionId)
        .all<CandidateNode>()
    : await db
        .prepare(
          `SELECT * FROM candidate_nodes
           WHERE candidate_id = ?1 AND source_type = 'meeting_session'
           ORDER BY captured_at ASC`,
        )
        .bind(candidateId)
        .all<CandidateNode>();

  return (nodes.results ?? []).map(nodeToContextNode);
}

/**
 * Get a compact text summary of the session context — useful for
 * passing as system prompt context to the AI agent.
 */
export async function getSessionContextSummary(
  db: D1Database,
  candidateId: string,
  sessionId?: string,
): Promise<string> {
  const graph = await getSessionContextGraph(db, candidateId, sessionId);
  if (graph.length === 0) return '';

  const lines: string[] = [
    `=== Session Context (${graph.length} events) ===`,
  ];

  // Group by event category
  const byCategory = new Map<string, SessionContextNode[]>();
  for (const node of graph) {
    const category = node.nodeType.replace('session_', '').split('_')[0] ?? 'other';
    const existing = byCategory.get(category) ?? [];
    existing.push(node);
    byCategory.set(category, existing);
  }

  for (const [category, nodes] of byCategory) {
    lines.push(`\n--- ${category.toUpperCase()} (${nodes.length} events) ---`);
    for (const node of nodes.slice(0, 20)) {
      lines.push(node.narrativeText);
    }
    if (nodes.length > 20) {
      lines.push(`... and ${nodes.length - 20} more`);
    }
  }

  return lines.join('\n');
}

export interface SessionContextNode {
  id: string;
  nodeType: string;
  narrativeText: string;
  properties: Record<string, unknown> | null;
  capturedAt: number;
  sessionId: string;
}

interface RoomResolutionRow {
  session_id: string;
  meeting_id: string;
  meeting_owner_id: string;
  meeting_contact_id: string | null;
  scheduled_interview_id: string | null;
}

interface InterviewResolutionRow {
  candidate_id: string | null;
  owner_id: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
}

interface ContactResolutionRow {
  name: string | null;
  email: string | null;
}

function nodeToContextNode(node: CandidateNode): SessionContextNode {
  let properties: Record<string, unknown> | null = null;
  try {
    properties = node.extracted_properties_json
      ? JSON.parse(node.extracted_properties_json)
      : null;
  } catch {
    // ignore
  }
  return {
    id: node.id,
    nodeType: node.node_type,
    narrativeText: node.narrative_text,
    properties,
    capturedAt: node.captured_at,
    sessionId: node.source_reference ?? '',
  };
}

function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email ? email : null;
}

async function ensureRolelessCandidateForSession(
  db: D1Database,
  input: {
    ownerId: string;
    name: string | null;
    email: string;
    scheduledInterviewId: string | null;
  },
): Promise<string> {
  const existing = await db
    .prepare(
      `SELECT id FROM candidates
       WHERE owner_id = ?1 AND lower(email) = ?2 AND pipeline_id IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .bind(input.ownerId, input.email)
    .first<{ id: string }>();

  const now = new Date().toISOString();
  if (existing) {
    if (input.scheduledInterviewId) {
      await db
        .prepare(
          `UPDATE scheduled_interviews
              SET candidate_id = COALESCE(candidate_id, ?1), updated_at = ?2
            WHERE id = ?3`,
        )
        .bind(existing.id, now, input.scheduledInterviewId)
        .run();
    }
    return existing.id;
  }

  const candidateId = crypto.randomUUID();
  const inviteToken = crypto.randomUUID();
  const fallbackName = input.name?.trim() || input.email.split('@')[0] || 'Candidate';
  await db
    .prepare(
      `INSERT INTO candidates (
         id, pipeline_id, owner_id, name, email, invite_token, status,
         current_stage_id, created_at, updated_at
       ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, 'INVITED', NULL, ?6, ?6)`,
    )
    .bind(candidateId, input.ownerId, fallbackName, input.email, inviteToken, now)
    .run();

  await db
    .prepare(
      `INSERT INTO candidate_ingestion (candidate_id, status, created_at, updated_at)
       VALUES (?1, 'pending', ?2, ?2)
       ON CONFLICT(candidate_id) DO NOTHING`,
    )
    .bind(candidateId, now)
    .run()
    .catch(() => undefined);

  if (input.scheduledInterviewId) {
    await db
      .prepare(
        `UPDATE scheduled_interviews
            SET candidate_id = ?1, updated_at = ?2
          WHERE id = ?3`,
      )
      .bind(candidateId, now, input.scheduledInterviewId)
      .run();
  }

  return candidateId;
}

/**
 * Resolve the candidate_id for a meeting room token.
 * Traces: token → room → meeting → scheduled_interview/contact → candidate_id.
 */
export async function resolveCandidateIdForRoom(
  db: D1Database,
  token: string,
): Promise<{ candidateId: string | null; sessionId: string; meetingId: string } | null> {
  const { hashRoomToken } = await import('./roomTokens.js');
  const tokenHash = await hashRoomToken(token);
  const now = new Date().toISOString();

  const room = await db.prepare(
    `SELECT mr.session_id, mr.meeting_id, m.owner_id AS meeting_owner_id,
            m.scheduled_interview_id,
            (
              SELECT mp.contact_id
                FROM meeting_participants mp
               WHERE mp.meeting_id = m.id
                 AND mp.role = 'ATTENDEE'
               ORDER BY mp.created_at DESC
               LIMIT 1
            ) AS meeting_contact_id
     FROM meeting_room_tokens mrt
     INNER JOIN meeting_rooms mr ON mr.id = mrt.room_id
     INNER JOIN meetings m ON m.id = mr.meeting_id
     WHERE mrt.token_hash = ? AND mrt.revoked_at IS NULL AND mrt.expires_at > ?`,
  ).bind(tokenHash, now).first<RoomResolutionRow>();

  if (!room) return null;

  let candidateId: string | null = null;
  let ownerId = room.meeting_owner_id;
  let recipientName: string | null = null;
  let recipientEmail: string | null = null;

  if (room.scheduled_interview_id) {
    const interview = await db.prepare(
      `SELECT candidate_id, owner_id, recipient_name, recipient_email
         FROM scheduled_interviews
        WHERE id = ?`,
    ).bind(room.scheduled_interview_id).first<InterviewResolutionRow>();
    candidateId = interview?.candidate_id ?? null;
    ownerId = interview?.owner_id ?? ownerId;
    recipientName = interview?.recipient_name ?? null;
    recipientEmail = normalizeEmail(interview?.recipient_email);
  }

  if (!candidateId && room.meeting_contact_id) {
    const contact = await db
      .prepare('SELECT name, email FROM contacts WHERE id = ?')
      .bind(room.meeting_contact_id)
      .first<ContactResolutionRow>();
    recipientName = recipientName ?? contact?.name ?? null;
    recipientEmail = recipientEmail ?? normalizeEmail(contact?.email);
  }

  if (!candidateId && ownerId && recipientEmail) {
    candidateId = await ensureRolelessCandidateForSession(db, {
      ownerId,
      name: recipientName,
      email: recipientEmail,
      scheduledInterviewId: room.scheduled_interview_id,
    });
  }

  return {
    candidateId,
    sessionId: room.session_id,
    meetingId: room.meeting_id,
  };
}
