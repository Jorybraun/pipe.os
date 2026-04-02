/**
 * IntelligenceReport — feature-flagged candidate analytics dashboard.
 *
 * Surfaces all existing assessment data (scores, annotations, submissions,
 * follow-up Q&A, AI feedback) as a rich visual report behind
 * VITE_FEATURE_INTELLIGENCE_REPORT=true.
 *
 * Design: brutalist glassmorphic — Space Mono, dark #0c0c0e, pure SVG charts.
 * No external chart library deps.
 */

import { calculateSignal } from '../../lib/utils';
import type { CandidateSignal } from '../../lib/utils';

// ─── Local types (structurally compatible with CandidateProfilePage types) ────

interface ChallengeRow {
  id: string;
  type?: string | null;
  title?: string | null;
  config?: unknown;
  instructions?: string | null;
  githubRepoUrl?: string | null;
  githubPrNumber?: number | null;
}

interface StageRow {
  id: string;
  title?: string | null;
  order?: number | null;
  challenges?: ChallengeRow[] | null;
}

interface AssessmentRow {
  id: string;
  challengeId?: string | null;
  score?: number | null;
  submission?: unknown;
  feedback?: string | null;
  completedAt?: string | null;
  followUpQuestionsJson?: string | number | boolean | object | unknown[] | null;
}

interface StageStatRow {
  id: string;
  title: string | null | undefined;
  score: number | null;
  isComplete: boolean;
}

/**
 * Structured feedback written by the agentic scoring Lambda.
 * Stored as JSON in Assessment.feedback; detected by presence of `skillProfile`.
 */
interface AgenticFeedback {
  score: number;
  summary: string;
  strengths: string[];
  concerns: string[];
  skillProfile: {
    bugIdentification: number;
    severityJudgment: number;
    analyticalWriting: number;
    technicalDepth: number;
  };
}

interface AnnotationRecord {
  line?: number | string;
  lineNumber?: number | string;
  file?: string;
  severity?: string;
  comment?: string;
  timestamp?: string;
}

interface FollowUpQuestionRecord {
  id: string;
  question: string;
  context?: string;
  type?: string;
}

interface FollowUpAnswerRecord {
  questionId: string;
  answer: string;
  answeredAt?: string;
}

interface ParsedFollowUp {
  questions?: FollowUpQuestionRecord[];
  answers?: FollowUpAnswerRecord[];
}

interface CandidateRow {
  name?: string | null;
  email?: string | null;
}

export interface IntelligenceReportProps {
  candidate: CandidateRow;
  assessments: AssessmentRow[];
  stages: StageRow[];
  stageStats: StageStatRow[];
  avgScore: number | null;
  signal: CandidateSignal;
  signalColors: { text: string; bg: string; border: string };
}

// ─── Colour constants ─────────────────────────────────────────────────────────

const SIGNAL_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  STRONG: { text: '#10b981', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.3)' },
  YES:    { text: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.3)'  },
  MAYBE:  { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.3)'  },
  NO:     { text: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)' },
};

const SEV_COLORS: Record<string, string> = {
  critical: '#ef4444',
  major:    '#f59e0b',
  minor:    '#60a5fa',
};

const CHALLENGE_TYPE_COLORS: Record<string, string> = {
  CODE_REVIEW:         '#60a5fa',
  CODE_IMPLEMENTATION: '#a78bfa',
  QUIZ_MCQ:            '#4ade80',
  QUIZ_SHORT_ANSWER:   '#fbbf24',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSignalColor(signal: string): { text: string; bg: string; border: string } {
  return SIGNAL_COLORS[signal] ?? SIGNAL_COLORS['MAYBE']!;
}

/** Try to parse Assessment.feedback as AgenticFeedback JSON. Returns null for plain-string feedback. */
function parseAgenticFeedback(feedback: string | null | undefined): AgenticFeedback | null {
  if (!feedback) return null;
  try {
    const parsed = JSON.parse(feedback) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && 'skillProfile' in parsed) {
      return parsed as unknown as AgenticFeedback;
    }
    return null;
  } catch {
    return null;
  }
}

