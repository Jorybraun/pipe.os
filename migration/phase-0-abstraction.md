# Phase 0: Provider-Agnostic Data Abstraction Layer

## Overview

Phase 0 introduces a thin abstraction layer between the React frontend and AWS Amplify. Every `generateClient<Schema>()` call, every `uploadData` / `getUrl` call, and every `Authenticator` / `useAuthenticator` usage gets routed through provider-agnostic interfaces instead of importing directly from `aws-amplify/*`.

**Why this phase exists:** The codebase currently has 31 files in `src/` that directly import from `aws-amplify/data`, `aws-amplify/storage`, or `@aws-amplify/ui-react`. These hard dependencies make it impossible to swap the backend without a rewrite. Phase 0 isolates all Amplify-specific code into `src/providers/amplify/`, exposes provider-agnostic interfaces via React context, and migrates every consumer file to use those interfaces. After Phase 0, swapping Amplify for Cloudflare (Phase 1+) becomes a matter of writing new provider implementations — no consumer code changes.

**What this phase does NOT do:**
- Does not change the backend infrastructure (Amplify stays running)
- Does not change data models or auth rules
- Does not introduce Cloudflare code
- Does not change Lambda functions (those live in `amplify/` and are out of scope)

---

## BDD User Journeys

### 1. Recruiter loads listing page through abstraction

```gherkin
Given the Amplify provider is configured at app startup
  And the recruiter is authenticated via the AuthProvider
When the recruiter navigates to the listing page
Then ListingPage calls `useData().models.Pipeline.list()` through the DataProvider
  And the response shape is identical to the current `client.models.Pipeline.list()` result
  And the page renders the same pipeline cards as before
  And no import from 'aws-amplify/data' exists in ListingPage.tsx
```

### 2. Recruiter creates pipeline through abstraction

```gherkin
Given the recruiter is on the pipeline creation page
  And the DataProvider is backed by the Amplify implementation
When the recruiter fills in "Senior Frontend Engineer" and submits
Then usePipelineCreate calls `useData().models.Pipeline.create()` through the DataProvider
  And stages are created via `useData().models.Stage.create()`
  And the pipeline appears in the listing page on subsequent load
  And no import from 'aws-amplify/data' exists in usePipelineCreate.ts
```

### 3. Candidate resolves token through abstraction

```gherkin
Given a candidate visits /assess/:token with a valid invite token
  And the DataProvider is configured with apiKey auth mode for public access
When useAssessment calls `useData({ authMode: 'public' }).queries.resolveToken()`
Then the candidate's session is resolved identically to the current flow
  And session token upgrade to lambda auth works via `useData({ authMode: 'session', token })`
  And mutations like getStageConfig and submitChallengeResponse work through the provider
  And no import from 'aws-amplify/data' exists in useAssessment.ts
```

### 4. Real-time subscription delivers updates through abstraction

```gherkin
Given a recruiter is viewing the scheduling page
  And the RealtimeProvider is backed by the Amplify observeQuery implementation
When a new ScheduledInterview record is created via webhook
Then useScheduledInterviews receives the update via `useRealtime().observe('ScheduledInterview', filter)`
  And the subscription callback fires with the new item
  And the UI updates in real time
  And no import from 'aws-amplify/data' exists in useScheduledInterviews.ts

Given a candidate is on a video call page
  And the RealtimeProvider is active
When the recruiter sends an SDP offer via VideoSignal
Then useVideoSignaling receives the signal via `useRealtime().observe('VideoSignal', filter)`
  And deduplication logic continues to work (processedSignalIds)
  And no import from 'aws-amplify/data' exists in useVideoSignaling.ts
```

### 5. Storage upload works through abstraction

```gherkin
Given a candidate is uploading a resume via CandidateIntakeModal
  And the StorageProvider is backed by the Amplify S3 implementation
When the candidate selects a PDF file
Then the component calls `useStorage().upload({ path, data, contentType })`
  And the file is uploaded to S3 identically to the current uploadData() call
  And no import from 'aws-amplify/storage' exists in CandidateIntakeModal.tsx

Given a recruiter is viewing a candidate profile with a resume
When the page loads and needs a signed download URL
Then the component calls `useStorage().getUrl({ path, expiresIn })`
  And the signed URL is returned identically to the current getUrl() call
  And no import from 'aws-amplify/storage' exists in CandidateProfilePage.tsx
```

