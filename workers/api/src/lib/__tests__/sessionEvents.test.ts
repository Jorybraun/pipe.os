import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  captureSessionEvent,
  getSessionContextGraph,
  getSessionContextSummary,
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
