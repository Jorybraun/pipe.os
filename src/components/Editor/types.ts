// ---------------------------------------------------------------------------
// Shared types for editor form components
// ---------------------------------------------------------------------------

/** The shape of a challenge as held in editor state (config/serverConfig already parsed) */
export interface EditorChallenge {
  id: string;
  type: string;
  title: string;
  instructions: string | null;
  config: Record<string, unknown>;
  serverConfig: Record<string, unknown>;
  order?: number | null;
  stageId?: string;
  isTemplate?: boolean;
  isNew?: boolean;
  // CODE_REVIEW fields
  githubRepoUrl?: string | undefined;
  githubPrNumber?: number | undefined;
  githubPrTitle?: string | undefined;
  githubPrDescription?: string | undefined;
  cachedDiffJson?: unknown;
  cachedMetadata?: unknown;
  diffCachedAt?: string | undefined;
}

/** Props shared by all per-type editor form components */
export interface EditorFormProps {
  challenge: EditorChallenge;
  onChange: (challenge: EditorChallenge) => void;
}