---

## Acceptance Criteria

1. **Zero direct Amplify imports in consumer code.** `grep -r "from ['\"]aws-amplify" src/` returns matches ONLY in files under `src/providers/amplify/` and `src/main.tsx` (bootstrap only).
2. **Zero `@aws-amplify/ui-react` imports outside providers.** `grep -r "from ['\"]@aws-amplify" src/` returns matches ONLY in `src/providers/amplify/AmplifyAuthProvider.tsx`.
3. **All existing E2E tests pass.** No behavioral regressions. The Playwright suite (`npx playwright test`) must pass at the same rate as before Phase 0.
4. **`npx tsc --noEmit` passes.** No type errors introduced.
5. **Auth mode switching works.** Candidate-facing code (useAssessment, useVideoSignaling, ChallengeRegistry) correctly switches between public/session/authenticated auth modes through the abstraction.
6. **Real-time subscriptions work.** observeQuery-based features (useVideoSignaling, useSchedulingConnection, useScheduledInterviews, useDevContainerSession) deliver updates through the RealtimeProvider.
7. **Storage operations work.** File uploads (CandidateIntakeModal, QuestionVideoRecorder) and signed URL generation (CandidateProfilePage, ChallengeRegistry) work through the StorageProvider.
8. **No new runtime dependencies.** The abstraction layer is pure TypeScript interfaces + React context. No new npm packages.
9. **`selectionSet` support preserved.** The DataProvider's list/get methods accept an optional `selectionSet` parameter that maps to Amplify's selectionSet (and can be ignored by future providers).
10. **Provider factory works.** A single configuration point in `src/main.tsx` determines which provider implementation is active.

---

## Architecture

### Provider Interfaces

```typescript
// src/providers/types.ts

// ─── Auth ───────────────────────────────────────────────────────────────────

export type AuthMode = 'authenticated' | 'public' | 'session';

export interface AuthUser {
  userId: string;
  username: string;
  email?: string;
}

export interface AuthProvider {
  /** Current authenticated user, or null */
  currentUser: AuthUser | null;
  /** Whether auth state is still loading */
  isLoading: boolean;
  /** Sign out the current user */
  signOut: () => Promise<void>;
  /** Get current session token (for passing to APIs) */
  getSessionToken: () => Promise<string | null>;
}

// ─── Data ───────────────────────────────────────────────────────────────────

export interface ModelOperations<T = Record<string, unknown>> {
  get: (input: { id: string }, options?: QueryOptions) => Promise<DataResult<T | null>>;
  list: (options?: ListOptions) => Promise<DataResult<T[]>>;
  create: (input: Partial<T>, options?: QueryOptions) => Promise<DataResult<T | null>>;
  update: (input: Partial<T> & { id: string }, options?: QueryOptions) => Promise<DataResult<T | null>>;
  delete: (input: { id: string }) => Promise<DataResult<T | null>>;
  observeQuery: (options?: ObserveOptions) => Observable<ObserveResult<T>>;
}

export interface QueryOptions {
  selectionSet?: string[];
  authMode?: AuthMode;
  authToken?: string;
}

export interface ListOptions extends QueryOptions {
  filter?: Record<string, Record<string, unknown>>;
  limit?: number;
}

export interface ObserveOptions {
  filter?: Record<string, Record<string, unknown>>;
}

export interface DataResult<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

export interface ObserveResult<T> {
  items: T[];
  isSynced?: boolean;
}

export interface Observable<T> {
  subscribe: (observer: {
    next: (value: T) => void;
    error?: (err: unknown) => void;
  }) => { unsubscribe: () => void };
}

export interface MutationOperation<TArgs = Record<string, unknown>, TResult = unknown> {
  (args: TArgs): Promise<DataResult<TResult>>;
}

export interface QueryOperation<TArgs = Record<string, unknown>, TResult = unknown> {
  (args: TArgs): Promise<DataResult<TResult>>;
}

/**
 * DataProvider exposes model CRUD + custom mutations/queries.
 *
 * The `models` object mirrors the Amplify `client.models.*` shape.
 * The `mutations` and `queries` objects mirror `client.mutations.*` / `client.queries.*`.
 *
 * Auth mode is set per-call via options, or defaults to 'authenticated'.
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
  mutations: Record<string, MutationOperation>;
  queries: Record<string, QueryOperation>;
}

/** Factory to create DataProvider with specific auth configuration */
export interface DataProviderFactory {
  /** Default authenticated client (recruiter, Cognito userPool) */
  createClient: () => DataProvider;
  /** Public client (apiKey auth, no sign-in required) */
  createPublicClient: () => DataProvider;
  /** Session-authenticated client (Lambda authorizer with JWT) */
  createSessionClient: (sessionToken: string) => DataProvider;
}

// ─── Storage ────────────────────────────────────────────────────────────────

export interface UploadInput {
  path: string;
  data: Blob | File | ArrayBuffer;
  contentType?: string;
  onProgress?: (progress: { loaded: number; total: number }) => void;
}

export interface GetUrlInput {
  path: string;
  options?: { expiresIn?: number };
}

export interface GetUrlResult {
  url: URL;
  expiresAt?: Date;
}

export interface StorageProvider {
  upload: (input: UploadInput) => Promise<{ path: string }>;
  getUrl: (input: GetUrlInput) => Promise<GetUrlResult>;
}

// ─── Realtime (extracted from DataProvider for clarity) ─────────────────────
// Note: Real-time is handled via ModelOperations.observeQuery on the DataProvider.
// No separate RealtimeProvider needed — observeQuery on each model IS the realtime API.
// This keeps the migration surface small: consumers call model.observeQuery() as before.
```

