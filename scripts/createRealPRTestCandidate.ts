/**
 * createRealPRTestCandidate.ts
 *
 * Creates a CODE_REVIEW challenge from a REAL GitHub PR (Jorybraun/challenge PR #1).
 * Fetches the diff directly from the GitHub API using GITHUB_TOKEN from .env.local,
 * parses it into cachedDiffJson format (same parser as the fetchGitHubPR Lambda),
 * then creates a Pipeline + Stage + Challenge + Candidate.
 *
 * Usage:
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=secret npx tsx scripts/createRealPRTestCandidate.ts
 *
 * Output: playwright/real-pr-token.json
 */

import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { signIn, signOut } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Load .env and .env.local for GITHUB_TOKEN and other secrets
dotenv.config({ path: join(process.cwd(), '.env') });
dotenv.config({ path: join(process.cwd(), '.env.local') });

const outputs = JSON.parse(readFileSync(join(process.cwd(), 'amplify_outputs.json'), 'utf8')) as unknown;
Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0]);

const client = generateClient<Schema>();

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiffLine {
  type: 'addition' | 'deletion' | 'context';
  lineNumber: number;
  content: string;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface GitHubPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

// ─── Diff parser (same logic as fetchGitHubPR Lambda) ─────────────────────────

function parsePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = patch.split('\n');
  let currentHunk: DiffHunk | null = null;
  let newLineNum = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        newLineNum = parseInt(match[1]!, 10);
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
      }
    } else if (currentHunk) {
      if (line.startsWith('\\')) continue;
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'addition', lineNumber: newLineNum, content: line.slice(1) });
        newLineNum++;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'deletion', lineNumber: newLineNum, content: line.slice(1) });
        // Don't increment for deletions
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', lineNumber: newLineNum, content: line.slice(1) });
        newLineNum++;
      }
    }
  }

  return hunks;
}

// ─── Files to include (skip package-lock, node_modules, markdown docs) ────────

const SKIP_PATTERNS = [
  /package-lock\.json$/,
  /node_modules/,
  /\.md$/,
];

function shouldInclude(filename: string): boolean {
  return !SKIP_PATTERNS.some((p) => p.test(filename));
}

// ─── Fetch PR from GitHub ──────────────────────────────────────────────────────

