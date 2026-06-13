/**
 * Tool definitions and executors for the Global Copilot Agent.
 *
 * Tools are executed server-side by the Worker. The agent requests tool calls
 * via <tool_call> blocks in its response; the orchestrator parses and executes.
 *
 * Reuses existing infrastructure:
 * - librariesIo.ts for repo search
 * - qualityFilter.ts for GitHub quality checks
 * - fetchGitHubDiff.ts for PR diff fetching
 */

import type { LLMTool } from './llm/types';
import { fetchDependentRepos } from './repoDiscovery/librariesIo';
import { checkRepoQuality } from './repoDiscovery/qualityFilter';
import { fetchGitHubDiff } from './fetchGitHubDiff';

// ─── Tool definitions ───────────────────────────────────────────────────────

const GENERAL_TOOLS: LLMTool[] = [
  {
    name: 'lookup_pipeline',
    description: 'Query the database for pipeline details including stages, challenges, and role persona.',
    parameters: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'string', description: 'The pipeline ID to look up' },
      },
      required: ['pipeline_id'],
    },
  },
  {
    name: 'explain_repo_for_role',
    description: 'Explain why a specific repo is or isn\'t a good fit for a given role context. Reads the cached repo_role_alignment row and returns the structured per-signal reasoning. Never gates a repo as \'disqualified\' — explain fit, do not gate. The recruiter decides.',
    parameters: {
      type: 'object',
      properties: {
        repo_id: { type: 'string', description: 'Numeric repo_id from qualified_repos' },
        role_context_id: { type: 'string', description: 'The role_context_id to look up alignment for' },
      },
      required: ['repo_id', 'role_context_id'],
    },
  },
];

const CHALLENGE_DESIGN_TOOLS: LLMTool[] = [
  ...GENERAL_TOOLS,
  {
    name: 'search_repos',
    description: 'Search for open-source repos that match specific technologies/skills. Uses Libraries.io to find repos that depend on the given packages. Returns top repos by stars.',
    parameters: {
      type: 'object',
      properties: {
        skills: {
          type: 'string',
          description: 'Comma-separated list of skills/technologies to search for (e.g. "React, TypeScript, Node.js")',
        },
        max_results: {
          type: 'string',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['skills'],
    },
  },
  {
    name: 'fetch_repo_info',
    description: 'Get detailed information about a GitHub repo including README, stats, language, license, topics, and whether it has CI.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'GitHub repo owner (e.g. "vercel")' },
        repo: { type: 'string', description: 'GitHub repo name (e.g. "next.js")' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'list_repo_prs',
    description: 'List recent merged pull requests from a GitHub repo, with size and file info. Useful for finding good PRs to use as code review challenges.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'GitHub repo owner' },
        repo: { type: 'string', description: 'GitHub repo name' },
        max_results: { type: 'string', description: 'Max PRs to return (default: 10)' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'fetch_pr_diff',
    description: 'Fetch the full diff of a specific PR. Returns file-by-file changes with additions/deletions. Use this to evaluate whether a PR would make a good code review challenge.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'GitHub repo owner' },
        repo: { type: 'string', description: 'GitHub repo name' },
        pr_number: { type: 'string', description: 'Pull request number' },
      },
      required: ['owner', 'repo', 'pr_number'],
    },
  },
  {
    name: 'save_challenge_draft',
    description: 'Create a CODE_REVIEW challenge template from a PR. Saves as a draft in the challenge library for the recruiter to review and refine.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'GitHub repo owner' },
        repo: { type: 'string', description: 'GitHub repo name' },
        pr_number: { type: 'string', description: 'Pull request number' },
        title: { type: 'string', description: 'Challenge title' },
        difficulty: { type: 'string', description: 'JUNIOR, MID, or SENIOR' },
        primary_skill: { type: 'string', description: 'Primary skill tested (e.g. "React")' },
      },
      required: ['owner', 'repo', 'pr_number', 'title'],
    },
  },
];

/** Get the tool set for a given skill mode. */
export function getToolsForMode(mode: string): LLMTool[] {
  switch (mode) {
    case 'challenge_design':
      return CHALLENGE_DESIGN_TOOLS;
    default:
      return GENERAL_TOOLS;
  }
}

// ─── Tool execution ─────────────────────────────────────────────────────────

export interface ToolExecContext {
  db: D1Database;
  ownerId: string;
  githubToken?: string;
  librariesIoApiKey?: string;
}

interface ToolCallInput {
  name: string;
  arguments: Record<string, unknown>;
}

