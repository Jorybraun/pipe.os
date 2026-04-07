/**
 * CultureReport — Recruiter-facing culture interview score report.
 *
 * Renders a completed `CultureScoreReport` with:
 *  1. Synthesis headline + recommendation badge
 *  2. Competency scores (5 dimensions) as horizontal bars with expandable evidence
 *  3. Culture profile axes (5 dimensions) as sliders with org benchmark tick
 *  4. Narrative summary paragraphs
 *  5. HITL review box (ADR-031 compliance)
 *
 * Framing follows ADR-030: axes are labelled "culture add" not "culture fit".
 */

import { useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';

// TODO: replace with shared type from src/lib/api/types.ts once scorer lands.
interface CompetencyScore {
  dimension: 'ownership' | 'collaboration' | 'learning-orientation' | 'conflict-handling' | 'self-awareness';
  score: 1 | 2 | 3 | 4 | 5;
  evidenceQuotes: string[];
  confidence: number;
  reasoning: string;
}

interface ProfileScore {
  dimension: 'autonomy' | 'risk-tolerance' | 'work-pace' | 'collaboration-style' | 'feedback-orientation';
  candidatePosition: 1 | 2 | 3 | 4 | 5;
  evidenceQuotes: string[];
  confidence: number;
  reasoning: string;
}

interface CultureScoreReport {
  competencyScores: CompetencyScore[];
  profileScores: ProfileScore[];
  synthesis: {
    headline: string;
    narrative: string;
    recommendation: 'HIRE' | 'FLAG_FOR_REVIEW' | 'PASS';
  };
  orgBenchmark: {
    autonomy: 1 | 2 | 3 | 4 | 5;
    riskTolerance: 1 | 2 | 3 | 4 | 5;
    workPace: 1 | 2 | 3 | 4 | 5;
    collaborationStyle: 1 | 2 | 3 | 4 | 5;
    feedbackOrientation: 1 | 2 | 3 | 4 | 5;
  };
  scoredAt: string;
}

export interface CultureReportProps {
  report: CultureScoreReport;
  reviewed?: boolean;
  onConfirm?: () => void;
  onOverride?: () => void;
}

// ─── Colour tokens ────────────────────────────────────────────────────────────

const RECOMMENDATION_STYLES: Record<
  'HIRE' | 'FLAG_FOR_REVIEW' | 'PASS',
  { color: string; bg: string; border: string; label: string }
> = {
  HIRE: {
    color: '#4ade80',
    bg: 'rgba(74,222,128,0.12)',
    border: 'rgba(74,222,128,0.3)',
    label: 'HIRE',
  },
  FLAG_FOR_REVIEW: {
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.12)',
    border: 'rgba(251,191,36,0.3)',
    label: 'FLAG FOR REVIEW',
  },
  PASS: {
    color: '#f87171',
    bg: 'rgba(248,113,113,0.12)',
    border: 'rgba(248,113,113,0.3)',
    label: 'PASS',
  },
};

const DIMENSION_LABELS: Record<CompetencyScore['dimension'], string> = {
  ownership: 'Ownership',
  collaboration: 'Collaboration',
  'learning-orientation': 'Learning Orientation',
  'conflict-handling': 'Conflict Handling',
  'self-awareness': 'Self-Awareness',
};