### React Context

```typescript
// src/providers/DataContext.tsx

import { createContext, useContext } from 'react';
import type { DataProviderFactory, StorageProvider, AuthProvider } from './types';

interface PipeProviders {
  data: DataProviderFactory;
  storage: StorageProvider;
  auth: AuthProvider;
}

const PipeProviderContext = createContext<PipeProviders | null>(null);

export function PipeProviderRoot({ providers, children }: {
  providers: PipeProviders;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <PipeProviderContext.Provider value={providers}>
      {children}
    </PipeProviderContext.Provider>
  );
}

/** Hook: get the DataProviderFactory */
export function useData(): DataProviderFactory {
  const ctx = useContext(PipeProviderContext);
  if (!ctx) throw new Error('useData must be used within PipeProviderRoot');
  return ctx.data;
}

/** Hook: get the StorageProvider */
export function useStorage(): StorageProvider {
  const ctx = useContext(PipeProviderContext);
  if (!ctx) throw new Error('useStorage must be used within PipeProviderRoot');
  return ctx.storage;
}

/** Hook: get the AuthProvider */
export function useAuth(): AuthProvider {
  const ctx = useContext(PipeProviderContext);
  if (!ctx) throw new Error('useAuth must be used within PipeProviderRoot');
  return ctx.auth;
}
```

### Amplify Provider Implementation

```typescript
// src/providers/amplify/index.ts — barrel export

export { AmplifyDataProviderFactory } from './data';
export { AmplifyStorageProvider } from './storage';
export { AmplifyAuthProvider, AmplifyAuthGate } from './auth';
```

```typescript
// src/providers/amplify/data.ts — wraps generateClient

import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import type { DataProvider, DataProviderFactory, ModelOperations } from '../types';

function wrapModel(client: ReturnType<typeof generateClient<Schema>>, modelName: string): ModelOperations {
  const model = (client.models as Record<string, unknown>)[modelName] as Record<string, Function>;
  return {
    get: (input, options) => model.get(input, options) as Promise<any>,
    list: (options) => model.list(options) as Promise<any>,
    create: (input, options) => model.create(input, options) as Promise<any>,
    update: (input, options) => model.update(input, options) as Promise<any>,
    delete: (input) => model.delete(input) as Promise<any>,
    observeQuery: (options) => model.observeQuery(options) as any,
  };
}

function wrapClient(client: ReturnType<typeof generateClient<Schema>>): DataProvider {
  const modelNames = [
    'Pipeline', 'Stage', 'Candidate', 'Challenge', 'ChallengeSubmission',
    'Assessment', 'CodeArtifact', 'VideoSession', 'VideoSignal',
    'CandidateMedia', 'ScheduledInterview', 'SchedulingConnection',
    'RoleContext', 'RepoTemplate', 'DevContainerSession',
  ] as const;

  const models = {} as DataProvider['models'];
  for (const name of modelNames) {
    (models as Record<string, ModelOperations>)[name] = wrapModel(client, name);
  }

  return {
    models,
    mutations: client.mutations as unknown as DataProvider['mutations'],
    queries: client.queries as unknown as DataProvider['queries'],
  };
}

export const AmplifyDataProviderFactory: DataProviderFactory = {
  createClient: () => wrapClient(generateClient<Schema>()),
  createPublicClient: () => wrapClient(generateClient<Schema>({ authMode: 'apiKey' })),
  createSessionClient: (token) => wrapClient(generateClient<Schema>({ authMode: 'lambda', authToken: token })),
};
```

