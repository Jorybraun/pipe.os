import { describe, expect, it } from 'vitest';
import {
  buildReviewGraphMigrationPlan,
  parseWranglerPendingMigrations,
} from './checkReviewGraphMigrationPlan';

const WRANGLER_TABLE = `
Migrations to be applied:
┌─────────────────────────────────────────────┐
│ Name                                        │
├─────────────────────────────────────────────┤
│ 0085_candidate_node_idempotency.sql         │
├─────────────────────────────────────────────┤
│ 0083_repo_semantic_graph_and_match_runs.sql │
├─────────────────────────────────────────────┤
│ 0095_context_records.sql                    │
├─────────────────────────────────────────────┤
│ 0082_living_context_graph.sql               │
└─────────────────────────────────────────────┘
`;

describe('checkReviewGraphMigrationPlan', () => {
  it('parses Wrangler migration table output', () => {
    expect(parseWranglerPendingMigrations(WRANGLER_TABLE)).toEqual([
      '0082_living_context_graph.sql',
      '0083_repo_semantic_graph_and_match_runs.sql',
      '0085_candidate_node_idempotency.sql',
      '0095_context_records.sql',
    ]);
  });

  it('blocks review graph rollout when required migrations would apply unrelated backlog', () => {
    const report = buildReviewGraphMigrationPlan(parseWranglerPendingMigrations(WRANGLER_TABLE));

    expect(report.ready).toBe(false);
    expect(report.status).toBe('blocked');
    expect(report.pendingRequiredMigrations).toEqual([
      '0082_living_context_graph.sql',
      '0083_repo_semantic_graph_and_match_runs.sql',
      '0095_context_records.sql',
    ]);
    expect(report.extraPendingMigrations).toEqual(['0085_candidate_node_idempotency.sql']);
    expect(report.failures).toEqual([
      'migration apply would also apply 1 unrelated pending migration(s)',
    ]);
    expect(report.nextActions).toContain(
      'Run the rollout with allow_extra_pending_migrations only after reviewing the full production migration backlog.',
    );
    expect(report.nextActions).toContain(
      'Use the graph-only schema prep path to execute just the required review-graph SQL files if the broader migration batch is not ready.',
    );
  });

  it('allows an explicit broad migration apply after backlog review', () => {
    const report = buildReviewGraphMigrationPlan(
      parseWranglerPendingMigrations(WRANGLER_TABLE),
      { allowExtraPendingMigrations: true },
    );

    expect(report.ready).toBe(true);
    expect(report.status).toBe('ready_to_apply');
    expect(report.allowExtraPendingMigrations).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('blocks unrelated pending migrations even when no review graph migrations are pending', () => {
    const report = buildReviewGraphMigrationPlan([
      '0085_candidate_node_idempotency.sql',
    ]);

    expect(report.ready).toBe(false);
    expect(report.status).toBe('blocked');
    expect(report.pendingRequiredMigrations).toEqual([]);
    expect(report.extraPendingMigrations).toEqual(['0085_candidate_node_idempotency.sql']);
    expect(report.failures).toEqual([
      'migration apply would also apply 1 unrelated pending migration(s)',
    ]);
    expect(report.nextActions).toContain(
      'Review graph migrations are not pending; use the readiness report to confirm graph tables are already present before backfill.',
    );
  });
});
