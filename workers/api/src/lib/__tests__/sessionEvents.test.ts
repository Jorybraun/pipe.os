import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import {
  captureSessionEvent,
  getSessionContextGraph,
  getSessionContextSummary,
  roomActivitySnapshotToSessionEvents,
  resolveCandidateIdForRoom,
  type SessionEvent,
} from '../sessionEvents';

const candidateNodesMigrationSql = readFileSync(
  new URL('../../../migrations/0052_candidate_nodes.sql', import.meta.url),
  'utf8',
);
const candidateNodeIdempotencyMigrationSql = readFileSync(
  new URL('../../../migrations/0085_candidate_node_idempotency.sql', import.meta.url),
  'utf8',
);
const livingContextMigrationSql = readFileSync(
  new URL('../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigrationSql = readFileSync(
  new URL('../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const assessmentLayerMigrationSql = readFileSync(
  new URL('../../../migrations/0102_assessment_layer.sql', import.meta.url),
  'utf8',
);

// Mock D1Database
function createMockDb() {
  const stmts: Record<string, ReturnType<typeof vi.fn>> = {};
  const db: any = {
    prepare: vi.fn((sql: string) => {
      if (!stmts[sql]) stmts[sql] = vi.fn();
      const bind = vi.fn((...args: any[]) => ({
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ success: true })),
      }));
      stmts[sql]!.bind = bind;
      return { bind, get: bind, all: bind, run: bind };
    }),
  };
  return db;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createSessionEvidenceDb(): { sqlite: BetterSqliteDb; db: D1Database } {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(`
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT,
      owner_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      status TEXT NOT NULL
    );
  `);
  sqlite.exec(candidateNodesMigrationSql);
  sqlite.exec(candidateNodeIdempotencyMigrationSql);
  sqlite.exec(livingContextMigrationSql);
  sqlite.exec(contextRecordsMigrationSql);
  sqlite.exec(assessmentLayerMigrationSql);
  sqlite.prepare(
    `INSERT INTO candidates (id, pipeline_id, owner_id, name, email, status)
     VALUES ('cand-assessment', NULL, 'workspace-1', 'Ada Lovelace', 'ada@example.com', 'IN_PROGRESS')`,
  ).run();
  return { sqlite, db: createMockD1(sqlite) };
}

