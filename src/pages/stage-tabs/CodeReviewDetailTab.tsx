/**
 * CodeReviewDetailTab — default tab for CODE_REVIEW stages.
 *
 * Replaces the generic "Challenges" tab entirely. Code review is an async
 * assessment: candidates review a source-backed PR, defend comments against an
 * implementation author, and leave evidence recruiters can inspect later.
 */

import { useState, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  GitPullRequest,
  Clock,
  ChevronRight,
  Target,
  Search,
  CheckCircle2,
  Bot,
  ShieldCheck,
  Network,
} from 'lucide-react';
import { SectionCard } from '../../components';
import { useChallengeMutations } from '../../hooks/useChallengeMutations';
import type { StagePanelContext } from '../StagePanel';

const mono = '"Space Mono", monospace';

const DEFAULT_CODE_REVIEW_CONFIG = {
  isMultiTurn: true,
  enableExplainer: false,
  enableFollowUp: true,
  implementerPersona: 'junior',
  maxRounds: 4,
  maxExplainerQuestions: 6,
};

/* ── Main component ────────────────────────────────────────────────────── */

export default function CodeReviewDetailTab(): JSX.Element {
  const { shell, stage, stageId, refetchStage } = useOutletContext<StagePanelContext>();
  const navigate = useNavigate();
  const { createChallenge } = useChallengeMutations();

  const stagePath = `/pipeline/${shell.pipelineId}/stage/${stageId}`;

  // Find CODE_REVIEW challenges
  const crChallenges = stage.challenges?.filter((c) => c.type === 'CODE_REVIEW') ?? [];
  const hasChallenge = crChallenges.length > 0;
  const challenge = crChallenges[0];

  const existingConfig = challenge?.config as Record<string, unknown> | null;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  /** Create a placeholder challenge with no repo/PR so the matching
   *  system assigns the best-matched repository per candidate. */
  const handleUseMatchedRepo = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      const newConfig = {
        ...DEFAULT_CODE_REVIEW_CONFIG,
        ...(existingConfig ?? {}),
        useMatchedRepo: true,
      };
      await createChallenge(stageId, {
        type: 'CODE_REVIEW',
        title: 'Code Review Challenge',
        instructions: 'Review the pull request and provide feedback.',
        config: newConfig,
      });
      await refetchStage();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[CodeReviewDetailTab] Failed to create matched-repo challenge:', err);
    } finally {
      setSaving(false);
    }
  }, [existingConfig, stageId, createChallenge, refetchStage]);

  return (
    <div
      data-testid="stage-tab-content-code-review-detail"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Hero — what this stage is */}
      <SectionCard
        label="ASYNC_CODE_REVIEW"
        icon={<GitPullRequest size={16} color="var(--pipe-text-dim)" />}
        meta="CODE_REVIEW"
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
            Candidates open an assessment link, review a real pull request,
            leave inline comments, choose a verdict, and write a summary.
            PIPE selects the PR from source-backed person, role, and repository
            evidence, or from a recruiter-provided repo/PR override.
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
              { label: 'ASSESS LINK', icon: GitPullRequest },
              { label: 'REVIEW PR', icon: Search },
              { label: 'AUTHOR REPLIES', icon: Bot },
              { label: 'RESULT', icon: CheckCircle2 },
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {[
              {
                icon: Clock,
                label: 'DURATION',
                value: 'ASYNC',
                sub: 'candidate-paced review',
              },
              {
                icon: GitPullRequest,
                label: 'CONTEXT',
                value: 'REAL PR',
                sub: 'matched or manually selected',
              },
              {
                icon: Target,
                label: 'EVIDENCE',
                value: 'SOURCE-BACKED',
                sub: 'comments, verdict, and rationale',
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

      <SectionCard
        label="QUALITY_GATE"
        icon={<ShieldCheck size={16} color="var(--pipe-text-dim)" />}
        meta="MATCH + JUDGE LOOP"
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {[
            {
              icon: Network,
              label: 'HYPERGRAPH MATCH',
              text: 'Match decisions connect role terms, person evidence, and repo source spans through source-backed context records.',
            },
            {
              icon: ShieldCheck,
              label: 'VALIDATOR AGENT',
              text: 'The selected PR must pass deterministic gates for provenance, role alignment, repo spans, stretch bounds, and eligibility.',
            },
            {
              icon: Bot,
              label: 'IMPLEMENTATION AUTHOR',
              text: 'Candidate comments can trigger author replies so reviewers must defend engineering decisions, not just spot syntax.',
            },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                padding: '14px 16px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 10,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <item.icon size={12} color="var(--pipe-text-dim)" />
                <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--pipe-text-dim)', fontFamily: mono }}>
                  {item.label}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', lineHeight: 1.6, fontFamily: mono }}>
                {item.text}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* PR configuration */}
      <SectionCard
        label="PR_CONTEXT"
        icon={<GitPullRequest size={16} color="var(--pipe-text-dim)" />}
        meta={
          hasChallenge && challenge?.githubRepoUrl ? (
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
              EDIT_PR <ChevronRight size={10} />
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
              SELECT PR <ChevronRight size={10} />
            </button>
          ) : undefined
        }
      >
        {hasChallenge && challenge ? (
          challenge.githubRepoUrl ? (
            /* Manually selected PR */
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '16px 20px', background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)', borderRadius: 10,
              }}
            >
              <GitPullRequest size={18} color="#60a5fa" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: mono, marginBottom: 4 }}>
                  {challenge.githubPrTitle ?? challenge.title}
                </div>
                {challenge.githubRepoUrl && (
                  <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: mono }}>
                    {challenge.githubRepoUrl.replace('https://github.com/', '')}
                    {challenge.githubPrNumber ? ` #${challenge.githubPrNumber}` : ''}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Placeholder — source-backed candidate match */
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
                  Source-backed candidate match
                </div>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: mono, lineHeight: 1.5 }}>
                  PIPE selects a reviewable pull request only when person
                  evidence and repository challenge packets support it. If
                  evidence is missing, the match reports the gap instead of
                  choosing a generic fallback.
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
            <GitPullRequest size={24} color="rgba(96,165,250,0.4)" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 11, color: 'var(--pipe-text-muted)', fontFamily: mono, marginBottom: 20, lineHeight: 1.6 }}>
              Choose the PR context for this interview.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => void handleUseMatchedRepo()}
                disabled={saving}
                style={{
                  padding: '10px 18px', background: 'rgba(74,222,128,0.1)', color: '#4ade80',
                  border: '1px solid rgba(74,222,128,0.3)', borderRadius: 4, fontSize: 10, fontWeight: 800,
                  letterSpacing: '0.12em', fontFamily: mono, cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.55 : 1,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Target size={12} /> {saving ? 'CREATING...' : saved ? 'READY' : 'MATCH FROM EVIDENCE'}
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
                + SELECT PR
              </button>
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ textAlign: 'left', padding: '10px 12px', background: 'var(--pipe-surface)', borderRadius: 6, border: '1px solid var(--pipe-border)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#4ade80', fontFamily: mono, letterSpacing: '0.1em', marginBottom: 4 }}>
                  <Target size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> MATCHED REPO
                </div>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: mono, lineHeight: 1.5 }}>
                  PIPE matches only from source-backed person evidence and approved repository challenge packets.
                </div>
              </div>
              <div style={{ textAlign: 'left', padding: '10px 12px', background: 'var(--pipe-surface)', borderRadius: 6, border: '1px solid var(--pipe-border)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#60a5fa', fontFamily: mono, letterSpacing: '0.1em', marginBottom: 4 }}>
                  <GitPullRequest size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> MANUAL PR
                </div>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: mono, lineHeight: 1.5 }}>
                  Every candidate reviews the same specific pull request that you choose.
                </div>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

    </div>
  );
}
