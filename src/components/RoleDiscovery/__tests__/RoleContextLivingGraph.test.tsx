import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoleContextLivingGraphView } from '../RoleContextLivingGraph';
import type { ScopedLivingContextReadModel } from '../../../lib/api/types';

function makeRoleGraph(): ScopedLivingContextReadModel {
  const sourceText = [
    '# Staff Platform Engineer',
    '',
    'We need Kafka experience for order processing workflows.',
    'The work includes source-backed observability and API reliability.',
  ].join('\n');

  return {
    scope: {
      scopeType: 'role_context',
      scopeId: 'role-context-1',
      label: 'Staff Platform Engineer',
      status: 'COMPLETE',
      ownerId: 'user-1',
      pipelineId: 'pipeline-1',
      createdAt: '2026-06-23T17:00:00.000Z',
      updatedAt: '2026-06-23T17:00:00.000Z',
      metadata: {
        baseline: {
          title: 'Staff Platform Engineer',
          source: 'simple_job_description',
        },
        hasJobDescription: true,
      },
    },
    summary: {
      interactionCount: 0,
      artifactCount: 1,
      contextRecordCount: 1,
      assertionCount: 0,
      signalCount: 0,
      sourceSpanCount: 1,
    },
    interactions: [],
    artifacts: [{
      id: 'artifact-1',
      interactionId: null,
      artifactType: 'job_description',
      logicalKey: 'role-context/role-context-1/job-description.md',
      metadata: { source: 'simple_job_description' },
      latestVersionId: 'artifact-version-1',
      latestVersionNumber: 1,
      versionCount: 1,
      mediaType: 'text/markdown',
      storageKey: null,
      createdAt: '2026-06-23T17:00:00.000Z',
      updatedAt: '2026-06-23T17:00:00.000Z',
      sourceSpans: [{
        sourceRefType: 'source_span',
        sourceRefId: 'source-span-1',
        sourceSpanId: 'source-span-1',
        evidenceRole: null,
        artifactId: 'artifact-1',
        artifactType: 'job_description',
        artifactLogicalKey: 'role-context/role-context-1/job-description.md',
        artifactVersionId: 'artifact-version-1',
        artifactVersionNumber: 1,
        mediaType: 'text/markdown',
        storageKey: null,
        stableSegmentId: 'job-description-full',
        exactText: sourceText,
        byteStart: 0,
        byteEnd: 148,
        charStart: 0,
        charEnd: sourceText.length,
        lineStart: 1,
        lineEnd: 4,
        timestampStartMs: null,
        timestampEndMs: null,
        metadata: { source: 'simple_job_description' },
      }],
    }],
    contextRecords: [{
      id: 'context-record-1',
      scopeType: 'role_context',
      scopeId: 'role-context-1',
      interactionId: null,
      applicationId: null,
      episodeId: null,
      assertionId: null,
      recordType: 'simple_job_description',
      predicate: 'defines role source text',
      narrative: 'Simple job description source for Staff Platform Engineer.',
      qualifiers: {
        roleContextId: 'role-context-1',
        selectedTerms: ['Kafka', 'order processing'],
      },
      confidence: 1,
      polarity: 1,
      extractionVersion: 'simple-jd-v1',
      observedAt: '2026-06-23T17:00:00.000Z',
      entities: [
        {
          entityType: 'role_context',
          entityId: 'role-context-1',
          relationship: 'scope',
          value: null,
          confidence: null,
          metadata: {},
        },
        {
          entityType: 'selected_term',
          entityId: null,
          relationship: 'literal_term',
          value: { surface: 'Kafka' },
          confidence: null,
          metadata: {},
        },
      ],
      concepts: [
        {
          id: 'concept-1',
          canonicalKey: 'term:kafka',
          namespace: 'term',
          label: 'Kafka',
          relationship: 'source_term',
          weight: 1,
        },
        {
          id: 'concept-2',
          canonicalKey: 'term:order-processing',
          namespace: 'term',
          label: 'order processing',
          relationship: 'source_term',
          weight: 1,
        },
      ],
      sources: [{
        sourceRefType: 'source_span',
        sourceRefId: 'source-span-1',
        sourceSpanId: 'source-span-1',
        evidenceRole: 'source',
        artifactId: 'artifact-1',
        artifactType: 'job_description',
        artifactLogicalKey: 'role-context/role-context-1/job-description.md',
        artifactVersionId: 'artifact-version-1',
        artifactVersionNumber: 1,
        mediaType: 'text/markdown',
        storageKey: null,
        stableSegmentId: 'job-description-full',
        exactText: sourceText,
        byteStart: 0,
        byteEnd: 148,
        charStart: 0,
        charEnd: sourceText.length,
        lineStart: 1,
        lineEnd: 4,
        timestampStartMs: null,
        timestampEndMs: null,
        metadata: { source: 'simple_job_description' },
      }],
    }],
    assertions: [],
    signals: [],
    relationships: [],
  };
}

describe('RoleContextLivingGraphView', () => {
  it('renders role-scoped hyperedges, concepts, source artifacts, and source inspector text', () => {
    render(<RoleContextLivingGraphView livingContext={makeRoleGraph()} />);

    const graph = screen.getByTestId('role-context-living-graph');
    expect(within(graph).getAllByText('Staff Platform Engineer').length).toBeGreaterThan(0);
    expect(within(graph).getByText('HYPEREDGES')).toBeInTheDocument();
    expect(within(graph).getByText('SOURCES')).toBeInTheDocument();
    expect(within(graph).getAllByText('Kafka').length).toBeGreaterThan(0);
    expect(within(graph).getAllByText('order processing').length).toBeGreaterThan(0);
    expect(within(graph).getByText('Defines Role Source Text')).toBeInTheDocument();
    expect(within(graph).getAllByText('Job Description').length).toBeGreaterThan(0);

    expect(within(graph).getByText(/We need Kafka experience/)).toBeInTheDocument();

    const sourceButtons = within(graph).getAllByTestId('role-context-artifact-source');
    expect(sourceButtons.length).toBeGreaterThan(0);
    fireEvent.click(sourceButtons[0]!);

    expect(within(graph).getByText('source-span-1')).toBeInTheDocument();
    expect(within(graph).getByText('artifact-version-1')).toBeInTheDocument();
  });
});