const PROFILE_LABELS: Record<ProfileScore['dimension'], { label: string; lowLabel: string; highLabel: string }> = {
  autonomy: { label: 'Autonomy', lowLabel: 'Directed', highLabel: 'Self-directed' },
  'risk-tolerance': { label: 'Risk Tolerance', lowLabel: 'Risk-averse', highLabel: 'Risk-seeking' },
  'work-pace': { label: 'Work Pace', lowLabel: 'Methodical', highLabel: 'Fast-paced' },
  'collaboration-style': { label: 'Collaboration Style', lowLabel: 'Independent', highLabel: 'Highly collaborative' },
  'feedback-orientation': { label: 'Feedback Orientation', lowLabel: 'Private reflection', highLabel: 'Open feedback' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const FONT_MONO: CSSProperties = { fontFamily: 'Space Mono, monospace' };

function RecommendationBadge({ recommendation }: { recommendation: 'HIRE' | 'FLAG_FOR_REVIEW' | 'PASS' }): JSX.Element {
  const s = RECOMMENDATION_STYLES[recommendation];
  const Icon = recommendation === 'HIRE' ? CheckCircle : recommendation === 'PASS' ? XCircle : AlertTriangle;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 4,
        color: s.color,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.12em',
        ...FONT_MONO,
      }}
      aria-label={`Recommendation: ${s.label}`}
    >
      <Icon size={13} />
      {s.label}
    </div>
  );
}

function ConfidencePill({ confidence }: { confidence: number }): JSX.Element {
  const pct = Math.round(confidence * 100);
  const color = pct >= 70 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#f87171';
  return (
    <span
      title={`Confidence: ${pct}%`}
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.08em',
        padding: '2px 7px',
        borderRadius: 3,
        background: `${color}18`,
        border: `1px solid ${color}40`,
        color,
        ...FONT_MONO,
      }}
    >
      {pct}% CONF
    </span>
  );
}

interface CompetencyRowProps {
  score: CompetencyScore;
}