/** Parse submission JSON from AssessmentRow.submission (may be string or object). */
function parseSubmission(submission: unknown): Record<string, unknown> | null {
  if (!submission) return null;
  if (typeof submission === 'string') {
    try { return JSON.parse(submission) as Record<string, unknown>; } catch { return null; }
  }
  if (typeof submission === 'object' && !Array.isArray(submission)) {
    return submission as Record<string, unknown>;
  }
  return null;
}

/** Parse followUpQuestionsJson field to a typed shape. */
function parseFollowUp(raw: unknown): ParsedFollowUp | null {
  if (!raw) return null;
  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ParsedFollowUp;
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch { return null; }
}

/** Extract annotations array from either submission.annotations or root annotations field. */
function extractAnnotations(submission: Record<string, unknown> | null): AnnotationRecord[] {
  if (!submission) return [];
  const anns = submission['annotations'] ?? submission['codeReviewAnnotations'];
  if (!Array.isArray(anns)) return [];
  return anns as AnnotationRecord[];
}

// ─── SVG Charts ───────────────────────────────────────────────────────────────

/** Circular radial score gauge. */
function ScoreGauge({ score, signal }: { score: number; signal: CandidateSignal }): JSX.Element {
  const r = 58;
  const circ = 2 * Math.PI * r;
  const fill = Math.max(0, Math.min(1, score / 100)) * circ;
  const color = getSignalColor(signal).text;

  return (
    <svg width="160" height="160" viewBox="0 0 160 160" aria-label={`Score: ${score}, Signal: ${signal}`}>
      {/* Track */}
      <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
      {/* Fill */}
      <circle
        cx="80" cy="80" r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 80 80)"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      {/* Score */}
      <text x="80" y="72" textAnchor="middle" fill="#fff" fontSize="30" fontWeight="900" fontFamily="Space Mono, monospace">
        {score}
      </text>
      {/* Signal label */}
      <text x="80" y="92" textAnchor="middle" fill={color} fontSize="9" fontFamily="Space Mono, monospace" letterSpacing="2">
        {signal}
      </text>
    </svg>
  );
}

