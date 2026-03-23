import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Calendar, FileDown, CheckCircle } from "lucide-react";
import { resolveSchedulingProvider, ALL_PROVIDERS } from '../components/Scheduling/provider';
import { InterviewStatusBadge } from '../components/Scheduling/InterviewStatusBadge';
import type { InterviewStatus } from '../lib/scheduling/types';
import { LiquidMetalCard } from "../components";
import { generateClient } from 'aws-amplify/data';
import type { Schema } from "../../amplify/data/resource";
import { calculateSignal } from "../lib/utils";
import { FEATURES } from "../lib/features";
import { IntelligenceReport } from "../components/Analytics/IntelligenceReport";

const client = generateClient<Schema>();

// ============================================================================
// Local types
// ============================================================================

interface ChallengeRow {
  id: string;
  type?: string | null;
  title?: string | null;
  config?: unknown;
  instructions?: string | null;
}

interface StageRow {
  id: string;
  title?: string | null;
  order?: number | null;
  mode?: string | null;
  challenges?: ChallengeRow[] | null;
}

interface ScheduledInterviewRow {
  id: string;
  stageId?: string | null;
  status?: string | null;
  schedulingUrl?: string | null;
  meetingUrl?: string | null;
  scheduledAt?: string | null;
}

interface FollowUpAnswer {
  questionId: string;
  answer: string;
  answeredAt?: string;
}

interface FollowUpQuestionRecord {
  id: string;
  type: string;
  question: string;
  context?: string;
}

interface ParsedFollowUpJson {
  questions?: FollowUpQuestionRecord[];
  answers?: FollowUpAnswer[];
}

/** Partial assessment row returned from selectionSet query */
interface AssessmentRow {
  id: string;
  challengeId?: string | null;
  score?: number | null;
  submission?: unknown;
  feedback?: string | null;
  completedAt?: string | null;
  followUpQuestionsJson?: string | number | boolean | object | unknown[] | null;
}

// ============================================================================
// Signal colour helpers
// ============================================================================

const SIGNAL_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  STRONG: { text: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' },
  YES:    { text: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.3)' },
  MAYBE:  { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)' },
  NO:     { text: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)' },
};

/** Type-safe signal colour lookup — always returns a valid colour object */
function getSignalColors(signal: string): { text: string; bg: string; border: string } {
  return SIGNAL_COLORS[signal] ?? { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)' };
}

const CHALLENGE_TYPE_COLORS: Record<string, string> = {
  CODE_REVIEW:       '#60a5fa',
  CODE_IMPLEMENTATION: '#a78bfa',
  QUIZ_MCQ:          '#4ade80',
  QUIZ_SHORT_ANSWER: '#fbbf24',
};

// ============================================================================
// Sub-components
// ============================================================================

function SignalBadge({ signal }: { signal: string }): JSX.Element {
  const colors = getSignalColors(signal);
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 10px',
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 3,
      fontSize: 10,
      fontWeight: 700,
      color: colors.text,
      letterSpacing: '0.1em',
      fontFamily: '"Space Mono", monospace',
    }}>
      {signal}
    </span>
  );
}

function TypeBadge({ type }: { type: string }): JSX.Element {
  const color = CHALLENGE_TYPE_COLORS[type] ?? 'rgba(255,255,255,0.3)';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      background: `${color}14`,
      border: `1px solid ${color}40`,
      borderRadius: 3,
      fontSize: 9,
      fontWeight: 700,
      color,
      letterSpacing: '0.08em',
      fontFamily: '"Space Mono", monospace',
    }}>
      {type}
    </span>
  );
}

// ============================================================================
// Skill radar (mini version for OVERVIEW tab)
// ============================================================================

interface SkillProfileShape {
  bugIdentification: number;
  severityJudgment: number;
  analyticalWriting: number;
  technicalDepth: number;
}

const RADAR_DIMS: Array<{ key: keyof SkillProfileShape; angleDeg: number; label: string }> = [
  { key: 'bugIdentification',  angleDeg: -90, label: 'BUG_ID'   },
  { key: 'severityJudgment',   angleDeg:   0, label: 'SEVERITY' },
  { key: 'analyticalWriting',  angleDeg:  90, label: 'WRITING'  },
  { key: 'technicalDepth',     angleDeg: 180, label: 'DEPTH'    },
];

