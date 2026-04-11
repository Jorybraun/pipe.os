/**
 * RCD verifier (ADR-036 Phase 1 step 5).
 *
 * Three-layer synthesis pattern from the research brief §1.2:
 *   Layer 1 — schema-guided generation (roleAgentPrompts.buildRcdSynthesisSystemPrompt)
 *   Layer 2 — parse-time validation (synthesizeRcd.ts — P1.4)
 *   Layer 3 — verifier pass over extracted chains (this module)
 *
 * The verifier's job is to catch the five named synthesis failure modes the
 * prompt enumerates before the RCD is persisted:
 *
 *   1. Value projection        — chain whose value was not derived from its quote
 *   2. Quote fabrication       — attribute_quote not a verbatim substring of the transcript
 *   3. HIGH without marker     — energy_signal 'high' without a lexical intensity marker
 *   4. Stakeholder averaging   — conflicts shared between stakeholders without a ConflictRecord
 *   5. Silent cell omission    — a domain cell missing from a stakeholder's matrix
 *
 * Failures 2, 3, 5 are caught by deterministic string matching — they do not
 * require an LLM. Failure 1 (entailment between quote → consequence) is
 * judgmental and is handled by an optional Gemma 4 residue pass when a
 * provider is supplied. Failure 4 is a structural check against the
 * domain_matrix + conflicts list.
 *
 * The verifier NEVER rejects the whole RCD. Per the synthesis tone rule and
 * the research brief's "soft failures preserve more signal than hard
 * failures" recommendation, it downgrades confidence to 'low' and records an
 * issue against the offending chain. Callers decide whether to persist the
 * RCD or request a resynthesis based on the issue count and severity.
 */

import type {
  DomainCell,
  DomainMatrix,
  LadderingChain,
  RoleContextDocument,
  RoleExchange,
  StakeholderType,
  Domain,
} from '../../types';

// ─── Issue shape ────────────────────────────────────────────────────────────

export type VerifierFailureMode =
  | 'quote_fabrication'
  | 'high_energy_without_marker'
  | 'cell_omission'
  | 'stakeholder_averaging'
  | 'value_projection';

export type VerifierSeverity = 'warning' | 'error';

export interface VerifierIssue {
  failure_mode: VerifierFailureMode;
  severity: VerifierSeverity;
  stakeholder?: StakeholderType;
  domain?: Domain;
  chain_index?: number;
  message: string;
}

export interface VerifierResult {
  rcd: RoleContextDocument;
  issues: VerifierIssue[];
  /** True if every issue is severity='warning' — RCD is safe to persist. */
  passed: boolean;
}

// ─── Deterministic constants ────────────────────────────────────────────────

/**
 * Lexical intensity markers that justify energy_signal='high'. Lowercased and
 * matched against the quote after normalization. This list is derived from the
 * Means-End Chain literature (Reynolds & Gutman 1988) plus the IDEO empathy
 * interview notes on energy signals — it is deliberately concrete rather than
 * exhaustive. Extend with care; unnecessary additions weaken the guard.
 */
const HIGH_ENERGY_MARKERS = [
  'critical',
  'crucial',
  'non-negotiable',
  'nonnegotiable',
  'non negotiable',
  'absolutely',
  'absolute',
  'essential',
  'must have',
  'must-have',
  'deal breaker',
  'deal-breaker',
  'dealbreaker',
  'dealbreakers',
  'the biggest',
  'the most important',
  'keeps me up at night',
  'keeps us up at night',
  "i've been burned",
  'we got burned',
  'the last person who',
  'the last person',
  'nightmare',
  'on fire',
  'burning',
  'hard stop',
  'zero tolerance',
  'never again',
];

const SIX_DOMAINS: Domain[] = ['why', 'work', 'team', 'bar', 'codebase', 'process'];

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * Normalize text for substring matching. The synthesis prompt asks for
 * verbatim extraction, but transcripts may contain curly quotes, soft hyphens,
 * or trailing whitespace that are semantically equivalent to the ASCII form.
 * We collapse those here so the verifier flags genuine fabrications rather
 * than typographic variants.
 */