```typescript
// src/providers/amplify/storage.ts — wraps uploadData / getUrl

import { uploadData, getUrl } from 'aws-amplify/storage';
import type { StorageProvider, UploadInput, GetUrlInput, GetUrlResult } from '../types';

export const AmplifyStorageProvider: StorageProvider = {
  upload: async (input: UploadInput) => {
    const result = await uploadData({
      path: input.path,
      data: input.data,
      options: {
        contentType: input.contentType,
        onProgress: input.onProgress,
      },
    }).result;
    return { path: result.path };
  },

  getUrl: async (input: GetUrlInput): Promise<GetUrlResult> => {
    const result = await getUrl({
      path: input.path,
      options: { expiresIn: input.options?.expiresIn ?? 3600 },
    });
    return { url: result.url, expiresAt: result.expiresAt };
  },
};
```

```typescript
// src/providers/amplify/auth.tsx — wraps Authenticator + useAuthenticator

import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import type { AuthProvider } from '../types';

/**
 * AmplifyAuthGate — renders children only when authenticated.
 * Drop-in replacement for <Authenticator> wrapper in App.tsx.
 */
export function AmplifyAuthGate({ children }: { children: React.ReactNode }): JSX.Element {
  return <Authenticator>{children}</Authenticator>;
}

/**
 * useAmplifyAuth — hook that implements AuthProvider using useAuthenticator.
 * Used inside AmplifyAuthGate (must be within Authenticator context).
 */
export function useAmplifyAuth(): AuthProvider {
  const { user, signOut, authStatus } = useAuthenticator();
  return {
    currentUser: user ? {
      userId: user.userId,
      username: user.username,
      email: user.signInDetails?.loginId,
    } : null,
    isLoading: authStatus === 'configuring',
    signOut: async () => signOut(),
    getSessionToken: async () => null, // Amplify handles tokens internally
  };
}
```

### Provider Wiring (main.tsx)

```typescript
// src/main.tsx — after Phase 0

import ReactDOM from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';
import { PipeProviderRoot } from './providers/DataContext';
import { AmplifyDataProviderFactory, AmplifyStorageProvider, useAmplifyAuth } from './providers/amplify';
import App from './App';
import './index.css';

Amplify.configure(outputs);

const providers = {
  data: AmplifyDataProviderFactory,
  storage: AmplifyStorageProvider,
  auth: null as any, // Auth is provided inside the Authenticator boundary via useAmplifyAuth
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <PipeProviderRoot providers={providers}>
    <App />
  </PipeProviderRoot>
);
```

---

## Task List

### Phase 0A: Create the abstraction layer (no consumer changes yet)

1. **Create `src/providers/types.ts`** — All provider interfaces (DataProvider, DataProviderFactory, StorageProvider, AuthProvider, ModelOperations, Observable, etc.)
2. **Create `src/providers/DataContext.tsx`** — React context + `useData()`, `useStorage()`, `useAuth()` hooks
3. **Create `src/providers/amplify/data.ts`** — Amplify DataProviderFactory implementation wrapping `generateClient`
4. **Create `src/providers/amplify/storage.ts`** — Amplify StorageProvider wrapping `uploadData` and `getUrl`
5. **Create `src/providers/amplify/auth.tsx`** — `AmplifyAuthGate` component + `useAmplifyAuth` hook wrapping `Authenticator` / `useAuthenticator`
6. **Create `src/providers/amplify/index.ts`** — Barrel export
7. **Create `src/providers/index.ts`** — Re-export types + context hooks
8. **Modify `src/main.tsx`** — Wire PipeProviderRoot around `<App />`, keep `Amplify.configure(outputs)` for now
9. **Run `npx tsc --noEmit`** — Verify no type errors in the new files

