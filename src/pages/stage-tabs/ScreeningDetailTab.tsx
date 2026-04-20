/**
 * ScreeningDetailTab — default tab for SCREENING stages.
 *
 * Shows the screening format (phone/video/online questions) with
 * format-specific configuration and scheduling options.
 */

import { useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Phone,
  Video,
  FileText,
  Calendar,
  Clock,
  Users,
  Mail,
  CheckCircle2,
  Check,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { SectionCard } from '../../components';
import { useStageMutations } from '../../hooks/useStageMutations';
import type { StagePanelContext } from '../StagePanel';
import type { ScreeningFormat } from '../../lib/api/types';

const mono = '"Space Mono", monospace';

const FORMAT_OPTIONS: Array<{
  key: ScreeningFormat;
  label: string;
  description: string;
  detail: string;
  icon: typeof Phone;
  color: string;
}> = [
  {
    key: 'PHONE_CALL',
    label: 'Phone Screen',
    description: 'Recruiter calls the candidate',
    detail: 'Call is recorded and transcribed automatically. AI generates a summary and flags for follow-up.',
    icon: Phone,
    color: '#60a5fa',
  },
  {
    key: 'VIDEO_CALL',
    label: 'Video Call',
    description: 'Live video meeting in the browser',
    detail: 'Schedule a video room. Both parties join from the browser — no app download needed.',
    icon: Video,
    color: 'var(--pipe-accent)',
  },
  {
    key: 'ONLINE',
    label: 'Online Questions',
    description: 'Async screening questions',
    detail: 'Candidate answers screening questions at their own pace. Text, voice, or video response formats.',
    icon: FileText,
    color: '#fbbf24',
  },
];

export default function ScreeningDetailTab(): JSX.Element {
  const { stage, stageId, refetchStage } = useOutletContext<StagePanelContext>();
  const { updateStage } = useStageMutations();

  const currentFormat = stage.screeningFormat as ScreeningFormat | null;
  const isScheduled = stage.isScheduled ?? false;

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSelectFormat = useCallback(async (format: ScreeningFormat): Promise<void> => {
    setSaving(true);
    try {
      await updateStage(stageId, {
        screeningFormat: format,
        mode: format === 'ONLINE' ? 'ASYNC' : 'LIVE_VIDEO',
      });
      await refetchStage();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      console.error('[ScreeningDetailTab] Failed to update format:', err);
    } finally {
      setSaving(false);
    }
  }, [stageId, updateStage, refetchStage]);

  const handleToggleScheduling = useCallback(async (): Promise<void> => {
    try {
      await updateStage(stageId, { isScheduled: !isScheduled });
      await refetchStage();
    } catch (err) {
      console.error('[ScreeningDetailTab] Failed to toggle scheduling:', err);
    }
  }, [stageId, isScheduled, updateStage, refetchStage]);

  const activeOption = FORMAT_OPTIONS.find((o) => o.key === currentFormat);

  return (
    <div
      data-testid="stage-tab-content-screening-detail"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Hero — description + candidate flow */}
      <SectionCard
        label="SCREENING_STAGE"
        icon={<Phone size={16} color="var(--pipe-text-dim)" />}
        meta={activeOption ? activeOption.label.toUpperCase().replace(' ', '_') : 'NOT_CONFIGURED'}
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
            The first filter in your pipeline. Screening lets you quickly
            evaluate candidates before investing in deeper assessment stages.
            Choose between a live conversation (phone or video) or async
            online questions that candidates complete at their own pace.
          </p>

          {/* Candidate flow */}
          <div
            style={{
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              padding: '14px 0',
              borderTop: '1px solid var(--pipe-border-light)',
            }}
          >
            {(currentFormat === 'ONLINE'
              ? [
                  { label: 'INVITE_SENT', icon: Mail },
                  { label: 'OPENS_LINK', icon: FileText },
                  { label: 'ANSWERS', icon: FileText },
                  { label: 'COMPLETE', icon: CheckCircle2 },
                ]
              : [
                  { label: 'INVITE_SENT', icon: Mail },
                  { label: isScheduled ? 'BOOKS_SLOT' : 'YOU_INITIATE', icon: Calendar },
                  { label: currentFormat === 'PHONE_CALL' ? 'PHONE_CALL' : 'VIDEO_CALL', icon: currentFormat === 'PHONE_CALL' ? Phone : Video },
                  { label: 'TRANSCRIBED', icon: FileText },
                  { label: 'COMPLETE', icon: CheckCircle2 },
                ]
            ).map((step, i, arr) => (
              <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
                  <step.icon size={14} color={i === 0 ? (activeOption?.color ?? '#fbbf24') : 'var(--pipe-text-dim)'} />
                  <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.1em', color: i === 0 ? (activeOption?.color ?? '#fbbf24') : 'var(--pipe-text-dim)', fontFamily: mono, textAlign: 'center' }}>
                    {step.label}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <span style={{ color: 'var(--pipe-border)', fontSize: 10, flexShrink: 0 }}>›</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Format selection */}
      <SectionCard
        label="SCREENING_FORMAT"
        icon={<Users size={16} color="var(--pipe-text-dim)" />}
        meta={
          saved ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: '#4ade80', fontFamily: mono, letterSpacing: '0.1em', fontWeight: 700 }}>
              <Check size={10} /> SAVED
            </span>
          ) : undefined
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {FORMAT_OPTIONS.map((option) => {
            const isActive = currentFormat === option.key;
            return (
              <button
                key={option.key}
                onClick={() => void handleSelectFormat(option.key)}
                disabled={saving}
                style={{
                  padding: '18px 16px',
                  background: isActive ? `${option.color}08` : 'var(--pipe-surface)',
                  border: `1px solid ${isActive ? `${option.color}40` : 'var(--pipe-border)'}`,
                  borderRadius: 10,
                  cursor: saving ? 'wait' : 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                  position: 'relative',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = `${option.color}25`;
                    e.currentTarget.style.background = `${option.color}04`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = 'var(--pipe-border)';
                    e.currentTarget.style.background = 'var(--pipe-surface)';
                  }
                }}
              >
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: option.color,
                    }}
                  />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      background: `${option.color}${isActive ? '20' : '12'}`,
                      border: `1px solid ${option.color}${isActive ? '40' : '25'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <option.icon size={14} color={option.color} />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: isActive ? option.color : 'var(--pipe-text)',
                        fontFamily: mono,
                        letterSpacing: '0.05em',
                      }}
                    >
                      {option.label}
                    </div>
                    <div
                      style={{
                        fontSize: 8,
                        color: 'var(--pipe-text-dim)',
                        fontFamily: mono,
                      }}
                    >
                      {option.description}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--pipe-text-dim)',
                    fontFamily: mono,
                    lineHeight: 1.6,
                  }}
                >
                  {option.detail}
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Format-specific settings */}
      {activeOption && (
        <SectionCard
          label={`${activeOption.label.toUpperCase().replace(' ', '_')}_SETTINGS`}
          icon={<activeOption.icon size={16} color={activeOption.color} />}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(currentFormat === 'PHONE_CALL' || currentFormat === 'VIDEO_CALL') && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 16px',
                  borderRadius: 8,
                  background: isScheduled ? 'rgba(96,165,250,0.04)' : 'transparent',
                  border: `1px solid ${isScheduled ? 'rgba(96,165,250,0.12)' : 'var(--pipe-border-light)'}`,
                }}
              >
                <Calendar size={16} color={isScheduled ? '#60a5fa' : 'var(--pipe-text-dim)'} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: isScheduled ? 'var(--pipe-text)' : 'var(--pipe-text-muted)', fontFamily: mono, letterSpacing: '0.05em', marginBottom: 2 }}>
                    Candidate Self-Scheduling
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: mono, lineHeight: 1.5 }}>
                    Candidate books a time slot from your availability. Without this, you initiate the {currentFormat === 'PHONE_CALL' ? 'call' : 'meeting'} directly.
                  </div>
                </div>
                <button
                  onClick={() => void handleToggleScheduling()}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0 }}
                >
                  {isScheduled ? <ToggleRight size={24} color="#60a5fa" /> : <ToggleLeft size={24} color="var(--pipe-text-dim)" />}
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {currentFormat === 'PHONE_CALL' && (
                <>
                  <InfoCard icon={Phone} color="#60a5fa" label="RECORDING" text="Call auto-recorded and transcribed via AI" />
                  <InfoCard icon={Mail} color="#60a5fa" label="NOTIFICATION" text="Candidate receives invite email with time slot" />
                </>
              )}
              {currentFormat === 'VIDEO_CALL' && (
                <>
                  <InfoCard icon={Video} color="var(--pipe-accent)" label="VIDEO_ROOM" text="Browser-based, no app download required" />
                  <InfoCard icon={Mail} color="var(--pipe-accent)" label="NOTIFICATION" text="Candidate receives meeting link via email" />
                </>
              )}
              {currentFormat === 'ONLINE' && (
                <>
                  <InfoCard icon={Clock} color="#fbbf24" label="ASYNC" text="Candidate completes at their own pace" />
                  <InfoCard icon={FileText} color="#fbbf24" label="FORMATS" text="Text, voice, or video responses supported" />
                </>
              )}
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/** Small info card used in format-specific settings. */
function InfoCard({
  icon: Icon,
  color,
  label,
  text,
}: {
  icon: typeof Phone;
  color: string;
  label: string;
  text: string;
}): JSX.Element {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--pipe-surface)',
        border: '1px solid var(--pipe-border)',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon size={11} color={color} />
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: mono }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: mono, lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  );
}
