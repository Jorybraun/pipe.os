/**
 * Pass 3 — post-batch audit.
 *
 * Runs at the end of a Pass 3 batch (or any time the operator wants a
 * sanity check). JOINs `repo_engineering_signals` against `qualified_repos`
 * and prints one row per written signal — repo_id, real full_name from the
 * join, real sloc + file_count, narrative length, model, timestamp.
 *
 * Catches two classes of problem:
 *   1. Orphan signal rows (LEFT JOIN shows NULL full_name) — indicates a
 *      row was written for a repo that no longer exists in qualified_repos.
 *   2. Visual cross-check — the operator eyeballs the full_name column to
 *      confirm the batch wrote signals for the repos they expected.
 *
 * A validator in TS cannot tell whether "ionic-framework" is the right
 * answer for repo ID 10 — that's a human judgment call. This tool surfaces
 * the data so the human can make it in two seconds instead of writing a
 * cross-check query themselves.
 */

import { D1Client, loadD1Config } from '../shared/d1Client.js';

export interface AuditRow {
  repo_id: number;
  full_name: string | null;
  actual_sloc: number | null;
  actual_file_count: number | null;
  signals_version: string;
  content_hash: string;
  narrative_len: number;
  model_used: string;
  generated_at: string;
}

export async function auditSignals(
  db: D1Client,
  sinceIso: string | null,
): Promise<AuditRow[]> {
  const params: (string | number | null)[] = [];
  const where = sinceIso ? 'WHERE res.generated_at >= ?' : '';
  if (sinceIso) params.push(sinceIso);

  const sql = `
    SELECT
      res.repo_id            AS repo_id,
      qr.full_name           AS full_name,
      qr.sloc                AS actual_sloc,
      qr.file_count          AS actual_file_count,
      res.signals_version    AS signals_version,
      res.content_hash       AS content_hash,
      LENGTH(res.engineering_narrative) AS narrative_len,
      res.model_used         AS model_used,
      res.generated_at       AS generated_at
    FROM repo_engineering_signals res
    LEFT JOIN qualified_repos qr ON qr.id = res.repo_id
    ${where}
    ORDER BY res.generated_at DESC, res.repo_id
  `;

  return db.query<AuditRow>(sql, params);
}

export interface SignalDetail {
  repo_id: number;
  full_name: string | null;
  signals_version: string;
  content_hash: string;
  model_used: string;
  generated_at: string;
  engineering_narrative: string;
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  complexity_band: string | null;
  swe_bench_eligibility_rate: number | null;
  architecture_style: string | null;
  review_density: number | null;
  commit_cadence: number | null;
  satd_density: number | null;
  signal_json: string;
}

