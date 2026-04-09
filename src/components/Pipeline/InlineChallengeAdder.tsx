/**
 * InlineChallengeAdder — replaces the ChallengeBrowserPanel sidebar drawer.
 *
 * Renders inside the CHALLENGES SectionCard body. Flow:
 *
 *   1. Compact type-button row  (SCREENING / CULTURAL / TECHNICAL / PANEL)
 *   2. When a type is selected a detail section expands below:
 *        SCREENING   → format picker (PHONE_CALL / VIDEO_CALL / ONLINE)
 *                       → call config with collapsible details  |  question picker
 *        TECHNICAL   → template list (CODE_REVIEW, CODE_IMPLEMENTATION, QUIZ_*)
 *        others      → response-format picker → template list
 */

import { useState, useMemo, useEffect } from 'react';
import {
  Phone,
  Users,
  FileText,
  Zap,
  ChevronDown,
  ChevronUp,
  PhoneCall,
  Video,
  MonitorPlay,
  Mail,
  Calendar,
  Clock,
  CheckCircle2,
  ArrowLeft,
  Search,
  AlertCircle,
  Type,
  Mic,
  Sparkles,
  PenLine,
  X,
  GitPullRequest,
} from 'lucide-react';
import { STAGE_TYPE_CONFIGS, STAGE_TYPES, type StageType } from '../../lib/stageTemplates';
import { useStageMutations } from '../../hooks/useStageMutations';
import { useStageDetail } from '../../hooks/useStageDetail';
import { useChallengeMutations } from '../../hooks/useChallengeMutations';
import { useStageRefetch } from '../../contexts/StageRefetchContext';
import {
  ALL_CHALLENGE_TEMPLATES,
  type ChallengeTemplate,
  type ChallengeType,
  type ShortAnswerInputMode,
} from '../../content/challengeLibrary';
import type { ScreeningFormat } from '../../lib/api/types';
import {
  SCREENING_QUESTIONS,
  SCREENING_CATEGORIES,
  type ScreeningCategory,
  type ScreeningQuestionTemplate,
} from '../../content/screeningQuestions';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_TYPE_ICONS: Record<StageType, typeof Phone> = {
  SCREENING: Phone,
  CULTURAL: Users,
  TECHNICAL: Zap,
  CODE_REVIEW: GitPullRequest,
  PANEL: FileText,
};

const TYPE_TO_CHALLENGE_TYPES: Record<StageType, ChallengeType[]> = {
  SCREENING: ['QUIZ_SHORT_ANSWER', 'FOLLOW_UP'],
  CULTURAL: ['QUIZ_SHORT_ANSWER', 'FOLLOW_UP'],
  TECHNICAL: ['CODE_REVIEW', 'CODE_IMPLEMENTATION', 'QUIZ_SHORT_ANSWER', 'QUIZ_MCQ'],
  CODE_REVIEW: ['CODE_REVIEW'],
  PANEL: ['QUIZ_SHORT_ANSWER', 'FOLLOW_UP'],
};

const SCREENING_FORMAT_OPTIONS: {
  format: ScreeningFormat;
  label: string;
  description: string;
  Icon: typeof Phone;
}[] = [
  { format: 'PHONE_CALL', label: 'PHONE CALL', description: 'Recruiter calls via Twilio', Icon: PhoneCall },
  { format: 'VIDEO_CALL', label: 'VIDEO CALL', description: 'Live video screening', Icon: Video },
  { format: 'ONLINE', label: 'ONLINE QUESTIONS', description: 'Async screening questions', Icon: MonitorPlay },
];

const SHORT_ANSWER_MODES: {
  mode: ShortAnswerInputMode;
  label: string;
  description: string;
  Icon: typeof Type;
}[] = [
  { mode: 'text', label: 'TEXT', description: 'Written response', Icon: Type },
  { mode: 'video', label: 'VIDEO', description: 'Recorded video response', Icon: Video },
  { mode: 'voice', label: 'VOICE', description: 'Recorded voice response', Icon: Mic },
];

// ─── Shared style tokens ──────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.2em',
  color: 'var(--pipe-text-dim)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 8,
  display: 'block',
};

const optionButtonBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.08em',
  fontFamily: '"Space Mono", monospace',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'all 0.15s',
  textAlign: 'left' as const,
  width: '100%',
};

// ─── ToggleSwitch ─────────────────────────────────────────────────────────────

