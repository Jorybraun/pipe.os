import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { createMockD1 } from '../../../__tests__/helpers/mockD1';

describe('repo graph overlay endpoint data path', () => {
  let db: D1Database;

  beforeAll(() => {
    const sqlite = new Database(':memory:');
    db = createMockD1(sqlite);

    // Create required tables
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS repo_snapshots (
        id TEXT PRIMARY KEY,
        repo_id INTEGER NOT NULL,
        commit_sha TEXT NOT NULL,
        tree_hash TEXT,
        extractor_version TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(repo_id, commit_sha, extractor_version)
      );
      CREATE TABLE IF NOT EXISTS repo_source_artifacts (
        id TEXT PRIMARY KEY,
        repo_snapshot_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        path TEXT NOT NULL,
        external_reference TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS repo_artifact_versions (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        storage_key TEXT,
        inline_content TEXT,
        byte_length INTEGER NOT NULL,
        media_type TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS repo_source_spans (
        id TEXT PRIMARY KEY,
        artifact_version_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        path TEXT,
        byte_start INTEGER,
        byte_end INTEGER,
        line_start INTEGER,
        line_end INTEGER,
        pr_side TEXT,
        base_sha TEXT,
        head_sha TEXT,
        exact_text TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS repo_symbols (
        id TEXT PRIMARY KEY,
        repo_snapshot_id TEXT NOT NULL,
        language TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        symbol_kind TEXT NOT NULL,
        signature TEXT,
        containing_symbol_id TEXT,
        defining_span_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS review_challenge_packets (
        id TEXT PRIMARY KEY,
        repo_snapshot_id TEXT NOT NULL,
        repo_id INTEGER NOT NULL,
        pr_number INTEGER NOT NULL,
        packet_version TEXT,
        source_hash TEXT,
        language TEXT,
        production_ready INTEGER DEFAULT 0,
        quality_score REAL DEFAULT 0,
        demand_families_json TEXT,
        packet_json TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(repo_snapshot_id, pr_number, packet_version)
      );
    `);

    // Seed test data
    sqlite.exec(`
      INSERT INTO repo_snapshots (id, repo_id, commit_sha, extractor_version)
      VALUES ('snap-1', 42, 'abc123def', 'v3');
    `);
    sqlite.exec(`
      INSERT INTO repo_source_artifacts (id, repo_snapshot_id, artifact_type, path)
      VALUES ('art-1', 'snap-1', 'source_file', 'src/handlers/events.ts'),
             ('art-2', 'snap-1', 'source_file', 'src/models/user.ts'),
             ('art-3', 'snap-1', 'source_file', 'src/lib/kafka.ts');
    `);
    sqlite.exec(`
      INSERT INTO repo_artifact_versions (id, artifact_id, content_hash, byte_length, media_type)
      VALUES ('ver-1', 'art-1', 'hash-a', 2048, 'text/typescript'),
             ('ver-2', 'art-2', 'hash-b', 1024, 'text/typescript'),
             ('ver-3', 'art-3', 'hash-c', 3072, 'text/typescript');
    `);
    sqlite.exec(`
      INSERT INTO repo_source_spans (id, artifact_version_id, content_hash, path, byte_start, byte_end, line_start, line_end, exact_text)
      VALUES ('span-1', 'ver-1', 'sh-1', 'src/handlers/events.ts', 0, 58, 1, 4, 'export async function handleEvent(event: DomainEvent)'),
             ('span-2', 'ver-1', 'sh-2', 'src/handlers/events.ts', 60, 180, 5, 12, 'const result = await processor.execute(event.payload)'),
             ('span-3', 'ver-3', 'sh-3', 'src/lib/kafka.ts', 0, 90, 1, 5, 'export class KafkaConsumer implements IConsumer');
    `);
    sqlite.exec(`
      INSERT INTO repo_symbols (id, repo_snapshot_id, language, qualified_name, symbol_kind, signature, defining_span_id)
      VALUES ('sym-1', 'snap-1', 'typescript', 'handleEvent', 'function', '(event: DomainEvent) => Promise<void>', 'span-1'),
             ('sym-2', 'snap-1', 'typescript', 'KafkaConsumer', 'class', 'class KafkaConsumer implements IConsumer', 'span-3');
    `);

    const packetJson = JSON.stringify({
      id: 'pkt-1',
      repoSnapshotId: 'snap-1',
      pullRequest: { number: 101 },
      demands: [
        { id: 'demand-1', sourceSpanIds: ['span-1', 'span-2'], conceptKeys: ['term:event-driven'], family: 'architecture', narrative: 'Handle domain events', weight: 0.8, problems: [], mechanisms: [], domains: [], businessObjects: [], ownershipActions: [] },
        { id: 'demand-2', sourceSpanIds: ['span-3'], conceptKeys: ['term:kafka'], family: 'infrastructure', narrative: 'Kafka consumer implementation', weight: 0.6, problems: [], mechanisms: [], domains: [], businessObjects: [], ownershipActions: [] },
      ],
      quality: { eligible: true, score: 0.85, metrics: { demandDiversity: 0.7 } },
      languageSupport: { normalizedLanguage: 'typescript' },
      demandFamilies: ['architecture', 'infrastructure'],
    });
    sqlite.prepare(
      `INSERT INTO review_challenge_packets (id, repo_snapshot_id, repo_id, pr_number, packet_version, production_ready, quality_score, packet_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('pkt-1', 'snap-1', 42, 101, 'v3', 1, 0.85, packetJson);
  });

  it('returns full file tree for a repo snapshot', async () => {
    const snapshot = await db.prepare(
      'SELECT id, commit_sha FROM repo_snapshots WHERE repo_id = ?1',
    ).bind(42).first<{ id: string; commit_sha: string }>();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.commit_sha).toBe('abc123def');

    const artifacts = await db.prepare(
      'SELECT id, path FROM repo_source_artifacts WHERE repo_snapshot_id = ?1 ORDER BY path',
    ).bind('snap-1').all<{ id: string; path: string }>();
    expect(artifacts.results).toHaveLength(3);
    expect(artifacts.results[0].path).toBe('src/handlers/events.ts');
    expect(artifacts.results[1].path).toBe('src/lib/kafka.ts');
    expect(artifacts.results[2].path).toBe('src/models/user.ts');
  });

  it('source spans carry file-path locators for overlay rendering', async () => {
    const spans = await db.prepare(
      `SELECT id, path, byte_start, byte_end, exact_text
         FROM repo_source_spans
        WHERE artifact_version_id = ?1
        ORDER BY byte_start`,
    ).bind('ver-1').all<{ id: string; path: string; byte_start: number; byte_end: number; exact_text: string }>();

    expect(spans.results).toHaveLength(2);
    const locator = `${spans.results[0].path}:${spans.results[0].byte_start}-${spans.results[0].byte_end}`;
    expect(locator).toBe('src/handlers/events.ts:0-58');
  });

  it('challenge packet demands map to specific source spans', async () => {
    const packet = await db.prepare(
      'SELECT packet_json FROM review_challenge_packets WHERE id = ?1',
    ).bind('pkt-1').first<{ packet_json: string }>();
    expect(packet).not.toBeNull();

    const parsed = JSON.parse(packet!.packet_json) as {
      demands: Array<{ id: string; sourceSpanIds: string[] }>;
    };
    expect(parsed.demands).toHaveLength(2);
    expect(parsed.demands[0].sourceSpanIds).toEqual(['span-1', 'span-2']);
    expect(parsed.demands[1].sourceSpanIds).toEqual(['span-3']);

    for (const demand of parsed.demands) {
      for (const spanId of demand.sourceSpanIds) {
        const span = await db.prepare('SELECT id FROM repo_source_spans WHERE id = ?1').bind(spanId).first();
        expect(span).not.toBeNull();
      }
    }
  });

  it('symbols resolve to their defining spans for code navigation', async () => {
    const symbols = await db.prepare(
      `SELECT s.qualified_name, s.symbol_kind as kind, s.signature, sp.path, sp.byte_start, sp.byte_end
         FROM repo_symbols s
         JOIN repo_source_spans sp ON sp.id = s.defining_span_id
        WHERE s.repo_snapshot_id = ?1
        ORDER BY s.qualified_name`,
    ).bind('snap-1').all<{
      qualified_name: string; kind: string; signature: string;
      path: string; byte_start: number; byte_end: number;
    }>();

    expect(symbols.results).toHaveLength(2);
    expect(symbols.results[0]).toMatchObject({
      qualified_name: 'KafkaConsumer',
      kind: 'class',
      path: 'src/lib/kafka.ts',
    });
    expect(symbols.results[1]).toMatchObject({
      qualified_name: 'handleEvent',
      kind: 'function',
      path: 'src/handlers/events.ts',
    });
  });

  it('builds demand-to-span index for overlay highlighting', async () => {
    const packet = await db.prepare(
      'SELECT packet_json FROM review_challenge_packets WHERE id = ?1',
    ).bind('pkt-1').first<{ packet_json: string }>();
    const parsed = JSON.parse(packet!.packet_json) as {
      demands: Array<{ id: string; sourceSpanIds: string[] }>;
    };

    const demandSpanMap = new Map<string, string[]>();
    for (const demand of parsed.demands) {
      for (const spanId of demand.sourceSpanIds) {
        const existing = demandSpanMap.get(spanId) ?? [];
        existing.push(demand.id);
        demandSpanMap.set(spanId, existing);
      }
    }

    expect(demandSpanMap.get('span-1')).toEqual(['demand-1']);
    expect(demandSpanMap.get('span-2')).toEqual(['demand-1']);
    expect(demandSpanMap.get('span-3')).toEqual(['demand-2']);

    const fileGroups = new Map<string, string[]>();
    for (const [spanId, demandIds] of demandSpanMap) {
      const span = await db.prepare('SELECT path FROM repo_source_spans WHERE id = ?1').bind(spanId).first<{ path: string }>();
      if (!span) continue;
      const existing = fileGroups.get(span.path) ?? [];
      existing.push(...demandIds);
      fileGroups.set(span.path, existing);
    }
    expect(fileGroups.get('src/handlers/events.ts')).toEqual(['demand-1', 'demand-1']);
    expect(fileGroups.get('src/lib/kafka.ts')).toEqual(['demand-2']);
  });

  it('overlay response shape matches frontend RepoOverlayPanel contract', async () => {
    const allSpans = await db.prepare(
      `SELECT rss.id, rss.path, rss.byte_start, rss.byte_end, rss.exact_text, rss.content_hash
         FROM repo_source_spans rss
         JOIN repo_artifact_versions rav ON rav.id = rss.artifact_version_id
         JOIN repo_source_artifacts rsa ON rsa.id = rav.artifact_id
        WHERE rsa.repo_snapshot_id = ?1
        ORDER BY rss.path, rss.byte_start`,
    ).bind('snap-1').all<{
      id: string; path: string; byte_start: number; byte_end: number;
      exact_text: string; content_hash: string;
    }>();

    expect(allSpans.results).toHaveLength(3);
    for (const span of allSpans.results) {
      const locator = `${span.path}:${span.byte_start}-${span.byte_end}`;
      const parsedPath = locator.split(':')[0];
      expect(parsedPath).toBe(span.path);
    }
  });
});
