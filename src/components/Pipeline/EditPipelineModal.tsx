/**
 * EditPipelineModal — simple modal for editing pipeline metadata.
 */

import { useState, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';

const mono = '"Space Mono", monospace';

const LEVELS = ['Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Lead', 'Manager'];

interface Props {
  initial: {
    title: string;
    level: string | null;
    stack: string[] | null;
    description: string | null;
  };
  onSave: (updates: {
    title: string;
    level: string | null;
    stack: string[];
    description: string | null;
  }) => void | Promise<void>;
  onClose: () => void;
}

export default function EditPipelineModal({ initial, onSave, onClose }: Props): JSX.Element {
  const [title, setTitle] = useState(initial.title);
  const [level, setLevel] = useState(initial.level ?? '');
  const [stackStr, setStackStr] = useState(initial.stack?.join(', ') ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [saving, setSaving] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      const stack = stackStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      try {
        await onSave({
          title: title.trim(),
          level: level || null,
          stack,
          description: description.trim() || null,
        });
        onClose();
      } catch {
        // error handled by caller
      } finally {
        setSaving(false);
      }
    },
    [title, level, stackStr, description, onSave, onClose],
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <LiquidMetalCard variant="mercury" style={{ width: 480, maxWidth: '90vw', padding: 32 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: '0.15em', fontFamily: mono, color: 'var(--pipe-text-dim)' }}>
            EDIT_PIPELINE
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: mono,
                color: 'var(--pipe-text-dim)',
                marginBottom: 6,
              }}
            >
              TITLE
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text)',
                fontSize: 13,
                fontFamily: mono,
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: mono,
                color: 'var(--pipe-text-dim)',
                marginBottom: 6,
              }}
            >
              LEVEL
            </label>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text)',
                fontSize: 13,
                fontFamily: mono,
                outline: 'none',
              }}
            >
              <option value="">—</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: mono,
                color: 'var(--pipe-text-dim)',
                marginBottom: 6,
              }}
            >
              STACK (comma-separated)
            </label>
            <input
              value={stackStr}
              onChange={(e) => setStackStr(e.target.value)}
              placeholder="React, TypeScript, PostgreSQL"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text)',
                fontSize: 13,
                fontFamily: mono,
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: mono,
                color: 'var(--pipe-text-dim)',
                marginBottom: 6,
              }}
            >
              DESCRIPTION
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text)',
                fontSize: 13,
                fontFamily: mono,
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '10px 20px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                color: 'var(--pipe-text-dim)',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: mono,
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              style={{
                flex: 1,
                padding: '10px 20px',
                background: 'var(--pipe-accent)',
                border: 'none',
                color: '#fff',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: mono,
                cursor: saving || !title.trim() ? 'not-allowed' : 'pointer',
                opacity: saving || !title.trim() ? 0.5 : 1,
                borderRadius: 4,
              }}
            >
              {saving ? 'SAVING...' : 'SAVE'}
            </button>
          </div>
        </form>
      </LiquidMetalCard>
    </div>
  );
}
