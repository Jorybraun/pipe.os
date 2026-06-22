/**
 * Internal repo graph overlay endpoint.
 *
 * GET /api/v1/internal/repo-graph/:repoId/overlay?packetId=...
 * Returns the full file tree for a challenge packet's repo snapshot,
 * including source spans, symbols, and challenge demand mappings.
 *
 * This powers the "full repo context" view in the recruiter overlay,
 * showing all files (not just matched spans) so the recruiter sees
 * the complete codebase structure with highlighted match areas.
 *
 * Auth: requires ADMIN_TTL_OVERRIDE_SECRET in X-Admin-Token header.
 * Acceptance criterion #7: visualize the living graph + repo overlays.
 */

import { Hono } from 'hono';
import type { Env } from '../../types';

interface RepoFileNode {
  path: string;
  artifactId: string;
  artifactVersionId: string;
  byteLength: number;
  mediaType: string;
  spans: RepoSpanNode[];
  symbols: RepoSymbolNode[];
}

interface RepoSpanNode {
  id: string;
  byteStart: number;
  byteEnd: number;
  lineStart: number | null;
  lineEnd: number | null;
  exactText: string;
  contentHash: string;
  /** Which challenge demand IDs reference this span */
  demandIds: string[];
}

interface RepoSymbolNode {
  id: string;
  qualifiedName: string;
  kind: string;
  signature: string | null;
  language: string;
  definingSpanId: string;
}

interface RepoGraphOverlayResponse {
  repoId: number;
  snapshotId: string;
  commitSha: string;
  packetId: string | null;
  prNumber: number | null;
  fileCount: number;
  spanCount: number;
  symbolCount: number;
  files: RepoFileNode[];
}

const app = new Hono<{ Bindings: Env }>();

