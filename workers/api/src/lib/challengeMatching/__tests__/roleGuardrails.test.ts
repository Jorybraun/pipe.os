import { describe, expect, it } from 'vitest';
import { loadRoleChallengeSemantics } from '../roleGuardrails';

function d1(rows: unknown[]): D1Database {
  return {
    prepare() {
      const statement = {
        bind() { return statement; },
        async all() { return { results: rows, success: true, meta: {} }; },
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe('loadRoleChallengeSemantics', () => {
  it('loads open terms from persisted role nodes without a code-owned skill map', async () => {
    const semantics = await loadRoleChallengeSemantics(d1([{
      id: 'node-1',
      rcd_version: '2.0.0',
      source_section: 'technical_context.stack',
      narrative_text: 'A Technology Never Seen Before',
      extracted_properties_json: JSON.stringify({
        semantic_terms: [
          { surface: 'A Technology Never Seen Before', canonical_key: 'term:a-technology-never-seen-before' },
        ],
      }),
    }]), {
      id: 'role-1',
      rcd_version: '2.0.0',
      rcd_json: null,
      non_negotiable_skills_json: JSON.stringify(['A Technology Never Seen Before']),
    });

    expect(semantics.relevantConcepts).toEqual(['term:a-technology-never-seen-before']);
    expect(semantics.requiredConcepts).toEqual(['term:a-technology-never-seen-before']);
    expect(semantics.sources[0]?.sourceSection).toBe('technical_context.stack');
  });

  it('keeps unselected role terms relevant without making them hard constraints', async () => {
    const semantics = await loadRoleChallengeSemantics(d1([{
      id: 'node-1',
      rcd_version: '2.0.0',
      source_section: 'technical_context.constructs',
      narrative_text: 'Temporal fanout',
      extracted_properties_json: JSON.stringify({
        semantic_terms: [{ surface: 'Temporal fanout', canonical_key: 'term:temporal-fanout' }],
      }),
    }]), {
      id: 'role-1',
      rcd_version: '2.0.0',
      rcd_json: null,
      non_negotiable_skills_json: null,
    });

    expect(semantics.relevantConcepts).toEqual(['term:temporal-fanout']);
    expect(semantics.requiredConcepts).toEqual([]);
  });

  it('uses exact source-backed node narratives when legacy properties lack terms', async () => {
    const semantics = await loadRoleChallengeSemantics(d1([{
      id: 'node-legacy',
      rcd_version: '1.0.0',
      source_section: 'technical_context.codebase_expectations',
      narrative_text: 'Understanding of code',
      extracted_properties_json: '{}',
    }]), {
      id: 'role-legacy',
      rcd_version: '1.0.0',
      rcd_json: null,
      non_negotiable_skills_json: JSON.stringify(['Understanding of code']),
    });

    expect(semantics.relevantConcepts).toEqual(['term:understanding-of-code']);
    expect(semantics.requiredConcepts).toEqual(['term:understanding-of-code']);
  });

  it('merges exact RCD terms when legacy role-node narratives contain prefixes', async () => {
    const semantics = await loadRoleChallengeSemantics(d1([{
      id: 'node-prefixed',
      rcd_version: '1.0.0',
      source_section: 'technical_context.codebase_expectations',
      narrative_text: 'CodebaseExpectation: Understanding of code',
      extracted_properties_json: '{}',
    }]), {
      id: 'role-prefixed',
      rcd_version: '1.0.0',
      rcd_json: JSON.stringify({
        technical_context: {
          stack: [],
          constructs: [],
          codebase_expectations: ['Understanding of code'],
        },
        consumer_slice: {
          mustHaveSkills: ['Understanding of code'],
          niceToHaveSkills: [],
        },
      }),
      non_negotiable_skills_json: JSON.stringify(['Understanding of code']),
    });

    expect(semantics.relevantConcepts).toContain('term:understanding-of-code');
    expect(semantics.requiredConcepts).toEqual(['term:understanding-of-code']);
    expect(semantics.sources).toContainEqual(expect.objectContaining({
      roleNodeId: 'role-context:role-prefixed',
      sourceSection: 'technical_context.codebase_expectations',
    }));
  });
});