### Phase 0B: Migrate hooks (highest-value, most reusable code)

10. **Migrate `src/hooks/useAssessment.ts`** — Replace `generateClient` imports with `useData()`. Handle the three auth modes (public, session, authenticated) via factory methods.
11. **Migrate `src/hooks/useVideoSignaling.ts`** — Replace `generateClient` imports with `useData()`. Convert `observeQuery` calls to use `model.observeQuery()` from the provider.
12. **Migrate `src/hooks/useSchedulingConnection.ts`** — Replace `generateClient` with `useData()`. Convert `observeQuery` subscription.
13. **Migrate `src/hooks/usePipelineCreate.ts`** — Replace `generateClient` with `useData()`.
14. **Migrate `src/hooks/useScheduledInterview.ts`** — Replace `generateClient` with `useData()`.
15. **Migrate `src/hooks/useScheduledInterviews.ts`** — Replace `generateClient` + `observeQuery` with `useData()`.
16. **Migrate `src/hooks/useEditorChallenge.ts`** — Replace `generateClient` with `useData()`.
17. **Migrate `src/hooks/useDevContainerSession.ts`** — Replace `generateClient` with `useData()`.
18. **Migrate `src/hooks/useCandidateCreate.ts`** — Replace `generateClient` with `useData()`.
19. **Migrate `src/hooks/useRoleDiscovery.ts`** — Replace `generateClient` with `useData()` (preserved file; minimal change).
20. **Run `npx tsc --noEmit`** — Verify all hooks compile.

### Phase 0C: Migrate pages

21. **Migrate `src/App.tsx`** — Replace `generateClient`, `Authenticator`, `useAuthenticator` with provider hooks. Use `AmplifyAuthGate` and `useAuth()`.
22. **Migrate `src/pages/ListingPage.tsx`** — Replace `generateClient` with `useData()`.
23. **Migrate `src/pages/OverviewPage.tsx`** — Replace `generateClient` with `useData()`.
24. **Migrate `src/pages/CandidateProfilePage.tsx`** — Replace `generateClient` + `getUrl` with `useData()` + `useStorage()`.
25. **Migrate `src/pages/StageDetailPage.tsx`** — Replace `generateClient` with `useData()`.
26. **Migrate `src/pages/PipeLineCreatePage.tsx`** — Replace `generateClient` with `useData()`.
27. **Migrate `src/pages/archived/PipelineCreatePage.tsx`** — Replace `generateClient` with `useData()`.
28. **Migrate `src/pages/DevContainerSandboxPage.tsx`** — Replace `generateClient` with `useData()`.
29. **Migrate `src/pages/DevContainerTestPage.tsx`** — Replace `generateClient` with `useData()`.
30. **Run `npx tsc --noEmit`** — Verify all pages compile.

### Phase 0D: Migrate components

31. **Migrate `src/components/Candidate/CandidateIntakeModal.tsx`** — Replace `generateClient` + `uploadData` with `useData()` + `useStorage()`.
32. **Migrate `src/components/Pipeline/ChallengePicker.tsx`** — Replace `generateClient` with `useData()`.
33. **Migrate `src/components/Scheduling/SchedulingDashboard.tsx`** — Replace `generateClient` with `useData()`.
34. **Migrate `src/components/Panels/VideoSubmissionPanel.tsx`** — Replace `generateClient` with `useData()`.
35. **Migrate `src/components/Assessment/GitHubPRFetcher.tsx`** — Replace `generateClient` with `useData()`.
36. **Migrate `src/components/Assessment/ChallengeRegistry.tsx`** — Replace `generateClient` + `getUrl` with `useData()` + `useStorage()`.
37. **Migrate `src/components/Challenge/QuestionVideoRecorder.tsx`** — Replace `uploadData` with `useStorage()`.
38. **Migrate `src/components/Editor/PreviewOverlay.tsx`** — Replace `generateClient` with `useData()`.
39. **Run `npx tsc --noEmit`** — Verify all components compile.

### Phase 0E: Migrate utilities

40. **Migrate `src/lib/video/webrtcConfig.ts`** — Replace `generateClient` with a provider-sourced client. This file is not a React component, so it needs to accept a DataProvider argument rather than calling a hook.

### Phase 0F: Verification

