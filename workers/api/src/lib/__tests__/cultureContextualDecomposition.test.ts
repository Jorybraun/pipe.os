import { describe, it, expect } from 'vitest';
import {
  parseContextualDecomposition,
  decomposeAnswerContextually,
  buildConversationGraphView,
  normalizePhrase,
} from '../cultureContextualDecomposition';
import { sharedGrounding } from '../neo4j/contextualGraph';
import type { LLMProvider } from '../llm/types';

function makeProvider(content: string): LLMProvider {
  return {
    complete: async () => ({ content }),
  } as unknown as LLMProvider;
}

describe('parseContextualDecomposition', () => {
  it('parses valid statements and edges', () => {
    const result = parseContextualDecomposition({
      statements: [
        { id: 'n1', type: 'Action', phrase: 'rebuilt ingestion layer at Streamline', surface: null },
        { id: 'n2', type: 'Tech', phrase: 'chose Kafka for ordered clickstream replay', surface: 'Kafka' },
      ],
      edges: [
        { from: 'candidate', to: 'n1', predicate: 'personally implemented' },
        { from: 'n1', to: 'n2', predicate: 'used for ordered replay' },
      ],
      discarded: false,
      probe: null,
      missingContext: [],
    });

    expect(result.statements).toHaveLength(2);
    expect(result.statements[1]!.surface).toBe('Kafka');
    expect(result.edges).toHaveLength(2);
    expect(result.discarded).toBe(false);
    expect(result.probe).toBeNull();
  });

  it('preserves unseen semantic node types and drops malformed statements', () => {
    const result = parseContextualDecomposition({
      statements: [
        { id: 'n1', type: 'OperationalTradeoff', phrase: 'accepted duplicate delivery during failover' },
        { id: 'n2', type: 'Tech', phrase: '   ' },
        { id: 'n3', type: 'Tech', phrase: 'migrated auth to OAuth2', surface: 'OAuth2' },
      ],
      edges: [],
    });
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]!.type).toBe('OperationalTradeoff');
  });

  it('preserves unseen predicates and drops malformed or dangling edges', () => {
    const result = parseContextualDecomposition({
      statements: [{ id: 'n1', type: 'Action', phrase: 'rewrote the billing cron', surface: null }],
      edges: [
        { from: 'n1', to: 'n9', predicate: 'used' },
        { from: 'n1', to: 'n1', predicate: '' },
        { from: 'candidate', to: 'n1', predicate: 'took direct ownership of' },
      ],
      discarded: false,
    });
    expect(result.edges).toEqual([
      { from: 'candidate', to: 'n1', predicate: 'took direct ownership of' },
    ]);
  });

  it('forces discarded=true when no statements survive, and keeps probe only then', () => {
    const discardedResult = parseContextualDecomposition({
      statements: [],
      edges: [],
      discarded: false,
      probe: 'You said "we solved problems" — which system, and what did you change?',
    });
    expect(discardedResult.discarded).toBe(true);
    expect(discardedResult.probe).toContain('which system');

    const keptResult = parseContextualDecomposition({
      statements: [{ id: 'n1', type: 'Outcome', phrase: 'cut p99 from 40ms to 9ms', surface: null }],
      edges: [],
      discarded: false,
      probe: 'should be dropped',
    });
    expect(keptResult.discarded).toBe(false);
    expect(keptResult.probe).toBeNull();
  });
});

describe('decomposeAnswerContextually', () => {
  it('returns null without a provider or on invalid JSON', async () => {
    expect(
      await decomposeAnswerContextually(null, { question: 'q', answer: 'a', priorPhrases: [] }),
    ).toBeNull();
    expect(
      await decomposeAnswerContextually(makeProvider('not json'), {
        question: 'q',
        answer: 'a',
        priorPhrases: [],
      }),
    ).toBeNull();
  });

  it('dedups statements already captured and discards when nothing new remains', async () => {
    const payload = JSON.stringify({
      statements: [
        { id: 'n1', type: 'Tech', phrase: 'Chose Kafka for ordered clickstream replay', surface: 'Kafka' },
      ],
      edges: [{ from: 'candidate', to: 'n1', predicate: 'personally selected' }],
      discarded: false,
      probe: null,
      missingContext: [],
    });
    const result = await decomposeAnswerContextually(makeProvider(payload), {
      question: 'q',
      answer: 'a',
      priorPhrases: ['chose kafka for  ordered clickstream replay'],
    });
    expect(result).not.toBeNull();
    expect(result!.statements).toHaveLength(0);
    expect(result!.discarded).toBe(true);
  });

  it('keeps fresh statements and their edges', async () => {
    const payload = JSON.stringify({
      statements: [
        { id: 'n1', type: 'Action', phrase: 'rebuilt ingestion layer at Streamline', surface: null },
        { id: 'n2', type: 'Reason', phrase: 'needed ordered replay of clickstream data', surface: null },
      ],
      edges: [{ from: 'n1', to: 'n2', predicate: 'chosen because' }],
      discarded: false,
      probe: null,
      missingContext: ['What tradeoff did ordered replay impose?'],
    });
    const result = await decomposeAnswerContextually(makeProvider(payload), {
      question: 'q',
      answer: 'a',
      priorPhrases: [],
    });
    expect(result!.statements).toHaveLength(2);
    expect(result!.edges).toEqual([{ from: 'n1', to: 'n2', predicate: 'chosen because' }]);
  });
});

describe('normalizePhrase', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizePhrase('  Chose   Kafka  ')).toBe('chose kafka');
  });
});

describe('buildConversationGraphView', () => {
  it('uses source-grounded missing-context questions without interpreting labels', () => {
    const view = buildConversationGraphView([
      {
        statements: [
          { id: 'n1', type: 'PreviouslyUnseenDecision', phrase: 'rebuilt ingestion layer', surface: null },
          { id: 'n2', type: 'MeasuredEffect', phrase: 'p99 dropped to 9ms', surface: null },
        ],
        edges: [],
        missingContext: [
          'Why was rebuilding preferable to changing the existing consumer?',
          'What did you personally implement?',
        ],
      },
    ]);
    expect(view.statements).toHaveLength(2);
    expect(view.missingContext).toEqual([
      'Why was rebuilding preferable to changing the existing consumer?',
      'What did you personally implement?',
    ]);
  });

  it('deduplicates missing-context questions across turns', () => {
    const view = buildConversationGraphView([
      {
        statements: [{ id: 'n1', type: 'Decision', phrase: 'rebuilt ingestion layer', surface: null }],
        edges: [],
        missingContext: ['What constraint made this necessary?'],
      },
      {
        statements: [{ id: 'n2', type: 'Constraint', phrase: 'ordered replay was required', surface: null }],
        edges: [],
        missingContext: ['What constraint made this necessary?'],
      },
    ]);
    expect(view.missingContext).toEqual(['What constraint made this necessary?']);
  });
});

describe('sharedGrounding', () => {
  it('returns shared concrete tokens', () => {
    const shared = sharedGrounding(
      'chose Kafka for ordered clickstream replay',
      'Async messaging stack built on Kafka consumers',
    );
    expect(shared).toEqual(['kafka']);
  });

  it('returns null when only stopwords or no overlap', () => {
    expect(
      sharedGrounding('worked with the team on the system', 'a project for the team'),
    ).toBeNull();
    expect(sharedGrounding('chose Kafka', 'built a React UI')).toBeNull();
  });
});
