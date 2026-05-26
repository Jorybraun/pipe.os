/**
 * MatchConfigWizard — 5-step end-of-Role-Discovery wizard that captures the
 * ADR-039 four config axes + non-negotiable skills before the auto-build.
 *
 * Uses the existing <Wizard> primitive (src/components/ui/Wizard.tsx).
 * Visual language matches InterviewDepthModal.
 *
 * onComplete is called with a fully-validated MatchConfigOutput that the
 * caller POSTs to /api/v1/pipelines/auto-build.
 */

import { useMemo, useState, useEffect } from 'react';
import { Wizard, WizardStepContent, type WizardStep } from '../ui/Wizard';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MatchPhilosophy = 'tailored' | 'hybrid' | 'validate';
export type Tolerance = 'strict' | 'moderate' | 'lenient';
export type StageLinkage = 'shared-repo' | 'per-stage';

export interface MatchConfigOutput {
  match_philosophy: MatchPhilosophy;
  tolerance: Tolerance;
  stage_linkage: StageLinkage;
  automation_granularity: 'per-candidate'; // v1 fixed
  hybrid_mix_ratio: number | null;
  non_negotiable_skills: string[];
}

interface Option<T extends string> {
  value: T;
  label: string;
  hint: string;
}

const PHILOSOPHY_OPTIONS: Option<MatchPhilosophy>[] = [
  {
    value: 'tailored',
    label: 'Tailored',
    hint: 'Match the candidate to a repo that mirrors the role exactly. Best for narrow stacks.',
  },
  {
    value: 'hybrid',
    label: 'Hybrid (recommended)',
    hint: 'Balance role-fit and candidate-fit. Default ratio: 60% role / 40% candidate.',
  },
  {
    value: 'validate',
    label: 'Validate',
    hint: 'Use the same canonical repo for everyone. Easiest to compare candidates.',
  },
];

const TOLERANCE_OPTIONS: Option<Tolerance>[] = [
  { value: 'strict',   label: 'Strict',   hint: 'Reject anything outside the must-have stack.' },
  { value: 'moderate', label: 'Moderate', hint: 'Default. Mild deviations allowed when justified.' },
  { value: 'lenient',  label: 'Lenient',  hint: 'Accept transferable-skill matches.' },
];

