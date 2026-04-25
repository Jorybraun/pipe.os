/**
 * Unified Agent Runtime — Session Store
 *
 * Abstraction + implementations for session persistence.
 */

import type {
  AgentSession,
  AgentTurn,
  AgentType,
  SessionStore,
  AgentTranscript,
  ScoreReport,
  EvalGateResult,
} from './types';

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ─── In-Memory Store (for tests / local dev) ─────────────────────────────────

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, AgentSession>();

  async createSession(
    agentType: AgentType,
    challengeId: string | undefined,
    candidateId: string | undefined,
  ): Promise<AgentSession> {
    const session: AgentSession = {
      id: generateId(),
      agentType,
      challengeId,
      candidateId,
      state: 'consent',
      consentAt: undefined,
      transcript: { turns: [], scratchpad: {} },
      scoreReport: undefined,
      evalResults: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(sessionId: string): Promise<AgentSession | null> {
    const s = this.sessions.get(sessionId);
    return s ? { ...s, transcript: { ...s.transcript, turns: [...s.transcript.turns] } } : null;
  }

  async getSessionByToken(token: string): Promise<AgentSession | null> {
    return this.getSession(token);
  }

  async updateSession(
    sessionId: string,
    patch: Partial<AgentSession>,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);

    const updated: AgentSession = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: now(),
    };
    this.sessions.set(sessionId, updated);
    return { ...updated, transcript: { ...updated.transcript, turns: [...updated.transcript.turns] } };
  }

  async appendTurn(sessionId: string, turn: AgentTurn): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);

    const updated: AgentSession = {
      ...existing,
      transcript: {
        ...existing.transcript,
        turns: [...existing.transcript.turns, turn],
      },
      updatedAt: now(),
    };
    this.sessions.set(sessionId, updated);
    return { ...updated, transcript: { ...updated.transcript, turns: [...updated.transcript.turns] } };
  }

  clear(): void {
    this.sessions.clear();
  }
}

// ─── D1 Store (production) ───────────────────────────────────────────────────

export interface D1SessionStoreOptions {
  db: D1Database;
  tableName?: string;
}

export class D1SessionStore implements SessionStore {
  private db: D1Database;
  private tableName: string;

  constructor(options: D1SessionStoreOptions) {
    this.db = options.db;
    this.tableName = options.tableName ?? 'agent_sessions';
  }

  async createSession(
    agentType: AgentType,
    challengeId: string | undefined,
    candidateId: string | undefined,
  ): Promise<AgentSession> {
    const id = generateId();
    const ts = now();
    const session: AgentSession = {
      id,
      agentType,
      challengeId,
      candidateId,
      state: 'consent',
      consentAt: undefined,
      transcript: { turns: [], scratchpad: {} },
      scoreReport: undefined,
      evalResults: [],
      createdAt: ts,
      updatedAt: ts,
    };

    await this.db
      .prepare(
        `INSERT INTO ${this.tableName}
         (id, agent_type, challenge_id, candidate_id, state, transcript, eval_results, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        session.id,
        session.agentType,
        session.challengeId ?? null,
        session.candidateId ?? null,
        session.state,
        JSON.stringify(session.transcript),
        JSON.stringify(session.evalResults),
        session.createdAt,
        session.updatedAt,
      )
      .run();

    return session;
  }

  async getSession(sessionId: string): Promise<AgentSession | null> {
    const row = await this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`)
      .bind(sessionId)
      .first<{
        id: string;
        agent_type: string;
        challenge_id: string | null;
        candidate_id: string | null;
        state: string;
        consent_at: string | null;
        transcript: string;
        score_report: string | null;
        eval_results: string;
        created_at: string;
        updated_at: string;
      }>();

    if (!row) return null;
    return this.rowToSession(row);
  }

  async getSessionByToken(token: string): Promise<AgentSession | null> {
    return this.getSession(token);
  }

  async updateSession(
    sessionId: string,
    patch: Partial<AgentSession>,
  ): Promise<AgentSession> {
    const existing = await this.getSession(sessionId);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);

    const updated: AgentSession = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: now(),
    };

    await this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET state = ?, transcript = ?, score_report = ?, eval_results = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        updated.state,
        JSON.stringify(updated.transcript),
        updated.scoreReport ? JSON.stringify(updated.scoreReport) : null,
        JSON.stringify(updated.evalResults),
        updated.updatedAt,
        sessionId,
      )
      .run();

    return updated;
  }

  async appendTurn(sessionId: string, turn: AgentTurn): Promise<AgentSession> {
    const existing = await this.getSession(sessionId);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);

    const updated: AgentSession = {
      ...existing,
      transcript: {
        ...existing.transcript,
        turns: [...existing.transcript.turns, turn],
      },
      updatedAt: now(),
    };

    await this.db
      .prepare(`UPDATE ${this.tableName} SET transcript = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(updated.transcript), updated.updatedAt, sessionId)
      .run();

    return updated;
  }

  private rowToSession(row: {
    id: string;
    agent_type: string;
    challenge_id: string | null;
    candidate_id: string | null;
    state: string;
    consent_at: string | null;
    transcript: string;
    score_report: string | null;
    eval_results: string;
    created_at: string;
    updated_at: string;
  }): AgentSession {
    return {
      id: row.id,
      agentType: row.agent_type as AgentType,
      challengeId: row.challenge_id ?? undefined,
      candidateId: row.candidate_id ?? undefined,
      state: row.state as AgentSession['state'],
      consentAt: row.consent_at ?? undefined,
      transcript: JSON.parse(row.transcript) as AgentTranscript,
      scoreReport: row.score_report ? (JSON.parse(row.score_report) as ScoreReport) : undefined,
      evalResults: JSON.parse(row.eval_results) as EvalGateResult[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
