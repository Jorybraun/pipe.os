import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { CandidateNode } from '../../../types';
import {
  embedCandidateNodes,
  insertCandidateNode,
  repairCandidateResumeNodeSourceRefs,
  repairTalentPoolResumeNodeSourceRefs,
  supersedeCandidateNode,
} from '../candidateNodes';

type SqlValue = string | number | null;

function makeStubDb(): {
  db: D1Database;
  batchCalls: { sql: string; bindings: unknown[] }[][];
} {
  const batchCalls: { sql: string; bindings: unknown[] }[][] = [];

  function prepare(sql: string): D1PreparedStatement {
    const bindings: unknown[] = [];
    const stmt = {
      bind: (...args: unknown[]) => {
        bindings.push(...args);
        return stmt;
      },
      _sql: sql,
      _bindings: bindings,
    } as unknown as D1PreparedStatement;
    return stmt;
  }

  const db = {
    prepare,
    batch: vi.fn(async (statements: D1PreparedStatement[]) => {
      const call = statements.map((stmt) => {
        const s = stmt as unknown as { _sql: string; _bindings: unknown[] };
        return { sql: s._sql, bindings: s._bindings };
      });
      batchCalls.push(call);
    }),
  } as unknown as D1Database;

  return { db, batchCalls };
}

function makeStubAi(
  vectors: number[][] | null,
): {
  AI: {
    run: (
      model: string,
      input: { text: string[] },
    ) => Promise<{ data?: number[][] }>;
  };
  calls: { model: string; input: { text: string[] } }[];
} {
  const calls: { model: string; input: { text: string[] } }[] = [];
  let callIndex = 0;

  const ai = {
    run: vi.fn(async (_model: string, input: { text: string[] }) => {
      calls.push({ model: _model, input });
      if (vectors === null) return {};
      const start = callIndex;
      const end = callIndex + input.text.length;
      callIndex = end;
      return { data: vectors.slice(start, end) };
    }),
  };

  return { AI: ai, calls };
}

function makeValidVector(): number[] {
  return new Array(1024).fill(0).map((_, i) => i / 1024);
}

class SqliteD1Statement {
  constructor(
    private readonly statement: Database.Statement,
    private readonly values: SqlValue[] = [],
  ) {}

  bind(...values: SqlValue[]): SqliteD1Statement {
    return new SqliteD1Statement(this.statement, values);
  }

  async run(): Promise<{ success: boolean }> {
    this.statement.run(...this.values);
    return { success: true };
  }

  async first<T = unknown>(): Promise<T | null> {
    return (this.statement.get(...this.values) ?? null) as T | null;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: this.statement.all(...this.values) as T[] };
  }
}

class SqliteD1Database {
  constructor(private readonly database: Database.Database) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.database.prepare(sql.replace(/\?\d+/g, '?')));
  }
}

function createCandidateNodeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE candidate_nodes (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      narrative_text TEXT NOT NULL,
      extracted_properties_json TEXT,
      embedding_json TEXT,
      source_type TEXT NOT NULL,
      source_reference TEXT,
      captured_at INTEGER NOT NULL,
      confidence REAL,
      supersedes TEXT,
      superseded_at INTEGER,
      decomposition_version TEXT,
      ingestion_key TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX idx_candidate_nodes_ingestion_key
      ON candidate_nodes(ingestion_key)
      WHERE ingestion_key IS NOT NULL;
  `);
}

function createTalentPoolSourceSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE talent_pool_intakes (
      candidate_id TEXT PRIMARY KEY,
      profile_r2_key TEXT,
      submitted_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE artifact_versions (
      id TEXT PRIMARY KEY,
      storage_key TEXT,
      content_text TEXT
    );
    CREATE TABLE source_spans (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT,
      char_start INTEGER,
      char_end INTEGER,
      exact_text TEXT
    );
  `);
}