function MiniRadar({ skillProfile, color }: { skillProfile: SkillProfileShape; color: string }): JSX.Element {
  const cx = 110, cy = 110, maxR = 72;

  function toXY(value: number, angleDeg: number): { x: number; y: number } {
    const r = (value / 100) * maxR;
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const dataPoints = RADAR_DIMS.map(d => toXY(skillProfile[d.key], d.angleDeg));
  const dataPolygon = dataPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <div style={{ textAlign: 'center', flexShrink: 0 }}>
      <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.25)', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>
        SKILL_RADAR
      </div>
      <svg width="180" height="180" viewBox="0 0 220 220">
        {gridLevels.map(level => {
          const pts = RADAR_DIMS.map(d => {
            const r = level * maxR;
            const rad = (d.angleDeg * Math.PI) / 180;
            return `${(cx + r * Math.cos(rad)).toFixed(1)},${(cy + r * Math.sin(rad)).toFixed(1)}`;
          }).join(' ');
          return <polygon key={level} points={pts} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />;
        })}
        {RADAR_DIMS.map(d => {
          const rad = (d.angleDeg * Math.PI) / 180;
          return (
            <line
              key={d.key}
              x1={cx} y1={cy}
              x2={(cx + maxR * Math.cos(rad)).toFixed(1)}
              y2={(cy + maxR * Math.sin(rad)).toFixed(1)}
              stroke="rgba(255,255,255,0.08)" strokeWidth="1"
            />
          );
        })}
        <polygon points={dataPolygon} fill={`${color}28`} stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        {dataPoints.map((pt, i) => (
          <circle key={i} cx={pt.x.toFixed(1)} cy={pt.y.toFixed(1)} r="3" fill={color} />
        ))}
        {RADAR_DIMS.map(d => {
          const rad = (d.angleDeg * Math.PI) / 180;
          const lx = cx + (maxR + 20) * Math.cos(rad);
          const ly = cy + (maxR + 20) * Math.sin(rad);
          const anchor = d.angleDeg === 0 ? 'start' : d.angleDeg === 180 ? 'end' : 'middle';
          return (
            <g key={d.key}>
              <text x={lx.toFixed(1)} y={(ly - 4).toFixed(1)} textAnchor={anchor} fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="Space Mono, monospace" letterSpacing="0.08em">
                {d.label}
              </text>
              <text x={lx.toFixed(1)} y={(ly + 8).toFixed(1)} textAnchor={anchor} fill={color} fontSize="9" fontFamily="Space Mono, monospace" fontWeight="700">
                {skillProfile[d.key]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ============================================================================
// Follow-up Q&A read-only panel
// ============================================================================

function FollowUpReadOnly({ followUpQuestionsJson }: { followUpQuestionsJson?: string | number | boolean | object | unknown[] | null }): JSX.Element | null {
  if (!followUpQuestionsJson) return null;

  let parsed: ParsedFollowUpJson;
  try {
    parsed = (typeof followUpQuestionsJson === 'string'
      ? JSON.parse(followUpQuestionsJson)
      : followUpQuestionsJson) as ParsedFollowUpJson;
  } catch {
    return null;
  }

  const questions = parsed.questions ?? [];
  const answers = parsed.answers ?? [];

  if (questions.length === 0 && answers.length === 0) return null;

  return (
    <div style={{ marginTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 24 }}>
      <div style={{
        fontSize: 9,
        letterSpacing: '0.18em',
        color: 'rgba(255,255,255,0.3)',
        fontFamily: '"Space Mono", monospace',
        marginBottom: 16,
      }}>
        FOLLOW_UP_QUESTIONS
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {questions.map((q, idx) => {
          const answerRecord = answers.find(a => a.questionId === q.id);
          return (
            <div key={q.id}>
              <div style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.6)',
                marginBottom: 8,
                lineHeight: 1.5,
              }}>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', fontSize: 9, marginRight: 8 }}>
                  Q{idx + 1}
                </span>
                {q.question}
              </div>
              {answerRecord?.answer ? (
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.03)',
                  borderLeft: '2px solid rgba(255,255,255,0.1)',
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.8)',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}>
                  {answerRecord.answer}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: '"Space Mono", monospace', fontStyle: 'italic' }}>
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

// ============================================================================
// Quiz MCQ view helper
// ============================================================================

function QuizMcqView({ challenge, submission }: {
  challenge: ChallengeRow;
  submission: Record<string, unknown> | null;
}): JSX.Element {
  const config = (typeof challenge.config === 'string'
    ? (JSON.parse(challenge.config) as Record<string, unknown>)
    : ((challenge.config ?? {}) as Record<string, unknown>));
  const options = Array.isArray(config.options)
    ? (config.options as Array<{ id: string; text?: string; label?: string }>)
    : [];
  const answers = submission?.answers as Record<string, string> | undefined;
  const selectedId = answers?.['current'] ?? (submission?.selectedOptionId as string | undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 14, color: '#fff', fontWeight: 500, lineHeight: 1.5 }}>
        {(config.question as string | undefined) ?? 'Question text missing'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((opt) => {
          const isSelected = selectedId === opt.id;
          const isCorrect = (config.correctOptionId as string | undefined) === opt.id ||
                            (config.correct as string | undefined) === opt.id;
          return (
            <div
              key={opt.id}
              style={{
                padding: '12px 16px',
                background: isSelected ? 'rgba(255,255,255,0.05)' : 'transparent',
                border: `1px solid ${isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}`,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ fontSize: 13, color: isSelected ? '#fff' : 'rgba(255,255,255,0.5)' }}>
                {opt.text ?? opt.label ?? opt.id}
              </div>
              {isSelected && (
                <span style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: isCorrect ? '#10b981' : '#f87171',
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.08em',
                }}>
                  {isCorrect ? 'CORRECT' : 'INCORRECT'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Challenge card
// ============================================================================

function ChallengeCard({
  challenge,
  assessment,
  onScoreChange,
  onFeedbackChange,
}: {
  challenge: ChallengeRow;
  assessment: AssessmentRow | undefined;
  onScoreChange: (assessmentId: string, score: number) => void;
  onFeedbackChange: (assessmentId: string, feedback: string) => void;
}): JSX.Element {
  const isManual = challenge.type === 'QUIZ_SHORT_ANSWER' || challenge.type === 'CODE_IMPLEMENTATION';
  const submission = assessment?.submission
    ? (typeof assessment.submission === 'string'
        ? (JSON.parse(assessment.submission) as Record<string, unknown>)
        : (assessment.submission as Record<string, unknown>))
    : null;

  return (
    <LiquidMetalCard variant="dark" style={{ padding: 32 }}>
      {/* Card header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 24,
        gap: 16,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            {challenge.type && <TypeBadge type={challenge.type} />}
            {isManual && (
              <span style={{
                fontSize: 8,
                padding: '2px 6px',
                background: 'rgba(167,139,250,0.08)',
                border: '1px solid rgba(167,139,250,0.2)',
                color: '#a78bfa',
                borderRadius: 3,
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.08em',
              }}>
                MANUAL_REVIEW
              </span>
            )}
          </div>
          <h4 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.3 }}>
            {challenge.title ?? 'Untitled Challenge'}
          </h4>
        </div>
        {assessment && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontSize: 28,
              fontWeight: 800,
              color: isManual && assessment.score === 0 ? 'rgba(255,255,255,0.15)' : '#fff',
              lineHeight: 1,
              letterSpacing: '-0.02em',
            }}>
              {assessment.score}
            </div>
            <div style={{
              fontSize: 8,
              letterSpacing: '0.1em',
              color: 'rgba(255,255,255,0.3)',
              marginTop: 4,
              fontFamily: '"Space Mono", monospace',
            }}>
              SCORE
            </div>
          </div>
        )}
      </div>

      {/* No submission */}
      {!assessment && (
        <div style={{
          padding: 24,
          border: '1px dashed rgba(255,255,255,0.06)',
          textAlign: 'center',
          color: 'rgba(255,255,255,0.2)',
          fontSize: 11,
          fontFamily: '"Space Mono", monospace',
          letterSpacing: '0.1em',
        }}>
          NO_SUBMISSION_YET
        </div>
      )}

      {/* Submission content */}
      {assessment && submission && (
        <div style={{ display: 'grid', gridTemplateColumns: isManual ? '1fr 280px' : '1fr', gap: 32 }}>
          {/* Left: submission view */}
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 4, minWidth: 0 }}>

            {/* CODE_REVIEW */}
            {challenge.type === 'CODE_REVIEW' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Verdict + summary */}
                {(Boolean(submission.verdict) || Boolean(submission.summary)) && (
                  <div style={{ marginBottom: 16 }}>
                    {Boolean(submission.verdict) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 9, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace' }}>VERDICT</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase', fontFamily: '"Space Mono", monospace' }}>
                          {String(submission.verdict)}
                        </span>
                      </div>
                    )}
                    {Boolean(submission.summary) && (
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
                        {String(submission.summary)}
                      </div>
                    )}
                  </div>
                )}
                {/* Annotations */}
                <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
                  CANDIDATE_ANNOTATIONS
                </div>
                {Array.isArray(submission.annotations) && (submission.annotations as unknown[]).length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(submission.annotations as Array<Record<string, unknown>>).map((ann, idx) => {
                      const sev = (ann.severity as string) ?? 'minor';
                      const borderColor = sev === 'critical' ? '#ef4444' : sev === 'major' ? '#f59e0b' : '#60a5fa';
                      return (
                        <div key={idx} style={{
                          padding: '12px 16px',
                          background: 'rgba(255,255,255,0.03)',
                          borderLeft: `2px solid ${borderColor}`,
                          borderRadius: '0 3px 3px 0',
                        }}>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
                            {Boolean(ann.file) && (
                              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace' }}>
                                {String(ann.file).split('/').pop() ?? ''}:{String(ann.line ?? '')}
                              </span>
                            )}
                            <span style={{
                              fontSize: 8,
                              fontWeight: 700,
                              color: borderColor,
                              textTransform: 'uppercase',
                              letterSpacing: '0.1em',
                              fontFamily: '"Space Mono", monospace',
                            }}>
                              {sev}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
                            {String(ann.comment ?? '')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic', fontFamily: '"Space Mono", monospace' }}>
                    No annotations provided.
                  </div>
                )}
                {/* Follow-up Q&A */}
                <FollowUpReadOnly followUpQuestionsJson={assessment.followUpQuestionsJson ?? null} />
              </div>
            )}

            {/* QUIZ_MCQ */}
            {challenge.type === 'QUIZ_MCQ' && <QuizMcqView challenge={challenge} submission={submission} />}

            {/* QUIZ_SHORT_ANSWER */}
            {challenge.type === 'QUIZ_SHORT_ANSWER' && (
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {(submission.text as string) || <span style={{ color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>No answer provided.</span>}
              </div>
            )}

            {/* CODE_IMPLEMENTATION */}
            {challenge.type === 'CODE_IMPLEMENTATION' && (
              <div style={{ background: '#000', padding: 20, borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)' }}>
                <pre style={{ margin: 0, fontSize: 12, color: '#a78bfa', fontFamily: '"Space Mono", monospace', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {(submission.code as string) || '// No code submitted'}
                </pre>
              </div>
            )}
          </div>

          {/* Right: manual review panel */}
          {isManual && (
            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: 32 }}>
              <div style={{
                fontSize: 9,
                letterSpacing: '0.18em',
                color: 'rgba(255,255,255,0.3)',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 24,
              }}>
                RECRUITER_REVIEW
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <label style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>SCORE</label>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: '"Space Mono", monospace' }}>{assessment.score}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={assessment.score ?? 0}
                    onChange={async (e) => {
                      const newScore = parseInt(e.target.value, 10);
                      onScoreChange(assessment.id, newScore);
                      await client.models.Assessment.update({ id: assessment.id, score: newScore });
                    }}
                    style={{ width: '100%', cursor: 'pointer', accentColor: '#a78bfa' }}
                  />
                </div>
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: 9,
                    color: 'rgba(255,255,255,0.3)',
                    marginBottom: 12,
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: '0.1em',
                  }}>
                    FEEDBACK
                  </label>
                  <textarea
                    value={assessment.feedback ?? ''}
                    onChange={async (e) => {
                      const newVal = e.target.value;
                      onFeedbackChange(assessment.id, newVal);
                      await client.models.Assessment.update({ id: assessment.id, feedback: newVal });
                    }}
                    placeholder="Add internal notes..."
                    style={{
                      width: '100%',
                      height: 120,
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      padding: 12,
                      color: '#fff',
                      fontSize: 12,
                      fontFamily: '"Space Mono", monospace',
                      outline: 'none',
                      resize: 'none',
                      borderRadius: 3,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </LiquidMetalCard>
  );
}

// ============================================================================
// Main component
// ============================================================================

/**
 * CandidateProfilePage — Recruiter view of a candidate's assessment results.
 *
 * Layout:
 *   Header: CANDIDATE_PROFILE · [email] · [pipeline] · GENERATE_REPORT (stub)
 *   Tabs: OVERVIEW | STAGE_1 | STAGE_2 | ...
 *   OVERVIEW: overall score/signal + stage score cards + candidate info
 *   Per-stage: challenge cards with type-specific content + follow-up Q&A
 */
export default function CandidateProfilePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<Schema['Candidate']['type'] | null>(null);
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedTab, setSelectedTab] = useState<'OVERVIEW' | 'INTELLIGENCE' | string>('OVERVIEW');
  const [scheduledInterview, setScheduledInterview] = useState<ScheduledInterviewRow | null>(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteSaving, setInviteSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      setError(null);

      const { data: cand } = await client.models.Candidate.get({ id });
      if (!cand) return;
      setCandidate(cand);

      // Note: Assessment.list filter type is too deeply recursive for TS strict mode (TS2589).
      // Fetch all and filter client-side — assessment counts per candidate are small.
      const [allAssessments, stagesData] = await Promise.all([
        client.models.Assessment.list(),
        client.models.Stage.list({
          filter: { pipelineId: { eq: cand.pipelineId } },
          selectionSet: ['id', 'title', 'order', 'mode', 'challenges.*'],
        }),
      ]);
      const assData = { data: allAssessments.data.filter(a => a.candidateId === id) };

      setAssessments(assData.data);

      const sortedStages: StageRow[] = stagesData.data
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setStages(sortedStages);

      // Load ScheduledInterview for the LIVE_VIDEO stage
      const liveStage = sortedStages.find((s) => s.mode === 'LIVE_VIDEO');
      if (liveStage) {
        try {
          const { data: siList } = await client.models.ScheduledInterview.list({
            filter: { candidateId: { eq: id } },
          });
          const si = siList.find((s) => s.stageId === liveStage.id) ?? null;
          setScheduledInterview(si as ScheduledInterviewRow | null);
          if (si?.schedulingUrl) setInviteUrl(si.schedulingUrl);
        } catch {
          // ScheduledInterview not yet deployed — ignore
        }
      }
    } catch (err) {
      console.error('[CandidateProfilePage] Error fetching data:', err);
      setError(err instanceof Error ? err : new Error('Failed to load candidate profile'));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Optimistic score/feedback updates
  const handleScoreChange = (assessmentId: string, score: number): void => {
    setAssessments(prev => prev.map(a => a.id === assessmentId ? { ...a, score } : a));
  };

  const handleFeedbackChange = (assessmentId: string, feedback: string): void => {
    setAssessments(prev => prev.map(a => a.id === assessmentId ? { ...a, feedback } : a));
  };


  const handleSendInvite = async (): Promise<void> => {
    if (!id || !candidate || !inviteUrl) return;
    const liveStage = stages.find((s) => s.mode === 'LIVE_VIDEO');
    if (!liveStage) return;
    setInviteSaving(true);
    try {
      const provider = resolveSchedulingProvider(inviteUrl, ALL_PROVIDERS);
      const { data, errors } = await client.models.ScheduledInterview.create({
        candidateId: id,
        pipelineId: candidate.pipelineId,
        stageId: liveStage.id,
        status: 'INVITED',
        schedulingUrl: inviteUrl,
        schedulingProvider: provider.type,
      });
      if (errors) throw new Error(errors[0]?.message ?? 'Unknown error');
      setScheduledInterview(data as ScheduledInterviewRow);
    } catch (err) {
      console.error('[CandidateProfilePage] Failed to send invite:', err);
    } finally {
      setInviteSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div style={{ padding: '40px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ flex: 1, height: 80, background: 'rgba(255,255,255,0.02)', borderRadius: 4 }} />
            ))}
          </div>
          <div style={{ height: 200, background: 'rgba(255,255,255,0.02)', borderRadius: 4 }} />
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (error) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LiquidMetalCard variant="mercury" style={{ maxWidth: 400, padding: 40, textAlign: 'center' }}>
          <div style={{ color: '#f87171', marginBottom: 16, fontSize: 11, fontWeight: 700, fontFamily: '"Space Mono", monospace', letterSpacing: '0.15em' }}>
            ERROR_LOADING_PROFILE
          </div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
            {error.message}
          </p>
          <button
            onClick={() => fetchData()}
            style={{
              padding: '12px 24px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
            }}
          >
            RETRY_CONNECTION
          </button>
        </LiquidMetalCard>
      </div>
    );
  }

  if (!candidate) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        color: 'rgba(255,255,255,0.4)',
        fontFamily: '"Space Mono", monospace',
        fontSize: 12,
        letterSpacing: '0.15em',
      }}>
        CANDIDATE_NOT_FOUND
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Score calculations
  // -------------------------------------------------------------------------

  const stageStats = stages.map(stage => {
    const challengeIds = (stage.challenges ?? []).map((c) => c.id);
    const stageAssessments = assessments.filter(a => a.challengeId !== null && challengeIds.includes(a.challengeId ?? ''));
    const score = stageAssessments.length > 0
      ? Math.round(stageAssessments.reduce((sum, a) => sum + (a.score ?? 0), 0) / stageAssessments.length)
      : null;
    return {
      id: stage.id,
      title: stage.title,
      score,
      isComplete: stageAssessments.length > 0 && stageAssessments.length === challengeIds.length,
    };
  });

  const completedStages = stageStats.filter(s => s.score !== null);
  const avgScore = completedStages.length > 0
    ? Math.round(completedStages.reduce((sum, s) => sum + (s.score ?? 0), 0) / completedStages.length)
    : null;
  const signal = calculateSignal(avgScore);
  const signalColors = getSignalColors(signal);

  const liveVideoStage = stages.find((s) => s.mode === 'LIVE_VIDEO');

  // ── Overview enrichment helpers ───────────────────────────────────────────

  const SIGNAL_LABELS: Record<string, string> = {
    STRONG: 'Strong hire signal',
    YES: 'Recommended',
    MAYBE: 'Borderline — review carefully',
    NO: 'Not recommended',
  };

  interface SnapshotFeedback {
    summary: string;
    strengths: string[];
    concerns: string[];
    skillProfile?: SkillProfileShape;
  }

  function parseSnapshot(feedback: string | null | undefined): SnapshotFeedback | null {
    if (!feedback) return null;
    try {
      const p = JSON.parse(feedback) as Record<string, unknown>;
      if (p && 'skillProfile' in p && typeof p['summary'] === 'string') {
        return p as unknown as SnapshotFeedback;
      }
    } catch { /* ignore */ }
    return null;
  }

  const aiSnapshot: SnapshotFeedback | null = (() => {
    for (const a of assessments) {
      const snap = parseSnapshot(a.feedback);
      if (snap) return snap;
    }
    return null;
  })();

  const invitedDate = candidate.createdAt ? new Date(candidate.createdAt) : null;
  const completedDate = candidate.updatedAt && candidate.status === 'COMPLETED' ? new Date(candidate.updatedAt) : null;
  const daysToComplete = invitedDate && completedDate
    ? Math.max(0, Math.round((completedDate.getTime() - invitedDate.getTime()) / 86400000))
    : null;
  const completedAtDisplay = daysToComplete === 0 ? 'same day'
    : daysToComplete === 1 ? '1 day'
    : daysToComplete !== null ? `${daysToComplete} days` : null;

  const totalChallenges = stages.flatMap(s => s.challenges ?? []).length;
  const completedChallenges = assessments.filter(a => a.completedAt).length;

  // Initials for avatar
  const candidateLabel = candidate.name && candidate.name !== candidate.email ? candidate.name : candidate.email ?? 'Candidate';
  const initials = candidateLabel.split(/[\s@]+/).map((w: string) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 32,
        gap: 24,
      }}>
        <div>
          <div style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'rgba(255,255,255,0.3)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 10,
          }}>
            CANDIDATE_PROFILE
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: signalColors.bg,
              border: `1px solid ${signalColors.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800, color: signalColors.text,
              fontFamily: '"Space Mono", monospace',
              flexShrink: 0,
            }}>
              {initials || '?'}
            </div>
            <div style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#fff',
              letterSpacing: '-0.01em',
            }}>
              {candidateLabel}
            </div>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: 11,
            color: 'rgba(255,255,255,0.35)',
            fontFamily: '"Space Mono", monospace',
            flexWrap: 'wrap',
          }}>
            {candidate.email && <span>{candidate.email}</span>}
            <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
            <span>{candidate.pipelineId}</span>
            <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
            <span style={{ color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' }}>{candidate.status ?? 'UNKNOWN'}</span>
          </div>
        </div>

        {/* GENERATE_REPORT — prints current page as PDF */}
        <button
          onClick={() => {
            setSelectedTab('INTELLIGENCE');
            setTimeout(() => window.print(), 300);
          }}
          title="Print intelligence report as PDF"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            cursor: 'pointer',
            borderRadius: 3,
            flexShrink: 0,
          }}
        >
          <FileDown size={13} />
          GENERATE_REPORT
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Tab bar                                                             */}
      {/* ------------------------------------------------------------------ */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        marginBottom: 32,
        gap: 0,
        overflowX: 'auto',
      }}>
        {(['OVERVIEW', ...stages.map(s => s.id)] as string[]).map((tabId) => {
          const isActive = selectedTab === tabId;
          const isOverview = tabId === 'OVERVIEW';
          const stageStat = isOverview ? null : stageStats.find(s => s.id === tabId);
          const stageTitle = isOverview ? 'OVERVIEW' : (stages.find(s => s.id === tabId)?.title ?? 'STAGE').toUpperCase();

          return (
            <button
              key={tabId}
              onClick={() => setSelectedTab(tabId)}
              style={{
                padding: '12px 20px',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid #fff' : '2px solid transparent',
                color: isActive ? '#fff' : 'rgba(255,255,255,0.35)',
                fontSize: 10,
                fontWeight: isActive ? 700 : 400,
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.1em',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                whiteSpace: 'nowrap',
                transition: 'color 0.15s',
              }}
            >
              {stageTitle}
              {stageStat?.score !== null && stageStat?.score !== undefined && (
                <span style={{
                  fontSize: 8,
                  padding: '2px 6px',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.5)',
                  borderRadius: 3,
                  fontWeight: 700,
                }}>
                  {stageStat.score}
                </span>
              )}
              {stageStat?.isComplete && (
                <CheckCircle size={10} color="rgba(16,185,129,0.7)" />
              )}
            </button>
          );
        })}

        {/* INTELLIGENCE tab — only when feature flag enabled */}
        {FEATURES.INTELLIGENCE_REPORT && (
          <button
            onClick={() => setSelectedTab('INTELLIGENCE')}
            style={{
              padding: '12px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: selectedTab === 'INTELLIGENCE' ? '2px solid #a78bfa' : '2px solid transparent',
              color: selectedTab === 'INTELLIGENCE' ? '#a78bfa' : 'rgba(255,255,255,0.35)',
              fontSize: 10,
              fontWeight: selectedTab === 'INTELLIGENCE' ? 700 : 400,
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.1em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              whiteSpace: 'nowrap',
              transition: 'color 0.15s',
            }}
          >
            INTELLIGENCE
            <span style={{
              fontSize: 7,
              padding: '1px 4px',
              background: 'rgba(167,139,250,0.15)',
              color: '#a78bfa',
              border: '1px solid rgba(167,139,250,0.3)',
              borderRadius: 2,
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.08em',
            }}>
              BETA
            </span>
          </button>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* OVERVIEW tab                                                        */}
      {/* ------------------------------------------------------------------ */}
      {selectedTab === 'OVERVIEW' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ---- Hiring recommendation hero ---- */}
          <LiquidMetalCard variant="mercury" style={{ padding: 36 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 32, alignItems: 'start' }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', marginBottom: 18 }}>
                  HIRING_RECOMMENDATION
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
                  <div style={{
                    fontSize: 64, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.04em',
                    color: avgScore !== null ? signalColors.text : 'rgba(255,255,255,0.15)',
                  }}>
                    {avgScore ?? '—'}
                  </div>
                  {avgScore !== null && (
                    <div style={{ fontSize: 14, fontWeight: 700, color: signalColors.text, fontFamily: '"Space Mono", monospace', letterSpacing: '0.04em' }}>
                      {SIGNAL_LABELS[signal] ?? signal}
                    </div>
                  )}
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', maxWidth: 340 }}>
                  <div style={{ height: '100%', width: `${avgScore ?? 0}%`, background: signalColors.text, borderRadius: 2, transition: 'width 0.4s ease' }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-end' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.25)', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>CHALLENGES</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', fontFamily: '"Space Mono", monospace' }}>
                    {completedChallenges}<span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>/{totalChallenges}</span>
                  </div>
                </div>
                {completedAtDisplay && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.25)', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>RESPONDED</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.55)', fontFamily: '"Space Mono", monospace' }}>{completedAtDisplay}</div>
                  </div>
                )}
              </div>
            </div>
          </LiquidMetalCard>

          {/* ---- AI snapshot + skill radar ---- */}
          {aiSnapshot && (
            <LiquidMetalCard variant="dark" style={{ padding: 32 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', marginBottom: 18 }}>
                AI_SNAPSHOT
              </div>
              <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.75, margin: '0 0 20px' }}>
                    {aiSnapshot.summary}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {aiSnapshot.strengths.slice(0, 2).map((s, i) => (
                      <span key={i} style={{ fontSize: 11, padding: '5px 12px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', borderRadius: 3, fontFamily: '"Space Mono", monospace', lineHeight: 1.4 }}>
                        ↑ {s}
                      </span>
                    ))}
                    {aiSnapshot.concerns.slice(0, 1).map((c, i) => (
                      <span key={i} style={{ fontSize: 11, padding: '5px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171', borderRadius: 3, fontFamily: '"Space Mono", monospace', lineHeight: 1.4 }}>
                        △ {c}
                      </span>
                    ))}
                  </div>
                </div>
                {aiSnapshot.skillProfile && (
                  <MiniRadar skillProfile={aiSnapshot.skillProfile} color={signalColors.text} />
                )}
              </div>
            </LiquidMetalCard>
          )}

          {/* ---- Stage cards (richer) ---- */}
          {stages.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stages.map((stage) => {
                const stat = stageStats.find(s => s.id === stage.id);
                const stageChallenges = stage.challenges ?? [];
                return (
                  <LiquidMetalCard
                    key={stage.id}
                    hover
                    onClick={() => setSelectedTab(stage.id)}
                    style={{ padding: '20px 24px', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: stageChallenges.length > 0 ? 10 : 0 }}>
                          <span style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace', textTransform: 'uppercase' }}>
                            {stage.title ?? 'Stage'}
                          </span>
                          {stat?.isComplete && <CheckCircle size={11} color="rgba(16,185,129,0.7)" />}
                        </div>
                        {stageChallenges.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {stageChallenges.map(ch => {
                              const cha = assessments.find(a => a.challengeId === ch.id);
                              return (
                                <span key={ch.id} style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', padding: '2px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 3 }}>
                                  {ch.title ?? 'Challenge'}
                                  {cha?.score !== null && cha?.score !== undefined && (
                                    <span style={{ color: 'rgba(255,255,255,0.25)', marginLeft: 6 }}>{cha.score}</span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                        <div style={{
                          fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em',
                          color: stat?.score !== null && stat?.score !== undefined ? '#fff' : 'rgba(255,255,255,0.15)',
                        }}>
                          {stat?.score !== null && stat?.score !== undefined ? stat.score : '—'}
                        </div>
                        {stat?.score !== null && stat?.score !== undefined && (
                          <SignalBadge signal={calculateSignal(stat.score)} />
                        )}
                      </div>
                    </div>
                  </LiquidMetalCard>
                );
              })}
            </div>
          )}

          {/* ---- Candidate info ---- */}
          <LiquidMetalCard variant="dark" style={{ padding: 32 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', marginBottom: 20 }}>
              CANDIDATE_INFO
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 24 }}>
              {[
                { label: 'EMAIL', value: candidate.email ?? '—' },
                { label: 'STATUS', value: candidate.status ?? '—' },
                { label: 'INVITED', value: invitedDate ? invitedDate.toLocaleDateString() : '—' },
                { label: 'COMPLETED', value: completedDate ? completedDate.toLocaleDateString() : '—' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.25)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', fontFamily: '"Space Mono", monospace', wordBreak: 'break-all' }}>{value}</div>
                </div>
              ))}
            </div>
          </LiquidMetalCard>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Per-stage tab                                                       */}
      {/* ------------------------------------------------------------------ */}
      {/* ------------------------------------------------------------------ */}
      {/* INTELLIGENCE tab                                                    */}
      {/* ------------------------------------------------------------------ */}
      {selectedTab === 'INTELLIGENCE' && FEATURES.INTELLIGENCE_REPORT && (
        <IntelligenceReport
          candidate={candidate}
          assessments={assessments}
          stages={stages}
          stageStats={stageStats}
          avgScore={avgScore}
          signal={signal}
          signalColors={signalColors}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Per-stage tab                                                       */}
      {/* ------------------------------------------------------------------ */}
      {selectedTab !== 'OVERVIEW' && selectedTab !== 'INTELLIGENCE' && (() => {
        const stage = stages.find(s => s.id === selectedTab);
        if (!stage) return null;
        const stat = stageStats.find(s => s.id === selectedTab);
        const challenges = stage.challenges ?? [];

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Stage header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{
                  fontSize: 9,
                  letterSpacing: '0.18em',
                  color: 'rgba(255,255,255,0.3)',
                  fontFamily: '"Space Mono", monospace',
                  marginBottom: 8,
                }}>
                  {(stage.title ?? 'STAGE').toUpperCase()}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
                    {stat?.score !== null && stat?.score !== undefined ? stat.score : '—'}
                  </span>
                  {stat?.score !== null && stat?.score !== undefined && (
                    <SignalBadge signal={calculateSignal(stat.score)} />
                  )}
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: '"Space Mono", monospace' }}>
                {challenges.length} CHALLENGE{challenges.length !== 1 ? 'S' : ''}
              </div>
            </div>

            {/* Live interview section */}
            {liveVideoStage && liveVideoStage.id === stage.id && (
              <LiquidMetalCard variant="dark" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: scheduledInterview ? 16 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Calendar size={14} color="rgba(255,255,255,0.4)" />
                    <span style={{ fontSize: 9, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace' }}>
                      LIVE_INTERVIEW
                    </span>
                  </div>
                  {scheduledInterview && (
                    <InterviewStatusBadge status={(scheduledInterview.status ?? 'INVITED') as InterviewStatus} />
                  )}
                </div>

                {scheduledInterview ? (
                  <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                    {scheduledInterview.scheduledAt && (
                      <div>
                        <div style={{ fontSize: 9, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', marginBottom: 4, fontFamily: '"Space Mono", monospace' }}>SCHEDULED_AT</div>
                        <div style={{ fontSize: 14, color: '#fff', fontFamily: '"Space Mono", monospace' }}>
                          {new Date(scheduledInterview.scheduledAt).toLocaleString()}
                        </div>
                      </div>
                    )}
                    {scheduledInterview.meetingUrl && (
                      <a
                        href={scheduledInterview.meetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#60a5fa', fontFamily: '"Space Mono", monospace', textDecoration: 'none' }}
                      >
                        JOIN_MEETING →
                      </a>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', marginBottom: 8, fontFamily: '"Space Mono", monospace' }}>
                        SCHEDULING_URL (Calendly / Cal.com)
                      </div>
                      <input
                        type="url"
                        value={inviteUrl}
                        onChange={(e) => setInviteUrl(e.target.value)}
                        placeholder="https://calendly.com/you/30min"
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: '#fff',
                          fontSize: 12,
                          fontFamily: '"Space Mono", monospace',
                          outline: 'none',
                          boxSizing: 'border-box',
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <button
                      onClick={handleSendInvite}
                      disabled={inviteSaving || !inviteUrl}
                      style={{
                        padding: '10px 20px',
                        background: inviteUrl ? 'rgba(96,165,250,0.1)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${inviteUrl ? 'rgba(96,165,250,0.3)' : 'rgba(255,255,255,0.1)'}`,
                        color: inviteUrl ? '#60a5fa' : 'rgba(255,255,255,0.3)',
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        fontFamily: '"Space Mono", monospace',
                        cursor: inviteUrl && !inviteSaving ? 'pointer' : 'not-allowed',
                        whiteSpace: 'nowrap',
                        borderRadius: 3,
                      }}
                    >
                      {inviteSaving ? 'SENDING...' : 'SEND_INVITE'}
                    </button>
                  </div>
                )}
              </LiquidMetalCard>
            )}

            {/* Challenge cards */}
            {challenges.length === 0 && (
              <div style={{
                padding: 40,
                textAlign: 'center',
                color: 'rgba(255,255,255,0.2)',
                fontFamily: '"Space Mono", monospace',
                fontSize: 11,
                letterSpacing: '0.1em',
              }}>
                NO_CHALLENGES_IN_STAGE
              </div>
            )}

            {challenges.map((challenge) => {
              const assessment = assessments.find(a => a.challengeId === challenge.id);
              return (
                <ChallengeCard
                  key={challenge.id}
                  challenge={challenge}
                  assessment={assessment}
                  onScoreChange={handleScoreChange}
                  onFeedbackChange={handleFeedbackChange}
                />
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
