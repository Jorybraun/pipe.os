import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextRecordTree } from '../ContextRecordTree';
import type {
  LivingContextGenericSourceRef,
  LivingContextRecord,
  LivingContextSourceRef,
} from '../../../lib/api/types';

function makeSource(overrides: Partial<LivingContextSourceRef> = {}): LivingContextSourceRef {
  return {
    sourceSpanId: 'span-1',
    artifactId: 'art-1',
    artifactType: 'transcript',
    artifactVersionId: 'ver-1',
    artifactVersionNumber: 1,
    artifactLogicalKey: 'transcript/intro.txt',
    mediaType: 'text/plain',
    storageKey: 'r2://transcript/intro.txt',
    stableSegmentId: 'seg-1',
    exactText: 'I built a distributed cache using Redis.',
    byteStart: 0,
    byteEnd: 40,
    charStart: 0,
    charEnd: 40,
    lineStart: 1,
    lineEnd: 1,
    timestampStartMs: null,
    timestampEndMs: null,
    evidenceRole: 'primary',
    metadata: {},
    ...overrides,
  };
}

function makeGenericSource(
  overrides: Partial<LivingContextGenericSourceRef> = {},
): LivingContextGenericSourceRef {
  return {
    sourceRefType: 'review_challenge_packet',
    sourceRefId: 'packet-1',
    sourceSpanId: null,
    evidenceRole: 'selected_packet',
    locator: { id: 'packet-1' },
    exactText: 'Selected packet source hash sha256:packet-source.',
    contentHash: 'sha256:packet-source',
    metadata: {},
    ...overrides,
  };
}

function makeRecord(overrides: Partial<LivingContextRecord> = {}): LivingContextRecord {
  return {
    id: 'cr-1',
    scopeType: 'workspace_person',
    scopeId: 'wp-1',
    interactionId: 'int-1',
    applicationId: null,
    episodeId: 'ep-1',
    assertionId: null,
    recordType: 'competence',
    predicate: 'demonstrated',
    narrative: 'Candidate built a distributed cache using Redis cluster sharding.',
    qualifiers: { context: 'interview' },
    confidence: 0.88,
    polarity: 1,
    extractionVersion: '2026-06-19-v1',
    observedAt: '2026-06-15T10:00:00Z',
    entities: [
      {
        entityType: 'person',
        entityId: 'wp-1',
        relationship: 'subject',
        value: 'candidate',
        confidence: 1.0,
        metadata: {},
      },
      {
        entityType: 'mechanism',
        entityId: null,
        relationship: 'used',
        value: 'Redis cluster sharding',
        confidence: 0.9,
        metadata: { source: 'transcript' },
      },
    ],
    concepts: [
      {
        id: 'c-1',
        canonicalKey: 'distributed-cache',
        namespace: 'engineering',
        label: 'Distributed Cache',
        relationship: 'core',
        weight: 0.92,
      },
      {
        id: 'c-2',
        canonicalKey: 'redis',
        namespace: 'tooling',
        label: 'Redis',
        relationship: 'adjacent',
        weight: 0.7,
      },
    ],
    sources: [makeSource()],
    ...overrides,
  };
}

