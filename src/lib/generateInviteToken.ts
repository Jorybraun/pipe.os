/**
 * Generates a secure random UUID for use as a candidate invite token.
 * The token is stored on the Candidate record and embedded in the invite URL.
 */
export function generateInviteToken(): string {
  return crypto.randomUUID();
}
