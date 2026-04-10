/**
 * ChallengeBriefWizard — multi-step wizard for creating challenge briefs.
 *
 * Flow:
 *   [1. Define]  →  [2. Discover]  →  [3. Review Repos]  →  [4. Generate Briefs]  →  [5. Review Briefs]
 *
 * Output: challenge briefs usable for both CODE_REVIEW (planted bugs, multi-PR)
 * and CODE_IMPLEMENTATION (implementation tasks, test harness) stages.
 *
 * Replaces the flat ReposTab with a gated approval flow per CR-13.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Crosshair,
  Search,
  CheckCircle2,
  Sparkles,
  FileCheck,
  GitBranch,
  Star,
  ExternalLink,
  Check,
  Loader2,
  AlertCircle,
  Zap,
  Code2,
  MessageSquare,
} from 'lucide-react';
import { Wizard, WizardStepContent, type WizardStep } from '../ui/Wizard';
import { SectionCard } from '../../components';
import { usePipelines } from '../../hooks/usePipelines';
import { useApiClient } from '../../hooks/useApiClient';
import {
  useRepoDiscovery,
  type DiscoveredRepo,
} from '../../hooks/useRepoDiscovery';
import type { OverviewResponse } from '../../lib/api/types';

/* ------------------------------------------------------------------ */
/*  Shared styles                                                      */
/* ------------------------------------------------------------------ */

const mono: React.CSSProperties = { fontFamily: '"Space Mono", monospace' };

/* Status colors kept inline where needed to avoid unused-var lint. */

/* ------------------------------------------------------------------ */
/*  Brief types                                                        */
/* ------------------------------------------------------------------ */

export interface ChallengeBrief {
  repoId: string;
  repoName: string;
  githubUrl: string;
  /** Which challenge types this brief supports. */
  challengeTypes: Array<'CODE_REVIEW' | 'CODE_IMPLEMENTATION'>;
  /** Brief title for the recruiter. */
  title: string;
  /** Short description of what the candidate will do. */
  description: string;
  /** Suggested difficulty. */
  difficulty: 'JUNIOR' | 'MID' | 'SENIOR';
  /** Skills exercised. */
  skills: string[];
  /** For CODE_REVIEW: suggested PRs to review. */
  suggestedPRs: Array<{ number: number; title: string; additions: number; deletions: number }>;
  /** For CODE_IMPLEMENTATION: suggested implementation tasks. */
  suggestedTasks: string[];
  /** Generation status. */
  status: 'pending' | 'generating' | 'ready' | 'error';
}

/* ------------------------------------------------------------------ */
/*  Wizard definition                                                  */
/* ------------------------------------------------------------------ */

export interface ChallengeBriefWizardProps {
  /** Called when the wizard completes with approved briefs. */
  onComplete?: (briefs: ChallengeBrief[]) => void;
  /** Called when the user cancels. */
  onCancel?: () => void;
}

