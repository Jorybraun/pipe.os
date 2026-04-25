/**
 * CandidatesTab — /pipeline/:id/stage/:stageId/candidates.
 *
 * Lists candidates currently in this stage, split into COMPLETED (submitted)
 * and PENDING (invited/in-progress) groups. Uses the shell's candidates data
 * so no extra fetch.
 */

import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { CheckCircle, Clock, Plus, Trash2, Users } from 'lucide-react';
import { SectionCard } from '../../components';
import { CandidateIntakeModal } from '../../components/Candidate/CandidateIntakeModal';
import { useCandidateMutations } from '../../hooks/useCandidateMutations';
import type { OverviewCandidate } from '../../lib/api/types';
import type { StagePanelContext } from '../StagePanel';

function CandidateRow({
  candidate,
  variant,
  onClick,
  onDelete,
}: {
  candidate: OverviewCandidate;
  variant: 'completed' | 'pending';
  onClick: () => void;
  onDelete: () => void;
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
          title="Remove candidate"
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

  const [showAdd, setShowAdd] = useState(false);

  const stageCandidates = shell.candidates.filter(
    (c) => c.currentStageId === stageId,
  );
  const completed = stageCandidates.filter((c) => c.status === 'COMPLETED');
  const pending = stageCandidates.filter((c) => c.status !== 'COMPLETED');

  const handleRemove = async (candidate: OverviewCandidate): Promise<void> => {
    if (
      !window.confirm(
        `Remove ${candidate.name ?? candidate.email ?? 'this candidate'}?`,
      )
    )
      return;
    await deleteCandidate(candidate.id);
    await shell.refetch();
  };

  return (
    <div data-testid="stage-tab-content-candidates">
      <SectionCard
        label="CANDIDATES"
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
            ADD_CANDIDATE
          </button>
        }
      >
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
              No candidates in this stage yet.
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
                    variant="pending"
                    onClick={() => navigate(`/candidates/${c.id}`)}
                    onDelete={() => void handleRemove(c)}
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