app.get('/:repoId/overlay', async (c) => {
  const adminToken = c.req.header('X-Admin-Token');
  const expectedToken = c.env.ADMIN_TTL_OVERRIDE_SECRET;
  if (!expectedToken || adminToken !== expectedToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const repoId = Number(c.req.param('repoId'));
  if (!repoId || isNaN(repoId)) {
    return c.json({ error: 'Invalid repoId' }, 400);
  }

  const packetId = c.req.query('packetId') ?? null;

  // Load the latest repo snapshot
  const snapshot = await c.env.DB.prepare(
    `SELECT id, commit_sha FROM repo_snapshots
      WHERE repo_id = ?1
      ORDER BY created_at DESC LIMIT 1`,
  ).bind(repoId).first<{ id: string; commit_sha: string }>();

  if (!snapshot) {
    return c.json({ error: 'No snapshot found for this repo' }, 404);
  }

  // Load all source artifacts (files) for this snapshot
  const artifacts = await c.env.DB.prepare(
    `SELECT id, path, artifact_type FROM repo_source_artifacts
      WHERE repo_snapshot_id = ?1
      ORDER BY path`,
  ).bind(snapshot.id).all<{ id: string; path: string; artifact_type: string }>();

  // Load artifact versions
  const artifactIds = (artifacts.results ?? []).map((a) => a.id);
  const versionMap = new Map<string, { id: string; content_hash: string; byte_length: number; media_type: string }>();

  for (const artifactId of artifactIds) {
    const version = await c.env.DB.prepare(
      `SELECT id, content_hash, byte_length, media_type
         FROM repo_artifact_versions
        WHERE artifact_id = ?1
        ORDER BY created_at DESC LIMIT 1`,
    ).bind(artifactId).first<{ id: string; content_hash: string; byte_length: number; media_type: string }>();
    if (version) versionMap.set(artifactId, version);
  }

  // Load all source spans for this snapshot's artifact versions
  const versionIds = [...versionMap.values()].map((v) => v.id);
  const allSpans: Array<{
    id: string;
    artifact_version_id: string;
    byte_start: number;
    byte_end: number;
    line_start: number | null;
    line_end: number | null;
    exact_text: string;
    content_hash: string;
  }> = [];

  // Batch load spans (D1 has bind limit, chunk if needed)
  for (let i = 0; i < versionIds.length; i += 20) {
    const chunk = versionIds.slice(i, i + 20);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await c.env.DB.prepare(
      `SELECT id, artifact_version_id, byte_start, byte_end, line_start, line_end, exact_text, content_hash
         FROM repo_source_spans
        WHERE artifact_version_id IN (${placeholders})
        ORDER BY byte_start`,
    ).bind(...chunk).all<{
      id: string;
      artifact_version_id: string;
      byte_start: number;
      byte_end: number;
      line_start: number | null;
      line_end: number | null;
      exact_text: string;
      content_hash: string;
    }>();
    allSpans.push(...(result.results ?? []));
  }

  // Load symbols
  const allSymbols = await c.env.DB.prepare(
    `SELECT id, qualified_name, symbol_kind, signature, language, defining_span_id
       FROM repo_symbols
      WHERE repo_snapshot_id = ?1`,
  ).bind(snapshot.id).all<{
    id: string;
    qualified_name: string;
    symbol_kind: string;
    signature: string | null;
    language: string;
    defining_span_id: string;
  }>();

  // If a packet is specified, load demand→span mappings
  const demandSpanMap = new Map<string, string[]>();
  let prNumber: number | null = null;

  if (packetId) {
    const packet = await c.env.DB.prepare(
      `SELECT packet_json, pr_number FROM review_challenge_packets WHERE id = ?1`,
    ).bind(packetId).first<{ packet_json: string; pr_number: number }>();

    if (packet) {
      prNumber = packet.pr_number;
      const parsed = JSON.parse(packet.packet_json) as {
        demands: Array<{ id: string; sourceSpanIds: string[] }>;
      };
      for (const demand of parsed.demands) {
        for (const spanId of demand.sourceSpanIds) {
          const existing = demandSpanMap.get(spanId) ?? [];
          existing.push(demand.id);
          demandSpanMap.set(spanId, existing);
        }
      }
    }
  }

  // Build the response
  const spansByVersion = new Map<string, typeof allSpans>();
  for (const span of allSpans) {
    const existing = spansByVersion.get(span.artifact_version_id) ?? [];
    existing.push(span);
    spansByVersion.set(span.artifact_version_id, existing);
  }

  const symbolsBySpan = new Map<string, Array<typeof allSymbols.results[0]>>();
  for (const symbol of allSymbols.results ?? []) {
    const existing = symbolsBySpan.get(symbol.defining_span_id) ?? [];
    existing.push(symbol);
    symbolsBySpan.set(symbol.defining_span_id, existing);
  }

  const files: RepoFileNode[] = (artifacts.results ?? []).map((artifact) => {
    const version = versionMap.get(artifact.id);
    if (!version) {
      return {
        path: artifact.path,
        artifactId: artifact.id,
        artifactVersionId: '',
        byteLength: 0,
        mediaType: '',
        spans: [],
        symbols: [],
      };
    }

    const spans = (spansByVersion.get(version.id) ?? []).map((span) => ({
      id: span.id,
      byteStart: span.byte_start,
      byteEnd: span.byte_end,
      lineStart: span.line_start,
      lineEnd: span.line_end,
      exactText: span.exact_text,
      contentHash: span.content_hash,
      demandIds: demandSpanMap.get(span.id) ?? [],
    }));

    const symbols: RepoSymbolNode[] = [];
    for (const span of spans) {
      for (const symbol of symbolsBySpan.get(span.id) ?? []) {
        symbols.push({
          id: symbol.id,
          qualifiedName: symbol.qualified_name,
          kind: symbol.symbol_kind,
          signature: symbol.signature,
          language: symbol.language,
          definingSpanId: symbol.defining_span_id,
        });
      }
    }

    return {
      path: artifact.path,
      artifactId: artifact.id,
      artifactVersionId: version.id,
      byteLength: version.byte_length,
      mediaType: version.media_type,
      spans,
      symbols,
    };
  });

  const response: RepoGraphOverlayResponse = {
    repoId,
    snapshotId: snapshot.id,
    commitSha: snapshot.commit_sha,
    packetId,
    prNumber,
    fileCount: files.length,
    spanCount: allSpans.length,
    symbolCount: (allSymbols.results ?? []).length,
    files,
  };

  return c.json(response);
});

export const repoGraph = app;