export async function executeTool(
  call: ToolCallInput,
  ctx: ToolExecContext,
): Promise<string> {
  const args = call.arguments as Record<string, string>;

  switch (call.name) {
    case 'lookup_pipeline':
      return executeLookupPipeline(args.pipeline_id ?? '', ctx.db);

    case 'search_repos':
      return executeSearchRepos(args.skills ?? '', parseInt(args.max_results ?? '5', 10), ctx);

    case 'fetch_repo_info':
      return executeFetchRepoInfo(args.owner ?? '', args.repo ?? '', ctx.githubToken);

    case 'list_repo_prs':
      return executeListRepoPRs(args.owner ?? '', args.repo ?? '', parseInt(args.max_results ?? '10', 10), ctx.githubToken);

    case 'fetch_pr_diff':
      return executeFetchPRDiff(args.owner ?? '', args.repo ?? '', parseInt(args.pr_number ?? '0', 10), ctx.githubToken);

    case 'save_challenge_draft':
      return executeSaveChallengeDraft(args, ctx);

    case 'explain_repo_for_role':
      return executeExplainRepoForRole(args.repo_id ?? '', args.role_context_id ?? '', ctx.db);

    default:
      return `[Unknown tool: ${call.name}]`;
  }
}

// ─── Tool implementations ───────────────────────────────────────────────────

async function executeLookupPipeline(pipelineId: string, db: D1Database): Promise<string> {
  const pipeline = await db.prepare(
    `SELECT id, title, level, stack, description FROM pipelines WHERE id = ?1`,
  ).bind(pipelineId).first<Record<string, string | null>>();

  if (!pipeline) return `[Pipeline ${pipelineId} not found]`;

  const { results: stages } = await db.prepare(
    `SELECT s.id, s.title, s.stage_type, COUNT(c.id) as challenge_count
     FROM stages s LEFT JOIN challenges c ON c.stage_id = s.id
     WHERE s.pipeline_id = ?1 GROUP BY s.id ORDER BY s.sort_order`,
  ).bind(pipelineId).all<Record<string, string | number | null>>();

  return JSON.stringify({ pipeline, stages: stages ?? [] }, null, 2);
}

async function executeSearchRepos(
  skillsStr: string,
  maxResults: number,
  ctx: ToolExecContext,
): Promise<string> {
  if (!ctx.librariesIoApiKey) {
    return '[Error: LIBRARIES_IO_API_KEY not configured. Cannot search repos.]';
  }

  const skills = skillsStr.split(',').map((s) => s.trim()).filter(Boolean);

  // Use the first skill as a direct search term for Libraries.io
  const searchTerm = skills[0] ?? '';
  if (!searchTerm) {
    return '[Error: No valid search term provided]';
  }

  // Search for npm packages by name (most common case)
  const depRepos = await fetchDependentRepos(ctx.librariesIoApiKey, 'npm', searchTerm, { maxPages: 1 });
  const results: Array<Record<string, unknown>> = [];

  for (const repo of depRepos.repos.slice(0, maxResults)) {
    if (!results.some((r) => r.full_name === repo.full_name)) {
      results.push({
        full_name: repo.full_name,
        stars: repo.stars_count,
        language: repo.language,
        description: repo.description?.slice(0, 120),
      });
    }
  }

  // Sort by stars and limit
  results.sort((a, b) => ((b.stars as number) ?? 0) - ((a.stars as number) ?? 0));

  return JSON.stringify({
    queried_term: searchTerm,
    repos: results.slice(0, maxResults),
  }, null, 2);
}

async function executeFetchRepoInfo(
  owner: string,
  repo: string,
  githubToken?: string,
): Promise<string> {
  const quality = await checkRepoQuality(owner, repo, githubToken);

  if (!quality.repo) {
    return `[Error: Could not fetch repo ${owner}/${repo}. ${quality.failures.join(', ')}]`;
  }

  // Also fetch README
  let readme = '';
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers });
    if (res.ok) {
      const data = (await res.json()) as { content?: string; encoding?: string };
      if (data.content && data.encoding === 'base64') {
        readme = atob(data.content).slice(0, 1500);
      }
    }
  } catch { /* README fetch is best-effort */ }

  return JSON.stringify({
    ...quality.repo,
    qualityPassed: quality.passed,
    qualityFailures: quality.failures,
    readme: readme || '(no README available)',
  }, null, 2);
}

async function executeListRepoPRs(
  owner: string,
  repo: string,
  maxResults: number,
  githubToken?: string,
): Promise<string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${maxResults}`,
    { headers },
  );

  if (!response.ok) return `[Error: GitHub API ${response.status}]`;

  const prs = (await response.json()) as Array<{
    number: number;
    title: string;
    merged_at: string | null;
    changed_files: number;
    additions: number;
    deletions: number;
  }>;

  const merged = prs
    .filter((pr) => pr.merged_at !== null)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      merged_at: pr.merged_at,
      changed_files: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      total_changes: pr.additions + pr.deletions,
    }));

  return JSON.stringify({
    total_merged: merged.length,
    prs: merged,
    recommendation: merged.find((pr) => pr.changed_files >= 3 && pr.changed_files <= 20 && pr.total_changes >= 50 && pr.total_changes <= 1000)
      ? 'PRs with 3-20 files and 50-1000 total changes work best for code review challenges.'
      : 'Consider repos with more moderate-sized PRs for better challenge quality.',
  }, null, 2);
}

async function executeFetchPRDiff(
  owner: string,
  repo: string,
  prNumber: number,
  githubToken?: string,
): Promise<string> {
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const result = await fetchGitHubDiff(repoUrl, prNumber, githubToken);

  if (!result) return `[Error: Could not fetch PR #${prNumber} from ${owner}/${repo}]`;

  // Summarize the diff (full diff can be huge)
  const summary = {
    title: result.metadata.title,
    description: result.metadata.description?.slice(0, 300),
    author: result.metadata.author,
    base: result.metadata.base,
    head: result.metadata.head,
    files_changed: result.diff.files.length,
    files: result.diff.files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
  };

  return JSON.stringify(summary, null, 2);
}

