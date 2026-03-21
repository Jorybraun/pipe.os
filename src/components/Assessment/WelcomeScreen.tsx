import { ArrowRight, Code2, FileSearch, HelpCircle, MessageSquare } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { ChromeMeshGrid } from '../ChromeMeshGrid';

// ============================================================================
// Types
// ============================================================================

export type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';

export interface WelcomeScreenProps {
  pipelineName: string;
  stageName: string;
  challengeType: ChallengeType;
  onStart: () => void;
}

// ============================================================================
// Challenge type config
// ============================================================================

const CHALLENGE_CONFIG: Record<
  ChallengeType,
  { label: string; icon: JSX.Element; color: string; guidance: string }
> = {
  CODE_REVIEW: {
    label: 'CODE_REVIEW',
    icon: <FileSearch size={28} />,
    color: '#60a5fa',
    guidance:
      'Review this pull request as you would in the wild. Comment on style, logic, and functionality — and things that look good. There are no trick questions.',
  },
  CODE_IMPLEMENTATION: {
    label: 'CODE_IMPLEMENTATION',
    icon: <Code2 size={28} />,
    color: '#a78bfa',
    guidance:
      'Implement a function to the spec provided. You can run and test your code in the editor.',
  },
  QUIZ_MCQ: {
    label: 'QUIZ_MCQ',
    icon: <HelpCircle size={28} />,
    color: '#4ade80',
    guidance:
      "Answer the multiple-choice questions. There's no time limit unless stated.",
  },
  QUIZ_SHORT_ANSWER: {
    label: 'QUIZ_SHORT_ANSWER',
    icon: <MessageSquare size={28} />,
    color: '#fbbf24',
    guidance:
      'Written questions. There are no right or wrong answers — we want to understand how you think.',
  },
};

// ============================================================================
// Component
// ============================================================================

/**
 * WelcomeScreen — Shown before the candidate starts a challenge.
 *
 * Displays pipeline/stage context, challenge type guidance, and a
 * START_INTERVIEW button. The status update (INVITED → IN_PROGRESS)
 * is deferred until `onStart` is called.
 *
 * @example
 * ```tsx
 * <WelcomeScreen
 *   pipelineName="Senior Frontend Engineer"
 *   stageName="Technical Assessment"
 *   challengeType="CODE_REVIEW"
 *   onStart={handleStart}
 * />
 * ```
 */
export function WelcomeScreen({
  pipelineName,
  stageName,
  challengeType,
  onStart,
}: WelcomeScreenProps): JSX.Element {
  const cfg = CHALLENGE_CONFIG[challengeType];

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
      <ChromeMeshGrid />
      <LiquidMetalCard
        variant="chrome"
        style={{ maxWidth: 560, width: '100%', padding: 56, zIndex: 1 }}
      >
        {/* Header meta */}
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'rgba(255,255,255,0.3)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 32,
          }}
        >
          {pipelineName.toUpperCase()} · {stageName.toUpperCase()}
        </div>

        {/* Challenge type badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: `${cfg.color}14`,
            border: `1px solid ${cfg.color}40`,
            borderRadius: 4,
            color: cfg.color,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 32,
          }}
        >
          {cfg.icon}
          {cfg.label}
        </div>

        {/* Headline */}
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: '#fff',
            marginBottom: 16,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}
        >
          Ready to begin?
        </h1>

        {/* Guidance copy */}
        <p
          style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.5)',
            lineHeight: 1.7,
            fontFamily: '"Space Mono", monospace',
            marginBottom: 40,
          }}
        >
          {cfg.guidance}
        </p>

        {/* Separator */}
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            marginBottom: 32,
          }}
        />

        {/* Start button */}
        <button
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
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
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
