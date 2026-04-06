/**
 * GitHub PR proxy routes — Phase 2
 *
 * GET  /api/v1/github/pulls?repoUrl=...   List open PRs for a repo
 * POST /api/v1/github/pr                  Fetch a single PR diff + metadata
 *
 * All calls are proxied server-side using GITHUB_TOKEN — the token is never
 * exposed to the frontend client.
 *
 * All routes require a valid Clerk JWT via authMiddleware.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { fetchGitHubDiff, extractRepoPath } from '../../lib/fetchGitHubDiff';
import type { RepoKnowledgeInput } from '../../lib/explainerPrompts';
import type { Env, Variables } from '../../types';

// ─── Validation ────────────────────────────────────────────────────────────────

const fetchPrSchema = z.object({
  repoUrl: z
    .string({ required_error: 'repoUrl is required' })
    .url('repoUrl must be a valid URL'),
  prNumber: z
    .number({ required_error: 'prNumber is required' })
    .int()
    .positive('prNumber must be a positive integer'),
  /** When provided, store the fetched diff + metadata on this challenge in D1. */
  challengeId: z.string().optional(),
});

// ─── Router ────────────────────────────────────────────────────────────────────

const github = new Hono<{ Bindings: Env; Variables: Variables }>();

github.use('*', authMiddleware);

/**
 * GET /api/v1/github/pulls?repoUrl=<url>&state=open
 *
 * Lists pull requests for a GitHub repository, proxied through GITHUB_TOKEN.
 *
 * Returns:
 *   200 { success: true, data: { prs: PRSummary[] } }
 *   400 missing/invalid repoUrl
 *   502 GitHub API error
 */
github.get('/pulls', async (c) => {
  const repoUrl = c.req.query('repoUrl');
  const state = c.req.query('state') ?? 'open';

  if (!repoUrl) {
    return apiError(c, 'VALIDATION_ERROR', 'repoUrl query parameter is required.');
  }

  const repoPath = extractRepoPath(repoUrl);
  if (!repoPath) {
    return apiError(c, 'VALIDATION_ERROR', 'Invalid GitHub repository URL.');
  }

  const token = (c.env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'pipe-api/1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(
    `https://api.github.com/repos/${repoPath}/pulls?state=${state}&per_page=50`,
    { headers },
  );

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') ?? '60';
    return c.json(
      { success: false, error: `GitHub rate limit exceeded. Try again in ${retryAfter} seconds.` },
      429,
    );
  }

  if (res.status === 404) {
    return c.json({ success: false, error: 'Repository not found or not accessible.' }, 404);
  }

  if (!res.ok) {
    return c.json(
      { success: false, error: `GitHub API error: ${res.status} ${res.statusText}` },
      502,
    );
  }

  interface GitHubPRItem {
    number: number;
    title: string;
    body: string | null;
    user: { login: string; avatar_url: string };
    state: string;
    draft: boolean;
    created_at: string;
    updated_at: string;
    html_url: string;
    labels: Array<{ name: string }>;
    base: { ref: string };
    head: { ref: string };
  }

  const prs = (await res.json()) as GitHubPRItem[];

  return c.json({
    success: true,
    data: {
      prs: prs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        description: pr.body ?? '',
        author: pr.user.login,
        avatar: pr.user.avatar_url,
        state: pr.state,
        draft: pr.draft,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        htmlUrl: pr.html_url,
        labels: pr.labels.map((l) => l.name),
        baseBranch: pr.base.ref,
        featureBranch: pr.head.ref,
      })),
    },
  });
});

/**
 * POST /api/v1/github/pr
 *
 * Body: { repoUrl: string; prNumber: number }
 *
 * Returns:
 *   200 { success: true, data: { diff, metadata } }
 *   400 invalid URL or body
 *   429 GitHub rate limit
 *   502 GitHub API error
 */
github.post('/pr', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = fetchPrSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { repoUrl, prNumber, challengeId } = parsed.data;

  const token = (c.env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;

  const result = await fetchGitHubDiff(repoUrl, prNumber, token);
  if (!result) {
    return c.json({ success: false, error: 'Failed to fetch PR from GitHub.' }, 502);
  }

  const { diff, metadata } = result;

  // When challengeId is provided, persist diff + metadata to D1 in the same request.
  if (challengeId) {
    try {
      await c.env.DB.prepare(
        `UPDATE challenges
         SET cached_diff_json = ?1,
             cached_metadata = ?2,
             diff_cached_at = ?3
         WHERE id = ?4`,
      )
        .bind(
          JSON.stringify(diff),
          JSON.stringify(metadata),
          new Date().toISOString(),
          challengeId,
        )
        .run();
    } catch (err) {
      console.error('[github/pr] Failed to cache diff on challenge:', err);
    }
  }

  return c.json({
    success: true,
    data: { diff, metadata },
  });
});

