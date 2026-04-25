/**
 * CultureDetailTab — default tab for CULTURAL stage type.
 *
 * Replaces the generic "Challenges" tab for culture stages. Shows:
 *   - What the AI interview is (STAR-format behavioral)
 *   - The 5 competency dimensions being scored
 *   - The 5 culture profile axes
 *   - Interview settings (question count, time estimate)
 *   - Status indicator for benchmark configuration
 */

import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  Brain,
  Shield,
  Clock,
  MessageSquare,
  ChevronRight,
  Sparkles,
  Users,
  Target,
  Compass,
  Gauge,
  Handshake,
  MessageCircle,
  Eye,
  Flame,
  BookOpen,
} from 'lucide-react';
import { SectionCard } from '../../components';
import type { StagePanelContext } from '../StagePanel';

/** The 5 competency scoring dimensions (BARS, 1-5). */
const COMPETENCY_DIMENSIONS = [
  {
    key: 'ownership',
    label: 'Ownership',
    icon: Flame,
    color: '#f97316',
    description: 'Takes responsibility for outcomes beyond formal scope',
  },
  {
    key: 'collaboration',
    label: 'Collaboration',
    icon: Handshake,
    color: '#60a5fa',
    description: 'Works effectively across people and teams',
  },
  {
    key: 'learning-orientation',
    label: 'Learning Orientation',
    icon: BookOpen,
    color: '#4ade80',
    description: 'Adapts, grows, and updates beliefs from evidence',
  },
  {
    key: 'conflict-handling',
    label: 'Conflict Handling',
    icon: MessageCircle,
    color: '#f472b6',
    description: 'Navigates disagreements and difficult conversations',
  },
  {
    key: 'self-awareness',
    label: 'Self-Awareness',
    icon: Eye,
    color: 'var(--pipe-accent)',
    description: 'Recognizes own patterns, blind spots, and impact',
  },
] as const;

/** The 5 culture profile axes (slider, compared to org benchmark). */
const PROFILE_AXES = [
  {
    key: 'autonomy',
    label: 'Autonomy',
    icon: Compass,
    low: 'Structured',
    high: 'Self-directed',
  },
  {
    key: 'risk-tolerance',
    label: 'Risk Tolerance',
    icon: Target,
    low: 'Conservative',
    high: 'Bold',
  },
  {
    key: 'work-pace',
    label: 'Work Pace',
    icon: Gauge,
    low: 'Deliberate',
    high: 'Fast-moving',
  },
  {
    key: 'collaboration-style',
    label: 'Collaboration Style',
    icon: Users,
    low: 'Independent',
    high: 'Highly collaborative',
  },
  {
    key: 'feedback-orientation',
    label: 'Feedback Orientation',
    icon: MessageSquare,
    low: 'Diplomatic',
    high: 'Direct',
  },
] as const;

const mono = '"Space Mono", monospace';

