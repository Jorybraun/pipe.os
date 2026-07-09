/**
 * Clerk provider implementations — barrel export.
 *
 * Consumer code (App.tsx) imports from here.
 * Only src/main.tsx (bootstrap) and src/App.tsx use these implementations.
 */

export { ClerkAuthGate, ClerkAuthWrapper } from './auth';
export { useAuth as useClerkAuth } from '../DataContext';