async function fetchPRFiles(owner: string, repo: string, prNumber: number): Promise<{
  files: DiffFile[];
  prTitle: string;
  prDescription: string;
  metadata: Record<string, unknown>;
}> {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) throw new Error('GITHUB_TOKEN not found in environment');

  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  // Fetch PR metadata
  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, { headers });
  if (!prRes.ok) throw new Error(`GitHub PR fetch failed: ${prRes.status}`);
  const pr = await prRes.json() as Record<string, unknown>;

  // Fetch PR files
  const filesRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
    { headers }
  );
  if (!filesRes.ok) throw new Error(`GitHub files fetch failed: ${filesRes.status}`);
  const rawFiles = await filesRes.json() as GitHubPRFile[];

  const files: DiffFile[] = rawFiles
    .filter((f) => shouldInclude(f.filename) && f.patch)
    .map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      hunks: parsePatch(f.patch ?? ''),
    }));

  const headBranch = (pr['head'] as Record<string, unknown>)?.['ref'] as string ?? '';
  const baseBranch = (pr['base'] as Record<string, unknown>)?.['ref'] as string ?? 'main';
  const author = (pr['user'] as Record<string, unknown>)?.['login'] as string ?? '';

  const metadata = {
    prNumber,
    branch: headBranch,
    base: baseBranch,
    author,
    additions: rawFiles.reduce((s, f) => s + f.additions, 0),
    deletions: rawFiles.reduce((s, f) => s + f.deletions, 0),
    filesChanged: rawFiles.length,
    state: pr['state'] as string,
  };

  return {
    files,
    prTitle: pr['title'] as string,
    prDescription: pr['body'] as string ?? '',
    metadata,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const username = process.env['E2E_EMAIL'];
  const password = process.env['E2E_PASSWORD'];

  if (!username || !password) {
    console.error('E2E_EMAIL and E2E_PASSWORD env vars are required');
    process.exit(1);
  }

  console.log('[createRealPRTestCandidate] Fetching PR diff from GitHub...');
  const { files, prTitle, prDescription, metadata } = await fetchPRFiles('Jorybraun', 'challenge', 1);
  console.log(`[createRealPRTestCandidate] Got ${files.length} source files`);
  files.forEach((f) => console.log(`  ${f.status}: ${f.path} (+${f.additions} -${f.deletions})`));

  const cachedDiffJson = JSON.stringify({ files });

  await signIn({ username, password });
  console.log('[createRealPRTestCandidate] Signed in');

  try {
    // Pipeline
    const { data: pipeline, errors: pe } = await client.models.Pipeline.create({
      title: 'Real PR Code Review Pipeline',
      status: 'ACTIVE',
      creationMode: 'BLANK',
    });
    if (pe) throw new Error(pe[0].message);
    if (!pipeline) throw new Error('Pipeline creation returned null');
    console.log('[createRealPRTestCandidate] Pipeline:', pipeline.id);

    // Stage
    const { data: stage, errors: se } = await client.models.Stage.create({
      pipelineId: pipeline.id,
      title: 'Code Review Stage',
      order: 0,
    });
    if (se) throw new Error(se[0].message);
    if (!stage) throw new Error('Stage creation returned null');
    console.log('[createRealPRTestCandidate] Stage:', stage.id);

    // Challenge with real GitHub PR diff
    const { data: challenge, errors: ce } = await client.models.Challenge.create({
      stageId: stage.id,
      type: 'CODE_REVIEW',
      title: prTitle,
      instructions:
        'Review this pull request. Identify any bugs, design issues, missing error handling, ' +
        'or code quality concerns. Select a verdict and provide a summary of your findings.',
      order: 0,
      githubRepoUrl: 'https://github.com/Jorybraun/challenge',
      githubPrNumber: 1,
      githubPrTitle: prTitle,
      githubPrDescription: prDescription.slice(0, 1000),
      cachedDiffJson,
      cachedMetadata: JSON.stringify(metadata),
      config: JSON.stringify({ version: 1 }),
      serverConfig: JSON.stringify({
        groundTruth: [
          {
            line: 1,
            type: 'missing_error_handling',
            severity: 'major',
            explanation: 'API endpoints lack proper error handling and input validation',
          },
        ],
      }),
    });
    if (ce) throw new Error(ce[0].message);
    if (!challenge) throw new Error('Challenge creation returned null');
    console.log('[createRealPRTestCandidate] Challenge:', challenge.id);

    // Candidate
    const inviteToken = `real-pr-${uuidv4().slice(0, 8)}`;
    const { data: candidate, errors: kce } = await client.models.Candidate.create({
      pipelineId: pipeline.id,
      name: 'Real PR Test Candidate',
      email: `real-pr-${Date.now()}@example.com`,
      inviteToken,
      status: 'INVITED',
    });
    if (kce) throw new Error(kce[0].message);
    if (!candidate) throw new Error('Candidate creation returned null');
    console.log('[createRealPRTestCandidate] Candidate:', candidate.id);

    const output = {
      token: candidate.inviteToken ?? inviteToken,
      candidateId: candidate.id,
      pipelineId: pipeline.id,
      challengeId: challenge.id,
      prTitle,
      sourceFiles: files.map((f) => f.path),
    };

    writeFileSync(
      join(process.cwd(), 'playwright/real-pr-token.json'),
      JSON.stringify(output, null, 2)
    );

    console.log('\n[createRealPRTestCandidate] ✓ Done!');
    console.log(`Token: ${output.token}`);
    console.log(`URL:   http://localhost:5173/assess/${output.token}`);
    console.log('Written to playwright/real-pr-token.json');
  } finally {
    await signOut();
  }
}

main().catch((err: unknown) => {
  console.error('[createRealPRTestCandidate] Fatal error:', err);
  process.exit(1);
});
