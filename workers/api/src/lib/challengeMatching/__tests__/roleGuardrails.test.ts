import { describe, expect, it } from 'vitest';
import { loadRoleChallengeSemantics } from '../roleGuardrails';

function d1(rows: unknown[], contextRows: unknown[] = []): D1Database {
  return {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const statement = {
        bind() { return statement; },
        async all() {
          return {
            results: normalized.includes('FROM context_records cr') ? contextRows : rows,
            success: true,
            meta: {},
          };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe('loadRoleChallengeSemantics', () => {
  it('loads selected open terms from persisted role nodes as source-backed relevance', async () => {
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
      job_description_md: null,
      non_negotiable_skills_json: JSON.stringify(['A Technology Never Seen Before']),
    });

    expect(semantics.relevantConcepts).toEqual(['term:a-technology-never-seen-before']);
    expect(semantics.requiredConcepts).toEqual([]);
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
      job_description_md: null,
      non_negotiable_skills_json: null,
    });

    expect(semantics.relevantConcepts).toEqual(['term:temporal-fanout']);
    expect(semantics.requiredConcepts).toEqual([]);
  });

  it('does not turn legacy role-node prose into semantic concepts', async () => {
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
      job_description_md: null,
      non_negotiable_skills_json: JSON.stringify(['Understanding of code']),
    });

    expect(semantics.relevantConcepts).toEqual([]);
    expect(semantics.requiredConcepts).toEqual([]);
  });

  it('does not derive matcher constraints from legacy RCD fallback fields', async () => {
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
      job_description_md: null,
      non_negotiable_skills_json: JSON.stringify(['Understanding of code']),
    });

    expect(semantics.relevantConcepts).toEqual([]);
    expect(semantics.requiredConcepts).toEqual([]);
    expect(semantics.sources).toEqual([]);
  });

  it('does not promote legacy role-node value fields into semantic constraints', async () => {
    const semantics = await loadRoleChallengeSemantics(d1([{
      id: 'node-value',
      rcd_version: '1.0.0',
      source_section: 'technical_context.stack',
      narrative_text: 'Legacy parser put a display value in properties.',
      extracted_properties_json: JSON.stringify({
        value: 'Kafka idempotency',
      }),
    }]), {
      id: 'role-value',
      rcd_version: '1.0.0',
      rcd_json: null,
      job_description_md: null,
      non_negotiable_skills_json: JSON.stringify(['Kafka idempotency']),
    });

    expect(semantics.relevantConcepts).toEqual([]);
    expect(semantics.requiredConcepts).toEqual([]);
    expect(semantics.sources).toEqual([]);
  });

  it('uses selected simple JD terms only when the original JD text contains them', async () => {
    const semantics = await loadRoleChallengeSemantics(d1([]), {
      id: 'role-jd',
      rcd_version: null,
      rcd_json: null,
      job_description_md: 'We need Kafka idempotency work on order processing. Logging is useful.',
      non_negotiable_skills_json: JSON.stringify(['Kafka idempotency', 'Temporal fanout']),
    });

    expect(semantics.roleSnapshotId).toBe('role-context:role-jd:source-backed:simple-jd');
    expect(semantics.relevantConcepts).toEqual(['term:kafka-idempotency']);
    expect(semantics.requiredConcepts).toEqual([]);
    expect(semantics.sources).toEqual([expect.objectContaining({
      roleNodeId: 'role-context:role-jd:job-description',
      sourceSection: 'job_description_md',
      conceptKeys: ['term:kafka-idempotency'],
    })]);
  });

  it('loads selected simple JD terms from source-backed role context records', async () => {
    const semantics = await loadRoleChallengeSemantics(d1([], [{
      context_record_id: 'context-record-jd',
      record_type: 'simple_job_description',
      extraction_version: 'simple-jd-v1',
      canonical_key: 'term:temporal-shard-knitting',
      label: 'Temporal Shard Knitting',
      source_ref_type: 'source_span',
      source_ref_id: 'jd-span-1',
      source_span_id: 'jd-span-1',
      exact_text: 'Temporal Shard Knitting',
      content_hash: 'sha256:jd',
    }]), {
      id: 'role-jd-context',
      rcd_version: null,
      rcd_json: null,
      job_description_md: 'We need Temporal Shard Knitting for event scheduling.',
      non_negotiable_skills_json: JSON.stringify(['Temporal Shard Knitting']),
    });

    expect(semantics.roleSnapshotId).toBe('role-context:role-jd-context:source-backed:simple-jd-v1');
    expect(semantics.relevantConcepts).toEqual(['term:temporal-shard-knitting']);
    expect(semantics.requiredConcepts).toEqual([]);
    expect(semantics.sources).toEqual([
      {
        roleNodeId: 'context-record-jd',
        entityId: 'context-record-jd',
        sourceSection: 'simple_job_description:source_span:jd-span-1',
        locator: 'simple_job_description:source_span:jd-span-1',
        rcdVersion: 'simple-jd-v1',
        sourceRefType: 'source_span',
        sourceRefId: 'jd-span-1',
        sourceSpanId: 'jd-span-1',
        exactText: 'Temporal Shard Knitting',
        contentHash: 'sha256:jd',
        conceptKeys: ['term:temporal-shard-knitting'],
      },
    ]);
  });

  it('compacts source-backed TypeScript and JavaScript role terms for repo packet guardrails', async () => {
    const semantics = await loadRoleChallengeSemantics(d1([], [
      {
        context_record_id: 'context-record-jd',
        record_type: 'simple_job_description',
        extraction_version: 'simple-jd-v1',
        canonical_key: 'term:type-script',
        label: 'TypeScript',
        source_ref_type: 'source_span',
        source_ref_id: 'jd-span-1',
        source_span_id: 'jd-span-1',
        exact_text: 'TypeScript and JavaScript test runner work.',
        content_hash: 'sha256:jd',
      },
      {
        context_record_id: 'context-record-jd',
        record_type: 'simple_job_description',
        extraction_version: 'simple-jd-v1',
        canonical_key: 'term:java-script-test-runner',
        label: 'JavaScript test runner',
        source_ref_type: 'source_span',
        source_ref_id: 'jd-span-1',
        source_span_id: 'jd-span-1',
        exact_text: 'TypeScript and JavaScript test runner work.',
        content_hash: 'sha256:jd',
      },
    ]), {
      id: 'role-jd-context',
      rcd_version: null,
      rcd_json: null,
      job_description_md: 'TypeScript and JavaScript test runner work.',
      non_negotiable_skills_json: JSON.stringify(['TypeScript', 'JavaScript test runner']),
    });

    expect(semantics.relevantConcepts).toEqual([
      'term:javascript-test-runner',
      'term:typescript',
    ]);
    expect(semantics.requiredConcepts).toEqual([]);
    expect(semantics.sources[0]?.conceptKeys).toEqual([
      'term:javascript-test-runner',
      'term:typescript',
    ]);
  });
});
