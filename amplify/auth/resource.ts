import { defineAuth } from '@aws-amplify/backend';

/**
 * Pipe Authentication Configuration
 *
 * Two user types:
 * 1. Recruiters — sign up with email, use Cognito user pool (owner-based auth)
 * 2. Candidates — unauthenticated, access assessment via invite token URL only
 *
 * Guest access is enabled to support the candidate flow.
 * Candidates do not create accounts — they use /assess/:inviteToken.
 * See amplify/data/resource.ts for per-model guest authorization rules.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  // Admin group for Challenge library curation (post-MVP)
  groups: ['Admin'],
});
