/**
 * Amplify DataProviderFactory implementation.
 *
 * Wraps `generateClient<Schema>()` from `aws-amplify/data` and maps it to
 * the provider-agnostic DataProvider / DataProviderFactory interfaces.
 *
 * Three auth modes are supported, matching existing usage in the codebase:
 *  - createClient()              → userPool (Cognito, default for recruiters)
 *  - createPublicClient()        → apiKey   (candidate-facing public routes)
 *  - createSessionClient(token)  → lambda   (session JWT after token resolution)
 */

import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import type {
  DataProvider,
  DataProviderFactory,
  ModelOperations,
} from '../types';

// Amplify's generated client type
type AmplifyClient = ReturnType<typeof generateClient<Schema>>;

// The raw model object on an Amplify client has CRUD + observeQuery methods.
// We use an opaque function type since exact signatures vary per model.
type AmplifyModelRecord = Record<string, (...args: unknown[]) => unknown>;

/**
 * wrapModel — adapts a single Amplify model into a ModelOperations interface.
 *
 * Uses casting through `unknown` rather than `any` to avoid type unsafety.
 * The Amplify client's model operations are known to return DataResult-shaped
 * objects at runtime; we assert that here so consumer code can rely on it.
 */
function wrapModel(client: AmplifyClient, modelName: keyof AmplifyClient['models']): ModelOperations {
  const model = client.models[modelName] as unknown as AmplifyModelRecord;

  return {
    get: (input, options) =>
      model['get']!(input, options) as ReturnType<ModelOperations['get']>,

    list: (options) =>
      model['list']!(options) as ReturnType<ModelOperations['list']>,

    create: (input, options) =>
      model['create']!(input, options) as ReturnType<ModelOperations['create']>,

    update: (input, options) =>
      model['update']!(input, options) as ReturnType<ModelOperations['update']>,

    delete: (input, options) =>
      model['delete']!(input, options) as ReturnType<ModelOperations['delete']>,

    observeQuery: (options) =>
      model['observeQuery']!(options) as ReturnType<ModelOperations['observeQuery']>,
  };
}

/**
 * MODEL_NAMES — the exhaustive list of model names defined in the Schema.
 * Keep in sync with `amplify/data/resource.ts`.
 */
const MODEL_NAMES = [
  'Pipeline',
  'Stage',
  'Candidate',
  'Challenge',
  'ChallengeSubmission',
  'Assessment',
  'CodeArtifact',
  'VideoSession',
  'VideoSignal',
  'CandidateMedia',
  'ScheduledInterview',
  'SchedulingConnection',
  'RoleContext',
  'RepoTemplate',
  'DevContainerSession',
] as const satisfies ReadonlyArray<keyof AmplifyClient['models']>;

/**
 * wrapClient — builds a DataProvider from a fully-configured Amplify client.
 */
function wrapClient(client: AmplifyClient): DataProvider {
  const models = {} as DataProvider['models'];

  for (const name of MODEL_NAMES) {
    (models as Record<string, ModelOperations>)[name] = wrapModel(client, name);
  }

  return {
    models,
    mutations: client.mutations as unknown as DataProvider['mutations'],
    queries: client.queries as unknown as DataProvider['queries'],
  };
}

/**
 * AmplifyDataProviderFactory — the singleton factory for all Amplify-backed clients.
 *
 * Registered in `src/main.tsx` via PipeProviderRoot.
 * Consumer code never imports from this file directly — use `useData()` instead.
 */
export const AmplifyDataProviderFactory: DataProviderFactory = {
  createClient: () =>
    wrapClient(generateClient<Schema>()),

  createPublicClient: () =>
    wrapClient(generateClient<Schema>({ authMode: 'apiKey' })),

  createSessionClient: (sessionToken: string) =>
    wrapClient(generateClient<Schema>({ authMode: 'lambda', authToken: sessionToken })),
};
