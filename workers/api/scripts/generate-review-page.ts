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

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
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

function htmlEsc(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function gemmaText(pass3: RepoReviewData['pass3']): { narrative: string; profile: string } {
  if (!pass3?.raw_gemma_attempt1) return { narrative: '', profile: '' };
  try {
    const parsed = JSON.parse(pass3.raw_gemma_attempt1) as Record<string, unknown>;
    return {
      narrative: typeof parsed.engineering_narrative === 'string' ? parsed.engineering_narrative : '',
      profile: typeof parsed.repo_searchable_profile === 'string' ? parsed.repo_searchable_profile : '',
    };
  } catch {
    return { narrative: '', profile: '' };
  }
}

function renderRbtn(repoId: number, field: string, value: string, label: string): string {
  return '<label class="rbtn">'
    + '<input type="radio" name="' + repoId + '-' + field + '" value="' + value + '"'
    + ' data-repoid="' + repoId + '" data-field="' + field + '">'
    + label
    + '</label>';
}

function buildCard(row: RepoReviewData): string {
  const { repo, pass1, pass2, pass3, sonnet } = row;
  const id = repo.repo_id;
  const { narrative } = gemmaText(pass3);

  // PRs
  const prs = (repo.sample_prs ?? []).slice(0, 12);
  const prHtml = prs.map((pr) => {
    const testTag = pr.modifies_tests ? '<span class="badge badge-green pr-chip">test</span>' : '';
    const issueTag = pr.resolves_issue_number ? '<span class="badge badge-blue pr-chip">issue</span>' : '';
    return '<div class="pr-row">'
      + '<span class="pr-num">#' + pr.pr_number + '</span>'
      + '<span class="pr-title">' + htmlEsc(pr.title ?? '(no title)') + '</span>'
      + '<span class="pr-badges">' + testTag + issueTag + '</span>'
      + '<span class="pr-files">' + pr.changed_file_count + ' files</span>'
      + '</div>';
  }).join('');

  // Pipeline debug data
  const p1Rec = pass1?.recommendation ?? null;
  const p2Qual = pass2?.signal_quality ?? null;
  const p3pipe = pass3?.pipeline;
  const p3valid = p3pipe?.validation_attempt1;
  const p3judge = p3pipe?.judge_attempt1;
  const p3gem = p3pipe?.gemma_attempt1;
  const p3ValidStr = !p3valid ? '—' : p3valid.valid ? 'pass' : 'fail';
  const p3MistralStr = !p3judge ? 'skipped' : p3judge.approved ? 'approved' : 'denied';
  const sonnetStr = !sonnet ? '—' : sonnet.approved ? 'approved' : 'denied';
  const wordInfo = p3gem ? (p3gem.narrative_words + 'w narr / ' + p3gem.profile_words + 'w prof') : '—';
  const featureIssues = repo.open_feature_issue_count ?? 0;
  const p1concerns = (pass1?.concerns ?? []).map((c) => '<li>' + htmlEsc(c) + '</li>').join('');
  const p2issues = (pass2?.issues ?? []).map((i) => '<li>' + htmlEsc(i) + '</li>').join('');

  return '<div class="card" id="card-' + id + '" data-id="' + id + '">'

    // ── Card top ──
    + '<div class="card-top">'
    + '<div>'
    + '<div class="repo-name">'
    + '<a href="https://github.com/' + htmlEsc(repo.full_name) + '" target="_blank" rel="noopener">' + htmlEsc(repo.full_name) + '</a>'
    + '</div>'
    + '<div class="repo-meta">'
    + '<span class="meta-star">&#9733; ' + fmtNum(repo.stars) + '</span>'
    + '<span>' + htmlEsc(repo.primary_language) + '</span>'
    + (repo.detected_domain ? '<span>' + htmlEsc(repo.detected_domain) + '</span>' : '')
    + '<span>SLOC ' + fmtNum(repo.sloc) + '</span>'
    + (featureIssues > 0 ? '<span class="feat-issues">' + featureIssues + ' feature issues</span>' : '')
    + '</div>'
    + '</div>'
    + '<div class="card-badges">'
    + '<span class="badge badge-outline" id="dec-badge-' + id + '">undecided</span>'
    + '<span class="badge badge-outline" id="fit-badge-' + id + '">code review</span>'
    + '<span class="badge badge-outline" id="tier-badge-' + id + '">standard</span>'
    + '</div>'
    + '</div>'

    // ── Card body ──
    + '<div class="card-body">'

    // About (Gemma narrative)
    + '<div class="section">'
    + '<div class="sec-label">About this repo</div>'
    + (narrative
      ? '<div class="about-text">' + htmlEsc(narrative) + '</div>'
      : '<div class="no-desc">No AI description available (validation failed during calibration — re-run to generate)</div>')
    + '</div>'

    // Pull requests
    + (prs.length
      ? '<div class="section">'
        + '<div class="sec-label">Recent pull requests'
        + (repo.sample_prs.length > prs.length ? ' (' + prs.length + ' of ' + repo.sample_prs.length + ')' : '')
        + '</div>'
        + '<div class="pr-list">' + prHtml + '</div>'
        + (featureIssues > 0
          ? '<div class="feature-issue-line"><span class="feature-issue-count">' + featureIssues + '</span> open feature issues — suitable for implementation challenge</div>'
          : '')
        + '</div>'
      : '')

    // Your decision
    + '<div class="section">'
    + '<div class="sec-label">Your decision</div>'
    + '<div class="decision-grid">'
    + '<div class="decision-col">'
    + '<div class="decision-col-label">Include in database?</div>'
    + '<div class="radio-group">'
    + renderRbtn(id, 'decision', 'approve', 'Approve')
    + renderRbtn(id, 'decision', 'skip', 'Skip')
    + renderRbtn(id, 'decision', 'undecided', 'Undecided')
    + '</div>'
    + '</div>'
    + '</div>'

    // Approved-only: challenge fit + tier
    + '<div class="approved-opts hidden" id="approved-opts-' + id + '">'
    + '<div class="decision-col">'
    + '<div class="decision-col-label">Challenge type</div>'
    + '<div class="radio-group">'
    + renderRbtn(id, 'fit', 'code_review', 'Code review')
    + renderRbtn(id, 'fit', 'feature_impl', 'Feature impl')
    + renderRbtn(id, 'fit', 'both', 'Both')
    + '</div>'
    + '</div>'
    + '<div class="decision-col">'
    + '<div class="decision-col-label">Tier</div>'
    + '<div class="radio-group">'
    + renderRbtn(id, 'tier', 'premium', 'Premium')
    + renderRbtn(id, 'tier', 'standard', 'Standard')
    + '</div>'
    + '</div>'
    + '</div>'

    // Notes
    + '<div class="notes-wrap">'
    + '<div class="notes-label">Notes</div>'
    + '<textarea class="notes-ta" data-repoid="' + id + '" placeholder="Why approve or skip? What challenge type would work best? Any concerns..."></textarea>'
    + '</div>'
    + '</div>' // section: your decision

    // Pipeline details (collapsed)
    + '<div class="section">'
    + '<button class="debug-toggle" id="debug-btn-' + id + '" onclick="toggleDebug(' + id + ')">&#9658; Pipeline details</button>'
    + '<div class="debug-body" id="debug-' + id + '">'
    + '<div class="debug-row"><span class="debug-key">Pass 1</span><span>' + htmlEsc(p1Rec ?? '—') + '</span></div>'
    + (p1concerns ? '<ul class="debug-issues">' + p1concerns + '</ul>' : '')
    + (pass1?.reasoning ? '<div class="debug-row"><span class="debug-key"></span><span style="color:var(--text3);font-style:italic">' + htmlEsc(pass1.reasoning) + '</span></div>' : '')
    + '<div class="debug-row"><span class="debug-key">Pass 2</span><span>' + htmlEsc(p2Qual ?? '—') + '</span></div>'
    + (p2issues ? '<ul class="debug-issues">' + p2issues + '</ul>' : '')
    + (pass2?.reasoning ? '<div class="debug-row"><span class="debug-key"></span><span style="color:var(--text3);font-style:italic">' + htmlEsc(pass2.reasoning) + '</span></div>' : '')
    + '<div class="debug-row"><span class="debug-key">P3 Validate</span><span>' + p3ValidStr + '</span></div>'
    + (p3valid?.failures?.length ? '<ul class="debug-issues">' + p3valid.failures.map((f) => '<li>' + htmlEsc(f) + '</li>').join('') + '</ul>' : '')
    + '<div class="debug-row"><span class="debug-key">P3 Words</span><span>' + wordInfo + '</span></div>'
    + '<div class="debug-row"><span class="debug-key">P3 Mistral</span><span>' + p3MistralStr + '</span></div>'
    + (p3judge?.failures?.length ? '<ul class="debug-issues">' + p3judge.failures.map((f) => '<li>' + htmlEsc(f) + '</li>').join('') + '</ul>' : '')
    + '<div class="debug-row"><span class="debug-key">P3 Sonnet</span><span>' + sonnetStr + (sonnet ? (' &mdash; '
      + (sonnet.constraint_pass ? '&#10003;' : '&#10007;') + ' constraint '
      + (sonnet.accuracy_pass ? '&#10003;' : '&#10007;') + ' accuracy '
      + (sonnet.architecture_pass ? '&#10003;' : '&#10007;') + ' arch '
      + (sonnet.completeness_pass ? '&#10003;' : '&#10007;') + ' complete'
    ) : '') + '</span></div>'
    + '</div>'
    + '</div>'

    + '</div>' // card-body
    + '</div>'; // card
}

function generateHtml(rows: RepoReviewData[], runDirName: string): string {
  const dataJson = JSON.stringify(rows);
  const cardsHtml = rows.map(buildCard).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Repo Review — ${runDirName}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0c0e;--surface:#111214;--surface2:#18191f;
  --border:#242530;--border2:#363743;
  --text:#dde0ee;--text2:#8890a8;--text3:#50546a;
  --green:#4ade80;--red:#f87171;--amber:#fbbf24;--blue:#60a5fa;--purple:#a78bfa;
  --font:'Space Mono','Courier New',monospace;
}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:13px;line-height:1.7}
a{color:var(--blue);text-decoration:none}
a:hover{text-decoration:underline}

