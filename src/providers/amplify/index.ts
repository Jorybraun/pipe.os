/**
 * Amplify provider implementations — barrel export.
 *
 * Consumer code should never import from here directly.
 * Only src/main.tsx (bootstrap) imports these implementations.
 */

export { AmplifyDataProviderFactory } from './data';
export { AmplifyStorageProvider } from './storage';
export { AmplifyAuthGate, AmplifyAuthWrapper, useAmplifyAuth } from './auth';
