import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EnrichmentStatusSection } from './EnrichmentStatusSection';

describe('EnrichmentStatusSection', () => {
  it('surfaces failed candidate AI ingestion and calls the repair action', () => {
    const onRetryFailedIngestion = vi.fn(async () => {});

    render(
      <EnrichmentStatusSection
        props={{
          status: 'failed',
          errorText: 'Candidate Discovery response was not a JSON object',
        }}
        onRetryFailedIngestion={onRetryFailedIngestion}
      />,
    );

    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText('Candidate Discovery response was not a JSON object')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry_failed/i }));

    expect(onRetryFailedIngestion).toHaveBeenCalledTimes(1);
  });

  it('shows the source-backed retry queue result after repair', () => {
    render(
      <EnrichmentStatusSection
        props={{
          status: 'failed',
          errorText: 'Workers AI timeout',
        }}
        onRetryFailedIngestion={async () => {}}
        retryIngestionResult={{
          scanned: 2,
          queued: 1,
          skipped: 1,
          failed: 0,
        }}
      />,
    );

    expect(screen.getByText('Scanned 2; queued 1; skipped 1; failed 0.')).toBeInTheDocument();
  });
});
