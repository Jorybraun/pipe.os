import { type CSSProperties, type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, Play } from 'lucide-react';
import { createApiClient } from '../lib/api/client';
import type { CreatePipelineResponse } from '../lib/api/types';
import { useAuth } from '../providers';

type StageChoice = {
  value: 'SCREENING' | 'CODE_REVIEW' | 'OPEN_SOURCE';
  label: string;
  description: string;
};

const STAGE_CHOICES: StageChoice[] = [
  {
    value: 'SCREENING',
    label: 'Video interview',
    description: 'Schedule a recorded call, capture the transcript, and grow the person context.',
  },
  {
    value: 'CODE_REVIEW',
    label: 'Code-review interview',
    description: 'Use the video interview around a real PR review and source-backed findings.',
  },
  {
    value: 'OPEN_SOURCE',
    label: 'Implementation challenge',
    description: 'Match the person to a repo-backed task when you need hands-on evidence.',
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

const MIN_DESCRIPTION_LENGTH = 20;

export default function PipelineNewRoutePage(): JSX.Element {
  const navigate = useNavigate();
  const auth = useAuth();
  const api = createApiClient({ getToken: auth.getSessionToken });

  const [roleTitle, setRoleTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [selectedStages, setSelectedStages] = useState<Array<StageChoice['value']>>([
    'SCREENING',
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
  const hasRoleContext = roleDescriptionValue.length >= MIN_DESCRIPTION_LENGTH;
  const hasPartialRoleContext =
    roleDescriptionValue.length > 0 && roleDescriptionValue.length < MIN_DESCRIPTION_LENGTH;
  const canSubmit =
    roleTitleValue.length > 0 &&
    !hasPartialRoleContext &&
    selectedStages.length > 0 &&
    !isSubmitting;

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault();
    setError(null);

    if (!canSubmit) {
      if (roleTitleValue.length === 0) {
        setError('Plan title is required.');
      } else if (hasPartialRoleContext) {
        setError(`Optional context must be blank or at least ${MIN_DESCRIPTION_LENGTH} characters.`);
      } else if (selectedStages.length === 0) {
        setError('Select at least one interview type.');
      }
      return;
    }

    setIsSubmitting(true);

    try {
      if (!hasRoleContext) {
        const created = await api.post<CreatePipelineResponse>('/api/v1/pipelines', {
          title: roleTitleValue,
          description: undefined,
          status: 'DRAFT',
          creationMode: 'BLANK',
          createDefaultStages: false,
        });

        for (const stageValue of selectedStages) {
          const stage = STAGE_CHOICES.find((choice) => choice.value === stageValue);
          await api.post(`/api/v1/pipelines/${created.pipeline.id}/stages`, {
            title: stage?.label ?? 'Interview',
            stageType: stageValue,
            isScheduled: true,
          });
        }

        navigate(`/pipeline/${created.pipeline.id}`);
        return;
      }

      const jobDescriptionMd = [
        `## Role Title\n${roleTitleValue}`,
        ...(companyValue ? [`## Company\n${companyValue}`] : []),
        ...(locationValue ? [`## Location\n${locationValue}`] : []),
        `## Role Scope\n${roleDescriptionValue}`,
      ].join('\n\n');

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
        minHeight: 'calc(100dvh - 124px)',
        padding: '24px 24px 40px',
        background: 'transparent',
        color: 'var(--pipe-text)',
        boxSizing: 'border-box',
        margin: '0',
        width: '100%',
        display: 'flex',
        justifyContent: 'flex-start',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          maxWidth: 920,
          margin: '0',
          width: '100%',
          border: '1px solid var(--pipe-border-light)',
          borderRadius: 14,
          padding: 22,
          background: 'var(--pipe-surface-solid)',
          boxShadow: '0 24px 80px var(--pipe-shadow)',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        } as CSSProperties}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: 0,
                color: 'var(--pipe-text-dim)',
                marginBottom: 6,
                fontFamily: '"Space Mono", monospace',
              }}
            >
              PIPE OS
            </div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: 0, color: 'var(--pipe-text)' }}>
              New Interview Plan
            </h1>
            <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--pipe-text-muted)' }}>
              Start with the interview. Add a role, job description, or technical context only when it helps.
            </p>
          </div>
          <div>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                border: canSubmit ? '1px solid var(--pipe-accent-border)' : '1px solid var(--pipe-border)',
                background: canSubmit ? 'var(--pipe-text)' : 'var(--pipe-surface)',
                color: canSubmit ? 'var(--pipe-bg)' : 'var(--pipe-text-dim)',
                padding: '11px 18px',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 0,
                fontFamily: '"Space Mono", monospace',
                borderRadius: 8,
                cursor: canSubmit ? 'pointer' : 'default',
              }}
            >
              {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              CREATE PLAN
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 28,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.1fr) minmax(280px, 1fr)',
            gap: 22,
          }}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 8 }}>
              <span style={fieldLabelStyle}>
                PLAN TITLE
              </span>
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="Frontend interview / Coffee chat / Senior Frontend Engineer"
                required
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={fieldLabelStyle}>
                COMPANY / CLIENT
              </span>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Corp"
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'grid', gap: 8 }}>
              <span style={fieldLabelStyle}>
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
            <div style={{ ...fieldLabelStyle, marginBottom: 8 }}>
              INTERVIEW TYPES
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
                      ? '1px solid var(--pipe-accent-border)'
                      : '1px solid var(--pipe-border)',
                    background: selectedStages.includes(stage.value)
                      ? 'var(--pipe-accent-surface)'
                      : 'var(--pipe-surface-solid)',
                    color: 'var(--pipe-text)',
                    padding: 14,
                    borderRadius: 10,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>{stage.label}</span>
                    {selectedStages.includes(stage.value) && <CheckCircle2 size={14} color="var(--pipe-accent)" />}
                  </div>
                  <p style={{ margin: '8px 0 0', color: 'var(--pipe-text-muted)', fontSize: 11, lineHeight: 1.4 }}>
                    {stage.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18, minHeight: 0 }}>
          <span style={fieldLabelStyle}>
            OPTIONAL ROLE OR CONTEXT
          </span>
          <textarea
            value={roleDescription}
            onChange={(e) => setRoleDescription(e.target.value)}
            rows={10}
            placeholder="Paste role expectations, meeting context, or technical requirements if you have them. Leave this blank to create a simple interview plan first."
            style={{
              ...inputStyle,
              width: '100%',
              minHeight: 220,
              resize: 'none',
              lineHeight: 1.5,
              padding: 14,
            }}
          />
          <span
            style={{
              fontSize: 10,
              color: hasPartialRoleContext ? '#dc2626' : 'var(--pipe-text-dim)',
            }}
          >
            {roleDescriptionValue.length === 0
              ? 'No role context yet'
              : `${roleDescriptionValue.length} / ${MIN_DESCRIPTION_LENGTH} chars`}
          </span>
        </label>

        {error ? (
          <div
            style={{
              marginTop: 16,
              border: '1px solid rgba(252,165,165,0.35)',
              background: 'rgba(252,165,165,0.1)',
              color: '#f87171',
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
  border: '1px solid var(--pipe-border)',
  background: 'var(--pipe-surface-solid)',
  color: 'var(--pipe-text)',
  borderRadius: 8,
  padding: '11px 12px',
  fontFamily: '"Space Mono", monospace',
  fontSize: 12,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 10,
  letterSpacing: 0,
  color: 'var(--pipe-text-dim)',
};
