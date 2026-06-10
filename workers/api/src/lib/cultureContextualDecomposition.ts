/**
 * cultureContextualDecomposition.ts — ADR-050 Contextual Conversation Graph
 *
 * Decomposes a single interview answer into a typed semantic graph:
 * Action / Tech / Org / Person / Reason / Outcome / Situation nodes connected
 * by DID / OBSERVED / WITH / REPLACED / BECAUSE / ACHIEVED / IN_SITUATION /
 * AT / WITH_PERSON edges.
 *
 * Rules (from ADR-050):
 *   - Every node carries a contextual phrase ("chose Kafka for ordered
 *     clickstream replay"), never a bare token ("kafka"). The phrase is what
 *     gets embedded.
 *   - Generic sentences with no named entity, decision, or outcome are
 *     discarded. A fully-discarded answer triggers a probe — LLM-written,
 *     quoting the candidate's own words — asking for the missing substance.
 *   - The accumulated graph is the planner's input: missing-context targets
 *     (Action without BECAUSE, Action without ACHIEVED, Outcome without DID)
 *     drive the next question.
 */

import type { LLMProvider, LLMMessage } from './llm/types';

export const CONTEXTUAL_NODE_TYPES = [
  'Action',
  'Tech',
  'Org',
  'Person',
  'Reason',
  'Outcome',
  'Situation',
] as const;

export type ContextualNodeType = (typeof CONTEXTUAL_NODE_TYPES)[number];

export const CONTEXTUAL_EDGE_TYPES = [
  'DID',
  'OBSERVED',
  'WITH',
  'REPLACED',
  'BECAUSE',
  'ACHIEVED',
  'IN_SITUATION',
  'AT',
  'WITH_PERSON',
] as const;

export type ContextualEdgeType = (typeof CONTEXTUAL_EDGE_TYPES)[number];

export interface ContextualStatement {
  /** Answer-local id (e.g. "n1") used by edges. */
  id: string;
  type: ContextualNodeType;
  /**
   * Context-carrying phrase, embedded as-is. Never a bare token:
   * "chose Kafka for ordered clickstream replay", not "kafka".
   */
  phrase: string;
  /** The bare entity mentioned, when one exists (e.g. "Kafka"). */
  surface: string | null;
}

export interface ContextualEdge {
  from: string;
  to: string;
  type: ContextualEdgeType;
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
}

const DECOMPOSITION_VERSION = 'contextual_v1';