export function ChallengeBriefWizard({
  onComplete,
  onCancel,
}: ChallengeBriefWizardProps): JSX.Element {
  // ── Shared state ──────────────────────────────────────────────────
  const { pipelines, isLoading: pipelinesLoading } = usePipelines();
  const api = useApiClient();
  const discovery = useRepoDiscovery();

  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [personaSkills, setPersonaSkills] = useState<string[]>([]);
  const [manualSkillInput, setManualSkillInput] = useState('');
  const [approvedRepoIds, setApprovedRepoIds] = useState<Set<string>>(new Set());
  const [briefs, setBriefs] = useState<ChallengeBrief[]>([]);
  const [approvedBriefIndices, setApprovedBriefIndices] = useState<Set<number>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);

  // Fetch persona when pipeline changes (optional — manual entry works too)
  useEffect(() => {
    if (!selectedPipelineId) return;
    void (async () => {
      try {
        const data = await api.get<OverviewResponse>(
          `/api/v1/pipelines/${selectedPipelineId}/overview`,
        );
        const detected = data.roleContext?.persona?.mustHaveSkills ?? [];
        if (detected.length > 0) setPersonaSkills(detected);
      } catch {
        // Pipeline fetch failed — user can still enter skills manually
      }
    })();
  }, [selectedPipelineId, api]);

  const addManualSkill = useCallback(() => {
    // Split by comma so "Redux, Next" becomes ["Redux", "Next"]
    const parts = manualSkillInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length > 0) {
      setPersonaSkills((prev) => {
        const next = [...prev];
        for (const skill of parts) {
          if (!next.includes(skill)) next.push(skill);
        }
        return next;
      });
    }
    setManualSkillInput('');
  }, [manualSkillInput, personaSkills]);

  const removeSkill = useCallback((skill: string) => {
    setPersonaSkills((prev) => prev.filter((s) => s !== skill));
  }, []);

  // ── Step gates ────────────────────────────────────────────────────
  const hasSkills = personaSkills.length > 0;
  const hasDiscoveredRepos = discovery.repos.length > 0 && !discovery.isDiscovering;
  const hasApprovedRepos = approvedRepoIds.size > 0;
  const hasBriefs = briefs.length > 0 && briefs.every((b) => b.status === 'ready');
  const hasApprovedBriefs = approvedBriefIndices.size > 0;

  const steps = useMemo<WizardStep[]>(() => [
    {
      id: 'define',
      label: 'Define Role',
      icon: <Crosshair size={14} />,
      canAdvance: () => hasSkills,
    },
    {
      id: 'discover',
      label: 'Discover Repos',
      icon: <Search size={14} />,
      canAdvance: () => hasDiscoveredRepos,
    },
    {
      id: 'review-repos',
      label: 'Review Repos',
      icon: <CheckCircle2 size={14} />,
      requiresApproval: true,
      canAdvance: () => hasApprovedRepos,
    },
    {
      id: 'generate',
      label: 'Generate Briefs',
      icon: <Sparkles size={14} />,
      canAdvance: () => hasBriefs,
    },
    {
      id: 'review-briefs',
      label: 'Review Briefs',
      icon: <FileCheck size={14} />,
      requiresApproval: true,
      canAdvance: () => hasApprovedBriefs,
    },
  ], [hasSkills, hasDiscoveredRepos, hasApprovedRepos, hasBriefs, hasApprovedBriefs]);

  // ── Handlers ──────────────────────────────────────────────────────

  const handleDiscover = useCallback(async () => {
    if (personaSkills.length === 0) return;
    // Discovery always runs from the skill list — pipeline is optional and
    // only used to auto-populate skills. This avoids the "no persona" error.
    await discovery.startDiscoveryBySkills(personaSkills);
  }, [personaSkills, discovery]);

  const toggleRepoApproval = useCallback((repoId: string) => {
    setApprovedRepoIds((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  }, []);

  const handleGenerateBriefs = useCallback(async () => {
    const approved = discovery.repos.filter((r) => approvedRepoIds.has(r.id));
    if (approved.length === 0) return;

    setIsGenerating(true);

    // Create placeholder briefs
    const placeholders: ChallengeBrief[] = approved.map((repo) => ({
      repoId: repo.id,
      repoName: `${repo.githubOwner}/${repo.githubRepo}`,
      githubUrl: repo.githubUrl,
      challengeTypes: ['CODE_REVIEW', 'CODE_IMPLEMENTATION'],
      title: '',
      description: '',
      difficulty: (repo.seniorityBand as ChallengeBrief['difficulty']) ?? 'MID',
      skills: personaSkills.slice(0, 5),
      suggestedPRs: [],
      suggestedTasks: [],
      status: 'generating',
    }));
    setBriefs(placeholders);

    // Generate briefs for each repo
    const results: ChallengeBrief[] = [];
    for (const repo of approved) {
      try {
        const data = await api.post<{
          title: string;
          description: string;
          suggestedPRs: ChallengeBrief['suggestedPRs'];
          suggestedTasks: string[];
        }>(`/api/v1/repos/${repo.id}/brief`, {
          skills: personaSkills,
        });

        results.push({
          repoId: repo.id,
          repoName: `${repo.githubOwner}/${repo.githubRepo}`,
          githubUrl: repo.githubUrl,
          challengeTypes: ['CODE_REVIEW', 'CODE_IMPLEMENTATION'],
          title: data.title,
          description: data.description,
          difficulty: (repo.seniorityBand as ChallengeBrief['difficulty']) ?? 'MID',
          skills: personaSkills.slice(0, 5),
          suggestedPRs: data.suggestedPRs,
          suggestedTasks: data.suggestedTasks,
          status: 'ready',
        });
      } catch {
        results.push({
          ...placeholders.find((p) => p.repoId === repo.id)!,
          status: 'error',
        });
      }

      // Update briefs progressively
      setBriefs([...results, ...placeholders.slice(results.length)]);
    }

    setIsGenerating(false);
  }, [discovery.repos, approvedRepoIds, personaSkills, api]);

  const toggleBriefApproval = useCallback((index: number) => {
    setApprovedBriefIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleComplete = useCallback(async () => {
    const approved = briefs.filter((_, i) => approvedBriefIndices.has(i));
    if (approved.length === 0) return;

    try {
      await api.post<{ created: Array<{ id: string; type: string; title: string }> }>(
        '/api/v1/repos/briefs/save',
        {
          briefs: approved.map((b) => ({
            repoId: b.repoId,
            title: b.title,
            description: b.description,
            difficulty: b.difficulty,
            skills: b.skills,
            challengeTypes: b.challengeTypes,
            suggestedPRs: b.suggestedPRs,
            suggestedTasks: b.suggestedTasks,
          })),
        },
      );
      onComplete?.(approved);
    } catch (err) {
      console.error('[ChallengeBriefWizard] save failed:', err);
    }
  }, [briefs, approvedBriefIndices, api, onComplete]);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <Wizard
      steps={steps}
      onComplete={handleComplete}
      {...(onCancel ? { onCancel } : {})}
      data-testid="challenge-brief-wizard"
    >
      {/* Step 1: Define Role */}
      <WizardStepContent stepId="define">
        <DefineStep
          pipelines={pipelines}
          pipelinesLoading={pipelinesLoading}
          selectedPipelineId={selectedPipelineId}
          onSelectPipeline={setSelectedPipelineId}
          personaSkills={personaSkills}
          manualSkillInput={manualSkillInput}
          onManualSkillInputChange={setManualSkillInput}
          onAddSkill={addManualSkill}
          onRemoveSkill={removeSkill}
        />
      </WizardStepContent>

      {/* Step 2: Discover Repos */}
      <WizardStepContent stepId="discover">
        <DiscoverStep
          personaSkills={personaSkills}
          isDiscovering={discovery.isDiscovering}
          job={discovery.job}
          repos={discovery.repos}
          isLoadingRepos={discovery.isLoadingRepos}
          error={discovery.error}
          onDiscover={handleDiscover}
        />
      </WizardStepContent>

      {/* Step 3: Review & Approve Repos */}
      <WizardStepContent stepId="review-repos">
        <ReviewReposStep
          repos={discovery.repos}
          approvedIds={approvedRepoIds}
          onToggle={toggleRepoApproval}
        />
      </WizardStepContent>

      {/* Step 4: Generate Briefs */}
      <WizardStepContent stepId="generate">
        <GenerateStep
          briefs={briefs}
          isGenerating={isGenerating}
          onGenerate={handleGenerateBriefs}
          approvedCount={approvedRepoIds.size}
        />
      </WizardStepContent>

      {/* Step 5: Review Briefs */}
      <WizardStepContent stepId="review-briefs">
        <ReviewBriefsStep
          briefs={briefs}
          approvedIndices={approvedBriefIndices}
          onToggle={toggleBriefApproval}
        />
      </WizardStepContent>
    </Wizard>
  );
}

/* ================================================================== */
/*  Step 1 — Define Role                                               */
/* ================================================================== */

function DefineStep({
  pipelines,
  pipelinesLoading,
  selectedPipelineId,
  onSelectPipeline,
  personaSkills,
  manualSkillInput,
  onManualSkillInputChange,
  onAddSkill,
  onRemoveSkill,
}: {
  pipelines: Array<{ id: string; title: string; level: string | null }>;
  pipelinesLoading: boolean;
  selectedPipelineId: string | null;
  onSelectPipeline: (id: string | null) => void;
  personaSkills: string[];
  manualSkillInput: string;
  onManualSkillInputChange: (value: string) => void;
  onAddSkill: () => void;
  onRemoveSkill: (skill: string) => void;
}): JSX.Element {
  return (
    <SectionCard label="DEFINE_SKILLS" icon={<Crosshair size={14} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.04em', lineHeight: 1.6 }}>
          Define the tech stack to search for. Select a pipeline to auto-detect skills
          from role discovery, or enter skills manually.
        </div>

        {/* Pipeline selector (optional) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.15em', fontWeight: 700 }}>
            FROM PIPELINE (OPTIONAL)
          </span>
          <select
            value={selectedPipelineId ?? ''}
            onChange={(e) => onSelectPipeline(e.target.value || null)}
            disabled={pipelinesLoading}
            style={{
              ...mono,
              fontSize: 11,
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text)',
              padding: '10px 14px',
              maxWidth: 500,
            }}
          >
            <option value="">Select a pipeline...</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}{p.level ? ` (${p.level})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Manual skill input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.15em', fontWeight: 700 }}>
            SKILLS / TECH STACK
          </span>
          <div style={{ display: 'flex', gap: 8, maxWidth: 500 }}>
            <input
              type="text"
              value={manualSkillInput}
              onChange={(e) => onManualSkillInputChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddSkill(); } }}
              placeholder="e.g. React, TypeScript, NestJS (comma-separated)"
              style={{
                ...mono,
                flex: 1,
                fontSize: 11,
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text)',
                padding: '10px 14px',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={onAddSkill}
              disabled={!manualSkillInput.trim()}
              style={{
                ...mono,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                padding: '10px 16px',
                background: manualSkillInput.trim() ? 'rgba(96,165,250,0.12)' : 'var(--pipe-surface)',
                border: `1px solid ${manualSkillInput.trim() ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
                borderRadius: 4,
                color: manualSkillInput.trim() ? '#60a5fa' : 'var(--pipe-text-dim)',
                cursor: manualSkillInput.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              ADD
            </button>
          </div>
        </div>

        {/* Skills display */}
        {personaSkills.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {personaSkills.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onRemoveSkill(s)}
                style={{
                  ...mono,
                  fontSize: 9,
                  color: '#60a5fa',
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: 'rgba(96,165,250,0.1)',
                  border: '1px solid rgba(96,165,250,0.2)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease',
                }}
              >
                {s}
                <span style={{ fontSize: 11, color: 'rgba(96,165,250,0.5)' }}>×</span>
              </button>
            ))}
          </div>
        )}

        {personaSkills.length === 0 && (
          <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)', fontStyle: 'italic' }}>
            Add at least one skill to continue.
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ================================================================== */
/*  Step 2 — Discover Repos                                            */
/* ================================================================== */

function DiscoverStep({
  personaSkills,
  isDiscovering,
  job,
  repos,
  isLoadingRepos,
  error,
  onDiscover,
}: {
  personaSkills: string[];
  isDiscovering: boolean;
  job: ReturnType<typeof useRepoDiscovery>['job'];
  repos: DiscoveredRepo[];
  isLoadingRepos: boolean;
  error: string | null;
  onDiscover: () => void;
}): JSX.Element {
  return (
    <SectionCard label="REPO_DISCOVERY" icon={<Search size={14} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.04em', lineHeight: 1.6 }}>
          Discovers open-source repositories matching the role&apos;s tech stack via
          Libraries.io + GitHub. Filters by stars, license, test suite, and freshness.
        </div>

        {/* Skills being searched */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.1em', fontWeight: 700 }}>
            SEARCHING FOR:
          </span>
          {personaSkills.map((s) => (
            <span key={s} style={{ ...mono, fontSize: 8, color: '#a78bfa', padding: '2px 7px', borderRadius: 3, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)' }}>
              {s}
            </span>
          ))}
        </div>

        {/* Discover button */}
        <button
          onClick={onDiscover}
          disabled={isDiscovering}
          style={{
            ...mono,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.12em',
            padding: '10px 20px',
            background: isDiscovering ? 'var(--pipe-surface)' : 'rgba(96,165,250,0.12)',
            border: `1px solid ${isDiscovering ? 'var(--pipe-border)' : 'rgba(96,165,250,0.3)'}`,
            borderRadius: 6,
            color: isDiscovering ? 'var(--pipe-text-dim)' : '#60a5fa',
            cursor: isDiscovering ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            alignSelf: 'flex-start',
          }}
        >
          {isDiscovering ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          {isDiscovering ? 'DISCOVERING...' : 'DISCOVER REPOS'}
        </button>

        {/* Job status + progress */}
        {job && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-muted)', display: 'flex', gap: 14, alignItems: 'center' }}>
              <span>
                Status: <strong style={{ color: job.status === 'COMPLETED' ? '#4ade80' : '#fbbf24' }}>{job.status}</strong>
              </span>
              {job.totalPassed > 0 && (
                <span style={{ color: '#4ade80' }}>{job.totalPassed} repos found</span>
              )}
              {job.totalRejected > 0 && (
                <span style={{ color: 'var(--pipe-text-dim)' }}>{job.totalRejected} filtered out</span>
              )}
            </div>

            {/* Progress bar while running */}
            {job.status === 'RUNNING' && job.totalCandidates > 0 && (
              <DiscoveryProgress
                checked={job.totalPassed + job.totalRejected}
                total={Math.min(job.totalCandidates, 20)}
                passed={job.totalPassed}
              />
            )}

            {/* Indeterminate phase: fetching from Libraries.io */}
            {job.status === 'RUNNING' && job.totalCandidates === 0 && (
              <div style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={10} className="animate-spin" />
                Searching Libraries.io for matching packages...
              </div>
            )}
          </div>
        )}

        {/* Results summary */}
        {!isDiscovering && repos.length > 0 && (
          <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} color="#4ade80" />
            {repos.length} repositories discovered. Proceed to review.
          </div>
        )}

        {/* No results feedback */}
        {!isDiscovering && job?.status === 'COMPLETED' && repos.length === 0 && (
          <div style={{ ...mono, fontSize: 9, color: '#fbbf24', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={11} />
              No repositories found matching these skills.
            </div>
            <div style={{ color: 'var(--pipe-text-dim)', paddingLeft: 17, lineHeight: 1.6 }}>
              {job.totalRejected > 0
                ? `${job.totalRejected} candidates were filtered out (insufficient stars, stale, or wrong license).`
                : 'Try broader or more specific skill names (e.g. "React" instead of "React.js", "NestJS" instead of "Nest JS").'
              }
              {' '}Go back to adjust skills, then re-discover.
            </div>
          </div>
        )}

        {isLoadingRepos && (
          <div style={{ ...mono, fontSize: 10, color: 'var(--pipe-text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Loader2 size={12} className="animate-spin" /> Loading repos...
          </div>
        )}

        {error && (
          <div style={{ ...mono, fontSize: 9, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={11} /> {error}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ================================================================== */
/*  Step 3 — Review & Approve Repos                                    */
/* ================================================================== */

function ReviewReposStep({
  repos,
  approvedIds,
  onToggle,
}: {
  repos: DiscoveredRepo[];
  approvedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}): JSX.Element {
  // Only show non-rejected repos
  const reviewable = repos.filter((r) => r.status !== 'REJECTED' && r.status !== 'FAILED');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.04em', lineHeight: 1.6 }}>
        Select which repositories to use for challenge briefs. Review quality metrics,
        stack match, and complexity before approving.
      </div>

      <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)' }}>
        {approvedIds.size} of {reviewable.length} repos selected
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
          gap: 12,
        }}
      >
        {reviewable.map((repo) => (
          <SelectableRepoCard
            key={repo.id}
            repo={repo}
            isSelected={approvedIds.has(repo.id)}
            onToggle={() => onToggle(repo.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SelectableRepoCard({
  repo,
  isSelected,
  onToggle,
}: {
  repo: DiscoveredRepo;
  isSelected: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        padding: '16px 18px',
        border: `1px solid ${isSelected ? 'rgba(74,222,128,0.4)' : 'var(--pipe-border)'}`,
        borderRadius: 8,
        background: isSelected ? 'rgba(74,222,128,0.06)' : 'var(--pipe-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Header: checkbox + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            border: `1px solid ${isSelected ? 'rgba(74,222,128,0.5)' : 'var(--pipe-border)'}`,
            background: isSelected ? 'rgba(74,222,128,0.2)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isSelected && <Check size={12} color="#4ade80" />}
        </div>
        <GitBranch size={13} color="var(--pipe-text-dim)" />
        <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--pipe-text)' }}>
          {repo.githubOwner}/{repo.githubRepo}
        </span>
        <a
          href={repo.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ color: 'var(--pipe-text-dim)', display: 'flex' }}
        >
          <ExternalLink size={10} />
        </a>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {repo.stars != null && (
          <span style={{ ...mono, fontSize: 8, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 3 }}>
            <Star size={9} /> {repo.stars >= 1000 ? `${(repo.stars / 1000).toFixed(1)}k` : repo.stars}
          </span>
        )}
        {repo.primaryLanguage && (
          <span style={{ ...mono, fontSize: 8, color: '#a78bfa' }}>{repo.primaryLanguage}</span>
        )}
        {repo.license && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>{repo.license.toUpperCase()}</span>
        )}
        {repo.seniorityBand && (
          <span style={{ ...mono, fontSize: 7, fontWeight: 700, color: '#4ade80', padding: '1px 6px', borderRadius: 3, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', letterSpacing: '0.1em' }}>
            {repo.seniorityBand}
          </span>
        )}
      </div>

      {/* Quality bars */}
      {repo.qualityScore != null && <QualityBar label="QUALITY" value={repo.qualityScore} color="#4ade80" />}
      {repo.stackMatchScore != null && <QualityBar label="STACK" value={repo.stackMatchScore} color="#60a5fa" />}

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {repo.sloc != null && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
            {repo.sloc >= 1000 ? `${(repo.sloc / 1000).toFixed(0)}k` : repo.sloc} SLOC
          </span>
        )}
        {repo.meanCyclomaticComplexity != null && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
            {repo.meanCyclomaticComplexity.toFixed(1)} CCN
          </span>
        )}
        {repo.sourceFileCount != null && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
            {repo.sourceFileCount} files
          </span>
        )}
      </div>
    </button>
  );
}

/* ================================================================== */
/*  Step 4 — Generate Briefs                                           */
/* ================================================================== */

function GenerateStep({
  briefs,
  isGenerating,
  onGenerate,
  approvedCount,
}: {
  briefs: ChallengeBrief[];
  isGenerating: boolean;
  onGenerate: () => void;
  approvedCount: number;
}): JSX.Element {
  const readyCount = briefs.filter((b) => b.status === 'ready').length;
  const errorCount = briefs.filter((b) => b.status === 'error').length;

  return (
    <SectionCard label="GENERATE_BRIEFS" icon={<Sparkles size={14} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.04em', lineHeight: 1.6 }}>
          Generate challenge briefs for {approvedCount} approved repo{approvedCount !== 1 ? 's' : ''}.
          Each brief includes suggested PRs for code review and implementation tasks
          for live coding challenges.
        </div>

        {briefs.length === 0 && (
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            style={{
              ...mono,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.12em',
              padding: '10px 20px',
              background: 'rgba(167,139,250,0.12)',
              border: '1px solid rgba(167,139,250,0.3)',
              borderRadius: 6,
              color: '#a78bfa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              alignSelf: 'flex-start',
            }}
          >
            <Sparkles size={12} />
            GENERATE BRIEFS
          </button>
        )}

        {/* Progress */}
        {isGenerating && (
          <div style={{ ...mono, fontSize: 10, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Loader2 size={12} className="animate-spin" />
            Generating... {readyCount}/{approvedCount} complete
          </div>
        )}

        {/* Brief previews */}
        {briefs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {briefs.map((brief) => (
              <BriefPreviewCard key={brief.repoId} brief={brief} />
            ))}
          </div>
        )}

        {/* Summary */}
        {!isGenerating && readyCount > 0 && (
          <div style={{ ...mono, fontSize: 10, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} />
            {readyCount} brief{readyCount !== 1 ? 's' : ''} generated.
            {errorCount > 0 && <span style={{ color: '#ef4444' }}> {errorCount} failed.</span>}
            {' '}Proceed to review.
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function BriefPreviewCard({
  brief,
}: {
  brief: ChallengeBrief;
}): JSX.Element {
  const statusColor = brief.status === 'ready' ? '#4ade80' : brief.status === 'error' ? '#ef4444' : '#fbbf24';

  return (
    <div
      style={{
        padding: '12px 16px',
        border: '1px solid var(--pipe-border)',
        borderRadius: 6,
        background: 'var(--pipe-surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: statusColor,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...mono, fontSize: 10, fontWeight: 700, color: 'var(--pipe-text)' }}>
          {brief.status === 'ready' ? brief.title : brief.repoName}
        </div>
        {brief.status === 'ready' && (
          <div style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', marginTop: 2 }}>
            {brief.suggestedPRs.length} PRs + {brief.suggestedTasks.length} tasks
          </div>
        )}
      </div>
      <span style={{ ...mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: statusColor }}>
        {brief.status === 'generating' ? 'GENERATING...' : brief.status.toUpperCase()}
      </span>
    </div>
  );
}

/* ================================================================== */
/*  Step 5 — Review Briefs                                             */
/* ================================================================== */

function ReviewBriefsStep({
  briefs,
  approvedIndices,
  onToggle,
}: {
  briefs: ChallengeBrief[];
  approvedIndices: ReadonlySet<number>;
  onToggle: (index: number) => void;
}): JSX.Element {
  const readyBriefs = briefs.filter((b) => b.status === 'ready');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.04em', lineHeight: 1.6 }}>
        Review generated briefs. Each brief can produce both code review and live coding
        challenges. Select the ones you want to add to your challenge library.
      </div>

      <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-dim)' }}>
        {approvedIndices.size} of {readyBriefs.length} briefs selected
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {readyBriefs.map((brief, i) => (
          <BriefReviewCard
            key={brief.repoId}
            brief={brief}
            isSelected={approvedIndices.has(i)}
            onToggle={() => onToggle(i)}
          />
        ))}
      </div>
    </div>
  );
}

function BriefReviewCard({
  brief,
  isSelected,
  onToggle,
}: {
  brief: ChallengeBrief;
  isSelected: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        padding: '18px 20px',
        border: `1px solid ${isSelected ? 'rgba(74,222,128,0.4)' : 'var(--pipe-border)'}`,
        borderRadius: 8,
        background: isSelected ? 'rgba(74,222,128,0.06)' : 'var(--pipe-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            border: `1px solid ${isSelected ? 'rgba(74,222,128,0.5)' : 'var(--pipe-border)'}`,
            background: isSelected ? 'rgba(74,222,128,0.2)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isSelected && <Check size={12} color="#4ade80" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...mono, fontSize: 11, fontWeight: 700, color: 'var(--pipe-text)' }}>
            {brief.title}
          </div>
          <div style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', marginTop: 2 }}>
            {brief.repoName}
          </div>
        </div>
        <span
          style={{
            ...mono,
            fontSize: 7,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: brief.difficulty === 'JUNIOR' ? '#4ade80' : brief.difficulty === 'SENIOR' ? '#f87171' : '#fbbf24',
            padding: '2px 8px',
            borderRadius: 3,
            background: brief.difficulty === 'JUNIOR' ? 'rgba(74,222,128,0.1)' : brief.difficulty === 'SENIOR' ? 'rgba(248,113,113,0.1)' : 'rgba(251,191,36,0.1)',
            border: `1px solid ${brief.difficulty === 'JUNIOR' ? 'rgba(74,222,128,0.2)' : brief.difficulty === 'SENIOR' ? 'rgba(248,113,113,0.2)' : 'rgba(251,191,36,0.2)'}`,
          }}
        >
          {brief.difficulty}
        </span>
      </div>

      {/* Description */}
      <div style={{ ...mono, fontSize: 9, color: 'var(--pipe-text-muted)', lineHeight: 1.6, letterSpacing: '0.04em' }}>
        {brief.description}
      </div>

      {/* Challenge types */}
      <div style={{ display: 'flex', gap: 8 }}>
        {brief.suggestedPRs.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Code2 size={10} color="#60a5fa" />
            <span style={{ ...mono, fontSize: 8, color: '#60a5fa' }}>
              {brief.suggestedPRs.length} PR{brief.suggestedPRs.length !== 1 ? 's' : ''} for review
            </span>
          </div>
        )}
        {brief.suggestedTasks.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <MessageSquare size={10} color="#a78bfa" />
            <span style={{ ...mono, fontSize: 8, color: '#a78bfa' }}>
              {brief.suggestedTasks.length} implementation task{brief.suggestedTasks.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Skills */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {brief.skills.map((s) => (
          <span
            key={s}
            style={{
              ...mono,
              fontSize: 7,
              color: 'var(--pipe-text-dim)',
              padding: '2px 6px',
              borderRadius: 3,
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
            }}
          >
            {s}
          </span>
        ))}
      </div>

      {/* PR details (expandable in future) */}
      {brief.suggestedPRs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 28 }}>
          {brief.suggestedPRs.slice(0, 3).map((pr) => (
            <div key={pr.number} style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--pipe-text-muted)' }}>#{pr.number}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pr.title}
              </span>
              <span style={{ color: '#4ade80' }}>+{pr.additions}</span>
              <span style={{ color: '#ef4444' }}>-{pr.deletions}</span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

/* ================================================================== */
/*  Shared — DiscoveryProgress                                         */
/* ================================================================== */

function DiscoveryProgress({
  checked,
  total,
  passed,
}: {
  checked: number;
  total: number;
  passed: number;
}): JSX.Element {
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 4, background: 'var(--pipe-bg)', borderRadius: 2, overflow: 'hidden' }}>
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #60a5fa, #4ade80)',
              borderRadius: 2,
              transition: 'width 0.4s ease',
            }}
          />
        </div>
        <span style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)', fontWeight: 700, minWidth: 30, textAlign: 'right' }}>
          {pct}%
        </span>
      </div>
      <div style={{ ...mono, fontSize: 8, color: 'var(--pipe-text-dim)' }}>
        Checking repo {checked}/{total} on GitHub — {passed} passed so far
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Shared — QualityBar                                                */
/* ================================================================== */

function QualityBar({ label, value, color }: { label: string; value: number; color: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ ...mono, fontSize: 7, color: 'var(--pipe-text-dim)', width: 38, letterSpacing: '0.05em' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 3, background: 'var(--pipe-bg)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(value * 100)}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ ...mono, fontSize: 7, color, fontWeight: 700, width: 20, textAlign: 'right' }}>
        {Math.round(value * 100)}
      </span>
    </div>
  );
}