describe('sessionEvents', () => {
  let db: any;

  beforeEach(() => {
    db = createMockDb();
  });

  describe('captureSessionEvent', () => {
    it('should capture an AI chat event and return a node', async () => {
      const event: SessionEvent = {
        type: 'ai_chat_user',
        sessionId: 'test-session',
        candidateId: 'cand-123',
        timestamp: Math.floor(Date.now() / 1000),
        actor: 'host',
        text: 'How do I fix the auth bug?',
      };

      // Mock insertCandidateNode to return a fake node
      const result = await captureSessionEvent(db, event);
      // Will be null because insertCandidateNode mock returns null from .first()
      // But we verify it doesn't throw
      expect(result).toBeNull();
    });

    it('also appends source-backed 95 room assessment evidence for real agent events', async () => {
      const { sqlite, db: realDb } = createSessionEvidenceDb();
      try {
        const event: SessionEvent = {
          type: 'ai_chat_agent',
          sessionId: 'meeting-session-95',
          candidateId: 'cand-assessment',
          timestamp: 1782603900,
          actor: 'agent',
          text: 'I inspected the repository task and found the failing worker route.',
          properties: {
            source: 'clippy_agent_bridge',
            agentName: 'devin',
            surface: 'win95',
            workspaceSessionId: 'workspace-session-1',
          },
        };

        const node = await captureSessionEvent(realDb, event);
        expect(node).not.toBeNull();
        await captureSessionEvent(realDb, event);

        expect(sqlite.prepare(
          `SELECT mode, state, candidate_id, interview_id, metadata_json
             FROM assessment_sessions
            WHERE ingestion_key = ?`,
        ).get('assessment-session:95-room:cand-assessment:meeting-session-95')).toMatchObject({
          mode: 'NINETY_FIVE_UNTIL_INFINITY_ROOM',
          state: 'IN_PROGRESS',
          candidate_id: 'cand-assessment',
          interview_id: 'meeting-session-95',
        });

        const eventRows = sqlite.prepare(
          `SELECT e.kind, e.actor_type, e.actor_id, e.narrative,
                  r.source_ref_type, r.source_ref_id, r.exact_text, r.content_hash
             FROM assessment_evidence_events e
             JOIN assessment_event_source_refs r ON r.event_id = e.id
            ORDER BY e.sequence`,
        ).all() as Array<{
          kind: string;
          actor_type: string;
          actor_id: string;
          narrative: string;
          source_ref_type: string;
          source_ref_id: string;
          exact_text: string;
          content_hash: string;
        }>;
        expect(eventRows).toHaveLength(1);
        expect(eventRows[0]).toMatchObject({
          kind: 'ai_interaction',
          actor_type: 'devin',
          actor_id: 'devin',
          source_ref_type: 'meeting_session_event',
          source_ref_id: node!.id,
          content_hash: await sha256Hex(eventRows[0]!.exact_text),
        });
        expect(JSON.parse(eventRows[0]!.exact_text)).toMatchObject({
          type: event.type,
          sessionId: event.sessionId,
          candidateId: event.candidateId,
          timestamp: event.timestamp,
          actor: event.actor,
          text: event.text,
          properties: {
            source: 'clippy_agent_bridge',
            agentName: 'devin',
            surface: 'win95',
            workspaceSessionId: 'workspace-session-1',
          },
          candidateNodeId: node!.id,
        });
        expect(eventRows[0]!.narrative).toContain('Agent responded');

        expect(() => sqlite.prepare(
          `UPDATE assessment_evidence_events SET narrative = 'rewritten' WHERE id = (
             SELECT id FROM assessment_evidence_events LIMIT 1
           )`,
        ).run()).toThrow('assessment_evidence_events are immutable');
      } finally {
        sqlite.close();
      }
    });

    it('preserves explicit agent identity in 95 room assessment evidence without defaulting to Devin', async () => {
      const { sqlite, db: realDb } = createSessionEvidenceDb();
      try {
        const hermesAction: SessionEvent = {
          type: 'clippy_action',
          sessionId: 'meeting-session-agent-identity',
          candidateId: 'cand-assessment',
          timestamp: 1782604100,
          actor: 'agent',
          text: 'hermes suggested room action: open-terminal',
          properties: {
            source: 'clippy_agent_bridge',
            origin: 'agent',
            executionStatus: 'suggested',
            actionId: 'open-terminal',
            actionSource: 'agent_stdout',
            actionProtocol: 'clippy_room_action_tag',
            bridgeEventType: 'ROOM_ACTION',
            agent: 'hermes',
            observedAt: '2026-06-27T21:10:00.000Z',
            bridgePersisted: true,
            surface: 'win95',
          },
        };
        const missingIdentityStatus: SessionEvent = {
          type: 'ai_agent_status',
          sessionId: 'meeting-session-agent-identity',
          candidateId: 'cand-assessment',
          timestamp: 1782604200,
          actor: 'agent',
          text: 'Agent status changed without explicit bridge identity.',
          properties: {
            source: 'clippy_agent_bridge',
            status: 'thinking',
            surface: 'win95',
          },
        };

        await captureSessionEvent(realDb, hermesAction);
        await captureSessionEvent(realDb, missingIdentityStatus);

        const eventRows = sqlite.prepare(
          `SELECT kind, actor_type, actor_id, narrative
             FROM assessment_evidence_events
            ORDER BY sequence`,
        ).all() as Array<{
          kind: string;
          actor_type: string;
          actor_id: string | null;
          narrative: string;
        }>;

        expect(eventRows).toHaveLength(2);
        expect(eventRows[0]).toMatchObject({
          kind: 'ai_interaction',
          actor_type: 'ai_agent',
          actor_id: 'hermes',
          narrative: expect.stringContaining('hermes suggested room action'),
        });
        expect(eventRows[1]).toMatchObject({
          kind: 'ai_interaction',
          actor_type: 'ai_agent',
          actor_id: null,
          narrative: expect.stringContaining('Agent status'),
        });
      } finally {
        sqlite.close();
      }
    });

    it('should handle errors gracefully', async () => {
      const badDb: any = {
        prepare: vi.fn(() => {
          throw new Error('DB connection failed');
        }),
      };

      const event: SessionEvent = {
        type: 'terminal_command',
        sessionId: 'test-session',
        candidateId: 'cand-123',
        timestamp: Math.floor(Date.now() / 1000),
        actor: 'guest',
        text: 'ls -la',
      };

      const result = await captureSessionEvent(badDb, event);
      expect(result).toBeNull();
    });
  });

  describe('getSessionContextGraph', () => {
    it('should query candidate_nodes with meeting_session source_type', async () => {
      const mockResults = [
        {
          id: 'node-1',
          node_type: 'session_chat_user',
          narrative_text: '[2025-01-01T00:00:00.000Z] User asked: "Hello"',
          extracted_properties_json: '{"actor":"host"}',
          captured_at: 1735689600,
          source_reference: 'test-session',
          candidate_id: 'cand-123',
          embedding_json: null,
          source_type: 'meeting_session',
          confidence: 1.0,
          supersedes: null,
          superseded_at: null,
          decomposition_version: 'session-v1',
          created_at: 1735689600,
          updated_at: 1735689600,
        },
      ];

      const dbWithResults: any = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            all: vi.fn(async () => ({ results: mockResults })),
          })),
        })),
      };

      const graph = await getSessionContextGraph(dbWithResults, 'cand-123', 'test-session');
      expect(graph).toHaveLength(1);
      expect(graph[0].nodeType).toBe('session_chat_user');
      expect(graph[0].narrativeText).toContain('User asked');
      expect(graph[0].sessionId).toBe('test-session');
      expect(graph[0].properties).toEqual({ actor: 'host' });
    });

    it('should return empty array when no events exist', async () => {
      const graph = await getSessionContextGraph(db, 'cand-123', 'test-session');
      expect(graph).toEqual([]);
    });
  });

  describe('getSessionContextSummary', () => {
    it('should return empty string when no events', async () => {
      const summary = await getSessionContextSummary(db, 'cand-123', 'test-session');
      expect(summary).toBe('');
    });

    it('should format events into categories', async () => {
      const mockResults = [
        {
          id: 'node-1',
          node_type: 'session_chat_user',
          narrative_text: '[2025-01-01T00:00:00.000Z] User asked: "Fix the bug"',
          extracted_properties_json: JSON.stringify({
            source: 'clippy_agent_chat_client_submit',
            promptId: 'workspace-session-1:guest:prompt:1735689600000:clippy_0123abcd',
          }),
          captured_at: 1735689600,
          source_reference: 'test-session',
          candidate_id: 'cand-123',
          embedding_json: null,
          source_type: 'meeting_session',
          confidence: 1.0,
          supersedes: null,
          superseded_at: null,
          decomposition_version: 'session-v1',
          created_at: 1735689600,
          updated_at: 1735689600,
        },
        {
          id: 'node-2',
          node_type: 'session_terminal_command',
          narrative_text: '[2025-01-01T00:01:00.000Z] Terminal command: npm test',
          extracted_properties_json: JSON.stringify({
            source: 'container_terminal',
            terminalCommandId: 'terminal-workspace-1:command:guest:1735689660000:1:term_0123abcd',
          }),
          captured_at: 1735689660,
          source_reference: 'test-session',
          candidate_id: 'cand-123',
          embedding_json: null,
          source_type: 'meeting_session',
          confidence: 1.0,
          supersedes: null,
          superseded_at: null,
          decomposition_version: 'session-v1',
          created_at: 1735689660,
          updated_at: 1735689660,
        },
        {
          id: 'node-3',
          node_type: 'session_chat_agent',
          narrative_text: '[2025-01-01T00:02:00.000Z] Agent responded: "I inspected the failing test."',
          extracted_properties_json: JSON.stringify({
            source: 'clippy_agent_bridge',
            agentChatResponseId: 'agent-chat:devin:1735689720000:CHAT_RESPONSE:agent_314a13fc',
            browserPromptId: 'workspace-session-1:guest:prompt:1735689600000:clippy_0123abcd',
          }),
          captured_at: 1735689720,
          source_reference: 'test-session',
          candidate_id: 'cand-123',
          embedding_json: null,
          source_type: 'meeting_session',
          confidence: 1.0,
          supersedes: null,
          superseded_at: null,
          decomposition_version: 'session-v1',
          created_at: 1735689720,
          updated_at: 1735689720,
        },
      ];

      const dbWithResults: any = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            all: vi.fn(async () => ({ results: mockResults })),
          })),
        })),
      };

      const summary = await getSessionContextSummary(dbWithResults, 'cand-123', 'test-session');
      expect(summary).toContain('Session Context (3 events)');
      expect(summary).toContain('CHAT');
      expect(summary).toContain('User asked');
      expect(summary).toContain('TERMINAL');
      expect(summary).toContain('npm test');
      expect(summary).toContain('[source_ref: node=node-1; type=session_chat_user; session=test-session; capturedAt=2025-01-01T00:00:00.000Z; source=clippy_agent_chat_client_submit; promptId=workspace-session-1:guest:prompt:1735689600000:clippy_0123abcd]');
      expect(summary).toContain('[source_ref: node=node-3; type=session_chat_agent; session=test-session; capturedAt=2025-01-01T00:02:00.000Z; source=clippy_agent_bridge; agentChatResponseId=agent-chat:devin:1735689720000:CHAT_RESPONSE:agent_314a13fc; linkedPromptId=workspace-session-1:guest:prompt:1735689600000:clippy_0123abcd]');
      expect(summary).toContain('[source_ref: node=node-2; type=session_terminal_command; session=test-session; capturedAt=2025-01-01T00:01:00.000Z; source=container_terminal; terminalCommandId=terminal-workspace-1:command:guest:1735689660000:1:term_0123abcd]');
    });
  });

  describe('roomActivitySnapshotToSessionEvents', () => {
    it('converts durable room activity logs into source-backed session events', async () => {
      const events = await roomActivitySnapshotToSessionEvents({
        desktopActivityLog: [
          {
            role: 'HOST',
            recordedAt: 1700000000000,
            event: {
              id: 'evt-enter-95',
              clientId: 'host-client',
              createdAt: 1700000000000,
              kind: 'SET_ROOM_SURFACE',
              surface: 'win95',
              previousSurface: 'standard',
              action: 'enter_desktop',
              source: 'room_surface_control',
              surfaceControlEventSource: 'browser_room_surface_toggle',
              actor: 'host',
              surfaceChangeId: 'surface:host:1700000000000:standard:win95',
              capturedAtMs: 1700000000000,
              roomPhase: 'connected',
              durableObjectReplayExpected: true,
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000001300,
            event: {
              id: 'evt-start-menu-open',
              clientId: 'guest-client',
              createdAt: 1700000001300,
              kind: 'START_MENU_STATE',
              open: true,
              evidence: {
                source: 'win95_start_menu_control',
                menuEventSource: 'win95_start_button',
                actor: 'guest',
                menuId: 'start',
                action: 'open',
                open: true,
                startMenuEventId: 'start-menu:guest:1700000001300:open:win95_start_button',
                capturedAtMs: 1700000001300,
                surface: 'win95',
                roomPhase: 'connected',
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000001350,
            event: {
              id: 'evt-source-less-start-menu',
              clientId: 'guest-client',
              createdAt: 1700000001350,
              kind: 'START_MENU_STATE',
              open: false,
            },
          },
          {
            role: 'HOST',
            recordedAt: 1700000001000,
            event: {
              id: 'evt-source-less-surface',
              clientId: 'host-client',
              createdAt: 1700000000500,
              kind: 'SET_ROOM_SURFACE',
              surface: 'standard',
            },
          },
          {
            role: 'HOST',
            recordedAt: 1700000001000,
            event: {
              id: 'evt-workspace-ready',
              clientId: 'host-client',
              createdAt: 1700000001000,
              kind: 'WORKSPACE_STATE_CHANGED',
              actor: 'host',
              workspaceStateEventId: 'workspace-state:host:1700000001000:launch:workspace-session-1:READY',
              capturedAtMs: 1700000001000,
              status: 'READY',
              workspaceSessionId: 'workspace-session-1',
              repoUrl: 'https://github.com/cloudflare/workers-sdk',
              githubPrNumber: 14435,
              matchedRepoId: 42,
              challengeStatus: 'github_pr_assigned',
              challengeKind: 'github_pr',
              challengeSource: 'scheduled_interview.github_pr_number',
              challengeMessage: null,
              ttlSeconds: 3600,
              ttlSource: 'default',
              expiringSoon: false,
              source: 'browser_workspace_state_observer',
              workspaceEventSource: 'browser_workspace_state_observer',
              workspaceStateSource: 'launch',
              workspaceTelemetryPersisted: true,
              proxyUrlPersisted: false,
            },
          },
          {
            role: 'HOST',
            recordedAt: 1700000001100,
            event: {
              id: 'evt-source-less-workspace',
              clientId: 'host-client',
              createdAt: 1700000001100,
              kind: 'WORKSPACE_STATE_CHANGED',
              actor: 'host',
              status: 'READY',
              workspaceSessionId: 'workspace-session-1',
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000001250,
            event: {
              id: 'evt-browser-navigate',
              clientId: 'guest-client',
              createdAt: 1700000001250,
              kind: 'UPDATE_WINDOW_DATA',
              windowId: 'browser',
              data: {
                currentUrl: 'https://example.com/review?step=1',
              },
              evidence: {
                source: 'room_browser_window',
                navigationSource: 'browser_window_client_submit',
                actor: 'guest',
                windowId: 'browser',
                navigationTrigger: 'go_button',
                browserNavigationId: 'browser-navigation:guest:1700000001250:browser:go_button:nav_54d2c495',
                capturedAtMs: 1700000001250,
                urlFingerprint: 'nav_54d2c495',
                url: 'https://example.com/review?step=1',
                urlHost: 'example.com',
                urlProtocol: 'https',
                urlPath: '/review?step=1',
                knownEmbedBlocked: false,
                surface: 'win95',
                roomPhase: 'connected',
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000001500,
            event: {
              id: 'evt-browser-moved',
              clientId: 'guest-client',
              createdAt: 1700000001500,
              kind: 'UPDATE_WINDOW_STATE',
              windowId: 'browser',
              x: 220,
              y: 140,
              focused: true,
              minimized: false,
              evidence: {
                source: 'window_state_client_submit',
                stateSource: 'win95_taskbar',
                actor: 'guest',
                windowId: 'browser',
                action: 'restore_or_focus',
                windowStateChangeId: 'window-state:guest:1700000001500:browser:restore_or_focus',
                capturedAtMs: 1700000001500,
                surface: 'win95',
                roomPhase: 'connected',
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000002500,
            event: {
              id: 'evt-notepad-data',
              clientId: 'guest-client',
              createdAt: 1700000002500,
              kind: 'UPDATE_WINDOW_DATA',
              windowId: 'notepad',
              data: {
                text: 'Candidate writes a replay test plan.',
              },
              evidence: {
                source: 'window_data_client_submit',
                dataSource: 'win95_window_data_sync',
                actor: 'guest',
                windowId: 'notepad',
                action: 'edit_text',
                windowDataUpdateId: 'window-data:guest:1700000002500:notepad:edit_text',
                capturedAtMs: 1700000002500,
                surface: 'win95',
                roomPhase: 'connected',
                dataKeys: ['text'],
                dataValueFingerprints: { text: 'data_81a94acf' },
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000002600,
            event: {
              id: 'evt-source-less-open',
              clientId: 'guest-client',
              createdAt: 1700000002600,
              kind: 'OPEN_WINDOW',
              window: {
                id: 'source-less-notepad',
                windowType: 'notepad',
                title: 'Source-less Notepad',
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000002700,
            event: {
              id: 'evt-source-less-nav',
              clientId: 'guest-client',
              createdAt: 1700000002700,
              kind: 'UPDATE_WINDOW_DATA',
              windowId: 'browser',
              data: {
                currentUrl: 'https://example.com/source-less',
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000002800,
            event: {
              id: 'evt-source-less-state',
              clientId: 'guest-client',
              createdAt: 1700000002800,
              kind: 'UPDATE_WINDOW_STATE',
              windowId: 'browser',
              x: 300,
              y: 180,
            },
          },
        ],
        chatActivityLog: [
          {
            role: 'GUEST',
            recordedAt: 1700000002000,
            message: {
              id: 'chat-1',
              clientId: 'guest-client',
              createdAt: 1700000002000,
              role: 'GUEST',
              text: 'I found the retry bug in the queue worker.',
              deliveryStatus: 'accepted',
              evidence: {
                source: 'room_chat_client_submit',
                chatEventSource: 'browser_room_chat_window',
                actor: 'guest',
                roomMessageId: 'chat-1',
                clientId: 'guest-client',
                messageCreatedAt: 1700000002000,
                messageLength: 'I found the retry bug in the queue worker.'.length,
                deliveryStatus: 'accepted',
                surface: 'win95',
                roomPhase: 'connected',
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000002050,
            message: {
              id: 'chat-forged-source',
              clientId: 'guest-client',
              createdAt: 1700000002050,
              role: 'GUEST',
              text: 'This source-less chat claim should not become graph evidence.',
              deliveryStatus: 'accepted',
              evidence: {
                source: 'room_chat_claim',
                chatEventSource: 'manual_test_payload',
                actor: 'guest',
                roomMessageId: 'chat-forged-source',
                clientId: 'guest-client',
                messageCreatedAt: 1700000002050,
                messageLength: 'This source-less chat claim should not become graph evidence.'.length,
                deliveryStatus: 'accepted',
                surface: 'win95',
                roomPhase: 'connected',
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000002100,
            message: {
              id: 'chat-forged-length',
              clientId: 'guest-client',
              createdAt: 1700000002100,
              role: 'GUEST',
              text: 'This chat has a forged message length.',
              deliveryStatus: 'accepted',
              evidence: {
                source: 'room_chat_client_submit',
                chatEventSource: 'browser_room_chat_window',
                actor: 'guest',
                roomMessageId: 'chat-forged-length',
                clientId: 'guest-client',
                messageCreatedAt: 1700000002100,
                messageLength: 1,
                deliveryStatus: 'accepted',
                surface: 'win95',
                roomPhase: 'connected',
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000002150,
            message: {
              id: 'chat-forged-actor',
              clientId: 'guest-client',
              createdAt: 1700000002150,
              role: 'GUEST',
              text: 'This chat has a forged actor.',
              deliveryStatus: 'accepted',
              evidence: {
                source: 'room_chat_client_submit',
                chatEventSource: 'browser_room_chat_window',
                actor: 'host',
                roomMessageId: 'chat-forged-actor',
                clientId: 'guest-client',
                messageCreatedAt: 1700000002150,
                messageLength: 'This chat has a forged actor.'.length,
                deliveryStatus: 'accepted',
                surface: 'win95',
                roomPhase: 'connected',
                durableObjectReplayExpected: true,
              },
            },
          },
        ],
        mediaControlActivityLog: [
          {
            role: 'GUEST',
            recordedAt: 1700000002300,
            event: {
              id: 'media-mic-off',
              clientId: 'guest-client',
              createdAt: 1700000002300,
              role: 'GUEST',
              control: 'microphone',
              previousEnabled: true,
              enabled: false,
              evidence: {
                source: 'video_room_media_controls',
                mediaControlEventSource: 'browser_video_control_button',
                actor: 'guest',
                mediaControlId: 'media:guest:microphone:1700000002300:disabled',
                capturedAtMs: 1700000002300,
                control: 'microphone',
                previousEnabled: true,
                enabled: false,
                action: 'disabled',
                surface: 'win95',
                roomPhase: 'connected',
                controlSurface: 'win95_video_window',
                controlAction: 'toggle',
                mediaSource: 'local_media_stream',
                rawMediaStreamPersisted: false,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000002350,
            event: {
              id: 'media-source-less',
              clientId: 'guest-client',
              createdAt: 1700000002350,
              role: 'GUEST',
              control: 'camera',
              previousEnabled: true,
              enabled: false,
            },
          },
        ],
        cursorActivityLog: [
          {
            role: 'GUEST',
            recordedAt: 1700000002400,
            cursor: {
              clientId: 'guest-client',
              role: 'GUEST',
              x: 0.42,
              y: 0.61,
              updatedAt: 1700000002400,
              evidence: {
                source: 'win95_cursor_presence_client_sample',
                cursorEventSource: 'browser_win95_desktop_pointermove',
                actor: 'guest',
                cursorSampleId: 'cursor:guest:1700000002400:420:610',
                sampledAtMs: 1700000002400,
                surface: 'win95',
                roomPhase: 'connected',
                normalizedX: 0.42,
                normalizedY: 0.61,
                previousNormalizedX: null,
                previousNormalizedY: null,
                distanceFromPrevious: null,
                evidenceSampling: 'presence_sample',
                sampleIntervalMs: 15000,
                movementThreshold: 0.03,
                rawCursorMovesPersisted: false,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000002450,
            cursor: {
              clientId: 'guest-client',
              role: 'GUEST',
              x: 0.42,
              y: 0.61,
              updatedAt: 1700000002400,
            },
          },
        ],
        clippyPromptActivityLog: [
          {
            role: 'HOST',
            recordedAt: 1700000003000,
            prompt: {
              id: 'prompt-open-workspace',
              clientId: 'host-client',
              createdAt: 1700000003000,
              source: 'system',
              promptEventSource: 'browser_proactive_clippy_prompt',
              promptTrigger: 'host_waiting_prepare_workspace',
              surface: 'win95',
              roomPhase: 'connected',
              workspaceStatus: 'READY',
              workspaceSessionId: 'workspace-session-1',
              agentResponseClaimed: false,
              text: 'Would you like to open the workspace?',
              actions: [{ id: 'open-workspace', label: 'Open workspace' }],
            },
          },
          {
            role: 'HOST',
            recordedAt: 1700000003100,
            prompt: {
              id: 'prompt-source-less',
              clientId: 'host-client',
              createdAt: 1700000003100,
              source: 'system',
              promptTrigger: 'missing_prompt_event_source',
              surface: 'win95',
              roomPhase: 'connected',
              agentResponseClaimed: false,
              text: 'This prompt should not become graph evidence.',
            },
          },
        ],
        clippyInteractionActivityLog: [
          {
            role: 'GUEST',
            recordedAt: 1700000003200,
            event: {
              id: 'clippy-agent-action-valid',
              clientId: 'guest-client',
              createdAt: 1700000003200,
              eventType: 'clippy_action',
              actor: 'agent',
              text: 'devin suggested room action: open-terminal',
              evidence: {
                source: 'clippy_agent_bridge',
                origin: 'agent',
                executionStatus: 'suggested',
                actionId: 'open-terminal',
                actionSource: 'agent_stdout',
                actionProtocol: 'clippy_room_action_tag',
                bridgeEventType: 'ROOM_ACTION',
                agent: 'devin',
                observedAt: '2026-06-27T21:10:00.000Z',
                capturedAtMs: 1700000003200,
                clippyActionEventId: 'clippy-action:agent:1700000003200:clippy_agent_bridge:agent:suggested:open-terminal',
                bridgePersisted: true,
                browserPromptId: 'workspace-session-1:guest:prompt:1700000003210:clippy_0123abcd',
                browserPromptFingerprint: 'clippy_0123abcd',
                browserPromptTimestamp: 1700000003210,
                browserPromptLength: 'Can you inspect the failing test?'.length,
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000003205,
            event: {
              id: 'clippy-agent-action-malformed-prompt-ref',
              clientId: 'guest-client',
              createdAt: 1700000003205,
              eventType: 'clippy_action',
              actor: 'agent',
              text: 'devin suggested room action: open-terminal',
              evidence: {
                source: 'clippy_agent_bridge',
                origin: 'agent',
                executionStatus: 'suggested',
                actionId: 'open-terminal',
                actionSource: 'agent_stdout',
                actionProtocol: 'clippy_room_action_tag',
                bridgeEventType: 'ROOM_ACTION',
                agent: 'devin',
                observedAt: '2026-06-27T21:10:00.000Z',
                capturedAtMs: 1700000003205,
                clippyActionEventId: 'clippy-action:agent:1700000003205:clippy_agent_bridge:agent:suggested:open-terminal',
                bridgePersisted: true,
                browserPromptId: 'malformed-prompt-ref',
                browserPromptFingerprint: 'clippy_0123abcd',
                browserPromptTimestamp: 1700000003210,
                browserPromptLength: 'Can you inspect the failing test?'.length,
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000003210,
            event: {
              id: 'clippy-user-chat-valid',
              clientId: 'guest-client',
              createdAt: 1700000003210,
              eventType: 'ai_chat_user',
              actor: 'guest',
              text: 'Can you inspect the failing test?',
              evidence: {
                source: 'clippy_agent_chat_client_submit',
                agentChatEventSource: 'browser_clippy_chat_window',
                bridgeMessageType: 'CHAT',
                bridgeProtocol: 'clippy_dev_container_ws',
                promptId: 'workspace-session-1:guest:prompt:1700000003210:clippy_0123abcd',
                promptFingerprint: 'clippy_0123abcd',
                promptLength: 'Can you inspect the failing test?'.length,
                promptTimestamp: 1700000003210,
                browserQueuedBridgeMessage: true,
                bridgeDeliveryConfirmed: false,
                agent: null,
                surface: 'win95',
                roomPhase: 'connected',
                workspaceStatus: 'READY',
                workspaceSessionId: 'workspace-session-1',
                repoUrl: 'https://github.com/cloudflare/workers-sdk',
                agentResponseClaimed: false,
                actor: 'guest',
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000003215,
            event: {
              id: 'clippy-delivered-user-chat',
              clientId: 'guest-client',
              createdAt: 1700000003215,
              eventType: 'ai_chat_user',
              actor: 'guest',
              text: 'Can you inspect the failing test?',
              evidence: {
                source: 'clippy_agent_chat_client_submit',
                agentChatEventSource: 'browser_clippy_chat_window',
                bridgeMessageType: 'CHAT',
                bridgeProtocol: 'clippy_dev_container_ws',
                promptId: 'workspace-session-1:guest:prompt:1700000003215:clippy_0123abcd',
                promptFingerprint: 'clippy_0123abcd',
                promptLength: 'Can you inspect the failing test?'.length,
                promptTimestamp: 1700000003215,
                deliveredToAgentBridge: true,
                agent: null,
                surface: 'win95',
                roomPhase: 'connected',
                workspaceStatus: 'READY',
                workspaceSessionId: 'workspace-session-1',
                repoUrl: 'https://github.com/cloudflare/workers-sdk',
                agentResponseClaimed: false,
                actor: 'guest',
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000003218,
            event: {
              id: 'clippy-attributed-user-chat',
              clientId: 'guest-client',
              createdAt: 1700000003218,
              eventType: 'ai_chat_user',
              actor: 'guest',
              text: 'Can you inspect the failing test?',
              evidence: {
                source: 'clippy_agent_chat_client_submit',
                agentChatEventSource: 'browser_clippy_chat_window',
                bridgeMessageType: 'CHAT',
                bridgeProtocol: 'clippy_dev_container_ws',
                promptId: 'workspace-session-1:guest:prompt:1700000003218:clippy_0123abcd',
                promptFingerprint: 'clippy_0123abcd',
                promptLength: 'Can you inspect the failing test?'.length,
                promptTimestamp: 1700000003218,
                browserQueuedBridgeMessage: true,
                bridgeDeliveryConfirmed: false,
                agent: 'devin',
                surface: 'win95',
                roomPhase: 'connected',
                workspaceStatus: 'READY',
                workspaceSessionId: 'workspace-session-1',
                repoUrl: 'https://github.com/cloudflare/workers-sdk',
                agentResponseClaimed: false,
                actor: 'guest',
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000003220,
            event: {
              id: 'clippy-agent-action-legacy-protocol',
              clientId: 'guest-client',
              createdAt: 1700000003220,
              eventType: 'clippy_action',
              actor: 'agent',
              text: 'devin suggested room action: open-terminal',
              evidence: {
                source: 'clippy_agent_bridge',
                origin: 'agent',
                executionStatus: 'suggested',
                actionId: 'open-terminal',
                actionSource: 'agent_stdout',
                actionProtocol: 'bridge_actions_field',
                bridgeEventType: 'ROOM_ACTION',
                agent: 'devin',
                observedAt: '2026-06-27T21:10:00.000Z',
                capturedAtMs: 1700000003220,
                clippyActionEventId: 'clippy-action:agent:1700000003220:clippy_agent_bridge:agent:suggested:open-terminal',
                bridgePersisted: true,
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'HOST',
            recordedAt: 1700000003300,
            event: {
              id: 'clippy-attributed-ui-action',
              clientId: 'host-client',
              createdAt: 1700000003300,
              eventType: 'clippy_action',
              actor: 'host',
              text: 'Clippy action: start recording',
              evidence: {
                source: 'clippy_prompt_ui',
                actionId: 'start-recording',
                origin: 'prompt',
                executedBy: 'host',
                actionSource: 'clippy_prompt_ui',
                executionStatus: 'executed',
                capturedAtMs: 1700000003300,
                clippyActionEventId: 'clippy-action:host:1700000003300:clippy_prompt_ui:prompt:executed:start-recording',
                agent: 'devin',
                agentResponseClaimed: false,
                surface: 'win95',
                roomPhase: 'connected',
                workspaceStatus: 'READY',
                workspaceSessionId: 'workspace-session-1',
                durableObjectReplayExpected: true,
              },
            },
          },
        ],
        fileSystemActivityLog: [
          {
            role: 'GUEST',
            recordedAt: 1700000004000,
            event: {
              id: 'fs-notes-save',
              clientId: 'guest-client',
              createdAt: 1700000004000,
              kind: 'UPSERT_FILE',
              file: {
                id: 'notepad',
                name: 'notes.txt',
                kind: 'text',
                content: 'Candidate identified retry bug evidence.',
                mimeType: 'text/plain',
                createdAt: 1700000004000,
                updatedAt: 1700000004000,
              },
              evidence: {
                source: 'win95_shared_file_system',
                fileEventSource: 'browser_client_submit',
                fileChangeId: 'file:guest:1700000004000:upsert:notepad',
                actor: 'guest',
                operation: 'upsert',
                fileId: 'notepad',
                fileName: 'notes.txt',
                fileKind: 'text',
                surface: 'win95',
                roomPhase: 'connected',
                capturedAtMs: 1700000004000,
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000005000,
            event: {
              id: 'fs-notes-delete',
              clientId: 'guest-client',
              createdAt: 1700000005000,
              kind: 'DELETE_FILE',
              fileId: 'notepad',
              file: {
                id: 'notepad',
                name: 'notes.txt',
                kind: 'text',
                content: 'Candidate identified retry bug evidence.',
                mimeType: 'text/plain',
                createdAt: 1700000004000,
                updatedAt: 1700000004000,
              },
              evidence: {
                source: 'win95_shared_file_system',
                fileEventSource: 'browser_client_submit',
                fileChangeId: 'file:guest:1700000005000:delete:notepad',
                actor: 'guest',
                operation: 'delete',
                fileId: 'notepad',
                fileName: 'notes.txt',
                fileKind: 'text',
                surface: 'win95',
                roomPhase: 'connected',
                capturedAtMs: 1700000005000,
                durableObjectReplayExpected: true,
              },
            },
          },
          {
            role: 'GUEST',
            recordedAt: 1700000006000,
            event: {
              id: 'fs-source-less-save',
              clientId: 'guest-client',
              createdAt: 1700000006000,
              kind: 'UPSERT_FILE',
              file: {
                id: 'source-less-notes',
                name: 'source-less-notes.txt',
                kind: 'text',
                content: 'This should not become graph evidence.',
                mimeType: 'text/plain',
                createdAt: 1700000006000,
                updatedAt: 1700000006000,
              },
            },
          },
        ],
      }, {
        candidateId: 'cand-room',
        sessionId: 'meeting--room-sync',
      });

      expect(events).toEqual([
        expect.objectContaining({
          type: 'room_surface_change',
          actor: 'host',
          text: 'Room surface changed to win95',
          candidateId: 'cand-room',
          sessionId: 'meeting--room-sync',
          timestamp: 1700000000,
          properties: expect.objectContaining({
            source: 'room_surface_control',
            surfaceControlEventSource: 'browser_room_surface_toggle',
            surfaceChangeId: 'surface:host:1700000000000:standard:win95',
            surface: 'win95',
            previousSurface: 'standard',
            action: 'enter_desktop',
            roomPhase: 'connected',
            durableObjectReplayExpected: true,
          }),
        }),
        expect.objectContaining({
          type: 'browser_navigation',
          actor: 'guest',
          text: 'https://example.com/review?step=1',
          properties: expect.objectContaining({
            roomActivitySource: 'durable_object',
            source: 'room_browser_window',
            navigationSource: 'browser_window_client_submit',
            navigationTrigger: 'go_button',
            browserNavigationId: 'browser-navigation:guest:1700000001250:browser:go_button:nav_54d2c495',
            capturedAtMs: 1700000001250,
            urlFingerprint: 'nav_54d2c495',
            urlHost: 'example.com',
            urlProtocol: 'https',
            surface: 'win95',
            roomPhase: 'connected',
          }),
        }),
        expect.objectContaining({
          type: 'desktop_menu_toggle',
          actor: 'guest',
          text: 'Start menu opened',
          candidateId: 'cand-room',
          sessionId: 'meeting--room-sync',
          timestamp: 1700000001,
          properties: expect.objectContaining({
            roomActivitySource: 'durable_object',
            roomActivityKind: 'desktop',
            source: 'win95_start_menu_control',
            menuEventSource: 'win95_start_button',
            actor: 'guest',
            menuId: 'start',
            action: 'open',
            open: true,
            startMenuEventId: 'start-menu:guest:1700000001300:open:win95_start_button',
            capturedAtMs: 1700000001300,
            surface: 'win95',
            roomPhase: 'connected',
            durableObjectReplayExpected: true,
          }),
        }),
        expect.objectContaining({
          type: 'window_update',
          actor: 'guest',
          text: 'Window state updated: browser',
        }),
        expect.objectContaining({
          type: 'workspace_state',
          actor: 'host',
          text: 'Workspace state changed to READY',
          properties: expect.objectContaining({
            workspaceStatus: 'READY',
            actor: 'host',
            workspaceStateEventId: 'workspace-state:host:1700000001000:launch:workspace-session-1:READY',
            capturedAtMs: 1700000001000,
            workspaceSessionId: 'workspace-session-1',
            repoUrl: 'https://github.com/cloudflare/workers-sdk',
            githubPrNumber: 14435,
            matchedRepoId: 42,
            challengeStatus: 'github_pr_assigned',
            challengeKind: 'github_pr',
            challengeSource: 'scheduled_interview.github_pr_number',
            ttlSeconds: 3600,
            ttlSource: 'default',
            expiringSoon: false,
            source: 'browser_workspace_state_observer',
            workspaceEventSource: 'browser_workspace_state_observer',
            workspaceStateSource: 'launch',
            workspaceTelemetryPersisted: true,
            proxyUrlPersisted: false,
          }),
        }),
        expect.objectContaining({
          type: 'chat_message',
          actor: 'guest',
          text: 'I found the retry bug in the queue worker.',
          properties: expect.objectContaining({
            roomActivitySource: 'durable_object',
            source: 'room_chat_client_submit',
            chatEventSource: 'browser_room_chat_window',
            actor: 'guest',
            roomMessageId: 'chat-1',
            clientId: 'guest-client',
            messageCreatedAt: 1700000002000,
            messageLength: 'I found the retry bug in the queue worker.'.length,
            deliveryStatus: 'accepted',
            surface: 'win95',
            roomPhase: 'connected',
            durableObjectReplayExpected: true,
          }),
        }),
        expect.objectContaining({
          type: 'cursor_presence',
          actor: 'guest',
          text: 'Guest cursor presence sampled on 95 Until Infinity desktop',
          properties: expect.objectContaining({
            roomActivitySource: 'durable_object',
            roomActivityKind: 'cursor_presence',
            source: 'win95_cursor_presence_client_sample',
            cursorEventSource: 'browser_win95_desktop_pointermove',
            actor: 'guest',
            cursorSampleId: 'cursor:guest:1700000002400:420:610',
            sampledAtMs: 1700000002400,
            surface: 'win95',
            roomPhase: 'connected',
            normalizedX: 0.42,
            normalizedY: 0.61,
            previousNormalizedX: null,
            previousNormalizedY: null,
            distanceFromPrevious: null,
            evidenceSampling: 'presence_sample',
            sampleIntervalMs: 15000,
            movementThreshold: 0.03,
            rawCursorMovesPersisted: false,
            clientId: 'guest-client',
          }),
        }),
        expect.objectContaining({
          type: 'media_control',
          actor: 'guest',
          text: 'Guest turned microphone off',
          properties: expect.objectContaining({
            roomActivitySource: 'durable_object',
            roomActivityKind: 'media_control',
            source: 'video_room_media_controls',
            mediaControlEventSource: 'browser_video_control_button',
            mediaControlId: 'media:guest:microphone:1700000002300:disabled',
            actor: 'guest',
            control: 'microphone',
            previousEnabled: true,
            enabled: false,
            action: 'disabled',
            surface: 'win95',
            roomPhase: 'connected',
            controlSurface: 'win95_video_window',
            controlAction: 'toggle',
            mediaSource: 'local_media_stream',
            rawMediaStreamPersisted: false,
            roomEventId: 'media-mic-off',
            clientId: 'guest-client',
          }),
        }),
        expect.objectContaining({
          type: 'window_update',
          actor: 'guest',
          text: 'Window data updated: notepad',
          properties: expect.objectContaining({
            roomActivitySource: 'durable_object',
            source: 'window_data_client_submit',
            dataSource: 'win95_window_data_sync',
            action: 'edit_text',
            windowDataUpdateId: 'window-data:guest:1700000002500:notepad:edit_text',
            capturedAtMs: 1700000002500,
            dataKeys: ['text'],
            dataValueFingerprints: { text: 'data_81a94acf' },
          }),
        }),
        expect.objectContaining({
          type: 'ai_chat_user',
          actor: 'guest',
          text: 'Can you inspect the failing test?',
          properties: expect.objectContaining({
            roomActivitySource: 'durable_object',
            roomActivityKind: 'clippy_interaction',
            source: 'clippy_agent_chat_client_submit',
            agentChatEventSource: 'browser_clippy_chat_window',
            bridgeMessageType: 'CHAT',
            bridgeProtocol: 'clippy_dev_container_ws',
            promptId: 'workspace-session-1:guest:prompt:1700000003210:clippy_0123abcd',
            browserQueuedBridgeMessage: true,
            bridgeDeliveryConfirmed: false,
            agent: null,
            roomEventId: 'clippy-user-chat-valid',
            workspaceSessionId: 'workspace-session-1',
          }),
        }),
        expect.objectContaining({
          type: 'clippy_action',
          actor: 'agent',
          text: 'devin suggested room action: open-terminal',
          properties: expect.objectContaining({
            roomActivitySource: 'durable_object',
            source: 'clippy_agent_bridge',
            origin: 'agent',
            executionStatus: 'suggested',
            actionId: 'open-terminal',
            actionSource: 'agent_stdout',
            actionProtocol: 'clippy_room_action_tag',
            bridgeEventType: 'ROOM_ACTION',
            agent: 'devin',
            clippyActionEventId: 'clippy-action:agent:1700000003200:clippy_agent_bridge:agent:suggested:open-terminal',
            bridgePersisted: true,
            browserPromptId: 'workspace-session-1:guest:prompt:1700000003210:clippy_0123abcd',
            browserPromptFingerprint: 'clippy_0123abcd',
            browserPromptTimestamp: 1700000003210,
            browserPromptLength: 'Can you inspect the failing test?'.length,
          }),
        }),
        expect.objectContaining({
          type: 'clippy_prompt',
          actor: 'host',
          text: 'Would you like to open the workspace?',
          properties: expect.objectContaining({
            source: 'clippy_prompt_client_submit',
            promptEventSource: 'browser_proactive_clippy_prompt',
            promptTrigger: 'host_waiting_prepare_workspace',
            surface: 'win95',
            roomPhase: 'connected',
            workspaceStatus: 'READY',
            workspaceSessionId: 'workspace-session-1',
            agentResponseClaimed: false,
            promptCreatedAt: 1700000003000,
            promptLength: 'Would you like to open the workspace?'.length,
          }),
        }),
        expect.objectContaining({
          type: 'file_change',
          actor: 'guest',
          text: 'notes.txt',
        }),
        expect.objectContaining({
          type: 'file_change',
          actor: 'guest',
          text: 'notes.txt',
        }),
      ]);
      const restoredWindowEvent = events.find((event) => (
        event.type === 'window_update'
        && event.properties?.windowStateChangeId === 'window-state:guest:1700000001500:browser:restore_or_focus'
      ));
      expect(restoredWindowEvent?.properties).toMatchObject({
        roomActivitySource: 'durable_object',
        source: 'window_state_client_submit',
        stateSource: 'win95_taskbar',
        actor: 'guest',
        windowId: 'browser',
        action: 'restore_or_focus',
        windowStateChangeId: 'window-state:guest:1700000001500:browser:restore_or_focus',
        capturedAtMs: 1700000001500,
        surface: 'win95',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
        stateKeys: ['focused', 'minimized', 'x', 'y'],
        statePatch: {
          focused: true,
          minimized: false,
          x: 220,
          y: 140,
        },
      });
      const upsertFileEvent = events.find((event) => (
        event.type === 'file_change'
        && event.actor === 'guest'
        && event.properties?.fileChangeId === 'file:guest:1700000004000:upsert:notepad'
      ));
      expect(upsertFileEvent?.properties).toMatchObject({
        roomActivitySource: 'durable_object',
        source: 'win95_shared_file_system',
        fileEventSource: 'browser_client_submit',
        fileChangeId: 'file:guest:1700000004000:upsert:notepad',
        actor: 'guest',
        operation: 'upsert',
        fileId: 'notepad',
        fileName: 'notes.txt',
        fileKind: 'text',
        surface: 'win95',
        roomPhase: 'connected',
        capturedAtMs: 1700000004000,
        durableObjectReplayExpected: true,
        contentPreview: 'Candidate identified retry bug evidence.',
      });
      expect(upsertFileEvent?.properties?.contentHash).toMatch(/^content_[a-f0-9]{32}$/);
      const deleteFileEvent = events.find((event) => (
        event.type === 'file_change'
        && event.actor === 'guest'
        && event.properties?.fileChangeId === 'file:guest:1700000005000:delete:notepad'
      ));
      expect(deleteFileEvent?.properties).toMatchObject({
        roomActivitySource: 'durable_object',
        source: 'win95_shared_file_system',
        fileEventSource: 'browser_client_submit',
        fileChangeId: 'file:guest:1700000005000:delete:notepad',
        actor: 'guest',
        operation: 'delete',
        fileId: 'notepad',
        fileName: 'notes.txt',
        fileKind: 'text',
        surface: 'win95',
        roomPhase: 'connected',
        capturedAtMs: 1700000005000,
        durableObjectReplayExpected: true,
        deletedContentLength: 'Candidate identified retry bug evidence.'.length,
        deletedContentPreview: 'Candidate identified retry bug evidence.',
      });
      expect(deleteFileEvent?.properties?.deletedContentHash).toMatch(/^content_[a-f0-9]{32}$/);
      expect(events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'clippy_action',
          actor: 'host',
          properties: expect.objectContaining({
            roomEventId: 'clippy-attributed-ui-action',
            source: 'clippy_prompt_ui',
            agent: 'devin',
          }),
        }),
      ]));
      expect(events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'ai_chat_user',
          actor: 'guest',
          properties: expect.objectContaining({
            roomEventId: 'clippy-delivered-user-chat',
            source: 'clippy_agent_chat_client_submit',
            deliveredToAgentBridge: true,
          }),
        }),
      ]));
      expect(events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'ai_chat_user',
          actor: 'guest',
          properties: expect.objectContaining({
            roomEventId: 'clippy-attributed-user-chat',
            source: 'clippy_agent_chat_client_submit',
            agent: 'devin',
          }),
        }),
      ]));
      expect(events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'file_change',
          text: 'source-less-notes.txt',
          properties: expect.objectContaining({
            source: 'file_system_durable_object',
          }),
        }),
      ]));
      for (const fallbackSource of [
        'room_surface_durable_object',
        'start_menu_durable_object',
        'window_lifecycle_durable_object',
        'browser_navigation_durable_object',
        'window_data_durable_object',
        'window_state_durable_object',
      ]) {
        expect(events).not.toEqual(expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              source: fallbackSource,
            }),
          }),
        ]));
      }
    });

    it('converts source-backed recording room state into session evidence', async () => {
      const events = await roomActivitySnapshotToSessionEvents({
        recordingActivityLog: [
          {
            role: 'HOST',
            recordedAt: 1700000000500,
            event: {
              id: 'recording-state-1',
              clientId: 'host-client',
              createdAt: 1700000000500,
              role: 'HOST',
              lifecycleKind: 'start',
              status: 'recording',
              active: true,
              evidence: {
                source: 'video_room_recording',
                recordingEventSource: 'browser_media_recorder',
                recordingStateEventSource: 'browser_media_recorder_state_sync',
                actor: 'host',
                recordingLifecycleKind: 'start',
                recordingStateEventId: 'recording:host:1700000000500:start:recording',
                capturedAtMs: 1700000000500,
                surface: 'win95',
                roomPhase: 'connected',
                recordingStatus: 'recording',
                recordingActive: true,
                durableObjectReplayExpected: true,
                iceProvider: 'cloudflare',
                hasTranscriptionAudio: true,
                speakerMetadataVersion: 1,
                speakerChannelLayout: 'host-local-guest-remote-v1',
                speakerChannelCount: 2,
                speakerChannels: [
                  { channel: 0, role: 'host', source: 'local' },
                  { channel: 1, role: 'guest', source: 'remote' },
                ],
              },
            },
          },
          {
            role: 'HOST',
            recordedAt: 1700000000600,
            event: {
              id: 'recording-source-less',
              clientId: 'host-client',
              createdAt: 1700000000600,
              role: 'HOST',
              lifecycleKind: 'stop',
              status: 'uploading',
              active: false,
            },
          },
        ],
      }, {
        candidateId: 'cand-room',
        sessionId: 'meeting--room-sync',
      });

      expect(events).toEqual([
        expect.objectContaining({
          type: 'recording_start',
          actor: 'host',
          text: 'Recording started',
          candidateId: 'cand-room',
          sessionId: 'meeting--room-sync',
          timestamp: 1700000000,
          properties: expect.objectContaining({
            roomActivitySource: 'durable_object',
            roomActivityKind: 'recording_state',
            source: 'video_room_recording',
            recordingEventSource: 'browser_media_recorder',
            recordingStateEventSource: 'browser_media_recorder_state_sync',
            recordingStateEventId: 'recording:host:1700000000500:start:recording',
            recordingStatus: 'recording',
            recordingActive: true,
            roomEventId: 'recording-state-1',
            clientId: 'host-client',
          }),
        }),
      ]);
    });
  });

  describe('resolveCandidateIdForRoom', () => {
    it('should return null when room token is invalid', async () => {
      const result = await resolveCandidateIdForRoom(db, 'invalid-token');
      expect(result).toBeNull();
    });

    it('should resolve candidate_id through the room → meeting → interview chain', async () => {
      const dbWithChain: any = {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn((...args: any[]) => ({
            first: vi.fn(async () => {
              if (sql.includes('meeting_room_tokens')) {
                return {
                  session_id: 'meeting--123',
                  meeting_id: 'meeting-123',
                  scheduled_interview_id: 'interview-123',
                };
              }
              if (sql.includes('scheduled_interviews')) {
                return { candidate_id: 'cand-456' };
              }
              return null;
            }),
          })),
        })),
      };

      const result = await resolveCandidateIdForRoom(dbWithChain, 'valid-token');
      expect(result).not.toBeNull();
      expect(result!.candidateId).toBe('cand-456');
      expect(result!.sessionId).toBe('meeting--123');
      expect(result!.meetingId).toBe('meeting-123');
    });
  });
});
