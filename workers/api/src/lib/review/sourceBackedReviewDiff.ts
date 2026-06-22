import type { GitHubDiffResult } from '../fetchGitHubDiff';
import type { ChallengePacket as RepoChallengePacket } from '../repoSemanticGraph';

async function loadSourceBackedReviewPacketJson(
  db: D1Database,
  repoUrl: string,
  prNumber: number,
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT rcp.packet_json
       FROM review_challenge_packets rcp
       JOIN qualified_repos qr ON qr.id = rcp.repo_id
       JOIN context_records cr
         ON cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
        AND cr.scope_type = 'repo_snapshot'
        AND cr.scope_id = rcp.repo_snapshot_id
        AND cr.record_type = 'repo_challenge_packet'
      WHERE qr.github_url = ?1
        AND rcp.pr_number = ?2
        AND rcp.production_ready = 1
        AND (
          SELECT COUNT(*)
            FROM context_record_source_refs crsr
           WHERE crsr.context_record_id = cr.id
             AND crsr.source_ref_type = 'repo_source_span'
        ) > 0
        AND (
          SELECT COUNT(*)
            FROM context_record_concepts crc
           WHERE crc.context_record_id = cr.id
        ) > 0
      ORDER BY rcp.quality_score DESC, rcp.updated_at DESC
      LIMIT 1`,
  ).bind(repoUrl, prNumber).first<{ packet_json: string }>();
  return row?.packet_json ?? null;
}

export async function hasSourceBackedReviewPacket(
  db: D1Database,
  repoUrl: string,
  prNumber: number,
): Promise<boolean> {
  return (await loadSourceBackedReviewPacketJson(db, repoUrl, prNumber)) !== null;
}

export async function loadSourceBackedReviewDiff(
  db: D1Database,
  repoUrl: string,
  prNumber: number,
): Promise<GitHubDiffResult | null> {
  const packetJson = await loadSourceBackedReviewPacketJson(db, repoUrl, prNumber);
  if (!packetJson) return null;

  let packet: RepoChallengePacket;
  try {
    packet = JSON.parse(packetJson) as RepoChallengePacket;
  } catch {
    return null;
  }

  const sourceSpanIds = [...new Set(packet.demands.flatMap((demand) => demand.sourceSpanIds))];
  if (sourceSpanIds.length === 0) return null;

  const placeholders = sourceSpanIds.map(() => '?').join(',');
  const spans = await db.prepare(
    `SELECT id, path, exact_text, line_start, line_end
       FROM repo_source_spans
      WHERE id IN (${placeholders})`,
  ).bind(...sourceSpanIds).all<{
    id: string;
    path: string | null;
    exact_text: string;
    line_start: number | null;
    line_end: number | null;
  }>();
  const spanById = new Map((spans.results ?? []).map((span) => [span.id, span]));
  const files = new Map<string, GitHubDiffResult['diff']['files'][number]>();

  for (const spanId of sourceSpanIds) {
    const span = spanById.get(spanId);
    if (!span) return null;
    const filename = span.path ?? span.id;
    const file = files.get(filename) ?? {
      filename,
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [],
      headContent: span.exact_text,
      headContentUrl: `${repoUrl}/pull/${prNumber}`,
    };
    const lineStart = span.line_start ?? 1;
    const lines = span.exact_text.split('\n');
    file.additions += lines.length;
    file.hunks.push({
      header: `@@ source-backed ${filename}:${lineStart}-${span.line_end ?? lineStart + lines.length - 1} @@`,
      lines: lines.map((line, index) => ({
        type: 'added' as const,
        content: line,
        lineNumber: lineStart + index,
      })),
    });
    files.set(filename, file);
  }

  return {
    diff: { files: [...files.values()].sort((left, right) => left.filename.localeCompare(right.filename)) },
    metadata: {
      title: packet.pullRequest.title,
      author: packet.pullRequest.author,
      created_at: packet.pullRequest.mergedAt ?? new Date(0).toISOString(),
      state: packet.pullRequest.mergedAt ? 'merged' : 'open',
      base: 'base',
      head: 'head',
      base_sha: packet.pullRequest.baseSha,
      head_sha: packet.pullRequest.headSha,
      merged_at: packet.pullRequest.mergedAt,
      description: packet.pullRequest.body ?? 'Source-backed review packet reconstructed from persisted repo spans.',
    },
  };
}