// ─── POST /api/v1/github/repo-context ──────────────────────────────────────

const repoContextSchema = z.object({
  repoUrl: z.string().url('repoUrl must be a valid URL'),
  prNumber: z.number().int().positive('prNumber must be a positive integer'),
});

/**
 * POST /api/v1/github/repo-context
 *
 * Fetches repo context (README, changed file contents, package.json) and uses
 * AI to generate RepoKnowledgeInput for the explainer agent.
 *
 * Body: { repoUrl: string; prNumber: number }
 * Returns: { success: true, data: { repoKnowledge: RepoKnowledgeInput } }
 */
github.post('/repo-context', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = repoContextSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { repoUrl, prNumber } = parsed.data;
  const repoPath = extractRepoPath(repoUrl);
  if (!repoPath) {
    return apiError(c, 'VALIDATION_ERROR', 'Invalid GitHub repository URL.');
  }

  const token = (c.env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'pipe-api/1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Fetch in parallel: README, PR files list, package.json
  const [readmeRes, filesRes, pkgRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${repoPath}/readme`, {
      headers: { ...headers, Accept: 'application/vnd.github.v3.raw' },
    }),
    fetch(`https://api.github.com/repos/${repoPath}/pulls/${prNumber}/files?per_page=100`, { headers }),
    fetch(`https://api.github.com/repos/${repoPath}/contents/package.json`, {
      headers: { ...headers, Accept: 'application/vnd.github.v3.raw' },
    }),
  ]);

  const readme = readmeRes.ok ? await readmeRes.text() : '';
  const pkgJson = pkgRes.ok ? await pkgRes.text() : '';

  if (!filesRes.ok) {
    return c.json({ success: false, error: 'Failed to fetch PR files from GitHub.' }, 502);
  }

  const files = (await filesRes.json()) as Array<{
    filename: string;
    status: string;
    patch?: string;
    raw_url?: string;
    contents_url?: string;
  }>;

  // Fetch full contents of changed files (up to 8 files, skip binary/large)
  const filesToFetch = files
    .filter((f) => f.patch && f.status !== 'removed')
    .slice(0, 8);

  const fileContents: Record<string, string> = {};
  const contentPromises = filesToFetch.map(async (f) => {
    try {
      // Use contents API to get the file at the PR's head
      const contentsUrl = f.contents_url?.replace('{+path}', f.filename);
      if (!contentsUrl) return;
      const res = await fetch(contentsUrl, {
        headers: { ...headers, Accept: 'application/vnd.github.v3.raw' },
      });
      if (res.ok) {
        const text = await res.text();
        // Skip files over 10KB to stay within context limits
        if (text.length <= 10_000) {
          fileContents[f.filename] = text;
        }
      }
    } catch {
      // Skip files that fail to fetch
    }
  });
  await Promise.all(contentPromises);

  // Fetch the PR metadata for context
  const prRes = await fetch(`https://api.github.com/repos/${repoPath}/pulls/${prNumber}`, { headers });
  const prData = prRes.ok
    ? (await prRes.json()) as { title: string; body: string | null }
    : { title: '', body: null };

  // Build the prompt for AI generation
  const contextForAI = buildRepoContextPrompt({
    readme: readme.slice(0, 5000),
    pkgJson: pkgJson.slice(0, 2000),
    prTitle: prData.title,
    prDescription: prData.body ?? '',
    changedFiles: files.map((f) => f.filename),
    fileContents,
  });

  // Call AI to generate repoKnowledge
  const apiKey = c.env.MISTRAL_API_KEY ?? '';
  const provider = apiKey ? 'mistral' : 'workers-ai';

  let repoKnowledge: RepoKnowledgeInput;
  try {
    if (provider === 'mistral') {
      const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'devstral-small-latest',
          messages: [
            { role: 'system', content: 'You generate structured JSON about code repositories. Respond with ONLY the JSON object, no markdown fences.' },
            { role: 'user', content: contextForAI },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });
      if (!mistralRes.ok) throw new Error(`Mistral ${mistralRes.status}`);
      const mistralData = (await mistralRes.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const raw = mistralData.choices[0]?.message?.content ?? '{}';
      repoKnowledge = parseRepoKnowledge(raw);
    } else {
      // Workers AI fallback
      const aiResult = await c.env.AI.run('@cf/qwen/qwen2.5-coder-32b-instruct' as Parameters<typeof c.env.AI.run>[0], {
        messages: [
          { role: 'system', content: 'You generate structured JSON about code repositories. Respond with ONLY the JSON object, no markdown fences.' },
          { role: 'user', content: contextForAI },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }) as { response?: string };
      repoKnowledge = parseRepoKnowledge(aiResult.response ?? '{}');
    }
  } catch (err) {
    console.error('[github/repo-context] AI generation failed:', err);
    // Return a minimal fallback so the flow doesn't break
    repoKnowledge = buildFallbackRepoKnowledge(prData.title, prData.body ?? '', files.map((f) => f.filename), fileContents);
  }

  return c.json({ success: true, data: { repoKnowledge } });
});

