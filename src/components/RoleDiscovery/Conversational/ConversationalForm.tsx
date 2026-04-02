import { User, Users, Code, Target, Zap, Heart, ArrowRight, ArrowLeft } from 'lucide-react';
import { FormFieldSet } from './FormFieldSet';
import {
  FieldGroup,
  TextInput,
  SelectInput,
  RadioGroup,
  TagsInput,
  TextareaInput,
} from '../../ui/form';
import type { RoleDiscoveryData, SeniorityLevel, WorkLocation } from '../../../types/roleDiscovery';

interface ConversationalFormProps {
  data: Partial<RoleDiscoveryData & { allowFollowUps: boolean }>;
  onChange: (field: string, value: any) => void;
  onComplete: (data: any) => void;
  currentPhase: number;
  onPhaseChange: (phase: number) => void;
}

const SENIORITY_LEVELS: SeniorityLevel[] = [
  'Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Lead', 'Manager',
];

const WORK_LOCATIONS: WorkLocation[] = ['Remote', 'Hybrid', 'Onsite'];

const PHASES = [
  { id: 'identity', title: 'ROLE IDENTITY', icon: User },
  { id: 'team', title: 'TEAM CONTEXT', icon: Users },
  { id: 'tech', title: 'TECHNICAL ENVIRONMENT', icon: Code },
  { id: 'success', title: 'SUCCESS CRITERIA', icon: Target },
  { id: 'challenges', title: 'CHALLENGES', icon: Zap },
  { id: 'culture', title: 'CULTURE', icon: Heart },
];

const CHROME_GRADIENT = {
  background: 'linear-gradient(135deg, #fff 0%, rgba(200, 210, 230, 0.8) 25%, #fff 50%, rgba(180, 190, 220, 0.7) 75%, rgba(240, 240, 250, 0.9) 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  filter: 'drop-shadow(0 4px 30px rgba(200, 210, 230, 0.2))',
};

