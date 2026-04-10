import {
  type ReactNode,
  type CSSProperties,
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { Check } from 'lucide-react';
import { LiquidMetalCard } from './LiquidMetalCard';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface WizardStep {
  /** Unique key for the step. */
  id: string;
  /** Display label (rendered uppercase). */
  label: string;
  /** Optional icon element (lucide-react recommended). */
  icon?: ReactNode;
  /**
   * Gate function — if provided, the step cannot advance until this
   * returns true. Called on every "Next" click.
   */
  canAdvance?: () => boolean;
  /**
   * If true, this step requires explicit approval before the user
   * can proceed. Shows an APPROVE button instead of NEXT.
   */
  requiresApproval?: boolean;
}

export interface WizardProps {
  /** Ordered step definitions. */
  steps: WizardStep[];
  /** The content for each step, keyed by step id. */
  children: ReactNode;
  /** Called when the user completes the final step. */
  onComplete?: () => void;
  /** Called when the user cancels / exits the wizard. */
  onCancel?: () => void;
  /** Optional data-testid for the wrapper. */
  'data-testid'?: string;
}

export interface WizardContextValue {
  /** Currently active step id. */
  activeStepId: string;
  /** Index of the active step (0-based). */
  activeIndex: number;
  /** Total number of steps. */
  totalSteps: number;
  /** Set of step ids that have been approved / completed. */
  completedSteps: ReadonlySet<string>;
  /** Navigate to the next step (respects canAdvance gate). */
  next: () => void;
  /** Navigate to the previous step. */
  back: () => void;
  /** Jump to a specific step (only allowed for completed steps or current). */
  goTo: (stepId: string) => void;
  /** Mark the current step as approved and advance. */
  approve: () => void;
  /** Whether the wizard is on the final step. */
  isLastStep: boolean;
  /** Whether the wizard is on the first step. */
  isFirstStep: boolean;
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const WizardContext = createContext<WizardContextValue | null>(null);

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used inside <Wizard>');
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/**
 * WizardStep — wraps a single step's content.
 * Only renders when its `stepId` matches the active step.
 */
export function WizardStepContent({
  stepId,
  children,
}: {
  stepId: string;
  children: ReactNode;
}): JSX.Element | null {
  const { activeStepId } = useWizard();
  if (activeStepId !== stepId) return null;
  return <>{children}</>;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const MONO: CSSProperties = {
  fontFamily: '"Space Mono", monospace',
};

const STEP_NODE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
  borderRadius: 8,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  ...MONO,
};

const CONNECTOR_LINE: CSSProperties = {
  flex: '1 1 0',
  height: 1,
  minWidth: 12,
  background: 'var(--pipe-border)',
};

const BTN_BASE: CSSProperties = {
  padding: '10px 24px',
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  ...MONO,
};

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function Wizard({
  steps,
  children,
  onComplete,
  onCancel,
  'data-testid': dataTestId,
}: WizardProps): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const activeStep = steps[activeIndex]!;

  const markComplete = useCallback(
    (stepId: string) => {
      setCompleted((prev) => {
        const next = new Set(prev);
        next.add(stepId);
        return next;
      });
    },
    [],
  );

  const next = useCallback(() => {
    const step = steps[activeIndex];
    if (!step) return;
    if (step.canAdvance && !step.canAdvance()) return;

    markComplete(step.id);

    if (activeIndex < steps.length - 1) {
      setActiveIndex(activeIndex + 1);
    } else {
      onComplete?.();
    }
  }, [activeIndex, steps, markComplete, onComplete]);

  const back = useCallback(() => {
    if (activeIndex > 0) setActiveIndex(activeIndex - 1);
  }, [activeIndex]);

  const goTo = useCallback(
    (stepId: string) => {
      const idx = steps.findIndex((s) => s.id === stepId);
      if (idx === -1) return;
      // Can only jump to completed steps or the current step
      if (idx <= activeIndex || completed.has(stepId)) {
        setActiveIndex(idx);
      }
    },
    [steps, activeIndex, completed],
  );

  const approve = useCallback(() => {
    next();
  }, [next]);

  const ctx = useMemo<WizardContextValue>(
    () => ({
      activeStepId: activeStep.id,
      activeIndex,
      totalSteps: steps.length,
      completedSteps: completed,
      next,
      back,
      goTo,
      approve,
      isLastStep: activeIndex === steps.length - 1,
      isFirstStep: activeIndex === 0,
    }),
    [activeStep.id, activeIndex, steps.length, completed, next, back, goTo, approve],
  );

  return (
    <WizardContext.Provider value={ctx}>
      <div data-testid={dataTestId} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Step indicator bar */}
        <WizardStepper steps={steps} activeIndex={activeIndex} completed={completed} goTo={goTo} />

        {/* Step content */}
        <div>{children}</div>

        {/* Navigation footer */}
        <WizardFooter
          step={activeStep}
          isFirst={activeIndex === 0}
          isLast={activeIndex === steps.length - 1}
          onBack={back}
          onNext={next}
          onApprove={approve}
          {...(onCancel ? { onCancel } : {})}
          {...(onComplete ? { onComplete } : {})}
        />
      </div>
    </WizardContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Stepper (horizontal step indicator)                                */
/* ------------------------------------------------------------------ */

function WizardStepper({
  steps,
  activeIndex,
  completed,
  goTo,
}: {
  steps: WizardStep[];
  activeIndex: number;
  completed: ReadonlySet<string>;
  goTo: (id: string) => void;
}): JSX.Element {
  return (
    <LiquidMetalCard variant="dark" style={{ padding: 0, borderRadius: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '16px 24px',
          gap: 4,
        }}
      >
        {steps.map((step, i) => {
          const isActive = i === activeIndex;
          const isDone = completed.has(step.id);
          const isClickable = i <= activeIndex || isDone;

          return (
            <StepNode
              key={step.id}
              step={step}
              index={i}
              isActive={isActive}
              isDone={isDone}
              isClickable={isClickable}
              isLast={i === steps.length - 1}
              onClick={() => isClickable && goTo(step.id)}
            />
          );
        })}
      </div>
    </LiquidMetalCard>
  );
}

function StepNode({
  step,
  index,
  isActive,
  isDone,
  isClickable,
  isLast,
  onClick,
}: {
  step: WizardStep;
  index: number;
  isActive: boolean;
  isDone: boolean;
  isClickable: boolean;
  isLast: boolean;
  onClick: () => void;
}): JSX.Element {
  const nodeColor = isActive
    ? 'var(--pipe-text)'
    : isDone
      ? 'rgba(74, 222, 128, 0.9)'
      : 'var(--pipe-text-dim)';

  const nodeBg = isActive
    ? 'var(--pipe-surface-hover)'
    : isDone
      ? 'rgba(74, 222, 128, 0.08)'
      : 'transparent';

  const nodeBorder = isActive
    ? '1px solid var(--pipe-text-dim)'
    : isDone
      ? '1px solid rgba(74, 222, 128, 0.2)'
      : '1px solid transparent';

  return (
    <>
      <button
        type="button"
        data-testid={`wizard-step-${step.id}`}
        onClick={onClick}
        style={{
          ...STEP_NODE,
          background: nodeBg,
          border: nodeBorder,
          color: nodeColor,
          cursor: isClickable ? 'pointer' : 'default',
          opacity: isClickable ? 1 : 0.4,
          flex: '0 0 auto',
        }}
      >
        {/* Number badge or check */}
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: isActive
              ? 'var(--pipe-surface)'
              : isDone
                ? 'rgba(74, 222, 128, 0.15)'
                : 'var(--pipe-surface)',
            border: `1px solid ${isActive ? 'var(--pipe-border)' : isDone ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 800,
            color: nodeColor,
            flexShrink: 0,
          }}
        >
          {isDone ? <Check size={12} /> : index + 1}
        </div>

        {/* Icon + label */}
        {step.icon && <span style={{ display: 'flex', opacity: isActive ? 1 : 0.6 }}>{step.icon}</span>}
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.15em',
            whiteSpace: 'nowrap',
          }}
        >
          {step.label.toUpperCase()}
        </span>
      </button>

      {/* Connector line */}
      {!isLast && (
        <div
          style={{
            ...CONNECTOR_LINE,
            background: isDone ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border)',
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Footer (Back / Next / Approve / Complete)                          */
/* ------------------------------------------------------------------ */

function WizardFooter({
  step,
  isFirst,
  isLast,
  onBack,
  onNext,
  onApprove,
  onCancel,
  onComplete,
}: {
  step: WizardStep;
  isFirst: boolean;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onApprove: () => void;
  onCancel?: () => void;
  onComplete?: () => void;
}): JSX.Element {
  const canProceed = step.canAdvance ? step.canAdvance() : true;
  const needsApproval = step.requiresApproval;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 8,
      }}
    >
      {/* Left side */}
      <div style={{ display: 'flex', gap: 8 }}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              ...BTN_BASE,
              background: 'transparent',
              color: 'var(--pipe-text-muted)',
            }}
          >
            CANCEL
          </button>
        )}
        {!isFirst && (
          <button
            type="button"
            data-testid="wizard-back"
            onClick={onBack}
            style={{
              ...BTN_BASE,
              background: 'transparent',
              color: 'var(--pipe-text-muted)',
            }}
          >
            BACK
          </button>
        )}
      </div>

      {/* Right side */}
      <div>
        {isLast ? (
          <button
            type="button"
            data-testid="wizard-complete"
            onClick={() => onComplete?.()}
            disabled={!canProceed}
            style={{
              ...BTN_BASE,
              background: canProceed ? 'rgba(74, 222, 128, 0.15)' : 'var(--pipe-surface)',
              borderColor: canProceed ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border)',
              color: canProceed ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-dim)',
              cursor: canProceed ? 'pointer' : 'not-allowed',
            }}
          >
            COMPLETE
          </button>
        ) : needsApproval ? (
          <button
            type="button"
            data-testid="wizard-approve"
            onClick={onApprove}
            disabled={!canProceed}
            style={{
              ...BTN_BASE,
              background: canProceed ? 'rgba(74, 222, 128, 0.15)' : 'var(--pipe-surface)',
              borderColor: canProceed ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border)',
              color: canProceed ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-dim)',
              cursor: canProceed ? 'pointer' : 'not-allowed',
            }}
          >
            APPROVE & CONTINUE
          </button>
        ) : (
          <button
            type="button"
            data-testid="wizard-next"
            onClick={onNext}
            disabled={!canProceed}
            style={{
              ...BTN_BASE,
              background: canProceed ? 'var(--pipe-surface-hover)' : 'var(--pipe-surface)',
              borderColor: canProceed ? 'var(--pipe-text-dim)' : 'var(--pipe-border)',
              color: canProceed ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
              cursor: canProceed ? 'pointer' : 'not-allowed',
            }}
          >
            NEXT
          </button>
        )}
      </div>
    </div>
  );
}
