/**
 * StageConfigPanel — Multi-step stage configuration wizard.
 *
 * Step 1: Pick a stage type (SCREENING, CULTURAL, TECHNICAL, CODE_REVIEW, PANEL)
 *         → renames the stage, saves the type, swaps to step 2
 * Step 2: Type-specific challenge picker
 *         → browse/add challenges relevant to that type
 *
 * Renders in the Layout agentPanel slot via AppLayout.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, ArrowLeft, Phone, Users, FileText, Zap, Search, GitPullRequest, Loader, AlertCircle, Plus, Trash2, Calendar, Video, MonitorPlay, PhoneCall, Mail, Clock, CheckCircle2 } from 'lucide-react';
import { STAGE_TYPE_CONFIGS, STAGE_TYPES, type StageType } from '../lib/stageTemplates';
import { useStageMutations } from '../hooks/useStageMutations';
import { useStageDetail } from '../hooks/useStageDetail';
import { useChallengeMutations } from '../hooks/useChallengeMutations';
import { useAuth as useClerkAuth } from '@clerk/react';

/** Minimal shape needed to create a challenge */
interface StagedItem {
  type: string;
  title: string;
  instructions: string;
  config: Record<string, unknown>;
}
import { createApiClient } from '../lib/api/client';
import { useStageRefetch } from '../contexts/StageRefetchContext';
import type { ScreeningFormat } from '../lib/api/types';
import {
  SCREENING_QUESTIONS,
  SCREENING_CATEGORIES,
  type ScreeningCategory,
  type ScreeningQuestionTemplate,
} from '../content/screeningQuestions';

interface StageConfigPanelProps {
  stageId: string;
  onClose: () => void;
}

const STAGE_TYPE_ICONS: Record<StageType, typeof Phone> = {
  SCREENING: Phone,
  CULTURAL: Users,
  TECHNICAL: Zap,
  CODE_REVIEW: GitPullRequest,
  PANEL: FileText,
};


export function StageConfigPanel({ stageId, onClose }: StageConfigPanelProps): JSX.Element {
  const { stage, isLoading, refetch } = useStageDetail(stageId);
  const { updateStage } = useStageMutations();
  const { createChallenge, deleteChallenge } = useChallengeMutations();
  const { triggerRefetch } = useStageRefetch();

  const [selectedType, setSelectedType] = useState<StageType | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Pending type change awaiting confirmation when existing challenges are present
  const [pendingType, setPendingType] = useState<StageType | null>(null);

  // Sync from server on load — only accept types we have config for
  useEffect(() => {
    if (stage && !initialized) {
      const raw = stage.stageType as string | null;
      const valid = raw && raw in STAGE_TYPE_CONFIGS ? (raw as StageType) : null;
      setSelectedType(valid);
      setInitialized(true);
    }
  }, [stage, initialized]);

  const commitSelectType = async (type: StageType): Promise<void> => {
    setSelectedType(type);
    setPendingType(null);
    const config = STAGE_TYPE_CONFIGS[type];
    try {
      await updateStage(stageId, {
        stageType: type,
        title: config.label,
      });
      await refetch();
      await triggerRefetch();
    } catch (err) {
      console.error('[StageConfigPanel] Failed to update stage type:', err);
    }
  };

  const handleSelectType = (type: StageType): void => {
    const existingCount = stage?.challenges?.length ?? 0;
    if (existingCount > 0 && type !== selectedType) {
      // Gate behind confirmation when challenges would be lost
      setPendingType(type);
    } else {
      void commitSelectType(type);
    }
  };

  const handleBack = (): void => {
    setSelectedType(null);
  };

  const handleAddChallenge = async (template: StagedItem): Promise<void> => {
    const count = stage?.challenges?.length ?? 0;
    try {
      await createChallenge(stageId, {
        type: template.type as 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER',
        title: template.title,
        instructions: template.instructions,
        config: template.config,
        order: count,
      });
      await refetch();
      await triggerRefetch();
    } catch (err) {
      console.error('[StageConfigPanel] Failed to add challenge:', err);
    }
  };

  if (isLoading) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Space Mono", monospace',
        fontSize: 9,
        color: 'var(--pipe-text-dim)',
        letterSpacing: '0.15em',
      }}>
        LOADING...
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '"Space Mono", monospace',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 20px 16px',
        borderBottom: '1px solid var(--pipe-border, rgba(255,255,255,0.06))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {selectedType && (
            <button
              onClick={handleBack}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--pipe-text-dim)',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <div>
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
            }}>
              {selectedType && STAGE_TYPE_CONFIGS[selectedType] ? STAGE_TYPE_CONFIGS[selectedType].label.toUpperCase() : 'STAGE_CONFIG'}
            </span>
            {stage && (
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--pipe-text)',
                marginTop: 4,
              }}>
                {stage.title}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      {selectedType ? (
        selectedType === 'SCREENING' ? (
          <ScreeningFormatPicker
            stageId={stageId}
            stage={stage}
            updateStage={updateStage}
            refetch={refetch}
            triggerRefetch={triggerRefetch}
            onAddChallenge={handleAddChallenge}
            existingCount={stage?.challenges?.length ?? 0}
            deleteChallenge={deleteChallenge}
          />
        ) : (
          <CodeReviewPicker
            key={stageId}
            stageId={stageId}
            existingCount={stage?.challenges?.length ?? 0}
            onAdded={async () => { await refetch(); await triggerRefetch(); }}
            onBack={onClose}
          />
        )
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {pendingType && (
            <StageTypeConfirmBanner
              pendingType={pendingType}
              challengeCount={stage?.challenges?.length ?? 0}
              onConfirm={() => void commitSelectType(pendingType)}
              onCancel={() => setPendingType(null)}
            />
          )}
          <TypeSelector onSelect={handleSelectType} currentType={(stage?.stageType as StageType | null) ?? null} pendingType={pendingType} />
          <StageConfigToggles
            stageId={stageId}
            stage={stage}
            updateStage={updateStage}
            refetch={refetch}
          />
        </div>
      )}
    </div>
  );
}