const LINKAGE_OPTIONS: Option<StageLinkage>[] = [
  {
    value: 'shared-repo',
    label: 'Shared repo (recommended)',
    hint: 'Both stations use the same repo. Cheapest to onboard for the candidate.',
  },
  {
    value: 'per-stage',
    label: 'Sample across repos',
    hint: 'Each station picks its own repo. More breadth signal but higher candidate load.',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export interface MatchConfigWizardProps {
  /** Skills offered as non-negotiable candidates (typically persona.mustHaveSkills). */
  candidateSkills: string[];
  onComplete: (output: MatchConfigOutput) => void;
  onCancel?: () => void;
  initial?: Partial<MatchConfigOutput>;
  /** Called whenever any field changes — caller can persist for back-navigation resume. */
  onChange?: (draft: Partial<MatchConfigOutput>) => void;
}

export function MatchConfigWizard({
  candidateSkills,
  onComplete,
  onCancel,
  initial,
  onChange,
}: MatchConfigWizardProps): JSX.Element {
  const [philosophy, setPhilosophy] = useState<MatchPhilosophy | null>(
    initial?.match_philosophy ?? 'hybrid',
  );
  const [hybridRatio, setHybridRatio] = useState<number>(
    initial?.hybrid_mix_ratio ?? 0.6,
  );
  const [tolerance, setTolerance] = useState<Tolerance | null>(
    initial?.tolerance ?? 'moderate',
  );
  const [nonNegotiable, setNonNegotiable] = useState<string[]>(
    initial?.non_negotiable_skills ?? [],
  );
  const [skillsAcknowledged, setSkillsAcknowledged] = useState<boolean>(false);
  const [linkage, setLinkage] = useState<StageLinkage | null>(
    initial?.stage_linkage ?? 'shared-repo',
  );

  useEffect(() => {
    if (!onChange) return;
    onChange({
      ...(philosophy !== null ? { match_philosophy: philosophy } : {}),
      ...(tolerance !== null ? { tolerance } : {}),
      ...(linkage !== null ? { stage_linkage: linkage } : {}),
      hybrid_mix_ratio: hybridRatio,
      non_negotiable_skills: nonNegotiable,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [philosophy, tolerance, linkage, hybridRatio, nonNegotiable]);

  const steps: WizardStep[] = useMemo(
    () => [
      {
        id: 'philosophy',
        label: 'Philosophy',
        canAdvance: () => philosophy !== null,
      },
      {
        id: 'tolerance',
        label: 'Tolerance',
        canAdvance: () => tolerance !== null,
      },
      {
        id: 'non-negotiable',
        label: 'Non-negotiables',
        canAdvance: () => nonNegotiable.length > 0 || skillsAcknowledged,
      },
      {
        id: 'linkage',
        label: 'Repo linkage',
        canAdvance: () => linkage !== null,
      },
      {
        id: 'review',
        label: 'Review',
        requiresApproval: true,
      },
    ],
    [philosophy, tolerance, nonNegotiable, skillsAcknowledged, linkage],
  );

  const handleComplete = (): void => {
    if (!philosophy || !tolerance || !linkage) return;
    onComplete({
      match_philosophy: philosophy,
      tolerance,
      stage_linkage: linkage,
      automation_granularity: 'per-candidate',
      hybrid_mix_ratio: philosophy === 'hybrid' ? hybridRatio : null,
      non_negotiable_skills: nonNegotiable,
    });
  };

  const wrap = (children: JSX.Element): JSX.Element => (
    <div style={{ padding: '8px 4px 0', minHeight: 280 }}>{children}</div>
  );

  return (
    <Wizard
      steps={steps}
      onComplete={handleComplete}
      {...(onCancel ? { onCancel } : {})}
      data-testid="match-config-wizard"
    >
      <WizardStepContent stepId="philosophy">
        {wrap(
          <RadioBlock
            heading="Match philosophy"
            sub="How do we choose the repo we hand the candidate?"
            options={PHILOSOPHY_OPTIONS}
            value={philosophy}
            onChange={setPhilosophy}
            footer={
              philosophy === 'hybrid' ? (
                <HybridSlider value={hybridRatio} onChange={setHybridRatio} />
              ) : null
            }
          />,
        )}
      </WizardStepContent>

      <WizardStepContent stepId="tolerance">
        {wrap(
          <RadioBlock
            heading="Stack tolerance"
            sub="How strictly should we match the candidate's stack?"
            options={TOLERANCE_OPTIONS}
            value={tolerance}
            onChange={setTolerance}
          />,
        )}
      </WizardStepContent>

      <WizardStepContent stepId="non-negotiable">
        {wrap(
          <NonNegotiableStep
            candidateSkills={candidateSkills}
            value={nonNegotiable}
            onChange={setNonNegotiable}
            acknowledged={skillsAcknowledged}
            onAcknowledge={setSkillsAcknowledged}
          />,
        )}
      </WizardStepContent>

      <WizardStepContent stepId="linkage">
        {wrap(
          <RadioBlock
            heading="Per-stage repo linkage"
            sub="One repo across both stations, or pick one per station?"
            options={LINKAGE_OPTIONS}
            value={linkage}
            onChange={setLinkage}
          />,
        )}
      </WizardStepContent>

      <WizardStepContent stepId="review">
        {wrap(
          <ReviewSummary
            philosophy={philosophy}
            hybridRatio={hybridRatio}
            tolerance={tolerance}
            nonNegotiable={nonNegotiable}
            linkage={linkage}
          />,
        )}
      </WizardStepContent>
    </Wizard>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const SECTION_HEADING = {
  fontSize: 11,
  letterSpacing: '0.2em',
  color: 'var(--pipe-text-dim)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 6,
} as const;

const SECTION_SUB = {
  fontSize: 13,
  color: 'var(--pipe-text-muted)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 18,
} as const;

function RadioBlock<T extends string>({
  heading,
  sub,
  options,
  value,
  onChange,
  footer,
}: {
  heading: string;
  sub: string;
  options: Option<T>[];
  value: T | null;
  onChange: (v: T) => void;
  footer?: JSX.Element | null;
}): JSX.Element {
  return (
    <div>
      <div style={SECTION_HEADING}>{heading.toUpperCase()}</div>
      <div style={SECTION_SUB}>{sub}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              data-testid={`option-${opt.value}`}
              data-selected={selected ? 'true' : 'false'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 16px',
                background: selected ? 'var(--pipe-accent-surface)' : 'transparent',
                border: selected
                  ? '1px solid var(--pipe-accent-border)'
                  : '1px solid var(--pipe-border-light)',
                borderRadius: 6,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
            >
              <Bullet selected={selected} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    color: selected ? 'var(--pipe-text)' : 'var(--pipe-text-muted)',
                    fontFamily: '"Space Mono", monospace',
                    marginBottom: 4,
                  }}
                >
                  {opt.label}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--pipe-text-dim)',
                    fontFamily: '"Space Mono", monospace',
                    lineHeight: 1.5,
                  }}
                >
                  {opt.hint}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {footer ? <div style={{ marginTop: 18 }}>{footer}</div> : null}
    </div>
  );
}

function Bullet({ selected }: { selected: boolean }): JSX.Element {
  return (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        border: selected
          ? '1px solid rgba(74, 222, 128, 0.7)'
          : '1px solid var(--pipe-border)',
        background: selected ? 'rgba(74, 222, 128, 0.6)' : 'transparent',
        flexShrink: 0,
      }}
    />
  );
}

function HybridSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  const rolePct = Math.round(value * 100);
  const candPct = 100 - rolePct;
  return (
    <div
      style={{
        padding: 14,
        border: '1px solid var(--pipe-border-light)',
        borderRadius: 6,
        background: 'var(--pipe-surface)',
      }}
      data-testid="hybrid-mix-ratio"
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: 'var(--pipe-text-muted)',
          fontFamily: '"Space Mono", monospace',
          marginBottom: 8,
        }}
      >
        ROLE / CANDIDATE MIX — {rolePct}% role · {candPct}% candidate
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={rolePct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        style={{ width: '100%' }}
        aria-label="Hybrid mix ratio (role vs candidate)"
      />
    </div>
  );
}

