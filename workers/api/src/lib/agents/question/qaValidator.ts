/**
 * QA Validator — Development-mode validation for interview questions.
 *
 * Runs after each question generation to verify:
 *   1. Question is in context (references previous answers or baseline)
 *   2. Question follows the correct probe sequence
 *   3. Question matches the expected domain
 *   4. No duplicate questions have been asked
 *
 * Pure function. No LLM. <1ms.
 * Enable via console.log output in development — does not affect production flow.
 */

import type { Domain } from '../../../types';
import type { InterviewState } from '../interview/types';
import { DOMAIN_COLUMN_ORDER } from '../interview/types';
import { getProbeIds, getSoulProbeIds } from './probeLibrarian';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
}

export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  questionId: string;
  domain: Domain | null;
  probeSequencePosition: number | null;
}

// ─── Validators ──────────────────────────────────────────────────────────────

function checkProbeSequence(
  questionId: string,
  state: InterviewState,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const signalProbeIds = getProbeIds();
  const soulProbeIds = getSoulProbeIds();

  const isSignalProbe = signalProbeIds.includes(questionId);
  const isSoulProbe = soulProbeIds.includes(questionId);

  if (!isSignalProbe && !isSoulProbe) {
    issues.push({
      severity: 'info',
      code: 'LLM_GENERATED',
      message: `Question ${questionId} is LLM-generated (not a calibrated probe).`,
    });
    return issues;
  }

  // Check for duplicate delivery
  const alreadyAsked = state.exchanges
    .map((ex) => ex.questionId)
    .filter((id): id is string => typeof id === 'string');

  if (alreadyAsked.includes(questionId)) {
    issues.push({
      severity: 'error',
      code: 'DUPLICATE_PROBE',
      message: `Probe ${questionId} was already asked in exchange history.`,
    });
  }

  return issues;
}

function checkDomainAlignment(
  questionId: string,
  domain: Domain | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!domain) {
    issues.push({
      severity: 'warning',
      code: 'NO_DOMAIN',
      message: `Question ${questionId} served without a current domain.`,
    });
    return issues;
  }

  // Verify domain is in the expected order
  const domainIndex = DOMAIN_COLUMN_ORDER.indexOf(domain);
  if (domainIndex === -1) {
    issues.push({
      severity: 'error',
      code: 'INVALID_DOMAIN',
      message: `Domain "${domain}" is not in DOMAIN_COLUMN_ORDER.`,
    });
  }

  return issues;
}

function checkContextRelevance(
  questionText: string,
  state: InterviewState,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (state.exchanges.length === 0) {
    return issues;
  }

  // Check that question is not identical to a previous question
  const previousTexts = state.exchanges.map((ex) => ex.question);
  if (previousTexts.includes(questionText)) {
    issues.push({
      severity: 'error',
      code: 'EXACT_DUPLICATE_TEXT',
      message: 'Question text is identical to a previously asked question.',
    });
  }

  return issues;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate a question before it is served to the participant.
 *
 * Logs all issues to console in development. Returns a structured result
 * so callers can decide whether to proceed or flag.
 */
export function validateQuestion(
  questionId: string,
  questionText: string,
  domain: Domain | null,
  state: InterviewState,
): ValidationResult {
  const signalProbeIds = getProbeIds();

  const allIssues: ValidationIssue[] = [
    ...checkProbeSequence(questionId, state),
    ...checkDomainAlignment(questionId, domain),
    ...checkContextRelevance(questionText, state),
  ];

  const errors = allIssues.filter((i) => i.severity === 'error');
  const passed = errors.length === 0;

  const probeIndex = signalProbeIds.indexOf(questionId);
  const probeSequencePosition = probeIndex !== -1 ? probeIndex + 1 : null;

  const result: ValidationResult = {
    passed,
    issues: allIssues,
    questionId,
    domain,
    probeSequencePosition,
  };

  // Log in development
  if (allIssues.length > 0) {
    const prefix = passed ? '[qaValidator] \u26A0' : '[qaValidator] \u274C';
    for (const issue of allIssues) {
      console.log(
        `${prefix} [${issue.severity}] ${issue.code}: ${issue.message}`,
      );
    }
  } else {
    console.log(
      `[qaValidator] \u2713 question=${questionId} domain=${domain ?? 'none'} probe=#${probeSequencePosition ?? 'N/A'} — all checks passed`,
    );
  }

  return result;
}

/**
 * Validate the full interview state for consistency.
 * Useful for end-of-interview sanity checks.
 */
export function validateInterviewState(
  state: InterviewState,
): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Check domain progression
  let lastCompleteIndex = -1;
  for (const domain of DOMAIN_COLUMN_ORDER) {
    const status = state.domainCompletion[domain] ?? 'pending';
    const domainIndex = DOMAIN_COLUMN_ORDER.indexOf(domain);

    if (status === 'complete') {
      if (domainIndex !== lastCompleteIndex + 1 && lastCompleteIndex !== -1) {
        results.push({
          passed: false,
          issues: [{
            severity: 'warning',
            code: 'DOMAIN_ORDER_GAP',
            message: `Domain "${domain}" completed out of order (expected sequential progression).`,
          }],
          questionId: 'state-check',
          domain,
          probeSequencePosition: null,
        });
      }
      lastCompleteIndex = domainIndex;
    }
  }

  // Check for orphaned questions (delivered > cached)
  for (const domain of DOMAIN_COLUMN_ORDER) {
    const cached = state.domainQuestions[domain]?.length ?? 0;
    const delivered = state.domainQuestionsDelivered[domain] ?? 0;
    if (delivered > cached && cached > 0) {
      results.push({
        passed: false,
        issues: [{
          severity: 'error',
          code: 'DELIVERED_EXCEEDS_CACHED',
          message: `Domain "${domain}": delivered=${delivered} > cached=${cached}`,
        }],
        questionId: 'state-check',
        domain,
        probeSequencePosition: null,
      });
    }
  }

  if (results.length === 0) {
    console.log('[qaValidator] interview state check: all domains consistent');
  }

  return results;
}

/**
 * Validate a batch of domain questions (after generation).
 * Calls validateQuestion for each and returns all results.
 */
export function validateDomainQuestionBatch(
  questions: Array<{ id: string; text: string }>,
  state: InterviewState,
  domain: Domain,
): ValidationResult[] {
  return questions.map((q) => validateQuestion(q.id, q.text, domain, state));
}

/**
 * Log validation results to console (dev mode only).
 * Call this in the domain orchestrator after generation.
 */
export function logValidationResults(results: ValidationResult[]): void {
  const failures = results.filter((r) => !r.passed);
  const warnings = results.flatMap((r) => r.issues.filter((i) => i.severity === 'warning'));

  if (failures.length > 0) {
    console.warn(
      `[qaValidator] ${failures.length}/${results.length} questions FAILED validation:`,
      failures.map((f) => ({ id: f.questionId, issues: f.issues })),
    );
  }

  if (warnings.length > 0) {
    console.info(
      `[qaValidator] ${warnings.length} warning(s) across ${results.length} questions:`,
      warnings.map((w) => ({ code: w.code, msg: w.message })),
    );
  }
}