// ─── Helpers for repo-context ───────────────────────────────────────────────

function buildRepoContextPrompt(input: {
  readme: string;
  pkgJson: string;
  prTitle: string;
  prDescription: string;
  changedFiles: string[];
  fileContents: Record<string, string>;
}): string {
  const parts: string[] = [];

  parts.push(`Generate a RepoKnowledgeInput JSON object for a code review challenge. This context will be used by an AI agent playing the PR author to answer questions about the codebase.

## Repository README (excerpt)
${input.readme || '(not available)'}

## package.json (excerpt)
${input.pkgJson || '(not available)'}

## Pull Request
Title: ${input.prTitle}
Description: ${input.prDescription || '(no description)'}

## Changed Files
${input.changedFiles.join('\n')}

## Full File Contents (for surrounding code context)
`);

  for (const [file, content] of Object.entries(input.fileContents)) {
    parts.push(`### ${file}\n\`\`\`\n${content}\n\`\`\`\n`);
  }

  parts.push(`
## Required Output Format

Return a JSON object with this exact structure:
{
  "architecture": {
    "overview": "2-3 sentence overview of the project architecture",
    "components": [{ "name": "ComponentName", "description": "what it does", "file": "path/to/file.ts" }],
    "dataFlow": "how data moves through the system"
  },
  "designDecisions": [
    {
      "id": 1,
      "decision": "what was decided",
      "reason": "why",
      "alternatives": ["other options"],
      "tradeoffs": "what was traded off"
    }
  ],
  "surroundingCode": {
    "path/to/file.ts": "relevant code snippet that helps understand the PR"
  },
  "prContext": {
    "problemSolved": "what problem this PR addresses",
    "approach": "how it solves it",
    "keyFiles": ["list", "of", "key", "files"]
  }
}

Focus on what would help a code reviewer understand this PR. Include 2-4 design decisions and 2-5 architecture components. For surroundingCode, include only the most relevant snippets (not entire files).`);

  return parts.join('\n');
}

function parseRepoKnowledge(raw: string): RepoKnowledgeInput {
  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  // Validate and coerce to RepoKnowledgeInput
  const arch = parsed.architecture as Record<string, unknown> | undefined;
  const decisions = Array.isArray(parsed.designDecisions)
    ? (parsed.designDecisions as Array<Record<string, unknown>>)
    : [];
  const surrounding = typeof parsed.surroundingCode === 'object' && parsed.surroundingCode !== null
    ? (parsed.surroundingCode as Record<string, string>)
    : {};
  const ctx = parsed.prContext as Record<string, unknown> | undefined;

  return {
    architecture: {
      overview: typeof arch?.overview === 'string' ? arch.overview : '',
      components: Array.isArray(arch?.components)
        ? (arch.components as Array<Record<string, string>>).map((c) => ({
            name: c.name ?? '',
            description: c.description ?? '',
            ...(c.file ? { file: c.file } : {}),
          }))
        : [],
      ...(typeof arch?.dataFlow === 'string' ? { dataFlow: arch.dataFlow } : {}),
    },
    designDecisions: decisions.map((d, i) => ({
      id: typeof d.id === 'number' ? d.id : i + 1,
      decision: typeof d.decision === 'string' ? d.decision : '',
      reason: typeof d.reason === 'string' ? d.reason : '',
      alternatives: Array.isArray(d.alternatives) ? d.alternatives.map(String) : [],
      tradeoffs: typeof d.tradeoffs === 'string' ? d.tradeoffs : '',
    })),
    surroundingCode: surrounding,
    prContext: {
      problemSolved: typeof ctx?.problemSolved === 'string' ? ctx.problemSolved : '',
      approach: typeof ctx?.approach === 'string' ? ctx.approach : '',
      keyFiles: Array.isArray(ctx?.keyFiles) ? (ctx.keyFiles as string[]) : [],
    },
  };
}

function buildFallbackRepoKnowledge(
  prTitle: string,
  prDescription: string,
  changedFiles: string[],
  fileContents: Record<string, string>,
): RepoKnowledgeInput {
  return {
    architecture: {
      overview: 'Architecture details not available — generated from PR metadata only.',
      components: changedFiles.slice(0, 5).map((f) => ({
        name: f.split('/').pop() ?? f,
        description: 'Modified in this PR',
        file: f,
      })),
    },
    designDecisions: [],
    surroundingCode: Object.fromEntries(
      Object.entries(fileContents).slice(0, 3).map(([k, v]) => [k, v.slice(0, 2000)]),
    ),
    prContext: {
      problemSolved: prDescription.slice(0, 500) || prTitle,
      approach: 'See PR description and diff for details.',
      keyFiles: changedFiles.slice(0, 5),
    },
  };
}

export { github };