function CompetencyRow({ score }: CompetencyRowProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const pct = (score.score / 5) * 100;
  const lowConf = score.confidence < 0.5;

  // Bar fill gradient: warm amber → green as score increases
  const barColor = score.score >= 4 ? '#4ade80' : score.score >= 3 ? '#a3e635' : score.score >= 2 ? '#fbbf24' : '#f87171';

  return (
    <div style={{ borderBottom: '1px solid var(--pipe-border)', paddingBottom: 12, marginBottom: 12 }}>
      {/* Label row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span
          style={{
            width: 160,
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--pipe-text)',
            letterSpacing: '0.04em',
            flexShrink: 0,
            ...FONT_MONO,
          }}
        >
          {DIMENSION_LABELS[score.dimension].toUpperCase()}
        </span>

        {/* Score bar track */}
        <div
          style={{
            flex: 1,
            height: 6,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 3,
            overflow: 'hidden',
            position: 'relative',
          }}
          aria-label={`Score ${score.score} of 5`}
          role="meter"
          aria-valuenow={score.score}
          aria-valuemin={1}
          aria-valuemax={5}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: lowConf
                ? `repeating-linear-gradient(45deg, ${barColor}60, ${barColor}60 4px, transparent 4px, transparent 8px)`
                : `linear-gradient(90deg, ${barColor}80, ${barColor})`,
              borderRadius: 3,
              transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
              opacity: lowConf ? 0.55 : 1,
            }}
          />
        </div>

        {/* Score label */}
        <span
          style={{
            width: 32,
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 800,
            color: barColor,
            flexShrink: 0,
            ...FONT_MONO,
          }}
        >
          {score.score}/5
        </span>

        <ConfidencePill confidence={score.confidence} />

        {/* Evidence toggle */}
        {score.evidenceQuotes.length > 0 && (
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={`evidence-${score.dimension}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              padding: '2px 4px',
              borderRadius: 3,
              transition: 'color 0.15s',
              ...FONT_MONO,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--pipe-text)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--pipe-text-dim)'; }}
          >
            EVIDENCE
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      {/* Reasoning */}
      <p
        style={{
          fontSize: 11,
          color: 'var(--pipe-text-dim)',
          margin: '0 0 6px 170px',
          lineHeight: 1.5,
        }}
      >
        {score.reasoning}
      </p>

      {/* Evidence disclosure */}
      {open && score.evidenceQuotes.length > 0 && (
        <div
          id={`evidence-${score.dimension}`}
          style={{
            marginLeft: 170,
            marginTop: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {score.evidenceQuotes.map((quote, i) => (
            <blockquote
              key={i}
              style={{
                margin: 0,
                padding: '8px 12px',
                borderLeft: '2px solid var(--pipe-border)',
                background: 'rgba(255,255,255,0.025)',
                borderRadius: '0 4px 4px 0',
                fontSize: 11,
                color: 'var(--pipe-text-dim)',
                lineHeight: 1.6,
                fontStyle: 'italic',
              }}
            >
              "{quote}"
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}

interface ProfileAxisRowProps {
  profileScore: ProfileScore;
  benchmarkValue: 1 | 2 | 3 | 4 | 5;
}

function ProfileAxisRow({ profileScore, benchmarkValue }: ProfileAxisRowProps): JSX.Element {
  const [showEvidence, setShowEvidence] = useState(false);
  const meta = PROFILE_LABELS[profileScore.dimension];

  // Convert 1–5 to 0–100% for positioning
  const candidatePct = ((profileScore.candidatePosition - 1) / 4) * 100;
  const benchmarkPct = ((benchmarkValue - 1) / 4) * 100;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span
          style={{
            width: 160,
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--pipe-text)',
            letterSpacing: '0.06em',
            flexShrink: 0,
            ...FONT_MONO,
          }}
        >
          {meta.label.toUpperCase()}
        </span>
        <ConfidencePill confidence={profileScore.confidence} />
        {profileScore.evidenceQuotes.length > 0 && (
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            aria-expanded={showEvidence}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              fontSize: 9,
              letterSpacing: '0.06em',
              padding: '2px 4px',
              ...FONT_MONO,
            }}
          >
            {showEvidence ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>

      {/* Axis labels */}
      <div style={{ display: 'flex', marginLeft: 168, marginBottom: 3, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.06em', ...FONT_MONO }}>
          {meta.lowLabel.toUpperCase()}
        </span>
        <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.06em', ...FONT_MONO }}>
          {meta.highLabel.toUpperCase()}
        </span>
      </div>

      {/* Slider track */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 160, flexShrink: 0 }} />
        <div
          style={{
            flex: 1,
            height: 4,
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 2,
            position: 'relative',
          }}
        >
          {/* Benchmark tick (faded) */}
          <div
            title={`Org benchmark: ${benchmarkValue}/5`}
            style={{
              position: 'absolute',
              left: `${benchmarkPct}%`,
              top: -4,
              bottom: -4,
              width: 2,
              background: 'rgba(255,255,255,0.25)',
              borderRadius: 1,
              transform: 'translateX(-50%)',
            }}
          />

          {/* Candidate marker (bright) */}
          <div
            title={`Candidate: ${profileScore.candidatePosition}/5`}
            style={{
              position: 'absolute',
              left: `${candidatePct}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#e2e8f0',
              border: '2px solid rgba(255,255,255,0.8)',
              boxShadow: '0 0 8px rgba(255,255,255,0.3)',
              transition: 'left 0.5s cubic-bezier(0.16,1,0.3,1)',
            }}
          />
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', marginLeft: 168, marginTop: 4, gap: 16 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, color: 'var(--pipe-text-dim)', ...FONT_MONO }}>
          <div style={{ width: 2, height: 10, background: 'rgba(255,255,255,0.25)', borderRadius: 1 }} />
          ORG BENCHMARK
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, color: 'var(--pipe-text-dim)', ...FONT_MONO }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#e2e8f0', border: '2px solid rgba(255,255,255,0.8)' }} />
          CANDIDATE
        </span>
      </div>

      {/* Evidence */}
      {showEvidence && profileScore.evidenceQuotes.length > 0 && (
        <div style={{ marginLeft: 168, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {profileScore.evidenceQuotes.map((quote, i) => (
            <blockquote
              key={i}
              style={{
                margin: 0,
                padding: '8px 12px',
                borderLeft: '2px solid var(--pipe-border)',
                background: 'rgba(255,255,255,0.025)',
                borderRadius: '0 4px 4px 0',
                fontSize: 11,
                color: 'var(--pipe-text-dim)',
                lineHeight: 1.6,
                fontStyle: 'italic',
              }}
            >
              "{quote}"
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: string }): JSX.Element {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.18em',
        color: 'var(--pipe-text-dim)',
        textTransform: 'uppercase',
        borderBottom: '1px solid var(--pipe-border)',
        paddingBottom: 8,
        marginBottom: 16,
        ...FONT_MONO,
      }}
    >
      {children}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * CultureReport renders a completed culture interview score report for recruiter review.
 *
 * Complies with:
 *  - ADR-030: culture add framing (not "culture fit")
 *  - ADR-031: HITL review requirement before actioning a recommendation
 *
 * @example
 * ```tsx
 * <CultureReport report={scoreReport} onConfirm={handleConfirm} onOverride={handleOverride} />
 * ```
 */
export function CultureReport({ report, reviewed = false, onConfirm, onOverride }: CultureReportProps): JSX.Element {
  const { synthesis, competencyScores, profileScores, orgBenchmark, scoredAt } = report;
  const recStyle = RECOMMENDATION_STYLES[synthesis.recommendation];

  // Map benchmark object to keyed lookup by ProfileScore['dimension']
  const benchmarkMap: Record<ProfileScore['dimension'], 1 | 2 | 3 | 4 | 5> = {
    autonomy: orgBenchmark.autonomy,
    'risk-tolerance': orgBenchmark.riskTolerance,
    'work-pace': orgBenchmark.workPace,
    'collaboration-style': orgBenchmark.collaborationStyle,
    'feedback-orientation': orgBenchmark.feedbackOrientation,
  };

  const scoredDate = new Date(scoredAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: 'Space Mono, monospace',
        color: 'var(--pipe-text)',
      }}
    >
      {/* ── 1. Headline + recommendation ─────────────────────────────────── */}
      <LiquidMetalCard variant="dark" style={{ borderRadius: 8, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.16em',
                color: 'var(--pipe-text-dim)',
                marginBottom: 6,
                ...FONT_MONO,
              }}
            >
              CULTURE INTERVIEW — {scoredDate}
            </div>
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 800,
                color: 'var(--pipe-text)',
                lineHeight: 1.3,
                letterSpacing: '0.01em',
                maxWidth: 520,
              }}
            >
              {synthesis.headline}
            </h2>
          </div>
          <RecommendationBadge recommendation={synthesis.recommendation} />
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--pipe-border)', marginTop: 16 }} />
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 12,
            flexWrap: 'wrap',
          }}
        >
          {competencyScores.map((cs) => (
            <span
              key={cs.dimension}
              title={`${DIMENSION_LABELS[cs.dimension]}: ${cs.score}/5`}
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.07em',
                padding: '3px 8px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 3,
                color:
                  cs.score >= 4
                    ? '#4ade80'
                    : cs.score >= 3
                    ? '#a3e635'
                    : cs.score >= 2
                    ? '#fbbf24'
                    : '#f87171',
                ...FONT_MONO,
              }}
            >
              {DIMENSION_LABELS[cs.dimension].replace(' ', '\u00A0').toUpperCase()}&nbsp;{cs.score}/5
            </span>
          ))}
        </div>
      </LiquidMetalCard>

      {/* ── 2. Competency scores ─────────────────────────────────────────── */}
      <LiquidMetalCard variant="default" style={{ borderRadius: 8, padding: '20px 24px' }}>
        <SectionHeading>Competency Scores</SectionHeading>
        {competencyScores.map((cs) => (
          <CompetencyRow key={cs.dimension} score={cs} />
        ))}
      </LiquidMetalCard>

      {/* ── 3. Culture add profile axes ──────────────────────────────────── */}
      <LiquidMetalCard variant="default" style={{ borderRadius: 8, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, borderBottom: '1px solid var(--pipe-border)', paddingBottom: 8 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.18em',
              color: 'var(--pipe-text-dim)',
              textTransform: 'uppercase',
              ...FONT_MONO,
            }}
          >
            Culture Add Profile
          </span>
          {/* Tooltip explaining "culture add" framing */}
          <div
            title="We measure culture add, not culture fit. A high delta from the benchmark isn't a penalty — it signals a candidate who may enrich or shift team dynamics. Recruiters should interpret gaps as conversation starters, not disqualifiers."
            style={{ cursor: 'help', color: 'var(--pipe-text-dim)', display: 'flex', alignItems: 'center' }}
            aria-label="Culture add explanation"
          >
            <Info size={12} />
          </div>
          <span
            style={{
              fontSize: 8,
              color: 'var(--pipe-text-dim)',
              fontStyle: 'italic',
              letterSpacing: '0.02em',
            }}
          >
            — distance from benchmark reflects additive potential, not misalignment
          </span>
        </div>
        {profileScores.map((ps) => (
          <ProfileAxisRow
            key={ps.dimension}
            profileScore={ps}
            benchmarkValue={benchmarkMap[ps.dimension]}
          />
        ))}
      </LiquidMetalCard>

      {/* ── 4. Narrative summary ─────────────────────────────────────────── */}
      <LiquidMetalCard variant="default" style={{ borderRadius: 8, padding: '20px 24px' }}>
        <SectionHeading>Synthesis</SectionHeading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {synthesis.narrative.split('\n\n').filter(Boolean).map((paragraph, i) => (
            <p
              key={i}
              style={{
                margin: 0,
                fontSize: 13,
                color: 'var(--pipe-text)',
                lineHeight: 1.7,
                letterSpacing: '0.01em',
              }}
            >
              {paragraph}
            </p>
          ))}
        </div>
      </LiquidMetalCard>

      {/* ── 5. HITL review box (ADR-031) ─────────────────────────────────── */}
      <LiquidMetalCard
        variant="dark"
        style={{
          borderRadius: 8,
          padding: '20px 24px',
          border: reviewed ? '1px solid var(--pipe-border)' : `1px solid ${recStyle.border}`,
          opacity: reviewed ? 0.6 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '0.14em',
                color: reviewed ? 'var(--pipe-text-dim)' : recStyle.color,
                marginBottom: 6,
                ...FONT_MONO,
              }}
            >
              {reviewed ? 'REVIEW COMPLETE' : 'HUMAN REVIEW REQUIRED'}
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: 'var(--pipe-text-dim)',
                lineHeight: 1.5,
                maxWidth: 460,
              }}
            >
              {reviewed
                ? 'This report has been reviewed. Your decision has been recorded.'
                : 'This report was generated by AI. Review before making a decision.'}
            </p>
          </div>

          {!reviewed && (
            <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
              <button
                onClick={onOverride}
                disabled={reviewed}
                aria-label="Override AI recommendation"
                style={{
                  padding: '8px 16px',
                  background: 'transparent',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 4,
                  color: 'var(--pipe-text-dim)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  ...FONT_MONO,
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = 'rgba(255,255,255,0.05)';
                  el.style.color = 'var(--pipe-text)';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = 'transparent';
                  el.style.color = 'var(--pipe-text-dim)';
                }}
              >
                OVERRIDE
              </button>
              <button
                onClick={onConfirm}
                disabled={reviewed}
                aria-label="Confirm AI recommendation"
                style={{
                  padding: '8px 16px',
                  background: recStyle.bg,
                  border: `1px solid ${recStyle.border}`,
                  borderRadius: 4,
                  color: recStyle.color,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  ...FONT_MONO,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.15)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.filter = 'none';
                }}
              >
                CONFIRM
              </button>
            </div>
          )}
        </div>
      </LiquidMetalCard>
    </div>
  );
}