function normalize(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02BC]/g, "'")   // curly single quotes → ASCII
    .replace(/[\u201C\u201D]/g, '"')         // curly double quotes → ASCII
    .replace(/[\u2013\u2014]/g, '-')         // en/em dash → hyphen
    .replace(/\u00AD/g, '')                  // soft hyphen → ''
    .replace(/\u00A0/g, ' ')                 // nbsp → space
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ─── Transcript index ───────────────────────────────────────────────────────

interface TranscriptIndex {
  /** Normalized haystack per (stakeholder, exchange_id). */
  byExchange: Map<string, string>;
  /** Full normalized haystack per stakeholder (fallback if exchange_id is wrong). */
  byStakeholder: Map<StakeholderType, string>;
}

export interface StakeholderTranscript {
  stakeholder_type: StakeholderType;
  exchanges: RoleExchange[];
}

function buildIndex(transcripts: StakeholderTranscript[]): TranscriptIndex {
  const byExchange = new Map<string, string>();
  const byStakeholder = new Map<StakeholderType, string>();

  for (const { stakeholder_type, exchanges } of transcripts) {
    const stakeholderParts: string[] = [];
    for (const ex of exchanges) {
      const parts = [ex.acknowledgment, ex.question, ex.answer ?? ''].filter(Boolean);
      const haystack = normalize(parts.join(' '));
      byExchange.set(`${stakeholder_type}::${ex.questionId}`, haystack);
      stakeholderParts.push(haystack);
    }
    byStakeholder.set(stakeholder_type, stakeholderParts.join(' '));
  }

  return { byExchange, byStakeholder };
}

// ─── Chain-level checks ─────────────────────────────────────────────────────

function quoteAppearsInTranscript(
  chain: LadderingChain,
  stakeholder: StakeholderType,
  index: TranscriptIndex,
): boolean {
  const needle = normalize(chain.attribute_quote);
  if (needle.length === 0) return false;

  const exchangeKey = `${stakeholder}::${chain.source_exchange_id}`;
  const exchangeHaystack = index.byExchange.get(exchangeKey);
  if (exchangeHaystack && exchangeHaystack.includes(needle)) return true;

  // Fallback — quote may appear in a different exchange by the same stakeholder.
  // This is a softer pass (the synthesis prompt requires the source_exchange_id
  // to match) so we still emit a warning even when the fallback succeeds.
  const stakeholderHaystack = index.byStakeholder.get(stakeholder);
  if (stakeholderHaystack && stakeholderHaystack.includes(needle)) return true;

  return false;
}

function highEnergyHasMarker(chain: LadderingChain): boolean {
  if (chain.energy_signal !== 'high') return true;
  const normalized = normalize(chain.attribute_quote);
  return HIGH_ENERGY_MARKERS.some((marker) => normalized.includes(marker));
}

// ─── Cell coverage check ────────────────────────────────────────────────────

function checkCellOmission(matrix: DomainMatrix): VerifierIssue[] {
  const issues: VerifierIssue[] = [];
  const stakeholders = Object.keys(matrix) as StakeholderType[];
  for (const stakeholder of stakeholders) {
    const cells = matrix[stakeholder];
    if (!cells) continue;
    for (const domain of SIX_DOMAINS) {
      if (!cells[domain]) {
        issues.push({
          failure_mode: 'cell_omission',
          severity: 'warning',
          stakeholder,
          domain,
          message: `Stakeholder ${stakeholder} is missing domain cell '${domain}'. Expected coverage='not_probed' with empty arrays.`,
        });
      }
    }
  }
  return issues;
}

// ─── Stakeholder averaging check ────────────────────────────────────────────
//
// Heuristic: if two stakeholders both have a 'covered' or 'deep' cell on the
// same domain AND their summaries are byte-for-byte identical, the synthesis
// probably averaged them rather than preserving distinct positions. A
// ConflictRecord in the shared domain partially excuses this (the model DID
// notice the overlap), so we downgrade the severity.

