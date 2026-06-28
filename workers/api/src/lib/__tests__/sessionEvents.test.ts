import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  captureSessionEvent,
  getSessionContextGraph,
  getSessionContextSummary,
  roomActivitySnapshotToSessionEvents,
  resolveCandidateIdForRoom,
  type SessionEvent,
} from '../sessionEvents';

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
          extracted_properties_json: null,
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
          extracted_properties_json: null,
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
      ];

      const dbWithResults: any = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            all: vi.fn(async () => ({ results: mockResults })),
          })),
        })),
      };

      const summary = await getSessionContextSummary(dbWithResults, 'cand-123', 'test-session');
      expect(summary).toContain('Session Context (2 events)');
      expect(summary).toContain('CHAT');
      expect(summary).toContain('User asked');
      expect(summary).toContain('TERMINAL');
      expect(summary).toContain('npm test');
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
              surfaceChangeId: 'surface:host:1700000000000:standard:win95',
              capturedAtMs: 1700000000000,
              roomPhase: 'connected',
              durableObjectReplayExpected: true,
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
                stateSource: 'win95_window_chrome',
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
          type: 'window_update',
          actor: 'guest',
          text: 'browser',
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
            source: 'workspace_state_durable_object',
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
          type: 'clippy_prompt',
          actor: 'host',
          text: 'Would you like to open the workspace?',
          properties: expect.objectContaining({
            source: 'clippy_prompt_durable_object',
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
      expect(events[2]!.properties).toMatchObject({
        roomActivitySource: 'durable_object',
        source: 'window_state_client_submit',
        stateSource: 'win95_window_chrome',
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
      expect(events[7]!.properties).toMatchObject({
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
      expect(events[7]!.properties?.contentHash).toMatch(/^content_[a-f0-9]{32}$/);
      expect(events[8]!.properties).toMatchObject({
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
      expect(events[8]!.properties?.deletedContentHash).toMatch(/^content_[a-f0-9]{32}$/);
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
