import type { JSX } from 'react';
import { TextInput, TextareaInput, TagsInput, RadioGroup, SelectInput } from '../ui/form';
import type { RoleContextQuestion } from '../../lib/api/types';

// ─── QuestionInput ────────────────────────────────────────────────────────────

export function QuestionInput({
  question, value, onChange, onSubmit,
}: {
  question: RoleContextQuestion;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}): JSX.Element {
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey && question.input.type !== 'textarea') {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && question.input.type === 'textarea') {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
  };

  const inputProps = { value: value || '', onChange, placeholder: question.input.placeholder ?? '' };

  return (
    <div onKeyDown={handleKeyDown}>
      {question.input.type === 'textarea' && <TextareaInput {...inputProps} rows={4} />}
      {question.input.type === 'text' && <TextInput {...inputProps} />}
      {question.input.type === 'select' && question.input.options && <SelectInput {...inputProps} options={question.input.options} />}
      {question.input.type === 'radio' && question.input.options && <RadioGroup value={value} onChange={onChange} options={question.input.options} />}
      {question.input.type === 'tags' && (
        <TagsInput
          value={value ? value.split('|||') : []}
          onChange={(tags) => onChange(tags.join('|||'))}
          placeholder={question.input.placeholder ?? ''}
        />
      )}
      <div style={{ marginTop: 10, fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
        {question.input.type === 'textarea' ? 'CMD+ENTER TO SEND' : 'ENTER TO SEND'}
      </div>
    </div>
  );
}