/* sticky header */
.topbar{position:sticky;top:0;z-index:50;background:rgba(12,12,14,.96);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--border);padding:10px 24px;display:flex;align-items:center;gap:16px}
.topbar-title{font-size:13px;font-weight:700;flex:1}
.topbar-sub{font-size:10px;color:var(--text3)}
.tally{display:flex;gap:20px}
.tally-item{display:flex;flex-direction:column;align-items:center;gap:1px}
.tally-num{font-size:18px;font-weight:700}
.tally-label{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.07em}
.export-btn{background:var(--blue);color:#000;border:none;padding:8px 18px;
  font-family:var(--font);font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.05em}
.export-btn:hover{background:#93c5fd}

/* filter */
.filters{padding:8px 24px;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.filter-label{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-right:4px}
.fchip{background:none;border:1px solid var(--border);color:var(--text2);font-family:var(--font);
  font-size:10px;padding:3px 12px;cursor:pointer}
.fchip:hover{border-color:var(--border2)}
.fchip.on{border-color:var(--blue);color:var(--blue)}

/* page layout */
.page{max-width:920px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:20px}

/* card */
.card{background:var(--surface);border:1px solid var(--border);overflow:hidden}
.card.hidden{display:none}

/* card top bar */
.card-top{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.repo-name{font-size:16px;font-weight:700;flex:1}
.repo-meta{font-size:11px;color:var(--text2);display:flex;gap:12px;flex-wrap:wrap;margin-top:4px}
.meta-star{color:var(--amber)}
.feat-issues{color:var(--green)}
.card-badges{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap}

/* badges */
.badge{display:inline-block;padding:2px 9px;font-size:10px;font-weight:700;letter-spacing:.04em;white-space:nowrap;border:1px solid}
.badge-green{background:rgba(74,222,128,.1);color:var(--green);border-color:rgba(74,222,128,.3)}
.badge-red{background:rgba(248,113,113,.1);color:var(--red);border-color:rgba(248,113,113,.3)}
.badge-amber{background:rgba(251,191,36,.1);color:var(--amber);border-color:rgba(251,191,36,.3)}
.badge-blue{background:rgba(96,165,250,.1);color:var(--blue);border-color:rgba(96,165,250,.3)}
.badge-purple{background:rgba(167,139,250,.1);color:var(--purple);border-color:rgba(167,139,250,.3)}
.badge-outline{background:none;color:var(--text3);border-color:var(--border)}

/* sections */
.card-body{padding:0}
.section{padding:16px 20px;border-bottom:1px solid var(--border)}
.section:last-child{border-bottom:none}
.sec-label{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px}

/* about */
.about-text{color:var(--text2);font-size:12px;line-height:1.8;white-space:pre-wrap;word-break:break-word}
.no-desc{color:var(--text3);font-size:11px;font-style:italic}

/* pr list */
.pr-list{display:flex;flex-direction:column;gap:4px}
.pr-row{display:flex;align-items:center;gap:8px;font-size:11px}
.pr-num{color:var(--text3);width:38px;flex-shrink:0;font-size:10px}
.pr-title{color:var(--text2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr-badges{display:flex;gap:4px;flex-shrink:0}
.pr-chip{font-size:9px;padding:1px 5px}
.pr-files{color:var(--text3);font-size:10px;width:56px;text-align:right;flex-shrink:0}
.feature-issue-line{margin-top:10px;font-size:11px;color:var(--text2)}
.feature-issue-count{color:var(--green);font-weight:700}

/* decision */
.decision-grid{display:flex;gap:20px;flex-wrap:wrap}
.decision-col{display:flex;flex-direction:column;gap:8px}
.decision-col-label{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.1em}
.radio-group{display:flex;gap:6px;flex-wrap:wrap}
.rbtn{display:flex;align-items:center;gap:5px;cursor:pointer;
  border:1px solid var(--border);padding:5px 14px;font-family:var(--font);font-size:11px;color:var(--text2)}
.rbtn:hover{border-color:var(--border2)}
.rbtn input{accent-color:var(--blue)}
.rbtn.sel-approve{border-color:rgba(74,222,128,.5);color:var(--green);background:rgba(74,222,128,.05)}
.rbtn.sel-skip{border-color:rgba(248,113,113,.5);color:var(--red);background:rgba(248,113,113,.05)}
.rbtn.sel-undecided{border-color:rgba(251,191,36,.4);color:var(--amber)}
.rbtn.sel-code_review{border-color:rgba(96,165,250,.5);color:var(--blue)}
.rbtn.sel-feature_impl{border-color:rgba(74,222,128,.5);color:var(--green)}
.rbtn.sel-both{border-color:rgba(167,139,250,.5);color:var(--purple)}
.rbtn.sel-premium{border-color:rgba(167,139,250,.5);color:var(--purple)}
.rbtn.sel-standard{border-color:var(--border2);color:var(--text2)}

/* approved-only options — hidden when not approved */
.approved-opts{margin-top:14px;padding-top:14px;border-top:1px solid var(--border);
  display:flex;gap:20px;flex-wrap:wrap}
.approved-opts.hidden{display:none}

/* notes */
.notes-wrap{margin-top:14px}
.notes-label{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
.notes-ta{width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);
  font-family:var(--font);font-size:12px;padding:10px;resize:vertical;min-height:96px;line-height:1.6}
.notes-ta:focus{outline:none;border-color:var(--blue)}
.notes-ta::placeholder{color:var(--text3)}

/* pipeline details */
.debug-toggle{background:none;border:none;color:var(--text3);font-family:var(--font);font-size:10px;cursor:pointer;padding:0}
.debug-toggle:hover{color:var(--text2)}
.debug-body{display:none;margin-top:10px;background:var(--surface2);border:1px solid var(--border);padding:12px;font-size:10px;color:var(--text2)}
.debug-body.open{display:block}
.debug-row{display:flex;gap:8px;margin-bottom:4px;align-items:baseline;flex-wrap:wrap}
.debug-key{color:var(--text3);width:90px;flex-shrink:0}
.debug-issues{margin-top:4px;padding-left:12px;list-style:none}
.debug-issues li::before{content:"• ";color:var(--text3)}
.debug-issues li{margin-bottom:2px}

/* modal */
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:var(--surface);border:1px solid var(--border2);padding:20px;width:100%;max-width:640px;max-height:80vh;display:flex;flex-direction:column;gap:12px}
.modal-title{font-size:13px;font-weight:700}
.modal-pre{flex:1;background:var(--bg);border:1px solid var(--border);padding:12px;
  font-size:10px;color:var(--text2);overflow:auto;white-space:pre;max-height:380px}
.modal-actions{display:flex;gap:8px}
.mbtn{background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:11px;padding:7px 16px;cursor:pointer}
.mbtn:hover{border-color:var(--border2)}
.mbtn-primary{background:var(--blue);border-color:var(--blue);color:#000;font-weight:700}
.mbtn-primary:hover{background:#93c5fd}
.mbtn-close{margin-left:auto}

::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--border2)}
</style>
</head>
<body>

<div class="topbar">
  <div>
    <div class="topbar-title">Pipe Repo Review</div>
    <div class="topbar-sub">${runDirName}</div>
  </div>
  <div class="tally" id="tally"></div>
  <button class="export-btn" onclick="openModal()">Export decisions</button>
</div>

<div class="filters">
  <span class="filter-label">Show:</span>
  <button class="fchip on" data-f="all" onclick="setFilter(this)">All (${rows.length})</button>
  <button class="fchip" data-f="approve" onclick="setFilter(this)">Approved</button>
  <button class="fchip" data-f="skip" onclick="setFilter(this)">Skipped</button>
  <button class="fchip" data-f="undecided" onclick="setFilter(this)">Undecided</button>
  <button class="fchip" data-f="feature_impl" onclick="setFilter(this)">Feature impl</button>
  <button class="fchip" data-f="both" onclick="setFilter(this)">Both types</button>
</div>

<div class="page" id="page">
${cardsHtml}
</div>

<div class="modal-bg" id="modal-bg" onclick="bgClick(event)">
  <div class="modal">
    <div class="modal-title">human-decisions.json</div>
    <pre class="modal-pre" id="modal-pre"></pre>
    <div class="modal-actions">
      <button class="mbtn mbtn-primary" onclick="download()">Download</button>
      <button class="mbtn" onclick="copyJson()">Copy</button>
      <button class="mbtn mbtn-close" onclick="closeModal()">Close</button>
    </div>
  </div>
</div>

<script>
const RUN_DIR = ${JSON.stringify(runDirName)};
const ROWS = ${dataJson};
const LS = "pipe-review-" + RUN_DIR;

// ── state ──────────────────────────────────────────────────────────────────
function defaultState(row) {
  if (!row || !row.repo) return { decision: "undecided", fit: "code_review", tier: "standard", notes: "" };
  const p1 = row.pass1 ? row.pass1.recommendation : null;
  const p2 = row.pass2 ? row.pass2.signal_quality : null;
  const sonnetOk = row.sonnet ? row.sonnet.approved : false;
  const featureIssues = row.repo.open_feature_issue_count || 0;
  const hasPrs = row.repo.sample_prs && row.repo.sample_prs.length >= 3;
  const goodPrs = (row.repo.pr_quality_score || 0) >= 0.4;

  let decision = "undecided";
  if (p1 === "deny-list") decision = "skip";
  else if (p1 === "keep" && (p2 === "good" || p2 === "suspect")) decision = "approve";

  let fit = "code_review";
  if (featureIssues > 0 && hasPrs && goodPrs) fit = "both";
  else if (featureIssues > 0) fit = "feature_impl";

  let tier = "standard";
  if (p1 === "keep" && p2 === "good" && sonnetOk) tier = "premium";

  return { decision: decision, fit: fit, tier: tier, notes: "" };
}

let state = (function () {
  const saved = localStorage.getItem(LS);
  if (saved) { try { return JSON.parse(saved); } catch {} }
  const s = {};
  for (const row of ROWS) { s[row.repo.repo_id] = defaultState(row); }
  return s;
})();

function save() {
  localStorage.setItem(LS, JSON.stringify(state));
  renderTally();
}

// ── tally ───────────────────────────────────────────────────────────────────
function renderTally() {
  let approved = 0, skipped = 0, undecided = 0;
  for (const row of ROWS) {
    const d = (state[row.repo.repo_id] || {}).decision;
    if (d === "approve") approved++;
    else if (d === "skip") skipped++;
    else undecided++;
  }
  document.getElementById("tally").innerHTML =
    tItem(approved, "approved", "color:var(--green)") +
    tItem(skipped, "skipped", "color:var(--red)") +
    tItem(undecided, "undecided", "color:var(--amber)");
}
function tItem(n, label, style) {
  return "<div class=\\"tally-item\\"><span class=\\"tally-num\\" style=\\"" + style + "\\">" + n +
    "</span><span class=\\"tally-label\\">" + label + "</span></div>";
}

// ── filter ──────────────────────────────────────────────────────────────────
let activeFilter = "all";
function setFilter(btn) {
  activeFilter = btn.dataset.f;
  document.querySelectorAll(".fchip").forEach(function (b) { b.classList.remove("on"); });
  btn.classList.add("on");
  document.querySelectorAll(".card").forEach(function (card) {
    const id = Number(card.dataset.id);
    const s = state[id] || {};
    let show = true;
    if (activeFilter === "approve") show = s.decision === "approve";
    else if (activeFilter === "skip") show = s.decision === "skip";
    else if (activeFilter === "undecided") show = s.decision === "undecided";
    else if (activeFilter === "feature_impl") show = s.fit === "feature_impl" || s.fit === "both";
    else if (activeFilter === "both") show = s.fit === "both";
    card.classList.toggle("hidden", !show);
  });
}

// ── radio interactions ───────────────────────────────────────────────────────
document.addEventListener("change", function (e) {
  const t = e.target;
  if (!t || t.type !== "radio" || !t.dataset.repoid) return;
  const id = Number(t.dataset.repoid);
  const field = t.dataset.field;
  const val = t.value;
  if (!state[id]) state[id] = defaultState(ROWS.find(function (r) { return r.repo.repo_id === id; }));
  state[id][field] = val;
  save();
  refreshCard(id);
});

document.addEventListener("input", function (e) {
  const t = e.target;
  if (!t || !t.classList.contains("notes-ta")) return;
  const id = Number(t.dataset.repoid);
  if (!state[id]) return;
  state[id].notes = t.value;
  save();
});

function refreshCard(id) {
  const s = state[id] || {};
  const card = document.getElementById("card-" + id);
  if (!card) return;

  card.dataset.decision = s.decision;
  card.dataset.fit = s.fit;

  // decision badge
  const decBadge = document.getElementById("dec-badge-" + id);
  if (decBadge) {
    if (s.decision === "approve") { decBadge.className = "badge badge-green"; decBadge.textContent = "approved"; }
    else if (s.decision === "skip") { decBadge.className = "badge badge-red"; decBadge.textContent = "skipped"; }
    else { decBadge.className = "badge badge-outline"; decBadge.textContent = "undecided"; }
  }

  // fit badge
  const fitBadge = document.getElementById("fit-badge-" + id);
  if (fitBadge) {
    const fitLabel = { code_review: "code review", feature_impl: "feature impl", both: "both" };
    const fitCls = { code_review: "badge-blue", feature_impl: "badge-green", both: "badge-purple" };
    fitBadge.className = "badge " + (fitCls[s.fit] || "badge-outline");
    fitBadge.textContent = fitLabel[s.fit] || s.fit || "code review";
  }

  // tier badge
  const tierBadge = document.getElementById("tier-badge-" + id);
  if (tierBadge) {
    tierBadge.className = "badge " + (s.tier === "premium" ? "badge-purple" : "badge-outline");
    tierBadge.textContent = s.tier || "standard";
  }

  // show/hide approved-only options
  const approvedOpts = document.getElementById("approved-opts-" + id);
  if (approvedOpts) {
    approvedOpts.classList.toggle("hidden", s.decision !== "approve");
  }

  // radio label highlights
  ["decision", "fit", "tier"].forEach(function (field) {
    document.querySelectorAll("[data-repoid=\\"" + id + "\\"][data-field=\\"" + field + "\\"]").forEach(function (radio) {
      const lbl = radio.closest(".rbtn");
      if (!lbl) return;
      const isSel = radio.value === s[field];
      lbl.className = "rbtn" + (isSel ? " sel-" + radio.value : "");
    });
  });

  // sync notes textarea from saved state (on page load)
  const ta = document.querySelector(".notes-ta[data-repoid=\\"" + id + "\\"]");
  if (ta && ta.value !== (s.notes || "")) ta.value = s.notes || "";

  // re-apply filter
  if (activeFilter !== "all") {
    const show =
      activeFilter === "approve" ? s.decision === "approve" :
      activeFilter === "skip" ? s.decision === "skip" :
      activeFilter === "undecided" ? s.decision === "undecided" :
      activeFilter === "feature_impl" ? (s.fit === "feature_impl" || s.fit === "both") :
      activeFilter === "both" ? s.fit === "both" : true;
    card.classList.toggle("hidden", !show);
  }
}

// ── collapse ─────────────────────────────────────────────────────────────────
function toggleDebug(id) {
  const el = document.getElementById("debug-" + id);
  const btn = document.getElementById("debug-btn-" + id);
  if (!el || !btn) return;
  el.classList.toggle("open");
  btn.textContent = el.classList.contains("open") ? "\\u25BC Pipeline details" : "\\u25BA Pipeline details";
}

// ── export ───────────────────────────────────────────────────────────────────
function buildJson() {
  const repos = ROWS.map(function (row) {
    const id = row.repo.repo_id;
    const s = state[id] || defaultState(row);
    return {
      repo_id: id,
      full_name: row.repo.full_name,
      decision: s.decision,
      challenge_fit: s.fit,
      tier: s.tier,
      notes: s.notes || null,
    };
  });
  return JSON.stringify({ source_run_dir: RUN_DIR, generated_at: new Date().toISOString(), repos: repos }, null, 2);
}

function openModal() {
  document.getElementById("modal-pre").textContent = buildJson();
  document.getElementById("modal-bg").classList.add("open");
}
function closeModal() { document.getElementById("modal-bg").classList.remove("open"); }
function bgClick(e) { if (e.target === document.getElementById("modal-bg")) closeModal(); }
function download() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([buildJson()], { type: "application/json" }));
  a.download = "human-decisions.json";
  a.click();
}
function copyJson() {
  navigator.clipboard.writeText(buildJson());
  const btn = event.target;
  const orig = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(function () { btn.textContent = orig; }, 1500);
}

// ── init ──────────────────────────────────────────────────────────────────────
(function init() {
  renderTally();
  for (const row of ROWS) { refreshCard(row.repo.repo_id); }
})();
</script>
</body>
</html>`;
}

main();
