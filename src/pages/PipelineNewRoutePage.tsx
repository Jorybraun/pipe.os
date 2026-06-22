import { type CSSProperties, type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/react';
import { CheckCircle2, Loader2, Play } from 'lucide-react';
import { createApiClient } from '../lib/api/client';

type StageChoice = {
  value: 'SCREENING' | 'CODE_REVIEW' | 'LIVE_CODING';
  label: string;
  description: string;
};

const STAGE_CHOICES: StageChoice[] = [
  {
    value: 'SCREENING',
    label: 'Screener',
    description: 'Source-backed role intake, baseline checks, and participant instructions.',
  },
  {
    value: 'CODE_REVIEW',
    label: 'Code Review',
    description: 'Ask each person to review implementation context and explain findings.',
  },
  {
    value: 'LIVE_CODING',
    label: 'Live Coding',
    description: 'Give the person a live implementation challenge.',
  },
];

interface MatchConfigResponse {
  pipeline: {
    id: string;
  };
  warnings?: Array<{ code: string; severity: 'warn'; message: string }>;
}

interface SimpleRoleContextResponse {
  id: string;
  selectedTerms: string[];
  baseline: {
    title: string;
  };
}

const LIGHT_BLUE = '#60a5fa';
const LIGHT_BLUE_BG = 'rgba(96, 165, 250, 0.2)';
const LIGHT_BLUE_BG_INACTIVE = 'rgba(96, 165, 250, 0.05)';
const LIGHT_BLUE_BORDER = 'rgba(96, 165, 250, 0.75)';
const LIGHT_BLUE_BORDER_INACTIVE = 'rgba(96, 165, 250, 0.25)';
const LIGHT_BLUE_TEXT = '#dbeafe';
const LIGHT_BLUE_DISABLED_BG = 'rgba(96, 165, 250, 0.22)';
const LIGHT_BLUE_DISABLED_TEXT = 'rgba(248, 251, 255, 0.55)';
const MIN_DESCRIPTION_LENGTH = 20;

export default function PipelineNewRoutePage(): JSX.Element {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const api = createApiClient({ getToken });

  const [roleTitle, setRoleTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [selectedStages, setSelectedStages] = useState<Array<StageChoice['value']>>([
    'SCREENING',
    'CODE_REVIEW',
    'LIVE_CODING',
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleStage = (value: StageChoice['value']): void => {
    setSelectedStages((prev) =>
      prev.includes(value)
        ? prev.filter((s) => s !== value)
        : [...prev, value],
    );
  };

  const roleTitleValue = roleTitle.trim();
  const companyValue = company.trim();
  const locationValue = location.trim();
  const roleDescriptionValue = roleDescription.trim();
  const canSubmit =
    roleTitleValue.length > 0 &&
    roleDescriptionValue.length >= MIN_DESCRIPTION_LENGTH &&
    selectedStages.length > 0 &&
    !isSubmitting;

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault();
    setError(null);

    if (!canSubmit) {
      if (roleTitleValue.length === 0) {
        setError('Role title is required.');
      } else if (roleDescriptionValue.length < MIN_DESCRIPTION_LENGTH) {
        setError(`Role description must be at least ${MIN_DESCRIPTION_LENGTH} characters.`);
      } else if (selectedStages.length === 0) {
        setError('Select at least one round.');
      }
      return;
    }

    setIsSubmitting(true);

    const jobDescriptionMd = [
      `## Role Title\n${roleTitleValue}`,
      ...(companyValue ? [`## Company\n${companyValue}`] : []),
      ...(locationValue ? [`## Location\n${locationValue}`] : []),
      `## Role Scope\n${roleDescriptionValue}`,
    ].join('\n\n');

    try {
      const roleContext = await api.post<SimpleRoleContextResponse>('/api/v1/role-contexts/simple-job-description', {
        jobDescriptionMd,
        title: roleTitleValue,
      });

      const matchRes = await api.post<MatchConfigResponse>('/api/v1/pipelines/auto-build', {
        role_context_id: roleContext.id,
        pipeline_title: roleTitleValue,
        match_config: {
          match_philosophy: 'tailored',
          tolerance: 'moderate',
          stage_linkage: 'shared-repo',
          automation_granularity: 'per-candidate',
          hybrid_mix_ratio: null,
          non_negotiable_skills: roleContext.selectedTerms,
        },
        selected_stages: selectedStages,
      });

      navigate(`/pipeline/${matchRes.pipeline.id}`, {
        state: matchRes.warnings && matchRes.warnings.length > 0
          ? { autoBuildWarnings: matchRes.warnings }
          : undefined,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not create role.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        minHeight: 0,
        height: 'calc(100dvh - 124px)',
        maxHeight: 'calc(100dvh - 124px)',
        padding: '16px 20px',
        background: 'transparent',
        color: 'rgba(244, 246, 250, 0.95)',
        overflow: 'hidden',
        boxSizing: 'border-box',
        margin: '0',
        width: '100%',
        display: 'flex',
        justifyContent: 'flex-start',
      }}
    >
      <div
        style={{
          maxWidth: 920,
          margin: '0',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 14,
          padding: 22,
          background: 'transparent',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.22em',
                color: 'rgba(244, 246, 250, 0.55)',
                marginBottom: 6,
                fontFamily: '"Space Mono", monospace',
              }}
            >
              PIPE OS
            </div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>
              New Role
            </h1>
            <p style={{ margin: '10px 0 0', fontSize: 13, color: 'rgba(244, 246, 250, 0.62)' }}>
              Paste a source-backed job description, then pick the interview rounds to run.
            </p>
          </div>
          <div style={{ opacity: canSubmit ? 1 : 0.5 }}>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                border: canSubmit ? `1px solid ${LIGHT_BLUE}` : `1px solid ${LIGHT_BLUE_BORDER}`,
                background: canSubmit ? LIGHT_BLUE : LIGHT_BLUE_DISABLED_BG,
                color: canSubmit ? '#f8fbff' : LIGHT_BLUE_DISABLED_TEXT,
                padding: '11px 18px',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.15em',
                fontFamily: '"Space Mono", monospace',
                borderRadius: 8,
                cursor: canSubmit ? 'pointer' : 'default',
              }}
            >
              {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              CREATE ROLE
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 28,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.1fr) minmax(280px, 1fr)',
            gap: 22,
            flex: '0 0 auto',
          }}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 10, letterSpacing: '0.18em', color: 'rgba(244, 246, 250, 0.55)' }}>
                ROLE_TITLE
              </span>
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="Senior Frontend Engineer"
                required
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 10, letterSpacing: '0.18em', color: 'rgba(244, 246, 250, 0.55)' }}>
                COMPANY
              </span>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Corp"
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 10, letterSpacing: '0.18em', color: 'rgba(244, 246, 250, 0.55)' }}>
                LOCATION
              </span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Remote / NYC / Berlin"
                style={inputStyle}
              />
            </label>
          </div>

          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.18em', color: 'rgba(244, 246, 250, 0.55)', marginBottom: 8 }}>
              ROUNDS
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              {STAGE_CHOICES.map((stage) => (
                <button
                  key={stage.value}
                  onClick={() => toggleStage(stage.value)}
                  type="button"
                  style={{
                    textAlign: 'left',
                    border: selectedStages.includes(stage.value)
                      ? `1px solid ${LIGHT_BLUE_BORDER}`
                      : `1px solid ${LIGHT_BLUE_BORDER_INACTIVE}`,
                    background: selectedStages.includes(stage.value) ? LIGHT_BLUE_BG : LIGHT_BLUE_BG_INACTIVE,
                    color: LIGHT_BLUE_TEXT,
                    padding: 14,
                    borderRadius: 10,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>{stage.label}</span>
                    {selectedStages.includes(stage.value) && <CheckCircle2 size={14} color={LIGHT_BLUE_TEXT} />}
                  </div>
                  <p style={{ margin: '8px 0 0', color: 'rgba(244, 246, 250, 0.72)', fontSize: 11, lineHeight: 1.4 }}>
                    {stage.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18, minHeight: 0, flex: '1 1 auto' }}>
          <span style={{ fontSize: 10, letterSpacing: '0.18em', color: 'rgba(244, 246, 250, 0.55)' }}>
            ROLE_DESCRIPTION (source-backed)
          </span>
          <textarea
            value={roleDescription}
            onChange={(e) => setRoleDescription(e.target.value)}
            rows={10}
            placeholder="Paste role expectations, constraints, and technical requirements."
            required
            minLength={MIN_DESCRIPTION_LENGTH}
            style={{
              ...inputStyle,
              width: '100%',
              minHeight: 0,
              flex: '1 1 auto',
              resize: 'none',
              lineHeight: 1.5,
              padding: 14,
            }}
          />
          <span style={{ fontSize: 10, color: roleDescription.trim().length >= 20 ? '#f4f6fa' : '#fca5a5' }}>
            {roleDescriptionValue.length} / {MIN_DESCRIPTION_LENGTH} chars
          </span>
        </label>

        {error ? (
          <div
            style={{
              marginTop: 16,
              border: '1px solid rgba(252,165,165,0.35)',
              background: 'rgba(252,165,165,0.1)',
              color: '#fecaca',
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </form>
  );
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  background: 'transparent',
  color: 'rgba(244, 246, 250, 0.95)',
  borderRadius: 8,
  padding: '11px 12px',
  fontFamily: '"Space Mono", monospace',
  fontSize: 12,
};
