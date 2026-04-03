/**
 * ChallengeBrowserPanel — Sidebar for browsing and dragging challenge templates.
 *
 * Renders as a fixed-position panel matching Layout's agentPanel styling.
 * Each template card is draggable via @dnd-kit. Click-to-add as fallback.
 */

import { useState, useMemo } from 'react';
import { X, Search, Code, FileText, MessageSquare, HelpCircle, GripVertical } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  ALL_CHALLENGE_TEMPLATES,
  type ChallengeTemplate,
  type ChallengeType,
} from '../../content/challengeLibrary';
import type { ChallengeItem, CreateChallengeRequest } from '../../lib/api/types';

interface ChallengeBrowserPanelProps {
  onClose: () => void;
  stageId: string;
  challengeCount: number;
  createChallenge: (stageId: string, payload: CreateChallengeRequest) => Promise<ChallengeItem>;
  refetch: () => Promise<void>;
}

const TYPE_FILTERS: { key: ChallengeType | 'ALL'; label: string; icon: typeof Code }[] = [
  { key: 'ALL', label: 'ALL', icon: FileText },
  { key: 'CODE_IMPLEMENTATION', label: 'IMPLEMENTATION', icon: Code },
  { key: 'QUIZ_MCQ', label: 'MULTIPLE_CHOICE', icon: HelpCircle },
  { key: 'QUIZ_SHORT_ANSWER', label: 'SHORT_ANSWER', icon: MessageSquare },
  { key: 'CODE_REVIEW', label: 'CODE_REVIEW', icon: Code },
];


export function ChallengeBrowserPanel({ onClose, stageId, challengeCount, createChallenge, refetch }: ChallengeBrowserPanelProps): JSX.Element {
  const [typeFilter, setTypeFilter] = useState<ChallengeType | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    let templates = ALL_CHALLENGE_TEMPLATES;
    if (typeFilter !== 'ALL') {
      templates = templates.filter((t) => t.type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      templates = templates.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return templates;
  }, [typeFilter, search]);

  const handleClickAdd = async (template: ChallengeTemplate): Promise<void> => {
    await createChallenge(stageId, {
      type: template.type,
      title: template.title,
      instructions: template.instructions,
      config: template.config as Record<string, unknown>,
      order: challengeCount,
    });
    await refetch();
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 20px 16px',
          borderBottom: '1px solid var(--pipe-border, rgba(255,255,255,0.06))',
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
          }}
        >
          CHALLENGE_LIBRARY
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '12px 20px 0' }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={12}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--pipe-text-dim)',
            }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            style={{
              width: '100%',
              padding: '8px 10px 8px 30px',
              fontSize: 10,
              fontFamily: '"Space Mono", monospace',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text)',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Type filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '12px 20px' }}>
        {TYPE_FILTERS.map((f) => {
          const isActive = typeFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              style={{
                padding: '6px 10px',
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '0.08em',
                fontFamily: '"Space Mono", monospace',
                background: isActive ? 'rgba(167,139,250,0.12)' : 'transparent',
                border: isActive
                  ? '1px solid rgba(167,139,250,0.3)'
                  : '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: isActive ? '#a78bfa' : 'var(--pipe-text-dim)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Template list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && (
          <div
            style={{
              padding: 20,
              textAlign: 'center',
              fontSize: 9,
              color: 'var(--pipe-text-dim)',
              letterSpacing: '0.1em',
            }}
          >
            NO_TEMPLATES_FOUND
          </div>
        )}
        {filtered.map((template) => (
          <DraggableTemplateCard
            key={template.id}
            template={template}
            onClickAdd={() => void handleClickAdd(template)}
          />
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--pipe-border)',
          fontSize: 8,
          color: 'var(--pipe-text-dim)',
          letterSpacing: '0.1em',
          textAlign: 'center',
        }}
      >
        {filtered.length} TEMPLATES — DRAG TO ADD
      </div>
    </div>
  );
}

// ── Draggable template card ─────────────────────────────────────────────────

function DraggableTemplateCard({
  template,
  onClickAdd,
}: {
  template: ChallengeTemplate;
  onClickAdd: () => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `template-${template.id}`,
    data: { type: 'template' as const, template },
  });

  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    opacity: isDragging ? 0.4 : 1,
    transition: isDragging ? undefined : 'opacity 0.15s',
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        background: 'transparent',
        border: '1px solid var(--pipe-border)',
        borderRadius: 4,
        cursor: 'grab',
      }}
      {...attributes}
      {...listeners}
    >
      <GripVertical
        size={12}
        style={{ color: 'var(--pipe-text-dim)', opacity: 0.3, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }} onClick={onClickAdd}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--pipe-text)',
            fontFamily: '"Space Mono", monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {template.title}
        </div>
        <div
          style={{
            fontSize: 8,
            color: 'var(--pipe-text-dim)',
            marginTop: 3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            opacity: 0.6,
          }}
        >
          {template.description}
        </div>
      </div>
    </div>
  );
}
