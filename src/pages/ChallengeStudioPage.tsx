/**
 * ChallengeStudioPage — /challenges
 *
 * Personal challenge authoring workspace. Browse, generate, refine,
 * and organize challenges into role-specific packs.
 *
 * Two tabs: MY_CHALLENGES | MY_PACKS
 * Generate panel expands inline at the top.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Sparkles,
  Search,
  Trash2,
  Send,
  Copy,
  Package,
  Clock,
  Code2,
  CircleDot,
  MessageSquare,
  Filter,
  Loader2,
  Plus,
  GitBranch,
} from 'lucide-react';
import { ChallengeBriefWizard } from '../components/ChallengeStudio/ChallengeBriefWizard';
import { SectionCard } from '../components';
import {
  useTemplateLibrary,
  type ChallengeTemplateItem,
  type TemplatePackItem,
  type TemplateType,
  type TemplateDifficulty,
  type TemplateSource,
} from '../hooks/useTemplateLibrary';
import { useChallengeStudio } from '../hooks/useChallengeStudio';
import {
  useChallengeGeneration,
  type GeneratedChallengeItem,
  type GenerationConfig,
} from '../hooks/useChallengeGeneration';
import { usePipelines } from '../hooks/usePipelines';
import { useApiClient } from '../hooks/useApiClient';
import type { OverviewResponse } from '../lib/api/types';

// ─── Constants ──────────────────────────────────────────────────────────────

type StudioTab = 'challenges' | 'packs' | 'repos';
type SourceFilter = 'ALL' | TemplateSource;
type PublishedFilter = 'all' | 'drafts' | 'published';

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

const TYPE_BADGE: Record<string, { label: string; color: string; Icon: typeof Code2 }> = {
  CODE_IMPLEMENTATION: { label: 'CODE', color: '#a78bfa', Icon: Code2 },
  QUIZ_MCQ: { label: 'MCQ', color: '#4ade80', Icon: CircleDot },
  QUIZ_SHORT_ANSWER: { label: 'LONG-FORM', color: '#fbbf24', Icon: MessageSquare },
};

const DIFF_COLOR: Record<string, string> = {
  JUNIOR: '#4ade80',
  MID: '#fbbf24',
  SENIOR: '#f87171',
};

const TYPE_FILTERS: Array<{ key: TemplateType | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'ALL' },
  { key: 'QUIZ_MCQ', label: 'MCQ' },
  { key: 'CODE_IMPLEMENTATION', label: 'CODE' },
  { key: 'QUIZ_SHORT_ANSWER', label: 'LONG-FORM' },
];

const DIFF_FILTERS: Array<{ key: TemplateDifficulty | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'ALL' },
  { key: 'JUNIOR', label: 'JUNIOR' },
  { key: 'MID', label: 'MID' },
  { key: 'SENIOR', label: 'SENIOR' },
];

const SOURCE_FILTERS: Array<{ key: SourceFilter; label: string }> = [
  { key: 'ALL', label: 'ALL' },
  { key: 'AI_GENERATED', label: 'AI' },
  { key: 'USER_CREATED', label: 'CUSTOM' },
  { key: 'SYSTEM', label: 'SYSTEM' },
];

// ─── Pill button ────────────────────────────────────────────────────────────

function Pill({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}): JSX.Element {
  const c = color ?? 'var(--pipe-text)';
  return (
    <button
      onClick={onClick}
      style={{
        ...mono,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.1em',
        padding: '4px 10px',
        borderRadius: 3,
        border: `1px solid ${active ? c : 'var(--pipe-border)'}`,
        background: active ? `${c}18` : 'transparent',
        color: active ? c : 'var(--pipe-text-dim)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {label}
    </button>
  );
}

// ─── Confidence bar ─────────────────────────────────────────────────────────

function ConfBar({ value, label }: { value: number; label: string }): JSX.Element {
  const c = value >= 0.8 ? '#4ade80' : value >= 0.6 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ ...mono, fontSize: 7, color: 'var(--pipe-text-dim)', width: 42, letterSpacing: '0.05em' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 3, background: 'var(--pipe-surface)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(value * 100)}%`, height: '100%', background: c, borderRadius: 2 }} />
      </div>
      <span style={{ ...mono, fontSize: 7, color: c, fontWeight: 700, width: 20, textAlign: 'right' }}>
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

// ─── Challenge card ─────────────────────────────────────────────────────────

function ChallengeCard({
  item,
  onPublish,
  onDelete,
}: {
  item: ChallengeTemplateItem;
  onPublish: () => void;
  onDelete: () => void;
}): JSX.Element {
  const badge = TYPE_BADGE[item.type] ?? { label: item.type, color: 'var(--pipe-text-dim)', Icon: Filter };
  const diffColor = DIFF_COLOR[item.difficulty] ?? 'var(--pipe-text-dim)';

  return (
    <div
      style={{
        padding: '16px 18px',
        border: '1px solid var(--pipe-border)',
        borderRadius: 8,
        background: 'var(--pipe-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Top row: badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            ...mono,
            fontSize: 8,
            fontWeight: 700,
            color: badge.color,
            padding: '2px 7px',
            borderRadius: 3,
            background: `${badge.color}15`,
            border: `1px solid ${badge.color}30`,
            letterSpacing: '0.1em',
          }}
        >
          {badge.label}
        </span>
        <span style={{ ...mono, fontSize: 8, fontWeight: 700, color: diffColor, letterSpacing: '0.1em' }}>
          {item.difficulty}
        </span>
        <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
          {item.primarySkill}
        </span>
        {item.estimatedMinutes && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
            <Clock size={9} /> {item.estimatedMinutes}m
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: 'var(--pipe-text)', lineHeight: 1.4 }}>
        {item.title}
      </div>

      {/* Instructions preview */}
      <div
        style={{
          ...mono,
          fontSize: 10,
          color: 'var(--pipe-text-muted)',
          lineHeight: 1.6,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {item.instructions}
      </div>

      {/* Status + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
        <span
          style={{
            ...mono,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: item.isPublished ? '#4ade80' : 'var(--pipe-text-dim)',
          }}
        >
          {item.isPublished ? 'PUBLISHED' : 'DRAFT'}
        </span>
        {item.source === 'AI_GENERATED' && (
          <span style={{ ...mono, fontSize: 7, color: '#a78bfa', letterSpacing: '0.08em' }}>AI</span>
        )}
        <div style={{ flex: 1 }} />
        {!item.isPublished && (
          <button
            onClick={onPublish}
            style={{
              ...mono,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '0.1em',
              padding: '4px 10px',
              background: 'rgba(74,222,128,0.08)',
              border: '1px solid rgba(74,222,128,0.25)',
              borderRadius: 3,
              color: '#4ade80',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Send size={9} /> PUBLISH
          </button>
        )}
        {!item.isPublished && (
          <button
            onClick={onDelete}
            style={{
              ...mono,
              fontSize: 8,
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              borderRadius: 3,
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Trash2 size={9} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Pack card ──────────────────────────────────────────────────────────────

function PackCard({
  pack,
  onPublish,
  onDelete,
  onDuplicate,
}: {
  pack: TemplatePackItem;
  onPublish: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}): JSX.Element {
  const senColor = DIFF_COLOR[pack.seniority] ?? 'var(--pipe-text-dim)';

  return (
    <div
      style={{
        padding: '16px 18px',
        border: '1px solid var(--pipe-border)',
        borderRadius: 8,
        background: 'var(--pipe-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Package size={14} color="var(--pipe-text-dim)" />
        <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: 'var(--pipe-text)' }}>
          {pack.name}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: 8, fontWeight: 700, color: '#60a5fa', padding: '2px 7px', borderRadius: 3, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', letterSpacing: '0.08em' }}>
          {pack.roleType}
        </span>
        <span style={{ ...mono, fontSize: 8, fontWeight: 700, color: senColor, letterSpacing: '0.1em' }}>
          {pack.seniority}
        </span>
        {pack.skills.slice(0, 4).map((s) => (
          <span key={s} style={{ ...mono, fontSize: 7, color: 'var(--pipe-text-dim)', padding: '2px 5px', borderRadius: 2, border: '1px solid var(--pipe-border)' }}>
            {s}
          </span>
        ))}
      </div>

      {pack.description && (
        <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-muted)', lineHeight: 1.5 }}>
          {pack.description}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
        <span style={{ ...mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: pack.isPublished ? '#4ade80' : 'var(--pipe-text-dim)' }}>
          {pack.isPublished ? 'PUBLISHED' : 'DRAFT'}
        </span>
        <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
          v{pack.version}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onDuplicate}
          style={{ ...mono, fontSize: 8, padding: '4px 8px', background: 'transparent', border: '1px solid var(--pipe-border)', borderRadius: 3, color: 'var(--pipe-text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <Copy size={9} /> DUPLICATE
        </button>
        {!pack.isPublished && (
          <>
            <button
              onClick={onPublish}
              style={{ ...mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', padding: '4px 10px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 3, color: '#4ade80', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Send size={9} /> PUBLISH
            </button>
            <button
              onClick={onDelete}
              style={{ ...mono, fontSize: 8, padding: '4px 8px', background: 'transparent', border: '1px solid var(--pipe-border)', borderRadius: 3, color: 'var(--pipe-text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Trash2 size={9} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Generate panel ─────────────────────────────────────────────────────────

function GeneratePanel({
  onSaved,
}: {
  onSaved: () => void;
}): JSX.Element {
  const { generate, result, isGenerating, error, reset, removeChallenge } = useChallengeGeneration();
  const { batchSave } = useChallengeStudio();
  const { pipelines } = usePipelines();
  const api = useApiClient();
  const [selectedPipelineId, setSelectedPipelineId] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(5);
  const [isSaving, setIsSaving] = useState(false);

  const toggleType = useCallback((key: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    const config: GenerationConfig = { count } as GenerationConfig;
    if (selectedTypes.size > 0) config.types = [...selectedTypes];

    // If a pipeline is selected, resolve its role context
    if (selectedPipelineId) {
      try {
        const overview = await api.get<OverviewResponse>(`/api/v1/pipelines/${selectedPipelineId}/overview`);
        if (overview.roleContext?.id) {
          config.roleContextId = overview.roleContext.id;
        }
      } catch (err) {
        console.error('[GeneratePanel] Failed to fetch overview:', err);
      }
    }

    // Generate — works with or without roleContextId
    await generate(config);
  }, [selectedPipelineId, selectedTypes, count, generate, api]);

  const handleSaveAll = useCallback(async () => {
    if (!result || result.challenges.length === 0) return;
    setIsSaving(true);
    try {
      await batchSave({
        challenges: result.challenges.map((c) => ({
          type: c.challenge.type,
          title: c.challenge.title,
          instructions: c.challenge.instructions,
          difficulty: c.challenge.difficulty,
          primarySkill: c.challenge.primarySkill,
          secondarySkills: c.challenge.secondarySkills,
          bloomLevel: c.challenge.bloomLevel,
          estimatedMinutes: c.challenge.estimatedMinutes,
          config: c.challenge.config,
        })),
      });
      reset();
      onSaved();
    } catch (err) {
      console.error('[GeneratePanel] batchSave failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [result, batchSave, reset, onSaved]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Config row */}
      {!result && !isGenerating && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ ...mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', display: 'block', marginBottom: 6 }}>
              PIPELINE
            </label>
            <select
              value={selectedPipelineId}
              onChange={(e) => setSelectedPipelineId(e.target.value)}
              style={{
                ...mono,
                width: '100%',
                padding: '8px 12px',
                fontSize: 10,
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text)',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="">Select a pipeline...</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ ...mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', display: 'block', marginBottom: 6 }}>
              TYPES
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {TYPE_FILTERS.slice(1).map(({ key, label }) => (
                <Pill key={key} label={label} active={selectedTypes.has(key)} onClick={() => toggleType(key)} />
              ))}
            </div>
          </div>
          <div>
            <label style={{ ...mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', display: 'block', marginBottom: 6 }}>
              COUNT: {count}
            </label>
            <input
              type="range" min={1} max={10} value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              style={{ width: 100, accentColor: '#4ade80' }}
            />
          </div>
          <button
            onClick={() => void handleGenerate()}
            style={{
              ...mono,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              background: 'rgba(74,222,128,0.1)',
              border: '1px solid rgba(74,222,128,0.3)',
              borderRadius: 4,
              color: '#4ade80',
              cursor: 'pointer',
            }}
          >
            <Sparkles size={12} /> GENERATE
          </button>
        </div>
      )}

      {/* Loading */}
      {isGenerating && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Loader2 size={20} color="var(--pipe-text-dim)" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
          <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)', letterSpacing: '0.1em' }}>
            RUNNING_PIPELINE...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ ...mono, fontSize: 10, color: '#f87171', padding: '10px 14px', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 6, background: 'rgba(248,113,113,0.05)' }}>
          {error}
          <button onClick={() => void handleGenerate()} style={{ ...mono, marginLeft: 12, fontSize: 9, padding: '3px 8px', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 3, background: 'transparent', color: '#f87171', cursor: 'pointer' }}>
            RETRY
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)', letterSpacing: '0.1em' }}>
              {result.challenges.length} PASSED / {result.totalGenerated} GENERATED
              {result.totalRejected > 0 && <span style={{ color: '#f87171' }}> ({result.totalRejected} REJECTED)</span>}
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => void handleSaveAll()}
              disabled={isSaving || result.challenges.length === 0}
              style={{
                ...mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                padding: '6px 14px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                borderRadius: 4, color: '#4ade80', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                opacity: isSaving ? 0.6 : 1,
              }}
            >
              {isSaving ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={10} />}
              SAVE_ALL_AS_DRAFTS
            </button>
            <button
              onClick={reset}
              style={{ ...mono, fontSize: 9, padding: '6px 10px', background: 'transparent', border: '1px solid var(--pipe-border)', borderRadius: 4, color: 'var(--pipe-text-dim)', cursor: 'pointer' }}
            >
              CLEAR
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
            {result.challenges.map((item, i) => (
              <GeneratedCard key={i} item={item} onRemove={() => removeChallenge(i)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GeneratedCard({ item, onRemove }: { item: GeneratedChallengeItem; onRemove: () => void }): JSX.Element {
  const badge = TYPE_BADGE[item.challenge.type] ?? { label: item.challenge.type, color: 'var(--pipe-text-dim)', Icon: Filter };
  const diffColor = DIFF_COLOR[item.challenge.difficulty] ?? 'var(--pipe-text-dim)';

  return (
    <div style={{ padding: '14px 16px', border: '1px solid var(--pipe-border)', borderRadius: 8, background: 'var(--pipe-surface)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ ...mono, fontSize: 8, fontWeight: 700, color: badge.color, padding: '2px 6px', borderRadius: 3, background: `${badge.color}15`, border: `1px solid ${badge.color}30`, letterSpacing: '0.08em' }}>
          {badge.label}
        </span>
        <span style={{ ...mono, fontSize: 8, fontWeight: 700, color: diffColor, letterSpacing: '0.1em' }}>{item.challenge.difficulty}</span>
        <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>{item.challenge.primarySkill}</span>
        <button onClick={onRemove} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer', padding: 2 }}>
          <Trash2 size={10} />
        </button>
      </div>
      <div style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--pipe-text)', lineHeight: 1.4 }}>{item.challenge.title}</div>
      <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-muted)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {item.challenge.instructions}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <ConfBar value={item.confidence.topicRelevance} label="TOPIC" />
        <ConfBar value={item.confidence.roleFit} label="FIT" />
        <ConfBar value={item.confidence.clarity} label="CLEAR" />
      </div>
      {(item.issues.length > 0 || item.calibrationWarnings.length > 0) && (
        <div style={{ ...mono, fontSize: 7, color: '#fbbf24', lineHeight: 1.5 }}>
          {[...item.issues, ...item.calibrationWarnings].map((w, j) => <div key={j}>{w}</div>)}
        </div>
      )}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function ChallengeStudioPage(): JSX.Element {
  const [tab, setTab] = useState<StudioTab>('challenges');
  const [typeFilter, setTypeFilter] = useState<TemplateType | 'ALL'>('ALL');
  const [diffFilter, setDiffFilter] = useState<TemplateDifficulty | 'ALL'>('ALL');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');
  const [pubFilter, setPubFilter] = useState<PublishedFilter>('all');
  const [search, setSearch] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [mounted, setMounted] = useState(false);

  const {
    templates,
    packs,
    isLoadingTemplates,
    isLoadingPacks,
    fetchTemplates,
    fetchPacks,
  } = useTemplateLibrary();
  const { publishTemplate, deleteTemplate, publishPack, deletePack, duplicatePack } = useChallengeStudio();

  useEffect(() => { setMounted(true); }, []);

  // Fetch with current filters
  const refetchTemplates = useCallback(() => {
    const filters: Record<string, string | undefined> = {};
    if (typeFilter !== 'ALL') filters.type = typeFilter;
    if (diffFilter !== 'ALL') filters.difficulty = diffFilter;
    if (sourceFilter !== 'ALL') filters.source = sourceFilter;
    if (search) filters.search = search;
    const published = pubFilter === 'all' ? 'all' : pubFilter === 'drafts' ? 'false' : 'true';
    void fetchTemplates({ ...filters, published } as Parameters<typeof fetchTemplates>[0]);
  }, [typeFilter, diffFilter, sourceFilter, pubFilter, search, fetchTemplates]);

  const refetchPacks = useCallback(() => {
    const published = pubFilter === 'all' ? 'all' : pubFilter === 'drafts' ? 'false' : 'true';
    void fetchPacks({ published } as Parameters<typeof fetchPacks>[0]);
  }, [pubFilter, fetchPacks]);

  useEffect(() => {
    if (tab === 'challenges') refetchTemplates();
    else if (tab === 'packs') refetchPacks();
    // repos tab manages its own fetching via useRepoDiscovery
  }, [tab, refetchTemplates, refetchPacks]);

  const stats = useMemo(() => ({
    drafts: templates.filter((t) => !t.isPublished).length,
    published: templates.filter((t) => t.isPublished).length,
  }), [templates]);

  const handlePublishTemplate = useCallback(async (id: string) => {
    try { await publishTemplate(id); refetchTemplates(); } catch (err) { console.error('[Studio] publish failed:', err); }
  }, [publishTemplate, refetchTemplates]);

  const handleDeleteTemplate = useCallback(async (id: string) => {
    try { await deleteTemplate(id); refetchTemplates(); } catch (err) { console.error('[Studio] delete failed:', err); }
  }, [deleteTemplate, refetchTemplates]);

  const handlePublishPack = useCallback(async (id: string) => {
    try { await publishPack(id); refetchPacks(); } catch (err) { console.error('[Studio] publishPack failed:', err); }
  }, [publishPack, refetchPacks]);

  const handleDeletePack = useCallback(async (id: string) => {
    try { await deletePack(id); refetchPacks(); } catch (err) { console.error('[Studio] deletePack failed:', err); }
  }, [deletePack, refetchPacks]);

  const handleDuplicatePack = useCallback(async (id: string) => {
    try { await duplicatePack(id); refetchPacks(); } catch (err) { console.error('[Studio] duplicatePack failed:', err); }
  }, [duplicatePack, refetchPacks]);

  return (
    <div
      style={{
        opacity: mounted ? 1 : 0,
        transition: 'opacity 0.4s ease',
        padding: '0 0 80px',
        maxWidth: 1400,
        margin: '0 auto',
      }}
    >
      {/* Header — hidden on CREATE_BRIEFS tab */}
      {tab !== 'repos' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
          <div>
            <div style={{ ...mono, fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 8 }}>
              CHALLENGE_STUDIO
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--pipe-text)', margin: 0 }}>
              My Challenges
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 12, ...mono, fontSize: 10 }}>
              <span style={{ color: 'var(--pipe-text-dim)' }}>{stats.drafts} DRAFTS</span>
              <span style={{ color: '#4ade80' }}>{stats.published} PUBLISHED</span>
            </div>
            <button
              onClick={() => setShowGenerate((p) => !p)}
              style={{
                ...mono,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                background: showGenerate ? 'rgba(74,222,128,0.1)' : 'var(--pipe-surface)',
                border: `1px solid ${showGenerate ? 'rgba(74,222,128,0.3)' : 'var(--pipe-border)'}`,
                color: showGenerate ? '#4ade80' : 'var(--pipe-text)',
                fontSize: 10,
                letterSpacing: '0.1em',
                cursor: 'pointer',
              }}
            >
              <Sparkles size={14} />
              {showGenerate ? 'HIDE_GENERATOR' : 'GENERATE'}
            </button>
          </div>
        </div>
      )}

      {/* Generate panel — hidden on CREATE_BRIEFS tab */}
      {tab !== 'repos' && showGenerate && (
        <SectionCard label="AI_GENERATOR" icon={<Sparkles size={14} />}>
          <GeneratePanel onSaved={refetchTemplates} />
        </SectionCard>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--pipe-border)' }}>
        {(['challenges', 'packs', 'repos'] as const).map((t) => {
          const labels: Record<StudioTab, string> = {
            challenges: 'MY_CHALLENGES',
            packs: 'MY_PACKS',
            repos: 'CREATE_BRIEFS',
          };
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                ...mono,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.15em',
                padding: '10px 20px',
                background: 'transparent',
                border: 'none',
                borderBottom: tab === t ? '2px solid var(--pipe-text)' : '2px solid transparent',
                color: tab === t ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {t === 'repos' && <GitBranch size={11} />}
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* Filters (challenges tab) */}
      {tab === 'challenges' && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Type */}
          <div style={{ display: 'flex', gap: 4 }}>
            {TYPE_FILTERS.map(({ key, label }) => (
              <Pill key={key} label={label} active={typeFilter === key} onClick={() => setTypeFilter(key)} />
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--pipe-border)' }} />
          {/* Difficulty */}
          <div style={{ display: 'flex', gap: 4 }}>
            {DIFF_FILTERS.map(({ key, label }) => (
              <Pill key={key} label={label} active={diffFilter === key} onClick={() => setDiffFilter(key)} {...(key !== 'ALL' ? { color: DIFF_COLOR[key] } : {})} />
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--pipe-border)' }} />
          {/* Source */}
          <div style={{ display: 'flex', gap: 4 }}>
            {SOURCE_FILTERS.map(({ key, label }) => (
              <Pill key={key} label={label} active={sourceFilter === key} onClick={() => setSourceFilter(key)} />
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--pipe-border)' }} />
          {/* Published toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            {([['all', 'ALL'], ['drafts', 'DRAFTS'], ['published', 'PUBLISHED']] as const).map(([k, l]) => (
              <Pill key={k} label={l} active={pubFilter === k} onClick={() => setPubFilter(k)} />
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '1px solid var(--pipe-border)', borderRadius: 4 }}>
            <Search size={12} color="var(--pipe-text-dim)" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SEARCH..."
              style={{ ...mono, fontSize: 9, background: 'transparent', border: 'none', outline: 'none', color: 'var(--pipe-text)', width: 120, letterSpacing: '0.05em' }}
            />
          </div>
        </div>
      )}

      {/* Content: challenges */}
      {tab === 'challenges' && (
        <>
          {isLoadingTemplates && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Loader2 size={18} color="var(--pipe-text-dim)" style={{ animation: 'spin 1s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          {!isLoadingTemplates && templates.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <Sparkles size={28} color="var(--pipe-text-dim)" style={{ margin: '0 auto 16px' }} />
              <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: 'var(--pipe-text)', marginBottom: 8 }}>
                No challenges yet
              </div>
              <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-muted)', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
                Generate your first challenges from a role discovery, or create one from scratch.
              </div>
              <button
                onClick={() => setShowGenerate(true)}
                style={{
                  ...mono, marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '10px 20px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                  background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                  borderRadius: 4, color: '#4ade80', cursor: 'pointer',
                }}
              >
                <Sparkles size={12} /> GENERATE_CHALLENGES
              </button>
            </div>
          )}
          {!isLoadingTemplates && templates.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
              {templates.map((t) => (
                <ChallengeCard
                  key={t.id}
                  item={t}
                  onPublish={() => void handlePublishTemplate(t.id)}
                  onDelete={() => void handleDeleteTemplate(t.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Content: packs */}
      {tab === 'packs' && (
        <>
          {isLoadingPacks && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Loader2 size={18} color="var(--pipe-text-dim)" style={{ animation: 'spin 1s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          {!isLoadingPacks && packs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <Package size={28} color="var(--pipe-text-dim)" style={{ margin: '0 auto 16px' }} />
              <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: 'var(--pipe-text)', marginBottom: 8 }}>
                No packs yet
              </div>
              <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-muted)', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
                Create a pack to bundle challenges for a specific role and seniority.
              </div>
            </div>
          )}
          {!isLoadingPacks && packs.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 14 }}>
              {packs.map((p) => (
                <PackCard
                  key={p.id}
                  pack={p}
                  onPublish={() => void handlePublishPack(p.id)}
                  onDelete={() => void handleDeletePack(p.id)}
                  onDuplicate={() => void handleDuplicatePack(p.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Content: challenge brief wizard */}
      {tab === 'repos' && (
        <ChallengeBriefWizard
          onComplete={(briefs) => {
            // TODO: persist briefs to challenge library via API
            console.log('[ChallengeStudio] briefs approved:', briefs.length);
            setTab('challenges');
            void refetchTemplates();
          }}
          onCancel={() => setTab('challenges')}
        />
      )}
    </div>
  );
}