async function executeExplainRepoForRole(
  repoIdStr: string,
  roleContextId: string,
  db: D1Database,
): Promise<string> {
  const repoId = parseInt(repoIdStr, 10);
  if (!repoId || !roleContextId) {
    return '[Error: repo_id and role_context_id are required]';
  }

  const alignment = await db.prepare(
    `SELECT alignment_score, alignment_band, reasoning_json, per_signal_scores,
            rcd_version, signals_version, generated_at, model_used
     FROM repo_role_alignment
     WHERE role_context_id = ?1 AND repo_id = ?2`,
  ).bind(roleContextId, repoId).first<Record<string, string | number | null>>();

  if (!alignment) {
    return JSON.stringify({
      status: 'no_alignment',
      message: `No fit assessment cached for repo ${repoId} against role ${roleContextId}. Run discovery on this role first to populate the alignment cache.`,
    }, null, 2);
  }

  const repo = await db.prepare(
    `SELECT id, full_name, github_url, primary_language FROM qualified_repos WHERE id = ?1`,
  ).bind(repoId).first<Record<string, string | number | null>>();

  // Parse JSON columns; fall back to raw on parse error so the tool doesn't crash
  let reasoning: unknown = alignment.reasoning_json;
  let perSignal: unknown = alignment.per_signal_scores;
  try { reasoning = JSON.parse(alignment.reasoning_json as string); } catch { /* keep raw */ }
  try { perSignal = JSON.parse(alignment.per_signal_scores as string); } catch { /* keep raw */ }

  return JSON.stringify({
    repo: repo ?? { id: repoId },
    alignment_score: alignment.alignment_score,
    alignment_band: alignment.alignment_band,
    reasoning,
    per_signal_scores: perSignal,
    cache_keys: {
      rcd_version: alignment.rcd_version,
      signals_version: alignment.signals_version,
    },
    provenance: {
      generated_at: alignment.generated_at,
      model_used: alignment.model_used,
    },
    note: 'This is a fit assessment, not a gate. The recruiter decides whether to use this repo.',
  }, null, 2);
}

async function executeSaveChallengeDraft(
  args: Record<string, string>,
  ctx: ToolExecContext,
): Promise<string> {
  const { owner, repo, pr_number, title, difficulty, primary_skill } = args;
  const prNum = parseInt(pr_number ?? '0', 10);

  if (!owner || !repo || !prNum) {
    return '[Error: owner, repo, and pr_number are required]';
  }

  // Fetch the PR diff
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const diffResult = await fetchGitHubDiff(repoUrl, prNum, ctx.githubToken);

  if (!diffResult) return `[Error: Could not fetch PR #${prNum} from ${owner}/${repo}]`;

  const config = JSON.stringify({
    repoUrl,
    prNumber: prNum,
    prTitle: diffResult.metadata.title,
    prDescription: diffResult.metadata.description,
    language: primary_skill ?? 'TypeScript',
    diff: diffResult.diff.files,
  });

  const serverConfig = JSON.stringify({
    groundTruth: [],
    repoOwner: owner,
    repoName: repo,
  });

  const now = new Date().toISOString();

  const result = await ctx.db.prepare(`
    INSERT INTO challenge_templates (
      type, title, instructions, difficulty, primary_skill,
      config, server_config, source, is_published,
      created_by, created_at, updated_at
    ) VALUES (
      'CODE_REVIEW', ?1, ?2, ?3, ?4,
      ?5, ?6, 'AI_GENERATED', 0,
      ?7, ?8, ?8
    )
    RETURNING id
  `).bind(
    (title || `Review: ${diffResult.metadata.title}`).slice(0, 200),
    `Review this pull request from ${owner}/${repo}. Identify bugs, design issues, and suggest improvements.`,
    difficulty ?? 'MID',
    primary_skill ?? 'TypeScript',
    config,
    serverConfig,
    ctx.ownerId,
    now,
  ).first<{ id: string }>();

  if (!result) return '[Error: Failed to create challenge template]';

  return JSON.stringify({
    success: true,
    challengeTemplateId: result.id,
    title: title || `Review: ${diffResult.metadata.title}`,
    filesInDiff: diffResult.diff.files.length,
    message: `Challenge draft created! The recruiter can find it in MY_CHALLENGES tab.`,
  }, null, 2);
}
