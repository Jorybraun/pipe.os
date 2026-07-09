import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetterSqliteDb } from '../src/__tests__/helpers/mockD1';

const seedSql = readFileSync(
  new URL('./seed-live-review-packet-input.sql', import.meta.url),
  'utf8',
);

function setupRemoteShapedCrawlerDb(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_url TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      description TEXT,
      homepage TEXT,
      primary_language TEXT,
      license_spdx TEXT,
      stars INTEGER,
      last_pushed_at TEXT,
      is_archived INTEGER,
      is_fork INTEGER,
      sloc INTEGER,
      file_count INTEGER,
      mean_ccn REAL,
      has_ci INTEGER,
      has_tests INTEGER,
      test_framework TEXT,
      seniority_band TEXT,
      detected_domain TEXT,
      domain_confidence REAL,
      pr_quality_score REAL,
      contamination_risk REAL,
      detected_stack_json TEXT,
      pass INTEGER,
      disqualified INTEGER,
      disqualified_reason TEXT,
      crawled_at TEXT,
      refreshed_at TEXT,
      open_pr_count INTEGER,
      open_feature_issue_count INTEGER,
      business_logic_ratio REAL,
      cross_module_change_rate REAL,
      admin_status TEXT,
      admin_reason TEXT,
      readme_excerpt TEXT,
      root_tree_json TEXT
    );
    CREATE TABLE repo_sample_prs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,
      pr_number INTEGER NOT NULL,
      pr_url TEXT NOT NULL,
      title TEXT,
      merged_at TEXT,
      resolves_issue_number INTEGER,
      changed_file_count INTEGER,
      modifies_tests INTEGER DEFAULT 0,
      additions INTEGER,
      deletions INTEGER,
      construct_slugs_json TEXT,
      swe_bench_eligible INTEGER DEFAULT 0,
      changed_file_paths_json TEXT,
      pr_narrative TEXT,
      pr_narrative_embedding_json TEXT,
      pr_narrative_version TEXT,
      UNIQUE(repo_id, pr_number)
    );
    INSERT INTO qualified_repos (id, github_url, full_name)
    VALUES
      (4130, 'https://github.com/mui/base-ui', 'mui/base-ui'),
      (2883, 'https://github.com/cloudflare/workers-sdk', 'cloudflare/workers-sdk'),
      (9001, 'https://github.com/vercel/swr', 'vercel/swr');
  `);
  return sqlite;
}

describe('seed-live-review-packet-input.sql', () => {
  let sqlite: BetterSqliteDb | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('attaches seeded sample PR rows to the crawler-owned repo ids', () => {
    sqlite = setupRemoteShapedCrawlerDb();

    expect(() => sqlite?.exec(seedSql)).not.toThrow();

    const rows = sqlite.prepare(`
      SELECT qr.full_name, rsp.repo_id, rsp.pr_number
        FROM repo_sample_prs rsp
        JOIN qualified_repos qr ON qr.id = rsp.repo_id
       ORDER BY qr.full_name, rsp.pr_number
    `).all() as Array<{ full_name: string; repo_id: number; pr_number: number }>;

    expect(rows).toEqual([
      { full_name: 'cloudflare/workers-sdk', repo_id: 2883, pr_number: 14118 },
      { full_name: 'cloudflare/workers-sdk', repo_id: 2883, pr_number: 14150 },
      { full_name: 'cloudflare/workers-sdk', repo_id: 2883, pr_number: 14435 },
      { full_name: 'mui/base-ui', repo_id: 4130, pr_number: 973 },
      { full_name: 'mui/base-ui', repo_id: 4130, pr_number: 5095 },
      { full_name: 'mui/base-ui', repo_id: 4130, pr_number: 5110 },
      { full_name: 'vercel/swr', repo_id: 9001, pr_number: 4212 },
      { full_name: 'vercel/swr', repo_id: 9001, pr_number: 4271 },
    ]);
  });

  it('does not collide when a legacy hardcoded seed id belongs to another repo', () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE qualified_repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        github_url TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        description TEXT,
        homepage TEXT,
        primary_language TEXT,
        license_spdx TEXT,
        stars INTEGER,
        last_pushed_at TEXT,
        is_archived INTEGER,
        is_fork INTEGER,
        sloc INTEGER,
        file_count INTEGER,
        mean_ccn REAL,
        has_ci INTEGER,
        has_tests INTEGER,
        test_framework TEXT,
        seniority_band TEXT,
        detected_domain TEXT,
        domain_confidence REAL,
        pr_quality_score REAL,
        contamination_risk REAL,
        detected_stack_json TEXT,
        pass INTEGER,
        disqualified INTEGER,
        disqualified_reason TEXT,
        crawled_at TEXT,
        refreshed_at TEXT,
        open_pr_count INTEGER,
        open_feature_issue_count INTEGER,
        business_logic_ratio REAL,
        cross_module_change_rate REAL,
        admin_status TEXT,
        admin_reason TEXT,
        readme_excerpt TEXT,
        root_tree_json TEXT
      );
      CREATE TABLE repo_sample_prs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,
        pr_number INTEGER NOT NULL,
        pr_url TEXT NOT NULL,
        title TEXT,
        merged_at TEXT,
        resolves_issue_number INTEGER,
        changed_file_count INTEGER,
        modifies_tests INTEGER DEFAULT 0,
        additions INTEGER,
        deletions INTEGER,
        construct_slugs_json TEXT,
        swe_bench_eligible INTEGER DEFAULT 0,
        changed_file_paths_json TEXT,
        pr_narrative TEXT,
        pr_narrative_embedding_json TEXT,
        pr_narrative_version TEXT,
        UNIQUE(repo_id, pr_number)
      );
      INSERT INTO qualified_repos (id, github_url, full_name)
      VALUES (4271, 'https://github.com/premieroctet/next-admin', 'premieroctet/next-admin');
    `);

    expect(() => sqlite?.exec(seedSql)).not.toThrow();

    const swr = sqlite.prepare(`
      SELECT id, full_name
        FROM qualified_repos
       WHERE github_url = 'https://github.com/vercel/swr'
    `).get() as { id: number; full_name: string };
    expect(swr.full_name).toBe('vercel/swr');
    expect(swr.id).not.toBe(4271);
    expect(
      sqlite.prepare('SELECT full_name FROM qualified_repos WHERE id = 4271').get(),
    ).toEqual({ full_name: 'premieroctet/next-admin' });
  });
});
