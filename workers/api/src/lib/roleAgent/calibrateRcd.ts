/**
 * RCD calibration orchestrator (ADR-036 gap-filling).
 *
 * When a recruiter flags a gap in a synthesized RCD, this module:
 *   1. Generates a targeted clarifying question (via callGapFillingAgent)
 *   2. Re-synthesizes the affected domain cell once the answer is received.
 *
 * The re-synthesis is scoped to a single domain cell to keep the LLM call
 * lightweight and deterministic.
 */

import type { LLMProvider } from '../llm/types';
import type {
  Domain,
  DomainCell,
  RoleContextDocument,
  RoleExchange,
  StakeholderType,
} from '../../types';
import { callGapFillingAgent } from '../roleAgent';

export interface CalibrateRcdInput {
  provider: LLMProvider | null;
  rcd: RoleContextDocument;
  flagType: string;
  domain: Domain;
  attribute: string;
  recruiterNote: string;
  transcript: string;
  /** The gap-filling answer from the recruiter. When omitted, only the clarifying question is generated. */
  answer?: string;
  /** The stakeholder whose cell should be updated. Defaults to HIRING_MANAGER. */
  stakeholder?: StakeholderType;
}

export interface CalibrateRcdOutput {
  /** The updated RCD (mutated in place). */
  rcd: RoleContextDocument;
  /** Present when no answer was supplied — the question to ask the recruiter. */
  clarifyingQuestion?: string;
  /** Present when an answer was supplied — the re-synthesized cell. */
  updatedCell?: DomainCell;
}

const DOMAIN_RE_SYNTHESIS_PROMPT = `You are updating a single domain cell in a Role Context Document (RCD) based on a new clarifying answer from a recruiter.

Rules:
- Update ONLY the summary, open_codes, and laddering_chains of the provided cell.
- Preserve existing stories and axial_links unless the new answer directly contradicts them.
- Add one new laddering_chain derived from the new answer (attribute_quote → consequence → value).
- Keep the summary diplomatic and constructive.
- Return ONLY a JSON object matching the DomainCell shape. No markdown fencing.`;

function buildCellUpdateUserMessage(opts: {
  domain: Domain;
  attribute: string;
  recruiterNote: string;
  answer: string;
  existingCell: DomainCell;
}): string {
  const { domain, attribute, recruiterNote, answer, existingCell } = opts;
  return `Domain: ${domain}
Attribute gap: ${attribute}
Recruiter note: ${recruiterNote}

Existing cell:
${JSON.stringify(existingCell, null, 2)}

New clarifying answer:
"""
${answer}
"""

Emit the updated DomainCell JSON.`;
}

function normalizeCell(raw: unknown): DomainCell {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const asArr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    primary_authority: r.primary_authority === true,
    coverage: isCoverage(r.coverage) ? r.coverage : 'partial',
    laddering_chains: asArr<DomainCell['laddering_chains'][number]>(r.laddering_chains).map((c) => ({
      attribute_quote: typeof c.attribute_quote === 'string' ? c.attribute_quote : '',
      source_exchange_id: typeof c.source_exchange_id === 'string' ? c.source_exchange_id : '',
      consequence: typeof c.consequence === 'string' ? c.consequence : '',
      value: typeof c.value === 'string' ? c.value : '',
      energy_signal: isEnergy(c.energy_signal) ? c.energy_signal : 'medium',
      confidence: isConfidence(c.confidence) ? c.confidence : 'medium',
    })),
    open_codes: asArr<string>(r.open_codes).filter((s): s is string => typeof s === 'string'),
    axial_links: asArr<DomainCell['axial_links'][number]>(r.axial_links).filter(
      (link) =>
        typeof link.from_code === 'string' &&
        typeof link.to_code === 'string' &&
        typeof link.relation === 'string',
    ),
    stories: asArr<DomainCell['stories'][number]>(r.stories).map((s) => ({
      situation: typeof s.situation === 'string' ? s.situation : '',
      action: typeof s.action === 'string' ? s.action : '',
      outcome: typeof s.outcome === 'string' ? s.outcome : '',
      moral: typeof s.moral === 'string' ? s.moral : '',
      source_exchange_id: typeof s.source_exchange_id === 'string' ? s.source_exchange_id : '',
    })),
    summary: typeof r.summary === 'string' ? r.summary : '',
  };
}

