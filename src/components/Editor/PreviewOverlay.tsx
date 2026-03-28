import { useState, useMemo, useEffect, useCallback } from 'react';
import { Minimize2, Loader2 } from 'lucide-react';
import { useData } from '../../providers';
import { InterviewProvider } from '../../contexts/InterviewContext';
import { StageShell } from '../Assessment/StageShell';
import { StageRenderer } from '../Assessment/StageRenderer';
import { TimerProvider } from '../Assessment/TimerContext';
import { resolveStageConfig, type RawChallenge, type RawStage } from '../../lib/challenge/resolveStageConfig';
import type { EditorChallenge } from './types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PreviewOverlayProps {
  challenge: EditorChallenge;
  onClose: () => void;
  /** When true + stageId exists, fetches all challenges in the stage */
  stageMode?: boolean;
}

// ---------------------------------------------------------------------------
// Helper: build a raw challenge from EditorChallenge for resolveStageConfig
// ---------------------------------------------------------------------------

function editorToRaw(c: EditorChallenge): RawChallenge {
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    instructions: c.instructions ?? null,
    config: c.config,
    order: c.order ?? 0,
    ...(c.githubRepoUrl ? { githubRepoUrl: c.githubRepoUrl } : {}),
    ...(c.githubPrNumber != null ? { githubPrNumber: c.githubPrNumber } : {}),
    ...(c.githubPrTitle ? { githubPrTitle: c.githubPrTitle } : {}),
    ...(c.githubPrDescription ? { githubPrDescription: c.githubPrDescription } : {}),
    ...(c.cachedDiffJson != null ? { cachedDiffJson: c.cachedDiffJson } : {}),
    ...(c.config?.starterCode ? {
      codeArtifact: {
        id: `preview-${c.id}`,
        code: c.config.starterCode as string,
        language: (c.config.language as string) || 'javascript',
        title: c.title,
      },
    } : {}),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PreviewOverlay({ challenge, onClose, stageMode }: PreviewOverlayProps): JSX.Element {
  const client = useData().createClient();

  // Prevent background scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Stage mode: fetch all challenges
  const [stageChallenges, setStageChallenges] = useState<EditorChallenge[] | null>(null);
  const [stageTitle, setStageTitle] = useState<string>('Stage Preview');
  const [stageTimeLimit, setStageTimeLimit] = useState<number | null>(null);
  const [loadingStage, setLoadingStage] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!stageMode || !challenge.stageId) return;
    let cancelled = false;
    setLoadingStage(true);

    (async () => {
      try {
        // Fetch stage metadata
        const { data: stageData } = await client.models.Stage.get({ id: challenge.stageId! });

        // Fetch all challenges in this stage
        const { data: challenges } = await client.models.Challenge.list({
          filter: { stageId: { eq: challenge.stageId! } },
        });

        if (cancelled) return;

        // Cast to the minimal typed shapes needed for this component
        type RawStageData = { title?: string; timeLimit?: number | null } | null;
        type RawChallengeData = {
          id: unknown;
          type?: unknown;
          title: unknown;
          instructions?: unknown;
          config?: unknown;
          serverConfig?: unknown;
          order?: unknown;
          stageId?: unknown;
          githubRepoUrl?: unknown;
          githubPrNumber?: unknown;
          githubPrTitle?: unknown;
          githubPrDescription?: unknown;
          cachedDiffJson?: unknown;
        };

        const stageRecord = stageData as RawStageData;

        if (stageRecord) {
          setStageTitle((stageRecord.title as string | undefined) ?? 'Stage Preview');
          setStageTimeLimit((stageRecord.timeLimit as number | null | undefined) ?? null);
        }

        if (challenges && challenges.length > 0) {
          const parsed: EditorChallenge[] = (challenges as RawChallengeData[])
            .map((c) => ({
              id: c.id as string,
              type: (c.type as string | null) || 'CODE_IMPLEMENTATION',
              title: c.title as string,
              instructions: (c.instructions as string | null | undefined) ?? null,
              config: (typeof c.config === 'string' ? JSON.parse(c.config as string) : (c.config as Record<string, unknown>) || {}) as Record<string, unknown>,
              serverConfig: (typeof c.serverConfig === 'string' ? JSON.parse(c.serverConfig as string) : (c.serverConfig as Record<string, unknown>) || {}) as Record<string, unknown>,
              order: (c.order as number | undefined) ?? 0,
              ...(c.stageId != null ? { stageId: c.stageId as string } : {}),
              ...(c.githubRepoUrl ? { githubRepoUrl: c.githubRepoUrl as string } : {}),
              ...(c.githubPrNumber != null ? { githubPrNumber: c.githubPrNumber as number } : {}),
              ...(c.githubPrTitle ? { githubPrTitle: (c.githubPrTitle as string) ?? undefined } : {}),
              ...(c.githubPrDescription ? { githubPrDescription: (c.githubPrDescription as string) ?? undefined } : {}),
              ...(c.cachedDiffJson != null ? { cachedDiffJson: c.cachedDiffJson as unknown } : {}),
            }))
            .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));

          setStageChallenges(parsed);

          // Always start from the beginning of the stage
          setCurrentIndex(0);
        }
      } catch (err) {
        console.error('[PreviewOverlay] stage fetch error:', err);
      } finally {
        if (!cancelled) setLoadingStage(false);
      }
    })();

    return () => { cancelled = true; };
  }, [stageMode, challenge.stageId, challenge.id]);

  // Build stage config
  const challenges = stageMode && stageChallenges ? stageChallenges : [challenge];
  const stageConfig = useMemo(() => {
    const fakeStage: RawStage = {
      id: challenge.stageId || 'preview',
      order: 0,
      title: stageMode ? stageTitle : challenge.title,
      timeLimit: stageMode ? stageTimeLimit : ((challenge.config?.timeLimit as number) ?? null),
      challenges: challenges.map((c) => editorToRaw(c)),
    };
    return resolveStageConfig(fakeStage);
  }, [challenges, stageMode, stageTitle, stageTimeLimit, challenge]);

  const isLastChallenge = currentIndex === challenges.length - 1;
  const currentChallenge = challenges[currentIndex] ?? challenge;

  const handleNext = useCallback(() => {
    if (!isLastChallenge) {
      setCurrentIndex((i) => i + 1);
    }
  }, [isLastChallenge]);

  // Loading state for stage mode
  if (stageMode && loadingStage) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#0c0c0e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={32} color="rgba(255,255,255,0.4)" className="animate-spin" />
          <div style={{ marginTop: 16, fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>
            LOADING_STAGE_PREVIEW...
          </div>
        </div>
      </div>
    );
  }

  const modeLabel = stageMode
    ? `STAGE_PREVIEW — ${challenges.length} challenge${challenges.length !== 1 ? 's' : ''}`
    : 'CHALLENGE_PREVIEW';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#0c0c0e', display: 'flex', flexDirection: 'column' }}>
      {/* Preview banner */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 40px',
        background: 'rgba(96,165,250,0.06)',
        borderBottom: '1px solid rgba(96,165,250,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#60a5fa' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(96,165,250,0.7)', fontFamily: 'Space Mono', letterSpacing: '0.15em' }}>
            {modeLabel}
          </span>
        </div>
        <button onClick={onClose} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
          background: '#fff', border: 'none', borderRadius: 4, color: '#000',
          fontSize: 10, fontWeight: 800, fontFamily: 'Space Mono', cursor: 'pointer',
        }}>
          <Minimize2 size={14} />
          EXIT_PREVIEW
        </button>
      </div>

      {/* Preview content — override StageShell's 100vh so it fits inside overlay */}
      <div style={{ flex: 1, overflow: 'hidden' }} className="preview-overlay-content">
        <InterviewProvider
          key={currentChallenge.id}
          stageConfig={stageConfig}
          currentIndex={currentIndex}
          onSubmit={handleNext}
        >
          <TimerProvider>
            <StageShell
              title={currentChallenge.title}
              totalChallenges={challenges.length}
              currentChallengeIndex={currentIndex}
              onNext={handleNext}
              isLastChallenge={isLastChallenge}
              fullBleed={currentChallenge.type === 'CODE_REVIEW' || currentChallenge.type === 'CODE_IMPLEMENTATION'}
              canAdvance={true}
              isSubmitting={false}
            >
              <StageRenderer />
            </StageShell>
          </TimerProvider>
        </InterviewProvider>
        <style>{`.preview-overlay-content > div { height: 100% !important; }`}</style>
      </div>
    </div>
  );
}
