import { LivingContextStore } from '../livingContext/persistence';
import { openSemanticTerm } from '../livingContext/openTerms';
import type { ContextRecordConceptInput } from '../livingContext/types';

interface RepoImplementationIssueRow {
  issue_id: number;
  repo_id: number;
  issue_number: number;
  title: string;
  body: string;
  labels_json: string | null;
  github_updated_at: string;
  crawled_at: string;
  full_name: string;
  github_url: string;
  implementability_score: number | null;
  clarity_score: number | null;
  scope_score: number | null;
  isolation_score: number | null;
  difficulty_band: string | null;
  assessment_narrative: string | null;
  signals_version: number | null;
  model_used: string | null;
  generated_at: string | null;
}

export interface BackfillRepoImplementationIssueContextOptions {
  repoId?: number;
  issueId?: number;
  limit?: number;
  now?: string;
}

export interface BackfillRepoImplementationIssueContextResult {
  processed: number;
  contextRecordIds: string[];
}

function parseLabels(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean))].sort()
      : [];
  } catch {
    return [];
  }
}

function boundedScore(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadEligibleIssueRows(
  db: D1Database,
  options: BackfillRepoImplementationIssueContextOptions,
): Promise<RepoImplementationIssueRow[]> {
  const where = [
    "ri.state_at_crawl = 'open'",
    'ri.has_merged_pr = 0',
    "NULLIF(TRIM(COALESCE(ri.body, '')), '') IS NOT NULL",
    'ics.issue_id IS NOT NULL',
    'ics.disqualified = 0',
  ];
  const params: Array<string | number> = [];
  if (options.repoId !== undefined) {
    where.push('ri.repo_id = ?');
    params.push(options.repoId);
  }
  if (options.issueId !== undefined) {
    where.push('ri.id = ?');
    params.push(options.issueId);
  }

  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const result = await db.prepare(
    `SELECT ri.id AS issue_id,
            ri.repo_id,
            ri.issue_number,
            ri.title,
            ri.body,
            ri.labels_json,
            ri.github_updated_at,
            ri.crawled_at,
            qr.full_name,
            qr.github_url,
            ics.implementability_score,
            ics.clarity_score,
            ics.scope_score,
            ics.isolation_score,
            ics.difficulty_band,
            ics.assessment_narrative,
            ics.signals_version,
            ics.model_used,
            ics.generated_at
       FROM repo_issues ri
       JOIN qualified_repos qr ON qr.id = ri.repo_id
       JOIN issue_challenge_signals ics ON ics.issue_id = ri.id
      WHERE ${where.join(' AND ')}
      ORDER BY ri.repo_id, ri.issue_number
      LIMIT ?`,
  ).bind(...params, limit).all<RepoImplementationIssueRow>();

  return result.results ?? [];
}

export async function backfillRepoImplementationIssueContextRecords(
  db: D1Database,
  options: BackfillRepoImplementationIssueContextOptions = {},
): Promise<BackfillRepoImplementationIssueContextResult> {
  const store = new LivingContextStore(
    db,
    () => options.now ?? new Date().toISOString(),
  );
  const rows = await loadEligibleIssueRows(db, options);
  const contextRecordIds: string[] = [];

  for (const row of rows) {
    const labels = parseLabels(row.labels_json);
    const contextConcepts: ContextRecordConceptInput[] = [];
    for (const label of labels) {
      const term = openSemanticTerm(label);
      if (!term) continue;
      const concept = await store.upsertConcept({
        ingestionKey: `repo-issue-label:${term.canonicalKey}`,
        canonicalKey: term.canonicalKey,
        namespace: 'term',
        label: term.surface,
        metadata: {
          source: 'repo_issue_label',
          resolver: 'open-source-term-v2',
        },
      });
      contextConcepts.push({
        conceptId: concept.id,
        relationship: 'source_label',
        weight: 1,
      });
    }

    const body = row.body;
    const record = await store.upsertContextRecord({
      ingestionKey: `repo-implementation-issue:${row.issue_id}`,
      scopeType: 'qualified_repo',
      scopeId: String(row.repo_id),
      recordType: 'repo_implementation_issue',
      predicate: 'defines implementation challenge',
      narrative: `Issue #${row.issue_number}: ${row.title}`,
      qualifiers: {
        issueNumber: row.issue_number,
        title: row.title,
        labels,
        scores: {
          implementability: row.implementability_score,
          clarity: row.clarity_score,
          scope: row.scope_score,
          isolation: row.isolation_score,
        },
        difficultyBand: row.difficulty_band,
        assessmentNarrative: row.assessment_narrative,
        signalsVersion: row.signals_version,
        modelUsed: row.model_used,
      },
      confidence: boundedScore(row.implementability_score),
      extractionVersion: row.signals_version === null
        ? 'repo-issue-context-v1'
        : `repo-issue-context-v${row.signals_version}`,
      observedAt: row.generated_at ?? row.github_updated_at ?? row.crawled_at,
      sources: [{
        sourceRefType: 'repo_issue',
        sourceRefId: String(row.issue_id),
        evidenceRole: 'source',
        locator: {
          repoId: row.repo_id,
          repository: row.full_name,
          githubUrl: row.github_url,
          issueNumber: row.issue_number,
          crawledAt: row.crawled_at,
          githubUpdatedAt: row.github_updated_at,
        },
        exactText: body,
        contentHash: await sha256Hex(body),
      }],
      entities: [
        {
          entityType: 'qualified_repo',
          entityId: String(row.repo_id),
          relationship: 'repository',
          value: {
            fullName: row.full_name,
            githubUrl: row.github_url,
          },
        },
        {
          entityType: 'repo_issue',
          entityId: String(row.issue_id),
          relationship: 'issue',
          value: {
            issueNumber: row.issue_number,
            title: row.title,
            url: `${row.github_url}/issues/${row.issue_number}`,
          },
        },
      ],
      concepts: contextConcepts,
    });
    contextRecordIds.push(record.id);
  }

  return {
    processed: rows.length,
    contextRecordIds,
  };
}
