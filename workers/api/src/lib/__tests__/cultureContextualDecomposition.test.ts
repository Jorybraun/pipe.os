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
        { from: 'candidate', to: 'n1', type: 'DID' },
        { from: 'n1', to: 'n2', type: 'WITH' },
      ],
      discarded: false,
      probe: null,
    });

    expect(result.statements).toHaveLength(2);
    expect(result.statements[1]!.surface).toBe('Kafka');
    expect(result.edges).toHaveLength(2);
    expect(result.discarded).toBe(false);
    expect(result.probe).toBeNull();
  });

  it('drops statements with unknown node types and empty phrases', () => {
    const result = parseContextualDecomposition({
      statements: [
        { id: 'n1', type: 'Skill', phrase: 'kafka' },
        { id: 'n2', type: 'Tech', phrase: '   ' },
        { id: 'n3', type: 'Tech', phrase: 'migrated auth to OAuth2', surface: 'OAuth2' },
      ],
      edges: [],
    });
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]!.id).toBe('n3');
  });

  it('drops edges referencing missing statements or unknown edge types', () => {
    const result = parseContextualDecomposition({
      statements: [{ id: 'n1', type: 'Action', phrase: 'rewrote the billing cron', surface: null }],
      edges: [
        { from: 'n1', to: 'n9', type: 'WITH' },
        { from: 'n1', to: 'n1', type: 'CAUSED' },
        { from: 'candidate', to: 'n1', type: 'DID' },
      ],
      discarded: false,
    });
    expect(result.edges).toEqual([{ from: 'candidate', to: 'n1', type: 'DID' }]);
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
      edges: [{ from: 'candidate', to: 'n1', type: 'DID' }],
      discarded: false,
      probe: null,
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
      edges: [{ from: 'n1', to: 'n2', type: 'BECAUSE' }],
      discarded: false,
      probe: null,
    });
    const result = await decomposeAnswerContextually(makeProvider(payload), {
      question: 'q',
      answer: 'a',
      priorPhrases: [],
    });
    expect(result!.statements).toHaveLength(2);
    expect(result!.edges).toEqual([{ from: 'n1', to: 'n2', type: 'BECAUSE' }]);
  });
});

describe('normalizePhrase', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizePhrase('  Chose   Kafka  ')).toBe('chose kafka');
  });
});

describe('buildConversationGraphView', () => {
  it('surfaces missing BECAUSE/ACHIEVED on Actions and unowned Outcomes', () => {
    const view = buildConversationGraphView([
      {
        statements: [
          { id: 'n1', type: 'Action', phrase: 'rebuilt ingestion layer', surface: null },
          { id: 'n2', type: 'Outcome', phrase: 'p99 dropped to 9ms', surface: null },
        ],
        edges: [],
      },
    ]);
    expect(view.statements).toHaveLength(2);
    expect(view.missingContext).toEqual([
      'Action "rebuilt ingestion layer" has no BECAUSE — ask why they made that choice.',
      'Action "rebuilt ingestion layer" has no ACHIEVED — ask what concretely happened as a result.',
      'Outcome "p99 dropped to 9ms" has no owning Action — ask what they personally did to cause it.',
    ]);
  });

  it('reports no gaps when context is complete', () => {
    const view = buildConversationGraphView([
      {
        statements: [
          { id: 'n1', type: 'Action', phrase: 'rebuilt ingestion layer', surface: null },
          { id: 'n2', type: 'Reason', phrase: 'needed ordered replay', surface: null },
          { id: 'n3', type: 'Outcome', phrase: 'p99 dropped to 9ms', surface: null },
        ],
        edges: [
          { from: 'n1', to: 'n2', type: 'BECAUSE' },
          { from: 'n1', to: 'n3', type: 'ACHIEVED' },
        ],
      },
    ]);
    expect(view.missingContext).toEqual([]);
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
