/**
 * Provider-agnostic interfaces for data, storage, and auth.
 *
 * These interfaces decouple all consumer code from AWS Amplify specifics.
 * Swapping the backend (e.g. to Cloudflare) only requires writing new
 * implementations — no consumer code changes.
 */

// ─── Auth ────────────────────────────────────────────────────────────────────

/** The three auth modes used across the Pipe platform. */
export type AuthMode = 'authenticated' | 'public' | 'session';

/** Represents the currently authenticated user. */
export interface AuthUser {
  userId: string;
  username: string;
  email?: string;
}

/** Abstraction over the authentication provider (Cognito, etc.). */
export interface AuthProvider {
  /** Current authenticated user, or null if not signed in. */
  currentUser: AuthUser | null;
  /** Whether auth state is still initializing. */
  isLoading: boolean;
  /** Sign out the current user. */
  signOut: () => Promise<void>;
  /**
   * Get the current Cognito access token for passing to internal APIs.
   * Returns null for providers that manage tokens internally (e.g. Amplify).
   */
  getSessionToken: () => Promise<string | null>;
}

// ─── Data ────────────────────────────────────────────────────────────────────

/**
 * Options accepted by single-item operations (get, create, update, delete).
 */
export interface QueryOptions {
  selectionSet?: readonly string[];
  authMode?: AuthMode;
  authToken?: string;
}

/**
 * Options accepted by list operations.
 */
export interface ListOptions extends QueryOptions {
  filter?: Record<string, Record<string, unknown>>;
  limit?: number;
}

/**
 * Options accepted by observeQuery.
 */
export interface ObserveOptions {
  filter?: Record<string, Record<string, unknown>>;
}

/**
 * Standard result envelope for all data operations,
 * mirroring the Amplify client result shape.
 */
export interface DataResult<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

/**
 * The value delivered to observeQuery subscribers.
 */
export interface ObserveResult<T> {
  items: T[];
  isSynced?: boolean;
}

/**
 * Minimal Observable contract — subscribe returns a handle to unsubscribe.
 */
export interface Observable<T> {
  subscribe: (observer: {
    next: (value: T) => void;
    error?: (err: unknown) => void;
  }) => { unsubscribe: () => void };
}

/**
 * CRUD + real-time operations for a single model.
 *
 * The generic parameter T represents the model's data shape.
 * Consumer code typically works with the concrete model type
 * (e.g. Schema['Pipeline']['type']) via the DataProvider interface.
 */
export interface ModelOperations<T = Record<string, unknown>> {
  get: (input: { id: string }, options?: QueryOptions) => Promise<DataResult<T | null>>;
  list: (options?: ListOptions) => Promise<DataResult<T[]>>;
  create: (input: Partial<T>, options?: QueryOptions) => Promise<DataResult<T | null>>;
  update: (input: Partial<T> & { id: string }, options?: QueryOptions) => Promise<DataResult<T | null>>;
  delete: (input: { id: string }, options?: QueryOptions) => Promise<DataResult<T | null>>;
  /**
   * Real-time subscription. Returns an Observable that delivers batched
   * item snapshots as the underlying data changes.
   */
  observeQuery: (options?: ObserveOptions) => Observable<ObserveResult<T>>;
}

/**
 * A callable that executes a custom AppSync mutation.
 */
export type MutationOperation<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> = (args: TArgs) => Promise<DataResult<TResult>>;

/**
 * A callable that executes a custom AppSync query.
 */
export type QueryOperation<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> = (args: TArgs) => Promise<DataResult<TResult>>;

/**
 * DataProvider — the main data access interface.
 *
 * `models` mirrors `client.models.*` from Amplify's generated client.
 * `mutations` and `queries` mirror `client.mutations.*` / `client.queries.*`.
 *
 * All model names are sourced from `amplify/data/resource.ts` and must
 * stay in sync with the Schema definition.
 */
export interface DataProvider {
  models: {
    Pipeline: ModelOperations;
    Stage: ModelOperations;
    Candidate: ModelOperations;
    Challenge: ModelOperations;
    ChallengeSubmission: ModelOperations;
    Assessment: ModelOperations;
    CodeArtifact: ModelOperations;
    VideoSession: ModelOperations;
    VideoSignal: ModelOperations;
    CandidateMedia: ModelOperations;
    ScheduledInterview: ModelOperations;
    SchedulingConnection: ModelOperations;
    RoleContext: ModelOperations;
    RepoTemplate: ModelOperations;
    DevContainerSession: ModelOperations;
  };
  /** Custom AppSync mutations (e.g. scoreChallengeSubmission, submitCodeReview). */
  mutations: Record<string, MutationOperation>;
  /** Custom AppSync queries (e.g. resolveToken, getTurnCredentials). */
  queries: Record<string, QueryOperation>;
}

/**
 * DataProviderFactory — creates DataProvider instances with specific auth modes.
 *
 * Maps directly to the three `generateClient({ authMode })` patterns used
 * across the Pipe codebase:
 *  - `createClient()` → userPool (Cognito, recruiter-facing)
 *  - `createPublicClient()` → apiKey (no sign-in, candidate-facing)
 *  - `createSessionClient(token)` → lambda (JWT session token, candidate flow)
 */
export interface DataProviderFactory {
  /** Authenticated client — Cognito userPool, recruiter-facing. */
  createClient: () => DataProvider;
  /** Public client — apiKey auth, no sign-in required. Candidate-facing. */
  createPublicClient: () => DataProvider;
  /**
   * Session-authenticated client — Lambda authorizer with JWT session token.
   * Used after a candidate resolves their invite token.
   */
  createSessionClient: (sessionToken: string) => DataProvider;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

/** Input for a storage upload operation. */
export interface UploadInput {
  path: string;
  data: Blob | File | ArrayBuffer;
  contentType?: string;
  onProgress?: (progress: { loaded: number; total: number }) => void;
}

/** Input for a signed URL generation operation. */
export interface GetUrlInput {
  path: string;
  options?: { expiresIn?: number };
}

/** Result of a signed URL generation operation. */
export interface GetUrlResult {
  url: URL;
  expiresAt?: Date;
}

/**
 * StorageProvider — abstraction over file storage (S3, R2, etc.).
 */
export interface StorageProvider {
  /** Upload a file/blob to storage. Returns the final storage path. */
  upload: (input: UploadInput) => Promise<{ path: string }>;
  /** Generate a signed download URL for a stored file. */
  getUrl: (input: GetUrlInput) => Promise<GetUrlResult>;
}

// ─── Providers bundle ────────────────────────────────────────────────────────

/**
 * The set of providers injected at the root of the app via PipeProviderRoot.
 *
 * `auth` is optional at the root level because the AuthProvider for Amplify
 * must live inside the <Authenticator> boundary. It is provided by
 * AmplifyAuthWrapper (a child component) after the auth boundary is mounted.
 * useAuth() throws if accessed before the auth provider is wired in.
 */
export interface PipeProviders {
  data: DataProviderFactory;
  storage: StorageProvider;
  auth?: AuthProvider;
}
