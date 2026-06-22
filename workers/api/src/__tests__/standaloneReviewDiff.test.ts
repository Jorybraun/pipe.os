import { describe, expect, it } from 'vitest';
import { hasSourceBackedReviewPacket, loadSourceBackedReviewDiff } from '../routes/rpc';

function createDiffDb(input: {
  packetJson?: string | null;
  spans?: Array<{
    id: string;
    path: string | null;
    exact_text: string;
    line_start: number | null;
    line_end: number | null;
  }>;
  sqls?: string[];
}): D1Database {
  return {
    prepare(sql: string) {
      input.sqls?.push(sql);
      return {
        bind() {
          return {
            async first<T>() {
              if (!sql.includes('FROM review_challenge_packets')) return null;
              return (input.packetJson ? { packet_json: input.packetJson } : null) as T | null;
            },
            async all<T>() {
              if (!sql.includes('FROM repo_source_spans')) {
                return { success: true, results: [], meta: {} };
              }
              return {
                success: true,
                results: (input.spans ?? []) as T[],
                meta: {},
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('loadSourceBackedReviewDiff', () => {
  it('reports source-backed packet availability through the same context gate', async () => {
    const sqls: string[] = [];
    const ready = await hasSourceBackedReviewPacket(
      createDiffDb({ packetJson: JSON.stringify({ demands: [] }), sqls }),
      'https://github.com/pipe/orders',
      42,
    );
    const missing = await hasSourceBackedReviewPacket(
      createDiffDb({ packetJson: null }),
      'https://github.com/pipe/orders',
      42,
    );

    expect(ready).toBe(true);
    expect(missing).toBe(false);
    expect(sqls[0]).toContain('JOIN context_records cr');
    expect(sqls[0]).toContain("cr.record_type = 'repo_challenge_packet'");
    expect(sqls[0]).toContain("crsr.source_ref_type = 'repo_source_span'");
    expect(sqls[0]).toContain('FROM context_record_concepts crc');
  });

  it('requires source-backed packet context before loading standalone review diffs', async () => {
    const sqls: string[] = [];
    const result = await loadSourceBackedReviewDiff(
      createDiffDb({ packetJson: null, sqls }),
      'https://github.com/pipe/orders',
      42,
    );

    expect(result).toBeNull();
    expect(sqls[0]).toContain('JOIN context_records cr');
    expect(sqls[0]).toContain("cr.record_type = 'repo_challenge_packet'");
    expect(sqls[0]).toContain("crsr.source_ref_type = 'repo_source_span'");
    expect(sqls[0]).toContain('FROM context_record_concepts crc');
  });

  it('reconstructs a diff only from packet source spans selected by the gated packet query', async () => {
    const packet = {
      pullRequest: {
        title: 'Retry order publishing',
        author: 'dev',
        baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        mergedAt: '2026-06-20T12:00:00.000Z',
        body: 'Source-backed PR body',
      },
      demands: [
        { sourceSpanIds: ['span-1'] },
      ],
    };

    const result = await loadSourceBackedReviewDiff(
      createDiffDb({
        packetJson: JSON.stringify(packet),
        spans: [{
          id: 'span-1',
          path: 'src/orders/retry.ts',
          exact_text: 'publishWithRetry(order)',
          line_start: 18,
          line_end: 18,
        }],
      }),
      'https://github.com/pipe/orders',
      42,
    );

    expect(result?.metadata.title).toBe('Retry order publishing');
    expect(result?.diff.files).toEqual([
      expect.objectContaining({
        filename: 'src/orders/retry.ts',
        headContent: 'publishWithRetry(order)',
        hunks: [
          expect.objectContaining({
            header: '@@ source-backed src/orders/retry.ts:18-18 @@',
          }),
        ],
      }),
    ]);
  });
});