describe('ContextRecordTree', () => {
  it('renders the record predicate, narrative, and type in collapsed state', () => {
    const record = makeRecord();
    render(<ContextRecordTree record={record} onSelectSource={vi.fn()} />);

    expect(screen.getByText('Demonstrated')).toHaveAttribute('title', 'demonstrated');
    expect(
      screen.getByText('Candidate built a distributed cache using Redis cluster sharding.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/competence/i)).toBeInTheDocument();
    expect(screen.getByText(/88%/)).toBeInTheDocument();
  });

  it('does not show entities, concepts, or sources when collapsed', () => {
    const record = makeRecord();
    render(<ContextRecordTree record={record} onSelectSource={vi.fn()} />);

    expect(screen.queryByText('Entities')).not.toBeInTheDocument();
    expect(screen.queryByText('Concepts')).not.toBeInTheDocument();
    expect(screen.queryByText('Source evidence')).not.toBeInTheDocument();
  });

  it('expands to show entities, concepts, and source spans on click', async () => {
    const user = userEvent.setup();
    const record = makeRecord();
    render(<ContextRecordTree record={record} onSelectSource={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: /expand context record/i });
    await user.click(toggle);

    expect(screen.getByText('Entities')).toBeInTheDocument();
    expect(screen.getByText('Concepts')).toBeInTheDocument();
    expect(screen.getByText('Source evidence')).toBeInTheDocument();

    // Entity details
    expect(screen.getByText('Redis cluster sharding')).toBeInTheDocument();
    expect(screen.getByText(/used/)).toBeInTheDocument();

    // Concept details
    expect(screen.getByText('Distributed Cache')).toBeInTheDocument();
    expect(screen.getByText('Redis')).toBeInTheDocument();

    // Source snippet
    expect(screen.getByText('I built a distributed cache using Redis.')).toBeInTheDocument();
  });

  it('calls onSelectSource when a source span button is clicked', async () => {
    const user = userEvent.setup();
    const onSelectSource = vi.fn();
    const record = makeRecord();
    render(<ContextRecordTree record={record} onSelectSource={onSelectSource} />);

    const toggle = screen.getByRole('button', { name: /expand context record/i });
    await user.click(toggle);

    const sourceButton = screen.getByRole('button', { name: /transcript.*line 1/i });
    await user.click(sourceButton);

    expect(onSelectSource).toHaveBeenCalledTimes(1);
    const selectedSource = onSelectSource.mock.calls[0]?.[0] as LivingContextSourceRef | undefined;
    expect(selectedSource?.sourceSpanId).toBe('span-1');
  });

  it('renders generic provenance refs without treating them as clickable source spans', async () => {
    const user = userEvent.setup();
    const onSelectSource = vi.fn();
    const record = makeRecord({
      sources: [makeGenericSource()],
    });
    render(<ContextRecordTree record={record} onSelectSource={onSelectSource} />);

    const toggle = screen.getByRole('button', { name: /expand context record/i });
    await user.click(toggle);

    expect(screen.getByText('Review Challenge Packet packet-1')).toBeInTheDocument();
    expect(screen.getByText('Selected packet source hash sha256:packet-source.')).toBeInTheDocument();
    const provenanceChip = screen.getByTestId('context-record-source-ref');
    expect(provenanceChip).toHaveAttribute('data-source-ref-type', 'review_challenge_packet');
    expect(provenanceChip).toHaveAttribute('data-source-ref-id', 'packet-1');
    expect(provenanceChip).toHaveAttribute('data-content-hash', 'sha256:packet-source');
    expect(screen.queryByRole('button', { name: /review challenge packet/i })).not.toBeInTheDocument();

    await user.click(provenanceChip);
    expect(onSelectSource).not.toHaveBeenCalled();
  });

  it('collapses back when toggle is clicked again', async () => {
    const user = userEvent.setup();
    const record = makeRecord();
    render(<ContextRecordTree record={record} onSelectSource={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: /expand context record/i });
    await user.click(toggle);
    expect(screen.getByText('Entities')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByText('Entities')).not.toBeInTheDocument();
  });

  it('renders record with no entities/concepts/sources without crashing', () => {
    const record = makeRecord({ entities: [], concepts: [], sources: [] });
    render(<ContextRecordTree record={record} onSelectSource={vi.fn()} />);

    expect(screen.getByText('Demonstrated')).toBeInTheDocument();
  });

  it('renders machine semantic keys as readable labels', () => {
    const record = makeRecord({
      recordType: 'scheduled_interview_invite_delivery',
      predicate: 'PRESERVES_CONTACT_FIRST_INTERVIEW_INVITE',
      narrative: 'PRESERVES CONTACT FIRST INTERVIEW INVITE',
    });
    render(<ContextRecordTree record={record} onSelectSource={vi.fn()} />);

    expect(screen.getByText('Preserves Contact First Interview Invite')).toBeInTheDocument();
    expect(screen.queryByText('PRESERVES CONTACT FIRST INTERVIEW INVITE')).not.toBeInTheDocument();
  });

  it('shows observed date when available', () => {
    const record = makeRecord({ observedAt: '2026-06-15T10:00:00Z' });
    render(<ContextRecordTree record={record} onSelectSource={vi.fn()} />);

    expect(screen.getByText(/Jun 15, 2026/i)).toBeInTheDocument();
  });

  it('shows polarity indicator for negative polarity', () => {
    const record = makeRecord({ polarity: -1, narrative: 'Candidate could not explain sharding.' });
    render(<ContextRecordTree record={record} onSelectSource={vi.fn()} />);

    expect(screen.getByText(/negative/i)).toBeInTheDocument();
  });
});
