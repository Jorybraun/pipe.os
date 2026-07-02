import { describe, expect, it } from 'vitest';
import {
  auditAssessmentEvidenceIngestion,
  type QueryClient,
} from './auditAssessmentEvidenceIngestion';

type SqlValue = string | number | null;

class MemoryQueryClient implements QueryClient {
  private readonly tables = new Set<string>();
  private readonly counts = new Map<string, number>();

  addTable(name: string): void {
    this.tables.add(name);
  }

  setCount(key: string, count: number): void {
    this.counts.set(key, count);
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: SqlValue[] = [],
  ): Promise<T[]> {
    if (sql.includes('sqlite_master')) {
      const tableName = params[0];
      return (typeof tableName === 'string' && this.tables.has(tableName)
        ? [{ name: tableName }]
        : []) as T[];
    }
    return [{ count: this.lookupCount(sql, params) }] as T[];
  }

  private lookupCount(sql: string, params: SqlValue[]): number {
    const normalized = sql.replace(/\s+/g, ' ');
    if (normalized.includes('FROM assessment_evidence_events') && normalized.includes('WHERE kind IN')) {
      return this.sumByPrefix('raw:', params);
    }
    if (normalized.includes('FROM ( SELECT source_ref_type FROM assessment_event_source_refs')) {
      return this.sumByPrefix('ref:', params);
    }
    if (normalized.includes("cr.scope_type = 'assessment_session'")) {
      return this.sumByPrefix('assessment:', params);
    }
    if (
      normalized.includes('cr.workspace_person_id IS NOT NULL')
      && normalized.includes('COUNT(DISTINCT cr.id)')
    ) {
      return this.sumByPrefix('person:', params);
    }
    if (
      normalized.includes('GROUP BY cr.workspace_person_id')
      && normalized.includes('HAVING COUNT(*) > 1')
    ) {
      return this.sumByPrefix('duplicate:', params);
    }
    if (normalized.includes("cr.ingestion_key = 'assessment_event_context:' || ev.id")) {
      return this.sumByPrefix('missingProjection:', params);
    }
    if (normalized.includes("c.polarity = 'positive'")) {
      return this.counts.get('sourceLessPositiveClaims') ?? 0;
    }
    return 0;
  }

  private sumByPrefix(prefix: string, params: SqlValue[]): number {
    return params.reduce((sum, param) => {
      if (typeof param !== 'string') return sum;
      return sum + (this.counts.get(`${prefix}${param}`) ?? 0);
    }, 0);
  }
}

function completeClient(): MemoryQueryClient {
  const client = new MemoryQueryClient();
  for (const table of [
    'assessment_sessions',
    'assessment_evidence_events',
    'assessment_event_source_refs',
    'assessment_evaluation_reports',
    'assessment_evaluation_claims',
    'assessment_claim_source_refs',
    'context_records',
    'context_record_source_refs',
  ]) {
    client.addTable(table);
  }
  return client;
}

describe('auditAssessmentEvidenceIngestion', () => {
  it('fails early when required ingestion tables are missing', async () => {
    const audit = await auditAssessmentEvidenceIngestion(new MemoryQueryClient());

    expect(audit.status).toBe('not_ready');
    expect(audit.missingTables).toContain('assessment_sessions');
    expect(audit.families).toHaveLength(0);
  });

  it('classifies raw-only evidence as captured and person-backed evidence as projected', async () => {
    const client = completeClient();
    client.setCount('raw:commit_submission', 1);
    client.setCount('ref:git_commit', 1);
    client.setCount('assessment:assessment_commit_submission', 1);
    client.setCount('missingProjection:commit_submission', 1);
    client.setCount('person:assessment:code_diff', 1);
    client.setCount('person:code_diff', 1);

    const audit = await auditAssessmentEvidenceIngestion(client);
    const commit = audit.families.find((family) => family.key === 'commit_submissions');
    const diff = audit.families.find((family) => family.key === 'diffs');

    expect(commit?.status).toBe('captured');
    expect(diff?.status).toBe('projected');
    expect(audit.failures).toContain('Commit submissions has 1 raw event(s) not projected to person context');
  });

  it('does not treat assessment-scoped context records as person projections', async () => {
    const client = completeClient();
    client.setCount('assessment:assessment_commit_submission', 1);

    const audit = await auditAssessmentEvidenceIngestion(client);
    const commit = audit.families.find((family) => family.key === 'commit_submissions');

    expect(commit).toMatchObject({
      status: 'captured',
      assessmentScopedContextCount: 1,
      personProjectedContextCount: 0,
    });
  });

  it('flags duplicate projected edges and source-less positive claims', async () => {
    const client = completeClient();
    client.setCount('raw:test_run', 1);
    client.setCount('person:assessment:test_run', 1);
    client.setCount('duplicate:assessment:test_run', 1);
    client.setCount('sourceLessPositiveClaims', 2);

    const audit = await auditAssessmentEvidenceIngestion(client);
    const testOutput = audit.families.find((family) => family.key === 'test_output');

    expect(testOutput?.status).toBe('duplicated');
    expect(audit.sourceLessPositiveClaimCount).toBe(2);
    expect(audit.status).toBe('not_ready');
    expect(audit.failures).toContain('Test output has duplicate person-projected evidence edges');
    expect(audit.failures).toContain('2 positive evaluation claim(s) have no source refs');
  });
});