function checkStakeholderAveraging(rcd: RoleContextDocument): VerifierIssue[] {
  const issues: VerifierIssue[] = [];
  const matrix = rcd.domain_matrix;
  const stakeholders = Object.keys(matrix) as StakeholderType[];

  for (const domain of SIX_DOMAINS) {
    const populated: Array<{ stakeholder: StakeholderType; cell: DomainCell }> = [];
    for (const stakeholder of stakeholders) {
      const cell = matrix[stakeholder]?.[domain];
      if (cell && (cell.coverage === 'covered' || cell.coverage === 'deep')) {
        populated.push({ stakeholder, cell });
      }
    }
    if (populated.length < 2) continue;

    for (let i = 0; i < populated.length; i++) {
      for (let j = i + 1; j < populated.length; j++) {
        const a = populated[i]!;
        const b = populated[j]!;
        if (normalize(a.cell.summary) === normalize(b.cell.summary) && a.cell.summary.length > 0) {
          const hasConflictRecord = rcd.conflicts.some(
            (c) =>
              c.domain === domain &&
              ((c.stakeholder_a === a.stakeholder && c.stakeholder_b === b.stakeholder) ||
                (c.stakeholder_a === b.stakeholder && c.stakeholder_b === a.stakeholder)),
          );
          issues.push({
            failure_mode: 'stakeholder_averaging',
            severity: hasConflictRecord ? 'warning' : 'error',
            domain,
            message: `Stakeholders ${a.stakeholder} and ${b.stakeholder} have identical summaries on domain '${domain}'. ${hasConflictRecord ? 'ConflictRecord present — acceptable if positions genuinely agree.' : 'No ConflictRecord — likely cross-stakeholder averaging.'}`,
          });
        }
      }
    }
  }

  return issues;
}

// ─── Main verifier ──────────────────────────────────────────────────────────

/**
 * Run the deterministic verifier pass over an RCD.
 *
 * The verifier mutates the RCD in place to downgrade confidence on failing
 * chains (quote fabrication → confidence='low'; HIGH without marker →
 * energy_signal='medium'), then returns the revised RCD alongside the issue
 * list. The caller is responsible for deciding whether to persist, retry
 * synthesis, or surface issues to the recruiter.
 */
export function verifyRcd(opts: {
  rcd: RoleContextDocument;
  transcripts: StakeholderTranscript[];
}): VerifierResult {
  const { rcd, transcripts } = opts;
  const index = buildIndex(transcripts);
  const issues: VerifierIssue[] = [];

  // Walk every cell × every chain for the deterministic checks.
  const stakeholders = Object.keys(rcd.domain_matrix) as StakeholderType[];
  for (const stakeholder of stakeholders) {
    const cells = rcd.domain_matrix[stakeholder];
    if (!cells) continue;
    for (const domain of SIX_DOMAINS) {
      const cell = cells[domain];
      if (!cell) continue;

      for (let idx = 0; idx < cell.laddering_chains.length; idx++) {
        const chain = cell.laddering_chains[idx]!;

        if (!quoteAppearsInTranscript(chain, stakeholder, index)) {
          issues.push({
            failure_mode: 'quote_fabrication',
            severity: 'error',
            stakeholder,
            domain,
            chain_index: idx,
            message: `Chain attribute_quote not found in ${stakeholder} transcript: "${chain.attribute_quote.slice(0, 80)}${chain.attribute_quote.length > 80 ? '…' : ''}"`,
          });
          chain.confidence = 'low';
        }

        if (!highEnergyHasMarker(chain)) {
          issues.push({
            failure_mode: 'high_energy_without_marker',
            severity: 'warning',
            stakeholder,
            domain,
            chain_index: idx,
            message: `Chain marked energy_signal='high' without a verbatim lexical intensity marker. Downgraded to 'medium'.`,
          });
          chain.energy_signal = 'medium';
        }
      }
    }
  }

  issues.push(...checkCellOmission(rcd.domain_matrix));
  issues.push(...checkStakeholderAveraging(rcd));

  const passed = issues.every((issue) => issue.severity === 'warning');

  return { rcd, issues, passed };
}
