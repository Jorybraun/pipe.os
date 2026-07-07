/**
 * CandidatesTab — /pipeline/:id/stage/:stageId/candidates.
 *
 * Lists people currently attached to this interview. The data still comes from
 * candidate records, but the product surface treats candidates as people with
 * interview state.
 */

import { useState, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Clock, Copy, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { SectionCard } from '../../components';
import { CandidateIntakeModal } from '../../components/Candidate/CandidateIntakeModal';
import { useCandidateMutations } from '../../hooks/useCandidateMutations';
import { usePipelineIngestion, type PipelineIngestionItem } from '../../hooks/usePipelineIngestion';
import type { OverviewCandidate } from '../../lib/api/types';
import type { StagePanelContext } from '../StagePanel';

function ingestionColor(status: PipelineIngestionItem['status']): string {
  if (status === 'matched') return '#10b981';
  if (status === 'failed') return '#f87171';
  if (status === 'embedded' || status === 'profile_generated') return '#60a5fa';
  return '#9ca3af';
}

function CandidateRow({
  candidate,
  ingestion,
  variant,
  onClick,
  onDelete,
  onCopyLink,
}: {
  candidate: OverviewCandidate;
  ingestion?: PipelineIngestionItem | undefined;
  variant: 'completed' | 'pending';
  onClick: () => void;
  onDelete: () => void;
  onCopyLink?: () => void;
}): JSX.Element {
  const color = variant === 'completed' ? '#4ade80' : 'var(--pipe-text-dim)';
  const bg =
    variant === 'completed'
      ? 'rgba(74, 222, 128, 0.04)'
      : 'rgba(255, 255, 255, 0.02)';
  const border =
    variant === 'completed'
      ? '1px solid rgba(74, 222, 128, 0.12)'
      : '1px solid var(--pipe-border-light)';
  const Icon = variant === 'completed' ? CheckCircle : Clock;
  const ingestionTitle = ingestion?.status === 'failed'
    ? ingestion.errorText ?? 'Candidate AI ingestion failed.'
    : ingestion?.status
      ? `Candidate AI ingestion ${ingestion.status}.`
      : undefined;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: bg,
        border,
        borderRadius: 6,
      }}
    >
      <div
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          flex: 1,
        }}
      >
        <Icon size={13} color={color} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color:
              variant === 'completed'
                ? 'var(--pipe-text)'
                : 'var(--pipe-text-muted)',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          {candidate.name ?? candidate.email ?? 'Unknown'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Enrichment indicator */}
        {ingestion && (
          <div
            aria-label={`Candidate AI ingestion ${ingestion.status}`}
            title={ingestionTitle}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: ingestionColor(ingestion.status),
              }}
            />
            {ingestion.status === 'failed' && (
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  color: '#fca5a5',
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.06em',
                  padding: '1px 5px',
                  background: 'rgba(248,113,113,0.08)',
                  border: '1px solid rgba(248,113,113,0.18)',
                  borderRadius: 3,
                }}
              >
                AI_FAILED
              </span>
            )}
            {ingestion.status === 'matched' && ingestion.triangulatedScore !== null && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: '#10b981',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {Math.round((ingestion.triangulatedScore ?? 0) * 100)}
              </span>
            )}
            {ingestion.status === 'matched' && ingestion.matchPhilosophy && (
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  color: '#60a5fa',
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.06em',
                  padding: '1px 5px',
                  background: 'rgba(96,165,250,0.08)',
                  border: '1px solid rgba(96,165,250,0.15)',
                  borderRadius: 3,
                }}
              >
                {ingestion.matchPhilosophy.toUpperCase()}
              </span>
            )}
          </div>
        )}

        {variant === 'completed' && candidate.score !== null && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#4ade80',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {Math.round(candidate.score ?? 0)}%
          </span>
        )}
        {variant === 'pending' && (
          <span
            style={{
              fontSize: 9,
              color: 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {candidate.status === 'INVITED' ? 'INVITED' : 'IN PROGRESS'}
          </span>
        )}
        {onCopyLink && (
          <button
            onClick={onCopyLink}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--pipe-text-dim)',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              opacity: 0.5,
              transition: 'opacity 0.2s',
            }}
            title="Copy invite link"
          >
            <Copy size={12} />
          </button>
        )}
        <button
          onClick={onDelete}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--pipe-text-dim)',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            opacity: 0.5,
            transition: 'opacity 0.2s',
          }}
          title="Remove person"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