export function contextualDecompositionVersion(): string {
  return DECOMPOSITION_VERSION;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You decompose an interview answer into a small typed semantic graph.

Node types: Action (something the candidate did), Tech (a named technology, framed in its context), Org (a named company/team), Person (a named collaborator/role), Reason (why a decision was made), Outcome (a concrete result, ideally with numbers), Situation (the problem context).

Edge types: DID (candidate->Action), OBSERVED (candidate->Action they witnessed but did not own), WITH (Action->Tech used), REPLACED (Action->Tech removed), BECAUSE (Action->Reason), ACHIEVED (Action->Outcome), IN_SITUATION (Action->Situation), AT (Action->Org), WITH_PERSON (Action->Person).

Rules:
1. Every "phrase" must carry its context. Write "chose Kafka for ordered clickstream replay", never "kafka". Write "cut p99 latency from 40ms to 9ms on the ingestion path", never "improved performance".
2. Only extract CONCRETE material: named technologies, named orgs/people, real decisions, measurable outcomes, specific situations. A sentence like "I worked closely with the team to solve problems" yields NOTHING.
3. If the entire answer yields no concrete material, return empty statements/edges, set "discarded" to true, and write ONE probe question that quotes the candidate's own words and asks for the missing substance (which system? what did you change? what happened?). Otherwise "discarded" is false and "probe" is null.
4. Do not re-extract material listed under "Already captured" — only genuinely new statements.
5. Use DID only when the candidate personally owned the work; use OBSERVED when they describe someone else's work.

Respond with JSON only:
{
  "statements": [{"id": "n1", "type": "Action", "phrase": "...", "surface": null}],
  "edges": [{"from": "n1", "to": "n2", "type": "WITH"}],
  "discarded": false,
  "probe": null
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

function isContextualNodeType(v: unknown): v is ContextualNodeType {
  return (
    typeof v === 'string' &&
    (CONTEXTUAL_NODE_TYPES as readonly string[]).includes(v)
  );
}

function isContextualEdgeType(v: unknown): v is ContextualEdgeType {
  return (
    typeof v === 'string' &&
    (CONTEXTUAL_EDGE_TYPES as readonly string[]).includes(v)
  );
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
      if (
        typeof st.id !== 'string' ||
        !isContextualNodeType(st.type) ||
        typeof st.phrase !== 'string' ||
        st.phrase.trim().length === 0
      ) {
        continue;
      }
      statements.push({
        id: st.id,
        type: st.type,
        phrase: st.phrase.trim(),
        surface:
          typeof st.surface === 'string' && st.surface.trim().length > 0
            ? st.surface.trim()
            : null,
      });
    }
  }

  const statementIds = new Set(statements.map((s) => s.id));
  const edges: ContextualEdge[] = [];
  if (Array.isArray(r.edges)) {
    for (const e of r.edges) {
      if (!e || typeof e !== 'object') continue;
      const ed = e as Record<string, unknown>;
      if (
        typeof ed.from !== 'string' ||
        typeof ed.to !== 'string' ||
        !isContextualEdgeType(ed.type)
      ) {
        continue;
      }
      // "candidate" is a valid implicit source for DID/OBSERVED edges.
      const fromOk = statementIds.has(ed.from) || ed.from === 'candidate';
      if (!fromOk || !statementIds.has(ed.to)) continue;
      edges.push({ from: ed.from, to: ed.to, type: ed.type });
    }
  }

  const discarded = statements.length === 0 ? true : r.discarded === true;
  const probe =
    typeof r.probe === 'string' && r.probe.trim().length > 0
      ? r.probe.trim()
      : null;

  return {
    statements,
    edges,
    discarded,
    probe: discarded ? probe : null,
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
    const fresh = decomposition.statements.filter(
      (s) => !prior.has(normalizePhrase(s.phrase)),
    );
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
  type: ContextualNodeType;
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

interface GraphNodeWithEdges {
  type: ContextualNodeType;
  phrase: string;
  outgoing: ContextualEdgeType[];
  incoming: ContextualEdgeType[];
}

/**
 * Walk an accumulated set of contextual decompositions and surface the
 * missing-context targets the ADR defines:
 *   - Action without BECAUSE  → ask why
 *   - Action without ACHIEVED → ask what happened
 *   - Outcome without an owning DID Action → ask about ownership
 */
export function buildConversationGraphView(
  decompositions: Array<Pick<ContextualDecomposition, 'statements' | 'edges'>>,
): ConversationGraphView {
  const nodes = new Map<string, GraphNodeWithEdges>();
  const statements: ConversationGraphStatement[] = [];

  for (let d = 0; d < decompositions.length; d++) {
    const dec = decompositions[d]!;
    const localToGlobal = new Map<string, string>();
    for (const s of dec.statements) {
      const globalId = `${d}:${s.id}`;
      localToGlobal.set(s.id, globalId);
      nodes.set(globalId, {
        type: s.type,
        phrase: s.phrase,
        outgoing: [],
        incoming: [],
      });
      statements.push({ type: s.type, phrase: s.phrase });
    }
    for (const e of dec.edges) {
      const from = localToGlobal.get(e.from);
      const to = localToGlobal.get(e.to);
      if (to) {
        const toNode = nodes.get(to);
        if (toNode) toNode.incoming.push(e.type);
      }
      if (from) {
        const fromNode = nodes.get(from);
        if (fromNode) fromNode.outgoing.push(e.type);
      }
    }
  }

  const missingContext: string[] = [];
  for (const node of nodes.values()) {
    if (node.type === 'Action') {
      if (!node.outgoing.includes('BECAUSE')) {
        missingContext.push(
          `Action "${node.phrase}" has no BECAUSE — ask why they made that choice.`,
        );
      }
      if (!node.outgoing.includes('ACHIEVED')) {
        missingContext.push(
          `Action "${node.phrase}" has no ACHIEVED — ask what concretely happened as a result.`,
        );
      }
    } else if (node.type === 'Outcome') {
      if (
        !node.incoming.includes('ACHIEVED') &&
        !node.incoming.includes('DID')
      ) {
        missingContext.push(
          `Outcome "${node.phrase}" has no owning Action — ask what they personally did to cause it.`,
        );
      }
    }
  }

  return { statements, missingContext };
}
