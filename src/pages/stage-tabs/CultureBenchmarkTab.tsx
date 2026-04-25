/**
 * CultureBenchmarkTab — /pipeline/:id/stage/:stageId/benchmark.
 *
 * Lets the recruiter define the org culture benchmark: 5 sliders (1–5)
 * for the culture profile axes. This benchmark is what candidate responses
 * are compared against in the culture report.
 *
 * Persists to the stage's first AGENT_INTERVIEW challenge's server_config
 * via the existing challenge update API. If no AGENT_INTERVIEW challenge
 * exists yet, creates one.
 *
 * Implements BC-23: "Recruiter defines org culture benchmark FIRST;
 * candidate scored against it."
 */

import { useState, useCallback, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Save, RotateCcw, Check, Target } from 'lucide-react';
import { SectionCard } from '../../components';
import { useChallengeMutations } from '../../hooks/useChallengeMutations';
import type { StagePanelContext } from '../StagePanel';

const mono = '"Space Mono", monospace';

interface BenchmarkAxis {
  key: string;
  label: string;
  low: string;
  high: string;
  lowDetail: string;
  highDetail: string;
}

const AXES: BenchmarkAxis[] = [
  {
    key: 'autonomy',
    label: 'Autonomy',
    low: 'Structured',
    high: 'Self-directed',
    lowDetail: 'Clear tasks, explicit priorities, frequent check-ins',
    highDetail: 'Sets own direction, thrives with ambiguity',
  },
  {
    key: 'riskTolerance',
    label: 'Risk Tolerance',
    low: 'Conservative',
    high: 'Bold',
    lowDetail: 'Proven approaches, thorough validation first',
    highDetail: 'Moves fast, comfortable with uncertainty',
  },
  {
    key: 'workPace',
    label: 'Work Pace',
    low: 'Deliberate',
    high: 'Fast-moving',
    lowDetail: 'Careful, methodical, values quality over speed',
    highDetail: 'Ships quickly, iterates in production',
  },
  {
    key: 'collaborationStyle',
    label: 'Collaboration Style',
    low: 'Independent',
    high: 'Highly collaborative',
    lowDetail: 'Heads-down focus, async-first, minimal meetings',
    highDetail: 'Pair programs, frequent syncs, team-first',
  },
  {
    key: 'feedbackOrientation',
    label: 'Feedback Orientation',
    low: 'Diplomatic',
    high: 'Direct',
    lowDetail: 'Thoughtful framing, careful delivery',
    highDetail: 'Blunt, immediate, no sugar-coating',
  },
];

const DEFAULT_BENCHMARK: Record<string, number> = {
  autonomy: 3,
  riskTolerance: 3,
  workPace: 3,
  collaborationStyle: 3,
  feedbackOrientation: 3,
};

