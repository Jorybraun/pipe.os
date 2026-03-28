/**
 * Provider-agnostic interfaces and context hooks.
 *
 * Consumer code imports from here — never from provider implementations directly.
 * Example:
 *   import { useData, useStorage, useAuth } from '../providers';
 *   import type { DataProvider, StorageProvider } from '../providers';
 */

// Context hooks
export { PipeProviderRoot, useData, useStorage, useAuth } from './DataContext';

// All types and interfaces
export type {
  AuthMode,
  AuthUser,
  AuthProvider,
  QueryOptions,
  ListOptions,
  ObserveOptions,
  DataResult,
  ObserveResult,
  Observable,
  ModelOperations,
  MutationOperation,
  QueryOperation,
  DataProvider,
  DataProviderFactory,
  UploadInput,
  GetUrlInput,
  GetUrlResult,
  StorageProvider,
  PipeProviders,
} from './types';
