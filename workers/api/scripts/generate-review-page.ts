#!/usr/bin/env tsx
/**
 * Generate a self-contained HTML review page for a calibration pipeline run.
 *
 * Reads per-repo data from pass1-eval/, pass2-eval/, pass3/, pass3/sonnet/
 * and repos.json, then produces an interactive {run-dir}/review.html where
 * a human can override decisions, assign tiers, and add notes before the
 * next calibration starts.
 *
 * Usage:
 *   npx tsx scripts/generate-review-page.ts --run-dir <path>
 *   npx tsx scripts/generate-review-page.ts --run-dir <path> --pass3-dir <path>
 *
 * The --pass3-dir flag handles the case where calibrate-pass3.ts wrote its
 * fixtures to a separate timestamp directory (early pipeline runs). Omit it
 * if pass3/ lives directly inside --run-dir (the new default).
 *
 * Output:
 *   {run-dir}/review.html
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Types ─────────────────────────────────────────────────────────────────

interface SamplePR {
  pr_number: number;
  title: string | null;
  changed_file_count: number;
  modifies_tests: 0 | 1;
  resolves_issue_number: number | null;
  swe_bench_eligible: 0 | 1;
}

interface RepoInput {
  repo_id: number;
  full_name: string;
  primary_language: string;
  stars: number;
  sloc: number | null;
  file_count: number | null;
  mean_ccn: number | null;
  seniority_band: string | null;
  has_ci: 0 | 1;
  has_tests: 0 | 1;
  test_framework: string | null;
  detected_domain: string | null;
  detected_stack_json: string | null;
  pr_quality_score: number;
  open_pr_count: number | null;
  open_feature_issue_count: number | null;
  business_logic_ratio: number | null;
  cross_module_change_rate: number | null;
  constructs: Array<{ slug: string; evidence_count: number }>;
  sample_prs: SamplePR[];
}

interface Pass1Eval {
  repo_id: number;
  full_name: string;
  suitable: boolean;
  recommendation: 'keep' | 'deny-list' | 'investigate';
  concerns: string[];
  reasoning: string;
}

interface Pass2Eval {
  repo_id: number;
  full_name: string;
  signal_quality: 'good' | 'suspect' | 'bad';
  issues: string[];
  reasoning: string;
}

interface Pass3Fixture {
  repo_id: number;
  full_name: string;
  pipeline: {
    gemma_attempt1: {
      success: boolean;
      parse_success: boolean;
      narrative_words: number;
      profile_words: number;
    } | null;
    validation_attempt1: {
      valid: boolean;
      failures: string[];
      warnings: string[];
    } | null;
    judge_attempt1: {
      approved: boolean;
      failures: string[];
      reasoning: string;
    } | null;
    final_status: string;
  };
  input_fingerprint: {
    repo_id: number;
    full_name: string;
    primary_language: string;
    stars: number;
    has_tests: boolean;
    detected_domain: string;
  };
  raw_gemma_attempt1: string;
}

interface SonnetEval {
  repo_id: number;
  full_name: string;
  provider: string;
  constraint_pass: boolean;
  accuracy_pass: boolean;
  architecture_pass: boolean;
  completeness_pass: boolean;
  approved: boolean;
  failures: string[];
  reasoning: string;
}

interface RepoReviewData {
  repo: RepoInput;
  pass1: Pass1Eval | null;
  pass2: Pass2Eval | null;
  pass3: Pass3Fixture | null;
  sonnet: SonnetEval | null;
}

// ─── File reading helpers ──────────────────────────────────────────────────

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function readDirJson<T>(dir: string): Map<number, T & { repo_id: number }> {
  const map = new Map<number, T & { repo_id: number }>();
  if (!existsSync(dir)) return map;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const data = readJsonFile<T & { repo_id: number }>(join(dir, file));
    if (data?.repo_id) map.set(data.repo_id, data);
  }
  return map;
}

// ─── CLI args ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { runDir: string; pass3Dir: string } {
  let runDir = '';
  let pass3DirOverride = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run-dir') runDir = argv[++i] ?? '';
    if (argv[i] === '--pass3-dir') pass3DirOverride = argv[++i] ?? '';
  }
  if (!runDir) {
    console.error('Usage: npx tsx scripts/generate-review-page.ts --run-dir <path> [--pass3-dir <path>]');
    process.exit(1);
  }
  const resolved = resolve(__dirname, '..', runDir);
  const pass3Dir = pass3DirOverride
    ? resolve(__dirname, '..', pass3DirOverride)
    : join(resolved, 'pass3');
  return { runDir: resolved, pass3Dir };
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  const { runDir, pass3Dir } = parseArgs(process.argv.slice(2));

  // Read repos
  const repos = readJsonFile<RepoInput[]>(join(runDir, 'repos.json')) ?? [];
  if (repos.length === 0) {
    console.error(`No repos.json found at ${runDir}`);
    process.exit(1);
  }

  // Read eval maps
  const pass1Map = readDirJson<Pass1Eval>(join(runDir, 'pass1-eval'));
  const pass2Map = readDirJson<Pass2Eval>(join(runDir, 'pass2-eval'));
  const pass3Map = readDirJson<Pass3Fixture>(pass3Dir);
  const sonnetMap = readDirJson<SonnetEval>(join(pass3Dir, 'sonnet'));

  // Aggregate
  const rows: RepoReviewData[] = repos.map((repo) => ({
    repo,
    pass1: pass1Map.get(repo.repo_id) ?? null,
    pass2: pass2Map.get(repo.repo_id) ?? null,
    pass3: pass3Map.get(repo.repo_id) ?? null,
    sonnet: sonnetMap.get(repo.repo_id) ?? null,
  }));

  // Generate HTML
  const runDirName = basename(runDir);
  const html = generateHtml(rows, runDirName);

  // Write
  const outPath = join(runDir, 'review.html');
  writeFileSync(outPath, html, 'utf-8');
  console.log(`Review page written to: ${outPath}`);
  console.log(`Open in browser: open "${outPath}"`);
}

// ─── HTML generation ──────────────────────────────────────────────────────

function generateHtml(rows: RepoReviewData[], runDirName: string): string {
  const dataJson = JSON.stringify(rows);
  const runTimestamp = runDirName;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pipeline Review — ${runTimestamp}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0c0c0e;
    --surface: #13141a;
    --surface2: #1a1b22;
    --border: #2a2b35;
    --border2: #3a3b45;
    --text: #e8e9f0;
    --text2: #8889a0;
    --text3: #5a5b6a;
    --accent: #60a5fa;
    --green: #4ade80;
    --amber: #fbbf24;
    --red: #f87171;
    --purple: #a78bfa;
    --font: 'Space Mono', 'Courier New', monospace;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 12px; line-height: 1.6; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Header */
  .header { position: sticky; top: 0; z-index: 100; background: rgba(12,12,14,0.96); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center; gap: 16px; }
  .header-title { font-size: 13px; font-weight: 700; color: var(--text); flex: 1; }
  .header-sub { font-size: 11px; color: var(--text2); }
  .stat-bar { display: flex; gap: 16px; }
  .stat { display: flex; flex-direction: column; align-items: center; }
  .stat-val { font-size: 16px; font-weight: 700; }
  .stat-label { font-size: 10px; color: var(--text2); }
  .export-btn { background: var(--accent); color: #000; border: none; padding: 8px 16px; font-family: var(--font); font-size: 11px; font-weight: 700; cursor: pointer; letter-spacing: 0.05em; }
  .export-btn:hover { background: #93c5fd; }

  /* Filter bar */
  .filter-bar { padding: 8px 20px; border-bottom: 1px solid var(--border); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .filter-label { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; }
  .filter-chip { background: var(--surface); border: 1px solid var(--border); color: var(--text2); padding: 3px 10px; font-size: 10px; font-family: var(--font); cursor: pointer; }
  .filter-chip.active { border-color: var(--accent); color: var(--accent); }

  /* Main grid */
  .main { padding: 20px; display: flex; flex-direction: column; gap: 16px; max-width: 1200px; }

  /* Repo card */
  .card { background: var(--surface); border: 1px solid var(--border); padding: 0; }
  .card.hidden { display: none; }
  .card-header { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .card-name { font-size: 14px; font-weight: 700; }
  .card-name a { color: var(--text); }
  .card-name a:hover { color: var(--accent); }
  .card-meta { font-size: 11px; color: var(--text2); display: flex; gap: 10px; flex-wrap: wrap; }
  .card-meta span { white-space: nowrap; }
  .card-stars { color: var(--amber); }
  .tier-badge { margin-left: auto; }

  /* Sections */
  .card-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
  .section-title { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px; }

  /* Pipeline table */
  .pipeline-table { width: 100%; border-collapse: collapse; }
  .pipeline-table td { padding: 5px 8px; border: 1px solid var(--border); vertical-align: top; }
  .pipeline-table td:first-child { width: 90px; color: var(--text2); font-size: 11px; white-space: nowrap; }
  .pipeline-table td:nth-child(2) { width: 110px; }
  .pipeline-table td:last-child { color: var(--text2); font-size: 10px; }

  /* Badges */
  .badge { display: inline-block; padding: 2px 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }
  .badge-green { background: rgba(74,222,128,0.12); color: var(--green); border: 1px solid rgba(74,222,128,0.3); }
  .badge-red { background: rgba(248,113,113,0.12); color: var(--red); border: 1px solid rgba(248,113,113,0.3); }
  .badge-amber { background: rgba(251,191,36,0.12); color: var(--amber); border: 1px solid rgba(251,191,36,0.3); }
  .badge-blue { background: rgba(96,165,250,0.12); color: var(--accent); border: 1px solid rgba(96,165,250,0.3); }
  .badge-gray { background: rgba(90,91,106,0.12); color: var(--text3); border: 1px solid var(--border); }

  /* Override radios */
  .override-group { display: flex; gap: 6px; flex-wrap: wrap; }
  .override-label { display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 2px 8px; border: 1px solid var(--border); font-size: 10px; }
  .override-label:hover { border-color: var(--border2); }
  .override-label input[type=radio] { accent-color: var(--accent); }
  .override-label.sel-keep { border-color: rgba(74,222,128,0.5); color: var(--green); }
  .override-label.sel-deny { border-color: rgba(248,113,113,0.5); color: var(--red); }
  .override-label.sel-investigate { border-color: rgba(251,191,36,0.5); color: var(--amber); }
  .override-label.sel-good { border-color: rgba(74,222,128,0.5); color: var(--green); }
  .override-label.sel-suspect { border-color: rgba(251,191,36,0.5); color: var(--amber); }
  .override-label.sel-bad { border-color: rgba(248,113,113,0.5); color: var(--red); }
  .override-label.sel-premium { border-color: rgba(167,139,250,0.5); color: var(--purple); }
  .override-label.sel-standard { border-color: rgba(96,165,250,0.5); color: var(--accent); }
  .override-label.sel-exclude { border-color: rgba(248,113,113,0.5); color: var(--red); }
  .override-label.sel-code_review { border-color: rgba(96,165,250,0.5); color: var(--accent); }
  .override-label.sel-feature_impl { border-color: rgba(74,222,128,0.5); color: var(--green); }
  .override-label.sel-both { border-color: rgba(167,139,250,0.5); color: var(--purple); }
  .override-label.sel-neither { border-color: rgba(90,91,106,0.3); color: var(--text3); }
  .badge-teal { background: rgba(74,222,128,0.12); color: var(--green); border: 1px solid rgba(74,222,128,0.3); }

  /* PR list */
  .pr-list { display: flex; flex-direction: column; gap: 3px; }
  .pr-item { display: flex; align-items: center; gap: 6px; font-size: 11px; }
  .pr-num { color: var(--text3); width: 38px; flex-shrink: 0; }
  .pr-title { color: var(--text2); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 460px; }
  .pr-chips { display: flex; gap: 4px; flex-shrink: 0; }
  .pr-chip { font-size: 9px; padding: 1px 5px; }
  .pr-files { color: var(--text3); font-size: 10px; width: 52px; text-align: right; flex-shrink: 0; }

  /* Constructs */
  .construct-list { display: flex; gap: 6px; flex-wrap: wrap; }
  .construct-tag { background: var(--surface2); border: 1px solid var(--border); color: var(--text2); padding: 2px 8px; font-size: 10px; }
  .construct-count { color: var(--text3); }

  /* Notes */
  .notes-textarea { width: 100%; background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-family: var(--font); font-size: 11px; padding: 8px; resize: vertical; min-height: 48px; }
  .notes-textarea:focus { outline: none; border-color: var(--accent); }

  /* Collapsibles */
  .collapse-btn { background: none; border: 1px solid var(--border); color: var(--text2); font-family: var(--font); font-size: 10px; padding: 3px 10px; cursor: pointer; margin-right: 6px; }
  .collapse-btn:hover { border-color: var(--border2); color: var(--text); }
  .collapse-content { display: none; margin-top: 8px; background: var(--surface2); border: 1px solid var(--border); padding: 12px; font-size: 10px; color: var(--text2); line-height: 1.7; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; }
  .collapse-content.open { display: block; }

  /* Failures list */
  .failures { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
  .failures li { font-size: 10px; color: var(--text2); padding-left: 12px; position: relative; }
  .failures li::before { content: '•'; position: absolute; left: 0; color: var(--red); }

  /* Export modal overlay */
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 200; align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--surface); border: 1px solid var(--border2); padding: 20px; max-width: 640px; width: 100%; max-height: 80vh; display: flex; flex-direction: column; gap: 12px; }
  .modal-title { font-size: 13px; font-weight: 700; }
  .modal-json { flex: 1; background: var(--bg); border: 1px solid var(--border); padding: 12px; font-family: var(--font); font-size: 10px; color: var(--text2); resize: vertical; min-height: 200px; max-height: 400px; overflow-y: auto; white-space: pre; }
  .modal-actions { display: flex; gap: 8px; }
  .btn { background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-family: var(--font); font-size: 11px; padding: 7px 16px; cursor: pointer; }
  .btn:hover { border-color: var(--border2); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #000; font-weight: 700; }
  .btn-primary:hover { background: #93c5fd; }
  .btn-close { margin-left: auto; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border2); }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="header-title">Pipe Pipeline Review</div>
    <div class="header-sub">${runTimestamp}</div>
  </div>
  <div class="stat-bar" id="stat-bar"></div>
  <button class="export-btn" onclick="openExport()">Export Decisions</button>
</div>

<div class="filter-bar">
  <span class="filter-label">Filter:</span>
  <button class="filter-chip active" data-filter="all" onclick="setFilter('all',this)">All</button>
  <button class="filter-chip" data-filter="p1-keep" onclick="setFilter('p1-keep',this)">P1 Keep</button>
  <button class="filter-chip" data-filter="p1-deny" onclick="setFilter('p1-deny',this)">P1 Deny-list</button>
  <button class="filter-chip" data-filter="p2-bad" onclick="setFilter('p2-bad',this)">P2 Bad</button>
  <button class="filter-chip" data-filter="p3-fail" onclick="setFilter('p3-fail',this)">P3 Fail</button>
  <span style="width:1px;background:var(--border);height:16px;display:inline-block;margin:0 4px"></span>
  <button class="filter-chip" data-filter="tier-premium" onclick="setFilter('tier-premium',this)">Tier: Premium</button>
  <button class="filter-chip" data-filter="tier-exclude" onclick="setFilter('tier-exclude',this)">Tier: Exclude</button>
  <button class="filter-chip" data-filter="fit-feature" onclick="setFilter('fit-feature',this)">Feature impl</button>
  <button class="filter-chip" data-filter="fit-review" onclick="setFilter('fit-review',this)">Code review</button>
  <button class="filter-chip" data-filter="fit-both" onclick="setFilter('fit-both',this)">Both</button>
</div>

<div class="main" id="cards-container"></div>

<div class="modal-overlay" id="modal-overlay" onclick="closeExport(event)">
  <div class="modal">
    <div class="modal-title">human-decisions.json</div>
    <div class="modal-json" id="modal-json"></div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="downloadDecisions()">Download JSON</button>
      <button class="btn" onclick="copyDecisions()">Copy to clipboard</button>
      <button class="btn btn-close" onclick="closeExport()">Close</button>
    </div>
  </div>
</div>

<script>
const RUN_DIR = ${JSON.stringify(runTimestamp)};
const ROWS = ${dataJson};
const LS_KEY = 'pipe-review-' + RUN_DIR;

// ─── State ─────────────────────────────────────────────────────────────────

let state = loadState();

function loadState() {
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch {}
  }
  const initial = {};
  for (const row of ROWS) {
    initial[row.repo.repo_id] = {
      pass1_override: row.pass1?.recommendation ?? null,
      pass2_override: row.pass2?.signal_quality ?? null,
      tier: inferDefaultTier(row),
      challenge_fit: inferDefaultChallengeFit(row),
      notes: '',
    };
  }
  return initial;
}

function inferDefaultTier(row) {
  const p1 = row.pass1?.recommendation;
  if (p1 === 'deny-list') return 'exclude';
  const p2 = row.pass2?.signal_quality;
  if (p2 === 'bad') return 'exclude';
  const sonnetOk = row.sonnet?.approved;
  if (p1 === 'keep' && p2 === 'good' && sonnetOk) return 'premium';
  return 'standard';
}

function inferDefaultChallengeFit(row) {
  const p1 = row.pass1?.recommendation;
  if (p1 === 'deny-list') return 'neither';
  const hasFeatureIssues = (row.repo.open_feature_issue_count ?? 0) > 0;
  const hasPrs = (row.repo.sample_prs?.length ?? 0) >= 3;
  const prQuality = (row.repo.pr_quality_score ?? 0) >= 0.4;
  if (hasFeatureIssues && hasPrs && prQuality) return 'both';
  if (hasFeatureIssues) return 'feature_impl';
  if (hasPrs && prQuality) return 'code_review';
  return 'code_review';
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  updateStatBar();
}

// ─── Render ────────────────────────────────────────────────────────────────

function pBadge(value, type) {
  if (!value) return '<span class="badge badge-gray">—</span>';
  const map = {
    keep: 'badge-green', 'deny-list': 'badge-red', investigate: 'badge-amber',
    good: 'badge-green', suspect: 'badge-amber', bad: 'badge-red',
    approved: 'badge-green', denied: 'badge-red', pass: 'badge-green', fail: 'badge-red',
    skipped: 'badge-gray',
  };
  const cls = map[value] ?? 'badge-gray';
  return '<span class="badge ' + cls + '">' + esc(value) + '</span>';
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1000) return (n/1000).toFixed(1) + 'K';
  return String(n);
}

function renderRadio(repoId, field, options) {
  const cur = state[repoId]?.[field];
  return options.map(opt => {
    const isSel = opt.value === cur;
    const selClass = isSel ? ' sel-' + opt.value.replace('-','') : '';
    return '<label class="override-label' + selClass + '" id="lbl-' + repoId + '-' + field + '-' + opt.value + '">'
      + '<input type="radio" name="' + repoId + '-' + field + '" value="' + opt.value + '"'
      + (isSel ? ' checked' : '')
      + ' onchange="onRadio(' + repoId + ',\'' + field + '\',\'' + opt.value + '\')">'
      + opt.label
      + '</label>';
  }).join('');
}

function renderCard(row) {
  const { repo, pass1, pass2, pass3, sonnet } = row;
  const id = repo.repo_id;
  const p3pipe = pass3?.pipeline;
  const p3valid = p3pipe?.validation_attempt1;
  const p3judge = p3pipe?.judge_attempt1;
  const p3gem = p3pipe?.gemma_attempt1;

  // Pipeline table rows
  const p1Rec = pass1?.recommendation ?? null;
  const p2Qual = pass2?.signal_quality ?? null;
  const p3ValidStr = !p3valid ? null : p3valid.valid ? 'pass' : 'fail';
  const p3MistralStr = !p3judge ? 'skipped' : p3judge.approved ? 'approved' : 'denied';
  const sonnetStr = !sonnet ? null : sonnet.approved ? 'approved' : 'denied';

  const p3ValidDetail = p3valid?.failures?.slice(0,2).join(' · ') ?? '';
  const p3MistralDetail = p3judge?.failures?.slice(0,2).join(' · ') ?? (p3judge ? '' : 'validate failed');
  const p3SonnetDetail = sonnet ? [
    sonnet.constraint_pass ? '' : 'constraint',
    sonnet.accuracy_pass ? '' : 'accuracy',
    sonnet.architecture_pass ? '' : 'arch',
    sonnet.completeness_pass ? '' : 'complete',
  ].filter(Boolean).join(' · ') : '';

  const wordInfo = p3gem ? (p3gem.narrative_words + 'w narr / ' + p3gem.profile_words + 'w prof') : '';

  // PRs
  const prs = (repo.sample_prs ?? []).slice(0, 12);
  const prHtml = prs.map(pr => {
    const testChip = pr.modifies_tests ? '<span class="badge badge-green pr-chip">test</span>' : '';
    const issueChip = pr.resolves_issue_number ? '<span class="badge badge-blue pr-chip">issue</span>' : '';
    const sweChip = pr.swe_bench_eligible ? '<span class="badge badge-purple pr-chip">swe</span>' : '';
    return '<div class="pr-item">'
      + '<span class="pr-num">#' + pr.pr_number + '</span>'
      + '<span class="pr-title">' + esc(pr.title ?? '(no title)') + '</span>'
      + '<span class="pr-chips">' + testChip + issueChip + sweChip + '</span>'
      + '<span class="pr-files">' + pr.changed_file_count + ' files</span>'
      + '</div>';
  }).join('');

  // Constructs
  const constructs = (repo.constructs ?? []).slice(0, 12);
  const constructHtml = constructs.map(c =>
    '<span class="construct-tag">' + esc(c.slug) + ' <span class="construct-count">(' + c.evidence_count + ')</span></span>'
  ).join('');

  // Gemma raw output
  let gemNarr = '', gemProf = '';
  if (pass3?.raw_gemma_attempt1) {
    try {
      const parsed = JSON.parse(pass3.raw_gemma_attempt1);
      gemNarr = parsed.engineering_narrative ?? '';
      gemProf = parsed.repo_searchable_profile ?? '';
    } catch { gemNarr = pass3.raw_gemma_attempt1; }
  }

  const p1Concerns = (pass1?.concerns ?? []).map(c => '<li>' + esc(c) + '</li>').join('');
  const p2Issues = (pass2?.issues ?? []).map(i => '<li>' + esc(i) + '</li>').join('');

  const tierCur = state[id]?.tier ?? 'standard';
  const tierBadgeClass = tierCur === 'premium' ? 'badge-purple' : tierCur === 'exclude' ? 'badge-red' : 'badge-blue';
  const fitCur = state[id]?.challenge_fit ?? 'code_review';
  const fitBadgeClass = fitCur === 'feature_impl' ? 'badge-teal' : fitCur === 'both' ? 'badge-purple' : fitCur === 'neither' ? 'badge-gray' : 'badge-blue';
  const fitLabel = { code_review: 'code review', feature_impl: 'feature impl', both: 'both', neither: 'neither' }[fitCur] ?? fitCur;

  return '<div class="card" id="card-' + id + '" data-repo-id="' + id + '"'
    + ' data-p1="' + (p1Rec ?? '') + '"'
    + ' data-p2="' + (p2Qual ?? '') + '"'
    + ' data-p3valid="' + (p3ValidStr ?? '') + '"'
    + ' data-tier="' + tierCur + '"'
    + ' data-fit="' + fitCur + '">'

    // Header
    + '<div class="card-header">'
    + '<div class="card-name"><a href="https://github.com/' + esc(repo.full_name) + '" target="_blank">' + esc(repo.full_name) + '</a></div>'
    + '<div class="card-meta">'
    + '<span class="card-stars">★ ' + fmtNum(repo.stars) + '</span>'
    + '<span>' + esc(repo.primary_language) + '</span>'
    + '<span>' + esc(repo.detected_domain ?? '—') + '</span>'
    + '<span>' + esc(repo.seniority_band ?? '—') + '</span>'
    + '<span>SLOC ' + fmtNum(repo.sloc) + '</span>'
    + '<span>files ' + fmtNum(repo.file_count) + '</span>'
    + (repo.pr_quality_score != null ? '<span>PRq ' + repo.pr_quality_score.toFixed(2) + '</span>' : '')
    + '</div>'
    + '<div class="tier-badge" style="display:flex;gap:6px;">'
    + '<span class="badge ' + tierBadgeClass + '" id="tier-badge-' + id + '">' + tierCur + '</span>'
    + '<span class="badge ' + fitBadgeClass + '" id="fit-badge-' + id + '">' + fitLabel + '</span>'
    + '</div>'
    + '</div>'

    // Body
    + '<div class="card-body">'

    // Pipeline decisions table
    + '<div><div class="section-title">Pipeline decisions + overrides</div>'
    + '<table class="pipeline-table">'
    + '<tr><td>Pass 1</td><td>' + pBadge(p1Rec, 'p1') + '</td><td>'
    + '<div class="override-group">' + renderRadio(id, 'pass1_override', [
        {value:'keep',label:'keep'}, {value:'deny-list',label:'deny-list'}, {value:'investigate',label:'investigate'}
      ]) + '</div>'
    + (p1Concerns ? '<ul class="failures" style="margin-top:4px">' + p1Concerns + '</ul>' : '')
    + (pass1?.reasoning ? '<div style="margin-top:4px;font-size:10px;color:var(--text3)">' + esc(pass1.reasoning) + '</div>' : '')
    + '</td></tr>'
    + '<tr><td>Pass 2</td><td>' + pBadge(p2Qual, 'p2') + '</td><td>'
    + '<div class="override-group">' + renderRadio(id, 'pass2_override', [
        {value:'good',label:'good'}, {value:'suspect',label:'suspect'}, {value:'bad',label:'bad'}
      ]) + '</div>'
    + (p2Issues ? '<ul class="failures" style="margin-top:4px">' + p2Issues + '</ul>' : '')
    + (pass2?.reasoning ? '<div style="margin-top:4px;font-size:10px;color:var(--text3)">' + esc(pass2.reasoning) + '</div>' : '')
    + '</td></tr>'
    + '<tr><td>P3 Validate</td><td>' + pBadge(p3ValidStr, 'p3') + '</td><td>'
    + (wordInfo ? '<div style="font-size:10px;color:var(--text3)">' + wordInfo + '</div>' : '')
    + (p3ValidDetail ? '<ul class="failures" style="margin-top:2px"><li>' + esc(p3ValidDetail) + '</li></ul>' : '')
    + '</td></tr>'
    + '<tr><td>P3 Mistral</td><td>' + pBadge(p3MistralStr, 'p3') + '</td><td>'
    + (p3MistralDetail ? '<span style="font-size:10px;color:var(--text3)">' + esc(p3MistralDetail) + '</span>' : '')
    + '</td></tr>'
    + '<tr><td>P3 Sonnet</td><td>' + pBadge(sonnetStr, 'p3') + '</td><td>'
    + (sonnet ? '<span style="font-size:10px;color:var(--text2)">'
        + (sonnet.constraint_pass ? '✓' : '✗') + ' constraint  '
        + (sonnet.accuracy_pass ? '✓' : '✗') + ' accuracy  '
        + (sonnet.architecture_pass ? '✓' : '✗') + ' arch  '
        + (sonnet.completeness_pass ? '✓' : '✗') + ' complete'
        + '</span>' : '<span style="font-size:10px;color:var(--text3)">no data</span>')
    + '</td></tr>'
    + '</table></div>'

    // Tier + challenge fit + notes row
    + '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">'
    + '<div><div class="section-title">Quality tier</div>'
    + '<div class="override-group">' + renderRadio(id, 'tier', [
        {value:'premium',label:'premium'}, {value:'standard',label:'standard'}, {value:'exclude',label:'exclude'}
      ]) + '</div></div>'
    + '<div><div class="section-title">Challenge fit</div>'
    + '<div class="override-group">' + renderRadio(id, 'challenge_fit', [
        {value:'code_review',label:'code review'}, {value:'feature_impl',label:'feature impl'}, {value:'both',label:'both'}, {value:'neither',label:'neither'}
      ]) + '</div>'
    + '<div style="font-size:10px;color:var(--text3);margin-top:4px">'
    + 'open issues: ' + (repo.open_feature_issue_count != null ? repo.open_feature_issue_count : '—')
    + ' · open PRs: ' + (repo.open_pr_count != null ? repo.open_pr_count : '—')
    + '</div></div>'
    + '<div style="flex:1;min-width:220px"><div class="section-title">Notes</div>'
    + '<textarea class="notes-textarea" id="notes-' + id + '" placeholder="Why is this premium? What kind of challenge would work? Override rationale…" oninput="onNotes(' + id + ',this.value)">' + esc(state[id]?.notes ?? '') + '</textarea>'
    + '</div>'
    + '</div>'

    // Sample PRs
    + (prs.length ? '<div><div class="section-title">Sample PRs (' + repo.sample_prs.length + ' total, showing first ' + prs.length + ')</div><div class="pr-list">' + prHtml + '</div></div>' : '')

    // Constructs
    + (constructs.length ? '<div><div class="section-title">Top constructs</div><div class="construct-list">' + constructHtml + '</div></div>' : '')

    // Collapsibles
    + '<div>'
    + (gemNarr ? '<button class="collapse-btn" onclick="toggleCollapse(\'narr-' + id + '\')">▶ Gemma narrative</button>' : '')
    + (gemProf ? '<button class="collapse-btn" onclick="toggleCollapse(\'prof-' + id + '\')">▶ Gemma profile</button>' : '')
    + (pass1?.reasoning ? '<button class="collapse-btn" onclick="toggleCollapse(\'p1r-' + id + '\')">▶ P1 full reasoning</button>' : '')
    + (sonnet?.reasoning ? '<button class="collapse-btn" onclick="toggleCollapse(\'s-' + id + '\')">▶ Sonnet reasoning</button>' : '')
    + (gemNarr ? '<div class="collapse-content" id="narr-' + id + '">' + esc(gemNarr) + '</div>' : '')
    + (gemProf ? '<div class="collapse-content" id="prof-' + id + '">' + esc(gemProf) + '</div>' : '')
    + (pass1?.reasoning ? '<div class="collapse-content" id="p1r-' + id + '">' + esc(pass1.reasoning) + '</div>' : '')
    + (sonnet?.reasoning ? '<div class="collapse-content" id="s-' + id + '">' + esc(sonnet.reasoning) + '</div>' : '')
    + '</div>'

    + '</div>' // card-body
    + '</div>'; // card
}

// ─── Interactions ──────────────────────────────────────────────────────────

function onRadio(repoId, field, value) {
  state[repoId] = state[repoId] ?? {};
  state[repoId][field] = value;
  saveState();
  // Re-apply selected styling to radio labels
  const options = { pass1_override: ['keep','deny-list','investigate'], pass2_override: ['good','suspect','bad'], tier: ['premium','standard','exclude'], challenge_fit: ['code_review','feature_impl','both','neither'] };
  for (const opt of (options[field] ?? [])) {
    const lbl = document.getElementById('lbl-' + repoId + '-' + field + '-' + opt);
    if (!lbl) continue;
    const sel = opt === value;
    lbl.className = 'override-label' + (sel ? ' sel-' + opt.replace('-','') : '');
  }
  // Update header badges
  if (field === 'tier') {
    const badge = document.getElementById('tier-badge-' + repoId);
    if (badge) {
      badge.textContent = value;
      badge.className = 'badge ' + (value === 'premium' ? 'badge-purple' : value === 'exclude' ? 'badge-red' : 'badge-blue');
    }
    const card = document.getElementById('card-' + repoId);
    if (card) card.dataset.tier = value;
  }
  if (field === 'challenge_fit') {
    const fitLabels = { code_review: 'code review', feature_impl: 'feature impl', both: 'both', neither: 'neither' };
    const badge = document.getElementById('fit-badge-' + repoId);
    if (badge) {
      badge.textContent = fitLabels[value] ?? value;
      badge.className = 'badge ' + (value === 'feature_impl' ? 'badge-teal' : value === 'both' ? 'badge-purple' : value === 'neither' ? 'badge-gray' : 'badge-blue');
    }
    const card = document.getElementById('card-' + repoId);
    if (card) card.dataset.fit = value;
  }
  applyFilter();
}

function onNotes(repoId, value) {
  state[repoId] = state[repoId] ?? {};
  state[repoId].notes = value;
  saveState();
}

function toggleCollapse(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('open');
  const btn = el.previousElementSibling;
  if (btn?.tagName === 'BUTTON') {
    btn.textContent = btn.textContent.replace(/^[▶▼]/, el.classList.contains('open') ? '▼' : '▶');
  }
}

// ─── Filtering ─────────────────────────────────────────────────────────────

let activeFilter = 'all';

function setFilter(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyFilter();
}

function applyFilter() {
  document.querySelectorAll('.card').forEach(card => {
    const p1 = card.dataset.p1;
    const p2 = card.dataset.p2;
    const p3 = card.dataset.p3valid;
    const tier = card.dataset.tier;
    let show = true;
    const fit = card.dataset.fit;
    if (activeFilter === 'p1-keep') show = p1 === 'keep';
    else if (activeFilter === 'p1-deny') show = p1 === 'deny-list';
    else if (activeFilter === 'p2-bad') show = p2 === 'bad';
    else if (activeFilter === 'p3-fail') show = p3 === 'fail';
    else if (activeFilter === 'tier-premium') show = tier === 'premium';
    else if (activeFilter === 'tier-exclude') show = tier === 'exclude';
    else if (activeFilter === 'fit-feature') show = fit === 'feature_impl' || fit === 'both';
    else if (activeFilter === 'fit-review') show = fit === 'code_review' || fit === 'both';
    else if (activeFilter === 'fit-both') show = fit === 'both';
    card.classList.toggle('hidden', !show);
  });
}

// ─── Stat bar ──────────────────────────────────────────────────────────────

function updateStatBar() {
  const total = ROWS.length;
  let keep = 0, deny = 0, premium = 0, exclude = 0, featureImpl = 0, both = 0;
  for (const row of ROWS) {
    const s = state[row.repo.repo_id];
    if (s?.pass1_override === 'keep') keep++;
    if (s?.pass1_override === 'deny-list') deny++;
    if (s?.tier === 'premium') premium++;
    if (s?.tier === 'exclude') exclude++;
    if (s?.challenge_fit === 'feature_impl') featureImpl++;
    if (s?.challenge_fit === 'both') both++;
  }
  const bar = document.getElementById('stat-bar');
  if (!bar) return;
  bar.innerHTML = [
    {val: total, label: 'repos', cls: ''},
    {val: keep, label: 'keep', cls: 'color:var(--green)'},
    {val: deny, label: 'deny', cls: 'color:var(--red)'},
    {val: premium, label: 'premium', cls: 'color:var(--purple)'},
    {val: featureImpl + both, label: 'feat impl', cls: 'color:var(--green)'},
    {val: exclude, label: 'exclude', cls: 'color:var(--text3)'},
  ].map(s => '<div class="stat"><span class="stat-val" style="' + s.cls + '">' + s.val + '</span><span class="stat-label">' + s.label + '</span></div>').join('');
}

// ─── Export ────────────────────────────────────────────────────────────────

function buildDecisionsJson() {
  const repos = ROWS.map(row => {
    const id = row.repo.repo_id;
    const s = state[id] ?? {};
    return {
      repo_id: id,
      full_name: row.repo.full_name,
      pass1_override: s.pass1_override ?? null,
      pass2_override: s.pass2_override ?? null,
      tier: s.tier ?? 'standard',
      challenge_fit: s.challenge_fit ?? 'code_review',
      notes: s.notes || null,
    };
  });
  return JSON.stringify({ source_run_dir: RUN_DIR, generated_at: new Date().toISOString(), repos }, null, 2);
}

function openExport() {
  document.getElementById('modal-json').textContent = buildDecisionsJson();
  document.getElementById('modal-overlay').classList.add('open');
}

function closeExport(e) {
  if (!e || e.target === document.getElementById('modal-overlay')) {
    document.getElementById('modal-overlay').classList.remove('open');
  }
}

function downloadDecisions() {
  const json = buildDecisionsJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'human-decisions.json';
  a.click();
  URL.revokeObjectURL(url);
}

function copyDecisions() {
  navigator.clipboard.writeText(buildDecisionsJson()).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

// ─── Init ──────────────────────────────────────────────────────────────────

(function init() {
  const container = document.getElementById('cards-container');
  container.innerHTML = ROWS.map(renderCard).join('');
  updateStatBar();
})();
</script>

</body>
</html>`;
}

main();