function SliderTrack({
  axis,
  value,
  onChange,
}: {
  axis: BenchmarkAxis;
  value: number;
  onChange: (val: number) => void;
}): JSX.Element {
  return (
    <div
      style={{
        padding: '20px 0',
        borderBottom: '1px solid var(--pipe-border-light)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 16,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--pipe-text)',
            fontFamily: mono,
            letterSpacing: '0.08em',
          }}
        >
          {axis.label}
        </span>
        <span
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: 'var(--pipe-text)',
            fontFamily: mono,
          }}
        >
          {value}
        </span>
      </div>

      {/* Slider */}
      <div style={{ padding: '0 4px' }}>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '100%',
            height: 6,
            appearance: 'none',
            WebkitAppearance: 'none',
            background: 'var(--pipe-border)',
            borderRadius: 3,
            outline: 'none',
            cursor: 'pointer',
            accentColor: '#60a5fa',
          }}
        />
        {/* Tick marks */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
            padding: '0 1px',
          }}
        >
          {[1, 2, 3, 4, 5].map((tick) => (
            <div
              key={tick}
              style={{
                width: 1,
                height: 6,
                background:
                  tick === value
                    ? '#60a5fa'
                    : 'var(--pipe-text-dim)',
                opacity: tick === value ? 1 : 0.3,
              }}
            />
          ))}
        </div>
      </div>

      {/* Labels */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 10,
          gap: 24,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color:
                value <= 2
                  ? '#60a5fa'
                  : 'var(--pipe-text-dim)',
              fontFamily: mono,
              marginBottom: 3,
            }}
          >
            {axis.low}
          </div>
          <div
            style={{
              fontSize: 9,
              color: 'var(--pipe-text-muted)',
              fontFamily: mono,
              lineHeight: 1.5,
            }}
          >
            {axis.lowDetail}
          </div>
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color:
                value >= 4
                  ? '#60a5fa'
                  : 'var(--pipe-text-dim)',
              fontFamily: mono,
              marginBottom: 3,
            }}
          >
            {axis.high}
          </div>
          <div
            style={{
              fontSize: 9,
              color: 'var(--pipe-text-muted)',
              fontFamily: mono,
              lineHeight: 1.5,
            }}
          >
            {axis.highDetail}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CultureBenchmarkTab(): JSX.Element {
  const { stage, stageId, refetchStage } =
    useOutletContext<StagePanelContext>();
  const { createChallenge } = useChallengeMutations();

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load existing benchmark from the AGENT_INTERVIEW challenge's config
  const agentChallenge = stage.challenges?.find(
    (c) => c.type === 'AGENT_INTERVIEW',
  );

  const existingBenchmark =
    agentChallenge?.config &&
    typeof agentChallenge.config === 'object' &&
    'orgBenchmark' in agentChallenge.config
      ? (agentChallenge.config as { orgBenchmark: Record<string, number> })
          .orgBenchmark
      : null;

  const [values, setValues] = useState<Record<string, number>>(
    existingBenchmark ?? { ...DEFAULT_BENCHMARK },
  );

  // Sync when stage data loads
  useEffect(() => {
    if (existingBenchmark) {
      setValues({ ...DEFAULT_BENCHMARK, ...existingBenchmark });
    }
  }, [agentChallenge?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback((key: string, val: number): void => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }, []);

  const handleReset = useCallback((): void => {
    setValues({ ...DEFAULT_BENCHMARK });
    setSaved(false);
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      if (agentChallenge) {
        // Update existing challenge config
        const resp = await fetch(`/api/v1/challenges/${agentChallenge.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: {
              ...(agentChallenge.config ?? {}),
              orgBenchmark: values,
            },
          }),
        });
        if (!resp.ok) throw new Error(`PATCH failed: ${resp.status}`);
      } else {
        // Create AGENT_INTERVIEW challenge with benchmark
        await createChallenge(stageId, {
          type: 'AGENT_INTERVIEW',
          title: 'Culture Interview',
          instructions: 'AI-conducted behavioral interview',
          config: { orgBenchmark: values },
        });
      }
      await refetchStage();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[CultureBenchmarkTab] Failed to save benchmark:', err);
    } finally {
      setSaving(false);
    }
  }, [agentChallenge, values, stageId, createChallenge, refetchStage]);

  const isDirty =
    JSON.stringify(values) !==
    JSON.stringify(existingBenchmark ?? DEFAULT_BENCHMARK);

  return (
    <div data-testid="stage-tab-content-culture-benchmark">
      <SectionCard
        label="TEAM_BENCHMARK"
        icon={<Target size={16} color="var(--pipe-text-dim)" />}
        meta={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleReset}
              disabled={saving}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text-dim)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                fontFamily: mono,
                cursor: 'pointer',
              }}
            >
              <RotateCcw size={10} />
              RESET
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || (!isDirty && !saved)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                background: saved
                  ? 'rgba(74,222,128,0.12)'
                  : isDirty
                    ? 'var(--pipe-text)'
                    : 'var(--pipe-surface)',
                border: saved
                  ? '1px solid rgba(74,222,128,0.3)'
                  : isDirty
                    ? '1px solid var(--pipe-text)'
                    : '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: saved
                  ? '#4ade80'
                  : isDirty
                    ? 'var(--pipe-bg)'
                    : 'var(--pipe-text-dim)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                fontFamily: mono,
                cursor:
                  saving || (!isDirty && !saved) ? 'default' : 'pointer',
                opacity: saving || (!isDirty && !saved) ? 0.5 : 1,
                transition: 'all 0.2s ease',
              }}
            >
              {saved ? (
                <>
                  <Check size={10} />
                  SAVED
                </>
              ) : saving ? (
                'SAVING...'
              ) : (
                <>
                  <Save size={10} />
                  SAVE_BENCHMARK
                </>
              )}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 11,
              lineHeight: 1.6,
              color: 'var(--pipe-text-muted)',
              fontFamily: mono,
            }}
          >
            Define where your team sits on each axis. Candidate responses will
            be compared against these positions. A divergence of 2 or more on
            any axis is flagged in the report — not penalized, just surfaced for
            your attention.
          </p>
          <p
            style={{
              margin: '0 0 20px',
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              fontFamily: mono,
            }}
          >
            There are no right answers. A team that values structure (autonomy=1)
            is not worse than one that values independence (autonomy=5).
          </p>

          {AXES.map((axis) => (
            <SliderTrack
              key={axis.key}
              axis={axis}
              value={values[axis.key] ?? 3}
              onChange={(val) => handleChange(axis.key, val)}
            />
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
