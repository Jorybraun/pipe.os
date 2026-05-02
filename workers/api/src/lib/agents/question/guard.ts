/**
 * Question Guard — Deterministic pre-flight filter for generated interview questions.
 *
 * Lightweight rule-based validation that runs in <1ms. No LLM calls.
 * Catches known bad patterns before they reach the user.
 *
 * Usage:
 *   const result = checkQuestion({ text: "...", acknowledgment: "...", participantRole: "TEAM_MEMBER" });
 *   if (!result.passed) { // reject or regenerate }
 */

export interface GuardCheckInput {
  /** The question text (question.text from the generator). */
  text: string;
  /** The acknowledgment string. */
  acknowledgment?: string;
  /** Participant role — some rules are role-specific. */
  participantRole?: string;
  /** Previous questions in this interview (for redundancy checks). */
  previousQuestions?: string[];
}

export interface GuardViolation {
  ruleId: string;
  severity: 'block' | 'warn';
  reason: string;
  matchedText?: string;
}

export interface GuardResult {
  passed: boolean;
  violations: GuardViolation[];
}

// ─── Rules ───────────────────────────────────────────────────────────────────

interface GuardRule {
  id: string;
  severity: 'block' | 'warn';
  reason: string;
  /** Optional: only apply to these participant roles. If omitted, applies to all. */
  participantRoles?: string[];
  /**
   * Returns true if the input violates this rule.
   * `capture` receives the matched substring for diagnostics.
   */
  test(input: GuardCheckInput, capture: (text: string) => void): boolean;
}

const RULES: GuardRule[] = [
  // ── Role confusion ──
  {
    id: 'role_confusion_responsibilities',
    severity: 'block',
    reason:
      'Asks the participant about their responsibilities FOR the role being hired. This confuses the interviewee with the role itself. Team members and hiring managers are not the person being hired.',
    test(input, capture) {
      const t = input.text.toLowerCase();
      const match =
        /your (primary )?responsibilities (as a )?(team member|hiring manager|recruiter|interviewer) (for|in|on) (this|the) (role|position|job)/i.exec(
          input.text,
        ) ||
        /what (are|were) your (primary )?responsibilities (as|for|in) (this|the) (role|position|job)/i.exec(
          input.text,
        ) ||
        /what.*your.*responsibilities.*(as a )?(team member|hiring manager).*(role|position|job)/i.exec(
          input.text,
        );
      if (match) capture(match[0]);
      return !!match;
    },
  },
  {
    id: 'role_confusion_self_referential',
    severity: 'block',
    reason:
      'Question treats the participant as if they are the person in the role being hired. Team members work alongside the hire; hiring managers manage them. Neither IS the hire.',
    participantRoles: ['TEAM_MEMBER', 'HIRING_MANAGER', 'INTERNAL_RECRUITER', 'EXTERNAL_RECRUITER'],
    test(input, capture) {
      const t = input.text.toLowerCase();
      // Pattern: "you're a [role], what are your [job-related thing] for this [job title]"
      const match =
        /you('re| are) a (team member|hiring manager|recruiter).+what (are|is|does).+for this (role|position|senior|engineer|developer)/i.exec(
          input.text,
        ) ||
        /as a (team member|hiring manager|recruiter), what (are|is).+your.*(responsibilities|day-to-day|typical week).*for this/i.exec(
          input.text,
        );
      if (match) capture(match[0]);
      return !!match;
    },
  },

  // ── Brevity ──
  {
    id: 'brevity_hard_limit',
    severity: 'block',
    reason: 'Question exceeds 30 words. The prompt requires under 15 words ideal, 20 max.',
    test(input, capture) {
      const words = input.text.trim().split(/\s+/).length;
      if (words > 30) {
        capture(`(${words} words)`);
        return true;
      }
      return false;
    },
  },
  {
    id: 'brevity_soft_limit',
    severity: 'warn',
    reason: 'Question exceeds 20 words. Consider tightening.',
    test(input, capture) {
      const words = input.text.trim().split(/\s+/).length;
      if (words > 20) {
        capture(`(${words} words)`);
        return true;
      }
      return false;
    },
  },

  // ── Acknowledgment quality ──
  {
    id: 'ack_stilted_role_reference',
    severity: 'warn',
    reason:
      'Acknowledgment restates the participant role in a robotic way. "You are a team member, which helps me understand..." is filler that adds no value.',
    test(input, capture) {
      const ack = (input.acknowledgment ?? '').toLowerCase();
      const match =
        /you('re| are) a (team member|hiring manager|recruiter|internal recruiter|external recruiter),? which (helps|means|tells)/i.exec(
          input.acknowledgment ?? '',
        );
      if (match) capture(match[0]);
      return !!match;
    },
  },

  // ── Redundancy ──
  {
    id: 'redundancy_near_duplicate',
    severity: 'warn',
    reason: 'Question is substantially similar to a previously asked question.',
    test(input, capture) {
      if (!input.previousQuestions || input.previousQuestions.length === 0) return false;
      const normalized = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      const current = normalized(input.text);
      for (const prev of input.previousQuestions) {
        const prevNorm = normalized(prev);
        // Simple word-overlap similarity
        const currentWords = new Set(current.split(' '));
        const prevWords = new Set(prevNorm.split(' '));
        const intersection = new Set([...currentWords].filter((x) => prevWords.has(x)));
        const union = new Set([...currentWords, ...prevWords]);
        if (union.size > 0 && intersection.size / union.size > 0.75 && currentWords.size > 4) {
          capture(`Similar to: "${prev.slice(0, 60)}..."`);
          return true;
        }
      }
      return false;
    },
  },

  // ── Leading questions ──
  {
    id: 'leading_question',
    severity: 'warn',
    reason: 'Question appears to lead the user toward a specific answer.',
    test(input, capture) {
      const t = input.text.toLowerCase();
      const match =
        /(probably|likely|obviously|surely|definitely|you probably|your team probably|it probably|doesn.t it|isn.t it|right\?)/i.exec(
          input.text,
        );
      if (match) capture(match[0]);
      return !!match;
    },
  },

  // ── Generic meta-questions in early turns ──
  {
    id: 'early_turn_meta_question',
    severity: 'warn',
    reason:
      'Early-turn question is too abstract or meta. Context phase should ground in specifics, not ask about "scope and responsibilities" in the abstract.',
    test(input, capture) {
      if ((input.previousQuestions?.length ?? 0) > 1) return false; // only for turns 1-2
      const t = input.text.toLowerCase();
      const match =
        /(scope and responsibilities|scope of (this|the) role|overview of (this|the) role|tell me about (this|the) role.*in general)/i.exec(
          input.text,
        );
      if (match) capture(match[0]);
      return !!match;
    },
  },
];