41. **Run `npx tsc --noEmit`** — Full type check.
42. **Run `grep -r "from ['\"]aws-amplify" src/`** — Verify only `src/providers/amplify/` and `src/main.tsx` have matches.
43. **Run `grep -r "from ['\"]@aws-amplify" src/`** — Verify only `src/providers/amplify/auth.tsx` has matches.
44. **Run E2E tests** — `npx playwright test` must pass.
45. **Manual smoke test** — Sign in, create pipeline, send invite link, complete assessment as candidate, verify recruiter sees results.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/providers/types.ts` | All provider interfaces |
| `src/providers/DataContext.tsx` | React context + `useData()`, `useStorage()`, `useAuth()` hooks |
| `src/providers/index.ts` | Barrel re-export of types + context hooks |
| `src/providers/amplify/data.ts` | Amplify DataProviderFactory (wraps `generateClient`) |
| `src/providers/amplify/storage.ts` | Amplify StorageProvider (wraps `uploadData`, `getUrl`) |
| `src/providers/amplify/auth.tsx` | Amplify AuthProvider + AuthGate (wraps `Authenticator`, `useAuthenticator`) |
| `src/providers/amplify/index.ts` | Amplify barrel export |

**7 new files total.** All under `src/providers/`.

---

## Files to Modify

### Bootstrap

| File | Change |
|---|---|
| `src/main.tsx` | Wrap app in `PipeProviderRoot`, keep `Amplify.configure()` |

### Hooks (10 files)

| File | Change |
|---|---|
| `src/hooks/useAssessment.ts` | Replace `generateClient` with `useData()` factory; three auth modes |
| `src/hooks/useVideoSignaling.ts` | Replace `generateClient` with `useData()` factory; `observeQuery` via provider |
| `src/hooks/useSchedulingConnection.ts` | Replace `generateClient` with `useData()` factory; `observeQuery` via provider |
| `src/hooks/usePipelineCreate.ts` | Replace `generateClient` with `useData()` |
| `src/hooks/useScheduledInterview.ts` | Replace `generateClient` with `useData()` |
| `src/hooks/useScheduledInterviews.ts` | Replace `generateClient` with `useData()` factory; `observeQuery` via provider |
| `src/hooks/useEditorChallenge.ts` | Replace `generateClient` with `useData()` |
| `src/hooks/useDevContainerSession.ts` | Replace `generateClient` with `useData()` |
| `src/hooks/useCandidateCreate.ts` | Replace `generateClient` with `useData()` |
| `src/hooks/useRoleDiscovery.ts` | Replace `generateClient` with `useData()` (preserved file; minimal) |

### Pages (9 files)

| File | Change |
|---|---|
| `src/App.tsx` | Replace `Authenticator`, `useAuthenticator`, `generateClient` with provider hooks |
| `src/pages/ListingPage.tsx` | Replace `generateClient` with `useData()` |
| `src/pages/OverviewPage.tsx` | Replace `generateClient` with `useData()` |
| `src/pages/CandidateProfilePage.tsx` | Replace `generateClient` + `getUrl` with `useData()` + `useStorage()` |
| `src/pages/StageDetailPage.tsx` | Replace `generateClient` with `useData()` |
| `src/pages/PipeLineCreatePage.tsx` | Replace `generateClient` with `useData()` |
| `src/pages/archived/PipelineCreatePage.tsx` | Replace `generateClient` with `useData()` |
| `src/pages/DevContainerSandboxPage.tsx` | Replace `generateClient` with `useData()` |
| `src/pages/DevContainerTestPage.tsx` | Replace `generateClient` with `useData()` |

### Components (7 files)

| File | Change |
|---|---|
| `src/components/Candidate/CandidateIntakeModal.tsx` | Replace `generateClient` + `uploadData` with `useData()` + `useStorage()` |
| `src/components/Pipeline/ChallengePicker.tsx` | Replace `generateClient` with `useData()` |
| `src/components/Scheduling/SchedulingDashboard.tsx` | Replace `generateClient` with `useData()` |
| `src/components/Panels/VideoSubmissionPanel.tsx` | Replace `generateClient` with `useData()` |
| `src/components/Assessment/GitHubPRFetcher.tsx` | Replace `generateClient` with `useData()` |
| `src/components/Assessment/ChallengeRegistry.tsx` | Replace `generateClient` + `getUrl` with `useData()` + `useStorage()` |
| `src/components/Challenge/QuestionVideoRecorder.tsx` | Replace `uploadData` with `useStorage()` |
| `src/components/Editor/PreviewOverlay.tsx` | Replace `generateClient` with `useData()` |

### Utilities (1 file)

| File | Change |
|---|---|
| `src/lib/video/webrtcConfig.ts` | Accept DataProvider as argument instead of importing `generateClient` |

**Total: 28 files modified** (1 bootstrap + 10 hooks + 9 pages + 7 components + 1 utility).

---

## Migration Pattern for Each File

Every consumer file follows the same mechanical transformation:

**Before:**
```typescript
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

