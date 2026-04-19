/**
 * Issue Scorer Cron Handler — AI scoring of issues for challenge suitability (RD-P6).
 *
 * Trigger: Sunday 04:00 UTC (configured in wrangler.jsonc, runs after issueCrawler)
 * Model: Gemma 4 26B — routed through ROLE_AGENT_PROVIDER factory.
 *        Set ROLE_AGENT_PROVIDER=vertex-ai in production (Vertex MaaS, no daily cap).
 *        Falls back to cloudflare-ai Workers AI binding when unset.
 *
 * Flow:
 *   1. Query repo_issues for unscored issues
 *   2. For each issue: build AI prompt with issue + repo context
 *   3. Parse AI response for scores + difficulty band
 *   4. INSERT into issue_challenge_signals
 *   5. Update scorer cursor for resumption
 */

import type { Env, IssueDifficultyBand, IssueDisqualifiedReason } from '../../types';
import { createRoleAgentProvider } from '../../lib/llm/createProvider';
import type { LLMProvider, LLMMessage } from '../../lib/llm/types';

// ─── Config ─────────────────────────────────────────────────────────────────

/** Number of issues to score per cron invocation. */
const BATCH_SIZE = 20;

/** Current signals version (bump when scoring prompt changes). */
const SIGNALS_VERSION = 1;

/** Maximum body length to include in prompt. */
const MAX_BODY_IN_PROMPT = 8000;

// ─── Main Handler ───────────────────────────────────────────────────────────

export async function handleIssueScorerCron(env: Env): Promise<{ processed: number; errors: string[] }> {
  const db = env.DB;
  const provider = createRoleAgentProvider(env);

  if (!provider) {
    console.error('[issueScorer] No AI provider available (check ROLE_AGENT_PROVIDER + credentials)');
    return { processed: 0, errors: ['No AI provider available'] };
  }

  // Get cursor from crawler_state
  const cursorRow = await db
    .prepare('SELECT value_json FROM crawler_state WHERE key = ?')
    .bind('issue_scorer_cursor')
    .first<{ value_json: string }>();

  const cursor = cursorRow
    ? (JSON.parse(cursorRow.value_json) as { last_issue_id: number })
    : { last_issue_id: 0 };

  // Find unscored issues with repo context
  const issues = await db
    .prepare(`
      SELECT
        ri.id as issue_id,
        ri.title,
        ri.body,
        ri.labels_json,
        ri.comment_count,
        ri.reactions_total,
        qr.full_name,
        qr.primary_language,
        qr.description as repo_description,
        res.engineering_narrative
      FROM repo_issues ri
      JOIN qualified_repos qr ON ri.repo_id = qr.id
      LEFT JOIN repo_engineering_signals res ON qr.id = res.repo_id
      LEFT JOIN issue_challenge_signals ics ON ri.id = ics.issue_id
      WHERE ics.id IS NULL
        AND ri.state_at_crawl = 'open'
        AND ri.has_merged_pr = 0
        AND ri.id > ?
      ORDER BY ri.id ASC
      LIMIT ?
    `)
    .bind(cursor.last_issue_id, BATCH_SIZE)
    .all<{
      issue_id: number;
      title: string;
      body: string | null;
      labels_json: string | null;
      comment_count: number;
      reactions_total: number;
      full_name: string;
      primary_language: string;
      repo_description: string | null;
      engineering_narrative: string | null;
    }>();

  if (!issues.results || issues.results.length === 0) {
    // No more issues to process — reset cursor for next cycle
    await db
      .prepare('UPDATE crawler_state SET value_json = ?, updated_at = datetime("now") WHERE key = ?')
      .bind(JSON.stringify({ last_issue_id: 0 }), 'issue_scorer_cursor')
      .run();

    return { processed: 0, errors: [] };
  }

  const errors: string[] = [];
  let lastProcessedId = cursor.last_issue_id;

  for (const issue of issues.results) {
    try {
      const signals = await scoreIssue(provider, issue);

      await insertSignals(db, issue.issue_id, signals);

      lastProcessedId = issue.issue_id;
      console.log(`[issueScorer] Scored issue ${issue.issue_id}: ${signals.difficulty_band ?? 'disqualified'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Issue ${issue.issue_id}: ${msg}`);
      console.error(`[issueScorer] Error scoring issue ${issue.issue_id}:`, msg);
    }
  }

  // Update cursor
  await db
    .prepare('UPDATE crawler_state SET value_json = ?, updated_at = datetime("now") WHERE key = ?')
    .bind(JSON.stringify({ last_issue_id: lastProcessedId }), 'issue_scorer_cursor')
    .run();

  return { processed: issues.results.length, errors };
}