describe('supersedeCandidateNode', () => {
  it('batches the two update statements', async () => {
    const { db, batchCalls } = makeStubDb();

    await supersedeCandidateNode(db, 'old-1', 'new-1');

    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toHaveLength(2);
    expect(batchCalls[0]![0]!.sql).toContain('UPDATE candidate_nodes');
    expect(batchCalls[0]![0]!.sql).toContain('superseded_at = unixepoch()');
    expect(batchCalls[0]![0]!.bindings).toEqual(['old-1']);
    expect(batchCalls[0]![1]!.sql).toContain('supersedes = ?1');
    expect(batchCalls[0]![1]!.bindings).toEqual(['old-1', 'new-1']);
  });

  it('throws when oldId equals newId', async () => {
    const { db } = makeStubDb();

    await expect(
      supersedeCandidateNode(db, 'same-id', 'same-id'),
    ).rejects.toThrow(/Cannot supersede a node with itself/);
  });
});

describe('embedCandidateNodes', () => {
  it('returns embeddings for multiple texts', async () => {
    const vectors = [makeValidVector(), makeValidVector()];
    const { AI, calls } = makeStubAi(vectors);

    const result = await embedCandidateNodes(['text one', 'text two'], { AI });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(vectors[0]);
    expect(result[1]).toEqual(vectors[1]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input.text).toHaveLength(2);
  });

  it('chunks into batches of 10', async () => {
    const texts = Array.from({ length: 25 }, (_, i) => `text ${i}`);
    const vectors = texts.map(() => makeValidVector());
    const { AI, calls } = makeStubAi(vectors);

    const result = await embedCandidateNodes(texts, { AI });

    expect(result).toHaveLength(25);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.input.text).toHaveLength(10);
    expect(calls[1]!.input.text).toHaveLength(10);
    expect(calls[2]!.input.text).toHaveLength(5);
  });

  it('returns an empty array for empty input', async () => {
    const { AI, calls } = makeStubAi([]);

    const result = await embedCandidateNodes([], { AI });

    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('throws when embedder returns no vectors', async () => {
    const { AI } = makeStubAi(null);

    await expect(
      embedCandidateNodes(['hello'], { AI }),
    ).rejects.toThrow(/returned no vectors/);
  });

  it('throws on batch length mismatch', async () => {
    const { AI } = makeStubAi([makeValidVector()]);

    await expect(
      embedCandidateNodes(['a', 'b'], { AI }),
    ).rejects.toThrow(/length mismatch/);
  });

  it('throws on wrong vector dimension', async () => {
    const { AI } = makeStubAi([new Array(512).fill(0)]);

    await expect(
      embedCandidateNodes(['hello'], { AI }),
    ).rejects.toThrow(/wrong dim/);
  });

  it('throws on non-finite values', async () => {
    const bad = makeValidVector();
    bad[0] = Number.NaN;
    const { AI } = makeStubAi([bad]);

    await expect(
      embedCandidateNodes(['hello'], { AI }),
    ).rejects.toThrow(/non-finite/);
  });
});

describe('insertCandidateNode', () => {
  let sqlite: Database.Database | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('replays the same source-backed candidate node without duplicating active evidence rows', async () => {
    sqlite = new Database(':memory:');
    createCandidateNodeSchema(sqlite);
    const db = new SqliteD1Database(sqlite) as unknown as D1Database;
    const node: Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> = {
      candidate_id: 'candidate-replay',
      node_type: 'Experience',
      narrative_text: 'Senior Engineer at Acme Corp',
      extracted_properties_json: JSON.stringify({
        company: 'Acme Corp',
        role: 'Senior Engineer',
        source_quote: 'Senior Engineer',
        source_quote_validated: true,
        source_quote_char_start: 10,
        source_quote_char_end: 25,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: null,
      captured_at: 100,
      confidence: 0.8,
      supersedes: null,
      superseded_at: null,
      decomposition_version: 'adr041-v1',
    };

    const first = await insertCandidateNode(db, node, { mirrorLivingContext: false });
    const second = await insertCandidateNode(
      db,
      { ...node, captured_at: 200, confidence: 0.9 },
      { mirrorLivingContext: false },
    );

    const rows = sqlite.prepare(`
      SELECT id, ingestion_key, captured_at, confidence, superseded_at
        FROM candidate_nodes
       WHERE candidate_id = 'candidate-replay'
    `).all() as Array<{
      id: string;
      ingestion_key: string | null;
      captured_at: number;
      confidence: number;
      superseded_at: number | null;
    }>;
    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first.id,
      captured_at: 200,
      confidence: 0.9,
      superseded_at: null,
    });
    expect(rows[0]?.ingestion_key).toBe([
      'candidate-replay',
      'resume',
      '',
      'Experience',
      'Senior Engineer at Acme Corp',
      'adr041-v1',
    ].join('\u0000'));
  });

  it('resolves exact resume candidate nodes to the current Talent Pool profile source span without changing replay identity', async () => {
    sqlite = new Database(':memory:');
    createCandidateNodeSchema(sqlite);
    createTalentPoolSourceSchema(sqlite);
    sqlite.exec(`
      INSERT INTO talent_pool_intakes (candidate_id, profile_r2_key, submitted_at)
      VALUES ('candidate-replay', 'talent-intake/candidate-replay/profile.txt', '2026-07-03T00:00:00.000Z');
      INSERT INTO artifact_versions (id, storage_key, content_text)
      VALUES ('artifact-version-profile', 'talent-intake/candidate-replay/profile.txt', 'Built source-backed Talent Pool ingestion.');
      INSERT INTO source_spans (id, artifact_version_id, char_start, char_end, exact_text)
      VALUES ('source-span-profile', 'artifact-version-profile', 0, 39, 'Built source-backed Talent Pool ingestion.');
    `);
    const db = new SqliteD1Database(sqlite) as unknown as D1Database;
    const node: Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> = {
      candidate_id: 'candidate-replay',
      node_type: 'ReviewEvidence',
      narrative_text: 'Candidate supplied review evidence for Talent Pool ingestion.',
      extracted_properties_json: JSON.stringify({
        source_quote: 'Built source-backed Talent Pool ingestion.',
        source_quote_validated: true,
        source_quote_char_start: 0,
        source_quote_char_end: 39,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: 'resume:review-evidence:0',
      captured_at: 100,
      confidence: 0.85,
      supersedes: null,
      superseded_at: null,
      decomposition_version: 'adr041-v1',
    };

    const first = await insertCandidateNode(db, node, { mirrorLivingContext: false });
    const second = await insertCandidateNode(db, { ...node, captured_at: 200 }, { mirrorLivingContext: false });

    expect(second.id).toBe(first.id);
    const row = sqlite.prepare(`
      SELECT source_reference,
             captured_at,
             json_extract(extracted_properties_json, '$.source_span_id') AS source_span_id
        FROM candidate_nodes
       WHERE id = ?
    `).get(first.id) as {
      source_reference: string;
      captured_at: number;
      source_span_id: string;
    };
    expect(row).toEqual({
      source_reference: 'source_span:source-span-profile',
      captured_at: 200,
      source_span_id: 'source-span-profile',
    });
  });

  it('updates source references when replay sees a source span created after the first insert', async () => {
    sqlite = new Database(':memory:');
    createCandidateNodeSchema(sqlite);
    const db = new SqliteD1Database(sqlite) as unknown as D1Database;
    const node: Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> = {
      candidate_id: 'candidate-late-span',
      node_type: 'ReviewEvidence',
      narrative_text: 'Candidate supplied review evidence for late source repair.',
      extracted_properties_json: JSON.stringify({
        source_quote: 'Built source-backed Talent Pool ingestion.',
        source_quote_validated: true,
        source_quote_char_start: 0,
        source_quote_char_end: 39,
      }),
      embedding_json: null,
      source_type: 'resume',
      source_reference: 'resume:review-evidence:0',
      captured_at: 100,
      confidence: 0.85,
      supersedes: null,
      superseded_at: null,
      decomposition_version: 'adr041-v1',
    };

    const first = await insertCandidateNode(db, node, { mirrorLivingContext: false });
    createTalentPoolSourceSchema(sqlite);
    sqlite.exec(`
      INSERT INTO talent_pool_intakes (candidate_id, profile_r2_key, submitted_at)
      VALUES ('candidate-late-span', 'talent-intake/candidate-late-span/profile.txt', '2026-07-03T00:00:00.000Z');
      INSERT INTO artifact_versions (id, storage_key, content_text)
      VALUES ('artifact-version-profile', 'talent-intake/candidate-late-span/profile.txt', 'Built source-backed Talent Pool ingestion.');
      INSERT INTO source_spans (id, artifact_version_id, char_start, char_end, exact_text)
      VALUES ('source-span-late-profile', 'artifact-version-profile', 0, 39, 'Built source-backed Talent Pool ingestion.');
    `);

    const second = await insertCandidateNode(db, { ...node, captured_at: 200 }, { mirrorLivingContext: false });

    expect(second.id).toBe(first.id);
    const row = sqlite.prepare(`
      SELECT source_reference,
             captured_at,
             json_extract(extracted_properties_json, '$.source_span_id') AS source_span_id
        FROM candidate_nodes
       WHERE id = ?
    `).get(first.id) as {
      source_reference: string;
      captured_at: number;
      source_span_id: string;
    };
    expect(row).toEqual({
      source_reference: 'source_span:source-span-late-profile',
      captured_at: 200,
      source_span_id: 'source-span-late-profile',
    });
  });

  it('repairs existing exact resume candidate nodes to current profile source spans idempotently', async () => {
    sqlite = new Database(':memory:');
    createCandidateNodeSchema(sqlite);
    createTalentPoolSourceSchema(sqlite);
    sqlite.exec(`
      INSERT INTO talent_pool_intakes (candidate_id, profile_r2_key, submitted_at)
      VALUES ('candidate-repair', 'talent-intake/candidate-repair/profile.txt', '2026-07-03T00:00:00.000Z');
      INSERT INTO artifact_versions (id, storage_key, content_text)
      VALUES ('artifact-version-profile', 'talent-intake/candidate-repair/profile.txt', 'Built source-backed Talent Pool ingestion.');
      INSERT INTO source_spans (id, artifact_version_id, char_start, char_end, exact_text)
      VALUES ('source-span-repair-profile', 'artifact-version-profile', 0, 39, 'Built source-backed Talent Pool ingestion.');
      INSERT INTO candidate_nodes (
        id, candidate_id, node_type, narrative_text, extracted_properties_json,
        embedding_json, source_type, source_reference, captured_at, confidence,
        supersedes, superseded_at, decomposition_version, ingestion_key
      ) VALUES (
        'candidate-node-repair', 'candidate-repair', 'ReviewEvidence',
        'Candidate supplied review evidence for repair.',
        '{"source_quote":"Built source-backed Talent Pool ingestion.","source_quote_validated":true,"source_quote_char_start":0,"source_quote_char_end":39}',
        NULL, 'resume', 'resume:review-evidence:0', 100, 0.85,
        NULL, NULL, 'adr041-v1', 'candidate-repair-ingestion-key'
      );
    `);
    const db = new SqliteD1Database(sqlite) as unknown as D1Database;

    await expect(repairCandidateResumeNodeSourceRefs(db, 'candidate-repair'))
      .resolves.toEqual({ scanned: 1, repaired: 1 });
    await expect(repairCandidateResumeNodeSourceRefs(db, 'candidate-repair'))
      .resolves.toEqual({ scanned: 0, repaired: 0 });

    const row = sqlite.prepare(`
      SELECT source_reference,
             json_extract(extracted_properties_json, '$.source_span_id') AS source_span_id
        FROM candidate_nodes
       WHERE id = 'candidate-node-repair'
    `).get() as {
      source_reference: string;
      source_span_id: string;
    };
    expect(row).toEqual({
      source_reference: 'source_span:source-span-repair-profile',
      source_span_id: 'source-span-repair-profile',
    });
  });

  it('bulk repairs Talent Pool exact resume nodes that already have current profile spans', async () => {
    sqlite = new Database(':memory:');
    createCandidateNodeSchema(sqlite);
    createTalentPoolSourceSchema(sqlite);
    sqlite.exec(`
      INSERT INTO talent_pool_intakes (candidate_id, profile_r2_key, submitted_at, updated_at)
      VALUES
        ('candidate-bulk-1', 'talent-intake/candidate-bulk-1/profile.txt', '2026-07-03T00:00:00.000Z', '2026-07-03T00:00:00.000Z'),
        ('candidate-bulk-2', 'talent-intake/candidate-bulk-2/profile.txt', '2026-07-03T00:00:00.000Z', '2026-07-03T00:00:00.000Z');
      INSERT INTO artifact_versions (id, storage_key, content_text)
      VALUES
        ('artifact-version-bulk-1', 'talent-intake/candidate-bulk-1/profile.txt', 'Built source-backed Talent Pool ingestion.'),
        ('artifact-version-bulk-2', 'talent-intake/candidate-bulk-2/profile.txt', 'No matching source span yet.');
      INSERT INTO source_spans (id, artifact_version_id, char_start, char_end, exact_text)
      VALUES ('source-span-bulk-1', 'artifact-version-bulk-1', 0, 39, 'Built source-backed Talent Pool ingestion.');
      INSERT INTO candidate_nodes (
        id, candidate_id, node_type, narrative_text, extracted_properties_json,
        embedding_json, source_type, source_reference, captured_at, confidence,
        supersedes, superseded_at, decomposition_version, ingestion_key
      ) VALUES
      (
        'candidate-node-bulk-1', 'candidate-bulk-1', 'ReviewEvidence',
        'Candidate supplied review evidence for bulk repair.',
        '{"source_quote":"Built source-backed Talent Pool ingestion.","source_quote_validated":true,"source_quote_char_start":0,"source_quote_char_end":39}',
        NULL, 'resume', 'resume:review-evidence:0', 100, 0.85,
        NULL, NULL, 'adr041-v1', 'candidate-bulk-1-ingestion-key'
      ),
      (
        'candidate-node-bulk-2', 'candidate-bulk-2', 'ReviewEvidence',
        'Candidate supplied review evidence without a matching span.',
        '{"source_quote":"Missing source span.","source_quote_validated":true,"source_quote_char_start":0,"source_quote_char_end":20}',
        NULL, 'resume', 'resume:review-evidence:0', 100, 0.85,
        NULL, NULL, 'adr041-v1', 'candidate-bulk-2-ingestion-key'
      );
    `);
    const db = new SqliteD1Database(sqlite) as unknown as D1Database;

    await expect(repairTalentPoolResumeNodeSourceRefs(db, 25))
      .resolves.toEqual({ scanned: 1, repaired: 1 });
    await expect(repairTalentPoolResumeNodeSourceRefs(db, 25))
      .resolves.toEqual({ scanned: 0, repaired: 0 });

    const rows = sqlite.prepare(`
      SELECT id,
             source_reference,
             json_extract(extracted_properties_json, '$.source_span_id') AS source_span_id
        FROM candidate_nodes
       ORDER BY id
    `).all() as Array<{
      id: string;
      source_reference: string;
      source_span_id: string | null;
    }>;
    expect(rows).toEqual([
      {
        id: 'candidate-node-bulk-1',
        source_reference: 'source_span:source-span-bulk-1',
        source_span_id: 'source-span-bulk-1',
      },
      {
        id: 'candidate-node-bulk-2',
        source_reference: 'resume:review-evidence:0',
        source_span_id: null,
      },
    ]);
  });
});