// ── Screening format picker ─────────────────────────────────────────────────

const SCREENING_FORMAT_OPTIONS: { format: ScreeningFormat; label: string; description: string; Icon: typeof Phone }[] = [
  { format: 'PHONE_CALL', label: 'PHONE CALL', description: 'Recruiter calls candidate via Twilio', Icon: PhoneCall },
  { format: 'VIDEO_CALL', label: 'VIDEO CALL', description: 'Live video screening meeting', Icon: Video },
  { format: 'ONLINE', label: 'ONLINE QUESTIONS', description: 'Candidate answers async screening questions', Icon: MonitorPlay },
];

function ScreeningFormatPicker({ stageId, stage, updateStage, refetch, triggerRefetch, onAddChallenge, existingCount, deleteChallenge }: {
  stageId: string;
  stage: ReturnType<typeof useStageDetail>['stage'];
  updateStage: ReturnType<typeof useStageMutations>['updateStage'];
  refetch: () => Promise<void>;
  triggerRefetch: () => Promise<void>;
  onAddChallenge: (template: StagedItem) => Promise<void>;
  existingCount: number;
  deleteChallenge: ReturnType<typeof useChallengeMutations>['deleteChallenge'];
}): JSX.Element {
  const [selectedFormat, setSelectedFormat] = useState<ScreeningFormat | null>(
    (stage?.screeningFormat as ScreeningFormat | null) ?? null,
  );
  const [pendingFormat, setPendingFormat] = useState<ScreeningFormat | null>(null);

  const commitSelectFormat = async (format: ScreeningFormat): Promise<void> => {
    setSelectedFormat(format);
    setPendingFormat(null);
    try {
      // Delete existing challenges when switching format
      const challenges = stage?.challenges ?? [];
      for (const c of challenges) {
        await deleteChallenge(c.id);
      }
      // Persist the screening format + auto-set mode and scheduling
      const modeForFormat = format === 'VIDEO_CALL' ? 'LIVE_VIDEO' as const : 'ASYNC' as const;
      const isScheduled = format !== 'ONLINE';
      await updateStage(stageId, {
        screeningFormat: format,
        mode: modeForFormat,
        isScheduled,
      });
      await refetch();
      await triggerRefetch();
    } catch (err) {
      console.error('[ScreeningFormatPicker] Failed to set format:', err);
      setSelectedFormat(null);
    }
  };

  const handleSelectFormat = (format: ScreeningFormat): void => {
    const currentFormat = stage?.screeningFormat as ScreeningFormat | null;
    const hasExisting = (stage?.challenges?.length ?? 0) > 0;
    if (hasExisting && format !== currentFormat) {
      setPendingFormat(format);
    } else {
      void commitSelectFormat(format);
    }
  };

  const handleBack = (): void => {
    setSelectedFormat(null);
  };

  // ── No format selected → show format picker ─────────────────────────────
  if (!selectedFormat) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={labelStyle}>SCREENING_FORMAT</label>
        {pendingFormat && (
          <div style={{
            padding: '12px 14px',
            background: 'rgba(251,191,36,0.06)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
              <AlertCircle size={12} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
              <span style={{
                fontFamily: '"Space Mono", monospace',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: '#fbbf24',
                lineHeight: 1.5,
              }}>
                Changing format will delete {stage?.challenges?.length ?? 0} existing challenge{(stage?.challenges?.length ?? 0) !== 1 ? 's' : ''}. Continue?
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => void commitSelectFormat(pendingFormat)}
                style={{
                  padding: '5px 12px',
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
                  padding: '5px 12px',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SCREENING_FORMAT_OPTIONS.map(({ format, label, description, Icon }) => {
            const isPending = pendingFormat === format;
            const isCurrent = (stage?.screeningFormat as ScreeningFormat | null) === format;
            return (
              <button
                key={format}
                onClick={() => handleSelectFormat(format)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontFamily: '"Space Mono", monospace',
                  background: isPending ? 'rgba(251,191,36,0.08)' : isCurrent ? 'var(--pipe-accent-surface)' : 'var(--pipe-surface)',
                  border: isPending ? '1px solid rgba(251,191,36,0.3)' : isCurrent ? '1px solid var(--pipe-accent-border)' : '1px solid var(--pipe-border)',
                  borderRadius: 4,
                  color: isPending ? '#fbbf24' : isCurrent ? 'var(--pipe-accent)' : 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'left',
                }}
              >
                <Icon size={16} />
                <div>
                  <div>{label}</div>
                  <div style={{
                    fontSize: 8,
                    fontWeight: 400,
                    letterSpacing: '0.05em',
                    opacity: 0.7,
                    marginTop: 2,
                  }}>
                    {description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Format selected → show format-specific config ───────────────────────
  if (selectedFormat === 'ONLINE') {
    return (
      <ScreeningQuestionPicker
        onAdd={onAddChallenge}
        existingCount={existingCount}
        onBack={handleBack}
      />
    );
  }

  // PHONE_CALL or VIDEO_CALL → scheduling + email config
  return (
    <ScreeningCallConfig
      format={selectedFormat}
      stageId={stageId}
      stage={stage}
      updateStage={updateStage}
      refetch={refetch}
      triggerRefetch={triggerRefetch}
      onBack={handleBack}
    />
  );
}

// ── Screening call config (phone/video) ─────────────────────────────────────

function ScreeningCallConfig({ format, stageId, stage, updateStage, refetch, triggerRefetch, onBack }: {
  format: 'PHONE_CALL' | 'VIDEO_CALL';
  stageId: string;
  stage: ReturnType<typeof useStageDetail>['stage'];
  updateStage: ReturnType<typeof useStageMutations>['updateStage'];
  refetch: () => Promise<void>;
  triggerRefetch: () => Promise<void>;
  onBack: () => void;
}): JSX.Element {
  const [isScheduled, setIsScheduled] = useState(stage?.isScheduled ?? true);

  const handleToggleScheduling = async (value: boolean): Promise<void> => {
    setIsScheduled(value);
    try {
      await updateStage(stageId, { isScheduled: value });
      await refetch();
      await triggerRefetch();
    } catch (err) {
      console.error('[ScreeningCallConfig] Failed to toggle scheduling:', err);
      setIsScheduled(!value);
    }
  };

  const isPhone = format === 'PHONE_CALL';

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Back button */}
      <div style={{ padding: '12px 20px 0' }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
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
          {isPhone ? 'PHONE CALL' : 'VIDEO CALL'}
        </button>
      </div>

      <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Format summary */}
        <div style={{
          padding: 16,
          background: isPhone ? 'rgba(96,165,250,0.06)' : 'var(--pipe-accent-surface)',
          border: `1px solid ${isPhone ? 'rgba(96,165,250,0.15)' : 'var(--pipe-accent-surface)'}`,
          borderRadius: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {isPhone ? <PhoneCall size={14} color="#60a5fa" /> : <Video size={14} color="var(--pipe-accent)" />}
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: isPhone ? '#60a5fa' : 'var(--pipe-accent)',
            }}>
              {isPhone ? 'PHONE_SCREENING' : 'VIDEO_SCREENING'}
            </span>
          </div>
          <p style={{
            fontSize: 10,
            lineHeight: 1.6,
            color: 'var(--pipe-text-muted)',
            margin: 0,
          }}>
            {isPhone
              ? 'Recruiter calls the candidate through the app. The call is recorded and transcribed automatically.'
              : 'Schedule a live video meeting. The recruiter and candidate join a video room in the browser.'}
          </p>
        </div>

        {/* Scheduling toggle */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={12} style={{ color: 'var(--pipe-text-dim)' }} />
              <span style={{ ...labelStyle, marginBottom: 0 }}>SCHEDULING_LINK</span>
            </div>
            <ToggleSwitch value={isScheduled} onChange={(v) => void handleToggleScheduling(v)} />
          </div>
          <div style={{ marginTop: 4, fontSize: 8, color: 'var(--pipe-text-dim)', opacity: 0.6, letterSpacing: '0.05em' }}>
            Candidate receives a link to book a time slot
          </div>
        </div>

        {/* Call flow steps */}
        <div>
          <label style={labelStyle}>
            {isPhone ? 'CALL_FLOW' : 'MEETING_FLOW'}
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(isPhone ? [
              { icon: Mail, text: 'Send invitation email to candidate' },
              { icon: Calendar, text: isScheduled ? 'Candidate books a time slot' : 'Recruiter initiates call directly' },
              { icon: PhoneCall, text: 'Call through the app — recorded + transcribed' },
              { icon: Clock, text: 'Review transcript and notes' },
              { icon: CheckCircle2, text: 'Advance candidate to next stage or reject' },
            ] : [
              { icon: Mail, text: 'Send invitation email to candidate' },
              { icon: Calendar, text: isScheduled ? 'Candidate books a time slot' : 'Share meeting link directly' },
              { icon: Video, text: 'Live video meeting in browser' },
              { icon: CheckCircle2, text: 'Advance candidate to next stage or reject' },
            ]).map((step, i) => {
              const StepIcon = step.icon;
              return (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 4,
                }}>
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <StepIcon size={10} color="var(--pipe-text-dim)" />
                  </div>
                  <span style={{
                    fontSize: 9,
                    color: 'var(--pipe-text-muted)',
                    letterSpacing: '0.03em',
                  }}>
                    {step.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Screening question picker (online format) ───────────────────────────────

function ScreeningQuestionPicker({ onAdd, existingCount, onBack }: {
  onAdd: (template: StagedItem) => Promise<void>;
  existingCount: number;
  onBack: () => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<ScreeningCategory | null>('background');

  const filtered = useMemo(() => {
    if (!search.trim()) return SCREENING_QUESTIONS;
    const q = search.toLowerCase();
    return SCREENING_QUESTIONS.filter(
      (sq) =>
        sq.text.toLowerCase().includes(q) ||
        sq.purpose.toLowerCase().includes(q) ||
        sq.category.includes(q),
    );
  }, [search]);

  const groupedFiltered = useMemo(() => {
    const groups = new Map<ScreeningCategory, ScreeningQuestionTemplate[]>();
    for (const q of filtered) {
      const list = groups.get(q.category) ?? [];
      list.push(q);
      groups.set(q.category, list);
    }
    return groups;
  }, [filtered]);

  const handleAddQuestion = async (sq: ScreeningQuestionTemplate): Promise<void> => {
    // Convert screening question to a QUIZ_SHORT_ANSWER challenge
    const instructions = sq.text + (sq.followUps?.length ? '\n\nFollow-up prompts:\n' + sq.followUps.map((f) => `- ${f}`).join('\n') : '');
    const template: StagedItem = {
      type: 'QUIZ_SHORT_ANSWER',
      title: sq.text,
      instructions,
      config: { inputMode: 'text' as const, question: sq.text, placeholder: 'Type your answer...' },
    };
    await onAdd(template);
  };

  const categories = Object.entries(SCREENING_CATEGORIES) as [ScreeningCategory, { label: string; description: string }][];

  return (
    <>
      {/* Back + search */}
      <div style={{ padding: '12px 20px 0' }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
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
          ONLINE QUESTIONS
        </button>
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
            placeholder="Search screening questions..."
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
            }}
          />
        </div>
      </div>

      {/* Category groups */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {categories.map(([catKey, catInfo]) => {
          const questions = groupedFiltered.get(catKey);
          if (!questions || questions.length === 0) return null;
          const isExpanded = expandedCategory === catKey || search.trim().length > 0;
          return (
            <div key={catKey}>
              <button
                onClick={() => setExpandedCategory(isExpanded && !search.trim() ? null : catKey)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '6px 0',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                <div>
                  <div style={{
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: '0.15em',
                    color: 'var(--pipe-text-dim)',
                  }}>
                    {catInfo.label.toUpperCase()}
                  </div>
                  <div style={{
                    fontSize: 8,
                    color: 'var(--pipe-text-dim)',
                    opacity: 0.5,
                    marginTop: 2,
                    textAlign: 'left',
                  }}>
                    {catInfo.description}
                  </div>
                </div>
                <span style={{
                  fontSize: 8,
                  color: 'var(--pipe-text-dim)',
                  opacity: 0.4,
                }}>
                  {questions.length}
                </span>
              </button>
              {isExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  {questions.map((sq) => (
                    <button
                      key={sq.id}
                      onClick={() => void handleAddQuestion(sq)}
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
                        transition: 'all 0.15s',
                        fontFamily: '"Space Mono", monospace',
                      }}
                    >
                      <div style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'var(--pipe-text)',
                        lineHeight: 1.4,
                      }}>
                        {sq.text}
                      </div>
                      <div style={{
                        fontSize: 8,
                        color: 'var(--pipe-text-dim)',
                        opacity: 0.6,
                        lineHeight: 1.4,
                      }}>
                        {sq.purpose}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--pipe-border)',
        fontSize: 8,
        color: 'var(--pipe-text-dim)',
        letterSpacing: '0.1em',
        textAlign: 'center',
      }}>
        {filtered.length} QUESTIONS — {existingCount} ADDED
      </div>
    </>
  );
}

// ── Step 1: Type selector ───────────────────────────────────────────────────

// ── Stage type change confirmation banner ───────────────────────────────────

function StageTypeConfirmBanner({ pendingType, challengeCount, onConfirm, onCancel }: {
  pendingType: StageType;
  challengeCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const config = STAGE_TYPE_CONFIGS[pendingType];
  return (
    <div style={{
      margin: '12px 16px 0',
      padding: '12px 14px',
      background: 'rgba(251,191,36,0.06)',
      border: '1px solid rgba(251,191,36,0.25)',
      borderRadius: 4,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        marginBottom: 10,
      }}>
        <AlertCircle size={12} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
        <span style={{
          fontFamily: '"Space Mono", monospace',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: '#fbbf24',
          lineHeight: 1.5,
        }}>
          Changing to {config.label.toUpperCase()} will remove {challengeCount} existing challenge{challengeCount !== 1 ? 's' : ''}. Continue?
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onConfirm}
          style={{
            padding: '5px 12px',
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
          onClick={onCancel}
          style={{
            padding: '5px 12px',
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
  );
}

function TypeSelector({ onSelect, currentType, pendingType }: {
  onSelect: (type: StageType) => void;
  currentType: StageType | null;
  pendingType: StageType | null;
}): JSX.Element {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <label style={labelStyle}>STAGE_TYPE</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {STAGE_TYPES.map((key) => {
            const config = STAGE_TYPE_CONFIGS[key];
            const Icon = STAGE_TYPE_ICONS[key];
            const isActive = currentType === key;
            const isPending = pendingType === key;
            return (
              <button
                key={key}
                onClick={() => onSelect(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontFamily: '"Space Mono", monospace',
                  background: isPending ? 'rgba(251,191,36,0.08)' : isActive ? 'var(--pipe-accent-surface)' : 'var(--pipe-surface)',
                  border: isPending ? '1px solid rgba(251,191,36,0.3)' : isActive ? '1px solid var(--pipe-accent-border)' : '1px solid var(--pipe-border)',
                  borderRadius: 4,
                  color: isPending ? '#fbbf24' : isActive ? 'var(--pipe-accent)' : 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'left',
                }}
              >
                <Icon size={14} />
                <div>
                  <div>{config.label.toUpperCase()}</div>
                  <div style={{
                    fontSize: 8,
                    fontWeight: 400,
                    letterSpacing: '0.05em',
                    opacity: 0.7,
                    marginTop: 2,
                  }}>
                    {config.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Stage config toggles (scheduling + video) ──────────────────────────────

function StageConfigToggles({ stageId, stage, updateStage, refetch }: {
  stageId: string;
  stage: ReturnType<typeof useStageDetail>['stage'];
  updateStage: ReturnType<typeof useStageMutations>['updateStage'];
  refetch: () => Promise<void>;
}): JSX.Element {
  const { triggerRefetch } = useStageRefetch();
  const [isScheduled, setIsScheduled] = useState(stage?.isScheduled ?? false);
  const [isVideoMeeting, setIsVideoMeeting] = useState(stage?.mode === 'LIVE_VIDEO');

  const handleToggleScheduling = async (value: boolean): Promise<void> => {
    setIsScheduled(value);
    try {
      await updateStage(stageId, { isScheduled: value });
      await refetch();
      await triggerRefetch();
    } catch (err) {
      console.error('[StageConfigToggles] Failed to update scheduling:', err);
      setIsScheduled(!value);
    }
  };

  const handleToggleVideo = async (value: boolean): Promise<void> => {
    setIsVideoMeeting(value);
    try {
      await updateStage(stageId, { mode: value ? 'LIVE_VIDEO' : 'ASYNC' });
      await refetch();
      await triggerRefetch();
    } catch (err) {
      console.error('[StageConfigToggles] Failed to update video:', err);
      setIsVideoMeeting(!value);
    }
  };

  return (
    <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 16, borderBottom: '1px solid var(--pipe-border)' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={12} style={{ color: 'var(--pipe-text-dim)' }} />
            <span style={{ ...labelStyle, marginBottom: 0 }}>SCHEDULING_LINK</span>
          </div>
          <ToggleSwitch value={isScheduled} onChange={(v) => void handleToggleScheduling(v)} />
        </div>
        <div style={{ marginTop: 4, fontSize: 8, color: 'var(--pipe-text-dim)', opacity: 0.6, letterSpacing: '0.05em' }}>
          Candidates receive a scheduling link
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Video size={12} style={{ color: 'var(--pipe-text-dim)' }} />
            <span style={{ ...labelStyle, marginBottom: 0 }}>VIDEO_MEETING</span>
          </div>
          <ToggleSwitch value={isVideoMeeting} onChange={(v) => void handleToggleVideo(v)} />
        </div>
        <div style={{ marginTop: 4, fontSize: 8, color: 'var(--pipe-text-dim)', opacity: 0.6, letterSpacing: '0.05em' }}>
          This stage includes a live video meeting
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: value ? 'var(--pipe-accent)' : 'var(--pipe-surface)',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
      }}
    >
      <div style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#fff',
        position: 'absolute',
        top: 2,
        left: value ? 18 : 2,
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

// ── Step 2 (CODE_REVIEW): GitHub PR picker ──────────────────────────────────

interface PRSummary {
  number: number;
  title: string;
  description: string;
  author: string;
  avatar: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  labels: string[];
  baseBranch: string;
  featureBranch: string;
}

function isValidGitHubUrl(url: string): boolean {
  return url.startsWith('https://github.com/') && url.split('/').filter(Boolean).length >= 4;
}

const DEFAULT_REPOS = [
  'https://github.com/el-pipe-o/interview-monorepo',
  'https://github.com/el-pipe-o/slopify',
];
const SAVED_REPOS_KEY = 'pipe_saved_repos';

function CodeReviewPicker({ stageId, existingCount, onAdded, onBack }: {
  stageId: string;
  existingCount: number;
  onAdded: () => Promise<void>;
  onBack?: () => void;
}): JSX.Element {
  const { getToken } = useClerkAuth();
  const { createChallenge } = useChallengeMutations();

  const [repoUrl, setRepoUrl] = useState('');
  const [prs, setPrs] = useState<PRSummary[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [newRepoUrl, setNewRepoUrl] = useState('');

  const [savedRepos, setSavedRepos] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_REPOS_KEY);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      const merged = [...DEFAULT_REPOS];
      for (const r of parsed) {
        if (!merged.includes(r)) merged.push(r);
      }
      return merged;
    } catch {
      return [...DEFAULT_REPOS];
    }
  });

  useEffect(() => {
    try { localStorage.setItem(SAVED_REPOS_KEY, JSON.stringify(savedRepos)); } catch { /* */ }
  }, [savedRepos]);

  const fetchPRs = useCallback(async (url: string): Promise<void> => {
    if (!isValidGitHubUrl(url)) return;
    setRepoUrl(url);
    setIsFetching(true);
    setError(null);
    setPrs([]);
    try {
      const api = createApiClient({ getToken });
      const result = await api.get<{
        success: boolean;
        error?: string;
        data?: { prs: PRSummary[] };
      }>(`/api/v1/github/pulls?repoUrl=${encodeURIComponent(url.trim())}&state=open`);
      if (!result.success) {
        setError(result.error ?? 'Failed to fetch pull requests.');
        return;
      }
      const fetched = result.data?.prs ?? [];
      setPrs(fetched);
      if (fetched.length === 0) setError('No open pull requests found.');
    } catch (err) {
      console.error('[CodeReviewPicker] Failed to list PRs:', err);
      setError('Failed to fetch pull requests.');
    } finally {
      setIsFetching(false);
    }
  }, [getToken]);

  const handleAddPR = async (pr: PRSummary): Promise<void> => {
    try {
      const created = await createChallenge(stageId, {
        type: 'CODE_REVIEW',
        title: pr.title,
        instructions: pr.description,
        githubRepoUrl: repoUrl,
        githubPrNumber: pr.number,
        githubPrTitle: pr.title,
        githubPrDescription: pr.description,
        order: existingCount,
      });
      // Fire-and-forget: cache the diff
      void (async () => {
        try {
          const api = createApiClient({ getToken });
          await api.post('/api/v1/github/pr', {
            repoUrl,
            prNumber: pr.number,
            challengeId: created.id,
          });
        } catch { /* best effort */ }
      })();
      await onAdded();
    } catch (err) {
      console.error('[CodeReviewPicker] Failed to add PR:', err);
    }
  };

  const handleAddRepo = (): void => {
    const trimmed = newRepoUrl.trim();
    if (!isValidGitHubUrl(trimmed) || savedRepos.includes(trimmed)) return;
    setSavedRepos((prev) => [...prev, trimmed]);
    setNewRepoUrl('');
    setShowAddRepo(false);
    void fetchPRs(trimmed);
  };

  return (
    <>
      {/* Back button (when opened from within TECHNICAL) */}
      {onBack && (
        <div style={{ padding: '8px 20px 0' }}>
          <button
            onClick={onBack}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: 0, background: 'none', border: 'none',
              color: 'var(--pipe-text-dim)', cursor: 'pointer',
              fontSize: 8, fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.1em',
            }}
          >
            <ArrowLeft size={10} />
            BACK_TO_TEMPLATES
          </button>
        </div>
      )}
      {/* Repo selector */}
      <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={labelStyle}>SELECT_REPOSITORY</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {savedRepos.map((repo) => {
            const shortName = repo.replace('https://github.com/', '');
            const isActive = repoUrl === repo;
            return (
              <div key={repo} style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => void fetchPRs(repo)}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    fontFamily: '"Space Mono", monospace',
                    background: isActive ? 'rgba(96,165,250,0.12)' : 'transparent',
                    border: isActive ? '1px solid rgba(96,165,250,0.3)' : '1px solid var(--pipe-border)',
                    borderRadius: 4,
                    color: isActive ? '#60a5fa' : 'var(--pipe-text-dim)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {shortName}
                </button>
                {!DEFAULT_REPOS.includes(repo) && (
                  <button
                    onClick={() => setSavedRepos((prev) => prev.filter((r) => r !== repo))}
                    style={{
                      background: 'none',
                      border: '1px solid var(--pipe-border)',
                      borderRadius: 4,
                      color: 'var(--pipe-text-dim)',
                      cursor: 'pointer',
                      padding: '0 6px',
                      opacity: 0.5,
                    }}
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {showAddRepo ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              autoFocus
              type="text"
              value={newRepoUrl}
              onChange={(e) => setNewRepoUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddRepo(); if (e.key === 'Escape') setShowAddRepo(false); }}
              placeholder="https://github.com/owner/repo"
              style={{
                flex: 1,
                padding: '8px 10px',
                fontSize: 9,
                fontFamily: '"Space Mono", monospace',
                background: 'transparent',
                border: `1px solid ${isValidGitHubUrl(newRepoUrl) ? 'rgba(96,165,250,0.5)' : 'var(--pipe-border)'}`,
                borderRadius: 4,
                color: 'var(--pipe-text)',
                outline: 'none',
              }}
            />
            <button
              onClick={handleAddRepo}
              disabled={!isValidGitHubUrl(newRepoUrl)}
              style={{
                padding: '8px 12px',
                fontSize: 8,
                fontWeight: 700,
                fontFamily: '"Space Mono", monospace',
                background: isValidGitHubUrl(newRepoUrl) ? 'rgba(96,165,250,0.12)' : 'transparent',
                border: `1px solid ${isValidGitHubUrl(newRepoUrl) ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
                borderRadius: 4,
                color: isValidGitHubUrl(newRepoUrl) ? '#60a5fa' : 'var(--pipe-text-dim)',
                cursor: isValidGitHubUrl(newRepoUrl) ? 'pointer' : 'default',
                letterSpacing: '0.08em',
              }}
            >
              SAVE
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddRepo(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 10px',
              fontSize: 8,
              fontWeight: 700,
              fontFamily: '"Space Mono", monospace',
              background: 'transparent',
              border: '1px dashed var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              letterSpacing: '0.08em',
            }}
          >
            <Plus size={10} /> ADD_REPO
          </button>
        )}
      </div>

      {/* PR list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>
        {isFetching ? (
          <div style={{
            padding: 40,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            opacity: 0.6,
          }}>
            <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 9, fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
              FETCHING_PRS...
            </span>
          </div>
        ) : error ? (
          <div style={{
            padding: 16,
            display: 'flex',
            gap: 10,
            background: 'rgba(248,113,113,0.04)',
            border: '1px solid rgba(248,113,113,0.15)',
            borderRadius: 6,
          }}>
            <AlertCircle size={14} color="#f87171" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 9, color: '#f87171', fontFamily: '"Space Mono", monospace' }}>{error}</span>
          </div>
        ) : !repoUrl ? (
          <div style={{
            padding: 40,
            textAlign: 'center',
            opacity: 0.3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}>
            <GitPullRequest size={32} />
            <span style={{ fontSize: 9, fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
              SELECT_A_REPOSITORY
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {prs.map((pr) => (
              <button
                key={pr.number}
                onClick={() => void handleAddPR(pr)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '10px 12px',
                  background: 'transparent',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                <GitPullRequest size={12} style={{ color: '#60a5fa', flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)' }}>#{pr.number}</span>
                    {pr.draft && (
                      <span style={{
                        fontSize: 7,
                        padding: '1px 4px',
                        background: 'var(--pipe-surface)',
                        border: '1px solid var(--pipe-border)',
                        borderRadius: 2,
                        color: 'var(--pipe-text-dim)',
                      }}>
                        DRAFT
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--pipe-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {pr.title}
                  </div>
                  <div style={{
                    fontSize: 8,
                    color: 'var(--pipe-text-dim)',
                    marginTop: 3,
                    opacity: 0.6,
                  }}>
                    {pr.author} · {pr.featureBranch} → {pr.baseBranch}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--pipe-border)',
        fontSize: 8,
        color: 'var(--pipe-text-dim)',
        letterSpacing: '0.1em',
        textAlign: 'center',
      }}>
        {prs.length} PRS — {existingCount} ADDED
      </div>
    </>
  );
}

// ── Shared styles ───────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.15em',
  color: 'var(--pipe-text-dim)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 10,
};