// ─── Scoring Logic ─────────────────────────────────────────────────────────

interface IssueContext {
  issue_id: number;
  title: string;
  body: string | null;
  labels_json: string | null;
  comment_count: number;
  reactions_total: number;
  full_name: string;
  primary_language: string;
  repo_description: string | null;
  engineering_narrative: string | null;
}

interface ScoredSignals {
  implementability_score: number | null;
  clarity_score: number | null;
  scope_score: number | null;
  isolation_score: number | null;
  difficulty_band: IssueDifficultyBand | null;
  assessment_narrative: string | null;
  disqualified: 0 | 1;
  disqualified_reason: IssueDisqualifiedReason;
}

async function scoreIssue(provider: LLMProvider, issue: IssueContext): Promise<ScoredSignals> {
  const prompt = buildScoringPrompt(issue);
  const messages: LLMMessage[] = [
    { role: 'system', content: SCORING_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  const completion = await provider.complete(messages, { maxTokens: 1024, forceJson: true });
  return parseScoreResponse(completion.content ?? '');
}

function buildScoringPrompt(issue: IssueContext): string {
  const labels = issue.labels_json
    ? (JSON.parse(issue.labels_json) as string[]).join(', ')
    : 'none';

  const body = issue.body
    ? issue.body.length > MAX_BODY_IN_PROMPT
      ? issue.body.slice(0, MAX_BODY_IN_PROMPT) + '\n\n[truncated]'
      : issue.body
    : '(no body)';

  return [
    '## Repository Context',
    `full_name: ${issue.full_name}`,
    `primary_language: ${issue.primary_language}`,
    `description: ${issue.repo_description ?? '(none)'}`,
    issue.engineering_narrative
      ? `engineering_narrative: ${issue.engineering_narrative}`
      : '',
    '',
    '## Issue',
    `title: ${issue.title}`,
    `labels: ${labels}`,
    `comments: ${issue.comment_count}`,
    `reactions: ${issue.reactions_total}`,
    '',
    '## Issue Body',
    body,
    '',
    '---',
    '',
    'Score this issue for challenge suitability. Output JSON only.',
  ]
    .filter(Boolean)
    .join('\n');
}

const SCORING_SYSTEM_PROMPT = `You are an issue scorer for a developer hiring platform.

You receive a GitHub issue and its repository context. Your job: score whether this issue is suitable as a coding challenge for job candidates.

**Scoring dimensions (each 0.0 to 1.0):**

1. **implementability_score**: Can someone unfamiliar with the codebase implement this?
   - 1.0 = Clear acceptance criteria, minimal tribal knowledge needed
   - 0.0 = "Fix the thing" with no context, requires deep codebase knowledge

2. **clarity_score**: Is the problem statement clear?
   - 1.0 = Specific bug/feature with reproduction steps or clear requirements
   - 0.0 = Vague complaint or ambiguous request

3. **scope_score**: Is this right-sized for a 2-4 hour coding assessment?
   - 1.0 = Well-scoped feature or bug that touches 1-3 files
   - 0.5 = Moderate scope, might take a full day
   - 0.0 = "Rewrite the auth system" or trivial one-liner

4. **isolation_score**: Can this be done without touching half the codebase?
   - 1.0 = Self-contained in 1-2 modules
   - 0.0 = Cross-cutting concerns requiring changes everywhere

**Difficulty band derivation:**
- junior: scope >= 0.8 AND isolation >= 0.8 AND clarity >= 0.7
- mid: scope >= 0.6 AND isolation >= 0.6
- senior: scope >= 0.4 OR isolation < 0.6
- (disqualified if scope < 0.3 — too big for assessment)

**Disqualification reasons:**
- too_vague: clarity < 0.3
- too_large: scope < 0.3
- requires_maintainer: needs repo admin access, CI config, etc.
- staff_level: scope < 0.3 AND isolation < 0.3

**Output schema (JSON only, no markdown):**
{
  "implementability_score": <number 0-1>,
  "clarity_score": <number 0-1>,
  "scope_score": <number 0-1>,
  "isolation_score": <number 0-1>,
  "difficulty_band": "junior" | "mid" | "senior" | null,
  "assessment_narrative": "<2-3 sentence explanation>",
  "disqualified": true | false,
  "disqualified_reason": "too_vague" | "too_large" | "requires_maintainer" | "staff_level" | null
}`;

function parseScoreResponse(text: string): ScoredSignals {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[issueScorer] Failed to parse AI response:', text.slice(0, 200));
    // Return disqualified with unknown reason
    return {
      implementability_score: null,
      clarity_score: null,
      scope_score: null,
      isolation_score: null,
      difficulty_band: null,
      assessment_narrative: 'AI response could not be parsed',
      disqualified: 1,
      disqualified_reason: 'too_vague',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return defaultDisqualified('AI response was not an object');
  }

  const obj = parsed as Record<string, unknown>;

  const implementability = normalizeScore(obj.implementability_score);
  const clarity = normalizeScore(obj.clarity_score);
  const scope = normalizeScore(obj.scope_score);
  const isolation = normalizeScore(obj.isolation_score);

  const disqualified = obj.disqualified === true || scope !== null && scope < 0.3;
  const disqualifiedReason = normalizeDisqualifiedReason(obj.disqualified_reason);

  const difficultyBand = disqualified
    ? null
    : normalizeDifficultyBand(obj.difficulty_band) ??
      deriveDifficultyBand(scope, isolation, clarity);

  const narrative = typeof obj.assessment_narrative === 'string'
    ? obj.assessment_narrative.slice(0, 500)
    : null;

  return {
    implementability_score: implementability,
    clarity_score: clarity,
    scope_score: scope,
    isolation_score: isolation,
    difficulty_band: difficultyBand,
    assessment_narrative: narrative,
    disqualified: disqualified ? 1 : 0,
    disqualified_reason: disqualified ? (disqualifiedReason ?? 'too_vague') : null,
  };
}

function normalizeScore(v: unknown): number | null {
  if (typeof v === 'number' && v >= 0 && v <= 1) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (!isNaN(n) && n >= 0 && n <= 1) return n;
  }
  return null;
}

function normalizeDifficultyBand(v: unknown): IssueDifficultyBand | null {
  if (v === 'junior' || v === 'mid' || v === 'senior') return v;
  return null;
}

function normalizeDisqualifiedReason(v: unknown): IssueDisqualifiedReason {
  const valid: IssueDisqualifiedReason[] = [
    'too_vague',
    'too_large',
    'requires_maintainer',
    'staff_level',
    'duplicate',
    'stale',
    'already_assigned',
  ];
  if (typeof v === 'string' && valid.includes(v as IssueDisqualifiedReason)) {
    return v as IssueDisqualifiedReason;
  }
  return null;
}

function deriveDifficultyBand(
  scope: number | null,
  isolation: number | null,
  clarity: number | null,
): IssueDifficultyBand | null {
  if (scope === null || isolation === null || clarity === null) return null;

  if (scope >= 0.8 && isolation >= 0.8 && clarity >= 0.7) return 'junior';
  if (scope >= 0.6 && isolation >= 0.6) return 'mid';
  if (scope >= 0.4 || isolation < 0.6) return 'senior';
  return null;
}

function defaultDisqualified(reason: string): ScoredSignals {
  return {
    implementability_score: null,
    clarity_score: null,
    scope_score: null,
    isolation_score: null,
    difficulty_band: null,
    assessment_narrative: reason,
    disqualified: 1,
    disqualified_reason: 'too_vague',
  };
}

// ─── DB Helpers ─────────────────────────────────────────────────────────────

async function insertSignals(
  db: D1Database,
  issueId: number,
  signals: ScoredSignals,
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO issue_challenge_signals (
        issue_id,
        implementability_score,
        clarity_score,
        scope_score,
        isolation_score,
        difficulty_band,
        assessment_narrative,
        disqualified,
        disqualified_reason,
        signals_version,
        model_used,
        generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    .bind(
      issueId,
      signals.implementability_score,
      signals.clarity_score,
      signals.scope_score,
      signals.isolation_score,
      signals.difficulty_band,
      signals.assessment_narrative,
      signals.disqualified,
      signals.disqualified_reason,
      SIGNALS_VERSION,
      MODEL,
    )
    .run();
}
