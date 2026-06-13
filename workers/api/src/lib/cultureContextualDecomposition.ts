/**
 * cultureContextualDecomposition.ts — ADR-050 Contextual Conversation Graph
 *
 * Decomposes a single interview answer into an open semantic graph. Statement
 * kinds and relationship predicates are source-backed data, not code-owned
 * enums.
 *
 * Rules (from ADR-050):
 *   - Every node carries a contextual phrase ("chose Kafka for ordered
 *     clickstream replay"), never a bare token ("kafka"). The phrase is what
 *     gets embedded.
 *   - Generic sentences with no named entity, decision, or outcome are
 *     discarded. A fully-discarded answer triggers a probe — LLM-written,
 *     quoting the candidate's own words — asking for the missing substance.
 *   - The accumulated graph is the planner's input. The extractor emits
 *     source-grounded missing-context questions without relying on a fixed
 *     semantic taxonomy.
 */

import type { LLMProvider, LLMMessage } from './llm/types';
import type { EvidenceLevel } from './livingContext/types';

export interface ContextualSemanticTerm {
  surface: string;
  relationship: string;
  weight: number;
  evidenceLevel: EvidenceLevel | null;
  strength: number | null;
}

export interface ContextualStatement {
  /** Answer-local id (e.g. "n1") used by edges. */
  id: string;
  /** Open, source-backed semantic classification. */
  type: string;
  /**
   * Context-carrying phrase, embedded as-is. Never a bare token:
   * "chose Kafka for ordered clickstream replay", not "kafka".
   */
  phrase: string;
  /** The bare entity mentioned, when one exists (e.g. "Kafka"). */
  surface: string | null;
  /** Exact contiguous quote copied from the candidate answer. */
  sourceQuote?: string | null;
  /** Open source terms explicitly emitted by the extractor. */
  semanticTerms?: ContextualSemanticTerm[];
  /** Extraction certainty, not candidate quality. */
  confidence?: number | null;
}

export interface ContextualEdge {
  from: string;
  to: string;
  /** Open relationship meaning, persisted as data. */
  predicate: string;
}

export interface ContextualDecomposition {
  statements: ContextualStatement[];
  edges: ContextualEdge[];
  /** True when the whole answer yielded no concrete material. */
  discarded: boolean;
  /**
   * Probe text quoting the candidate's own words, present only when the
   * answer was discarded (the discard is what triggers the probe).
   */
  probe: string | null;
  /** Source-grounded questions that would materially deepen this answer. */
  missingContext: string[];
}

const DECOMPOSITION_VERSION = 'contextual_v3_source_exact_open_semantics';