function isCoverage(v: unknown): v is DomainCell['coverage'] {
  return v === 'not_probed' || v === 'sparse' || v === 'partial' || v === 'covered' || v === 'deep';
}

function isEnergy(v: unknown): v is DomainCell['laddering_chains'][number]['energy_signal'] {
  return v === 'high' || v === 'medium' || v === 'low' || v === 'unknown';
}

function isConfidence(v: unknown): v is DomainCell['laddering_chains'][number]['confidence'] {
  return v === 'high' || v === 'medium' || v === 'low';
}

/** Build a fallback DomainCell when LLM re-synthesis is unavailable or fails. */
function buildFallbackCell(
  existingCell: DomainCell,
  domain: Domain,
  attribute: string,
  answer: string,
): DomainCell {
  return {
    ...existingCell,
    coverage: existingCell.coverage === 'not_probed' ? 'sparse' : existingCell.coverage,
    laddering_chains: [
      ...existingCell.laddering_chains,
      {
        attribute_quote: answer.slice(0, 200),
        source_exchange_id: 'calibrate-1',
        consequence: `Clarifying answer on ${attribute}: ${answer.slice(0, 200)}`,
        value: `Reinforces ${domain} expectations for this role.`,
        energy_signal: 'medium',
        confidence: 'medium',
      },
    ],
    summary: existingCell.summary
      ? `${existingCell.summary} (Updated: ${attribute} — ${answer.slice(0, 120)}).`
      : `${attribute}: ${answer.slice(0, 200)}`,
  };
}

export async function calibrateRcd(input: CalibrateRcdInput): Promise<CalibrateRcdOutput> {
  const { provider, rcd, flagType, domain, attribute, recruiterNote, transcript, answer, stakeholder = 'HIRING_MANAGER' } = input;

  // Step 1: if no answer yet, generate the clarifying question and return it
  if (!answer || answer.trim().length === 0) {
    const gapResult = await callGapFillingAgent({
      provider,
      rcd: rcd as unknown as Record<string, unknown>,
      flagType,
      domain,
      attribute,
      recruiterNote,
      transcript,
    });
    return { rcd, clarifyingQuestion: gapResult.clarifyingQuestion };
  }

  // Step 2: re-synthesize the affected domain cell
  const existingCell = rcd.domain_matrix[stakeholder]?.[domain] ?? {
    primary_authority: false,
    coverage: 'not_probed',
    laddering_chains: [],
    open_codes: [],
    axial_links: [],
    stories: [],
    summary: '',
  };

  let updatedCell: DomainCell;

  if (provider) {
    const messages = [
      { role: 'system' as const, content: DOMAIN_RE_SYNTHESIS_PROMPT },
      {
        role: 'user' as const,
        content: buildCellUpdateUserMessage({ domain, attribute, recruiterNote, answer, existingCell }),
      },
    ];

    try {
      const completion = await provider.complete(messages, { forceJson: true, maxTokens: 2048 });
      const content = completion.content?.trim() ?? '';
      const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      updatedCell = normalizeCell(parsed);
    } catch (err) {
      console.error('[calibrateRcd] Re-synthesis failed, falling back to manual append:', err);
      updatedCell = buildFallbackCell(existingCell, domain, attribute, answer);
    }
  } else {
    updatedCell = buildFallbackCell(existingCell, domain, attribute, answer);
  }

  // Write the updated cell back into the RCD
  const stakeholderRow = rcd.domain_matrix[stakeholder] ?? {};
  stakeholderRow[domain] = updatedCell;
  rcd.domain_matrix[stakeholder] = stakeholderRow;

  return { rcd, updatedCell };
}