/** 4-axis spider/radar chart for CODE_REVIEW skill dimensions. */
function SkillRadarChart({
  skillProfile,
  color,
}: {
  skillProfile: AgenticFeedback['skillProfile'];
  color: string;
}): JSX.Element {
  const cx = 110, cy = 110, maxR = 72;

  const dims = [
    { key: 'bugIdentification' as const, label: 'BUG_ID',   angleDeg: -90 },
    { key: 'severityJudgment'  as const, label: 'SEVERITY', angleDeg: 0   },
    { key: 'analyticalWriting' as const, label: 'WRITING',  angleDeg: 90  },
    { key: 'technicalDepth'    as const, label: 'DEPTH',    angleDeg: 180 },
  ];

  const toXY = (value: number, angleDeg: number): { x: number; y: number } => {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + (value / 100) * maxR * Math.cos(rad),
      y: cy + (value / 100) * maxR * Math.sin(rad),
    };
  };

  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const dataPoints = dims.map(d => toXY(skillProfile[d.key], d.angleDeg));
  const dataPolygon = dataPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Label positioning: slightly outside maxR
  const labelOffset = maxR + 22;
  const labelAnchor = (angleDeg: number): string => {
    if (Math.abs(angleDeg) === 0)   return 'start';
    if (Math.abs(angleDeg) === 180) return 'end';
    return 'middle';
  };

  return (
    <svg width="220" height="220" viewBox="0 0 220 220" aria-label="Skill radar chart">
      {/* Grid rings */}
      {gridLevels.map(level => {
        const pts = dims.map(d => toXY(100 * level, d.angleDeg));
        const polygon = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        return (
          <polygon
            key={level}
            points={polygon}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="1"
          />
        );
      })}

      {/* Axis lines */}
      {dims.map(d => {
        const end = toXY(100, d.angleDeg);
        return (
          <line
            key={d.key}
            x1={cx} y1={cy}
            x2={end.x.toFixed(1)} y2={end.y.toFixed(1)}
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="1"
          />
        );
      })}

      {/* Data polygon */}
      <polygon
        points={dataPolygon}
        fill={`${color}28`}
        stroke={color}
        strokeWidth="1.5"
      />

      {/* Data point dots */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="3.5" fill={color} />
      ))}

      {/* Score values near each data point */}
      {dims.map((d, i) => {
        const pt = dataPoints[i]!;
        const offsetY = d.angleDeg === -90 ? -10 : d.angleDeg === 90 ? 12 : -4;
        const offsetX = d.angleDeg === 0 ? 10 : d.angleDeg === 180 ? -10 : 0;
        return (
          <text
            key={`val-${d.key}`}
            x={(pt.x + offsetX).toFixed(1)}
            y={(pt.y + offsetY).toFixed(1)}
            textAnchor="middle"
            fill="rgba(255,255,255,0.8)"
            fontSize="9"
            fontFamily="Space Mono, monospace"
            fontWeight="700"
          >
            {skillProfile[d.key]}
          </text>
        );
      })}

      {/* Axis labels */}
      {dims.map(d => {
        const labelPt = toXY(labelOffset, d.angleDeg);
        return (
          <text
            key={`lbl-${d.key}`}
            x={labelPt.x.toFixed(1)}
            y={labelPt.y.toFixed(1)}
            textAnchor={labelAnchor(d.angleDeg)}
            dominantBaseline="middle"
            fill="rgba(255,255,255,0.35)"
            fontSize="7.5"
            fontFamily="Space Mono, monospace"
            letterSpacing="0.5"
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }): JSX.Element {
  return (
    <div style={{
      fontSize: 9,
      letterSpacing: '0.2em',
      color: 'var(--pipe-text-dim)',
      fontFamily: '"Space Mono", monospace',
      marginBottom: 16,
    }}>
      {text}
    </div>
  );
}

// ─── Follow-up transcript ─────────────────────────────────────────────────────

function FollowUpTranscript({ raw }: { raw: unknown }): JSX.Element | null {
  const data = parseFollowUp(raw);
  if (!data) return null;
  const questions = data.questions ?? [];
  const answers = data.answers ?? [];
  if (questions.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <SectionLabel text="FOLLOW_UP_TRANSCRIPT" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {questions.map((q, idx) => {
          const ans = answers.find(a => a.questionId === q.id);
          return (
            <div key={q.id}>
              {/* Question */}
              <div style={{
                display: 'flex',
                gap: 10,
                alignItems: 'baseline',
                marginBottom: 8,
              }}>
                <span style={{
                  fontSize: 8,
                  fontWeight: 700,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.1em',
                  flexShrink: 0,
                }}>
                  Q{idx + 1}
                </span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
                  {q.question}
                </span>
              </div>
              {/* Answer */}
              {ans?.answer ? (
                <div style={{
                  marginLeft: 24,
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.025)',
                  borderLeft: '2px solid rgba(255,255,255,0.12)',
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.82)',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                }}>
                  {ans.answer}
                </div>
              ) : (
                <div style={{
                  marginLeft: 24,
                  fontSize: 10,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  fontStyle: 'italic',
                }}>
                  NOT_ANSWERED
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Annotation severity breakdown ───────────────────────────────────────────

function AnnotationBreakdown({ annotations }: { annotations: AnnotationRecord[] }): JSX.Element | null {
  if (annotations.length === 0) return null;

  const counts: Record<'critical' | 'major' | 'minor', number> = {
    critical: 0, major: 0, minor: 0,
  };
  annotations.forEach(ann => {
    const sev = (ann.severity ?? 'minor').toLowerCase();
    if (sev in counts) counts[sev as keyof typeof counts]++;
  });

  return (
    <div>
      <SectionLabel text="ANNOTATION_BREAKDOWN" />
      {/* Count badges — one per severity */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(['critical', 'major', 'minor'] as const).map(sev => {
          const count = counts[sev];
          const color = SEV_COLORS[sev]!;
          return (
            <div key={sev} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              background: count > 0 ? `${color}12` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${count > 0 ? `${color}35` : 'rgba(255,255,255,0.06)'}`,
              borderRadius: 4,
            }}>
              <span style={{
                fontSize: 22,
                fontWeight: 900,
                color: count > 0 ? color : 'rgba(255,255,255,0.15)',
                fontFamily: '"Space Mono", monospace',
                lineHeight: 1,
              }}>
                {count}
              </span>
              <span style={{
                fontSize: 8,
                fontWeight: 700,
                color: count > 0 ? color : 'rgba(255,255,255,0.2)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}>
                {sev}
              </span>
            </div>
          );
        })}
      </div>

      {/* Full annotation list */}
      {annotations.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {annotations.map((ann, idx) => {
            const sev = (ann.severity ?? 'minor').toLowerCase();
            const color = SEV_COLORS[sev] ?? SEV_COLORS['minor']!;
            const fileRef = ann.file
              ? `${String(ann.file).split('/').pop() ?? ''}:${String(ann.line ?? ann.lineNumber ?? '')}`
              : String(ann.line ?? ann.lineNumber ?? '');
            return (
              <div key={idx} style={{
                padding: '10px 14px',
                background: 'var(--pipe-surface)',
                borderLeft: `2px solid ${color}`,
                borderRadius: '0 3px 3px 0',
              }}>
                <div style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  marginBottom: 4,
                }}>
                  {fileRef && (
                    <span style={{
                      fontSize: 9,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                    }}>
                      {fileRef}
                    </span>
                  )}
                  <span style={{
                    fontSize: 8,
                    fontWeight: 700,
                    color,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    fontFamily: '"Space Mono", monospace',
                  }}>
                    {sev}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)', lineHeight: 1.5 }}>
                  {ann.comment ?? ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Skills matrix (horizontal skill bars) ────────────────────────────────────

function SkillsMatrix({ skillProfile, color }: {
  skillProfile: AgenticFeedback['skillProfile'];
  color: string;
}): JSX.Element {
  const skills = [
    { key: 'bugIdentification' as const, label: 'Bug Identification' },
    { key: 'severityJudgment'  as const, label: 'Severity Judgment'  },
    { key: 'analyticalWriting' as const, label: 'Analytical Writing' },
    { key: 'technicalDepth'    as const, label: 'Technical Depth'    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {skills.map(({ key, label }) => {
        const value = skillProfile[key];
        return (
          <div key={key}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
            }}>
              <span style={{
                fontSize: 10,
                color: 'var(--pipe-text-muted)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.05em',
              }}>
                {label.toUpperCase()}
              </span>
              <span style={{
                fontSize: 12,
                fontWeight: 700,
                color,
                fontFamily: '"Space Mono", monospace',
              }}>
                {value}
              </span>
            </div>
            <div style={{
              height: 5,
              background: 'var(--pipe-surface)',
              borderRadius: 3,
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${value}%`,
                background: color,
                borderRadius: 3,
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Challenge deep-dive cards ────────────────────────────────────────────────

function CodeReviewDeepDive({
  challenge,
  assessment,
  agenticFeedback,
}: {
  challenge: ChallengeRow;
  assessment: AssessmentRow;
  agenticFeedback: AgenticFeedback | null;
}): JSX.Element {
  const submission = parseSubmission(assessment.submission);
  const annotations = extractAnnotations(submission);
  const verdict = typeof submission?.['verdict'] === 'string' ? submission['verdict'] : null;
  const summary  = typeof submission?.['summary'] === 'string' ? submission['summary'] : null;
  const signal = calculateSignal(assessment.score ?? null);
  const color = getSignalColor(signal).text;

  const prUrl = challenge.githubRepoUrl && challenge.githubPrNumber
    ? `${challenge.githubRepoUrl}/pull/${challenge.githubPrNumber}`
    : null;

  return (
    <div>
      {/* View PR link */}
      {prUrl && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'rgba(96,165,250,0.08)',
              border: '1px solid rgba(96,165,250,0.25)',
              borderRadius: 3,
              color: '#60a5fa',
              fontSize: 9,
              fontWeight: 700,
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.1em',
              textDecoration: 'none',
            }}
          >
            VIEW CODE REVIEW ↗
          </a>
        </div>
      )}

      {/* Verdict + summary */}
      {(verdict || summary) && (
        <div style={{
          padding: '16px 20px',
          background: 'rgba(255,255,255,0.025)',
          borderRadius: 4,
          marginBottom: 24,
        }}>
          {verdict && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: summary ? 10 : 0 }}>
              <span style={{
                fontSize: 8,
                letterSpacing: '0.15em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
              }}>VERDICT</span>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--pipe-text, #fff)',
                textTransform: 'uppercase',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.1em',
              }}>
                {verdict.replace(/_/g, ' ')}
              </span>
            </div>
          )}
          {summary && (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.7 }}>
              {summary}
            </div>
          )}
        </div>
      )}

      {/* Skill radar + skills matrix side by side */}
      {agenticFeedback?.skillProfile && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '240px 1fr',
          gap: 32,
          marginBottom: 24,
          alignItems: 'start',
        }}>
          <div>
            <SectionLabel text="SKILL_RADAR" />
            <SkillRadarChart skillProfile={agenticFeedback.skillProfile} color={color} />
          </div>
          <div>
            <SectionLabel text="DIMENSION_SCORES" />
            <SkillsMatrix skillProfile={agenticFeedback.skillProfile} color={color} />
          </div>
        </div>
      )}

      {/* Annotation breakdown */}
      <div style={{ marginBottom: 24 }}>
        <AnnotationBreakdown annotations={annotations} />
      </div>

      {/* Follow-up Q&A */}
      <FollowUpTranscript raw={assessment.followUpQuestionsJson} />
    </div>
  );
}

function QuizMcqDeepDive({
  challenge,
  assessment,
}: {
  challenge: ChallengeRow;
  assessment: AssessmentRow;
}): JSX.Element {
  const config = parseSubmission(challenge.config) ?? {};
  const submission = parseSubmission(assessment.submission) ?? {};
  const options = Array.isArray(config['options'])
    ? (config['options'] as Array<{ id: string; text?: string; label?: string }>)
    : [];
  const answers = submission['answers'] as Record<string, string> | undefined;
  const selectedId = answers?.['current'] ?? (submission['selectedOptionId'] as string | undefined);
  const correctId = config['correctOptionId'] as string | undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.map(opt => {
        const isSelected = opt.id === selectedId;
        const isCorrect  = opt.id === correctId;
        const borderColor = isSelected
          ? (isCorrect ? '#10b981' : '#f87171')
          : 'rgba(255,255,255,0.06)';
        return (
          <div key={opt.id} style={{
            padding: '12px 16px',
            background: isSelected ? 'rgba(255,255,255,0.04)' : 'transparent',
            border: `1px solid ${borderColor}`,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, color: isSelected ? '#fff' : 'rgba(255,255,255,0.4)' }}>
              {opt.text ?? opt.label ?? opt.id}
            </span>
            {isSelected && (
              <span style={{
                fontSize: 8,
                fontWeight: 700,
                color: isCorrect ? '#10b981' : '#f87171',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.1em',
              }}>
                {isCorrect ? 'CORRECT' : 'INCORRECT'}
              </span>
            )}
            {!isSelected && isCorrect && (
              <span style={{
                fontSize: 8,
                fontWeight: 700,
                color: '#10b981',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.1em',
              }}>
                CORRECT_ANSWER
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuizShortAnswerDeepDive({ assessment }: { assessment: AssessmentRow }): JSX.Element {
  const submission = parseSubmission(assessment.submission);
  const text = typeof submission?.['text'] === 'string' ? submission['text'] : null;

  return (
    <div>
      {text ? (
        <div style={{
          padding: '16px 20px',
          background: 'rgba(255,255,255,0.025)',
          borderRadius: 4,
          fontSize: 13,
          color: 'var(--pipe-text, #fff)',
          lineHeight: 1.75,
          whiteSpace: 'pre-wrap',
        }}>
          {text}
        </div>
      ) : (
        <div style={{
          fontSize: 11,
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
          fontStyle: 'italic',
        }}>
          NO_RESPONSE_TEXT
        </div>
      )}
      {assessment.feedback && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            fontSize: 8,
            letterSpacing: '0.15em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 6,
          }}>
            RECRUITER_NOTES
          </div>
          <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
            {assessment.feedback}
          </div>
        </div>
      )}
    </div>
  );
}

function CodeImplDeepDive({ assessment }: { assessment: AssessmentRow }): JSX.Element {
  const submission = parseSubmission(assessment.submission);
  const code = typeof submission?.['code'] === 'string' ? submission['code'] : null;

  return (
    <div>
      {code ? (
        <div style={{
          background: 'rgba(0,0,0,0.4)',
          borderRadius: 4,
          padding: '16px 20px',
          overflow: 'auto',
          maxHeight: 400,
          border: '1px solid var(--pipe-border)',
        }}>
          <pre style={{
            margin: 0,
            fontSize: 12,
            color: 'rgba(255,255,255,0.85)',
            fontFamily: '"Space Mono", monospace',
            lineHeight: 1.6,
            whiteSpace: 'pre',
          }}>
            {code}
          </pre>
        </div>
      ) : (
        <div style={{
          fontSize: 11,
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
          fontStyle: 'italic',
        }}>
          NO_CODE_SUBMITTED
        </div>
      )}
      {assessment.feedback && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            fontSize: 8,
            letterSpacing: '0.15em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 6,
          }}>
            RECRUITER_NOTES
          </div>
          <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
            {assessment.feedback}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stage performance chart ──────────────────────────────────────────────────

function StagePerformanceChart({
  stages,
  stageStats,
  assessments,
}: {
  stages: StageRow[];
  stageStats: StageStatRow[];
  assessments: AssessmentRow[];
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {stages.map(stage => {
        const stat = stageStats.find(s => s.id === stage.id);
        const score = stat?.score ?? null;
        const signal = calculateSignal(score);
        const color = getSignalColor(signal).text;
        const challenges = stage.challenges ?? [];

        return (
          <div key={stage.id}>
            {/* Stage label + score */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}>
              <span style={{
                fontSize: 10,
                color: 'var(--pipe-text-muted)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                {stage.title ?? 'STAGE'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {score !== null && (
                  <span style={{
                    fontSize: 8,
                    fontWeight: 700,
                    color,
                    fontFamily: '"Space Mono", monospace',
                    padding: '2px 6px',
                    background: `${color}15`,
                    border: `1px solid ${color}30`,
                    borderRadius: 3,
                    letterSpacing: '0.08em',
                  }}>
                    {signal}
                  </span>
                )}
                <span style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: score !== null ? color : 'rgba(255,255,255,0.2)',
                  fontFamily: '"Space Mono", monospace',
                }}>
                  {score ?? '—'}
                </span>
              </div>
            </div>

            {/* Bar */}
            <div style={{
              height: 8,
              background: 'var(--pipe-surface)',
              borderRadius: 4,
              overflow: 'hidden',
              marginBottom: 10,
            }}>
              <div style={{
                height: '100%',
                width: `${score ?? 0}%`,
                background: score !== null ? color : 'transparent',
                borderRadius: 4,
                transition: 'width 0.5s ease',
              }} />
            </div>

            {/* Challenge score chips */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {challenges.map(challenge => {
                const assessment = assessments.find(a => a.challengeId === challenge.id);
                const cScore = assessment?.score ?? null;
                const cType = challenge.type ?? '';
                const typeColor = CHALLENGE_TYPE_COLORS[cType] ?? 'rgba(255,255,255,0.3)';
                return (
                  <div key={challenge.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 8px',
                    background: `${typeColor}10`,
                    border: `1px solid ${typeColor}30`,
                    borderRadius: 3,
                  }}>
                    <span style={{
                      fontSize: 8,
                      color: typeColor,
                      fontFamily: '"Space Mono", monospace',
                      letterSpacing: '0.05em',
                    }}>
                      {challenge.title ?? cType}
                    </span>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: cScore !== null ? '#fff' : 'rgba(255,255,255,0.2)',
                      fontFamily: '"Space Mono", monospace',
                    }}>
                      {cScore ?? '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function IntelligenceReport({
  candidate,
  assessments,
  stages,
  stageStats,
  avgScore,
  signal,
  signalColors,
}: IntelligenceReportProps): JSX.Element {
  // Find the first CODE_REVIEW assessment with structured agentic feedback
  // to use for the top-level executive summary and skills matrix.
  const codeReviewAssessments = assessments.filter(a => {
    const challenge = stages
      .flatMap(s => s.challenges ?? [])
      .find(c => c.id === a.challengeId);
    return challenge?.type === 'CODE_REVIEW';
  });

  const primaryAgenticFeedback = codeReviewAssessments
    .map(a => parseAgenticFeedback(a.feedback))
    .find(f => f !== null) ?? null;

  // Fallback plain-text feedback (for non-agentic assessments)
  const anyFeedbackText = assessments
    .map(a => {
      if (!a.feedback) return null;
      const parsed = parseAgenticFeedback(a.feedback);
      if (parsed) return parsed.summary;
      return a.feedback;
    })
    .find(f => f !== null) ?? null;

  const narrativeSummary = primaryAgenticFeedback?.summary ?? anyFeedbackText;

  const generatedAt = assessments
    .map(a => a.completedAt)
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontSize: 8,
            letterSpacing: '0.25em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 4,
          }}>
            INTELLIGENCE_REPORT
          </div>
          <div style={{
            fontSize: 10,
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
          }}>
            {candidate.name ?? candidate.email ?? 'Candidate'}
          </div>
        </div>
        {generatedAt && (
          <div style={{
            fontSize: 9,
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
          }}>
            {new Date(generatedAt).toLocaleDateString()}
          </div>
        )}
      </div>

      {/* ── Executive Summary ─────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--pipe-surface)',
        border: '1px solid var(--pipe-border)',
        borderRadius: 6,
        padding: 32,
      }}>
        <SectionLabel text="EXECUTIVE_SUMMARY" />
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr',
          gap: 32,
          alignItems: 'start',
        }}>
          {/* Score gauge */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <ScoreGauge score={avgScore ?? 0} signal={signal} />
          </div>

          {/* Narrative + strengths/concerns */}
          <div>
            {narrativeSummary ? (
              <p style={{
                fontSize: 14,
                color: 'rgba(255,255,255,0.75)',
                lineHeight: 1.8,
                margin: '0 0 20px 0',
              }}>
                {narrativeSummary}
              </p>
            ) : (
              <p style={{
                fontSize: 13,
                color: 'var(--pipe-text-dim)',
                lineHeight: 1.7,
                fontStyle: 'italic',
                margin: '0 0 20px 0',
                fontFamily: '"Space Mono", monospace',
              }}>
                AI narrative available after agentic CODE_REVIEW scoring completes.
              </p>
            )}

            {/* Strengths */}
            {(primaryAgenticFeedback?.strengths ?? []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  fontSize: 8,
                  letterSpacing: '0.15em',
                  color: '#10b981',
                  fontFamily: '"Space Mono", monospace',
                  marginBottom: 8,
                }}>
                  STRENGTHS
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {primaryAgenticFeedback!.strengths.map((s, i) => (
                    <span key={i} style={{
                      fontSize: 10,
                      padding: '4px 10px',
                      background: 'rgba(16,185,129,0.08)',
                      border: '1px solid rgba(16,185,129,0.25)',
                      borderRadius: 3,
                      color: '#10b981',
                      fontFamily: '"Space Mono", monospace',
                    }}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Concerns */}
            {(primaryAgenticFeedback?.concerns ?? []).length > 0 && (
              <div>
                <div style={{
                  fontSize: 8,
                  letterSpacing: '0.15em',
                  color: '#f87171',
                  fontFamily: '"Space Mono", monospace',
                  marginBottom: 8,
                }}>
                  CONCERNS
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {primaryAgenticFeedback!.concerns.map((c, i) => (
                    <span key={i} style={{
                      fontSize: 10,
                      padding: '4px 10px',
                      background: 'rgba(248,113,113,0.08)',
                      border: '1px solid rgba(248,113,113,0.25)',
                      borderRadius: 3,
                      color: '#f87171',
                      fontFamily: '"Space Mono", monospace',
                    }}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Stage Performance ─────────────────────────────────────────────── */}
      {stages.length > 0 && (
        <div style={{
          background: 'var(--pipe-surface)',
          border: '1px solid var(--pipe-border)',
          borderRadius: 6,
          padding: 32,
        }}>
          <SectionLabel text="STAGE_PERFORMANCE" />
          <StagePerformanceChart
            stages={stages}
            stageStats={stageStats}
            assessments={assessments}
          />
        </div>
      )}

      {/* ── Skills Matrix (CODE_REVIEW only) ──────────────────────────────── */}
      {primaryAgenticFeedback?.skillProfile && (
        <div style={{
          background: 'var(--pipe-surface)',
          border: '1px solid var(--pipe-border)',
          borderRadius: 6,
          padding: 32,
        }}>
          <SectionLabel text="SKILLS_MATRIX" />
          <SkillsMatrix
            skillProfile={primaryAgenticFeedback.skillProfile}
            color={signalColors.text}
          />
        </div>
      )}

      {/* ── Challenge Deep Dives ──────────────────────────────────────────── */}
      <div>
        <SectionLabel text="CHALLENGE_DEEP_DIVES" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {stages.map(stage => {
            const challenges = stage.challenges ?? [];
            if (challenges.length === 0) return null;
            return (
              <div key={stage.id}>
                {/* Stage divider label */}
                <div style={{
                  fontSize: 8,
                  letterSpacing: '0.2em',
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  textTransform: 'uppercase',
                }}>
                  {stage.title ?? 'Stage'}
                </div>

                {challenges.map(challenge => {
                  const assessment = assessments.find(a => a.challengeId === challenge.id);
                  const cType = challenge.type ?? '';
                  const typeColor = CHALLENGE_TYPE_COLORS[cType] ?? 'rgba(255,255,255,0.3)';
                  const agenticFeedback = parseAgenticFeedback(assessment?.feedback);
                  const score = assessment?.score ?? null;
                  const challengeSignal = calculateSignal(score);
                  const challengeSignalColor = getSignalColor(challengeSignal).text;

                  return (
                    <div key={challenge.id} style={{
                      background: 'rgba(255,255,255,0.015)',
                      border: '1px solid var(--pipe-border-light)',
                      borderRadius: 6,
                      padding: 28,
                    }}>
                      {/* Challenge header */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        marginBottom: 24,
                        gap: 16,
                      }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{
                              fontSize: 8,
                              fontWeight: 700,
                              padding: '2px 7px',
                              background: `${typeColor}14`,
                              border: `1px solid ${typeColor}40`,
                              borderRadius: 3,
                              color: typeColor,
                              fontFamily: '"Space Mono", monospace',
                              letterSpacing: '0.08em',
                            }}>
                              {cType}
                            </span>
                          </div>
                          <h4 style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: 'var(--pipe-text, #fff)',
                            margin: 0,
                            lineHeight: 1.3,
                          }}>
                            {challenge.title ?? 'Untitled Challenge'}
                          </h4>
                        </div>

                        {/* Score chip */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{
                            fontSize: 32,
                            fontWeight: 900,
                            color: score !== null ? challengeSignalColor : 'rgba(255,255,255,0.15)',
                            lineHeight: 1,
                            letterSpacing: '-0.02em',
                            fontFamily: '"Space Mono", monospace',
                          }}>
                            {score ?? '—'}
                          </div>
                          <div style={{
                            fontSize: 7,
                            letterSpacing: '0.12em',
                            color: 'var(--pipe-text-dim)',
                            fontFamily: '"Space Mono", monospace',
                            marginTop: 3,
                          }}>
                            SCORE
                          </div>
                        </div>
                      </div>

                      {/* No submission */}
                      {!assessment && (
                        <div style={{
                          padding: 20,
                          border: '1px dashed rgba(255,255,255,0.06)',
                          textAlign: 'center',
                          color: 'var(--pipe-text-dim)',
                          fontSize: 11,
                          fontFamily: '"Space Mono", monospace',
                          letterSpacing: '0.1em',
                        }}>
                          NO_SUBMISSION_YET
                        </div>
                      )}

                      {/* Challenge-type content */}
                      {assessment && cType === 'CODE_REVIEW' && (
                        <CodeReviewDeepDive
                          challenge={challenge}
                          assessment={assessment}
                          agenticFeedback={agenticFeedback}
                        />
                      )}
                      {assessment && cType === 'QUIZ_MCQ' && (
                        <QuizMcqDeepDive challenge={challenge} assessment={assessment} />
                      )}
                      {assessment && cType === 'QUIZ_SHORT_ANSWER' && (
                        <QuizShortAnswerDeepDive assessment={assessment} />
                      )}
                      {assessment && cType === 'CODE_IMPLEMENTATION' && (
                        <CodeImplDeepDive assessment={assessment} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