export async function fetchSignalDetail(
  db: D1Client,
  repoId: number,
): Promise<SignalDetail | null> {
  const rows = await db.query<SignalDetail>(
    `
      SELECT
        res.repo_id,
        qr.full_name,
        res.signals_version,
        res.content_hash,
        res.model_used,
        res.generated_at,
        res.engineering_narrative,
        res.test_touch_rate,
        res.mean_changed_files,
        res.p90_changed_files,
        res.issue_link_rate,
        res.complexity_band,
        res.swe_bench_eligibility_rate,
        res.architecture_style,
        res.review_density,
        res.commit_cadence,
        res.satd_density,
        res.signal_json
      FROM repo_engineering_signals res
      LEFT JOIN qualified_repos qr ON qr.id = res.repo_id
      WHERE res.repo_id = ?
    `,
    [repoId],
  );
  return rows[0] ?? null;
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

interface CliOpts {
  since: string | null;
  format: 'table' | 'json';
  repoId: number | null;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { since: null, format: 'table', repoId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') {
      opts.since = argv[++i] ?? null;
    } else if (a === '--json') {
      opts.format = 'json';
    } else if (a === '--repo-id') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--repo-id expects a positive integer, got "${argv[i]}"`);
      }
      opts.repoId = n;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: tsx scripts/crawl-repos/pass3/audit.ts [--since ISO] [--repo-id N] [--json]\n' +
          '  (no flags)     — batch summary table of every signals row\n' +
          '  --since ISO    — limit to rows generated at/after the ISO timestamp\n' +
          '  --repo-id N    — print the full narrative + structured signals for one repo\n' +
          '  --json         — emit JSON instead of the human-readable table\n',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

function formatDetail(detail: SignalDetail): string {
  const lines: string[] = [];
  lines.push(`═══ Pass 3 signals — repo_id=${detail.repo_id} ${detail.full_name ?? '(orphan)'} ═══`);
  lines.push('');
  lines.push(`signals_version: ${detail.signals_version}`);
  lines.push(`content_hash:    ${detail.content_hash}`);
  lines.push(`model_used:      ${detail.model_used}`);
  lines.push(`generated_at:    ${detail.generated_at}`);
  lines.push('');
  lines.push('─── Tier 1 + Tier 2 structured signals ───');
  lines.push(`test_touch_rate:            ${detail.test_touch_rate ?? 'null'}`);
  lines.push(`mean_changed_files:         ${detail.mean_changed_files ?? 'null'}`);
  lines.push(`p90_changed_files:          ${detail.p90_changed_files ?? 'null'}`);
  lines.push(`issue_link_rate:            ${detail.issue_link_rate ?? 'null'}`);
  lines.push(`complexity_band:            ${detail.complexity_band ?? 'null'}`);
  lines.push(`swe_bench_eligibility_rate: ${detail.swe_bench_eligibility_rate ?? 'null'}`);
  lines.push(`architecture_style:         ${detail.architecture_style ?? 'null'}`);
  lines.push(`review_density:             ${detail.review_density ?? 'null'}`);
  lines.push(`commit_cadence:             ${detail.commit_cadence ?? 'null'}`);
  lines.push(`satd_density:               ${detail.satd_density ?? 'null'}`);
  lines.push('');
  lines.push('─── engineering_narrative ───');
  lines.push('');
  lines.push(detail.engineering_narrative);
  lines.push('');
  return lines.join('\n');
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  if (s.length >= width) return s.slice(-width);
  return ' '.repeat(width - s.length) + s;
}

function formatTable(rows: AuditRow[]): string {
  if (rows.length === 0) return '[pass3/audit] No rows found.\n';

  const lines: string[] = [];
  const orphans = rows.filter((r) => r.full_name === null);
  const valid = rows.filter((r) => r.full_name !== null);

  if (orphans.length > 0) {
    lines.push(
      `[pass3/audit] ⚠️  ${orphans.length} orphan signals rows (no matching qualified_repos):`,
    );
    for (const o of orphans) {
      lines.push(
        `  repo_id=${o.repo_id} signals_version=${o.signals_version} generated_at=${o.generated_at}`,
      );
    }
    lines.push('');
  }

  lines.push(`[pass3/audit] ${valid.length} valid rows:`);
  lines.push('');
  lines.push(
    `${pad('repo_id', 7)} | ${pad('full_name', 41)} | ${pad('sloc', 8)} | ${pad('files', 6)} | ${pad('narr', 5)} | ${pad('model', 30)} | ${pad('generated_at', 19)}`,
  );
  lines.push(
    `${'-'.repeat(7)}-+-${'-'.repeat(41)}-+-${'-'.repeat(8)}-+-${'-'.repeat(6)}-+-${'-'.repeat(5)}-+-${'-'.repeat(30)}-+-${'-'.repeat(19)}`,
  );
  for (const r of valid) {
    lines.push(
      `${padLeft(String(r.repo_id), 7)} | ${pad(r.full_name ?? '', 41)} | ${padLeft(String(r.actual_sloc ?? '?'), 8)} | ${padLeft(String(r.actual_file_count ?? '?'), 6)} | ${padLeft(String(r.narrative_len), 5)} | ${pad(r.model_used, 30)} | ${pad(r.generated_at.replace('T', ' ').slice(0, 19), 19)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const db = new D1Client(loadD1Config());

  if (opts.repoId !== null) {
    const detail = await fetchSignalDetail(db, opts.repoId);
    if (!detail) {
      process.stderr.write(
        `[pass3/audit] no repo_engineering_signals row for repo_id=${opts.repoId}\n`,
      );
      process.exit(2);
    }
    if (opts.format === 'json') {
      process.stdout.write(JSON.stringify(detail, null, 2) + '\n');
    } else {
      process.stdout.write(formatDetail(detail));
    }
    return;
  }

  const rows = await auditSignals(db, opts.since);

  if (opts.format === 'json') {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else {
    process.stdout.write(formatTable(rows));
  }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error('[pass3/audit] failed:', err);
    process.exit(1);
  });
}
