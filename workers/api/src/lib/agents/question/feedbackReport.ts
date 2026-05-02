/**
 * Question Quality Feedback Report — aggregates recruiter feedback on interview questions.
 *
 * Reads the `feedback` field from `role_context_participants.exchanges` and produces
 * a structured report for prompt tuning. No new tables required — uses existing data.
 *
 * Usage:
 *   const report = await generateQuestionQualityReport(env.DB, { since: '2026-04-01' });
 *   console.log(report.topPatterns);
 */

import type { RoleExchange } from '../../../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuestionQualityReport {
  /** Total exchanges analyzed. */
  totalExchanges: number;
  /** Exchanges with non-empty feedback. */
  totalFlagged: number;
  /** Flag rate (0–1). */
  flagRate: number;
  /** Top bad-question patterns found by heuristic categorization. */
  topPatterns: PatternAggregate[];
  /** Breakdown by participant role. */
  byParticipantRole: Record<string, RoleBreakdown>;
  /** Raw flagged exchanges for deep-dive analysis. */
  sampleFlagged: FlaggedExchange[];
}

export interface PatternAggregate {
  /** Heuristic pattern name. */
  pattern: string;
  /** Number of occurrences. */
  count: number;
  /** Example question texts that matched this pattern. */
  examples: string[];
}

export interface RoleBreakdown {
  total: number;
  flagged: number;
  flagRate: number;
}

export interface FlaggedExchange {
  roleContextId: string;
  participantId: string;
  participantRole: string | null;
  questionId: string;
  questionText: string;
  acknowledgment: string;
  feedback: string;
  answeredAt: string | null;
}

// ─── Heuristic categorizers ──────────────────────────────────────────────────

interface Categorizer {
  pattern: string;
  test(text: string, feedback: string): boolean;
}

