import {
  ArrowRight,
  Clock,
  Code2,
  FileSearch,
  HelpCircle,
  MessageSquare,
  Mic,
  Video,
  Type,
  ListChecks,
  Info,
  AlertCircle,
} from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { AppBackground } from '../ui/AppBackground';

// ============================================================================
// Types
// ============================================================================

export interface WelcomeScreenChallenge {
  title: string;
  type: string;
  timeLimit?: number | null;
  data?: Record<string, unknown>;
}

export interface WelcomeScreenProps {
  pipelineName: string;
  stageName: string;
  challenges: WelcomeScreenChallenge[];
  onStart: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function getChallengeMeta(challenge: WelcomeScreenChallenge) {
  const { type, data } = challenge;

  switch (type) {
    case 'CODE_REVIEW':
      return {
        icon: <FileSearch size={14} />,
        label: 'Code Review',
        desc: 'Review a pull request and leave feedback',
      };
    case 'CODE_IMPLEMENTATION':
      return {
        icon: <Code2 size={14} />,
        label: 'Coding Exercise',
        desc: 'Implement a solution in the code editor',
      };
    case 'QUIZ_MCQ':
      return {
        icon: <ListChecks size={14} />,
        label: 'Multiple Choice',
        desc: 'Select the best answer for each question',
      };
    case 'QUIZ_SHORT_ANSWER': {
      const mode = (data?.inputMode as string) ?? 'text';
      if (mode === 'voice') {
        return {
          icon: <Mic size={14} />,
          label: 'Voice Response',
          desc: 'Record your answer using your microphone',
        };
      }
      if (mode === 'video') {
        return {
          icon: <Video size={14} />,
          label: 'Video Response',
          desc: 'Record a video response to the prompt',
        };
      }
      return {
        icon: <Type size={14} />,
        label: 'Written Response',
        desc: 'Type your answer in the text box provided',
      };
    }
    case 'INTAKE':
      return {
        icon: <HelpCircle size={14} />,
        label: 'Intake Questions',
        desc: 'Answer a few questions about your background',
      };
    default:
      return {
        icon: <MessageSquare size={14} />,
        label: type.replace(/_/g, ' '),
        desc: 'Complete this part of the assessment',
      };
  }
}

function getRequirements(challenges: WelcomeScreenChallenge[]): string[] {
  const reqs = new Set<string>();
  for (const c of challenges) {
    if (c.type === 'CODE_REVIEW' || c.type === 'CODE_IMPLEMENTATION') {
      reqs.add('A modern web browser');
    }
    if (c.type === 'QUIZ_SHORT_ANSWER') {
      const mode = (c.data?.inputMode as string) ?? 'text';
      if (mode === 'voice') reqs.add('A working microphone');
      if (mode === 'video') {
        reqs.add('A working camera');
        reqs.add('A working microphone');
      }
    }
    if (c.type === 'LIVE_VIDEO') {
      reqs.add('A working camera');
      reqs.add('A working microphone');
    }
  }
  return Array.from(reqs);
}

function totalDuration(challenges: WelcomeScreenChallenge[]): number {
  return challenges.reduce((sum, c) => sum + (c.timeLimit ?? 0), 0);
}

// ============================================================================
// Component
// ============================================================================

/**
 * WelcomeScreen — Shown before the candidate starts a challenge.
 *
 * Displays pipeline/stage context, a preview of upcoming challenges,
 * time estimates, and equipment requirements. Replaces the old
 * challenge-type badge with human-readable process information.
 *
 * @example
 * ```tsx
 * <WelcomeScreen
 *   pipelineName="Senior Frontend Engineer"
 *   stageName="Technical Assessment"
 *   challenges={[{ title: 'React Patterns', type: 'QUIZ_MCQ', timeLimit: 15 }]}
 *   onStart={handleStart}
 * />
 * ```
 */
export function WelcomeScreen({
  pipelineName,
  stageName,
  challenges,
  onStart,
}: WelcomeScreenProps): JSX.Element {
  const realChallenges = challenges.filter(
    (c) => c.type !== 'WELCOME' && c.type !== 'LIVE_VIDEO',
  );
  const reqs = getRequirements(realChallenges);
  const totalTime = totalDuration(realChallenges);
  const challengeCount = realChallenges.length;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0c0c0e',
        padding: 24,
      }}
    >
      <AppBackground />
      <LiquidMetalCard
        variant="chrome"
        style={{ maxWidth: 620, width: '100%', padding: 48, zIndex: 1 }}
      >
        {/* Header meta */}
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 28,
          }}
        >
          {pipelineName.toUpperCase()} · {stageName.toUpperCase()}
        </div>

        {/* Headline */}
        <h1
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: 'var(--pipe-text, #fff)',
            marginBottom: 12,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}
        >
          Ready to begin?
        </h1>

        {/* Process explanation */}
        <p
          style={{
            fontSize: 13,
            color: 'var(--pipe-text-muted)',
            lineHeight: 1.7,
            fontFamily: '"Space Mono", monospace',
            marginBottom: 32,
          }}
        >
          This stage consists of {challengeCount}{' '}
          {challengeCount === 1 ? 'part' : 'parts'}. Work through each one at
          your own pace — your progress is saved as you go. There are no trick
          questions; we want to see how you think.
        </p>

        {/* Challenge list */}
        {realChallenges.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                fontSize: 8,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                fontWeight: 700,
                marginBottom: 14,
              }}
            >
              WHAT TO EXPECT
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {realChallenges.map((c, i) => {
                const meta = getChallengeMeta(c);
                return (
                  <div
                    key={c.title + i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '14px 16px',
                      background: 'var(--pipe-surface)',
                      border: '1px solid var(--pipe-border-light)',
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 4,
                        background: 'var(--pipe-surface-hover)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--pipe-text-muted)',
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {meta.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--pipe-text, #fff)',
                          marginBottom: 2,
                          lineHeight: 1.4,
                        }}
                      >
                        {c.title}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: 'var(--pipe-text-muted)',
                          fontFamily: '"Space Mono", monospace',
                          lineHeight: 1.5,
                        }}
                      >
                        {meta.label} · {meta.desc}
                      </div>
                    </div>
                    {c.timeLimit ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 9,
                          color: 'var(--pipe-text-dim)',
                          fontFamily: '"Space Mono", monospace',
                          flexShrink: 0,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <Clock size={10} />
                        {formatDuration(c.timeLimit)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {totalTime > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 12,
                  fontSize: 10,
                  color: 'var(--pipe-text-muted)',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                <Clock size={12} />
                Estimated total time: {formatDuration(totalTime)}
              </div>
            )}
          </div>
        )}

        {/* Requirements */}
        {reqs.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '12px 14px',
              background: 'rgba(251, 191, 36, 0.06)',
              border: '1px solid rgba(251, 191, 36, 0.15)',
              borderRadius: 6,
              marginBottom: 28,
            }}
          >
            <AlertCircle
              size={14}
              style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }}
            />
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fbbf24',
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.08em',
                  marginBottom: 4,
                }}
              >
                BEFORE YOU START
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 14,
                  fontSize: 11,
                  color: 'var(--pipe-text-muted)',
                  lineHeight: 1.6,
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                {reqs.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Tips */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 14px',
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border-light)',
            borderRadius: 6,
            marginBottom: 32,
          }}
        >
          <Info
            size={14}
            style={{ color: 'var(--pipe-text-dim)', flexShrink: 0, marginTop: 2 }}
          />
          <div
            style={{
              fontSize: 11,
              color: 'var(--pipe-text-muted)',
              lineHeight: 1.6,
              fontFamily: '"Space Mono", monospace',
            }}
          >
            Find a quiet place, read each prompt carefully, and take your time.
            You can pause between questions if you need a break.
          </div>
        </div>

        {/* Separator */}
        <div
          style={{
            borderTop: '1px solid var(--pipe-border)',
            marginBottom: 28,
          }}
        />

        {/* Start button */}
        <button
          data-testid="start-interview-btn"
          onClick={onStart}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '16px 24px',
            background: '#fff',
            color: '#000',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.12em',
            fontFamily: '"Space Mono", monospace',
            cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = '0.88';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = '1';
          }}
        >
          START_INTERVIEW
          <ArrowRight size={16} />
        </button>
      </LiquidMetalCard>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
      `}</style>
    </div>
  );
}
