import type { StageConfig, ChallengeNode, PanelSlots } from './types';
import { legacyToVFS, extractEditableFiles, type VirtualFS } from './virtualFS';

// ---------------------------------------------------------------------------
// Raw DB types (from useAssessment)
// ---------------------------------------------------------------------------

export interface RawChallenge {
  id: string;
  type: string | null;
  title: string;
  instructions: string | null;
  config: unknown;
  order: number | null;
  codeArtifact?: { id: string; code: string | null; language: string | null; title: string | null } | null;
  cachedDiffJson?: unknown;
  githubPrTitle?: string | null;
  githubRepoUrl?: string | null;
  githubPrNumber?: number | null;
  githubPrDescription?: string | null;
}

export interface RawStage {
  id: string;
  title?: string | null;
  order: number | null;
  timeLimit?: number | null;
  type?: string | null;
  mode?: 'ASYNC' | 'LIVE_VIDEO' | null;
  challenges: RawChallenge[];
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

function parseConfig(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') return JSON.parse(raw) as Record<string, unknown>;
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>;
  return {};
}

// ---------------------------------------------------------------------------
// Blueprint — what a challenge type looks like
// ---------------------------------------------------------------------------

interface Blueprint {
  layout: string;
  panels: PanelSlots;
  shells: string[];
  initialSubmission: Record<string, unknown>;
  isComplete: (submission: Record<string, unknown>) => boolean;
}

type BlueprintResolver = (config: Record<string, unknown>) => Blueprint;

/** Map from challenge type → blueprint factory. This is the ONLY place
 *  type-specific knowledge lives. Everything else is generic. */
const BLUEPRINT_MAP: Record<string, BlueprintResolver> = {
  CODE_IMPLEMENTATION: (config) => {
    const mode = (config.mode as string) ?? 'backend';
    // Normalize files: support both new VirtualFS and legacy starterCode
    const files: VirtualFS = (config.files as VirtualFS) ?? legacyToVFS(config);
    const editableFiles = extractEditableFiles(files);

    const base = {
      shells: [] as string[],
      initialSubmission: { files: editableFiles },
      isComplete: () => true, // code challenges always submittable
    };

    if (mode === 'frontend') {
      return {
        ...base,
        layout: 'code-browser',
        panels: { left: ['problem'], center: ['code-editor'], right: ['code-preview'], bottom: ['console'] },
      };
    }
    return {
      ...base,
      layout: 'code-workspace',
      panels: { left: ['problem'], center: ['code-editor'], bottom: ['console'] },
    };
  },

  CODE_REVIEW: (config) => {
    const isMultiTurn = !!(config as Record<string, unknown>).isMultiTurn;
    const maxRounds = ((config as Record<string, unknown>).maxRounds as number) ?? 4;

    if (isMultiTurn) {
      return {
        layout: 'workspace',
        panels: { left: ['problem'], center: ['diff'], right: ['conversation'] },
        shells: [],
        initialSubmission: {
          annotations: [],
          rounds: [],
          currentRound: 1,
          maxRounds,
          verdict: null,
          summary: '',
          sessionId: null,
          isAwaitingResponse: false,
          nextCommentId: 1,
        },
        isComplete: (s: Record<string, unknown>) =>
          !!s.verdict && ((s.summary as string) ?? '').trim().length > 0,
      };
    }

    // Legacy single-turn
    return {
      layout: 'workspace',
      panels: { left: ['problem'], center: ['diff'], right: ['verdict'] },
      shells: [],
      initialSubmission: { annotations: [], verdict: null, summary: '' },
      isComplete: (s: Record<string, unknown>) =>
        !!s.verdict && ((s.summary as string) ?? '').trim().length > 0,
    };
  },

  QUIZ_MCQ: (config) => ({
    layout: 'fullbleed',
    panels: { center: ['options'] },
    shells: [],
    initialSubmission: (config.selectionMode as string) === 'multi'
      ? { answers: { selected: [] } }
      : { answers: {} },
    isComplete: () => true,
  }),

  QUIZ_SHORT_ANSWER: (config) => {
    const inputMode = (config.inputMode as string) ?? 'text';
    const panelMap: Record<string, string> = { text: 'textarea', voice: 'voice', video: 'video-submission' };
    const submissionMap: Record<string, Record<string, unknown>> = {
      text: { inputMode: 'text', text: '' },
      voice: { inputMode: 'voice', text: '' },
      video: { inputMode: 'video', videoS3Key: '', filename: '' },
    };
    const completeMap: Record<string, (s: Record<string, unknown>) => boolean> = {
      text: () => true,
      voice: (s) => ((s.text as string) ?? '').length > 0,
      video: (s) => ((s.videoS3Key as string) ?? '') !== '',
    };
    return {
      layout: 'fullbleed',
      panels: { center: [panelMap[inputMode] ?? 'textarea'] },
      shells: [],
      initialSubmission: submissionMap[inputMode] ?? { inputMode: 'text', text: '' },
      isComplete: completeMap[inputMode] ?? (() => true),
    };
  },

  FOLLOW_UP: () => ({
    layout: 'fullbleed',
    panels: { center: ['follow-up'] },
    shells: [],
    initialSubmission: { answers: {} },
    isComplete: () => false, // follow-up panel handles its own submit
  }),
};

const FALLBACK_BLUEPRINT: Blueprint = {
  layout: 'workspace',
  panels: { left: ['problem'], center: ['monaco'] },
  shells: [],
  initialSubmission: {},
  isComplete: () => true,
};

// ---------------------------------------------------------------------------
// Single challenge → ChallengeNode
// ---------------------------------------------------------------------------

function resolveChallengeNode(raw: RawChallenge, stageTimeLimit?: number | null): ChallengeNode {
  const config = parseConfig(raw.config);
  const type = raw.type ?? 'CODE_IMPLEMENTATION';

  // Look up blueprint from map — no switch
  const resolve = BLUEPRINT_MAP[type];
  const blueprint = resolve ? resolve(config) : FALLBACK_BLUEPRINT;

  // Merge all type-specific data into a flat bag
  const data: Record<string, unknown> = {
    ...config,
    ...(raw.codeArtifact ? { codeArtifact: raw.codeArtifact } : {}),
    ...(raw.cachedDiffJson != null ? { cachedDiffJson: raw.cachedDiffJson } : {}),
    ...(raw.githubPrTitle != null ? { githubPrTitle: raw.githubPrTitle } : {}),
    ...(raw.githubRepoUrl != null ? { githubRepoUrl: raw.githubRepoUrl } : {}),
    ...(raw.githubPrNumber != null ? { githubPrNumber: raw.githubPrNumber } : {}),
    ...(raw.githubPrDescription != null ? { githubPrDescription: raw.githubPrDescription } : {}),
  };

  // Time limit: challenge config overrides stage-level
  const challengeTimeLimit = typeof config.timeLimit === 'number' ? config.timeLimit : null;
  const effectiveTimeLimit = challengeTimeLimit ?? stageTimeLimit ?? null;

  return {
    id: raw.id,
    type,
    title: raw.title,
    instructions: raw.instructions,
    data,
    shells: blueprint.shells,
    layout: blueprint.layout,
    panels: blueprint.panels,
    initialSubmission: blueprint.initialSubmission,
    isComplete: blueprint.isComplete,
    timeLimit: effectiveTimeLimit,
    ...(config.enableFollowUp ? { followUp: { enabled: true } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Full stage → StageConfig
// ---------------------------------------------------------------------------

export function resolveStageConfig(raw: RawStage): StageConfig {
  const stageShells: string[] = [];

  if (typeof raw.timeLimit === 'number' && raw.timeLimit > 0) {
    stageShells.push('timer');
  }
  if (raw.mode === 'LIVE_VIDEO') {
    stageShells.push('video');
  }

  const sorted = [...raw.challenges].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const challenges = sorted.map((c) => resolveChallengeNode(c, raw.timeLimit));

  return {
    id: raw.id,
    shells: stageShells,
    challenges,
  };
}
