import { describe, expect, it } from 'vitest';
import type { CandidateNode } from '../../../types';
import { candidateNodeTerms } from '../compatibility';

function node(properties: Record<string, unknown>): CandidateNode {
  return {
    id: 'node-1',
    candidate_id: 'candidate-1',
    node_type: 'PreviouslyUnseenClassification',
    narrative_text: 'Source-backed narrative',
    extracted_properties_json: JSON.stringify(properties),
    embedding_json: null,
    source_type: 'previously_unseen_source',
    source_reference: 'source-1',
    captured_at: 1,
    confidence: 0.8,
    supersedes: null,
    superseded_at: null,
    decomposition_version: 'test',
    created_at: 1,
    updated_at: 1,
  };
}

describe('candidateNodeTerms', () => {
  it('does not turn arbitrary property values into semantic concepts', () => {
    const terms = candidateNodeTerms(node({
      date_range: '2013-2014',
      team_size: '20+',
      administrative_label: 'Region 7',
    }));

    expect(terms).toEqual([]);
  });

  it('promotes only extractor-explicit open terms to signal evidence', () => {
    const terms = candidateNodeTerms(node({
      date_range: '2013-2014',
      semantic_terms: [{
        surface: 'Temporal workflow compensation',
        canonical_key: 'term:temporal-workflow-compensation',
        evidence_level: 'demonstrated',
      }],
    }));

    expect(terms).toEqual([expect.objectContaining({
      canonicalKey: 'term:temporal-workflow-compensation',
      signalEligible: true,
      evidenceLevel: 'demonstrated',
    })]);
  });

  it('keeps an unseen invalid-evidence term searchable without fabricating a signal level', () => {
    const terms = candidateNodeTerms(node({
      semantic_terms: [{
        surface: 'Novel Source Surface',
        canonical_key: 'technology:kafka',
        evidence_level: 'not-a-protocol-level',
      }],
    }));
    expect(terms).toEqual([{
      surface: 'Novel Source Surface',
      canonicalKey: 'technology:kafka',
      signalEligible: false,
      evidenceLevel: null,
    }]);
  });
});