export default function CandidatesTab(): JSX.Element {
  const { shell, stageId } = useOutletContext<StagePanelContext>();
  const navigate = useNavigate();
  const { deleteCandidate } = useCandidateMutations();
  const {
    items: ingestionItems,
    retryFailed,
    isRetrying,
    retryError,
    lastRetryResult,
  } = usePipelineIngestion(shell.pipelineId);

  const ingestionByCandidate = useMemo(() => {
    const map = new Map<string, PipelineIngestionItem>();
    for (const item of ingestionItems) {
      map.set(item.candidateId, item);
    }
    return map;
  }, [ingestionItems]);

  const failedIngestionCount = useMemo(
    () => ingestionItems.filter((item) => item.status === 'failed').length,
    [ingestionItems],
  );

  const [showAdd, setShowAdd] = useState(false);

  const stageCandidates = shell.candidates.filter(
    (c) => c.currentStageId === stageId,
  );
  const completed = stageCandidates.filter((c) => c.status === 'COMPLETED');
  const pending = stageCandidates.filter((c) => c.status !== 'COMPLETED');

  const handleRemove = async (candidate: OverviewCandidate): Promise<void> => {
    if (
      !window.confirm(
        `Remove ${candidate.name ?? candidate.email ?? 'this person'}?`,
      )
    )
      return;
    await deleteCandidate(candidate.id);
    await shell.refetch();
  };

  const handleRetryFailedIngestion = async (): Promise<void> => {
    await retryFailed(10);
  };

  return (
    <div data-testid="stage-tab-content-candidates">
      <SectionCard
        label="PEOPLE"
        icon={<Users size={16} color="var(--pipe-text-dim)" />}
        meta={
          <button
            onClick={() => setShowAdd(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.15em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
            }}
          >
            <Plus size={11} />
            ADD PERSON
          </button>
        }
      >
        {(failedIngestionCount > 0 || retryError || lastRetryResult) && (
          <div
            data-testid="candidate-ingestion-repair-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              marginBottom: 14,
              borderRadius: 6,
              border: retryError
                ? '1px solid rgba(248,113,113,0.22)'
                : '1px solid rgba(251,191,36,0.18)',
              background: retryError
                ? 'rgba(248,113,113,0.06)'
                : 'rgba(251,191,36,0.05)',
            }}
          >
            <AlertTriangle size={14} color={retryError ? '#f87171' : '#fbbf24'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  color: retryError ? '#fca5a5' : '#fbbf24',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {retryError
                  ? 'AI_INGESTION_RETRY_FAILED'
                  : failedIngestionCount > 0
                    ? `AI_INGESTION_FAILED_${failedIngestionCount}`
                    : `AI_INGESTION_QUEUED_${lastRetryResult?.queued ?? 0}`}
              </div>
              <div
                style={{
                  marginTop: 3,
                  fontSize: 10,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {retryError?.message
                  ?? (lastRetryResult
                    ? `Scanned ${lastRetryResult.scanned}; queued ${lastRetryResult.queued}; skipped ${lastRetryResult.skipped}; failed ${lastRetryResult.failed}.`
                    : 'Retry source-backed candidate ingestion from stored resume evidence.')}
              </div>
            </div>
            {failedIngestionCount > 0 && (
              <button
                type="button"
                onClick={() => void handleRetryFailedIngestion()}
                disabled={isRetrying}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '7px 10px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 4,
                  color: 'var(--pipe-text)',
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: isRetrying ? 'wait' : 'pointer',
                  opacity: isRetrying ? 0.62 : 1,
                }}
              >
                <RefreshCw
                  size={11}
                  style={{ animation: isRetrying ? 'spin 1s linear infinite' : undefined }}
                />
                RETRY_FAILED
              </button>
            )}
          </div>
        )}

        {stageCandidates.length === 0 ? (
          <div
            style={{
              padding: '40px 24px',
              textAlign: 'center',
              border: '1px dashed var(--pipe-border-light)',
              borderRadius: 12,
            }}
          >
            <Users
              size={24}
              color="var(--pipe-text-dim)"
              style={{ marginBottom: 12 }}
            />
            <div
              style={{
                color: 'var(--pipe-text-dim)',
                fontSize: 12,
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.05em',
              }}
            >
              No people attached to this interview yet.
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {completed.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: '0.15em',
                    color: '#4ade80',
                    fontFamily: '"Space Mono", monospace',
                    fontWeight: 700,
                    marginBottom: 4,
                  }}
                >
                  SUBMITTED ({completed.length})
                </div>
                {completed.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    ingestion={ingestionByCandidate.get(c.id)}
                    variant="completed"
                    onClick={() => navigate(`/candidates/${c.id}`)}
                    onDelete={() => void handleRemove(c)}
                  />
                ))}
              </>
            )}

            {pending.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: '0.15em',
                    color: 'var(--pipe-text-dim)',
                    fontFamily: '"Space Mono", monospace',
                    fontWeight: 700,
                    marginTop: completed.length > 0 ? 12 : 0,
                    marginBottom: 4,
                  }}
                >
                  PENDING ({pending.length})
                </div>
                {pending.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    ingestion={ingestionByCandidate.get(c.id)}
                    variant="pending"
                    onClick={() => navigate(`/candidates/${c.id}`)}
                    onDelete={() => void handleRemove(c)}
                    onCopyLink={() => {
                      const rawToken = c.inviteToken.replace(/^CLAIMED::/, '');
                      const link = `${window.location.origin}/assess/${rawToken}`;
                      void navigator.clipboard.writeText(link);
                    }}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </SectionCard>

      {showAdd && (
        <CandidateIntakeModal
          pipelineId={shell.pipelineId}
          stageId={stageId}
          onClose={() => setShowAdd(false)}
          onSuccess={() => {
            setShowAdd(false);
            void shell.refetch();
          }}
        />
      )}
    </div>
  );
}