function NonNegotiableStep({
  candidateSkills,
  value,
  onChange,
  acknowledged,
  onAcknowledge,
}: {
  candidateSkills: string[];
  value: string[];
  onChange: (v: string[]) => void;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
}): JSX.Element {
  const toggle = (skill: string): void => {
    if (value.includes(skill)) {
      onChange(value.filter((s) => s !== skill));
    } else {
      onChange([...value, skill]);
    }
  };

  if (candidateSkills.length === 0) {
    return (
      <div>
        <div style={SECTION_HEADING}>NON-NEGOTIABLE SKILLS</div>
        <div style={SECTION_SUB}>
          Role Discovery did not surface any must-have skills. We will fall back to soft skill
          matching. Re-run Discovery with deeper probing if you need stricter filtering.
        </div>
        <button
          type="button"
          onClick={() => onAcknowledge(true)}
          data-testid="acknowledge-no-skills"
          style={{
            padding: '10px 20px',
            background: acknowledged ? 'rgba(74, 222, 128, 0.08)' : 'transparent',
            border: acknowledged
              ? '1px solid rgba(74, 222, 128, 0.3)'
              : '1px solid var(--pipe-border)',
            color: acknowledged ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-muted)',
            fontSize: 10,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            cursor: 'pointer',
            borderRadius: 4,
          }}
        >
          {acknowledged ? 'ACKNOWLEDGED' : 'ACKNOWLEDGE & CONTINUE'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={SECTION_HEADING}>NON-NEGOTIABLE SKILLS</div>
      <div style={SECTION_SUB}>
        Pick the skills the candidate must demonstrate in the interview. Every selected skill must
        be exercised by at least one station.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {candidateSkills.map((skill) => {
          const selected = value.includes(skill);
          return (
            <button
              key={skill}
              type="button"
              onClick={() => toggle(skill)}
              data-testid={`skill-${skill}`}
              data-selected={selected ? 'true' : 'false'}
              style={{
                padding: '8px 14px',
                background: selected ? 'rgba(74, 222, 128, 0.1)' : 'transparent',
                border: selected
                  ? '1px solid rgba(74, 222, 128, 0.4)'
                  : '1px solid var(--pipe-border-light)',
                color: selected ? 'var(--pipe-accent)' : 'var(--pipe-text-muted)',
                fontSize: 11,
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              {skill}
            </button>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 16,
          fontSize: 10,
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
        }}
      >
        Selected {value.length} of {candidateSkills.length}
        {value.length === 0 ? (
          <button
            type="button"
            onClick={() => onAcknowledge(true)}
            data-testid="acknowledge-no-skills"
            style={{
              marginLeft: 12,
              padding: '4px 10px',
              background: acknowledged ? 'rgba(74, 222, 128, 0.08)' : 'transparent',
              border: acknowledged
                ? '1px solid rgba(74, 222, 128, 0.3)'
                : '1px solid var(--pipe-border)',
              color: acknowledged ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-muted)',
              fontSize: 9,
              letterSpacing: '0.08em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
              borderRadius: 3,
            }}
          >
            {acknowledged ? 'NONE NON-NEGOTIABLE' : 'OR — NONE ARE NON-NEGOTIABLE'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ReviewSummary({
  philosophy,
  hybridRatio,
  tolerance,
  nonNegotiable,
  linkage,
}: {
  philosophy: MatchPhilosophy | null;
  hybridRatio: number;
  tolerance: Tolerance | null;
  nonNegotiable: string[];
  linkage: StageLinkage | null;
}): JSX.Element {
  const Row = ({ label, value }: { label: string; value: string }): JSX.Element => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--pipe-border-light)' }}>
      <span style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
        {label.toUpperCase()}
      </span>
      <span style={{ fontSize: 11, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace' }}>
        {value}
      </span>
    </div>
  );

  return (
    <div>
      <div style={SECTION_HEADING}>REVIEW</div>
      <div style={SECTION_SUB}>
        We will build a 2-station interview anchored on a repo we match next.
      </div>
      <div data-testid="review-summary">
        <Row label="Philosophy" value={philosophy ?? '—'} />
        {philosophy === 'hybrid' && (
          <Row label="Mix ratio" value={`${Math.round(hybridRatio * 100)}% role / ${Math.round((1 - hybridRatio) * 100)}% candidate`} />
        )}
        <Row label="Tolerance" value={tolerance ?? '—'} />
        <Row
          label="Non-negotiable"
          value={nonNegotiable.length > 0 ? nonNegotiable.join(', ') : '(none)'}
        />
        <Row label="Repo linkage" value={linkage ?? '—'} />
        <Row label="Stations" value="CODE_REVIEW + CODE_IMPLEMENTATION" />
      </div>
    </div>
  );
}