export function contextualDecompositionVersion(): string {
  return DECOMPOSITION_VERSION;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You decompose an interview answer into a small open semantic graph.

Rules:
1. Every "phrase" must carry its context. Preserve the mechanism, constraint, action, business object, and outcome that make the statement specific.
2. Only extract CONCRETE material: named technologies, named orgs/people, real decisions, measurable outcomes, specific situations. A sentence like "I worked closely with the team to solve problems" yields NOTHING.
3. If the entire answer yields no concrete material, return empty statements/edges, set "discarded" to true, and write ONE probe question that quotes the candidate's own words and asks for the missing substance (which system? what did you change? what happened?). Otherwise "discarded" is false and "probe" is null.
4. Do not re-extract material listed under "Already captured" — only genuinely new statements.
5. "type" is an open, short description of what the statement represents. Do not choose from or invent a global taxonomy.
6. "predicate" is an open relationship phrase grounded in the answer. New predicates are valid and must not be normalized into a fixed vocabulary.
7. Include concise "missingContext" questions only for facts that would materially clarify ownership, causality, constraints, mechanisms, or outcomes in this specific answer.

8. "sourceQuote" must be an exact contiguous quote copied from the candidate answer.
9. "semanticTerms" are open data, not a known list. Every surface must appear verbatim in sourceQuote. Emit evidenceLevel and strength only when the quote establishes them.

Respond with JSON only:
{
  "statements": [{
    "id": "n1",
    "type": "source-backed classification",
    "phrase": "standalone contextual statement",
    "surface": null,
    "sourceQuote": "exact quote from answer",
    "confidence": 0.0,
    "semanticTerms": [{
      "surface": "exact source term",
      "relationship": "open phrase describing its role in the statement",
      "weight": 0.0,
      "evidenceLevel": "mentioned | used | explained | selected | implemented | demonstrated | validated",
      "strength": 0.0
    }]
  }],
  "edges": [{"from": "n1", "to": "n2", "predicate": "source-backed relationship"}],
  "discarded": false,
  "probe": null,
  "missingContext": ["specific follow-up question"]
}`;
}

export interface DecomposeAnswerInput {
  question: string;
  answer: string;
  /** Phrases already in the candidate's contextual graph (dedup). */
  priorPhrases: string[];
}

function buildUserMessage(input: DecomposeAnswerInput): string {
  const prior =
    input.priorPhrases.length > 0
      ? input.priorPhrases
          .slice(-40)
          .map((p) => `- ${p}`)
          .join('\n')
      : '(none yet)';
  return `Question asked:\n${input.question}\n\nCandidate answer:\n${input.answer}\n\nAlready captured:\n${prior}`;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function parseOpenSemanticLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const label = v.normalize('NFKC').trim();
  if (label.length === 0 || label.length > 160 || /[\u0000-\u001f\u007f]/.test(label)) {
    return null;
  }
  return label;
}

function parseUnitScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function parseEvidenceLevel(value: unknown): EvidenceLevel | null {
  return value === 'mentioned'
    || value === 'used'
    || value === 'explained'
    || value === 'selected'
    || value === 'implemented'
    || value === 'demonstrated'
    || value === 'validated'
    ? value
    : null;
}

export function parseContextualDecomposition(
  raw: unknown,
): ContextualDecomposition {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;

  const statements: ContextualStatement[] = [];
  if (Array.isArray(r.statements)) {
    for (const s of r.statements) {
      if (!s || typeof s !== 'object') continue;
      const st = s as Record<string, unknown>;
      const type = parseOpenSemanticLabel(st.type);
      if (
        typeof st.id !== 'string' ||
        !type ||
        typeof st.phrase !== 'string' ||
        st.phrase.trim().length === 0
      ) {
        continue;
      }
      statements.push({
        id: st.id,
        type,
        phrase: st.phrase.trim(),
        surface:
          typeof st.surface === 'string' && st.surface.trim().length > 0
            ? st.surface.trim()
            : null,
        sourceQuote:
          typeof st.sourceQuote === 'string' && st.sourceQuote.trim().length > 0
            ? st.sourceQuote.trim()
            : null,
        semanticTerms: Array.isArray(st.semanticTerms)
          ? st.semanticTerms.flatMap((value): ContextualSemanticTerm[] => {
              if (!value || typeof value !== 'object') return [];
              const term = value as Record<string, unknown>;
              const surface = parseOpenSemanticLabel(term.surface);
              const relationship = parseOpenSemanticLabel(term.relationship);
              const weight = parseUnitScore(term.weight);
              if (!surface || !relationship || weight === null) return [];
              return [{
                surface,
                relationship,
                weight,
                evidenceLevel: parseEvidenceLevel(term.evidenceLevel),
                strength: parseUnitScore(term.strength),
              }];
            })
          : [],
        confidence: parseUnitScore(st.confidence),
      });
    }
  }

  const statementIds = new Set(statements.map((s) => s.id));
  const edges: ContextualEdge[] = [];
  if (Array.isArray(r.edges)) {
    for (const e of r.edges) {
      if (!e || typeof e !== 'object') continue;
      const ed = e as Record<string, unknown>;
      const predicate = parseOpenSemanticLabel(ed.predicate ?? ed.type);
      if (
        typeof ed.from !== 'string' ||
        typeof ed.to !== 'string' ||
        !predicate
      ) {
        continue;
      }
      // "candidate" is a valid implicit source for DID/OBSERVED edges.
      const fromOk = statementIds.has(ed.from) || ed.from === 'candidate';
      if (!fromOk || !statementIds.has(ed.to)) continue;
      edges.push({ from: ed.from, to: ed.to, predicate });
    }
  }

  const discarded = statements.length === 0 ? true : r.discarded === true;
  const probe =
    typeof r.probe === 'string' && r.probe.trim().length > 0
      ? r.probe.trim()
      : null;
  const missingContext = Array.isArray(r.missingContext)
    ? r.missingContext.flatMap((value) => {
        if (typeof value !== 'string') return [];
        const question = value.trim();
        return question.length > 0 && question.length <= 500 ? [question] : [];
      })
    : [];

  return {
    statements,
    edges,
    discarded,
    probe: discarded ? probe : null,
    missingContext,
  };
}

// ─── LLM call ────────────────────────────────────────────────────────────────

/**
 * Attempt to repair common JSON truncation patterns.
 * This is a simple heuristic to recover from LLM output truncation.
 */
function attemptJsonRepair(content: string): string | null {
  const trimmed = content.trim();
  
  // If it's already valid JSON, return as-is
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue to repair attempts
  }

  // Try to close open brackets/braces
  const openBraces = (trimmed.match(/\{/g) || []).length;
  const closeBraces = (trimmed.match(/\}/g) || []).length;
  const openBrackets = (trimmed.match(/\[/g) || []).length;
  const closeBrackets = (trimmed.match(/\]/g) || []).length;

  let repaired = trimmed;
  
  // Close missing brackets
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }

  // Try parsing the repaired version
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    // Repair failed
  }

  return null;
}

/**
 * Decompose one answer into contextual statements + edges.
 * Returns null on provider absence or any LLM/parse failure — callers fall
 * back to the legacy STAR analysis path.
 */
export async function decomposeAnswerContextually(
  provider: LLMProvider | null,
  input: DecomposeAnswerInput,
): Promise<ContextualDecomposition | null> {
  if (!provider) return null;

  const attemptDecomposition = async (
    messages: LLMMessage[],
    maxTokens: number,
  ): Promise<ContextualDecomposition | null> => {
    let content: string;
    try {
      const completion = await provider.complete(messages, {
        forceJson: true,
        maxTokens,
      });
      content = (completion.content ?? '').trim();
    } catch (err) {
      console.error('[contextualDecomposition] LLM call failed:', err);
      return null;
    }

    if (!content) {
      console.warn('[contextualDecomposition] LLM returned empty content.');
      return null;
    }

    // Try direct parse first
    try {
      const parsed = JSON.parse(content) as unknown;
      return parseAndDedup(parsed, input);
    } catch (err) {
      console.warn(
        '[contextualDecomposition] Direct JSON parse failed, attempting repair:',
        content.slice(0, 300),
      );
    }

    // Try JSON repair
    const repaired = attemptJsonRepair(content);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired) as unknown;
        console.log('[contextualDecomposition] JSON repair succeeded');
        return parseAndDedup(parsed, input);
      } catch (err) {
        console.warn('[contextualDecomposition] Repaired JSON still invalid:', err);
      }
    }

    return null;
  };

  const parseAndDedup = (
    parsed: unknown,
    inp: DecomposeAnswerInput,
  ): ContextualDecomposition => {
    const decomposition = parseContextualDecomposition(parsed);
    // Dedup against prior phrases: drop statements whose phrase already exists.
    const prior = new Set(
      inp.priorPhrases.map((p) => normalizePhrase(p)),
    );
    const fresh = decomposition.statements
      .filter((s) => !prior.has(normalizePhrase(s.phrase)))
      .map((statement) => {
        const sourceQuote = statement.sourceQuote
          && inp.answer.includes(statement.sourceQuote)
          ? statement.sourceQuote
          : null;
        const semanticTerms = sourceQuote
          ? (statement.semanticTerms ?? []).filter((term) =>
              sourceQuote.includes(term.surface)
            )
          : [];
        return {
          ...statement,
          sourceQuote,
          surface: statement.surface && inp.answer.includes(statement.surface)
            ? statement.surface
            : null,
          semanticTerms,
        };
      });
    const freshIds = new Set(fresh.map((s) => s.id));
    const freshEdges = decomposition.edges.filter(
      (e) =>
        (freshIds.has(e.from) || e.from === 'candidate') && freshIds.has(e.to),
    );
    if (fresh.length === 0) {
      return {
        statements: [],
        edges: [],
        discarded: true,
        probe: decomposition.probe,
        missingContext: decomposition.missingContext,
      };
    }
    return { ...decomposition, statements: fresh, edges: freshEdges };
  };

  // First attempt with increased token limit
  const messages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserMessage(input) },
  ];

  const firstAttempt = await attemptDecomposition(messages, 2048);
  if (firstAttempt) {
    return firstAttempt;
  }

  // Retry with shorter phrases instruction
  console.warn('[contextualDecomposition] First attempt failed, retrying with shorter phrases instruction');
  const retryMessages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt() + '\n\nIMPORTANT: Keep phrases SHORT and CONCISE. Use fewer words per phrase to avoid truncation.' },
    { role: 'user', content: buildUserMessage(input) },
  ];

  const retryAttempt = await attemptDecomposition(retryMessages, 2048);
  if (retryAttempt) {
    console.log('[contextualDecomposition] Retry with shorter phrases succeeded');
    return retryAttempt;
  }

  console.error('[contextualDecomposition] Both attempts failed, returning null');
  return null;
}

export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ─── Missing-context analysis (planner input) ────────────────────────────────

export interface ConversationGraphStatement {
  type: string;
  phrase: string;
}

export interface ConversationGraphView {
  statements: ConversationGraphStatement[];
  /**
   * Human-readable missing-context targets for the planner, e.g.
   * 'Action "rebuilt ingestion layer at Streamline" has no BECAUSE — ask why.'
   */
  missingContext: string[];
}

/**
 * Build the planner view without interpreting semantic labels in code.
 */
export function buildConversationGraphView(
  decompositions: Array<
    Pick<ContextualDecomposition, 'statements' | 'edges'> &
      Partial<Pick<ContextualDecomposition, 'missingContext'>>
  >,
): ConversationGraphView {
  const statements: ConversationGraphStatement[] = [];
  const missingContext: string[] = [];

  for (const dec of decompositions) {
    for (const s of dec.statements) {
      statements.push({ type: s.type, phrase: s.phrase });
    }
    for (const gap of dec.missingContext ?? []) {
      if (!missingContext.includes(gap)) missingContext.push(gap);
    }
  }

  return { statements, missingContext };
}