export default function CultureDetailTab(): JSX.Element {
  const { shell, stage, stageId } = useOutletContext<StagePanelContext>();
  const navigate = useNavigate();

  const stagePath = `/pipeline/${shell.pipelineId}/stage/${stageId}`;

  // Check if benchmark is configured via server_config on challenges
  const hasBenchmark = stage.challenges?.some(
    (c) =>
      c.config &&
      typeof c.config === 'object' &&
      'orgBenchmark' in c.config,
  );

  return (
    <div
      data-testid="stage-tab-content-culture-detail"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Hero — what this stage is */}
      <SectionCard
        label="AI_BEHAVIORAL_INTERVIEW"
        icon={<Brain size={16} color="var(--pipe-text-dim)" />}
        meta="POWERED_BY_GEMMA"
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
            An AI agent conducts a structured STAR-format behavioral interview
            with each candidate. Questions are drawn from a curated bank of 15
            questions across 5 competency dimensions. The agent probes for
            missing details, scores each dimension against research-backed BARS
            rubrics, and generates an evidence-grounded report.
          </p>

          {/* Key stats row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            {[
              {
                icon: MessageSquare,
                label: 'QUESTIONS',
                value: '5–9',
                sub: 'adaptive selection',
              },
              {
                icon: Clock,
                label: 'DURATION',
                value: '15–30 min',
                sub: 'async, candidate-paced',
              },
              {
                icon: Shield,
                label: 'COMPLIANCE',
                value: 'HITL',
                sub: 'recruiter reviews every report',
              },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  padding: '16px 20px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <stat.icon size={12} color="var(--pipe-text-dim)" />
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: '0.2em',
                      color: 'var(--pipe-text-dim)',
                      fontFamily: mono,
                    }}
                  >
                    {stat.label}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: 'var(--pipe-text)',
                    fontFamily: mono,
                    lineHeight: 1,
                    marginBottom: 4,
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--pipe-text-muted)',
                    fontFamily: mono,
                    letterSpacing: '0.05em',
                  }}
                >
                  {stat.sub}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Competency dimensions */}
      <SectionCard
        label="COMPETENCY_SCORING"
        icon={<Sparkles size={16} color="var(--pipe-text-dim)" />}
        meta="5 DIMENSIONS × BARS 1–5"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {COMPETENCY_DIMENSIONS.map((dim) => (
            <div
              key={dim.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 16px',
                borderRadius: 8,
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = 'var(--pipe-surface)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = 'transparent')
              }
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: `${dim.color}15`,
                  border: `1px solid ${dim.color}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <dim.icon size={14} color={dim.color} />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--pipe-text)',
                    fontFamily: mono,
                    letterSpacing: '0.05em',
                    marginBottom: 2,
                  }}
                >
                  {dim.label}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--pipe-text-muted)',
                    fontFamily: mono,
                  }}
                >
                  {dim.description}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 3,
                }}
              >
                {[1, 2, 3, 4, 5].map((level) => (
                  <div
                    key={level}
                    style={{
                      width: 6,
                      height: 14,
                      borderRadius: 2,
                      background: `${dim.color}${level <= 3 ? '40' : '18'}`,
                      border: `1px solid ${dim.color}25`,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Culture profile preview + benchmark CTA */}
      <SectionCard
        label="CULTURE_PROFILE"
        icon={<Compass size={16} color="var(--pipe-text-dim)" />}
        meta={
          <button
            onClick={() => navigate(`${stagePath}/benchmark`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: hasBenchmark
                ? 'transparent'
                : 'rgba(251,191,36,0.1)',
              border: `1px solid ${hasBenchmark ? 'var(--pipe-border)' : 'rgba(251,191,36,0.3)'}`,
              borderRadius: 4,
              color: hasBenchmark
                ? 'var(--pipe-text-dim)'
                : '#fbbf24',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.1em',
              fontFamily: mono,
              cursor: 'pointer',
            }}
          >
            {hasBenchmark ? 'EDIT_BENCHMARK' : 'SET_BENCHMARK'}
            <ChevronRight size={10} />
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <p
            style={{
              margin: '0 0 16px',
              fontSize: 11,
              lineHeight: 1.6,
              color: 'var(--pipe-text-muted)',
              fontFamily: mono,
            }}
          >
            The culture profile compares each candidate against your team's
            benchmark across 5 working-style axes. Define your team's position
            first — candidate responses are scored relative to it. Divergences of
            2+ are flagged, not penalized.
          </p>

          {PROFILE_AXES.map((axis) => (
            <div
              key={axis.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 16px',
                borderRadius: 8,
              }}
            >
              <axis.icon
                size={14}
                color="var(--pipe-text-dim)"
                style={{ flexShrink: 0 }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--pipe-text)',
                    fontFamily: mono,
                    letterSpacing: '0.08em',
                    marginBottom: 6,
                  }}
                >
                  {axis.label}
                </div>
                {/* Axis track */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      fontSize: 8,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: mono,
                      letterSpacing: '0.05em',
                      width: 72,
                      textAlign: 'right',
                      flexShrink: 0,
                    }}
                  >
                    {axis.low}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 3,
                      background: 'var(--pipe-border)',
                      borderRadius: 2,
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: -3,
                        width: 1,
                        height: 9,
                        background: 'var(--pipe-text-dim)',
                        transform: 'translateX(-50%)',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 8,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: mono,
                      letterSpacing: '0.05em',
                      width: 92,
                      flexShrink: 0,
                    }}
                  >
                    {axis.high}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {!hasBenchmark && (
            <div
              style={{
                marginTop: 12,
                padding: '12px 16px',
                background: 'rgba(251,191,36,0.06)',
                border: '1px solid rgba(251,191,36,0.15)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Target size={12} color="#fbbf24" />
              <span
                style={{
                  fontSize: 10,
                  color: '#fbbf24',
                  fontFamily: mono,
                  letterSpacing: '0.05em',
                }}
              >
                Set your team benchmark to enable culture-add comparison in
                reports.
              </span>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