// ─── Public API ──────────────────────────────────────────────────────────────

export function checkQuestion(input: GuardCheckInput): GuardResult {
  const violations: GuardViolation[] = [];

  for (const rule of RULES) {
    if (rule.participantRoles && input.participantRole) {
      if (!rule.participantRoles.includes(input.participantRole)) continue;
    }

    let matchedText: string | undefined;
    const capture = (text: string) => {
      matchedText = text;
    };

    if (rule.test(input, capture)) {
      violations.push({
        ruleId: rule.id,
        severity: rule.severity,
        reason: rule.reason,
        matchedText,
      });
    }
  }

  const hasBlock = violations.some((v) => v.severity === 'block');
  return {
    passed: !hasBlock,
    violations,
  };
}

/**
 * Build a guard-failure nudge that can be injected into the system prompt
 * or sent as a follow-up user message to steer regeneration.
 */
export function buildGuardNudge(result: GuardResult): string {
  if (result.passed || result.violations.length === 0) return '';

  const blocks = result.violations.filter((v) => v.severity === 'block');
  const warns = result.violations.filter((v) => v.severity === 'warn');

  const lines: string[] = ['\n## GUARD FAILURE — Regenerate with corrections\n'];

  if (blocks.length > 0) {
    lines.push('The previous question was REJECTED for these reasons:');
    for (const v of blocks) {
      lines.push(`- [BLOCK] ${v.ruleId}: ${v.reason}`);
      if (v.matchedText) lines.push(`  Matched: "${v.matchedText}"`);
    }
    lines.push('');
  }

  if (warns.length > 0) {
    lines.push('Additional warnings:');
    for (const v of warns) {
      lines.push(`- [WARN] ${v.ruleId}: ${v.reason}`);
      if (v.matchedText) lines.push(`  Matched: "${v.matchedText}"`);
    }
    lines.push('');
  }

  lines.push('Generate a NEW question that avoids all of the above issues. Do NOT repeat the rejected question.');
  return lines.join('\n');
}