const CATEGORIZERS: Categorizer[] = [
  {
    pattern: 'role_confusion',
    test(text, feedback) {
      const f = feedback.toLowerCase();
      const t = text.toLowerCase();
      return (
        f.includes('role') &&
        (f.includes('confus') || f.includes('wrong') || f.includes('not the')) ||
        /your (primary )?responsibilities (as a )?(team member|hiring manager)/i.test(text) ||
        /you('re| are) a (team member|hiring manager).+what (are|is).+for this/i.test(text)
      );
    },
  },
  {
    pattern: 'too_vague',
    test(text, feedback) {
      const f = feedback.toLowerCase();
      return (
        f.includes('vague') ||
        f.includes('generic') ||
        f.includes('broad') ||
        f.includes('not specific') ||
        /overview of (this|the) role/i.test(text) ||
        /scope and responsibilities/i.test(text)
      );
    },
  },
  {
    pattern: 'leading_question',
    test(text, feedback) {
      const f = feedback.toLowerCase();
      return (
        f.includes('leading') ||
        f.includes('loaded') ||
        f.includes('assumes') ||
        /probably|likely|obviously|surely|definitely|right\?/i.test(text)
      );
    },
  },
  {
    pattern: 'irrelevant',
    test(text, feedback) {
      const f = feedback.toLowerCase();
      return f.includes('irrelevant') || f.includes('off topic') || f.includes('does not apply');
    },
  },
  {
    pattern: 'too_long',
    test(text, feedback) {
      const f = feedback.toLowerCase();
      return f.includes('too long') || f.includes('wordy') || text.trim().split(/\s+/).length > 30;
    },
  },
  {
    pattern: 'robotic_ack',
    test(text, feedback) {
      const f = feedback.toLowerCase();
      return (
        f.includes('robot') ||
        f.includes('stilted') ||
        f.includes('awkward') ||
        f.includes('filler') ||
        /you('re| are) a (team member|hiring manager|recruiter),? which (helps|means|tells)/i.test(text)
      );
    },
  },
  {
    pattern: 'duplicate',
    test(text, feedback) {
      const f = feedback.toLowerCase();
      return f.includes('duplicate') || f.includes('already asked') || f.includes('repeated');
    },
  },
  {
    pattern: 'bad_bot',
    test(text, feedback) {
      return feedback.includes('[BAD_ROBOT]');
    },
  },
];

function categorizeExchange(text: string, feedback: string): string[] {
  const patterns: string[] = [];
  for (const cat of CATEGORIZERS) {
    if (cat.test(text, feedback)) {
      patterns.push(cat.pattern);
    }
  }
  if (patterns.length === 0) {
    patterns.push('uncategorized');
  }
  return patterns;
}

// ─── Report builder ──────────────────────────────────────────────────────────

export interface ReportOptions {
  /** ISO 8601 date — only include exchanges updated on or after this date. */
  since?: string;
  /** ISO 8601 date — only include exchanges updated before this date. */
  until?: string;
  /** Max examples per pattern. */
  maxExamplesPerPattern?: number;
  /** Max total sample flagged exchanges to return. */
  sampleLimit?: number;
}

/**
 * Generate a question-quality report from existing feedback data.
 *
 * This queries `role_context_participants.exchanges` directly — no new tables.
 * Safe to run on a cron schedule or ad-hoc.
 */
export async function generateQuestionQualityReport(
  db: D1Database,
  opts: ReportOptions = {},
): Promise<QuestionQualityReport> {
  const sinceClause = opts.since ? `AND updated_at >= '${opts.since}'` : '';
  const untilClause = opts.until ? `AND updated_at < '${opts.until}'` : '';

  const rows = await db
    .prepare(
      `SELECT id, role_context_id, participant_role, exchanges
       FROM role_context_participants
       WHERE exchanges IS NOT NULL
         AND json_array_length(exchanges) > 0
         ${sinceClause}
         ${untilClause}`,
    )
    .all<{ id: string; role_context_id: string; participant_role: string | null; exchanges: string }>();

  const results = rows.results ?? [];

  let totalExchanges = 0;
  let totalFlagged = 0;
  const byParticipantRole: Record<string, RoleBreakdown> = {};
  const patternMap = new Map<string, { count: number; examples: Set<string> }>();
  const sampleFlagged: FlaggedExchange[] = [];

  for (const row of results) {
    let exchanges: RoleExchange[];
    try {
      exchanges = JSON.parse(row.exchanges) as RoleExchange[];
    } catch {
      continue;
    }

    const role = row.participant_role ?? 'UNKNOWN';
    if (!byParticipantRole[role]) {
      byParticipantRole[role] = { total: 0, flagged: 0, flagRate: 0 };
    }

    for (const ex of exchanges) {
      totalExchanges++;
      byParticipantRole[role]!.total++;

      const hasFeedback = !!(ex.feedback && ex.feedback.trim().length > 0);
      if (hasFeedback) {
        totalFlagged++;
        byParticipantRole[role]!.flagged++;

        const patterns = categorizeExchange(ex.question, ex.feedback);
        for (const p of patterns) {
          const entry = patternMap.get(p) ?? { count: 0, examples: new Set<string>() };
          entry.count++;
          entry.examples.add(ex.question);
          patternMap.set(p, entry);
        }

        if (sampleFlagged.length < (opts.sampleLimit ?? 50)) {
          sampleFlagged.push({
            roleContextId: row.role_context_id,
            participantId: row.id,
            participantRole: row.participant_role,
            questionId: ex.questionId,
            questionText: ex.question,
            acknowledgment: ex.acknowledgment,
            feedback: ex.feedback,
            answeredAt: null, // we don't store per-exchange timestamps
          });
        }
      }
    }
  }

  // Compute flag rates
  for (const breakdown of Object.values(byParticipantRole)) {
    breakdown.flagRate = breakdown.total > 0 ? breakdown.flagged / breakdown.total : 0;
  }

  // Build topPatterns
  const maxExamples = opts.maxExamplesPerPattern ?? 3;
  const topPatterns: PatternAggregate[] = Array.from(patternMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([pattern, data]) => ({
      pattern,
      count: data.count,
      examples: Array.from(data.examples).slice(0, maxExamples),
    }));

  return {
    totalExchanges,
    totalFlagged,
    flagRate: totalExchanges > 0 ? totalFlagged / totalExchanges : 0,
    topPatterns,
    byParticipantRole,
    sampleFlagged,
  };
}

/**
 * Serialize a report to a concise Markdown summary suitable for a
 * weekly calibration email or Slack message.
 */
export function formatReportMarkdown(report: QuestionQualityReport): string {
  const lines: string[] = [];
  lines.push(`# Question Quality Report`);
  lines.push(`**Total exchanges:** ${report.totalExchanges}  `);
  lines.push(`**Flagged:** ${report.totalFlagged} (${(report.flagRate * 100).toFixed(1)}%)  `);
  lines.push('');

  lines.push('## By Participant Role');
  for (const [role, data] of Object.entries(report.byParticipantRole).sort(
    (a, b) => b[1].flagRate - a[1].flagRate,
  )) {
    lines.push(`- **${role}**: ${data.flagged}/${data.total} flagged (${(data.flagRate * 100).toFixed(1)}%)`);
  }
  lines.push('');

  lines.push('## Top Flagged Patterns');
  for (const p of report.topPatterns.slice(0, 10)) {
    lines.push(`### ${p.pattern} (${p.count}×)`);
    for (const ex of p.examples) {
      lines.push(`- "${ex}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
