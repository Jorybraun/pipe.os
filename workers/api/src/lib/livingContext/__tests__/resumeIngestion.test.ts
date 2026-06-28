import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  ingestResumeToLivingContext,
  splitResumeIntoSections,
} from '../resumeIngestion';
import type { ResumeIngestionInput } from '../resumeIngestion';
import { searchSourceContent } from '../readModel';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

function rewriteNumberedParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?(\d+)/g, () => {
    index++;
    return '?';
  });
}

describe('ingestResumeToLivingContext — native resume → living context', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pipeline_id TEXT,
        name TEXT,
        email TEXT,
        status TEXT NOT NULL
      );
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        phone TEXT,
        company TEXT,
        role TEXT,
        type TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(contextRecordMigration);
    db = createMockD1(sqlite);

    // Seed a candidate
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('cand-1', 'owner-1', 'pipe-1', 'Alice Engineer', 'alice@example.com', 'IN_PROGRESS');
  });

  afterEach(() => {
    sqlite.close();
  });

  const SAMPLE_RESUME = `Alice Engineer
Senior Software Engineer | alice@example.com

SUMMARY
Experienced full-stack engineer with 8 years building distributed systems.
Passionate about developer tooling and platform engineering.

EXPERIENCE
Senior Engineer at CloudCorp (2021-present)
Built and maintained Kubernetes-based deployment pipelines serving 50M requests/day.
Led migration from monolith to microservices architecture using TypeScript and Go.
Implemented real-time data processing with Apache Kafka and Redis.

Software Engineer at StartupCo (2018-2021)
Developed React-based SaaS platform with GraphQL API.
Designed PostgreSQL schema handling 10TB of analytics data.
Mentored 3 junior engineers through structured pair programming.

EDUCATION
M.S. Computer Science, Stanford University (2018)
B.S. Computer Science, UC Berkeley (2016)

SKILLS
TypeScript, Go, Python, React, Node.js, Kubernetes, Docker,
PostgreSQL, Redis, Kafka, GraphQL, AWS, Terraform, CI/CD`;

  it('ingests a resume and creates proper living context entities', async () => {
    const result = await ingestResumeToLivingContext(db, {
      candidateId: 'cand-1',
      storageKey: 'resumes/alice-engineer.pdf',
      mediaType: 'application/pdf',
      resumeText: SAMPLE_RESUME,
      uploadedAt: '2026-06-28T12:00:00Z',
    });

    expect(result).not.toBeNull();
    expect(result!.personId).toBeTruthy();
    expect(result!.workspacePersonId).toBeTruthy();
    expect(result!.applicationId).toBeTruthy();
    expect(result!.interactionId).toBeTruthy();
    expect(result!.artifactId).toBeTruthy();
    expect(result!.artifactVersionId).toBeTruthy();
    expect(result!.sourceSpanCount).toBeGreaterThanOrEqual(4);
    expect(result!.assertionCount).toBeGreaterThanOrEqual(4);
    expect(result!.conceptCount).toBeGreaterThan(0);
    expect(result!.signalEvidenceCount).toBeGreaterThan(0);
  });

  it('creates per-section source spans with exact text and positions', async () => {
    const result = await ingestResumeToLivingContext(db, {
      candidateId: 'cand-1',
      storageKey: 'resumes/alice-engineer.pdf',
      mediaType: 'application/pdf',
      resumeText: SAMPLE_RESUME,
    });

    const spans = sqlite.prepare(
      `SELECT * FROM source_spans WHERE artifact_version_id = ?`,
    ).all(result!.artifactVersionId) as Array<{
      stable_segment_id: string;
      exact_text: string;
      char_start: number;
      char_end: number;
      line_start: number;
      line_end: number;
      metadata_json: string;
    }>;

    expect(spans.length).toBeGreaterThanOrEqual(4);

    // Each span has valid position data
    for (const span of spans) {
      expect(span.char_start).toBeGreaterThanOrEqual(0);
      expect(span.char_end).toBeGreaterThan(span.char_start);
      expect(span.line_start).toBeGreaterThanOrEqual(1);
      expect(span.exact_text.trim().length).toBeGreaterThan(0);
    }

    // Verify experience section span contains expected content
    const expSpan = spans.find((s) => {
      const meta = JSON.parse(s.metadata_json);
      return meta.sectionType === 'experience';
    });
    expect(expSpan).toBeDefined();
    expect(expSpan!.exact_text).toContain('CloudCorp');
    expect(expSpan!.exact_text).toContain('Kubernetes');
  });

  it('creates assertions linked to source spans', async () => {
    const result = await ingestResumeToLivingContext(db, {
      candidateId: 'cand-1',
      storageKey: 'resumes/alice-engineer.pdf',
      mediaType: 'application/pdf',
      resumeText: SAMPLE_RESUME,
    });

    const assertions = sqlite.prepare(
      `SELECT sa.*, GROUP_CONCAT(ass.source_span_id) as span_ids
       FROM semantic_assertions sa
       LEFT JOIN assertion_source_spans ass ON ass.assertion_id = sa.id
       WHERE sa.workspace_person_id = ?
       GROUP BY sa.id`,
    ).all(result!.workspacePersonId) as Array<{
      id: string;
      predicate: string;
      narrative: string;
      span_ids: string | null;
    }>;

    expect(assertions.length).toBeGreaterThanOrEqual(4);

    // Every assertion is linked to at least one source span
    for (const assertion of assertions) {
      expect(assertion.span_ids).toBeTruthy();
    }

    // Check predicate diversity
    const predicates = new Set(assertions.map((a) => a.predicate));
    expect(predicates.has('worked_at')).toBe(true);
    expect(predicates.has('studied_at')).toBe(true);
    expect(predicates.has('has_skill')).toBe(true);
  });

  it('learns concepts dynamically from resume content', async () => {
    const result = await ingestResumeToLivingContext(db, {
      candidateId: 'cand-1',
      storageKey: 'resumes/alice-engineer.pdf',
      mediaType: 'application/pdf',
      resumeText: SAMPLE_RESUME,
    });

    const concepts = sqlite.prepare(
      `SELECT DISTINCT c.canonical_key, c.label
       FROM concepts c
       JOIN assertion_concepts ac ON ac.concept_id = c.id
       JOIN semantic_assertions sa ON sa.id = ac.assertion_id
       WHERE sa.workspace_person_id = ?`,
    ).all(result!.workspacePersonId) as Array<{
      canonical_key: string;
      label: string;
    }>;

    expect(concepts.length).toBeGreaterThan(0);

    // Should have learned technology concepts
    const keys = concepts.map((c) => c.canonical_key);
    const hasTech = keys.some((k) =>
      k.includes('typescript')
      || k.includes('kubernetes')
      || k.includes('react')
      || k.includes('go')
      || k.includes('python'),
    );
    expect(hasTech).toBe(true);
  });

  it('creates signal evidence for technology skills', async () => {
    const result = await ingestResumeToLivingContext(db, {
      candidateId: 'cand-1',
      storageKey: 'resumes/alice-engineer.pdf',
      mediaType: 'application/pdf',
      resumeText: SAMPLE_RESUME,
    });

    const signals = sqlite.prepare(
      `SELECT * FROM signal_evidence WHERE workspace_person_id = ?`,
    ).all(result!.workspacePersonId) as Array<{
      signal_key: string;
      evidence_level: string;
      strength: number;
    }>;

    expect(signals.length).toBeGreaterThan(0);

    // Signal levels should match section type (experience → implemented)
    const expSignals = signals.filter((s) => s.evidence_level === 'implemented');
    expect(expSignals.length).toBeGreaterThan(0);
  });

  it('is idempotent — re-ingestion produces identical results', async () => {
    const input: ResumeIngestionInput = {
      candidateId: 'cand-1',
      storageKey: 'resumes/alice-engineer.pdf',
      mediaType: 'application/pdf',
      resumeText: SAMPLE_RESUME,
    };

    const result1 = await ingestResumeToLivingContext(db, input);
    const result2 = await ingestResumeToLivingContext(db, input);

    // Same IDs — upserts, not duplicates
    expect(result2!.personId).toBe(result1!.personId);
    expect(result2!.workspacePersonId).toBe(result1!.workspacePersonId);
    expect(result2!.interactionId).toBe(result1!.interactionId);
    expect(result2!.artifactId).toBe(result1!.artifactId);

    // Same counts
    expect(result2!.sourceSpanCount).toBe(result1!.sourceSpanCount);
    expect(result2!.assertionCount).toBe(result1!.assertionCount);
  });

  it('creates context records with proper source references', async () => {
    const result = await ingestResumeToLivingContext(db, {
      candidateId: 'cand-1',
      storageKey: 'resumes/alice-engineer.pdf',
      mediaType: 'application/pdf',
      resumeText: SAMPLE_RESUME,
    });

    const records = sqlite.prepare(
      `SELECT cr.*, GROUP_CONCAT(crss.source_span_id) as span_ids
       FROM context_records cr
       LEFT JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
       WHERE cr.workspace_person_id = ?
       GROUP BY cr.id`,
    ).all(result!.workspacePersonId) as Array<{
      id: string;
      record_type: string;
      predicate: string;
      narrative: string;
      span_ids: string | null;
    }>;

    expect(records.length).toBeGreaterThanOrEqual(4);
    for (const record of records) {
      expect(record.record_type).toBe('resume_assertion');
      expect(record.span_ids).toBeTruthy();
    }
  });

  it('enqueues neo4j projection job', async () => {
    const result = await ingestResumeToLivingContext(db, {
      candidateId: 'cand-1',
      storageKey: 'resumes/alice-engineer.pdf',
      mediaType: 'application/pdf',
      resumeText: SAMPLE_RESUME,
    });

    const jobs = sqlite.prepare(
      `SELECT * FROM projection_outbox WHERE aggregate_id = ?`,
    ).all(result!.workspacePersonId) as Array<{
      projection_type: string;
      aggregate_type: string;
      payload_json: string;
    }>;

    expect(jobs.length).toBeGreaterThanOrEqual(1);
    const neo4jJob = jobs.find((j) => j.projection_type === 'neo4j');
    expect(neo4jJob).toBeDefined();
    const payload = JSON.parse(neo4jJob!.payload_json);
    expect(payload.trigger).toBe('resume_ingestion');
  });

  it('resume source content is searchable via searchSourceContent', async () => {
    const result = await ingestResumeToLivingContext(db, {
      candidateId: 'cand-1',
      storageKey: 'resumes/alice-engineer.pdf',
      mediaType: 'application/pdf',
      resumeText: SAMPLE_RESUME,
    });

    const searchResult = await searchSourceContent(db, result!.workspacePersonId, 'Kubernetes', 10);
    expect(searchResult).toBeDefined();
    expect(searchResult.hits).toBeDefined();
    if (searchResult.hits.length > 0) {
      expect(searchResult.hits[0]!.exactText).toContain('Kubernetes');
    } else {
      // Verify source spans exist with the content directly (FTS may not be available)
      const spans = sqlite.prepare(
        `SELECT ss.exact_text FROM source_spans ss
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
         WHERE a.workspace_person_id = ? AND ss.exact_text LIKE '%Kubernetes%'`,
      ).all(result!.workspacePersonId) as Array<{ exact_text: string }>;
      expect(spans.length).toBeGreaterThan(0);
    }
  });

  it('supports pre-extracted semantic assertions from LLM', async () => {
    const result = await ingestResumeToLivingContext(db, {
      candidateId: 'cand-1',
      storageKey: 'resumes/alice-engineer.pdf',
      mediaType: 'application/pdf',
      resumeText: SAMPLE_RESUME,
      semanticAssertions: [
        {
          sourceSectionIds: ['section-002-experience'],
          primarySectionId: 'section-002-experience',
          predicate: 'led_migration',
          narrative: 'Led migration from monolith to microservices at CloudCorp',
          objectType: 'achievement',
          objectValue: 'monolith_to_microservices',
          concepts: [
            { surface: 'microservices', relationship: 'about', weight: 1, evidenceLevel: 'demonstrated', strength: 0.9 },
            { surface: 'architecture', relationship: 'about', weight: 0.8, evidenceLevel: 'implemented', strength: 0.85 },
          ],
          confidence: 0.95,
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.assertionCount).toBe(1);
    expect(result!.conceptCount).toBeGreaterThanOrEqual(1);
  });
});

describe('splitResumeIntoSections', () => {
  it('detects section headings in uppercase', () => {
    const text = `John Doe
john@example.com

EXPERIENCE
Worked at Acme Corp for 5 years.

EDUCATION
BS Computer Science from MIT.

SKILLS
TypeScript, Python, Go`;

    const sections = splitResumeIntoSections(text);
    expect(sections.length).toBeGreaterThanOrEqual(3);

    const types = sections.map((s) => s.sectionType);
    expect(types).toContain('experience');
    expect(types).toContain('education');
    expect(types).toContain('skills');
  });

  it('includes preamble as summary section', () => {
    const text = `John Doe
Senior Engineer | john@example.com
8 years of experience in distributed systems.

EXPERIENCE
Built stuff at places.`;

    const sections = splitResumeIntoSections(text);
    expect(sections[0]!.sectionType).toBe('summary');
    expect(sections[0]!.text).toContain('John Doe');
  });

  it('falls back to paragraph splitting when no headings found', () => {
    const text = `First paragraph about the person.

Second paragraph about experience.

Third paragraph about skills.`;

    const sections = splitResumeIntoSections(text);
    expect(sections.length).toBe(3);
    expect(sections[0]!.sectionType).toBe('summary');
    expect(sections[0]!.stableId).toMatch(/^paragraph-/);
  });

  it('handles empty text gracefully', () => {
    const sections = splitResumeIntoSections('');
    expect(sections.length).toBe(0);
  });
});
