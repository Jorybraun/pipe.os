import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import {
  FieldGroup,
  TextInput,
  SelectInput,
  TagsInput,
  TextareaInput,
} from '../components/ui/form';
import {
  usePipelineCreate,
  validatePipelineInput,
  type PipelineCreateInput,
  type PipelineLevel,
} from '../hooks/usePipelineCreate';

// ============================================================================
// Constants
// ============================================================================

const SENIORITY_LEVELS: PipelineLevel[] = [
  'Junior',
  'Mid',
  'Senior',
  'Staff',
  'Principal',
  'Lead',
  'Manager',
];

// ============================================================================
// Form state
// ============================================================================

interface FormState {
  title: string;
  level: string;
  stack: string[];
  description: string;
}

const INITIAL_FORM: FormState = {
  title: '',
  level: '',
  stack: [],
  description: '',
};

// ============================================================================
// Component
// ============================================================================

/**
 * PipelineCreatePage - Simplified pipeline creation form.
 *
 * Replaces the previous multi-phase RoleDiscoveryPage for MVP.
 * Collects the minimum viable role context (title, level, stack, description)
 * and persists it to DynamoDB via Amplify Data.
 *
 * On success, redirects to the pipeline detail page.
 *
 * Post-MVP: The full agentic discovery flow (useRoleDiscovery + AgentPanel)
 * will be restored and accessed from the pipeline detail page.
 *
 * Route: /pipeline/new
 */
export default function PipelineCreatePage(): JSX.Element {
  const navigate = useNavigate();
  const { create, isSubmitting, error } = usePipelineCreate();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof PipelineCreateInput, string>>
  >({});

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleChange = useCallback(
    <K extends keyof FormState>(field: K, value: FormState[K]): void => {
      setForm((prev) => ({ ...prev, [field]: value }));
      // Clear field error on change
      if (fieldErrors[field as keyof PipelineCreateInput]) {
        setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    },
    [fieldErrors]
  );

  const handleSubmit = useCallback(async (): Promise<void> => {
    const input: Partial<PipelineCreateInput> = {
      title: form.title,
      level: form.level as PipelineLevel | undefined,
      stack: form.stack,
      description: form.description || undefined,
    };

    const validationErrors = validatePipelineInput(input);
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      return;
    }

    const id = await create(input as PipelineCreateInput);
    if (id) {
      navigate(`/pipeline/${id}`);
    }
  }, [form, create, navigate]);

  const handleCancel = useCallback((): void => {
    navigate('/');
  }, [navigate]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const hasRequiredFields =
    form.title.trim().length > 0 &&
    form.level.length > 0 &&
    form.stack.length > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 640, paddingBottom: 64 }}>
      {/* Back button */}
      <div style={{ marginBottom: 32 }}>
        <button
          onClick={handleCancel}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            fontSize: 10,
            letterSpacing: '0.15em',
            fontFamily: '"Space Mono", monospace',
            padding: 0,
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              'rgba(255,255,255,0.7)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              'rgba(255,255,255,0.4)';
          }}
        >
          <ArrowLeft size={12} />
          BACK TO ROLES
        </button>
      </div>

      {/* Page header */}
      <div style={{ marginBottom: 40 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.25em',
            color: 'rgba(255,255,255,0.25)',
            marginBottom: 12,
          }}
        >
          PIPELINE_CREATE
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '0.03em',
            margin: 0,
            lineHeight: 1.2,
            background:
              'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          New Pipeline
        </h1>
        <p
          style={{
            marginTop: 12,
            fontSize: 12,
            color: 'rgba(255,255,255,0.4)',
            lineHeight: 1.6,
            fontFamily: '"Space Mono", monospace',
          }}
        >
          Define the role. We'll use the stack to select relevant code challenges.
        </p>
      </div>

      {/* Form card */}
      <div>
        <LiquidMetalCard variant="chrome">
          <div style={{ padding: 40 }}>
            {/* Role Title */}
            <FieldGroup
              label="Role Title"
              required
              error={fieldErrors.title}
            >
              <TextInput
                value={form.title}
                onChange={(v) => handleChange('title', v)}
                placeholder="e.g., Senior Software Engineer"
              />
            </FieldGroup>

            {/* Seniority Level */}
            <FieldGroup
              label="Seniority Level"
              required
              error={fieldErrors.level}
            >
              <SelectInput
                value={form.level}
                onChange={(v) => handleChange('level', v)}
                placeholder="Select level..."
                options={SENIORITY_LEVELS}
              />
            </FieldGroup>

            {/* Tech Stack */}
            <FieldGroup
              label="Tech Stack"
              required
              hint="Press Enter or comma to add each technology"
              error={fieldErrors.stack}
            >
              <TagsInput
                value={form.stack}
                onChange={(v) => handleChange('stack', v)}
                placeholder="React, TypeScript, Node.js..."
              />
            </FieldGroup>

            {/* Description */}
            <FieldGroup
              label="Description"
              hint="Optional — what does this role need to accomplish?"
            >
              <TextareaInput
                value={form.description}
                onChange={(v) => handleChange('description', v)}
                placeholder="Context about the team, the problem space, key responsibilities..."
              />
            </FieldGroup>

            {/* API error */}
            {error && (
              <div
                role="alert"
                style={{
                  marginBottom: 24,
                  padding: '12px 16px',
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: 'rgba(252, 165, 165, 0.9)',
                  fontSize: 11,
                  fontFamily: '"Space Mono", monospace',
                  lineHeight: 1.5,
                }}
              >
                {error.message}
              </div>
            )}

            {/* Actions */}
            <div
              style={{
                display: 'flex',
                gap: 12,
                justifyContent: 'flex-end',
                marginTop: 8,
              }}
            >
              <button
                onClick={handleCancel}
                disabled={isSubmitting}
                style={{
                  padding: '12px 24px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: 10,
                  letterSpacing: '0.15em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                CANCEL
              </button>

              <button
                onClick={handleSubmit}
                disabled={!hasRequiredFields || isSubmitting}
                style={{
                  padding: '12px 32px',
                  background: hasRequiredFields && !isSubmitting
                    ? 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(200,200,220,0.12))'
                    : 'rgba(255,255,255,0.04)',
                  border: hasRequiredFields && !isSubmitting
                    ? '1px solid rgba(255,255,255,0.25)'
                    : '1px solid rgba(255,255,255,0.06)',
                  color: hasRequiredFields && !isSubmitting
                    ? '#fff'
                    : 'rgba(255,255,255,0.2)',
                  fontSize: 10,
                  letterSpacing: '0.15em',
                  fontFamily: '"Space Mono", monospace',
                  fontWeight: 700,
                  cursor:
                    hasRequiredFields && !isSubmitting
                      ? 'pointer'
                      : 'not-allowed',
                  transition: 'all 0.2s ease',
                  boxShadow:
                    hasRequiredFields && !isSubmitting
                      ? '0 4px 20px rgba(0,0,0,0.3)'
                      : 'none',
                }}
              >
                {isSubmitting ? 'CREATING...' : 'CREATE PIPELINE'}
              </button>
            </div>
          </div>
        </LiquidMetalCard>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        input::placeholder,
        textarea::placeholder { color: rgba(255,255,255,0.2); }
        input:focus,
        textarea:focus,
        select:focus {
          border-color: rgba(139, 92, 246, 0.4) !important;
          outline: 2px solid rgba(139, 92, 246, 0.15);
          outline-offset: 0;
        }
      `}</style>
    </div>
  );
}
