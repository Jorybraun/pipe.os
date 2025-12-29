import { User, Users, Code, Target, Zap, Heart } from 'lucide-react';
import { FormSection } from '../ui/FormSection';
import {
  FieldGroup,
  TextInput,
  SelectInput,
  RadioGroup,
  TagsInput,
  TextareaInput,
} from '../ui/form';
import type { RoleDiscoveryData, SeniorityLevel, WorkLocation } from '../../types/roleDiscovery';

interface BaselineFormProps {
  data: Partial<RoleDiscoveryData>;
  onChange: (field: keyof RoleDiscoveryData, value: string | string[]) => void;
  openSection: string | null;
  onSectionToggle: (section: string) => void;
  isComplete: (section: string) => boolean;
}

const SENIORITY_LEVELS: SeniorityLevel[] = [
  'Junior',
  'Mid',
  'Senior',
  'Staff',
  'Principal',
  'Lead',
  'Manager',
];

const WORK_LOCATIONS: WorkLocation[] = ['Remote', 'Hybrid', 'Onsite'];

/**
 * BaselineForm - Structured form for role baseline data collection
 *
 * Implements Part 1 of the role discovery flow: collecting 7 required baseline fields
 * plus optional enrichment fields. Organized into collapsible sections for clarity.
 *
 * Required sections (7 fields):
 * - Role Identity: title, level, department, location
 * - Team Context: teamSize, reportsTo
 * - Technical Environment: stack
 *
 * Optional sections:
 * - Success Criteria: successCriteria, failureSignals
 * - Challenges: challenges, growth
 * - Culture: culture, redFlags
 *
 * @example
 * ```tsx
 * <BaselineForm
 *   data={formData}
 *   onChange={(field, value) => setFormData({ ...formData, [field]: value })}
 *   openSection={currentSection}
 *   onSectionToggle={setCurrentSection}
 *   isComplete={(section) => checkSectionComplete(section)}
 * />
 * ```
 */
export function BaselineForm({
  data,
  onChange,
  openSection,
  onSectionToggle,
  isComplete,
}: BaselineFormProps): JSX.Element {
  const handleToggle = (section: string): void => {
    onSectionToggle(openSection === section ? '' : section);
  };

  return (
    <div style={{ maxWidth: 700 }}>
      {/* Role Identity Section */}
      <FormSection
        icon={User}
        title="ROLE IDENTITY"
        isOpen={openSection === 'identity'}
        onToggle={() => handleToggle('identity')}
        isComplete={isComplete('identity')}
      >
        <FieldGroup label="Job Title" required>
          <TextInput
            value={data.title}
            onChange={(v) => onChange('title', v)}
            placeholder="e.g., Senior Software Engineer"
          />
        </FieldGroup>

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

        <FieldGroup label="Location" required>
          <RadioGroup
            value={data.location}
            onChange={(v) => onChange('location', v)}
            options={WORK_LOCATIONS}
          />
        </FieldGroup>
      </FormSection>

      {/* Team Context Section */}
      <FormSection
        icon={Users}
        title="TEAM CONTEXT"
        isOpen={openSection === 'team'}
        onToggle={() => handleToggle('team')}
        isComplete={isComplete('team')}
      >
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
      </FormSection>

      {/* Technical Environment Section */}
      <FormSection
        icon={Code}
        title="TECHNICAL ENVIRONMENT"
        isOpen={openSection === 'tech'}
        onToggle={() => handleToggle('tech')}
        isComplete={isComplete('tech')}
      >
        <FieldGroup label="Tech Stack" required>
          <TagsInput
            value={data.stack}
            onChange={(v) => onChange('stack', v)}
            placeholder="Press Enter to add technologies"
          />
        </FieldGroup>

        <FieldGroup label="Engineering Practices">
          <TextareaInput
            value={data.practices}
            onChange={(v) => onChange('practices', v)}
            placeholder="Code review, testing, deployment practices..."
          />
        </FieldGroup>
      </FormSection>

      {/* Success Criteria Section */}
      <FormSection
        icon={Target}
        title="SUCCESS CRITERIA"
        isOpen={openSection === 'success'}
        onToggle={() => handleToggle('success')}
        isComplete={isComplete('success')}
      >
        <FieldGroup label="90-Day Goals">
          <TextareaInput
            value={data.successCriteria}
            onChange={(v) => onChange('successCriteria', v)}
            placeholder="What should this person achieve in 90 days?"
          />
        </FieldGroup>

        <FieldGroup label="Failure Signals">
          <TextareaInput
            value={data.failureSignals}
            onChange={(v) => onChange('failureSignals', v)}
            placeholder="What would indicate this hire isn't working out?"
          />
        </FieldGroup>
      </FormSection>

      {/* Challenges Section */}
      <FormSection
        icon={Zap}
        title="CHALLENGES"
        isOpen={openSection === 'challenges'}
        onToggle={() => handleToggle('challenges')}
        isComplete={isComplete('challenges')}
      >
        <FieldGroup label="Key Challenges">
          <TextareaInput
            value={data.challenges}
            onChange={(v) => onChange('challenges', v)}
            placeholder="What makes this role difficult?"
          />
        </FieldGroup>

        <FieldGroup label="Growth Opportunities">
          <TextareaInput
            value={data.growth}
            onChange={(v) => onChange('growth', v)}
            placeholder="What skills will they develop?"
          />
        </FieldGroup>
      </FormSection>

      {/* Culture Section */}
      <FormSection
        icon={Heart}
        title="CULTURE"
        isOpen={openSection === 'culture'}
        onToggle={() => handleToggle('culture')}
        isComplete={isComplete('culture')}
      >
        <FieldGroup label="Team Culture">
          <TextareaInput
            value={data.culture}
            onChange={(v) => onChange('culture', v)}
            placeholder="How does the team work together?"
          />
        </FieldGroup>

        <FieldGroup label="Red Flags">
          <TextareaInput
            value={data.redFlags}
            onChange={(v) => onChange('redFlags', v)}
            placeholder="What behaviors would be a poor fit?"
          />
        </FieldGroup>
      </FormSection>
    </div>
  );
}