function ToggleSwitch({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: value ? '#818cf8' : 'var(--pipe-surface-hover)',
        cursor: 'pointer',
        padding: 0,
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute',
          top: 3,
          left: value ? 19 : 3,
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}

// ─── CallFlowDetail — collapsible call/meeting config ─────────────────────────

function CallFlowDetail({
  format,
  stageId,
  stage,
  updateStage,
  refetch,
  triggerRefetch,
}: {
  format: 'PHONE_CALL' | 'VIDEO_CALL';
  stageId: string;
  stage: ReturnType<typeof useStageDetail>['stage'];
  updateStage: ReturnType<typeof useStageMutations>['updateStage'];
  refetch: () => Promise<void>;
  triggerRefetch: () => Promise<void>;
}): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const [isScheduled, setIsScheduled] = useState(stage?.isScheduled ?? true);

  const isPhone = format === 'PHONE_CALL';

  const handleToggleScheduling = async (value: boolean): Promise<void> => {
    setIsScheduled(value);
    try {
      await updateStage(stageId, { isScheduled: value });
      await refetch();
      await triggerRefetch();
    } catch (err) {
      console.error('[CallFlowDetail] Failed to toggle scheduling:', err);
      setIsScheduled(!value);
    }
  };

  const steps = isPhone
    ? [
        { icon: Mail, text: 'Send invitation email to candidate' },
        { icon: Calendar, text: isScheduled ? 'Candidate books a time slot' : 'Recruiter initiates call directly' },
        { icon: PhoneCall, text: 'Call through the app — recorded + transcribed' },
        { icon: Clock, text: 'Review transcript and notes' },
        { icon: CheckCircle2, text: 'Advance candidate to next stage or reject' },
      ]
    : [
        { icon: Mail, text: 'Send invitation email to candidate' },
        { icon: Calendar, text: isScheduled ? 'Candidate books a time slot' : 'Share meeting link directly' },
        { icon: Video, text: 'Live video meeting in browser' },
        { icon: CheckCircle2, text: 'Advance candidate to next stage or reject' },
      ];

  const accentColor = isPhone ? '#60a5fa' : '#a78bfa';
  const accentBg = isPhone ? 'rgba(96,165,250,0.06)' : 'rgba(167,139,250,0.06)';

  return (
    <div
      style={{
        marginTop: 12,
        border: '1px solid var(--pipe-border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '10px 14px',
          background: accentBg,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isPhone ? (
            <PhoneCall size={13} color={accentColor} />
          ) : (
            <Video size={13} color={accentColor} />
          )}
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: accentColor,
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {isPhone ? 'PHONE_SCREENING' : 'VIDEO_SCREENING'}
          </span>
        </div>
        {expanded ? (
          <ChevronUp size={12} color="var(--pipe-text-dim)" />
        ) : (
          <ChevronDown size={12} color="var(--pipe-text-dim)" />
        )}
      </button>

      {expanded && (
        <div
          style={{
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            background: 'var(--pipe-surface)',
          }}
        >
          {/* Description */}
          <p
            style={{
              margin: 0,
              fontSize: 10,
              lineHeight: 1.6,
              color: 'var(--pipe-text-muted)',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {isPhone
              ? 'Recruiter calls the candidate through the app. The call is recorded and transcribed automatically.'
              : 'Schedule a live video meeting. The recruiter and candidate join a video room in the browser.'}
          </p>

          {/* Scheduling toggle */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={12} style={{ color: 'var(--pipe-text-dim)' }} />
                <span style={{ ...labelStyle, marginBottom: 0 }}>SCHEDULING_LINK</span>
              </div>
              <ToggleSwitch
                value={isScheduled}
                onChange={(v) => void handleToggleScheduling(v)}
              />
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 8,
                color: 'var(--pipe-text-dim)',
                opacity: 0.6,
                letterSpacing: '0.05em',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              Candidate receives a link to book a time slot
            </div>
          </div>

          {/* Call / meeting flow */}
          <div>
            <label style={labelStyle}>
              {isPhone ? 'CALL_FLOW' : 'MEETING_FLOW'}
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {steps.map((step, i) => {
                const StepIcon = step.icon;
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      background: 'var(--pipe-surface-hover)',
                      border: '1px solid var(--pipe-border)',
                      borderRadius: 4,
                    }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: 'rgba(255,255,255,0.04)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <StepIcon size={10} color="var(--pipe-text-dim)" />
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        color: 'var(--pipe-text-muted)',
                        letterSpacing: '0.03em',
                        fontFamily: '"Space Mono", monospace',
                      }}
                    >
                      {step.text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ScreeningSubFlow ─────────────────────────────────────────────────────────

function ScreeningSubFlow({
  stageId,
  stage,
  updateStage,
  refetch,
  triggerRefetch,
  onAddChallenge,
  existingCount,
  deleteChallenge,
}: {
  stageId: string;
  stage: ReturnType<typeof useStageDetail>['stage'];
  updateStage: ReturnType<typeof useStageMutations>['updateStage'];
  refetch: () => Promise<void>;
  triggerRefetch: () => Promise<void>;
  onAddChallenge: (template: ChallengeTemplate) => Promise<void>;
  existingCount: number;
  deleteChallenge: ReturnType<typeof useChallengeMutations>['deleteChallenge'];
}): JSX.Element {
  const [selectedFormat, setSelectedFormat] = useState<ScreeningFormat | null>(
    (stage?.screeningFormat as ScreeningFormat | null) ?? null,
  );
  const [pendingFormat, setPendingFormat] = useState<ScreeningFormat | null>(null);

  // Sync selectedFormat once async stage data arrives
  useEffect(() => {
    if (stage?.screeningFormat && selectedFormat === null) {
      setSelectedFormat(stage.screeningFormat as ScreeningFormat);
    }
  }, [stage?.screeningFormat, selectedFormat]);

  const commitSelectFormat = async (format: ScreeningFormat): Promise<void> => {
    setSelectedFormat(format);
    setPendingFormat(null);
    try {
      for (const c of stage?.challenges ?? []) {
        await deleteChallenge(c.id);
      }
      const modeForFormat =
        format === 'VIDEO_CALL' ? ('LIVE_VIDEO' as const) : ('ASYNC' as const);
      await updateStage(stageId, {
        screeningFormat: format,
        mode: modeForFormat,
        isScheduled: format !== 'ONLINE',
      });
      await refetch();
      await triggerRefetch();
    } catch (err) {
      console.error('[ScreeningSubFlow] Failed to set format:', err);
      setSelectedFormat(null);
    }
  };

  const handleSelectFormat = (format: ScreeningFormat): void => {
    const current = stage?.screeningFormat as ScreeningFormat | null;
    const hasExisting = (stage?.challenges?.length ?? 0) > 0;
    if (hasExisting && format !== current) {
      setPendingFormat(format);
    } else {
      void commitSelectFormat(format);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={labelStyle}>SCREENING_FORMAT</label>

      {pendingFormat && (
        <div
          style={{
            padding: '10px 12px',
            background: 'rgba(251,191,36,0.06)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
            <AlertCircle size={11} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
            <span
              style={{
                fontFamily: '"Space Mono", monospace',
                fontSize: 9,
                fontWeight: 700,
                color: '#fbbf24',
                lineHeight: 1.5,
              }}
            >
              Changing format will delete {stage?.challenges?.length ?? 0} existing challenge
              {(stage?.challenges?.length ?? 0) !== 1 ? 's' : ''}. Continue?
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => void commitSelectFormat(pendingFormat)}
              style={{
                padding: '4px 10px',
                background: 'rgba(74,222,128,0.1)',
                border: '1px solid rgba(74,222,128,0.3)',
                borderRadius: 3,
                color: '#4ade80',
                fontFamily: '"Space Mono", monospace',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                cursor: 'pointer',
              }}
            >
              CONFIRM
            </button>
            <button
              onClick={() => setPendingFormat(null)}
              style={{
                padding: '4px 10px',
                background: 'none',
                border: '1px solid var(--pipe-border)',
                borderRadius: 3,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                cursor: 'pointer',
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Format buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {SCREENING_FORMAT_OPTIONS.map(({ format, label, description, Icon }) => {
          const isPending = pendingFormat === format;
          const isCurrent = selectedFormat === format;
          return (
            <button
              key={format}
              onClick={() => handleSelectFormat(format)}
              style={{
                ...optionButtonBase,
                background: isPending
                  ? 'rgba(251,191,36,0.08)'
                  : isCurrent
                    ? 'var(--pipe-surface-hover)'
                    : 'var(--pipe-surface)',
                border: isPending
                  ? '1px solid rgba(251,191,36,0.3)'
                  : isCurrent
                    ? '1px solid var(--pipe-text)'
                    : '1px solid var(--pipe-border)',
                color: isPending ? '#fbbf24' : isCurrent ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
              }}
            >
              <Icon size={14} />
              <div>
                <div>{label}</div>
                <div style={{ fontSize: 8, opacity: 0.7, marginTop: 2, fontWeight: 400 }}>
                  {description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Format-specific detail */}
      {selectedFormat === 'PHONE_CALL' || selectedFormat === 'VIDEO_CALL' ? (
        <CallFlowDetail
          format={selectedFormat}
          stageId={stageId}
          stage={stage}
          updateStage={updateStage}
          refetch={refetch}
          triggerRefetch={triggerRefetch}
        />
      ) : selectedFormat === 'ONLINE' ? (
        <OnlineQuestionPicker
          onAdd={onAddChallenge}
          existingCount={existingCount}
        />
      ) : null}
    </div>
  );
}

// ─── OnlineQuestionPicker — 3-mode question source selector ──────────────────

type QuestionSourceMode = 'template' | 'ai' | 'manual';

const QUESTION_SOURCE_MODES: {
  mode: QuestionSourceMode;
  label: string;
  Icon: typeof Search;
}[] = [
  { mode: 'template', label: 'TEMPLATE', Icon: FileText },
  { mode: 'ai', label: 'AI_GENERATED', Icon: Sparkles },
  { mode: 'manual', label: 'MANUAL', Icon: PenLine },
];

function ModeTab({
  label,
  Icon,
  isActive,
  onClick,
}: {
  label: string;
  Icon: typeof Search;
  isActive: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.1em',
        fontFamily: '"Space Mono", monospace',
        background: isActive ? 'var(--pipe-surface-hover)' : 'transparent',
        border: isActive
          ? '1px solid var(--pipe-text)'
          : '1px solid var(--pipe-border-light)',
        borderRadius: 4,
        color: isActive ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        flexShrink: 0,
      }}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

// Template mode — thematic question-set cards

function TemplateQuestions({
  onAdd,
  existingCount,
}: {
  onAdd: (template: ChallengeTemplate) => Promise<void>;
  existingCount: number;
}): JSX.Element {
  const [expandedSet, setExpandedSet] = useState<ScreeningCategory | null>(null);
  const [addingSet, setAddingSet] = useState<ScreeningCategory | null>(null);

  const categories = Object.entries(SCREENING_CATEGORIES) as [
    ScreeningCategory,
    { label: string; description: string },
  ][];

  const questionsByCategory = useMemo(() => {
    const map = new Map<ScreeningCategory, ScreeningQuestionTemplate[]>();
    for (const sq of SCREENING_QUESTIONS) {
      const list = map.get(sq.category) ?? [];
      list.push(sq);
      map.set(sq.category, list);
    }
    return map;
  }, []);

  const makeTemplate = (sq: ScreeningQuestionTemplate): ChallengeTemplate => {
    const instructions =
      sq.text +
      (sq.followUps?.length
        ? '\n\nFollow-up prompts:\n' + sq.followUps.map((f) => `- ${f}`).join('\n')
        : '');
    return {
      id: sq.id,
      type: 'QUIZ_SHORT_ANSWER',
      title: sq.text,
      description: sq.purpose,
      instructions,
      tags: [sq.category, 'screening'],
      difficulty: 'beginner',
      topic: 'screening',
      estimatedMinutes: 3,
      config: { inputMode: 'text' as const, question: sq.text, placeholder: 'Type your answer...' },
    };
  };

  const handleAddAll = async (catKey: ScreeningCategory): Promise<void> => {
    setAddingSet(catKey);
    const questions = questionsByCategory.get(catKey) ?? [];
    try {
      for (const sq of questions) {
        await onAdd(makeTemplate(sq));
      }
    } finally {
      setAddingSet(null);
    }
  };

  const totalAdded = existingCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {categories.map(([catKey, catInfo]) => {
        const questions = questionsByCategory.get(catKey) ?? [];
        if (questions.length === 0) return null;
        const isExpanded = expandedSet === catKey;
        const isAdding = addingSet === catKey;

        return (
          <div
            key={catKey}
            style={{
              border: '1px solid var(--pipe-border)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {/* Set header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                background: isExpanded ? 'var(--pipe-surface-hover)' : 'var(--pipe-surface)',
              }}
            >
              {/* Expand toggle */}
              <button
                type="button"
                onClick={() => setExpandedSet(isExpanded ? null : catKey)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  padding: 0,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.12em',
                      color: 'var(--pipe-text)',
                      fontFamily: '"Space Mono", monospace',
                      marginBottom: 2,
                    }}
                  >
                    {catInfo.label.toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                      lineHeight: 1.4,
                    }}
                  >
                    {catInfo.description}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                      opacity: 0.5,
                    }}
                  >
                    {questions.length} Q
                  </span>
                  {isExpanded ? (
                    <ChevronUp size={12} color="var(--pipe-text-dim)" />
                  ) : (
                    <ChevronDown size={12} color="var(--pipe-text-dim)" />
                  )}
                </div>
              </button>

              {/* Add all button */}
              <button
                type="button"
                onClick={() => void handleAddAll(catKey)}
                disabled={isAdding}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  background: 'var(--pipe-text)',
                  border: '1px solid var(--pipe-text)',
                  borderRadius: 4,
                  color: 'var(--pipe-bg)',
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: isAdding ? 'wait' : 'pointer',
                  opacity: isAdding ? 0.6 : 1,
                }}
              >
                {isAdding ? '...' : `+ ADD ALL`}
              </button>
            </div>

            {/* Individual questions (expanded) */}
            {isExpanded && (
              <div
                style={{
                  borderTop: '1px solid var(--pipe-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                {questions.map((sq) => (
                  <button
                    key={sq.id}
                    onClick={() => void onAdd(makeTemplate(sq))}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '10px 14px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--pipe-border-light)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 10,
                          color: 'var(--pipe-text)',
                          lineHeight: 1.5,
                          marginBottom: 3,
                        }}
                      >
                        {sq.text}
                      </div>
                      <div
                        style={{
                          fontSize: 8,
                          color: 'var(--pipe-text-dim)',
                          opacity: 0.6,
                          lineHeight: 1.4,
                        }}
                      >
                        {sq.purpose}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 8,
                        color: 'var(--pipe-text-dim)',
                        fontFamily: '"Space Mono", monospace',
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      + ADD
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div
        style={{
          fontSize: 8,
          color: 'var(--pipe-text-dim)',
          letterSpacing: '0.1em',
          textAlign: 'center',
          fontFamily: '"Space Mono", monospace',
          opacity: 0.4,
          paddingTop: 4,
        }}
      >
        {SCREENING_QUESTIONS.length} QUESTIONS ACROSS {categories.length} SETS — {totalAdded} ADDED
      </div>
    </div>
  );
}

// AI Generated mode — placeholder for AI question generation

function AiGeneratedQuestions({
  onAdd,
}: {
  onAdd: (template: ChallengeTemplate) => Promise<void>;
}): JSX.Element {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState<string[]>([]);

  const handleGenerate = async (): Promise<void> => {
    setIsGenerating(true);
    // Placeholder — real implementation will call Worker AI endpoint
    await new Promise((r) => setTimeout(r, 1200));
    setGenerated([
      'Tell me about a time you had to debug a production incident under pressure.',
      'How do you approach learning a new codebase you\'ve never seen before?',
      'Describe a technical decision you made that you later regretted.',
      'Walk me through your process when a feature is blocked by a dependency.',
      'How do you balance technical debt with shipping velocity?',
    ]);
    setIsGenerating(false);
  };

  const handleAddGenerated = async (text: string): Promise<void> => {
    await onAdd({
      id: `ai-${Date.now()}`,
      type: 'QUIZ_SHORT_ANSWER',
      title: text,
      description: 'AI-generated screening question',
      instructions: text,
      tags: ['ai-generated', 'screening'],
      difficulty: 'intermediate',
      topic: 'screening',
      estimatedMinutes: 3,
      config: { inputMode: 'text' as const, question: text, placeholder: 'Type your answer...' },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          padding: '12px 14px',
          background: 'rgba(167,139,250,0.06)',
          border: '1px solid rgba(167,139,250,0.15)',
          borderRadius: 6,
          fontSize: 10,
          color: 'var(--pipe-text-muted)',
          fontFamily: '"Space Mono", monospace',
          lineHeight: 1.6,
        }}
      >
        Generate interview questions tailored to the role context and stage. Requires role discovery data.
      </div>

      {generated.length === 0 ? (
        <button
          onClick={() => void handleGenerate()}
          disabled={isGenerating}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 20px',
            background: isGenerating ? 'var(--pipe-surface)' : 'var(--pipe-text)',
            border: '1px solid var(--pipe-text)',
            borderRadius: 6,
            color: isGenerating ? 'var(--pipe-text-dim)' : 'var(--pipe-bg)',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.15em',
            fontFamily: '"Space Mono", monospace',
            cursor: isGenerating ? 'wait' : 'pointer',
            opacity: isGenerating ? 0.6 : 1,
          }}
        >
          <Sparkles size={13} />
          {isGenerating ? 'GENERATING...' : 'GENERATE_QUESTIONS'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>GENERATED_QUESTIONS</label>
            <button
              onClick={() => void handleGenerate()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                background: 'none',
                border: '1px solid var(--pipe-border)',
                borderRadius: 3,
                color: 'var(--pipe-text-dim)',
                fontSize: 8,
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                letterSpacing: '0.1em',
              }}
            >
              <Sparkles size={9} />
              REGENERATE
            </button>
          </div>
          {generated.map((text, i) => (
            <button
              key={i}
              onClick={() => void handleAddGenerated(text)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                padding: '10px 12px',
                background: 'transparent',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              <div style={{ fontSize: 10, color: 'var(--pipe-text)', lineHeight: 1.5 }}>
                {text}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Manual mode — write your own question

function ManualQuestion({
  onAdd,
}: {
  onAdd: (template: ChallengeTemplate) => Promise<void>;
}): JSX.Element {
  const [question, setQuestion] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async (): Promise<void> => {
    const text = question.trim();
    if (!text) return;
    setIsAdding(true);
    try {
      await onAdd({
        id: `manual-${Date.now()}`,
        type: 'QUIZ_SHORT_ANSWER',
        title: text,
        description: 'Manual screening question',
        instructions: text,
        tags: ['manual', 'screening'],
        difficulty: 'intermediate',
        topic: 'screening',
        estimatedMinutes: 3,
        config: { inputMode: 'text' as const, question: text, placeholder: 'Type your answer...' },
      });
      setQuestion('');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={labelStyle}>QUESTION_TEXT</label>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Type your interview question..."
          rows={3}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border)',
            borderRadius: 6,
            color: 'var(--pipe-text)',
            fontSize: 12,
            fontFamily: '"Space Mono", monospace',
            outline: 'none',
            resize: 'vertical',
            lineHeight: 1.6,
            boxSizing: 'border-box',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              void handleAdd();
            }
          }}
        />
        <div
          style={{
            marginTop: 4,
            fontSize: 8,
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            opacity: 0.5,
          }}
        >
          ⌘↵ to add quickly
        </div>
      </div>
      <button
        onClick={() => void handleAdd()}
        disabled={!question.trim() || isAdding}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '10px 20px',
          background: question.trim() ? 'var(--pipe-text)' : 'var(--pipe-surface)',
          border: '1px solid var(--pipe-text)',
          borderRadius: 6,
          color: question.trim() ? 'var(--pipe-bg)' : 'var(--pipe-text-dim)',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.15em',
          fontFamily: '"Space Mono", monospace',
          cursor: question.trim() && !isAdding ? 'pointer' : 'not-allowed',
          opacity: isAdding ? 0.6 : 1,
          alignSelf: 'flex-start',
        }}
      >
        <PenLine size={12} />
        {isAdding ? 'ADDING...' : 'ADD_QUESTION'}
      </button>
    </div>
  );
}

// Outer container with the 3-mode tab switcher

function OnlineQuestionPicker({
  onAdd,
  existingCount,
}: {
  onAdd: (template: ChallengeTemplate) => Promise<void>;
  existingCount: number;
}): JSX.Element {
  const [mode, setMode] = useState<QuestionSourceMode>('template');

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        {QUESTION_SOURCE_MODES.map(({ mode: m, label, Icon }) => (
          <ModeTab
            key={m}
            label={label}
            Icon={Icon}
            isActive={mode === m}
            onClick={() => setMode(m)}
          />
        ))}
      </div>

      {/* Mode content */}
      {mode === 'template' && (
        <TemplateQuestions onAdd={onAdd} existingCount={existingCount} />
      )}
      {mode === 'ai' && <AiGeneratedQuestions onAdd={onAdd} />}
      {mode === 'manual' && <ManualQuestion onAdd={onAdd} />}
    </div>
  );
}

// ─── TemplateListPicker ───────────────────────────────────────────────────────

function TemplateListPicker({
  stageType,
  onAdd,
  existingCount,
}: {
  stageType: StageType;
  onAdd: (template: ChallengeTemplate) => Promise<void>;
  existingCount: number;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [selectedInputMode, setSelectedInputMode] = useState<ShortAnswerInputMode | null>(null);

  const challengeTypes = TYPE_TO_CHALLENGE_TYPES[stageType];
  const hasShortAnswer = challengeTypes.includes('QUIZ_SHORT_ANSWER');
  const hasOnlyShortAnswer = challengeTypes.every(
    (t) => t === 'QUIZ_SHORT_ANSWER' || t === 'FOLLOW_UP',
  );
  // Only show mode picker for purely short-answer stages (CULTURAL, PANEL).
  // TECHNICAL goes straight to the template list.
  const showModePicker = hasOnlyShortAnswer && hasShortAnswer && selectedInputMode === null;

  const filtered = useMemo(() => {
    let templates = ALL_CHALLENGE_TEMPLATES.filter((t) =>
      challengeTypes.includes(t.type),
    );
    if (selectedInputMode !== null) {
      templates = templates.filter(
        (t) => t.type === 'QUIZ_SHORT_ANSWER' || t.type === 'FOLLOW_UP',
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      templates = templates.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return templates;
  }, [challengeTypes, search, selectedInputMode]);

  const handleAdd = async (template: ChallengeTemplate): Promise<void> => {
    if (selectedInputMode !== null && template.type === 'QUIZ_SHORT_ANSWER') {
      const config = {
        ...(template.config as Record<string, unknown>),
        inputMode: selectedInputMode,
      };
      await onAdd({ ...template, config: config as ChallengeTemplate['config'] });
    } else {
      await onAdd(template);
    }
  };

  if (showModePicker) {
    return (
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={labelStyle}>RESPONSE_FORMAT</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SHORT_ANSWER_MODES.map(({ mode, label, description, Icon }) => (
            <button
              key={mode}
              onClick={() => setSelectedInputMode(mode)}
              style={{
                ...optionButtonBase,
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                color: 'var(--pipe-text-dim)',
              }}
            >
              <Icon size={14} />
              <div>
                <div>{label}</div>
                <div style={{ fontSize: 8, opacity: 0.7, marginTop: 2, fontWeight: 400 }}>
                  {description}
                </div>
              </div>
            </button>
          ))}
        </div>
        {!hasOnlyShortAnswer && (
          <button
            onClick={() => setSelectedInputMode('text')}
            style={{
              padding: '8px 12px',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              fontFamily: '"Space Mono", monospace',
              background: 'transparent',
              border: '1px dashed var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            BROWSE ALL CHALLENGES
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {hasShortAnswer && (
        <button
          onClick={() => setSelectedInputMode(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 0,
            background: 'none',
            border: 'none',
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
            fontSize: 8,
            fontFamily: '"Space Mono", monospace',
            letterSpacing: '0.1em',
          }}
        >
          <ArrowLeft size={10} />
          {selectedInputMode !== null
            ? selectedInputMode.toUpperCase() + ' RESPONSE'
            : 'ALL'}
        </button>
      )}
      <div style={{ position: 'relative' }}>
        <Search
          size={12}
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--pipe-text-dim)',
          }}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search challenges..."
          style={{
            width: '100%',
            padding: '8px 10px 8px 30px',
            fontSize: 10,
            fontFamily: '"Space Mono", monospace',
            background: 'transparent',
            border: '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: 'var(--pipe-text)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.length === 0 && (
          <div
            style={{
              padding: 16,
              textAlign: 'center',
              fontSize: 9,
              color: 'var(--pipe-text-dim)',
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            NO_CHALLENGES_FOUND
          </div>
        )}
        {filtered.map((template) => (
          <button
            key={template.id}
            onClick={() => void handleAdd(template)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '10px 12px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--pipe-text)',
                lineHeight: 1.4,
              }}
            >
              {template.title}
            </div>
            <div
              style={{
                fontSize: 8,
                color: 'var(--pipe-text-dim)',
                opacity: 0.6,
                lineHeight: 1.4,
              }}
            >
              {template.description}
            </div>
          </button>
        ))}
      </div>
      <div
        style={{
          fontSize: 8,
          color: 'var(--pipe-text-dim)',
          letterSpacing: '0.1em',
          textAlign: 'center',
          fontFamily: '"Space Mono", monospace',
          opacity: 0.5,
        }}
      >
        {filtered.length} CHALLENGES — {existingCount} ADDED
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface InlineChallengeAdderProps {
  stageId: string;
  onClose: () => void;
}

export function InlineChallengeAdder({
  stageId,
  onClose,
}: InlineChallengeAdderProps): JSX.Element {
  const { stage, refetch } = useStageDetail(stageId);
  const { updateStage } = useStageMutations();
  const { createChallenge, deleteChallenge } = useChallengeMutations();
  const { triggerRefetch } = useStageRefetch();

  const [selectedType, setSelectedType] = useState<StageType | null>(
    (stage?.stageType as StageType | null) ?? null,
  );
  const [pendingType, setPendingType] = useState<StageType | null>(null);
  const [stagedItems, setStagedItems] = useState<ChallengeTemplate[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Sync selectedType from stage once async data arrives (stage is null on first render)
  useEffect(() => {
    if (stage?.stageType && selectedType === null) {
      setSelectedType(stage.stageType as StageType);
    }
  }, [stage?.stageType, selectedType]);

  const existingCount = stage?.challenges?.length ?? 0;

  const commitSelectType = async (type: StageType): Promise<void> => {
    setSelectedType(type);
    setPendingType(null);
    setStagedItems([]);
    const config = STAGE_TYPE_CONFIGS[type];
    try {
      await updateStage(stageId, { stageType: type, title: config.label });
      await refetch();
      await triggerRefetch();
    } catch (err) {
      console.error('[InlineChallengeAdder] Failed to update stage type:', err);
    }
  };

  const handleSelectType = (type: StageType): void => {
    if (existingCount > 0 && type !== selectedType) {
      setPendingType(type);
    } else {
      void commitSelectType(type);
    }
  };

  // Stage locally — no API call yet
  const handleStageChallenge = async (template: ChallengeTemplate): Promise<void> => {
    setStagedItems((prev) => [...prev, template]);
  };

  const handleRemoveStaged = (index: number): void => {
    setStagedItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async (): Promise<void> => {
    if (stagedItems.length === 0) {
      onClose();
      return;
    }
    setIsSaving(true);
    try {
      for (let i = 0; i < stagedItems.length; i++) {
        const template = stagedItems[i]!;
        await createChallenge(stageId, {
          type: template.type,
          title: template.title,
          instructions: template.instructions,
          config: template.config as Record<string, unknown>,
          order: existingCount + i,
        });
      }
      await refetch();
      await triggerRefetch();
      onClose();
    } catch (err) {
      console.error('[InlineChallengeAdder] Failed to save challenges:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      data-testid="inline-challenge-adder"
      style={{
        paddingTop: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Stage type confirmation banner */}
      {pendingType && (
        <div
          style={{
            padding: '10px 12px',
            background: 'rgba(251,191,36,0.06)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
            <AlertCircle size={11} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
            <span
              style={{
                fontFamily: '"Space Mono", monospace',
                fontSize: 9,
                fontWeight: 700,
                color: '#fbbf24',
                lineHeight: 1.5,
              }}
            >
              Changing to {STAGE_TYPE_CONFIGS[pendingType].label.toUpperCase()} will remove{' '}
              {existingCount} existing challenge{existingCount !== 1 ? 's' : ''}. Continue?
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => void commitSelectType(pendingType)}
              style={{
                padding: '4px 10px',
                background: 'rgba(74,222,128,0.1)',
                border: '1px solid rgba(74,222,128,0.3)',
                borderRadius: 3,
                color: '#4ade80',
                fontFamily: '"Space Mono", monospace',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                cursor: 'pointer',
              }}
            >
              CONFIRM
            </button>
            <button
              onClick={() => setPendingType(null)}
              style={{
                padding: '4px 10px',
                background: 'none',
                border: '1px solid var(--pipe-border)',
                borderRadius: 3,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                cursor: 'pointer',
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Type selector row */}
      <div>
        <label style={labelStyle}>STAGE_TYPE</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STAGE_TYPES.map((key) => {
            const config = STAGE_TYPE_CONFIGS[key];
            const Icon = STAGE_TYPE_ICONS[key];
            const isActive = selectedType === key;
            const isPending = pendingType === key;
            return (
              <button
                key={key}
                onClick={() => handleSelectType(key)}
                title={config.description}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 12px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontFamily: '"Space Mono", monospace',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  background: isPending
                    ? 'rgba(251,191,36,0.08)'
                    : isActive
                      ? 'var(--pipe-surface-hover)'
                      : 'var(--pipe-surface)',
                  border: isPending
                    ? '1px solid rgba(251,191,36,0.3)'
                    : isActive
                      ? '1px solid var(--pipe-text)'
                      : '1px solid var(--pipe-border)',
                  color: isPending ? '#fbbf24' : isActive ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
                }}
              >
                <Icon size={12} />
                {config.label.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Type-specific detail section */}
      {selectedType && (
        <div>
          {selectedType === 'SCREENING' ? (
            <ScreeningSubFlow
              stageId={stageId}
              stage={stage}
              updateStage={updateStage}
              refetch={refetch}
              triggerRefetch={triggerRefetch}
              onAddChallenge={handleStageChallenge}
              existingCount={existingCount}
              deleteChallenge={deleteChallenge}
            />
          ) : (
            <TemplateListPicker
              stageType={selectedType}
              onAdd={handleStageChallenge}
              existingCount={existingCount}
            />
          )}
        </div>
      )}

      {/* Staged queue + save — always shown once a type is selected */}
      {selectedType && (
        <div
          style={{
            borderTop: '1px solid var(--pipe-border)',
            paddingTop: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {stagedItems.length > 0 && (
            <>
              <label style={labelStyle}>STAGED — {stagedItems.length} TO ADD</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {stagedItems.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '8px 12px',
                      background: 'var(--pipe-surface)',
                      border: '1px solid var(--pipe-border)',
                      borderRadius: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--pipe-text)',
                        fontFamily: '"Space Mono", monospace',
                        lineHeight: 1.4,
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveStaged(i)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--pipe-text-dim)',
                        padding: 2,
                        display: 'flex',
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                      title="Remove"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 20px',
              background: isSaving ? 'var(--pipe-surface)' : 'var(--pipe-text)',
              border: '1px solid var(--pipe-text)',
              borderRadius: 6,
              color: isSaving ? 'var(--pipe-text-dim)' : 'var(--pipe-bg)',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.15em',
              fontFamily: '"Space Mono", monospace',
              cursor: isSaving ? 'wait' : 'pointer',
              opacity: isSaving ? 0.6 : 1,
            }}
          >
            {isSaving
              ? 'SAVING...'
              : stagedItems.length > 0
                ? `SAVE_${stagedItems.length}_CHALLENGE${stagedItems.length !== 1 ? 'S' : ''}`
                : 'SAVE_STAGE'}
          </button>
        </div>
      )}
    </div>
  );
}