// In component/hook body:
const { data } = await client.models.Pipeline.list({ ... });
```

**After:**
```typescript
import { useData } from '../../providers';

// In component/hook body:
const dataFactory = useData();
const client = dataFactory.createClient();
const { data } = await client.models.Pipeline.list({ ... });
```

For files needing multiple auth modes (e.g., `useAssessment.ts`):

**Before:**
```typescript
const publicClient = generateClient<Schema>({ authMode: 'apiKey' });

function getCandidateClient(sessionToken: string | null) {
  if (sessionToken) {
    return generateClient<Schema>({ authMode: 'lambda', authToken: sessionToken });
  }
  return publicClient;
}
```

**After:**
```typescript
const dataFactory = useData();
const publicClient = dataFactory.createPublicClient();

function getCandidateClient(sessionToken: string | null) {
  if (sessionToken) {
    return dataFactory.createSessionClient(sessionToken);
  }
  return publicClient;
}
```

For non-React utility files (e.g., `webrtcConfig.ts`), accept the provider as a parameter:

**Before:**
```typescript
import { generateClient } from 'aws-amplify/data';
const client = generateClient<Schema>({ authMode: 'userPool' });

export async function getIceServers() {
  const { data } = await client.queries.getTurnCredentials();
  // ...
}
```

**After:**
```typescript
import type { DataProvider } from '../../providers/types';

export async function getIceServers(client: DataProvider) {
  const { data } = await client.queries.getTurnCredentials();
  // ...
}
```

---

## Key Design Decisions

1. **No separate RealtimeProvider.** `observeQuery` is a method on `ModelOperations`, not a separate provider. This keeps the API surface identical to current Amplify usage and avoids over-abstraction. Future Cloudflare provider will implement `observeQuery` using WebSockets or SSE.

2. **DataProviderFactory, not a single DataProvider.** The codebase uses three auth modes (userPool, apiKey, lambda). A factory pattern (`createClient`, `createPublicClient`, `createSessionClient`) maps directly to the existing `generateClient({ authMode })` pattern.

3. **`Schema` types not exposed through the abstraction.** Consumer code currently imports `Schema` from `amplify/data/resource` for type information. Post-migration, types are inferred from the provider interfaces. Where specific model types are needed (e.g., `Schema['Pipeline']['type']`), those type aliases should be moved to `src/providers/types.ts` as standalone types derived from the Amplify schema.

4. **`src/main.tsx` keeps `Amplify.configure()`**. The Amplify SDK needs to be initialized for the Amplify provider to work. This is expected and acceptable — it lives alongside the provider wiring, not in consumer code.

5. **Module-level clients become hook-level clients.** Currently many files declare `const client = generateClient<Schema>()` at module scope. After migration, these become local variables inside hooks/components that call `useData()`. For performance, `useMemo` or `useRef` can cache the client instance within a component lifecycle.

---

## Definition of Done

```bash
# 1. No aws-amplify imports in consumer code (only in providers + bootstrap)
grep -r "from ['\"]aws-amplify" src/ | grep -v "src/providers/amplify/" | grep -v "src/main.tsx"
# Expected: no output

# 2. No @aws-amplify imports outside providers
grep -r "from ['\"]@aws-amplify" src/ | grep -v "src/providers/amplify/"
# Expected: no output

# 3. Type check passes
npx tsc --noEmit
# Expected: exit 0

# 4. E2E tests pass
npx playwright test
# Expected: same pass rate as before Phase 0

# 5. The import from amplify/data/resource only exists in providers
grep -r "amplify/data/resource" src/ | grep -v "src/providers/amplify/"
# Expected: no output
```

When all five checks pass, Phase 0 is complete. The frontend is provider-agnostic and ready for Phase 1 (Cloudflare provider implementation).
