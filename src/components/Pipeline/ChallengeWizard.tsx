/**
 * ChallengeWizard — ADR-034 CA Phase 2
 *
 * Replaces InlineChallengeAdder for the TECHNICAL/CODE_REVIEW/CULTURAL/PANEL
 * stage types. Implements the 3-source wizard (CA-13):
 *
 *   1. Template Packs  — browse curated packs by role/seniority (CA-14)
 *   2. AI Generated    — placeholder for CA Phase 3
 *   3. Custom          — create from scratch via type-specific editors
 *
 * Renders inline inside the CHALLENGES SectionCard body.
 * Uses right-sidebar drawer pattern for challenge preview (CA-15).
 *
 * Design: brutalist glassmorphic, Space Mono, pipe design tokens.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Library,
  Sparkles,
  PenLine,
  Search,
  ChevronRight,
  Code2,
  CircleDot,
  MessageSquare,
  Package,
  Clock,
  Plus,
  X,
  ArrowLeft,
  Check,
  Loader2,
  Filter,
  Zap,
} from 'lucide-react';
import { useChallengeMutations } from '../../hooks/useChallengeMutations';
import { useStageRefetch } from '../../contexts/StageRefetchContext';
import {
  ALL_CHALLENGE_TEMPLATES,
  type ChallengeTemplate,
} from '../../content/challengeLibrary';
import {
  useTemplateLibrary,
  type TemplatePackItem,
  type TemplateType,
  type PackRoleType,
} from '../../hooks/useTemplateLibrary';

// ─── Types ──────────────────────────────────────────────────────────────────

type WizardSource = 'packs' | 'library' | 'ai' | 'custom';
type ChallengeTypeFilter = TemplateType | 'ALL';

interface StagedChallenge {
  id: string;
  type: string;
  title: string;
  instructions: string;
  config: Record<string, unknown>;
  serverConfig?: Record<string, unknown>;
  source: 'template' | 'pack' | 'ai' | 'custom';
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SOURCES: Array<{
  key: WizardSource;
  label: string;
  sublabel: string;
  Icon: typeof Library;
  accentColor: string;
}> = [
  {
    key: 'packs',
    label: 'TEMPLATE PACKS',
    sublabel: 'Curated by role',
    Icon: Package,
    accentColor: '#60a5fa',
  },
  {
    key: 'library',
    label: 'FROM LIBRARY',
    sublabel: 'Browse all templates',
    Icon: Library,
    accentColor: '#a78bfa',
  },
  {
    key: 'ai',
    label: 'AI GENERATED',
    sublabel: 'From job description',
    Icon: Sparkles,
    accentColor: '#4ade80',
  },
  {
    key: 'custom',
    label: 'CUSTOM',
    sublabel: 'Write from scratch',
    Icon: PenLine,
    accentColor: '#fbbf24',
  },
];

const TYPE_FILTERS: Array<{ key: ChallengeTypeFilter; label: string; Icon: typeof Code2 }> = [
  { key: 'ALL', label: 'ALL', Icon: Filter },
  { key: 'QUIZ_MCQ', label: 'MCQ', Icon: CircleDot },
  { key: 'CODE_IMPLEMENTATION', label: 'CODE', Icon: Code2 },
  { key: 'QUIZ_SHORT_ANSWER', label: 'LONG-FORM', Icon: MessageSquare },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  JUNIOR: '#4ade80',
  MID: '#fbbf24',
  SENIOR: '#f87171',
  beginner: '#4ade80',
  intermediate: '#fbbf24',
  advanced: '#f87171',
};

const TYPE_BADGE_COLORS: Record<string, string> = {
  CODE_IMPLEMENTATION: '#a78bfa',
  QUIZ_MCQ: '#4ade80',
  QUIZ_SHORT_ANSWER: '#fbbf24',
  CODE_REVIEW: '#60a5fa',
};

const ROLE_FILTERS: PackRoleType[] = [
  'FRONTEND', 'BACKEND', 'FULLSTACK', 'DATA_ENGINEERING', 'DEVOPS', 'MOBILE',
];

// ─── Style tokens ───────────────────────────────────────────────────────────

const mono: React.CSSProperties = {
  fontFamily: '"Space Mono", monospace',
};

const labelStyle: React.CSSProperties = {
  ...mono,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.2em',
  color: 'var(--pipe-text-dim)',
  marginBottom: 10,
  display: 'block',
};

const pillBase: React.CSSProperties = {
  ...mono,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 8px',
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.12em',
  borderRadius: 3,
  border: '1px solid var(--pipe-border)',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'all 0.15s',
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function DifficultyBadge({ difficulty }: { difficulty: string }): JSX.Element {
  const color = DIFFICULTY_COLORS[difficulty] ?? 'var(--pipe-text-dim)';
  return (
    <span
      style={{
        ...mono,
        fontSize: 7,
        fontWeight: 800,
        letterSpacing: '0.15em',
        color,
        padding: '2px 6px',
        borderRadius: 2,
        background: `${color}11`,
        border: `1px solid ${color}33`,
      }}
    >
      {difficulty.toUpperCase()}
    </span>
  );
}

function TypeBadge({ type }: { type: string }): JSX.Element {
  const color = TYPE_BADGE_COLORS[type] ?? 'var(--pipe-text-dim)';
  const label = type === 'CODE_IMPLEMENTATION' ? 'CODE' : type === 'QUIZ_MCQ' ? 'MCQ' : type === 'QUIZ_SHORT_ANSWER' ? 'LONG-FORM' : type;
  return (
    <span
      style={{
        ...mono,
        fontSize: 7,
        fontWeight: 800,
        letterSpacing: '0.15em',
        color,
        padding: '2px 6px',
        borderRadius: 2,
        background: `${color}11`,
        border: `1px solid ${color}33`,
      }}
    >
      {label}
    </span>
  );
}

function SkillTag({ skill }: { skill: string }): JSX.Element {
  return (
    <span
      style={{
        ...mono,
        fontSize: 7,
        letterSpacing: '0.08em',
        color: 'var(--pipe-text-dim)',
        padding: '2px 6px',
        borderRadius: 2,
        background: 'var(--pipe-surface)',
        border: '1px solid var(--pipe-border-light)',
      }}
    >
      {skill}
    </span>
  );
}

// ─── Source selector (Step 1) ───────────────────────────────────────────────

function SourceSelector({
  onSelect,
}: {
  onSelect: (source: WizardSource) => void;
}): JSX.Element {
  return (
    <div>
      <label style={labelStyle}>ADD_CHALLENGES</label>
      <p
        style={{
          ...mono,
          fontSize: 10,
          color: 'var(--pipe-text-muted)',
          marginTop: 0,
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Choose how to add questions to this stage. Pick from curated packs,
        generate with AI, or write your own.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 8,
        }}
      >
        {SOURCES.map(({ key, label, sublabel, Icon, accentColor }) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 10,
              padding: '16px 14px',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              textAlign: 'left',
              position: 'relative',
              overflow: 'hidden',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = `${accentColor}55`;
              e.currentTarget.style.background = `${accentColor}08`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--pipe-border)';
              e.currentTarget.style.background = 'var(--pipe-surface)';
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: `${accentColor}12`,
                border: `1px solid ${accentColor}33`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon size={13} color={accentColor} />
            </div>
            <div>
              <div
                style={{
                  ...mono,
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  color: 'var(--pipe-text)',
                  marginBottom: 3,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  ...mono,
                  fontSize: 8,
                  color: 'var(--pipe-text-dim)',
                  letterSpacing: '0.04em',
                }}
              >
                {sublabel}
              </div>
            </div>
            <ChevronRight
              size={12}
              color="var(--pipe-text-dim)"
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Template Pack Browser (Step 2a) ────────────────────────────────────────

function PackBrowser({
  packs,
  isLoading,
  onSelectPack,
  onBack,
  fetchPacks,
}: {
  packs: TemplatePackItem[];
  isLoading: boolean;
  onSelectPack: (pack: TemplatePackItem) => void;
  onBack: () => void;
  fetchPacks: (filters?: { roleType?: PackRoleType; seniority?: string }) => Promise<void>;
}): JSX.Element {
  const [roleFilter, setRoleFilter] = useState<PackRoleType | null>(null);

  const filtered = useMemo(() => {
    if (!roleFilter) return packs;
    return packs.filter((p) => p.roleType === roleFilter);
  }, [packs, roleFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onBack}
          style={{
            ...mono,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            background: 'none',
            border: '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: 'var(--pipe-text-dim)',
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.1em',
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={10} />
          BACK
        </button>
        <label style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>TEMPLATE_PACKS</label>
      </div>

      {/* Role filter pills */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button
          onClick={() => { setRoleFilter(null); void fetchPacks(); }}
          style={{
            ...pillBase,
            color: !roleFilter ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
            borderColor: !roleFilter ? 'var(--pipe-text)' : 'var(--pipe-border)',
            background: !roleFilter ? 'var(--pipe-surface-hover)' : 'transparent',
          }}
        >
          ALL
        </button>
        {ROLE_FILTERS.map((role) => (
          <button
            key={role}
            onClick={() => {
              setRoleFilter(role);
              void fetchPacks({ roleType: role });
            }}
            style={{
              ...pillBase,
              color: roleFilter === role ? '#60a5fa' : 'var(--pipe-text-dim)',
              borderColor: roleFilter === role ? '#60a5fa55' : 'var(--pipe-border)',
              background: roleFilter === role ? 'rgba(96,165,250,0.08)' : 'transparent',
            }}
          >
            {role.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Pack cards */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader2
            size={16}
            color="var(--pipe-text-dim)"
            style={{ animation: 'spin 1s linear infinite' }}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            ...mono,
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--pipe-text-dim)',
            fontSize: 10,
            border: '1px dashed var(--pipe-border-light)',
            borderRadius: 8,
          }}
        >
          {packs.length === 0
            ? 'No template packs available yet. Seed templates to get started.'
            : 'No packs match this filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((pack) => (
            <button
              key={`${pack.id}-${pack.version}`}
              onClick={() => onSelectPack(pack)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'all 0.15s',
                textAlign: 'left',
                width: '100%',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#60a5fa55';
                e.currentTarget.style.background = 'rgba(96,165,250,0.04)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--pipe-border)';
                e.currentTarget.style.background = 'var(--pipe-surface)';
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: 'rgba(96,165,250,0.08)',
                  border: '1px solid rgba(96,165,250,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Package size={14} color="#60a5fa" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    ...mono,
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--pipe-text)',
                    marginBottom: 4,
                    letterSpacing: '0.04em',
                  }}
                >
                  {pack.name}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <DifficultyBadge difficulty={pack.seniority} />
                  {pack.skills.slice(0, 3).map((s) => (
                    <SkillTag key={s} skill={s} />
                  ))}
                  {pack.skills.length > 3 && (
                    <span style={{ ...mono, fontSize: 7, color: 'var(--pipe-text-dim)' }}>
                      +{pack.skills.length - 3}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={14} color="var(--pipe-text-dim)" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Library Browser (Step 2b) ──────────────────────────────────────────────

function LibraryBrowser({
  onAdd,
  onBack,
}: {
  onAdd: (item: StagedChallenge) => void;
  onBack: () => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ChallengeTypeFilter>('ALL');
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Use local challenge library (falls back to hardcoded templates while D1 seeds are pending)
  const filtered = useMemo(() => {
    let items = ALL_CHALLENGE_TEMPLATES.filter(
      (t) =>
        t.type === 'CODE_IMPLEMENTATION' ||
        t.type === 'QUIZ_MCQ' ||
        t.type === 'QUIZ_SHORT_ANSWER',
    );

    if (typeFilter !== 'ALL') {
      items = items.filter((t) => t.type === typeFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.topic.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    return items;
  }, [search, typeFilter]);

  const handleAdd = useCallback(
    (template: ChallengeTemplate) => {
      onAdd({
        id: template.id,
        type: template.type,
        title: template.title,
        instructions: template.instructions,
        config: template.config as Record<string, unknown>,
        source: 'template',
      });
      setAddedIds((prev) => new Set([...prev, template.id]));
    },
    [onAdd],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onBack}
          style={{
            ...mono,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            background: 'none',
            border: '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: 'var(--pipe-text-dim)',
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.1em',
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={10} />
          BACK
        </button>
        <label style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>CHALLENGE_LIBRARY</label>
      </div>

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search
          size={12}
          color="var(--pipe-text-dim)"
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          style={{
            ...mono,
            width: '100%',
            padding: '9px 12px 9px 30px',
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border)',
            borderRadius: 6,
            color: 'var(--pipe-text)',
            fontSize: 10,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Type filter tabs */}
      <div style={{ display: 'flex', gap: 4 }}>
        {TYPE_FILTERS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTypeFilter(key)}
            style={{
              ...pillBase,
              color: typeFilter === key
                ? (TYPE_BADGE_COLORS[key] ?? 'var(--pipe-text)')
                : 'var(--pipe-text-dim)',
              borderColor: typeFilter === key
                ? `${TYPE_BADGE_COLORS[key] ?? 'var(--pipe-text)'}55`
                : 'var(--pipe-border)',
              background: typeFilter === key
                ? `${TYPE_BADGE_COLORS[key] ?? 'var(--pipe-text)'}0a`
                : 'transparent',
            }}
          >
            <Icon size={9} />
            {label}
          </button>
        ))}
      </div>

      {/* Template list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div
            style={{
              ...mono,
              padding: '30px 20px',
              textAlign: 'center',
              color: 'var(--pipe-text-dim)',
              fontSize: 10,
              border: '1px dashed var(--pipe-border-light)',
              borderRadius: 8,
            }}
          >
            No templates match your search.
          </div>
        ) : (
          filtered.map((template) => {
            const isAdded = addedIds.has(template.id);
            return (
              <div
                key={template.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  background: isAdded ? 'rgba(74,222,128,0.04)' : 'var(--pipe-surface)',
                  border: isAdded
                    ? '1px solid rgba(74,222,128,0.2)'
                    : '1px solid var(--pipe-border)',
                  borderRadius: 6,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      ...mono,
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'var(--pipe-text)',
                      marginBottom: 4,
                      lineHeight: 1.3,
                    }}
                  >
                    {template.title}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <TypeBadge type={template.type} />
                    <DifficultyBadge difficulty={template.difficulty} />
                    {template.estimatedMinutes > 0 && (
                      <span
                        style={{
                          ...mono,
                          fontSize: 7,
                          color: 'var(--pipe-text-dim)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Clock size={8} />
                        {template.estimatedMinutes}m
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleAdd(template)}
                  disabled={isAdded}
                  style={{
                    ...mono,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: isAdded
                      ? '1px solid rgba(74,222,128,0.3)'
                      : '1px solid var(--pipe-border)',
                    background: isAdded ? 'rgba(74,222,128,0.1)' : 'var(--pipe-surface-hover)',
                    cursor: isAdded ? 'default' : 'pointer',
                    flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                >
                  {isAdded ? (
                    <Check size={12} color="#4ade80" />
                  ) : (
                    <Plus size={12} color="var(--pipe-text-dim)" />
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          ...mono,
          fontSize: 8,
          color: 'var(--pipe-text-dim)',
          textAlign: 'center',
          letterSpacing: '0.08em',
        }}
      >
        {filtered.length} TEMPLATES
        {addedIds.size > 0 && ` — ${addedIds.size} STAGED`}
      </div>
    </div>
  );
}

// ─── AI Generated placeholder (Step 2c) ─────────────────────────────────────

function AiGeneratedPlaceholder({
  onBack,
}: {
  onBack: () => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onBack}
          style={{
            ...mono,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            background: 'none',
            border: '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: 'var(--pipe-text-dim)',
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.1em',
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={10} />
          BACK
        </button>
        <label style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>AI_GENERATION</label>
      </div>

      <div
        style={{
          padding: '32px 20px',
          textAlign: 'center',
          border: '1px dashed rgba(74,222,128,0.2)',
          borderRadius: 10,
          background: 'rgba(74,222,128,0.02)',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(74,222,128,0.08)',
            border: '1px solid rgba(74,222,128,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <Sparkles size={18} color="#4ade80" />
        </div>
        <div
          style={{
            ...mono,
            fontSize: 10,
            fontWeight: 700,
            color: '#4ade80',
            letterSpacing: '0.12em',
            marginBottom: 8,
          }}
        >
          CA_PHASE_3
        </div>
        <p
          style={{
            ...mono,
            fontSize: 9,
            color: 'var(--pipe-text-muted)',
            lineHeight: 1.7,
            margin: 0,
            maxWidth: 340,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          AI challenge generation from role discovery output.
          Multi-agent pipeline with confidence scoring.
          Coming in CA Phase 3.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 6,
            justifyContent: 'center',
            marginTop: 16,
            flexWrap: 'wrap',
          }}
        >
          {['CA-1', 'CA-2', 'CA-3', 'CA-4', 'CA-16'].map((id) => (
            <span
              key={id}
              style={{
                ...mono,
                fontSize: 7,
                color: 'var(--pipe-text-dim)',
                padding: '2px 6px',
                borderRadius: 2,
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
              }}
            >
              {id}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Custom question creator (Step 2d) ──────────────────────────────────────

function CustomCreator({
  onAdd,
  onBack,
}: {
  onAdd: (item: StagedChallenge) => void;
  onBack: () => void;
}): JSX.Element {
  const [selectedType, setSelectedType] = useState<TemplateType | null>(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');

  const handleCreate = useCallback(() => {
    if (!selectedType || !title.trim()) return;
    onAdd({
      id: `custom-${Date.now()}`,
      type: selectedType,
      title: title.trim(),
      instructions: instructions.trim() || title.trim(),
      config: selectedType === 'QUIZ_MCQ'
        ? { question: instructions.trim() || title.trim(), options: [], correctOptionId: '' }
        : selectedType === 'QUIZ_SHORT_ANSWER'
          ? { question: instructions.trim() || title.trim(), inputMode: 'text' }
          : {},
      source: 'custom',
    });
    setTitle('');
    setInstructions('');
  }, [selectedType, title, instructions, onAdd]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onBack}
          style={{
            ...mono,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            background: 'none',
            border: '1px solid var(--pipe-border)',
            borderRadius: 4,
            color: 'var(--pipe-text-dim)',
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.1em',
            cursor: 'pointer',
          }}
        >
          <ArrowLeft size={10} />
          BACK
        </button>
        <label style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>CUSTOM_CHALLENGE</label>
      </div>

      {/* Type picker */}
      <div>
        <label style={labelStyle}>CHALLENGE_TYPE</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['QUIZ_MCQ', 'CODE_IMPLEMENTATION', 'QUIZ_SHORT_ANSWER'] as const).map((type) => {
            const isActive = selectedType === type;
            const color = TYPE_BADGE_COLORS[type] ?? '#fff';
            const Icon = type === 'QUIZ_MCQ' ? CircleDot : type === 'CODE_IMPLEMENTATION' ? Code2 : MessageSquare;
            const label = type === 'QUIZ_MCQ' ? 'MCQ' : type === 'CODE_IMPLEMENTATION' ? 'CODE' : 'LONG-FORM';
            return (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                style={{
                  ...mono,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  background: isActive ? `${color}0a` : 'var(--pipe-surface)',
                  border: isActive ? `1px solid ${color}55` : '1px solid var(--pipe-border)',
                  color: isActive ? color : 'var(--pipe-text-dim)',
                }}
              >
                <Icon size={12} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {selectedType && (
        <>
          <div>
            <label style={labelStyle}>TITLE</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Challenge title..."
              style={{
                ...mono,
                width: '100%',
                padding: '9px 12px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 6,
                color: 'var(--pipe-text)',
                fontSize: 10,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={labelStyle}>INSTRUCTIONS</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Write the question or instructions..."
              rows={4}
              style={{
                ...mono,
                width: '100%',
                padding: '9px 12px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 6,
                color: 'var(--pipe-text)',
                fontSize: 10,
                outline: 'none',
                resize: 'vertical',
                lineHeight: 1.6,
                boxSizing: 'border-box',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleCreate();
                }
              }}
            />
            <div
              style={{
                ...mono,
                marginTop: 3,
                fontSize: 7,
                color: 'var(--pipe-text-dim)',
                opacity: 0.5,
              }}
            >
              {'\u2318\u21B5'} to add
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!title.trim()}
            style={{
              ...mono,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 20px',
              background: title.trim() ? '#fbbf24' : 'var(--pipe-surface)',
              border: title.trim() ? '1px solid #fbbf24' : '1px solid var(--pipe-border)',
              borderRadius: 6,
              color: title.trim() ? '#0c0c0e' : 'var(--pipe-text-dim)',
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.12em',
              cursor: title.trim() ? 'pointer' : 'not-allowed',
              alignSelf: 'flex-start',
            }}
          >
            <Plus size={11} />
            STAGE_CHALLENGE
          </button>
        </>
      )}
    </div>
  );
}

// ─── Staged queue ───────────────────────────────────────────────────────────

function StagedQueue({
  items,
  onRemove,
  onSave,
  isSaving,
}: {
  items: StagedChallenge[];
  onRemove: (index: number) => void;
  onSave: () => void;
  isSaving: boolean;
}): JSX.Element {
  if (items.length === 0) return <></>;

  return (
    <div
      style={{
        borderTop: '1px solid var(--pipe-border)',
        paddingTop: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <label style={labelStyle}>
        STAGED — {items.length} CHALLENGE{items.length !== 1 ? 'S' : ''}
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {items.map((item, i) => (
          <div
            key={`${item.id}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
            }}
          >
            <TypeBadge type={item.type} />
            <span
              style={{
                ...mono,
                fontSize: 9,
                color: 'var(--pipe-text)',
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.title}
            </span>
            <button
              onClick={() => onRemove(i)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--pipe-text-dim)',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={onSave}
        disabled={isSaving}
        style={{
          ...mono,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '12px 20px',
          background: isSaving ? 'var(--pipe-surface)' : 'var(--pipe-text)',
          border: '1px solid var(--pipe-text)',
          borderRadius: 6,
          color: isSaving ? 'var(--pipe-text-dim)' : 'var(--pipe-bg)',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.15em',
          cursor: isSaving ? 'wait' : 'pointer',
          opacity: isSaving ? 0.6 : 1,
        }}
      >
        {isSaving ? (
          <>
            <Loader2
              size={12}
              style={{ animation: 'spin 1s linear infinite' }}
            />
            SAVING...
          </>
        ) : (
          <>
            <Zap size={12} />
            ADD_{items.length}_CHALLENGE{items.length !== 1 ? 'S' : ''}
          </>
        )}
      </button>
    </div>
  );
}

// ─── Main ChallengeWizard ───────────────────────────────────────────────────

export interface ChallengeWizardProps {
  stageId: string;
  onClose: () => void;
}

export function ChallengeWizard({
  stageId,
  onClose,
}: ChallengeWizardProps): JSX.Element {
  const { createChallenge } = useChallengeMutations();
  const { triggerRefetch } = useStageRefetch();
  const { packs, isLoadingPacks, fetchPacks, fetchPackDetail } = useTemplateLibrary();

  const [source, setSource] = useState<WizardSource | null>(null);
  const [stagedItems, setStagedItems] = useState<StagedChallenge[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleStage = useCallback((item: StagedChallenge) => {
    setStagedItems((prev) => [...prev, item]);
  }, []);

  const handleRemove = useCallback((index: number) => {
    setStagedItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSelectPack = useCallback(
    async (pack: TemplatePackItem) => {
      const detail = await fetchPackDetail(pack.id);
      if (!detail?.items) return;

      const newItems = detail.items
        .filter((item) => item.challenge)
        .map((item): StagedChallenge => {
          const ch = item.challenge!;
          return {
            id: ch.id,
            type: ch.type,
            title: ch.title,
            instructions: ch.instructions,
            config: ch.config,
            ...(ch.serverConfig ? { serverConfig: ch.serverConfig } : {}),
            source: 'pack',
          };
        });

      setStagedItems((prev) => [...prev, ...newItems]);
    },
    [fetchPackDetail],
  );

  const handleSave = useCallback(async () => {
    if (stagedItems.length === 0) {
      onClose();
      return;
    }
    setIsSaving(true);
    try {
      for (let i = 0; i < stagedItems.length; i++) {
        const item = stagedItems[i]!;
        await createChallenge(stageId, {
          type: item.type as 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER',
          title: item.title,
          instructions: item.instructions,
          config: item.config,
          ...(item.serverConfig ? { serverConfig: item.serverConfig } : {}),
          order: i,
        });
      }
      await triggerRefetch();
      onClose();
    } catch (err) {
      console.error('[ChallengeWizard] Failed to save:', err);
    } finally {
      setIsSaving(false);
    }
  }, [stagedItems, stageId, createChallenge, triggerRefetch, onClose]);

  return (
    <div
      data-testid="challenge-wizard"
      style={{
        paddingTop: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Keyframes for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Step 1: Source selector */}
      {source === null && <SourceSelector onSelect={setSource} />}

      {/* Step 2a: Template packs */}
      {source === 'packs' && (
        <PackBrowser
          packs={packs}
          isLoading={isLoadingPacks}
          onSelectPack={(pack) => void handleSelectPack(pack)}
          onBack={() => setSource(null)}
          fetchPacks={fetchPacks}
        />
      )}

      {/* Step 2b: Library browser */}
      {source === 'library' && (
        <LibraryBrowser onAdd={handleStage} onBack={() => setSource(null)} />
      )}

      {/* Step 2c: AI generated */}
      {source === 'ai' && (
        <AiGeneratedPlaceholder onBack={() => setSource(null)} />
      )}

      {/* Step 2d: Custom creator */}
      {source === 'custom' && (
        <CustomCreator onAdd={handleStage} onBack={() => setSource(null)} />
      )}

      {/* Staged queue + save button */}
      <StagedQueue
        items={stagedItems}
        onRemove={handleRemove}
        onSave={() => void handleSave()}
        isSaving={isSaving}
      />
    </div>
  );
}
