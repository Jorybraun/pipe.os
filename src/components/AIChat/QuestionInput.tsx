import { useEffect, useState, type JSX } from 'react';
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
  const isChoice =
    question.input.type === 'radio' ||
    question.input.type === 'select' ||
    question.input.type === 'tags';

  // When user chooses "type instead", swap the choice UI for a free-text input.
  const [typeInsteadManual, setTypeInsteadManual] = useState(false);
  useEffect(() => { setTypeInsteadManual(false); }, [question.id]);

  // Auto-reveal the text field when voice streams a value that isn't one of the options
  // (or for tags, when the value doesn't yet contain a `|||` separator).
  const options = question.input.options ?? [];
  const valueIsCustom = isChoice && value.trim().length > 0 && !options.includes(value.trim());
  const typeInstead = typeInsteadManual || valueIsCustom;

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
      {typeInstead && isChoice && <TextInput value={value || ''} onChange={onChange} placeholder="Type your answer…" />}
      {!typeInstead && question.input.type === 'select' && question.input.options && <SelectInput {...inputProps} options={question.input.options} />}
      {!typeInstead && question.input.type === 'radio' && question.input.options && <RadioGroup value={value} onChange={onChange} options={question.input.options} />}
      {!typeInstead && question.input.type === 'tags' && (
        <TagsInput
          value={value ? value.split('|||') : []}
          onChange={(tags) => onChange(tags.join('|||'))}
          placeholder={question.input.placeholder ?? ''}
        />
      )}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
          {question.input.type === 'textarea' ? 'CMD+ENTER TO SEND' : 'ENTER TO SEND'}
        </div>
        {isChoice && (
          <button
            type="button"
            onClick={() => { onChange(''); setTypeInsteadManual((v) => !v); }}
            style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--pipe-border-light)', color: 'var(--pipe-text-dim)', fontSize: 9, letterSpacing: '0.12em', fontFamily: '"Space Mono", monospace', cursor: 'pointer', borderRadius: 4 }}
          >
            {typeInstead ? 'PICK_OPTION' : 'TYPE_INSTEAD'}
          </button>
        )}
      </div>
    </div>
  );
}