export function ConversationalForm({ data, onChange, onComplete, currentPhase, onPhaseChange }: ConversationalFormProps) {
  const nextPhase = () => {
    if (currentPhase < PHASES.length - 1) {
      onPhaseChange(currentPhase + 1);
    } else {
      onComplete(data);
    }
  };

  const prevPhase = () => {
    if (currentPhase > 0) {
      onPhaseChange(currentPhase - 1);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <form onSubmit={(e) => e.preventDefault()} style={{ position: 'relative' }}>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '100%',
          gridTemplateRows: 'auto',
          overflow: 'hidden'
        }}>
          {/* Phase 1: Role Identity */}
          <FormFieldSet isActive={currentPhase === 0} order={0} currentOrder={currentPhase}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <User size={24} color="rgba(255, 255, 255, 0.4)" />
              <h2 style={{ fontSize: 24, fontWeight: 800, ...CHROME_GRADIENT }}>
                ROLE IDENTITY
              </h2>
            </div>
            <p style={{ color: 'var(--pipe-text-dim)', fontSize: 13, marginBottom: 8, letterSpacing: '0.02em' }}>
              Let's start with the basics. What is the role you're hiring for?
            </p>
            
            <FieldGroup label="Job Title" required>
              <TextInput
                value={data.title}
                onChange={(v) => onChange('title', v)}
                placeholder="e.g., Senior Software Engineer"
              />
            </FieldGroup>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <FieldGroup label="Level" required>
                <SelectInput
                  value={data.level}
                  onChange={(v) => onChange('level', v)}
                  placeholder="Select level..."
                  options={SENIORITY_LEVELS}
                />
              </FieldGroup>

              <FieldGroup label="Department" required>
                <TextInput
                  value={data.department}
                  onChange={(v) => onChange('department', v)}
                  placeholder="e.g., Engineering, Platform"
                />
              </FieldGroup>
            </div>

            <FieldGroup label="Location" required>
              <RadioGroup
                value={data.location}
                onChange={(v) => onChange('location', v)}
                options={WORK_LOCATIONS}
              />
            </FieldGroup>
          </FormFieldSet>

          {/* Phase 2: Team Context */}
          <FormFieldSet isActive={currentPhase === 1} order={1} currentOrder={currentPhase}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <Users size={24} color="rgba(255, 255, 255, 0.4)" />
              <h2 style={{ fontSize: 24, fontWeight: 800, ...CHROME_GRADIENT }}>
                TEAM CONTEXT
              </h2>
            </div>
            <p style={{ color: 'var(--pipe-text-dim)', fontSize: 13, marginBottom: 8, letterSpacing: '0.02em' }}>
              Who will this person be working with?
            </p>

            <FieldGroup label="Team Size" required>
              <TextInput
                value={data.teamSize}
                onChange={(v) => onChange('teamSize', v)}
                placeholder="e.g., 6 engineers"
              />
            </FieldGroup>

            <FieldGroup label="Reports To" required>
              <TextInput
                value={data.reportsTo}
                onChange={(v) => onChange('reportsTo', v)}
                placeholder="e.g., Engineering Manager"
              />
            </FieldGroup>
          </FormFieldSet>

          {/* Phase 3: Technical Environment */}
          <FormFieldSet isActive={currentPhase === 2} order={2} currentOrder={currentPhase}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <Code size={24} color="rgba(255, 255, 255, 0.4)" />
              <h2 style={{ fontSize: 24, fontWeight: 800, ...CHROME_GRADIENT }}>
                TECHNICAL ENVIRONMENT
              </h2>
            </div>
            <p style={{ color: 'var(--pipe-text-dim)', fontSize: 13, marginBottom: 8, letterSpacing: '0.02em' }}>
              What tools and technologies are core to this role?
            </p>

            <FieldGroup label="Tech Stack" required>
              <TagsInput
                value={data.stack}
                onChange={(v) => onChange('stack', v)}
                placeholder="Press Enter to add technologies"
              />
            </FieldGroup>
          </FormFieldSet>

          {/* Phase 4: Success Criteria */}
          <FormFieldSet isActive={currentPhase === 3} order={3} currentOrder={currentPhase}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <Target size={24} color="rgba(255, 255, 255, 0.4)" />
              <h2 style={{ fontSize: 24, fontWeight: 800, ...CHROME_GRADIENT }}>
                SUCCESS CRITERIA
              </h2>
            </div>
            <p style={{ color: 'var(--pipe-text-dim)', fontSize: 13, marginBottom: 8, letterSpacing: '0.02em' }}>
              What does success look like for this role?
            </p>

            <FieldGroup label="90-Day Goals">
              <TextareaInput
                value={data.successCriteria}
                onChange={(v) => onChange('successCriteria', v)}
                placeholder="What should this person achieve in 90 days?"
              />
            </FieldGroup>
          </FormFieldSet>

          {/* Phase 5: Challenges */}
          <FormFieldSet isActive={currentPhase === 4} order={4} currentOrder={currentPhase}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <Zap size={24} color="rgba(255, 255, 255, 0.4)" />
              <h2 style={{ fontSize: 24, fontWeight: 800, ...CHROME_GRADIENT }}>
                CHALLENGES
              </h2>
            </div>
            <p style={{ color: 'var(--pipe-text-dim)', fontSize: 13, marginBottom: 8, letterSpacing: '0.02em' }}>
              What are the main difficulties of this role?
            </p>

            <FieldGroup label="Key Challenges">
              <TextareaInput
                value={data.challenges}
                onChange={(v) => onChange('challenges', v)}
                placeholder="What makes this role difficult?"
              />
            </FieldGroup>
          </FormFieldSet>

          {/* Phase 6: Culture */}
          <FormFieldSet isActive={currentPhase === 5} order={5} currentOrder={currentPhase}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <Heart size={24} color="rgba(255, 255, 255, 0.4)" />
              <h2 style={{ fontSize: 24, fontWeight: 800, ...CHROME_GRADIENT }}>
                CULTURE
              </h2>
            </div>
            <p style={{ color: 'var(--pipe-text-dim)', fontSize: 13, marginBottom: 8, letterSpacing: '0.02em' }}>
              What is the team culture like?
            </p>

            <FieldGroup label="Team Culture">
              <TextareaInput
                value={data.culture}
                onChange={(v) => onChange('culture', v)}
                placeholder="How does the team work together?"
              />
            </FieldGroup>
          </FormFieldSet>
        </div>

        {/* Navigation Controls */}
        <div style={{ 
          marginTop: 64,
          display: 'flex', 
          gap: 16,
          justifyContent: 'flex-start'
        }}>
          {currentPhase > 0 && (
            <button
              onClick={prevPhase}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.6)',
                padding: '14px 24px',
                borderRadius: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
              }}
            >
              <ArrowLeft size={14} />
              BACK
            </button>
          )}

          <button
            onClick={nextPhase}
            style={{
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              color: '#a78bfa',
              padding: '14px 32px',
              borderRadius: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              boxShadow: '0 4px 16px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(139, 92, 246, 0.2)',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(139, 92, 246, 0.3)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(139, 92, 246, 0.2)';
            }}
          >
            {currentPhase === PHASES.length - 1 ? 'FINISH_ROLE_DISCOVERY' : 'NEXT_STEP'}
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
