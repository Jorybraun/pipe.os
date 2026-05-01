/**
 * OpenSourceDetailTab — default tab for OPEN_SOURCE stages.
 *
 * Replaces the generic "Challenges" tab. Contains:
 *   - What the open-source implementation challenge is + candidate flow
 *   - Repository configuration (repo + issue select) with inline CTA
 *   - Dev container settings: TTL, challenge branch
 *   - Instructions editor
 */

import { useState, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  GitBranch,
  Container,
  Clock,
  Target,
  Code2,
  ChevronRight,
  CheckCircle2,
  FileCode,
  Terminal,
  Save,
  Check,
  GitCommit,
  AlertCircle,
} from 'lucide-react';
import { SectionCard } from '../../components';
import { useChallengeMutations } from '../../hooks/useChallengeMutations';
import type { StagePanelContext } from '../StagePanel';

const mono = '"Space Mono", monospace';

/* ── TTL selector ───────────────────────────────────────────────────────── */

function TtlSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (val: number) => void;
}): JSX.Element {
  const options = [
    { min: 30, label: '30 MIN' },
    { min: 45, label: '45 MIN' },
    { min: 60, label: '60 MIN' },
    { min: 90, label: '90 MIN' },
    { min: 120, label: '2 HR' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--pipe-text-dim)',
          fontFamily: mono,
          letterSpacing: '0.08em',
          flexShrink: 0,
        }}
      >
        SESSION_TTL
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map((opt) => (
          <button
            key={opt.min}
            onClick={() => onChange(opt.min * 60)}
            style={{
              padding: '8px 14px',
              background: value === opt.min * 60 ? '#60a5fa' : 'var(--pipe-surface)',
              border: `1px solid ${value === opt.min * 60 ? '#60a5fa' : 'var(--pipe-border)'}`,
              borderRadius: 6,
              color: value === opt.min * 60 ? '#0c0c0e' : 'var(--pipe-text-muted)',
              fontSize: 10,
              fontWeight: 800,
              fontFamily: mono,
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────── */

export default function OpenSourceDetailTab(): JSX.Element {
  const { shell, stage, stageId, refetchStage } = useOutletContext<StagePanelContext>();
  const navigate = useNavigate();
  const { createChallenge } = useChallengeMutations();

  const stagePath = `/pipeline/${shell.pipelineId}/stage/${stageId}`;

  // Find CODE_IMPLEMENTATION challenges
  const implChallenges = stage.challenges?.filter((c) => c.type === 'CODE_IMPLEMENTATION') ?? [];
  const hasChallenge = implChallenges.length > 0;
  const challenge = implChallenges[0];

  // Extract config from first challenge if it exists
  const existingConfig = challenge?.config as Record<string, unknown> | null;

  // Local state for configuration
  const [ttlSeconds, setTtlSeconds] = useState<number>(
    (existingConfig?.ttlSeconds as number) ?? 3600,
  );
  const [challengeBranch, setChallengeBranch] = useState<string>(
    (existingConfig?.challengeBranch as string) ?? '',
  );
  const [instructions, setInstructions] = useState<string>(
    challenge?.instructions ?? 'Fix the open-source issue in the provided dev container.',
  );
  const [issueNumber, setIssueNumber] = useState<number | ''>(
    (existingConfig?.issueNumber as number) ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const configChanged =
    ttlSeconds !== ((existingConfig?.ttlSeconds as number) ?? 3600) ||
    challengeBranch !== ((existingConfig?.challengeBranch as string) ?? '') ||
    instructions !== (challenge?.instructions ?? 'Fix the open-source issue in the provided dev container.') ||
    issueNumber !== ((existingConfig?.issueNumber as number) ?? '');

  const handleSaveConfig = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      const newConfig = {
        ...(existingConfig ?? {}),
        ttlSeconds,
        challengeBranch: challengeBranch || undefined,
        issueNumber: typeof issueNumber === 'number' ? issueNumber : undefined,
      };

      if (challenge) {
        await fetch(`/api/v1/challenges/${challenge.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: newConfig,
            instructions: instructions.trim() || undefined,
          }),
        });
      } else {
        await createChallenge(stageId, {
          type: 'CODE_IMPLEMENTATION',
          title: 'Open Source Implementation',
          instructions: instructions.trim(),
          config: newConfig,
        });
      }
      await refetchStage();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[OpenSourceDetailTab] Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  }, [existingConfig, ttlSeconds, challengeBranch, instructions, issueNumber, challenge, stageId, createChallenge, refetchStage]);

  /** Create a placeholder challenge with no repo so the matching
   *  system assigns the best-matched repository per candidate. */
  const handleUseMatchedRepo = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      const newConfig = {
        ...(existingConfig ?? {}),
        ttlSeconds,
        useMatchedRepo: true,
      };
      await createChallenge(stageId, {
        type: 'CODE_IMPLEMENTATION',
        title: 'Open Source Implementation',
        instructions: 'Fix the open-source issue in the provided dev container.',
        config: newConfig,
      });
      await refetchStage();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[OpenSourceDetailTab] Failed to create matched-repo challenge:', err);
    } finally {
      setSaving(false);
    }
  }, [existingConfig, ttlSeconds, stageId, createChallenge, refetchStage]);

  return (
    <div
      data-testid="stage-tab-content-open-source-detail"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Hero — what this stage is */}
      <SectionCard
        label="OPEN_SOURCE_CHALLENGE"
        icon={<Container size={16} color="var(--pipe-text-dim)" />}
        meta="DEV_CONTAINER"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.7,
              color: 'var(--pipe-text)',
              fontFamily: mono,
            }}
          >
            The candidate receives a live dev container pre-loaded with a real
            open-source repository. Their task is to fix an authentic issue from
            that repo's issue tracker. All work happens in a browser-based
            VS Code environment. The session is time-limited and all file
            changes are captured for evaluation.
          </p>

          {/* Candidate flow */}
          <div
            style={{
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              padding: '14px 0',
              borderTop: '1px solid var(--pipe-border-light)',
              borderBottom: '1px solid var(--pipe-border-light)',
            }}
          >
            {[
              { label: 'RECEIVE ISSUE', icon: FileCode },
              { label: 'EXPLORE CODE', icon: Code2 },
              { label: 'IMPLEMENT FIX', icon: Terminal },
              { label: 'SUBMIT', icon: CheckCircle2 },
            ].map((step, i, arr) => (
              <div
                key={step.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  flex: 1,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    flex: 1,
                  }}
                >
                  <step.icon
                    size={14}
                    color={i === 0 ? '#60a5fa' : 'var(--pipe-text-dim)'}
                  />
                  <span
                    style={{
                      fontSize: 7,
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      color: i === 0 ? '#60a5fa' : 'var(--pipe-text-dim)',
                      fontFamily: mono,
                      textAlign: 'center',
                    }}
                  >
                    {step.label}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <ChevronRight
                    size={10}
                    color="var(--pipe-border)"
                    style={{ flexShrink: 0 }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Key stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              {
                icon: Clock,
                label: 'DURATION',
                value: `${Math.round(ttlSeconds / 60)} MIN`,
                sub: 'async, candidate-paced',
              },
              {
                icon: Container,
                label: 'ENVIRONMENT',
                value: 'VS CODE',
                sub: 'browser dev container',
              },
              {
                icon: GitCommit,
                label: 'SCORING',
                value: 'TBD',
                sub: 'human + AI evaluation',
              },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  padding: '14px 16px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <stat.icon size={11} color="var(--pipe-text-dim)" />
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: mono }}>
                    {stat.label}
                  </span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--pipe-text)', fontFamily: mono, lineHeight: 1, marginBottom: 4 }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', fontFamily: mono, letterSpacing: '0.05em' }}>
                  {stat.sub}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Repository configuration */}
      <SectionCard
        label="REPOSITORY"
        icon={<GitBranch size={16} color="var(--pipe-text-dim)" />}
        meta={
          hasChallenge && challenge?.devContainerRepoUrl ? (
            <button
              onClick={() => challenge && navigate(`/pipeline/${shell.pipelineId}/challenges/${challenge.id}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', background: 'transparent',
                border: '1px solid var(--pipe-border)', borderRadius: 4,
                color: 'var(--pipe-text-dim)', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.1em', fontFamily: mono, cursor: 'pointer',
              }}
            >
              EDIT_REPO <ChevronRight size={10} />
            </button>
          ) : hasChallenge ? (
            <button
              onClick={() => navigate(`${stagePath}/configure`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', background: 'transparent',
                border: '1px solid var(--pipe-border)', borderRadius: 4,
                color: 'var(--pipe-text-dim)', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.1em', fontFamily: mono, cursor: 'pointer',
              }}
            >
              SELECT_REPO <ChevronRight size={10} />
            </button>
          ) : undefined
        }
      >
        {hasChallenge && challenge ? (
          challenge.devContainerRepoUrl ? (
            /* Manually selected repo */
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '16px 20px', background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)', borderRadius: 10,
              }}
            >
              <GitBranch size={18} color="#60a5fa" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: mono, marginBottom: 4 }}>
                  {challenge.devContainerRepoUrl.replace('https://github.com/', '')}
                </div>
                {challenge.devContainerChallengeBranch && (
                  <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: mono }}>
                    Branch: {challenge.devContainerChallengeBranch}
                  </div>
                )}
                {typeof issueNumber === 'number' && issueNumber > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: mono, marginTop: 4 }}>
                    Issue #{issueNumber}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Placeholder — candidate-matched repository */
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '16px 20px', background: 'rgba(74,222,128,0.04)',
                border: '1px solid rgba(74,222,128,0.15)', borderRadius: 10,
              }}
            >
              <Target size={18} color="#4ade80" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: mono, marginBottom: 4 }}>
                  Candidate-Matched Repository
                </div>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: mono, lineHeight: 1.5 }}>
                  Each candidate receives a repository and issue best matched
                  to their profile by the AI ingestion pipeline. Requires
                  candidate resume ingestion to complete.
                </div>
              </div>
            </div>
          )
        ) : (
          /* No challenge yet — offer both options */
          <div
            style={{
              padding: '32px 24px', textAlign: 'center',
              border: '1px dashed rgba(96,165,250,0.2)', borderRadius: 10,
              background: 'rgba(96,165,250,0.03)',
            }}
          >
            <Container size={24} color="rgba(96,165,250,0.4)" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 11, color: 'var(--pipe-text-muted)', fontFamily: mono, marginBottom: 20, lineHeight: 1.6 }}>
              Choose how the repository for this stage is selected.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => void handleUseMatchedRepo()}
                style={{
                  padding: '10px 18px', background: 'rgba(74,222,128,0.1)', color: '#4ade80',
                  border: '1px solid rgba(74,222,128,0.3)', borderRadius: 4, fontSize: 10, fontWeight: 800,
                  letterSpacing: '0.12em', fontFamily: mono, cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Target size={12} /> USE MATCHED REPO
                </span>
              </button>
              <button
                onClick={() => navigate(`${stagePath}/configure`)}
                style={{
                  padding: '10px 18px', background: '#60a5fa', color: '#0c0c0e',
                  border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 800,
                  letterSpacing: '0.12em', fontFamily: mono, cursor: 'pointer',
                }}
              >
                + SELECT_REPO
              </button>
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ textAlign: 'left', padding: '10px 12px', background: 'var(--pipe-surface)', borderRadius: 6, border: '1px solid var(--pipe-border)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#4ade80', fontFamily: mono, letterSpacing: '0.1em', marginBottom: 4 }}>
                  <Target size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> MATCHED REPO
                </div>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: mono, lineHeight: 1.5 }}>
                  AI selects the best repository and issue for each candidate based on their resume, skills, and experience.
                </div>
              </div>
              <div style={{ textAlign: 'left', padding: '10px 12px', background: 'var(--pipe-surface)', borderRadius: 6, border: '1px solid var(--pipe-border)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#60a5fa', fontFamily: mono, letterSpacing: '0.1em', marginBottom: 4 }}>
                  <GitBranch size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> MANUAL REPO
                </div>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: mono, lineHeight: 1.5 }}>
                  Every candidate works on the same specific repository and issue that you choose.
                </div>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Dev container settings */}
      <SectionCard
        label="DEV_CONTAINER"
        icon={<Container size={16} color="var(--pipe-text-dim)" />}
        meta={
          <button
            onClick={() => void handleSaveConfig()}
            disabled={saving || (!configChanged && !saved)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px',
              background: saved ? 'rgba(74,222,128,0.12)' : configChanged ? 'var(--pipe-text)' : 'var(--pipe-surface)',
              border: saved ? '1px solid rgba(74,222,128,0.3)' : configChanged ? '1px solid var(--pipe-text)' : '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: saved ? '#4ade80' : configChanged ? 'var(--pipe-bg)' : 'var(--pipe-text-dim)',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', fontFamily: mono,
              cursor: saving || (!configChanged && !saved) ? 'default' : 'pointer',
              opacity: saving || (!configChanged && !saved) ? 0.5 : 1,
              transition: 'all 0.2s ease',
            }}
          >
            {saved ? <><Check size={10} /> SAVED</> : saving ? 'SAVING...' : <><Save size={10} /> SAVE</>}
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TtlSelector value={ttlSeconds} onChange={setTtlSeconds} />

          {/* Challenge branch */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: mono, marginBottom: 8 }}>
              CHALLENGE_BRANCH
            </div>
            <input
              type="text"
              value={challengeBranch}
              onChange={(e) => setChallengeBranch(e.target.value)}
              placeholder="main (default)"
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 6,
                color: 'var(--pipe-text)',
                fontSize: 11,
                fontFamily: mono,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 8, color: 'var(--pipe-text-dim)', fontFamily: mono, marginTop: 4, opacity: 0.6 }}>
              The git branch to check out in the dev container. Leave blank for default branch.
            </div>
          </div>

          {/* Issue number (only when specific repo is selected) */}
          {hasChallenge && challenge?.devContainerRepoUrl && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: mono, marginBottom: 8 }}>
                ISSUE_NUMBER
              </div>
              <input
                type="number"
                value={issueNumber}
                onChange={(e) => {
                  const val = e.target.value;
                  setIssueNumber(val === '' ? '' : Number.parseInt(val, 10));
                }}
                placeholder="e.g. 42"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 6,
                  color: 'var(--pipe-text)',
                  fontSize: 11,
                  fontFamily: mono,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: 8, color: 'var(--pipe-text-dim)', fontFamily: mono, marginTop: 4, opacity: 0.6 }}>
                The GitHub issue the candidate will fix. Must exist in the selected repository.
              </div>
            </div>
          )}

          {/* Instructions */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: mono, marginBottom: 8 }}>
              CANDIDATE_INSTRUCTIONS
            </div>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Instructions for the candidate..."
              rows={4}
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 6,
                color: 'var(--pipe-text)',
                fontSize: 11,
                fontFamily: mono,
                outline: 'none',
                resize: 'vertical',
                lineHeight: 1.6,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Info box */}
          <div
            style={{
              padding: '12px 14px',
              background: 'rgba(251,191,36,0.04)',
              border: '1px solid rgba(251,191,36,0.15)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <AlertCircle size={14} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: mono, lineHeight: 1.6 }}>
              The dev container is destroyed when the session ends or TTL expires.
              Candidates should save their work before submitting. First boot may
              take 20–30 seconds while the container image warms up.
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
